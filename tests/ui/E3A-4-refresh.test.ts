import { afterEach, describe, expect, it } from 'vitest';
import { findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, countRoute, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openW1 } from './helpers/E3N-world.js';
import { E3A, seedArchPlan, seedArchWorld } from './helpers/E3A-world.js';
import { detail, detailText, nodeNamed, relationGroup, relationItems } from './helpers/E3A-page.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3A-4 (E3ARCH tests §2.4): one notification, one reread of the same read set,
 * one stream; and the relation item counts the tasks whose plannedFiles hit the
 * selected file, not every task of the Goal.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

async function openWithArch(): Promise<S6ARequestWorld> {
  const opened = await openW1();
  worlds.push(opened.world);
  await seedArchWorld(opened.world);
  return opened.world;
}

describe('E3A-4 refresh and the relation set', () => {
  it('E3A-17 one notification rereads the same set, one stream, no other routes', async () => {
    const world = await openWithArch();
    const goalId = world.goals.first.goalId;
    /* The row names exactly one notification. The real write publishes more
       than one live change notice (the Session commit and its work link), so
       the transport is controlled and only the frame below reaches the page;
       the write itself is still the real Host's. `gate` holds the stream
       request until the first read has settled, so boundary 2 is its own read. */
    const { page, log } = await bootE3N(world, 'ArchOverview',
      { search: '?goal=' + goalId, mode: 'controlled', gate: true });
    try {
      expect(log.changes).toBe(1);
      await waitFor(() => countRoute(log, 'bootstrap') === 1
        && countRoute(log, 'lines/list') === 1, 3_000);
      log.releaseChanges();
      /* Boundary 2: the stream-open reread. `lines/list` is the read's last
         route, so the whole set back at its first-read values is the public
         signal that the connection reread has reached its pre-notification
         counts; only then are the before-counts taken and the notice sent. */
      await waitFor(() => countRoute(log, 'bootstrap') === 2
        && countRoute(log, 'goals/read') === 2
        && countRoute(log, 'architecture/read') === 2
        && countRoute(log, 'architecture/observation-state') === 2
        && countRoute(log, 'architecture/query') === 2
        && countRoute(log, 'files/list') === 2
        && countRoute(log, 'tasks/query') === 2
        && countRoute(log, 'lines/list') === 2, 3_000);
      const before = {
        lines: countRoute(log, 'lines/list'),
        read: countRoute(log, 'architecture/read'),
        state: countRoute(log, 'architecture/observation-state'),
        query: countRoute(log, 'architecture/query'),
      };
      await world.createWorkSession('e3a-new');
      const opening = log.openings.at(-1);
      if (opening === undefined) throw new Error('the page did not open its change stream');
      opening.enqueue(new TextEncoder().encode('event: change\nid: c0000000002\ndata: {}\n\n'));
      /* The one notification starts one reread; `lines/list`, the read's last
         route, is the public signal that the reread reached the page. With
         exactly one frame here no second read can start, so once it is sent
         the read set below is final. */
      await waitFor(() => countRoute(log, 'lines/list') >= before.lines + 1, 3_000);
      /* 具名改坏: 在通知回调里再 `subscribeChanges` 一次；E3A-17 的
         `changes===1` 红。或每次通知读一次 `graph/detail`；`graph/detail` 0 次红。 */
      expect(log.changes).toBe(1);
      expect(countRoute(log, 'lines/list')).toBe(before.lines + 1);
      expect(countRoute(log, 'architecture/read')).toBe(before.read + 1);
      expect(countRoute(log, 'architecture/observation-state')).toBe(before.state + 1);
      expect(countRoute(log, 'architecture/query')).toBe(before.query + 1);
      for (const route of ['architecture/find', 'architecture/compare', 'graph/detail',
        'decisions/queue', 'goals/list', 'goals/display']) {
        expect(countRoute(log, route)).toBe(0);
      }
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('E3A-18 the task relation counts only the tasks planned for this file', async () => {
    const world = await openWithArch();
    await seedArchPlan(world, { tasks: [
      { taskId: 'e3a-work', title: '执行者', plannedFiles: [E3A.filePath] },
      { taskId: 'e3a-other', title: '另一个任务', plannedFiles: [E3A.otherFile] },
    ] });
    const { page } = await bootE3N(world, 'ArchOverview', { search: '?goal=' + world.goals.first.goalId });
    try {
      const file = nodeNamed(page.root, E3A.filePath);
      expect(file).toBeDefined();
      click(file!);
      expect(detail(page.root)).toBeDefined();
      const rel = findClass(detail(page.root)!, 'd-rel');
      expect(rel).toBeDefined();
      const tasks = relationGroup(page.root, '任务');
      expect(tasks).toBeDefined();
      /* 具名改坏: 把任务数用 `tasks.length`（全目标任务数）替命中文件的数；
         E3A-18 的 `1` 在 2 个任务的世界里变 2，红。 */
      expect(relationItems(tasks!)).toHaveLength(1);
      expect(tasks!.textContent).toContain('执行者');
      expect(tasks!.textContent).not.toContain('另一个任务');
      expect(detailText(page.root)).not.toContain('引用处数');
    } finally {
      await page.restore();
    }
  }, 60_000);
});
