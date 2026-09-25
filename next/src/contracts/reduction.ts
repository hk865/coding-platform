// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
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
import type { EffectivityAnchorV1 } from "./evidence.js";
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
};
