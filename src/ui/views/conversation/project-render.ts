/** Pure project registration read and project conversation summary. */

import type { CoreScope } from '../../../app/core-http-types.js';
import { detailsFor, escapeHtml } from '../../components/html.js';

// --- Project registration / new Goal -----------------------------------------

export type ProjectReadState =
  | { status: 'unread' }
  | { status: 'ready'; projectId: string; revision: number }
  | { status: 'not_found' }
  | { status: 'rejected'; code: string; reason: string }
  | { status: 'loading' };

/** Narrow Project read projection used by the cold-start new-Goal entry. It
 * shows the real revision or the real absence; revision 1 is never assumed. */
export function renderProjectRead(state: ProjectReadState): string {
  if (state.status === 'unread') return '<p class="muted" data-project-read="unread">尚未读取项目登记；新建目标会先正式读取。</p>';
  if (state.status === 'loading') return '<p data-project-read="loading">正在读取项目登记…</p>';
  if (state.status === 'not_found') return '<p data-project-read="not_found">项目尚未登记。新建目标时将完成登记。</p>';
  if (state.status === 'rejected') return `<p data-project-read="rejected">项目读取失败（${escapeHtml(state.code)}）：${escapeHtml(state.reason)}</p>`;
  return `<p data-project-read="ready">项目 <code>${escapeHtml(state.projectId)}</code> 已登记，正式版本 ${escapeHtml(state.revision)}。</p>`;
}

/** Read-only summary of the project main conversation: the current Goal text
 * the user wrote (never an ID) and whether it is registered. */
export function renderProjectConversation(input: {
  scope: CoreScope;
  workspaceName: string;
  goalText: string;
  goalId: string | null;
  projectState: ProjectReadState;
  hasProfile: boolean;
}): string {
  const goal = input.goalId === null
    ? `<p class="muted">写下希望完成的目标，从这里开始。</p>`
    : `<div class="chat-user" data-role="user"><p>${escapeHtml(input.goalText)}</p></div>`
      + detailsFor('目标与项目详情', `<p>目标 <code>${escapeHtml(input.goalId)}</code></p>` + renderProjectRead(input.projectState));
  return `<section class="conversation" data-view="project-conversation">`
    + `<p class="muted">${escapeHtml(input.workspaceName)}</p>`
    + `<div class="chat-stream">${goal}`
    + (input.hasProfile ? '' : '<p class="muted">当前工作区没有可信模型配置；普通发送会保留草稿并说明缺口。</p>')
    + `</div></section>`;
}
