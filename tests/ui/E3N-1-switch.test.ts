import { afterEach, describe, expect, it } from 'vitest';
import { boardUrlOf, findElement, findLink } from './helpers/boot-page.js';
import { bootE3N, goalRows, mainHeadTitle, textOf } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { cancelGoal, openW1 } from './helpers/E3N-world.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3W N01–N06 (run sheet §2.1): the two boards' cross-page links and the
 * rail's Goal choice. Links are native `<a href>` and are read, never chased:
 * `assigned()` only proves the page did not navigate itself. Every world is a
 * real Host built by E3N-world; the page is the real `bootBoardPage`.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

function urlOf(href: string | null, board: 'Main' | 'TaskMap'): URL {
  expect(href).not.toBeNull();
  return boardUrlOf(href, `${board}.dc.html`);
}

describe('E3N-1 switching boards and Goals', () => {
  it('N01 the TaskMap 返回工作台 link keeps the current Goal', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'TaskMap', { search: '?goal=ag2b-goal' });
    try {
      /* 具名改坏: `src/ui/boards/TaskMap.dc.html` 的返回链接去掉 `withGoal()`
         （`href="Main.dc.html"` 原样），N01 的 goal 断言红。 */
      const back = findLink(page.root, '返回工作台', 'Main.dc.html');
      const url = urlOf(back?.getAttribute('href') ?? null, 'TaskMap');
      expect(url.pathname).toBe('/workbench/Main.dc.html');
      expect(url.searchParams.get('goal')).toBe('ag2b-goal');
      expect(page.assigned()).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N02 the Main 整页查看 link to TaskMap keeps the current Goal', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      /* 具名改坏: `.plink` 分支返回原 href、只有 `.tm-back` 分支 `withGoal()`;
         N02 的 goal 断言红。 */
      const link = findLink(page.root, '整页查看', 'TaskMap.dc.html');
      const url = urlOf(link?.getAttribute('href') ?? null, 'Main');
      expect(url.pathname).toBe('/workbench/TaskMap.dc.html');
      expect(url.searchParams.get('goal')).toBe('ag2b-goal');
      expect(page.assigned()).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N03 the rail lists the real Goals and marks the one named by ?goal=', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=s6a-goal-2' });
    try {
      const rows = goalRows(page.root);
      expect(rows).toHaveLength(2);
      expect(rows[1]!.getAttribute('aria-current')).toBe('true');
      expect(textOf(findElement(rows[1]!, (element) => (element.getAttribute('class') ?? '')
        .split(/\s+/).includes('row-ord')))).toBe('2');
      expect(mainHeadTitle(page.root)).toBe('S6A goal two');
      expect(rows[0]!.getAttribute('aria-current')).toBe('');
      expect(log.calls.map((call) => call.route)).toContain('goals/list');
      /* 具名改坏: `src/ui/boot.ts` 把 `goals/list` 的读换成 `goals/conflicts`
         并用 `footprintCompleteness` 当目标行；N03 的“2 行”和 `.head-title` 红。 */
      expect(log.calls.map((call) => call.route)).not.toContain('goals/conflicts');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N04 switching Goals in the rail keeps the draft and does not navigate', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      const composer = findElement(page.root, (element) => element.getAttribute('id') === 'composer-input');
      expect(composer).toBeDefined();
      composer!.value = '草稿保留';
      composer!.dispatch('input', { target: composer, currentTarget: composer });

      const rows = goalRows(page.root);
      expect(rows).toHaveLength(2);
      click(rows[1]!);
      expect(mainHeadTitle(page.root)).toBe('S6A goal two');
      expect(rows[1]!.getAttribute('aria-current')).toBe('true');
      /* 具名改坏: 目标切换的 `set({...})` 里加 `draft: ''`；输入框值断言红。
         切换时 `location.assign('Main.dc.html?goal='+id)`；`assigned` 为空和草稿保留两条都红。 */
      expect(composer!.value).toBe('草稿保留');
      expect(page.assigned()).toEqual([]);
      const link = findLink(page.root, '整页查看', 'TaskMap.dc.html');
      expect(urlOf(link?.getAttribute('href') ?? null, 'Main').searchParams.get('goal')).toBe('s6a-goal-2');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N06 with no ?goal= the first unfinished Goal is the current one', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    await cancelGoal(opened.world, opened.world.goals.first);
    const { page } = await bootE3N(opened.world, 'Main');
    try {
      const rows = goalRows(page.root);
      /* 具名改坏: 无 `?goal=` 时改成选 `goals[0]`；N06 的 `.head-title` 红
         （选到已取消的 `S6A goal one`）。 */
      expect(textOf(findElement(rows[1]!, (element) => (element.getAttribute('class') ?? '')
        .split(/\s+/).includes('row-ord')))).toBe('2');
      expect(mainHeadTitle(page.root)).toBe('S6A goal two');
      expect(rows[0]!.getAttribute('aria-current')).toBe('');
    } finally {
      await page.restore();
    }
  }, 60_000);
});
