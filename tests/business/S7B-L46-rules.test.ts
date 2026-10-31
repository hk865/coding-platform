/**
 * G-L46-rules (book-7b.md:789-:802, §5 :1229; P-19): the ONE formal dependency table and its closure. Pure values
 * only (A5). Expected literals are §3.13 items 2-3; the file is red at the missing exports (the fixed contract).
 */
import { describe, expect, it } from 'vitest';
import type { DependencyRequirement, TaskRelationV2 } from '../../src/contracts/plan.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import type { TaskInputUpstreamsV1 } from '../../src/core/work-graph/model/context-input-contracts.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalWaitBasisV1 } from '../../src/business/workflow/contracts.js';
import {
  closeBranches, formalDependencies, type FormalDependencyEdgeV1, type L46BlockV1,
} from '../../src/business/workflow/task-gate.js';

const task = (taskId: string, goalId = 'G'): TaskTriple => ({ projectId: 'P', goalId, taskId });
const dep = (dependsOnId: string, kind: DependencyRequirement['kind']): TaskRow['legacyDependencies'][number] =>
  ({ dependsOnId, requires: { kind, label: `${dependsOnId}:${kind}` }, verification: 'legacy_unverifiable' });
const relation = (fromTaskId: string, toTaskId: string, kind: TaskRelationV2['kind']): TaskRelationV2 =>
  ({ fromTaskId, toTaskId, kind, note: 'advisory only' });

function row(taskId: string, input: {
  deps?: TaskRow['legacyDependencies']; relations?: TaskRelationV2[]; goalId?: string;
} = {}): TaskRow {
  return {
    ref: task(taskId, input.goalId ?? 'G'),
    definition: { taskId, title: taskId, requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
    effectivePhase: 'pending', disposition: 'active', currentAttempt: null, execution: null,
    eligibilityScope: 'task_state', eligibility: { eligible: true, reasons: [] },
    relations: input.relations ?? [], inputRequirements: [], legacyDependencies: input.deps ?? [],
  };
}

const upstreams = (entries: TaskInputUpstreamsV1['upstreams']): TaskInputUpstreamsV1 =>
  ({ planRef: { aggregateType: 'PlanRevision', projectId: 'P', planId: 'PLAN' }, upstreams: entries });
const edge = (consumerTaskId: string, upstreamTaskId: string,
  kind: FormalDependencyEdgeV1['kind']): FormalDependencyEdgeV1 => ({ consumerTaskId, upstreamTaskId, kind });
const cases: Array<[string, TaskRow[], TaskInputUpstreamsV1 | null, FormalDependencyEdgeV1[]]> = [
  ['output-contract', [row('D', { deps: [dep('A', 'output-contract')] })], null, [edge('D', 'A', 'output-contract')]],
  ['artifact', [row('D', { deps: [dep('A', 'artifact')] })], null, [edge('D', 'A', 'artifact')]],
  ['decision', [row('D', { deps: [dep('A', 'decision')] })], null, [edge('D', 'A', 'decision')]],
  ['gate-result', [row('D', { deps: [dep('A', 'gate-result')] })], null, [edge('D', 'A', 'gate-result')]],
  ['environment-revision is a workspace input, never an edge',
    [row('B', { deps: [dep('A', 'environment-revision')] })], null, []],
  ['coordination is advisory, never an edge',
    [row('D', { relations: [relation('D', 'A', 'coordination')] })], null, []],
  ['expected_dependency is advisory, never an edge',
    [row('D', { relations: [relation('D', 'A', 'expected_dependency')] })], null, []],
  ['the legacy exact artifact resolves to an artifact edge',
    [row('D')], upstreams([{ consumerTaskId: 'D', upstream: task('A') }]), [edge('D', 'A', 'artifact')]],
  ['a cross-goal upstream is dropped',
    [row('D')], upstreams([{ consumerTaskId: 'D', upstream: task('A', 'OTHER') }]), []],
  ['a self-edge is dropped', [row('D', { deps: [dep('D', 'gate-result')] })], null, []],
  ['a duplicate keeps the first kind, including a legacy edge',
    [row('D', { deps: [dep('A', 'artifact'), dep('A', 'gate-result')] })],
    upstreams([{ consumerTaskId: 'D', upstream: task('A') }]), [edge('D', 'A', 'artifact')]],
];
describe('formalDependencies: the one formal table', () => {
  it.each(cases)('%s', (_name, rows, input, expected) => {
    expect(formalDependencies(rows, input)).toEqual(expected);
  });
});
const BASIS: GoalWaitBasisV1 = { projectId: 'P', goalId: 'G',
  recordKinds: ['UserDecision', 'Goal', 'TaskRequeue', 'VerificationRound', 'Run'],
  reasons: ['automation_confirmation:system_requeue'] };
const block = (taskId: string): L46BlockV1 => ({
  task: task(taskId), action: 'system_requeue', wakeBasis: BASIS,
  gate: { status: 'ready', value: { state: 'waiting', receipt: null, next: null,
    reason: 'automation_confirmation_required:system_requeue', waitBasis: BASIS } },
});
const taskOf = (taskId: string): TaskTriple | undefined =>
  ['A', 'B', 'C', 'E', 'F'].includes(taskId) ? task(taskId) : undefined;
const reason = (taskId: string, root: string) => `l46_dependency_blocked: the Task ${taskId} waits on ${root}`;
describe('closeBranches: the transitive closure over the table', () => {
  it('one block on A reaches C and the grandchild E and names the root A; the soft D is absent', () => {
    const rows = [row('C', { deps: [dep('A', 'gate-result')] }), row('E', { deps: [dep('C', 'gate-result')] })];
    const waiting = closeBranches(formalDependencies(rows, null), [block('A')], taskOf);
    expect([...waiting.keys()]).toEqual(['A', 'C', 'E']);
    expect(waiting.get('A')).toMatchObject({ task: task('A'),
      reason: 'automation_confirmation_required:system_requeue' });
    expect(waiting.get('C')).toMatchObject({ task: task('C'), reason: reason('C', 'A') });
    expect(waiting.get('E')).toMatchObject({ task: task('E'), reason: reason('E', 'A') });
  });
});
