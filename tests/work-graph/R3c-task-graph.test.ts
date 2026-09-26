import { expect, it } from 'vitest';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { buildTaskAdjacency } from '../../src/core/work-graph/tasks/task-index.js';
import { evaluateEligibility } from '../../src/core/work-graph/tasks/eligibility.js';

it('derives reverse and forward dependencies from one accepted Plan, preserving independent tasks', () => {
  // This is an immutable accepted-plan value, not a replacement Goal/Plan service.
  const plan = { executionDag: { dependsOn: [
    { taskId: 'implement', dependsOnId: 'design', requires: { kind: 'output-contract', label: 'design' } },
    { taskId: 'verify', dependsOnId: 'implement', requires: { kind: 'artifact', label: 'result' } },
  ] }, tasks: [{ taskId: 'design' }, { taskId: 'implement' }, { taskId: 'verify' }, { taskId: 'docs' }] } as PlanRevisionSnapshot;
  const graph = buildTaskAdjacency(plan);
  expect(graph.predecessors.get('implement')).toEqual(['design']);
  expect(graph.predecessors.get('verify')).toEqual(['implement']);
  expect(graph.predecessors.get('docs')).toEqual([]);
  expect(graph.successors.get('design')).toEqual(['implement']);
  expect(graph.successors.get('docs')).toEqual([]);
});

it('uses current task state without treating a predecessor completion as a candidate gate', () => {
  const plan = { tasks: [
    { taskId: 'design', taskKind: 'work', disposition: 'active', phase: 'pending' },
    { taskId: 'implement', taskKind: 'work', disposition: 'active', phase: 'pending' },
    { taskId: 'docs', taskKind: 'work', disposition: 'active', phase: 'pending' },
  ], assignments: [
    { taskId: 'design', role: 'builder', instruction: 'Design the change' },
    { taskId: 'implement', role: 'builder', instruction: 'Implement the change' },
    { taskId: 'docs', role: 'builder', instruction: 'Document the change' },
  ], executionDag: { dependsOn: [
    { taskId: 'implement', dependsOnId: 'design', requires: { kind: 'artifact', label: 'design' } },
  ] } } as PlanRevisionSnapshot;
  const facts = { plan, goalDesiredState: 'active' as const,
    effectivePhases: new Map([['design', 'running'], ['implement', 'pending'], ['docs', 'pending']] as const),
    lease: { status: 'free' as const } };
  expect(evaluateEligibility({ ...facts, taskId: 'docs' })).toEqual({ eligible: true, reasons: [] });
  // The label is not an exact, verified input. A running design Task does not
  // bar unrelated implementation or investigation by itself.
  expect(evaluateEligibility({ ...facts, taskId: 'implement' })).toEqual({ eligible: true, reasons: [] });
});
