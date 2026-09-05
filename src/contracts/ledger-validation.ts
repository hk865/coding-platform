/**
 * P1-02 pure commit validators shared by BOTH StateLedger adapters.
 *
 * Scope: StateLedger-level invariants for the versioned P1-02 commit kinds
 * (governance-install / governance-activate / plan-revision). These validators
 * are pure functions over the commit batch — the same rules run against the
 * InMemory ledger and the SQLite ledger so neither adapter can drift.
 *
 * They implement the frozen "Event/snapshot/expected-revision alignment"
 * rule of the StateLedger module interface: each commit kind carries exactly
 * the events+snapshots+expected versions its semantics define; anything else
 * is an invalid_commit (zero-write). Control-level guards (digest check,
 * install-not-found, non-empty plan guards, cycle detection) live in the
 * Control handlers, NOT here.
 */
import type {
  DispatchClaimLedgerCommitV1,
  DispatchStartLedgerCommitV1,
  GovernanceActivateLedgerCommitV1,
  GovernanceInstallLedgerCommitV1,
  PlanRevisionLedgerCommitV1,
  RunFactLedgerCommitV1,
} from "./ledger.js";
import type {
  ArchitectureBaselineRevisionSnapshot,
  CompletionPolicyRevisionSnapshot,
  ProjectArchitectureBaselineActiveSnapshot,
  ProjectCompletionPolicyActiveSnapshot,
} from "./governance.js";
import type {
  DispatchOutboxEntrySnapshot,
  RunSnapshot,
  TaskAttemptSnapshot,
  TaskLeaseSnapshot,
} from "./dispatch.js";
import {
  dispatchOutboxRefFor,
  isTerminalRuntimeEvent,
  runRefFor,
  taskAttemptRefFor,
  taskLeaseRefFor,
} from "./dispatch.js";
import { canonicalJson } from "./fingerprint.js";
import { isKnownEventType } from "./events.js";

function identityMatchesActor(
  projectId: string,
  idempotencyKey: string,
  actorKind: string,
  actorId: string,
  batchIdentity: { projectId: string; idempotencyKey: string; actor: { kind: string; id: string } },
): boolean {
  return (
    projectId === batchIdentity.projectId &&
    idempotencyKey === batchIdentity.idempotencyKey &&
    actorKind === batchIdentity.actor.kind &&
    actorId === batchIdentity.actor.id
  );
}

// ------------------------------------------------------------------------ //
// governance-install                                                        //
// ------------------------------------------------------------------------ //

export function validateGovernanceInstallCommit(
  batch: GovernanceInstallLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
  const event = batch.events[0]!;
  const snapshot = batch.snapshots[0]!;
  if (event.schemaVersion !== 1 || snapshot.schemaVersion !== 1) return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateRevision !== 1) return false;
  if (snapshot.revision !== 1) return false;

  if (event.eventType === "CompletionPolicyInstalled") {
    if (event.aggregateType !== "CompletionPolicyRevision") return false;
    if (snapshot.ref.aggregateType !== "CompletionPolicyRevision") return false;
    const s = snapshot as CompletionPolicyRevisionSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.policyId !== event.aggregateId ||
      s.contentRevision !== event.payload.revision ||
      s.contentDigest !== event.payload.contentDigest
    ) {
      return false;
    }
    if (canonicalJson(s.content) !== canonicalJson(event.payload.content)) return false;
  } else if (event.eventType === "ArchitectureBaselineInstalled") {
    if (event.aggregateType !== "ArchitectureBaselineRevision") return false;
    if (snapshot.ref.aggregateType !== "ArchitectureBaselineRevision") return false;
    const s = snapshot as ArchitectureBaselineRevisionSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.baselineId !== event.aggregateId ||
      s.contentRevision !== event.payload.revision ||
      s.contentDigest !== event.payload.contentDigest
    ) {
      return false;
    }
    if (canonicalJson(s.content) !== canonicalJson(event.payload.content)) return false;
  } else {
    return false;
  }

  // Immutability CAS: exactly one expected version = the revision at 0.
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

// ------------------------------------------------------------------------ //
// governance-activate                                                       //
// ------------------------------------------------------------------------ //

export function validateGovernanceActivateCommit(
  batch: GovernanceActivateLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
  const event = batch.events[0]!;
  const snapshot = batch.snapshots[0]!;
  if (event.schemaVersion !== 1) return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateRevision !== snapshot.revision) return false;
  if (!Number.isSafeInteger(event.aggregateRevision) || event.aggregateRevision < 1) return false;

  if (event.eventType === "CompletionPolicyActivated") {
    if (event.aggregateType !== "ProjectCompletionPolicyActive") return false;
    if (snapshot.ref.aggregateType !== "ProjectCompletionPolicyActive") return false;
    const s = snapshot as ProjectCompletionPolicyActiveSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.projectId !== event.projectId ||
      s.activeRevision.policyId !== event.payload.target.ref.policyId ||
      s.activeRevision.projectId !== event.payload.target.ref.projectId ||
      s.activeRevision.revision !== event.payload.target.ref.revision
    ) {
      return false;
    }
    if (canonicalJson(s.activeRevision) !== canonicalJson(event.payload.target.ref)) {
      return false;
    }
  } else if (event.eventType === "ArchitectureBaselineActivated") {
    if (event.aggregateType !== "ProjectArchitectureBaselineActive") return false;
    if (snapshot.ref.aggregateType !== "ProjectArchitectureBaselineActive") return false;
    const s = snapshot as ProjectArchitectureBaselineActiveSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.projectId !== event.projectId ||
      s.activeRevision.baselineId !== event.payload.target.ref.baselineId ||
      s.activeRevision.projectId !== event.payload.target.ref.projectId ||
      s.activeRevision.revision !== event.payload.target.ref.revision
    ) {
      return false;
    }
    if (canonicalJson(s.activeRevision) !== canonicalJson(event.payload.target.ref)) {
      return false;
    }
  } else {
    return false;
  }

  // CAS: [Project@expected, ActiveAggregate@(snapshot.revision - 1)].
  if (batch.expectedVersions.length !== 2) return false;
  if (batch.expectedVersions[0]!.ref.aggregateType !== "Project") return false;
  if (batch.expectedVersions[0]!.ref.projectId !== event.projectId) return false;
  if (batch.expectedVersions[1]!.revision !== snapshot.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

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
// dispatch-claim (P1-03)                                                     //
// ------------------------------------------------------------------------ //

export function validateDispatchClaimCommit(batch: DispatchClaimLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 4) return false;
  if (batch.outboxIntents.length !== 1) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "TaskClaimed") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "TaskLease") return false;
  if (event.aggregateRevision !== 1) return false;

  const lease = batch.snapshots.find(
    (s): s is TaskLeaseSnapshot => s.ref.aggregateType === "TaskLease",
  );
  const attempt = batch.snapshots.find(
    (s): s is TaskAttemptSnapshot => s.ref.aggregateType === "TaskAttempt",
  );
  const run = batch.snapshots.find((s): s is RunSnapshot => s.ref.aggregateType === "Run");
  const outbox = batch.snapshots.find(
    (s): s is DispatchOutboxEntrySnapshot => s.ref.aggregateType === "DispatchOutboxEntry",
  );
  if (lease === undefined || attempt === undefined || run === undefined || outbox === undefined) {
    return false;
  }
  if (lease.revision !== 1 || attempt.revision !== 1 || run.revision !== 1 || outbox.revision !== 1) {
    return false;
  }
  if (
    lease.schemaVersion !== 1 ||
    attempt.schemaVersion !== 1 ||
    run.schemaVersion !== 1 ||
    outbox.schemaVersion !== 1
  ) {
    return false;
  }

  // Event <-> snapshot alignment (full refs, never bare local ids).
  const expectedLeaseRef = taskLeaseRefFor(
    event.projectId,
    event.payload.goalId,
    event.payload.taskId,
  );
  if (canonicalJson(lease.ref) !== canonicalJson(expectedLeaseRef)) return false;
  if (
    canonicalJson(attempt.ref) !==
    canonicalJson(
      taskAttemptRefFor(
        event.projectId,
        event.payload.goalId,
        event.payload.taskId,
        event.payload.attemptRef.attemptId,
      ),
    )
  ) {
    return false;
  }
  if (
    canonicalJson(run.ref) !==
    canonicalJson(runRefFor(event.projectId, event.payload.goalId, event.payload.runRef.runId))
  ) {
    return false;
  }
  if (
    canonicalJson(outbox.ref) !==
    canonicalJson(
      dispatchOutboxRefFor(
        event.projectId,
        event.payload.goalId,
        event.payload.taskId,
        event.payload.attemptRef.attemptId,
      ),
    )
  ) {
    return false;
  }
  if (event.aggregateId !== event.payload.taskId) return false;
  if (lease.holderRunId !== event.payload.runRef.runId) return false;
  if (lease.attemptId !== event.payload.attemptRef.attemptId) return false;
  if (attempt.runId !== event.payload.runRef.runId) return false;
  if (attempt.status !== "claimed") return false;
  if (attempt.startedAt !== null || attempt.endedAt !== null || attempt.endOutcome !== null) {
    return false;
  }
  if (canonicalJson(attempt.planRef) !== canonicalJson(event.payload.planRef)) return false;

  if (
    run.task.projectId !== event.projectId ||
    run.task.goalId !== event.payload.goalId ||
    run.task.taskId !== event.payload.taskId
  ) {
    return false;
  }
  if (run.attemptId !== event.payload.attemptRef.attemptId) return false;
  if (canonicalJson(run.planRef) !== canonicalJson(event.payload.planRef)) return false;
  if (canonicalJson(run.roleBinding) !== canonicalJson(event.payload.roleBinding)) return false;
  if (canonicalJson(run.budget) !== canonicalJson(event.payload.budget)) return false;
  if (run.workspaceSnapshot.workspaceId !== event.workspaceId) return false;
  if (
    run.status !== "starting" ||
    run.outcome !== null ||
    run.exitCode !== null ||
    run.lastEventSeq !== 0 ||
    run.lastRuntimeEventId !== "" ||
    run.lastFactEventId !== ""
  ) {
    return false;
  }
  if (run.envelope !== null || run.startedAt !== null || run.endedAt !== null) return false;

  if (outbox.status !== "pending") return false;
  if (canonicalJson(outbox.intent) !== canonicalJson(batch.outboxIntents[0]!)) return false;
  const intent = outbox.intent;
  if (intent.intentId !== event.payload.attemptRef.attemptId) return false;
  if (
    intent.projectId !== event.projectId ||
    intent.workspaceId !== event.workspaceId ||
    intent.goalId !== event.payload.goalId ||
    intent.taskId !== event.payload.taskId
  ) {
    return false;
  }
  if (canonicalJson(intent.planRef) !== canonicalJson(event.payload.planRef)) return false;
  if (canonicalJson(intent.attemptRef) !== canonicalJson(event.payload.attemptRef)) return false;
  if (canonicalJson(intent.runRef) !== canonicalJson(event.payload.runRef)) return false;
  if (canonicalJson(intent.roleBinding) !== canonicalJson(event.payload.roleBinding)) return false;
  if (canonicalJson(intent.declaredPermissions) !== canonicalJson(event.payload.declaredPermissions)) {
    return false;
  }
  if (canonicalJson(intent.budget) !== canonicalJson(event.payload.budget)) return false;
  if (intent.requestedAt !== event.payload.claimedAt || intent.requestedAt !== event.occurredAt) {
    return false;
  }
  if (intent.correlationId !== event.correlationId) return false;
  if (canonicalJson(intent.workspaceSnapshot) !== canonicalJson(run.workspaceSnapshot)) return false;

  // CAS: all four aggregates are created at revision 0 in one commit.
  if (batch.expectedVersions.length !== 4) return false;
  const expectedRefs = [
    lease.ref,
    attempt.ref,
    run.ref,
    outbox.ref,
  ];
  for (const [index, ref] of expectedRefs.entries()) {
    const expected = batch.expectedVersions[index]!;
    if (expected.revision !== 0) return false;
    if (canonicalJson(expected.ref) !== canonicalJson(ref)) return false;
  }

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

// ------------------------------------------------------------------------ //
// dispatch-start (P1-03)                                                     //
// ------------------------------------------------------------------------ //

export function validateDispatchStartCommit(batch: DispatchStartLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 3) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "RunStarted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "Run") return false;
  if (event.aggregateRevision !== 2) return false;
  if (event.payload.startedAt !== event.occurredAt) return false;

  const run = batch.snapshots.find((s): s is RunSnapshot => s.ref.aggregateType === "Run");
  const attempt = batch.snapshots.find(
    (s): s is TaskAttemptSnapshot => s.ref.aggregateType === "TaskAttempt",
  );
  const outbox = batch.snapshots.find(
    (s): s is DispatchOutboxEntrySnapshot => s.ref.aggregateType === "DispatchOutboxEntry",
  );
  if (run === undefined || attempt === undefined || outbox === undefined) return false;
  if (run.revision !== 2 || attempt.revision !== 2 || outbox.revision !== 2) return false;
  if (run.schemaVersion !== 1 || attempt.schemaVersion !== 1 || outbox.schemaVersion !== 1) {
    return false;
  }
  if (run.ref.runId !== event.aggregateId || event.aggregateId !== run.ref.runId) return false;
  if (event.payload.taskId !== run.task.taskId) return false;
  if (event.payload.attemptId !== run.attemptId) return false;
  if (canonicalJson(run.envelope) !== canonicalJson(event.payload.envelope)) return false;
  if (run.status !== "running" || run.outcome !== null || run.endedAt !== null) return false;
  if (run.startedAt !== event.payload.startedAt) return false;
  if (run.lastEventSeq !== 0 || run.lastRuntimeEventId !== "" || run.lastFactEventId !== "") {
    return false;
  }
  if (attempt.status !== "started" || attempt.startedAt !== event.payload.startedAt) return false;
  if (attempt.endedAt !== null || attempt.endOutcome !== null) return false;
  if (outbox.status !== "started" || outbox.startedAt !== event.payload.startedAt) return false;

  // CAS: [Run@1, TaskAttempt@1, DispatchOutboxEntry@1].
  if (batch.expectedVersions.length !== 3) return false;
  for (const [index, ref] of [run.ref, attempt.ref, outbox.ref].entries()) {
    const expected = batch.expectedVersions[index]!;
    if (expected.revision !== 1) return false;
    if (canonicalJson(expected.ref) !== canonicalJson(ref)) return false;
  }

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

// ------------------------------------------------------------------------ //
// run-fact (P1-03)                                                           //
// ------------------------------------------------------------------------ //

export function validateRunFactCommit(batch: RunFactLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (!isKnownEventType(event.eventType)) return false;

  const run = batch.snapshots.find((s): s is RunSnapshot => s.ref.aggregateType === "Run");
  if (run === undefined) return false;
  if (event.aggregateType !== "Run" || event.aggregateId !== run.ref.runId) return false;
  if (event.aggregateRevision !== run.revision) return false;
  if (run.schemaVersion !== 1) return false;

  const outbox = batch.snapshots.find(
    (s): s is DispatchOutboxEntrySnapshot => s.ref.aggregateType === "DispatchOutboxEntry",
  );
  const attempt = batch.snapshots.find(
    (s): s is TaskAttemptSnapshot => s.ref.aggregateType === "TaskAttempt",
  );
  const terminal = event.eventType === "RunOutcomeUnknown" || (event.eventType === "RunEventRecorded" && isTerminalRuntimeEvent(event.payload.runtimeEvent));

  if (!terminal) {
    if (batch.snapshots.length !== 1) return false;
    if (attempt !== undefined || outbox !== undefined) return false;
    if (batch.expectedVersions.length !== 1) return false;
    if (batch.expectedVersions[0]!.revision !== run.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(run.ref)) return false;
    if (event.eventType !== "RunEventRecorded") return false;
    if (run.outcome !== null || run.endedAt !== null) return false;
    if (run.exitCode !== null) return false;
  } else {
    if (batch.snapshots.length !== 3) return false;
    if (attempt === undefined || outbox === undefined) return false;
    if (batch.expectedVersions.length !== 3) return false;
    if (attempt.schemaVersion !== 1 || outbox.schemaVersion !== 1) return false;
    if (attempt.revision !== 2 && attempt.revision !== 3) return false;
    if (outbox.revision !== 2 && outbox.revision !== 3) return false;
    if (batch.expectedVersions[0]!.revision !== run.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(run.ref)) return false;
    if (batch.expectedVersions[1]!.revision !== attempt.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(attempt.ref)) return false;
    if (batch.expectedVersions[2]!.revision !== outbox.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[2]!.ref) !== canonicalJson(outbox.ref)) return false;
    if (attempt.endedAt === null || attempt.endOutcome === null) return false;
    if (outbox.status !== "done" || outbox.doneAt === null) return false;
  }

  if (event.eventType === "RunEventRecorded") {
    const rt = event.payload.runtimeEvent;
    if (rt.schemaVersion !== 1) return false;
    if (canonicalJson(rt.runRef) !== canonicalJson(run.ref)) return false;
    if (event.payload.taskId !== run.task.taskId) return false;
    if (rt.sequence !== run.lastEventSeq) return false;
    if (rt.eventId !== run.lastRuntimeEventId) return false;
    if (event.eventId !== run.lastFactEventId) return false;
    if (terminal) {
      if (run.status !== "ended" || run.outcome === null) return false;
      if (run.endedAt !== rt.occurredAt) return false;
      if (rt.payload.kind === "completed") {
        if (run.exitCode !== rt.payload.exitCode) return false;
      } else {
        if (run.exitCode !== null) return false;
      }
    } else {
      if (run.status !== "running" || run.outcome !== null || run.endedAt !== null) return false;
      if (run.exitCode !== null) return false;
    }
  } else if (event.eventType === "RunOutcomeUnknown") {
    if (run.status !== "ended" || run.outcome !== "outcome_unknown") return false;
    if (run.endedAt !== event.payload.observedAt) return false;
    if (run.exitCode !== null) return false;
    if (attempt?.endOutcome !== "outcome_unknown") return false;
    if (attempt?.endedAt !== event.payload.observedAt) return false;
  } else {
    return false;
  }

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

