/**
 * E6-plan (slice 9 G2; rulings §4.3 E6, TS §3.3; book 1252; SPEC §3.4 A :281-302, G :396-403): `compileVerificationPlan`
 * keeps only the obligations whose `taskIds` hold the round's Task, then the shared coverage compiler turns the
 * required reviewer requirements into exactly one item `{checkId:'review-packet', kind:'reviewer',
 * satisfiesKind:'reviewer', coverage, satisfactionPath:'review-packet'}` whatever the registered checks are; a reviewer
 * requirement is never `uncovered`. Command items keep their own coverage. `diagnosePlanCandidate` reads the same
 * coverage, so a reviewer requirement is no finding and `reviewer_not_supported` is gone.
 *
 * World `W-pure` (rule sheet A5): one hand-written adopted Plan. ob1 and ob2 belong to t1 and both carry the required
 * reviewer requirement r1 (two pairs, SPEC :292), plus a static (ob1/s1) and a dynamic (ob2/d2) requirement; ob3 is
 * t2's, with reviewer r3 only; ob4 is t1's but optional (a non-required reviewer: no item, not `uncovered`). The
 * registered checks are `lint` (static) and `unit` (dynamic); none covers `reviewer`. Expected values by hand.
 *
 * Named mutations: leave reviewer requirements in `uncovered` (the t1 reviewer-item toEqual is red); emit one item per
 * pair (two items; the same toEqual is red); drop the `taskIds` filter (t1's item also gets ob3/r3 and t2 gets `lint`
 * and `unit`; the t1 and t2 rows are red); emit the item only when `requirementKinds` holds `reviewer` (only the
 * no-reviewer-kind row is red).
 */
import { describe, expect, it } from 'vitest';
import type { AcceptanceObligation, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { CheckCapabilityV1 } from '../../src/contracts/verification.js';
import { compileVerificationPlan } from '../../src/core/work-graph/evidence/verification-plan.js';
import { diagnosePlanCandidate } from '../../src/core/work-graph/state/plan-candidate.js';

const P = 's9-project', G = 's9-goal';
const PLAN_REF = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' } as const;
const required = (requirementId: string, kind: string) =>
  ({ requirementId, requirementLevel: 'required' as const, kind, description: requirementId });
const obligation = (obligationId: string, requirementLevel: 'required' | 'optional', taskId: string,
  ...verificationRequirements: ReturnType<typeof required>[]): AcceptanceObligation =>
  ({ obligationId, title: obligationId, requirementLevel, taskIds: [taskId], verificationRequirements });
const OBLIGATIONS = [
  obligation('ob1', 'required', 't1', required('s1', 'static'), required('r1', 'reviewer')),
  obligation('ob2', 'required', 't1', required('d2', 'dynamic'), required('r1', 'reviewer')),
  obligation('ob3', 'required', 't2', required('r3', 'reviewer')),
  obligation('ob4', 'optional', 't1', required('r4', 'reviewer')),
];
const task = (taskId: string): RuntimeTask => ({ taskId, title: taskId, requirementLevel: 'required', taskKind: 'work',
  disposition: 'active', phase: 'pending', scope: { kind: 'goal' } });
const PLAN: PlanRevisionSnapshot = {
  ref: PLAN_REF, revision: 1, schemaVersion: 2, goalRef: { aggregateType: 'Goal', projectId: P, goalId: G },
  planId: 'plan-1', planRevision: 1, acceptedAt: '2026-11-12T00:00:00.000Z',
  effectiveCompletionPolicy: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: P, policyId: 'policy-1',
    revision: 1 }, digest: 'e'.repeat(64) },
  effectiveArchitectureBaseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: P,
    baselineId: 'baseline-1', revision: 1 }, digest: 'f'.repeat(64) },
  stages: [], tasks: [task('t1'), task('t2')], obligations: OBLIGATIONS,
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
};
const CHECKS: CheckCapabilityV1[] = [
  { checkId: 'lint', kind: 'static', coversKinds: ['static'], replayable: false },
  { checkId: 'unit', kind: 'dynamic', coversKinds: ['dynamic'], replayable: false },
];
const KINDS = ['static', 'dynamic', 'reviewer'];

const planOf = (taskId: string, requirementKinds = KINDS, obligations = OBLIGATIONS, checks = CHECKS) => {
  const result = compileVerificationPlan({ schemaVersion: 1, taskRef: { projectId: P, goalId: G, taskId },
    planRef: PLAN_REF, planSnapshot: { ...PLAN, obligations }, workspaceRevision: 3,
    changeScope: { diffClass: 'code-change', changedFiles: ['src/a.ts'], writeSummary: 'edit a' },
    semanticChange: 'semantic', checkCapabilities: checks, policy: { requirementKinds } });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(`compile rejected: ${result.code}`);
  return result.plan;
};
const reviewItem = (...coverage: { obligationId: string; requirementId: string }[]) =>
  ({ checkId: 'review-packet', kind: 'reviewer', satisfiesKind: 'reviewer', coverage, satisfactionPath: 'review-packet' });
const T1_REVIEW = reviewItem({ obligationId: 'ob1', requirementId: 'r1' }, { obligationId: 'ob2', requirementId: 'r1' });

describe('E6-plan: the reviewer requirement compiles into one review-packet item', () => {
  it('t1: one item with ob1/r1 and ob2/r1; command items keep their own pairs; no reviewer is uncovered', () => {
    const plan = planOf('t1');
    expect(plan.checks.filter(item => item.kind === 'reviewer')).toEqual([T1_REVIEW]);
    expect(plan.checks.filter(item => item.kind !== 'reviewer')).toEqual([
      { checkId: 'lint', kind: 'static', satisfiesKind: 'static', coverage: [{ obligationId: 'ob1', requirementId: 's1' }],
        satisfactionPath: 'predicate' },
      { checkId: 'unit', kind: 'dynamic', satisfiesKind: 'dynamic', coverage: [{ obligationId: 'ob2', requirementId: 'd2' }],
        satisfactionPath: 'predicate' },
    ]);
    expect((plan.uncovered ?? []).filter(entry => entry.kind === 'reviewer')).toEqual([]);
  });

  it('t1 under a policy whose requirementKinds lack reviewer: the same one item (TS §3.3, the branch is unconditional)',
    () => {
      expect(planOf('t1', ['static', 'dynamic']).checks.filter(item => item.kind === 'reviewer')).toEqual([T1_REVIEW]);
    });

  // A trusted check may itself be named `review-packet` (registration only asks for a non-empty id). Named mutation:
  // key the review item by its `checkId` again -> static first, the review pair joins the command and no review item
  // is left; reviewer first, the static pair joins the review item and no command item is left. Both rows are red.
  it.each([
    { order: 'static first', requirements: [required('s5', 'static'), required('r5', 'reviewer')] },
    { order: 'reviewer first', requirements: [required('r5', 'reviewer'), required('s5', 'static')] },
  ])('a command named review-packet and the review item stay apart ($order)', ({ requirements }) => {
    const plan = planOf('t1', KINDS, [obligation('ob5', 'required', 't1', ...requirements)],
      [{ checkId: 'review-packet', kind: 'static', coversKinds: ['static'], replayable: false }]);
    expect(plan.checks.filter(item => item.kind === 'reviewer'))
      .toEqual([reviewItem({ obligationId: 'ob5', requirementId: 'r5' })]);
    expect(plan.checks.filter(item => item.kind !== 'reviewer')).toEqual([{ checkId: 'review-packet', kind: 'static',
      satisfiesKind: 'static', coverage: [{ obligationId: 'ob5', requirementId: 's5' }], satisfactionPath: 'predicate' }]);
  });

  it('t2: only its own pair ob3/r3 is left', () => {
    const plan = planOf('t2');
    expect(plan.checks).toEqual([reviewItem({ obligationId: 'ob3', requirementId: 'r3' })]);
    expect(plan.uncovered ?? []).toEqual([]);
  });

  it('diagnosePlanCandidate finds nothing: no reviewer_not_supported', () => {
    expect(diagnosePlanCandidate({ candidate: { obligations: OBLIGATIONS }, catalogPin: null, requirementKinds: KINDS,
      checks: CHECKS })).toEqual([]);
  });
});
