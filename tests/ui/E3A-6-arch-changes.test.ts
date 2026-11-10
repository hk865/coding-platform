import { afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass } from './helpers/boot-page.js';
import { bootE3N, countRoute, textOf, turns, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openW1 } from './helpers/E3N-world.js';
import { seedArchWorld } from './helpers/E3A-world.js';
import { nodeNamed, pageText } from './helpers/E3A-page.js';
import {
  B2_FILES, bootArchAnswers, bootB2, detailState, enterWorkGraph, graphNode,
} from './helpers/E3A-fixed.js';
import { openS6ARequestWorld, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3A-6 (DARR B2 tests §2.3–§2.4): the change-scope read in the page's read
 * set (B2-R, the real Host with W1's architecture), its input and its failure;
 * then on B2-F a parent module's 改动 summing its containment child, the
 * header's support directories and an unplanned file's 改动 word.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

/** B2-R: W1 plus the E3ARCH architecture seed, every read the real Host's. */
async function openB2R(): Promise<S6ARequestWorld> {
  const opened = await openW1();
  worlds.push(opened.world);
  await seedArchWorld(opened.world);
  return opened.world;
}

async function openB2F(): Promise<S6ARequestWorld> {
  const world = await openS6ARequestWorld({ backend: 'memory' });
  worlds.push(world);
  return world;
}

/** A bounded wait on a public count that may not come: the row's own `expect` then decides. */
async function settle(predicate: () => boolean): Promise<void> {
  await turns(predicate, 3_000).catch(() => undefined);
}

describe('E3A-6 the change-scope read', () => {
  it('B2-12 one notification rereads the change scope once with the set, and no per-task detail', async () => {
    const world = await openB2R();
    const goalId = world.goals.first.goalId;
    /* E3A-17's transport: the stream is held until the first read settles and
       only the one frame below reaches the page; the write is the real Host's. */
    const { page, log } = await bootE3N(world, 'ArchOverview',
      { search: '?goal=' + goalId, mode: 'controlled', gate: true });
    try {
      expect(log.changes).toBe(1);
      await waitFor(() => countRoute(log, 'bootstrap') === 1 && countRoute(log, 'lines/list') === 1, 3_000);
      log.releaseChanges();
      await waitFor(() => countRoute(log, 'bootstrap') === 2
        && countRoute(log, 'architecture/read') === 2
        && countRoute(log, 'architecture/observation-state') === 2
        && countRoute(log, 'architecture/query') === 2
        && countRoute(log, 'lines/list') === 2, 3_000);
      await settle(() => countRoute(log, 'architecture/change-scope') === 2);
      const before = {
        changes: countRoute(log, 'architecture/change-scope'),
        lines: countRoute(log, 'lines/list'),
        read: countRoute(log, 'architecture/read'),
        state: countRoute(log, 'architecture/observation-state'),
        query: countRoute(log, 'architecture/query'),
      };
      await world.createWorkSession('b2-new');
      const opening = log.openings.at(-1);
      if (opening === undefined) throw new Error('the page did not open its change stream');
      opening.enqueue(new TextEncoder().encode('event: change\nid: c0000000002\ndata: {}\n\n'));
      await waitFor(() => countRoute(log, 'lines/list') >= before.lines + 1, 3_000);
      await settle(() => countRoute(log, 'architecture/change-scope') >= before.changes + 1);
      expect(countRoute(log, 'architecture/change-scope')).toBe(before.changes + 1);
      expect(countRoute(log, 'architecture/read')).toBe(before.read + 1);
      expect(countRoute(log, 'architecture/observation-state')).toBe(before.state + 1);
      expect(countRoute(log, 'architecture/query')).toBe(before.query + 1);
      /* 具名改坏: 每次通知对每个任务读一次 `graph/detail`；B2-12 的 `graph/detail` 0 次红。 */
      for (const route of ['graph/detail', 'files/uncommitted', 'architecture/compare']) {
        expect(countRoute(log, route)).toBe(0);
      }
      expect(log.changes).toBe(1);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-13 the change scope is read by the Goal reference', async () => {
    const world = await openB2R();
    const goalId = world.goals.first.goalId;
    const { page, log } = await bootE3N(world, 'ArchOverview', { search: '?goal=' + goalId });
    try {
      const call = log.calls.find((entry) => entry.route === 'architecture/change-scope');
      /* 具名改坏: 把 input 写成 `{goalId}`；B2-13 的等值红。 */
      expect(call?.input).toEqual({ goalRef: { aggregateType: 'Goal', projectId: world.scope.projectId, goalId } });
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-14 an unavailable change scope fails the first read with the base error and retry; 改动 is never written as 0', async () => {
    const world = await openB2R();
    const goalId = world.goals.first.goalId;
    const { page, log } = await bootArchAnswers(world, {
      'architecture/change-scope': { status: 'rejected', code: 'unavailable', reason: 'B2-14 the change scope is unavailable' },
    }, '?goal=' + goalId);
    try {
      /* With a Host the page draws no prototype sample: a failed first read
         shows the base's error text for `unavailable` and its retry button,
         like Decide and Member. 具名改坏: 吞掉失败、写 `改动 0`；B2-14 的错误文字红。 */
      expect(pageText(page)).toContain('暂时读不到，可以重试。');
      expect(findButton(page.root, '重试')).toBeDefined();
      /* Neither the sample (its header's 2,709 files of coding-platform) nor
         this world's data is on the page, and 改动 is never a made-up 0. */
      expect(pageText(page)).not.toContain('2,709 个文件');
      expect(pageText(page)).not.toContain('coding-platform');
      expect(pageText(page)).not.toContain('S6A request world');
      expect(pageText(page)).not.toContain('改动 0');
      expect(countRoute(log, 'architecture/change-scope')).toBeGreaterThanOrEqual(1);
    } finally {
      await page.restore();
    }
  }, 60_000);
});

describe('E3A-6 改动 of modules and files, and the support directories', () => {
  it('B2-15 the parent module counts its own 2 and its child’s 1; the child says 改动 1', async () => {
    const world = await openB2F();
    const { page } = await bootB2(world);
    try {
      const parent = graphNode(page.root, 'WorkGraph');
      expect(parent).toBeDefined();
      const parentCount = textOf(findClass(parent!, 'ov-cnt'));
      /* 具名改坏: 把父模块的 `touched` 写死自己的 `changed`（2）；B2-15 的 `3` 变 `2`，红。 */
      expect(parentCount).toContain('改动 3');
      expect(parentCount).not.toContain('改动 2');
      enterWorkGraph(page.root);
      const child = graphNode(page.root, 'state');
      expect(child).toBeDefined();
      expect(textOf(findClass(child!, 'ov-cnt'))).toContain('改动 1');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-16 the header counts 10 modules and 8 support directories', async () => {
    const world = await openB2F();
    const { page } = await bootB2(world);
    try {
      const head = textOf(findClass(page.root, 'ov-cap-main'));
      /* The page's own data, not the frozen sample's header. */
      expect(head).toContain('S6A request world');
      /* 具名改坏: 适配器不生成 band、仍把支撑文件留作 `loose`；页头变成
         `10 个模块 · 0 个支撑目录`，B2-16 红。 */
      expect(head).toContain('10 个模块 · 8 个支撑目录');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('B2-17 an unplanned but changed file says 改动 1, not 本目标未改动', async () => {
    const world = await openB2F();
    const { page } = await bootB2(world);
    try {
      enterWorkGraph(page.root);
      const file = nodeNamed(page.root, B2_FILES.tasks);
      expect(file).toBeDefined();
      click(file!);
      const state = detailState(page.root);
      /* 具名改坏: 按 `st === 'none'` 直接写 `本目标未改动`；B2-17 的 `改动 1` 红。 */
      expect(state).toContain('改动 1');
      expect(state).not.toContain('本目标未改动');
    } finally {
      await page.restore();
    }
  }, 60_000);
});
