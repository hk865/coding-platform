/** Pure Session, message and message-body renderers. */

import type {
  MessageBody,
  ReadResult,
  SessionCard,
  SessionMessage,
  SessionMessageStatus,
  SessionPage,
  SessionRecord,
} from '../../../app/core-http-types.js';
import { detailsFor, escapeHtml, rejectionPanel, renderGap } from '../../components/html.js';

// ---------------------------------------------------------------------------
// R6.1b-1 Session and message presentation.
//
// Every function is a pure text builder over the exact public HTTP DTOs: no DOM,
// no network and no domain service. Absent, pending and unsupported states stay
// distinct, so a busy Session is never shown as idle and a pending message never
// becomes read/responded. The original history is drawn by history/timeline.ts.
// ---------------------------------------------------------------------------

const AVAILABILITY_TEXT: Record<SessionCard['availability'], string> = {
  idle: '可用', busy: '忙碌中', recoverable: '可恢复', unavailable: '不可用',
};

const MESSAGE_STATUS_TEXT: Record<SessionMessageStatus, string> = {
  pending: '待处理', read: '已读（尚未回复）', responded: '已回复',
};

function roleSummary(role: SessionRecord['role']): string {
  return role.kind === 'role_spec'
    ? `${role.pin.ref.roleId}@${String(role.pin.ref.revision)}`
    : `模板 ${role.templateId}`;
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

/** One persisted message. A message with no reply shows "尚无回复"; `pending`
 * is never turned into read/responded and no reply is fabricated. */
export function renderMessage(result: ReadResult<SessionMessage>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('messages/read', '该消息不存在');
  if (result.status === 'not_ready') return renderGap('messages/read', '消息尚未就绪');
  const message = result.value;
  const response = message.response === null
    ? '<p class="muted" data-reply="none">尚无回复</p>'
    : `<div data-reply="present"><p>回复者 ${escapeHtml(message.response.sender.kind === 'host' ? message.response.sender.actor.id : message.response.sender.sessionRef.sessionId)}`
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
