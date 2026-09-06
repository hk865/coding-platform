/**
 * P1-16 Control entry: WorkRecordEngineImpl — durable work identity + reason
 * trail (WorkRecordPort implementor).
 *
 * ENTRY FILE (shared baseline — exported signatures FROZEN; lane A fills the
 * implementations). Frozen semantics (IMPLEMENTATION-HANDOFF "P1-16 契约与
 * 存储语义" items 1-6):
 *   1. shape validation (validateBindWorkContextCommand / ...) -> invalid;
 *   2. referential guards (Project/Workspace/Binding/run existence; workKind-
 *      goal/task consistency) -> not_found; binding already exists -> CAS;
 *   3. ExecutionNote author must be a run LINKED to the work binding ->
 *      run_not_in_work (zero write); the note body must already be
 *      body-first'd into the ArtifactVault by the author;
 *   4. run links bounded (WORK_CONTEXT_MAX_RUN_LINKS) -> links_exceeded;
 *   5. ONE atomic commit per command (fold-equality with the shared fixture
 *      builders) with FULL ledger idempotency.
 * No Goal/Task phase write; no CompletionPolicy change; the runtime capability
 * declaration is recorded as reported (capabilitySource), never fabricated.
 */
import type {
  BindWorkContextCommand,
  BindWorkContextReceipt,
  LinkWorkRunCommand,
  LinkWorkRunReceipt,
  RecordContinuationCommand,
  RecordContinuationReceipt,
  RecordExecutionNoteCommand,
  RecordExecutionNoteReceipt,
  WorkContextBindingSnapshot,
  WorkRecordPort,
} from "../contracts/context-continuity.js";
import { WORK_CONTEXT_MAX_RUN_LINKS, continuationRecordRefFor, executionNoteRefFor, workContextRefFor } from "../contracts/context-continuity.js";
import { canonicalJson } from "../contracts/fingerprint.js";
import type { LedgerCommitReceipt, WorkspaceRef } from "../contracts/ledger.js";
import {
  validateBindWorkContextCommand,
  validateLinkWorkRunCommand,
  validateRecordContinuationCommand,
  validateRecordExecutionNoteCommand,
} from "../contracts/validation.js";
import {
  buildContinuationRecordLedgerCommit,
  buildExecutionNoteRecordLedgerCommit,
  buildWorkContextBindLedgerCommit,
  buildWorkContextLinkLedgerCommit,
} from "../contracts/fixtures/context-fixtures.js";
import type { ControlEngineDeps } from "./control-engine.js";

export class WorkRecordEngineImpl implements WorkRecordPort {
  private readonly deps: ControlEngineDeps;

  constructor(deps: ControlEngineDeps) {
    this.deps = deps;
  }

  // --------------------------------------------------------------------- //
  // bindWorkContext — create the durable work identity exactly once       //
  // --------------------------------------------------------------------- //

  async bindWorkContext(command: BindWorkContextCommand): Promise<BindWorkContextReceipt> {
    // Guard 1: schema / shape validation (zero write).
    const issues = validateBindWorkContextCommand(command);
    if (issues.length > 0) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }

    // workKind-goal/task consistency: a task work is anchored to a goal + task.
    if (command.payload.workKind === "task" && (command.payload.goalId === null || command.payload.taskId === null)) {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }

    // Guard 2: referential guards — the workspace must exist (a work lives in a
    // real workspace scope), and the initial run must be a real Run aggregate.
    const workspaceRef: WorkspaceRef = {
      aggregateType: "Workspace",
      projectId: command.identity.projectId,
      workspaceId: command.payload.workspaceId,
    };
    if ((await this.deps.ledger.load(workspaceRef)).status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    if ((await this.deps.ledger.load(command.payload.initialRunRef)).status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }

    // Guard 5: deterministic fold (fold-equality with the shared fixture builder)
    // -> atomic ledger.commit (CAS@0 + idempotency) -> receipt mapping.
    const batch = buildWorkContextBindLedgerCommit(command, {
      eventId: this.deps.eventId(),
      occurredAt: this.deps.now(),
    });
    const receipt = await this.deps.ledger.commit(batch);
    return mapBindReceipt(receipt, command);
  }

  // --------------------------------------------------------------------- //
  // linkWorkRun — append a run to the binding (CAS@N)                     //
  // --------------------------------------------------------------------- //

  async linkWorkRun(command: LinkWorkRunCommand): Promise<LinkWorkRunReceipt> {
    // Guard 1: schema / shape validation (zero write).
    const issues = validateLinkWorkRunCommand(command);
    if (issues.length > 0) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }

    // Guard 2: referential guards — the binding must exist and the run to link
    // must be a real Run aggregate.
    const workRef = workContextRefFor(command.identity.projectId, command.payload.workspaceId, command.aggregateId);
    const bindingResult = await this.deps.ledger.load(workRef);
    if (bindingResult.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    const binding = bindingResult.snapshot as WorkContextBindingSnapshot;
    if ((await this.deps.ledger.load(command.payload.runRef)).status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }

    // Guard 3: duplicate link of the SAME run -> already_linked (zero write).
    const runKey = canonicalJson(command.payload.runRef);
    if (binding.binding.linkedRunRefs.some((r) => canonicalJson(r) === runKey)) {
      return { status: "rejected", commandId: command.commandId, code: "already_linked" };
    }

    // Guard 4: run links bounded -> links_exceeded (zero write).
    if (binding.binding.linkedRunRefs.length >= WORK_CONTEXT_MAX_RUN_LINKS) {
      return { status: "rejected", commandId: command.commandId, code: "links_exceeded" };
    }

    // Guard 5: deterministic fold (append the run) -> atomic commit -> mapping.
    const nextBinding = {
      ...binding.binding,
      linkedRunRefs: [...binding.binding.linkedRunRefs.map((r) => ({ ...r })), { ...command.payload.runRef }],
    };
    const batch = buildWorkContextLinkLedgerCommit(command, {
      eventId: this.deps.eventId(),
      occurredAt: this.deps.now(),
      currentRevision: binding.revision,
      nextBinding,
    });
    const receipt = await this.deps.ledger.commit(batch);
    return mapLinkReceipt(receipt, command, binding, workRef);
  }

  // --------------------------------------------------------------------- //
  // recordExecutionNote — one immutable note (body-first; CAS@0)          //
  // --------------------------------------------------------------------- //

  async recordExecutionNote(command: RecordExecutionNoteCommand): Promise<RecordExecutionNoteReceipt> {
    // Guard 1: schema / shape validation (zero write).
    const issues = validateRecordExecutionNoteCommand(command);
    if (issues.length > 0) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }

    const note = command.payload.note;

    // Guard 2: referential guards — the work binding must exist and the note
    // author run must be a real Run aggregate.
    const workRef = workContextRefFor(command.identity.projectId, note.workspaceId, note.workId);
    const bindingResult = await this.deps.ledger.load(workRef);
    if (bindingResult.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    const binding = bindingResult.snapshot as WorkContextBindingSnapshot;
    if ((await this.deps.ledger.load(note.runRef)).status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }

    // Guard 3: the note author run must be LINKED to the work binding (the note
    // is authored within the work — never by a foreign run). Zero write.
    const runKey = canonicalJson(note.runRef);
    if (!binding.binding.linkedRunRefs.some((r) => canonicalJson(r) === runKey)) {
      return { status: "rejected", commandId: command.commandId, code: "run_not_in_work" };
    }

    // Guard 5: deterministic fold (body-first: the note body was already put
    // into the ArtifactVault by the author) -> atomic commit -> mapping.
    const batch = buildExecutionNoteRecordLedgerCommit(command, {
      eventId: this.deps.eventId(),
      occurredAt: this.deps.now(),
    });
    const receipt = await this.deps.ledger.commit(batch);
    return mapNoteReceipt(receipt, command, note);
  }

  // --------------------------------------------------------------------- //
  // recordContinuation — one immutable observed continuation report       //
  // --------------------------------------------------------------------- //

  async recordContinuation(command: RecordContinuationCommand): Promise<RecordContinuationReceipt> {
    // Guard 1: schema / shape validation (zero write).
    const issues = validateRecordContinuationCommand(command);
    if (issues.length > 0) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }

    const result = command.payload.result;

    // Guard 2: the work binding must exist (a continuation report is recorded
    // for a durable work identity). Zero write.
    const workRef = workContextRefFor(command.identity.projectId, result.workspaceId, result.workId);
    if ((await this.deps.ledger.load(workRef)).status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }

    // Guard 5: deterministic fold -> atomic commit -> mapping.
    const batch = buildContinuationRecordLedgerCommit(command, {
      eventId: this.deps.eventId(),
      occurredAt: this.deps.now(),
    });
    const receipt = await this.deps.ledger.commit(batch);
    return mapContinuationReceipt(receipt, command, result);
  }
}

// --------------------------------------------------------------------- //
// Receipt mapping helpers (ledger.commit receipt -> P1-16 receipts)       //
// --------------------------------------------------------------------- //

function mapBindReceipt(receipt: LedgerCommitReceipt, command: BindWorkContextCommand): BindWorkContextReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      workContextRef: workContextRefFor(command.identity.projectId, command.payload.workspaceId, command.aggregateId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  switch (receipt.code) {
    case "invalid_commit":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "revision_conflict":
      return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
    case "idempotency_conflict":
      return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
    case "unavailable":
      return { status: "rejected", commandId: command.commandId, code: "unavailable" };
    case "not_empty":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }
}

function mapLinkReceipt(
  receipt: LedgerCommitReceipt,
  command: LinkWorkRunCommand,
  binding: WorkContextBindingSnapshot,
  workRef: import("../contracts/context-continuity.js").WorkContextRef,
): LinkWorkRunReceipt {
  if (receipt.status === "committed") {
    const revision =
      receipt.aggregateRevisions.find((v) => v.ref.aggregateType === "WorkContextBinding")?.revision ??
      binding.revision + 1;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      workContextRef: workRef,
      revision,
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  switch (receipt.code) {
    case "invalid_commit":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "revision_conflict":
      return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
    case "idempotency_conflict":
      return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
    case "unavailable":
      return { status: "rejected", commandId: command.commandId, code: "unavailable" };
    case "not_empty":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }
}

function mapNoteReceipt(
  receipt: LedgerCommitReceipt,
  command: RecordExecutionNoteCommand,
  note: import("../contracts/context-continuity.js").ExecutionNoteV1,
): RecordExecutionNoteReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      noteRef: executionNoteRefFor(command.identity.projectId, note.workspaceId, note.workId, note.noteId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  switch (receipt.code) {
    case "invalid_commit":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "revision_conflict":
      return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
    case "idempotency_conflict":
      return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
    case "unavailable":
      return { status: "rejected", commandId: command.commandId, code: "unavailable" };
    case "not_empty":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }
}

function mapContinuationReceipt(
  receipt: LedgerCommitReceipt,
  command: RecordContinuationCommand,
  result: import("../contracts/context-continuity.js").ContextContinuationResultV1,
): RecordContinuationReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      continuationRef: continuationRecordRefFor(command.identity.projectId, result.workspaceId, result.workId, result.reportId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  switch (receipt.code) {
    case "invalid_commit":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "revision_conflict":
      return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
    case "idempotency_conflict":
      return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
    case "unavailable":
      return { status: "rejected", commandId: command.commandId, code: "unavailable" };
    case "not_empty":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }
}
