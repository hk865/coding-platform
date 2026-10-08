// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
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
import type { PlanProposalSnapshot, UserDecisionSnapshot } from "./goal-change.js";
import type { MaterialAccessGrantRef } from "./material-access.js";
import type { SessionMessageRef } from "./core/session-message.js";
import type { ActorRef } from "./command-event.js";
import type { TaskRequeueRef, TaskReworkRefusalRef } from "./task-requeue.js";
import type { SessionAnomalyAnchorRef } from "./session-anomaly.js";
// 协作通信：只剩 Agent 归因（AgentPrincipalRefV1）引用的参与关系 ref。
import type { WorkParticipationRef } from "./coordination.js";
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
export type AggregateRef = import('./core/identity.js').SessionAggregateRef | import('./core/identity.js').SessionWorkLinkRef | import('./core/operations.js').OperationRef | import('./reviewer-work.js').TaskReviewProtocolRef | import('./reviewer-work.js').ReviewWorkRef | import('./reviewer-work.js').ReviewResultRef | ProjectRef | WorkspaceRef | GoalRef | CompletionPolicyRevisionRef | ArchitectureBaselineRevisionRef | ProjectCompletionPolicyActiveRef | ProjectArchitectureBaselineActiveRef | PlanRevisionRef | TaskLeaseRef | TaskAttemptRef | RunRef | DispatchOutboxRef | EvidenceRef | TaskEvidenceIndexRef | VerificationRoundRef | TaskReductionRef | GoalPhaseRef | WorkContextRef | ControlIntentRef | QueryJobRef | QueryRunRef | QueryJobAnswerRef | PlanProposalSnapshot["ref"] | UserDecisionSnapshot["ref"] | CoordinationPolicyRevisionRef | ProjectCoordinationPolicyActiveRef | RoleSpecRevisionRef | ProjectRoleSpecActiveRef | MaterialAccessGrantRef | WorkParticipationRef | import('./dispatch.js').ModelRequestPermitRef | SessionMessageRef | TaskRequeueRef | TaskReworkRefusalRef | SessionAnomalyAnchorRef;
export type ProjectSnapshot = {
    ref: ProjectRef;
    revision: number;
};
export type WorkspaceSnapshot = {
    ref: WorkspaceRef;
    revision: number;
};
/** D-9 durable desired state; `GoalCreated` still writes only "active". */
export type GoalDesiredState = "active" | "paused" | "cancelled";
export type GoalSnapshot = {
    ref: GoalRef;
    workspaceRef: WorkspaceRef;
    objective: string;
    desiredState: GoalDesiredState;
    /**
     * Goal revision of the latest desired-state change (1 at creation); the
     * fan-out epoch. Plan adoption never changes it. Absent on records written
     * before A.2, which read as 1.
     */
    desiredStateRevision?: number;
    /**
     * Host actor of the latest desired-state change; null at creation. Plan
     * adoption never changes it (GOAL-05, LA-7). Absent on records written
     * before A.2, which decode as null.
     */
    desiredStateRequestedBy?: ActorRef | null;
    /** null after GoalCreated@1; a PlanRevisionRef once a plan is accepted (applyPlanChange). */
    activePlanRevision: PlanRevisionRef | null;
    /** 1 at creation; 2+ after an accepted plan revision. */
    revision: number;
};
export type VersionedRef = {
    ref: AggregateRef;
    revision: number;
};
/**
 * Cursor order semantics: sequential, monotonically increasing, zero-padded
 * decimal sequence. Cursors stay OPAQUE to all consumers: only ledger adapters
 * and the ReadModelIndex may call compareCommitCursor; everyone else must
 * treat them as opaque tokens.
 */
export function makeCommitCursor(sequence: number): CommitCursor {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
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
