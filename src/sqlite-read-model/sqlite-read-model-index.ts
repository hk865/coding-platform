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
  RunRef,
  TaskAttemptRef,
} from "../contracts/dispatch.js";
import {
  isTerminalRuntimeEvent,
  runtimeEventTerminalOutcome,
} from "../contracts/dispatch.js";
import { validateDomainEvent } from "../contracts/validation.js";
import type { HandoffRecordedEvent, ReplacementClaimedEvent } from "../contracts/handoff.js";
import { handoffPacketRefFor } from "../contracts/handoff.js";
import type {
  HandoffProvenanceView,
  HandoffProvenanceViewQuery,
  HandoffProvenanceViewResult,
} from "../contracts/handoff-view.js";
import type {
  WorkspaceLeaseView,
  WorkspaceLeaseViewQuery,
  WorkspaceLeaseViewResult,
  IntegrationConflictView,
  IntegrationConflictViewQuery,
  IntegrationConflictViewResult,
  WorkspacePatchView,
  WorkspacePatchViewEntry,
  WorkspacePatchViewQuery,
  WorkspacePatchViewResult,
  IntegrationConflictViewRecord,
} from "../contracts/workspace-views.js";
import type {
  WorkspaceReadLeaseGrantedEvent,
  WorkspaceReadLeaseReleasedEvent,
  WorkspaceWriteLeaseGrantedEvent,
  WorkspaceWriteLeaseReleasedEvent,
  WorkspaceLeaseHolderV1,
} from "../contracts/workspace-lease.js";
import type { IntegrationJoinedEvent } from "../contracts/integration.js";
import { patchRecordRefFor } from "../contracts/patch.js";
import type { PatchRecordedEvent } from "../contracts/patch.js";
import type { RoleBindingRefV1 } from "../contracts/dispatch.js";
import type {
  PortfolioEntry,
  PortfolioViewQuery,
  PortfolioViewResult,
  WorkspaceSummaryViewQuery,
  WorkspaceSummaryViewResult,
  PlanMatrixViewQuery,
  PlanMatrixViewResult,
  ActiveAgentsViewQuery,
  ActiveAgentsViewResult,
  TaskEvidenceViewQuery,
  TaskEvidenceViewResult,
  TimelineViewQuery,
  TimelineViewResult,
} from "../contracts/console-views.js";
import { consoleWorkspaceKey, consoleGoalKey, consoleTaskKey, CONSOLE_PORTFOLIO_MAX_PROJECTS } from "../contracts/console-views.js";

/**
 * Reconstruct a lease view holder: the grant events carry runRef + attemptRef
 * only (the roleBinding lives on the lease snapshot, off the event stream), so
 * the display view carries a stable placeholder binding — display-only, never
 * judged, never replayed as authority.
 */
const LEASE_P1_07_PLACEHOLDER_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1,
  bindingId: "",
  templateId: "",
  templateRevision: "",
  bindingVersion: 1,
  policyRevision: "",
};

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
CREATE TABLE IF NOT EXISTS goal_status (
  project_id                 TEXT NOT NULL,
  goal_id                    TEXT NOT NULL,
  phase                      TEXT NOT NULL,
  previous_phase             TEXT,
  plan_ref                   TEXT,
  reason_codes               TEXT NOT NULL,
  explanation                TEXT NOT NULL,
  side_effect_reconciliation TEXT NOT NULL,
  aggregate_revision         INTEGER NOT NULL,
  updated_at                 TEXT,
  source_cursor              TEXT NOT NULL,
  PRIMARY KEY (project_id, goal_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS goal_timeline (
  project_id         TEXT NOT NULL,
  goal_id            TEXT NOT NULL,
  seq                INTEGER NOT NULL,
  phase              TEXT NOT NULL,
  previous_phase     TEXT,
  reason_codes       TEXT NOT NULL,
  explanation        TEXT NOT NULL,
  aggregate_revision INTEGER NOT NULL,
  reduced_at         TEXT NOT NULL,
  event_id           TEXT NOT NULL,
  source_cursor      TEXT NOT NULL,
  PRIMARY KEY (project_id, goal_id, seq)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS handoff_provenance (
  project_id      TEXT NOT NULL,
  goal_id         TEXT NOT NULL,
  task_id         TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  PRIMARY KEY (project_id, goal_id, task_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS workspace_lease_view (
  project_id   TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  lease_json   TEXT NOT NULL,
  PRIMARY KEY (project_id, workspace_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS integration_conflict_view (
  project_id    TEXT NOT NULL,
  goal_id       TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  conflict_json TEXT NOT NULL,
  PRIMARY KEY (project_id, goal_id, task_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS workspace_patch_view (
  project_id   TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  patch_json   TEXT NOT NULL,
  PRIMARY KEY (project_id, workspace_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS console_portfolio (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS console_summary (
  scope_key     TEXT NOT NULL,
  view_json     TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS console_matrix (
  goal_key      TEXT NOT NULL,
  view_json     TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (goal_key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS console_agent (
  task_key      TEXT NOT NULL,
  view_json     TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (task_key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS console_evidence (
  task_key      TEXT NOT NULL,
  view_json     TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (task_key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS console_timeline (
  scope_key     TEXT NOT NULL,
  view_json     TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
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

/** Row shape we read back for a goal status projection (complex fields are JSON TEXT). */
type GoalStatusRow = {
  project_id: string;
  goal_id: string;
  phase: string;
  previous_phase: string | null;
  plan_ref: string | null;
  reason_codes: string;
  explanation: string;
  side_effect_reconciliation: string;
  aggregate_revision: number;
  updated_at: string | null;
  source_cursor: string;
};

/** Row shape we read back for a goal timeline projection (complex fields are JSON TEXT). */
type GoalTimelineRow = {
  project_id: string;
  goal_id: string;
  seq: number;
  phase: string;
  previous_phase: string | null;
  reason_codes: string;
  explanation: string;
  aggregate_revision: number;
  reduced_at: string;
  event_id: string;
  source_cursor: string;
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
  private readonly stmtSelectGoalStatus: StatementSync;
  private readonly stmtUpsertGoalStatus: StatementSync;
  private readonly stmtSelectGoalTimeline: StatementSync;
  private readonly stmtInsertGoalTimeline: StatementSync;
  private readonly stmtSelectMaxGoalTimelineSeq: StatementSync;
  private readonly stmtSelectHandoffProvenance: StatementSync;
  private readonly stmtUpsertHandoffProvenance: StatementSync;
  private readonly stmtSelectWorkspaceLease: StatementSync;
  private readonly stmtUpsertWorkspaceLease: StatementSync;
  private readonly stmtSelectIntegrationConflict: StatementSync;
  private readonly stmtUpsertIntegrationConflict: StatementSync;
  private readonly stmtSelectWorkspacePatch: StatementSync;
  private readonly stmtUpsertWorkspacePatch: StatementSync;

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
    this.stmtSelectGoalStatus = this.db.prepare(
`SELECT project_id, goal_id, phase, previous_phase, plan_ref, reason_codes,
             explanation, side_effect_reconciliation, aggregate_revision,
             updated_at, source_cursor
        FROM goal_status
       WHERE project_id = ? AND goal_id = ?`
    );
    this.stmtUpsertGoalStatus = this.db.prepare(
`INSERT INTO goal_status
        (project_id, goal_id, phase, previous_phase, plan_ref, reason_codes,
         explanation, side_effect_reconciliation, aggregate_revision,
         updated_at, source_cursor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, goal_id) DO UPDATE SET
        phase                      = excluded.phase,
        previous_phase             = excluded.previous_phase,
        plan_ref                   = excluded.plan_ref,
        reason_codes               = excluded.reason_codes,
        explanation                = excluded.explanation,
        side_effect_reconciliation = excluded.side_effect_reconciliation,
        aggregate_revision         = excluded.aggregate_revision,
        updated_at                 = excluded.updated_at,
        source_cursor              = excluded.source_cursor`
    );
    this.stmtSelectGoalTimeline = this.db.prepare(
`SELECT seq, phase, previous_phase, reason_codes, explanation,
             aggregate_revision, reduced_at, event_id, source_cursor
        FROM goal_timeline
       WHERE project_id = ? AND goal_id = ?
       ORDER BY seq ASC`
    );
    this.stmtInsertGoalTimeline = this.db.prepare(
`INSERT INTO goal_timeline
        (project_id, goal_id, seq, phase, previous_phase, reason_codes,
         explanation, aggregate_revision, reduced_at, event_id, source_cursor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.stmtSelectMaxGoalTimelineSeq = this.db.prepare(
`SELECT MAX(seq) AS max_seq FROM goal_timeline WHERE project_id = ? AND goal_id = ?`
    );
    this.stmtSelectHandoffProvenance = this.db.prepare(
      "SELECT provenance_json FROM handoff_provenance WHERE project_id = ? AND goal_id = ? AND task_id = ?",
    );
    this.stmtUpsertHandoffProvenance = this.db.prepare(
      "INSERT INTO handoff_provenance (project_id, goal_id, task_id, provenance_json) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, goal_id, task_id) DO UPDATE SET provenance_json = excluded.provenance_json",
    );
    this.stmtSelectWorkspaceLease = this.db.prepare(
      "SELECT lease_json FROM workspace_lease_view WHERE project_id = ? AND workspace_id = ?",
    );
    this.stmtUpsertWorkspaceLease = this.db.prepare(
      "INSERT INTO workspace_lease_view (project_id, workspace_id, lease_json) VALUES (?, ?, ?) ON CONFLICT(project_id, workspace_id) DO UPDATE SET lease_json = excluded.lease_json",
    );
    this.stmtSelectIntegrationConflict = this.db.prepare(
      "SELECT conflict_json FROM integration_conflict_view WHERE project_id = ? AND goal_id = ? AND task_id = ?",
    );
    this.stmtUpsertIntegrationConflict = this.db.prepare(
      "INSERT INTO integration_conflict_view (project_id, goal_id, task_id, conflict_json) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, goal_id, task_id) DO UPDATE SET conflict_json = excluded.conflict_json",
    );
    this.stmtSelectWorkspacePatch = this.db.prepare(
      "SELECT patch_json FROM workspace_patch_view WHERE project_id = ? AND workspace_id = ?",
    );
    this.stmtUpsertWorkspacePatch = this.db.prepare(
      "INSERT INTO workspace_patch_view (project_id, workspace_id, patch_json) VALUES (?, ?, ?) ON CONFLICT(project_id, workspace_id) DO UPDATE SET patch_json = excluded.patch_json",
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

  /** P1-06: display-only handoff provenance timeline (keyed by full-scope
   * (projectId, goalId, taskId); NEVER judges completion). Freshness mirrors
   * goalStatus(): not_found only when atLeastCursor is provided AND already
   * covered AND there is no row; otherwise the freshness-safe not_ready. */
  async handoffProvenance(query: HandoffProvenanceViewQuery): Promise<HandoffProvenanceViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.readHandoffProvenanceRow(query.projectId, query.goalId, query.taskId);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (row) return { status: "ready", provenance: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor: observedCursor ?? makeCommitCursor(1) };
      }
      return {
        status: "not_ready",
        requiredCursor: query.atLeastCursor,
        observedCursor: observedCursor ?? makeCommitCursor(1),
      };
    }

    // No atLeastCursor: show the row if present, else the freshness-safe
    // "not_ready" (identical to goalStatus() — never not_found here).
    if (row) return { status: "ready", provenance: row, observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor: observedCursor ?? makeCommitCursor(1),
    };
  }

  // --------------------------------------------------------------------- //
  // P1-07 views (display-only; persisted across close()/reopen)            //
  // --------------------------------------------------------------------- //

  async workspaceLeaseView(query: WorkspaceLeaseViewQuery): Promise<WorkspaceLeaseViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.readWorkspaceLeaseRow(query.projectId, query.workspaceId);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (row) return { status: "ready", lease: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor: observedCursor ?? makeCommitCursor(1) };
      }
      return {
        status: "not_ready",
        requiredCursor: query.atLeastCursor,
        observedCursor: observedCursor ?? makeCommitCursor(1),
      };
    }

    if (row) return { status: "ready", lease: row, observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor: observedCursor ?? makeCommitCursor(1),
    };
  }

  async integrationConflicts(query: IntegrationConflictViewQuery): Promise<IntegrationConflictViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.readIntegrationConflictRow(query.projectId, query.goalId, query.taskId);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (row) return { status: "ready", integration: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor: observedCursor ?? makeCommitCursor(1) };
      }
      return {
        status: "not_ready",
        requiredCursor: query.atLeastCursor,
        observedCursor: observedCursor ?? makeCommitCursor(1),
      };
    }

    if (row) return { status: "ready", integration: row, observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor: observedCursor ?? makeCommitCursor(1),
    };
  }

  async workspacePatches(query: WorkspacePatchViewQuery): Promise<WorkspacePatchViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.readWorkspacePatchRow(query.projectId, query.workspaceId);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (row) return { status: "ready", patch: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor: observedCursor ?? makeCommitCursor(1) };
      }
      return {
        status: "not_ready",
        requiredCursor: query.atLeastCursor,
        observedCursor: observedCursor ?? makeCommitCursor(1),
      };
    }

    if (row) return { status: "ready", patch: row, observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor: observedCursor ?? makeCommitCursor(1),
    };
  }

  private readWorkspaceLeaseRow(projectId: string, workspaceId: string): WorkspaceLeaseView | null {
    const row = this.stmtSelectWorkspaceLease.get(projectId, workspaceId) as unknown as
      | { lease_json: string }
      | undefined;
    if (!row) return null;
    return JSON.parse(row.lease_json) as WorkspaceLeaseView;
  }

  private writeWorkspaceLeaseRow(row: WorkspaceLeaseView): void {
    this.stmtUpsertWorkspaceLease.run(row.projectId, row.workspaceId, JSON.stringify(row));
  }

  private readIntegrationConflictRow(projectId: string, goalId: string, taskId: string): IntegrationConflictView | null {
    const row = this.stmtSelectIntegrationConflict.get(projectId, goalId, taskId) as unknown as
      | { conflict_json: string }
      | undefined;
    if (!row) return null;
    return JSON.parse(row.conflict_json) as IntegrationConflictView;
  }

  private writeIntegrationConflictRow(row: IntegrationConflictView): void {
    this.stmtUpsertIntegrationConflict.run(row.projectId, row.goalId, row.taskId, JSON.stringify(row));
  }

  private readWorkspacePatchRow(projectId: string, workspaceId: string): WorkspacePatchView | null {
    const row = this.stmtSelectWorkspacePatch.get(projectId, workspaceId) as unknown as
      | { patch_json: string }
      | undefined;
    if (!row) return null;
    return JSON.parse(row.patch_json) as WorkspacePatchView;
  }

  private writeWorkspacePatchRow(row: WorkspacePatchView): void {
    this.stmtUpsertWorkspacePatch.run(row.projectId, row.workspaceId, JSON.stringify(row));
  }

  private readHandoffProvenanceRow(
    projectId: string,
    goalId: string,
    taskId: string,
  ): HandoffProvenanceView | null {
    const row = this.stmtSelectHandoffProvenance.get(projectId, goalId, taskId) as unknown as
      | { provenance_json: string }
      | undefined;
    if (!row) return null;
    return JSON.parse(row.provenance_json) as HandoffProvenanceView;
  }

  private writeHandoffProvenanceRow(row: HandoffProvenanceView): void {
    this.stmtUpsertHandoffProvenance.run(
      row.projectId,
      row.goalId,
      row.taskId,
      JSON.stringify(row),
    );
  }

  /** P1-05: goal phase status projection (per (projectId, goalId)). */
  async goalStatus(query: import("../contracts/goal-phase-view.js").GoalStatusQuery): Promise<import("../contracts/goal-phase-view.js").GoalStatusViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.readGoalStatusRow(query.projectId, query.goalId);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (row) return { status: "ready", goal: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return { status: "not_ready", requiredCursor: query.atLeastCursor, observedCursor };
    }

    // No atLeastCursor: show the row if present, else the freshness-safe
    // "not_ready" (the contract forbids not_found here, mirroring goal()).
    if (row) return { status: "ready", goal: row, observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor,
    };
  }

  /** P1-05: goal phase timeline projection (per (projectId, goalId)). */
  async goalTimeline(query: import("../contracts/goal-phase-view.js").GoalTimelineQuery): Promise<import("../contracts/goal-phase-view.js").GoalTimelineViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.readGoalTimelineRows(query.projectId, query.goalId);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (row !== null) return { status: "ready", timeline: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return { status: "not_ready", requiredCursor: query.atLeastCursor, observedCursor };
    }

    // No atLeastCursor: show the rows if present, else the freshness-safe
    // "not_ready" (never not_found here, mirroring goalStatus()).
    if (row !== null) return { status: "ready", timeline: row, observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor,
    };
  }

  private readGoalStatusRow(projectId: string, goalId: string): import("../contracts/goal-phase-view.js").GoalStatusView | null {
    const row = this.stmtSelectGoalStatus.get(projectId, goalId) as unknown as GoalStatusRow | undefined;
    if (!row) return null;
    return {
      projectId: row.project_id,
      goalId: row.goal_id,
      phase: row.phase as import("../contracts/goal-phase.js").GoalPhase,
      previousPhase: row.previous_phase === null ? null : (row.previous_phase as import("../contracts/goal-phase.js").GoalPhase),
      planRef: row.plan_ref === null ? null : (JSON.parse(row.plan_ref) as import("../contracts/plan.js").PlanRevisionRef),
      reasonCodes: JSON.parse(row.reason_codes) as import("../contracts/goal-phase.js").GoalPhaseReasonCode[],
      explanation: JSON.parse(row.explanation) as import("../contracts/goal-phase.js").GoalCompletionExplanation,
      sideEffectReconciliation: JSON.parse(row.side_effect_reconciliation) as import("../contracts/goal-phase.js").GoalSideEffectReconciliation,
      aggregateRevision: row.aggregate_revision,
      sourceCursor: row.source_cursor as import("../contracts/command-event.js").CommitCursor,
      updatedAt: row.updated_at,
    };
  }

  private readGoalTimelineRows(projectId: string, goalId: string): import("../contracts/goal-phase-view.js").GoalTimelineEntry[] | null {
    const rows = this.stmtSelectGoalTimeline.all(projectId, goalId) as unknown as GoalTimelineRow[];
    if (rows.length === 0) return null;
    return rows.map((row) => ({
      phase: row.phase as import("../contracts/goal-phase.js").GoalPhase,
      previousPhase: row.previous_phase === null ? null : (row.previous_phase as import("../contracts/goal-phase.js").GoalPhase),
      reasonCodes: JSON.parse(row.reason_codes) as import("../contracts/goal-phase.js").GoalPhaseReasonCode[],
      explanation: JSON.parse(row.explanation) as import("../contracts/goal-phase.js").GoalCompletionExplanation,
      aggregateRevision: row.aggregate_revision,
      reducedAt: row.reduced_at,
      eventId: row.event_id,
      sourceCursor: row.source_cursor as import("../contracts/command-event.js").CommitCursor,
    }));
  }

  /** GoalPhaseUpdated@1 -> upsert the (projectId, goalId) status row AND append
   * one timeline entry in arrival order (rebuilt ONLY from the event payload). */
  private applyGoalPhaseUpdated(event: import("../contracts/goal-phase.js").GoalPhaseUpdatedEvent, cursor: import("../contracts/command-event.js").CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    this.stmtUpsertGoalStatus.run(
      projectId,
      goalId,
      event.payload.phase,
      event.payload.previousPhase,
      event.payload.planRef === null ? null : JSON.stringify(event.payload.planRef),
      JSON.stringify(event.payload.reasonCodes),
      JSON.stringify(event.payload.explanation),
      JSON.stringify(event.payload.sideEffectReconciliation),
      event.aggregateRevision,
      event.payload.reducedAt,
      cursor,
    );
    const nextSeq = this.nextGoalTimelineSeq(projectId, goalId);
    this.stmtInsertGoalTimeline.run(
      projectId,
      goalId,
      nextSeq,
      event.payload.phase,
      event.payload.previousPhase,
      JSON.stringify(event.payload.reasonCodes),
      JSON.stringify(event.payload.explanation),
      event.aggregateRevision,
      event.payload.reducedAt,
      event.eventId,
      cursor,
    );
  }

  private nextGoalTimelineSeq(projectId: string, goalId: string): number {
    const row = this.stmtSelectMaxGoalTimelineSeq.get(projectId, goalId) as unknown as { max_seq: number | null } | undefined;
    return (row?.max_seq ?? 0) + 1;
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

  /** Get or create the per-task handoff provenance row (full-scope key). */
  private ensureHandoffProvenanceRow(
    projectId: string,
    goalId: string,
    taskId: string,
    cursor: CommitCursor,
  ): HandoffProvenanceView {
    const existing = this.readHandoffProvenanceRow(projectId, goalId, taskId);
    if (existing) return existing;
    return {
      projectId,
      goalId,
      taskId,
      packetRefs: [],
      replacementRefs: [],
      taskRevision: null,
      planRef: null,
      timeline: [],
      outcomeUnknownPreserved: true,
      sourceCursor: cursor,
    };
  }

  /** HandoffRecorded@1 -> append a packet_recorded entry + packetRef and snapshot
   * the row's taskRevision / planRef (the row is created here if absent — it
   * carries ONLY event fields, never depends on a Plan event). */
  private applyHandoffRecorded(event: HandoffRecordedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const taskId = event.payload.taskId;
    const packet = event.payload.packet;
    const row = this.ensureHandoffProvenanceRow(projectId, goalId, taskId, cursor);

    row.timeline.push({
      kind: "packet_recorded",
      packetRef: handoffPacketRefFor(projectId, goalId, taskId, packet.packetId),
      packetId: packet.packetId,
      sourceRunRef: { ...packet.source.runRef },
      sourceAttemptRef: { ...packet.source.attemptRef },
      predecessorPacketRef: packet.predecessorPacketRef === null ? null : { ...packet.predecessorPacketRef },
      taskRevision: packet.taskRevision,
      workspaceSnapshot: { ...packet.workspaceSnapshot },
      recordedAt: event.payload.recordedAt,
      sourceCursor: cursor,
    });
    row.packetRefs.push(handoffPacketRefFor(projectId, goalId, taskId, packet.packetId));
    row.taskRevision = packet.taskRevision;
    row.planRef = { ...packet.planRef };
    row.sourceCursor = cursor;
    this.writeHandoffProvenanceRow(row);
  }

  /** ReplacementClaimed@1 -> append a replacement_claimed entry + replacementRef. */
  private applyReplacementClaimed(event: ReplacementClaimedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const taskId = event.payload.taskId;
    const row = this.ensureHandoffProvenanceRow(projectId, goalId, taskId, cursor);

    row.timeline.push({
      kind: "replacement_claimed",
      packetRef: { ...event.payload.packetRef },
      replacementRef: { ...event.payload.replacementRef },
      priorRunRef: { ...event.payload.priorRunRef },
      priorAttemptRef: { ...event.payload.priorAttemptRef },
      runRef: { ...event.payload.runRef },
      attemptRef: { ...event.payload.attemptRef },
      reason: event.payload.reason,
      claimedAt: event.payload.claimedAt,
      sourceCursor: cursor,
    });
    row.replacementRefs.push({ ...event.payload.replacementRef });
    row.sourceCursor = cursor;
    this.writeHandoffProvenanceRow(row);
  }

  // ------------------------------------------------------------------ //
  // P1-07 lease / integration / patch projection handlers (SQLite)       //
  // ------------------------------------------------------------------ //

  private ensureWorkspaceLeaseRow(
    projectId: string,
    workspaceId: string,
    cursor: CommitCursor,
    occurredAt: string,
  ): WorkspaceLeaseView {
    const existing = this.readWorkspaceLeaseRow(projectId, workspaceId);
    if (existing) return existing;
    const row: WorkspaceLeaseView = {
      projectId,
      workspaceId,
      writeLease: null,
      readLeases: [],
      sourceCursor: cursor,
      updatedAt: occurredAt,
    };
    this.writeWorkspaceLeaseRow(row);
    return row;
  }

  /** The grant events carry runRef + attemptRef only; the roleBinding lives on
   * the lease snapshot (off the event stream), so the display view carries the
   * stable placeholder binding. Display-only — never judged. */
  private leaseHolderView(holder: { runRef: RunRef; attemptRef: TaskAttemptRef }): WorkspaceLeaseHolderV1 {
    return {
      runRef: { ...holder.runRef },
      attemptRef: { ...holder.attemptRef },
      roleBinding: { ...LEASE_P1_07_PLACEHOLDER_BINDING },
    };
  }

  /** WorkspaceReadLeaseGranted@1 -> append an ACTIVE read lease entry (read-read
   * never conflicts, so a grant is always an append). */
  private applyWorkspaceReadLeaseGranted(event: WorkspaceReadLeaseGrantedEvent, cursor: CommitCursor): void {
    const row = this.ensureWorkspaceLeaseRow(event.projectId, event.workspaceId, cursor, event.occurredAt);
    row.readLeases.push({
      status: "active",
      leaseId: event.payload.leaseId,
      scope: { ...event.payload.scope },
      holder: this.leaseHolderView(event.payload.holder),
      grantedAt: event.occurredAt,
      expiresAt: event.payload.expiresAt,
      releasedAt: null,
    });
    row.sourceCursor = cursor;
    row.updatedAt = event.occurredAt;
    this.writeWorkspaceLeaseRow(row);
  }

  /** WorkspaceReadLeaseReleased@1 -> mark the matching read lease released. */
  private applyWorkspaceReadLeaseReleased(event: WorkspaceReadLeaseReleasedEvent, cursor: CommitCursor): void {
    const row = this.ensureWorkspaceLeaseRow(event.projectId, event.workspaceId, cursor, event.occurredAt);
    const entry = row.readLeases.find((l) => l.leaseId === event.payload.leaseId);
    if (entry) {
      entry.status = "released";
      entry.releasedAt = event.payload.releasedAt;
    }
    row.sourceCursor = cursor;
    row.updatedAt = event.occurredAt;
    this.writeWorkspaceLeaseRow(row);
  }

  /** WorkspaceWriteLeaseGranted@1 -> the workspace's SINGLE write-lease entry. */
  private applyWorkspaceWriteLeaseGranted(event: WorkspaceWriteLeaseGrantedEvent, cursor: CommitCursor): void {
    const row = this.ensureWorkspaceLeaseRow(event.projectId, event.workspaceId, cursor, event.occurredAt);
    row.writeLease = {
      status: "active",
      leaseId: event.payload.leaseId,
      scope: { ...event.payload.scope },
      holder: this.leaseHolderView(event.payload.holder),
      grantedAt: event.occurredAt,
      expiresAt: event.payload.expiresAt,
      releasedAt: null,
      releasedBy: null,
      releasedVia: null,
      patches: [],
      postWriteWorkspaceRevision: null,
    };
    row.sourceCursor = cursor;
    row.updatedAt = event.occurredAt;
    this.writeWorkspaceLeaseRow(row);
  }

  /** WorkspaceWriteLeaseReleased@1 -> release the workspace write lease and seed
   * the patch-view fallback revision (patch-record path only). */
  private applyWorkspaceWriteLeaseReleased(event: WorkspaceWriteLeaseReleasedEvent, cursor: CommitCursor): void {
    const row = this.ensureWorkspaceLeaseRow(event.projectId, event.workspaceId, cursor, event.occurredAt);
    if (row.writeLease && row.writeLease.leaseId === event.payload.leaseId) {
      row.writeLease.status = "released";
      row.writeLease.releasedAt = event.payload.releasedAt;
      row.writeLease.releasedBy = event.payload.releasedBy;
      row.writeLease.releasedVia = event.payload.releasedVia;
      if (event.payload.postWriteWorkspaceRevision !== null) {
        row.writeLease.postWriteWorkspaceRevision = event.payload.postWriteWorkspaceRevision;
      }
    }
    row.sourceCursor = cursor;
    row.updatedAt = event.occurredAt;
    this.writeWorkspaceLeaseRow(row);

    if (event.payload.postWriteWorkspaceRevision !== null) {
      const patchRow = this.ensureWorkspacePatchRow(event.projectId, event.workspaceId, cursor, event.occurredAt);
      patchRow.workspaceRevision = event.payload.postWriteWorkspaceRevision;
      patchRow.sourceCursor = cursor;
      patchRow.updatedAt = event.occurredAt;
      this.writeWorkspacePatchRow(patchRow);
    }
  }

  /** IntegrationJoined@1 -> append one join record (arrival order) and record the
   * FIRST resultId per conflictKey (authority — display only, no merge). */
  private applyIntegrationJoined(event: IntegrationJoinedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const taskId = event.payload.taskId;
    const row = this.ensureIntegrationConflictRow(projectId, goalId, taskId, cursor, event.occurredAt);
    const record: IntegrationConflictViewRecord = {
      resultId: event.payload.resultId,
      runRef: { ...event.payload.runRef },
      workspaceRevision: event.payload.workspaceRevision,
      inputs: event.payload.inputs.map((i) => ({ ...i })),
      conflicts: event.payload.conflicts.map((c) => ({ ...c })),
      gaps: event.payload.gaps.map((g) => ({ ...g })),
      explanation: event.payload.explanation,
      escalate: event.payload.escalate,
      generatedAt: event.payload.generatedAt,
      sourceCursor: cursor,
    };
    row.records.push(record);
    for (const conflict of record.conflicts) {
      if (!Object.prototype.hasOwnProperty.call(row.authoritativeKeys, conflict.conflictKey)) {
        row.authoritativeKeys[conflict.conflictKey] = record.resultId;
      }
    }
    row.sourceCursor = cursor;
    row.updatedAt = event.occurredAt;
    this.writeIntegrationConflictRow(row);
  }

  /** PatchRecorded@1 -> append a patch entry + advance the canonical workspace
   * revision (last event wins) AND record the patch ref on the write lease. */
  private applyPatchRecorded(event: PatchRecordedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const patchRow = this.ensureWorkspacePatchRow(projectId, workspaceId, cursor, event.occurredAt);
    patchRow.patches.push({
      patchId: event.payload.patchId,
      goalId: event.payload.goalId,
      taskId: event.payload.taskId,
      runRef: { ...event.payload.runRef },
      kind: event.payload.kind,
      title: event.payload.title,
      changedPaths: [...event.payload.changedPaths],
      beforeWorkspaceRevision: event.payload.beforeWorkspaceRevision,
      afterWorkspaceRevision: event.payload.afterWorkspaceRevision,
      checkResults: event.payload.checkResults.map((c) => ({ ...c })),
      usedInputEvidenceRefs: event.payload.usedInputEvidenceRefs.map((r) => ({ ...r })),
      recordedAt: event.occurredAt,
      sourceCursor: cursor,
    } satisfies WorkspacePatchViewEntry);
    patchRow.workspaceRevision = event.payload.afterWorkspaceRevision;
    patchRow.sourceCursor = cursor;
    patchRow.updatedAt = event.occurredAt;
    this.writeWorkspacePatchRow(patchRow);

    const leaseRow = this.workspaceLeaseRowForLease(projectId, workspaceId, event.payload.patchId, cursor, event.occurredAt);
    if (leaseRow !== null) {
      this.writeWorkspaceLeaseRow(leaseRow);
    }
  }

  /** Read the workspace's single write-lease row and append the patch ref (the
   * patch-record path releases it via the following event). Returns null when no
   * lease row is present. */
  private workspaceLeaseRowForLease(
    projectId: string,
    workspaceId: string,
    patchId: string,
    cursor: CommitCursor,
    occurredAt: string,
  ): WorkspaceLeaseView | null {
    const leaseRow = this.readWorkspaceLeaseRow(projectId, workspaceId);
    if (!leaseRow || !leaseRow.writeLease) return null;
    leaseRow.writeLease.patches.push(patchRecordRefFor(projectId, patchId));
    leaseRow.sourceCursor = cursor;
    leaseRow.updatedAt = occurredAt;
    return leaseRow;
  }

  private ensureWorkspacePatchRow(
    projectId: string,
    workspaceId: string,
    cursor: CommitCursor,
    occurredAt: string,
  ): WorkspacePatchView {
    const existing = this.readWorkspacePatchRow(projectId, workspaceId);
    if (existing) return existing;
    const row: WorkspacePatchView = {
      projectId,
      workspaceId,
      workspaceRevision: 1,
      patches: [],
      sourceCursor: cursor,
      updatedAt: occurredAt,
    };
    this.writeWorkspacePatchRow(row);
    return row;
  }

  private ensureIntegrationConflictRow(
    projectId: string,
    goalId: string,
    taskId: string,
    cursor: CommitCursor,
    occurredAt: string,
  ): IntegrationConflictView {
    const existing = this.readIntegrationConflictRow(projectId, goalId, taskId);
    if (existing) return existing;
    const row: IntegrationConflictView = {
      projectId,
      goalId,
      taskId,
      records: [],
      authoritativeKeys: {},
      sourceCursor: cursor,
      updatedAt: occurredAt,
    };
    this.writeIntegrationConflictRow(row);
    return row;
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
      eventType === "TaskReductionUpdated" ||
      eventType === "GoalPhaseUpdated" ||
      eventType === "HandoffRecorded" ||
      eventType === "ReplacementClaimed" ||
      eventType === "WorkspaceReadLeaseGranted" ||
      eventType === "WorkspaceReadLeaseReleased" ||
      eventType === "WorkspaceWriteLeaseGranted" ||
      eventType === "WorkspaceWriteLeaseReleased" ||
      eventType === "IntegrationJoined" ||
      eventType === "PatchRecorded"
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
    } else if (event.eventType === "GoalPhaseUpdated") {
      this.applyGoalPhaseUpdated(event, cursor);
    } else if (event.eventType === "HandoffRecorded") {
      this.applyHandoffRecorded(event, cursor);
    } else if (event.eventType === "ReplacementClaimed") {
      this.applyReplacementClaimed(event, cursor);
    } else if (event.eventType === "WorkspaceReadLeaseGranted") {
      this.applyWorkspaceReadLeaseGranted(event, cursor);
    } else if (event.eventType === "WorkspaceReadLeaseReleased") {
      this.applyWorkspaceReadLeaseReleased(event, cursor);
    } else if (event.eventType === "WorkspaceWriteLeaseGranted") {
      this.applyWorkspaceWriteLeaseGranted(event, cursor);
    } else if (event.eventType === "WorkspaceWriteLeaseReleased") {
      this.applyWorkspaceWriteLeaseReleased(event, cursor);
    } else if (event.eventType === "IntegrationJoined") {
      this.applyIntegrationJoined(event, cursor);
    } else if (event.eventType === "PatchRecorded") {
      this.applyPatchRecorded(event, cursor);
    }
    // P1-08 console projections consume the SAME committed events (no new
    // DomainEvent). The two lane hooks are no-ops until their lanes land.
    this.applyP108Console(event, cursor);
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

    // P1-06: the SAME EvidenceAdmitted event also feeds the display-only
    // provenance timeline (evidence_admitted entry). The verification projection
    // above is unchanged; this only appends to the handoff provenance row.
    const provRow = this.ensureHandoffProvenanceRow(projectId, goalId, taskId, cursor);
    provRow.timeline.push({
      kind: "evidence_admitted",
      evidenceRef: {
        aggregateType: "Evidence",
        projectId,
        evidenceId: event.payload.evidence.evidenceId,
      },
      evidenceId: event.payload.evidence.evidenceId,
      outcome: event.payload.evidence.outcome,
      evidenceKind: event.payload.evidence.kind,
      sourceRunRef: event.payload.evidence.source.runRef,
      planRef: event.payload.evidence.anchor.planRef,
      planRevision: event.payload.evidence.anchor.planRevision,
      admittedAt: event.payload.admittedAt,
      sourceCursor: cursor,
    });
    provRow.sourceCursor = cursor;
    this.writeHandoffProvenanceRow(provRow);
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

  // ------------------------------------------------------------------ //
  // P1-08 console query surface + projection hooks (SHARED BASELINE).   //
  // The six console queries are FROZEN in src/contracts/console-views   //
  // (first consumer); this baseline carries the JSON row helpers + the  //
  // two lane hooks as no-ops. Lane A fills consolePortfolio/            //
  // consoleSummary; Lane B fills consolePlanMatrix/consoleActiveAgents/ //
  // consoleTaskEvidence/consoleTimeline. isHandledEventType stays       //
  // unchanged — no new DomainEvent, all types already handled.          //
  // ------------------------------------------------------------------ //

  private static readonly P108_TABLES = {
    portfolio: "console_portfolio",
    summary: "console_summary",
    matrix: "console_matrix",
    agent: "console_agent",
    evidence: "console_evidence",
    timeline: "console_timeline",
  } as const;

  private readonly p108SelectCache = new Map<string, StatementSync>();
  private readonly p108UpsertCache = new Map<string, StatementSync>();

  // ---- LANE-A private state (Portfolio + WorkspaceSummary; display only) ----
  /** Lazily-prepared summary (view_json) select/upsert statements. */
  private p108SummarySelectStmt: StatementSync | null = null;
  private p108SummaryUpsertStmt: StatementSync | null = null;
  /** Lazily-prepared per-task / per-goal phase tracking statements. */
  private readonly p108PhaseSelectCache = new Map<string, StatementSync>();
  private readonly p108PhaseUpsertCache = new Map<string, StatementSync>();
  /** Lazily-prepared portfolio full-scan statement. */
  private readonly p108SelectAllCache = new Map<string, StatementSync>();
  /** Idempotent guard: internal phase tables created once per open connection. */
  private p108InternalTablesReady = false;

  private p108Select(table: string): StatementSync {
    let stmt = this.p108SelectCache.get(table);
    if (stmt === undefined) {
      stmt = this.db.prepare(`SELECT entry_json FROM ${table} WHERE scope_key = ?`);
      this.p108SelectCache.set(table, stmt);
    }
    return stmt;
  }

  private p108Upsert(table: string): StatementSync {
    let stmt = this.p108UpsertCache.get(table);
    if (stmt === undefined) {
      stmt = this.db.prepare(`INSERT INTO ${table} (scope_key, entry_json, source_cursor) VALUES (?, ?, ?)
        ON CONFLICT(scope_key) DO UPDATE SET entry_json = excluded.entry_json, source_cursor = excluded.source_cursor`);
      this.p108UpsertCache.set(table, stmt);
    }
    return stmt;
  }

  private readP108JsonRow(table: string, scopeKey: string): { json: string; cursor: CommitCursor } | null {
    const row = this.p108Select(table).get(scopeKey) as unknown as
      | { entry_json: string; source_cursor: string }
      | undefined;
    return row ? { json: row.entry_json, cursor: row.source_cursor as CommitCursor } : null;
  }

  private writeP108JsonRow(table: string, scopeKey: string, json: string, cursor: CommitCursor): void {
    this.p108Upsert(table).run(scopeKey, json, cursor);
  }

  /** P1-08 console projection dispatcher: forwards every committed event to
   * the per-lane console projections. NO new event is created here. */
  private applyP108Console(event: DomainEvent, cursor: CommitCursor): void {
    this.applyP108ConsoleLaneA(event, cursor);
    this.applyP108ConsoleLaneB(event, cursor);
  }

  /** P1-08 LANE-A hook (Portfolio + WorkspaceSummary) — rebuilt ONLY from the
   * committed v1 events, in field-for-field parity with the InMemory reference.
   * Portfolio rows come from WorkspaceBootstrapped; summary rows are touched by
   * every workspace-scoped counter event. Per-task / per-goal phase counts are
   * persisted in internal tables so restart replay is exact (upsert rebuild). */
  private applyP108ConsoleLaneA(event: DomainEvent, cursor: CommitCursor): void {
    this.p108EnsureInternalTables();
    if (event.eventType === "WorkspaceBootstrapped") {
      const ev = event as import("../contracts/bootstrap.js").WorkspaceBootstrappedEventV1;
      this.p108ApplyBootstrap(ev, cursor);
    } else if (event.eventType === "GoalCreated") {
      const ev = event as import("../contracts/command-event.js").GoalCreatedEvent;
      this.p108TouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.goalCount += 1;
      });
    } else if (event.eventType === "PlanRevisionAccepted") {
      const ev = event as import("../contracts/plan.js").PlanRevisionAcceptedEvent;
      this.p108TouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.taskCount += ev.payload.planRevision.tasks.length;
        row.planRevisionCount += 1;
      });
    } else if (event.eventType === "TaskClaimed") {
      const ev = event as import("../contracts/dispatch.js").TaskClaimedEvent;
      this.p108TouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.agentRunCount += 1;
      });
    } else if (event.eventType === "EvidenceAdmitted") {
      const ev = event as import("../contracts/evidence.js").EvidenceAdmittedEvent;
      this.p108TouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.evidenceCount += 1;
      });
    } else if (event.eventType === "TaskReductionUpdated") {
      const ev = event as import("../contracts/reduction.js").TaskReductionUpdatedEvent;
      this.p108TouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.taskReductionCount += 1;
        const phase = ev.payload.reduction.phase;
        const key = consoleTaskKey(ev.projectId, ev.workspaceId, ev.payload.goalId, ev.payload.taskId);
        const prev = this.p108ReadPhase("console_task_phase", key);
        if (prev !== null) this.p108DecrementTaskReduction(row, prev);
        this.p108WritePhase("console_task_phase", key, phase);
        this.p108IncrementTaskReduction(row, phase);
      });
    } else if (event.eventType === "GoalPhaseUpdated") {
      const ev = event as import("../contracts/goal-phase.js").GoalPhaseUpdatedEvent;
      this.p108TouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.goalPhaseCount += 1;
        const phase = ev.payload.phase;
        const key = consoleGoalKey(ev.projectId, ev.workspaceId, ev.payload.goalId);
        const prev = this.p108ReadPhase("console_goal_phase", key);
        if (prev !== null) this.p108DecrementGoalPhase(row, prev);
        this.p108WritePhase("console_goal_phase", key, phase);
        this.p108IncrementGoalPhase(row, phase);
      });
    }
    // Every other event type leaves the workspace summary/portfolio rows
    // unchanged (they are not counter rows per the frozen contract).
  }

  /** Create the internal per-task / per-goal phase tracking tables on first use
   * (IF NOT EXISTS — idempotent; persisted in the same read-model file so
   * restart replay reproduces the same phase counts). */
  private p108EnsureInternalTables(): void {
    if (this.p108InternalTablesReady) return;
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS console_task_phase (" +
        "scope_key TEXT PRIMARY KEY, phase TEXT NOT NULL) WITHOUT ROWID;" +
        "CREATE TABLE IF NOT EXISTS console_goal_phase (" +
        "scope_key TEXT PRIMARY KEY, phase TEXT NOT NULL) WITHOUT ROWID;",
    );
    this.p108InternalTablesReady = true;
  }

  private p108PhaseSelect(table: string): StatementSync {
    let stmt = this.p108PhaseSelectCache.get(table);
    if (stmt === undefined) {
      stmt = this.db.prepare("SELECT phase FROM " + table + " WHERE scope_key = ?");
      this.p108PhaseSelectCache.set(table, stmt);
    }
    return stmt;
  }

  private p108PhaseUpsert(table: string): StatementSync {
    let stmt = this.p108PhaseUpsertCache.get(table);
    if (stmt === undefined) {
      stmt = this.db.prepare(
        "INSERT INTO " + table + " (scope_key, phase) VALUES (?, ?) " +
          "ON CONFLICT(scope_key) DO UPDATE SET phase = excluded.phase",
      );
      this.p108PhaseUpsertCache.set(table, stmt);
    }
    return stmt;
  }

  private p108ReadPhase(table: string, scopeKey: string): string | null {
    const row = this.p108PhaseSelect(table).get(scopeKey) as unknown as { phase: string } | undefined;
    return row ? row.phase : null;
  }

  private p108WritePhase(table: string, scopeKey: string, phase: string): void {
    this.p108PhaseUpsert(table).run(scopeKey, phase);
  }

  /** Read the persisted WorkspaceSummaryView (view_json) for a full scope key. */
  private p108ReadSummaryRow(scopeKey: string): import("../contracts/console-views.js").WorkspaceSummaryView | null {
    if (this.p108SummarySelectStmt === null) {
      this.p108SummarySelectStmt = this.db.prepare("SELECT view_json FROM console_summary WHERE scope_key = ?");
    }
    const row = this.p108SummarySelectStmt.get(scopeKey) as unknown as { view_json: string } | undefined;
    return row ? (JSON.parse(row.view_json) as import("../contracts/console-views.js").WorkspaceSummaryView) : null;
  }

  /** Upsert the persisted WorkspaceSummaryView (view_json column of console_summary). */
  private p108WriteSummaryRow(scopeKey: string, json: string, cursor: CommitCursor): void {
    if (this.p108SummaryUpsertStmt === null) {
      this.p108SummaryUpsertStmt = this.db.prepare(
        "INSERT INTO console_summary (scope_key, view_json, source_cursor) VALUES (?, ?, ?) " +
          "ON CONFLICT(scope_key) DO UPDATE SET view_json = excluded.view_json, source_cursor = excluded.source_cursor",
      );
    }
    this.p108SummaryUpsertStmt.run(scopeKey, json, cursor);
  }

  /** WorkspaceBootstrapped -> create/refresh the (projectId, workspaceId)
   * PortfolioEntry (entry_json of console_portfolio) AND initialize the
   * WorkspaceSummary row (view_json of console_summary). */
  private p108ApplyBootstrap(
    ev: import("../contracts/bootstrap.js").WorkspaceBootstrappedEventV1,
    cursor: CommitCursor,
  ): void {
    const key = consoleWorkspaceKey(ev.projectId, ev.workspaceId);
    const sourceDigest = ev.payload.sourceDigest;
    const bootstrappedAt = ev.occurredAt;
    const entry: import("../contracts/console-views.js").PortfolioEntry = {
      projectId: ev.projectId,
      workspaceId: ev.workspaceId,
      projectRevision: 1,
      workspaceRevision: 1,
      sourceDigest,
      bootstrappedAt,
      sourceCursor: cursor,
      scopeKey: key,
    };
    // Upsert: replaying the same event set reproduces the same row; a genuinely
    // new bootstrap refresh carries updated provenance. The baseline helper
    // writes the portfolio table's entry_json column.
    this.writeP108JsonRow(SqliteReadModelIndex.P108_TABLES.portfolio, key, JSON.stringify(entry), cursor);
    this.p108TouchSummary(ev.projectId, ev.workspaceId, cursor, bootstrappedAt, (row) => {
      row.sourceDigest = sourceDigest;
      row.bootstrappedAt = bootstrappedAt;
    });
  }

  /** Get (or lazily create) the WorkspaceSummary row for the full scope key and
   * apply one counter mutation, then persist the (view_json) row; every counter
   * event refreshes sourceCursor + updatedAt. */
  private p108TouchSummary(
    projectId: string,
    workspaceId: string,
    cursor: CommitCursor,
    occurredAt: string,
    update: (row: import("../contracts/console-views.js").WorkspaceSummaryView) => void,
  ): void {
    const key = consoleWorkspaceKey(projectId, workspaceId);
    let row = this.p108ReadSummaryRow(key);
    if (row === null) {
      row = {
        projectId,
        workspaceId,
        sourceDigest: null,
        bootstrappedAt: null,
        goalCount: 0,
        taskCount: 0,
        planRevisionCount: 0,
        agentRunCount: 0,
        evidenceCount: 0,
        taskReductionCount: 0,
        goalPhaseCount: 0,
        phaseCounts: { taskReduction: {}, goalPhase: {} },
        sourceCursor: cursor,
        updatedAt: occurredAt,
      };
    } else {
      row.sourceCursor = cursor;
      row.updatedAt = occurredAt;
    }
    update(row);
    this.p108WriteSummaryRow(key, JSON.stringify(row), cursor);
  }

  private p108IncrementTaskReduction(
    row: import("../contracts/console-views.js").WorkspaceSummaryView,
    phase: string,
  ): void {
    const map = row.phaseCounts.taskReduction as Record<string, number>;
    map[phase] = (map[phase] ?? 0) + 1;
  }

  private p108DecrementTaskReduction(
    row: import("../contracts/console-views.js").WorkspaceSummaryView,
    phase: string,
  ): void {
    const map = row.phaseCounts.taskReduction as Record<string, number>;
    map[phase] = (map[phase] ?? 0) - 1;
  }

  private p108IncrementGoalPhase(
    row: import("../contracts/console-views.js").WorkspaceSummaryView,
    phase: string,
  ): void {
    const map = row.phaseCounts.goalPhase as Record<string, number>;
    map[phase] = (map[phase] ?? 0) + 1;
  }

  private p108DecrementGoalPhase(
    row: import("../contracts/console-views.js").WorkspaceSummaryView,
    phase: string,
  ): void {
    const map = row.phaseCounts.goalPhase as Record<string, number>;
    map[phase] = (map[phase] ?? 0) - 1;
  }

  /** Full-scope scan of the portfolio table, ordered by scope_key (deterministic). */
  private p108SelectAll(table: string): { scope_key: string; entry_json: string; source_cursor: string }[] {
    let stmt = this.p108SelectAllCache.get(table);
    if (stmt === undefined) {
      stmt = this.db.prepare("SELECT scope_key, entry_json, source_cursor FROM " + table + " ORDER BY scope_key ASC");
      this.p108SelectAllCache.set(table, stmt);
    }
    return stmt.all() as unknown as { scope_key: string; entry_json: string; source_cursor: string }[];
  }

  /** P1-08 LANE-B hook (PlanMatrix + ActiveAgents + TaskEvidence + Timeline) — no-op until lane B lands. */
  private applyP108ConsoleLaneB(_event: DomainEvent, _cursor: CommitCursor): void {
    // replaced by lane B (shared baseline placeholder)
  }

  /** P1-08 LANE-A: portfolio of bootstrapped Project/Workspace scopes
   * (all rows read from console_portfolio, ordered by scope_key). */
  async consolePortfolio(query: PortfolioViewQuery): Promise<PortfolioViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const maxProjects = CONSOLE_PORTFOLIO_MAX_PROJECTS;
    const rows = this.p108SelectAll(SqliteReadModelIndex.P108_TABLES.portfolio);
    const entries = rows
      .map((row) => JSON.parse(row.entry_json) as import("../contracts/console-views.js").PortfolioEntry)
      .slice(0, maxProjects);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (entries.length > 0) {
          return {
            status: "ready",
            portfolio: this.p108BuildPortfolio(entries, observedCursor!),
            observedCursor: observedCursor!,
          };
        }
        return { status: "not_found", observedCursor };
      }
      return { status: "not_ready", requiredCursor: query.atLeastCursor, observedCursor };
    }

    // No atLeastCursor: show the list if any scope bootstrapped, else the
    // freshness-safe not_ready (never not_found — front-run protection).
    if (entries.length > 0) {
      return {
        status: "ready",
        portfolio: this.p108BuildPortfolio(entries, observedCursor!),
        observedCursor: observedCursor!,
      };
    }
    return { status: "not_ready", requiredCursor: observedCursor ?? makeCommitCursor(1), observedCursor };
  }

  /** P1-08 LANE-A: workspace-level summary per full-scope key. */
  async consoleSummary(query: WorkspaceSummaryViewQuery): Promise<WorkspaceSummaryViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.p108ReadSummaryRow(consoleWorkspaceKey(query.projectId, query.workspaceId));

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (row) return { status: "ready", summary: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return { status: "not_ready", requiredCursor: query.atLeastCursor, observedCursor };
    }

    // No atLeastCursor: show the row if present, else the freshness-safe
    // "not_ready" (identical to goal()/planGraph()/taskDetail()).
    if (row) return { status: "ready", summary: row, observedCursor: observedCursor! };
    return { status: "not_ready", requiredCursor: observedCursor ?? makeCommitCursor(1), observedCursor };
  }

  /** Build the bounded PortfolioView (entries in scope-key deterministic order;
   * sourceCursor = the global observed anchor; updatedAt = latest bootstrap). */
  private p108BuildPortfolio(
    entries: import("../contracts/console-views.js").PortfolioEntry[],
    sourceCursor: CommitCursor,
  ): import("../contracts/console-views.js").PortfolioView {
    let updatedAt: string | null = null;
    for (const e of entries) {
      if (updatedAt === null || e.bootstrappedAt > updatedAt) updatedAt = e.bootstrappedAt;
    }
    return {
      entries: entries.map((e) => ({ ...e })),
      sourceCursor,
      updatedAt,
    };
  }

  /** P1-08 LANE-B stub: consolePlanMatrix (frozen signature; lane B implements). */
  async consolePlanMatrix(_query: PlanMatrixViewQuery): Promise<PlanMatrixViewResult> {
    this.assertOpen();
    throw new Error("P1-08 lane stub: consolePlanMatrix not implemented yet");
  }

  /** P1-08 LANE-B stub: consoleActiveAgents (frozen signature; lane B implements). */
  async consoleActiveAgents(_query: ActiveAgentsViewQuery): Promise<ActiveAgentsViewResult> {
    this.assertOpen();
    throw new Error("P1-08 lane stub: consoleActiveAgents not implemented yet");
  }

  /** P1-08 LANE-B stub: consoleTaskEvidence (frozen signature; lane B implements). */
  async consoleTaskEvidence(_query: TaskEvidenceViewQuery): Promise<TaskEvidenceViewResult> {
    this.assertOpen();
    throw new Error("P1-08 lane stub: consoleTaskEvidence not implemented yet");
  }

  /** P1-08 LANE-B stub: consoleTimeline (frozen signature; lane B implements). */
  async consoleTimeline(_query: TimelineViewQuery): Promise<TimelineViewResult> {
    this.assertOpen();
    throw new Error("P1-08 lane stub: consoleTimeline not implemented yet");
  }

}

export function createSqliteReadModelIndex(
  options: SqliteReadModelIndexOptions,
): SqliteReadModelIndex {
  return new SqliteReadModelIndex(options);
}
