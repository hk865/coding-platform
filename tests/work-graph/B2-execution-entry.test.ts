/** Formal prerequisites, real Store races and receipt replay; phase-one RED. */
import { afterEach, describe, expect, it } from 'vitest';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { B2_AT, B2_HOST, b2Key, createB2ExecutionFixture, synchronizeB2Commits, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';

const fixtures: B2ExecutionFixture[] = [];
async function open(kind: 'memory' | 'sqlite' = 'memory') {
  const f = await createB2ExecutionFixture(kind); fixtures.push(f); return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

describe('B2 execution entry', () => {
  it('the real Lease schema rejects a release from another scope even when local Run and attempt ids match', async () => {
    const f = await open(); const before = await f.read();
    const lease = before.lease; if (!lease) throw Error('real claim lease required');
    for (const other of [
      { projectId: 'foreign-project', goalId: f.claim.task.goalId, taskId: f.claim.task.taskId },
      { projectId: f.claim.task.projectId, goalId: 'foreign-goal', taskId: f.claim.task.taskId },
      { projectId: f.claim.task.projectId, goalId: f.claim.task.goalId, taskId: 'foreign-task' },
    ]) {
      // The release refs are internally consistent; only their relationship to
      // the outer real Lease is wrong. The local ids deliberately stay equal.
      const release = { schemaVersion: 1,
        runRef: { ...f.claim.runRef, projectId: other.projectId, goalId: other.goalId },
        attemptRef: { ...f.claim.attemptRef, ...other },
        sessionRef: { ...f.claim.sessionRef, projectId: other.projectId },
        generation: f.claim.generation, releasedAt: B2_AT, eventId: 'b2-foreign-release',
      };
      const invalidLease = { ...lease, revision: lease.revision + 1, release };
      expect(await f.base.commitRaw([{ refKey: b2Key(lease.ref), schemaId: 'TaskLeaseSnapshot@1',
        revision: invalidLease.revision, json: JSON.stringify(invalidLease) }],
      [{ refKey: b2Key(lease.ref), expectedRevision: lease.revision }])).toMatchObject({ status: 'rejected' });
      expect(await f.read()).toEqual(before);
    }
  });

  it('a saved manifest with correct bytes and digest but the wrong contentType cannot authorize execution', async () => {
    const f = await open(); const prepared = await f.buildPrepared();
    const original = await f.bodies.read(prepared.envelope.bundleRef);
    expect(original.status).toBe('ready');
    if (original.status !== 'ready') throw Error('real prepared manifest body required');
    const wrongType = await f.bodies.put({ body: original.value.body, contentType: 'text/plain',
      sourceRefs: original.value.sourceRefs, origin: { kind: 'run', owner: f.claim.runRef }, requestedAt: B2_AT });
    expect(wrongType.status).toBe('ready');
    if (wrongType.status !== 'ready') throw Error('real wrong-type artifact put required');
    expect(wrongType.value.ref).toMatchObject({ contentType: 'text/plain',
      digest: prepared.envelope.bundleRef.digest, sizeBytes: prepared.envelope.bundleRef.sizeBytes });
    const wrong = { ...prepared, envelope: { ...prepared.envelope, bundleRef: wrongType.value.ref },
      inputBinding: { ...prepared.inputBinding, manifestDigest: wrongType.value.ref.digest } };
    const before = await f.read();
    expect(await f.entry.authorizeRuntimeEntry(f.ctx, { input: { prepared: wrong, consumerId: 'runtime-a' },
      meta: { requestId: 'wrong-manifest-content-type', expected: [await f.pin()] } }))
      .toMatchObject({ status: 'rejected' });
    expect(await f.read()).toEqual(before);
    // The otherwise identical, correctly typed stored body is still admissible.
    await f.authorize({ prepared });
  });

  it('a real claim whose Session occupancy was lost cannot receive fresh entry authorization', async () => {
    const f = await open(); const prepared = await f.buildPrepared();
    // Persistence-boundary anomaly, not a replacement claim fixture: the real
    // claim remains, but it no longer owns the Session it is about to enter.
    await f.base.overwriteSession(f.claim.sessionRef, session => ({ ...session, occupancy: null }));
    const before = await f.read();
    expect(before.session.occupancy).toBeNull();
    expect(await f.entry.authorizeRuntimeEntry(f.ctx, { input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'lost-session-before-authorize', expected: [await f.pin()] } }))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    expect(await f.read()).toEqual(before);
  });

  it('a Lease released after admission reads wins CAS and leaves no entry authorization', async () => {
    const f = await open(); const prepared = await f.buildPrepared(); const before = await f.read();
    const lease = before.lease; if (!lease) throw Error('real claim lease required');
    let intervened = false;
    const records = { ...f.base.records, async commit(batch: Parameters<typeof f.base.records.commit>[0]) {
      if (!intervened) {
        intervened = true;
        const released = { ...lease, revision: lease.revision + 1, release: {
          schemaVersion: 1, runRef: f.claim.runRef, attemptRef: f.claim.attemptRef,
          sessionRef: f.claim.sessionRef, generation: f.claim.generation,
          releasedAt: B2_AT, eventId: 'b2-intervening-lease-release',
        } };
        expect(await f.base.commitRaw([{ refKey: b2Key(lease.ref), schemaId: 'TaskLeaseSnapshot@1',
          revision: released.revision, json: JSON.stringify(released) }],
        [{ refKey: b2Key(lease.ref), expectedRevision: lease.revision }])).toMatchObject({ status: 'committed' });
      }
      return f.base.records.commit(batch);
    } };
    const result = await f.ports(records).entry.authorizeRuntimeEntry(f.ctx, {
      input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'lease-released-during-authorize', expected: [await f.pin()] },
    });
    expect(intervened).toBe(true);
    expect(result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const after = await f.read();
    expect(after.run).toEqual(before.run); expect(after.attempt).toEqual(before.attempt);
    expect(after.outbox).toEqual(before.outbox); expect(after.session).toEqual(before.session);
    expect(after.lease).toMatchObject({ revision: lease.revision + 1,
      release: { runRef: f.claim.runRef, generation: f.claim.generation } });
  });

  it('SQLite identical authorization race restores the original receipt even after begin and reopen', async () => {
    const f = await open('sqlite');
    const request = { input: { prepared: await f.buildPrepared(), consumerId: 'runtime-a' },
      meta: { requestId: 'auth-race', expected: [await f.pin()] } };
    const race = synchronizeB2Commits(f.base.records);
    const entry = f.ports(race.records).entry;
    const results = await Promise.all([entry.authorizeRuntimeEntry(f.ctx, request), entry.authorizeRuntimeEntry(f.ctx, request)]);
    expect(results.map(r => r.status)).toEqual(['committed', 'committed']);
    expect(race.arrivals()).toBe(2);
    const [a, b] = results;
    if (a?.status !== 'committed' || b?.status !== 'committed') throw Error('authorization race must commit/replay');
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.value).toEqual(b.value); expect(a.cursor).toBe(b.cursor);
    const begun = await f.entry.beginRuntimeEntry(f.ctx, { input: { permit: a.value, kernel: f.kernel },
      meta: { requestId: 'grow-after-auth', expected: [await f.pin()] } });
    expect(begun).toMatchObject({ status: 'committed', replayed: false });
    await f.base.closeBackend();
    const reopened = await f.base.reopenService();
    try {
      const replay = await f.ports(reopened.records).entry.authorizeRuntimeEntry(f.ctx, request);
      expect(replay).toEqual({ ...a, replayed: true });
    } finally { await reopened.close(); }
  });

  it('competing consumers actually race and a loser cannot take over using a fresh Run pin', async () => {
    const f = await open(); const prepared = await f.buildPrepared(); const pin = await f.pin();
    const race = synchronizeB2Commits(f.base.records); const entry = f.ports(race.records).entry;
    const results = await Promise.all(['a', 'b'].map(consumerId => entry.authorizeRuntimeEntry(f.ctx,
      { input: { prepared, consumerId }, meta: { requestId: `consumer-${consumerId}`, expected: [pin] } })));
    expect(results.filter(r => r.status === 'committed')).toHaveLength(1); expect(race.arrivals()).toBe(2);
    const winner = results.find(r => r.status === 'committed');
    if (!winner || winner.status !== 'committed') throw Error('one consumer must win');
    const before = await f.read();
    const loser = winner.value.consumerId === 'a' ? 'b' : 'a';
    expect(await f.entry.authorizeRuntimeEntry(f.ctx, { input: { prepared, consumerId: loser },
      meta: { requestId: 'fresh-loser', expected: [await f.pin()] } })).toMatchObject({ status: 'rejected' });
    expect(await f.read()).toEqual(before);
  });

  it('fresh begin and replay are distinct; entered uses the real newer binding and Run revisions', async () => {
    const f = await open(); const admitted = await f.authorize();
    const request = { input: { permit: admitted.permit, kernel: f.kernel }, meta: { requestId: 'begin-race', expected: [await f.pin()] } };
    const race = synchronizeB2Commits(f.base.records); const entry = f.ports(race.records).entry;
    const results = await Promise.all([entry.beginRuntimeEntry(f.ctx, request), entry.beginRuntimeEntry(f.ctx, request)]);
    expect(results.map(r => r.status)).toEqual(['committed', 'committed']); expect(race.arrivals()).toBe(2);
    const fresh = results.find(r => r.status === 'committed' && !r.replayed);
    expect(fresh).toBeDefined(); expect(results.filter(r => r.status === 'committed' && r.replayed)).toHaveLength(1);
    if (!fresh || fresh.status !== 'committed') throw Error('one fresh begin required');
    const permit = await f.currentPermit();
    expect(permit.authorizationRevision).toBe(fresh.value.authorization.revision);
    expect(permit.authorizationRevision).toBeGreaterThan(admitted.permit.authorizationRevision);
    const before = await f.read();
    expect(await f.entry.beginRuntimeEntry(f.ctx, { ...request, meta: { requestId: 'no-second-begin', expected: [await f.pin()] } }))
      .toMatchObject({ status: 'rejected' });
    expect(await f.read()).toEqual(before);
    const enteredInput = { permit, enteredAt: B2_AT, kernelSource: { ...f.kernel, position: 3 }, history: f.observedHistory(3) };
    expect(await f.entry.recordExecutionEntered(f.ctx, { input: enteredInput, meta: { requestId: 'stale-entered-pin', expected: request.meta.expected } }))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await f.entry.recordExecutionEntered(f.ctx, { input: { ...enteredInput, kernelSource: { ...f.kernel, turnId: 'other-turn', position: 3 } },
      meta: { requestId: 'wrong-turn', expected: [await f.pin()] } })).toMatchObject({ status: 'rejected' });
    const entered = await f.entry.recordExecutionEntered(f.ctx, { input: enteredInput, meta: { requestId: 'entered', expected: [await f.pin()] } });
    expect(entered).toMatchObject({ status: 'committed', value: { status: 'running' } });
    const state = await f.read();
    expect((await f.currentPermit()).authorizationRevision).toBeGreaterThan(permit.authorizationRevision);
    expect(state.attempt.status).toBe('started'); expect(state.outbox.status).toBe('entered');
    expect(state.run.executionHistory).toMatchObject({ kernel: f.kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null });
    expect(await f.entry.beginRuntimeEntry(f.ctx, request)).toEqual({ ...fresh, replayed: true });
  });

  it('rejects tampered body, identity, permissions and absent-without-template before admitting a valid saved manifest', async () => {
    const f = await open(); const prepared = await f.buildPrepared();
    const variants = [
      { ...prepared, envelope: { ...prepared.envelope, bundleRef: { ...prepared.envelope.bundleRef, digest: '0'.repeat(64) } } },
      { ...prepared, claim: { ...prepared.claim, sessionRef: f.secondClaim.sessionRef } },
      await f.buildPrepared({ permissions: { ...B2_HOST.permissions, tools: ['read', 'write'] } }),
      await f.buildPrepared({ hostTemplate: null }),
      await f.buildPrepared({ role: { status: 'inadmissible', roleId: 'builder', reasons: [] } }),
    ];
    const before = await f.read();
    for (const [i, invalid] of variants.entries()) {
      expect(await f.entry.authorizeRuntimeEntry(f.ctx, { input: { prepared: invalid, consumerId: 'runtime-a' },
        meta: { requestId: `invalid-prepared-${i}`, expected: [await f.pin()] } })).toMatchObject({ status: 'rejected' });
      expect(await f.read()).toEqual(before);
    }
    await f.authorize({ prepared });
    expect(f.host.calls).toBeGreaterThan(0);
  });

  it('does not allow a legacy authorization to begin; malformed V2 is rejected by the real Run codec', async () => {
    const f = await open(); const old = await f.read();
    const legacy = { ...old.run, revision: old.run.revision + 1,
      executionAuthorization: { generation: 1, consumerId: 'runtime-a', phase: 'authorized' as const } };
    expect(await f.base.commitRaw([{ refKey: b2Key(legacy.ref), schemaId: 'RunSnapshot@1', revision: legacy.revision, json: JSON.stringify(legacy) }],
      [{ refKey: b2Key(legacy.ref), expectedRevision: old.run.revision }])).toMatchObject({ status: 'committed' });
    expect((await f.read()).run.executionAuthorization).toEqual(legacy.executionAuthorization);
    expect(await f.entry.beginRuntimeEntry(f.ctx, { input: { permit: f.permit(), kernel: f.kernel },
      meta: { requestId: 'legacy-cannot-begin', expected: [await f.pin()] } })).toMatchObject({ status: 'rejected', code: 'forbidden' });
    const malformed = { ...legacy, revision: legacy.revision + 1, executionAuthorization: {
      schemaVersion: 2, generation: 1, sessionGeneration: f.claim.generation, revision: 1,
      consumerId: 'runtime-a', inputDigest: f.permit().inputDigest, phase: 'entering', kernel: null,
    } };
    expect(await f.base.commitRaw([{ refKey: b2Key(legacy.ref), schemaId: 'RunSnapshot@1', revision: malformed.revision, json: JSON.stringify(malformed) }],
      [{ refKey: b2Key(legacy.ref), expectedRevision: legacy.revision }])).toMatchObject({ status: 'rejected' });
  });

  it('begin-held Kernel slot is reusable by WG12, without pretending the starting Run has entered', async () => {
    const f = await open(); await f.start();
    const writer = createExecutionHistoryService({ records: f.base.records, now: () => B2_AT, eventId: () => 'b2-locator-event' });
    expect(await writer.recordExecutionHistory(f.ctx, { input: { runRef: f.claim.runRef, ...f.observedHistory(3) },
      meta: { requestId: 'locator-after-begin', expected: [await f.pin()] } })).toMatchObject({ status: 'committed' });
    const current = await f.read();
    expect(current.run.status).toBe('starting'); expect(current.attempt.status).toBe('claimed');
    expect(current.run.executionAuthorization).toMatchObject({ phase: 'entering' });
  });

  it('a Kernel identity slot held by another Run blocks a correctly mapped begin, with zero partial state', async () => {
    const f = await open(); const admitted = await f.authorize();
    // Targeted historical collision: mapping for this Run is correct. The rejection must
    // come from the real unique slot, unlike using another Session's Kernel id.
    expect(await f.base.records.commit({ identityKey: 'b2-prior-slot', fingerprint: 'b2-prior-slot',
      guards: [], records: [], claims: [{ claimKey: 'execution-history-kernel:' + b2Key(f.kernel),
        expectedOwner: null, nextOwner: b2Key(f.secondClaim.runRef) }], indexGuards: [], indexChanges: [],
      events: [{ eventId: 'b2-slot-seed', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: B2_AT, json: JSON.stringify({
        eventId: 'b2-slot-seed', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: B2_AT }) }] }))
      .toMatchObject({ status: 'committed' });
    const before = await f.read();
    expect(await f.entry.beginRuntimeEntry(f.ctx, { input: { permit: admitted.permit, kernel: f.kernel },
      meta: { requestId: 'conflicting-slot-begin', expected: [await f.pin()] } })).toMatchObject({ status: 'rejected' });
    expect(await f.read()).toEqual(before);
  });

  it('Host grant revoked after authorization prevents fresh begin', async () => {
    const f = await open(); const admitted = await f.authorize(); const before = await f.read(); f.host.enabled = false;
    expect(await f.entry.beginRuntimeEntry(f.ctx, { input: { permit: admitted.permit, kernel: f.kernel },
      meta: { requestId: 'revoked-begin', expected: [await f.pin()] } })).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await f.read()).toEqual(before);
  });
});
