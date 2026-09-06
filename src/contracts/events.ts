/**
 * Versioned DomainEvent union.
 * v1 events: GoalCreated (Goal create slice) + ProjectBootstrapped /
 * WorkspaceBootstrapped (P1-00 bootstrap extension) + governance / plan events
 * (P1-02 versioned extension) + dispatch/run events (P1-03 versioned
 * extension) + evidence/reduction events (P1-04 versioned extension) +
 * goal-phase events (P1-05 versioned extension) + handoff/replacement events
 * (P1-06 versioned extension). Unknown eventType or schemaVersion must stop
 * consumers, never skip.
 */
import type { GoalCreatedEvent } from "./command-event.js";
import type { ProjectBootstrappedEventV1, WorkspaceBootstrappedEventV1 } from "./bootstrap.js";
import type {
  ArchitectureBaselineActivatedEvent,
  ArchitectureBaselineInstalledEvent,
  CompletionPolicyActivatedEvent,
  CompletionPolicyInstalledEvent,
} from "./governance.js";
import type { PlanRevisionAcceptedEvent } from "./plan.js";
import type {
  RunEventRecordedEvent,
  RunOutcomeUnknownEvent,
  RunStartedEvent,
  TaskClaimedEvent,
} from "./dispatch.js";
import type { EvidenceAdmittedEvent } from "./evidence.js";
import type { TaskReductionUpdatedEvent } from "./reduction.js";
import type { GoalPhaseUpdatedEvent } from "./goal-phase.js";
import type { HandoffRecordedEvent, ReplacementClaimedEvent } from "./handoff.js";
import type {
  WorkspaceReadLeaseGrantedEvent,
  WorkspaceReadLeaseReleasedEvent,
  WorkspaceWriteLeaseGrantedEvent,
  WorkspaceWriteLeaseReleasedEvent,
} from "./workspace-lease.js";
import type { IntegrationJoinedEvent } from "./integration.js";
import type { PatchRecordedEvent } from "./patch.js";
import type {
  WorkContextBoundEvent,
  WorkRunLinkedEvent,
  ExecutionNoteRecordedEvent,
  ContinuationRecordedEvent,
} from "./context-continuity.js";
import type {
  ArchitectureInspectionRecordedEvent,
  ArchitectureFindingRecordedEvent,
  ArchitectureDecisionBriefRecordedEvent,
  ArchitectureCandidateProposalRecordedEvent,
} from "./architecture-inspection.js";
import type { ControlIntentRecordedEvent, SafePointAcknowledgedEvent } from "./control-intent.js";
import type { QueryJobSubmittedEvent, QueryRunStartedEvent, QueryJobAnswerRecordedEvent, QueryJobClosedEvent } from "./query-job.js";
import type { GoalRevisionRecordedEvent, PlanProposalRecordedEvent, PlanRevisionSupersededEvent, UserDecisionRecordedEvent } from "./goal-change.js";
import type { ArchitectureEvolutionPolicyActivatedEvent, ArchitectureEvolutionPolicyInstalledEvent } from "./architecture-evolution-policy.js";
import type { RemediationPlanPatchRecordedEvent, RemediationTaskAdvancedEvent, RemediationTaskCreatedEvent } from "./remediation.js";
import type { ArchitectureChangeDecisionRecordedEvent, BaselineActivationRecordedEvent, CandidateBaselineMaterializedEvent, MigrationGateRecordedEvent } from "./baseline-evolution.js";

export type DomainEventV1 =
  | GoalCreatedEvent
  | ProjectBootstrappedEventV1
  | WorkspaceBootstrappedEventV1
  | CompletionPolicyInstalledEvent
  | ArchitectureBaselineInstalledEvent
  | CompletionPolicyActivatedEvent
  | ArchitectureBaselineActivatedEvent
  | PlanRevisionAcceptedEvent
  | TaskClaimedEvent
  | RunStartedEvent
  | RunEventRecordedEvent
  | RunOutcomeUnknownEvent
  | EvidenceAdmittedEvent
  | TaskReductionUpdatedEvent
  | GoalPhaseUpdatedEvent
  | HandoffRecordedEvent
  | ReplacementClaimedEvent
  | WorkspaceReadLeaseGrantedEvent
  | WorkspaceReadLeaseReleasedEvent
  | WorkspaceWriteLeaseGrantedEvent
  | WorkspaceWriteLeaseReleasedEvent
  | IntegrationJoinedEvent
  | PatchRecordedEvent
  | WorkContextBoundEvent
  | WorkRunLinkedEvent
  | ExecutionNoteRecordedEvent
  | ContinuationRecordedEvent
  | ArchitectureInspectionRecordedEvent
  | ArchitectureFindingRecordedEvent
  | ArchitectureDecisionBriefRecordedEvent
  | ArchitectureCandidateProposalRecordedEvent
  | ControlIntentRecordedEvent
  | SafePointAcknowledgedEvent
  | QueryJobSubmittedEvent
  | QueryRunStartedEvent
  | QueryJobAnswerRecordedEvent
  | QueryJobClosedEvent
  | PlanProposalRecordedEvent
  | UserDecisionRecordedEvent
  | GoalRevisionRecordedEvent
  | PlanRevisionSupersededEvent
  | ArchitectureEvolutionPolicyInstalledEvent
  | ArchitectureEvolutionPolicyActivatedEvent
  | RemediationPlanPatchRecordedEvent
  | RemediationTaskCreatedEvent
  | RemediationTaskAdvancedEvent
  | CandidateBaselineMaterializedEvent
  | ArchitectureChangeDecisionRecordedEvent
  | MigrationGateRecordedEvent
  | BaselineActivationRecordedEvent;

export type DomainEvent = DomainEventV1;

/** All known v1 event types. Anything else is unknown-version input. */
export const KNOWN_EVENT_TYPES = [
  "GoalCreated",
  "ProjectBootstrapped",
  "WorkspaceBootstrapped",
  "CompletionPolicyInstalled",
  "ArchitectureBaselineInstalled",
  "CompletionPolicyActivated",
  "ArchitectureBaselineActivated",
  "PlanRevisionAccepted",
  "TaskClaimed",
  "RunStarted",
  "RunEventRecorded",
  "RunOutcomeUnknown",
  "EvidenceAdmitted",
  "TaskReductionUpdated",
  "GoalPhaseUpdated",
  "HandoffRecorded",
  "ReplacementClaimed",
  "WorkspaceReadLeaseGranted",
  "WorkspaceReadLeaseReleased",
  "WorkspaceWriteLeaseGranted",
  "WorkspaceWriteLeaseReleased",
  "IntegrationJoined",
  "PatchRecorded",
  "WorkContextBound",
  "WorkRunLinked",
  "ExecutionNoteRecorded",
  "ContinuationRecorded",
  "ArchitectureInspectionRecorded",
  "ArchitectureFindingRecorded",
  "ArchitectureDecisionBriefRecorded",
  "ArchitectureCandidateProposalRecorded",
  "ControlIntentRecorded",
  "SafePointAcknowledged",
  "QueryJobSubmitted",
  "QueryRunStarted",
  "QueryJobAnswerRecorded",
  "QueryJobClosed",
  "PlanProposalRecorded",
  "UserDecisionRecorded",
  "GoalRevisionRecorded",
  "PlanRevisionSuperseded",
  "ArchitectureEvolutionPolicyInstalled",
  "ArchitectureEvolutionPolicyActivated",
  "RemediationPlanPatchRecorded",
  "RemediationTaskCreated",
  "RemediationTaskAdvanced",
  "CandidateBaselineMaterialized",
  "ArchitectureChangeDecisionRecorded",
  "MigrationGateRecorded",
  "BaselineActivationRecorded",
] as const;

export function isKnownEventType(eventType: string): eventType is (typeof KNOWN_EVENT_TYPES)[number] {
  return (KNOWN_EVENT_TYPES as readonly string[]).includes(eventType);
}
