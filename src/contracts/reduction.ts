// ------------------------------------------------------------------------ //
// Aggregate                                                                  //
// ------------------------------------------------------------------------ //
export type TaskReductionRef = {
    aggregateType: "TaskReduction";
    projectId: string;
    goalId: string;
    taskId: string;
};

// Completed-capability migration: selected original declarations, no legacy service port.
import type { PlanRevisionRef } from "./plan.js";
import type { Disposition, RequirementLevel, TaskKind } from "./plan.js";
import type { EffectivityAnchorV1, EvidenceRef, VerificationPlanRefV1 } from "./evidence.js";
import type { VerificationRoundRef } from "./verification.js";
// ------------------------------------------------------------------------ //
// Reduction result                                                           //
// ------------------------------------------------------------------------ //
/**
 * The reduction phase is chosen from the four states the evidence rule can
 * produce. It is NEVER merged with the Task's orthogonal phase dimension—
 * it drives the verification view; pending/ready/running remain plan facts.
 */
export type TaskReductionPhase = "verifying" | "blocked" | "failed" | "satisfied";
export type TaskReductionCauseCode = "not_current_plan" | "not_active" | "missing_evidence" | "blocking_evidence" | "stale_or_out_of_scope" | "run_failed_signal" | "unreconciled_side_effect" | "unresolved_finding" | "no_required_obligation";
export type TaskReductionCause = {
    code: TaskReductionCauseCode;
    message: string;
    requirementKey?: string;
    evidenceIds?: string[];
};
// ------------------------------------------------------------------------ //
// Snapshot / command                                                         //
// ------------------------------------------------------------------------ //
/**
 * R3e.3 versioned completion audit, written by the formal completion writer.
 *
 * Required: every `TaskReductionSnapshot@1` row the platform writes carries it.
 * The round ref/revision address the exact adopted check definition and
 * `evidenceRefs` are the actual adopted evidence.
 */
export type TaskCompletionAuditV1 = {
    schemaVersion: 1;
    roundRef: VerificationRoundRef;
    roundRevision: number;
    taskBasisRef: PlanRevisionRef;
    verificationPlanRef: VerificationPlanRefV1;
    configurationDigest: string;
    evidenceRefs: EvidenceRef[];
};

export type TaskReductionSnapshot = {
    ref: TaskReductionRef;
    /** 1 on first reduction; k+1 on each later one (evidence set changed). */
    revision: number;
    schemaVersion: 1;
    planRef: PlanRevisionRef;
    planRevision: number;
    taskKind: TaskKind;
    requirementLevel: RequirementLevel;
    disposition: Disposition;
    phase: TaskReductionPhase;
    currentAnchor: EffectivityAnchorV1;
    effectiveEvidenceIds: string[];
    blockingEvidenceIds: string[];
    staleEvidenceIds: string[];
    outOfScopeEvidenceIds: string[];
    satisfiedObligationIds: string[];
    causes: TaskReductionCause[];
    reducedAt: string;
    /** The formal completion audit; every current-format record carries it. */
    completion: TaskCompletionAuditV1;
};
