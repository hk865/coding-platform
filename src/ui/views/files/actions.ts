/// <reference lib="dom" />
/** File actions: the source tree, comparison and Diff, file save, directory and file pages, and draft references. */

import { submit } from '../../api/submit.js';
import { reduceWorkbenchLayout } from '../../state/layout.js';
import type { WorkbenchDraftReference } from '../../state/layout.js';
import { record } from '../../state/values.js';
import { renderScopeIfSelected } from '../../state/workbench.js';
import { loadDirectory, normalizeDirectoryInput, showMoreDirectoryInventory } from './directory.js';
import { compareFiles, loadTextDiff, saveFile } from './save-diff.js';
import { ensureSourceTree } from '../nav/project-tree.js';
import { requireBody } from '../sessions/requests.js';
import { buildFileRequest } from '../setup/requests.js';
import type { ActionTable } from '../shell/actions.js';
import { openTab, storeLayout, syncActiveLayout } from '../tabs/aux-layout.js';

export const fileActions = {
  'refresh-source-tree': async scope => { await ensureSourceTree(scope, true); return; },
  'compare-path': (scope, element) => {
    scope.compareForm.prefix = element.dataset.path ?? '';
    openTab(scope, { tabId: 'compare:new', kind: 'compare', title: 'Diff' });
    renderScopeIfSelected(scope);
    return;
  },
  'save-file': async (scope, element) => { await saveFile(scope, element.dataset.tab ?? ''); return; },
  'compare-files': async scope => { await compareFiles(scope); return; },
  'load-text-diff': async (scope, element) => { await loadTextDiff(scope, element.dataset.tab ?? '', element.dataset.path ?? ''); return; },
  'open-directory': async (scope, element) => {
    const path = element.dataset.path ?? '';
    openTab(scope, { tabId: `dir:${path}`, kind: 'directory', title: `目录 ${path.length === 0 ? '/' : path}`, path });
    await loadDirectory(scope, path, false);
    return;
  },
  'open-directory-input': async (scope, element) => {
    // The input belongs to THIS tab/scope (fixed origin); it never reuses the
    // global source prefix, so typing here cannot carry another scope's path.
    const tabId = element.dataset.tab ?? '';
    const input = Array.from(document.querySelectorAll<HTMLInputElement>('[data-field="directoryPrefix"]'))
      .find(candidate => candidate.dataset.tab === tabId) ?? null;
    const path = normalizeDirectoryInput(input?.value ?? '');
    openTab(scope, { tabId: `dir:${path}`, kind: 'directory', title: `目录 ${path.length === 0 ? '/' : path}`, path });
    await loadDirectory(scope, path, false);
    return;
  },
  'refresh-directory': async scope => {
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
    if (tab === undefined || tab.kind !== 'directory') { scope.error = '请先打开目录页。'; renderScopeIfSelected(scope); return; }
    await loadDirectory(scope, tab.path, true);
    return;
  },
  'directory-more': scope => {
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
    if (tab === undefined || tab.kind !== 'directory') return;
    const inventory = scope.directories.get(tab.path);
    if (inventory === undefined) return;
    // Local only: reveal the next 100 of the SAME list, never a request.
    scope.directories.set(tab.path, showMoreDirectoryInventory(inventory));
    renderScopeIfSelected(scope);
    return;
  },
  'open-file': async (scope, element) => {
    const path = element.dataset.path ?? '';
    const body = buildFileRequest(path);
    if (!requireBody(scope, body)) return;
    scope.forms.filePath = path;
    await submit(scope, 'files/read', body);
    const envelope = record(scope.lastResponse?.payload);
    // Only THIS request's ready result opens a file page; a rejected/not_found
    // answer never falls back to a stale `scope.file`.
    const file = scope.lastRequest?.body === body && envelope.status === 'ready'
      && scope.file !== null && scope.file.path === path ? scope.file : null;
    if (file !== null) {
      const versionKey = JSON.stringify(file.version);
      openTab(scope, { tabId: `file:${file.path}@${versionKey}`, kind: 'file', title: file.path, file, editorDraft: null });
    }
    renderScopeIfSelected(scope);
    return;
  },
  'add-path-reference': (scope, element) => {
    const path = element.dataset.path ?? '';
    if (path.length === 0) return;
    storeLayout(scope, reduceWorkbenchLayout(syncActiveLayout(scope), { kind: 'add_reference', reference: { kind: 'path', path } }));
    scope.notice = `已把 ${path} 加入当前对话草稿；未发送。`;
    renderScopeIfSelected(scope);
    return;
  },
  'add-selection-reference': (scope, element) => {
    const path = element.dataset.path ?? '';
    const tabId = element.dataset.tab ?? '';
    const textarea = Array.from(document.querySelectorAll<HTMLTextAreaElement>('[data-field="fileEditor"]'))
      .find(candidate => candidate.dataset.tab === tabId) ?? null;
    if (textarea === null) { scope.error = '找不到文件编辑区。'; renderScopeIfSelected(scope); return; }
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const selected = value.slice(start, end);
    if (selected.trim().length === 0) { scope.error = '请先在文件页选择要引用的文本。'; renderScopeIfSelected(scope); return; }
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === tabId);
    if (tab === undefined || tab.kind !== 'file') { scope.error = '文件页已关闭。'; renderScopeIfSelected(scope); return; }
    const startLine = value.slice(0, start).split('\n').length;
    const endLine = startLine + selected.split('\n').length - 1;
    const changed = tab.editorDraft !== null && tab.editorDraft.text !== tab.file.content;
    const reference: WorkbenchDraftReference = { kind: 'selection', path: tab.file.path, text: selected, startLine, endLine,
      version: tab.file.version, digest: tab.file.digest, source: changed ? 'draft_snapshot' : 'file' };
    storeLayout(scope, reduceWorkbenchLayout(layout, { kind: 'add_reference', reference }));
    scope.notice = `已加入选区引用 ${tab.file.path}:L${startLine}-L${endLine}${changed ? '（草稿快照）' : ''}；未发送。`;
    renderScopeIfSelected(scope);
    return;
  },
} satisfies ActionTable;
