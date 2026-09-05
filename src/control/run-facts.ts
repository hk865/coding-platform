/**
 * P1-03 Control entry: runtime fact ingestion (run-fact).
 *
 * Lane B fills the implementation behind the shared-baseline signature.
 * Frozen semantics (Acceptance 5/6/8) implemented here:
 *   - per-run monotonic sequence: a fact with sequence < run.lastEventSeq ->
 *     stale_event; sequence == lastEventSeq and a different runtime event id
 *     -> conflict_event; same sequence+id -> a rejected duplicate (committed
 *     facts never regress); ANY fact after the Run ended -> after_terminal;
 *   - terminal runtime events fold Run status=ended + the corresponding
 *     outcome (completed/cancelled/budget_exhausted/crashed); outcome_unknown
 *     is an EXPLICIT fact (RunOutcomeUnknown), NEVER inferred from a crash or
 *     an exit code;
 *   - exit=0 on run_completed NEVER writes Task.phase (P1-03 has no Task
 *     aggregate writes at all);
 *   - one atomic run-fact commit: RunEventRecorded/RunOutcomeUnknown + Run
 *     snapshot (+ optional TaskAttempt ended / DispatchOutboxEntry done on
 *     terminal facts), CAS on the loaded revisions; NO ledger-level idempotency
 *     record (de-duplication is decided here against the committed per-run
 *     sequence — a retried fact surfaces as revision_conflict, caller re-reads).
 *
 * Every rejection is zero-write: a fact is admitted only when the CAS window
 * (command.expectedRevision == loaded run revision) is observed, the run is not
 * ended, and (for runtime events) the sequence strictly advances. We NEVER
 * roll a revision back.
 */
import type {
  DispatchOutboxEntrySnapshot,
  RunEventRecordedEvent,
  RunFactCommand,
  RunFactReceipt,
  RunFactRejectionCode,
  RunOutcome,
  RunOutcomeUnknownEvent,
  RunRef,
  RunSnapshot,
  TaskAttemptSnapshot,
} from "../contracts/dispatch.js";
import {
  dispatchOutboxRefFor,
  isTerminalRuntimeEvent,
  runFactFingerprint,
  runtimeEventTerminalOutcome,
  taskAttemptRefFor,
} from "../contracts/dispatch.js";
import type { CommitCursor } from "../contracts/command-event.js";
import type {
  ExpectedVersion,
  LedgerCommitReceipt,
  RunFactLedgerCommitV1,
} from "../contracts/ledger.js";
import { validateRunFactCommand } from "../contracts/validation.js";
import {
  nextAttemptSnapshotForTerminal,
  nextOutboxSnapshotForTerminal,
  nextRunSnapshotForOutcomeUnknown,
  nextRunSnapshotForRuntimeEvent,
} from "../contracts/fixtures/dispatch-fixtures.js";
import type { ControlEngineDeps } from "./control-engine.js";

const RUN_EVENT_RECORDED_APPLIED = "runtime_event";

function rejected(
  commandId: string,
  code: RunFactRejectionCode,
  currentRevision?: number,
): RunFactReceipt {
  return {
    status: "rejected",
    commandId,
    code,
    ...(currentRevision === undefined ? {} : { currentRevision }),
  };
}

/**
 * Resolve the target Run aggregate ref for a fact command.
 *
 * `RunFactV1.runtime_event` carries the authoritative runRef inside the event.
 * `RunFactV1.outcome_unknown` (frozen contract) carries NO runRef and no
 * goalId, so the handler recovers the run ref from the Run event log by runId
 * (the RunStartedEvent / RunEventRecordedEvent always embed the full RunRef).
 * That is a consequence of the frozen outcome_unknown shape (see design notes);
 * adding a runRef to the fact would remove the scan.
 */
async function resolveRunRef(
  deps: ControlEngineDeps,
  command: RunFactCommand,
): Promise<RunRef | null> {
  const fact = command.payload.fact;
  if (fact.kind === "runtime_event") {
    const ref = fact.event.runRef;
    if (ref.aggregateType !== "Run") return null;
    if (ref.projectId !== command.identity.projectId) return null;
    if (ref.runId !== command.aggregateId) return null;
    return ref;
  }
  return findRunRefByRunId(deps, command.identity.projectId, command.aggregateId);
}

/** Recover the RunRef addressed by (projectId, runId) from the Run event log. */
async function findRunRefByRunId(
  deps: ControlEngineDeps,
  projectId: string,
  runId: string,
): Promise<RunRef | null> {
  let afterCursor: CommitCursor | null = null;
  let found: RunRef | null = null;
  for (;;) {
    const page = await deps.ledger.events({ afterCursor, limit: 256 });
    for (const positioned of page.events) {
      const event = positioned.event;
      if (event.aggregateType !== "Run" || event.aggregateId !== runId) continue;
      if (event.eventType === "RunStarted") {
        const started = event as Extract<typeof event, { eventType: "RunStarted" }>;
        found = started.payload.envelope.runRef;
      } else if (event.eventType === "RunEventRecorded") {
        const recorded = event as Extract<typeof event, { eventType: "RunEventRecorded" }>;
        found = recorded.payload.runtimeEvent.runRef;
      }
      // RunOutcomeUnknown carries no runRef (aggregateId only).
    }
    if (!page.hasMore) break;
    afterCursor = page.throughCursor;
  }
  if (found !== null && found.projectId !== projectId) return null;
  return found;
}

async function loadAttempt(
  deps: ControlEngineDeps,
  run: RunSnapshot,
  outcome: RunOutcome,
  endedAt: string,
): Promise<TaskAttemptSnapshot | null> {
  const attemptRef = taskAttemptRefFor(run.task.projectId, run.task.goalId, run.task.taskId, run.attemptId);
  const result = await deps.ledger.load(attemptRef);
  if (result.status === "not_found") return null;
  return nextAttemptSnapshotForTerminal(result.snapshot as TaskAttemptSnapshot, outcome, endedAt);
}

async function loadOutbox(
  deps: ControlEngineDeps,
  run: RunSnapshot,
  doneAt: string,
): Promise<DispatchOutboxEntrySnapshot | null> {
  const outboxRef = dispatchOutboxRefFor(run.task.projectId, run.task.goalId, run.task.taskId, run.attemptId);
  const result = await deps.ledger.load(outboxRef);
  if (result.status === "not_found") return null;
  return nextOutboxSnapshotForTerminal(result.snapshot as DispatchOutboxEntrySnapshot, doneAt);
}

export function runFact(
  deps: ControlEngineDeps,
  command: RunFactCommand,
): Promise<RunFactReceipt> {
  return runFactImpl(deps, command);
}

async function runFactImpl(
  deps: ControlEngineDeps,
  command: RunFactCommand,
): Promise<RunFactReceipt> {
  // Guard 1: schema / shape validation (zero write).
  const issues = validateRunFactCommand(command);
  if (issues.length > 0) {
    return rejected(command.commandId, "invalid");
  }

  // Guard 2: resolve + load the Run aggregate.
  const runRef = await resolveRunRef(deps, command);
  if (runRef === null) {
    return rejected(command.commandId, "invalid");
  }
  const runResult = await deps.ledger.load(runRef);
  if (runResult.status === "not_found") {
    return rejected(command.commandId, "not_found");
  }
  const loadedRun = runResult.snapshot as RunSnapshot;

  // Guard 3: single-writer CAS window (zero write). run-fact has NO idempotent
  // replay, so a retry / a concurrent fact with a stale expected revision is a
  // real revision_conflict — the caller re-reads and sees duplicate/stale.
  if (command.expectedRevision !== loadedRun.revision) {
    return rejected(command.commandId, "revision_conflict", loadedRun.revision);
  }

  // Guard 4: no fact after a terminal state (zero write).
  if (loadedRun.status === "ended") {
    return rejected(command.commandId, "after_terminal");
  }

  const fact = command.payload.fact;

  // Guard 5: runtime-event admission by per-run monotonic sequence (zero write,
  // never regresses a committed revision).
  if (fact.kind === "runtime_event") {
    const event = fact.event;
    if (event.sequence < loadedRun.lastEventSeq) {
      return rejected(command.commandId, "stale_event");
    }
    if (event.sequence === loadedRun.lastEventSeq) {
      if (event.eventId !== loadedRun.lastRuntimeEventId) {
        return rejected(command.commandId, "conflict_event");
      }
      return rejected(command.commandId, "duplicate_event");
    }
    // event.sequence > loadedRun.lastEventSeq: admitted.
  }

  // Guard 6: deterministic fold + atomic commit.
  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const workspaceId = loadedRun.workspaceSnapshot.workspaceId;

  // The Run snapshot advances by one from the CAS window: the shared validator
  // requires expectedVersions[run] === run.revision - 1 AND the CAS requires it
  // === the loaded revision. Folding `revision` from command.expectedRevision
  // (+1), exactly like the P1-02 plan-acceptance handler folds the goal revision
  // from its command, keeps the batch internally consistent and CAS-decidable.
  const baseRun: RunSnapshot = { ...loadedRun, revision: command.expectedRevision + 1 };

  if (fact.kind === "runtime_event") {
    const event = fact.event;
    const terminal = isTerminalRuntimeEvent(event);
    const run = nextRunSnapshotForRuntimeEvent(baseRun, event);
    run.lastFactEventId = eventId;

    const snapshots: (RunSnapshot | TaskAttemptSnapshot | DispatchOutboxEntrySnapshot)[] = [run];
    const expectedVersions: ExpectedVersion[] = [
      { ref: run.ref, revision: command.expectedRevision },
    ];

    if (terminal) {
      const outcome = runtimeEventTerminalOutcome(event)!;
      const attempt = await loadAttempt(deps, loadedRun, outcome, event.occurredAt);
      const outbox = await loadOutbox(deps, loadedRun, event.occurredAt);
      if (attempt === null || outbox === null) {
        return rejected(command.commandId, "invalid");
      }
      snapshots.push(attempt, outbox);
      expectedVersions.push(
        { ref: attempt.ref, revision: attempt.revision - 1 },
        { ref: outbox.ref, revision: outbox.revision - 1 },
      );
    }

    const domainEvent: RunEventRecordedEvent = {
      eventId,
      eventType: "RunEventRecorded",
      schemaVersion: 1,
      projectId: run.ref.projectId,
      workspaceId,
      aggregateType: "Run",
      aggregateId: run.ref.runId,
      aggregateRevision: run.revision,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt,
      payload: { taskId: run.task.taskId, runtimeEvent: event },
    };

    const batch: RunFactLedgerCommitV1 = {
      commitKind: "run-fact",
      schemaVersion: 1,
      identity: { ...command.identity },
      fingerprint: runFactFingerprint(command),
      expectedVersions,
      events: [domainEvent],
      snapshots,
      outboxIntents: [],
    };

    const receipt = await deps.ledger.commit(batch);
    return mapRunFactReceipt(receipt, command, {
      runRef: run.ref,
      runRevision: run.revision,
      applied: { kind: RUN_EVENT_RECORDED_APPLIED, runtimeEventId: event.eventId, sequence: event.sequence },
      terminal,
    });
  }

  // outcome_unknown: explicit terminal fact (never inferred from crash/exit).
  const run = nextRunSnapshotForOutcomeUnknown(baseRun, { observedAt: occurredAt });
  const attempt = await loadAttempt(deps, loadedRun, "outcome_unknown", occurredAt);
  const outbox = await loadOutbox(deps, loadedRun, occurredAt);
  if (attempt === null || outbox === null) {
    return rejected(command.commandId, "invalid");
  }
  const domainEvent: RunOutcomeUnknownEvent = {
    eventId,
    eventType: "RunOutcomeUnknown",
    schemaVersion: 1,
    projectId: run.ref.projectId,
    workspaceId,
    aggregateType: "Run",
    aggregateId: run.ref.runId,
    aggregateRevision: run.revision,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt,
    payload: { taskId: run.task.taskId, reason: fact.reason, observedAt: occurredAt },
  };
  const batch: RunFactLedgerCommitV1 = {
    commitKind: "run-fact",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: runFactFingerprint(command),
    expectedVersions: [
      { ref: run.ref, revision: command.expectedRevision },
      { ref: attempt.ref, revision: attempt.revision - 1 },
      { ref: outbox.ref, revision: outbox.revision - 1 },
    ],
    events: [domainEvent],
    snapshots: [run, attempt, outbox],
    outboxIntents: [],
  };
  const receipt = await deps.ledger.commit(batch);
  return mapRunFactReceipt(receipt, command, {
    runRef: run.ref,
    runRevision: run.revision,
    applied: { kind: "outcome_unknown" },
    terminal: true,
  });
}

// ------------------------------------------------------------------------ //
// Receipt mapping (ledger receipt -> run-fact receipt).                       //
// ------------------------------------------------------------------------ //

function mapRunFactReceipt(
  receipt: LedgerCommitReceipt,
  command: RunFactCommand,
  outcome: {
    runRef: RunRef;
    runRevision: number;
    applied: Extract<RunFactReceipt, { status: "committed" }>["applied"];
    terminal: boolean;
  },
): RunFactReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: false,
      runRef: outcome.runRef,
      runRevision: outcome.runRevision,
      applied: outcome.applied,
      terminal: outcome.terminal,
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }

  const currentRevision = receipt.currentVersions?.[0]?.revision;
  switch (receipt.code) {
    case "invalid_commit":
      return rejected(command.commandId, "invalid", currentRevision);
    case "revision_conflict":
      return rejected(command.commandId, "revision_conflict", currentRevision);
    case "unavailable":
      return rejected(command.commandId, "unavailable", currentRevision);
    case "idempotency_conflict":
    case "not_empty":
      // Not reachable for a run-fact commit (no idempotency record; non-empty
      // expected versions); treat as a malformed commit rather than inventing a
      // rejection code that is absent from the receipt union.
      return rejected(command.commandId, "invalid", currentRevision);
  }
}
