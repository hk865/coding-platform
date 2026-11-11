import { afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass, findElement, findLink } from './helpers/boot-page.js';
import { bootE3N, waitFor } from './helpers/E3N-page.js';
import { cancelGoal, openW1 } from './helpers/E3N-world.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3W N40–N42 (run sheet §2.5, Main A §4.2): N40/N41 are the two controls the
 * Main page package connects — 重新入队 is the copy chain (A10), 发送 is
 * `requests/submit` (A19). N42 keeps the one connected link unmarked.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

describe('E3N-5 not connected controls', () => {
  it('N40 重新入队 copies a cancelled Goal into a new one', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    await cancelGoal(opened.world, opened.world.goals.first);
    const { page } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await waitFor(() => page.root.textContent!.includes('S6A goal one'));
      /* A10/MF9: 重新入队 is the copy chain, never `goals/control`; the button is
         no longer drawn unavailable. The copy's own request assertions are T-A11. */
      const button = findButton(findClass(page.root, 'goalbar')!, '重新入队');
      expect(button).toBeDefined();
      expect((button!.getAttribute('class') ?? '').split(/\s+/)).not.toContain('is-off');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N41 A19 发送 submits the typed text to requests/submit', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await waitFor(() => page.root.textContent!.includes('S6A goal one'));
      const send = () => findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && element.getAttribute('aria-label') === '发送');
      expect(send()).toBeDefined();
      /* S5: the prototype's own title, faded while the draft is empty. The send's
         own request assertions are T-A02. */
      expect((send()!.getAttribute('class') ?? '').split(/\s+/)).toContain('is-off');
      const box = findElement(page.root, (element) => element.getAttribute('id') === 'composer-input');
      expect(box).toBeDefined();
      box!.value = '请总结';
      box!.dispatch('input', { target: box, currentTarget: box });
      /* A19: connected — the three unavailable marks are gone. */
      expect((send()!.getAttribute('class') ?? '').split(/\s+/)).not.toContain('is-off');
      expect(send()!.getAttribute('title')).toBe('发送');
      expect(send()!.getAttribute('aria-disabled')).toBeNull();
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
