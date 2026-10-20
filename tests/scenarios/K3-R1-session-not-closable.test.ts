/**
 * K3 group 2 part 3, ruling 5 / K3-21: the `session_not_closable` guard (L25 G7)
 * at the R1 entry.
 *
 * The Run is left with an unresolved `send_session_message` exactly as K3-01
 * (the ledger + Kernel store locked right after `SessionMessageSent`). A real
 * archive request is then registered on that claim Session through the public
 * `sessions/archive-line` route (an operator `drop` of the work Task). The
 * follow-up stop the archive composition would submit is prevented from moving
 * the Run's control pointer: the scenario's commit observer takes the ledger's
 * write lock right after the `SessionArchiveRequested` commit, so the cancel
 * submit fails and the request stays pending with a clean pointer.
 *
 * The crash restart's reconcile then reads G4 as clean and G7 false: the Host
 * report line is `W-13` / `unknown` with
 * `autoCleanup: { applied: false, blockedBy: 'session_not_closable' }`.
 * The archive request itself is asserted through `sessions/read`.
 *
 * No check runs (the Run never reaches one).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/app/core-http-types.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { ArchiveLineInput } from '../../src/business/workflow/session-archive.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { lockLedger, lockLedgerAfter, openWorkRoot, preparedOf, redrivePolicy, WORK_TARGET } from './support/common.js';

afterEach(async () => { await cleanupScenarios(); await cleanupRestart(); });

type SessionCardLike = { record: { ref: Record<string, unknown>; revision: number; archiveRequest?: unknown };
  links: Array<{ ref: { target: unknown; relation: string }; revision: number; until: string | null }> };

async function readSessionCard(h: HostScenario, sessionRef: SessionRef): Promise<SessionCardLike> {
  const card = await h.post<ReadResult<SessionCardLike>>('sessions/read', plain(AG2B_SCOPE, sessionRef));
  if (card.status !== 'ready') throw new Error(`the Session must be readable: ${JSON.stringify(card)}`);
  return card.value;
}

describe('K3 R1 session_not_closable (K3-21 G7)', () => {
  it('K3-21 session_not_closable: a pending archive request on the claim Session blocks RUN-25 with W-13 and blockedBy session_not_closable', async () => {
    // The commit observer fires after the Host commits the archive request; it
    // takes the ledger's write lock so the archive's follow-up stop cannot move
    // the Run pointer.
    let database: string | undefined;
    const archiveLock: { current: { release(): void } | null } = { current: null };
    const releaseArchiveLock = (): void => {
      const held = archiveLock.current;
      archiveLock.current = null;
      held?.release();
    };
    const h = await HostScenario.open({
      gitWorkspace: true, automation: redrivePolicy(false), check: 'pass',
      commitObserver: (batch) => {
        if (database !== undefined && archiveLock.current === null
          && batch.events.some(event => event.eventType === 'SessionArchiveRequested')) {
          archiveLock.current = lockLedger(database);
        }
      },
    });
    database = h.database;
    try {
      // --- K3-01's crash shape: a committed send without a Kernel result. ----
      const recipient = (await createAG2bSession(h.host, 'k3-21-nc-recipient', AG2B_QUERY_ROLE,
        [{ target: WORK_TARGET, relation: 'participates' }])).sessionRef;
      const toStart = await h.advance(h.select('k3-21-nc', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
      const prepared = preparedOf(toStart.next);
      const lock = lockLedgerAfter(h.database, 'SessionMessageSent', { kernelStore: true });
      const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-21-nc-send', name: 'send_session_message',
        args: { recipient: { projectId: recipient.projectId, sessionId: recipient.sessionId }, text: 'k3-21-nc question',
          intent: 'inquiry', needsReply: true, waitAfterSend: true } }] }]);
      const root = await openWorkRoot(h, model, lock.observer);
      try {
        await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'k3-21-nc-start' });
      } finally { lock.release(); await root.close(); }
      expect(lock.locked(), 'the locks were taken at SessionMessageSent').toBe(true);
      expect(model.calls(), 'one model reply, the send').toBe(1);

      const sessionRef = prepared.claim.sessionRef;
      // --- The real archive request through the public archive route. --------
      const before = await readSessionCard(h, sessionRef);
      const request: ArchiveLineInput = {
        sessionRef, reason: 'k3-21 session_not_closable: an archive request is pending at the crash',
        tasks: [{ target: WORK_TARGET, disposition: { kind: 'drop' } }], wait: null, confirmUnknownStopped: false,
      };
      const started = await h.post<ReadResult<{ state: string }>>('sessions/archive-line',
        graphWrite(AG2B_SCOPE, request, 'k3-21-nc-archive',
          [{ ref: before.record.ref, revision: before.record.revision }]));
      try {
        // The request commits; the stop the archive would submit is refused by
        // the held ledger lock, so the composition answers `partial` with the
        // request pending and the Run's control pointer untouched.
        expect(started.status).toBe('ready');
        expect(started.status === 'ready' ? started.value.state : null, 'the archive composition stopped before the stop')
          .toBe('partial');
      } finally { releaseArchiveLock(); }

      // The request is really on that Session.
      const after = await readSessionCard(h, sessionRef);
      expect(after.record.archiveRequest, 'the claim Session carries the pending archive request').toMatchObject({
        requestId: expect.any(String),
      });

      // --- Crash and restart: the reconcile cannot auto-clean. ---------------
      const report = await h.restart({ crash: true });
      expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
        { ref: JSON.stringify(prepared.claim.runRef), row: 'W-13', status: 'reconciled', reason: 'unknown',
          autoCleanup: { applied: false, blockedBy: 'session_not_closable' } }] } });
    } finally { releaseArchiveLock(); }
  }, 180_000);
});
