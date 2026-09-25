// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
/**
 * Retained TaskEnvelope data format (versioned execution binding).
 * Target ownership: WorkGraph accepted facts; AgentRuntime consumes the binding.
 *   - bounded envelope: binds WorkspaceSnapshot revision, permissions, budget,
 *     source refs; HARD size cap; contains NO full transcript;
 *   - the envelope references the accepted role template/binding versions via
 *     the minimal RoleBindingRefV1 (no full RoleBinding contract in dispatch);
 *   - immutable bundle body precedes its accepted Run binding; reading a body
 *     does not accept or start the Run.
 */
import type { ArtifactRef } from "./artifact.js";
import type { RoleBindingRefV1, RunRef, SourceRefV1, TaskAttemptRef, TaskBudgetV1 } from "./dispatch.js";
import type { PlanRevisionRef } from "./plan.js";
export type TaskEnvelopeV1 = {
    work?: import('./reviewer-work.js').ReviewWorkBinding;
    reviewInput?: import('./reviewer-work.js').ReviewInputBinding;
    schemaVersion: 1;
    envelopeId: string;
    projectId: string;
    workspaceId: string;
    goalId: string;
    taskId: string;
    runRef: RunRef;
    attemptRef: TaskAttemptRef;
    planRef: PlanRevisionRef;
    roleBinding: RoleBindingRefV1;
    /** Canonical Workspace revision bound at assemble time (verified == current). */
    workspaceSnapshot: {
        workspaceId: string;
        revision: number;
    };
    permissions: {
        policyRevision: string;
        tools: string[];
        writeScope: string[];
    };
    budget: TaskBudgetV1;
    /** Selected versioned sources (compact; NO transcript). */
    sourceRefs: SourceRefV1[];
    /** Vault ref of the bounded bundle body (assembled Context, no transcript). */
    bundleRef: ArtifactRef;
};
