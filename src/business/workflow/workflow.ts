import type { CoreCallContext, HostPrincipal } from '../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { EffectWriteResultV1, SessionMessageRef } from '../../contracts/core/session-message.js';
import type { TaskClaim } from '../../contracts/core/task-claim.js';
import type { SessionRef, VersionPin } from '../../contracts/core/identity.js';
import type { SessionProvenanceV1 } from '../../contracts/core/session.js';
import type { RunRef, RunSnapshot, TaskBudgetV1, TaskTriple } from '../../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot, WorkspaceRef } from '../../contracts/ledger.js';
import type { PlanRevisionSnapshot, PlanRevisionRef, RuntimeTask, TaskScope } from '../../contracts/plan.js';
import { revisionAssignments } from '../../contracts/plan.js';
import type { TaskReductionRef } from '../../contracts/reduction.js';
import type { GoalPhaseRef } from '../../contracts/goal-phase.js';
import { reviewPacketItemOf, type RoundSnapshot } from '../../contracts/verification.js';
import type { EvidenceRef } from '../../contracts/evidence.js';
import { parseExecReviewAnswer } from '../../contracts/exec-review.js';
import { execReviewPacketOfRound, execReviewPacketText } from '../../core/work-graph/tasks/exec-review-packet.js';
import { NO_ACCEPTED_ANSWER, reviewQueryEnded } from '../../core/work-graph/model/evidence-contracts.js';
import type { PreparedTaskExecution } from '../../contracts/core/prepared-execution.js';
import type { ConsumedWaitV1 } from '../../contracts/dispatch.js';
import type {
  UnknownCallReviewRef, UnknownCallReviewV1,
} from '../../contracts/unknown-call-review.js';
import type { TaskAutomationStopReason, TaskAutomationVerdictV1, TaskFailureFactsV1 } from '../../contracts/task-failure.js';
import type { TaskRequeueOutcomeV1 } from '../../contracts/task-requeue.js';
import type { ReverifyOutcomeV1 } from '../../core/work-graph/model/evidence-contracts.js';
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
import { plainSessionRefKey } from '../../core/work-graph/sessions/session-record-codecs.js';
import { handoffContextOf } from '../../core/work-graph/sessions/session-handoff-service.js';
import { liveWaitMessage } from '../../core/work-graph/tasks/session-facts.js';
import {
  beginRefusalIsPermanent, displayRoundStatus, reverifyExemptionOfFacts, successorAutoCount,
} from '../../core/work-graph/state/verification-machine.js';
import { reviewRoundEndedKnown } from '../../core/work-graph/state/review-lease.js';
import type { ReverifyRoundInput } from '../../core/work-graph/model/evidence-contracts.js';
import type { CommandRerunRequestRef } from '../../contracts/command-rerun-request.js';
import type { ConsultationInput, ConsultationResult, FailedCardRefV1, GoalWaitBasisV1, InitialPlanningGoalInput, InitialPlanningGoalInputResult, ResolveDecisionInputV1, ResolveDecisionReadV1, WorkflowAdvanceInput, WorkflowAdvanceInternal, WorkflowAdvanceResult, WorkflowCalls, WorkflowOperation, WorkflowSessionRequeue, WorkflowSessionReview, WorkflowStepReceipt } from './contracts.js';
import type { LineAskCommandV1, LineAskResultV1, WorkflowDependencies, WorkflowHostConfiguration, WorkflowPort } from './ports.js';
import type { HandoffWorkflowDependencies } from './contracts.js';
import { createSecretaryHandoffWorkflow } from './session-handoff.js';
import { createConsultationConsumer, asRejection } from './consultation.js';
import { createLineAsk } from './line-ask.js';
import { createTaskGate, goalWaitBasisOf } from './task-gate.js';
import { planOnlyTargetOf, refinementRoundOf, systemRoundSendInput } from './plan-round.js';
import { orderTasksByDependency } from './task-order.js';
import { createSessionArchiveService } from './session-archive.js';
import type { RequestSessionArchiveInput } from '../../contracts/core/session-archive.js';
import { createSessionMaintenanceService } from './session-maintenance.js';
import { createDecisionActions, type DecisionActionsPort } from './decision-actions.js';
import { createActivityBackfill } from './activity-backfill.js';
import { servingBinding } from './role-bindings.js';
import { createSessionChooser, roleReusable, type SessionChoice } from './session-chooser.js';
import type { PickBasisV1 } from '../../contracts/pick-basis.js';
import type { ModuleOverlapTaskFactsV1, OverlapBasisV1 } from '../../core/work-graph/tasks/overlap-gates.js';
import { moduleOverlapOf, overlapBasisDigest, splitNonOverlapping } from '../../core/work-graph/tasks/overlap-gates.js';
import { createDutyRecipient, reviewLineOf } from '../../core/work-graph/sessions/duty-recipient.js';
import { decidePlanCandidate, type PlanCandidateFactsV1, type PlanCandidateSourceV1 } from '../../core/work-graph/state/plan-candidate.js';
import { decisionActionPolicy, gateCoveredTaskIds } from '../../core/work-graph/state/decision-policy.js';
import { systemRoundContext, systemRoundOfText, systemRoundRequestId,
  systemRoundMessageRef, type SystemRoundV1 } from '../../contracts/plan-round.js';
import { deviationRequestId, deviationText, deviationsOfGoal, taskRemindersOfGoal } from '../../contracts/plan-deviation.js';
import { controlIntentRefFor } from '../../core/work-graph/tasks/control-service.js';
import { reworkFenceOf } from '../../core/work-graph/state/task-failure.js';
import type { ControlIntentSnapshotV1 } from '../../contracts/control-intent.js';
import type { PlanProposal } from '../../core/work-graph/model/plan-contracts.js';
import type { ActivityBackfillBatchV1 } from './contracts.js';
import { deriveSessionInputId, type SessionMessage, type SessionMessageSendInputV1 } from '../../core/work-graph/model/communication-contracts.js';
import {
  effectiveReplyHandler, messageFactsOfRecord, waitFactsOfRecord, waitStateOf,
  type DeliveryFactsV1, type DeliveryResponseWaitV1,
} from '../../core/work-graph/state/message-machine.js';
import { interventionPlanningQueryRefs } from '../../contracts/query-job.js';
import { planSourceLineageOf } from '../../core/work-graph/tasks/plan-lineage.js';
import { sameRef } from '../../core/work-graph/state/ref-equality.js';
import type { DeliveryEligibilityFactsV1 } from '../../core/work-graph/model/session-facts-contracts.js';
import { createInterventionHandler } from './intervention.js';
import { proposeFromPlanTurn } from './request-candidate.js';


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
  /**
   * The Tasks a live Run watch is already advancing. The Goal-level selection
   * skips them; an explicit Task selection ignores the set.
   */
  activeTaskIds?: ReadonlySet<string>;
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
/**
 * PL §7.3.1: the one automation cancel before adopting a candidate that
 * replaces the Task of a yielded Run. The fixed identity names the candidate
 * (`proposalId`, `proposalRevision`) and the Run, and deliberately not the Run
 * revision: the same intent is read back even after the Run moved, so a
 * recovery never creates a second identity. The Run pin still carries the
 * exact revision this judgment read.
 */
export function cancelYieldedWaitStep(
  base: Base,
  proposal: Pick<PlanProposal, 'ref' | 'revision'>,
  run: RunSnapshot,
  reason: string,
): WorkflowOperation {
  const requestId = 'wf-auto:cancel-yielded:' + sha256Hex(canonicalJson({
    schemaVersion: 1, goalRef: base.goalRef,
    proposalId: proposal.ref.proposalId, proposalRevision: proposal.revision, runRef: run.ref,
  } as unknown as JsonValue));
  return { kind: 'cancel_yielded_wait', request: {
    input: { runRef: run.ref, kind: 'cancel' as const, reason },
    meta: { requestId, expected: [{ ref: run.ref, revision: run.revision }] },
  } };
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
/**
 * The finalize step. Slice 9: the third parameter is the booked review ref; `undefined` and `[]` are the same
 * request (no `reviewerEvidence` key), so no caller can make a second empty form.
 */
function finalizeChecksStep(base: Base, round: Pick<RoundSnapshot, 'ref' | 'revision'>,
  reviewerEvidence?: readonly EvidenceRef[]): WorkflowAdvanceInput {
  const input = reviewerEvidence === undefined || reviewerEvidence.length === 0
    ? { roundRef: round.ref }
    : { roundRef: round.ref, reviewerEvidence: reviewerEvidence.map((ref) => ({ ...ref })) };
  const request = graphWrite(base, 'finalize_checks', input, [{ ref: round.ref, revision: round.revision }]);
  return makePerform(base, { kind: 'finalize_checks', request });
}
/** Slice 9 VR-16: the one booking step; it names only the round, the owner reads everything else. */
function recordReviewStep(base: Base, round: Pick<RoundSnapshot, 'ref' | 'revision'>): WorkflowOperation {
  return { kind: 'record_review', request: graphWrite(base, 'record_review', { roundRef: round.ref },
    [{ ref: round.ref, revision: round.revision }]) };
}
/**
 * The next step of an open round (§9.3 "Workflow 推进顺序", by the §9.1 display
 * names): an `executing` check is an unknown window, so `null` (the caller
 * keeps the receipt and waits; never skip it or finalize early); otherwise a
 * `pending` check runs first, interrupted checks or not (V6 "只补未执行");
 * otherwise the round finalizes, an interrupted check counting as a gap. An
 * interrupted check never runs again in the round (D-12). Slice 9: a round
 * whose plan has the `review-packet` item answers `'review'` where it would
 * finalize, and the caller runs the review arm first (`reviewArm`).
 */
function nextAfterRound(base: Base, round: RoundSnapshot): WorkflowAdvanceInput | 'review' | null {
  switch (displayRoundStatus(round)) {
    case 'running': return null;
    case 'completed':
    case 'interrupted':
      return reviewPacketItemOf(round.verificationPlan) === undefined ? finalizeChecksStep(base, round) : 'review';
    case 'incomplete': break;
  }
  const pending = round.checks.find((check) => check.phase === 'pending');
  if (pending !== undefined) {
    const request = graphWrite(base, 'run_check', { roundRef: round.ref, checkId: pending.checkId },
      [{ ref: round.ref, revision: round.revision }]);
    return makePerform(base, { kind: 'run_check', request });
  }
  return reviewPacketItemOf(round.verificationPlan) === undefined ? finalizeChecksStep(base, round) : 'review';
}
/** The Goal of a round, from its own ref (the review message and its Query carry this Goal). */
function roundGoalRef(round: Pick<RoundSnapshot, 'ref'>): GoalRef {
  return { aggregateType: 'Goal', projectId: round.ref.projectId, goalId: round.ref.goalId };
}
/**
 * Slice 9 §3.2: what wakes a review wait. A pending review wakes on the message, its line, the round, the Evidence
 * and the Run; a missing line (none at all, or only in another workspace) on the line facts; a settlement on the
 * source message; a refused send on the line.
 */
const REVIEW_WAIT_KINDS = {
  exec_review_pending: ['SessionMessage', 'Session', 'VerificationRound', 'Evidence', 'Run'],
  no_review_line: ['Session', 'SessionMessage'],
  review_line_other_workspace: ['Session', 'SessionMessage'],
  settlement_pending: ['SessionMessage'],
  exec_review_send_refused: ['Session', 'SessionMessage'],
} as const;
function reviewWaitBasisOf(goalRef: GoalRef, reason: keyof typeof REVIEW_WAIT_KINDS): GoalWaitBasisV1 {
  return goalWaitBasisOf({ ref: goalRef }, [reason], REVIEW_WAIT_KINDS[reason]);
}
/** Slice 9 §3.2: the five review states of an open round's chain head (`readReviewState`). */
type ReviewStateV1 =
  | { kind: 'not_sent'; recipient: SessionRef }
  | { kind: 'waiting'; reason: 'exec_review_pending' | 'no_review_line' | 'review_line_other_workspace';
    basis: GoalWaitBasisV1 }
  | { kind: 'answered' }
  | { kind: 'closed' }
  | { kind: 'settlement_pending'; basis: GoalWaitBasisV1 };
/** The refusals of `record_review` that are the review's own answer; every other refusal waits. */
const REVIEW_BOOKING_REFUSALS: ReadonlySet<CoreRejection['code']> = new Set([
  'forbidden', 'invalid', 'unsupported', 'source_stale',
]);
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
  /** The pick basis behind this selection (LR7C-09); null when no picker ran or a continuation kept none. */
  pick: PickBasisV1 | null;
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
  reason: string | null = null, pick: PickBasisV1 | null = null,
  waitBasis?: GoalWaitBasisV1): WorkflowAdvanceResult {
  return readyValue({ state: 'advance', receipt, next, reason, pick,
    ...(waitBasis === undefined ? {} : { waitBasis }) });
}
export function waiting(receipt: WorkflowStepReceipt | null, reason: string,
  source?: DecisionSourceV1, waitBasis?: GoalWaitBasisV1, pick: PickBasisV1 | null = null): WorkflowAdvanceResult {
  return readyValue({ state: 'waiting', receipt, next: null, reason, pick,
    ...(source === undefined ? {} : { source }),
    ...(waitBasis === undefined ? {} : { waitBasis }) });
}
function completed(receipt: WorkflowStepReceipt | null, reason: string): WorkflowAdvanceResult {
  return readyValue({ state: 'completed', receipt, next: null, reason, pick: null });
}

function readRejection(result: { status: 'not_found' } | { status: 'not_ready' } | CoreRejection): CoreRejection {
  if (result.status === 'rejected') return result;
  if (result.status === 'not_found') return rejection('not_found', 'the requested fact does not exist');
  return rejection('incomplete', 'the requested read is not ready at the required watermark');
}
/** Book §3.8 item 3 (`book-7a.md:385`): one bounded candidate page — the port's own maximum (`decision-contracts.ts:531`). */
const RELEASE_CANDIDATE_PAGE_LIMIT = 100;
/**
 * §6.1.5's one candidate-wait basis: the same record kinds for every
 * candidate wait, so a wait and a card are registered by the same facts.
 */
const PLAN_CANDIDATE_WAIT_KINDS = ['PlanProposal', 'PlanRevision', 'SessionMessage', 'Session',
  'Run', 'TaskLease', 'VerificationRound', 'Evidence', 'TaskRequeue'] as const;
function planWaitBasisOf(goal: GoalSnapshot, reasons: readonly string[]): GoalWaitBasisV1 {
  return goalWaitBasisOf(goal, reasons, PLAN_CANDIDATE_WAIT_KINDS);
}
/**
 * A Task claim pins the Goal, the Workspace, the Plan and the Session and guards the task facts it read
 * (`claim-service.ts`): any of them moving is a `revision_conflict`. After its one re-selection a claim that
 * conflicts again waits on all of them (the candidate wait's kinds cover the Plan, the Session and the task facts).
 */
const CLAIM_CONFLICT_WAIT_KINDS = ['Goal', 'Workspace', ...PLAN_CANDIDATE_WAIT_KINDS] as const;

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
export function automationContext(owned: Owned): CoreCallContext {
  const actor = { ...WORKFLOW_AUTOMATION_ACTOR };
  return { projectId: owned.projectId, workspaceId: owned.workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: owned.projectId, workspaceId: owned.workspaceId, actor: { ...actor } },
    signal: owned.ctx.signal };
}

/** The same trusted Host call in another workspace of the project (rule W: a Goal's facts are read where the Goal
 *  lives); `ownContext` admits only a Host principal, and the context is built as `lineContextOf` builds it. */
function ownedInWorkspace(owned: Owned, workspaceId: string): Owned {
  if (workspaceId === owned.workspaceId) return owned;
  return { ...owned, workspaceId,
    ctx: handoffContextOf({ ...owned.ctx, workspaceId }, owned.ctx.principal as HostPrincipal) };
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
    releaseSkip: new Set<string>(internal?.releaseSkip ?? []),
    activeTaskIds: new Set<string>(internal?.activeTaskIds ?? []) };
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
    // The Goal's workspace is authoritative when it serves the role; a
    // project-level line may be served from another workspace, so fall back to
    // the project's single binding for that role. Two or more bindings do not
    // pick one.
    return servingBinding(config.bindings, projectId, workspaceId, role)
      ?? servingBinding(config.bindings, projectId, workspaceId, role, 'project');
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

  const { chooseSession, responsibleSessionFor, chooseExcluded, resolveRecipient } = createSessionChooser(deps);

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
    if (binding === null) { return rejection('unsupported', `no trusted Workflow binding matches workspace ${goal.workspaceRef.workspaceId} and role ${assignment.role}`); }
    // The consumed-wait arm is the continuation basis, which needs a prior Run; an intervention's post-adoption
    // claim targets a Task with no Run yet, so it is an ordinary first claim.
    const built = await buildClaimOperation(owned, base, goal, plan.ref, task, binding,
      session.record.ref.sessionId, session.record.revision, true,
      row.execution === null ? undefined : { kind: 'intervention', messageRef });
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
    // Rule W: the wait message belongs to the claim line's workspace, not the Run's.
    const lineWorkspaceId = priorRead.value.session.workspaceId;
    const hostReader = owned.ctx.materialReader as Extract<CoreCallContext['materialReader'], { kind: 'host' }>;
    const lineCtx: CoreCallContext = lineWorkspaceId === owned.ctx.workspaceId
      ? owned.ctx
      : { ...owned.ctx, workspaceId: lineWorkspaceId,
        materialReader: { ...hostReader, workspaceId: lineWorkspaceId } };
    const rootRead = await messages.readMessage(lineCtx, continuation.messageRef);
    if (rootRead.status !== 'ready') return { waiting: receiptReason(rootRead, 'the continuation wait message is not readable') };
    const chain = await liveWaitMessage((ref) => messages.readMessage(lineCtx, ref), rootRead.value);
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
    if (next === 'review') return await reviewArm(owned, base, round, null);
    return advancing(null, next);
  }

  /**
   * Slice 9 §3.2 `readReviewState`: one read, five states, no writes. The locator chain is fixed —
   * `execreview:<roundId>` → `systemRoundMessageRef` → `interventionPlanningQueryRefs` → `readQueryJob` →
   * `readQueryAnswer` — and it never scans. No message yet is `not_sent` with a line in the round's workspace,
   * `waiting/review_line_other_workspace` with a line only elsewhere in the project (never sent: joined-workspace exec
   * review is not connected), `waiting/no_review_line` with none (`reviewLineOf`); a message whose Query is not
   * created or not ended is `waiting/exec_review_pending`; an ended Query is `answered` with an answer that parses,
   * else `closed`; either is
   * `settlement_pending` while its source message has no reply and is not withdrawn. A failed read is its rejection.
   */
  async function readReviewState(owned: Owned, round: RoundSnapshot): Promise<ReviewStateV1 | CoreRejection> {
    const consult = deps.consultations;
    if (consult === undefined) return rejection('unsupported', 'the exec review reads (mailbox and Query) are not wired');
    const goalRef = roundGoalRef(round);
    const requestId = systemRoundRequestId({ kind: 'exec_review', goalRef, roundRef: round.ref });
    if (requestId.status !== 'ready') return requestId;
    const messageRef = systemRoundMessageRef({ projectId: round.ref.projectId, workspaceId: round.ref.workspaceId },
      requestId.value);
    if (messageRef.status !== 'ready') return messageRef;
    const message = await consult.messages.readMessage(owned.ctx, messageRef.value);
    if (message.status === 'not_found') {
      if (suggestionDutyRecipient === null) return rejection('unsupported', 'the Session duty resolver is not wired');
      const line = await reviewLineOf(suggestionDutyRecipient, automationContext(owned),
        { projectId: round.ref.projectId, workspaceId: round.ref.workspaceId });
      if (line.status !== 'ready') return readRejection(line);
      if (line.value.kind === 'here') return { kind: 'not_sent', recipient: line.value.line };
      const reason = line.value.kind === 'none' ? 'no_review_line' : 'review_line_other_workspace';
      return { kind: 'waiting', reason, basis: reviewWaitBasisOf(goalRef, reason) };
    }
    if (message.status !== 'ready') return readRejection(message);
    const pending: ReviewStateV1 = { kind: 'waiting', reason: 'exec_review_pending',
      basis: reviewWaitBasisOf(goalRef, 'exec_review_pending') };
    const read = await consult.queries.readQueryJob(owned.ctx, interventionPlanningQueryRefs(messageRef.value).queryJobRef);
    if (read.status === 'not_found') return pending;
    if (read.status !== 'ready') return readRejection(read);
    const job = read.value.job.job;
    if (!reviewQueryEnded(job)) return pending;
    const execution = job.intent.execution;
    const answerRef = job.answerRefs.at(-1);
    let answered = false;
    if (answerRef !== undefined && execution.kind === 'intervention_planning' && execution.answerShape === 'exec_review') {
      const answer = await consult.queries.readQueryAnswer(owned.ctx, answerRef);
      if (answer.status !== 'ready') return readRejection(answer);
      answered = parseExecReviewAnswer(answer.value.answer.answer).status === 'parsed';
    }
    if (message.value.response === null && message.value.withdrawnAt === null) {
      return { kind: 'settlement_pending', basis: reviewWaitBasisOf(goalRef, 'settlement_pending') };
    }
    return answered ? { kind: 'answered' } : { kind: 'closed' };
  }

  /**
   * Slice 9 §3.2: the review arm at the chain head, after the command checks and before the finalize. Its one step
   * per state: send from `not_sent` (the pending basis rides along so the driver registers before it sends), book an
   * `answered` review, finalize a `closed` one without a ref; a wait returns to the task loop, which skips this Task.
   */
  async function reviewArm(owned: Owned, base: Base, round: RoundSnapshot, receipt: WorkflowStepReceipt | null):
  Promise<WorkflowAdvanceResult> {
    const state = await readReviewState(owned, round);
    if ('status' in state) return state;
    switch (state.kind) {
      case 'not_sent': {
        const packet = execReviewPacketOfRound(round);
        if (packet.status !== 'ready') return packet;
        return advancing(receipt, makePerform(base, { kind: 'send_system_round', request: {
          round: { kind: 'exec_review', goalRef: roundGoalRef(round), roundRef: round.ref },
          recipient: state.recipient, text: execReviewPacketText(packet.value),
        } }), null, null, reviewWaitBasisOf(roundGoalRef(round), 'exec_review_pending'));
      }
      case 'waiting': return waiting(receipt, state.reason, undefined, state.basis);
      case 'settlement_pending': return waiting(receipt, 'settlement_pending', undefined, state.basis);
      case 'answered': return advancing(receipt, makePerform(base, recordReviewStep(base, round)));
      case 'closed': return advancing(receipt, finalizeChecksStep(base, round));
    }
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
    const covered = gateCoveredTaskIds(graph.plan.tasks, gateTask);
    const producer = graph.tasks.find((row) => row.definition.taskKind === 'work'
      && row.effectivePhase === 'satisfied' && row.execution !== null
      && (gateTask.scope.kind === 'goal' || covered.includes(row.ref.taskId)));
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
    const claimSession = await deps.sessions.readSession(owned.ctx, afterRun.value.outbox.claim.sessionRef, 'project');
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
      if (roleReusable(card, workspaceId, binding, { scope: 'project' }) && !excluded) {
        chosen = { kind: 'reuse', card };
      } else if (excluded || record.lifecycle === 'archived'
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

  const { reviewGate, automaticRequeue, automaticReverify, automationConfirmation, taskBlocks, gatePerform } = createTaskGate({
    workflow: deps, bindingForRole, isUnadmittedStarting, claimContinuation,
  });

  /** The delivery predicate's `taskBlocked`: the L46 block read, on the same field (book `:296–:299`). A failed read
   *  is `null`, never false. The goal/graph reads and the `config === undefined → null` stay as they were; only the
   *  derivation is replaced, so there is ONE automation source. */
  async function automationBlockedFor(owned: Owned, base: Base, taskRef: TaskTriple): Promise<boolean | null> {
    const config = deps.configuration;
    if (config === undefined) return null;
    const goal = await deps.plans.queryGoal(owned.ctx,
      { aggregateType: 'Goal', projectId: taskRef.projectId, goalId: taskRef.goalId }, { scope: 'project' });
    if (goal.status !== 'ready') return null;
    // A line may hold a message about another workspace's Task: its graph and blocks are read in the Goal's workspace.
    const goalOwned = ownedInWorkspace(owned, goal.value.goal.workspaceRef.workspaceId);
    const graph = await deps.plans.queryTaskGraph(goalOwned.ctx, { goalRef: goal.value.goal.ref });
    if (graph.status !== 'ready') return null;
    const ordered = orderTasks(graph.value.plan.tasks, graph.value.plan.executionDag?.dependsOn ?? []);
    const read = await taskBlocks(goalOwned, base, config, goal.value.goal, graph.value, ordered);
    if (read.status !== 'ready') return null;
    return read.value.waiting.has(taskRef.taskId);
  }

  /** The ONE delivery-fact builder (A-34): the message's consumption, Goal, Task block and recipient outcome. */
  async function deliveryFacts(owned: Owned, message: SessionMessage, part: 'message' | 'response',
    goalRef: GoalRef | null, target: SessionRef | null): Promise<DeliveryFactsV1 | CoreRejection> {
    // 104-1: the message's Goal, the recipient's last execution and the reply's sending Run may live in another
    // workspace of the project (a line here may serve a Goal or run a Query there); they are read project-scoped.
    const goalRead = goalRef === null ? null : await deps.plans.queryGoal(owned.ctx, goalRef, { scope: 'project' });
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
          const read = await deps.executions.readExecution(owned.ctx, prior, { scope: 'project' });
          if (read.status !== 'ready') return asRejection(read, 'the recipient last execution');
          recipientOutcomeUnknown = read.value.run.outcome === 'outcome_unknown';
        } else {
          // v2-37: the recipient's last execution may be a real QueryRun; its stage is `executionState.phase`.
          if (deps.consultations === undefined) {
            return rejection('unsupported', 'the recipient QueryRun facts need the Query owner');
          }
          const read = await deps.consultations.queries.readQueryJob(owned.ctx, {
            aggregateType: 'QueryJob', projectId: prior.projectId, workspaceId: prior.workspaceId,
            queryJobId: prior.queryJobId }, { scope: 'project' });
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
        const sender = await deps.executions.readExecution(owned.ctx, message.sender.runRef, { scope: 'project' });
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

  /**
   * The picker's suggestion step. Resolving the Goal's adviser is the one duty
   * recipient read; a rejected or unreadable read propagates and is never "no
   * adviser". With an adviser the step sends one Host-system `action_request`;
   * without one it builds M's `host_pick` member request instead. Both use the
   * same command identity so a repeat is the original receipt.
   */
  const suggestionDutyRecipient = deps.sessionDuty === undefined ? null : createDutyRecipient({
    findSessions: (ctx, input) => deps.sessions.findSessions(ctx, input),
    dutyOfRole: (ctx, role) => deps.sessionDuty!(role, ctx),
  });
  /**
   * O4b (v4 §5.2 (d)): the one adviser read of the four adviser sends. With `recipients` wired it is the L35
   * resolver through the chooser at send time (`none`/`human` = the site's old no-adviser branch); a narrow double
   * keeps the old workspace duty read, which never has a copy. A failed read is a rejection.
   */
  async function adviserOf(owned: Owned, goal: GoalSnapshot, asker: SessionRef | null):
  Promise<{ session: SessionRef | null; copy: SessionRef | null } | CoreRejection> {
    if (deps.recipients !== undefined) {
      const resolved = await resolveRecipient(owned, { goalRef: goal.ref, moduleRef: null, kind: 'general', asker });
      if ('status' in resolved) return resolved;
      return resolved.kind === 'line' ? { session: resolved.session, copy: resolved.copy } : { session: null, copy: null };
    }
    if (suggestionDutyRecipient === null) return { session: null, copy: null };
    const read = await suggestionDutyRecipient.resolveDutyRecipient(automationContext(owned), {
      workspace: { projectId: owned.projectId, workspaceId: owned.workspaceId }, duty: 'adviser' });
    return read.status === 'ready' ? { session: read.value, copy: null } : readRejection(read);
  }
  type SuggestionSend = { toolName: 'send_session_message'; arguments: unknown; requestId: string };
  type SuggestionStep =
    | { operation: WorkflowOperation; send: SuggestionSend | null }
    | { rejection: CoreRejection };
  async function suggestStep(owned: Owned, goal: GoalSnapshot, task: RuntimeTask,
    planRef: PlanRevisionRef): Promise<SuggestionStep> {
    const taskRef: TaskTriple = { projectId: owned.projectId, goalId: goal.ref.goalId, taskId: task.taskId };
    const text = `Task ${task.taskId} has no suitable member; create one executor line for this task.`;
    const commandId = `pick-suggest:${task.taskId}:${planRef.planId}`;
    // The one adviser read (`adviserOf`); an unwired narrow double has no adviser to resolve.
    const adviser = await adviserOf(owned, goal, null);
    if ('status' in adviser) return { rejection: adviser };
    const recipient = adviser.session;
    if (recipient !== null) {
      const request = {
        input: {
          recipient: { projectId: recipient.projectId, sessionId: recipient.sessionId },
          text, intent: 'action_request' as const, goalRef: goal.ref,
        },
        meta: { requestId: commandId, expected: [] },
      };
      return { operation: { kind: 'suggest_member', request },
        send: { toolName: 'send_session_message', arguments: request.input, requestId: commandId } };
    }
    return { operation: { kind: 'host_pick_member', request: {
      commandId, caller: { kind: 'host_pick' }, duty: 'executor',
      scope: { kind: 'task', task: taskRef }, reason: text } }, send: null };
  }

  /**
   * The one Host-send committed-receipt read (`book-pl-frozen.md` §7.2 List B;
   * `mailbox-service.ts`'s identity-only `lookupHostSendCommit`). The identity and
   * arguments are the caller's own send, never a current payload; `undetermined`
   * is never a refusal.
   */
  async function readHostSendReceipt(ctx: CoreCallContext, send: { requestId: string; arguments: unknown },
  ): Promise<'committed' | 'not_committed' | 'undetermined'> {
    const lookup = deps.messages?.lookupHostSendCommit;
    if (lookup === undefined) return 'undetermined';
    const result = await lookup(ctx, { toolName: 'send_session_message',
      requestId: send.requestId, arguments: send.arguments,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' } });
    return result.status === 'committed' ? 'committed'
      : result.status === 'not_committed' ? 'not_committed' : 'undetermined';
  }

  type PlanCandidateWait = { reason: string; basis: GoalWaitBasisV1; source?: DecisionSourceV1; inFlight?: true };

  /**
   * §5.1.4: the required active `plan_only` work of the current plan, as the
   * wait reasons the refinement send is built from. Shared by the ordinary
   * selection and the pass that decides whether a refinement send is due.
   */
  function planOnlyWait(goal: GoalSnapshot, graph: TaskGraph): GoalWaitBasisV1 | null {
    const reasons: string[] = [];
    for (const task of graph.plan.tasks) {
      if (task.requirementLevel !== 'required' || task.disposition !== 'active'
        || task.taskKind !== 'work' || task.executionIntent !== 'plan_only') continue;
      reasons.push(task.scope.kind === 'goal'
        ? `plan_only_task:${task.taskId}` : `plan_only:${task.scope.stageId}`);
    }
    const unique = [...new Set(reasons)];
    return unique.length === 0 ? null : goalWaitBasisOf(goal, unique, ['SessionMessage']);
  }

  async function selectOrdinary(
    owned: Owned, base: Base, config: WorkflowHostConfiguration, goal: GoalSnapshot, graph: TaskGraph,
    candidateWait: PlanCandidateWait | null,
  ): Promise<WorkflowAdvanceResult> {
    // 1. The first eligible active ordinary work in required-first / plan order.
    const ordered = orderTasks(graph.plan.tasks, graph.plan.executionDag?.dependsOn ?? []);
    // L46 §3.13 item 1: one pass after the ordering and before the loop; a failed read is the advance's failure.
    const blockRead = await taskBlocks(owned, base, config, goal, graph, ordered);
    if (blockRead.status !== 'ready') return readRejection(blockRead);
    const { blocks, waiting: branch } = blockRead.value;
    const roundWaitBasis = goalWaitBasisOf(goal, ['formal_check', 'evidence', 'goal_gate'],
      ['VerificationRound', 'Evidence', 'TaskEvidenceIndex', 'Run', 'Goal', 'PlanRevision']);
    // §3.1: a Goal-level selection does not stop at the first waiting candidate.
    // It records that candidate's wait basis and keeps looking; only when no
    // other Task can advance does it return the merged basis. A selection pinned
    // to one `taskId` still waits at once.
    // DRV-15: the one wait-basis merge. The Goal-scope collection and the L46
    // block union both dedupe kinds/reasons here, and the basis is always built
    // by `goalWaitBasisOf` rather than a hand-written object.
    const mergeWaitBasis = (bases: readonly GoalWaitBasisV1[]): GoalWaitBasisV1 =>
      goalWaitBasisOf(goal,
        [...new Set(bases.flatMap(wait => wait.reasons))],
        [...new Set(bases.flatMap(wait => wait.recordKinds))]);
    const collectedWaits: GoalWaitBasisV1[] = [];
    let collectedReason: string | null = null;
    const rememberWaiting = (reason: string, basis?: GoalWaitBasisV1): void => {
      if (collectedReason === null) collectedReason = reason;
      if (basis !== undefined) collectedWaits.push(basis);
    };
    const gapWaitBasis = (): GoalWaitBasisV1 => mergeWaitBasis([
      goalWaitBasisOf(goal, ['plan_adoption', 'plan_change', 'task_claimable', 'formal_check', 'evidence'],
        ['PlanRevision', 'PlanProposal', 'Run', 'TaskLease', 'DispatchOutboxEntry', 'VerificationRound',
          'Evidence', 'TaskEvidenceIndex']),
      ...collectedWaits,
    ]);
    /**
     * §5.1.4: the Goal-level waiting exits carry the refinement trigger. The
     * real block reason, every collected wait, the candidate wait and the
     * plan_only marker all survive; no branch is replaced by another.
     */
    const attachRefinement = async (result: WorkflowAdvanceResult): Promise<WorkflowAdvanceResult> => {
      if (result.status !== 'ready' || result.value.state !== 'waiting') return result;
      const bases: GoalWaitBasisV1[] = [];
      if (result.value.waitBasis !== undefined) bases.push(result.value.waitBasis);
      if (candidateWait !== null) bases.push(candidateWait.basis);
      const planOnly = planOnlyWait(goal, graph);
      if (planOnly !== null) bases.push(planOnly);
      if (bases.length === 0) return result;
      const basis = mergeWaitBasis(bases);
      const target = planOnlyTargetOf(basis);
      // A candidate still on its way to adoption answers the same placeholders; a second round would compete with it.
      const round = candidateWait?.inFlight === true ? null : refinementRoundOf({
        basis, goalRef: goal.ref, planRevision: graph.plan.planRevision, target: target ?? null });
      if (round !== null && suggestionDutyRecipient !== null) {
        const adviser = await adviserOf(owned, goal, null);
        if ('status' in adviser) return adviser;
        if (adviser.session !== null) {
          const requestId = systemRoundRequestId(round);
          if (requestId.status !== 'ready') return requestId;
          const text = `${requestId.value}\n细化${target!.kind === 'stage'
            ? `阶段 ${target!.stageId}` : `目标级占位任务 ${target!.taskId}`}；只输出这一段/这一版。`;
          // Build the send from the one `systemRoundSendInput` original so the receipt
          // read uses the system round's own identity and arguments.
          const request = systemRoundSendInput({ round, recipient: adviser.session, text });
          if (request.status !== 'ready') return request;
          if (await readHostSendReceipt(
            systemRoundContext({ projectId: owned.projectId, workspaceId: owned.workspaceId }, owned.ctx.signal),
            { requestId: request.value.meta.requestId, arguments: request.value.input },
          ) === 'committed') {
            // The round is already committed: keep the complete merge basis and wait.
            // The next pass sees the same gap and skips it; no self-wake guard is written.
            const pending = 'plan_refine_pending: the refinement round is already committed';
            return waiting(null, candidateWait === null ? pending : `${pending}; ${candidateWait.reason}`, undefined, basis);
          }
          return advancing(null, makePerform(base, { kind: 'send_system_round', request: {
            round, recipient: adviser.session, text,
          } }), null, null, basis);
        }
        // L33: a refinement round with no adviser goes to the queue's one entry, which tries a candidate, then a
        // role_line_add, and appends only at the cap; the command identity makes a repeat a replay. An adviser that
        // the Goal already has (`goal_has_adviser`) keeps the ordinary wait below.
        if (deps.goalAdviserQueue !== undefined) {
          const allocated = await deps.goalAdviserQueue.allocate(automationContext(owned), {
            commandId: `goal-queue:${goal.ref.goalId}`, goalRef: goal.ref,
          });
          if (!(allocated.status === 'rejected' && allocated.code === 'revision_conflict'
            && allocated.reason === 'goal_has_adviser')) {
            if (allocated.status !== 'committed') return waiting(null, 'goal_queue: the allocation did not commit');
            const kept = candidateWait === null
              ? result.value.reason ?? 'the Goal is waiting'
              : `${result.value.reason ?? 'the Goal is waiting'}; ${candidateWait.reason}`;
            return waiting(result.value.receipt, `no_adviser: the Goal is queued for an adviser; ${kept}`,
              (result.value.source ?? candidateWait?.source) ?? undefined,
              mergeWaitBasis([basis, goalWaitBasisOf(goal, ['no_adviser'], ['Goal', 'Session', 'GoalPhase'])]));
          }
        }
      }
      const reason = candidateWait === null
        ? result.value.reason ?? 'the Goal is waiting'
        : `${result.value.reason ?? 'the Goal is waiting'}; ${candidateWait.reason}`;
      return waiting(result.value.receipt, reason,
        (result.value.source ?? candidateWait?.source) ?? undefined, basis);
    };
    // A-12 (`book-7c.md` §3.3 item 2): the candidates split stably by the module-overlap rule, and the
    // non-overlapping segment keeps the whole existing order ahead of the gated one. The facts are aligned by
    // `taskId`, never by the sorted array's index.
    const facts: ModuleOverlapTaskFactsV1[] = graph.tasks.map(row => ({
      task: row.ref, effectivePhase: row.effectivePhase,
      moduleId: row.definition.scope.kind === 'module' ? row.definition.scope.moduleRef : null,
      ...(row.definition.plannedFiles === undefined ? {} : { plannedFiles: row.definition.plannedFiles }) }));
    const factOf = new Map(facts.map(fact => [fact.task.taskId, fact] as const));
    const order = splitNonOverlapping(ordered.map(candidate => ({ candidate,
      overlap: moduleOverlapOf({ waiting: factOf.get(candidate.taskId)!, others: facts }) })));
    for (const { candidate: task, overlap } of [...order.nonOverlapping, ...order.overlapping]) {
      if (base.taskId !== null && task.taskId !== base.taskId) continue;
      const row = graph.tasks.find((candidate) => candidate.ref.taskId === task.taskId);
      if (row === undefined) continue;
      // §3.1: a live watch already advances this Task; the Goal-level selection
      // skips it (an explicit Task selection never does).
      if (base.taskId === null && base.activeTaskIds?.has(task.taskId) === true) continue;
      const held = branch.get(task.taskId);
      // A named non-work Task can still be a block's dependent (a gate after its producer); work Tasks keep K3's
      // review skip first, so their held check sits after it below.
      if (held !== undefined && base.taskId !== null && task.taskKind !== 'work') {
        return waiting(null, held.reason, held.block.gate.value.decisionCause?.source ?? undefined,
          held.block.wakeBasis);
      }
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
      if (gate.kind === 'waiting') {
        if (base.taskId === null) { rememberWaiting(gate.reason); continue; }
        return waiting(null, gate.reason);
      }
      if (gate.kind === 'rejection') return gate.rejection;
      if (gate.kind === 'review') return advancing(null, makePerform(base, gate.step));
      if (gate.kind === 'skip') {
        const reason = `unknown_call_review_${gate.source}: the selected Run's review record blocks this Task`;
        const basis = gate.waitBasis ?? goalWaitBasisOf(goal,
          [`unknown_call_review:${gate.source}`], ['UnknownCallReview', 'Goal']);
        if (base.taskId !== null) return waiting(null, reason, gate.decisionSource, basis);
        // DRV-07: a Goal-scope selection records the review wait and keeps
        // looking, instead of dropping the basis with a bare `continue`.
        rememberWaiting(reason, basis);
        continue;
      }
      // L46 §3.13 item 3: a blocked Task — or one waiting behind a block — is skipped at Goal scope and continues
      // with the next Task; a named Task waits with the card's source, exactly as K3's review gate does above.
      if (held !== undefined) {
        if (base.taskId !== null) {
          return held.task.taskId === held.block.task.taskId ? held.block.gate
            : waiting(null, held.reason, held.block.gate.value.decisionCause?.source ?? undefined,
              held.block.wakeBasis);
        }
        rememberWaiting(held.reason, held.block.wakeBasis);
        continue;
      }
      const rework = automaticRequeue(config, owned, base, goal, graph.plan, task, row) ?? automaticReverify(base, row);
      if (rework !== null) {
        // §4.5: the Goal's current settings decide before any automatic rework;
        // a gated step waits with its formal cause and writes nothing.
        const gated = await automationConfirmation(base, goal, row, rework);
        if (gated !== null) {
          if (base.taskId !== null) return gated;
          if (gated.status === 'ready') {
            rememberWaiting(gated.value.reason ?? 'the automatic step is not confirmed', gated.value.waitBasis);
          }
          continue;
        }
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
        if (base.taskId === null && claimed.status === 'ready' && claimed.value.state === 'waiting') {
          rememberWaiting(claimed.value.reason ?? 'the selected Task waits', claimed.value.waitBasis);
          continue;
        }
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
          const resumed = await resumeRoundChain(owned, base, roundWaitBasis, execution.value.run, graph.plan.ref);
          if (base.taskId === null && resumed.status === 'ready' && resumed.value.state === 'waiting') {
            rememberWaiting(resumed.value.reason ?? 'the round chain head waits', resumed.value.waitBasis);
            continue;
          }
          return resumed;
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
      const taskRef: TaskTriple = { projectId: owned.projectId, goalId: base.goalRef.goalId, taskId: task.taskId };
      // §3.3 items 2, 5 and 6 (`book-7c.md`): an overlapping Task is dispatched only through its module gate.
      // The non-overlapping segment was already tried; the gate is read at this Task's current basis before any
      // Session is chosen. A conflicting Run without a real start cursor leaves the advance waiting/incomplete.
      // The gate owner is an optional seam like the other narrow owner ports: without it an old world keeps the
      // pre-gate selection, and the real composition installs N's port.
      const overlapOwner = deps.overlap;
      if (overlap.overlaps && overlapOwner !== undefined) {
        const waitingAttempt = row.currentAttempt?.attemptId ?? 'none';
        const planRevision = graph.plan.planRevision;
        const running: OverlapBasisV1['running'] = [];
        let incomplete: string | null = null;
        for (const conflicting of graph.tasks) {
          // The conflict set is the overlap rule's own `running` (planned files narrow it), never re-collected by module.
          if (!overlap.running.some((ref) => ref.taskId === conflicting.ref.taskId)) continue;
          const run = conflicting.execution;
          if (run === null) {
            incomplete = `overlap_gate_incomplete: the conflicting Run of ${conflicting.ref.taskId} is not readable`;
            break;
          }
          let loaded;
          try {
            loaded = await deps.sourceAuthority.load(run);
          } catch {
            incomplete = `overlap_gate_incomplete: the conflicting Run of ${conflicting.ref.taskId} is not readable`;
            break;
          }
          if (loaded.status !== 'found' || !('startedSince' in loaded.snapshot)) {
            incomplete = `overlap_gate_incomplete: the conflicting Run of ${conflicting.ref.taskId} is not readable`;
            break;
          }
          running.push({ task: conflicting.ref, run, startCursor: loaded.snapshot.startedSince });
        }
        // §3.3 item 7: the gate's wait names its own release plus the conflicting Run's end and the note reads.
        const gateWait = (): GoalWaitBasisV1 => goalWaitBasisOf(goal, ['overlap_gate_pending'],
          ['Run', 'TaskLease', 'NoteHead', 'NoteVersion', 'CurrentPointer', 'ModuleOverlapGate']);
        if (incomplete !== null) {
          if (base.taskId !== null) return waiting(null, incomplete, undefined, gateWait());
          rememberWaiting(incomplete, gateWait());
          continue;
        }
        const digest = overlapBasisDigest({ planRevision, waitingAttempt, running });
        const gate = { aggregateType: 'ModuleOverlapGate' as const, projectId: owned.projectId,
          goalId: goal.ref.goalId, taskId: task.taskId, moduleId: overlap.moduleId };
        const openStep: WorkflowOperation = { kind: 'open_overlap_gate', request: {
          goalRef: goal.ref, task: taskRef, moduleId: overlap.moduleId, running, planRevision, waitingAttempt } };
        const gateRead = await overlapOwner.readOverlapGate(automationContext(owned), { gate });
        if (gateRead.status === 'not_found') return advancing(null, makePerform(base, openStep), null, null);
        if (gateRead.status !== 'ready') return readRejection(gateRead);
        if (gateRead.value.basisDigest !== digest) {
          return advancing(null, makePerform(base, openStep), null, null);
        }
        const satisfaction = await overlapOwner.checkOverlapGate(automationContext(owned), { gate });
        if (satisfaction.status !== 'ready') return readRejection(satisfaction);
        if (satisfaction.value.status !== 'satisfied') {
          if (gateRead.value.noteRequest === null) {
            return advancing(null, makePerform(base, { kind: 'request_overlap_note', request: {
              gate, revision: gateRead.value.revision, basisDigest: digest } }), null, null);
          }
          const reason = `overlap_gate_pending: module ${overlap.moduleId} waits for its note or release`;
          if (base.taskId !== null) return waiting(null, reason, undefined, gateWait());
          rememberWaiting(reason, gateWait());
          continue;
        }
      }
      // A persisted yield fixes the originating Session before any default
      // selection. Reopening the Host must never create or choose a substitute.
      let consumedWait: ConsumedWaitV1 | undefined;
      let chosen: SessionChoice;
      // The chooser's basis is its own cross-type return value; the plain `SessionChoice`
      // local drops it, so it is kept here and travels on the picker's ordinary exits.
      let chosenBasis: PickBasisV1 | null = null;
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
          // Rule W: the line facts (Session record, wait/reply indexes) are in the line's workspace.
          const lineWorkspaceId = selected.value.session.workspaceId;
          const factsCtx = lineWorkspaceId === owned.ctx.workspaceId
            ? owned.ctx : { ...owned.ctx, workspaceId: lineWorkspaceId };
          const facts = await deps.sessionFacts.readSessionFacts(factsCtx, selected.value.session.ref);
          if (facts.status !== 'ready') {
            return waiting(null, receiptReason(facts, 'the continuation line facts are not readable'));
          }
          const wait = facts.value.wait;
          if (wait === null) {
            // A send still awaiting its release is no wait yet: the Goal goes on with its other Tasks.
            const basis = goalWaitBasisOf(goal, ['wait_reply'], ['SessionMessage', 'Run', 'TaskLease']);
            if (base.taskId === null) {
              rememberWaiting('the continuation line has no unconsumed Work wait', basis);
              continue;
            }
            return waiting(null, 'the continuation line has no unconsumed Work wait', undefined, basis);
          }
          priorRunRef = wait.runRef;
        }
        const continuation = await readContinuation(owned, priorRunRef);
        if ('rejection' in continuation) return continuation.rejection;
        if ('waiting' in continuation) {
          const basis = goalWaitBasisOf(goal, ['wait_reply'], ['SessionMessage', 'Run', 'TaskLease']);
          if (base.taskId === null) { rememberWaiting(continuation.waiting, basis); continue; }
          return waiting(null, continuation.waiting, undefined, basis);
        }
        consumedWait = continuation.value;
        // Rule W/M3: the original claim Session may be in another workspace of the project.
        const original = await deps.sessions.readSession(owned.ctx, continuation.sessionRef, 'project');
        if (original.status !== 'ready') {
          const basis = goalWaitBasisOf(goal, ['session_available'], ['Session']);
          if (base.taskId === null) { rememberWaiting('the original continuation Session is not readable', basis); continue; }
          return waiting(null, 'the original continuation Session is not readable', undefined, basis);
        }
        // The continuation keeps the original claim Session's identity (the afterRun continuation shape).
        if (!roleReusable(original.value, goal.workspaceRef.workspaceId, binding, { scope: 'project' })) {
          const basis = goalWaitBasisOf(goal, ['session_available'], ['Session']);
          if (base.taskId === null) {
            rememberWaiting('the original continuation Session is busy, archived or incompatible', basis);
            continue;
          }
          return waiting(null, 'the original continuation Session is busy, archived or incompatible', undefined, basis);
        }
        chosen = { kind: 'reuse', card: original.value };
      } else {
        const picked = await chooseSession(owned, goal, binding, base.sessionHint, taskRef,
          row.definition.scope.kind === 'module' ? row.definition.scope.moduleRef : null);
        chosen = picked;
        chosenBasis = picked.basis;
      }
      if (chosen.kind === 'rejection') return chosen.rejection;
      if (chosen.kind === 'waiting') {
        const basis = goalWaitBasisOf(goal, ['session_available'], ['Session']);
        if (base.taskId === null) { rememberWaiting(chosen.reason, basis); continue; }
        return waiting(null, chosen.reason, undefined, basis, chosenBasis);
      }
      if (chosen.kind === 'create') {
        const suggestion = await suggestStep(owned, goal, task, graph.plan.ref);
        if ('rejection' in suggestion) return suggestion.rejection;
        if (suggestion.send === null && suggestion.operation.kind === 'host_pick_member') {
          // An existing operation, in any stage, performs no step; the task waits.
          const commit = deps.members === undefined ? { status: 'missing' as const }
            : await deps.members.readMemberRequestCommit(automationContext(owned),
              { commandId: suggestion.operation.request.commandId });
          if (commit.status === 'unavailable') return rejection('unavailable', commit.reason);
          if (commit.status === 'committed') {
            const basis = goalWaitBasisOf(goal, ['member_creation_pending'],
              ['Session', 'CoreOperation', 'SessionMessage', 'TaskRequeue', 'PlanRevision', 'Goal']);
            if (base.taskId !== null) return waiting(null, 'member_creation: no step', undefined, basis);
            rememberWaiting('member_creation: no step', basis);
            continue;
          }
          return advancing(null, makePerform(base, suggestion.operation), null, chosenBasis);
        }
        if (suggestion.send === null) return advancing(null, makePerform(base, suggestion.operation), null, chosenBasis);
        if (await readHostSendReceipt(automationContext(owned), suggestion.send) === 'committed') {
          const basis = goalWaitBasisOf(goal, ['suggestion_committed'], ['Session', 'CoreOperation']);
          if (base.taskId !== null) {
            return waiting(null, 'suggestion_committed: the repeated pass performs no step', undefined, basis);
          }
          rememberWaiting('suggestion_committed: the repeated pass performs no step', basis);
          continue;
        }
        return advancing(null, makePerform(base, suggestion.operation), null, chosenBasis);
      }
      const sessionRef: SessionRef = { projectId: owned.projectId, sessionId: chosen.card.record.ref.sessionId };
      const built = await buildClaimOperation(owned, base, goal, graph.plan.ref, task, binding,
        sessionRef.sessionId, chosen.card.record.revision, true, consumedWait);
      if ('rejection' in built) return built.rejection;
      return advancing(null, makePerform({ ...base, sessionHint: sessionRef }, built.operation), null, chosenBasis);
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
    // §5.1.3: a stage/module gate whose required coverage has no unfinished
    // work runs before the goal-wide unfinishedWork gate. `gateCoveredTaskIds`
    // is the one coverage derivation (never `gateFixInProgress`).
    const coveredGate = required.find((task) => task.taskKind === 'gate'
      && task.scope.kind !== 'goal'
      && task.disposition === 'active'
      && unsatisfied(task)
      && !gateCoveredTaskIds(graph.plan.tasks, task)
        .some((taskId) => unfinishedWork.some((work) => work.taskId === taskId))
      && !(base.taskId === null && base.activeTaskIds?.has(task.taskId) === true));
    if (coveredGate !== undefined) {
      return await advanceGate(owned, base, roundWaitBasis, graph, coveredGate);
    }
    // L46 §3.13 item 3: every candidate this pass could start is inside a block → the Goal waits with all bases.
    const candidates = ordered.filter(task => {
      if (task.taskKind !== 'work' || task.disposition !== 'active'
        || task.executionIntent === 'plan_only') return false;
      const row = graph.tasks.find(candidate => candidate.ref.taskId === task.taskId);
      return row !== undefined && row.effectivePhase !== 'satisfied';
    });
    if (blocks.length > 0 && candidates.length > 0 && candidates.every(task => branch.has(task.taskId))) {
      // The block roots stay the Goal's reason; their bases join the common close-out (DR-P4-07).
      return attachRefinement(waiting(null, `l46_blocked: ${blocks.map(block => block.task.taskId).join(', ')}`, undefined,
        mergeWaitBasis([...blocks.map(block => block.wakeBasis), gapWaitBasis()])));
    }
    if (unfinishedWork.length > 0) {
      const gap = describeGap(ordered, graph);
      const gapReason = unfinishedWork.every((task) => task.disposition === 'deferred')
        ? `required_task_deferred: ${gap}` : gap;
      return attachRefinement(waiting(null, collectedReason ?? gapReason, undefined,
        gapWaitBasis()));
    }

    // 3. Only a fully satisfied required ordinary set may produce the gate
    //    evidence from an already-ended ordinary Run (no gate Run is invented).
    // §3.1: a gate a live Run watch is already advancing is skipped like any other Task.
    // §5.1.3: this arm is only the goal gate; stage/module gates were selected above.
    const gateTask = required.find((task) => task.taskKind === 'gate' && task.scope.kind === 'goal'
      && unsatisfied(task));
    if (gateTask !== undefined && !(base.taskId === null && base.activeTaskIds?.has(gateTask.taskId) === true)) {
      return await advanceGate(owned, base, roundWaitBasis, graph, gateTask);
    }

    // 4. Only a fully satisfied required set may propose the formal Goal completion.
    if (required.every((task) => !unsatisfied(task))) {
      return advancing(null, makePerform(base, completeGoalStep(base, owned.projectId, goal, graph.completion)));
    }
    return attachRefinement(waiting(null, collectedReason ?? describeGap(ordered, graph), undefined, gapWaitBasis()));
  }

  /**
   * §6.1.4 / §6.3.1: a candidate's formal Answer becomes the executor M's one
   * reply through P2's associate path. R is the candidate's source message; M is
   * its Query's `repliesToMessageRef` or the chain root found by the one lineage
   * walk. Both the ordinary adoption and the recovery scan read M first: a wait
   * that is closed or already answered is skipped, never overwritten. A
   * rejection passes through.
   */
  async function associateCandidateReply(
    owned: Owned, sourceMessageRef: SessionMessageRef,
  ): Promise<'skipped' | 'responded' | CoreRejection> {
    const mailbox = deps.messages;
    if (mailbox === undefined) {
      return rejection('unsupported', 'the mailbox does not publish readMessage');
    }
    const queries = deps.consultations?.queries;
    if (queries === undefined) {
      return rejection('unsupported', 'the planning Query owner is not wired');
    }
    const lineage = await planSourceLineageOf(owned.ctx,
      { messages: mailbox, queries, plans: deps.plans }, sourceMessageRef);
    if (lineage.status !== 'ready') return readRejection(lineage);
    const query = await queries.readQueryJob(owned.ctx,
      interventionPlanningQueryRefs(sourceMessageRef).queryJobRef);
    if (query.status !== 'ready') return readRejection(query);
    const replyTo = query.value.job.job.intent.execution.repliesToMessageRef
      ?? lineage.value.rootMessage;
    const message = await mailbox.readMessage(owned.ctx, replyTo);
    if (message.status !== 'ready') return readRejection(message);
    if (message.value.response !== null
      || waitStateOf(message.value, waitFactsOfRecord(message.value)).state !== 'open') {
      return 'skipped';
    }
    // §5.6: the closing's associate arm reads only the message and the two closing fields;
    // the planning Query's execution profile is not part of it.
    const answered = await intervention.handleIntervention(owned.ctx, {
      messageRef: sourceMessageRef, completion: 'associate_answer', replyToOriginal: true,
    });
    if (answered.status === 'responded') return 'responded';
    if (answered.status === 'rejected') return answered;
    return rejection('incomplete', `the candidate reply ended ${answered.status}`);
  }

  /** PL §7.1.3: whether the deterministic Host message of one request id already exists. */
  async function hostSendCommitted(
    owned: Owned, ref: SessionMessageRef,
  ): Promise<'sent' | 'unsent' | CoreRejection> {
    if (deps.messages === undefined) {
      return rejection('unsupported', 'the mailbox does not publish readMessage');
    }
    const read = await deps.messages.readMessage(owned.ctx, ref);
    if (read.status === 'ready') return 'sent';
    if (read.status === 'not_found') return 'unsent';
    return readRejection(read);
  }

  /**
   * §5.1.4 + the book's main flow: the plan_only `refine:` round is sent before
   * the deviation path. `selectOrdinary` only sends it at the gap, so an
   * ordinary step can be selected first; this says whether that pending refine is
   * still uncommitted. It predicts no Gate (the book has no covered-Gate
   * exception); the caller skips it when an in-flight candidate suppresses the
   * refine, so the deviation is never starved by a round that cannot go out.
   */
  async function planOnlyRefineUnsent(
    owned: Owned, goal: GoalSnapshot, graph: TaskGraph,
  ): Promise<boolean> {
    const planOnly = planOnlyWait(goal, graph);
    if (planOnly === null) return false;
    const target = planOnlyTargetOf(planOnly);
    const round = refinementRoundOf({ basis: planOnly, goalRef: goal.ref,
      planRevision: graph.plan.planRevision, target: target ?? null });
    if (round === null) return false;
    const requestId = systemRoundRequestId(round);
    if (requestId.status !== 'ready') return false;
    const ref = systemRoundMessageRef({ projectId: owned.projectId, workspaceId: owned.workspaceId }, requestId.value);
    if (ref.status !== 'ready') return false;
    return await hostSendCommitted(owned, ref.value) === 'unsent';
  }

  /**
   * PL §7.1.4/§7.5: after the ordinary selection finds the Goal's gap, the one
   * deviation/reminder selection. Each round is returned through the existing
   * `send_system_round`; the reminder is the ordinary `notify`. The committed
   * Host message is the only dedupe. With no adviser, nothing is sent (the
   * shared `goal_cause/no_adviser` card carries the fact) and selection goes on.
   */
  async function deviationSelection(
    owned: Owned, base: Base, goal: GoalSnapshot, graph: TaskGraph,
  ): Promise<WorkflowAdvanceResult | null> {
    if (deps.readDeviationFacts === undefined) return null;
    const facts = await deps.readDeviationFacts(owned.ctx, goal.ref, graph.tasks);
    if (facts.status !== 'ready') return readRejection(facts);
    const deviations = deviationsOfGoal(facts.value);
    const reminders = taskRemindersOfGoal(facts.value);
    if (deviations.length === 0 && reminders.length === 0) return null;
    if (suggestionDutyRecipient === null) return null;
    for (const deviation of deviations) {
      const requestId = deviationRequestId(deviation);
      // O4b (v4 :5480–:5493): the Run that raised this deviation is the asker, read inside the loop that binds it;
      // only the resolver path needs it. The round keeps `deviationRequestId(deviation)` and the same text.
      let asker: SessionRef | null = null;
      if (deviation.runRef !== null && deps.recipients !== undefined) {
        const run = await deps.executions.readExecution(owned.ctx, deviation.runRef);
        if (run.status !== 'ready') return readRejection(run);
        asker = run.value.run.executionHistory?.sessionRef ?? null;
      }
      const adviser = await adviserOf(owned, goal, asker);
      if ('status' in adviser) return adviser;
      // §7.1.3: no fallback to the Goal's secretary; with no line this deviation writes nothing (the derived card is
      // the exit).
      if (adviser.session === null) continue;
      const ref = systemRoundMessageRef({ projectId: owned.projectId, workspaceId: owned.workspaceId }, requestId);
      if (ref.status !== 'ready') return ref;
      const sent = await hostSendCommitted(owned, ref.value);
      if (typeof sent !== 'string') return sent;
      if (sent === 'sent') continue;
      if (adviser.copy !== null && deps.messages !== undefined) {
        // v4 :5459–:5466 (book :588–:591): one `notify` to the creator, deduped by (source operation, final
        // recipient); a reply still goes to the sender. It goes out before the round, so a sent round has its copy.
        const copyInput: SessionMessageSendInputV1['input'] = { recipient: adviser.copy, intent: 'notify',
          goalRef: goal.ref, text: `请知悉（抄送，不需要回复）：任务 ${deviation.taskRef.taskId} 的偏差已发给负责的参谋（${requestId}）。` };
        const copied = await deps.messages.sendMessage(automationContext(owned), {
          input: copyInput, meta: { requestId: `recipient-copy:${requestId}:${plainSessionRefKey(adviser.copy)}`, expected: [] },
        });
        if (copied.status !== 'committed') return copied;
      }
      const round: SystemRoundV1 = { kind: 'deviation', goalRef: goal.ref,
        taskId: deviation.taskRef.taskId, cause: deviation.kind, planRevision: deviation.planRevision };
      return advancing(null, makePerform(base, { kind: 'send_system_round', request: {
        round, recipient: adviser.session, text: `${requestId}\n${deviationText(deviation, null)}`,
        taskRef: deviation.taskRef,
      } }));
    }
    const reminderAdviser = await adviserOf(owned, goal, null);
    if ('status' in reminderAdviser) return reminderAdviser;
    if (reminderAdviser.session === null) return null;
    for (const reminder of reminders) {
      const requestId = `plan-reminder:${reminder.goalRef.goalId}:${reminder.taskRef.taskId}:${reminder.planRevision}`;
      const input: SessionMessageSendInputV1['input'] = {
        recipient: reminderAdviser.session,
        text: `${requestId}\n提醒（不需要开轮或改计划）：任务 ${reminder.taskRef.taskId} 在计划版本 `
          + `${reminder.planRevision} 的上下文增长量已达 ${reminder.growthTokens} tokens（${reminder.sizeClass} 档）。`,
        intent: 'notify' as const, needsReply: false,
      };
      // PL §7.1 row 3: "already sent" is the sender identity's committed receipt,
      // not a message ref read in the sender's workspace. A reminder delivered
      // to another workspace therefore reads as sent; `undetermined` still sends
      // and the mailbox's identity receipt dedupes it.
      if (await readHostSendReceipt(automationContext(owned), { requestId, arguments: input }) === 'committed') continue;
      return advancing(null, makePerform(base, { kind: 'notify_plan_reminder', request: {
        input,
        meta: { requestId, expected: [] },
      } }));
    }
    return null;
  }

  /** §6.1.4's card/wait exit: the candidate keeps waiting and another branch may still advance. */
  async function candidateWaitAfterCancel(
    owned: Owned, base: Base, goal: GoalSnapshot, proposal: PlanProposal, reason: string,
  ): Promise<WorkflowAdvanceResult> {
    let source: DecisionSourceV1 | undefined;
    if (deps.readCandidateCard !== undefined) {
      const card = await deps.readCandidateCard(goal.ref, proposal.ref);
      if (card.status === 'not_found') return advancing(null, selectWorkStep(base));
      if (card.status !== 'ready') return readRejection(card);
      source = card.value.card.source;
    }
    return await selectNext(owned, base, {
      reason,
      basis: planWaitBasisOf(goal, ['plan_candidate_waiting']),
      ...(source === undefined ? {} : { source }),
    });
  }

  /**
   * PL §7.3.1: before the adopt step of a candidate that replaces the Task of a
   * yielded Run still waiting on the candidate's source chain, read the pointer
   * and the existing cancel intent first. A person's stop comes first; a queued
   * or applied intent already fences the continuation; only a completed
   * `not_found` submits the one fixed identity. The Run pin is the revision this
   * judgment read.
   */
  async function cancelBeforeAdoption(
    owned: Owned, base: Base, goal: GoalSnapshot, graph: TaskGraph, proposal: PlanProposal,
  ): Promise<WorkflowAdvanceResult | null> {
    const source = proposal.sourceMessageRef;
    if (source === null) return null;
    const affected = proposal.reason.affectedTaskIds ?? [];
    const replacedTasks = proposal.draft.tasks.filter(task => task.disposition === 'superseded'
      && task.replacedByTaskId !== undefined && task.replacedByTaskId !== null
      && affected.includes(task.taskId));
    if (replacedTasks.length === 0) return null;
    // Only a Run whose continuation waits on this source chain's root is the
    // one to cancel; another replaced Task (for example one that never ran)
    // must not end the search.
    const yielded: { task: RuntimeTask; run: RunSnapshot }[] = [];
    for (const candidate of replacedTasks) {
      const row = graph.tasks.find(task => task.ref.taskId === candidate.taskId);
      if (row === undefined || row.execution === null) continue;
      const execution = await deps.executions.readExecution(owned.ctx, row.execution);
      if (execution.status !== 'ready') return readRejection(execution);
      const candidateRun = execution.value.run;
      if (candidateRun.outcome !== 'yielded' || candidateRun.continuation === undefined
        || candidateRun.continuation.kind !== 'wait_reply'
        || candidateRun.continuation.task.taskId !== candidate.taskId) continue;
      yielded.push({ task: candidate, run: candidateRun });
    }
    if (yielded.length === 0) return null;
    const mailbox = deps.messages;
    const queries = deps.consultations?.queries;
    if (mailbox === undefined || queries === undefined) {
      return rejection('unsupported', 'the yielded-run cancel needs the mailbox and the planning Query read');
    }
    const lineage = await planSourceLineageOf(owned.ctx,
      { messages: mailbox, queries, plans: deps.plans }, source);
    if (lineage.status !== 'ready') return readRejection(lineage);
    const waiting = yielded.find(entry =>
      sameRef(entry.run.continuation!.messageRef, lineage.value.rootMessage));
    if (waiting === undefined) return null;
    const replaced = waiting.task;
    const run = waiting.run;
    if (run.continuation === undefined) return null;
    const wait = await mailbox.readMessage(owned.ctx, run.continuation.messageRef);
    if (wait.status !== 'ready') return readRejection(wait);
    if (wait.value.response !== null
      || waitStateOf(wait.value, waitFactsOfRecord(wait.value)).state !== 'open') return null;
    const controls = deps.controls;
    if (controls === undefined) return rejection('unsupported', 'the control owner is not installed');
    // §7.3.1 step 2: a person's pause/cancel is never overwritten. A pointer read
    // failure keeps its real exit and submits nothing.
    const pointerRef = run.controlState?.intentRef;
    let pointer: ControlIntentSnapshotV1 | null = null;
    if (pointerRef !== undefined) {
      const pointerRead = await controls.readControl(owned.ctx, pointerRef);
      if (pointerRead.status === 'ready') pointer = pointerRead.value;
      else if (pointerRead.status !== 'not_found') return readRejection(pointerRead);
    }
    if (run.controlState?.desiredState === 'cancelled') return null;
    if (reworkFenceOf(run, pointer) === 'human_only') {
      return await candidateWaitAfterCancel(owned, base, goal, proposal,
        'plan_candidate_waiting: a person stopped this Run; the platform does not cancel it');
    }
    // §7.3.1 step 3: read the one fixed intent before submitting; `not_found` alone submits.
    const step = cancelYieldedWaitStep(base, proposal, run,
      `task ${replaced.taskId} is superseded by plan candidate ${proposal.ref.proposalId}@${proposal.revision}`);
    if (step.kind !== 'cancel_yielded_wait') return rejection('invalid', 'the cancel step kind changed');
    const intent = await controls.readControl(owned.ctx,
      controlIntentRefFor(WORKFLOW_AUTOMATION_ACTOR,
        { projectId: owned.projectId, workspaceId: owned.workspaceId }, step.request.meta.requestId));
    if (intent.status === 'ready') {
      if (intent.value.status === 'queued' || intent.value.status === 'applied') return null;
      return await candidateWaitAfterCancel(owned, base, goal, proposal,
        `plan_candidate_waiting: the cancel intent is ${intent.value.status}`);
    }
    if (intent.status !== 'not_found') return readRejection(intent);
    return advancing(null, makePerform(base, step));
  }

  /** Read-only deterministic first-step selection shared by `select_work`. */
  async function selectNext(owned: Owned, base: Base, adoptWait?: PlanCandidateWait): Promise<WorkflowAdvanceResult> {
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
    // P's trigger (§3.14 item 2): a continued Goal whose first Plan is adopted forwards its copied interventions once,
    // before task selection; the `forwarded:` claim makes a repeat a no-op. A composition without the owner skips the
    // trigger — the original no-trigger behavior.
    const forward = deps.copyForwarding;
    if (goal.continuedFrom !== null && forward !== undefined) {
      const forwarded = await forward(owned.ctx, { goalRef: goal.ref });
      if (forwarded !== null) return forwarded;
      // L39: a source line that was reused or archived leaves the copy without an adviser, so the queue's one entry
      // resolves it once; a copy that already has one (L-8 (i), `goal_has_adviser`) goes on to the selection.
      if (deps.goalAdviserQueue !== undefined) {
        const allocated = await deps.goalAdviserQueue.allocate(automationContext(owned), {
          commandId: `goal-queue:${goal.ref.goalId}`, goalRef: goal.ref,
        });
        if (allocated.status !== 'committed'
          && !(allocated.code === 'revision_conflict' && allocated.reason === 'goal_has_adviser')) {
          return waiting(null, 'goal_queue: the allocation did not commit');
        }
      }
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
    // §6.1.2 step 3b / step 3: the Goal loop reads this Goal's planning
    // questions and latest agent candidate before the ordinary selection. A
    // candidate's card/wait row never blocks the other branches: it only
    // remembers its basis and lets the same pass continue selecting.
    let candidateWait: PlanCandidateWait | null = adoptWait ?? null;
    if (base.taskId === null && adoptWait === undefined) {
      if (deps.planCandidates === undefined) {
        return rejection('unsupported', 'planCandidates is not wired');
      }
      const candidates = await deps.planCandidates(
        { projectId: owned.projectId, workspaceId: owned.workspaceId }, owned.ctx, base.goalRef);
      if (candidates.status !== 'ready') return readRejection(candidates);
      for (const entry of candidates.value.goals) {
        for (const group of entry.questionGroups) {
          // §6.1.2 step 3b: every question answered and no `planresume:` yet.
          if (!group.allAnswered || group.resumeMessageExists) continue;
          const round: SystemRoundV1 = {
            kind: 'planresume', goalRef: goal.ref,
            queryJobId: group.queryJobRef.queryJobId, originalMessageRef: group.originalMessageRef,
          };
          const requestId = systemRoundRequestId(round);
          if (requestId.status !== 'ready') return requestId;
          if (deps.messages === undefined) {
            return rejection('unsupported', 'the mailbox does not publish readMessage');
          }
          const original = await deps.messages.readMessage(owned.ctx, group.originalMessageRef);
          if (original.status !== 'ready') return readRejection(original);
          const recipient = original.value.recipient as SessionRef;
          return advancing(null, makePerform(base, { kind: 'send_system_round', request: {
            round, recipient, text: requestId.value, followupOf: group.originalMessageRef,
          } }), null, null, planWaitBasisOf(goal, ['plan_resume_pending']));
        }
      }
      // §6.1.2 step 3 / §7.3.1: a crash after adoption can leave the candidate's
      // executor M unanswered. Every accepted candidate is read back; only an M
      // still open with no reply gets the same association. This pass never
      // adopts, proposes, builds a Query or re-sends.
      if (deps.acceptedCandidatesOf === undefined) {
        return rejection('unsupported', 'acceptedCandidatesOf is not wired');
      }
      const accepted = await deps.acceptedCandidatesOf(goal.ref);
      if (accepted.status !== 'ready') return readRejection(accepted);
      for (const acceptedProposal of accepted.value) {
        if (acceptedProposal.sourceMessageRef === null) continue;
        const associated = await associateCandidateReply(owned, acceptedProposal.sourceMessageRef);
        if (typeof associated !== 'string') return readRejection(associated);
        // The candidate wait stays with the pass: an ordinary step still wins, and
        // only a pass with no step waits on the merged basis.
        if (associated === 'responded') {
          candidateWait = {
            reason: 'plan_candidate_waiting: the accepted candidate reply',
            basis: planWaitBasisOf(goal, ['plan_candidate_waiting']),
          };
        }
      }
      if (deps.latestAgentCandidate === undefined) {
        return rejection('unsupported', 'latestAgentCandidate is not wired');
      }
      const latest = await deps.latestAgentCandidate(goal.ref);
      if (latest.status !== 'ready') return readRejection(latest);
      if (latest.value !== null) {
        const candidateBasis = (reason: string): GoalWaitBasisV1 => planWaitBasisOf(goal, [reason]);
        /** `null` keeps the ordinary selection going (card/wait/not_found). */
        const planCandidateWaitStep = async (proposal: PlanProposal): Promise<WorkflowAdvanceResult | null> => {
          if (deps.readCandidateCard === undefined) {
            return rejection('unsupported', 'readCandidateCard is not wired');
          }
          const cardRead = await deps.readCandidateCard(goal.ref, proposal.ref);
          // The candidate is gone (replaced or adopted): it is not a card, and
          // the same pass continues selecting; the next pass re-reads it.
          if (cardRead.status === 'not_found') return null;
          if (cardRead.status !== 'ready') return readRejection(cardRead);
          if (cardRead.value.exactReview.status !== 'ready') return readRejection(cardRead.value.exactReview);
          const review = cardRead.value.exactReview.value;
          if (deps.completedFixes === undefined) {
            return rejection('unsupported', 'completedFixes is not wired');
          }
          const fixes = await deps.completedFixes(goal.ref, proposal.basedOn);
          if (fixes.status !== 'ready') return readRejection(fixes);
          let fix = null;
          if (review.status === 'decided' && review.verdict === 'fix' && fixes.value < 3) {
            if (deps.planFixRead === undefined) return rejection('unsupported', 'planFixRead is not wired');
            const fixRead = await deps.planFixRead(goal.ref, proposal.ref, proposal.revision);
            if (fixRead.status !== 'ready') return readRejection(fixRead);
            fix = fixRead.value;
          }
          // §6.3.1: the review line is the existing duty recipient resolver;
          // a missing resolver is an unwired narrow double, not "no line".
          if (suggestionDutyRecipient === null) {
            return rejection('unsupported', 'the Session duty resolver is not wired');
          }
          const reviewerRead = await suggestionDutyRecipient.resolveDutyRecipient(automationContext(owned), {
            workspace: { projectId: owned.projectId, workspaceId: owned.workspaceId }, duty: 'reviewer',
          });
          if (reviewerRead.status !== 'ready') return readRejection(reviewerRead);
          const reviewer = reviewerRead.value;
          let source: PlanCandidateSourceV1 = 'agent_proposal';
          if (proposal.sourceMessageRef !== null) {
            if (deps.messages === undefined) {
              return rejection('unsupported', 'the mailbox does not publish readMessageBody');
            }
            const body = await deps.messages.readMessageBody(owned.ctx,
              { messageRef: proposal.sourceMessageRef, part: 'message' });
            if (body.status !== 'ready') return readRejection(body);
            const head = systemRoundOfText(body.value.text);
            source = head === null ? 'other'
              : head.kind === 'refine' ? 'refine'
                : head.kind === 'planfix' ? 'fix'
                  : head.kind === 'planresume' ? 'planresume' : 'other';
          }
          const diagnosis = cardRead.value.diagnosis;
          const diagnosisText = diagnosis === null ? '检查覆盖读不到'
            : diagnosis.length === 0 ? '无'
              : diagnosis.map(finding => `${finding.obligationId}/${finding.requirementId}: ${finding.message}`).join('\n');
          const findingsText = review.status === 'decided' && review.findings.length > 0
            ? review.findings.map(finding => `${finding.taskId ?? '计划级'}: ${finding.text}`).join('\n') : '无';
          const decision = decidePlanCandidate({
            proposal: {
              ref: proposal.ref, revision: proposal.revision, basedOn: proposal.basedOn,
              source, affectedTaskIds: proposal.reason.affectedTaskIds ?? [],
            },
            review,
            fix,
            completedFixes: fixes.value,
            adoptionPolicy: decisionActionPolicy({
              autonomy: goal.settings.autonomy, action: 'refine_future', actorClass: 'system',
              countedNext: null, cap: 0,
            }),
            hasReviewLine: reviewer !== null,
            diagnosis,
          } satisfies PlanCandidateFactsV1);
          if (decision.action === 'request_review') {
            const round: SystemRoundV1 = {
              kind: 'planreview', goalRef: goal.ref,
              proposalId: proposal.ref.proposalId, proposalRevision: proposal.revision,
            };
            return advancing(null, makePerform(base, { kind: 'send_system_round', request: {
              round, recipient: reviewer as SessionRef,
              text: `${decision.requestId}\n审这一版计划候选；结论只能是 pass 或 fix。\n机械诊断：${diagnosisText}\n请用 submit_plan_review 填结论。`,
            } }), null, null, candidateBasis('plan_review_pending'));
          }
          if (decision.action === 'request_fix') {
            const adviser = await adviserOf(owned, goal, null);
            if ('status' in adviser) return adviser;
            if (adviser.session === null) {
              // §6.1.4 line 1139: no adviser line -> the candidate is a card, never a send.
              candidateWait = { reason: 'review_fix: the Goal has no adviser line',
                basis: candidateBasis('plan_candidate_waiting:review_fix'), source: cardRead.value.card.source };
              return null;
            }
            const round: SystemRoundV1 = {
              kind: 'planfix', goalRef: goal.ref,
              proposalId: proposal.ref.proposalId, proposalRevision: proposal.revision,
            };
            return advancing(null, makePerform(base, { kind: 'send_system_round', request: {
              round, recipient: adviser.session,
              text: `${decision.requestId}\n按审阅意见改这一版候选；返修上限 3。\n审阅意见：${findingsText}\n机械诊断：${diagnosisText}\n答案用 submit_plan_round 填。`,
            } }), null, null, candidateBasis('plan_fix_pending'));
          }
          if (decision.action === 'adopt') {
            // §7.3.1: a candidate that replaces a yielded Run's waiting Task
            // fences that continuation first; only then may the adoption apply.
            const cancelled = await cancelBeforeAdoption(owned, base, goal, graph, proposal);
            if (cancelled !== null) return cancelled;
            // §6.1.4: the fixed request id makes a retry the original adoption.
            return advancing(null, makePerform(base, { kind: 'adopt_plan', request: {
              input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] },
              meta: {
                requestId: `plan-adopt:${proposal.ref.proposalId}:${proposal.revision}`,
                expected: [
                  { ref: goal.ref, revision: goal.revision },
                  { ref: proposal.ref, revision: proposal.revision },
                ],
              },
            } }));
          }
          if (decision.action === 'wait') {
            const label = decision.reason === 'busy' ? 'plan_adoption_busy'
              : decision.reason === 'review' ? 'plan_review_pending' : 'plan_fix_sent';
            candidateWait = { reason: `${label}: the plan candidate is ${decision.reason}`,
              basis: candidateBasis(label), inFlight: true };
            return null;
          }
          candidateWait = { reason: `plan_candidate_waiting: ${decision.reason}`,
            basis: candidateBasis('plan_candidate_waiting'), source: cardRead.value.card.source };
          return null;
        };
        const candidateResult = await planCandidateWaitStep(latest.value);
        if (candidateResult !== null) return candidateResult;
      }
    }
    const selected = await selectOrdinary(owned, base, config, goal, graph, candidateWait);
    const withCandidateSource = (result: WorkflowAdvanceResult): WorkflowAdvanceResult =>
      result.status === 'ready' && candidateWait?.source !== undefined
        ? { ...result, value: { ...result.value, source: candidateWait.source } }
        : result;
    // PL §7.1.4/§7.5: the deviation/reminder line is selected from the ordinary
    // selection's result, so a waiting candidate no longer hides a due deviation.
    // The shared close-out's refine stays first (the book's main flow), an
    // `adoptWait` candidate pass keeps its own order, and a completion, a
    // rejection or an explicit Task selection returns as it is.
    if (selected.status !== 'ready') return withCandidateSource(selected);
    const next = selected.value.next;
    const refineAdvance = selected.value.state === 'advance' && next !== null && next.kind === 'perform'
      && next.operation.kind === 'send_system_round' && next.operation.request.round.kind === 'refine';
    if (selected.value.state === 'completed' || refineAdvance
      || base.taskId !== null || adoptWait !== undefined) return withCandidateSource(selected);
    // The book's main flow sends a pending plan_only `refine:` before the
    // deviation path. Only a ready ordinary step can defer it: when the ordinary
    // selection is already waiting (a stopped Gate, or a candidate whose
    // in-flight refine cannot go out), the deviation must still be reachable.
    if (selected.value.state === 'advance' && candidateWait?.inFlight !== true
      && await planOnlyRefineUnsent(owned, goal, graph)) {
      return withCandidateSource(selected);
    }
    const deviation = await deviationSelection(owned, base, goal, graph);
    if (deviation === null) return withCandidateSource(selected);
    if (deviation.status !== 'ready') return deviation;
    // The deviation replaces the selection but keeps the basis the ordinary
    // selection had already merged (candidate, plan_only and the real block).
    const waitBasis = selected.value.waitBasis;
    return waitBasis === undefined ? deviation : { ...deviation, value: { ...deviation.value, waitBasis } };
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

  /** PL §7.1 row 3 / §3.4: the one ordinary Host `sendMessage` body shared by
   * `suggest_member` and the reminder's `notify_plan_reminder`. */
  async function sendOrdinaryMessage(
    owned: Owned, request: Parameters<NonNullable<WorkflowDependencies['messages']>['sendMessage']>[1],
  ): Promise<Awaited<ReturnType<NonNullable<WorkflowDependencies['messages']>['sendMessage']>>> {
    if (deps.messages === undefined) {
      return rejection('unsupported', 'the mailbox does not publish sendMessage');
    }
    return await deps.messages.sendMessage(automationContext(owned), request);
  }

  async function performStep(owned: Owned, base: Base, operation: WorkflowOperation,
    claimRetried = false): Promise<WorkflowAdvanceResult> {
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
        if (result.status !== 'committed' && result.code === 'revision_conflict') {
          // A record the claim pins moved after the selection read it (a link or a transfer of the Session, a Goal
          // or Workspace write): select once more on what is there now. A second conflict waits on any record kind a
          // claim pins, which the Host's wait registry wakes this Goal on (the moving write may predate this step's
          // read cursor, so only the re-selection sees the first one).
          if (claimRetried) {
            return waiting(receipt, result.reason, undefined,
              goalWaitBasisOf({ ref: base.goalRef }, ['claim_conflict'], CLAIM_CONFLICT_WAIT_KINDS));
          }
          const again = await selectNext(owned, base);
          const next = again.status === 'ready' ? again.value.next : null;
          if (next === null || next.kind !== 'perform' || next.operation.kind !== 'claim_task') return again;
          return await performStep(owned, { ...base, sessionHint: next.sessionHint }, next.operation, true);
        }
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
        if (result.status === 'rejected' && result.code === 'busy' && result.reason === 'running_cap') {
          return waiting(receipt, 'running_cap');               // the Run stays starting; no afterNotNormalEnd
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
        if (next === 'review') return await reviewArm(owned, base, result.value, receipt);
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
        if (next === 'review') return await reviewArm(owned, base, result.value, receipt);
        return advancing(receipt, next);
      }
      // Slice 9 VR-16: the one booking call. A booked (or replayed) review finalizes with its ref; an ended Query
      // without an answer that parses finalizes without one (the fold writes `reviewer_missing`); the review's own
      // refusals are returned as they are; a finalized round goes back to the selection; anything else waits.
      case 'record_review': {
        const owner = deps.evidence.recordReviewEvidence;
        if (owner === undefined) return rejection('unsupported', 'the evidence owner does not publish recordReviewEvidence');
        const result = await owner(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'record_review', result };
        const noAnswer = result.status === 'rejected' && result.code === 'invalid' && result.reason === NO_ACCEPTED_ANSWER;
        if (result.status === 'rejected' && !noAnswer && REVIEW_BOOKING_REFUSALS.has(result.code)) return result;
        if (result.status === 'rejected' && !noAnswer && result.code !== 'busy') return waiting(receipt, result.reason);
        const read = await deps.evidence.readVerification(owned.ctx, operation.request.input.roundRef);
        if (read.status !== 'ready') return waiting(receipt, receiptReason(read, 'the round could not be read for its finalize'));
        if (read.value.status === 'finalized') return advancing(receipt, selectWorkStep(base));
        if (result.status === 'rejected' && !noAnswer) return waiting(receipt, result.reason);
        return advancing(receipt, finalizeChecksStep(base, read.value,
          result.status === 'committed' ? [result.value.evidenceRef] : undefined));
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
        await deps.repairs?.attemptRepairsForGoal(owned.ctx, { goalRef: base.goalRef });
        await handOverRepairAnswers(owned, base);
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
        // The request card is an agent answer; the automation step never gets one, so the result is narrowed here.
        const result = (await requeue.call(deps.claims, automationContext(owned), operation.request)) as EffectWriteResultV1<TaskRequeueOutcomeV1>;
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
        // The request card is an agent answer; the automation step never gets one, so the result is narrowed here.
        const result = (await reverify.call(deps.evidence, automationContext(owned), operation.request)) as EffectWriteResultV1<ReverifyOutcomeV1>;
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
      case 'cancel_yielded_wait': {
        const controls = deps.controls;
        if (controls === undefined) return rejection('unsupported', 'the control owner is not installed');
        // PL §7.3.1: the same automation actor and the fixed identity; a queued
        // intent already fences the yielded continuation, so the next selection
        // may adopt. A conflict goes back to the selection, which re-reads the
        // same intent and the fresh Run pin.
        const result = await controls.submitControl(automationContext(owned), operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'cancel_yielded_wait', result };
        if (result.status === 'committed' || result.code === 'revision_conflict') {
          return advancing(receipt, selectWorkStep(base));
        }
        // §7.3.1 step 6: a cancel that did not commit never adopts. The
        // candidate stays a card; this pass continues ordinary selection and
        // never retries a second cancel identity.
        const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
        if (goalRead.status !== 'ready') return readRejection(goalRead);
        return await selectNext(owned, base, {
          reason: `cancel_rejected: ${result.code}: ${result.reason}`,
          basis: planWaitBasisOf(goalRead.value.goal, ['plan_candidate_waiting']),
        });
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
      case 'suggest_member': {
        const result = await sendOrdinaryMessage(owned, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'suggest_member', result };
        if (result.status !== 'committed') {
          return waiting(receipt, receiptReason(result, 'the suggestion message was not sent'));
        }
        return advancing(receipt, selectWorkStep(base));
      }
      case 'notify_plan_reminder': {
        // PL §7.1 row 3: an ordinary `notify` to the adviser; it opens no Query
        // and asks for no reply. The committed message is the one dedupe.
        const result = await sendOrdinaryMessage(owned, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'notify_plan_reminder', result };
        if (result.status !== 'committed') {
          return waiting(receipt, receiptReason(result, 'the plan reminder was not sent'));
        }
        return advancing(receipt, selectWorkStep(base));
      }
      case 'host_pick_member': {
        if (deps.members === undefined) {
          return rejection('unsupported', 'the member service does not publish requestMember');
        }
        const result = await deps.members.requestMember(automationContext(owned), operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'host_pick_member', result };
        // The card is committed: return to the selection, where the member block's own source/basis waits.
        if (result.status === 'needs_decision') return advancing(receipt, selectWorkStep(base));
        if (result.status === 'rejected') return waiting(receipt, `host_pick: ${result.reason}`);
        if (result.status === 'pending') return waiting(receipt, 'the member creation child is pending');
        return advancing(receipt, selectWorkStep(base));
      }
      case 'open_overlap_gate': {
        if (deps.overlap === undefined) {
          return rejection('unsupported', 'the overlap gate owner does not publish openOverlapGate');
        }
        const result = await deps.overlap.openOverlapGate(automationContext(owned), operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'open_overlap_gate', result };
        // `overlap.open` also records the one note request; a refusal waits with its own code and keeps the receipt.
        if (result.status !== 'opened') return waiting(receipt, receiptReason(result, 'the overlap gate did not open'));
        return advancing(receipt, selectWorkStep(base));
      }
      case 'request_overlap_note': {
        if (deps.overlap === undefined) {
          return rejection('unsupported', 'the overlap gate owner does not publish requestOverlapNote');
        }
        const result = await deps.overlap.requestOverlapNote(automationContext(owned), operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'request_overlap_note', result };
        if (result.status === 'sent' || result.status === 'none') return advancing(receipt, selectWorkStep(base));
        if (result.status === 'rejected') {
          return waiting(receipt, receiptReason(result, 'the overlap note request was not sent'));
        }
        // `unavailable` is not committed: the gate keeps waiting for a person's release.
        return waiting(receipt, `the overlap note request was ${result.status}; the gate waits for a person's release`);
      }
      case 'send_system_round': {
        if (deps.send === undefined) {
          return rejection('unsupported', 'the system-round send is not wired');
        }
        // §5.2.5: the one sender identity; the mailbox replays a repeated request id.
        const result = await deps.send(
          systemRoundContext({ projectId: owned.projectId, workspaceId: owned.workspaceId }, owned.ctx.signal),
          operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'send_system_round', result };
        if (result.status === 'rejected') {
          const round = operation.request.round;
          if (round.kind === 'planreview' || round.kind === 'planfix') {
            // §5.2.5's send-rejection exit: the review/fix round turns the
            // candidate into its card, keeps the full send receipt, and never
            // blocks the other branches — only a pass with no step waits.
            if (deps.readCandidateCard === undefined) {
              return rejection('unsupported', 'readCandidateCard is not wired');
            }
            const goalRead = await deps.plans.queryGoal(owned.ctx, round.goalRef);
            if (goalRead.status !== 'ready') return readRejection(goalRead);
            const cardRead = await deps.readCandidateCard(round.goalRef, {
              aggregateType: 'PlanProposal', projectId: owned.projectId,
              workspaceId: owned.workspaceId, proposalId: round.proposalId,
            });
            if (cardRead.status !== 'ready') return readRejection(cardRead);
            const selected = await selectNext(owned, base, {
              reason: `review_fix:${result.code}:${result.reason}`,
              basis: planWaitBasisOf(goalRead.value.goal, ['plan_candidate_waiting:review_fix']),
              source: cardRead.value.card.source,
            });
            if (selected.status !== 'ready') return selected;
            return { ...selected, value: { ...selected.value, receipt } };
          }
          // Slice 9 §3.3: a refused review send (the line archived, busy or unreadable, a scope refusal) waits on the
          // line facts; only a malformed request is returned. It writes no Evidence and finalizes nothing.
          if (round.kind === 'exec_review' && result.code !== 'invalid') {
            return waiting(receipt, `${result.code}: ${result.reason}`, undefined,
              reviewWaitBasisOf(round.goalRef, 'exec_review_send_refused'));
          }
          return result;
        }
        // `committed`/`replayed` and `skipped` both mean this round is already
        // sent: continue the ordinary selection, which reads the same
        // deterministic message/Query, and never re-perform this send step.
        return advancing(receipt, selectWorkStep(base));
      }
      case 'adopt_plan': {
        // §6.1.4: the request carries the fixed request id and the two expected pins.
        const result = await deps.plans.applyPlanChange(automationContext(owned), operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'adopt_plan', result };
        if (result.status === 'committed') {
          // §6.1.4 line 1131 / §7.3.1 step 5: the committed candidate's formal
          // Answer becomes the executor M's one reply before the same selection.
          const committedProposal = await deps.plans.readPlanProposal(
            owned.ctx, operation.request.input.proposalRef);
          if (committedProposal.status !== 'ready') return readRejection(committedProposal);
          if (committedProposal.value.sourceMessageRef !== null) {
            const associated = await associateCandidateReply(
              owned, committedProposal.value.sourceMessageRef);
            if (typeof associated !== 'string') return readRejection(associated);
          }
          return advancing(receipt, selectWorkStep(base));
        }
        const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
        if (goalRead.status !== 'ready') return readRejection(goalRead);
        const goal = goalRead.value.goal;
        if (result.code === 'busy') {
          // §6.1.4: keep the candidate and retry on the related Run/wait facts.
          return await selectNext(owned, base, {
            reason: 'plan_adoption_busy: the plan adoption is busy',
            basis: planWaitBasisOf(goal, ['plan_adoption_busy']),
            inFlight: true,
          });
        }
        if (result.code === 'not_found') return advancing(receipt, selectWorkStep(base));
        // §6.1.4 line 1131: a candidate whose basedOn is no longer the active
        // plan is gone, not rejected; re-select and let the loop re-read it.
        const proposalRead = await deps.plans.readPlanProposal(owned.ctx, operation.request.input.proposalRef);
        if (proposalRead.status === 'not_found') return advancing(receipt, selectWorkStep(base));
        if (proposalRead.status !== 'ready') return readRejection(proposalRead);
        const candidateGone = goal.activePlanRevision === null || proposalRead.value.basedOn === null
          || !sameRef(proposalRead.value.basedOn, goal.activePlanRevision);
        if (candidateGone) return advancing(receipt, selectWorkStep(base));
        // §6.1.4 line 1130: every other refusal turns the candidate into its card.
        const cardRead = await deps.readCandidateCard!(goal.ref, operation.request.input.proposalRef);
        if (cardRead.status !== 'ready') return readRejection(cardRead);
        return await selectNext(owned, base, {
          reason: `adoption_rejected: ${result.code}: ${result.reason}`,
          basis: planWaitBasisOf(goal, ['plan_candidate_waiting:adoption_rejected']),
          source: cardRead.value.card.source,
        });
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
        && kind !== 'message_release' && kind !== 'repair_approval') continue;
      const handedRaw = handed as unknown as Record<string, unknown>;
      // A `message_release` or `repair_approval` card carries neither a `reviewRef` nor a `requestRef`: `failedCardRefOf`
      // (:406) and `addFailedCardRef` (:415) stay the two review kinds' and are not reached for it (no failed card exists).
      const cardRef = kind === 'message_release' || kind === 'repair_approval' ? null
        : kind === 'unknown_call_review' ? handedRaw['reviewRef'] : handedRaw['requestRef'];
      if (cardRef === undefined) {
        hardFailure = true;
        if (failure === null) failure = 'invalid: a handed-over answer has no card ref of its source kind';
        continue;
      }
      const card = kind === 'message_release' || kind === 'repair_approval' ? null : failedCardRefOf(kind, cardRef);
      if (kind !== 'message_release' && kind !== 'repair_approval' && card === null) {
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

  async function handOverRepairAnswers(owned: Owned, base: Base): Promise<void> {
    const answers = await deps.repairAnswers?.(owned.ctx, { goalRef: base.goalRef });
    if (answers === undefined || answers.length === 0) return;
    await applyHandedOverAnswers(owned, base, answers);
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
    ...(deps.consultationFacts === undefined ? {} : { consultationFacts: deps.consultationFacts }),
  });
  const intervention = createInterventionHandler({ workflow: deps, claimIntervention });
  const consumeConsultation = async (ctx: CoreCallContext, input: ConsultationInput): Promise<ConsultationResult> => {
    if (consultation === null) {
      return rejection('unsupported', 'the Workflow has no consultation mailbox/Query/Project dependency');
    }
    return consultation(ctx, input);
  };
  // The person's one ask entry composes the same saved message and the same
  // consultation consumer; without the mailbox or the consumer it stays
  // explicitly unsupported, never a second copy/Query path.
  const askLine = deps.messages === undefined || consultation === null ? null
    : createLineAsk({ sessions: deps.sessions, messages: deps.messages, consult: consultation });
  const askLineEntry = async (ctx: CoreCallContext, input: LineAskCommandV1): Promise<LineAskResultV1> => {
    if (askLine === null) {
      return rejection('unsupported', 'the Workflow has no consultation mailbox/Query/Project dependency');
    }
    return askLine(ctx, input);
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
    handleGoalInput, advanceWork, consumeConsultation, askLine: askLineEntry, resolveDecision, orderGoalAdvances,
    backfillRecentActivity, backfillActivityRange,
    handleIntervention: intervention.handleIntervention,
    readDeliveryEligibilityFacts,
    // S1: one ended request round becomes this request's candidate; without the
    // request-candidate dependency the entry answers "unsupported" and writes nothing.
    proposeFromPlanTurn: (ctx, turn) => proposeFromPlanTurn(deps, ctx, turn),
    // Slice 1 §4.1/§4.2: the real archive/maintenance services are published
    // on the port; an outer `ready` never implies archived.
    archiveLine: archiveService.archiveLine,
    continueArchiveLine: archiveService.continueArchiveLine,
    maintainSessions: maintenanceService.maintainSessions,
    ...(sessionHandoff === undefined ? {} : { sessionHandoff }),
  };
}
