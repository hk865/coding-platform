/**
 * Slice 2B row 2B-31 (entry BE4): the task-state timeline main example, exactly
 * L11's hand-written worked example. Assertions go only through the public
 * `readTaskStateTimeline`.
 *
 * Runs on both real backends (memory and SQLite), like the sibling read tests.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  openS2BTimelineFixture, S2B_SLOW_TIMEOUT_MS, type S2BTimelineFixture,
} from '../helpers/S2B-task-timeline-fixture.js';

describe.each(['memory', 'sqlite'] as const)('S2B-31 task-state timeline main (%s)', (kind) => {
  let fixture: S2BTimelineFixture | null = null;
  afterEach(async () => {
    if (fixture !== null) await fixture.close();
    fixture = null;
  });

  it('2B-31 task-state timeline main example: L11 segments plan/run/check/requeue/run/check', async () => {
    fixture = await openS2BTimelineFixture(kind);
    fixture.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fixture.createGoal({ goalId: 's2b-31-goal', workTaskIds: ['work-1'] });
    const planRef = await fixture.activePlanRef(goalRef);
    if (planRef === null) throw new Error('the initial Plan must be active');

    const run1 = await fixture.seedRun({ goalRef, runId: 'run-1', taskId: 'work-1', planRef,
      startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:30:00.000Z', outcome: 'completed' });
    await fixture.seedRound({ runRef: run1, roundId: 'round-1', sinceAt: '2026-10-01T10:31:00.000Z',
      finalizedAt: '2026-10-01T10:40:00.000Z', outcome: 'FAIL' });
    await fixture.seedRequeue({ runRef: run1, requestedAt: '2026-10-01T10:41:00.000Z' });
    const run2 = await fixture.seedRun({ goalRef, runId: 'run-2', taskId: 'work-1', planRef,
      startedAt: '2026-10-01T11:00:00.000Z', endedAt: '2026-10-01T11:20:00.000Z', outcome: 'completed' });
    await fixture.seedRound({ runRef: run2, roundId: 'round-2', sinceAt: '2026-10-01T11:21:00.000Z',
      finalizedAt: '2026-10-01T11:30:00.000Z', outcome: 'PASS' });

    const read = await fixture.timeline({ goalRef, limit: 200 }, undefined);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const task = read.value.tasks.find(candidate => candidate.taskId === 'work-1');
    expect(task).toBeDefined();
    if (task === undefined) return;
    expect(task.segments.map(segment => [segment.from, segment.to, segment.state, segment.point?.kind ?? null])).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan', null],
      ['2026-10-01T09:00:00.000Z', '2026-10-01T10:00:00.000Z', 'pending', 'plan_appear'],
      ['2026-10-01T10:00:00.000Z', '2026-10-01T10:30:00.000Z', 'running', 'run_start'],
      ['2026-10-01T10:30:00.000Z', '2026-10-01T10:31:00.000Z', 'awaiting_check', 'run_end'],
      ['2026-10-01T10:31:00.000Z', '2026-10-01T10:40:00.000Z', 'verifying', 'check_start'],
      ['2026-10-01T10:40:00.000Z', '2026-10-01T10:41:00.000Z', 'check_failed', 'check_end'],
      ['2026-10-01T10:41:00.000Z', '2026-10-01T11:00:00.000Z', 'pending', 'requeue'],
      ['2026-10-01T11:00:00.000Z', '2026-10-01T11:20:00.000Z', 'running', 'run_start'],
      ['2026-10-01T11:20:00.000Z', '2026-10-01T11:21:00.000Z', 'awaiting_check', 'run_end'],
      ['2026-10-01T11:21:00.000Z', '2026-10-01T11:30:00.000Z', 'verifying', 'check_start'],
      ['2026-10-01T11:30:00.000Z', null, 'satisfied', 'check_end'],
    ]);
    expect(task.untimedPoints).toEqual([]);
    expect(read.value.approximate).toBe(true);
  }, S2B_SLOW_TIMEOUT_MS);
});
