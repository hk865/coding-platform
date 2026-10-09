/// <reference lib="dom" />
/** Execution actions: the execution list, investigation and planning runs, plan adoption, continue and refresh, operator controls and Run pages. */

import type { SessionRef } from '../../../app/core-http-types.js';
import { tagsFor } from '../../api/request-tags.js';
import { submit } from '../../api/submit.js';
import { saveScopeDisplay } from '../../state/display-preference.js';
import type { WorkbenchTab } from '../../state/layout.js';
import { executionPageKey, sameSession } from '../../state/values.js';
import { freshRequestId, renderScopeIfSelected } from '../../state/workbench.js';
import { composeRequestText } from '../conversation/goal-setup.js';
import { stopCollaboration } from './collaboration.js';
import { loadExecutions } from './list.js';
import { adoptInitialPlanSetup, loadPlanCandidate } from './planning.js';
import { continueExecution, refreshExecution, runExecution } from './query-flow.js';
import { buildSessionReadRequest, requireBody } from '../sessions/requests.js';
import type { ActionHandler, ActionTable } from '../shell/actions.js';
import {
  activeExecutionTab,
  buildExecutionHistoryRequest,
  executionTabId,
  openTab,
  runRefFromElement,
  syncActiveLayout,
  taskTripleFromElement,
} from '../tabs/aux-layout.js';

// control-pause, control-cancel, control-resume, control-steer: one shared body; `action` tells them apart.
const submitExecutionControl: ActionHandler = async (scope, element, action) => {
  const layout = syncActiveLayout(scope);
  const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
  if (tab === undefined || tab.kind !== 'execution_history') return;
  const key = executionPageKey(tab.tabId);
  const read = scope.executionReads.get(key);
  if (read?.result.status !== 'ready') { scope.error = '先刷新执行事实再控制。'; renderScopeIfSelected(scope); return; }
  const execution = read.result.value;
  const kind = action.slice('control-'.length) as 'pause' | 'cancel' | 'resume' | 'steer';
  const reason = kind === 'steer' ? window.prompt('向原执行提交的新方向（暂停不会因此解除）') : `operator ${kind}`;
  if (reason === null || reason.trim().length === 0) return;
  await submit(scope, 'controls/submit', { scope: scope.config.scope, request: {
    input: { runRef: tab.run, kind, reason }, meta: { requestId: freshRequestId('controls/submit'), expected: [{ ref: tab.run, revision: execution.run.revision }] },
  } });
  const receipt = scope.lastResponse?.payload as { status?: string; value?: { intent?: { ref: unknown } } } | undefined;
  if (receipt?.status !== 'committed' || receipt.value?.intent === undefined) return;
  await submit(scope, 'controls/deliver', { scope: scope.config.scope, input: { intentRef: receipt.value.intent.ref } });
  const authorization = execution.run.executionAuthorization;
  if (kind === 'resume' && execution.run.outcome !== 'yielded' && execution.run.envelope !== null && execution.run.inputBinding !== undefined && authorization !== undefined && 'consumerId' in authorization) {
    await submit(scope, 'executions/start', { scope: scope.config.scope, input: {
      prepared: { kind: 'task', claim: execution.outbox.claim, envelope: execution.run.envelope, inputBinding: execution.run.inputBinding },
      consumerId: authorization.consumerId, requestId: freshRequestId('executions/start'),
    } });
  }
  return;
};

export const executionActions = {
  'load-executions': async scope => { await loadExecutions(scope, false); return; },
  'load-next-executions': async scope => { await loadExecutions(scope, true); return; },
  'select-query-profile': (scope, element) => {
    scope.executionProfileId = element instanceof HTMLSelectElement && element.value.length > 0 ? element.value : null;
    scope.executionNotice = null;
    renderScopeIfSelected(scope);
    return;
  },
  'run-investigation': async scope => {
    scope.forms.question = composeRequestText(syncActiveLayout(scope)).trim() || scope.forms.question;
    await runExecution(scope, 'investigate');
    return;
  },
  'review-plan-candidate': async scope => { await loadPlanCandidate(scope); renderScopeIfSelected(scope); return; },
  'adopt-initial-plan': async scope => {
    await loadPlanCandidate(scope);
    const candidate = scope.planCandidate;
    if (candidate === null) {
      scope.error = '当前没有可采用的初始方案候选（需要同一 Goal 最新可达且同 scope 的 Answer）。';
      renderScopeIfSelected(scope);
      return;
    }
    await adoptInitialPlanSetup(scope, candidate);
    return;
  },
  'run-planning': async scope => {
    scope.forms.question = composeRequestText(syncActiveLayout(scope)).trim() || scope.forms.question;
    await runExecution(scope, 'planning');
    return;
  },
  'start-goal-investigation': async scope => {
    const snapshot = scope.goalConversation.snapshot();
    if (snapshot.status === 'creating') return;
    if (snapshot.goalId !== null) {
      await scope.goalConversation.startInvestigation();
    } else {
      // Existing Goal restored without a frozen first-Send: the explicit
      // start is the original fresh investigation, with the current draft.
      scope.forms.question = composeRequestText(syncActiveLayout(scope)).trim() || scope.forms.question;
      await runExecution(scope, 'investigate');
    }
    renderScopeIfSelected(scope);
    return;
  },
  'resume-original-investigation': async scope => {
    const candidate = scope.execution.resumable;
    const displayed = scope.activeSession ?? scope.mainSession;
    if (candidate === null || !sameSession(candidate.session, displayed)) {
      scope.error = '没有可继续准备的原始调查。';
      renderScopeIfSelected(scope);
      return;
    }
    await scope.goalConversation.resumeOriginal(candidate.queryRunRef, candidate.session);
    await submit(scope, 'sessions/read', buildSessionReadRequest(scope.config.scope, candidate.session), tagsFor(candidate.session));
    await submit(scope, 'sessions/find', { scope: scope.config.scope,
      input: { workspace: scope.config.scope, includeArchived: scope.sessionIncludeArchived, page: { limit: 10 } } });
    renderScopeIfSelected(scope);
    return;
  },
  'open-goal-model-settings': scope => { scope.goalConversation.openModelSettings(); return; },
  'run-continue': async scope => { await continueExecution(scope); return; },
  'refresh-execution': async scope => { await refreshExecution(scope); return; },
  'control-pause': submitExecutionControl,
  'control-cancel': submitExecutionControl,
  'control-resume': submitExecutionControl,
  'control-steer': submitExecutionControl,
  'stop-execution': async scope => { await stopCollaboration(scope); return; },
  'select-collaboration-task': async (scope, element) => {
    scope.forms.taskId = element.dataset.taskId ?? '';
    await refreshExecution(scope);
    return;
  },
  'read-collaboration-message': async (scope, element) => {
    // Reuse the EXISTING messages/read + messages/body routes and the existing
    // renderMessage/renderMessageBody entries; no new projection or page.
    const messageId = element.dataset.messageId ?? '';
    const collab = scope.collaboration;
    if (collab === null || collab.result.status !== 'ready') {
      scope.error = '当前没有可查看的协同消息。'; renderScopeIfSelected(scope); return;
    }
    const message = collab.result.value.messages.find(candidate => candidate.ref.messageId === messageId);
    if (message === undefined) { scope.error = '该消息不在当前协同快照中。'; renderScopeIfSelected(scope); return; }
    // Slice 5 widened the recipient union; this Session action only applies to a
    // Session recipient (the user address is not a Session).
    if ('kind' in message.recipient) { scope.error = '该消息的收件方不是成员会话。'; renderScopeIfSelected(scope); return; }
    const recipient: SessionRef = { projectId: message.recipient.projectId, sessionId: message.recipient.sessionId };
    const ref = message.ref;
    scope.activeSession = recipient;
    scope.activeMessage = ref;
    saveScopeDisplay(scope);
    await submit(scope, 'messages/read', { scope: scope.config.scope, input: ref }, tagsFor(recipient, ref));
    const read = scope.message;
    if (read === null || read.result.status !== 'ready') return;
    await submit(scope, 'messages/body', { scope: scope.config.scope, input: { messageRef: ref, part: 'message' } },
      tagsFor(recipient, ref, 'message'));
    if (message.status === 'responded') {
      await submit(scope, 'messages/body', { scope: scope.config.scope, input: { messageRef: ref, part: 'response' } },
        tagsFor(recipient, ref, 'response'));
    }
    return;
  },
  'open-execution-history': async (scope, element) => {
    const run = runRefFromElement(element);
    if (run === null) { scope.error = '缺少完整的执行引用。'; renderScopeIfSelected(scope); return; }
    const task = taskTripleFromElement(element);
    const targetScope = scope.config.scope;
    const tab: WorkbenchTab = { tabId: executionTabId(run), kind: 'execution_history',
      title: `本次执行 ${run.runId}`, run, task };
    // Capture the originating conversation/layout and its exact page BEFORE the
    // first await, and open the typed Run page there. Later responses only
    // update this page: they never select a Session or migrate/reopen a tab.
    const key = executionPageKey(tab.tabId);
    openTab(scope, tab);
    await submit(scope, 'executions/read', { scope: targetScope, input: run },
      tagsFor(null, null, null, null, run, key));
    await submit(scope, 'executions/history',
      buildExecutionHistoryRequest(targetScope, run, null, false),
      tagsFor(null, null, null, null, run, key));
    renderScopeIfSelected(scope);
    return;
  },
  'read-execution-record': async scope => {
    const tab = activeExecutionTab(scope);
    if (tab === null) { scope.error = '请先打开本次执行页。'; renderScopeIfSelected(scope); return; }
    const key = executionPageKey(tab.tabId);
    await submit(scope, 'executions/read', { scope: scope.config.scope, input: tab.run },
      tagsFor(null, null, null, null, tab.run, key));
    return;
  },
  'read-execution-history': async scope => {
    const tab = activeExecutionTab(scope);
    if (tab === null) { scope.error = '请先打开本次执行页。'; renderScopeIfSelected(scope); return; }
    const key = executionPageKey(tab.tabId);
    const previous = scope.executionHistories.get(key) ?? null;
    const body = buildExecutionHistoryRequest(scope.config.scope, tab.run, previous, false);
    if (!requireBody(scope, body)) return;
    await submit(scope, 'executions/history', body, tagsFor(null, null, null, null, tab.run, key));
    return;
  },
  'next-execution-history': async scope => {
    const tab = activeExecutionTab(scope);
    if (tab === null) { scope.error = '请先打开本次执行页。'; renderScopeIfSelected(scope); return; }
    const key = executionPageKey(tab.tabId);
    const previous = scope.executionHistories.get(key) ?? null;
    const body = buildExecutionHistoryRequest(scope.config.scope, tab.run, previous, true);
    if (body === null) { scope.error = '本次执行原历史没有更多页。'; renderScopeIfSelected(scope); return; }
    await submit(scope, 'executions/history', body, tagsFor(null, null, null, null, tab.run, key));
    return;
  },
} satisfies ActionTable;
