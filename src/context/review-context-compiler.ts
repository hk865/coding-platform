/**
 * ContextCompiler REVIEW extension — ReviewContextPort implementation (P1-04
 * first consumer freeze). Lane C — integrator-takeover implementation.
 * The P1-03 frozen assemble(TaskContextRequestV1) in src/context/context-compiler.ts
 * is NOT touched; this is the versioned extension in its own file.
 *
 * Frozen flow (IMPLEMENTATION-HANDOFF.md "P1-04 契约与存储语义（冻结）" §10):
 *   1) structural validation -> invalid_request;
 *   2) Goal resolve: missing -> needs_material; goal.activePlanRevision MUST
 *      equal request.planRef (exact ref) -> otherwise out_of_scope (old pin /
 *      wrong scope — deterministic, zero write);
 *   3) plan load (missing -> needs_material); workspace load: missing ->
 *      needs_material; request.workspaceSnapshot.revision != canonical ->
 *      stale_workspace_snapshot;
 *   4) RoleBindingRefV1 shape/version consistency -> stale_binding; scope ⊆
 *      declaredPermissions (tools & writeScope independently) and non-empty
 *      policyRevision -> forbidden_tool_or_scope;
 *   5) semanticChange "none" -> not_semantic_change (no-change uses the
 *      explicit fast path, never a review packet);
 *   6) budget: positive tokenBudget and un-passed deadline -> budget_exhausted;
 *   7) assemble the BOUNDED ReviewPacketV1 (materials <= REVIEW_PACKET_MAX_MATERIALS,
 *      per-material summary <= REVIEW_SUMMARY_MAX_BYTES, canonical <=
 *      REVIEW_PACKET_MAX_BYTES, noFullTranscript=true) -> exceeds_size_cap;
 *   8) body-first: the compact bundle body goes into the ArtifactVault FIRST
 *      (ownerRef = request.runRef) -> ready (packet + bundleRef + manifest).
 *   rejected/needs_material paths write NOTHING (vault.put is the only write
 *   and happens only on the ready path). This port NEVER starts a model/Agent.
 */
import type { StateLedger, AggregateSnapshot, WorkspaceSnapshot } from "../contracts/ledger.js";
import type { ArtifactPort } from "../contracts/artifact.js";
import type { PlanRevisionSnapshot } from "../contracts/plan.js";
import type { RunSnapshot } from "../contracts/dispatch.js";
import type {
  ReviewContextPort,
  ReviewContextRejectionCode,
  ReviewContextRequestV1,
  ReviewContextResultV1,
  ReviewPacketV1,
} from "../contracts/review-context.js";
import { REVIEW_PACKET_MAX_BYTES, REVIEW_PACKET_MAX_MATERIALS } from "../contracts/review-context.js";
import type { SourceRefV1 } from "../contracts/dispatch.js";
import { canonicalJson } from "../contracts/fingerprint.js";
import { validateRoleBindingRef, validateTaskBudget } from "../contracts/validation.js";

export type ReviewContextCompilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  now: () => string;
};

export class ReviewContextCompilerImpl implements ReviewContextPort {
  constructor(private readonly deps: ReviewContextCompilerDeps) {}

  async assemble(request: ReviewContextRequestV1): Promise<ReviewContextResultV1> {
    // 1) Structural validation.
    if (!isRecord(request) || request.schemaVersion !== 1) {
      return reject("invalid_request", "request must be a ReviewContextRequestV1 (schemaVersion 1)");
    }
    const missing = (
      [
        "requestId",
        "projectId",
        "workspaceId",
        "goalId",
        "taskId",
        "submittedAt",
      ] as const
    ).filter((key) => typeof request[key] !== "string" || request[key].length === 0);
    if (missing.length > 0 || !request.planRef || !request.runRef || !request.attemptRef) {
      return reject("invalid_request", "missing required request fields");
    }
    const bindingIssues: import("../contracts/validation.js").ValidationIssue[] = [];
    validateRoleBindingRef(request.roleBinding, "roleBinding", bindingIssues);
    const budgetIssues: import("../contracts/validation.js").ValidationIssue[] = [];
    validateTaskBudget(request.budget, "budget", budgetIssues);
    if (bindingIssues.length > 0) {
      return reject("stale_binding", "roleBinding is not a consistent versioned reference");
    }
    if (budgetIssues.length > 0) {
      return reject("invalid_request", "budget is malformed");
    }

    // 2) Goal + exact active pin.
    const goalRef = { aggregateType: "Goal" as const, projectId: request.projectId, goalId: request.goalId };
    const goalResult = await this.deps.ledger.load(goalRef);
    if (goalResult.status === "not_found") {
      return {
        status: "needs_material",
        gaps: [{ kind: "required-material", refId: goalRef.goalId, message: "goal not found" }],
        selectedRefs: [],
      };
    }
    const goal = goalResult.snapshot as {
      activePlanRevision: PlanRevisionSnapshot["ref"] | null;
    };
    if (
      goal.activePlanRevision === null ||
      canonicalJson(goal.activePlanRevision) !== canonicalJson(request.planRef)
    ) {
      return reject("out_of_scope", "request pin is not the goal's current active PlanRevision (old pin / wrong scope)");
    }

    // 3) Plan + Workspace canonical revisions.
    const planResult = await this.deps.ledger.load(request.planRef);
    if (planResult.status === "not_found" || !isPlanRevisionSnapshot(planResult.snapshot)) {
      return {
        status: "needs_material",
        gaps: [{ kind: "plan-revision", refId: request.planRef.planId, message: "accepted PlanRevision not found" }],
        selectedRefs: [],
      };
    }
    const plan = planResult.snapshot as PlanRevisionSnapshot;
    const task = plan.tasks.find((t) => t.taskId === request.taskId);
    if (task === undefined) {
      return reject("out_of_scope", "task is not part of the pinned PlanRevision");
    }
    const workspaceRef = { aggregateType: "Workspace" as const, projectId: request.projectId, workspaceId: request.workspaceId };
    const wsResult = await this.deps.ledger.load(workspaceRef);
    if (wsResult.status === "not_found" || !isWorkspaceSnapshot(wsResult.snapshot)) {
      return {
        status: "needs_material",
        gaps: [{ kind: "workspace-snapshot", refId: request.workspaceId, message: "Workspace not found" }],
        selectedRefs: [],
      };
    }
    const workspaceRevision = (wsResult.snapshot as WorkspaceSnapshot).revision;
    if (request.workspaceSnapshot.revision !== workspaceRevision) {
      return reject("stale_workspace_snapshot", "workspace snapshot revision is not canonical");
    }

    // 4) Scope within declared permissions.
    const forbidden: string[] = [];
    for (const tool of request.scope.tools) {
      if (!request.declaredPermissions.tools.includes(tool)) forbidden.push("tool '" + tool + "' not declared");
    }
    for (const scope of request.scope.writeScope) {
      if (!request.declaredPermissions.writeScope.includes(scope)) forbidden.push("writeScope '" + scope + "' not declared");
    }
    if (request.roleBinding.policyRevision.length === 0) forbidden.push("roleBinding.policyRevision must be non-empty");
    if (forbidden.length > 0) return reject("forbidden_tool_or_scope", forbidden.join("; "));

    // 5) Semantic change required for a ReviewPacket.
    if (request.semanticChange === "none") {
      return reject("not_semantic_change", "no semantic change -> explicit fast path, not a review packet");
    }

    // 6) Budget.
    const now = this.deps.now();
    if (!(request.budget.tokenBudget > 0) || (request.budget.deadline !== null && request.budget.deadline < now)) {
      return reject("budget_exhausted", "tokenBudget must be positive and deadline must not have passed");
    }

    // 7) Bounded ReviewPacket.
    const selected: SourceRefV1[] = [
      { kind: "plan-revision", refId: plan.ref.planId, revision: String(plan.planRevision) },
      { kind: "workspace", refId: request.workspaceId, revision: String(workspaceRevision) },
    ];
    const obligations = plan.obligations
      .filter((o) => o.taskIds.includes(request.taskId))
      .map((o) => ({
        obligationId: o.obligationId,
        title: o.title,
        verificationRequirements: o.verificationRequirements.map((vr) => ({
          requirementId: vr.requirementId,
          requirementLevel: vr.requirementLevel,
          kind: vr.kind,
          description: vr.description,
        })),
      }));
    const materials: ReviewPacketV1["materials"] = [];
    const runLoad = await this.deps.ledger.load(request.runRef);
    const runSnapshot = runLoad.status === "found" && isRunSnapshot(runLoad.snapshot) ? runLoad.snapshot : null;
    if (runSnapshot !== null && runSnapshot.envelope !== null) {
      materials.push({
        sourceRef: { kind: "artifact", refId: runSnapshot.envelope.bundleRef.digest, revision: "1" },
        summary: "task context bundle (bounded; artifact reference)",
        artifactRef: runSnapshot.envelope.bundleRef,
      });
    } else {
      return reject("material_unavailable", "the review run has no bounded context bundle to reference");
    }
    if (materials.length > REVIEW_PACKET_MAX_MATERIALS) {
      return reject("exceeds_size_cap", "material count exceeds REVIEW_PACKET_MAX_MATERIALS");
    }
    const summaryBytes = materials.reduce((acc, m) => acc + Buffer.byteLength(m.summary, "utf8"), 0);
    if (summaryBytes > REVIEW_PACKET_MAX_MATERIALS * 4096) {
      return reject("exceeds_size_cap", "material summaries exceed the bounded budget");
    }
    const packet: ReviewPacketV1 = {
      schemaVersion: 1,
      packetId: "pkt-" + request.requestId,
      projectId: request.projectId,
      goalId: request.goalId,
      taskId: request.taskId,
      planRef: { ...request.planRef },
      planRevision: plan.planRevision,
      pinnedCompletionPolicy: { ...plan.effectiveCompletionPolicy },
      pinnedArchitectureBaseline: { ...plan.effectiveArchitectureBaseline },
      changeScope: { ...request.changeScope, changedFiles: [...request.changeScope.changedFiles] },
      semanticChange: request.semanticChange,
      risks: request.risks.map((risk) => ({ ...risk })),
      rubric: {
        contractPoints: request.contractPoints.map((p) => ({ ...p })),
        obligations,
      },
      materials,
      budget: { ...request.budget },
      total: { materialCount: materials.length, summaryBytes, noFullTranscript: true },
    };
    const packetBytes = Buffer.byteLength(canonicalJson(packet), "utf8");
    if (packetBytes > REVIEW_PACKET_MAX_BYTES) {
      return reject("exceeds_size_cap", "ReviewPacket canonical size " + packetBytes + " exceeds " + REVIEW_PACKET_MAX_BYTES);
    }

    // 8) Body-first.
    const body = canonicalJson({
      schemaVersion: 1,
      packetId: packet.packetId,
      packet,
      note: "bounded review bundle — no full transcript",
    });
    const putResult = await this.deps.vault.put({
      contentType: "application/json",
      body,
      sourceRefs: selected,
      ownerRef: request.runRef,
      requestedAt: now,
    });
    if (putResult.status === "rejected") {
      const code = putResult.code === "size_exceeded" ? "exceeds_size_cap" : "material_unavailable";
      return reject(code, putResult.issues.join("; "));
    }
    return {
      status: "ready",
      packet,
      bundleRef: putResult.ref,
      manifest: { schemaVersion: 1, selectedRefs: selected, gaps: [] },
    };
  }
}

function reject(code: ReviewContextRejectionCode, message: string): ReviewContextResultV1 {
  return { status: "rejected", code, issues: [message] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlanRevisionSnapshot(snapshot: AggregateSnapshot): snapshot is PlanRevisionSnapshot {
  return snapshot.ref.aggregateType === "PlanRevision";
}

function isWorkspaceSnapshot(snapshot: AggregateSnapshot): snapshot is WorkspaceSnapshot {
  return snapshot.ref.aggregateType === "Workspace";
}

function isRunSnapshot(snapshot: AggregateSnapshot): snapshot is RunSnapshot {
  return snapshot.ref.aggregateType === "Run";
}

export function createReviewContextCompiler(deps: ReviewContextCompilerDeps): ReviewContextCompilerImpl {
  return new ReviewContextCompilerImpl(deps);
}
