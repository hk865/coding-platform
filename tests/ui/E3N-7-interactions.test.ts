import { afterEach, describe, expect, it } from 'vitest';
import { findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, countRoute, goalRows, lineHeadTitle, lineRowNamed, mainHeadTitle, separator } from './helpers/E3N-page.js';
import {
  doubleClick, focus, hover, leave, pressKey, pointerDown, pointerMove, pointerUp, pressEnter, rightClick, wheel,
} from './helpers/E3N-interact.js';
import { openW1 } from './helpers/E3N-world.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3W I01–I07 (run sheet §2.7): the interaction base — hover card, keyboard
 * activation, split-handle keys, double-click reset, pointer drag, and the two
 * events the prototype leaves unbound (right-click, wheel). Touch rows are not
 * in this package: neither board has a touch control (Phone's tabs moved out).
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

describe('E3N-7 the interaction base', () => {
  it('I01 hovering the executor opens its card and leaving closes it', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      const row = lineRowNamed(page.root, '执行者');
      expect(row).toBeDefined();
      hover(row!);
      /* 具名改坏: hover 处理固定用 `rows[0]`；悬停 `执行者` 时卡片是 `秘书 1`，
         I01 的 `执行者` 断言红。 */
      const card = findElement(page.root, (element) => element.getAttribute('role') === 'tooltip'
        || (element.getAttribute('class') ?? '').split(/\s+/).includes('hcard'));
      expect(card).toBeDefined();
      expect(card!.textContent).toContain('执行者');
      expect(card!.textContent).toContain('待命');
      leave(row!);
      expect(findElement(page.root, (element) => element.getAttribute('role') === 'tooltip'
        || (element.getAttribute('class') ?? '').split(/\s+/).includes('hcard'))).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('I02 the executor row is a button and Enter selects it', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      const row = lineRowNamed(page.root, '执行者');
      expect(row).toBeDefined();
      expect(row!.tagName.toLowerCase()).toBe('button');
      /* 具名改坏: `lv-rw` 的 `button` 换成 `div`（不留 `tabindex`）；
         I02 的 `tagName` 和选线断言红。 */
      focus(row!);
      pressEnter(row!);
      await expect.poll(() => countRoute(log, 'lines/read'), { timeout: 10_000, interval: 25 }).toBe(1);
      expect(lineHeadTitle(page.root)).toBe('执行者');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('I03 ArrowRight on the rail separator adds 16', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      const handle = separator(page.root, '调整左栏宽度');
      expect(handle.getAttribute('aria-valuenow')).toBe('232');
      /* 具名改坏: `step` 从 `e.shiftKey ? 64 : 16` 改成 `8`；I03 的 `248` 等值红。 */
      pressKey(handle, 'ArrowRight');
      expect(handle.getAttribute('aria-valuenow')).toBe('248');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('I04 double-clicking the separator restores the default width', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      const handle = separator(page.root, '调整左栏宽度');
      pressKey(handle, 'ArrowRight');
      expect(handle.getAttribute('aria-valuenow')).toBe('248');
      /* 具名改坏: `reset` 的 `p[key]=null` 改成 `p[key]=300`；I04 的 `232` 红。 */
      doubleClick(handle);
      expect(handle.getAttribute('aria-valuenow')).toBe('232');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('I05 dragging the rail separator 20px right adds 20 and marks the drag', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      const handle = separator(page.root, '调整左栏宽度');
      /* 具名改坏: `handle('rail')` 的 `dir` 从 `1` 改成 `-1`；I05 的 `252` 红（212）。 */
      pointerDown(handle, 300);
      expect((handle.getAttribute('class') ?? '').split(/\s+/)).toContain('is-drag');
      pointerMove(handle, 320);
      pointerUp(handle, 320);
      expect(handle.getAttribute('aria-valuenow')).toBe('252');
      expect((handle.getAttribute('class') ?? '').split(/\s+/)).not.toContain('is-drag');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('I06 right-clicking a Goal row changes nothing', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      const before = countRoute(log, 'goals/list');
      const row = goalRows(page.root)[1];
      expect(row).toBeDefined();
      rightClick(row!);
      /* 具名改坏: 给目标行加 `onContextMenu="{{g.pick}}"`；I06 的 `.head-title` 红。 */
      expect(page.assigned()).toEqual([]);
      expect(mainHeadTitle(page.root)).toBe('S6A goal one');
      expect(countRoute(log, 'goals/list')).toBe(before);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('I07 wheeling the rail changes nothing', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      const rail = findClass(page.root, 'rail');
      expect(rail).toBeDefined();
      const before = log.calls.length;
      /* 具名改坏: 给 `.rail` 加 `onWheel="{{g.pick}}"`；I07 的 `.head-title` 红。 */
      wheel(rail!, 120);
      expect(page.assigned()).toEqual([]);
      expect(mainHeadTitle(page.root)).toBe('S6A goal one');
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
