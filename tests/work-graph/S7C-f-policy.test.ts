/**
 * F-policy (book-7c.md §5 :1349): the two pure exports `decisionActionPolicy` and `decisionSourceKey`.
 * The inputs are pure values; no store, ctx, Runtime or Host is built here.
 */
import { describe, expect, it } from 'vitest';
import type { DecisionActionV1, GoalAutonomyV1 } from '../../src/contracts/goal-decisions.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { decisionActionPolicy } from '../../src/core/work-graph/state/decision-policy.js';

function policy(action: DecisionActionV1, autonomy: GoalAutonomyV1) {
  return decisionActionPolicy({ autonomy, action, actorClass: 'agent', countedNext: null, cap: 3 });
}

describe('F-policy', () => {
  it('create_member is a decision at every step, a notice after plan confirmation', () => {
    expect(policy('create_member', 'every_step')).toBe('needs_decision');
    expect(policy('create_member', 'after_plan_confirmation')).toBe('automatic_notice');
  });

  // 7D2 O3a R1 (v4 :3367; book :1350–:1351): the B2-01 both-tier row is replaced by layer 4's default. Without
  // `affectedGoals` the tier is `autonomy` (v4 :3719–:3721); layer 4: every-step → card, else not a person →
  // `automatic_notice` (v4 :3735–:3737; book :636–:638, :644–:645).
  /* Named mutation: keep the B2-01 row (role_line_add is needs_decision at both levels) → item 2 goes red. */
  it.each([
    [1, 'role_line_add', 'every_step', 'needs_decision'],
    [2, 'role_line_add', 'after_plan_confirmation', 'automatic_notice'],
  ] as const)('O3a-R1 #%s role_line_add 每步确认出卡，计划确认后自动并通知（7D2 第 4 层）: %s at %s → %s',
    (_n, action, autonomy, expected) => {
      expect(policy(action, autonomy)).toBe(expected);
    });

  it('member_creation keys the operation ref, hand-computed canonical JSON', () => {
    expect(decisionSourceKey({ kind: 'member_creation', operationRef: {
      aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-1' } }))
      .toBe('{"kind":"member_creation","operationRef":{"aggregateType":"CoreOperation","operationId":"op-1","projectId":"p1"}}');
  });

  it('rework_request keys the request ref', () => {
    expect(decisionSourceKey({ kind: 'rework_request', requestRef: {
      aggregateType: 'ReworkRequest', projectId: 'p1', goalId: 'g1', taskId: 't1', requestId: 'r1' } }))
      .toBe('{"kind":"rework_request","requestRef":{"aggregateType":"ReworkRequest","goalId":"g1","projectId":"p1","requestId":"r1","taskId":"t1"}}');
  });

  it('handoff_approval keys the operation ref', () => {
    expect(decisionSourceKey({ kind: 'handoff_approval', operationRef: {
      aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-2' } }))
      .toBe('{"kind":"handoff_approval","operationRef":{"aggregateType":"CoreOperation","operationId":"op-2","projectId":"p1"}}');
  });

  it('adviser_creation keys the requeue trigger', () => {
    expect(decisionSourceKey({ kind: 'adviser_creation', trigger: { kind: 'requeue', ref: {
      aggregateType: 'TaskRequeue', projectId: 'p1', goalId: 'g1', taskId: 't1', afterRunId: 'run-1' } } }))
      .toBe('{"kind":"requeue","ref":{"afterRunId":"run-1","aggregateType":"TaskRequeue","goalId":"g1","projectId":"p1","taskId":"t1"}}');
  });

  it('adviser_creation keys the round trigger', () => {
    expect(decisionSourceKey({ kind: 'adviser_creation', trigger: { kind: 'round', ref: {
      aggregateType: 'VerificationRound', projectId: 'p1', workspaceId: 'w1', goalId: 'g1', taskId: 't1',
      runId: 'run-2', roundId: 'round-1' } } }))
      .toBe('{"kind":"round","ref":{"aggregateType":"VerificationRound","goalId":"g1","projectId":"p1","roundId":"round-1","runId":"run-2","taskId":"t1","workspaceId":"w1"}}');
  });
});
