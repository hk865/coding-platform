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
      }
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
      eventType === "ReplacementClaimed"
    );
  }
}

/** Factory matching the fixed lane-C entry point (no args yet). */
export function createReadModelIndex(): ReadModelIndex {
  return new ReadModelIndexImpl();
}
