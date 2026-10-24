/**
 * Slice 2B round-2 R7: keyed reads charge one storage read per requested key,
 * including misses (absent activity record, absent recording epoch). Each
 * boundary is hand-counted from L17; the read with the exact cap is `ready` and
 * one read less is `capacity`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openS2BActivityFixture, type S2BActivityFixture } from '../helpers/S2B-activity-fixture.js';

const opened: S2BActivityFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

async function open(kind: 'memory' | 'sqlite'): Promise<S2BActivityFixture> {
  const fixture = await openS2BActivityFixture(kind);
  opened.push(fixture);
  return fixture;
}

describe.each(['memory', 'sqlite'] as const)('S2B round-2 keyed read cap (%s)', (kind) => {
  it('R7 readRunActivities charges absent activity and epoch records', async () => {
    const f = await open(kind);
    // No `ensureRecording`: the epoch record is absent. No activity record is
    // written. Reads: activity miss (1) + Run (1) + epoch miss (1) = 3.
    const run = await f.runAndEnd('work-1', f.b2.base.sessions.second,
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');

    expect(await f.readModelWith(f.records, 3).readRunActivities(f.ctx, { runRefs: [run] }))
      .toMatchObject({ status: 'ready' });
    expect(await f.readModelWith(f.records, 2).readRunActivities(f.ctx, { runRefs: [run] }))
      .toMatchObject({ status: 'rejected', code: 'capacity' });
  });

  it('R7 readActivityCalendar charges an absent epoch and an absent activity record', async () => {
    const f = await open(kind);
    // No `ensureRecording`. One ended Run with no activity record. L9 step 3
    // reads the whole workspace before filtering by Goal, so every open
    // `starting`/`running` Run in it is charged. The accepted B2 fixture leaves
    // exactly its two real claims open; name and read them explicitly so a
    // fixture change fails here instead of silently moving the boundary.
    const fixtureOpenRuns = [f.b2.claim.runRef, f.b2.secondClaim.runRef];
    const fixtureOpen = await f.readModelWith(f.records).readRunActivities(f.ctx, { runRefs: fixtureOpenRuns });
    expect(fixtureOpen.status).toBe('ready');
    if (fixtureOpen.status !== 'ready') return;
    expect(fixtureOpen.value.map((view) => view.status)).toEqual(['in_progress', 'in_progress']);

    await f.runAndEnd('work-1', f.b2.base.sessions.second,
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    const input = { scope: { kind: 'goal' as const, goalRef: f.goalRef },
      from: '2026-10-14T10:00:00.000Z', to: '2026-10-14T11:00:00.000Z',
      granularity: 'hour' as const, timeZone: 'UTC' };

    // Reads: Goal (1) + epoch miss (1) + Run index row (1) + activity miss (1)
    // + the explicitly named open Runs (fixtureOpenRuns.length).
    const cap = 4 + fixtureOpen.value.length;
    expect(await f.readModelWith(f.records, cap).readActivityCalendar(f.ctx, input))
      .toMatchObject({ status: 'ready' });
    expect(await f.readModelWith(f.records, cap - 1).readActivityCalendar(f.ctx, input))
      .toMatchObject({ status: 'rejected', code: 'capacity' });
  });
});
