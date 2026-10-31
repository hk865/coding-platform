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

  it('role_line_add waits for the person at both autonomy levels (B2-01)', () => {
    expect(policy('role_line_add', 'every_step')).toBe('needs_decision');
    expect(policy('role_line_add', 'after_plan_confirmation')).toBe('needs_decision');
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
