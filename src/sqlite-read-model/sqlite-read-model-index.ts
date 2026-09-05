/**
 * SQLite ReadModelIndex adapter — P1-01 "Goal persisted and visible".
 *
 * ENTRY FILE (shared baseline, integrator, 2026-09-05). The exported surface
 * below is FROZEN for P1-01 lane B: lane B fills in the implementation inside
 * this directory and must NOT change the exported signatures/options.
 *
 * Driver decision: Node 24 built-in node:sqlite (DatabaseSync) — zero runtime
 * dependencies. Projection storage, checkpoint, dedupe and Goal index live in
 * one SQLite database file; the index is a rebuildable EVENT PROJECTION
 * (canonical Goal state comes from the StateLedger snapshots, never from here).
 *
 * P1-01 lane B depends only on interfaces/contracts — NOT on lane A's code.
 *
 * In-process semantics are a field-for-field mirror of the InMemory reference
 * (src/read-model/read-model-index.ts):
 *  - the WHOLE page is validated before anything is applied: cursor gap /
 *    out-of-order / unknown-version stall the entire page via ProjectionStallError
 *    (never partial, never skipped);
 *  - dedupe by eventId (replay never re-reports, never advances the base);
 *  - GoalCreated@1 projects one (projectId, workspaceId, goalId) full-key GoalView
 *    (identical local ids under different Projects are strictly isolated);
 *  - cursor checkpoint is persisted (observe across close()/reopen);
 *  - freshness: not_found only when observedCursor already covers atLeastCursor
 *    and there is no row; otherwise -> not_ready (incl. no atLeastCursor & no row);
 *  - sourceCursor records the last Event cursor that changed the row; view fields
 *    come only from the Event (the normalized objective is the event payload value).
 *
 * Persistence: checkpoint / appliedEventIds / Goal rows all live in SQLite; one
 * apply = one transaction (whole page; any error -> ROLLBACK, no partial write).
 * A fresh file/empty database replayed from the same EventPages reproduces the
 * same views field-for-field (incremental == rebuild).
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { EventPage } from "../contracts/ledger.js";
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
import type { CommitCursor, GoalCreatedEvent } from "../contracts/command-event.js";
import type { DomainEvent } from "../contracts/events.js";
import type { PositionedEvent } from "../contracts/ledger.js";
import {
  compareCommitCursor,
  makeCommitCursor,
  seqOfCommitCursor,
} from "../contracts/ledger.js";
import { validateDomainEvent } from "../contracts/validation.js";

export interface SqliteReadModelIndexOptions {
  /** ":memory:" (per-connection ephemeral) or a single SQLite file path. */
  path: string;
}

/**
 * Single-file schema for a rebuildable event projection. The Goal row key is
 * the FULL scope (project_id, workspace_id, goal_id) — there is deliberately
 * no unique index on workspace_id or goal_id alone, so identical local ids
 * reused under different Projects can never collide.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS read_model_checkpoint (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  cursor TEXT
);
CREATE TABLE IF NOT EXISTS applied_event (
  event_id TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS goal_view (
  project_id            TEXT NOT NULL,
  workspace_id          TEXT NOT NULL,
  goal_id               TEXT NOT NULL,
  objective             TEXT NOT NULL,
  desired_state         TEXT NOT NULL,
  active_plan_revision  INTEGER,
  aggregate_revision    INTEGER NOT NULL,
  source_cursor         TEXT NOT NULL,
  PRIMARY KEY (project_id, workspace_id, goal_id)
) WITHOUT ROWID;
`;

/** Row shape we read back for a GoalView. */
type GoalViewRow = {
  project_id: string;
  workspace_id: string;
  goal_id: string;
  objective: string;
  source_cursor: string;
};

export class SqliteReadModelIndex implements ReadModelIndex {
  private readonly db: DatabaseSync;
  private closed = false;

  /** The path this read model is backed by (":memory:" or the file path). */
  readonly dbPath: string;

  private readonly stmtSelectCheckpoint: StatementSync;
  private readonly stmtSelectApplied: StatementSync;
  private readonly stmtSelectGoal: StatementSync;
  private readonly stmtUpsertGoal: StatementSync;
  private readonly stmtInsertApplied: StatementSync;
  private readonly stmtUpsertCheckpoint: StatementSync;

  constructor(options: SqliteReadModelIndexOptions) {
    if (typeof options.path !== "string" || options.path.length === 0) {
      throw new Error("SqliteReadModelIndex: path must be a non-empty string");
    }
    this.dbPath = options.path;
    this.db = new DatabaseSync(options.path);
    this.db.exec(SCHEMA_SQL);

    this.stmtSelectCheckpoint = this.db.prepare(
      "SELECT cursor FROM read_model_checkpoint WHERE id = 1",
    );
    this.stmtSelectApplied = this.db.prepare(
      "SELECT 1 AS found FROM applied_event WHERE event_id = ?",
    );
    this.stmtSelectGoal = this.db.prepare(
      `SELECT project_id, workspace_id, goal_id, objective, source_cursor
         FROM goal_view
        WHERE project_id = ? AND workspace_id = ? AND goal_id = ?`,
    );
    this.stmtUpsertGoal = this.db.prepare(
      `INSERT INTO goal_view
         (project_id, workspace_id, goal_id, objective, desired_state,
          active_plan_revision, aggregate_revision, source_cursor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, workspace_id, goal_id) DO UPDATE SET
         objective            = excluded.objective,
         desired_state        = excluded.desired_state,
         active_plan_revision = excluded.active_plan_revision,
         aggregate_revision   = excluded.aggregate_revision,
         source_cursor        = excluded.source_cursor`,
    );
    this.stmtInsertApplied = this.db.prepare(
      "INSERT OR IGNORE INTO applied_event (event_id) VALUES (?)",
    );
    this.stmtUpsertCheckpoint = this.db.prepare(
      `INSERT INTO read_model_checkpoint (id, cursor) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor`,
    );
  }

  async advance(page: EventPage): Promise<ProjectionReceipt> {
    this.assertOpen();

    // Phase 1 — validate the WHOLE page before applying anything, so a gap /
    // out-of-order / unknown-version page is never partially applied.
    const observedCursor = this.readCheckpoint();
    const toApply: PositionedEvent[] = [];
    const appliedEventIds: string[] = [];

    let expectedNextSeq =
      observedCursor === null ? null : seqOfCommitCursor(observedCursor) + 1;

    for (const positioned of page.events) {
      const event: DomainEvent = positioned.event;

      this.ensureKnownEvent(event, observedCursor);

      // A known v1 event with NO projection handler must stall the WHOLE page
      // up front — nothing may be partially applied (baseline: P1-02 events
      // until the projection lands).
      if (!this.isHandledEventType(event.eventType)) {
        throw new ProjectionStallError("unsupported_event_type", { observedCursor });
      }

      // Dedupe: an already-applied eventId is skipped (idempotent replay) and
      // is not re-reported nor counted against cursor continuity.
      if (this.isApplied(event.eventId)) continue;

      const curSeq = seqOfCommitCursor(positioned.cursor);
      if (expectedNextSeq === null) {
        // First NEW event on an index with no prior state — anchor here.
        expectedNextSeq = curSeq;
      } else if (curSeq > expectedNextSeq) {
        throw new ProjectionStallError("cursor_gap", {
          expectedNextCursor: makeCommitCursor(expectedNextSeq),
          observedCursor,
        });
      } else if (curSeq < expectedNextSeq) {
        throw new ProjectionStallError("out_of_order", {
          expectedNextCursor: makeCommitCursor(expectedNextSeq),
          observedCursor,
        });
      }
      expectedNextSeq = curSeq + 1;
      toApply.push(positioned);
      appliedEventIds.push(event.eventId);
    }

    // Phase 2 — apply validated events in ONE transaction (whole page; any
    // error -> ROLLBACK, no partial write). Advancing the persisted checkpoint
    // to the last applied cursor makes the projection resumable after close().
    if (toApply.length > 0) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const positioned of toApply) {
          const event = positioned.event;
          if (event.eventType === "GoalCreated") {
            this.upsertGoalView(event, positioned.cursor);
          }
          // Known non-goal events (ProjectBootstrapped / WorkspaceBootstrapped)
          // only advance the cursor; they project no Goal View.
          this.stmtInsertApplied.run(event.eventId);
          this.stmtUpsertCheckpoint.run(positioned.cursor);
        }
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }

    return {
      throughCursor: page.throughCursor,
      appliedEventIds,
    };
  }

  async goal(query: GoalViewQuery): Promise<GoalViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.readGoalView(query.projectId, query.workspaceId, query.goalId);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
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

  /** Event types this projection currently has handlers for. */
  private isHandledEventType(eventType: string): boolean {
    return eventType === "GoalCreated" || eventType === "ProjectBootstrapped" || eventType === "WorkspaceBootstrapped";
  }

  async planGraph(query: PlanGraphViewQuery): Promise<PlanGraphViewResult> {
    this.assertOpen();
    void query;
    throw new Error("P1-02: planGraph not implemented yet");
  }

  async taskDetail(query: TaskDetailViewQuery): Promise<TaskDetailViewResult> {
    this.assertOpen();
    void query;
    throw new Error("P1-02: taskDetail not implemented yet");
  }

  /**
   * Adapter-specific disposal — NOT part of the ReadModelIndex interface.
   * Idempotent; a closed index rejects further use.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch {
      // already closed or closing — nothing left to do
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("SqliteReadModelIndex: read model is closed");
  }

  /** Last contiguous cursor successfully projected (null until any advance). */
  private readCheckpoint(): CommitCursor | null {
    const row = this.stmtSelectCheckpoint.get() as unknown as
      | { cursor: string }
      | undefined;
    return row ? (row.cursor as CommitCursor) : null;
  }

  /** Has this eventId already been applied (persisted dedupe)? */
  private isApplied(eventId: string): boolean {
    return this.stmtSelectApplied.get(eventId) !== undefined;
  }

  /** Freshness: has observedCursor already covered atLeastCursor? */
  private isCovered(observedCursor: CommitCursor | null, atLeastCursor: CommitCursor): boolean {
    return (
      observedCursor !== null &&
      compareCommitCursor(observedCursor, atLeastCursor) >= 0
    );
  }

  /** Stall on unknown schemaVersion / unknown eventType (never silently skip). */
  private ensureKnownEvent(event: DomainEvent, observedCursor: CommitCursor | null): void {
    const issues = validateDomainEvent(event);
    const stalled = issues.some(
      (issue) =>
        issue.code === "unknown_schema_version" || issue.code === "unknown_event_type",
    );
    if (stalled) {
      throw new ProjectionStallError("unknown_schema_version", { observedCursor });
    }
  }

  private readGoalView(
    projectId: string,
    workspaceId: string,
    goalId: string,
  ): GoalView | null {
    const row = this.stmtSelectGoal.get(
      projectId,
      workspaceId,
      goalId,
    ) as unknown as GoalViewRow | undefined;
    if (!row) return null;
    return {
      goalId: row.goal_id,
      projectId: row.project_id,
      workspaceId: row.workspace_id,
      objective: row.objective,
      desiredState: "active",
      activePlanRevision: null,
      aggregateRevision: 1,
      sourceCursor: row.source_cursor as CommitCursor,
    };
  }

  /** GoalCreated@1 -> one (projectId, workspaceId, goalId)-keyed GoalView. */
  private upsertGoalView(event: GoalCreatedEvent, cursor: CommitCursor): void {
    this.stmtUpsertGoal.run(
      event.projectId,
      event.workspaceId,
      event.aggregateId,
      event.payload.objective,
      event.payload.desiredState,
      event.payload.activePlanRevision,
      event.aggregateRevision,
      cursor,
    );
  }
}

export function createSqliteReadModelIndex(
  options: SqliteReadModelIndexOptions,
): SqliteReadModelIndex {
  return new SqliteReadModelIndex(options);
}
