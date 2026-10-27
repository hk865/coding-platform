/** The pure source-aware initial-plan rows: `facts.resolution` decides the Goal and revision, the origin stores the source, a binding selector compares the answer plan draft, and the two propose fingerprints are the production formulas. */
import { describe, expect, it } from 'vitest';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { CoreRejection } from '../../src/contracts/core/results.js';
import type { InitializationSourceV1, InitialPlanOriginSourceV1 } from '../../src/contracts/initial-planning.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  InitialPlanAnswerFacts,
  InitialPlanSourceResolutionV1,
  QueryJobAnswerRef,
  QueryJobAnswerV1,
  QueryJobSnapshot,
  QueryRunSnapshot,
} from '../../src/contracts/query-job.js';
import {
  initialAnswerProposeFingerprint, normalizeInitialPlanningResponseV2, sourceProposeFingerprint,
} from '../../src/core/work-graph/tasks/initial-plan.js';

const PROJECT = 'p-initial-source';
const WORKSPACE = 'w-initial-source';
const ANSWER_REF: QueryJobAnswerRef = { aggregateType: 'QueryJobAnswer', projectId: PROJECT,
  workspaceId: WORKSPACE, queryJobId: 'qj-initial-source', answerId: 'a-initial-source' };
/** The Job's own Goal; every resolution below names a different Goal on purpose. */
const JOB_GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'g-job' };
const RESOLVED_GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'g-resolved' };
const OTHER_RESOLVED_GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'g-resolved-other' };
const BINDING_GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'g-binding' };
const MANIFEST_GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'g-manifest' };
const BINDING_SOURCE: InitializationSourceV1 = { kind: 'binding', answerRef: { ...ANSWER_REF }, draftIndex: 2 };
const PREPARED_SOURCE: InitializationSourceV1 = { kind: 'prepared_goal', answerRef: { ...ANSWER_REF } };
const PLAN_RESPONSE = { schemaVersion: 2 as const, kind: 'plan' as const, summary: 'the initial plan',
  plan: { schemaVersion: 2 as const, stages: [], tasks: [], obligations: [],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } } };

/** The exact facts the normalization consumes, built as pure input; the Job's Goal is always `g-job`. */
function factsFor(resolution: InitialPlanSourceResolutionV1,
  manifestGoal: { ref: GoalRef; revision: number } | null,
  answerPlanDraftIndex = 2): InitialPlanAnswerFacts {
  return {
    answer: { planDraftIndex: answerPlanDraftIndex } as QueryJobAnswerV1,
    answerRef: { ...ANSWER_REF },
    job: { job: { intent: { projectId: PROJECT, workspaceId: WORKSPACE, intentId: 'intent-initial-source',
      goalId: JOB_GOAL.goalId } } } as unknown as QueryJobSnapshot,
    run: {} as QueryRunSnapshot,
    manifest: { goal: manifestGoal, workspace: { ref: { workspaceId: WORKSPACE }, revision: 11 } } as unknown as PreparedQueryManifestV1,
    answerText: 'the saved initialization answer',
    resolution,
  };
}

type NormalizationCase = {
  name: string;
  resolution: InitialPlanSourceResolutionV1;
  manifestGoal: { ref: GoalRef; revision: number } | null;
  /** The resolved Goal the draft and origin must name, and the revision the origin must store. */
  goalId: string;
  goalRevision: number;
  originSource: InitialPlanOriginSourceV1;
  /** A second resolution that must produce a different plan identity. */
  otherResolution?: InitialPlanSourceResolutionV1;
};

const NORMALIZATION_CASES: readonly NormalizationCase[] = [
  {
    name: 'plain: the Goal identity and revision come from the resolution and the origin stores { kind: plain }',
    resolution: { kind: 'plain', source: null, bindingRef: null, goal: RESOLVED_GOAL, goalRevision: 7 },
    manifestGoal: { ref: JOB_GOAL, revision: 99 },
    goalId: 'g-resolved', goalRevision: 7, originSource: { kind: 'plain' },
    // The plan identity follows the same resolved Goal, so a different resolution is a different plan id.
    otherResolution: { kind: 'plain', source: null, bindingRef: null, goal: OTHER_RESOLVED_GOAL, goalRevision: 7 },
  },
  {
    name: 'binding: a null manifest Goal is a plan with the binding Goal, revision 1 and the binding source',
    resolution: { kind: 'binding', source: BINDING_SOURCE,
      bindingRef: { aggregateType: 'InitializationBinding', projectId: PROJECT,
        answerRef: { ...ANSWER_REF }, draftIndex: 2 },
      goal: BINDING_GOAL, goalRevision: 1 },
    manifestGoal: null,
    goalId: 'g-binding', goalRevision: 1,
    originSource: { kind: 'binding', selector: BINDING_SOURCE,
      bindingRef: { aggregateType: 'InitializationBinding', projectId: PROJECT,
        answerRef: { ...ANSWER_REF }, draftIndex: 2 } },
  },
  {
    name: 'prepared_goal: the manifest Goal wins over the Job Goal and the source stores the selector',
    resolution: { kind: 'prepared_goal', source: PREPARED_SOURCE, bindingRef: null,
      goal: MANIFEST_GOAL, goalRevision: 4 },
    manifestGoal: { ref: MANIFEST_GOAL, revision: 4 },
    goalId: 'g-manifest', goalRevision: 4,
    originSource: { kind: 'prepared_goal', selector: PREPARED_SOURCE },
  },
  {
    name: 'writes source explicitly on the origin when the plain resolution names the Job Goal',
    resolution: { kind: 'plain', source: null, bindingRef: null, goal: JOB_GOAL, goalRevision: 3 },
    manifestGoal: { ref: JOB_GOAL, revision: 3 },
    goalId: 'g-job', goalRevision: 3, originSource: { kind: 'plain' },
  },
];

describe('S6B3 initial source normalization (resolution, not the Job intent)', () => {
  it.each(NORMALIZATION_CASES)('$name', row => {
    const normalized = normalizeInitialPlanningResponseV2(PLAN_RESPONSE, factsFor(row.resolution, row.manifestGoal));
    expect(normalized.status).toBe('plan');
    if (normalized.status !== 'plan') throw new Error(`the ${row.name} facts did not normalize to a plan`);
    expect(normalized.draft.goalId).toBe(row.goalId);
    expect(normalized.origin.goalRevision).toBe(row.goalRevision);
    expect(normalized.origin.workspaceRevision).toBe(11);
    // Every path writes the source key, the ordinary plain one included; absence is only an old record.
    expect(Object.hasOwn(normalized.origin, 'source')).toBe(true);
    expect(normalized.origin.source).toEqual(row.originSource);
    if (row.otherResolution !== undefined) {
      const other = normalizeInitialPlanningResponseV2(PLAN_RESPONSE,
        factsFor(row.otherResolution, row.manifestGoal));
      if (other.status !== 'plan') throw new Error('the second plain facts did not normalize to a plan');
      expect(normalized.draft.planId).not.toBe(other.draft.planId);
    }
  });
});

type IndexCase = {
  name: string;
  resolution: InitialPlanSourceResolutionV1;
  manifestGoal: { ref: GoalRef; revision: number } | null;
  answerPlanDraftIndex: number;
  expectedGoalId: string;
} & ({ expectedRejection: CoreRejection } | { expectedSource: InitialPlanOriginSourceV1 });

const BINDING_REF_OF = (draftIndex: number) => ({ aggregateType: 'InitializationBinding' as const, projectId: PROJECT,
  answerRef: { ...ANSWER_REF }, draftIndex });

const INDEX_CASES: readonly IndexCase[] = [
  {
    name: 'binding: another draft selector does not propose this answer plan',
    resolution: { kind: 'binding', source: { ...BINDING_SOURCE, draftIndex: 1 }, bindingRef: BINDING_REF_OF(1),
      goal: BINDING_GOAL, goalRevision: 1 },
    manifestGoal: null, answerPlanDraftIndex: 2, expectedGoalId: 'g-binding',
    expectedRejection: { status: 'rejected', code: 'invalid', reason: "the answer's plan is not for this draft" },
  },
  {
    name: 'binding: the selector matches draft 1 and the same draft plan',
    resolution: { kind: 'binding', source: { ...BINDING_SOURCE, draftIndex: 1 }, bindingRef: BINDING_REF_OF(1),
      goal: BINDING_GOAL, goalRevision: 1 },
    manifestGoal: null, answerPlanDraftIndex: 1, expectedGoalId: 'g-binding',
    expectedSource: { kind: 'binding', selector: { ...BINDING_SOURCE, draftIndex: 1 }, bindingRef: BINDING_REF_OF(1) },
  },
  {
    name: 'binding: the selector matches draft 2 and the same draft plan',
    resolution: { kind: 'binding', source: BINDING_SOURCE, bindingRef: BINDING_REF_OF(2),
      goal: BINDING_GOAL, goalRevision: 1 },
    manifestGoal: null, answerPlanDraftIndex: 2, expectedGoalId: 'g-binding',
    expectedSource: { kind: 'binding', selector: BINDING_SOURCE, bindingRef: BINDING_REF_OF(2) },
  },
  {
    name: 'binding: draft 0 is compared like every other binding draft',
    resolution: { kind: 'binding', source: { ...BINDING_SOURCE, draftIndex: 0 }, bindingRef: BINDING_REF_OF(0),
      goal: BINDING_GOAL, goalRevision: 1 },
    manifestGoal: null, answerPlanDraftIndex: 2, expectedGoalId: 'g-binding',
    expectedRejection: { status: 'rejected', code: 'invalid', reason: "the answer's plan is not for this draft" },
  },
  {
    name: 'plain: no binding selector, so the answer planDraftIndex is not compared',
    resolution: { kind: 'plain', source: null, bindingRef: null, goal: RESOLVED_GOAL, goalRevision: 7 },
    manifestGoal: null, answerPlanDraftIndex: 9, expectedGoalId: 'g-resolved',
    expectedSource: { kind: 'plain' },
  },
];

describe('S6B3 initial source index match (only a binding selector compares the answer plan draft)', () => {
  it.each(INDEX_CASES)('$name', row => {
    const normalized = normalizeInitialPlanningResponseV2(PLAN_RESPONSE,
      factsFor(row.resolution, row.manifestGoal, row.answerPlanDraftIndex));
    if ('expectedRejection' in row) {
      expect(normalized).toEqual(row.expectedRejection);
      return;
    }
    expect(normalized.status).toBe('plan');
    if (normalized.status !== 'plan') throw new Error(`the ${row.name} facts did not normalize to a plan`);
    expect(normalized.draft.goalId).toBe(row.expectedGoalId);
    expect(normalized.origin.source).toEqual(row.expectedSource);
  });
});

describe('the two propose fingerprints (pure: one exported formula per entry)', () => {
  // The literals are the SHA-256 of the canonical payload, computed OUTSIDE the test from the documented formula; the test never recomputes it.
  const ACTOR = { kind: 'human' as const, id: 'u-fp' };
  const REASON = { text: 'r', sources: [] };
  const MATERIAL = { projectId: PROJECT, workspaceId: WORKSPACE, actor: ACTOR,
    answerRef: ANSWER_REF, reason: REASON, requestId: 'req-fp', expected: [] };
  const SOURCE_ARM_FINGERPRINT = '96b18789ba71dd070141e254053e4f94dcf4fdaba56eaba0d2d8fb56bff5e6bd';
  it('the initial-answer fingerprint without a source equals the hand-computed literal of today formula', () => {
    expect(initialAnswerProposeFingerprint(MATERIAL))
      .toBe('c883a65566a0e5a95db3f280acb91a677bce129396f1da9f52a27eaf603586d9');
  });

  it('a source changes the initial-answer fingerprint and the payload carries that selector', () => {
    // The pair proves both directions: absent omits the key, present binds exactly this selector.
    const withSource = initialAnswerProposeFingerprint({ ...MATERIAL, source: PREPARED_SOURCE });
    const withoutSource = initialAnswerProposeFingerprint(MATERIAL);
    expect(withSource).toBe('348a8bee11d255c4d159c4408d212c07e4078ea13e89e576adc1a6367cbfc99e');
    expect(withSource).not.toBe(withoutSource);
  });

  it('the source-arm fingerprint binds the selector only: no Goal and no draft', () => {
    expect(sourceProposeFingerprint({ projectId: PROJECT, workspaceId: WORKSPACE, actor: ACTOR,
      source: PREPARED_SOURCE, reason: REASON, requestId: 'req-fp', expected: [] })).toBe(SOURCE_ARM_FINGERPRINT);
    // A different draft selector is a different source, hence a different identity; the Goal is not part of it.
    expect(sourceProposeFingerprint({ projectId: PROJECT, workspaceId: WORKSPACE, actor: ACTOR,
      source: BINDING_SOURCE, reason: REASON, requestId: 'req-fp', expected: [] })).not.toBe(SOURCE_ARM_FINGERPRINT);
  });
});
