/**
 * Versioned DomainEvent union.
 * v1 events: GoalCreated (Goal create slice) + ProjectBootstrapped /
 * WorkspaceBootstrapped (P1-00 bootstrap extension) + governance / plan events
 * (P1-02 versioned extension) + dispatch/run events (P1-03 versioned
 * extension). Unknown eventType or schemaVersion must stop consumers, never
 * skip.
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
  | GoalPhaseUpdatedEvent;

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
] as const;

export function isKnownEventType(eventType: string): eventType is (typeof KNOWN_EVENT_TYPES)[number] {
  return (KNOWN_EVENT_TYPES as readonly string[]).includes(eventType);
}