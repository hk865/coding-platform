/**
 * PL slice P1: the pure segment merge (§5.1.2, PL-21's observations).
 * Inputs are built plan literals; no store, no model, no platform. Expected
 * values are the frozen literals or hand-computed arrays.
 */
import { describe, expect, it } from 'vitest';
import type {
  AcceptanceObligation, PlanRevisionDraft, PlanRevisionSnapshot, RuntimeTask,
} from '../../src/contracts/plan.js';
import { mergeStageRefinement } from '../../src/core/work-graph/tasks/stage-segment.js';

const PROJECT = 'project-1';
const GOAL = 'goal-1';
const goalRef = { aggregateType: 'Goal' as const, projectId: PROJECT, goalId: GOAL };

const completionPolicyPin = {
  ref: { aggregateType: 'CompletionPolicyRevision' as const, projectId: PROJECT, policyId: 'policy-1', revision: 1 },
  digest: 'a'.repeat(64),
};
const architectureBaselinePin = {
  ref: { aggregateType: 'ArchitectureBaselineRevision' as const, projectId: PROJECT, baselineId: 'baseline-1', revision: 1 },
  digest: 'b'.repeat(64),
};
const artifactRef = {
  kind: 'artifact' as const,
  contentType: 'text/plain',
  digest: 'c'.repeat(64),
  sizeBytes: 12,
  source: { kind: 'workspace' as const, refId: 'workspace-1', revision: 'revision-1' },
};

function task(taskId: string, stageId: string, overrides: Partial<RuntimeTask> = {}): RuntimeTask {
  return {
    taskId,
    stageId,
    title: `Task ${taskId}`,
    requirementLevel: 'required',
    taskKind: 'work',
    disposition: 'active',
    phase: 'pending',
    scope: { kind: 'stage', stageId },
    executionIntent: 'request_execution',
    ...overrides,
  };
}

const obligationOne: AcceptanceObligation = {
  obligationId: 'ob-1',
  title: 'Segment one done',
  requirementLevel: 'required',
  taskIds: ['t1', 't2'],
  verificationRequirements: [
    { requirementId: 'vr-1', requirementLevel: 'required', kind: 'test', description: 'the segment tests pass' },
  ],
};
const obligationTwo: AcceptanceObligation = {
  obligationId: 'ob-2',
  title: 'Segment two done',
  requirementLevel: 'required',
  taskIds: ['t3'],
  verificationRequirements: [
    { requirementId: 'vr-2', requirementLevel: 'required', kind: 'test', description: 'the second segment tests pass' },
  ],
};

function baseDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2,
    planId: 'plan-1',
    planRevision: 1,
    goalId: GOAL,
    stages: [
      { stageId: 'stage-1', title: 'First segment' },
      { stageId: 'stage-2', title: 'Second segment' },
    ],
    tasks: [
      task('t1', 'stage-1', { title: 'Placeholder one', executionIntent: 'plan_only' }),
      task('t2', 'stage-1', { title: 'Existing work' }),
      task('t3', 'stage-2', { title: 'Placeholder two', executionIntent: 'plan_only' }),
    ],
    assignments: [
      { taskId: 't2', role: 'implementer', instruction: 'Implement t2' },
      { taskId: 't1', role: 'implementer', instruction: 'Placeholder t1' },
    ],
    obligations: [obligationOne, obligationTwo],
    taskHierarchy: {
      parentOf: [
        { parentTaskId: 't3', childTaskId: 't1' },
        { parentTaskId: 't1', childTaskId: 't2' },
      ],
    },
    executionDag: {
      dependsOn: [
        { taskId: 't1', dependsOnId: 't2', requires: { kind: 'artifact', label: 't2 output' } },
        { taskId: 't3', dependsOnId: 't2', requires: { kind: 'artifact', label: 't2 output' } },
      ],
    },
    taskRelations: [
      { fromTaskId: 't1', toTaskId: 't2', kind: 'coordination', note: 't1 coordinates with t2' },
      { fromTaskId: 't3', toTaskId: 't2', kind: 'expected_dependency', note: 't3 expects t2' },
    ],
    inputRequirements: [
      { requirementId: 'ir-1', consumerTaskId: 't1', kind: 'artifact', artifactRef },
      { requirementId: 'ir-2', consumerTaskId: 't3', kind: 'artifact', artifactRef },
    ],
  };
}

function baseSnapshot(): PlanRevisionSnapshot {
  const draft = baseDraft();
  return {
    schemaVersion: 2,
    ref: { aggregateType: 'PlanRevision', projectId: PROJECT, planId: draft.planId },
    revision: 1,
    goalRef,
    planId: draft.planId,
    planRevision: draft.planRevision,
    acceptedAt: '2026-11-01T00:00:00.000Z',
    effectiveCompletionPolicy: completionPolicyPin,
    effectiveArchitectureBaseline: architectureBaselinePin,
    stages: draft.stages,
    tasks: draft.tasks,
    ...(draft.assignments === undefined ? {} : { assignments: draft.assignments }),
    obligations: draft.obligations,
    taskHierarchy: draft.taskHierarchy,
    executionDag: draft.executionDag,
    ...(draft.taskRelations === undefined ? {} : { taskRelations: draft.taskRelations }),
    ...(draft.inputRequirements === undefined ? {} : { inputRequirements: draft.inputRequirements }),
  };
}

const baseOrigin: NonNullable<PlanRevisionDraft['origin']> = {
  kind: 'model_coordination',
  source: { kind: 'plain' },
  answerRef: {
    aggregateType: 'QueryJobAnswer', projectId: PROJECT, workspaceId: 'workspace-1',
    queryJobId: 'query-base', answerId: 'answer-base',
  },
  answerDigest: 'd'.repeat(64),
  goalRevision: 1,
  workspaceRevision: 1,
  requestId: 'request-base',
  summary: 'base plan',
  assignments: [],
};
const segmentOrigin: NonNullable<PlanRevisionDraft['origin']> = {
  ...baseOrigin,
  answerRef: { ...baseOrigin.answerRef, queryJobId: 'query-segment', answerId: 'answer-segment' },
  requestId: 'request-segment',
  summary: 'the segment answer',
};

/** One placeholder refined into one task: same taskId, request_execution, new assignment. */
function segmentOneToOne(): PlanRevisionDraft {
  return {
    schemaVersion: 2,
    reviewAdmissionProtocol: 'independent-review-v1',
    origin: segmentOrigin,
    planId: 'plan-2',
    planRevision: 2,
    goalId: GOAL,
    stages: [{ stageId: 'stage-1', title: 'First segment refined' }],
    tasks: [task('t1', 'stage-1', { title: 'Refined work', executionIntent: 'request_execution' })],
    assignments: [{ taskId: 't1', role: 'implementer', instruction: 'Do the refined work' }],
    obligations: [{
      obligationId: 'ob-1',
      title: 'Segment one done',
      requirementLevel: 'required',
      taskIds: ['t1'],
      verificationRequirements: [
        { requirementId: 'vr-1', requirementLevel: 'required', kind: 'test', description: 'the segment tests pass' },
      ],
    }],
    taskHierarchy: { parentOf: [{ parentTaskId: 't2', childTaskId: 't1' }] },
    executionDag: {
      dependsOn: [{ taskId: 't1', dependsOnId: 't3', requires: { kind: 'output-contract', label: 't3 hand-off' } }],
    },
    taskRelations: [{ fromTaskId: 't1', toTaskId: 't3', kind: 'coordination', note: 'refined t1 coordinates with t3' }],
    inputRequirements: [{ requirementId: 'ir-3', consumerTaskId: 't1', kind: 'artifact', artifactRef }],
  };
}

/** One placeholder refined into several tasks: the old task stays as superseded. */
function segmentOneToMany(): PlanRevisionDraft {
  return {
    schemaVersion: 2,
    planId: 'plan-2',
    planRevision: 2,
    goalId: GOAL,
    stages: [{ stageId: 'stage-2', title: 'Second segment refined' }],
    tasks: [
      task('t3', 'stage-2', {
        title: 'Placeholder two', executionIntent: 'plan_only', disposition: 'superseded', replacedByTaskId: 't4',
      }),
      task('t4', 'stage-2', { title: 'Replacement one' }),
      task('t5', 'stage-2', { title: 'Replacement two' }),
    ],
    assignments: [
      { taskId: 't4', role: 'implementer', instruction: 'Do t4' },
      { taskId: 't5', role: 'implementer', instruction: 'Do t5' },
    ],
    obligations: [{
      obligationId: 'ob-2',
      title: 'Segment two done',
      requirementLevel: 'required',
      taskIds: ['t4', 't5'],
      verificationRequirements: [
        { requirementId: 'vr-2', requirementLevel: 'required', kind: 'test', description: 'the second segment tests pass' },
      ],
    }],
    taskHierarchy: { parentOf: [{ parentTaskId: 't4', childTaskId: 't5' }] },
    executionDag: {
      dependsOn: [{ taskId: 't5', dependsOnId: 't4', requires: { kind: 'artifact', label: 't4 output' } }],
    },
    taskRelations: [],
    inputRequirements: [],
  };
}

/** Replaces an existing stage/task in place and appends a new stage/task after the base. */
function segmentOrder(): PlanRevisionDraft {
  return {
    schemaVersion: 2,
    planId: 'plan-2',
    planRevision: 2,
    goalId: GOAL,
    stages: [
      { stageId: 'stage-1', title: 'First segment v2' },
      { stageId: 'stage-3', title: 'Third segment' },
    ],
    tasks: [
      task('t2', 'stage-1', { title: 'Existing work v2' }),
      task('t4', 'stage-3', { title: 'New third-segment work' }),
    ],
    obligations: [],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
  };
}

function merged(base: PlanRevisionSnapshot | PlanRevisionDraft, segment: PlanRevisionDraft): PlanRevisionDraft {
  const result = mergeStageRefinement(base, segment);
  expect(result.status).toBe('merged');
  if (result.status !== 'merged') throw new Error(`unexpected rejection: ${result.reason}`);
  return result.draft;
}

describe('mergeStageRefinement: the frozen merge rules (§5.1.2)', () => {
  it('refines one placeholder 1:1 with the same taskId, request_execution and other tasks untouched', () => {
    const base = baseSnapshot();
    const draft = merged(base, segmentOneToOne());

    expect(draft.planId).toBe('plan-2');
    expect(draft.planRevision).toBe(2);
    expect(draft.tasks.find((entry) => entry.taskId === 't1')).toEqual(
      task('t1', 'stage-1', { title: 'Refined work', executionIntent: 'request_execution' }),
    );
    expect(draft.tasks.filter((entry) => entry.taskId !== 't1')).toEqual(
      base.tasks.filter((entry) => entry.taskId !== 't1'),
    );
  });

  it('refines one placeholder 1:many, keeps the old task superseded and appends the new tasks', () => {
    const base = baseSnapshot();
    const draft = merged(base, segmentOneToMany());

    expect(draft.tasks.map((entry) => entry.taskId)).toEqual(['t1', 't2', 't3', 't4', 't5']);
    expect(draft.tasks[2]).toEqual(task('t3', 'stage-2', {
      title: 'Placeholder two', executionIntent: 'plan_only', disposition: 'superseded', replacedByTaskId: 't4',
    }));
    expect(draft.tasks.slice(3)).toEqual(segmentOneToMany().tasks.slice(1));
    expect(draft.obligations).toEqual([obligationOne, segmentOneToMany().obligations[0]]);
    expect(draft.assignments).toEqual([
      ...(base.assignments ?? []),
      ...(segmentOneToMany().assignments ?? []),
    ]);
  });

  it("keeps the other segment's stage, tasks and unrelated edges", () => {
    const base = baseSnapshot();
    const draft = merged(base, segmentOneToOne());

    expect(draft.stages[1]).toEqual(base.stages[1]);
    expect(draft.taskHierarchy.parentOf).toContainEqual(base.taskHierarchy.parentOf[1]);
    expect(draft.executionDag.dependsOn).toContainEqual(base.executionDag.dependsOn[1]);
    expect(draft.taskRelations).toContainEqual(base.taskRelations?.[1]);
    expect(draft.inputRequirements).toContainEqual(base.inputRequirements?.[1]);
  });

  it('replaces the refined task\'s edges and appends the segment\'s edges, keeping unrelated ones', () => {
    const base = baseSnapshot();
    const edgeCases: readonly {
      name: string;
      segment: PlanRevisionDraft;
      read: (draft: PlanRevisionDraft) => unknown;
      expected: unknown;
    }[] = [
      {
        name: 'taskHierarchy.parentOf',
        segment: {
          schemaVersion: 2, planId: 'plan-2', planRevision: 2, goalId: GOAL,
          stages: [], tasks: [task('t1', 'stage-1', { title: 'Refined work' })],
          obligations: [], taskHierarchy: { parentOf: [{ parentTaskId: 't2', childTaskId: 't1' }] },
          executionDag: { dependsOn: [] },
        },
        read: (draft) => draft.taskHierarchy.parentOf,
        expected: [base.taskHierarchy.parentOf[1], { parentTaskId: 't2', childTaskId: 't1' }],
      },
      {
        name: 'executionDag.dependsOn',
        segment: {
          schemaVersion: 2, planId: 'plan-2', planRevision: 2, goalId: GOAL,
          stages: [], tasks: [task('t1', 'stage-1', { title: 'Refined work' })],
          obligations: [], taskHierarchy: { parentOf: [] },
          executionDag: {
            dependsOn: [{ taskId: 't1', dependsOnId: 't3', requires: { kind: 'output-contract', label: 't3 hand-off' } }],
          },
        },
        read: (draft) => draft.executionDag.dependsOn,
        expected: [
          base.executionDag.dependsOn[1],
          { taskId: 't1', dependsOnId: 't3', requires: { kind: 'output-contract', label: 't3 hand-off' } },
        ],
      },
      {
        name: 'taskRelations',
        segment: {
          schemaVersion: 2, planId: 'plan-2', planRevision: 2, goalId: GOAL,
          stages: [], tasks: [task('t1', 'stage-1', { title: 'Refined work' })],
          obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
          taskRelations: [{ fromTaskId: 't1', toTaskId: 't3', kind: 'coordination', note: 'refined t1 coordinates with t3' }],
        },
        read: (draft) => draft.taskRelations,
        expected: [
          base.taskRelations?.[1],
          { fromTaskId: 't1', toTaskId: 't3', kind: 'coordination', note: 'refined t1 coordinates with t3' },
        ],
      },
      {
        name: 'inputRequirements',
        segment: {
          schemaVersion: 2, planId: 'plan-2', planRevision: 2, goalId: GOAL,
          stages: [], tasks: [task('t1', 'stage-1', { title: 'Refined work' })],
          obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
          inputRequirements: [{ requirementId: 'ir-3', consumerTaskId: 't1', kind: 'artifact', artifactRef }],
        },
        read: (draft) => draft.inputRequirements,
        expected: [base.inputRequirements?.[1], { requirementId: 'ir-3', consumerTaskId: 't1', kind: 'artifact', artifactRef }],
      },
    ];

    for (const edgeCase of edgeCases) {
      expect(edgeCase.read(merged(base, edgeCase.segment)), edgeCase.name).toEqual(edgeCase.expected);
    }
  });

  it('keeps base order and appends new stages and tasks in segment order', () => {
    const draft = merged(baseSnapshot(), segmentOrder());

    expect(draft.stages.map((stage) => stage.stageId)).toEqual(['stage-1', 'stage-2', 'stage-3']);
    expect(draft.stages.map((stage) => stage.title)).toEqual(['First segment v2', 'Second segment', 'Third segment']);
    expect(draft.tasks.map((entry) => entry.taskId)).toEqual(['t1', 't2', 't3', 't4']);
    expect(draft.tasks.map((entry) => entry.title)).toEqual([
      'Placeholder one', 'Existing work v2', 'Placeholder two', 'New third-segment work',
    ]);
  });

  it('keeps a snapshot base origin and review admission protocol; the segment origin never appears', () => {
    const base = baseSnapshot();
    base.origin = baseOrigin;
    base.reviewAdmissionProtocol = 'independent-review-v1';
    const draft = merged(base, segmentOneToOne());

    expect(draft.origin).toEqual(baseOrigin);
    expect(draft.origin).not.toEqual(segmentOrigin);
    expect(draft.reviewAdmissionProtocol).toBe('independent-review-v1');
  });

  it('does not copy the segment review admission protocol when the base has none', () => {
    const draft = merged(baseSnapshot(), segmentOneToOne());
    expect(draft).not.toHaveProperty('reviewAdmissionProtocol');
  });

  it('a candidate draft base result carries no own origin', () => {
    const base = baseDraft();
    base.origin = baseOrigin;
    base.reviewAdmissionProtocol = 'independent-review-v1';
    const draft = merged(base, segmentOneToOne());

    expect(draft).not.toHaveProperty('origin');
    expect(draft.reviewAdmissionProtocol).toBe('independent-review-v1');
  });
});

describe('mergeStageRefinement: rejects an empty segment', () => {
  it('rejects a segment that names no stage and no task with the frozen literal', () => {
    const empty = { ...baseDraft(), stages: [], tasks: [] };
    const result = mergeStageRefinement(baseSnapshot(), empty);

    expect(result).toEqual({
      status: 'rejected', code: 'invalid', reason: 'the segment names no stage and no task',
    });
  });
});
