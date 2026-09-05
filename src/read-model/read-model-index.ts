/**
 * ReadModelIndexImpl — Goal create slice projection (Lane C, P1-00).
 * Authority: dev_docs/interfaces/goal-view.md + modules/data/read-model-index.md.
 *
 * Hidden implementation: cursor checkpoint, event dedupe, the GoalCreated
 * projection into an in-memory (projectId, workspaceId, goalId)-keyed view
 * store, and the read-after-write freshness rules enforced by goal(). Catch-up
 * / rebuild is exercised by advancing sequential EventPage(s) from the
 * StateLedger.
 *
 * Invariants upheld (goal-view.md / read-model-index.md):
 *  - Goal View is a rebuildable projection; fields come only from Events.
 *  - Repeated events are idempotent (dedupe by eventId) and never re-reported.
 *  - Cursor gap / out-of-order / unknown schema version stall the whole page
 *    (no partial application) via a typed ProjectionStallError.
 *  - View key is the full (projectId, workspaceId, goalId) triple; local ids
 *    shared across Projects are never confused.
 *  - sourceCursor records the last Event that changed the row; global
 *    freshness is judged only by observedCursor.
 */
import type {
  GoalView,
  GoalViewQuery,
  GoalViewResult,
  ProjectionReceipt,
  ReadModelIndex,
} from "../contracts/goal-view.js";
import type {
  PlanGraphViewQuery,
  PlanGraphViewResult,
  TaskDetailViewQuery,
  TaskDetailViewResult,
} from "../contracts/plan-view.js";
import { ProjectionStallError } from "../contracts/goal-view.js";
import type { CommitCursor } from "../contracts/command-event.js";
import type { GoalCreatedEvent } from "../contracts/command-event.js";
import type { DomainEvent } from "../contracts/events.js";
import type { EventPage, PositionedEvent } from "../contracts/ledger.js";
import {
  compareCommitCursor,
  makeCommitCursor,
  seqOfCommitCursor,
} from "../contracts/ledger.js";
import { validateDomainEvent } from "../contracts/validation.js";

/** Full-scope view key: (projectId, workspaceId, goalId) — never a local id only. */
function goalKey(projectId: string, workspaceId: string, goalId: string): string {
  return projectId + "\u0000" + workspaceId + "\u0000" + goalId;
}

export class ReadModelIndexImpl implements ReadModelIndex {
  /** Last contiguous cursor successfully projected (null until any advance). */
  private observedCursor: CommitCursor | null = null;

  /** eventIds already applied (dedupe across replays / rebuild feeds). */
  private readonly appliedEventIds = new Set<string>();

  /** (projectId, workspaceId, goalId) -> latest projected GoalView. */
  private readonly rows = new Map<string, GoalView>();

  async advance(page: EventPage): Promise<ProjectionReceipt> {
    const toApply: PositionedEvent[] = [];
    const appliedEventIds: string[] = [];

    // Phase 1 — validate the WHOLE page before applying anything, so a gap /
    // out-of-order / unknown-version page is never partially applied.
    let expectedNextSeq =
      this.observedCursor === null ? null : seqOfCommitCursor(this.observedCursor) + 1;

    for (const positioned of page.events) {
      const event: DomainEvent = positioned.event;

      this.ensureKnownEvent(event);

      // A known v1 event with NO projection handler must stall the WHOLE page
      // up front — nothing may be partially applied (baseline: P1-02 events
      // until the projection lands).
      if (!this.isHandledEventType(event.eventType)) {
        throw new ProjectionStallError("unsupported_event_type", {
          observedCursor: this.observedCursor,
        });
      }

      // Dedupe: an already-applied eventId is skipped (idempotent replay) and
      // is not re-reported nor counted against cursor continuity.
      if (this.appliedEventIds.has(event.eventId)) continue;

      const curSeq = seqOfCommitCursor(positioned.cursor);
      if (expectedNextSeq === null) {
        // First NEW event on an index with no prior state — anchor here.
        expectedNextSeq = curSeq;
      } else if (curSeq > expectedNextSeq) {
        throw new ProjectionStallError("cursor_gap", {
          expectedNextCursor: makeCommitCursor(expectedNextSeq),
          observedCursor: this.observedCursor,
        });
      } else if (curSeq < expectedNextSeq) {
        throw new ProjectionStallError("out_of_order", {
          expectedNextCursor: makeCommitCursor(expectedNextSeq),
          observedCursor: this.observedCursor,
        });
      }
      expectedNextSeq = curSeq + 1;
      toApply.push(positioned);
      appliedEventIds.push(event.eventId);
    }

    // Phase 2 — apply validated events, advancing the cursor.
    for (const positioned of toApply) {
      const event = positioned.event;
      if (event.eventType === "GoalCreated") {
        this.applyGoalCreated(event, positioned.cursor);
      }
      // Known non-goal events (ProjectBootstrapped / WorkspaceBootstrapped)
      // only advance the cursor; they project no Goal View.
      this.appliedEventIds.add(event.eventId);
      this.observedCursor = positioned.cursor;
    }

    return {
      throughCursor: page.throughCursor,
      appliedEventIds,
    };
  }

  async goal(query: GoalViewQuery): Promise<GoalViewResult> {
    const observedCursor = this.observedCursor;
    const row = this.rows.get(goalKey(query.projectId, query.workspaceId, query.goalId));

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
        if (row) return { status: "ready", goal: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return {
        status: "not_ready",
        requiredCursor: query.atLeastCursor,
        observedCursor,
      };
    }

    // No atLeastCursor: show the row if present, else the freshness-safe
    // "not_ready". The contract forbids returning not_found here.
    if (row) return { status: "ready", goal: row, observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor,
    };
  }

  /** Freshness: has observedCursor already covered atLeastCursor? */
  private isCovered(atLeastCursor: CommitCursor): boolean {
    return (
      this.observedCursor !== null &&
      compareCommitCursor(this.observedCursor, atLeastCursor) >= 0
    );
  }

  /** Stall on unknown schemaVersion / unknown eventType (never silently skip). */
  private ensureKnownEvent(event: DomainEvent): void {
    const issues = validateDomainEvent(event);
    const stalled = issues.some(
      (issue) =>
        issue.code === "unknown_schema_version" || issue.code === "unknown_event_type",
    );
    if (stalled) {
      throw new ProjectionStallError("unknown_schema_version", {
        observedCursor: this.observedCursor,
      });
    }
  }

  /** GoalCreated@1 -> one (projectId, workspaceId, goalId)-keyed GoalView. */
  private applyGoalCreated(event: GoalCreatedEvent, cursor: CommitCursor): void {
    const row: GoalView = {
      goalId: event.aggregateId,
      projectId: event.projectId,
      workspaceId: event.workspaceId,
      objective: event.payload.objective,
      desiredState: "active",
      activePlanRevision: null,
      aggregateRevision: 1,
      sourceCursor: cursor,
    };
    // Upsert semantics: a later Event touching the same key refreshes the row
    // and sourceCursor. In v1 there is one creation Event per key.
    this.rows.set(goalKey(event.projectId, event.workspaceId, event.aggregateId), row);
  }

  /** Event types this projection currently has handlers for. */
  private isHandledEventType(eventType: string): boolean {
    return eventType === "GoalCreated" || eventType === "ProjectBootstrapped" || eventType === "WorkspaceBootstrapped";
  }

  async planGraph(query: PlanGraphViewQuery): Promise<PlanGraphViewResult> {
    void query;
    throw new Error("P1-02: planGraph not implemented yet");
  }

  async taskDetail(query: TaskDetailViewQuery): Promise<TaskDetailViewResult> {
    void query;
    throw new Error("P1-02: taskDetail not implemented yet");
  }
}

/** Factory matching the fixed lane-C entry point (no args yet). */
export function createReadModelIndex(): ReadModelIndex {
  return new ReadModelIndexImpl();
}
