import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootPage, findButton, type BootedPage, type PageFetch } from './helpers/boot-page.js';

/**
 * E33-4/5/9/10/11 at the page level (ruling items 2, 3, 5 and 6): the page
 * publishes the stream loss and the reread failure, keeps the last data, shows
 * the E3-2 code-table text, rereads after a first stream open and recovers from
 * a Host restart by taking the new token from the page text. The Host replies
 * are the route and SSE shapes these rows need to control; no Host or Runtime
 * is built.
 */

const SCOPE = { projectId: 'e33-p', workspaceId: 'e33-w' };
const GOAL = { aggregateType: 'Goal', projectId: SCOPE.projectId, goalId: 'e33-g' };
const TASK = {
  definition: {
    taskId: 'e33-task', title: 'E33 刷新任务', stageId: 'e33-stage',
    disposition: 'active', phase: 'pending', executionIntent: 'request_execution',
  },
  effectivePhase: 'pending', disposition: 'active',
};

const REPLIES: Record<string, unknown> = {
  bootstrap: {
    workspaces: [{ scope: SCOPE, name: 'E33', workspaceRevision: 1 }], review: null, execution: {},
    changesHead: 'c0000000001',
  },
  'goals/read': { status: 'ready', value: { goal: { ref: GOAL, objective: 'E33 页面目标' } } },
  'goals/display': { status: 'ready', value: { goal: { ref: GOAL, objective: 'E33 页面目标' }, display: { phase: 'RUNNING' } } },
  'tasks/query': { status: 'ready', value: {
    plan: { stages: [{ stageId: 'e33-stage', title: 'E33 阶段' }], executionDag: { dependsOn: [] } },
    tasks: [TASK],
  } },
  /* E34 added the two per-notification reads to the TaskMap page; a Host that
     serves a real Task also answers them, so the stream fixture does too. */
  'lines/list': { status: 'ready', value: { rows: [], counts: { working: 0 } } },
  'graph/hover': { status: 'ready', value: {} },
  /* Ruling 3: the default DAG also reads the day's track and hour calendar. */
  'activity/track': { status: 'ready', value: {
    from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z', bars: [], next: null,
    hostRestarts: [], queriesIncluded: false, unplaced: { runs: 0, rounds: 0, gateRounds: 0 },
  } },
  'activity/calendar': { status: 'ready', value: {
    from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z',
    granularity: 'hour', timeZone: 'UTC', scope: 'goal', cells: [],
    totals: { steps: 0, edits: 0, checks: 0, complete: true },
  } },
};

const rejectedReply = (): Response => new Response(
  JSON.stringify({ status: 'rejected', code: 'unavailable', reason: 'E33 injected failure' }), { status: 200 },
);

const tokenOfRequest = (init: RequestInit | undefined): string => {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.['x-platform-token'] ?? '';
};

/** The scripted Host: route replies plus a stream whose frames the row writes. */
function scriptedHost() {
  const state = {
    bootstrapFails: false, tasksFail: false, changes: 0, tasksReads: 0,
    openings: [] as ReadableStreamDefaultController<Uint8Array>[],
    taskDisposition: 'active',
    changesGate: null as Promise<void> | null,
    pageToken: 'e33-token',
    rotateTokenOnReject: false,
    readTokens: [] as string[],
    changesTokens: [] as string[],
  };
  const pageRequest: PageFetch = async (url, init) => {
    const token = tokenOfRequest(init);
    if (url.includes('/api/real/core/changes')) {
      state.changes += 1;
      state.changesTokens.push(token);
      if (state.changesGate !== null) await state.changesGate;
      if (state.rotateTokenOnReject && token === state.pageToken) {
        state.pageToken = 'e33-token-new';
        state.rotateTokenOnReject = false;
        return new Response(JSON.stringify({
          status: 'rejected', code: 'forbidden', reason: 'the local platform token is stale',
        }), { status: 403 });
      }
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { state.openings.push(controller); },
      }), { status: 200 });
    }
    state.readTokens.push(token);
    const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
    if (route === 'bootstrap' && state.bootstrapFails) return rejectedReply();
    if (route === 'tasks/query') {
      state.tasksReads += 1;
      if (state.tasksFail) return rejectedReply();
      return new Response(JSON.stringify({
        status: 'ready',
        value: {
          plan: { stages: [{ stageId: 'e33-stage', title: 'E33 阶段' }], executionDag: { dependsOn: [] } },
          tasks: [{
            ...TASK,
            definition: { ...TASK.definition, disposition: state.taskDisposition },
            disposition: state.taskDisposition,
          }],
        },
      }), { status: 200 });
    }
    return new Response(JSON.stringify(REPLIES[route] ?? { status: 'not_found', code: 'not_found' }), { status: 200 });
  };
  return { state, request: pageRequest };
}

function push(state: { openings: ReadableStreamDefaultController<Uint8Array>[] }, frame: string): void {
  const opening = state.openings.at(-1);
  if (opening === undefined) throw new Error('the page did not open the change stream');
  opening.enqueue(new TextEncoder().encode(frame));
}

const flush = async (): Promise<void> => { for (let i = 0; i < 400; i += 1) await Promise.resolve(); };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('E33-4 the page survives a stream loss and reconnects', () => {
  it('E33-4 stream end keeps the data and shows the reconnect text; the reconnect itself rereads and clears it', async () => {
    vi.useFakeTimers();
    const host = scriptedHost();
    let page: BootedPage | undefined;
    try {
      page = await bootPage({ name: 'TaskMap', search: '?goal=e33-g', token: 'e33-token', request: host.request });
      await flush();
      expect(page.root.textContent).toContain('E33 刷新任务');
      expect(host.state.changes).toBe(1);
      expect(host.state.tasksReads).toBe(2);

      host.state.openings[0]!.close();
      await flush();
      expect(page.root.textContent).toContain('E33 刷新任务');
      expect(page.root.textContent).toContain('连接断开，正在重连。');

      vi.advanceTimersByTime(1_999);
      await flush();
      expect(host.state.changes).toBe(1);
      vi.advanceTimersByTime(1);
      await flush();
      expect(host.state.changes).toBe(2);
      expect(host.state.tasksReads).toBe(3);
      expect(page.root.textContent).not.toContain('连接断开，正在重连。');
      expect(page.root.textContent).toContain('E33 刷新任务');
    } finally {
      await page?.restore();
    }
  });
});

describe('E33-5 the page keeps the last data when a reread fails and retries a first failure', () => {
  it('E33-5 a failed reread keeps the data and shows the E3-2 code-table text', async () => {
    const host = scriptedHost();
    let page: BootedPage | undefined;
    try {
      page = await bootPage({ name: 'TaskMap', search: '?goal=e33-g', token: 'e33-token', request: host.request });
      expect(page.root.textContent).toContain('E33 刷新任务');
      host.state.tasksFail = true;
      push(host.state, 'event: change\nid: c0000000002\ndata: {}\n\n');
      await flush();
      expect(page.root.textContent).toContain('E33 刷新任务');
      expect(page.root.textContent).toContain('暂时读不到，可以重试。');
    } finally {
      await page?.restore();
    }
  });

  it('E33-5 a failed first read shows the error and retry with no stream until the retry succeeds', async () => {
    const host = scriptedHost();
    host.state.bootstrapFails = true;
    let page: BootedPage | undefined;
    try {
      page = await bootPage({ name: 'TaskMap', search: '?goal=e33-g', token: 'e33-token', request: host.request });
      expect(host.state.changes).toBe(0);
      expect(page.root.textContent).toContain('暂时读不到，可以重试。');
      const retry = findButton(page.root, '重试');
      expect(retry).toBeDefined();

      host.state.bootstrapFails = false;
      retry!.dispatch('click');
      await flush();
      expect(host.state.changes).toBe(1);
      expect(page.root.textContent).toContain('E33 刷新任务');
      expect(page.root.textContent).not.toContain('暂时读不到，可以重试。');
    } finally {
      await page?.restore();
    }
  });
});

describe('E33-9 a Host restart is recovered from the token in the served page', () => {
  it('E33-9 the first stream 403 rereads the page text, then the stream and the reads use the new token', async () => {
    vi.useFakeTimers();
    const host = scriptedHost();
    host.state.pageToken = 'e33-token-old';
    host.state.rotateTokenOnReject = true;
    let page: BootedPage | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=e33-g', token: () => host.state.pageToken, request: host.request,
      });
      expect(page.root.textContent).toContain('E33 刷新任务');
      expect(host.state.changesTokens).toEqual(['e33-token-old']);

      await flush();
      const oldReads = host.state.readTokens.length;
      /* bootstrap, goals/read, goals/display, tasks/query, lines/list, graph/hover,
         plus the default day's activity/track and activity/calendar. */
      expect(oldReads).toBe(8);
      expect(page.root.textContent).toContain('连接断开，正在重连。');
      vi.advanceTimersByTime(2_000);
      await flush();

      expect(host.state.changesTokens).toEqual(['e33-token-old', 'e33-token-new']);
      expect(host.state.readTokens.slice(0, oldReads).every((token) => token === 'e33-token-old')).toBe(true);
      expect(host.state.readTokens.slice(oldReads).every((token) => token === 'e33-token-new')).toBe(true);
      expect(host.state.tasksReads).toBe(2);
      expect(page.root.textContent).not.toContain('连接断开，正在重连。');
      expect(page.root.textContent).toContain('E33 刷新任务');
    } finally {
      await page?.restore();
    }
  });
});

describe('E33-10 a reconnect whose first frame is change or reset still clears the banner', () => {
  it.each(['change', 'reset'])('E33-10 the first %s frame needs no ready frame', async (event) => {
    vi.useFakeTimers();
    const host = scriptedHost();
    let page: BootedPage | undefined;
    try {
      page = await bootPage({ name: 'TaskMap', search: '?goal=e33-g', token: 'e33-token', request: host.request });
      host.state.openings[0]!.close();
      await flush();
      expect(page.root.textContent).toContain('连接断开，正在重连。');

      vi.advanceTimersByTime(2_000);
      await flush();
      push(host.state, `event: ${event}\nid: c0000000002\ndata: {"cursor":"c0000000002"}\n\n`);
      await flush();

      expect(host.state.changes).toBe(2);
      expect(host.state.tasksReads).toBe(4);
      expect(page.root.textContent).not.toContain('连接断开，正在重连。');
      expect(page.root.textContent).toContain('E33 刷新任务');
    } finally {
      await page?.restore();
    }
  });
});

describe('E33-11 the first stream open rereads once', () => {
  it('E33-11 a commit between the first read and the stream open is shown without a change frame', async () => {
    const host = scriptedHost();
    let release!: () => void;
    host.state.changesGate = new Promise<void>((resolve) => { release = resolve; });
    let page: BootedPage | undefined;
    try {
      page = await bootPage({ name: 'TaskMap', search: '?goal=e33-g', token: 'e33-token', request: host.request });
      expect(findButton(page.root, 'E33 刷新任务')!.getAttribute('aria-label')).toContain('待执行');
      host.state.taskDisposition = 'deferred';
      release();
      await flush();
      expect(host.state.tasksReads).toBe(2);
      expect(findButton(page.root, 'E33 刷新任务')!.getAttribute('aria-label')).toContain('已延后');
      expect(page.root.textContent).not.toContain('连接断开，正在重连。');
    } finally {
      await page?.restore();
    }
  });
});
