import type {
  FilesCompareResponse,
  FilesReadResponse,
  FilesSaveResponse,
  SourceCaptureResponse,
  WorkspaceVersion,
} from '../../../app/core-http-types.js';
import { callCore, outcomeRejectionReason, payloadOf } from '../../api/http.js';
import type { ScopeState } from '../../state/scope-state.js';
import { workspaceRefFor } from '../../state/values.js';
import { diffText, renderScopeIfSelected } from '../../state/workbench.js';
import { openTab, syncActiveLayout } from '../tabs/aux-layout.js';

// --- Kernel file save / compare ------------------------------------------------

export async function saveFile(scope: ScopeState, tabId: string): Promise<void> {
  const layout = syncActiveLayout(scope);
  const tab = layout.tabs.find(candidate => candidate.tabId === tabId);
  if (tab === undefined || tab.kind !== 'file') { scope.error = '文件页已关闭。'; renderScopeIfSelected(scope); return; }
  if (layout.readOnly) { scope.error = '当前会话只读，不能保存。'; renderScopeIfSelected(scope); return; }
  if (scope.config.writeAllowed !== true) {
    scope.error = '本工作区未授权文件写入（Host 未配置 writePrefixes），未发送保存请求。';
    renderScopeIfSelected(scope);
    return;
  }
  if (tab.file.version.kind !== 'working_tree') {
    scope.error = '该文件版本只读（历史/已捕获内容），只能查看或引用。';
    renderScopeIfSelected(scope);
    return;
  }
  const content = tab.editorDraft?.text ?? tab.file.content;
  if (content === tab.file.content) { scope.notice = '没有需要保存的改动。'; renderScopeIfSelected(scope); return; }
  // The original digest is the CAS expectation; the new body is the draft.
  const request = { scope: scope.config.scope, input: { path: tab.file.path, expectedRevision: tab.file.digest, content } };
  scope.sending = true;
  scope.error = null;
  scope.notice = null;
  renderScopeIfSelected(scope);
  const outcome = await callCore('files/save', request);
  scope.sending = false;
  if (outcome.kind === 'network') { scope.error = '保存结果未确认；草稿保留，请先重新读取核对。'; renderScopeIfSelected(scope); return; }
  const payload = payloadOf(outcome) as FilesSaveResponse;
  scope.saveResults.set(tabId, payload);
  if (payload.status !== 'ready') {
    scope.error = `保存未完成（${payload.code}）：${payload.reason}。草稿保留，可重新读取并比较。`;
    renderScopeIfSelected(scope);
    return;
  }
  scope.notice = `已保存 ${payload.value.path}（新版本 ${payload.value.revision}）。`;
  const read = await callCore('files/read', { scope: scope.config.scope, input: {
    workspace: workspaceRefFor(scope.config.scope), path: payload.value.path, maxBytes: 262144, version: { kind: 'working_tree' } } });
  const readPayload = read.kind === 'response' ? payloadOf(read) as FilesReadResponse : null;
  if (readPayload?.status === 'ready') {
    const savedFile = readPayload.value;
    // Updating the original page is not a new navigation. A late response must
    // not reopen a closed tab, switch Sessions, or overwrite newer typing.
    const latestTab = scope.auxTabs.find(candidate => candidate.tabId === tabId);
    if (latestTab?.kind === 'file') {
      const latestText = latestTab.editorDraft?.text ?? latestTab.file.content;
      const unchangedSinceSubmit = latestText === content;
      scope.auxTabs = scope.auxTabs.map(candidate =>
        candidate.tabId !== tabId ? candidate : {
          ...latestTab, file: savedFile,
          editorDraft: unchangedSinceSubmit ? null : { state: 'draft_snapshot' as const, text: latestText },
        });
      scope.notice += unchangedSinceSubmit ? '' : ' 后续编辑仍保留为未保存草稿。';
    }
    scope.saveResults.delete(tabId);
  } else {
    // The write receipt is already authoritative. A failed refresh cannot
    // turn a committed save into a failed write or invite blind resubmission.
    scope.notice += ' 保存已提交，最新内容读取未确认；草稿保留，请重新读取核对。';
  }
  renderScopeIfSelected(scope);
}

function compareVersion(scope: ScopeState, kind: string, commit: string): WorkspaceVersion | null {
  if (kind === 'working_tree') return { kind: 'working_tree' };
  if (kind === 'git') return commit.trim().length === 0 ? null : { kind: 'git', commit: commit.trim() };
  if (kind === 'capture') return scope.capture === null ? null : { kind: 'capture', capture: scope.capture.ref };
  return null;
}

export async function compareFiles(scope: ScopeState): Promise<void> {
  const form = { ...scope.compareForm };
  const target = { ...scope.config.scope };
  let before = compareVersion(scope, form.beforeKind, form.beforeCommit);
  let after = compareVersion(scope, form.afterKind, form.afterCommit);
  if (before === null || after === null) {
    scope.error = '请选择有效的前后版本：git 需要完整 commit，capture 需要已捕获来源。';
    renderScopeIfSelected(scope);
    return;
  }
  if ((before.kind === 'git' && after.kind === 'capture')
    || (before.kind === 'capture' && after.kind === 'git')) {
    scope.error = '暂不支持 Git 版本与已捕获来源直接比较；请选择 Git 与当前工作区，或两个已捕获来源。';
    renderScopeIfSelected(scope);
    return;
  }
  const prefix = form.prefix.trim();
  scope.sending = true;
  scope.error = null;
  renderScopeIfSelected(scope);
  // Freeze both selected versions before any await. Capturing the working
  // tree must not silently replace an explicitly selected older capture.
  if (before.kind !== 'git' && after.kind !== 'git'
    && (before.kind === 'working_tree' || after.kind === 'working_tree')) {
    const captured = await callCore('source/capture', { scope: target, input: {
      workspace: workspaceRefFor(target), workspaceRevision: scope.config.workspaceRevision,
      provider: 'text', ...(prefix.length === 0 ? {} : { prefix }),
    } });
    const capture = captured.kind === 'response' ? payloadOf(captured) as SourceCaptureResponse : null;
    if (capture?.status !== 'ready') {
      scope.sending = false;
      scope.error = capture === null ? '当前工作区快照结果未确认，未开始比较。'
        : `当前工作区快照未就绪：${outcomeRejectionReason(capture)}。未开始比较。`;
      renderScopeIfSelected(scope);
      return;
    }
    const snapshot: WorkspaceVersion = { kind: 'capture', capture: capture.value.ref };
    if (before.kind === 'working_tree') before = snapshot;
    if (after.kind === 'working_tree') after = snapshot;
    scope.capture = capture.value;
    scope.sourcePage = null;
  }
  const input: Record<string, unknown> = { workspace: workspaceRefFor(target), before, after };
  if (prefix.length > 0) input.prefix = prefix;
  const tabId = `diff:${JSON.stringify(before)}:${JSON.stringify(after)}:${prefix}`;
  const outcome = await callCore('files/compare', { scope: target, input });
  scope.sending = false;
  if (outcome.kind === 'network') { scope.error = '比较结果未确认。'; renderScopeIfSelected(scope); return; }
  const payload = payloadOf(outcome) as FilesCompareResponse;
  scope.compareResults.set(tabId, payload);
  openTab(scope, { tabId, kind: 'diff', title: `Diff ${before.kind}→${after.kind}`,
    before, after, prefix: prefix.length === 0 ? null : prefix });
  renderScopeIfSelected(scope);
}

/** Real text diff for one changed path: both versions are actually read through
 * files/read. A read failure is shown, never a fabricated diff. */
export async function loadTextDiff(scope: ScopeState, tabId: string, path: string): Promise<void> {
  const layout = syncActiveLayout(scope);
  const tab = layout.tabs.find(candidate => candidate.tabId === tabId);
  if (tab === undefined || tab.kind !== 'diff' || path.length === 0) return;
  const workspace = workspaceRefFor(scope.config.scope);
  const [beforeRead, afterRead] = await Promise.all([
    callCore('files/read', { scope: scope.config.scope, input: { workspace, path, maxBytes: 262144, version: tab.before } }),
    callCore('files/read', { scope: scope.config.scope, input: { workspace, path, maxBytes: 262144, version: tab.after } }),
  ]);
  const beforePayload = beforeRead.kind === 'response' ? payloadOf(beforeRead) as FilesReadResponse : null;
  const afterPayload = afterRead.kind === 'response' ? payloadOf(afterRead) as FilesReadResponse : null;
  if (beforePayload === null || afterPayload === null
    || beforePayload.status !== 'ready' || afterPayload.status !== 'ready') {
    scope.error = `无法读取 ${path} 的两个真实版本，未生成 diff。`;
    renderScopeIfSelected(scope);
    return;
  }
  diffText().set(`${scope.key}|${tabId}|${path}`,
    { path, before: beforePayload.value.content, after: afterPayload.value.content });
  renderScopeIfSelected(scope);
}
