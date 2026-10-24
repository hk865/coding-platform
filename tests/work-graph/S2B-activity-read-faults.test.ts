/**
 * Slice 2B BE4: `readActivityCalendar`/`readRunActivities` fault rules — row 2B-27.
 *
 * The records port is wrapped at the RecordStore boundary (no product file is
 * touched). Assertions read only the public read ports: a failing read is a
 * rejection, never an empty calendar or a 0; a moving window retries four times
 * and then reports `unavailable`; an injected read cap reports `capacity`.
 *
 * `readTrackBars`/`readTaskStateTimeline` failures belong to the track and
 * timeline factories (other groups) and are not asserted here.
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

type Records = S2BActivityFixture['records'];
const UNAVAILABLE = { status: 'rejected', code: 'unavailable', reason: 'injected RecordStore failure' } as const;

/** Wraps the real records port with one injected failure or a watermark script. */
function faultyRecords(base: Records, options: {
  failIndex?: string; failKeyedRecord?: boolean; failEventAt?: boolean; watermark?: 'advance-once' | 'always';
}): Records {
  let emptyReads = 0;
  const wrapped = {
    ...base,
    async readMany(refKeys: readonly string[]) {
      if (refKeys.length === 0 && options.watermark !== undefined) {
        emptyReads += 1;
        const moved = options.watermark === 'always' || emptyReads === 1 || emptyReads === 2;
        const seq = options.watermark === 'always' ? emptyReads : (moved ? emptyReads : 3);
        return { status: 'ready' as const, value: { records: [], missing: [],
          readThrough: `c${String(seq).padStart(6, '0')}` } };
      }
      if (options.failKeyedRecord && refKeys.length > 0) return UNAVAILABLE;
      return base.readMany(refKeys);
    },
    async eventAt(cursor: Parameters<Records['eventAt']>[0]) {
      if (options.failEventAt) return UNAVAILABLE;
      return base.eventAt(cursor);
    },
    async lookupOrdered(request: Parameters<Records['lookupOrdered']>[0]) {
      if (options.failIndex !== undefined && request.index === options.failIndex) return UNAVAILABLE;
      return base.lookupOrdered(request);
    },
  };
  return wrapped as unknown as Records;
}

function readyCalendar(result: Awaited<ReturnType<ReturnType<S2BActivityFixture['readModelWith']>['readActivityCalendar']>>) {
  if (result.status !== 'ready') throw new Error(`calendar read failed: ${JSON.stringify(result)}`);
  return result.value;
}

describe.each(['memory', 'sqlite'] as const)('S2B activity read faults (%s)', (kind) => {
  it('2B-27 fails the whole read on an injected index, record or eventAt failure', async () => {
    const f = await open(kind);
    const goalRef = f.goalRef;
    const session = f.b2.base.sessions.second;
    await f.ensureRecording('2026-10-15T00:00:00.000Z');
    const run = await f.runAndEnd('work-1', session, '2026-10-14T02:00:00.000Z', '2026-10-14T03:00:00.000Z');
    await f.writeActivity(run, countedFacts({
      turnStartedAt: '2026-10-14T02:00:00.000Z', lastRecordAt: '2026-10-14T02:10:00.000Z',
      quarters: [{ at: '2026-10-14T02:00:00.000Z', steps: 1, edits: 0, editsUnknown: 0 }],
    }));
    f.setClock('2026-10-14T04:00:00.000Z');
    const input = { scope: { kind: 'goal' as const, goalRef }, from: '2026-10-13T16:00:00.000Z', to: '2026-10-14T16:00:00.000Z',
      granularity: 'hour' as const, timeZone: 'UTC' };

    const indexResult = await f.readModelWith(faultyRecords(f.records, { failIndex: 's2b-run-activity-by-goal-last' }))
      .readActivityCalendar(f.ctx, input);
    expect(indexResult).toMatchObject({ status: 'rejected', code: 'unavailable' });

    const recordResult = await f.readModelWith(faultyRecords(f.records, { failKeyedRecord: true }))
      .readActivityCalendar(f.ctx, input);
    expect(recordResult).toMatchObject({ status: 'rejected', code: 'unavailable' });

    // A real round with its `since` cursor makes the calendar call `eventAt`;
    // that single read failing must fail the whole read, not drop the checks.
    f.setClock('2026-10-14T04:05:00.000Z');
    const round = await f.beginChecks(await f.openRound(run, 'work-1'), 1);
    const eventAtResult = await f.readModelWith(faultyRecords(f.records, { failEventAt: true }))
      .readActivityCalendar(f.ctx, input);
    expect(eventAtResult).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(round.checks.some((check) => check.invocationId !== null)).toBe(true);

    const runReadResult = await f.readModelWith(faultyRecords(f.records, { failKeyedRecord: true }))
      .readRunActivities(f.ctx, { runRefs: [run] });
    expect(runReadResult).toMatchObject({ status: 'rejected', code: 'unavailable' });
  });

  it('2B-27 retries one moved window and reports unavailable when the window never settles', async () => {
    const f = await open(kind);
    const goalRef = f.goalRef;
    const session = f.b2.base.sessions.second;
    await f.ensureRecording('2026-10-15T00:00:00.000Z');
    const run = await f.runAndEnd('work-1', session, '2026-10-14T02:00:00.000Z', '2026-10-14T03:00:00.000Z');
    await f.writeActivity(run, countedFacts({
      turnStartedAt: '2026-10-14T02:00:00.000Z', lastRecordAt: '2026-10-14T02:10:00.000Z',
      quarters: [{ at: '2026-10-14T02:00:00.000Z', steps: 3, edits: 1, editsUnknown: 0 }],
    }));
    f.setClock('2026-10-14T04:10:00.000Z');
    const input = { scope: { kind: 'goal' as const, goalRef }, from: '2026-10-13T16:00:00.000Z', to: '2026-10-14T16:00:00.000Z',
      granularity: 'hour' as const, timeZone: 'Asia/Shanghai' };

    const movedOnce = readyCalendar(await f.readModelWith(faultyRecords(f.records, { watermark: 'advance-once' }))
      .readActivityCalendar(f.ctx, input));
    expect(movedOnce.totals).toEqual({
      steps: 3, querySteps: 0, edits: 1, editsUnknown: 0, checks: 0, complete: true,
    });

    const never = await f.readModelWith(faultyRecords(f.records, { watermark: 'always' }))
      .readActivityCalendar(f.ctx, input);
    expect(never).toMatchObject({ status: 'rejected', code: 'unavailable' });
  });

  it('2B-27 reports capacity with the window and cap in the reason instead of truncating', async () => {
    const f = await open(kind);
    const goalRef = f.goalRef;
    const session = f.b2.base.sessions.second;
    await f.ensureRecording('2026-10-15T00:00:00.000Z');
    for (const [index, taskId] of ['work-1', 'work-2', 'work-3', 'work-4', 'work-5', 'work-6'].entries()) {
      const run = await f.runAndEnd(taskId, session, `2026-10-14T0${String(index + 2)}:00:00.000Z`,
        `2026-10-14T0${String(index + 2)}:30:00.000Z`);
      await f.writeActivity(run, countedFacts({
        turnStartedAt: `2026-10-14T0${String(index + 2)}:00:00.000Z`,
        lastRecordAt: `2026-10-14T0${String(index + 2)}:30:00.000Z`,
        quarters: [{ at: `2026-10-14T0${String(index + 2)}:00:00.000Z`, steps: 1, edits: 0, editsUnknown: 0 }],
      }));
    }
    f.setClock('2026-10-14T09:00:00.000Z');

    const result = await f.readCalendar({
      goalRef, from: '2026-10-13T16:00:00.000Z', to: '2026-10-14T16:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC',
    }, { readRecordCap: 10 });
    expect(result).toMatchObject({ status: 'rejected', code: 'capacity' });
    if (result.status === 'rejected') {
      expect(result.reason).toContain('2026-10-13T16:00:00.000Z..2026-10-14T16:00:00.000Z');
      expect(result.reason).toContain('10');
    }
  });
});
