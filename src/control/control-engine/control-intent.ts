/**
 * ControlIntentEngineImpl — durable desired-state
 * intents + safe-point acks.
 */
import type { RecordSafePointAckCommand, RecordSafePointAckReceipt, SubmitControlCommand, SubmitControlReceipt } from "../../contracts/control-intent.js";
import { CONTROL_INTENT_MAX_ACKS, controlIntentRefFor, foldCancelIntent } from "../../contracts/control-intent.js";
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { buildControlIntentRecordLedgerCommit, buildControlAckRecordLedgerCommit } from "./records/control.js";
import type { LedgerCommitReceipt, WorkspaceRef } from "../../contracts/ledger.js";
import type { RunRef } from "../../contracts/dispatch.js";
import type { ControlEngineDeps } from "./control-engine.js";

export class ControlIntentEngineImpl {
  private readonly deps: ControlEngineDeps;

  constructor(deps: ControlEngineDeps) {
    this.deps = deps;
  }

  async reconcile(command: import('../../contracts/control-intent.js').ReconcileControlIntentCommand): Promise<import('../../contracts/control-intent.js').ReconcileControlIntentReceipt> {
    const ref = command.payload.intentRef;
    const reject = (code: import('../../contracts/control-intent.js').RecordSafePointAckRejectionCode): import('../../contracts/control-intent.js').RecordSafePointAckReceipt => ({ status: 'rejected', commandId: command.commandId, code });
    if (command.schemaVersion !== 1 || command.commandType !== 'ReconcileControlIntent' || command.identity.actor.kind !== 'system' || ref.projectId !== command.identity.projectId) return reject('invalid');
    const loaded = await this.deps.ledger.load(ref);
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'ControlIntent') return reject('not_found');
    const prior = loaded.snapshot as import('../../contracts/control-intent.js').ControlIntentSnapshot;
    if (!prior.intent.scope.runRef) return { status: 'unchanged', intentRef: ref };
    const found = await this.deps.ledger.load(prior.intent.scope.runRef);
    if (found.status !== 'found' || found.snapshot.ref.aggregateType !== 'Run') return reject('not_found');
    const run = found.snapshot as import('../../contracts/dispatch.js').RunSnapshot;
    const at = this.deps.now(), next = foldCancelIntent(prior, run, at);
    if (!next) return { status: 'unchanged', intentRef: ref };
    if (prior.revision !== command.expectedRevision) return reject('revision_conflict');
    const batch: import('../../contracts/ledger.js').ControlIntentReconcileLedgerCommitV1 = {
      schemaVersion: 1, commitKind: 'control-intent-reconcile', identity: command.identity,
      fingerprint: sha256Hex(canonicalJson(command)) as import('../../contracts/ledger.js').ControlIntentReconcileLedgerCommitV1['fingerprint'],
      expectedVersions: [{ ref, revision: prior.revision }, { ref: run.ref, revision: run.revision }],
      snapshots: [next], outboxIntents: [], events: [{ schemaVersion: 1, eventId: this.deps.eventId(), eventType: 'ControlIntentReconciled',
        projectId: ref.projectId, workspaceId: ref.workspaceId, aggregateType: 'ControlIntent', aggregateId: ref.intentId, aggregateRevision: next.revision,
        actor: command.identity.actor, idempotencyKey: command.identity.idempotencyKey, causationId: command.commandId, correlationId: command.commandId, occurredAt: at, payload: { snapshot: next } }],
    };
    const receipt = await this.deps.ledger.commit(batch);
    return receipt.status === 'committed' ? { status: 'committed', commandId: command.commandId, replayed: receipt.replayed, intentRef: ref, revision: next.revision, eventIds: receipt.eventIds, commitCursor: receipt.commitCursor }
      : reject(receipt.code === 'revision_conflict' ? 'revision_conflict' : 'unavailable');
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
    let targetRun: import('../../contracts/dispatch.js').RunSnapshot | undefined;
    if (intent.scope.runRef !== null) {
      const runLoad = await this.deps.ledger.load(intent.scope.runRef as RunRef);
      if (runLoad.status === "not_found") return { status: "rejected", commandId: command.commandId, code: "not_found" };
      targetRun = runLoad.snapshot as import('../../contracts/dispatch.js').RunSnapshot;
      if (targetRun.workspaceSnapshot.workspaceId !== intent.workspaceId || targetRun.ref.projectId !== intent.projectId) return { status: 'rejected', commandId: command.commandId, code: 'stale_scope' };
    }
    const batch = buildControlIntentRecordLedgerCommit(command, { eventId: this.deps.eventId(), occurredAt: this.deps.now() });
    if (targetRun) {
      batch.expectedVersions.push({ ref: targetRun.ref, revision: targetRun.revision });
      batch.snapshots = [batch.snapshots[0], { ...targetRun, revision: targetRun.revision + 1,
        controlState: { intentRef: batch.snapshots[0].ref, desiredState: intent.desiredState } }];
    }
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
