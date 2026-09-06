/**
 * P1-13 Control entry (Lane B): RemediationEngineImpl — authoritative allowlist
 * verdict recompute + RemediationPlanPatch record + RemediationTask dedup/create
 * + status advance.
 *
 * ENTRY FILE (shared baseline — exported signatures FROZEN). Implements the
 * frozen guard order from the ticket acceptance + integrator pre-ruling:
 *   1. submitPlanPatch:
 *        schema shape -> invalid; finding load -> not_found;
 *        resolveProjectArchitectureEvolutionPolicy -> policy_unresolved;
 *        patch.workspaceRevision != finding.workspaceRevision -> stale_finding;
 *        evolutionPolicyDecision(finding, content, ctx{policyRevision,
 *        remediationCountThisCycle: 0, pipelineWorkspaceRevision}) — the ENGINE
 *        recomputes the verdict as AUTHORITY (patch.verdict is advisory):
 *          - recompute disallows -> allowlist_rejected (zero write);
 *          - recompute allows  -> record with verdict REPLACED by the recompute
 *            (patch.verdict.allowed/reasons are never trusted), fold
 *            buildP113PlanPatchRecordCommit (CAS@0).
 *   2. createTask:
 *        patch load -> patch_not_found; recompute verdict (policy / allowlist
 *        same as submit -> not_found / policy_unresolved / stale_finding /
 *        allowlist_rejected, all zero write); dedup scan over the committed
 *        event stream (ledger.events is the ONLY deterministic read permitted
 *        in this lane): if the dedup key is occupied by a task whose status is
 *        in remediationTaskOccupiesDedupKey -> deduplicated receipt
 *        (existingTaskRef, zero write); otherwise fold
 *        buildP113TaskRecordCommit (CAS@0).
 *   3. advanceTask:
 *        task load (event-scan resolution) -> not_found; current status
 *        terminal (resolved|failed|blocked) -> terminal_status; illegal
 *        transition -> invalid; resolved guard (evidenceRefs non-empty +
 *        result.verified true + outcome PASS + workspaceRevisionAfter >=
 *        patch.workspaceRevision) else evidence_mismatch; fold
 *        buildP113TaskAdvanceCommit (CAS@N, nextRevision = current + 1).
 *   4. receipt mapping: invalid_commit -> invalid; revision_conflict /
 *        idempotency_conflict / unavailable pass through.
 *
 * Design note on event-scan resolution: the AdvanceRemediationTaskCommand
 * carries only (projectId, aggregateId=taskId) — no workspaceId — so the task
 * ref is resolved by scanning the committed event log (deterministic, small P1
 * scale) rather than a partial-ref load. The same scan builds the dedup map.
 */
import type {
  SubmitRemediationPlanPatchCommand,
  SubmitRemediationPlanPatchReceipt,
  CreateRemediationTaskCommand,
  CreateRemediationTaskReceipt,
  AdvanceRemediationTaskCommand,
  AdvanceRemediationTaskReceipt,
  RemediationPlanPatchV1,
  RemediationPlanPatchSnapshot,
  RemediationTaskV1,
  RemediationTaskSnapshot,
  RemediationTaskRef,
  RemediationPlanPatchRef,
  RemediationTaskStatus,
  RemediationDeduplicationKeyV1,
} from "../contracts/remediation.js";
import {
  remediationPlanPatchRefFor,
  remediationTaskRefFor,
  remediationDedupKeyOf,
  remediationTaskOccupiesDedupKey,
} from "../contracts/remediation.js";
import type { ArchitectureFindingV1, ArchitectureFindingSnapshot } from "../contracts/architecture-inspection.js";
import { resolveProjectArchitectureEvolutionPolicy, evolutionPolicyDecision, type EvolutionPolicyDecision } from "../contracts/architecture-evolution-policy.js";
import type { LedgerCommitReceipt, StateLedger } from "../contracts/ledger.js";
import {
  buildP113PlanPatchRecordCommit,
  buildP113TaskRecordCommit,
  buildP113TaskAdvanceCommit,
} from "../contracts/fixtures/remediation-fixtures.js";
import type { ControlEngineDeps } from "./control-engine.js";

type ScanEntry = { task: RemediationTaskV1; ref: RemediationTaskRef; revision: number };
type RemediationScan = { byTaskId: Map<string, ScanEntry>; byDedupKey: Map<string, ScanEntry>; latestCursor: import("../contracts/command-event.js").CommitCursor | null };

/** Deterministic full event-log scan of the remediation task stream (project-scoped). */
async function scanRemediation(ledger: StateLedger, projectId: string): Promise<RemediationScan> {
  const byTaskId = new Map<string, ScanEntry>();
  const byDedupKey = new Map<string, ScanEntry>();
  let latestCursor: import("../contracts/command-event.js").CommitCursor | null = null;
  let cursor: import("../contracts/command-event.js").CommitCursor | null = null;
  for (;;) {
    const page = await ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const positioned of page.events) {
      const ev = positioned.event;
      if (ev.projectId !== projectId) continue;
      let task: RemediationTaskV1 | undefined;
      let aggregateRevision = ev.aggregateRevision;
      if (ev.eventType === "RemediationTaskCreated") task = ev.payload.task;
      else if (ev.eventType === "RemediationTaskAdvanced") task = ev.payload.task;
      if (task === undefined) continue;
      const entry: ScanEntry = { task, ref: remediationTaskRefFor(task.projectId, task.workspaceId, task.taskId), revision: aggregateRevision };
      byTaskId.set(task.taskId, entry);
      byDedupKey.set(remediationDedupKeyOf(task.dedupKey), entry);
    }
    if (page.throughCursor !== null) latestCursor = page.throughCursor;
    if (!page.hasMore) break;
    cursor = page.throughCursor;
  }
  return { byTaskId, byDedupKey, latestCursor };
}

/** The dedup key a patch pins (deterministic; pure). */
function dedupKeyForPatch(patch: RemediationPlanPatchV1): RemediationDeduplicationKeyV1 {
  return {
    schemaVersion: 1,
    projectId: patch.projectId,
    workspaceId: patch.workspaceId,
    findingId: patch.findingId,
    policyRevision: patch.policyPin.ref.revision,
    workspaceRevision: patch.workspaceRevision,
  };
}

async function loadFinding(ledger: StateLedger, ref: import("../contracts/architecture-inspection.js").ArchitectureFindingRef): Promise<ArchitectureFindingV1 | null> {
  const result = await ledger.load(ref);
  if (result.status !== "found" || result.snapshot.ref.aggregateType !== "ArchitectureFinding") return null;
  return (result.snapshot as ArchitectureFindingSnapshot).finding;
}

async function loadPatch(ledger: StateLedger, ref: RemediationPlanPatchRef): Promise<RemediationPlanPatchV1 | null> {
  const result = await ledger.load(ref);
  if (result.status !== "found" || result.snapshot.ref.aggregateType !== "RemediationPlanPatch") return null;
  return (result.snapshot as RemediationPlanPatchSnapshot).patch;
}

/**
 * Shared verdict recompute (engine is AUTHORITY): returns either a rejection
 * code + reasons (zero write) or the authoritative decision + the resolved
 * policy content to fold with.
 */
async function recomputeAllowed(
  deps: ControlEngineDeps,
  patch: RemediationPlanPatchV1,
): Promise<
  | { ok: false; code: "not_found" | "policy_unresolved" | "stale_finding" | "allowlist_rejected"; reasons?: string[] }
  | { ok: true; decision: EvolutionPolicyDecision }
> {
  const finding = await loadFinding(deps.ledger, patch.findingRef);
  if (finding === null) return { ok: false, code: "not_found" };
  const policyResolution = await resolveProjectArchitectureEvolutionPolicy(deps.ledger, patch.projectId);
  if (policyResolution.status !== "found") return { ok: false, code: "policy_unresolved" };
  if (patch.workspaceRevision !== finding.workspaceRevision) return { ok: false, code: "stale_finding" };
  const decision = evolutionPolicyDecision(finding, policyResolution.snapshot.content, {
    policyRevision: policyResolution.pin.ref.revision,
    remediationCountThisCycle: 0,
    pipelineWorkspaceRevision: patch.workspaceRevision,
  });
  if (!decision.allowed) return { ok: false, code: "allowlist_rejected", reasons: decision.reasons };
  return { ok: true, decision };
}

/** Deterministic-state check: is the transition allowed? (PURE) */
function transitionAllowed(from: RemediationTaskStatus, to: RemediationTaskStatus): boolean {
  const next = (transitionTable[from] ?? []).includes(to as never);
  return next;
}

const transitionTable: Record<RemediationTaskStatus, RemediationTaskStatus[]> = {
  pending: ["writing"],
  writing: ["verifying", "blocked"],
  verifying: ["resolved", "failed", "blocked"],
  resolved: [],
  failed: [],
  blocked: [],
};

function mapRejected(code: string): "invalid" | "revision_conflict" | "idempotency_conflict" | "unavailable" {
  switch (code) {
    case "invalid_commit":
      return "invalid";
    case "revision_conflict":
      return "revision_conflict";
    case "idempotency_conflict":
      return "idempotency_conflict";
    case "unavailable":
      return "unavailable";
    default:
      return "invalid";
  }
}

function mapSubmitReceipt(receipt: LedgerCommitReceipt, command: SubmitRemediationPlanPatchCommand): SubmitRemediationPlanPatchReceipt {
  if (receipt.status === "committed") {
    const patch = command.payload.patch;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      patchRef: remediationPlanPatchRefFor(patch.projectId, patch.workspaceId, patch.patchId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return { status: "rejected", commandId: command.commandId, code: mapRejected(receipt.code) };
}

function mapCreateReceipt(receipt: LedgerCommitReceipt, command: CreateRemediationTaskCommand, taskRef: RemediationTaskRef, deduplicated: boolean, existingTaskRef: RemediationTaskRef | null): CreateRemediationTaskReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      taskRef,
      deduplicated,
      existingTaskRef,
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return { status: "rejected", commandId: command.commandId, code: mapRejected(receipt.code) };
}

function mapAdvanceReceipt(receipt: LedgerCommitReceipt, command: AdvanceRemediationTaskCommand, taskRef: RemediationTaskRef): AdvanceRemediationTaskReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      taskRef,
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return { status: "rejected", commandId: command.commandId, code: mapRejected(receipt.code) };
}

export class RemediationEngineImpl {
  constructor(private readonly deps: ControlEngineDeps) {}

  async submitPlanPatch(command: SubmitRemediationPlanPatchCommand): Promise<SubmitRemediationPlanPatchReceipt> {
    const patch = command.payload.patch;
    if (command.schemaVersion !== 1 || command.commandType !== "SubmitRemediationPlanPatch" || patch.schemaVersion !== 1 || command.aggregateId !== patch.patchId || patch.patchId.length === 0 || patch.projectId.length === 0 || patch.workspaceId.length === 0) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
    const verdict = await recomputeAllowed(this.deps, patch);
    if (!verdict.ok) return { status: "rejected", commandId: command.commandId, code: verdict.code, ...(verdict.reasons !== undefined ? { issues: verdict.reasons } : {}) };
    // Engine authority: never trust patch.verdict — fold with the recompute.
    const recordedPatch: RemediationPlanPatchV1 = { ...patch, verdict: verdict.decision };
    const command2: SubmitRemediationPlanPatchCommand = { ...command, payload: { patch: recordedPatch } };
    const eventId = this.deps.eventId();
    const occurredAt = this.deps.now();
    const batch = buildP113PlanPatchRecordCommit(command2, { eventId, occurredAt, recordedAt: occurredAt });
    const receipt = await this.deps.ledger.commit(batch);
    return mapSubmitReceipt(receipt, command2);
  }

  async createTask(command: CreateRemediationTaskCommand): Promise<CreateRemediationTaskReceipt> {
    const { patchRef, taskId } = command.payload;
    if (command.schemaVersion !== 1 || command.commandType !== "CreateRemediationTask" || taskId.length === 0 || command.aggregateId !== taskId) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
    const patch = await loadPatch(this.deps.ledger, patchRef);
    if (patch === null) return { status: "rejected", commandId: command.commandId, code: "patch_not_found" };
    const verdict = await recomputeAllowed(this.deps, patch);
    if (!verdict.ok) return { status: "rejected", commandId: command.commandId, code: verdict.code, ...(verdict.reasons !== undefined ? { issues: verdict.reasons } : {}) };

    const dedupKey = dedupKeyForPatch(patch);
    const scan = await scanRemediation(this.deps.ledger, patch.projectId);

    const taskRef = remediationTaskRefFor(patch.projectId, patch.workspaceId, taskId);
    // If the requested taskId already exists this is a re-create of the SAME
    // aggregate — let the ledger decide (idempotent replay vs CAS conflict)
    // rather than reporting it as a dedup.
    if (!scan.byTaskId.has(taskId)) {
      const occupying = scan.byDedupKey.get(remediationDedupKeyOf(dedupKey));
      if (occupying !== undefined && remediationTaskOccupiesDedupKey(occupying.task.status)) {
        return {
          status: "committed",
          commandId: command.commandId,
          replayed: false,
          taskRef,
          deduplicated: true,
          existingTaskRef: occupying.ref,
          eventIds: [],
          commitCursor: scan.latestCursor as import("../contracts/command-event.js").CommitCursor,
        };
      }
    }

    const now = this.deps.now();
    const task: RemediationTaskV1 = {
      schemaVersion: 1,
      taskId,
      projectId: patch.projectId,
      workspaceId: patch.workspaceId,
      dedupKey,
      findingRef: patch.findingRef,
      patchRef,
      status: "pending",
      writerRunRef: null,
      evidenceRefs: [],
      planBaselinePin: patch.planBaselinePin,
      completionPolicyPin: patch.completionPolicyPin,
      result: null,
      createdAt: now,
      updatedAt: now,
    };
    const eventId = this.deps.eventId();
    const occurredAt = this.deps.now();
    const batch = buildP113TaskRecordCommit(command, { eventId, occurredAt, task });
    const receipt = await this.deps.ledger.commit(batch);
    return mapCreateReceipt(receipt, command, taskRef, false, null);
  }

  async advanceTask(command: AdvanceRemediationTaskCommand): Promise<AdvanceRemediationTaskReceipt> {
    const taskId = command.aggregateId;
    const to = command.payload.status;
    if (command.schemaVersion !== 1 || command.commandType !== "AdvanceRemediationTask" || taskId.length === 0) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
    const scan = await scanRemediation(this.deps.ledger, command.identity.projectId);
    const current = scan.byTaskId.get(taskId);
    if (current === undefined) return { status: "rejected", commandId: command.commandId, code: "not_found" };
    const from = current.task.status;
    if (from === "resolved" || from === "failed" || from === "blocked") {
      return { status: "rejected", commandId: command.commandId, code: "terminal_status" };
    }
    if (!transitionAllowed(from, to)) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
    if (to === "resolved") {
      const { evidenceRefs, result } = command.payload;
      const patch = await loadPatch(this.deps.ledger, current.task.patchRef);
      const patchWorkspaceRevision = patch?.workspaceRevision ?? -1;
      const ok =
        evidenceRefs.length > 0 &&
        result !== null &&
        result.verified === true &&
        result.outcome === "PASS" &&
        result.workspaceRevisionAfter >= patchWorkspaceRevision;
      if (!ok) {
        return { status: "rejected", commandId: command.commandId, code: "evidence_mismatch" };
      }
    }
    const now = this.deps.now();
    const nextTask: RemediationTaskV1 = {
      ...current.task,
      status: to,
      writerRunRef: command.payload.writerRunRef,
      evidenceRefs: command.payload.evidenceRefs,
      result: command.payload.result,
      updatedAt: now,
    };
    const nextRevision = current.revision + 1;
    const eventId = this.deps.eventId();
    const occurredAt = this.deps.now();
    const batch = buildP113TaskAdvanceCommit(command, { eventId, occurredAt, nextRevision, task: nextTask });
    const receipt = await this.deps.ledger.commit(batch);
    return mapAdvanceReceipt(receipt, command, current.ref);
  }
}
