/**
 * Slice 1 §4.3 / §5.2 UT36–UT41: the frozen pure soft-ordering algorithm
 * `orderTasksByDependency`.
 *
 * It builds the upstream→downstream edges from the real
 * `executionDag.dependsOn` only and runs a stable Kahn topological sort whose
 * ready-set tie-break is (required first, original plan array position,
 * taskId). It only changes the selection order: it adds no upstream-satisfied
 * gate, and an upstream that cannot execute never blocks a downstream candidate.
 * A cycle (already invalid for a real plan) is appended defensively with the
 * same stable key and never loops. UT39 additionally drives the real Workflow
 * `selectNext` to prove a non-executable upstream never blocks a downstream
 * candidate.
 */
import { describe, expect, it } from 'vitest';
import type { Phase, RuntimeExecutionDAG, RuntimeTask } from '../../src/contracts/plan.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { WorkflowDependencies } from '../../src/business/workflow/ports.js';
import { orderTasksByDependency } from '../../src/business/workflow/task-order.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';

type Edge = RuntimeExecutionDAG['dependsOn'][number];

/** Minimal visible fixture: only taskId/requirementLevel/disposition are real. */
function task(taskId: string, requirementLevel: 'required' | 'optional'): RuntimeTask {
  return { taskId, requirementLevel, disposition: 'active' } as unknown as RuntimeTask;
}

/** `taskId` depends on `dependsOnId` (arrow points from prerequisite to dependent). */
function edge(taskId: string, dependsOnId: string): Edge {
  return { taskId, dependsOnId, requires: { kind: 'output-contract', label: `${dependsOnId} output contract` } };
}

const ids = (tasks: readonly RuntimeTask[]): string[] => tasks.map((entry) => entry.taskId);

// -------------------------------------------------------------------------- //
// UT39 also reaches the Workflow's `selectNext`: a controlled-double Workflow  //
// whose only real answers are the adopted Plan/Goal, the reusable Session and   //
// the workspace pin. Every other port throws if touched.                      //
// -------------------------------------------------------------------------- //

const ORDER_PROJECT = 's1-order-project';
const ORDER_WORKSPACE = 's1-order-workspace';
const ORDER_GOAL = 's1-order-goal';
const ORDER_PLAN_REF = { aggregateType: 'PlanRevision' as const, projectId: ORDER_PROJECT, planId: 's1-order-plan' };
const ORDER_SESSION = { projectId: ORDER_PROJECT, sessionId: 's1-order-session' };
const ORDER_ROLE = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };

function orderContext(): CoreCallContext {
  const actor = { kind: 'human' as const, id: 's1-order-operator' };
  return { projectId: ORDER_PROJECT, workspaceId: ORDER_WORKSPACE, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: ORDER_PROJECT, workspaceId: ORDER_WORKSPACE, actor },
    signal: new AbortController().signal };
}

/** Only two facts matter here: the Task id and whether it can execute at all. */
function orderRow(taskId: string, eligible: boolean): TaskRow {
  const definition: RuntimeTask = { taskId, title: taskId, requirementLevel: 'required', taskKind: 'work',
    disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' };
  return { ref: { projectId: ORDER_PROJECT, goalId: ORDER_GOAL, taskId }, definition,
    effectivePhase: 'ready' as Phase, disposition: 'active', currentAttempt: null, execution: null,
    eligibilityScope: 'task_state', eligibility: { eligible, reasons: [] } as never,
    relations: [], inputRequirements: [], legacyDependencies: [] };
}

function untouched<T extends object>(name: string): T {
  return new Proxy({}, { get: (_target, member) => () => { throw new Error(`${name}.${String(member)} must not be called`); } }) as T;
}

/** Return the Task id the real `selectNext` proposes to claim, or null. */
async function selectNextTask(
  rows: readonly TaskRow[], dependsOn: RuntimeExecutionDAG['dependsOn'],
): Promise<string | null> {
  const goal: GoalSnapshot = { ref: { aggregateType: 'Goal', projectId: ORDER_PROJECT, goalId: ORDER_GOAL },
    workspaceRef: { aggregateType: 'Workspace', projectId: ORDER_PROJECT, workspaceId: ORDER_WORKSPACE },
    objective: 'UT39', desiredState: 'active', desiredStateRevision: 1, desiredStateRequestedBy: null,
    activePlanRevision: ORDER_PLAN_REF, revision: 1,
    settings: { schemaVersion: 1, autonomy: 'after_plan_confirmation', order: 0, waitForGoalRef: null, parallelRisks: [] },
    continuedFrom: null, copiedInterventions: [], since: 'c0000000001' } as unknown as GoalSnapshot;
  const plan = { ref: ORDER_PLAN_REF, tasks: rows.map((row) => row.definition),
    assignments: rows.map((row) => ({ taskId: row.definition.taskId, role: 'builder', instruction: 'work' })),
    executionDag: { dependsOn } };
  const deps: WorkflowDependencies = {
    tasks: untouched('tasks'), sessions: { ...untouched<WorkflowDependencies['sessions']>('sessions'),
      readSession: async () => ({ status: 'ready', value: { record: {
        ref: { aggregateType: 'Session' as const, ...ORDER_SESSION }, revision: 1,
        kernel: { adapterId: 's1-order-adapter', kernelSessionId: 'kernel-s1-order' },
        lifecycle: 'active', health: 'available', healthConclusion: null, role: ORDER_ROLE,
        workspaceId: ORDER_WORKSPACE, lastExecutionRef: null, occupancy: null, historyCursor: null,
        createdAt: '2026-10-08T00:00:00.000Z', archivedAt: null },
      links: [], recommendationReasons: [] } }) as never },
    executions: untouched('executions'), runtime: untouched('runtime'), evidence: untouched('evidence'),
    checks: untouched('checks'), sourceAuthority: { ...untouched<WorkflowDependencies['sourceAuthority']>('sourceAuthority'),
      load: async () => ({ status: 'found', snapshot: {
        ref: { aggregateType: 'Workspace', projectId: ORDER_PROJECT, workspaceId: ORDER_WORKSPACE }, revision: 1 } }) as never },
    plans: { ...untouched<WorkflowDependencies['plans']>('plans'),
      queryGoal: async () => ({ status: 'ready', value: { goal } }) as never,
      queryTaskGraph: async () => ({ status: 'ready', value: { plan, tasks: [...rows] } }) as never },
    claims: { claimTask: untouched<WorkflowDependencies['claims']>('claims').claimTask },
    configuration: { consumerId: 's1-order-consumer', bindings: [{
      workspace: { projectId: ORDER_PROJECT, workspaceId: ORDER_WORKSPACE }, sessionRole: ORDER_ROLE,
      roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 'builder', templateRevision: '1',
        bindingVersion: 1, policyRevision: 'p' },
      budget: { tokenBudget: 1000, deadline: null } }] },
  };
  const input: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: goal.ref, flowId: 's1-order-flow',
    sessionHint: ORDER_SESSION, kind: 'select_work' };
  const result = await createWorkflow(deps).advanceWork(orderContext(), input);
  if (result.status !== 'ready') throw new Error(`the Workflow refused select_work: ${JSON.stringify(result)}`);
  const next = result.value.next;
  if (next === null || next.kind !== 'perform') {
    throw new Error(`select_work did not propose a claim: ${JSON.stringify(result.value)}`);
  }
  if (next.operation.kind !== 'claim_task') {
    throw new Error(`select_work proposed ${next.operation.kind} instead of a claim`);
  }
  return next.operation.request.input.taskId;
}

describe('orderTasksByDependency (§4.3)', () => {
  it('UT36: plan [B(required),A(optional),C(required)] with B depending on A returns [C,A,B]', () => {
    const tasks = [task('B', 'required'), task('A', 'optional'), task('C', 'required')];
    const dependsOn = [edge('B', 'A')];
    expect(ids(orderTasksByDependency(tasks, dependsOn))).toEqual(['C', 'A', 'B']);
  });

  it('UT37: [B(required),A(required),C(optional)] with B depending on A returns [A,B,C]', () => {
    const tasks = [task('B', 'required'), task('A', 'required'), task('C', 'optional')];
    const dependsOn = [edge('B', 'A')];
    expect(ids(orderTasksByDependency(tasks, dependsOn))).toEqual(['A', 'B', 'C']);
  });

  it('UT38: downstream B depends on a candidate-external A and the order is [B] only', () => {
    const tasks = [task('B', 'required')];
    const dependsOn = [edge('B', 'A')];
    const ordered = orderTasksByDependency(tasks, dependsOn);
    expect(ids(ordered)).toEqual(['B']);
    // The unknown endpoint is neither added to the candidates nor a refusal.
    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.taskId).toBe('B');
  });

  it('UT39: a non-executable upstream A is ordered before B and selectNext still chooses B', async () => {
    const tasks = [task('B', 'required'), task('A', 'required')];
    const dependsOn = [edge('B', 'A')];
    // The pure order keeps the dependency edge even though A cannot execute.
    expect(ids(orderTasksByDependency(tasks, dependsOn))).toEqual(['A', 'B']);
    // And the real Workflow skips A (not eligible) and claims B: no
    // dependency_blocked guard was added to the claim owner.
    expect(await selectNextTask([orderRow('A', false), orderRow('B', true)], dependsOn)).toBe('B');
  });

  it('UT40: duplicate edges A→B count indegree once, return [A,B] and never mutate the inputs', () => {
    const tasks = [task('A', 'required'), task('B', 'required')];
    const dependsOn = [edge('B', 'A'), edge('B', 'A')];
    // Deep snapshots: a shallow copy shares the element objects, so a mutation
    // of an element would go undetected.
    const tasksSnapshot = structuredClone(tasks);
    const edgesSnapshot = structuredClone(dependsOn);
    expect(ids(orderTasksByDependency(tasks, dependsOn))).toEqual(['A', 'B']);
    expect(tasks).toEqual(tasksSnapshot);
    expect(dependsOn).toEqual(edgesSnapshot);
    expect(dependsOn).toHaveLength(2);
  });

  it('UT41: a corrupted cycle A↔B terminates defensively and returns [A,B]', () => {
    const tasks = [task('A', 'required'), task('B', 'required')];
    const dependsOn = [edge('A', 'B'), edge('B', 'A')];
    expect(ids(orderTasksByDependency(tasks, dependsOn))).toEqual(['A', 'B']);
  });
});
