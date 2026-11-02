import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bootBoardPage } from '../../src/ui/boot.js';
import { BoardView } from '../../src/ui/runtime.js';
import { BOARD_NAMES, loadBoard } from './helpers/board-files.js';
import { FakeElement, installFakeDom, restoreFakeDom } from './helpers/dom.js';

/**
 * E32-7 (ruling item 3 and row E32-7): `bootBoardPage` reads the token from the
 * served page, loads the real Host routes through the host client and calls
 * `updateProps`, so the mounted DOM carries the real Goal and Task names. The
 * page source is the working copy; the token only reaches the request header.
 */
const rootDir = fileURLToPath(new URL('../..', import.meta.url));
const PAGE_URL = 'http://host/workbench/TaskMap.dc.html';
const TOKEN = 'e32-boot-token';

type FakePage = ReturnType<typeof installFakeDom> & {
  title: string;
  readyState: string;
  head: FakeElement;
  addEventListener(): void;
  querySelector(selector: string): FakeElement | null;
};

afterEach(() => {
  restoreFakeDom();
});

describe('E32-7 boot reads the real task map', () => {
  it('mounts the token page and updates the DOM with real names', async () => {
    const source = readFileSync(`${rootDir}src/ui/boards/TaskMap.dc.html`, 'utf8')
      .replace('</head>', `<meta name="platform-token" content="${TOKEN}">\n</head>`);
    const dom = installFakeDom();
    const page = dom as unknown as FakePage;
    const root = new FakeElement('x-dc');
    const meta = new FakeElement('meta');
    meta.setAttribute('content', TOKEN);
    page.title = '任务图';
    page.readyState = 'loading';
    page.head = new FakeElement('head');
    page.addEventListener = () => {};
    page.querySelector = (selector) => {
      if (selector === 'x-dc') return root;
      if (selector === 'meta[name="platform-token"]') return meta;
      return null;
    };
    const createElement = dom.createElement;
    dom.createElement = (tag) => {
      const element = createElement(tag);
      if (tag === 'template') {
        Object.defineProperty(element, 'content', { get: () => createElement('#fragment') });
      }
      return element;
    };

    const savedFetch = globalThis.fetch;
    const savedLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const scope = { projectId: 'e32-project', workspaceId: 'e32-workspace' };
    const goalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId: 'e32-goal' };
    const replies: Record<string, unknown> = {
      bootstrap: { workspaces: [{ scope, name: 'E32 workspace', workspaceRevision: 1 }], review: null, execution: {} },
      'goals/conflicts': { status: 'ready', value: { cards: [], labels: [], footprintCompleteness: [{ goalRef }], sourceCursor: null } },
      'goals/read': { status: 'ready', value: { goal: { ref: goalRef, objective: 'E32 真实目标', desiredState: 'active' }, pendingPlan: null, continuedBy: [] } },
      'goals/display': { status: 'ready', value: {
        goal: { ref: goalRef, objective: 'E32 真实目标' },
        display: { phase: 'RUNNING', row: 'GOAL-27', cause: null, causes: [], runStops: null },
        liveRuns: [], resumePending: [], sourceCursor: null,
      } },
      'tasks/query': { status: 'ready', value: {
        plan: { stages: [{ stageId: 'e32-stage', title: 'E32 阶段' }], executionDag: { dependsOn: [] } },
        tasks: [{
          definition: { taskId: 'e32-task', title: 'E32 真实任务', stageId: 'e32-stage', disposition: 'active', phase: 'pending', executionIntent: 'request_execution' },
          effectivePhase: 'pending', disposition: 'active',
        }],
        sourceCursor: null,
      } },
    };
    let calls = 0;
    let pageFetched = false;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      calls += 1;
      const url = String(input);
      if (url === PAGE_URL) { pageFetched = true; return { text: async () => source } as unknown as Response; }
      const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
      const body = replies[route];
      if (body === undefined) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    Object.defineProperty(globalThis, 'location', {
      value: { href: PAGE_URL, search: '?goal=e32-goal' }, configurable: true,
    });
    try {
      await bootBoardPage();
    } finally {
      globalThis.fetch = savedFetch;
      if (savedLocation) Object.defineProperty(globalThis, 'location', savedLocation);
      else delete (globalThis as { location?: unknown }).location;
    }

    const text = root.textContent;
    expect(calls).toBe(5);
    expect(pageFetched).toBe(true);
    expect(text).toContain('E32 真实目标');
    expect(text).toContain('E32 真实任务');
    expect(text).toContain('待执行');
    expect(text).not.toContain('状态机可靠性改造');
    expect(text).not.toContain('状态机规格对齐');
  });
});

const NINE_BOARDS = BOARD_NAMES.filter((name) => name !== 'TaskMap');

describe('R7 a board outside the reader table mounts the E3-1 sample', () => {
  it.each(NINE_BOARDS)('R7 %s issues no route request and renders the sample', async (name) => {
    const source = readFileSync(`${rootDir}docs/ui-reference/workbench-2026-10/${name}.dc.html`, 'utf8');
    const pageUrl = `http://host/workbench/${name}.dc.html`;
    const dom = installFakeDom();
    const page = dom as unknown as FakePage;
    const root = new FakeElement('x-dc');
    const meta = new FakeElement('meta');
    meta.setAttribute('content', TOKEN);
    page.title = name;
    page.readyState = 'loading';
    page.head = new FakeElement('head');
    page.addEventListener = () => {};
    page.querySelector = (selector) => {
      if (selector === 'x-dc') return root;
      if (selector === 'meta[name="platform-token"]') return meta;
      return null;
    };
    const createElement = dom.createElement;
    dom.createElement = (tag) => {
      const element = createElement(tag);
      if (tag === 'template') {
        Object.defineProperty(element, 'content', { get: () => createElement('#fragment') });
      }
      return element;
    };

    const savedFetch = globalThis.fetch;
    const savedLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    let pageFetches = 0;
    let routeRequests = 0;
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url === pageUrl) {
        pageFetches += 1;
        return { text: async () => source } as unknown as Response;
      }
      if (url.includes('/api/real/core/')) routeRequests += 1;
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    Object.defineProperty(globalThis, 'location', {
      value: { href: pageUrl, search: '' }, configurable: true,
    });
    try {
      await bootBoardPage();
      expect(pageFetches).toBe(1);
      expect(routeRequests).toBe(0);
      const expectedRoot = new FakeElement('x-dc');
      new BoardView(loadBoard(name)).mount(expectedRoot as unknown as Element);
      expect(root.textContent).toBe(expectedRoot.textContent);
    } finally {
      globalThis.fetch = savedFetch;
      if (savedLocation) Object.defineProperty(globalThis, 'location', savedLocation);
      else delete (globalThis as { location?: unknown }).location;
      restoreFakeDom();
    }
  }, 30_000);
});
