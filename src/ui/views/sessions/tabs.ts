/** Session tabs: the Session page, the full-history page and the Task-execution history page. */

import { actionButton, escapeHtml, renderGap } from '../../components/html.js';
import type { WorkbenchTab } from '../../state/layout.js';
import { executionPageKey, sameRun, sameSession, tabSessionHistoryKey } from '../../state/values.js';
import { state } from '../../state/workbench.js';
import {
  executionHistoryMatches,
  renderExecutionHistory,
  renderExecutionRecord,
  renderSessionHistoryTimeline,
} from '../history/timeline.js';
import { renderSessionDetail } from './render.js';

export function renderSessionTab(tab: Extract<WorkbenchTab, { kind: 'session_chat' }>): string {
  const current = state();
  const read = current.sessionRead !== null && sameSession(current.sessionRead.session, tab.session) ? current.sessionRead : null;
  const key = tabSessionHistoryKey(tab.tabId, tab.session);
  const stored = current.sessionHistories.get(key) ?? null;
  const history = stored !== null && sameSession(stored.session, tab.session) ? stored : null;
  const canNext = history !== null && history.result.status === 'ready' && history.result.value.nextCursor !== null;
  return `<section class="panel" data-view="session-tab" data-session="${escapeHtml(tab.session.sessionId)}">`
    + `<header><h3>会话 <code>${escapeHtml(tab.session.sessionId)}</code></h3></header>`
    + `<div class="buttons"><button data-action="select-session" data-session="${escapeHtml(tab.session.sessionId)}">在中间查看</button>`
    + `<button data-action="read-session-tab">读取详情与历史</button>`
    + actionButton('next-session-tab', '下一页原历史', canNext, '没有更多原历史') + `</div>`
    + (read === null ? renderGap('sessions/read', '尚未读取该会话详情') : renderSessionDetail(read.result))
    + (history === null ? renderGap('sessions/history', '尚未读取完整会话原历史')
      : `<h4>完整会话原历史</h4>` + renderSessionHistoryTimeline(history.result))
    + `</section>`;
}

export function renderHistoryTab(tab: Extract<WorkbenchTab, { kind: 'history' }>): string {
  const current = state();
  const key = tabSessionHistoryKey(tab.tabId, tab.session);
  const stored = current.sessionHistories.get(key) ?? null;
  const history = stored !== null && sameSession(stored.session, tab.session) ? stored : null;
  const canNext = history !== null && history.result.status === 'ready' && history.result.value.nextCursor !== null;
  return `<section class="panel" data-view="history-tab" data-session="${escapeHtml(tab.session.sessionId)}">`
    + `<header><h3>完整会话原历史 <code>${escapeHtml(tab.session.sessionId)}</code></h3></header>`
    + `<div class="buttons"><button data-action="read-history-tab">读取原历史</button>`
    + actionButton('next-history-tab', '下一页原历史', canNext, '没有更多原历史')
    + `<button data-action="select-session" data-session="${escapeHtml(tab.session.sessionId)}">在中间查看</button></div>`
    + (history === null ? renderGap('sessions/history', '尚未读取完整会话原历史')
      : renderSessionHistoryTimeline(history.result))
    + `</section>`;
}

/** R6 Task-execution -> original history tab. The typed `run` is the tab
 * identity; the execution record and the run-window page are read back only when
 * they match the exact scope + RunRef. A non-ready read is shown as its own real
 * result; the claim Session is opened only from a ready execution record. */
export function renderExecutionHistoryTab(tab: Extract<WorkbenchTab, { kind: 'execution_history' }>): string {
  const current = state();
  const key = executionPageKey(tab.tabId);
  const readEntry = current.executionReads.get(key) ?? null;
  const record = readEntry !== null && sameRun(readEntry.run, tab.run) ? readEntry.result : null;
  const stored = current.executionHistories.get(key) ?? null;
  const history = stored !== null && executionHistoryMatches(stored, current.config.scope, tab.run)
    ? stored.result : null;
  const claim = record !== null && record.status === 'ready' ? record.value.outbox.claim.sessionRef : null;
  const canNext = history !== null && history.status === 'ready' && history.value.nextCursor !== null;
  const taskLine = tab.task === null ? '' : ` · Task <code>${escapeHtml(tab.task.taskId)}</code>`;
  return `<section class="panel" data-view="execution-history-tab"`
    + ` data-aggregate-type="${escapeHtml(tab.run.aggregateType)}"`
    + ` data-project-id="${escapeHtml(tab.run.projectId)}" data-goal-id="${escapeHtml(tab.run.goalId)}"`
    + ` data-run-id="${escapeHtml(tab.run.runId)}">`
    + `<header><h3>本次执行原历史</h3>`
    + `<p class="muted">Run <code>${escapeHtml(tab.run.runId)}</code>`
    + ` · 项目 <code>${escapeHtml(tab.run.projectId)}</code>`
    + ` · 目标 <code>${escapeHtml(tab.run.goalId)}</code>${taskLine}</p></header>`
    + `<div class="buttons">`
    + `<button data-action="read-execution-record">刷新执行事实</button>`
    + `<button data-action="control-pause">暂停</button><button data-action="control-resume">继续</button><button data-action="control-cancel">取消</button><button data-action="control-steer">调整方向</button>`
    + `<button data-action="read-execution-history">读取本次执行原历史</button>`
    + actionButton('next-execution-history', '下一页执行历史', canNext, '没有更多执行历史')
    + (claim === null ? ''
      : `<button data-action="open-claim-session" data-session="${escapeHtml(claim.sessionId)}">查看原会话 / 完整会话原历史</button>`)
    + `</div>`
    + renderExecutionRecord(record)
    + renderExecutionHistory(history)
    + `</section>`;
}
