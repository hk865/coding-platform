import { afterEach, describe, expect, it } from 'vitest';
import { openS7C1World, type S7C1World } from '../helpers/S7C-member-fixture.js';
import { findClass, findElement } from './helpers/boot-page.js';
import { bootChain, byLabel, stepRows, watchStorage, type ChainPage } from './helpers/E3C-world.js';
import { memberSearch, press, settle, worldSlot } from './helpers/E3M-world.js';
import { countRoute, hasClass, sleep, textOf } from './helpers/E3N-page.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3C-8 (test sheet §2.3, E3C-19..21; wiring H1–H4, R9, L3): the page's own
 * local controls — the 对话/轨迹 tabs, the density menu (完全展开 shows no
 * step rows: C2 has no step read, DC2), the theme and the right-column
 * switch. None of them reads the Host or writes browser storage.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);
const ended = (key: string) => slot.use(key, () => openS7C1World({ backend: 'memory', firstRun: 'ended' }), (world) => world.close());
const bootModule = (s7c: S7C1World): Promise<ChainPage> => bootChain(s7c.world, memberSearch('s7c-goal', s7c.lines.module.ref));

const tab = (root: FakeElement, name: string) => findElement(root, (element) => element.getAttribute('role') === 'tab' && textOf(element) === name);
const app = (root: FakeElement): FakeElement | undefined => findClass(root, 'app');

describe('E3C-8 the page’s local controls', () => {
  it.each([
    { entry: '① 点“轨迹”', name: '轨迹', other: '对话' },
    { entry: '② 点“对话”', name: '对话', other: '轨迹' },
  ])('E3C-19 $entry turns its tab on and reads nothing (H1/H2)', async ({ entry, name, other }) => {
    const s7c = await ended(entry);
    const { page, log } = await bootModule(s7c);
    try {
      /* The page read the real Host before its local controls are used (§1.4). */
      expect(countRoute(log, 'lines/list')).toBeGreaterThanOrEqual(1);
      if (name === '对话') {
        press(tab(page.root, '轨迹'), '轨迹');
        await settle(() => hasClass(tab(page.root, '轨迹')!, 'is-on'));
      }
      const before = log.calls.length;
      press(tab(page.root, name), name);
      await settle(() => tab(page.root, name) !== undefined && hasClass(tab(page.root, name)!, 'is-on'));
      expect(hasClass(tab(page.root, name)!, 'is-on')).toBe(true);
      expect(hasClass(tab(page.root, other)!, 'is-on')).toBe(false);
      /* 具名改坏: ① 切到轨迹时再读一次 executions/history；② 切回对话时再读一次——各自只让本条目红。 */
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('E3C-20 完全展开 closes the menu and shows no step rows (H3/H4, DC2)', async () => {
    const s7c = await ended('E3C-20');
    const { page, log } = await bootModule(s7c);
    try {
      const before = log.calls.length;
      press(findElement(page.root, (element) => element.getAttribute('aria-haspopup') === 'menu'), '密度');
      await settle(() => findElement(page.root, (element) => element.getAttribute('role') === 'menu') !== undefined);
      press(findElement(page.root, (element) => element.getAttribute('role') === 'menuitemradio' && textOf(element).includes('完全展开')), '完全展开');
      await sleep(200);
      expect(findElement(page.root, (element) => element.getAttribute('role') === 'menu')).toBeUndefined();
      /* 具名改坏: 密度档把 C2 的步骤展开成一行一条；本行的“没有步骤行”红。 */
      expect(stepRows(findClass(page.root, 'thread'))).toHaveLength(0);
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it.each([
    { entry: '① 主题', className: 't-light' },
    { entry: '② 右栏开关', className: 'no-panel' },
  ])('E3C-21 $entry changes the page once and reads or stores nothing (R9/L3)', async ({ entry, className }) => {
    const s7c = await ended(entry);
    const { page, log } = await bootModule(s7c);
    const storage = watchStorage();
    try {
      expect(countRoute(log, 'lines/list')).toBeGreaterThanOrEqual(1);
      const control = entry.startsWith('①')
        ? byLabel(page.root, '切换到浅色') ?? byLabel(page.root, '切换到深色')
        : byLabel(page.root, '显示或隐藏右栏');
      expect(control, entry).toBeDefined();
      const panel = entry.startsWith('②');
      if (panel) {
        /* L3: the dialogue view has no right column at all; one raw record opens it. */
        press(tab(page.root, '轨迹'), '轨迹');
        await settle(() => findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
          && hasClass(element, 'lg-row')) !== undefined);
        press(findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
          && hasClass(element, 'lg-row')), '一条原始记录');
        await settle(() => findClass(page.root, 'insp') !== undefined);
      }
      const was = hasClass(app(page.root)!, className);
      const before = log.calls.length;
      press(control, entry);
      await settle(() => hasClass(app(page.root)!, className) !== was);
      expect(hasClass(app(page.root)!, className)).toBe(!was);
      if (panel) {
        expect(findClass(page.root, 'insp')).toBeUndefined();
        press(control, entry);
        await settle(() => hasClass(app(page.root)!, className) === was);
        expect(hasClass(app(page.root)!, className)).toBe(was);
        expect(findClass(page.root, 'insp')).toBeDefined();
      }
      expect(log.calls.length).toBe(before);
      /* 具名改坏: ① 主题变化时写 localStorage；② 右栏关闭时写 sessionStorage——各自只让本条目红。 */
      expect(storage.writes).toEqual([]);
    } finally {
      storage.restore();
      await page.restore();
    }
  }, 120_000);
});
