import type { EffectivityAnchorV1, EvidenceApplicability, EvidenceV1 } from './evidence.js';
import type { PlanRevisionSnapshot } from './plan.js';
import type { TaskDispositionRow } from './goal-change.js';

export type EvidenceExplanationRequest = {
  review?: import('./read-model.js').ReviewProjectionFacts;
  /** Evidence in admission order; the explanation never removes history. */
  evidence: EvidenceV1[];
  plan: PlanRevisionSnapshot | null;
  currentAnchor: EffectivityAnchorV1 | null;
};
export type EvidenceExplanation = {
  /** One entry per input, in the same order. Missing current facts yield null. */
  bindings: Array<{ evidenceId: string; applicability: EvidenceApplicability | null }>;
  effectiveEvidenceIds: string[];
  blockingEvidenceIds: string[];
};
export type PlanChangeExplanationRequest = {
  source: PlanRevisionSnapshot;
  target: PlanRevisionSnapshot;
  pausedTaskIds: string[];
};

/** Control's synchronous, stateless policy interpretation for projected facts.
 * ReadModel depends on this Control capability for display only. An explanation
 * neither admits evidence nor authorizes a command or changes a canonical phase.
 * There is no Ledger, clock, cursor or mutation capability in this boundary. */
export interface PolicyExplanationPort {
  explainEvidence(request: EvidenceExplanationRequest): EvidenceExplanation;
  explainPlanChange(request: PlanChangeExplanationRequest): TaskDispositionRow[];
}
