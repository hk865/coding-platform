import type { CommitCursor } from '../../contracts/command-event.js';
import type { SessionRef, WorkspaceScope } from '../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../contracts/core/results.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { QueryJobAnswerSnapshot, QueryJobIntentV1, QueryRunRef } from '../../contracts/query-job.js';
import type { RoleBindingRefV1, RunRef, TaskBudgetV1, TaskTriple } from '../../contracts/dispatch.js';
import type { UnknownCallReviewRef } from '../../contracts/unknown-call-review.js';
import type { CommandRerunRequestRef } from '../../contracts/command-rerun-request.js';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import type { TaskRequeueRef } from '../../contracts/task-requeue.js';
import type { DecisionSourceV1 } from '../../contracts/goal-decisions.js';
import type { SessionMessage } from '../../core/work-graph/model/communication-contracts.js';
import type { GoalDecisionCauseReadV1 } from '../../core/work-graph/model/decision-contracts.js';
import type { QueryJobRecord } from '../../core/work-graph/queries/contracts.js';
import type { GoalTaskPort } from '../../core/work-graph/model/task-contracts.js';
import type { TaskClaimPort } from '../../core/work-graph/model/claim-contracts.js';
import type { UnknownCallReviewPort } from '../../core/work-graph/model/unknown-call-review-contracts.js';
import type { InitialPlanProposalResult, PlanTaskPort } from '../../core/work-graph/model/plan-contracts.js';
import type { EvidencePort } from '../../core/work-graph/model/evidence-contracts.js';
import type { RuntimeExecutionPort } from '../../core/agent-runtime/ports.js';
import type { RegisteredCheckRunner } from '../../core/agent-runtime/check-execution.js';
import type { SessionResponsibilityPort } from '../../core/work-graph/sessions/session-responsibility-service.js';
import type { RunControlPort } from '../../core/work-graph/tasks/control-contracts.js';
import type { InternalSessionArchivePort } from './session-archive.js';
import type { DecisionActionsPort } from './decision-actions.js';

/**
 * Slice 5 §4.5 (F48): the finite decision-resolution DTOs are declared ONCE in
 * the WorkGraph model (`model/decision-contracts.ts`, spec §0.2 T08) and
 * re-exported here so the Workflow surface shares the exact same shapes.
 */
export type {
  ResolveDecisionInputV1, ResolveDecisionReadV1,
} from '../../core/work-graph/model/decision-contracts.js';

/**
 * K3 B3 (ruling 4, answer 7): one answered, unapplied card the start-up hands
 * to the ONE Workflow advance, keyed by its decision source. The UCR owner's
 * `listUnappliedAnswers` and the CRR reader both feed it through the same
 * `k3-decision-answer-by-source-goal` index; the Workflow dispatches the
 * matching advance by `kind`.
 */
export type RedriveAnswerV1 =
  | { kind: 'unknown_call_review'; reviewRef: UnknownCallReviewRef; answerMessageRef: SessionMessageRef }
  | { kind: 'command_rerun_request'; requestRef: CommandRerunRequestRef; answerMessageRef: SessionMessageRef };

/**
 * K3 UR7 rework 1 (answer 7): ONE internal discriminated failed-card ref. The
 * continuous selection accumulates failures of both card kinds; the kind keys
 * the ref so a CRR request is never mistaken for a UCR record and a later
 * failure never replaces an earlier one.
 */
export type FailedCardRefV1 =
  | { kind: 'unknown_call_review'; reviewRef: UnknownCallReviewRef }
  | { kind: 'command_rerun_request'; requestRef: CommandRerunRequestRef };

/**
 * R5c.1 finite advancement surface.
 *
 * Each member is the exact owner method the Workflow may call exactly once for
 * one `perform` step. The Workflow never restates a shadow signature: a step's
 * request is `Parameters<OwnerMethod>[1]` and its receipt is the awaited return
 * type, so an owner-side field change is followed automatically.
 */
export type WorkflowCalls = {
  create_session: RuntimeExecutionPort['createSession'];
  claim_task: TaskClaimPort['claimTask'];
  prepare: RuntimeExecutionPort['prepareExecution'];
  start: RuntimeExecutionPort['startRun'];
  observe: RuntimeExecutionPort['observeRun'];
  open_checks: EvidencePort['openVerification'];
  run_check: RegisteredCheckRunner['runRegisteredCheck'];
  finalize_checks: EvidencePort['finalizeChecks'];
  complete_task: GoalTaskPort['completeTask'];
  complete_goal: GoalTaskPort['completeGoal'];
  /**
   * K slice (L7, KA2/KA3): close the dangling Kernel Turn of a `kernel_turn_open`
   * Work line before claiming its requeue in the same Session. The operation is
   * idempotent (no receipt is stored); absence of the Runtime member is the
   * `unsupported` route of M1.
   */
  close_open_turn: NonNullable<RuntimeExecutionPort['closeOpenTurn']>;
  /**
   * C8 automatic rework (spec §4.1, §9 VD-12), performed under
   * `WORKFLOW_AUTOMATION_ACTOR` (`automationContext`): `requeue_task` since
   * A.2 step 5.8, `reverify_round` (C5, a successor round on the same Run or
   * gate chain) since step 5.9.
   */
  requeue_task: NonNullable<TaskClaimPort['requeueTask']>;
  reverify_round: NonNullable<EvidencePort['reverifyRound']>;
  /**
   * K3 (spec §2, §3.4 UR4/UR2, L16): the one Workflow step that settles a
   * review record (`round_ended`), or settles it directly when the read-only
   * command capability is unavailable (`review_unavailable`). It is the exact
   * UnknownCallReview owner method. Session B adds `apply_review_disposition`;
   * `cancel_review_round` is declared beside it below.
   */
  settle_review: UnknownCallReviewPort['settleReview'];
  /**
   * K3 §3.4 UR3h / L21 (ruling 3): the Workflow's own automation cancels a
   * review round claimed but never entered (including one paused before entry),
   * through the existing control owner and pinned to the Run revision it read.
   */
  cancel_review_round: RunControlPort['submitControl'];
  /**
   * K3 §3.4 UR7/UR7b (L19, ruling 9): run ② (the adapter table) and ③ on an
   * already answered review card, keyed by the answer's captured source kind.
   * The coordinator replays ② by the answer-derived identity; no second answer.
   */
  apply_review_disposition: DecisionActionsPort['advanceReviewDisposition'];
  /**
   * E15 (wiring 1 §4.4, L10): hand the continued Task's responsibility to the
   * new Session. This is exactly `SessionResponsibilityPort`'s own method,
   * called as the platform automation actor with a deterministic `wf-auto:`
   * request id.
   */
  transfer_responsibility: SessionResponsibilityPort['transferSessionResponsibility'];
  /**
   * E15 (wiring 1 §4.4, L11): transfer the Task and archive a live predecessor
   * line in one composition (mode `handoff_complete`). This is deliberately NOT
   * a WorkGraph owner method: it is the Workflow's own archive composition entry
   * (`InternalSessionArchivePort.archiveLineInternal`), the one intended
   * exception to the "exact owner method" rule above.
   */
  archive_predecessor: InternalSessionArchivePort['archiveLineInternal'];
};

export type WorkflowStepKind = keyof WorkflowCalls;

/**
 * Session creation for a `claim_requeued` Task (spec §4 4.3, LA-1): the new
 * Session then claims with this requeue and budget.
 */
export type WorkflowSessionRequeue = { requeueRef: TaskRequeueRef; budget: TaskBudgetV1 | null };

/**
 * K3 (spec §2 L10/L12/L13): the review round a new Session is created for. It
 * is mutually exclusive with `WorkflowSessionRequeue`. `afterRunRef` is
 * `lastHolderOf(record)` (the most recent round Run, or the record's original
 * Run when it has no rounds); the new Session claims with this review.
 */
export type WorkflowSessionReview = {
  reviewRef: UnknownCallReviewRef;
  expectedRevision: number;
  phase: 'review' | 'proposal';
  afterRunRef: RunRef;
  budget: TaskBudgetV1;
};

/**
 * What a handover step carries so the claim of the continuation can follow it
 * (wiring 1 §2.3, L10/L17): the continued Task and its Plan, the new Session,
 * and, on the crash-recovery path, the requeue this advancement claims with.
 */
export type WorkflowHandoverContinuation = {
  taskRef: TaskTriple;
  planRef: PlanRevisionRef;
  successor: SessionRef;
  requeue?: WorkflowSessionRequeue;
  /** K3 L12: a review-round create_session's handover claims with this review. */
  review?: WorkflowSessionReview;
};

/**
 * One explicit perform step. The request is the owner's real second argument.
 * Only Session creation additionally carries the formal Task/Plan to link after
 * the owner receipt confirms a Session record exists (and, for a requeued Task,
 * the requeue to claim with); every other object comes from the original
 * request or a formal receipt, never from a caller-supplied PASS, policy,
 * command or capability. The two handover steps also carry
 * `WorkflowHandoverContinuation` so the following claim knows the successor.
 */
export type WorkflowOperation = {
  [K in WorkflowStepKind]: { kind: K; request: Parameters<WorkflowCalls[K]>[1] }
    & (K extends 'create_session'
      ? { taskRef: TaskTriple; planRef: PlanRevisionRef; requeue?: WorkflowSessionRequeue; review?: WorkflowSessionReview }
      : K extends 'close_open_turn'
        ? { taskRef: TaskTriple; planRef: PlanRevisionRef; requeue?: WorkflowSessionRequeue; review?: WorkflowSessionReview }
      : K extends 'transfer_responsibility' | 'archive_predecessor'
        ? WorkflowHandoverContinuation : {})
}[WorkflowStepKind];

/** The owner's complete, un-weakened result for one performed step. */
export type WorkflowStepReceipt = {
  [K in WorkflowStepKind]: { kind: K; result: Awaited<ReturnType<WorkflowCalls[K]>> }
}[WorkflowStepKind];

export type WorkflowAdvanceBase = {
  schemaVersion: 1;
  goalRef: GoalRef;
  flowId: string;
  sessionHint: SessionRef | null;
  /**
   * Explicit Task selection for `select_work`. Absent keeps the historical
   * deterministic default selection; present makes the Host choice explicit and
   * lets same-Goal independent Tasks advance on their own.
   */
  taskId?: string;
  /**
   * K3 L28 step 6b (c) kind 4 / UR7b: the answers the start-up reconcile hands
   * over for this Goal, each driven by its own `reviewRef` (M2). Optional
   * everywhere: an ordinary advance has none (UR7 covers the selected Run's
   * record), so the historical callers and the `{ listReviews }`-only start-up
   * seam are unchanged.
   */
  answers?: RedriveAnswerV1[];
};

/**
 * K3-46 rework 4: Host-driver-only carry of cards whose ② already failed in this
 * continuous selection; never a public advance input. The Workflow's advance
 * takes it as a separate internal argument that the public route never passes.
 */
export type WorkflowAdvanceInternal = {
  /**
   * K3 UR7 rework 1 (answer 7): the union carry of both failed card kinds. The
   * Workflow's advance takes it as a separate internal argument that the public
   * route never passes.
   */
  failedCardRefs?: FailedCardRefV1[];
};

/** `select_work` is read-only; `perform` names one already-determined step. */
export type WorkflowAdvanceInput = WorkflowAdvanceBase & (
  | { kind: 'select_work' }
  | { kind: 'perform'; operation: WorkflowOperation }
);

/**
 * `advance` carries the next complete request for the Host to send; `waiting`
 * and `completed` always have `next: null` so the Host never busy-loops. A
 * `completed` state is only published from a formal GoalPhase/completeGoal
 * receipt, never from task counts or a Run terminal status.
 */
export type WorkflowAdvanceResult = CoreRejection | {
  status: 'ready';
  value: {
    state: 'advance' | 'waiting' | 'completed';
    receipt: WorkflowStepReceipt | null;
    next: WorkflowAdvanceInput | null;
    /**
     * K3 UR7 rework 1 (answer 7): the union failed-card set the Host driver
     * carries into the next step of the same continuous selection. Present
     * beside `next` (never inside it) only when the successor is a `select_work`
     * or another `apply_review_disposition` and the set is non-empty; absent
     * otherwise and on every `waiting`/`completed` result.
     */
    failedCardRefs?: FailedCardRefV1[];
    reason: string | null;
    /**
     * Slice 1 E17 (§4.2 S:823): the per-Session failures of the bounded
     * maintenance page this advancement ran with, made visible without changing
     * the state or blocking the selected work. Absent when the page reported
     * none.
     */
    maintenanceFailures?: { sessionRef: SessionRef; rejection: CoreRejection }[];
    /**
     * Slice 5 §4.5 (F48): the formally derived Goal decision cause when an
     * automatic refine/requeue/reverify step is gated by the Goal's current
     * settings (source 2). Absent/null keeps the historical no-cause result; it
     * never fabricates a GoalPhase or changes the display reduction.
     */
    decisionCause?: GoalDecisionCauseReadV1 | null;
    /**
     * K3 L11/UR6 (ruling 6): a `waiting` selection blocked by an unsettled
     * review card carries the card's formal source, so the display can open
     * exactly that card. Absent/null keeps the historical reason-only result.
     */
    source?: DecisionSourceV1 | null;
  };
};

/**
 * R5b.4 §11.5 finite goal-input surface for the FIRST formal initial-planning
 * consumption. Each member is exactly the owner request it delegates once; the
 * Workflow never restates a shadow signature. `executeWithinRequest` only says
 * whether THIS user instruction asked to advance; it grants nothing and never
 * bypasses the Host/Role/claim/evidence authorization.
 */
export type InitialPlanningGoalInput = {
  schemaVersion: 1;
  goalRef: GoalRef;
  flowId: string;
  sessionHint: SessionRef | null;
  executeWithinRequest: boolean;
} & (
  | { kind: 'planning_answer';
      request: Parameters<NonNullable<PlanTaskPort['proposeInitialPlanFromAnswer']>>[1] }
  | { kind: 'adopt_initial_plan';
      request: Parameters<PlanTaskPort['applyPlanChange']>[1] }
);

/**
 * The narrow handleGoalInput result. `waiting`/`needs_decision` always carry
 * `next: null`; a real candidate/adoption may carry the next complete request.
 * `receipt` is the untouched owner result, never a fabricated candidate.
 */
export type InitialPlanningGoalInputResult = CoreRejection | {
  status: 'ready';
  value: {
    state: 'proposed' | 'needs_decision' | 'advance' | 'waiting';
    receipt: InitialPlanProposalResult | WriteResult<PlanRevisionSnapshot>;
    next: { kind: 'goal_input'; input: InitialPlanningGoalInput }
        | { kind: 'work'; input: WorkflowAdvanceInput } | null;
  };
};

/**
 * The frozen explicit-consultation consumer input. The caller supplies only the
 * original message ref, a real Goal, the already-selected read-only Query
 * profile fields and a consumer id; there is no caller recipient, question,
 * answer text, sender identity or terminal state.
 */
export type ConsultationInput = {
  schemaVersion: 1;
  part?: 'response';
  messageRef: SessionMessageRef;
  goalRef: GoalRef;
  roleBinding: RoleBindingRefV1;
  runtimeBudget: RuntimeBudget;
  budget: QueryJobIntentV1['budget'];
  consumerId: string;
};

/**
 * The finite consultation result. `not_found`/`rejected` are reserved for
 * failures BEFORE any action was accepted; once a Query was accepted the caller
 * always receives `ready` with the real message/Query/Answer references it
 * managed to obtain plus a concrete reason, so a later failure never looks like
 * a safe fresh start.
 */
export type ConsultationResult = ReadResult<{
  /**
   * `ended` is the read-only consumer projection for a formally closed/settled
   * Query with no Answer: it keeps the real message/Query facts and reason and
   * never implies a rerun. It is not a new Agent/persisted lifecycle state.
   */
  state: 'waiting' | 'responded' | 'processed' | 'ended';
  message: SessionMessage;
  query: QueryJobRecord | null;
  answer: QueryJobAnswerSnapshot | null;
  reason: string | null;
}>;

/**
 * Slice 2B §2/L8, extended by L16: one backfill batch. `processed` lists the
 * entries this batch inspected (in scan order), each naming the Work Run or the
 * Query it inspected; `next` is the opaque cursor for the following batch
 * (`null` = done). A `retry_later` entry points `next` at that entry and writes
 * nothing; `skipped`/`record_changed` is a version conflict with a concurrent
 * end commit (RUN-21).
 */
export type ActivityBackfillProcessedV1 =
  | { kind: 'run'; runRef: RunRef; outcome: 'counted' | 'unknown' | 'unchanged' | 'skipped' | 'not_entered' | 'retry_later';
      reason: string | null }
  | { kind: 'query'; queryRunRef: QueryRunRef;
      outcome: 'counted' | 'unknown' | 'unchanged' | 'skipped' | 'not_entered' | 'retry_later'; reason: string | null };
export type ActivityBackfillBatchV1 = {
  processed: ActivityBackfillProcessedV1[];
  next: string | null;
  done: boolean;
};
/** The two Workflow backfill operations (P12; the route binds `backfillActivityRange`). */
export type ActivityBackfillInput = { workspace: WorkspaceScope; cursor: string | null };
export type ActivityBackfillRangeInput = { workspace: WorkspaceScope; from: string; to: string; cursor: string | null };

/**
 * Slice 1 §4.1/§4.2: the Workflow archive and maintenance public result types,
 * re-exported so callers of this contracts module see them next to the other
 * Workflow inputs/results. The declarations live in the new Workflow files.
 */
export type {
  ArchiveLineInput, ArchiveStepReceiptV1, ArchiveLineResultV1,
} from './session-archive.js';
export type {
  SessionMaintenanceInput, SessionMaintenanceResultV1,
} from './session-maintenance.js';

/**
 * Slice 1 §4.2: the minimal encoded-event shape the maintenance step reads to
 * derive the executor `finishedAt` from the terminal responsibility close. It is
 * structurally the RecordStore encoded event; declaring it here keeps
 * `business/workflow/` free of any `record-store` module specifier.
 */
export type WorkflowCloseEventV1 = {
  eventId: string; eventType: string; schemaVersion: number; occurredAt: string; json: string;
};
export type WorkflowCloseEventReader = {
  eventAt(cursor: CommitCursor): Promise<ReadResult<{ cursor: CommitCursor; event: WorkflowCloseEventV1 }>>;
};
