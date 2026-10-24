/**
 * A.2 step 5.8, part 2: which Goals the start-up re-drive selects by
 * condition (a) (docs/refactor/STATE-MACHINES-SPEC.md §12.1 step 6b, LA-6,
 * W-21, RUN-19; §15.2 5.8 "启动重驱的第二部分"), over controlled doubles of the
 * reconcile seam.
 *
 * - An active Goal is selected only for a required, `active` Task of its
 *   adopted Plan whose automation verdict is pending (`isPendingVerdict`:
 *   `requeue`, `reverify`, `claim_requeued`). An optional or deferred Task with
 *   a pending verdict, a stopped verdict and no verdict select nothing.
 * - An unreadable Task graph (a refusal or a throw) is a `problems` line and
 *   selects nothing; a Goal without an adopted Plan, and a Goal that is not
 *   active, are not read.
 *
 * Steps 1..6 find nothing to reconcile here (no Session, Run, round or queued
 * intent), so every port they would write through throws if touched. The real
 * Host path is the W-11 start-up re-drive case of tests/scenarios/A8-host-restart.test.ts.
 */
import { expect, it } from 'vitest';
import { runStartupReconcile, type StartupReconcilePlatform } from '../../src/app/startup-reconcile.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { Disposition, RuntimeTask } from '../../src/contracts/plan.js';
import type { TaskAutomationVerdictV1 } from '../../src/contracts/task-failure.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';

const P = 'a2-redrive-project', W = 'a2-redrive-workspace';
const scope = { projectId: P, workspaceId: W };
const actor = { kind: 'system' as const, id: 'a2-redrive-reconcile' };
const context = (): CoreCallContext => ({ projectId: P, workspaceId: W, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId: P, workspaceId: W, actor }, signal: new AbortController().signal });
const planRef = { aggregateType: 'PlanRevision' as const, projectId: P, planId: 'a2-redrive-plan', revision: 1 };
const goalRefOf = (goalId: string): GoalRef => ({ aggregateType: 'Goal', projectId: P, goalId });
function goalOf(goalId: string, over: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return { ref: goalRefOf(goalId), workspaceRef: { aggregateType: 'Workspace', projectId: P, workspaceId: W },
    objective: goalId, desiredState: 'active', desiredStateRevision: 1, desiredStateRequestedBy: null,
    activePlanRevision: planRef as never, revision: 3, since: 'c0000000001' as GoalSnapshot['since'], ...over };
}

const REQUEUE: TaskAutomationVerdictV1 = { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false };
const CLAIM: TaskAutomationVerdictV1 = { kind: 'claim_requeued', requeueRef: { aggregateType: 'TaskRequeue', projectId: P,
  goalId: 'a2-g1', taskId: 'req-claim', afterRunId: 'run-req-claim' }, budget: null };
const REVERIFY: TaskAutomationVerdictV1 = { kind: 'reverify', roundRef: { aggregateType: 'VerificationRound', projectId: P,
  roundId: 'a2-redrive-round' } as never, needsFinalize: false, onlyIfSourceChanged: false, failureClass: 'check_incomplete',
  retryAfterRefusal: false };
const CAPPED: TaskAutomationVerdictV1 = { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'requeue' } };

type Spec = { taskId: string; requirementLevel: 'required' | 'optional'; disposition: Disposition; verdict: TaskAutomationVerdictV1 | null };
/** The Task graph of one Goal: its adopted Plan's Tasks and their rows with the given verdicts. */
function graphOf(goalId: string, specs: readonly Spec[]) {
  const tasks = specs.map((spec): RuntimeTask => ({ taskId: spec.taskId, title: spec.taskId, requirementLevel: spec.requirementLevel,
    taskKind: 'work', disposition: spec.disposition, phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' }));
  const rows = specs.map(spec => ({ ref: { projectId: P, goalId, taskId: spec.taskId },
    ...(spec.verdict === null ? {} : { failure: { automation: { verdict: spec.verdict } } }) }) as unknown as TaskRow);
  return { status: 'ready', value: { plan: { ref: planRef, tasks, assignments: [] }, tasks: rows } };
}

/** Every port throws unless the test gives it an answer. */
function untouched<T extends object>(name: string): T {
  return new Proxy({}, { get: (_target, member) => () => { throw new Error(`${name}.${String(member)} must not be called`); } }) as T;
}
// An empty candidate scan.
const nothing = async () => ({ status: 'ready' as const, value: { records: [], damaged: [] } });

async function reconcile(goals: readonly GoalSnapshot[], graphs: Record<string, () => Promise<unknown>>) {
  const reads: string[] = [];
  const fanOuts: string[] = [];
  const platform: StartupReconcilePlatform = {
    sessions: { findSessions: async () => ({ status: 'ready', value: { items: [], nextCursor: null, sourceCursor: 'c-1' } }) as never },
    executions: untouched('executions'),
    controls: untouched('controls'),
    plans: { queryTaskGraph: async (_ctx, input) => {
      reads.push(input.goalRef.goalId);
      const answer = graphs[input.goalRef.goalId];
      if (answer === undefined) throw new Error(`the Task graph of ${input.goalRef.goalId} must not be read`);
      return await answer() as never;
    } },
    reconcile: { ...untouched<StartupReconcilePlatform['reconcile']>('reconcile'),
      // The L28 step-2b open-review scan is real production behavior: return an
      // empty page instead of letting the optional seam report "not wired".
      reviews: { listReviews: async () => ({ status: 'ready' as const, value: { items: [], nextCursor: null, readThrough: null } }) },
      candidates: {
      listRuns: nothing, listUnknownRuns: nothing, listQueuedControlRuns: nothing, listOpenRounds: nothing,
      listGoals: async () => ({ status: 'ready', value: { records: [...goals], damaged: [] } }),
    } },
  };
  const report = await runStartupReconcile({ platform, hostInstanceId: 'a2-redrive-host', scopes: [scope], context,
    fanOut: async (_ctx, goalRef) => {
      fanOuts.push(goalRef.goalId);
      return { goalRef, epoch: 2, control: 'pause', runs: [], problem: null } as never;
    } });
  return { report, reads, fanOuts };
}

it('§12.1 step 6b (a): only a required active Task with a pending verdict selects its Goal', async () => {
  const { report, reads } = await reconcile([goalOf('a2-g1'), goalOf('a2-g2')], {
    'a2-g1': async () => graphOf('a2-g1', [
      { taskId: 'req-requeue', requirementLevel: 'required', disposition: 'active', verdict: REQUEUE },
      { taskId: 'opt-requeue', requirementLevel: 'optional', disposition: 'active', verdict: REQUEUE },
      { taskId: 'deferred-requeue', requirementLevel: 'required', disposition: 'deferred', verdict: REQUEUE },
      { taskId: 'req-capped', requirementLevel: 'required', disposition: 'active', verdict: CAPPED },
      { taskId: 'req-none', requirementLevel: 'required', disposition: 'active', verdict: { kind: 'none' } },
      { taskId: 'req-unfailed', requirementLevel: 'required', disposition: 'active', verdict: null },
      { taskId: 'req-claim', requirementLevel: 'required', disposition: 'active', verdict: CLAIM },
      { taskId: 'req-reverify', requirementLevel: 'required', disposition: 'active', verdict: REVERIFY }]),
    // Pending verdicts only on an optional and a deferred Task: the Goal is not selected.
    'a2-g2': async () => graphOf('a2-g2', [
      { taskId: 'opt-requeue', requirementLevel: 'optional', disposition: 'active', verdict: REQUEUE },
      { taskId: 'deferred-claim', requirementLevel: 'required', disposition: 'deferred', verdict: CLAIM },
      { taskId: 'cancelled-requeue', requirementLevel: 'required', disposition: 'cancelled', verdict: REQUEUE }]),
  });
  expect(report.redriveGoals).toEqual([{ goalRef: goalRefOf('a2-g1'), scope, taskIds: ['req-requeue', 'req-claim', 'req-reverify'] }]);
  expect(report.problems).toEqual([]);
  expect(reads).toEqual(['a2-g1', 'a2-g2']);
});

it('§12.1 step 6b (a): an unreadable Task graph is a problem and selects nothing; a Goal without a Plan or not active is not read', async () => {
  const { report, reads, fanOuts } = await reconcile([
    goalOf('a2-g3'), goalOf('a2-g4'), goalOf('a2-g5', { activePlanRevision: null }),
    goalOf('a2-g6', { desiredState: 'paused', desiredStateRevision: 2 })], {
    'a2-g3': async () => ({ status: 'rejected', code: 'unavailable', reason: 'the ledger is gone' }),
    'a2-g4': async () => { throw new Error('the read failed'); },
  });
  expect(report.redriveGoals).toEqual([]);
  expect(report.problems).toEqual([
    'a2-g3: the Task facts are not readable for the start-up re-drive (unavailable: the ledger is gone)',
    'a2-g4: the Task facts are not readable for the start-up re-drive (the read failed)']);
  expect(reads).toEqual(['a2-g3', 'a2-g4']);
  // Step 6 runs the paused Goal's fan-out pass; step 6b does not select it.
  expect(fanOuts).toEqual(['a2-g6']);
});
