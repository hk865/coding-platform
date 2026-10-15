
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
import type { NewBasisInputRefV1, NoProgressCheckFactV1, SourceStampV1 } from "./no-progress.js";
import type { ResourceCapsReportV1 } from "./resource-caps.js";
import type { ReworkActorClass, ReworkFailureClass } from "./task-requeue.js";

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
        /** L10/L16：登记的检查原样抄下上限报告；旧记录没有这一项。 */
        resourceCaps?: ResourceCapsReportV1;
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

/**
 * Why a check did not reach PASS/FAIL (C5). `host_restart` and `ticket_invalid`
 * accompany phase `interrupted` (VR-04, VR-13); the other five accompany a
 * finished INCONCLUSIVE check, in `outcomeFor` order (VR-03).
 */
export type RoundCheckIncompleteCause =
    | "host_restart"
    | "ticket_invalid"
    | "not_started"
    | "source_not_matched"
    | "process_timed_out"
    | "process_cancelled"
    | "process_abnormal";
export const ROUND_CHECK_INCOMPLETE_CAUSES: readonly RoundCheckIncompleteCause[] = Object.freeze([
    "host_restart", "ticket_invalid", "not_started", "source_not_matched", "process_timed_out",
    "process_cancelled", "process_abnormal",
]);

export type RoundCheckSnapshot = {
    checkId: string;
    definition: RegisteredCommandCheck;
    coverage: EvidenceCoverageV1[];
    phase: "pending" | "executing" | "finished" | "interrupted";
    invocationId: string | null;
    outcome: EvidenceOutcome | null;
    reportRef: ArtifactRef | null;
    sourceStatus: "matched" | "changed" | "unavailable" | "permission_changed" | null;
    /** Absent on legacy checks and read as null; null for pending/executing and PASS/FAIL. */
    incompleteCause?: RoundCheckIncompleteCause | null;
    /**
     * L16（决定 55）：检查结果那一步写下的“这次检查超出了内存上限”。旧轮次没有它，
     * 读作没有；`memoryCapMiB` 是那次观察记下的上限。
     */
    resourceCapHit?: { memory: "cap_hit"; memoryCapMiB: number };
};

/** Gap code of a check left `interrupted` by a Host restart (VR-04). */
export const INTERRUPTED_CHECK_GAP_CODE = "interrupted_check";
/** Longest round chain per subject; the chain lookups read at most ROUND_CHAIN_MAX + 1 rows. */
export const ROUND_CHAIN_MAX = 32;
/** Reverify exemptions (§13.7 point 3); legacy checks without a cause always give `none`. */
export type ReverifyExemption = "none" | "host_interruption" | "not_started";
/**
 * The reverify no-progress key (§13.7), a key space separate from requeue's.
 * The digest covers every field above it: no ids, report digests, time,
 * reason, actor class, automatic count or `onlyIfSourceChanged`.
 */
export type ReverifyBasisV1 = {
    subject: TaskTriple;
    /** work: the selected Run; gate: the anchored producer Run. */
    subjectRunId: string;
    actionKind: "reverify";
    failure: { checks: NoProgressCheckFactV1[]; gapCodes: string[] };
    source: SourceStampV1;
    configuration: { configurationRevision: string; configurationDigest: string };
    verificationInputs: {
        basisPlanRef: PlanRevisionRef;
        completionPolicyPin: CompletionPolicyPin;
        architectureBaselinePin: ArchitectureBaselinePin;
    };
    newInputDigest: string | null;
    digest: string;
};
/** Who opened a successor round and why (C8: who, class, reason, which time). */
export type RoundReverifyFactV1 = {
    requestedBy: ActorRef;
    /** Derived by `reworkActorClassOf`; never an input. */
    actorClass: ReworkActorClass;
    /** `reverifyFailureClass(predecessor)`: `check_failed` or `check_incomplete`. */
    failureClass: ReworkFailureClass;
    requestedAt: string;
    basis: ReverifyBasisV1;
    exemption: ReverifyExemption;
    /** This capture's sourceDigest differs from the predecessor identity's. */
    sourceChanged: boolean;
    newInputRefs: NewBasisInputRefV1[];
    reason: string | null;
};
/**
 * The round's place in its subject's chain (C5), written once at creation.
 * Absent means a legacy slot-less chain root (ordinal 1). Shape rules:
 * `predecessorRoundRef = null` ⇔ `ordinal = 1` ⇔ `reverify = null`; an
 * ordinal-1 chain has empty `supersededEvidenceIds`/`basisDigests` and
 * `autoCount = 0`. Cross-record linearity is judged by `roundChainHead`.
 */
export type RoundChainV1 = {
    schemaVersion: 1;
    ordinal: number;
    predecessorRoundRef: VerificationRoundRef | null;
    predecessorRevision: number | null;
    /** Cumulative evidence ids of every earlier round in the chain, ancestors first. */
    supersededEvidenceIds: string[];
    /** Reverify key digests along the chain, in order. */
    basisDigests: string[];
    /** Automatic successor rounds counted against the cap (VD-13). */
    autoCount: number;
    reverify: RoundReverifyFactV1 | null;
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
    /** Every round written from A.2 on carries it; absent = legacy chain root. */
    chain?: RoundChainV1;
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
