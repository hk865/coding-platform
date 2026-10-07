/** Pure file renderers: file read, source capture, CAS save receipt, text diff and Workspace comparison. */

import type {
  CaptureSummary,
  CoreRejection,
  SaveWorkbenchFileResult,
  WorkspaceComparison,
  WorkspaceFile,
  WorkspaceResult,
} from '../../../app/core-http-types.js';
import { detailsFor, escapeHtml, rejectionPanel } from '../../components/html.js';

export function renderFileRead(result: WorkspaceResult<WorkspaceFile>): string {
  if (result.status !== 'ready') return rejectionPanel(result as unknown as CoreRejection);
  const file = result.value;
  return `<section class="panel" data-view="file"><header><h3>${escapeHtml(file.path)}</h3>`
    + `<p class="muted">${file.sizeBytes} 字节</p>`
    + detailsFor('查看版本与摘要', `<p>version ${escapeHtml(JSON.stringify(file.version))} `
      + `· digest ${escapeHtml(file.digest.slice(0, 12))}</p>`)
    + `</header><pre>${escapeHtml(file.content)}</pre></section>`;
}

export function renderSourceCapture(result: WorkspaceResult<CaptureSummary>): string {
  if (result.status !== 'ready') return rejectionPanel(result as unknown as CoreRejection);
  const summary = result.value;
  return `<section class="panel" data-view="capture"><h3>来源已捕获</h3>`
    + `<p>新增 ${summary.changes.added.length} · 修改 ${summary.changes.modified.length} `
    + `· 删除 ${summary.changes.deleted.length}</p>`
    + detailsFor('查看捕获详情', `<p>capture <code>${escapeHtml(summary.ref.captureId ?? '')}</code> `
      + `· provider ${escapeHtml(summary.coverage.provider)} · complete ${String(summary.coverage.complete)}</p>`)
    + `</section>`;
}

// --- File save / compare (real Kernel CAS) -----------------------------------

/** Real CAS save receipt. A rejection is shown honestly and the draft stays. */
export function renderFileSave(result: WorkspaceResult<SaveWorkbenchFileResult> | null, draftChanged: boolean): string {
  if (result === null) {
    return `<p class="muted" data-save-state="idle">${draftChanged ? '有未保存草稿。保存时会核对磁盘版本。' : '与已读取版本一致，尚无待保存内容。'}</p>`;
  }
  if (result.status !== 'ready') {
    return `<div data-save-state="rejected"><p>保存未完成（${escapeHtml(result.code)}）：${escapeHtml(result.reason)}</p>`
      + `<p class="muted">草稿保留在内存；不会自动覆盖。可重新读取当前版本并比较后再保存。</p></div>`;
  }
  return `<div data-save-state="saved"><p>已保存 <code>${escapeHtml(result.value.path)}</code>`
    + ` · 新版本 <code>${escapeHtml(result.value.revision)}</code>`
    + (result.value.oldRevision === null ? ' · 新建' : ` · 原版本 <code>${escapeHtml(result.value.oldRevision)}</code>`) + `</p></div>`;
}

/** One computed line diff. Lines come from the two real read bodies, so the
 * result is derived, never a fabricated example diff. */
export function renderTextDiff(before: string, after: string, path: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const limit = 1200;
  const a = beforeLines.slice(0, limit);
  const b = afterLines.slice(0, limit);
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? (table[i + 1]![j + 1]! + 1) : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const rows: string[] = [];
  let i = 0; let j = 0;
  let beforeNo = 1; let afterNo = 1;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push(`<div class="diff-line context"><span class="ln">${beforeNo}</span><span class="ln">${afterNo}</span><code>${escapeHtml(a[i]!)}</code></div>`);
      i += 1; j += 1; beforeNo += 1; afterNo += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      rows.push(`<div class="diff-line removed"><span class="ln">${beforeNo}</span><span class="ln"></span><code>${escapeHtml(a[i]!)}</code></div>`);
      i += 1; beforeNo += 1;
    } else {
      rows.push(`<div class="diff-line added"><span class="ln"></span><span class="ln">${afterNo}</span><code>${escapeHtml(b[j]!)}</code></div>`);
      j += 1; afterNo += 1;
    }
    if (rows.length >= 6000) break;
  }
  while (i < a.length) { rows.push(`<div class="diff-line removed"><span class="ln">${beforeNo}</span><span class="ln"></span><code>${escapeHtml(a[i]!)}</code></div>`); i += 1; beforeNo += 1; }
  while (j < b.length) { rows.push(`<div class="diff-line added"><span class="ln"></span><span class="ln">${afterNo}</span><code>${escapeHtml(b[j]!)}</code></div>`); j += 1; afterNo += 1; }
  const truncated = beforeLines.length > limit || afterLines.length > limit;
  return `<div class="text-diff" data-view="text-diff" data-path="${escapeHtml(path)}">`
    + `<p class="muted">真实前后正文行级差异${truncated ? '（超出上限，仅显示前 1200 行）' : ''}</p>`
    + `<div class="diff-body">${rows.join('')}</div></div>`;
}

/** `files/compare` forwards the existing WorkspaceToolsPort.compareWorkspace
 * result. Changes are listed exactly; a real text diff is only added when both
 * read bodies were actually supplied for the same path. */
export function renderWorkspaceComparison(
  result: WorkspaceResult<WorkspaceComparison> | null,
  textDiff?: { path: string; before: string; after: string },
): string {
  const diffHtml = textDiff === undefined ? '' : renderTextDiff(textDiff.before, textDiff.after, textDiff.path);
  if (result === null) {
    return `<section class="panel" data-view="workspace-compare"><p class="muted">尚未执行比较；选择真实的前后版本后读取结果。</p>${diffHtml}</section>`;
  }
  if (result.status !== 'ready') {
    return `<section class="panel rejected" data-view="workspace-compare"><h3>比较未完成</h3>`
      + `<p>${escapeHtml(result.reason)}（${escapeHtml(result.code)}）</p></section>`;
  }
  const comparison = result.value;
  const changes = comparison.changes.map(change => {
    if (change.kind === 'added') return `<li data-change="added"><code>${escapeHtml(change.path)}</code> · 新增</li>`;
    if (change.kind === 'deleted') return `<li data-change="deleted"><code>${escapeHtml(change.path)}</code> · 删除</li>`;
    if (change.kind === 'modified') {
      const before = 'beforeDigest' in change ? change.beforeDigest
        : ('digest' in change.before ? change.before.digest : change.before.objectId);
      const after = 'afterDigest' in change ? change.afterDigest
        : ('digest' in change.after ? change.after.digest : change.after.objectId);
      return `<li data-change="modified"><code>${escapeHtml(change.path)}</code> · 修改`
        + ` <span class="muted">${escapeHtml(String(before).slice(0, 12))} \u2192 ${escapeHtml(String(after).slice(0, 12))}</span></li>`;
    }
    return `<li data-change="renamed"><code>${escapeHtml(change.beforePath)}</code> \u2192 <code>${escapeHtml(change.afterPath)}</code> · 重命名</li>`;
  }).join('');
  return `<section class="panel" data-view="workspace-compare">`
    + `<header><h3>工作区比较</h3>`
    + `<p class="muted">${escapeHtml(comparison.comparison)} · 变更 ${escapeHtml(comparison.changes.length)} 条</p>`
    + detailsFor('查看比较范围与版本', `<p>scope <code>${escapeHtml(JSON.stringify(comparison.scope))}</code></p>`
      + `<p>before <code>${escapeHtml(JSON.stringify(comparison.before))}</code></p>`
      + `<p>after <code>${escapeHtml(JSON.stringify(comparison.after))}</code></p>`)
    + `</header>`
    + (comparison.changes.length === 0 ? '<p class="muted">两个版本没有差异。</p>' : `<ul class="changes">${changes}</ul>`)
    + diffHtml + `</section>`;
}
