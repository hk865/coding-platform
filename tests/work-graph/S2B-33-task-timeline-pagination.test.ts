/**
 * Slice 2B row 2B-33 (entry BE4): task-timeline pagination and honesty — the
 * current-Plan order, 1–200 limits, `source_stale`, finished/cancelled Goals,
 * `approximate`, the untimed points (no invented times), and the L17 read cap.
 *
 * Runs on both real backends (memory and SQLite), like the sibling read tests.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  openS2BTimelineFixture, S2B_SLOW_TIMEOUT_MS, type S2BTimelineFixture,
} from '../helpers/S2B-task-timeline-fixture.js';

describe.each(['memory', 'sqlite'] as const)('S2B-33 task-state timeline pagination (%s)', (kind) => {
  let fixture: S2BTimelineFixture | null = null;
  afterEach(async () => {
    if (fixture !== null) await fixture.close();
    fixture = null;
  });

  it('2B-33 pagination: limit 2 walks 5 Tasks in the current Plan order, each once', async () => {
    const fx = await openS2BTimelineFixture(kind);
    fixture = fx;
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-33-pages', workTaskIds: ['t1', 't2', 't3', 't4'] });
    const page1 = await fx.timeline({ goalRef, limit: 2 });
    expect(page1.status).toBe('ready');
    if (page1.status !== 'ready') return;
    expect(page1.value.tasks.map(task => task.taskId)).toEqual(['t1', 't2']);
    expect(page1.value.next).not.toBeNull();
    const page2 = await fx.timeline({ goalRef, cursor: page1.value.next, limit: 2 });
    expect(page2.status).toBe('ready');
    if (page2.status !== 'ready') return;
    expect(page2.value.tasks.map(task => task.taskId)).toEqual(['t3', 't4']);
    expect(page2.value.next).not.toBeNull();
    const page3 = await fx.timeline({ goalRef, cursor: page2.value.next, limit: 2 });
    expect(page3.status).toBe('ready');
    if (page3.status !== 'ready') return;
    expect(page3.value.tasks.map(task => task.taskId)).toEqual(['gate-1']);
    expect(page3.value.next).toBeNull();
    expect([...page1.value.tasks, ...page2.value.tasks, ...page3.value.tasks].map(task => task.taskId))
      .toEqual(['t1', 't2', 't3', 't4', 'gate-1']);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-33 limit 0 and 201 are invalid', async () => {
    const fx = await openS2BTimelineFixture(kind);
    fixture = fx;
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-33-limits', workTaskIds: ['t1'] });
    const zero = await fx.timeline({ goalRef, limit: 0 });
    expect(zero).toMatchObject({ status: 'rejected', code: 'invalid' });
    const tooMany = await fx.timeline({ goalRef, limit: 201 });
    expect(tooMany).toMatchObject({ status: 'rejected', code: 'invalid' });
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-33 a changed current Plan between pages is source_stale', async () => {
    const fx = await openS2BTimelineFixture(kind);
    fixture = fx;
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-33-stale', workTaskIds: ['t1', 't2', 't3'] });
    const page1 = await fx.timeline({ goalRef, limit: 2 });
    expect(page1.status).toBe('ready');
    if (page1.status !== 'ready') return;
    await fx.adoptVersion({ goalRef, planId: 's2b-33-stale-v2', at: '2026-10-01T10:00:00.000Z',
      edit: draft => ({ ...draft, tasks: draft.tasks.map(task => task.taskId === 't1' ? { ...task, title: 't1 v2' } : task) }) });
    const page2 = await fx.timeline({ goalRef, cursor: page1.value.next, limit: 2 });
    expect(page2).toMatchObject({ status: 'rejected', code: 'source_stale' });
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-33 a cancelled Goal is still readable', async () => {
    const fx = await openS2BTimelineFixture(kind);
    fixture = fx;
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-33-cancelled-goal', workTaskIds: ['t1'] });
    await fx.setGoalDesiredState(goalRef, 'cancelled');
    const read = await fx.timeline({ goalRef, limit: 200 });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.tasks.map(task => task.taskId)).toEqual(['t1', 'gate-1']);
    expect(read.value.approximate).toBe(true);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-33 a Run with an empty startedAt goes to untimedPoints with no invented time', async () => {
    const fx = await openS2BTimelineFixture(kind);
    fixture = fx;
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-33-untimed-run', workTaskIds: ['t1'] });
    const planRef = (await fx.activePlanRef(goalRef))!;
    await fx.seedRun({ goalRef, runId: 'run-1', taskId: 't1', planRef,
      startedAt: null, endedAt: null, outcome: null, status: 'starting' });
    const read = await fx.timeline({ goalRef, limit: 200 });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const task = read.value.tasks.find(candidate => candidate.taskId === 't1');
    expect(task?.untimedPoints.map(point => point.kind)).toEqual(['run_start']);
    expect(task?.segments.map(segment => segment.state)).toEqual(['not_in_plan', 'pending']);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-33 a pre-2B finalized round puts check_start and check_end in untimedPoints with no verifying segment', async () => {
    const fx = await openS2BTimelineFixture(kind);
    fixture = fx;
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-33-legacy-round', workTaskIds: ['t1'] });
    const planRef = (await fx.activePlanRef(goalRef))!;
    const run = await fx.seedRun({ goalRef, runId: 'run-1', taskId: 't1', planRef,
      startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:30:00.000Z', outcome: 'completed' });
    // 2B-before finalized round: no `since`, no `finalizedAt`, but a stored outcome.
    await fx.seedRound({ runRef: run, roundId: 'round-legacy', status: 'finalized', outcome: 'INCONCLUSIVE' });
    // A legacy round without `since`, still open.
    await fx.seedRound({ runRef: run, roundId: 'round-open', status: 'open', outcome: null });
    const read = await fx.timeline({ goalRef, limit: 200 });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const task = read.value.tasks.find(candidate => candidate.taskId === 't1');
    expect(task?.untimedPoints.map(point => point.kind)).toEqual(['check_start', 'check_start', 'check_end']);
    expect(task?.segments.some(segment => segment.state === 'verifying')).toBe(false);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-33 (L17) a keyed-read miss counts once against the read cap and capacity names the window/cap', async () => {
    const fx = await openS2BTimelineFixture(kind);
    fixture = fx;
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-33-cap', workTaskIds: ['t1'] });
    const planRef = (await fx.activePlanRef(goalRef))!;
    // One ended Run and no requeue: the per-Run keyed requeue read is a miss.
    await fx.seedRun({ goalRef, runId: 'run-1', taskId: 't1', planRef,
      startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:30:00.000Z', outcome: 'completed' });
    // Reads: Goal 1 + Plan revisions 1 + Runs by task 1 + the keyed requeue miss 1 = 4.
    const read = await fx.timeline({ goalRef, limit: 200 }, { readRecordCap: 3 });
    expect(read).toMatchObject({ status: 'rejected', code: 'capacity' });
    if (read.status !== 'rejected') return;
    expect(read.reason).toContain('s2b-33-cap');
    expect(read.reason).toContain('cap of 3');
  }, S2B_SLOW_TIMEOUT_MS);
});
