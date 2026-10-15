/**
 * Slice 2B round 2, fix R4 (review item 4): the reads enforce the caller's
 * bound workspace. After resolving the Goal's workspace, a mismatch with
 * `ctx.workspaceId` is `forbidden`; the same read with the matching context is
 * `ready`. Real fixture data, public reads only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openS2BTrackFixture, type S2BTrackFixture } from '../helpers/S2B-track-fixture.js';
import {
  openS2BTimelineFixture, S2B_SLOW_TIMEOUT_MS, type S2BTimelineFixture,
} from '../helpers/S2B-task-timeline-fixture.js';
import { R2_DAY_FROM, R2_DAY_TO } from '../helpers/S2B-r2-track-support.js';

const FOREIGN_WORKSPACE = 's2b-r2-foreign-workspace';

describe.each(['memory', 'sqlite'] as const)('S2B round 2 R4 bound workspace (%s)', (kind) => {
  let track: S2BTrackFixture | null = null;
  let timeline: S2BTimelineFixture | null = null;
  afterEach(async () => {
    if (track !== null) await track.close();
    if (timeline !== null) await timeline.close();
    track = null;
    timeline = null;
  });

  it('2B-r2 R4 track read rejects a Goal outside the bound workspace', async () => {
    const f = await openS2BTrackFixture(kind);
    track = f;
    await f.runAndEnd('work-1', f.computeSessionRef(),
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');

    const matching = await f.track().readTrackBars(f.ctx,
      { goalRef: f.goalRef, from: R2_DAY_FROM, to: R2_DAY_TO, cursor: null, limit: 100 });
    expect(matching.status).toBe('ready');

    const foreign = { ...f.ctx, workspaceId: FOREIGN_WORKSPACE };
    const rejected = await f.track().readTrackBars(foreign,
      { goalRef: f.goalRef, from: R2_DAY_FROM, to: R2_DAY_TO, cursor: null, limit: 100 });
    expect(rejected).toMatchObject({ status: 'rejected', code: 'forbidden' });
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-r2 R4 timeline read rejects a Goal outside the bound workspace', async () => {
    const fx = await openS2BTimelineFixture(kind);
    timeline = fx;
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-r2-r4-timeline', workTaskIds: ['t1'] });

    const matching = await fx.timelineWith(fx.records)
      .readTaskStateTimeline(fx.ctx, { goalRef, cursor: null, limit: 10 });
    expect(matching.status).toBe('ready');

    const foreign = { ...fx.ctx, workspaceId: FOREIGN_WORKSPACE };
    const rejected = await fx.timelineWith(fx.records)
      .readTaskStateTimeline(foreign, { goalRef, cursor: null, limit: 10 });
    expect(rejected).toMatchObject({ status: 'rejected', code: 'forbidden' });
  }, S2B_SLOW_TIMEOUT_MS);
});
