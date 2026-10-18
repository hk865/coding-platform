/**
 * K3-47 (二) at the owner/read-model layer: the Task row's review fact and the
 * AV-2b / AV-4c verdict the same canonical read derives.
 *
 * The review record is reached through the shared public steps of
 * `K3-proposal-round` only: the real blocked Run (`createK3PendingReview`:
 * production claim/prepare/Runtime start with §5.1's shell stand-in, the
 * production RUN-20/RUN-22 Host read of that Kernel Turn, then the Runtime's
 * own end), and the real read-only Run + `createRecord` for the auto-settled
 * record. Fault injection only: the review record's store read is made to fail
 * (a wrapper that delegates to the real store), and the held record is held
 * through the real `holdReview` owner. No record is hand-encoded, no terminal
 * event is built and no reconcile service is assembled by the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { unknownCallReviewRefKey } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import type { TaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { GOAL_B, PLAN_B2, T } from '../helpers/S5-decision-fixture.js';
import {
  createK3PendingReview, openK3ReviewCardWorld, type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { readToolSeam, shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell` (every blocked record) and `read` (the auto-settled
// record) are hoisted per test file; the real Run's calls use them.
const seams = vi.hoisted(() => ({
  shellSeam: undefined as unknown,
  readToolSeam: undefined as unknown as typeof import('../helpers/K3-tool-seams.js').readToolSeam,
}));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
vi.mock('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js')>();
  return { ...actual,
    createReadToolDefinition: (workspace: Parameters<typeof actual.createReadToolDefinition>[0]) =>
      seams.readToolSeam.enabled ? seams.readToolSeam.definition() : actual.createReadToolDefinition(workspace) };
});
seams.shellSeam = shellSeam;
seams.readToolSeam = readToolSeam;

type B2Records = TaskClaimFixture['records'];

const BACKENDS = ['memory', 'sqlite'] as const;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  readToolSeam.release();
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

async function open(kind: (typeof BACKENDS)[number]): Promise<K3ReviewCardWorld> {
  const world = await openK3ReviewCardWorld(kind);
  worlds.push(world);
  return world;
}

function reviewRefOf(runRef: RunRef): UnknownCallReviewRef {
  return { aggregateType: 'UnknownCallReview', projectId: runRef.projectId, goalId: runRef.goalId, runId: runRef.runId };
}

/** A real record whose store read fails (the wrapper delegates every other read). */
type ReviewReadFailureCode = 'unsupported' | 'invalid' | 'corrupt' | 'unavailable';

function failReviewRead(records: B2Records, reviewKey: string, code: ReviewReadFailureCode): B2Records {
  return {
    ...records,
    readMany: async (keys) => keys.includes(reviewKey)
      ? { status: 'rejected', code, reason: `injected ${code} review read failure` }
      : records.readMany(keys),
  };
}

/** The real Plan service `queryTaskGraph` read over the given record port. */
async function taskRow(world: K3ReviewCardWorld, taskId: string, records: B2Records = world.records): Promise<TaskRow> {
  let seq = 0;
  const plans = createPlanService({ records, now: () => T, eventId: () => `k3-47-reader-plan-event-${String(++seq)}` });
  const read = await plans.queryTaskGraph(world.fixture.ctx, { goalRef: GOAL_B, planRef: PLAN_B2 });
  if (read.status !== 'ready') throw new Error(`the Task graph read failed: ${JSON.stringify(read)}`);
  const row = read.value.tasks.find(task => task.ref.taskId === taskId);
  if (row === undefined) throw new Error('the claimed Task must be part of the Task graph');
  return row;
}

/**
 * An ordinary Run of the Task that ends `crashed` with NO review record: the
 * production claim + preparation + Runtime start; the scripted model's
 * `beforeReply` throws, which the Runtime books as its own `run_crashed`
 * terminal. Used for the authoritative `not_found` row (the key is absent).
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
    if (result.value.run.status !== 'ended' || result.value.run.outcome !== 'crashed') {
      throw new Error(`the Run did not end crashed: ${JSON.stringify({
        status: result.value.run.status, outcome: result.value.run.outcome })}`);
    }
    return { taskId, runRef: claim.runRef };
  } finally {
    await harness.closeUnion();
  }
}

describe.each(BACKENDS)('K3-47 (二) the Task row reports an unreadable record and AV-2b stops (%s)', (kind) => {
  it('K3-47 (二): an invalid review record read is unreadable and AV-2b reports unreadable', async () => {
    const world = await open(kind);
    const record = await createK3PendingReview(world, { taskId: 'k3-20-a',
      label: 'k3-47-reader-invalid', callId: 'k3-47-reader-invalid-call', command: 'echo invalid' });
    expect(record.status).toBe('pending_review');
    const failing = failReviewRead(world.records, unknownCallReviewRefKey(reviewRefOf(record.runRef)), 'invalid');
    const row = await taskRow(world, record.task.taskId, failing);
    expect(row.unknownCallReview).toEqual({ status: 'unreadable' });
    expect(row.failure?.unknownCallReview).toEqual({ status: 'unreadable', hold: null, requeueConfirmed: false });
    expect(row.failure?.automation.verdict).toMatchObject({ kind: 'stopped', reason: 'unknown_call_review',
      detail: { reviewStatus: 'unreadable' } });
  });
});

describe.each(BACKENDS)('K3-47 (二) every failed review read is unreadable, never absence (%s)', (kind) => {
  it('K3-47 (二): unsupported means unreadable (fail-closed), never absent', async () => {
    // K3 L7 option A "读不出就当没定": a store that answers `unsupported` (it
    // registers no review schema) cannot distinguish "no record" from "cannot
    // read one", so the failed read is `unreadable` for every candidate Run,
    // exactly like invalid/corrupt/unavailable. Only a ready read whose key is
    // missing is authoritative `not_found` (the next case).
    const world = await open(kind);
    const record = await createK3PendingReview(world, { taskId: 'k3-20-a',
      label: 'k3-47-reader-unsupported', callId: 'k3-47-reader-unsupported-call', command: 'echo unsupported' });
    const failing = failReviewRead(world.records, unknownCallReviewRefKey(reviewRefOf(record.runRef)), 'unsupported');
    const row = await taskRow(world, record.task.taskId, failing);
    expect(row.unknownCallReview).toEqual({ status: 'unreadable' });
    expect(row.failure?.unknownCallReview).toEqual({ status: 'unreadable', hold: null, requeueConfirmed: false });
    expect(row.failure?.automation.verdict).toMatchObject({ kind: 'stopped', reason: 'unknown_call_review',
      detail: { reviewStatus: 'unreadable' } });
  });

  it('K3-47 (二): a corrupt review read is unreadable and AV-2b reports unreadable', async () => {
    const world = await open(kind);
    const record = await createK3PendingReview(world, { taskId: 'k3-20-a',
      label: 'k3-47-reader-corrupt', callId: 'k3-47-reader-corrupt-call', command: 'echo corrupt' });
    const failing = failReviewRead(world.records, unknownCallReviewRefKey(reviewRefOf(record.runRef)), 'corrupt');
    const row = await taskRow(world, record.task.taskId, failing);
    expect(row.unknownCallReview).toEqual({ status: 'unreadable' });
    expect(row.failure?.unknownCallReview).toEqual({ status: 'unreadable', hold: null, requeueConfirmed: false });
    expect(row.failure?.automation.verdict).toEqual({ kind: 'stopped', reason: 'unknown_call_review',
      detail: { reviewStatus: 'unreadable' } });
  });

  it('K3-47 (二): a thrown review read is unreadable and AV-2b reports unreadable', async () => {
    const world = await open(kind);
    const record = await createK3PendingReview(world, { taskId: 'k3-20-a',
      label: 'k3-47-reader-thrown', callId: 'k3-47-reader-thrown-call', command: 'echo thrown' });
    const reviewKey = unknownCallReviewRefKey(reviewRefOf(record.runRef));
    const throwing: B2Records = {
      ...world.records,
      readMany: async (keys) => {
        if (keys.includes(reviewKey)) throw new Error('injected review read crash');
        return world.records.readMany(keys);
      },
    };
    const row = await taskRow(world, record.task.taskId, throwing);
    expect(row.unknownCallReview).toEqual({ status: 'unreadable' });
    expect(row.failure?.unknownCallReview).toEqual({ status: 'unreadable', hold: null, requeueConfirmed: false });
    expect(row.failure?.automation.verdict).toEqual({ kind: 'stopped', reason: 'unknown_call_review',
      detail: { reviewStatus: 'unreadable' } });
  });

  it('K3-47 (二): an authoritative not_found (the key is missing) stays absent', async () => {
    const world = await open(kind);
    const { taskId } = await crashedRunWithoutRecord(world, 'k3-47-reader-absent');
    const row = await taskRow(world, taskId);
    expect(row.unknownCallReview).toBeUndefined();
    expect(row.failure?.unknownCallReview).toBeUndefined();
    expect(row.failure?.automation.verdict).toMatchObject({ kind: 'requeue' });
  });
});

describe.each(BACKENDS)('K3-47 (二) the Task row derives AV-2b from a real unsettled record (%s)', (kind) => {
  it('K3-47 (二): a pending_review record stops the Task before AV-3', async () => {
    const world = await open(kind);
    const record = await createK3PendingReview(world, { taskId: 'k3-20-a',
      label: 'k3-47-reader-pending', callId: 'k3-47-reader-pending-call', command: 'echo pending' });
    const row = await taskRow(world, record.task.taskId);
    expect(row.unknownCallReview).toMatchObject({ status: 'pending_review', hold: null });
    expect(row.failure?.unknownCallReview).toMatchObject({ status: 'pending_review', requeueConfirmed: false });
    expect(row.failure?.automation.verdict).toMatchObject({ kind: 'stopped', reason: 'unknown_call_review',
      detail: { reviewStatus: 'pending_review' } });
  });
});

describe.each(BACKENDS)('K3-47 (二) the Task row derives AV-4c from a real held record (%s)', (kind) => {
  it('K3-47 (二): a resolved+held record stops the Task with reviewHold', async () => {
    const world = await open(kind);
    // The real read-only Run auto-settles the complete inventory `resolved`.
    const record = await world.createRecord('k3-20-a', { autoSettled: true });
    expect(record).toMatchObject({ status: 'resolved', revision: 1 });
    const held = await world.reviews.holdReview(world.fixture.ctx, { input: { reviewRef: record.ref, text: null },
      meta: { requestId: 'k3-47-reader-hold', expected: [{ ref: record.ref, revision: 1 }] } });
    expect(held).toMatchObject({ status: 'committed', value: { revision: 2, status: 'resolved',
      disposition: { choice: 'handle_myself', hold: 'held' } } });
    const row = await taskRow(world, record.task.taskId);
    expect(row.unknownCallReview).toMatchObject({ status: 'resolved', hold: 'held' });
    expect(row.failure?.unknownCallReview).toMatchObject({ status: 'resolved', hold: 'held' });
    expect(row.failure?.automation.verdict).toMatchObject({ kind: 'stopped', reason: 'task_paused',
      detail: { fence: 'human_pause', pausedBy: 'human', reviewHold: true } });
  });
});
