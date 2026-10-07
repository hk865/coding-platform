/** The composer and the conversation panels it sits with: Goal objective, new-Goal setup, member mail. */

import { outcomeRejectionReason } from '../../api/http.js';
import { detailsBlock, escapeHtml } from '../../components/html.js';
import { topIcon } from '../../components/icons.js';
import type { GoalSetupRun, MemberMailState, ScopeState } from '../../state/scope-state.js';
import { record } from '../../state/values.js';
import { state } from '../../state/workbench.js';
import { renderQueryAnswer } from '../execution/render.js';
import { selectedExecutionProfile } from '../execution/run.js';
import { memberLabel } from '../sessions/labels.js';
import { renderMessage } from '../sessions/render.js';
import { syncActiveLayout } from '../tabs/aux-layout.js';

export function currentGoalObjective(scope: ScopeState): string {
  if (scope.goalObjective.length > 0) return scope.goalObjective;
  if (scope.goal !== null && typeof scope.goal.objective === 'string') return scope.goal.objective;
  const read = record(scope.goalRead);
  if (read.status === 'ready') {
    const goal = record(record(read.value).goal);
    if (typeof goal.objective === 'string') return goal.objective;
  }
  return scope.forms.objective;
}

/** New-Goal cold-start progress: the generated goal id and step, the frozen
 * original requests and a real retry when a request is unconfirmed. */
export function renderGoalSetup(run: GoalSetupRun): string {
  const status = run.error !== null ? `<p class="error">${escapeHtml(run.error)}</p>`
    : run.notice !== null ? `<p class="notice">${escapeHtml(run.notice)}</p>` : '';
  const pending = run.pending === null ? ''
    : `<div class="buttons"><button data-action="retry">重新发送原请求</button></div>`;
  return `<section class="panel" data-view="goal-setup" data-step="${escapeHtml(run.step ?? '')}">`
    + `<header><h4>新建目标</h4><p class="muted">${escapeHtml(run.step ?? '准备中')}</p></header>`
    + status + pending
    + detailsBlock('查看已发送的完整原请求', `<pre>${escapeHtml(JSON.stringify(
      run.calls.map(call => ({ route: call.route, request: call.request })), null, 2))}</pre>`)
    + `</section>`;
}

/** The saved/handled/answered states stay separate. An action_request reply is
 * a read-only Query; it is never rendered as an accomplished write action. */
export function renderMemberMail(mail: MemberMailState): string {
  const send = mail.sendState === 'saving' ? '正在保存…'
    : mail.sendState === 'failed' ? '保存结果未确认'
    : mail.sendState === 'rejected' ? '已被拒绝（可修改后重新发送）' : '已保存';
  const consult = mail.consultState === 'running' ? '处理中' : mail.consultState === 'waiting' ? '等待处理'
    : mail.consultState === 'responded' ? '已回答' : mail.consultState === 'processed' ? '已处理'
    : mail.consultState === 'ended' ? '已结束（无正式答复）'
    : mail.consultState === 'rejected' ? '未处理' : '尚未处理';
  // One visible status line + the actionable buttons; the full message / Answer /
  // references stay reachable inside one receipt fold instead of being reprinted.
  let receipt = '';
  if (mail.consultation !== null && mail.consultation.status === 'ready') {
    const value = mail.consultation.value;
    receipt = `<details class="mail-receipt" data-mail-receipt="${escapeHtml(value.state)}"><summary>查看回执</summary>`
      + `<p class="muted" data-consultation-state="${escapeHtml(value.state)}">结果：${escapeHtml(value.state)}`
      + (value.reason === null ? '' : ` · ${escapeHtml(value.reason)}`) + `</p>`
      + renderMessage({ status: 'ready', value: value.message })
      + (value.answer === null ? '<p class="muted">尚无正式回答。</p>' : renderQueryAnswer({ status: 'ready', value: value.answer }))
      + `<p class="muted">此回答不代表文件修改或工作执行已经完成。</p></details>`;
  } else if (mail.consultation !== null) {
    receipt = `<details class="mail-receipt" data-mail-receipt="rejected"><summary>查看回执</summary>`
      + `<p data-consultation-state="rejected">处理未完成：${escapeHtml(outcomeRejectionReason(mail.consultation))}</p></details>`;
  }
  return `<section class="panel" data-view="member-mail"><header><h4>成员来信</h4>`
    + `<p><span data-mail-send="${mail.sendState}">${escapeHtml(send)}</span> · <span data-mail-consult="${mail.consultState}">${escapeHtml(consult)}</span></p>`
    + (mail.note === null ? '' : `<p class="muted">${escapeHtml(mail.note)}</p>`) + `</header>`
    + `<div class="buttons">`
    + (mail.consultState === 'responded' || mail.consultState === 'processed' || mail.consultState === 'ended' ? '' : '<button data-action="process-consultation">处理消息</button>')
    + (mail.sendState === 'failed' && mail.request !== null
      ? `<button data-action="retry-member-send">重新发送原请求（同一 body）</button>` : '')
    + `</div>`
    + receipt + `</section>`;
}

// Center rendering is renderCenterHead + renderCenterBody (one production renderer).
export function renderComposer(): string {
  const current = state();
  const layout = syncActiveLayout(current);
  const active = current.activeSession;
  const main = current.mainSession;
  const session = active ?? main;
  const references = layout.composerDraft.references;
  const referencesHtml = references.length === 0 ? ''
    : `<ul class="q-refs">${references.map(reference => reference.kind === 'selection'
      ? `<li data-reference="selection" data-path="${escapeHtml(reference.path)}">${escapeHtml(reference.path)}:L${escapeHtml(reference.startLine)}-L${escapeHtml(reference.endLine)}${reference.source === 'draft_snapshot' ? ' · 草稿快照' : ''}</li>`
      : `<li data-reference="path" data-path="${escapeHtml(reference.path)}">${escapeHtml(reference.path)}</li>`).join('')}</ul>`;
  if (layout.readOnly) {
    return `<section class="q-compose" data-view="composer" data-readonly="true">`
      + `<p class="muted">归档会话只读：可以浏览历史与文件，但不能发送或加入可发送引用。</p></section>`;
  }
  const newGoal = active === null && main === null && current.goal === null && current.forms.goalId.trim().length === 0;
  const existingGoal = active === null && main === null && !newGoal
    && (current.goal !== null || current.forms.goalId.trim().length > 0);
  const sendAction = active !== null ? 'send-member-message' : main !== null ? 'send-main-message'
    : newGoal ? 'run-new-goal' : existingGoal ? 'start-goal-investigation' : 'run-investigation';
  const recipientLabel = active !== null ? memberLabel(current, active) : main !== null ? '主对话' : '项目';
  const hint = newGoal
    ? '写下希望完成的目标正文；发送即“新建目标”，目标创建后回执显示“已创建”。'
    : active !== null ? '普通消息只读/咨询，不会自动采用计划或执行。'
      : main !== null ? '向主会话发送消息；不会自动采用计划或执行。'
        : existingGoal
          ? (selectedExecutionProfile(current) === null
            ? '目标已创建；当前工作区没有可用的模型/调查配置，请先选择模型。'
            : '发送即按已创建目标开始调查；规划在“更多”菜单中。')
          : '向主对话发送只读调查；规划与采用在“更多”菜单中按真实状态出现。';
  return `<section class="q-compose" data-view="composer" data-mode="${active !== null ? 'member' : main !== null ? 'main' : 'project'}">`
    + `<textarea data-field="composerText" rows="1" placeholder="${newGoal ? '写下目标正文（不是内部 ID）' : '发送消息…'}" aria-label="消息">${escapeHtml(layout.composerDraft.text)}</textarea>`
    + referencesHtml
    + `<div class="q-compose-bottom"><span class="q-recipient" title="发送对象">${escapeHtml(recipientLabel)}</span>`
    + (session === null ? '' : `<span class="q-compose-mode" title="${escapeHtml(hint)}" tabindex="0" aria-label="${escapeHtml(hint)}">只读咨询</span>`)
    + `<span class="q-fill"></span>`
    + `<button class="q-send q-icon" data-action="${sendAction}" aria-label="发送" title="发送">${topIcon('arrow-up')}</button></div>`
    + (session === null ? `<div class="q-compose-hint">${escapeHtml(hint)}</div>` : '') + `</section>`;
}
