/** Internal StateLedger planning rules. Both adapters invoke these inside their commit protocol. */

import type { PlanRevisionLedgerCommitV1 } from "../../../contracts/ledger.js";
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import { identityMatchesActor } from './batch-identity.js';


// ------------------------------------------------------------------------ //
// plan-revision                                                             //
// ------------------------------------------------------------------------ //

export function validatePlanRevisionCommit(batch: PlanRevisionLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 2) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "PlanRevisionAccepted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "PlanRevision") return false;
  if (event.aggregateRevision !== 1) return false;

  const planSnapshot = batch.snapshots.find(
    (s): s is Extract<typeof s, { ref: { aggregateType: "PlanRevision" } }> =>
      s.ref.aggregateType === "PlanRevision",
  );
  const goalSnapshot = batch.snapshots.find(
    (s): s is Extract<typeof s, { ref: { aggregateType: "Goal" } }> => s.ref.aggregateType === "Goal",
  );
  if (planSnapshot === undefined || goalSnapshot === undefined) return false;
  if (planSnapshot.revision !== 1) return false;
  if (planSnapshot.schemaVersion !== 1) return false;

  // Plan snapshot aligns with the event aggregate identity.
  if (
    planSnapshot.ref.projectId !== event.projectId ||
    planSnapshot.planId !== event.aggregateId ||
    planSnapshot.goalRef.projectId !== event.projectId ||
    planSnapshot.goalRef.goalId !== event.payload.goalId
  ) {
    return false;
  }
  // The event carries the exact accepted snapshot (ReadModel replay source).
  if (canonicalJson(event.payload.planRevision) !== canonicalJson(planSnapshot)) return false;

  // Goal snapshot advances by one; workspace must stay consistent.
  if (goalSnapshot.revision !== event.aggregateRevision + 1) return false;
  if (goalSnapshot.activePlanRevision === null) return false;
  if (canonicalJson(goalSnapshot.activePlanRevision) !== canonicalJson(planSnapshot.ref)) {
    return false;
  }
  if (goalSnapshot.ref.projectId !== event.projectId || goalSnapshot.ref.goalId !== event.payload.goalId) {
    return false;
  }
  if (goalSnapshot.workspaceRef.projectId !== event.projectId) return false;
  if (goalSnapshot.workspaceRef.workspaceId !== event.workspaceId) return false;
  if (event.payload.goalAggregateRevision !== goalSnapshot.revision) return false;

  // CAS: [Goal@(goalSnapshot.revision - 1), PlanRevision@0].
  if (batch.expectedVersions.length !== 2) return false;
  if (batch.expectedVersions[0]!.revision !== goalSnapshot.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(goalSnapshot.ref)) return false;
  if (batch.expectedVersions[1]!.revision !== 0) return false;
  if (canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(planSnapshot.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}



// ------------------------------------------------------------------------ //
// Goal-change validators shared by both adapters.                         //
// ------------------------------------------------------------------------ //

export function validatePlanChangeProposalRecordCommit(batch: import("../../../contracts/ledger.js").PlanChangeProposalRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "PlanProposalRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "PlanProposal" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0] as import("../../../contracts/goal-change.js").PlanProposalSnapshot;
  if (snap.ref.aggregateType !== "PlanProposal" || snap.revision !== 1) return false;
  if (canonicalJson(snap.proposal) !== canonicalJson(event.payload.proposal)) return false;
  if (snap.proposal.proposalId !== event.aggregateId) return false;
  if (snap.recordedAt !== event.payload.recordedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateUserDecisionRecordCommit(batch: import("../../../contracts/ledger.js").UserDecisionRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "UserDecisionRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "UserDecision" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0] as import("../../../contracts/goal-change.js").UserDecisionSnapshot;
  if (snap.ref.aggregateType !== "UserDecision" || snap.revision !== 1) return false;
  if (canonicalJson(snap.decision) !== canonicalJson(event.payload.decision)) return false;
  if (snap.decision.decisionId !== event.aggregateId) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateGoalChangeApplyCommit(batch: import("../../../contracts/ledger.js").GoalChangeApplyLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 3) return false;
  if (batch.snapshots.length !== 3 || batch.outboxIntents.length !== 0) return false;
  const [planEvent, supersedeEvent, revisionEvent] = batch.events as [import("../../../contracts/plan.js").PlanRevisionAcceptedEvent, import("../../../contracts/goal-change.js").PlanRevisionSupersededEvent, import("../../../contracts/goal-change.js").GoalRevisionRecordedEvent];
  if (planEvent.eventType !== "PlanRevisionAccepted" || supersedeEvent.eventType !== "PlanRevisionSuperseded" || revisionEvent.eventType !== "GoalRevisionRecorded") return false;
  if (!isKnownEventType(planEvent.eventType) || !isKnownEventType(supersedeEvent.eventType) || !isKnownEventType(revisionEvent.eventType)) return false;
  const planSnap = batch.snapshots.find((s) => s.ref.aggregateType === "PlanRevision") as import("../../../contracts/plan.js").PlanRevisionSnapshot | undefined;
  const revSnap = batch.snapshots.find((s) => s.ref.aggregateType === "GoalRevision") as import("../../../contracts/goal-change.js").GoalRevisionSnapshot | undefined;
  const goalSnap = batch.snapshots.find((s) => s.ref.aggregateType === "Goal") as import("../../../contracts/ledger.js").GoalSnapshot | undefined;
  if (planSnap === undefined || revSnap === undefined || goalSnap === undefined) return false;
  if (canonicalJson(planSnap) !== canonicalJson(planEvent.payload.planRevision)) return false;
  if (goalSnap.revision !== planEvent.payload.goalAggregateRevision) return false;
  if (goalSnap.activePlanRevision?.planId !== planSnap.ref.planId) return false;
  if (canonicalJson(revSnap.change) !== canonicalJson(revisionEvent.payload.change)) return false;
  const supersededRefs = revSnap.change.supersededPlanRefs;
  if (supersededRefs.length === 0) return false;
  const lastSuperseded = supersededRefs[supersededRefs.length - 1]!;
  if (canonicalJson(supersedeEvent.payload.supersededRef) !== canonicalJson(lastSuperseded)) return false;
  if (canonicalJson(supersedeEvent.payload.activeRef) !== canonicalJson(revSnap.change.activePlanRef)) return false;
  if (supersedeEvent.payload.decisionRef.aggregateType !== "UserDecision" || !supersedeEvent.payload.decisionRef.decisionId) return false;
  if (supersedeEvent.payload.changedAt !== revSnap.change.changedAt) return false;
  if (batch.expectedVersions.length !== 2) return false;
  const gE = batch.expectedVersions.find((v) => v.ref.aggregateType === "Goal");
  const pE = batch.expectedVersions.find((v) => v.ref.aggregateType === "PlanRevision");
  if (gE === undefined || gE.revision !== goalSnap.revision - 1) return false;
  if (pE === undefined || pE.revision !== 0) return false;
  return identityMatchesActor(planEvent.projectId, planEvent.idempotencyKey, planEvent.actor.kind, planEvent.actor.id, batch.identity);
}
