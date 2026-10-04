import type {
  BootstrapExecutionQueryProfile,
  CoreRouteSuffix,
  CoreScope,
  MaterialsOpenResponse,
  QueriesAnswerResponse,
  RoleConfigurationRef,
  SessionsCreateResponse,
  SessionsReadResponse,
} from '../../../app/core-http-types.js';
import { callCore, outcomeProblem, outcomeRejectionReason, payloadOf } from '../../api/http.js';
import type { CallOutcome } from '../../api/http.js';
import { noTags } from '../../api/request-tags.js';
import type {
  ExecutionDriver,
  ExecutionRun,
  QueryJobAnswerRef,
  ScopeState,
  SessionAggregateRef,
} from '../../state/scope-state.js';
import { bootstrap, freshRequestId, renderScopeIfSelected } from '../../state/workbench.js';

// ---------------------------------------------------------------------------
// R6 execution entry: the finite Query / initial-Plan / Workflow consumer.
//
// One explicit user action sends ONE public request at a time. Every request is
// saved before it is sent; a ready result with a real `next` continues along the
// continuation seam, while waiting/needs_decision/unknown/network/rejected stop
// and keep the original request. The in-page call buffer lets the existing retry
// entry resend the exact body and resume at the failed call without rebuilding
// the flow. There is no timer, no background loop and no second Workflow state
// machine; completion is only displayed from the owner's formal result.
// ---------------------------------------------------------------------------

export function selectedExecutionProfile(scope: ScopeState): BootstrapExecutionQueryProfile | null {
  const selected = scope.config.scope;
  const profiles = (bootstrap()?.execution.queryProfiles ?? []).filter(profile =>
    profile.scope.projectId === selected.projectId && profile.scope.workspaceId === selected.workspaceId);
  if (profiles.length === 0) return null;
  const id = scope.executionProfileId;
  return profiles.find(profile => profile.id === id) ?? profiles[0] ?? null;
}

/** The CURRENT bootstrap profile for an explicit target scope. Unlike
 * `selectedExecutionProfile`, it is not tied to the currently selected scope. */
export function executionProfileForScope(scope: ScopeState, target: CoreScope): BootstrapExecutionQueryProfile | null {
  const profiles = (bootstrap()?.execution.queryProfiles ?? []).filter(profile =>
    profile.scope.projectId === target.projectId && profile.scope.workspaceId === target.workspaceId);
  if (profiles.length === 0) return null;
  return profiles.find(profile => profile.id === scope.executionProfileId) ?? profiles[0] ?? null;
}

/** Complete structural Role equality for Session reuse only; a trust decision
 * still belongs to the owner. */
export function sameExecutionRole(left: RoleConfigurationRef, right: RoleConfigurationRef): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'role_spec' && right.kind === 'role_spec') {
    return left.pin.ref.projectId === right.pin.ref.projectId && left.pin.ref.roleId === right.pin.ref.roleId
      && left.pin.ref.revision === right.pin.ref.revision && left.pin.digest === right.pin.digest;
  }
  if (left.kind === 'legacy_template' && right.kind === 'legacy_template')
    return left.templateId === right.templateId && left.templateRevision === right.templateRevision;
  return false;
}

/** One stable request id per logical execution request, so re-entering the flow
 * after a retry replays the exact same bodies instead of refreshing identities. */
export function executionRequestId(run: ExecutionRun, key: string): string {
  const existing = run.requestIds[key];
  if (existing !== undefined) return existing;
  const value = freshRequestId(key);
  run.requestIds[key] = value;
  return value;
}

/** Send one execution request through the existing transport. The exact body is
 * kept BEFORE the send; a network outcome leaves `scope.pending`/`run.pending`
 * so the existing retry entry can resend the identical request. A confirmed
 * outcome is memoized in the in-page call buffer so the retry resumes at the
 * failed call instead of rebuilding flow/job/run/session/requestId/budget. */
export async function executionCall(
  scope: ScopeState, run: ExecutionRun, route: CoreRouteSuffix, request: unknown,
): Promise<CallOutcome> {
  const index = run.callIndex;
  run.callIndex += 1;
  let call = run.calls[index];
  if (call === undefined) {
    call = { route, request, outcome: null };
    run.calls.push(call);
  } else {
    // Re-entry: the stored body is authoritative; the freshly built one is
    // discarded so no identity is refreshed.
    call.route = route;
    request = call.request;
  }
  if (call.outcome !== null) return call.outcome;
  run.pending = { route, request };
  scope.sending = true;
  scope.pending = null;
  renderScopeIfSelected(scope);
  const outcome = await callCore(route, request);
  scope.sending = false;
  if (outcome.kind === 'network') {
    run.pendingIndex = index;
    scope.pending = { route, body: request, tags: noTags };
    renderScopeIfSelected(scope);
    return outcome;
  }
  scope.pending = null;
  run.pending = null;
  run.pendingIndex = null;
  call.outcome = outcome;
  return outcome;
}

/** Run one full driver, remembering the exact driver so a network retry can
 * replay the same flow instead of re-running the user action. */
export async function driveRun(scope: ScopeState, run: ExecutionRun, driver: ExecutionDriver): Promise<void> {
  run.running = true;
  run.driver = driver;
  run.driverStart = run.callIndex;
  run.error = null;
  renderScopeIfSelected(scope);
  try {
    await driver(scope, run);
  } catch (error) {
    run.error = `执行中断：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    run.running = false;
    renderScopeIfSelected(scope);
  }
}

/**
 * Resolve the Session for this exact action. A user-selected Session is handled
 * through the original public read and its current facts: busy waits, an
 * incompatible or unreadable selection is reported, and NO second Session is
 * created behind the user's back. Only a clearly unselected action creates one.
 */
export async function resolveExecutionSession(
  scope: ScopeState, run: ExecutionRun, target: CoreScope,
): Promise<SessionAggregateRef | null> {
  const selected = run.selectedSession;
  if (selected !== null) {
    const read = await executionCall(scope, run, 'sessions/read', { scope: target, input: selected });
    const problem = outcomeProblem(read);
    if (problem !== null) { run.error = problem; return null; }
    const readPayload = payloadOf(read) as SessionsReadResponse;
    if (readPayload.status !== 'ready') {
      run.error = '已选会话当前详情不可读，无法确认占用与角色；未创建替代会话。';
      return null;
    }
    const card = readPayload.value;
    if (card.record.lifecycle !== 'active') {
      run.error = '已选会话不是 active，无法用于本次执行；未创建替代会话。';
      return null;
    }
    if (card.availability === 'busy') {
      run.notice = '已选会话当前忙碌；请等待或选择空闲会话，页面不会另建会话绕过占用。';
      return null;
    }
    if (run.profile === null || !sameExecutionRole(card.record.role, run.profile.sessionRole)) {
      run.error = '已选会话的角色与所选执行配置不一致；请选择匹配的会话，页面不会猜另一个角色。';
      return null;
    }
    run.sessionRef = card.record.ref;
    run.sessionRevision = card.record.revision;
    return card.record.ref;
  }
  const profile = run.profile;
  if (profile === null) { run.error = '当前工作区没有可用的只读调查配置。'; return null; }
  const createRequest = { scope: target, input: {
    workspace: target, role: profile.sessionRole, recommendedRefs: [], initialLinks: [],
    meta: { requestId: executionRequestId(run, 'sessions/create'), expected: [] },
  } };
  const created = await executionCall(scope, run, 'sessions/create', createRequest);
  const problem = outcomeProblem(created);
  if (problem !== null) { run.error = problem; return null; }
  const payload = payloadOf(created) as SessionsCreateResponse;
  if (payload.status === 'accepted') {
    run.notice = '会话创建处理中：请先“刷新创建状态”，完成后再执行。';
    return null;
  }
  if (payload.status !== 'completed') {
    run.error = `会话创建未完成：${outcomeRejectionReason(payload)}`;
    return null;
  }
  run.sessionRef = payload.value.ref;
  run.sessionRevision = payload.value.revision;
  return payload.value.ref;
}

export async function readExecutionAnswer(
  scope: ScopeState, run: ExecutionRun, target: CoreScope, answerRef: QueryJobAnswerRef,
): Promise<boolean> {
  const answerRead = await executionCall(scope, run, 'queries/answer', { scope: target, input: answerRef });
  const answerProblem = outcomeProblem(answerRead);
  if (answerProblem !== null) { run.error = answerProblem; return false; }
  run.answer = payloadOf(answerRead) as QueriesAnswerResponse;
  if (run.answer.status !== 'ready') { run.notice = '正式回答尚未就绪。'; return false; }
  const bodyRead = await executionCall(scope, run, 'materials/open', { scope: target, input: {
    ref: run.answer.value.answer.bodyRef, usage: 'historical_explanation' } });
  const bodyProblem = outcomeProblem(bodyRead);
  if (bodyProblem !== null) { run.error = bodyProblem; return false; }
  run.body = payloadOf(bodyRead) as MaterialsOpenResponse;
  return true;
}
