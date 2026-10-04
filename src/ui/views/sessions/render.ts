/** Pure Session, inbox, message, original-history and runtime-capability renderers. */

import type {
  CoreScope,
  MessageBody,
  OperationReceipt,
  Page,
  ReadResult,
  ReviewSessionRole,
  RuntimeCapabilities,
  SessionCard,
  SessionHistoryEntry,
  SessionMessage,
  SessionMessageStatus,
  SessionOperationRecord,
  SessionPage,
  SessionRecord,
} from '../../../app/core-http-types.js';
import { detailsFor, escapeHtml, rejectionPanel, renderGap } from '../../components/html.js';
import { parseHistoryBody } from '../history/parse.js';
import { renderParsedHistoryBody, renderRawDisclosure } from '../history/timeline.js';

// ---------------------------------------------------------------------------
// R6.1b-1 Session / inbox / original-history presentation.
//
// Every function is a pure text builder over the exact public HTTP DTOs: no DOM,
// no network and no domain service. Absent, pending and unsupported states stay
// distinct, so a busy Session is never shown as idle, a pending message never
// becomes read/responded, and an accepted creation is never shown as created.
// ---------------------------------------------------------------------------

const AVAILABILITY_TEXT: Record<SessionCard['availability'], string> = {
  idle: '可用', busy: '忙碌中', recoverable: '可恢复', unavailable: '不可用',
};

const MESSAGE_STATUS_TEXT: Record<SessionMessageStatus, string> = {
  pending: '待处理', read: '已读（尚未回复）', responded: '已回复',
};

const HISTORY_KIND_TEXT: Record<SessionHistoryEntry['kind'], string> = {
  session_created: '会话创建', turn_started: '轮次开始', agent_event: 'Agent 事件',
};

const OPERATION_PHASE_TEXT: Record<SessionOperationRecord['phase'], string> = {
  accepted: '创建处理中', running: '创建进行中', completed: '创建完成', failed: '创建失败', unknown: '结果未知',
};

function roleSummary(role: SessionRecord['role']): string {
  return role.kind === 'role_spec'
    ? `${role.pin.ref.roleId}@${String(role.pin.ref.revision)}`
    : `模板 ${role.templateId}`;
}

/** Trusted startup role choices for one scope. An absent list is a real gap and
 * never a fabricated default Role; existing Sessions stay readable without it. */
export function renderSessionRoleOptions(roles: ReviewSessionRole[], scope: CoreScope, selected = 0): string {
  const available = roles.filter(entry =>
    entry.scope.projectId === scope.projectId && entry.scope.workspaceId === scope.workspaceId);
  if (available.length === 0) {
    return '<p class="muted">本机没有为当前工作区提供可信角色引用，无法创建会话；已有会话、消息与历史仍可查看。</p>';
  }
  return available.map((entry, index) =>
    `<option value="${index}"${index === selected ? ' selected' : ''}>${escapeHtml(entry.label)}`
    + ` · ${escapeHtml(roleSummary(entry.role))}</option>`).join('');
}

/** Real Session directory page. Identity, lifecycle, availability, role and the
 * original `nextCursor` are all preserved. */
export function renderSessionSummary(result: ReadResult<SessionPage<SessionCard>>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('sessions/find', '没有匹配的会话');
  if (result.status === 'not_ready') return renderGap('sessions/find', '会话目录尚未就绪');
  const page = result.value;
  if (page.items.length === 0) {
    return '<section class="panel" data-view="sessions"><h3>会话</h3><p class="muted">当前筛选没有会话</p></section>';
  }
  const rows = page.items.map(card => {
    const record = card.record;
    return `<li data-session="${escapeHtml(record.ref.sessionId)}">`
      + `<strong>${escapeHtml(record.ref.sessionId)}</strong> `
      + `<span class="phase" data-availability="${escapeHtml(card.availability)}">${escapeHtml(AVAILABILITY_TEXT[card.availability])}</span> `
      + `<span class="muted">${escapeHtml(record.lifecycle)} · 业务版本 ${escapeHtml(record.revision)} · 角色 ${escapeHtml(roleSummary(record.role))}</span>`
      + detailsFor('查看身份与关联', `<p>Session <code>${escapeHtml(JSON.stringify(record.ref))}</code></p>`
        + `<p>kernel ${escapeHtml(record.kernel.adapterId)} · ${escapeHtml(record.kernel.kernelSessionId)}</p>`
        + `<p>关联工作 ${card.links.length} 条</p>`)
      + `<button class="link" data-action="read-session" data-session="${escapeHtml(record.ref.sessionId)}">查看详情</button>`
      + `<button class="link" data-action="select-session" data-session="${escapeHtml(record.ref.sessionId)}">打开完整会话历史</button>`
      + `</li>`;
  }).join('');
  return `<section class="panel" data-view="sessions"><header><h3>会话</h3>`
    + `<p>共 ${page.items.length} 条 · ${page.nextCursor === null ? '没有更多' : '还有更多'}</p>`
    + detailsFor('查看目录游标', `<p>nextCursor ${escapeHtml(page.nextCursor ?? 'none')}</p>`)
    + `</header><ul class="sessions">${rows}</ul></section>`;
}

/** One Session's real detail, including the persisted work links. */
export function renderSessionDetail(result: ReadResult<SessionCard>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('sessions/read', '该会话不存在');
  if (result.status === 'not_ready') return renderGap('sessions/read', '会话详情尚未就绪');
  const { record, availability, links } = result.value;
  return `<section class="panel" data-view="session-detail"><header><h3>${escapeHtml(record.ref.sessionId)}</h3>`
    + `<p>${escapeHtml(AVAILABILITY_TEXT[availability])} · ${escapeHtml(record.lifecycle)} · 健康 ${escapeHtml(record.health)}</p>`
    + detailsFor('查看身份与版本', `<p>Session <code>${escapeHtml(JSON.stringify(record.ref))}</code></p>`
      + `<p>workspaceId ${escapeHtml(record.workspaceId)} · revision ${escapeHtml(record.revision)}</p>`
      + `<p>角色 ${escapeHtml(roleSummary(record.role))}</p>`
      + `<p>占用 ${record.occupancy === null ? '无' : escapeHtml(JSON.stringify(record.occupancy))}</p>`)
    + (links.length === 0 ? '<p class="muted">没有关联工作</p>'
      : `<ul class="links">${links.map(link =>
        `<li>${escapeHtml(link.ref.relation)} · ${escapeHtml(JSON.stringify(link.ref.target))}</li>`).join('')}</ul>`)
    + `</section>`;
}

/** `sessions/create` receipt. `accepted` is ONLY "创建处理中": the session does
 * not exist until the same operation reports `completed`. */
export function renderSessionOperation(result: OperationReceipt<SessionRecord>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  const operationRef = `<p>操作 <code>${escapeHtml(result.operationRef.operationId)}</code> · replayed=${String(result.replayed)}</p>`;
  if (result.status === 'accepted') {
    return `<section class="panel" data-view="session-operation"><h3>创建处理中</h3>`
      + `<p>请求已受理，请显式刷新状态；受理不代表会话已经创建。</p>${operationRef}`
      + `<div class="buttons"><button data-action="read-session-operation">刷新状态</button></div></section>`;
  }
  const record = result.value;
  return `<section class="panel" data-view="session-operation"><h3>会话已创建</h3>`
    + `<p>会话 <code>${escapeHtml(record.ref.sessionId)}</code> · 业务版本 ${escapeHtml(record.revision)}</p>`
    + operationRef + `</section>`;
}

/** `sessions/operation` read: the durable create operation's real phase. An
 * accepted/running operation is NOT a created Session and is never shown as
 * one; the planned ref is only a projection until the phase is completed. */
export function renderSessionOperationRead(result: ReadResult<SessionOperationRecord>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('sessions/operation', '该创建操作不存在');
  if (result.status === 'not_ready') return renderGap('sessions/operation', '创建操作尚未就绪');
  const operation = result.value;
  const planned = operation.action.plannedSessionRef;
  return `<section class="panel" data-view="session-operation-read"><h3>创建操作状态</h3>`
    + `<p data-phase="${escapeHtml(operation.phase)}">${escapeHtml(OPERATION_PHASE_TEXT[operation.phase])}</p>`
    + `<p>操作 <code>${escapeHtml(operation.ref.operationId)}</code> · 计划会话 <code>${escapeHtml(planned.sessionId)}</code></p>`
    + detailsFor('查看操作详情', `<pre>${escapeHtml(JSON.stringify({
      ref: operation.ref, phase: operation.phase, observation: operation.observation, failure: operation.failure,
    }, null, 2))}</pre>`)
    + `</section>`;
}

/** Inbox list. Reading never acks, so a pending message stays pending. */
export function renderInbox(
  result: ReadResult<{ items: SessionMessage[]; nextCursor: string | null; sourceCursor: unknown }>,
): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('messages/inbox', '没有收件箱记录');
  if (result.status === 'not_ready') return renderGap('messages/inbox', '收件箱尚未就绪');
  const value = result.value;
  if (value.items.length === 0) {
    return '<section class="panel" data-view="inbox"><h3>收件箱</h3><p class="muted">收件箱为空</p></section>';
  }
  const rows = value.items.map(message =>
    `<li data-message="${escapeHtml(message.ref.messageId)}">`
    + `<code>${escapeHtml(message.ref.messageId)}</code> `
    + `<span data-status="${escapeHtml(message.status)}">${escapeHtml(MESSAGE_STATUS_TEXT[message.status])}</span> `
    + `<span class="muted">${escapeHtml(message.createdAt)} · 发送者 ${escapeHtml(message.sender.kind)}</span>`
    + `<button class="link" data-action="read-message" data-message="${escapeHtml(message.ref.messageId)}">查看消息</button>`
    + `</li>`).join('');
  return `<section class="panel" data-view="inbox"><header><h3>收件箱</h3>`
    + `<p>共 ${value.items.length} 条 · ${value.nextCursor === null ? '没有更多' : '还有更多'}</p>`
    + detailsFor('查看游标', `<p>nextCursor ${escapeHtml(value.nextCursor ?? 'none')}</p>`
      + `<p>sourceCursor ${escapeHtml(JSON.stringify(value.sourceCursor))}</p>`)
    + `</header><ul class="messages">${rows}</ul></section>`;
}

/** One persisted message. A message with no reply shows "尚无回复"; `pending`
 * is never turned into read/responded and no reply is fabricated. */
export function renderMessage(result: ReadResult<SessionMessage>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('messages/read', '该消息不存在');
  if (result.status === 'not_ready') return renderGap('messages/read', '消息尚未就绪');
  const message = result.value;
  const response = message.response === null
    ? '<p class="muted" data-reply="none">尚无回复</p>'
    : `<div data-reply="present"><p>回复者 ${escapeHtml(message.response.sender.sessionRef.sessionId)}`
      + ` · ${escapeHtml(message.response.respondedAt)}</p>`
      + `<button class="link" data-action="read-message-body" data-part="response" data-message="${escapeHtml(message.ref.messageId)}">查看回复正文</button></div>`;
  return `<section class="panel" data-view="message"><header><h3>消息 ${escapeHtml(message.ref.messageId)}</h3>`
    + `<p data-status="${escapeHtml(message.status)}">${escapeHtml(MESSAGE_STATUS_TEXT[message.status])}`
    + ` · 发送者 ${escapeHtml(message.sender.kind)} · ${escapeHtml(message.createdAt)}</p>`
    + detailsFor('查看消息引用', `<p>ref <code>${escapeHtml(JSON.stringify(message.ref))}</code></p>`
      + `<p>bodyRef ${escapeHtml(JSON.stringify(message.bodyRef))}</p>`
      + `<p>sourceRef ${escapeHtml(JSON.stringify(message.sourceRef))}</p>`
      + `<p>revision ${escapeHtml(message.revision)}</p>`)
    + `</header>`
    + `<div class="buttons"><button data-action="read-message-body" data-part="message" data-message="${escapeHtml(message.ref.messageId)}">查看正文</button></div>`
    + response + `</section>`;
}

/** The dedicated bounded message-body read; it is not a general material open. */
export function renderMessageBody(result: ReadResult<MessageBody>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('messages/body', '消息正文不存在');
  if (result.status === 'not_ready') return renderGap('messages/body', '消息正文尚未就绪');
  const body = result.value;
  return `<section class="panel" data-view="message-body"><header><h3>消息正文</h3>`
    + `<p class="muted">${escapeHtml(body.part === 'response' ? '回复' : '来信')} · usage ${escapeHtml(body.usage)}</p>`
    + detailsFor('查看来源', `<p>messageRef <code>${escapeHtml(JSON.stringify(body.messageRef))}</code></p>`
      + `<p>sourceRef ${escapeHtml(JSON.stringify(body.sourceRef))}</p>`)
    + `</header><pre>${escapeHtml(body.text)}</pre></section>`;
}

/** Original Kernel history page. The platform `basis` stays distinct from the
 * directory `sourceCursor`; every entry carries its complete saved record in a
 * default-closed raw disclosure. */
export function renderSessionHistory(result: ReadResult<Page<SessionHistoryEntry>>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('sessions/history', '该会话没有可读的原历史');
  if (result.status === 'not_ready') return renderGap('sessions/history', '原历史尚未就绪');
  const page = result.value;
  const rows = page.items.map(entry =>
    `<li data-history="${escapeHtml(entry.recordId)}" data-history-kind="${entry.kind}">`
    + `<strong>${escapeHtml(HISTORY_KIND_TEXT[entry.kind])}</strong> `
    + `<span class="muted">${escapeHtml(entry.recordedAt)} · position ${escapeHtml(entry.source.position)}</span>`
    + `<div data-history-body="public">${renderParsedHistoryBody(parseHistoryBody(entry))}</div>`
    + renderRawDisclosure(entry)
    + `</li>`).join('');
  return `<section class="panel" data-view="history"><header><h3>原历史</h3>`
    + `<p>共 ${page.items.length} 条 · ${page.nextCursor === null ? '没有更多' : '还有更多'}</p>`
    + detailsFor('查看历史游标', `<p>nextCursor ${escapeHtml(page.nextCursor ?? 'none')}</p>`
      + `<p>basis <code>${escapeHtml(JSON.stringify(page.basis))}</code></p>`)
    + `</header>`
    + (page.items.length === 0 ? '<p class="muted">该页没有记录</p>' : `<ul class="history">${rows}</ul>`)
    + `</section>`;
}

/** Runtime capability read; unimplemented capabilities stay visibly unavailable. */
export function renderRuntimeCapabilities(result: ReadResult<RuntimeCapabilities>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('runtime/capabilities', '没有当前 Runtime');
  if (result.status === 'not_ready') return renderGap('runtime/capabilities', 'Runtime 能力尚未就绪');
  const value = result.value;
  const capabilities: Array<[string, RuntimeCapabilities['createSession']]> = [
    ['创建会话', value.createSession], ['读取历史', value.readHistory],
    ['继续历史', value.continueHistory], ['恢复运行', value.recoverRun],
    ['安全暂停', value.safePointPause], ['取消', value.cancel],
    ['原生压缩', value.nativeCompact], ['范围写入', value.scopedWorkspaceWrites],
  ];
  return `<section class="panel" data-view="capabilities"><header><h3>Runtime 能力</h3>`
    + `<p class="muted">adapter ${escapeHtml(value.adapterId)} · API v${escapeHtml(value.kernelSessionApiVersion)}</p>`
    + `</header><ul class="capabilities">${capabilities.map(([label, capability]) =>
      `<li>${escapeHtml(label)}：${capability.supported ? '可用' : '不可用'}`
      + (capability.supported ? '' : `（${escapeHtml(capability.reason)}）`) + `</li>`).join('')}</ul></section>`;
}
