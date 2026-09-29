
// Completed-capability migration: selected original declarations, no legacy service port.
import type { VerificationScope } from './verification-import.js';
import type { VerificationIssue, ChangeScopeV1 } from './verification.js';
export type ReadonlySourceRead = {
    path: string;
    revision: string;
    startLine: number;
    endLine: number;
    callId: string;
};
export interface ReadonlyReadWitnessPort {
    assertCurrent(scope: VerificationScope, reads: readonly ReadonlySourceRead[]): Promise<{
        completeReadPaths: string[];
    }>;
}
/** The comparison is explicit. Neither variant proves the Run's before-state. */
export type VerificationRoundSourceProof = {
    kind: 'git-head-worktree';
    baseCommit: string;
    changedFiles: string[];
    comparison: 'current-head-to-worktree';
    runBaselineKnown: false;
} | {
    kind: 'current-workspace-only';
    runBaselineKnown: false;
};
export type VerificationRoundSourceResult = {
    status: 'ready';
    sourceDigest: string;
    sourceProof: VerificationRoundSourceProof;
    changeScope: ChangeScopeV1;
    gaps: string[];
} | {
    status: 'incomplete';
    code: 'source_unavailable';
    missing: string[];
} | {
    status: 'rejected';
    code: 'source_changed';
    issues: VerificationIssue[];
};
/** WorkspaceReader only observes files/Git metadata; no checks or state writes. */
export interface VerificationRoundSourcePort {
    capture(root: string): Promise<VerificationRoundSourceResult>;
}

// Completed-capability migration: selected original declarations, no legacy service port.
import type { RunRef } from './dispatch.js';
import type { PlanRevisionRef } from './plan.js';
import type { CompletionPolicyPin } from './governance.js';
import type { ArchitectureBaselinePin } from './governance.js';
export type VerificationRoundScope = VerificationScope & {
    taskId: string;
    gateSubject?: 'goal' | 'stage' | 'module';
};
/** Versioned canonical and filesystem identities, rechecked before every use. */
export type VerificationRoundMaterialIdentity = {
    prerequisiteDigest?: string;
    schemaVersion: 1;
    scope: VerificationRoundScope;
    runRef: RunRef;
    runRevision: number;
    runDigest: string;
    planRef: PlanRevisionRef;
    planRevision: number;
    planDigest: string;
    taskDigest: string;
    goalRevision: number;
    goalDigest: string;
    workspaceRevision: number;
    /** Digest of the canonical Workspace record, distinct from sourceDigest. */
    workspaceDigest: string;
    workspaceRoot: string;
    policyPin: CompletionPolicyPin;
    baselinePin: ArchitectureBaselinePin;
    sourceDigest: string;
    sourceProofDigest: string;
};
