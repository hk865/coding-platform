import { fileURLToPath } from 'node:url';
import { adaptTaskMap, adaptTaskMapTime, type TaskMapCalendarRead, type TaskMapData, type TaskMapLineRead, type TaskMapTimelineRead, type TaskMapTrackLineRead, type TaskMapTrackPageRead } from '../../../src/ui/adapters/task-map.js';
import { BoardView } from '../../../src/ui/runtime.js';
import { loadBoard } from './board-files.js';
import { scene } from './task-map-scene.js';

/** E3-5: the base scene adapted once, and the working board rendered on it with a recording `readMore`. */
export type Row = Record<string, unknown>;
export type Pick = { id: string; key: string; name: string; text: string; tip: string; title: string; sub: string; isLine: boolean; isArch: boolean; isGrp: boolean; bars: Pick[]; items: Pick[];
  pick(): void; pin(): void; go(): void; toggle(): void; hover(): void };
export type Vals = { dag: { nodes: Pick[] }; det: (Pick & { rel: Pick[]; lines: Pick[]; close(): void }) | null; now: { items: Pick[] };
  wl: { rows: Pick[]; selClear(): void; selSub: string; cur: { key(e: { key: string }): void }; cal: { rows: Array<{ cells: Array<Pick & { tip: string; hover(): void }> }> };
    ccard: Pick & { hint: string; word: string }; cellLabel: string; sum: string;
    yr: { weeks: Array<{ days: Array<Pick & { cls: string; tip: string; hover(): void }> }>; card: Pick & { hint: string; word: string } } } } & Row;
export const value = <T,>(route: string, input: Row = {}): T => (scene.reply(route, input) as unknown as { value: T }).value;

export function sceneData(calendar: TaskMapCalendarRead | null = null, timeline: TaskMapTimelineRead | null = null): TaskMapData {
  const lines = value<TaskMapLineRead & { rows: TaskMapTrackLineRead[] }>('lines/list');
  const data = adaptTaskMap(value('goals/read'), value('tasks/query'), value('goals/display'), { lines, hover: value('graph/hover') });
  data.time = adaptTaskMapTime([value<TaskMapTrackPageRead>('activity/track')], calendar, timeline, lines.rows, scene.now, lines.counts);
  return data;
}

export function sceneView(calls: Row[], data: TaskMapData = sceneData(), actions: Row = {}, readState: Row = { status: 'ready' }) {
  const board = loadBoard('TaskMap', fileURLToPath(new URL('../../../src/ui/boards/', import.meta.url)));
  const view = new BoardView(board, { ...board.defaults, data, readState, dataVersion: 1,
    actions: { readMore: (d: Row) => calls.push(d), ...actions } });
  return { view, vals: () => view.instance.renderVals() as Vals, state: () => view.instance.state as Row };
}

/** One local hour of 2026-10-04 shaped like `ActivityCellV1`, and an hour calendar of such cells. */
export const hourCell = (h: number, steps: number, extra: Row = {}): Row => ({ localDate: '2026-10-04', localHour: h,
  startAt: new Date(2026, 9, 4, h).toISOString(), endAt: new Date(2026, 9, 4, h + 1).toISOString(), future: false,
  steps, querySteps: 0, edits: 0, editsUnknown: 0, checks: 0, uncountedRuns: 0, inProgressRuns: 0, uncountedQueries: 0, inProgressQueries: 0,
  complete: true, tasks: [], moreTasks: 0, sessions: [], moreSessions: 0, ...extra });
export const hourCalendar = (cells: Row[]): TaskMapCalendarRead => ({ goalRef: { goalId: 'g' }, from: new Date(2026, 9, 4).toISOString(),
  to: new Date(2026, 9, 5).toISOString(), granularity: 'hour', timeZone: 'Asia/Shanghai', scope: 'goal', cells,
  totals: { steps: 0, edits: 0, checks: 0, complete: cells.every((cell) => cell.complete === true) } }) as unknown as TaskMapCalendarRead;
/** Day cells from 2026-09-15 to 2026-10-04 (20 local days: the year view); `steps` by local date, default 1. */
export const dayCalendar = (steps: Record<string, number> = {}, extra: Record<string, Row> = {}): TaskMapCalendarRead => {
  const cells = Array.from({ length: 20 }, (_, i) => {
    const start = new Date(2026, 8, 15 + i); const p = (n: number) => String(n).padStart(2, '0');
    const localDate = start.getFullYear() + '-' + p(start.getMonth() + 1) + '-' + p(start.getDate());
    return { ...hourCell(0, steps[localDate] ?? 1), localDate, localHour: null, startAt: start.toISOString(),
      endAt: new Date(2026, 8, 16 + i).toISOString(), ...extra[localDate] };
  });
  return { ...hourCalendar(cells), from: cells[0]!.startAt, granularity: 'day' } as unknown as TaskMapCalendarRead;
};
