/**
 * ArchitectureReconciler.InspectionPort and VerificationEngine.CodeGraphPort.
 * These versioned contracts are consumed by architecture inspection and evolution.
 *
 * Authority: dev_docs/modules/control/architecture-reconciler.md (唯一 baseline
 * 输入 = PlanRevision pin；不读 Project active ref、不内置 baseline) +
 * dev_docs/modules/control/verification-engine.md (CodeGraph 与目标化 Reviewer
 * seams)。
 *
 * Semantics:
 *   - inspect(intent) resolves the EXACT pinned baseline (invariant #11/#12):
 *     plan pin missing / dangling / digest mismatch -> fail_closed with
 *     diagnostics, NO pseudo Delta/Finding. It never mutates the baseline,
 *     never moves active refs, never creates remediation/gate/activation
 *     side effects (architecture evolution).
 *   - The raw Delta is produced by the deterministic
 *     computeArchitectureDelta pure function (same inputs -> same Delta).
 *   - A REPORT-source inspection (no code change / no test failure) records
 *     finding candidates without fabricating a raw Delta; the reconciler
 *     records findings through the versioned ControlEngine commands.
 *   - codeGraph(query) exposes the graph capability view of a workspace
 *     revision: sourced / unsupported / stale / rejected — the reconciler
 *     fails closed on unsupported/stale.
 */
import type {
  ArchitectureInspectionIntentV1,
  ArchitectureInspectionOutcome,
  ArchitectureFindingV1,
  ArchitectureDecisionBriefV1,
  ArchitectureCandidateProposalV1,
} from "./architecture-inspection.js";

export type InspectResultV1 =
  | { status: "recorded"; outcome: ArchitectureInspectionOutcome }
  | { status: "fail_closed"; code: "baseline_unresolved" | "baseline_digest_mismatch" | "plan_pin_missing" | "workspace_unavailable" | "reported_only" | "recording_rejected"; diagnostics: string[] };

export interface InspectionPort {
  /**
   * Deterministic reconcile of ONE workspace revision against the plan-pinned
   * baseline. NEVER writes baseline/active refs; records findings + briefs +
   * candidate proposals through ControlEngine commands.
   */
  inspect(intent: ArchitectureInspectionIntentV1): Promise<InspectResultV1>;
}

export type CodeGraphQueryV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  workspaceRevision: number;
  planRef: import("./plan.js").PlanRevisionRef;
  baselinePin: import("./governance.js").ArchitectureBaselinePin;
  requesterRunRef?: import('./dispatch.js').RunRef;
};

export type CodeGraphResultV1 =
  | { status: "supported"; snapshotRef: import("./artifact.js").ArtifactRef; capabilityNote: string }
  | { status: "unsupported"; message: string }
  | { status: "stale"; expectedRevision: number; observedRevision: number; message: string }
  | { status: "rejected"; code: "invalid_request" | "scope_forbidden" | "unavailable"; issues: string[] };

export interface CodeGraphPort {
  /** Graph capability seam of VerificationEngine. Persistent test hosts may
   * use a deterministic registry adapter; product composition injects a
   * source-backed implementation for the requested workspace revision. */
  codeGraph(query: CodeGraphQueryV1): Promise<CodeGraphResultV1>;
}

export type { ArchitectureFindingV1, ArchitectureDecisionBriefV1, ArchitectureCandidateProposalV1 };
