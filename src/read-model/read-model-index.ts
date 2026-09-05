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
import type { PlanRevisionAcceptedEvent } from "../contracts/plan.js";
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
      eventType === "RunOutcomeUnknown"
    );
  }
}

/** Factory matching the fixed lane-C entry point (no args yet). */
export function createReadModelIndex(): ReadModelIndex {
  return new ReadModelIndexImpl();
}
