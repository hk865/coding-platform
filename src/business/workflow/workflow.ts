import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreError, CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { SessionRef, VersionPin } from '../../contracts/core/identity.js';
import type { SessionProvenanceV1, SessionRecord } from '../../contracts/core/session.js';
import type { RunRef, RunSnapshot, TaskBudgetV1, TaskTriple } from '../../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot, WorkspaceRef } from '../../contracts/ledger.js';
import type { PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask, TaskScope } from '../../contracts/plan.js';
import { revisionAssignments } from '../../contracts/plan.js';
import type { TaskReductionRef } from '../../contracts/reduction.js';
import type { GoalPhaseRef } from '../../contracts/goal-phase.js';
import type { RoundSnapshot } from '../../contracts/verification.js';
import type { PreparedTaskExecution } from '../../contracts/core/prepared-execution.js';
import type { ConsumedWaitV1 } from '../../contracts/dispatch.js';
import type { TaskAutomationStopReason, TaskAutomationVerdictV1, TaskFailureFactsV1 } from '../../contracts/task-failure.js';
import {
  WORKFLOW_AUTOMATION_ACTOR, type ReworkFailureClass, type TaskRequeueRef, type TaskReworkRefusalRef,
} from '../../contracts/task-requeue.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import { DEFAULT_GOAL_SETTINGS_V1, decisionSourceKey } from '../../contracts/goal-decisions.js';
import type { CreateSessionRequest } from '../../core/agent-runtime/session-operations.js';
import type { PrepareTaskExecutionRequest, StartTaskExecutionRequest } from '../../core/agent-runtime/execution-contracts.js';
import type { ClaimTaskInput, RequeueTaskInput } from '../../core/work-graph/model/claim-contracts.js';
import type { TaskGraph, TaskRow } from '../../core/work-graph/model/plan-contracts.js';
import type { GraphWrite } from '../../core/work-graph/model/task-contracts.js';
import type { GoalDecisionCauseReadV1 } from '../../core/work-graph/model/decision-contracts.js';
import type { SessionCard } from '../../core/work-graph/model/session-contracts.js';
import { runUnresolvedBlocker } from '../../core/work-graph/state/run-machine.js';
import { automationConfirmationCause } from '../../core/work-graph/state/decision-policy.js';
import {
  beginRefusalIsPermanent, displayRoundStatus, reverifyExemptionOfFacts, successorAutoCount,
} from '../../core/work-graph/state/verification-machine.js';
import type { ReverifyRoundInput } from '../../core/work-graph/model/evidence-contracts.js';
import type { ConsultationInput, ConsultationResult, InitialPlanningGoalInput, InitialPlanningGoalInputResult, N0GoalInput, ResolveDecisionInputV1, ResolveDecisionReadV1, WorkflowAdvanceInput, WorkflowAdvanceResult, WorkflowCalls, WorkflowOperation, WorkflowSessionRequeue, WorkflowStepReceipt } from './contracts.js';
import type { WorkflowDependencies, WorkflowHostConfiguration, WorkflowPort } from './ports.js';
import { createConsultationConsumer } from './consultation.js';
import { orderTasksByDependency } from './task-order.js';
import { createSessionArchiveService } from './session-archive.js';
import type { InternalSessionArchivePort, SessionArchivePort } from './session-archive.js';
import type { RequestSessionArchiveInput } from '../../contracts/core/session-archive.js';
import { createSessionMaintenanceService } from './session-maintenance.js';
import { createDecisionActions, type DecisionActionsPort } from './decision-actions.js';
import { createActivityBackfill } from './activity-backfill.js';
import type { ActivityBackfillBatchV1 } from './contracts.js';

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
type Binding = WorkflowHostConfiguration['bindings'][number];

export type Owned = {
  ctx: CoreCallContext;
  projectId: string;
  workspaceId: string;
  actor: Actor;
};

type Base = {
  goalRef: GoalRef;
  flowId: string;
  sessionHint: SessionRef | null;
  actor: Actor;
  /** Explicit `select_work` Task selection; null keeps the default selection. */
  taskId: string | null;
};

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function rejection(code: CoreError, reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function sameCanonical(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); } catch { return false; }
}
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

function graphWrite<T>(base: Base, kind: WorkflowOperation['kind'], input: T, expected: readonly VersionPin[]): GraphWrite<T> {
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
function prepareStep(base: Base, runRef: RunRef): PrepareTaskExecutionRequest {
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
): WorkflowOperation {
  const expected: VersionPin[] = [];
  // A Session for a requeued Task is a new request: its identity names the requeue.
  const requestWithoutRequestId = {
    workspace: value.workspace, role: value.role, recommendedRefs: value.recommendedRefs,
    initialLinks: value.initialLinks, meta: { expected },
    ...(value.provenance === undefined ? {} : { provenance: value.provenance }),
    ...(requeue === undefined ? {} : { requeueRef: requeue.requeueRef }),
  };
  const requestId = requestIdFor(base, 'create_session', requestWithoutRequestId);
  return { kind: 'create_session', request: { ...value, meta: { requestId, expected } }, taskRef, planRef,
    ...(requeue === undefined ? {} : { requeue }) };
}
/**
 * K slice (L7, KA2/KA3): the one close step a `kernel_turn_open` Work line gets
 * before its requeue claim. The request is exactly the Runtime's
 * `{ sessionRef, afterRunRef, requeueRef }`; the continuation context the
 * definite-failure fallback needs (`create_session{requeue}` + E15) is carried
 * like `create_session`'s own.
 */
function closeOpenTurnStep(
  sessionRef: SessionRef, afterRunRef: RunRef, requeueRef: TaskRequeueRef,
  taskRef: TaskTriple, planRef: PlanRevisionRef, requeue: WorkflowSessionRequeue,
): WorkflowOperation {
  return { kind: 'close_open_turn', request: { sessionRef, afterRunRef, requeueRef }, taskRef, planRef, requeue };
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
function requeueTaskStep(
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
function reverifyRoundStep(
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
      return 'a person decides';
  }
}
/** The chain head the failure facts read (a work Task's selected Run, or a gate's own) is finalized and not a clean PASS. */
function headFinalizedNonPass(row: TaskRow): boolean {
  const head = row.failure?.round;
  return head !== undefined && head !== null && head.status === 'finalized' && (head.outcome !== 'PASS' || head.gapCodes.length > 0);
}
function makePerform(base: Base, operation: WorkflowOperation): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: base.goalRef, flowId: base.flowId, sessionHint: base.sessionHint, kind: 'perform', operation,
    // An explicit Task selection is preserved across every successor request.
    ...(base.taskId === null ? {} : { taskId: base.taskId }) };
}
/** Back to the read-only selection, keeping the flow, the Session hint and an explicit Task selection. */
function selectWorkStep(base: Base): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: base.goalRef, flowId: base.flowId, sessionHint: base.sessionHint, kind: 'select_work',
    ...(base.taskId === null ? {} : { taskId: base.taskId }) };
}

type WorkflowAdvanceValue = {
  state: 'advance' | 'waiting' | 'completed';
  receipt: WorkflowStepReceipt | null;
  next: WorkflowAdvanceInput | null;
  reason: string | null;
  /**
   * Slice 5 §4.5: an automatic refine/requeue/reverify step gated by the Goal's
   * current settings carries the formally derived cause. Part 1 only plumbs the
   * field through the result type; no selection behaviour changes yet.
   */
  decisionCause?: GoalDecisionCauseReadV1 | null;
};
function readyValue(value: WorkflowAdvanceValue): WorkflowAdvanceResult {
  return { status: 'ready', value };
}
function advancing(receipt: WorkflowStepReceipt | null, next: WorkflowAdvanceInput): WorkflowAdvanceResult {
  return readyValue({ state: 'advance', receipt, next, reason: null });
}
function waiting(receipt: WorkflowStepReceipt | null, reason: string): WorkflowAdvanceResult {
  return readyValue({ state: 'waiting', receipt, next: null, reason });
}
function completed(receipt: WorkflowStepReceipt | null, reason: string): WorkflowAdvanceResult {
  return readyValue({ state: 'completed', receipt, next: null, reason });
}

function readRejection(result: { status: 'not_found' } | { status: 'not_ready' } | CoreRejection): CoreRejection {
  if (result.status === 'rejected') return result;
  if (result.status === 'not_found') return rejection('not_found', 'the requested fact does not exist');
  return rejection('incomplete', 'the requested read is not ready at the required watermark');
}
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

function baseFromInput(input: WorkflowAdvanceInput, owned: Owned): Base | { rejection: CoreRejection } {
  const raw = input as unknown as Record<string, unknown>;
  if (raw['schemaVersion'] !== 1) return { rejection: rejection('invalid', 'advanceWork requires schemaVersion 1') };
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
  return { goalRef: goalRef as unknown as GoalRef, flowId, sessionHint, actor: owned.actor,
    taskId: rawTaskId === undefined ? null : rawTaskId };
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
    taskId: null, executeWithinRequest: raw['executeWithinRequest'] };
}

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

export function createWorkflow(deps: WorkflowDependencies): WorkflowPort
  & Required<Pick<WorkflowPort, 'consumeConsultation' | 'resolveDecision' | 'orderGoalAdvances'>> {
  /**
   * R5b.4 §11.5 finite first-consumer handoff. Each call delegates exactly ONE
   * original owner (`proposeInitialPlanFromAnswer` or `applyPlanChange`) and
   * returns that owner's untouched receipt. A real candidate forms the complete
   * `adopt_initial_plan` continuation with the original flow identity; a real
   * adoption hands off to the existing `advanceWork.select_work` and never
   * starts a second control loop. `needs_decision`/waiting never fake success;
   * the N0 branch stays explicitly unsupported.
   */
  const handleGoalInput = async (
    ctx: CoreCallContext, input: N0GoalInput | InitialPlanningGoalInput,
  ): Promise<InitialPlanningGoalInputResult> => {
    const kind = isRecord(input) ? (input as { kind?: unknown }).kind : undefined;
    if (kind !== 'planning_answer' && kind !== 'adopt_initial_plan') {
      return { status: 'rejected', code: 'unsupported',
        reason: 'N0 Workflow goal input is a source boundary skeleton; no business action is implemented' };
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
    const matches = config.bindings.filter((binding) => binding.workspace.projectId === projectId
      && binding.workspace.workspaceId === workspaceId && binding.roleBinding.templateId === role);
    return matches.length === 1 ? matches[0]! : null;
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
  ): Promise<{ operation: WorkflowOperation } | { rejection: CoreRejection }> {
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
      roleBinding: binding.roleBinding, budget: requeue?.budget ?? binding.budget,
      ...(consumedWait === undefined ? {} : { consumedWait }),
      // TASK-03 (D-3): a requeued Task is claimed only with the TaskRequeue covering its selected Run.
      ...(requeue === undefined ? {} : { requeueRef: requeue.requeueRef }),
      // 2C item 10 (lead ruling): a claim in a REUSED Session also opens the
      // claimed Task's responsible link in the same commit (the create path
      // already wrote its `initialLinks`; the claim checks for an open link).
      ...(reusedSession ? { openResponsibleLink: true } : {}),
    };
    return { operation: { kind: 'claim_task', request: graphWrite(base, 'claim_task', input, expected) } };
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
    const messageRead = await deps.consultations.messages.readMessage(owned.ctx, continuation.messageRef);
    if (messageRead.status !== 'ready') return { waiting: receiptReason(messageRead, 'the continuation wait message is not readable') };
    const message = messageRead.value;
    if (message.status !== 'responded' || message.response === null) {
      return { waiting: 'the continuation wait has not been answered yet' };
    }
    return { sessionRef: structuredClone(continuation.sessionRef), value: { runRef: priorRunRef, messageRef: continuation.messageRef, responseRef: structuredClone(message.response.bodyRef) } };
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
    return 'schemaVersion' in auth && auth.schemaVersion === 2 && (auth.phase === 'authorized' || auth.phase === 'revoked')
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
    owned: Owned, base: Base, read: ReadResult<RoundSnapshot>,
  ): Promise<WorkflowAdvanceResult | null> {
    if (read.status === 'not_found') return null;
    if (read.status !== 'ready') return waiting(null, receiptReason(read, 'the verification round chain is not readable'));
    const round = read.value;
    if (round.status === 'finalized') {
      if (round.outcome !== 'PASS' || round.gaps.length > 0) {
        return waiting(null,
          `the verification round chain head finalized ${round.outcome ?? 'INCONCLUSIVE'} with ${round.gaps.length} gap(s); not re-verifying`);
      }
      const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
      if (goalRead.status !== 'ready') {
        return waiting(null, receiptReason(goalRead, 'the Goal could not be read for the Task completion'));
      }
      const goal = goalRead.value.goal;
      if (goal.activePlanRevision === null) return waiting(null, 'the Goal has no adopted Plan; the Task is not completed');
      return advancing(null, makePerform(base, completeTaskStep(base, goal, goal.activePlanRevision, round)));
    }
    const next = nextAfterRound(base, round);
    if (next === null) return waiting(null, 'the verification round chain head has an executing check; not advancing');
    return advancing(null, next);
  }

  /**
   * Resume the round chain of a formally completed/ended Run before any new
   * claim/open (VD-14): its head continues (`continueRoundChain`); only an
   * explicit `not_found` opens the checks exactly once, under the Goal's current
   * adopted Plan (`planRef`, VD-7).
   */
  async function resumeRoundChain(owned: Owned, base: Base, run: RunSnapshot, planRef: PlanRevisionRef): Promise<WorkflowAdvanceResult> {
    const head = await readChainHead(owned, { ...run.task }, run.ref);
    if ('waiting' in head) return waiting(null, head.waiting);
    const continued = await continueRoundChain(owned, base, head.read);
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
    owned: Owned, base: Base, graph: TaskGraph, gateTask: RuntimeTask,
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
          + gateStopAdvice(verdict.reason));
      }
    }
    const head = await readChainHead(owned, gate, null);
    if ('waiting' in head) return waiting(null, head.waiting);
    const continued = await continueRoundChain(owned, base, head.read);
    if (continued !== null) return continued;
    const producer = graph.tasks.find((row) => row.definition.taskKind === 'work'
      && row.effectivePhase === 'satisfied' && row.execution !== null);
    if (producer === undefined || producer.execution === null) {
      return waiting(null, `the goal gate ${gateTask.taskId} has no ended ordinary producer Run yet`);
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
  async function claimRequeued(
    owned: Owned, base: Base, goal: GoalSnapshot, planRef: PlanRevisionRef, task: RuntimeTask, row: TaskRow,
    binding: Binding, requeueRef: TaskRequeueRef, afterRunRef: RunRef,
  ): Promise<WorkflowAdvanceResult | null> {
    const afterRun = await deps.executions.readExecution(owned.ctx, afterRunRef);
    if (afterRun.status !== 'ready') return waiting(null, receiptReason(afterRun, 'the requeued Task afterRun is not readable'));
    const workspaceId = goal.workspaceRef.workspaceId;
    const claimSession = await deps.sessions.readSession(owned.ctx, afterRun.value.outbox.claim.sessionRef);
    // E16 (§4.1 S:799, rule 7): the continuation of a requeued Task follows the
    // same destination-first order as `chooseSession` — an open responsible link
    // of a transfer destination wins — and a source that is excluded (an archive
    // request, a wait, a readonly copy) is never retried; it goes through the
    // ordinary selection instead.
    const transferred = await responsibleSessionFor(owned, goal, binding, row.ref);
    const taskRef: TaskTriple = row.ref;
    const requeue: WorkflowSessionRequeue = { requeueRef, budget: row.requeueBudget ?? null };
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
        const claimSessionRef: SessionRef = { projectId: record.ref.projectId, sessionId: record.ref.sessionId };
        if (turnClosureOf(deps.runtime) === undefined || await hasContinuationForTask(owned, claimSessionRef, taskRef)) {
          chosen = { kind: 'create' };
        } else {
          return advancing(null, makePerform(base, closeOpenTurnStep(
            claimSessionRef, afterRunRef, requeueRef, taskRef, planRef, requeue)));
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
      }, taskRef, planRef, requeue)));
    }
    // E15 (W1-HO-04, §4.4.7, L17): a reused Session that continues exactly this
    // Task from a predecessor still open and unarchived re-derives the same
    // handover step from durable facts BEFORE the claim pin is computed. The
    // crash between `create_session` and its handover therefore recovers here,
    // and the (live, idle) predecessor can still be archived in one composition.
    const recovered = await recoveryHandoverStep(owned, base, chosen.card, taskRef, planRef, requeue);
    if (recovered !== null) return advancing(null, makePerform(base, recovered));
    const sessionRef: SessionRef = { projectId: owned.projectId, sessionId: chosen.card.record.ref.sessionId };
    const built = await buildClaimOperation(owned, base, goal, planRef, task, binding,
      sessionRef.sessionId, chosen.card.record.revision, true, undefined, requeue);
    if ('rejection' in built) return built.rejection;
    return advancing(null, makePerform({ ...base, sessionHint: sessionRef }, built.operation));
  }

  /**
   * C8 (§4.3 "Workflow", §15.2 5.8): the automatic requeue a work Task's
   * verdict asks for, or `null`. `requeue` (AV-12) requeues with no budget;
   * `stopped/budget_exhausted` (AV-11) requeues only with the Task's binding
   * budget when that is larger than the exhausted one (§13.4 #19), and the
   * claim then carries it (TASK-03). Every other verdict, and a Host whose
   * claim owner publishes no `requeueTask`, requeues nothing. The verdict is an
   * admissibility fact; the owner judges the request again (C8).
   */
  function automaticRequeue(
    config: WorkflowHostConfiguration, owned: Owned, base: Base, goal: GoalSnapshot, plan: PlanRevisionSnapshot,
    task: RuntimeTask, row: TaskRow,
  ): WorkflowOperation | null {
    const failure = row.failure;
    if (deps.claims.requeueTask === undefined || failure === undefined
      || failure.runRef === null || failure.runRevision === null) return null;
    const verdict = failure.automation.verdict;
    if (verdict.kind === 'requeue') {
      return requeueTaskStep(base, goal, row.ref, failure, failure.runRef, failure.runRevision, verdict.failureClass, null);
    }
    if (verdict.kind !== 'stopped' || verdict.reason !== 'budget_exhausted' || failure.failureClass === null) return null;
    const exhausted = verdict.detail.minTokenBudgetExclusive;
    const assignment = revisionAssignments(plan).find((candidate) => candidate.taskId === task.taskId);
    const binding = assignment === undefined ? null
      : bindingForRole(config, owned.projectId, goal.workspaceRef.workspaceId, assignment.role);
    if (exhausted === undefined || binding === null || binding.budget.tokenBudget <= exhausted) return null;
    return requeueTaskStep(base, goal, row.ref, failure, failure.runRef, failure.runRevision, failure.failureClass,
      binding.budget);
  }

  /**
   * C5 (§4 AV-7d, §15.2 5.9): the automatic successor round a work Task's
   * `reverify` verdict asks for on its finalized chain head, or `null`. With
   * `needsFinalize` (FC-13) the open head is finalized by the round chain
   * first and the next selection reverifies; a Host whose evidence owner
   * publishes no `reverifyRound` reverifies nothing. The owner judges the
   * request again (C8).
   */
  function automaticReverify(base: Base, row: TaskRow): WorkflowOperation | null {
    const failure = row.failure;
    if (deps.evidence.reverifyRound === undefined || failure === undefined) return null;
    const verdict = failure.automation.verdict;
    if (verdict.kind !== 'reverify' || verdict.needsFinalize) return null;
    return reverifyRoundStep(base, row.ref, failure, verdict);
  }

  /**
   * §4.5 (rule 16): the automation policy is shared by `select_work` and
   * `perform`. Before an automatic requeue/reverify the current Goal settings
   * decide; when the action needs a person the step returns a formal
   * `waiting`/`next=null` result carrying the derived source-2 cause and starts
   * nothing. `post_process`/`after_plan_confirmation` keeps the historical
   * behavior. The helper reads no clock, writes nothing and fabricates no
   * GoalPhase.
   */
  async function automationConfirmation(base: Base, goal: GoalSnapshot, row: TaskRow,
    operation: WorkflowOperation): Promise<WorkflowAdvanceResult | null> {
    const failure = row.failure;
    if (failure === undefined) return null;
    // Lead (accept review, known #7): a requeue already covering this failure means the action was committed;
    // the owner's original receipt decides, never a new card under a changed autonomy.
    if (operation.kind === 'requeue_task' && failure.automation.coveringRequeue !== null) return null;
    let action: 'system_requeue' | 'auto_reverify';
    let countedNext: number;
    if (operation.kind === 'requeue_task') {
      action = 'system_requeue';
      countedNext = failure.automation.requeueAutoCount + (failure.failureClass === 'interrupted' ? 0 : 1);
    } else if (operation.kind === 'reverify_round') {
      const head = failure.round;
      if (head === null) return null;
      const exemption = reverifyExemptionOfFacts({ checks: head.failingChecks, gapCodes: head.gapCodes });
      action = 'auto_reverify';
      countedNext = successorAutoCount(head.autoCount, 'system', exemption);
    } else {
      return null;
    }
    // Lead (rebase, A11 #15 / ND-7): past the automatic cap the existing fence
    // stays — the requeue/reverify owner commits its cap refusal and the Goal
    // shows that cause; the gate adds only the autonomy rule (spec §3.2
    // "countedNext>cap ... existing fences stay").
    if (countedNext > failure.automation.cap) return null;
    const settings = goal.settings ?? DEFAULT_GOAL_SETTINGS_V1;
    // §4.5 line 888 / F8: decide with the shared pure policy FIRST, before the
    // Run revision read below. Under the default `after_plan_confirmation`
    // autonomy no card is needed (`automatic_notice`), and that read must not be
    // able to refuse a step the existing owner would have performed; no card
    // needed means no new read (brief section 5, §8.2 line 1363). The probe uses
    // the same `automationConfirmationCause` with no Run revision, so it only
    // asks whether a card is derived.
    if (automationConfirmationCause({
      autonomy: settings.autonomy, action, countedNext, cap: failure.automation.cap,
      goalRef: goal.ref, taskId: row.ref.taskId, runRef: null, runRevision: null,
    }) === null) return null;
    // §3.3 line 629 / defect-1: a Run is a STORED aggregate, so its pin must be
    // its formal revision, never a fabricated 0 (the §3.3 pin check would then
    // reject the card with `revision_conflict`). The failure facts of a gate
    // whose anchored producer Run was not in the read window carry a `runRef`
    // with a null `runRevision`; read that Run's formal revision through the
    // SAME source-authority reader this Workflow already uses for pins. A read
    // failure is returned (`unavailable`/`incomplete`), never folded into a
    // fabricated pin. The §4.2 source-2 reader resolves the same canonical Run
    // revision, so both entries produce the same `decisionSourceKey`.
    let runRevision = failure.runRevision;
    if (failure.runRef !== null && runRevision === null) {
      let loaded;
      try { loaded = await deps.sourceAuthority.load(failure.runRef); }
      catch { return rejection('unavailable', 'the failure Run source read failed'); }
      if (loaded.status === 'not_found') {
        return rejection('incomplete', 'the failure Run record does not exist');
      }
      if (loaded.status !== 'found') {
        return rejection(loaded.status === 'unsupported' ? 'unsupported' : 'unavailable',
          'the failure Run record is not readable');
      }
      runRevision = loaded.snapshot.revision;
    }
    // §3.3 line 629: the automation cause's affected set is the Task/Run pins of
    // the failure (a Task is not a stored aggregate, so its pin is the §2.1
    // absence revision 0). The ONE shared derivation keeps this identical to the
    // §4.2 source-2 reader's `source.key`.
    const cause = automationConfirmationCause({
      autonomy: settings.autonomy, action, countedNext, cap: failure.automation.cap,
      goalRef: goal.ref, taskId: row.ref.taskId, runRef: failure.runRef, runRevision,
    });
    if (cause === null) return null;
    const goalPin: VersionPin = { ref: goal.ref, revision: goal.revision };
    // N-R2-1(a) / §2.8 line 345: every new source used for answering carries the
    // canonical content basis of the formal Goal this step read, built exactly
    // like the §4.2 source-2 reader's `basisOf` (goalRef, workspaceRef,
    // objective, activePlanRef, normalized settings). The read model resolves
    // the answer's Workspace through `goalBases[0]`. Key and pins unchanged.
    const goalBasis = {
      goalRef: goal.ref,
      workspaceRef: goal.workspaceRef,
      objective: goal.objective,
      activePlanRef: goal.activePlanRevision,
      settings: goal.settings ?? DEFAULT_GOAL_SETTINGS_V1,
    };
    return readyValue({
      state: 'waiting', receipt: null, next: null,
      reason: `automation_confirmation_required:${cause.action}`,
      decisionCause: {
        source: {
          kind: 'goal_cause',
          key: decisionSourceKey({ kind: 'goal_cause', goalRef: goal.ref, code: cause.code, affected: cause.affected }),
          goalRef: goal.ref,
          pins: [goalPin, ...cause.affected],
          goalBases: [goalBasis],
        },
        code: cause.code, taskRef: { ...row.ref }, runRef: failure.runRef,
        action: cause.action, objects: [], options: [],
      },
    });
  }

  /** The `perform` half of the shared policy: recover the row by Task or round. */
  async function gatePerform(owned: Owned, base: Base,
    operation: WorkflowOperation): Promise<WorkflowAdvanceResult | null> {
    if (operation.kind !== 'requeue_task' && operation.kind !== 'reverify_round') return null;
    // Lead (rebase, A2-workflow-auto-rework): a malformed perform request is
    // judged by the existing step (owner presence, input checks), never here.
    const requestInput: unknown = (operation.request as { input?: unknown } | undefined)?.input;
    if (!isRecord(requestInput)) return null;
    if (operation.kind === 'requeue_task' && !isRecord(requestInput['taskRef'])) return null;
    const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
    if (goalRead.status !== 'ready') return null;
    const graphRead = await deps.plans.queryTaskGraph(owned.ctx, { goalRef: base.goalRef });
    if (graphRead.status !== 'ready') return null;
    const row = graphRead.value.tasks.find((candidate) => operation.kind === 'requeue_task'
      ? candidate.ref.taskId === operation.request.input.taskRef.taskId
      : sameCanonical(candidate.failure?.round?.roundRef, operation.request.input.predecessorRoundRef));
    if (row === undefined) return null;
    return await automationConfirmation(base, goalRead.value.goal, row, operation);
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
      return waiting(null, `the Goal is ${goal.desiredState}; no work is selected while the Goal is not active`);
    }
    if (goal.activePlanRevision === null) {
      return waiting(null, 'the Goal has no adopted Plan; no work was selected');
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
          ? waiting(null, `${notActive}; it waits until a plan change makes it active again`)
          : completed(null, `${notActive}; it carries no work any more`);
      }
    }
    // 1. The first eligible active ordinary work in required-first / plan order.
    const ordered = orderTasks(graph.plan.tasks, graph.plan.executionDag?.dependsOn ?? []);
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
        const claimed = await claimRequeued(owned, base, goal, graph.plan.ref, task, row, binding, row.requeueRef, row.execution);
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
          return await resumeRoundChain(owned, base, execution.value.run, graph.plan.ref);
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
        const continuation = await readContinuation(owned, row.execution);
        if ('rejection' in continuation) return continuation.rejection;
        if ('waiting' in continuation) return waiting(null, continuation.waiting);
        consumedWait = continuation.value;
        const original = await deps.sessions.readSession(owned.ctx, continuation.sessionRef);
        if (original.status !== 'ready') return waiting(null, 'the original continuation Session is not readable');
        if (!roleReusable(original.value, goal.workspaceRef.workspaceId, binding)) {
          return waiting(null, 'the original continuation Session is busy, archived or incompatible');
        }
        chosen = { kind: 'reuse', card: original.value };
      } else {
        chosen = await chooseSession(owned, goal, binding, base.sessionHint, taskRef);
      }
      if (chosen.kind === 'rejection') return chosen.rejection;
      if (chosen.kind === 'waiting') return waiting(null, chosen.reason);
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
      return waiting(null, `the selected Task ${base.taskId} is not executable right now`);
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
      return waiting(null, unfinishedWork.every((task) => task.disposition === 'deferred') ? `required_task_deferred: ${gap}` : gap);
    }

    // 3. Only a fully satisfied required ordinary set may produce the gate
    //    evidence from an already-ended ordinary Run (no gate Run is invented).
    const gateTask = required.find((task) => task.taskKind === 'gate' && unsatisfied(task));
    if (gateTask !== undefined) return await advanceGate(owned, base, graph, gateTask);

    // 4. Only a fully satisfied required set may propose the formal Goal completion.
    if (required.every((task) => !unsatisfied(task))) {
      return advancing(null, makePerform(base, completeGoalStep(base, owned.projectId, goal, graph.completion)));
    }
    return waiting(null, describeGap(ordered, graph));
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
      ...(continuation.requeue === undefined ? {} : { requeue: continuation.requeue }) };
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
        ...(continuation.requeue === undefined ? {} : { requeue: continuation.requeue }) };
    }
    return await transferStepFor(owned, base, continuation);
  }

  /**
   * E15 §4.4.7 (W1-HO-04, L17): crash recovery recomputes the same handover
   * from durable facts — a reused Session whose provenance continues exactly
   * this Task from a predecessor that is still open and unarchived.
   */
  async function recoveryHandoverStep(owned: Owned, base: Base, card: SessionCard, task: TaskTriple,
    planRef: PlanRevisionRef, requeue: WorkflowSessionRequeue): Promise<HandoverOperation | null> {
    const provenance = card.record.provenance;
    if (provenance === undefined || provenance === null || provenance.kind !== 'continuation') return null;
    if (!sameCanonical(provenance.task, task)) return null;
    return await buildHandoverStep(owned, base, {
      predecessor: provenance.from, task,
      successor: { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId },
      planRef, requeue,
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
      operation.successor.sessionId, card.value.record.revision, false, undefined, operation.requeue);
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
    }, operation.taskRef, operation.planRef, operation.requeue)));
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
          session.ref.sessionId, claimRevision, false, undefined, operation.requeue);
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
        const ended = normalEnd(result.value.run);
        if (!ended.ok) return afterNotNormalEnd(receipt, result.value.run, ended.reason, base);
        return await openChecksAfterRun(receipt, result.value.run);
      }
      case 'observe': {
        const result = await deps.runtime.observeRun(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'observe', result };
        if (result.status !== 'ready') return waiting(receipt, receiptReason(result, 'the Run observation did not return a formal record'));
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

  const advanceWork = async (ctx: CoreCallContext, input: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult> => {
    let isolated: WorkflowAdvanceInput;
    try { isolated = structuredClone(input); }
    catch { return rejection('invalid', 'the advancement input cannot be isolated from the caller'); }
    const owned = ownContext(ctx);
    if ('rejection' in owned) return owned.rejection;
    const base = baseFromInput(isolated, owned);
    if ('rejection' in base) return base.rejection;
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
  // E9/E17: the maintenance composer selects a non-operator `mode`, which only
  // the internal archive entry accepts. The public `archiveLine` refuses a
  // present `mode`, so route the composer's `archiveLine` to the internal entry
  // (the same composition) and keep `archiveLineInternal` available for a
  // composer that calls it directly.
  const maintenanceArchive: SessionArchivePort & Partial<InternalSessionArchivePort> = {
    archiveLine: (maintenanceCtx, request) => {
      const internal = archiveService.archiveLineInternal;
      if (internal === undefined) return archiveService.archiveLine(maintenanceCtx, request);
      return internal(maintenanceCtx, request as unknown as GraphWrite<RequestSessionArchiveInput>);
    },
    continueArchiveLine: archiveService.continueArchiveLine,
    ...(archiveService.archiveLineInternal === undefined
      ? {} : { archiveLineInternal: archiveService.archiveLineInternal }),
  };
  const maintenanceService = createSessionMaintenanceService({
    ...deps, archive: maintenanceArchive,
  });

  // AG2a: the explicit-consultation consumer is published on the SAME Workflow
  // port. Without the optional consultation dependencies it stays explicitly
  // unsupported, so existing Workflow fixtures are never forced to extend.
  const consultation = deps.consultations === undefined ? null : createConsultationConsumer({
    sessions: deps.sessions, plans: deps.plans, runtime: deps.runtime, consultations: deps.consultations,
    sessionArchive: archiveService,
  });
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
    ...(deps.decisionSources === undefined ? {} : { decisionSources: deps.decisionSources }),
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
    // Slice 1 §4.1/§4.2: the real archive/maintenance services are published
    // on the port; an outer `ready` never implies archived.
    archiveLine: archiveService.archiveLine,
    continueArchiveLine: archiveService.continueArchiveLine,
    maintainSessions: maintenanceService.maintainSessions,
  };
}
