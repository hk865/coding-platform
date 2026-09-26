/**
 * C2 mailbox admission over real C1 claim/Run/Session and prepared-body facts.
 * Covers current Host grants, historical caller identity and original receipts,
 * including a concurrent winner committed after the first receipt lookup.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/communication/contracts.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/communication/message-record-codecs.js';
import { readManifestFromEnvelope } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import type { TaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';

const harnesses: C1Harness[] = [];
async function open(): Promise<C1Harness> {
  const harness = await createC1Harness('memory');
  harnesses.push(harness);
  return harness;
}
afterEach(async () => { for (const harness of harnesses.splice(0)) await harness.close(); });

function sendRequest(recipient: SessionRef, text: string, requestId: string) {
  return { input: { recipient, text }, meta: { requestId, expected: [] as VersionPin[] } };
}

describe('C2 mailbox fresh admission contract', () => {
  it('replays a real work_run receipt without the fresh dependency, keeps Host sends, and still fails closed for a fresh work_run write', async () => {
    const h = await open();
    // A real committed work_run send establishes the exact identity/receipt.
    const workRequest = sendRequest(h.idleSession, 'work run receipt statement', 'c2-work-receipt');
    const workSent = await h.mailbox.sendMessage(h.ctxWork, workRequest);
    expect(workSent).toMatchObject({ status: 'committed', replayed: false });
    if (workSent.status !== 'committed') return;

    const withoutAdmission = h.makeMailbox(undefined, undefined, null);
    // The ORIGINAL request restores its committed receipt even without the seam.
    expect(await withoutAdmission.sendMessage(h.ctxWork, workRequest))
      .toMatchObject({ status: 'committed', replayed: true });
    // A new work_run write has no receipt and must not fall back to the weaker
    // envelope-only authorization.
    expect(await withoutAdmission.sendMessage(h.ctxWork, sendRequest(h.idleSession, 'fresh work run', 'c2-fresh-no-admission')))
      .toMatchObject({ status: 'rejected', code: 'unsupported' });
    // Host operations and a Host receipt are unaffected.
    const hostRequest = sendRequest(h.idleSession, 'host receipt statement', 'c2-host-receipt');
    expect(await withoutAdmission.sendMessage(h.ctxHost, hostRequest)).toMatchObject({ status: 'committed', replayed: false });
    expect(await withoutAdmission.sendMessage(h.ctxHost, hostRequest)).toMatchObject({ status: 'committed', replayed: true });
  });

  it('pins a real prepared manifest body consistent with the seeded Run binding', async () => {
    const h = await open();
    const envelope = h.currentRun.envelope;
    expect(envelope).not.toBeNull();
    if (envelope === null) return;
    expect(envelope.bundleRef.contentType).toContain('task-execution-manifest');
    const stored = await readManifestFromEnvelope({ bodies: h.rawBodies() }, envelope as unknown as Record<string, unknown>, h.claim.runRef);
    expect(stored.ok, JSON.stringify(stored)).toBe(true);
    if (!stored.ok) return;
    const auth = h.currentRun.executionAuthorization;
    expect(auth && 'schemaVersion' in auth && auth.schemaVersion === 2 ? auth.inputDigest : null)
      .toBe(stored.value.manifest.inputDigest);
    // The same manifest is the Run input binding, not a second inconsistent fact.
    expect(h.currentRun.inputBinding).toMatchObject({ inputDigest: stored.value.manifest.inputDigest,
      manifestDigest: envelope.bundleRef.digest });
  });

  it('re-checks the CURRENT Host/Role grant for a fresh work_run write while still restoring the original receipt', async () => {
    const h = await open();
    const original = sendRequest(h.idleSession, 'receipt before revocation', 'c2-revoked-original');
    const committed = await h.mailbox.sendMessage(h.ctxWork, original);
    expect(committed).toMatchObject({ status: 'committed', replayed: false });
    if (committed.status !== 'committed') return;
    const revoked: SessionMailboxDependencies['runtimeAdmission'] = {
      bodies: h.rawBodies(),
      authorizeConfiguration: async () => ({ status: 'rejected', code: 'forbidden', reason: 'the Host revokes the platform tool grant' }),
    };
    const mailbox = h.makeMailbox(undefined, undefined, revoked);
    // The original committed receipt survives the revocation.
    expect(await mailbox.sendMessage(h.ctxWork, original)).toMatchObject({ status: 'committed', replayed: true });
    // A new request is re-checked against the current Host.
    const fresh = await mailbox.sendMessage(h.ctxWork, sendRequest(h.idleSession, 'after revocation', 'c2-revoked-send'));
    expect(fresh, JSON.stringify(fresh)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.idleSession, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready', value: { items: [committed.value] } });
  });

  it('reads historical mail addressed to the work Run without unrelated Plan/Attempt/Lease facts', async () => {
    const h = await open();
    const hostSent = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.busySession, 'historical statement', 'c2-history-send'));
    expect(hostSent).toMatchObject({ status: 'committed' });
    if (hostSent.status !== 'committed') return;
    // Legal control first: the correct work_run caller reads its own Session mail.
    expect(await h.mailbox.readMessage(h.ctxWork, hostSent.value.ref)).toMatchObject({ status: 'ready' });
    const unrelated = ['PlanRevision', 'TaskAttempt', 'TaskLease'];
    const failingRecords: TaskClaimFixture['records'] = {
      ...h.fixture.records,
      async readMany(refKeys) {
        if (refKeys.some(key => unrelated.some(kind => key.includes(`"aggregateType":"${kind}"`)))) {
          return { status: 'rejected', code: 'corrupt', reason: 'injected unrelated Plan/Attempt/Lease read failure' };
        }
        return h.fixture.records.readMany(refKeys);
      },
    };
    const mailbox = h.makeMailbox(failingRecords);
    // The historical identity only needs Run/outbox/Session.
    const read = await mailbox.readMessage(h.ctxWork, hostSent.value.ref);
    expect(read, JSON.stringify(read)).toMatchObject({ status: 'ready', value: { ref: hostSent.value.ref } });
    expect(await mailbox.readMessageBody(h.ctxWork, { messageRef: hostSent.value.ref, part: 'message' }))
      .toMatchObject({ status: 'ready', value: { text: 'historical statement' } });
  });

  it.each(['ack', 'respond'] as const)('%s restores the concurrent winner after a receipt miss and before reading the changed message', async operation => {
    const h = await open();
    const sent = await h.mailbox.sendMessage(h.ctxHost,
      sendRequest(h.busySession, 'one message for concurrent receipt recovery', `c2-${operation}-race-send`));
    expect(sent).toMatchObject({ status: 'committed', replayed: false });
    if (sent.status !== 'committed') throw Error('the real message must exist before the race');
    const messageRef = sent.value.ref;
    const messageKey = sessionMessageRefKey(messageRef);
    const request = { input: { messageRef, text: 'one durable response' },
      meta: { requestId: `c2-${operation}-same-request`, expected: [{ ref: messageRef, revision: sent.value.revision }] } };
    const initialLookups: { A: string[]; B: string[] } = { A: [], B: [] };
    const authorizations = { A: 0, B: 0 };
    let bodyWrites = 0;
    let commitCalls = 0;
    const materials: C1Harness['materials'] = { ...h.materials,
      async storeArtifact(ctx, input) {
        bodyWrites += 1;
        return h.materials.storeArtifact(ctx, input);
      },
    };
    let signalBlocked!: () => void;
    const blocked = new Promise<void>(resolve => { signalBlocked = resolve; });
    let releaseB!: () => void;
    const released = new Promise<void>(resolve => { releaseB = resolve; });
    let paused = false;
    function mailboxFor(caller: 'A' | 'B') {
      const records: TaskClaimFixture['records'] = { ...h.fixture.records,
        async commit(input) {
          commitCalls += 1;
          return h.fixture.records.commit(input);
        },
        async lookupCommit(input) {
          const result = await h.fixture.records.lookupCommit(input);
          initialLookups[caller].push(result.status === 'ready' ? 'found' : result.code);
          return result;
        },
        async readMany(refKeys) {
          // This exact message load follows fresh admission. B has not read the
          // row yet; its eventual read must observe A's actual committed state.
          if (caller === 'B' && !paused && refKeys.includes(messageKey)) {
            paused = true;
            signalBlocked();
            await released;
          }
          return h.fixture.records.readMany(refKeys);
        },
      };
      return h.makeMailbox(records, materials, { bodies: h.rawBodies(),
        async authorizeConfiguration(ctx, input) {
          authorizations[caller] += 1;
          return h.authorizeConfiguration(ctx, input);
        },
      });
    }
    const a = mailboxFor('A');
    const b = mailboxFor('B');
    const invoke = (mailbox: C1Harness['mailbox']) => operation === 'ack'
      ? mailbox.ackMessage(h.ctxWork, { input: { messageRef }, meta: request.meta })
      : mailbox.respondMessage(h.ctxWork, request);
    const pendingB = invoke(b);
    try {
      await Promise.race([blocked, pendingB.then(result => {
        throw Error(`B finished before the intended message-read window: ${JSON.stringify(result)}`);
      })]);
      expect(initialLookups.B).toEqual(['not_found']);
      expect(authorizations.B).toBe(1);
      const first = await invoke(a);
      expect(first).toMatchObject({ status: 'committed', replayed: false });
      if (first.status !== 'committed') throw Error('A must commit through the real mailbox writer');
      expect(initialLookups.A[0]).toBe('not_found');
      expect(authorizations.A).toBe(1);
      releaseB();
      const second = await pendingB;

      // Check the durable effects before asserting receipt recovery.
      expect(commitCalls).toBe(1);
      expect(bodyWrites).toBe(operation === 'respond' ? 1 : 0);
      const row = await h.fixture.records.readMany([messageKey]);
      expect(row.status).toBe('ready');
      if (row.status !== 'ready') throw Error('the committed message must remain readable');
      expect(row.value.readThrough).toBe(first.cursor);
      expect(row.value.records).toHaveLength(1);
      expect(JSON.parse(row.value.records[0]!.json)).toMatchObject({ revision: sent.value.revision + 1,
        status: operation === 'ack' ? 'read' : 'responded' });
      const event = await h.fixture.records.eventAt(first.cursor);
      expect(event).toMatchObject({ status: 'ready', value: { event: {
        eventType: operation === 'ack' ? 'SessionMessageRead' : 'SessionMessageResponded',
      } } });
      if (operation === 'respond') {
        expect(await h.mailbox.readMessageBody(h.ctxWork, { messageRef, part: 'response' }))
          .toMatchObject({ status: 'ready', value: { text: request.input.text } });
      }
      expect(second, JSON.stringify(second)).toEqual({ ...first, replayed: true });
    } finally {
      releaseB();
      await pendingB;
    }
  });

  it('refuses an externally forged caller identity after proving the legal caller can read', async () => {
    const h = await open();
    const sent = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.busySession, 'identity guard', 'c2-identity-send'));
    expect(sent).toMatchObject({ status: 'committed' });
    if (sent.status !== 'committed') return;
    // The correct work_run caller is readable.
    expect(await h.mailbox.readMessage(h.ctxWork, sent.value.ref)).toMatchObject({ status: 'ready' });
    // Only the external caller is changed; the persisted Role is untouched.
    const forged = { ...h.ctxWork, principal: { kind: 'work_run' as const, runRef: h.claim.runRef,
      roleBinding: { ...h.currentRun.roleBinding, bindingVersion: h.currentRun.roleBinding.bindingVersion + 1 } } };
    const result = await h.makeMailbox().readMessage(forged, sent.value.ref);
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });
});
