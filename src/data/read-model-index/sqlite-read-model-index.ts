import { buildPlanMatrixView, buildPortfolioView, runDisplayStateForEvent, toTaskEvidenceEntry } from './console-projection.js';
import { buildTaskVerificationView, type ProjectedEvidence, type VerificationProjection } from './verification-projection.js';
import { buildSyntheticArchitectureInspection } from './architecture-inspection-projection.js';
import { readModelHandlesEvent } from './handled-event-types.js';
import { projectWorkContext } from './work-context-projection.js';
import { projectCollaborationEvent } from './collaboration-projection.js';
import { projectMaterialAccessEvent } from './material-access-projection.js';
import { projectQueryEvent } from './query-projection.js';
import { projectControlIntentEvent, type ControlIntentProjectionRow } from './control-intent-projection.js';
import { projectPlanChangeDispositions } from './plan-change-projection.js';
import { reviewProjectionChanges, reviewProjectionEventTypes, reviewProjectionFacts } from './reviewer-projection.js';
import { projectBaselineChangeView } from './baseline-change-projection.js';
import type { ReviewProjectionSnapshot } from '../../contracts/read-model.js';
import { completedWorkCursor } from './completed-work-eligibility.js';
import { droppedWorkRefsByTask, sortWorkRefs, taskWorkKey } from './completed-work-merge.js';
// 一个任务只有一个持久工作身份。归并规则是 ControlEngine 的权威规则（唯一正文在
// control/control-engine/work-identity-resolution.ts），这里只消费，不在投影里复制第二份判断。
import { dedupeTaskWorks } from '../../control/control-engine/work-identity-resolution.js';
import { matchesMaterialAccessLookup, type MaterialAccessGrantLookup, type MaterialAccessGrantViewResult, type MaterialAccessGrantRow } from '../../contracts/material-access.js';
/**
 * SQLite ReadModelIndex adapter — persistent projections for the platform's read-only views.
 *
 * Public entry. The exported surface
 * below is versioned; implementations must not
 * change the exported signatures/options.
 *
 * Driver decision: Node 24 built-in node:sqlite (DatabaseSync) — zero runtime
 * dependencies. Projection storage, checkpoint, dedupe and all view indexes
 * live in one SQLite database file; the index is a rebuildable EVENT
 * PROJECTION (canonical Goal state comes from the StateLedger snapshots,
 * never from here).
 *
 * Projection readers primarily consume interfaces and contracts. The adapter
 * also reuses ControlEngine's public pure task-identity selection rule, as
 * permitted by the Module dependency graph, instead of copying that rule.
 *
 * In-process semantics are a field-for-field mirror of the InMemory reference
 * (src/data/read-model-index/read-model-index.ts):
 *  - the WHOLE page is validated before anything is applied: cursor gap /
 *    out-of-order / unknown-version stall the entire page via ProjectionStallError
 *    (never partial, never skipped);
 *  - a KNOWN v1 event with no projection handler stalls the whole page via
 *    ProjectionStallError(unsupported_event_type) (all current handlers are registered;
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
import type { EventPage } from "../../contracts/ledger.js";
import type {
  GoalView,
  GoalViewQuery,
  GoalViewResult,
  ProjectionReceipt,
  ReadModelIndex,
} from "../../contracts/goal-view.js";
import type {
  PlanGraphView,
  PlanGraphViewQuery,
  PlanGraphViewResult,
  TaskDetailView,
  TaskDetailViewQuery,
  TaskDetailViewResult,
} from "../../contracts/plan-view.js";
import type {
  ActiveAgentQuery,
  ActiveAgentView,
  ActiveAgentViewResult,
  TaskRunState,
} from "../../contracts/active-agent.js";
import { ProjectionStallError } from "../../contracts/goal-view.js";
import type {
  TaskVerificationViewQuery,
  TaskVerificationViewResult,
  TaskVerificationView,
  EvidenceBindingView,
} from "../../contracts/verification-view.js";
import type {
  EffectivityAnchorV1,
  EvidenceAdmittedEvent,
  EvidenceV1,
} from "../../contracts/evidence.js";
import type { EvidenceApplicability } from "../../contracts/evidence.js";
import type { PolicyExplanationPort } from "../../contracts/policy-explanation.js";
import type { TaskReductionSnapshot, TaskReductionUpdatedEvent } from "../../contracts/reduction.js";
import type { CommitCursor, GoalCreatedEvent } from "../../contracts/command-event.js";
import type { DomainEvent } from "../../contracts/events.js";
import type { PositionedEvent } from "../../contracts/ledger.js";
import {
  compareCommitCursor,
  makeCommitCursor,
  seqOfCommitCursor,
} from "../../contracts/ledger.js";
import { canonicalJson } from "../../contracts/fingerprint.js";
import { continuationRecordRefFor, WORK_CONTEXT_VIEW_MAX_CONTINUATIONS } from "../../contracts/context-continuity.js";
import type { PlanRevisionAcceptedEvent, PlanRevisionRef, PlanRevisionSnapshot } from "../../contracts/plan.js";
import type {
  GoalRevisionSnapshot,
  PlanChangeViewQuery,
  PlanChangeViewResult,
  PlanProposalSnapshot,
  PlanProposalRecordedEvent,
  GoalRevisionRecordedEvent,
  UserDecisionSnapshot,
  UserDecisionRecordedEvent,
  PlanRevisionSupersededEvent,
} from "../../contracts/goal-change.js";
import { planChangeScopeKey } from "../../contracts/goal-change.js";
import type {
  ArchitectureChangeDecisionV1,
  ArchitectureChangeDecisionRef,
  BaselineActivationV1,
  BaselineActivationRef,
  BaselineChangeViewQuery,
  BaselineChangeViewResult,
  CandidateArchitectureBaselineSnapshot,
  CandidateBaselineMaterializedEvent,
  ArchitectureChangeDecisionRecordedEvent,
  MigrationGateRecordedEvent,
  MigrationGateTaskV1,
  MigrationGateTaskRef,
  BaselineActivationRecordedEvent,
} from "../../contracts/baseline-evolution.js";
import {
  isSourceStale,
  candidateRefFor,
  architectureChangeDecisionRefFor,
  migrationGateRefFor,
  baselineActivationRefFor,
} from "../../contracts/baseline-evolution.js";
import type { ArchitectureBaselinePin } from "../../contracts/governance.js";
import type {
  RunEventRecordedEvent,
  RunOutcomeUnknownEvent,
  RunStartedEvent,
  TaskClaimedEvent,
  RunRef,
  TaskAttemptRef,
} from "../../contracts/dispatch.js";
import {
  isTerminalRuntimeEvent,
  runtimeEventTerminalOutcome,
} from "../../contracts/dispatch.js";
import { validateDomainEvent } from '../../contracts/validation/event.js';
import type { HandoffRecordedEvent, ReplacementClaimedEvent } from "../../contracts/handoff.js";
import { handoffPacketRefFor } from "../../contracts/handoff.js";
import type {
  HandoffProvenanceView,
  HandoffProvenanceViewQuery,
  HandoffProvenanceViewResult,
} from "../../contracts/handoff-view.js";
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
} from "../../contracts/workspace-views.js";
import type {
  WorkspaceReadLeaseGrantedEvent,
  WorkspaceReadLeaseReleasedEvent,
  WorkspaceWriteLeaseGrantedEvent,
  WorkspaceWriteLeaseReleasedEvent,
  WorkspaceLeaseHolderV1,
} from "../../contracts/workspace-lease.js";
import type { IntegrationJoinedEvent } from "../../contracts/integration.js";
import { patchRecordRefFor } from "../../contracts/patch.js";
import type { PatchRecordedEvent } from "../../contracts/patch.js";
import { workContextRefFor } from "../../contracts/context-continuity.js";
import { MATERIAL_ACCESS_VIEW_MAX_ROWS } from "../../contracts/material-access.js";
import type { RoleBindingRefV1 } from "../../contracts/dispatch.js";
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
} from "../../contracts/console-views.js";
import {
  consoleWorkspaceKey,
  consoleGoalKey,
  consoleTaskKey,
  CONSOLE_PORTFOLIO_MAX_PROJECTS,
  CONSOLE_ACTIVE_AGENTS_MAX_ROWS,
  CONSOLE_TIMELINE_MAX_ENTRIES,
  CONSOLE_MATRIX_MAX_TASKS,
} from "../../contracts/console-views.js";
import type {
  CoordinationPolicyRevisionSnapshot,
  InitialDesignDecisionSnapshot,
  InitialDesignProposalSnapshot,
  ProjectCoordinationPolicyActiveSnapshot,
  UnifiedStatusViewQuery,
  UnifiedStatusViewResult,
} from "../../contracts/human-role-collaboration.js";

/**
 * Reconstruct a lease view holder: the grant events carry runRef + attemptRef
 * only (the roleBinding lives on the lease snapshot, off the event stream), so
 * the display view carries a stable placeholder binding — display-only, never
 * judged, never replayed as authority.
 */
const LEASE_VIEW_PLACEHOLDER_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1,
  bindingId: "",
  templateId: "",
  templateRevision: "",
  bindingVersion: 1,
  policyRevision: "",
};

export interface SqliteReadModelIndexOptions {
  policyExplanation: PolicyExplanationPort;
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
 * INTEGER, because it carries a PlanRevisionRef object after plan acceptance.
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

CREATE TABLE IF NOT EXISTS work_context_binding (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS work_context_notes (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS work_context_continuations (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS material_access_grant_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS architecture_inspection_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS architecture_finding_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS architecture_brief_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS query_job_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS query_run_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS query_answer_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS control_intent_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS architecture_proposal_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS p111_proposal_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS p111_decision_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS p111_revision_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS p111_plan_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS p114_candidate_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS p114_decision_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS p114_gate_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS p114_activation_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS p115_proposal_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS p115_decision_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS p115_policy_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
  source_cursor TEXT NOT NULL,
  PRIMARY KEY (scope_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS independent_review_projection (ref_key TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS p115_activation_rows (
  scope_key     TEXT NOT NULL,
  entry_json    TEXT NOT NULL,
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

/** Full-scope work-context key: canonicalJson of the complete ref. */
function workContextScopeKey(projectId: string, workspaceId: string, workId: string): string {
  return canonicalJson(workContextRefFor(projectId, workspaceId, workId));
}

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
  /** Work-context detail-view projection: continuation table (write) + combined view selects (read). */
  private readonly stmtSelectWorkContextBinding: StatementSync;
  private readonly stmtSelectWorkContextNotes: StatementSync;
  private readonly stmtSelectWorkContextContinuations: StatementSync;
  private readonly stmtUpsertWorkContextContinuations: StatementSync;

  private readonly policyExplanation: PolicyExplanationPort;

  constructor(options: SqliteReadModelIndexOptions) {
    this.policyExplanation = options.policyExplanation;
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
    // Work-context statements: the continuation projection writes its table;
    // read-only statements select binding and notes populated by the overview projection.
    this.stmtSelectWorkContextBinding = this.db.prepare(
      "SELECT entry_json FROM work_context_binding WHERE scope_key = ?",
    );
    this.stmtSelectWorkContextNotes = this.db.prepare(
      "SELECT entry_json FROM work_context_notes WHERE scope_key = ?",
    );
    this.stmtSelectWorkContextContinuations = this.db.prepare(
      "SELECT entry_json FROM work_context_continuations WHERE scope_key = ?",
    );
    this.stmtUpsertWorkContextContinuations = this.db.prepare(
      `INSERT INTO work_context_continuations (scope_key, entry_json, source_cursor)
       VALUES (?, ?, ?)
       ON CONFLICT(scope_key) DO UPDATE SET
         entry_json = excluded.entry_json,
         source_cursor = excluded.source_cursor`,
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

  /** dispatch: active agent view — same opaque-cursor freshness as goal()/planGraph()/taskDetail(). */
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

  /** handoff: display-only handoff provenance timeline (keyed by full-scope
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
  // workspace concurrency views (display-only; persisted across close()/reopen)            //
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

  /** context assembly: goal phase status projection (per (projectId, goalId)). */
  async goalStatus(query: import("../../contracts/goal-phase-view.js").GoalStatusQuery): Promise<import("../../contracts/goal-phase-view.js").GoalStatusViewResult> {
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

  /** context assembly: goal phase timeline projection (per (projectId, goalId)). */
  async goalTimeline(query: import("../../contracts/goal-phase-view.js").GoalTimelineQuery): Promise<import("../../contracts/goal-phase-view.js").GoalTimelineViewResult> {
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

  private readGoalStatusRow(projectId: string, goalId: string): import("../../contracts/goal-phase-view.js").GoalStatusView | null {
    const row = this.stmtSelectGoalStatus.get(projectId, goalId) as unknown as GoalStatusRow | undefined;
    if (!row) return null;
    return {
      projectId: row.project_id,
      goalId: row.goal_id,
      phase: row.phase as import("../../contracts/goal-phase.js").GoalPhase,
      previousPhase: row.previous_phase === null ? null : (row.previous_phase as import("../../contracts/goal-phase.js").GoalPhase),
      planRef: row.plan_ref === null ? null : (JSON.parse(row.plan_ref) as import("../../contracts/plan.js").PlanRevisionRef),
      reasonCodes: JSON.parse(row.reason_codes) as import("../../contracts/goal-phase.js").GoalPhaseReasonCode[],
      explanation: JSON.parse(row.explanation) as import("../../contracts/goal-phase.js").GoalCompletionExplanation,
      sideEffectReconciliation: JSON.parse(row.side_effect_reconciliation) as import("../../contracts/goal-phase.js").GoalSideEffectReconciliation,
      aggregateRevision: row.aggregate_revision,
      sourceCursor: row.source_cursor as import("../../contracts/command-event.js").CommitCursor,
      updatedAt: row.updated_at,
    };
  }

  private readGoalTimelineRows(projectId: string, goalId: string): import("../../contracts/goal-phase-view.js").GoalTimelineEntry[] | null {
    const rows = this.stmtSelectGoalTimeline.all(projectId, goalId) as unknown as GoalTimelineRow[];
    if (rows.length === 0) return null;
    return rows.map((row) => ({
      phase: row.phase as import("../../contracts/goal-phase.js").GoalPhase,
      previousPhase: row.previous_phase === null ? null : (row.previous_phase as import("../../contracts/goal-phase.js").GoalPhase),
      reasonCodes: JSON.parse(row.reason_codes) as import("../../contracts/goal-phase.js").GoalPhaseReasonCode[],
      explanation: JSON.parse(row.explanation) as import("../../contracts/goal-phase.js").GoalCompletionExplanation,
      aggregateRevision: row.aggregate_revision,
      reducedAt: row.reduced_at,
      eventId: row.event_id,
      sourceCursor: row.source_cursor as import("../../contracts/command-event.js").CommitCursor,
    }));
  }

  /** GoalPhaseUpdated@1 -> upsert the (projectId, goalId) status row AND append
   * one timeline entry in arrival order (rebuilt ONLY from the event payload). */
  private applyGoalPhaseUpdated(event: import("../../contracts/goal-phase.js").GoalPhaseUpdatedEvent, cursor: import("../../contracts/command-event.js").CommitCursor): void {
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
  // dispatch run projection handlers (mirror of the InMemory fold)          //
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
   * the Run AND the Attempt. NEVER touches TaskDetail.phase (satisfaction is verification). */
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
  private applyExecutionRetry(event: import('../../contracts/dispatch.js').ExecutionRetryScheduledEvent, cursor: CommitCursor): void {
    const row = this.readActiveAgentByRun(event.projectId, event.aggregateId);
    if (!row) return;
    const updated: ActiveAgentView = { ...row, sourceCursor: cursor,
      run: { ...row.run, status: 'starting', outcome: null, startedAt: null, endedAt: null, sourceCursor: cursor },
      attempt: { ...row.attempt, status: 'claimed', endOutcome: null, startedAt: null, endedAt: null, sourceCursor: cursor } };
    this.writeActiveAgent(updated);
    this.syncTaskDetailRun(updated.projectId, updated.goalId, updated.taskId, taskRunStateFrom(updated), cursor);
  }

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
   * plan fields are NEVER modified here (satisfaction is verification). */
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
  // workspace concurrency lease / integration / patch projection handlers (SQLite)       //
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
      roleBinding: { ...LEASE_VIEW_PLACEHOLDER_BINDING },
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

  /** Event types currently handled by this projection. */
  private reviewRecords(): ReviewProjectionSnapshot[] {
    return (this.db.prepare('SELECT snapshot_json FROM independent_review_projection').all() as Array<{snapshot_json:string}>).map(r => JSON.parse(r.snapshot_json) as ReviewProjectionSnapshot);
  }
  async reviewWork(ref: import('../../contracts/reviewer-work.js').ReviewWorkRef) {
    const facts = reviewProjectionFacts(this.reviewRecords()), work = facts.works.find(w => canonicalJson(w.ref) === canonicalJson(ref));
    return work ? { work, result: facts.results.find(r => canonicalJson(r.workRef) === canonicalJson(ref)) ?? null, run: facts.runs.find(r => canonicalJson(r.ref) === canonicalJson(work.reviewerRunRef)) ?? null } : null;
  }
  private isHandledEventType(eventType: string): boolean {
    return readModelHandlesEvent(eventType);
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

  /** Dispatch a validated event to its projection handler. */
  private applyEvent(event: DomainEvent, cursor: CommitCursor): void {
    for (const snapshot of reviewProjectionChanges(event, this.reviewRecords())) this.db.prepare('INSERT INTO independent_review_projection(ref_key,snapshot_json) VALUES(?,?) ON CONFLICT(ref_key) DO UPDATE SET snapshot_json=excluded.snapshot_json').run(canonicalJson(snapshot.ref), JSON.stringify(snapshot));
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
    } else if (event.eventType === 'ExecutionRetryScheduled') {
        this.applyExecutionRetry(event, cursor);
    } else if (event.eventType === 'RunReconciled') {
        const proof = event.payload.run.reconciliation?.observation;
        if (proof?.kind === 'runtime_terminal') this.applyRunEventRecorded({ ...event, eventType: 'RunEventRecorded',
          payload: { taskId: event.payload.run.task.taskId, runtimeEvent: proof.event } }, cursor);
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
    // Console projections consume the SAME committed events (no new
    // DomainEvent). Each handler below owns one current projection concern.
    this.applyConsoleEvent(event, cursor);
    // Work-context projections. Handler + isHandledEventType land in the
    // same projection change; unknown events stop advance().
    // Material-access grants (one immutable row per grant).
    this.applyMaterialAccessEvent(event, cursor);
    this.applyWorkContext(event, cursor);
    // Architecture-inspection projections.
    this.applyArchitectureInspectionEvent(event, cursor);
    this.applyControlIntentEvent(event, cursor);
    this.applyQueryEvent(event, cursor);

    // Plan-change projections (overview projection proposal/decision; detail-view projection revision/plan).
    this.applyPlanChangeEvent(event, cursor);

    // Architecture-evolution + Baseline-evolution events (no/limited display projection; registered handled).
    this.applyArchitectureEvolutionEvent(event, cursor);
    this.applyBaselineEvolutionEvent(event, cursor);
    // Collaboration initial-design/coordination-policy events.
    this.applyCollaborationEvent(event, cursor);
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
      // dispatch: run-state projection (null until a TaskClaimed event for this task).
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

    // verification: retain the accepted plan snapshot (tasks + obligations) so the
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
  // Verification projection handlers                               //
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

    // handoff: the SAME EvidenceAdmitted event also feeds the display-only
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

  /** verification: task-detail verification view (versioned query entry).
   * The view is rebuilt ONLY from events: applicability is recomputed at query
   * time through Control's read-only policy explanation against the projected
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

  /** Combine storage-specific reads with the shared verification interpretation. */
  private buildVerificationView(row: VerificationProjection): TaskVerificationView {
    return buildTaskVerificationView({
      row,
      planSnapshot: this.readPlanSnapshot(row.projectId, row.goalId),
      policyExplanation: this.policyExplanation,
      review: reviewProjectionFacts(this.reviewRecords()),
    });
  }

  // Console query surface and SQLite projection storage. Pure view
  // calculations live in console-projection.ts; row reads, writes and indexes
  // remain here so SQLite does not need to materialize the full read model.
  // ------------------------------------------------------------------ //

  private static readonly CONSOLE_TABLES = {
    portfolio: "console_portfolio",
    summary: "console_summary",
    matrix: "console_matrix",
    agent: "console_agent",
    evidence: "console_evidence",
    timeline: "console_timeline",
  } as const;

  private readonly consoleSelectCache = new Map<string, StatementSync>();
  private readonly consoleUpsertCache = new Map<string, StatementSync>();

  // ---- overview projection private state (Portfolio + WorkspaceSummary; display only) ----
  /** Lazily-prepared summary (view_json) select/upsert statements. */
  private consoleSummarySelectStmt: StatementSync | null = null;
  private consoleSummaryUpsertStmt: StatementSync | null = null;
  /** Lazily-prepared per-task / per-goal phase tracking statements. */
  private readonly consolePhaseSelectCache = new Map<string, StatementSync>();
  private readonly consolePhaseUpsertCache = new Map<string, StatementSync>();
  /** Lazily-prepared portfolio full-scan statement. */
  private readonly consoleSelectAllCache = new Map<string, StatementSync>();
  /** Idempotent guard: internal phase tables created once per open connection. */
  private consoleInternalTablesReady = false;

  private consoleSelect(table: string): StatementSync {
    let stmt = this.consoleSelectCache.get(table);
    if (stmt === undefined) {
      stmt = this.db.prepare(`SELECT entry_json FROM ${table} WHERE scope_key = ?`);
      this.consoleSelectCache.set(table, stmt);
    }
    return stmt;
  }

  private consoleUpsert(table: string): StatementSync {
    let stmt = this.consoleUpsertCache.get(table);
    if (stmt === undefined) {
      stmt = this.db.prepare(`INSERT INTO ${table} (scope_key, entry_json, source_cursor) VALUES (?, ?, ?)
        ON CONFLICT(scope_key) DO UPDATE SET entry_json = excluded.entry_json, source_cursor = excluded.source_cursor`);
      this.consoleUpsertCache.set(table, stmt);
    }
    return stmt;
  }

  private readJsonProjectionRow(table: string, scopeKey: string): { json: string; cursor: CommitCursor } | null {
    const row = this.consoleSelect(table).get(scopeKey) as unknown as
      | { entry_json: string; source_cursor: string }
      | undefined;
    return row ? { json: row.entry_json, cursor: row.source_cursor as CommitCursor } : null;
  }

  private writeJsonProjectionRow(table: string, scopeKey: string, json: string, cursor: CommitCursor): void {
    this.consoleUpsert(table).run(scopeKey, json, cursor);
  }

  /** Console projection dispatcher: forwards every committed event to
   * the console overview and detail-view projections. NO new event is created here. */
  private applyConsoleEvent(event: DomainEvent, cursor: CommitCursor): void {
    this.applyConsoleOverview(event, cursor);
    this.applyConsoleDetails(event, cursor);
  }

  // ------------------------------------------------------------------ //
  // Material-access grants                                       //
  // ------------------------------------------------------------------ //

  private applyMaterialAccessEvent(event: DomainEvent, cursor: CommitCursor): void {
    const change = projectMaterialAccessEvent(event, cursor);
    if (!change) return;
    this.writeJsonProjectionRow("material_access_grant_rows", change.key, JSON.stringify(change.row), cursor);
  }

  /** Material-access grant view — same shape/semantics as the InMemory index. */
  async materialAccessGrants(query: import("../../contracts/material-access.js").MaterialAccessGrantViewQuery): Promise<import("../../contracts/material-access.js").MaterialAccessGrantViewResult> {
    const observedCursor = this.readCheckpoint();
    if (observedCursor === null) return { status: "not_ready", observedCursor: null };
    const limit = Math.min(query.limit ?? MATERIAL_ACCESS_VIEW_MAX_ROWS, MATERIAL_ACCESS_VIEW_MAX_ROWS);
    const stmt = this.db.prepare("SELECT entry_json FROM material_access_grant_rows ORDER BY source_cursor");
    const rows = (stmt.all() as { entry_json: string }[]).map((r) => JSON.parse(r.entry_json) as import("../../contracts/material-access.js").MaterialAccessGrantRow);
    const grants = rows.filter((row) =>
      row.ref.projectId === query.projectId &&
      (query.workspaceId === undefined || row.ref.workspaceId === query.workspaceId) &&
      (query.goalId === undefined || row.ref.goalId === query.goalId) &&
      (query.materialDigest === undefined || row.grant.materials.some((m) => m.digest === query.materialDigest)) &&
      (query.readerRunId === undefined || row.grant.reader.runId === query.readerRunId));
    return { status: "ready", grants: grants.slice(-limit), sourceCursor: observedCursor };
  }

  async materialAccessCandidates(query: MaterialAccessGrantLookup): Promise<MaterialAccessGrantViewResult> {
    const sourceCursor = this.readCheckpoint();
    if (sourceCursor === null) return { status: "not_ready", observedCursor: null };
    const grants: MaterialAccessGrantRow[] = [];
    // Stream candidates, retaining only exact matches. No pagination limit may
    // discard an older valid grant before Vault checks authority and basis.
    const rows = this.db.prepare("SELECT entry_json FROM material_access_grant_rows WHERE json_extract(entry_json, '$.grant.reader.projectId') = ? AND json_extract(entry_json, '$.grant.reader.runId') = ? ORDER BY source_cursor").iterate(query.reader.projectId, query.reader.runId);
    for (const raw of rows) {
      const row = JSON.parse(raw['entry_json'] as string) as MaterialAccessGrantRow;
      if (!row.revocation && matchesMaterialAccessLookup(row.grant, query)) grants.push(row);
    }
    return { status: "ready", grants, sourceCursor };
  }
  private applyWorkContext(event: DomainEvent, cursor: CommitCursor): void {
    const change = projectWorkContext(event, cursor, key => {
      const row = this.readJsonProjectionRow('work_context_binding', key);
      return row === null ? undefined : JSON.parse(row.json) as import('../../contracts/context-continuity.js').WorkContextBindingSnapshot;
    });
    if (!change) return;
    if (change.kind === 'binding') {
      this.writeJsonProjectionRow('work_context_binding', change.key, JSON.stringify(change.snapshot), cursor);
    } else if (change.kind === 'note') {
      const current = this.readJsonProjectionRow('work_context_notes', change.key);
      const rows = current === null ? [] : JSON.parse(current.json) as import('../../contracts/context-continuity.js').WorkContextNoteRow[];
      rows.push(change.row);
      this.writeJsonProjectionRow('work_context_notes', change.key, JSON.stringify(rows), cursor);
    } else {
      const current = this.stmtSelectWorkContextContinuations.get(change.key) as { entry_json: string } | undefined;
      const rows = current ? JSON.parse(current.entry_json) as import('../../contracts/context-continuity.js').ContinuationRecordSnapshot[] : [];
      rows.push(change.snapshot);
      this.stmtUpsertWorkContextContinuations.run(change.key, JSON.stringify(rows), String(cursor));
    }
  }


  /** Architecture-evolution events are intentionally handled without a display row. */
  private applyArchitectureEvolutionEvent(event: DomainEvent, cursor: CommitCursor): void {
    void event;
    void cursor;
  }

  /** Collaboration detail-view projection: fold the 4 initial-design / coordination-policy events into
   * proposal / decision / policy / activation rows. Proposal + decision are
   * workspace-scoped; policy + activation are project-scoped (their events
   * carry workspaceId ""). Row keys follow the versioned projection contract:
   * consoleWorkspaceKey(projectId, workspaceId) + "\u0000" + id. */
  private applyCollaborationEvent(event: DomainEvent, cursor: CommitCursor): void {
    const change = projectCollaborationEvent(event, cursor);
    if (!change) return;
    const table = change.kind === 'proposal' ? 'p115_proposal_rows'
      : change.kind === 'decision' ? 'p115_decision_rows'
      : change.kind === 'policy' ? 'p115_policy_rows'
      : 'p115_activation_rows';
    this.queryUpsertOne(table, change.key, change.snapshot, change.sourceCursor);
  }

  /** Collaboration detail-view projection: unified status view (SQLite; facts-first display; rebuildable
   * from events). Rows are the latest proposal / decision / policy / activation
   * rows for the (projectId, workspaceId) scope (policy + activation gathered by
   * projectId because their events carry workspaceId ""). Every fact carries
   * sourceCursor lineage; the Collaboration view has no multi-version comparison
   * surface, so every fact is marked stale=false per the projection contract. */
  async unifiedStatusView(query: UnifiedStatusViewQuery): Promise<UnifiedStatusViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    if (observedCursor === null) return { status: "not_found" };

    const scopeKey = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const prefix = scopeKey + "\u0000";
    const proposalRows = this.collaborationReadRows("p115_proposal_rows", { prefix }).map((r) => ({ snapshot: r.value as InitialDesignProposalSnapshot, sourceCursor: r.sourceCursor })).sort((a, b) => {
      const t = a.snapshot.recordedAt.localeCompare(b.snapshot.recordedAt);
      return t !== 0 ? t : a.snapshot.ref.designId.localeCompare(b.snapshot.ref.designId);
    });
    const decisionRows = this.collaborationReadRows("p115_decision_rows", { prefix }).map((r) => ({ snapshot: r.value as InitialDesignDecisionSnapshot, sourceCursor: r.sourceCursor })).sort((a, b) => {
      const t = a.snapshot.decision.decidedAt.localeCompare(b.snapshot.decision.decidedAt);
      return t !== 0 ? t : a.snapshot.ref.decisionId.localeCompare(b.snapshot.ref.decisionId);
    });
    const policyRows = this.collaborationReadRows("p115_policy_rows", { projectId: query.projectId }).map((r) => ({ snapshot: r.value as CoordinationPolicyRevisionSnapshot, sourceCursor: r.sourceCursor })).sort((a, b) => {
      const t = a.snapshot.installedAt.localeCompare(b.snapshot.installedAt);
      return t !== 0 ? t : a.snapshot.ref.policyId.localeCompare(b.snapshot.ref.policyId);
    });
    const activationRows = this.collaborationReadRows("p115_activation_rows", { projectId: query.projectId }).map((r) => ({ snapshot: r.value as ProjectCoordinationPolicyActiveSnapshot, sourceCursor: r.sourceCursor })).sort((a, b) => {
      const t = a.snapshot.revision - b.snapshot.revision;
      return t !== 0 ? t : canonicalJson(a.snapshot.ref).localeCompare(canonicalJson(b.snapshot.ref));
    });

    if (
      proposalRows.length === 0 &&
      decisionRows.length === 0 &&
      policyRows.length === 0 &&
      activationRows.length === 0
    ) {
      return { status: "not_found" };
    }

    // Deterministic fact order: rank by row type (proposal -> decision -> policy
    // -> activation), then by refKey. Policy + activation share kind "baseline"
    // (the versioned contract has no dedicated policy/activation fact kind), so the
    // rank keeps them apart and stable for rebuild equivalence.
    type CollaborationRankedFact = {
      rank: number;
      kind: "proposal" | "decision" | "baseline";
      refKey: string;
      display: string;
      revision: unknown;
      stale: boolean;
      sourceCursor: CommitCursor;
    };
    const ranked: CollaborationRankedFact[] = [];
    for (const row of proposalRows) {
      ranked.push({ rank: 0, kind: "proposal", refKey: canonicalJson(row.snapshot.ref), display: "InitialDesignProposal(" + row.snapshot.proposal.designId + ")", revision: row.snapshot.revision, stale: false, sourceCursor: row.sourceCursor });
    }
    for (const row of decisionRows) {
      ranked.push({ rank: 1, kind: "decision", refKey: canonicalJson(row.snapshot.ref), display: "InitialDesignDecision(" + row.snapshot.decision.decisionId + ", " + row.snapshot.decision.outcome + ")", revision: row.snapshot.revision, stale: false, sourceCursor: row.sourceCursor });
    }
    for (const row of policyRows) {
      ranked.push({ rank: 2, kind: "baseline", refKey: canonicalJson(row.snapshot.ref), display: "CoordinationPolicy(" + row.snapshot.policyId + "@r" + row.snapshot.revision + ")", revision: row.snapshot.revision, stale: false, sourceCursor: row.sourceCursor });
    }
    for (const row of activationRows) {
      ranked.push({ rank: 3, kind: "baseline", refKey: canonicalJson(row.snapshot.ref), display: "CoordinationPolicyActive(" + row.snapshot.projectId + " -> " + canonicalJson(row.snapshot.activeRevision) + ")", revision: row.snapshot.revision, stale: false, sourceCursor: row.sourceCursor });
    }
    ranked.sort((a, b) => a.rank - b.rank || a.refKey.localeCompare(b.refKey));
    const facts = ranked.map((r) => ({ kind: r.kind, refKey: r.refKey, display: r.display, revision: r.revision, stale: r.stale, sourceCursor: r.sourceCursor }));

    const decisions = decisionRows.map((row) => ({ decisionId: row.snapshot.decision.decisionId, outcome: row.snapshot.decision.outcome, summary: row.snapshot.decision.summary, stale: false }));

    return {
      status: "ready",
      facts,
      decisions,
      explanations: [{ fact: "design option", explanation: "由 HumanCollaboration 解释", stale: false }],
      freshness: observedCursor,
    };
  }

  /** Collaboration: read rows from a p115_* table, optionally filtered by scope_key
   * prefix (workspace-scoped rows) or by the parsed value's projectId
   * (project-scoped policy/activation rows whose event workspaceId is ""). */
  private collaborationReadRows(table: string, opts: { prefix?: string; projectId?: string }): { value: unknown; sourceCursor: CommitCursor }[] {
    const out: { value: unknown; sourceCursor: CommitCursor }[] = [];
    const stmt = this.db.prepare("SELECT scope_key, entry_json, source_cursor FROM " + table);
    for (const row of stmt.all() as { scope_key: string; entry_json: string; source_cursor: string }[]) {
      if (opts.prefix !== undefined && !row.scope_key.startsWith(opts.prefix)) continue;
      const value = JSON.parse(row.entry_json);
      if (opts.projectId !== undefined) {
        const p = value as { projectId?: string; ref?: { projectId?: string } };
        if (p.projectId !== opts.projectId && p.ref?.projectId !== opts.projectId) continue;
      }
      out.push({ value, sourceCursor: row.source_cursor as CommitCursor });
    }
    return out;
  }

  /** Baseline-evolution hook — fold the 4 events into
   * candidate / decision / gate / activation rows (workspace-scope keys). */
  private applyBaselineEvolutionEvent(event: DomainEvent, cursor: CommitCursor): void {
    if (event.eventType === "CandidateBaselineMaterialized") {
      const ev = event as CandidateBaselineMaterializedEvent;
      const candidate = ev.payload.candidate;
      const ref = candidateRefFor(candidate.projectId, candidate.workspaceId, candidate.candidateId);
      const key = consoleWorkspaceKey(candidate.projectId, candidate.workspaceId) + "\u0000" + candidate.candidateId;
      const snapshot: CandidateArchitectureBaselineSnapshot = { ref, revision: 1, schemaVersion: 1, candidate, materializedAt: ev.payload.materializedAt };
      this.queryUpsertOne("p114_candidate_rows", key, snapshot, cursor);
    } else if (event.eventType === "ArchitectureChangeDecisionRecorded") {
      const ev = event as ArchitectureChangeDecisionRecordedEvent;
      const decision = ev.payload.decision;
      const ref = architectureChangeDecisionRefFor(decision.projectId, decision.workspaceId, decision.decisionId);
      const key = consoleWorkspaceKey(decision.projectId, decision.workspaceId) + "\u0000" + decision.decisionId;
      this.queryUpsertOne("p114_decision_rows", key, { ref, decision }, cursor);
    } else if (event.eventType === "MigrationGateRecorded") {
      const ev = event as MigrationGateRecordedEvent;
      const gate = ev.payload.gate;
      const ref = migrationGateRefFor(gate.projectId, gate.workspaceId, gate.gateId);
      const key = consoleWorkspaceKey(gate.projectId, gate.workspaceId) + "\u0000" + gate.gateId;
      this.queryUpsertOne("p114_gate_rows", key, { ref, gate }, cursor);
    } else if (event.eventType === "BaselineActivationRecorded") {
      const ev = event as BaselineActivationRecordedEvent;
      const activation = ev.payload.activation;
      const ref = baselineActivationRefFor(activation.projectId, activation.workspaceId, activation.activationId);
      const key = consoleWorkspaceKey(activation.projectId, activation.workspaceId) + "\u0000" + activation.activationId;
      this.queryUpsertOne("p114_activation_rows", key, { ref, activation }, cursor);
    }
  }

  /** Baseline change view (display only; rebuildable from events).
   * Assembles the candidate / decision / gate / activation rows for the
   * (projectId, workspaceId) workspace scope plus the purely-computed defaultPin,
   * stale markers and notRebasedPlans. Deterministic: rows are picked by the
   * authoritative activation chain (latest wins), falling back to the latest of
   * each type when no activation has been recorded yet. */
    async baselineChangeView(query: BaselineChangeViewQuery): Promise<BaselineChangeViewResult> {
    const observedCursor = this.readCheckpoint();
    // No projection ever advanced -> we cannot claim freshness for any scope.
    if (observedCursor === null) return { status: "not_found" };

    const scopeKey = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const prefix = scopeKey + "\u0000";
    const candidateRows = (this.planChangeReadScope("p114_candidate_rows", prefix) as CandidateArchitectureBaselineSnapshot[]).sort(
      (a, b) => {
        const t = a.materializedAt.localeCompare(b.materializedAt);
        return t !== 0 ? t : a.ref.candidateId.localeCompare(b.ref.candidateId);
      },
    );
    const decisionRows = (this.planChangeReadScope("p114_decision_rows", prefix) as { ref: ArchitectureChangeDecisionRef; decision: ArchitectureChangeDecisionV1 }[]).sort(
      (a, b) => {
        const t = a.decision.decidedAt.localeCompare(b.decision.decidedAt);
        return t !== 0 ? t : a.ref.decisionId.localeCompare(b.ref.decisionId);
      },
    );
    const gateRows = (this.planChangeReadScope("p114_gate_rows", prefix) as { ref: MigrationGateTaskRef; gate: MigrationGateTaskV1 }[]).sort(
      (a, b) => {
        const t = a.gate.updatedAt.localeCompare(b.gate.updatedAt);
        return t !== 0 ? t : a.ref.gateId.localeCompare(b.ref.gateId);
      },
    );
    const activationRows = (this.planChangeReadScope("p114_activation_rows", prefix) as { ref: BaselineActivationRef; activation: BaselineActivationV1 }[]).sort(
      (a, b) => {
        const t = a.activation.activatedAt.localeCompare(b.activation.activatedAt);
        return t !== 0 ? t : a.ref.activationId.localeCompare(b.ref.activationId);
      },
    );
    if (
      candidateRows.length === 0 &&
      decisionRows.length === 0 &&
      gateRows.length === 0 &&
      activationRows.length === 0
    ) {
      return { status: "not_found" };
    }

    // ReadModel convergence: the explanation derivation is the single shared
    // pure implementation; each adapter still owns its own row fetch, ordering and
    // cursor freshness.
    return projectBaselineChangeView({ candidateRows, decisionRows, gateRows, activationRows, observedCursor });
  }

  /** Architecture-inspection projections (inspection, finding, brief, proposal). */
  private applyArchitectureInspectionEvent(event: DomainEvent, cursor: CommitCursor): void {
    this.applyArchitectureInspectionFacts(event, cursor);
    this.applyArchitectureDecisionArtifacts(event, cursor);
  }

  // overview projection: inspection + finding rows (shared projection contract — same
  // tables the view reads: architecture_inspection_rows / architecture_finding_rows).
  private applyArchitectureInspectionFacts(event: DomainEvent, cursor: CommitCursor): void {
    if (event.eventType === "ArchitectureInspectionRecorded") {
      const ev = event as import("../../contracts/architecture-inspection.js").ArchitectureInspectionRecordedEvent;
      const scopeKey = consoleWorkspaceKey(ev.projectId, ev.workspaceId);
      this.architectureInspectionAppendRow("architecture_inspection_rows", scopeKey, ev.payload.inspection, cursor);
    } else if (event.eventType === "ArchitectureFindingRecorded") {
      const ev = event as import("../../contracts/architecture-inspection.js").ArchitectureFindingRecordedEvent;
      const scopeKey = consoleWorkspaceKey(ev.projectId, ev.workspaceId);
      const snapshot = { ref: { aggregateType: "ArchitectureFinding", projectId: ev.projectId, workspaceId: ev.workspaceId, findingId: ev.payload.finding.findingId }, revision: 1, schemaVersion: 1, finding: ev.payload.finding, recordedAt: ev.payload.recordedAt };
      this.architectureInspectionAppendRow("architecture_finding_rows", scopeKey, snapshot, cursor);
    }
  }

  // detail-view projection: decision brief + candidate proposal rows.
  private applyArchitectureDecisionArtifacts(event: DomainEvent, cursor: CommitCursor): void {
    if (event.eventType === "ArchitectureDecisionBriefRecorded") {
      const ev = event as import("../../contracts/architecture-inspection.js").ArchitectureDecisionBriefRecordedEvent;
      const brief = ev.payload.brief;
      const snapshot = {
        ref: { aggregateType: "ArchitectureDecisionBrief", projectId: brief.projectId, workspaceId: brief.workspaceId, briefId: brief.briefId },
        revision: 1,
        schemaVersion: 1,
        brief,
        recordedAt: ev.payload.recordedAt,
      };
      const key = consoleWorkspaceKey(brief.projectId, brief.workspaceId);
      this.architectureInspectionAppendRow("architecture_brief_rows", key, snapshot, cursor);
    } else if (event.eventType === "ArchitectureCandidateProposalRecorded") {
      const ev = event as import("../../contracts/architecture-inspection.js").ArchitectureCandidateProposalRecordedEvent;
      const proposal = ev.payload.proposal;
      const snapshot = {
        ref: { aggregateType: "ArchitectureCandidateProposal", projectId: proposal.projectId, workspaceId: proposal.workspaceId, proposalId: proposal.proposalId },
        revision: 1,
        schemaVersion: 1,
        proposal,
        recordedAt: ev.payload.recordedAt,
      };
      const key = consoleWorkspaceKey(proposal.projectId, proposal.workspaceId);
      this.architectureInspectionAppendRow("architecture_proposal_rows", key, snapshot, cursor);
    }
  }

  /** detail-view projection: append a snapshot to the scope_key JSON-array row (upsert). */
  private architectureInspectionAppendRow(table: "architecture_inspection_rows" | "architecture_finding_rows" | "architecture_brief_rows" | "architecture_proposal_rows", key: string, entry: unknown, cursor: CommitCursor): void {
    const read = this.consoleDetailPrepare("SELECT entry_json FROM " + table + " WHERE scope_key = ?").get(key) as { entry_json: string } | undefined;
    const rows: unknown[] = read ? (JSON.parse(read.entry_json) as unknown[]) : [];
    rows.push(entry);
    this.consoleDetailPrepare(
      "INSERT INTO " + table + " (scope_key, entry_json, source_cursor) VALUES (?, ?, ?) " +
        "ON CONFLICT(scope_key) DO UPDATE SET entry_json = excluded.entry_json, source_cursor = excluded.source_cursor",
    ).run(key, JSON.stringify(rows), cursor);
  }

  /** detail-view projection: read the scope_key JSON-array row for a Architecture-inspection table
   * (brief/proposal are detail-view projection-written; inspection/finding are overview projection-written
   * and feed the SAME view). */
  private architectureInspectionReadRows(table: "architecture_inspection_rows" | "architecture_finding_rows" | "architecture_brief_rows" | "architecture_proposal_rows", key: string): unknown[] {
    const read = this.consoleDetailPrepare("SELECT entry_json FROM " + table + " WHERE scope_key = ?").get(key) as { entry_json: string } | undefined;
    return read ? (JSON.parse(read.entry_json) as unknown[]) : [];
  }

  /** Work-context view — field-for-field mirror of the InMemory index.
   * overview projection populates the binding/notes tables; detail-view projection populates the
   * continuations table. The composed view is recent-first and bounded by
   * WORK_CONTEXT_VIEW_MAX_CONTINUATIONS; a missing binding -> not_found. */
  async workContext(query: import("../../contracts/context-continuity.js").WorkContextViewQuery): Promise<import("../../contracts/context-continuity.js").WorkContextViewResult> {
    const scopeKey = workContextScopeKey(query.projectId, query.workspaceId, query.workId);
    const bindingRow = this.stmtSelectWorkContextBinding.get(scopeKey) as { entry_json: string } | undefined;
    if (bindingRow === undefined) {
      return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId, workId: query.workId };
    }
    const binding = JSON.parse(bindingRow.entry_json) as import("../../contracts/context-continuity.js").WorkContextBindingSnapshot;
    const notesRow = this.stmtSelectWorkContextNotes.get(scopeKey) as { entry_json: string } | undefined;
    const notes: import("../../contracts/context-continuity.js").WorkContextNoteRow[] = notesRow
      ? (JSON.parse(notesRow.entry_json) as import("../../contracts/context-continuity.js").WorkContextNoteRow[])
      : [];
    const contRow = this.stmtSelectWorkContextContinuations.get(scopeKey) as { entry_json: string } | undefined;
    const raw: import("../../contracts/context-continuity.js").ContinuationRecordSnapshot[] = contRow
      ? (JSON.parse(contRow.entry_json) as import("../../contracts/context-continuity.js").ContinuationRecordSnapshot[])
      : [];
    const continuations = raw.slice(-WORK_CONTEXT_VIEW_MAX_CONTINUATIONS).reverse();
    const observedCursor = this.readCheckpoint();
    return { status: "ready", binding, notes, continuations, sourceCursor: observedCursor! };
  }

  /** Control-intent timeline view — desired state vs safe-point acks. */
  async controlTimelineView(query: import("../../contracts/control-intent.js").ControlTimelineViewQuery): Promise<import("../../contracts/control-intent.js").ControlTimelineViewResult> {
    const observedCursor = this.readCheckpoint();
    if (observedCursor === null) return { status: "not_ready", observedCursor: null };
    const key = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const rows = this.controlIntentReadRows(key);
    if (rows.length === 0) return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId };
    const filtered = rows.filter((r2) => (query.goalId === undefined || r2.scope.goalId === query.goalId) && (query.taskId === undefined || r2.scope.taskId === query.taskId));
    if (filtered.length === 0) return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId };
    return { status: "ready", entries: filtered.map((r2) => ({ intentRef: r2.ref, kind: r2.kind, desiredState: r2.desiredState, status: r2.status, ackCount: r2.ackCount, sourceCursor: r2.cursor })), sourceCursor: filtered[filtered.length - 1]!.cursor };
  }

  private controlIntentReadRows(key: string): ControlIntentProjectionRow[] {
    const stmt = this.db.prepare("SELECT entry_json FROM control_intent_rows WHERE scope_key = ?");
    const row = stmt.get(key) as { entry_json: string } | undefined;
    return row ? (JSON.parse(row.entry_json) as ControlIntentProjectionRow[]) : [];
  }

  private controlIntentWriteRows(key: string, rows: unknown[], cursor: import("../../contracts/command-event.js").CommitCursor): void {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO control_intent_rows (scope_key, entry_json, source_cursor) VALUES (?, ?, ?)");
    stmt.run(key, JSON.stringify(rows), String(cursor));
  }

  private applyControlIntentEvent(event: DomainEvent, cursor: import("../../contracts/command-event.js").CommitCursor): void {
    if (event.eventType !== 'ControlIntentRecorded' && event.eventType !== 'SafePointAcknowledged' && event.eventType !== 'ControlIntentReconciled') return;
    const key = consoleWorkspaceKey(event.projectId, event.workspaceId);
    const change = projectControlIntentEvent(event, cursor, this.controlIntentReadRows(key));
    if (change) this.controlIntentWriteRows(change.key, change.rows, change.sourceCursor);
  }

  /** Query combined: query job view (display only). */
  async queryJobView(query: import("../../contracts/query-job.js").QueryJobViewQuery): Promise<import("../../contracts/query-job.js").QueryJobViewResult> {
    const observedCursor = this.readCheckpoint();
    if (observedCursor === null) return { status: "not_ready", observedCursor: null };
    const jobKey = consoleWorkspaceKey(query.projectId, query.workspaceId) + "\u0000" + query.queryJobId;
    const job = this.queryReadOne("query_job_rows", jobKey) as import("../../contracts/query-job.js").QueryJobV1 | null;
    if (job === null) return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId, queryJobId: query.queryJobId };
    const run = job.runRef === null ? null : (this.queryReadOne("query_run_rows", consoleWorkspaceKey(query.projectId, query.workspaceId) + "\u0000" + job.runRef.runId) as import("../../contracts/query-job.js").QueryRunV1 | null);
    const answers = this.queryReadList("query_answer_rows", jobKey) as import("../../contracts/query-job.js").QueryJobAnswerV1[];
    const currentAnswer = answers.length > 0 ? answers[answers.length - 1]! : null;
    return { status: "ready", job, run, answers, currentAnswer, stale: currentAnswer?.stale ?? false, sourceCursor: observedCursor };
  }

  /** Plan-change detail-view projection: plan change view (display only; rebuildable from events).
   * Assembles proposals / decisions / revisions for the (projectId, workspaceId,
   * goalId) scope plus the purely-computed task dispositions (never judged). */
  async planChangeView(query: PlanChangeViewQuery): Promise<PlanChangeViewResult> {
    const observedCursor = this.readCheckpoint();
    // No projection ever advanced -> we cannot claim freshness for any scope.
    if (observedCursor === null) return { status: "not_found" };

    const key = planChangeScopeKey(query);
    const proposals = this.planChangeReadScope("p111_proposal_rows", key + "\u0000") as PlanProposalSnapshot[];
    const decisions = this.planChangeReadScope("p111_decision_rows", key + "\u0000") as UserDecisionSnapshot[];
    const revisions = this.queryReadList("p111_revision_rows", key) as GoalRevisionSnapshot[];
    if (proposals.length === 0 && decisions.length === 0 && revisions.length === 0) {
      return { status: "not_found" };
    }

    const dispositions = projectPlanChangeDispositions(
      revisions,
      ref => this.queryReadOne("p111_plan_rows", canonicalJson(ref)) as PlanRevisionSnapshot | null,
      input => this.policyExplanation.explainPlanChange(input),
    );
    return {
      status: "ready",
      proposals,
      decisions,
      revisions,
      dispositions,
      freshness: observedCursor,
    };
  }

  /** Plan-change: read every row in a table whose full-scope key is under a prefix. */
  private planChangeReadScope(table: string, prefix: string): unknown[] {
    const out: unknown[] = [];
    const stmt = this.db.prepare("SELECT scope_key, entry_json FROM " + table);
    for (const row of stmt.all() as { scope_key: string; entry_json: string }[]) {
      if (row.scope_key.startsWith(prefix)) out.push(JSON.parse(row.entry_json));
    }
    return out;
  }

  /** Plan-change combined hook: fold plan-change events (proposal/decision +
   * detail-view projection revision/plan; the handler and handled-event membership
   * are maintained together). */
  private applyPlanChangeEvent(event: DomainEvent, cursor: import("../../contracts/command-event.js").CommitCursor): void {
    if (event.eventType === "PlanProposalRecorded") {
      const ev = event as PlanProposalRecordedEvent;
      const proposal = ev.payload.proposal;
      const ref = {
        aggregateType: "PlanProposal" as const,
        projectId: proposal.projectId,
        workspaceId: proposal.workspaceId,
        proposalId: proposal.proposalId,
      };
      const key = planChangeScopeKey({
        projectId: proposal.projectId,
        workspaceId: proposal.workspaceId,
        goalId: proposal.sourceGoalRef.goalId,
      }) + "\u0000" + proposal.proposalId;
      const snapshot: PlanProposalSnapshot = { ref, revision: 1, schemaVersion: 1, proposal, recordedAt: ev.payload.recordedAt };
      this.queryUpsertOne("p111_proposal_rows", key, snapshot, cursor);
    } else if (event.eventType === "UserDecisionRecorded") {
      const ev = event as UserDecisionRecordedEvent;
      const decision = ev.payload.decision;
      const ref = {
        aggregateType: "UserDecision" as const,
        projectId: decision.projectId,
        workspaceId: decision.workspaceId,
        decisionId: decision.decisionId,
      };
      const key = planChangeScopeKey({
        projectId: decision.projectId,
        workspaceId: decision.workspaceId,
        goalId: decision.subject.goalRef.goalId,
      }) + "\u0000" + decision.decisionId;
      const snapshot: UserDecisionSnapshot = { ref, revision: 1, schemaVersion: 1, decision, recordedAt: ev.payload.recordedAt };
      this.queryUpsertOne("p111_decision_rows", key, snapshot, cursor);
    } else if (event.eventType === "GoalRevisionRecorded") {
      const ev = event as GoalRevisionRecordedEvent;
      const change = ev.payload.change;
      const ref = {
        aggregateType: "GoalRevision" as const,
        projectId: ev.projectId,
        workspaceId: ev.workspaceId,
        goalId: change.goalRef.goalId,
        revision: change.revision,
      };
      const key = planChangeScopeKey({ projectId: ev.projectId, workspaceId: ev.workspaceId, goalId: change.goalRef.goalId });
      const snapshot: GoalRevisionSnapshot = { ref, revision: 1, schemaVersion: 1, change, recordedAt: ev.payload.recordedAt };
      const rows = this.queryReadList("p111_revision_rows", key) as GoalRevisionSnapshot[];
      rows.push(snapshot);
      rows.sort((a, b) => a.ref.revision - b.ref.revision);
      this.queryUpsertList("p111_revision_rows", key, rows, cursor);
      // 同一条已提交事实同时决定时间线条目的变更原因（见该方法的注释）。
      this.planChangeAnnotateTimelineChangeReason(ev.projectId, ev.workspaceId, ev, cursor);
    } else if (event.eventType === "PlanRevisionAccepted") {
      const ev = event as PlanRevisionAcceptedEvent;
      const planRevision = ev.payload.planRevision;
      // Idempotent: the same ref always projects the same immutable snapshot.
      this.queryUpsertOne("p111_plan_rows", canonicalJson(planRevision.ref), planRevision, cursor);
    } else if (event.eventType === "PlanRevisionSuperseded") {
      // The same fact is already carried by the GoalRevisionRecorded change;
      // the supersession event itself needs no dedicated row.
      void (event as PlanRevisionSupersededEvent);
    }
  }

  private queryReadOne(table: string, key: string): unknown | null {
    const stmt = this.db.prepare("SELECT entry_json FROM " + table + " WHERE scope_key = ?");
    const row = stmt.get(key) as { entry_json: string } | undefined;
    return row ? JSON.parse(row.entry_json) : null;
  }

  private queryReadList(table: string, key: string): unknown[] {
    const stmt = this.db.prepare("SELECT entry_json FROM " + table + " WHERE scope_key = ?");
    const row = stmt.get(key) as { entry_json: string } | undefined;
    return row ? (JSON.parse(row.entry_json) as unknown[]) : [];
  }

  private queryUpsertOne(table: string, key: string, value: unknown, cursor: import("../../contracts/command-event.js").CommitCursor): void {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO " + table + " (scope_key, entry_json, source_cursor) VALUES (?, ?, ?)");
    stmt.run(key, JSON.stringify(value), String(cursor));
  }

  private queryUpsertList(table: string, key: string, values: unknown[], cursor: import("../../contracts/command-event.js").CommitCursor): void {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO " + table + " (scope_key, entry_json, source_cursor) VALUES (?, ?, ?)");
    stmt.run(key, JSON.stringify(values), String(cursor));
  }

  private applyQueryEvent(event: DomainEvent, cursor: import("../../contracts/command-event.js").CommitCursor): void {
    for (const change of projectQueryEvent(event)) {
      if (change.kind === 'job') this.queryUpsertOne('query_job_rows', change.key, change.job, cursor);
      else if (change.kind === 'run') this.queryUpsertOne('query_run_rows', change.key, change.run, cursor);
      else {
        const answers = this.queryReadList('query_answer_rows', change.key) as import("../../contracts/query-job.js").QueryJobAnswerV1[];
        answers.push(change.answer);
        this.queryUpsertList('query_answer_rows', change.key, answers, cursor);
      }
    }
  }

  /** completed-work context: completed-work selection source view (display only; composed from the Work-context stores). */
  async completedWorkView(query: import("../../contracts/completed-work-context.js").CompletedWorkViewQuery): Promise<import("../../contracts/completed-work-context.js").CompletedWorkViewResult> {
    const observedCursor = this.readCheckpoint();
    if (observedCursor === null) {
      return { status: "not_ready", observedCursor: null };
    }
    const scopeKey = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const rows: import("../../contracts/completed-work-context.js").CompletedWorkViewRow[] = [];
    // 先按「一个任务一个身份」归并，再判正式完成资格（与 InMemory 投影同一份权威规则）。
    const candidates = this.scanWorkContextBindings(scopeKey)
      .map(([key, entry]) => ({ key, snapshot: entry as import("../../contracts/context-continuity.js").WorkContextBindingSnapshot }))
      .filter((row) => query.goalId === undefined || row.snapshot.binding.goalId === query.goalId);
    const all = candidates.map((candidate) => ({ key: candidate.key, ref: candidate.snapshot.ref, binding: candidate.snapshot.binding }));
    const authoritative = dedupeTaskWorks(all);
    // （工作身份归并）：归并可见性。落选者同样由共享纯函数算出（内存与 SQLite 必须逐字段一致），
    // 不重算任务身份归并的选择规则，也不改写任何一条历史身份。
    const dropped = droppedWorkRefsByTask(all, authoritative);
    for (const { key, ref: workRef, binding } of authoritative) {
      if (await completedWorkCursor(binding, this) === null) continue;
      const notes = this.readWorkContextNotes(key);
      const continuations = this.readWorkContextContinuations(key);
      const latestCursor = observedCursor;
      const droppedHere = sortWorkRefs(dropped.get(taskWorkKey(binding.goalId, binding.taskId)) ?? []);
      rows.push({
        workRef,
        workKind: binding.workKind,
        goalId: binding.goalId,
        taskId: binding.taskId,
        noteCount: notes.length,
        continuationCount: continuations.length,
        sourceCursor: latestCursor,
        duplicateIdentityCount: droppedHere.length,
        droppedWorkRefs: droppedHere.map((ref) => ({ ...ref })),
      });
    }
    if (rows.length === 0) {
      return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId };
    }
    rows.sort((a, b) => canonicalJson(a.workRef).localeCompare(canonicalJson(b.workRef)));
    return { status: "ready", rows, sourceCursor: observedCursor };
  }

  /** completed-work context helpers: scan the work_context tables for a workspace scope. */
  private scanWorkContextBindings(scopeKey: string): [string, unknown][] {
    // Full-scope keys are canonicalJson refs (not workspace-prefix-sortable), so
    // scan the whole table + JS filter (same tactic as the Console agent scanner).
    const out: [string, unknown][] = [];
    const stmt = this.db.prepare("SELECT scope_key, entry_json FROM work_context_binding");
    for (const row of stmt.all() as { scope_key: string; entry_json: string }[]) {
      const binding = JSON.parse(row.entry_json) as import("../../contracts/context-continuity.js").WorkContextBindingSnapshot;
      if (consoleWorkspaceKey(binding.ref.projectId, binding.ref.workspaceId) === scopeKey) {
        out.push([row.scope_key, binding]);
      }
    }
    return out;
  }

  private readWorkContextNotes(key: string): import("../../contracts/context-continuity.js").WorkContextNoteRow[] {
    const stmt = this.db.prepare("SELECT entry_json FROM work_context_notes WHERE scope_key = ?");
    const row = stmt.get(key) as { entry_json: string } | undefined;
    return row ? (JSON.parse(row.entry_json) as import("../../contracts/context-continuity.js").WorkContextNoteRow[]) : [];
  }

  private readWorkContextContinuations(key: string): import("../../contracts/context-continuity.js").ContinuationRecordSnapshot[] {
    const stmt = this.db.prepare("SELECT entry_json FROM work_context_continuations WHERE scope_key = ?");
    const row = stmt.get(key) as { entry_json: string } | undefined;
    return row ? (JSON.parse(row.entry_json) as import("../../contracts/context-continuity.js").ContinuationRecordSnapshot[]) : [];
  }

  /** Architecture-inspection combined view (display only), kept field-for-field
   * equivalent to the InMemory reference. Overview and detail rows are composed
   * from their respective projections; an empty result remains not_found. */
  async architectureInspectionView(query: import("../../contracts/architecture-inspection.js").ArchitectureInspectionViewQuery): Promise<import("../../contracts/architecture-inspection.js").ArchitectureInspectionViewResult> {
    const observed = this.readCheckpoint();
    if (observed === null) {
      return { status: "not_ready", observedCursor: null };
    }
    const key = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const entries = this.architectureInspectionBuildInspectionEntries(key, query.planId);
    if (entries.length === 0) {
      return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId };
    }
    return { status: "ready", inspections: entries, sourceCursor: observed };
  }

  private architectureInspectionBuildInspectionEntries(
    scopeKey: string,
    planId: string | undefined,
  ): {
    inspection: import("../../contracts/architecture-inspection.js").ArchitectureInspectionSnapshot;
    findings: import("../../contracts/architecture-inspection.js").ArchitectureFindingSnapshot[];
    briefs: import("../../contracts/architecture-inspection.js").ArchitectureDecisionBriefSnapshot[];
    proposals: import("../../contracts/architecture-inspection.js").ArchitectureCandidateProposalSnapshot[];
  }[] {
    const entries: {
      inspection: import("../../contracts/architecture-inspection.js").ArchitectureInspectionSnapshot;
      findings: import("../../contracts/architecture-inspection.js").ArchitectureFindingSnapshot[];
      briefs: import("../../contracts/architecture-inspection.js").ArchitectureDecisionBriefSnapshot[];
      proposals: import("../../contracts/architecture-inspection.js").ArchitectureCandidateProposalSnapshot[];
    }[] = [];

    const inspectionRows = this.architectureInspectionReadRows("architecture_inspection_rows", scopeKey) as import("../../contracts/architecture-inspection.js").ArchitectureInspectionSnapshot[];
    const findingRows = this.architectureInspectionReadRows("architecture_finding_rows", scopeKey) as import("../../contracts/architecture-inspection.js").ArchitectureFindingSnapshot[];
    const briefRows = this.architectureInspectionReadRows("architecture_brief_rows", scopeKey) as import("../../contracts/architecture-inspection.js").ArchitectureDecisionBriefSnapshot[];
    const proposalRows = this.architectureInspectionReadRows("architecture_proposal_rows", scopeKey) as import("../../contracts/architecture-inspection.js").ArchitectureCandidateProposalSnapshot[];

    const claimedBriefs = new Set<string>();
    const claimedProposals = new Set<string>();

    for (const inspection of inspectionRows) {
      const findingRefs = new Set(inspection.findingRefs.map((r) => r.findingId));
      const findings = findingRows.filter((f) => findingRefs.has(f.ref.findingId));
      const briefRefId = inspection.briefRef?.briefId;
      const briefs = briefRefId ? briefRows.filter((b) => b.ref.briefId === briefRefId) : [];
      briefs.forEach((b) => claimedBriefs.add(b.ref.briefId));
      const proposalRefId = inspection.proposalRef?.proposalId;
      const proposals = proposalRefId ? proposalRows.filter((pr) => pr.ref.proposalId === proposalRefId) : [];
      proposals.forEach((pr) => claimedProposals.add(pr.ref.proposalId));
      if (planId === undefined || inspection.intent.planRef.planId === planId) {
        entries.push({ inspection, findings, briefs, proposals });
      }
    }
    for (const brief of briefRows) {
      if (claimedBriefs.has(brief.ref.briefId)) continue;
      if (planId !== undefined && brief.brief.planRef.planId !== planId) continue;
      entries.push({
        inspection: buildSyntheticArchitectureInspection(brief.ref.projectId, brief.ref.workspaceId, brief.ref.briefId, brief.brief.baselinePin, brief.brief.planRef, brief.recordedAt, "brief"),
        findings: [],
        briefs: [brief],
        proposals: [],
      });
    }
    for (const proposal of proposalRows) {
      if (claimedProposals.has(proposal.ref.proposalId)) continue;
      if (planId !== undefined && proposal.proposal.planRef.planId !== planId) continue;
      entries.push({
        inspection: buildSyntheticArchitectureInspection(proposal.ref.projectId, proposal.ref.workspaceId, proposal.ref.proposalId, proposal.proposal.sourceBaselinePin, proposal.proposal.planRef, proposal.recordedAt, "proposal"),
        findings: [],
        briefs: [],
        proposals: [proposal],
      });
    }
    return entries;
  }

  /** Console overview projection hook (Portfolio + WorkspaceSummary) — rebuilt ONLY from the
   * committed v1 events, in field-for-field parity with the InMemory reference.
   * Portfolio rows come from WorkspaceBootstrapped; summary rows are touched by
   * every workspace-scoped counter event. Per-task / per-goal phase counts are
   * persisted in internal tables so restart replay is exact (upsert rebuild). */
  private applyConsoleOverview(event: DomainEvent, cursor: CommitCursor): void {
    this.consoleEnsureInternalTables();
    if (event.eventType === "WorkspaceBootstrapped" || event.eventType === "WorkspaceRegistered") {
      const ev = event as import("../../contracts/bootstrap.js").WorkspaceBootstrappedEventV1 | import("../../contracts/workspace-registration.js").WorkspaceRegisteredEvent;
      this.consoleApplyBootstrap(ev, cursor);
    } else if (event.eventType === "GoalCreated") {
      const ev = event as import("../../contracts/command-event.js").GoalCreatedEvent;
      this.consoleTouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.goalCount += 1;
      });
    } else if (event.eventType === "PlanRevisionAccepted") {
      const ev = event as import("../../contracts/plan.js").PlanRevisionAcceptedEvent;
      this.consoleTouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.taskCount += ev.payload.planRevision.tasks.length;
        row.planRevisionCount += 1;
      });
    } else if (event.eventType === "TaskClaimed") {
      const ev = event as import("../../contracts/dispatch.js").TaskClaimedEvent;
      this.consoleTouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.agentRunCount += 1;
      });
    } else if (event.eventType === "ReplacementClaimed") {
      // projection contract: a replacement claim creates another Agent Run —
      // agentRunCount = claims + replacements (matches the ActiveAgents rows).
      const ev = event as import("../../contracts/handoff.js").ReplacementClaimedEvent;
      this.consoleTouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.agentRunCount += 1;
      });
    } else if (event.eventType === "EvidenceAdmitted") {
      const ev = event as import("../../contracts/evidence.js").EvidenceAdmittedEvent;
      this.consoleTouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.evidenceCount += 1;
      });
    } else if (event.eventType === "TaskReductionUpdated") {
      const ev = event as import("../../contracts/reduction.js").TaskReductionUpdatedEvent;
      this.consoleTouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.taskReductionCount += 1;
        const phase = ev.payload.reduction.phase;
        const key = consoleTaskKey(ev.projectId, ev.workspaceId, ev.payload.goalId, ev.payload.taskId);
        const prev = this.consoleReadPhase("console_task_phase", key);
        if (prev !== null) this.consoleDecrementTaskReduction(row, prev);
        this.consoleWritePhase("console_task_phase", key, phase);
        this.consoleIncrementTaskReduction(row, phase);
      });
    } else if (event.eventType === "GoalPhaseUpdated") {
      const ev = event as import("../../contracts/goal-phase.js").GoalPhaseUpdatedEvent;
      this.consoleTouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.goalPhaseCount += 1;
        const phase = ev.payload.phase;
        const key = consoleGoalKey(ev.projectId, ev.workspaceId, ev.payload.goalId);
        const prev = this.consoleReadPhase("console_goal_phase", key);
        if (prev !== null) this.consoleDecrementGoalPhase(row, prev);
        this.consoleWritePhase("console_goal_phase", key, phase);
        this.consoleIncrementGoalPhase(row, phase);
      });
    }
    // Every other event type leaves the workspace summary/portfolio rows
    // unchanged (they are not counter rows in the versioned contract).
  }

  /** Create the internal per-task / per-goal phase tracking tables on first use
   * (IF NOT EXISTS — idempotent; persisted in the same read-model file so
   * restart replay reproduces the same phase counts). */
  private consoleEnsureInternalTables(): void {
    if (this.consoleInternalTablesReady) return;
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS console_task_phase (" +
        "scope_key TEXT PRIMARY KEY, phase TEXT NOT NULL) WITHOUT ROWID;" +
        "CREATE TABLE IF NOT EXISTS console_goal_phase (" +
        "scope_key TEXT PRIMARY KEY, phase TEXT NOT NULL) WITHOUT ROWID;",
    );
    this.consoleInternalTablesReady = true;
  }

  private consolePhaseSelect(table: string): StatementSync {
    let stmt = this.consolePhaseSelectCache.get(table);
    if (stmt === undefined) {
      stmt = this.db.prepare("SELECT phase FROM " + table + " WHERE scope_key = ?");
      this.consolePhaseSelectCache.set(table, stmt);
    }
    return stmt;
  }

  private consolePhaseUpsert(table: string): StatementSync {
    let stmt = this.consolePhaseUpsertCache.get(table);
    if (stmt === undefined) {
      stmt = this.db.prepare(
        "INSERT INTO " + table + " (scope_key, phase) VALUES (?, ?) " +
          "ON CONFLICT(scope_key) DO UPDATE SET phase = excluded.phase",
      );
      this.consolePhaseUpsertCache.set(table, stmt);
    }
    return stmt;
  }

  private consoleReadPhase(table: string, scopeKey: string): string | null {
    const row = this.consolePhaseSelect(table).get(scopeKey) as unknown as { phase: string } | undefined;
    return row ? row.phase : null;
  }

  private consoleWritePhase(table: string, scopeKey: string, phase: string): void {
    this.consolePhaseUpsert(table).run(scopeKey, phase);
  }

  /** Read the persisted WorkspaceSummaryView (view_json) for a full scope key. */
  private consoleReadSummaryRow(scopeKey: string): import("../../contracts/console-views.js").WorkspaceSummaryView | null {
    if (this.consoleSummarySelectStmt === null) {
      this.consoleSummarySelectStmt = this.db.prepare("SELECT view_json FROM console_summary WHERE scope_key = ?");
    }
    const row = this.consoleSummarySelectStmt.get(scopeKey) as unknown as { view_json: string } | undefined;
    return row ? (JSON.parse(row.view_json) as import("../../contracts/console-views.js").WorkspaceSummaryView) : null;
  }

  /** Upsert the persisted WorkspaceSummaryView (view_json column of console_summary). */
  private consoleWriteSummaryRow(scopeKey: string, json: string, cursor: CommitCursor): void {
    if (this.consoleSummaryUpsertStmt === null) {
      this.consoleSummaryUpsertStmt = this.db.prepare(
        "INSERT INTO console_summary (scope_key, view_json, source_cursor) VALUES (?, ?, ?) " +
          "ON CONFLICT(scope_key) DO UPDATE SET view_json = excluded.view_json, source_cursor = excluded.source_cursor",
      );
    }
    this.consoleSummaryUpsertStmt.run(scopeKey, json, cursor);
  }

  /** WorkspaceBootstrapped -> create/refresh the (projectId, workspaceId)
   * PortfolioEntry (entry_json of console_portfolio) AND initialize the
   * WorkspaceSummary row (view_json of console_summary). */
  private consoleApplyBootstrap(
    ev: import("../../contracts/bootstrap.js").WorkspaceBootstrappedEventV1 | import("../../contracts/workspace-registration.js").WorkspaceRegisteredEvent,
    cursor: CommitCursor,
  ): void {
    const key = consoleWorkspaceKey(ev.projectId, ev.workspaceId);
    const sourceDigest = ev.payload.sourceDigest;
    const bootstrappedAt = ev.occurredAt;
    const entry: import("../../contracts/console-views.js").PortfolioEntry = {
      projectId: ev.projectId,
      workspaceId: ev.workspaceId,
      projectRevision: ev.eventType === 'WorkspaceRegistered' ? ev.payload.projectRevision : 1,
      workspaceRevision: 1,
      sourceDigest,
      bootstrappedAt,
      sourceCursor: cursor,
      scopeKey: key,
    };
    // Upsert: replaying the same event set reproduces the same row; a genuinely
    // new bootstrap refresh carries updated provenance. The baseline helper
    // writes the portfolio table's entry_json column.
    this.writeJsonProjectionRow(SqliteReadModelIndex.CONSOLE_TABLES.portfolio, key, JSON.stringify(entry), cursor);
    this.consoleTouchSummary(ev.projectId, ev.workspaceId, cursor, bootstrappedAt, (row) => {
      row.sourceDigest = sourceDigest;
      row.bootstrappedAt = bootstrappedAt;
    });
  }

  /** Get (or lazily create) the WorkspaceSummary row for the full scope key and
   * apply one counter mutation, then persist the (view_json) row; every counter
   * event refreshes sourceCursor + updatedAt. */
  private consoleTouchSummary(
    projectId: string,
    workspaceId: string,
    cursor: CommitCursor,
    occurredAt: string,
    update: (row: import("../../contracts/console-views.js").WorkspaceSummaryView) => void,
  ): void {
    const key = consoleWorkspaceKey(projectId, workspaceId);
    let row = this.consoleReadSummaryRow(key);
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
    this.consoleWriteSummaryRow(key, JSON.stringify(row), cursor);
  }

  private consoleIncrementTaskReduction(
    row: import("../../contracts/console-views.js").WorkspaceSummaryView,
    phase: string,
  ): void {
    const map = row.phaseCounts.taskReduction as Record<string, number>;
    map[phase] = (map[phase] ?? 0) + 1;
  }

  private consoleDecrementTaskReduction(
    row: import("../../contracts/console-views.js").WorkspaceSummaryView,
    phase: string,
  ): void {
    const map = row.phaseCounts.taskReduction as Record<string, number>;
    map[phase] = (map[phase] ?? 0) - 1;
  }

  private consoleIncrementGoalPhase(
    row: import("../../contracts/console-views.js").WorkspaceSummaryView,
    phase: string,
  ): void {
    const map = row.phaseCounts.goalPhase as Record<string, number>;
    map[phase] = (map[phase] ?? 0) + 1;
  }

  private consoleDecrementGoalPhase(
    row: import("../../contracts/console-views.js").WorkspaceSummaryView,
    phase: string,
  ): void {
    const map = row.phaseCounts.goalPhase as Record<string, number>;
    map[phase] = (map[phase] ?? 0) - 1;
  }

  /** Full-scope scan of the portfolio table, ordered by scope_key (deterministic). */
  private consoleSelectAll(table: string): { scope_key: string; entry_json: string; source_cursor: string }[] {
    let stmt = this.consoleSelectAllCache.get(table);
    if (stmt === undefined) {
      stmt = this.db.prepare("SELECT scope_key, entry_json, source_cursor FROM " + table + " ORDER BY scope_key ASC");
      this.consoleSelectAllCache.set(table, stmt);
    }
    return stmt.all() as unknown as { scope_key: string; entry_json: string; source_cursor: string }[];
  }

  // ------------------------------------------------------------------ //
  // Console detail-view projection helpers (JSON rows in the console tables).  //
  // ------------------------------------------------------------------ //

  /** detail-view projection prepared-statement cache (per distinct SQL). */
  private readonly consoleDetailStmtCache = new Map<string, StatementSync>();

  private consoleDetailPrepare(sql: string): StatementSync {
    let stmt = this.consoleDetailStmtCache.get(sql);
    if (stmt === undefined) {
      stmt = this.db.prepare(sql);
      this.consoleDetailStmtCache.set(sql, stmt);
    }
    return stmt;
  }

  private readConsolePlanMatrix(goalKey: string): import("../../contracts/console-views.js").PlanMatrixView | null {
    const row = this.consoleDetailPrepare("SELECT view_json FROM console_matrix WHERE goal_key = ?").get(goalKey) as
      | { view_json: string }
      | undefined;
    return row ? (JSON.parse(row.view_json) as import("../../contracts/console-views.js").PlanMatrixView) : null;
  }

  private writeConsolePlanMatrix(goalKey: string, view: import("../../contracts/console-views.js").PlanMatrixView, cursor: CommitCursor): void {
    this.consoleDetailPrepare(
      "INSERT INTO console_matrix (goal_key, view_json, source_cursor) VALUES (?, ?, ?) " +
        "ON CONFLICT(goal_key) DO UPDATE SET view_json = excluded.view_json, source_cursor = excluded.source_cursor",
    ).run(goalKey, JSON.stringify(view), cursor);
  }

  /** Scan EVERY console_agent row (value = { seq, row } for a run row, or
   *  { __marker } for a task handoff marker). Workspace filtering happens in JS —
   *  consoleTaskKey sorts the JSON keys alphabetically, so a task key can never be
   *  prefixed by the workspace key. */
  private scanConsoleAgentRows(): { key: string; value: unknown }[] {
    const rows = this.consoleDetailPrepare("SELECT task_key, view_json FROM console_agent").all() as
      | { task_key: string; view_json: string }[]
      | undefined;
    return (rows ?? []).map((r) => ({ key: r.task_key, value: JSON.parse(r.view_json) as unknown }));
  }

  private readConsoleAgentRow(taskKey: string): { value: unknown } | null {
    const row = this.consoleDetailPrepare("SELECT view_json FROM console_agent WHERE task_key = ?").get(taskKey) as
      | { view_json: string }
      | undefined;
    return row ? { value: JSON.parse(row.view_json) as unknown } : null;
  }

  private writeConsoleAgentRow(taskKey: string, value: unknown, cursor: CommitCursor): void {
    this.consoleDetailPrepare(
      "INSERT INTO console_agent (task_key, view_json, source_cursor) VALUES (?, ?, ?) " +
        "ON CONFLICT(task_key) DO UPDATE SET view_json = excluded.view_json, source_cursor = excluded.source_cursor",
    ).run(taskKey, JSON.stringify(value), cursor);
  }

  private readConsoleEvidence(taskKey: string): {
    projectId: string;
    workspaceId: string;
    goalId: string;
    taskId: string;
    evidence: { evidence: EvidenceV1; admittedAt: string; evidenceIndex: number; sourceCursor: CommitCursor }[];
    reduction: TaskReductionSnapshot | null;
    reductionCursor: CommitCursor | null;
    planRef: PlanRevisionRef;
    planRevision: number;
    sourceCursor: CommitCursor;
    updatedAt: string | null;
  } | null {
    const row = this.consoleDetailPrepare("SELECT view_json FROM console_evidence WHERE task_key = ?").get(taskKey) as
      | { view_json: string }
      | undefined;
    return row ? (JSON.parse(row.view_json) as never) : null;
  }

  private writeConsoleEvidence(taskKey: string, value: unknown, cursor: CommitCursor): void {
    this.consoleDetailPrepare(
      "INSERT INTO console_evidence (task_key, view_json, source_cursor) VALUES (?, ?, ?) " +
        "ON CONFLICT(task_key) DO UPDATE SET view_json = excluded.view_json, source_cursor = excluded.source_cursor",
    ).run(taskKey, JSON.stringify(value), cursor);
  }

  private readConsoleTimeline(workspaceKey: string): {
    entries: import("../../contracts/console-views.js").TimelineEntry[];
    total: number;
    updatedAt: string | null;
  } | null {
    const row = this.consoleDetailPrepare("SELECT view_json FROM console_timeline WHERE scope_key = ?").get(workspaceKey) as
      | { view_json: string }
      | undefined;
    return row ? (JSON.parse(row.view_json) as never) : null;
  }

  private writeConsoleTimeline(workspaceKey: string, value: unknown, cursor: CommitCursor): void {
    this.consoleDetailPrepare(
      "INSERT INTO console_timeline (scope_key, view_json, source_cursor) VALUES (?, ?, ?) " +
        "ON CONFLICT(scope_key) DO UPDATE SET view_json = excluded.view_json, source_cursor = excluded.source_cursor",
    ).run(workspaceKey, JSON.stringify(value), cursor);
  }

  /** Helper: active-agent storage key (full-scope task key + runId). */
  private consoleAgentStorageKey(projectId: string, workspaceId: string, goalId: string, taskId: string, runId: string): string {
    return consoleTaskKey(projectId, workspaceId, goalId, taskId) + "\u0000" + runId;
  }

  /** Helper: next workspace agent arrival seq = max existing run-row seq + 1 (persisted). */
  private consoleNextAgentSeq(projectId: string, workspaceId: string): number {
    let max = 0;
    for (const r of this.scanConsoleAgentRows()) {
      const v = r.value as { seq?: number; row?: import("../../contracts/console-views.js").ActiveAgentRunRow };
      if (v.row !== undefined && v.row.projectId === projectId && v.row.workspaceId === workspaceId && typeof v.seq === "number" && v.seq > max) {
        max = v.seq;
      }
    }
    return max + 1;
  }

  /** Helper: write a run row, preserving its stored arrival seq when it already exists. */
  private consoleWriteAgentRun(
    storageKey: string,
    projectId: string,
    workspaceId: string,
    row: import("../../contracts/console-views.js").ActiveAgentRunRow,
    cursor: CommitCursor,
  ): void {
    const existing = this.readConsoleAgentRow(storageKey);
    const seq = existing ? ((existing.value as { seq?: number }).seq ?? 0) : this.consoleNextAgentSeq(projectId, workspaceId);
    this.writeConsoleAgentRow(storageKey, { seq, row }, cursor);
  }

  /** Helper: write a task handoff marker row. */
  private consoleWriteAgentMarker(
    taskKey: string,
    handoff: import("../../contracts/console-views.js").ActiveAgentRunRow["handoff"],
    cursor: CommitCursor,
  ): void {
    this.writeConsoleAgentRow(taskKey + "\u0000@marker", { __marker: handoff }, cursor);
  }

  /** Helper: locate a run row by (projectId, workspaceId, runId) — events carry only runId. */
  private consoleReadAgentRowForRun(event: { projectId: string; workspaceId: string; aggregateId: string }): import("../../contracts/console-views.js").ActiveAgentRunRow | null {
    for (const r of this.scanConsoleAgentRows()) {
      const v = r.value as { row?: import("../../contracts/console-views.js").ActiveAgentRunRow };
      if (
        v.row !== undefined &&
        v.row.runRef.runId === event.aggregateId &&
        v.row.projectId === event.projectId &&
        v.row.workspaceId === event.workspaceId
      ) {
        return v.row;
      }
    }
    return null;
  }

  /** Helper: append one bounded workspace timeline entry (drop oldest beyond the bound). */
  private consoleAppendTimeline(
    event: { eventId: string; occurredAt: string; projectId: string; workspaceId: string },
    cursor: CommitCursor,
    kind: import("../../contracts/console-views.js").TimelineEntryKind,
    refs: { goalId?: string; taskId?: string; runId?: string; evidenceId?: string; packetId?: string; planId?: string },
    summary: string,
  ): void {
    const workspaceKey = consoleWorkspaceKey(event.projectId, event.workspaceId);
    const stored = this.readConsoleTimeline(workspaceKey);
    const entries = stored ? stored.entries : [];
    const total = stored ? stored.total : 0;
    const seq = total + 1;
    const entry: import("../../contracts/console-views.js").TimelineEntry = {
      seq,
      kind,
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      sourceCursor: cursor,
      refs: { projectId: event.projectId, workspaceId: event.workspaceId, ...refs },
      summary,
    };
    entries.push(entry);
    if (entries.length > CONSOLE_TIMELINE_MAX_ENTRIES) {
      entries.splice(0, entries.length - CONSOLE_TIMELINE_MAX_ENTRIES);
    }
    this.writeConsoleTimeline(workspaceKey, { entries, total: total + 1, updatedAt: event.occurredAt }, cursor);
  }

  /** Console detail-view projection hook (PlanMatrix + ActiveAgents + TaskEvidence + Timeline). */
  private applyConsoleDetails(event: DomainEvent, cursor: CommitCursor): void {
    switch (event.eventType) {
      case 'ReviewWorkCreated':
      case 'FailedReviewWorkReplaced':
        this.consoleApplyReviewWorkCreated(event, cursor);
        break;
      case "GoalCreated":
        this.consoleAppendTimeline(event, cursor, "goal_created", { goalId: event.aggregateId }, "goal " + event.aggregateId + " created");
        break;
      case "PlanRevisionAccepted":
        this.consoleApplyPlanRevisionAccepted(event, cursor);
        break;
      case "TaskClaimed":
        this.consoleApplyTaskClaimed(event, cursor);
        break;
      case "RunStarted":
        this.consoleApplyRunStarted(event, cursor);
        break;
      case "RunEventRecorded":
        this.consoleApplyRunEventRecorded(event, cursor);
        break;
      case 'ExecutionRetryScheduled':
        this.consoleApplyExecutionRetry(event, cursor);
        break;
      case 'RunReconciled': {
        const proof = event.payload.run.reconciliation?.observation;
        if (proof?.kind === 'runtime_terminal') this.consoleApplyRunEventRecorded({ ...event, eventType: 'RunEventRecorded',
          payload: { taskId: event.payload.run.task.taskId, runtimeEvent: proof.event } }, cursor);
        break;
      }
      case "RunOutcomeUnknown":
        this.consoleApplyRunOutcomeUnknown(event, cursor);
        break;
      case "EvidenceAdmitted":
        this.consoleApplyEvidenceAdmitted(event, cursor);
        break;
      case "TaskReductionUpdated":
        this.consoleApplyTaskReductionUpdated(event, cursor);
        break;
      case "GoalPhaseUpdated":
        this.consoleAppendTimeline(event, cursor, "goal_phase", { goalId: event.payload.goalId },
          "goal " + event.payload.goalId + " phase " + event.payload.phase);
        break;
      case "HandoffRecorded":
        this.consoleAppendTimeline(event, cursor, "handoff_recorded",
          { goalId: event.payload.goalId, taskId: event.payload.taskId, packetId: event.payload.packet.packetId },
          "handoff packet " + event.payload.packet.packetId + " recorded");
        break;
      case "ReplacementClaimed":
        this.consoleApplyReplacementClaimed(event, cursor);
        break;
      default:
        break;
    }
  }

  /** detail-view projection: PlanRevisionAccepted -> matrix row + timeline plan_accepted. */
  private consoleApplyPlanRevisionAccepted(event: PlanRevisionAcceptedEvent, cursor: CommitCursor): void {
    const snapshot = event.payload.planRevision;
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const goalId = event.payload.goalId;
    const view = buildPlanMatrixView(projectId, workspaceId, goalId, snapshot, cursor, event.occurredAt);
    this.writeConsolePlanMatrix(consoleGoalKey(projectId, workspaceId, goalId), view, cursor);
    // refs.planId 是条目自己的事实（这条说 accepted 的是哪一份计划），后面的
    // GoalRevisionRecorded 用它作为匹配键补变更原因，不靠"最后一条"这类顺序假设。
    this.consoleAppendTimeline(event, cursor, "plan_accepted", { goalId, planId: snapshot.ref.planId },
      "plan " + snapshot.ref.planId + " revision " + snapshot.planRevision + " accepted");
  }

  /**
   * 计划变更原因：补到本次受理的 plan_accepted 时间线条目上。
   *
   * 与内存实现同一语义（两套读模型必须逐字段一致）：PlanRevisionAccepted 事件本身不带变更原因，
   * 原因在同一个提交批次的 GoalRevisionRecorded 事件里（该事件逐字落账命令的 changeReason）。
   * 投影按到达顺序折叠，plan_accepted 先到，因此只能事后按同一条 canonical 事实
   * （目标 + 生效计划 id）回头写入——不新造条目、不改写 summary、不解析 id 形状、不推断。
   * 初始计划受理没有 GoalRevisionRecorded，它的条目永远不带 change。
   */
  private planChangeAnnotateTimelineChangeReason(projectId: string, workspaceId: string, ev: GoalRevisionRecordedEvent, cursor: import("../../contracts/command-event.js").CommitCursor): void {
    const workspaceKey = consoleWorkspaceKey(projectId, workspaceId);
    const stored = this.readConsoleTimeline(workspaceKey);
    if (stored === null) return;
    const change = ev.payload.change;
    // 倒序取最后一条匹配：唯一性由账本 CAS 保证，投影不依赖它。找不到匹配条目时下面的
    // hit < 0 分支静默返回，前提是批次顺序固定（plan_accepted 先于 GoalRevisionRecorded）；
    // 若将来顺序放开，应改为报投影停滞而不是沉默。内存实现保持同一语义。
    let hit = -1;
    for (let index = stored.entries.length - 1; index >= 0; index -= 1) {
      const entry = stored.entries[index]!;
      if (entry.kind !== "plan_accepted" || entry.refs.goalId !== change.goalRef.goalId) continue;
      if (entry.refs.planId !== change.activePlanRef.planId) continue;
      hit = index;
      break;
    }
    if (hit < 0) return;
    const entry = stored.entries[hit]!;
    stored.entries[hit] = {
      ...entry,
      change: {
        reason: change.reason,
        actor: { ...ev.actor },
        goalRevision: change.revision,
        activePlanId: change.activePlanRef.planId,
        supersededPlanIds: change.supersededPlanRefs.map((ref) => ref.planId),
      },
    };
    this.writeConsoleTimeline(workspaceKey, stored, cursor);
  }

  /** detail-view projection: TaskClaimed -> create/refresh the active-agent run row (starting). */
  private consoleApplyReviewWorkCreated(event: import('../../contracts/reviewer-work.js').ReviewWorkCreatedEvent | import('../../contracts/reviewer-work.js').FailedReviewWorkReplacedEvent, cursor: CommitCursor): void {
    const { work, run, attempt } = event.payload;
    const projectId = event.projectId, workspaceId = event.workspaceId, goalId = work.subject.goalId, taskId = work.subject.taskId;
    const storageKey = this.consoleAgentStorageKey(projectId, workspaceId, goalId, taskId, run.ref.runId);
    const producer = this.consoleReadAgentRowForRun({ projectId, workspaceId, aggregateId: work.producerRunRef.runId });
    if (!producer) throw new ProjectionStallError('unsupported_event_type', { observedCursor: cursor });
    const row: import('../../contracts/console-views.js').ActiveAgentRunRow = { projectId, workspaceId, goalId, taskId, work: { kind: 'review', reviewWorkRef: work.ref }, runRef: run.ref, attemptRef: attempt.ref, binding: work.roleBinding, runStatus: 'starting', runOutcome: null, exitCode: null, lastEventSeq: 0, attemptStatus: 'claimed', attemptEndOutcome: null, lease: { ...producer.lease }, startedAt: null, endedAt: null, displayState: 'starting', handoff: null, sourceCursor: cursor };
    this.consoleWriteAgentRun(storageKey, projectId, workspaceId, row, cursor);
  }
  private consoleApplyTaskClaimed(event: TaskClaimedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const { goalId, taskId, runRef, attemptRef, roleBinding, claimedAt } = event.payload;
    const storageKey = this.consoleAgentStorageKey(projectId, workspaceId, goalId, taskId, runRef.runId);
    const taskKey = consoleTaskKey(projectId, workspaceId, goalId, taskId);
    const markerRow = this.readConsoleAgentRow(taskKey + "\u0000@marker");
    const marker = markerRow ? ((markerRow.value as { __marker: import("../../contracts/console-views.js").ActiveAgentRunRow["handoff"] }).__marker ?? null) : null;
    const row: import("../../contracts/console-views.js").ActiveAgentRunRow = {
      projectId,
      workspaceId,
      goalId,
      taskId,
      runRef,
      attemptRef,
      binding: roleBinding,
      runStatus: "starting",
      runOutcome: null,
      exitCode: null,
      lastEventSeq: 0,
      attemptStatus: "claimed",
      attemptEndOutcome: null,
      lease: { holderRunId: runRef.runId, grantedAt: claimedAt, expiresAt: null },
      startedAt: null,
      endedAt: null,
      displayState: "starting",
      handoff: marker,
      sourceCursor: cursor,
    };
    this.consoleWriteAgentRun(storageKey, projectId, workspaceId, row, cursor);
    this.consoleAppendTimeline(event, cursor, "task_claimed", { goalId, taskId, runId: runRef.runId },
      "work " + taskId + " claimed (run " + runRef.runId + ")");
  }

  /** detail-view projection: RunStarted -> the run row becomes running/ongoing. */
  private consoleApplyRunStarted(event: RunStartedEvent, cursor: CommitCursor): void {
    const row = this.consoleReadAgentRowForRun(event);
    if (!row) return;
    const updated: import("../../contracts/console-views.js").ActiveAgentRunRow = {
      ...row,
      runStatus: "running",
      startedAt: event.payload.startedAt,
      attemptStatus: "started",
      displayState: "ongoing",
      sourceCursor: cursor,
    };
    this.consoleWriteAgentRun(
      this.consoleAgentStorageKey(row.projectId, row.workspaceId, row.goalId, row.taskId, row.runRef.runId),
      row.projectId,
      row.workspaceId,
      updated,
      cursor,
    );
    this.consoleAppendTimeline(event, cursor, "run_started", { goalId: row.goalId, taskId: row.taskId, runId: row.runRef.runId },
      "run " + row.runRef.runId + " started");
  }

  /** detail-view projection: RunEventRecorded -> fold the runtime event into the run row (idempotent on seq). */
  private consoleApplyRunEventRecorded(event: RunEventRecordedEvent, cursor: CommitCursor): void {
    const row = this.consoleReadAgentRowForRun(event);
    if (!row) return;
    const rt = event.payload.runtimeEvent;
    if (rt.sequence > row.lastEventSeq) {
      const terminal = isTerminalRuntimeEvent(rt);
      const outcome = terminal ? runtimeEventTerminalOutcome(rt) : row.runOutcome;
      const exitCode = rt.payload.kind === "completed" ? rt.payload.exitCode : row.exitCode;
      const endedAt = terminal ? rt.occurredAt : row.endedAt;
      const updated: import("../../contracts/console-views.js").ActiveAgentRunRow = {
        ...row,
        runStatus: terminal ? "ended" : "running",
        runOutcome: outcome,
        exitCode,
        lastEventSeq: rt.sequence,
        endedAt,
        attemptStatus: terminal ? "ended" : row.attemptStatus,
        attemptEndOutcome: terminal ? outcome : row.attemptEndOutcome,
        displayState: terminal ? runDisplayStateForEvent(rt.eventType) : "ongoing",
        sourceCursor: cursor,
      };
      const storageKey = this.consoleAgentStorageKey(row.projectId, row.workspaceId, row.goalId, row.taskId, row.runRef.runId);
      this.consoleWriteAgentRun(storageKey, row.projectId, row.workspaceId, updated, cursor);
    }
    this.consoleAppendTimeline(event, cursor, "run_event", { goalId: row.goalId, taskId: row.taskId, runId: row.runRef.runId },
      "run " + row.runRef.runId + " " + rt.eventType);
  }

  /** detail-view projection: RunOutcomeUnknown -> explicit ended/outcome_unknown fact (never inferred). */
  private consoleApplyExecutionRetry(event: import('../../contracts/dispatch.js').ExecutionRetryScheduledEvent, cursor: CommitCursor): void {
    const row = this.consoleReadAgentRowForRun(event);
    if (!row) return;
    const updated: import('../../contracts/console-views.js').ActiveAgentRunRow = { ...row, runStatus: 'starting', runOutcome: null,
      startedAt: null, endedAt: null, attemptStatus: 'claimed', attemptEndOutcome: null, displayState: 'starting', sourceCursor: cursor };
    const storageKey = this.consoleAgentStorageKey(row.projectId, row.workspaceId, row.goalId, row.taskId, row.runRef.runId);
    this.consoleWriteAgentRun(storageKey, row.projectId, row.workspaceId, updated, cursor);
  }

  private consoleApplyRunOutcomeUnknown(event: RunOutcomeUnknownEvent, cursor: CommitCursor): void {
    const row = this.consoleReadAgentRowForRun(event);
    if (!row) return;
    const updated: import("../../contracts/console-views.js").ActiveAgentRunRow = {
      ...row,
      runStatus: "ended",
      runOutcome: "outcome_unknown",
      endedAt: event.payload.observedAt,
      attemptStatus: "ended",
      attemptEndOutcome: "outcome_unknown",
      displayState: "outcome_unknown",
      sourceCursor: cursor,
    };
    const storageKey = this.consoleAgentStorageKey(row.projectId, row.workspaceId, row.goalId, row.taskId, row.runRef.runId);
    this.consoleWriteAgentRun(storageKey, row.projectId, row.workspaceId, updated, cursor);
    this.consoleAppendTimeline(event, cursor, "run_outcome_unknown", { goalId: row.goalId, taskId: row.taskId, runId: row.runRef.runId },
      "run " + row.runRef.runId + " outcome unknown");
  }

  /** detail-view projection: ReplacementClaimed -> task handoff marker + (absent) replacement run row. */
  private consoleApplyReplacementClaimed(event: ReplacementClaimedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const { goalId, taskId, packetRef, priorRunRef, replacementRef, attemptRef, runRef, reason, claimedAt } = event.payload;
    const taskKey = consoleTaskKey(projectId, workspaceId, goalId, taskId);
    const handoff: import("../../contracts/console-views.js").ActiveAgentRunRow["handoff"] = {
      packetRef,
      priorRunRef,
      replacementRef,
      reason,
      claimedAt,
      sourceCursor: cursor,
    };
    this.consoleWriteAgentMarker(taskKey, handoff, cursor);
    const storageKey = this.consoleAgentStorageKey(projectId, workspaceId, goalId, taskId, runRef.runId);
    const existing = this.readConsoleAgentRow(storageKey);
    const row: import("../../contracts/console-views.js").ActiveAgentRunRow = {
      projectId,
      workspaceId,
      goalId,
      taskId,
      runRef,
      attemptRef,
      binding: LEASE_VIEW_PLACEHOLDER_BINDING,
      runStatus: "running",
      runOutcome: null,
      exitCode: null,
      lastEventSeq: 0,
      attemptStatus: "claimed",
      attemptEndOutcome: null,
      lease: { holderRunId: runRef.runId, grantedAt: claimedAt, expiresAt: null },
      startedAt: null,
      endedAt: null,
      displayState: "ongoing",
      handoff,
      sourceCursor: cursor,
    };
    // Reuse the existing arrival seq (idempotent replay); refresh the handoff.
    if (existing) {
      const prev = (existing.value as { row: import("../../contracts/console-views.js").ActiveAgentRunRow }).row;
      this.consoleWriteAgentRun(storageKey, projectId, workspaceId, { ...prev, handoff, sourceCursor: cursor }, cursor);
    } else {
      this.consoleWriteAgentRun(storageKey, projectId, workspaceId, row, cursor);
    }
    this.consoleAppendTimeline(event, cursor, "replacement_claimed", { goalId, taskId, runId: runRef.runId, packetId: packetRef.packetId },
      "replacement claimed (run " + runRef.runId + ")");
  }

  /** detail-view projection: EvidenceAdmitted -> append the entry + timeline evidence_admitted. */
  private consoleApplyEvidenceAdmitted(event: EvidenceAdmittedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const { goalId, taskId, evidence, admittedAt, evidenceIndex } = event.payload;
    const taskKey = consoleTaskKey(projectId, workspaceId, goalId, taskId);
    let proj = this.readConsoleEvidence(taskKey);
    if (!proj) {
      const snapshot = this.readPlanSnapshot(projectId, goalId);
      proj = {
        projectId,
        workspaceId,
        goalId,
        taskId,
        evidence: [],
        reduction: null,
        reductionCursor: null,
        planRef: snapshot?.ref ?? { aggregateType: "PlanRevision", projectId, planId: "" },
        planRevision: snapshot?.planRevision ?? 0,
        sourceCursor: cursor,
        updatedAt: null,
      };
    }
    proj.evidence.push({ evidence, admittedAt, evidenceIndex, sourceCursor: cursor });
    proj.sourceCursor = cursor;
    proj.updatedAt = event.occurredAt;
    this.writeConsoleEvidence(taskKey, proj, cursor);
    this.consoleAppendTimeline(event, cursor, "evidence_admitted", { goalId, taskId, evidenceId: evidence.evidenceId },
      "evidence " + evidence.evidenceId + " admitted " + evidence.outcome);
  }

  /** detail-view projection: TaskReductionUpdated -> matrix live-phase + evidence reduction + timeline. */
  private consoleApplyTaskReductionUpdated(event: TaskReductionUpdatedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const { goalId, taskId, reduction } = event.payload;

    const matrixKey = consoleGoalKey(projectId, workspaceId, goalId);
    let view = this.readConsolePlanMatrix(matrixKey);
    if (!view) {
      const snapshot = this.readPlanSnapshot(projectId, goalId);
      if (snapshot) view = buildPlanMatrixView(projectId, workspaceId, goalId, snapshot, cursor, event.occurredAt);
    }
    if (view) {
      const rows = view.rows.map((row) => {
        if (row.taskId !== taskId) return row;
        const livePhase = reduction.phase;
        return {
          ...row,
          livePhase,
          phaseSources: { ...row.phaseSources, live: { reductionRevision: reduction.revision, sourceCursor: cursor } },
          phaseMismatch: livePhase !== row.plannedPhase,
          sourceCursor: cursor,
        };
      });
      this.writeConsolePlanMatrix(matrixKey, { ...view, rows, sourceCursor: cursor, updatedAt: event.occurredAt }, cursor);
    }

    const taskKey = consoleTaskKey(projectId, workspaceId, goalId, taskId);
    let proj = this.readConsoleEvidence(taskKey);
    if (!proj) {
      const snapshot = this.readPlanSnapshot(projectId, goalId);
      proj = {
        projectId,
        workspaceId,
        goalId,
        taskId,
        evidence: [],
        reduction: null,
        reductionCursor: null,
        planRef: snapshot?.ref ?? { aggregateType: "PlanRevision", projectId, planId: "" },
        planRevision: snapshot?.planRevision ?? 0,
        sourceCursor: cursor,
        updatedAt: null,
      };
    }
    proj.reduction = reduction;
    proj.reductionCursor = cursor;
    proj.planRef = reduction.planRef;
    proj.planRevision = reduction.planRevision;
    proj.sourceCursor = cursor;
    proj.updatedAt = event.occurredAt;
    this.writeConsoleEvidence(taskKey, proj, cursor);

    this.consoleAppendTimeline(event, cursor, "task_reduction", { goalId, taskId },
      "task " + taskId + " reduced to " + reduction.phase);
  }

  /** Console overview projection: portfolio of bootstrapped Project/Workspace scopes
   * (all rows read from console_portfolio, ordered by scope_key). */
  async consolePortfolio(query: PortfolioViewQuery): Promise<PortfolioViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const maxProjects = CONSOLE_PORTFOLIO_MAX_PROJECTS;
    const rows = this.consoleSelectAll(SqliteReadModelIndex.CONSOLE_TABLES.portfolio);
    const entries = rows
      .map((row) => JSON.parse(row.entry_json) as import("../../contracts/console-views.js").PortfolioEntry)
      .slice(0, maxProjects);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (entries.length > 0) {
          return {
            status: "ready",
            portfolio: buildPortfolioView(entries, observedCursor!),
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
        portfolio: buildPortfolioView(entries, observedCursor!),
        observedCursor: observedCursor!,
      };
    }
    return { status: "not_ready", requiredCursor: observedCursor ?? makeCommitCursor(1), observedCursor };
  }

  /** Console overview projection: workspace-level summary per full-scope key. */
  async consoleSummary(query: WorkspaceSummaryViewQuery): Promise<WorkspaceSummaryViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.consoleReadSummaryRow(consoleWorkspaceKey(query.projectId, query.workspaceId));

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

  /** Build the TaskEvidenceView from the projected row (query-time pure derivation). */
  private consoleBuildEvidenceView(proj: {
    projectId: string;
    workspaceId: string;
    goalId: string;
    taskId: string;
    evidence: { evidence: EvidenceV1; admittedAt: string; evidenceIndex: number; sourceCursor: CommitCursor }[];
    reduction: TaskReductionSnapshot | null;
    reductionCursor: CommitCursor | null;
    planRef: PlanRevisionRef;
    planRevision: number;
    sourceCursor: CommitCursor;
    updatedAt: string | null;
  }): import("../../contracts/console-views.js").TaskEvidenceView {
    const projectId = proj.projectId;
    const goalId = proj.goalId;
    const taskId = proj.taskId;
    const planSnapshot = this.readPlanSnapshot(projectId, goalId);
    const currentAnchor = proj.reduction ? proj.reduction.currentAnchor : null;
    const sorted = [...proj.evidence].sort((a, b) => a.evidenceIndex - b.evidenceIndex);
    const explanation = this.policyExplanation.explainEvidence({ evidence: sorted.map(pe => pe.evidence), plan: planSnapshot, currentAnchor, review: reviewProjectionFacts(this.reviewRecords()) });
    const evidence = sorted.map((pe, index) => toTaskEvidenceEntry(pe, explanation.bindings[index]!.applicability));
    const { effectiveEvidenceIds, blockingEvidenceIds } = explanation;
    const reduction = proj.reduction === null
      ? null
      : {
          phase: proj.reduction.phase,
          causes: proj.reduction.causes,
          effectiveEvidenceIds: proj.reduction.effectiveEvidenceIds,
          blockingEvidenceIds: proj.reduction.blockingEvidenceIds,
          satisfiedObligationIds: proj.reduction.satisfiedObligationIds,
          planRef: proj.reduction.planRef,
          reducedAt: proj.reduction.reducedAt,
          sourceCursor: proj.reductionCursor!,
        };
    const staleEvidenceIds = proj.reduction ? proj.reduction.staleEvidenceIds : [];
    const outOfScopeEvidenceIds = proj.reduction ? proj.reduction.outOfScopeEvidenceIds : [];
    const planRef = planSnapshot?.ref ?? proj.reduction?.planRef ?? sorted[0]?.evidence.anchor.planRef ??
      { aggregateType: "PlanRevision", projectId, planId: "" };
    const planRevision = planSnapshot?.planRevision ?? proj.reduction?.planRevision ?? sorted[0]?.evidence.anchor.planRevision ?? 0;
    return {
      projectId,
      workspaceId: proj.workspaceId,
      goalId,
      taskId,
      currentAnchor,
      planRef,
      planRevision,
      evidence,
      effectiveEvidenceIds,
      blockingEvidenceIds,
      staleEvidenceIds,
      outOfScopeEvidenceIds,
      reduction,
      bodyPolicy: "ref_only",
      modelExplanation: { status: "unavailable", sourceCursor: null },
      sourceCursor: proj.sourceCursor,
      updatedAt: proj.updatedAt,
    };
  }

  /** Console detail-view projection: plan matrix (key = consoleGoalKey; freshness mirrors goal()). */
  async consolePlanMatrix(query: PlanMatrixViewQuery): Promise<PlanMatrixViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const row = this.readConsolePlanMatrix(consoleGoalKey(query.projectId, query.workspaceId, query.goalId));
    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (row) return { status: "ready", matrix: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return { status: "not_ready", requiredCursor: query.atLeastCursor, observedCursor };
    }
    if (row) return { status: "ready", matrix: row, observedCursor: observedCursor! };
    return { status: "not_ready", requiredCursor: observedCursor ?? makeCommitCursor(1), observedCursor };
  }

  /** Console detail-view projection: active agents (per workspace; optional goalId filter; bounded). */
  async consoleActiveAgents(query: ActiveAgentsViewQuery): Promise<ActiveAgentsViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const scanned = this.scanConsoleAgentRows();
    const runEntries: [import("../../contracts/console-views.js").ActiveAgentRunRow, number][] = [];
    const markersByTask = new Map<string, import("../../contracts/console-views.js").ActiveAgentRunRow["handoff"]>();
    for (const r of scanned) {
      const v = r.value as {
        seq?: number;
        row?: import("../../contracts/console-views.js").ActiveAgentRunRow;
        __marker?: import("../../contracts/console-views.js").ActiveAgentRunRow["handoff"];
      };
      if (v.__marker !== undefined) {
        markersByTask.set(r.key.split("\u0000")[0]!, v.__marker);
      } else if (
        v.row !== undefined &&
        v.row.projectId === query.projectId &&
        v.row.workspaceId === query.workspaceId
      ) {
        runEntries.push([v.row, v.seq ?? 0]);
      }
    }
    runEntries.sort((a, b) => a[1] - b[1]);
    const hasRows = runEntries.length > 0;
    const base = runEntries.map(([row]) => row);
    const filtered = query.goalId === undefined ? base : base.filter((row) => row.goalId === query.goalId);
    const taskCount = filtered.length;
    const bounded = filtered.slice(-CONSOLE_ACTIVE_AGENTS_MAX_ROWS);
    const rows = bounded.map((row) => {
      const marker = markersByTask.get(consoleTaskKey(row.projectId, row.workspaceId, row.goalId, row.taskId)) ?? null;
      return marker ? { ...row, handoff: marker } : row;
    });
    const last = bounded.length > 0 ? bounded[bounded.length - 1]! : null;
    const view: import("../../contracts/console-views.js").ActiveAgentsView = {
      projectId: query.projectId,
      workspaceId: query.workspaceId,
      rows,
      taskCount,
      sourceCursor: last ? last.sourceCursor : (observedCursor ?? makeCommitCursor(1)),
      updatedAt: last ? (last.endedAt ?? last.startedAt ?? last.lease.grantedAt) : null,
    };
    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (hasRows) return { status: "ready", agents: view, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return { status: "not_ready", requiredCursor: query.atLeastCursor, observedCursor };
    }
    if (hasRows) return { status: "ready", agents: view, observedCursor: observedCursor! };
    return { status: "not_ready", requiredCursor: observedCursor ?? makeCommitCursor(1), observedCursor };
  }

  /** Console detail-view projection: task evidence (key = consoleTaskKey; freshness mirrors goal()). */
  async consoleTaskEvidence(query: TaskEvidenceViewQuery): Promise<TaskEvidenceViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const proj = this.readConsoleEvidence(
      consoleTaskKey(query.projectId, query.workspaceId, query.goalId, query.taskId),
    );
    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (proj) return { status: "ready", evidence: this.consoleBuildEvidenceView(proj), observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return { status: "not_ready", requiredCursor: query.atLeastCursor, observedCursor };
    }
    if (proj) return { status: "ready", evidence: this.consoleBuildEvidenceView(proj), observedCursor: observedCursor! };
    return { status: "not_ready", requiredCursor: observedCursor ?? makeCommitCursor(1), observedCursor };
  }

  /** Console detail-view projection: workspace timeline (per workspace; optional goalId filter; bounded). */
  async consoleTimeline(query: TimelineViewQuery): Promise<TimelineViewResult> {
    this.assertOpen();
    const observedCursor = this.readCheckpoint();
    const workspaceKey = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const stored = this.readConsoleTimeline(workspaceKey);
    const entries = stored ? stored.entries : [];
    const hasRow = stored !== null && (stored.total > 0 || entries.length > 0);
    const filtered = query.goalId === undefined ? entries : entries.filter((e) => e.refs.goalId === query.goalId);
    const maxEntries = query.maxEntries === undefined || query.maxEntries < 1
      ? CONSOLE_TIMELINE_MAX_ENTRIES
      : query.maxEntries;
    const bounded = filtered.slice(-maxEntries);
    const view: import("../../contracts/console-views.js").TimelineView = {
      projectId: query.projectId,
      workspaceId: query.workspaceId,
      entries: bounded,
      totalCount: filtered.length,
      sourceCursor: entries.length > 0 ? entries[entries.length - 1]!.sourceCursor : (observedCursor ?? makeCommitCursor(1)),
      updatedAt: stored ? stored.updatedAt : null,
    };
    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(observedCursor, query.atLeastCursor)) {
        if (hasRow) return { status: "ready", timeline: view, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return { status: "not_ready", requiredCursor: query.atLeastCursor, observedCursor };
    }
    if (hasRow) return { status: "ready", timeline: view, observedCursor: observedCursor! };
    return { status: "not_ready", requiredCursor: observedCursor ?? makeCommitCursor(1), observedCursor };
  }

}

export function createSqliteReadModelIndex(
  options: SqliteReadModelIndexOptions,
): SqliteReadModelIndex {
  return new SqliteReadModelIndex(options);
}
