import type {
  CoreRouteSuffix,
  ProjectsReadResponse,
  WorkspacesRegistrationResponse,
} from '../../../app/core-http-types.js';
import { callCore, outcomeProblem, outcomeRejectionReason, payloadOf } from '../../api/http.js';
import type { CallOutcome } from '../../api/http.js';
import { noTags } from '../../api/request-tags.js';
import { saveScopeDisplay } from '../../state/display-preference.js';
import type { WorkbenchLayout } from '../../state/layout.js';
import type { GoalSetupRun, GoalValue, ProjectValue, ScopeState, WorkspaceValue } from '../../state/scope-state.js';
import { projectRefFor, record, workspaceRefFor } from '../../state/values.js';
import { freshRequestId, nextRequestSeq, renderScopeIfSelected } from '../../state/workbench.js';

// ---------------------------------------------------------------------------
// MVP UI connection consumers.
//
// New Goal cold start, member mail with consumeConsultation, Kernel file CAS,
// explicit command handles and the bounded execution list that feeds the
// timeline, the Task fold and the active-module computation. Every identity and
// original body is frozen before the first await; no error text is parsed and no
// revision is guessed.
// ---------------------------------------------------------------------------

/** Serialize the composer draft plus every real reference into the ONE request
 * text actually sent. A draft snapshot carries the exact selected text, path,
 * span, version and digest, so the receiver can tell a draft snapshot from the
 * saved file. Adding a reference alone never sends anything. */
export function composeRequestText(layout: WorkbenchLayout): string {
  const base = layout.composerDraft.text;
  const references = layout.composerDraft.references;
  if (references.length === 0) return base;
  const blocks = references.map(reference => reference.kind === 'path'
    ? `[引用文件] ${reference.path}`
    : `[引用选区] ${reference.path}:L${reference.startLine}-L${reference.endLine}`
      + ` version=${JSON.stringify(reference.version)} digest=${reference.digest} source=${reference.source}`
      + `\n\u0060\u0060\u0060\n${reference.text}\n\u0060\u0060\u0060`);
  return `${base}\n\n${blocks.join('\n\n')}`;
}

function setupRequestId(run: GoalSetupRun, key: string): string {
  const existing = run.requestIds[key];
  if (existing !== undefined) return existing;
  const value = freshRequestId(key);
  run.requestIds[key] = value;
  return value;
}

function createGoalSetup(objective: string): GoalSetupRun {
  const seq = nextRequestSeq();
  return { running: false, objective, goalId: `goal-${Date.now().toString(36)}-${seq.toString(36)}`,
    requestIds: {}, calls: [], callIndex: 0, pendingIndex: null, pending: null, driver: null,
    project: null, workspace: null, goal: null, step: null, error: null, notice: null };
}

async function setupCall(scope: ScopeState, run: GoalSetupRun, route: CoreRouteSuffix, request: unknown): Promise<CallOutcome> {
  const index = run.callIndex;
  run.callIndex += 1;
  let call = run.calls[index];
  if (call === undefined) { call = { route, request, outcome: null }; run.calls.push(call); }
  else { call.route = route; request = call.request; }
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

export async function runGoalSetup(scope: ScopeState, retry = false): Promise<void> {
  const text = scope.goalObjective.trim();
  if (text.length === 0) { scope.error = '请先写下目标正文（不是内部标识）。'; renderScopeIfSelected(scope); return; }
  if (scope.goalSetup !== null && scope.goalSetup.running) return;
  const previous = scope.goalSetup;
  if (!retry && previous?.pending !== null && previous?.pending !== undefined) {
    scope.error = '原目标请求结果未确认，请重试原请求，不能替换目标正文。'; renderScopeIfSelected(scope); return;
  }
  if (!retry && previous !== null && previous.goal === null && previous.objective !== text) {
    scope.error = '当前目标尚未建立完成，请保留原目标正文并完成原流程。'; renderScopeIfSelected(scope); return;
  }
  const run = previous === null || (!retry && previous.goal !== null) ? createGoalSetup(text) : previous;
  scope.goalSetup = run;
  // Replay the original ordered call buffer, including confirmed reads.
  run.callIndex = 0;
  run.project = null;
  run.workspace = null;
  run.running = true;
  run.error = null;
  run.notice = null;
  run.step = '读取项目登记';
  scope.error = null;
  scope.notice = null;
  renderScopeIfSelected(scope);
  try {
    await (run.driver ?? goalSetupDriver)(scope, run);
  } catch (error) {
    run.error = `新建目标中断：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    run.running = false;
    renderScopeIfSelected(scope);
  }
}

export async function retryGoalSetup(scope: ScopeState): Promise<void> {
  const run = scope.goalSetup;
  if (run === null || run.pending === null || run.running) return;
  const pending = run.pending;
  const failedIndex = run.pendingIndex ?? run.callIndex - 1;
  scope.sending = true;
  renderScopeIfSelected(scope);
  const outcome = await callCore(pending.route, pending.request);
  scope.sending = false;
  if (outcome.kind === 'network') { scope.error = '连接中断，未收到回执。可重新发送原请求（内容保持不变）。'; renderScopeIfSelected(scope); return; }
  scope.pending = null;
  run.pending = null;
  run.pendingIndex = null;
  if (failedIndex >= 0 && run.calls[failedIndex] !== undefined) run.calls[failedIndex]!.outcome = outcome;
  run.callIndex = 0;
  await runGoalSetup(scope, true);
}

/** The frozen cold-start chain: narrow Project read -> (create) -> Workspace
 * registration read -> (register) -> goals/create. It never guesses revision 1
 * and never derives the Project's absence from an error message. */
async function goalSetupDriver(scope: ScopeState, run: GoalSetupRun): Promise<void> {
  run.driver = goalSetupDriver;
  const target = scope.config.scope;
  if (run.project === null) {
    const read = await setupCall(scope, run, 'projects/read', { scope: target, input: target.projectId });
    const problem = outcomeProblem(read);
    if (problem !== null) { run.error = problem; return; }
    const payload = payloadOf(read) as ProjectsReadResponse;
    if (payload.status === 'ready') {
      scope.project = payload.value as ProjectValue;
      run.project = { ref: payload.value.ref, revision: payload.value.revision };
      scope.projectReadState = { status: 'ready', projectId: payload.value.ref.projectId, revision: payload.value.revision };
    } else if (payload.status === 'not_found' || (payload.status === 'rejected' && payload.code === 'not_found')) {
      scope.projectReadState = { status: 'not_found' };
      run.step = '创建项目';
      const request = { scope: target, request: { input: { projectId: target.projectId },
        meta: { requestId: setupRequestId(run, 'projects/create'), expected: [{ ref: projectRefFor(target.projectId), revision: 0 }] } } };
      const created = await setupCall(scope, run, 'projects/create', request);
      const createProblem = outcomeProblem(created);
      if (createProblem !== null) { run.error = createProblem; return; }
      const createdBody = payloadOf(created);
      if (record(createdBody).status !== 'committed') { run.error = `创建项目未成功：${outcomeRejectionReason(createdBody)}`; return; }
      scope.project = record(createdBody).value as ProjectValue;
      const value = record(record(createdBody).value);
      run.project = { ref: value.ref ?? projectRefFor(target.projectId), revision: typeof value.revision === 'number' ? value.revision : 0 };
      scope.projectReadState = { status: 'ready', projectId: target.projectId, revision: run.project.revision };
    } else if (payload.status === 'rejected') {
      scope.projectReadState = { status: 'rejected', code: payload.code, reason: payload.reason };
      run.error = `项目读取未就绪（${payload.code}）：${payload.reason}`;
      return;
    } else {
      scope.projectReadState = { status: 'rejected', code: payload.status, reason: '项目投影尚未就绪' };
      run.error = '项目投影尚未就绪；不会猜测 revision，也不会继续。';
      return;
    }
  }
  if (run.workspace === null) {
    run.step = '读取工作区登记';
    const registration = await setupCall(scope, run, 'workspaces/registration', { scope: target, input: target });
    const problem = outcomeProblem(registration);
    if (problem !== null) { run.error = problem; return; }
    const payload = payloadOf(registration) as WorkspacesRegistrationResponse;
    if (payload.status === 'ready') {
      scope.project = payload.value.project;
      scope.workspace = payload.value.workspace;
      run.workspace = { ref: payload.value.workspace.ref, revision: payload.value.workspace.revision };
      if (run.project === null) run.project = { ref: payload.value.project.ref, revision: payload.value.project.revision };
    } else if (payload.status === 'not_found' || (payload.status === 'rejected' && payload.code === 'not_found')) {
      if (run.project === null) { run.error = '项目尚未就绪，无法登记工作区。'; return; }
      run.step = '登记工作区';
      const request = { scope: target, request: { input: { workspace: target },
        meta: { requestId: setupRequestId(run, 'workspaces/register'),
          expected: [{ ref: run.project.ref, revision: run.project.revision }, { ref: workspaceRefFor(target), revision: 0 }] } } };
      const created = await setupCall(scope, run, 'workspaces/register', request);
      const createProblem = outcomeProblem(created);
      if (createProblem !== null) { run.error = createProblem; return; }
      const createdBody = payloadOf(created);
      if (record(createdBody).status !== 'committed') { run.error = `工作区登记未成功：${outcomeRejectionReason(createdBody)}`; return; }
      scope.workspace = record(createdBody).value as WorkspaceValue;
      const value = record(record(createdBody).value);
      run.workspace = { ref: value.ref ?? workspaceRefFor(target), revision: typeof value.revision === 'number' ? value.revision : 0 };
    } else if (payload.status === 'rejected') {
      run.error = `工作区登记读取未就绪（${payload.code}）：${payload.reason}`;
      return;
    } else {
      run.error = '工作区登记投影尚未就绪；不会猜测 revision，也不会继续。';
      return;
    }
  }
  run.step = '创建目标';
  const goalRequest = { scope: target, request: { input: { goalId: run.goalId, workspace: target, objective: run.objective },
    meta: { requestId: setupRequestId(run, 'goals/create'),
      expected: [{ ref: run.project.ref, revision: run.project.revision }, { ref: run.workspace.ref, revision: run.workspace.revision }] } } };
  const goalOutcome = await setupCall(scope, run, 'goals/create', goalRequest);
  const goalProblem = outcomeProblem(goalOutcome);
  if (goalProblem !== null) { run.error = goalProblem; return; }
  const goalBody = payloadOf(goalOutcome);
  if (record(goalBody).status !== 'committed') { run.error = `创建目标未成功：${outcomeRejectionReason(goalBody)}`; return; }
  run.goal = record(goalBody).value;
  scope.goal = run.goal as GoalValue;
  scope.goalObjective = run.objective;
  scope.forms.goalId = run.goalId;
  run.step = '已创建';
  run.notice = '目标已创建，可以开始调查和规划。';
  saveScopeDisplay(scope);
}
