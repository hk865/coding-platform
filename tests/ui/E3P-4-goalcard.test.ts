import { afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, callsTo, countRoute, hasClass, quietPage, sentWrite, textOf, waitFor } from './helpers/E3N-page.js';
import { click, notConnected } from './helpers/E3N-interact.js';
import { labelled, typeInto } from './helpers/E3D-page.js';
import { cancelGoal } from './helpers/E3N-world.js';
import { openE3GW0, openE3GW1 } from './helpers/E3G-world.js';
import {
  answerOf, goalCard, goalCardValue, goalbarButton, lineText, openPAW5, planLines, planReady, valueText,
} from './helpers/E3P-world.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3P PA-20/21, PA-22, PA-23 (test sheet e3plan-a-tests §2.4): W5 has no Goal and
 * no pointers; its request without a Goal was answered with one goal card
 * draft (`initial_coordination`, ruling 4). PA-40–PA-43: the goal bar on W3 and
 * W0. Every row opens its own world.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

/** The goal card's 自治档位 control: the menu button of a pending card, or the read-only value. */
function autonomyText(card: FakeElement): string {
  const dd = goalCardValue(card, '自治档位');
  if (dd === undefined) return '';
  return textOf(findElement(dd, (element) => element.getAttribute('aria-haspopup') === 'menu') ?? findClass(dd, 'gc-val'));
}

const PINS = [
  { ref: { aggregateType: 'Goal', projectId: 'ag2b-collab-project', goalId: 'ag2b-goal' }, revision: 1 },
  { ref: { aggregateType: 'GoalPhase', projectId: 'ag2b-collab-project', goalId: 'ag2b-goal' }, revision: 0 },
];

describe('E3P Plan goal card', () => {
  it('PA-20/21 the draft shows its objective, check and autonomy; 范围 and 约束 are not connected', async () => {
    const opened = await openPAW5();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Plan');
    try {
      await planReady(log);
      const card = goalCard(page.root)!;
      expect(card.getAttribute('aria-label')).toBe('目标卡');
      expect(textOf(findClass(card, 'gc-goal'))).toBe('PA goal card');
      /* 具名改坏: 把 `completion` 当范围；`验收`/`—` 两句红。 */
      expect(valueText(goalCardValue(card, '验收'))).toBe('PA check one');
      /* 具名改坏: 自治写“三档之一”；这一句红。 */
      expect(autonomyText(card)).toBe('每一步都等你确认');
      /* 具名改坏: 用 `screening.modules` 填范围；这一句红。 */
      expect(['范围', '约束'].map((name) => valueText(goalCardValue(card, name)))).toEqual(['—', '—']);
      for (const name of ['范围', '约束']) {
        notConnected(findElement(goalCardValue(goalCard(page.root)!, name)!,
          (element) => element.tagName.toLowerCase() === 'button')!);
      }
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('PA-22 确认目标卡 confirms draft 0 of its round and stays on the page without switching Goals', async () => {
    const opened = await openPAW5();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Plan');
    try {
      await planReady(log);
      click(findButton(goalCard(page.root)!, '确认目标卡')!);
      await answerOf(log, 'goals/confirm-draft');
      await waitFor(() => planLines(page.root).length > 0);
      await quietPage(log);
      expect(countRoute(log, 'goals/confirm-draft')).toBe(1);
      const input = callsTo(log, 'goals/confirm-draft')[0]!.input as Record<string, unknown>;
      expect(input['round']).toEqual(opened.round);
      expect(input['index']).toBe(0);
      expect(countRoute(log, 'goals/control')).toBe(0);
      /* 具名改坏: 确认后 `pickGoal(receipt.goal.ref.goalId)` 切到新目标；这一句红。 */
      expect(countRoute(log, 'goals/read')).toBe(0);
      expect(planLines(page.root).map(lineText)).toEqual(['已确认目标卡，自治档位：每一步都等你确认']);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('PA-23 在对话里修改 on the pre-goal card continues that request without a Goal', async () => {
    const opened = await openPAW5();
    worlds.push(opened.world);
    await s6aCardsWorkspace(opened.world, S6A_SCOPE).createGoal('pa-goal', 'PA created goal');
    const { page, log } = await bootE3N(opened.world, 'Plan', { search: '?goal=pa-goal' });
    try {
      await planReady(log);
      click(findButton(goalCard(page.root)!, '在对话里修改')!);
      typeInto(page.root, 'plan-input', '加一条验收');
      click(labelled(page.root, '发送')!);
      await answerOf(log, 'requests/submit');
      await quietPage(log);
      expect(countRoute(log, 'requests/submit')).toBe(1);
      const input = callsTo(log, 'requests/submit')[0]!.input as Record<string, unknown>;
      expect(input['continues']).toEqual(opened.requestRoot);
      /* 具名改坏: 用页面选中目标当 `goalId`；Host 回 `invalid`，这一句红。 */
      expect(input['goalId']).toBeNull();
      expect(countRoute(log, 'plans/propose')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);
});

describe('E3P Plan goal bar', () => {
  it('PA-40 the earlier Goal of the conflict has nothing to decide: no 需要你决定 on its goal bar', async () => {
    const opened = await openE3GW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Plan', { search: '?goal=ag2b-goal' });
    try {
      await planReady(log);
      expect(findClass(page.root, 'goalbar')).toBeDefined();
      /* 具名改坏: 用工作区总数当本目标数；这一句红。 */
      expect(findClass(page.root, 'gb-decide')).toBeUndefined();
      /* 合并方加（lead F8，有 Host 不画样例）。具名改坏: 链接的 title 留原型写死的“在主画面处理：检查不完整判定”；这一句红。 */
      const remote = findElement(page.root, (element) => element.tagName.toLowerCase() === 'a'
        && textOf(findClass(element, 'row-name')) === '需要你决定');
      expect(remote?.getAttribute('title')).toBe('在主画面处理');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('PA-41 暂停 sends goals/control with the Goal and GoalPhase pins', async () => {
    const opened = await openE3GW0();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Plan', { search: '?goal=ag2b-goal' });
    try {
      await planReady(log);
      click(goalbarButton(page.root, '暂停')!);
      const reply = await answerOf(log, 'goals/control');
      expect(countRoute(log, 'goals/control')).toBe(1);
      const sent = sentWrite(callsTo(log, 'goals/control')[0]);
      expect(sent.input['control']).toBe('pause');
      /* 具名改坏: 少发 GoalPhase pin；Host 回 `invalid`，这一句红。 */
      expect(reply['status']).toBe('committed');
      expect(sent.meta.expected).toEqual(PINS);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('PA-42/42b 取消 asks first; 取消目标 then cancels', async () => {
    const opened = await openE3GW0();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Plan', { search: '?goal=ag2b-goal' });
    const dialog = (): FakeElement | undefined => findElement(page.root, (element) => hasClass(element, 'decision')
      && element.getAttribute('role') === 'alertdialog');
    try {
      await planReady(log);
      click(goalbarButton(page.root, '取消')!);
      await waitFor(() => dialog() !== undefined);
      expect(textOf(dialog())).toContain('取消目标');
      await quietPage(log);
      /* 具名改坏: 直接发取消；这一句红。 */
      expect(countRoute(log, 'goals/control')).toBe(0);
      click(findButton(dialog()!, '取消目标')!);
      const reply = await answerOf(log, 'goals/control');
      expect(countRoute(log, 'goals/control')).toBe(1);
      expect(sentWrite(callsTo(log, 'goals/control')[0]).input['control']).toBe('cancel');
      expect(reply['status']).toBe('committed');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('PA-43 重新入队 on a cancelled Goal copies it through copy-draft and copy-confirm', async () => {
    const opened = await openE3GW0();
    worlds.push(opened.world);
    await cancelGoal(opened.world, opened.world.goals.first);
    const { page, log } = await bootE3N(opened.world, 'Plan', { search: '?goal=ag2b-goal' });
    try {
      await planReady(log);
      click(goalbarButton(page.root, '重新入队')!);
      /* 具名改坏: `copyGoal` 改调 `goals/control`；这一句红。 */
      await expect.poll(() => countRoute(log, 'goals/copy-confirm'), { timeout: 8_000, interval: 25 }).toBe(1);
      await answerOf(log, 'goals/copy-confirm');
      await quietPage(log);
      expect(countRoute(log, 'goals/copy-draft')).toBe(1);
      expect(countRoute(log, 'goals/copy-confirm')).toBe(1);
      expect((callsTo(log, 'goals/copy-confirm')[0]!.input as Record<string, unknown>)['selectedInterventions']).toEqual([]);
      expect(countRoute(log, 'goals/control')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);
});
