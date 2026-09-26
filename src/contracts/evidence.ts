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
import type { ActorRef } from "./command-event.js";
import type { ArtifactRef } from "./artifact.js";
import type { RunRef, TaskTriple } from "./dispatch.js";
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

// ------------------------------------------------------------------------ //
// Evidence (R3e.1 restoration: selected original declarations)              //
// ------------------------------------------------------------------------ //

/** Hard per-task evidence cap — the reducer/index stay bounded by design. */
export const MAX_EVIDENCE_PER_TASK = 512;
/** Bounded summary text cap (full body goes to the vault). */
export const EVIDENCE_SUMMARY_MAX_BYTES = 4096;

export type EvidenceKind = "claim" | "observation" | "verdict";
export type EvidenceOutcome = "PASS" | "FAIL" | "INCONCLUSIVE";

export const EVIDENCE_KINDS: readonly EvidenceKind[] = ["claim", "observation", "verdict"];
export const EVIDENCE_OUTCOMES: readonly EvidenceOutcome[] = ["PASS", "FAIL", "INCONCLUSIVE"];

export type EvidenceSourceV1 = {
    actor: ActorRef;
    /** The run that produced the report (null for system/mechanical checks). */
    runRef: RunRef | null;
    /** The check/tool id that produced an observation (null otherwise). */
    checkId: string | null;
};

export type EvidenceSummaryV1 = {
    /** Bounded summary (utf-8 bytes <= EVIDENCE_SUMMARY_MAX_BYTES). */
    text: string;
    /** Vault body ref — the authoritative full material (body-first rule). */
    artifactRef: ArtifactRef | null;
};

export type EvidenceV1 = {
    schemaVersion: 1;
    evidenceId: string;
    kind: EvidenceKind;
    outcome: EvidenceOutcome;
    source: EvidenceSourceV1;
    /** The task this evidence is ABOUT (full-scope triple). */
    subject: TaskTriple;
    /** Non-empty; every entry must reference an obligation/VR of the anchor plan. */
    coverage: EvidenceCoverageV1[];
    anchor: EffectivityAnchorV1;
    verificationPlanRef: VerificationPlanRefV1;
    summary: EvidenceSummaryV1;
};

/** Immutable per-evidence aggregate (created once at revision 1 — never mutated). */
export type EvidenceSnapshot = {
    ref: EvidenceRef;
    revision: 1;
    schemaVersion: 1;
    evidence: EvidenceV1;
    admittedAt: string;
};

/** Per-task admission index: evidenceIds in strict admission order (revision == count). */
export type TaskEvidenceIndexSnapshot = {
    ref: TaskEvidenceIndexRef;
    revision: number;
    schemaVersion: 1;
    evidenceIds: string[];
};

// ------------------------------------------------------------------------ //
// EvidenceBinding (DERIVED)                                                  //
// ------------------------------------------------------------------------ //

export type EvidenceApplicability = "APPLICABLE" | "STALE" | "OUT_OF_SCOPE";

export type EvidenceBindingV1 = {
    schemaVersion: 1;
    evidenceId: string;
    subject: TaskTriple;
    coverage: EvidenceCoverageV1[];
    anchor: EffectivityAnchorV1;
    applicability: EvidenceApplicability;
};

// ------------------------------------------------------------------------ //
// Effective evidence set (PURE)                                              //
// ------------------------------------------------------------------------ //

export type RequirementKey = { obligationId: string; requirementId: string };

export function requirementKeyOf(c: RequirementKey): string {
    return c.obligationId + "\u0000" + c.requirementId;
}

export type EffectiveEvidenceSet = {
    /** Evidence ids in the effective PASS coverage (ordered by admission). */
    effectiveEvidenceIds: string[];
    /** requirementKey -> the APPLICABLE PASS evidence id that occupies the slot. */
    coverageByRequirement: Record<string, string>;
    /**
     * requirementKey -> applicable FAIL/INCONCLUSIVE evidence ids. This batch
     * has NO persisted versioned supersession rule, so EVERY applicable
     * FAIL/INCONCLUSIVE stays here; a later applicable PASS takes the coverage
     * slot but never deletes a blocker. Claims stay neutral.
     */
    blockingByRequirement: Record<string, string[]>;
    staleEvidenceIds: string[];
    outOfScopeEvidenceIds: string[];
};
