/**
 * P1-03 Control entry: run start (record envelope + mark outbox started).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN). Guard order (all
 * zero-write except the single atomic dispatch-start commit):
 *   1. schema validation (validateDispatchStartCommand) -> invalid;
 *   2. Run (aggregateId) + TaskAttempt (envelope.attemptRef) +
 *      DispatchOutboxEntry (derived) exist -> else not_found;
 *   3. envelope.runRef / attemptRef / planRef EXACTLY match the loaded Run /
 *      TaskAttempt / Run.planRef -> else invalid (malformed command);
 *   4. envelope.roleBinding matches the durable intent's roleBinding (version
 *      consistency) -> else stale_binding, zero write;
 *   5. envelope.budget and envelope.workspaceSnapshot match the intent -> else
 *      invalid (no dedicated code);
 *   6. deterministic dispatch-start fold (RunStartedEvent + Run@2 running +
 *      TaskAttempt@2 started + DispatchOutboxEntry@2 started, CAS
 *      [Run@1, TaskAttempt@1, DispatchOutboxEntry@1]) via the shared fixture
 *      builder, then ledger.commit and receipt mapping.
 *
 * The intent is the durable authority (from the outbox snapshot) for the
 * binding version, budget and workspace revision the envelope must respect.
 */
import type {
  DispatchOutboxEntrySnapshot,
  DispatchStartCommand,
  DispatchStartReceipt,
  RunSnapshot,
  TaskAttemptSnapshot,
} from "../contracts/dispatch.js";
import { dispatchOutboxRefFor } from "../contracts/dispatch.js";
import type { LedgerCommitReceipt } from "../contracts/ledger.js";
import { validateDispatchStartCommand } from "../contracts/validation.js";
import { buildDispatchStartLedgerCommit } from "../contracts/fixtures/dispatch-fixtures.js";
import { canonicalJson } from "../contracts/fingerprint.js";
import type { ControlEngineDeps } from "./control-engine.js";

async function startRunImpl(
  deps: ControlEngineDeps,
  command: DispatchStartCommand,
): Promise<DispatchStartReceipt> {
  // Guard 1: schema validation.
  const validationIssues = validateDispatchStartCommand(command);
  if (validationIssues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const projectId = command.identity.projectId;
  const envelope = command.payload.envelope;

  // Guard 2: load the three aggregates. The Run is loaded by the command's
  // aggregateId (the authoritative aggregate the command targets); the envelope
  // runRef is then validated to EXACTLY match it (a mismatch is a malformed
  // command -> invalid, NOT a not_found).
  const runRef = { aggregateType: "Run" as const, projectId, goalId: envelope.goalId, runId: command.aggregateId };
  const runResult = await deps.ledger.load(runRef);
  if (runResult.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const run = runResult.snapshot as RunSnapshot;

  const attemptResult = await deps.ledger.load(envelope.attemptRef);
  if (attemptResult.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const attempt = attemptResult.snapshot as TaskAttemptSnapshot;

  const outboxRef = dispatchOutboxRefFor(projectId, run.task.goalId, run.task.taskId, run.attemptId);
  const outboxResult = await deps.ledger.load(outboxRef);
  if (outboxResult.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const outbox = outboxResult.snapshot as DispatchOutboxEntrySnapshot;
  const intent = outbox.intent;

  // Guard 3: envelope refs EXACTLY match the run/attempt/plan.
  if (
    canonicalJson(envelope.runRef) !== canonicalJson(run.ref) ||
    canonicalJson(envelope.attemptRef) !== canonicalJson(attempt.ref) ||
    canonicalJson(envelope.planRef) !== canonicalJson(run.planRef)
  ) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  // Guard 4: roleBinding version consistency with the durable intent.
  if (canonicalJson(envelope.roleBinding) !== canonicalJson(intent.roleBinding)) {
    return { status: "rejected", commandId: command.commandId, code: "stale_binding" };
  }

  // Guard 5: budget + workspaceSnapshot consistency with the intent.
  if (
    canonicalJson(envelope.budget) !== canonicalJson(intent.budget) ||
    canonicalJson(envelope.workspaceSnapshot) !== canonicalJson(intent.workspaceSnapshot)
  ) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  // Guard 6: deterministic fold + atomic commit (fold-equality with the
  // fixture builder; the ledger validates + resolves replay vs CAS).
  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const workspaceId = run.workspaceSnapshot.workspaceId;
  const batch = buildDispatchStartLedgerCommit(command, {
    eventId,
    occurredAt,
    workspaceId,
    priorRun: run,
    priorAttempt: attempt,
    priorOutbox: outbox,
  });

  const receipt = await deps.ledger.commit(batch);
  return mapStartReceipt(receipt, command, run, outbox);
}

function mapStartReceipt(
  receipt: LedgerCommitReceipt,
  command: DispatchStartCommand,
  run: RunSnapshot,
  outbox: DispatchOutboxEntrySnapshot,
): DispatchStartReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      runRef: run.ref,
      outboxRef: outbox.ref,
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }

  switch (receipt.code) {
    case "invalid_commit":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "idempotency_conflict":
      return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
    case "unavailable":
      return { status: "rejected", commandId: command.commandId, code: "unavailable" };
    case "not_empty":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "revision_conflict": {
      const rev = receipt.currentVersions?.find((v) => v.ref.aggregateType === "Run");
      const currentRevision = rev?.revision ?? receipt.currentVersions?.[0]?.revision;
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "revision_conflict",
        ...(currentRevision !== undefined ? { currentRevision } : {}),
      };
    }
  }
}

export function startRun(
  deps: ControlEngineDeps,
  command: DispatchStartCommand,
): Promise<DispatchStartReceipt> {
  return startRunImpl(deps, command);
}
