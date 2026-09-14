/** Internal StateLedger handoff rules. Both adapters invoke these inside their commit protocol. */

import type { HandoffRecordLedgerCommitV1, ReplacementClaimLedgerCommitV1 } from "../../../contracts/ledger.js";
import type { DispatchOutboxEntrySnapshot, RunSnapshot, TaskAttemptSnapshot, TaskLeaseSnapshot } from "../../../contracts/dispatch.js";
import type { ReplacementAttemptSnapshot } from "../../../contracts/handoff.js";
import { taskLeaseRefFor } from "../../../contracts/dispatch.js";
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import { identityMatchesActor } from './batch-identity.js';



// ------------------------------------------------------------------------ //
// Handoff validators shared by both adapters.                                  //
// ------------------------------------------------------------------------ //

export function validateHandoffRecordCommit(batch: HandoffRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "HandoffRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "HandoffPacket") return false;
  if (event.aggregateRevision !== 1) return false;

  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "HandoffPacket") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const packet = snapshot.packet;
  if (packet.packetId !== event.aggregateId) return false;
  if (canonicalJson(packet) !== canonicalJson(event.payload.packet)) return false;
  if (packet.projectId !== event.projectId) return false;
  if (packet.workspaceId !== event.workspaceId) return false;
  if (packet.goalId !== event.payload.goalId) return false;
  if (packet.taskId !== event.payload.taskId) return false;
  if (packet.noFullTranscript !== true) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.goalId !== event.payload.goalId) return false;
  if (snapshot.ref.taskId !== event.payload.taskId) return false;
  if (snapshot.ref.packetId !== packet.packetId) return false;
  if (snapshot.recordedAt !== event.payload.recordedAt) return false;

  // Immutability CAS: exactly one expected version = the packet at 0.
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}


export function validateReplacementClaimCommit(batch: ReplacementClaimLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 5) return false;
  if (batch.outboxIntents.length !== 1) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ReplacementClaimed") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ReplacementAttempt") return false;
  if (event.aggregateRevision !== 1) return false;

  const lease = batch.snapshots.find((s): s is TaskLeaseSnapshot => s.ref.aggregateType === "TaskLease");
  const attempt = batch.snapshots.find((s): s is TaskAttemptSnapshot => s.ref.aggregateType === "TaskAttempt");
  const run = batch.snapshots.find((s): s is RunSnapshot => s.ref.aggregateType === "Run");
  const outbox = batch.snapshots.find((s): s is DispatchOutboxEntrySnapshot => s.ref.aggregateType === "DispatchOutboxEntry");
  const replacement = batch.snapshots.find((s): s is ReplacementAttemptSnapshot => s.ref.aggregateType === "ReplacementAttempt");
  if (lease === undefined || attempt === undefined || run === undefined || outbox === undefined || replacement === undefined) {
    return false;
  }
  if (attempt.revision !== 1 || run.revision !== 1 || outbox.revision !== 1 || replacement.revision !== 1) {
    return false;
  }
  // A replacement REQUIRES a prior lease (>= 1) — the lease moved to revision >= 2.
  if (lease.revision < 2) return false;
  if (
    lease.schemaVersion !== 1 || attempt.schemaVersion !== 1 || run.schemaVersion !== 1 ||
    outbox.schemaVersion !== 1 || replacement.schemaVersion !== 1
  ) {
    return false;
  }

  // Event <-> snapshot alignment (full refs).
  if (canonicalJson(attempt.ref) !== canonicalJson(event.payload.attemptRef)) return false;
  if (canonicalJson(run.ref) !== canonicalJson(event.payload.runRef)) return false;
  if (canonicalJson(outbox.ref) !== canonicalJson(event.payload.outboxRef)) return false;
  if (canonicalJson(replacement.ref) !== canonicalJson(event.payload.replacementRef)) return false;
  if (canonicalJson(replacement.packetRef) !== canonicalJson(event.payload.packetRef)) return false;
  if (canonicalJson(replacement.priorAttemptRef) !== canonicalJson(event.payload.priorAttemptRef)) return false;
  if (canonicalJson(replacement.priorRunRef) !== canonicalJson(event.payload.priorRunRef)) return false;

  // Lease moved to B (the NEW holder) — a stale holder cannot survive.
  if (lease.holderRunId !== event.payload.runRef.runId) return false;
  if (lease.attemptId !== event.payload.attemptRef.attemptId) return false;
  if (attempt.runId !== event.payload.runRef.runId) return false;
  if (attempt.ref.attemptId !== event.payload.attemptRef.attemptId) return false;
  if (run.attemptId !== event.payload.attemptRef.attemptId) return false;
  if (outbox.intent.intentId !== event.payload.attemptRef.attemptId) return false;
  if (outbox.status !== "pending") return false;
  if (replacement.ref.attemptId !== event.payload.attemptRef.attemptId) return false;
  if (replacement.runRef.runId !== event.payload.runRef.runId) return false;
  if (replacement.reason !== event.payload.reason) return false;

  // The durable intent rides the same commit and must reference B's lifecycle.
  const intent = batch.outboxIntents[0]!;
  if (intent.intentId !== event.payload.attemptRef.attemptId) return false;
  if (canonicalJson(intent.attemptRef) !== canonicalJson(event.payload.attemptRef)) return false;
  if (canonicalJson(intent.runRef) !== canonicalJson(event.payload.runRef)) return false;
  if (intent.taskId !== event.payload.taskId) return false;
  if (intent.goalId !== event.payload.goalId) return false;
  const expectedLeaseRef = taskLeaseRefFor(event.projectId, event.payload.goalId, event.payload.taskId);
  if (canonicalJson(lease.ref) !== canonicalJson(expectedLeaseRef)) return false;

  // CAS: exactly 5 expected versions (lease@N, attempt/run/outbox/replacement@0).
  if (batch.expectedVersions.length !== 5) return false;
  const leaseExpected = batch.expectedVersions.find((v) => v.ref.aggregateType === "TaskLease");
  if (leaseExpected === undefined || leaseExpected.revision !== lease.revision - 1) return false;
  const expects = (ref: { aggregateType: string }): boolean =>
    batch.expectedVersions.some((v) => v.ref.aggregateType === ref.aggregateType && v.revision === 0 && canonicalJson(v.ref) === canonicalJson(ref));
  if (!expects(attempt.ref)) return false;
  if (!expects(run.ref)) return false;
  if (!expects(outbox.ref)) return false;
  if (!expects(replacement.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}
