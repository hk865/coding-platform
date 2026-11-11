/**
 * KLS-2a-1, lead ruling F7 / Codex review 2 (RL-24): a Task claim that hits a revision conflict selects once more on
 * what is there now; a second conflict waits with a basis that covers the records a claim really pins (the Goal, the
 * Workspace and the Session), so a later change of any of them wakes the Goal.
 *
 * Real Host over HTTP (the scenario harness); the commit barrier only holds the re-selected claim's own commit, and
 * the Goal changes are the public `goals/settings/set`. Scripted model, no Run starts.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { readGoal } from '../helpers/A2-restart-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { cleanupScenarios, openHostScenario, performs, type HostScenario } from './harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

afterEach(async () => {
  commitBarrier.reset();
  await cleanupScenarios();
});

/** One real Goal write (its settings, written back unchanged): the Goal's revision moves. */
async function moveGoal(h: HostScenario, requestId: string): Promise<void> {
  const goal = await readGoal(h.host);
  const set = await h.post<WriteResult<GoalSnapshot>>('goals/settings/set', graphWrite(AG2B_SCOPE, {
    goalRef: AG2B_GOAL_REF, autonomy: goal.settings.autonomy, waitForGoalRef: goal.settings.waitForGoalRef,
  }, requestId, [{ ref: AG2B_GOAL_REF, revision: goal.revision }]));
  expect(set, requestId).toMatchObject({ status: 'committed', value: { revision: goal.revision + 1 } });
}

it('KLS2A1 claim: a claim whose Goal moves before it and again under the re-selected claim waits on Goal, Workspace and Session', async () => {
  const h = await openHostScenario({ script: { replies: [] } });
  const toClaim = await h.advance(h.select('kls2a1-claim'), { stopBefore: performs('claim_task') });
  expect(toClaim.state).toBe('stopped');
  // 1. The Goal moves after the selection read it: the first claim conflicts on its Goal pin.
  await moveGoal(h, 'kls2a1-claim-goal-1');
  // 2. The re-selection claims again; its commit is held, the Goal moves once more, then the commit runs.
  const held = commitBarrier.hold(commit => commit.records.some(record =>
    record.refKey.includes('"aggregateType":"TaskLease"')), 'the re-selected claim commit');
  const driving = h.advance(toClaim.next!, { maxSteps: 1 });
  await held.reached;
  await moveGoal(h, 'kls2a1-claim-goal-2');
  held.release();
  const driven = await driving;
  expect(driven.state).toBe('waiting');
  const last = driven.steps.at(-1)!;
  expect(last.receipt).toMatchObject({ kind: 'claim_task', result: { status: 'rejected', code: 'revision_conflict' } });
  // The wait names the claim's real pins, so a later Goal (or Workspace) change wakes it, not only a Session change.
  expect(last.waitBasis?.recordKinds).toEqual(expect.arrayContaining(['Goal', 'Workspace', 'Session']));
  expect(last.waitBasis).toMatchObject({ projectId: AG2B_GOAL_REF.projectId, goalId: AG2B_GOAL_REF.goalId });
});
