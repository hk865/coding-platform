/**
 * Slice 2B round-3, fix R3 (quick-check must-fix 1): the readonly-copy
 * provenance lookup is paged, so a `limit: 2` read stops when the requested
 * bars are filled instead of loading every later copy first. Thousands (here a
 * bounded stand-in) of later copies must not exhaust an injected read cap.
 *
 * Every copy is a real readonly-copy Session built through the public session
 * lifecycle, and every consultation is a real answered QueryRun built through
 * the public Query owners. Assertions read only the public `readTrackBars`;
 * the expected bar ids are literal.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TrackBarsPageV1 } from '../../src/core/work-graph/views/track-read-model.js';
import { openS2BTrackFixture, type S2BTrackFixture } from '../helpers/S2B-track-fixture.js';
import { R2_DAY_FROM, R2_DAY_TO } from '../helpers/S2B-r2-track-support.js';
import { S2B_SLOW_TIMEOUT_MS } from '../helpers/S2B-task-timeline-fixture.js';

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

describe.each(['memory', 'sqlite'] as const)('S2B round 3 R3 consultation provenance cap (%s)', (kind) => {
  it('2B-r3 R3 limit 2 over many later readonly copies stays within the injected cap', async () => {
    const f = await open(kind);
    const asked = f.computeSessionRef();
    f.setClock('2026-10-14T10:00:00.000Z');

    // 64 real copies, every one carrying an answered consultation. The first
    // provenance page (8) already fills a `limit: 2` page, so the fixed reader
    // reads at most that page; the old reader loaded all 64 before emitting.
    const copies: SessionRef[] = [];
    for (let index = 0; index < 64; index += 1) {
      const copy = await f.newReadonlyCopy(asked, `s2b-r3-copy-${String(index)}`);
      copies.push(copy);
      await f.submitAndFinishQuery(copy, f.goalRef.goalId, `r3-query-${String(index)}`);
    }

    // 40 storage reads fit one provenance page (8) plus the two consultation
    // reads, but not all 64 copies; the old reader therefore exceeded it.
    const page = ready(await f.readTrack(
      { from: R2_DAY_FROM, to: R2_DAY_TO, limit: 2, sessionRefs: [asked] },
      { readRecordCap: 40 }));

    expect(page.bars).toHaveLength(2);
    expect(page.bars.every((bar) => bar.kind === 'query')).toBe(true);
    for (const bar of page.bars) {
      expect(bar.kind === 'query' && bar.via).toBe('consultation');
      expect(bar.kind === 'query' && bar.askedSessionRef?.sessionId).toBe(asked.sessionId);
    }
    expect(page.next).not.toBeNull();
    expect(copies.length).toBe(64);
  }, S2B_SLOW_TIMEOUT_MS);
});
