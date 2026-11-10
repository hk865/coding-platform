import { afterAll, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import { descendants, hasClass } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { e3gCardPins, openE3GW1, type E3GWorld } from './helpers/E3G-world.js';
import {
  bootDecide, callsOf, card, cardButton, count, hostTarget, isOff, openCardWith, opened, pinSet, quiet, sectionNames,
  sectionRows, settle, stepConfirm, typeInto, worldTarget, writeOf, type E3DLog,
} from './helpers/E3D-page.js';
import {
  openBudgetWorld, openCapWorld, openInterruptedWorld, openReverifyWorld, openUnknownWorld, taskCardOf,
} from './helpers/E3D-world.js';
import { cleanupScenarios, type HostScenario } from '../scenarios/harness.js';
import { AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3D-4 D30, D30b, D22, D24, D34, D35, D35b, D26, D25 (test sheet §2.3): the
 * card writes that are one route each. W1 is the E3G conflict world; the W3
 * worlds are Host scenarios (X9), one per stop reason: the C8 cap, the SMK3b
 * Goal interruption after a restart with the start-up position `ask` (lead
 * 11-10: D24's 继续 starts the Goal's driver, `workflow/driver-start`), a Run
 * that used up the AG2b grant (its budget, the Host's Work Run cap of 400M
 * tokens, is the minimum), a check that times out on an unchanged workspace (no
 * new basis on the re-verification), and the S2C-K missing Kernel (outcome
 * unknown). Every expected pin is the card's own `source.pins` as a public
 * `decisions/queue` read returns it.
 */

let w1: E3GWorld | null = null;
const scenarios = new Map<string, HostScenario>();

afterAll(async () => {
  await w1?.world.close();
  await cleanupScenarios();
});

async function worldW1(): Promise<E3GWorld> {
  w1 ??= await openE3GW1();
  return w1;
}

async function scenario(name: string, open: () => Promise<HostScenario>): Promise<HostScenario> {
  const found = scenarios.get(name);
  if (found !== undefined) return found;
  const made = await open();
  scenarios.set(name, made);
  return made;
}

function conflictOptions(root: FakeElement): FakeElement[] {
  return descendants(card(root) ?? root).filter((element) => element.tagName.toLowerCase() === 'button'
    && hasClass(element, 'opt-top'));
}

/** The last answer of `route` the page got, as the Host returned it. */
function replyOf(log: E3DLog, route: string): { status?: string; code?: string; value?: Record<string, unknown> } {
  return (callsOf(log, route).at(-1)?.reply ?? {}) as { status?: string; code?: string; value?: Record<string, unknown> };
}

function without(pins: readonly { ref: unknown }[], type: string): unknown[] {
  return pins.filter((pin) => (pin.ref as { aggregateType?: string }).aggregateType !== type);
}

describe('E3D-4 the one-route card writes', () => {
  it('D30b 确定 stays off until an option is picked', async () => {
    const world = await worldW1();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      click(sectionRows(page.root, '要决定')[0]!);
      await settle(() => card(page.root) !== undefined, 2_000);
      const go = cardButton(page.root, '确定');
      expect(go).toBeDefined();
      expect(isOff(go)).toBe(true);
      const before = await quiet(log);
      click(go!);
      /* 具名改坏: 未选也发 `{kind:'option',optionId:''}`；D30b 的零请求红。 */
      expect(await quiet(log)).toBe(before);
      expect(count(log, 'decisions/answer')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D30 waiting for the earlier Goal answers with the conflict selection and the card\'s pins', async () => {
    const world = await worldW1();
    const pins = await e3gCardPins(world.world);
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      click(sectionRows(page.root, '要决定')[0]!);
      await settle(() => card(page.root) !== undefined, 2_000);
      expect(conflictOptions(page.root)).toHaveLength(3);
      click(conflictOptions(page.root)[0]!);
      await settle(() => conflictOptions(page.root)[0]?.getAttribute('aria-checked') === 'true', 800);
      click(cardButton(page.root, '确定')!);
      await settle(() => callsOf(log, 'decisions/answer').some((call) => call.reply !== undefined), 5_000);
      await quiet(log);
      expect(count(log, 'decisions/answer')).toBe(1);
      const sent = writeOf(callsOf(log, 'decisions/answer')[0]!);
      /* 具名改坏: `selection` 发普通 `{kind:'option', optionId:'wait'}`；D30 的 `committed` 和“待处理没有”红。 */
      expect(sent.input['selection']).toEqual({ kind: 'conflict_wait', earlier: world.world.goals.first, later: world.world.goals.second });
      expect(sent.input['text']).toBe('');
      expect(sent.input['annotations']).toEqual([]);
      expect(pinSet(sent.meta.expected)).toEqual(pinSet(pins));
      expect((replyOf(log, 'decisions/answer').value?.['answer'] as { status?: string } | undefined)?.status).toBe('committed');
      expect(sectionNames(page.root)).not.toContain('要决定');
      const done = descendants(page.root).find((element) => element.getAttribute('role') === 'tab'
        && (element.textContent ?? '').trim().startsWith('已处理'));
      click(done!);
      await settle(() => sectionNames(page.root).includes('已处理'), 3_000);
      await quiet(log);
      /* W1 的已处理：两张已采用计划的候选卡加这张冲突卡。 */
      expect(sectionRows(page.root, '已处理')).toHaveLength(3);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D34 an empty reason keeps 确认重新入队 off', async () => {
    const h = await scenario('cap', openCapWorld);
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const requeue = await openCardWith(page.root, '重新入队');
      expect(requeue).toBeDefined();
      click(requeue!);
      await settle(() => stepConfirm(page.root) !== undefined, 1_000);
      const confirm = stepConfirm(page.root);
      expect(confirm).toBeDefined();
      typeInto(page.root, 'dc-reason', '');
      /* 具名改坏: 空原因也发；D34 的零请求红。 */
      expect(isOff(stepConfirm(page.root))).toBe(true);
      const before = await quiet(log);
      click(stepConfirm(page.root)!);
      expect(await quiet(log)).toBe(before);
      expect(count(log, 'tasks/requeue')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D22 重新入队 sends the card\'s Task, Run and the Goal and Run pins, and the card goes', async () => {
    const h = await scenario('cap', openCapWorld);
    const taskCard = await taskCardOf(h, AG2B_WORK_TASK_ID);
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const rowsBefore = sectionRows(page.root, '要决定').length;
      const requeue = await openCardWith(page.root, '重新入队');
      expect(requeue).toBeDefined();
      click(requeue!);
      await settle(() => stepConfirm(page.root) !== undefined, 1_000);
      typeInto(page.root, 'dc-reason', '先看 lint');
      click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'tasks/requeue').some((call) => call.reply !== undefined), 5_000);
      await quiet(log);
      expect(count(log, 'tasks/requeue')).toBe(1);
      const sent = writeOf(callsOf(log, 'tasks/requeue')[0]!);
      expect(sent.input['taskRef']).toEqual(taskCard.taskRef);
      expect(sent.input['afterRunRef']).toEqual(taskCard.runRef);
      expect(sent.input['reason']).toBe('先看 lint');
      expect(sent.input['budget']).toBeUndefined();
      /* 具名改坏: `meta.expected` 带 Task 项；Host 回 `invalid`，D22 的 `committed` 红。 */
      expect(pinSet(sent.meta.expected)).toEqual(pinSet(without(taskCard.source.pins, 'Task')));
      expect(replyOf(log, 'tasks/requeue').status).toBe('committed');
      expect(replyOf(log, 'tasks/requeue').value?.['kind']).toBe('requeued');
      expect(sectionRows(page.root, '要决定').length).toBeLessThan(rowsBefore);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D24 继续 on the Goal interruption starts the Goal\'s driver, and the card goes', async () => {
    const h = await scenario('interrupted', openInterruptedWorld);
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const resume = await openCardWith(page.root, '继续');
      expect(resume).toBeDefined();
      click(resume!);
      if (await settle(() => stepConfirm(page.root) !== undefined, 800)) click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'workflow/driver-start').some((call) => call.reply !== undefined), 5_000);
      await settle(() => sectionRows(page.root, '要决定').length === 0, 10_000);
      await quiet(log);
      /* 具名改坏: 继续改走 `tasks/requeue`（说明书原来的接法）；D24 的 `workflow/driver-start` 1 次红。 */
      expect(count(log, 'workflow/driver-start')).toBe(1);
      const advance = (callsOf(log, 'workflow/driver-start')[0]!.input as { advance?: Record<string, unknown> }).advance;
      expect(advance?.['kind']).toBe('select_work');
      expect(advance?.['goalRef']).toEqual({ aggregateType: 'Goal', projectId: 'ag2b-collab-project', goalId: 'ag2b-goal' });
      expect(replyOf(log, 'workflow/driver-start').status).toBe('ready');
      expect(count(log, 'tasks/requeue')).toBe(0);
      expect(count(log, 'controls/submit')).toBe(0);
      /* The world's one card was the interruption: after the driver starts the reread shows none. */
      expect(sectionRows(page.root, '要决定')).toHaveLength(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D35 the budget hint names the last budget and that budget again keeps the confirm off', async () => {
    const h = await scenario('budget', openBudgetWorld);
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const requeue = await openCardWith(page.root, '重新入队');
      expect(requeue).toBeDefined();
      click(requeue!);
      await settle(() => stepConfirm(page.root) !== undefined, 1_000);
      typeInto(page.root, 'dc-reason', '先看预算');
      typeInto(page.root, 'dc-budget', '400000K');
      const hint = findClass(card(page.root)!, 'dc-row2');
      expect((hint?.textContent ?? '').trim()).toContain('要大于上次的 400000K');
      /* 具名改坏: 不比较最小值，上次的预算也发；D35 的零请求红。 */
      expect(isOff(stepConfirm(page.root))).toBe(true);
      const before = await quiet(log);
      click(stepConfirm(page.root)!);
      expect(await quiet(log)).toBe(before);
      expect(count(log, 'tasks/requeue')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D35b a larger budget is sent in tokens', async () => {
    const h = await scenario('budget', openBudgetWorld);
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const requeue = await openCardWith(page.root, '重新入队');
      expect(requeue).toBeDefined();
      click(requeue!);
      await settle(() => stepConfirm(page.root) !== undefined, 1_000);
      typeInto(page.root, 'dc-reason', '先看预算');
      typeInto(page.root, 'dc-budget', '500M');
      click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'tasks/requeue').some((call) => call.reply !== undefined), 5_000);
      await quiet(log);
      expect(count(log, 'tasks/requeue')).toBe(1);
      /* 具名改坏: 把 `500M` 发成 `500`；D35b 的 `tokenBudget` 红。 */
      expect(writeOf(callsOf(log, 'tasks/requeue')[0]!).input['budget']).toEqual({ tokenBudget: 500_000_000, deadline: null });
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D26 附上说明作为新依据 re-verifies the stopped round with the note and its one round pin', async () => {
    const h = await scenario('reverify', openReverifyWorld);
    const row = await h.taskRow(AG2B_WORK_TASK_ID);
    const round = row.failure?.round;
    expect(round).toBeTruthy();
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const note = await openCardWith(page.root, '附上说明作为新依据');
      expect(note).toBeDefined();
      click(note!);
      await settle(() => stepConfirm(page.root) !== undefined, 1_000);
      typeInto(page.root, 'dc-note', '报告改到 reports/');
      click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'verification/reverify').some((call) => call.reply !== undefined), 5_000);
      await quiet(log);
      expect(count(log, 'verification/reverify')).toBe(1);
      const sent = writeOf(callsOf(log, 'verification/reverify')[0]!);
      expect(sent.input['predecessorRoundRef']).toEqual(round!.roundRef);
      expect(sent.input['note']).toBe('报告改到 reports/');
      /* 具名改坏: 少发 `meta.expected` 或发两项；Host 回 `invalid`，D26 的 `committed` 红。 */
      expect(sent.meta.expected).toEqual([{ ref: round!.roundRef, revision: round!.revision }]);
      expect(replyOf(log, 'verification/reverify').status).toBe('committed');
      expect(replyOf(log, 'verification/reverify').value?.['kind']).toBe('reverified');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D25 核对未知结果 sends the Run, the person\'s judgement and only the Run pin', async () => {
    const h = await scenario('unknown', openUnknownWorld);
    const taskCard = await taskCardOf(h, AG2B_WORK_TASK_ID);
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const attest = await openCardWith(page.root, '核对未知结果');
      expect(attest).toBeDefined();
      click(attest!);
      await settle(() => stepConfirm(page.root) !== undefined, 1_000);
      typeInto(page.root, 'dc-reason', '看过 catalog-service.ts 的改动，按中断处理');
      click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'executions/resolve-unknown').some((call) => call.reply !== undefined), 5_000);
      await quiet(log);
      expect(count(log, 'executions/resolve-unknown')).toBe(1);
      const sent = writeOf(callsOf(log, 'executions/resolve-unknown')[0]!);
      expect(sent.input['runRef']).toEqual(taskCard.runRef);
      expect(sent.input['reason']).toBe('看过 catalog-service.ts 的改动，按中断处理');
      /* 具名改坏: 页面自己拼 `kernelTurnOpen`；D25 的“不在请求体里”红。 */
      expect(Object.keys(sent.input).filter((key) => ['kernelTurnOpen', 'inputsConfirmed', 'review'].includes(key))).toEqual([]);
      expect(pinSet(sent.meta.expected)).toEqual(pinSet(taskCard.source.pins.filter((pin) =>
        (pin.ref as { aggregateType?: string }).aggregateType === 'Run')));
      expect(replyOf(log, 'executions/resolve-unknown').status).toBe('committed');
    } finally {
      await page.restore();
    }
  }, 120_000);
});
