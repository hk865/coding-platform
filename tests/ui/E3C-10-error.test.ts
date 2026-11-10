import { afterEach, describe, expect, it } from 'vitest';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7C1World } from '../helpers/S7C-member-fixture.js';
import { findButton } from './helpers/boot-page.js';
import { bootChain, taskBar } from './helpers/E3C-world.js';
import { memberSearch, settle, worldSlot } from './helpers/E3M-world.js';
import { click } from './helpers/E3N-interact.js';
import { countRoute, lineRows, textOf } from './helpers/E3N-page.js';

/**
 * E3C-10 (test sheet §2.4, E3C-23; Codex #18): `tasks/query` `not_found` is a
 * Goal without an adopted Plan — no task bar, not an error; a first read
 * that fails on the network shows the base's error and retry, and the retry
 * reads again.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

describe('E3C-10 a Goal without a Plan and a failed first read', () => {
  it.each([
    { entry: '① 没有采用计划的目标' },
    { entry: '② 首读网络错后重试' },
  ])('E3C-23 $entry', async ({ entry }) => {
    const s7c = await slot.use(entry, () => openS7C1World({ backend: 'memory', firstRun: 'ended' }), (world) => world.close());
    if (entry.startsWith('①')) {
      await s6aCardsWorkspace(s7c.world, S6A_SCOPE).createGoal('e3c-bare', 'E3C bare goal');
      const { page } = await bootChain(s7c.world, memberSearch('e3c-bare', null));
      try {
        /* 具名改坏: 把 tasks/query 的 not_found 当首读错误；本条目的“不是错误态”红。 */
        expect(findButton(page.root, '重试')).toBeUndefined();
        expect(textOf(page.root)).not.toContain('暂时读不到');
        expect(taskBar(page.root), 'no task bar for a Goal without a Plan').toBeUndefined();
        expect(lineRows(page.root).length).toBeGreaterThan(1);
      } finally {
        await page.restore();
      }
      return;
    }
    const { page, log } = await bootChain(s7c.world, memberSearch('s7c-goal', s7c.lines.module.ref), { failOnce: 'lines/list' });
    try {
      const retry = findButton(page.root, '重试');
      /* 具名改坏: 首读失败也挂样例；本条目的 error/重试断言红。 */
      expect(retry, '重试').toBeDefined();
      click(retry!);
      await settle(() => countRoute(log, 'lines/list') >= 1 && findButton(page.root, '重试') === undefined);
      expect(countRoute(log, 'lines/list')).toBeGreaterThanOrEqual(1);
      expect(findButton(page.root, '重试')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 120_000);
});
