/**
 * Slice 2B round 2, fix R3 (review item 3): track pagination is per L12 — the
 * cursor is a segment plus index position, each source is read only until the
 * page is full, and metadata comes from that scan alone.
 *
 * (a) `limit: 2` over a window with more ended Runs than the page stays within
 *     an injected low `readRecordCap` and returns 2 bars plus a `next`; if the
 *     reader scanned every Run it would exceed that cap.
 * (b) a Run added before the page boundary between two pages neither duplicates
 *     the boundary bar nor skips an unrelated later bar.
 *
 * Reads only the public `readTrackBars`; expected values are hand literals.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackBarsPageV1 } from '../../src/core/work-graph/views/track-read-model.js';
import { openS2BTrackFixture, type S2BTrackFixture } from '../helpers/S2B-track-fixture.js';
import { R2_DAY_FROM, R2_DAY_TO, seedRealTrackRuns } from '../helpers/S2B-r2-track-support.js';

const opened: S2BTrackFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

async function open(kind: 'memory' | 'sqlite'): Promise<S2BTrackFixture> {
  const fixture = await openS2BTrackFixture(kind);
  opened.push(fixture);
  return fixture;
}

function ready(result: Awaited<ReturnType<S2BTrackFixture['readTrack']>>): TrackBarsPageV1 {
  if (result.status !== 'ready') throw new Error(`track read failed: ${JSON.stringify(result)}`);
  return result.value;
}

function runIds(page: TrackBarsPageV1): string[] {
  return page.bars.map((bar) => (bar.kind === 'run' ? bar.runRef.runId : ''));
}

describe.each(['memory', 'sqlite'] as const)('S2B round 2 R3 track pagination (%s)', (kind) => {
  it('2B-r2 R3 limit 2 over more ended Runs than the page stays within a low injected read cap', async () => {
    const f = await open(kind);
    // Twelve real Runs (the fixture's work tasks) at 20 s apart. A page of two
    // costs 8 storage reads (goal 1, recording 1, ordered page 2, two Runs at
    // 2 each); scanning all twelve would charge at least twelve index reads, so
    // the cap of 10 discriminates.
    const ids = await seedRealTrackRuns(f, 12);

    const page = ready(await f.readTrack(
      { from: R2_DAY_FROM, to: R2_DAY_TO, limit: 2 }, { readRecordCap: 10 }));

    expect(page.bars).toHaveLength(2);
    expect(runIds(page)).toEqual([ids[0], ids[1]]);
    expect(page.next).not.toBeNull();
  }, 900_000);

  it('2B-r2 R3 a Run added before the boundary does not duplicate or skip', async () => {
    const f = await open(kind);
    const session = f.computeSessionRef();
    const a = await f.runAndEnd('work-1', session,
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:10:00.000Z');
    const b = await f.runAndEnd('work-2', session,
      '2026-10-14T10:20:00.000Z', '2026-10-14T10:30:00.000Z');
    const c = await f.runAndEnd('work-3', session,
      '2026-10-14T10:40:00.000Z', '2026-10-14T10:50:00.000Z');

    const first = ready(await f.readTrack({ from: R2_DAY_FROM, to: R2_DAY_TO, limit: 2 }));
    expect(runIds(first)).toEqual([a.runId, b.runId]);
    expect(first.next).not.toBeNull();

    // A Run ending before the boundary is added between the two pages. An
    // offset cursor would re-index the window and return `b` again (or skip
    // `c`); the segment+position cursor resumes after `b`.
    await f.runAndEnd('work-4', session, '2026-10-14T09:50:00.000Z', '2026-10-14T09:55:00.000Z');

    const second = ready(await f.readTrack(
      { from: R2_DAY_FROM, to: R2_DAY_TO, limit: 2, cursor: first.next }));
    expect(runIds(second)).toEqual([c.runId]);
    expect(second.next).toBeNull();
  });
});
