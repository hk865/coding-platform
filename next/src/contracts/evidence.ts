// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
// ------------------------------------------------------------------------ //
// Aggregate refs / snapshots                                                //
// ------------------------------------------------------------------------ //
export type EvidenceRef = {
    aggregateType: "Evidence";
    projectId: string;
    evidenceId: string;
};
export type TaskEvidenceIndexRef = {
    aggregateType: "TaskEvidenceIndex";
    projectId: string;
    goalId: string;
    taskId: string;
};

// Completed-capability migration: selected original declarations, no legacy service port.
/** Audit association to the VerificationPlan that produced/justified the evidence. */
export type VerificationPlanRefV1 = {
    planId: string;
    planDigest: string;
};
export type EvidenceCoverageV1 = {
    obligationId: string;
    requirementId: string;
};

// Completed-capability migration: selected original declarations, no legacy service port.
import type { PlanRevisionRef } from "./plan.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "./governance.js";
// ------------------------------------------------------------------------ //
// Effectivity anchor                                                        //
// ------------------------------------------------------------------------ //
/**
 * The revision tuple evidence was produced under. It is IMMUTABLE with the
 * evidence. Applicability compares it against the current tuple — nothing is
 * ever written back into history.
 */
export type EffectivityAnchorV1 = {
    schemaVersion: 1;
    planRef: PlanRevisionRef;
    planRevision: number;
    workspaceRevision: number;
    pinnedCompletionPolicy: CompletionPolicyPin;
    pinnedArchitectureBaseline: ArchitectureBaselinePin;
};
