/**
 * K3 (L28, KR2): the start-up reconcile's step 2b and step 6b condition (c).
 *
 * Both read the `open = 'yes'` records through the production
 * `UnknownCallReviewService.listReviews` owner (index `k3-ucr-by-workspace-open`)
 * over a real RecordStore; every record is made by the shared public steps, not
 * by a constructed draft: the `pending_review` record is the real blocked Run
 * (`createK3PendingReview`), the held one is the same record through the real
 * `holdReview`, the active round is the real TASK-03r claim, and the
 * `needs_decision` one is the production Host RUN-20/RUN-22 recognition of a
 * real Run whose one call id the Kernel cannot decode (L8 `undecodable_call`,
 * G11 `inventory_incomplete`). The Host recognition path reads the world's own
 * backend (the SQLite fixture directory, or the shared in-memory backend through
 * the accepted test-only seam), so every world runs on both.
 *
 * - Step 2b lists one `UCR` / `left` line per open record whose reason is the
 *   status, the decision reasons and whether a round is still open (ruling 7).
 * - Step 6b (c) hands an active Goal the record's Task id for kind 1 (open,
 *   `pending_review`/`awaiting_proposal`, not `held`) and kind 2 (open, an
 *   `activeRound`, regardless of status and hold). A `held` record with no
 *   round (`open = 'no'`) and an inactive Goal are never handed off.
 *
 * One fault case: a store wrapper that fails the first page read makes step 2b
 * report exactly one `problem`, list no review line and never throw. Steps 1..6
 * find no Work to reconcile here (empty candidate reads), so those ports stay
 * untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { runStartupReconcile, type StartupReconcilePlatform } from '../../src/app/startup-reconcile.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { setGoalControlFromHost } from '../../src/core/work-graph/tasks/goal-control.js';
import { readCanonicalTaskFacts, readGoalPhase, readGoalPlanWindow } from '../../src/core/work-graph/tasks/plan-readers.js';
import {
  createUnknownCallReviewService, type UnknownCallReviewTaskProjectionReader,
} from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import {
  claimK3ReviewRound, createK3PendingReview, endK3RunUnfinished, openK3ReviewCardWorld,
  type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { runIdGeneratorOf } from '../helpers/B2-crr-world.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import {
  GOAL_A, GOAL_B, GOAL_C, PLAN_B2, T, WORKSPACE_SCOPE,
} from '../helpers/S5-decision-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file: the real blocked Runs' one
// process call stays in flight until the Host recognition has read it.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const HOST = 'k3-29-host';

type World = K3ReviewCardWorld;

const worlds: World[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

function projectionOver(records: World['records']): UnknownCallReviewTaskProjectionReader {
  return async (_ctx, task) => {
    const goalRef = { aggregateType: 'Goal' as const, projectId: task.projectId, goalId: task.goalId };
    const window = await readGoalPlanWindow(records, goalRef);
    if (window.status !== 'ready') return window;
    if (window.plan === null) return { status: 'rejected', code: 'not_found', reason: 'the Goal has no active plan' };
    return await readCanonicalTaskFacts(records, goalRef, window.plan, task.taskId);
  };
}

/** A real `needs_decision inventory_incomplete`: the Host cannot decode the one call id. */
async function incompleteRecord(world: World, taskId: string, label: string): Promise<UnknownCallReviewV1> {
  const harness = await openRealRunHarness(world, { newId: runIdGeneratorOf(world) });
  try {
    const session = await world.fixture.createS5Session(`k3-29-incomplete-${label}`);
    const claim = await harness.claimRun({ sessionRef: session, planRef: PLAN_B2, taskId,
      requestId: `k3-29-incomplete-claim-${label}` });
    const started = await harness.prepareAndStart(claim, {
      model: createScriptedModel([{ kind: 'calls', calls: [{
        callId: 'k'.repeat(513), name: 'shell', args: { command: 'echo the undecodable call' } }] }]),
      tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
    });
    const record = await harness.createRecord(claim);
    expect(record, JSON.stringify(record)).toMatchObject({ inventory: 'incomplete',
      inventoryProblem: 'undecodable_call', status: 'needs_decision',
      decisionReasons: ['inventory_incomplete'], open: 'yes' });
    // Release the stand-in so the Runtime books its own end as well.
    shellSeam.release();
    await started.started.catch(() => undefined);
    return record;
  } finally {
    shellSeam.release();
    await harness.closeUnion();
  }
}

/** The real `pending_review` record of one blocked shell call through the shared steps. */
async function pendingRecord(world: World, taskId: string, label: string): Promise<UnknownCallReviewV1> {
  const record = await createK3PendingReview(world, {
    taskId, label, callId: `k3-29-call-${label}`, command: 'echo hi',
  });
  expect(record, JSON.stringify(record)).toMatchObject({ revision: 1, status: 'pending_review',
    inventory: 'complete', open: 'yes', activeRound: null });
  expect(record.items).toHaveLength(1);
  return record;
}

/** A real direct hold with no round: `open = 'no'`, never listed. */
async function heldRecord(world: World, taskId: string, label: string): Promise<UnknownCallReviewV1> {
  const record = await pendingRecord(world, taskId, label);
  const held = await world.reviews.holdReview(world.fixture.ctx, { input: { reviewRef: record.ref, text: null },
    meta: { requestId: `k3-29-hold-${label}`, expected: [{ ref: record.ref, revision: record.revision }] } });
  expect(held, JSON.stringify(held)).toMatchObject({ status: 'committed', value: {
    status: 'resolved', open: 'no', activeRound: null, disposition: { hold: 'held' } } });
  if (held.status !== 'committed') throw new Error('the hold must commit');
  return held.value;
}

/** Every real Goal snapshot the start-up candidate read sees. */
async function goalSnapshots(world: World): Promise<GoalSnapshot[]> {
  const snapshots: GoalSnapshot[] = [];
  for (const ref of [GOAL_A, GOAL_B, GOAL_C]) {
    const read = await world.fixture.b2.base.plans.queryGoal(world.fixture.ctx, ref);
    if (read.status !== 'ready') throw new Error(`the Goal must read: ${JSON.stringify(read)}`);
    snapshots.push(read.value.goal);
  }
  return snapshots;
}

/** Pause Goal B through the real Goal control owner, then hand back its real snapshot. */
async function pauseGoalB(world: World): Promise<GoalSnapshot> {
  const goal = await world.fixture.b2.base.plans.queryGoal(world.fixture.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error('the Goal must read');
  const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: GOAL_B.projectId, goalId: GOAL_B.goalId };
  const phase = await readGoalPhase(world.records, phaseRef);
  if (phase.status !== 'ready') throw new Error('the GoalPhase must read');
  let sequence = 0;
  const paused = await setGoalControlFromHost({ records: world.records, now: () => T,
    eventId: () => `k3-29-goal-control-${String(++sequence)}` }, world.fixture.ctx, {
    input: { goalRef: GOAL_B, control: 'pause', reason: null },
    meta: { requestId: 'k3-29-goal-pause', expected: [
      { ref: GOAL_B, revision: goal.value.goal.revision },
      { ref: phaseRef, revision: phase.snapshot?.revision ?? 0 },
    ] },
  });
  expect(paused).toMatchObject({ status: 'committed', value: { desiredState: 'paused' } });
  const after = await world.fixture.b2.base.plans.queryGoal(world.fixture.ctx, GOAL_B);
  if (after.status !== 'ready') throw new Error('the paused Goal must read');
  return after.value.goal;
}

type PageServer = (input: { workspace: unknown; filter: unknown; page: { limit: number; cursor?: string } }) =>
Promise<unknown>;
/** Every port throws unless the test gives it an answer. */
function untouched<T extends object>(name: string): T {
  return new Proxy({}, { get: (_target, member) => () => { throw new Error(`${name}.${String(member)} must not be called`); } }) as T;
}
const nothing = async () => ({ status: 'ready' as const, value: { records: [], damaged: [] } });

async function reconcile(world: World, goals: readonly GoalSnapshot[], reviews: PageServer) {
  const planReads: string[] = [];
  const platform: StartupReconcilePlatform = {
    sessions: { findSessions: async () => ({ status: 'ready', value: { items: [], nextCursor: null, sourceCursor: 'c-1' } }) as never },
    executions: untouched('executions'),
    controls: untouched('controls'),
    plans: { queryTaskGraph: async (ctx, input) => {
      planReads.push(input.goalRef.goalId);
      // The real Plan/Task projection: the re-drive reads the genuine graph.
      return await world.fixture.b2.base.plans.queryTaskGraph(ctx, input);
    } },
    reconcile: { ...untouched<StartupReconcilePlatform['reconcile']>('reconcile'),
      reviews: { listReviews: async (_ctx, input) => await reviews(input) as never },
      candidates: { listRuns: nothing, listUnknownRuns: nothing, listQueuedControlRuns: nothing, listOpenRounds: nothing,
        listGoals: async () => ({ status: 'ready', value: { records: [...goals], damaged: [] } }) } },
  };
  const report = await runStartupReconcile({ platform, hostInstanceId: HOST, resumeOnStartup: 'auto',
    scopes: [world.fixture.base.scope], context: () => world.fixture.ctx as CoreCallContext,
    fanOut: async () => { throw new Error('no fan-out pass is expected for an unchanged active Goal'); } });
  return { report, planReads };
}

describe('K3-29 step 2b over real records', () => {
  it.each(['memory', 'sqlite'] as const)('K3-29 (%s): lists the real records and skips a real hold with no round', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    // RUN-22 incomplete (undecodable call) -> needs_decision inventory_incomplete.
    const needs = await incompleteRecord(world, 'k3-20-a', '2b');
    // RUN-22 complete with a process item -> pending_review.
    const pending = await pendingRecord(world, 'k3-20-b', '2b');
    // A direct hold with no round closes the record: open = 'no', never listed.
    await heldRecord(world, 'k3-20-c', '2b-held');

    // The start-up read is the production owner; a commit wrapper proves it is read only.
    const readOnly = { ...world.records, async commit() { throw new Error('start-up 2b must not write'); } };
    const readOnlyReviews = createUnknownCallReviewService({ records: readOnly, lookups: readOnly,
      reads: createRunStateReader({ records: world.records }),
      readReviewDisplays: async () => ({ status: 'ready', value: new Map() }),
      taskProjection: projectionOver(world.records), now: () => T, eventId: () => 'k3-29-readonly' });
    // A paused Goal is a real state (and the 2b scan is per workspace, so it
    // still lists the records); the re-drive does not read a paused Goal's graph.
    const paused = await pauseGoalB(world);
    const { report, planReads } = await reconcile(world, [paused],
      async input => await readOnlyReviews.listReviews(world.fixture.ctx, input as never));

    expect(report.reviews).toEqual([
      { ref: JSON.stringify(needs.ref), row: 'UCR', status: 'left', reason: 'needs_decision inventory_incomplete' },
      { ref: JSON.stringify(pending.ref), row: 'UCR', status: 'left', reason: 'pending_review' },
    ]);
    expect(report.problems).toEqual([]);
    expect(planReads).toEqual([]);
  });

  it.each(['memory', 'sqlite'] as const)('K3-29 (%s): a first-page read failure is exactly one problem line and no review line', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    await pendingRecord(world, 'k3-20-a', 'fault');
    let pages = 0;
    const failingLookups = { ...world.records, async lookup(input: Parameters<World['records']['lookup']>[0]) {
      pages += 1;
      if (pages === 1) throw new Error('k3-29 first page read fails');
      return await world.records.lookup(input);
    } };
    const failingReviews = createUnknownCallReviewService({ records: world.records, lookups: failingLookups,
      reads: createRunStateReader({ records: world.records }),
      readReviewDisplays: async () => ({ status: 'ready', value: new Map() }),
      taskProjection: projectionOver(world.records), now: () => T, eventId: () => 'k3-29-fault' });
    // A paused Goal is a real state and the 2b scan is per workspace: the one
    // problem line stays the review read, not the re-drive's graph read.
    const paused = await pauseGoalB(world);
    const { report } = await reconcile(world, [paused],
      async input => await failingReviews.listReviews(world.fixture.ctx, input as never));

    expect(report.reviews).toEqual([]);
    expect(report.problems).toEqual([
      'W: the open reviews are not readable '
      + '(unavailable: the review list could not be read: k3-29 first page read fails)']);
    expect(pages).toBe(1);
  });
});

describe('K3-29 step 6b (c) over real records', () => {
  it.each(['memory', 'sqlite'] as const)('K3-29 (%s): kind 1 and kind 2 hand an active Goal its record Task ids; a held record without a round is not handed off', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    // kind 1: pending, no round.
    await pendingRecord(world, 'k3-20-a', '6b');
    // kind 2: a HELD record with a real active round (the real TASK-03r claim +
    // Run). The hold is formed FIRST, then the round's Run ends. Kind 1 excludes
    // a held record, so only kind 2 can hand this Task off: removing the kind 2
    // branch drops `k3-20-b` from the expected task list.
    const roundRecord = await pendingRecord(world, 'k3-20-b', '6b-round');
    const round = await claimK3ReviewRound(world, roundRecord, { phase: 'review' });
    expect(round.record).toMatchObject({ activeRound: { phase: 'review', round: 1 } });
    const heldRound = await world.reviews.holdReview(world.fixture.ctx, {
      input: { reviewRef: roundRecord.ref, text: null },
      meta: { requestId: 'k3-29-6b-round-hold',
        expected: [{ ref: roundRecord.ref, revision: round.record.revision }] } });
    expect(heldRound, JSON.stringify(heldRound)).toMatchObject({ status: 'committed', value: {
      revision: round.record.revision + 1, status: 'resolved', open: 'yes',
      disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' },
      activeRound: { phase: 'review', round: 1 } } });
    // The round Run ends through the Runtime; the record keeps its held round.
    await endK3RunUnfinished(world, round.claim);
    // open = 'no': a real direct hold with no round, in the same active Goal.
    await heldRecord(world, 'k3-20-c', '6b-held');

    const { report } = await reconcile(world, await goalSnapshots(world),
      async input => await world.reviews.listReviews(world.fixture.ctx, input as never));
    expect(report.redriveGoals).toEqual([{
      goalRef: { aggregateType: 'Goal', projectId: WORKSPACE_SCOPE.projectId, goalId: GOAL_B.goalId },
      scope: { ...WORKSPACE_SCOPE }, taskIds: ['k3-20-a', 'k3-20-b'] }]);
  });

  it.each(['memory', 'sqlite'] as const)('K3-29 (%s): an inactive Goal is not handed off even with an open record', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    await pendingRecord(world, 'k3-20-a', 'inactive');
    const paused = await pauseGoalB(world);
    expect(paused.desiredState).toBe('paused');
    const { report } = await reconcile(world, [paused],
      async input => await world.reviews.listReviews(world.fixture.ctx, input as never));
    expect(report.reviews).toHaveLength(1);
    expect(report.redriveGoals).toEqual([]);
  });
});
