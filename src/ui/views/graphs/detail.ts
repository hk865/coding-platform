/** Graph node detail: the lower selection pane, the Task/Module detail pages and their relation groups. */

import type { TaskRow } from '../../../app/core-http-types.js';
import { actionButton, detailsBlock, escapeHtml, list, renderGap } from '../../components/html.js';
import type { WorkLinkTarget, WorkbenchGraphDisplay, WorkbenchTab } from '../../state/layout.js';
import { record } from '../../state/values.js';
import { state, view } from '../../state/workbench.js';
import { renderTaskExecutionEntry } from './node-link.js';
import { renderWorkLinkTarget } from './task-structure.js';
import { renderSessionSummary } from '../sessions/render.js';
import { moduleDefinition, readyTaskGraphValue, sameWorkLinkTarget, syncActiveLayout } from '../tabs/aux-layout.js';

export function renderDetail(): string {
  const current = state();
  const layout = syncActiveLayout(current);
  const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
  if (tab === undefined) return '';
  if (tab.kind !== 'task_graph' && tab.kind !== 'architecture_graph') return '';
  if (tab.display?.selected === undefined || tab.display.selected === null) return '';
  const open = view.detailOpen.get(`${current.key}|${tab.tabId}`) !== false;
  if (!open) return '';
  return `<div data-view="graph-detail">${renderGraphSelectionPanel(tab.display)}</div>`;
}

function renderRelatedSessionsBlock(target: WorkLinkTarget): string {
  const current = state();
  const related = current.relatedSessions;
  if (related === null || !sameWorkLinkTarget(related.target, target)
    || related.includeArchived !== current.sessionIncludeArchived) {
    return '<p class="muted">点击“查看关联会话”沿当前真实目标查询（是否含归档由左侧“包含归档会话”决定）；目标或筛选已变时不显示上一对象的关联列表。</p>';
  }
  const canNext = related.result.status === 'ready' && related.result.value.nextCursor !== null;
  return `<section class="panel" data-view="related-sessions"><h4>关联会话</h4>${renderSessionSummary(related.result)}`
    + `<div class="buttons">${actionButton('next-related-sessions', '下一页关联会话', canNext, '没有更多关联会话')}</div></section>`;
}

/** Shared Task facts renderer: used both by the explicit task_detail page and
 * by the in-place graph selection panel, so both show the same real fields. */
function taskFactsHtml(ref: Extract<WorkLinkTarget, { kind: 'task' }>['ref']): string {
  const current = state();
  const graph = readyTaskGraphValue(current);
  const row = graph !== null && current.taskGraphGoalId === ref.goalId
    ? graph.tasks.find(candidate => candidate.ref.taskId === ref.taskId) ?? null
    : null;
  if (row === null) return renderGap('tasks/query', '该任务的任务图事实尚未读取；可先在任务辅助页查询此目标的任务图。');
  return `<section class="panel" data-view="task-facts"><h4>任务事实</h4>`
    + `<p><strong>${escapeHtml(String(record(row.definition).title ?? ref.taskId))}</strong></p>`
    + `<p class="muted">阶段 ${escapeHtml(row.effectivePhase)} · 处置 ${escapeHtml(row.disposition)}`
    + ` · 要求 ${escapeHtml(row.definition.requirementLevel)} · 类型 ${escapeHtml(row.definition.taskKind)}`
    + ` · 执行意图 ${escapeHtml(row.definition.executionIntent ?? '未标注')}</p>`
    + (row.relations.length === 0 ? '<p class="muted">没有协作关系</p>'
      : `<ul>${row.relations.map(relation => `<li>${escapeHtml(relation.kind)}: `
        + `${escapeHtml(relation.fromTaskId)} → ${escapeHtml(relation.toTaskId)} `
        + `<span class="muted">${escapeHtml(relation.note)}</span></li>`).join('')}</ul>`)
    + detailsBlock('查看任务原始字段', `<pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre>`)
    + renderTaskExecutionEntry(row)
    + `</section>`;
}

/** Shared Module facts renderer for the module_detail page and the in-place panel. */
function moduleFactsHtml(ref: Extract<WorkLinkTarget, { kind: 'module' }>['ref']): string {
  const module = moduleDefinition(state(), ref.moduleId);
  if (module === null) return renderGap('architecture/read', '该模块尚未从采用架构读取；可先在架构图辅助页读取当前或精确版本。');
  return `<section class="panel" data-view="module-facts"><h4>模块事实</h4>`
    + `<p><strong>${escapeHtml(String(module.name ?? ref.moduleId))}</strong></p>`
    + `<p class="muted">${escapeHtml(String(module.responsibility ?? ''))}</p>`
    + `<p class="muted">paths: ${list(module.paths).map(String).map(path =>
        `<button class="link" data-action="open-file" data-path="${escapeHtml(path)}">${escapeHtml(path)}</button>`
        + `<button class="link" data-action="compare-path" data-path="${escapeHtml(path)}">比较</button>`).join(' · ')}</p>`
    + detailsBlock('查看模块原始字段', `<pre>${escapeHtml(JSON.stringify(module, null, 2))}</pre>`)
    + `</section>`;
}

export function renderTaskDetailTab(tab: Extract<WorkbenchTab, { kind: 'task_detail' }>): string {
  const ref = tab.target.ref;
  return `<section class="panel" data-view="task-detail" data-goal="${escapeHtml(ref.goalId)}" data-task="${escapeHtml(ref.taskId)}">`
    + `<header><h3>任务 <code>${escapeHtml(ref.taskId)}</code></h3>`
    + `<p class="muted">目标 <code>${escapeHtml(ref.goalId)}</code> · 项目 <code>${escapeHtml(ref.projectId)}</code></p></header>`
    + taskFactsHtml(ref) + renderWorkLinkTarget(tab.target) + renderRelatedSessionsBlock(tab.target) + `</section>`;
}

export function renderModuleDetailTab(tab: Extract<WorkbenchTab, { kind: 'module_detail' }>): string {
  const ref = tab.target.ref;
  return `<section class="panel" data-view="module-detail" data-module="${escapeHtml(ref.moduleId)}">`
    + `<header><h3>模块 <code>${escapeHtml(ref.moduleId)}</code></h3>`
    + `<p class="muted">项目 <code>${escapeHtml(ref.projectId)}</code></p></header>`
    + moduleFactsHtml(ref) + renderWorkLinkTarget(tab.target) + renderRelatedSessionsBlock(tab.target) + `</section>`;
}

/** Compact, default-closed node relations. The related-Session port is called
 * only from the group; archived Sessions follow the current directory filter. */
function targetDataAttrs(target: WorkLinkTarget): string {
  if (target.kind === 'task') return `data-target-kind="task" data-project-id="${escapeHtml(target.ref.projectId)}" data-goal-id="${escapeHtml(target.ref.goalId)}" data-task-id="${escapeHtml(target.ref.taskId)}"`;
  if (target.kind === 'module') return `data-target-kind="module" data-project-id="${escapeHtml(target.ref.projectId)}" data-module-id="${escapeHtml(target.ref.moduleId)}"`;
  return `data-target-kind="work" data-project-id="${escapeHtml(target.ref.projectId)}" data-workspace-id="${escapeHtml(target.ref.workspaceId)}" data-work-id="${escapeHtml(target.ref.workId)}"`;
}
function nodeRelationsGroup(target: WorkLinkTarget): string {
  const current = state();
  const related = current.relatedSessions;
  const matches = related !== null && sameWorkLinkTarget(related.target, target);
  const canNext = matches && related.result.status === 'ready' && related.result.value.nextCursor !== null;
  return `<details class="q-rel" data-view="node-relations"><summary>关联 Agent（当前 / 历史，含归档）</summary>`
    + `<button class="q-link" data-action="find-sessions" ${targetDataAttrs(target)}>查询关联会话</button>`
    + (matches ? renderSessionSummary(related.result) : '<p class="muted">按需查询；是否含归档由左栏过滤决定。</p>')
    + (canNext ? `<button class="q-link" data-action="next-related-sessions">下一页</button>` : '')
    + `</details>`;
}
function nodeFilesGroup(paths: string[]): string {
  if (paths.length === 0) return '';
  return `<details class="q-rel" data-view="node-files"><summary>文件（${paths.length}）</summary>`
    + paths.map(path => `<button class="q-link" data-action="open-file" data-path="${escapeHtml(path)}">${escapeHtml(path)}</button>`).join('')
    + `</details>`;
}
function nodeDiffGroup(prefix: string | null): string {
  return `<details class="q-rel" data-view="node-diff"><summary>Diff 索引</summary>`
    + `<p class="muted">没有完整版本对时不发请求；在此选择真实前后版本。</p>`
    + `<button class="q-link" data-action="compare-path" data-path="${escapeHtml(prefix ?? '')}">在 Diff 页选择版本</button></details>`;
}
function taskRowFor(ref: Extract<WorkLinkTarget, { kind: 'task' }>['ref']): TaskRow | null {
  const current = state();
  const graph = readyTaskGraphValue(current);
  return graph !== null && current.taskGraphGoalId === ref.goalId
    ? graph.tasks.find(candidate => candidate.ref.taskId === ref.taskId) ?? null
    : null;
}

/** In-place graph node detail. Default is only the readable name + one-line
 * role/responsibility + open-in-new-page; agent/file/diff relations are folded
 * and queried on demand; the complete original fields stay behind one more fold. */
function renderGraphSelectionPanel(display: WorkbenchGraphDisplay | undefined): string {
  const selected = display?.selected ?? null;
  if (selected === null) return '';
  const isPinned = (display?.pinned ?? []).includes(selected.nodeId);
  const pinButton = `<button data-action="toggle-pin-selected">${isPinned ? '取消固定显示' : '固定完整显示'}</button>`;
  if (selected.kind === 'observed') {
    return `<div class="q-detail-head"><strong>${escapeHtml(selected.label)}</strong><span class="q-fill"></span>${pinButton}</div>`
      + `<p class="muted">${escapeHtml(selected.detail)}</p>`
      + `<p class="muted">观察节点没有正式 Task/Module 引用。</p>`;
  }
  if (selected.kind === 'task') {
    const ref = selected.target.ref;
    const row = taskRowFor(ref);
    const name = row === null ? ref.taskId : String(record(row.definition).title ?? ref.taskId);
    const detail = row === null ? '任务图事实尚未读取。'
      : `阶段 ${row.effectivePhase} · 处置 ${row.disposition} · 意图 ${row.definition.executionIntent ?? '未标注'}`;
    const raw = row === null ? '' : `<details class="q-rel"><summary>原始字段</summary><pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre></details>`;
    return `<div class="q-detail-head"><strong>${escapeHtml(name)}</strong><span class="q-fill"></span>${pinButton}</div>`
      + `<p class="muted">${escapeHtml(detail)}</p>`
      + `<div class="buttons"><button data-action="open-task-detail" data-project-id="${escapeHtml(ref.projectId)}"`
      + ` data-goal-id="${escapeHtml(ref.goalId)}" data-task-id="${escapeHtml(ref.taskId)}">在新页打开</button></div>`
      + (row === null ? '' : `<details class="q-rel"><summary>执行与原历史</summary>${renderTaskExecutionEntry(row)}</details>`)
      + nodeRelationsGroup(selected.target) + nodeDiffGroup(null) + raw;
  }
  const ref = selected.target.ref;
  const module = moduleDefinition(state(), ref.moduleId);
  const name = module === null ? ref.moduleId : String(module.name ?? ref.moduleId);
  const responsibility = module === null ? '模块事实尚未读取。' : String(module.responsibility ?? '');
  const paths = module === null ? [] : list(module.paths).map(String);
  const raw = module === null ? '' : `<details class="q-rel"><summary>原始字段</summary><pre>${escapeHtml(JSON.stringify(module, null, 2))}</pre></details>`;
  return `<div class="q-detail-head"><strong>${escapeHtml(name)}</strong><span class="q-fill"></span>${pinButton}</div>`
    + `<p class="muted">${escapeHtml(responsibility)}</p>`
    + `<div class="buttons"><button data-action="open-module-detail" data-project-id="${escapeHtml(ref.projectId)}"`
    + ` data-module-id="${escapeHtml(ref.moduleId)}">在新页打开</button></div>`
    + nodeRelationsGroup(selected.target) + nodeFilesGroup(paths) + nodeDiffGroup(paths[0] ?? null) + raw;
}
