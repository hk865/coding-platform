/// <reference lib="dom" />
/** The execution panel: the read-only collaboration projection, the entry availability and the setup-page execution entry. */

import type { WorkflowDriverReadResponse } from '../../../app/core-http-types.js';
import { actionButton, detailsBlock, escapeHtml } from '../../components/html.js';
import type { ExecutionRun, ScopeState } from '../../state/scope-state.js';
import { sameMessage } from '../../state/values.js';
import { bootstrap, state } from '../../state/workbench.js';
import { collaborationGoalRef, collaborationIsActive } from './collaboration.js';
import { renderExecutionProfiles, renderInitialPlanning, renderQueryAnswer, renderWorkflowAdvance } from './render.js';
import { renderInitialPlanSetupReview } from '../history/timeline.js';
import { renderMessage, renderMessageBody } from '../sessions/render.js';

/** The read-only Host collaboration projection: the page shows the driver's own
 * state/messages and never re-derives or fakes a terminal. */
export function renderCollaboration(
  scope: ScopeState, collab: { goalRef: NonNullable<ExecutionRun['goalRef']>; result: WorkflowDriverReadResponse },
): string {
  if (collab.result.status === 'not_found') {
    return `<section data-collaboration><h3>协同推进</h3>`
      + `<p class="muted">本机没有目标 <code>${escapeHtml(collab.goalRef.goalId)}</code> 的活动句柄；原消息/回答仍在原历史中可查。</p></section>`;
  }
  if (collab.result.status !== 'ready') return '';
  const value = collab.result.value;
  const active = scope.activeMessage;
  const readMessage = active !== null && scope.message !== null && sameMessage(scope.message.messageRef, active)
    ? scope.message : null;
  const body = active !== null && scope.messageBody !== null && sameMessage(scope.messageBody.messageRef, active)
    ? scope.messageBody : null;
  const messages = value.messages.length === 0 ? ''
    : `<ul class="messages">${value.messages.map(message => {
      const isActive = active !== null && sameMessage(message.ref, active);
      return `<li${isActive ? ' data-active-message="true"' : ''}>`
        + `<code>${escapeHtml(message.ref.messageId)}</code> · ${escapeHtml(message.status)}`
        + ` · ${escapeHtml(message.sender.kind)}`
        + (message.waitAfterSend === true ? ' · 等待回复' : '')
        + `<button class="link" data-action="read-collaboration-message" data-message-id="${escapeHtml(message.ref.messageId)}">查看消息</button>`
        + `</li>`;
    }).join('')}</ul>`;
  const siblings = value.siblings.length === 0 ? '' : `<ul>${value.siblings.map(sibling =>
    `<li><button class="link" data-action="select-collaboration-task" data-task-id="${escapeHtml(sibling.taskId ?? '')}">${escapeHtml(sibling.taskId ?? '目标整体')}</button> · ${escapeHtml(sibling.state)}</li>`
  ).join('')}</ul>`;
  return `<section data-collaboration><h3>协同推进</h3>`
    + `<p>${escapeHtml(value.taskId ?? '目标整体')} · 状态：${escapeHtml(value.state)}</p>`
    + siblings
    + (value.reason === null ? '' : `<p class="muted">${escapeHtml(value.reason)}</p>`)
    + messages
    + (readMessage === null ? '' : renderMessage(readMessage.result))
    + (body === null ? '' : renderMessageBody(body.result))
    + detailsBlock('查看完整快照', `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`)
    + `</section>`;
}

/** The execution entry availability derived from the CURRENT explicit Goal (a
 * typed/selected Goal counts even before any in-memory handle exists) plus the
 * real run/handle state. `run.running`/`run.pending` protection stays outside. */
function executionAvailability(scope: ScopeState): {
  canContinue: boolean; canRefresh: boolean; driverActive: boolean;
} {
  const run = scope.execution;
  const currentGoal = collaborationGoalRef(scope, run);
  const driverActive = scope.collaboration !== null && collaborationIsActive(scope.collaboration.result);
  return {
    canContinue: run.resumeIntent !== null || run.queryRunRef !== null
      || currentGoal !== null || scope.collaboration !== null,
    canRefresh: run.queryRunRef !== null || currentGoal !== null || scope.collaboration !== null,
    driverActive,
  };
}

/** Update the execution action buttons in place after a Goal edit so the formal
 * read/start entry becomes usable WITHOUT rebuilding the focused input. */
export function refreshExecutionButtons(scope: ScopeState): void {
  const run = scope.execution;
  const { canContinue, canRefresh, driverActive } = executionAvailability(scope);
  const set = (action: string, enabled: boolean, reason: string): void => {
    const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (button === null) return;
    button.disabled = !enabled;
    if (enabled) button.removeAttribute('title');
    else button.setAttribute('title', reason);
  };
  set('run-continue', canContinue && !run.running && run.pending === null,
    run.pending === null ? '需要先有采用的计划或待续传步骤' : '存在尚未确认的原请求，请先重试');
  set('refresh-execution', canRefresh && !run.running, '没有进行中的调查或推进句柄');
  set('stop-execution', driverActive && !run.running, '没有进行中的协同推进');
}

/** R6 execution entry: the trusted startup execution projection, the one
 * question input and the two finite product actions plus the real owner results.
 * It never sends an HTTP step by itself, opens a background loop or marks a
 * result complete. */
export function renderExecution(): string {
  const loaded = bootstrap();
  if (loaded === null) return '';
  const current = state();
  const run = current.execution;
  const profiles = renderExecutionProfiles(loaded.execution, current.executionProfileId ?? undefined,
    run.running || run.pending !== null);
  const question = `<label class="inline">调查 / 规划问题 <input data-field="question" `
    + `value="${escapeHtml(current.forms.question)}" placeholder="例如：阅读来源并给出初始规划"></label>`;
  const { canContinue, canRefresh, driverActive } = executionAvailability(current);
  const taskSelection = `<label class="inline">指定 Task（可空） <input data-field="taskId" `
    + `value="${escapeHtml(current.forms.taskId)}" placeholder="例如：work-1"></label>`;
  const buttons = taskSelection + `<div class="buttons">`
    + actionButton('run-continue', '继续执行', canContinue && !run.running && run.pending === null,
      run.pending === null ? '需要先有采用的计划或待续传步骤' : '存在尚未确认的原请求，请先重试')
    + actionButton('review-plan-candidate', '审阅当前候选方案', run.planning !== null, '尚无可审阅的候选')
    + actionButton('refresh-execution', '刷新执行状态', canRefresh && !run.running, '没有进行中的调查或推进句柄')
    + actionButton('stop-execution', '停止推进', driverActive && !run.running,
      driverActive ? '' : '没有进行中的协同推进')
    + `</div>`;
  const messages = [run.notice, current.executionNotice, run.error].filter((entry): entry is string =>
    typeof entry === 'string' && entry.length > 0);
  const notice = messages.length === 0 ? ''
    : `<p class="muted" data-execution-notice>${messages.map(escapeHtml).join(' · ')}</p>`;
  const phase = run.phase === null ? ''
    : `<p class="muted" data-execution-phase>当前阶段：${escapeHtml(run.phase)}</p>`;
  const answer = run.answer === null ? '' : renderQueryAnswer(run.answer, run.body ?? undefined);
  const candidate = run.candidate === null ? ''
    : detailsBlock('已保留的初始计划候选', `<pre>${escapeHtml(JSON.stringify(run.candidate, null, 2))}</pre>`);
  const setupCandidate = current.planCandidate;
  const initialPlanSetup = setupCandidate === null ? ''
    : renderInitialPlanSetupReview(setupCandidate.setup, { adopt: setupCandidate.writable, plan: setupCandidate.plan })
      + (setupCandidate.writable ? ''
        : `<p class="muted" data-initial-plan-readonly>${escapeHtml(setupCandidate.readonlyReason)}</p>`);
  const planning = run.planning === null ? '' : renderInitialPlanning(run.planning, run.planningRequest);
  const advance = run.advance === null ? '' : renderWorkflowAdvance(run.advance, run.advanceRequest);
  const collaboration = current.collaboration === null ? '' : renderCollaboration(current, current.collaboration);
  const sent = run.calls.length === 0 ? ''
    : detailsBlock('已发送的完整原请求', `<pre>${escapeHtml(JSON.stringify(
      run.calls.map(call => ({ route: call.route, request: call.request })), null, 2))}</pre>`);
  return profiles + question + buttons + notice + phase + answer + candidate + initialPlanSetup + planning + advance + collaboration + sent;
}
