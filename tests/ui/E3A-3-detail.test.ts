import { afterEach, describe, expect, it } from 'vitest';
import { findAllClass, findButton, findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, textOf, waitFor } from './helpers/E3N-page.js';
import { click, hover, leave } from './helpers/E3N-interact.js';
import { openW1 } from './helpers/E3N-world.js';
import { E3A, seedArchPlan, seedArchWorld, writeArchNote } from './helpers/E3A-world.js';
import {
  currentCrumb, crumbButtons, detail, detailText, foldRow, intro, nodeNamed, pageText, relationGroup,
  statusClasses,
} from './helpers/E3A-page.js';
import { asRecord } from '../../src/ui/values.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3A-3 (E3ARCH tests §2.3): the layer, file and edge details, the fold row,
 * the hover card, closing/navigating and the legend/theme. The 17 “部分” rows
 * use the lead's text form: the missing item says 还没接通, never a fake 0.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

async function openWithArch(): Promise<S6ARequestWorld> {
  const opened = await openW1();
  worlds.push(opened.world);
  await seedArchWorld(opened.world);
  return opened.world;
}

async function openWithPlan(): Promise<S6ARequestWorld> {
  const world = await openWithArch();
  await seedArchPlan(world);
  return world;
}

describe('E3A-3 details, files and edges', () => {
  it('E3A-09 the layer detail counts one file and says 还没接通 for 改动', async () => {
    const world = await openWithPlan();
    const { page } = await bootE3N(world, 'ArchOverview', { search: '?goal=' + world.goals.first.goalId });
    try {
      const top = nodeNamed(page.root, 'WorkGraph');
      expect(top).toBeDefined();
      click(top!);
      const text = detailText(page.root);
      expect(text).toContain('1 个文件');
      /* DARR B2 §4: the change scope is read now; this Goal has no Run, so the
         real count is 0. 具名改坏: 把“改动”留在 `还没接通`；E3A-09 的 `改动 0` 红。 */
      expect(text).toContain('改动 0');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-10 the file detail names the file, its state, its line, its note and reads by anchor', async () => {
    const world = await openWithPlan();
    await writeArchNote(world);
    const { page, log } = await bootE3N(world, 'ArchOverview', { search: '?goal=' + world.goals.first.goalId });
    try {
      const file = nodeNamed(page.root, E3A.filePath);
      expect(file).toBeDefined();
      click(file!);
      /* The note reply is another read; wait for the rendered semantics. */
      await waitFor(() => detailText(page.root).includes('模块语义：只读源码'), 5_000);
      const text = detailText(page.root);
      expect(text).toContain('src/module.ts');
      expect(text).toContain('可领取');
      expect(text).toContain('执行者');
      expect(text).toContain('模块语义：只读源码');
      const note = [...log.calls].reverse().find((entry) => entry.route === 'notes/list');
      expect(note).toBeDefined();
      const anchor = asRecord(note!.input)['anchor'];
      /* 具名改坏: 把 `notes/list` 改成 `{goalId, state:'accepted'}` 桶；
         E3A-10 的 `anchor` 等值断言红。 */
      expect([{ kind: 'module', moduleId: E3A.moduleId }, { kind: 'file', path: E3A.filePath }]).toContainEqual(anchor);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-11 the file leaf is s-claimable and the missing items say 还没接通', async () => {
    const world = await openWithPlan();
    const { page } = await bootE3N(world, 'ArchOverview', { search: '?goal=' + world.goals.first.goalId });
    try {
      const row = nodeNamed(page.root, E3A.filePath);
      expect(row).toBeDefined();
      /* 具名改坏: 把文件状态改成按 `actualFiles`（没读）或写死 `s-satisfied`；
         E3A-11 的 `s-claimable` 红。 */
      expect(statusClasses(row!)).toContain('s-claimable');
      expect(statusClasses(row!)).not.toContain('s-none');
      click(row!);
      /* A3: file-to-file imports have no public route, so the file detail says
         还没接通 instead of claiming an empty (or zero) edge set. Each named
         row is its own value: the file's status/why also carries the word. */
      const imported = relationGroup(page.root, '引用');
      const importers = relationGroup(page.root, '被引用');
      expect(imported).toBeDefined();
      expect(importers).toBeDefined();
      /* 具名改坏: 把 `引用`/`被引用` 的值改成 `0 处引用`/`0 个来源`（`:1864-1865`）；
         E3A-11 的逐项 `还没接通` 等值断言红。 */
      expect(textOf(imported!)).toBe('还没接通');
      expect(textOf(importers!)).toBe('还没接通');
      expect(detailText(page.root)).toContain('引用');
      expect(detailText(page.root)).toContain('被引用');
      expect(detailText(page.root)).toContain('还没接通');
      /* DARR B2 §4: the file's actual change is read now; no Run, so 改动 0.
         具名改坏: 把文件的“改动”留在 `还没接通`；E3A-11 的 `改动 0` 红。 */
      expect(detailText(page.root)).toContain('改动 0');
      expect(detailText(page.root)).not.toContain('不引用其它源码文件');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-12 the module edge detail says 还没接通 for the two file-level items', async () => {
    const world = await openWithArch();
    const { page } = await bootE3N(world, 'ArchOverview');
    try {
      /* A2: the one observed edge is the module dependency Other → WorkGraph;
         the root level is reached through the breadcrumb like the row says. */
      const top = nodeNamed(page.root, 'WorkGraph');
      expect(top).toBeDefined();
      click(top!);
      click(findButton(page.root, '进入这一层')!);
      const crumbs = crumbButtons(page.root);
      expect(crumbs.length).toBeGreaterThanOrEqual(2);
      click(crumbs[0]!);
      /* The label's hand-computed number is 1. */
      const count = findAllClass(page.root, 'ov-count').find((element) => element.textContent.trim() === '1');
      expect(count).toBeDefined();
      /* 具名改坏: 把边详情的“引用处数”留在 `还没接通`；E3A-12 的 `1 处引用` 红。 */
      click(count!);
      const text = detailText(page.root);
      expect(text).toContain('Other');
      expect(text).toContain('WorkGraph');
      expect(text).toContain('模块依赖');
      /* Each file-level row is its own value: the edge's status word also
         carries 还没接通, so a whole-panel substring proves nothing here. */
      const occurrences = relationGroup(page.root, '引用处数');
      const sourceFiles = relationGroup(page.root, '来源文件');
      expect(occurrences).toBeDefined();
      expect(sourceFiles).toBeDefined();
      /* DARR B2 §4: `count` reaches the page; the seed has one reference, so
         `引用处数` is the real 1; `来源文件` stays 还没接通.
         具名改坏: `引用处数` 留在 `this.nt()`，或 `来源文件` 写成数字；E3A-12 的逐项等值断言红。 */
      expect(textOf(occurrences!)).toBe('1 处引用');
      expect(textOf(sourceFiles!)).toBe('还没接通');
      expect(text).toContain('引用处数');
      expect(text).toContain('来源文件');
      expect(text).toContain('还没接通');
      /* A3: no fabricated file-to-file edge is drawn from the module edge. */
      expect(text).not.toContain('src/other/other.ts');
      expect(text).not.toContain('src/module.ts');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-13 the unchanged-files fold row says 还没接通 and changes nothing', async () => {
    const world = await openWithArch();
    const { page, log } = await bootE3N(world, 'ArchOverview');
    try {
      const top = nodeNamed(page.root, 'WorkGraph');
      expect(top).toBeDefined();
      click(top!);
      click(findButton(page.root, '进入这一层')!);
      const fold = foldRow(page.root);
      expect(fold).toBeDefined();
      /* 具名改坏: 点折叠行时展开/收起 60 个文件并改文字；E3A-13 的“页面文字不变”红。 */
      expect(fold!.textContent).toContain('还没接通');
      const beforeText = pageText(page);
      const beforeCalls = log.calls.length;
      click(fold!);
      expect(pageText(page)).toBe(beforeText);
      expect(log.calls.length).toBe(beforeCalls);
      expect(nodeNamed(page.root, E3A.filePath)).toBeDefined();
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-14 the file hover card names the file, its state and its line without a request', async () => {
    const world = await openWithPlan();
    const { page, log } = await bootE3N(world, 'ArchOverview', { search: '?goal=' + world.goals.first.goalId });
    try {
      const file = nodeNamed(page.root, E3A.filePath);
      expect(file).toBeDefined();
      const before = log.calls.length;
      /* 具名改坏: 悬停时 `readMore({noteAnchor:...})` 发 `notes/list`；
         E3A-14 的“悬停不发请求”红。 */
      hover(file!);
      const card = findClass(page.root, 'hcard');
      expect(card).toBeDefined();
      expect(card!.textContent).toContain('module.ts');
      expect(card!.textContent).toContain('可领取');
      expect(card!.textContent).toContain('执行者');
      expect(log.calls.length).toBe(before);
      leave(file!);
      expect(findClass(page.root, 'hcard')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-15 closing the detail, going up and entering the layer send no request', async () => {
    const world = await openWithArch();
    await writeArchNote(world);
    const { page, log } = await bootE3N(world, 'ArchOverview', { search: '?goal=' + world.goals.first.goalId });
    try {
      const top = nodeNamed(page.root, 'WorkGraph');
      expect(top).toBeDefined();
      click(top!);
      click(findButton(page.root, '进入这一层')!);
      expect(currentCrumb(page.root)).toBe('WorkGraph');
      const file = nodeNamed(page.root, E3A.filePath);
      expect(file).toBeDefined();
      click(file!);
      /* The file detail reads its anchor note. The note text only renders after
         that read publishes, so it is the row's own settle signal (no tick). */
      await waitFor(() => detailText(page.root).includes('模块语义：只读源码'), 5_000);
      const close = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && element.getAttribute('aria-label') === '关闭详情');
      expect(close).toBeDefined();
      const beforeFetches = page.pageFetches();
      /* Let every read in flight (the note write's notice included) land: the
         count must stay still for 150 ms before it is the baseline. */
      for (let last = -1; last !== log.calls.length;) {
        last = log.calls.length;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      const beforeClose = log.calls.length;
      /* 具名改坏: 关闭详情时调 `location.reload()` 或发路由；
         E3A-15 的 `pageFetches`/`assigned` 断言红。 */
      click(close!);
      expect(detail(page.root)).toBeUndefined();
      expect(intro(page.root)).toBeDefined();
      /* Closing withdraws the note demand; a withdrawal reads nothing (the
         reread would be asynchronous, so give it a turn before counting). */
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(log.calls.length).toBe(beforeClose);
      expect(page.pageFetches()).toBe(beforeFetches);
      expect(page.assigned()).toEqual([]);
      const crumbs = crumbButtons(page.root);
      expect(crumbs.length).toBeGreaterThanOrEqual(2);
      const beforeUp = log.calls.length;
      click(crumbs[crumbs.length - 2]!);
      expect(currentCrumb(page.root)).toBe('S6A request world');
      expect(log.calls.length).toBe(beforeUp);
      const workGraph = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && (element.getAttribute('class') ?? '').split(/\s+/).includes('ov-head')
        && element.textContent.includes('WorkGraph'));
      expect(workGraph).toBeDefined();
      click(workGraph!);
      const enter = findButton(page.root, '进入这一层');
      expect(enter).toBeDefined();
      const beforeEnter = log.calls.length;
      /* 具名改坏: 关闭详情时调 `location.reload()` 或发路由；
         E3A-15 的“不发请求”/`pageFetches` 红。 */
      click(enter!);
      expect(currentCrumb(page.root)).toBe('WorkGraph');
      expect(log.calls.length).toBe(beforeEnter);
      expect(page.assigned()).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-16 the legend and the theme toggle locally and write nothing', async () => {
    const world = await openWithArch();
    const { page, log } = await bootE3N(world, 'ArchOverview', { search: '?goal=' + world.goals.first.goalId });
    try {
      const before = log.calls.length;
      const legend = findButton(page.root, '图例');
      expect(legend).toBeDefined();
      expect(legend!.getAttribute('aria-pressed')).toBe('false');
      click(legend!);
      expect(findButton(page.root, '图例')!.getAttribute('aria-pressed')).toBe('true');
      expect(findClass(page.root, 'legend')).toBeDefined();
      click(findButton(page.root, '图例')!);
      expect(findButton(page.root, '图例')!.getAttribute('aria-pressed')).toBe('false');
      expect(findClass(page.root, 'legend')).toBeUndefined();
      const theme = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && /深色|浅色/.test(element.getAttribute('aria-label') ?? ''));
      expect(theme).toBeDefined();
      const root = findClass(page.root, 'ov');
      expect(root).toBeDefined();
      const hadLight = (root!.getAttribute('class') ?? '').split(/\s+/).includes('t-light');
      /* 具名改坏: 主题变化时发 `settings` 写或写 `localStorage`；
         E3A-16 的“无请求/无存储”红。 */
      click(theme!);
      expect((root!.getAttribute('class') ?? '').split(/\s+/).includes('t-light')).toBe(!hadLight);
      click(theme!);
      expect((root!.getAttribute('class') ?? '').split(/\s+/).includes('t-light')).toBe(hadLight);
      expect(log.calls.length).toBe(before);
      expect((globalThis as { localStorage?: unknown }).localStorage).toBeUndefined();
      expect((globalThis as { sessionStorage?: unknown }).sessionStorage).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 60_000);
});
