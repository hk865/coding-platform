/// <reference lib="dom" />
/** Auxiliary tab layout per scope: the active layout, opening a tab, and the tab and work-target ref helpers. */

import type {
  ArchitectureReadBody,
  CoreScope,
  RunRef,
  SessionRecord,
  SessionRef,
  TaskGraph,
} from '../../../app/core-http-types.js';
import { list } from '../../components/html.js';
import { reduceWorkbenchLayout } from '../../state/layout.js';
import type { WorkLinkTarget, WorkbenchLayout, WorkbenchTab } from '../../state/layout.js';
import type { ScopeState } from '../../state/scope-state.js';
import { conversationKey, record, sameSession } from '../../state/values.js';
import { state, view } from '../../state/workbench.js';
import { executionHistoryMatches } from '../history/timeline.js';
import type { WorkbenchExecutionHistoryPage } from '../history/timeline.js';
import { sessionRefFromFind } from '../sessions/requests.js';

export function sessionLifecycle(scope: ScopeState, ref: SessionRef | null): SessionRecord['lifecycle'] | null {
  if (ref === null) return null;
  const mainRead = scope.mainSessionRead;
  if (mainRead !== null && sameSession(mainRead.session, ref)) {
    return mainRead.result.status === 'ready' ? mainRead.result.value.record.lifecycle : null;
  }
  const read = scope.sessionRead;
  if (read !== null && sameSession(read.session, ref) && read.result.status === 'ready') return read.result.value.record.lifecycle;
  const found = scope.sessionFind;
  if (found !== null && found.status === 'ready') {
    const card = found.value.items.find(item => item.record.ref.sessionId === ref.sessionId);
    if (card !== undefined) return card.record.lifecycle;
  }
  const related = scope.relatedSessions;
  if (related !== null && related.result.status === 'ready') {
    const card = related.result.value.items.find(item => item.record.ref.sessionId === ref.sessionId);
    if (card !== undefined) return card.record.lifecycle;
  }
  // Unread registration stays unknown; it is never inferred from a listing order.
  return null;
}

export const setupTab = (): WorkbenchTab => ({ tabId: 'setup', kind: 'setup', title: '项目 / 计划' });

/** One composite view for the current selection: the project-shared tabs plus
 * the current recipient's draft and read-only fact. Nothing is cached per
 * conversation, so switching members can never split the auxiliary pane. */
export function activeLayout(scope: ScopeState): WorkbenchLayout {
  const key = conversationKey(scope.activeSession);
  return {
    scope: scope.config.scope,
    session: scope.activeSession,
    tabs: scope.auxTabs,
    activeTabId: scope.auxActiveTabId,
    composerDraft: scope.drafts.get(key) ?? { state: 'draft_snapshot', text: '', references: [] },
    readOnly: sessionLifecycle(scope, scope.activeSession ?? scope.mainSession) === 'archived',
  };
}
export function storeLayout(scope: ScopeState, layout: WorkbenchLayout): void {
  scope.auxTabs = layout.tabs;
  scope.auxActiveTabId = layout.activeTabId;
  scope.drafts.set(conversationKey(layout.session), layout.composerDraft);
}
export function syncActiveLayout(scope: ScopeState): WorkbenchLayout {
  return activeLayout(scope);
}

export function openTab(scope: ScopeState, tab: WorkbenchTab): void {
  view.contextNode = null;
  // An explicit open reveals the auxiliary area; it can still be hidden again.
  view.auxVisible = true;
  storeLayout(scope, reduceWorkbenchLayout(syncActiveLayout(scope), { kind: 'open_tab', tab }));
}

/** A file/diff page belongs to the project pane, not to the Session it was opened
 * from: the captured origin Session is only the draft/history source. */
// (removed) file/diff pages open into the project-shared tab pane via openTab.
export function sameWorkLinkTarget(left: WorkLinkTarget, right: WorkLinkTarget): boolean {
  if (left.kind === 'task' && right.kind === 'task') {
    return left.ref.projectId === right.ref.projectId && left.ref.goalId === right.ref.goalId
      && left.ref.taskId === right.ref.taskId;
  }
  if (left.kind === 'module' && right.kind === 'module') {
    return left.ref.projectId === right.ref.projectId && left.ref.moduleId === right.ref.moduleId;
  }
  if (left.kind === 'work' && right.kind === 'work') {
    return left.ref.projectId === right.ref.projectId && left.ref.workspaceId === right.ref.workspaceId
      && left.ref.workId === right.ref.workId;
  }
  return false;
}

export function readyTaskGraphValue(scope: ScopeState): TaskGraph | null {
  const payload = record(scope.taskGraph);
  return payload.status === 'ready' ? payload.value as TaskGraph : null;
}

export function moduleDefinition(scope: ScopeState, moduleId: string): Record<string, unknown> | null {
  const read = record(scope.architectureRead);
  const revisions: unknown[] = [];
  if (read.status === 'ready') revisions.push(read.value);
  if (scope.adopted !== null) revisions.push(scope.adopted);
  for (const revision of revisions) {
    const modules = list(record(record(record(revision).catalog).catalog).modules);
    for (const entry of modules) {
      const module = record(entry);
      if (record(module.ref).moduleId === moduleId) return module;
    }
  }
  return null;
}

export const architectureSelectionKey = (selection: ArchitectureReadBody['input']['selection']): string =>
  selection.kind === 'current' ? 'current' : `revision:${selection.ref.baselineId}@${selection.ref.revision}`;

// Auxiliary visibility lives in the top bar and tab strip.
export function workTargetFromElement(element: HTMLElement): WorkLinkTarget | null {
  const kind = element.dataset.targetKind;
  const projectId = element.dataset.projectId ?? '';
  if (kind === 'task') return { kind: 'task', ref: { projectId, goalId: element.dataset.goalId ?? '', taskId: element.dataset.taskId ?? '' } };
  if (kind === 'module') return { kind: 'module', ref: { projectId, moduleId: element.dataset.moduleId ?? '' } };
  if (kind === 'work') return { kind: 'work', ref: { aggregateType: 'WorkContextBinding', projectId, workspaceId: element.dataset.workspaceId ?? '', workId: element.dataset.workId ?? '' } };
  return null;
}

export function sessionRefFromAny(scope: ScopeState, sessionId: string): SessionRef | null {
  const fromFind = sessionRefFromFind(scope, sessionId);
  if (fromFind !== null) return fromFind;
  const related = scope.relatedSessions;
  if (related !== null && related.result.status === 'ready') {
    const card = related.result.value.items.find(item => item.record.ref.sessionId === sessionId);
    if (card !== undefined) return { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId };
  }
  return scope.activeSession !== null && scope.activeSession.sessionId === sessionId ? scope.activeSession : null;
}

/** Related-Session page builder. It keeps the exact `target` and the related
 * page's OWN cursor; it never borrows the project directory's cursor/request, so
 * the two `sessions/find` pages stay separate. A filter change marks the old
 * target result unread (the caller clears it) instead of relabelling it. */
export function buildRelatedSessionsRequest(next: boolean): unknown | null {
  const current = state();
  const related = current.relatedSessions;
  if (related === null) return null;
  // Continue the ORIGINAL target + filter (+ optional role) with that page's own
  // cursor; never the current directory filter or another page's cursor.
  const input: Record<string, unknown> = { workspace: current.config.scope, target: related.target,
    includeArchived: related.includeArchived };
  if (related.role !== null) input.role = related.role;
  if (!next) {
    input.page = { limit: 10 };
    return { scope: current.config.scope, input };
  }
  if (related.result.status !== 'ready' || related.result.value.nextCursor === null) return null;
  input.page = { limit: 10, cursor: related.result.value.nextCursor, atLeastCursor: related.result.value.sourceCursor };
  return { scope: current.config.scope, input };
}

/** The run-window page builder. It receives the exact scope, RunRef and the page
 * being continued; `next` follows that page's own `nextCursor` and never invents
 * or rewrites a cursor. `limit` is the scan count, not the match count. */
export function buildExecutionHistoryRequest(
  targetScope: CoreScope, run: RunRef, previous: WorkbenchExecutionHistoryPage | null, next: boolean,
): unknown | null {
  let afterCursor: string | null = null;
  if (next) {
    if (previous === null || !executionHistoryMatches(previous, targetScope, run)
      || previous.result.status !== 'ready' || previous.result.value.nextCursor === null) return null;
    afterCursor = previous.result.value.nextCursor;
  }
  return { scope: targetScope, input: { runRef: run, afterCursor, limit: 10 } };
}

/** One execution page is one typed tab per scope + full RunRef; a title never
 * carries identity. */
export const executionTabId = (run: RunRef): string =>
  `execution:${run.aggregateType}:${run.projectId}:${run.goalId}:${run.runId}`;

/** Read the complete typed RunRef from the rendered entry's data attributes. */
export function runRefFromElement(element: HTMLElement): RunRef | null {
  const aggregateType = element.dataset.aggregateType;
  const projectId = element.dataset.projectId ?? '';
  const goalId = element.dataset.goalId ?? '';
  const runId = element.dataset.runId ?? '';
  if (aggregateType !== 'Run' || projectId.length === 0 || goalId.length === 0 || runId.length === 0) return null;
  return { aggregateType, projectId, goalId, runId };
}

export function taskTripleFromElement(element: HTMLElement): Extract<WorkbenchTab, { kind: 'execution_history' }>['task'] {
  const projectId = element.dataset.projectId ?? '';
  const goalId = element.dataset.goalId ?? '';
  const taskId = element.dataset.taskId ?? '';
  if (projectId.length === 0 || goalId.length === 0 || taskId.length === 0) return null;
  return { projectId, goalId, taskId };
}

/** The active auxiliary tab when it is an execution page, else null. */
export function activeExecutionTab(scope: ScopeState): Extract<WorkbenchTab, { kind: 'execution_history' }> | null {
  const layout = syncActiveLayout(scope);
  const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
  return tab !== undefined && tab.kind === 'execution_history' ? tab : null;
}
