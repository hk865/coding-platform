/** The center column: the conversation head, notices, goal-conversation start, project intro, observation and history body. */

import type { SessionRef, SessionsHistoryResponse } from '../../../app/core-http-types.js';
import { escapeHtml, renderGap } from '../../components/html.js';
import { topIcon } from '../../components/icons.js';
import type { ScopeState } from '../../state/scope-state.js';
import { centerSessionHistoryKey, record, sameSession } from '../../state/values.js';
import { state, view } from '../../state/workbench.js';
import { currentGoalObjective, renderGoalSetup, renderMemberMail } from './composer.js';
import { renderProjectConversation } from './project-render.js';
import { collaborationIsActive } from '../execution/collaboration.js';
import { renderCollaboration } from '../execution/panel.js';
import { renderInitialPlanning, renderQueryAnswer, renderWorkflowAdvance } from '../execution/render.js';
import { selectedExecutionProfile } from '../execution/run.js';
import { renderInitialPlanSetupReview, renderSessionHistoryTimeline } from '../history/timeline.js';
import { renderTaskExecutionFold, renderTaskExecutionTimeline } from '../observe/render.js';
import { AVAILABILITY_LABEL, memberLabel, roleLabel, sessionCardFor } from '../sessions/labels.js';
import { readyTaskGraphValue, sessionLifecycle } from '../tabs/aux-layout.js';

/** The center's own Session-history page for an exact Session (main or member). */
function centerHistory(scope: ScopeState, ref: SessionRef | null): { session: SessionRef; result: SessionsHistoryResponse } | null {
  if (ref === null) return null;
  const stored = scope.sessionHistories.get(centerSessionHistoryKey(ref)) ?? null;
  return stored !== null && sameSession(stored.session, ref) ? stored : null;
}

export function renderCenterHead(): string {
  const current = state();
  const active = current.activeSession;
  const session = active ?? current.mainSession;
  const label = active !== null ? memberLabel(current, active) : '主对话';
  const life = sessionLifecycle(current, session);
  const card = session === null ? null : sessionCardFor(current, session);
  const stateText = life === 'archived' ? '已归档 · 只读'
    : card === null ? (session === null ? '' : '状态未读取') : AVAILABILITY_LABEL[card.availability];
  const drawer = view.centerIdentityOpen
    ? `<div class="q-drawer" data-view="center-identity">`
      + (session === null
        ? '<p>尚未绑定主会话；发送目标后会由正式 Session 承载。</p>'
        : `<p><strong>${escapeHtml(label)}</strong></p><p>Session <code>${escapeHtml(session.sessionId)}</code></p>`
          + (card === null ? '' : `<p class="muted">角色 ${escapeHtml(roleLabel(card.record.role))} · 健康 ${escapeHtml(card.record.health)} · ${escapeHtml(card.record.lifecycle)}</p>`))
      + `</div>`
    : '';
  let menu = '';
  if (view.centerMenuOpen) {
    const modeButton = (mode: string, text: string): string =>
      `<button data-action="set-center-mode" data-mode="${mode}" aria-pressed="${String(view.centerMode === mode)}">${text}</button>`;
    const groupButton = (group: string, text: string): string =>
      `<button data-action="set-grouping" data-grouping="${group}" aria-pressed="${String(current.historyFold === (group === 'task'))}">${text}</button>`;
    const controls: string[] = [];
    if (session !== null && life !== 'archived') {
      controls.push(`<button data-action="read-center-history">刷新历史</button>`);
      const stored = centerHistory(current, session);
      if (stored !== null && stored.result.status === 'ready' && stored.result.value.nextCursor !== null) {
        controls.push(`<button data-action="next-center-history"${current.sending ? ' disabled' : ''}>继续加载</button>`);
      }
      if (selectedExecutionProfile(current) !== null) controls.push(`<button data-action="run-planning">形成方案</button>`);
      if (current.execution.advance !== null || current.execution.planning !== null) controls.push(`<button data-action="run-continue">采用并执行</button>`);
      if (current.collaboration !== null || current.execution.phase === 'running') controls.push(`<button data-action="stop-execution">停止推进</button>`);
    }
    const newGoal = current.goal === null && current.forms.goalId.trim().length === 0;
    if (newGoal) controls.push(`<button data-action="run-new-goal">新建目标</button>`);
    // No-Session 更多 keeps an explicit 开始调查 and plan entry for an existing Goal.
    if (session === null && !newGoal) {
      if (selectedExecutionProfile(current) !== null) controls.push(`<button data-action="run-planning">形成方案</button>`);
      controls.push(`<button data-action="start-goal-investigation">开始调查</button>`);
    }
    menu = `<div class="q-menu" data-view="center-menu">`
      + modeButton('chat', '对话') + modeButton('observe', '行为观察')
      + groupButton('original', '原序') + groupButton('task', 'Task 收纳')
      + controls.join('') + `</div>`;
  }
  return `<div class="q-titlebar" data-view="center-head" data-mode="${view.centerMode}">`
    + `<button data-action="toggle-center-identity" aria-expanded="${String(view.centerIdentityOpen)}">${escapeHtml(label)}</button>`
    + `<span class="q-fill"></span>`
    + (session === null ? '' : `<button data-action="view-latest"${current.sending ? ' disabled' : ''}>查看最新</button>`)
    + (stateText.length === 0 ? '' : `<span class="muted">${escapeHtml(stateText)}</span>`)
    + `<button class="q-icon" data-action="toggle-center-menu" aria-label="更多会话操作" aria-expanded="${String(view.centerMenuOpen)}" title="更多会话操作">${topIcon('ellipsis')}</button>`
    + `</div>` + drawer + menu;
}

function renderCenterNotices(current: ScopeState): string {
  const run = current.execution;
  const messages = [run.notice, current.executionNotice, run.error, current.error, current.notice]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const noticeBody = `<p class="muted" data-execution-notice>${messages.map(escapeHtml).join(' · ')}</p>`;
  const settled = !run.running && run.error === null && current.error === null && run.answer?.status === 'ready';
  const notice = messages.length === 0 ? '' : settled
    ? `<details class="q-fold" data-disclosure-key="execution-notice"><summary>执行提示</summary>${noticeBody}</details>` : noticeBody;
  const answer = run.answer === null ? '' : renderQueryAnswer(run.answer, run.body ?? undefined);
  const planning = run.planning === null ? '' : renderInitialPlanning(run.planning, run.planningRequest);
  const advance = run.advance === null ? '' : renderWorkflowAdvance(run.advance, run.advanceRequest);
  const facts = answer + planning + advance;
  const folded = facts.length === 0 ? '' : `<details class="q-fold" data-view="execution-facts"><summary class="cursor-interaction"><span class="q-chevron">›</span>本次执行事实（问答 / 规划 / 推进）</summary><div class="q-foldbody">${facts}</div></details>`;
  const candidate = current.planCandidate;
  const review = candidate === null ? ''
    : renderInitialPlanSetupReview(candidate.setup, { adopt: candidate.writable, plan: candidate.plan })
      + (candidate.writable ? '' : `<p class="muted">${escapeHtml(candidate.readonlyReason)}</p>`);
  const collaboration = current.collaboration === null ? '' : renderCollaboration(current, current.collaboration);
  return notice + review + collaboration + folded;
}

/** The narrow goal-conversation start surface. It offers only real, positively
 * read actions: 选择模型并开始调查 (existing settings), 开始调查 (explicit start)
 * and 继续准备调查 (a proven claimed/prepared original QueryRun). It never
 * adopts, executes or claims completion. */
function renderGoalConversationStart(scope: ScopeState): string {
  const start = scope.goalConversation.snapshot();
  const displayed = scope.activeSession ?? scope.mainSession;
  const resumable = scope.execution.resumable;
  const pieces: string[] = [];
  if (start.notice !== null) pieces.push(`<p class="muted" data-start-notice>${escapeHtml(start.notice)}</p>`);
  const resumableMatches = resumable !== null && sameSession(resumable.session, displayed);
  const resumableReady = resumableMatches && (resumable.phase === 'claimed' || resumable.phase === 'prepared');
  if (resumableMatches && !resumableReady) {
    const observation = `<p class="muted" data-start="observe">原调查已进入 ${escapeHtml(resumable.phase)}，这里只读取事实，不会重新开始。</p>`;
    pieces.push(resumable.phase === 'settled'
      ? `<details class="q-fold"><summary><span class="q-chevron">›</span>先前调查状态</summary>${observation}</details>`
      : observation);
  }
  const hasGoal = scope.goal !== null || scope.forms.goalId.trim().length > 0;
  const startBusy = start.status === 'creating' || start.status === 'investigating';
  // The controller requested settings (missing profile) or the no-Session Goal
  // has no current profile. The SAME settings action is shown once, for a
  // displayed Session as well; a profile that appeared meanwhile clears it.
  const needsSettings = selectedExecutionProfile(scope) === null
    && (start.action === '选择模型并开始调查' || (!startBusy && displayed === null && hasGoal));
  if (resumableReady && !needsSettings) {
    pieces.push(`<section class="policy-choice" data-view="goal-start" data-start="resume">`
      + `<p>原会话 ${escapeHtml(resumable.session.sessionId)} 已有正式调查（${escapeHtml(resumable.phase)}），可以继续准备。</p>`
      + `<div class="buttons"><button data-action="resume-original-investigation">继续准备调查</button></div></section>`);
  }
  if (needsSettings) {
    pieces.push(`<section class="policy-choice" data-view="goal-start" data-start="needs-profile">`
      + `<p>当前工作区没有可用的模型/调查配置，请选择模型后继续。</p>`
      + `<div class="buttons"><button data-action="open-goal-model-settings">选择模型并开始调查</button></div></section>`);
  } else if (displayed === null && hasGoal && !startBusy) {
    pieces.push(`<section class="policy-choice" data-view="goal-start" data-start="ready">`
      + `<div class="buttons"><button data-action="start-goal-investigation">开始调查</button></div></section>`);
  }
  const goalRead = record(scope.goalRead);
  const detail = goalRead.status === 'ready' ? record(goalRead.value) : null;
  if (scope.activeSession === null && scope.mainSession !== null && hasGoal
    && selectedExecutionProfile(scope) !== null && sessionLifecycle(scope, scope.mainSession) !== 'archived'
    && !startBusy && !scope.execution.running && scope.execution.pending === null
    && scope.pending === null && !scope.sending && scope.memberMail?.consultState !== 'running'
    && detail !== null && detail.pendingPlan === null && record(detail.goal).activePlanRevision === null) {
    pieces.push(`<div class="initial-plan-next" data-view="planning-next">`
      + `<button data-action="run-planning">形成方案</button>`
      + `<span class="muted">先审阅方案，采用后才写文件和运行命令。</span></div>`);
  }
  if (scope.activeSession === null && detail !== null && record(detail.goal).activePlanRevision != null
    && !scope.execution.running && scope.execution.pending === null && scope.pending === null
    && !scope.sending && !collaborationIsActive(scope.collaboration?.result ?? { status: 'not_found' })
    && !(scope.collaboration?.result.status === 'ready' && scope.collaboration.result.value.state === 'completed')) {
    pieces.push('<div class="buttons"><button data-action="run-continue">继续推进</button></div>');
  }
  return pieces.join('');
}

function renderProjectIntro(current: ScopeState): string {
  const profile = selectedExecutionProfile(current);
  const goalId = current.goal?.ref.goalId ?? (current.forms.goalId.trim().length > 0 ? current.forms.goalId.trim() : null);
  return `<section class="conversation" data-view="project-conversation">`
    + renderProjectConversation({ scope: current.config.scope, workspaceName: current.config.name,
      goalText: currentGoalObjective(current), goalId, projectState: current.projectReadState, hasProfile: profile !== null })
    + (current.goalSetup === null ? '' : renderGoalSetup(current.goalSetup))
    + renderGoalConversationStart(current)
    + renderCenterNotices(current) + `</section>`;
}

function renderObserve(current: ScopeState, session: SessionRef | null): string {
  const list = current.executionList;
  if (list === null) {
    return `<section class="conversation" data-view="observe"><p class="muted">行为观察读取当前目标已有的真实执行事实；不新增语义推断。</p>`
      + `<div class="buttons"><button data-action="load-executions">读取执行事实</button></div>`
      + renderCenterNotices(current) + `</section>`;
  }
  return `<section class="conversation" data-view="observe" data-session="${session === null ? '' : escapeHtml(session.sessionId)}">`
    + renderTaskExecutionTimeline({ items: list.items, nextCursor: list.nextCursor, readThrough: list.readThrough },
      current.timeline, readyTaskGraphValue(current)?.tasks)
    + renderTaskExecutionFold({ items: list.items, nextCursor: list.nextCursor, readThrough: list.readThrough })
    + renderCenterNotices(current) + `</section>`;
}

export function renderCenterBody(): string {
  const current = state();
  const active = current.activeSession;
  const session = active ?? current.mainSession;
  if (view.centerMode === 'observe') return renderObserve(current, session);
  if (session === null) return renderProjectIntro(current);
  const stored = centerHistory(current, session);
  const list = current.executionList;
  const executions = current.historyFold && list !== null ? list.items : undefined;
  const history = stored === null
    ? renderGap('sessions/history', active !== null
      ? '尚未读取该成员的完整原历史；点击标题旁的“更多”后读取历史。'
      : '尚未读取主会话的原历史；点击标题旁的“更多”后读取历史。')
    : renderSessionHistoryTimeline(stored.result, executions);
  const readyHistory = stored !== null && stored.result.status === 'ready' ? stored.result.value : null;
  const historyActions = readyHistory === null ? ''
    : `<div class="buttons history-continue">`
      + (readyHistory.nextCursor === null ? '' : `<button data-action="next-center-history"${current.sending ? ' disabled' : ''}>继续加载</button>`)
      + `</div>`;
  const mail = current.memberMail !== null && sameSession(current.memberMail.session, session) ? current.memberMail : null;
  // Task grouping is a mode over the SAME saved events; it never parks a second
  // execution list or a button wall in the conversation.
  return `<section class="conversation" data-view="center-body" data-session="${escapeHtml(session.sessionId)}">`
    + `<div class="chat-stream">${history}${historyActions}${mail === null ? '' : renderMemberMail(mail)}${renderGoalConversationStart(current)}${renderCenterNotices(current)}</div></section>`;
}
