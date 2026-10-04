/// <reference lib="dom" />

/** Graph interaction: active modules from real Session links, the containment toggle and the in-place graph-node selection. */

import { reduceWorkbenchLayout } from '../../state/layout.js';
import type { WorkbenchNodeSelection } from '../../state/layout.js';
import type { ScopeState } from '../../state/scope-state.js';
import { renderScopeIfSelected } from '../../state/workbench.js';
import { renderDetail } from './detail.js';
import { storeLayout, syncActiveLayout } from '../tabs/aux-layout.js';

/** Active modules from real Session links/occupancy plus running Task
 * executions. Containment never comes from paths; this only names the modules. */
export function computeActiveModuleIds(scope: ScopeState): string[] {
  const active = new Set<string>();
  const cards = scope.sessionFind !== null && scope.sessionFind.status === 'ready' ? scope.sessionFind.value.items : [];
  const runningTasks = new Set((scope.executionList?.items ?? [])
    .filter(item => item.run.status !== 'ended').map(item => item.run.task.taskId));
  for (const card of cards) {
    if (card.record.lifecycle !== 'active') continue;
    const busy = card.availability === 'busy' || card.record.occupancy !== null;
    const linkedRunningTask = card.links.some(link =>
      link.ref.target.kind === 'task' && runningTasks.has(link.ref.target.ref.taskId));
    if (!busy && !linkedRunningTask) continue;
    for (const link of card.links) if (link.ref.target.kind === 'module') active.add(link.ref.target.ref.moduleId);
  }
  return [...active];
}

export function toggleContainment(scope: ScopeState, moduleId: string): void {
  if (moduleId.length === 0) return;
  const expanded = scope.containment.expanded;
  scope.containment.expanded = expanded.includes(moduleId)
    ? expanded.filter(id => id !== moduleId) : [...expanded, moduleId];
  renderScopeIfSelected(scope);
}

/** Capture one graph-node selection synchronously in the scope and tab that
 * owned the click, then refresh only the rendered SVG selection mark and the
 * stable selection container. The SVG node element is kept alive so a native
 * double click / context menu can still toggle its pin; no timer and no
 * cross-scope callback exists. */
export function selectGraphNode(scope: ScopeState, element: HTMLElement): void {
  const layout = syncActiveLayout(scope);
  const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
  if (tab === undefined || (tab.kind !== 'task_graph' && tab.kind !== 'architecture_graph')) return;
  const selection = selectionFromNodeElement(scope, element);
  if (selection === null) return;
  const next = reduceWorkbenchLayout(layout, { kind: 'select_node', tabId: tab.tabId, selection });
  storeLayout(scope, next);
  const body = document.getElementById('region-tab-body');
  const selectedId = selection.nodeId;
  const display = next.tabs.find(candidate => candidate.tabId === tab.tabId);
  const pinned = new Set(display !== undefined && (display.kind === 'task_graph' || display.kind === 'architecture_graph') ? display.display?.pinned ?? [] : []);
  for (const node of body?.querySelectorAll<HTMLElement>('.graph-node, .q-graphnode') ?? []) {
    const selected = node.dataset.node === selectedId;
    node.classList.toggle('selected', selected);
    node.setAttribute('aria-pressed', String(selected || pinned.has(node.dataset.node ?? '')));
  }
  const detail = document.getElementById('region-detail');
  if (detail !== null) { detail.innerHTML = renderDetail(); detail.hidden = false; }
}

function selectionFromNodeElement(scope: ScopeState, element: HTMLElement): WorkbenchNodeSelection | null {
  const nodeId = element.dataset.node ?? '';
  if (nodeId.length === 0) return null;
  const targetKind = element.dataset.targetKind;
  const projectId = element.dataset.projectId ?? scope.config.scope.projectId;
  if (targetKind === 'task') return { kind: 'task', nodeId, target: { kind: 'task', ref: {
    projectId, goalId: element.dataset.goalId ?? '', taskId: element.dataset.taskId ?? '' } } };
  if (targetKind === 'module') return { kind: 'module', nodeId, target: { kind: 'module', ref: {
    projectId, moduleId: element.dataset.moduleId ?? '' } } };
  if (targetKind === 'observed') return { kind: 'observed', nodeId,
    label: element.dataset.nodeLabel ?? nodeId, detail: element.dataset.nodeDetail ?? '' };
  return null;
}
