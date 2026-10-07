/**
 * A.2 step 5.10: the Workflow selection skips non-active Tasks (lead decision L-15, §9 VD-11 and its §9.6
 * row "Workflow 选择（VD-11，L-15）"; C7, docs/refactor/STATE-MACHINES-SPEC.md §15.2 5.10) over controlled
 * owner doubles.
 *
 * - A cancelled or superseded required work Task carries no work: the Goal-level selection does not wait
 *   for it, and proposes the Goal completion once the rest is satisfied (`completion-policy.ts` skips it too).
 * - When only deferred required work is left, the selection waits with the prefix `required_task_deferred:`
 *   (the Goal shows GOAL-30 `required_task_deferred`); the gap text names the disposition first. With other
 *   unfinished required work as well, the wait is the plain gap.
 * - An explicit Task handle on a non-active Task: cancelled or superseded → `completed`, deferred →
 *   `waiting`, both with the prefix `task_not_active:`; a satisfied Task still answers first.
 *
 * Only `plans.queryGoal` and `plans.queryTaskGraph` answer; every other port throws if touched. The real
 * platform path is tests/scenarios/C7-supersede-failed-task.test.ts and C7-defer-reactivate.test.ts.
 */
import { expect, it } from 'vitest';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { WorkflowDependencies } from '../../src/business/workflow/ports.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { Disposition, Phase, RuntimeTask } from '../../src/contracts/plan.js';
import type { TaskRow } from '../../src/core/work-graph/tasks/plan-contracts.js';

const P = 'a2-l15-project', W = 'a2-l15-workspace', G = 'a2-l15-goal';
const actor = { kind: 'human' as const, id: 'a2-l15-operator' };
const ctx: CoreCallContext = { projectId: P, workspaceId: W, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId: P, workspaceId: W, actor }, signal: new AbortController().signal };
const goalRef = { aggregateType: 'Goal' as const, projectId: P, goalId: G };
const planRef = { aggregateType: 'PlanRevision' as const, projectId: P, planId: 'a2-l15-plan' };
const goal: GoalSnapshot = { ref: goalRef, workspaceRef: { aggregateType: 'Workspace', projectId: P, workspaceId: W },
  objective: 'A2 L-15', desiredState: 'active', activePlanRevision: planRef, revision: 4 } as GoalSnapshot;
const runRefOf = (taskId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId: `run-${taskId}` });

type Shape = { taskId: string; disposition?: Disposition; phase: Phase; kind?: 'work' | 'gate'; planOnly?: boolean };
function rowOf(shape: Shape): TaskRow {
  const kind = shape.kind ?? 'work';
  const definition: RuntimeTask = { taskId: shape.taskId, title: shape.taskId, requirementLevel: 'required', taskKind: kind,
    disposition: shape.disposition ?? 'active', phase: 'pending', scope: { kind: 'goal' },
    ...(kind === 'work' ? { executionIntent: shape.planOnly === true ? 'plan_only' as const : 'request_execution' as const } : {}) };
  return { ref: { projectId: P, goalId: G, taskId: shape.taskId }, definition, effectivePhase: shape.phase,
    disposition: definition.disposition, currentAttempt: null, execution: shape.phase === 'pending' || kind === 'gate' ? null : runRefOf(shape.taskId),
    eligibilityScope: 'task_state', eligibility: { eligible: false, reasons: [] } as never, relations: [], inputRequirements: [],
    legacyDependencies: [] };
}

/** Every port throws unless the test gives it an answer. */
function untouched<T extends object>(name: string): T {
  return new Proxy({}, { get: (_target, member) => () => { throw new Error(`${name}.${String(member)} must not be called`); } }) as T;
}
function workflowWith(shapes: Shape[]) {
  const rows = shapes.map(rowOf);
  const tasks = rows.map(row => row.definition);
  const deps: WorkflowDependencies = {
    tasks: untouched('tasks'), sessions: untouched('sessions'), executions: untouched('executions'), runtime: untouched('runtime'),
    evidence: untouched('evidence'), checks: untouched('checks'), sourceAuthority: untouched('sourceAuthority'),
    plans: { ...untouched<WorkflowDependencies['plans']>('plans'),
      queryGoal: async () => ({ status: 'ready', value: { goal } }) as never,
      queryTaskGraph: async () => ({ status: 'ready', value: { plan: { ref: planRef, tasks,
        assignments: tasks.filter(task => task.taskKind === 'work').map(task => ({ taskId: task.taskId, role: 'builder',
          instruction: 'work' })) }, tasks: rows } }) as never },
    claims: { claimTask: untouched<WorkflowDependencies['claims']>('claims').claimTask },
    configuration: { consumerId: 'a2-l15-consumer', bindings: [{ workspace: { projectId: P, workspaceId: W },
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 'builder', templateRevision: '1', bindingVersion: 1,
        policyRevision: 'p' }, budget: { tokenBudget: 1000, deadline: null } }] },
  };
  return createWorkflow(deps);
}
const selectWork = (taskId?: string): WorkflowAdvanceInput => ({ schemaVersion: 1, goalRef, flowId: 'a2-l15-flow',
  sessionHint: null, kind: 'select_work', ...(taskId === undefined ? {} : { taskId }) });
async function advance(shapes: Shape[], taskId?: string) {
  const result = await workflowWith(shapes).advanceWork(ctx, selectWork(taskId));
  if (result.status !== 'ready') throw new Error(`the Workflow refused: ${JSON.stringify(result)}`);
  return result.value;
}

const SATISFIED_GATE: Shape = { taskId: 'gate', kind: 'gate', phase: 'satisfied' };
const PENDING_GATE: Shape = { taskId: 'gate', kind: 'gate', phase: 'pending' };

it.each<[Disposition]>([['cancelled'], ['superseded']])('a %s required work Task is not waited for: the Goal completion is proposed', async (disposition) => {
  const value = await advance([{ taskId: 'work-1', disposition, phase: 'failed' }, { taskId: 'work-2', phase: 'satisfied' },
    SATISFIED_GATE]);
  expect(value).toMatchObject({ state: 'advance', receipt: null, next: { kind: 'perform', operation: { kind: 'complete_goal' } } });
});

it('only deferred required work is left: the wait says required_task_deferred and names the disposition first', async () => {
  const value = await advance([{ taskId: 'work-1', disposition: 'deferred', phase: 'failed' }, { taskId: 'work-2', phase: 'satisfied' },
    { taskId: 'work-3', disposition: 'superseded', phase: 'pending' }, PENDING_GATE]);
  expect(value).toMatchObject({ state: 'waiting', receipt: null, next: null });
  expect(value.reason).toMatch(/^required_task_deferred: required work cannot advance: work-1: deferred; gate: /);
  // The superseded Task carries no work, so the gap does not name it.
  expect(value.reason).not.toContain('work-3');
});

it('deferred work beside other unfinished required work: the plain gap, the deferred Task named with its disposition', async () => {
  const value = await advance([{ taskId: 'work-1', disposition: 'deferred', phase: 'pending' },
    { taskId: 'work-2', phase: 'pending', planOnly: true }, PENDING_GATE]);
  expect(value).toMatchObject({ state: 'waiting', next: null });
  expect(value.reason).toMatch(/^required work cannot advance: work-1: deferred; work-2: plan_only/);
});

it.each<[Disposition, 'completed' | 'waiting', RegExp]>([
  ['cancelled', 'completed', /^task_not_active: the selected Task work-1 is cancelled; it carries no work any more$/],
  ['superseded', 'completed', /^task_not_active: the selected Task work-1 is superseded; it carries no work any more$/],
  ['deferred', 'waiting', /^task_not_active: the selected Task work-1 is deferred; it waits until a plan change makes it active again$/],
])('an explicit handle on a %s Task: %s with task_not_active:', async (disposition, state, reason) => {
  const value = await advance([{ taskId: 'work-1', disposition, phase: 'failed' }, { taskId: 'work-2', phase: 'pending' }, PENDING_GATE],
    'work-1');
  expect(value).toMatchObject({ state, receipt: null, next: null });
  expect(value.reason).toMatch(reason);
});

it('a satisfied selected Task answers before its disposition', async () => {
  const value = await advance([{ taskId: 'work-1', disposition: 'cancelled', phase: 'satisfied' }, SATISFIED_GATE], 'work-1');
  expect(value).toMatchObject({ state: 'completed', reason: 'the selected Task work-1 is satisfied' });
});
