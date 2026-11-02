import { describe, expect, it } from 'vitest';
import { BoardView } from '../../src/ui/runtime.js';
import { BOARD_NAMES, loadBoard } from './helpers/board-files.js';
import { bootPage } from './helpers/boot-page.js';
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
      /* E3-3: the boot now opens the change stream after the five reads; this
         row's fake fetch answers it with 404, so it counts as the sixth request. */
      expect(calls + page.pageFetches()).toBe(6);
      expect(page.pageFetches()).toBe(1);
      expect(text).toContain('E32 真实目标');
      expect(text).toContain('E32 真实任务');
      expect(text).toContain('待执行');
      expect(text).not.toContain('状态机可靠性改造');
      expect(text).not.toContain('状态机规格对齐');
    } finally {
      await page.restore();
    }
  });
});

const NINE_BOARDS = BOARD_NAMES.filter((name) => name !== 'TaskMap');

describe('R7 a board outside the reader table mounts the E3-1 sample', () => {
  it.each(NINE_BOARDS)('R7 %s issues no route request and renders the sample', async (name) => {
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
