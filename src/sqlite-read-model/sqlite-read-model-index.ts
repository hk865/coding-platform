/**
 * SQLite ReadModelIndex adapter — P1-01 "Goal persisted and visible" +
 * P1-02 Plan Graph / Task Detail projection.
 *
 * ENTRY FILE (shared baseline, integrator, 2026-09-05). The exported surface
 * below is FROZEN: the lane C implementation fills in the body and MUST NOT
 * change the exported signatures/options.
 *
 * Driver decision: Node 24 built-in node:sqlite (DatabaseSync) — zero runtime
 * dependencies. Projection storage, checkpoint, dedupe and all view indexes
 * live in one SQLite database file; the index is a rebuildable EVENT
 * PROJECTION (canonical Goal state comes from the StateLedger snapshots,
 * never from here).
 *
 * P1-01 lane B / P1-02 lane C depend only on interfaces/contracts — NOT on
 * the control/ledger lane code.
 *
 * In-process semantics are a field-for-field mirror of the InMemory reference
 * (src/read-model/read-model-index.ts):
 *  - the WHOLE page is validated before anything is applied: cursor gap /
 *    out-of-order / unknown-version stall the entire page via ProjectionStallError
 *    (never partial, never skipped);
 *  - a KNOWN v1 event with no projection handler stalls the whole page via
 *    ProjectionStallError(unsupported_event_type) (P1-02 handlers added here;
 *    the stall branch stays as a future defence);
 *  - dedupe by eventId (replay never re-reports, never advances the base);
 *  - GoalCreated@1 projects one (projectId, workspaceId, goalId) full-key
 *    GoalView; PlanRevisionAccepted refreshes that Goal row (activePlanRevision
 *    = snapshot.ref, aggregateRevision = payload.goalAggregateRevision) and
 *    projects the (projectId, goalId) PlanGraphView plus one (projectId,
 *    goalId, taskId) TaskDetailView per task (identical local ids under
 *    different Projects are strictly isolated);
 *  - cursor checkpoint is persisted (observe across close()/reopen);
 *  - freshness: not_found only when observedCursor already covers atLeastCursor
 *    and there is no row; otherwise -> not_ready (incl. no atLeastCursor & no
 *    row); identity mirrors goal();
 *  - sourceCursor records the last Event cursor that changed the row; view
 *    fields come only from the Event.
 *
 * Persistence: checkpoint / appliedEventIds / Goal rows / Plan Graph rows /
 * Task Detail rows all live in SQLite; one apply = one transaction (whole page;
 * any error -> ROLLBACK, no partial write). A fresh file/empty database
 * replayed from the same EventPages reproduces the same views field-for-field
 * (incremental == rebuild).
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
  PlanGraphView,
  PlanGraphViewQuery,
  PlanGraphViewResult,
  TaskDetailView,
  TaskDetailViewQuery,
  TaskDetailViewResult,
} from "../contracts/plan-view.js";
import type { ActiveAgentQuery, ActiveAgentViewResult } from "../contracts/active-agent.js";
import { ProjectionStallError } from "../contracts/goal-view.js";
import type { CommitCursor, GoalCreatedEvent } from "../contracts/command-event.js";
import type { DomainEvent } from "../contracts/events.js";
import type { PositionedEvent } from "../contracts/ledger.js";
import {
  compareCommitCursor,
  makeCommitCursor,
  seqOfCommitCursor,
} from "../contracts/ledger.js";
import type { PlanRevisionAcceptedEvent } from "../contracts/plan.js";
import { validateDomainEvent } from "../contracts/validation.js";

export interface SqliteReadModelIndexOptions {
  /** ":memory:" (per-connection ephemeral) or a single SQLite file path. */
  path: string;
}

/**
 * Single-file schema for a rebuildable event projection. Row keys are FULL
 * scope keys — there is deliberately no unique index on workspace_id, goal_id
 * or task_id alone, so identical local ids reused under different Projects can
 * never collide.
 *
 * active_plan_revision is TEXT (JSON-encoded PlanRevisionRef or NULL), not an
 * INTEGER, because it carries a PlanRevisionRef object after P1-02 acceptance.
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
  active_plan_revision  TEXT,
  aggregate_revision    INTEGER NOT NULL,
  source_cursor         TEXT NOT NULL,
  PRIMARY KEY (project_id, workspace_id, goal_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS plan_graph (
  project_id               TEXT NOT NULL,
  goal_id                  TEXT NOT NULL,
  plan_ref                 TEXT NOT NULL,
  plan_revision            INTEGER NOT NULL,
  accepted_at              TEXT NOT NULL,
  pinned_completion_policy TEXT NOT NULL,
  pinned_arch_baseline     TEXT NOT NULL,
  stages                   TEXT NOT NULL,
  tasks                    TEXT NOT NULL,
  task_hierarchy           TEXT NOT NULL,
  execution_dag            TEXT NOT NULL,
  source_cursor            TEXT NOT NULL,
  PRIMARY KEY (project_id, goal_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS task_detail (
  project_id        TEXT NOT NULL,
  goal_id           TEXT NOT NULL,
  task_id           TEXT NOT NULL,
  title             TEXT NOT NULL,
  stage_id          TEXT,
  requirement_level TEXT NOT NULL,
  task_kind         TEXT NOT NULL,
  disposition       TEXT NOT NULL,
  phase             TEXT NOT NULL,
  scope             TEXT NOT NULL,
  obligations       TEXT NOT NULL,
  source_cursor     TEXT NOT NULL,
  PRIMARY KEY (project_id, goal_id, task_id)
) WITHOUT ROWID;
`;

/** Row shape we read back for a GoalView. */
type GoalViewRow = {
  project_id: string;
  workspace_id: string;
  goal_id: string;
  objective: string;
  active_plan_revision: string | null;
  aggregate_revision: number;
  source_cursor: string;
};

/** Row shape we read back for a PlanGraphView (complex fields are JSON TEXT). */
type PlanGraphRow = {
  project_id: string;
  goal_id: string;
  plan_ref: string;
  plan_revision: number;
  accepted_at: string;
  pinned_completion_policy: string;
  pinned_arch_baseline: string;
  stages: string;
  tasks: string;
  task_hierarchy: string;
  execution_dag: string;
  source_cursor: string;
};

/** Row shape we read back for a TaskDetailView (complex fields are JSON TEXT). */
type TaskDetailRow = {
  project_id: string;
  goal_id: string;
  task_id: string;
  title: string;
  stage_id: string | null;
  requirement_level: string;
  task_kind: string;
  disposition: string;
  phase: string;
  scope: string;
  obligations: string;
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
  private readonly stmtUpdateGoalActive: StatementSync;
  private readonly stmtSelectPlanGraph: StatementSync;
  private readonly stmtUpsertPlanGraph: StatementSync;
  private readonly stmtSelectTaskDetail: StatementSync;
  private readonly stmtUpsertTaskDetail: StatementSync;
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
      `SELECT project_id, workspace_id, goal_id, objective,
              active_plan_revision, aggregate_revision, source_cursor
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
    this.stmtUpdateGoalActive = this.db.prepare(
      `UPDATE goal_view
          SET active_plan_revision = ?, aggregate_revision = ?, source_cursor = ?
        WHERE project_id = ? AND workspace_id = ? AND goal_id = ?`,
    );
    this.stmtSelectPlanGraph = this.db.prepare(
      `SELECT project_id, goal_id, plan_ref, plan_revision, accepted_at,
              pinned_completion_policy, pinned_arch_baseline, stages, tasks,
              task_hierarchy, execution_dag, source_cursor
         FROM plan_graph
        WHERE project_id = ? AND goal_id = ?`,
    );
    this.stmtUpsertPlanGraph = this.db.prepare(
      `INSERT INTO plan_graph
         (project_id, goal_id, plan_ref, plan_revision, accepted_at,
          pinned_completion_policy, pinned_arch_baseline, stages, tasks,
          task_hierarchy, execution_dag, source_cursor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, goal_id) DO UPDATE SET
         plan_ref                 = excluded.plan_ref,
         plan_revision            = excluded.plan_revision,
         accepted_at              = excluded.accepted_at,
         pinned_completion_policy = excluded.pinned_completion_policy,
         pinned_arch_baseline     = excluded.pinned_arch_baseline,
         stages                   = excluded.stages,
         tasks                    = excluded.tasks,
         task_hierarchy           = excluded.task_hierarchy,
         execution_dag            = excluded.execution_dag,
         source_cursor            = excluded.source_cursor`,
    );
    this.stmtSelectTaskDetail = this.db.prepare(
      `SELECT project_id, goal_id, task_id, title, stage_id,
              requirement_level, task_kind, disposition, phase, scope,
              obligations, source_cursor
         FROM task_detail
        WHERE project_id = ? AND goal_id = ? AND task_id = ?`,
    );
    this.stmtUpsertTaskDetail = this.db.prepare(
      `INSERT INTO task_detail
         (project_id, goal_id, task_id, title, stage_id, requirement_level,
          task_kind, disposition, phase, scope, obligations, source_cursor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, goal_id, task_id) DO UPDATE SET
         title             = excluded.title,
         stage_id          = excluded.stage_id,
         requirement_level = excluded.requirement_level,
         task_kind         = excluded.task_kind,
         disposition       = excluded.disposition,
         phase             = excluded.phase,
         scope             = excluded.scope,
         obligations       = excluded.obligations,
         source_cursor     = excluded.source_cursor`,
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
      // up front — nothing may be partially applied.
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
          this.applyEvent(positioned.event, positioned.cursor);
          this.stmtInsertApplied.run(positioned.event.eventId);
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

  async planGraph(query: PlanGraphViewQuery): Promise<PlanGraphViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.readPlanGraph(query.projectId, query.goalId);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (row) return { status: "ready", graph: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return {
        status: "not_ready",
        requiredCursor: query.atLeastCursor,
        observedCursor,
      };
    }

    // No atLeastCursor: show the row if present, else the freshness-safe
    // "not_ready" (mirrors goal() — never not_found here).
    if (row) return { status: "ready", graph: row, observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor,
    };
  }

  async taskDetail(query: TaskDetailViewQuery): Promise<TaskDetailViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.readTaskDetail(query.projectId, query.goalId, query.taskId);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (row) return { status: "ready", task: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return {
        status: "not_ready",
        requiredCursor: query.atLeastCursor,
        observedCursor,
      };
    }

    // No atLeastCursor: show the row if present, else the freshness-safe
    // "not_ready" (mirrors goal() — never not_found here).
    if (row) return { status: "ready", task: row, observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor,
    };
  }

  /** P1-03: active agent view (frozen entry; lane D implements the projection). */
  async activeAgent(query: ActiveAgentQuery): Promise<ActiveAgentViewResult> {
    void query;
    throw new Error("P1-03: activeAgent not implemented yet");
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

  /** Dispatch a validated event to its projection handler (P1-02 v1). */
  private applyEvent(event: DomainEvent, cursor: CommitCursor): void {
    if (event.eventType === "GoalCreated") {
      this.upsertGoalView(event, cursor);
    } else if (event.eventType === "PlanRevisionAccepted") {
      this.applyPlanRevisionAccepted(event, cursor);
    }
    // Known non-goal / non-plan events (ProjectBootstrapped,
    // WorkspaceBootstrapped, CompletionPolicyInstalled,
    // ArchitectureBaselineInstalled, CompletionPolicyActivated,
    // ArchitectureBaselineActivated) only advance the cursor; they project no row.
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
      activePlanRevision:
        row.active_plan_revision === null ? null : JSON.parse(row.active_plan_revision),
      aggregateRevision: row.aggregate_revision,
      sourceCursor: row.source_cursor as CommitCursor,
    };
  }

  private readPlanGraph(projectId: string, goalId: string): PlanGraphView | null {
    const row = this.stmtSelectPlanGraph.get(projectId, goalId) as unknown as
      | PlanGraphRow
      | undefined;
    if (!row) return null;
    return {
      projectId: row.project_id,
      goalId: row.goal_id,
      planRef: JSON.parse(row.plan_ref),
      planRevision: row.plan_revision,
      acceptedAt: row.accepted_at,
      pinnedCompletionPolicy: JSON.parse(row.pinned_completion_policy),
      pinnedArchitectureBaseline: JSON.parse(row.pinned_arch_baseline),
      stages: JSON.parse(row.stages),
      tasks: JSON.parse(row.tasks),
      taskHierarchy: JSON.parse(row.task_hierarchy),
      executionDag: JSON.parse(row.execution_dag),
      sourceCursor: row.source_cursor as CommitCursor,
    };
  }

  private readTaskDetail(
    projectId: string,
    goalId: string,
    taskId: string,
  ): TaskDetailView | null {
    const row = this.stmtSelectTaskDetail.get(projectId, goalId, taskId) as unknown as
      | TaskDetailRow
      | undefined;
    if (!row) return null;
    return {
      projectId: row.project_id,
      goalId: row.goal_id,
      taskId: row.task_id,
      title: row.title,
      stageId: row.stage_id,
      requirementLevel: row.requirement_level as TaskDetailView["requirementLevel"],
      taskKind: row.task_kind as TaskDetailView["taskKind"],
      disposition: row.disposition as TaskDetailView["disposition"],
      phase: row.phase as TaskDetailView["phase"],
      scope: JSON.parse(row.scope),
      obligations: JSON.parse(row.obligations),
      // P1-03: run-state projection lands with lane D (null before TaskClaimed).
      run: null,
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
      event.payload.activePlanRevision === null ? null : JSON.stringify(event.payload.activePlanRevision),
      event.aggregateRevision,
      cursor,
    );
  }

  /**
   * PlanRevisionAccepted@1 -> ① refresh the existing Goal row
   * (activePlanRevision = snapshot.ref, aggregateRevision =
   * payload.goalAggregateRevision, sourceCursor = current cursor); ② upsert
   * the (projectId, goalId) Plan Graph row; ③ upsert one (projectId, goalId,
   * taskId) Task Detail row per task. All fields come from the accepted
   * snapshot (the fixed pins). Runs inside the caller's transaction.
   */
  private applyPlanRevisionAccepted(event: PlanRevisionAcceptedEvent, cursor: CommitCursor): void {
    const snapshot = event.payload.planRevision;
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const workspaceId = event.workspaceId;

    // ① Goal row refresh (only when the GoalCreated row is present).
    this.stmtUpdateGoalActive.run(
      JSON.stringify(snapshot.ref),
      event.payload.goalAggregateRevision,
      cursor,
      projectId,
      workspaceId,
      goalId,
    );

    // ② Plan Graph row (full-scope (projectId, goalId)).
    this.stmtUpsertPlanGraph.run(
      projectId,
      goalId,
      JSON.stringify(snapshot.ref),
      snapshot.planRevision,
      snapshot.acceptedAt,
      JSON.stringify(snapshot.effectiveCompletionPolicy),
      JSON.stringify(snapshot.effectiveArchitectureBaseline),
      JSON.stringify(snapshot.stages),
      JSON.stringify(snapshot.tasks),
      JSON.stringify(snapshot.taskHierarchy),
      JSON.stringify(snapshot.executionDag),
      cursor,
    );

    // ③ Task Detail rows (full-scope (projectId, goalId, taskId)).
    for (const task of snapshot.tasks) {
      const obligations = snapshot.obligations
        .filter((obligation) => obligation.taskIds.includes(task.taskId))
        .map((obligation) => ({
          obligationId: obligation.obligationId,
          title: obligation.title,
          requirementLevel: obligation.requirementLevel,
          verificationRequirements: obligation.verificationRequirements,
        }));
      this.stmtUpsertTaskDetail.run(
        projectId,
        goalId,
        task.taskId,
        task.title,
        task.stageId ?? null,
        task.requirementLevel,
        task.taskKind,
        task.disposition,
        task.phase,
        JSON.stringify(task.scope),
        JSON.stringify(obligations),
        cursor,
      );
    }
  }

  /** Event types this projection currently has handlers for (P1-02, v1). */
  private isHandledEventType(eventType: string): boolean {
    return (
      eventType === "GoalCreated" ||
      eventType === "ProjectBootstrapped" ||
      eventType === "WorkspaceBootstrapped" ||
      eventType === "CompletionPolicyInstalled" ||
      eventType === "ArchitectureBaselineInstalled" ||
      eventType === "CompletionPolicyActivated" ||
      eventType === "ArchitectureBaselineActivated" ||
      eventType === "PlanRevisionAccepted"
    );
  }
}

export function createSqliteReadModelIndex(
  options: SqliteReadModelIndexOptions,
): SqliteReadModelIndex {
  return new SqliteReadModelIndex(options);
}
