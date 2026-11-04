/**
 * E3-6B B1-1: the run bar's `attempt.ordinal` counts the Runs that opened an attempt on the chain. The real
 * yielded pair (the S2B timeline fixture's scripted mailbox flow: Run 1 yields, Run 2 continues it) stays in
 * attempt 1; a real TaskRequeue then opens attempt 2. Public `readTrackBars` over the memory backend.
 *
 * The frozen row's `[1, 2, 2]` (a requeue before the yield) has no public step today: a yield starts from a
 * plain claim, and a requeued Run cannot be made to yield without a first-class step. This row proves the same
 * two rules with the existing steps: a continuation never adds an attempt, a requeue does.
 */
import { afterEach, expect, it } from 'vitest';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { createTrackReadModel } from '../../src/core/work-graph/views/track-read-model.js';
import { ready } from '../helpers/S5-application-support.js';
import { openS2BTimelineFixture, type S2BTimelineFixture } from '../helpers/S2B-task-timeline-fixture.js';

const opened: S2BTimelineFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

it('E36B B1-1: a yielded Run and its continuation stay in attempt 1; a requeue opens attempt 2', async () => {
  const f = await openS2BTimelineFixture('memory');
  opened.push(f);
  const goal = await f.createGoal({ goalId: 'e36b-attempt-goal', workTaskIds: ['work-1', 'work-2'] });
  await f.seedYieldedPair({ goalRef: goal, yieldTaskId: 'work-1', replyTaskId: 'work-2',
    yieldStartedAt: '2026-10-14T10:00:00.000Z', yieldedAt: '2026-10-14T10:10:00.000Z',
    replyStartedAt: '2026-10-14T10:20:00.000Z', replyEndedAt: '2026-10-14T10:30:00.000Z',
    resumeStartedAt: '2026-10-14T10:40:00.000Z', resumeEndedAt: '2026-10-14T10:50:00.000Z' });
  const timeline = await f.timeline({ goalRef: goal, limit: 100 });
  const work = timeline.status === 'ready' ? timeline.value.tasks.find((task) => task.taskId === 'work-1') : undefined;
  const runEnds = (work?.segments ?? []).map((segment) => segment.point).filter((point) => point?.kind === 'run_end');
  const lastEnd = runEnds.at(-1);
  if (lastEnd === undefined || lastEnd === null) throw new Error('E36B: the continuation Run must end on the timeline');
  const resumedRun = lastEnd.source as RunRef;
  await f.seedRound({ runRef: resumedRun, roundId: 'e36b-attempt-round-2',
    sinceAt: '2026-10-14T10:55:00.000Z', finalizedAt: '2026-10-14T10:56:00.000Z', outcome: 'FAIL' });
  await f.seedRequeue({ runRef: resumedRun, requestedAt: '2026-10-14T11:00:00.000Z' });
  await f.seedRun({ goalRef: goal, taskId: 'work-1', runId: 'e36b-attempt-run-3', planRef: (await f.activePlanRef(goal))!,
    startedAt: '2026-10-14T11:10:00.000Z', endedAt: '2026-10-14T11:20:00.000Z', outcome: 'completed' });

  const track = createTrackReadModel({ records: f.records, now: () => f.clock() });
  const page = ready(await track.readTrackBars(f.ctx, { goalRef: goal, from: '2026-10-14T00:00:00.000Z',
    to: '2026-10-15T00:00:00.000Z', cursor: null, limit: 100 }));
  const bars = page.bars.filter((bar) => bar.kind === 'run' && bar.taskId === 'work-1');
  expect(bars.map((bar) => (bar.kind === 'run' ? bar.attempt.ordinal : 0))).toEqual([1, 1, 2]);
  // The requeue's own request time, not the requeued Run's start: the two differ by ten minutes here.
  const requeuedBar = bars[2];
  if (requeuedBar === undefined || requeuedBar.kind !== 'run') throw new Error('E36B: the requeued Run must have a bar');
  expect(requeuedBar.attempt.requeue?.requestedAt).toBe('2026-10-14T11:00:00.000Z');
  expect(requeuedBar.attempt.requeue?.requestedAt).not.toBe('2026-10-14T11:10:00.000Z');
}, 60_000);
