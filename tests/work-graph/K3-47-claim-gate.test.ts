/**
 * K3 row K3-47 (二) and L11 at the owner layer: an ordinary claim of a Task
 * whose selected Run carries an unsettled / unreadable review record is
 * refused, and the requeue owner applies the same gate (L11).
 *
 * The record precondition is reached through the shared public steps only: the
 * real blocked Run of `K3-proposal-round` (`createK3PendingReview`: production
 * claim/prepare/Runtime start with §5.1's shell stand-in, the production
 * RUN-20/RUN-22 Host read of that Kernel Turn, then the Runtime's own end) and
 * the real `settleReview{review_unavailable}` owner. Fault injection only: the
 * review record's store read is made to fail through a wrapper that delegates
 * to the real store, and the absent-record row ends an ordinary Run crashed
 * through the Runtime (the scripted model's `beforeReply` fault). No record is
 * hand-encoded, no terminal event is built and no reconcile service is
 * assembled by the test. Every owner case runs on both record backends
 * (memory and SQLite) through the shared Host chain.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskRequeueService, type TaskRequeueDependencies } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { CanonicalTaskFacts } from '../../src/core/work-graph/tasks/plan-readers.js';
import { readCanonicalTaskFacts, readGoalPlanWindow } from '../../src/core/work-graph/tasks/plan-readers.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { TaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { GOAL_B, PLAN_B2, WORKSPACE_REVISION } from '../helpers/S5-decision-fixture.js';
import {
  createK3PendingReview, openK3ReviewCardWorld, settleK3Review, type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell` (the real blocked record) is hoisted per test file.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

type B2Records = TaskClaimFixture['records'];

const BACKENDS = ['memory', 'sqlite'] as const;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

async function open(kind: (typeof BACKENDS)[number]): Promise<K3ReviewCardWorld> {
  const world = await openK3ReviewCardWorld(kind);
  worlds.push(world);
  return world;
}

/** A readMany failure code (the store-failure subset a review read can hit). */
type ReviewReadFailureCode = 'unsupported' | 'invalid' | 'corrupt' | 'unavailable';

/**
 * Fault injection (L7): ANY batch read whose keys include a review key fails
 * with `code`; every other read is the real store. This is a store fault, not
 * a hand-encoded record.
 */
function failReviewReads(base: B2Records, code: ReviewReadFailureCode): B2Records {
  return {
    ...base,
    readMany: async (keys) => keys.some(key => key.includes('UnknownCallReview'))
      ? { status: 'rejected', code, reason: `injected ${code} review read failure` }
      : base.readMany(keys),
  };
}

/** The real blocked record: a real Run ends crashed and RUN-20/RUN-22 book it. */
async function pendingRecord(world: K3ReviewCardWorld, label: string): Promise<UnknownCallReviewV1> {
  const record = await createK3PendingReview(world, { taskId: 'k3-20-a', label,
    callId: `${label}-call`, command: `echo ${label}` });
  expect(record.status).toBe('pending_review');
  return record;
}

/** The same real record after the public settlement `review_unavailable` (L16 3). */
async function needsDecisionRecord(world: K3ReviewCardWorld, label: string): Promise<UnknownCallReviewV1> {
  const created = await pendingRecord(world, label);
  const settled = await settleK3Review(world, created, { cause: 'review_unavailable',
    requestId: `${label}-settle` });
  expect(settled.status).toBe('needs_decision');
  return settled;
}

/**
 * An ordinary claim request of `taskId`: a fresh real Session, the accepted
 * Plan/Goal pins and the real Workspace/Session revisions the claim owner
 * guards. Built here (not through the base fixture, whose own scope is the
 * slice-1 `P/W`) so every pin names this world's Goal.
 */
async function claimRequest(
  world: K3ReviewCardWorld, taskId: string, requestId: string, requeueRef?: TaskRequeueRef,
): Promise<Awaited<ReturnType<TaskClaimFixture['buildRequest']>>> {
  const base = world.fixture.b2.base;
  const ctx = world.fixture.ctx;
  const sessionRef = await world.fixture.createS5Session(`k3-47-claim-session-${requestId}`);
  const goal = await base.plans.queryGoal(ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal is not readable: ${JSON.stringify(goal)}`);
  const session = await base.sessionsPort.readSession(ctx, sessionRef);
  if (session.status !== 'ready') throw new Error(`the Session is not readable: ${JSON.stringify(session)}`);
  return {
    input: { goalRef: GOAL_B, planRef: PLAN_B2, taskId, sessionRef,
      roleBinding: base.roleBinding, budget: base.budget,
      ...(requeueRef === undefined ? {} : { requeueRef }) },
    meta: { requestId, expected: [
      { ref: GOAL_B, revision: goal.value.goal.revision },
      { ref: world.fixture.base.workspaceRef, revision: WORKSPACE_REVISION },
      { ref: plainSessionRefToAggregate(sessionRef), revision: session.value.record.revision },
    ] },
  };
}

type Requeue = ReturnType<typeof createTaskRequeueService>['requeueTask'];

function requeueService(world: K3ReviewCardWorld, records: B2Records): Requeue {
  let seq = 0;
  const reads = createRunStateReader({ records });
  const materialReads = createMaterialRecordReaders(records);
  const deps: TaskRequeueDependencies = {
    records, reads,
    workspaceHost: { async resolveRoot(workspace) {
      return workspace.workspaceId === world.fixture.base.scope.workspaceId
        ? { status: 'ready', value: { root: world.fixture.base.directory, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'not_found', reason: 'not a registered workspace' };
    } },
    source: { async captureDigest() { return { status: 'ready', sourceDigest: 'a'.repeat(64) }; } },
    materials: createMaterialService({ bodies: world.fixture.bodies, authority: materialReads.authority,
      now: () => world.fixture.now() }),
    messages: { async readMessage() { return { status: 'not_found' }; } },
    now: () => world.fixture.now(), eventId: () => `k3-47-requeue-${String(++seq)}`,
  };
  return createTaskRequeueService(deps).requeueTask;
}

function hostCtx(world: K3ReviewCardWorld, actor: { kind: 'human' | 'system'; id: string }) {
  const scope = world.fixture.base.scope;
  return { projectId: scope.projectId, workspaceId: scope.workspaceId,
    principal: { kind: 'host' as const, actor },
    materialReader: { kind: 'host' as const, projectId: scope.projectId, workspaceId: scope.workspaceId, actor },
    signal: new AbortController().signal };
}

/** The requeue request of the record's own real Run (`afterRunRef`). */
async function requeueRequestFor(
  world: K3ReviewCardWorld, task: { projectId: string; goalId: string; taskId: string }, runRef: RunRef, requestId: string,
) {
  const base = world.fixture.b2.base;
  const ctx = world.fixture.ctx;
  const goal = await base.plans.queryGoal(ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal is not readable: ${JSON.stringify(goal)}`);
  const run = await createRunStateReader({ records: world.records }).readExecution(ctx, runRef);
  if (run.status !== 'ready') throw new Error(`the Run is not readable: ${JSON.stringify(run)}`);
  return {
    input: { taskRef: task, afterRunRef: runRef, reason: 'retry the failed work' },
    meta: { requestId, expected: [
      { ref: GOAL_B, revision: goal.value.goal.revision },
      { ref: runRef, revision: run.value.run.revision },
    ] },
  };
}

async function requeueRequest(world: K3ReviewCardWorld, record: UnknownCallReviewV1, requestId: string) {
  return await requeueRequestFor(world, record.task, record.runRef, requestId);
}

/**
 * An ordinary Run of the Task that ends `crashed` with NO review record: the
 * production claim + preparation + Runtime start, and the scripted model's
 * `beforeReply` fault, which the Runtime books as its own `run_crashed`.
 */
async function crashedRunWithoutRecord(
  world: K3ReviewCardWorld, label: string,
): Promise<{ taskId: string; runRef: RunRef }> {
  const harness = await openRealRunHarness(world);
  try {
    const taskId = 'k3-20-a';
    const sessionRef = await world.fixture.createS5Session(`${label}-session`);
    const claim = await harness.claimRun({ sessionRef, planRef: PLAN_B2, taskId, requestId: `${label}-claim` });
    const run = await harness.prepareAndStart(claim, {
      model: createScriptedModel([{ kind: 'text', text: 'unused: the beforeReply fault ends the Run' }],
        async () => { throw new Error(`${label}: the Runtime ends this Run crashed`); }),
      tools: ['read'], writeScope: [], blockOnShell: false,
    });
    const result = await run.started;
    if (result.status !== 'ready') throw new Error(`the crashed Run did not end: ${JSON.stringify(result)}`);
    return { taskId, runRef: claim.runRef };
  } finally {
    await harness.closeUnion();
  }
}

/** The durable canonical read model, for "no new Run, no TaskRequeued". */
async function durableFacts(world: K3ReviewCardWorld, taskId: string,
  records: B2Records = world.records): Promise<CanonicalTaskFacts> {
  const window = await readGoalPlanWindow(records, GOAL_B);
  if (window.status !== 'ready' || window.plan === null) throw new Error('the Goal plan window is not readable');
  const facts = await readCanonicalTaskFacts(records, GOAL_B, window.plan, taskId);
  if (facts.status !== 'ready') throw new Error(`the canonical task facts are not readable: ${JSON.stringify(facts)}`);
  return facts.value;
}

/** The real Task row read over `records` (the Task read model the book names). */
async function taskRowOf(world: K3ReviewCardWorld, taskId: string, records: B2Records): Promise<TaskRow> {
  let seq = 0;
  const plans = createPlanService({ records, now: () => world.fixture.now(),
    eventId: () => `k3-47-plan-event-${String(++seq)}` });
  const read = await plans.queryTaskGraph(world.fixture.ctx, { goalRef: GOAL_B, planRef: PLAN_B2 });
  if (read.status !== 'ready') throw new Error(`the Task graph read failed: ${JSON.stringify(read)}`);
  const row = read.value.tasks.find(task => task.ref.taskId === taskId);
  if (row === undefined) throw new Error('the claimed Task must be part of the Task graph');
  return row;
}

describe.each(BACKENDS)('K3-47 (二) the claim owner gates on the selected Run review record (%s)', (kind) => {
  it('K3-47 (二): an unreadable record read refuses an ordinary claim unavailable', async () => {
    const world = await open(kind);
    const record = await pendingRecord(world, 'k3-47-unreadable');
    const failing = failReviewReads(world.records, 'corrupt');
    const service = world.fixture.b2.base.makeService(failing);
    const result = await service.claimTask(world.fixture.ctx,
      await claimRequest(world, record.task.taskId, 'k3-47-unreadable'));
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
  });

  it('K3-47 (二): an invalid review read refuses an ordinary claim unavailable', async () => {
    const world = await open(kind);
    const record = await pendingRecord(world, 'k3-47-invalid');
    const failing = failReviewReads(world.records, 'invalid');
    const service = world.fixture.b2.base.makeService(failing);
    const result = await service.claimTask(world.fixture.ctx,
      await claimRequest(world, record.task.taskId, 'k3-47-invalid'));
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    // No Run was created and the ledger did not change.
    const facts = await durableFacts(world, record.task.taskId);
    expect(facts.runsByTaskId.get(record.task.taskId) ?? []).toHaveLength(1);
  });

  it('K3-47 (二): an unsettled (needs_decision) record refuses an ordinary claim busy pending', async () => {
    const world = await open(kind);
    const record = await needsDecisionRecord(world, 'k3-47-pending');
    const result = await world.fixture.b2.base.service.claimTask(world.fixture.ctx,
      await claimRequest(world, record.task.taskId, 'k3-47-pending'));
    expect(result).toMatchObject({ status: 'rejected', code: 'busy', reason: 'unknown_call_review_pending' });
  });

  it('K3-47 (二): the record of a settled K3-before Run is absent, so the requeue and the claim continue', async () => {
    const world = await open(kind);
    const { taskId, runRef } = await crashedRunWithoutRecord(world, 'k3-47-before');
    // F-042(a): a crashed Run with no review record is not gated. The human
    // requeue is accepted and its actual ref admits the continuation claim.
    const requeued = await requeueService(world, world.records)(hostCtx(world, { kind: 'human', id: 'k3-47-before' }),
      await requeueRequestFor(world, { projectId: GOAL_B.projectId, goalId: GOAL_B.goalId, taskId },
        runRef, 'k3-47-before-requeue'));
    expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error('the absent record must not gate the requeue');
    const result = await world.fixture.b2.base.service.claimTask(world.fixture.ctx,
      await claimRequest(world, taskId, 'k3-47-before', requeued.value.requeue.ref));
    expect(result).toMatchObject({ status: 'committed', replayed: false });
    const facts = await durableFacts(world, taskId);
    expect(facts.runsByTaskId.get(taskId) ?? []).toHaveLength(2);
  });
});

describe.each(BACKENDS)('K3-47 (二) / L11 the requeue owner gates on the selected Run review record (%s)', (kind) => {
  it('K3-47 (二): a system requeue of an unsettled Task is busy pending and writes nothing', async () => {
    const world = await open(kind);
    const record = await needsDecisionRecord(world, 'k3-47-system');
    const beforeReview = await world.reviews.readReview(world.fixture.ctx, { ref: record.ref });
    const beforeFacts = await durableFacts(world, record.task.taskId);
    const requeue = requeueService(world, world.records);
    const result = await requeue(hostCtx(world, WORKFLOW_AUTOMATION_ACTOR),
      await requeueRequest(world, record, 'k3-47-system'));
    expect(result).toMatchObject({ status: 'rejected', code: 'busy', reason: 'unknown_call_review_pending' });
    // F-042(b): the claim after the refused requeue stays busy on the same
    // review gate, and neither call moves the public facts.
    const claimed = await world.fixture.b2.base.service.claimTask(world.fixture.ctx,
      await claimRequest(world, record.task.taskId, 'k3-47-system-after-requeue-claim'));
    expect(claimed).toMatchObject({ status: 'rejected', code: 'busy', reason: 'unknown_call_review_pending' });
    expect(await world.reviews.readReview(world.fixture.ctx, { ref: record.ref })).toEqual(beforeReview);
    const afterFacts = await durableFacts(world, record.task.taskId);
    expect(afterFacts.requeuesByTaskId.get(record.task.taskId) ?? []).toHaveLength(0);
    expect(afterFacts.runsByTaskId.get(record.task.taskId) ?? [])
      .toHaveLength(beforeFacts.runsByTaskId.get(record.task.taskId)?.length ?? 0);
  });

  it('K3-47 (二): a human requeue of an unsettled Task is accepted, then its requeueRef claim stays busy pending', async () => {
    const world = await open(kind);
    const record = await needsDecisionRecord(world, 'k3-47-human');
    const requeue = requeueService(world, world.records);
    const result = await requeue(hostCtx(world, { kind: 'human', id: 'k3-47-human' }),
      await requeueRequest(world, record, 'k3-47-human'));
    expect(result).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
    if (result.status !== 'committed' || result.value.kind !== 'requeued') throw new Error('the human requeue must commit');
    // F-042(c): the actual requeueRef still meets the review gate, and the
    // refused claim writes no Run and moves no review revision.
    const beforeReview = await world.reviews.readReview(world.fixture.ctx, { ref: record.ref });
    const beforeFacts = await durableFacts(world, record.task.taskId);
    const claimed = await world.fixture.b2.base.service.claimTask(world.fixture.ctx,
      await claimRequest(world, record.task.taskId, 'k3-47-human-requeue-claim', result.value.requeue.ref));
    expect(claimed).toMatchObject({ status: 'rejected', code: 'busy', reason: 'unknown_call_review_pending' });
    expect(await world.reviews.readReview(world.fixture.ctx, { ref: record.ref })).toEqual(beforeReview);
    const afterFacts = await durableFacts(world, record.task.taskId);
    expect(afterFacts.requeuesByTaskId.get(record.task.taskId) ?? []).toHaveLength(1);
    expect(afterFacts.runsByTaskId.get(record.task.taskId) ?? [])
      .toHaveLength(beforeFacts.runsByTaskId.get(record.task.taskId)?.length ?? 0);
  });
});

describe.each(BACKENDS)('K3-47 (二) a failed review read is unreadable everywhere (%s)', (kind) => {
  it('K3-47 (二): an unavailable review read refuses an ordinary claim unavailable, with no new Run', async () => {
    const world = await open(kind);
    const record = await pendingRecord(world, 'k3-47-unavailable-claim');
    const failing = failReviewReads(world.records, 'unavailable');
    const service = world.fixture.b2.base.makeService(failing);
    const result = await service.claimTask(world.fixture.ctx,
      await claimRequest(world, record.task.taskId, 'k3-47-unavailable-claim'));
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    const facts = await durableFacts(world, record.task.taskId);
    expect(facts.runsByTaskId.get(record.task.taskId) ?? []).toHaveLength(1);
  });

  it('K3-47 (二): an unavailable review read refuses a system requeue unavailable, with no TaskRequeued', async () => {
    const world = await open(kind);
    const record = await pendingRecord(world, 'k3-47-unavailable-system');
    const failing = failReviewReads(world.records, 'unavailable');
    const result = await requeueService(world, failing)(hostCtx(world, WORKFLOW_AUTOMATION_ACTOR),
      await requeueRequest(world, record, 'k3-47-unavailable-system'));
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable', reason: 'unknown_call_review_unreadable' });
    const facts = await durableFacts(world, record.task.taskId);
    expect(facts.requeuesByTaskId.get(record.task.taskId) ?? []).toHaveLength(0);
    expect(facts.runsByTaskId.get(record.task.taskId) ?? []).toHaveLength(1);
    const row = await taskRowOf(world, record.task.taskId, failing);
    expect(row.unknownCallReview).toEqual({ status: 'unreadable' });
  });

  it('K3-47 (二): an unavailable review read refuses a human requeue unavailable, with no TaskRequeued', async () => {
    const world = await open(kind);
    const record = await pendingRecord(world, 'k3-47-unavailable-human');
    const failing = failReviewReads(world.records, 'unavailable');
    const result = await requeueService(world, failing)(hostCtx(world, { kind: 'human', id: 'k3-47-human' }),
      await requeueRequest(world, record, 'k3-47-unavailable-human'));
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable', reason: 'unknown_call_review_unreadable' });
    const facts = await durableFacts(world, record.task.taskId);
    expect(facts.requeuesByTaskId.get(record.task.taskId) ?? []).toHaveLength(0);
    const row = await taskRowOf(world, record.task.taskId, failing);
    expect(row.unknownCallReview).toEqual({ status: 'unreadable' });
  });

  it.each(['invalid', 'corrupt'] as const)(
    'K3-47 (二): a %s review read refuses a system requeue unavailable', async (code) => {
      const world = await open(kind);
      const record = await pendingRecord(world, `k3-47-${code}-system`);
      const failing = failReviewReads(world.records, code);
      const result = await requeueService(world, failing)(hostCtx(world, WORKFLOW_AUTOMATION_ACTOR),
        await requeueRequest(world, record, `k3-47-${code}-system`));
      expect(result).toMatchObject({ status: 'rejected', code: 'unavailable', reason: 'unknown_call_review_unreadable' });
    });
});
