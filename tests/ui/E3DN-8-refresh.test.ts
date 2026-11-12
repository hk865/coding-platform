import { afterEach, describe, expect, it } from 'vitest';
import { openDoneDeliveryWorld } from './helpers/E3DN-done-world.js';
import { worldSlot } from './helpers/E3M-world.js';
import { bootE3N, countRoute, waitFor } from './helpers/E3N-page.js';

/**
 * E3DN-8 D18 (test sheet §2.6, R3, §1.4): one page, one change stream; one
 * notification rereads the delivery set once, and the routes this page never
 * reads stay at 0. As in E3C-22, the transport is controlled so only the
 * frames this row sends reach the page; the write before the first is the
 * real Host's. The second frame is only the read-finished barrier (F9, no
 * fixed wait): the page runs one read at a time (`refresh.ts` `requestRead`),
 * so once the second frame's read reaches `goals/list`, the first frame's read
 * has ended, its last step (the on-demand `materials/open`) included.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

const REREAD = ['tasks/query', 'verification/round', 'goals/list', 'architecture/change-scope'];
const NEVER = ['main/read', 'sessions/history', 'executions/history', 'graph/hover', 'decisions/card', 'architecture/query',
  'architecture/read', 'materials/open'];

describe('E3DN-8 the change stream', () => {
  it('D18 one notification rereads the delivery set once on the one stream', async () => {
    const done = await slot.use('main', () => openDoneDeliveryWorld(), (world) => world.close());
    const { page, log } = await bootE3N(done.world, 'Done',
      { search: `?goal=${done.goal.goalId}`, mode: 'controlled', gate: true });
    try {
      await waitFor(() => log.changes === 1 && countRoute(log, 'goals/list') === 1, 10_000);
      log.releaseChanges();
      /* the stream-open reread (§1.4): the set back at its first-read count */
      await waitFor(() => countRoute(log, 'goals/list') === 2, 10_000);
      await waitFor(() => REREAD.every((route) => countRoute(log, route) >= 2), 10_000);
      const before = Object.fromEntries(REREAD.map((route) => [route, countRoute(log, route)]));
      await done.world.createWorkSession('e3dn-d18');
      const opening = log.openings.at(-1);
      if (opening === undefined) throw new Error('the page did not open its change stream');
      opening.enqueue(new TextEncoder().encode('event: change\nid: c0000000002\ndata: {}\n\n'));
      await waitFor(() => REREAD.every((route) => countRoute(log, route) >= before[route]! + 1), 10_000);
      const first = Object.fromEntries(REREAD.map((route) => [route, countRoute(log, route)]));
      /* the read-finished barrier: the second frame's read starts only after the first one has ended */
      opening.enqueue(new TextEncoder().encode('event: change\nid: c0000000003\ndata: {}\n\n'));
      await waitFor(() => countRoute(log, 'goals/list') >= before['goals/list']! + 2, 10_000);
      expect(first).toEqual(Object.fromEntries(REREAD.map((route) => [route, before[route]! + 1])));
      /* 具名改坏: 在通知回调里再 subscribeChanges 一次；本行红。 */
      expect(log.changes).toBe(1);
      /* 具名改坏: 每次通知读一次 `materials/open`；本行的 0 次红。 */
      expect(Object.fromEntries(NEVER.map((route) => [route, countRoute(log, route)])))
        .toEqual(Object.fromEntries(NEVER.map((route) => [route, 0])));
    } finally {
      await page.restore();
    }
  }, 180_000);
});
