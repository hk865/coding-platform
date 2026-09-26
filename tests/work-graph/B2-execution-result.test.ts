/** Result tests begin from real admitted/entered records, never invented permits. */
import { afterEach, describe, expect, it } from 'vitest';
import { B2_AT, b2Key, createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';

const fixtures: B2ExecutionFixture[] = [];
async function open(kind: 'memory' | 'sqlite' = 'memory') { const f = await createB2ExecutionFixture(kind); fixtures.push(f); return f; }
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

describe('B2 execution result and release', () => {
  it('Host grant revocation denies new calls but does not suppress a genuine entered terminal and release', async () => {
    const f = await open(); const admitted = await f.enter(); const observation = f.terminalObservation(admitted);
    f.host.enabled = false;
    const result = await f.entry.recordRunResult(f.ctx, { input: observation,
      meta: { requestId: 'terminal-after-host-revocation', expected: [await f.pin()] } });
    expect(result).toMatchObject({ status: 'committed', replayed: false,
      value: { status: 'ended', outcome: 'completed', executionAuthorization: { phase: 'settled' } } });
    const ended = await f.read();
    expect(ended.attempt.status).toBe('ended'); expect(ended.outbox.status).toBe('settled');
    expect(ended.session).toMatchObject({ occupancy: null, historyCursor: observation.completedHistoryBoundary.cursor });
    expect(ended.lease?.release).toMatchObject({ runRef: f.claim.runRef, generation: f.claim.generation });
    expect(ended.run.executionHistory).toMatchObject({ endPosition: observation.kernelSource.position });
  });

  it('one complete Turn atomically ends Run/Attempt/outbox, retains released Lease, advances the boundary and preserves discovery/links', async () => {
    const f = await open(); const admitted = await f.enter();
    const current = await f.read();
    // Retained link fixture; this test is about release preserving an existing
    // canonical relationship, not proving the independent link writer.
    const link = { ref: { ...f.claim.sessionRef, aggregateType: 'SessionWorkLink',
      target: { kind: 'task', ref: f.claim.task }, relation: 'responsible' }, revision: 1, since: current.readThrough, until: null };
    expect(await f.base.commitRaw([{ refKey: b2Key(link.ref), schemaId: 'SessionWorkLink@1', revision: 1, json: JSON.stringify(link) }]))
      .toMatchObject({ status: 'committed' });
    const beforeCard = await f.base.sessionsPort.readSession(f.ctx, f.claim.sessionRef);
    expect(beforeCard).toMatchObject({ status: 'ready', value: { links: [link] } });
    const request = { input: f.terminalObservation(admitted), meta: { requestId: 'terminal', expected: [await f.pin()] } };
    const result = await f.entry.recordRunResult(f.ctx, request);
    expect(result).toMatchObject({ status: 'committed', replayed: false, value: { status: 'ended', outcome: 'completed', exitCode: 0 } });
    const ended = await f.read();
    expect(ended.run.lastEventSeq).toBe(request.input.event.sequence);
    expect(ended.run.lastRuntimeEventId).toBe(request.input.event.eventId);
    expect(ended.run.lastFactEventId).not.toBe(current.run.lastFactEventId);
    expect(ended.run.lastFactEventId).not.toBe('');
    expect(ended.attempt).toMatchObject({ status: 'ended', endOutcome: 'completed', endedAt: B2_AT });
    expect(ended.outbox).toMatchObject({ status: 'settled', claim: f.claim, dispatchState: { phase: 'settled', sessionGeneration: f.claim.generation } });
    expect(ended.lease).toMatchObject({ holderRunId: f.claim.runRef.runId, attemptId: f.claim.attemptRef.attemptId,
      release: { runRef: f.claim.runRef, attemptRef: f.claim.attemptRef, sessionRef: f.claim.sessionRef, generation: f.claim.generation } });
    expect(ended.session).toMatchObject({ occupancy: null, lifecycle: 'active', lastExecutionRef: f.claim.runRef,
      historyCursor: request.input.completedHistoryBoundary.cursor });
    expect(ended.run.executionHistory).toMatchObject({ startPosition: 2, observedThroughPosition: 4, endPosition: 4 });
    const card = await f.base.sessionsPort.readSession(f.ctx, f.claim.sessionRef);
    expect(card).toMatchObject({ status: 'ready', value: { availability: 'idle', links: [link] } });
    const discovery = await f.base.sessionsPort.findSessions(f.ctx, { workspace: f.base.scope, target: { kind: 'task', ref: f.claim.task }, includeArchived: false, page: { limit: 20 } });
    expect(discovery.status).toBe('ready');
    if (discovery.status === 'ready') expect(discovery.value.items.find(c => c.record.ref.sessionId === f.claim.sessionRef.sessionId)?.availability).toBe('idle');
    const graph = await f.base.plans.queryTaskGraph(f.ctx, { goalRef: f.base.goalRef });
    expect(graph.status).toBe('ready');
    if (graph.status === 'ready') expect(graph.value.tasks.find(t => t.ref.taskId === f.claim.task.taskId)?.effectivePhase).toBe('blocked');
    expect(await f.entry.recordRunResult(f.ctx, request)).toEqual({ ...result, replayed: true });
    expect(await f.read()).toEqual(ended);
    expect(await f.entry.recordRunResult(f.ctx, { input: request.input, meta: { requestId: 'duplicate-fact-new-request', expected: [await f.pin()] } }))
      .toMatchObject({ status: 'rejected' });
    expect(await f.read()).toEqual(ended);
  });

  it('missing completed boundary or a mismatched source retains the actual entered occupancy and history cursor', async () => {
    const f = await open(); const admitted = await f.enter(); const before = await f.read();
    const observation = f.terminalObservation(admitted);
    const missing = await f.entry.recordRunResult(f.ctx, { input: { ...observation, completedHistoryBoundary: null,
      history: { ...observation.history, endPosition: null } }, meta: { requestId: 'no-complete-turn', expected: [await f.pin()] } });
    expect(missing).toMatchObject({ status: 'rejected', code: 'incomplete' });
    expect(await f.read()).toEqual(before);
    const wrongSource = { ...observation, completedHistoryBoundary: { ...observation.completedHistoryBoundary,
      source: { ...observation.completedHistoryBoundary.source, turnId: 'other-turn' } } };
    expect(await f.entry.recordRunResult(f.ctx, { input: wrongSource, meta: { requestId: 'wrong-complete-turn', expected: [await f.pin()] } }))
      .toMatchObject({ status: 'rejected' });
    expect(await f.read()).toEqual(before); expect(await f.sessionAvailability()).toBe('busy');
  });

  it('begin with missing Kernel evidence stays busy and a fresh request cannot restart an uncertain invocation', async () => {
    const f = await open(); const started = await f.start(); const before = await f.read();
    // Simulates loss after the fresh begin barrier. No Kernel source or complete
    // Turn proof may be invented merely because the caller stopped waiting.
    expect(await f.entry.recordRunResult(f.ctx, { input: { ...f.terminalObservation(started),
      kernelSource: null, history: null, completedHistoryBoundary: null },
      meta: { requestId: 'lost-kernel-evidence', expected: [await f.pin()] } }))
      .toMatchObject({ status: 'rejected' });
    expect(await f.read()).toEqual(before); expect(await f.sessionAvailability()).toBe('busy');
    expect(await f.entry.beginRuntimeEntry(f.ctx, { input: { permit: await f.currentPermit(), kernel: f.kernel },
      meta: { requestId: 'retry-uncertain-begin', expected: [await f.pin()] } })).toMatchObject({ status: 'rejected' });
    expect(await f.read()).toEqual(before);
    expect(before.run.executionAuthorization).toMatchObject({ phase: 'entering' });
  });

  it('a late old-generation terminal can update its own history but never release a newer Session or Lease owner', async () => {
    const f = await open(); const admitted = await f.enter();
    // Explicit historical/concurrency anomaly injected at the persistence boundary.
    // It does not stand in for the product's future handoff/requeue writer.
    await f.base.overwriteSession(f.claim.sessionRef, session => ({ ...session,
      occupancy: { kind: 'execution', executionRef: f.secondClaim.runRef, generation: session.revision + 20 },
      lastExecutionRef: f.secondClaim.runRef, historyCursor: 'new-owner-complete-boundary' }));
    const oldLease = (await f.read()).lease;
    if (!oldLease) throw Error('real claim lease missing');
    const newerLease = { ...oldLease, revision: oldLease.revision + 1,
      holderRunId: f.secondClaim.runRef.runId, attemptId: f.secondClaim.attemptRef.attemptId };
    expect(await f.base.commitRaw([{ refKey: b2Key(oldLease.ref), schemaId: 'TaskLeaseSnapshot@1', revision: newerLease.revision, json: JSON.stringify(newerLease) }],
      [{ refKey: b2Key(oldLease.ref), expectedRevision: oldLease.revision }])).toMatchObject({ status: 'committed' });
    const before = await f.read();
    expect(await f.entry.recordRunResult(f.ctx, { input: f.terminalObservation(admitted),
      meta: { requestId: 'late-terminal', expected: [await f.pin()] } })).toMatchObject({ status: 'committed', value: { status: 'ended' } });
    const after = await f.read();
    expect(after.session).toEqual(before.session); expect(after.lease).toEqual(before.lease);
    expect(after.run.executionHistory).toMatchObject({ endPosition: 4 }); expect(await f.sessionAvailability()).toBe('busy');
  });

  it('terminal source/event conflicts cannot rewrite an already committed result or completed boundary', async () => {
    const f = await open(); const admitted = await f.enter(); const observation = f.terminalObservation(admitted);
    expect(await f.entry.recordRunResult(f.ctx, { input: observation, meta: { requestId: 'finish-once', expected: [await f.pin()] } }))
      .toMatchObject({ status: 'committed' });
    const before = await f.read();
    const conflicts = [
      { ...observation, event: { ...observation.event, payload: { kind: 'completed' as const, exitCode: 9 } } },
      { ...observation, event: { ...observation.event, eventId: 'different-id-same-sequence' } },
      { ...observation, kernelSource: { ...observation.kernelSource, position: 5 } },
    ];
    for (const [i, input] of conflicts.entries()) {
      expect(await f.entry.recordRunResult(f.ctx, { input, meta: { requestId: `conflicting-fact-${i}`, expected: [await f.pin()] } }))
        .toMatchObject({ status: 'rejected' });
      expect(await f.read()).toEqual(before);
    }
  });

  it('a real Store CAS conflict rolls back terminal records, event and Session release together', async () => {
    const f = await open(); const admitted = await f.enter(); let intervened = false;
    const records = { ...f.base.records, async commit(batch: Parameters<typeof f.base.records.commit>[0]) {
      if (!intervened) {
        intervened = true;
        await f.base.overwriteSession(f.claim.sessionRef, session => ({ ...session, health: 'recoverable' }));
      }
      return f.base.records.commit(batch);
    } };
    const before = await f.read();
    const result = await f.ports(records).entry.recordRunResult(f.ctx, { input: f.terminalObservation(admitted),
      meta: { requestId: 'terminal-cas-conflict', expected: [await f.pin()] } });
    expect(intervened).toBe(true); expect(result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const after = await f.read();
    expect(after.run).toEqual(before.run); expect(after.attempt).toEqual(before.attempt);
    expect(after.outbox).toEqual(before.outbox); expect(after.lease).toEqual(before.lease);
    expect(after.session.occupancy).toEqual(before.session.occupancy); expect(after.session.historyCursor).toBe(before.session.historyCursor);
  });
});
