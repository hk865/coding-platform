/**
 * P1-06 Handoff Context contracts — ContextCompiler.HandoffContextPort (this
 * ticket is its first consumer; a versioned extension — the frozen
 * assemble(TaskContextRequestV1) signature is NOT touched).
 *
 * Authority:
 *   - dev_docs/modules/data/context-compiler.md (versioned extension)
 *   - dev_docs/interfaces/runtime-collaboration.md (bounded Context; body-first
 *     in ArtifactVault; stale/outdated material never silently reused)
 *   - dev_docs/planning/proposed/P1-foundation/tickets/06-handoff-a-to-b.md
 *   - IMPLEMENTATION-HANDOFF.md "P1-06 契约与存储语义（冻结）"
 *
 * Semantics:
 *   - assemble(request) yields B's bounded TaskEnvelope (SAME frozen
 *     TaskEnvelopeV1 shape — the dispatch/startRun/runtime path is unchanged)
 *     whose bundle is derived from the registered HandoffPacketSnapshot
 *     (objective/constraints/completed/unresolved/refs — NEVER a transcript)
 *     plus FRESH plan/workspace material.
 *   - source revision mismatch -> EXPLICIT stale_packet rejection (never
 *     silently reuses the old packet); the caller re-projects (records a fresh
 *     packet) and retries.
 *   - missing material -> needs_material (honest gaps); old binding /
 *     overreach / budget / size caps use the P1-03 rules (stale_binding is
 *     decided by Control.startRun against the durable intent, as in P1-03).
 *   - The bundle is body-first in the ArtifactVault; the packet body in the
 *     vault is the ARCHIVAL copy owned by A's run — B never opens it.
 */
import type { PlanRevisionRef } from "./plan.js";
import type { ArtifactRef } from "./artifact.js";
import type { RoleBindingRefV1, RunRef, SourceRefV1, TaskAttemptRef, TaskBudgetV1 } from "./dispatch.js";
import type { HandoffPacketRef } from "./handoff.js";
import type { MaterialGapV1, TaskEnvelopeV1 } from "./task-envelope.js";

export type HandoffContextRequestV1 = {
  schemaVersion: 1;
  requestId: string;
  projectId: string;
  workspaceId: string;
  goalId: string;
  taskId: string;
  planRef: PlanRevisionRef;
  /** B's run / attempt (the replacement lifecycle). */
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  roleBinding: RoleBindingRefV1;
  /** The binding's declared allowlist (from the durable dispatch intent). */
  declaredPermissions: { tools: string[]; writeScope: string[] };
  /** Requested tools/writeScope; MUST be a subset of declaredPermissions. */
  scope: { tools: string[]; writeScope: string[] };
  /** Must equal the canonical Workspace revision, else stale_workspace_snapshot. */
  workspaceSnapshot: { workspaceId: string; revision: number };
  /** The registered HandoffPacket the handoff context is projected from. */
  handoffPacketRef: HandoffPacketRef;
  budget: TaskBudgetV1;
  submittedAt: string;
};

export type HandoffContextRejectionCode =
  | "invalid_request"
  | "stale_binding"
  | "forbidden_tool_or_scope"
  | "budget_exhausted"
  | "exceeds_size_cap"
  | "stale_workspace_snapshot"
  | "material_unavailable"
  | "packet_not_found"
  | "stale_packet"
  | "packet_mismatch";

export type HandoffContextManifestV1 = {
  schemaVersion: 1;
  selectedRefs: SourceRefV1[];
  gaps: MaterialGapV1[];
  /** Packet facts the bundle was derived from (bounded; no transcript). */
  packetRef: HandoffPacketRef;
  packetTaskRevision: number;
  noFullTranscript: true;
  freshness: {
    workspaceSnapshot: { workspaceId: string; revision: number };
    planRef: PlanRevisionRef;
  };
};

export type HandoffContextResultV1 =
  | {
      status: "ready";
      /** B's envelope — SAME frozen TaskEnvelope shape (dispatch path unchanged). */
      envelope: TaskEnvelopeV1;
      /** Vault ref of the fresh bounded bundle (body-first; owner = B's run). */
      bundleRef: ArtifactRef;
      manifest: HandoffContextManifestV1;
    }
  | { status: "needs_material"; gaps: MaterialGapV1[]; selectedRefs: SourceRefV1[] }
  | { status: "rejected"; code: HandoffContextRejectionCode; issues: string[] };

/** HandoffContextPort — FROZEN (interfaces_to_freeze: ContextCompiler extension). */
export interface HandoffContextPort {
  assemble(request: HandoffContextRequestV1): Promise<HandoffContextResultV1>;
}
