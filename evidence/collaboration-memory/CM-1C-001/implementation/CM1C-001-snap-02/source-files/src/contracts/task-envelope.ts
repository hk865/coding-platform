/**
 * TaskEnvelope + TaskContextPort contracts (P1-03 first consumer freeze).
 * Authority: modules/data/context-compiler.md + runtime-collaboration.md +
 * agent/templates/short-lived-agent.md + ticket acceptance:
 *   - bounded envelope: binds WorkspaceSnapshot revision, permissions, budget,
 *     source refs; HARD size cap; contains NO full transcript;
 *   - the envelope references the accepted role template/binding versions via
 *     the minimal RoleBindingRefV1 (no full RoleBinding contract in P1-03);
 *   - body (bundle) is stored FIRST in the ArtifactVault; only after Control
 *     registers the envelope (run start) does the reference become queryable.
 */
import type { ArtifactRef } from "./artifact.js";
import type {
  RoleBindingRefV1,
  RunRef,
  SourceRefV1,
  TaskAttemptRef,
  TaskBudgetV1,
} from "./dispatch.js";
import type { PlanRevisionRef } from "./plan.js";

/** Hard envelope size cap: canonical JSON of the envelope (UTF-8 bytes). */
export const TASK_ENVELOPE_MAX_SIZE_BYTES = 64 * 1024;

export type TaskEnvelopeV1 = {
  work?: import('./reviewer-work.js').ReviewWorkBinding;
  reviewInput?: import('./reviewer-work.js').ReviewInputBinding;
  schemaVersion: 1;
  envelopeId: string;
  projectId: string;
  workspaceId: string;
  goalId: string;
  taskId: string;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  planRef: PlanRevisionRef;
  roleBinding: RoleBindingRefV1;
  /** Canonical Workspace revision bound at assemble time (verified == current). */
  workspaceSnapshot: { workspaceId: string; revision: number };
  permissions: { policyRevision: string; tools: string[]; writeScope: string[] };
  budget: TaskBudgetV1;
  /** Selected versioned sources (compact; NO transcript). */
  sourceRefs: SourceRefV1[];
  /** Vault ref of the bounded bundle body (assembled Context, no transcript). */
  bundleRef: ArtifactRef;
};

export type ContextManifestV1 = {
  schemaVersion: 1;
  selectedRefs: SourceRefV1[];
  /** Sources that were missing/truncated (honest gaps — never silently dropped). */
  gaps: MaterialGapV1[];
  freshness: { workspaceSnapshot: { workspaceId: string; revision: number }; planRef: PlanRevisionRef };
};

export type MaterialGapV1 = {
  kind: "plan-revision" | "workspace-snapshot" | "required-material";
  refId: string;
  message: string;
};

export type TaskContextRequestV1 = {
  schemaVersion: 1;
  requestId: string;
  projectId: string;
  workspaceId: string;
  goalId: string;
  taskId: string;
  planRef: PlanRevisionRef;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  roleBinding: RoleBindingRefV1;
  /** Must equal the canonical Workspace revision, else stale_workspace_snapshot. */
  workspaceSnapshot: { workspaceId: string; revision: number };
  /** The binding's declared allowlist (from the durable dispatch intent). */
  declaredPermissions: { tools: string[]; writeScope: string[] };
  /** Requested tools/writeScope; MUST be a subset of declaredPermissions. */
  scope: { tools: string[]; writeScope: string[] };
  budget: TaskBudgetV1;
  submittedAt: string;
};

export type TaskContextRejectionCode =
  | "invalid_request"
  | "stale_binding"
  | "forbidden_tool_or_scope"
  | "budget_exhausted"
  | "exceeds_size_cap"
  | "stale_workspace_snapshot"
  | "material_unavailable";

export type TaskContextResultV1 =
  | {
      status: "ready";
      envelope: TaskEnvelopeV1;
      manifest: ContextManifestV1;
      bundleRef: ArtifactRef;
    }
  | { status: "needs_material"; gaps: MaterialGapV1[]; selectedRefs: SourceRefV1[] }
  | { status: "rejected"; code: TaskContextRejectionCode; issues: string[] };

export interface TaskContextPort {
  assemble(request: TaskContextRequestV1): Promise<TaskContextResultV1>;
}
