/**
 * ReadModelIndexImpl — event projection (Goal create slice + P1-02 plan view).
 * Authority: dev_docs/interfaces/goal-view.md + modules/data/read-model-index.md
 * + P1-02 IMPLEMENTATION-HANDOFF.md "契约与存储语义（冻结）".
 *
 * Hidden implementation: cursor checkpoint, event dedupe, the GoalCreated
 * projection into an in-memory (projectId, workspaceId, goalId)-keyed view
 * store, the P1-02 Plan Graph / Task Detail projections, and the
 * read-after-write freshness rules enforced by goal() / planGraph() /
 * taskDetail(). Catch-up/rebuild is exercised by advancing sequential
 * EventPage(s) from the StateLedger.
 *
 * Invariants upheld (goal-view.md / read-model-index.md / P1-02):
 *  - Views are rebuildable projections; fields come only from Events.
 *  - Repeated events are idempotent (dedupe by eventId) and never re-reported.
 *  - Cursor gap / out-of-order / unknown schema version stall the whole page
 *    (no partial application) via a typed ProjectionStallError.
 *  - A KNOWN v1 event with no projection handler still stalls the WHOLE page
 *    via ProjectionStallError(unsupported_event_type) — never silently skip
 *    (P1-02 handlers added here, so this stays as a future defence).
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
import type { CommitCursor } from "../contracts/command-event.js";
import type { GoalCreatedEvent } from "../contracts/command-event.js";
import type { DomainEvent } from "../contracts/events.js";
import type { EventPage, PositionedEvent } from "../contracts/ledger.js";
import { compareCommitCursor, makeCommitCursor, seqOfCommitCursor } from "../contracts/ledger.js";
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
import type {
  TaskVerificationViewQuery,
  TaskVerificationViewResult,
  TaskVerificationView,
  EvidenceBindingView,
} from "../contracts/verification-view.js";
import type { EffectivityAnchorV1, EvidenceAdmittedEvent, EvidenceV1 } from "../contracts/evidence.js";
import { evidenceApplicability, selectEffectiveEvidenceSet } from "../contracts/evidence.js";
import type { TaskReductionSnapshot, TaskReductionUpdatedEvent } from "../contracts/reduction.js";
import type {
  GoalStatusQuery,
  GoalStatusView,
  GoalStatusViewResult,
  GoalTimelineQuery,
  GoalTimelineEntry,
  GoalTimelineViewResult,
} from "../contracts/goal-phase-view.js";
import type { GoalPhaseUpdatedEvent } from "../contracts/goal-phase.js";
import type { HandoffRecordedEvent, ReplacementClaimedEvent } from "../contracts/handoff.js";
import { handoffPacketRefFor } from "../contracts/handoff.js";
import type {
  HandoffProvenanceEntry,
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
import type { PatchRecordedEvent } from "../contracts/patch.js";
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
import {
  consoleWorkspaceKey,
  consoleGoalKey,
  consoleTaskKey,
  CONSOLE_PORTFOLIO_MAX_PROJECTS,
  CONSOLE_ACTIVE_AGENTS_MAX_ROWS,
  CONSOLE_TIMELINE_MAX_ENTRIES,
  CONSOLE_MATRIX_MAX_TASKS,
} from "../contracts/console-views.js";
import { patchRecordRefFor } from "../contracts/patch.js";
import type { RoleBindingRefV1 } from "../contracts/dispatch.js";

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

/** Full-scope Goal phase key: (projectId, goalId) — the P1-05 projection scope. */
function goalPhaseKey(projectId: string, goalId: string): string {
  return projectId + "\u0000" + goalId;
}

/** Full-scope P1-07 workspace lease view key: (projectId, workspaceId). */
function workspaceLeaseKey(projectId: string, workspaceId: string): string {
  return projectId + "\u0000" + workspaceId;
}

/** Full-scope P1-07 integration conflict view key: (projectId, goalId, taskId). */
function integrationConflictKey(projectId: string, goalId: string, taskId: string): string {
  return projectId + "\u0000" + goalId + "\u0000" + taskId;
}

/** Full-scope P1-07 workspace patch view key: (projectId, workspaceId). */
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

export class ReadModelIndexImpl implements ReadModelIndex {
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

  /** (projectId, goalId, taskId) -> latest projected ActiveAgentView (P1-03). */
  private readonly activeAgentRows = new Map<string, ActiveAgentView>();

  /** (projectId \0 runId) -> taskDetailKey: locates the run row from RunStarted /
   * RunEventRecorded / RunOutcomeUnknown events, which carry only the runId (not the goalId). */
  private readonly runKeyIndex = new Map<string, string>();

  /** (projectId, goalId) -> accepted PlanRevisionSnapshot (P1-04: the plan the
   * verification view derives applicability under — rebuilt from events). */
  private readonly planSnapshots = new Map<string, PlanRevisionSnapshot>();

  /** (projectId, goalId, taskId) -> latest projected verification view row. */
  private readonly verificationRows = new Map<string, VerificationProjection>();

  /** (projectId, goalId) -> latest projected GoalStatusView (P1-05). */
  private readonly goalStatusRows = new Map<string, GoalStatusView>();

  /** (projectId, goalId) -> goal timeline entries in arrival order (P1-05). */
  private readonly goalTimelineRows = new Map<string, GoalTimelineEntry[]>();

  /** (projectId, goalId, taskId) -> latest projected HandoffProvenanceView (P1-06). */
  private readonly handoffProvenanceRows = new Map<string, HandoffProvenanceView>();

  /** (projectId, workspaceId) -> latest projected WorkspaceLeaseView (P1-07). */
  private readonly workspaceLeaseRows = new Map<string, WorkspaceLeaseView>();

  /** (projectId, goalId, taskId) -> latest projected IntegrationConflictView (P1-07). */
  private readonly integrationConflictRows = new Map<string, IntegrationConflictView>();

  /** (projectId, workspaceId) -> latest projected WorkspacePatchView (P1-07). */
  private readonly workspacePatchRows = new Map<string, WorkspacePatchView>();

  // ------------------------------------------------------------------ //
  // P1-08 console projection rows (consumes ONLY existing v1 events).  //
  // Row stores are shared structure; the lane implementations fill the //
  // per-view apply/query logic in their delimited regions below.       //
  // ------------------------------------------------------------------ //

  /** LANE-A: (projectId, workspaceId) -> PortfolioEntry (WorkspaceBootstrapped projection). */
  private readonly p108PortfolioEntries = new Map<string, PortfolioEntry>();
  /** LANE-A: (projectId, workspaceId) -> WorkspaceSummaryView. */
  private readonly p108SummaryRows = new Map<string, import("../contracts/console-views.js").WorkspaceSummaryView>();
  /** LANE-A: (projectId, workspaceId, goalId, taskId) -> latest TaskReduction phase
   * (feeds phaseCounts.taskReduction "每任务最新相位计数" — decrement old, increment new). */
  private readonly p108TaskReductionPhase = new Map<string, import("../contracts/reduction.js").TaskReductionPhase>();
  /** LANE-A: (projectId, workspaceId, goalId) -> latest GoalPhase
   * (feeds phaseCounts.goalPhase "每 Goal 最新相位计数"). */
  private readonly p108GoalPhase = new Map<string, import("../contracts/goal-phase.js").GoalPhase>();
  /** LANE-B: (projectId, workspaceId, goalId) -> PlanMatrixView. */
  private readonly p108MatrixRows = new Map<string, import("../contracts/console-views.js").PlanMatrixView>();
  /** LANE-B: (projectId, workspaceId, goalId, taskId) -> ActiveAgentRunRow. */
  private readonly p108AgentRows = new Map<string, import("../contracts/console-views.js").ActiveAgentRunRow>();
  /** LANE-B: (projectId, workspaceId, goalId, taskId) -> latest handoff marker. */
  private readonly p108HandoffMarkers = new Map<string, import("../contracts/console-views.js").ActiveAgentRunRow["handoff"]>();
  /** LANE-B: (projectId, workspaceId, goalId, taskId) -> task evidence projection. */
  private readonly p108EvidenceProjections = new Map<string, {
    projectId: string;
    workspaceId: string;
    goalId: string;
    taskId: string;
    evidence: { evidence: import("../contracts/evidence.js").EvidenceV1; admittedAt: string; evidenceIndex: number; sourceCursor: import("../contracts/command-event.js").CommitCursor }[];
    reduction: import("../contracts/reduction.js").TaskReductionSnapshot | null;
    reductionCursor: import("../contracts/command-event.js").CommitCursor | null;
    planRef: import("../contracts/plan.js").PlanRevisionRef;
    planRevision: number;
    sourceCursor: import("../contracts/command-event.js").CommitCursor;
    updatedAt: string | null;
  }>();
  /** LANE-B: (projectId, workspaceId) -> timeline entries in arrival order. */
  private readonly p108TimelineRows = new Map<string, import("../contracts/console-views.js").TimelineEntry[]>();
  /** LANE-B: per-workspace timeline seq counter. */
  private readonly p108TimelineSeq = new Map<string, number>();

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
      // P1-08 console projections consume the SAME committed events (no new
      // DomainEvent is introduced); the two lane hooks feed the console read
      // views. Both are no-ops until their lane implementations land.
      this.applyP108Console(event, positioned.cursor);

      // P1-16 work-context projections (WorkContextBound / WorkRunLinked /
      // ExecutionNoteRecorded / ContinuationRecorded). Handler + isHandledEventType
      // land in the SAME lane commit; until then advance() rejects the event.
      this.applyP116Context(event, positioned.cursor);

      // P1-12 architecture-inspection projections (4 new events; handler +
      // isHandledEventType land in the SAME lane commit).
      this.applyP112Inspection(event, positioned.cursor);

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

    // P1-04: retain the accepted plan snapshot (tasks + obligations) so the
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
        // P1-03: run-state projection is D (null until a TaskClaimed event).
        run: null,
        sourceCursor: cursor,
      };
      this.taskDetailRows.set(taskDetailKey(projectId, goalId, task.taskId), detail);
    }
  }

  /** P1-03: active agent view — same opaque-cursor freshness as planGraph / taskDetail. */
  /** P1-06: display-only handoff provenance timeline (keyed by full-scope
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
  // P1-07 views (display-only; rebuildable from the EventPage)             //
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

  /** P1-05: goal phase status projection (per (projectId, goalId)). */
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

  /** P1-05: goal phase timeline projection (per (projectId, goalId)). */
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
  // P1-03 run projection handlers                                        //
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
   * terminal outcome. NEVER touches TaskDetail.phase (satisfaction is P1-04). */
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
  // P1-04 verification projection handlers                               //
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

  /** P1-04: task-detail verification view (frozen entry; lane D implements).
   * The view is rebuilt ONLY from events: applicability is recomputed at query
   * time by the PURE evidenceApplicability function against the projected
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

  /** Build the TaskVerificationView from the projected row (query-time derived
   * parts use the pure functions; they never write back to history). */
  private buildVerificationView(row: VerificationProjection): TaskVerificationView {
    const projectId = row.projectId;
    const goalId = row.goalId;
    const taskId = row.taskId;
    const planSnapshot = this.planSnapshots.get(planGraphKey(projectId, goalId)) ?? null;
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
      projectId,
      goalId,
      taskId,
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
  // P1-05 goal phase projection handler                                //
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
  // P1-06 handoff provenance projection handlers                        //
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
  // P1-07 lease / integration / patch projection handlers              //
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

    // P1-07 patch-view fallback: a write release that carries a post-write
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


  // ------------------------------------------------------------------ //
  // P1-08 console query surface + projection hooks (SHARED BASELINE).   //
  // The six console queries are FROZEN in src/contracts/console-views   //
  // (first consumer); this baseline carries the fresh helper + the two  //
  // lane hooks as no-ops. Lane A fills consolePortfolio/consoleSummary //
  // + applyP108ConsoleLaneA; Lane B fills consolePlanMatrix/           //
  // consoleActiveAgents/consoleTaskEvidence/consoleTimeline +           //
  // applyP108ConsoleLaneB. iSHANDLED: all event types are already       //
  // handled (no new DomainEvent) — the list is unchanged.               //
  // ------------------------------------------------------------------ //

  /** P1-08 console projection dispatcher: forwards every committed event to
   * the per-lane console projections. NO new event is created here. */
  private applyP108Console(event: DomainEvent, cursor: CommitCursor): void {
    this.applyP108ConsoleLaneA(event, cursor);
    this.applyP108ConsoleLaneB(event, cursor);
  }

  // P1-16 LANE-A/LANE-B stub regions (filled by the lanes; no-op until then).
  private applyP116Context(event: DomainEvent, cursor: CommitCursor): void {
    this.applyP116ContextLaneA(event, cursor);
    this.applyP116ContextLaneB(event, cursor);
  }

  // LANE-A: WorkContextBinding rows + ExecutionNote rows (binding/notes view part).
  private applyP116ContextLaneA(_event: DomainEvent, _cursor: CommitCursor): void {
    // P1-16 lane A implementation region
  }

  // LANE-B: ContinuationRecord rows + frontier aggregation.
  private applyP116ContextLaneB(_event: DomainEvent, _cursor: CommitCursor): void {
    // P1-16 lane B implementation region
  }

  // P1-12 LANE-A/LANE-B stub regions (filled by the lanes; no-op until then).
  private applyP112Inspection(event: DomainEvent, cursor: CommitCursor): void {
    this.applyP112InspectionLaneA(event, cursor);
    this.applyP112InspectionLaneB(event, cursor);
  }

  // LANE-A: inspection + finding rows.
  private applyP112InspectionLaneA(_event: DomainEvent, _cursor: CommitCursor): void {
    // P1-12 lane A implementation region
  }

  // LANE-B: decision brief + candidate proposal rows.
  private applyP112InspectionLaneB(_event: DomainEvent, _cursor: CommitCursor): void {
    // P1-12 lane B implementation region
  }

  /** P1-08 LANE-A hook (Portfolio + WorkspaceSummary) — rebuilt ONLY from the
   * committed v1 events. Portfolio rows come from WorkspaceBootstrapped; summary
   * rows are touched by every workspace-scoped counter event. Phase COUNT maps
   * track the LATEST phase per task/goal (display-only projection facts). */
  private applyP108ConsoleLaneA(event: DomainEvent, cursor: CommitCursor): void {
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
    } else if (event.eventType === "ReplacementClaimed") {
      // integrator ruling: a replacement claim creates another Agent Run —
      // agentRunCount = claims + replacements (matches the ActiveAgents rows).
      const ev = event as import("../contracts/handoff.js").ReplacementClaimedEvent;
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
        const prev = this.p108TaskReductionPhase.get(key);
        if (prev !== undefined) this.p108DecrementTaskReduction(row, prev);
        this.p108TaskReductionPhase.set(key, phase);
        this.p108IncrementTaskReduction(row, phase);
      });
    } else if (event.eventType === "GoalPhaseUpdated") {
      const ev = event as import("../contracts/goal-phase.js").GoalPhaseUpdatedEvent;
      this.p108TouchSummary(ev.projectId, ev.workspaceId, cursor, ev.occurredAt, (row) => {
        row.goalPhaseCount += 1;
        const phase = ev.payload.phase;
        const key = consoleGoalKey(ev.projectId, ev.workspaceId, ev.payload.goalId);
        const prev = this.p108GoalPhase.get(key);
        if (prev !== undefined) this.p108DecrementGoalPhase(row, prev);
        this.p108GoalPhase.set(key, phase);
        this.p108IncrementGoalPhase(row, phase);
      });
    }
    // Every other event type leaves the workspace summary/portfolio rows
    // unchanged (they are not counter rows per the frozen contract).
  }

  /** WorkspaceBootstrapped -> create/refresh the (projectId, workspaceId)
   * PortfolioEntry AND initialize the WorkspaceSummary row. */
  private p108ApplyBootstrap(
    ev: import("../contracts/bootstrap.js").WorkspaceBootstrappedEventV1,
    cursor: CommitCursor,
  ): void {
    const key = consoleWorkspaceKey(ev.projectId, ev.workspaceId);
    const existing = this.p108PortfolioEntries.get(key);
    const sourceDigest = ev.payload.sourceDigest;
    const bootstrappedAt = ev.occurredAt;
    if (existing === undefined) {
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
      this.p108PortfolioEntries.set(key, entry);
    } else {
      // Idempotent replay: re-running the same event set reproduces the same row;
      // a genuinely new bootstrap refresh carries updated provenance.
      existing.sourceDigest = sourceDigest;
      existing.bootstrappedAt = bootstrappedAt;
      existing.sourceCursor = cursor;
    }
    this.p108TouchSummary(ev.projectId, ev.workspaceId, cursor, bootstrappedAt, (row) => {
      row.sourceDigest = sourceDigest;
      row.bootstrappedAt = bootstrappedAt;
    });
  }

  /** Get (or lazily create) the WorkspaceSummary row for the full scope key and
   * apply one counter mutation; every counter event refreshes sourceCursor +
   * updatedAt. */
  private p108TouchSummary(
    projectId: string,
    workspaceId: string,
    cursor: CommitCursor,
    occurredAt: string,
    update: (row: import("../contracts/console-views.js").WorkspaceSummaryView) => void,
  ): import("../contracts/console-views.js").WorkspaceSummaryView {
    const key = consoleWorkspaceKey(projectId, workspaceId);
    let row = this.p108SummaryRows.get(key);
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
      this.p108SummaryRows.set(key, row);
    } else {
      row.sourceCursor = cursor;
      row.updatedAt = occurredAt;
    }
    update(row);
    return row;
  }

  private p108IncrementTaskReduction(
    row: import("../contracts/console-views.js").WorkspaceSummaryView,
    phase: import("../contracts/reduction.js").TaskReductionPhase,
  ): void {
    row.phaseCounts.taskReduction[phase] = (row.phaseCounts.taskReduction[phase] ?? 0) + 1;
  }

  private p108DecrementTaskReduction(
    row: import("../contracts/console-views.js").WorkspaceSummaryView,
    phase: import("../contracts/reduction.js").TaskReductionPhase,
  ): void {
    row.phaseCounts.taskReduction[phase] = (row.phaseCounts.taskReduction[phase] ?? 0) - 1;
  }

  private p108IncrementGoalPhase(
    row: import("../contracts/console-views.js").WorkspaceSummaryView,
    phase: import("../contracts/goal-phase.js").GoalPhase,
  ): void {
    row.phaseCounts.goalPhase[phase] = (row.phaseCounts.goalPhase[phase] ?? 0) + 1;
  }

  private p108DecrementGoalPhase(
    row: import("../contracts/console-views.js").WorkspaceSummaryView,
    phase: import("../contracts/goal-phase.js").GoalPhase,
  ): void {
    row.phaseCounts.goalPhase[phase] = (row.phaseCounts.goalPhase[phase] ?? 0) - 1;
  }

  // ------------------------------------------------------------------ //
  // P1-08 LANE-B projection fields (per-workspace order/seq + index).   //
  // ------------------------------------------------------------------ //

  /** LANE-B: agent storageKey (consoleTaskKey + "\u0000" + runId) -> workspace arrival seq. */
  private readonly p108AgentRowSeq = new Map<string, number>();
  /** LANE-B: consoleWorkspaceKey -> per-workspace agent arrival seq counter. */
  private readonly p108AgentArrivalSeq = new Map<string, number>();
  /** LANE-B: (projectId \0 runId) -> agent storageKey (RunStarted / RunEventRecorded /
   * RunOutcomeUnknown carry only the runId). */
  private readonly p108AgentRunIndex = new Map<string, string>();
  /** LANE-B: consoleWorkspaceKey -> total timeline arrivals (before the bounded window). */
  private readonly p108TimelineTotal = new Map<string, number>();

  /** P1-08 LANE-B hook (PlanMatrix + ActiveAgents + TaskEvidence + Timeline). */
  private applyP108ConsoleLaneB(event: DomainEvent, cursor: CommitCursor): void {
    switch (event.eventType) {
      case "GoalCreated":
        this.p108Timeline(event, cursor, "goal_created", { goalId: event.aggregateId }, "goal " + event.aggregateId + " created");
        break;
      case "PlanRevisionAccepted":
        this.p108ApplyPlanRevisionAccepted(event, cursor);
        break;
      case "TaskClaimed":
        this.p108ApplyTaskClaimed(event, cursor);
        break;
      case "RunStarted":
        this.p108ApplyRunStarted(event, cursor);
        break;
      case "RunEventRecorded":
        this.p108ApplyRunEventRecorded(event, cursor);
        break;
      case "RunOutcomeUnknown":
        this.p108ApplyRunOutcomeUnknown(event, cursor);
        break;
      case "EvidenceAdmitted":
        this.p108ApplyEvidenceAdmitted(event, cursor);
        break;
      case "TaskReductionUpdated":
        this.p108ApplyTaskReductionUpdated(event, cursor);
        break;
      case "GoalPhaseUpdated":
        this.p108Timeline(event, cursor, "goal_phase", { goalId: event.payload.goalId },
          "goal " + event.payload.goalId + " phase " + event.payload.phase);
        break;
      case "HandoffRecorded":
        this.p108Timeline(event, cursor, "handoff_recorded",
          { goalId: event.payload.goalId, taskId: event.payload.taskId, packetId: event.payload.packet.packetId },
          "handoff packet " + event.payload.packet.packetId + " recorded");
        break;
      case "ReplacementClaimed":
        this.p108ApplyReplacementClaimed(event, cursor);
        break;
      default:
        break;
    }
  }

  /** Helper: active-agent storage key (full-scope task key + runId). */
  private p108AgentStorageKey(projectId: string, workspaceId: string, goalId: string, taskId: string, runId: string): string {
    return consoleTaskKey(projectId, workspaceId, goalId, taskId) + "\u0000" + runId;
  }

  /** Helper: workspace-level agent arrival seq (1-based, deterministic). */
  private p108NextAgentSeq(workspaceKey: string): number {
    const next = (this.p108AgentArrivalSeq.get(workspaceKey) ?? 0) + 1;
    this.p108AgentArrivalSeq.set(workspaceKey, next);
    return next;
  }

  /** Helper: append one bounded workspace timeline entry (drop oldest beyond the bound). */
  private p108Timeline(
    event: { eventId: string; occurredAt: string; projectId: string; workspaceId: string },
    cursor: CommitCursor,
    kind: import("../contracts/console-views.js").TimelineEntryKind,
    refs: { goalId?: string; taskId?: string; runId?: string; evidenceId?: string; packetId?: string },
    summary: string,
  ): void {
    const workspaceKey = consoleWorkspaceKey(event.projectId, event.workspaceId);
    const seq = (this.p108TimelineSeq.get(workspaceKey) ?? 0) + 1;
    this.p108TimelineSeq.set(workspaceKey, seq);
    const total = (this.p108TimelineTotal.get(workspaceKey) ?? 0) + 1;
    this.p108TimelineTotal.set(workspaceKey, total);
    const entry: import("../contracts/console-views.js").TimelineEntry = {
      seq,
      kind,
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      sourceCursor: cursor,
      refs: { projectId: event.projectId, workspaceId: event.workspaceId, ...refs },
      summary,
    };
    const list = this.p108TimelineRows.get(workspaceKey) ?? [];
    list.push(entry);
    if (list.length > CONSOLE_TIMELINE_MAX_ENTRIES) {
      list.splice(0, list.length - CONSOLE_TIMELINE_MAX_ENTRIES);
    }
    this.p108TimelineRows.set(workspaceKey, list);
  }

  /** Helper: display state of a terminal runtime event type (never inferred). */
  private p108TerminalDisplayState(eventType: string): import("../contracts/console-views.js").RunDisplayState {
    switch (eventType) {
      case "run_completed": return "completed_run";
      case "run_crashed": return "crashed";
      case "run_cancelled": return "cancelled";
      case "run_budget_exhausted": return "budget_exhausted";
      default: return "ongoing";
    }
  }

  /** Helper: build a PlanMatrixView from an accepted plan snapshot (shared by the
   * accepted-plan handler and the defensive TaskReductionUpdated rebuild path). */
  private p108BuildMatrix(
    projectId: string,
    workspaceId: string,
    goalId: string,
    snapshot: PlanRevisionSnapshot,
    cursor: CommitCursor,
    updatedAt: string,
  ): import("../contracts/console-views.js").PlanMatrixView {
    const stages = snapshot.stages;
    const stageTitleOf = (stageId: string | undefined): string | null =>
      stageId === undefined ? null : (stages.find((s) => s.stageId === stageId)?.title ?? null);
    const rows: import("../contracts/console-views.js").PlanMatrixRow[] =
      snapshot.tasks.slice(0, CONSOLE_MATRIX_MAX_TASKS).map((task) => ({
        taskId: task.taskId,
        title: task.title,
        stageId: task.stageId ?? null,
        stageTitle: stageTitleOf(task.stageId),
        requirementLevel: task.requirementLevel,
        taskKind: task.taskKind,
        disposition: task.disposition,
        taskScope: task.scope,
        plannedPhase: task.phase,
        livePhase: null,
        phaseSources: {
          planned: { planRef: snapshot.ref, planRevision: snapshot.planRevision, sourceCursor: cursor },
          live: { reductionRevision: null, sourceCursor: null },
        },
        phaseMismatch: false,
        sourceCursor: cursor,
      }));
    return {
      projectId,
      workspaceId,
      goalId,
      planRef: snapshot.ref,
      planRevision: snapshot.planRevision,
      stages,
      rows,
      taskCount: snapshot.tasks.length,
      sourceCursor: cursor,
      updatedAt,
    };
  }

  /** LANE-B: PlanRevisionAccepted -> matrix row + timeline plan_accepted. */
  private p108ApplyPlanRevisionAccepted(event: PlanRevisionAcceptedEvent, cursor: CommitCursor): void {
    const snapshot = event.payload.planRevision;
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const goalId = event.payload.goalId;
    const view = this.p108BuildMatrix(projectId, workspaceId, goalId, snapshot, cursor, event.occurredAt);
    this.p108MatrixRows.set(consoleGoalKey(projectId, workspaceId, goalId), view);
    this.p108Timeline(event, cursor, "plan_accepted", { goalId },
      "plan " + snapshot.ref.planId + " revision " + snapshot.planRevision + " accepted");
  }

  /** LANE-B: TaskClaimed -> create/refresh the active-agent run row (starting). */
  private p108ApplyTaskClaimed(event: TaskClaimedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const { goalId, taskId, runRef, attemptRef, roleBinding, claimedAt } = event.payload;
    const workspaceKey = consoleWorkspaceKey(projectId, workspaceId);
    const taskKey = consoleTaskKey(projectId, workspaceId, goalId, taskId);
    const storageKey = this.p108AgentStorageKey(projectId, workspaceId, goalId, taskId, runRef.runId);
    if (!this.p108AgentRows.has(storageKey)) {
      this.p108AgentRowSeq.set(storageKey, this.p108NextAgentSeq(workspaceKey));
    }
    const marker = this.p108HandoffMarkers.get(taskKey) ?? null;
    const row: import("../contracts/console-views.js").ActiveAgentRunRow = {
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
    this.p108AgentRows.set(storageKey, row);
    this.p108AgentRunIndex.set(projectId + "\u0000" + runRef.runId, storageKey);
    this.p108Timeline(event, cursor, "task_claimed", { goalId, taskId, runId: runRef.runId },
      "work " + taskId + " claimed (run " + runRef.runId + ")");
  }

  /** LANE-B: RunStarted -> the run row becomes running/ongoing. */
  private p108ApplyRunStarted(event: RunStartedEvent, cursor: CommitCursor): void {
    const storageKey = this.p108AgentRunIndex.get(event.projectId + "\u0000" + event.aggregateId);
    if (!storageKey) return;
    const row = this.p108AgentRows.get(storageKey);
    if (!row) return;
    this.p108AgentRows.set(storageKey, {
      ...row,
      runStatus: "running",
      startedAt: event.payload.startedAt,
      attemptStatus: "started",
      displayState: "ongoing",
      sourceCursor: cursor,
    });
    this.p108Timeline(event, cursor, "run_started", { goalId: row.goalId, taskId: row.taskId, runId: row.runRef.runId },
      "run " + row.runRef.runId + " started");
  }

  /** LANE-B: RunEventRecorded -> fold the runtime event into the run row (idempotent on seq). */
  private p108ApplyRunEventRecorded(event: RunEventRecordedEvent, cursor: CommitCursor): void {
    const storageKey = this.p108AgentRunIndex.get(event.projectId + "\u0000" + event.aggregateId);
    if (!storageKey) return;
    const row = this.p108AgentRows.get(storageKey);
    if (!row) return;
    const rt = event.payload.runtimeEvent;
    if (rt.sequence > row.lastEventSeq) {
      const terminal = isTerminalRuntimeEvent(rt);
      const outcome = terminal ? runtimeEventTerminalOutcome(rt) : row.runOutcome;
      const exitCode = rt.payload.kind === "completed" ? rt.payload.exitCode : row.exitCode;
      const endedAt = terminal ? rt.occurredAt : row.endedAt;
      this.p108AgentRows.set(storageKey, {
        ...row,
        runStatus: terminal ? "ended" : "running",
        runOutcome: outcome,
        exitCode,
        lastEventSeq: rt.sequence,
        endedAt,
        attemptStatus: terminal ? "ended" : row.attemptStatus,
        attemptEndOutcome: terminal ? outcome : row.attemptEndOutcome,
        displayState: terminal ? this.p108TerminalDisplayState(rt.eventType) : "ongoing",
        sourceCursor: cursor,
      });
    }
    this.p108Timeline(event, cursor, "run_event", { goalId: row.goalId, taskId: row.taskId, runId: row.runRef.runId },
      "run " + row.runRef.runId + " " + rt.eventType);
  }

  /** LANE-B: RunOutcomeUnknown -> explicit ended/outcome_unknown fact (never inferred). */
  private p108ApplyRunOutcomeUnknown(event: RunOutcomeUnknownEvent, cursor: CommitCursor): void {
    const storageKey = this.p108AgentRunIndex.get(event.projectId + "\u0000" + event.aggregateId);
    if (!storageKey) return;
    const row = this.p108AgentRows.get(storageKey);
    if (!row) return;
    this.p108AgentRows.set(storageKey, {
      ...row,
      runStatus: "ended",
      runOutcome: "outcome_unknown",
      endedAt: event.payload.observedAt,
      attemptStatus: "ended",
      attemptEndOutcome: "outcome_unknown",
      displayState: "outcome_unknown",
      sourceCursor: cursor,
    });
    this.p108Timeline(event, cursor, "run_outcome_unknown", { goalId: row.goalId, taskId: row.taskId, runId: row.runRef.runId },
      "run " + row.runRef.runId + " outcome unknown");
  }

  /** LANE-B: ReplacementClaimed -> task handoff marker + (absent) replacement run row. */
  private p108ApplyReplacementClaimed(event: ReplacementClaimedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const { goalId, taskId, packetRef, priorRunRef, replacementRef, attemptRef, runRef, reason, claimedAt } = event.payload;
    const taskKey = consoleTaskKey(projectId, workspaceId, goalId, taskId);
    const handoff: import("../contracts/console-views.js").ActiveAgentRunRow["handoff"] = {
      packetRef,
      priorRunRef,
      replacementRef,
      reason,
      claimedAt,
      sourceCursor: cursor,
    };
    this.p108HandoffMarkers.set(taskKey, handoff);
    const runKey = projectId + "\u0000" + runRef.runId;
    const storageKey = this.p108AgentStorageKey(projectId, workspaceId, goalId, taskId, runRef.runId);
    if (!this.p108AgentRows.has(storageKey)) {
      this.p108AgentRowSeq.set(storageKey, this.p108NextAgentSeq(consoleWorkspaceKey(projectId, workspaceId)));
      const row: import("../contracts/console-views.js").ActiveAgentRunRow = {
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
      this.p108AgentRows.set(storageKey, row);
    } else {
      const existing = this.p108AgentRows.get(storageKey)!;
      this.p108AgentRows.set(storageKey, { ...existing, handoff, sourceCursor: cursor });
    }
    this.p108AgentRunIndex.set(runKey, storageKey);
    this.p108Timeline(event, cursor, "replacement_claimed", { goalId, taskId, runId: runRef.runId, packetId: packetRef.packetId },
      "replacement claimed (run " + runRef.runId + ")");
  }

  /** LANE-B: EvidenceAdmitted -> append the entry + timeline evidence_admitted. */
  private p108ApplyEvidenceAdmitted(event: EvidenceAdmittedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const { goalId, taskId, evidence, admittedAt, evidenceIndex } = event.payload;
    const taskKey = consoleTaskKey(projectId, workspaceId, goalId, taskId);
    let proj = this.p108EvidenceProjections.get(taskKey);
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
    this.p108EvidenceProjections.set(taskKey, proj);
    this.p108Timeline(event, cursor, "evidence_admitted", { goalId, taskId, evidenceId: evidence.evidenceId },
      "evidence " + evidence.evidenceId + " admitted " + evidence.outcome);
  }

  /** LANE-B: TaskReductionUpdated -> matrix live-phase + evidence reduction + timeline. */
  private p108ApplyTaskReductionUpdated(event: TaskReductionUpdatedEvent, cursor: CommitCursor): void {
    const projectId = event.projectId;
    const workspaceId = event.workspaceId;
    const { goalId, taskId, reduction } = event.payload;

    // Plan matrix: update the task's live phase (defensive rebuild if the matrix
    // row is missing — only a TaskReductionUpdated was seen).
    const matrixKey = consoleGoalKey(projectId, workspaceId, goalId);
    let view = this.p108MatrixRows.get(matrixKey);
    if (!view) {
      const snapshot = this.planSnapshots.get(planGraphKey(projectId, goalId));
      if (snapshot) view = this.p108BuildMatrix(projectId, workspaceId, goalId, snapshot, cursor, event.occurredAt);
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
      this.p108MatrixRows.set(matrixKey, { ...view, rows, sourceCursor: cursor, updatedAt: event.occurredAt });
    }

    // Task evidence projection: refresh the reduction + plan ref.
    const taskKey = consoleTaskKey(projectId, workspaceId, goalId, taskId);
    let proj = this.p108EvidenceProjections.get(taskKey);
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
    this.p108EvidenceProjections.set(taskKey, proj);

    this.p108Timeline(event, cursor, "task_reduction", { goalId, taskId },
      "task " + taskId + " reduced to " + reduction.phase);
  }

  /** Map a projected evidence entry to its task-evidence display entry. */
  private p108ToTaskEvidenceEntry(
    pe: { evidence: EvidenceV1; admittedAt: string; evidenceIndex: number; sourceCursor: CommitCursor },
    planSnapshot: PlanRevisionSnapshot | null,
    currentAnchor: EffectivityAnchorV1 | null,
  ): import("../contracts/console-views.js").TaskEvidenceEntry {
    const e = pe.evidence;
    const marker: import("../contracts/console-views.js").EvidenceFormalMarker =
      e.kind === "claim" || e.kind === "verdict" ? "unverified_report" : "observed_fact";
    const applicability =
      planSnapshot !== null && currentAnchor !== null ? evidenceApplicability(e, planSnapshot, currentAnchor) : null;
    return {
      evidenceId: e.evidenceId,
      kind: e.kind,
      marker,
      outcome: e.outcome,
      coverage: e.coverage.map((c) => ({ ...c })),
      applicability,
      anchor: { ...e.anchor },
      sourceRunRef: e.source.runRef,
      checkId: e.source.checkId,
      artifactRef: e.summary.artifactRef,
      summary: e.summary.text,
      admittedAt: pe.admittedAt,
      evidenceIndex: pe.evidenceIndex,
      sourceCursor: pe.sourceCursor,
    };
  }

  /** Build the TaskEvidenceView from the projected row (query-time pure derivation). */
  private p108BuildEvidenceView(proj: {
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
  }): import("../contracts/console-views.js").TaskEvidenceView {
    const projectId = proj.projectId;
    const goalId = proj.goalId;
    const taskId = proj.taskId;
    const planSnapshot = this.planSnapshots.get(planGraphKey(projectId, goalId)) ?? null;
    const currentAnchor = proj.reduction ? proj.reduction.currentAnchor : null;
    const sorted = [...proj.evidence].sort((a, b) => a.evidenceIndex - b.evidenceIndex);
    const evidence = sorted.map((pe) => this.p108ToTaskEvidenceEntry(pe, planSnapshot, currentAnchor));
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

  /** P1-08 LANE-A: portfolio of bootstrapped Project/Workspace scopes. */
  async consolePortfolio(query: PortfolioViewQuery): Promise<PortfolioViewResult> {
    const observedCursor = this.observedCursor;
    const maxProjects = CONSOLE_PORTFOLIO_MAX_PROJECTS;
    const entries = [...this.p108PortfolioEntries.values()]
      .sort((a, b) => (a.scopeKey < b.scopeKey ? -1 : a.scopeKey > b.scopeKey ? 1 : 0))
      .slice(0, maxProjects);

    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
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
    const observedCursor = this.observedCursor;
    const row = this.p108SummaryRows.get(consoleWorkspaceKey(query.projectId, query.workspaceId));

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

  /** P1-08 LANE-B: plan matrix (key = consoleGoalKey; freshness mirrors goal()). */
  async consolePlanMatrix(query: PlanMatrixViewQuery): Promise<PlanMatrixViewResult> {
    const observedCursor = this.observedCursor;
    const row = this.p108MatrixRows.get(consoleGoalKey(query.projectId, query.workspaceId, query.goalId));
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

  /** P1-08 LANE-B: active agents (per workspace; optional goalId filter; bounded). */
  async consoleActiveAgents(query: ActiveAgentsViewQuery): Promise<ActiveAgentsViewResult> {
    const observedCursor = this.observedCursor;
    const workspaceKey = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const entries: [import("../contracts/console-views.js").ActiveAgentRunRow, number][] = [];
    for (const [storageKey, row] of this.p108AgentRows) {
      if (row.projectId !== query.projectId || row.workspaceId !== query.workspaceId) continue;
      entries.push([row, this.p108AgentRowSeq.get(storageKey) ?? 0]);
    }
    entries.sort((a, b) => a[1] - b[1]);
    const hasRows = entries.length > 0;
    const base = entries.map(([row]) => row);
    const filtered = query.goalId === undefined ? base : base.filter((row) => row.goalId === query.goalId);
    const taskCount = filtered.length;
    const bounded = filtered.slice(-CONSOLE_ACTIVE_AGENTS_MAX_ROWS);
    const rows = bounded.map((row) => {
      const marker = this.p108HandoffMarkers.get(consoleTaskKey(row.projectId, row.workspaceId, row.goalId, row.taskId)) ?? null;
      return marker ? { ...row, handoff: marker } : row;
    });
    const last = bounded.length > 0 ? bounded[bounded.length - 1] : null;
    const view: import("../contracts/console-views.js").ActiveAgentsView = {
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

  /** P1-08 LANE-B: task evidence (key = consoleTaskKey; freshness mirrors goal()). */
  async consoleTaskEvidence(query: TaskEvidenceViewQuery): Promise<TaskEvidenceViewResult> {
    const observedCursor = this.observedCursor;
    const proj = this.p108EvidenceProjections.get(
      consoleTaskKey(query.projectId, query.workspaceId, query.goalId, query.taskId),
    );
    if (query.atLeastCursor !== undefined) {
      if (this.isCovered(query.atLeastCursor)) {
        if (proj) return { status: "ready", evidence: this.p108BuildEvidenceView(proj), observedCursor: observedCursor! };
        return { status: "not_found", observedCursor };
      }
      return { status: "not_ready", requiredCursor: query.atLeastCursor, observedCursor };
    }
    if (proj) return { status: "ready", evidence: this.p108BuildEvidenceView(proj), observedCursor: observedCursor! };
    return { status: "not_ready", requiredCursor: observedCursor ?? makeCommitCursor(1), observedCursor };
  }

  /** P1-08 LANE-B: workspace timeline (per workspace; optional goalId filter; bounded). */
  async consoleTimeline(query: TimelineViewQuery): Promise<TimelineViewResult> {
    const observedCursor = this.observedCursor;
    const workspaceKey = consoleWorkspaceKey(query.projectId, query.workspaceId);
    const entries = this.p108TimelineRows.get(workspaceKey) ?? [];
    const hasRow = entries.length > 0 || (this.p108TimelineTotal.get(workspaceKey) ?? 0) > 0;
    const filtered = query.goalId === undefined ? entries : entries.filter((e) => e.refs.goalId === query.goalId);
    const maxEntries = query.maxEntries === undefined || query.maxEntries < 1
      ? CONSOLE_TIMELINE_MAX_ENTRIES
      : query.maxEntries;
    const bounded = filtered.slice(-maxEntries);
    const view: import("../contracts/console-views.js").TimelineView = {
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

  /** P1-16 LANE-A/LANE-B stub: work context view (binding + notes + continuations).
   * Region markers are fixed by the shared baseline; lane A owns the binding +
   * notes rows, lane B owns the continuation rows + frontier aggregation. */
  async workContext(query: import("../contracts/context-continuity.js").WorkContextViewQuery): Promise<import("../contracts/context-continuity.js").WorkContextViewResult> {
    throw new Error("P1-16 lane A/B: workContext not implemented yet");
  }

  /** P1-12 LANE-A/LANE-B stub: architecture inspection view (inspections +
   * findings + briefs + proposals per (projectId, workspaceId); display only). */
  async architectureInspectionView(query: import("../contracts/architecture-inspection.js").ArchitectureInspectionViewQuery): Promise<import("../contracts/architecture-inspection.js").ArchitectureInspectionViewResult> {
    throw new Error("P1-12 lane A/B: architectureInspectionView not implemented yet");
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
}

/** Factory matching the fixed lane-C entry point (no args yet). */
export function createReadModelIndex(): ReadModelIndex {
  return new ReadModelIndexImpl();
}
