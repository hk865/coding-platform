/** Graph tabs: the Task and architecture graph pages and the node context menu. */

import type { TaskExecutionRecord } from '../../../app/core-http-types.js';
import { actionButton, detailsBlock, escapeHtml, renderGap } from '../../components/html.js';
import type { WorkbenchTab } from '../../state/layout.js';
import { state, view } from '../../state/workbench.js';
import { renderArchitectureContainment, renderArchitectureDependencies } from './architecture.js';
import { computeActiveModuleIds } from './interaction.js';
import { renderObservedGraph } from './node-link.js';
import { renderTaskStructure } from './task-structure.js';
import { renderTaskExecutionFold, renderTaskExecutionTimeline } from '../observe/render.js';
import { architectureSelectionKey, readyTaskGraphValue } from '../tabs/aux-layout.js';

/** The right-click menu for a graph node. Pinning/new-page are explicit menu
 * choices (a right click never silently pins); Esc or 关闭菜单 dismisses it. */
export function renderGraphContext(tab: Extract<WorkbenchTab, { kind: 'task_graph' | 'architecture_graph' }>): string {
  const nodeId = view.contextNode;
  if (nodeId === null) return '';
  const pinned = (tab.display?.pinned ?? []).includes(nodeId);
  const selected = tab.display?.selected ?? null;
  let openNew = '';
  if (selected !== null && selected.nodeId === nodeId) {
    if (selected.kind === 'task') {
      const ref = selected.target.ref;
      openNew = `<button data-action="open-task-detail" data-project-id="${escapeHtml(ref.projectId)}" data-goal-id="${escapeHtml(ref.goalId)}" data-task-id="${escapeHtml(ref.taskId)}">在新页打开</button>`;
    } else if (selected.kind === 'module') {
      const ref = selected.target.ref;
      openNew = `<button data-action="open-module-detail" data-project-id="${escapeHtml(ref.projectId)}" data-module-id="${escapeHtml(ref.moduleId)}">在新页打开</button>`;
    }
  }
  return `<div class="q-context" data-view="graph-context">`
    + `<button data-action="context-detail" data-node="${escapeHtml(nodeId)}">查看详情</button>`
    + `<button data-action="context-pin" data-node="${escapeHtml(nodeId)}">${pinned ? '取消固定显示' : '固定完整显示'}</button>`
    + openNew + `<button data-action="close-context">关闭菜单</button></div>`;
}

export function renderTaskTab(tab: Extract<WorkbenchTab, { kind: 'task_graph' }>): string {
  const current = state();
  const matches = current.taskGraphGoalId === tab.goal.goalId && current.taskGraph !== null;
  const mode = view.graphModes.get(`${current.key}|${tab.tabId}`) ?? 'structure';
  const edgeMode = view.graphEdges.get(`${current.key}|${tab.tabId}`) === 'dependency' ? 'dependency' : 'hierarchy';
  const list = current.executionList?.goalRef.projectId === tab.goal.projectId
    && current.executionList.goalRef.goalId === tab.goal.goalId ? current.executionList : null;
  const page: { items: TaskExecutionRecord[]; nextCursor: string | null; readThrough?: unknown } =
    list === null ? { items: [], nextCursor: null } : { items: list.items, nextCursor: list.nextCursor, readThrough: list.readThrough };
  const body = !matches
    ? renderGap('tasks/query', '该目标的任务图尚未读取。')
    : mode === 'timeline'
      ? renderTaskExecutionTimeline(page, current.timeline, readyTaskGraphValue(current)?.tasks)
        + (list === null ? '' : renderTaskExecutionFold(page))
      : renderTaskStructure(current.taskGraph as never, page, current.timeline, tab.display, edgeMode);
  const hasNext = list !== null && list.nextCursor !== null;
  return `<section class="panel" data-view="task-graph" data-goal="${escapeHtml(tab.goal.goalId)}">`
    + `<div class="q-graphbar" data-view="graph-mode">`
    + `<button data-action="set-graph-mode" data-mode="structure" aria-pressed="${String(mode === 'structure')}">结构</button>`
    + `<button data-action="set-graph-mode" data-mode="timeline" aria-pressed="${String(mode === 'timeline')}">轨迹</button>`
    + `<span class="q-fill"></span><button data-action="load-executions" title="刷新执行记录">↻</button>`
    + (hasNext ? '<button data-action="load-next-executions">更多执行</button>' : '') + `</div>`
    + (list === null ? '<p class="muted">尚未读取执行记录；点击“读取执行”。</p>' : '')
    + body + `</section>`;
}
export function renderArchitectureTab(tab: Extract<WorkbenchTab, { kind: 'architecture_graph' }>): string {
  const current = state();
  const key = architectureSelectionKey(tab.selection);
  const mode = view.graphModes.get(`${current.key}|${tab.tabId}`) ?? 'containment';
  let adopted: unknown = null;
  if (current.architectureReadSelection === key && current.architectureRead !== null) adopted = current.architectureRead;
  else if (tab.selection.kind === 'current' && current.adopted !== null) adopted = { status: 'ready', value: current.adopted };
  current.containment.activeModuleIds = computeActiveModuleIds(current);
  current.containment.pinned = tab.display?.pinned ?? [];
  current.containment.selected = tab.display?.selected?.kind === 'module'
    ? tab.display.selected.target.ref.moduleId : null;
  return `<section class="panel" data-view="architecture-graph" data-selection="${escapeHtml(key)}">`
    + `<div class="q-graphbar" data-view="graph-mode">`
    + `<button data-action="set-graph-mode" data-mode="containment" aria-pressed="${String(mode === 'containment')}">包含</button>`
    + `<button data-action="set-graph-mode" data-mode="dependency" aria-pressed="${String(mode === 'dependency')}">依赖</button>`
    + `<span class="q-fill"></span>`
    + `<button data-action="read-architecture-tab" title="刷新架构">↻</button></div>`
    + (adopted === null
      ? renderGap('architecture/read', '该选择尚未读取；点击“读取”。')
      : (mode === 'containment'
        ? renderArchitectureContainment(adopted as never, current.containment)
        : renderArchitectureDependencies(adopted as never, tab.display)))
    + detailsBlock('源码观察', actionButton('capture-observed', '捕获观察', current.project !== null && current.workspace !== null && current.adopted !== null, '需要先采用初始架构') + actionButton('query-observed', '读取观察', current.observedCapture !== null, '先捕获观察'))
    + (current.observed === null ? '' : detailsBlock('源码观察结构', renderObservedGraph(current.observed as never, tab.display)))
    + `</section>`;
}
