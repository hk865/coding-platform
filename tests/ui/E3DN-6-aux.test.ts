import { afterEach, describe, expect, it } from 'vitest';
import {
  bodyRows, bootDone, openDoneDeliveryWorld, openRow, openSection, rowMain, sectionSum,
} from './helpers/E3DN-done-world.js';
import { findClass, findElement } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { callsOf, press, settle, worldSlot } from './helpers/E3M-world.js';
import {
  auxPanel, auxTab, countRoute, descendants, hasClass, pickTab, quietPage, textOf, treeNames, waitFor,
  type PageLog,
} from './helpers/E3N-page.js';

/**
 * E3DN-6 D15 after 5c: the delivery page's right panel reads the real task map
 * and the connected tool tabs; 文件 stays unconnected (Astra's B7c). A
 * requirement's 在任务图里看 selects its task and reads that task's detail, and
 * the architecture map's 当前工作 is the page's own local switch (it never reads
 * architecture/work-scope).
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

const mainWorld = () => slot.use('main', () => openDoneDeliveryWorld(), (done) => done.close());

/** The `graph/detail` participants reads since `from`, with each call's taskId. */
const participantsSince = (log: PageLog, from: number): string[] => callsOf(log, 'graph/detail', from)
  .filter((call) => (call.input as { section?: string }).section === 'participants')
  .map((call) => String(((call.input as { node?: { ref?: { taskId?: unknown } } }).node?.ref?.taskId) ?? ''));

describe('E3DN-6 the connected right panel', () => {
  it('D15③ the task map and the command, Diff and 文件 tabs', async () => {
    const done = await mainWorld();
    const { page, log } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, '验收要求与证据') !== '', 10_000);
      /* 具名改坏: `readDone` 不调 `readPageAux`；本行的次数和树名红。 */
      expect(countRoute(log, 'graph/hover')).toBe(1);
      await waitFor(() => treeNames(page.root).includes('PL stage 1 done-a'));
      expect(treeNames(page.root)).toEqual(expect.arrayContaining(['PL stage 1 done-a', 'PL stage 1 done-b']));
      const panel = auxPanel(page.root) ?? page.root;
      expect(textOf(panel)).not.toContain('还没接通');
      /* 具名改坏: 命令、Diff 页签不映射成接通的页签；本行红。 */
      for (const name of ['命令', 'Diff']) expect(auxTab(page.root, name)?.getAttribute('aria-disabled')).not.toBe('true');
      /* `views.ts` is the sample file page: it must not survive the real read. */
      expect(textOf(page.root)).not.toContain('views.ts');
      /* B7c still owns 文件: drawn 还没接通 and its clicks send nothing. */
      const file = auxTab(page.root, '文件')!;
      expect(hasClass(file, 'is-off')).toBe(true);
      expect(file.getAttribute('title')).toBe('还没接通');
      expect(file.getAttribute('aria-disabled')).toBe('true');
      const before = log.calls.length;
      press(file, '文件');
      press(findElement(page.root, (element) => element.getAttribute('aria-label') === '新建页签'), '新建页签');
      const item = descendants(page.root).find((element) => element.getAttribute('role') === 'menuitem'
        && textOf(element).startsWith('文件'))!;
      expect(hasClass(item, 'is-off')).toBe(true);
      expect(item.getAttribute('title')).toBe('还没接通');
      expect(item.getAttribute('aria-disabled')).toBe('true');
      press(item, '文件');
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D15① a requirement’s 在任务图里看 opens its gate task detail', async () => {
    const done = await mainWorld();
    const { page, log } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, '验收要求与证据') !== '', 10_000);
      const body = await openSection(page.root, '验收要求与证据');
      const row = bodyRows(body).find((item) => rowMain(item) === 'pl-obligation-goal static check');
      const more = await openRow(page.root, row, 'dv-more', 'the goal requirement');
      const control: FakeElement | undefined = descendants(findClass(more ?? page.root, 'dv-acts') ?? page.root)
        .find((element) => element.tagName.toLowerCase() === 'button');
      expect(control, 'N18 在任务图里看').toBeDefined();
      const before = log.calls.length;
      press(control!, 'N18 在任务图里看');
      await waitFor(() => auxTab(page.root, '任务图')?.getAttribute('aria-selected') === 'true');
      await quietPage(log);
      /* 具名改坏: N18 不按 `taskIds` 选（回目标根）；本行的 `taskId` 红。 */
      expect(participantsSince(log, before)).toEqual(['pl-gate-goal']);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D15④ 当前工作 and 全部 are local switches on the architecture map', async () => {
    const done = await mainWorld();
    const { page, log } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, '验收要求与证据') !== '', 10_000);
      await pickTab(page, log, '架构图');
      const work = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '当前工作');
      const all = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '全部');
      expect(work, '当前工作').toBeDefined();
      expect(all, '全部').toBeDefined();
      const before = log.calls.length;
      press(work!, '当前工作');
      press(all!, '全部');
      /* 具名改坏: `axDemand('arch')` 的 `workOnly` 给 `true`；本行红。 */
      expect(countRoute(log, 'architecture/work-scope')).toBe(0);
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 180_000);
});
