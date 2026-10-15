/**
 * Slice 2B round 2, fix R7 (review item 7): keyed reads charge every requested
 * key, including misses. The track reader spends one per keyed read; the
 * timeline reader already did. These exact-boundary tests inject
 * `readRecordCap`: the cap equal to the page's storage reads is `ready`, one
 * less is `capacity`, so a free miss would move the boundary by one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openS2BTrackFixture, type S2BTrackFixture } from '../helpers/S2B-track-fixture.js';
import {
  openS2BTimelineFixture, S2B_SLOW_TIMEOUT_MS, type S2BTimelineFixture,
} from '../helpers/S2B-task-timeline-fixture.js';
import { R2_DAY_FROM, R2_DAY_TO } from '../helpers/S2B-r2-track-support.js';

const opened: S2BTrackFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

async function open(kind: 'memory' | 'sqlite'): Promise<S2BTrackFixture> {
  const fixture = await openS2BTrackFixture(kind);
  opened.push(fixture);
  return fixture;
}

describe.each(['memory', 'sqlite'] as const)('S2B round 2 R7 keyed read cap (%s)', (kind) => {
  it('2B-r2 R7 two missing RunActivity records sit exactly on the cap', async () => {
    const f = await open(kind);
    // goal 1 + recording miss 1 + ordered page 2 + per Run (task index 1 +
    // control index 0 + missing activity 1) + one resolved Session 1 = 9
    // storage reads (round 3 R4 added the Session workspace resolution; both
    // Runs share one Session, so it is one cached keyed read). The two missing
    // RunActivity records are the keyed misses; if they were free the boundary
    // would be smaller.
    await f.runAndEnd('work-1', f.computeSessionRef(),
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:10:00.000Z');
    await f.runAndEnd('work-2', f.computeSessionRef(),
      '2026-10-14T10:20:00.000Z', '2026-10-14T10:30:00.000Z');

    const exact = await f.readTrack({ from: R2_DAY_FROM, to: R2_DAY_TO, limit: 2 }, { readRecordCap: 9 });
    expect(exact.status).toBe('ready');
    const short = await f.readTrack({ from: R2_DAY_FROM, to: R2_DAY_TO, limit: 2 }, { readRecordCap: 8 });
    expect(short).toMatchObject({ status: 'rejected', code: 'capacity' });
  });
});

describe.each(['memory', 'sqlite'] as const)('S2B round 2 R7 timeline keyed read cap (%s)', (kind) => {
  let timeline: S2BTimelineFixture | null = null;
  afterEach(async () => { if (timeline !== null) await timeline.close(); timeline = null; });

  it('2B-r2 R7 a missing Run requeue is charged on the timeline', async () => {
    const fx = await openS2BTimelineFixture(kind);
    timeline = fx;
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-r2-r7-timeline', workTaskIds: ['t1'] });
    const planRef = await fx.activePlanRef(goalRef);
    if (planRef === null) throw new Error('the R7 timeline fixture Goal has no active plan');
    await fx.seedRun({ goalRef, runId: 's2b-r2-r7-run', taskId: 't1', planRef,
      startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:10:00.000Z', outcome: 'completed' });

    // goal 1 + one Plan revision 1 + t1's Run index 1 + the Run's missing
    // requeue key 1 = 4 storage reads (gate-1's empty indexes cost 0). A free
    // requeue miss would make cap 3 already ready.
    const exact = await fx.timeline({ goalRef, limit: 10 }, { readRecordCap: 4 });
    expect(exact.status).toBe('ready');
    const short = await fx.timeline({ goalRef, limit: 10 }, { readRecordCap: 3 });
    expect(short).toMatchObject({ status: 'rejected', code: 'capacity' });
  }, S2B_SLOW_TIMEOUT_MS);
});
