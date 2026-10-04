import type {
  BootstrapExecutionQueryProfile,
  CoreScope,
  MessagesSendResponse,
  SessionRef,
  WorkflowConsultationResponse,
} from '../../../app/core-http-types.js';
import { callCore, outcomeRejectionReason, payloadOf } from '../../api/http.js';
import { tagsFor } from '../../api/request-tags.js';
import { submit } from '../../api/submit.js';
import type { ConsultationInputValue, MessageRefValue, ScopeState } from '../../state/scope-state.js';
import { centerSessionHistoryKey, conversationKey, plainSessionRef, record, sameSession } from '../../state/values.js';
import { bootstrap, freshRequestId, renderScopeIfSelected } from '../../state/workbench.js';
import { composeRequestText } from './goal-setup.js';
import { sameExecutionRole } from '../execution/run.js';
import { sessionCardFor } from '../sessions/labels.js';
import { CENTER_HISTORY_LIMIT, buildSessionHistoryRequest } from '../sessions/requests.js';
import { syncActiveLayout } from '../tabs/aux-layout.js';

// --- Member mail: action_request + needsReply, then consumeConsultation -------

async function deliverMemberRequest(scope: ScopeState, recipient: SessionRef, request: unknown, submittedText: string): Promise<void> {
  const conversation = conversationKey(recipient);
  const mail = scope.memberMail;
  if (mail === null) return;
  scope.error = null;
  scope.notice = null;
  renderScopeIfSelected(scope);
  const outcome = await callCore('messages/send', request);
  if (outcome.kind === 'network') {
    if (mail !== null) { mail.sendState = 'failed'; mail.note = '保存结果未确认；原请求已保留，可重试原 body。'; }
    scope.error = '连接中断，未收到回执。';
    renderScopeIfSelected(scope);
    return;
  }
  if (outcome.status === 403) {
    if (mail !== null) { mail.sendState = 'failed'; mail.note = '连接已失效，请刷新页面。'; }
    renderScopeIfSelected(scope);
    return;
  }
  const payload = payloadOf(outcome) as MessagesSendResponse;
  const envelope = record(payload);
  if (envelope.status !== 'committed') {
    // A CONFIRMED owner rejection is not a transport unknown: keep the draft but
    // clear the frozen invalid body and allow a corrected NEW send/body/key.
    mail.sendState = 'rejected';
    mail.request = null;
    mail.note = `保存被拒绝：${outcomeRejectionReason(payload)}；正文已保留，可修改后重新发送（不会重放被拒 body）。`;
    scope.error = mail.note;
    renderScopeIfSelected(scope);
    return;
  }
  const ref = record(record(envelope.value).ref) as unknown as MessageRefValue;
  // Clear ONLY the captured recipient draft, and only while it still holds
  // exactly what was submitted. Another conversation with identical text is
  // never touched, and a late response can never erase newer typing.
  const candidate = scope.drafts.get(mail.draftKey);
  if (candidate !== undefined && JSON.stringify(candidate) === mail.submittedDraft) {
    scope.drafts.set(mail.draftKey, { ...candidate, text: '', references: [] });
  }
  mail.messageRef = ref; mail.sendState = 'saved'; mail.note = '已保存。持久化成功不等于已处理或已回答。';
  scope.activeMessage = ref;
  renderScopeIfSelected(scope);
  await consultMemberMessage(scope, recipient, ref);
  // Read the ORIGINAL Session history back, so the center shows the persisted
  // conversation rather than only this run's latest object.
  await submit(scope, 'sessions/history',
    buildSessionHistoryRequest(scope.config.scope, recipient, null, false, CENTER_HISTORY_LIMIT),
    tagsFor(recipient, null, null, null, null, centerSessionHistoryKey(recipient)));
}

export async function sendMemberMessage(scope: ScopeState, recipientArg?: SessionRef): Promise<void> {
  if (scope.memberMail?.sendState === 'saving' || scope.memberMail?.sendState === 'failed' || scope.memberMail?.consultState === 'running') { scope.error = '请先完成或重试原来信请求。'; renderScopeIfSelected(scope); return; }
  const selectedRecipient = recipientArg ?? scope.activeSession;
  if (selectedRecipient === null) { scope.error = '请先选择成员。'; renderScopeIfSelected(scope); return; }
  const recipient = plainSessionRef(selectedRecipient);
  const layout = syncActiveLayout(scope);
  if (layout.readOnly) { scope.error = '归档会话只读，不能发送消息。'; renderScopeIfSelected(scope); return; }
  const submittedText = layout.composerDraft.text;
  const text = composeRequestText(layout).trim();
  if (text.length === 0) { scope.error = '请输入消息内容。'; renderScopeIfSelected(scope); return; }
  // The exact body is frozen BEFORE the first await; a retry replays this body.
  const request = { scope: scope.config.scope, request: { input: { recipient, text,
    intent: 'action_request' as const, needsReply: true }, meta: { requestId: freshRequestId('messages/send'), expected: [] } } };
  const placeholderRef: MessageRefValue = { aggregateType: 'SessionMessage', projectId: recipient.projectId,
    workspaceId: scope.config.scope.workspaceId, messageId: 'pending' };
  scope.memberMail = { session: recipient, messageRef: placeholderRef, request,
    draftKey: conversationKey(scope.activeSession), submittedDraft: JSON.stringify(layout.composerDraft),
    profile: profileForMember(scope, recipient), goalId: currentConsultationGoalId(scope), sendState: 'saving', consultState: 'idle',
    consultation: null, note: '正在保存来信…' };
  await deliverMemberRequest(scope, recipient, request, submittedText);
}

export async function retryMemberSend(scope: ScopeState): Promise<void> {
  const mail = scope.memberMail;
  if (mail === null || mail.request === null || mail.sendState !== 'failed') return;
  const layout = syncActiveLayout(scope);
  const submittedText = layout.composerDraft.text;
  mail.sendState = 'saving';
  mail.note = '正在重新发送原请求…';
  renderScopeIfSelected(scope);
  await deliverMemberRequest(scope, mail.session, mail.request, submittedText);
}

/** Match the selected member's real role against the same-scope profiles. It
 * never blindly picks the first profile; an ambiguous or absent match is a real
 * gap that the caller reports instead of guessing. */
function profileForMember(scope: ScopeState, ref: SessionRef): BootstrapExecutionQueryProfile | null {
  const profiles = (bootstrap()?.execution.queryProfiles ?? []).filter(profile =>
    profile.scope.projectId === scope.config.scope.projectId && profile.scope.workspaceId === scope.config.scope.workspaceId);
  const card = sessionCardFor(scope, ref);
  if (card === null) return null;
  const matched = profiles.filter(profile => sameExecutionRole(profile.sessionRole, card.record.role));
  if (matched.length === 1) return matched[0] ?? null;
  if (matched.length > 1) return matched.find(profile => profile.id === scope.executionProfileId) ?? null;
  return null;
}

/** Process the original message with the trusted read-only profile along
 * consumeConsultation. Busy/absent profile stays a real wait or gap; no new
 * Session is created and no isolated inquiry is substituted for this chat. */
export async function consultMemberMessage(scope: ScopeState, session: SessionRef, messageRef: MessageRefValue): Promise<void> {
  const mail = scope.memberMail;
  if (mail === null || !sameSession(mail.session, session) || mail.messageRef.messageId !== messageRef.messageId) return;
  const profile = mail.profile;
  if (profile === null) {
    if (mail !== null) { mail.consultState = 'rejected'; mail.note = '没有可信只读调查配置，来信已保存但未处理。'; }
    renderScopeIfSelected(scope);
    return;
  }
  const goalId = mail.goalId;
  if (goalId === null) {
    if (mail !== null) { mail.consultState = 'rejected'; mail.note = '没有可用的当前 Goal，来信已保存但未处理。'; }
    renderScopeIfSelected(scope);
    return;
  }
  const target: CoreScope = { projectId: profile.scope.projectId, workspaceId: profile.scope.workspaceId };
  const input: ConsultationInputValue = { schemaVersion: 1, messageRef,
    goalRef: { aggregateType: 'Goal', projectId: target.projectId, goalId },
    roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget, budget: profile.budget,
    consumerId: profile.consumerId };
  if (mail !== null) { mail.consultState = 'running'; mail.note = '正在处理来信…'; }
  renderScopeIfSelected(scope);
  const outcome = await callCore('workflow/consultation', { scope: target, input });
  if (mail === null) { renderScopeIfSelected(scope); return; }
  if (outcome.kind === 'network') { mail.consultState = 'rejected'; mail.note = '处理结果未确认；原请求保留。'; renderScopeIfSelected(scope); return; }
  const payload = payloadOf(outcome) as WorkflowConsultationResponse;
  mail.consultation = payload;
  if (payload.status === 'ready') {
    mail.note = payload.value.reason;
    mail.consultState = payload.value.state === 'processed' ? 'processed'
      : payload.value.state === 'responded' ? 'responded'
      : payload.value.state === 'ended' ? 'ended' : 'waiting';
  } else {
    mail.consultState = 'rejected';
    mail.note = outcomeRejectionReason(payload);
  }
  renderScopeIfSelected(scope);
}

export function currentConsultationGoalId(scope: ScopeState): string | null {
  const explicit = scope.forms.goalId.trim();
  if (explicit.length > 0) return explicit;
  const goal = scope.goal;
  if (goal !== null && goal.ref.projectId === scope.config.scope.projectId) return goal.ref.goalId;
  return null;
}
