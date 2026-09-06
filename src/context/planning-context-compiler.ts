/** P1-11 ContextCompiler entry: bounded planning-context assembly (never starts a model). */
import type { PlanningContextPort } from "../contracts/goal-change.js";

/** LANE-B stub — real implementation lands in the P1-11 lane commit. */
export class PlanningContextCompilerImpl implements PlanningContextPort {
  async assemblePlanningContext(request: { schemaVersion: 1; requestId: string; projectId: string; workspaceId: string; goalRef: import("../contracts/ledger.js").GoalRef; planRef: import("../contracts/plan.js").PlanRevisionRef | null; budget: { maxBundleBytes: number } }): Promise<
    | { status: "ready"; bundleRef: import("../contracts/artifact.js").ArtifactRef; manifest: { selectedSources: string[]; freshnessCursor: import("../contracts/command-event.js").CommitCursor | null; totalBytes: number } }
    | { status: "needs_material"; gaps: string[] }
    | { status: "rejected"; code: "invalid_request" | "forbidden_tool_or_scope" | "unavailable"; message: string }
  > {
    void request;
    throw new Error("P1-11 lane: PlanningContextCompilerImpl not implemented yet");
  }
}
