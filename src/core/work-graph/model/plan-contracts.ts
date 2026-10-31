/** R3c plan/task slice. WorkGraph owns the rules; the Store owns atomic bytes. */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { ControlIntentRef, ControlIntentSnapshotV1 } from '../../../contracts/control-intent.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { EffectWriteResultV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import type { TaskTriple, TaskAttemptRef, RunRef, TaskBudgetV1, TaskEligibility } from '../../../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot, VersionedRef } from '../../../contracts/ledger.js';
import type { GoalPhaseSnapshot } from '../../../contracts/goal-phase.js';
import type { AdoptionGovernancePinsV1 } from '../../../contracts/initialization-adoption.js';
import type { InitializationSourceV1, InterventionAnswerSourceV1 } from '../../../contracts/initial-planning.js';
import type { QueryJobAnswerRef, QueryJobRef } from '../../../contracts/query-job.js';
import type { DependencyRequirement, Disposition, Phase, PlanRevisionDraft, PlanRevisionRef,
  PlanRevisionSnapshot, RuntimeTask, TaskDispositionChangeV1, TaskInputRequirementV2,
  TaskRelationV2 } from '../../../contracts/plan.js';
import type { TaskFailureFactsV1, TaskPhaseCauseV1, TaskReworkSummaryV1 } from '../../../contracts/task-failure.js';
import type { TaskRequeueRef } from '../../../contracts/task-requeue.js';
import type { ToolCommitLookup, UnknownCallDecisionReasonV1, UnknownCallReviewRef, UnknownCallReviewStatusV1, UnknownCallReviewV1 } from '../../../contracts/unknown-call-review.js';
import type { GoalDisplayV1, GoalResumeContinuationV1, GoalRunControlCapabilityV1 } from '../state/goal-machine.js';
import type { PlanChangeReason, PlanProposalRecord, PlanProposalRef } from '../state/plan-machine.js';
import type { GraphWrite } from './task-contracts.js';
import type { InitialPlanAnswerFacts } from '../../../contracts/query-job.js';

export type { InitialPlanAnswerFacts };

/**
 * Versioned Agent submission provenance (W2 §8.1). The single declaration is
 * `DelegatedWriteProvenanceV1` in `contracts/delegated-write.ts` (spec §4.1);
 * this former name keeps the JSON shape and every importer unchanged.
 */
export type { DelegatedWriteProvenanceV1, PlanWriteProvenanceV1 } from '../../../contracts/delegated-write.js';
export type {
  CandidatePlanProposal, CandidateRequestExtensionV1,
  PlanChangeReason, PlanProposalRecord, PlanProposalRef,
} from '../state/plan-machine.js';
export type PlanProposal = PlanProposalRecord;
/** Slice 5 proposePlan input (spec §2.4): the original fields plus the request slot facts. */
export type ProposedPlanDraftRequestV1 = {
  goalRef: GoalRef; basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft; reason: PlanChangeReason;
  requestRef?: QueryJobRef | null;
  replaces?: { proposalRef: PlanProposalRef; revision: number } | null; source?: undefined;
  /** 7A §3.5 item 2: the message this proposal acknowledges; part of the fingerprint only when present. */
  acknowledgement?: SessionMessageRef;
  /** The intervention message this proposal came from; present-only in the fingerprint. */
  sourceMessageRef?: SessionMessageRef | null;
};
export type ProposedPlanSourceRequestV1 = {
  goalRef?: undefined; basedOn: null; draft?: undefined; reason: PlanChangeReason;
  requestRef?: QueryJobRef | null; replaces?: null; source: InitializationSourceV1;
};
/** P-3 freezes both arms; G's commit changes this alias to `ProposedPlanDraftRequestV1 |
 *  ProposedPlanSourceRequestV1` (one line, its only edit in this file). */
export type ProposedPlanRequestV1 = ProposedPlanDraftRequestV1 | ProposedPlanSourceRequestV1;

export type ProposeInitialPlanFromAnswer = (
  ctx: CoreCallContext,
  request: GraphWrite<{ answerRef: QueryJobAnswerRef; reason: PlanChangeReason;
    source?: InitializationSourceV1 }>,
) => Promise<InitialPlanProposalResult>;
export type HostProposePlan = (
  ctx: CoreCallContext,
  request: GraphWrite<ProposedPlanRequestV1>,
) => Promise<EffectWriteResultV1<PlanProposal>>;
export type GoalDetail = { goal: GoalSnapshot; pendingPlan: PlanProposal | null; continuedBy: GoalRef[] };
/**
 * 只读规划诊断（W2 §4.2）。它由已采用的 Plan + canonical task facts 在内存投影，
 * 不写入 Task/Goal 的运行状态，也不是第二套持久 completeness 表；缺省表示该生产者
 * 尚未提供此投影，不等于“没有缺口”。诊断不执行验证工具、不打开材料、不模拟
 * evidence reduction，也不重新读取治理政策。
 */
export type TaskPlanningDiagnostic = {
  code: 'planning_only' | 'acceptance_not_defined';
  taskId: string;
  message: string;
};
export type GoalPlanningDiagnostic = TaskPlanningDiagnostic | {
  code: 'required_task_unfinished';
  taskId: string;
  message: string;
} | {
  code: 'goal_acceptance_not_defined' | 'goal_gate_not_defined';
  message: string;
};
/** `not_evaluated` 是能力边界字面值，不是新 Goal 状态：即使 diagnostics 为空也
 * 不返回 canComplete/completed，不证明证据、来源或正式归约已经满足。 */
export type GoalPlanningView = {
  completionEvaluation: 'not_evaluated';
  diagnostics: GoalPlanningDiagnostic[];
};
/**
 * K3 L7: the selected Run's `UnknownCallReview` record in the Task read model.
 * `unreadable` is the fail-closed value (the key exists but the record could not
 * be read); the plain shape is the bounded public projection the UI and the
 * Workflow gate read. A key that truly does not exist leaves the field absent.
 */
export type TaskUnknownCallReview =
  | { status: 'unreadable' }
  | {
      ref: UnknownCallReviewRef;
      revision: number;
      status: UnknownCallReviewStatusV1;
      decisionReasons: UnknownCallDecisionReasonV1[];
      activeRound: UnknownCallReviewV1['activeRound'];
      hold: 'held' | 'released' | null;
      /** L9: 8 - rounds.length. */
      remainingRoundSlots: number;
    };

export type TaskRow = { ref: TaskTriple; definition: RuntimeTask; effectivePhase: Phase;
  disposition: Disposition; currentAttempt: TaskAttemptRef | null; execution: RunRef | null;
  eligibilityScope: 'task_state'; eligibility: TaskEligibility;
  /** Advisory links only; they do not grant material access or block candidacy. */
  relations: TaskRelationV2[];
  /** Exact v2 inputs. Graph/ready reads never open material and report not_checked. */
  inputRequirements: { requirement: TaskInputRequirementV2; verification: 'not_checked' }[];
  /** V1 hard-edge labels have no exact identity; no availability is inferred. */
  legacyDependencies: { dependsOnId: string; requires: DependencyRequirement;
    verification: 'legacy_unverifiable' }[];
  /** 兼容可选；缺省表示该生产者尚未提供投影，不等于无缺口。 */
  planningDiagnostics?: TaskPlanningDiagnostic[];
  /**
   * Spec §4 TD-1: the projection reason of `effectivePhase`, produced only by
   * `projectTaskPhase`. Read-only; absent until that producer exists.
   */
  phaseCause?: TaskPhaseCauseV1;
  /** The TaskRequeue covering the selected Run (P4); read-only. */
  requeueRef?: TaskRequeueRef;
  /**
   * The claim budget that TaskRequeue pins (TASK-03: a claim with `requeueRef`
   * must carry exactly this budget); absent when it pins none. Read-only.
   */
  requeueBudget?: TaskBudgetV1;
  /** C1 structured failure facts (`buildTaskFailureFacts`); read-only. */
  failure?: TaskFailureFactsV1;
  /** C8 requeue history and automatic count; read-only. */
  rework?: TaskReworkSummaryV1;
  /** C7 latest disposition change through a future-only adoption; read-only. */
  dispositionChange?: TaskDispositionChangeV1;
  /** K3 L7: the selected Run's review record; absent when no key exists. */
  unknownCallReview?: TaskUnknownCallReview;
};
/**
 * R3e.3 formal Goal completion projection. It is INDEPENDENT of the advisory
 * `planning` view: `planning` explains intent gaps, while this reports the
 * formal adopted `GoalPhaseSnapshot@1` (or its confirmed absence) and whether
 * the selected Plan is exactly the Plan the completion was reduced against.
 */
export type GoalCompletionView =
  | { status: 'not_recorded' }
  | { status: 'recorded'; snapshot: GoalPhaseSnapshot; selectedPlanMatches: boolean };
export type TaskGraph = { plan: PlanRevisionSnapshot; tasks: TaskRow[]; sourceCursor: CommitCursor;
  /** 兼容可选；Goal 级完成解释基于同一次已读 Plan + canonical tasks。 */
  planning?: GoalPlanningView;
  /** 兼容可选；正式 Goal 完成投影，缺省表示该生产者尚未提供，不等于未完成。 */
  completion?: GoalCompletionView };
/**
 * A.2 step 5.5 (spec §2.1 展示读取, GOAL-17..30): the Goal display reduction
 * (`reduceGoalDisplay`) of one read window, and the Goal's `starting|running`
 * Runs in active-plan task order (the G7 fan-out set, §2.3). Never stored.
 */
export type GoalDisplayRead = {
  goal: GoalSnapshot;
  display: GoalDisplayV1;
  liveRuns: RunRef[];
  /** Only while the Goal is `active`; empty otherwise (a non-active Goal shows `display.runStops`). */
  resumePending: GoalResumePendingRunV1[];
  sourceCursor: CommitCursor | null;
};
/**
 * A live Run of an ACTIVE Goal whose control pointer is still a Goal fan-out
 * intent: the fan-out pause of an earlier epoch (the resume waits until it is
 * applied and paused, GOAL-14, or until reconcile settles it, GOAL-28), or the
 * fan-out resume while it is still queued (the original Turn has not been
 * re-entered yet). Not part of `reduceGoalDisplay` (its `runStops` exist only
 * while the Goal is not active); it keeps such a Run visible after the resume.
 */
export type GoalResumePendingRunV1 = {
  runRef: RunRef;
  intentRef: ControlIntentRef;
  intentKind: 'pause' | 'resume';
  status: ControlIntentSnapshotV1['status'];
};
/**
 * A.2 step 5.5 (§2.3 受影响集合): the Goal and its `starting|running` Runs of
 * the active Plan in plan task order, from one `readCanonicalTaskFacts`
 * window. The fan-out reads only this, never the display facts.
 */
export type GoalLiveRunsRead = { goal: GoalSnapshot; liveRuns: RunRef[]; sourceCursor: CommitCursor | null };
/** A.2 step 5.6 (GOAL-29): the continuations a Goal resume owes, with the afterRun pin each requeue needs. */
export type GoalResumeContinuationsRead = {
  goal: GoalSnapshot;
  continuations: (GoalResumeContinuationV1 & { afterRunRevision: number })[];
};
export type GoalDisplayQuery = {
  goalRef: GoalRef;
  /**
   * `runStops` order 3 (D-15): the capability of the Goal's pause and cancel
   * for a Run that ENTERED the Kernel, from the Host's capability report
   * (`safePointPause`, `cancel`); a Run that never entered is controlled by
   * the platform (D-7). Absent = both supported.
   */
  entryControlCapabilities?: { pause: GoalRunControlCapabilityV1; cancel: GoalRunControlCapabilityV1 };
};
export type ReadyTask = { task: TaskRow; planRef: PlanRevisionRef; expected: VersionPin[] };
export type TaskPage = { items: ReadyTask[]; nextCursor: string | null; sourceCursor: CommitCursor };
export type PlanPageRequest = { limit: number; cursor?: string; atLeastCursor?: CommitCursor };

/**
 * R5b.4 §11.2 explicit initial-planning decision. It returns ONLY the questions
 * the formal answer actually raised; it carries no candidate, writes nothing and
 * invents no Decision. `needs_decision` is not the normal gate before adoption.
 */
export type InitialPlanDecision = {
  status: 'needs_decision';
  answerRef: QueryJobAnswerRef;
  summary: string;
  questions: string[];
};

/** The one thin initial-plan consumer result: the SAME candidate_v2 writer, or
 * the answer's explicit questions. It is never a shadow proposal/Plan type. */
export type InitialPlanProposalResult = WriteResult<PlanProposal> | InitialPlanDecision;

export interface PlanTaskPort {
  queryGoal(ctx: CoreCallContext, ref: GoalRef): Promise<ReadResult<GoalDetail>>;
  readPlanProposal(ctx: CoreCallContext, ref: PlanProposalRef): Promise<ReadResult<PlanProposal>>;
  proposePlan(ctx: CoreCallContext, request: GraphWrite<ProposedPlanRequestV1>): Promise<EffectWriteResultV1<PlanProposal>>;
  applyPlanChange(ctx: CoreCallContext, request: GraphWrite<{ proposalRef: PlanProposalRef;
    expectedProposalRevision: number; decisionRefs: VersionedRef[];
    acknowledgementRef?: SessionMessageRef;
    /**
     * [lead S5-T3-D8] Slice 5 §2.8: the answer's `response.decision.source`
     * (captured pins + goalBases), passed by the trusted caller together with
     * `acknowledgementRef`. PROOF DATA ONLY, never authorization (decisionRefs
     * and every existing PLAN guard are unchanged; tasks never read
     * communication records). With it the PlanRevisionAccepted event's
     * `decisionApplication` = {acknowledgementRef, capturedPins: source.pins,
     * changes: exact before/after, basisRebases}. Only aggregates that THIS
     * change modifies and that appear in `source.pins` are checked (§3.3 "receipt
     * 中每个被改对象 before 必须对应答复捕获版本，不要求把所有读取 guard 也修改"):
     * their before must equal the captured pin, except the Goal, whose newer
     * revision yields a §2.8 control rebase only when
     * `goalDecisionBasisMatches(basis, current)` and the Goal is active
     * (else revision_conflict). Captured pins of objects this change does not
     * modify are recorded as-is and not re-checked (e.g. SC01: the answered
     * stale candidate was replaced before the adopting change). CAS stays on
     * `meta.expected` as today. Without it the proof has capturedPins [] and
     * basisRebases [].
     */
    decisionSource?: DecisionSourceV1;
    governancePins?: AdoptionGovernancePinsV1 }>): Promise<WriteResult<PlanRevisionSnapshot>>;
  /**
   * R5b.4 §11.2 the ONE thin consumer of a formal `initial_coordination` answer.
   * It accepts no caller draft/origin/assignments/digest: the candidate is the
   * unique v2 normalization of the real persisted Answer/Job/Run/body. The model
   * branch reuses the existing `proposePlan` commit and receipt; `needs_decision`
   * returns the original questions with no write. Stage one declares this seam
   * and leaves the algorithm explicitly unsupported. The `initial-planning`
   * `initialPlanning.bodies` dependency only reads the QueryRun's prepared body.
   * Optional only so the older read-only `PlanTaskPort` doubles that predate this
   * batch keep compiling; the real Plan service always publishes it.
   */
  proposeInitialPlanFromAnswer?(ctx: CoreCallContext, request: GraphWrite<{
    answerRef: QueryJobAnswerRef; reason: PlanChangeReason; source?: InitializationSourceV1
  }>): Promise<InitialPlanProposalResult>;
  /**
   * Slice 5 read-only seam (spec §4.2): the formal facts the v2 normalization
   * consumes, read without creating a candidate. Optional for the same reason
   * as the other read-only seams; the real Plan service publishes it.
   */
  readInitialPlanAnswerFacts?(ctx: CoreCallContext, answerRef: QueryJobAnswerRef,
    source?: InitializationSourceV1 | InterventionAnswerSourceV1): Promise<ReadResult<InitialPlanAnswerFacts>>;
  queryTaskGraph(ctx: CoreCallContext, input: { goalRef: GoalRef; planRef?: PlanRevisionRef;
    atLeastCursor?: CommitCursor }): Promise<ReadResult<TaskGraph>>;
  queryReadyTasks(ctx: CoreCallContext, input: { goalRef: GoalRef; roleIds?: string[];
    includeBlocked: boolean; page: PlanPageRequest }): Promise<ReadResult<TaskPage>>;
  /**
   * A.2 step 5.5 (§2.1 `readGoalDisplayFacts`): the Goal display. Optional only
   * so the older read-only `PlanTaskPort` doubles keep compiling; the real Plan
   * service always publishes it.
   */
  queryGoalDisplay?(ctx: CoreCallContext, input: GoalDisplayQuery): Promise<ReadResult<GoalDisplayRead>>;
  /** A.2 step 5.5 (§2.3): the G7 fan-out set. Optional for the same reason as `queryGoalDisplay`. */
  queryGoalLiveRuns?(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<GoalLiveRunsRead>>;
  /**
   * A.2 step 5.6 (§2 GOAL-29, C4): the work Tasks of an `active` Goal whose
   * selected Run ended paused-interrupted by this Goal's fan-out pause and that
   * no TaskRequeue covers yet; the Host fan-out driver continues each through
   * `requeueTask` with the `goal_resume` trigger. Optional like the reads above.
   */
  queryGoalResumeContinuations?(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<GoalResumeContinuationsRead>>;
  /** K3 L4: the read-only committed-receipt lookup for `propose_future_plan`. */
  lookupToolCommit?: ToolCommitLookup;
}

/**
 * The REAL Plan service surface. `PlanTaskPort` keeps the seam optional only for
 * the older read-only Port doubles; `createPlanService` always publishes it, so
 * the composition root and every real consumer see the required method.
 */
export type PlanServicePort = PlanTaskPort
  & Required<Pick<PlanTaskPort, 'proposeInitialPlanFromAnswer' | 'queryGoalDisplay' | 'queryGoalLiveRuns'
    | 'queryGoalResumeContinuations'>>;
