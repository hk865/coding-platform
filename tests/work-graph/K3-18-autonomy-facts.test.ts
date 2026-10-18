/**
 * K3-18 (二)(三)(五) at the owner level: the autonomy level and the "no second
 * confirmation card" rule of L22. It drives the real `goal-decision-reader`
 * (`readGoalDecisionCauses`) over the real Plan service `queryTaskGraph` and a
 * real review record produced by the shared public steps, on memory and SQLite:
 * `openK3ReviewCardWorld(kind)` + `openRealRunHarness` — the Run is
 * claimed, prepared and started by the production Runtime, the scripted model's
 * one `edit` call is held in flight by §5.1's edit stand-in, and the Host
 * recognition path (RUN-20/RUN-22) reads its real draft. A file-edit call is
 * `compare_in_continuation` (`by: platform`), so the complete inventory settles
 * `resolved` at creation. No item, draft, event or record is hand-built.
 *
 * Session A asserts only the A part: no card / no cause, never card contents.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createGoalDecisionCauseReader } from '../../src/core/work-graph/tasks/goal-decision-reader.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import type { GoalDecisionCauseReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import {
  openK3ReviewCardWorld, type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { GOAL_B, PLAN_B2 } from '../helpers/S5-decision-fixture.js';
import { mixedEditSeam, releaseMixedSeams } from '../helpers/K3-mixed-seams.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-ins hoisted per test file: the real Run's one call is the held
// `edit`; the `shell` mock is the same shared seam wiring every K3 file owns.
const seams = vi.hoisted(() => ({
  shellSeam: undefined as unknown as typeof import('../helpers/K3-tool-seams.js').shellSeam,
  editSeam: undefined as unknown as typeof import('../helpers/K3-mixed-seams.js').mixedEditSeam,
}));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    seams.shellSeam.definition(actual.createShellToolDefinition, sandboxArg) };
});
vi.mock('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js')>();
  return { ...actual,
    createEditToolDefinition: (workspace: Parameters<typeof actual.createEditToolDefinition>[0]): ToolDefinition =>
      seams.editSeam.definition(actual.createEditToolDefinition as never, workspace as never) };
});
seams.shellSeam = shellSeam;
seams.editSeam = mixedEditSeam;

type Fixture = {
  world: K3ReviewCardWorld;
  settings: ReturnType<typeof createGoalSettingsService>;
};

const fixtures: Fixture[] = [];
afterEach(async () => {
  shellSeam.release();
  releaseMixedSeams();
  for (const fixture of fixtures.splice(0)) await fixture.world.close();
});

async function open(kind: 'memory' | 'sqlite'): Promise<Fixture> {
  const world = await openK3ReviewCardWorld(kind);
  let seq = 0;
  const settings = createGoalSettingsService({ records: world.records, now: () => world.fixture.now(),
    newId: () => `k3-18-settings-id-${String(++seq)}`, operatorActor: world.fixture.operatorActor });
  const fixture = { world, settings };
  fixtures.push(fixture);
  return fixture;
}

/**
 * The ONE real file-edit Run of this file: production claim/prepare/runtime
 * start over the shared harness, the §5.1 edit stand-in holding the call, the
 * production RUN-20/RUN-22 read of that Kernel Turn, then the Runtime's own end.
 */
async function fileEditRecord(world: K3ReviewCardWorld, label: string): Promise<UnknownCallReviewV1> {
  const harness = await openRealRunHarness(world);
  const f = world.fixture;
  try {
    const session = await f.createS5Session(`k3-18-edit-${label}`);
    const claim = await harness.claimRun({ sessionRef: session, planRef: PLAN_B2, taskId: 'k3-20-a',
      requestId: `k3-18-edit-claim-${label}` });
    mixedEditSeam.arm();
    const run = await harness.prepareAndStart(claim, {
      model: createScriptedModel([{ kind: 'calls', calls: [{ callId: `k3-18-edit-${label}`, name: 'edit',
        args: { mode: 'replace', path: 'src/a.ts', oldText: 'K3_18_BASELINE', newText: 'K3_18_CHANGED' } }] }]),
      tools: ['write'], writeScope: ['.'], blockOnShell: false,
    });
    try {
      await Promise.race([
        mixedEditSeam.waitForCall(),
        run.started.then(result => {
          throw new Error(`the Run settled before its edit call: ${JSON.stringify(result)}`);
        }, error => { throw error; }),
      ]);
      return await harness.createRecord(claim);
    } finally {
      mixedEditSeam.release();
      await run.started;
    }
  } finally {
    mixedEditSeam.release();
    await harness.closeUnion();
  }
}

async function setAutonomy(f: Fixture, autonomy: 'every_step' | 'after_plan_confirmation'): Promise<void> {
  const goal = await f.world.fixture.b2.base.plans.queryGoal(f.world.fixture.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal read failed: ${JSON.stringify(goal)}`);
  const changed = await f.settings.setGoalSettings(f.world.fixture.ctx, { input: {
    goalRef: GOAL_B, autonomy, waitForGoalRef: null },
    meta: { requestId: `k3-18-autonomy-${autonomy}`,
      expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] } });
  if (changed.status !== 'committed') throw new Error(`the Goal settings write failed: ${JSON.stringify(changed)}`);
}

async function taskRow(f: Fixture, taskId: string): Promise<TaskRow> {
  const read = await f.world.fixture.b2.base.plans.queryTaskGraph(f.world.fixture.ctx, {
    goalRef: GOAL_B, planRef: PLAN_B2 });
  if (read.status !== 'ready') throw new Error(`the Task graph read failed: ${JSON.stringify(read)}`);
  const row = read.value.tasks.find(task => task.ref.taskId === taskId);
  if (row === undefined) throw new Error('the claimed Task must be part of the Task graph');
  return row;
}

async function causes(f: Fixture): Promise<GoalDecisionCauseReadV1[]> {
  const reader = createGoalDecisionCauseReader({ records: f.world.records, plans: f.world.fixture.b2.base.plans });
  const read = await reader.readGoalDecisionCauses(f.world.fixture.ctx, { goalRef: GOAL_B });
  if (read.status !== 'ready') throw new Error(`the decision-cause read failed: ${JSON.stringify(read)}`);
  return read.value;
}

function confirmationCauses(all: readonly GoalDecisionCauseReadV1[]): GoalDecisionCauseReadV1[] {
  return all.filter(cause => cause.code === 'automation_confirmation_required');
}

describe('K3-18 (二) after_plan_confirmation derives no system_requeue card', () => {
  it.each(['memory', 'sqlite'] as const)('K3-18 (二) %s: an auto-settled resolved record under after_plan_confirmation derives no confirmation cause', async kind => {
    const f = await open(kind);
    const record = await fileEditRecord(f.world, 'identity');
    expect(record).toMatchObject({ status: 'resolved', decisionReasons: [], activeRound: null });
    expect(record.items).toHaveLength(1);
    expect(record.items[0]).toMatchObject({ toolName: 'edit', kind: 'file_edit',
      observed: { verdict: 'compare_in_continuation', by: 'platform' } });
    // Default autonomy is after_plan_confirmation.
    const row = await taskRow(f, record.task.taskId);
    expect(row.failure?.automation.verdict).toMatchObject({ kind: 'requeue' });
    expect(row.failure?.unknownCallReview).toMatchObject({ status: 'resolved', hold: null });
    // No review card: an auto-settled record carries no decision reason.
    expect(row.unknownCallReview).toMatchObject({ status: 'resolved', decisionReasons: [] });
    expect(confirmationCauses(await causes(f))).toEqual([]);
  });
});

describe('K3-18 (三) every_step with only file-edit items derives the ordinary card only', () => {
  it.each(['memory', 'sqlite'] as const)('K3-18 (三) %s: no review card, exactly the ordinary system_requeue confirmation', async kind => {
    const f = await open(kind);
    const record = await fileEditRecord(f.world, 'every-step');
    await setAutonomy(f, 'every_step');
    const row = await taskRow(f, record.task.taskId);
    // The record is resolved, so AV-2b / AV-4c do not apply: one ordinary card.
    expect(row.failure?.automation.verdict).toMatchObject({ kind: 'requeue' });
    expect(row.failure?.unknownCallReview).toMatchObject({ status: 'resolved', hold: null });
    expect(row.unknownCallReview).toMatchObject({ status: 'resolved', decisionReasons: [] });
    const confirmations = confirmationCauses(await causes(f));
    expect(confirmations.map(cause => cause.action)).toEqual(['system_requeue']);
  });
});

describe('K3-18 (五) a released "I\'ll handle it" removes the ordinary card', () => {
  it.each(['memory', 'sqlite'] as const)('K3-18 (五) %s: requeueConfirmed removes the system_requeue confirmation cause', async kind => {
    const f = await open(kind);
    const record = await fileEditRecord(f.world, 'released');
    const reviewRef = record.ref;
    // The auto-settled record takes the direct human hold and then the release.
    const held = await f.world.reviews.holdReview(f.world.fixture.ctx, { input: { reviewRef, text: null },
      meta: { requestId: 'k3-18-hold', expected: [{ ref: reviewRef, revision: 1 }] } });
    expect(held).toMatchObject({ status: 'committed', value: { revision: 2,
      disposition: { choice: 'handle_myself', hold: 'held' } } });
    const released = await f.world.reviews.releaseHold(f.world.fixture.ctx, { input: { reviewRef },
      meta: { requestId: 'k3-18-release', expected: [{ ref: reviewRef, revision: 2 }] } });
    expect(released).toMatchObject({ status: 'committed', value: { revision: 3,
      disposition: { choice: 'handle_myself', hold: 'released' } } });
    await setAutonomy(f, 'every_step');
    const row = await taskRow(f, record.task.taskId);
    expect(row.failure?.automation.verdict).toMatchObject({ kind: 'requeue' });
    expect(row.failure?.unknownCallReview).toEqual({ status: 'resolved', hold: 'released', requeueConfirmed: true });
    expect(confirmationCauses(await causes(f))).toEqual([]);
  });
});
