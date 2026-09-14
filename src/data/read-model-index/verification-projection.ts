import type { CommitCursor } from '../../contracts/command-event.js';
import type { EffectivityAnchorV1, EvidenceV1 } from '../../contracts/evidence.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { PolicyExplanationPort } from '../../contracts/policy-explanation.js';
import type { ReviewProjectionFacts } from '../../contracts/read-model.js';
import type { TaskReductionSnapshot } from '../../contracts/reduction.js';
import type { EvidenceBindingView, TaskVerificationView } from '../../contracts/verification-view.js';

export type ProjectedEvidence = {
  evidence: EvidenceV1;
  admittedAt: string;
  evidenceIndex: number;
};

export type VerificationProjection = {
  projectId: string;
  goalId: string;
  taskId: string;
  evidence: ProjectedEvidence[];
  reduction: TaskReductionSnapshot | null;
  reductionCursor: CommitCursor | null;
  sourceCursor: CommitCursor;
};

/** Build the storage-independent verification view from projected facts. */
export function buildTaskVerificationView(input: {
  row: VerificationProjection;
  planSnapshot: PlanRevisionSnapshot | null;
  policyExplanation: PolicyExplanationPort;
  review: ReviewProjectionFacts;
}): TaskVerificationView {
  const { row, planSnapshot } = input;
  const currentAnchor = row.reduction?.currentAnchor ?? null;
  const sorted = [...row.evidence].sort((a, b) => a.evidenceIndex - b.evidenceIndex);
  const explanation = input.policyExplanation.explainEvidence({
    evidence: sorted.map((projected) => projected.evidence),
    plan: planSnapshot,
    currentAnchor,
    review: input.review,
  });
  const evidence = sorted.map((projected, index) =>
    toEvidenceBindingView(projected, explanation.bindings[index]!.applicability));
  const reduction = row.reduction === null ? null : {
    phase: row.reduction.phase,
    causes: row.reduction.causes,
    effectiveEvidenceIds: row.reduction.effectiveEvidenceIds,
    blockingEvidenceIds: row.reduction.blockingEvidenceIds,
    staleEvidenceIds: row.reduction.staleEvidenceIds,
    outOfScopeEvidenceIds: row.reduction.outOfScopeEvidenceIds,
    satisfiedObligationIds: row.reduction.satisfiedObligationIds,
    planRef: row.reduction.planRef,
    reducedAt: row.reduction.reducedAt,
    sourceCursor: row.reductionCursor!,
  };
  return {
    projectId: row.projectId,
    goalId: row.goalId,
    taskId: row.taskId,
    currentAnchor,
    planRef: viewPlanRef(row, planSnapshot, currentAnchor),
    planRevision: viewPlanRevision(row, planSnapshot, currentAnchor),
    evidence,
    effectiveEvidenceIds: explanation.effectiveEvidenceIds,
    blockingEvidenceIds: explanation.blockingEvidenceIds,
    reduction,
    sourceCursor: row.sourceCursor,
  };
}

function toEvidenceBindingView(projected: ProjectedEvidence, applicability: EvidenceBindingView['applicability']): EvidenceBindingView {
  const evidence = projected.evidence;
  return {
    evidenceId: evidence.evidenceId,
    kind: evidence.kind,
    outcome: evidence.outcome,
    coverage: evidence.coverage.map((coverage) => ({ ...coverage })),
    applicability,
    anchor: { ...evidence.anchor },
    verificationPlanId: evidence.verificationPlanRef.planId,
    verificationPlanDigest: evidence.verificationPlanRef.planDigest,
    sourceRunRef: evidence.source.runRef,
    checkId: evidence.source.checkId,
    summary: evidence.summary.text,
    artifactRef: evidence.summary.artifactRef,
    admittedAt: projected.admittedAt,
    evidenceIndex: projected.evidenceIndex,
  };
}

function viewPlanRef(row: VerificationProjection, plan: PlanRevisionSnapshot | null, anchor: EffectivityAnchorV1 | null): PlanRevisionRef {
  return plan?.ref ?? anchor?.planRef ?? row.evidence[0]?.evidence.anchor.planRef ??
    { aggregateType: 'PlanRevision', projectId: row.projectId, planId: '' };
}

function viewPlanRevision(row: VerificationProjection, plan: PlanRevisionSnapshot | null, anchor: EffectivityAnchorV1 | null): number {
  return plan?.planRevision ?? anchor?.planRevision ?? row.evidence[0]?.evidence.anchor.planRevision ?? 0;
}
