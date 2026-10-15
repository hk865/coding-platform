/**
 * Round-2 R12 row 2B-27: the moving-window (2A L7 / L17) cases for the track
 * and timeline readers. The round-1 fault test (`S2B-activity-read-faults.test.ts`)
 * exercises the calendar moving window; this file adds the two readers it
 * explicitly left to the track and timeline factories.
 *
 * The records port is wrapped at the RecordStore boundary: `readMany([])` (the
 * reader's ledger watermark) is scripted. With `always` it advances on every
 * call, so every read of the window is interrupted by a ledger commit; L17 says
 * the read is retried at most four times (including the first) and then reports
 * `unavailable`; the assertion counts those attempts. With `advance-once` the
 * watermark moves between the first attempt's two reads and then holds, so the
 * second attempt settles and returns the hand-computed bars/segments. No product
 * file is touched and nothing is read from the store to verify: the only
 * observable is the public read result.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { countedFacts } from '../helpers/S2B-activity-fixture.js';
import { openS2BTimelineFixture, type S2BTimelineFixture } from '../helpers/S2B-task-timeline-fixture.js';
import { openS2BTrackFixture, type S2BTrackFixture } from '../helpers/S2B-track-fixture.js';

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

/** L17's attempt cap in this reader is four (spec §0.3 L17). */
const WINDOW_MAX_ATTEMPTS = 4;

type Mover = { count: number };
type WatermarkMode = 'always' | 'advance-once';

/**
 * The synthetic ledger watermark for the next empty read. `always` moves on
 * every read. `advance-once` moves on the first two reads (`c1` -> `c2`) and
 * then holds at `c3` — the same script as the round-1 activity fault test — so
 * the first window attempt is interrupted and the second settles.
 */
function watermarkAt(mover: Mover, mode: WatermarkMode): string {
  const seq = mode === 'advance-once' ? Math.min(mover.count, 3) : mover.count;
  return `c${String(seq).padStart(6, '0')}`;
}

function movingTrackRecords(base: S2BTrackFixture['records'], mover: Mover,
  mode: WatermarkMode = 'always'): S2BTrackFixture['records'] {
  const wrapped = {
    ...base,
    async readMany(refKeys: readonly string[]) {
      if (refKeys.length === 0) {
        mover.count += 1;
        return { status: 'ready' as const,
          value: { records: [], missing: [], readThrough: watermarkAt(mover, mode) } };
      }
      return base.readMany(refKeys);
    },
  };
  return wrapped as unknown as S2BTrackFixture['records'];
}

function movingTimelineRecords(base: S2BTimelineFixture['records'], mover: Mover,
  mode: WatermarkMode = 'always'): S2BTimelineFixture['records'] {
  const wrapped = {
    ...base,
    async readMany(refKeys: readonly string[]) {
      if (refKeys.length === 0) {
        mover.count += 1;
        return { status: 'ready' as const,
          value: { records: [], missing: [], readThrough: watermarkAt(mover, mode) } };
      }
      return base.readMany(refKeys);
    },
  };
  return wrapped as unknown as S2BTimelineFixture['records'];
}

describe.each(['memory', 'sqlite'] as const)('S2B-r2 2B-27 moving window (%s)', (kind) => {
  it('2B-27 readTrackBars retries the moved track window exactly four times then reports unavailable', async () => {
    const f = await openS2BTrackFixture(kind);
    opened.push(f);
    await f.runAndEnd('work-1', f.computeSessionRef(), '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');

    const mover: Mover = { count: 0 };
    const result = await f.track(movingTrackRecords(f.records, mover)).readTrackBars(f.ctx, {
      goalRef: f.goalRef, from: '2026-10-14T00:00:00.000Z', to: '2026-10-15T00:00:00.000Z',
      cursor: null, limit: 200,
    });

    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    if (result.status !== 'rejected') throw new Error('the moving track window must be rejected');
    expect(result.reason).toContain(`${String(WINDOW_MAX_ATTEMPTS)} attempts`);
    // Four attempts, each reading the ledger watermark before and after the window.
    expect(mover.count).toBe(WINDOW_MAX_ATTEMPTS * 2);
  });

  it('2B-27 readTaskStateTimeline retries the moved timeline window exactly four times then reports unavailable', async () => {
    const f = await openS2BTimelineFixture(kind);
    opened.push(f);
    f.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await f.createGoal({ goalId: 's2b-r2-27-timeline', workTaskIds: ['work-1'] });
    await f.seedRun({ goalRef, runId: 'r2-27-run-1', taskId: 'work-1', planRef: (await f.activePlanRef(goalRef))!,
      startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:30:00.000Z', outcome: 'completed' });

    const mover: Mover = { count: 0 };
    const result = await f.timelineWith(movingTimelineRecords(f.records, mover))
      .readTaskStateTimeline(f.ctx, { goalRef, cursor: null, limit: 200 });

    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    if (result.status !== 'rejected') throw new Error('the moving timeline window must be rejected');
    expect(result.reason).toContain(`${String(WINDOW_MAX_ATTEMPTS)} attempts`);
    // Four attempts, each reading the ledger watermark before and after the page.
    expect(mover.count).toBe(WINDOW_MAX_ATTEMPTS * 2);
  });

  it('2B-27 readTrackBars settles after one moved window and returns the hand-computed bar', async () => {
    const f = await openS2BTrackFixture(kind);
    opened.push(f);
    const run = await f.runAndEnd('work-1', f.computeSessionRef(),
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    await f.writeActivity(run, countedFacts({
      turnStartedAt: '2026-10-14T10:00:00.000Z', lastRecordAt: '2026-10-14T10:10:00.000Z',
      quarters: [{ at: '2026-10-14T10:00:00.000Z', steps: 5, edits: 2, editsUnknown: 0 }],
    }));

    const mover: Mover = { count: 0 };
    const result = await f.track(movingTrackRecords(f.records, mover, 'advance-once')).readTrackBars(f.ctx, {
      goalRef: f.goalRef, from: '2026-10-14T00:00:00.000Z', to: '2026-10-15T00:00:00.000Z',
      cursor: null, limit: 200,
    });

    if (result.status !== 'ready') throw new Error(`the moved-once track window must settle: ${JSON.stringify(result)}`);
    // Attempt one reads c1 then c2 (interrupted); attempt two reads c3 then c3.
    expect(mover.count).toBe(4);
    expect(result.value.bars).toHaveLength(1);
    const bar = result.value.bars[0]!;
    expect(bar.kind).toBe('run');
    if (bar.kind !== 'run') throw new Error('the settled track bar must be a Run bar');
    expect(bar.runRef).toEqual(run);
    expect(bar.taskId).toBe('work-1');
    expect(bar.sessionRef).toEqual(f.computeSessionRef());
    expect(bar.startAt).toBe('2026-10-14T10:00:00.000Z');
    expect(bar.endAt).toBe('2026-10-14T10:30:00.000Z');
    expect(bar.result).toBe('completed');
    expect(bar.reason).toBeNull();
    expect(bar.pauses).toEqual([]);
    expect(bar.previous).toBeNull();
    expect(bar.attempt).toEqual({ attemptId: expect.any(String), via: 'first', requeue: null });
    expect(bar.activity).toMatchObject({
      status: 'counted', reason: null, error: false,
      totals: { steps: 5, edits: 2, editsUnknown: 0 },
      changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false },
      countedThroughTurnEnd: true, unresolvedCalls: 0,
    });
    expect(result.value.next).toBeNull();
    expect(result.value.queriesIncluded).toBe(false);
    expect(result.value.unplaced).toEqual({ runs: 0, rounds: 0, gateRounds: 0 });
  });

  it('2B-27 readTaskStateTimeline settles after one moved window and returns the hand-computed segments', async () => {
    const f = await openS2BTimelineFixture(kind);
    opened.push(f);
    f.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await f.createGoal({ goalId: 's2b-r2-27-timeline-settle', workTaskIds: ['work-1'] });
    await f.seedRun({ goalRef, runId: 'r2-27-settle-run-1', taskId: 'work-1',
      planRef: (await f.activePlanRef(goalRef))!,
      startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:30:00.000Z', outcome: 'completed' });
    // `seedRun` queues the terminal write; the public `timeline` read flushes it
    // before the wrapped read below, so the Run is really ended.
    await f.timeline({ goalRef, limit: 200 });

    const mover: Mover = { count: 0 };
    const result = await f.timelineWith(movingTimelineRecords(f.records, mover, 'advance-once'))
      .readTaskStateTimeline(f.ctx, { goalRef, cursor: null, limit: 200 });

    if (result.status !== 'ready') throw new Error(`the moved-once timeline window must settle: ${JSON.stringify(result)}`);
    // Attempt one reads c1 then c2 (interrupted); attempt two reads c3 then c3.
    expect(mover.count).toBe(4);
    const task = result.value.tasks.find((candidate) => candidate.taskId === 'work-1');
    expect(task?.segments.map((segment) =>
      [segment.from, segment.to, segment.state, segment.point?.kind ?? null])).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan', null],
      ['2026-10-01T09:00:00.000Z', '2026-10-01T10:00:00.000Z', 'pending', 'plan_appear'],
      ['2026-10-01T10:00:00.000Z', '2026-10-01T10:30:00.000Z', 'running', 'run_start'],
      ['2026-10-01T10:30:00.000Z', null, 'awaiting_check', 'run_end'],
    ]);
    expect(task?.untimedPoints).toEqual([]);
    expect(result.value.approximate).toBe(true);
    expect(result.value.next).toBeNull();
  });
});
