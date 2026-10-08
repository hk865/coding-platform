/** Slice 1 §5.3: real archive and requeue histories on both stores. */
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { SessionArchiveRequestV1 } from '../../src/contracts/core/session-archive.js';
import type { ArchiveRequeueOriginV1, SessionAnomalyAnchorV1 } from '../../src/contracts/session-anomaly.js';
import { SESSION_ARCHIVE_AUTOMATION_ACTOR, WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { nextRequeueAutoCount } from '../../src/core/work-graph/state/task-failure.js';
import { createArchiveServiceFixture, committed, ready, CRASHED, CAP_THREE, t1,
  type ArchiveServiceFixture } from '../helpers/S1-archive-service-fixture.js';

const opened: ArchiveServiceFixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
async function open(kind: 'memory' | 'sqlite') {
  const f = await createArchiveServiceFixture(kind); opened.push(f); return f;
}
function refs(claim: TaskClaim) {
  return {
    requeue: { aggregateType: 'TaskRequeue' as const, ...claim.task, afterRunId: claim.runRef.runId },
    refusal: { aggregateType: 'TaskReworkRefusal' as const, ...claim.task, operation: 'requeue' as const, subjectId: claim.runRef.runId },
  };
}
function origin(f: ArchiveServiceFixture, request: SessionArchiveRequestV1, anchor: SessionAnomalyAnchorV1): ArchiveRequeueOriginV1 {
  return { kind: 'execution', archiveSessionRef: f.S, archiveRequestId: request.requestId, anchorRef: anchor.ref };
}
async function stoppedByArchive(f: ArchiveServiceFixture, claim = f.b2.claim) {
  const request = await f.register();
  expect(request.execution).toEqual({ kind: 'work', runRef: claim.runRef, attemptRef: claim.attemptRef });
  const cancel = await f.cancel(request, claim);
  await f.observeCancel(cancel.value.intent, claim);
  return request;
}
async function noRequeueOrRefusal(f: ArchiveServiceFixture, claim: TaskClaim) {
  expect(await f.encoded(refs(claim).requeue)).toBeNull();
  expect(await f.encoded(refs(claim).refusal)).toBeNull();
}
async function expectForbidden(f: ArchiveServiceFixture, request: Parameters<ReturnType<typeof f.requeueService>['requeueTask']>[1], claim: TaskClaim) {
  const before = f.snapshot();
  const result = await f.requeueService().requeueTask(f.ctx, request);
  expect(result.status).toBe('rejected');
  if (result.status !== 'rejected') throw new Error(JSON.stringify(result));
  expect(result.code).toBe('forbidden');
  // §5.3 does not freeze a reason prefix for these three new refusal branches.
  expect(result.reason.trim().length).toBeGreaterThan(0);
  await noRequeueOrRefusal(f, claim);
  expect(f.snapshot()).toEqual(before);
  await f.invariants();
}
async function assertCap(f: ArchiveServiceFixture, claim: TaskClaim, archiveOrigin?: ArchiveRequeueOriginV1) {
  const before = f.snapshot();
  const result = committed(await f.requeueService().requeueTask(f.hostCtx(archiveOrigin ? SESSION_ARCHIVE_AUTOMATION_ACTOR : WORKFLOW_AUTOMATION_ACTOR),
    await f.requeueWrite(claim, archiveOrigin ? { archiveOrigin } : {})));
  if (result.value.kind !== 'refused') throw new Error(JSON.stringify(result));
  const refusal = result.value.refusal;
  expect({ ref: refusal.ref, revision: refusal.revision, code: refusal.code,
    failureClass: refusal.failureClass, afterRunRef: refusal.afterRunRef }).toEqual({
    ref: refs(claim).refusal, revision: 1, code: 'auto_rework_cap_reached',
    failureClass: 'run_failed', afterRunRef: claim.runRef });
  expect(await f.encoded(refs(claim).requeue)).toBeNull();
  const stored = await f.encoded(refs(claim).refusal);
  expect(stored?.revision).toBe(1);
  expect(stored && JSON.parse(stored.json)).toEqual(refusal);
  const facts = await f.taskFacts();
  const runs = facts.runsByTaskId.get(claim.task.taskId) ?? [];
  const requeues = facts.requeuesByTaskId.get(claim.task.taskId) ?? [];
  expect(requeues).toHaveLength(3);
  const afterRun = runs.find(run => run.ref.runId === claim.runRef.runId);
  if (!afterRun) throw new Error('latest Run absent from persisted chain');
  expect(nextRequeueAutoCount({ actorClass: 'system', failureClass: refusal.failureClass,
    afterRun, runs, requeues, policy: CAP_THREE })).toEqual({ automatic: true, counted: true, autoCount: 4, cap: 3 });
  expect(f.calls).toEqual(before.calls); // Setup captures are deliberately excluded.
  expect({ records: f.writes.records - before.writes.records, events: f.writes.events - before.writes.events,
    receipts: f.writes.receipts - before.writes.receipts }).toEqual({ records: 1, events: 1, receipts: 1 });
  expect(facts.requeueRefusalsByRunId.size).toBe(1);
  expect(facts.requeueRefusalsByRunId.get(claim.runRef.runId)).toEqual(refusal);
  await f.invariants();
}

describe.each(['memory', 'sqlite'] as const)('archive requeues (%s)', kind => {
  it('SV35 human archive cancellation with prior=cap=3 is an uncounted interruption', async () => {
    const f = await open(kind);
    await f.enter(); await f.end(f.b2.claim, CRASHED);
    const r0 = await f.growChain(3, true);
    const chain = await f.taskFacts();
    expect(chain.requeuesByTaskId.get(r0.task.taskId)?.map(r => r.automation.autoCount).sort()).toEqual([1, 2, 3]);
    const request = await stoppedByArchive(f, r0);
    const anchor = await f.anchor(request, r0);
    const archiveOrigin = origin(f, request, anchor.value);
    const result = committed(await f.requeueService().requeueTask(f.ctx, await f.requeueWrite(r0, { archiveOrigin })));
    if (result.value.kind !== 'requeued') throw new Error(JSON.stringify(result));
    expect({ failureClass: result.value.requeue.failureClass, automation: result.value.requeue.automation,
      archiveOrigin: result.value.requeue.archiveOrigin }).toEqual({ failureClass: 'interrupted', archiveOrigin,
      automation: { automatic: false, counted: false, autoCount: 0, cap: null } });
    expect((await f.encoded(refs(r0).requeue))?.revision).toBe(1);
    expect(await f.encoded(refs(r0).refusal)).toBeNull();
  });

  it('SV36 an origin naming a nonexistent archive request is forbidden without writes', async () => {
    const f = await open(kind); await f.enter();
    const request = await stoppedByArchive(f);
    const anchor = await f.anchor(request);
    await expectForbidden(f, await f.requeueWrite(f.b2.claim, { archiveOrigin: {
      ...origin(f, request, anchor.value), archiveRequestId: 'no-such-request' } }), f.b2.claim);
  });

  it('SV37 a retired paused_interrupted Task archives with one anchor and a closed responsibility', async () => {
    const f = await open(kind); await f.link(); await f.enter();
    const pause = await f.pauseAndReconcile();
    // RUN-24 releases S through SES-06 with kernel_turn_open: it is already retired.
    expect((await f.session()).record.health).toBe('unavailable');
    const before = (await f.taskFacts()).byTaskId.get(f.base.tasks.first.taskId);
    expect(before?.phaseCause?.code).toBe('paused_interrupted');
    f.setNow(t1);
    const request = await f.register({ mode: 'retired', tasks: [{ target: f.taskTarget, disposition: { kind: 'drop' } }] });
    const anchor = await f.anchor(request);
    expect({ cause: anchor.value.cause, runRef: anchor.value.runRef }).toEqual({ cause: 'retired_archive', runRef: f.b2.claim.runRef });
    const disposed = committed(await f.responsibilities.disposeArchiveResponsibility(f.archiveCtx(request), f.step(request, 'responsibility', f.taskTarget)));
    const closed = (await f.session()).links.find(link => link.ref.relation === 'responsible');
    expect(closed?.until).toEqual(disposed.cursor);
    const archived = committed(await f.lifecycle.finishSessionArchive(f.archiveCtx(request), f.step(request, 'archive')));
    expect(archived.value.lifecycle).toBe('archived');
    expect((await f.taskFacts()).byTaskId.get(f.base.tasks.first.taskId)).toEqual(before);
    const anchors = ready(await f.anomalies.listSessionAnomalies(f.ctx, { goalRef: f.base.goalRef,
      taskId: f.base.tasks.first.taskId, page: { limit: 20 } }));
    expect(anchors.items.map(item => item.anchor)).toEqual([anchor.value]);
    expect((await f.execution()).run.controlState?.intentRef).toEqual(pause.ref);
    await noRequeueOrRefusal(f, f.b2.claim);
  });

  it('SV38 recovery replays the complete existing requeue and cursor without another Attempt or Run', async () => {
    const f = await open(kind); await f.enter();
    const request = await stoppedByArchive(f);
    const anchor = await f.anchor(request);
    const write = await f.requeueWrite(f.b2.claim, { archiveOrigin: origin(f, request, anchor.value) }, 'sv38');
    const first = committed(await f.requeueService().requeueTask(f.ctx, write));
    if (first.value.kind !== 'requeued') throw new Error(JSON.stringify(first));
    const encoded = await f.encoded(first.value.requeue.ref);
    const facts = await f.taskFacts();
    const before = f.snapshot();
    const replay = await f.requeueService().requeueTask(f.ctx, write);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await f.encoded(first.value.requeue.ref)).toEqual(encoded);
    expect(await f.taskFacts()).toEqual(facts);
    expect(f.snapshot()).toEqual(before);
    await f.invariants();
  });

  it('SV48 an absent anchor with a real archive request is forbidden without writes', async () => {
    const f = await open(kind); await f.enter();
    const request = await stoppedByArchive(f);
    const archiveOrigin: ArchiveRequeueOriginV1 = { kind: 'execution', archiveSessionRef: f.S,
      archiveRequestId: request.requestId, anchorRef: { aggregateType: 'SessionAnomalyAnchor',
        projectId: f.S.projectId, goalId: f.base.goalRef.goalId, runId: f.b2.claim.runRef.runId } };
    expect(await f.encoded(archiveOrigin.anchorRef)).toBeNull();
    await expectForbidden(f, await f.requeueWrite(f.b2.claim, { archiveOrigin }), f.b2.claim);
  });

  it('SV49 a genuine r0 anchor cannot authorize an origin for afterRun r2', async () => {
    const f = await open(kind); await f.enter();
    const request = await stoppedByArchive(f);
    const anchor = await f.anchor(request);
    const archiveOrigin = origin(f, request, anchor.value);
    const queued = committed(await f.requeueService().requeueTask(f.ctx, await f.requeueWrite(f.b2.claim, { archiveOrigin })));
    if (queued.value.kind !== 'requeued') throw new Error(JSON.stringify(queued));
    const r1 = committed(await f.base.makeService(f.records, f.now).claimTask(f.ctx,
      await f.requeueClaimRequest(f.base.sessions.second, queued.value.requeue))).value;
    await f.enter(r1); await f.end(r1, CRASHED);
    const r2 = await f.growChain(1, false, f.base.sessions.second, r1);
    expect(anchor.value.runRef).toEqual(f.b2.claim.runRef);
    expect(request.execution).toEqual({ kind: 'work', runRef: f.b2.claim.runRef, attemptRef: f.b2.claim.attemptRef });
    await expectForbidden(f, await f.requeueWrite(r2, { archiveOrigin }), r2);
  });

  it('SV50 ordinary automatic failure after three reworks retains the original cap refusal', async () => {
    const f = await open(kind); await f.enter(); await f.end(f.b2.claim, CRASHED);
    const latest = await f.growChain(3);
    expect((await f.execution(latest)).run.outcome).toBe('crashed');
    await assertCap(f, latest);
  });

  it('SV57 an archive-cancelled yielded wait requeues without an anchor or a fabricated ConsumedWait', async () => {
    const f = await open(kind); await f.enter();
    const message = await f.send(); await f.yieldWait(message);
    const request = await f.register({ wait: { kind: 'cancel', runRef: f.b2.claim.runRef, messageRef: message.ref } });
    committed(await f.mailbox.disposeArchiveWait(f.ctx, f.step(request, 'wait_cancel', f.b2.claim.runRef)));
    await f.cancel(request); // Existing yielded-wait control closes only the continuation window.
    const archiveOrigin: ArchiveRequeueOriginV1 = { kind: 'wait', archiveSessionRef: f.S,
      archiveRequestId: request.requestId, runRef: f.b2.claim.runRef, messageRef: message.ref };
    const result = committed(await f.requeueService().requeueTask(f.ctx, await f.requeueWrite(f.b2.claim, { archiveOrigin })));
    if (result.value.kind !== 'requeued') throw new Error(JSON.stringify(result));
    expect({ failureClass: result.value.requeue.failureClass, archiveOrigin: result.value.requeue.archiveOrigin,
      automation: result.value.requeue.automation }).toEqual({ failureClass: 'interrupted', archiveOrigin,
      automation: { automatic: false, counted: false, autoCount: 0, cap: null } });
    expect(ready(await f.anomalies.listSessionAnomalies(f.ctx, { goalRef: f.base.goalRef, page: { limit: 20 } })).items).toEqual([]);
    const facts = await f.taskFacts();
    const runs = facts.runsByTaskId.get(f.base.tasks.first.taskId) ?? [];
    expect(runs).toHaveLength(1);
    expect(runs.map(run => run.consumedWait ?? null)).toEqual([null]);
    const saved = ready(await f.mailbox.readMessage(f.ctx, message.ref));
    expect(saved.response).toBeNull();
    expect(saved.archiveWaitDisposition).toEqual({ kind: 'cancel', runRef: f.b2.claim.runRef,
      archiveSessionRef: f.S, archiveRequestId: request.requestId, recordedAt: f.now() });
    expect(ready(await f.sessionFacts.readSessionFacts(f.ctx, f.S)).wait).toBeNull();
  });

  it('SV59 failure before retirement still counts against cap despite the real retired_archive anchor', async () => {
    const f = await open(kind); await f.enter(); await f.end(f.b2.claim, CRASHED);
    const latest = await f.growChain(3);
    await f.link(); f.setNow(t1); await f.retire();
    const request = await f.register({ mode: 'retired', tasks: [{ target: f.taskTarget, disposition: { kind: 'drop' } }] });
    const anchor = await f.anchor(request, latest);
    expect({ cause: anchor.value.cause, runRef: anchor.value.runRef }).toEqual({ cause: 'retired_archive', runRef: latest.runRef });
    await assertCap(f, latest, origin(f, request, anchor.value));
  });
});
