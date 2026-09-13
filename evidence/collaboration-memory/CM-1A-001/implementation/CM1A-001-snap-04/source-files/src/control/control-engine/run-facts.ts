import { executionRetryState } from '../../contracts/execution-authorization.js';
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
  AuthorizeModelRequestCommand,
  AuthorizeModelRequestReceipt,
  ModelRequestAuthorizedEvent,
  ModelRequestMaterialPinV1,
  ModelRequestEvidenceRecordedEvent,
  ModelRequestEvidenceV1,
  ModelRequestPermitSnapshot,
  ModelRequestPermitV1,
  RunRef,
  RunSnapshot,
  TaskAttemptSnapshot,
} from "../../contracts/dispatch.js";
import type { CommitCursor } from "../../contracts/command-event.js";
import { MAILBOX_MAX_SCAN_PAGES, MAILBOX_SCAN_PAGE_SIZE } from "./coordination.js";
import {
  dispatchOutboxRefFor,
  isTerminalRuntimeEvent,
  modelRequestPermitRefFor, modelRequestPermitIdFor,
  runFactFingerprint,
  runtimeEventTerminalOutcome,
  taskAttemptRefFor,
} from "../../contracts/dispatch.js";

import type {
  ExpectedVersion,
  LedgerCommitReceipt,
  RunFactLedgerCommitV1,
} from "../../contracts/ledger.js";
import { validateRunFactCommand } from '../../contracts/validation/dispatch.js';
import { canonicalJson } from "../../contracts/fingerprint.js";
import { nextAttemptSnapshotForTerminal, nextOutboxSnapshotForTerminal, nextRunSnapshotForOutcomeUnknown, nextRunSnapshotForRuntimeEvent } from "./records/dispatch.js";
import { runtimeCallAdmission } from './policies/runtime-call-admission.js';
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
 * Resolve the target Run aggregate ref for a fact command (integrator ruling on
 * lane-B gap 1): BOTH fact kinds carry their full Run identity — runtime_event
 * inside the event, outcome_unknown on the fact — so NO event-log scan is ever
 * needed. Alignment with the command (projectId/aggregateId) is enforced by
 * validateRunFactCommand; this guard is the runtime safety net.
 */
function resolveRunRef(command: RunFactCommand): RunRef | null {
  const fact = command.payload.fact;
  const ref = fact.kind === "runtime_event" ? fact.event.runRef : fact.runRef;
  if (ref.aggregateType !== "Run") return null;
  if (ref.projectId !== command.identity.projectId) return null;
  if (ref.runId !== command.aggregateId) return null;
  return ref;
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
  const runRef = resolveRunRef(command);
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

  // New provider attempts must be recorded before side effects and before the
  // Run ends. Recovery records lifecycle evidence, never a fresh call permit.
  if (loadedRun.status === 'ended') return rejected(command.commandId, 'after_terminal');

  const fact = command.payload.fact;
  if (fact.kind === 'runtime_event' && loadedRun.executionAuthorization && loadedRun.executionAuthorization.phase !== 'entered' && !(fact.event.eventType === 'run_cancelled' && loadedRun.controlState?.desiredState === 'cancelled')) return rejected(command.commandId, 'invalid');

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

  if (fact.kind === 'execution_entered' || fact.kind === 'execution_retry') {
    const authorization = loadedRun.executionAuthorization;
    if (!authorization || authorization.phase !== 'authorized' || authorization.generation !== fact.generation || authorization.consumerId !== fact.consumerId ||
        command.identity.actor.kind !== 'system' || (fact.kind === 'execution_entered' && command.identity.actor.id !== fact.consumerId)) return rejected(command.commandId, 'invalid');
    let batch: RunFactLedgerCommitV1;
    const eventBase = { eventId, schemaVersion: 1 as const, projectId: runRef.projectId, workspaceId,
      aggregateType: 'Run' as const, aggregateId: runRef.runId, aggregateRevision: baseRun.revision,
      causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey,
      actor: command.identity.actor, occurredAt };
    if (fact.kind === 'execution_entered') {
      if (loadedRun.controlState?.desiredState === 'cancelled' || loadedRun.controlState?.desiredState === 'paused' || !loadedRun.envelope) return rejected(command.commandId, 'invalid');
      const next = { ...baseRun, executionAuthorization: { ...authorization, phase: 'entered' as const } };
      batch = { commitKind: 'run-fact', schemaVersion: 1, identity: command.identity, fingerprint: runFactFingerprint(command),
        expectedVersions: [{ ref: runRef, revision: loadedRun.revision }], snapshots: [next], outboxIntents: [],
        events: [{ ...eventBase, eventType: 'ExecutionEntered', payload: { authorization: next.executionAuthorization } }] };
    } else {
      const attempt = await deps.ledger.load(taskAttemptRefFor(runRef.projectId, loadedRun.task.goalId, loadedRun.task.taskId, loadedRun.attemptId));
      const outbox = await deps.ledger.load(dispatchOutboxRefFor(runRef.projectId, loadedRun.task.goalId, loadedRun.task.taskId, loadedRun.attemptId));
      if (attempt.status !== 'found' || outbox.status !== 'found') return rejected(command.commandId, 'not_found');
      const next = executionRetryState(loadedRun, attempt.snapshot as TaskAttemptSnapshot, outbox.snapshot as DispatchOutboxEntrySnapshot, fact.reason, occurredAt);
      if (!next) return rejected(command.commandId, 'invalid');
      batch = { commitKind: 'run-fact', schemaVersion: 1, identity: command.identity, fingerprint: runFactFingerprint(command),
        expectedVersions: [{ ref: runRef, revision: loadedRun.revision }, { ref: next.attempt.ref, revision: next.attempt.revision - 1 }, { ref: next.outbox.ref, revision: next.outbox.revision - 1 }],
        snapshots: [next.run, next.attempt, next.outbox], outboxIntents: [],
        events: [{ ...eventBase, eventType: 'ExecutionRetryScheduled', payload: { ...next, reason: fact.reason } }] };
    }
    const receipt = await deps.ledger.commit(batch);
    return mapRunFactReceipt(receipt, command, { runRef, runRevision: baseRun.revision, applied: { kind: fact.kind }, terminal: false });
  }

  if (fact.kind === 'dispatch_deferred') {
    if (loadedRun.envelope || loadedRun.status !== 'starting') return rejected(command.commandId, 'invalid');
    const ref = dispatchOutboxRefFor(runRef.projectId, loadedRun.task.goalId, loadedRun.task.taskId, loadedRun.attemptId);
    const loaded = await deps.ledger.load(ref);
    if (loaded.status !== 'found') return rejected(command.commandId, 'not_found');
    const prior = loaded.snapshot as DispatchOutboxEntrySnapshot;
    if (prior.status !== 'pending' || prior.schedule?.quarantined) return rejected(command.commandId, 'invalid');
    const attemptCount = (prior.schedule?.attemptCount ?? 0) + 1;
    const outbox: DispatchOutboxEntrySnapshot = { ...prior, revision: prior.revision + 1,
      schedule: { attemptCount, lastFailure: fact.reason, quarantined: attemptCount >= 5,
        availableAt: new Date(Date.parse(occurredAt) + Math.min(60_000, 1000 * 2 ** (attemptCount - 1))).toISOString() } };
    const event: import('../../contracts/dispatch.js').DispatchDeferredEvent = {
      eventId, eventType: 'DispatchDeferred', schemaVersion: 1, projectId: runRef.projectId, workspaceId,
      aggregateType: 'DispatchOutboxEntry', aggregateId: ref.attemptId, aggregateRevision: outbox.revision,
      causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey,
      actor: command.identity.actor, occurredAt, payload: { outbox } };
    const receipt = await deps.ledger.commit({ commitKind: 'run-fact', schemaVersion: 1,
      identity: command.identity, fingerprint: runFactFingerprint(command),
      expectedVersions: [{ ref: runRef, revision: loadedRun.revision }, { ref, revision: prior.revision }],
      events: [event], snapshots: [outbox], outboxIntents: [] });
    return mapRunFactReceipt(receipt, command, { runRef, runRevision: loadedRun.revision, applied: { kind: 'dispatch_deferred' }, terminal: false });
  }

  if (fact.kind === "runtime_input_bound") {
    if (loadedRun.envelope === null) return rejected(command.commandId, "invalid");
    if (loadedRun.inputBinding !== undefined) {
      return rejected(command.commandId, canonicalJson(loadedRun.inputBinding) === canonicalJson(fact.binding)
        ? "duplicate_event" : "conflict_event", loadedRun.revision);
    }
    const pins = await admittedDeliveryPins(deps, runRef);
    if (pins.status !== "ok" || canonicalJson(pins.pins) !== canonicalJson(fact.binding.deliveryRefs)) {
      return rejected(command.commandId, "conflict_event");
    }
    const permission = await runtimeCallAdmission(deps.ledger, { ...loadedRun, inputBinding: fact.binding });
    if (!permission.allowed) return rejected(command.commandId, 'invalid');
    const run = { ...baseRun, inputBinding: structuredClone(fact.binding) };
    const event: import('../../contracts/dispatch.js').RuntimeInputBoundEvent = {
      eventId, eventType: 'RuntimeInputBound', schemaVersion: 1, projectId: runRef.projectId,
      workspaceId, aggregateType: 'Run', aggregateId: runRef.runId, aggregateRevision: run.revision,
      causationId: command.commandId, correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor },
      occurredAt, payload: { binding: fact.binding },
    };
    const receipt = await deps.ledger.commit({ commitKind: 'run-fact', schemaVersion: 1,
      identity: command.identity, fingerprint: runFactFingerprint(command),
      expectedVersions: [{ ref: runRef, revision: loadedRun.revision }, ...permission.guards], events: [event], snapshots: [run], outboxIntents: [] });
    return mapRunFactReceipt(receipt, command, { runRef, runRevision: run.revision,
      applied: { kind: 'runtime_input_bound' }, terminal: false });
  }

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

  // ---------------------------------------------------------------------- //
  // model_request_authorized：Control 复核 exact Run + 材料版本 + 授权后签发一次性许可 //
  // ---------------------------------------------------------------------- //
  if (fact.kind === "model_request_authorized") {
    const permission = await runtimeCallAdmission(deps.ledger, loadedRun);
    if (!permission.allowed) return rejected(command.commandId, 'invalid');
    const permit = fact.permit;
    const binding = loadedRun.inputBinding;
    if (permit.permitId !== modelRequestPermitIdFor(runRef, permit.requestId ?? '')) return rejected(command.commandId, 'invalid');
    if (!binding || permit.contextInputDigest !== binding.inputDigest || permit.manifestDigest !== binding.manifestDigest ||
        !permit.requestId || !/^[0-9a-f]{64}$/.test(permit.requestDigest ?? '') ||
        canonicalJson(permit.deliveryRefs) !== canonicalJson(binding.deliveryRefs) ||
        canonicalJson(permit.permissions) !== canonicalJson({ tools: loadedRun.envelope?.permissions.tools, writeScope: loadedRun.envelope?.permissions.writeScope } as never)) {
      return rejected(command.commandId, 'invalid');
    }
    if (canonicalJson(permit.runRef as never) !== canonicalJson(loadedRun.ref as never)) {
      return rejected(command.commandId, "invalid");
    }
    const permitRef = modelRequestPermitRefFor(loadedRun.ref.projectId, workspaceId, permit.permitId);
    const existing = await deps.ledger.load(permitRef);
    if (existing.status === "found") {
      const prior = existing.snapshot as ModelRequestPermitSnapshot;
      return rejected(
        command.commandId,
        canonicalJson(prior.permit as never) === canonicalJson(permit as never) ? "duplicate_event" : "conflict_event",
        loadedRun.revision,
      );
    }
    const permitSnapshot: ModelRequestPermitSnapshot = { ref: permitRef, revision: 1, schemaVersion: 1, permit, recordedAt: occurredAt };
    const domainEvent: ModelRequestAuthorizedEvent = {
      eventId,
      eventType: "ModelRequestAuthorized",
      schemaVersion: 1,
      projectId: loadedRun.ref.projectId,
      workspaceId,
      aggregateType: "ModelRequestPermit",
      aggregateId: permit.permitId,
      aggregateRevision: 1,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt,
      payload: { permit },
    };
    const batch: RunFactLedgerCommitV1 = {
      commitKind: "run-fact",
      schemaVersion: 1,
      identity: { ...command.identity },
      fingerprint: runFactFingerprint(command),
      // **只**写许可聚合：Run 的 revision 序列是多消费者共用的单写者 CAS 计数器，调用证据
      // 不是生命周期事实，不去推进它（否则按既有序列读取的消费者会 revision_conflict）。
      expectedVersions: [{ ref: permitRef, revision: 0 }, { ref: loadedRun.ref, revision: loadedRun.revision }, ...permission.guards],
      events: [domainEvent],
      snapshots: [permitSnapshot],
      outboxIntents: [],
    };
    const receipt = await deps.ledger.commit(batch);
    return mapRunFactReceipt(receipt, command, {
      runRef: loadedRun.ref,
      runRevision: loadedRun.revision,
      applied: { kind: "model_request_authorized", permitId: permit.permitId },
      terminal: false,
    });
  }

  // ---------------------------------------------------------------------- //
  // model_request_evidence：一次**调用尝试**消费许可（第二次尝试会被账本拒绝）      //
  // ---------------------------------------------------------------------- //
  if (fact.kind === "model_request_evidence") {
    if (canonicalJson(fact.runRef as never) !== canonicalJson(loadedRun.ref as never)) {
      return rejected(command.commandId, "invalid");
    }
    const permitRef = modelRequestPermitRefFor(loadedRun.ref.projectId, workspaceId, fact.permitId);
    const existing = await deps.ledger.load(permitRef);
    if (existing.status !== "found") return rejected(command.commandId, "not_found");
    const priorPermit = existing.snapshot as ModelRequestPermitSnapshot;
    const permission = await runtimeCallAdmission(deps.ledger, loadedRun);
    if (!permission.allowed) return rejected(command.commandId, 'invalid');
    if (!loadedRun.inputBinding || fact.contextInputDigest !== loadedRun.inputBinding.inputDigest ||
        priorPermit.permit.contextInputDigest !== fact.contextInputDigest ||
        priorPermit.permit.requestDigest !== fact.requestDigest || priorPermit.permit.requestId !== fact.attemptId) {
      return rejected(command.commandId, 'conflict_event');
    }
    if (canonicalJson(priorPermit.permit.runRef as never) !== canonicalJson(loadedRun.ref as never)) {
      return rejected(command.commandId, "invalid");
    }
    /**
     * **一次许可只能对应一次调用尝试**（协议约束 1.6）。
     *   · 已被别的 attemptId 消费 → conflict_event（这是本步要求的反例路径）；
     *   · 已被同一个 attemptId 消费过 → duplicate_event（重放，不产生第二条事实）。
     * 两种情况都**零写入**：许可聚合停在 @2，不会回到 @1、也不会被复制成第二份。
     */
    if (priorPermit.permit.consumedByAttemptId !== null) {
      return rejected(
        command.commandId,
        priorPermit.permit.consumedByAttemptId === fact.attemptId ? "duplicate_event" : "conflict_event",
        loadedRun.revision,
      );
    }
    if (canonicalJson(fact.deliveryRefs as never) !== canonicalJson(priorPermit.permit.deliveryRefs as never)) {
      return rejected(command.commandId, "conflict_event");
    }
    const evidence: ModelRequestEvidenceV1 = {
      permitId: fact.permitId,
      attemptId: fact.attemptId,
      requestDigest: fact.requestDigest,
      contextInputDigest: fact.contextInputDigest,
      deliveryRefs: fact.deliveryRefs.map((pin) => ({ ...pin })),
      observedAt: fact.observedAt,
    };
    const consumed: ModelRequestPermitV1 = {
      ...priorPermit.permit,
      consumedByAttemptId: fact.attemptId,
      consumedAt: fact.observedAt,
    };
    const permitSnapshot: ModelRequestPermitSnapshot = { ...priorPermit, revision: 2, permit: consumed, recordedAt: occurredAt };
    const domainEvent: ModelRequestEvidenceRecordedEvent = {
      eventId,
      eventType: "ModelRequestEvidenceRecorded",
      schemaVersion: 1,
      projectId: loadedRun.ref.projectId,
      workspaceId,
      aggregateType: "ModelRequestPermit",
      aggregateId: fact.permitId,
      aggregateRevision: 2,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt,
      payload: { permit: consumed, evidence },
    };
    const batch: RunFactLedgerCommitV1 = {
      commitKind: "run-fact",
      schemaVersion: 1,
      identity: { ...command.identity },
      fingerprint: runFactFingerprint(command),
      // 同上：只写许可聚合，不推进 Run 的 revision。
      expectedVersions: [{ ref: priorPermit.ref, revision: 1 }, { ref: loadedRun.ref, revision: loadedRun.revision }, ...permission.guards],
      events: [domainEvent],
      snapshots: [permitSnapshot],
      outboxIntents: [],
    };
    const receipt = await deps.ledger.commit(batch);
    return mapRunFactReceipt(receipt, command, {
      runRef: loadedRun.ref,
      runRevision: loadedRun.revision,
      applied: { kind: "model_request_attempted", permitId: fact.permitId, attemptId: fact.attemptId },
      terminal: false,
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
// authorizeModelRequest：一次性模型调用许可的**签发**（D06）                     //
// ------------------------------------------------------------------------ //

/**
 * Control 复核「exact Run + 材料版本 + 授权」之后签发一次性许可。
 *
 * 三条复核（全部只看 canonical 事实，调用方不能自证）：
 *   1. **exact Run**：Run 存在、CAS 命中（expectedRevision == 当前 revision）、未结束、已经有
 *      信封（没有信封的运行没有可核对的授权）；
 *   2. **材料版本**：从该 Run 的 CommunicationAdmission（若有）取**受理时固定的** Delivery 引用，
 *      逐条复核该 Delivery 存在、且 targetWorkContextRef 就是这次运行所属的 Work。**不采信调用方
 *      提交的引用**——材料版本不是调用方说了算（这正是 A06 要的可核对性）；
 *   3. **授权**：把信封里的 permissions 逐字节固定进许可，模型调用不得超出它。
 *
 * 落账**复用既有 run-fact 通道**（同一 CAS、同一去重语义），不新增写通道：这里只负责复核与
 * 构造事实，真正的一致性判定仍在 `runFact` 与账本里。
 */
export async function authorizeModelRequest(
  deps: ControlEngineDeps,
  command: AuthorizeModelRequestCommand,
): Promise<AuthorizeModelRequestReceipt> {
  const workspaceId = command.payload.workspaceId;
  const runRef = { aggregateType: "Run" as const, projectId: command.identity.projectId, goalId: command.payload.goalId, runId: command.aggregateId };
  const loaded = await deps.ledger.load(runRef);
  if (loaded.status !== "found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const run = loaded.snapshot as RunSnapshot;
  if (run.revision !== command.expectedRevision) {
    return { status: "rejected", commandId: command.commandId, code: "revision_conflict", currentRevision: run.revision };
  }
  if (run.status === "ended") {
    return { status: "rejected", commandId: command.commandId, code: "forbidden", issues: ["Run 已经结束，不再签发新的调用许可"] };
  }
  if (run.envelope === null) {
    return { status: "rejected", commandId: command.commandId, code: "forbidden", issues: ["Run 还没有已登记的信封：没有可核对的授权"] };
  }
  if (!run.inputBinding || command.payload.contextInputDigest !== run.inputBinding.inputDigest ||
      command.payload.manifestDigest !== run.inputBinding.manifestDigest ||
      !command.payload.requestId || !/^[0-9a-f]{64}$/.test(command.payload.requestDigest ?? '')) {
    return { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['实际输入绑定与调用摘要缺失或不匹配'] };
  }

  const permit: ModelRequestPermitV1 = {
    schemaVersion: 1,
    permitId: command.payload.permitId,
    runRef: { ...runRef },
    requestId: command.payload.requestId,
    requestDigest: command.payload.requestDigest!,
    contextInputDigest: command.payload.contextInputDigest,
    manifestDigest: command.payload.manifestDigest,
    deliveryRefs: run.inputBinding.deliveryRefs,
    permissions: { tools: [...run.envelope.permissions.tools], writeScope: [...run.envelope.permissions.writeScope] },
    consumedByAttemptId: null,
    issuedAt: deps.now(),
    consumedAt: null,
  };
  const fact: RunFactCommand = {
    commandId: command.commandId,
    commandType: "RunFact",
    schemaVersion: 1,
    identity: { ...command.identity },
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    correlationId: command.correlationId,
    submittedAt: command.submittedAt,
    payload: { fact: { kind: "model_request_authorized", runRef: { ...runRef }, permit } },
  };
  const receipt = await runFact(deps, fact);
  if (receipt.status !== "committed") {
    return {
      status: "rejected",
      commandId: command.commandId,
      code: receipt.code,
      ...(receipt.currentRevision === undefined ? {} : { currentRevision: receipt.currentRevision }),
    };
  }
  return {
    status: "committed",
    commandId: command.commandId,
    replayed: receipt.replayed,
    permitRef: modelRequestPermitRefFor(runRef.projectId, workspaceId, permit.permitId),
    permit,
    runRevision: receipt.runRevision,
    eventIds: receipt.eventIds,
    commitCursor: receipt.commitCursor,
  };
}

/**
 * 该 Run 在**受理时固定**的材料版本（Delivery 精确引用）。
 *
 * 读不完整（扫描页数上限）时返回 unavailable：**不**按一份截断的集合去固定材料版本。
 * 没有受理记录（普通任务 Run）时返回空集合——它是诚实的「这次运行没有来自协作受理的材料」，
 * 不是「材料未知」。
 */
async function admittedDeliveryPins(
  deps: ControlEngineDeps,
  runRef: RunRef,
): Promise<{ status: "ok"; pins: ModelRequestMaterialPinV1[] } | { status: "unavailable"; reason: string }> {
  const pins: ModelRequestMaterialPinV1[] = [];
  const seen = new Set<string>();
  let cursor: CommitCursor | null = null;
  let pages = 0;
  for (;;) {
    const page = await deps.ledger.events({ afterCursor: cursor, limit: MAILBOX_SCAN_PAGE_SIZE });
    for (const positioned of page.events) {
      if (positioned.event.eventType !== "CommunicationAdmissionRecorded") continue;
      const admission = (positioned.event as import("../../contracts/coordination.js").CommunicationAdmissionRecordedEvent).payload.admission;
      if (canonicalJson(admission.runRef) !== canonicalJson(runRef)) continue;
      for (const deliveryRef of admission.deliveryRefs) {
        const key = canonicalJson(deliveryRef as never);
        if (seen.has(key)) continue;
        seen.add(key);
        const deliveryLoaded = await deps.ledger.load(deliveryRef);
        if (deliveryLoaded.status !== "found") {
          return { status: "unavailable", reason: "受理固定的 Delivery 不存在：" + deliveryRef.deliveryId };
        }
        // **这里刻意不判"这份 Delivery 是不是投给本 Run 所属的 Work"**：Run 聚合里没有 workId，
        // 账本里也没有 (runId → workId) 的反向索引，本函数手上只有 Run 引用；在这里做出来的任何
        // 目标判定都只能是**第二个猜测点**（协议 §0：没有 canonical 依据的判定不加），而且看起来
        // 像核对、实际核对不了，比不写更危险。
        // 谁负责：由**持有 Work 事实的调用方**判定 —— Context 侧的 DeliveryMaterialCompiler.select
        // 用 canonical 的 targetWorkContextRef 逐条复核（data/context-compiler/delivery-materials.ts）；
        // 本函数只保证许可要固定的引用**可解析**（Delivery 快照确实存在）。
        pins.push({
          aggregateType: "Delivery",
          projectId: deliveryRef.projectId,
          workspaceId: deliveryRef.workspaceId,
          deliveryId: deliveryRef.deliveryId,
        });
      }
    }
    if (!page.hasMore) break;
    if (page.throughCursor === null || page.throughCursor === cursor) return { status: "unavailable", reason: "账本事件扫描未推进" };
    cursor = page.throughCursor;
    pages += 1;
    if (pages >= MAILBOX_MAX_SCAN_PAGES) return { status: "unavailable", reason: "账本事件扫描超过页数上限" };
  }
  pins.sort((a, b) => canonicalJson(a as never).localeCompare(canonicalJson(b as never)));
  return { status: "ok", pins };
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
