import { afterEach, describe, expect, it } from 'vitest';
import { openS7C1World } from '../helpers/S7C-member-fixture.js';
import { memberSearch, worldSlot } from './helpers/E3M-world.js';
import { bootE3N, countRoute, waitFor } from './helpers/E3N-page.js';

/**
 * E3C-9 (test sheet §2.3, E3C-22; R3 of §0.4, §1.4): one page, one change
 * stream; one notification starts one reread of the same set, and the routes
 * this page never reads stay at 0. As in E3A-17, the real write publishes
 * more than one live notice, so the transport is controlled and exactly one
 * frame reaches the page; the write itself is the real Host's.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

const NEVER = ['sessions/history', 'messages/', 'queries/', 'decisions/card', 'architecture/', 'graph/detail'];

describe('E3C-9 the change stream', () => {
  it('E3C-22 one notification rereads once on the one stream; the routes the page never reads stay at 0', async () => {
    const s7c = await slot.use('E3C-22', () => openS7C1World({ backend: 'memory', firstRun: 'ended' }), (world) => world.close());
    const { page, log } = await bootE3N(s7c.world, 'Chain',
      { search: memberSearch('s7c-goal', s7c.lines.module.ref), mode: 'controlled', gate: true });
    try {
      /* 具名改坏: 在通知回调里再 subscribeChanges 一次；本行的 `changes===1` 红（这里和末尾各一次）。 */
      expect(log.changes).toBe(1);
      await waitFor(() => countRoute(log, 'lines/list') === 1, 5_000);
      log.releaseChanges();
      /* The stream-open reread (§1.4 连接成功后的补读): the set back at its first-read count. */
      await waitFor(() => countRoute(log, 'lines/list') === 2, 5_000);
      const before = countRoute(log, 'lines/list');
      await s7c.world.createWorkSession('e3c-new');
      const opening = log.openings.at(-1);
      if (opening === undefined) throw new Error('the page did not open its change stream');
      opening.enqueue(new TextEncoder().encode('event: change\nid: c0000000002\ndata: {}\n\n'));
      await waitFor(() => countRoute(log, 'lines/list') >= before + 1, 5_000);
      expect(countRoute(log, 'lines/list')).toBe(before + 1);
      expect(countRoute(log, 'lines/read')).toBeGreaterThanOrEqual(1);
      expect(log.changes).toBe(1);
      /* 具名改坏: 每次通知读一次 sessions/history；本行的 0 次红。 */
      for (const prefix of NEVER) expect(log.calls.filter((call) => call.route.startsWith(prefix)).map((call) => call.route)).toEqual([]);
      expect(countRoute(log, 'lines/archived')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);
});
