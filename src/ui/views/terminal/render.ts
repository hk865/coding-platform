/** Pure command-handle snapshot renderer. */

import type { WorkbenchCommandSnapshot, WorkbenchCommandState, WorkspaceResult } from '../../../app/core-http-types.js';
import { detailsFor, escapeHtml } from '../../components/html.js';

// --- Command handles (real Kernel ProcessSandbox) -----------------------------

/** One command handle's real snapshot. There is no interactive stdin and no
 * PTY: stdout/stderr/exit/truncation are the Kernel's own facts. */
export function renderWorkbenchCommand(
  result: WorkspaceResult<WorkbenchCommandSnapshot> | null,
  meta: { command: string; cwd: string; state?: WorkbenchCommandState | 'starting' },
): string {
  const header = `<header><h3>命令执行</h3>`
    + `<p class="muted">无交互 stdin / 非 PTY · cwd <code>${escapeHtml(meta.cwd)}</code></p>`
    + `<pre class="command-line">$ ${escapeHtml(meta.command)}</pre></header>`;
  if (result === null) {
    return `<section class="panel" data-view="command"><header><h3>命令执行</h3></header>`
      + `<p data-command-state="starting">正在启动命令…</p></section>`;
  }
  if (result.status !== 'ready') {
    return `<section class="panel rejected" data-view="command">${header}`
      + `<p data-command-state="rejected">命令不可用（${escapeHtml(result.code)}）：${escapeHtml(result.reason)}</p></section>`;
  }
  const snapshot = result.value;
  const state = meta.state ?? snapshot.state;
  const facts = `<p data-command-state="${escapeHtml(state)}">状态 ${escapeHtml(state)}`
    + ` · exit ${snapshot.exitCode === null ? '未产生' : escapeHtml(snapshot.exitCode)}`
    + (snapshot.signal === null ? '' : ` · signal ${escapeHtml(snapshot.signal)}`)
    + (snapshot.timedOut ? ' · 已超时' : '')
    + (snapshot.cancelled ? ' · 已取消' : '')
    + (snapshot.outputTruncated ? ' · 输出已截断' : '') + `</p>`;
  const error = snapshot.error === null ? ''
    : `<p data-command-error="${escapeHtml(snapshot.error.code)}">启动/执行失败：${escapeHtml(snapshot.error.reason)}</p>`;
  return `<section class="panel" data-view="command" data-command-id="${escapeHtml(snapshot.commandId)}">${header}${facts}${error}`
    + `<h4>stdout</h4><pre data-stream="stdout">${escapeHtml(snapshot.stdout)}</pre>`
    + `<h4>stderr</h4><pre data-stream="stderr">${escapeHtml(snapshot.stderr)}</pre>`
    + detailsFor('查看原始快照', `<pre>${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>`) + `</section>`;
}
