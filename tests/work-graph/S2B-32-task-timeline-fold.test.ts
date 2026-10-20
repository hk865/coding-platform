/**
 * Slice 2B row 2B-32 (entry BE4): the task-state timeline's other outcomes and
 * folding rules from L11. Each case is its own assertion; every expected value
 * is hand-written from L11.
 *
 * Runs on both real backends (memory and SQLite), like the sibling read tests.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import {
  openS2BTimelineFixture, S2B_SLOW_TIMEOUT_MS, type S2BTimelineFixture,
} from '../helpers/S2B-task-timeline-fixture.js';

type DraftEdit = (draft: PlanRevisionDraft) => PlanRevisionDraft;

function reTitleFor(taskId: string, title: string): DraftEdit {
  return draft => ({ ...draft, tasks: draft.tasks.map(task => task.taskId === taskId ? { ...task, title } : task) });
}
function dispositionFor(taskId: string, disposition: 'active' | 'deferred' | 'cancelled' | 'superseded'): DraftEdit {
  return draft => ({
    ...draft,
    tasks: draft.tasks.map(task => task.taskId === taskId
      ? { ...task, disposition, ...(disposition === 'superseded' ? { replacedByTaskId: null } : {}) }
      : task),
  });
}

function spans(segments: { from: string | null; to: string | null; state: string }[]): (string | null)[][] {
  return segments.map(segment => [segment.from, segment.to, segment.state]);
}

describe.each(['memory', 'sqlite'] as const)('S2B-32 task-state timeline fold (%s)', (kind) => {
  let fixture: S2BTimelineFixture | null = null;
  afterEach(async () => {
    if (fixture !== null) await fixture.close();
    fixture = null;
  });

  async function open(): Promise<S2BTimelineFixture> {
    const opened = await openS2BTimelineFixture(kind);
    fixture = opened;
    return opened;
  }

  async function taskSegments(fx: S2BTimelineFixture, goalRef: GoalRef, taskId: string) {
    const read = await fx.timeline({ goalRef, limit: 200 });
    if (read.status !== 'ready') throw new Error(`timeline not ready: ${JSON.stringify(read)}`);
    const task = read.value.tasks.find(candidate => candidate.taskId === taskId);
    if (task === undefined) throw new Error(`task ${taskId} is not in the page`);
    return task.segments;
  }

  it('2B-32 yielded: waiting_reply until the next Run starts', async () => {
    const fx = await open();
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-32-yielded', workTaskIds: ['work-1', 'work-2'] });
    await fx.seedYieldedPair({
      goalRef, yieldTaskId: 'work-1', replyTaskId: 'work-2',
      yieldStartedAt: '2026-10-01T10:00:00.000Z', yieldedAt: '2026-10-01T10:30:00.000Z',
      replyStartedAt: '2026-10-01T10:35:00.000Z', replyEndedAt: '2026-10-01T10:40:00.000Z',
      resumeStartedAt: '2026-10-01T11:00:00.000Z', resumeEndedAt: '2026-10-01T11:10:00.000Z',
    });
    expect(spans(await taskSegments(fx, goalRef, 'work-1'))).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan'],
      ['2026-10-01T09:00:00.000Z', '2026-10-01T10:00:00.000Z', 'pending'],
      ['2026-10-01T10:00:00.000Z', '2026-10-01T10:30:00.000Z', 'running'],
      ['2026-10-01T10:30:00.000Z', '2026-10-01T11:00:00.000Z', 'waiting_reply'],
      ['2026-10-01T11:00:00.000Z', '2026-10-01T11:10:00.000Z', 'running'],
      ['2026-10-01T11:10:00.000Z', null, 'awaiting_check'],
    ]);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-32 pause during the Run: [observed pause, observed resume) is paused', async () => {
    const fx = await open();
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-32-pause', workTaskIds: ['work-1'] });
    const planRef = (await fx.activePlanRef(goalRef))!;
    const run = await fx.seedRun({ goalRef, runId: 'run-1', taskId: 'work-1', planRef,
      startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T11:00:00.000Z', outcome: 'completed' });
    await fx.seedControl({ runRef: run, kind: 'pause', observedAt: '2026-10-01T10:20:05.000Z' });
    await fx.seedControl({ runRef: run, kind: 'resume', observedAt: '2026-10-01T10:50:03.000Z' });
    expect(spans(await taskSegments(fx, goalRef, 'work-1'))).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan'],
      ['2026-10-01T09:00:00.000Z', '2026-10-01T10:00:00.000Z', 'pending'],
      ['2026-10-01T10:00:00.000Z', '2026-10-01T10:20:05.000Z', 'running'],
      ['2026-10-01T10:20:05.000Z', '2026-10-01T10:50:03.000Z', 'paused'],
      ['2026-10-01T10:50:03.000Z', '2026-10-01T11:00:00.000Z', 'running'],
      ['2026-10-01T11:00:00.000Z', null, 'awaiting_check'],
    ]);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-32 RUN-24: paused crash, resume requeue at the continue instant -> pending, then running', async () => {
    const fx = await open();
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-32-run24', workTaskIds: ['work-1'] });
    const planRef = (await fx.activePlanRef(goalRef))!;
    const run1 = await fx.seedRun({ goalRef, runId: 'run-1', taskId: 'work-1', planRef,
      startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:30:00.000Z', outcome: 'crashed',
      pausedInterrupted: true });
    await fx.seedRequeue({ runRef: run1, requestedAt: '2026-10-01T10:40:00.000Z' });
    await fx.seedRun({ goalRef, runId: 'run-2', taskId: 'work-1', planRef,
      startedAt: '2026-10-01T10:50:00.000Z', endedAt: '2026-10-01T11:00:00.000Z', outcome: 'completed' });
    expect(spans(await taskSegments(fx, goalRef, 'work-1'))).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan'],
      ['2026-10-01T09:00:00.000Z', '2026-10-01T10:00:00.000Z', 'pending'],
      ['2026-10-01T10:00:00.000Z', '2026-10-01T10:30:00.000Z', 'running'],
      ['2026-10-01T10:30:00.000Z', '2026-10-01T10:40:00.000Z', 'paused'],
      ['2026-10-01T10:40:00.000Z', '2026-10-01T10:50:00.000Z', 'pending'],
      ['2026-10-01T10:50:00.000Z', '2026-10-01T11:00:00.000Z', 'running'],
      ['2026-10-01T11:00:00.000Z', null, 'awaiting_check'],
    ]);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-32 outcome_unknown, cancelled and budget_exhausted map to their own states', async () => {
    const fx = await open();
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-32-outcomes',
      workTaskIds: ['unknown-task', 'cancel-task', 'budget-task'] });
    const planRef = (await fx.activePlanRef(goalRef))!;
    await fx.seedRun({ goalRef, runId: 'run-u', taskId: 'unknown-task', planRef,
      startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:30:00.000Z', outcome: 'outcome_unknown' });
    await fx.seedRun({ goalRef, runId: 'run-c', taskId: 'cancel-task', planRef,
      startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:30:00.000Z', outcome: 'cancelled' });
    await fx.seedRun({ goalRef, runId: 'run-b', taskId: 'budget-task', planRef,
      startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:30:00.000Z', outcome: 'budget_exhausted' });
    expect(spans(await taskSegments(fx, goalRef, 'unknown-task')).at(-1))
      .toEqual(['2026-10-01T10:30:00.000Z', null, 'outcome_unknown']);
    expect(spans(await taskSegments(fx, goalRef, 'cancel-task')).at(-1))
      .toEqual(['2026-10-01T10:30:00.000Z', null, 'run_cancelled']);
    expect(spans(await taskSegments(fx, goalRef, 'budget-task')).at(-1))
      .toEqual(['2026-10-01T10:30:00.000Z', null, 'run_failed']);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-32 plan dispositions: defer, cancel and supersede at each adoption instant', async () => {
    const fx = await open();
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-32-dispositions', workTaskIds: ['a', 'b', 'c', 'keep-alive'] });
    await fx.adoptVersion({ goalRef, planId: 's2b-32-dispositions-v2', at: '2026-10-01T10:00:00.000Z',
      affectedTaskIds: ['a'], edit: dispositionFor('a', 'deferred') });
    await fx.adoptVersion({ goalRef, planId: 's2b-32-dispositions-v3', at: '2026-10-01T11:00:00.000Z',
      affectedTaskIds: ['b'], edit: dispositionFor('b', 'cancelled') });
    await fx.adoptVersion({ goalRef, planId: 's2b-32-dispositions-v4', at: '2026-10-01T12:00:00.000Z',
      affectedTaskIds: ['c'], edit: dispositionFor('c', 'superseded') });
    expect(spans(await taskSegments(fx, goalRef, 'a'))).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan'],
      ['2026-10-01T09:00:00.000Z', '2026-10-01T10:00:00.000Z', 'pending'],
      ['2026-10-01T10:00:00.000Z', null, 'deferred'],
    ]);
    expect(spans(await taskSegments(fx, goalRef, 'b'))).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan'],
      ['2026-10-01T09:00:00.000Z', '2026-10-01T11:00:00.000Z', 'pending'],
      ['2026-10-01T11:00:00.000Z', null, 'cancelled'],
    ]);
    expect(spans(await taskSegments(fx, goalRef, 'c'))).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan'],
      ['2026-10-01T09:00:00.000Z', '2026-10-01T12:00:00.000Z', 'pending'],
      ['2026-10-01T12:00:00.000Z', null, 'superseded'],
    ]);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-32 a Task present in v1 and redefined in v4 still appears from v1', async () => {
    const fx = await open();
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-32-redefine', workTaskIds: ['stable'] });
    await fx.adoptVersion({ goalRef, planId: 's2b-32-redefine-v2', at: '2026-10-01T10:00:00.000Z',
      edit: reTitleFor('stable', 'stable v2') });
    await fx.adoptVersion({ goalRef, planId: 's2b-32-redefine-v3', at: '2026-10-01T11:00:00.000Z',
      edit: reTitleFor('stable', 'stable v3') });
    await fx.adoptVersion({ goalRef, planId: 's2b-32-redefine-v4', at: '2026-10-01T12:00:00.000Z',
      edit: reTitleFor('stable', 'stable v4') });
    const segments = await taskSegments(fx, goalRef, 'stable');
    expect(segments[0]).toMatchObject({ from: null, to: '2026-10-01T09:00:00.000Z', state: 'not_in_plan' });
    expect(segments[1]).toMatchObject({ from: '2026-10-01T09:00:00.000Z', to: null, state: 'pending',
      point: { kind: 'plan_appear', at: '2026-10-01T09:00:00.000Z' } });
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-32 v3 defers and v5 reactivates: deferred from v3, pending from v5', async () => {
    const fx = await open();
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-32-toggle', workTaskIds: ['toggle', 'keep-alive'] });
    await fx.adoptVersion({ goalRef, planId: 's2b-32-toggle-v2', at: '2026-10-01T10:00:00.000Z',
      edit: reTitleFor('toggle', 'toggle v2') });
    await fx.adoptVersion({ goalRef, planId: 's2b-32-toggle-v3', at: '2026-10-01T11:00:00.000Z',
      affectedTaskIds: ['toggle'], edit: dispositionFor('toggle', 'deferred') });
    await fx.adoptVersion({ goalRef, planId: 's2b-32-toggle-v4', at: '2026-10-01T11:30:00.000Z',
      edit: reTitleFor('toggle', 'toggle v4') });
    await fx.adoptVersion({ goalRef, planId: 's2b-32-toggle-v5', at: '2026-10-01T12:00:00.000Z',
      affectedTaskIds: ['toggle'], edit: dispositionFor('toggle', 'active') });
    expect(spans(await taskSegments(fx, goalRef, 'toggle'))).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan'],
      ['2026-10-01T09:00:00.000Z', '2026-10-01T11:00:00.000Z', 'pending'],
      ['2026-10-01T11:00:00.000Z', '2026-10-01T12:00:00.000Z', 'deferred'],
      ['2026-10-01T12:00:00.000Z', null, 'pending'],
    ]);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-32 a never-executed Task is not_in_plan then pending at its plan instant', async () => {
    const fx = await open();
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-32-idle', workTaskIds: ['idle'] });
    expect(spans(await taskSegments(fx, goalRef, 'idle'))).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan'],
      ['2026-10-01T09:00:00.000Z', null, 'pending'],
    ]);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-32 a round finalized INCONCLUSIVE with no evidence ends verifying', async () => {
    const fx = await open();
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-32-inconclusive', workTaskIds: ['work-1'] });
    const planRef = (await fx.activePlanRef(goalRef))!;
    const run = await fx.seedRun({ goalRef, runId: 'run-1', taskId: 'work-1', planRef,
      startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:30:00.000Z', outcome: 'completed' });
    await fx.seedRound({ runRef: run, roundId: 'round-1', sinceAt: '2026-10-01T10:31:00.000Z',
      finalizedAt: '2026-10-01T10:35:00.000Z', outcome: 'INCONCLUSIVE' });
    expect(spans(await taskSegments(fx, goalRef, 'work-1'))).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan'],
      ['2026-10-01T09:00:00.000Z', '2026-10-01T10:00:00.000Z', 'pending'],
      ['2026-10-01T10:00:00.000Z', '2026-10-01T10:30:00.000Z', 'running'],
      ['2026-10-01T10:30:00.000Z', '2026-10-01T10:31:00.000Z', 'awaiting_check'],
      ['2026-10-01T10:31:00.000Z', '2026-10-01T10:35:00.000Z', 'verifying'],
      ['2026-10-01T10:35:00.000Z', null, 'check_incomplete'],
    ]);
  }, S2B_SLOW_TIMEOUT_MS);

  it('2B-32 fold order (b): the requeue after an anomaly does not clear interrupted_pending_check', async () => {
    const fx = await open();
    fx.setClock('2026-10-01T09:00:00.000Z');
    const goalRef = await fx.createGoal({ goalId: 's2b-32-fold-b', workTaskIds: ['work-1'] });
    const planRef = (await fx.activePlanRef(goalRef))!;
    const run1 = await fx.seedRun({ goalRef, runId: 'run-1', taskId: 'work-1', planRef,
      startedAt: '2026-10-01T09:59:00.000Z', endedAt: '2026-10-01T10:00:00.000Z', outcome: 'crashed' });
    await fx.seedAnomaly({ runRef: run1, recordedAt: '2026-10-01T10:01:00.000Z' });
    await fx.seedRequeue({ runRef: run1, requestedAt: '2026-10-01T10:02:00.000Z' });
    await fx.seedRun({ goalRef, runId: 'run-2', taskId: 'work-1', planRef,
      startedAt: '2026-10-01T10:30:00.000Z', endedAt: null, outcome: null, status: 'running' });
    const segments = spans(await taskSegments(fx, goalRef, 'work-1'));
    expect(segments).toEqual([
      [null, '2026-10-01T09:00:00.000Z', 'not_in_plan'],
      ['2026-10-01T09:00:00.000Z', '2026-10-01T09:59:00.000Z', 'pending'],
      ['2026-10-01T09:59:00.000Z', '2026-10-01T10:00:00.000Z', 'running'],
      ['2026-10-01T10:00:00.000Z', '2026-10-01T10:01:00.000Z', 'interrupted'],
      ['2026-10-01T10:01:00.000Z', '2026-10-01T10:30:00.000Z', 'interrupted_pending_check'],
      ['2026-10-01T10:30:00.000Z', null, 'running'],
    ]);
    expect(segments.some(segment => segment[0] === '2026-10-01T10:02:00.000Z')).toBe(false);
  }, S2B_SLOW_TIMEOUT_MS);
});
