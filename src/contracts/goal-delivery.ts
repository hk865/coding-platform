/**
 * The delivery acceptance fact (decision 121-45, acc): one immutable record per completed GoalPhase that the person
 * acknowledged. "Acknowledged" is not "reviewed": the record carries no reviewed flag, and writing it never changes the
 * Goal, its GoalPhase, its Plan, its Tasks or any Run. A later completion (GoalPhase revision+1) is a new delivery.
 */
import type { ActorRef } from './command-event.js';
import type { GoalRef } from './ledger.js';
import type { PlanRevisionRef } from './plan.js';

export type GoalDeliveryAcceptanceRef = {
  aggregateType: 'GoalDeliveryAcceptance';
  projectId: string; goalId: string;
  /** The GoalPhase revision this acceptance names; a new completion is a new delivery. */
  phaseRevision: number;
};
export type GoalDeliveryAcceptanceV1 = {
  ref: GoalDeliveryAcceptanceRef;
  schemaVersion: 1;
  revision: 1;
  goalRef: GoalRef;
  planRef: PlanRevisionRef;
  planRevision: number;
  acceptedBy: { kind: 'human'; id: string };
  acceptedAt: string;
  requestId: string;
};
export type GoalDeliveryAcceptedEvent = {
  eventId: string; eventType: 'GoalDeliveryAccepted'; schemaVersion: 1;
  occurredAt: string; identityKey: string; actor: ActorRef; fingerprint: string;
  goalRef: GoalRef; phaseRevision: number; result: GoalDeliveryAcceptanceV1;
};
