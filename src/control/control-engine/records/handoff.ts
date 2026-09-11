/** Control-owned canonical record construction. */
import type { PlanRevisionRef } from "../../../contracts/plan.js";
import type { DispatchIntentV1, RunRef, TaskAttemptRef } from "../../../contracts/dispatch.js";
import { dispatchOutboxRefFor, runRefFor, taskAttemptRefFor } from "../../../contracts/dispatch.js";
import type { ClaimReplacementCommand, HandoffRecordedEvent, ReplacementAttemptSnapshot, ReplacementClaimedEvent, RecordHandoffCommand } from "../../../contracts/handoff.js";
import { claimReplacementFingerprint, handoffPacketRefFor, recordHandoffFingerprint, replacementAttemptRefFor } from "../../../contracts/handoff.js";
import type { HandoffRecordLedgerCommitV1, ReplacementClaimLedgerCommitV1 } from "../../../contracts/ledger.js";
import type { DispatchOutboxEntrySnapshot, RunSnapshot, TaskAttemptSnapshot, TaskLeaseSnapshot } from "../../../contracts/dispatch.js";
import { taskLeaseRefFor } from "../../../contracts/dispatch.js";



export function handoffRecordedEventFor(
  command: RecordHandoffCommand,
  deps: { eventId: string; occurredAt: string; workspaceId: string },
): HandoffRecordedEvent {
  return {
    eventId: deps.eventId,
    eventType: "HandoffRecorded",
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "HandoffPacket",
    aggregateId: command.aggregateId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      goalId: command.payload.packet.goalId,
      taskId: command.payload.packet.taskId,
      packet: command.payload.packet,
      recordedAt: deps.occurredAt,
    },
  };
}


export function handoffPacketSnapshotFor(command: RecordHandoffCommand, recordedAt: string) {
  const packet = command.payload.packet;
  return {
    ref: handoffPacketRefFor(command.identity.projectId, packet.goalId, packet.taskId, packet.packetId),
    revision: 1 as const,
    schemaVersion: 1 as const,
    packet,
    recordedAt,
  };
}


export function buildHandoffRecordLedgerCommit(
  command: RecordHandoffCommand,
  deps: { eventId: string; occurredAt: string; workspaceId: string },
): HandoffRecordLedgerCommitV1 {
  const snapshot = handoffPacketSnapshotFor(command, deps.occurredAt);
  const event = handoffRecordedEventFor(command, deps);
  return {
    commitKind: "handoff-record",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: recordHandoffFingerprint(command),
    expectedVersions: [{ ref: snapshot.ref, revision: 0 }],
    events: [event],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}


export function nextTaskLeaseSnapshotForReplacement(
  prior: TaskLeaseSnapshot,
  command: ClaimReplacementCommand,
  occurredAt: string,
): TaskLeaseSnapshot {
  return {
    ref: { ...prior.ref },
    revision: prior.revision + 1,
    schemaVersion: 1,
    holderRunId: command.payload.runId,
    attemptId: command.payload.attemptId,
    grantedAt: occurredAt,
    expiresAt: prior.expiresAt,
  };
}


export function buildReplacementClaimLedgerCommit(
  command: ClaimReplacementCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    workspaceRevision: number;
    planRef: PlanRevisionRef;
    priorLease: TaskLeaseSnapshot;
    priorRunRef: RunRef;
    priorAttemptRef: TaskAttemptRef;
  },
): ReplacementClaimLedgerCommitV1 {
  const projectId = command.identity.projectId;
  const goalId = command.payload.goalId;
  const taskId = command.aggregateId;
  const attemptId = command.payload.attemptId;
  const runId = command.payload.runId;

  const attemptRef: TaskAttemptRef = taskAttemptRefFor(projectId, goalId, taskId, attemptId);
  const runRef: RunRef = runRefFor(projectId, goalId, runId);
  const outboxRef = dispatchOutboxRefFor(projectId, goalId, taskId, attemptId);
  const replacementRef = replacementAttemptRefFor(projectId, goalId, taskId, attemptId);
  const leaseRef = taskLeaseRefFor(projectId, goalId, taskId);

  const lease: TaskLeaseSnapshot = nextTaskLeaseSnapshotForReplacement(deps.priorLease, command, deps.occurredAt);
  const attempt: TaskAttemptSnapshot = {
    ref: attemptRef,
    revision: 1,
    schemaVersion: 1,
    runId,
    planRef: { ...deps.planRef },
    status: "claimed",
    startedAt: null,
    endedAt: null,
    endOutcome: null,
  };
  const run: RunSnapshot = {
    ref: runRef,
    revision: 1,
    schemaVersion: 1,
    task: { projectId, goalId, taskId },
    attemptId,
    planRef: { ...deps.planRef },
    roleBinding: { ...command.payload.roleBinding },
    budget: { ...command.payload.budget },
    workspaceSnapshot: { workspaceId: deps.workspaceId, revision: deps.workspaceRevision },
    status: "starting",
    outcome: null,
    exitCode: null,
    lastEventSeq: 0,
    lastRuntimeEventId: "",
    lastFactEventId: "",
    envelope: null,
    startedAt: null,
    endedAt: null,
  };
  const intent: DispatchIntentV1 = {
    schemaVersion: 1,
    intentId: attemptId,
    projectId,
    workspaceId: deps.workspaceId,
    goalId,
    taskId,
    planRef: { ...deps.planRef },
    attemptRef: { ...attemptRef },
    runRef: { ...runRef },
    roleBinding: { ...command.payload.roleBinding },
    workspaceSnapshot: { workspaceId: deps.workspaceId, revision: deps.workspaceRevision },
    declaredPermissions: {
      tools: [...command.payload.declaredPermissions.tools],
      writeScope: [...command.payload.declaredPermissions.writeScope],
    },
    budget: { ...command.payload.budget },
    requestedAt: command.submittedAt,
    correlationId: command.correlationId,
  };
  const outbox: DispatchOutboxEntrySnapshot = {
    ref: outboxRef,
    revision: 1,
    schemaVersion: 1,
    status: "pending",
    intent,
    pendingAt: deps.occurredAt,
    startedAt: null,
    doneAt: null,
  };
  const replacement: ReplacementAttemptSnapshot = {
    ref: replacementRef,
    revision: 1,
    schemaVersion: 1,
    packetRef: { ...command.payload.handoffPacketRef },
    priorAttemptRef: { ...deps.priorAttemptRef },
    priorRunRef: { ...deps.priorRunRef },
    attemptRef: { ...attemptRef },
    runRef: { ...runRef },
    outboxRef: { ...outboxRef },
    reason: command.payload.reason,
    workspaceRevision: deps.workspaceRevision,
    claimedAt: deps.occurredAt,
  };

  const event: ReplacementClaimedEvent = {
    eventId: deps.eventId,
    eventType: "ReplacementClaimed",
    schemaVersion: 1,
    projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "ReplacementAttempt",
    aggregateId: replacementRef.attemptId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      goalId,
      taskId,
      packetRef: { ...command.payload.handoffPacketRef },
      replacementRef: { ...replacementRef },
      priorAttemptRef: { ...deps.priorAttemptRef },
      priorRunRef: { ...deps.priorRunRef },
      attemptRef: { ...attemptRef },
      runRef: { ...runRef },
      outboxRef: { ...outboxRef },
      reason: command.payload.reason,
      claimedAt: deps.occurredAt,
    },
  };

  return {
    commitKind: "replacement-claim",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: claimReplacementFingerprint(command),
    expectedVersions: [
      { ref: leaseRef, revision: command.expectedRevision },
      { ref: attemptRef, revision: 0 },
      { ref: runRef, revision: 0 },
      { ref: outboxRef, revision: 0 },
      { ref: replacementRef, revision: 0 },
    ],
    events: [event],
    snapshots: [lease, attempt, run, outbox, replacement],
    outboxIntents: [intent],
  };
}