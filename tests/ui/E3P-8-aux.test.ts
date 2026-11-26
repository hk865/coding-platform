import { afterAll, describe, expect, it } from 'vitest';
import { findElement } from './helpers/boot-page.js';
import {
  auxPanel, auxTab, callsOf, countRoute, hasClass, onBoard, quietPage, revealTreeNode, textOf, treeNames, treeNode, waitFor,
  type PageLog,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { conflictCard, openPAW2 } from './helpers/E3P-world.js';
import { openW4, openWGit } from './helpers/E3N-world.js';
import { openE3GW1 } from './helpers/E3G-world.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3P-8 (batch 5b): the Plan page's right panel reads `data.aux` through
 * `readAuxPanel` — the two maps, node details, commands and Diff — and the
 * plan card, conflict card and decision card jump into it. The worlds are the
 * existing Host scenarios (W4, W-Git, PAW2, E3G W1); names are their literals.
 */

const NEXT = 'S7B3 V e3n-w4-next work';

/** The open detail's title; '' while no detail is drawn. */
function detailTitle(root: FakeElement): string {
  const detail = findElement(auxPanel(root) ?? root, (element) => hasClass(element, 'detail'));
  return detail === undefined ? '' : textOf(findElement(detail, (element) => hasClass(element, 'd-title')));
}

/** The calls of one route that started at or after `from` (`callsOf` has no window). */
function since(log: PageLog, route: string, from: number): ReturnType<typeof callsOf> {
  return log.calls.slice(from).filter((call) => call.route === route);
}

/** One `graph/detail` read's section and the task it named. */
function detailReads(log: PageLog, from: number): { section: string; taskId: string }[] {
  return since(log, 'graph/detail', from).map((call) => {
    const input = call.input as { section?: unknown; node?: { ref?: { taskId?: unknown } } };
    return { section: String(input.section), taskId: String(input.node?.ref?.taskId) };
  });
}

/** The changed-file row of `path` on the Diff tab (its button carries the path as title). */
function diffRow(root: FakeElement, path: string): FakeElement | undefined {
  return findElement(auxPanel(root) ?? root, (element) => element.tagName.toLowerCase() === 'button'
    && element.getAttribute('title') === path);
}

const w4 = await openW4();
const wgit = await openWGit();
const paw = await openPAW2();
const w3 = await openE3GW1();
afterAll(async () => {
  await w4.world.close().catch(() => undefined);
  await wgit.world.close().catch(() => undefined);
  await paw.world.close().catch(() => undefined);
  await w3.world.close().catch(() => undefined);
});

describe('E3P-8 Plan right panel', () => {
  it('① 任务图 draws the adopted plan straight under the goal, reads a task detail on click, and hides with no map read', async () => {
    await onBoard('Plan', w4.world, async (page, log) => {
      /* 开页读两轮（shell 和板各一轮，同 Main 的 T-B08 数 `lines/list` 2 次），每轮读一次任务图（F8）。 */
      expect(countRoute(log, 'graph/hover')).toBe(2);
      const names = ['Independent work e3n-w4-work', 'Goal gate', NEXT];
      for (const name of names) expect(await revealTreeNode(page.root, name), name).toBeDefined();
      const panel = textOf(auxPanel(page.root)!);
      expect(panel).not.toContain('工作台界面改版');
      expect(panel).not.toContain('方案草稿');
      for (const name of names) expect(hasClass(treeNode(page.root, name)!, 'cc')).toBe(false);
      expect(treeNames(page.root)).toEqual(expect.arrayContaining(names));

      const node = treeNode(page.root, 'Independent work e3n-w4-work')!;
      const before = log.calls.length;
      click(node);
      await waitFor(() => detailTitle(page.root) === 'Independent work e3n-w4-work');
      await quietPage(log);
      const reads = detailReads(log, before);
      /* 具名改坏: `Plan.dc.html` 的 `pickIt` 只 set `sel` 不调 `axReadDetail`；reads 为 0，这三句红。 */
      expect(reads.map((read) => read.section)).toEqual(['summary', 'participants', 'risks']);
      expect(reads[0]!.taskId).toBe('e3n-w4-work');

      const hide = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && element.getAttribute('aria-label') === '隐藏右栏')!;
      const from = log.calls.length;
      click(hide);
      await quietPage(log);
      /* 具名改坏: `axView` 的 `hide` 不撤回右栏的读；`graph/hover` 又读一次，这一句红。 */
      expect(since(log, 'main/read', from).length).toBeGreaterThanOrEqual(1);
      expect(since(log, 'graph/hover', from)).toHaveLength(0);
    });
  }, 180_000);

  it('② Diff reads the one listed workspace and 文件 stays unconnected', async () => {
    await onBoard('Plan', wgit.world, async (page, log) => {
      const from = log.calls.length;
      click(auxTab(page.root, 'Diff')!);
      await waitFor(() => diffRow(page.root, 'src/module.ts') !== undefined);
      await quietPage(log);
      /* 具名改坏: `Plan.dc.html` 的 `axView` Diff 页仍画样例行、不调 `axRead('diff')`；两句红。 */
      expect(since(log, 'files/uncommitted', from)).toHaveLength(1);
      expect(since(log, 'files/list', from)).toHaveLength(1);
      expect(countRoute(log, 'files/compare')).toBe(0);

      const files = auxTab(page.root, '文件')!;
      expect(files.getAttribute('aria-disabled')).toBe('true');
      expect(files.getAttribute('title')).toBe('还没接通');
      const before = log.calls.length;
      click(files);
      await quietPage(log);
      expect(log.calls.length).toBe(before);
    });
  }, 180_000);

  it('③ a plan-card change row opens that task’s detail in the task map', async () => {
    await onBoard('Plan', paw.world, async (page, log) => {
      const row = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === 'PA work v2');
      expect(row, 'PA work v2').toBeDefined();
      /* 具名改坏: `planCardVals` 不查 `mapTaskIds`、改动行仍 `pd-ref is-off`；这一句红。 */
      expect(hasClass(row!, 'is-off')).toBe(false);
      const before = log.calls.length;
      click(row!);
      await waitFor(() => auxTab(page.root, '任务图')?.getAttribute('aria-selected') === 'true');
      await quietPage(log);
      const reads = detailReads(log, before);
      expect(reads.map((read) => read.section)).toEqual(['summary', 'participants', 'risks']);
      expect(reads[0]!.taskId).toBe('pa-work');
    });
  }, 180_000);

  it('④ the conflict card lights the overlap files on the architecture map', async () => {
    await onBoard('Plan', w3.world, async (page, log) => {
      const cf = conflictCard(page.root)!;
      const locate = findElement(cf, (element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '在架构图里看')!;
      /* 具名改坏: `planConflictVals` 仍给 `nc`/`btn is-off`；两句红。 */
      expect(hasClass(locate, 'is-off')).toBe(false);
      expect(locate.getAttribute('title')).toMatch(/^在架构图里点亮 /);
      const from = log.calls.length;
      click(locate);
      await waitFor(() => auxTab(page.root, '架构图')?.getAttribute('aria-selected') === 'true');
      await quietPage(log);
      const reads = since(log, 'architecture/read', from);
      expect(reads).toHaveLength(1);
      expect((reads[0]!.input as { selection?: unknown }).selection).toEqual({ kind: 'current' });
      expect(treeNames(page.root)).toEqual(expect.arrayContaining(['views.ts', 'core-routes.ts']));
    }, { search: '?goal=s6a-goal-2' });
  }, 180_000);
});
