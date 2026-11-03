import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHostClient } from '../../src/ui/host-client.js';
import { bootPage, findAllClass, findButton, findClass, findElement } from './helpers/boot-page.js';
import { scene } from './helpers/task-map-scene.js';
import { readTaskMap } from '../../src/ui/boot.js';
import {
  adaptTaskMap, adaptTaskMapTime, type TaskMapCalendarRead, type TaskMapDisplayRead,
  type TaskMapGoalRead, type TaskMapGraphRead, type TaskMapTimeData,
} from '../../src/ui/adapters/task-map.js';
import { BoardView } from '../../src/ui/runtime.js';
import { loadBoard } from './helpers/board-files.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import {
  adoptPLTwoStageSkeleton, openPLWorkflowWorld, satisfyPLTask, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

/** E34-7 (rulings 4, 5, 8; design §3/§5): the calendar's day/hour identities
 * are the returned `localDate/localHour/startAt/endAt`, a cross-year and a DST
 * boundary keep their literal instants, and incomplete coverage states its
 * scope instead of showing a full 0. The route facts come from a real Work Run,
 * never a fake RunActivity written into the store. */
let world: PLWorkflowWorld | undefined;
let time: TaskMapTimeData;

beforeAll(async () => {
  world = await openPLWorkflowWorld({ backend: 'memory', label: 'e34-7' });
  await adoptPLTwoStageSkeleton(world.main, world.goal, { label: 'e34-7', stageOneTaskIds: ['pl-a', 'pl-b'] });
  const line = await sessionOf(world.world, await createS6BLine(world.main, { label: 'e34-7-line', role: S6A_WORK_ROLE }));
  await satisfyPLTask(world.world, world.goal, 'pl-a', line, 'e34-7');
  const client = createHostClient(world.world.token, new URL(world.world.base).origin);
  const { data } = await readTaskMap(client, world.goal.goalId, { track: true });
  if (!data?.time) throw new Error('E34-7: the calendar was not read');
  time = data.time;
}, 90_000);

afterAll(async () => { await world?.close(); world = undefined; });

const CROSS_YEAR: TaskMapCalendarRead = {
  goalRef: { goalId: 'g1' }, from: '2026-12-28T00:00:00.000Z', to: '2027-01-05T00:00:00.000Z',
  granularity: 'day', timeZone: 'Asia/Shanghai', scope: 'goal', complete: false,
  cells: [
    { localDate: '2026-12-31', localHour: null, startAt: '2026-12-30T16:00:00.000Z', endAt: '2026-12-31T16:00:00.000Z',
      steps: 2, edits: 0, checks: 1, complete: false, tasks: [{ taskId: 't1', goalId: 'g1' }], moreTasks: 0,
      sessions: [{ projectId: 'p', workspaceId: 'w', sessionId: 's1' }], moreSessions: 0 },
    { localDate: '2027-01-01', localHour: null, startAt: '2026-12-31T16:00:00.000Z', endAt: '2027-01-01T16:00:00.000Z',
      steps: 0, edits: 0, checks: 0, complete: false, tasks: [], moreTasks: 0, sessions: [], moreSessions: 0 },
    { localDate: '2027-01-04', localHour: null, startAt: '2027-01-03T16:00:00.000Z', endAt: '2027-01-04T16:00:00.000Z',
      steps: 1, edits: 1, checks: 0, complete: true, tasks: [], moreTasks: 0, sessions: [], moreSessions: 0 },
    { localDate: '2026-12-31', localHour: 23, startAt: '2026-12-31T23:00:00.000Z', endAt: '2027-01-01T00:00:00.000Z',
      steps: 2, edits: 0, checks: 0, complete: true, tasks: [{ taskId: 't1', goalId: 'g1' }], moreTasks: 0, sessions: [], moreSessions: 0 },
    { localDate: '2027-01-01', localHour: 0, startAt: '2027-01-01T00:00:00.000Z', endAt: '2027-01-01T01:00:00.000Z',
      steps: 0, edits: 0, checks: 0, complete: true, tasks: [], moreTasks: 0, sessions: [], moreSessions: 0 },
  ],
  totals: { steps: 3, edits: 1, checks: 1, complete: false },
};

const DST: TaskMapCalendarRead = {
  goalRef: { goalId: 'g1' }, from: '2026-03-08T05:00:00.000Z', to: '2026-03-09T04:00:00.000Z',
  granularity: 'hour', timeZone: 'America/New_York', scope: 'goal', complete: true,
  cells: [0, 1, 3, 4].map((hour) => ({
    localDate: '2026-03-08', localHour: hour, startAt: `2026-03-08T0${hour + 5}:00:00.000Z`,
    endAt: `2026-03-08T0${hour + 6}:00:00.000Z`, steps: hour, edits: 0, checks: 0, complete: true,
    tasks: [], moreTasks: 0, sessions: [], moreSessions: 0,
  })),
  totals: { steps: 8, edits: 0, checks: 0, complete: true },
};

describe('E34-7 the real calendar and its literal boundaries', () => {
  it('E34-7 reads real day/hour cards and totals from a real Work Run, with split windows inside the limits', () => {
    const calendar = time.calendar!;
    expect(calendar).not.toBeNull();
    expect(calendar.scope).toBe('goal');
    expect(calendar.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(calendar.days.length).toBeGreaterThan(0);
    expect(calendar.hours.length).toBeGreaterThan(0);
    const day = calendar.days[0]!;
    expect(day.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(day.startAt).toMatch(/Z$/);
    expect(day.endAt).toMatch(/Z$/);
    expect(typeof calendar.totals.steps).toBe('number');
    expect(typeof calendar.totals.edits).toBe('number');
    expect(typeof calendar.totals.checks).toBe('number');
    expect(calendar.totals.complete).toBe(calendar.complete);
    for (const window of calendar.windows) {
      const span = Date.parse(window.to) - Date.parse(window.from);
      expect(span).toBeLessThanOrEqual((window.granularity === 'hour' ? 15 : 400) * 24 * 60 * 60 * 1000);
    }
    expect(calendar.summary).toContain('本目标范围');
  });

  it('E34-7 keeps cross-year day identities and weeks, and the DST day has only the returned hours', () => {
    const cal = adaptTaskMapTime([], CROSS_YEAR, null, []).calendar!;
    expect(cal.days.map((d) => [d.localDate, d.startAt, d.endAt])).toEqual([
      ['2026-12-31', '2026-12-30T16:00:00.000Z', '2026-12-31T16:00:00.000Z'],
      ['2027-01-01', '2026-12-31T16:00:00.000Z', '2027-01-01T16:00:00.000Z'],
      ['2027-01-04', '2027-01-03T16:00:00.000Z', '2027-01-04T16:00:00.000Z'],
    ]);
    expect(cal.days[0]!.hours.map((h) => [h.localHour, h.startAt, h.endAt])).toEqual([
      [23, '2026-12-31T23:00:00.000Z', '2027-01-01T00:00:00.000Z'],
    ]);
    expect(cal.totals).toEqual({ steps: 3, edits: 1, checks: 1, complete: false });
    expect(cal.summary).toContain('覆盖不完整');
    expect(cal.summary).toContain('本目标范围');
    expect(cal.summary).not.toContain('步骤 0');
    expect(cal.complete).toBe(false);
  });

  it('E34-7 does not assume 24 hours or derive an hour from a wall-clock string', () => {
    const cal = adaptTaskMapTime([], DST, null, []).calendar!;
    const hours = cal.days[0]!.hours;
    expect(hours.map((h) => h.localHour)).toEqual([0, 1, 3, 4]);
    expect(hours.map((h) => h.startAt)).toEqual([
      '2026-03-08T05:00:00.000Z', '2026-03-08T06:00:00.000Z',
      '2026-03-08T08:00:00.000Z', '2026-03-08T09:00:00.000Z',
    ]);
    expect(cal.summary).toContain('步骤 8');
    expect(cal.summary).not.toContain('覆盖不完整');
  });

  it('E34-7 keeps both fall-back hours and a day-only bucket in their own reads, never adding day and hour totals', () => {
    /* One reply has one granularity (`ensureCell`): a day read has every
       `localHour:null`, an hour read every numeric hour. The two fall-back
       01:00 buckets are a separate hour read, never mixed into a day reply. */
    const FALL_BACK_DAY: TaskMapCalendarRead = {
      goalRef: { goalId: 'g1' }, from: '2026-11-01T04:00:00.000Z', to: '2026-11-03T05:00:00.000Z',
      granularity: 'day', timeZone: 'America/New_York', scope: 'goal',
      cells: [
        { localDate: '2026-11-01', localHour: null, startAt: '2026-11-01T04:00:00.000Z', endAt: '2026-11-02T05:00:00.000Z',
          steps: 3, edits: 0, checks: 0, complete: true, tasks: [], moreTasks: 0, sessions: [], moreSessions: 0 },
        { localDate: '2026-11-02', localHour: null, startAt: '2026-11-02T05:00:00.000Z', endAt: '2026-11-03T05:00:00.000Z',
          steps: 4, edits: 0, checks: 0, complete: true, tasks: [], moreTasks: 0, sessions: [], moreSessions: 0 },
      ],
      totals: { steps: 7, edits: 0, checks: 0, complete: true },
    };
    const FALL_BACK_HOUR: TaskMapCalendarRead = {
      goalRef: { goalId: 'g1' }, from: '2026-11-01T04:00:00.000Z', to: '2026-11-02T05:00:00.000Z',
      granularity: 'hour', timeZone: 'America/New_York', scope: 'goal',
      cells: [
        { localDate: '2026-11-01', localHour: 1, startAt: '2026-11-01T05:00:00.000Z', endAt: '2026-11-01T06:00:00.000Z',
          steps: 1, edits: 0, checks: 0, complete: true, tasks: [], moreTasks: 0, sessions: [], moreSessions: 0 },
        { localDate: '2026-11-01', localHour: 1, startAt: '2026-11-01T06:00:00.000Z', endAt: '2026-11-01T07:00:00.000Z',
          steps: 2, edits: 0, checks: 0, complete: true, tasks: [], moreTasks: 0, sessions: [], moreSessions: 0 },
      ],
      totals: { steps: 3, edits: 0, checks: 0, complete: true },
    };
    /* Every cell in a reply has the reply's own granularity. */
    expect(FALL_BACK_DAY.cells.every((cell) => (cell as { localHour?: unknown }).localHour === null)).toBe(true);
    expect(FALL_BACK_HOUR.cells.every((cell) => typeof (cell as { localHour?: unknown }).localHour === 'number')).toBe(true);
    const day = adaptTaskMapTime([], FALL_BACK_DAY, null, []).calendar!;
    const hour = adaptTaskMapTime([], FALL_BACK_HOUR, null, []).calendar!;
    /* The day read's buckets are days, not empty hours. */
    expect(day.hours).toEqual([]);
    expect(day.days.map((entry) => [entry.localDate, entry.steps, entry.hours])).toEqual([
      ['2026-11-01', 3, []], ['2026-11-02', 4, []],
    ]);
    expect(day.totals).toEqual({ steps: 7, edits: 0, checks: 0, complete: true });
    expect(day.summary).toContain('步骤 7');
    /* Two buckets share local hour 1; the real startAt/endAt keeps them apart. */
    expect(hour.hours.map((entry) => [entry.localDate, entry.localHour, entry.startAt])).toEqual([
      ['2026-11-01', 1, '2026-11-01T05:00:00.000Z'],
      ['2026-11-01', 1, '2026-11-01T06:00:00.000Z'],
    ]);
    expect(new Set(hour.hours.map((entry) => entry.key)).size).toBe(2);
    expect(hour.totals).toEqual({ steps: 3, edits: 0, checks: 0, complete: true });
    expect(hour.summary).toContain('步骤 3');
    /* Totals are the reply's window totals, never day plus hour twice. */
    expect(hour.summary).not.toContain('步骤 10');
    expect(day.summary).not.toContain('步骤 10');
    /* Both reads in one call: the hour page is the chosen granularity, so the
       day page's 7 is never added to the hour page's 3. */
    const both = adaptTaskMapTime([], [FALL_BACK_DAY, FALL_BACK_HOUR], null, []).calendar!;
    expect(both.totals).toEqual({ steps: 3, edits: 0, checks: 0, complete: true });
    expect(both.summary).toContain('步骤 3');
    expect(both.summary).not.toContain('步骤 7');
    expect(both.summary).not.toContain('步骤 10');
  });
});

/** The page freezes Date to the scene's now; poll with the un-faked clock. */
async function poll(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const localDateOf = (iso: string): string => {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

const WORKING = fileURLToPath(new URL('../../src/ui/boards/', import.meta.url));
type Ready<T> = { status: 'ready'; value: T };
const ready = <T,>(reply: unknown): T => (reply as Ready<T>).value;
const goalRead = (): TaskMapGoalRead => ready<TaskMapGoalRead>(scene.reply('goals/read', {}));
const graphRead = (): TaskMapGraphRead => ready<TaskMapGraphRead>(scene.reply('tasks/query', {}));
const displayRead = (): TaskMapDisplayRead => ready<TaskMapDisplayRead>(scene.reply('goals/display', {}));

/** One real calendar bucket shaped like `ActivityCellV1`; `hour: null` is a day. */
function calendarBucket(date: Date, hour: number | null, steps: number, edits: number, checks: number): Record<string, unknown> {
  const start = hour === null
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate())
    : new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour);
  const end = hour === null
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
    : new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour + 1);
  return {
    localDate: localDateOf(start.toISOString()), localHour: hour,
    startAt: start.toISOString(), endAt: end.toISOString(), future: false,
    steps, querySteps: 0, edits, editsUnknown: 0, checks,
    uncountedRuns: 0, inProgressRuns: 0, uncountedQueries: 0, inProgressQueries: 0,
    complete: true, tasks: [], moreTasks: 0, sessions: [], moreSessions: 0,
  };
}

const localDays = (fromIso: string, toIso: string): Date[] => {
  const from = new Date(fromIso); const to = new Date(toIso);
  const days: Date[] = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    d <= new Date(to.getFullYear(), to.getMonth(), to.getDate());
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(d);
  return days;
};

/** Named mutations: make the 全部 summary read only hour cells (a), or drop
 * the picked year day's hour read from boot (b). */
describe('E34-7 the long 全部 calendar reduces the granularity it really has', () => {
  it('E34-7 全部 uses its day cells, and a picked year day appends one hour read and fills the day→hour row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    const calendarInputs: Array<Record<string, unknown>> = [];
    const trackInputs: Array<Record<string, unknown>> = [];
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-7-long',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = (envelope.input ?? envelope) as Record<string, unknown>;
          if (route === 'activity/calendar') calendarInputs.push(input);
          if (route === 'activity/track') trackInputs.push(input);
          if (route === 'executions/list') {
            return new Response(JSON.stringify({ status: 'ready', value: { items: [{
              run: { ref: { aggregateType: 'Run', projectId: 'ple34b', goalId: 'g1', runId: 'e34-7-old' },
                task: { taskId: 'T01' }, startedAt: '2026-09-04T00:00:00+08:00' },
            }], nextCursor: null } }), { status: 200 });
          }
          const reply = scene.reply(route, input) as { value?: { cells?: Array<Record<string, unknown>> } };
          if (route === 'activity/calendar' && input.granularity === 'day' && reply.value?.cells !== undefined) {
            /* The scene's fixture keeps only its three days; the long range's
               day read really spans the 30 days the test asked for. */
            const first = reply.value.cells[0];
            reply.value.cells = [{
              ...first, localDate: '2026-09-04',
              startAt: '2026-09-04T00:00:00+08:00', endAt: '2026-09-05T00:00:00+08:00',
            }, ...reply.value.cells];
          }
          return new Response(JSON.stringify(reply), { status: 200 });
        },
      });
      await poll(() => page!.root.textContent.includes('状态机规格对齐'));
      findButton(page.root, '轨道')!.dispatch('click');
      findButton(page.root, '全部')!.dispatch('click');
      await poll(() => calendarInputs.some((input) => input.granularity === 'day'));
      await poll(() => (findClass(page!.root, 'tl-sum')?.textContent ?? '').includes('步骤 '));
      const summary = findClass(page.root, 'tl-sum')!.textContent;
      /* Hand-computed from the four complete day cells: the 30-day range's
         09-04 copy of the 10-02 cell (254/31/8) plus 10-02 (254/31/8),
         10-03 (234/35/8) and 10-04 (213/34/8). Reading the raw fixture days by
         `st/ed/ck` instead of `wlActs`' `steps/edits/checks` makes this NaN. */
      expect(summary).toContain('步骤 955 · 编辑 131 · 检查 32 次');
      expect(summary).not.toContain('活动未记全');

      const day = findElement(page.root, (element) => {
        const cls = element.getAttribute('class') ?? '';
        const label = element.getAttribute('aria-label') ?? '';
        return element.tagName.toLowerCase() === 'button' && cls.includes('cal-c') && label.startsWith('10-02 ');
      });
      expect(day).toBeDefined();
      day!.dispatch('click');
      await poll(() => calendarInputs.some((input) => input.granularity === 'hour'
        && typeof input.from === 'string' && localDateOf(input.from) === '2026-10-02'));
      const hourReads = calendarInputs.filter((input) => input.granularity === 'hour'
        && typeof input.from === 'string' && localDateOf(input.from) === '2026-10-02');
      expect(hourReads).toHaveLength(1);
      expect(trackInputs.some((input) => typeof input.from === 'string' && localDateOf(input.from) === '2026-10-02')).toBe(true);
      await poll(() => findElement(page!.root, (element) => {
        const cls = element.getAttribute('class') ?? '';
        const label = element.getAttribute('aria-label') ?? '';
        return element.tagName.toLowerCase() === 'button' && cls.includes('cal-c')
          && label.startsWith('2026-10-02|');
      }) !== undefined);
      expect(page.root.textContent).not.toContain('NaN');
      expect(page.root.textContent).not.toContain('undefined');
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);

  it('E34-7 an empty used list at day granularity is not a complete zero', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    const calendarInputs: Array<Record<string, unknown>> = [];
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-7-empty',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = (envelope.input ?? envelope) as Record<string, unknown>;
          if (route === 'activity/calendar') calendarInputs.push(input);
          if (route === 'executions/list') {
            return new Response(JSON.stringify({ status: 'ready', value: { items: [{
              run: { ref: { aggregateType: 'Run', projectId: 'ple34b', goalId: 'g1', runId: 'e34-7-old' },
                task: { taskId: 'T01' }, startedAt: '2026-09-04T00:00:00+08:00' },
            }], nextCursor: null } }), { status: 200 });
          }
          const reply = scene.reply(route, input) as { value?: { cells?: unknown[] } };
          if (route === 'activity/calendar' && input.granularity === 'day' && reply.value !== undefined) {
            reply.value.cells = [];
          }
          return new Response(JSON.stringify(reply), { status: 200 });
        },
      });
      await poll(() => page!.root.textContent.includes('状态机规格对齐'));
      findButton(page.root, '轨道')!.dispatch('click');
      findButton(page.root, '全部')!.dispatch('click');
      await poll(() => calendarInputs.some((input) => input.granularity === 'day'));
      await poll(() => page!.root.textContent.includes('活动未记全'));
      expect(page.root.textContent).toContain('活动未记全');
      expect(page.root.textContent).not.toContain('步骤 0');
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);

  it('E34-7 a 14.5-day full history reads the board\'s long granularity and its summary is a number', async () => {
    /* Named mutation: restore boot's 15-day hour threshold. The board's long
       view starts above 14 days, so the 14.5-day range is read as hours and the
       no-day summary loses every bucket (the numeric assertion sees 活动未记全). */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    const calendarInputs: Array<Record<string, unknown>> = [];
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-7-14',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = (envelope.input ?? envelope) as Record<string, unknown>;
          if (route === 'activity/calendar') calendarInputs.push(input);
          if (route === 'executions/list') {
            /* now (10-04 14:15 +08) minus this origin is 14.5 days. */
            return new Response(JSON.stringify({ status: 'ready', value: { items: [{
              run: { ref: { aggregateType: 'Run', projectId: 'ple34b', goalId: 'g1', runId: 'e34-7-14' },
                task: { taskId: 'T01' }, startedAt: '2026-09-20T00:00:00+08:00' },
            }], nextCursor: null } }), { status: 200 });
          }
          const reply = scene.reply(route, input) as { value?: { cells?: unknown[]; totals?: Record<string, unknown> } };
          const span = typeof input.from === 'string' && typeof input.to === 'string'
            ? Date.parse(input.to) - Date.parse(input.from) : 0;
          if (route === 'activity/calendar' && span > 14 * 86400000 && reply.value !== undefined) {
            /* This range's real read: one complete bucket per local day. */
            const days = localDays(String(input.from), String(input.to));
            const cells = days.map((day, index) => calendarBucket(day,
              input.granularity === 'hour' ? (index === 0 ? 0 : 12) : null, 2, 1, 1));
            reply.value.cells = cells;
            reply.value.totals = { steps: 2 * cells.length, edits: cells.length, checks: cells.length, complete: true };
          }
          return new Response(JSON.stringify(reply), { status: 200 });
        },
      });
      await poll(() => page!.root.textContent.includes('状态机规格对齐'));
      findButton(page.root, '轨道')!.dispatch('click');
      findButton(page.root, '全部')!.dispatch('click');
      await poll(() => calendarInputs.some((input) => typeof input.from === 'string'
        && typeof input.to === 'string' && Date.parse(input.to) - Date.parse(input.from) > 14 * 86400000));
      await poll(() => {
        const text = findClass(page!.root, 'tl-sum')?.textContent ?? '';
        return /步骤 \d/.test(text) || text.includes('活动未记全');
      });
      /* The board's long view starts above 14 days; boot must judge the same
         range the same way, so every read over 14 days is one day read. */
      const longReads = calendarInputs.filter((input) => typeof input.from === 'string'
        && typeof input.to === 'string' && Date.parse(input.to) - Date.parse(input.from) > 14 * 86400000);
      expect(longReads.length).toBeGreaterThan(0);
      expect(longReads.map((input) => input.granularity)).toEqual(longReads.map(() => 'day'));
      const summary = findClass(page.root, 'tl-sum')!.textContent;
      expect(summary).toMatch(/步骤 \d+ · 编辑 \d+ · 检查 \d+ 次/);
      expect(summary).not.toContain('活动未记全');
      expect(page.root.textContent).not.toContain('NaN');
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);

  it('E34-7 a history over 14 days only after quarter rounding reads days, as the board judges it', async () => {
    /* Row A, hand-computed: the origin 09-20 15:15:31 and now 10-04 14:15:30 end
       the range at now + 1h = 10-04 15:15:30, one second short of 14 days. Rounded
       out to quarters the read is 09-20 15:15 to 10-04 15:30, 14 days 15 minutes,
       and that is the span the board sees, because the Host fills the window: the
       first cell starts at `from` and the last ends at `to`. Named mutation: judge
       the unrounded `toMs - fromMs` again; this range is then read as hours. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T14:15:30+08:00'));
    const calendarInputs: Array<Record<string, unknown>> = [];
    const isFullRead = (input: Record<string, unknown>): boolean => typeof input.from === 'string'
      && Date.parse(input.from) < Date.parse('2026-09-21T00:00:00+08:00');
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-7-rounded',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = (envelope.input ?? envelope) as Record<string, unknown>;
          if (route === 'activity/calendar') calendarInputs.push(input);
          if (route === 'executions/list') {
            return new Response(JSON.stringify({ status: 'ready', value: { items: [{
              run: { ref: { aggregateType: 'Run', projectId: 'ple34b', goalId: 'g1', runId: 'e34-7-rounded' },
                task: { taskId: 'T01' }, startedAt: '2026-09-20T15:15:31+08:00' },
            }], nextCursor: null } }), { status: 200 });
          }
          const reply = scene.reply(route, input) as { value?: { cells?: Array<Record<string, unknown>>; totals?: Record<string, unknown> } };
          if (route === 'activity/calendar' && isFullRead(input) && reply.value !== undefined) {
            const cells = localDays(String(input.from), String(input.to)).map((day) =>
              calendarBucket(day, input.granularity === 'hour' ? 12 : null, 2, 1, 1));
            cells[0]!.startAt = input.from;
            cells.at(-1)!.endAt = input.to;
            reply.value.cells = cells;
            reply.value.totals = { steps: 2 * cells.length, edits: cells.length, checks: cells.length, complete: true };
          }
          return new Response(JSON.stringify(reply), { status: 200 });
        },
      });
      await poll(() => page!.root.textContent.includes('状态机规格对齐'));
      findButton(page.root, '轨道')!.dispatch('click');
      findButton(page.root, '全部')!.dispatch('click');
      await poll(() => calendarInputs.some(isFullRead));
      await poll(() => {
        const text = findClass(page!.root, 'tl-sum')?.textContent ?? '';
        return /步骤 \d/.test(text) || text.includes('活动未记全');
      });
      /* 15:15 and 15:30 at +08:00 are 07:15Z and 07:30Z. */
      for (const input of calendarInputs.filter(isFullRead)) {
        expect([input.granularity, input.from, input.to]).toEqual(
          ['day', '2026-09-20T07:15:00.000Z', '2026-10-04T07:30:00.000Z']);
      }
      /* 09-20 to 10-04 is 15 local days of 2 steps, 1 edit and 1 check. */
      const summary = findClass(page.root, 'tl-sum')!.textContent;
      expect(summary).toContain('步骤 30 · 编辑 15 · 检查 15 次');
      expect(summary).not.toContain('活动未记全');
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);

  it('E34-7 a long hour read with no picked day sums its hours instead of filtering them all out', () => {
    /* Named mutation: filter the no-day hours by `localDate === o.day` again;
       `o.day` is null, so every real hour is dropped and the complete range
       reads 活动未记全. */
    const from = new Date(2026, 8, 20);
    const days = localDays(from.toISOString(), new Date(2026, 9, 4, 12).toISOString());
    const cells = days.map((day, index) => calendarBucket(day, index === 0 ? 0 : 12, 1, 2, 3));
    const calendar: TaskMapCalendarRead = {
      goalRef: { goalId: 'g1' }, from: from.toISOString(), to: new Date(2026, 9, 4, 13).toISOString(),
      granularity: 'hour', timeZone: 'Asia/Shanghai', scope: 'goal', cells,
      totals: { steps: 15, edits: 30, checks: 45, complete: true },
    };
    const time = adaptTaskMapTime([{ bars: [], next: null, from: calendar.from, to: calendar.to }], calendar, null, [], scene.now,
      { working: { status: 'exact', value: 0 } });
    const data = adaptTaskMap(goalRead(), graphRead(), displayRead());
    data.time = time;
    const board = loadBoard('TaskMap', WORKING);
    const view = new BoardView(board, { ...board.defaults, data, readState: { status: 'ready' }, dataVersion: 1 });
    view.instance.setState({ view: 'lanes', wlWin: 'all' });
    const vals = view.instance.renderVals() as { wl: { sum: string } };
    expect(vals.wl.sum).toContain('步骤 15 · 编辑 30 · 检查 45 次');
    expect(vals.wl.sum).not.toContain('活动未记全');
  });

  it('E34-7 picking an hour in a past week day keeps the seven calendar rows and the picked cell', async () => {
    /* Row 7: a picked hour only narrows the lanes; the calendar keeps the
       window's week, so the picked 10-02 cell stays there and ringed. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    const cellAt = (root: Parameters<typeof findClass>[0]) => findAllClass(root, 'cal-c')
      .find((element) => (element.getAttribute('aria-label') ?? '').startsWith('2026-10-02 09:00'));
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-7-week-hour',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          return new Response(JSON.stringify(scene.reply(route, envelope.input ?? envelope)), { status: 200 });
        },
      });
      expect(page.root.textContent).toContain('状态机规格对齐');
      findButton(page.root, '轨道')!.dispatch('click');
      await poll(() => findClass(page!.root, 'is-full') !== undefined);
      findButton(page.root, '本周')!.dispatch('click');
      await poll(() => cellAt(page!.root) !== undefined);
      cellAt(page.root)!.dispatch('click');
      await poll(() => (findClass(page!.root, 'tl-sum')?.textContent ?? '').includes('2026-10-02 09:00 这一小时'));
      const cal = findClass(page.root, 'cal')!;
      /* The corner plus one label for each of the week's seven real days. */
      expect(findAllClass(cal, 'cal-d')).toHaveLength(8);
      const picked = cellAt(cal);
      expect(picked).toBeDefined();
      expect(picked!.getAttribute('class')).toContain('is-on');
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);

  it('E34-7 a picked year day and hour leave the year grid origin so earlier days stay selectable', async () => {
    /* Row 8: the year grid starts at the read's earliest real instant, not at
       the drilled-down window; picking 10-02 and then one of its hours must not
       turn 09-04 into an unchosen future cell. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    const calendarInputs: Array<Record<string, unknown>> = [];
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    const cellWith = (label: string) => findAllClass(page!.root, 'cal-c')
      .find((element) => (element.getAttribute('aria-label') ?? '').startsWith(label));
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-7-origin',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = (envelope.input ?? envelope) as Record<string, unknown>;
          if (route === 'activity/calendar') calendarInputs.push(input);
          if (route === 'executions/list') {
            return new Response(JSON.stringify({ status: 'ready', value: { items: [{
              run: { ref: { aggregateType: 'Run', projectId: 'ple34b', goalId: 'g1', runId: 'e34-7-origin' },
                task: { taskId: 'T01' }, startedAt: '2026-09-04T00:00:00+08:00' },
            }], nextCursor: null } }), { status: 200 });
          }
          const reply = scene.reply(route, input) as { value?: { cells?: Array<Record<string, unknown>> } };
          if (route === 'activity/calendar' && input.granularity === 'day' && reply.value?.cells !== undefined) {
            const first = reply.value.cells[0];
            reply.value.cells = [{
              ...first, localDate: '2026-09-04',
              startAt: '2026-09-04T00:00:00+08:00', endAt: '2026-09-05T00:00:00+08:00',
            }, ...reply.value.cells];
          }
          return new Response(JSON.stringify(reply), { status: 200 });
        },
      });
      await poll(() => page!.root.textContent.includes('状态机规格对齐'));
      findButton(page.root, '轨道')!.dispatch('click');
      findButton(page.root, '全部')!.dispatch('click');
      await poll(() => calendarInputs.some((input) => input.granularity === 'day'));
      await poll(() => cellWith('10-02 ') !== undefined);
      cellWith('10-02 ')!.dispatch('click');
      await poll(() => cellWith('2026-10-02|') !== undefined);
      cellWith('2026-10-02|')!.dispatch('click');
      await poll(() => (cellWith('2026-10-02|')?.getAttribute('class') ?? '').includes('is-on'));
      const earlier = cellWith('09-04 ');
      expect(earlier).toBeDefined();
      earlier!.dispatch('click');
      await poll(() => calendarInputs.some((input) => input.granularity === 'hour'
        && typeof input.from === 'string' && localDateOf(input.from) === '2026-09-04'));
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);
});
