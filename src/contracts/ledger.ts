// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
/** Persisted references, snapshots and cursor helpers required by the target.
 * Formats originate in the reference ledger; no old service interface is exported here. */
import type { CommitCursor } from "./command-event.js";
import type { BootstrapManifestRef } from "./bootstrap.js";
import type { ArchitectureBaselineRevisionRef, CompletionPolicyRevisionRef, ProjectArchitectureBaselineActiveRef, ProjectCompletionPolicyActiveRef } from "./governance.js";
import type { RemediationPlanPatchRef, RemediationTaskRef } from "./remediation.js";
import type { ArchitectureChangeDecisionRef, BaselineActivationRef, CandidateArchitectureBaselineRef, MigrationGateTaskRef } from "./baseline-evolution.js";
import type { CoordinationPolicyRevisionRef, InitialDesignDecisionRef, InitialDesignProposalRef, ProjectCoordinationPolicyActiveRef } from "./human-role-collaboration.js";
import type { ProjectRoleSpecActiveRef, RoleSpecRevisionRef } from "./role-spec.js";
import type { PlanRevisionRef } from "./plan.js";
import type { DispatchOutboxRef, RunRef, TaskAttemptRef, TaskLeaseRef } from "./dispatch.js";
import type { EvidenceRef, TaskEvidenceIndexRef } from "./evidence.js";
import type { VerificationRoundRef } from "./verification.js";
import type { TaskReductionRef } from "./reduction.js";
import type { GoalPhaseRef } from "./goal-phase.js";
import type { HandoffPacketRef, ReplacementAttemptRef } from "./handoff.js";
import type { WorkspaceReadLeaseIndexRef, WorkspaceReadLeaseRef, WorkspaceWriteLeaseIndexRef, WorkspaceWriteLeaseRef } from "./workspace-lease.js";
import type { IntegrationResultRef } from "./integration.js";
import type { PatchRecordRef } from "./patch.js";
import type { ContinuationRecordRef, ExecutionNoteRef, WorkContextRef } from "./context-continuity.js";
import type { ArchitectureCandidateProposalRef, ArchitectureDecisionBriefRef, ArchitectureFindingRef, ArchitectureInspectionRef } from "./architecture-inspection.js";
import type { ControlIntentRef } from "./control-intent.js";
import type { QueryJobAnswerRef, QueryJobRef, QueryRunRef } from "./query-job.js";
import type { GoalRevisionSnapshot, PlanProposalSnapshot, UserDecisionSnapshot } from "./goal-change.js";
import type { ArchitectureEvolutionPolicyRevisionRef, ProjectArchitectureEvolutionPolicyActiveRef } from "./architecture-evolution-policy.js";
import type { MaterialAccessGrantRef } from "./material-access.js";
import type { SessionMessageRef } from "./core/session-message.js";
// 协作通信：协作通信聚合（AgentInstance / participation / request / subscription /
// delivery / wait / 机械 intent / 后继 admission）与它们的 commit kind。
import type { AgentInstanceRef, CommunicationAdmissionRef, CoordinationRegistryRef, WorkMailboxRef, CommunicationIntentRef, DeliveryRef, DirectedRequestRef, SubscriptionRef, WaitConditionRef, WorkParticipationRef } from "./coordination.js";
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
export type AggregateRef = import('./core/identity.js').SessionAggregateRef | import('./core/identity.js').SessionWorkLinkRef | import('./core/operations.js').OperationRef | import("./architecture-review.js").ArchitectureReviewRef | import('./reviewer-work.js').TaskReviewProtocolRef | import('./reviewer-work.js').ReviewWorkRef | import('./reviewer-work.js').ReviewResultRef | ProjectRef | WorkspaceRef | GoalRef | BootstrapManifestRef | CompletionPolicyRevisionRef | ArchitectureBaselineRevisionRef | ProjectCompletionPolicyActiveRef | ProjectArchitectureBaselineActiveRef | PlanRevisionRef | TaskLeaseRef | TaskAttemptRef | RunRef | DispatchOutboxRef | EvidenceRef | TaskEvidenceIndexRef | VerificationRoundRef | TaskReductionRef | GoalPhaseRef | HandoffPacketRef | ReplacementAttemptRef | WorkspaceReadLeaseRef | WorkspaceReadLeaseIndexRef | WorkspaceWriteLeaseRef | WorkspaceWriteLeaseIndexRef | IntegrationResultRef | PatchRecordRef | WorkContextRef | ExecutionNoteRef | ContinuationRecordRef | ArchitectureInspectionRef | ArchitectureFindingRef | ArchitectureDecisionBriefRef | ArchitectureCandidateProposalRef | ControlIntentRef | QueryJobRef | QueryRunRef | QueryJobAnswerRef | PlanProposalSnapshot["ref"] | UserDecisionSnapshot["ref"] | GoalRevisionSnapshot["ref"] | ArchitectureEvolutionPolicyRevisionRef | ProjectArchitectureEvolutionPolicyActiveRef | RemediationPlanPatchRef | RemediationTaskRef | CandidateArchitectureBaselineRef | ArchitectureChangeDecisionRef | MigrationGateTaskRef | BaselineActivationRef | InitialDesignProposalRef | InitialDesignDecisionRef | CoordinationPolicyRevisionRef | ProjectCoordinationPolicyActiveRef | RoleSpecRevisionRef | ProjectRoleSpecActiveRef | MaterialAccessGrantRef | AgentInstanceRef | WorkParticipationRef | DirectedRequestRef | SubscriptionRef | DeliveryRef | WaitConditionRef | CommunicationIntentRef | CommunicationAdmissionRef | CoordinationRegistryRef | WorkMailboxRef | import('./dispatch.js').ModelRequestPermitRef | SessionMessageRef;
export type ProjectSnapshot = {
    ref: ProjectRef;
    revision: number;
};
export type WorkspaceSnapshot = {
    ref: WorkspaceRef;
    revision: number;
};
export type GoalSnapshot = {
    ref: GoalRef;
    workspaceRef: WorkspaceRef;
    objective: string;
    desiredState: "active";
    /** null after GoalCreated@1; a PlanRevisionRef after ApplyPlanRevision. */
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
