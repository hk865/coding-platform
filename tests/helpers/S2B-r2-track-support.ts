/**
 * Round 2 (R3/R4/R7) track-read support.
 *
 * The bounded-read test needs more Runs than the page it reads, so
 * `seedRealTrackRuns` builds a small set of REAL Runs through the public
 * fixture flow (one per track work task). A page of two then discriminates
 * under a low injected `readRecordCap`: reading only the page's two Runs stays
 * inside the cap, while any reader that scanned the whole window would charge
 * at least one index read per Run and exceed it. Every assertion reads through
 * the public `readTrackBars`; expected values are hand literals.
 */
import { TRACK_WORK_TASK_IDS, type S2BTrackFixture } from './S2B-track-fixture.js';

/** The full 2026-10-14 UTC day, a quarter-aligned window. */
export const R2_DAY_FROM = '2026-10-14T00:00:00.000Z';
export const R2_DAY_TO = '2026-10-15T00:00:00.000Z';

/**
 * Creates `count` REAL Runs through the public fixture flow, one per track work
 * task, each ending 20 s after the previous from `2026-10-14T09:00:00.000Z`.
 * Returns the Run ids in `endedAt` order (the order `s2b-run-by-goal-ended`
 * emits them).
 */
export async function seedRealTrackRuns(fixture: S2BTrackFixture, count: number): Promise<string[]> {
  const baseMs = Date.parse('2026-10-14T09:00:00.000Z');
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const taskId = TRACK_WORK_TASK_IDS[index];
    if (taskId === undefined) throw new Error(`S2B-r2 real run seed has no task at index ${String(index)}`);
    const endedMs = baseMs + index * 20_000;
    const run = await fixture.runAndEnd(taskId, fixture.computeSessionRef(),
      new Date(endedMs - 10_000).toISOString(), new Date(endedMs).toISOString());
    ids.push(run.runId);
  }
  return ids;
}
