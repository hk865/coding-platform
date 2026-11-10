import { afterAll, describe, expect, it } from 'vitest';
import { click } from './helpers/E3N-interact.js';
import {
  bootDecide, callsOf, checkBoxes, count, hostTarget, isOff, openCardWith, opened, quiet, settle, stepConfirm, toggleBox,
  typeInto, writeOf, type E3DLog,
} from './helpers/E3D-page.js';
import { openBudgetWorld, openCapWorld, openDeferredWorld } from './helpers/E3D-world.js';
import { cleanupScenarios, type HostScenario } from '../scenarios/harness.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { BootedPage } from './helpers/boot-page.js';

/**
 * E3D-5 D20, D23, D27, D21, D36, D37 (test sheet §2.3): the card actions that
 * change the adopted Plan through `plans/propose` + `plans/apply`. The cards
 * that carry them in a public Host world: the C8 cap card (延后任务, 添加修复任务),
 * the deferred required Task's card (恢复任务; the person deferred it through
 * the public `plans/propose` + `plans/apply` first) and the budget-exhausted
 * card (取消任务); each W3 world is its own Host scenario (X9), so no row
 * starts from another row's write. The fix step's failing check is the cap world's registered check
 * `ag2b-static`; the failed Task `ag2b-work` is assigned to `builder`.
 */

const scenarios = new Map<string, HostScenario>();

afterAll(async () => {
  await cleanupScenarios();
});

async function scenario(name: string, open: () => Promise<HostScenario>): Promise<HostScenario> {
  const found = scenarios.get(name);
  if (found !== undefined) return found;
  const made = await open();
  scenarios.set(name, made);
  return made;
}

type PlanRead = { planId: string; planRevision: number; tasks: Array<Record<string, unknown>>;
  obligations: Array<{ taskIds: string[] }> };

async function activePlan(h: HostScenario): Promise<PlanRead> {
  const read = await h.answer('tasks/query', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF })) as { value?: { plan?: PlanRead } };
  if (read.value?.plan === undefined) throw new Error(`E3D: the Goal has no adopted Plan: ${JSON.stringify(read)}`);
  return read.value.plan;
}

/** The snapshot-only fields a draft must not carry (sheet D20). */
const SNAPSHOT_ONLY = ['ref', 'revision', 'goalRef', 'acceptedAt', 'effectiveCompletionPolicy',
  'effectiveArchitectureBaseline', 'taskStateBasis', 'dispositionRecord'];

type Sent = { draft: Record<string, unknown>; reason: { text?: string; sources?: unknown[]; affectedTaskIds?: string[] } };

function proposed(log: E3DLog): Sent {
  return writeOf(callsOf(log, 'plans/propose')[0]!).input as unknown as Sent;
}

function taskOf(draft: Record<string, unknown>, taskId: string): Record<string, unknown> | undefined {
  return (draft['tasks'] as Array<Record<string, unknown>> | undefined)?.find((task) => task['taskId'] === taskId);
}

function status(log: E3DLog, route: string): string | undefined {
  return (callsOf(log, route).at(-1)?.reply as { status?: string } | undefined)?.status;
}

/** The two writes, in order: one propose, then one apply. */
async function bothWrites(log: E3DLog): Promise<void> {
  await settle(() => callsOf(log, 'plans/apply').some((call) => call.reply !== undefined), 8_000);
  await quiet(log);
}

/** A draft's own fields: a new id, the next revision, nothing only a snapshot carries. */
function expectDraftOf(sent: Sent, plan: PlanRead): void {
  expect(sent.draft['planId']).not.toBe(plan.planId);
  expect(sent.draft['planRevision']).toBe(plan.planRevision + 1);
  const keys = [...Object.keys(sent.draft),
    ...((sent.draft['tasks'] as Array<Record<string, unknown>> | undefined) ?? []).flatMap((task) => Object.keys(task))];
  expect(keys.filter((key) => SNAPSHOT_ONLY.includes(key))).toEqual([]);
}

function expectOrder(log: E3DLog): void {
  const routes = log.calls.map((call) => call.route).filter((route) => route === 'plans/propose' || route === 'plans/apply');
  expect(routes).toEqual(['plans/propose', 'plans/apply']);
  expect(status(log, 'plans/propose')).toBe('committed');
  expect(status(log, 'plans/apply')).toBe('committed');
}

async function openStep(page: BootedPage, label: string): Promise<void> {
  const action = await openCardWith(page.root, label);
  expect(action).toBeDefined();
  click(action!);
  await settle(() => stepConfirm(page.root) !== undefined, 1_000);
}

/** A direct action may still ask once; confirm it when a step opens. */
async function actAndConfirm(page: BootedPage, label: string): Promise<void> {
  const action = await openCardWith(page.root, label);
  expect(action).toBeDefined();
  click(action!);
  if (await settle(() => stepConfirm(page.root) !== undefined, 800)) click(stepConfirm(page.root)!);
}

const FIX_NAME = '修 gate 检查';
const FIX_SENTENCE = '修 gate 检查：让失败的检查 ag2b-static 通过';

describe('E3D-5 the Plan changes a card makes', () => {
  it('D36 an empty fix name keeps the confirm off', async () => {
    const h = await scenario('fix', openCapWorld);
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      await openStep(page, '添加修复任务');
      expect(stepConfirm(page.root)).toBeDefined();
      typeInto(page.root, 'dc-name', '');
      /* 具名改坏: 空名称也发；D36 的零请求红。 */
      expect(isOff(stepConfirm(page.root))).toBe(true);
      const before = await quiet(log);
      click(stepConfirm(page.root)!);
      expect(await quiet(log)).toBe(before);
      expect(count(log, 'plans/propose')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D37 unticking every failing check keeps the confirm off until one is ticked again', async () => {
    const h = await scenario('fix', openCapWorld);
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      await openStep(page, '添加修复任务');
      typeInto(page.root, 'dc-name', FIX_NAME);
      const boxes = checkBoxes(page.root);
      expect(boxes.map((entry) => entry.text).some((text) => text.includes('ag2b-static'))).toBe(true);
      for (const entry of checkBoxes(page.root)) if (entry.box.checked || entry.box.getAttribute('checked') === 'true') toggleBox(entry.box);
      await settle(() => isOff(stepConfirm(page.root)), 500);
      /* 具名改坏: 允许一项都不勾；D37 的零请求红。 */
      expect(isOff(stepConfirm(page.root))).toBe(true);
      const before = await quiet(log);
      click(stepConfirm(page.root)!);
      expect(await quiet(log)).toBe(before);
      expect(count(log, 'plans/propose')).toBe(0);
      const again = checkBoxes(page.root).find((entry) => entry.text.includes('ag2b-static'));
      expect(again).toBeDefined();
      toggleBox(again!.box);
      await settle(() => !isOff(stepConfirm(page.root)), 500);
      expect(isOff(stepConfirm(page.root))).toBe(false);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D21 添加修复任务 adds one required work Task assigned like the failed one and joins its obligation', async () => {
    const h = await scenario('fix', openCapWorld);
    const plan = await activePlan(h);
    const reportRef = (await h.taskRow(AG2B_WORK_TASK_ID)).failure?.round?.failingChecks[0]?.reportRef ?? null;
    expect(reportRef).not.toBeNull();
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      await openStep(page, '添加修复任务');
      typeInto(page.root, 'dc-name', FIX_NAME);
      click(stepConfirm(page.root)!);
      await bothWrites(log);
      /* 具名改坏: 新任务不带 `assignments`；owner 回 `incomplete`/`missing_task_assignment`，D21 的 `committed` 红。 */
      expectOrder(log);
      const sent = proposed(log);
      expectDraftOf(sent, plan);
      const known = new Set(plan.tasks.map((task) => task['taskId']));
      const added = (sent.draft['tasks'] as Array<Record<string, unknown>>).filter((task) => !known.has(task['taskId']));
      expect(added).toHaveLength(1);
      const fix = added[0]!;
      const fixId = fix['taskId'] as string;
      expect(fix).toMatchObject({ taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending',
        title: FIX_NAME, scope: { kind: 'goal' }, executionIntent: 'request_execution' });
      expect(Object.keys(fix).filter((key) => key === 'stageId' || key === 'plannedFiles')).toEqual([]);
      const assignments = (sent.draft['assignments'] as Array<Record<string, unknown>>).filter((entry) => entry['taskId'] === fixId);
      expect(assignments).toEqual([{ taskId: fixId, role: 'builder', instruction: FIX_SENTENCE }]);
      expect(sent.reason.text).toBe('修 gate 检查：让失败的检查 ag2b-static 通过');
      expect(sent.reason.sources).toEqual([reportRef]);
      const carrying = plan.obligations.filter((obligation) => obligation.taskIds.includes(AG2B_WORK_TASK_ID));
      const sentObligations = sent.draft['obligations'] as Array<{ taskIds: string[] }>;
      expect(sentObligations.filter((obligation) => obligation.taskIds.includes(fixId)).map((obligation) => obligation.taskIds))
        .toEqual(carrying.map((obligation) => [...obligation.taskIds, fixId]));
      expect(JSON.stringify(sent.draft['executionDag'] ?? null)).not.toContain(fixId);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D20 延后任务 proposes a new Plan revision with the Task deferred and adopts it', async () => {
    const h = await scenario('defer', openCapWorld);
    const plan = await activePlan(h);
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      await openStep(page, '延后任务');
      click(stepConfirm(page.root)!);
      await bothWrites(log);
      /* 具名改坏: 把整份 `plan` 快照原样当草稿（带 `ref`、`planId` 不变）；Host 回 `invalid`，D20 的 `committed` 红。 */
      expectOrder(log);
      const sent = proposed(log);
      expectDraftOf(sent, plan);
      expect(taskOf(sent.draft, AG2B_WORK_TASK_ID)?.['disposition']).toBe('deferred');
      expect(sent.reason.affectedTaskIds).toContain(AG2B_WORK_TASK_ID);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D27 恢复任务 on the deferred Task sets it active again', async () => {
    const h = await scenario('restore', openDeferredWorld);
    const plan = await activePlan(h);
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      await actAndConfirm(page, '恢复任务');
      await bothWrites(log);
      /* 具名改坏: 恢复发 `deferred`；D27 的 `active` 红。 */
      expectOrder(log);
      const sent = proposed(log);
      expectDraftOf(sent, plan);
      expect(taskOf(sent.draft, AG2B_WORK_TASK_ID)?.['disposition']).toBe('active');
      expect(sent.reason.affectedTaskIds).toContain(AG2B_WORK_TASK_ID);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D23 取消任务 proposes the Task cancelled with no replacement', async () => {
    const h = await scenario('cancel', openBudgetWorld);
    const plan = await activePlan(h);
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      await openStep(page, '取消任务');
      click(stepConfirm(page.root)!);
      await bothWrites(log);
      /* 具名改坏: 取消也发 `deferred`；D23 的 `disposition` 红。 */
      expectOrder(log);
      const sent = proposed(log);
      expectDraftOf(sent, plan);
      const task = taskOf(sent.draft, AG2B_WORK_TASK_ID);
      expect(task?.['disposition']).toBe('cancelled');
      expect(Object.keys(task ?? {})).not.toContain('replacedByTaskId');
      expect(sent.reason.affectedTaskIds).toContain(AG2B_WORK_TASK_ID);
    } finally {
      await page.restore();
    }
  }, 120_000);
});
