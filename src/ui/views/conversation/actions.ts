/// <reference lib="dom" />
/** Conversation actions: center history, new Goal, member messages and consultation, code blocks, latest view, main conversation and the composer. */

import { tagsFor } from '../../api/request-tags.js';
import { submit } from '../../api/submit.js';
import { saveScopeDisplay } from '../../state/display-preference.js';
import { centerSessionHistoryKey, conversationKey, sameSession } from '../../state/values.js';
import { renderMemory, renderScopeIfSelected, selectedKey } from '../../state/workbench.js';
import { composeRequestText } from './goal-setup.js';
import { consultMemberMessage, retryMemberSend, sendMemberMessage } from './member-mail.js';
import { executionProfileForScope } from '../execution/run.js';
import {
  CENTER_HISTORY_LIMIT,
  buildSessionHistoryRequest,
  buildSessionReadRequest,
  storedSessionHistoryPage,
} from '../sessions/requests.js';
import type { ActionHandler, ActionTable } from '../shell/actions.js';
import { storeLayout, syncActiveLayout } from '../tabs/aux-layout.js';

// read-center-history, next-center-history: one shared body; `action` tells them apart.
const readCenterHistoryPage: ActionHandler = async (scope, element, action) => {
  const ref = scope.activeSession ?? scope.mainSession;
  if (ref === null) { scope.error = '尚未绑定会话。'; renderScopeIfSelected(scope); return; }
  const key = centerSessionHistoryKey(ref);
  const previous = storedSessionHistoryPage(scope, key);
  const isNext = action === 'next-center-history';
  const body = buildSessionHistoryRequest(scope.config.scope, ref, previous, isNext, CENTER_HISTORY_LIMIT);
  if (body === null) { scope.error = '原历史没有更多页。'; renderScopeIfSelected(scope); return; }
  await submit(scope, 'sessions/history', body, tagsFor(ref, null, null, null, null, key, isNext));
  return;
};

export const conversationActions = {
  'set-grouping': (scope, element) => { scope.historyFold = element.dataset.grouping === 'task'; renderScopeIfSelected(scope); return; },
  'read-center-history': readCenterHistoryPage,
  'next-center-history': readCenterHistoryPage,
  'send-main-message': async scope => { await sendMemberMessage(scope, scope.mainSession ?? undefined); return; },
  // --- MVP UI connection -------------------------------------------------
  'run-new-goal': async scope => {
    const layout = syncActiveLayout(scope);
    const objective = layout.composerDraft.text.trim();
    if (objective.length === 0) { scope.error = '请先写下目标正文（不是内部标识）。'; renderScopeIfSelected(scope); return; }
    const profile = executionProfileForScope(scope, scope.config.scope);
    // Freeze the recipient intent BEFORE the first await: a member selected
    // while the Goal is being created must not reroute the main conversation.
    const activeAtSend = scope.activeSession;
    const draftKey = conversationKey(activeAtSend);
    const submittedDraft = JSON.stringify(layout.composerDraft);
    await scope.goalConversation.begin({
      origin: { ...scope.config.scope }, objective,
      question: composeRequestText(layout).trim() || objective,
      references: layout.composerDraft.references.map(reference => ({ ...reference })),
      profileId: profile?.id ?? null,
      fromMain: activeAtSend === null,
      selectedSession: activeAtSend === null ? null
        : { projectId: activeAtSend.projectId, sessionId: activeAtSend.sessionId },
    });
    const originalDraft = scope.drafts.get(draftKey);
    if (scope.goalConversation.snapshot().status === 'started' && scope.execution.answer?.status === 'ready'
      && originalDraft !== undefined && JSON.stringify(originalDraft) === submittedDraft) {
      scope.drafts.set(draftKey, { ...originalDraft, text: '', references: [] });
    }
    renderScopeIfSelected(scope);
    return;
  },
  'send-member-message': async scope => { await sendMemberMessage(scope); return; },
  'retry-member-send': async scope => { await retryMemberSend(scope); return; },
  'process-consultation': async scope => {
    const mail = scope.memberMail;
    if (mail === null) { scope.error = '没有已保存的成员来信。'; renderScopeIfSelected(scope); return; }
    await consultMemberMessage(scope, mail.session, mail.messageRef);
    return;
  },
  'toggle-history-fold': scope => { scope.historyFold = !scope.historyFold; renderScopeIfSelected(scope); return; },
  'copy-code': async (scope, element) => {
    const block = element.closest<HTMLElement>('[data-code-block]');
    const code = block?.querySelector('code') ?? null;
    const text = code === null ? '' : code.textContent ?? '';
    if (navigator.clipboard === undefined) { scope.error = '当前环境不支持自动复制，请手动选择代码文本。'; renderScopeIfSelected(scope); return; }
    try {
      await navigator.clipboard.writeText(text);
      element.textContent = '已复制';
      window.setTimeout(() => { element.textContent = '复制'; }, 1200);
    } catch { scope.error = '复制失败，请手动选择代码文本。'; renderScopeIfSelected(scope); }
    return;
  },
  'toggle-code-wrap': (scope, element) => {
    const block = element.closest<HTMLElement>('[data-code-block]');
    if (block === null) return;
    const wrapped = block.classList.toggle('is-wrapped');
    element.setAttribute('aria-pressed', String(wrapped));
    return;
  },
  'view-latest': async scope => {
    const ref = scope.activeSession ?? scope.mainSession;
    if (ref === null) { scope.error = '尚未绑定会话。'; renderScopeIfSelected(scope); return; }
    // Freeze the exact scope + Session before any await. The bounded loop
    // only follows this ref's own prefix and never scans without limit.
    const frozenScope = scope.config.scope;
    const key = centerSessionHistoryKey(ref);
    for (let page = 0; page < 10; page += 1) {
      const previous = storedSessionHistoryPage(scope, key);
      const ready = previous?.status === 'ready' ? previous.value : null;
      // At a previously read tail, ask after its exact final record. With no
      // cache (or an empty history), read the head once. Neither path polls.
      const after = ready?.nextCursor ?? ready?.items.at(-1)?.cursor ?? null;
      const body = { scope: frozenScope, input: { sessionRef: ref, afterCursor: after,
        throughCursor: null, limit: CENTER_HISTORY_LIMIT } };
      await submit(scope, 'sessions/history', body, tagsFor(ref, null, null, null, null, key, after !== null));
      const next = storedSessionHistoryPage(scope, key);
      if (next === null || next.status !== 'ready' || next === previous
        || next.value.nextCursor === null || next.value.nextCursor === after) break;
    }
    const stillHere = scope.key === selectedKey()
      && sameSession(scope.activeSession ?? scope.mainSession, ref);
    if (stillHere) {
      const last = storedSessionHistoryPage(scope, key);
      if (last?.status === 'ready' && last.value.nextCursor !== null)
        scope.notice = '仍有后续记录，可继续加载；当前定位到已加载内容末尾。';
      renderMemory.stickToBottom = true;
      renderScopeIfSelected(scope);
    }
    return;
  },
  'select-main-conversation': async scope => {
    scope.activeSession = null;
    scope.activeMessage = null;
    scope.memberMail = null;
    saveScopeDisplay(scope);
    renderScopeIfSelected(scope);
    // Re-read the bound main record so a positive claimed/prepared original
    // run can be offered. Read-only: it never prepares or starts anything.
    if (scope.mainSession !== null) {
      await submit(scope, 'sessions/read',
        buildSessionReadRequest(scope.config.scope, scope.mainSession), tagsFor(scope.mainSession));
    }
    return;
  },
  'clear-composer': scope => {
    storeLayout(scope, { ...syncActiveLayout(scope), composerDraft: { state: 'draft_snapshot', text: '', references: [] } });
    renderScopeIfSelected(scope);
    return;
  },
} satisfies ActionTable;
