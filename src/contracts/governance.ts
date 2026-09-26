// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
import { canonicalJson, sha256Hex, type JsonValue } from "./fingerprint.js";
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

// ------------------------------------------------------------------------ //
// Persisted snapshots (StateLedger/RecordStore wire shapes)                 //
// ------------------------------------------------------------------------ //

/**
 * Immutable completed-capability revision row. `revision` is the AGGREGATE row
 * revision (always 1 because an installed revision is never rewritten) and is
 * deliberately distinct from `contentRevision`, which is part of the policy's
 * content identity and never changes.
 */
export type CompletionPolicyRevisionSnapshot = {
    ref: CompletionPolicyRevisionRef;
    /** Aggregate revision: an installed revision is immutable -> always 1. */
    revision: 1;
    schemaVersion: 1;
    policyId: string;
    /** Fixture content revision (part of the identity; never mutated). */
    contentRevision: number;
    contentDigest: string;
    content: CompletionPolicyContentV1;
};

/**
 * Project-scoped default CompletionPolicy pointer. It exists only after the
 * first activation: `activeRevision` is never null and `revision` is 1 on the
 * first activation and k+1 on each later activation (kind-CAS).
 */
export type ProjectCompletionPolicyActiveSnapshot = {
    ref: ProjectCompletionPolicyActiveRef;
    projectId: string;
    /** Always non-null: the aggregate only exists after the first activation. */
    activeRevision: CompletionPolicyRevisionRef;
    /** 1 on first activation, k+1 on each subsequent activation (kind-CAS). */
    revision: number;
};

// ------------------------------------------------------------------------ //
// Digest                                                                    //
// ------------------------------------------------------------------------ //

/**
 * Canonical content digest of one CompletionPolicy revision: JCS + SHA-256 over
 * the FULL policy fixture `{schemaVersion, identity:{policyId}, revision, content}`.
 *
 * This is the ONE algorithm: `plan-readers.ts` verifies stored rows with it and
 * the bootstrap writer computes the same bytes when installing a revision. The
 * `revision` folded here is the fixture `contentRevision`, never the immutable
 * row's aggregate revision.
 */
export function completionPolicyContentDigest(input: {
    schemaVersion: number;
    policyId: string;
    contentRevision: number;
    content: CompletionPolicyContentV1;
}): string {
    return sha256Hex(canonicalJson({
        schemaVersion: input.schemaVersion,
        identity: { policyId: input.policyId },
        revision: input.contentRevision,
        content: input.content,
    } as unknown as JsonValue));
}
