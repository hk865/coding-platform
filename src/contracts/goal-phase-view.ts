/**
 * P1-05 ReadModel surface — goal phase / status view + timeline.
 * Authority: dev_docs/interfaces/goal-view.md (freshness semantics reused),
 * modules/data/read-model-index.md, ticket 05 output artifact
 * deterministic-goal-phase + goal-completion-explanation + goal-timeline-events.
 *
 * FROZEN semantics:
 *   - goalStatus and goalTimeline rebuild ONLY from committed GoalPhaseUpdated
 *     events. They are projections: the canonical GoalPhase snapshot lives in
 *     the ledger and is the ONLY writer surface (goal-reduction commit).
 *   - Freshness reuses the opaque CommitCursor semantics: not_ready !=
 *     not_found; not_found only after observedCursor covered atLeastCursor.
 *   - Full-scope key: (projectId, goalId). Local goalIds shared across
 *     Projects never collide.
 *   - ModuleProgress/StageProgress are projections of OTHER tickets; they are
 *     NEVER reducer inputs and NEVER fed back into this view (no projection
 *     loop — the goal phase is reduced from canonical facts only).
 */
import type { CommitCursor } from "./command-event.js";
import type { PlanRevisionRef } from "./plan.js";
import type {
  GoalCompletionExplanation,
  GoalPhase,
  GoalPhaseReasonCode,
  GoalSideEffectReconciliation,
} from "./goal-phase.js";

export type GoalStatusQuery = {
  projectId: string;
  goalId: string;
  atLeastCursor?: CommitCursor;
};

export type GoalStatusView = {
  projectId: string;
  goalId: string;
  phase: GoalPhase;
  previousPhase: GoalPhase | null;
  planRef: PlanRevisionRef | null;
  reasonCodes: GoalPhaseReasonCode[];
  explanation: GoalCompletionExplanation;
  sideEffectReconciliation: GoalSideEffectReconciliation;
  /** GoalPhase aggregate revision as projected (1..k per reduction). */
  aggregateRevision: number;
  /** last GoalPhaseUpdated event that changed this row. */
  sourceCursor: CommitCursor;
  updatedAt: string | null;
};

export type GoalStatusViewResult =
  | { status: "ready"; goal: GoalStatusView; observedCursor: CommitCursor }
  | {
      status: "not_ready";
      requiredCursor: CommitCursor;
      observedCursor: CommitCursor | null;
    }
  | { status: "not_found"; observedCursor: CommitCursor | null };

export type GoalTimelineEntry = {
  phase: GoalPhase;
  previousPhase: GoalPhase | null;
  reasonCodes: GoalPhaseReasonCode[];
  explanation: GoalCompletionExplanation;
  aggregateRevision: number;
  reducedAt: string;
  eventId: string;
  sourceCursor: CommitCursor;
};

export type GoalTimelineQuery = {
  projectId: string;
  goalId: string;
  atLeastCursor?: CommitCursor;
};

export type GoalTimelineViewResult =
  | {
      status: "ready";
      timeline: GoalTimelineEntry[];
      observedCursor: CommitCursor;
    }
  | {
      status: "not_ready";
      requiredCursor: CommitCursor;
      observedCursor: CommitCursor | null;
    }
  | { status: "not_found"; observedCursor: CommitCursor | null };
