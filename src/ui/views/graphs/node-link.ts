/** Pure node-link graph renderers for the adopted and observed architecture and the Task graph. */

import type {
  ArchitectureRevision,
  ObservedArchitectureNeighborhood,
  ReadResult,
  TaskGraph,
  TaskRow,
} from '../../../app/core-http-types.js';
import { detailsFor, escapeHtml, record, rejectionPanel, renderGap, shown } from '../../components/html.js';
import type { WorkbenchGraphDisplay } from '../../state/layout.js';
import { renderModuleList } from '../setup/render.js';

type GraphNodeSpec = {
  id: string;
  label: string;
  caption?: string;
  /** When set, the node is a real focusable entry point (single click/Enter). */
  action?: string;
  data?: Record<string, string>;
  title: string;
  /** Optional node-adjacent expand/collapse control (architecture containment). */
  branch?: { expanded: boolean };
};
type GraphEdgeSpec = { from: string; to: string; label?: string };

/** Short human labels for real node facts. An unknown value always falls back to
 * the raw field, never to an invented status. */
const OBSERVED_KIND_LABEL: Record<string, string> = {
  module: '模块', interface: '接口', type: '类型', function: '函数', file: '文件',
};
export const TASK_PHASE_LABEL: Record<string, string> = {
  pending: '待执行', ready: '就绪', running: '执行中', verifying: '验证中',
  blocked: '受阻', satisfied: '已满足', failed: '失败',
};

/** Deterministic dot-and-line canvas: real nodes and real connector lines, no
 * layout engine and no fabricated time. Each node is a small focusable dot with
 * its label inline (full when pinned, ellipsised otherwise); an architecture node
 * may carry a node-adjacent expand/collapse control. Pinned/selected are pure
 * display state, never frozen domain data. */
export function renderNodeLinkGraph(
  nodes: GraphNodeSpec[], edges: GraphEdgeSpec[], ariaLabel: string, display?: WorkbenchGraphDisplay,
): string {
  if (nodes.length === 0) return '';
  const nodeWidth = 150;
  const nodeHeight = 54;
  const gapX = 26;
  const gapY = 28;
  const margin = 36;
  const pinned = new Set(display?.pinned ?? []);
  const labels = new Set(display?.labels ?? []);
  const selectedId = display?.selected?.nodeId;
  const known = new Set(nodes.map(node => node.id));
  const validEdges = edges.filter(edge => known.has(edge.from) && known.has(edge.to));
  const incoming = new Map<string, string[]>(nodes.map(node => [node.id, []]));
  for (const edge of validEdges) incoming.get(edge.to)?.push(edge.from);
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let depth = 0;
    for (const parent of incoming.get(id) ?? []) depth = Math.max(depth, depthOf(parent) + 1);
    visiting.delete(id);
    layer.set(id, depth);
    return depth;
  };
  for (const node of nodes) depthOf(node.id);
  const layers = new Map<number, GraphNodeSpec[]>();
  for (const node of nodes) {
    const depth = layer.get(node.id) ?? 0;
    const bucket = layers.get(depth);
    if (bucket === undefined) layers.set(depth, [node]); else bucket.push(node);
  }
  const maxLayer = Math.max(0, ...layers.keys());
  const depths: number[] = [];
  for (let depth = 0; depth <= maxLayer; depth += 1) depths.push(depth);
  const bandWidth = (depth: number): number => {
    const bucket = layers.get(depth) ?? [];
    return bucket.length * nodeWidth + Math.max(0, bucket.length - 1) * gapX;
  };
  const contentWidth = Math.max(nodeWidth, ...depths.map(bandWidth));
  const canvasWidth = margin * 2 + contentWidth;
  const canvasHeight = margin + (maxLayer + 1) * nodeHeight + maxLayer * gapY;
  const position = new Map<string, { x: number; y: number }>();
  for (const depth of depths) {
    const bucket = layers.get(depth) ?? [];
    let x = margin + (contentWidth - bandWidth(depth)) / 2;
    const y = margin + depth * (nodeHeight + gapY);
    for (const node of bucket) {
      position.set(node.id, { x: x + nodeWidth / 2, y: y + 14 });
      x += nodeWidth + gapX;
    }
  }
  const edgeHtml = validEdges.map(edge => {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    if (from === undefined || to === undefined) return '';
    const label = edge.label === undefined || edge.label.length === 0 ? ''
      : `<text class="graph-edge-label" x="${(from.x + to.x) / 2}" y="${(from.y + to.y) / 2 - 4}" text-anchor="middle">${escapeHtml(edge.label)}</text>`;
    return `<path d="M ${from.x} ${from.y + 10} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y - 10}"/>${label}`;
  }).join('');
  const nodeHtml = nodes.map(node => {
    const point = position.get(node.id);
    if (point === undefined) return '';
    const isPinned = pinned.has(node.id);
    const selected = selectedId === node.id;
    const attributes = node.action === undefined ? '' : ` data-action="${escapeHtml(node.action)}" tabindex="0" role="button"`;
    const data = node.data === undefined ? ''
      : Object.entries(node.data).map(([key, value]) => ` data-${key}="${escapeHtml(value)}"`).join('');
    const showLabel = isPinned || selected || labels.has(node.id);
    const label = isPinned || node.label.length <= 16 ? node.label : `${node.label.slice(0, 16)}…`;
    const caption = node.caption === undefined ? '' : `<small>${escapeHtml(node.caption)}</small>`;
    return `<button class="q-graphnode${selected ? ' selected' : ''}${isPinned ? ' q-pinned' : ''}"`
      + ` data-node="${escapeHtml(node.id)}" style="left:${point.x}px;top:${point.y}px"${attributes}${data}`
      + ` aria-pressed="${String(selected || isPinned)}" title="${escapeHtml(node.title)}" aria-label="${escapeHtml(node.title)}">`
      + `<span class="q-orb${selected ? ' active' : ''}"></span>`
      + `<span class="q-nodelabel${showLabel ? '' : ' q-compact-label'}">${escapeHtml(node.label)}${caption}</span></button>`;
  }).join('');
  const branchHtml = nodes.filter(node => node.branch !== undefined).map(node => {
    const point = position.get(node.id);
    if (point === undefined) return '';
    const expanded = node.branch?.expanded === true;
    return `<button class="q-branch-toggle" data-action="toggle-branch" data-module-id="${escapeHtml(node.id)}"`
      + ` style="left:${point.x + 15}px;top:${point.y - 15}px"`
      + ` aria-label="${expanded ? '折叠' : '展开'} ${escapeHtml(node.label)}" aria-expanded="${String(expanded)}"`
      + `>${expanded ? '−' : '+'}</button>`;
  }).join('');
  return `<div class="q-graph" role="group" aria-label="${escapeHtml(ariaLabel)}" style="width:${canvasWidth}px;height:${canvasHeight}px">`
    + `<svg class="q-edges" viewBox="0 0 ${canvasWidth} ${canvasHeight}" preserveAspectRatio="none" aria-hidden="true">${edgeHtml}</svg>`
    + nodeHtml + branchHtml + `</div>`;
}


/** Adopted formal architecture. */
export function renderAdoptedGraph(result: ReadResult<ArchitectureRevision>, display?: WorkbenchGraphDisplay): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('architecture/read', '没有已采用的架构 baseline');
  if (result.status === 'not_ready') return `${renderGap('architecture/read', '投影尚未追上')}<p>required: ${escapeHtml(JSON.stringify(result.required))}</p>`;
  const revision = result.value;
  const header = `<header><h3>采用架构</h3>`
    + detailsFor('查看版本与摘要', `<p>baseline <code>${escapeHtml(revision.baseline.baselineId)}</code> `
      + `revision ${escapeHtml(revision.baseline.revision)} `
      + `digest ${escapeHtml(revision.baseline.contentDigest.slice(0, 12))}</p>`)
    + `</header>`;
  const modules = revision.catalog.catalog.modules;
  const dependencies = revision.catalog.catalog.dependencies;
  const graph = renderNodeLinkGraph(
    modules.map(module => ({
      id: module.ref.moduleId,
      label: module.name,
      caption: '已采用模块',
      action: 'select-node',
      data: { 'target-kind': 'module', 'project-id': module.ref.projectId, 'module-id': module.ref.moduleId },
      title: `${module.name}（${module.ref.moduleId}）\n${module.responsibility}\npaths: ${module.paths.join(', ')}`,
    })),
    dependencies.map(dependency => ({ from: dependency.from.moduleId, to: dependency.to.moduleId, label: dependency.reason })),
    '采用架构模块依赖图',
    display,
  );
  const edges = dependencies.map(dependency =>
    `<li>${escapeHtml(dependency.from.moduleId)} → ${escapeHtml(dependency.to.moduleId)} `
    + `<span class="muted">${escapeHtml(dependency.reason)}</span></li>`).join('');
  return `<section class="panel" data-graph="adopted">${header}${graph}${renderModuleList(modules)}`
    + `<ul class="edges">${edges}</ul></section>`;
}

/** Observed source graph; always a separate panel from the adopted graph. */
export function renderObservedGraph(result: ReadResult<ObservedArchitectureNeighborhood>, display?: WorkbenchGraphDisplay): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('architecture/query', '没有匹配的观察图');
  if (result.status === 'not_ready') return renderGap('architecture/query', '观察图尚未就绪');
  const neighborhood = result.value;
  const nodes = neighborhood.nodes.map(node =>
    `<li data-node="${escapeHtml(node.nodeId)}">${escapeHtml(node.nodeId)}`
    + `<span class="muted"> ${escapeHtml(node.kind)}</span></li>`).join('');
  const edges = neighborhood.edges.map(edge =>
    `<li>${escapeHtml(edge.fromNode)} → ${escapeHtml(edge.toNode)} <span class="muted">${escapeHtml(edge.kind)}</span></li>`).join('');
  const graph = renderNodeLinkGraph(
    neighborhood.nodes.map(node => ({
      id: node.nodeId,
      label: node.name.length > 0 ? node.name : node.nodeId,
      caption: OBSERVED_KIND_LABEL[node.kind] ?? node.kind,
      action: 'select-node',
      data: { 'target-kind': 'observed', 'node-label': node.name.length > 0 ? node.name : node.nodeId,
        'node-detail': `${node.kind}${node.path.length === 0 ? '' : ` · ${node.path}`}` },
      title: `${node.nodeId} · ${node.kind}${node.path.length === 0 ? '' : `\n${node.path}`}`,
    })),
    neighborhood.edges.map(edge => ({ from: edge.fromNode, to: edge.toNode, label: edge.kind })),
    '观察结构节点图',
    display,
  );
  return `<section class="panel" data-graph="observed"><header><h3>观察结构</h3>`
    + `<p>节点 ${neighborhood.nodes.length} · 关系 ${neighborhood.edges.length} · 尚未形成正式判定</p>`
    + detailsFor('查看捕获与来源', `<p>capture <code>${escapeHtml(neighborhood.selection.capture.capture.captureId)}</code> `
      + `· noVerdict</p>`)
    + `</header>${graph}`
    + `<ul class="nodes">${nodes}</ul><ul class="edges">${edges}</ul>`
    + (neighborhood.unresolved.length === 0 ? '' :
      `<p class="muted">未解析 ${neighborhood.unresolved.length}: ${escapeHtml(neighborhood.unresolved.join(', '))}</p>`)
    + `</section>`;
}

export function renderTaskRow(row: TaskRow): string {
  const title = record(row.definition).title;
  return `<li data-task="${escapeHtml(row.ref.taskId)}"><code>${escapeHtml(row.ref.taskId)}</code> `
    + `<strong>${escapeHtml(title ?? '')}</strong> <span class="phase">${escapeHtml(row.effectivePhase)}</span> `
    + `<span class="muted">${escapeHtml(row.disposition)} · ${escapeHtml(JSON.stringify(row.eligibility))}</span>`
    + (row.relations.length === 0 ? '' :
      `<ul class="relations">${row.relations.map(relation =>
        `<li>${escapeHtml(relation.kind)}: ${escapeHtml(relation.fromTaskId)} → ${escapeHtml(relation.toTaskId)} <span class="muted">${escapeHtml(relation.note)}</span></li>`).join('')}</ul>`)
    + (row.planningDiagnostics === undefined || row.planningDiagnostics.length === 0 ? '' :
      `<ul class="diagnostics">${row.planningDiagnostics.map(diagnostic =>
        `<li>${escapeHtml(record(diagnostic).code ?? '')}: ${escapeHtml(record(diagnostic).message ?? '')}</li>`).join('')}</ul>`)
    + `</li>`;
}

export function renderTaskGraph(result: ReadResult<TaskGraph>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('tasks/query', '该 Goal 还没有已采用的 Plan');
  if (result.status === 'not_ready') return renderGap('tasks/query', '任务图尚未就绪');
  const graph = result.value;
  // The advisory planning view is diagnostics only; its `not_evaluated` literal is
  // never a formal completion state.
  const planningHtml = graph.planning === undefined
    ? '<p class="muted">没有 Goal 级规划诊断投影</p>'
    : `<p>规划诊断 · 诊断 ${graph.planning.diagnostics.length} 项</p>`
      + detailsFor('查看规划诊断（不是正式完成状态）',
        `<pre>${escapeHtml(JSON.stringify(graph.planning, null, 2))}</pre>`);
  // The formal Goal completion projection is independent of `planning`: show the
  // real snapshot phase and whether it reduced the current selected Plan.
  const completion = graph.completion;
  let completionHtml: string;
  if (completion === undefined) {
    completionHtml = `<p data-completion="unavailable">正式 Goal 完成投影：本读取未提供（不等于未完成）。</p>`;
  } else if (completion.status === 'not_recorded') {
    completionHtml = `<p data-completion="not_recorded">正式 Goal 完成：尚未记录（未归约）。</p>`;
  } else {
    const snapshot = completion.snapshot;
    completionHtml = `<p data-completion="recorded" data-completion-plan-match="${String(completion.selectedPlanMatches)}">`
      + `正式 Goal 完成：phase ${escapeHtml(snapshot.phase)} · `
      + (completion.selectedPlanMatches
        ? '归约所依据的 Plan 与当前选中 Plan 一致。'
        : '这是其它 Plan 的完成事实，当前选中 Plan 未由此完成。')
      + `</p>`
      + detailsFor('查看正式完成记录', `<pre>${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>`);
  }
  return `<section class="panel" data-graph="tasks"><header><h3>任务图</h3>`
    + `<p>任务 ${graph.tasks.length} · 业务版本 ${shown(graph.plan.planRevision)}</p>`
    + detailsFor('查看计划引用', `<p>plan <code>${escapeHtml(graph.plan.ref.planId)}</code> `
      + `planRevision ${shown(graph.plan.planRevision)}</p>`)
    + `</header>${completionHtml}${planningHtml}`
    + `<ul class="tasks">${graph.tasks.map(renderTaskRow).join('')}</ul></section>`;
}

/** R6 Task-execution consumer: the one narrow entry seam from a real `TaskRow`
 * to its known formal execution. It carries the complete `RunRef`
 * (project/goal/run) plus the Task identity and never invents a Run, Session or
 * time. A row with no `execution` says so instead of fabricating history.
 *
 * The formal entry opens the execution page; the browser then reads
 * `executions/read` first and only uses the original claim Session once that
 * read is ready. The identity stays typed in data attributes. */
export function renderTaskExecutionEntry(row: TaskRow): string {
  if (row.execution === null) {
    return `<section class="task-execution-entry" data-execution-entry="none"`
      + ` data-task-id="${escapeHtml(row.ref.taskId)}">`
      + `<p class="muted">当前图没有可打开的执行引用；未来 Task 不伪造执行历史。</p></section>`;
  }
  const run = row.execution;
  const identity = `data-aggregate-type="${escapeHtml(run.aggregateType)}"`
    + ` data-project-id="${escapeHtml(run.projectId)}" data-goal-id="${escapeHtml(run.goalId)}"`
    + ` data-run-id="${escapeHtml(run.runId)}" data-task-id="${escapeHtml(row.ref.taskId)}"`;
  return `<section class="task-execution-entry" data-execution-entry="open" ${identity}>`
    + `<button class="link" data-action="open-execution-history" ${identity}>查看本次执行 / 原历史</button>`
    + `<p class="muted">打开后先读取该次执行事实；只有正式记录可用时才按原 claim 会话读取本次执行窗与完整原历史。</p></section>`;
}
