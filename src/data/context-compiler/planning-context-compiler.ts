/**
 * Compile bounded planning material without starting a model.
 * Validate the request and delegate TaskContext assembly and permission checks to
 * the task compiler. Preserve manifest provenance and needs_material; map rejection
 * codes to the planning protocol. The result is material for proposal construction.
 */
import type { PlanningContextPort, PlanningContextRequest, PlanningContextResult, PlanningContextRejectionCode } from "../../contracts/planning.js";
import type { StateLedger, WorkspaceSnapshot } from "../../contracts/ledger.js";
import type { ArtifactPort } from "../../contracts/artifact.js";
import type { TaskContextPort, TaskContextRequestV1 } from "../../contracts/task-envelope.js";

import type { ReadModelIndex } from "../../contracts/goal-view.js";

export type PlanningContextCompilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  contextCompiler: TaskContextPort;
  readModel: ReadModelIndex;
  now: () => string;
};

/** Task-context adaptation with planning-specific material gaps and size limits. */
export class PlanningContextCompilerImpl implements PlanningContextPort {
  private readonly deps: PlanningContextCompilerDeps;
  constructor(deps: PlanningContextCompilerDeps) {
    this.deps = deps;
  }

  async assemblePlanningContext(request: PlanningContextRequest): Promise<PlanningContextResult> {
    // 1) Structural validation (zero-write).
    if (
      request.schemaVersion !== 1 ||
      typeof request.requestId !== "string" ||
      request.requestId.length === 0 ||
      typeof request.budget?.maxBundleBytes !== "number" ||
      request.budget.maxBundleBytes <= 0
    ) {
      return {
        status: "rejected",
        code: "invalid_request",
        message: "schemaVersion must be 1, requestId is required and budget.maxBundleBytes must be > 0",
      };
    }

    // A planning context needs a concrete plan revision; absent -> material gap.
    if (request.planRef === null) {
      return { status: "needs_material", gaps: ["plan_ref_missing"] };
    }
    const planRef = request.planRef;

    // Read-only probe of the canonical workspace revision so the delegate's
    // stale_workspace_snapshot check passes for a KNOWN workspace. When the
    // workspace is unknown we pass revision 0: the delegate rejects it at the
    // contract boundary (workspaceSnapshot.revision must be >= 1) and the
    // "unavailable"/"invalid_request" maps into the allowed rejected set.
    const wsResult = await this.deps.ledger.load({
      aggregateType: "Workspace",
      projectId: request.projectId,
      workspaceId: request.workspaceId,
    });
    const canonicalWsRevision =
      wsResult.status === "found" && isWorkspaceSnapshot(wsResult.snapshot)
        ? wsResult.snapshot.revision
        : 0;

    const now = this.deps.now();
    const goalId = request.goalRef.goalId;
    const runId = "planning-context-" + request.requestId;
    const taskId = "planning-context";

    // Synthesized bounded TaskContextRequestV1 (read-only planning task over the
    // SOURCE plan). No model, no canonical write.
    const taskRequest: TaskContextRequestV1 = {
      schemaVersion: 1,
      requestId: request.requestId,
      projectId: request.projectId,
      workspaceId: request.workspaceId,
      goalId,
      taskId,
      planRef,
      runRef: {
        aggregateType: "Run",
        projectId: request.projectId,
        goalId,
        runId,
      },
      attemptRef: {
        aggregateType: "TaskAttempt",
        projectId: request.projectId,
        goalId,
        taskId,
        attemptId: "attempt-" + runId,
      },
      roleBinding: {
        schemaVersion: 1,
        bindingId: "planning-context-binding",
        templateId: "planning-context-template",
        templateRevision: "1",
        bindingVersion: 1,
        policyRevision: "planning-context-policy@1",
      },
      workspaceSnapshot: {
        workspaceId: request.workspaceId,
        revision: canonicalWsRevision,
      },
      declaredPermissions: { tools: [], writeScope: [] },
      scope: { tools: [], writeScope: [] },
      budget: { tokenBudget: request.budget.maxBundleBytes, deadline: null },
      submittedAt: now,
    };

    const result = await this.deps.contextCompiler.assemble(taskRequest);

    if (result.status === "needs_material") {
      return {
        status: "needs_material",
        gaps: result.gaps.map((g) => `${g.kind}:${g.refId}`),
      };
    }
    if (result.status === "rejected") {
      return {
        status: "rejected",
        code: mapRejectionCode(result.code),
        message: result.issues.join("; "),
      };
    }

    // ready: the bundle is bounded by the delegate's envelope cap; enforce the
    // planning byte budget here (the delegate's token budget is not a byte cap).
    const totalBytes = result.bundleRef.sizeBytes;
    if (totalBytes > request.budget.maxBundleBytes) {
      return { status: "needs_material", gaps: ["budget_exhausted"] };
    }
    return {
      status: "ready",
      bundleRef: result.bundleRef,
      manifest: {
        selectedSources: result.manifest.selectedRefs.map((r) => r.refId),
        // ContextManifestV1 carries no opaque cursor (freshness is per-ref);
        // the planning manifest exposes a nullable cursor only.
        freshnessCursor: null,
        totalBytes,
      },
    };
  }
}

function isWorkspaceSnapshot(snapshot: unknown): snapshot is WorkspaceSnapshot {
  const s = snapshot as WorkspaceSnapshot;
  return s !== null && typeof s === "object" && s.ref?.aggregateType === "Workspace";
}

function mapRejectionCode(code: string): PlanningContextRejectionCode {
  if (code === "invalid_request") return "invalid_request";
  if (code === "forbidden_tool_or_scope") return "forbidden_tool_or_scope";
  // stale_binding / budget_exhausted / exceeds_size_cap / stale_workspace_snapshot /
  // material_unavailable -> the planning port only exposes "unavailable".
  return "unavailable";
}
