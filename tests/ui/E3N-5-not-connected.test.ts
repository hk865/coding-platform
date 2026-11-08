import { afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass, findElement, findLink } from './helpers/boot-page.js';
import { bootE3N, countRoute } from './helpers/E3N-page.js';
import { notConnected } from './helpers/E3N-interact.js';
import { cancelGoal, openW1 } from './helpers/E3N-world.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3W N40–N42 (run sheet §2.5): the two controls whose data the page package 2
 * wires (A08 暂停, A19 发送) keep their place, are drawn unavailable and say
 * 还没接通, and a connected link is not marked. The four assertions live in
 * E3N-interact only.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

describe('E3N-5 not connected controls', () => {
  it('N40 重新入队 is drawn unavailable, says so and sends no goal control', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    await cancelGoal(opened.world, opened.world.goals.first);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      /* 目标栏的“重新入队”（`Main.dc.html:649-655`）：已取消的目标才出现，底座不接这个写。 */
      const button = findButton(findClass(page.root, 'goalbar')!, '重新入队');
      expect(button).toBeDefined();
      const before = page.root.textContent;
      /* 具名改坏: 统一 helper 只写 `title`、不写 `is-off`；N40 的 `is-off` 断言红。 */
      expect(notConnected(button!)).toBe('未接通');
      expect(countRoute(log, 'goals/control')).toBe(0);
      expect(page.root.textContent).toBe(before);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N41 A19 发送 is drawn unavailable, says so and sends no request', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      const send = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && element.getAttribute('aria-label') === '发送');
      expect(send).toBeDefined();
      const before = page.root.textContent;
      /* 具名改坏: 把“发送”的 `title` 改成 `发送`；N41 的 `title` 等值断言红。 */
      expect(notConnected(send!)).toBe('未接通');
      expect(countRoute(log, 'requests/submit')).toBe(0);
      expect(countRoute(log, 'requests/ask')).toBe(0);
      expect(page.root.textContent).toBe(before);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N42 a connected TaskMap back link is not marked unavailable', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'TaskMap', { search: '?goal=ag2b-goal' });
    try {
      const back = findLink(page.root, '返回工作台', 'Main.dc.html');
      expect(back).toBeDefined();
      /* 具名改坏: 统一 helper 对所有 `a` 都写 `title="还没接通"`；
         N42 的 `title` 断言红。 */
      expect((back!.getAttribute('class') ?? '').split(/\s+/)).not.toContain('is-off');
      expect(back!.getAttribute('title')).not.toBe('还没接通');
      expect(back!.getAttribute('aria-disabled')).not.toBe('true');
      expect(new URL(back!.getAttribute('href')!, 'http://host/workbench/TaskMap.dc.html').pathname)
        .toBe('/workbench/Main.dc.html');
    } finally {
      await page.restore();
    }
  }, 60_000);
});
