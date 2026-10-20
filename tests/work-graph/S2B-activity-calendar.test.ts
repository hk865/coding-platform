/**
 * Slice 2B BE4: `readActivityCalendar` acceptance rows 2B-21…2B-28, 2B-43.
 *
 * Data is built by `S2B-activity-fixture.ts` (real claim/entry/end + the public
 * RunActivity write port). Assertions read only the public
 * `readActivityCalendar`; every expected number is a hand-computed literal.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunActivityFactsV1 } from '../../src/contracts/run-activity.js';
import {
  countedFacts, openS2BActivityFixture, type S2BActivityFixture,
} from '../helpers/S2B-activity-fixture.js';

const opened: S2BActivityFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

async function open(kind: 'memory' | 'sqlite'): Promise<S2BActivityFixture> {
  const fixture = await openS2BActivityFixture(kind);
  opened.push(fixture);
  return fixture;
}

function readyCalendar(result: Awaited<ReturnType<S2BActivityFixture['readCalendar']>>) {
  if (result.status !== 'ready') throw new Error(`calendar read failed: ${JSON.stringify(result)}`);
  return result.value;
}

function cellAt(value: ReturnType<typeof readyCalendar>, localHour: number) {
  const cell = value.cells.find((candidate) => candidate.localHour === localHour);
  if (cell === undefined) throw new Error(`no cell for local hour ${String(localHour)}`);
  return cell;
}

function cellAtDateHour(value: ReturnType<typeof readyCalendar>, localDate: string, localHour: number) {
  const cell = value.cells.find((candidate) => candidate.localDate === localDate && candidate.localHour === localHour);
  if (cell === undefined) throw new Error(`no cell for ${localDate} ${String(localHour)}`);
  return cell;
}

type ReadCounts = { roundIndexRows: number; eventAtCalls: number };

/** Counts the round-index rows and `eventAt` calls one calendar read makes (L9 step 4). */
function countingRecords(base: S2BActivityFixture['records'], counts: ReadCounts): S2BActivityFixture['records'] {
  const wrapped = {
    ...base,
    async lookupOrdered(request: Parameters<S2BActivityFixture['records']['lookupOrdered']>[0]) {
      const page = await base.lookupOrdered(request);
      if (page.status === 'ready' && request.index === 's2b-round-by-goal') {
        counts.roundIndexRows += page.value.records.length;
      }
      return page;
    },
    async eventAt(cursor: Parameters<S2BActivityFixture['records']['eventAt']>[0]) {
      counts.eventAtCalls += 1;
      return base.eventAt(cursor);
    },
  };
  return wrapped as unknown as S2BActivityFixture['records'];
}

describe.each(['memory', 'sqlite'] as const)('S2B activity calendar (%s)', (kind) => {
  it('2B-21 Asia/Shanghai hour cells map UTC quarters to local hours, mark future cells, and total the cells', async () => {
    const f = await open(kind);
    const goalRef = f.goalRef;
    const session = f.b2.base.sessions.second;
    const run = await f.runAndEnd('work-1', session,
      '2026-10-14T02:00:00.000Z', '2026-10-14T04:00:00.000Z');
    await f.ensureRecording('2026-10-15T00:00:00.000Z');
    await f.writeActivity(run, countedFacts({
      turnStartedAt: '2026-10-14T02:00:00.000Z', lastRecordAt: '2026-10-14T02:10:00.000Z',
      quarters: [{ at: '2026-10-14T02:00:00.000Z', steps: 3, edits: 1, editsUnknown: 0 }],
    }));
    f.setClock('2026-10-14T04:10:00.000Z');

    const calendar = readyCalendar(await f.readCalendar({
      goalRef, from: '2026-10-13T16:00:00.000Z', to: '2026-10-14T16:00:00.000Z',
      granularity: 'hour', timeZone: 'Asia/Shanghai',
    }));

    expect(calendar.cells).toHaveLength(24);
    const ten = cellAt(calendar, 10);
    expect(ten).toMatchObject({
      localDate: '2026-10-14', localHour: 10,
      startAt: '2026-10-14T02:00:00.000Z', endAt: '2026-10-14T03:00:00.000Z',
      future: false, steps: 3, edits: 1, editsUnknown: 0, checks: 0,
      uncountedRuns: 0, inProgressRuns: 0, complete: true,
    });
    // 13:00 local starts at 05:00Z, after the 04:10Z "now".
    expect(cellAt(calendar, 13).future).toBe(true);
    expect(calendar.totals).toEqual({ steps: 3, edits: 1, editsUnknown: 0, checks: 0, complete: true });
    expect(calendar.coverage).toMatchObject({
      runsCounted: 1, runsRecordedLate: 0, runsNotEntered: 0, runsInProgress: 0,
      runsUncounted: [], runsUnplaced: 0, checksUnplaced: 0,
      runsSessionUnknown: null, checksGateUnplaced: null,
    });
    expect(calendar.recordingSince).toBe('2026-10-15T00:00:00.000Z');
    expect(calendar.checksAttribution).toBe('round_start');
  });

  it('2B-22 half-hour and DST offsets map to local cells and day granularity groups by local date', async () => {
    const f = await open(kind);
    const goalRef = f.goalRef;
    const session = f.b2.base.sessions.second;
    await f.ensureRecording('2026-12-01T00:00:00.000Z');

    // One real Run carries all four quarters (the read windows are disjoint).
    // Asia/Kolkata (+5:30): 10:20Z -> quarter 10:15 -> local 15; 10:40Z -> quarter 10:30 -> local 16.
    const run = await f.runAndEnd('work-1', session, '2026-10-14T10:00:00.000Z', '2026-11-01T07:00:00.000Z');
    await f.writeActivity(run, countedFacts({
      turnStartedAt: '2026-10-14T10:00:00.000Z', lastRecordAt: '2026-11-01T06:45:00.000Z',
      quarters: [
        { at: '2026-10-14T10:15:00.000Z', steps: 1, edits: 0, editsUnknown: 0 },
        { at: '2026-10-14T10:30:00.000Z', steps: 1, edits: 0, editsUnknown: 0 },
        { at: '2026-11-01T05:30:00.000Z', steps: 1, edits: 0, editsUnknown: 0 },
        { at: '2026-11-01T06:30:00.000Z', steps: 1, edits: 0, editsUnknown: 0 },
      ],
    }));

    f.setClock('2026-10-15T01:00:00.000Z');
    const kolkata = readyCalendar(await f.readCalendar({
      goalRef, from: '2026-10-14T00:00:00.000Z', to: '2026-10-15T00:00:00.000Z',
      granularity: 'hour', timeZone: 'Asia/Kolkata',
    }));
    expect(cellAtDateHour(kolkata, '2026-10-14', 15)).toMatchObject({ steps: 1, localHour: 15 });
    expect(cellAtDateHour(kolkata, '2026-10-14', 16)).toMatchObject({ steps: 1, localHour: 16 });

    // America/New_York DST ends 2026-11-01: 05:30Z (01:30 EDT) and 06:30Z (01:30 EST) share local hour 1.
    f.setClock('2026-11-02T06:00:00.000Z');
    const localDayFrom = '2026-11-01T04:00:00.000Z';
    const localDayTo = '2026-11-02T05:00:00.000Z';
    const newYork = readyCalendar(await f.readCalendar({
      goalRef, from: localDayFrom, to: localDayTo, granularity: 'hour', timeZone: 'America/New_York',
    }));
    expect(newYork.cells).toHaveLength(24);
    expect(cellAtDateHour(newYork, '2026-11-01', 1)).toMatchObject({
      steps: 2, startAt: '2026-11-01T05:00:00.000Z', endAt: '2026-11-01T07:00:00.000Z',
    });

    const byDay = readyCalendar(await f.readCalendar({
      goalRef, from: localDayFrom, to: localDayTo, granularity: 'day', timeZone: 'America/New_York',
    }));
    expect(byDay.cells).toHaveLength(1);
    expect(byDay.cells[0]).toMatchObject({ localDate: '2026-11-01', localHour: null, steps: 2 });
    expect(byDay.totals.steps).toBe(2);
  });

  it('2B-23 a counted empty Run reads 0 and complete while unknown, in-progress and not_backfilled stay separate', async () => {
    const f = await open(kind);
    const goalRef = f.goalRef;
    const session = f.b2.base.sessions.second;
    
    // Recording starts after every Run below, so none of the records is "late".
    await f.ensureRecording('2026-10-15T00:00:00.000Z');

    const countedEmpty = await f.runAndEnd('work-1', session, '2026-10-14T09:30:00.000Z', '2026-10-14T09:45:00.000Z');
    await f.writeActivity(countedEmpty, countedFacts({
      turnStartedAt: '2026-10-14T09:30:00.000Z', lastRecordAt: '2026-10-14T09:45:00.000Z', quarters: [],
    }));

    const unknownRun = await f.runAndEnd('work-2', session, '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    await f.writeActivity(unknownRun, { status: 'unknown', ruleVersion: 1,
      reason: 'history_read_failed', detail: 'the S2B fixture injects an unknown tally' });

    // Ended before `since`, with no record: not_backfilled.
    await f.runAndEnd('work-3', session, '2026-10-14T11:00:00.000Z', '2026-10-14T11:30:00.000Z');

    await f.runOpen('work-4', session, '2026-10-14T12:00:00.000Z');
    f.setClock('2026-10-14T13:30:00.000Z');

    const calendar = readyCalendar(await f.readCalendar({
      goalRef, from: '2026-10-14T09:00:00.000Z', to: '2026-10-14T15:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC',
    }));

    expect(cellAt(calendar, 9)).toMatchObject({ steps: 0, edits: 0, editsUnknown: 0, uncountedRuns: 0, complete: true });
    expect(cellAt(calendar, 10)).toMatchObject({ uncountedRuns: 1, inProgressRuns: 0, complete: false });
    expect(cellAt(calendar, 11)).toMatchObject({ uncountedRuns: 1, inProgressRuns: 0, complete: false });
    expect(cellAt(calendar, 12)).toMatchObject({ uncountedRuns: 0, inProgressRuns: 1, complete: false });
    expect(cellAt(calendar, 13)).toMatchObject({ uncountedRuns: 0, inProgressRuns: 1, complete: false });
    expect(calendar.totals).toMatchObject({ steps: 0, edits: 0, editsUnknown: 0, checks: 0, complete: false });
    expect(calendar.coverage).toMatchObject({
      runsCounted: 1, runsRecordedLate: 0, runsNotEntered: 0, runsInProgress: 1,
      runsUncounted: [
        { reason: 'history_read_failed', count: 1 },
        { reason: 'not_backfilled', count: 1 },
      ],
      runsUnplaced: 0, checksUnplaced: 0,
    });
  });

  it('2B-25 rejects every malformed calendar input with invalid before any read', async () => {
    const f = await open(kind);
    const goalRef = f.goalRef;
    const base = { goalRef, granularity: 'hour' as const, timeZone: 'UTC' };
    const sessionRefs34 = Array.from({ length: 34 }, (_value, index) => ({
      projectId: f.b2.base.scope.projectId, sessionId: `session-${String(index)}`,
    }));

    const cases: { name: string; input: Parameters<S2BActivityFixture['readCalendar']>[0] }[] = [
      { name: 'hour span 16 days', input: { ...base, from: '2026-10-01T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' } },
      { name: 'day span 401 days', input: { ...base, granularity: 'day', from: '2026-01-01T00:00:00.000Z', to: '2027-02-06T00:00:00.000Z' } },
      { name: 'from is not UTC Z', input: { ...base, from: '2026-10-14T10:00:00+08:00', to: '2026-10-14T11:00:00.000Z' } },
      { name: 'from is not on a quarter', input: { ...base, from: '2026-10-14T10:10:00.000Z', to: '2026-10-14T11:00:00.000Z' } },
      { name: 'to carries seconds', input: { ...base, from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T11:00:30.000Z' } },
      { name: 'from equals to', input: { ...base, from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T10:00:00.000Z' } },
      { name: 'unknown time zone', input: { ...base, timeZone: 'Not/AZone', from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T11:00:00.000Z' } },
      { name: '34 session refs', input: { ...base, sessionRefs: sessionRefs34, from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T11:00:00.000Z' } },
    ];
    for (const { name, input } of cases) {
      const result = await f.readCalendar(input);
      expect(result, name).toMatchObject({ status: 'rejected', code: 'invalid' });
    }
  });

  it('2B-24 attributes begun checks to the round start hour and its task', async () => {
    const f = await open(kind);
    const goalRef = f.goalRef;
    const session = f.b2.base.sessions.second;
    await f.ensureRecording('2026-10-14T00:00:00.000Z');

    const runA = await f.runAndEnd('work-1', session, '2026-10-14T09:50:00.000Z', '2026-10-14T10:00:00.000Z');
    await f.writeActivity(runA, countedFacts({ turnStartedAt: '2026-10-14T09:50:00.000Z',
      lastRecordAt: '2026-10-14T10:00:00.000Z', quarters: [] }));
    f.setClock('2026-10-14T10:05:00.000Z');
    const roundA = await f.openRound(runA, 'work-1');
    await f.beginChecks(roundA, 3);

    const runB = await f.runAndEnd('work-2', session, '2026-10-14T10:50:00.000Z', '2026-10-14T11:00:00.000Z');
    await f.writeActivity(runB, countedFacts({ turnStartedAt: '2026-10-14T10:50:00.000Z',
      lastRecordAt: '2026-10-14T11:00:00.000Z', quarters: [] }));
    f.setClock('2026-10-14T11:10:00.000Z');
    const roundB = await f.openRound(runB, 'work-2');
    await f.beginChecks(roundB, 2);

    f.setClock('2026-10-14T13:00:00.000Z');
    const calendar = readyCalendar(await f.readCalendar({
      goalRef, from: '2026-10-14T00:00:00.000Z', to: '2026-10-14T18:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC',
    }));

    expect(cellAt(calendar, 10)).toMatchObject({
      checks: 3, uncountedRuns: 0, inProgressRuns: 0, complete: true,
      tasks: [{ taskId: 'work-1', steps: 0, edits: 0, checks: 3 }], moreTasks: 0,
    });
    expect(cellAt(calendar, 11)).toMatchObject({
      checks: 2, uncountedRuns: 0, inProgressRuns: 0, complete: true,
      tasks: [{ taskId: 'work-2', steps: 0, edits: 0, checks: 2 }], moreTasks: 0,
    });
    expect(calendar.coverage).toMatchObject({ checksUnplaced: 0 });
    expect(calendar.checksAttribution).toBe('round_start');
  });

  it('L9 step 4 reads rounds by since descending and stops before rounds older than from - 1h', async () => {
    const f = await open(kind);
    const goalRef = f.goalRef;
    const session = f.b2.base.sessions.second;
    await f.ensureRecording('2026-10-14T00:00:00.000Z');

    // Five real rounds opened oldest first, so their `since` cursors ascend with
    // the clock. 10:30 and 10:05 are in [10:00, 11:00); 08:00 is the first one
    // older than from - 1h (09:00); 07:00 and 06:00 must never be read.
    const tasks = ['work-1', 'work-2', 'work-3', 'work-4', 'work-5'];
    const opens = ['2026-10-14T06:00:00.000Z', '2026-10-14T07:00:00.000Z', '2026-10-14T08:00:00.000Z',
      '2026-10-14T10:05:00.000Z', '2026-10-14T10:30:00.000Z'];
    for (let index = 0; index < opens.length; index += 1) {
      const at = opens[index]!;
      const start = new Date(Date.parse(at) - 10 * 60 * 1000).toISOString();
      const run = await f.runAndEnd(tasks[index]!, session, start, at);
      // A counted record keeps the subject Run out of L9 step 2's uncounted bucket.
      await f.writeActivity(run, countedFacts({ turnStartedAt: start, lastRecordAt: at, quarters: [] }));
      f.setClock(at);
      const round = await f.openRound(run, tasks[index]!);
      await f.beginChecks(round, 1);
    }
    f.setClock('2026-10-14T10:45:00.000Z');

    const counts: ReadCounts = { roundIndexRows: 0, eventAtCalls: 0 };
    const calendar = readyCalendar(await f.readModelWith(countingRecords(f.records, counts)).readActivityCalendar(f.ctx, {
      goalRef, from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T11:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC',
    }));

    // 10:30, 10:05 and the stopping 08:00 were read; 07:00 and 06:00 were not
    // read at all, so they never count against the read cap.
    expect(counts.roundIndexRows).toBe(3);
    expect(counts.eventAtCalls).toBe(3);
    // The two in-window rounds' begun checks land in the 10:00 cell.
    expect(cellAt(calendar, 10)).toMatchObject({ checks: 2, uncountedRuns: 0, complete: true });
  });

  it('2B-28 keeps the activity of an archived line in the calendar', async () => {
    const f = await open(kind);
    const goalRef = f.goalRef;
    const session = await f.b2.base.createSession('s2b-archived-line');
    await f.ensureRecording('2026-10-14T00:00:00.000Z');

    const run = await f.runAndEnd('work-1', session, '2026-10-14T09:50:00.000Z', '2026-10-14T10:00:00.000Z');
    await f.writeActivity(run, countedFacts({
      turnStartedAt: '2026-10-14T09:50:00.000Z', lastRecordAt: '2026-10-14T10:00:00.000Z',
      quarters: [{ at: '2026-10-14T10:00:00.000Z', steps: 4, edits: 1, editsUnknown: 0 }],
    }));
    await f.archiveSession(session);
    f.setClock('2026-10-14T10:30:00.000Z');

    // The line is archived, but the activity really happened and stays counted.
    const calendar = readyCalendar(await f.readCalendar({
      goalRef, from: '2026-10-14T09:00:00.000Z', to: '2026-10-14T11:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC',
    }));
    expect(cellAt(calendar, 10)).toMatchObject({ steps: 4, edits: 1, editsUnknown: 0, complete: true });
    expect(calendar.coverage).toMatchObject({ runsCounted: 1, runsUnplaced: 0 });

    // Filtering to the archived line's Session still returns its activity.
    const filtered = readyCalendar(await f.readCalendar({
      goalRef, from: '2026-10-14T09:00:00.000Z', to: '2026-10-14T11:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC', sessionRefs: [session],
    }));
    expect(cellAt(filtered, 10)).toMatchObject({ steps: 4, edits: 1, complete: true });
    expect(filtered.coverage).toMatchObject({ runsCounted: 1, runsSessionUnknown: 0 });
  });

  it('2B-43 adjacent quarter windows partition one local hour without loss or duplication', async () => {
    const f = await open(kind);
    const goalRef = f.goalRef;
    const session = f.b2.base.sessions.second;
    await f.ensureRecording('2026-10-16T00:00:00.000Z');
    const run = await f.runAndEnd('work-1', session, '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    // Calls at 10:01, 10:14, 10:16, 10:29: quarters 10:00 (2) and 10:15 (2).
    await f.writeActivity(run, countedFacts({
      turnStartedAt: '2026-10-14T10:00:00.000Z', lastRecordAt: '2026-10-14T10:30:00.000Z',
      quarters: [
        { at: '2026-10-14T10:00:00.000Z', steps: 2, edits: 0, editsUnknown: 0 },
        { at: '2026-10-14T10:15:00.000Z', steps: 2, edits: 0, editsUnknown: 0 },
      ],
    }));
    f.setClock('2026-10-14T11:00:00.000Z');

    const first = readyCalendar(await f.readCalendar({
      goalRef, from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T10:15:00.000Z', granularity: 'hour', timeZone: 'UTC',
    }));
    const second = readyCalendar(await f.readCalendar({
      goalRef, from: '2026-10-14T10:15:00.000Z', to: '2026-10-14T10:30:00.000Z', granularity: 'hour', timeZone: 'UTC',
    }));
    const whole = readyCalendar(await f.readCalendar({
      goalRef, from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T10:30:00.000Z', granularity: 'hour', timeZone: 'UTC',
    }));
    expect(first.cells).toHaveLength(1);
    expect(first.cells[0]).toMatchObject({ startAt: '2026-10-14T10:00:00.000Z', endAt: '2026-10-14T10:15:00.000Z', steps: 2 });
    expect(second.cells).toHaveLength(1);
    expect(second.cells[0]).toMatchObject({ startAt: '2026-10-14T10:15:00.000Z', endAt: '2026-10-14T10:30:00.000Z', steps: 2 });
    expect(whole.cells).toHaveLength(1);
    expect(whole.cells[0]).toMatchObject({ startAt: '2026-10-14T10:00:00.000Z', endAt: '2026-10-14T10:30:00.000Z', steps: 4 });
    expect(whole.totals.steps).toBe(first.totals.steps + second.totals.steps);

    // Asia/Kolkata (+5:30): the two windows are local 15:30-15:45 and 15:45-16:00.
    const kolkataA = readyCalendar(await f.readCalendar({
      goalRef, from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T10:15:00.000Z', granularity: 'hour', timeZone: 'Asia/Kolkata',
    }));
    const kolkataB = readyCalendar(await f.readCalendar({
      goalRef, from: '2026-10-14T10:15:00.000Z', to: '2026-10-14T10:30:00.000Z', granularity: 'hour', timeZone: 'Asia/Kolkata',
    }));
    expect(kolkataA.totals.steps + kolkataB.totals.steps).toBe(4);
  });
});
