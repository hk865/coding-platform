/// <reference lib="dom" />
/** Graph actions: edge and display modes, the node context menu, containment branches, Task/Module/architecture/Task-graph pages, selection and pins. */

import type { ArchitectureReadBody, TaskGraph } from '../../../app/core-http-types.js';
import { submit } from '../../api/submit.js';
import { saveScopeDisplay } from '../../state/display-preference.js';
import { reduceWorkbenchLayout } from '../../state/layout.js';
import { renderScopeIfSelected, reviewGoals, view } from '../../state/workbench.js';
import { selectGraphNode, toggleContainment } from './interaction.js';
import type { ActionTable } from '../shell/actions.js';
import { architectureSelectionKey, openTab, storeLayout, syncActiveLayout } from '../tabs/aux-layout.js';

export const graphActions = {
  'set-graph-edges': (scope, element) => {
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
    if (tab !== undefined) view.graphEdges.set(`${scope.key}|${tab.tabId}`, element.dataset.edges === 'dependency' ? 'dependency' : 'hierarchy');
    renderScopeIfSelected(scope);
    return;
  },
  'set-graph-mode': (scope, element) => {
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
    if (tab !== undefined) view.graphModes.set(`${scope.key}|${tab.tabId}`, element.dataset.mode ?? '');
    view.contextNode = null;
    renderScopeIfSelected(scope);
    return;
  },
  'context-pin': async (scope, element) => { view.contextNode = null; await graphActions['toggle-pin'](scope, element); return; },
  'context-detail': (scope, element) => {
    const nodeId = element.dataset.node ?? '';
    view.contextNode = null;
    const node = [...document.querySelectorAll<HTMLElement>('.q-graphnode')].find(candidate => candidate.dataset.node === nodeId) ?? null;
    if (node === null) { renderScopeIfSelected(scope); return; }
    selectGraphNode(scope, node);
    return;
  },
  'close-context': scope => { view.contextNode = null; renderScopeIfSelected(scope); return; },
  'toggle-branch': (scope, element) => { toggleContainment(scope, element.dataset.moduleId ?? ''); return; },
  'expand-active-paths': scope => {
    scope.containment.expanded = [...new Set([...scope.containment.expanded, ...scope.containment.activeModuleIds])];
    renderScopeIfSelected(scope);
    return;
  },
  'collapse-branches': scope => { scope.containment.expanded = []; renderScopeIfSelected(scope); return; },
  'open-task-detail': (scope, element) => {
    const projectId = element.dataset.projectId ?? scope.config.scope.projectId;
    const goalId = element.dataset.goalId ?? '';
    const taskId = element.dataset.taskId ?? '';
    openTab(scope, { tabId: `task:${projectId}:${goalId}:${taskId}`, kind: 'task_detail', title: `任务 ${taskId}`,
      target: { kind: 'task', ref: { projectId, goalId, taskId } } });
    renderScopeIfSelected(scope);
    return;
  },
  'open-module-detail': (scope, element) => {
    const projectId = element.dataset.projectId ?? scope.config.scope.projectId;
    const moduleId = element.dataset.moduleId ?? '';
    openTab(scope, { tabId: `module:${projectId}:${moduleId}`, kind: 'module_detail', title: `模块 ${moduleId}`,
      target: { kind: 'module', ref: { projectId, moduleId } } });
    renderScopeIfSelected(scope);
    return;
  },
  'open-architecture-graph': scope => {
    const selection: ArchitectureReadBody['input']['selection'] = scope.forms.archSelection === 'revision'
      ? { kind: 'revision', ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: scope.config.scope.projectId,
          baselineId: scope.forms.baselineId.trim(), revision: Number.parseInt(scope.forms.baselineRevision, 10) } }
      : { kind: 'current' };
    if (selection.kind === 'revision'
      && (selection.ref.baselineId.length === 0 || !Number.isSafeInteger(selection.ref.revision) || selection.ref.revision < 1)) {
      scope.error = '请填写有效的架构 ID 与版本。'; renderScopeIfSelected(scope); return;
    }
    const key = architectureSelectionKey(selection);
    openTab(scope, { tabId: `architecture:${key}`, kind: 'architecture_graph',
      title: selection.kind === 'current' ? '架构图（当前）' : `架构图 ${key}`, selection });
    renderScopeIfSelected(scope);
    return;
  },
  'read-architecture-tab': async scope => {
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
    if (tab === undefined || tab.kind !== 'architecture_graph') { scope.error = '请先打开架构图辅助页。'; renderScopeIfSelected(scope); return; }
    await submit(scope, 'architecture/read', { scope: scope.config.scope, input: { selection: tab.selection } });
    return;
  },
  'open-task-graph': scope => {
    const goalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || reviewGoals()[0]?.goalId || '';
    if (goalId.length === 0) { scope.error = '请先填写或创建目标。'; renderScopeIfSelected(scope); return; }
    const goal: TaskGraph['plan']['goalRef'] = { aggregateType: 'Goal', projectId: scope.config.scope.projectId, goalId };
    scope.forms.goalId = goalId;
    openTab(scope, { tabId: `tasks:${goalId}`, kind: 'task_graph', title: '任务图', goal });
    saveScopeDisplay(scope);
    renderScopeIfSelected(scope);
    return;
  },
  'query-task-tab': async scope => {
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
    if (tab === undefined || tab.kind !== 'task_graph') { scope.error = '请先打开任务辅助页。'; renderScopeIfSelected(scope); return; }
    await submit(scope, 'tasks/query', { scope: scope.config.scope, input: { goalRef: tab.goal } });
    return;
  },
  'select-node': (scope, element) => {
    // In-place selection in the scope/tab captured now; the rendered SVG node
    // element survives so a native double click / context menu can still pin.
    selectGraphNode(scope, element);
    return;
  },
  'toggle-pin': (scope, element) => {
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
    if (tab === undefined || (tab.kind !== 'task_graph' && tab.kind !== 'architecture_graph')) return;
    const nodeId = element.dataset.node ?? '';
    if (nodeId.length === 0) return;
    storeLayout(scope, reduceWorkbenchLayout(layout, { kind: 'toggle_pin', tabId: tab.tabId, nodeId }));
    renderScopeIfSelected(scope);
    return;
  },
  'toggle-pin-selected': scope => {
    const layout = syncActiveLayout(scope);
    const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
    if (tab === undefined || (tab.kind !== 'task_graph' && tab.kind !== 'architecture_graph')) return;
    const selected = tab.display?.selected ?? null;
    if (selected === null) return;
    storeLayout(scope, reduceWorkbenchLayout(layout, { kind: 'toggle_pin', tabId: tab.tabId, nodeId: selected.nodeId }));
    renderScopeIfSelected(scope);
    return;
  },
} satisfies ActionTable;
