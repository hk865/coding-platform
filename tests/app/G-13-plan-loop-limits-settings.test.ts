/** G-13: the Host setting `plan-loop-limits/save` (slice-PL-SPEC §10.3, PLS-26/C-30).
 * Validation, persistence, the saved/effective/defaults read, rollback and the push; the immediate
 * deviation judgment and the claimed-Run budget read through the real Host. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostSettings, type HostSettingsAssembly, type HostSettingsPrivateSnapshot } from '../../src/app/host-settings.js';
import type { HostSettingsPort, HostSettingsSnapshot } from '../../src/app/host-settings-types.js';
import { deviationsOfGoal } from '../../src/contracts/plan-deviation.js';
import { systemRoundMessageRef } from '../../src/contracts/plan-round.js';
import type { PlanLoopLimitsV1 } from '../../src/contracts/plan-loop-limits.js';
import type { BootstrapResponse } from '../../src/app/core-http-types.js';
import { advanceUntil, cleanupRestart, driveWorkflow, post, readExecution } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readBody } from '../helpers/IV-host-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { openPLDeviationConsumptionWorld } from '../helpers/PL-deviation-fixture.js';
import { usage } from '../helpers/PL-readings-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { openPLTaskbookWorld, twoStageDraft } from '../helpers/PL-taskbook-fixture.js';
import { claimedRunOf, ready, sessionOf } from '../helpers/S7A-fixture.js';

const EMPTY_FILE = { schemaVersion: 1, models: [], selection: {}, workspaces: [] };
const DEFAULTS: PlanLoopLimitsV1 = { schemaVersion: 1,
  taskReminderTokens: { small: 1_000_000, medium: 2_500_000, large: 4_000_000, explore: 4_000_000 },
  taskTwoTimesTokens: { small: 2_000_000, medium: 5_000_000, large: 8_000_000, explore: 8_000_000 },
  lineMultiplier: 2, stageLineBudget: 2_000, stageTokenBudget: 600_000_000 };
const SMALL: PlanLoopLimitsV1 = { schemaVersion: 1,
  taskReminderTokens: { small: 100, medium: 200, large: 300, explore: 400 },
  taskTwoTimesTokens: { small: 200, medium: 400, large: 600, explore: 800 },
  lineMultiplier: 3, stageLineBudget: 50, stageTokenBudget: 900 };

const dirs: string[] = []; const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  await Promise.all(worlds.splice(0).map(world => world.close())); await cleanupRestart(); });

const assembly: HostSettingsAssembly = { listWorkspaces: () => [], secretConfigured: () => false,
  bootstrap: () => ({}) as BootstrapResponse,
  async openWorkspace() { return { status: 'rejected', code: 'unsupported', reason: 'not used by G-13' }; } };

async function openSettingsWorld(file: unknown, failPush = { next: false }): Promise<{
  dir: string; settings: HostSettingsPort; pushed: HostSettingsPrivateSnapshot[];
}> {
  const dir = await mkdtemp(join(tmpdir(), 'g13-settings-')); dirs.push(dir);
  if (file !== undefined) await writeFile(join(dir, 'host-settings.json'), JSON.stringify(file));
  const pushed: HostSettingsPrivateSnapshot[] = [];
  const settings = await createHostSettings({ settingsDirectory: dir, assembly }, { onConfigurationChanged(snapshot) {
    if (failPush.next) { failPush.next = false; throw new Error('the Host could not install the configuration'); }
    pushed.push(snapshot);
  } });
  return { dir, settings, pushed };
}
const publishedLimits = async (settings: HostSettingsPort): Promise<unknown> => {
  const snapshot = await settings.call('snapshot', {});
  return snapshot.status === 'ready' ? snapshot.value.planLoopLimits : snapshot;
};

describe('rejects: plan-loop-limits/save input that is not a complete schema-1 two-table value', () => {
  const invalidValues: [string, unknown][] = [
    ['a missing second table', { ...SMALL, taskTwoTimesTokens: undefined }],
    ['a missing tier', { ...SMALL, taskReminderTokens: { small: 100, medium: 200, large: 300 } }],
    ['a zero stage budget', { ...SMALL, stageTokenBudget: 0 }],
    ['a fractional multiplier', { ...SMALL, lineMultiplier: 1.5 }],
    ['a two-times line below its reminder line', { ...SMALL, taskTwoTimesTokens: { ...SMALL.taskTwoTimesTokens, small: 99 } }],
    ['a multiplier below 1', { ...SMALL, lineMultiplier: 0 }],
  ];
  it.each(invalidValues)('G-13-1 rejects %s, writes nothing and keeps the effective defaults', async (_label, value) => {
    const { dir, settings, pushed } = await openSettingsWorld(EMPTY_FILE);
    const file = join(dir, 'host-settings.json'); const before = await readFile(file, 'utf8');
    const beforePushes = pushed.length;
    expect(await settings.call('plan-loop-limits/save', { planLoopLimits: value as never }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await readFile(file, 'utf8')).toBe(before); expect(pushed).toHaveLength(beforePushes);
    expect(await publishedLimits(settings)).toEqual({ saved: null, effective: DEFAULTS, defaults: DEFAULTS });
  });
});

it('G-13-2 a legal save publishes saved/effective/defaults, a null save removes the key, and both are deep copies', async () => {
  const { dir, settings } = await openSettingsWorld(EMPTY_FILE);
  expect(await settings.call('plan-loop-limits/save', { planLoopLimits: SMALL }))
    .toMatchObject({ status: 'ready', value: { planLoopLimits: { saved: SMALL, effective: SMALL, defaults: DEFAULTS } } });
  const snapshot = ready<HostSettingsSnapshot>(await settings.call('snapshot', {}), 'the G-13-2 snapshot');
  snapshot.planLoopLimits.saved!.taskReminderTokens.small = 1; snapshot.planLoopLimits.defaults.stageLineBudget = 1;
  expect(await publishedLimits(settings)).toEqual({ saved: SMALL, effective: SMALL, defaults: DEFAULTS });
  expect(await settings.call('plan-loop-limits/save', { planLoopLimits: null })).toMatchObject({ status: 'ready' });
  expect(await publishedLimits(settings)).toEqual({ saved: null, effective: DEFAULTS, defaults: DEFAULTS });
  expect(JSON.parse(await readFile(join(dir, 'host-settings.json'), 'utf8'))).not.toHaveProperty('planLoopLimits');
  expect(await settings.call('run-budget/save', { workRunTokenBudget: 500_000_000 })).toMatchObject({ status: 'ready' }); expect(JSON.parse(await readFile(join(dir, 'host-settings.json'), 'utf8'))).not.toHaveProperty('planLoopLimits');
});

it('G-13-3 a failed write answers unavailable, rolls the in-memory value back and pushes nothing', async () => {
  const { dir, settings, pushed } = await openSettingsWorld({ ...EMPTY_FILE, planLoopLimits: SMALL }); const beforePushes = pushed.length;
  await rm(join(dir, 'host-settings.json')); await mkdir(join(dir, 'host-settings.json', 'blocked'), { recursive: true });
  expect(await settings.call('plan-loop-limits/save', { planLoopLimits: null }))
    .toEqual({ status: 'rejected', code: 'unavailable', reason: 'the settings file could not be written' });
  expect(pushed).toHaveLength(beforePushes);
  expect(await publishedLimits(settings)).toEqual({ saved: SMALL, effective: SMALL, defaults: DEFAULTS });
});

it('G-13-4 an unconfirmed push keeps the saved value, asks for the same save again and the retry succeeds', async () => {
  const failPush = { next: false }; const { dir, settings, pushed } = await openSettingsWorld(EMPTY_FILE, failPush);
  const beforePushes = pushed.length; failPush.next = true;
  expect(await settings.call('plan-loop-limits/save', { planLoopLimits: SMALL })).toEqual({ status: 'rejected',
    code: 'unavailable', reason: 'the plan loop limits were saved but the Host configuration was not confirmed; retry the same save' });
  expect(pushed).toHaveLength(beforePushes);
  expect(JSON.parse(await readFile(join(dir, 'host-settings.json'), 'utf8')).planLoopLimits).toEqual(SMALL);
  expect(await publishedLimits(settings)).toEqual({ saved: SMALL, effective: SMALL, defaults: DEFAULTS });
  expect(await settings.call('plan-loop-limits/save', { planLoopLimits: SMALL })).toMatchObject({ status: 'ready' });
  expect(pushed.at(-1)?.planLoopLimits).toEqual(SMALL);
});

it('G-13-5 a stored value loads as saved/effective; a present but invalid one refuses Host startup', async () => {
  const { settings } = await openSettingsWorld({ ...EMPTY_FILE, planLoopLimits: SMALL });
  expect(await publishedLimits(settings)).toEqual({ saved: SMALL, effective: SMALL, defaults: DEFAULTS });
  await expect(openSettingsWorld({ ...EMPTY_FILE, planLoopLimits: { ...SMALL,
    taskTwoTimesTokens: { ...SMALL.taskTwoTimesTokens, small: 1 } } }))
    .rejects.toThrow('the private host settings file could not be loaded');
});

it('G-13-6 a saved plan-loop limit leaves an already claimed Run and the Work Run budget at 400000000', async () => {
  const world = await openS6AHostWorld({ backend: 'memory' }); worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE); await governS6B(world, main, world.goals);
  const goal = world.goals.first; const tasks = (await adoptS6BPlan(main, goal, { label: 'g-13', taskIds: ['g-13-work'], role: S6A_WORK_ROLE.templateId })).tasks;
  const line = await createS6BLine(main, { label: 'g-13-line', role: S6A_WORK_ROLE, tasks: [{ projectId: goal.projectId, goalId: goal.goalId, taskId: tasks[0]!.taskId }] });
  const session = await sessionOf(world, line); await world.scripted.script(session, [{ kind: 'text', text: 'G-13 work done' }]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'g-13-flow', sessionHint: session.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { stopBefore: 'open_checks' });
  const runRef = await main.taskRun(goal, tasks[0]!.taskId); expect(runRef).not.toBeNull();
  expect((await readExecution(world.ag2b, runRef!)).run.budget.tokenBudget).toBe(400_000_000);
  expect(await world.settings('plan-loop-limits/save', { planLoopLimits: SMALL })).toMatchObject({ status: 'ready' });
  expect((await readExecution(world.ag2b, runRef!)).run.budget.tokenBudget).toBe(400_000_000);
  expect(ready<HostSettingsSnapshot>(await world.settings('snapshot', {}), 'the G-13-6 snapshot')
    .workRunTokenBudget).toEqual({ saved: null, effective: 400_000_000, max: 600_000_000 });
}, 150_000);

it('G-13-7 a saved lower two-times line applies to the next judgment and leaves the claimed Run budget alone', async () => {
  // The PL-11 recipe: the real consume Host with an adviser line and a small A.
  const fixture = await openPLDeviationConsumptionWorld({ label: 'g13-eff', taskIds: ['g13-a', 'g13-b'],
    sizes: [{ taskId: 'g13-a', sizeClass: 'small' }], checks: true });
  try {
    const { world, goal, tasks, line } = fixture;
    const a = tasks[0];
    if (a === undefined) throw new Error('G-13: the Plan has no Task A');
    // A is claimed and run before the save, so its budget is the pre-save one.
    await world.scripted.script(line, [{ kind: 'text', text: 'G-13 A does the work', usage: usage(0, 1_200_000) }]);
    const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'g13-eff-a',
      sessionHint: line.ref, kind: 'select_work', taskId: a.taskId }, 'claim_task');
    const receipts: import('../../src/business/workflow/contracts.js').WorkflowStepReceipt[] = [];
    const claimedSteps = await driveWorkflow(world.ag2b, claim, { stopBefore: 'open_checks', receipts });
    const run = claimedRunOf(receipts, a.taskId).run;
    expect((await readExecution(world.ag2b, run)).run.budget.tokenBudget).toBe(400_000_000);

    // The public save lowers the small two-times line; the claimed Run keeps its budget.
    const lowered: PlanLoopLimitsV1 = { ...DEFAULTS,
      taskTwoTimesTokens: { ...DEFAULTS.taskTwoTimesTokens, small: 1_100_000 } };
    expect(await world.settings('plan-loop-limits/save', { planLoopLimits: lowered }))
      .toMatchObject({ status: 'ready' });
    expect((await readExecution(world.ag2b, run)).run.budget.tokenBudget).toBe(400_000_000);

    // Finish the claimed Run, then the next judgment crosses the lowered line.
    const openChecks = claimedSteps.at(-1)?.next;
    if (openChecks === null || openChecks === undefined || openChecks.kind !== 'perform'
      || openChecks.operation.kind !== 'open_checks') throw new Error('G-13: A did not reach open_checks');
    await driveWorkflow(world.ag2b, openChecks);
    const send = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'g13-eff-growth',
      sessionHint: null, kind: 'select_work' }, 'send_system_round');
    if (send.kind !== 'perform' || send.operation.kind !== 'send_system_round') {
      throw new Error('G-13: the selection did not send the growth round');
    }
    expect(send.operation.request.round).toMatchObject({ kind: 'deviation', taskId: a.taskId,
      cause: 'growth', planRevision: 2 });

    // The pure judgment sees the same saved table through `input.limits`: with the
    // defaults A is only at the reminder line; with the saved table it is growth.
    const ctx = fixture.main.humanContext();
    const defaultsJudgment = deviationsOfGoal(await fixture.readDeviationFacts(ctx));
    expect(defaultsJudgment.filter(deviation => deviation.kind === 'growth'
      && deviation.taskRef.taskId === a.taskId)).toHaveLength(0);
    const savedJudgment = deviationsOfGoal(await fixture.readDeviationFacts(ctx, lowered));
    expect(savedJudgment.filter(deviation => deviation.kind === 'growth'
      && deviation.taskRef.taskId === a.taskId)).toMatchObject([{ planRevision: 2,
      runRef: { runId: run.runId } }]);

    // The Host's own system round carries the growth deviation to the adviser.
    ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, send)), 'the growth send');
    const requestId = `deviation:${goal.goalId}:${a.taskId}:growth:2`;
    const ref = systemRoundMessageRef(S6A_SCOPE, requestId);
    if (ref.status !== 'ready') throw new Error('G-13: the growth request id has no message ref');
    const body = await readBody(world, ref.value, 'message');
    expect(body).toContain('(growth)');
    expect(body).toContain('growth: 1200000');
  } finally {
    await fixture.close();
  }
}, 180_000);


it('G-13-8 a saved stage cap changes the stage-end notice judgment and text on a public re-read', async () => {
  // The existing PL-14 stage-end world: real work + stage gate through the
  // public Workflow, then the real `plan_notice` source read by `main/read`.
  const book = await openPLTaskbookWorld({});
  try {
    await book.adopt({ label: 'g13-stage', draft: twoStageDraft(book.goal, 'g13-stage') });
    const work = book.tasks[0]!;
    const gateTask = { projectId: work.projectId, goalId: work.goalId, taskId: 'stage-gate' };
    const line = await createS6BLine(book.main, { label: 'g13-stage', role: S6A_WORK_ROLE,
      tasks: [work, gateTask] });
    const session = await sessionOf(book.world, line);
    await book.world.scripted.script(session, [{ kind: 'text', text: 'G-13 stage work done', usage: usage(100, 0) }]);
    await driveWorkflow(book.world.ag2b, { schemaVersion: 1, goalRef: book.goal,
      flowId: 'g13-stage-work', sessionHint: line.ref, kind: 'select_work', taskId: 'stage-work' });
    await driveWorkflow(book.world.ag2b, { schemaVersion: 1, goalRef: book.goal,
      flowId: 'g13-stage-gate', sessionHint: line.ref, kind: 'select_work' });

    const itemKey = 'stage-end:g13-stage:1:stage-one';
    const summaryOf = async (): Promise<string> => {
      const read = await book.readNotices({ goal: book.goal });
      const item = read.main.find(entry => entry['itemKey'] === itemKey);
      if (item === undefined) throw new Error('G-13: the stage-end notice is missing');
      return String(item['summary']);
    };
    // The construction-time defaults judge the stage at 10 estimated lines and 100 tokens: no over-line text.
    expect(await summaryOf()).not.toContain('阶段线超线');

    // Saving a lower stage line and token cap changes the next public read's judgment and its text.
    const loweredStage: PlanLoopLimitsV1 = { ...DEFAULTS, stageLineBudget: 5, stageTokenBudget: 50 };
    expect(await book.world.settings('plan-loop-limits/save', { planLoopLimits: loweredStage }))
      .toMatchObject({ status: 'ready' });
    const changed = await summaryOf();
    expect(changed).toContain('阶段线超线：预估 10 行 > 5；累计 token 100 > 50');
  } finally {
    await book.close();
  }
}, 240_000);
