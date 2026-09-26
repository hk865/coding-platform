
// Completed-capability migration: selected original declarations, no legacy service port.
// ------------------------------------------------------------------------ //
// Change scope / risks / semantic classification                             //
// ------------------------------------------------------------------------ //
export type ChangeScopeV1 = {
    /** Machine-readable diff class, e.g. "docs-only" | "code-change" | "contract". */
    diffClass: string;
    /** Bounded file list (<= CHANGE_SCOPE_MAX_FILES). */
    changedFiles: string[];
    /** Bounded human summary (<= CHANGE_SCOPE_SUMMARY_MAX_BYTES). */
    writeSummary: string;
};
export const CHANGE_SCOPE_MAX_FILES = 64;
export type VerificationIssue = {
    path: string;
    message: string;
};

// ------------------------------------------------------------------------ //
// R3e.1 bounded command / round / configuration DTOs                         //
// ------------------------------------------------------------------------ //
import type { ActorRef } from "./command-event.js";
import type { ArtifactRef } from "./artifact.js";
import type { RunRef, TaskTriple } from "./dispatch.js";
import type { PlanRevisionRef } from "./plan.js";
import type { WorkspaceRef } from "./ledger.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "./governance.js";
import type { EvidenceCoverageV1, EvidenceOutcome, EvidenceRef } from "./evidence.js";
import type {
    VerificationRoundMaterialIdentity,
    VerificationRoundSourceProof,
} from "./verification-context.js";

/** Trusted Host actor for a check: a real human/system application host. */
export type CheckHostActor = Extract<ActorRef, { kind: "human" | "system" }>;

/** One registered command check from the frozen trusted configuration. */
export type RegisteredCommandCheck = {
    checkId: string;
    kind: "static" | "dynamic";
    command: string;
    cwd: string;
    timeoutMs: number;
    taskIds: "all" | readonly string[];
};

/** The isolated trusted configuration a round is opened under. It is supplied
 * with the factory and never taken from an open/begin request or model input. */
export type TrustedCheckConfiguration = {
    configurationRevision: string;
    workspace: WorkspaceRef;
    executor: CheckHostActor;
    permissionRevision: string;
    sourceAccess: "verification_workspace";
    processAccess: "all_except_denied";
    deniedPrefixes: readonly string[];
    checks: readonly RegisteredCommandCheck[];
};

/** Next formal round identity. The full ref is the ledger key. */
export type VerificationRoundRef = {
    aggregateType: "VerificationRound";
    projectId: string;
    workspaceId: string;
    goalId: string;
    taskId: string;
    runId: string;
    roundId: string;
};

/** Bounded projection of a real ProcessSandbox execution (or a proven non-start). */
export type CheckProcessObservation =
    | {
        kind: "not_started";
        reason: "sandbox_unavailable" | "launch_failed";
        startedAt: string;
        finishedAt: string;
    }
    | {
        kind: "executed";
        startedAt: string;
        finishedAt: string;
        exitCode: number | null;
        signal: string | null;
        timedOut: boolean;
        cancelled: boolean;
        stdout: { text: string; totalBytes: number; truncated: boolean };
        stderr: { text: string; totalBytes: number; truncated: boolean };
        effects: { workspaceRevision: string | null; changedPaths: string[] };
        sandboxProfileVersion: string;
    };

/**
 * One persisted begin ticket. It freezes the exact configuration/source the
 * check was admitted under so a later permission/source change cannot rewrite
 * an already-executed fact.
 */
export type CheckExecutionTicket = {
    roundRef: VerificationRoundRef;
    checkId: string;
    invocationId: string;
    configurationRevision: string;
    configurationDigest: string;
    executor: CheckHostActor;
    workspace: WorkspaceRef;
    workspaceRoot: string;
    permissionRevision: string;
    sourceDigest: string;
    processAccess: "all_except_denied";
    deniedPrefixes: readonly string[];
    definition: RegisteredCommandCheck;
};

export type RoundCheckSnapshot = {
    checkId: string;
    definition: RegisteredCommandCheck;
    coverage: EvidenceCoverageV1[];
    phase: "pending" | "executing" | "finished" | "interrupted";
    invocationId: string | null;
    outcome: EvidenceOutcome | null;
    reportRef: ArtifactRef | null;
    sourceStatus: "matched" | "changed" | "unavailable" | "permission_changed" | null;
};

export type RoundSnapshot = {
    ref: VerificationRoundRef;
    revision: number;
    schemaVersion: 1;
    subject: TaskTriple;
    subjectRunRef: RunRef;
    adoptedPlanRef: PlanRevisionRef;
    taskBasisRef: PlanRevisionRef;
    executor: CheckHostActor;
    configuration: TrustedCheckConfiguration;
    configurationDigest: string;
    identity: VerificationRoundMaterialIdentity;
    sourceProof: VerificationRoundSourceProof;
    verificationPlan: VerificationPlanV1;
    checks: RoundCheckSnapshot[];
    status: "open" | "finalized";
    outcome: EvidenceOutcome | null;
    gaps: { code: string; message: string; coverage?: EvidenceCoverageV1 }[];
    evidenceRefs: EvidenceRef[];
};

// ------------------------------------------------------------------------ //
// VerificationPlan (pure compiler output shape; R3e.1 restoration)           //
// ------------------------------------------------------------------------ //

export type VerificationCheckKind = "static" | "dynamic" | "reviewer";

export type VerificationCheckPlan = {
    checkId: string;
    kind: VerificationCheckKind;
    satisfiesKind: string;
    coverage: EvidenceCoverageV1[];
    satisfactionPath: "predicate" | "review-packet" | "no-change-fast-path";
    noChangeFastPath?: { diffClass: string; reason: string };
};

export const REVIEWER_SEMANTIC_CHECK_ID = "reviewer-semantic-check";
export const NO_CHANGE_FAST_PATH_CHECK_ID = "no-change-fast-path";

export type RiskV1 = {
    level: "low" | "medium" | "high";
    description: string;
};

export type SemanticChangeClassification = "none" | "semantic";

export type VerificationPlanV1 = {
    schemaVersion: 1;
    /** Content address: the plan digest == planId (deterministic compile). */
    planId: string;
    planDigest: string;
    taskRef: TaskTriple;
    planRef: PlanRevisionRef;
    planRevision: number;
    workspaceRevision: number;
    pinnedCompletionPolicy: CompletionPolicyPin;
    pinnedArchitectureBaseline: ArchitectureBaselinePin;
    changeScope: ChangeScopeV1;
    semanticChange: SemanticChangeClassification;
    risks: RiskV1[];
    checks: VerificationCheckPlan[];
    /** Present only for the explicit registry mode; absent preserves old plan digests. */
    uncovered?: { obligationId: string; requirementId: string; kind: VerificationCheckKind }[];
    configurationDigest?: string;
};

/** Registered check capability handed to the pure VerificationPlan compiler. */
export type CheckCapabilityV1 = {
    checkId: string;
    kind: VerificationCheckKind;
    /** Policy requirement kinds this check can produce PASS/FAIL evidence for. */
    coversKinds: string[];
    replayable: boolean;
};
