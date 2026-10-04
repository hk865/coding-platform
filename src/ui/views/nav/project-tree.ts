import type {
  ArchitectureReadBody,
  BootstrapWorkspace,
  SessionCard,
  SessionRef,
  TaskGraph,
} from '../../../app/core-http-types.js';
import { submit } from '../../api/submit.js';
import { escapeHtml } from '../../components/html.js';
import { topIcon } from '../../components/icons.js';
import { groupWorkspacesByProject } from '../../settings.js';
import { saveGlobalDisplay, saveScopeDisplay } from '../../state/display-preference.js';
import type { ScopeState } from '../../state/scope-state.js';
import { sameSession, scopeKey } from '../../state/values.js';
import {
  bootstrap,
  renderAll,
  renderScopeIfSelected,
  scopes,
  selectedKey,
  setSelectedKey,
  view,
} from '../../state/workbench.js';
import { beginCollaborationPoll, collaborationGoalRef } from '../execution/collaboration.js';
import { currentGoalRefForList, loadExecutions } from '../execution/list.js';
import { loadDirectory } from '../files/directory.js';
import { AVAILABILITY_LABEL, roleConfigKey, roleLabel, roleLabelsForScope, shortIdentity } from '../sessions/labels.js';
import { buildSessionFindRequest } from '../sessions/requests.js';
import { restoreScopeDisplay } from '../sessions/restore.js';
import { buildSourceCaptureRequest, buildSourceQueryRequest } from '../setup/requests.js';
import { openTab } from '../tabs/aux-layout.js';

// --- Left: project / Agent navigation -----------------------------------------

/** Open a real auxiliary page kind from the top bar / `＋` chooser. It reuses
 * the existing owners and reads; it never defaults to project settings. */
export async function openPageKind(scope: ScopeState, page: string): Promise<void> {
  switch (page) {
    case 'tasks': {
      const goalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || currentGoalRefForList(scope)?.goalId || '';
      if (goalId.length === 0) { scope.error = '请先填写或创建目标，再打开任务图。'; renderScopeIfSelected(scope); return; }
      const goal: TaskGraph['plan']['goalRef'] = { aggregateType: 'Goal', projectId: scope.config.scope.projectId, goalId };
      scope.forms.goalId = goalId;
      openTab(scope, { tabId: `tasks:${goalId}`, kind: 'task_graph', title: '任务图', goal });
      saveScopeDisplay(scope);
      // Direct open reads the real graph; there is no forced setup step.
      await submit(scope, 'tasks/query', { scope: scope.config.scope, input: { goalRef: goal } });
      await loadExecutions(scope, false, goal);
      return;
    }
    case 'architecture': {
      const selection: ArchitectureReadBody['input']['selection'] = { kind: 'current' };
      openTab(scope, { tabId: 'architecture:current', kind: 'architecture_graph', title: '架构图', selection });
      await submit(scope, 'architecture/read', { scope: scope.config.scope, input: { selection } });
      return;
    }
    case 'files': {
      openTab(scope, { tabId: 'dir:', kind: 'directory', title: '文件', path: '' });
      await loadDirectory(scope, '', false); return;
    }
    case 'terminal': {
      openTab(scope, { tabId: 'terminal:new', kind: 'terminal', title: '命令', commandId: 'new', command: '', cwd: '.' });
      renderScopeIfSelected(scope); return;
    }
    case 'diff': {
      openTab(scope, { tabId: 'compare:new', kind: 'compare', title: 'Diff' });
      renderScopeIfSelected(scope); return;
    }
    default: {
      openTab(scope, { tabId: `blank:${String(Date.now())}`, kind: 'blank', title: '新页面' });
      renderScopeIfSelected(scope); return;
    }
  }
}

/** Real workspace snapshot -> path projection, in one step. Reuses an already
 * captured snapshot unless `refresh` is set; it writes nothing to disk. */
export async function ensureSourceTree(scope: ScopeState, refresh: boolean): Promise<void> {
  if (refresh || scope.capture === null) {
    if (refresh) scope.capture = null;
    await submit(scope, 'source/capture', buildSourceCaptureRequest());
    if (scope.capture === null) return;
    scope.sourcePage = null;
  }
  if (scope.sourcePage === null) await submit(scope, 'source/query', buildSourceQueryRequest(false));
}

/** Reuse the one scope-switch path for the tree click and the legacy <select>. */
export function switchScope(key: string): void {
  if (!scopes().has(key)) return;
  setSelectedKey(key);
  view.expandedProjects.add(key);
  saveGlobalDisplay();
  renderAll();
  const next = scopes().get(key);
  if (next === undefined) return;
  if (next.sessionFind === null) void submit(next, 'sessions/find', buildSessionFindRequest(false));
  void restoreScopeDisplay(next);
  const goalRef = next.collaboration?.goalRef ?? collaborationGoalRef(next, next.execution);
  if (goalRef !== null) beginCollaborationPoll(next, next.execution.scope ?? next.config.scope, goalRef);
}

function renderProjectChildren(current: ScopeState): string {
  const labels = roleLabelsForScope(current.config.scope);
  const labelCounts = new Map<string, number>();
  const found = current.sessionFind;
  const cards = found !== null && found.status === 'ready' ? found.value.items : [];
  for (const card of cards) {
    const name = labels.get(roleConfigKey(card.record.role)) ?? roleLabel(card.record.role);
    labelCounts.set(name, (labelCounts.get(name) ?? 0) + 1);
  }
  const memberRow = (card: SessionCard, archived: boolean): string => {
    const ref: SessionRef = { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId };
    const name = labels.get(roleConfigKey(card.record.role)) ?? roleLabel(card.record.role);
    const ambiguous = (labelCounts.get(name) ?? 0) > 1;
    const dot = archived ? 'idle'
      : card.availability === 'busy' ? 'busy' : card.availability === 'idle' ? '' : card.availability === 'recoverable' ? 'pending' : 'idle';
    const stateText = archived ? '只读' : AVAILABILITY_LABEL[card.availability];
    const selected = sameSession(current.activeSession, ref);
    const title = `${name} · ${ref.sessionId} · ${roleLabel(card.record.role)} · ${AVAILABILITY_LABEL[card.availability]}${archived ? ' · 归档只读' : ''}`;
    return `<li data-session="${escapeHtml(ref.sessionId)}">`
      + `<button class="q-person" data-action="select-session" data-session="${escapeHtml(ref.sessionId)}" aria-pressed="${String(selected)}" title="${escapeHtml(title)}">`
      + `<span class="q-dot ${dot}" aria-hidden="true"></span>`
      + `<span class="q-member-label">${escapeHtml(name)}${ambiguous ? ` <small class="q-member-suffix">${escapeHtml(ref.sessionId.slice(-4))}</small>` : ''}</span>`
      + `<span class="q-member-state">${escapeHtml(stateText)}</span></button></li>`;
  };
  const main = `<li><button class="q-person" data-action="select-main-conversation" aria-pressed="${String(current.activeSession === null)}" title="项目主对话${current.mainSession === null ? '' : ` · ${escapeHtml(current.mainSession.sessionId)}`}">`
    + `<span class="q-dot"></span><span class="q-member-label">主对话</span>`
    + (current.mainSession === null ? '' : `<span class="q-member-state">${escapeHtml(shortIdentity(current.mainSession.sessionId))}</span>`) + `</button></li>`;
  const activeCards = cards.filter(card => card.record.lifecycle === 'active');
  const list = found === null ? '<li class="q-nav-empty">尚未读取成员</li>'
    : found.status !== 'ready' ? `<li class="q-nav-empty">成员目录暂不可用（${escapeHtml(found.status)}）</li>`
      : activeCards.length === 0 ? '<li class="q-nav-empty">没有活跃成员</li>'
        : activeCards.map(card => memberRow(card, false)).join('');
  const archived = cards.filter(card => card.record.lifecycle === 'archived');
  const archiveBlock = archived.length === 0 ? ''
    : `<li><details class="q-archive"${current.sessionIncludeArchived ? ' open' : ''}><summary>已归档（只读）</summary>`
      + `<ul class="q-people">${archived.map(card => memberRow(card, true)).join('')}</ul></details></li>`;
  const canNext = found !== null && found.status === 'ready' && found.value.nextCursor !== null;
  return main + list + archiveBlock
    + `<li class="q-project-actions"><button data-action="refresh-members">刷新成员</button>`
    + `<button data-action="toggle-archived">${current.sessionIncludeArchived ? '隐藏归档' : '加载归档'}</button>`
    + (canNext ? '<button data-action="next-sessions">下一页</button>' : '') + `</li>`;
}

function renderWorkspaceNode(workspace: BootstrapWorkspace, current: ScopeState | undefined): string {
  const key = scopeKey(workspace.scope);
  const isCurrent = key === selectedKey();
  const expanded = view.expandedProjects.has(key);
  const caret = `<button class="q-caret" data-action="toggle-project" data-scope-key="${escapeHtml(key)}"`
    + ` aria-expanded="${String(expanded)}" aria-label="${expanded ? '折叠' : '展开'} ${escapeHtml(workspace.name)}">`
    + topIcon(expanded ? 'chevron-down' : 'chevron-right') + `</button>`;
  const name = `<button class="q-project-name" data-action="select-scope" data-scope-key="${escapeHtml(key)}"`
    + ` aria-pressed="${String(isCurrent)}" title="${escapeHtml(workspace.name)}">${escapeHtml(workspace.name)}</button>`;
  const detail = `<details class="q-project-detail"><summary>项目详情</summary>`
    + `<p class="muted"><code>${escapeHtml(key)}</code> · revision ${escapeHtml(workspace.workspaceRevision)}</p></details>`;
  const children = expanded
    ? (isCurrent && current !== undefined ? renderProjectChildren(current)
      : '<li class="q-nav-empty">切换到此项目后读取成员</li>')
    : '';
  return `<li class="q-project"${isCurrent ? ' data-current="true"' : ''}>`
    + `<div class="q-project-head">${caret}${name}</div>${detail}`
    + (children === '' ? '' : `<ul class="q-project-children">${children}</ul>`) + `</li>`;
}

/** Project heading -> workspace rows -> members. A second workspace under one
 * project is never swallowed and the first scope is never substituted; a
 * single-workspace project keeps the exact original single-node rendering. */
export function renderNav(): string {
  const loaded = bootstrap();
  if (loaded === null) return '';
  const current = scopes().get(selectedKey());
  const groups = groupWorkspacesByProject(loaded.workspaces);
  const projects = groups.map(group => {
    const only = group.workspaces[0];
    if (group.workspaces.length === 1 && only !== undefined) return renderWorkspaceNode(only, current);
    const workspaces = group.workspaces.map(workspace => renderWorkspaceNode(workspace, current)).join('');
    return `<li class="q-project q-project-group" data-project="${escapeHtml(group.projectId)}">`
      + `<div class="q-project-head"><span class="q-project-name q-project-group-label">${escapeHtml(only?.name ?? group.projectId)}</span></div>`
      + `<ul class="q-project-children q-workspace-list">${workspaces}</ul></li>`;
  }).join('');
  return `<div class="q-section">项目</div><ul class="q-projects">${projects}</ul>`;
}
