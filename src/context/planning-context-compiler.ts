/** P1-11 ContextCompiler entry: bounded planning-context assembly (never starts a model). */
import type { PlanningContextPort } from "../contracts/goal-change.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ArtifactPort } from "../contracts/artifact.js";
import type { TaskContextPort } from "../contracts/ports.js";
import type { ReadModelIndex } from "../contracts/goal-view.js";

export type PlanningContextCompilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  contextCompiler: TaskContextPort;
  readModel: ReadModelIndex;
  now: () => string;
};

/** LANE-B stub — real implementation lands in the P1-11 lane commit (ctor deps frozen). */
export class PlanningContextCompilerImpl implements PlanningContextPort {
  constructor(_deps: PlanningContextCompilerDeps) {}
  async assemblePlanningContext(request: { schemaVersion: 1; requestId: string; projectId: string; workspaceId: string; goalRef: import("../contracts/ledger.js").GoalRef; planRef: import("../contracts/plan.js").PlanRevisionRef | null; budget: { maxBundleBytes: number } }): Promise<
    | { status: "ready"; bundleRef: import("../contracts/artifact.js").ArtifactRef; manifest: { selectedSources: string[]; freshnessCursor: import("../contracts/command-event.js").CommitCursor | null; totalBytes: number } }
    | { status: "needs_material"; gaps: string[] }
    | { status: "rejected"; code: "invalid_request" | "forbidden_tool_or_scope" | "unavailable"; message: string }
  > {
    void request;
    throw new Error("P1-11 lane: PlanningContextCompilerImpl not implemented yet");
  }
}
