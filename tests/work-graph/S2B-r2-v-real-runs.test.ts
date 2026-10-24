/**
 * Round-2 R11 Group V (spec §5.1 BE1): rows 2B-21, 2B-26, 2B-29 and 2B-30 are
 * reached a second time through a REAL Runtime run with the scripted model
 * (`S2B-be1-platform-fixture.ts`), so the public reads see records written by
 * the run-end commit itself (L5) instead of injected `RunActivity` facts.
 *
 * The round-1 files (`S2B-activity-calendar*.test.ts`,
 * `S2B-run-activity-read.test.ts`, `S2B-30-track-bars.test.ts`) stay as the
 * supplementary case coverage; these tests assert the facts a real run end
 * produces, through `readActivityCalendar`, `readRunActivities` and
 * `readTrackBars`. Nothing here reads the database or writes a record directly.
 *
 * A started-but-unobserved Run (the `in_progress` / open-bar case) cannot be
 * produced here: `startRun` runs the scripted Turn to its terminal in one call,
 * so it always books a `run_end` record. That case needs BE1r's blocking test
 * tool and stays with the round-1 supplementary files.
 *
 * The accepted BE1 fixture Plan has one independent claimable work task
 * (`implement-a`), so the multi-task / second-attempt cases stay with the
 * round-1 supplementary files; the run-end integration itself is what this
 * file proves.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ActivityCalendarV1, ActivityReadPort, RunActivityViewV1,
} from '../../src/core/work-graph/views/activity-read-model.js';
import type { TrackBarsPageV1, TrackReadPort } from '../../src/core/work-graph/views/track-read-model.js';
import {
  createS2BBe1Platform, S2B_SLOW_TIMEOUT_MS, type S2BBe1PlatformFixture,
} from '../helpers/S2B-be1-platform-fixture.js';

const opened: S2BBe1PlatformFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

type ActivityWithTrack = ActivityReadPort & Pick<TrackReadPort, 'readTrackBars'>;

function activityOf(f: S2BBe1PlatformFixture): ActivityWithTrack {
  const port = (f.platform as unknown as { activity?: ActivityWithTrack }).activity;
  if (port === undefined) throw new Error('the platform exposes no activity read port');
  return port;
}

async function readTrack(f: S2BBe1PlatformFixture, from: string, to: string): Promise<TrackBarsPageV1> {
  const result = await activityOf(f).readTrackBars(f.ctx, { goalRef: f.goalRef, from, to, cursor: null, limit: 200 });
  if (result.status !== 'ready') throw new Error(`readTrackBars failed: ${JSON.stringify(result)}`);
  return result.value;
}

async function readCalendar(f: S2BBe1PlatformFixture,
  input: { from: string; to: string; granularity: 'hour' | 'day'; timeZone: string }): Promise<ActivityCalendarV1> {
  const result = await activityOf(f).readActivityCalendar(f.ctx, {
    ...input, scope: { kind: 'goal', goalRef: f.goalRef } });
  if (result.status !== 'ready') throw new Error(`readActivityCalendar failed: ${JSON.stringify(result)}`);
  return result.value;
}

function viewOf(views: RunActivityViewV1[], runId: string): RunActivityViewV1 {
  const view = views.find((candidate) => candidate.runRef.runId === runId);
  if (view === undefined) throw new Error(`no activity view for Run ${runId}`);
  return view;
}

describe('S2B-r2 Group V real-Runtime runs', () => {
  it('2B-21 a real Run end at 02:10Z reads as the Asia/Shanghai 10:00 cell with future cells marked', async () => {
    const f = await createS2BBe1Platform({
      toolNames: ['read'], writeScope: [], initialAt: '2026-10-14T02:05:00.000Z',
      workspaceFiles: { 'a.ts': 'r2-21\n' },
      beforeReply: async (_request, index) => {
        f.setClock(index === 0 ? '2026-10-14T02:10:00.000Z' : '2026-10-14T02:10:30.000Z');
      },
      scriptedReplies: [
        { kind: 'calls', calls: [{ callId: 'r2-21-read', name: 'read', args: { path: 'a.ts' } }] },
        { kind: 'text', text: '2B-21 done' },
      ],
    });
    opened.push(f);
    const record = await f.run('r2-21');
    expect(record.run.outcome).toBe('completed');

    f.setClock('2026-10-14T04:10:00.000Z');
    const calendar = await readCalendar(f, {
      from: '2026-10-13T16:00:00.000Z', to: '2026-10-14T16:00:00.000Z', granularity: 'hour', timeZone: 'Asia/Shanghai',
    });

    expect(calendar.cells).toHaveLength(24);
    expect(calendar.cells.find((cell) => cell.localHour === 10)).toMatchObject({
      localDate: '2026-10-14', localHour: 10,
      startAt: '2026-10-14T02:00:00.000Z', endAt: '2026-10-14T03:00:00.000Z',
      future: false, steps: 1, edits: 0, editsUnknown: 0, checks: 0, uncountedRuns: 0, complete: true,
    });
    // 13:00 local starts at 05:00Z, after the 04:10Z read clock.
    expect(calendar.cells.find((cell) => cell.localHour === 13)?.future).toBe(true);
    expect(calendar.totals).toEqual({
      steps: 1, querySteps: 0, edits: 0, editsUnknown: 0, checks: 0, complete: true,
    });
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-26 a real Run end carries its own task steps into the cell and a sessionRefs filter keeps its line', async () => {
    const f = await createS2BBe1Platform({
      toolNames: ['read'], writeScope: [], initialAt: '2026-10-14T02:05:00.000Z',
      workspaceFiles: { 'a.ts': 'r2-26\n' },
      beforeReply: async (_request, index) => { if (index === 0) f.setClock('2026-10-14T02:10:00.000Z'); },
      scriptedReplies: [
        { kind: 'calls', calls: [{ callId: 'r2-26-read', name: 'read', args: { path: 'a.ts' } }] },
        { kind: 'text', text: '2B-26 done' },
      ],
    });
    opened.push(f);
    await f.run('r2-26');
    f.setClock('2026-10-14T04:10:00.000Z');

    const window = { from: '2026-10-13T16:00:00.000Z', to: '2026-10-14T16:00:00.000Z',
      granularity: 'hour' as const, timeZone: 'Asia/Shanghai' };
    const whole = await readCalendar(f, window);
    expect(whole.cells.find((cell) => cell.localHour === 10)).toMatchObject({
      steps: 1, complete: true,
      tasks: [{ taskId: 'implement-a', steps: 1, edits: 0, checks: 0 }], moreTasks: 0,
    });

    const line = f.runs[0]!.sessionRef;
    const result = await activityOf(f).readActivityCalendar(f.ctx, {
      ...window, scope: { kind: 'goal', goalRef: f.goalRef }, sessionRefs: [line] });
    if (result.status !== 'ready') throw new Error(`filtered calendar failed: ${JSON.stringify(result)}`);
    const filtered = result.value.cells.find((cell) => cell.localHour === 10);
    expect(filtered).toMatchObject({ steps: 1, sessions: [line],
      tasks: [{ taskId: 'implement-a', steps: 1, edits: 0, checks: 0 }] });
    expect(result.value.coverage.runsCounted).toBe(1);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-29 a real Run end reads counted with recordedBy run_end and the recordedAt of the end commit', async () => {
    const f = await createS2BBe1Platform({
      toolNames: ['read'], writeScope: [], initialAt: '2026-10-14T02:00:00.000Z',
      workspaceFiles: { 'a.ts': 'r2-29\n' },
      beforeReply: async (_request, index) => {
        f.setClock(index === 0 ? '2026-10-14T02:10:00.000Z' : '2026-10-14T02:11:00.000Z');
      },
      scriptedReplies: [
        { kind: 'calls', calls: [{ callId: 'r2-29-read', name: 'read', args: { path: 'a.ts' } }] },
        { kind: 'text', text: '2B-29 done' },
      ],
    });
    opened.push(f);
    await f.run('r2-29');
    f.setClock('2026-10-14T02:30:00.000Z');

    const views = await f.readRuns([f.runRef]);
    expect(views).toHaveLength(1);
    expect(viewOf(views, f.runRef.runId)).toMatchObject({
      status: 'counted', reason: null, error: false,
      totals: { steps: 1, edits: 0, editsUnknown: 0 },
      changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false },
      recordedBy: 'run_end', countedThroughTurnEnd: true, unresolvedCalls: 0,
      recordedAt: '2026-10-14T02:11:00.000Z',
    });

    const tooMany = Array.from({ length: 201 }, () => f.runRef);
    const rejected = await activityOf(f).readRunActivities(f.ctx, { runRefs: tooMany });
    expect(rejected).toMatchObject({ status: 'rejected', code: 'invalid' });
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-30 track bars read the real completed Run with its run-end activity', async () => {
    const f = await createS2BBe1Platform({
      toolNames: ['read'], writeScope: [], initialAt: '2026-10-14T10:10:00.000Z',
      workspaceFiles: { 'a.ts': 'r2-30\n' },
      beforeReply: async (_request, index) => {
        f.setClock(index === 0 ? '2026-10-14T10:10:00.000Z' : '2026-10-14T10:11:00.000Z');
      },
      scriptedReplies: [
        { kind: 'calls', calls: [{ callId: 'r2-30-read', name: 'read', args: { path: 'a.ts' } }] },
        { kind: 'text', text: '2B-30 done' },
      ],
    });
    opened.push(f);
    await f.run('r2-30');

    const page = await readTrack(f, '2026-10-14T10:00:00.000Z', '2026-10-14T11:00:00.000Z');
    expect(page.bars).toHaveLength(1);
    expect(page.bars[0]).toMatchObject({
      kind: 'run', runRef: f.runRef, taskId: 'implement-a', sessionRef: f.runs[0]!.sessionRef,
      startAt: '2026-10-14T10:10:00.000Z', endAt: '2026-10-14T10:11:00.000Z',
      result: 'completed', reason: null, pauses: [], previous: null,
      activity: { status: 'counted', recordedBy: 'run_end', countedThroughTurnEnd: true,
        totals: { steps: 1, edits: 0, editsUnknown: 0 } },
    });
    expect(page.queriesIncluded).toBe(false);
  }, S2B_SLOW_TIMEOUT_MS);
});
