import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { TaskClaim } from '../../contracts/core/task-claim.js';
import type { SessionRef, VersionPin } from '../../contracts/core/identity.js';
import type { SessionProvenanceV1 } from '../../contracts/core/session.js';
import type { RunRef, RunSnapshot, TaskBudgetV1, TaskTriple } from '../../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot, WorkspaceRef } from '../../contracts/ledger.js';
import type { PlanRevisionSnapshot, PlanRevisionRef, RuntimeTask, TaskScope } from '../../contracts/plan.js';
import { revisionAssignments } from '../../contracts/plan.js';
import type { TaskReductionRef } from '../../contracts/reduction.js';
import type { GoalPhaseRef } from '../../contracts/goal-phase.js';
import type { RoundSnapshot } from '../../contracts/verification.js';
import type { PreparedTaskExecution } from '../../contracts/core/prepared-execution.js';
import type { ConsumedWaitV1 } from '../../contracts/dispatch.js';
import type {
  UnknownCallReviewRef, UnknownCallReviewV1,
} from '../../contracts/unknown-call-review.js';
import type { TaskAutomationStopReason, TaskAutomationVerdictV1, TaskFailureFactsV1 } from '../../contracts/task-failure.js';
import {
  WORKFLOW_AUTOMATION_ACTOR, type ReworkFailureClass, type TaskRequeueRef, type TaskReworkRefusalRef,
} from '../../contracts/task-requeue.js';
import { canonicalJson, sameJson as sameCanonical, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import { rejected as rejection } from '../../contracts/core/rejections.js';
import { isRecord, nonEmpty } from '../../contracts/validation/common.js';
import { type DecisionSelectionV1, type DecisionSourceV1 } from '../../contracts/goal-decisions.js';
import { UNKNOWN_CALL_REVIEW_T02_REASON } from '../../contracts/unknown-call-review.js';
import type { CreateSessionRequest } from '../../core/agent-runtime/session-operations.js';
import type { PrepareTaskExecutionRequest, StartTaskExecutionRequest } from '../../core/agent-runtime/execution-contracts.js';
import type { ClaimTaskInput, RequeueTaskInput } from '../../core/work-graph/model/claim-contracts.js';
import type { TaskGraph, TaskRow } from '../../core/work-graph/model/plan-contracts.js';
import type { GraphWrite } from '../../core/work-graph/model/task-contracts.js';
import type { GoalDecisionCauseReadV1 } from '../../core/work-graph/model/decision-contracts.js';
import type { SessionCard } from '../../core/work-graph/model/session-contracts.js';
import { runUnresolvedBlocker } from '../../core/work-graph/state/run-machine.js';
import { lastHolderOf } from '../../core/work-graph/state/unknown-call-review.js';
import { sessionMessageRefKey } from '../../core/work-graph/sessions/message-record-codecs.js';
import { liveWaitMessage } from '../../core/work-graph/tasks/session-facts.js';
import {
  beginRefusalIsPermanent, displayRoundStatus, reverifyExemptionOfFacts, successorAutoCount,
} from '../../core/work-graph/state/verification-machine.js';
import { reviewRoundEndedKnown } from '../../core/work-graph/state/review-lease.js';
import type { ReverifyRoundInput } from '../../core/work-graph/model/evidence-contracts.js';
import type { CommandRerunRequestRef } from '../../contracts/command-rerun-request.js';
import type { ConsultationInput, ConsultationResult, FailedCardRefV1, GoalWaitBasisV1, InitialPlanningGoalInput, InitialPlanningGoalInputResult, ResolveDecisionInputV1, ResolveDecisionReadV1, WorkflowAdvanceInput, WorkflowAdvanceInternal, WorkflowAdvanceResult, WorkflowCalls, WorkflowOperation, WorkflowSessionRequeue, WorkflowSessionReview, WorkflowStepReceipt } from './contracts.js';
import type { WorkflowDependencies, WorkflowHostConfiguration, WorkflowPort } from './ports.js';
import type { HandoffWorkflowDependencies } from './contracts.js';
import { createSecretaryHandoffWorkflow } from './session-handoff.js';
import { createConsultationConsumer, asRejection } from './consultation.js';
import { createTaskGate, goalWaitBasisOf } from './task-gate.js';
import { orderTasksByDependency } from './task-order.js';
import { createSessionArchiveService } from './session-archive.js';
import type { RequestSessionArchiveInput } from '../../contracts/core/session-archive.js';
import { createSessionMaintenanceService } from './session-maintenance.js';
import { createDecisionActions, type DecisionActionsPort } from './decision-actions.js';
import { createActivityBackfill } from './activity-backfill.js';
import { servingBinding } from './role-bindings.js';
import type { ActivityBackfillBatchV1 } from './contracts.js';
import { deriveSessionInputId, type SessionMessage } from '../../core/work-graph/model/communication-contracts.js';
import {
  effectiveReplyHandler, messageFactsOfRecord, type DeliveryFactsV1, type DeliveryResponseWaitV1,
} from '../../core/work-graph/state/message-machine.js';
import { sameRef } from '../../core/work-graph/state/ref-equality.js';
import type { DeliveryEligibilityFactsV1 } from '../../core/work-graph/model/session-facts-contracts.js';
import { createInterventionHandler } from './intervention.js';

/**
 * R5c.1 stage-two adoption-first advancement loop.
 *
 * `advanceWork` is stateless: `select_work` deterministically chooses the next
 * step from the formally adopted Goal/Plan, and every `perform` calls exactly
 * ONE owner with the caller's original request, keeps that owner's complete
 * result, and derives the next complete request from the original receipt plus
 * the immutable adopted plan. No Workflow database, dedupe map, private loop or
 * second Runtime/Kernel exists; owner receipts remain the only durable truth.
 */

type Actor = { kind: 'human' | 'system'; id: string };
export type Binding = WorkflowHostConfiguration['bindings'][number];

export type Owned = {
  ctx: CoreCallContext;
  projectId: string;
  workspaceId: string;
  actor: Actor;
};

export type Base = {
  goalRef: GoalRef;
  flowId: string;
  sessionHint: SessionRef | null;
  actor: Actor;
  /** Explicit `select_work` Task selection; null keeps the default selection. */
  taskId: string | null;
  /**
   * K3 UR7 rework 1 (answer 7): the cards whose ② already failed in this
   * continuous selection, discriminated by kind (UCR record or CRR request).
   * Only the Host driver supplies it (the internal third argument of
   * `advanceWork`); a successor `select_work` or another
   * `apply_review_disposition` carries it forward, every other successor drops it.
   */
  failedCardRefs: FailedCardRefV1[];
  /**
   * 〔L5, R3-2〕 `book-7a.md:386–:389`: the message keys this release pass already found blocked, taken from the
   * Host driver's `WorkflowAdvanceInternal.releaseSkip` (`B/contracts.ts:230`). Empty for every other caller.
   */
  releaseSkip: ReadonlySet<string>;
};

/**
 * The internal successor shape: the public next request plus the driver-only
 * carried set. `readyValue` moves the set out of `next` into the result value.
 */
type AdvanceNext = WorkflowAdvanceInput & { failedCardRefs?: FailedCardRefV1[] };

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function sessionAggregateRef(projectId: string, sessionId: string): SessionRef & { aggregateType: 'Session' } {
  return { aggregateType: 'Session', projectId, sessionId };
}

/**
 * K slice (L7, M1/M2): the Runtime's optional dangling-Turn closure, read from
 * the port object each time. Absent means the Runtime never installed the
 * operation (`turnClosure` missing), so `claimRequeued` takes today's fallback
 * without a `close_open_turn` step.
 */
function turnClosureOf(runtime: WorkflowDependencies['runtime']): WorkflowCalls['close_open_turn'] | undefined {
  return runtime.closeOpenTurn;
}

/** Deterministic `wf:` identity: version + flow + real actor + Goal + step kind
 * + the complete request without its not-yet-generated requestId. */
function requestIdFor(base: Base, kind: WorkflowOperation['kind'] | 'adopt_initial_plan', requestWithoutRequestId: unknown): string {
  const material = {
    schemaVersion: 1, flowId: base.flowId, actor: base.actor, goalRef: base.goalRef,
    kind, requestWithoutRequestId,
  } as unknown as JsonValue;
  return 'wf:' + sha256Hex(canonicalJson(material));
}

export function graphWrite<T>(base: Base, kind: WorkflowOperation['kind'], input: T, expected: readonly VersionPin[]): GraphWrite<T> {
  const requestWithoutRequestId = { input, meta: { expected: [...expected] } };
  const requestId = requestIdFor(base, kind, requestWithoutRequestId);
  return { input, meta: { requestId, expected: [...expected] } };
}
/**
 * W-23 (§12.2), ND-8 (§13.4 #21): an automatic rework step's `wf-auto:`
 * identity is derived from its request alone (Goal, step kind, input and the
 * pins incl. `TaskReworkRefusal@k`), never from the flow or the operator. The
 * same request from any driver (a later 推进, the start-up re-drive after a
 * restart that lost the answer) replays the original receipt; a retry after a
 * stale refusal pins @k and so is a new request.
 */
function automaticGraphWrite<T>(base: Base, kind: WorkflowOperation['kind'], input: T, expected: readonly VersionPin[]): GraphWrite<T> {
  const requestWithoutRequestId = { input, meta: { expected: [...expected] } };
  const material = { schemaVersion: 1, goalRef: base.goalRef, kind, requestWithoutRequestId } as unknown as JsonValue;
  return { input, meta: { requestId: 'wf-auto:' + sha256Hex(canonicalJson(material)), expected: [...expected] } };
}
export function prepareStep(base: Base, runRef: RunRef): PrepareTaskExecutionRequest {
  const requestId = requestIdFor(base, 'prepare', { runRef });
  return { runRef, requestId };
}
function startStep(base: Base, prepared: PreparedTaskExecution, consumerId: string): StartTaskExecutionRequest {
  const requestId = requestIdFor(base, 'start', { prepared, consumerId });
  return { prepared, consumerId, requestId };
}
function createSessionStep(
  base: Base,
  value: Omit<CreateSessionRequest, 'meta'>,
  taskRef: TaskTriple,
  planRef: PlanRevisionRef,
  requeue?: WorkflowSessionRequeue,
  review?: WorkflowSessionReview,
): WorkflowOperation {
  const expected: VersionPin[] = [];
  // A Session for a requeued Task is a new request: its identity names the requeue.
  const requestWithoutRequestId = {
    workspace: value.workspace, role: value.role, recommendedRefs: value.recommendedRefs,
    initialLinks: value.initialLinks, meta: { expected },
    ...(value.provenance === undefined ? {} : { provenance: value.provenance }),
    ...(requeue === undefined ? {} : { requeueRef: requeue.requeueRef }),
    // K3 L12: a review round's new Session is its own request; the identity
    // names the record and phase, never the (absent) requeue.
    ...(review === undefined ? {} : { reviewRef: review.reviewRef, reviewPhase: review.phase }),
  };
  const requestId = requestIdFor(base, 'create_session', requestWithoutRequestId);
  return { kind: 'create_session', request: { ...value, meta: { requestId, expected } }, taskRef, planRef,
    ...(requeue === undefined ? {} : { requeue }),
    ...(review === undefined ? {} : { review }) };
}
/**
 * K slice (L7, KA2/KA3): the one close step a `kernel_turn_open` Work line gets
 * before its requeue/review claim. The request is exactly the Runtime's
 * `{ sessionRef, afterRunRef, requeueRef }`; the continuation context the
 * definite-failure fallback needs (`create_session{requeue}` or, for a review
 * round, `create_session{review}` + E15) is carried like `create_session`'s own.
 */
function closeOpenTurnStep(
  sessionRef: SessionRef, afterRunRef: RunRef, requeueRef: TaskRequeueRef | null,
  taskRef: TaskTriple, planRef: PlanRevisionRef, continuation: { requeue?: WorkflowSessionRequeue; review?: WorkflowSessionReview },
): WorkflowOperation {
  return { kind: 'close_open_turn', request: { sessionRef, afterRunRef, requeueRef }, taskRef, planRef,
    ...(continuation.requeue === undefined ? {} : { requeue: continuation.requeue }),
    ...(continuation.review === undefined ? {} : { review: continuation.review }) };
}
/**
 * K3 (§3.4 UR4/UR2, L16): the one Workflow step that settles a review record.
 * The owner reads the round's Run and the prepared manifest itself and guards
 * the revisions in the commit; the Workflow names the record, the cause and the
 * record revision it read. The pin is part of the request: a retry replays its
 * receipt, and the next round's settlement pins a new revision (a new identity).
 */
export function settleReviewStep(
  base: Base, review: Pick<UnknownCallReviewV1, 'ref' | 'revision'>, cause: 'round_ended' | 'review_unavailable',
): WorkflowOperation {
  return { kind: 'settle_review', request: graphWrite(base, 'settle_review',
    { reviewRef: review.ref, cause }, [{ ref: review.ref, revision: review.revision }]) };
}
/**
 * K3 §3.4 UR3h (L21, ruling 3): the Workflow, as automation, cancels a review
 * round that was claimed but never entered (including one paused before
 * entry). The request is pinned to the Run revision read; the control owner
 * ends it RUN-09(U) and a moved revision is a `revision_conflict`.
 */
export function cancelReviewRoundStep(base: Base, run: RunSnapshot): WorkflowOperation {
  return { kind: 'cancel_review_round', request: automaticGraphWrite(base, 'cancel_review_round',
    { runRef: run.ref, kind: 'cancel' as const,
      reason: 'the review record was held before the round entered; cancel the review round' },
    [{ ref: run.ref, revision: run.revision }]) };
}
/** VD-7: a work round opens under the Goal's CURRENT adopted Plan, not the Plan the Run was claimed under. */
function openWorkChecksStep(base: Base, run: RunSnapshot, planRef: PlanRevisionRef): WorkflowOperation {
  const input = { subjectRunRef: run.ref, subject: run.task, planRef };
  return { kind: 'open_checks', request: graphWrite(base, 'open_checks', input, []) };
}
function openGateChecksStep(
  base: Base, planRef: PlanRevisionRef, gate: TaskTriple, producer: RunRef, gateSubject: TaskScope['kind'],
): WorkflowOperation {
  const input = { subjectRunRef: producer, subject: gate, planRef, gateSubject };
  return { kind: 'open_checks', request: graphWrite(base, 'open_checks', input, []) };
}
function finalizeChecksStep(base: Base, round: RoundSnapshot): WorkflowAdvanceInput {
  const request = graphWrite(base, 'finalize_checks', { roundRef: round.ref },
    [{ ref: round.ref, revision: round.revision }]);
  return makePerform(base, { kind: 'finalize_checks', request });
}
/**
 * The next step of an open round (§9.3 "Workflow 推进顺序", by the §9.1 display
 * names): an `executing` check is an unknown window, so `null` (the caller
 * keeps the receipt and waits; never skip it or finalize early); otherwise a
 * `pending` check runs first, interrupted checks or not (V6 "只补未执行");
 * otherwise the round finalizes, an interrupted check counting as a gap. An
 * interrupted check never runs again in the round (D-12).
 */
function nextAfterRound(base: Base, round: RoundSnapshot): WorkflowAdvanceInput | null {
  switch (displayRoundStatus(round)) {
    case 'running': return null;
    case 'completed':
    case 'interrupted':
      return finalizeChecksStep(base, round);
    case 'incomplete': break;
  }
  const pending = round.checks.find((check) => check.phase === 'pending');
  if (pending !== undefined) {
    const request = graphWrite(base, 'run_check', { roundRef: round.ref, checkId: pending.checkId },
      [{ ref: round.ref, revision: round.revision }]);
    return makePerform(base, { kind: 'run_check', request });
  }
  return finalizeChecksStep(base, round);
}
/** VD-7: the completion names the Goal's CURRENT adopted Plan, never the round's frozen `adoptedPlanRef`. */
function completeTaskStep(base: Base, goal: GoalSnapshot, planRef: PlanRevisionRef, round: RoundSnapshot): WorkflowOperation {
  const reductionRef: TaskReductionRef = {
    aggregateType: 'TaskReduction', projectId: round.subject.projectId,
    goalId: round.subject.goalId, taskId: round.subject.taskId,
  };
  const expected: VersionPin[] = [
    { ref: base.goalRef, revision: goal.revision },
    { ref: reductionRef, revision: 0 },
  ];
  const input = { taskRef: round.subject, planRef, roundRef: round.ref };
  return { kind: 'complete_task', request: graphWrite(base, 'complete_task', input, expected) };
}
/**
 * §2 GOAL-07/08 (`goal_completed`: "pin 恰为 Goal + GoalPhase（首次为 0）"): the GoalPhase is pinned at the
 * revision the Workflow read with the Task graph, so a Goal completed for an earlier Plan completes again for
 * the newly adopted one (`COMPLETED@r+1`, I-3).
 */
function completeGoalStep(base: Base, projectId: string, goal: GoalSnapshot, completion: TaskGraph['completion']): WorkflowOperation {
  const phaseRef: GoalPhaseRef = { aggregateType: 'GoalPhase', projectId, goalId: base.goalRef.goalId };
  const expected: VersionPin[] = [
    { ref: base.goalRef, revision: goal.revision },
    { ref: phaseRef, revision: completion?.status === 'recorded' ? completion.snapshot.revision : 0 },
  ];
  return { kind: 'complete_goal', request: graphWrite(base, 'complete_goal', { goalRef: base.goalRef }, expected) };
}
/**
 * C8 automatic requeue of one failed Task (§4.3 "Workflow", §15.2 5.8): the
 * afterRun is the Task's selected Run as the failure facts read it. `expected`
 * pins the Goal, the afterRun and the requeue refusal under the afterRun's key
 * (`TaskReworkRefusal@k`, k = 0 when there is none); the requestId is derived
 * from the request alone (`automaticGraphWrite`, W-23), so a retry after a
 * stale refusal is a new request with a new requestId (ND-8, §13.4 #21). The reason
 * names the class and the automatic count this requeue writes
 * (`auto-rework:<class>#<autoCount>`; a class `interrupted` is not counted,
 * ND-7). `budget` is only the binding's larger budget after `budget_exhausted`.
 */
export function requeueTaskStep(
  base: Base, goal: GoalSnapshot, task: TaskTriple, failure: TaskFailureFactsV1, afterRunRef: RunRef, afterRunRevision: number,
  failureClass: ReworkFailureClass, budget: TaskBudgetV1 | null,
): WorkflowOperation {
  const refusalRef: TaskReworkRefusalRef = { aggregateType: 'TaskReworkRefusal', projectId: task.projectId,
    goalId: task.goalId, taskId: task.taskId, operation: 'requeue', subjectId: afterRunRef.runId };
  const autoCount = failure.automation.requeueAutoCount + (failureClass === 'interrupted' ? 0 : 1);
  const input: RequeueTaskInput = {
    taskRef: { projectId: task.projectId, goalId: task.goalId, taskId: task.taskId },
    afterRunRef: { ...afterRunRef }, reason: `auto-rework:${failureClass}#${autoCount}`,
    ...(budget === null ? {} : { budget: { ...budget } }),
  };
  const expected: VersionPin[] = [
    { ref: base.goalRef, revision: goal.revision },
    { ref: afterRunRef, revision: afterRunRevision },
    { ref: refusalRef, revision: failure.automation.lastRefusal?.revision ?? 0 },
  ];
  return { kind: 'requeue_task', request: automaticGraphWrite(base, 'requeue_task', input, expected) };
}
/**
 * C5 automatic successor round (§9 VD-12, §13.7 points 9 and 11, §15.2 5.9) of
 * the chain head a work Task's or a gate's `reverify` verdict names, as the
 * failure facts read it. `expected` pins the predecessor round at its
 * revision and the reverify refusal under its key
 * (`TaskReworkRefusal(reverify, head)@k`, k = 0 when there is none); the
 * requestId is derived from the request alone (`automaticGraphWrite`, W-23), so
 * a retry after a stale refusal is a new request. The reason names the class
 * and the automatic count the successor records (`auto-reverify:<class>#<n>`;
 * a Host-interruption exemption keeps the count, `successorAutoCount`); a
 * gate FAIL head asks `onlyIfSourceChanged` (GV-9). No Run, no continuation
 * brief. `null` when the facts no longer name that head.
 */
export function reverifyRoundStep(
  base: Base, task: TaskTriple, failure: TaskFailureFactsV1, verdict: Extract<TaskAutomationVerdictV1, { kind: 'reverify' }>,
): WorkflowOperation | null {
  const head = failure.round;
  if (head === null || !sameCanonical(head.roundRef, verdict.roundRef)) return null;
  const refusalRef: TaskReworkRefusalRef = { aggregateType: 'TaskReworkRefusal', projectId: task.projectId,
    goalId: task.goalId, taskId: task.taskId, operation: 'reverify', subjectId: head.roundRef.roundId };
  const exemption = reverifyExemptionOfFacts({ checks: head.failingChecks, gapCodes: head.gapCodes });
  const autoCount = successorAutoCount(head.autoCount, 'system', exemption);
  const input: ReverifyRoundInput = {
    predecessorRoundRef: { ...head.roundRef }, reason: `auto-reverify:${verdict.failureClass}#${autoCount}`,
    ...(verdict.onlyIfSourceChanged ? { onlyIfSourceChanged: true } : {}),
  };
  const expected: VersionPin[] = [
    { ref: head.roundRef, revision: head.revision },
    { ref: refusalRef, revision: failure.automation.lastReverifyRefusal?.revision ?? 0 },
  ];
  return { kind: 'reverify_round', request: automaticGraphWrite(base, 'reverify_round', input, expected) };
}
/**
 * The tail of the wait on a stopped gate (§2 GOAL-30, §13.7): what a person can
 * do about the stop reason. A fix Task or a person's re-verification for a
 * failed gate, the cap or an unchanged key; a check covering the requirement
 * for an uncovered one (§13.7 point 6); nothing that grows the chain past its
 * limit (`not_reworkable{round_chain_limit}`; an invalid chain has no head and
 * never waits here). The prefix `<stop reason>:` is the code.
 */
function gateStopAdvice(reason: TaskAutomationStopReason): string {
  switch (reason) {
    case 'gate_needs_fix':
    case 'no_new_basis':
    case 'auto_rework_cap_reached':
      return 'a person decides (add a fix Task, or re-verify)';
    case 'verification_uncovered':
      return 'register a check that covers the requirement in the Host settings';
    case 'not_reworkable':
      return 'its round chain cannot grow; a person decides';
    case 'unknown_outcome':
    case 'budget_exhausted':
    case 'task_cancelled':
    case 'task_paused':
    // K3 AV-2b and AV-5m are work-Task reasons a gate never reports, but the
    // closed union must be handled.
    case 'unknown_call_review':
    case 'interrupted_pending_resume':
      return 'a person decides';
  }
}
/** The chain head the failure facts read (a work Task's selected Run, or a gate's own) is finalized and not a clean PASS. */
function headFinalizedNonPass(row: TaskRow): boolean {
  const head = row.failure?.round;
  return head !== undefined && head !== null && head.status === 'finalized' && (head.outcome !== 'PASS' || head.gapCodes.length > 0);
}
/** K3 UR7 rework 1: copy a discriminated failed-card ref so a successor never aliases a caller's object. */
function cloneFailedCardRef(card: FailedCardRefV1): FailedCardRefV1 {
  return card.kind === 'unknown_call_review'
    ? { kind: 'unknown_call_review', reviewRef: { ...card.reviewRef } }
    : { kind: 'command_rerun_request', requestRef: { ...card.requestRef } };
}
/** K3 UR7 rework 1: copy the carried failed cards so a successor never aliases a caller's array. */
function carriedFailedCardRefs(base: Base): FailedCardRefV1[] {
  return base.failedCardRefs.map(cloneFailedCardRef);
}
function failedCardKey(card: FailedCardRefV1): string {
  return canonicalJson(card as unknown as JsonValue);
}
function completeUcrRef(raw: unknown): UnknownCallReviewRef | null {
  if (!isRecord(raw) || raw['aggregateType'] !== 'UnknownCallReview'
    || !nonEmpty(raw['projectId']) || !nonEmpty(raw['goalId']) || !nonEmpty(raw['runId'])) return null;
  return { aggregateType: 'UnknownCallReview', projectId: raw['projectId'] as string,
    goalId: raw['goalId'] as string, runId: raw['runId'] as string };
}
function completeCrrRef(raw: unknown): CommandRerunRequestRef | null {
  if (!isRecord(raw) || raw['aggregateType'] !== 'CommandRerunRequest'
    || !nonEmpty(raw['projectId']) || !nonEmpty(raw['goalId'])
    || !nonEmpty(raw['taskId']) || !nonEmpty(raw['requestId'])) return null;
  return { aggregateType: 'CommandRerunRequest', projectId: raw['projectId'] as string,
    goalId: raw['goalId'] as string, taskId: raw['taskId'] as string,
    requestId: raw['requestId'] as string };
}
/** One discriminated failed-card ref from a decision-source kind and its raw ref, or null when incomplete. */
function failedCardRefOf(kind: 'unknown_call_review' | 'command_rerun_request', raw: unknown): FailedCardRefV1 | null {
  if (kind === 'unknown_call_review') {
    const reviewRef = completeUcrRef(raw);
    return reviewRef === null ? null : { kind: 'unknown_call_review', reviewRef };
  }
  const requestRef = completeCrrRef(raw);
  return requestRef === null ? null : { kind: 'command_rerun_request', requestRef };
}
/** K3 UR7 rework 1: add one failure to the set, de-duplicated by the whole discriminated ref. */
function addFailedCardRef(refs: FailedCardRefV1[], card: FailedCardRefV1): void {
  const key = failedCardKey(card);
  if (!refs.some(existing => failedCardKey(existing) === key)) refs.push(cloneFailedCardRef(card));
}
/**
 * K3-46 rework 2 item 1: a `select_work` is always part of the continuous
 * selection, and another `apply_review_disposition` is the only perform step
 * that continues it. Every other successor drops the set (a fresh selection).
 */
function makePerform(base: Base, operation: WorkflowOperation): AdvanceNext {
  return { schemaVersion: 1, goalRef: base.goalRef, flowId: base.flowId, sessionHint: base.sessionHint, kind: 'perform', operation,
    // An explicit Task selection is preserved across every successor request.
    ...(base.taskId === null ? {} : { taskId: base.taskId }),
    ...(operation.kind !== 'apply_review_disposition' || base.failedCardRefs.length === 0
      ? {} : { failedCardRefs: carriedFailedCardRefs(base) }) };
}
/** Back to the read-only selection, keeping the flow, the Session hint, an explicit Task selection and the failed cards. */
function selectWorkStep(base: Base): AdvanceNext {
  return { schemaVersion: 1, goalRef: base.goalRef, flowId: base.flowId, sessionHint: base.sessionHint, kind: 'select_work',
    ...(base.taskId === null ? {} : { taskId: base.taskId }),
    ...(base.failedCardRefs.length === 0 ? {} : { failedCardRefs: carriedFailedCardRefs(base) }) };
}
/** K3 UR7 rework 1: the UCR and CRR card refs captured in one apply request's pins. */
function failedCardRefsOfPins(pins: readonly VersionPin[]): FailedCardRefV1[] {
  const refs: FailedCardRefV1[] = [];
  for (const pin of pins) {
    const ref = pin.ref as { aggregateType?: unknown } | null;
    if (ref === null) continue;
    const card = ref.aggregateType === 'UnknownCallReview'
      ? failedCardRefOf('unknown_call_review', ref)
      : ref.aggregateType === 'CommandRerunRequest' ? failedCardRefOf('command_rerun_request', ref) : null;
    if (card !== null) addFailedCardRef(refs, card);
  }
  return refs;
}
/** K3 UR7 rework 1: merge one ② failure's refs into the continuous selection's set, de-duplicated canonically. */
function mergeFailedCardRefs(base: Base, refs: readonly FailedCardRefV1[]): Base {
  const merged = carriedFailedCardRefs(base);
  for (const ref of refs) addFailedCardRef(merged, ref);
  return { ...base, failedCardRefs: merged };
}

type WorkflowAdvanceValue = {
  state: 'advance' | 'waiting' | 'completed';
  receipt: WorkflowStepReceipt | null;
  next: AdvanceNext | null;
  reason: string | null;
  /**
   * Slice 5 §4.5: an automatic refine/requeue/reverify step gated by the Goal's
   * current settings carries the formally derived cause. Part 1 only plumbs the
   * field through the result type; no selection behaviour changes yet.
   */
  decisionCause?: GoalDecisionCauseReadV1 | null;
  /** K3 UR6/ruling 6: the blocked review card's formal source on a `waiting` result. */
  source?: DecisionSourceV1 | null;
  waitBasis?: GoalWaitBasisV1;
};
/**
 * K3 UR7 rework 1: the driver-only carried set never travels inside `next`; it
 * is moved beside `next` exactly when the successor is part of the continuous
 * selection and the set is non-empty. The internal failed-card expression is the
 * only one; the old `failedReviewRefs` public field is not produced.
 */
export function readyValue(value: WorkflowAdvanceValue): WorkflowAdvanceResult {
  const next = value.next;
  if (next === null) return { status: 'ready', value };
  const { failedCardRefs, ...publicNext } = next;
  const cards = failedCardRefs ?? [];
  return { status: 'ready', value: {
    ...value,
    next: publicNext,
    ...(cards.length === 0 ? {} : { failedCardRefs: cards.map(cloneFailedCardRef) }),
  } };
}
function advancing(receipt: WorkflowStepReceipt | null, next: AdvanceNext,
  reason: string | null = null): WorkflowAdvanceResult {
  return readyValue({ state: 'advance', receipt, next, reason });
}
export function waiting(receipt: WorkflowStepReceipt | null, reason: string,
  source?: DecisionSourceV1, waitBasis?: GoalWaitBasisV1): WorkflowAdvanceResult {
  return readyValue({ state: 'waiting', receipt, next: null, reason,
    ...(source === undefined ? {} : { source }),
    ...(waitBasis === undefined ? {} : { waitBasis }) });
}
function completed(receipt: WorkflowStepReceipt | null, reason: string): WorkflowAdvanceResult {
  return readyValue({ state: 'completed', receipt, next: null, reason });
}

function readRejection(result: { status: 'not_found' } | { status: 'not_ready' } | CoreRejection): CoreRejection {
  if (result.status === 'rejected') return result;
  if (result.status === 'not_found') return rejection('not_found', 'the requested fact does not exist');
  return rejection('incomplete', 'the requested read is not ready at the required watermark');
}
/** Book §3.8 item 3 (`book-7a.md:385`): one bounded candidate page — the port's own maximum (`decision-contracts.ts:531`). */
const RELEASE_CANDIDATE_PAGE_LIMIT = 100;

function receiptReason(result: unknown, fallback: string): string {
  if (isRecord(result) && typeof result['reason'] === 'string' && result['reason'].length > 0) return result['reason'];
  if (isRecord(result) && result['status'] === 'not_found') return 'the requested record does not exist';
  if (isRecord(result) && result['status'] === 'not_ready') return 'the read is not ready at the required watermark';
  return fallback;
}

/** §4.3: thin stable-ordering delegate; only reorders, never gates. */
function orderTasks(tasks: readonly RuntimeTask[], dependsOn: Parameters<typeof orderTasksByDependency>[1]): RuntimeTask[] {
  return orderTasksByDependency(tasks, dependsOn);
}
/**
 * L-15 (§9 VD-11, C7): a cancelled or superseded Task carries no work any more
 * (`completion-policy.ts` skips it too); a deferred one waits for a plan change.
 */
function carriesWork(task: RuntimeTask): boolean {
  return task.disposition !== 'cancelled' && task.disposition !== 'superseded';
}
function describeGap(ordered: readonly RuntimeTask[], graph: TaskGraph): string {
  const parts: string[] = [];
  for (const task of ordered) {
    if (task.requirementLevel !== 'required' || !carriesWork(task)) continue;
    const row = graph.tasks.find((candidate) => candidate.ref.taskId === task.taskId);
    if (row === undefined) { parts.push(`${task.taskId}: task state is not readable`); continue; }
    if (row.effectivePhase === 'satisfied') continue;
    // The disposition first (C7): a deferred Task is not advanced, whatever its phase.
    if (task.disposition !== 'active') { parts.push(`${task.taskId}: ${task.disposition}`); continue; }
    if (task.taskKind === 'work' && task.executionIntent === 'plan_only') { parts.push(`${task.taskId}: plan_only`); continue; }
    if (row.execution !== null) { parts.push(`${task.taskId}: ${row.effectivePhase} with an existing Run`); continue; }
    if (!row.eligibility.eligible) { parts.push(`${task.taskId}: ${row.eligibility.reasons.map((reason) => reason.code).join(', ')}`); continue; }
    parts.push(`${task.taskId}: ${row.effectivePhase}`);
  }
  return parts.length === 0 ? 'no executable required work is available' : `required work cannot advance: ${parts.join('; ')}`;
}

function normalEnd(run: RunSnapshot): { ok: true } | { ok: false; reason: string } {
  if (run.status !== 'ended') return { ok: false, reason: `the Run ${run.ref.runId} is still ${run.status}` };
  if (run.outcome !== 'completed') return { ok: false, reason: `the Run ${run.ref.runId} ended with outcome ${run.outcome ?? 'null'}` };
  if (run.reconciliation !== undefined && run.reconciliation.status !== 'done') {
    return { ok: false, reason: `the Run ${run.ref.runId} reconciliation is ${run.reconciliation.status}` };
  }
  return { ok: true };
}
/** AV-6 for FC-11 (P10): the selected Run's round chain is invalid, so the Task has no chain head. */
function isRoundAmbiguous(row: TaskRow): boolean {
  const verdict = row.failure?.automation.verdict;
  return verdict?.kind === 'stopped' && verdict.reason === 'not_reworkable' && verdict.detail.cause === 'round_ambiguous';
}
function failedOutcome(run: RunSnapshot): boolean {
  switch (run.outcome) {
    case 'crashed':
    case 'failed':
    case 'budget_exhausted':
    case 'cancelled':
      return true;
    default:
      return false;
  }
}
/**
 * §15.2 5.8 result mapping (C8) for a Run that `start`/`observe` returns not
 * normally ended (`notNormal` is `normalEnd`'s reason). A Run that ended with a
 * known failure (`crashed`, `failed`, `budget_exhausted` or `cancelled`) and
 * has nothing left to reconcile goes back to `select_work`, where the Task's
 * failure facts and automation verdict decide; one that still carries a
 * quarantined or unresolved reconciliation or an unknown or quarantined entry
 * authorization waits for that with the `runUnresolvedBlocker` text (hard
 * limit 1). A Run still open, a yielded wait, an unknown outcome and a
 * completed Run whose reconciliation is not done keep `normalEnd`'s reason.
 */
function afterNotNormalEnd(receipt: WorkflowStepReceipt, run: RunSnapshot, notNormal: string, base: Base): WorkflowAdvanceResult {
  if (run.status !== 'ended' || !failedOutcome(run)) return waiting(receipt, notNormal);
  const blocker = runUnresolvedBlocker(run);
  return blocker === null ? advancing(receipt, selectWorkStep(base)) : waiting(receipt, blocker);
}
function roleReusable(card: SessionCard, workspaceId: string, binding: Binding): boolean {
  const record = card.record;
  return record.workspaceId === workspaceId
    && record.lifecycle === 'active'
    && record.health === 'available'
    && record.occupancy === null
    && sameCanonical(record.role, binding.sessionRole);
}

// --------------------------------------------------------------------------
// Context / input isolation (before the first await)
// --------------------------------------------------------------------------

export function ownContext(ctx: CoreCallContext): Owned | { rejection: CoreRejection } {
  const raw = ctx as unknown as Record<string, unknown> | null | undefined;
  if (!isRecord(raw)) return { rejection: rejection('invalid', 'advanceWork requires a bound call context') };
  const projectId = raw['projectId'];
  const workspaceId = raw['workspaceId'];
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId)) {
    return { rejection: rejection('forbidden', 'advanceWork requires a bound project/workspace context') };
  }
  const signal = raw['signal'];
  if (signal === null || typeof signal !== 'object' || typeof (signal as { aborted?: unknown }).aborted !== 'boolean') {
    return { rejection: rejection('forbidden', 'advanceWork requires the bound AbortSignal') };
  }
  let principal: unknown;
  let materialReader: unknown;
  try {
    principal = structuredClone(raw['principal']);
    materialReader = structuredClone(raw['materialReader']);
  } catch {
    return { rejection: rejection('invalid', 'the call context identity cannot be isolated from the caller') };
  }
  if (!isRecord(principal) || principal['kind'] !== 'host') {
    return { rejection: rejection('forbidden', 'advanceWork requires a trusted Host principal') };
  }
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return { rejection: rejection('forbidden', 'advanceWork requires a trusted Host actor') };
  }
  if (!isRecord(materialReader) || materialReader['kind'] !== 'host'
    || materialReader['projectId'] !== projectId
    || (materialReader['workspaceId'] !== undefined && materialReader['workspaceId'] !== workspaceId)) {
    return { rejection: rejection('forbidden', 'the material reader is not the same trusted Host scope') };
  }
  const ownedCtx: CoreCallContext = {
    projectId, workspaceId,
    principal: principal as CoreCallContext['principal'],
    materialReader: materialReader as CoreCallContext['materialReader'],
    signal: signal as AbortSignal,
  };
  return { ctx: ownedCtx, projectId, workspaceId, actor: { kind: actor['kind'], id: actor['id'] } };
}

/**
 * TD-6 (C8): the context of the Workflow's own rework steps (`requeue_task`,
 * `reverify_round`). Same trusted Host scope and signal as the
 * call, with the platform automation actor `WORKFLOW_AUTOMATION_ACTOR`, so the
 * owner derives the actor class `system`: the step is counted, capped and
 * fenced by a person's stop like any automatic rework, never as the operator.
 */
function automationContext(owned: Owned): CoreCallContext {
  const actor = { ...WORKFLOW_AUTOMATION_ACTOR };
  return { projectId: owned.projectId, workspaceId: owned.workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: owned.projectId, workspaceId: owned.workspaceId, actor: { ...actor } },
    signal: owned.ctx.signal };
}

function failedCardRefsFromInternal(
  internal: WorkflowAdvanceInternal | undefined, owned: Owned,
): { failedCardRefs: FailedCardRefV1[] } | { rejection: CoreRejection } {
  const refs: FailedCardRefV1[] = [];
  if (internal === undefined) return { failedCardRefs: refs };
  if (!isRecord(internal)) {
    return { rejection: rejection('invalid', 'the internal advance input must be an object') };
  }
  const raw = (internal as unknown as Record<string, unknown>)['failedCardRefs'];
  if (raw !== undefined) {
    if (!Array.isArray(raw)) {
      return { rejection: rejection('invalid', 'the internal failedCardRefs must be an array of discriminated card refs when present') };
    }
    for (const candidate of raw) {
      if (!isRecord(candidate)) {
        return { rejection: rejection('invalid', 'the internal failedCardRefs must hold discriminated card refs') };
      }
      const kind = candidate['kind'];
      if (kind !== 'unknown_call_review' && kind !== 'command_rerun_request') {
        return { rejection: rejection('invalid', 'an internal failed card ref must be unknown_call_review or command_rerun_request') };
      }
      const card = failedCardRefOf(kind, kind === 'unknown_call_review'
        ? candidate['reviewRef'] : candidate['requestRef']);
      if (card === null) {
        return { rejection: rejection('invalid', `the internal failed ${kind} ref must be a complete card ref`) };
      }
      const projectId = card.kind === 'unknown_call_review' ? card.reviewRef.projectId : card.requestRef.projectId;
      if (projectId !== owned.projectId) {
        return { rejection: rejection('forbidden', 'a failed card ref is outside the bound project scope') };
      }
      addFailedCardRef(refs, card);
    }
  }
  return { failedCardRefs: refs };
}

function baseFromInput(
  input: WorkflowAdvanceInput, internal: WorkflowAdvanceInternal | undefined, owned: Owned,
): Base | { rejection: CoreRejection } {
  const raw = input as unknown as Record<string, unknown>;
  if (raw['schemaVersion'] !== 1) return { rejection: rejection('invalid', 'advanceWork requires schemaVersion 1') };
  for (const internalKey of ['failedReviewRefs', 'failedCardRefs']) {
    if (Object.prototype.hasOwnProperty.call(raw, internalKey)) {
      return { rejection: rejection('invalid',
        `${internalKey} is internal to the Host driver and is not a public advance input`) };
    }
  }
  const goalRef = raw['goalRef'];
  if (!isRecord(goalRef) || goalRef['aggregateType'] !== 'Goal'
    || !nonEmpty(goalRef['projectId']) || !nonEmpty(goalRef['goalId'])) {
    return { rejection: rejection('invalid', 'advanceWork requires a complete GoalRef') };
  }
  if (goalRef['projectId'] !== owned.projectId) {
    return { rejection: rejection('forbidden', 'the Goal is outside the bound project scope') };
  }
  const flowId = raw['flowId'];
  if (!nonEmpty(flowId)) return { rejection: rejection('invalid', 'advanceWork requires a flowId') };
  const hint = raw['sessionHint'];
  let sessionHint: SessionRef | null = null;
  if (hint !== null && hint !== undefined) {
    if (!isRecord(hint) || !nonEmpty(hint['projectId']) || !nonEmpty(hint['sessionId'])
      || hint['projectId'] !== owned.projectId) {
      return { rejection: rejection('invalid', 'sessionHint is not a complete SessionRef of the bound project') };
    }
    sessionHint = { projectId: hint['projectId'], sessionId: hint['sessionId'] };
  }
  const rawTaskId = raw['taskId'];
  if (rawTaskId !== undefined && !nonEmpty(rawTaskId)) {
    return { rejection: rejection('invalid', 'taskId must be a non-empty string when present') };
  }
  const internalRefs = failedCardRefsFromInternal(internal, owned);
  if ('rejection' in internalRefs) return { rejection: internalRefs.rejection };
  return { goalRef: goalRef as unknown as GoalRef, flowId, sessionHint, actor: owned.actor,
    taskId: rawTaskId === undefined ? null : rawTaskId, failedCardRefs: internalRefs.failedCardRefs,
    releaseSkip: new Set<string>(internal?.releaseSkip ?? []) };
}

/**
 * R5b.4 §11.5 the narrow initial-planning input binding. It shares advanceWork's
 * trusted Host isolation and fixes the ORIGINAL flow/session/Goal identity; it
 * grants nothing and `executeWithinRequest` is never an authorization bypass.
 */
function initialPlanningBase(
  input: InitialPlanningGoalInput,
  owned: Owned,
): Base & { executeWithinRequest: boolean } | { rejection: CoreRejection } {
  const raw = input as unknown as Record<string, unknown>;
  if (raw['schemaVersion'] !== 1) return { rejection: rejection('invalid', 'handleGoalInput requires schemaVersion 1') };
  const goalRef = raw['goalRef'];
  if (!isRecord(goalRef) || goalRef['aggregateType'] !== 'Goal'
    || !nonEmpty(goalRef['projectId']) || !nonEmpty(goalRef['goalId'])) {
    return { rejection: rejection('invalid', 'handleGoalInput requires a complete GoalRef') };
  }
  if (goalRef['projectId'] !== owned.projectId) {
    return { rejection: rejection('forbidden', 'the Goal is outside the bound project scope') };
  }
  const flowId = raw['flowId'];
  if (!nonEmpty(flowId)) return { rejection: rejection('invalid', 'handleGoalInput requires a flowId') };
  const hint = raw['sessionHint'];
  let sessionHint: SessionRef | null = null;
  if (hint !== null && hint !== undefined) {
    if (!isRecord(hint) || !nonEmpty(hint['projectId']) || !nonEmpty(hint['sessionId'])
      || hint['projectId'] !== owned.projectId) {
      return { rejection: rejection('invalid', 'sessionHint is not a complete SessionRef of the bound project') };
    }
    sessionHint = { projectId: hint['projectId'], sessionId: hint['sessionId'] };
  }
  if (typeof raw['executeWithinRequest'] !== 'boolean') {
    return { rejection: rejection('invalid', 'handleGoalInput requires an executeWithinRequest boolean') };
  }
  return { goalRef: goalRef as unknown as GoalRef, flowId, sessionHint, actor: owned.actor,
    taskId: null, failedCardRefs: [], releaseSkip: new Set(), executeWithinRequest: raw['executeWithinRequest'] };
}

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

export function createWorkflow(deps: WorkflowDependencies & {
  sessionHandoff?: HandoffWorkflowDependencies;
}): WorkflowPort
  & Required<Pick<WorkflowPort, 'consumeConsultation' | 'resolveDecision' | 'orderGoalAdvances'
    | 'handleIntervention' | 'readDeliveryEligibilityFacts'>> {
  /**
   * R5b.4 §11.5 finite first-consumer handoff. Each call delegates exactly ONE
   * original owner (`proposeInitialPlanFromAnswer` or `applyPlanChange`) and
   * returns that owner's untouched receipt. A real candidate forms the complete
   * `adopt_initial_plan` continuation with the original flow identity; a real
   * adoption hands off to the existing `advanceWork.select_work` and never
   * starts a second control loop. `needs_decision`/waiting never fake success;
   * an unknown input kind stays explicitly unsupported.
   */
  const handleGoalInput = async (
    ctx: CoreCallContext, input: InitialPlanningGoalInput,
  ): Promise<InitialPlanningGoalInputResult> => {
    const kind = isRecord(input) ? (input as { kind?: unknown }).kind : undefined;
    if (kind !== 'planning_answer' && kind !== 'adopt_initial_plan') {
      return { status: 'rejected', code: 'unsupported',
        reason: 'the Workflow goal input kind is not supported' };
    }
    let isolated: InitialPlanningGoalInput;
    try { isolated = structuredClone(input as InitialPlanningGoalInput); }
    catch { return rejection('invalid', 'the initial-planning input cannot be isolated from the caller'); }
    const owned = ownContext(ctx);
    if ('rejection' in owned) return owned.rejection;
    const base = initialPlanningBase(isolated, owned);
    if ('rejection' in base) return base.rejection;

    if (isolated.kind === 'planning_answer') {
      const propose = deps.plans.proposeInitialPlanFromAnswer;
      if (propose === undefined) {
        return rejection('unsupported', 'the Plan owner does not publish proposeInitialPlanFromAnswer');
      }
      const receipt = await propose.call(deps.plans, owned.ctx, isolated.request);
      if (receipt.status === 'committed') {
        const candidate = receipt.value;
        if (candidate.kind !== 'candidate_v2' || !sameCanonical(candidate.goalRef, base.goalRef)) {
          return rejection('forbidden', 'the proposed candidate is not the requested Goal');
        }
        if (!base.executeWithinRequest) {
          return { status: 'ready', value: { state: 'proposed', receipt, next: null } };
        }
        const adoptInput = { proposalRef: candidate.ref,
          expectedProposalRevision: candidate.revision, decisionRefs: [] };
        const requestId = requestIdFor(base, 'adopt_initial_plan', {
          input: adoptInput, meta: { expected: [] } });
        const continuation: InitialPlanningGoalInput = {
          schemaVersion: 1, goalRef: base.goalRef, flowId: base.flowId, sessionHint: base.sessionHint,
          executeWithinRequest: true, kind: 'adopt_initial_plan',
          request: { meta: { requestId, expected: [] }, input: adoptInput },
        };
        return { status: 'ready', value: { state: 'proposed', receipt,
          next: { kind: 'goal_input', input: continuation } } };
      }
      if (receipt.status === 'needs_decision') {
        return { status: 'ready', value: { state: 'needs_decision', receipt, next: null } };
      }
      return { status: 'ready', value: { state: 'waiting', receipt, next: null } };
    }

    const receipt = await deps.plans.applyPlanChange(owned.ctx, isolated.request);
    if (receipt.status !== 'committed') {
      return { status: 'ready', value: { state: 'waiting', receipt, next: null } };
    }
    if (!sameCanonical(receipt.value.goalRef, base.goalRef)) {
      return rejection('forbidden', 'the adopted Plan is not the requested Goal');
    }
    if (!base.executeWithinRequest) {
      return { status: 'ready', value: { state: 'advance', receipt, next: null } };
    }
    const workInput: WorkflowAdvanceInput = {
      schemaVersion: 1, goalRef: base.goalRef, flowId: base.flowId, sessionHint: base.sessionHint,
      kind: 'select_work',
    };
    return { status: 'ready', value: { state: 'advance', receipt, next: { kind: 'work', input: workInput } } };
  };

  function bindingForRole(
    config: WorkflowHostConfiguration, projectId: string, workspaceId: string, role: string,
  ): Binding | null {
    return servingBinding(config.bindings, projectId, workspaceId, role);
  }

  async function loadWorkspacePin(
    owned: Owned, ref: WorkspaceRef,
  ): Promise<{ pin: VersionPin } | { rejection: CoreRejection }> {
    let loaded;
    try { loaded = await deps.sourceAuthority.load(ref); }
    catch { return { rejection: rejection('unavailable', 'the Goal workspace source read failed') }; }
    if (loaded.status === 'found' && loaded.snapshot.ref.aggregateType === 'Workspace') {
      return { pin: { ref, revision: loaded.snapshot.revision } };
    }
    if (loaded.status === 'not_found') {
      return { rejection: rejection('incomplete', 'the Goal workspace record does not exist') };
    }
    return { rejection: rejection('unavailable', 'the Goal workspace record is not readable') };
  }

  type SessionChoice =
    | { kind: 'reuse'; card: SessionCard }
    | { kind: 'create' }
    | { kind: 'waiting'; reason: string }
    | { kind: 'rejection'; rejection: CoreRejection };

  /**
   * Rule 7: a readonly copy, an archive-requested or a waiting Session is never
   * chosen for NEW work or Query claims. The original yielded-wait continuation
   * claim does not pass through here and keeps its legitimate reuse.
   */
  async function chooseExcluded(owned: Owned, card: SessionCard): Promise<boolean> {
    const record = card.record;
    if (record.provenance?.kind === 'readonly_copy') return true;
    if (record.archiveRequest !== null && record.archiveRequest !== undefined) return true;
    if (deps.sessionFacts !== undefined) {
      const facts = await deps.sessionFacts.readSessionFacts(owned.ctx, {
        projectId: record.ref.projectId, sessionId: record.ref.sessionId,
      });
      if (facts.status === 'ready' && facts.value.wait !== null) return true;
    }
    return false;
  }

  /**
   * E16 (§4.1 S:799): a Task transferred to a chosen Session carries an OPEN
   * responsible link on that Session, and its next pickup is claimed there
   * first (before the hint and the directory order). Ordinary drops leave no
   * open link, so the existing `chooseSession` order stays. The lookup is only
   * attempted when the responsibility owner is installed; an unreadable target
   * page falls through to the existing selection instead of failing it.
   */
  async function responsibleSessionFor(
    owned: Owned, goal: GoalSnapshot, binding: Binding, task: TaskTriple,
  ): Promise<SessionCard | null> {
    if (deps.responsibilities === undefined) return null;
    if (deps.sessions.findSessions === undefined) return null;
    const workspaceId = goal.workspaceRef.workspaceId;
    const target = { kind: 'task' as const, ref: task };
    let cursor: string | null = null;
    for (let page = 0; page < 8; page += 1) {
      const found = await deps.sessions.findSessions(owned.ctx, {
        workspace: { projectId: owned.projectId, workspaceId },
        target,
        includeArchived: false,
        page: cursor === null ? { limit: 50 } : { limit: 50, cursor },
      });
      if (found.status !== 'ready') return null;
      for (const card of found.value.items) {
        if (!roleReusable(card, workspaceId, binding)) continue;
        const openResponsible = card.links.some((link) => link.ref.relation === 'responsible'
          && link.until === null && sameCanonical(link.ref.target, target));
        if (!openResponsible) continue;
        if (await chooseExcluded(owned, card)) continue;
        return card;
      }
      if (found.value.nextCursor === null) break;
      cursor = found.value.nextCursor;
    }
    return null;
  }

  /**
   * K slice L7: has this line already started its fallback? A continuation
   * Session whose provenance names this Session and this exact Task means the
   * `create_session{requeue}` fallback (or an earlier handover) already exists,
   * so the Workflow replays that route instead of closing the Turn.
   */
  async function hasContinuationForTask(owned: Owned, sessionRef: SessionRef, task: TaskTriple): Promise<boolean> {
    const facts = deps.sessionFacts;
    if (facts?.findSessionSuccessors === undefined) return false;
    try {
      const page = await facts.findSessionSuccessors(owned.ctx, { sessionRef, page: { limit: 50 } });
      if (page.status !== 'ready') return false;
      return page.value.items.some((record) => record.provenance?.kind === 'continuation'
        && sameCanonical(record.provenance.task, task));
    } catch { return false; }
  }

  /**
   * E15 / §4.1 S:799 (T10): a replacement Session created to continue a Task a
   * LIVE Session already held is a `continuation` (C3 interruption, kernel
   * turn open or role mismatch). A predecessor that is already archived, of
   * another scope or absent is the archive-origin ordinary pickup and stays
   * `new`; a Task is never unconditionally continued just because it ran once.
   */
  function continuationProvenanceFor(
    claimSession: ReadResult<SessionCard>, workspaceId: string, binding: Binding, task: TaskTriple,
  ): SessionProvenanceV1 | null {
    if (claimSession.status !== 'ready') return null;
    const record = claimSession.value.record;
    if (record.lifecycle !== 'active' || record.workspaceId !== workspaceId) return null;
    // T10: a predecessor with a durable archive request is an archive-origin
    // pickup, never an ordinary continuation (even before it is finally archived).
    if (record.archiveRequest !== null && record.archiveRequest !== undefined) return null;
    const reason: 'interrupted' | 'damaged' | 'role_mismatch' =
      !sameCanonical(record.role, binding.sessionRole) ? 'role_mismatch'
        : record.health === 'unavailable'
          && (record.healthConclusion === 'missing' || record.healthConclusion === 'damaged') ? 'damaged'
          : 'interrupted';
    return {
      schemaVersion: 1, kind: 'continuation',
      from: { projectId: record.ref.projectId, sessionId: record.ref.sessionId },
      reason, task: { ...task },
    };
  }

  async function chooseSession(
    owned: Owned, goal: GoalSnapshot, binding: Binding, sessionHint: SessionRef | null, task: TaskTriple | null,
  ): Promise<SessionChoice> {
    const workspaceId = goal.workspaceRef.workspaceId;
    if (task !== null) {
      const transferred = await responsibleSessionFor(owned, goal, binding, task);
      if (transferred !== null) return { kind: 'reuse', card: transferred };
    }
    if (sessionHint !== null) {
      const read = await deps.sessions.readSession(owned.ctx, sessionHint);
      if (read.status === 'ready') {
        const card = read.value;
        if (roleReusable(card, workspaceId, binding) && !await chooseExcluded(owned, card)) {
          return { kind: 'reuse', card };
        }
        if (card.record.workspaceId === workspaceId && card.record.occupancy !== null) {
          return { kind: 'waiting', reason: `the continued Session is busy with a ${card.record.occupancy.kind}` };
        }
      } else if (read.status === 'rejected' && (read.code === 'cancelled' || read.code === 'forbidden')) {
        return { kind: 'rejection', rejection: read };
      }
    }
    let cursor: string | null = null;
    for (let page = 0; page < 8; page += 1) {
      const found = await deps.sessions.findSessions(owned.ctx, {
        workspace: { projectId: owned.projectId, workspaceId },
        role: binding.sessionRole,
        includeArchived: false,
        page: cursor === null ? { limit: 50 } : { limit: 50, cursor },
      });
      if (found.status !== 'ready') {
        if (found.status === 'rejected' && (found.code === 'cancelled' || found.code === 'forbidden')) {
          return { kind: 'rejection', rejection: found };
        }
        return { kind: 'waiting', reason: 'the Session directory is not readable' };
      }
      for (const card of found.value.items) {
        if (roleReusable(card, workspaceId, binding) && !await chooseExcluded(owned, card)) {
          return { kind: 'reuse', card };
        }
      }
      if (found.value.nextCursor === null) break;
      cursor = found.value.nextCursor;
    }
    return { kind: 'create' };
  }

  async function buildClaimOperation(
    owned: Owned, base: Base, goal: GoalSnapshot, planRef: PlanRevisionRef,
    task: RuntimeTask, binding: Binding, sessionId: string, sessionRevision: number,
    reusedSession: boolean, consumedWait?: ConsumedWaitV1, requeue?: WorkflowSessionRequeue,
    review?: WorkflowSessionReview,
  ): Promise<{ operation: Extract<WorkflowOperation, { kind: 'claim_task' }> } | { rejection: CoreRejection }> {
    const workspacePin = await loadWorkspacePin(owned, goal.workspaceRef);
    if ('rejection' in workspacePin) return workspacePin;
    const sessionRef: SessionRef = { projectId: owned.projectId, sessionId };
    const expected: VersionPin[] = [
      { ref: base.goalRef, revision: goal.revision },
      workspacePin.pin,
      { ref: sessionAggregateRef(owned.projectId, sessionId), revision: sessionRevision },
    ];
    const input: ClaimTaskInput = {
      goalRef: base.goalRef, planRef, taskId: task.taskId, sessionRef,
      // TASK-03: a requeue that pins a budget is claimed with exactly that budget (§4.3: `budget ?? binding.budget`).
      roleBinding: binding.roleBinding, budget: review?.budget ?? requeue?.budget ?? binding.budget,
      ...(consumedWait === undefined ? {} : { consumedWait }),
      // TASK-03 (D-3): a requeued Task is claimed only with the TaskRequeue covering its selected Run.
      ...(requeue === undefined ? {} : { requeueRef: requeue.requeueRef }),
      // K3 TASK-03r (L10): a review claim names the record, its read revision and the phase; the owner
      // derives `afterRunRef` = the last holder and writes UCR-03 in the same commit.
      ...(review === undefined ? {} : { review: { reviewRef: review.reviewRef,
        expectedRevision: review.expectedRevision, phase: review.phase } }),
      // 2C item 10 (lead ruling): a claim in a REUSED Session also opens the
      // claimed Task's responsible link in the same commit (the create path
      // already wrote its `initialLinks`; the claim checks for an open link).
      ...(reusedSession ? { openResponsibleLink: true } : {}),
    };
    return { operation: { kind: 'claim_task', request: graphWrite(base, 'claim_task', input, expected) } };
  }

  async function claimIntervention(owned: Owned, base: Base, goal: GoalSnapshot, plan: PlanRevisionSnapshot,
    task: RuntimeTask, row: TaskRow, session: SessionCard, messageRef: SessionMessageRef):
  Promise<{ claim: TaskClaim } | CoreRejection> {
    const config = deps.configuration;
    if (config === undefined) return rejection('unsupported', 'no trusted Workflow configuration is registered for the intervention claim');
    const assignment = revisionAssignments(plan).find((candidate) => candidate.taskId === task.taskId);
    if (assignment === undefined) return rejection('invalid', `the intervention Task ${task.taskId} has no role assignment`);
    const binding = bindingForRole(config, owned.projectId, goal.workspaceRef.workspaceId, assignment.role);
    if (binding === null) return rejection('unsupported', `no trusted Workflow binding matches workspace ${goal.workspaceRef.workspaceId} and role ${assignment.role}`);
    const built = await buildClaimOperation(owned, base, goal, plan.ref, task, binding,
      session.record.ref.sessionId, session.record.revision, true, { kind: 'intervention', messageRef });
    if ('rejection' in built) return built.rejection;
    const result = await deps.claims.claimTask(owned.ctx, { ...built.operation.request,
      meta: { ...built.operation.request.meta,
        requestId: `intervention:${sessionMessageRefKey(messageRef)}:claim` } });
    if (result.status !== 'committed') return rejection(result.code, result.reason);
    return { claim: result.value };
  }

  /** Read the exact prior yielded Run continuation and its saved reply ref. */
  async function readContinuation(
    owned: Owned, priorRunRef: RunRef,
  ): Promise<{ value: ConsumedWaitV1; sessionRef: SessionRef } | { waiting: string } | { rejection: CoreRejection }> {
    const priorRead = await deps.executions.readExecution(owned.ctx, priorRunRef);
    if (priorRead.status !== 'ready') return { waiting: receiptReason(priorRead, 'the prior yielded Run is not readable') };
    const continuation = priorRead.value.run.continuation;
    if (priorRead.value.run.outcome !== 'yielded' || continuation === undefined) return { waiting: 'the prior Run has no durable yielded continuation binding' };
    if (priorRead.value.run.controlState?.desiredState === 'paused' || priorRead.value.run.controlState?.desiredState === 'cancelled') {
      return { waiting: 'the prior yielded execution is paused or cancelled' };
    }
    if (deps.consultations === undefined) return { waiting: 'the continuation wait requires the consultation mailbox' };
    const messages = deps.consultations.messages;
    const rootRead = await messages.readMessage(owned.ctx, continuation.messageRef);
    if (rootRead.status !== 'ready') return { waiting: receiptReason(rootRead, 'the continuation wait message is not readable') };
    const chain = await liveWaitMessage((ref) => messages.readMessage(owned.ctx, ref), rootRead.value);
    if (chain.status !== 'ready') return { waiting: receiptReason(chain, 'the continuation wait message is not readable') };
    const message = chain.tail;
    // The saved reply wins over an expired deadline (one state rule, message-machine.ts:1138).
    if (message.status === 'responded' && message.response !== null) {
      return { sessionRef: structuredClone(continuation.sessionRef), value: {
        kind: 'wait_reply', originalRun: priorRunRef, messageRef: continuation.messageRef,
        responseRef: structuredClone(message.response.bodyRef) } };
    }
    if (message.expiredAt !== null) {
      return { sessionRef: structuredClone(continuation.sessionRef), value: {
        kind: 'expiry', originalRun: priorRunRef, messageRef: continuation.messageRef,
        expiryInputId: deriveSessionInputId(continuation.messageRef, 'expiry') } };
    }
    return { waiting: 'the continuation wait has not been answered yet' };
  }

  /**
   * The ONE recoverable unadmitted execution. A formal READY `readExecution`
   * that is still a bare `starting` claim - no authorization, envelope, input
   * binding, entry or runtime fact and no pause/cancel intent - is exactly the
   * Run whose very first prepare was refused. An unreadable read or ANY other
   * execution state is never inferred to be unentered and never restarted.
   */
  async function isUnadmittedStarting(owned: Owned, runRef: RunRef): Promise<boolean> {
    const read = await deps.executions.readExecution(owned.ctx, runRef).catch(() => null);
    if (read === null || read.status !== 'ready') return false;
    const run = read.value.run;
    if (!sameCanonical(run.ref, runRef)) return false;
    if (run.status !== 'starting') return false;
    if (run.executionHistory !== undefined) return false;
    if (run.startedAt !== null) return false;
    if (run.lastEventSeq !== 0 || run.lastRuntimeEventId !== '' || run.lastFactEventId !== '') return false;
    const desired = run.controlState?.desiredState;
    if (desired === 'paused' || desired === 'cancelled') return false;
    const auth = run.executionAuthorization;
    if (auth === undefined) return run.envelope === null && run.inputBinding === undefined;
    // W-02 / W-03 (A.2 step 5.6, §12.2): an authorized binding that never began, or one revoked by a
    // proven non-entry (RUN-16), is re-driven with the SAME claim: `prepare` only rehydrates the bound
    // input (I-19) and the start re-authorizes a revoked binding (RUN-03). Every other phase entered or
    // may have entered the Kernel and is never restarted.
    return (auth.phase === 'authorized' || auth.phase === 'revoked')
      && run.envelope !== null && run.inputBinding !== undefined;
  }

  /**
   * The chain head of one subject (VD-14): a work Run's chain through the
   * plan-independent `queryOriginalVerification` (no `planRef`, VD-7), or with
   * `subjectRunRef: null` a gate's chain through `queryRoundChainHead`
   * (VD-15). A missing optional port, a throw or any unknown read is a
   * `waiting` reason, never "no round", so an unknown window can never be
   * bypassed with a second round.
   */
  async function readChainHead(
    owned: Owned, subject: TaskTriple, subjectRunRef: RunRef | null,
  ): Promise<{ read: ReadResult<RoundSnapshot> } | { waiting: string }> {
    const workQuery = deps.evidence.queryOriginalVerification;
    const gateQuery = deps.evidence.queryRoundChainHead;
    try {
      if (subjectRunRef !== null) {
        if (workQuery === undefined) return { waiting: 'the verification round chain is not readable: the chain-head read is not published' };
        return { read: await workQuery(owned.ctx, { subjectRunRef, subject }) };
      }
      if (gateQuery === undefined) return { waiting: 'the gate round chain is not readable: the chain-head read is not published' };
      return { read: await gateQuery(owned.ctx, { subject, subjectRunRef: null }) };
    } catch {
      return { waiting: 'the verification round chain read failed; no new round is opened' };
    }
  }

  /**
   * Continue one subject's round chain from its head (§9.3, VD-7, VD-14): an
   * `open` head follows `nextAfterRound` (an open head with only interrupted
   * checks finalizes, the `needsFinalize` of FC-13 and GV-3); a finalized clean
   * PASS completes the Task under the Goal's current adopted Plan; a finalized
   * non-PASS head waits. The selection acts on the automation verdict before it
   * gets here: a work Task whose facts read such a head either performs its
   * rework or is skipped (whatever its verdict, with or without
   * `reverifyRound`), and a gate's `reverify` performs `reverify_round` while
   * its `stopped` waits with the stop reason. So that wait is only met by a
   * gate whose evidence owner publishes no `reverifyRound`, or when the chain
   * read and the facts disagree (the head moved between the two reads). `null`
   * means the subject has no chain yet.
   */
  async function continueRoundChain(
    owned: Owned, base: Base, waitBasis: GoalWaitBasisV1, read: ReadResult<RoundSnapshot>,
  ): Promise<WorkflowAdvanceResult | null> {
    if (read.status === 'not_found') return null;
    if (read.status !== 'ready') {
      return waiting(null, receiptReason(read, 'the verification round chain is not readable'), undefined, waitBasis);
    }
    const round = read.value;
    if (round.status === 'finalized') {
      if (round.outcome !== 'PASS' || round.gaps.length > 0) {
        return waiting(null,
          `the verification round chain head finalized ${round.outcome ?? 'INCONCLUSIVE'} with ${round.gaps.length} gap(s); not re-verifying`,
          undefined, waitBasis);
      }
      const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
      if (goalRead.status !== 'ready') {
        return waiting(null, receiptReason(goalRead, 'the Goal could not be read for the Task completion'),
          undefined, waitBasis);
      }
      const goal = goalRead.value.goal;
      if (goal.activePlanRevision === null) {
        return waiting(null, 'the Goal has no adopted Plan; the Task is not completed', undefined, waitBasis);
      }
      return advancing(null, makePerform(base, completeTaskStep(base, goal, goal.activePlanRevision, round)));
    }
    const next = nextAfterRound(base, round);
    if (next === null) {
      return waiting(null, 'the verification round chain head has an executing check; not advancing', undefined, waitBasis);
    }
    return advancing(null, next);
  }

  /**
   * Resume the round chain of a formally completed/ended Run before any new
   * claim/open (VD-14): its head continues (`continueRoundChain`); only an
   * explicit `not_found` opens the checks exactly once, under the Goal's current
   * adopted Plan (`planRef`, VD-7).
   */
  async function resumeRoundChain(owned: Owned, base: Base, waitBasis: GoalWaitBasisV1, run: RunSnapshot,
    planRef: PlanRevisionRef): Promise<WorkflowAdvanceResult> {
    const head = await readChainHead(owned, { ...run.task }, run.ref);
    if ('waiting' in head) return waiting(null, head.waiting, undefined, waitBasis);
    const continued = await continueRoundChain(owned, base, waitBasis, head.read);
    return continued ?? advancing(null, makePerform(base, openWorkChecksStep(base, run, planRef)));
  }

  /**
   * VD-15: a gate has one chain, anchored on the producer Run its root opened
   * on. With a chain the gate only follows its head and never re-selects a
   * producer; without one the root opens on the first satisfied work Run with
   * an execution, under the Goal's current adopted Plan (VD-7).
   *
   * C5 (§4 GV table, §15.2 5.9): the gate's verdict comes first. `reverify`
   * on a finalized head performs `reverify_round` (GV-9 with
   * `onlyIfSourceChanged`, GV-10 without; GV-3's open head is finalized by the
   * chain below first); `stopped` on a finalized non-PASS head waits with the
   * stop reason as the code and what a person can do about it
   * (`gateStopAdvice`; the Goal shows the same reason, GOAL-30).
   */
  async function advanceGate(
    owned: Owned, base: Base, waitBasis: GoalWaitBasisV1, graph: TaskGraph, gateTask: RuntimeTask,
  ): Promise<WorkflowAdvanceResult> {
    const gate: TaskTriple = { projectId: owned.projectId, goalId: base.goalRef.goalId, taskId: gateTask.taskId };
    const row = graph.tasks.find((candidate) => candidate.ref.taskId === gateTask.taskId);
    const failure = row?.failure;
    if (row !== undefined && failure !== undefined) {
      const verdict = failure.automation.verdict;
      if (verdict.kind === 'reverify' && !verdict.needsFinalize && deps.evidence.reverifyRound !== undefined) {
        const step = reverifyRoundStep(base, gate, failure, verdict);
        if (step !== null) return advancing(null, makePerform(base, step));
      }
      if (verdict.kind === 'stopped' && headFinalizedNonPass(row)) {
        return waiting(null, `${verdict.reason}: the goal gate ${gateTask.taskId} is not re-verified automatically; `
          + gateStopAdvice(verdict.reason), undefined, waitBasis);
      }
    }
    const head = await readChainHead(owned, gate, null);
    if ('waiting' in head) return waiting(null, head.waiting, undefined, waitBasis);
    const continued = await continueRoundChain(owned, base, waitBasis, head.read);
    if (continued !== null) return continued;
    const producer = graph.tasks.find((row) => row.definition.taskKind === 'work'
      && row.effectivePhase === 'satisfied' && row.execution !== null);
    if (producer === undefined || producer.execution === null) {
      return waiting(null, `the goal gate ${gateTask.taskId} has no ended ordinary producer Run yet`, undefined, waitBasis);
    }
    return advancing(null, makePerform(base,
      openGateChecksStep(base, graph.plan.ref, gate, producer.execution, gateTask.scope.kind)));
  }

  /**
   * TASK-03 / W-21 (D-3, §4.3 "claim_requeued", §8 8.3): a requeued Task
   * (P4) is claimed with the TaskRequeue covering its selected Run, preferably
   * in that Run's claim Session: reusable → claim there; busy → skip the Task
   * this round (`null`); archived, of another role, `not_found`, or
   * unavailable because it is `missing`/`damaged` → the default selection
   * without a hint, and a new Session claims with the requeue too. A
   * cancelled or forbidden read is that rejection; any other state of the
   * claim Session (a failed read, `recoverable`) waits rather than moving the
   * continuation off its history. The claim carries the budget the requeue
   * pins (`TaskRow.requeueBudget`), else the binding's. A claim Session whose
   * Kernel Turn is still open (`kernel_turn_open`) gets a new Session through
   * `create_session{requeue}` (LA-1, A.2 step 5.6).
   */
  async function claimContinuation(
    owned: Owned, base: Base, goal: GoalSnapshot, planRef: PlanRevisionRef, task: RuntimeTask, row: TaskRow,
    binding: Binding, afterRunRef: RunRef,
    continuation: { requeue?: WorkflowSessionRequeue; review?: WorkflowSessionReview },
  ): Promise<WorkflowAdvanceResult | null> {
    const requeue = continuation.requeue;
    const review = continuation.review;
    const afterRun = await deps.executions.readExecution(owned.ctx, afterRunRef);
    if (afterRun.status !== 'ready') return waiting(null, receiptReason(afterRun, 'the afterRun is not readable'));
    const workspaceId = goal.workspaceRef.workspaceId;
    const claimSession = await deps.sessions.readSession(owned.ctx, afterRun.value.outbox.claim.sessionRef);
    // E16 (§4.1 S:799, rule 7): the continuation of a requeued Task follows the
    // same destination-first order as `chooseSession` — an open responsible link
    // of a transfer destination wins — and a source that is excluded (an archive
    // request, a wait, a readonly copy) is never retried; it goes through the
    // ordinary selection instead.
    const transferred = await responsibleSessionFor(owned, goal, binding, row.ref);
    const taskRef: TaskTriple = row.ref;
    let chosen: SessionChoice;
    if (transferred !== null) {
      chosen = { kind: 'reuse', card: transferred };
    } else if (claimSession.status === 'ready') {
      const card = claimSession.value;
      const record = card.record;
      const excluded = await chooseExcluded(owned, card);
      if (roleReusable(card, workspaceId, binding) && !excluded) {
        chosen = { kind: 'reuse', card };
      } else if (excluded || record.lifecycle === 'archived' || record.workspaceId !== workspaceId
        || !sameCanonical(record.role, binding.sessionRole)
        || (record.health === 'unavailable' && (record.healthConclusion === 'missing' || record.healthConclusion === 'damaged'))) {
        chosen = await chooseSession(owned, goal, binding, null, row.ref);
      } else if (record.occupancy === null && record.health === 'unavailable' && record.healthConclusion === 'kernel_turn_open') {
        // K (L7, KA2/KA3, M1/M2): the Kernel refuses a new Turn in a Session whose last Turn has no Kernel
        // terminal. With the Runtime's closure installed and no fallback already started for this Task, the
        // Workflow first closes the dangling Turn (the Runtime answers `unsupported` when the Kernel cannot
        // close, and the definite-failure fallback below then applies); otherwise today's route stands: a NEW
        // linked Session (never another Task's), seeded by `prepare` from the TaskRequeue history source.
        // K3 L12: a review continuation closes with `afterRunRef = lastHolderOf(record)` and `requeueRef: null`.
        const claimSessionRef: SessionRef = { projectId: record.ref.projectId, sessionId: record.ref.sessionId };
        if (turnClosureOf(deps.runtime) === undefined || await hasContinuationForTask(owned, claimSessionRef, taskRef)) {
          chosen = { kind: 'create' };
        } else {
          return advancing(null, makePerform(base, closeOpenTurnStep(
            claimSessionRef, afterRunRef, requeue?.requeueRef ?? null, taskRef, planRef, continuation)));
        }
      } else if (record.occupancy !== null) {
        return null;
      } else {
        return waiting(null, `the afterRun claim Session is ${record.health}`
          + `${record.healthConclusion === undefined || record.healthConclusion === null ? '' : ` (${record.healthConclusion})`}`);
      }
    } else if (claimSession.status === 'not_found') {
      chosen = await chooseSession(owned, goal, binding, null, row.ref);
    } else if (claimSession.status === 'rejected' && (claimSession.code === 'cancelled' || claimSession.code === 'forbidden')) {
      return claimSession;
    } else {
      return waiting(null, receiptReason(claimSession, 'the afterRun claim Session is not readable'));
    }
    if (chosen.kind === 'rejection') return chosen.rejection;
    if (chosen.kind === 'waiting') return waiting(null, chosen.reason);
    if (chosen.kind === 'create') {
      const provenance = continuationProvenanceFor(claimSession, workspaceId, binding, taskRef);
      return advancing(null, makePerform(base, createSessionStep(base, {
        workspace: { projectId: owned.projectId, workspaceId },
        role: binding.sessionRole, recommendedRefs: [],
        initialLinks: [{ target: { kind: 'task', ref: taskRef }, relation: 'responsible' }],
        ...(provenance === null ? {} : { provenance }),
      }, taskRef, planRef, requeue, review)));
    }
    // E15 (W1-HO-04, §4.4.7, L17): a reused Session that continues exactly this
    // Task from a predecessor still open and unarchived re-derives the same
    // handover step from durable facts BEFORE the claim pin is computed. The
    // crash between `create_session` and its handover therefore recovers here,
    // and the (live, idle) predecessor can still be archived in one composition.
    const recovered = await recoveryHandoverStep(owned, base, chosen.card, taskRef, planRef, requeue, review);
    if (recovered !== null) return advancing(null, makePerform(base, recovered));
    const sessionRef: SessionRef = { projectId: owned.projectId, sessionId: chosen.card.record.ref.sessionId };
    const built = await buildClaimOperation(owned, base, goal, planRef, task, binding,
      sessionRef.sessionId, chosen.card.record.revision, true, undefined, requeue, review);
    if ('rejection' in built) return built.rejection;
    return advancing(null, makePerform({ ...base, sessionHint: sessionRef }, built.operation));
  }

  /** K3 L12: the record's most recent holder for the continuation Session start. */
  async function continuationHolder(owned: Owned, runRef: RunRef): Promise<RunRef> {
    const port = deps.unknownCallReviews;
    if (port === undefined) return runRef;
    try {
      const read = await port.readReview(owned.ctx, { runRef });
      if (read.status !== 'ready') return runRef;
      return lastHolderOf(read.value);
    } catch { return runRef; }
  }

  const { reviewGate, automaticRequeue, automaticReverify, automationConfirmation, gatePerform } = createTaskGate({
    workflow: deps, bindingForRole, isUnadmittedStarting, claimContinuation,
  });

  /** The delivery predicate's `taskBlocked`: the automation card this Task would derive now. The L46 block
   *  read replaces this source later, on the same field (book `:296–:299`). A failed read is `null`, never false. */
  async function automationBlockedFor(owned: Owned, base: Base, taskRef: TaskTriple): Promise<boolean | null> {
    const config = deps.configuration;
    if (config === undefined) return null;
    const goal = await deps.plans.queryGoal(owned.ctx, { aggregateType: 'Goal', projectId: taskRef.projectId, goalId: taskRef.goalId });
    if (goal.status !== 'ready') return null;
    const graph = await deps.plans.queryTaskGraph(owned.ctx, { goalRef: goal.value.goal.ref });
    if (graph.status !== 'ready') return null;
    const task = graph.value.plan.tasks.find((candidate) => candidate.taskId === taskRef.taskId);
    const row = graph.value.tasks.find((candidate) => candidate.ref.taskId === taskRef.taskId);
    if (task === undefined || row === undefined) return null;
    const rework = automaticRequeue(config, owned, base, goal.value.goal, graph.value.plan, task, row)
      ?? automaticReverify(base, row);
    if (rework === null) return false;
    return (await automationConfirmation(base, goal.value.goal, row, rework)) !== null;
  }

  /** The ONE delivery-fact builder (A-34): the message's consumption, Goal, Task block and recipient outcome. */
  async function deliveryFacts(owned: Owned, message: SessionMessage, part: 'message' | 'response',
    goalRef: GoalRef | null, target: SessionRef | null): Promise<DeliveryFactsV1 | CoreRejection> {
    const goalRead = goalRef === null ? null : await deps.plans.queryGoal(owned.ctx, goalRef);
    if (goalRead !== null && goalRead.status !== 'ready') return asRejection(goalRead, 'the message Goal');
    const goal = goalRead === null ? null : goalRead.value.goal.desiredState;
    let taskBlocked = false;
    const taskRef = message.taskRef;
    if (taskRef !== null) {
      const blocked = await automationBlockedFor(owned, {
        goalRef: { aggregateType: 'Goal', projectId: taskRef.projectId, goalId: taskRef.goalId },
        flowId: '', sessionHint: null, actor: owned.actor, taskId: taskRef.taskId,
        failedCardRefs: [], releaseSkip: new Set<string>(),
      }, taskRef);
      if (blocked === null) {
        return rejection('unavailable', 'the automatic confirmation facts of the message Task are not readable');
      }
      taskBlocked = blocked;
    }
    let recipientOutcomeUnknown = false;
    if (!('kind' in message.recipient)) {
      const card = await deps.sessions.readSession(owned.ctx, message.recipient);
      if (card.status !== 'ready') return asRejection(card, 'the message recipient');
      const prior = card.value.record.lastExecutionRef;
      if (prior !== null && prior !== undefined) {
        if (prior.aggregateType === 'Run') {
          const read = await deps.executions.readExecution(owned.ctx, prior);
          if (read.status !== 'ready') return asRejection(read, 'the recipient last execution');
          recipientOutcomeUnknown = read.value.run.outcome === 'outcome_unknown';
        } else {
          // v2-37: the recipient's last execution may be a real QueryRun; its stage is `executionState.phase`.
          if (deps.consultations === undefined) {
            return rejection('unsupported', 'the recipient QueryRun facts need the Query owner');
          }
          const read = await deps.consultations.queries.readQueryJob(owned.ctx, {
            aggregateType: 'QueryJob', projectId: prior.projectId, workspaceId: prior.workspaceId,
            queryJobId: prior.queryJobId });
          if (read.status !== 'ready') return asRejection(read, 'the recipient QueryRun');
          recipientOutcomeUnknown = read.value.run.run.executionState?.phase === 'unknown';
        }
      }
    }
    const base = { consumption: messageFactsOfRecord(message), goal, taskBlocked, recipientOutcomeUnknown };
    if (part === 'message') {
      const delivered = (message.acceptedInputs ?? []).some((entry) => entry.part === 'message');
      return { ...base, part, delivered };
    }
    if (deps.sessionFacts === undefined) {
      return rejection('unsupported', 'the response delivery facts need the Session facts read');
    }
    const waitRead = await deps.sessionFacts.readWait(owned.ctx, { messageRef: message.ref });
    let wait: DeliveryResponseWaitV1 = { kind: 'none' };
    if (waitRead.status === 'ready') {
      // The one reply rule (book `:343–:346`): the original continuation, or — after a transfer — the effective
      // handler's own execution; an intervention Run never gets the reply. `target` is the response's sender Session.
      const handler = effectiveReplyHandler(message);
      let intervention = false;
      if (message.sender.kind === 'work_run') {
        const sender = await deps.executions.readExecution(owned.ctx, message.sender.runRef);
        if (sender.status !== 'ready') return asRejection(sender, 'the response sender Run');
        intervention = sender.value.run.consumedWait?.kind === 'intervention';
      }
      wait = waitRead.value.state.state === 'consumed' ? { kind: 'consumed' }
        : waitRead.value.state.state === 'withdrawn' ? { kind: 'none' }
        : { kind: 'unconsumed', boundHere: !intervention && target !== null && handler !== null && sameRef(handler, target) };
    } else if (waitRead.status !== 'not_found') {
      return asRejection(waitRead, 'the response wait');
    }
    const accepted = (message.acceptedInputs ?? []).some((entry) => entry.part === 'response');
    return { ...base, part, accepted, wait };
  }

  /** S's `readDeliveryEligibilityFacts`: the three non-message facts from the one builder. */
  async function readDeliveryEligibilityFacts(ctx: CoreCallContext, input: { messageRef: SessionMessageRef }):
  Promise<ReadResult<DeliveryEligibilityFactsV1>> {
    const owned = ownContext(ctx);
    if ('rejection' in owned) return owned.rejection;
    if (deps.consultations === undefined) {
      return rejection('unsupported', 'the delivery facts need the consultation mailbox');
    }
    const read = await deps.consultations.messages.readMessage(owned.ctx, input.messageRef);
    if (read.status !== 'ready') return read;
    const message = read.value;
    if (message.ref.projectId !== owned.projectId || message.ref.workspaceId !== owned.workspaceId) {
      return rejection('forbidden', 'the message is outside the bound project/workspace');
    }
    const facts = await deliveryFacts(owned, message, 'message', message.goalRef, null);
    if ('status' in facts) return facts;
    return { status: 'ready', value: { goal: facts.goal, taskBlocked: facts.taskBlocked,
      recipientOutcomeUnknown: facts.recipientOutcomeUnknown } };
  }

  /**
   * 〔L5〕 Book §3.8 item 3 (`book-7a.md:384–:388`): the first candidate of this Goal that no block reason and no
   * earlier refusal of this pass stops, with its approval identity from the message record itself (`approvalRevision`,
   * never the current revision — `:368–:370`). Read-only: `perform` calls the owner. The pages run until one item is
   * selectable (`:386`, rd7a2a-02); a read failure is the failure, never an empty page (`:551–:552`, rd7a2a-05).
   */
  async function releaseCandidatePerform(owned: Owned, base: Base): Promise<WorkflowAdvanceResult | null> {
    const owner = deps.messageRelease;
    const messages = deps.messages;
    // Book `:383–:384`: without the owner (an old composition) the release step names nothing, and without the
    // message read it has no approval identity (D8-5 (a)).
    if (owner === undefined || messages === undefined) return null;
    for (let after: string | null = null; ;) {
      const page = await owner.readReleaseCandidates(owned.ctx, {
        scope: { projectId: owned.projectId, workspaceId: owned.workspaceId },
        goalRef: base.goalRef, after, limit: RELEASE_CANDIDATE_PAGE_LIMIT,
      });
      // A read failure is the failure (D8-10 (a), `decision-contracts.ts:552`), never "no candidate".
      if (page.status !== 'ready') return readRejection(page);
      for (const candidate of page.value.items) {
        // A blocked item is stepped past and the pass continues (`book-7a.md:386`); the item this pass already
        // refused is stepped past too, so one pass never asks for it twice (`:386–:389`).
        if (candidate.blockedReason !== null) continue;
        if (base.releaseSkip.has(sessionMessageRefKey(candidate.messageRef))) continue;
        const read = await messages.readMessage(owned.ctx, candidate.messageRef);
        if (read.status !== 'ready') return readRejection(read);
        return advancing(null, makePerform(base, {
          kind: 'release_message',
          // D8-5 (a): the approval commit's revision, written by the approval (`message-machine.ts:1309`); the type
          // forces this arm — only an approved message reaches the page (rd7a2a-18, list B 3).
          request: { messageRef: candidate.messageRef, approvalRevision: read.value.approvalRevision! },
        }));
      }
      // A blocked item does not stop the next page (`book-7a.md:386–:387`, rd7a2a-02); nothing selectable on any page
      // is the ordinary selection's answer.
      if (page.value.nextCursor === null) return null;
      after = page.value.nextCursor;
    }
  }

  /** Read-only deterministic first-step selection shared by `select_work`. */
  async function selectNext(owned: Owned, base: Base): Promise<WorkflowAdvanceResult> {
    const config = deps.configuration;
    if (config === undefined) return rejection('unsupported', 'no trusted Workflow configuration is registered');
    const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
    if (goalRead.status !== 'ready') return readRejection(goalRead);
    const goal = goalRead.value.goal;
    if (goal.workspaceRef.projectId !== owned.projectId) return rejection('forbidden', 'the Goal belongs to another project');
    // D-9 (§2.6): a paused or cancelled Goal selects no work; the claim would be `busy` anyway.
    if (goal.desiredState !== 'active') {
      return waiting(null, `the Goal is ${goal.desiredState}; no work is selected while the Goal is not active`,
        undefined, goalWaitBasisOf(goal, ['goal_state'], ['Goal']));
    }
    // `book-7a.md:380–:381`: the release step sits AFTER the active check and BEFORE the no-plan return; selection
    // stays read-only. A page with nothing releasable falls through (`:386–:388`).
    const releaseStep = await releaseCandidatePerform(owned, base);
    if (releaseStep !== null) return releaseStep;
    if (goal.activePlanRevision === null) {
      return waiting(null, 'the Goal has no adopted Plan; no work was selected',
        undefined, goalWaitBasisOf(goal, ['plan_adoption'], ['PlanRevision', 'PlanProposal']));
    }
    const graphRead = await deps.plans.queryTaskGraph(owned.ctx, { goalRef: base.goalRef });
    if (graphRead.status !== 'ready') return readRejection(graphRead);
    const graph = graphRead.value;
    if (graph.completion !== undefined && graph.completion.status === 'recorded'
      && graph.completion.selectedPlanMatches && graph.completion.snapshot.phase === 'COMPLETED') {
      return completed(null, 'the Goal is formally COMPLETED');
    }

    // An explicit Task selection ends THIS work handle once that Task is
    // satisfied; it never silently switches to another Task of the same Goal.
    if (base.taskId !== null) {
      const selectedRow = graph.tasks.find(candidate => candidate.ref.taskId === base.taskId);
      if (selectedRow !== undefined && selectedRow.effectivePhase === 'satisfied') {
        return completed(null, `the selected Task ${base.taskId} is satisfied`);
      }
      // L-15 (§9 VD-11, C7): a non-active selected Task is never advanced. A cancelled or
      // superseded one ends this work handle; a deferred one waits for a plan change.
      const selectedTask = graph.plan.tasks.find(candidate => candidate.taskId === base.taskId);
      if (selectedTask !== undefined && selectedTask.disposition !== 'active') {
        const notActive = `task_not_active: the selected Task ${base.taskId} is ${selectedTask.disposition}`;
        return selectedTask.disposition === 'deferred'
          ? waiting(null, `${notActive}; it waits until a plan change makes it active again`,
            undefined, goalWaitBasisOf(goal, ['plan_change'], ['PlanRevision']))
          : completed(null, `${notActive}; it carries no work any more`);
      }
    }
    // 1. The first eligible active ordinary work in required-first / plan order.
    const ordered = orderTasks(graph.plan.tasks, graph.plan.executionDag?.dependsOn ?? []);
    const roundWaitBasis = goalWaitBasisOf(goal, ['formal_check', 'evidence', 'goal_gate'],
      ['VerificationRound', 'Evidence', 'TaskEvidenceIndex', 'Run', 'Goal', 'PlanRevision']);
    for (const task of ordered) {
      if (base.taskId !== null && task.taskId !== base.taskId) continue;
      const row = graph.tasks.find((candidate) => candidate.ref.taskId === task.taskId);
      if (row === undefined) continue;
      if (task.taskKind !== 'work' || task.disposition !== 'active') continue;
      if (task.executionIntent === 'plan_only') continue;
      // C8 (§4.3 "Workflow", §15.2 5.8, 5.9): the Task's automation verdict first. A `requeue`
      // (or a `stopped/budget_exhausted` the binding's larger budget lifts) performs the
      // automatic requeue; a `reverify` on a finalized head the automatic successor round
      // (AV-7d; with `needsFinalize` the open head is finalized below first); `claim_requeued`
      // is claimed below; `stopped` skips only this Task's rework (requeue, reverify, a claim
      // by requeueRef), so a completed Run's round still opens, runs, finalizes and completes
      // (AV-4, STEP5-FLIPS §14), except on an invalid chain (`round_ambiguous`, skipped below).
      // K3 §3.4 (U4): every Task first consults its selected Run's review record,
      // before any automatic requeue/reverify. `skip` stops only this Task (a
      // named Task waits with the blocking source); `review` performs its one step.
      const gate = await reviewGate(owned, base, config, goal, graph.plan, task, row);
      if (gate.kind === 'waiting') return waiting(null, gate.reason);
      if (gate.kind === 'rejection') return gate.rejection;
      if (gate.kind === 'review') return advancing(null, makePerform(base, gate.step));
      if (gate.kind === 'skip') {
        if (base.taskId !== null) {
          return waiting(null, `unknown_call_review_${gate.source}: the selected Run's review record blocks this Task`,
            gate.decisionSource, gate.waitBasis ?? goalWaitBasisOf(goal,
              [`unknown_call_review:${gate.source}`], ['UnknownCallReview', 'Goal']));
        }
        continue;
      }
      const rework = automaticRequeue(config, owned, base, goal, graph.plan, task, row) ?? automaticReverify(base, row);
      if (rework !== null) {
        // §4.5: the Goal's current settings decide before any automatic rework;
        // a gated step waits with its formal cause and writes nothing.
        const gated = await automationConfirmation(base, goal, row, rework);
        if (gated !== null) return gated;
        return advancing(null, makePerform(base, rework));
      }
      // D-3 (TASK-03): a requeued Task (P4) is claimed with its covering TaskRequeue,
      // before the ended Run's round chain is resumed, while its verdict is
      // `claim_requeued` (AV-3); any other verdict claims nothing.
      if (row.requeueRef !== undefined && row.execution !== null) {
        if (row.failure?.automation.verdict.kind !== 'claim_requeued') continue;
        if (!row.eligibility.eligible) continue;
        const assignment = revisionAssignments(graph.plan).find((candidate) => candidate.taskId === task.taskId);
        if (assignment === undefined) continue;
        const binding = bindingForRole(config, owned.projectId, goal.workspaceRef.workspaceId, assignment.role);
        if (binding === null) {
          return rejection('unsupported',
            `no trusted Workflow binding matches workspace ${goal.workspaceRef.workspaceId} and role ${assignment.role}`);
        }
        // K3 L12: the continuation Session and the close start from the record's
        // most recent holder (the original Run when it has no rounds).
        const holder = await continuationHolder(owned, row.execution);
        const claimed = await claimContinuation(owned, base, goal, graph.plan.ref, task, row, binding, holder,
          { requeue: { requeueRef: row.requeueRef, budget: row.requeueBudget ?? null } });
        if (claimed === null) continue;
        return claimed;
      }
      // §4.3 "stopped" (AV-6, FC-11, P10): an invalid round chain has no head to continue and VD-14
      // opens nothing on it (GAP-52), so its chain is not read (that read would only wait) and the
      // Task is skipped; the other Tasks continue.
      if (isRoundAmbiguous(row)) continue;
      // §15.2 5.9 (C5, C8): a finalized non-PASS chain head whose verdict performed no rework above
      // (`stopped`: the cap, no new basis, an uncovered requirement, the chain limit, a person's stop)
      // leaves nothing for the Workflow to advance on this Task; the other Tasks continue.
      if (headFinalizedNonPass(row)) continue;
      // A real claim that was persisted but never admitted to the Kernel (its
      // first prepare was refused) is recoverable from the SAME Run. This is the
      // ONE narrow unadmitted state, checked against the formal execution read;
      // unknown/unreadable, authorized, entered, running and terminal executions
      // keep the pre-existing rules below and are never restarted.
      if (row.execution !== null && row.effectivePhase !== 'satisfied' && row.effectivePhase !== 'failed'
        && await isUnadmittedStarting(owned, row.execution)) {
        return advancing(null, makePerform(base, { kind: 'prepare', request: prepareStep(base, row.execution) }));
      }
      // A formally completed/ended Run whose Task is still open keeps its round
      // chain (open or finalized). Resume the chain head (or open the root
      // exactly once on an explicit not_found) BEFORE skipping the ended Run;
      // an unknown chain read waits rather than falling through to an unrelated
      // Work. Failed/cancelled/paused/running/unknown executions keep the
      // existing rules below, and other same-Goal Tasks stay independently
      // selectable. The graph Plan is the Goal's current adopted Plan (VD-7).
      if (row.execution !== null && row.effectivePhase !== 'satisfied' && row.effectivePhase !== 'failed') {
        const execution = await deps.executions.readExecution(owned.ctx, row.execution);
        if (execution.status === 'ready' && sameCanonical(execution.value.run.ref, row.execution)
          && normalEnd(execution.value.run).ok) {
          return await resumeRoundChain(owned, base, roundWaitBasis, execution.value.run, graph.plan.ref);
        }
      }
      // An ended Run with no formal yield is never re-claimed. A real yielded Run
      // with a durable continuation is the ONE continuable execution.
      if (row.execution !== null && row.effectivePhase !== 'ready') continue;
      if (row.effectivePhase === 'satisfied' || row.effectivePhase === 'failed') continue;
      if (!row.eligibility.eligible) continue;
      const assignment = revisionAssignments(graph.plan).find((candidate) => candidate.taskId === task.taskId);
      if (assignment === undefined) continue;
      const binding = bindingForRole(config, owned.projectId, goal.workspaceRef.workspaceId, assignment.role);
      if (binding === null) {
        return rejection('unsupported',
          `no trusted Workflow binding matches workspace ${goal.workspaceRef.workspaceId} and role ${assignment.role}`);
      }
      // A persisted yield fixes the originating Session before any default
      // selection. Reopening the Host must never create or choose a substitute.
      let consumedWait: ConsumedWaitV1 | undefined;
      let chosen: SessionChoice;
      const taskRef: TaskTriple = { projectId: owned.projectId, goalId: base.goalRef.goalId, taskId: task.taskId };
      if (row.execution !== null) {
        // D11: the wait, not the latest Run, names the Run that yielded it. S's `wait` is the oldest
        // unconsumed Work wait of the line and its `runRef` is that wait's `originalRun`. Without the
        // Session-facts seam an old narrow double keeps the pre-D11 read.
        let priorRunRef = row.execution;
        if (deps.sessionFacts !== undefined) {
          const selected = await deps.executions.readExecution(owned.ctx, row.execution);
          if (selected.status !== 'ready') {
            return waiting(null, receiptReason(selected, 'the selected Run is not readable'));
          }
          const facts = await deps.sessionFacts.readSessionFacts(owned.ctx, selected.value.session.ref);
          if (facts.status !== 'ready') {
            return waiting(null, receiptReason(facts, 'the continuation line facts are not readable'));
          }
          const wait = facts.value.wait;
          if (wait === null) {
            return waiting(null, 'the continuation line has no unconsumed Work wait');
          }
          priorRunRef = wait.runRef;
        }
        const continuation = await readContinuation(owned, priorRunRef);
        if ('rejection' in continuation) return continuation.rejection;
        if ('waiting' in continuation) {
          return waiting(null, continuation.waiting,
            undefined, goalWaitBasisOf(goal, ['wait_reply'], ['SessionMessage', 'Run', 'TaskLease']));
        }
        consumedWait = continuation.value;
        const original = await deps.sessions.readSession(owned.ctx, continuation.sessionRef);
        if (original.status !== 'ready') {
          return waiting(null, 'the original continuation Session is not readable',
            undefined, goalWaitBasisOf(goal, ['session_available'], ['Session']));
        }
        if (!roleReusable(original.value, goal.workspaceRef.workspaceId, binding)) {
          return waiting(null, 'the original continuation Session is busy, archived or incompatible',
            undefined, goalWaitBasisOf(goal, ['session_available'], ['Session']));
        }
        chosen = { kind: 'reuse', card: original.value };
      } else {
        chosen = await chooseSession(owned, goal, binding, base.sessionHint, taskRef);
      }
      if (chosen.kind === 'rejection') return chosen.rejection;
      if (chosen.kind === 'waiting') {
        return waiting(null, chosen.reason, undefined, goalWaitBasisOf(goal, ['session_available'], ['Session']));
      }
      if (chosen.kind === 'create') {
        const operation = createSessionStep(base, {
          workspace: { projectId: owned.projectId, workspaceId: goal.workspaceRef.workspaceId },
          role: binding.sessionRole, recommendedRefs: [],
          initialLinks: [{ target: { kind: 'task', ref: taskRef }, relation: 'responsible' }],
        }, taskRef, graph.plan.ref);
        return advancing(null, makePerform(base, operation));
      }
      const sessionRef: SessionRef = { projectId: owned.projectId, sessionId: chosen.card.record.ref.sessionId };
      const built = await buildClaimOperation(owned, base, goal, graph.plan.ref, task, binding,
        sessionRef.sessionId, chosen.card.record.revision, true, consumedWait);
      if ('rejection' in built) return built.rejection;
      return advancing(null, makePerform({ ...base, sessionHint: sessionRef }, built.operation));
    }

    // An explicit Task selection never advances the Goal-level gate/completion:
    // only that Task's own work may progress.
    if (base.taskId !== null) {
      return waiting(null, `the selected Task ${base.taskId} is not executable right now`, undefined,
        goalWaitBasisOf(goal, ['plan_adoption', 'plan_change', 'task_claimable', 'formal_check', 'evidence'],
          ['PlanRevision', 'PlanProposal', 'Run', 'TaskLease', 'DispatchOutboxEntry', 'VerificationRound',
            'Evidence', 'TaskEvidenceIndex']));
    }
    // 2. While any required ordinary work is still unsatisfied (including a
    //    required plan_only future node) the real gap stays; the Goal gate is
    //    never scheduled ahead of unfinished ordinary work. L-15 (§9 VD-11, C7):
    //    a cancelled or superseded required Task carries no work and is not
    //    waited for; when only deferred required work is left, the wait says so
    //    (prefix `required_task_deferred:`, the Goal's GOAL-30 reason).
    const unsatisfied = (task: RuntimeTask): boolean => {
      const row = graph.tasks.find((candidate) => candidate.ref.taskId === task.taskId);
      return row === undefined || row.effectivePhase !== 'satisfied';
    };
    const required = graph.plan.tasks.filter((task) => task.requirementLevel === 'required' && carriesWork(task));
    const unfinishedWork = required.filter((task) => task.taskKind === 'work' && unsatisfied(task));
    if (unfinishedWork.length > 0) {
      const gap = describeGap(ordered, graph);
      return waiting(null, unfinishedWork.every((task) => task.disposition === 'deferred')
        ? `required_task_deferred: ${gap}` : gap, undefined,
        goalWaitBasisOf(goal, ['plan_adoption', 'plan_change', 'task_claimable', 'formal_check', 'evidence'],
          ['PlanRevision', 'PlanProposal', 'Run', 'TaskLease', 'DispatchOutboxEntry', 'VerificationRound',
            'Evidence', 'TaskEvidenceIndex']));
    }

    // 3. Only a fully satisfied required ordinary set may produce the gate
    //    evidence from an already-ended ordinary Run (no gate Run is invented).
    const gateTask = required.find((task) => task.taskKind === 'gate' && unsatisfied(task));
    if (gateTask !== undefined) return await advanceGate(owned, base, roundWaitBasis, graph, gateTask);

    // 4. Only a fully satisfied required set may propose the formal Goal completion.
    if (required.every((task) => !unsatisfied(task))) {
      return advancing(null, makePerform(base, completeGoalStep(base, owned.projectId, goal, graph.completion)));
    }
    return waiting(null, describeGap(ordered, graph), undefined,
      goalWaitBasisOf(goal, ['plan_adoption', 'plan_change', 'task_claimable', 'formal_check', 'evidence'],
        ['PlanRevision', 'PlanProposal', 'Run', 'TaskLease', 'DispatchOutboxEntry', 'VerificationRound',
          'Evidence', 'TaskEvidenceIndex']));
  }

  /**
   * K3-46 (rework-2 item 1): a ② that did not succeed keeps the apply receipt
   * and the FIRST failure text, and an ordinary advance continues choosing the
   * other work in the same advance. The card's review ref is merged into the
   * selection's carried set: it comes in as `advanceWork`'s internal third
   * argument and goes out beside `next`, so the Host's continuous drive never
   * alternates back to a failed card. If
   * nothing else is selectable, the selection's own state still governs (its
   * next/receipt shape is kept). A designated advance never calls this: it
   * answers `waiting` directly.
   */
  async function continueAfterFailedReview(
    owned: Owned, base: Base, receipt: WorkflowStepReceipt | null, failure: string,
    failedRefs: readonly FailedCardRefV1[],
  ): Promise<WorkflowAdvanceResult> {
    const nextBase = mergeFailedCardRefs(base, failedRefs);
    const selection = await selectNext(owned, nextBase);
    if (selection.status !== 'ready') return selection;
    // The selection is a ready result whose carried set already sits BESIDE its
    // next; put it back into the internal next shape so the re-wrapped result
    // keeps the same lifetime instead of dropping it.
    const selectionValue = { ...selection.value };
    const carried = selectionValue.failedCardRefs;
    const internalValue = selectionValue as { failedCardRefs?: unknown };
    delete internalValue.failedCardRefs;
    const selectedNext = selectionValue.next;
    return readyValue({
      ...selectionValue,
      next: selectedNext === null ? null : { ...selectedNext,
        ...(carried === undefined || carried.length === 0
          ? {} : { failedCardRefs: carried.map(cloneFailedCardRef) }) },
      receipt, reason: failure,
    });
  }

  // --------------------------------------------------------------------------
  // E15 (wiring 1 §4.4): the ordinary-continuation handover
  // --------------------------------------------------------------------------

  /** A handover step carries the continued Task/Plan/Session so the claim can follow it (L10). */
  type HandoverContinuation = {
    predecessor: SessionRef;
    task: TaskTriple;
    successor: SessionRef;
    planRef: PlanRevisionRef;
    requeue?: WorkflowSessionRequeue;
    /** K3 L12: the review round the successor claims after the handover. */
    review?: WorkflowSessionReview;
  };
  type HandoverOperation = Extract<WorkflowOperation,
    { kind: 'transfer_responsibility' | 'archive_predecessor' }>;

  /** The open `responsible` link of one exact task, or null (the handover guard, §4.4.3/§4.4.5). */
  function openResponsibleLink(card: SessionCard, task: TaskTriple) {
    return card.links.find((link) => link.ref.relation === 'responsible' && link.until === null
      && link.ref.target.kind === 'task' && sameCanonical(link.ref.target.ref, task)) ?? null;
  }

  /**
   * F1/W1-HO-01 (§4.4.5): the `responsible` link of one exact task whatever
   * its `until`, or null when the Session has no such link record at all. A
   * C→T link closed later still carries its own ref and revision and must be
   * pinned as it is; only a missing record uses revision 0 for the `cas`.
   */
  function responsibleLink(card: SessionCard, task: TaskTriple) {
    return card.links.find((link) => link.ref.relation === 'responsible'
      && link.ref.target.kind === 'task' && sameCanonical(link.ref.target.ref, task)) ?? null;
  }

  /**
   * E15 §4.4.3 (L11): the predecessor is a LIVE, idle, not-waiting line with no
   * archive request and no occupancy, and the Workflow has both the facts reader
   * and the archive composition. The caller additionally requires that its only
   * open responsibility (module included) is this Task. Only then are transfer
   * and final archive one step.
   */
  async function canArchivePredecessor(owned: Owned, card: SessionCard): Promise<boolean> {
    const record = card.record;
    if (record.lifecycle !== 'active') return false;
    if (record.health === 'unavailable') return false;
    if (record.archiveRequest !== null && record.archiveRequest !== undefined) return false;
    if (record.occupancy !== null) return false;
    if (deps.sessionFacts === undefined || deps.sessionLifecycle === undefined) return false;
    try {
      const facts = await deps.sessionFacts.readSessionFacts(owned.ctx,
        { projectId: record.ref.projectId, sessionId: record.ref.sessionId });
      if (facts.status !== 'ready' || facts.value.wait !== null) return false;
    } catch { return false; }
    return true;
  }

  /**
   * E15 §4.4.2: read the predecessor and new Session cards. A failed read of
   * either means no handover at all — the ordinary claim follows unchanged.
   */
  async function readHandoverCards(owned: Owned, continuation: HandoverContinuation):
  Promise<{ predecessor: SessionCard; successor: SessionCard } | null> {
    const predecessor = await deps.sessions.readSession(owned.ctx, continuation.predecessor);
    if (predecessor.status !== 'ready') return null;
    const successor = await deps.sessions.readSession(owned.ctx, continuation.successor);
    if (successor.status !== 'ready') return null;
    return { predecessor: predecessor.value, successor: successor.value };
  }

  /**
   * E15 §4.4.5 (L10/L13): the four exact pins of `transferSessionResponsibility`:
   * both Session revisions, the open predecessor link, and the successor's own
   * link record whatever its `until` (revision 0 for the `cas` "does not exist"
   * case). Null when the predecessor no longer holds the Task open or either
   * card is unreadable.
   */
  async function transferStepFor(owned: Owned, base: Base, continuation: HandoverContinuation):
  Promise<HandoverOperation | null> {
    if (deps.responsibilities === undefined) return null;
    const cards = await readHandoverCards(owned, continuation);
    if (cards === null) return null;
    const predecessorLink = openResponsibleLink(cards.predecessor, continuation.task);
    if (predecessorLink === null) return null;
    const successorLink = responsibleLink(cards.successor, continuation.task);
    const successorRef: SessionRef = {
      projectId: cards.successor.record.ref.projectId, sessionId: cards.successor.record.ref.sessionId,
    };
    const expected: VersionPin[] = [
      { ref: cards.predecessor.record.ref, revision: cards.predecessor.record.revision },
      { ref: cards.successor.record.ref, revision: cards.successor.record.revision },
      { ref: predecessorLink.ref, revision: predecessorLink.revision },
      successorLink === null
        ? { ref: { ...successorRef, aggregateType: 'SessionWorkLink', target: { kind: 'task', ref: continuation.task }, relation: 'responsible' }, revision: 0 }
        : { ref: successorLink.ref, revision: successorLink.revision },
    ];
    const input = { from: continuation.predecessor, to: successorRef, target: { kind: 'task' as const, ref: continuation.task } };
    return { kind: 'transfer_responsibility', request: automaticGraphWrite(base, 'transfer_responsibility', input, expected),
      taskRef: continuation.task, planRef: continuation.planRef, successor: successorRef,
      ...(continuation.requeue === undefined ? {} : { requeue: continuation.requeue }),
      ...(continuation.review === undefined ? {} : { review: continuation.review }) };
  }

  /**
   * E15 §4.4.3–§4.4.5: the one handover decision used both after `create_session`
   * (W1-HO-01) and on the crash-recovery reuse path (W1-HO-04). Null keeps the
   * caller's original claim (guards not met, no responsibility seam).
   */
  async function buildHandoverStep(owned: Owned, base: Base, continuation: HandoverContinuation):
  Promise<HandoverOperation | null> {
    if (deps.responsibilities === undefined) return null;
    const cards = await readHandoverCards(owned, continuation);
    if (cards === null) return null;
    const record = cards.predecessor.record;
    if (record.archiveRequest !== null && record.archiveRequest !== undefined) return null;
    const openResponsible = cards.predecessor.links.filter((link) => link.ref.relation === 'responsible' && link.until === null);
    if (openResponsibleLink(cards.predecessor, continuation.task) === null) return null;
    if (openResponsible.length === 1 && await canArchivePredecessor(owned, cards.predecessor)) {
      const input: RequestSessionArchiveInput = {
        sessionRef: continuation.predecessor,
        reason: `continuation handover: task ${continuation.task.taskId} continues in Session ${continuation.successor.sessionId}`,
        tasks: [{ target: { kind: 'task', ref: continuation.task }, disposition: { kind: 'transfer', to: continuation.successor } }],
        wait: null,
        mode: 'handoff_complete',
      };
      const expected: VersionPin[] = [{ ref: record.ref, revision: record.revision }];
      return { kind: 'archive_predecessor', request: automaticGraphWrite(base, 'archive_predecessor', input, expected),
        taskRef: continuation.task, planRef: continuation.planRef, successor: continuation.successor,
        ...(continuation.requeue === undefined ? {} : { requeue: continuation.requeue }),
        ...(continuation.review === undefined ? {} : { review: continuation.review }) };
    }
    return await transferStepFor(owned, base, continuation);
  }

  /**
   * E15 §4.4.7 (W1-HO-04, L17): crash recovery recomputes the same handover
   * from durable facts — a reused Session whose provenance continues exactly
   * this Task from a predecessor that is still open and unarchived.
   */
  async function recoveryHandoverStep(owned: Owned, base: Base, card: SessionCard, task: TaskTriple,
    planRef: PlanRevisionRef, requeue: WorkflowSessionRequeue | undefined,
    review?: WorkflowSessionReview): Promise<HandoverOperation | null> {
    const provenance = card.record.provenance;
    if (provenance === undefined || provenance === null || provenance.kind !== 'continuation') return null;
    if (!sameCanonical(provenance.task, task)) return null;
    return await buildHandoverStep(owned, base, {
      predecessor: provenance.from, task,
      successor: { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId },
      planRef,
      ...(requeue === undefined ? {} : { requeue }),
      ...(review === undefined ? {} : { review }),
    });
  }

  /** E15 §4.4.6: after a handover step the claim follows as the `create_session` branch built it, with the successor's CURRENT revision. */
  async function claimAfterHandover(owned: Owned, base: Base, operation: HandoverOperation,
    receipt: WorkflowStepReceipt): Promise<WorkflowAdvanceResult> {
    const config = deps.configuration;
    if (config === undefined) {
      return waiting(receipt, 'no trusted Workflow configuration is registered for the handover Task claim');
    }
    const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
    if (goalRead.status !== 'ready') {
      return waiting(receipt, receiptReason(goalRead, 'the Goal could not be read for the handover Task claim'));
    }
    const goal = goalRead.value.goal;
    const graphRead = await deps.plans.queryTaskGraph(owned.ctx, { goalRef: base.goalRef });
    if (graphRead.status !== 'ready') {
      return waiting(receipt, receiptReason(graphRead, 'the TaskGraph could not be read for the handover Task claim'));
    }
    const task = graphRead.value.plan.tasks.find((candidate) => candidate.taskId === operation.taskRef.taskId);
    if (task === undefined) return waiting(receipt, 'the handover Task is not in the adopted Plan');
    const assignment = revisionAssignments(graphRead.value.plan).find((candidate) => candidate.taskId === task.taskId);
    if (assignment === undefined) return waiting(receipt, 'the handover Task has no assignment');
    const binding = bindingForRole(config, owned.projectId, goal.workspaceRef.workspaceId, assignment.role);
    if (binding === null) {
      return waiting(receipt,
        `no trusted Workflow binding matches workspace ${goal.workspaceRef.workspaceId} and role ${assignment.role}`);
    }
    const card = await deps.sessions.readSession(owned.ctx, operation.successor);
    if (card.status !== 'ready') {
      return waiting(receipt, receiptReason(card, 'the handover successor Session is not readable'));
    }
    const built = await buildClaimOperation(owned, base, goal, graphRead.value.plan.ref, task, binding,
      operation.successor.sessionId, card.value.record.revision, false, undefined, operation.requeue, operation.review);
    if ('rejection' in built) return waiting(receipt, built.rejection.reason);
    const nextBase: Base = { ...base, sessionHint: operation.successor };
    return advancing(receipt, makePerform(nextBase, built.operation));
  }

  /** W1-HO-03: after a `pending`/`partial` archive, is the predecessor's Task link still open? */
  async function predecessorStillOpen(owned: Owned, predecessor: SessionRef, task: TaskTriple): Promise<boolean> {
    const card = await deps.sessions.readSession(owned.ctx, predecessor);
    if (card.status !== 'ready') return true;
    return openResponsibleLink(card.value, task) !== null;
  }

  /**
   * K slice L7 receipt table: a definite close failure (`unsupported`,
   * `unreadable`, `mismatch`, or `refused(not_closable_run |
   * continuation_not_authorized)`) falls back to today's new-Session
   * continuation: the same deterministic `create_session{requeue}` request and
   * the E15 handover recovery that follows its receipt (L8).
   */
  async function fallbackAfterClose(
    owned: Owned, base: Base, operation: Extract<WorkflowOperation, { kind: 'close_open_turn' }>,
    receipt: WorkflowStepReceipt,
  ): Promise<WorkflowAdvanceResult> {
    const config = deps.configuration;
    if (config === undefined) return waiting(receipt, 'no trusted Workflow configuration is registered for the close fallback');
    const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
    if (goalRead.status !== 'ready') return waiting(receipt, receiptReason(goalRead, 'the Goal could not be read for the close fallback'));
    const graphRead = await deps.plans.queryTaskGraph(owned.ctx, { goalRef: base.goalRef });
    if (graphRead.status !== 'ready') return waiting(receipt, receiptReason(graphRead, 'the TaskGraph could not be read for the close fallback'));
    const task = graphRead.value.plan.tasks.find((candidate) => candidate.taskId === operation.taskRef.taskId);
    if (task === undefined) return waiting(receipt, 'the close fallback Task is not in the adopted Plan');
    const assignment = revisionAssignments(graphRead.value.plan).find((candidate) => candidate.taskId === task.taskId);
    if (assignment === undefined) return waiting(receipt, 'the close fallback Task has no assignment');
    const workspaceId = goalRead.value.goal.workspaceRef.workspaceId;
    const binding = bindingForRole(config, owned.projectId, workspaceId, assignment.role);
    if (binding === null) {
      return waiting(receipt, `no trusted Workflow binding matches workspace ${workspaceId} and role ${assignment.role}`);
    }
    const claimSession = await deps.sessions.readSession(owned.ctx, operation.request.sessionRef);
    const provenance = continuationProvenanceFor(claimSession, workspaceId, binding, operation.taskRef);
    return advancing(receipt, makePerform(base, createSessionStep(base, {
      workspace: { projectId: owned.projectId, workspaceId },
      role: binding.sessionRole, recommendedRefs: [],
      initialLinks: [{ target: { kind: 'task', ref: operation.taskRef }, relation: 'responsible' }],
      ...(provenance === null ? {} : { provenance }),
    }, operation.taskRef, operation.planRef, operation.requeue, operation.review)));
  }

  /**
   * K3 L10 / item A: the ONE next step after a review-purpose Run's `start` or
   * `observe`. A review Run NEVER opens a check round and never takes
   * `afterNotNormalEnd`. On ANY known end (item C's predicate) it reads the
   * record and builds the pinned `settle_review`; while the Run has not ended
   * or its outcome is `outcome_unknown`, it waits with the normal-end reason.
   * A failed record read also waits for the next advance.
   */
  async function settleReviewAfterRun(
    owned: Owned, base: Base, receipt: WorkflowStepReceipt, run: RunSnapshot,
  ): Promise<WorkflowAdvanceResult> {
    if (!reviewRoundEndedKnown(run)) {
      const ended = normalEnd(run);
      return waiting(receipt, ended.ok ? `the Run ${run.ref.runId} ended without a known result` : ended.reason);
    }
    const purpose = run.purpose;
    if (purpose === undefined || purpose.kind !== 'unknown_call_review') {
      return waiting(receipt, 'the review-purpose Run has no review record reference');
    }
    const port = deps.unknownCallReviews;
    if (port === undefined) return waiting(receipt, 'the review record reader is not wired');
    let read;
    try { read = await port.readReview(owned.ctx, { ref: purpose.reviewRef }); }
    catch { return waiting(receipt, 'the review record is not readable'); }
    if (read.status !== 'ready') return waiting(receipt, receiptReason(read, 'the review record is not readable'));
    return advancing(receipt, makePerform(base, settleReviewStep(base, read.value, 'round_ended')));
  }

  /**
   * K3 L19/UR7/UR7b (rework 1 item 2): the shared reading of one
   * `advanceReviewDisposition` outcome. It judges ② by its RESULT, never by
   * the coordinator's `application_not_recorded` state string: a committed ②
   * (new or replayed) applied the disposition, and a `revision_conflict` did
   * only when its `current` proves the review record moved to a revision other
   * than the answered card's. `state === 'applied'` stays applied. Everything
   * else waits with `dispositionFailure`, so the Workflow never busy-loops on a
   * refused ②.
   */
  type DispositionValue = {
    state: string;
    action: { status: string; code?: string; reason?: string; current?: VersionPin[] } | null;
    application: { status: string; code?: string; reason?: string } | null;
  };
  /** The answered card's revision is the review pin the answer captured. */
  function answeredReviewPin(expected: readonly VersionPin[]): VersionPin | null {
    for (const pin of expected) {
      const ref = pin.ref as { aggregateType?: unknown };
      if (ref.aggregateType === 'UnknownCallReview') return pin;
    }
    return null;
  }
  /** True only for the record-really-moved `revision_conflict` (T02 carries no record `current`). */
  function revisionConflictMovedRecord(value: DispositionValue, expected: readonly VersionPin[]): boolean {
    const action = value.action;
    if (action === null || action.status !== 'rejected' || action.code !== 'revision_conflict') return false;
    const answered = answeredReviewPin(expected);
    if (answered === null || !Array.isArray(action.current)) return false;
    const moved = action.current.find(pin => sameCanonical(pin.ref, answered.ref));
    return moved !== undefined && moved.revision !== answered.revision;
  }
  function dispositionApplied(value: DispositionValue, expected: readonly VersionPin[]): boolean {
    if (value.state === 'applied') return true;
    if (value.action !== null && value.action.status === 'committed') return true;
    return revisionConflictMovedRecord(value, expected);
  }
  function dispositionFailure(value: DispositionValue, expected: readonly VersionPin[]): string {
    if (value.action !== null && value.action.status === 'rejected') {
      // K3-46: ONLY the owner's T02 refusal (its own exported reason) is the
      // Goal-content sentence. A moved record and every other
      // `revision_conflict` (e.g. a concurrently paused Goal) report the real
      // rejection so the next advance re-reads and acts on it.
      if (value.action.code === 'revision_conflict'
        && value.action.reason === UNKNOWN_CALL_REVIEW_T02_REASON
        && !revisionConflictMovedRecord(value, expected)) {
        return '目标的内容变了，这个答复不能落实';
      }
      return `${value.action.code ?? 'rejected'}: ${value.action.reason ?? 'the disposition action was refused'}`;
    }
    if (value.application !== null && value.application.status === 'rejected') {
      return `${value.application.code ?? 'rejected'}: ${value.application.reason ?? 'the application record was refused'}`;
    }
    return `${value.state}: the review disposition was not applied`;
  }
  /** A non-ready `ReadResult` as the one visible `code: reason` text. */
  function dispositionReadFailure(result: { status: string; code?: unknown; reason?: unknown }): string {
    const code = typeof result.code === 'string' && result.code.length > 0 ? result.code : result.status;
    const reason = typeof result.reason === 'string' && result.reason.length > 0
      ? result.reason : 'the review disposition was not ready';
    return `${code}: ${reason}`;
  }

  async function performStep(owned: Owned, base: Base, operation: WorkflowOperation): Promise<WorkflowAdvanceResult> {
    // §4.5 (rule 16): `perform` shares the automation policy with `select_work`.
    // A gated automatic rework waits with its formal cause and performs nothing.
    const gatedRework = await gatePerform(owned, base, operation);
    if (gatedRework !== null) return gatedRework;
    // The original owner request is always performed first and its complete
    // receipt is preserved. The trusted configuration is re-checked only when a
    // successful successor genuinely needs a binding or the fixed consumerId.
    const config = deps.configuration;
    /** VD-7: the round of a normally ended Run opens under the Goal's current adopted Plan. */
    const openChecksAfterRun = async (receipt: WorkflowStepReceipt, run: RunSnapshot): Promise<WorkflowAdvanceResult> => {
      const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
      if (goalRead.status !== 'ready') return waiting(receipt, receiptReason(goalRead, 'the Goal could not be read for the round open'));
      const planRef = goalRead.value.goal.activePlanRevision;
      if (planRef === null) return waiting(receipt, 'the Goal has no adopted Plan; no round is opened');
      return advancing(receipt, makePerform(base, openWorkChecksStep(base, run, planRef)));
    };
    switch (operation.kind) {
      case 'close_open_turn': {
        const closeTurn = turnClosureOf(deps.runtime);
        const result = closeTurn === undefined
          ? { status: 'unsupported' as const, reason: 'the Runtime does not publish closeOpenTurn' }
          : await closeTurn.call(deps.runtime, owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'close_open_turn', result };
        // K L7 receipt table. Success and "can retry" both leave the line alone
        // (the next advancement or maintenance re-runs it); only a definite
        // failure takes today's new-Session fallback; the other `refused`
        // reasons mean the platform facts changed, so re-select under them.
        switch (result.status) {
          case 'closed':
          case 'already_closed':
            if (result.health === 'available') return advancing(receipt, selectWorkStep(base));
            return waiting(receipt, `close_open_turn: the Turn is ${result.status} but the Session health is unavailable`);
          case 'conflict':
          case 'transient':
            return waiting(receipt, `close_open_turn: ${result.status}; retry on the next advancement`);
          case 'refused':
            if (result.reason === 'not_closable_run' || result.reason === 'continuation_not_authorized') {
              return await fallbackAfterClose(owned, base, operation, receipt);
            }
            if (result.reason === 'lease') {
              return waiting(receipt, 'close_open_turn refused: the Host does not hold the instance lease');
            }
            return advancing(receipt, selectWorkStep(base));
          case 'unsupported':
          case 'unreadable':
          case 'mismatch':
            return await fallbackAfterClose(owned, base, operation, receipt);
        }
      }
      case 'create_session': {
        const result = await deps.runtime.createSession(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'create_session', result };
        if (result.status !== 'completed') return waiting(receipt, receiptReason(result, 'the Session creation did not complete'));
        const session = result.value;
        if (config === undefined) {
          return waiting(receipt, 'no trusted Workflow configuration is registered for the Session-created Task claim');
        }
        const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
        if (goalRead.status !== 'ready') {
          return waiting(receipt, receiptReason(goalRead, 'the Goal could not be read for the Session-created Task claim'));
        }
        const goal = goalRead.value.goal;
        const graphRead = await deps.plans.queryTaskGraph(owned.ctx, { goalRef: base.goalRef });
        if (graphRead.status !== 'ready') {
          return waiting(receipt, receiptReason(graphRead, 'the TaskGraph could not be read for the Session-created Task claim'));
        }
        const task = graphRead.value.plan.tasks.find((candidate) => candidate.taskId === operation.taskRef.taskId);
        if (task === undefined) return waiting(receipt, 'the created Session task is not in the adopted Plan');
        const assignment = revisionAssignments(graphRead.value.plan).find((candidate) => candidate.taskId === task.taskId);
        if (assignment === undefined) return waiting(receipt, 'the created Session task has no assignment');
        const binding = bindingForRole(config, owned.projectId, goal.workspaceRef.workspaceId, assignment.role);
        if (binding === null) {
          return waiting(receipt,
            `no trusted Workflow binding matches workspace ${goal.workspaceRef.workspaceId} and role ${assignment.role}`);
        }
        // E15 (W1-HO-01, §4.4.1): only a completed `create_session` whose request
        // carried a `continuation` provenance is a handover; the decision reads
        // the predecessor and the new Session and either archives the live,
        // idle predecessor in one composition or transfers only.
        const provenance = operation.request.provenance;
        if (provenance !== undefined && provenance !== null && provenance.kind === 'continuation') {
          const handover = await buildHandoverStep(owned, base, {
            predecessor: provenance.from, task: operation.taskRef,
            successor: { projectId: owned.projectId, sessionId: session.ref.sessionId },
            planRef: graphRead.value.plan.ref,
            ...(operation.requeue === undefined ? {} : { requeue: operation.requeue }),
            ...(operation.review === undefined ? {} : { review: operation.review }),
          });
          if (handover !== null) return advancing(receipt, makePerform(base, handover));
        }
        // F2/§7 rule 2 (L10, W1-HO-01): on the E15 path the claim's Session
        // revision is read after the handover decision, not taken from the
        // `create_session` receipt. A replayed receipt whose handover already
        // committed still carries C's creation-time revision, while the
        // transfer raised it; reading now recomputes from current facts. An
        // unreadable C means no handover and the direct claim (§4.4 item 2),
        // which keeps the receipt's revision.
        let claimRevision = session.revision;
        if (provenance !== undefined && provenance !== null && provenance.kind === 'continuation'
          && deps.responsibilities !== undefined) {
          const card = await deps.sessions.readSession(owned.ctx,
            { projectId: owned.projectId, sessionId: session.ref.sessionId });
          if (card.status === 'ready') claimRevision = card.value.record.revision;
        }
        const built = await buildClaimOperation(owned, base, goal, graphRead.value.plan.ref, task, binding,
          session.ref.sessionId, claimRevision, false, undefined, operation.requeue, operation.review);
        if ('rejection' in built) return waiting(receipt, built.rejection.reason);
        const nextBase: Base = { ...base, sessionHint: { projectId: owned.projectId, sessionId: session.ref.sessionId } };
        return advancing(receipt, makePerform(nextBase, built.operation));
      }
      case 'claim_task': {
        const result = await deps.claims.claimTask(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'claim_task', result };
        if (result.status !== 'committed') return waiting(receipt, result.reason);
        const claim = result.value;
        const nextBase: Base = { ...base, sessionHint: claim.sessionRef };
        return advancing(receipt, makePerform(nextBase, { kind: 'prepare', request: prepareStep(nextBase, claim.runRef) }));
      }
      // 〔L5〕 The one owner call. A refusal is the machine's or R2's own and is never retried here — it is this pass's
      // "blocked" (`book-7a.md:386–:389`, R2-B-06).
      case 'release_message': {
        const owner = deps.messageRelease;
        // A public `workflow/advance` can name any perform; without the owner the step is `unsupported`, as every
        // other uninstalled entry of this file (`selectNext`'s configuration arm, :1337).
        if (owner === undefined) return rejection('unsupported', 'the Workflow has no message release owner');
        const released = await owner.releaseApproved(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'release_message', result: released };
        // A committed release hands the Goal back to the one selection (`book-7a.md:380–:381`).
        if (released.status === 'committed') return advancing(receipt, selectWorkStep(base));
        // 〔a-06〕 The three refusals that mean "blocked this pass" (`book-7a.md:386`, `:389`): a stale item
        // (`revision_conflict`), a Goal that is not active (`busy`, `message-release.ts:68`) and a missing item
        // (`not_found`). The pass counts them as `blocked` and steps on (`A/host.ts`'s `releaseHandler`).
        if (released.code === 'revision_conflict' || released.code === 'busy' || released.code === 'not_found') {
          return waiting(receipt, `${released.code}: ${released.reason}`);
        }
        // Every other refusal of the port is the read's own failure, not "no work": it is returned as the rejection
        // it is, exactly as `performStep` already answers for its other steps (`:547`'s return type).
        return released;
      }
      case 'prepare': {
        const result = await deps.runtime.prepareExecution(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'prepare', result };
        if (result.status !== 'ready') return waiting(receipt, receiptReason(result, 'the execution preparation did not complete'));
        if (config === undefined) {
          return waiting(receipt, 'no trusted Workflow configuration is registered for the Run consumerId');
        }
        return advancing(receipt, makePerform(base, { kind: 'start', request: startStep(base, result.value, config.consumerId) }));
      }
      case 'start': {
        const result = await deps.runtime.startRun(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'start', result };
        // W1-WF-01 (§4.3 item 3, L4): the Goal-content entry guard's refusal
        // (`revision_conflict` with the exact `context_goal_changed:` prefix)
        // re-prepares the SAME Run instead of waiting. `prepareStep` hashes the
        // unchanged base and Run ref, so the prepare request id is unchanged;
        // `prepareExecution` of an unbound Run assembles a fresh manifest
        // instead of replaying by request id, so the new manifest makes the
        // following `start` request id different. Every other refusal keeps the
        // original waiting behavior.
        if (result.status === 'rejected' && result.code === 'revision_conflict'
          && result.reason.startsWith('context_goal_changed:')) {
          return advancing(receipt, makePerform(base,
            { kind: 'prepare', request: prepareStep(base, operation.request.prepared.claim.runRef) }));
        }
        if (result.status !== 'ready') return waiting(receipt, receiptReason(result, 'the Run did not return a formal record'));
        // K3 L10: a review-purpose Run NEVER opens a check round and never takes
        // `afterNotNormalEnd`; any known end settles the record instead.
        if (result.value.run.purpose?.kind === 'unknown_call_review') {
          return await settleReviewAfterRun(owned, base, receipt, result.value.run);
        }
        const ended = normalEnd(result.value.run);
        if (!ended.ok) return afterNotNormalEnd(receipt, result.value.run, ended.reason, base);
        return await openChecksAfterRun(receipt, result.value.run);
      }
      case 'observe': {
        const result = await deps.runtime.observeRun(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'observe', result };
        if (result.status !== 'ready') return waiting(receipt, receiptReason(result, 'the Run observation did not return a formal record'));
        if (result.value.run.purpose?.kind === 'unknown_call_review') {
          return await settleReviewAfterRun(owned, base, receipt, result.value.run);
        }
        const ended = normalEnd(result.value.run);
        if (!ended.ok) return afterNotNormalEnd(receipt, result.value.run, ended.reason, base);
        return await openChecksAfterRun(receipt, result.value.run);
      }
      case 'open_checks': {
        const result = await deps.evidence.openVerification(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'open_checks', result };
        if (result.status !== 'committed') return waiting(receipt, result.reason);
        const next = nextAfterRound(base, result.value);
        if (next === null) return waiting(receipt, 'the round has an executing check; not advancing');
        return advancing(receipt, next);
      }
      case 'run_check': {
        const result = await deps.checks.runRegisteredCheck(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'run_check', result };
        if (result.status === 'rejected' && beginRefusalIsPermanent(result)) {
          // Exit #3 (VD-8): the frozen binding changed, so the round's attempts
          // end; the remaining checks count as gaps when it finalizes.
          const read = await deps.evidence.readVerification(owned.ctx, operation.request.input.roundRef);
          if (read.status !== 'ready') return waiting(receipt, receiptReason(read, 'the round could not be read for its finalize'));
          if (read.value.status !== 'open') return waiting(receipt, 'the round is already finalized');
          return advancing(receipt, finalizeChecksStep(base, read.value));
        }
        if (result.status !== 'ready') return waiting(receipt, receiptReason(result, 'the registered check did not return a persisted round'));
        const next = nextAfterRound(base, result.value);
        if (next === null) return waiting(receipt, 'the round has an executing check; not advancing');
        return advancing(receipt, next);
      }
      case 'finalize_checks': {
        const result = await deps.evidence.finalizeChecks(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'finalize_checks', result };
        if (result.status === 'rejected' && result.code === 'busy') {
          // §15.2 5.9 (VR-07 Workflow row): `busy` on a round already finalized is a stale replay (another
          // driver finalized it): back to the selection, where its chain head and the verdict decide.
          const read = await deps.evidence.readVerification(owned.ctx, operation.request.input.roundRef);
          if (read.status === 'ready' && read.value.status === 'finalized') return advancing(receipt, selectWorkStep(base));
        }
        if (result.status !== 'committed') return waiting(receipt, result.reason);
        const finalized = result.value;
        // §15.2 5.8 result mapping (C8, C5): a non-PASS round goes back to the selection, where the
        // Task's failure facts and automation verdict decide; only a clean PASS completes the Task.
        if (!finalized.applicable || finalized.outcome !== 'PASS' || finalized.gaps.length > 0) {
          return advancing(receipt, selectWorkStep(base));
        }
        const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
        if (goalRead.status !== 'ready') {
          return waiting(receipt, receiptReason(goalRead, 'the Goal could not be read for the Task completion'));
        }
        const goal = goalRead.value.goal;
        if (goal.activePlanRevision === null) return waiting(receipt, 'the Goal has no adopted Plan; the Task is not completed');
        return advancing(receipt, makePerform(base, completeTaskStep(base, goal, goal.activePlanRevision, finalized.snapshot)));
      }
      case 'complete_task': {
        const result = await deps.tasks.completeTask(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'complete_task', result };
        if (result.status !== 'committed') return waiting(receipt, result.reason);
        return advancing(receipt, selectWorkStep(base));
      }
      case 'complete_goal': {
        const result = await deps.tasks.completeGoal(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'complete_goal', result };
        if (result.status !== 'committed') return waiting(receipt, result.reason);
        return completed(receipt, 'the Goal was formally completed');
      }
      case 'requeue_task': {
        const requeue = deps.claims.requeueTask;
        if (requeue === undefined) return rejection('unsupported', 'the Task claim owner does not publish requeueTask');
        // C8: performed as the platform automation actor, never as the Host operator (TD-6).
        const result = await requeue.call(deps.claims, automationContext(owned), operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'requeue_task', result };
        // §15.2 5.8 result mapping: a commit (`requeued`, or the policy refusal `refused`) and a
        // `revision_conflict` go back to the selection, where the facts as they are now decide (a
        // conflict needs another write first, so this never spins); any other refusal waits with its code.
        if (result.status === 'committed' || result.code === 'revision_conflict') return advancing(receipt, selectWorkStep(base));
        return waiting(receipt, `${result.code}: ${result.reason}`);
      }
      case 'reverify_round': {
        const reverify = deps.evidence.reverifyRound;
        if (reverify === undefined) return rejection('unsupported', 'the evidence owner does not publish reverifyRound');
        // C5/C8: performed as the platform automation actor, never as the Host operator (TD-6).
        const result = await reverify.call(deps.evidence, automationContext(owned), operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'reverify_round', result };
        // §15.2 5.9 result mapping (as 5.8): a commit (`reverified`, or the policy refusal `refused`) and a
        // `revision_conflict` go back to the selection (the successor head then runs its checks through
        // `run_check`); any other refusal waits with its code.
        if (result.status === 'committed' || result.code === 'revision_conflict') return advancing(receipt, selectWorkStep(base));
        return waiting(receipt, `${result.code}: ${result.reason}`);
      }
      case 'settle_review': {
        const owner = deps.unknownCallReviews;
        if (owner === undefined) return rejection('unsupported', 'the UnknownCallReview owner is not installed');
        // K3 L16: performed as the Host principal (the owner refuses anything else).
        const result = await owner.settleReview(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'settle_review', result };
        // A commit (settled or the unfinished-round UCR-06) and the record revision
        // having moved both go back to the selection; every other refusal waits.
        if (result.status === 'committed' || result.code === 'revision_conflict') {
          return advancing(receipt, selectWorkStep(base));
        }
        return waiting(receipt, `${result.code}: ${result.reason}`);
      }
      case 'cancel_review_round': {
        const controls = deps.controls;
        if (controls === undefined) return rejection('unsupported', 'the control owner is not installed');
        // K3 §3.4 UR3h: submitted as the Workflow automation actor, pinned to the
        // Run revision read. A conflict returns to the selection, where the
        // current facts decide (never a second write here).
        const result = await controls.submitControl(automationContext(owned), operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'cancel_review_round', result };
        if (result.status === 'committed' || result.code === 'revision_conflict') {
          return advancing(receipt, selectWorkStep(base));
        }
        return waiting(receipt, `${result.code}: ${result.reason}`);
      }
      case 'apply_review_disposition': {
        // K3 L19/UR7/UR7b: ② runs as the Workflow automation actor (the answer
        // derives its identity, so a replay writes nothing new); ③ is booked
        // under the Host operator the slice-5 guard admits, so "person first,
        // Workflow second" and "Workflow first, person second" agree (K3-17).
        if (decisionActions === null) {
          return rejection('unsupported', 'the Workflow has no decision coordinator dependencies');
        }
        const result = await decisionActions.advanceReviewDisposition(
          automationContext(owned), operation.request, { applicationCtx: owned.ctx });
        const receipt: WorkflowStepReceipt = { kind: 'apply_review_disposition', result };
        // A committed ② (new or replayed) returns to the normal selection even
        // when ③ lagged (UR7b repairs it); a record that really moved does too.
        // K3-46: a ② that did NOT succeed keeps its receipt and the first
        // failure text. On an ordinary advance the selection continues in THIS
        // advance (the failed card excluded) instead of ending it; on a
        // designated advance it still answers `waiting` with that reason.
        const expected = operation.request.meta.expected;
        const failure = result.status !== 'ready'
          ? dispositionReadFailure(result)
          : dispositionApplied(result.value, expected) ? null : dispositionFailure(result.value, expected);
        if (failure === null) return advancing(receipt, selectWorkStep(base));
        if (base.taskId !== null) return waiting(receipt, failure);
        return await continueAfterFailedReview(owned, base, receipt, failure, failedCardRefsOfPins(expected));
      }
      case 'transfer_responsibility': {
        const responsibilities = deps.responsibilities;
        if (responsibilities === undefined) {
          return rejection('unsupported', 'the responsibility owner is not installed');
        }
        // E15 (W1-HO-02, L13): performed as the platform automation actor with a
        // deterministic `wf-auto:` request id. A commit claims; a conflict goes
        // back to the selection (another writer moved first); every other refusal
        // still claims — a failed handover never blocks the continuation.
        const result = await responsibilities.transferSessionResponsibility(automationContext(owned), operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'transfer_responsibility', result };
        if (result.status === 'rejected' && result.code === 'revision_conflict') {
          return advancing(receipt, selectWorkStep(base));
        }
        return await claimAfterHandover(owned, base, operation, receipt);
      }
      case 'archive_predecessor': {
        const internal = archiveService.archiveLineInternal;
        if (internal === undefined) {
          return rejection('unsupported', 'the Workflow archive composition is not installed');
        }
        // E15 (W1-HO-03, L11/L13/L14): the same composition's internal entry,
        // mode `handoff_complete`, no anchor and no requeue (execution `none`).
        const result = await internal(automationContext(owned), operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'archive_predecessor', result };
        if (result.status === 'ready') {
          if (result.value.state === 'archived') return await claimAfterHandover(owned, base, operation, receipt);
          // `pending`/`partial`: read the predecessor now. A closed Task link
          // means the transfer committed and only the final archive lagged; an
          // open one (or an unreadable card) returns to the selection, where the
          // registered request and the same advancement's maintenance continue.
          const stillOpen = await predecessorStillOpen(owned, operation.request.input.sessionRef, operation.taskRef);
          return stillOpen ? advancing(receipt, selectWorkStep(base)) : await claimAfterHandover(owned, base, operation, receipt);
        }
        if (result.status === 'rejected' && result.code === 'revision_conflict') {
          return advancing(receipt, selectWorkStep(base));
        }
        // Any other refusal: fall back to the one-step transfer when the
        // predecessor still holds the Task open; otherwise the claim proceeds.
        const fallback = await transferStepFor(owned, base, {
          predecessor: operation.request.input.sessionRef, task: operation.taskRef,
          successor: operation.successor, planRef: operation.planRef,
          ...(operation.requeue === undefined ? {} : { requeue: operation.requeue }),
        });
        if (fallback !== null) return advancing(receipt, makePerform(base, fallback));
        return await claimAfterHandover(owned, base, operation, receipt);
      }
    }
  }

  // L-b (E17, §4.2 S:823): each explicit advance — a `select_work` or a
  // `perform` continuation — runs at most ONE bounded maintenance page:
  // before choosing work (continuing pending archives first), and after a
  // `perform` step that committed something new. Only when
  // the archive dependencies are installed; otherwise the advance behaves
  // exactly as before and never reports maintenance as done. The page's real
  // per-Session failures are made visible on the result and never block the
  // selected work.
  const canMaintain = deps.sessionLifecycle !== undefined && deps.sessionFacts !== undefined;
  type MaintenanceFailure = { sessionRef: SessionRef; rejection: CoreRejection };
  const runMaintenancePage = async (owned: Owned): Promise<MaintenanceFailure[]> => {
    if (!canMaintain) return [];
    try {
      const result = await maintenanceService.maintainSessions(owned.ctx,
        { workspace: { projectId: owned.projectId, workspaceId: owned.workspaceId }, after: null,
          // SES-19a: the Workflow's own maintenance close may replace a
          // kernel_turn_open conclusion with its fresh unreadable probe.
          turnClosureCaller: 'turn_closure' });
      return result.status === 'ready' ? result.value.failures : [];
    } catch { /* a platform fault never blocks the selected work */ return []; }
  };
  const withMaintenance = (result: WorkflowAdvanceResult, failures: MaintenanceFailure[]): WorkflowAdvanceResult =>
    result.status === 'ready' && failures.length > 0
      ? { ...result, value: { ...result.value, maintenanceFailures: failures } }
      : result;

  /**
   * K3 L28 step 6b (c) kind 4 / §3.4 UR7b (M2): replay ② and do ③ for every
   * answer the start-up reconcile hands over, each by its own `reviewRef`,
   * independent of the selected Run, the Task's eligibility and the record's
   * `open`. It only repairs the bookkeeping: it never releases `hold` and never
   * fabricates a continuation (the next selection is the ordinary one).
   *
   * Rework 1 item 2: a committed ② advances even when its ③ lagged (L29 row
   * 5b); the FIRST failure text is kept and reported on the advance's `reason`,
   * never overwritten by a later receipt. K3-46 (rework 2): a ② that did not
   * succeed no longer ends an ordinary advance either — its review ref is
   * excluded and the ordinary selection continues in the same advance (the
   * designated advance still answers `waiting`). One hard-failed answer wins
   * over another's ③-only failure.
   */
  async function applyHandedOverAnswers(
    owned: Owned, base: Base, answers: NonNullable<WorkflowAdvanceInput['answers']>,
  ): Promise<WorkflowAdvanceResult | null> {
    if (answers.length === 0) return null;
    if (decisionActions === null || deps.messages === undefined) {
      return waiting(null,
        'unsupported: the Workflow has no decision coordinator or mailbox for the handed-over review answers');
    }
    let receipt: WorkflowStepReceipt | null = null;
    let failure: string | null = null;
    let hardFailure = false;
    /** K3 UR7 rework 1: at least one handed-over answer's ② ran and did not succeed (either kind). */
    let cardFailure = false;
    const failedCards: FailedCardRefV1[] = [];
    for (const handed of answers) {
      if (!isRecord(handed) || !isRecord(handed.answerMessageRef)) {
        hardFailure = true;
        if (failure === null) failure = 'invalid: a handed-over answer has no answer message ref';
        continue;
      }
      let read: Awaited<ReturnType<NonNullable<WorkflowDependencies['messages']>['readMessage']>> | null;
      try { read = await deps.messages.readMessage(owned.ctx, handed.answerMessageRef); }
      catch { read = null; }
      if (read === null || read.status !== 'ready') {
        hardFailure = true;
        if (failure === null) failure = 'unavailable: the handed-over answer message is not readable';
        continue;
      }
      const message = read.value;
      const response: unknown = message.response;
      if (!isRecord(response) || !isRecord(response['decision'])) {
        hardFailure = true;
        if (failure === null) failure = 'invalid: the handed-over answer message carries no decision response';
        continue;
      }
      const decision = response['decision'] as Record<string, unknown>;
      const source = decision['source'];
      const selection = decision['selection'];
      // B1 applies the review card kind; B3 adds the command-request kind through
      // the SAME advance (K3 ruling 4/answer 7). The handed ref decides the kind.
      if (!isRecord(source) || !isRecord(selection) || selection['kind'] !== 'option') continue;
      const kind = source['kind'];
      if (kind !== 'unknown_call_review' && kind !== 'command_rerun_request'
        && kind !== 'message_release') continue;
      const handedRaw = handed as unknown as Record<string, unknown>;
      // A `message_release` card carries neither a `reviewRef` nor a `requestRef`: `failedCardRefOf` (:406) and
      // `addFailedCardRef` (:415) stay the two review kinds' and are not reached for it (no failed card exists).
      const cardRef = kind === 'message_release' ? null
        : kind === 'unknown_call_review' ? handedRaw['reviewRef'] : handedRaw['requestRef'];
      if (cardRef === undefined) {
        hardFailure = true;
        if (failure === null) failure = 'invalid: a handed-over answer has no card ref of its source kind';
        continue;
      }
      const card = kind === 'message_release' ? null : failedCardRefOf(kind, cardRef);
      if (kind !== 'message_release' && card === null) {
        hardFailure = true;
        if (failure === null) failure = `invalid: a handed-over ${kind} answer has an incomplete card ref`;
        continue;
      }
      // K3 UR7 rework 1: the ordinary advance skips a card already failed in
      // this continuous selection, for BOTH kinds. It is never applied twice.
      if (card !== null && (base.failedCardRefs.some(existing => failedCardKey(existing) === failedCardKey(card))
        || failedCards.some(existing => failedCardKey(existing) === failedCardKey(card)))) continue;
      const expected = Array.isArray(source['pins']) ? source['pins'] as VersionPin[] : [];
      // The identity is derived from the answer alone, so a crash re-drive sends
      // the same request and ② replays its answer-derived receipt.
      const requestId = 'wf-auto:card-application:' + sha256Hex(canonicalJson({
        schemaVersion: 1, kind: 'apply_review_disposition',
        sourceKind: kind, cardRef, decisionMessageRef: message.ref,
      } as unknown as JsonValue));
      // ③'s S5 guard admits the answer's actual modifier or the trusted
      // configured operator; the start-up advance runs as that operator. Using
      // the automation identity here would replay ② and then be refused
      // `forbidden` when the earlier ② was committed by the user's answer.
      const result = await decisionActions.advanceReviewDisposition(owned.ctx, {
        input: { source: source as unknown as DecisionSourceV1,
          selection: selection as unknown as DecisionSelectionV1,
          decisionMessageRef: message.ref },
        meta: { requestId, expected: structuredClone(expected) },
      });
      receipt = { kind: 'apply_review_disposition', result };
      if (result.status !== 'ready') {
        hardFailure = true;
        if (card !== null) { cardFailure = true; addFailedCardRef(failedCards, card); }
        if (failure === null) failure = dispositionReadFailure(result);
        continue;
      }
      if (!dispositionApplied(result.value, expected)) {
        hardFailure = true;
        if (card !== null) { cardFailure = true; addFailedCardRef(failedCards, card); }
        if (failure === null) failure = dispositionFailure(result.value, expected);
        continue;
      }
      // ② committed: a lagging ③ is visible but never holds up the ordinary next
      // selection (L29 row 5b), and the first failure text is the one reported.
      const committed = result.value.action !== null && result.value.action.status === 'committed';
      const recorded = result.value.application !== null
        && result.value.application.status === 'committed';
      if (committed && !recorded && failure === null) {
        failure = dispositionFailure(result.value, expected);
      }
    }
    // K3 UR7 rework 1: a designated advance still waits on a refused ② of
    // EITHER kind (no busy loop and no fabricated continuation); an ordinary
    // one keeps its first failure text and continues the ordinary selection
    // with ALL failed cards excluded. An unreadable/invalid handed-over answer
    // (no ② ran) keeps the old wait. A committed ② advances with its first
    // failure as the visible reason.
    if (hardFailure) {
      const firstFailure = failure ?? 'invalid: the handed-over answer did not apply';
      if (base.taskId !== null || !cardFailure) return waiting(receipt, firstFailure);
      return await continueAfterFailedReview(owned, base, receipt, firstFailure, failedCards);
    }
    return advancing(receipt, selectWorkStep(base), failure);
  }

  const advanceWork = async (ctx: CoreCallContext, input: WorkflowAdvanceInput,
    internal?: WorkflowAdvanceInternal): Promise<WorkflowAdvanceResult> => {
    let isolated: WorkflowAdvanceInput;
    let isolatedInternal: WorkflowAdvanceInternal | undefined;
    try {
      isolated = structuredClone(input);
      isolatedInternal = internal === undefined ? undefined : structuredClone(internal);
    } catch { return rejection('invalid', 'the advancement input cannot be isolated from the caller'); }
    const owned = ownContext(ctx);
    if ('rejection' in owned) return owned.rejection;
    const base = baseFromInput(isolated, isolatedInternal, owned);
    if ('rejection' in base) return base.rejection;
    // K3 UR7b: the start-up hand-over is driven FIRST, before the ordinary
    // selection, and never consults the selected Run or the record's `open`.
    if (isolated.answers !== undefined) {
      const handedOver = await applyHandedOverAnswers(owned, base, isolated.answers);
      if (handedOver !== null) return handedOver;
    }
    if (isolated.kind === 'select_work') {
      const maintenanceFailures = await runMaintenancePage(owned);
      return withMaintenance(await selectNext(owned, base), maintenanceFailures);
    }
    // A `perform` continuation runs its maintenance page AFTER the step, and only
    // when the step really committed something new: a re-sent request whose
    // owner replayed the original receipt adds no write at all (rule 1; lead fix
    // 2026-10-09, A4 "the copy started nothing and wrote nothing").
    const performed = await performStep(owned, base, isolated.operation);
    const stepResult = performed.status === 'ready' ? performed.value.receipt?.result : undefined;
    const replayed = stepResult !== undefined && stepResult !== null && typeof stepResult === 'object'
      && 'replayed' in stepResult && (stepResult as { replayed?: unknown }).replayed === true;
    if (replayed) return performed;
    return withMaintenance(performed, await runMaintenancePage(owned));
  };

  // Slice 1 §4.1/§4.2: the ONE archive composition and the bounded maintenance
  // step. Both are published on the SAME Workflow port and share the wired
  // owner seams; an old narrow double simply lacks the optional ports.
  const archiveMessages: WorkflowDependencies['messages'] | undefined =
    deps.messages ?? (deps.consultations?.messages as unknown as WorkflowDependencies['messages']);
  const archiveService = createSessionArchiveService({
    ...deps,
    ...(archiveMessages === undefined ? {} : { messages: archiveMessages }),
  });
  const maintenanceService = createSessionMaintenanceService({
    ...deps, archive: archiveService,
  });

  // The handoff composite drives one child between two advances; absent, the port keeps its optional member
  // unpublished and no old caller gains a fake dependency.
  const archiveLineInternal = archiveService.archiveLineInternal;
  const sessionHandoff = deps.sessionHandoff === undefined || deps.sessions === undefined
    || deps.sessionLifecycle === undefined || archiveLineInternal === undefined ? undefined
    : createSecretaryHandoffWorkflow({ ...deps.sessionHandoff,
      archiveOwner: { archiveLineInternal }, operations: deps.sessions,
      releaseArchiveRequest: deps.sessionLifecycle.releaseSessionArchiveRequest });

  // AG2a: the explicit-consultation consumer is published on the SAME Workflow
  // port. Without the optional consultation dependencies it stays explicitly
  // unsupported, so existing Workflow fixtures are never forced to extend.
  const consultation = deps.consultations === undefined ? null : createConsultationConsumer({
    sessions: deps.sessions, plans: deps.plans, runtime: deps.runtime, consultations: deps.consultations,
    sessionArchive: archiveService, deliveryFacts,
  });
  const intervention = createInterventionHandler({ workflow: deps, claimIntervention });
  const consumeConsultation = async (ctx: CoreCallContext, input: ConsultationInput): Promise<ConsultationResult> => {
    if (consultation === null) {
      return rejection('unsupported', 'the Workflow has no consultation mailbox/Query/Project dependency');
    }
    return consultation(ctx, input);
  };

  // Slice 5 §4.5 finite decision coordination and the read-only ordering safe
  // point. The finite coordinator is built from the SAME optional owner seams;
  // without the goal-settings/decision-message owners it stays explicitly
  // unsupported, so the historical advance behavior is unchanged.
  const decisionActions: DecisionActionsPort | null = deps.goalSettings === undefined ? null : createDecisionActions({
    goalSettings: deps.goalSettings,
    ...(deps.decisionMessages === undefined ? {} : { decisionMessages: {
      answerDecision: deps.decisionMessages.answerDecision.bind(deps.decisionMessages),
      readDecisionAnswer: deps.decisionMessages.readDecisionAnswer.bind(deps.decisionMessages),
      recordDecisionApplication: deps.decisionMessages.recordDecisionApplication.bind(deps.decisionMessages),
    } }),
    ...(deps.decisionDuties === undefined ? {} : { decisionDuties: deps.decisionDuties }),
    ...(deps.goalExecutedFiles === undefined ? {} : { goalExecutedFiles: deps.goalExecutedFiles }),
    ...(deps.decisionApplications === undefined ? {} : { decisionApplications: deps.decisionApplications }),
    ...(deps.applicationReceipt === undefined ? {} : { applicationReceipt: deps.applicationReceipt }),
    // §3.3 line 625: a `conflict_wait` settings command pins the earlier Goal's
    // current GoalPhase (absent = revision 0), read from the formal completion
    // projection the goal-control owner writes, never a fabricated phase.
    goalPhasePin: async (ctx, goalRef) => {
      const read = await deps.plans.queryTaskGraph(ctx, { goalRef });
      if (read.status !== 'ready') {
        return read.status === 'rejected' ? read
          : { status: 'rejected', code: 'incomplete', reason: 'the earlier Goal phase is not readable' };
      }
      const revision = read.value.completion !== undefined && read.value.completion.status === 'recorded'
        ? read.value.completion.snapshot.revision : 0;
      return { ref: { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId }, revision };
    },
  });
  const resolveDecision = async (
    ctx: CoreCallContext, request: GraphWrite<ResolveDecisionInputV1>,
  ): Promise<ReadResult<ResolveDecisionReadV1>> => {
    if (decisionActions === null) {
      return rejection('unsupported', 'the Workflow has no decision coordinator dependencies');
    }
    return decisionActions.resolveDecision(ctx, request);
  };
  const orderGoalAdvances = async (
    ctx: CoreCallContext, input: { advances: WorkflowAdvanceInput[] },
  ): Promise<ReadResult<{ advances: WorkflowAdvanceInput[] }>> => {
    if (decisionActions === null) {
      return rejection('unsupported', 'the Workflow has no Goal-settings owner for advance ordering');
    }
    return decisionActions.orderGoalAdvances(ctx, input);
  };

  // Slice 2B L8/P12: the two backfill operations. They are published only when
  // the WorkGraph `RunActivity` owner is installed; without it (or without the
  // Runtime read side) each stays explicitly unsupported, so every existing
  // Workflow double keeps starting.
  const activityBackfill = deps.runActivity === undefined ? null : createActivityBackfill({
    runtime: deps.runtime,
    activity: deps.runActivity,
    now: deps.now ?? (() => new Date().toISOString()),
  });
  const backfillRecentActivity = async (ctx: CoreCallContext,
    input: Parameters<NonNullable<WorkflowPort['backfillRecentActivity']>>[1]): Promise<ReadResult<ActivityBackfillBatchV1>> => {
    if (activityBackfill === null) return rejection('unsupported', 'the Workflow has no RunActivity owner dependency');
    return activityBackfill.backfillRecentActivity(ctx, input);
  };
  const backfillActivityRange = async (ctx: CoreCallContext,
    input: Parameters<NonNullable<WorkflowPort['backfillActivityRange']>>[1]): Promise<ReadResult<ActivityBackfillBatchV1>> => {
    if (activityBackfill === null) return rejection('unsupported', 'the Workflow has no RunActivity owner dependency');
    return activityBackfill.backfillActivityRange(ctx, input);
  };

  return {
    handleGoalInput, advanceWork, consumeConsultation, resolveDecision, orderGoalAdvances,
    backfillRecentActivity, backfillActivityRange,
    handleIntervention: intervention.handleIntervention,
    readDeliveryEligibilityFacts,
    // Slice 1 §4.1/§4.2: the real archive/maintenance services are published
    // on the port; an outer `ready` never implies archived.
    archiveLine: archiveService.archiveLine,
    continueArchiveLine: archiveService.continueArchiveLine,
    maintainSessions: maintenanceService.maintainSessions,
    ...(sessionHandoff === undefined ? {} : { sessionHandoff }),
  };
}
