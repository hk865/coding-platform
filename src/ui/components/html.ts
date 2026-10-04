/** Shared HTML-text helpers of the pure renderers: string in, string out, no DOM, network or workbench state. */

import type { CoreRejection, CoreRouteSuffix } from '../../app/core-http-types.js';

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** A labeled, collapsed disclosure for the exact technical fact (ref, digest,
 * version, error code, raw request/receipt) behind a plain-language summary. */
export const detailsFor = (summary: string, html: string): string =>
  `<details class="details"><summary>${escapeHtml(summary)}</summary>${html}</details>`;

export const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function rejectionPanel(rejection: CoreRejection): string {
  const current = rejection.current === undefined ? '' :
    detailsFor('查看当前版本', `<pre>${escapeHtml(JSON.stringify(rejection.current, null, 2))}</pre>`);
  return `<section class="panel rejected" data-code="${escapeHtml(rejection.code)}">`
    + `<h3>未完成</h3><p>${escapeHtml(rejection.reason)}</p>`
    + detailsFor('查看详情', `<p>错误码：${escapeHtml(rejection.code)}</p>`)
    + current + `</section>`;
}

/** Real absence/gap states, never a fabricated empty success. */
export function renderGap(suffix: CoreRouteSuffix | string, reason: string): string {
  return `<section class="panel gap" data-route="${escapeHtml(suffix)}">`
    + `<h3>暂不可用</h3><p>${escapeHtml(reason)}</p></section>`;
}

export const shown = (value: unknown): string => value === undefined || value === null ? '' : escapeHtml(value);

export function detailsBlock(summary: string, html: string): string {
  return `<details class="details"><summary>${escapeHtml(summary)}</summary>${html}</details>`;
}

export function actionButton(action: string, label: string, enabled: boolean, reason: string): string {
  return enabled
    ? `<button data-action="${action}">${escapeHtml(label)}</button>`
    : `<button data-action="${action}" disabled title="${escapeHtml(reason)}">${escapeHtml(label)}</button>`;
}

export function refusalLine(reason: string): string {
  return `<p class="muted">暂不可用：${escapeHtml(reason)}</p>`;
}

export function versionLine(label: string, value: { ref: unknown; revision: number } | null, emptyText: string): string {
  if (value === null) return `<p class="muted">${escapeHtml(label)}：${escapeHtml(emptyText)}</p>`;
  return `<p>${escapeHtml(label)}：已就绪，版本 ${escapeHtml(value.revision)}</p>`
    + detailsBlock('查看版本引用', `<pre>${escapeHtml(JSON.stringify(value.ref, null, 2))}</pre>`);
}
