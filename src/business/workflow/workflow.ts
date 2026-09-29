import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreError, CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { SessionRef, VersionPin } from '../../contracts/core/identity.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot, WorkspaceRef } from '../../contracts/ledger.js';
import type { PlanRevisionRef, RuntimeTask, TaskScope } from '../../contracts/plan.js';
import { revisionAssignments } from '../../contracts/plan.js';
import type { TaskReductionRef } from '../../contracts/reduction.js';
import type { GoalPhaseRef } from '../../contracts/goal-phase.js';
import type { RoundSnapshot } from '../../contracts/verification.js';
import type { PreparedTaskExecution } from '../../contracts/core/prepared-execution.js';
import type { ConsumedWaitV1 } from '../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import type { CreateSessionRequest } from '../../core/agent-runtime/session-operations.js';
import type { PrepareTaskExecutionRequest, StartTaskExecutionRequest } from '../../core/agent-runtime/execution-contracts.js';
import type { ClaimTaskInput } from '../../core/work-graph/tasks/claim-contracts.js';
import type { TaskGraph, TaskRow } from '../../core/work-graph/tasks/plan-contracts.js';
import type { GraphWrite } from '../../core/work-graph/tasks/contracts.js';
import type { SessionCard } from '../../core/work-graph/sessions/contracts.js';
import type { ConsultationInput, ConsultationResult, InitialPlanningGoalInput, InitialPlanningGoalInputResult, N0GoalInput, WorkflowAdvanceInput, WorkflowAdvanceResult, WorkflowOperation, WorkflowStepReceipt } from './contracts.js';
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
): WorkflowOperation {
  const expected: VersionPin[] = [];
  const requestWithoutRequestId = {
    workspace: value.workspace, role: value.role, recommendedRefs: value.recommendedRefs,
    initialLinks: value.initialLinks, meta: { expected },
  };
  const requestId = requestIdFor(base, 'create_session', requestWithoutRequestId);
  return { kind: 'create_session', request: { ...value, meta: { requestId, expected } }, taskRef, planRef };
}
function openWorkChecksStep(base: Base, run: RunSnapshot): WorkflowOperation {
  const input = { subjectRunRef: run.ref, subject: run.task, planRef: run.planRef };
  return { kind: 'open_checks', request: graphWrite(base, 'open_checks', input, []) };
}
function openGateChecksStep(
  base: Base, planRef: PlanRevisionRef, gate: TaskTriple, producer: RunRef, gateSubject: TaskScope['kind'],
): WorkflowOperation {
  const input = { subjectRunRef: producer, subject: gate, planRef, gateSubject };
  return { kind: 'open_checks', request: graphWrite(base, 'open_checks', input, []) };
}
/** `null` means an unknown check window exists: never skip it to run a later
 * pending check or finalize early; the caller keeps the receipt and waits. */
function nextAfterRound(base: Base, round: RoundSnapshot): WorkflowAdvanceInput | null {
  const unresolved = round.checks.find((check) => check.phase === 'executing' || check.phase === 'interrupted');
  if (unresolved !== undefined) return null;
  const pending = round.checks.find((check) => check.phase === 'pending');
  if (pending !== undefined) {
    const request = graphWrite(base, 'run_check', { roundRef: round.ref, checkId: pending.checkId },
      [{ ref: round.ref, revision: round.revision }]);
    return makePerform(base, { kind: 'run_check', request });
  }
  const request = graphWrite(base, 'finalize_checks', { roundRef: round.ref },
    [{ ref: round.ref, revision: round.revision }]);
  return makePerform(base, { kind: 'finalize_checks', request });
}
function completeTaskStep(base: Base, goal: GoalSnapshot, round: RoundSnapshot): WorkflowOperation {
  const reductionRef: TaskReductionRef = {
    aggregateType: 'TaskReduction', projectId: round.subject.projectId,
    goalId: round.subject.goalId, taskId: round.subject.taskId,
  };
  const expected: VersionPin[] = [
    { ref: base.goalRef, revision: goal.revision },
    { ref: reductionRef, revision: 0 },
  ];
  const input = { taskRef: round.subject, planRef: round.adoptedPlanRef, roundRef: round.ref };
  return { kind: 'complete_task', request: graphWrite(base, 'complete_task', input, expected) };
}
function completeGoalStep(base: Base, projectId: string, goal: GoalSnapshot): WorkflowOperation {
  const phaseRef: GoalPhaseRef = { aggregateType: 'GoalPhase', projectId, goalId: base.goalRef.goalId };
  const expected: VersionPin[] = [
    { ref: base.goalRef, revision: goal.revision },
    { ref: phaseRef, revision: 0 },
  ];
  return { kind: 'complete_goal', request: graphWrite(base, 'complete_goal', { goalRef: base.goalRef }, expected) };
}
function makePerform(base: Base, operation: WorkflowOperation): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: base.goalRef, flowId: base.flowId, sessionHint: base.sessionHint, kind: 'perform', operation,
    // An explicit Task selection is preserved across every successor request.
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
function describeGap(ordered: readonly RuntimeTask[], graph: TaskGraph): string {
  const parts: string[] = [];
  for (const task of ordered) {
    if (task.requirementLevel !== 'required') continue;
    const row = graph.tasks.find((candidate) => candidate.ref.taskId === task.taskId);
    if (row === undefined) { parts.push(`${task.taskId}: task state is not readable`); continue; }
    if (row.effectivePhase === 'satisfied') continue;
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
    consumedWait?: ConsumedWaitV1,
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
      roleBinding: binding.roleBinding, budget: binding.budget,
      ...(consumedWait === undefined ? {} : { consumedWait }),
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
    if (run.executionAuthorization !== undefined) return false;
    if (run.envelope !== null) return false;
    if (run.inputBinding !== undefined) return false;
    if (run.executionHistory !== undefined) return false;
    if (run.startedAt !== null) return false;
    if (run.lastEventSeq !== 0 || run.lastRuntimeEventId !== '' || run.lastFactEventId !== '') return false;
    const desired = run.controlState?.desiredState;
    if (desired === 'paused' || desired === 'cancelled') return false;
    return true;
  }

  /**
   * Resume the ORIGINAL verification round of a formally completed/ended Run
   * before any new claim/open. An `open` round follows the SAME `nextAfterRound`
   * rules (pending continues its registered check; executing/interrupted waits).
   * A `finalized` PASS round completes the Task from that same round; a
   * finalized non-PASS round waits and is never re-verified. Only an explicit
   * `not_found` opens the checks exactly once. A missing optional port or any
   * unknown read/corruption is `waiting`, never treated as "no round", so an
   * unknown window can never be bypassed with a second round.
   */
  async function resumeOriginalRound(owned: Owned, base: Base, run: RunSnapshot): Promise<WorkflowAdvanceResult> {
    const query = deps.evidence.queryOriginalVerification;
    if (query === undefined) {
      return waiting(null, 'the original verification round is not readable: the original-round read is not published');
    }
    let read: ReadResult<RoundSnapshot>;
    try {
      read = await query(owned.ctx, { subjectRunRef: run.ref, subject: { ...run.task }, planRef: run.planRef });
    } catch {
      return waiting(null, 'the original verification round read failed; no new round is opened');
    }
    if (read.status === 'ready') {
      const round = read.value;
      if (round.status === 'finalized') {
        if (round.outcome !== 'PASS' || round.gaps.length > 0) {
          return waiting(null,
            `the original verification round finalized ${round.outcome ?? 'INCONCLUSIVE'} with ${round.gaps.length} gap(s); not re-verifying`);
        }
        const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
        if (goalRead.status !== 'ready') {
          return waiting(null, receiptReason(goalRead, 'the Goal could not be read for the Task completion'));
        }
        return advancing(null, makePerform(base, completeTaskStep(base, goalRead.value.goal, round)));
      }
      const next = nextAfterRound(base, round);
      if (next === null) {
        return waiting(null, 'the original verification round has an executing or interrupted check; not advancing');
      }
      return advancing(null, next);
    }
    if (read.status === 'not_found') {
      return advancing(null, makePerform(base, openWorkChecksStep(base, run)));
    }
    return waiting(null, receiptReason(read, 'the original verification round is not readable'));
  }

  /** Read-only deterministic first-step selection shared by `select_work`. */
  async function selectNext(owned: Owned, base: Base): Promise<WorkflowAdvanceResult> {
    const config = deps.configuration;
    if (config === undefined) return rejection('unsupported', 'no trusted Workflow configuration is registered');
    const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
    if (goalRead.status !== 'ready') return readRejection(goalRead);
    const goal = goalRead.value.goal;
    if (goal.workspaceRef.projectId !== owned.projectId) return rejection('forbidden', 'the Goal belongs to another project');
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
    }
    // 1. The first eligible active ordinary work in required-first / plan order.
    const ordered = orderTasks(graph.plan.tasks);
    for (const task of ordered) {
      if (base.taskId !== null && task.taskId !== base.taskId) continue;
      const row = graph.tasks.find((candidate) => candidate.ref.taskId === task.taskId);
      if (row === undefined) continue;
      if (task.taskKind !== 'work' || task.disposition !== 'active') continue;
      if (task.executionIntent === 'plan_only') continue;
      // A real claim that was persisted but never admitted to the Kernel (its
      // first prepare was refused) is recoverable from the SAME Run. This is the
      // ONE narrow unadmitted state, checked against the formal execution read;
      // unknown/unreadable, authorized, entered, running and terminal executions
      // keep the pre-existing rules below and are never restarted.
      if (row.execution !== null && row.effectivePhase !== 'satisfied' && row.effectivePhase !== 'failed'
        && await isUnadmittedStarting(owned, row.execution)) {
        return advancing(null, makePerform(base, { kind: 'prepare', request: prepareStep(base, row.execution) }));
      }
      // A formally completed/ended Run whose Task is still open keeps its
      // ORIGINAL verification round (open or finalized). Resume that round (or
      // open it exactly once on an explicit not_found) BEFORE skipping the ended
      // Run; an unknown original-round read waits rather than falling through to
      // an unrelated Work. Failed/cancelled/paused/running/unknown executions
      // keep the existing rules below, and other same-Goal Tasks stay
      // independently selectable.
      if (row.execution !== null && row.effectivePhase !== 'satisfied' && row.effectivePhase !== 'failed') {
        const execution = await deps.executions.readExecution(owned.ctx, row.execution);
        if (execution.status === 'ready' && sameCanonical(execution.value.run.ref, row.execution)
          && normalEnd(execution.value.run).ok) {
          return await resumeOriginalRound(owned, base, execution.value.run);
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
    //    never scheduled ahead of unfinished ordinary work.
    const unsatisfied = (task: RuntimeTask): boolean => {
      const row = graph.tasks.find((candidate) => candidate.ref.taskId === task.taskId);
      return row === undefined || row.effectivePhase !== 'satisfied';
    };
    const required = graph.plan.tasks.filter((task) => task.requirementLevel === 'required');
    if (required.some((task) => task.taskKind === 'work' && unsatisfied(task))) {
      return waiting(null, describeGap(ordered, graph));
    }

    // 3. Only a fully satisfied required ordinary set may produce the gate
    //    evidence from an already-ended ordinary Run (no gate Run is invented).
    const gateTask = required.find((task) => task.taskKind === 'gate' && unsatisfied(task));
    if (gateTask !== undefined) {
      const producer = graph.tasks.find((row) => row.definition.taskKind === 'work'
        && row.effectivePhase === 'satisfied' && row.execution !== null);
      if (producer === undefined || producer.execution === null) {
        return waiting(null, `the goal gate ${gateTask.taskId} has no ended ordinary producer Run yet`);
      }
      const gate: TaskTriple = { projectId: owned.projectId, goalId: base.goalRef.goalId, taskId: gateTask.taskId };
      return advancing(null, makePerform(base,
        openGateChecksStep(base, graph.plan.ref, gate, producer.execution, gateTask.scope.kind)));
    }

    // 4. Only a fully satisfied required set may propose the formal Goal completion.
    if (required.every((task) => !unsatisfied(task))) {
      return advancing(null, makePerform(base, completeGoalStep(base, owned.projectId, goal)));
    }
    return waiting(null, describeGap(ordered, graph));
  }

  async function performStep(owned: Owned, base: Base, operation: WorkflowOperation): Promise<WorkflowAdvanceResult> {
    // The original owner request is always performed first and its complete
    // receipt is preserved. The trusted configuration is re-checked only when a
    // successful successor genuinely needs a binding or the fixed consumerId.
    const config = deps.configuration;
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
          session.ref.sessionId, session.revision);
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
        if (!ended.ok) return waiting(receipt, ended.reason);
        return advancing(receipt, makePerform(base, openWorkChecksStep(base, result.value.run)));
      }
      case 'observe': {
        const result = await deps.runtime.observeRun(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'observe', result };
        if (result.status !== 'ready') return waiting(receipt, receiptReason(result, 'the Run observation did not return a formal record'));
        const ended = normalEnd(result.value.run);
        if (!ended.ok) return waiting(receipt, ended.reason);
        return advancing(receipt, makePerform(base, openWorkChecksStep(base, result.value.run)));
      }
      case 'open_checks': {
        const result = await deps.evidence.openVerification(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'open_checks', result };
        if (result.status !== 'committed') return waiting(receipt, result.reason);
        const next = nextAfterRound(base, result.value);
        if (next === null) return waiting(receipt, 'the round has an executing or interrupted check; not advancing');
        return advancing(receipt, next);
      }
      case 'run_check': {
        const result = await deps.checks.runRegisteredCheck(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'run_check', result };
        if (result.status !== 'ready') return waiting(receipt, receiptReason(result, 'the registered check did not return a persisted round'));
        const next = nextAfterRound(base, result.value);
        if (next === null) return waiting(receipt, 'the round has an executing or interrupted check; not advancing');
        return advancing(receipt, next);
      }
      case 'finalize_checks': {
        const result = await deps.evidence.finalizeChecks(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'finalize_checks', result };
        if (result.status !== 'committed') return waiting(receipt, result.reason);
        const finalized = result.value;
        if (!finalized.applicable || finalized.outcome !== 'PASS' || finalized.gaps.length > 0) {
          return waiting(receipt, `the round finalized ${finalized.outcome} with ${finalized.gaps.length} gap(s)`);
        }
        const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
        if (goalRead.status !== 'ready') {
          return waiting(receipt, receiptReason(goalRead, 'the Goal could not be read for the Task completion'));
        }
        return advancing(receipt, makePerform(base, completeTaskStep(base, goalRead.value.goal, finalized.snapshot)));
      }
      case 'complete_task': {
        const result = await deps.tasks.completeTask(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'complete_task', result };
        if (result.status !== 'committed') return waiting(receipt, result.reason);
        const next: WorkflowAdvanceInput = {
          schemaVersion: 1, goalRef: base.goalRef, flowId: base.flowId, sessionHint: base.sessionHint, kind: 'select_work',
          ...(base.taskId === null ? {} : { taskId: base.taskId }),
        };
        return advancing(receipt, next);
      }
      case 'complete_goal': {
        const result = await deps.tasks.completeGoal(owned.ctx, operation.request);
        const receipt: WorkflowStepReceipt = { kind: 'complete_goal', result };
        if (result.status !== 'committed') return waiting(receipt, result.reason);
        return completed(receipt, 'the Goal was formally completed');
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
