import { afterEach, describe, expect, it } from 'vitest';
import { bootE3N } from './helpers/E3N-page.js';
import { openW1 } from './helpers/E3N-world.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3W N50 (run sheet §2.6): the shell mounts each of the two boards, opens
 * exactly one change stream, fetches the page once and shows the real Goal
 * name with no unrendered template text.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

describe('E3N-6 the shell for both boards', () => {
  it.each(['Main', 'TaskMap'])('N50 %s mounts real data, one stream and one page fetch', async (name) => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, name as 'Main' | 'TaskMap', { search: '?goal=ag2b-goal' });
    try {
      /* 具名改坏: `src/ui/boot.ts:396-401` 的 `BOARD_READERS` 少了 `Main`（现在
         注册 `TaskMap`、`Main`、`Goals`、`ArchOverview`、`Decide`），Main 走样例；
         N50 的 Main `changes` 和 `pageFetches` 断言红。 */
      await expect.poll(() => log.changes, { timeout: 10_000, interval: 25 }).toBe(1);
      expect(page.pageFetches()).toBe(1);
      expect(page.root.textContent.length).toBeGreaterThan(0);
      expect(page.root.textContent).not.toContain('{{');
      expect(page.root.textContent).not.toContain('NaN');
      expect(page.root.textContent).not.toContain('undefined');
      expect(page.root.textContent).toContain('S6A goal one');
    } finally {
      await page.restore();
    }
  }, 60_000);
});
