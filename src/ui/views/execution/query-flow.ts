/** The investigation/planning Query flow and its explicit run, select, continue, retry and refresh actions. */

import type {
  CoreScope,
  QueriesPrepareResponse,
  QueriesStartResponse,
  QueriesSubmitResponse,
  QueryJobRef,
  QueryRunRef,
  SessionRef,
  WorkspacesRegistrationResponse,
} from '../../../app/core-http-types.js';
import { callCore, outcomeProblem, outcomeRejectionReason, payloadOf } from '../../api/http.js';
import { stopPoll } from '../../api/refresh.js';
import { tagsFor } from '../../api/request-tags.js';
import { submit } from '../../api/submit.js';
import { saveScopeDisplay } from '../../state/display-preference.js';
import { createExecutionRun } from '../../state/scope-state.js';
import type {
  AdoptInitialPlanInput,
  ExecutionRun,
  PlanningAnswerInput,
  QueryJobIntentV1,
  ScopeState,
  WorkflowAdvanceInput,
} from '../../state/scope-state.js';
import { centerSessionHistoryKey, plainSessionRef, record } from '../../state/values.js';
import { nextRequestSeq, renderScopeIfSelected, reviewGoals } from '../../state/workbench.js';
import { queryNoAnswerNotice } from '../conversation/goal-start.js';
import {
  beginCollaborationPoll,
  collaborationGoalRef,
  collaborationIsActive,
  readCollaboration,
  startCollaboration,
} from './collaboration.js';
import { drainContinuation } from './continuation.js';
import { buildPlanningQuestion, loadPlanCandidate, reconstructAdoptInitialPlan } from './planning.js';
import {
  driveRun,
  executionCall,
  executionRequestId,
  readExecutionAnswer,
  resolveExecutionSession,
  selectedExecutionProfile,
} from './run.js';
import { CENTER_HISTORY_LIMIT, buildSessionHistoryRequest, buildSessionReadRequest } from '../sessions/requests.js';

async function executeQueryFlow(scope: ScopeState, run: ExecutionRun): Promise<void> {
  const target = run.scope;
  if (target === null) { run.error = '执行范围已丢失，请重新发起。'; return; }
  const goalRef = run.goalRef;
  if (goalRef === null) { run.error = '请先填写或创建目标。'; return; }

  const goalRead = await executionCall(scope, run, 'goals/read', { scope: target, input: goalRef });
  const goalProblem = outcomeProblem(goalRead);
  if (goalProblem !== null) { run.error = goalProblem; return; }
  if (record(payloadOf(goalRead)).status !== 'ready') { run.error = '目标尚未就绪，无法发起调查。'; return; }
  run.goalRead = payloadOf(goalRead);
  scope.goalRead = payloadOf(goalRead);
  const goalValue = record(record(record(payloadOf(goalRead)).value).goal);
  const goalRevision = typeof goalValue.revision === 'number' && Number.isSafeInteger(goalValue.revision)
    && goalValue.revision >= 0 ? goalValue.revision : null;
  if (goalRevision === null) {
    // The owner did not publish a usable Goal revision. Never guess revision 1:
    // keep the original read result and stop before building any expected pin.
    run.error = '目标读取没有可用的正式版本；不会猜测 revision，也不会提交调查。';
    return;
  }

  const registration = await executionCall(scope, run, 'workspaces/registration', { scope: target, input: target });
  const registrationProblem = outcomeProblem(registration);
  if (registrationProblem !== null) { run.error = registrationProblem; return; }
  run.registration = payloadOf(registration) as WorkspacesRegistrationResponse;
  if (run.registration.status !== 'ready') {
    run.error = `项目/工作区登记读取失败：${outcomeRejectionReason(run.registration)}`;
    return;
  }
  const projectRevision = run.registration.value.project.revision;
  const workspaceRevision = run.registration.value.workspace.revision;

  const session = await resolveExecutionSession(scope, run, target);
  if (session === null) return;
  const profile = run.profile;
  if (profile === null) { run.error = '当前工作区没有可用的只读调查配置。'; return; }

  const queryJobId = `qjob-${run.flowId ?? ''}`;
  const queryRunId = `qrun-${run.flowId ?? ''}`;
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: target.projectId, workspaceId: target.workspaceId, queryJobId };
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: target.projectId, workspaceId: target.workspaceId, queryJobId, runId: queryRunId };
  run.queryJobRef = queryJobRef; run.queryRunRef = queryRunRef;
  // R6 cold-start: an initial_coordination question carries the real policy,
  // architecture and role facts in the ORIGINAL Query intent; ordinary
  // investigation keeps the user's own question unchanged.
  const planningQuestion = run.kind === 'planning' ? await buildPlanningQuestion(scope, run, target) : run.question;
  const intent: QueryJobIntentV1 = {
    schemaVersion: 1, intentId: queryJobId, projectId: target.projectId, workspaceId: target.workspaceId,
    goalId: goalRef.goalId, question: planningQuestion, focusTaskRefs: [], budget: profile.budget, multiTurn: { maxRounds: 1 },
    correlationId: `corr-${run.flowId ?? ''}`,
    execution: { kind: run.kind === 'planning' ? 'initial_coordination' : 'semantic_query',
      roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget },
  };
  const projectRef = { aggregateType: 'Project' as const, projectId: target.projectId };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId: target.projectId, workspaceId: target.workspaceId };
  const submitRequest = { scope: target, request: { input: { queryJobId, runId: queryRunId, intent }, meta: {
    requestId: executionRequestId(run, 'queries/submit'),
    expected: [
      { ref: projectRef, revision: projectRevision },
      { ref: workspaceRef, revision: workspaceRevision },
      { ref: goalRef, revision: goalRevision },
      { ref: queryJobRef, revision: 0 },
      { ref: queryRunRef, revision: 0 },
    ] } } };
  const submitted = await executionCall(scope, run, 'queries/submit', submitRequest);
  const submitProblem = outcomeProblem(submitted);
  if (submitProblem !== null) { run.error = submitProblem; return; }
  const submittedPayload = payloadOf(submitted) as QueriesSubmitResponse;
  if (submittedPayload.status !== 'committed') {
    run.error = `提交调查未成功：${outcomeRejectionReason(submittedPayload)}`;
    return;
  }
  // Use the REAL submitted Job/Run refs and revisions for the claim guards.
  run.queryJobRef = submittedPayload.value.job.ref;
  run.queryRunRef = submittedPayload.value.run.ref;
  run.jobRevision = submittedPayload.value.job.revision;
  run.runRevision = submittedPayload.value.run.revision;

  const claimRequest = { scope: target, request: { input: {
    queryRunRef: submittedPayload.value.run.ref, sessionRef: session }, meta: {
    requestId: executionRequestId(run, 'queries/claim'),
    expected: [
      { ref: submittedPayload.value.job.ref, revision: submittedPayload.value.job.revision },
      { ref: submittedPayload.value.run.ref, revision: submittedPayload.value.run.revision },
      { ref: run.sessionRef, revision: run.sessionRevision ?? 0 },
    ] } } };
  const claimed = await executionCall(scope, run, 'queries/claim', claimRequest);
  const claimProblem = outcomeProblem(claimed);
  if (claimProblem !== null) { run.error = claimProblem; return; }
  if (record(payloadOf(claimed)).status !== 'committed') {
    run.error = `领取调查未成功：${outcomeRejectionReason(payloadOf(claimed))}`;
    return;
  }

  const prepared = await executionCall(scope, run, 'queries/prepare', { scope: target, input: {
    queryRunRef: run.queryRunRef, requestId: executionRequestId(run, 'queries/prepare') } });
  const prepareProblem = outcomeProblem(prepared);
  if (prepareProblem !== null) { run.error = prepareProblem; return; }
  const preparedPayload = payloadOf(prepared) as QueriesPrepareResponse;
  if (preparedPayload.status !== 'ready') {
    run.error = `调查准备未就绪：${outcomeRejectionReason(preparedPayload)}`;
    return;
  }

  const startRequest = { scope: target, input: {
    prepared: preparedPayload.value, consumerId: profile.consumerId, requestId: executionRequestId(run, 'queries/start') } };
  const started = await executionCall(scope, run, 'queries/start', startRequest);
  const startProblem = outcomeProblem(started);
  if (startProblem !== null) { run.error = startProblem; return; }
  const startedPayload = payloadOf(started) as QueriesStartResponse;
  if (startedPayload.status !== 'ready') {
    run.error = `调查启动未就绪：${outcomeRejectionReason(startedPayload)}`;
    return;
  }
  let execution = startedPayload.value;
  if (execution.answer === null) {
    // Explicit observation only: it never re-sends the model.
    const observed = await executionCall(scope, run, 'queries/observe', { scope: target, input: { queryRunRef: run.queryRunRef } });
    const observedPayload = payloadOf(observed) as QueriesStartResponse;
    if (outcomeProblem(observed) === null && observedPayload.status === 'ready') execution = observedPayload.value;
  }
  if (execution.answer === null) {
    run.notice = queryNoAnswerNotice({
      outcome: execution.run.run.outcome,
      phase: execution.run.run.executionState?.phase ?? null,
      status: execution.run.run.status,
    });
    return;
  }
  const readOk = await readExecutionAnswer(scope, run, target, execution.answer.ref);
  if (!readOk || run.kind !== 'planning') return;
  const answer = run.answer;
  if (answer === null || answer.status !== 'ready') return;
  if (answer.value.answer.stale) {
    run.notice = `回答已标记为过期（${answer.value.answer.staleReason ?? '来源变化'}），未继续规划。`;
    return;
  }
  // The planning hint stays null: the original Workflow owner chooses the work
  // Session from its own configuration, so the advisor Session is never rebound.
  const planningInput: PlanningAnswerInput = {
    schemaVersion: 1, goalRef, flowId: run.flowId ?? '', sessionHint: null, executeWithinRequest: true,
    kind: 'planning_answer',
    request: { meta: { requestId: executionRequestId(run, 'workflow/goal-input:planning'), expected: [] },
      input: { answerRef: answer.value.ref, reason: { text: answer.value.answer.answer, sources: [] } } },
  };
  await drainContinuation(scope, run, target, { route: 'workflow/goal-input', input: planningInput });
  // Recover the readable setup candidate from the saved Answer (never memory).
  await loadPlanCandidate(scope);
  renderScopeIfSelected(scope);
}

/** Narrow OPTIONAL frozen recipient intent for `runExecution`. When present it
 * overrides the live selection (first-Send continuation must not follow a later
 * member click); when absent every explicit existing action keeps the current
 * selection. It is not a second execution pipeline. */
type FrozenExecutionTarget = { fromMain: boolean; selectedSession: SessionRef | null };

/** Start a fresh investigation/planning action. Scope, Goal, question and the
 * selected Session are frozen into the run before the first await. */
export async function runExecution(scope: ScopeState, kind: 'investigate' | 'planning',
  frozenTarget?: FrozenExecutionTarget): Promise<void> {
  if (scope.execution.running || scope.execution.pending !== null) return;
  // A new QueryFlow/Goal owns the panel: stop only the page's old read timer.
  // The Host driver itself keeps running.
  if (scope.collaborationPoll !== null) { stopPoll(scope.collaborationPoll); scope.collaborationPoll = null; }
  scope.collaborationEpoch += 1;
  const profile = selectedExecutionProfile(scope);
  const fromMain = frozenTarget?.fromMain ?? (scope.activeSession === null);
  const selectedSession = frozenTarget !== undefined
    ? frozenTarget.selectedSession : (scope.activeSession ?? scope.mainSession);
  const target: CoreScope = profile === null
    ? { projectId: scope.config.scope.projectId, workspaceId: scope.config.scope.workspaceId }
    : { projectId: profile.scope.projectId, workspaceId: profile.scope.workspaceId };
  const goalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || reviewGoals()[0]?.goalId || '';
  const question = scope.forms.question.trim() || '请阅读当前来源并给出正式回答';
  const seq = nextRequestSeq();
  const flowId = `flow-${Date.now().toString(36)}-${seq.toString(36)}`;
  const run = createExecutionRun();
  run.kind = kind;
  run.flowId = flowId;
  run.scope = target;
  run.question = question;
  run.profile = profile;
  run.selectedSession = selectedSession;
  run.goalRef = goalId.length === 0 ? null : { aggregateType: 'Goal', projectId: target.projectId, goalId };
  scope.execution = run;
  scope.executionNotice = null;
  scope.error = null;
  scope.notice = null;
  await driveRun(scope, run, (current, active) => executeQueryFlow(current, active));
  if (fromMain && run.sessionRef !== null) {
    scope.mainSession = plainSessionRef(run.sessionRef);
    saveScopeDisplay(scope);
    // Read the persisted original Session history back into the center, so the
    // main conversation shows the real conversation rather than only this run.
    const ref = run.sessionRef;
    await submit(scope, 'sessions/history', buildSessionHistoryRequest(scope.config.scope, ref, null, false, CENTER_HISTORY_LIMIT),
      tagsFor(ref, null, null, null, null, centerSessionHistoryKey(ref)));
  }
  if (run.sessionRef !== null) {
    await submit(scope, 'sessions/read', buildSessionReadRequest(scope.config.scope, run.sessionRef), tagsFor(run.sessionRef));
    await submit(scope, 'sessions/find', { scope: scope.config.scope,
      input: { workspace: scope.config.scope, includeArchived: scope.sessionIncludeArchived, page: { limit: 10 } } });
  }
}

/** Choose the displayed Task before any driver lookup. Other Task handles stay
 * on the Host; an unconfirmed browser request is never discarded. */
function selectExecutionTask(scope: ScopeState): ExecutionRun {
  const previous = scope.execution;
  const taskId = scope.forms.taskId.trim() || null;
  if (previous.running || previous.pending !== null || previous.taskId === taskId) return previous;
  const run = createExecutionRun();
  run.scope = previous.scope;
  run.goalRef = collaborationGoalRef(scope, previous);
  run.selectedSession = scope.activeSession;
  run.taskId = taskId;
  scope.execution = run;
  scope.collaborationEpoch += 1;
  stopPoll(scope.collaborationPoll);
  scope.collaborationPoll = null;
  scope.collaboration = null;
  return run;
}

/** The explicit "continue" action. It never creates a new flow or a Query
 * Session: it resends a saved continuation, or falls back to the original
 * select_work when there is no saved continuation. */
export async function continueExecution(scope: ScopeState): Promise<void> {
  const run = selectExecutionTask(scope);
  if (run.running || run.pending !== null) return;
  const target: CoreScope = run.scope
    ?? { projectId: scope.config.scope.projectId, workspaceId: scope.config.scope.workspaceId };
  run.scope = target;
  if (run.selectedSession === null) run.selectedSession = scope.activeSession;
  if (run.goalRef === null) {
    const goalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || reviewGoals()[0]?.goalId || '';
    if (goalId.length > 0) run.goalRef = { aggregateType: 'Goal', projectId: target.projectId, goalId };
  }
  const resume = run.resumeIntent;
  if (resume === null && run.goalRef === null) {
    scope.error = '没有可继续的目标或待续传步骤；请先创建目标并采用计划。';
    renderScopeIfSelected(scope);
    return;
  }
  scope.error = null;
  scope.notice = null;
  run.notice = null;
  // A saved continuation belongs to the Goal that produced it. If the user has
  // since chosen a DIFFERENT Goal, never send the old Goal's request under the
  // new selection: keep the original unconfirmed payload and idempotency, and
  // ask the user to switch back. No multi-Goal state store is introduced.
  const currentGoal = collaborationGoalRef(scope, run);
  if (resume !== null && currentGoal !== null) {
    const resumeGoal = resume.input.goalRef;
    if (resumeGoal.projectId !== currentGoal.projectId || resumeGoal.goalId !== currentGoal.goalId) {
      run.notice = `待续请求属于目标 ${resumeGoal.goalId}，与当前目标 ${currentGoal.goalId} 不同；`
        + '请切回原目标后再继续，原请求与幂等身份均已保留。';
      renderScopeIfSelected(scope);
      return;
    }
  }
  if (resume !== null && resume.route === 'workflow/goal-input') {
    // Explicit NEW action: same Goal/flow and same public input semantics, a NEW
    // requestId. The old idempotency key is never reused with different expected.
    run.resumeCount += 1;
    const pendingAdopt = resume.input as AdoptInitialPlanInput;
    const input: AdoptInitialPlanInput = {
      ...pendingAdopt,
      request: { ...pendingAdopt.request, meta: { ...pendingAdopt.request.meta,
        requestId: executionRequestId(run, `workflow/goal-input:resume:${run.resumeCount}`) } },
    };
    await driveRun(scope, run, (current, active) =>
      drainContinuation(current, active, target, { route: 'workflow/goal-input', input }));
    return;
  }
  // The Host may already own this Goal's handle: read it BEFORE restarting so a
  // navigation/reload never starts a second advancement.
  const existingGoal = collaborationGoalRef(scope, run);
  if (existingGoal !== null) {
    run.goalRef = existingGoal;
    const epoch = scope.collaborationEpoch + 1;
    scope.collaborationEpoch = epoch;
    await readCollaboration(scope, target, existingGoal, epoch);
    if (scope.collaboration !== null && collaborationIsActive(scope.collaboration.result)) {
      if (scope.collaboration.result.status === 'ready') run.phase = scope.collaboration.result.value.state;
      beginCollaborationPoll(scope, target, scope.collaboration.goalRef);
      return;
    }
  }
  if (resume !== null && resume.route === 'workflow/advance') {
    await startCollaboration(scope, run, target, resume.input);
    return;
  }
  if (run.goalRef === null) {
    scope.error = '请先选择目标。';
    renderScopeIfSelected(scope);
    return;
  }
  // A formal pending Plan must never be bypassed by select_work: when the reload
  // lost the continuation, reconstruct the EXISTING adopt_initial_plan request
  // from the current pending proposal and the real Goal revision.
  if (resume === null) {
    const reconstructed = reconstructAdoptInitialPlan(scope);
    if (reconstructed !== null) {
      await driveRun(scope, run, (current, active) =>
        drainContinuation(current, active, target, { route: 'workflow/goal-input', input: reconstructed }));
      return;
    }
  }
  // No saved continuation and no pending Plan: the original select_work is the
  // only resume. It is independent of any Query profile; the explicit work-Session
  // selection (if any) is passed through so the owner reports its compatibility.
  run.taskId = scope.forms.taskId.trim().length === 0 ? null : scope.forms.taskId.trim();
  const input: WorkflowAdvanceInput = {
    schemaVersion: 1, goalRef: run.goalRef, flowId: run.flowId ?? `flow-${Date.now().toString(36)}`,
    sessionHint: run.selectedSession, kind: 'select_work',
    ...(run.taskId === null ? {} : { taskId: run.taskId }),
  };
  await startCollaboration(scope, run, target, input);
}

/** Resend the exact unconfirmed request and, once its real receipt arrives,
 * continue along the SAME driver (replaying the confirmed buffer). Never
 * rebuilds flow/job/run/session/requestId/budget/expected. */
export async function retryExecution(scope: ScopeState): Promise<void> {
  const run = scope.execution;
  const pending = run.pending;
  if (pending === null || run.running) return;
  const failedIndex = run.pendingIndex ?? run.callIndex - 1;
  scope.sending = true;
  run.error = null;
  renderScopeIfSelected(scope);
  const outcome = await callCore(pending.route, pending.request);
  scope.sending = false;
  if (outcome.kind === 'network') {
    scope.error = '连接中断，未收到回执。可重新发送原请求（内容保持不变）。';
    renderScopeIfSelected(scope);
    return;
  }
  scope.pending = null;
  run.pending = null;
  run.pendingIndex = null;
  if (failedIndex >= 0 && run.calls[failedIndex] !== undefined) run.calls[failedIndex]!.outcome = outcome;
  run.callIndex = run.driverStart;
  const driver = run.driver;
  if (driver === null) {
    run.error = '原执行入口已丢失，请重新发起。';
    renderScopeIfSelected(scope);
    return;
  }
  await driveRun(scope, run, driver);
}

/** Re-read the original Query OR the Host collaboration handle; it never starts
 * a new model call and never depends on a browser QueryRunRef. */
export async function refreshExecution(scope: ScopeState): Promise<void> {
  const run = selectExecutionTask(scope);
  if (run.running) return;
  if (run.pending !== null) {
    scope.notice = '存在尚未确认的原请求，请先“重新发送原请求”。';
    renderScopeIfSelected(scope);
    return;
  }
  const target: CoreScope = run.scope ?? { projectId: scope.config.scope.projectId, workspaceId: scope.config.scope.workspaceId };
  // Prefer the CURRENT Host collaboration handle for this Goal; the legacy
  // browser Query is only a fallback when no Goal-driven handle exists.
  const goalRef = collaborationGoalRef(scope, run) ?? scope.collaboration?.goalRef ?? null;
  if (goalRef !== null) {
    run.goalRef = goalRef;
    const epoch = scope.collaborationEpoch + 1;
    scope.collaborationEpoch = epoch;
    await readCollaboration(scope, target, goalRef, epoch);
    if (scope.collaboration !== null && scope.collaboration.result.status === 'ready') {
      beginCollaborationPoll(scope, target, goalRef);
      return;
    }
  }
  if (run.queryRunRef !== null) {
    const ref = run.queryRunRef;
    await driveRun(scope, run, async (current, active) => {
      const observed = await executionCall(current, active, 'queries/observe', { scope: target, input: { queryRunRef: ref } });
      const problem = outcomeProblem(observed);
      if (problem !== null) { active.error = problem; return; }
      const observedPayload = payloadOf(observed) as QueriesStartResponse;
      if (observedPayload.status !== 'ready') { active.notice = '调查状态尚未就绪。'; return; }
      if (observedPayload.value.answer === null) { const observedRun = observedPayload.value.run.run; active.notice = queryNoAnswerNotice({ outcome: observedRun.outcome, phase: observedRun.executionState?.phase ?? null, status: observedRun.status }); return; }
      await readExecutionAnswer(current, active, target, observedPayload.value.answer.ref);
    });
    return;
  }
  scope.notice = '没有进行中的调查或协同推进。';
  renderScopeIfSelected(scope);
}
