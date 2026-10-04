/// <reference lib="dom" />
/** Session actions: the member directory and lifecycle, Session reads and pages, inbox and messages, consultation, and the Session and history tabs. */

import type { CoreScope } from '../../../app/core-http-types.js';
import { tagsFor, tagsForRelated } from '../../api/request-tags.js';
import { submit } from '../../api/submit.js';
import { saveScopeDisplay } from '../../state/display-preference.js';
import type { ConsultationInputValue } from '../../state/scope-state.js';
import {
  centerSessionHistoryKey,
  conversationKey,
  executionPageKey,
  record,
  sameMessage,
  sameSession,
  tabSessionHistoryKey,
} from '../../state/values.js';
import { freshRequestId, renderScopeIfSelected } from '../../state/workbench.js';
import { currentConsultationGoalId } from '../conversation/member-mail.js';
import { selectedExecutionProfile } from '../execution/run.js';
import {
  CENTER_HISTORY_LIMIT,
  buildInboxRequest,
  buildRuntimeCapabilitiesRequest,
  buildSessionCreateRequest,
  buildSessionFindRequest,
  buildSessionHistoryRequest,
  buildSessionOperationRequest,
  buildSessionReadRequest,
  messageRefFromInbox,
  requireBody,
  selectSession,
  sessionRefFromRecord,
  storedSessionHistoryPage,
} from './requests.js';
import type { ActionHandler, ActionTable } from '../shell/actions.js';
import {
  activeExecutionTab,
  buildRelatedSessionsRequest,
  openTab,
  sessionRefFromAny,
  syncActiveLayout,
  workTargetFromElement,
} from '../tabs/aux-layout.js';

// archive-session, reactivate-session: one shared body; `action` tells them apart.
const changeSessionLifecycle: ActionHandler = async (scope, element, action) => {
  // The A1 lifecycle owner is reached through its real public HTTP route; a
  // Session responsibility link is never treated as control authority.
  const scopeId = scope.config.scope;
  const sessionId = element.dataset.session ?? '';
  const revision = Number(element.dataset.revision);
  if (sessionId.length === 0 || !Number.isSafeInteger(revision) || revision < 1) {
    scope.error = '会话生命周期操作缺少可信的会话引用。';
    renderScopeIfSelected(scope);
    return;
  }
  const sessionRef = { projectId: scopeId.projectId, sessionId };
  const route = action === 'archive-session' ? 'sessions/archive' : 'sessions/reactivate';
  const reason = action === 'archive-session' ? 'operator archived from the workbench' : 'operator reactivated from the workbench';
  await submit(scope, route, { scope: scopeId, request: { input: { sessionRef, reason },
    meta: { requestId: freshRequestId(route), expected: [{ ref: { aggregateType: 'Session', ...sessionRef }, revision }] } } });
  if (record(scope.lastResponse?.payload).status === 'committed') {
    await submit(scope, 'sessions/read', { scope: scopeId, input: sessionRef }, tagsFor(sessionRef));
  }
  return;
};

export const sessionActions = {
  'toggle-archived': async scope => {
    scope.sessionIncludeArchived = !scope.sessionIncludeArchived;
    scope.sessionFind = null;
    scope.relatedSessions = null;
    await submit(scope, 'sessions/find', buildSessionFindRequest(false));
    return;
  },
  'refresh-members': async scope => {
    const body = buildSessionFindRequest(false);
    if (requireBody(scope, body)) await submit(scope, 'sessions/find', body);
    return;
  },
  'archive-session': changeSessionLifecycle,
  'reactivate-session': changeSessionLifecycle,
  'find-sessions': async (scope, element) => {
    const target = workTargetFromElement(element);
    if (target !== null) {
      const includeArchived = scope.sessionIncludeArchived;
      await submit(scope, 'sessions/find',
        { scope: scope.config.scope, input: { workspace: scope.config.scope, target, includeArchived, page: { limit: 10 } } },
        tagsForRelated(target, includeArchived, null));
      return;
    }
    const body = buildSessionFindRequest(false);
    if (requireBody(scope, body)) await submit(scope, 'sessions/find', body);
    return;
  },
  'next-related-sessions': async scope => {
    const related = scope.relatedSessions;
    const body = buildRelatedSessionsRequest(true);
    if (body === null || related === null) { scope.error = '关联会话没有更多页。'; renderScopeIfSelected(scope); return; }
    await submit(scope, 'sessions/find', body, tagsForRelated(related.target, related.includeArchived, related.role));
    return;
  },
  'next-sessions': async scope => {
    const body = buildSessionFindRequest(true);
    if (body === null) { scope.error = '会话目录没有更多页。'; renderScopeIfSelected(scope); return; }
    await submit(scope, 'sessions/find', body);
    return;
  },
  'create-session': async scope => {
    const body = buildSessionCreateRequest();
    if (!requireBody(scope, body)) return;
    await submit(scope, 'sessions/create', body);
    const receipt = scope.lastRequest?.body === body ? scope.sessionCreateReceipt : null;
    if (receipt !== null && receipt.status === 'completed') {
      const ref = sessionRefFromRecord(receipt.value);
      if (ref !== null) {
        selectSession(scope, ref);
        await submit(scope, 'sessions/read', buildSessionReadRequest(scope.config.scope, ref), tagsFor(ref));
      }
    }
    return;
  },
  'read-session-operation': async scope => {
    const body = buildSessionOperationRequest();
    if (!requireBody(scope, body)) return;
    await submit(scope, 'sessions/operation', body);
    const read = scope.lastRequest?.body === body ? scope.sessionOperationRead : null;
    if (read !== null && read.status === 'ready' && read.value.phase === 'completed') {
      const ref = read.value.action.plannedSessionRef;
      selectSession(scope, ref);
      await submit(scope, 'sessions/read', buildSessionReadRequest(scope.config.scope, ref), tagsFor(ref));
    }
    return;
  },
  'read-session': async (scope, element) => {
    const ref = sessionRefFromAny(scope, element.dataset.session ?? '');
    if (ref === null) { scope.error = '请先从会话目录选择会话。'; renderScopeIfSelected(scope); return; }
    selectSession(scope, ref);
    await submit(scope, 'sessions/read', buildSessionReadRequest(scope.config.scope, ref), tagsFor(ref));
    return;
  },
  'read-inbox': async scope => {
    const body = buildInboxRequest(false);
    if (body === null) { scope.error = '请先选择会话。'; renderScopeIfSelected(scope); return; }
    await submit(scope, 'messages/inbox', body, tagsFor(scope.activeSession));
    return;
  },
  'next-inbox': async scope => {
    const body = buildInboxRequest(true);
    if (body === null) { scope.error = '收件箱没有更多页。'; renderScopeIfSelected(scope); return; }
    await submit(scope, 'messages/inbox', body, tagsFor(scope.activeSession));
    return;
  },
  'send-message': async scope => {
    // Capture the originating scope, recipient, exact conversation layout and
    // submitted text BEFORE the first await. A late response must never be
    // attributed to whichever scope/Session the user selects in the meantime.
    const recipient = scope.activeSession;
    if (recipient === null) { scope.error = '请先选择收件会话。'; renderScopeIfSelected(scope); return; }
    const targetScope = scope.config.scope;
    const conversation = conversationKey(recipient);
    const draft = syncActiveLayout(scope);
    if (draft.readOnly) { scope.error = '归档会话只读，不能发送消息。'; renderScopeIfSelected(scope); return; }
    const submittedText = draft.composerDraft.text;
    if (submittedText.trim().length === 0) { scope.error = '请输入消息内容。'; renderScopeIfSelected(scope); return; }
    const body = { scope: targetScope, request: { input: { recipient, text: submittedText.trim() },
      meta: { requestId: freshRequestId('messages/send'), expected: [] } } };
    await submit(scope, 'messages/send', body, tagsFor(recipient));
    if (scope.lastRequest?.body === body && record(scope.lastResponse?.payload).status === 'committed') {
      // Clear ONLY the captured conversation's draft, and only while it still
      // holds exactly what was submitted. A→B switch (even with identical text
      // in B) can never clear B.
      const latest = scope.drafts.get(conversation);
      if (latest !== undefined && latest.text === submittedText) {
        scope.drafts.set(conversation, { ...latest, text: '' });
      }
      // The follow-up read explicitly targets the SAME captured scope and
      // recipient, never the current state()/activeSession.
      await submit(scope, 'messages/inbox',
        { scope: targetScope, input: { recipient, page: { limit: 10 } } },
        tagsFor(recipient));
    }
    return;
  },
  'read-message': async (scope, element) => {
    const ref = messageRefFromInbox(scope, element.dataset.message ?? '');
    if (ref === null) { scope.error = '请先从收件箱选择消息。'; renderScopeIfSelected(scope); return; }
    scope.activeMessage = ref;
    await submit(scope, 'messages/read', { scope: scope.config.scope, input: ref }, tagsFor(scope.activeSession, ref));
    return;
  },
  'read-message-body': async (scope, element) => {
    const ref = scope.activeMessage;
    if (ref === null) { scope.error = '请先查看一条消息。'; renderScopeIfSelected(scope); return; }
    const part = element.dataset.part === 'response' ? 'response' as const : 'message' as const;
    await submit(scope, 'messages/body', { scope: scope.config.scope, input: { messageRef: ref, part } }, tagsFor(scope.activeSession, ref, part));
    return;
  },
  'consult-message': async scope => {
    // Capture the originating session/message/profile BEFORE the first await;
    // a later member switch can never redirect this consultation or its refresh.
    const session = scope.activeSession;
    const messageRef = scope.activeMessage;
    if (session === null || messageRef === null) { scope.error = '请先从收件箱选择一条消息。'; renderScopeIfSelected(scope); return; }
    const profile = selectedExecutionProfile(scope);
    if (profile === null) { scope.error = '当前工作区没有可用的只读调查配置，无法处理咨询。'; renderScopeIfSelected(scope); return; }
    const goalId = currentConsultationGoalId(scope);
    if (goalId === null) { scope.error = '没有可用的当前 Goal，无法处理咨询。'; renderScopeIfSelected(scope); return; }
    const target: CoreScope = { projectId: profile.scope.projectId, workspaceId: profile.scope.workspaceId };
    const input: ConsultationInputValue = {
      schemaVersion: 1,
      messageRef,
      goalRef: { aggregateType: 'Goal', projectId: target.projectId, goalId },
      roleBinding: profile.roleBinding,
      runtimeBudget: profile.runtimeBudget,
      budget: profile.budget,
      consumerId: profile.consumerId,
    };
    await submit(scope, 'workflow/consultation', { scope: target, input }, tagsFor(session, messageRef));
    // Capture THIS consultation's outcome for the exact captured
    // session/message BEFORE any other read. A network/403 failure keeps its
    // original pending/error and is never overwritten by a refresh, and a
    // later read can never decide which response body was requested.
    const stored = scope.consultation;
    const outcome = stored !== null && sameSession(stored.session, session) && sameMessage(stored.messageRef, messageRef)
      ? stored.result : null;
    // `pending` stays set on a network/403 failure: keep the original request
    // and error, and never let a later refresh overwrite them.
    if (scope.pending !== null || outcome === null || outcome.status !== 'ready') return;
    // Refresh ONLY the captured scope/session/message under their own tags.
    await submit(scope, 'messages/read', { scope: scope.config.scope, input: messageRef }, tagsFor(session, messageRef));
    await submit(scope, 'messages/inbox', { scope: scope.config.scope, input: { recipient: session, page: { limit: 10 } } }, tagsFor(session));
    await submit(scope, 'messages/body', { scope: scope.config.scope, input: { messageRef, part: 'message' } }, tagsFor(session, messageRef, 'message'));
    if (outcome.value.state === 'responded') {
      await submit(scope, 'messages/body', { scope: scope.config.scope, input: { messageRef, part: 'response' } }, tagsFor(session, messageRef, 'response'));
    }
    return;
  },
  'read-session-history': async scope => {
    const active = scope.activeSession;
    const key = active === null ? null : centerSessionHistoryKey(active);
    const body = active === null || key === null ? null
      : buildSessionHistoryRequest(scope.config.scope, active, storedSessionHistoryPage(scope, key), false, CENTER_HISTORY_LIMIT);
    if (body === null) { scope.error = '请先选择会话。'; renderScopeIfSelected(scope); return; }
    await submit(scope, 'sessions/history', body, tagsFor(active, null, null, null, null, key));
    return;
  },
  'next-session-history': async scope => {
    const active = scope.activeSession;
    const key = active === null ? null : centerSessionHistoryKey(active);
    const body = active === null || key === null ? null
      : buildSessionHistoryRequest(scope.config.scope, active, storedSessionHistoryPage(scope, key), true, CENTER_HISTORY_LIMIT);
    if (body === null) { scope.error = '原历史没有更多页。'; renderScopeIfSelected(scope); return; }
    await submit(scope, 'sessions/history', body, tagsFor(active, null, null, null, null, key, true));
    return;
  },
  'read-runtime-capabilities': async scope => {
    await submit(scope, 'runtime/capabilities', buildRuntimeCapabilitiesRequest());
    return;
  },
  'select-session': async (scope, element) => {
    const ref = sessionRefFromAny(scope, element.dataset.session ?? '');
    if (ref === null) { scope.error = '请先从会话目录选择会话。'; renderScopeIfSelected(scope); return; }
    const targetScope = scope.config.scope;
    const key = centerSessionHistoryKey(ref);
    selectSession(scope, ref);
    saveScopeDisplay(scope);
    await submit(scope, 'sessions/read', buildSessionReadRequest(targetScope, ref), tagsFor(ref));
    await submit(scope, 'sessions/history', buildSessionHistoryRequest(targetScope, ref, null, false, CENTER_HISTORY_LIMIT),
      tagsFor(ref, null, null, null, null, key));
    return;
  },
  'refresh-session': async scope => {
    const ref = scope.activeSession;
    if (ref === null) return;
    await submit(scope, 'sessions/read', buildSessionReadRequest(scope.config.scope, ref), tagsFor(ref));
    return;
  },
  'open-session-tab': (scope, element) => {
    const ref = sessionRefFromAny(scope, element.dataset.session ?? '');
    if (ref === null) { scope.error = '请先从会话目录选择会话。'; renderScopeIfSelected(scope); return; }
    openTab(scope, { tabId: `history:${ref.sessionId}`, kind: 'history', title: `历史 ${ref.sessionId}`, session: ref });
    renderScopeIfSelected(scope);
    return;
  },
  'read-session-tab': async scope => {
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
    if (tab === undefined || tab.kind !== 'session_chat') return;
    const targetScope = scope.config.scope;
    const key = tabSessionHistoryKey(tab.tabId, tab.session);
    await submit(scope, 'sessions/read', buildSessionReadRequest(targetScope, tab.session), tagsFor(tab.session));
    await submit(scope, 'sessions/history',
      buildSessionHistoryRequest(targetScope, tab.session, storedSessionHistoryPage(scope, key), false),
      tagsFor(tab.session, null, null, null, null, key));
    return;
  },
  'next-session-tab': async scope => {
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
    if (tab === undefined || tab.kind !== 'session_chat') return;
    const key = tabSessionHistoryKey(tab.tabId, tab.session);
    const body = buildSessionHistoryRequest(scope.config.scope, tab.session, storedSessionHistoryPage(scope, key), true);
    if (body === null) { scope.error = '该会话原历史没有更多页。'; renderScopeIfSelected(scope); return; }
    await submit(scope, 'sessions/history', body, tagsFor(tab.session, null, null, null, null, key));
    return;
  },
  'read-history-tab': async scope => {
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
    if (tab === undefined || tab.kind !== 'history') return;
    const targetScope = scope.config.scope;
    const key = tabSessionHistoryKey(tab.tabId, tab.session);
    await submit(scope, 'sessions/history',
      buildSessionHistoryRequest(targetScope, tab.session, storedSessionHistoryPage(scope, key), false),
      tagsFor(tab.session, null, null, null, null, key));
    return;
  },
  'next-history-tab': async scope => {
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
    if (tab === undefined || tab.kind !== 'history') return;
    const key = tabSessionHistoryKey(tab.tabId, tab.session);
    const body = buildSessionHistoryRequest(scope.config.scope, tab.session, storedSessionHistoryPage(scope, key), true);
    if (body === null) { scope.error = '该会话原历史没有更多页。'; renderScopeIfSelected(scope); return; }
    await submit(scope, 'sessions/history', body, tagsFor(tab.session, null, null, null, null, key));
    return;
  },
  'open-claim-session': async scope => {
    // Explicit user navigation only. The clicked page already holds the ready
    // record; capture the target page before the first await, then select the
    // exact claim Session and read its full saved history.
    const tab = activeExecutionTab(scope);
    const key = tab === null ? null : executionPageKey(tab.tabId);
    const readEntry = key === null ? null : (scope.executionReads.get(key) ?? null);
    const claim = readEntry !== null && readEntry.result.status === 'ready'
      ? readEntry.result.value.outbox.claim.sessionRef : null;
    if (claim === null) {
      scope.error = '本次执行事实尚不可用，不能打开原 claim 会话。'; renderScopeIfSelected(scope); return;
    }
    const targetScope = scope.config.scope;
    const centerKey = centerSessionHistoryKey(claim);
    selectSession(scope, claim);
    await submit(scope, 'sessions/read', buildSessionReadRequest(targetScope, claim), tagsFor(claim));
    await submit(scope, 'sessions/history',
      buildSessionHistoryRequest(targetScope, claim, null, false, CENTER_HISTORY_LIMIT),
      tagsFor(claim, null, null, null, null, centerKey));
    return;
  },
} satisfies ActionTable;
