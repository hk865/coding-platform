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
 *        remediationCountThisCycle, pipelineWorkspaceRevision}) — the ENGINE
 *        recomputes the verdict as AUTHORITY (patch.verdict is advisory).
 *        remediationCountThisCycle is a REAL deterministic count: the committed
 *        event scan counts the dedup keys already occupied inside the same cycle
 *        (project/workspace + policyRevision + workspaceRevision); a fabricated 0
 *        would make driftBudget.maxRemediationsPerCycle unreachable:
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
 *        patch.workspaceRevision) else evidence_mismatch. The self-reported
 *        fields are NECESSARY but NOT sufficient: every evidenceRef is ALSO
 *        resolved against the canonical ledger (ledger.load on the Evidence
 *        aggregate) and must be an admitted Evidence whose subject is this task,
 *        whose workspace is this task's workspace, whose anchor workspaceRevision
 *        is not older than the patch revision and whose outcome is PASS —
 *        otherwise evidence_mismatch (zero write). A caller can therefore no
 *        longer self-report a return-to-work task into "resolved"; fold
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
} from "../../contracts/remediation.js";
import {
  remediationPlanPatchRefFor,
  remediationTaskRefFor,
  remediationDedupKeyOf,
} from "../../contracts/remediation.js";
import type { EvidenceRef, EvidenceSnapshot, EvidenceV1 } from "../../contracts/evidence.js";
import { evidenceRefFor } from "../../contracts/evidence.js";
import type { PlanRevisionSnapshot } from "../../contracts/plan.js";
import type { GoalSnapshot } from "../../contracts/ledger.js";
import { remediationDriftCycleOf, remediationTaskOccupiesDedupKey, sameRemediationDriftCycle } from "./policies/remediation.js";
import type { ArchitectureFindingV1, ArchitectureFindingSnapshot } from "../../contracts/architecture-inspection.js";
import { resolveProjectArchitectureEvolutionPolicy } from "./policies/architecture-evolution-policy.js";
import type { EvolutionPolicyDecision } from "../../contracts/architecture-evolution-policy.js";
import { evolutionPolicyDecision } from "./policies/architecture-remediation.js";
import type { LedgerCommitReceipt, StateLedger } from "../../contracts/ledger.js";
import { buildP113PlanPatchRecordCommit, buildP113TaskRecordCommit, buildP113TaskAdvanceCommit } from "./records/remediation.js";
import type { ControlEngineDeps } from "./control-engine.js";

type ScanEntry = { task: RemediationTaskV1; ref: RemediationTaskRef; revision: number };
type RemediationScan = { byTaskId: Map<string, ScanEntry>; byDedupKey: Map<string, ScanEntry>; latestCursor: import("../../contracts/command-event.js").CommitCursor | null };

/** Deterministic full event-log scan of the remediation task stream (project-scoped). */
async function scanRemediation(ledger: StateLedger, projectId: string): Promise<RemediationScan> {
  const byTaskId = new Map<string, ScanEntry>();
  const byDedupKey = new Map<string, ScanEntry>();
  let latestCursor: import("../../contracts/command-event.js").CommitCursor | null = null;
  let cursor: import("../../contracts/command-event.js").CommitCursor | null = null;
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

/**
 * 本 cycle 内“已占用去重键”的 RemediationTask 数量（真实计数）。
 *
 * 统计口径与 scanRemediation 的确定性事件扫描一致：byDedupKey 已按去重键归并出
 * 每个键的最新任务状态，因此这里数的是“本 cycle 内仍占用着键的去重键个数”，
 * 与 createTask 的 dedup 判定复用同一个 remediationTaskOccupiesDedupKey（终态任务
 * 不占用键，同一键可在终态后重建）；cycle 本身由纯函数 remediationDriftCycleOf 界定。
 */
function remediationCountThisCycle(
  scan: RemediationScan,
  cycle: ReturnType<typeof remediationDriftCycleOf>,
): number {
  let count = 0;
  for (const entry of scan.byDedupKey.values()) {
    if (!sameRemediationDriftCycle(remediationDriftCycleOf(entry.task.dedupKey), cycle)) continue;
    if (remediationTaskOccupiesDedupKey(entry.task.status)) count += 1;
  }
  return count;
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

async function loadFinding(ledger: StateLedger, ref: import("../../contracts/architecture-inspection.js").ArchitectureFindingRef): Promise<ArchitectureFindingV1 | null> {
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
 * Evidence 的 workspace 归属：canonical 读取 anchor plan -> goal -> workspaceRef。
 *
 * 用这条链而不是自报字段，是因为它正是 evidence-intake 受理该 Evidence 时推导
 * workspaceId 的同一条链（Goal 存在 + Workspace 存在是该受理的前置守卫），
 * 因此任何真正被受理的 Evidence 都能解析出 workspaceId；解析不到即视为范围不可证。
 */
async function resolveEvidenceWorkspaceId(deps: ControlEngineDeps, evidence: EvidenceV1): Promise<string | null> {
  const planResult = await deps.ledger.load(evidence.anchor.planRef);
  if (planResult.status !== "found" || planResult.snapshot.ref.aggregateType !== "PlanRevision") return null;
  const plan = planResult.snapshot as PlanRevisionSnapshot;
  const goalResult = await deps.ledger.load(plan.goalRef);
  if (goalResult.status !== "found" || goalResult.snapshot.ref.aggregateType !== "Goal") return null;
  return (goalResult.snapshot as GoalSnapshot).workspaceRef.workspaceId;
}

/**
 * 单条 evidenceRef 的 canonical 校验：通过返回 null，否则返回可写入 issues 的原因码。
 *
 * 约束理由：RemediationTask 的 resolved 必须能追溯到“当前适用 Evidence”，因此
 * 证据不能由命令自报——必须在 canonical 账本中真实存在（aggregateType Evidence）、
 * subject 落在本任务的 project/task 范围、workspace 属于本任务的工作区、
 * outcome 为 PASS，且其 effectivity anchor 的 workspaceRevision 不早于返工补丁
 * （早于补丁的旧证据属于修复前的版本，不能证明修复后成立）。
 */
async function checkResolvedEvidence(
  deps: ControlEngineDeps,
  task: RemediationTaskV1,
  patchWorkspaceRevision: number,
  ref: EvidenceRef,
): Promise<string | null> {
  if (ref.aggregateType !== "Evidence") return "evidence_ref_aggregate_type_not_evidence";
  if (ref.projectId !== task.projectId) return "evidence_ref_project_out_of_scope";
  // 只按本任务的 project 取 canonical 引用，避免跨项目证据串用。
  const loaded = await deps.ledger.load(evidenceRefFor(task.projectId, ref.evidenceId));
  if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "Evidence") return "evidence_not_admitted";
  const evidence = (loaded.snapshot as EvidenceSnapshot).evidence;
  if (evidence.subject.projectId !== task.projectId || evidence.subject.taskId !== task.taskId) {
    return "evidence_subject_out_of_scope";
  }
  const evidenceWorkspaceId = await resolveEvidenceWorkspaceId(deps, evidence);
  if (evidenceWorkspaceId !== task.workspaceId) return "evidence_workspace_out_of_scope";
  if (evidence.anchor.workspaceRevision < patchWorkspaceRevision) return "evidence_stale_workspace_revision";
  if (evidence.outcome !== "PASS") return "evidence_outcome_not_pass";
  return null;
}

/**
 * Shared verdict recompute (engine is AUTHORITY): returns either a rejection
 * code + reasons (zero write) or the authoritative decision + the resolved
 * policy content to fold with. `scanned` lets a caller that already scanned the
 * event log (createTask) reuse the same deterministic scan.
 */
async function recomputeAllowed(
  deps: ControlEngineDeps,
  patch: RemediationPlanPatchV1,
  scanned?: RemediationScan,
): Promise<
  | { ok: false; code: "not_found" | "policy_unresolved" | "stale_finding" | "allowlist_rejected"; reasons?: string[] }
  | { ok: true; decision: EvolutionPolicyDecision }
> {
  const finding = await loadFinding(deps.ledger, patch.findingRef);
  if (finding === null) return { ok: false, code: "not_found" };
  const policyResolution = await resolveProjectArchitectureEvolutionPolicy(deps.ledger, patch.projectId);
  if (policyResolution.status !== "found") return { ok: false, code: "policy_unresolved" };
  if (patch.workspaceRevision !== finding.workspaceRevision) return { ok: false, code: "stale_finding" };
  // 真实漂移预算计数：本 cycle 内已经占用去重键的返工任务数（不再是硬编码 0）。
  const scan = scanned ?? (await scanRemediation(deps.ledger, patch.projectId));
  const decision = evolutionPolicyDecision(finding, policyResolution.snapshot.content, {
    policyRevision: policyResolution.pin.ref.revision,
    remediationCountThisCycle: remediationCountThisCycle(scan, remediationDriftCycleOf(dedupKeyForPatch(patch))),
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
    // 只扫描一次事件流：同一份确定性扫描同时供漂移预算计数与去重判定使用。
    // 扫描是只读的，因此不改变既有守卫顺序与拒绝码优先级。
    const scan = await scanRemediation(this.deps.ledger, patch.projectId);
    const verdict = await recomputeAllowed(this.deps, patch, scan);
    if (!verdict.ok) return { status: "rejected", commandId: command.commandId, code: verdict.code, ...(verdict.reasons !== undefined ? { issues: verdict.reasons } : {}) };

    const dedupKey = dedupKeyForPatch(patch);

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
          commitCursor: scan.latestCursor as import("../../contracts/command-event.js").CommitCursor,
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
      // 自报字段仍然必须成立（不降低既有守卫强度）：非空引用 + verified + PASS +
      // 修复后工作区版本不早于补丁版本。
      const selfReportOk =
        evidenceRefs.length > 0 &&
        result !== null &&
        result.verified === true &&
        result.outcome === "PASS" &&
        result.workspaceRevisionAfter >= patchWorkspaceRevision;
      if (!selfReportOk) {
        return { status: "rejected", commandId: command.commandId, code: "evidence_mismatch", issues: ["self_reported_result_insufficient"] };
      }
      // 新增权威校验：每条 evidenceRef 必须在 canonical 账本中对应一条真实受理的
      // Evidence，且范围/工作区/版本/结论都成立；调用方自报不能替代证据本身。
      for (const ref of evidenceRefs) {
        const issue = await checkResolvedEvidence(this.deps, current.task, patchWorkspaceRevision, ref);
        if (issue !== null) {
          return { status: "rejected", commandId: command.commandId, code: "evidence_mismatch", issues: [issue] };
        }
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
