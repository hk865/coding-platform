import { afterEach, describe, expect, it } from 'vitest';
import { findButton, findElement, findLink } from './helpers/boot-page.js';
import { bootE3N, countRoute, waitFor } from './helpers/E3N-page.js';
import { click, pressKey } from './helpers/E3N-interact.js';
import { openW1 } from './helpers/E3N-world.js';
import { seedArchPlan, seedArchWorld, startWorkRun } from './helpers/E3A-world.js';
import {
  crumbButtons, currentCrumb, detailText, layerTitle, nodeNamed, resultRows, searchInput, searchNote,
} from './helpers/E3A-page.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3A-1 (E3ARCH tests §2.1): the header links, the layer breadcrumb, the
 * search, the work-scope toggle and the two ruled empty/project-level states.
 * Links are read as `href`, never chased; every world is the real S6A Host and
 * every page read goes to it except the one controlled observation state.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

/** E3A-03's seed: `src/module.ts` plus seven matching files in the same
 * WorkGraph module, so `architecture/find` has 8 hits and the first page (6)
 * is what renders. */
const SEARCH_FILES = [
  'src/module-01.ts', 'src/module-02.ts', 'src/module-03.ts', 'src/module-04.ts',
  'src/module-05.ts', 'src/module-06.ts', 'src/module-07.ts',
] as const;

const SEARCH_FIRST_PAGE = SEARCH_FILES.slice(0, 6);

function urlOf(href: string | null): URL {
  expect(href).not.toBeNull();
  return new URL(href!, 'http://host/workbench/ArchOverview.dc.html');
}

async function openWithArch(options: { moduleFiles?: readonly string[] } = {}): Promise<{ world: S6ARequestWorld; goalId: string }> {
  const opened = await openW1();
  worlds.push(opened.world);
  await seedArchWorld(opened.world, options);
  return { world: opened.world, goalId: opened.world.goals.first.goalId };
}

describe('E3A-1 links, breadcrumb, search and work scope', () => {
  it('E3A-01 both header links keep the current Goal', async () => {
    const { world, goalId } = await openWithArch();
    const { page } = await bootE3N(world, 'ArchOverview', { search: '?goal=' + goalId });
    try {
      const title = layerTitle(page.root);
      expect(title).toBeDefined();
      click(title!);
      /* 具名改坏: 返回链接的 `goalHref(...)` 改成 `'Main.dc.html'`（丢 `?goal=`）；
         E3A-01 的 goal 断言红。 */
      for (const text of ['返回工作台', '在工作台里看']) {
        const link = findLink(page.root, text, 'Main.dc.html');
        expect(link).toBeDefined();
        const url = urlOf(link!.getAttribute('href'));
        expect(url.pathname).toBe('/workbench/Main.dc.html');
        expect(url.searchParams.get('goal')).toBe(goalId);
      }
      expect(page.assigned()).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-02 the breadcrumb goes up one layer without a request', async () => {
    const { world, goalId } = await openWithArch();
    const { page, log } = await bootE3N(world, 'ArchOverview', { search: '?goal=' + goalId });
    try {
      /* The frozen prototype opens at the project root (`aroot = 'SYS'`). */
      expect(currentCrumb(page.root)).toBe('S6A request world');
      const top = nodeNamed(page.root, 'WorkGraph');
      expect(top).toBeDefined();
      click(top!);
      const enter = findButton(page.root, '进入这一层');
      expect(enter).toBeDefined();
      click(enter!);
      expect(currentCrumb(page.root)).toBe('WorkGraph');
      const crumbs = crumbButtons(page.root);
      expect(crumbs.length).toBeGreaterThanOrEqual(2);
      const before = log.calls.length;
      /* 具名改坏: 点面包屑时调 `location.assign('ArchOverview.dc.html?goal=...')`；
         E3A-02 的“无新增请求”和 `assigned` 空都红。 */
      click(crumbs[crumbs.length - 2]!);
      expect(currentCrumb(page.root)).toBe('S6A request world');
      expect(log.calls.length).toBe(before);
      expect(page.assigned()).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-03 searching module shows the total hit count and the first page', async () => {
    const { world } = await openWithArch({ moduleFiles: SEARCH_FILES });
    const { page, log } = await bootE3N(world, 'ArchOverview');
    try {
      const input = searchInput(page.root);
      expect(input).toBeDefined();
      input!.value = 'module';
      input!.dispatch('input', { target: input, currentTarget: input });
      /* 具名改坏: `src/ui/adapters/arch-overview.ts:326` 的 `String(total)` 改成
         `String(rows.length)`；E3A-03 的 `8 个` 红。或搜索时不发
         `architecture/find`；`find` 次数 0 红。 */
      await waitFor(() => countRoute(log, 'architecture/find') >= 1, 5_000);
      expect(countRoute(log, 'architecture/find')).toBeGreaterThanOrEqual(1);
      /* The first page proves the find reply landed; the note's total is a
         separate, hand-computed literal from the 8-file seed. */
      await waitFor(() => resultRows(page.root).length === 6, 5_000);
      expect(searchNote(page.root)).toBe('8 个，在 1 个模块');
      expect(page.root.textContent).toContain('另有 2 个，图里保持高亮');
      const rows = resultRows(page.root);
      expect(rows).toHaveLength(6);
      for (const [index, path] of SEARCH_FIRST_PAGE.entries()) {
        expect(rows[index]!.textContent).toContain(path);
      }
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-04 Enter selects, Escape and clear empty the search, clear does not reread', async () => {
    const { world } = await openWithArch();
    const { page, log } = await bootE3N(world, 'ArchOverview');
    try {
      const type = async (value: string, note: string): Promise<void> => {
        const input = searchInput(page.root);
        expect(input).toBeDefined();
        const before = countRoute(log, 'architecture/find');
        input!.value = value;
        input!.dispatch('input', { target: input, currentTarget: input });
        await waitFor(() => countRoute(log, 'architecture/find') > before, 5_000);
        /* The find request is not the answer: the row reads the reply the page
           renders, so wait for that reply's own note. */
        await waitFor(() => searchNote(page.root) === note, 5_000);
      };
      await type('module', '1 个，在 1 个模块');
      const input = searchInput(page.root)!;
      /* 具名改坏: Escape 只清结果不清 `q`；E3A-04 的 `q` 空断言红。 */
      pressKey(input, 'Enter');
      expect(searchInput(page.root)!.value).toBe('module');
      expect(detailText(page.root)).toContain('src/module.ts');

      await type('zzz', '没有匹配');
      expect(resultRows(page.root)).toHaveLength(0);

      const beforeClear = countRoute(log, 'architecture/find');
      const clear = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && element.getAttribute('aria-label') === '清除查找');
      expect(clear).toBeDefined();
      /* 具名改坏: 清除查找也调 `readMore({search:''})` 并期待重搜；
         E3A-04 的“不再新增”红。 */
      click(clear!);
      expect(searchInput(page.root)!.value).toBe('');
      expect(resultRows(page.root)).toHaveLength(0);
      expect(countRoute(log, 'architecture/find')).toBe(beforeClear);

      await type('module', '1 个，在 1 个模块');
      pressKey(searchInput(page.root)!, 'Escape');
      expect(searchInput(page.root)!.value).toBe('');
      await waitFor(() => resultRows(page.root).length === 0, 5_000);
      expect(resultRows(page.root)).toHaveLength(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-05 只看当前工作 reads the work scope once and withdraws it', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    await seedArchWorld(opened.world);
    const plan = await seedArchPlan(opened.world);
    await startWorkRun(opened.world, plan);
    const { page, log } = await bootE3N(opened.world, 'ArchOverview');
    try {
      const button = findButton(page.root, '只看当前工作');
      expect(button).toBeDefined();
      expect(button!.getAttribute('aria-pressed')).toBe('false');
      /* The connection's supplementary read (R3, `refresh.ts` `onOpen`) starts
         after the first read; let it pass the work-scope branch before the
         toggle, so the click's demand cannot race it into a second read. */
      await waitFor(() => countRoute(log, 'lines/list') >= 2, 5_000);
      const before = countRoute(log, 'architecture/work-scope');
      /* 具名改坏: `src/ui/adapters/arch-overview.ts:560` 的
         `source.work.counts.files` 改 `+1`；E3A-05 的 post-read-back
         `1 个文件` 红。 */
      click(button!);
      await waitFor(() => countRoute(log, 'architecture/work-scope') === before + 1, 5_000);
      expect(findButton(page.root, '只看当前工作')!.getAttribute('aria-pressed')).toBe('true');
      /* The frozen seed's 0/0 is indistinguishable from the pre-read fallback
         (`R.work.length`); one real live Run makes the read-back 1 file in 1
         module. Wait for the read-back render's module count (the fallback is
         0 modules), then assert the post-read-back literal. */
      await waitFor(() => page.root.textContent.includes('在 1 个模块'), 5_000);
      expect(page.root.textContent).toContain('正在处理 1 个文件，在 1 个模块');
      click(findButton(page.root, '只看当前工作')!);
      expect(findButton(page.root, '只看当前工作')!.getAttribute('aria-pressed')).toBe('false');
      expect(countRoute(log, 'architecture/work-scope')).toBe(before + 1);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-05e no catalog shows the page’s own empty text', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'ArchOverview', { search: '?goal=' + opened.world.goals.first.goalId });
    try {
      /* lead 11-09 ruling 1: the page's own empty state, not the global not_found text. */
      expect(page.root.textContent).toContain('还没有采用的架构图');
      expect(page.root.textContent).not.toContain('找不到这个目标。');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-05n without ?goal the page draws the project level and picks no Goal', async () => {
    const { world } = await openWithArch();
    const { page, log } = await bootE3N(world, 'ArchOverview');
    try {
      /* lead 11-09 ruling 2: only the project level; no auto-picked Goal. */
      expect(page.root.textContent).toContain('WorkGraph');
      expect(countRoute(log, 'goals/read')).toBe(0);
      expect(countRoute(log, 'tasks/query')).toBe(0);
      expect(findElement(page.root, (element) => (element.getAttribute('class') ?? '')
        .split(/\s+/).includes('s-claimable'))).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 60_000);
});
