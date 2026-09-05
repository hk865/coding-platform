/**
 * Versioned DomainEvent union for P1-00.
 * v1 events: GoalCreated (Goal create slice) + ProjectBootstrapped /
 * WorkspaceBootstrapped (P1-00 bootstrap extension).
 * Unknown eventType or schemaVersion !== 1 must stop consumers, never skip.
 */
import type { GoalCreatedEvent } from "./command-event.js";
import type { ProjectBootstrappedEventV1, WorkspaceBootstrappedEventV1 } from "./bootstrap.js";

export type DomainEventV1 =
  | GoalCreatedEvent
  | ProjectBootstrappedEventV1
  | WorkspaceBootstrappedEventV1;

export type DomainEvent = DomainEventV1;

/** All known v1 event types. Anything else is unknown-version input. */
export const KNOWN_EVENT_TYPES = [
  "GoalCreated",
  "ProjectBootstrapped",
  "WorkspaceBootstrapped",
] as const;

export function isKnownEventType(eventType: string): eventType is (typeof KNOWN_EVENT_TYPES)[number] {
  return (KNOWN_EVENT_TYPES as readonly string[]).includes(eventType);
}
