/** Direct Work/Query claim exclusions, spec §5.3 SV39–41/51/52. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { CoreRejection, WriteResult } from '../../src/contracts/core/results.js';
import type { RequestSessionArchiveInput } from '../../src/contracts/core/session-archive.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';
import { commitBarrier } from '../helpers/graph-session-fixture.js';
import { t0, ready, committed, key, s1Schemas, observeStore, sessionOwners, workHistory,
  createSession, plannedSession, pendingQuery } from '../helpers/S1-session-facts-fixture.js';

const opened: B2ExecutionFixture[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0); });
afterEach(async () => {
  for (const fixture of opened.splice(0)) await fixture.close();
  vi.restoreAllMocks(); vi.useRealTimers();
});
async function open(kind: 'memory' | 'sqlite') {
  const b2 = await createB2ExecutionFixture(kind, s1Schemas());
  opened.push(b2);
  return { b2, base: b2.base, audit: await observeStore(b2.base), ...sessionOwners(b2.base), history: workHistory(b2) };
}
type Fixture = Awaited<ReturnType<typeof open>>;
function refusal(result: WriteResult<unknown>, code: CoreRejection['code'], prefix?: string) {
  expect(result).toMatchObject({ status: 'rejected', code });
  if (result.status !== 'rejected') throw new Error('expected a refusal');
  // The spec has no frozen prefix for copy exclusion/CAS. Do not invent one.
  if (prefix !== undefined) expect(result.reason.startsWith(prefix)).toBe(true);
  else expect(result.reason.length).toBeGreaterThan(0);
}
async function refuseOrdinaryWork(f: Fixture, sessionRef: SessionRef, code: CoreRejection['code'], prefix?: string) {
  const request = await f.base.buildRequest({ input: { sessionRef, taskId: f.base.tasks.second.taskId } });
  const counts = await f.audit.counts();
  const records = await f.audit.records();
  const result = await f.base.makeService(f.base.records, () => t0).claimTask(f.base.ctx, request);
  refusal(result, code, prefix);
  expect(await f.audit.counts()).toEqual(counts);
  expect(await f.audit.records()).toEqual(records);
  expect(ready(await f.directory.readSession(f.base.ctx, sessionRef)).record.occupancy).toBeNull();
}

describe.each(['memory', 'sqlite'] as const)('S1 direct dispatch guards (%s)', kind => {
  it('SV39 an ordinary Work claim of a real readonly copy is forbidden with no Run or Lease', async () => {
    const f = await open(kind);
    const requestId = 'sv39-copy';
    const planned = plannedSession(f.base, requestId);
    const message = await f.history.copyMessage(f.b2.secondClaim.sessionRef, planned);
    const copy = await createSession(f.base, requestId, { provenance: { schemaVersion: 1,
      kind: 'readonly_copy', from: f.b2.secondClaim.sessionRef, messageRef: message.ref } });
    expect(copy.ref).toEqual(planned);
    expect(ready(await f.directory.readSession(f.base.ctx, copy.ref)).record.provenance).toEqual({ schemaVersion: 1,
      kind: 'readonly_copy', from: f.b2.secondClaim.sessionRef, messageRef: message.ref });
    await refuseOrdinaryWork(f, copy.ref, 'forbidden');
  });

  it('SV40 Query claim of a waiting Session is busy and leaves the real Job/Run pending', async () => {
    const f = await open(kind);
    await f.history.wait(false);
    const query = await pendingQuery(f.b2, 'sv40-query');
    const request = await query.request(f.b2.claim.sessionRef);
    const counts = await f.audit.counts();
    const records = await f.audit.records();
    const result = await query.execution.claimQuery(f.base.ctx, request);
    refusal(result, 'busy', 'archive_wait_disposal_required:');
    expect(await f.audit.counts()).toEqual(counts);
    expect(await f.audit.records()).toEqual(records);
    const pair = ready(await query.jobs.readQueryJob(f.base.ctx, query.queryJobRef));
    expect([pair.job.job.status, pair.run.run.status]).toEqual(['pending', 'pending']);
    expect(ready(await f.directory.readSession(f.base.ctx, f.b2.claim.sessionRef)).record.occupancy).toBeNull();
    expect(query.calls.configuration).toBe(0);
  });

  it('SV41 consumedWait claim racing archive request has one matching durable winner', async () => {
    const f = await open(kind);
    const message = await f.history.wait(true);
    if (message.response === null) throw new Error('race requires the real response');
    const barrier = commitBarrier(f.base.records, 2);
    const claims = f.base.makeService(barrier.records, () => t0);
    const lifecycle = createSessionLifecycleService({ records: barrier.records, lookups: barrier.records,
      sessionFacts: createSessionFactsService({ records: barrier.records }) });
    const claim = await f.base.buildRequest();
    claim.input.consumedWait = { runRef: f.b2.claim.runRef, messageRef: message.ref, responseRef: message.response.bodyRef };
    const archive: GraphWrite<RequestSessionArchiveInput> = {
      input: { sessionRef: f.b2.claim.sessionRef, reason: 'archive racing continuation', tasks: [],
        wait: { kind: 'cancel', runRef: f.b2.claim.runRef, messageRef: message.ref } },
      meta: { requestId: 'a', expected: [await f.base.sessionPin(f.b2.claim.sessionRef)] },
    };
    const before = await f.audit.records();
    const countsBefore = await f.audit.counts();
    const [claimed, requested] = await Promise.all([
      barrier.run(() => claims.claimTask(f.base.ctx, claim)),
      barrier.run(() => lifecycle.requestSessionArchive(f.base.ctx, archive)),
    ]);
    expect([claimed, requested].filter(result => result.status === 'committed')).toHaveLength(1);
    const card = ready(await f.directory.readSession(f.base.ctx, f.b2.claim.sessionRef));
    const after = await f.audit.records();
    expect(await f.audit.counts()).toEqual({ records: countsBefore.records + (claimed.status === 'committed' ? 3 : 0),
      events: countsBefore.events + 1, receipts: countsBefore.receipts + 1 });
    const newExecutions = after.filter(record => !before.some(prior => prior.refKey === record.refKey))
      .filter(record => ['Run', 'TaskAttempt', 'DispatchOutboxEntry'].includes((JSON.parse(record.refKey) as { aggregateType: string }).aggregateType));
    if (claimed.status === 'committed') {
      refusal(requested, 'revision_conflict');
      expect(card.record.archiveRequest).toBeNull();
      const execution = await f.b2.read(claimed.value);
      expect(execution.outbox.claim).toEqual(claimed.value);
      expect(execution.run.ref).toEqual(claimed.value.runRef);
      expect(execution.run.attemptId).toBe(claimed.value.attemptRef.attemptId);
      expect(execution.lease).toMatchObject({ holderRunId: claimed.value.runRef.runId,
        attemptId: claimed.value.attemptRef.attemptId });
      expect(execution.lease?.release).toBeUndefined();
      expect(card.record.occupancy).toEqual({ kind: 'execution', executionRef: claimed.value.runRef,
        generation: claimed.value.generation });
      expect(newExecutions.map(record => record.refKey).sort()).toEqual([
        key(claimed.value.runRef), key(claimed.value.attemptRef), key(claimed.value.outboxRef)].sort());
    } else {
      if (requested.status !== 'committed') throw new Error('archive must be the winner');
      expect(claimed.status).toBe('rejected');
      if (claimed.status !== 'rejected') throw new Error('claim must lose');
      expect(['busy', 'revision_conflict']).toContain(claimed.code);
      expect(claimed.reason.length).toBeGreaterThan(0);
      expect(card.record).toEqual(requested.value);
      expect(card.record.archiveRequest?.requestId).toBe('a');
      expect(card.record.archiveRequest?.wait).toEqual(archive.input.wait);
      expect(card.record.occupancy).toBeNull();
      expect(newExecutions).toEqual([]);
      const old = await f.b2.read();
      expect(old.run.outcome).toBe('yielded');
      expect(old.lease?.release).toBeDefined();
    }
    await f.audit.check();
  });

  it('SV51 ordinary Work claim of a waiting Session writes no Run, Lease or occupancy', async () => {
    const f = await open(kind);
    await f.history.wait(false);
    await refuseOrdinaryWork(f, f.b2.claim.sessionRef, 'busy', 'archive_wait_disposal_required:');
  });

  it('SV52 ordinary Work claim of a Session with a real archive request is busy', async () => {
    const f = await open(kind);
    const session = await createSession(f.base, 'sv52-session');
    const requested = committed(await f.lifecycle.requestSessionArchive(f.base.ctx, {
      input: { sessionRef: session.ref, reason: 'archive idle Session', tasks: [], wait: null },
      meta: { requestId: 'a', expected: [await f.base.sessionPin(session.ref)] } }));
    expect(requested.value.archiveRequest?.requestId).toBe('a');
    await refuseOrdinaryWork(f, session.ref, 'busy');
  });
});
