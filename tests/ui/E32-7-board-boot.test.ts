import { describe, expect, it } from 'vitest';
import { BoardView } from '../../src/ui/runtime.js';
import { BOARD_NAMES, loadBoard } from './helpers/board-files.js';
import { bootPage, findButton } from './helpers/boot-page.js';
import { FakeElement } from './helpers/dom.js';

/**
 * E32-7 (ruling item 3 and row E32-7): `bootBoardPage` reads the token from the
 * served page, loads the real Host routes through the host client and calls
 * `updateProps`, so the mounted DOM carries the real Goal and Task names. The
 * page source is the working copy; the token only reaches the request header.
 */
const TOKEN = 'e32-boot-token';

describe('E32-7 boot reads the real task map', () => {
  it('mounts the token page and updates the DOM with real names', async () => {
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
      'lines/list': { status: 'ready', value: { rows: [], counts: { working: { status: 'exact', value: 0 } } } },
      'graph/hover': { status: 'ready', value: { groups: [], tasks: [] } },
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
    let calls = 0;
    const page = await bootPage({
      name: 'TaskMap', search: '?goal=e32-goal', token: TOKEN,
      request: async (url) => {
        calls += 1;
        const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
        const body = replies[route];
        if (body === undefined) return new Response('{}', { status: 404 });
        return new Response(JSON.stringify(body), { status: 200 });
      },
    });
    try {
      const text = page.root.textContent;
      /* Ruling 3: the default DAG reads six base routes, the Goal's decision cards, the day's track
         and hour calendar (9 route reads), opens the change stream (404 here)
         and fetches the page once: 9 + 1 + 1 = 11 requests. */
      expect(calls + page.pageFetches()).toBe(11);
      expect(page.pageFetches()).toBe(1);
      expect(text).toContain('E32 真实目标');
      expect(text).toContain('E32 真实任务');
      expect(findButton(page.root, 'E32 真实任务')!.getAttribute('aria-label')).toContain('待执行');
      expect(text).not.toContain('状态机可靠性改造');
      expect(text).not.toContain('状态机规格对齐');
    } finally {
      await page.restore();
    }
  });
});

const UNWIRED_BOARDS = BOARD_NAMES.filter((name) => name !== 'TaskMap' && name !== 'Main' && name !== 'Goals'
  && name !== 'ArchOverview' && name !== 'Decide' && name !== 'Member' && name !== 'Chain' && name !== 'Done' && name !== 'Plan');

describe('R7 a board outside the reader table mounts the E3-1 sample', () => {
  it.each(UNWIRED_BOARDS)('R7 %s issues no route request and renders the sample', async (name) => {
    let routeRequests = 0;
    const page = await bootPage({
      name, token: TOKEN,
      request: async (url) => {
        if (url.includes('/api/real/core/')) routeRequests += 1;
        return new Response('{}', { status: 404 });
      },
    });
    try {
      expect(page.pageFetches()).toBe(1);
      expect(routeRequests).toBe(0);
      const expectedRoot = new FakeElement('x-dc');
      new BoardView(loadBoard(name)).mount(expectedRoot as unknown as Element);
      expect(page.root.textContent).toBe(expectedRoot.textContent);
    } finally {
      await page.restore();
    }
  }, 30_000);
});
