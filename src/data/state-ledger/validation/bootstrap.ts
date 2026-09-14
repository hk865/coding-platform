/** Internal StateLedger bootstrap rules. Both adapters invoke these inside their commit protocol. */
import { isKnownEventType } from "../../../contracts/events.js";


/** goal-create: exactly one GoalCreated event and its revision-1 Goal snapshot,
 * aligned with the command identity. */
export function validateGoalCreateCommit(batch: import("../../../contracts/ledger.js").GoalCreateLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
  const ev = batch.events[0]!;
  const snap = batch.snapshots[0]!;
  if (ev.schemaVersion !== 1) return false;
  if (ev.eventType !== "GoalCreated") return false;
  if (!isKnownEventType(ev.eventType)) return false;
  if (ev.aggregateType !== "Goal") return false;
  if (ev.aggregateRevision !== 1) return false;
  if (snap.ref.aggregateType !== "Goal") return false;
  if (snap.revision !== 1) return false;
  // Event / snapshot alignment (StateLedger interface local invariants).
  if (snap.ref.projectId !== snap.workspaceRef.projectId) return false;
  if (snap.ref.projectId !== ev.projectId) return false;
  if (snap.ref.goalId !== ev.aggregateId) return false;
  if (snap.workspaceRef.workspaceId !== ev.workspaceId) return false;
  // Command/Event interface invariants: event must mirror the command identity.
  if (ev.projectId !== batch.identity.projectId) return false;
  if (ev.idempotencyKey !== batch.identity.idempotencyKey) return false;
  if (ev.actor.kind !== batch.identity.actor.kind || ev.actor.id !== batch.identity.actor.id) {
    return false;
  }
  return true;
}


/** bootstrap: only Project/WorkspaceBootstrapped events, all at revision 1. */
export function validateBootstrapCommit(batch: import("../../../contracts/ledger.js").BootstrapLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length === 0) return false;
  for (const ev of batch.events) {
    if (ev.schemaVersion !== 1) return false;
    if (ev.eventType !== "ProjectBootstrapped" && ev.eventType !== "WorkspaceBootstrapped") {
      return false;
    }
    if (!isKnownEventType(ev.eventType)) return false;
    if (ev.aggregateRevision !== 1) return false;
  }
  for (const snapshot of batch.snapshots) {
    if (snapshot.revision !== 1) return false;
  }
  return true;
}
