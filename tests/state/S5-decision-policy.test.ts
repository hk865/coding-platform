/**
 * Slice 5 unit rows PO01..PO16
 * (docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md §5.2).
 *
 * Pure: `decisionActionPolicy` is the one autonomy table and
 * `canSendUserMessage` the trusted-duties admission. The part-1 functions are
 * stubs, so every case currently fails with the stub's `not implemented`.
 */
import { describe, expect, it } from 'vitest';
import type { DecisionActionV1, GoalAutonomyV1 } from '../../src/contracts/goal-decisions.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import type { ReworkActorClass } from '../../src/contracts/task-requeue.js';
import { canSendUserMessage, decisionActionPolicy } from '../../src/core/work-graph/state/decision-policy.js';

// -------------------------------------------------------------------------- //
// Fixtures                                                                   //
// -------------------------------------------------------------------------- //

type PolicyVerdict = 'user_only' | 'needs_decision' | 'automatic' | 'automatic_notice';

function actionPolicy(input: {
  autonomy: GoalAutonomyV1;
  action: DecisionActionV1;
  actorClass?: ReworkActorClass;
  countedNext?: number | null;
  cap?: number;
}): PolicyVerdict {
  return decisionActionPolicy({
    autonomy: input.autonomy,
    action: input.action,
    actorClass: input.actorClass ?? 'human',
    countedNext: input.countedNext ?? null,
    cap: input.cap ?? 3,
  });
}

function send(
  duties: readonly PlatformDutyV1[],
  intent: 'notify' | 'decision_request',
  overrides: { readOnlyCopy?: boolean; independentReview?: boolean } = {},
): boolean {
  return canSendUserMessage({
    duties,
    readOnlyCopy: overrides.readOnlyCopy ?? false,
    independentReview: overrides.independentReview ?? false,
    intent,
  });
}

// -------------------------------------------------------------------------- //
// PO01..PO12 — decisionActionPolicy                                          //
// -------------------------------------------------------------------------- //

describe('S5 decision policy (§5.2 PO01..PO16)', () => {
  it('PO01 every_step adopt_first_plan needs the user', () => {
    expect(actionPolicy({ autonomy: 'every_step', action: 'adopt_first_plan' })).toBe('user_only');
  });

  it('PO02 after_plan_confirmation adopt_first_plan still needs the user', () => {
    expect(actionPolicy({ autonomy: 'after_plan_confirmation', action: 'adopt_first_plan' })).toBe('user_only');
  });

  it('PO03 every_step refine_future is a decision', () => {
    expect(actionPolicy({ autonomy: 'every_step', action: 'refine_future' })).toBe('needs_decision');
  });

  it('PO04 after_plan_confirmation refine_future is automatic', () => {
    expect(actionPolicy({ autonomy: 'after_plan_confirmation', action: 'refine_future' })).toBe('automatic');
  });

  it('PO05 every_step system_requeue at count 1 of cap 3 is a decision', () => {
    expect(actionPolicy({ autonomy: 'every_step', action: 'system_requeue', actorClass: 'system', countedNext: 1, cap: 3 }))
      .toBe('needs_decision');
  });

  it('PO06 after_plan_confirmation agent_requeue at count 2 of cap 3 is an automatic notice', () => {
    expect(actionPolicy({ autonomy: 'after_plan_confirmation', action: 'agent_requeue', actorClass: 'agent', countedNext: 2, cap: 3 }))
      .toBe('automatic_notice');
  });

  it('PO07 after_plan_confirmation auto_reverify past the cap is a decision', () => {
    expect(actionPolicy({ autonomy: 'after_plan_confirmation', action: 'auto_reverify', actorClass: 'system', countedNext: 4, cap: 3 }))
      .toBe('needs_decision');
  });

  it('PO08 after_plan_confirmation structural_patch is a decision', () => {
    expect(actionPolicy({ autonomy: 'after_plan_confirmation', action: 'structural_patch' })).toBe('needs_decision');
  });

  it('PO09 every_step secretary_inquiry is a decision', () => {
    expect(actionPolicy({ autonomy: 'every_step', action: 'secretary_inquiry' })).toBe('needs_decision');
  });

  it('PO10 after_plan_confirmation secretary_action is automatic', () => {
    expect(actionPolicy({ autonomy: 'after_plan_confirmation', action: 'secretary_action' })).toBe('automatic');
  });

  it('PO11 every_step secretary_too_long is only an automatic notice', () => {
    expect(actionPolicy({ autonomy: 'every_step', action: 'secretary_too_long' })).toBe('automatic_notice');
  });

  it('PO12 after_plan_confirmation long_handoff is a decision', () => {
    expect(actionPolicy({ autonomy: 'after_plan_confirmation', action: 'long_handoff' })).toBe('needs_decision');
  });

  // ------------------------------------------------------------------------ //
  // PO13..PO16 — canSendUserMessage                                           //
  // ------------------------------------------------------------------------ //

  it('PO13 an executor cannot send a decision_request', () => {
    expect(send(['executor'], 'decision_request')).toBe(false);
  });

  it('PO14 an adviser can send a decision_request', () => {
    expect(send(['adviser'], 'decision_request')).toBe(true);
  });

  it('PO15 a scribe under independent review cannot notify', () => {
    expect(send(['scribe'], 'notify', { independentReview: true })).toBe(false);
  });

  it('PO16 a reviewer that is not a read-only copy can notify', () => {
    expect(send(['reviewer'], 'notify', { readOnlyCopy: false, independentReview: false })).toBe(true);
  });
});
