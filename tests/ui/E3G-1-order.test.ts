import { afterEach, describe, expect, it } from 'vitest';
import {
  bootE3N, countRoute, descendants, hasClass, textOf, turns,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { findClass, findLink, type BootedPage } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { cancelGoal } from './helpers/E3N-world.js';
import { e3gGoalPins, openE3GW0, type E3GWorld } from './helpers/E3G-world.js';
import type { PageLog } from './helpers/E3N-page.js';

/**
 * E3G-1 G01–G08 (test sheet §2.1): the Goal list, its order writes and the one
 * open row. Every world is W0 (two seeded Goals, a secretary and a work line);
 * the page is the real `bootBoardPage`. Links are read, never chased.
 */

const GOALS = 'http://host/workbench/Goals.dc.html';
const worlds: E3GWorld[] = [];
afterEach(async () => {
  for (const opened of worlds.splice(0)) await opened.world.close();
});

function rowsOf(root: FakeElement): FakeElement[] {
  const list = findClass(root, 'gx-list');
  return list === undefined ? [] : descendants(list).filter((element) => element.getAttribute('role') === 'listitem');
}

function rowButton(row: FakeElement): FakeElement | undefined {
  return descendants(row).find((element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'gx-name'));
}

function label(element: FakeElement, name: string): string {
  return element.getAttribute(name) ?? '';
}

function byLabel(element: FakeElement, text: string): FakeElement | undefined {
  return descendants(element).find((child) => child.tagName.toLowerCase() === 'button'
    && (child.getAttribute('aria-label') ?? '').includes(text));
}

function pairsOf(root: FakeElement): Array<{ key: string; value: string }> {
  const dl = findClass(root, 'kv');
  if (dl === undefined) return [];
  const pairs: Array<{ key: string; value: string }> = [];
  for (const child of descendants(dl)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'dt') pairs.push({ key: textOf(child), value: '' });
    else if (tag === 'dd' && pairs.length > 0) pairs[pairs.length - 1]!.value = textOf(child);
  }
  return pairs;
}

function currentOf(row: FakeElement): string | null {
  return row.getAttribute('aria-current') ?? rowButton(row)?.getAttribute('aria-current') ?? null;
}

async function openGoals(world: E3GWorld['world'], search?: string): Promise<{ page: BootedPage; log: PageLog }> {
  const booted = await bootE3N(world, 'Goals', search === undefined ? {} : { search });
  /* The page's first read is asynchronous; a page that never reads stays on the
     sample rows, and the row's own assertion is the one that fails. */
  await turns(() => rowsOf(booted.page.root).length === 2, 2_000).catch(() => undefined);
  return booted;
}

describe('E3G-1 the Goal order list', () => {
  it('G01 the back link keeps the current Goal', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const { page } = await openGoals(opened.world, `?goal=${opened.world.goals.first.goalId}`);
    try {
      /* 具名改坏: `Goals.dc.html` 的返回链接去掉 `?goal=`；G01 的 goal 断言红。 */
      const back = findLink(page.root, '返回工作台');
      expect(back).toBeDefined();
      const url = new URL(label(back!, 'href'), GOALS);
      expect(url.pathname).toBe('/workbench/Main.dc.html');
      expect(url.searchParams.get('goal')).toBe(opened.world.goals.first.goalId);
      expect(page.assigned()).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G02 the list shows both Goals in order', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const { page } = await openGoals(opened.world, `?goal=${opened.world.goals.first.goalId}`);
    try {
      /* 具名改坏: 适配器按 `ordinal` 倒序排 `goals`；G02 的 `.row-name` 顺序红。 */
      const rows = rowsOf(page.root);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => label(row, 'aria-posinset'))).toEqual(['1', '2']);
      expect(rows.map((row) => textOf(findClass(row, 'row-ord')))).toEqual(['1', '2']);
      expect(rows.map((row) => textOf(findClass(row, 'row-name')))).toEqual(['S6A goal one', 'S6A goal two']);
      expect(textOf(findClass(page.root, 'head-sub'))).toContain('2 个目标');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G03 one row opens at a time', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const { page } = await openGoals(opened.world);
    try {
      const rows = rowsOf(page.root);
      expect(rows).toHaveLength(2);
      const first = rowButton(rows[0]!);
      const second = rowButton(rows[1]!);
      expect(first).toBeDefined();
      click(first!);
      await turns(() => findClass(rows[0]!, 'row-more') !== undefined);
      /* 具名改坏: 展开状态写死到第一行、点第二行也展开第一行；G03 的“其他行没有”红。 */
      expect(first!.getAttribute('aria-expanded')).toBe('true');
      expect(findClass(rows[0]!, 'row-more')).toBeDefined();
      expect(findClass(rows[1]!, 'row-more')).toBeUndefined();
      click(second!);
      await turns(() => findClass(rows[1]!, 'row-more') !== undefined);
      expect(second!.getAttribute('aria-expanded')).toBe('true');
      expect(findClass(rows[0]!, 'row-more')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G04 moving the second Goal up writes the full order with every Goal pin', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const pins = await e3gGoalPins(opened.world);
    const { page, log } = await openGoals(opened.world);
    try {
      const rows = rowsOf(page.root);
      expect(rows).toHaveLength(2);
      const up = byLabel(rows[1]!, '上移');
      expect(up).toBeDefined();
      const before = countRoute(log, 'goals/reorder');
      click(up!);
      await turns(() => countRoute(log, 'goals/reorder') === before + 1);
      expect(countRoute(log, 'goals/reorder')).toBe(before + 1);
      const call = log.calls.filter((entry) => entry.route === 'goals/reorder').at(-1)!;
      /* 具名改坏: `reorderGoal` 只发相邻两条或把 `meta.expected` 写成 `[goal1@rev, goal2@rev]`；
         G04 的 `goalOrder` 或 `committed` 红。 */
      expect(call.input).toEqual({ workspace: opened.world.scope,
        goalOrder: [opened.world.goals.second, opened.world.goals.first] });
      expect((call.body as { request: { meta: { expected: unknown } } }).request.meta.expected)
        .toEqual([pins[1], pins[0]]);
      await turns(() => countRoute(log, 'goals/list') >= 2);
      await turns(() => textOf(findClass(rowsOf(page.root)[1]!, 'row-name')) === 'S6A goal one');
      expect(textOf(findClass(rowsOf(page.root)[0]!, 'row-name'))).toBe('S6A goal two');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G05 the first up and last down arrows are disabled and write nothing', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const { page, log } = await openGoals(opened.world);
    try {
      const rows = rowsOf(page.root);
      expect(rows).toHaveLength(2);
      const up = byLabel(rows[0]!, '已经在第 1 位');
      const down = byLabel(rows[1]!, '已经在最后');
      expect(up).toBeDefined();
      expect(down).toBeDefined();
      /* 具名改坏: 删掉首/末位的禁用；G05 的 `is-off` 和零请求红。 */
      for (const element of [up!, down!]) {
        expect(hasClass(element, 'is-off')).toBe(true);
        expect(element.getAttribute('aria-disabled')).toBe('true');
      }
      click(up!);
      click(down!);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(countRoute(log, 'goals/reorder')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G06 ?goal= names the current row', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const { page } = await openGoals(opened.world, `?goal=${opened.world.goals.second.goalId}`);
    try {
      const rows = rowsOf(page.root);
      expect(rows).toHaveLength(2);
      /* 具名改坏: `readGoals` 忽略 `?goal=`、总选第一个目标；G06 的 `aria-current` 红。 */
      expect(currentOf(rows[1]!)).toBe('true');
      expect(['', null]).toContain(currentOf(rows[0]!));
      expect(textOf(findClass(page.root, 'head-sub'))).toContain('S6A goal two');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G07 without ?goal= the first unfinished Goal is current', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    await cancelGoal(opened.world, opened.world.goals.first);
    const { page } = await openGoals(opened.world);
    try {
      const rows = rowsOf(page.root);
      expect(rows).toHaveLength(2);
      /* 具名改坏: 默认目标改成 `goals[0]`；G07 的 `.row-ord` 红。 */
      expect(textOf(findClass(rows[1]!, 'row-ord'))).toBe('2');
      expect(currentOf(rows[1]!)).toBe('true');
      expect(['', null]).toContain(currentOf(rows[0]!));
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G08 the open row states progress, line, change count and autonomy', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const { page } = await openGoals(opened.world);
    try {
      const rows = rowsOf(page.root);
      expect(rows).toHaveLength(2);
      click(rowButton(rows[0]!)!);
      await turns(() => findClass(rows[0]!, 'row-more') !== undefined);
      const more = findClass(rows[0]!, 'row-more')!;
      const pairs = pairsOf(more);
      /* 具名改坏: 把 `goals/list` 的 `display.phase === null` 猜成 `running`、状态行写“运行中”；
         G08 或 G02 的状态行红。 */
      expect(pairs.map((pair) => pair.key)).toEqual(['进度', '工作线', '改动', '自治']);
      const value = (key: string): string => pairs.find((pair) => pair.key === key)!.value;
      /* T7/B3: the adapter shows the prototype's words, not the raw enum. */
      expect(value('自治')).toBe('方案确认后自动');
      expect(value('改动')).toMatch(/^\d+$/);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
