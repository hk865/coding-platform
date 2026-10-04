/** File tabs: the file page, the directory page, the Diff page and the comparison form. */

import { actionButton, escapeHtml } from '../../components/html.js';
import type { WorkbenchLayout, WorkbenchTab } from '../../state/layout.js';
import { diffText, state } from '../../state/workbench.js';
import { renderFileSave, renderTextDiff, renderWorkspaceComparison } from './render.js';

export function renderDiffTab(tab: Extract<WorkbenchTab, { kind: 'diff' }>): string {
  const current = state();
  const stored = current.compareResults.get(tab.tabId) ?? null;
  const ready = stored !== null && stored.status === 'ready' ? stored.value : null;
  const modified = ready === null ? [] : ready.changes.filter(change => change.kind === 'modified').map(change => change.path);
  const prefix = `${current.key}|${tab.tabId}|`;
  const diffs = [...diffText().entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
  return `<section class="panel" data-view="diff-tab" data-tab="${escapeHtml(tab.tabId)}">`
    + `<header><h3>工作区 Diff</h3><p class="muted">before <code>${escapeHtml(JSON.stringify(tab.before))}</code>`
    + ` → after <code>${escapeHtml(JSON.stringify(tab.after))}</code>${tab.prefix === null ? '' : ` · prefix ${escapeHtml(tab.prefix)}`}</p></header>`
    + (modified.length === 0 ? '' : `<div class="buttons">${modified.map(path =>
        `<button data-action="load-text-diff" data-tab="${escapeHtml(tab.tabId)}" data-path="${escapeHtml(path)}">显示 ${escapeHtml(path)} 行级差异</button>`).join('')}</div>`)
    + renderWorkspaceComparison(stored)
    + diffs.map(diff => `<div data-view="diff-text">${renderTextDiff(diff.before, diff.after, diff.path)}</div>`).join('')
    + `</section>`;
}

export function renderFileTab(layout: WorkbenchLayout, tab: Extract<WorkbenchTab, { kind: 'file' }>): string {
  const current = state();
  const file = tab.file;
  const draft = tab.editorDraft;
  const text = draft === null ? file.content : draft.text;
  const changed = draft !== null && draft.text !== file.content;
  // A capture/git read version is immutable: it is shown read-only and is never
  // presented as an edited buffer. References may still cite that exact version.
  const workingTree = file.version.kind === 'working_tree';
  // Editing requires BOTH a working-tree read and the Host's explicit write
  // authorization; read prefixes never imply write permission.
  const writeAllowed = current.config.writeAllowed === true;
  const editable = !layout.readOnly && workingTree && writeAllowed;
  const canReference = !layout.readOnly;
  const draftState = !workingTree ? 'readonly_version' : changed ? 'draft_snapshot' : 'saved';
  const draftLabel = !workingTree
    ? '历史/已捕获版本：只读，不作为已编辑内容；加入引用使用该版本事实。'
    : changed ? '草稿快照（未保存，仅本页内存）' : '与已读取版本一致';
  const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
  return `<section class="panel file-page" data-view="file-page" data-path="${escapeHtml(file.path)}">`
    + `<header><h3>${escapeHtml(file.path)}</h3>`
    + `<p class="muted">${escapeHtml(file.sizeBytes)} 字节 · 版本 <code>${escapeHtml(JSON.stringify(file.version))}</code> · digest ${escapeHtml(file.digest.slice(0, 12))}</p>`
    + `<p data-draft-state="${draftState}">${escapeHtml(draftLabel)}</p></header>`
    + `<textarea class="file-editor" data-field="fileEditor" data-tab="${escapeHtml(tab.tabId)}" data-path="${escapeHtml(file.path)}" rows="14"${editable ? '' : ' readonly'}>${escapeHtml(text)}</textarea>`
    + `<div class="buttons">`
      + `<button data-action="add-path-reference" data-path="${escapeHtml(file.path)}" data-tab="${escapeHtml(tab.tabId)}"${canReference ? '' : ' disabled'}>加入整文件引用</button>`
      + `<button data-action="add-selection-reference" data-path="${escapeHtml(file.path)}" data-tab="${escapeHtml(tab.tabId)}"${canReference ? '' : ' disabled'}>加入选区引用</button>`
      + (directory.length === 0 ? '' : `<button data-action="open-directory" data-path="${escapeHtml(directory)}">打开所在目录</button>`)
    + `</div>`
    + `<div class="buttons">`
      + `<button data-action="save-file" data-tab="${escapeHtml(tab.tabId)}"${editable && changed ? '' : ' disabled'}>保存</button>`
      + `<button data-action="read-path" data-path="${escapeHtml(file.path)}">重新读取工作区版本</button>`
    + `</div>`
    + (writeAllowed || !workingTree ? '' : '<p class="muted">本工作区未授权文件写入（Host 未配置 writePrefixes）；该页只读。</p>')
    + renderFileSave(current.saveResults.get(tab.tabId) ?? null, changed)
    + `</section>`;
}

export function renderDirectoryTab(layout: WorkbenchLayout, tab: Extract<WorkbenchTab, { kind: 'directory' }>): string {
  const current = state();
  const prefix = tab.path;
  const inventory = current.directories.get(prefix) ?? null;
  const visible = inventory === null ? [] : inventory.paths.slice(0, inventory.visibleCount);
  type PathBranch = { directories: Map<string, PathBranch>; files: Map<string, string> };
  const tree: PathBranch = { directories: new Map(), files: new Map() };
  const relativePrefix = prefix.length === 0 ? '' : `${prefix.replace(/\/$/, '')}/`;
  for (const rawPath of visible) {
    if (rawPath.length === 0) continue;
    const relative = relativePrefix !== '' && rawPath.startsWith(relativePrefix)
      ? rawPath.slice(relativePrefix.length) : rawPath;
    const segments = relative.split('/');
    const name = segments.pop();
    if (!name) continue;
    let branch = tree;
    for (const segment of segments) {
      let child = branch.directories.get(segment);
      if (child === undefined) {
        child = { directories: new Map(), files: new Map() };
        branch.directories.set(segment, child);
      }
      branch = child;
    }
    branch.files.set(name, rawPath);
  }
  const renderBranch = (branch: PathBranch, directory: string): string => {
    const directories = [...branch.directories.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => {
        const path = directory.length === 0 ? name : `${directory}/${name}`;
        return `<li><details open data-directory-path="${escapeHtml(path)}"><summary>${escapeHtml(name)}/</summary>`
          + `<ul class="paths">${renderBranch(child, path)}</ul></details>`
          + `<button class="link" data-action="open-directory" data-path="${escapeHtml(path)}" title="仅列出该目录，缩小范围">打开此目录</button></li>`;
      }).join('');
    const files = [...branch.files.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, path]) => `<li data-path="${escapeHtml(path)}">`
        + `<button class="link" data-action="open-file" data-path="${escapeHtml(path)}" title="${escapeHtml(path)}">${escapeHtml(name)}</button>`
        + `<button class="link" data-action="add-path-reference" data-path="${escapeHtml(path)}"${layout.readOnly ? ' disabled' : ''}>加入引用</button></li>`).join('');
    return directories + files;
  };
  const rows = renderBranch(tree, prefix.replace(/\/$/, ''));
  const loadedCount = inventory === null ? 0 : inventory.paths.length;
  const shownCount = inventory === null ? 0 : Math.min(inventory.visibleCount, loadedCount);
  // A `partial` reply is NEVER a complete listing: say so whenever it is true,
  // including when it carried ZERO paths, so an incomplete empty page is never
  // shown as an empty directory.
  const partialNote = inventory !== null && inventory.partial
    ? '<p class="muted">未完整列出，可缩小目录范围。</p>' : '';
  let body: string;
  if (inventory === null) {
    body = '<p class="muted">尚未列出路径。</p>';
  } else if (inventory.loading && loadedCount === 0) {
    body = '<p class="muted">正在列出…</p>';
  } else if (loadedCount === 0 && inventory.error !== null) {
    body = `<p class="muted">列出失败：${escapeHtml(inventory.error)}</p>`;
  } else if (loadedCount === 0) {
    // A partial 0-path reply is an INCOMPLETE listing; only a complete reply may
    // be shown as an empty directory.
    body = inventory.partial
      ? partialNote + '<p class="muted">当前未列出路径。</p>'
      : '<p class="muted">该目录没有可列出的文件。</p>';
  } else {
    const stale = inventory.error !== null && inventory.stale;
    body = (inventory.loading ? '<p class="muted">正在刷新…</p>' : '')
      + (stale
        ? `<p class="muted">刷新失败，以下为<strong>旧列表</strong>（归属 ${escapeHtml(inventory.prefix.length === 0 ? '/' : inventory.prefix)}）：${escapeHtml(inventory.error ?? '')}</p>`
        : '')
      + partialNote
      + `<p class="muted">已显示 ${shownCount}/${loadedCount} 个路径。</p>`
      + `<ul class="paths">${rows}</ul>`;
  }
  return `<section class="panel directory-page" data-view="directory-page" data-path="${escapeHtml(prefix)}"`
    + (inventory !== null && inventory.error !== null && inventory.stale ? ` data-stale-prefix="${escapeHtml(inventory.prefix)}"` : '')
    + `><header><h3>目录 ${escapeHtml(prefix.length === 0 ? '/' : prefix)}</h3>`
    + `<p class="muted">浏览工作区文件；可输入目录路径缩小范围。</p></header>`
    + `<div class="buttons">`
      + `<label class="inline">目录 <input data-field="directoryPrefix" data-tab="${escapeHtml(tab.tabId)}" value="${escapeHtml(prefix)}" placeholder="src（留空为根）"></label>`
      + `<button data-action="open-directory-input" data-tab="${escapeHtml(tab.tabId)}">打开</button>`
      + actionButton('refresh-directory', '刷新', inventory === null || !inventory.loading, inventory?.loading ? '正在列出' : '')
      + actionButton('directory-more', '显示更多', inventory !== null && inventory.visibleCount < inventory.paths.length, '已全部显示')
    + `</div>`
    + body
    + `</section>`;
}

export function renderCompareForm(): string {
  const current = state();
  const form = current.compareForm;
  const options = (value: string): string => ['working_tree', 'git', 'capture'].map(kind =>
    `<option value="${kind}"${value === kind ? ' selected' : ''}>${kind === 'working_tree' ? '当前工作区' : kind === 'git' ? 'Git commit' : '已捕获来源'}</option>`).join('');
  const commitField = (side: 'Before' | 'After', kind: string, commit: string): string =>
    kind === 'git' ? `<input data-field="compare${side}Commit" value="${escapeHtml(commit)}" placeholder="完整 commit OID">` : '';
  return `<section class="panel" data-view="compare-form"><h3>工作区比较</h3>`
    + `<p class="muted">Git 可与另一 Git 版本或当前工作区比较；当前工作区与已捕获来源比较时先取得快照。Git 与已捕获来源不能混合比较。</p>`
    + `<label class="inline">前版本 <select data-field="compareBeforeKind">${options(form.beforeKind)}</select>${commitField('Before', form.beforeKind, form.beforeCommit)}</label>`
    + `<label class="inline">后版本 <select data-field="compareAfterKind">${options(form.afterKind)}</select>${commitField('After', form.afterKind, form.afterCommit)}</label>`
    + `<label class="inline">前缀 <input data-field="comparePrefix" value="${escapeHtml(form.prefix)}" placeholder="src"></label>`
    + `<div class="buttons"><button data-action="compare-files">比较并打开 Diff 页</button></div></section>`;
}
