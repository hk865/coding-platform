import { afterAll, describe, expect, it } from 'vitest';
import { findAllClass, findButton, findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import {
  auxPanel, countRoute, hasClass, onMain, pickTab, quietPage, revealTreeNode, routesSince, textOf,
  treeNames, treeNode, waitFor, whyText,
  type PageLog,
} from './helpers/E3N-page.js';
import { click, hover, NOT_CONNECTED, notConnected } from './helpers/E3N-interact.js';
import { E3U_EMPTY_STAGE, E3U_WD_FIRST, E3U_WD_LATER, openW1, openW4, openWDeps } from './helpers/E3N-world.js';
import { callsOf, openMemberS7C, worldSlot } from './helpers/E3M-world.js';
import { openE3GW1 } from './helpers/E3G-world.js';
import { relationGroup } from './helpers/E3A-page.js';
import { dlValue } from './helpers/E3C-world.js';
import { openS6ARequestWorld } from '../helpers/S6A-request-fixture.js';
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
const w4 = async () => (await slot.use('W4', () => openW4(), (opened) => opened.world.close())).world;
const s7c = async () => (await slot.use('S7C', () => openMemberS7C(), (opened) => opened.s7c.close())).s7c.world;
const w4Empty = async () => (await slot.use('W4E', () => openW4({ emptyStage: true }), (opened) => opened.world.close())).world;
const w1 = async () => (await slot.use('W1', () => openW1(), (opened) => opened.world.close())).world;
const g1 = async () => (await slot.use('G1', () => openE3GW1(), (opened) => opened.world.close())).world;
const wd = () => slot.use('WD', () => openWDeps(), (opened) => opened.world.close());
const w0 = () => slot.use('W0', () => openS6ARequestWorld({ backend: 'memory', defaultGoals: false }), (world) => world.close());

const NEXT = 'S7B3 V e3n-w4-next work';

const tooltip = (root: BootedPage['root']) => findElement(auxPanel(root) ?? root,
  (element) => element.getAttribute('role') === 'tooltip');

/** The search box's own note (`label.search .note`): the search counts and ruling 13's empty states. */
function qNoteOf(root: FakeElement): string {
  const label = findElement(auxPanel(root) ?? root, (element) => element.tagName.toLowerCase() === 'label' && hasClass(element, 'search'));
  return label === undefined ? '' : textOf(findClass(label, 'note'));
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
    await onMain(await w4Empty(), async (page) => {
      await waitFor(() => treeNode(page.root, E3U_EMPTY_STAGE) !== undefined);
      const rootCount = textOf(findClass(treeNode(page.root, 'S6A goal one')!, 'tr-n'));
      /* 具名改坏: `src/ui/boards/Main.dc.html` 的 `auxTaskModel` 把空阶段当成待执行的叶子；这一句红（2/4）。 */
      expect(rootCount).toBe('2/3 已满足');
      expect(findClass(treeNode(page.root, E3U_EMPTY_STAGE)!, 's-none')).toBeDefined();
      expect(findAllClass(auxPanel(page.root)!, 's-undefined')).toHaveLength(0);
    });
  }, 180_000);

  it('T-B10 hovering a task reads nothing and names its module from graph/hover', async () => {
    await onMain(await s7c(), async (page, log) => {
      await pickTab(page, log, '架构图');
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
    }, { search: '?goal=s7c-goal' });
  }, 180_000);

  it('T-B08 任务图 draws the adopted plan from the navigation’s own reads', async () => {
    await onMain(await w4(), async (page, log) => {
      expect(countRoute(log, 'lines/list')).toBe(2);
      /* 具名改坏: `src/ui/boot.ts` 的 `readAuxPanel` 在任务页自己再读一次 `tasks/query`；先红在这一句
         （开页就带任务页签，两个读周期各多一次：4）。 */
      expect(countRoute(log, 'tasks/query')).toBe(2);
      await pickTab(page, log, '架构图');
      const from = await pickTab(page, log, '任务图');
      await revealTreeNode(page.root, NEXT);
      await waitFor(() => treeNames(page.root).includes(NEXT));
      await quietPage(log);
      const cycles = callsOf(log, 'main/read', from).length;
      expect(callsOf(log, 'tasks/query', from).length).toBe(cycles);
      expect(callsOf(log, 'lines/list', from).length).toBe(cycles);
    });
  }, 180_000);

  /* lead 11-12 item 2: a task without a stage hangs on its goal, as TaskMap's tree does (`TaskMap.dc.html:807`). */
  it('T-B08b W4’s tasks without a stage are named rows straight under the goal', async () => {
    await onMain(await w4(), async (page) => {
      await waitFor(() => treeNode(page.root, NEXT) !== undefined);
      const names = ['Independent work e3n-w4-work', 'Goal gate', NEXT];
      /* 具名改坏: `src/ui/adapters/goals.ts` 的 `goalTaskTree` 又给没有阶段的任务造一个空名的 `'stage'` 节点；这一句红。 */
      expect(treeNames(page.root)).not.toContain('');
      for (const name of names) expect(hasClass(treeNode(page.root, name)!, 'nb')).toBe(true);
      expect(treeNames(page.root)).toHaveLength(names.length + 1);
    });
  }, 180_000);

  it('T-B09 架构图 draws the catalog modules from architecture/read and never reads architecture/query', async () => {
    await onMain(await w4(), async (page, log) => {
      const from = await pickTab(page, log, '架构图');
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
      /* M6: the tab's task names are `nav.tasks`, never a read of its own. */
      expect(callsOf(log, 'tasks/query', from).length).toBe(cycles);
    });
  }, 180_000);

  it('T-B11 a clicked task opens its detail from graph/detail’s summary', async () => {
    await onMain(await w4(), async (page, log) => {
      await pickTab(page, log, '架构图');
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
      /* Ruling 8: only graph/detail names a participant. NEXT has none (owners [], 0 lines); the satisfied work
         Task's executor line took part and is not responsible now, so it is 曾参与 (decision 49·01). */
      const work = 'Independent work e3n-w4-work';
      click((await revealTreeNode(page.root, work))!);
      await waitFor(() => detailTitle(page.root) === work);
      await quietPage(log);
      /* 具名改坏: `Main.dc.html` 的 `auxRenderVals` 不用 `aux.task.det` 覆盖 `out.det`；这一句红（只看树的详情没有“参与”）。 */
      expect(textOf(relationGroup(findClass(page.root, 'detail')!, '参与'))).toBe(`${work} · 曾参与`);
    });
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
    await onMain(await w4(), async (page, log) => {
      const node = await revealTreeNode(page.root, NEXT);
      hover(node!);
      await waitFor(() => textOf(tooltip(page.root)).includes(NEXT));
      /* 具名改坏: `Main.dc.html` 的 `ownerOf` 去掉数据模式那一句；这一句红（样例工作线的“未分配……”）。 */
      expect(dlValue(tooltip(page.root), '负责')).toBe('—');
      click(node!);
      await quietPage(log);
      const detail = findClass(page.root, 'detail');
      expect(detailTitle(page.root)).toBe(NEXT);
      /* 具名改坏: `aux-panel.ts` 的 `auxTaskDetailOf` 的 `sem` 改回按 `stageName` 写；这一句红（空）。 */
      expect(dlValue(detail, '语义')).toBe('—');
      /* 具名改坏: `auxTaskDetailOf` 的 `agent` 改回 `detail.owner`；这一句红。 */
      expect(dlValue(detail, '负责的 Agent')).toBe('—');
      await pickTab(page, log, '架构图');
      await showAll(page, log);
      hover(treeNode(page.root, 'S6A core')!);
      await waitFor(() => textOf(tooltip(page.root)).includes('S6A core'));
      /* 具名改坏: `archOwner` 去掉数据模式那一句；这一句红（“还没有工作线改过这里的文件”）。 */
      expect(dlValue(tooltip(page.root), '负责')).toBe('—');
    });
  }, 180_000);

  it('ruling 6 coming back to 任务图 rereads the selected task’s detail; 关闭详情 withdraws it', async () => {
    await onMain(await w4(), async (page, log) => {
      click((await revealTreeNode(page.root, NEXT))!);
      await quietPage(log);
      await pickTab(page, log, '架构图');
      const from = await pickTab(page, log, '任务图');
      /* 具名改坏: `Main.dc.html` 的 `axDemand('task')` 又发 `detailTaskId: null`；这一句红（切回后不读详情）。 */
      expect(detailReadsSince(log, from)).toContain('e3n-w4-next');
      const closeAt = log.calls.length;
      /* 具名改坏: `auxRenderVals` 合并后的 `close` 又调 `out.det.close()`（调到自己）；点击抛出，这一句红。 */
      click(findElement(findClass(page.root, 'detail')!, (element) => element.getAttribute('aria-label') === '关闭详情')!);
      await quietPage(log);
      expect(findClass(page.root, 'd-title')).toBeUndefined();
      expect(detailReadsSince(log, closeAt)).toEqual([]);
    });
  }, 180_000);

  it('READS-11 a click on the goal row reads nothing', async () => {
    await onMain(await w4(), async (page, log) => {
      await waitFor(() => treeNode(page.root, 'S6A goal one') !== undefined);
      const before = log.calls.length;
      click(treeNode(page.root, 'S6A goal one')!);
      await quietPage(log);
      /* 具名改坏: `Main.dc.html` 的 `wire` 里 `wantDetail` 改回直接调 `axReadDetail`；这一句红（整页重读）。 */
      expect(routesSince(log, before)).toEqual([]);
      /* Ruling 17: the tree-only detail (a goal, a stage, a node page, a task before graph/detail) has no 语义 either.
         具名改坏: `Main.dc.html` 的 `taskDetail` 的 `sem` 去掉数据模式那一句；这一句红（空）。 */
      expect(dlValue(findClass(page.root, 'detail'), '语义')).toBe('—');
    });
  }, 180_000);

  it('SPEC-12c 当前工作 draws no module that keeps no current file', async () => {
    await onMain(await w4(), async (page, log) => {
      await pickTab(page, log, '架构图');
      /* W4 has no live Run: 当前工作 has no file (the prototype's note says so). */
      expect(textOf(findClass(auxPanel(page.root)!, 'pnote'))).toBe('现在没有执行中、需要你决定或失败的任务在改文件。切到“全部”看整棵树。');
      /* 具名改坏: `goals.ts` 的 `catalogArchTree` 在 `work !== null` 时不剪空模块；这一句红。 */
      expect(treeNames(page.root)).not.toContain('S6A core');
      expect(treeNames(page.root)).not.toContain('S6A UI');
    });
  }, 180_000);

  it('SPEC-20 a search without a hit at the catalog root says 没有匹配', async () => {
    await onMain(await w4(), async (page, log) => {
      await pickTab(page, log, '架构图');
      await showAll(page, log);
      const field = findElement(auxPanel(page.root)!, (element) => element.tagName.toLowerCase() === 'input'
        && element.getAttribute('type') === 'search')!;
      field.value = 'e3u-no-such-node';
      field.dispatch('input', { target: field, currentTarget: field });
      await waitFor(() => qNoteOf(page.root) !== '');
      /* 具名改坏: `auxArchModel` 不把目录根改成 'SYS'；这一句红（“本层没有匹配”）。 */
      expect(qNoteOf(page.root)).toBe('没有匹配');
    });
  }, 180_000);

  it('READS-4 reopening the panel on a node page reads that node’s map', async () => {
    await onMain(await w4(), async (page, log) => {
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
    });
  }, 180_000);

  /* M7 (lead 11-12): with no tree read, the map draws no unnamed root and no empty square, only its note: the
     head's own sentence for a project without a Goal (DC4), the failed read's text, nothing while it is on its way. */
  it.each([
    { entry: 'a project without a Goal', world: 'W0', unavailable: undefined, note: '还没有目标' },
    { entry: 'a first read that failed', world: 'W1', unavailable: 'main/read', note: '暂时读不到，可以重试。' },
    { entry: 'a first read on its way', world: 'W1', unavailable: undefined, note: '' },
  ])('SPEC-2 M7 the right panel draws no sample and no unnamed root: $entry', async ({ entry, world, unavailable, note }) => {
    /* On its way: the page as it is when its first `main/read` leaves, read through the page's own document. */
    const early: Array<{ names: string[]; note: string }> = [];
    await onMain(world === 'W0' ? await w0() : await w1(), async (page) => {
      const shown = entry === 'a first read on its way' ? early[0]! : { names: treeNames(page.root), note: qNoteOf(page.root) };
      /* 具名改坏: `Main.dc.html` 的 `dataMode` 又要求 `props.data`；这一句红（原型的样例任务）。
         具名改坏: `auxRenderVals` 删掉 M7 那一格（没有树时不清 `rows`）；这一句红（['']）。 */
      expect(shown.names).toEqual([]);
      expect(shown.note).toBe(note);
    }, {
      search: world === 'W0' ? '' : '?goal=ag2b-goal', mode: 'stream',
      ...(unavailable === undefined ? {} : { unavailable }),
      before: { 'main/read': async () => {
        const root = (globalThis as { document?: { querySelector(selector: string): FakeElement | null } }).document?.querySelector('x-dc');
        if (early.length === 0 && root) early.push({ names: treeNames(root), note: qNoteOf(root) });
      } },
    });
  }, 180_000);

  it('SPEC-12a ruling 13 a goal without a plan: the note says so; the root counts and reads as the goal bar', async () => {
    await onMain(await w1(), async (page) => {
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
      expect(dlValue(tooltip(page.root), '负责')).toBe('—');
    });
  }, 180_000);

  it('SPEC-12b ruling 13 no adopted architecture: the note says so, not the work-scope note', async () => {
    await onMain(await w1(), async (page, log) => {
      await pickTab(page, log, '架构图');
      /* 具名改坏: `auxRenderVals` 删掉“还没有采纳的架构”那一格；这一句红。 */
      expect(qNoteOf(page.root)).toBe('还没有采纳的架构');
      expect(findClass(auxPanel(page.root)!, 'pnote')).toBeUndefined();
      /* M7: no unnamed system root either. */
      expect(treeNames(page.root)).toEqual([]);
      await showAll(page, log);
      expect(qNoteOf(page.root)).toBe('还没有采纳的架构');
    });
  }, 180_000);

  it('SPEC-13 ruling 11 and 14 轨道 is drawn unconnected and the tree stays', async () => {
    await onMain(await w1(), async (page, log) => {
      await waitFor(() => treeNode(page.root, 'S6A goal one') !== undefined);
      const lanes = findElement(auxPanel(page.root)!, (element) => element.tagName.toLowerCase() === 'button' && textOf(element) === '轨道');
      /* 具名改坏: `auxRenderVals` 删掉 `viewLanesCls` 的 `is-off`；`notConnected` 里的 is-off 断言红。 */
      expect(notConnected(lanes!)).toBe(NOT_CONNECTED);
      await quietPage(log);
      expect(lanes!.getAttribute('aria-pressed')).not.toBe('true');
      expect(treeNames(page.root)).toContain('S6A goal one');
    });
  }, 180_000);

  /* E3G W1: the catalog declares `src/ui/views.ts` under S6A UI and goal one's work Task plans it (E3G_OVERLAP). */
  it('SPEC-1 SPEC-3 a planned file keeps its task’s state and its module’s 语义; a module opens its detail, — for what was not read', async () => {
    await onMain(await g1(), async (page, log) => {
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
      expect(dlValue(tooltip(page.root), '语义')).toBe('S6A UI: the main conversation');
      /* Found in passing: a catalog module had no `area`, so its detail read `null.path` and the click threw. */
      click(treeNode(page.root, 'S6A UI')!);
      await quietPage(log);
      expect(detailTitle(page.root)).toBe('S6A UI');
      /* M6: the 架构图 tab names the module's tasks from `nav.tasks`; the catalog gives no imports, so 依赖 draws no conclusion. */
      const detail = findClass(page.root, 'detail')!;
      /* 具名改坏: `boot.ts` 的 `readAuxPanel` 架构分支不带任务树；这一句红（“—”）。 */
      expect(textOf(relationGroup(detail, '任务'))).toBe('Independent work e3g-one-work');
      /* 具名改坏: `archDetail` 依赖一格去掉数据模式那一句；这一句红（“没有引用其他模块”）。 */
      expect(textOf(relationGroup(detail, '依赖'))).toBe('—');
    });
  }, 180_000);

  /* WD: `Independent work e3u-wd-later` and `Goal gate` depend on `Independent work e3u-wd-first`; none has
     started, so the later work Task is 可领取 and the gate 待执行 (the tree draws both). */
  it('SPEC-14 a related task in the detail is hollow until it starts, draws its line and opens on a click', async () => {
    const FIRST = 'Independent work ' + E3U_WD_FIRST;
    const LATER = 'Independent work ' + E3U_WD_LATER;
    const opened = await wd();
    await onMain(opened.world, async (page, log) => {
      click((await revealTreeNode(page.root, FIRST))!);
      await quietPage(log);
      expect(hasClass(squareOf(treeNode(page.root, 'Goal gate'))!, 's-notyet')).toBe(true);
      const detail = findClass(page.root, 'detail')!;
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
    }, { search: `?goal=${opened.goal.goalId}` });
  }, 180_000);
});
