/**
 * Compile a bounded TaskEnvelope from canonical task, plan and workspace material.
 * Scope must fit declared permissions; budgets and workspace revisions are checked.
 * Control.startRun owns final role-binding/version admission. The bundle body is
 * stored before returning ready; missing material is explicit. Context assembly
 * neither starts an Agent nor grants permissions or satisfies formal obligations.
 */
import type { StateLedger, WorkspaceRef, WorkspaceSnapshot } from "../../contracts/ledger.js";
import type { ArtifactPort, ArtifactRef } from "../../contracts/artifact.js";
import type {
  ContextManifestV1,
  MaterialGapV1,
  TaskContextPort,
  TaskContextRejectionCode,
  TaskContextRequestV1,
  TaskContextResultV1,
  TaskEnvelopeV1,
} from "../../contracts/task-envelope.js";
import type { SourceRefV1 } from "../../contracts/dispatch.js";
import type { PlanRevisionSnapshot } from "../../contracts/plan.js";
import type { AggregateSnapshot } from "../../contracts/ledger.js";
import { canonicalJson } from "../../contracts/fingerprint.js";
import type { JsonValue } from "../../contracts/fingerprint.js";
import { issuesToErrorMessage } from '../../contracts/validation/common.js';
import { validateTaskContextRequest, validateTaskEnvelope } from '../../contracts/validation/dispatch.js';
import type { ValidationIssue } from '../../contracts/validation/common.js';

export type ContextCompilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  now: () => string;
};

export class ContextCompilerImpl implements TaskContextPort {
  constructor(private readonly deps: ContextCompilerDeps) {}

  async assemble(request: TaskContextRequestV1): Promise<TaskContextResultV1> {
    // 1) Structural validation (unknown schema / wrong field shapes).
    const requestIssues = validateTaskContextRequest(request);
    if (requestIssues.length > 0) {
      return rejectTask("invalid_request", requestIssues);
    }
    // validateTaskContextRequest does NOT check planRef/runRef/attemptRef — guard
    // them so a malformed runtime request never dereferences a missing ref.
    if (!request.planRef || !request.runRef || !request.attemptRef) {
      return {
        status: "rejected",
        code: "invalid_request",
        issues: ["planRef, runRef and attemptRef are required"],
      };
    }

    const workspaceRef: WorkspaceRef = {
      aggregateType: "Workspace",
      projectId: request.projectId,
      workspaceId: request.workspaceId,
    };
    const [wsResult, planResult] = await Promise.all([
      this.deps.ledger.load(workspaceRef),
      this.deps.ledger.load(request.planRef),
    ]);

    // 2) Material gaps: an accepted PlanRevision and/or Workspace is missing.
    const selected: SourceRefV1[] = [];
    const gaps: MaterialGapV1[] = [];
    let planSnap: PlanRevisionSnapshot | null = null;
    if (planResult.status === "found" && isPlanRevisionSnapshot(planResult.snapshot)) {
      planSnap = planResult.snapshot;
      selected.push({
        kind: "plan-revision",
        refId: request.planRef.planId,
        revision: String(planSnap.planRevision),
        digest: request.planRef.planId,
      });
    } else {
      gaps.push({
        kind: "plan-revision",
        refId: request.planRef.planId,
        message: "accepted PlanRevision not found in the ledger",
      });
    }
    let canonicalWsRevision: number | null = null;
    if (wsResult.status === "found" && isWorkspaceSnapshot(wsResult.snapshot)) {
      canonicalWsRevision = wsResult.snapshot.revision;
      selected.push({
        kind: "workspace",
        refId: request.workspaceId,
        revision: String(canonicalWsRevision),
      });
    } else {
      gaps.push({
        kind: "workspace-snapshot",
        refId: request.workspaceId,
        message: "Workspace not found in the ledger",
      });
    }
    if (gaps.length > 0) {
      return { status: "needs_material", gaps, selectedRefs: selected };
    }

    // 3) Workspace snapshot revision must equal the current canonical revision
    //    (canonical only moves forward, so this is a strict equality — zero-write).
    if (request.workspaceSnapshot.revision !== canonicalWsRevision) {
      return {
        status: "rejected",
        code: "stale_workspace_snapshot",
        issues: [
          `workspace snapshot revision ${request.workspaceSnapshot.revision} != canonical ${canonicalWsRevision}`,
        ],
      };
    }

    // 4) Forbidden tool/scope: request.scope must be a subset of the declared
    //    permissions allowlist (independently for tools and writeScope), and the
    //    binding must resolve an authorization policy revision.
    const forbiddenIssues: string[] = [];
    for (const tool of request.scope.tools) {
      if (!request.declaredPermissions.tools.includes(tool)) {
        forbiddenIssues.push(`tool '${tool}' is not within declaredPermissions.tools`);
      }
    }
    for (const scope of request.scope.writeScope) {
      if (!request.declaredPermissions.writeScope.includes(scope)) {
        forbiddenIssues.push(`writeScope '${scope}' is not within declaredPermissions.writeScope`);
      }
    }
    if (request.roleBinding.policyRevision.length === 0) {
      forbiddenIssues.push("roleBinding.policyRevision must be non-empty");
    }
    if (forbiddenIssues.length > 0) {
      return { status: "rejected", code: "forbidden_tool_or_scope", issues: forbiddenIssues };
    }

    // 5) Budget: positive token budget and an un-passed deadline.
    const now = this.deps.now();
    const deadline = request.budget.deadline;
    if (!(request.budget.tokenBudget > 0) || (deadline !== null && deadline < now)) {
      return {
        status: "rejected",
        code: "budget_exhausted",
        issues: ["tokenBudget must be positive and deadline must not have passed"],
      };
    }

    // 6) Assemble the bounded Bundle body. Task title + obligation SUMMARY come
    //    from the accepted plan snapshot — NEVER a full conversation/transcript.
    const plan = planSnap as PlanRevisionSnapshot;
    const runtimeTask = plan.tasks.find((t) => t.taskId === request.taskId);
    const title = runtimeTask ? runtimeTask.title : `<task ${request.taskId}>`;
    const obligations = plan.obligations
      .filter((o) => o.taskIds.includes(request.taskId))
      .map((o) => ({ obligationId: o.obligationId, title: o.title }));

    const permissions = {
      policyRevision: request.roleBinding.policyRevision,
      tools: [...request.scope.tools],
      writeScope: [...request.scope.writeScope],
    };
    const bundle = {
      schemaVersion: 1,
      workspaceId: request.workspaceId,
      runRef: { ...request.runRef },
      attemptRef: { ...request.attemptRef },
      dependencies: plan.executionDag.dependsOn.filter(edge => edge.taskId === request.taskId).map(edge => edge.dependsOnId),
      projectId: request.projectId,
      goalId: request.goalId,
      taskId: request.taskId,
      planRef: { ...request.planRef },
      workspaceSnapshot: { ...request.workspaceSnapshot },
      sources: selected,
      budget: { ...request.budget },
      permissions,
      roleBinding: { ...request.roleBinding },
      task: { title, obligations },
    };
    const body = canonicalJson(bundle as JsonValue);

    // Body-first: the bounded bundle goes into the vault BEFORE the envelope.
    const putResult = await this.deps.vault.put({
      contentType: "application/json",
      body,
      sourceRefs: selected,
      ownerRef: request.runRef,
      requestedAt: now,
    });
    if (putResult.status === "rejected") {
      const code = putResult.code === "size_exceeded" ? "exceeds_size_cap" : "material_unavailable";
      return { status: "rejected", code, issues: putResult.issues };
    }
    const bundleRef: ArtifactRef = putResult.ref;

    // 7) Build the bounded TaskEnvelope and enforce the HARD size cap.
    const envelope: TaskEnvelopeV1 = {
      schemaVersion: 1,
      envelopeId: "env-" + request.requestId,
      projectId: request.projectId,
      workspaceId: request.workspaceId,
      goalId: request.goalId,
      taskId: request.taskId,
      runRef: { ...request.runRef },
      attemptRef: { ...request.attemptRef },
      planRef: { ...request.planRef },
      roleBinding: { ...request.roleBinding },
      workspaceSnapshot: { ...request.workspaceSnapshot },
      permissions,
      budget: { ...request.budget },
      sourceRefs: selected,
      bundleRef,
    };

    const envelopeIssues = validateTaskEnvelope(envelope);
    if (envelopeIssues.length > 0) {
      const code = envelopeIssues.some((i) => i.code === "size_exceeded")
        ? "exceeds_size_cap"
        : "invalid_request";
      return {
        status: "rejected",
        code,
        issues: envelopeIssues.map((i) => issuesToErrorMessage([i])),
      };
    }

    const manifest: ContextManifestV1 = {
      schemaVersion: 1,
      selectedRefs: selected,
      gaps: [],
      freshness: {
        workspaceSnapshot: { ...request.workspaceSnapshot },
        planRef: { ...request.planRef },
      },
    };

    return { status: "ready", envelope, manifest, bundleRef };
  }
}

function rejectTask(
  code: TaskContextRejectionCode,
  issues: ValidationIssue[],
): TaskContextResultV1 {
  return {
    status: "rejected",
    code,
    issues: issues.map((i) => issuesToErrorMessage([i])),
  };
}

function isWorkspaceSnapshot(snapshot: AggregateSnapshot): snapshot is WorkspaceSnapshot {
  return snapshot.ref.aggregateType === "Workspace";
}

function isPlanRevisionSnapshot(snapshot: AggregateSnapshot): snapshot is PlanRevisionSnapshot {
  return snapshot.ref.aggregateType === "PlanRevision";
}
