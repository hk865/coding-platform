/**
 * P1-06 Control entry: register a bounded HandoffPacket (body-first).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN; lane A fills the
 * implementation). Frozen semantics (IMPLEMENTATION-HANDOFF "P1-06 契约与存储
 * 语义" items 1/5/6/7):
 *   1. schema validation (validateRecordHandoffCommand) -> invalid;
 *   2. source Run (packet.source.runRef) resolution: not_found; run NOT ended ->
 *      run_not_ended (zero write);
 *   3. Workspace resolution: missing -> not_found; packet workspace revision !=
 *      canonical -> stale_source (zero write);
 *   4. Plan resolution: missing -> not_found; packet.taskRevision !=
 *      plan.planRevision -> stale_source (zero write);
 *   5. one atomic handoff-record commit (HandoffRecordedEvent +
 *      HandoffPacketSnapshot@1, CAS@0) with FULL ledger idempotency;
 *   6. the packet body was ALREADY body-first'd into the ArtifactVault by the
 *      generator; Control only registers the reference (a failed commit leaves
 *      only an un-adopted Artifact).
 * Every rejection is zero-write; the single atomic fold is the ONLY write.
 */
import type { RecordHandoffCommand, RecordHandoffReceipt } from "../contracts/handoff.js";
import { handoffPacketRefFor } from "../contracts/handoff.js";
import type { LedgerCommitReceipt, WorkspaceSnapshot } from "../contracts/ledger.js";
import type { AggregateSnapshot } from "../contracts/ledger.js";
import type { RunSnapshot } from "../contracts/dispatch.js";
import type { PlanRevisionSnapshot } from "../contracts/plan.js";
import { validateRecordHandoffCommand } from "../contracts/validation.js";
import { buildHandoffRecordLedgerCommit } from "../contracts/fixtures/handoff-fixtures.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function recordHandoff(
  deps: ControlEngineDeps,
  command: RecordHandoffCommand,
): Promise<RecordHandoffReceipt> {
  return recordHandoffImpl(deps, command);
}

async function recordHandoffImpl(
  deps: ControlEngineDeps,
  command: RecordHandoffCommand,
): Promise<RecordHandoffReceipt> {
  // Guard 1: schema / shape validation (zero write).
  const issues = validateRecordHandoffCommand(command);
  if (issues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const packet = command.payload.packet;
  const projectId = command.identity.projectId;

  // Guard 2: the source Run must exist and be ENDED (a handoff is registered
  // only after A's run is a terminal fact — never over a live run).
  const runResult = await deps.ledger.load(packet.source.runRef);
  if (runResult.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const run = runResult.snapshot as RunSnapshot;
  if (run.status !== "ended") {
    return { status: "rejected", commandId: command.commandId, code: "run_not_ended" };
  }

  // Guard 3: the canonical Workspace must exist AND the packet must carry the
  // CURRENT canonical revision (a stale source is explicit — never silently
  // re-used).
  const workspaceRef = {
    aggregateType: "Workspace" as const,
    projectId,
    workspaceId: packet.workspaceId,
  };
  const workspaceResult = await deps.ledger.load(workspaceRef);
  if (workspaceResult.status === "not_found" || !isWorkspaceSnapshot(workspaceResult.snapshot)) {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const workspace = workspaceResult.snapshot as WorkspaceSnapshot;
  const workspaceId = workspace.ref.workspaceId;
  if (packet.workspaceSnapshot.revision !== workspace.revision) {
    return { status: "rejected", commandId: command.commandId, code: "stale_source" };
  }

  // Guard 4: the accepted PlanRevision must exist AND the packet must be
  // generated under the plan's CURRENT planRevision (a stale task revision is
  // explicit — re-project & re-register).
  const planResult = await deps.ledger.load(packet.planRef);
  if (planResult.status === "not_found" || !isPlanRevisionSnapshot(planResult.snapshot)) {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const plan = planResult.snapshot as PlanRevisionSnapshot;
  if (packet.taskRevision !== plan.planRevision) {
    return { status: "rejected", commandId: command.commandId, code: "stale_source" };
  }

  // Guard 5: deterministic fold (fold-equality with the shared fixture builder,
  // given the same ids) -> atomic ledger.commit -> receipt mapping.
  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildHandoffRecordLedgerCommit(command, { eventId, occurredAt, workspaceId });

  const receipt = await deps.ledger.commit(batch);
  return mapRecordHandoffReceipt(receipt, command);
}

function mapRecordHandoffReceipt(
  receipt: LedgerCommitReceipt,
  command: RecordHandoffCommand,
): RecordHandoffReceipt {
  if (receipt.status === "committed") {
    const packet = command.payload.packet;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      packetRef: handoffPacketRefFor(command.identity.projectId, packet.goalId, packet.taskId, packet.packetId),
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
      // Not reachable for a handoff-record commit (non-empty expected versions);
      // treat as a malformed command rather than inventing a rejection code.
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "revision_conflict":
      return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
  }
}

function isWorkspaceSnapshot(snapshot: AggregateSnapshot): boolean {
  return snapshot.ref.aggregateType === "Workspace";
}

function isPlanRevisionSnapshot(snapshot: AggregateSnapshot): boolean {
  return snapshot.ref.aggregateType === "PlanRevision";
}
