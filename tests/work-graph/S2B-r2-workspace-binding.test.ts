/**
 * Slice 2B round-2 R4: every activity read enforces the caller's bound
 * workspace. The Goal/Run records name their own workspace, so a same-project
 * reference to another workspace must be `forbidden` before any of its records
 * is returned. Asserted through the public reads (and the real route dispatch
 * for the calendar).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchCoreRoute, parseCoreRouteRequest, type CoreRouteBindings } from '../../src/app/core-routes.js';
import type { CoreRouteSuffix } from '../../src/app/core-http-types.js';
import { createTrackReadModel } from '../../src/core/work-graph/views/track-read-model.js';
import { createTaskStateTimeline } from '../../src/core/work-graph/views/task-state-timeline.js';
import {
  countedFacts, openS2BActivityFixture, type S2BActivityFixture,
} from '../helpers/S2B-activity-fixture.js';
import {
  activityGoalExecutedFiles, withForeignWorkspace,
} from '../helpers/S2B-r2-activity-support.js';

const opened: S2BActivityFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

async function open(kind: 'memory' | 'sqlite'): Promise<S2BActivityFixture> {
  const fixture = await openS2BActivityFixture(kind);
  opened.push(fixture);
  return fixture;
}

describe.each(['memory', 'sqlite'] as const)('S2B round-2 bound workspace (%s)', (kind) => {
  it('R4 readActivityCalendar is forbidden when the Goal belongs to another workspace', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const run = await f.runAndEnd('work-1', f.b2.base.sessions.second,
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    await f.writeActivity(run, countedFacts({
      turnStartedAt: '2026-10-14T09:00:00.000Z', lastRecordAt: '2026-10-14T09:30:00.000Z',
      quarters: [{ at: '2026-10-14T09:00:00.000Z', steps: 1, edits: 0, editsUnknown: 0 }],
    }));

    const model = f.readModelWith(f.records);
    const result = await model.readActivityCalendar(withForeignWorkspace(f), {
      goalRef: f.goalRef, from: '2026-10-14T09:00:00.000Z', to: '2026-10-14T10:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC',
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });

    // The bound workspace's own read still answers ready.
    expect(await model.readActivityCalendar(f.ctx, {
      goalRef: f.goalRef, from: '2026-10-14T09:00:00.000Z', to: '2026-10-14T10:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC',
    })).toMatchObject({ status: 'ready' });
  });

  it('R4 readRunActivities is forbidden when the Run belongs to another workspace', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const run = await f.runAndEnd('work-1', f.b2.base.sessions.second,
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    await f.writeActivity(run, countedFacts({
      turnStartedAt: '2026-10-14T09:00:00.000Z', lastRecordAt: '2026-10-14T09:30:00.000Z', quarters: [],
    }));

    const model = f.readModelWith(f.records);
    expect(await model.readRunActivities(withForeignWorkspace(f), { runRefs: [run] }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await model.readRunActivities(f.ctx, { runRefs: [run] }))
      .toMatchObject({ status: 'ready' });
  });

  it('R4 readGoalExecutedFiles is forbidden when the Goal belongs to another workspace', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const run = await f.runAndEnd('work-1', f.b2.base.sessions.second,
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    await f.writeActivity(run, countedFacts({
      turnStartedAt: '2026-10-14T09:00:00.000Z', lastRecordAt: '2026-10-14T09:30:00.000Z',
      changedFiles: { definite: ['src/a.ts'] },
    }));

    const reader = activityGoalExecutedFiles(f);
    expect(await reader.readGoalExecutedFiles(withForeignWorkspace(f), { goalRef: f.goalRef }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await reader.readGoalExecutedFiles(f.ctx, { goalRef: f.goalRef }))
      .toMatchObject({ status: 'ready' });
  });

  it('R4 the activity/calendar route answers forbidden for a Goal in another workspace', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');

    const bound = { projectId: f.b2.base.scope.projectId, workspaceId: 's2b-r2-route-bound-workspace' };
    const ctx = { ...f.ctx, workspaceId: bound.workspaceId };
    const input = { goalRef: f.goalRef, from: '2026-10-14T09:00:00.000Z', to: '2026-10-14T10:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC' };
    const parsed = parseCoreRouteRequest('activity/calendar', { scope: bound, input });
    const model = f.readModelWith(f.records);
    const bindings = {
      readActivityCalendar: model.readActivityCalendar,
      readRunActivities: model.readRunActivities,
    } as unknown as CoreRouteBindings;

    expect(await dispatchCoreRoute(bindings, 'activity/calendar', ctx, parsed))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('R4 the activity/runs, activity/track and tasks/timeline routes answer forbidden in another workspace', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const run = await f.runAndEnd('work-1', f.b2.base.sessions.second,
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');

    const bound = { projectId: f.b2.base.scope.projectId, workspaceId: 's2b-r2-route-bound-workspace' };
    const ctx = { ...f.ctx, workspaceId: bound.workspaceId };
    const activity = f.readModelWith(f.records);
    const track = createTrackReadModel({ records: f.records, now: () => f.clock() });
    const timeline = createTaskStateTimeline({ records: f.records });
    const bindings = {
      readActivityCalendar: activity.readActivityCalendar,
      readRunActivities: activity.readRunActivities,
      readTrackBars: track.readTrackBars,
      readTaskStateTimeline: timeline.readTaskStateTimeline,
    } as unknown as CoreRouteBindings;

    const cases: { suffix: CoreRouteSuffix; input: unknown }[] = [
      { suffix: 'activity/runs', input: { runRefs: [run] } },
      { suffix: 'activity/track', input: { goalRef: f.goalRef, from: '2026-10-14T09:00:00.000Z',
        to: '2026-10-14T10:00:00.000Z', cursor: null, limit: 10 } },
      { suffix: 'tasks/timeline', input: { goalRef: f.goalRef, cursor: null, limit: 10 } },
    ];
    for (const { suffix, input } of cases) {
      const parsed = parseCoreRouteRequest(suffix, { scope: bound, input });
      expect(await dispatchCoreRoute(bindings, suffix, ctx, parsed), suffix)
        .toMatchObject({ status: 'rejected', code: 'forbidden' });
    }
  });
});
