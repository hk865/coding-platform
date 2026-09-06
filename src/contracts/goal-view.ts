/**
 * Goal View Interface + ReadModelIndex Interface.
 * Authority: dev_docs/interfaces/goal-view.md + modules/data/read-model-index.md.
 * P1-02 versioned extension (recorded in the interface doc):
 *  - GoalView.activePlanRevision becomes PlanRevisionRef | null (GoalCreated@1
 *    still projects null; PlanRevisionAccepted refreshes the row);
 *  - ProjectionStallReason adds "unsupported_event_type" (a known v1 event
 *    type with no projection handler must stop the page, never skip);
 *  - ReadModelIndex adds planGraph / taskDetail queries (Plan/Task View
 *    contracts in ./plan-view.js) with the same opaque-cursor freshness.
 */
import type { CommitCursor } from "./command-event.js";
import type { EventPage } from "./ledger.js";
import type { PlanRevisionRef } from "./plan.js";
import type { ActiveAgentQuery, ActiveAgentViewResult } from "./active-agent.js";
import type {
  GoalStatusQuery,
  GoalStatusViewResult,
  GoalTimelineQuery,
  GoalTimelineViewResult,
} from "./goal-phase-view.js";
import type {
  PlanGraphViewQuery,
  PlanGraphViewResult,
  TaskDetailViewQuery,
  TaskDetailViewResult,
} from "./plan-view.js";

export type GoalViewQuery = {
  projectId: string;
  workspaceId: string;
  goalId: string;
  atLeastCursor?: CommitCursor;
};

export type GoalView = {
  goalId: string;
  projectId: string;
  workspaceId: string;
  objective: string;
  desiredState: "active";
  activePlanRevision: PlanRevisionRef | null;
  aggregateRevision: number;
  sourceCursor: CommitCursor;
};

export type GoalViewResult =
  | { status: "ready"; goal: GoalView; observedCursor: CommitCursor }
  | {
      status: "not_ready";
      requiredCursor: CommitCursor;
      observedCursor: CommitCursor | null;
    }
  | { status: "not_found"; observedCursor: CommitCursor | null };

export type ProjectionReceipt = {
  throughCursor: CommitCursor | null;
  appliedEventIds: string[];
};

/**
 * Projection stall reasons — ReadModelIndex must stop and report (throw a
 * typed ProjectionStallError) instead of silently skipping.
 * P1-02 adds "unsupported_event_type": a KNOWN v1 event type that this
 * projection has no handler for yet is still a hard stall (never skip).
 */
export type ProjectionStallReason =
  | "cursor_gap"
  | "out_of_order"
  | "unknown_schema_version"
  | "unsupported_event_type";

export class ProjectionStallError extends Error {
  readonly reason: ProjectionStallReason;
  readonly details: { expectedNextCursor?: CommitCursor; observedCursor: CommitCursor | null };

  constructor(
    reason: ProjectionStallReason,
    details: { expectedNextCursor?: CommitCursor; observedCursor: CommitCursor | null },
  ) {
    super("projection stalled: " + reason);
    this.name = "ProjectionStallError";
    this.reason = reason;
    this.details = details;
  }
}

export interface ReadModelIndex {
  advance(page: EventPage): Promise<ProjectionReceipt>;
  goal(query: GoalViewQuery): Promise<GoalViewResult>;
  /** P1-02: Plan Graph view for an accepted PlanRevision (per (projectId, goalId)). */
  planGraph(query: PlanGraphViewQuery): Promise<PlanGraphViewResult>;
  /** P1-02: Task Detail view (per (projectId, goalId, taskId)). */
  taskDetail(query: TaskDetailViewQuery): Promise<TaskDetailViewResult>;
  /** P1-03: active agent (lease/attempt/run/budget/status) per (projectId, goalId, taskId). */
  activeAgent(query: ActiveAgentQuery): Promise<ActiveAgentViewResult>;
  /** P1-05: goal phase status projection per (projectId, goalId). */
  goalStatus(query: GoalStatusQuery): Promise<GoalStatusViewResult>;
  /** P1-05: goal phase timeline projection per (projectId, goalId). */
  goalTimeline(query: GoalTimelineQuery): Promise<GoalTimelineViewResult>;
  /** P1-06: handoff provenance timeline per (projectId, goalId, taskId) — display only. */
  handoffProvenance(query: import("./handoff-view.js").HandoffProvenanceViewQuery): Promise<import("./handoff-view.js").HandoffProvenanceViewResult>;
  /** P1-07: workspace lease status view per (projectId, workspaceId) — display only. */
  workspaceLeaseView(query: import("./workspace-views.js").WorkspaceLeaseViewQuery): Promise<import("./workspace-views.js").WorkspaceLeaseViewResult>;
  /** P1-07: integration join/conflict view per (projectId, goalId, taskId) — display only, no judgement. */
  integrationConflicts(query: import("./workspace-views.js").IntegrationConflictViewQuery): Promise<import("./workspace-views.js").IntegrationConflictViewResult>;
  /** P1-07: workspace patch view per (projectId, workspaceId) — display only. */
  workspacePatches(query: import("./workspace-views.js").WorkspacePatchViewQuery): Promise<import("./workspace-views.js").WorkspacePatchViewResult>;
  /** P1-08: portfolio of bootstrapped Project/Workspace scopes (P1-00 manifest projection). */
  consolePortfolio(query: import("./console-views.js").PortfolioViewQuery): Promise<import("./console-views.js").PortfolioViewResult>;
  /** P1-08: workspace-level summary per full-scope key (projectId, workspaceId). */
  consoleSummary(query: import("./console-views.js").WorkspaceSummaryViewQuery): Promise<import("./console-views.js").WorkspaceSummaryViewResult>;
  /** P1-08: plan matrix per (projectId, workspaceId, goalId) — planned vs formal phase separated. */
  consolePlanMatrix(query: import("./console-views.js").PlanMatrixViewQuery): Promise<import("./console-views.js").PlanMatrixViewResult>;
  /** P1-08: workspace-scoped active agent/run rows (optional goalId filter). */
  consoleActiveAgents(query: import("./console-views.js").ActiveAgentsViewQuery): Promise<import("./console-views.js").ActiveAgentsViewResult>;
  /** P1-08: task evidence detail per (projectId, workspaceId, goalId, taskId) — refs only, no vault body. */
  consoleTaskEvidence(query: import("./console-views.js").TaskEvidenceViewQuery): Promise<import("./console-views.js").TaskEvidenceViewResult>;
  /** P1-08: workspace-level bounded timeline (optional goalId filter; display only). */
  consoleTimeline(query: import("./console-views.js").TimelineViewQuery): Promise<import("./console-views.js").TimelineViewResult>;
}
