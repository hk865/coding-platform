/**
 * Goal View Interface + ReadModelIndex Interface (Goal create slice, P1-00).
 * Authority: dev_docs/interfaces/goal-view.md + modules/data/read-model-index.md.
 */
import type { CommitCursor } from "./command-event.js";
import type { EventPage } from "./ledger.js";

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
  activePlanRevision: null;
  aggregateRevision: 1;
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
 */
export type ProjectionStallReason =
  | "cursor_gap"
  | "out_of_order"
  | "unknown_schema_version";

export class ProjectionStallError extends Error {
  readonly reason: ProjectionStallReason;
  readonly details: { expectedNextCursor?: CommitCursor; observedCursor: CommitCursor | null };

  constructor(
    reason: ProjectionStallReason,
    details: { expectedNextCursor?: CommitCursor; observedCursor: CommitCursor | null },
  ) {
    super(`projection stalled: ${reason}`);
    this.name = "ProjectionStallError";
    this.reason = reason;
    this.details = details;
  }
}

export interface ReadModelIndex {
  advance(page: EventPage): Promise<ProjectionReceipt>;
  goal(query: GoalViewQuery): Promise<GoalViewResult>;
}
