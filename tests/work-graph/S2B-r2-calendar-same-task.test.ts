/**
 * Slice 2B round-2 R12 row 2B-24: the SAME task is rechecked through the public
 * `reverifyRound` after its subject Run's round was finalized FAIL, and the
 * calendar attributes both rounds' begun checks to their real start hours.
 *
 * Data: `S2B-r2-calendar-reverify-support.ts` over the accepted
 * `S2B-activity-fixture` (real Goal/Plan/Session claim + real `ExecutionEntryPort`
 * end, the real evidence owner for open/begin/record/finalize/reverify, the
 * public `RunActivity` write port). Assertions read only `readActivityCalendar`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ActivityCalendarV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import {
  openCalendarReverifyFixture, type CalendarReverifyFixture,
} from '../helpers/S2B-r2-calendar-reverify-support.js';
import { countedFacts } from '../helpers/S2B-activity-fixture.js';

const opened: CalendarReverifyFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.f.close(); });

async function open(kind: 'memory' | 'sqlite'): Promise<CalendarReverifyFixture> {
  const fixture = await openCalendarReverifyFixture(kind);
  opened.push(fixture);
  return fixture;
}

function cellAt(value: ActivityCalendarV1, hour: number) {
  const cell = value.cells.find((candidate) => candidate.localHour === hour);
  if (cell === undefined) throw new Error(`no cell for local hour ${String(hour)}`);
  return cell;
}

describe.each(['memory', 'sqlite'] as const)('S2B round-2 same-task reverify calendar (%s)', (kind) => {
  it('2B-24 attributes the FAIL round and its same-task successor round to their own start hours', async () => {
    const fixture = await open(kind);
    const f = fixture.f;
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const session = f.b2.base.sessions.second;
    const runA = await f.runAndEnd('work-1', session, '2026-10-14T09:50:00.000Z', '2026-10-14T10:00:00.000Z');
    await f.writeActivity(runA, countedFacts({ turnStartedAt: '2026-10-14T09:50:00.000Z',
      lastRecordAt: '2026-10-14T10:00:00.000Z', quarters: [] }));

    // Round 1 opens at 10:05 on work-1's subject Run; 3 checks begin and all fail.
    f.setClock('2026-10-14T10:05:00.000Z');
    let round = await fixture.openRound(runA, 'work-1');
    for (const checkId of ['check-1', 'check-2', 'check-3']) {
      const ticket = await fixture.begin(round, checkId);
      round = await fixture.recordFail(round, ticket);
    }
    const failed = await fixture.finalize(round);
    expect(failed).toMatchObject({ status: 'finalized', outcome: 'FAIL' });

    // The SAME task's subject Run is rechecked through the public reverify at 11:10; 2 checks begin.
    f.setClock('2026-10-14T11:10:00.000Z');
    const successor = await fixture.reverify(failed, 's2b-r2-calendar-reverify-same-task');
    expect(successor).toMatchObject({ status: 'open', outcome: null, subjectRunRef: runA,
      subject: { taskId: 'work-1' } });
    let rechecked = successor;
    for (const checkId of ['check-1', 'check-2']) {
      await fixture.begin(rechecked, checkId);
      const read = await fixture.evidence.readVerification(f.ctx, rechecked.ref);
      if (read.status !== 'ready') throw new Error(`the successor round read failed: ${JSON.stringify(read)}`);
      rechecked = read.value;
    }

    f.setClock('2026-10-14T13:00:00.000Z');
    const read = await f.readCalendar({ goalRef: f.goalRef, from: '2026-10-14T00:00:00.000Z',
      to: '2026-10-14T18:00:00.000Z', granularity: 'hour', timeZone: 'UTC' });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const calendar = read.value;

    // Round 1: 3 begun checks at its 10:00 start hour, on work-1.
    expect(cellAt(calendar, 10)).toMatchObject({
      checks: 3, uncountedRuns: 0, complete: true,
      tasks: [{ taskId: 'work-1', steps: 0, edits: 0, checks: 3 }], moreTasks: 0,
    });
    // The same-task reviser round: 2 begun checks at its 11:00 start hour.
    expect(cellAt(calendar, 11)).toMatchObject({
      checks: 2, uncountedRuns: 0, complete: true,
      tasks: [{ taskId: 'work-1', steps: 0, edits: 0, checks: 2 }], moreTasks: 0,
    });
    expect(calendar.coverage.checksUnplaced).toBe(0);
    expect(calendar.checksAttribution).toBe('round_start');
  }, 120_000);
});
