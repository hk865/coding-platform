/**
 * Slice 2B round-2 R8: L9 step 2 skips every Run that has an activity record
 * (the ordered step's set is not authoritative), and `markRun` treats an
 * inclusive span as a closed interval, so a span ending exactly on a quarter
 * boundary marks the boundary cell.
 */
import { afterEach, describe, expect, it } from 'vitest';
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

const HOUR = { granularity: 'hour' as const, timeZone: 'UTC' };

describe.each(['memory', 'sqlite'] as const)('S2B round-2 calendar boundaries (%s)', (kind) => {
  it('R8 step 2 skips a Run whose record span ended before from and does not double count', async () => {
    const f = await open(kind);
    const session = f.b2.base.sessions.second;
    await f.ensureRecording('2026-10-14T00:00:00.000Z');

    // This Run ends inside the window, but its activity record's span ended at
    // 09:30, before `from` = 10:00: step 1 never reads it.
    const outside = await f.runAndEnd('work-1', session,
      '2026-10-14T10:20:00.000Z', '2026-10-14T10:30:00.000Z');
    await f.writeActivity(outside, countedFacts({
      turnStartedAt: '2026-10-14T09:00:00.000Z', lastRecordAt: '2026-10-14T09:30:00.000Z',
      quarters: [{ at: '2026-10-14T09:00:00.000Z', steps: 5, edits: 0, editsUnknown: 0 }],
    }));

    // This Run's record is inside the window and is read by step 1.
    const inside = await f.runAndEnd('work-2', session,
      '2026-10-14T10:40:00.000Z', '2026-10-14T10:50:00.000Z');
    await f.writeActivity(inside, countedFacts({
      turnStartedAt: '2026-10-14T10:40:00.000Z', lastRecordAt: '2026-10-14T10:45:00.000Z',
      quarters: [{ at: '2026-10-14T10:45:00.000Z', steps: 3, edits: 1, editsUnknown: 0 }],
    }));
    f.setClock('2026-10-14T11:30:00.000Z');

    const calendar = readyCalendar(await f.readCalendar({
      goalRef: f.goalRef, from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T11:00:00.000Z', ...HOUR,
    }));

    // Only the in-window record counts: the outside Run is skipped entirely and
    // the in-window Run is not counted twice.
    expect(calendar.coverage.runsCounted).toBe(1);
    expect(calendar.coverage.runsUncounted).toEqual([]);
    expect(calendar.totals).toEqual({
      steps: 3, querySteps: 0, edits: 1, editsUnknown: 0, checks: 0, complete: true,
    });
    expect(cellAt(calendar, 10).uncountedRuns).toBe(0);
  });

  it('R8 an unknown span ending exactly on an hour boundary marks the boundary cell', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    // The unknown span is the Run's platform interval [10:00, 11:00]: it starts
    // exactly at `from` and ends exactly on the 11:00 hour boundary.
    const run = await f.runAndEnd('work-1', f.b2.base.sessions.second,
      '2026-10-14T10:00:00.000Z', '2026-10-14T11:00:00.000Z');
    await f.writeActivity(run, { status: 'unknown', ruleVersion: 1,
      reason: 'history_read_failed', detail: 'S2B round-2 closed span' });
    f.setClock('2026-10-14T12:00:00.000Z');

    const calendar = readyCalendar(await f.readCalendar({
      goalRef: f.goalRef, from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T12:00:00.000Z', ...HOUR,
    }));

    expect(cellAt(calendar, 10).uncountedRuns).toBe(1);
    expect(cellAt(calendar, 11).uncountedRuns).toBe(1);
  });

  it('R8 an unknown span ending exactly on `from` marks that first cell', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    // The unknown span is the missing-record Run's platform interval
    // [09:00, 10:00]: its closed endpoint lies exactly on `from` = 10:00, so
    // the 10:00 cell must be marked even though clamping gives `hi === lo`.
    await f.runAndEnd('work-1', f.b2.base.sessions.second,
      '2026-10-14T09:00:00.000Z', '2026-10-14T10:00:00.000Z');
    f.setClock('2026-10-14T12:00:00.000Z');

    const calendar = readyCalendar(await f.readCalendar({
      goalRef: f.goalRef, from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T11:00:00.000Z', ...HOUR,
    }));

    expect(cellAt(calendar, 10).uncountedRuns).toBe(1);
    expect(calendar.coverage.runsUncounted).toEqual([{ reason: 'not_recorded', count: 1 }]);
  });
});
