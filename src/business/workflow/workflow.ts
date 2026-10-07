import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreError, CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { SessionRef, VersionPin } from '../../contracts/core/identity.js';
import type { SessionRecord } from '../../contracts/core/session.js';
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
import type { CreateSessionRequest } from '../../core/agent-runtime/session-operations.js';
import type { PrepareTaskExecutionRequest, StartTaskExecutionRequest } from '../../core/agent-runtime/execution-contracts.js';
import type { ClaimTaskInput, RequeueTaskInput } from '../../core/work-graph/tasks/claim-contracts.js';
import type { TaskGraph, TaskRow } from '../../core/work-graph/tasks/plan-contracts.js';
import type { GraphWrite } from '../../core/work-graph/tasks/contracts.js';
import type { SessionCard } from '../../core/work-graph/sessions/contracts.js';
import { runUnresolvedBlocker } from '../../core/work-graph/state/run-machine.js';
import {
  beginRefusalIsPermanent, displayRoundStatus, reverifyExemptionOfFacts, successorAutoCount,
} from '../../core/work-graph/state/verification-machine.js';
import type { ReverifyRoundInput } from '../../core/work-graph/evidence/contracts.js';
import type { ConsultationInput, ConsultationResult, InitialPlanningGoalInput, InitialPlanningGoalInputResult, N0GoalInput, WorkflowAdvanceInput, WorkflowAdvanceResult, WorkflowOperation, WorkflowSessionRequeue, WorkflowStepReceipt } from './contracts.js';
import type { WorkflowDependencies, WorkflowHostConfiguration, WorkflowPort } from './ports.js';
import { createConsultationConsumer } from './consultation.js';

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
    ...(requeue === undefined ? {} : { requeueRef: requeue.requeueRef }),
  };
  const requestId = requestIdFor(base, 'create_session', requestWithoutRequestId);
  return { kind: 'create_session', request: { ...value, meta: { requestId, expected } }, taskRef, planRef,
    ...(requeue === undefined ? {} : { requeue }) };
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

function orderTasks(tasks: readonly RuntimeTask[]): RuntimeTask[] {
  return [...tasks.filter((task) => task.requirementLevel === 'required'),
    ...tasks.filter((task) => task.requirementLevel === 'optional')];
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

export function createWorkflow(deps: WorkflowDependencies): WorkflowPort & Required<Pick<WorkflowPort, 'consumeConsultation'>> {
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

  async function chooseSession(
    owned: Owned, goal: GoalSnapshot, binding: Binding, sessionHint: SessionRef | null,
  ): Promise<SessionChoice> {
    const workspaceId = goal.workspaceRef.workspaceId;
    if (sessionHint !== null) {
      const read = await deps.sessions.readSession(owned.ctx, sessionHint);
      if (read.status === 'ready') {
        const card = read.value;
        if (roleReusable(card, workspaceId, binding)) return { kind: 'reuse', card };
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
        if (roleReusable(card, workspaceId, binding)) return { kind: 'reuse', card };
      }
      if (found.value.nextCursor === null) break;
      cursor = found.value.nextCursor;
    }
    return { kind: 'create' };
  }

  async function buildClaimOperation(
    owned: Owned, base: Base, goal: GoalSnapshot, planRef: PlanRevisionRef,
    task: RuntimeTask, binding: Binding, sessionId: string, sessionRevision: number,
    consumedWait?: ConsumedWaitV1, requeue?: WorkflowSessionRequeue,
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
    let chosen: SessionChoice;
    if (claimSession.status === 'ready') {
      const card = claimSession.value;
      const record = card.record;
      if (roleReusable(card, workspaceId, binding)) {
        chosen = { kind: 'reuse', card };
      } else if (record.lifecycle === 'archived' || record.workspaceId !== workspaceId
        || !sameCanonical(record.role, binding.sessionRole)
        || (record.health === 'unavailable' && (record.healthConclusion === 'missing' || record.healthConclusion === 'damaged'))) {
        chosen = await chooseSession(owned, goal, binding, null);
      } else if (record.occupancy === null && record.health === 'unavailable' && record.healthConclusion === 'kernel_turn_open') {
        // LA-1 (A.2 step 5.6): the Kernel refuses a new Turn in a Session whose last Turn has no Kernel
        // terminal; the continuation gets a NEW linked Session (never another Task's), seeded by
        // `prepare` from the TaskRequeue history source.
        chosen = { kind: 'create' };
      } else if (record.occupancy !== null) {
        return null;
      } else {
        return waiting(null, `the afterRun claim Session is ${record.health}`
          + `${record.healthConclusion === undefined || record.healthConclusion === null ? '' : ` (${record.healthConclusion})`}`);
      }
    } else if (claimSession.status === 'not_found') {
      chosen = await chooseSession(owned, goal, binding, null);
    } else if (claimSession.status === 'rejected' && (claimSession.code === 'cancelled' || claimSession.code === 'forbidden')) {
      return claimSession;
    } else {
      return waiting(null, receiptReason(claimSession, 'the afterRun claim Session is not readable'));
    }
    if (chosen.kind === 'rejection') return chosen.rejection;
    if (chosen.kind === 'waiting') return waiting(null, chosen.reason);
    const taskRef: TaskTriple = row.ref;
    const requeue: WorkflowSessionRequeue = { requeueRef, budget: row.requeueBudget ?? null };
    if (chosen.kind === 'create') {
      return advancing(null, makePerform(base, createSessionStep(base, {
        workspace: { projectId: owned.projectId, workspaceId },
        role: binding.sessionRole, recommendedRefs: [],
        initialLinks: [{ target: { kind: 'task', ref: taskRef }, relation: 'responsible' }],
      }, taskRef, planRef, requeue)));
    }
    const sessionRef: SessionRef = { projectId: owned.projectId, sessionId: chosen.card.record.ref.sessionId };
    const built = await buildClaimOperation(owned, base, goal, planRef, task, binding,
      sessionRef.sessionId, chosen.card.record.revision, undefined, requeue);
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
    const ordered = orderTasks(graph.plan.tasks);
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
      if (rework !== null) return advancing(null, makePerform(base, rework));
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
        chosen = await chooseSession(owned, goal, binding, base.sessionHint);
      }
      if (chosen.kind === 'rejection') return chosen.rejection;
      if (chosen.kind === 'waiting') return waiting(null, chosen.reason);
      const taskRef: TaskTriple = { projectId: owned.projectId, goalId: base.goalRef.goalId, taskId: task.taskId };
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
        sessionRef.sessionId, chosen.card.record.revision, consumedWait);
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

  async function performStep(owned: Owned, base: Base, operation: WorkflowOperation): Promise<WorkflowAdvanceResult> {
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
        const built = await buildClaimOperation(owned, base, goal, graphRead.value.plan.ref, task, binding,
          session.ref.sessionId, session.revision, undefined, operation.requeue);
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
    }
  }

  const advanceWork = async (ctx: CoreCallContext, input: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult> => {
    let isolated: WorkflowAdvanceInput;
    try { isolated = structuredClone(input); }
    catch { return rejection('invalid', 'the advancement input cannot be isolated from the caller'); }
    const owned = ownContext(ctx);
    if ('rejection' in owned) return owned.rejection;
    const base = baseFromInput(isolated, owned);
    if ('rejection' in base) return base.rejection;
    if (isolated.kind === 'select_work') return await selectNext(owned, base);
    return await performStep(owned, base, isolated.operation);
  };

  // AG2a: the explicit-consultation consumer is published on the SAME Workflow
  // port. Without the optional consultation dependencies it stays explicitly
  // unsupported, so existing Workflow fixtures are never forced to extend.
  const consultation = deps.consultations === undefined ? null : createConsultationConsumer({
    sessions: deps.sessions, plans: deps.plans, runtime: deps.runtime, consultations: deps.consultations,
  });
  const consumeConsultation = async (ctx: CoreCallContext, input: ConsultationInput): Promise<ConsultationResult> => {
    if (consultation === null) {
      return rejection('unsupported', 'the Workflow has no consultation mailbox/Query/Project dependency');
    }
    return consultation(ctx, input);
  };

  return { handleGoalInput, advanceWork, consumeConsultation };
}
