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
// ModuleDependencyDAG 允许 ReadModelIndex → ControlEngine（策略解释端口同向）。
import { dedupeTaskWorks } from '../../control/control-engine/work-identity-resolution.js';
import { matchesMaterialAccessLookup, type MaterialAccessGrantLookup, type MaterialAccessGrantViewResult } from '../../contracts/material-access.js';
/**
 * ReadModelIndexImpl — in-memory projections for the platform's read-only views.
 * Authority: dev_docs/interfaces/goal-view.md + modules/data/read-model-index.md.
 *
 * Hidden implementation: cursor checkpoints, event dedupe, view-specific
 * in-memory stores, and read-after-write freshness checks. Catch-up and rebuild
 * advance sequential EventPages from the StateLedger.
 *
 * Invariants upheld by goal-view.md and read-model-index.md:
 *  - Views are rebuildable projections; fields come only from Events.
 *  - Repeated events are idempotent (dedupe by eventId) and never re-reported.
 *  - Cursor gap / out-of-order / unknown schema version stall the whole page
 *    (no partial application) via a typed ProjectionStallError.
 *  - A KNOWN v1 event with no projection handler still stalls the WHOLE page
 *    via ProjectionStallError(unsupported_event_type) — never silently skip
 *    (all current handlers are registered; this remains a future defence).
 *  - View keys are FULL scope keys: (projectId, workspaceId, goalId) for the
 *    Goal view, (projectId, goalId) for the Plan Graph and (projectId, goalId,
 *    taskId) for Task Detail — local ids shared across Projects never collide.
 *  - sourceCursor records the last Event that changed the row; global
 *    freshness is judged only by observedCursor.
 */
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
import type { CommitCursor } from "../../contracts/command-event.js";
import type { GoalCreatedEvent } from "../../contracts/command-event.js";
import type { DomainEvent } from "../../contracts/events.js";
import type { EventPage, PositionedEvent } from "../../contracts/ledger.js";
import { compareCommitCursor, makeCommitCursor, seqOfCommitCursor } from "../../contracts/ledger.js";
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
  CoordinationPolicyRevisionSnapshot,
  InitialDesignDecisionSnapshot,
  InitialDesignProposalSnapshot,
  ProjectCoordinationPolicyActiveSnapshot,
  UnifiedStatusViewQuery,
  UnifiedStatusViewResult,
} from "../../contracts/human-role-collaboration.js";
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
import type {
  TaskVerificationViewQuery,
  TaskVerificationViewResult,
  TaskVerificationView,
  EvidenceBindingView,
} from "../../contracts/verification-view.js";
import type { EffectivityAnchorV1, EvidenceAdmittedEvent, EvidenceV1 } from "../../contracts/evidence.js";
import type { EvidenceApplicability } from "../../contracts/evidence.js";
import type { PolicyExplanationPort } from "../../contracts/policy-explanation.js";
import type { TaskReductionSnapshot, TaskReductionUpdatedEvent } from "../../contracts/reduction.js";
import type {
  GoalStatusQuery,
  GoalStatusView,
  GoalStatusViewResult,
  GoalTimelineQuery,
  GoalTimelineEntry,
  GoalTimelineViewResult,
} from "../../contracts/goal-phase-view.js";
import type { GoalPhaseUpdatedEvent } from "../../contracts/goal-phase.js";
import type { HandoffRecordedEvent, ReplacementClaimedEvent } from "../../contracts/handoff.js";
import { handoffPacketRefFor } from "../../contracts/handoff.js";
import type {
  HandoffProvenanceEntry,
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
import type { PatchRecordedEvent } from "../../contracts/patch.js";
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
import { patchRecordRefFor } from "../../contracts/patch.js";
import type { RoleBindingRefV1 } from "../../contracts/dispatch.js";
import { workContextRefFor } from "../../contracts/context-continuity.js";
import { MATERIAL_ACCESS_VIEW_MAX_ROWS } from "../../contracts/material-access.js";

/** Full-scope view key: (projectId, workspaceId, goalId) — never a local id only. */
function goalKey(projectId: string, workspaceId: string, goalId: string): string {
  return projectId + "\u0000" + workspaceId + "\u0000" + goalId;
}

/** Full-scope Plan Graph key: (projectId, goalId). */
function planGraphKey(projectId: string, goalId: string): string {
  return projectId + "\u0000" + goalId;
}

/** Full-scope Task Detail key: (projectId, goalId, taskId). */
function taskDetailKey(projectId: string, goalId: string, taskId: string): string {
  return projectId + "\u0000" + goalId + "\u0000" + taskId;
}

/** Full-scope Goal phase key: (projectId, goalId) — the context assembly projection scope. */
function goalPhaseKey(projectId: string, goalId: string): string {
  return projectId + "\u0000" + goalId;
}

/** Full-scope work-context key: canonicalJson of the complete ref. */
function workContextScopeKey(projectId: string, workspaceId: string, workId: string): string {
  return canonicalJson(workContextRefFor(projectId, workspaceId, workId));
}

/** Full-scope workspace lease view key: (projectId, workspaceId). */
function workspaceLeaseKey(projectId: string, workspaceId: string): string {
  return projectId + "\u0000" + workspaceId;
}

/** Full-scope workspace concurrency integration conflict view key: (projectId, goalId, taskId). */
function integrationConflictKey(projectId: string, goalId: string, taskId: string): string {
  return projectId + "\u0000" + goalId + "\u0000" + taskId;
}

/** Full-scope workspace patch view key: (projectId, workspaceId). */
function workspacePatchKey(projectId: string, workspaceId: string): string {
  return projectId + "\u0000" + workspaceId;
}

/** Reconstruct a lease view holder. The grant event carries runRef + attemptRef
 * but NOT the holder roleBinding (which lives on the lease snapshot, off the
 * event stream), so the display view carries a stable placeholder binding —
 * display-only, never judged, never replayed as authority. */
const LEASE_VIEW_PLACEHOLDER_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1,
  bindingId: "",
  templateId: "",
  templateRevision: "",
  bindingVersion: 1,
  policyRevision: "",
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

export class ReadModelIndexImpl implements ReadModelIndex {
  constructor(private readonly policyExplanation: PolicyExplanationPort) {}
  /** Last contiguous cursor successfully projected (null until any advance). */
  private observedCursor: CommitCursor | null = null;

  /** eventIds already applied (dedupe across replays / rebuild feeds). */
  private readonly appliedEventIds = new Set<string>();

  /** (projectId, workspaceId, goalId) -> latest projected GoalView. */
  private readonly rows = new Map<string, GoalView>();

  /** (projectId, goalId) -> latest projected PlanGraphView. */
  private readonly planGraphRows = new Map<string, PlanGraphView>();

  /** (projectId, goalId, taskId) -> latest projected TaskDetailView. */
  private readonly taskDetailRows = new Map<string, TaskDetailView>();

  /** (projectId, goalId, taskId) -> latest projected ActiveAgentView (dispatch). */
  private readonly activeAgentRows = new Map<string, ActiveAgentView>();

  /** (projectId \0 runId) -> taskDetailKey: locates the run row from RunStarted /
   * RunEventRecorded / RunOutcomeUnknown events, which carry only the runId (not the goalId). */
  private readonly runKeyIndex = new Map<string, string>();

  /** (projectId, goalId) -> accepted PlanRevisionSnapshot (verification: the plan the
   * verification view derives applicability under — rebuilt from events). */
  private readonly planSnapshots = new Map<string, PlanRevisionSnapshot>();

  /** (projectId, goalId, taskId) -> latest projected verification view row. */
  private readonly verificationRows = new Map<string, VerificationProjection>();

  /** (projectId, goalId) -> latest projected GoalStatusView (context assembly). */
  private readonly goalStatusRows = new Map<string, GoalStatusView>();

  /** (projectId, goalId) -> goal timeline entries in arrival order (context assembly). */
  private readonly goalTimelineRows = new Map<string, GoalTimelineEntry[]>();

  /** (projectId, goalId, taskId) -> latest projected HandoffProvenanceView (handoff). */
  private readonly handoffProvenanceRows = new Map<string, HandoffProvenanceView>();

  /** (projectId, workspaceId) -> latest projected WorkspaceLeaseView (workspace concurrency). */
  private readonly workspaceLeaseRows = new Map<string, WorkspaceLeaseView>();

  /** (projectId, goalId, taskId) -> latest projected IntegrationConflictView (workspace concurrency). */
  private readonly integrationConflictRows = new Map<string, IntegrationConflictView>();

  /** (projectId, workspaceId) -> latest projected WorkspacePatchView (workspace concurrency). */
  private readonly workspacePatchRows = new Map<string, WorkspacePatchView>();

  // ------------------------------------------------------------------ //
  // Console projection rows (consumes ONLY existing v1 events).  //
  // Row stores hold shared view structure; the projection handlers fill the //
  // per-view apply/query logic in their delimited regions below.       //
  // ------------------------------------------------------------------ //

  /** overview projection: (projectId, workspaceId) -> PortfolioEntry (WorkspaceBootstrapped projection). */
  private readonly consolePortfolioEntries = new Map<string, PortfolioEntry>();
  /** overview projection: (projectId, workspaceId) -> WorkspaceSummaryView. */
  private readonly consoleSummaryRows = new Map<string, import("../../contracts/console-views.js").WorkspaceSummaryView>();
  /** overview projection: (projectId, workspaceId, goalId, taskId) -> latest TaskReduction phase
   * (feeds phaseCounts.taskReduction "每任务最新相位计数" — decrement old, increment new). */
  private readonly consoleTaskReductionPhase = new Map<string, import("../../contracts/reduction.js").TaskReductionPhase>();
  /** overview projection: (projectId, workspaceId, goalId) -> latest GoalPhase
   * (feeds phaseCounts.goalPhase "每 Goal 最新相位计数"). */
  private readonly consoleGoalPhase = new Map<string, import("../../contracts/goal-phase.js").GoalPhase>();
  /** Work-context overview projection: full-scope key -> WorkContextBinding snapshot (binding rows). */
  private readonly workContextBindings = new Map<string, import("../../contracts/context-continuity.js").WorkContextBindingSnapshot>();
  private readonly queryJobs = new Map<string, import("../../contracts/query-job.js").QueryJobV1>();
  private readonly queryRuns = new Map<string, import("../../contracts/query-job.js").QueryRunV1>();
  private readonly queryAnswers = new Map<string, import("../../contracts/query-job.js").QueryJobAnswerV1[]>();
  private readonly controlIntentIntentRows = new Map<string, ControlIntentProjectionRow[]>();
  /** Material-access: material-access grants in commit order (immutable rows). */
  private readonly materialAccessGrantRows: import("../../contracts/material-access.js").MaterialAccessGrantRow[] = [];

  // ------------------------------------------------------------------ //
  // Plan-change projection rows (proposal/decision +     //
  // revision + accepted-plan snapshots). Row keys are FULL scope keys: //
  // the planChangeScopeKey prefix (projectId, workspaceId, goalId) for //
  // the proposal/decision/revision rows, canonicalJson(plan ref) for   //
  // the accepted-plan snapshot rows — so identical local ids reused    //
  // across Projects / goals NEVER collide (hard isolation).            //
  // ------------------------------------------------------------------ //
  /** scopeKey + "\u0000" + proposalId -> PlanProposalSnapshot. */
  private readonly planChangeProposals = new Map<string, PlanProposalSnapshot>();
  /** scopeKey + "\u0000" + decisionId -> UserDecisionSnapshot. */
  private readonly planChangeDecisions = new Map<string, UserDecisionSnapshot>();
  /** scopeKey -> GoalRevisionSnapshot[] appended in revision-ascending order. */
  private readonly planChangeGoalRevisions = new Map<string, GoalRevisionSnapshot[]>();
  /** canonicalJson(PlanRevision ref) -> accepted PlanRevisionSnapshot (every accept stored; idempotent overwrite). */
  private readonly planChangePlanSnapshots = new Map<string, PlanRevisionSnapshot>();
  /** Work-context overview projection: full-scope key -> ordered ExecutionNote rows (notes part). */
  private readonly workContextNotes = new Map<string, import("../../contracts/context-continuity.js").WorkContextNoteRow[]>();
  /** detail-view projection: (projectId, workspaceId, goalId) -> PlanMatrixView. */
  private readonly consoleMatrixRows = new Map<string, import("../../contracts/console-views.js").PlanMatrixView>();
  /** detail-view projection: (projectId, workspaceId, goalId, taskId) -> ActiveAgentRunRow. */
  private readonly consoleAgentRows = new Map<string, import("../../contracts/console-views.js").ActiveAgentRunRow>();
  /** detail-view projection: (projectId, workspaceId, goalId, taskId) -> latest handoff marker. */
  private readonly consoleHandoffMarkers = new Map<string, import("../../contracts/console-views.js").ActiveAgentRunRow["handoff"]>();
  /** detail-view projection: (projectId, workspaceId, goalId, taskId) -> task evidence projection. */
  private readonly consoleEvidenceProjections = new Map<string, {
    projectId: string;
    workspaceId: string;
    goalId: string;
    taskId: string;
    evidence: { evidence: import("../../contracts/evidence.js").EvidenceV1; admittedAt: string; evidenceIndex: number; sourceCursor: import("../../contracts/command-event.js").CommitCursor }[];
    reduction: import("../../contracts/reduction.js").TaskReductionSnapshot | null;
    reductionCursor: import("../../contracts/command-event.js").CommitCursor | null;
    planRef: import("../../contracts/plan.js").PlanRevisionRef;
    planRevision: number;
    sourceCursor: import("../../contracts/command-event.js").CommitCursor;
    updatedAt: string | null;
  }>();
  /** detail-view projection: (projectId, workspaceId) -> timeline entries in arrival order. */
  private readonly consoleTimelineRows = new Map<string, import("../../contracts/console-views.js").TimelineEntry[]>();
  /** detail-view projection: per-workspace timeline seq counter. */
  private readonly consoleTimelineSeq = new Map<string, number>();
  // ------------------------------------------------------------------ //
  // Architecture-inspection projection rows (brief/proposal are  //
  // detail-view projection; inspection/finding are overview projection and feed the SAME view).     //
  // ------------------------------------------------------------------ //

  /** overview projection: scopeKey -> inspection snapshots (fed by applyArchitectureInspectionFacts). */
  private readonly architectureInspectionInspectionRows = new Map<string, import("../../contracts/architecture-inspection.js").ArchitectureInspectionSnapshot[]>();
  /** overview projection: scopeKey -> finding snapshots (fed by applyArchitectureInspectionFacts). */
  private readonly architectureInspectionFindingRows = new Map<string, import("../../contracts/architecture-inspection.js").ArchitectureFindingSnapshot[]>();
  /** detail-view projection: scopeKey -> decision brief snapshots (fed by applyArchitectureDecisionArtifacts). */
  private readonly architectureInspectionBriefRows = new Map<string, import("../../contracts/architecture-inspection.js").ArchitectureDecisionBriefSnapshot[]>();
  /** detail-view projection: scopeKey -> candidate proposal snapshots (fed by applyArchitectureDecisionArtifacts). */
  private readonly architectureInspectionProposalRows = new Map<string, import("../../contracts/architecture-inspection.js").ArchitectureCandidateProposalSnapshot[]>();

  // ------------------------------------------------------------------ //
  // Work-context view storage (co-owned by overview projection + detail-view projection).      //
  // overview projection is authoritative for the binding + notes rows; detail-view projection owns   //
  // the continuation rows + frontier aggregation. The combined          //
  // workContext() view composes all three. Rows are keyed by the        //
  // FULL-scope key (canonicalJson of the complete work-context ref),    //
  // so two projects / workspaces reusing the same local workId NEVER    //
  // collide (hard isolation).                                           //
  // ------------------------------------------------------------------ //
  /** detail-view projection: full-scope key -> ContinuationRecordSnapshot[] (arrival order). */
  private readonly workContextContinuationRows = new Map<string, import("../../contracts/context-continuity.js").ContinuationRecordSnapshot[]>();

  // ------------------------------------------------------------------ //
  // Baseline-evolution projection rows (candidate /      //
  // decision / gate / activation). Row keys are FULL workspace scope   //
  // keys: consoleWorkspaceKey(projectId, workspaceId) + "\u0000" + id  //
  // — so identical local ids reused across Projects / workspaces NEVER //
  // collide (hard isolation). The view derives defaultPin + stale      //
  // markers + notRebasedPlans from these rows at query time.          //
  // ------------------------------------------------------------------ //
  /** scopeKey + "\u0000" + candidateId -> CandidateArchitectureBaselineSnapshot. */
  private readonly baselineEvolutionCandidates = new Map<string, CandidateArchitectureBaselineSnapshot>();
  /** scopeKey + "\u0000" + decisionId -> { ref, decision: ArchitectureChangeDecisionV1 }. */
  private readonly baselineEvolutionDecisions = new Map<string, { ref: ArchitectureChangeDecisionRef; decision: ArchitectureChangeDecisionV1 }>();
  /** scopeKey + "\u0000" + gateId -> { ref, gate: MigrationGateTaskV1 }. */
  private readonly baselineEvolutionGates = new Map<string, { ref: MigrationGateTaskRef; gate: MigrationGateTaskV1 }>();
  /** scopeKey + "\u0000" + activationId -> { ref, activation: BaselineActivationV1 }. */
  private readonly baselineEvolutionActivations = new Map<string, { ref: BaselineActivationRef; activation: BaselineActivationV1 }>();

  // ------------------------------------------------------------------ //
  // Collaboration unified-status projection rows (detail-view projection: proposal / decision / //
  // policy / activation). Proposal + decision rows are workspace-scoped;//
  // policy + activation rows are PROJECT-scoped (their events carry     //
  // workspaceId ""), so the view gathers them by projectId. Each row    //
  // wraps the snapshot with the sourceCursor that produced it, so the  //
  // facts-first entries can carry per-fact lineage.                     //
  // ------------------------------------------------------------------ //
  /** scopeKey + "\u0000" + designId -> { snapshot, sourceCursor }. */
  private readonly collaborationProposalRows = new Map<string, { snapshot: InitialDesignProposalSnapshot; sourceCursor: CommitCursor }>();
  /** scopeKey + "\u0000" + decisionId -> { snapshot, sourceCursor }. */
  private readonly collaborationDecisionRows = new Map<string, { snapshot: InitialDesignDecisionSnapshot; sourceCursor: CommitCursor }>();
  /** consoleWorkspaceKey(projectId, "") + "\u0000" + policyId -> { snapshot, sourceCursor }. */
  private readonly collaborationPolicyRows = new Map<string, { snapshot: CoordinationPolicyRevisionSnapshot; sourceCursor: CommitCursor }>();
  /** consoleWorkspaceKey(projectId, "") + "\u0000" + projectId -> { snapshot, sourceCursor }. */
  private readonly collaborationActivationRows = new Map<string, { snapshot: ProjectCoordinationPolicyActiveSnapshot; sourceCursor: CommitCursor }>();

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
      // up front — nothing may be partially applied.
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
      for (const snapshot of reviewProjectionChanges(event, this.reviewRecords())) this.reviewSnapshots.set(canonicalJson(snapshot.ref), structuredClone(snapshot));
      if (event.eventType === "GoalCreated") {
        this.applyGoalCreated(event, positioned.cursor);
      } else if (event.eventType === "PlanRevisionAccepted") {
        this.applyPlanRevisionAccepted(event, positioned.cursor);
      } else if (event.eventType === "TaskClaimed") {
        this.applyTaskClaimed(event, positioned.cursor);
      } else if (event.eventType === "RunStarted") {
        this.applyRunStarted(event, positioned.cursor);
      } else if (event.eventType === "RunEventRecorded") {
        this.applyRunEventRecorded(event, positioned.cursor);
      } else if (event.eventType === 'ExecutionRetryScheduled') {
        this.applyExecutionRetry(event, positioned.cursor);
      } else if (event.eventType === 'RunReconciled') {
        const proof = event.payload.run.reconciliation?.observation;
        if (proof?.kind === 'runtime_terminal') this.applyRunEventRecorded({ ...event, eventType: 'RunEventRecorded',
          payload: { taskId: event.payload.run.task.taskId, runtimeEvent: proof.event } }, positioned.cursor);
      } else if (event.eventType === "RunOutcomeUnknown") {
        this.applyRunOutcomeUnknown(event, positioned.cursor);
      } else if (event.eventType === "EvidenceAdmitted") {
        this.applyEvidenceAdmitted(event, positioned.cursor);
      } else if (event.eventType === "TaskReductionUpdated") {
        this.applyTaskReductionUpdated(event, positioned.cursor);
      } else if (event.eventType === "GoalPhaseUpdated") {
        this.applyGoalPhaseUpdated(event, positioned.cursor);
      } else if (event.eventType === "HandoffRecorded") {
        this.applyHandoffRecorded(event, positioned.cursor);
      } else if (event.eventType === "ReplacementClaimed") {
        this.applyReplacementClaimed(event, positioned.cursor);
      } else if (event.eventType === "WorkspaceReadLeaseGranted") {
        this.applyWorkspaceReadLeaseGranted(event, positioned.cursor);
      } else if (event.eventType === "WorkspaceReadLeaseReleased") {
        this.applyWorkspaceReadLeaseReleased(event, positioned.cursor);
      } else if (event.eventType === "WorkspaceWriteLeaseGranted") {
        this.applyWorkspaceWriteLeaseGranted(event, positioned.cursor);
      } else if (event.eventType === "WorkspaceWriteLeaseReleased") {
        this.applyWorkspaceWriteLeaseReleased(event, positioned.cursor);
      } else if (event.eventType === "IntegrationJoined") {
        this.applyIntegrationJoined(event, positioned.cursor);
      } else if (event.eventType === "PatchRecorded") {
        this.applyPatchRecorded(event, positioned.cursor);
      }
      // Console projections consume the SAME committed events (no new
      // DomainEvent is introduced); the overview and detail handlers feed the console read
      // views. Each handler below owns one current projection concern.
      this.applyConsoleEvent(event, positioned.cursor);

      // Material-access grants (one immutable row per grant).
      this.applyMaterialAccessEvent(event, positioned.cursor);

      // Work-context projections (WorkContextBound / WorkRunLinked /
      // ExecutionNoteRecorded / ContinuationRecorded). Handler + isHandledEventType
      // are updated with the handled-event set; unknown events stop advance().
      this.applyWorkContext(event, positioned.cursor);

      // Architecture-inspection projections (4 new events; handler +
      // isHandledEventType are maintained together).
      this.applyArchitectureInspectionEvent(event, positioned.cursor);

      // Control-intent projections (desired state + safe-point acks).
      this.applyControlIntentEvent(event, positioned.cursor);
      this.applyQueryEvent(event, positioned.cursor);

      // Plan-change projections (PlanProposalRecorded / UserDecisionRecorded /
      // GoalRevisionRecorded / PlanRevisionSuperseded; handler + isHandledEventType
      // share one dispatcher while preserving fact and detail-view projection responsibilities).
      this.applyPlanChangeEvent(event, positioned.cursor);

      // Architecture-evolution governance and remediation events have no display projection.
      // Registering them prevents projection advance from stalling.
      this.applyArchitectureEvolutionEvent(event, positioned.cursor);

      // Baseline-evolution events (candidate/decision/gate/activation -> baselineChangeView).
      this.applyBaselineEvolutionEvent(event, positioned.cursor);
    // Collaboration initial-design/coordination-policy events.
    this.applyCollaborationEvent(event, positioned.cursor);

      // Known non-goal / non-plan / non-dispatch events
      // (ProjectBootstrapped, WorkspaceBootstrapped, CompletionPolicyInstalled,
      // ArchitectureBaselineInstalled, CompletionPolicyActivated,
      // ArchitectureBaselineActivated) only advance the cursor; they project
      // no Goal / Plan Graph / Task Detail / ActiveAgent row.
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

  async planGraph(query: PlanGraphViewQuery): Promise<PlanGraphViewResult> {
    const observedCursor = this.observedCursor;
    const row = this.planGraphRows.get(planGraphKey(query.projectId, query.goalId));

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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
    // "not_ready" (identical to goal() — never not_found here).
    if (row) return { status: "ready", graph: row, observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor,
    };
  }

  async taskDetail(query: TaskDetailViewQuery): Promise<TaskDetailViewResult> {
    const observedCursor = this.observedCursor;
    const row = this.taskDetailRows.get(
      taskDetailKey(query.projectId, query.goalId, query.taskId),
    );

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
        if (row) return { status: "ready", task: row, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return {
        status: "not_ready",
        requiredCursor: query.atLeastCursor,
        observedCursor,
      };
    }

    // No atLeastCursor: show the row if present, else not_ready (never not_found).
    if (row) return { status: "ready", task: row, observedCursor: observedCursor! };
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

  /**
   * PlanRevisionAccepted@1 -> ① refresh the Goal row (activePlanRevision =
   * snapshot.ref, aggregateRevision = payload.goalAggregateRevision,
   * sourceCursor = current cursor); ② upsert the (projectId, goalId) Plan
   * Graph row; ③ upsert one (projectId, goalId, taskId) Task Detail row per
   * task. All fields come from the accepted snapshot (the fixed pins).
   */
  private applyPlanRevisionAccepted(event: PlanRevisionAcceptedEvent, cursor: CommitCursor): void {
    const snapshot = event.payload.planRevision;
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const workspaceId = event.workspaceId;

    // verification: retain the accepted plan snapshot (tasks + obligations) so the
    // verification view can recompute evidence applicability at query time.
    this.planSnapshots.set(planGraphKey(projectId, goalId), snapshot);

    // ① Goal row refresh (only when the GoalCreated row is present).
    const gk = goalKey(projectId, workspaceId, goalId);
    const goalRow = this.rows.get(gk);
    if (goalRow) {
      this.rows.set(gk, {
        ...goalRow,
        activePlanRevision: snapshot.ref,
        aggregateRevision: event.payload.goalAggregateRevision,
        sourceCursor: cursor,
      });
    }

    // ② Plan Graph row (full-scope (projectId, goalId)).
    const graph: PlanGraphView = {
      projectId,
      goalId,
      planRef: snapshot.ref,
      planRevision: snapshot.planRevision,
      acceptedAt: snapshot.acceptedAt,
      pinnedCompletionPolicy: snapshot.effectiveCompletionPolicy,
      pinnedArchitectureBaseline: snapshot.effectiveArchitectureBaseline,
      stages: snapshot.stages,
      tasks: snapshot.tasks,
      taskHierarchy: snapshot.taskHierarchy,
      executionDag: snapshot.executionDag,
      sourceCursor: cursor,
    };
    this.planGraphRows.set(planGraphKey(projectId, goalId), graph);

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
      const detail: TaskDetailView = {
        projectId,
        goalId,
        taskId: task.taskId,
        title: task.title,
        stageId: task.stageId ?? null,
        requirementLevel: task.requirementLevel,
        taskKind: task.taskKind,
        disposition: task.disposition,
        phase: task.phase,
        scope: task.scope,
        obligations,
        // dispatch: run-state projection is D (null until a TaskClaimed event).
        run: null,
        sourceCursor: cursor,
      };
      this.taskDetailRows.set(taskDetailKey(projectId, goalId, task.taskId), detail);
    }
  }

  /** dispatch: active agent view — same opaque-cursor freshness as planGraph / taskDetail. */
  /** handoff: display-only handoff provenance timeline (keyed by full-scope
   * (projectId, goalId, taskId); NEVER judges completion). Freshness mirrors
   * goalStatus(): not_found only when atLeastCursor is provided AND already
   * covered AND there is no row; otherwise the freshness-safe not_ready. */
  async handoffProvenance(query: HandoffProvenanceViewQuery): Promise<HandoffProvenanceViewResult> {
    const observedCursor = this.observedCursor;
    const row = this.handoffProvenanceRows.get(
      taskDetailKey(query.projectId, query.goalId, query.taskId),
    );

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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
  // workspace concurrency views (display-only; rebuildable from the EventPage)             //
  // --------------------------------------------------------------------- //

  async workspaceLeaseView(query: WorkspaceLeaseViewQuery): Promise<WorkspaceLeaseViewResult> {
    const observedCursor = this.observedCursor;
    const row = this.workspaceLeaseRows.get(workspaceLeaseKey(query.projectId, query.workspaceId));

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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
    const observedCursor = this.observedCursor;
    const row = this.integrationConflictRows.get(
      integrationConflictKey(query.projectId, query.goalId, query.taskId),
    );

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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
    const observedCursor = this.observedCursor;
    const row = this.workspacePatchRows.get(workspacePatchKey(query.projectId, query.workspaceId));

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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

  async activeAgent(query: ActiveAgentQuery): Promise<ActiveAgentViewResult> {
    const observedCursor = this.observedCursor;
    const row = this.activeAgentRows.get(
      taskDetailKey(query.projectId, query.goalId, query.taskId),
    );

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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

  /** context assembly: goal phase status projection (per (projectId, goalId)). */
  async goalStatus(query: GoalStatusQuery): Promise<GoalStatusViewResult> {
    const observedCursor = this.observedCursor;
    const row = this.goalStatusRows.get(goalPhaseKey(query.projectId, query.goalId));

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
    // "not_ready" (identical to goal()/planGraph()/taskDetail()/activeAgent —
    // the contract forbids returning not_found here).
    if (row) return { status: "ready", goal: row, observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor,
    };
  }

  /** context assembly: goal phase timeline projection (per (projectId, goalId)). */
  async goalTimeline(query: GoalTimelineQuery): Promise<GoalTimelineViewResult> {
    const observedCursor = this.observedCursor;
    const row = this.goalTimelineRows.get(goalPhaseKey(query.projectId, query.goalId));

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
        if (row) return { status: "ready", timeline: [...row], observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return {
        status: "not_ready",
        requiredCursor: query.atLeastCursor,
        observedCursor,
      };
    }

    // No atLeastCursor: show the rows if present, else the freshness-safe
    // "not_ready" (never not_found here, mirroring goalStatus()).
    if (row) return { status: "ready", timeline: [...row], observedCursor: observedCursor! };
    return {
      status: "not_ready",
      requiredCursor: observedCursor ?? makeCommitCursor(1),
      observedCursor,
    };
  }

  // ------------------------------------------------------------------ //
  // dispatch run projection handlers                                        //
  // ------------------------------------------------------------------ //

  /** TaskClaimed@1 -> create/refresh the (projectId, goalId, taskId) ActiveAgent row
   * and sync the TaskDetail row's run state. lease.grantedAt = claimedAt; the Run
   * starts at status "starting" with lastEventSeq 0. */
  private applyTaskClaimed(event: TaskClaimedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const taskId = event.payload.taskId;
    const key = taskDetailKey(projectId, goalId, taskId);

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
    this.activeAgentRows.set(key, row);
    this.runKeyIndex.set(projectId + "\u0000" + event.payload.runRef.runId, key);
    this.syncTaskDetailRun(projectId, goalId, taskId, taskRunStateFrom(row), cursor);
  }

  /** RunStarted@1 -> refresh agent.run{status running, startedAt} + attempt{started,
   * startedAt} and the row's sourceCursor. */
  private applyRunStarted(event: RunStartedEvent, cursor: CommitCursor): void {
    const key = this.runKeyIndex.get(event.projectId + "\u0000" + event.aggregateId);
    if (!key) return;
    const row = this.activeAgentRows.get(key);
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
    this.activeAgentRows.set(key, updated);
    this.syncTaskDetailRun(updated.projectId, updated.goalId, updated.taskId, taskRunStateFrom(updated), cursor);
  }

  /** RunEventRecorded@1 -> fold on payload.runtimeEvent, idempotent against the row's
   * lastEventSeq (sequence <= lastEventSeq changes nothing). Terminal runtime events end
   * the Run AND the Attempt; crash/completed/cancelled/budget_exhausted map to the
   * terminal outcome. NEVER touches TaskDetail.phase (satisfaction is verification). */
  private applyRunEventRecorded(event: RunEventRecordedEvent, cursor: CommitCursor): void {
    const key = this.runKeyIndex.get(event.projectId + "\u0000" + event.aggregateId);
    if (!key) return;
    const row = this.activeAgentRows.get(key);
    if (!row) return;

    const rt = event.payload.runtimeEvent;
    // Projection idempotency: never let a replayed/stale runtime event regress the row.
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
    this.activeAgentRows.set(key, updated);
    this.syncTaskDetailRun(updated.projectId, updated.goalId, updated.taskId, taskRunStateFrom(updated), cursor);
  }

  /** RunOutcomeUnknown@1 -> explicit "no terminal signal" fact: run ended with
   * outcome_unknown (NEVER inferred from crash) + attempt ended. */
  private applyExecutionRetry(event: import('../../contracts/dispatch.js').ExecutionRetryScheduledEvent, cursor: CommitCursor): void {
    const key = this.runKeyIndex.get(event.projectId + '\u0000' + event.aggregateId);
    if (!key) return;
    const row = this.activeAgentRows.get(key);
    if (!row) return;
    const updated: ActiveAgentView = { ...row, sourceCursor: cursor,
      run: { ...row.run, status: 'starting', outcome: null, startedAt: null, endedAt: null, sourceCursor: cursor },
      attempt: { ...row.attempt, status: 'claimed', endOutcome: null, startedAt: null, endedAt: null, sourceCursor: cursor } };
    this.activeAgentRows.set(key, updated);
    this.syncTaskDetailRun(updated.projectId, updated.goalId, updated.taskId, taskRunStateFrom(updated), cursor);
  }

  private applyRunOutcomeUnknown(event: RunOutcomeUnknownEvent, cursor: CommitCursor): void {
    const key = this.runKeyIndex.get(event.projectId + "\u0000" + event.aggregateId);
    if (!key) return;
    const row = this.activeAgentRows.get(key);
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
    this.activeAgentRows.set(key, updated);
    this.syncTaskDetailRun(updated.projectId, updated.goalId, updated.taskId, taskRunStateFrom(updated), cursor);
  }

  /** Push the run-state part of an ActiveAgentView onto the matching TaskDetail row.
   * The TaskDetail row is only touched when a PlanRevisionAccepted already created it
   * (claim only happens for a task in an accepted plan); its phase and plan fields are
   * NEVER modified here — they come only from PlanRevisionAccepted. */
  private syncTaskDetailRun(
    projectId: string,
    goalId: string,
    taskId: string,
    runState: TaskRunState,
    cursor: CommitCursor,
  ): void {
    const key = taskDetailKey(projectId, goalId, taskId);
    const row = this.taskDetailRows.get(key);
    if (!row) return;
    this.taskDetailRows.set(key, { ...row, run: runState, sourceCursor: cursor });
  }

  // ------------------------------------------------------------------ //
  // Verification projection handlers                               //
  // ------------------------------------------------------------------ //

  /** EvidenceAdmitted@1 -> append the immutable Evidence + admission metadata to
   * the (projectId, goalId, taskId) verification row (admission order). The
   * evidence row is independent of the plan row (applyPlan already created it). */
  private applyEvidenceAdmitted(event: EvidenceAdmittedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const taskId = event.payload.taskId;
    const key = taskDetailKey(projectId, goalId, taskId);
    const row = this.ensureVerificationRow(projectId, goalId, taskId, cursor);
    row.evidence.push({
      evidence: event.payload.evidence,
      admittedAt: event.payload.admittedAt,
      evidenceIndex: event.payload.evidenceIndex,
    });
    row.sourceCursor = cursor;
    this.verificationRows.set(key, row);

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
    this.handoffProvenanceRows.set(taskDetailKey(projectId, goalId, taskId), provRow);
  }

  /** TaskReductionUpdated@1 -> refresh the task's canonical reduction snapshot.
   * It is a projected FACT (never derived from report text at query time). */
  private applyTaskReductionUpdated(event: TaskReductionUpdatedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const taskId = event.payload.taskId;
    const key = taskDetailKey(projectId, goalId, taskId);
    const row = this.ensureVerificationRow(projectId, goalId, taskId, cursor);
    row.reduction = event.payload.reduction;
    row.reductionCursor = cursor;
    row.sourceCursor = cursor;
    this.verificationRows.set(key, row);
  }

  /** Get or create the per-task verification row (full-scope key). */
  private ensureVerificationRow(
    projectId: string,
    goalId: string,
    taskId: string,
    cursor: CommitCursor,
  ): VerificationProjection {
    const key = taskDetailKey(projectId, goalId, taskId);
    const existing = this.verificationRows.get(key);
    if (existing) return existing;
    const row: VerificationProjection = {
      projectId,
      goalId,
      taskId,
      evidence: [],
      reduction: null,
      reductionCursor: null,
      sourceCursor: cursor,
    };
    this.verificationRows.set(key, row);
    return row;
  }

  /** verification: task-detail verification view (versioned query entry).
   * The view is rebuilt ONLY from events: applicability is recomputed at query
   * time through Control's read-only policy explanation against the projected
   * current anchor; the reduction is the projected reduction fact. */
  async taskVerification(query: TaskVerificationViewQuery): Promise<TaskVerificationViewResult> {
    const observedCursor = this.observedCursor;
    const row = this.verificationRows.get(
      taskDetailKey(query.projectId, query.goalId, query.taskId),
    );

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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
      planSnapshot: this.planSnapshots.get(planGraphKey(row.projectId, row.goalId)) ?? null,
      policyExplanation: this.policyExplanation,
      review: reviewProjectionFacts(this.reviewRecords()),
    });
  }

  // context assembly goal phase projection handler                                //
  // ------------------------------------------------------------------ //

  /** GoalPhaseUpdated@1 -> upsert the (projectId, goalId) GoalStatusView row AND
   * append one GoalTimelineEntry in arrival order. The view is rebuilt ONLY from
   * the event payload (never from a ledger snapshot); sourceCursor is the
   * positioned cursor; observedCursor/checkpoint stay under the existing
   * advance() mechanism. */
  private applyGoalPhaseUpdated(event: GoalPhaseUpdatedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;

    const row: GoalStatusView = {
      projectId,
      goalId,
      phase: event.payload.phase,
      previousPhase: event.payload.previousPhase,
      planRef: event.payload.planRef === null ? null : { ...event.payload.planRef },
      reasonCodes: [...event.payload.reasonCodes],
      explanation: event.payload.explanation,
      sideEffectReconciliation: event.payload.sideEffectReconciliation,
      aggregateRevision: event.aggregateRevision,
      sourceCursor: cursor,
      updatedAt: event.payload.reducedAt,
    };
    this.goalStatusRows.set(goalPhaseKey(projectId, goalId), row);

    const entry: GoalTimelineEntry = {
      phase: event.payload.phase,
      previousPhase: event.payload.previousPhase,
      reasonCodes: [...event.payload.reasonCodes],
      explanation: event.payload.explanation,
      aggregateRevision: event.aggregateRevision,
      reducedAt: event.payload.reducedAt,
      eventId: event.eventId,
      sourceCursor: cursor,
    };
    const list = this.goalTimelineRows.get(goalPhaseKey(projectId, goalId)) ?? [];
    list.push(entry);
    this.goalTimelineRows.set(goalPhaseKey(projectId, goalId), list);
  }

  // ------------------------------------------------------------------ //
  // Handoff provenance projection handlers                        //
  // ------------------------------------------------------------------ //

  /** Get or create the per-task handoff provenance row (full-scope key). */
  private ensureHandoffProvenanceRow(
    projectId: string,
    goalId: string,
    taskId: string,
    cursor: CommitCursor,
  ): HandoffProvenanceView {
    const key = taskDetailKey(projectId, goalId, taskId);
    const existing = this.handoffProvenanceRows.get(key);
    if (existing) return existing;
    const row: HandoffProvenanceView = {
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
    this.handoffProvenanceRows.set(key, row);
    return row;
  }

  /** HandoffRecorded@1 -> append a packet_recorded entry + packetRef and snapshot
   * the row's taskRevision / planRef from the packet (the row is created here if
   * absent — it carries ONLY event fields, never depends on a Plan event). */
  private applyHandoffRecorded(event: HandoffRecordedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const taskId = event.payload.taskId;
    const key = taskDetailKey(projectId, goalId, taskId);
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
    } satisfies HandoffProvenanceEntry);
    row.packetRefs.push(handoffPacketRefFor(projectId, goalId, taskId, packet.packetId));
    row.taskRevision = packet.taskRevision;
    row.planRef = { ...packet.planRef };
    row.sourceCursor = cursor;
    this.handoffProvenanceRows.set(key, row);
  }

  /** ReplacementClaimed@1 -> append a replacement_claimed entry + replacementRef. */
  private applyReplacementClaimed(event: ReplacementClaimedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const goalId = event.payload.goalId;
    const taskId = event.payload.taskId;
    const key = taskDetailKey(projectId, goalId, taskId);
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
    } satisfies HandoffProvenanceEntry);
    row.replacementRefs.push({ ...event.payload.replacementRef });
    row.sourceCursor = cursor;
    this.handoffProvenanceRows.set(key, row);
  }

  // ------------------------------------------------------------------ //
  // workspace concurrency lease / integration / patch projection handlers              //
  // ------------------------------------------------------------------ //

  private ensureWorkspaceLeaseRow(
    projectId: string,
    workspaceId: string,
    cursor: CommitCursor,
    occurredAt: string,
  ): WorkspaceLeaseView {
    const key = workspaceLeaseKey(projectId, workspaceId);
    const existing = this.workspaceLeaseRows.get(key);
    if (existing) return existing;
    const row: WorkspaceLeaseView = {
      projectId,
      workspaceId,
      writeLease: null,
      readLeases: [],
      sourceCursor: cursor,
      updatedAt: occurredAt,
    };
    this.workspaceLeaseRows.set(key, row);
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
    this.workspaceLeaseRows.set(workspaceLeaseKey(event.projectId, event.workspaceId), row);
  }

  /** WorkspaceReadLeaseReleased@1 -> mark the matching read lease released. */
  private applyWorkspaceReadLeaseReleased(event: WorkspaceReadLeaseReleasedEvent, cursor: CommitCursor): void {
    const key = workspaceLeaseKey(event.projectId, event.workspaceId);
    const row = this.ensureWorkspaceLeaseRow(event.projectId, event.workspaceId, cursor, event.occurredAt);
    const entry = row.readLeases.find((l) => l.leaseId === event.payload.leaseId);
    if (entry) {
      entry.status = "released";
      entry.releasedAt = event.payload.releasedAt;
    }
    row.sourceCursor = cursor;
    row.updatedAt = event.occurredAt;
    this.workspaceLeaseRows.set(key, row);
  }

  /** WorkspaceWriteLeaseGranted@1 -> the workspace's SINGLE write-lease entry
   * (index CAS guarantees exclusivity; a new grant over a vacated expired
   * lease replaces the entry). */
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
    this.workspaceLeaseRows.set(workspaceLeaseKey(event.projectId, event.workspaceId), row);
  }

  /** WorkspaceWriteLeaseReleased@1 -> release the workspace write lease (explicit,
   * patch-record, or expiry-vacate). The patch-record path carries the
   * postWriteWorkspaceRevision and also seeds the patch-view fallback revision. */
  private applyWorkspaceWriteLeaseReleased(event: WorkspaceWriteLeaseReleasedEvent, cursor: CommitCursor): void {
    const key = workspaceLeaseKey(event.projectId, event.workspaceId);
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
    this.workspaceLeaseRows.set(key, row);

    // workspace concurrency patch-view fallback: a write release that carries a post-write
    // revision (patch-record) is the canonical revision source when no
    // PatchRecorded is present. The explicit-release path (postWrite null)
    // never creates a phantom patch row.
    if (event.payload.postWriteWorkspaceRevision !== null) {
      const patchRow = this.ensureWorkspacePatchRow(event.projectId, event.workspaceId, cursor, event.occurredAt);
      patchRow.workspaceRevision = event.payload.postWriteWorkspaceRevision;
      patchRow.sourceCursor = cursor;
      patchRow.updatedAt = event.occurredAt;
      this.workspacePatchRows.set(workspacePatchKey(event.projectId, event.workspaceId), patchRow);
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
    this.integrationConflictRows.set(integrationConflictKey(projectId, goalId, taskId), row);
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
    this.workspacePatchRows.set(workspacePatchKey(projectId, workspaceId), patchRow);

    // The same patch records its ref on the (single) write lease of the
    // workspace — the patch-record path releases it via the following event.
    const leaseRow = this.workspaceLeaseRows.get(workspaceLeaseKey(projectId, workspaceId));
    if (leaseRow && leaseRow.writeLease) {
      leaseRow.writeLease.patches.push(patchRecordRefFor(projectId, event.payload.patchId));
      leaseRow.sourceCursor = cursor;
      leaseRow.updatedAt = event.occurredAt;
      this.workspaceLeaseRows.set(workspaceLeaseKey(projectId, workspaceId), leaseRow);
    }
  }

  private ensureWorkspacePatchRow(
    projectId: string,
    workspaceId: string,
    cursor: CommitCursor,
    occurredAt: string,
  ): WorkspacePatchView {
    const key = workspacePatchKey(projectId, workspaceId);
    const existing = this.workspacePatchRows.get(key);
    if (existing) return existing;
    const row: WorkspacePatchView = {
      projectId,
      workspaceId,
      workspaceRevision: 1,
      patches: [],
      sourceCursor: cursor,
      updatedAt: occurredAt,
    };
    this.workspacePatchRows.set(key, row);
    return row;
  }

  private ensureIntegrationConflictRow(
    projectId: string,
    goalId: string,
    taskId: string,
    cursor: CommitCursor,
    occurredAt: string,
  ): IntegrationConflictView {
    const key = integrationConflictKey(projectId, goalId, taskId);
    const existing = this.integrationConflictRows.get(key);
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
    this.integrationConflictRows.set(key, row);
    return row;
  }
  /** Update console views from committed events; projection never creates domain events. */
  private applyConsoleEvent(event: DomainEvent, cursor: CommitCursor): void {
    this.applyConsoleOverview(event, cursor);
    this.applyConsoleDetails(event, cursor);
  }
  private applyWorkContext(event: DomainEvent, cursor: CommitCursor): void {
    const change = projectWorkContext(event, cursor, key => this.workContextBindings.get(key));
    if (!change) return;
    if (change.kind === 'binding') this.workContextBindings.set(change.key, change.snapshot);
    else if (change.kind === 'note') {
      const rows = this.workContextNotes.get(change.key) ?? [];
      rows.push(change.row);
      this.workContextNotes.set(change.key, rows);
    } else {
      const rows = this.workContextContinuationRows.get(change.key) ?? [];
      rows.push(change.snapshot);
      this.workContextContinuationRows.set(change.key, rows);
    }
  }


  // Architecture-inspection projections (inspection, finding, brief, proposal).
  private applyArchitectureInspectionEvent(event: DomainEvent, cursor: CommitCursor): void {
    this.applyArchitectureInspectionFacts(event, cursor);
    this.applyArchitectureDecisionArtifacts(event, cursor);
  }

  // Overview projection: inspection and finding rows use the same scope keys as the
  // detail-view architecture artifacts, so the query can compose them into one view.
  private applyArchitectureInspectionFacts(event: DomainEvent, cursor: CommitCursor): void {
    if (event.eventType === "ArchitectureInspectionRecorded") {
      const ev = event as import("../../contracts/architecture-inspection.js").ArchitectureInspectionRecordedEvent;
      const scopeKey = consoleWorkspaceKey(ev.projectId, ev.workspaceId);
      const rows = this.architectureInspectionInspectionRows.get(scopeKey) ?? [];
      rows.push(ev.payload.inspection);
      this.architectureInspectionInspectionRows.set(scopeKey, rows);
    } else if (event.eventType === "ArchitectureFindingRecorded") {
      const ev = event as import("../../contracts/architecture-inspection.js").ArchitectureFindingRecordedEvent;
      const scopeKey = consoleWorkspaceKey(ev.projectId, ev.workspaceId);
      const rows = this.architectureInspectionFindingRows.get(scopeKey) ?? [];
      rows.push({ ref: { aggregateType: "ArchitectureFinding", projectId: ev.projectId, workspaceId: ev.workspaceId, findingId: ev.payload.finding.findingId }, revision: 1, schemaVersion: 1, finding: ev.payload.finding, recordedAt: ev.payload.recordedAt });
      this.architectureInspectionFindingRows.set(scopeKey, rows);
    }
    void cursor;
  }

  // detail-view projection: decision brief + candidate proposal rows.
  private applyArchitectureDecisionArtifacts(event: DomainEvent, cursor: CommitCursor): void {
    if (event.eventType === "ArchitectureDecisionBriefRecorded") {
      const ev = event as import("../../contracts/architecture-inspection.js").ArchitectureDecisionBriefRecordedEvent;
      const brief = ev.payload.brief;
      const snapshot: import("../../contracts/architecture-inspection.js").ArchitectureDecisionBriefSnapshot = {
        ref: { aggregateType: "ArchitectureDecisionBrief", projectId: brief.projectId, workspaceId: brief.workspaceId, briefId: brief.briefId },
        revision: 1,
        schemaVersion: 1,
        brief,
        recordedAt: ev.payload.recordedAt,
      };
      const key = consoleWorkspaceKey(brief.projectId, brief.workspaceId);
      const rows = this.architectureInspectionBriefRows.get(key) ?? [];
      rows.push(snapshot);
      this.architectureInspectionBriefRows.set(key, rows);
    } else if (event.eventType === "ArchitectureCandidateProposalRecorded") {
      const ev = event as import("../../contracts/architecture-inspection.js").ArchitectureCandidateProposalRecordedEvent;
      const proposal = ev.payload.proposal;
      const snapshot: import("../../contracts/architecture-inspection.js").ArchitectureCandidateProposalSnapshot = {
        ref: { aggregateType: "ArchitectureCandidateProposal", projectId: proposal.projectId, workspaceId: proposal.workspaceId, proposalId: proposal.proposalId },
        revision: 1,
        schemaVersion: 1,
        proposal,
        recordedAt: ev.payload.recordedAt,
      };
      const key = consoleWorkspaceKey(proposal.projectId, proposal.workspaceId);
      const rows = this.architectureInspectionProposalRows.get(key) ?? [];
      rows.push(snapshot);
      this.architectureInspectionProposalRows.set(key, rows);
    }
  }

  /** Console overview projection hook (Portfolio + WorkspaceSummary) — rebuilt ONLY from the
   * committed v1 events. Portfolio rows come from WorkspaceBootstrapped; summary
   * rows are touched by every workspace-scoped counter event. Phase COUNT maps
   * track the LATEST phase per task/goal (display-only projection facts). */
  private applyConsoleOverview(event: DomainEvent, cursor: CommitCursor): void {
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
        const prev = this.consoleTaskReductionPhase.get(key);
        if (prev !== undefined) this.consoleDecrementTaskReduction(row, prev);
        this.consoleTaskReductionPhase.set(key, phase);
        this.consoleIncrementTaskReduction(row, phase);
      });
    } else if (event.eventType === "GoalPhaseUpdated") {
      const ev = event as import("../../contracts/goal-phase.js").GoalPhaseUpdatedEvent;
      this.consoleTouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.goalPhaseCount += 1;
        const phase = ev.payload.phase;
        const key = consoleGoalKey(ev.projectId, ev.workspaceId, ev.payload.goalId);
        const prev = this.consoleGoalPhase.get(key);
        if (prev !== undefined) this.consoleDecrementGoalPhase(row, prev);
        this.consoleGoalPhase.set(key, phase);
        this.consoleIncrementGoalPhase(row, phase);
      });
    }
    // Every other event type leaves the workspace summary/portfolio rows
    // unchanged (they are not counter rows in the versioned contract).
  }

  /** WorkspaceBootstrapped -> create/refresh the (projectId, workspaceId)
   * PortfolioEntry AND initialize the WorkspaceSummary row. */
  private consoleApplyBootstrap(
    ev: import("../../contracts/bootstrap.js").WorkspaceBootstrappedEventV1 | import("../../contracts/workspace-registration.js").WorkspaceRegisteredEvent,
    cursor: CommitCursor,
  ): void {
    const key = consoleWorkspaceKey(ev.projectId, ev.workspaceId);
    const existing = this.consolePortfolioEntries.get(key);
    const sourceDigest = ev.payload.sourceDigest;
    const bootstrappedAt = ev.occurredAt;
    if (existing === undefined) {
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
      this.consolePortfolioEntries.set(key, entry);
    } else {
      // Idempotent replay: re-running the same event set reproduces the same row;
      // a genuinely new bootstrap refresh carries updated provenance.
      existing.sourceDigest = sourceDigest;
      existing.bootstrappedAt = bootstrappedAt;
      existing.sourceCursor = cursor;
    }
    this.consoleTouchSummary(ev.projectId, ev.workspaceId, cursor, bootstrappedAt, (row) => {
      row.sourceDigest = sourceDigest;
      row.bootstrappedAt = bootstrappedAt;
    });
  }

  /** Get (or lazily create) the WorkspaceSummary row for the full scope key and
   * apply one counter mutation; every counter event refreshes sourceCursor +
   * updatedAt. */
  private consoleTouchSummary(
    projectId: string,
    workspaceId: string,
    cursor: CommitCursor,
    occurredAt: string,
    update: (row: import("../../contracts/console-views.js").WorkspaceSummaryView) => void,
  ): import("../../contracts/console-views.js").WorkspaceSummaryView {
    const key = consoleWorkspaceKey(projectId, workspaceId);
    let row = this.consoleSummaryRows.get(key);
    if (row === undefined) {
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
      this.consoleSummaryRows.set(key, row);
    } else {
      row.sourceCursor = cursor;
      row.updatedAt = occurredAt;
    }
    update(row);
    return row;
  }

  private consoleIncrementTaskReduction(
    row: import("../../contracts/console-views.js").WorkspaceSummaryView,
    phase: import("../../contracts/reduction.js").TaskReductionPhase,
  ): void {
    row.phaseCounts.taskReduction[phase] = (row.phaseCounts.taskReduction[phase] ?? 0) + 1;
  }

  private consoleDecrementTaskReduction(
    row: import("../../contracts/console-views.js").WorkspaceSummaryView,
    phase: import("../../contracts/reduction.js").TaskReductionPhase,
  ): void {
    row.phaseCounts.taskReduction[phase] = (row.phaseCounts.taskReduction[phase] ?? 0) - 1;
  }

  private consoleIncrementGoalPhase(
    row: import("../../contracts/console-views.js").WorkspaceSummaryView,
    phase: import("../../contracts/goal-phase.js").GoalPhase,
  ): void {
    row.phaseCounts.goalPhase[phase] = (row.phaseCounts.goalPhase[phase] ?? 0) + 1;
  }

  private consoleDecrementGoalPhase(
    row: import("../../contracts/console-views.js").WorkspaceSummaryView,
    phase: import("../../contracts/goal-phase.js").GoalPhase,
  ): void {
    row.phaseCounts.goalPhase[phase] = (row.phaseCounts.goalPhase[phase] ?? 0) - 1;
  }

  // ------------------------------------------------------------------ //
  // Console detail-view projection fields (per-workspace order/seq + index).   //
  // ------------------------------------------------------------------ //

  /** detail-view projection: agent storageKey (consoleTaskKey + "\u0000" + runId) -> workspace arrival seq. */
  private readonly consoleAgentRowSeq = new Map<string, number>();
  /** detail-view projection: consoleWorkspaceKey -> per-workspace agent arrival seq counter. */
  private readonly consoleAgentArrivalSeq = new Map<string, number>();
  /** detail-view projection: (projectId \0 runId) -> agent storageKey (RunStarted / RunEventRecorded /
   * RunOutcomeUnknown carry only the runId). */
  private readonly consoleAgentRunIndex = new Map<string, string>();
  /** detail-view projection: consoleWorkspaceKey -> total timeline arrivals (before the bounded window). */
  private readonly consoleTimelineTotal = new Map<string, number>();

  /** Console detail-view projection hook (PlanMatrix + ActiveAgents + TaskEvidence + Timeline). */
  private applyConsoleDetails(event: DomainEvent, cursor: CommitCursor): void {
    switch (event.eventType) {
      case 'ReviewWorkCreated':
      case 'FailedReviewWorkReplaced':
        this.consoleApplyReviewWorkCreated(event, cursor);
        break;
      case "GoalCreated":
        this.appendConsoleTimeline(event, cursor, "goal_created", { goalId: event.aggregateId }, "goal " + event.aggregateId + " created");
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
        this.appendConsoleTimeline(event, cursor, "goal_phase", { goalId: event.payload.goalId },
          "goal " + event.payload.goalId + " phase " + event.payload.phase);
        break;
      case "HandoffRecorded":
        this.appendConsoleTimeline(event, cursor, "handoff_recorded",
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

  /** Helper: active-agent storage key (full-scope task key + runId). */
  private consoleAgentStorageKey(projectId: string, workspaceId: string, goalId: string, taskId: string, runId: string): string {
    return consoleTaskKey(projectId, workspaceId, goalId, taskId) + "\u0000" + runId;
  }

  /** Helper: workspace-level agent arrival seq (1-based, deterministic). */
  private consoleNextAgentSeq(workspaceKey: string): number {
    const next = (this.consoleAgentArrivalSeq.get(workspaceKey) ?? 0) + 1;
    this.consoleAgentArrivalSeq.set(workspaceKey, next);
    return next;
  }

  /** Helper: append one bounded workspace timeline entry (drop oldest beyond the bound). */
  private appendConsoleTimeline(
    event: { eventId: string; occurredAt: string; projectId: string; workspaceId: string },
    cursor: CommitCursor,
    kind: import("../../contracts/console-views.js").TimelineEntryKind,
    refs: { goalId?: string; taskId?: string; runId?: string; evidenceId?: string; packetId?: string; planId?: string },
    summary: string,
  ): void {
    const workspaceKey = consoleWorkspaceKey(event.projectId, event.workspaceId);
    const seq = (this.consoleTimelineSeq.get(workspaceKey) ?? 0) + 1;
    this.consoleTimelineSeq.set(workspaceKey, seq);
    const total = (this.consoleTimelineTotal.get(workspaceKey) ?? 0) + 1;
    this.consoleTimelineTotal.set(workspaceKey, total);
    const entry: import("../../contracts/console-views.js").TimelineEntry = {
      seq,
      kind,
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      sourceCursor: cursor,
      refs: { projectId: event.projectId, workspaceId: event.workspaceId, ...refs },
      summary,
    };
    const list = this.consoleTimelineRows.get(workspaceKey) ?? [];
    list.push(entry);
    if (list.length > CONSOLE_TIMELINE_MAX_ENTRIES) {
      list.splice(0, list.length - CONSOLE_TIMELINE_MAX_ENTRIES);
    }
    this.consoleTimelineRows.set(workspaceKey, list);
  }

  /** detail-view projection: PlanRevisionAccepted -> matrix row + timeline plan_accepted. */
  private consoleApplyPlanRevisionAccepted(event: PlanRevisionAcceptedEvent, cursor: CommitCursor): void {
    const snapshot = event.payload.planRevision;
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const goalId = event.payload.goalId;
    const view = buildPlanMatrixView(projectId, workspaceId, goalId, snapshot, cursor, event.occurredAt);
    this.consoleMatrixRows.set(consoleGoalKey(projectId, workspaceId, goalId), view);
    // refs.planId 是条目自己的事实（这条说accepted的是哪一份计划），后面的
    // GoalRevisionRecorded 用它作为匹配键补变更原因，不靠"最后一条"这类顺序假设。
    this.appendConsoleTimeline(event, cursor, "plan_accepted", { goalId, planId: snapshot.ref.planId },
      "plan " + snapshot.ref.planId + " revision " + snapshot.planRevision + " accepted");
  }

  /**
   * 计划变更原因：补到本次受理的 plan_accepted 时间线条目上。
   *
   * 为什么在这里补而不是落条目时直接写：PlanRevisionAccepted 事件本身不带变更原因，原因在
   * **同一个提交批次**的 GoalRevisionRecorded 事件里（该事件逐字落账命令的 changeReason：
   * 人的决定受理是 user-decision-accepted，ControlEngine 的自动受理是
   * autonomous-rework:<proposalId>）。投影按到达顺序折叠，plan_accepted 先到，因此只能事后按
   * 同一条 canonical 事实（目标 + 生效计划 id）回头写入——不新造条目、不改写 summary、不解析
   * id 形状、不推断。初始计划受理没有 GoalRevisionRecorded，它的条目永远不带 change，
   * 含义是"这不是一次计划变更受理"，而不是"原因未知"。
   */
  private planChangeAnnotateTimelineChangeReason(projectId: string, workspaceId: string, ev: GoalRevisionRecordedEvent): void {
    const workspaceKey = consoleWorkspaceKey(projectId, workspaceId);
    const list = this.consoleTimelineRows.get(workspaceKey);
    if (list === undefined) return;
    const change = ev.payload.change;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const entry = list[index]!;
      if (entry.kind !== "plan_accepted" || entry.refs.goalId !== change.goalRef.goalId) continue;
      if (entry.refs.planId !== change.activePlanRef.planId) continue;
      // 该 (目标, 生效计划) 在正常批次里只有一条 plan_accepted：唯一性由账本 CAS 保证
      // （goal-change 应用提交时以新计划 ref revision 0 作为 expectedVersion）。投影自己
      // 不依赖这个前提——倒序扫描取最后一条，即使出现重复也只会回填到最新的一条。
      // 找不到匹配条目时这里静默返回：批次顺序由 ledger-validation 固定（plan_accepted 先于
      // GoalRevisionRecorded），独立审查用顺序反转的构造复现过「原因整条丢失」；若将来批次
      // 顺序放开，应改为在此处报投影停滞而不是沉默。
      list[index] = {
        ...entry,
        change: {
          reason: change.reason,
          actor: { ...ev.actor },
          goalRevision: change.revision,
          activePlanId: change.activePlanRef.planId,
          supersededPlanIds: change.supersededPlanRefs.map((ref) => ref.planId),
        },
      };
      return;
    }
  }

  /** detail-view projection: TaskClaimed -> create/refresh the active-agent run row (starting). */
  private consoleApplyReviewWorkCreated(event: import('../../contracts/reviewer-work.js').ReviewWorkCreatedEvent | import('../../contracts/reviewer-work.js').FailedReviewWorkReplacedEvent, cursor: CommitCursor): void {
    const { work, run, attempt } = event.payload;
    const projectId = event.projectId, workspaceId = event.workspaceId, goalId = work.subject.goalId, taskId = work.subject.taskId;
    const storageKey = this.consoleAgentStorageKey(projectId, workspaceId, goalId, taskId, run.ref.runId);
    const producer = this.consoleAgentRows.get(this.consoleAgentStorageKey(projectId, workspaceId, goalId, taskId, work.producerRunRef.runId));
    if (!this.consoleAgentRows.has(storageKey)) this.consoleAgentRowSeq.set(storageKey, this.consoleNextAgentSeq(consoleWorkspaceKey(projectId, workspaceId)));
    if (!producer) throw new ProjectionStallError('unsupported_event_type', { observedCursor: cursor });
    const row: import('../../contracts/console-views.js').ActiveAgentRunRow = { projectId, workspaceId, goalId, taskId, work: { kind: 'review', reviewWorkRef: work.ref }, runRef: run.ref, attemptRef: attempt.ref, binding: work.roleBinding, runStatus: 'starting', runOutcome: null, exitCode: null, lastEventSeq: 0, attemptStatus: 'claimed', attemptEndOutcome: null, lease: { ...producer.lease }, startedAt: null, endedAt: null, displayState: 'starting', handoff: null, sourceCursor: cursor };
    this.consoleAgentRows.set(storageKey, row);
    this.consoleAgentRunIndex.set(projectId + '\u0000' + run.ref.runId, storageKey);
  }
  private consoleApplyTaskClaimed(event: TaskClaimedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const { goalId, taskId, runRef, attemptRef, roleBinding, claimedAt } = event.payload;
    const workspaceKey = consoleWorkspaceKey(projectId, workspaceId);
    const taskKey = consoleTaskKey(projectId, workspaceId, goalId, taskId);
    const storageKey = this.consoleAgentStorageKey(projectId, workspaceId, goalId, taskId, runRef.runId);
    if (!this.consoleAgentRows.has(storageKey)) {
      this.consoleAgentRowSeq.set(storageKey, this.consoleNextAgentSeq(workspaceKey));
    }
    const marker = this.consoleHandoffMarkers.get(taskKey) ?? null;
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
    this.consoleAgentRows.set(storageKey, row);
    this.consoleAgentRunIndex.set(projectId + "\u0000" + runRef.runId, storageKey);
    this.appendConsoleTimeline(event, cursor, "task_claimed", { goalId, taskId, runId: runRef.runId },
      "work " + taskId + " claimed (run " + runRef.runId + ")");
  }

  /** detail-view projection: RunStarted -> the run row becomes running/ongoing. */
  private consoleApplyRunStarted(event: RunStartedEvent, cursor: CommitCursor): void {
    const storageKey = this.consoleAgentRunIndex.get(event.projectId + "\u0000" + event.aggregateId);
    if (!storageKey) return;
    const row = this.consoleAgentRows.get(storageKey);
    if (!row) return;
    this.consoleAgentRows.set(storageKey, {
      ...row,
      runStatus: "running",
      startedAt: event.payload.startedAt,
      attemptStatus: "started",
      displayState: "ongoing",
      sourceCursor: cursor,
    });
    this.appendConsoleTimeline(event, cursor, "run_started", { goalId: row.goalId, taskId: row.taskId, runId: row.runRef.runId },
      "run " + row.runRef.runId + " started");
  }

  /** detail-view projection: RunEventRecorded -> fold the runtime event into the run row (idempotent on seq). */
  private consoleApplyRunEventRecorded(event: RunEventRecordedEvent, cursor: CommitCursor): void {
    const storageKey = this.consoleAgentRunIndex.get(event.projectId + "\u0000" + event.aggregateId);
    if (!storageKey) return;
    const row = this.consoleAgentRows.get(storageKey);
    if (!row) return;
    const rt = event.payload.runtimeEvent;
    if (rt.sequence > row.lastEventSeq) {
      const terminal = isTerminalRuntimeEvent(rt);
      const outcome = terminal ? runtimeEventTerminalOutcome(rt) : row.runOutcome;
      const exitCode = rt.payload.kind === "completed" ? rt.payload.exitCode : row.exitCode;
      const endedAt = terminal ? rt.occurredAt : row.endedAt;
      this.consoleAgentRows.set(storageKey, {
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
      });
    }
    this.appendConsoleTimeline(event, cursor, "run_event", { goalId: row.goalId, taskId: row.taskId, runId: row.runRef.runId },
      "run " + row.runRef.runId + " " + rt.eventType);
  }

  /** detail-view projection: RunOutcomeUnknown -> explicit ended/outcome_unknown fact (never inferred). */
  private consoleApplyExecutionRetry(event: import('../../contracts/dispatch.js').ExecutionRetryScheduledEvent, cursor: CommitCursor): void {
    const storageKey = this.consoleAgentRunIndex.get(event.projectId + '\u0000' + event.aggregateId);
    if (!storageKey) return;
    const row = this.consoleAgentRows.get(storageKey);
    if (!row) return;
    const updated: import('../../contracts/console-views.js').ActiveAgentRunRow = { ...row, runStatus: 'starting', runOutcome: null,
      startedAt: null, endedAt: null, attemptStatus: 'claimed', attemptEndOutcome: null, displayState: 'starting', sourceCursor: cursor };
    this.consoleAgentRows.set(storageKey, updated);
  }

  private consoleApplyRunOutcomeUnknown(event: RunOutcomeUnknownEvent, cursor: CommitCursor): void {
    const storageKey = this.consoleAgentRunIndex.get(event.projectId + "\u0000" + event.aggregateId);
    if (!storageKey) return;
    const row = this.consoleAgentRows.get(storageKey);
    if (!row) return;
    this.consoleAgentRows.set(storageKey, {
      ...row,
      runStatus: "ended",
      runOutcome: "outcome_unknown",
      endedAt: event.payload.observedAt,
      attemptStatus: "ended",
      attemptEndOutcome: "outcome_unknown",
      displayState: "outcome_unknown",
      sourceCursor: cursor,
    });
    this.appendConsoleTimeline(event, cursor, "run_outcome_unknown", { goalId: row.goalId, taskId: row.taskId, runId: row.runRef.runId },
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
    this.consoleHandoffMarkers.set(taskKey, handoff);
    const runKey = projectId + "\u0000" + runRef.runId;
    const storageKey = this.consoleAgentStorageKey(projectId, workspaceId, goalId, taskId, runRef.runId);
    if (!this.consoleAgentRows.has(storageKey)) {
      this.consoleAgentRowSeq.set(storageKey, this.consoleNextAgentSeq(consoleWorkspaceKey(projectId, workspaceId)));
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
      this.consoleAgentRows.set(storageKey, row);
    } else {
      const existing = this.consoleAgentRows.get(storageKey)!;
      this.consoleAgentRows.set(storageKey, { ...existing, handoff, sourceCursor: cursor });
    }
    this.consoleAgentRunIndex.set(runKey, storageKey);
    this.appendConsoleTimeline(event, cursor, "replacement_claimed", { goalId, taskId, runId: runRef.runId, packetId: packetRef.packetId },
      "replacement claimed (run " + runRef.runId + ")");
  }

  /** detail-view projection: EvidenceAdmitted -> append the entry + timeline evidence_admitted. */
  private consoleApplyEvidenceAdmitted(event: EvidenceAdmittedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const { goalId, taskId, evidence, admittedAt, evidenceIndex } = event.payload;
    const taskKey = consoleTaskKey(projectId, workspaceId, goalId, taskId);
    let proj = this.consoleEvidenceProjections.get(taskKey);
    if (!proj) {
      const snapshot = this.planSnapshots.get(planGraphKey(projectId, goalId)) ?? null;
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
    this.consoleEvidenceProjections.set(taskKey, proj);
    this.appendConsoleTimeline(event, cursor, "evidence_admitted", { goalId, taskId, evidenceId: evidence.evidenceId },
      "evidence " + evidence.evidenceId + " admitted " + evidence.outcome);
  }

  /** detail-view projection: TaskReductionUpdated -> matrix live-phase + evidence reduction + timeline. */
  private consoleApplyTaskReductionUpdated(event: TaskReductionUpdatedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const { goalId, taskId, reduction } = event.payload;

    // Plan matrix: update the task's live phase (defensive rebuild if the matrix
    // row is missing — only a TaskReductionUpdated was seen).
    const matrixKey = consoleGoalKey(projectId, workspaceId, goalId);
    let view = this.consoleMatrixRows.get(matrixKey);
    if (!view) {
      const snapshot = this.planSnapshots.get(planGraphKey(projectId, goalId));
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
      this.consoleMatrixRows.set(matrixKey, { ...view, rows, sourceCursor: cursor, updatedAt: event.occurredAt });
    }

    // Task evidence projection: refresh the reduction + plan ref.
    const taskKey = consoleTaskKey(projectId, workspaceId, goalId, taskId);
    let proj = this.consoleEvidenceProjections.get(taskKey);
    if (!proj) {
      const snapshot = this.planSnapshots.get(planGraphKey(projectId, goalId)) ?? null;
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
    this.consoleEvidenceProjections.set(taskKey, proj);

    this.appendConsoleTimeline(event, cursor, "task_reduction", { goalId, taskId },
      "task " + taskId + " reduced to " + reduction.phase);
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
    const planSnapshot = this.planSnapshots.get(planGraphKey(projectId, goalId)) ?? null;
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

  /** Console overview projection: portfolio of bootstrapped Project/Workspace scopes. */
  async consolePortfolio(query: PortfolioViewQuery): Promise<PortfolioViewResult> {
    const observedCursor = this.observedCursor;
    const maxProjects = CONSOLE_PORTFOLIO_MAX_PROJECTS;
    const entries = [...this.consolePortfolioEntries.values()]
      .sort((a, b) => (a.scopeKey < b.scopeKey ? -1 : a.scopeKey > b.scopeKey ? 1 : 0))
      .slice(0, maxProjects);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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
    const observedCursor = this.observedCursor;
    const row = this.consoleSummaryRows.get(consoleWorkspaceKey(query.projectId, query.workspaceId));

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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

  /** Console detail-view projection: plan matrix (key = consoleGoalKey; freshness mirrors goal()). */
  async consolePlanMatrix(query: PlanMatrixViewQuery): Promise<PlanMatrixViewResult> {
    const observedCursor = this.observedCursor;
    const row = this.consoleMatrixRows.get(consoleGoalKey(query.projectId, query.workspaceId, query.goalId));
    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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
    const observedCursor = this.observedCursor;
    const workspaceKey = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const entries: [import("../../contracts/console-views.js").ActiveAgentRunRow, number][] = [];
    for (const [storageKey, row] of this.consoleAgentRows) {
      if (row.projectId !== query.projectId || row.workspaceId !== query.workspaceId) continue;
      entries.push([row, this.consoleAgentRowSeq.get(storageKey) ?? 0]);
    }
    entries.sort((a, b) => a[1] - b[1]);
    const hasRows = entries.length > 0;
    const base = entries.map(([row]) => row);
    const filtered = query.goalId === undefined ? base : base.filter((row) => row.goalId === query.goalId);
    const taskCount = filtered.length;
    const bounded = filtered.slice(-CONSOLE_ACTIVE_AGENTS_MAX_ROWS);
    const rows = bounded.map((row) => {
      const marker = this.consoleHandoffMarkers.get(consoleTaskKey(row.projectId, row.workspaceId, row.goalId, row.taskId)) ?? null;
      return marker ? { ...row, handoff: marker } : row;
    });
    const last = bounded.length > 0 ? bounded[bounded.length - 1] : null;
    const view: import("../../contracts/console-views.js").ActiveAgentsView = {
      projectId: query.projectId,
      workspaceId: query.workspaceId,
      rows,
      taskCount,
      sourceCursor: last ? last.sourceCursor : (observedCursor ?? makeCommitCursor(1)),
      updatedAt: last ? (last.endedAt ?? last.startedAt ?? last.lease.grantedAt) : null,
    };
    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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
    const observedCursor = this.observedCursor;
    const proj = this.consoleEvidenceProjections.get(
      consoleTaskKey(query.projectId, query.workspaceId, query.goalId, query.taskId),
    );
    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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
    const observedCursor = this.observedCursor;
    const workspaceKey = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const entries = this.consoleTimelineRows.get(workspaceKey) ?? [];
    const hasRow = entries.length > 0 || (this.consoleTimelineTotal.get(workspaceKey) ?? 0) > 0;
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
      updatedAt: entries.length > 0 ? entries[entries.length - 1]!.occurredAt : null,
    };
    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
        if (hasRow) return { status: "ready", timeline: view, observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return { status: "not_ready", requiredCursor: query.atLeastCursor, observedCursor };
    }
    if (hasRow) return { status: "ready", timeline: view, observedCursor: observedCursor! };
    return { status: "not_ready", requiredCursor: observedCursor ?? makeCommitCursor(1), observedCursor };
  }

  /** Work-context view — binding + notes + continuations (display only).
   * overview projection owns the binding + notes rows; detail-view projection owns the continuation rows.
   * The method composes the COMPLETE result: binding absent -> not_found;
   * otherwise ready with the bounded (recent-first) continuation window.
   * Freshness is judged by the opaque observedCursor. */
  // ------------------------------------------------------------------ //
  // Material-access grants                                       //
  // ------------------------------------------------------------------ //

  private applyMaterialAccessEvent(event: DomainEvent, cursor: CommitCursor): void {
    const change = projectMaterialAccessEvent(event, cursor);
    if (!change) return;
    const prior = this.materialAccessGrantRows.findIndex(row => row.ref.projectId === change.row.ref.projectId && row.ref.workspaceId === change.row.ref.workspaceId && row.ref.goalId === change.row.ref.goalId && row.ref.grantId === change.row.ref.grantId);
    if (prior >= 0) this.materialAccessGrantRows.splice(prior, 1);
    this.materialAccessGrantRows.push(change.row);
  }

  /**
   * Display / host lookup of recorded grants. This view NEVER decides access:
   * the ArtifactVault applies the rules against its own stored owner and the
   * requester's declared basis.
   */
  async materialAccessGrants(query: import("../../contracts/material-access.js").MaterialAccessGrantViewQuery): Promise<import("../../contracts/material-access.js").MaterialAccessGrantViewResult> {
    const observedCursor = this.observedCursor;
    if (observedCursor === null) return { status: "not_ready", observedCursor: null };
    const limit = Math.min(query.limit ?? MATERIAL_ACCESS_VIEW_MAX_ROWS, MATERIAL_ACCESS_VIEW_MAX_ROWS);
    const grants = this.materialAccessGrantRows.filter((row) =>
      row.ref.projectId === query.projectId &&
      (query.workspaceId === undefined || row.ref.workspaceId === query.workspaceId) &&
      (query.goalId === undefined || row.ref.goalId === query.goalId) &&
      (query.materialDigest === undefined || row.grant.materials.some((m) => m.digest === query.materialDigest)) &&
      (query.readerRunId === undefined || row.grant.reader.runId === query.readerRunId));
    return { status: "ready", grants: grants.slice(-limit), sourceCursor: observedCursor };
  }

  async materialAccessCandidates(query: MaterialAccessGrantLookup): Promise<MaterialAccessGrantViewResult> {
    if (this.observedCursor === null) return { status: "not_ready", observedCursor: null };
    return { status: "ready", grants: this.materialAccessGrantRows.filter(row => !row.revocation && matchesMaterialAccessLookup(row.grant, query)), sourceCursor: this.observedCursor };
  }

  async workContext(query: import("../../contracts/context-continuity.js").WorkContextViewQuery): Promise<import("../../contracts/context-continuity.js").WorkContextViewResult> {
    const observedCursor = this.observedCursor;
    const key = workContextScopeKey(query.projectId, query.workspaceId, query.workId);
    const binding = this.workContextBindings.get(key);

    // Freshness: before ANY event is applied we cannot judge the work exists —
    // this is "not_ready" (distinct from a definitive "not_found").
    if (observedCursor === null) {
      return { status: "not_ready", observedCursor: null };
    }
    if (!binding) {
      return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId, workId: query.workId };
    }

    const notes = this.workContextNotes.get(key) ?? [];
    const raw = this.workContextContinuationRows.get(key) ?? [];
    const continuations = raw.slice(-WORK_CONTEXT_VIEW_MAX_CONTINUATIONS).reverse();
    return {
      status: "ready",
      binding,
      notes,
      continuations,
      sourceCursor: observedCursor,
    };
  }

  /** Control-intent: control timeline view (display only; desired vs current separated). */
  async controlTimelineView(query: import("../../contracts/control-intent.js").ControlTimelineViewQuery): Promise<import("../../contracts/control-intent.js").ControlTimelineViewResult> {
    const observedCursor = this.observedCursor;
    if (observedCursor === null) return { status: "not_ready", observedCursor: null };
    const key = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const rows = this.controlIntentIntentRows.get(key) ?? [];
    const filtered = rows.filter((r2) => (query.goalId === undefined || r2.scope.goalId === query.goalId) && (query.taskId === undefined || r2.scope.taskId === query.taskId));
    if (filtered.length === 0) return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId };
    return {
      status: "ready",
      entries: filtered.map((r2) => ({ intentRef: r2.ref, kind: r2.kind, desiredState: r2.desiredState, status: r2.status, ackCount: r2.ackCount, sourceCursor: r2.cursor })),
      sourceCursor: filtered[filtered.length - 1]!.cursor,
    };
  }

  // Query combined hook: fold QueryJob events.
  private applyQueryEvent(event: DomainEvent, cursor: CommitCursor): void {
    for (const change of projectQueryEvent(event)) {
      if (change.kind === 'job') this.queryJobs.set(change.key, change.job);
      else if (change.kind === 'run') this.queryRuns.set(change.key, change.run);
      else {
        const answers = this.queryAnswers.get(change.key) ?? [];
        answers.push(change.answer);
        this.queryAnswers.set(change.key, answers);
      }
    }
    void cursor;
  }

  // Control-intent combined hook: fold ControlIntentRecorded/SafePointAcknowledged.
  private applyControlIntentEvent(event: DomainEvent, cursor: CommitCursor): void {
    if (event.eventType !== 'ControlIntentRecorded' && event.eventType !== 'SafePointAcknowledged') return;
    const key = consoleWorkspaceKey(event.projectId, event.workspaceId);
    const change = projectControlIntentEvent(event, cursor, this.controlIntentIntentRows.get(key) ?? []);
    if (change) this.controlIntentIntentRows.set(change.key, change.rows);
  }

  /** Query combined: query job view (display only). */
  async queryJobView(query: import("../../contracts/query-job.js").QueryJobViewQuery): Promise<import("../../contracts/query-job.js").QueryJobViewResult> {
    const observedCursor = this.observedCursor;
    if (observedCursor === null) return { status: "not_ready", observedCursor: null };
    const key = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const job = this.queryJobs.get(key + "\u0000" + query.queryJobId);
    if (job === undefined) return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId, queryJobId: query.queryJobId };
    const runRef = job.runRef !== null ? job.runRef : null;
    const run = runRef === null ? null : (this.queryRuns.get(key + "\u0000" + runRef.runId) ?? null);
    const answers = this.queryAnswers.get(key + "\u0000" + query.queryJobId) ?? [];
    const currentAnswer = answers.length > 0 ? answers[answers.length - 1]! : null;
    return {
      status: "ready", job, run, answers,
      currentAnswer,
      stale: currentAnswer?.stale ?? false,
      sourceCursor: observedCursor,
    };
  }

  /** Plan-change detail-view projection: plan change view (display only; rebuildable from events).
   * Assembles proposals / decisions / revisions for the (projectId, workspaceId,
   * goalId) scope plus the purely-computed task dispositions (never judged). */
  async planChangeView(query: PlanChangeViewQuery): Promise<PlanChangeViewResult> {
    const observedCursor = this.observedCursor;
    // No projection ever advanced -> we cannot claim freshness for any scope.
    if (observedCursor === null) return { status: "not_found" };

    const key = planChangeScopeKey(query);
    const proposals: PlanProposalSnapshot[] = [];
    for (const [rowKey, value] of this.planChangeProposals) {
      if (rowKey.startsWith(key + "\u0000")) proposals.push(value);
    }
    const decisions: UserDecisionSnapshot[] = [];
    for (const [rowKey, value] of this.planChangeDecisions) {
      if (rowKey.startsWith(key + "\u0000")) decisions.push(value);
    }
    const revisions = this.planChangeGoalRevisions.get(key) ?? [];
    if (proposals.length === 0 && decisions.length === 0 && revisions.length === 0) {
      return { status: "not_found" };
    }

    const dispositions = projectPlanChangeDispositions(
      revisions,
      ref => this.planChangePlanSnapshots.get(canonicalJson(ref)),
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
    if (change.kind === 'proposal') this.collaborationProposalRows.set(change.key, { snapshot: change.snapshot, sourceCursor: change.sourceCursor });
    else if (change.kind === 'decision') this.collaborationDecisionRows.set(change.key, { snapshot: change.snapshot, sourceCursor: change.sourceCursor });
    else if (change.kind === 'policy') this.collaborationPolicyRows.set(change.key, { snapshot: change.snapshot, sourceCursor: change.sourceCursor });
    else this.collaborationActivationRows.set(change.key, { snapshot: change.snapshot, sourceCursor: change.sourceCursor });
  }

  /** Collaboration detail-view projection: unified status view (facts-first display; rebuildable from
   * events). Rows are the latest proposal / decision / policy / activation rows
   * for the (projectId, workspaceId) scope (policy + activation are gathered by
   * projectId because their events carry workspaceId ""). Every fact carries
   * sourceCursor lineage; the Collaboration view has no multi-version comparison
   * surface, so every fact is marked stale=false per the projection contract. */
  async unifiedStatusView(query: UnifiedStatusViewQuery): Promise<UnifiedStatusViewResult> {
    const observedCursor = this.observedCursor;
    // No projection ever advanced -> we cannot claim freshness for any scope.
    if (observedCursor === null) return { status: "not_found" };

    const scopeKey = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const prefix = scopeKey + "\u0000";
    const proposalRows = this.collaborationScopeProposalRows(prefix);
    const decisionRows = this.collaborationScopeDecisionRows(prefix);
    const policyRows = this.collaborationProjectPolicyRows(query.projectId);
    const activationRows = this.collaborationProjectActivationRows(query.projectId);
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

  /** Collaboration: workspace-scope proposal rows, ascending by recordedAt then designId. */
  private collaborationScopeProposalRows(prefix: string): { snapshot: InitialDesignProposalSnapshot; sourceCursor: CommitCursor }[] {
    const out: { snapshot: InitialDesignProposalSnapshot; sourceCursor: CommitCursor }[] = [];
    for (const [rowKey, value] of this.collaborationProposalRows) {
      if (rowKey.startsWith(prefix)) out.push(value);
    }
    out.sort((a, b) => {
      const t = a.snapshot.recordedAt.localeCompare(b.snapshot.recordedAt);
      return t !== 0 ? t : a.snapshot.ref.designId.localeCompare(b.snapshot.ref.designId);
    });
    return out;
  }

  /** Collaboration: workspace-scope decision rows, ascending by decidedAt then decisionId. */
  private collaborationScopeDecisionRows(prefix: string): { snapshot: InitialDesignDecisionSnapshot; sourceCursor: CommitCursor }[] {
    const out: { snapshot: InitialDesignDecisionSnapshot; sourceCursor: CommitCursor }[] = [];
    for (const [rowKey, value] of this.collaborationDecisionRows) {
      if (rowKey.startsWith(prefix)) out.push(value);
    }
    out.sort((a, b) => {
      const t = a.snapshot.decision.decidedAt.localeCompare(b.snapshot.decision.decidedAt);
      return t !== 0 ? t : a.snapshot.ref.decisionId.localeCompare(b.snapshot.ref.decisionId);
    });
    return out;
  }

  /** Collaboration: project-scope policy rows (event workspaceId is ""), ascending by
   * installedAt then policyId. */
  private collaborationProjectPolicyRows(projectId: string): { snapshot: CoordinationPolicyRevisionSnapshot; sourceCursor: CommitCursor }[] {
    const out: { snapshot: CoordinationPolicyRevisionSnapshot; sourceCursor: CommitCursor }[] = [];
    for (const value of this.collaborationPolicyRows.values()) {
      if (value.snapshot.ref.projectId !== projectId) continue;
      out.push(value);
    }
    out.sort((a, b) => {
      const t = a.snapshot.installedAt.localeCompare(b.snapshot.installedAt);
      return t !== 0 ? t : a.snapshot.ref.policyId.localeCompare(b.snapshot.ref.policyId);
    });
    return out;
  }

  /** Collaboration: project-scope activation rows (event workspaceId is ""), ascending
   * by aggregate revision then refKey. */
  private collaborationProjectActivationRows(projectId: string): { snapshot: ProjectCoordinationPolicyActiveSnapshot; sourceCursor: CommitCursor }[] {
    const out: { snapshot: ProjectCoordinationPolicyActiveSnapshot; sourceCursor: CommitCursor }[] = [];
    for (const value of this.collaborationActivationRows.values()) {
      if (value.snapshot.projectId !== projectId) continue;
      out.push(value);
    }
    out.sort((a, b) => {
      const t = a.snapshot.revision - b.snapshot.revision;
      return t !== 0 ? t : canonicalJson(a.snapshot.ref).localeCompare(canonicalJson(b.snapshot.ref));
    });
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
      this.baselineEvolutionCandidates.set(key, snapshot);
    } else if (event.eventType === "ArchitectureChangeDecisionRecorded") {
      const ev = event as ArchitectureChangeDecisionRecordedEvent;
      const decision = ev.payload.decision;
      const ref = architectureChangeDecisionRefFor(decision.projectId, decision.workspaceId, decision.decisionId);
      const key = consoleWorkspaceKey(decision.projectId, decision.workspaceId) + "\u0000" + decision.decisionId;
      this.baselineEvolutionDecisions.set(key, { ref, decision });
    } else if (event.eventType === "MigrationGateRecorded") {
      const ev = event as MigrationGateRecordedEvent;
      const gate = ev.payload.gate;
      const ref = migrationGateRefFor(gate.projectId, gate.workspaceId, gate.gateId);
      const key = consoleWorkspaceKey(gate.projectId, gate.workspaceId) + "\u0000" + gate.gateId;
      this.baselineEvolutionGates.set(key, { ref, gate });
    } else if (event.eventType === "BaselineActivationRecorded") {
      const ev = event as BaselineActivationRecordedEvent;
      const activation = ev.payload.activation;
      const ref = baselineActivationRefFor(activation.projectId, activation.workspaceId, activation.activationId);
      const key = consoleWorkspaceKey(activation.projectId, activation.workspaceId) + "\u0000" + activation.activationId;
      this.baselineEvolutionActivations.set(key, { ref, activation });
    }
    void cursor;
  }

  /** Baseline change view (display only; rebuildable from events).
   * Assembles the candidate / decision / gate / activation rows for the
   * (projectId, workspaceId) workspace scope plus the purely-computed defaultPin,
   * stale markers and notRebasedPlans. Deterministic: rows are picked by the
   * authoritative activation chain (latest wins), falling back to the latest of
   * each type when no activation has been recorded yet. */
    async baselineChangeView(query: BaselineChangeViewQuery): Promise<BaselineChangeViewResult> {
    const observedCursor = this.observedCursor;
    // No projection ever advanced -> we cannot claim freshness for any scope.
    if (observedCursor === null) return { status: "not_found" };

    const scopeKey = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const candidateRows = this.baselineEvolutionScopeCandidates(scopeKey);
    const decisionRows = this.baselineEvolutionScopeDecisions(scopeKey);
    const gateRows = this.baselineEvolutionScopeGates(scopeKey);
    const activationRows = this.baselineEvolutionScopeActivations(scopeKey);
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

  /** Baseline-evolution: rows under a workspace-scope key prefix, sorted ascending by the row's
   * timestamp (then id) so the LAST element is the latest. */
  private baselineEvolutionScopeCandidates(scopeKey: string): CandidateArchitectureBaselineSnapshot[] {
    const out: CandidateArchitectureBaselineSnapshot[] = [];
    for (const [rowKey, value] of this.baselineEvolutionCandidates) {
      if (rowKey.startsWith(scopeKey + "\u0000")) out.push(value);
    }
    out.sort((a, b) => {
      const t = a.materializedAt.localeCompare(b.materializedAt);
      return t !== 0 ? t : a.ref.candidateId.localeCompare(b.ref.candidateId);
    });
    return out;
  }

  /** Baseline-evolution: workspace-scope decision rows, ascending by decidedAt then id. */
  private baselineEvolutionScopeDecisions(scopeKey: string): { ref: ArchitectureChangeDecisionRef; decision: ArchitectureChangeDecisionV1 }[] {
    const out: { ref: ArchitectureChangeDecisionRef; decision: ArchitectureChangeDecisionV1 }[] = [];
    for (const [rowKey, value] of this.baselineEvolutionDecisions) {
      if (rowKey.startsWith(scopeKey + "\u0000")) out.push(value);
    }
    out.sort((a, b) => {
      const t = a.decision.decidedAt.localeCompare(b.decision.decidedAt);
      return t !== 0 ? t : a.ref.decisionId.localeCompare(b.ref.decisionId);
    });
    return out;
  }

  /** Baseline-evolution: workspace-scope gate rows, ascending by updatedAt then id. */
  private baselineEvolutionScopeGates(scopeKey: string): { ref: MigrationGateTaskRef; gate: MigrationGateTaskV1 }[] {
    const out: { ref: MigrationGateTaskRef; gate: MigrationGateTaskV1 }[] = [];
    for (const [rowKey, value] of this.baselineEvolutionGates) {
      if (rowKey.startsWith(scopeKey + "\u0000")) out.push(value);
    }
    out.sort((a, b) => {
      const t = a.gate.updatedAt.localeCompare(b.gate.updatedAt);
      return t !== 0 ? t : a.ref.gateId.localeCompare(b.ref.gateId);
    });
    return out;
  }

  /** Baseline-evolution: workspace-scope activation rows, ascending by activatedAt then id. */
  private baselineEvolutionScopeActivations(scopeKey: string): { ref: BaselineActivationRef; activation: BaselineActivationV1 }[] {
    const out: { ref: BaselineActivationRef; activation: BaselineActivationV1 }[] = [];
    for (const [rowKey, value] of this.baselineEvolutionActivations) {
      if (rowKey.startsWith(scopeKey + "\u0000")) out.push(value);
    }
    out.sort((a, b) => {
      const t = a.activation.activatedAt.localeCompare(b.activation.activatedAt);
      return t !== 0 ? t : a.ref.activationId.localeCompare(b.ref.activationId);
    });
    return out;
  }

  /** Plan-change combined hook: fold plan-change events (proposal/decision +
   * detail-view projection revision/plan; the handler and handled-event membership
   * are maintained together). */
  private applyPlanChangeEvent(event: DomainEvent, cursor: CommitCursor): void {
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
      this.planChangeProposals.set(key, snapshot);
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
      this.planChangeDecisions.set(key, snapshot);
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
      const rows = this.planChangeGoalRevisions.get(key) ?? [];
      rows.push(snapshot);
      rows.sort((a, b) => a.ref.revision - b.ref.revision);
      this.planChangeGoalRevisions.set(key, rows);
      // 同一条已提交事实同时决定时间线条目的变更原因（见该方法的注释）。
      this.planChangeAnnotateTimelineChangeReason(ev.projectId, ev.workspaceId, ev);
    } else if (event.eventType === "PlanRevisionAccepted") {
      const ev = event as PlanRevisionAcceptedEvent;
      const planRevision = ev.payload.planRevision;
      // Idempotent: the same ref always projects the same immutable snapshot.
      this.planChangePlanSnapshots.set(canonicalJson(planRevision.ref), planRevision);
    } else if (event.eventType === "PlanRevisionSuperseded") {
      // The same fact is already carried by the GoalRevisionRecorded change;
      // the supersession event itself needs no dedicated row.
      void (event as PlanRevisionSupersededEvent);
    }
    void cursor;
  }

  /** completed-work context: completed-work selection source view (display only; composed from the Work-context stores). */
  async completedWorkView(query: import("../../contracts/completed-work-context.js").CompletedWorkViewQuery): Promise<import("../../contracts/completed-work-context.js").CompletedWorkViewResult> {
    const observedCursor = this.observedCursor;
    if (observedCursor === null) {
      return { status: "not_ready", observedCursor: null };
    }
    const rows: import("../../contracts/completed-work-context.js").CompletedWorkViewRow[] = [];
    // 先按「一个任务一个身份」归并，再判正式完成资格。同一 (goal, task) 在账本里存在
    // 多条身份（唯一性规则生效前留下的历史不一致）时，只显示权威那一条（显式声明的身份优先于推导
    // 兜底身份）；落选的身份仍是不可变历史事实，可按 workId 用 workContextView 直接读取。
    const candidates = [...this.workContextBindings.values()].filter(
      (binding) => binding.ref.projectId === query.projectId && binding.ref.workspaceId === query.workspaceId
        && (query.goalId === undefined || binding.binding.goalId === query.goalId),
    );
    // （工作身份归并）：先按工作身份的**唯一**规则归并（不重算、不复制选择规则），再把落选者算出来，
    // 使「这里发生过归并、落选者是谁」成为可见事实（此前是静默丢弃）。
    const retained = dedupeTaskWorks(candidates);
    const dropped = droppedWorkRefsByTask(candidates, retained);
    for (const binding of retained) {
      if (await completedWorkCursor(binding.binding, this) === null) continue;
      const refKey = canonicalJson(binding.ref);
      const notes = this.workContextNotes.get(refKey) ?? [];
      const continuations = this.workContextContinuationRows.get(refKey) ?? [];
      const latestCursor = observedCursor;
      const droppedHere = sortWorkRefs(dropped.get(taskWorkKey(binding.binding.goalId, binding.binding.taskId)) ?? []);
      rows.push({
        workRef: binding.ref,
        workKind: binding.binding.workKind,
        goalId: binding.binding.goalId,
        taskId: binding.binding.taskId,
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

  /** Architecture-inspection combined: architecture inspection view (inspections + findings (overview projection) + briefs + proposals (detail-view projection) per (projectId, workspaceId); display only). */
  async architectureInspectionView(query: import("../../contracts/architecture-inspection.js").ArchitectureInspectionViewQuery): Promise<import("../../contracts/architecture-inspection.js").ArchitectureInspectionViewResult> {
    const observed = this.observedCursor;
    if (observed === null) {
      return { status: "not_ready", observedCursor: null };
    }
    const scopeKey = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const entries = this.architectureInspectionBuildInspectionEntries(scopeKey, query.planId);
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

    const inspectionRows = this.architectureInspectionInspectionRows.get(scopeKey) ?? [];
    const findingRows = this.architectureInspectionFindingRows.get(scopeKey) ?? [];
    const briefRows = this.architectureInspectionBriefRows.get(scopeKey) ?? [];
    const proposalRows = this.architectureInspectionProposalRows.get(scopeKey) ?? [];

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
    // Surface detail-view projection facts not referenced by any real (overview projection) inspection row.
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

  /** Event types currently handled by this projection. */
  private readonly reviewSnapshots = new Map<string, ReviewProjectionSnapshot>();
  private reviewRecords(): ReviewProjectionSnapshot[] { return [...this.reviewSnapshots.values()]; }
  async reviewWork(ref: import('../../contracts/reviewer-work.js').ReviewWorkRef) {
    const facts = reviewProjectionFacts(this.reviewRecords()), work = facts.works.find(w => canonicalJson(w.ref) === canonicalJson(ref));
    return work ? { work, result: facts.results.find(r => canonicalJson(r.workRef) === canonicalJson(ref)) ?? null, run: facts.runs.find(r => canonicalJson(r.ref) === canonicalJson(work.reviewerRunRef)) ?? null } : null;
  }
  private isHandledEventType(eventType: string): boolean {
    return readModelHandlesEvent(eventType);
  }
}

/** Composition requires Control's stateless display-policy capability. */
export function createReadModelIndex(policyExplanation: PolicyExplanationPort): ReadModelIndex {
  return new ReadModelIndexImpl(policyExplanation);
}
