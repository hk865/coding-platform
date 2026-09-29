import type { ArtifactRef } from '../../contracts/artifact.js';
import type { CommandMeta, SessionRef } from '../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../contracts/core/results.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { QueryJobAnswerSnapshot, QueryJobIntentV1 } from '../../contracts/query-job.js';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import type { RoleBindingRefV1, TaskTriple } from '../../contracts/dispatch.js';
import type { SessionMessage } from '../../core/work-graph/communication/contracts.js';
import type { QueryJobRecord } from '../../core/work-graph/queries/contracts.js';
import type { CreateGoalInput, GoalTaskPort } from '../../core/work-graph/tasks/contracts.js';
import type { TaskClaimPort } from '../../core/work-graph/tasks/claim-contracts.js';
import type { InitialPlanProposalResult, PlanTaskPort } from '../../core/work-graph/tasks/plan-contracts.js';
import type { EvidencePort } from '../../core/work-graph/evidence/contracts.js';
import type { RuntimeExecutionPort } from '../../core/agent-runtime/ports.js';
import type { RegisteredCheckRunner } from '../../core/agent-runtime/check-execution.js';

/** N0-only accepted shape. The full GoalInput proposal/decision protocol is
 * deliberately absent until WorkGraph publishes its real proposal Port. */
export type N0GoalInput = {
  meta: CommandMeta;
  goal: CreateGoalInput;
  requestBodyRef: ArtifactRef;
  text: string;
  action: { kind: 'request_work'; executeWithinRequest: boolean };
};

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
};

export type WorkflowStepKind = keyof WorkflowCalls;

/**
 * One explicit perform step. The request is the owner's real second argument.
 * Only Session creation additionally carries the formal Task/Plan to link after
 * the owner receipt confirms a Session record exists; every other object comes
 * from the original request or a formal receipt, never from a caller-supplied
 * PASS, policy, command or capability.
 */
export type WorkflowOperation = {
  [K in WorkflowStepKind]: { kind: K; request: Parameters<WorkflowCalls[K]>[1] }
    & (K extends 'create_session' ? { taskRef: TaskTriple; planRef: PlanRevisionRef } : {})
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
    reason: string | null;
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
