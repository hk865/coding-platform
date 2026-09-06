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
import type {
  ActiveAgentQuery,
  ActiveAgentView,
  ActiveAgentViewResult,
  TaskRunState,
} from "../contracts/active-agent.js";
import { ProjectionStallError } from "../contracts/goal-view.js";
import type {
  TaskVerificationViewQuery,
  TaskVerificationViewResult,
  TaskVerificationView,
  EvidenceBindingView,
} from "../contracts/verification-view.js";
import type {
  EffectivityAnchorV1,
  EvidenceAdmittedEvent,
  EvidenceV1,
} from "../contracts/evidence.js";
import { evidenceApplicability, selectEffectiveEvidenceSet } from "../contracts/evidence.js";
import type { TaskReductionSnapshot, TaskReductionUpdatedEvent } from "../contracts/reduction.js";
import type { CommitCursor, GoalCreatedEvent } from "../contracts/command-event.js";
import type { DomainEvent } from "../contracts/events.js";
import type { PositionedEvent } from "../contracts/ledger.js";
import {
  compareCommitCursor,
  makeCommitCursor,
  seqOfCommitCursor,
} from "../contracts/ledger.js";
import type { PlanRevisionAcceptedEvent, PlanRevisionRef, PlanRevisionSnapshot } from "../contracts/plan.js";
import type {
  RunEventRecordedEvent,
  RunOutcomeUnknownEvent,
  RunStartedEvent,
  TaskClaimedEvent,
} from "../contracts/dispatch.js";
import {
  isTerminalRuntimeEvent,
  runtimeEventTerminalOutcome,
} from "../contracts/dispatch.js";
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
  run_json          TEXT,
  source_cursor     TEXT NOT NULL,
  PRIMARY KEY (project_id, goal_id, task_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS active_agent (
  project_id    TEXT NOT NULL,
  goal_id       TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  run_id        TEXT NOT NULL,
  run_ref       TEXT NOT NULL,
  attempt_ref   TEXT NOT NULL,
  binding       TEXT NOT NULL,
  lease         TEXT NOT NULL,
  attempt       TEXT NOT NULL,
  run           TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (project_id, goal_id, task_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS plan_snapshot (
  project_id    TEXT NOT NULL,
  goal_id       TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (project_id, goal_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS task_verification (
  project_id       TEXT NOT NULL,
  goal_id          TEXT NOT NULL,
  task_id          TEXT NOT NULL,
  evidence_json    TEXT NOT NULL,
  reduction_json   TEXT,
  reduction_cursor TEXT,
  source_cursor    TEXT NOT NULL,
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
  run_json: string | null;
  source_cursor: string;
};

/** Row shape we read back for an ActiveAgentView (complex fields are JSON TEXT). */
type ActiveAgentRow = {
  project_id: string;
  goal_id: string;
  task_id: string;
  run_id: string;
  run_ref: string;
  attempt_ref: string;
  binding: string;
  lease: string;
  attempt: string;
  run: string;
  source_cursor: string;
};

/** Derive the TaskDetail.run (TaskRunState) part from an ActiveAgentView row. */
function taskRunStateFrom(agent: ActiveAgentView): TaskRunState {
  return {
    runRef: agent.runRef,
    attemptRef: agent.attemptRef,
    status: agent.run.status,
    outcome: agent.run.outcome,
    exitCode: agent.run.exitCode,
    lastEventSeq: agent.run.lastEventSeq,
    startedAt: agent.run.startedAt,
    endedAt: agent.run.endedAt,
    budget: agent.run.budget,
    binding: agent.binding,
    sourceCursor: agent.run.sourceCursor,
  };
}

/** Projected evidence entry (from an EvidenceAdmitted event) carrying admission metadata. */
type ProjectedEvidence = {
  evidence: EvidenceV1;
  admittedAt: string;
  evidenceIndex: number;
};

/** Per-task verification projection — rebuilt ONLY from EvidenceAdmitted /
 * TaskReductionUpdated events (P1-04). */
type VerificationProjection = {
  projectId: string;
  goalId: string;
  taskId: string;
  evidence: ProjectedEvidence[];
  reduction: TaskReductionSnapshot | null;
  reductionCursor: CommitCursor | null;
  sourceCursor: CommitCursor;
};

/** Row shape we read back for a verification projection (complex fields are JSON TEXT). */
type TaskVerificationRow = {
  project_id: string;
  goal_id: string;
  task_id: string;
  evidence_json: string;
  reduction_json: string | null;
  reduction_cursor: string | null;
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
  private readonly stmtUpsertTaskDetailRun: StatementSync;
  private readonly stmtSelectActiveAgent: StatementSync;
  private readonly stmtSelectActiveAgentByRun: StatementSync;
  private readonly stmtUpsertActiveAgent: StatementSync;
  private readonly stmtInsertApplied: StatementSync;
  private readonly stmtUpsertCheckpoint: StatementSync;
  private readonly stmtSelectPlanSnapshot: StatementSync;
  private readonly stmtUpsertPlanSnapshot: StatementSync;
  private readonly stmtSelectTaskVerification: StatementSync;
  private readonly stmtUpsertTaskVerification: StatementSync;

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
              obligations, run_json, source_cursor
         FROM task_detail
        WHERE project_id = ? AND goal_id = ? AND task_id = ?`,
    );
    this.stmtUpsertTaskDetail = this.db.prepare(
      `INSERT INTO task_detail
         (project_id, goal_id, task_id, title, stage_id, requirement_level,
          task_kind, disposition, phase, scope, obligations, run_json, source_cursor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, goal_id, task_id) DO UPDATE SET
         title             = excluded.title,
         stage_id          = excluded.stage_id,
         requirement_level = excluded.requirement_level,
         task_kind         = excluded.task_kind,
         disposition       = excluded.disposition,
         phase             = excluded.phase,
         scope             = excluded.scope,
         obligations       = excluded.obligations,
         run_json          = excluded.run_json,
         source_cursor     = excluded.source_cursor`,
    );
    this.stmtUpsertTaskDetailRun = this.db.prepare(
      "UPDATE task_detail SET run_json = ?, source_cursor = ? WHERE project_id = ? AND goal_id = ? AND task_id = ?",
    );
    this.stmtSelectActiveAgent = this.db.prepare(
      `SELECT project_id, goal_id, task_id, run_id, run_ref, attempt_ref,
              binding, lease, attempt, run, source_cursor
         FROM active_agent
        WHERE project_id = ? AND goal_id = ? AND task_id = ?`,
    );
    this.stmtSelectActiveAgentByRun = this.db.prepare(
      `SELECT project_id, goal_id, task_id, run_id, run_ref, attempt_ref,
              binding, lease, attempt, run, source_cursor
         FROM active_agent
        WHERE project_id = ? AND run_id = ?`,
    );
    this.stmtUpsertActiveAgent = this.db.prepare(
      `INSERT INTO active_agent
         (project_id, goal_id, task_id, run_id, run_ref, attempt_ref,
          binding, lease, attempt, run, source_cursor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, goal_id, task_id) DO UPDATE SET
         run_id        = excluded.run_id,
         run_ref       = excluded.run_ref,
         attempt_ref   = excluded.attempt_ref,
         binding       = excluded.binding,
         lease         = excluded.lease,
         attempt       = excluded.attempt,
         run           = excluded.run,
         source_cursor = excluded.source_cursor`,
    );
    this.stmtInsertApplied = this.db.prepare(
      "INSERT OR IGNORE INTO applied_event (event_id) VALUES (?)",
    );
    this.stmtUpsertCheckpoint = this.db.prepare(
      `INSERT INTO read_model_checkpoint (id, cursor) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor`,
    );
    this.stmtSelectPlanSnapshot = this.db.prepare(
      "SELECT snapshot_json FROM plan_snapshot WHERE project_id = ? AND goal_id = ?",
    );
    this.stmtUpsertPlanSnapshot = this.db.prepare(
      `INSERT INTO plan_snapshot (project_id, goal_id, snapshot_json, source_cursor)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, goal_id) DO UPDATE SET
         snapshot_json = excluded.snapshot_json,
         source_cursor = excluded.source_cursor`,
    );
    this.stmtSelectTaskVerification = this.db.prepare(
      `SELECT project_id, goal_id, task_id, evidence_json, reduction_json,
              reduction_cursor, source_cursor
         FROM task_verification
        WHERE project_id = ? AND goal_id = ? AND task_id = ?`,
    );
    this.stmtUpsertTaskVerification = this.db.prepare(
      `INSERT INTO task_verification
         (project_id, goal_id, task_id, evidence_json, reduction_json,
          reduction_cursor, source_cursor)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, goal_id, task_id) DO UPDATE SET
         evidence_json    = excluded.evidence_json,
         reduction_json   = excluded.reduction_json,
         reduction_cursor = excluded.reduction_cursor,
         source_cursor    = excluded.source_cursor`,
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

  /** P1-03: active agent view — same opaque-cursor freshness as goal()/planGraph()/taskDetail(). */
  async activeAgent(query: ActiveAgentQuery): Promise<ActiveAgentViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.readActiveAgent(query.projectId, query.goalId, query.taskId);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (row) return { status: "ready", agent: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return {
        status: "not_ready",
        requiredCursor: query.atLeastCursor,
        observedCursor,
      };
    }

    // No atLeastCursor: show the row if present, else the freshness-safe
    // "not_ready" (never not_found here), mirroring goal()/planGraph()/taskDetail().
    if (row) return { status: "ready", agent: row, observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor,
    };
  }

  /** P1-05: goal phase status projection (handled by lane B). */
  async goalStatus(query: import("../contracts/goal-phase-view.js").GoalStatusQuery): Promise<import("../contracts/goal-phase-view.js").GoalStatusViewResult> {
    throw new Error("P1-05: not implemented yet (lane B)");
  }

  /** P1-05: goal phase timeline projection (handled by lane B). */
  async goalTimeline(query: import("../contracts/goal-phase-view.js").GoalTimelineQuery): Promise<import("../contracts/goal-phase-view.js").GoalTimelineViewResult> {
    throw new Error("P1-05: not implemented yet (lane B)");
  }

  // ------------------------------------------------------------------ //
  // P1-03 run projection handlers (mirror of the InMemory fold)          //
  // ------------------------------------------------------------------ //

  /** TaskClaimed@1 -> create/refresh the (projectId, goalId, taskId) ActiveAgent row
   * and sync the TaskDetail row's run state. lease.grantedAt = claimedAt; status
   * "starting", lastEventSeq 0. */
  private applyTaskClaimed(event: TaskClaimedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const taskId = event.payload.taskId;
    const row: ActiveAgentView = {
      projectId,
      goalId,
      taskId,
      runRef: event.payload.runRef,
      attemptRef: event.payload.attemptRef,
      binding: event.payload.roleBinding,
      lease: {
        holderRunId: event.payload.runRef.runId,
        grantedAt: event.payload.claimedAt,
        expiresAt: null,
        sourceCursor: cursor,
      },
      attempt: {
        attemptId: event.payload.attemptRef.attemptId,
        status: "claimed",
        startedAt: null,
        endedAt: null,
        endOutcome: null,
        sourceCursor: cursor,
      },
      run: {
        status: "starting",
        outcome: null,
        exitCode: null,
        lastEventSeq: 0,
        startedAt: null,
        endedAt: null,
        budget: event.payload.budget,
        sourceCursor: cursor,
      },
      sourceCursor: cursor,
    };
    this.writeActiveAgent(row);
    this.syncTaskDetailRun(projectId, goalId, taskId, taskRunStateFrom(row), cursor);
  }

  /** RunStarted@1 -> refresh agent.run{status running, startedAt} + attempt{started,
   * startedAt} and the row's sourceCursor. Located through the run id (aggregateId). */
  private applyRunStarted(event: RunStartedEvent, cursor: CommitCursor): void {
    const row = this.readActiveAgentByRun(event.projectId, event.aggregateId);
    if (!row) return;
    const updated: ActiveAgentView = {
      ...row,
      run: {
        ...row.run,
        status: "running",
        startedAt: event.payload.startedAt,
        sourceCursor: cursor,
      },
      attempt: {
        ...row.attempt,
        status: "started",
        startedAt: event.payload.startedAt,
        sourceCursor: cursor,
      },
      sourceCursor: cursor,
    };
    this.writeActiveAgent(updated);
    this.syncTaskDetailRun(updated.projectId, updated.goalId, updated.taskId, taskRunStateFrom(updated), cursor);
  }

  /** RunEventRecorded@1 -> fold on payload.runtimeEvent, idempotent against the row's
   * lastEventSeq (sequence <= lastEventSeq changes nothing). Terminal runtime events end
   * the Run AND the Attempt. NEVER touches TaskDetail.phase (satisfaction is P1-04). */
  private applyRunEventRecorded(event: RunEventRecordedEvent, cursor: CommitCursor): void {
    const row = this.readActiveAgentByRun(event.projectId, event.aggregateId);
    if (!row) return;
    const rt = event.payload.runtimeEvent;
    if (rt.sequence <= row.run.lastEventSeq) return;

    const terminal = isTerminalRuntimeEvent(rt);
    const outcome = terminal ? runtimeEventTerminalOutcome(rt) : row.run.outcome;
    const exitCode = rt.payload.kind === "completed" ? rt.payload.exitCode : row.run.exitCode;
    const endedAt = terminal ? rt.occurredAt : row.run.endedAt;

    const updated: ActiveAgentView = {
      ...row,
      run: {
        ...row.run,
        status: terminal ? "ended" : "running",
        outcome,
        exitCode,
        lastEventSeq: rt.sequence,
        endedAt,
        sourceCursor: cursor,
      },
      attempt: terminal
        ? {
            ...row.attempt,
            status: "ended",
            endOutcome: outcome,
            endedAt: rt.occurredAt,
            sourceCursor: cursor,
          }
        : row.attempt,
      sourceCursor: cursor,
    };
    this.writeActiveAgent(updated);
    this.syncTaskDetailRun(updated.projectId, updated.goalId, updated.taskId, taskRunStateFrom(updated), cursor);
  }

  /** RunOutcomeUnknown@1 -> explicit fact: run ended with outcome_unknown (NEVER inferred
   * from crash) + attempt ended. */
  private applyRunOutcomeUnknown(event: RunOutcomeUnknownEvent, cursor: CommitCursor): void {
    const row = this.readActiveAgentByRun(event.projectId, event.aggregateId);
    if (!row) return;
    const updated: ActiveAgentView = {
      ...row,
      run: {
        ...row.run,
        status: "ended",
        outcome: "outcome_unknown",
        endedAt: event.payload.observedAt,
        sourceCursor: cursor,
      },
      attempt: {
        ...row.attempt,
        status: "ended",
        endOutcome: "outcome_unknown",
        endedAt: event.payload.observedAt,
        sourceCursor: cursor,
      },
      sourceCursor: cursor,
    };
    this.writeActiveAgent(updated);
    this.syncTaskDetailRun(updated.projectId, updated.goalId, updated.taskId, taskRunStateFrom(updated), cursor);
  }

  /** Push the run-state part of an ActiveAgentView onto the matching TaskDetail row.
   * Only touches a TaskDetail row already created by PlanRevisionAccepted; phase and
   * plan fields are NEVER modified here (satisfaction is P1-04). */
  private syncTaskDetailRun(
    projectId: string,
    goalId: string,
    taskId: string,
    runState: TaskRunState,
    cursor: CommitCursor,
  ): void {
    this.stmtUpsertTaskDetailRun.run(
      JSON.stringify(runState),
      cursor,
      projectId,
      goalId,
      taskId,
    );
  }

  /** Read the ActiveAgentView for a full key (projectId, goalId, taskId). */
  private readActiveAgent(projectId: string, goalId: string, taskId: string): ActiveAgentView | null {
    const row = this.stmtSelectActiveAgent.get(projectId, goalId, taskId) as unknown as
      | ActiveAgentRow
      | undefined;
    if (!row) return null;
    return this.activeAgentFromRow(row);
  }

  /** Read the ActiveAgentView located by projectId + runId (run events carry no goalId). */
  private readActiveAgentByRun(projectId: string, runId: string): ActiveAgentView | null {
    const row = this.stmtSelectActiveAgentByRun.get(projectId, runId) as unknown as
      | ActiveAgentRow
      | undefined;
    if (!row) return null;
    return this.activeAgentFromRow(row);
  }

  private activeAgentFromRow(row: ActiveAgentRow): ActiveAgentView {
    return {
      projectId: row.project_id,
      goalId: row.goal_id,
      taskId: row.task_id,
      runRef: JSON.parse(row.run_ref),
      attemptRef: JSON.parse(row.attempt_ref),
      binding: JSON.parse(row.binding),
      lease: JSON.parse(row.lease),
      attempt: JSON.parse(row.attempt),
      run: JSON.parse(row.run),
      sourceCursor: row.source_cursor as CommitCursor,
    };
  }

  private writeActiveAgent(row: ActiveAgentView): void {
    this.stmtUpsertActiveAgent.run(
      row.projectId,
      row.goalId,
      row.taskId,
      row.runRef.runId,
      JSON.stringify(row.runRef),
      JSON.stringify(row.attemptRef),
      JSON.stringify(row.binding),
      JSON.stringify(row.lease),
      JSON.stringify(row.attempt),
      JSON.stringify(row.run),
      row.sourceCursor,
    );
  }

  /** Event types this projection currently has handlers for (P1-02 + P1-03, v1). */
  private isHandledEventType(eventType: string): boolean {
    return (
      eventType === "GoalCreated" ||
      eventType === "ProjectBootstrapped" ||
      eventType === "WorkspaceBootstrapped" ||
      eventType === "CompletionPolicyInstalled" ||
      eventType === "ArchitectureBaselineInstalled" ||
      eventType === "CompletionPolicyActivated" ||
      eventType === "ArchitectureBaselineActivated" ||
      eventType === "PlanRevisionAccepted" ||
      eventType === "TaskClaimed" ||
      eventType === "RunStarted" ||
      eventType === "RunEventRecorded" ||
      eventType === "RunOutcomeUnknown" ||
      eventType === "EvidenceAdmitted" ||
      eventType === "TaskReductionUpdated"
    );
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

  /** Dispatch a validated event to its projection handler (P1-02 + P1-03 v1). */
  private applyEvent(event: DomainEvent, cursor: CommitCursor): void {
    if (event.eventType === "GoalCreated") {
      this.upsertGoalView(event, cursor);
    } else if (event.eventType === "PlanRevisionAccepted") {
      this.applyPlanRevisionAccepted(event, cursor);
    } else if (event.eventType === "TaskClaimed") {
      this.applyTaskClaimed(event, cursor);
    } else if (event.eventType === "RunStarted") {
      this.applyRunStarted(event, cursor);
    } else if (event.eventType === "RunEventRecorded") {
      this.applyRunEventRecorded(event, cursor);
    } else if (event.eventType === "RunOutcomeUnknown") {
      this.applyRunOutcomeUnknown(event, cursor);
    } else if (event.eventType === "EvidenceAdmitted") {
      this.applyEvidenceAdmitted(event, cursor);
    } else if (event.eventType === "TaskReductionUpdated") {
      this.applyTaskReductionUpdated(event, cursor);
    }
    // Known non-goal / non-plan / non-dispatch events (ProjectBootstrapped,
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
      // P1-03: run-state projection (null until a TaskClaimed event for this task).
      run: row.run_json === null ? null : (JSON.parse(row.run_json) as TaskRunState),
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

    // P1-04: retain the accepted plan snapshot (tasks + obligations) so the
    // verification view can recompute evidence applicability at query time.
    this.stmtUpsertPlanSnapshot.run(projectId, goalId, JSON.stringify(snapshot), cursor);

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
        null,
        cursor,
      );
    }
  }

  // ------------------------------------------------------------------ //
  // P1-04 verification projection handlers                               //
  // ------------------------------------------------------------------ //

  /** EvidenceAdmitted@1 -> append the immutable Evidence + admission metadata to
   * the (projectId, goalId, taskId) verification row (admission order). */
  private applyEvidenceAdmitted(event: EvidenceAdmittedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const taskId = event.payload.taskId;
    const row = this.readVerificationRow(projectId, goalId, taskId) ?? {
      projectId,
      goalId,
      taskId,
      evidence: [],
      reduction: null,
      reductionCursor: null,
      sourceCursor: cursor,
    };
    row.evidence.push({
      evidence: event.payload.evidence,
      admittedAt: event.payload.admittedAt,
      evidenceIndex: event.payload.evidenceIndex,
    });
    row.sourceCursor = cursor;
    this.writeVerificationRow(row);
  }

  /** TaskReductionUpdated@1 -> refresh the task's canonical reduction snapshot
   * (it is a projected FACT — never derived from report text at query time). */
  private applyTaskReductionUpdated(event: TaskReductionUpdatedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const taskId = event.payload.taskId;
    const row = this.readVerificationRow(projectId, goalId, taskId) ?? {
      projectId,
      goalId,
      taskId,
      evidence: [],
      reduction: null,
      reductionCursor: null,
      sourceCursor: cursor,
    };
    row.reduction = event.payload.reduction;
    row.reductionCursor = cursor;
    row.sourceCursor = cursor;
    this.writeVerificationRow(row);
  }

  private readVerificationRow(
    projectId: string,
    goalId: string,
    taskId: string,
  ): VerificationProjection | null {
    const row = this.stmtSelectTaskVerification.get(projectId, goalId, taskId) as unknown as
      | TaskVerificationRow
      | undefined;
    if (!row) return null;
    return {
      projectId: row.project_id,
      goalId: row.goal_id,
      taskId: row.task_id,
      evidence: JSON.parse(row.evidence_json) as ProjectedEvidence[],
      reduction: row.reduction_json === null ? null : (JSON.parse(row.reduction_json) as TaskReductionSnapshot),
      reductionCursor: row.reduction_cursor as CommitCursor | null,
      sourceCursor: row.source_cursor as CommitCursor,
    };
  }

  private writeVerificationRow(row: VerificationProjection): void {
    this.stmtUpsertTaskVerification.run(
      row.projectId,
      row.goalId,
      row.taskId,
      JSON.stringify(row.evidence),
      row.reduction === null ? null : JSON.stringify(row.reduction),
      row.reductionCursor,
      row.sourceCursor,
    );
  }

  private readPlanSnapshot(projectId: string, goalId: string): PlanRevisionSnapshot | null {
    const row = this.stmtSelectPlanSnapshot.get(projectId, goalId) as unknown as
      | { snapshot_json: string }
      | undefined;
    return row ? (JSON.parse(row.snapshot_json) as PlanRevisionSnapshot) : null;
  }

  /** P1-04: task-detail verification view (frozen entry; lane D implements).
   * The view is rebuilt ONLY from events: applicability is recomputed at query
   * time by the PURE evidenceApplicability function against the projected
   * current anchor; the reduction is the projected reduction fact. */
  async taskVerification(query: TaskVerificationViewQuery): Promise<TaskVerificationViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.readVerificationRow(query.projectId, query.goalId, query.taskId);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (row) return {
          status: "ready",
          verification: this.buildVerificationView(row),
          observedCursor: observedCursor!,
        };
        return { status: "not_found", observedCursor };
      }
      return { status: "not_ready", requiredCursor: query.atLeastCursor, observedCursor };
    }

    // No atLeastCursor: show the row if present, else the freshness-safe
    // "not_ready" (never not_found here), mirroring goal()/planGraph()/taskDetail().
    if (row) return {
      status: "ready",
      verification: this.buildVerificationView(row),
      observedCursor: observedCursor!,
    };
    return { status: "not_ready", requiredCursor: observedCursor ?? makeCommitCursor(1), observedCursor };
  }

  /** Build the TaskVerificationView from the projected row (query-time derived
   * parts use the pure functions; they never write back to history). */
  private buildVerificationView(row: VerificationProjection): TaskVerificationView {
    const planSnapshot = this.readPlanSnapshot(row.projectId, row.goalId);
    const currentAnchor = row.reduction ? row.reduction.currentAnchor : null;

    // Admission order = the per-task evidence index order (deterministic).
    const sorted = [...row.evidence].sort((a, b) => a.evidenceIndex - b.evidenceIndex);
    const evidence: EvidenceBindingView[] = sorted.map((pe) =>
      this.toEvidenceBindingView(pe, planSnapshot, currentAnchor),
    );

    let effectiveEvidenceIds: string[] = [];
    let blockingEvidenceIds: string[] = [];
    if (planSnapshot !== null && currentAnchor !== null) {
      const effectiveSet = selectEffectiveEvidenceSet(
        sorted.map((pe) => pe.evidence),
        planSnapshot,
        currentAnchor,
      );
      effectiveEvidenceIds = effectiveSet.effectiveEvidenceIds;
      blockingEvidenceIds = Object.values(effectiveSet.blockingByRequirement).flat();
    }

    const reduction = row.reduction === null
      ? null
      : {
          phase: row.reduction.phase,
          causes: row.reduction.causes,
          effectiveEvidenceIds: row.reduction.effectiveEvidenceIds,
          blockingEvidenceIds: row.reduction.blockingEvidenceIds,
          staleEvidenceIds: row.reduction.staleEvidenceIds,
          outOfScopeEvidenceIds: row.reduction.outOfScopeEvidenceIds,
          satisfiedObligationIds: row.reduction.satisfiedObligationIds,
          planRef: row.reduction.planRef,
          reducedAt: row.reduction.reducedAt,
          sourceCursor: row.reductionCursor!,
        };

    return {
      projectId: row.projectId,
      goalId: row.goalId,
      taskId: row.taskId,
      currentAnchor,
      planRef: this.viewPlanRef(row, planSnapshot, currentAnchor),
      planRevision: this.viewPlanRevision(row, planSnapshot, currentAnchor),
      evidence,
      effectiveEvidenceIds,
      blockingEvidenceIds,
      reduction,
      sourceCursor: row.sourceCursor,
    };
  }

  /** Map a projected evidence entry to its display binding (applicability is
   * derived by the pure function; null when no authoritative current anchor). */
  private toEvidenceBindingView(
    pe: ProjectedEvidence,
    planSnapshot: PlanRevisionSnapshot | null,
    currentAnchor: EffectivityAnchorV1 | null,
  ): EvidenceBindingView {
    const e = pe.evidence;
    const applicability = planSnapshot !== null && currentAnchor !== null
      ? evidenceApplicability(e, planSnapshot, currentAnchor)
      : null;
    return {
      evidenceId: e.evidenceId,
      kind: e.kind,
      outcome: e.outcome,
      coverage: e.coverage.map((c) => ({ ...c })),
      applicability,
      anchor: { ...e.anchor },
      verificationPlanId: e.verificationPlanRef.planId,
      verificationPlanDigest: e.verificationPlanRef.planDigest,
      sourceRunRef: e.source.runRef,
      checkId: e.source.checkId,
      summary: e.summary.text,
      artifactRef: e.summary.artifactRef,
      admittedAt: pe.admittedAt,
      evidenceIndex: pe.evidenceIndex,
    };
  }

  /** planRef for the view: the accepted plan's ref, else the reduction anchor,
   * else the first evidence's anchor (the row only exists after such an event). */
  private viewPlanRef(
    row: VerificationProjection,
    planSnapshot: PlanRevisionSnapshot | null,
    currentAnchor: EffectivityAnchorV1 | null,
  ): PlanRevisionRef {
    return (
      planSnapshot?.ref ??
      currentAnchor?.planRef ??
      row.evidence[0]?.evidence.anchor.planRef ??
      { aggregateType: "PlanRevision", projectId: row.projectId, planId: "" }
    );
  }

  private viewPlanRevision(
    row: VerificationProjection,
    planSnapshot: PlanRevisionSnapshot | null,
    currentAnchor: EffectivityAnchorV1 | null,
  ): number {
    return (
      planSnapshot?.planRevision ??
      currentAnchor?.planRevision ??
      row.evidence[0]?.evidence.anchor.planRevision ??
      0
    );
  }
}

export function createSqliteReadModelIndex(
  options: SqliteReadModelIndexOptions,
): SqliteReadModelIndex {
  return new SqliteReadModelIndex(options);
}
