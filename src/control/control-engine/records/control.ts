/** Control-owned canonical record construction. */
import type { ControlIntentV1, ControlIntentSnapshot, SubmitControlCommand, RecordSafePointAckCommand } from "../../../contracts/control-intent.js";
import { controlIntentRefFor, recordSafePointAckFingerprint, submitControlFingerprint } from "../../../contracts/control-intent.js";
import type { ControlIntentRecordLedgerCommitV1, ControlAckRecordLedgerCommitV1 } from "../../../contracts/ledger.js";




export function buildP110IntentSnapshot(intent: ControlIntentV1): ControlIntentSnapshot {
  return { ref: controlIntentRefFor(intent.projectId, intent.workspaceId, intent.intentId), revision: 1, schemaVersion: 1, intent };
}


export function buildControlIntentRecordLedgerCommit(command: SubmitControlCommand, deps: { eventId: string; occurredAt: string }): ControlIntentRecordLedgerCommitV1 {
  const intent = command.payload.intent;
  const snapshot = buildP110IntentSnapshot(intent);
  return {
    commitKind: "control-intent-record",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: submitControlFingerprint(command),
    expectedVersions: [{ ref: snapshot.ref, revision: 0 }],
    events: [{
      eventId: deps.eventId, eventType: "ControlIntentRecorded", schemaVersion: 1,
      projectId: intent.projectId, workspaceId: intent.workspaceId,
      aggregateType: "ControlIntent", aggregateId: intent.intentId, aggregateRevision: 1,
      causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor }, occurredAt: deps.occurredAt,
      payload: { intent },
    }],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}


export function buildControlAckRecordLedgerCommit(command: RecordSafePointAckCommand, deps: { eventId: string; occurredAt: string; nextRevision: number; nextIntent: ControlIntentV1 }): ControlAckRecordLedgerCommitV1 {
  const intent = deps.nextIntent;
  const snapshot: ControlIntentSnapshot = { ref: controlIntentRefFor(command.identity.projectId, intent.workspaceId, intent.intentId), revision: deps.nextRevision, schemaVersion: 1, intent };
  return {
    commitKind: "control-ack",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: recordSafePointAckFingerprint(command),
    expectedVersions: [{ ref: snapshot.ref, revision: deps.nextRevision - 1 }],
    events: [{
      eventId: deps.eventId, eventType: "SafePointAcknowledged", schemaVersion: 1,
      projectId: intent.projectId, workspaceId: intent.workspaceId,
      aggregateType: "ControlIntent", aggregateId: intent.intentId, aggregateRevision: deps.nextRevision,
      causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor }, occurredAt: deps.occurredAt,
      payload: { ack: command.payload.ack, status: intent.status, desiredState: intent.desiredState, updatedAt: intent.updatedAt },
    }],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}