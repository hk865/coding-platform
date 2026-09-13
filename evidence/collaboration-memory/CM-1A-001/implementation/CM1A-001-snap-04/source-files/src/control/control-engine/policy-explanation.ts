import type { PolicyExplanationPort, EvidenceExplanationRequest, EvidenceExplanation, PlanChangeExplanationRequest } from '../../contracts/policy-explanation.js';
import type { TaskDispositionRow } from '../../contracts/goal-change.js';
import { evidenceApplicability, selectEffectiveEvidenceSet } from './policies/evidence.js';
import { computeTaskDispositions } from './policies/goal-change.js';
import { qualifyProjectedReviewEvidence } from './policies/reviewer-evidence.js';

/** Read-only Control interface. Uses the same policies as canonical admission
 * and reduction, while accepting only the facts a projection has observed. */
export class ControlPolicyExplanation implements PolicyExplanationPort {
  explainEvidence({ evidence, plan, currentAnchor, review }: EvidenceExplanationRequest): EvidenceExplanation {
    if (!plan || !currentAnchor) return {
      bindings: evidence.map(item => ({ evidenceId: item.evidenceId, applicability: null })),
      effectiveEvidenceIds: [], blockingEvidenceIds: []
    };
    const effective = selectEffectiveEvidenceSet(qualifyProjectedReviewEvidence(evidence, plan, review), plan, currentAnchor);
    return {
      bindings: evidence.map(item => ({ evidenceId: item.evidenceId, applicability: evidenceApplicability(item, plan, currentAnchor) })),
      effectiveEvidenceIds: effective.effectiveEvidenceIds,
      blockingEvidenceIds: Object.values(effective.blockingByRequirement).flat()
    };
  }

  explainPlanChange({ source, target, pausedTaskIds }: PlanChangeExplanationRequest): TaskDispositionRow[] {
    return computeTaskDispositions(source, target, pausedTaskIds);
  }
}
