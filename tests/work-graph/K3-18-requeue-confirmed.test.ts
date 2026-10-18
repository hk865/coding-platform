/**
 * K3-18 (一) (L22): an applied card disposition confirms the one automatic
 * requeue of the original Run (`requeueConfirmed`), so the every_step
 * `system_requeue` confirmation card is suppressed. A record auto-settled with
 * no disposition still gets that ordinary confirmation card.
 *
 * The facts come from the real Task projection (`queryTaskGraph`) and the real
 * `goal-decision-reader`. The pure policy rows moved to
 * `K3-18-requeue-confirmed-pure.test.ts` (F-046); this file keeps the real
 * record/task/reader state assertions on both backends.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreRejection, WriteResult } from '../../src/contracts/core/results.js';
import type { DecisionSelectionV1 } from '../../src/contracts/goal-decisions.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { setGoalControlFromHost } from '../../src/core/work-graph/tasks/goal-control.js';
import { readGoalPhase } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createGoalDecisionCauseReader } from '../../src/core/work-graph/tasks/goal-decision-reader.js';
import { requeueConfirmedByReview } from '../../src/core/work-graph/state/task-failure.js';
import {
  createK3NeedsDecisionRecord, openK3ReviewCardWorld, type K3ReviewCardWorld,
} from '../helpers/K3-review-card-fixture.js';
import { GOAL_B, PLAN_B2, T, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';
import { readToolSeam, shellSeam } from '../helpers/K3-tool-seams.js';

// The auto-settled record is a REAL Run whose one read-only call is held by the
// §5.1 blocking seam; the mock is per test file, so this file owns it.
const readSeams = vi.hoisted(() => ({
  readToolSeam: undefined as unknown as typeof import('../helpers/K3-tool-seams.js').readToolSeam,
  shellSeam: undefined as unknown as typeof import('../helpers/K3-tool-seams.js').shellSeam,
}));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js')>();
  return { ...actual,
    createReadToolDefinition: (workspace: Parameters<typeof actual.createReadToolDefinition>[0]) =>
      readSeams.readToolSeam.enabled ? readSeams.readToolSeam.definition() : actual.createReadToolDefinition(workspace) };
});
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]) =>
    readSeams.shellSeam.definition(actual.createShellToolDefinition, sandboxArg) };
});
readSeams.readToolSeam = readToolSeam;
readSeams.shellSeam = shellSeam;
afterEach(() => { readToolSeam.release(); shellSeam.release(); });

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

async function cardOf(world: K3ReviewCardWorld, record: UnknownCallReviewV1) {
  const page = await world.cardSource.readPage(world.fixture.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
    page: { limit: 100 } });
  if (page.status !== 'ready') throw new Error(`the card page failed: ${JSON.stringify(page)}`);
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  const card = page.value.items.find(item => item.source.key === key);
  if (card === undefined) throw new Error(`the card ${key} is not on the source page`);
  return card;
}

async function setEveryStep(world: K3ReviewCardWorld): Promise<void> {
  const ctx = world.fixture.ctx;
  const goal = await world.fixture.b2.base.plans.queryGoal(ctx, GOAL_B);
  expect(goal).toMatchObject({ status: 'ready' });
  if (goal.status !== 'ready') throw new Error('the Goal must be readable');
  let sequence = 0;
  const settings = createGoalSettingsService({ records: world.records, now: () => T,
    newId: () => `k3-18-requeue-settings-${String(++sequence)}`, operatorActor: world.fixture.operatorActor });
  const changed = await settings.setGoalSettings(ctx, {
    input: { goalRef: GOAL_B, autonomy: 'every_step', waitForGoalRef: null },
    meta: { requestId: 'k3-18-requeue-every-step',
      expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] },
  });
  expect(changed).toMatchObject({ status: 'committed' });
}

/** The real Host `goals/control` pause at the Goal and GoalPhase revisions read now. */
async function pauseGoal(world: K3ReviewCardWorld): Promise<void> {
  const goal = await world.fixture.b2.base.plans.queryGoal(world.fixture.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error('the Goal must be readable');
  const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: GOAL_B.projectId, goalId: GOAL_B.goalId };
  const phase = await readGoalPhase(world.records, phaseRef);
  if (phase.status !== 'ready') throw new Error('the GoalPhase must be readable');
  let sequence = 0;
  const paused = await setGoalControlFromHost({ records: world.records, now: () => T,
    eventId: () => `k3-18-requeue-control-${String(++sequence)}` }, world.fixture.ctx, {
    input: { goalRef: GOAL_B, control: 'pause', reason: null },
    meta: { requestId: 'k3-18-requeue-pause', expected: [
      { ref: GOAL_B, revision: goal.value.goal.revision },
      { ref: phaseRef, revision: phase.snapshot?.revision ?? 0 },
    ] },
  });
  expect(paused).toMatchObject({ status: 'committed', value: { desiredState: 'paused' } });
}

async function taskRow(world: K3ReviewCardWorld, taskId: string) {
  const read = await world.fixture.b2.base.plans.queryTaskGraph(world.fixture.ctx, {
    goalRef: GOAL_B, planRef: PLAN_B2 });
  expect(read).toMatchObject({ status: 'ready' });
  if (read.status !== 'ready') throw new Error('the Task graph must read');
  const row = read.value.tasks.find(task => task.ref.taskId === taskId);
  if (row === undefined) throw new Error('the original Task must be in the graph');
  return row;
}

async function confirmationCauses(world: K3ReviewCardWorld) {
  const reader = createGoalDecisionCauseReader({ records: world.records, plans: world.fixture.b2.base.plans });
  const read = await reader.readGoalDecisionCauses(world.fixture.ctx, { goalRef: GOAL_B });
  expect(read).toMatchObject({ status: 'ready' });
  if (read.status !== 'ready') throw new Error('the decision causes must read');
  return read.value.filter(cause => cause.code === 'automation_confirmation_required');
}

describe('K3-18 (一) requeue confirmed by an applied card disposition', () => {
  it.each(['memory', 'sqlite'] as const)('K3-18 (一) (%s): rerun_as_is confirms the original Run and suppresses the every_step confirmation card', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    await setEveryStep(world);
    const record = await createK3NeedsDecisionRecord(world, 'k3-20-a');
    const card = await cardOf(world, record);
    const applied = await world.decisionActions.resolveDecision(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId: 'rerun_as_is' } as DecisionSelectionV1,
        text: 'run it again', annotations: [] },
      meta: { requestId: 'k3-18-requeue-rerun', expected: card.source.pins },
    });
    expect(applied).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    if (applied.status !== 'ready') return;
    const action = applied.value.action as WriteResult<UnknownCallReviewV1> | CoreRejection | null;
    if (action === null || action.status !== 'committed') throw new Error('the disposition must commit');
    expect(action.value).toMatchObject({ status: 'resolved', disposition: { choice: 'rerun_as_is', source: 'card' } });
    expect(requeueConfirmedByReview(action.value)).toBe(true);

    const row = await taskRow(world, record.task.taskId);
    expect(row.failure?.unknownCallReview).toEqual({ status: 'resolved', hold: null, requeueConfirmed: true });
    // The real reader therefore derives no `system_requeue` card.
    expect((await confirmationCauses(world)).filter(cause => cause.action === 'system_requeue')).toEqual([]);
    // The paused-Goal read path: the shared confirmation derivation still
    // derives no cause because the disposition confirmed this requeue.
    await pauseGoal(world);
    const pausedRow = await taskRow(world, record.task.taskId);
    expect(pausedRow.failure?.unknownCallReview).toMatchObject({ status: 'resolved',
      requeueConfirmed: true });
    expect(await confirmationCauses(world)).toEqual([]);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('K3-18 (一) (%s): an auto-settled record with no disposition still gets the ordinary confirmation card', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    await setEveryStep(world);
    const record = await createK3NeedsDecisionRecord(world, 'k3-20-a', { autoSettled: true });
    expect(record).toMatchObject({ status: 'resolved', disposition: null, decisionReasons: [] });
    expect(requeueConfirmedByReview(record)).toBe(false);

    const row = await taskRow(world, record.task.taskId);
    expect(row.failure?.unknownCallReview).toEqual({ status: 'resolved', hold: null, requeueConfirmed: false });
    const causes = await confirmationCauses(world);
    expect(causes.map(cause => cause.action)).toEqual(['system_requeue']);
    expect(causes[0]?.code).toBe('automation_confirmation_required');
  }, 120_000);
});
