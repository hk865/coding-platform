/** Persisted references, snapshots and cursor helpers required by the target.
 * Formats originate in the reference ledger; no old service interface is exported here. */
import type { CommitCursor } from "./command-event.js";
import type { ArchitectureBaselineRevisionRef, CompletionPolicyRevisionRef, ProjectArchitectureBaselineActiveRef, ProjectCompletionPolicyActiveRef } from "./governance.js";
import type { CoordinationPolicyRevisionRef, ProjectCoordinationPolicyActiveRef } from "./human-role-collaboration.js";
import type { ProjectRoleSpecActiveRef, RoleSpecRevisionRef } from "./role-spec.js";
import type { PlanRevisionRef } from "./plan.js";
import type { DispatchOutboxRef, RunRef, TaskAttemptRef, TaskLeaseRef } from "./dispatch.js";
import type { EvidenceRef, TaskEvidenceIndexRef } from "./evidence.js";
import type { VerificationRoundRef } from "./verification.js";
import type { TaskReductionRef } from "./reduction.js";
import type { GoalPhaseRef } from "./goal-phase.js";
import type { WorkContextRef } from "./context-continuity.js";
import type { ControlIntentRef } from "./control-intent.js";
import type { QueryJobAnswerRef, QueryJobRef, QueryRunRef } from "./query-job.js";
import type { UserDecisionSnapshot } from "./goal-change.js";
import type { MaterialAccessGrantRef } from "./material-access.js";
import type { SessionMessageRef } from "./core/session-message.js";
import type { SessionRef } from "./core/identity.js";
import type { ActorRef } from "./command-event.js";
import type { GoalSettingsV1, WorkspaceDecisionSettingsV1 } from "./goal-decisions.js";
import type { TaskRequeueRef, TaskReworkRefusalRef } from "./task-requeue.js";
import type { SessionAnomalyAnchorRef } from "./session-anomaly.js";
import type { ActivityRecordingRef, RunActivityRef } from "./run-activity.js";
import type { CurrentPointerRef, NoteHeadRef, NoteVersionRef } from "./note.js";
// 协作通信：只剩 Agent 归因（AgentPrincipalRefV1）引用的参与关系 ref。
import type { WorkParticipationRef } from "./coordination.js";
import type { UnknownCallReviewRef } from "./unknown-call-review.js";
import type { CommandRerunRequestRef } from "./command-rerun-request.js";
export type ProjectRef = {
    aggregateType: "Project";
    projectId: string;
};
export type WorkspaceRef = {
    aggregateType: "Workspace";
    projectId: string;
    workspaceId: string;
};
export type GoalRef = {
    aggregateType: "Goal";
    projectId: string;
    goalId: string;
};
export type AggregateRef = import('./core/identity.js').SessionAggregateRef | import('./core/identity.js').SessionWorkLinkRef | import('./core/operations.js').OperationRef | import('./reviewer-work.js').TaskReviewProtocolRef | import('./reviewer-work.js').ReviewWorkRef | import('./reviewer-work.js').ReviewResultRef | ProjectRef | WorkspaceRef | GoalRef | CompletionPolicyRevisionRef | ArchitectureBaselineRevisionRef | ProjectCompletionPolicyActiveRef | ProjectArchitectureBaselineActiveRef | PlanRevisionRef | TaskLeaseRef | TaskAttemptRef | RunRef | DispatchOutboxRef | EvidenceRef | TaskEvidenceIndexRef | VerificationRoundRef | TaskReductionRef | GoalPhaseRef | WorkContextRef | ControlIntentRef | QueryJobRef | QueryRunRef | QueryJobAnswerRef | { aggregateType: "PlanProposal"; projectId: string; workspaceId: string; proposalId: string } | UserDecisionSnapshot["ref"] | CoordinationPolicyRevisionRef | ProjectCoordinationPolicyActiveRef | RoleSpecRevisionRef | ProjectRoleSpecActiveRef | MaterialAccessGrantRef | WorkParticipationRef | import('./dispatch.js').ModelRequestPermitRef | SessionMessageRef | TaskRequeueRef | TaskReworkRefusalRef | SessionAnomalyAnchorRef | RunActivityRef | ActivityRecordingRef | NoteHeadRef | NoteVersionRef | CurrentPointerRef | UnknownCallReviewRef | CommandRerunRequestRef | import('./session-activity.js').SessionActivityRef | import('./initialization-binding.js').InitializationBindingRef;
export type ProjectSnapshot = {
    ref: ProjectRef;
    revision: number;
};
/**
 * Slice 2C L9: pinned work lines. Each item names a Session in the line's chain
 * and the instant the pin was added; absent `WorkspaceSnapshot.lineSettings`
 * reads as `{ schemaVersion: 1, pinned: [] }` and is never backfilled on read.
 */
export type WorkspaceLineSettingsV1 = {
    schemaVersion: 1;
    pinned: { sessionRef: SessionRef; pinnedAt: string }[];
};
export type WorkspaceSnapshot = {
    ref: WorkspaceRef;
    revision: number;
    /** Slice 5 optional per-category notice positions; absent reads as the default. */
    decisionSettings?: WorkspaceDecisionSettingsV1;
    /** Slice 2C optional pinned work lines; absent reads as the empty pin table. */
    lineSettings?: WorkspaceLineSettingsV1;
};
/** D-9 durable desired state; `GoalCreated` still writes only "active". */
export type GoalDesiredState = "active" | "paused" | "cancelled";
/**
 * Where a copied Goal continues from (slice-6-SPEC L12): the cancelled source Goal at the revision the copy read
 * (≥ 1), and the source's understanding note version the copy read — that version, never the current one; null when
 * the source had none.
 */
export type GoalContinuationV1 = {
    goal: GoalRef;
    sourceRevision: number;
    understanding: { noteId: string; version: number } | null;
};
export type GoalSnapshot = {
    ref: GoalRef;
    workspaceRef: WorkspaceRef;
    objective: string;
    desiredState: GoalDesiredState;
    /**
     * Goal revision of the latest desired-state change (1 at creation); the
     * fan-out epoch. Plan adoption never changes it.
     */
    desiredStateRevision: number;
    /**
     * Host actor of the latest desired-state change; null at creation. Plan
     * adoption never changes it (GOAL-05, LA-7).
     */
    desiredStateRequestedBy: ActorRef | null;
    /** null after GoalCreated@1; a PlanRevisionRef once a plan is accepted (applyPlanChange). */
    activePlanRevision: PlanRevisionRef | null;
    /** 1 at creation; 2+ after an accepted plan revision. */
    revision: number;
    /** Slice 5 Goal settings; written at creation and changed only by the settings rows (no absent default). */
    settings: GoalSettingsV1;
    /** The cancelled Goal this one was copied from (slice-6-SPEC L12); null for a Goal not born as a copy. */
    continuedFrom: GoalContinuationV1 | null;
    /** The interventions the copy carried over (slice-6-SPEC L12); [] for a Goal not born as a copy. */
    copiedInterventions: SessionMessageRef[];
    /** The Goal's creation commit cursor; every later write carries it unchanged. */
    since: CommitCursor;
};

/**
 * Pre-bind form the creation path builds: the RecordStore fills the `since`
 * placeholder from the creation commit (`commitCursorFields`), as note records do.
 */
export type PendingGoalSnapshot = Omit<GoalSnapshot, 'since'> & { since: CommitCursor | null };
export type VersionedRef = {
    ref: AggregateRef;
    revision: number;
};
/**
 * Cursor order semantics: sequential, monotonically increasing, zero-padded
 * ten-digit decimal sequence; larger sequences are refused so every cursor
 * made here reads back. Cursors stay OPAQUE to all consumers: only ledger
 * adapters and the ReadModelIndex may call compareCommitCursor; everyone else
 * must treat them as opaque tokens.
 */
export function makeCommitCursor(sequence: number): CommitCursor {
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 9_999_999_999) {
        throw new Error("invalid cursor sequence: " + String(sequence));
    }
    return ("c" + String(sequence).padStart(10, "0")) as CommitCursor;
}
export function seqOfCommitCursor(cursor: CommitCursor): number {
    const match = /^c(\d{10})$/.exec(String(cursor));
    if (!match?.[1])
        throw new Error("not a ledger cursor: " + String(cursor));
    const seq = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(seq) || seq < 1) {
        throw new Error("invalid cursor sequence: " + String(seq));
    }
    return seq;
}
