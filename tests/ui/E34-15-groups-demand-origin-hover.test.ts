import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  adaptTaskMap, adaptTaskMapTime, type TaskMapDisplayRead, type TaskMapGoalRead, type TaskMapGraphRead,
  type TaskMapTimeData, type TaskMapTrackLineRead, type TaskMapTrackPageRead,
} from '../../src/ui/adapters/task-map.js';
import { readTaskMap } from '../../src/ui/boot.js';
import { BoardView } from '../../src/ui/runtime.js';
import { loadBoard } from './helpers/board-files.js';

/**
 * E34-15 (rework rows 25–28): the line carries its real `groups.task/module`,
 * a bar click demands both the task detail and its line chain and withdraws
 * them on close, the 全部 origin takes the earlier of Run and Session creation
 * before track, and a node hover keeps the colon-bearing key.
 */

const SCOPE = { projectId: 'e34-15-p', workspaceId: 'e34-15-w' };
const GOAL = { aggregateType: 'Goal', projectId: SCOPE.projectId, goalId: 'e34-15-g' };
const NOW = '2026-10-04T12:00:00.000Z';
const SESSION = { projectId: SCOPE.projectId, workspaceId: SCOPE.workspaceId, sessionId: 'e34-15-s1' };

const task = (taskId: string, phase = 'pending') => ({
  definition: {
    taskId, title: taskId, stageId: 'e34-15-stage', disposition: 'active', phase,
    executionIntent: 'request_execution',
  },
  effectivePhase: phase, disposition: 'active',
});

function graphOf(dependsOn: Array<{ taskId: string; dependsOnId: string }>): TaskMapGraphRead {
  return {
    plan: {
      stages: [{ stageId: 'e34-15-stage', title: 'E34-15 阶段' }],
      executionDag: { dependsOn: dependsOn.map((edge) => ({ ...edge, requires: { kind: 'output-contract', label: 'x' } })) },
    },
    tasks: [task('A', 'failed'), task('B'), task('C'), task('D')],
  } as unknown as TaskMapGraphRead;
}

function fixtureLine(overrides: Record<string, unknown> = {}): TaskMapTrackLineRead {
  return {
    key: SESSION,
    duty: 'executor',
    name: { primary: '执行者 · E34-15 线' },
    status: { own: 'working' },
    sessionCount: { status: 'exact', value: 1 },
    chainSessions: [SESSION],
    pinned: false, pinnedBy: [], archived: false,
    groups: {
      task: { projectId: SCOPE.projectId, goalId: GOAL.goalId, taskId: 'A' },
      module: { projectId: SCOPE.projectId, moduleId: 'e34-15-module' },
    },
    ...overrides,
  } as unknown as TaskMapTrackLineRead;
}

function trackPage(bars: unknown[]): TaskMapTrackPageRead {
  return {
    from: '2026-10-04T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z',
    bars, next: null, hostRestarts: [], queriesIncluded: false,
    unplaced: { runs: 0, rounds: 0, gateRounds: 0 },
  } as unknown as TaskMapTrackPageRead;
}

const runBar = {
  kind: 'run',
  runRef: { aggregateType: 'Run', projectId: SCOPE.projectId, goalId: GOAL.goalId, runId: 'e34-15-run' },
  taskId: 'A', sessionRef: SESSION,
  startAt: '2026-10-04T10:00:00.000Z', endAt: '2026-10-04T10:30:00.000Z', result: 'completed',
};

function timeData(line: TaskMapTrackLineRead = fixtureLine()): TaskMapTimeData {
  return adaptTaskMapTime([trackPage([runBar])], null, null, [line], NOW,
    { working: { status: 'exact', value: 1 }, archived: { status: 'exact', value: 1 } });
}

function boardOf(time: TaskMapTimeData, actions?: { readMore(demand: unknown): void }) {
  const board = loadBoard('TaskMap', fileURLToPath(new URL('../../src/ui/boards/', import.meta.url)));
  const goalRead = { goal: { ref: GOAL, objective: 'E34-15 目标' } } as unknown as TaskMapGoalRead;
  const displayRead = { goal: goalRead.goal, display: { phase: 'RUNNING' } } as unknown as TaskMapDisplayRead;
  /* A depends on B and on C, and B depends on C: C>A is the redundant
     (transitive) edge the hover must reveal. */
  const data = adaptTaskMap(goalRead, graphOf([
    { taskId: 'A', dependsOnId: 'B' }, { taskId: 'A', dependsOnId: 'C' }, { taskId: 'B', dependsOnId: 'C' },
  ]), displayRead, { hover: { modules: [{ module: { projectId: SCOPE.projectId, moduleId: 'e34-15-module' }, name: 'E34-15 模块' }] } });
  data.time = time;
  return new BoardView(board, { ...board.defaults, data, readState: { status: 'ready' }, dataVersion: 1,
    actions: { readMore: actions?.readMore ?? (() => {}), pinLine: async () => {} } });
}

describe('E34-15 rows 25–28', () => {
  it('E34-15 row 25 groups the line by its real task and module', () => {
    /* Named mutations: the adapter drops `groups`, so the line is not under its
       module; or the board names the group by its moduleId, not the
       `graph/hover` name (5.3). */
    const time = timeData();
    expect(time.rows[0]!.groups).toEqual({
      task: { taskId: 'A' },
      module: { moduleId: 'e34-15-module' },
    });
    const view = boardOf(time);
    view.instance.setState({ view: 'lanes', wlBy: 'module', wlAttn: true });
    const wl = (view.instance.renderVals() as { wl: { rows: Array<{ isGrp: boolean; isLine: boolean; name: string; title: string }> } }).wl;
    expect(wl.rows.some((row) => row.isGrp && row.name === 'E34-15 模块')).toBe(true);
    /* The failed Task's state reaches the attention filter through `groups.task`. */
    expect(wl.rows.some((row) => row.isLine && row.title.includes('执行者 · E34-15 线'))).toBe(true);
  });

  it('E34-15 row 25 groups a module-only maintenance line under its module', () => {
    /* Named mutation: the board gates the module group on `L.task`, so a line
       whose only formal group is a module falls into 对话. */
    const time = timeData(fixtureLine({
      groups: { module: { projectId: SCOPE.projectId, moduleId: 'e34-15-module' } },
    }));
    expect(time.rows[0]!.groups).toEqual({ task: null, module: { moduleId: 'e34-15-module' } });
    const view = boardOf(time);
    view.instance.setState({ view: 'lanes', wlBy: 'module' });
    const wl = (view.instance.renderVals() as { wl: { rows: Array<{ isGrp: boolean; name: string }> } }).wl;
    expect(wl.rows.some((row) => row.isGrp && row.name === 'E34-15 模块')).toBe(true);
    expect(wl.rows.some((row) => row.isGrp && row.name === '对话、咨询与验收')).toBe(false);
  });

  it('E34-15 row 26 demands detail and line on a bar click and withdraws them', () => {
    /* Named mutation: `pickBar` only does `set(p)` (the old local-only click). */
    const calls: Array<Record<string, unknown>> = [];
    const view = boardOf(timeData(), { readMore: (demand) => calls.push(demand as Record<string, unknown>) });
    view.instance.setState({ view: 'lanes', wlBy: 'role' });
    const wl = () => (view.instance.renderVals() as {
      wl: { rows: Array<{ isLine: boolean; isArch: boolean; bars: Array<{ pick(): void }>; toggle(): void }>; wins: Array<{ go(): void }>; selClear(): void };
    }).wl;
    const lineRow = wl().rows.find((row) => row.isLine && row.bars.length > 0)!;
    lineRow.bars[0]!.pick();
    expect(calls.at(-1)).toEqual({
      detailTaskId: 'A',
      lineKey: { projectId: SCOPE.projectId, sessionId: SESSION.sessionId },
    });
    /* Deselecting the same bar withdraws only the line demand; the Task's detail stays. */
    wl().rows.find((row) => row.isLine && row.bars.length > 0)!.bars[0]!.pick();
    expect(calls.at(-1)).toEqual({ lineKey: null });
    /* 收起归档 withdraws the archive read. */
    const arch = wl().rows.find((row) => row.isArch)!;
    arch.toggle();
    expect(calls.at(-1)).toEqual({ track: true, archive: true });
    wl().rows.find((row) => row.isArch)!.toggle();
    expect(calls.at(-1)).toEqual({ track: true, archive: false });
    /* A window switch withdraws the old line context too. */
    wl().wins.find((win, index) => index === 2)!.go();
    expect(calls.at(-1)).toMatchObject({ win: 'all', lineKey: null });
    /* 切走 withdraws the stale line/archive demand. */
    (view.instance.renderVals() as { showOutline(): void }).showOutline();
    expect(calls.at(-1)).toEqual({ lineKey: null, archive: false });
    /* Closing the detail withdraws the detail and the line chain. */
    view.instance.setState({ sel: 'task:A' });
    (view.instance.renderVals() as { det: { close(): void } }).det.close();
    expect(calls.at(-1)).toEqual({ detailTaskId: null, lineKey: null });
  });

  it('E34-15 row 27 takes the 全部 origin from Run and Session, archive first', async () => {
    /* Named mutation: the origin takes only the earliest Run, so the Query
       before it (from a Session created even earlier) is outside the window. */
    const calls: Array<{ route: string; input: Record<string, unknown> }> = [];
    const archivedLine = fixtureLine({ archived: true, status: { own: 'archived' }, groups: { task: null, module: null } });
    const bodies: Record<string, unknown> = {
      bootstrap: { workspaces: [{ scope: SCOPE }], changesHead: null },
      'goals/read': { status: 'ready', value: { goal: { ref: GOAL, objective: 'E34-15 目标' } } },
      'goals/display': { status: 'ready', value: { goal: { ref: GOAL, objective: 'E34-15 目标' }, display: { phase: 'RUNNING' } } },
      'tasks/query': { status: 'ready', value: { plan: { stages: [], executionDag: { dependsOn: [] } }, tasks: [task('A')] } },
      'lines/list': { status: 'ready', value: { rows: [], counts: { working: { status: 'exact', value: 0 } } } },
      'graph/hover': { status: 'ready', value: { groups: [], tasks: [] } },
      'lines/archived': { status: 'ready', value: { rows: [archivedLine], nextCursor: null } },
      'lines/read': { status: 'ready', value: {
        kind: 'line', row: archivedLine, omitted: { status: 'exact', value: 0 },
        chain: [{ session: SESSION, provenance: null, lifecycle: 'archived', health: 'available',
          healthConclusion: null, createdAt: '2026-10-01T10:00:00.000Z', archivedAt: null, responsibleOpen: [] }],
      } },
      'executions/list': { status: 'ready', value: { items: [{
        run: { ref: { aggregateType: 'Run', projectId: SCOPE.projectId, goalId: GOAL.goalId, runId: 'e34-15-old-run' },
          task: { taskId: 'A' }, startedAt: '2026-10-03T10:00:00.000Z' },
      }], nextCursor: null } },
    };
    const client = {
      bootstrap: async () => bodies.bootstrap,
      post: async (route: string, _scope: unknown, input: Record<string, unknown>) => {
        calls.push({ route, input });
        if (route === 'activity/track') {
          const from = Date.parse(String(input.from ?? ''));
          const to = Date.parse(String(input.to ?? ''));
          const inWindow = (at: string) => Date.parse(at) >= from && Date.parse(at) < to;
          const queries = Array.isArray(input.sessionRefs) ? [{
            kind: 'query', queryRunRef: { aggregateType: 'QueryRun', projectId: SCOPE.projectId,
              workspaceId: SCOPE.workspaceId, queryJobId: 'e34-15-q', runId: 'e34-15-qr' },
            sessionRef: SESSION, via: 'turn',
            startAt: '2026-10-02T10:00:00.000Z', endAt: '2026-10-02T10:10:00.000Z', result: 'completed',
          }] : [];
          const bars = (Array.isArray(input.sessionRefs) ? queries : [runBar]).filter((bar) => inWindow(bar.startAt));
          return { status: 'ready', value: {
            from: input.from, to: input.to, bars, next: null, hostRestarts: [], queriesIncluded: Array.isArray(input.sessionRefs),
            unplaced: { runs: 0, rounds: 0, gateRounds: 0 },
          } };
        }
        if (route === 'activity/calendar') {
          return { status: 'ready', value: {
            from: input.from, to: input.to, granularity: input.granularity ?? 'hour',
            timeZone: 'UTC', scope: 'goal', cells: [], totals: { steps: 0, edits: 0, checks: 0, complete: true },
          } };
        }
        return bodies[route] ?? { status: 'not_found', code: 'not_found' };
      },
    };
    const read = await readTaskMap(client as never, GOAL.goalId, { track: true, win: 'all', archive: true });
    const time = read.data!.time!;
    /* The archived line is in the Session set before the Query pass. */
    const archived = time.rows.find((row) => row.id === SCOPE.projectId + '/' + SESSION.sessionId);
    expect(archived?.archived).toBe(true);
    const query = archived?.bars.find((bar) => bar.kind === 'query');
    expect(query?.startAt).toBe('2026-10-02T10:00:00.000Z');
    /* Archive and chain reads precede the first track page. */
    const firstTrack = calls.findIndex((call) => call.route === 'activity/track');
    const archive = calls.findIndex((call) => call.route === 'lines/archived');
    const chain = calls.findIndex((call) => call.route === 'lines/read');
    expect(archive).toBeGreaterThan(-1);
    expect(chain).toBeGreaterThan(-1);
    expect(archive).toBeLessThan(firstTrack);
    expect(chain).toBeLessThan(firstTrack);
    /* The origin is the Session's creation, earlier than the first Run. */
    const track = calls.filter((call) => call.route === 'activity/track')[0]!;
    expect(Date.parse(String(track.input.from))).toBeLessThanOrEqual(Date.parse('2026-10-01T10:00:00.000Z'));
    expect(calls.some((call) => call.route === 'sessions/queries')).toBe(false);
  });

  it('E34-15 row 28 keeps the colon-bearing node key on hover', () => {
    /* Named mutation: `hovKey.split(':')[1]` yields the literal `task`, so the
       transitive edge's endpoints never match and it is not drawn. */
    const time = timeData();
    const view = boardOf(time);
    const dag = (view.instance.renderVals() as { dag: { nodes: Array<{ id: string; hover(): void }>; edges: Array<{ key: string; cls: string }> } }).dag;
    const a = dag.nodes.find((node) => node.id === 'task:A')!;
    expect(a).toBeDefined();
    a.hover();
    const hovered = (view.instance.renderVals() as { dag: { edges: Array<{ key: string; cls: string }> } }).dag;
    expect(hovered.edges.find((edge) => edge.key === 'task:C>task:A')?.cls.includes('is-hov')).toBe(false);
    /* An unrelated node lights no edge. */
    const unrelated = (view.instance.renderVals() as { dag: { nodes: Array<{ id: string; hover(): void }> } }).dag
      .nodes.find((node) => node.id === 'task:D')!;
    unrelated.hover();
    const afterD = (view.instance.renderVals() as { dag: { edges: Array<{ cls: string }> } }).dag;
    expect(afterD.edges.some((edge) => edge.cls.includes('is-hov'))).toBe(false);
  });
});
