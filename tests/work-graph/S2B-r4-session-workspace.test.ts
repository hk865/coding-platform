/**
 * Slice 2B round-3, fix R4 (quick-check must-fix 2): a returned SessionRef is
 * resolved to its Session record and checked against the caller's bound
 * workspace, not only the bound project. A Run/Query in the bound Goal whose
 * claiming Session lives in another workspace of the same project must not
 * leak; the reads answer `forbidden`.
 *
 * The foreign Session is a real Session record cloned at the storage boundary
 * with only `workspaceId` changed (`S2B-r3-r4-support.ts`); the Runs are built
 * by the accepted fixtures. Assertions read only the public ports.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  countedFacts, openS2BActivityFixture, type S2BActivityFixture,
} from '../helpers/S2B-activity-fixture.js';
import { seedActivityRun } from '../helpers/S2B-r2-activity-support.js';
import { openS2BTrackFixture, type S2BTrackFixture } from '../helpers/S2B-track-fixture.js';
import { R2_DAY_FROM, R2_DAY_TO, seedRawRunVariant } from '../helpers/S2B-r2-track-support.js';
import { cloneSessionInWorkspace } from '../helpers/S2B-r3-r4-support.js';
import { S2B_SLOW_TIMEOUT_MS } from '../helpers/S2B-task-timeline-fixture.js';

const FOREIGN_WORKSPACE = 's2b-r4-foreign-workspace';

const tracks: S2BTrackFixture[] = [];
const activities: S2BActivityFixture[] = [];
afterEach(async () => {
  for (const fixture of tracks.splice(0)) await fixture.close();
  for (const fixture of activities.splice(0)) await fixture.close();
});

async function openTrack(kind: 'memory' | 'sqlite'): Promise<S2BTrackFixture> {
  const fixture = await openS2BTrackFixture(kind);
  tracks.push(fixture);
  return fixture;
}

async function openActivity(kind: 'memory' | 'sqlite'): Promise<S2BActivityFixture> {
  const fixture = await openS2BActivityFixture(kind);
  activities.push(fixture);
  return fixture;
}

describe.each(['memory', 'sqlite'] as const)('S2B round 3 R4 referenced Session workspace (%s)', (kind) => {
  it('2B-r3 R4 a track run bar whose Session is in another workspace is forbidden', async () => {
    const f = await openTrack(kind);
    const foreign = await cloneSessionInWorkspace(f, f.computeSessionRef(),
      's2b-r4-track-foreign-session', FOREIGN_WORKSPACE);
    const runRef = await seedRawRunVariant(f, {
      taskId: 'work-3', runId: 's2b-r4-track-foreign-run',
      startedAt: '2026-10-14T11:00:00.000Z', endedAt: '2026-10-14T11:05:00.000Z',
      mutate: (body) => {
        const history = body['executionHistory'] as { kernel: unknown };
        body['executionHistory'] = { schemaVersion: 1, sessionRef: foreign, kernel: history.kernel,
          startPosition: 2, observedThroughPosition: 5, endPosition: 5 };
      },
    });

    const result = await f.readTrack({ from: R2_DAY_FROM, to: R2_DAY_TO, limit: 100 });
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    void runRef;
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-r3 R4 a calendar cell Session in another workspace is forbidden', async () => {
    const f = await openActivity(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const foreign = await cloneSessionInWorkspace(f, f.b2.base.sessions.second,
      's2b-r4-calendar-foreign-session', FOREIGN_WORKSPACE);
    const runRef = await seedActivityRun(f, {
      taskId: 'work-1', runId: 's2b-r4-calendar-foreign-run', status: 'ended', outcome: 'completed',
      startedAt: '2026-10-14T09:00:00.000Z', endedAt: '2026-10-14T09:30:00.000Z',
      history: { schemaVersion: 1, sessionRef: foreign,
        kernel: { adapterId: 's2b-r4-kernel', kernelSessionId: 's2b-r4-kernel-session',
          runId: 's2b-r4-kernel-run', turnId: 's2b-r4-kernel-turn' },
        startPosition: 2, observedThroughPosition: 5, endPosition: 5 },
    });
    await f.writeActivity(runRef, countedFacts({
      turnStartedAt: '2026-10-14T09:00:00.000Z', lastRecordAt: '2026-10-14T09:30:00.000Z',
      quarters: [{ at: '2026-10-14T09:00:00.000Z', steps: 1, edits: 0, editsUnknown: 0 }],
    }));

    const result = await f.readCalendar({
      goalRef: f.goalRef, from: '2026-10-14T09:00:00.000Z', to: '2026-10-14T10:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC',
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
  }, S2B_SLOW_TIMEOUT_MS);
});
