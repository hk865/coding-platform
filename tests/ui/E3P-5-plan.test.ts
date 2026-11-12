import { afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, callsTo, countRoute, descendants, hasClass, quietPage, sentWrite, textOf, waitFor } from './helpers/E3N-page.js';
import { click, notConnected } from './helpers/E3N-interact.js';
import { labelled, typeInto } from './helpers/E3D-page.js';
import {
  answerOf, headOf, lineText, openPAW1, openPAW2, options, planCard, planLines, planReady, type PAW2,
} from './helpers/E3P-world.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3P PA-30–PA-36 (test sheet e3plan-a-tests §2.5): the plan card reads the
 * ideas of W1's answer and, on W2, the live candidate v2 of the same request
 * (`plans/request-candidate`) and the adopted versions (`plans/versions`).
 * PA-36 (TESTS-8) is Main's 采用 on W1. Every row opens its own world.
 */

const GOAL = '?goal=ag2b-goal';
const worlds: S6ARequestWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

const isButton = (element: FakeElement): boolean => element.tagName.toLowerCase() === 'button';

/** A 方案细节 section button (`任务 n`, `检查 n`, `风险 n`) of the plan card. */
const section = (card: FakeElement, name: string): FakeElement | undefined =>
  descendants(card).find((element) => isButton(element) && hasClass(element, 'xp-b') && textOf(element).startsWith(name));

/** The opened 方案细节 list named `name` (`div.xl[aria-label]`). */
const list = (card: FakeElement, name: string): FakeElement | undefined =>
  descendants(card).find((element) => hasClass(element, 'xl') && element.getAttribute('aria-label') === name);

/** The plan card's foot button whose text contains `text` (采用方案 …, 在对话里修改). */
const footButton = (root: FakeElement, text: string): FakeElement | undefined => {
  const card = planCard(root);
  const foot = card === undefined ? undefined : findClass(card, 'plan-foot');
  return foot === undefined ? undefined : findButton(foot, text);
};

async function bootW2(w: PAW2): Promise<Awaited<ReturnType<typeof bootE3N>>> {
  const booted = await bootE3N(w.world, 'Plan', { search: GOAL });
  await planReady(booted.log);
  return booted;
}

describe('E3P Plan plan card', () => {
  it('PA-30 the plan card counts the answer’s two ideas', async () => {
    const opened = await openPAW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Plan', { search: GOAL });
    try {
      await planReady(log);
      const card = planCard(page.root)!;
      /* 具名改坏: 把 `scope` 写死 `3 个方案`；这一句红。 */
      expect(headOf(card, 'scope')).toBe('2 个方案');
      expect(options(card).map((option) => textOf(findClass(option, 'opt-title')))).toEqual(['PA idea 1', 'PA idea 2']);
      /* lead 1: nothing selected, the local preview (the first idea) shows its 怎么做 only.
         具名改坏: 没选时不展开预览项；下面第一句红（`.opt-how` 不出现）。 */
      const preview = descendants(card).find((element) => hasClass(element, 'opt'))!;
      expect(textOf(findClass(preview, 'opt-how'))).toBe('PA detail 1');
      expect(options(card).map((option) => option.getAttribute('aria-checked'))).toEqual(['false', 'false']);
      expect(descendants(card).some((element) => hasClass(element, 'd-item'))).toBe(false);
      expect(descendants(preview).some((element) => hasClass(element, 'xp-b') || hasClass(element, 'xp-sec'))).toBe(false);
      expect(descendants(card).some((element) => ['任务', '检查'].includes(element.getAttribute('aria-label') ?? ''))).toBe(false);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('PA-31 picking the second idea writes requests/select-idea for that round', async () => {
    const opened = await openPAW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Plan', { search: GOAL });
    try {
      await planReady(log);
      click(options(planCard(page.root)!)[1]!);
      /* 具名改坏: 只本地选中不发写；这一句红。 */
      await expect.poll(() => countRoute(log, 'requests/select-idea'), { timeout: 8_000, interval: 25 }).toBe(1);
      const reply = await answerOf(log, 'requests/select-idea');
      await waitFor(() => options(planCard(page.root)!)[1]?.getAttribute('aria-checked') === 'true');
      await quietPage(log);
      expect(countRoute(log, 'requests/select-idea')).toBe(1);
      const input = callsTo(log, 'requests/select-idea')[0]!.input as Record<string, unknown>;
      expect(input['round']).toEqual(opened.round);
      expect(input['index']).toBe(1);
      expect(reply['status']).toBe('queued');
      expect(options(planCard(page.root)!).map((option) => option.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('PA-31b a second selection of the same ideas round shows the latest choice', async () => {
    const opened = await openPAW1();
    worlds.push(opened.world);
    const first = await opened.world.selectIdea({ commandId: 'pa-select-a', round: opened.round, index: 0 });
    expect(first.status).toBe('queued');
    const second = await opened.world.selectIdea({ commandId: 'pa-select-b', round: opened.round, index: 1 });
    expect(second.status).toBe('queued');
    const { page, log } = await bootE3N(opened.world, 'Plan', { search: GOAL });
    try {
      await planReady(log);
      const card = planCard(page.root)!;
      /* 具名改坏: `later` 用 `find` 取最早一条；这一句红。 */
      expect(options(card)[1]!.getAttribute('aria-checked')).toBe('true');
      expect(options(card)[0]!.getAttribute('aria-checked')).toBe('false');
    } finally {
      await page.restore();
    }
  });

  it('PA-32/35 the live candidate v2: what changed, its tasks and checks, and the adopted version 1 line', async () => {
    const w = await openPAW2();
    worlds.push(w.world);
    const { page, log } = await bootW2(w);
    try {
      const card = planCard(page.root)!;
      expect(headOf(card, 'scope')).toBe('2 个方案');
      expect(headOf(card, 'st')).toBe('未采用');
      const delta = descendants(card).find((element) => hasClass(element, 'plan-delta')
        && element.getAttribute('aria-label') === '这一版改了什么');
      const rows = delta === undefined ? [] : descendants(delta).filter((element) => element.tagName.toLowerCase() === 'li');
      expect(rows.length).toBe(1);
      /* 具名改坏: 用 `previous` 比两版草稿；这一句红。 */
      expect(textOf(findClass(rows[0]!, 'dm'))).toBe('changed');
      expect(textOf(descendants(rows[0]!).find((element) => isButton(element) && hasClass(element, 'pd-ref')))).toBe('PA work v2');
      click(section(card, '任务')!);
      click(section(planCard(page.root)!, '检查')!);
      await waitFor(() => list(planCard(page.root)!, '任务') !== undefined && list(planCard(page.root)!, '检查') !== undefined);
      const opened = planCard(page.root)!;
      expect(descendants(list(opened, '任务')!).filter((element) => isButton(element) && hasClass(element, 'd-item'))
        .map((element) => textOf(element))).toContain('PA work v2');
      /* 具名改坏: 任务项写死 `s-pending`；下面两句红。 */
      const taskSq = descendants(descendants(list(opened, '任务')!)
        .find((element) => isButton(element) && hasClass(element, 'd-item'))!).find((element) => hasClass(element, 'sq'))!;
      expect(hasClass(taskSq, 's-future')).toBe(true);
      expect(hasClass(taskSq, 's-pending')).toBe(false);
      expect(textOf(list(opened, '检查'))).toContain('PA static check');
      notConnected(section(opened, '风险')!);
      const versions = (await answerOf(log, 'plans/versions'))['value'] as { items: Array<{ revision: number }> };
      expect(versions.items.map((item) => ({ revision: item.revision }))).toEqual([{ revision: 1 }]);
      const lines = planLines(page.root);
      expect(lines.length).toBe(1);
      expect(lineText(lines[0]!)).toContain('第 1 版');
      /* 具名改坏: 把 `reasonLabel` 写成空；这一句红。 */
      expect(lineText(lines[0]!)).toContain('PA version one');
      await quietPage(log);
      const calls = log.calls.length;
      notConnected(findElement(planLines(page.root)[0]!, isButton)!);
      await quietPage(log);
      expect(log.calls.length).toBe(calls);
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('PA-33 采用方案 applies candidate v2 pinned to the Goal only; the versions read 第 2 版 then 第 1 版', async () => {
    const w = await openPAW2();
    worlds.push(w.world);
    const { page, log } = await bootW2(w);
    try {
      /* `selectedIndex` also names the adopt label: W2's one selection is idea B. */
      expect(textOf(footButton(page.root, '采用方案')!)).toBe('采用方案 B');
      click(footButton(page.root, '采用方案')!);
      const reply = await answerOf(log, 'plans/apply');
      const sent = sentWrite(callsTo(log, 'plans/apply')[0]);
      expect(sent.input['proposalRef']).toEqual(w.v2.ref);
      expect(sent.input['expectedProposalRevision']).toBe(w.v2.revision);
      /* 具名改坏: `meta.expected` 多带一项；这一句红。 */
      expect(sent.meta.expected.length).toBe(1);
      expect((sent.meta.expected[0] as { ref: unknown }).ref)
        .toEqual({ aggregateType: 'Goal', projectId: 'ag2b-collab-project', goalId: 'ag2b-goal' });
      await waitFor(() => planLines(page.root).length === 2);
      await quietPage(log);
      expect(countRoute(log, 'plans/apply')).toBe(1);
      expect(reply['status']).toBe('committed');
      const lines = planLines(page.root).map(lineText);
      expect(lines.length).toBe(2);
      expect(lines[0]).toContain('第 2 版');
      expect(lines[1]).toContain('第 1 版');
      expect(footButton(page.root, '采用方案')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('PA-34 在对话里修改 asks the round that made v2 again with v2 as the card', async () => {
    const w = await openPAW2();
    worlds.push(w.world);
    const { page, log } = await bootW2(w);
    try {
      click(footButton(page.root, '在对话里修改')!);
      /* 具名改坏: `iterate` 的 `iterKey` 用本地 `pick`（A）；这一句红。 */
      expect(textOf(findClass(page.root, 'composer-to'))).toBe('改方案 B：发出后交给秘书处理');
      typeInto(page.root, 'plan-input', '去掉一个任务');
      click(labelled(page.root, '发送')!);
      await answerOf(log, 'requests/ask');
      await quietPage(log);
      expect(countRoute(log, 'requests/ask')).toBe(1);
      const input = callsTo(log, 'requests/ask')[0]!.input as Record<string, unknown>;
      expect(input['round']).toEqual(w.v2Round);
      expect(input['cardRefs']).toEqual([{ ref: w.v2.ref, revision: w.v2.revision }]);
      /* 具名改坏: 把 `regenerate` 写 `false`；这一句红。 */
      expect(input['regenerate']).toBe(true);
      expect(countRoute(log, 'plans/propose')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('PA-36 Main’s 采用方案 A selects idea 0 of the ideas round (TESTS-8)', async () => {
    const opened = await openPAW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: GOAL });
    try {
      await waitFor(() => findButton(page.root, '采用方案 A') !== undefined);
      await quietPage(log);
      const adopt = findButton(page.root, '采用方案 A')!;
      const off = hasClass(adopt, 'is-off');
      /* The selection's follow-up is answered, so the ideas round stops being the
         request's last answered round. */
      await opened.world.scripted.script(opened.secretary, [{ kind: 'text', text: 'PA follow-up answer' }]);
      click(adopt);
      /* 具名改坏: Main 的 `adopt` 保持 `nc`；这一句红。 */
      await expect.poll(() => countRoute(log, 'requests/select-idea'), { timeout: 8_000, interval: 25 }).toBe(1);
      const input = callsTo(log, 'requests/select-idea')[0]!.input as Record<string, unknown>;
      expect(input['round']).toEqual(opened.round);
      expect(input['index']).toBe(0);
      expect(off).toBe(false);
      await waitFor(() => textOf(page.root).includes('PA follow-up answer'));
      await quietPage(log);
      const again = findButton(page.root, '采用方案 A');
      expect(again).toBeDefined();
      /* lead 2: 选过以后“采用”不可点、点了零请求。具名改坏: 去掉
         `ideaRow.selectable` 判断/守卫；下面计数那句红（旧代码第二次写，计数 2）。 */
      click(again!);
      await quietPage(log);
      expect(countRoute(log, 'requests/select-idea')).toBe(1);
      expect(hasClass(again!, 'is-off')).toBe(true);
      expect(again!.getAttribute('aria-disabled')).toBe('true');
    } finally {
      await page.restore();
    }
  }, 120_000);
});
