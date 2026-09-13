/**
 * P1-07 Control entry: recordIntegrationResult (evidence join).
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane B fills the
 * implementation). Frozen semantics: IMPLEMENTATION-HANDOFF.md "P1-07 契约与
 * 存储语义" item 6: guard sequence (shape -> run ended -> canonical workspace/
 * plan -> input presence/run-match -> detectEvidenceConflicts -> unresolved ->
 * duplicate -> accumulator CAS), conflicts NEVER overwritten, integrate facts
 * only (P1-04/05 formulas untouched).
 */
import type {
  RecordIntegrationResultCommand,
  RecordIntegrationResultReceipt,
  IntegrationResultSnapshot,
  EvidenceConflictFactV1,
  IntegrationTaskResultV1,
} from "../../contracts/integration.js";
import { integrationResultRefFor } from "../../contracts/integration.js";
import { detectEvidenceConflicts } from "./policies/integration.js";
import type { StateLedger, AggregateSnapshot, WorkspaceSnapshot } from "../../contracts/ledger.js";
import type { RunSnapshot } from "../../contracts/dispatch.js";
import type { PlanRevisionSnapshot } from "../../contracts/plan.js";
import type { EvidenceSnapshot } from "../../contracts/evidence.js";
import { evidenceApplicability } from "./policies/evidence.js";
import type { HandoffPacketSnapshot } from "../../contracts/handoff.js";
import { canonicalJson } from "../../contracts/fingerprint.js";
import { validateRecordIntegrationResultCommand } from '../../contracts/validation/integration.js';
import { buildEffectivityAnchorV1 } from "../../contracts/commands/evidence.js";
import { buildIntegrationRecordLedgerCommit } from "./records/workspace.js";
import type { ControlEngineDeps } from "./control-engine.js";

function isRunSnapshot(s: AggregateSnapshot): s is RunSnapshot {
  return s.ref.aggregateType === "Run";
}
function isWorkspaceSnapshot(s: AggregateSnapshot): s is WorkspaceSnapshot {
  return s.ref.aggregateType === "Workspace";
}
function isPlanSnapshot(s: AggregateSnapshot): s is PlanRevisionSnapshot {
  return s.ref.aggregateType === "PlanRevision";
}
function isEvidenceSnapshot(s: AggregateSnapshot): s is EvidenceSnapshot {
  return s.ref.aggregateType === "Evidence";
}
function isIntegrationSnapshot(s: AggregateSnapshot): s is IntegrationResultSnapshot {
  return s.ref.aggregateType === "IntegrationResult";
}
function isHandoffSnapshot(s: AggregateSnapshot): s is HandoffPacketSnapshot {
  return s.ref.aggregateType === "HandoffPacket";
}

function mapRecordIntegrationResultReceipt(
  receipt: import("../../contracts/ledger.js").LedgerCommitReceipt,
  command: RecordIntegrationResultCommand,
): RecordIntegrationResultReceipt {
  if (receipt.status === "committed") {
    const result = command.payload.result;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      resultRef: integrationResultRefFor(command.identity.projectId, result.goalId, result.taskId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  switch (receipt.code) {
    case "invalid_commit":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "idempotency_conflict":
      return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
    case "revision_conflict":
      return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
    case "unavailable":
      return { status: "rejected", commandId: command.commandId, code: "unavailable" };
    case "not_empty":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }
}

async function recordIntegrationResultImpl(
  deps: ControlEngineDeps,
  command: RecordIntegrationResultCommand,
): Promise<RecordIntegrationResultReceipt> {
  // Guard 1: schema validation (zero write).
  const issues = validateRecordIntegrationResultCommand(command);
  if (issues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const result = command.payload.result;
  const projectId = command.identity.projectId;

  // Guard 2: the integration Run exists and has ended.
  const runResult = await deps.ledger.load(result.runRef);
  if (runResult.status === "not_found" || !isRunSnapshot(runResult.snapshot)) {
    return { status: "rejected", commandId: command.commandId, code: "run_not_found" };
  }
  const run = runResult.snapshot;
  if (run.status !== "ended") {
    return { status: "rejected", commandId: command.commandId, code: "run_not_ended" };
  }

  // Guard 3: canonical Workspace exists and the join was computed under its
  // current revision (no stale source).
  const workspaceResult = await deps.ledger.load({
    aggregateType: "Workspace",
    projectId,
    workspaceId: result.workspaceId,
  });
  if (workspaceResult.status === "not_found" || !isWorkspaceSnapshot(workspaceResult.snapshot)) {
    return { status: "rejected", commandId: command.commandId, code: "workspace_not_found" };
  }
  const workspace = workspaceResult.snapshot;
  if (result.workspaceRevision !== workspace.revision) {
    return { status: "rejected", commandId: command.commandId, code: "stale_source" };
  }

  // Guard 4: canonical PlanRevision exists and the join task revision matches.
  const planResult = await deps.ledger.load(result.planRef);
  if (planResult.status === "not_found" || !isPlanSnapshot(planResult.snapshot)) {
    return { status: "rejected", commandId: command.commandId, code: "plan_not_found" };
  }
  const plan = planResult.snapshot;
  // NOTE: the frozen validator (validateRecordIntegrationResultCommand) uses
  // stringField for result.taskRevision, so the join carries it as a STRING;
  // the plan revision is numeric. The frozen stale_source rule compares them,
  // so compare on the normalized string form (baseline gap reported).
  if (String(result.taskRevision) !== String(plan.planRevision)) {
    return { status: "rejected", commandId: command.commandId, code: "stale_source" };
  }

  // Construct the CURRENT effectivity tuple used for applicability (frozen
  // formula: plan + revision tuple + pinned policy/baseline).
  const currentAnchor = buildEffectivityAnchorV1({
    planRef: result.planRef,
    planRevision: plan.planRevision,
    workspaceRevision: workspace.revision,
    pinnedCompletionPolicy: plan.effectiveCompletionPolicy,
    pinnedArchitectureBaseline: plan.effectiveArchitectureBaseline,
  });

  // Guard 5/6: every input reference must exist in the ledger and match its
  // declared origin; evidence must be APPLICABLE under the current anchor.
  // While guarding, resolve the evidence facts the pure conflict detector needs.
  const factsMap = new Map<string, EvidenceConflictFactV1>();
  for (const input of result.inputs) {
    if (input.kind === "evidence") {
      if (input.evidenceRef === null) {
        return { status: "rejected", commandId: command.commandId, code: "input_not_found" };
      }
      const evResult = await deps.ledger.load(input.evidenceRef);
      if (evResult.status === "not_found" || !isEvidenceSnapshot(evResult.snapshot)) {
        return { status: "rejected", commandId: command.commandId, code: "input_not_found" };
      }
      const evidence = evResult.snapshot.evidence;
      if (canonicalJson(evidence.source.runRef) !== canonicalJson(input.sourceRunRef)) {
        return { status: "rejected", commandId: command.commandId, code: "input_run_mismatch" };
      }
      const applicability = evidenceApplicability(evidence, plan, currentAnchor);
      if (applicability !== "APPLICABLE") {
        return { status: "rejected", commandId: command.commandId, code: "input_not_accepted" };
      }
      factsMap.set(evidence.evidenceId, {
        evidenceId: evidence.evidenceId,
        outcome: evidence.outcome,
        applicability,
        runRef: evidence.source.runRef!,
        planRevision: evidence.anchor.planRevision,
        workspaceRevision: evidence.anchor.workspaceRevision,
        coverage: evidence.coverage[0]!,
      });
    } else if (input.kind === "handoff") {
      if (input.handoffPacketRef === null) {
        return { status: "rejected", commandId: command.commandId, code: "input_not_found" };
      }
      const hopResult = await deps.ledger.load(input.handoffPacketRef);
      if (hopResult.status === "not_found" || !isHandoffSnapshot(hopResult.snapshot)) {
        return { status: "rejected", commandId: command.commandId, code: "input_not_found" };
      }
    } else {
      // artifact: frozen rule is reference-shape only; the caller is responsible
      // for the vault body (same precedent as P1-03/04/06 vault references).
      if (input.artifactRef === null) {
        return { status: "rejected", commandId: command.commandId, code: "input_not_found" };
      }
    }
  }

  // Guard 7: pure mechanical conflict detection (frozen; no semantic inference).
  const detectedConflicts = detectEvidenceConflicts(
    result.inputs,
    (evidenceId) => factsMap.get(evidenceId) ?? null,
    deps.now(),
  );

  if (detectedConflicts.length > 0 && result.explanation === null && result.escalate !== true) {
    return { status: "rejected", commandId: command.commandId, code: "conflict_unresolved" };
  }
  if (result.escalate === true && detectedConflicts.length === 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  // Guard 8: never overwrite — an authoritative first record owns a conflictKey.
  // A later result re-using ANY already-recorded conflictKey is rejected. The
  // prior records also give the accumulator CAS (expected = record count).
  const aggRef = integrationResultRefFor(projectId, result.goalId, result.taskId);
  const aggResult = await deps.ledger.load(aggRef);
  const priorRecords: IntegrationTaskResultV1[] = [];
  if (aggResult.status === "found" && isIntegrationSnapshot(aggResult.snapshot)) {
    const existingKeys = new Set<string>();
    for (const rec of aggResult.snapshot.records) {
      for (const conflict of rec.conflicts) existingKeys.add(conflict.conflictKey);
    }
    for (const conflict of detectedConflicts) {
      if (existingKeys.has(conflict.conflictKey)) {
        return { status: "rejected", commandId: command.commandId, code: "conflict_duplicate" };
      }
    }
    priorRecords.push(...aggResult.snapshot.records);
  }

  // Guard 9: deterministic fold (fold-equality with the shared fixture builder)
  // — the recorded conflicts are the AUTHORITATIVE frozen detection (so the
  // join fact/conflict surface reflects detectEvidenceConflicts, not a
  // caller-supplied array). -> single atomic commit.
  // NOTE: the frozen commit validator requires event.occurredAt === last.generatedAt,
  // so the event timestamp is the result's own generatedAt (the harness clock
  // differs from a caller-supplied generatedAt — baseline gap reported).
  const eventId = deps.eventId();
  const occurredAt = result.generatedAt;
  const foldCommand: RecordIntegrationResultCommand = {
    ...command,
    payload: {
      ...command.payload,
      result: { ...result, conflicts: detectedConflicts },
    },
  };
  const batch = buildIntegrationRecordLedgerCommit(foldCommand, {
    eventId,
    occurredAt,
    priorRecords,
  });

  const receipt = await deps.ledger.commit(batch);
  return mapRecordIntegrationResultReceipt(receipt, command);
}

export function recordIntegrationResult(
  deps: ControlEngineDeps,
  command: RecordIntegrationResultCommand,
): Promise<RecordIntegrationResultReceipt> {
  return recordIntegrationResultImpl(deps, command);
}
