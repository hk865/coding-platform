/** Control-owned canonical record construction. */
import type { PlanRevisionRef } from "../../../contracts/plan.js";
import type { DispatchClaimCommand, DispatchIntentV1, DispatchOutboxEntrySnapshot, DispatchOutboxRef, DispatchStartCommand, RunRef, RunSnapshot, TaskAttemptRef, TaskAttemptSnapshot, TaskClaimedEvent, TaskLeaseRef, TaskLeaseSnapshot, RunStartedEvent, RuntimeEventV1, RunOutcome } from "../../../contracts/dispatch.js";
import { dispatchClaimFingerprint, dispatchOutboxRefFor, dispatchStartFingerprint, isTerminalRuntimeEvent, runRefFor, runtimeEventTerminalOutcome, taskAttemptRefFor, taskLeaseRefFor } from "../../../contracts/dispatch.js";
import type { DispatchClaimLedgerCommitV1, DispatchStartLedgerCommitV1 } from "../../../contracts/ledger.js";



// ------------------------------------------------------------------------ //
// Claim fold target (deterministic commit)                                   //
// ------------------------------------------------------------------------ //

export function buildClaimedRunSnapshot(
  command: DispatchClaimCommand,
  deps: { planRef: PlanRevisionRef; workspaceId: string; workspaceRevision: number },
): RunSnapshot {
  return {
    ref: runRefFor(command.identity.projectId, command.payload.goalId, command.payload.runId),
    revision: 1,
    schemaVersion: 1,
    task: {
      projectId: command.identity.projectId,
      goalId: command.payload.goalId,
      taskId: command.aggregateId,
    },
    attemptId: command.payload.attemptId,
    planRef: { ...deps.planRef },
    roleBinding: { ...command.payload.roleBinding },
    budget: { ...command.payload.budget },
    workspaceSnapshot: {
      workspaceId: deps.workspaceId,
      revision: deps.workspaceRevision,
    },
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
}


export function buildDispatchIntentFor(
  command: DispatchClaimCommand,
  deps: {
    planRef: PlanRevisionRef;
    workspaceId: string;
    workspaceRevision: number;
    requestedAt: string;
  },
): DispatchIntentV1 {
  const attemptRef = taskAttemptRefFor(
    command.identity.projectId,
    command.payload.goalId,
    command.aggregateId,
    command.payload.attemptId,
  );
  return {
    schemaVersion: 1,
    intentId: command.payload.attemptId,
    projectId: command.identity.projectId,
    workspaceId: deps.workspaceId,
    goalId: command.payload.goalId,
    taskId: command.aggregateId,
    planRef: { ...deps.planRef },
    attemptRef,
    runRef: runRefFor(command.identity.projectId, command.payload.goalId, command.payload.runId),
    roleBinding: { ...command.payload.roleBinding },
    workspaceSnapshot: {
      workspaceId: deps.workspaceId,
      revision: deps.workspaceRevision,
    },
    declaredPermissions: {
      tools: [...command.payload.declaredPermissions.tools],
      writeScope: [...command.payload.declaredPermissions.writeScope],
    },
    budget: { ...command.payload.budget },
    requestedAt: deps.requestedAt,
    correlationId: command.correlationId,
  };
}


export function buildDispatchClaimLedgerCommit(
  command: DispatchClaimCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    planRef: PlanRevisionRef;
    workspaceRevision: number;
  },
): DispatchClaimLedgerCommitV1 {
  const leaseRef: TaskLeaseRef = taskLeaseRefFor(
    command.identity.projectId,
    command.payload.goalId,
    command.aggregateId,
  );
  const attemptRef: TaskAttemptRef = taskAttemptRefFor(
    command.identity.projectId,
    command.payload.goalId,
    command.aggregateId,
    command.payload.attemptId,
  );
  const runRef: RunRef = runRefFor(
    command.identity.projectId,
    command.payload.goalId,
    command.payload.runId,
  );
  const outboxRef: DispatchOutboxRef = dispatchOutboxRefFor(
    command.identity.projectId,
    command.payload.goalId,
    command.aggregateId,
    command.payload.attemptId,
  );
  const planRef = { ...deps.planRef };
  const intent = buildDispatchIntentFor(command, {
    planRef,
    workspaceId: deps.workspaceId,
    workspaceRevision: deps.workspaceRevision,
    requestedAt: deps.occurredAt,
  });
  const lease: TaskLeaseSnapshot = {
    ref: leaseRef,
    revision: 1,
    schemaVersion: 1,
    holderRunId: command.payload.runId,
    attemptId: command.payload.attemptId,
    grantedAt: deps.occurredAt,
    expiresAt: null,
  };
  const attempt: TaskAttemptSnapshot = {
    ref: attemptRef,
    revision: 1,
    schemaVersion: 1,
    runId: command.payload.runId,
    planRef,
    status: "claimed",
    startedAt: null,
    endedAt: null,
    endOutcome: null,
  };
  const run = buildClaimedRunSnapshot(command, {
    planRef,
    workspaceId: deps.workspaceId,
    workspaceRevision: deps.workspaceRevision,
  });
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
  const event: TaskClaimedEvent = {
    eventId: deps.eventId,
    eventType: "TaskClaimed",
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "TaskLease",
    aggregateId: command.aggregateId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      goalId: command.payload.goalId,
      taskId: command.aggregateId,
      attemptRef,
      runRef,
      planRef,
      roleBinding: { ...command.payload.roleBinding },
      declaredPermissions: {
        tools: [...command.payload.declaredPermissions.tools],
        writeScope: [...command.payload.declaredPermissions.writeScope],
      },
      budget: { ...command.payload.budget },
      intentId: command.payload.attemptId,
      claimedAt: deps.occurredAt,
    },
  };
  return {
    commitKind: "dispatch-claim",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: dispatchClaimFingerprint(command),
    expectedVersions: [
      { ref: leaseRef, revision: 0 },
      { ref: attemptRef, revision: 0 },
      { ref: runRef, revision: 0 },
      { ref: outboxRef, revision: 0 },
    ],
    events: [event],
    snapshots: [lease, attempt, run, outbox],
    outboxIntents: [intent],
  };
}


export function buildDispatchStartLedgerCommit(
  command: DispatchStartCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    priorRun: RunSnapshot;
    priorAttempt: TaskAttemptSnapshot;
    priorOutbox: DispatchOutboxEntrySnapshot;
  },
): DispatchStartLedgerCommitV1 {
  const run: RunSnapshot = {
    ...deps.priorRun,
    revision: 2,
    status: "running",
    envelope: { ...command.payload.envelope },
    startedAt: deps.occurredAt,
  };
  const attempt: TaskAttemptSnapshot = { ...deps.priorAttempt, revision: 2, status: "started", startedAt: deps.occurredAt };
  const outbox: DispatchOutboxEntrySnapshot = { ...deps.priorOutbox, revision: 2, status: "started", startedAt: deps.occurredAt };
  const event: RunStartedEvent = {
    eventId: deps.eventId,
    eventType: "RunStarted",
    schemaVersion: 1,
    projectId: run.ref.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "Run",
    aggregateId: run.ref.runId,
    aggregateRevision: 2,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      taskId: run.task.taskId,
      attemptId: run.attemptId,
      envelope: { ...command.payload.envelope },
      manifest: { ...command.payload.manifest },
      startedAt: deps.occurredAt,
    },
  };
  return {
    commitKind: "dispatch-start",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: dispatchStartFingerprint(command),
    expectedVersions: [
      { ref: run.ref, revision: 1 },
      { ref: attempt.ref, revision: 1 },
      { ref: outbox.ref, revision: 1 },
    ],
    events: [event],
    snapshots: [run, attempt, outbox],
    outboxIntents: [],
  };
}


/** Pure fold: the Run snapshot after one accepted runtime event. */
export function nextRunSnapshotForRuntimeEvent(
  current: RunSnapshot,
  event: RuntimeEventV1,
): RunSnapshot {
  const terminal = isTerminalRuntimeEvent(event);
  const next: RunSnapshot = {
    ...current,
    status: terminal ? "ended" : "running",
    outcome: terminal ? runtimeEventTerminalOutcome(event) : current.outcome,
    exitCode: event.payload.kind === "completed" ? event.payload.exitCode : current.exitCode,
    lastEventSeq: event.sequence,
    lastRuntimeEventId: event.eventId,
    lastFactEventId: "FILLED-BY-COMMIT",
    endedAt: terminal ? event.occurredAt : current.endedAt,
  };
  return next;
}


/** Pure fold: the Run snapshot after an outcome_unknown fact. */
export function nextRunSnapshotForOutcomeUnknown(
  current: RunSnapshot,
  deps: { observedAt: string },
): RunSnapshot {
  return {
    ...current,
    status: "ended",
    outcome: "outcome_unknown",
    endedAt: deps.observedAt,
  };
}


export function nextAttemptSnapshotForTerminal(
  current: TaskAttemptSnapshot,
  outcome: RunOutcome,
  endedAt: string,
): TaskAttemptSnapshot {
  return { ...current, revision: 3, status: "ended", endedAt, endOutcome: outcome };
}


export function nextOutboxSnapshotForTerminal(
  current: DispatchOutboxEntrySnapshot,
  doneAt: string,
): DispatchOutboxEntrySnapshot {
  return { ...current, revision: 3, status: "done", doneAt };
}