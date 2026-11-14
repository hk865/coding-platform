/**
 * Task-graph read DTOs (the single declaration): the Task row, its Plan
 * snapshot and the planning/unknown-call projections the row carries.
 * WorkGraph's `model/plan-contracts.ts` re-exports them; the UI reads them here.
 */
import type { CommitCursor } from './command-event.js';
import type { RunRef, TaskAttemptRef, TaskBudgetV1, TaskEligibility, TaskTriple } from './dispatch.js';
import type { GoalPhaseSnapshot } from './goal-phase.js';
import type {
  DependencyRequirement, Disposition, Phase, PlanRevisionSnapshot, RuntimeTask, TaskDispositionChangeV1,
  TaskInputRequirementV2, TaskRelationV2,
} from './plan.js';
import type { TaskReductionSnapshot } from './reduction.js';
import type { TaskFailureFactsV1, TaskPhaseCauseV1, TaskReworkSummaryV1 } from './task-failure.js';
import type { TaskRequeueRef } from './task-requeue.js';
import type {
  UnknownCallDecisionReasonV1, UnknownCallReviewRef, UnknownCallReviewStatusV1, UnknownCallReviewV1,
} from './unknown-call-review.js';

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
  /** The attempt the selected Run belongs to, counted from 1; absent without a selected Run. */
  attemptOrdinal?: number;
  /** C7 latest disposition change through a future-only adoption; read-only. */
  dispositionChange?: TaskDispositionChangeV1;
  /** K3 L7: the selected Run's review record; absent when no key exists. */
  unknownCallReview?: TaskUnknownCallReview;
  /** R3e.3 (B06 W-7): the Task's persisted completion reduction; absent (not null) when it has none. */
  reduction?: TaskReductionSnapshot;
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
