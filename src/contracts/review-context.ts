/**
 * P1-04 Review Context contracts — ContextCompiler.ReviewContextPort (FROZEN,
 * this ticket is its first real consumer) + the bounded ReviewPacket.
 *
 * Authority:
 *   - dev_docs/modules/data/context-compiler.md (versioned extension of the
 *     P1-03 TaskContextPort; the frozen assemble(TaskContextRequestV1) is NOT
 *     touched)
 *   - dev_docs/interfaces/runtime-collaboration.md (bounded review Context,
 *     body-first in ArtifactVault, reviewer work is a formal dispatch Run)
 *   - dev_docs/planning/proposed/P1-foundation/tickets/04-evidence-satisfies-task.md
 *   - IMPLEMENTATION-HANDOFF.md "P1-04 契约与存储语义（冻结）"
 *
 * FROZEN semantics:
 *   - assemble is a bounded, read-only material assembly: it verifies the
 *     exact pins + workspace snapshot + declared scope, then builds a bounded
 *     ReviewPacket + stores the compact bundle body FIRST in the vault.
 *   - ReviewPacket is BOUNDED: REVIEW_PACKET_MAX_MATERIALS material entries,
 *     REVIEW_SUMMARY_MAX_BYTES per-material summary, REVIEW_PACKET_MAX_BYTES
 *     canonical JSON packet cap; never a full transcript (note field).
 *   - Overreach / stale pins / stale workspace / over budget / out of scope ->
 *     structured rejection, zero write (except the body-first vault.put, whose
 *     failure leaves only an un-adopted artifact).
 *   - This port NEVER starts a Reviewer/Agent; review WORK is a formal
 *     dispatch Run (P1-03 FakeRuntime path) whose verdict arrives as a
 *     kind=verdict evidence through Control.
 */
import type { PlanRevisionRef } from "./plan.js";
import type { ArtifactRef } from "./artifact.js";
import type { RunRef, RoleBindingRefV1, SourceRefV1, TaskAttemptRef, TaskBudgetV1 } from "./dispatch.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "./governance.js";
import type { MaterialGapV1 } from "./task-envelope.js";
import type { ChangeScopeV1, RiskV1, SemanticChangeClassification } from "./verification.js";

export const REVIEW_PACKET_MAX_MATERIALS = 8;
export const REVIEW_SUMMARY_MAX_BYTES = 4096;
export const REVIEW_PACKET_MAX_BYTES = 32 * 1024;

export type ReviewContextRequestV1 = {
  schemaVersion: 1;
  requestId: string;
  projectId: string;
  workspaceId: string;
  goalId: string;
  taskId: string;
  planRef: PlanRevisionRef;
  /** The REVIEW run (a formal dispatch Run). */
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  roleBinding: RoleBindingRefV1;
  /** The binding's declared allowlist (from the durable dispatch intent). */
  declaredPermissions: { tools: string[]; writeScope: string[] };
  /** Requested tools/writeScope; MUST be a subset of declaredPermissions. */
  scope: { tools: string[]; writeScope: string[] };
  /** Must equal the canonical Workspace revision, else stale_workspace_snapshot. */
  workspaceSnapshot: { workspaceId: string; revision: number };
  changeScope: ChangeScopeV1;
  semanticChange: SemanticChangeClassification;
  risks: RiskV1[];
  /** Review rubric contract points (bounded; compact extracts only). */
  contractPoints: { refId: string; point: string }[];
  budget: TaskBudgetV1;
  submittedAt: string;
};

export type ReviewContextRejectionCode =
  | "invalid_request"
  | "stale_binding"
  | "forbidden_tool_or_scope"
  | "budget_exhausted"
  | "exceeds_size_cap"
  | "stale_workspace_snapshot"
  | "material_unavailable"
  | "not_semantic_change"
  | "out_of_scope";

export type ReviewPacketV1 = {
  schemaVersion: 1;
  packetId: string;
  projectId: string;
  goalId: string;
  taskId: string;
  planRef: PlanRevisionRef;
  planRevision: number;
  pinnedCompletionPolicy: CompletionPolicyPin;
  pinnedArchitectureBaseline: ArchitectureBaselinePin;
  changeScope: ChangeScopeV1;
  semanticChange: SemanticChangeClassification;
  risks: RiskV1[];
  rubric: {
    contractPoints: { refId: string; point: string }[];
    obligations: {
      obligationId: string;
      title: string;
      verificationRequirements: { requirementId: string; requirementLevel: string; kind: string; description: string }[];
    }[];
  };
  materials: {
    sourceRef: SourceRefV1;
    summary: string;
    artifactRef: ArtifactRef;
  }[];
  budget: TaskBudgetV1;
  total: {
    materialCount: number;
    summaryBytes: number;
    /** Bounded shape: NO full transcript. */
    noFullTranscript: true;
  };
};

export type ReviewManifestV1 = {
  schemaVersion: 1;
  selectedRefs: SourceRefV1[];
  gaps: MaterialGapV1[];
};

export type ReviewContextResultV1 =
  | {
      status: "ready";
      packet: ReviewPacketV1;
      /** Vault ref of the compact bundle body (stored BEFORE ready). */
      bundleRef: ArtifactRef;
      manifest: ReviewManifestV1;
    }
  | { status: "needs_material"; gaps: MaterialGapV1[]; selectedRefs: SourceRefV1[] }
  | { status: "rejected"; code: ReviewContextRejectionCode; issues: string[] };

/** ReviewContextPort — FROZEN (interfaces_to_freeze: ContextCompiler extension). */
export interface ReviewContextPort {
  assemble(request: ReviewContextRequestV1): Promise<ReviewContextResultV1>;
}
