import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { bootPage, findButton, type BootedPage } from './helpers/boot-page.js';
import { readTaskMap } from '../../src/ui/boot.js';
import type { createHostClient } from '../../src/ui/host-client.js';
import { loadBoard } from './helpers/board-files.js';
import { until } from '../helpers/change-stream-reader.js';
import {
  adaptTaskMap, adaptTaskMapTime, type TaskMapCalendarRead, type TaskMapDisplayRead, type TaskMapGoalRead, type TaskMapGraphRead,
} from '../../src/ui/adapters/task-map.js';
import { BoardView } from '../../src/ui/runtime.js';

/**
 * E34-9 (ruling 7, design §7): the default DAG reads six base routes plus the
 * day's track and hour calendar, in that order, and nothing else. The board's
 * 全部 window asks `executions/list` for every page: the second request carries
 * the first page's cursor and the earlier starts from page 2 reach the track
 * window. This proves the client's HTTP paging, not that the server produced
 * 200 Runs.
 */

const SCOPE = { projectId: 'e34-9-p', workspaceId: 'e34-9-w' };
const GOAL = { aggregateType: 'Goal', projectId: SCOPE.projectId, goalId: 'e34-9-g' };
const WORK = {
  definition: {
    taskId: 'e34-9-t', title: 'E34-9 任务', stageId: 'e34-9-s',
    disposition: 'active', phase: 'pending', executionIntent: 'request_execution',
  },
  effectivePhase: 'pending', disposition: 'active',
};
/** A plan Task the complete execution index never names: the one 未排期 task. */
const UNPLACED = {
  definition: {
    taskId: 'e34-9-u', title: 'E34-9 没有执行的任务', stageId: 'e34-9-s',
    disposition: 'active', phase: 'pending', executionIntent: 'request_execution',
  },
  effectivePhase: 'pending', disposition: 'active',
};

type ExecInput = { page?: { afterCursor?: string | null } };
type TrackInput = { from?: string; to?: string };
type Ready<T> = { status: 'ready'; value: T };
const ready = <T,>(reply: unknown): T => (reply as Ready<T>).value;

function scriptedHost() {
  const log: string[] = [];
  const executionInputs: ExecInput[] = [];
  const trackInputs: TrackInput[] = [];
  const body = (route: string, input: unknown): unknown => {
    switch (route) {
      case 'bootstrap': return {
        workspaces: [{ scope: SCOPE, name: 'E34-9', workspaceRevision: 1 }],
        review: null, execution: {}, changesHead: 'c0000000001',
      };
      case 'goals/read': return { status: 'ready', value: { goal: { ref: GOAL, objective: 'E34-9 目标' } } };
      case 'goals/display': return { status: 'ready', value: {
        goal: { ref: GOAL, objective: 'E34-9 目标' }, display: { phase: 'RUNNING' },
      } };
      case 'tasks/query': return { status: 'ready', value: {
        plan: { stages: [{ stageId: 'e34-9-s', title: 'E34-9 阶段' }], executionDag: { dependsOn: [] } },
        tasks: [WORK, UNPLACED],
      } };
      case 'lines/list': return { status: 'ready', value: {
        rows: [], counts: { working: { status: 'exact', value: 0 } },
      } };
      case 'graph/hover': return { status: 'ready', value: { groups: [], tasks: [] } };
      case 'activity/track': {
        const page = input as TrackInput;
        trackInputs.push(page);
        return { status: 'ready', value: {
          from: page.from ?? '2026-10-04T00:00:00.000Z', to: page.to ?? '2026-10-05T00:00:00.000Z',
          bars: [], next: null, hostRestarts: [], queriesIncluded: false,
          unplaced: { runs: 0, rounds: 0, gateRounds: 0 },
        } };
      }
      case 'activity/calendar': {
        const page = input as { from?: string; to?: string; granularity?: string; timeZone?: string };
        /* 全部 spans more than 14 days, so boot reads day buckets. The long
           view needs a real multi-day calendar; a short window stays empty. */
        const days = page.granularity === 'day' ? Array.from({ length: 20 }, (_, index) => {
          const day = '2026-09-' + String(index + 1).padStart(2, '0');
          const next = '2026-09-' + String(index + 2).padStart(2, '0');
          return { localDate: day, localHour: null, startAt: day + 'T00:00:00.000Z', endAt: next + 'T00:00:00.000Z',
            steps: 0, edits: 0, checks: 0, complete: true, tasks: [], moreTasks: 0, sessions: [], moreSessions: 0 };
        }) : [];
        return { status: 'ready', value: {
          from: page.from ?? '2026-10-04T00:00:00.000Z', to: page.to ?? '2026-10-05T00:00:00.000Z',
          granularity: page.granularity === 'day' ? 'day' : 'hour',
          timeZone: page.timeZone ?? 'UTC', scope: 'goal', cells: days,
          totals: { steps: 0, edits: 0, checks: 0, complete: true },
        } };
      }
      case 'executions/list': {
        const page = input as ExecInput;
        executionInputs.push(page);
        const second = page.page?.afterCursor === 'e34-9-page-2';
        const start = second ? '2026-09-01' : '2026-10-01';
        const items = Array.from({ length: 100 }, (_, index) => ({
          run: {
            ref: { aggregateType: 'Run', projectId: SCOPE.projectId, goalId: GOAL.goalId,
              runId: `${start}-${String(index).padStart(3, '0')}` },
            task: { taskId: 'e34-9-t' },
            startedAt: `${start}T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
          },
        }));
        return { status: 'ready', value: { items, nextCursor: second ? null : 'e34-9-page-2' } };
      }
      default: return { status: 'not_found', code: 'not_found' };
    }
  };
  return { log, executionInputs, trackInputs, body };
}

describe('E34-9 the default read budget and the execution pager', () => {
  it('E34-9 reads exactly the default eight routes, then pages 全部 twice with the second cursor', async () => {
    const host = scriptedHost();
    let page: BootedPage | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: `?goal=${GOAL.goalId}`, token: 'e34-9-token',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          host.log.push(route);
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = envelope.input ?? envelope;
          return new Response(JSON.stringify(host.body(route, input)), { status: 200 });
        },
      });
      await until(() => host.log.includes('activity/calendar'), 20_000);
      expect(page.root.textContent).toContain('E34-9 任务');
      /* The first screen has no complete execution index: no 未排期 number. */
      expect(page.root.textContent).not.toContain('未排期');
      /* Ruling 3 / design §7: 6 + T + Q + C, with no execution page by default.
         The whole first round, not a prefix: one extra lines/list fails here. */
      expect(host.log).toEqual([
        'bootstrap', 'goals/read', 'goals/display', 'tasks/query', 'lines/list',
        'graph/hover', 'activity/track', 'activity/calendar',
      ]);
      expect(host.log).not.toContain('executions/list');

      host.log.length = 0;
      findButton(page.root, '全部')!.dispatch('click');
      await until(() => host.executionInputs.length === 2 && host.log.includes('activity/calendar'), 20_000);
      expect(host.executionInputs.map((input) => input.page?.afterCursor ?? null)).toEqual([null, 'e34-9-page-2']);
      /* Page 2's earlier start reaches the track window, so both pages' ids were kept. */
      const lastTrack = host.trackInputs.at(-1)!;
      expect(Date.parse(lastTrack.from!)).toBeLessThanOrEqual(Date.parse('2026-09-01T00:00:00.000Z'));
      expect(host.log.filter((route) => route === 'executions/list')).toHaveLength(2);
      /* Both pages' 200 identities survive the merge; clearing per page keeps
         only the second 100 and turns these two assertions red. */
      const client = {
        bootstrap: async () => ({ workspaces: [{ scope: SCOPE, name: 'E34-9', workspaceRevision: 1 }], changesHead: 'c0000000001' }),
        post: async (route: string, _scope: unknown, input: unknown) => host.body(route, input),
      } as unknown as ReturnType<typeof createHostClient>;
      const all = await readTaskMap(client, GOAL.goalId, { win: 'all', track: true });
      const retained = (all.data!.time as unknown as { executions: Array<{ runId: string }> }).executions;
      /* The 200 identities are the two scripted pages' ids, not merely 200
         unique strings: replacing another id would pass a count-only check. */
      const expected = ['2026-10-01', '2026-09-01'].flatMap((start) => Array.from({ length: 100 },
        (_, index) => `${start}-${String(index).padStart(3, '0')}`));
      expect(retained.map((execution) => execution.runId).sort()).toEqual(expected.sort());
      expect(all.data!.time!.executionsRead).toBe(200);
      expect(page.root.textContent).not.toContain('NaN');
      expect(page.root.textContent).not.toContain('undefined');
    } finally {
      await page?.restore();
    }

    /* The 未排期 number lives in the summary line of the full 轨道 view. Render
       the same scripted replies with a complete and a partial 全部 index: only
       the complete one names the plan Task that no Run names. */
    const board = loadBoard('TaskMap', fileURLToPath(new URL('../../src/ui/boards/', import.meta.url)));
    const goalRead = ready<TaskMapGoalRead>(host.body('goals/read', {}));
    const graphRead = ready<TaskMapGraphRead>(host.body('tasks/query', {}));
    const displayRead = ready<TaskMapDisplayRead>(host.body('goals/display', {}));
    const allCalendar = ready<TaskMapCalendarRead>(host.body('activity/calendar', {
      granularity: 'day', from: '2026-09-01T00:00:00.000Z', to: '2026-10-04T06:00:00.000Z',
    }));
    const shortCalendar: TaskMapCalendarRead = { ...allCalendar, cells: allCalendar.cells.slice(0, 2) };
    const boardHost = scriptedHost();
    const firstPage = ready<{ items: Array<{ run: { ref: { runId: string }; task: { taskId: string }; startedAt: string } }>; nextCursor: string | null }>(
      boardHost.body('executions/list', {}));
    const secondPage = ready<typeof firstPage>(boardHost.body('executions/list', { page: { afterCursor: firstPage.nextCursor } }));
    const executions = [...firstPage.items, ...secondPage.items].map((item) => ({ runId: item.run.ref.runId,
      taskId: item.run.task.taskId, startAt: item.run.startedAt }));
    const sumOf = (complete: boolean, calendar: TaskMapCalendarRead): string => {
      const time = adaptTaskMapTime([{ bars: [], next: null, from: calendar.from, to: calendar.to }], calendar, null, [], '2026-10-04T06:15:00.000Z',
        { working: { status: 'exact', value: 0 } });
      Object.assign(time, {
        executionsComplete: complete,
        executions,
      });
      const data = adaptTaskMap(goalRead, graphRead, displayRead);
      data.time = time;
      const view = new BoardView(board, { ...board.defaults, data, readState: { status: 'ready' }, dataVersion: 1 });
      view.instance.setState({ view: 'lanes', wlWin: 'all' });
      return (view.instance.renderVals() as { wl: { sum: string } }).wl.sum;
    };
    /* Both summaries append the prototype's · 未排期 1 after the complete read. */
    expect(sumOf(true, shortCalendar)).toContain('未排期 1');
    expect(sumOf(true, allCalendar)).toContain('未排期 1');
    /* A partial index has no number at all. */
    expect(sumOf(false, allCalendar)).not.toContain('未排期');
  }, 30_000);
});
