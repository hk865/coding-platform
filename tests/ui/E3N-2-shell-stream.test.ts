import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BoardView } from '../../src/ui/runtime.js';
import { BOARDS_DIR, loadBoard, type BoardName } from './helpers/board-files.js';
import { bootPage } from './helpers/boot-page.js';
import { FakeElement } from './helpers/dom.js';
import {
  bootE3N, countRoute, lineRows, routesSince, sleep, waitFor, whyText,
} from './helpers/E3N-page.js';
import { openW1, openW3, copyBuiltWorkbench, removeBuild, E3N_BOARDS } from './helpers/E3N-world.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3W N10–N17 (run sheet §2.2): the top bar's stream loss, the 2 s reconnect,
 * the 429 text, the token a restarted Host serves, the one stream and one
 * reread per notification, the sample mount without a token and the served
 * page's token meta. Reads and writes are the real Host's; only the change
 * stream's transport is controlled where the row needs it.
 */

const RECONNECT = '连接断开，正在重连。';
const TOO_MANY = '这台主机同时打开的页面太多，这一页暂时不自动更新；关掉别的页签后会自己接上。';
const TASKMAP_READS = [
  'bootstrap', 'goals/read', 'goals/display', 'tasks/query', 'lines/list',
  'graph/hover', 'decisions/queue', 'activity/track', 'activity/calendar',
];
const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

describe('E3N-2 the top bar, the stream and the token', () => {
  it('N10 a stream loss keeps the rail and says the page is reconnecting', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal', mode: 'controlled' });
    try {
      await expect.poll(() => log.changes, { timeout: 10_000, interval: 25 }).toBe(1);
      expect(log.openings).toHaveLength(1);
      /* The stream-open reread is boundary 2 (§1.5); closing before it settles
         would leave an aborted read that schedules a retry after restore. */
      await waitFor(() => countRoute(log, 'tasks/query') >= 2, 10_000);
      log.openings[0]!.close();
      /* 具名改坏: `src/ui/boot.ts:19` 的 `RECONNECT_TEXT` 改成 `连接断开。`；
         N10 的等值断言红。 */
      await waitFor(() => whyText(page.root, 'Main') === RECONNECT);
      expect(whyText(page.root, 'Main')).toBe('连接断开，正在重连。');
      expect(page.root.textContent).toContain('秘书 1');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N11 the page waits about 2 s and then reconnects, rereads and clears the text', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'TaskMap', { search: '?goal=ag2b-goal', mode: 'controlled' });
    try {
      await expect.poll(() => log.changes, { timeout: 10_000, interval: 25 }).toBe(1);
      expect(log.openings).toHaveLength(1);
      await waitFor(() => countRoute(log, 'lines/list') >= 2, 10_000);
      log.openings[0]!.close();
      await sleep(1_000);
      /* 具名改坏: `src/ui/refresh.ts:36` 的 `RECONNECT_DELAY_MS` 改成 5000；
         N11 的 4 秒断言红。改成 200；1000ms 的“仍是 1”红。 */
      expect(log.changes).toBe(1);
      await waitFor(() => log.changes >= 2, 4_000);
      await waitFor(() => !whyText(page.root, 'TaskMap').includes(RECONNECT), 4_000);
      expect(page.root.textContent).toContain('S6A goal one');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N12 a 429 keeps the data and shows the too-many-pages text', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal', mode: '429-once' });
    try {
      /* 具名改坏: `src/ui/refresh.ts:77` 的 `tooMany = reason === 'too_many_pages'`
         改成 `tooMany = false`；N12 的 429 文字红（变成断流文字）。 */
      await waitFor(() => whyText(page.root, 'Main') === TOO_MANY);
      expect(whyText(page.root, 'Main')).toBe('这台主机同时打开的页面太多，这一页暂时不自动更新；关掉别的页签后会自己接上。');
      expect(page.root.textContent).toContain('S6A goal one');
      /* The next reconnect opens a held stream instead of a 429, so it leaves
         no timer behind once this page is restored. */
      await waitFor(() => log.changes >= 2, 4_000);
      await waitFor(() => log.openings.length === 1, 4_000);
      await waitFor(() => countRoute(log, 'tasks/query') >= 2, 4_000);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N13 a reopened Host serves a new token and the reconnect uses it', async () => {
    const opened = await openW3();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', {
      search: '?goal=ag2b-goal', mode: 'controlled', token: () => opened.world.token,
    });
    try {
      await expect.poll(() => log.changes, { timeout: 10_000, interval: 25 }).toBe(1);
      expect(log.openings).toHaveLength(1);
      const oldToken = opened.world.token;
      expect(log.changesTokens[0]).toBe(oldToken);
      /* The stream's onOpen reread joins this boundary; N13's "every later
         read uses the new token" must not include that in-flight old read. */
      await waitFor(() => countRoute(log, 'tasks/query') >= 2, 10_000);
      const oldReads = log.calls.length;

      await opened.world.reopen();
      const newToken = opened.world.token;
      expect(newToken).not.toBe(oldToken);

      log.openings[0]!.close();
      /* 具名改坏: `src/ui/boot.ts:88-98` 的 `tokenOf()` 第二次起直接 `return token`、
         不读页面原文；N13 的第二次令牌断言红。 */
      await waitFor(() => log.changes >= 2, 6_000);
      expect(log.changesTokens[1]).toBe(newToken);
      await waitFor(() => page.pageFetches() >= 2, 4_000);
      await waitFor(() => !whyText(page.root, 'Main').includes(RECONNECT), 4_000);
      /* A page from an earlier row can still finish one aborted request after
         `restore`; the reconnect's own read block is what this row proves. */
      const after = log.calls.slice(oldReads);
      const firstNew = after.findIndex((call) => call.token === newToken);
      expect(firstNew).toBeGreaterThanOrEqual(0);
      expect(after.slice(firstNew).every((call) => call.token === newToken)).toBe(true);
    } finally {
      await page.restore();
    }
  }, 90_000);

  it('N14 one notification brings one reread and one new line, and the stream stays one', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    /* The row names exactly one notification. The real write publishes more
       than one live change notice (the commit plus handle notices), so the
       transport is controlled and only the frame below reaches the page; the
       write itself is still the real Host's. */
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal', mode: 'controlled' });
    try {
      /* A page from an earlier row can still finish an aborted request; this
         row counts only the requests carrying its own world's token. */
      const token = opened.world.token;
      const own = (route: string): number => log.calls.filter((call) => call.route === route && call.token === token).length;
      const ownChanges = (): number => log.changesTokens.filter((value) => value === token).length;
      await expect.poll(() => own('lines/list'), { timeout: 10_000, interval: 25 }).toBe(2);
      expect(lineRows(page.root)).toHaveLength(3);
      expect(ownChanges()).toBe(1);
      const reads = own('lines/list');

      await opened.world.createWorkSession('e3n-new');
      const opening = log.openings[0];
      if (opening === undefined) throw new Error('the page did not open its change stream');
      opening.enqueue(new TextEncoder().encode('event: change\nid: c0000000002\ndata: {}\n\n'));
      /* 具名改坏: 在 `boot.ts` 的壳分支再调一次 `subscribeChanges(...)`；
         N14 的 `changes===1` 红。 */
      await waitFor(() => lineRows(page.root).length === 4, 10_000);
      await waitFor(() => own('lines/list') === reads + 1);
      expect(ownChanges()).toBe(1);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it.each(['Main', 'TaskMap'])('N15 a page with no token makes one page fetch and no core call (%s)', async (name) => {
    let coreCalls = 0;
    const page = await bootPage({
      name, token: null,
      request: async (url) => {
        if (url.includes('/api/real/core/')) coreCalls += 1;
        return new Response('{}', { status: 404 });
      },
    });
    try {
      expect(page.pageFetches()).toBe(1);
      expect(coreCalls).toBe(0);
      /* 具名改坏: `src/ui/boot.ts:74-77` 的无令牌分支从 `new BoardView(board).mount(root)`
         改成带默认样例数据挂载；N15 的“等于样例文字”红。 */
      const directory = existsSync(join(E3N_BOARDS, `${name}.dc.html`)) ? E3N_BOARDS : BOARDS_DIR;
      const expected = new FakeElement('x-dc');
      new BoardView(loadBoard(name as BoardName, directory)).mount(expected as unknown as Element);
      expect(page.root.textContent).toBe(expected.textContent);
      expect(page.root.textContent).not.toContain('{{');
      expect(page.root.textContent).not.toContain('NaN');
      expect(page.root.textContent).not.toContain('undefined');
    } finally {
      await page.restore();
    }
  }, 30_000);

  it('N16 the TaskMap reads only its own routes on the first read, the stream open and one notice', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'TaskMap', {
      search: '?goal=ag2b-goal', mode: 'controlled', gate: true,
    });
    try {
      expect(log.changes).toBe(1);
      await waitFor(() => countRoute(log, 'bootstrap') === 1 && countRoute(log, 'lines/list') === 1);
      expect(countRoute(log, 'bootstrap')).toBe(1);
      expect(countRoute(log, 'lines/list')).toBe(1);
      const first = routesSince(log, 0);
      expect(first.filter((route) => !TASKMAP_READS.includes(route))).toEqual([]);
      expect(first).not.toContain('goals/list');
      expect(first).not.toContain('main/read');
      expect(first).not.toContain('lines/page');

      const afterFirst = log.calls.length;
      log.releaseChanges();
      await waitFor(() => countRoute(log, 'bootstrap') === 2 && countRoute(log, 'lines/list') === 2);
      const second = routesSince(log, afterFirst);
      expect(second.filter((route) => !TASKMAP_READS.includes(route))).toEqual([]);
      expect(second).not.toContain('goals/list');
      expect(log.changes).toBe(1);

      await opened.world.createWorkSession('e3n-new');
      const afterSecond = log.calls.length;
      const opening = log.openings.at(-1);
      if (opening === undefined) throw new Error('the page did not open its change stream');
      opening.enqueue(new TextEncoder().encode('event: change\nid: c0000000002\ndata: {}\n\n'));
      /* 具名改坏: 在 `readTaskMap` 的调用点额外读一次 `goals/list`；三个边界的
         路由集合红。把补读删掉；第 2 个边界的 `bootstrap` 2 红。 */
      await waitFor(() => countRoute(log, 'bootstrap') === 3 && countRoute(log, 'lines/list') === 3);
      expect(countRoute(log, 'bootstrap')).toBe(3);
      expect(countRoute(log, 'lines/list')).toBe(3);
      const third = routesSince(log, afterSecond);
      expect(third.filter((route) => !TASKMAP_READS.includes(route))).toEqual([]);
      expect(third).not.toContain('goals/list');
      expect(log.changes).toBe(1);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N17 the Host serves the working Main with its token meta, no-store and no sample Goal', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    let build: string | undefined;
    try {
      build = await copyBuiltWorkbench(opened.world.ag2b.publicDir);
      const response = await fetch(new URL('Main.dc.html', opened.world.base));
      const body = await response.text();
      /* 具名改坏: `src/app/server.ts:235` 的 `if (name.endsWith('.dc.html'))` 改成
         `if (name === 'TaskMap.dc.html')`；N17 的 Main meta 断言红。 */
      expect(body).toContain(`<meta name="platform-token" content="${opened.world.token}">`);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body.includes('状态机可靠性改造')).toBe(false);
    } finally {
      if (build !== undefined) await removeBuild(build);
    }
  }, 60_000);
});
