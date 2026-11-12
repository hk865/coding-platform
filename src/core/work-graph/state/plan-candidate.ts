/**
 * Mechanical plan diagnosis and the candidate decision (slice-PL-SPEC §6.2,
 * §6.1.3).
 *
 * Diagnosis's one rule: every REQUIRED verification requirement must have a registered
 * check that covers it; reviewer requirements are covered by the review item
 * (slice 9), so every uncovered required requirement reports `no_registered_check`. Coverage is
 * compiled by the same pure function the VerificationPlan compiler uses.
 *
 * `checks: null` means the registered coverage is unknown: it is not an empty
 * configuration and it never becomes an empty finding list. `checks: []` means
 * checks are configured but none is registered, so every required requirement
 * is diagnosed. `emptyRequiredObligation` belongs to plan validation and never
 * becomes a finding. The candidate's catalog pin is review-input fact only;
 * module existence is not checked here.
 */
import type { KnowledgePinV1 } from '../../../contracts/knowledge.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../../contracts/plan.js';
import type { PlanDiagnosisFindingV1, PlanReviewReadV1 } from '../../../contracts/plan-review.js';
import type { PlanFixReadV1 } from '../../../contracts/plan-round.js';
import { systemRoundRequestId } from '../../../contracts/plan-round.js';
import type { CheckCapabilityV1 } from '../../../contracts/verification.js';
import { compileVerificationCoverage } from '../../../contracts/verification.js';
import type { PlanProposalRef } from './plan-machine.js';

// ------------------------------------------------------------------------ //
// The pure plan-candidate decision (slice-PL-SPEC §6.1.3)                   //
// ------------------------------------------------------------------------ //

/** The candidate's origin; the loop's table does not branch on it, the card does. */
export type PlanCandidateSourceV1 = 'agent_proposal' | 'refine' | 'fix' | 'planresume' | 'other';

/** Facts the caller reads in full; the decision reads no storage. */
export type PlanCandidateFactsV1 = {
  proposal: {
    ref: PlanProposalRef;
    revision: number;
    basedOn: PlanRevisionRef | null;
    source: PlanCandidateSourceV1;
    /** `reason.affectedTaskIds`, written by the model; absent is `[]`. */
    affectedTaskIds: readonly string[];
  };
  /** This version's (`proposalRef` + `revision`) review read; four states, mutually exclusive (§6.1.2 step 5). */
  review: PlanReviewReadV1;
  /** This version's fix read; only read when `review` is `fix`, otherwise null (§6.1.2 step 5b). */
  fix: PlanFixReadV1 | null;
  /** Fix rounds on the same `basedOn` that already wrote a candidate (§6.3.4). */
  completedFixes: number;
  /** `decisionActionPolicy({ action: 'refine_future', ... })`. */
  adoptionPolicy: 'automatic' | 'automatic_notice' | 'needs_decision' | 'user_only';
  /** Whether the workspace has a review line (`resolveDutyRecipient({ duty: 'reviewer' })`). */
  hasReviewLine: boolean;
  /** §6.2 output; `[]` = no finding, `null` = coverage unknown, never adopts (§6.2 end). */
  diagnosis: readonly PlanDiagnosisFindingV1[] | null;
};

/** The table's one output; adoption exits (`busy`/rejected) are not this function's (§6.1.4). */
export type PlanCandidateDecisionV1 =
  | { action: 'request_review'; requestId: string }
  | { action: 'request_fix'; requestId: string; rounds: number }
  | { action: 'adopt' }
  | { action: 'card';
      reason: 'no_review_line' | 'fix_cap' | 'fix_invalid' | 'not_automatic' | 'diagnosis' | 'adoption_rejected' | 'review_invalid' }
  | { action: 'wait'; reason: 'busy' | 'review' | 'fix' };

/**
 * One `planreview:`/`planfix:` request id. `SystemRoundV1` carries the Goal for
 * every round, while the frozen candidate facts carry only the proposal; for
 * these two kinds the shared constructor never reads the Goal, and the id is
 * exactly `kind:proposalId:revision`. The Goal id is therefore empty here.
 */
function roundRequestId(
  kind: 'planreview' | 'planfix',
  proposal: PlanCandidateFactsV1['proposal'],
): ReturnType<typeof systemRoundRequestId> {
  return systemRoundRequestId({
    kind,
    goalRef: { aggregateType: 'Goal', projectId: proposal.ref.projectId, goalId: '' },
    proposalId: proposal.ref.proposalId,
    proposalRevision: proposal.revision,
  });
}

/** The decision table, first match wins (§6.1.3). */
export function decidePlanCandidate(facts: PlanCandidateFactsV1): PlanCandidateDecisionV1 {
  const { review } = facts;

  if (review.status === 'not_sent') {
    // No review line: never invent "review passed"; the candidate goes to a card.
    if (!facts.hasReviewLine) return { action: 'card', reason: 'no_review_line' };
    const requestId = roundRequestId('planreview', facts.proposal);
    if (requestId.status !== 'ready') return { action: 'card', reason: 'review_invalid' };
    return { action: 'request_review', requestId: requestId.value };
  }
  if (review.status === 'waiting') return { action: 'wait', reason: 'review' };
  if (review.status === 'terminal_invalid') return { action: 'card', reason: 'review_invalid' };

  if (review.verdict === 'fix') {
    // The cap is judged before the fix read: an already sent fix is not re-sent.
    if (facts.completedFixes >= 3) return { action: 'card', reason: 'fix_cap' };
    // A fix verdict always carries its read; a missing one cannot be sent or waited on.
    if (facts.fix === null) return { action: 'card', reason: 'fix_invalid' };
    if (facts.fix.status === 'not_sent') {
      const requestId = roundRequestId('planfix', facts.proposal);
      if (requestId.status !== 'ready') return { action: 'card', reason: 'fix_invalid' };
      return { action: 'request_fix', requestId: requestId.value, rounds: facts.completedFixes + 1 };
    }
    if (facts.fix.status === 'waiting') return { action: 'wait', reason: 'fix' };
    return { action: 'card', reason: 'fix_invalid' };
  }

  // A pass: review findings are opinions, not diagnosis; only a clean diagnosis
  // and an automatic refinement policy adopt.
  if (facts.adoptionPolicy !== 'automatic') return { action: 'card', reason: 'not_automatic' };
  if (facts.diagnosis === null || facts.diagnosis.length > 0) {
    return { action: 'card', reason: 'diagnosis' };
  }
  return { action: 'adopt' };
}

const NO_REGISTERED_CHECK_MESSAGE = '没有已注册的检查能覆盖这条必需验证要求。';

/** Read-only facts only: no storage, no clock, no tools, no module lookup. */
export function diagnosePlanCandidate(input: {
  /** The candidate draft's obligations and their verification requirements. */
  candidate: Pick<PlanRevisionDraft, 'obligations'>;
  /** The knowledge files the candidate was checked against; a review-input fact only. */
  catalogPin: KnowledgePinV1 | null;
  /** The resolved policy's requirement kinds. */
  requirementKinds: readonly string[];
  /** Registered check capabilities; `null` means the coverage is unknown. */
  checks: readonly CheckCapabilityV1[] | null;
}): PlanDiagnosisFindingV1[] | null {
  if (input.checks === null) return null;
  const coverage = compileVerificationCoverage({
    obligations: input.candidate.obligations,
    requirementKinds: input.requirementKinds,
    checks: input.checks,
  });
  return coverage.uncovered.map(entry => ({
    obligationId: entry.obligationId,
    requirementId: entry.requirementId,
    kind: entry.kind,
    code: 'no_registered_check',
    message: NO_REGISTERED_CHECK_MESSAGE,
  }));
}
