/** Internal StateLedger control-intents rules. Both adapters invoke these inside their commit protocol. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import { CONTROL_INTENT_MAX_ACKS } from "../../../contracts/control-intent.js";
import { identityMatchesActor } from './batch-identity.js';

// ------------------------------------------------------------------------ //
// Control-intent commit validators shared by both adapters.              //
// ------------------------------------------------------------------------ //

export function validateControlIntentRecordCommit(batch: import("../../../contracts/ledger.js").ControlIntentRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== (batch.events[0]?.payload.intent.scope.runRef ? 2 : 1)) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ControlIntentRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ControlIntent") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ControlIntent") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const intent = snapshot.intent;
  if (intent.intentId !== event.aggregateId) return false;
  if (canonicalJson(intent) !== canonicalJson(event.payload.intent)) return false;
  if (intent.projectId !== event.projectId) return false;
  if (intent.workspaceId !== event.workspaceId) return false;
  if (intent.status !== "queued") return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.intentId !== intent.intentId) return false;
  if (intent.acks.length !== 0) return false;
  if (batch.expectedVersions.length !== batch.snapshots.length) return false;
  if (intent.scope.runRef) {
    const run = batch.snapshots[1]; const guard = batch.expectedVersions[1];
    if (!run || !guard || canonicalJson(run.ref) !== canonicalJson(intent.scope.runRef) ||
        canonicalJson(guard.ref) !== canonicalJson(run.ref) || run.revision !== guard.revision + 1 ||
        canonicalJson(run.controlState ?? null) !== canonicalJson({ intentRef: snapshot.ref, desiredState: intent.desiredState })) return false;
  }
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateControlAckRecordCommit(batch: import("../../../contracts/ledger.js").ControlAckRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "SafePointAcknowledged") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ControlIntent") return false;
  if (event.aggregateRevision < 2) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ControlIntent") return false;
  if (snapshot.revision !== event.aggregateRevision) return false;
  if (snapshot.schemaVersion !== 1) return false;
  const intent = snapshot.intent;
  if (intent.intentId !== event.aggregateId) return false;
  if (intent.projectId !== event.projectId) return false;
  if (intent.workspaceId !== event.workspaceId) return false;
  const lastAck = intent.acks[intent.acks.length - 1];
  if (lastAck === undefined || canonicalJson(event.payload.ack) !== canonicalJson(lastAck)) return false;
  if (event.payload.status !== intent.status) return false;
  if (event.payload.updatedAt !== intent.updatedAt) return false;
  if (intent.acks.length > CONTROL_INTENT_MAX_ACKS) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== snapshot.revision - 1) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}
