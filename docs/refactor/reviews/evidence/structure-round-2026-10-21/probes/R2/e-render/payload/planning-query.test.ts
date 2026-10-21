/**
 * Copy-only probe driver. No suite file reaches the planning Query branch:
 * every existing `assembleQuery` call uses `semantic_query` or `focusPlan: null`,
 * so `queryPlanSummary` (and, beyond one call, `topLevelModuleCards`) would
 * capture nothing. This driver calls the real public assembler with
 * `initial_coordination` + a non-null focus Plan and a real graph-context double,
 * so the probes see a genuine planning-Query assembly. It is not an assertion
 * test: it fails only when the assembly itself rejects.
 *
 * Both installer variants write the same file; the public `context-assembler.ts`
 * entry exists before and after the split.
 */
import { describe, expect, it } from 'vitest';
import { createContextAssembler } from '../../src/core/agent-runtime/context-assembler.js';

const P = 'probe-project';
const G = 'probe-goal';
const W = 'probe-workspace';
const goalRef = { aggregateType: 'Goal', projectId: P, goalId: G };
const planRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'probe-plan' };

const plan = {
  schemaVersion: 2, ref: planRef, revision: 1, goalRef, planId: 'probe-plan', planRevision: 4,
  acceptedAt: '2026-01-01T00:00:00.000Z',
  effectiveCompletionPolicy: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: P, policyId: 'cp' }, revision: 1 },
  effectiveArchitectureBaseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: P, baselineId: 'ab' }, revision: 1 },
  stages: [{ stageId: 's1', title: 'Segment One' }, { stageId: 's2', title: 'Segment Two' }],
  tasks: [
    { taskId: 't1', stageId: 's1', title: 'Planning Task One', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    { taskId: 't2', stageId: 's2', title: 'Planning Task Two', requirementLevel: 'optional', taskKind: 'work', disposition: 'deferred', phase: 'pending', scope: { kind: 'stage', stageId: 's2' } },
  ],
  assignments: [{ taskId: 't1', role: 'planner', instruction: 'plan it' }],
  obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
};

const facts = {
  goal: {
    ref: goalRef, workspaceRef: { aggregateType: 'Workspace', projectId: P, workspaceId: W },
    objective: 'Plan the probe Goal', desiredState: 'active', desiredStateRevision: 1,
    desiredStateRequestedBy: null, activePlanRevision: planRef, revision: 2,
  },
  graph: { plan, tasks: [], sourceCursor: 'c0000000001' },
  architecture: {
    modules: [
      { ref: { projectId: P, moduleId: 'm.parent' }, name: 'Parent', responsibility: 'parent responsibility 中文', paths: [], interfaces: [] },
      { ref: { projectId: P, moduleId: 'm.child' }, name: 'Child', responsibility: 'child responsibility', paths: [], interfaces: [] },
      { ref: { projectId: P, moduleId: 'm.top' }, name: 'Top', responsibility: 'top responsibility', paths: [], interfaces: [] },
    ],
    dependencies: [], requireDag: true,
    containment: { parentOf: [{ parent: { projectId: P, moduleId: 'm.parent' }, child: { projectId: P, moduleId: 'm.child' } }] },
  },
  executions: [],
  inputs: [],
  extensions: {
    notes: { availability: 'available', understanding: { rows: [], norms: [], normsOmitted: 0 }, general: [] },
    anomalies: { availability: 'not_implemented', rows: [] },
    footprint: { availability: 'available', rows: [] },
    goalSettings: { availability: 'available', autonomy: 'after_plan_confirmation' },
    decisions: { availability: 'not_implemented', rows: [] },
  },
  sources: [],
  readThrough: null,
};

const queryInput = {
  facts: {
    record: {
      job: {
        job: {
          intent: {
            focusTaskRefs: [{ projectId: P, goalId: G, taskId: 't1' }],
            execution: { kind: 'initial_coordination' },
          },
        },
      },
      session: { role: undefined },
    },
    goal: facts.goal,
    workspace: { ref: { aggregateType: 'Workspace', projectId: P, workspaceId: W }, revision: 11 },
    focusPlan: plan,
    initiator: { kind: 'human', id: 'probe-operator' },
  },
  role: { status: 'absent', roleId: 'probe-role', reason: 'probe uses the legacy template' },
  configuration: {
    configurationRevision: 'probe-config@1', platformDuty: 'executor', contextResidentBytes: 4096,
    tools: [], writeScope: [],
  },
  permissions: { tools: ['read'], writeScope: [] },
  question: 'Planning question 中文?',
};

describe('S4 probe driver', () => {
  it('SPQ01 assembles a planning Query through the real public assembler', async () => {
    const assembler = createContextAssembler({
      graphContext: { readContextFacts: async () => ({ status: 'ready', value: facts }) },
    } as never);
    const result = await assembler.assembleQuery({ projectId: P, workspaceId: W } as never, queryInput as never);
    expect(result.status).toBe('ready');
  });
});
