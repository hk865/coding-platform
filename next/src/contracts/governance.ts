// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
// ------------------------------------------------------------------------ //
// Revision identity / pins                                                  //
// ------------------------------------------------------------------------ //
export type CompletionPolicyRevisionRef = {
    aggregateType: "CompletionPolicyRevision";
    projectId: string;
    policyId: string;
    revision: number;
};
export type ArchitectureBaselineRevisionRef = {
    aggregateType: "ArchitectureBaselineRevision";
    projectId: string;
    baselineId: string;
    revision: number;
};
export type ProjectCompletionPolicyActiveRef = {
    aggregateType: "ProjectCompletionPolicyActive";
    projectId: string;
};
export type ProjectArchitectureBaselineActiveRef = {
    aggregateType: "ProjectArchitectureBaselineActive";
    projectId: string;
};

// Completed-capability migration: selected original declarations, no legacy service port.
/** Exact pin: identity/revision/digest triple — the only admissible ref form. */
export type CompletionPolicyPin = {
    ref: CompletionPolicyRevisionRef;
    digest: string;
};
export type ArchitectureBaselinePin = {
    ref: ArchitectureBaselineRevisionRef;
    digest: string;
};

// Completed-capability migration: selected original declarations, no legacy service port.
// ------------------------------------------------------------------------ //
// Fixtures                                                                 //
// ------------------------------------------------------------------------ //
export type CompletionPolicyContentV1 = {
    schemaVersion: 1;
    /**
     * Evidence requirement kinds this policy recognizes when an
     * AcceptanceObligation is compiled into VerificationRequirements.
     * (mutable array: canonicalJson requires JsonValue-compatible shapes)
     */
    requirementKinds: string[];
    /** Minimum number of REQUIRED VerificationRequirements per required obligation. */
    minimumRequiredRequirementsPerObligation: number;
    /** verification (optional, additive): diff classes a mechanical no-change proof may
     * fast-path for reviewer-layer requirements. Absent => NO fast path (the
     * the original fixture keeps this field absent so its digest remains unchanged). */
    fastPathDiffClasses?: string[];
};
