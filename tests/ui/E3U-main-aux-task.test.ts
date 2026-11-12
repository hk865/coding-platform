import { afterAll, describe, expect, it } from 'vitest';
import { findAllClass, findButton, findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import {
  auxPanel, auxTab, bootE3N, bootQuiet, countRoute, descendants, hasClass, quietPage, revealTreeNode, routesSince, textOf,
  treeNames, treeNode, waitFor, whyText,
  type PageLog,
} from './helpers/E3N-page.js';
import { click, hover, NOT_CONNECTED, notConnected } from './helpers/E3N-interact.js';
import { E3U_EMPTY_STAGE, E3U_WD_FIRST, E3U_WD_LATER, openW1, openW4, openWDeps } from './helpers/E3N-world.js';
import { callsOf, openMemberS7C, worldSlot } from './helpers/E3M-world.js';
import { openE3GW1 } from './helpers/E3G-world.js';
import { relationGroup } from './helpers/E3A-page.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3U T-B08–T-B11 (test sheet e3main-b-tests §1.2; wiring S01, S08, S09, S12,
 * S16–S19, S21): the right panel's 任务图 and 架构图 read the real plan and
 * catalog. The tree reuses the navigation's `lines/list` and `tasks/query`
 * (B-08): every read cycle reads `main/read` once, `lines/list` once and
 * `tasks/query` once (by hand: `readNav` reads each once, `readMain` reads
 * `main/read`; the first open is two cycles, the shell's and the board's).
 * Names are the fixtures' literals: W4's next Task `S7B3 V e3n-w4-next work`
 * (`refinementPlanFrom`), the catalog modules `S6A core`/`S6A UI`
 * (`s6aInitialCatalog`); the S7C plan's `s7c-m1` is module-scoped to `s6a-core`.
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);
const w4 = () => slot.use('W4', () => openW4(), (opened) => opened.world.close());
const s7c = () => slot.use('S7C', () => openMemberS7C(), (opened) => opened.s7c.close());
const w4Empty = () => slot.use('W4E', () => openW4({ emptyStage: true }), (opened) => opened.world.close());
const w1 = () => slot.use('W1', () => openW1(), (opened) => opened.world.close());
const g1 = () => slot.use('G1', () => openE3GW1(), (opened) => opened.world.close());
const wd = () => slot.use('WD', () => openWDeps(), (opened) => opened.world.close());

const NEXT = 'S7B3 V e3n-w4-next work';

/** Selects the tab `name` and waits for it; returns the log index the click starts at. */
async function pickTab(page: BootedPage, log: PageLog, name: string): Promise<number> {
  const before = log.calls.length;
  click(auxTab(page.root, name)!);
  await waitFor(() => auxTab(page.root, name)?.getAttribute('aria-selected') === 'true');
  return before;
}

const tooltip = (root: BootedPage['root']) => findElement(auxPanel(root) ?? root,
  (element) => element.getAttribute('role') === 'tooltip');

/** The search box's own note (`label.search .note`): the search counts and ruling 13's empty states. */
function qNoteOf(root: FakeElement): string {
  const label = findElement(auxPanel(root) ?? root, (element) => element.tagName.toLowerCase() === 'label' && hasClass(element, 'search'));
  return label === undefined ? '' : textOf(findClass(label, 'note'));
}

/** The `<dd>` after the `<dt>` named `key` (a hover card's or the detail's list). */
function ddOf(holder: FakeElement | undefined, key: string): string {
  if (holder === undefined) return '';
  const all = descendants(holder);
  const at = all.findIndex((element) => element.tagName.toLowerCase() === 'dt' && textOf(element) === key);
  return at < 0 ? '' : textOf(all.slice(at + 1).find((element) => element.tagName.toLowerCase() === 'dd'));
}

/** S12's 全部 (never pressed when the 架构图 tab opens: `ascope` starts at 'work'), pressed and settled. */
async function showAll(page: BootedPage, log: PageLog): Promise<void> {
  const all = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
    && element.getAttribute('aria-pressed') !== null && textOf(element) === '全部');
  expect(all, '全部').toBeDefined();
  click(all!);
  await quietPage(log);
}

const squareOf = (node: FakeElement | undefined): FakeElement | undefined => (node === undefined ? undefined : findClass(node, 'sq'));
/** The open detail's title; '' while no detail is drawn. */
const detailTitle = (root: FakeElement): string => {
  const detail = findClass(root, 'detail');
  return detail === undefined ? '' : textOf(findClass(detail, 'd-title'));
};
const detailReadsSince = (log: PageLog, from: number): unknown[] => callsOf(log, 'graph/detail', from)
  .map((call) => (call.input as { node?: { ref?: { taskId?: unknown } } }).node?.ref?.taskId);

/*
 * Row order (TESTS-12): the slot closes a world when the key changes, so W4E and
 * S7C go first and every W4 row of both describes follows in one run (W4 opens once).
 */
describe('E3U Main right panel: 任务图 and 架构图', () => {
  /* lead 11-12 item 3: a plan stage no task belongs to is not a pending leaf, and its square is a neutral one. */
  it('T-B08c a stage without tasks is not counted and draws no s-undefined', async () => {
    const opened = await w4Empty();
    const { page } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      await waitFor(() => treeNode(page.root, E3U_EMPTY_STAGE) !== undefined);
      const rootCount = textOf(findClass(treeNode(page.root, 'S6A goal one')!, 'tr-n'));
      /* 具名改坏: `src/ui/boards/Main.dc.html` 的 `auxTaskModel` 把空阶段当成待执行的叶子；这一句红（2/4）。 */
      expect(rootCount).toBe('2/3 已满足');
      expect(findClass(treeNode(page.root, E3U_EMPTY_STAGE)!, 's-none')).toBeDefined();
      expect(findAllClass(auxPanel(page.root)!, 's-undefined')).toHaveLength(0);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('T-B10 hovering a task reads nothing and names its module from graph/hover', async () => {
    const opened = await s7c();
    const { page, log } = await bootQuiet(opened.s7c.world, '?goal=s7c-goal');
    try {
      await pickTab(page, log, '架构图');
      await quietPage(log);
      const from = await pickTab(page, log, '任务图');
      const node = await revealTreeNode(page.root, 'Independent work s7c-m1');
      expect(node).toBeDefined();
      await quietPage(log);
      /* One graph/hover per read cycle of the tab (each label the reveal opens is one more cycle). */
      expect(callsOf(log, 'graph/hover', from).length).toBe(callsOf(log, 'main/read', from).length);
      const before = log.calls.length;
      hover(node!);
      await waitFor(() => tooltip(page.root) !== undefined);
      expect(log.calls.length).toBe(before);
      /* 具名改坏: `src/ui/boot.ts` 的 `readAuxPanel` 不填 `taskModules`（或 `Main.dc.html` 的 `auxTaskModel`
         把 `t.module` 写成 `''`）；这一句红。 */
      expect(textOf(tooltip(page.root))).toContain('S6A core');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('T-B08 任务图 draws the adopted plan from the navigation’s own reads', async () => {
    const opened = await w4();
    const { page, log } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      expect(countRoute(log, 'lines/list')).toBe(2);
      /* 具名改坏: `src/ui/boot.ts` 的 `readAuxPanel` 在任务页自己再读一次 `tasks/query`；先红在这一句
         （开页就带任务页签，两个读周期各多一次：4）。 */
      expect(countRoute(log, 'tasks/query')).toBe(2);
      await pickTab(page, log, '架构图');
      await quietPage(log);
      const from = await pickTab(page, log, '任务图');
      await revealTreeNode(page.root, NEXT);
      await waitFor(() => treeNames(page.root).includes(NEXT));
      await quietPage(log);
      expect(treeNames(page.root)).toEqual(expect.arrayContaining(['Independent work e3n-w4-work', 'Goal gate', NEXT]));
      const cycles = callsOf(log, 'main/read', from).length;
      expect(callsOf(log, 'tasks/query', from).length).toBe(cycles);
      expect(callsOf(log, 'lines/list', from).length).toBe(cycles);
    } finally {
      await page.restore();
    }
  }, 180_000);

  /* lead 11-12 item 2: a task without a stage hangs on its goal, as TaskMap's tree does (`TaskMap.dc.html:807`). */
  it('T-B08b W4’s tasks without a stage are named rows straight under the goal', async () => {
    const opened = await w4();
    const { page } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      await waitFor(() => treeNode(page.root, NEXT) !== undefined);
      const names = ['Independent work e3n-w4-work', 'Goal gate', NEXT];
      /* 具名改坏: `src/ui/adapters/goals.ts` 的 `goalTaskTree` 又给没有阶段的任务造一个空名的 `'stage'` 节点；这一句红。 */
      expect(treeNames(page.root)).not.toContain('');
      for (const name of names) expect(hasClass(treeNode(page.root, name)!, 'nb')).toBe(true);
      expect(treeNames(page.root)).toHaveLength(names.length + 1);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('T-B09 架构图 draws the catalog modules from architecture/read and never reads architecture/query', async () => {
    const opened = await w4();
    const { page, log } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      expect(countRoute(log, 'lines/list')).toBe(2);
      const from = await pickTab(page, log, '架构图');
      await quietPage(log);
      /* W4 has no running work, so the module branches are under 全部 (S12). */
      await showAll(page, log);
      await waitFor(() => treeNames(page.root).includes('S6A core'));
      await quietPage(log);
      expect(treeNames(page.root)).toEqual(expect.arrayContaining(['S6A core', 'S6A UI']));
      const cycles = callsOf(log, 'main/read', from).length;
      expect(callsOf(log, 'architecture/read', from).length).toBe(cycles);
      expect(countRoute(log, 'architecture/query')).toBe(0);
      /* 具名改坏: `src/ui/boot.ts` 的 `readAuxPanel` 在架构页自己再读一次 `lines/list`；这一句红。 */
      expect(callsOf(log, 'lines/list', from).length).toBe(cycles);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('T-B11 a clicked task opens its detail from graph/detail’s summary', async () => {
    const opened = await w4();
    const { page, log } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      await pickTab(page, log, '架构图');
      await quietPage(log);
      await pickTab(page, log, '任务图');
      const node = await revealTreeNode(page.root, NEXT);
      expect(node).toBeDefined();
      await quietPage(log);
      const before = log.calls.length;
      click(node!);
      await waitFor(() => detailTitle(page.root) === NEXT);
      await quietPage(log);
      const reads = callsOf(log, 'graph/detail', before);
      /* 具名改坏: `Main.dc.html` 的 `pickNode` 在 `!r.canOpen` 分支不调 `wantDetail(id)`；这一句红（点击之后 0 次 `graph/detail`）。 */
      expect(reads.length).toBeGreaterThanOrEqual(1);
      const first = reads[0]!.input as { section?: unknown; node?: { kind?: unknown; ref?: { taskId?: unknown } } };
      expect(first.section).toBe('summary');
      expect(first.node?.kind).toBe('task');
      expect(first.node?.ref?.taskId).toBe('e3n-w4-next');
    } finally {
      await page.restore();
    }
  }, 180_000);
});

/**
 * E3MBR batch 1 (cr-main-b SPEC-1/2/3/12/13/14/20, READS-4/11; lead rulings
 * 2, 6, 11–14, 17): a wired right panel draws the reads or its empty state,
 * never the prototype's sample. The expected words are the rulings' (13: the two
 * empty notes; 12/17: "—"), the goal bar's own display on the same page, the
 * prototype's (`没有匹配`, the work-scope note) or the worlds' literals.
 */
describe('E3U Main right panel: no sample on a wired page', () => {
  it('SPEC-3 ruling 12 and 17 a task card, the task detail and a module card say — for 负责 and 语义', async () => {
    const opened = await w4();
    const { page, log } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      const node = await revealTreeNode(page.root, NEXT);
      hover(node!);
      await waitFor(() => textOf(tooltip(page.root)).includes(NEXT));
      /* 具名改坏: `Main.dc.html` 的 `ownerOf` 去掉数据模式那一句；这一句红（样例工作线的“未分配……”）。 */
      expect(ddOf(tooltip(page.root), '负责')).toBe('—');
      click(node!);
      await quietPage(log);
      const detail = findClass(page.root, 'detail');
      expect(detailTitle(page.root)).toBe(NEXT);
      /* 具名改坏: `aux-panel.ts` 的 `auxTaskDetailOf` 的 `sem` 改回按 `stageName` 写；这一句红（空）。 */
      expect(ddOf(detail, '语义')).toBe('—');
      /* 具名改坏: `auxTaskDetailOf` 的 `agent` 改回 `detail.owner`；这一句红。 */
      expect(ddOf(detail, '负责的 Agent')).toBe('—');
      await pickTab(page, log, '架构图');
      await showAll(page, log);
      hover(treeNode(page.root, 'S6A core')!);
      await waitFor(() => textOf(tooltip(page.root)).includes('S6A core'));
      /* 具名改坏: `archOwner` 去掉数据模式那一句；这一句红（“还没有工作线改过这里的文件”）。 */
      expect(ddOf(tooltip(page.root), '负责')).toBe('—');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('ruling 6 coming back to 任务图 rereads the selected task’s detail; 关闭详情 withdraws it', async () => {
    const opened = await w4();
    const { page, log } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      click((await revealTreeNode(page.root, NEXT))!);
      await quietPage(log);
      await pickTab(page, log, '架构图');
      await quietPage(log);
      const from = await pickTab(page, log, '任务图');
      await quietPage(log);
      /* 具名改坏: `Main.dc.html` 的 `axDemand('task')` 又发 `detailTaskId: null`；这一句红（切回后不读详情）。 */
      expect(detailReadsSince(log, from)).toContain('e3n-w4-next');
      expect(ddOf(findClass(page.root, 'detail'), '语义')).toBe('—');
      const closeAt = log.calls.length;
      /* 具名改坏: `auxRenderVals` 合并后的 `close` 又调 `out.det.close()`（调到自己）；点击抛出，这一句红。 */
      click(findElement(findClass(page.root, 'detail')!, (element) => element.getAttribute('aria-label') === '关闭详情')!);
      await quietPage(log);
      expect(findClass(page.root, 'd-title')).toBeUndefined();
      expect(detailReadsSince(log, closeAt)).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('READS-11 a click on the goal row reads nothing', async () => {
    const opened = await w4();
    const { page, log } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      await waitFor(() => treeNode(page.root, 'S6A goal one') !== undefined);
      const before = log.calls.length;
      click(treeNode(page.root, 'S6A goal one')!);
      await quietPage(log);
      /* 具名改坏: `Main.dc.html` 的 `wire` 里 `wantDetail` 改回直接调 `axReadDetail`；这一句红（整页重读）。 */
      expect(routesSince(log, before)).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('SPEC-12c 当前工作 draws no module that keeps no current file', async () => {
    const opened = await w4();
    const { page, log } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      await pickTab(page, log, '架构图');
      await quietPage(log);
      /* W4 has no live Run: 当前工作 has no file (the prototype's note says so). */
      expect(textOf(findClass(auxPanel(page.root)!, 'pnote'))).toBe('现在没有执行中、需要你决定或失败的任务在改文件。切到“全部”看整棵树。');
      /* 具名改坏: `goals.ts` 的 `catalogArchTree` 在 `work !== null` 时不剪空模块；这一句红。 */
      expect(treeNames(page.root)).not.toContain('S6A core');
      expect(treeNames(page.root)).not.toContain('S6A UI');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('SPEC-20 a search without a hit at the catalog root says 没有匹配', async () => {
    const opened = await w4();
    const { page, log } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      await pickTab(page, log, '架构图');
      await showAll(page, log);
      const field = findElement(auxPanel(page.root)!, (element) => element.tagName.toLowerCase() === 'input'
        && element.getAttribute('type') === 'search')!;
      field.value = 'e3u-no-such-node';
      field.dispatch('input', { target: field, currentTarget: field });
      await waitFor(() => qNoteOf(page.root) !== '');
      /* 具名改坏: `auxArchModel` 不把目录根改成 'SYS'；这一句红（“本层没有匹配”）。 */
      expect(qNoteOf(page.root)).toBe('没有匹配');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('READS-4 reopening the panel on a node page reads that node’s map', async () => {
    const opened = await w4();
    const { page, log } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      click((await revealTreeNode(page.root, NEXT))!);
      await quietPage(log);
      click(findButton(findClass(page.root, 'detail')!, '新标签打开')!);
      await waitFor(() => findClass(page.root, 'is-page') !== undefined);
      click(findElement(auxPanel(page.root)!, (element) => element.getAttribute('aria-label') === '隐藏右栏')!);
      await quietPage(log);
      const from = log.calls.length;
      /* 具名改坏: `auxRenderVals` 的 `togglePanel` 打开那一支改回 `axRead(ptab)`；节点页什么都不读，下面两句红。 */
      click(findElement(page.root, (element) => element.getAttribute('aria-label') === '显示或隐藏右栏')!);
      await quietPage(log);
      expect(routesSince(log, from)).toContain('main/read');
      expect(textOf(findClass(findClass(page.root, 'is-page')!, 'd-title'))).toBe(NEXT);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('SPEC-2 a first read that failed draws no sample tree in the right panel', async () => {
    const opened = await w1();
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal', unavailable: 'main/read' });
    try {
      await waitFor(() => page.root.textContent.includes('暂时读不到，可以重试。'));
      await quietPage(log);
      /* 具名改坏: `Main.dc.html` 的 `dataMode` 又要求 `props.data`；这一句红（原型的样例任务）。 */
      expect(treeNames(page.root).filter((name) => name !== '')).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('SPEC-12a ruling 13 a goal without a plan: the note says so; the root counts and reads as the goal bar', async () => {
    const opened = await w1();
    const { page } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      await waitFor(() => treeNode(page.root, 'S6A goal one') !== undefined);
      /* 具名改坏: `auxRenderVals` 删掉无计划那一格；这一句红。 */
      expect(qNoteOf(page.root)).toBe('这个目标还没有采用的计划');
      const bar = textOf(findClass(page.root, 'gb-item'));
      expect(bar).toBe('0/0 已满足');
      /* 具名改坏: `aux-panel.ts` 的 `auxLeafCountsOf` 把没有孩子的目标算成一片叶子；这一句红（“0/1 已满足”）。 */
      expect(textOf(findClass(treeNode(page.root, 'S6A goal one')!, 'tr-n'))).toBe(bar);
      hover(treeNode(page.root, 'S6A goal one')!);
      await waitFor(() => tooltip(page.root) !== undefined);
      /* W1's goal one has no plan: its display word is 规划中, the goal bar's word on the same page. */
      const word = textOf(findClass(page.root, 'gb-state')).replace(whyText(page.root, 'Main'), '');
      expect(textOf(findClass(tooltip(page.root)!, 'hc-state'))).toBe('规划中 · 0/0 已满足');
      expect(word).toBe('规划中');
      /* 规划中 is the display's PLANNING, state `pending` (`goalDisplayState`, task-map.ts). */
      /* 具名改坏: `goalSt` 去掉数据模式那一句；这一句红（样例的 `tx-future`）。 */
      expect(hasClass(findElement(findClass(tooltip(page.root)!, 'hc-state')!, (element) => element.tagName.toLowerCase() === 'span')!,
        'tx-pending')).toBe(true);
      /* 具名改坏: `goalAgent` 去掉数据模式那一句；这一句红（“秘书 · 待命……”）。 */
      expect(ddOf(tooltip(page.root), '负责')).toBe('—');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('SPEC-12b ruling 13 no adopted architecture: the note says so, not the work-scope note', async () => {
    const opened = await w1();
    const { page, log } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      await pickTab(page, log, '架构图');
      await quietPage(log);
      /* 具名改坏: `auxRenderVals` 删掉“还没有采纳的架构”那一格；这一句红。 */
      expect(qNoteOf(page.root)).toBe('还没有采纳的架构');
      expect(findClass(auxPanel(page.root)!, 'pnote')).toBeUndefined();
      await showAll(page, log);
      expect(qNoteOf(page.root)).toBe('还没有采纳的架构');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('SPEC-13 ruling 11 and 14 轨道 is drawn unconnected and the tree stays', async () => {
    const opened = await w1();
    const { page, log } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      await waitFor(() => treeNode(page.root, 'S6A goal one') !== undefined);
      const lanes = findElement(auxPanel(page.root)!, (element) => element.tagName.toLowerCase() === 'button' && textOf(element) === '轨道');
      /* 具名改坏: `auxRenderVals` 删掉 `viewLanesCls` 的 `is-off`；`notConnected` 里的 is-off 断言红。 */
      expect(notConnected(lanes!)).toBe(NOT_CONNECTED);
      await quietPage(log);
      expect(lanes!.getAttribute('aria-pressed')).not.toBe('true');
      expect(treeNames(page.root)).toContain('S6A goal one');
    } finally {
      await page.restore();
    }
  }, 180_000);

  /* E3G W1: the catalog declares `src/ui/views.ts` under S6A UI and goal one's work Task plans it (E3G_OVERLAP). */
  it('SPEC-1 SPEC-3 a planned file keeps its task’s state and its module’s 语义; a module opens its detail, — for what was not read', async () => {
    const opened = await g1();
    const { page, log } = await bootQuiet(opened.world, '?goal=ag2b-goal');
    try {
      const work = await revealTreeNode(page.root, 'Independent work e3g-one-work');
      /* The task tab draws the planned work Task 可领取 (it has not started). */
      expect(hasClass(squareOf(work)!, 's-claimable')).toBe(true);
      await pickTab(page, log, '架构图');
      await showAll(page, log);
      const file = treeNode(page.root, 'views.ts');
      /* 具名改坏: `auxArchModel` 又调 `archAttach`；这一句红（`s-none`，本目标未改动）。 */
      expect(hasClass(squareOf(file)!, 's-claimable')).toBe(true);
      hover(file!);
      await waitFor(() => textOf(tooltip(page.root)).includes('views.ts'));
      /* 具名改坏: `fileSem` 去掉数据模式那一句；这一句红（样例的“工作台的视图……”）。 */
      expect(ddOf(tooltip(page.root), '语义')).toBe('S6A UI: the main conversation');
      /* Found in passing: a catalog module had no `area`, so its detail read `null.path` and the click threw. */
      click(treeNode(page.root, 'S6A UI')!);
      await quietPage(log);
      expect(detailTitle(page.root)).toBe('S6A UI');
      /* The 架构图 tab reads no task tree and the catalog gives no imports, so neither relation draws a conclusion. */
      const detail = findClass(page.root, 'detail')!;
      /* 具名改坏: `Main.dc.html` 的 `archDetail` 任务一格去掉数据模式那一句；这一句红（“本目标没有任务改动这里”）。 */
      expect(textOf(relationGroup(detail, '任务'))).toBe('—');
      /* 具名改坏: `archDetail` 依赖一格去掉数据模式那一句；这一句红（“没有引用其他模块”）。 */
      expect(textOf(relationGroup(detail, '依赖'))).toBe('—');
    } finally {
      await page.restore();
    }
  }, 180_000);

  /* WD: `Independent work e3u-wd-later` and `Goal gate` depend on `Independent work e3u-wd-first`; none has
     started, so the later work Task is 可领取 and the gate 待执行 (the tree draws both). */
  it('SPEC-14 a related task in the detail is hollow until it starts, draws its line and opens on a click', async () => {
    const FIRST = 'Independent work ' + E3U_WD_FIRST;
    const LATER = 'Independent work ' + E3U_WD_LATER;
    const opened = await wd();
    const { page, log } = await bootQuiet(opened.world, `?goal=${opened.goal.goalId}`);
    try {
      click((await revealTreeNode(page.root, FIRST))!);
      await quietPage(log);
      expect(hasClass(squareOf(treeNode(page.root, 'Goal gate'))!, 's-notyet')).toBe(true);
      const detail = findClass(page.root, 'detail')!;
      expect(ddOf(detail, '语义')).toBe('—');
      const items = findAllClass(detail, 'd-item');
      const gate = items.find((item) => textOf(item) === 'Goal gate');
      /* 具名改坏: `auxRenderVals` 不再把合并后的 det 过 `tpDetail`；这一句红（实心的 `s-pending`）。 */
      expect(hasClass(squareOf(gate)!, 's-notyet')).toBe(true);
      const later = items.find((item) => textOf(item) === LATER);
      hover(later!);
      /* 具名改坏: `auxRenderVals` 不给关系条目补 `over`；这一句红（没有依赖连线）。 */
      await waitFor(() => findClass(auxPanel(page.root)!, 'deps') !== undefined);
      const from = log.calls.length;
      click(later!);
      await quietPage(log);
      /* 具名改坏: `auxRenderVals` 不给关系条目补 `go`；这两句红（详情不动、不读）。 */
      expect(detailTitle(page.root)).toBe(LATER);
      expect(detailReadsSince(log, from)).toContain(E3U_WD_LATER);
    } finally {
      await page.restore();
    }
  }, 180_000);
});
