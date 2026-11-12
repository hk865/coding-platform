import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { findAllClass, findButton, findClass, findElement } from './helpers/boot-page.js';
import {
  answerTexts, bootE3N, callsTo, countRoute, descendants, hasClass, quietPage, textOf, thread, userTexts, waitFor,
} from './helpers/E3N-page.js';
import { click, notConnected } from './helpers/E3N-interact.js';
import { labelled, typeInto } from './helpers/E3D-page.js';
import { answerOf, openPAW1, openPAW2, planReady, type PAWorld } from './helpers/E3P-world.js';
import { pauseS7AGoal, resumeS7AGoal } from '../helpers/S7A-fixture.js';
import { S6A_GOAL_1 } from '../helpers/S6A-request-fixture.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3P PA-05/07, PA-06, PA-60/61 (test sheet e3plan-a-tests §2.2): W1's request
 * `PA question` answered `PA body` on the real Host. The two reading rows share
 * one W1; each sending row opens its own.
 */

const GOAL = '?goal=ag2b-goal';
let shared: PAWorld;
const own: PAWorld[] = [];
beforeAll(async () => { shared = await openPAW1(); }, 120_000);
afterAll(async () => { await shared?.world.close(); });
afterEach(async () => { for (const opened of own.splice(0)) await opened.world.close(); });

const tab = (root: FakeElement, name: string): FakeElement | undefined =>
  findElement(root, (element) => element.getAttribute('role') === 'tab' && textOf(element) === name);

/** The trace rows (`.lg-row` without the header `.lg-th`). */
function traceRows(root: FakeElement): FakeElement[] {
  const list = findClass(root, 'lg');
  return list === undefined ? [] : descendants(list).filter((row) => hasClass(row, 'lg-row') && !hasClass(row, 'lg-th'));
}
describe('E3P Plan thread', () => {
  it('PA-05/07 轨迹 reads the owner’s raw records once and shows time, kind and id', async () => {
    const { page, log } = await bootE3N(shared.world, 'Plan', { search: GOAL });
    try {
      await planReady(log);
      click(tab(page.root, '轨迹')!);
      await waitFor(() => traceRows(page.root).length > 0);
      await quietPage(log);
      expect(tab(page.root, '轨迹')!.getAttribute('aria-selected')).toBe('true');
      expect(tab(page.root, '对话')!.getAttribute('aria-selected')).toBe('false');
      expect(findClass(page.root, 'lg')).toBeDefined();
      /* 具名改坏: 轨迹页签不读 `sessions/history`、画样例；这一句和上面的 `.lg-row` 等待红。 */
      expect(countRoute(log, 'sessions/history')).toBe(1);
      for (const row of traceRows(page.root)) {
        const cells = findAllClass(row, 'lg-c');
        expect(hasClass(cells[0]!, 'num')).toBe(true);
        /* 具名改坏: 把 `since`（CommitCursor）当时间画；这一句红。 */
        expect(textOf(cells[0])).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
        expect(hasClass(cells[2]!, 'mono')).toBe(true);
        expect(textOf(cells[2])).not.toBe('');
        expect(textOf(cells.at(-1)).startsWith('{')).toBe(false);
      }
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('PA-06 the question is the user bubble, the answer the agent row, the run block between is not connected', async () => {
    const { page, log } = await bootE3N(shared.world, 'Plan', { search: GOAL });
    try {
      await planReady(log);
      const holder = thread(page.root)!;
      /* 具名改坏: 把 `answer` 当用户气泡、`input` 当回答；下面两句红。 */
      expect(userTexts(page.root)).toEqual(['PA question']);
      expect(answerTexts(page.root)).toEqual(['PA body']);
      const run = findElement(holder, (element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'run'));
      expect(textOf(run)).toBe('运行步骤还没接通');
      const order = descendants(holder);
      expect(order.indexOf(findAllClass(holder, 'msg-user')[0]!)).toBeLessThan(order.indexOf(run!));
      expect(order.indexOf(run!)).toBeLessThan(order.indexOf(findAllClass(holder, 'msg-agent')[0]!));
      const calls = log.calls.length;
      /* 具名改坏: 运行块换回可展开的样例；`is-off`/`.steps` 两句红。 */
      notConnected(run!);
      await quietPage(log);
      expect(log.calls.length).toBe(calls);
      expect(findAllClass(holder, 'steps')).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('PA-16 a successful reread clears the error an out-of-date pause wrote', async () => {
    const w = await openPAW2();
    const { page, log } = await bootE3N(w.world, 'Plan', { search: GOAL });
    try {
      await planReady(log);
      await pauseS7AGoal(w.world, S6A_GOAL_1);
      /* The page still holds the pre-pause pins, so its own pause is refused. */
      click(findButton(page.root, '暂停')!);
      await waitFor(() => findClass(page.root, 'to') !== undefined);
      /* A later write reaches the page as a reread, which is the new state. */
      await resumeS7AGoal(w.world, S6A_GOAL_1);
      /* 具名改坏: 删掉 `if (s.err) patch.err = ''`；这一句红。 */
      await waitFor(() => findClass(page.root, 'to') === undefined);
    } finally {
      await page.restore();
      await w.world.close();
    }
  });

  it.each(['发送', '空稿'] as const)('PA-60/61 发送 on a %s', async (which) => {
    const opened = await openPAW1();
    own.push(opened);
    const { page, log } = await bootE3N(opened.world, 'Plan', { search: GOAL });
    try {
      await planReady(log);
      if (which === '空稿') {
        click(labelled(page.root, '发送')!);
        await quietPage(log);
        /* 具名改坏: 去掉空稿判断；这一句红。 */
        expect(countRoute(log, 'requests/submit')).toBe(0);
        expect(hasClass(labelled(page.root, '发送')!, 'is-off')).toBe(true);
        return;
      }
      typeInto(page.root, 'plan-input', '再看看方案');
      click(labelled(page.root, '发送')!);
      const reply = await answerOf(log, 'requests/submit');
      expect(countRoute(log, 'requests/submit')).toBe(1);
      const input = callsTo(log, 'requests/submit')[0]!.input as Record<string, unknown>;
      expect(input['text']).toBe('再看看方案');
      expect(input['goalId']).toBe('ag2b-goal');
      expect(input['references']).toEqual([]);
      expect(reply['status']).toBe('queued');
      const field = (): FakeElement | undefined => findElement(page.root, (element) => element.getAttribute('id') === 'plan-input');
      await quietPage(log);
      /* 具名改坏: 发送后不清输入；这一句红。 */
      expect(field()!.value).toBe('');
    } finally {
      await page.restore();
    }
  }, 120_000);
});
