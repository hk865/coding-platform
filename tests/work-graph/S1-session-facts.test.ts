/** Slice 1 §5.3: Session facts, with real Work/message/Query histories. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';
import { t0, t1, ready, committed, s1Schemas, observeStore, sessionOwners, workHistory,
  pendingQuery, archiveWait } from '../helpers/S1-session-facts-fixture.js';

const opened: B2ExecutionFixture[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0); });
afterEach(async () => {
  for (const fixture of opened.splice(0)) await fixture.close();
  vi.restoreAllMocks(); vi.useRealTimers();
});
async function open(kind: 'memory' | 'sqlite') {
  const b2 = await createB2ExecutionFixture(kind, s1Schemas());
  opened.push(b2);
  const audit = await observeStore(b2.base);
  return { b2, base: b2.base, audit, ...sessionOwners(b2.base), history: workHistory(b2) };
}
type Fixture = Awaited<ReturnType<typeof open>>;

async function consume(f: Fixture, previous: TaskClaim, message: SessionMessage, runId: string): Promise<TaskClaim> {
  if (message.response === null) throw new Error('continuation requires the saved real response');
  vi.setSystemTime(t1);
  let id = 0;
  const ids = [runId, `${runId}-attempt`, `${runId}-event`];
  const service = createTaskClaimService({ records: f.base.records,
    roles: createRoleConfigurationService({ records: f.base.records, now: () => t1, eventId: () => `${runId}-role-${++id}` }),
    now: () => t1, newId: () => ids.shift() ?? `${runId}-extra-${++id}` });
  const request = await f.base.buildRequest({ input: { sessionRef: previous.sessionRef }, requestId: `${runId}-claim` });
  return committed(await service.claimTask(f.base.ctx, { ...request, input: { ...request.input,
    consumedWait: { kind: 'wait_reply', originalRun: previous.runRef, messageRef: message.ref, responseRef: message.response.bodyRef } } })).value;
}

async function expectBusyClaims(f: Fixture) {
  const query = await pendingQuery(f.b2, 'sv08-query');
  const workRequest = await f.base.buildRequest({ input: { taskId: f.base.tasks.second.taskId } });
  const queryRequest = await query.request(f.b2.claim.sessionRef);
  const before = await f.audit.counts();
  const snapshots = await f.audit.records();
  const work = await f.base.makeService(f.base.records, () => t1).claimTask(f.base.ctx, workRequest);
  expect(work).toMatchObject({ status: 'rejected', code: 'busy' });
  if (work.status !== 'rejected') throw new Error('Work must refuse the wait');
  expect(work.reason.startsWith('archive_wait_disposal_required:')).toBe(true);
  const claimedQuery = await query.execution.claimQuery(f.base.ctx, queryRequest);
  expect(claimedQuery).toMatchObject({ status: 'rejected', code: 'busy' });
  if (claimedQuery.status !== 'rejected') throw new Error('Query must refuse the wait');
  expect(claimedQuery.reason.startsWith('archive_wait_disposal_required:')).toBe(true);
  expect(await f.audit.counts()).toEqual(before);
  expect(await f.audit.records()).toEqual(snapshots);
  const pair = ready(await query.jobs.readQueryJob(f.base.ctx, query.queryJobRef));
  expect([pair.job.job.status, pair.run.run.status]).toEqual(['pending', 'pending']);
  expect(ready(await f.directory.readSession(f.base.ctx, f.b2.claim.sessionRef)).record.occupancy).toBeNull();
}

describe.each(['memory', 'sqlite'] as const)('S1 Session facts reader (%s)', kind => {
  it('SV06 a real newer Query pointer does not hide the previous Work wait', async () => {
    const f = await open(kind);
    const message = await f.history.wait(false);
    // Historical coexistence from the pre-S1 Query owner. §0.2 L1 explicitly
    // preserves this entry's old behavior without facts injection. The reader
    // under test is the real injected S1 reader, not a replacement/fake.
    const query = await pendingQuery(f.b2, 'sv06-query', false);
    const claimed = committed(await query.execution.claimQuery(f.base.ctx, await query.request(f.b2.claim.sessionRef)));
    expect(claimed.value.session.lastExecutionRef).toEqual(query.queryRunRef);
    const value = ready(await f.facts.readSessionFacts(f.base.ctx, f.b2.claim.sessionRef));
    expect(value.session.lastExecutionRef).toEqual(query.queryRunRef);
    expect(value.latestWork).toEqual(f.b2.claim);
    expect(value.wait).toEqual({ runRef: f.b2.claim.runRef, messageRef: message.ref, task: f.b2.claim.task });
    expect(value.waits[0]).toEqual({ messageRef: message.ref, rootRef: message.ref,
      waitingSession: f.b2.claim.sessionRef, originalRun: f.b2.claim.runRef,
      requestRoot: null, recipient: f.b2.secondClaim.sessionRef, state: { state: 'open', reason: null },
      deadline: t1, expiredAt: null, complete: true });
  });

  it('SV07 latest Work follows generation even when runId sorts in reverse', async () => {
    const f = await open(kind);
    const message = await f.history.wait(true);
    const next = await consume(f, f.b2.claim, message, 'a-run');
    expect(next.runRef.runId < f.b2.claim.runRef.runId).toBe(true);
    const value = ready(await f.facts.readSessionFacts(f.base.ctx, next.sessionRef));
    expect(value.latestWork).toEqual(next);
    const page = ready(await f.facts.listSessionExecutions(f.base.ctx, { sessionRef: next.sessionRef, page: { limit: 100 } }));
    expect(page.items.map(item => ({ ref: item.runRef, generation: item.generation })).sort((a, b) => a.generation - b.generation))
      .toEqual([f.b2.claim, next].map(item => ({ ref: item.runRef, generation: item.generation })));
    expect(page.nextCursor).toBeNull();
  });

  it('SV08 an unconsumed real response remains a wait and both claim entries refuse', async () => {
    const f = await open(kind);
    const message = await f.history.wait(true);
    const value = ready(await f.facts.readSessionFacts(f.base.ctx, f.b2.claim.sessionRef));
    expect(value.wait).toEqual({ runRef: f.b2.claim.runRef, messageRef: message.ref, task: f.b2.claim.task });
    expect(value.waits[0]).toEqual({ messageRef: message.ref, rootRef: message.ref,
      waitingSession: f.b2.claim.sessionRef, originalRun: f.b2.claim.runRef,
      requestRoot: null, recipient: f.b2.secondClaim.sessionRef, state: { state: 'answered', reason: null },
      deadline: t1, expiredAt: null, complete: true });
    await expectBusyClaims(f);
  });

  it('SV09 archive cancellation closes the wait and preserves the saved response', async () => {
    const f = await open(kind);
    const message = await f.history.wait(true);
    const before = structuredClone(message.response);
    const { disposed } = await archiveWait(f.b2, message, 'cancel');
    expect(disposed.value.archiveWaitDisposition).toEqual({ kind: 'cancel', runRef: f.b2.claim.runRef,
      archiveSessionRef: f.b2.claim.sessionRef, archiveRequestId: 'a', recordedAt: t0 });
    const value = ready(await f.facts.readSessionFacts(f.base.ctx, f.b2.claim.sessionRef));
    expect(value.wait).toBeNull();
    expect(value.waits[0]).toEqual({ messageRef: message.ref, rootRef: message.ref,
      waitingSession: f.b2.claim.sessionRef, originalRun: f.b2.claim.runRef,
      requestRoot: null, recipient: f.b2.secondClaim.sessionRef, state: { state: 'answered', reason: null },
      deadline: t1, expiredAt: null, complete: true });
    expect(ready(await f.history.mailbox.readMessage(f.base.ctx, message.ref)).response).toEqual(before);
  });

  it('SV12 a crashed Run keeps its waitAfterSend inquiry in waits and never in wait', async () => {
    const f = await open(kind);
    // W-18: the inquiry commits, then the sender ends `crashed` before any yield.
    const message = await f.history.wait(false, f.b2.claim, undefined, 'crash');
    const value = ready(await f.facts.readSessionFacts(f.base.ctx, f.b2.claim.sessionRef));
    expect(value.waits[0]).toEqual({ messageRef: message.ref, rootRef: message.ref,
      waitingSession: f.b2.claim.sessionRef, originalRun: f.b2.claim.runRef,
      requestRoot: null, recipient: f.b2.secondClaim.sessionRef, state: { state: 'open', reason: null },
      deadline: t1, expiredAt: null, complete: true });
    expect(value.wait).toBeNull();
  });

  it('SV11 a cursor reused with a different Session filter or workspace is invalid without writes or model calls', async () => {
    const f = await open(kind);
    const message = await f.history.wait(true);
    await consume(f, f.b2.claim, message, 'sv11-next');
    const first = ready(await f.facts.listSessionExecutions(f.base.ctx, { sessionRef: f.b2.claim.sessionRef, page: { limit: 1 } }));
    expect(first.items).toHaveLength(1);
    if (first.nextCursor === null) throw new Error('two executions must yield a cursor');
    const before = await f.audit.counts();
    for (const [ctx, sessionRef] of [
      [f.base.ctx, f.b2.secondClaim.sessionRef],
      [{ ...f.base.ctx, workspaceId: 'w2' }, f.b2.claim.sessionRef],
    ] as const) {
      const result = await f.facts.listSessionExecutions(ctx, { sessionRef, page: { limit: 1, cursor: first.nextCursor } });
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      if (result.status !== 'rejected') throw new Error('foreign cursor must refuse');
      // §5.3 does not freeze the cursor-error reason text; see UNDETERMINED.
      expect(result.reason.length).toBeGreaterThan(0);
      expect(await f.audit.counts()).toEqual(before);
    }
    expect(f.history.modelAuthorization).toHaveBeenCalledTimes(0);
    expect(f.history.modelAttempt).toHaveBeenCalledTimes(0);
  });
});

