/**
 * P1-07 Control entry: recordPatch — single-writer patch artifact registration.
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane C fills the
 * implementation). Frozen semantics: IMPLEMENTATION-HANDOFF.md "P1-07 契约与
 * 存储语义" item 5: body-first (vault put by the writer), guard sequence, ONE
 * atomic commit carrying PatchRecorded + Workspace revision CAS advance (N ->
 * N+1) + WorkspaceWriteLeaseReleased (releasedVia patch-record) + index clear.
 *
 * Guard order (ALL zero-write except the single atomic commit):
 *   1. shape validation (validateRecordPatchCommand) -> invalid;
 *   2. the writer Run must exist and be ENDED (run_not_found / run_not_ended);
 *   3. the canonical Workspace must exist (workspace_not_found);
 *   4. the accepted PlanRevision must exist and the patch must be generated
 *      under its CURRENT planRevision (plan_not_found / stale_plan);
 *   5. an ACTIVE write lease must exist for this (project, workspace), be
 *      admissible NOW (not expired/released), and be held by THIS run
 *      (lease_not_found / not_holder);
 *   6. every changedPath must be covered by the lease scope (scope_mismatch);
 *   7. patch.beforeWorkspaceRevision === canonical Workspace revision
 *      (stale_workspace);
 *   8. every usedInputEvidenceRef must exist AND be APPLICABLE under the
 *      current anchor (input_not_found / input_not_accepted);
 *   9. deterministic fold (buildPatchRecordLedgerCommit — the ONLY fold, never
 *      hand-written) -> atomic ledger.commit -> receipt mapping.
 */
import type { RecordPatchCommand, RecordPatchReceipt } from "../contracts/patch.js";
import { patchRecordRefFor } from "../contracts/patch.js";
import type { LedgerCommitReceipt, AggregateSnapshot, WorkspaceSnapshot } from "../contracts/ledger.js";
import type { RunSnapshot } from "../contracts/dispatch.js";
import type { PlanRevisionSnapshot } from "../contracts/plan.js";
import type { EffectivityAnchorV1, EvidenceSnapshot } from "../contracts/evidence.js";
import { evidenceApplicability } from "../contracts/evidence.js";
import {
  evaluateLeaseAdmissibility,
  scopeCoversPath,
  workspaceWriteLeaseIndexRefFor,
  workspaceWriteLeaseRefFor,
  type WorkspaceWriteLeaseIndexSnapshot,
  type WorkspaceWriteLeaseSnapshot,
} from "../contracts/workspace-lease.js";
import { canonicalJson } from "../contracts/fingerprint.js";
import { validateRecordPatchCommand } from "../contracts/validation.js";
import { buildPatchRecordLedgerCommit } from "../contracts/fixtures/workspace-fixtures.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function recordPatch(
  deps: ControlEngineDeps,
  command: RecordPatchCommand,
): Promise<RecordPatchReceipt> {
  return recordPatchImpl(deps, command);
}

async function recordPatchImpl(
  deps: ControlEngineDeps,
  command: RecordPatchCommand,
): Promise<RecordPatchReceipt> {
  // Guard 1: schema / shape validation (zero write).
  const issues = validateRecordPatchCommand(command);
  if (issues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const patch = command.payload.patch;
  const projectId = command.identity.projectId;
  const workspaceId = patch.workspaceId;

  // Guard 2: the writer Run must exist and be ENDED (a patch is registered only
  // after the writer run is a terminal fact — never over a live run).
  const runResult = await deps.ledger.load(patch.runRef);
  if (runResult.status === "not_found" || !isRunSnapshot(runResult.snapshot)) {
    return { status: "rejected", commandId: command.commandId, code: "run_not_found" };
  }
  const run = runResult.snapshot as RunSnapshot;
  if (run.status !== "ended") {
    return { status: "rejected", commandId: command.commandId, code: "run_not_ended" };
  }

  // Guard 3: the canonical Workspace must exist (patch.projectId is canonical —
  // the workspace lives under the command's identity project).
  const workspaceRef = {
    aggregateType: "Workspace" as const,
    projectId,
    workspaceId,
  };
  const workspaceResult = await deps.ledger.load(workspaceRef);
  if (workspaceResult.status === "not_found" || !isWorkspaceSnapshot(workspaceResult.snapshot)) {
    return { status: "rejected", commandId: command.commandId, code: "workspace_not_found" };
  }
  const workspace = workspaceResult.snapshot as WorkspaceSnapshot;

  // Guard 4: the accepted PlanRevision must exist and the patch must be
  // generated under the plan's CURRENT planRevision (a stale task revision is
  // explicit — never silently re-used).
  const planResult = await deps.ledger.load(patch.planRef);
  if (planResult.status === "not_found" || !isPlanRevisionSnapshot(planResult.snapshot)) {
    return { status: "rejected", commandId: command.commandId, code: "plan_not_found" };
  }
  const plan = planResult.snapshot as PlanRevisionSnapshot;
  if (patch.taskRevision !== plan.planRevision) {
    return { status: "rejected", commandId: command.commandId, code: "stale_plan" };
  }

  // Guard 5: an ACTIVE write lease must exist for this (project, workspace),
  // be admissible NOW, and be held by THIS run. The load order is the
  // write-lease index CAS aggregate, then the lease itself.
  const indexRef = workspaceWriteLeaseIndexRefFor(projectId, workspaceId);
  const indexResult = await deps.ledger.load(indexRef);
  if (indexResult.status === "not_found" || !isWriteLeaseIndexSnapshot(indexResult.snapshot)) {
    return { status: "rejected", commandId: command.commandId, code: "lease_not_found" };
  }
  const writeIndex = indexResult.snapshot as WorkspaceWriteLeaseIndexSnapshot;
  const activeLeaseId = writeIndex.activeLeaseId;
  if (activeLeaseId === null) {
    return { status: "rejected", commandId: command.commandId, code: "lease_not_found" };
  }
  const leaseResult = await deps.ledger.load(workspaceWriteLeaseRefFor(projectId, activeLeaseId));
  if (leaseResult.status === "not_found" || !isWriteLeaseSnapshot(leaseResult.snapshot)) {
    return { status: "rejected", commandId: command.commandId, code: "lease_not_found" };
  }
  const lease = leaseResult.snapshot as WorkspaceWriteLeaseSnapshot;
  const now = deps.now();
  const admissibility = evaluateLeaseAdmissibility(lease.lease, now);
  if (!admissibility.admissible) {
    return { status: "rejected", commandId: command.commandId, code: "lease_not_found" };
  }
  if (canonicalJson(lease.lease.holder.runRef) !== canonicalJson(patch.runRef)) {
    return { status: "rejected", commandId: command.commandId, code: "not_holder" };
  }

  // Guard 6: every changed path must be covered by the write-lease scope.
  if (patch.changedPaths.some((path) => !scopeCoversPath(lease.lease.scope, path))) {
    return { status: "rejected", commandId: command.commandId, code: "scope_mismatch" };
  }

  // Guard 7: the patch must be based on the CURRENT canonical Workspace
  // revision (a stale workspace is explicit — never silently re-used).
  if (patch.beforeWorkspaceRevision !== workspace.revision) {
    return { status: "rejected", commandId: command.commandId, code: "stale_workspace" };
  }

  // Guard 8: every used-input evidence must exist AND be APPLICABLE under the
  // current anchor (plan pins + canonical workspace revision).
  const currentAnchor: EffectivityAnchorV1 = {
    schemaVersion: 1,
    planRef: { ...plan.ref },
    planRevision: plan.planRevision,
    workspaceRevision: workspace.revision,
    pinnedCompletionPolicy: { ...plan.effectiveCompletionPolicy },
    pinnedArchitectureBaseline: { ...plan.effectiveArchitectureBaseline },
  };
  for (const evidenceRef of patch.usedInputEvidenceRefs) {
    const evidenceResult = await deps.ledger.load(evidenceRef);
    if (evidenceResult.status === "not_found" || !isEvidenceSnapshot(evidenceResult.snapshot)) {
      return { status: "rejected", commandId: command.commandId, code: "input_not_found" };
    }
    const evidence = (evidenceResult.snapshot as EvidenceSnapshot).evidence;
    if (evidenceApplicability(evidence, plan, currentAnchor) !== "APPLICABLE") {
      return { status: "rejected", commandId: command.commandId, code: "input_not_accepted" };
    }
  }

  // Guard 9: deterministic fold (fold-equality with the shared fixture builder)
  // -> single atomic commit -> receipt mapping.
  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildPatchRecordLedgerCommit(command, {
    eventId,
    occurredAt,
    workspaceRevisionBefore: workspace.revision,
    activeLeaseSnapshot: lease,
    writeIndexSnapshot: writeIndex,
  });

  const receipt = await deps.ledger.commit(batch);
  return mapRecordPatchReceipt(receipt, command);
}

function mapRecordPatchReceipt(
  receipt: LedgerCommitReceipt,
  command: RecordPatchCommand,
): RecordPatchReceipt {
  if (receipt.status === "committed") {
    const patch = command.payload.patch;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      patchRef: patchRecordRefFor(command.identity.projectId, patch.patchId),
      workspaceRevision: patch.afterWorkspaceRevision,
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
    case "revision_conflict":
      return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
  }
}

function isRunSnapshot(snapshot: AggregateSnapshot): boolean {
  return snapshot.ref.aggregateType === "Run";
}

function isWorkspaceSnapshot(snapshot: AggregateSnapshot): boolean {
  return snapshot.ref.aggregateType === "Workspace";
}

function isPlanRevisionSnapshot(snapshot: AggregateSnapshot): boolean {
  return snapshot.ref.aggregateType === "PlanRevision";
}

function isWriteLeaseIndexSnapshot(snapshot: AggregateSnapshot): boolean {
  return snapshot.ref.aggregateType === "WorkspaceWriteLeaseIndex";
}

function isWriteLeaseSnapshot(snapshot: AggregateSnapshot): boolean {
  return snapshot.ref.aggregateType === "WorkspaceWriteLease";
}

function isEvidenceSnapshot(snapshot: AggregateSnapshot): boolean {
  return snapshot.ref.aggregateType === "Evidence";
}
