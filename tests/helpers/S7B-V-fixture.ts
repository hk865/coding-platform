import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskGraph } from '../../src/core/work-graph/model/plan-contracts.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { HandleInterventionResultV1, InterventionInput } from '../../src/business/workflow/ports.js';
import { AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, ag2bChecksConfiguration, plain }
  from './AG2b-collaboration-fixture.js';
import { driveWorkflow } from './A2-restart-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING } from './S6A-request-fixture.js';
import { createS6BLine } from './S6B1-fixture.js';
import { sessionOf } from './S7A-fixture.js';
import type { S7BPlanningWorld } from './S7B3-planning-world.js';
import { readActivePlan } from '../scenarios/support/S5-decisions.js';
import { workTask } from '../scenarios/support/plan.js';

export type S7BCompletedGoal = { world: S7BPlanningWorld['world']; goalRef: GoalRef };

export async function completeS7BGoal(planning: Pick<S7BPlanningWorld, 'world' | 'goalRef'>):
Promise<S7BCompletedGoal> {
  const { world, goalRef } = planning;
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  // The Host has no checks on memory; a fresh round resolves this trusted configuration for the workspace.
  world.platform.registerCheckConfiguration({ configuration: ag2bChecksConfiguration({
    actor: world.ag2b.actor, command: 'true' }) });
  const graph = async (): Promise<TaskGraph> => {
    const read = (await world.post('tasks/query', plain(S6A_SCOPE, { goalRef }))).body as ReadResult<TaskGraph>;
    if (read.status !== 'ready') throw new Error(`V1: the task graph is not readable: ${JSON.stringify(read)}`);
    return read.value;
  };
  const adopted = await graph();
  const work = adopted.tasks.filter(row => row.definition.taskKind === 'work'
    && row.definition.disposition === 'active');
  if (work.length === 0) throw new Error('V1: the adopted Plan has no active work task');
  for (const row of work) {
    const line = await createS6BLine(ws, { label: `s7b3-v1-${row.ref.taskId}`, role: S6A_WORK_ROLE,
      tasks: [row.ref] });
    await world.scripted.script(await sessionOf(world, line),
      [{ kind: 'text', text: `S7B3 V1 work ${row.ref.taskId}` }]);
  }
  // The Workflow satisfies the Plan's tasks (the gate included); V1's own completeGoal stays the public completion.
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef, flowId: 's7b3-v1-goal', sessionHint: null,
    kind: 'select_work' }, { stopBefore: 'complete_goal' });
  const after = await graph();
  const required = after.tasks.filter(row => row.definition.requirementLevel === 'required'
    && (row.definition.taskKind === 'work' || row.definition.taskKind === 'gate'));
  const unsatisfied = required.filter(row => row.effectivePhase !== 'satisfied').map(row => row.ref.taskId);
  if (unsatisfied.length > 0) throw new Error(`V1: the Workflow did not satisfy ${unsatisfied.join(', ')}`);
  const goalRead = (await world.post('goals/read', plain(S6A_SCOPE,
    goalRef))).body as ReadResult<{ goal: { revision: number } }>;
  if (goalRead.status !== 'ready') throw new Error(`V1: the Goal is not readable: ${JSON.stringify(goalRead)}`);
  const pins: VersionPin[] = [
    { ref: goalRef, revision: goalRead.value.goal.revision },
    { ref: { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId },
      revision: after.completion?.status === 'recorded' ? after.completion.snapshot.revision : 0 },
  ];
  const completed = await world.platform.goals.completeGoal(world.humanContext(), {
    input: { goalRef }, meta: { requestId: `s7b3-v1-complete-${goalRef.goalId}`, expected: pins },
  });
  if (completed.status !== 'committed') throw new Error(`V1: completeGoal did not commit: ${JSON.stringify(completed)}`);
  return { world, goalRef };
}

export type S7BVWorkProfile = Pick<InterventionInput, 'roleBinding' | 'runtimeBudget' | 'budget' | 'consumerId'>;

export function s7bVWorkProfile(): S7BVWorkProfile {
  return { roleBinding: S6A_WORK_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET,
    budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID };
}

export const interveneS7B = (world: S6AHostWorld, messageRef: SessionMessage['ref'], profile: S7BVWorkProfile) =>
  world.platform.workflow.handleIntervention!(world.humanContext(), { messageRef, ...profile });

export async function driveS7BIntervention(world: S6AHostWorld, messageRef: SessionMessage['ref'],
  profile: S7BVWorkProfile, stop: (result: HandleInterventionResultV1) => boolean):
Promise<HandleInterventionResultV1> {
  let result = await interveneS7B(world, messageRef, profile);
  for (let step = 0; step < 12; step += 1) {
    if (stop(result)) return result;
    if (result.status === 'rejected') throw new Error(`V: ${JSON.stringify(result)}`);
    result = await interveneS7B(world, messageRef, profile);
  }
  throw new Error(`V: did not settle: ${JSON.stringify(result)}`);
}

export function planAnswer(plan: Record<string, unknown>): string {
  return JSON.stringify({ schemaVersion: 2, kind: 'plan',
    summary: `S7B3 V ${String(plan['planId'])}`, plan });
}

export function firstPlan(input: { label: string; taskId: string; role: string }): string {
  return planAnswer({
    schemaVersion: 2, planId: `s7b3-v-${input.label}`, planRevision: 1, goalId: '',
    stages: [], tasks: [workTask(input.taskId, `S7B3 V ${input.taskId} work`)],
    assignments: [{ taskId: input.taskId, role: input.role, instruction: `S7B3 V ${input.label}` }],
    obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
  });
}

export function refinementPlanFrom(active: PlanRevisionSnapshot, goalRef: GoalRef,
  input: { label: string; taskId: string; role: string; planId?: string; summary?: string }): string {
  const tasks = [workTask(input.taskId, `S7B3 V ${input.taskId} work`), ...active.tasks];
  const assignments = [...(active.assignments ?? []),
    { taskId: input.taskId, role: input.role, instruction: `S7B3 V ${input.label}` }];
  return JSON.stringify({ schemaVersion: 2, kind: 'plan',
    summary: input.summary ?? `S7B3 V ${input.label}`,
    plan: { schemaVersion: 2, planId: input.planId ?? `s7b3-v-${input.label}`,
      planRevision: active.planRevision + 1, goalId: goalRef.goalId, stages: active.stages, tasks, assignments,
      obligations: active.obligations, taskHierarchy: active.taskHierarchy, executionDag: active.executionDag } });
}

export async function refinementPlan(world: S6AHostWorld, goalRef: GoalRef,
  input: { label: string; taskId: string; role: string }): Promise<string> {
  return refinementPlanFrom(await readActivePlan(world.platform, world.humanContext(), goalRef), goalRef, input);
}
