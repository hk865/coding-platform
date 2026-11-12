import { afterEach, describe, expect, it } from 'vitest';
import {
  bodyRows, bootDone, openDoneDeliveryWorld, openRow, openSection, rowMain, sectionSum,
} from './helpers/E3DN-done-world.js';
import { findAllClass, findClass, findElement } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { press, settle, worldSlot } from './helpers/E3M-world.js';
import { notConnected } from './helpers/E3N-interact.js';
import { descendants, hasClass, textOf } from './helpers/E3N-page.js';

/**
 * E3DN-6 D15 (test sheet §2.6): the blocks this package leaves unconnected —
 * a requirement's 在任务图里看 (N18), the right column — carry the three
 * marks, swallow the click and read nothing; the right column draws no
 * prototype node.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

const SAMPLE_NODE_CLASSES = ['tr-name', 'qrow', 'fname', 'd-title'];

describe('E3DN-6 the unconnected blocks', () => {
  it.each([
    { entry: '① N18 在任务图里看' },
    { entry: '③ 右栏正文' },
  ])('D15 $entry', async ({ entry }) => {
    const done = await slot.use('main', () => openDoneDeliveryWorld(), (world) => world.close());
    const { page, log } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => findClass(page.root, 'gb-state') !== undefined && textOf(findClass(page.root, 'gb-state')) !== '', 10_000);
      if (entry.startsWith('③')) {
        const panel = findClass(page.root, 'panel');
        /* 具名改坏: 右栏画一个样例节点；本条目红。 */
        expect(textOf(findClass(panel ?? page.root, 'pbody'))).toBe('还没接通');
        /* 具名改坏: 有 Host 时沿用样例文件页 `views.ts`；本行红。 */
        expect(textOf(page.root)).not.toContain('views.ts');
        for (const name of SAMPLE_NODE_CLASSES) expect(findClass(panel ?? page.root, name), name).toBeUndefined();
        /* §2.11/D14: the three tool tabs and the "+" menu are drawn 还没接通; their click sends nothing.
           具名改坏: 保留样例的活页签（dataVals 不映射 offCls/off/pick）；本行红。 */
        const tools = findAllClass(page.root, 'nm').filter((tab) => ['文件', '命令', 'Diff'].includes(textOf(tab)));
        expect(tools.map(textOf)).toEqual(['文件', '命令', 'Diff']);
        const before = log.calls.length;
        for (const tab of tools) notConnected(tab);
        press(findElement(page.root, (element) => element.getAttribute('aria-label') === '新建页签'), '新建页签');
        const items = descendants(page.root).filter((element) => element.getAttribute('role') === 'menuitem');
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) notConnected(item);
        expect(log.calls.length).toBe(before);
        return;
      }
      await settle(() => sectionSum(page.root, '验收要求与证据') !== '', 10_000);
      const body = await openSection(page.root, '验收要求与证据');
      const row = bodyRows(body).find((item) => rowMain(item) === 'pl-obligation-goal static check');
      const more = await openRow(page.root, row, 'dv-more', 'the goal requirement');
      const control: FakeElement | undefined = descendants(findClass(more ?? page.root, 'dv-acts') ?? page.root)
        .find((element) => element.tagName.toLowerCase() === 'button');
      expect(control, entry).toBeDefined();
      const before = log.calls.length;
      const shown = textOf(page.root);
      /* 具名改坏: 给 N18 的定位发 `graph/detail`；本条目红。 */
      notConnected(control!);
      expect(log.calls.length).toBe(before);
      expect(textOf(page.root)).toBe(shown);
    } finally {
      await page.restore();
    }
  }, 180_000);
});
