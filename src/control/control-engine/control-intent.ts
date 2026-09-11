/**
 * P1-10 Control entry: ControlIntentEngineImpl — durable desired-state
 * intents + safe-point acks.
 */
import type { RecordSafePointAckCommand, RecordSafePointAckReceipt, SubmitControlCommand, SubmitControlReceipt } from "../../contracts/control-intent.js";
import { CONTROL_INTENT_MAX_ACKS, controlIntentRefFor } from "../../contracts/control-intent.js";
import { buildControlIntentRecordLedgerCommit, buildControlAckRecordLedgerCommit } from "./records/control.js";
import type { LedgerCommitReceipt, WorkspaceRef } from "../../contracts/ledger.js";
import type { RunRef } from "../../contracts/dispatch.js";
import type { ControlEngineDeps } from "./control-engine.js";

export class ControlIntentEngineImpl {
  private readonly deps: ControlEngineDeps;

  constructor(deps: ControlEngineDeps) {
    this.deps = deps;
  }

  async submit(command: SubmitControlCommand): Promise<SubmitControlReceipt> {
    const intent = command.payload.intent;
    if (intent.schemaVersion !== 1 || intent.intentId !== command.aggregateId || intent.status !== "queued") {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
    const kindState: Record<string, string> = { pause: "paused", resume: "running", cancel: "cancelled", steer: "steered" };
    if (kindState[intent.kind] !== intent.desiredState) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
    const ws: WorkspaceRef = { aggregateType: "Workspace", projectId: command.identity.projectId, workspaceId: intent.workspaceId };
    if ((await this.deps.ledger.load(ws)).status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    if (intent.scope.runRef !== null) {
      const runLoad = await this.deps.ledger.load(intent.scope.runRef as RunRef);
      if (runLoad.status === "not_found") return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    const batch = buildControlIntentRecordLedgerCommit(command, { eventId: this.deps.eventId(), occurredAt: this.deps.now() });
    const receipt = await this.deps.ledger.commit(batch);
    return this.mapSubmit(receipt, command);
  }

  private mapSubmit(receipt: LedgerCommitReceipt, command: SubmitControlCommand): SubmitControlReceipt {
    if (receipt.status === "committed") {
      const intent = command.payload.intent;
      return { status: "committed", commandId: command.commandId, replayed: receipt.replayed, intentRef: controlIntentRefFor(intent.projectId, intent.workspaceId, intent.intentId), eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
    }
    switch (receipt.code) {
      case "revision_conflict": return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
      case "idempotency_conflict": return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
      default: return { status: "rejected", commandId: command.commandId, code: "unavailable" };
    }
  }

  async recordSafePointAck(command: RecordSafePointAckCommand): Promise<RecordSafePointAckReceipt> {
    const ack = command.payload.ack;
    const intentRef = controlIntentRefFor(command.identity.projectId, command.payload.ack.intentRef.workspaceId, command.aggregateId);
    if (ack.intentRef.intentId !== command.aggregateId || ack.schemaVersion !== 1) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
    const load = await this.deps.ledger.load(intentRef);
    if (load.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    const snapshot = load.snapshot as import("../../contracts/control-intent.js").ControlIntentSnapshot;
    if (ack.runRef !== null && snapshot.intent.scope.runRef !== null && ack.runRef.runId !== snapshot.intent.scope.runRef.runId) {
      return { status: "rejected", commandId: command.commandId, code: "stale_ack" };
    }
    if (snapshot.intent.acks.length >= CONTROL_INTENT_MAX_ACKS) {
      return { status: "rejected", commandId: command.commandId, code: "acks_exceeded" };
    }
    const nextIntent = {
      ...snapshot.intent,
      acks: [...snapshot.intent.acks, ack],
      status: ack.applied ? "applied" : "rejected",
      updatedAt: this.deps.now(),
    } as import("../../contracts/control-intent.js").ControlIntentV1;
    const batch = buildControlAckRecordLedgerCommit(command, { eventId: this.deps.eventId(), occurredAt: this.deps.now(), nextRevision: snapshot.revision + 1, nextIntent });
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      return { status: "committed", commandId: command.commandId, replayed: receipt.replayed, intentRef, revision: snapshot.revision + 1, eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
    }
    return receipt.code === "revision_conflict"
      ? { status: "rejected", commandId: command.commandId, code: "revision_conflict" }
      : { status: "rejected", commandId: command.commandId, code: "unavailable" };
  }
}
