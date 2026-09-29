/**
 * R6.1a pure workbench rendering.
 *
 * Every function here turns an already-versioned Host DTO into HTML text. It
 * touches no DOM global, no network and no business state, so the same module
 * is safe to import from the browser bundle and from a Node test. The browser
 * `main.ts` owns the DOM; this file owns the presentation.
 *
 * The adopted architecture and the observed source graph are rendered as two
 * distinct panels with their own refs/versions. A missing or rejected read is
 * shown as a real gap; it is never collapsed into a fake baseline label.
 */
import type {
  ArchitectureReadBody,
  ArchitectureRevision,
  ArtifactRecord,
  BootstrapExecution,
  BootstrapResponse,
  CaptureSummary,
  CoreRejection,
  InitialPlanningGoalInputResult,
  CoreRouteSuffix,
  CoreScope,
  ExecutionHistoryPage,
  MessageBody,
  ModuleDefinition,
  ObservedArchitectureNeighborhood,
  OperationReceipt,
  QueryJobAnswerSnapshot,
  Page,
  ReadResult,
  ReviewSessionRole,
  RunRef,
  RuntimeCapabilities,
  SessionCard,
  SessionHistoryEntry,
  SessionMessage,
  SessionMessageStatus,
  SessionOperationRecord,
  SessionPage,
  SessionRecord,
  SessionRef,
  SourcePage,
  TaskGraph,
  TaskRow,
  TaskExecutionRecord,
  WorkflowAdvanceResult,
  WorkspaceFile,
  WorkspaceComparison,
  WorkspaceResult,
  WorkspaceVersion,
  WorkbenchCommandSnapshot,
  WorkbenchCommandState,
  SaveWorkbenchFileResult,
} from '../app/core-http-types.js';
import { renderMarkdown } from './markdown.js';
type WorkLinkTarget = SessionCard['links'][number]['ref']['target'];
/** The exact original TaskTriple, derived from the public DTO so the UI never
 * value-imports a contract module. It is only a return target; no identity is
 * ever parsed back out of a title/tabId. */
type TaskTriple = Extract<WorkLinkTarget, { kind: 'task' }>['ref'];

/** UI-side mirrors of the Host protocol constants. `R6-workbench.test.ts`
 * asserts they equal the Host values, so the browser never value-imports the
 * Host module. */
export const UI_PLATFORM_TOKEN_HEADER = 'x-platform-token';
export const UI_PLATFORM_TOKEN_META_NAME = 'platform-token';
export const UI_CORE_API_PREFIX = '/api/real/core/';
export const UI_BOOTSTRAP_SUFFIX = 'bootstrap';

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** A labeled, collapsed disclosure for the exact technical fact (ref, digest,
 * version, error code, raw request/receipt) behind a plain-language summary. */
const detailsFor = (summary: string, html: string): string =>
  `<details class="details"><summary>${escapeHtml(summary)}</summary>${html}</details>`;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function rejectionPanel(rejection: CoreRejection): string {
  const current = rejection.current === undefined ? '' :
    detailsFor('查看当前版本', `<pre>${escapeHtml(JSON.stringify(rejection.current, null, 2))}</pre>`);
  return `<section class="panel rejected" data-code="${escapeHtml(rejection.code)}">`
    + `<h3>未完成</h3><p>${escapeHtml(rejection.reason)}</p>`
    + detailsFor('查看详情', `<p>错误码：${escapeHtml(rejection.code)}</p>`)
    + current + `</section>`;
}

/** Real absence/gap states, never a fabricated empty success. */
export function renderGap(suffix: CoreRouteSuffix | string, reason: string): string {
  return `<section class="panel gap" data-route="${escapeHtml(suffix)}">`
    + `<h3>暂不可用</h3><p>${escapeHtml(reason)}</p></section>`;
}

export function renderBootstrap(bootstrap: BootstrapResponse): string {
  const rows = bootstrap.workspaces.map(workspace =>
    `<li><strong>${escapeHtml(workspace.name)}</strong> `
    + `<code>${escapeHtml(workspace.scope.projectId)}/${escapeHtml(workspace.scope.workspaceId)}</code> `
    + `<span>workspaceRevision=${escapeHtml(workspace.workspaceRevision)}</span></li>`).join('');
  const review = bootstrap.review;
  const summary = review === null ? '<p class="muted">没有提供初始审阅资料</p>' : [
    review.notes === undefined ? '' : `<p>${escapeHtml(review.notes)}</p>`,
    `<p>政策 ${list(review.policies).length} · 目标 ${list(review.goals).length} · `
    + `初始架构 ${list(review.architectures).length} · Plan 草案 ${list(review.plans).length}</p>`,
  ].join('');
  const execution = bootstrap.execution;
  const executionSummary = `<p class="muted">执行配置 · 只读调查 profile ${execution.queryProfiles.length}`
    + ` · Workflow 范围 ${execution.workflowScopes.length}</p>`;
  return `<section class="panel" data-view="bootstrap"><h2>工作台</h2>`
    + `<ul class="workspaces">${rows}</ul>${summary}${executionSummary}</section>`;
}

export function renderModuleList(modules: ModuleDefinition[]): string {
  if (modules.length === 0) return '<p class="muted">采用图没有任何模块</p>';
  return `<ul class="modules">${modules.map(module =>
    `<li data-module="${escapeHtml(module.ref.moduleId)}"><code>${escapeHtml(module.ref.moduleId)}</code> <strong>${escapeHtml(module.name)}</strong>`
    + `<br><span>${escapeHtml(module.responsibility)}</span>`
    + `<br><span class="muted">paths: ${escapeHtml(module.paths.join(', '))}</span>`
    + `<br><button class="link" data-action="open-module-detail"`
    + ` data-project-id="${escapeHtml(module.ref.projectId)}" data-module-id="${escapeHtml(module.ref.moduleId)}">打开模块详情</button></li>`).join('')}</ul>`;
}

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
const TASK_PHASE_LABEL: Record<string, string> = {
  pending: '待执行', ready: '就绪', running: '执行中', verifying: '验证中',
  blocked: '受阻', satisfied: '已满足', failed: '失败',
};

/** Deterministic dot-and-line canvas: real nodes and real connector lines, no
 * layout engine and no fabricated time. Each node is a small focusable dot with
 * its label inline (full when pinned, ellipsised otherwise); an architecture node
 * may carry a node-adjacent expand/collapse control. Pinned/selected are pure
 * display state, never frozen domain data. */
function renderNodeLinkGraph(
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


/** Adopted formal architecture. `catalog === null` is a real historical gap. */
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
  if (revision.catalog === null) return `<section class="panel" data-graph="adopted">${header}`
    + `<p class="gap">该 baseline 早于 catalog，未记录模块边</p></section>`;
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

/** The two graphs side by side as distinct sections; a single baseline label is
 * explicitly not sufficient. */
export function renderGraphPanels(input: {
  adopted: ReadResult<ArchitectureRevision>;
  observed: ReadResult<ObservedArchitectureNeighborhood>;
  tasks?: ReadResult<TaskGraph>;
}): string {
  return `<div class="graph-panels">`
    + renderAdoptedGraph(input.adopted)
    + renderObservedGraph(input.observed)
    + (input.tasks === undefined ? '' : renderTaskGraph(input.tasks))
    + `</div>`;
}

export function renderFileRead(result: WorkspaceResult<WorkspaceFile>): string {
  if (result.status !== 'ready') return rejectionPanel(result as unknown as CoreRejection);
  const file = result.value;
  return `<section class="panel" data-view="file"><header><h3>${escapeHtml(file.path)}</h3>`
    + `<p class="muted">${file.sizeBytes} 字节</p>`
    + detailsFor('查看版本与摘要', `<p>version ${escapeHtml(JSON.stringify(file.version))} `
      + `· digest ${escapeHtml(file.digest.slice(0, 12))}</p>`)
    + `</header><pre>${escapeHtml(file.content)}</pre></section>`;
}

export function renderSourceCapture(result: WorkspaceResult<CaptureSummary>): string {
  if (result.status !== 'ready') return rejectionPanel(result as unknown as CoreRejection);
  const summary = result.value;
  return `<section class="panel" data-view="capture"><h3>来源已捕获</h3>`
    + `<p>新增 ${summary.changes.added.length} · 修改 ${summary.changes.modified.length} `
    + `· 删除 ${summary.changes.deleted.length}</p>`
    + detailsFor('查看捕获详情', `<p>capture <code>${escapeHtml(summary.ref.captureId ?? '')}</code> `
      + `· provider ${escapeHtml(summary.coverage.provider)} · complete ${String(summary.coverage.complete)}</p>`)
    + `</section>`;
}

export function renderSourcePage(result: WorkspaceResult<SourcePage>): string {
  if (result.status !== 'ready') return rejectionPanel(result as unknown as CoreRejection);
  const page = result.value;
  return `<section class="panel" data-view="source"><h3>来源查询</h3>`
    + `<p>${page.items.length} 项 · nextCursor ${page.nextCursor === null ? 'none' : 'present'}</p>`
    + `<ul>${page.items.map(hit => `<li>${escapeHtml(record(hit).kind ?? '')} `
      + `${escapeHtml(record(record(hit).file).path ?? '')}</li>`).join('')}</ul></section>`;
}

const shown = (value: unknown): string => value === undefined || value === null ? '' : escapeHtml(value);

/** `goals/read` detail: the current Goal plus any pending proposal. */
export function renderGoalDetail(result: unknown): string {
  const envelope = record(result);
  if (envelope.status === 'rejected') return rejectionPanel(envelope as unknown as CoreRejection);
  if (envelope.status === 'not_found') return renderGap('goals/read', '该 Goal 不存在');
  if (envelope.status === 'not_ready') return renderGap('goals/read', 'Goal 投影尚未就绪');
  const detail = record(envelope.value);
  const goal = record(detail.goal);
  const ref = record(goal.ref);
  const pending = detail.pendingPlan === undefined || detail.pendingPlan === null ? null : record(detail.pendingPlan);
  return `<section class="panel" data-view="goal-read"><header><h3>目标</h3>`
    + `<p>版本 ${shown(goal.revision)} · 目标意图 ${shown(goal.desiredState)}</p></header>`
    + `<p>${shown(goal.objective)}</p>`
    + detailsFor('查看引用', `<p>目标 ID <code>${shown(ref.goalId)}</code></p>`
      + `<p>activePlan ${goal.activePlanRevision === null || goal.activePlanRevision === undefined ? 'none' : shown(JSON.stringify(goal.activePlanRevision))}</p>`)
    + (pending === null ? '<p class="muted">没有待采用的计划草案</p>'
      : `<p>有待采用的计划草案（版本 ${shown(pending.revision)}，校验问题 ${list(pending.issues).length}）</p>`)
    + `</section>`;
}

/** `plans/proposal` read: proposal identity, status and validation issues. */
export function renderPlanProposal(result: unknown): string {
  const envelope = record(result);
  if (envelope.status === 'rejected') return rejectionPanel(envelope as unknown as CoreRejection);
  if (envelope.status === 'not_found') return renderGap('plans/proposal', '该 Plan 草案不存在');
  if (envelope.status === 'not_ready') return renderGap('plans/proposal', 'Plan 投影尚未就绪');
  const proposal = record(envelope.value);
  const ref = record(proposal.ref);
  const goalRef = record(proposal.goalRef);
  const draft = record(proposal.draft);
  const issues = list(proposal.issues);
  return `<section class="panel" data-view="proposal"><header><h3>计划草案</h3>`
    + `<p>版本 ${shown(proposal.revision)} · 状态 ${shown(proposal.status)} · 任务 ${list(draft.tasks).length}</p></header>`
    + detailsFor('查看引用', `<p>草案 ID <code>${shown(ref.proposalId)}</code> · ${shown(proposal.kind)}</p>`
      + `<p>目标 ${shown(goalRef.goalId)} · basedOn ${proposal.basedOn === null || proposal.basedOn === undefined ? 'none' : 'yes'}</p>`)
    + (issues.length === 0 ? '<p class="muted">校验问题：0</p>'
      : `<ul class="diagnostics">${issues.map(issue => `<li>${shown(record(issue).message)}（${shown(record(issue).code)}）</li>`).join('')}</ul>`)
    + `</section>`;
}

/** Renders any route response by shape, preserving committed/cursor/rejection. */
export function renderRouteResponse(suffix: CoreRouteSuffix | string, payload: unknown): string {
  const value = record(payload);
  if (value.status === 'rejected') return rejectionPanel(value as unknown as CoreRejection);
  if (value.status === 'not_found') return renderGap(suffix, 'not found');
  if (value.status === 'not_ready') return renderGap(suffix, 'not ready');
  if (value.status === 'committed') {
    return `<section class="panel committed" data-route="${escapeHtml(suffix)}"><h3>已提交</h3>`
      + `<p>replayed=${String(value.replayed)} cursor=${escapeHtml(record(value.cursor).sequence ?? value.cursor ?? '')}</p>`
      + `<pre>${escapeHtml(JSON.stringify(value.value))}</pre></section>`;
  }
  if (value.status === 'accepted' || value.status === 'completed') {
    return `<section class="panel" data-route="${escapeHtml(suffix)}"><h3>操作回执</h3>`
      + `<pre>${escapeHtml(JSON.stringify(payload))}</pre></section>`;
  }
  return `<section class="panel" data-route="${escapeHtml(suffix)}"><pre>${escapeHtml(JSON.stringify(payload))}</pre></section>`;
}

// ---------------------------------------------------------------------------
// R6.1b-1 Session / inbox / original-history presentation.
//
// Every function is a pure text builder over the exact public HTTP DTOs: no DOM,
// no network and no domain service. Absent, pending and unsupported states stay
// distinct, so a busy Session is never shown as idle, a pending message never
// becomes read/responded, and an accepted creation is never shown as created.
// ---------------------------------------------------------------------------

const AVAILABILITY_TEXT: Record<SessionCard['availability'], string> = {
  idle: '可用', busy: '忙碌中', recoverable: '可恢复', unavailable: '不可用',
};

const MESSAGE_STATUS_TEXT: Record<SessionMessageStatus, string> = {
  pending: '待处理', read: '已读（尚未回复）', responded: '已回复',
};

const HISTORY_KIND_TEXT: Record<SessionHistoryEntry['kind'], string> = {
  session_created: '会话创建', turn_started: '轮次开始', agent_event: 'Agent 事件',
};

const OPERATION_PHASE_TEXT: Record<SessionOperationRecord['phase'], string> = {
  accepted: '创建处理中', running: '创建进行中', completed: '创建完成', failed: '创建失败', unknown: '结果未知',
};

function roleSummary(role: SessionRecord['role']): string {
  return role.kind === 'role_spec'
    ? `${role.pin.ref.roleId}@${String(role.pin.ref.revision)}`
    : `模板 ${role.templateId}`;
}

/** Trusted startup role choices for one scope. An absent list is a real gap and
 * never a fabricated default Role; existing Sessions stay readable without it. */
export function renderSessionRoleOptions(roles: ReviewSessionRole[], scope: CoreScope, selected = 0): string {
  const available = roles.filter(entry =>
    entry.scope.projectId === scope.projectId && entry.scope.workspaceId === scope.workspaceId);
  if (available.length === 0) {
    return '<p class="muted">本机没有为当前工作区提供可信角色引用，无法创建会话；已有会话、消息与历史仍可查看。</p>';
  }
  return available.map((entry, index) =>
    `<option value="${index}"${index === selected ? ' selected' : ''}>${escapeHtml(entry.label)}`
    + ` · ${escapeHtml(roleSummary(entry.role))}</option>`).join('');
}

/** Real Session directory page. Identity, lifecycle, availability, role and the
 * original `nextCursor` are all preserved. */
export function renderSessionSummary(result: ReadResult<SessionPage<SessionCard>>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('sessions/find', '没有匹配的会话');
  if (result.status === 'not_ready') return renderGap('sessions/find', '会话目录尚未就绪');
  const page = result.value;
  if (page.items.length === 0) {
    return '<section class="panel" data-view="sessions"><h3>会话</h3><p class="muted">当前筛选没有会话</p></section>';
  }
  const rows = page.items.map(card => {
    const record = card.record;
    return `<li data-session="${escapeHtml(record.ref.sessionId)}">`
      + `<strong>${escapeHtml(record.ref.sessionId)}</strong> `
      + `<span class="phase" data-availability="${escapeHtml(card.availability)}">${escapeHtml(AVAILABILITY_TEXT[card.availability])}</span> `
      + `<span class="muted">${escapeHtml(record.lifecycle)} · 业务版本 ${escapeHtml(record.revision)} · 角色 ${escapeHtml(roleSummary(record.role))}</span>`
      + detailsFor('查看身份与关联', `<p>Session <code>${escapeHtml(JSON.stringify(record.ref))}</code></p>`
        + `<p>kernel ${escapeHtml(record.kernel.adapterId)} · ${escapeHtml(record.kernel.kernelSessionId)}</p>`
        + `<p>关联工作 ${card.links.length} 条</p>`)
      + `<button class="link" data-action="read-session" data-session="${escapeHtml(record.ref.sessionId)}">查看详情</button>`
      + `<button class="link" data-action="select-session" data-session="${escapeHtml(record.ref.sessionId)}">打开完整会话历史</button>`
      + `</li>`;
  }).join('');
  return `<section class="panel" data-view="sessions"><header><h3>会话</h3>`
    + `<p>共 ${page.items.length} 条 · ${page.nextCursor === null ? '没有更多' : '还有更多'}</p>`
    + detailsFor('查看目录游标', `<p>nextCursor ${escapeHtml(page.nextCursor ?? 'none')}</p>`)
    + `</header><ul class="sessions">${rows}</ul></section>`;
}

/** One Session's real detail, including the persisted work links. */
export function renderSessionDetail(result: ReadResult<SessionCard>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('sessions/read', '该会话不存在');
  if (result.status === 'not_ready') return renderGap('sessions/read', '会话详情尚未就绪');
  const { record, availability, links } = result.value;
  return `<section class="panel" data-view="session-detail"><header><h3>${escapeHtml(record.ref.sessionId)}</h3>`
    + `<p>${escapeHtml(AVAILABILITY_TEXT[availability])} · ${escapeHtml(record.lifecycle)} · 健康 ${escapeHtml(record.health)}</p>`
    + detailsFor('查看身份与版本', `<p>Session <code>${escapeHtml(JSON.stringify(record.ref))}</code></p>`
      + `<p>workspaceId ${escapeHtml(record.workspaceId)} · revision ${escapeHtml(record.revision)}</p>`
      + `<p>角色 ${escapeHtml(roleSummary(record.role))}</p>`
      + `<p>占用 ${record.occupancy === null ? '无' : escapeHtml(JSON.stringify(record.occupancy))}</p>`)
    + (links.length === 0 ? '<p class="muted">没有关联工作</p>'
      : `<ul class="links">${links.map(link =>
        `<li>${escapeHtml(link.ref.relation)} · ${escapeHtml(JSON.stringify(link.ref.target))}</li>`).join('')}</ul>`)
    + `</section>`;
}

/** `sessions/create` receipt. `accepted` is ONLY "创建处理中": the session does
 * not exist until the same operation reports `completed`. */
export function renderSessionOperation(result: OperationReceipt<SessionRecord>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  const operationRef = `<p>操作 <code>${escapeHtml(result.operationRef.operationId)}</code> · replayed=${String(result.replayed)}</p>`;
  if (result.status === 'accepted') {
    return `<section class="panel" data-view="session-operation"><h3>创建处理中</h3>`
      + `<p>请求已受理，请显式刷新状态；受理不代表会话已经创建。</p>${operationRef}`
      + `<div class="buttons"><button data-action="read-session-operation">刷新状态</button></div></section>`;
  }
  const record = result.value;
  return `<section class="panel" data-view="session-operation"><h3>会话已创建</h3>`
    + `<p>会话 <code>${escapeHtml(record.ref.sessionId)}</code> · 业务版本 ${escapeHtml(record.revision)}</p>`
    + operationRef + `</section>`;
}

/** `sessions/operation` read: the durable create operation's real phase. An
 * accepted/running operation is NOT a created Session and is never shown as
 * one; the planned ref is only a projection until the phase is completed. */
export function renderSessionOperationRead(result: ReadResult<SessionOperationRecord>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('sessions/operation', '该创建操作不存在');
  if (result.status === 'not_ready') return renderGap('sessions/operation', '创建操作尚未就绪');
  const operation = result.value;
  const planned = operation.action.plannedSessionRef;
  return `<section class="panel" data-view="session-operation-read"><h3>创建操作状态</h3>`
    + `<p data-phase="${escapeHtml(operation.phase)}">${escapeHtml(OPERATION_PHASE_TEXT[operation.phase])}</p>`
    + `<p>操作 <code>${escapeHtml(operation.ref.operationId)}</code> · 计划会话 <code>${escapeHtml(planned.sessionId)}</code></p>`
    + detailsFor('查看操作详情', `<pre>${escapeHtml(JSON.stringify({
      ref: operation.ref, phase: operation.phase, observation: operation.observation, failure: operation.failure,
    }, null, 2))}</pre>`)
    + `</section>`;
}

/** Inbox list. Reading never acks, so a pending message stays pending. */
export function renderInbox(
  result: ReadResult<{ items: SessionMessage[]; nextCursor: string | null; sourceCursor: unknown }>,
): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('messages/inbox', '没有收件箱记录');
  if (result.status === 'not_ready') return renderGap('messages/inbox', '收件箱尚未就绪');
  const value = result.value;
  if (value.items.length === 0) {
    return '<section class="panel" data-view="inbox"><h3>收件箱</h3><p class="muted">收件箱为空</p></section>';
  }
  const rows = value.items.map(message =>
    `<li data-message="${escapeHtml(message.ref.messageId)}">`
    + `<code>${escapeHtml(message.ref.messageId)}</code> `
    + `<span data-status="${escapeHtml(message.status)}">${escapeHtml(MESSAGE_STATUS_TEXT[message.status])}</span> `
    + `<span class="muted">${escapeHtml(message.createdAt)} · 发送者 ${escapeHtml(message.sender.kind)}</span>`
    + `<button class="link" data-action="read-message" data-message="${escapeHtml(message.ref.messageId)}">查看消息</button>`
    + `</li>`).join('');
  return `<section class="panel" data-view="inbox"><header><h3>收件箱</h3>`
    + `<p>共 ${value.items.length} 条 · ${value.nextCursor === null ? '没有更多' : '还有更多'}</p>`
    + detailsFor('查看游标', `<p>nextCursor ${escapeHtml(value.nextCursor ?? 'none')}</p>`
      + `<p>sourceCursor ${escapeHtml(JSON.stringify(value.sourceCursor))}</p>`)
    + `</header><ul class="messages">${rows}</ul></section>`;
}

/** One persisted message. A message with no reply shows "尚无回复"; `pending`
 * is never turned into read/responded and no reply is fabricated. */
export function renderMessage(result: ReadResult<SessionMessage>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('messages/read', '该消息不存在');
  if (result.status === 'not_ready') return renderGap('messages/read', '消息尚未就绪');
  const message = result.value;
  const response = message.response === null
    ? '<p class="muted" data-reply="none">尚无回复</p>'
    : `<div data-reply="present"><p>回复者 ${escapeHtml(message.response.sender.sessionRef.sessionId)}`
      + ` · ${escapeHtml(message.response.respondedAt)}</p>`
      + `<button class="link" data-action="read-message-body" data-part="response" data-message="${escapeHtml(message.ref.messageId)}">查看回复正文</button></div>`;
  return `<section class="panel" data-view="message"><header><h3>消息 ${escapeHtml(message.ref.messageId)}</h3>`
    + `<p data-status="${escapeHtml(message.status)}">${escapeHtml(MESSAGE_STATUS_TEXT[message.status])}`
    + ` · 发送者 ${escapeHtml(message.sender.kind)} · ${escapeHtml(message.createdAt)}</p>`
    + detailsFor('查看消息引用', `<p>ref <code>${escapeHtml(JSON.stringify(message.ref))}</code></p>`
      + `<p>bodyRef ${escapeHtml(JSON.stringify(message.bodyRef))}</p>`
      + `<p>sourceRef ${escapeHtml(JSON.stringify(message.sourceRef))}</p>`
      + `<p>revision ${escapeHtml(message.revision)}</p>`)
    + `</header>`
    + `<div class="buttons"><button data-action="read-message-body" data-part="message" data-message="${escapeHtml(message.ref.messageId)}">查看正文</button></div>`
    + response + `</section>`;
}

/** The dedicated bounded message-body read; it is not a general material open. */
export function renderMessageBody(result: ReadResult<MessageBody>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('messages/body', '消息正文不存在');
  if (result.status === 'not_ready') return renderGap('messages/body', '消息正文尚未就绪');
  const body = result.value;
  return `<section class="panel" data-view="message-body"><header><h3>消息正文</h3>`
    + `<p class="muted">${escapeHtml(body.part === 'response' ? '回复' : '来信')} · usage ${escapeHtml(body.usage)}</p>`
    + detailsFor('查看来源', `<p>messageRef <code>${escapeHtml(JSON.stringify(body.messageRef))}</code></p>`
      + `<p>sourceRef ${escapeHtml(JSON.stringify(body.sourceRef))}</p>`)
    + `</header><pre>${escapeHtml(body.text)}</pre></section>`;
}

/** Original Kernel history page. The platform `basis` stays distinct from the
 * directory `sourceCursor`; every entry carries its complete saved record in a
 * default-closed raw disclosure. */
export function renderSessionHistory(result: ReadResult<Page<SessionHistoryEntry>>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('sessions/history', '该会话没有可读的原历史');
  if (result.status === 'not_ready') return renderGap('sessions/history', '原历史尚未就绪');
  const page = result.value;
  const rows = page.items.map(entry =>
    `<li data-history="${escapeHtml(entry.recordId)}" data-history-kind="${entry.kind}">`
    + `<strong>${escapeHtml(HISTORY_KIND_TEXT[entry.kind])}</strong> `
    + `<span class="muted">${escapeHtml(entry.recordedAt)} · position ${escapeHtml(entry.source.position)}</span>`
    + `<div data-history-body="public">${renderParsedHistoryBody(parseHistoryBody(entry))}</div>`
    + renderRawDisclosure(entry)
    + `</li>`).join('');
  return `<section class="panel" data-view="history"><header><h3>原历史</h3>`
    + `<p>共 ${page.items.length} 条 · ${page.nextCursor === null ? '没有更多' : '还有更多'}</p>`
    + detailsFor('查看历史游标', `<p>nextCursor ${escapeHtml(page.nextCursor ?? 'none')}</p>`
      + `<p>basis <code>${escapeHtml(JSON.stringify(page.basis))}</code></p>`)
    + `</header>`
    + (page.items.length === 0 ? '<p class="muted">该页没有记录</p>' : `<ul class="history">${rows}</ul>`)
    + `</section>`;
}

/** Runtime capability read; unimplemented capabilities stay visibly unavailable. */
export function renderRuntimeCapabilities(result: ReadResult<RuntimeCapabilities>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('runtime/capabilities', '没有当前 Runtime');
  if (result.status === 'not_ready') return renderGap('runtime/capabilities', 'Runtime 能力尚未就绪');
  const value = result.value;
  const capabilities: Array<[string, RuntimeCapabilities['createSession']]> = [
    ['创建会话', value.createSession], ['读取历史', value.readHistory],
    ['继续历史', value.continueHistory], ['恢复运行', value.recoverRun],
    ['安全暂停', value.safePointPause], ['取消', value.cancel],
    ['原生压缩', value.nativeCompact], ['范围写入', value.scopedWorkspaceWrites],
  ];
  return `<section class="panel" data-view="capabilities"><header><h3>Runtime 能力</h3>`
    + `<p class="muted">adapter ${escapeHtml(value.adapterId)} · API v${escapeHtml(value.kernelSessionApiVersion)}</p>`
    + `</header><ul class="capabilities">${capabilities.map(([label, capability]) =>
      `<li>${escapeHtml(label)}：${capability.supported ? '可用' : '不可用'}`
      + (capability.supported ? '' : `（${escapeHtml(capability.reason)}）`) + `</li>`).join('')}</ul></section>`;
}

// ---------------------------------------------------------------------------
// R6 UI-layout: pure display/layout state over the exact public HTTP DTOs.
//
// Everything below is PURE display state: no DOM, no network, no second business
// owner and no write back into Task/Session. The `WorkbenchLayout` reducer only
// moves tabs, the per-conversation composer draft and the per-file editor draft;
// it can never send a message, save a file or start a model. Renderers only see
// the exact fields their DTO carries and never parse a title/tabId to guess a
// domain ref.
//
// Render contract (stable hooks the tests assert):
//   - `renderWorkbenchLayout` emits `data-view="workbench-layout"`, each tab as
//     `data-tab="<tabId>"` with its `data-tab-kind`, and `草稿快照` on a draft.
//   - `renderSessionHistoryTimeline` emits, per original entry, `data-history`
//     = recordId and `data-history-kind` in
//     user_input | assistant_text | tool_result | unknown |
//     artifact, always in original order and never re-sorted.
//   - `renderTaskStructure` emits `data-structure="hierarchy"` (`parentOf`) and
//     `data-structure="execution"` (`dependsOn`) as two distinct sections and
//     keeps planning-only/optional/future rows.
//   - `renderWorkLinkTarget` emits `data-work-link="task|module|work"` plus the
//     full real ref and a `data-action="find-sessions"` navigation button.
// ---------------------------------------------------------------------------

/** Auxiliary-workspace page kinds. They are display choices only. */
export type WorkbenchTabKind =
  | 'project_chat' | 'session_chat' | 'file' | 'directory'
  | 'task_detail' | 'module_detail' | 'history' | 'execution_history'
  | 'setup' | 'task_graph' | 'architecture_graph'
  // MVP UI connection auxiliary pages: one real command handle and one real
  // Workspace compare result. Identity is typed; the live snapshot/result lives
  // in the browser state keyed by this tab.
  | 'terminal' | 'diff';

/** A selection keeps its exact text/lines and the file version it was based
 * on. Unsaved editor text is explicitly marked as a draft snapshot. */
export type WorkbenchDraftReference =
  | { kind: 'path'; path: string }
  | { kind: 'selection'; path: string; text: string; startLine: number; endLine: number;
      version: WorkspaceFile['version']; digest: string; source: 'file' | 'draft_snapshot' };

/** Current conversation composer, distinct from each file editor's text. */
export type WorkbenchDraft = {
  state: 'draft_snapshot';
  text: string;
  references: WorkbenchDraftReference[];
};

/** A graph tab's live display selection. It carries the exact real ref for a
 * Task/Module node (never parsed from a title/tabId); an observed node has no
 * formal target and keeps only its public display identity. */
export type WorkbenchNodeSelection =
  | { kind: 'task'; nodeId: string; target: Extract<WorkLinkTarget, { kind: 'task' }> }
  | { kind: 'module'; nodeId: string; target: Extract<WorkLinkTarget, { kind: 'module' }> }
  | { kind: 'observed'; nodeId: string; label: string; detail: string };

/** Pure per-graph-tab display state: which node is selected in place and which
 * node ids show their full label. It never freezes or writes domain data. */
export type WorkbenchGraphDisplay = { selected: WorkbenchNodeSelection | null; pinned: string[];
  /** Node ids whose full label is shown by default (root/active/ancestors). All
   * other nodes stay dots with a hover preview; selected/pinned always show. */
  labels?: string[] };

// tabId/title are presentation identifiers only. Object navigation uses the
// full typed fields below; scope-only pages use their parent layout.scope.
export type WorkbenchTab = { tabId: string; title: string } & (
  | { kind: 'file'; file: WorkspaceFile; editorDraft: { state: 'draft_snapshot'; text: string } | null }
  // Existing initialization/Goal/Plan controls share the scope-bound setup page.
  | { kind: 'setup' | 'project_chat' }
  | { kind: 'architecture_graph'; selection: ArchitectureReadBody['input']['selection']; display?: WorkbenchGraphDisplay }
  | { kind: 'task_graph'; goal: TaskGraph['plan']['goalRef']; display?: WorkbenchGraphDisplay }
  | { kind: 'directory'; path: string }
  | { kind: 'session_chat'; session: SessionRef }
  | { kind: 'history'; session: SessionRef }
  // R6 Task-execution -> original Session/history: the EXACT RunRef plus the
  // optional original TaskTriple return target. Identity is typed, never parsed.
  | { kind: 'execution_history'; run: RunRef; task: TaskTriple | null }
  | { kind: 'task_detail'; target: Extract<WorkLinkTarget, { kind: 'task' }> }
  | { kind: 'module_detail'; target: Extract<WorkLinkTarget, { kind: 'module' }> }
  // One real Kernel command handle; the snapshot is read back by commandId.
  | { kind: 'terminal'; commandId: string; command: string; cwd: string }
  // One real WorkspaceToolsPort.compareWorkspace request over two exact versions.
  | { kind: 'diff'; before: WorkspaceVersion; after: WorkspaceVersion; prefix: string | null }
  // Prototype `＋` chooser page (reads nothing until a type is chosen).
  | { kind: 'blank' }
  // The Diff entry page: real version pairs are chosen here before any request.
  | { kind: 'compare' }
);

/** Display state for one scope and the exact SessionRef, or project composer
 * when session is null. Tabs/editors are separate from the conversation draft.
 * This state has no network/send capability and never writes Task/Session. */
export type WorkbenchLayout = {
  scope: CoreScope;
  session: SessionRef | null;
  tabs: WorkbenchTab[];
  activeTabId: string | null;
  composerDraft: WorkbenchDraft;
  /** Archived pages can browse files but cannot edit or add to a sendable draft. */
  readOnly: boolean;
};

export type WorkbenchLayoutAction =
  | { kind: 'open_tab'; tab: WorkbenchTab }
  | { kind: 'activate_tab'; tabId: string }
  | { kind: 'close_tab'; tabId: string }
  | { kind: 'edit_file_draft'; tabId: string; text: string }
  | { kind: 'edit_composer'; text: string }
  | { kind: 'add_reference'; reference: WorkbenchDraftReference }
  | { kind: 'select_node'; tabId: string; selection: WorkbenchNodeSelection }
  | { kind: 'toggle_pin'; tabId: string; nodeId: string };

/** The one display-state factory. It binds the layout to the scope and to the
 * exact SessionRef (or the project main conversation) so tabs and drafts can
 * never leak across scopes, Sessions or the archived boundary. */
export function createWorkbenchLayout(
  scope: CoreScope, session: SessionRef | null, lifecycle: SessionRecord['lifecycle'] | null,
): WorkbenchLayout {
  return { scope, session, tabs: [], activeTabId: null,
    composerDraft: { state: 'draft_snapshot', text: '', references: [] }, readOnly: lifecycle === 'archived' };
}

/** The pure tab/draft reducer. Every branch is a display-only move: no HTTP, no
 * send, no file save. On an archived (read-only) layout the edit branches are
 * no-ops so a file can be browsed but never turned into a sendable draft. */
export function reduceWorkbenchLayout(layout: WorkbenchLayout, action: WorkbenchLayoutAction): WorkbenchLayout {
  switch (action.kind) {
    case 'open_tab': {
      const existing = layout.tabs.find(tab => tab.tabId === action.tab.tabId);
      // Re-opening a tab keeps its saved display state: the file editor snapshot
      // or the graph tab's selected/pinned node set. A fresh read never discards
      // what the user is looking at.
      let tab: WorkbenchTab = action.tab;
      if (existing !== undefined && existing.kind === 'file' && action.tab.kind === 'file'
        && action.tab.editorDraft === null) {
        tab = { ...action.tab, editorDraft: existing.editorDraft };
      } else if (existing !== undefined && existing.kind === 'task_graph' && action.tab.kind === 'task_graph') {
        const display = action.tab.display ?? existing.display;
        tab = display === undefined ? action.tab : { ...action.tab, display };
      } else if (existing !== undefined && existing.kind === 'architecture_graph' && action.tab.kind === 'architecture_graph') {
        const display = action.tab.display ?? existing.display;
        tab = display === undefined ? action.tab : { ...action.tab, display };
      }
      const tabs = existing === undefined
        ? [...layout.tabs, tab]
        : layout.tabs.map(current => current.tabId === tab.tabId ? tab : current);
      return { ...layout, tabs, activeTabId: tab.tabId };
    }
    case 'activate_tab':
      return layout.tabs.some(tab => tab.tabId === action.tabId)
        ? { ...layout, activeTabId: action.tabId }
        : layout;
    case 'close_tab': {
      if (!layout.tabs.some(tab => tab.tabId === action.tabId)) return layout;
      const tabs = layout.tabs.filter(tab => tab.tabId !== action.tabId);
      const activeTabId = layout.activeTabId === action.tabId
        ? (tabs.length === 0 ? null : tabs[tabs.length - 1]!.tabId)
        : layout.activeTabId;
      return { ...layout, tabs, activeTabId };
    }
    case 'edit_file_draft':
      if (layout.readOnly) return layout;
      // A historical/capture read version is never turned into an edited buffer.
      return { ...layout, tabs: layout.tabs.map(tab =>
        tab.tabId === action.tabId && tab.kind === 'file' && tab.file.version.kind === 'working_tree'
          ? { ...tab, editorDraft: { state: 'draft_snapshot' as const, text: action.text } }
          : tab) };
    case 'edit_composer':
      if (layout.readOnly) return layout;
      return { ...layout, composerDraft: { ...layout.composerDraft, text: action.text } };
    case 'add_reference':
      if (layout.readOnly) return layout;
      return { ...layout, composerDraft: {
        ...layout.composerDraft,
        references: [...layout.composerDraft.references, action.reference],
      } };
    case 'select_node':
      return { ...layout, tabs: layout.tabs.map(tab =>
        tab.tabId === action.tabId && (tab.kind === 'task_graph' || tab.kind === 'architecture_graph')
          ? { ...tab, display: { selected: action.selection, pinned: tab.display?.pinned ?? [] } }
          : tab) };
    case 'toggle_pin':
      return { ...layout, tabs: layout.tabs.map(tab => {
        if (tab.tabId !== action.tabId || (tab.kind !== 'task_graph' && tab.kind !== 'architecture_graph')) return tab;
        const pinned = tab.display?.pinned ?? [];
        const next = pinned.includes(action.nodeId)
          ? pinned.filter(id => id !== action.nodeId)
          : [...pinned, action.nodeId];
        return { ...tab, display: { selected: tab.display?.selected ?? null, pinned: next } };
      }) };
  }
}

/** The auxiliary tab strip plus the current conversation draft. It draws only
 * display state; the tab body is composed by the browser entry from the real
 * read results it already holds. */
export function renderWorkbenchLayout(layout: WorkbenchLayout): string {
  const tabs = layout.tabs.map(tab => {
    const active = tab.tabId === layout.activeTabId;
    const draft = tab.kind === 'file' && tab.editorDraft !== null;
    return `<button class="tab${active ? ' active' : ''}" role="tab" aria-selected="${String(active)}"`
      + ` tabindex="${active ? '0' : '-1'}" data-action="activate-tab"`
      + ` data-tab="${escapeHtml(tab.tabId)}" data-tab-kind="${escapeHtml(tab.kind)}">`
      + `<span class="tab-title">${escapeHtml(tab.title)}${draft ? ' · 草稿快照' : ''}</span>`
      + `<span class="tab-close" role="button" tabindex="0" data-action="close-tab"`
      + ` data-tab="${escapeHtml(tab.tabId)}" aria-label="关闭 ${escapeHtml(tab.title)}">×</span></button>`;
  }).join('');
  return `<section class="workbench-aux" data-view="workbench-layout" data-readonly="${String(layout.readOnly)}">`
    + `<div class="tabbar" role="tablist">${tabs}`
    + `<button class="tab new" data-action="open-page" data-page="blank" title="新建辅助页">＋</button>`
    + `</div></section>`;
}

// --- Original-history timeline -------------------------------------------------

const HISTORY_BODY_LABEL = {
  user_input: '用户输入', assistant_text: '助手正文', tool_result: '工具结果',
  artifact: '工件引用', unknown: '未识别记录',
} as const;

/** Real Kernel agent-event types → readable titles. An unlisted real type keeps
 * its own type string; it is never flattened into a generic "未识别". */
const EVENT_TYPE_LABEL: Record<string, string> = {
  'assistant.message_completed': '助手正文',
  'assistant.message_delta': '助手流式片段',
  'tool.started': '工具开始',
  'tool.completed': '工具完成',
  'tool.failed': '工具失败',
  'model.request_started': '模型请求',
  'model.request_completed': '模型响应',
  'model.request_failed': '模型请求失败',
  'model.usage_recorded': '用量记录',
  'turn.completed': '回合结束',
  'turn.failed': '回合失败',
  'run.started': 'Run 开始',
  'run.completed': 'Run 完成',
  'status.changed': '状态变更',
};

type ToolIdentity = { adapterId: string; kernelSessionId: string; runId: string; callId: string };
type ToolStatus = 'completed' | 'failed' | 'cancelled' | 'outcome_unknown';

/** Readable status label. A failed/cancelled/unknown result is NEVER shown as a
 * success, and an unknown result is never turned into "still running". */
const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  completed: '完成', failed: '失败', cancelled: '已取消', outcome_unknown: '结果未知',
};

type DeclaredToolCall = ToolIdentity & { name: string; argumentsJson: string };

type ParsedHistoryBody =
  | { kind: 'user_input'; text: string }
  | { kind: 'assistant_text'; text: string; reasoning: string; declared: DeclaredToolCall[] }
  | { kind: 'context_input'; text: string; sourceKind: string }
  | { kind: 'tool_start'; identity: ToolIdentity; name: string; argumentsJson: string; json: string }
  | { kind: 'tool_terminal'; identity: ToolIdentity; status: ToolStatus; name: string;
      outputText: string; outputJson: string; errorText: string | null; json: string }
  | { kind: 'artifact'; contentType: string; digest: string; sizeBytes: number; sourceKind: string; refId: string; revision: string }
  /** A recognized technical event: readable title + the exact event payload JSON. */
  | { kind: 'technical'; label: string; eventType: string; text: string; json: string }
  | { kind: 'unknown'; recordType: string };

/** The full tool identity key: two Runs (or two kernel Sessions/adapters) that
 * reuse a callId never collide, and adjacency is never used to pair events. */
const toolKey = (identity: ToolIdentity): string =>
  `${identity.adapterId}\u0000${identity.kernelSessionId}\u0000${identity.runId}\u0000${identity.callId}`;

/** Identity of one event from the entry's own source + event meta runId + payload callId. */
function toolIdentity(entry: SessionHistoryEntry, runId: string, callId: string): ToolIdentity {
  return { adapterId: entry.source.adapterId, kernelSessionId: entry.source.kernelSessionId, runId, callId };
}

const toolArgumentsJson = (value: unknown): string => JSON.stringify(value ?? {}, null, 2);

/** Text + JSON output parts of a tool result: text parts are the primary
 * readable output, JSON parts stay an auxiliary detail. */
function toolOutputParts(result: Record<string, unknown>): { text: string; json: string } {
  const textParts: string[] = [];
  const jsonParts: string[] = [];
  for (const item of list(result.output)) {
    const part = record(item);
    if (part.kind === 'text' && typeof part.text === 'string') textParts.push(part.text);
    else if (part.kind === 'json' && part.value !== undefined) jsonParts.push(JSON.stringify(part.value, null, 2));
    else if (part.kind === 'artifact_ref') {
      const uri = typeof part.uri === 'string' ? part.uri : '';
      const summary = typeof part.summary === 'string' ? part.summary : '';
      textParts.push(`工件 ${uri} ${summary}`.trim());
    } else if (typeof part.text === 'string') { textParts.push(part.text); }
  }
  return { text: textParts.join('\n'), json: jsonParts.join('\n') };
}

function toolTerminalStatus(type: string, result: Record<string, unknown>): ToolStatus {
  if (type === 'tool.failed') return 'failed';
  if (type === 'tool.cancelled') return 'cancelled';
  if (type === 'tool.outcome_unknown') return 'outcome_unknown';
  if (result.status === 'cancelled') return 'cancelled';
  if (result.status === 'error') return 'failed';
  return 'completed';
}

function toolResultError(result: Record<string, unknown>): string | null {
  const error = record(result.error);
  if (typeof error.message === 'string' && error.message.length > 0) return error.message;
  if (typeof result.reason === 'string' && result.reason.length > 0) return result.reason;
  return null;
}

function declaredToolCalls(entry: SessionHistoryEntry, eventPayload: Record<string, unknown>, runId: string): DeclaredToolCall[] {
  const calls: DeclaredToolCall[] = [];
  for (const item of list(eventPayload.toolCalls)) {
    const call = record(item);
    const callId = typeof call.callId === 'string' ? call.callId : '';
    if (callId.length === 0) continue;
    calls.push({ ...toolIdentity(entry, runId, callId),
      name: typeof call.name === 'string' ? call.name : '',
      argumentsJson: toolArgumentsJson(call.arguments) });
  }
  return calls;
}

/** Parse one raw entry into the segmented summary shown by default. The public
 * user/assistant prose is read directly; recognized tool events carry their real
 * identity so the sequence can join start and terminal records; every other
 * recognized event keeps its real type and complete payload JSON. The complete
 * saved record is always reachable through `renderRawDisclosure`. */
function parseHistoryBody(entry: SessionHistoryEntry): ParsedHistoryBody {
  const body = record(entry.body);
  if (body.kind === 'artifact') {
    const source = record(body.source);
    return { kind: 'artifact',
      contentType: typeof body.contentType === 'string' ? body.contentType : '',
      digest: typeof body.digest === 'string' ? body.digest : '',
      sizeBytes: typeof body.sizeBytes === 'number' ? body.sizeBytes : 0,
      sourceKind: typeof source.kind === 'string' ? source.kind : '',
      refId: typeof source.refId === 'string' ? source.refId : '',
      revision: typeof source.revision === 'string' ? source.revision : '' };
  }
  if (body.encoding !== 'kernel_session_record_json' || typeof body.text !== 'string') {
    return { kind: 'unknown', recordType: entry.kind };
  }
  let parsed: Record<string, unknown>;
  try { parsed = record(JSON.parse(body.text)); }
  catch { return { kind: 'unknown', recordType: entry.kind }; }
  const recordType = typeof parsed.recordType === 'string' ? parsed.recordType : entry.kind;
  const payload = record(parsed.payload);
  if (recordType === 'turn.started') {
    const run = record(payload.run);
    const turn = record(run.turn);
    const userMessage = record(turn.userMessage);
    if (typeof userMessage.content === 'string' && userMessage.content.length > 0) {
      return { kind: 'user_input', text: userMessage.content };
    }
  }
  if (recordType === 'agent.event') {
    const event = record(payload.event);
    const type = typeof event.type === 'string' ? event.type : '';
    const meta = record(event.meta);
    const runId = typeof meta.runId === 'string' ? meta.runId : '';
    const eventPayload = record(event.payload);
    if (type === 'assistant.message_completed') {
      const message = record(eventPayload.message);
      return { kind: 'assistant_text', text: typeof message.content === 'string' ? message.content : '',
        reasoning: typeof message.reasoningContent === 'string' ? message.reasoningContent : '',
        declared: declaredToolCalls(entry, eventPayload, runId) };
    }
    if (type === 'run.input_accepted') {
      const input = record(eventPayload.input);
      const source = record(input.sourceRef);
      if (typeof input.text === 'string') return { kind: 'context_input', text: input.text,
        sourceKind: typeof source.kind === 'string' ? source.kind : '' };
    }
    if (type === 'tool.started') {
      const call = record(eventPayload.call);
      const callId = typeof call.callId === 'string' ? call.callId : '';
      if (callId.length > 0) {
        return { kind: 'tool_start', identity: toolIdentity(entry, runId, callId),
          name: typeof call.name === 'string' ? call.name : '',
          argumentsJson: toolArgumentsJson(call.arguments), json: JSON.stringify(eventPayload, null, 2) };
      }
    }
    if (type === 'tool.completed' || type === 'tool.failed' || type === 'tool.cancelled' || type === 'tool.outcome_unknown') {
      const callId = typeof eventPayload.callId === 'string' ? eventPayload.callId : '';
      if (callId.length > 0) {
        const result = record(eventPayload.result);
        const status = toolTerminalStatus(type, result);
        const outputs = toolOutputParts(result);
        const synthesized = status === 'outcome_unknown' ? toolOutputParts(record(eventPayload.synthesizedResult)) : { text: '', json: '' };
        const errorText = status === 'outcome_unknown'
          ? ((typeof eventPayload.reason === 'string' && eventPayload.reason.length > 0) ? eventPayload.reason
            : toolResultError(record(eventPayload.synthesizedResult)))
          : toolResultError(result);
        return { kind: 'tool_terminal', identity: toolIdentity(entry, runId, callId), status,
          name: typeof eventPayload.toolName === 'string' ? eventPayload.toolName : '',
          outputText: outputs.text.length > 0 ? outputs.text : synthesized.text,
          outputJson: [outputs.json, synthesized.json].filter(part => part.length > 0).join('\n'),
          errorText, json: JSON.stringify(eventPayload, null, 2) };
      }
    }
    const label = EVENT_TYPE_LABEL[type] ?? (type.length > 0 ? type : recordType);
    const result = record(eventPayload.result);
    const text = type === 'tool.completed'
      ? (toolOutputParts(result).text + (typeof result.status === 'string' && result.status.length > 0 ? `\n[${result.status}]` : ''))
      : '';
    return { kind: 'technical', label, eventType: type.length > 0 ? type : recordType,
      text, json: JSON.stringify(eventPayload, null, 2) };
  }
  return { kind: 'unknown', recordType };
}

/** A page-local join of one tool's declared/started metadata and its terminal
 * result, keyed strictly by the full identity. It is a display index over the
 * SAME parsed entries, never a second history store. */
type ToolIndexEntry = { identity: ToolIdentity; name: string; argumentsJson: string | null;
  startRecordId: string | null; terminalRecordId: string | null };

function buildToolIndex(entries: readonly SessionHistoryEntry[]): Map<string, ToolIndexEntry> {
  const index = new Map<string, ToolIndexEntry>();
  const ensure = (identity: ToolIdentity): ToolIndexEntry => {
    const key = toolKey(identity);
    let current = index.get(key);
    if (current === undefined) {
      current = { identity, name: '', argumentsJson: null, startRecordId: null, terminalRecordId: null };
      index.set(key, current);
    }
    return current;
  };
  for (const entry of entries) {
    const parsed = parseHistoryBody(entry);
    if (parsed.kind === 'tool_start') {
      const tool = ensure(parsed.identity);
      if (parsed.name.length > 0) tool.name = parsed.name;
      tool.argumentsJson = parsed.argumentsJson;
      tool.startRecordId = entry.recordId;
    } else if (parsed.kind === 'tool_terminal') {
      const tool = ensure(parsed.identity);
      tool.terminalRecordId = entry.recordId;
      if (tool.name.length === 0 && parsed.name.length > 0) tool.name = parsed.name;
    } else if (parsed.kind === 'assistant_text') {
      for (const declared of parsed.declared) {
        const tool = ensure(declared);
        if (tool.name.length === 0) tool.name = declared.name;
        if (tool.argumentsJson === null) tool.argumentsJson = declared.argumentsJson;
      }
    }
  }
  return index;
}


/** The real event meta used only to group adjacent activity. It reads the same
 * saved record as parseHistoryBody; it is not a second history store. */
type HistoryEntryMeta = { session: string; runId: string; turnId: string; position: number };
type ActivityMember = { entry: SessionHistoryEntry; parsed: ParsedHistoryBody; meta: HistoryEntryMeta };

function historyEntryMeta(entry: SessionHistoryEntry): HistoryEntryMeta {
  let runId = '';
  let turnId = '';
  const body = record(entry.body);
  if (body.encoding === 'kernel_session_record_json' && typeof body.text === 'string') {
    try {
      const parsed = record(JSON.parse(body.text));
      if (parsed.recordType === 'agent.event') {
        const event = record(record(parsed.payload).event);
        const meta = record(event.meta);
        if (typeof meta.runId === 'string') runId = meta.runId;
        if (typeof meta.turnId === 'string') turnId = meta.turnId;
      }
    } catch { /* the entry's own source identity still groups it */ }
  }
  return { session: `${entry.source.adapterId}/${entry.source.kernelSessionId}`, runId, turnId, position: entry.source.position };
}

/** Prose/input keep the reading mainline and cut an activity group; tool and
 * technical records collapse into one activity summary between them. */
const isMessageBoundary = (parsed: ParsedHistoryBody): boolean =>
  parsed.kind === 'user_input' || parsed.kind === 'assistant_text' || parsed.kind === 'context_input';

const activityGroupKey = (meta: HistoryEntryMeta): string =>
  `${meta.session}\u0000${meta.runId}\u0000${meta.turnId}`;

/** One honest line for the collapsed process row: real tool names and real
 * status counts, never an invented duration or task count. A failed/cancelled/
 * unknown member is always named here, so it can never read as success. */
function activitySummary(members: readonly ActivityMember[], tools: Map<string, ToolIndexEntry>): string {
  const calls = new Map<string, { name: string; status: ToolStatus | null }>();
  const events = new Set<string>();
  let extraCount = 0;
  for (const { parsed } of members) {
    if (parsed.kind === 'tool_start' || parsed.kind === 'tool_terminal') {
      const key = toolKey(parsed.identity);
      const tool = tools.get(key);
      const previous = calls.get(key);
      calls.set(key, { name: tool?.name || parsed.name || previous?.name || '',
        status: parsed.kind === 'tool_terminal' ? parsed.status : previous?.status ?? null });
    } else {
      extraCount += 1;
      if (parsed.kind === 'technical') events.add(parsed.eventType);
    }
  }
  const categories = new Map<string, number>();
  let failed = 0, cancelled = 0, unknown = 0;
  for (const call of calls.values()) {
    const name = call.name.toLowerCase();
    const category = /search|grep|find/.test(name) ? '搜索' : /list/.test(name) ? '浏览目录' : /read|source/.test(name) ? '读取文件'
      : /write|edit|patch/.test(name) ? '编辑文件' : /shell|command|exec/.test(name) ? '运行命令' : '调用工具';
    categories.set(category, (categories.get(category) ?? 0) + 1);
    if (call.status === 'failed') failed += 1;
    if (call.status === 'cancelled') cancelled += 1;
    if (call.status === 'outcome_unknown') unknown += 1;
  }
  const parts = [...categories].slice(0, 3).map(([name, count]) => `${name} ${count} 次`);
  if (categories.size > 3) parts.push('等活动');
  if (parts.length === 0) parts.push(events.has('model.request_started') ? '模型请求'
    : events.has('run.completed') ? '本轮结束' : '执行记录');
  else if (extraCount > 0 && members.some(({ parsed }) => parsed.kind === 'unknown'
    || (parsed.kind === 'technical' && !(parsed.eventType in EVENT_TYPE_LABEL)))) parts.push('执行记录');
  if (failed > 0 || [...events].some(type => /(?:model|run)\..*fail/.test(type))) parts.push(failed > 0 ? `失败 ${failed}` : '执行失败');
  if (cancelled > 0 || events.has('run.cancelled')) parts.push(cancelled > 0 ? `取消 ${cancelled}` : '已取消');
  if (unknown > 0 || events.has('tool.outcome_unknown')) parts.push('结果未知');
  if (events.has('run.limit_exceeded')) parts.push('达到运行限制');
  return parts.join(' · ');
}

/** One default-closed activity group. It carries the real adapter+kernelSession
 * +run identity, keeps every member's own original record and order, and never
 * re-sorts parallel records. */
function renderActivityGroup(members: readonly ActivityMember[], tools: Map<string, ToolIndexEntry>): string {
  const meta = members[0]?.meta;
  if (meta === undefined) return '';
  const summary = activitySummary(members, tools);
  const targets = [...new Set(members.flatMap(({ parsed }) => {
    if (parsed.kind !== 'tool_start' && parsed.kind !== 'tool_terminal') return [];
    const target = toolPrimaryTarget(tools.get(toolKey(parsed.identity))?.argumentsJson ?? null);
    return target === null ? [] : [target];
  }))];
  const targetPreview = targets.slice(0, 2).map(target => target.startsWith('路径 ')
    ? target.slice(3).split('/').at(-1) : target).join('、') + (targets.length > 2 ? ` 等 ${targets.length} 项` : '');
  // Keep the exact event order while putting start/transport bookkeeping behind
  // one local disclosure. The useful tool result rows remain directly visible
  // when the user expands this activity.
  let rows = '', bookkeeping: ActivityMember[] = [];
  const flushBookkeeping = (): void => {
    if (bookkeeping.length === 0) return;
    const key = bookkeeping[0]!.entry.recordId;
    rows += `<li><details class="history-bookkeeping" data-disclosure-key="events:${escapeHtml(key)}">`
      + `<summary>执行细节 · ${bookkeeping.length} 条</summary><ol class="history">`
      + bookkeeping.map(member => renderActivityMemberLi(member, tools)).join('') + '</ol></details></li>';
    bookkeeping = [];
  };
  for (const member of members) {
    const parsed = member.parsed;
    const background = parsed.kind === 'technical'
      || (parsed.kind === 'tool_start' && tools.get(toolKey(parsed.identity))?.terminalRecordId != null);
    if (background) bookkeeping.push(member);
    else { flushBookkeeping(); rows += renderActivityMemberLi(member, tools); }
  }
  flushBookkeeping();
  const firstRecord = members[0]?.entry.recordId ?? '';
  const stableKey = `${meta.session}|${meta.runId}|${meta.turnId}|${firstRecord}`;
  const identity = ` data-activity-session="${escapeHtml(meta.session)}" data-activity-run="${escapeHtml(meta.runId)}"`
    + (meta.turnId.length === 0 ? '' : ` data-activity-turn="${escapeHtml(meta.turnId)}"`)
    + ` data-disclosure-key="${escapeHtml(stableKey)}"`;
  return `<li class="history-activity"><details data-activity-group${identity}>`
    + `<summary class="cursor-interaction"><span class="q-chevron">›</span><span>${escapeHtml(summary)}</span>`
    + (targets.length === 0 ? '' : `<span class="history-activity-target" title="${escapeHtml(targets.join('\n'))}">${escapeHtml(targetPreview)}</span>`)
    + `</summary>`
    + `<ol class="history">${rows}</ol></details></li>`;
}

/** One activity member: a low-density tool row (or the technical/unknown/
 * artifact fold) plus its own default-closed raw disclosure. */
function renderActivityMemberLi(member: ActivityMember, tools: Map<string, ToolIndexEntry>): string {
  const { entry, parsed } = member;
  let inner: string;
  let kind: string;
  if (parsed.kind === 'tool_start') {
    inner = renderToolStartEntry(parsed, tools.get(toolKey(parsed.identity))); kind = 'tool_start';
  } else if (parsed.kind === 'tool_terminal') {
    inner = renderToolTerminalEntry(entry, parsed, tools.get(toolKey(parsed.identity))); kind = 'tool_result';
  } else {
    inner = renderParsedHistoryBody(parsed); kind = parsed.kind;
  }
  return `<li data-history="${escapeHtml(entry.recordId)}" data-history-kind="${kind}">`
    + `${inner}${parsed.kind === 'tool_terminal' ? '' : renderRawDisclosure(entry)}</li>`;
}

/** Short default timestamp; the ISO value and source position stay in raw. */
function shortTime(iso: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (match === null) return iso;
  return `${match[1]}-${match[2]} ${match[3]}:${match[4]}`;
}

const toolIdentityAttributes = (identity: ToolIdentity): string =>
  ` data-tool-session="${escapeHtml(`${identity.adapterId}/${identity.kernelSessionId}`)}"`
  + ` data-tool-run="${escapeHtml(identity.runId)}" data-tool-call="${escapeHtml(identity.callId)}"`;

/** Main readable target of a tool call: its command or path when the real
 * arguments carry one. Nothing is invented when they do not. */
function toolPrimaryTarget(argumentsJson: string | null): string | null {
  if (argumentsJson === null) return null;
  let args: Record<string, unknown>;
  try { args = record(JSON.parse(argumentsJson)); }
  catch { return null; }
  if (typeof args.command === 'string' && args.command.length > 0) return `命令 ${args.command}`;
  const path = args.path ?? args.file_path ?? args.filePath;
  if (typeof path === 'string' && path.length > 0) return `路径 ${path}`;
  return null;
}

function toolArgumentsBlock(identity: ToolIdentity, argumentsJson: string | null): string {
  return argumentsJson === null
    ? '<p class="muted" data-tool-missing="arguments">本页未见参数</p>'
    : `<pre class="q-tool-arguments" data-tool-arguments${toolIdentityAttributes(identity)}>${escapeHtml(argumentsJson)}</pre>`;
}

function toolOutputBlock(identity: ToolIdentity, parsed: Extract<ParsedHistoryBody, { kind: 'tool_terminal' }>): string {
  const blocks: string[] = [];
  if (parsed.outputText.length > 0) {
    blocks.push(`<pre class="q-tool-output" data-tool-output${toolIdentityAttributes(identity)}>${escapeHtml(parsed.outputText)}</pre>`);
  }
  if (parsed.errorText !== null && parsed.errorText.length > 0) {
    blocks.push(`<p class="q-tool-error" data-tool-error${toolIdentityAttributes(identity)}>${escapeHtml(parsed.errorText)}</p>`);
  }
  if (parsed.outputJson.length > 0) {
    blocks.push(detailsFor('JSON 输出', `<pre data-tool-json-output${toolIdentityAttributes(identity)}>${escapeHtml(parsed.outputJson)}</pre>`));
  }
  if (blocks.length === 0) blocks.push('<p class="muted" data-tool-missing="output">本页未见输出</p>');
  return blocks.join('');
}

/** A start whose terminal is on this page is one low-density line (the result
 * is the single full card at its terminal). A start with no terminal on this
 * page states the honest "本页未见结果" instead of pretending it is running. */
function renderToolStartEntry(
  parsed: Extract<ParsedHistoryBody, { kind: 'tool_start' }>, tool: ToolIndexEntry | undefined, declared = false,
): string {
  const name = tool !== undefined && tool.name.length > 0 ? tool.name : parsed.name;
  const label = name.length > 0 ? name : '未知工具';
  if (tool !== undefined && tool.terminalRecordId !== null) {
    return `<div class="history-tool-line" data-tool-row="start"${toolIdentityAttributes(parsed.identity)}>`
      + `<span class="phase muted">开始</span> <code>${escapeHtml(label)}</code></div>`;
  }
  return `<details class="history-tool-card is-pending" data-tool-card="pending" data-tool-name="${escapeHtml(label)}"${toolIdentityAttributes(parsed.identity)}>`
    + `<summary><span class="q-chevron">›</span><strong>${escapeHtml(label)}</strong>`
    + `<span class="muted">${declared ? '已请求' : '已开始'} · 本页未见结果</span></summary>`
    + toolArgumentsBlock(parsed.identity, parsed.argumentsJson)
    + '<p class="muted" data-tool-missing="terminal">本页未见结果（不据此推断仍在运行）</p></details>';
}

/** The one full card, placed at the terminal event's original position: action,
 * target and status are visible; a failure brief is visible without expanding;
 * arguments, output and the complete original record expand progressively. */
function renderToolTerminalEntry(
  entry: SessionHistoryEntry, parsed: Extract<ParsedHistoryBody, { kind: 'tool_terminal' }>,
  tool: ToolIndexEntry | undefined,
): string {
  const name = tool !== undefined && tool.name.length > 0 ? tool.name
    : parsed.name.length > 0 ? parsed.name : '未知工具';
  const argumentsJson = tool?.argumentsJson ?? null;
  const target = toolPrimaryTarget(argumentsJson);
  const brief = parsed.status === 'completed' ? ''
    : parsed.errorText !== null && parsed.errorText.length > 0 ? parsed.errorText
      : parsed.status === 'cancelled' ? '已取消' : '结果未知';
  return `<details class="history-tool-card is-${parsed.status}" data-tool-card="full" data-tool-name="${escapeHtml(name)}"`
    + ` data-tool-status="${parsed.status}" data-tool-terminal="${escapeHtml(entry.recordId)}"${toolIdentityAttributes(parsed.identity)}>`
    + `<summary><span class="q-chevron">›</span><strong>${escapeHtml(name)}</strong>`
    + (target === null ? '' : `<span class="q-tool-target" title="${escapeHtml(target)}" data-tool-target>${escapeHtml(target)}</span>`)
    + `<span class="phase" data-tool-status="${parsed.status}">${escapeHtml(TOOL_STATUS_LABEL[parsed.status])}</span>`
    + (brief.length === 0 ? '' : `<span class="q-tool-brief" data-tool-brief>${escapeHtml(brief)}</span>`)
    + `</summary>`
    + toolOutputBlock(parsed.identity, parsed)
    + detailsFor('调用参数', toolArgumentsBlock(parsed.identity, argumentsJson))
    + renderRawDisclosure(entry)
    + '</details>';
}

/**
 * R6 cold-start: a READ-ONLY natural-language review of the optional `setup`
 * candidate carried by a saved v2 plan answer. It is a projection of the saved
 * model output and NEVER an adoption authority: `options.adopt` is set only by
 * the caller that renders the CURRENT Goal pending candidate with a matching
 * scope and saved Answer. Arbitrary history always renders the review without
 * any adoption control.
 */
export function renderInitialPlanSetupReview(setup: unknown, options: { adopt?: boolean; plan?: unknown } = {}): string {
  const value = record(setup);
  const architecture = record(value.architecture);
  const catalog = record(architecture.catalog);
  const policy = record(value.completionPolicy);
  const modules = list(catalog.modules);
  const dependencies = list(catalog.dependencies);
  const checks = list(value.checks);
  const kinds = list(policy.requirementKinds).map(String);
  const tasks = list(record(options.plan).tasks).map(item => {
    const task = record(item);
    const label = task.executionIntent === 'plan_only' ? '未来意图 · 不执行'
      : task.taskKind === 'gate' ? '验收' : '执行';
    return `<li><strong>${escapeHtml(task.title ?? '')}</strong> <span class="muted">${label}</span></li>`;
  }).join('');
  const moduleRows = modules.map(moduleValue => {
    const module = record(moduleValue);
    const ref = record(module.ref);
    return `<li data-setup-module="${escapeHtml(ref.moduleId ?? '')}"><strong>${escapeHtml(module.name ?? '')}</strong>`
      + ` <code>${escapeHtml(ref.projectId ?? '')}/${escapeHtml(ref.moduleId ?? '')}</code>`
      + ` <span class="muted">${escapeHtml(module.responsibility ?? '')}</span></li>`;
  }).join('');
  const checkRows = checks.map(checkValue => {
    const check = record(checkValue);
    const taskIds = check.taskIds === 'all' ? 'all' : list(check.taskIds).map(String).join(', ');
    return `<li data-setup-check="${escapeHtml(check.checkId ?? '')}"><code>${escapeHtml(check.command ?? '')}</code>`
      + ` <span class="muted">kind ${escapeHtml(check.kind ?? '')} · cwd ${escapeHtml(check.cwd ?? '')}`
      + ` · ${escapeHtml(String(check.timeoutMs ?? ''))}ms · tasks ${escapeHtml(taskIds)}</span></li>`;
  }).join('');
  return `<section class="initial-plan-review" data-initial-plan-review>`
    + `<h3>候选初始方案（模型建议，尚未采用）</h3>`
    + (tasks === '' ? '' : `<div data-setup-tasks><h4>工作安排</h4><ul>${tasks}</ul></div>`)
    + `<div data-setup-architecture><h4>候选初始架构</h4>`
    + `<p class="muted">baseline ${escapeHtml(architecture.baselineId ?? '')} · DAG ${String(catalog.requireDag === true)}`
    + `${String(architecture.description ?? '') === '' ? '' : ` · ${escapeHtml(architecture.description ?? '')}`}</p>`
    + (moduleRows === '' ? '<p class="muted">没有模块</p>' : `<ul>${moduleRows}</ul>`)
    + (dependencies.length === 0 ? '' : `<p class="muted">依赖 ${dependencies.length} 条</p>`)
    + `</div>`
    + `<div data-setup-completion-policy><h4>候选完成策略</h4>`
    + `<p>requirementKinds: ${escapeHtml(kinds.join(', ') || '(none)')}`
    + ` · 每个必需义务最少 ${escapeHtml(String(policy.minimumRequiredRequirementsPerObligation ?? ''))} 条必需验证</p></div>`
    + `<div data-setup-checks><h4>候选检查（若采用将会运行的真实命令）</h4>`
    + (checkRows === '' ? '<p class="muted">没有注册检查</p>' : `<ul>${checkRows}</ul>`)
    + `</div>`
    + (options.adopt === true
      ? '<div class="buttons"><button data-action="adopt-initial-plan" data-adopt-initial-plan>采用并执行</button></div>'
      : '')
    + `</section>`;
}

/** The planning model deliberately returns JSON. Present its known, saved
 * prose and task titles without treating that model output as an adopted plan.
 * Other messages keep ordinary Markdown; no JSON is repaired or acted upon. */
function renderAssistantContent(text: string): string {
  let value: Record<string, unknown>;
  try { value = record(JSON.parse(text)); }
  catch {
    return /^\s*(?:\{\s*"|\[\s*\{)/.test(text)
      ? detailsFor('结构化文本（未解析）', `<pre>${escapeHtml(text)}</pre>`)
      : `<div class="q-message-text">${renderMarkdown(text)}</div>`;
  }
  if (value.schemaVersion !== 2 || (value.kind !== 'plan' && value.kind !== 'needs_decision')
    || typeof value.summary !== 'string') return /^\s*[\[{]/.test(text)
      ? detailsFor('结构化输出', `<pre>${escapeHtml(text)}</pre>`)
      : `<div class="q-message-text">${renderMarkdown(text)}</div>`;
  const planning = value.kind === 'plan';
  const rows = planning ? list(record(value.plan).tasks) : list(value.questions);
  const titles = rows.map(item => planning ? record(item).title : item)
    .filter((title): title is string => typeof title === 'string');
  return `<div data-planning-output="${escapeHtml(value.kind)}"><p class="muted">${planning ? '计划候选 · 模型输出' : '待决问题 · 模型输出'}</p>`
    + `<div class="q-message-text">${renderMarkdown(value.summary)}</div>`
    + (titles.length === 0 ? '' : `<div class="q-message-text"><h3>${planning ? '候选任务' : '需要确认'}</h3><ol>`
      + titles.map(title => `<li>${escapeHtml(title)}</li>`).join('') + '</ol></div>')
    + (planning && value.setup !== undefined ? renderInitialPlanSetupReview(value.setup, { plan: value.plan }) : '')
    + detailsFor('完整结构化输出', `<pre>${escapeHtml(text)}</pre>`) + '</div>';
}

/** Segmented default view of one original record. A tool record falls back to
 * its full payload JSON when it is rendered without page context. */
function renderParsedHistoryBody(parsed: ParsedHistoryBody, inputRecord = ''): string {
  if (parsed.kind === 'artifact') {
    return `<div data-history-body="artifact"><p>工件 <code>${escapeHtml(parsed.refId)}</code>`
      + ` · ${escapeHtml(parsed.contentType)} · ${escapeHtml(parsed.sizeBytes)} 字节`
      + ` · ${escapeHtml(parsed.sourceKind)}@${escapeHtml(parsed.revision)}</p>`
      + `<p class="muted">正文未读取</p></div>`;
  }
  if (parsed.kind === 'unknown') {
    return `<details class="q-fold q-tool" data-history-body="unknown"><summary class="cursor-interaction">`
      + `<span class="q-chevron">›</span>未识别记录 · <code>${escapeHtml(parsed.recordType)}</code></summary>`
      + `<p class="muted">完整已保存原文见下方“原始记录”，此处不生成解释代替原文。</p></details>`;
  }
  if (parsed.kind === 'tool_start' || parsed.kind === 'tool_terminal') {
    const label = parsed.kind === 'tool_start' ? '工具开始' : TOOL_STATUS_LABEL[parsed.status];
    const eventType = parsed.kind === 'tool_start' ? 'tool.started' : 'tool.result';
    return `<details class="q-fold q-tool" data-history-body="technical" data-event-type="${escapeHtml(eventType)}">`
      + `<summary class="cursor-interaction"><span class="q-chevron">›</span>${escapeHtml(label)}`
      + ` <span class="muted">${escapeHtml(eventType)}</span></summary>`
      + `<pre data-tool-json>${escapeHtml(parsed.json)}</pre></details>`;
  }
  if (parsed.kind === 'technical') {
    return `<details class="q-fold q-tool" data-history-body="technical" data-event-type="${escapeHtml(parsed.eventType)}">`
      + `<summary class="cursor-interaction"><span class="q-chevron">›</span>${escapeHtml(parsed.label)}`
      + ` <span class="muted">${escapeHtml(parsed.eventType)}</span></summary>`
      + (parsed.text.length === 0 ? '' : `<pre data-tool-text>${escapeHtml(parsed.text)}</pre>`)
      + `<pre data-tool-json>${escapeHtml(parsed.json)}</pre></details>`;
  }
  const body = parsed.kind === 'assistant_text' ? renderAssistantContent(parsed.text)
    : `<div class="q-message-text">${renderMarkdown(parsed.text)}</div>`;
  if (parsed.kind === 'context_input') {
    return `<details class="q-fold history-input" data-history-body="context_input"><summary><span class="q-chevron">›</span>上下文补充`
      + `${parsed.sourceKind === '' ? '' : ` · ${escapeHtml(parsed.sourceKind)}`}</summary>${body}${inputRecord}</details>`;
  }
  if (parsed.kind === 'user_input') {
    return `<details class="q-fold history-input" data-history-body="user_input"><summary><span class="q-chevron">›</span>执行上下文 · ${parsed.text.length} 字</summary>${body}${inputRecord}</details>`;
  }
  const reasoning = parsed.kind === 'assistant_text' && parsed.reasoning.length > 0
    ? `<details class="history-reasoning"><summary title="展开模型已保存的推理原文"><span class="q-chevron">›</span>思考</summary><div class="q-message-text">${renderMarkdown(parsed.reasoning)}</div></details>` : '';
  return `<div class="q-msg q-msg-assistant" data-history-body="${parsed.kind}">${reasoning}${body}</div>`;
}

/** The exact saved body text, or the ArtifactRef record for an artifact body.
 * Only HTML escaping is applied; no field is removed. */
function rawRecordBody(entry: SessionHistoryEntry): string {
  const body = record(entry.body);
  if (typeof body.text === 'string') return body.text;
  return JSON.stringify(entry.body, null, 2);
}

/** Every saved original record is available in a default-closed disclosure that
 * preserves the exact saved body and its source identity. Expanding it shows the
 * complete original text, including reasoning, tool arguments/results and unknown
 * event fields, in original order. */
function renderRawDisclosure(entry: SessionHistoryEntry): string {
  return `<details class="history-raw" data-history-raw="${escapeHtml(entry.recordId)}">`
    + `<summary aria-label="查看原始记录" title="原始记录 · 完整保存原文"><span aria-hidden="true">···</span></summary>`
    + `<p class="muted">recordId <code>${escapeHtml(entry.recordId)}</code>`
    + ` · kind ${escapeHtml(entry.kind)}`
    + ` · cursor <code>${escapeHtml(entry.cursor)}</code>`
    + ` · position ${escapeHtml(entry.source.position)}`
    + ` · ${escapeHtml(entry.recordedAt)}`
    + ` · source ${escapeHtml(entry.source.adapterId)}/${escapeHtml(entry.source.kernelSessionId)}</p>`
    + `<pre>${escapeHtml(rawRecordBody(entry))}</pre>`
    + `</details>`;
}

/** Prose and input are the reading mainline and stay their own readable body. */
function renderHistoryEntry(entry: SessionHistoryEntry, tools: Map<string, ToolIndexEntry>): string {
  const parsed = parseHistoryBody(entry);
  const identity = `<span class="muted">${escapeHtml(shortTime(entry.recordedAt))}</span>`;
  const title = parsed.kind === 'technical' ? parsed.label
    : parsed.kind === 'user_input' ? '执行输入' : parsed.kind === 'assistant_text' ? 'Agent'
      : parsed.kind === 'context_input' ? ''
      : parsed.kind === 'artifact' ? HISTORY_BODY_LABEL.artifact
        : parsed.kind === 'unknown' ? HISTORY_BODY_LABEL.unknown
          : HISTORY_BODY_LABEL.tool_result;
  const isInput = parsed.kind === 'user_input' || parsed.kind === 'context_input';
  const header = isInput ? '' : title.length === 0
    ? `<header class="q-msg-meta">${identity}</header>`
    : `<header class="q-msg-meta"><strong>${escapeHtml(title)}</strong> ${identity}</header>`;
  const declared = parsed.kind !== 'assistant_text' ? '' : parsed.declared.filter(call => {
    const tool = tools.get(toolKey(call));
    return tool !== undefined && tool.startRecordId === null && tool.terminalRecordId === null;
  }).map(call => renderToolStartEntry({ kind: 'tool_start', identity: call, name: call.name,
    argumentsJson: call.argumentsJson, json: '' }, tools.get(toolKey(call)), true)).join('');
  return `<li data-history="${escapeHtml(entry.recordId)}" data-history-kind="${parsed.kind}">`
    + `${header}${renderParsedHistoryBody(parsed, isInput ? renderRawDisclosure(entry) : '')}${declared}${isInput ? '' : renderRawDisclosure(entry)}</li>`;
}

/** The reading sequence: prose/input stay inline, and each contiguous run of
 * same identity (adapter+kernelSession+run+turn, adjacent positions) collapses
 * into ONE activity group. A prose/input/source/identity change cuts the group;
 * parallel records are never re-sorted. Every member keeps its own raw record. */
function renderHistorySequence(entries: SessionHistoryEntry[]): string {
  const tools = buildToolIndex(entries);
  let html = '';
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index]!;
    const parsed = parseHistoryBody(entry);
    if (isMessageBoundary(parsed)) {
      html += renderHistoryEntry(entry, tools);
      index += 1;
      continue;
    }
    const members: ActivityMember[] = [{ entry, parsed, meta: historyEntryMeta(entry) }];
    const key = activityGroupKey(members[0]!.meta);
    index += 1;
    while (index < entries.length) {
      const next = entries[index]!;
      const nextParsed = parseHistoryBody(next);
      if (isMessageBoundary(nextParsed)) break;
      const nextMeta = historyEntryMeta(next);
      if (activityGroupKey(nextMeta) !== key) break;
      if (nextMeta.position !== members[members.length - 1]!.meta.position + 1) break;
      members.push({ entry: next, parsed: nextParsed, meta: nextMeta });
      index += 1;
    }
    html += renderActivityGroup(members, tools);
  }
  return html;
}

/** Original-history timeline. It preserves the exact recordId, cursor and
 * source.position order, keeps ArtifactRef unread, and never invents a public
 * summary or re-sorts parallel events into a causal chain. */
export function renderSessionHistoryTimeline(result: ReadResult<Page<SessionHistoryEntry>>, executions?: readonly TaskExecutionRecord[]): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('sessions/history', '该会话没有可读的原历史');
  if (result.status === 'not_ready') return renderGap('sessions/history', '原历史尚未就绪');
  const page = result.value;
  const sections: { key: string | null; label: string; entries: SessionHistoryEntry[] }[] = [];
  for (const entry of page.items) {
    const execution = executions?.find(candidate => {
      const window = candidate.run.executionHistory;
      return window !== undefined && window.kernel.adapterId === entry.source.adapterId
        && window.kernel.kernelSessionId === entry.source.kernelSessionId
        && entry.source.position >= window.startPosition
        && entry.source.position <= (window.endPosition ?? window.observedThroughPosition);
    });
    const task = execution?.run.task;
    const key = task === undefined ? null : JSON.stringify(task);
    const previous = sections[sections.length - 1];
    if (previous !== undefined && previous.key === key) previous.entries.push(entry);
    else sections.push({ key, label: task?.taskId ?? '', entries: [entry] });
  }
  const rows = sections.map(section => {
    const body = renderHistorySequence(section.entries);
    return section.key === null ? body
      : `<li class="history-task-group"><details><summary class="cursor-interaction"><span class="q-chevron">›</span>Task ${escapeHtml(section.label)} · ${section.entries.length} 条</summary><ol class="history">${body}</ol></details></li>`;
  }).join('');
  return `<section class="panel history-timeline" data-view="history-timeline">`
    + detailsFor('历史详情', `<p>共 ${page.items.length} 条 · ${page.nextCursor === null ? '没有更多' : '还有更多'}</p><p>nextCursor ${escapeHtml(page.nextCursor ?? 'none')}</p>`
      + `<p>basis <code>${escapeHtml(JSON.stringify(page.basis))}</code></p>`)
    + (page.items.length === 0 ? '<p class="muted">该页没有记录</p>' : `<ol class="history">${rows}</ol>`)
    + `</section>`;
}

/** Result state for one execution-history page. The exact scope + RunRef is the
 * key, so a late response can never be shown under another Run. This is page
 * display state, never a second domain index; refresh/pagination overwrite it
 * with the latest real read result. */


/** Result state for one execution-history page. The exact scope + RunRef is the
 * key, so a late response can never be shown under another Run. This is page
 * display state, never a second domain index; refresh/pagination overwrite it
 * with the latest real read result. */
export type WorkbenchExecutionHistoryPage = {
  scope: CoreScope;
  run: RunRef;
  result: ReadResult<ExecutionHistoryPage>;
};

/** Exact-key display predicate: the saved page belongs to this scope and Run. */
export function executionHistoryMatches(
  state: WorkbenchExecutionHistoryPage, scope: CoreScope, run: RunRef,
): boolean {
  return state.scope.projectId === scope.projectId && state.scope.workspaceId === scope.workspaceId
    && state.run.aggregateType === run.aggregateType && state.run.projectId === run.projectId
    && state.run.goalId === run.goalId && state.run.runId === run.runId;
}

/** The exact `executions/read` result: the original TaskExecutionRecord facts.
 * The claim Session, Run status, attempt/outbox and every persisted field stay
 * reachable (raw disclosure); a missing/unindexed record is shown as this
 * read's real result and never hidden behind another Session. */
export function renderExecutionRecord(result: ReadResult<TaskExecutionRecord> | null): string {
  if (result === null) return renderGap('executions/read', '尚未读取本次执行事实。');
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('executions/read', '没有找到这次执行的正式记录。');
  if (result.status === 'not_ready') return renderGap('executions/read', '本次执行记录尚未就绪。');
  const value = result.value;
  const claimSession = value.outbox.claim.sessionRef;
  // Default view stays non-technical: this Task/Run's status and the original
  // Session to navigate to. The outbox/attempt/lease/readThrough facts remain in
  // the complete raw disclosure below, unfiltered.
  return `<section class="panel" data-view="execution-record" data-run-id="${escapeHtml(value.run.ref.runId)}">`
    + `<header><h3>本次执行事实</h3><p class="muted">Task <code>${escapeHtml(value.run.task.taskId)}</code>`
    + ` · Run <code>${escapeHtml(value.run.ref.runId)}</code> · 状态 ${escapeHtml(value.run.status)}</p></header>`
    + `<p>原 claim 会话 <code>${escapeHtml(claimSession.projectId)}/${escapeHtml(claimSession.sessionId)}</code></p>`
    + detailsFor('查看执行原始字段', `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`)
    + `</section>`;
}

/** The exact `executions/history` run window. It reuses the original-history
 * timeline (saved records only, original order, default-collapsed raw body) and
 * adds the window's own Kernel identity/scannedCount/basis. A non-ready read is
 * shown as this read's real result, never as a stale ready page. */
export function renderExecutionHistory(result: ReadResult<ExecutionHistoryPage> | null): string {
  if (result === null) return renderGap('executions/history', '尚未读取本次执行原历史。');
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('executions/history', '本次执行没有被索引的原历史。');
  if (result.status === 'not_ready') return renderGap('executions/history', '本次执行原历史尚未就绪。');
  const page = result.value;
  const identity = detailsFor('本次执行窗口身份与范围',
    `<p>executionIdentity <code>${escapeHtml(JSON.stringify(page.executionIdentity))}</code></p>`
    + `<p>scannedCount ${escapeHtml(page.scannedCount)}</p>`
    + `<p>basis <code>${escapeHtml(JSON.stringify(page.basis))}</code></p>`);
  return `<div data-view="execution-history-window">${renderSessionHistoryTimeline(result)}${identity}</div>`;
}

// --- Task structure ------------------------------------------------------------

// (removed) task rows are rendered by the structure lens sections.
export function renderTaskStructure(
  result: ReadResult<TaskGraph>,
  page?: { items: TaskExecutionRecord[]; nextCursor: string | null; readThrough?: unknown },
  lens?: { focus: number; zoom: number },
  display?: WorkbenchGraphDisplay,
  edgeMode: 'hierarchy' | 'dependency' = 'hierarchy',
): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('tasks/query', '该 Goal 还没有已采用的 Plan');
  if (result.status === 'not_ready') return renderGap('tasks/query', '任务图尚未就绪');
  const graph = result.value;
  const plan = graph.plan;
  type LensRow = { taskId: string; title: string; phase: string; disposition: string; intent: string; taskKind: string; requirement: string };
  const titleOf = (definition: unknown, taskId: string): string => {
    const title = record(definition).title;
    return typeof title === 'string' && title.length > 0 ? title : taskId;
  };
  const rows: LensRow[] = graph.tasks.length > 0
    ? graph.tasks.map(row => ({
        taskId: row.ref.taskId, title: titleOf(row.definition, row.ref.taskId),
        phase: row.effectivePhase, disposition: row.disposition,
        intent: row.definition.executionIntent ?? '未标注执行意图',
        taskKind: row.definition.taskKind ?? '', requirement: row.definition.requirementLevel ?? '' }))
    : plan.tasks.map(task => ({
        taskId: task.taskId, title: task.title.length > 0 ? task.title : task.taskId,
        phase: task.phase, disposition: task.disposition,
        intent: task.executionIntent ?? '未标注执行意图',
        taskKind: task.taskKind ?? '', requirement: task.requirementLevel ?? '' }));
  const taskIds = new Set(rows.map(row => row.taskId));
  const executions = (page?.items ?? []).filter(item =>
    item.run.task.projectId === plan.goalRef.projectId
    && item.run.task.goalId === plan.goalRef.goalId
    && taskIds.has(item.run.task.taskId));
  const focus = lens?.focus ?? 0.5;
  const zoom = lens?.zoom ?? 0.5;
  const pinned = new Set(display?.pinned ?? []);
  const selectedId = display?.selected?.nodeId ?? null;
  const parentOf = new Map<string, string>();
  for (const edge of plan.taskHierarchy.parentOf) parentOf.set(edge.childTaskId, edge.parentTaskId);
  const activeRunTasks = new Set(executions.filter(item => item.run.status !== 'ended').map(item => item.run.task.taskId));
  // Real run windows only; no guessed time.
  const known = executions.filter(item => MS(item.run.startedAt) !== null);
  const minMs = known.length === 0 ? 0 : Math.min(...known.map(item => MS(item.run.startedAt)!));
  const maxKnown = known.map(item => MS(item.run.endedAt)).filter((value): value is number => value !== null);
  const maxMs = Math.max(minMs + 1, ...known.map(item => MS(item.run.startedAt)!), ...maxKnown);
  const span = Math.max(1, maxMs - minMs);
  const byTask = new Map<string, { startMs: number; endMs: number; running: boolean }[]>();
  for (const item of known) {
    const taskId = item.run.task.taskId;
    const start = MS(item.run.startedAt)!;
    const end = MS(item.run.endedAt) ?? (item.run.status !== 'ended' ? maxMs : start);
    const segment = { startMs: Math.min(start, end), endMs: Math.max(start, end), running: item.run.status !== 'ended' };
    const bucket = byTask.get(taskId);
    if (bucket === undefined) byTask.set(taskId, [segment]); else bucket.push(segment);
  }
  const withRuns = rows.flatMap(row => {
    const segments = byTask.get(row.taskId);
    if (segments === undefined || segments.length === 0) return [];
    return [{ row, start: Math.min(...segments.map(segment => segment.startMs)), end: Math.max(...segments.map(segment => segment.endMs)) }];
  }).sort((left, right) => left.start - right.start);
  const laneEnds: number[] = [];
  const placed = withRuns.map(item => {
    let lane = laneEnds.findIndex(last => last <= item.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.end); } else laneEnds[lane] = item.end;
    return { row: item.row, lane, startMs: item.start, endMs: item.end };
  });
  const laneCount = Math.max(1, laneEnds.length);
  const height = 460;
  const width = Math.max(520, laneCount * 180 + 40);
  const yOf = (ms: number): number => 22 + lensMap((ms - minMs) / span, focus, zoom) * (height - 44);
  const xOf = (lane: number): number => 100 + lane * 180;
  const focusY = yOf(minMs + focus * span);
  const labelFor = (row: LensRow): string => `${row.title} · ${row.taskId} · ${row.phase} · ${row.intent}`;
  // Untimed nodes share this canvas, but sit outside the time scale.
  const noRun = rows.filter(row => !byTask.has(row.taskId));
  const zoneOf = (row: LensRow): 'gate' | 'future' | 'unknown' => row.taskKind === 'gate' ? 'gate'
    : row.intent === 'plan_only' || row.disposition === 'deferred' ? 'future' : 'unknown';
  // Untimed classification keeps its real meaning: pending/time-unknown first,
  // then acceptance, then future. The raw id/phase stay in the title/data.
  const zones = [
    { key: 'unknown' as const, title: '执行时间未加载或未记录' },
    { key: 'gate' as const, title: '验收节点 · 未记录执行时间' },
    { key: 'future' as const, title: '未来意图 · 未分配时间' },
  ];
  const positions = new Map(placed.map(item => [item.row.taskId, { x: xOf(item.lane), y: yOf(item.startMs) }]));
  // The no-time regions are compact: a tight label row plus one 56px row per
  // member, with no reserved blank band. The timed axis above keeps its existing
  // focus/zoom and parallel-lane placement untouched.
  let zoneTop = placed.length > 0 ? height + 20 : 20;
  const zoneLabels: string[] = [];
  for (const zone of zones) {
    const members = noRun.filter(row => zoneOf(row) === zone.key);
    if (members.length === 0) continue;
    zoneLabels.push(`<div class="q-untimed-label" style="position:absolute;left:20px;top:${zoneTop}px">${escapeHtml(zone.title)}</div>`);
    const columns = Math.max(1, Math.floor((width - 40) / 180));
    members.forEach((row, index) => positions.set(row.taskId, {
      x: 100 + (index % columns) * 180,
      y: zoneTop + 34 + Math.floor(index / columns) * 56,
    }));
    zoneTop += 40 + Math.ceil(members.length / columns) * 56;
  }
  const canvasHeight = Math.max(placed.length > 0 ? height : 0, zoneTop + 8);
  const edges = edgeMode === 'dependency'
    ? plan.executionDag.dependsOn.map(edge => ({ from: edge.dependsOnId, to: edge.taskId }))
    : plan.taskHierarchy.parentOf.map(edge => ({ from: edge.parentTaskId, to: edge.childTaskId }));
  const edgePaths = edges.flatMap(edge => {
    const from = positions.get(edge.from); const to = positions.get(edge.to);
    if (from === undefined || to === undefined) return [];
    return [`<path d="M ${from.x} ${from.y + 9} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y - 9}"/>`];
  }).join('');
  const barHtml = placed.flatMap(item => {
    const segments = byTask.get(item.row.taskId) ?? [];
    return segments.map(segment => {
      const top = yOf(segment.startMs); const bottom = Math.max(top + 2, yOf(segment.endMs));
      return `<div class="q-runbar${segment.running ? ' running' : ''}" title="${segment.running ? '执行中，尚无结束时间；延伸至当前显示窗口边界' : '已记录执行区间'}" style="left:${xOf(item.lane)}px;top:${top}px;height:${bottom - top}px" aria-hidden="true"></div>`;
    });
  }).join('');
  const nodeHtml = [...placed, ...noRun.map(row => ({ row, lane: 0, startMs: minMs, endMs: minMs }))].map(item => {
    const point = positions.get(item.row.taskId) ?? { x: xOf(item.lane), y: yOf(item.startMs) };
    const isPinned = pinned.has(item.row.taskId);
    const selected = selectedId === item.row.taskId;
    const isRoot = !parentOf.has(item.row.taskId);
    const isRunning = item.row.phase === 'running' || activeRunTasks.has(item.row.taskId);
    const nearFocus = byTask.has(item.row.taskId) && Math.abs(point.y - focusY) < 64;
    const showLabel = isPinned || selected || isRoot || isRunning || nearFocus || !byTask.has(item.row.taskId);
    return `<button class="q-graphnode${selected ? ' selected' : ''}${isPinned ? ' q-pinned' : ''}"`
      + ` data-node="${escapeHtml(item.row.taskId)}" style="left:${point.x}px;top:${point.y}px"`
      + ` data-action="select-node" data-target-kind="task" data-project-id="${escapeHtml(plan.goalRef.projectId)}"`
      + ` data-goal-id="${escapeHtml(plan.goalRef.goalId)}" data-task-id="${escapeHtml(item.row.taskId)}"`
      + ` aria-pressed="${String(selected || isPinned)}" title="${escapeHtml(labelFor(item.row))}">`
      + `<span class="q-orb${isRunning ? ' active' : ''}"></span>`
      + `<span class="q-nodelabel${showLabel ? '' : ' q-compact-label'}">${escapeHtml(item.row.title)}<small>${escapeHtml(`${item.row.intent === 'plan_only' || item.row.disposition === 'deferred' ? '未来意图' : `${item.row.taskKind === 'gate' ? '验收 · ' : ''}${TASK_PHASE_LABEL[item.row.phase] ?? item.row.phase}`}`)}</small></span>`
      + `</button>`;
  }).join('');
  const runSummary = page?.nextCursor == null
    ? `已载执行记录 ${executions.length} 条`
    : `已载执行记录 ${executions.length} 条（还有更多页，未判断不存在）`;
  const canvas = `<div class="q-graph-layout"><div class="q-graph-scroll"><div class="q-graph" style="width:${width}px;height:${canvasHeight}px" role="group" aria-label="任务结构：时间焦点与无时间节点">`
    + `<svg class="q-edges" viewBox="0 0 ${width} ${canvasHeight}" preserveAspectRatio="none" aria-hidden="true">${edgePaths}</svg>`
    + zoneLabels.join('') + barHtml + nodeHtml
    + (placed.length === 0 ? '' : `<div class="q-focus-band" style="top:${Math.max(0, focusY - 44)}px" aria-hidden="true"></div>`)
    + `</div></div>`
    + (placed.length === 0 ? '' : `<div class="q-vertical-lens" data-view="task-lens"><span>早</span>`
      + `<input type="range" min="0" max="1" step="0.01" value="${focus}" data-field="timelineFocus" aria-label="连续纵向放大镜">`
      + `<span>晚</span></div>`)
    + `</div>`;
  const relations = ('taskRelations' in plan ? plan.taskRelations ?? [] : []).map(relation =>
    `<li>${escapeHtml(relation.kind)}: ${escapeHtml(relation.fromTaskId)} → ${escapeHtml(relation.toTaskId)} `
    + `<span class="muted">${escapeHtml(relation.note)}</span></li>`).join('');
  return `<section class="panel" data-view="task-structure">`
    + `<div class="q-graphbar" data-view="task-structure-lens">`
    + `<button data-action="set-graph-edges" data-edges="hierarchy" aria-pressed="${String(edgeMode === 'hierarchy')}">包含结构</button>`
    + `<button data-action="set-graph-edges" data-edges="dependency" aria-pressed="${String(edgeMode === 'dependency')}">执行依赖</button>`
    + `</div>`
    + canvas
    + `<details class="q-fold"><summary>图信息</summary><p>${escapeHtml(runSummary)} · ${rows.length} 个任务</p><p>计划 ${escapeHtml(plan.ref.planId)} · 版本 ${escapeHtml(plan.planRevision)}</p></details>`
    + `<details class="q-fold"><summary class="cursor-interaction"><span class="q-chevron">›</span>协作关系（advisory）</summary>`
    + (relations.length === 0 ? '<p class="muted">没有记录协作关系</p>' : `<ul>${relations}</ul>`) + `</details>`
    + `</section>`;
}


export function renderWorkLinkTarget(target: WorkLinkTarget): string {
  let label: string;
  let identity: string;
  let data: string;
  if (target.kind === 'task') {
    label = '任务';
    identity = `项目 <code>${escapeHtml(target.ref.projectId)}</code> · 目标 <code>${escapeHtml(target.ref.goalId)}</code>`
      + ` · 任务 <code>${escapeHtml(target.ref.taskId)}</code>`;
    data = `data-project-id="${escapeHtml(target.ref.projectId)}" data-goal-id="${escapeHtml(target.ref.goalId)}"`
      + ` data-task-id="${escapeHtml(target.ref.taskId)}"`;
  } else if (target.kind === 'module') {
    label = '模块';
    identity = `项目 <code>${escapeHtml(target.ref.projectId)}</code> · 模块 <code>${escapeHtml(target.ref.moduleId)}</code>`;
    data = `data-project-id="${escapeHtml(target.ref.projectId)}" data-module-id="${escapeHtml(target.ref.moduleId)}"`;
  } else {
    label = '工作';
    identity = `工作 <code>${escapeHtml(target.ref.workId)}</code>`
      + ` · 项目 <code>${escapeHtml(target.ref.projectId)}</code>`
      + ` · 工作区 <code>${escapeHtml(target.ref.workspaceId)}</code>`;
    data = `data-project-id="${escapeHtml(target.ref.projectId)}"`
      + ` data-workspace-id="${escapeHtml(target.ref.workspaceId)}" data-work-id="${escapeHtml(target.ref.workId)}"`;
  }
  return `<section class="panel work-link" data-work-link="${escapeHtml(target.kind)}" ${data}>`
    + `<p>关联${label}：${identity}</p>`
    + detailsFor('查看完整引用', `<pre>${escapeHtml(JSON.stringify(target.ref, null, 2))}</pre>`)
    + `<button data-action="find-sessions" data-target-kind="${escapeHtml(target.kind)}" ${data}>`
    + `查看关联会话</button></section>`;
}


// ---------------------------------------------------------------------------
// R6 execution entry: display of the trusted execution projection and of the
// real Query / initial-Plan / Workflow receipts. These are PURE display: they
// never send a request, never reduce a receipt to "completed" and never invent
// an answer, a source or a continuation. The continuation seam below forwards
// only a real owner `next` (with its original input) or reports a real stop.
// ---------------------------------------------------------------------------

const EXECUTION_STATE_TEXT: Record<'advance' | 'waiting' | 'completed', string> = {
  advance: '下一步已就绪', waiting: '等待中', completed: '正式完成',
};

/** Narrow a result union to its ready variant for the continuation input types. */
type ExecutionReady<T> = Extract<T, { status: 'ready' }>;
type InitialPlanningContinuationInput =
  Extract<NonNullable<ExecutionReady<InitialPlanningGoalInputResult>['value']['next']>, { kind: 'goal_input' }>['input'];
type WorkflowContinuationInput = NonNullable<ExecutionReady<WorkflowAdvanceResult>['value']['next']>;

export type ExecutionContinuation =
  | { status: 'next'; route: 'workflow/goal-input'; input: InitialPlanningContinuationInput }
  | { status: 'next'; route: 'workflow/advance'; input: WorkflowContinuationInput }
  | { status: 'stop'; reason: string | null }
  | CoreRejection;

/** The production continuation seam: a real `next` is forwarded with its exact
 * original input and its owning route, while a null `next` (waiting/completed)
 * is a real stop. A rejected owner result is preserved unchanged. The seam never
 * fabricates a request, never re-derives an identity and never marks a result
 * complete. */
export function planExecutionContinuation(
  result: WorkflowAdvanceResult | InitialPlanningGoalInputResult,
): ExecutionContinuation {
  if (result.status === 'rejected') return result;
  const value = result.value;
  const next = value.next;
  if (next === null) return { status: 'stop', reason: 'reason' in value ? value.reason : null };
  if (next.kind === 'goal_input') return { status: 'next', route: 'workflow/goal-input', input: next.input };
  if (next.kind === 'work') return { status: 'next', route: 'workflow/advance', input: next.input };
  return { status: 'next', route: 'workflow/advance', input: next };
}

function originalRequestHtml(originalRequest: unknown): string {
  if (originalRequest === undefined) return '';
  return detailsFor('已发送的完整原请求', `<pre>${escapeHtml(JSON.stringify(originalRequest, null, 2))}</pre>`);
}

/** Trusted execution configuration selection. It shows only the safe projection
 * fields and states that the formal RoleBinding/budget are still owner-checked;
 * it grants nothing and never names an environment variable, secret or model. */
export function renderExecutionProfiles(execution: BootstrapExecution, selectedId?: string, disabled = false): string {
  if (execution.queryProfiles.length === 0)
    return `<section class="panel gap" data-view="execution-profiles"><h3>执行配置</h3>`
      + `<p>没有配置可用的只读调查 profile；模型入口明确未配置，其余页面保持可用。</p></section>`;
  const options = execution.queryProfiles.map(profile =>
    `<option value="${escapeHtml(profile.id)}"${profile.id === selectedId ? ' selected' : ''}`
    + ` data-profile-id="${escapeHtml(profile.id)}"`
    + ` data-scope="${escapeHtml(`${profile.scope.projectId}/${profile.scope.workspaceId}`)}">${escapeHtml(profile.label)}</option>`).join('');
  // The default row keeps only the chosen configuration name; the internal
  // scope/consumer/Role/budget references live in a collapsed detail.
  const rows = execution.queryProfiles.map(profile =>
    `<li data-profile="${escapeHtml(profile.id)}"><strong>${escapeHtml(profile.label)}</strong>`
    + detailsFor('配置详情（范围 / consumer / 角色 / 预算）', `<pre>${escapeHtml(JSON.stringify({
      scope: profile.scope, consumerId: profile.consumerId,
      sessionRole: profile.sessionRole, roleBinding: profile.roleBinding,
      runtimeBudget: profile.runtimeBudget, budget: profile.budget,
    }, null, 2))}</pre><p class="muted">这些正式引用仍由 Host/owner 复核；投影不授予领域许可。</p>`)
    + `</li>`).join('');
  const scopes = execution.workflowScopes.length === 0 ? '<p class="muted">没有配置 Workflow 推进范围</p>'
    : detailsFor('Workflow 推进范围', `<pre>${escapeHtml(JSON.stringify(execution.workflowScopes, null, 2))}</pre>`);
  return `<section class="panel" data-view="execution-profiles"><header><h3>执行配置</h3></header>`
    + `<label>只读调查 profile <select data-action="select-query-profile">${options}</select></label>`
    + `<button data-action="run-investigation"${disabled ? ' disabled' : ''}>调查</button>`
    + `<button data-action="run-planning"${disabled ? ' disabled' : ''}>规划并执行</button>`
    + `<ul class="profiles">${rows}</ul>${scopes}</section>`;
}

/** The official answer. `body` is the real `materials/open` read of the answer's
 * `bodyRef` with `historical_explanation`; the ref alone is never shown as text. */
export function renderQueryAnswer(answer: ReadResult<QueryJobAnswerSnapshot>, body?: ReadResult<ArtifactRecord>): string {
  if (answer.status === 'rejected') return rejectionPanel(answer);
  if (answer.status === 'not_found') return renderGap('queries/answer', '该调查还没有正式回答');
  if (answer.status === 'not_ready') return renderGap('queries/answer', '回答尚未就绪');
  const value = answer.value;
  const sourceCount = value.answer.sources.length;
  const sources = sourceCount === 0 ? '<p class="muted">没有记录来源</p>'
    : `<ul class="answer-sources">${value.answer.sources.map(source =>
      `<li data-source="${escapeHtml(source.refKey)}"><code>${escapeHtml(source.kind)}</code> `
      + `${escapeHtml(source.label ?? '')} <span class="muted">@${escapeHtml(source.version ?? 'unknown')}</span></li>`).join('')}</ul>`;
  const stale = value.answer.stale
    ? `<p class="stale" data-answer-stale="true">来源已过期：${escapeHtml(value.answer.staleReason ?? '')}</p>` : '';
  let bodyHtml: string;
  if (body === undefined) bodyHtml = '<p class="muted">正文尚未读取</p>';
  else if (body.status === 'ready') bodyHtml = `<pre data-answer-body>${escapeHtml(body.value.body)}</pre>`;
  else if (body.status === 'not_found') bodyHtml = '<p class="muted">回答正文工件不存在</p>';
  else if (body.status === 'not_ready') bodyHtml = '<p class="muted">回答正文尚未就绪</p>';
  else bodyHtml = rejectionPanel(body);
  // The default view stays short: received/status/source count/stale. The full
  // original answer, every source and the read body stay available expanded and
  // every field is preserved, unfiltered.
  return `<section class="panel" data-view="query-answer" data-answer="${escapeHtml(value.answer.answerId)}">`
    + `<header><h3>原回答</h3><p class="muted">已收到正式回答 · round ${escapeHtml(value.answer.roundIndex)} · `
    + `<span data-answer-status>${value.answer.stale ? 'stale' : 'settled'}</span> · `
    + `来源 ${escapeHtml(sourceCount)} 条</p></header>`
    + stale
    + detailsFor('完整原回答', `<pre>${escapeHtml(value.answer.answer)}</pre>`)
    + detailsFor('回答来源', sources)
    + detailsFor('回答正文引用', `<p>bodyRef <code>${escapeHtml(JSON.stringify(value.answer.bodyRef))}</code></p>`)
    + detailsFor('回答正文', bodyHtml)
    + detailsFor('完整回答记录', `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`)
    + `</section>`;
}

/** The real Workflow advancement result. `waiting`/`completed` keep their own
 * state and never show as success; a `next` is shown as the complete original
 * request, never flattened. */
export function renderWorkflowAdvance(result: WorkflowAdvanceResult, originalRequest?: unknown): string {
  if (result.status === 'rejected')
    return `<section class="panel rejected" data-view="workflow-advance" data-state="rejected">`
      + rejectionPanel(result) + originalRequestHtml(originalRequest) + `</section>`;
  const value = result.value;
  const receipt = value.receipt === null ? '<p class="muted">没有调用 owner</p>'
    : `<p>回执 <code data-receipt-kind="${escapeHtml(value.receipt.kind)}">${escapeHtml(value.receipt.kind)}</code></p>`
      + detailsFor('完整回执', `<pre>${escapeHtml(JSON.stringify(value.receipt.result, null, 2))}</pre>`);
  const next = value.next === null ? '<p class="muted">没有下一步</p>'
    : detailsFor('下一步原请求', `<pre>${escapeHtml(JSON.stringify(value.next, null, 2))}</pre>`);
  return `<section class="panel" data-view="workflow-advance" data-state="${escapeHtml(value.state)}">`
    + `<header><h3>执行推进</h3><p>${escapeHtml(EXECUTION_STATE_TEXT[value.state])}</p></header>`
    + (value.reason === null ? '' : `<p class="muted">${escapeHtml(value.reason)}</p>`)
    + receipt + next + originalRequestHtml(originalRequest) + `</section>`;
}

/** The initial-planning/answer handoff. The real state and `next.kind` are
 * preserved; the candidate/adoption receipt is never upgraded to completed. */
export function renderInitialPlanning(result: InitialPlanningGoalInputResult, originalRequest?: unknown): string {
  if (result.status === 'rejected')
    return `<section class="panel rejected" data-view="initial-planning" data-state="rejected">`
      + rejectionPanel(result) + originalRequestHtml(originalRequest) + `</section>`;
  const value = result.value;
  const nextKind = value.next === null ? 'none' : value.next.kind;
  const next = value.next === null ? '<p class="muted">没有下一步</p>'
    : detailsFor('下一步原请求', `<pre>${escapeHtml(JSON.stringify(value.next.input, null, 2))}</pre>`);
  return `<section class="panel" data-view="initial-planning" data-state="${escapeHtml(value.state)}"`
    + ` data-next-kind="${escapeHtml(nextKind)}"><header><h3>初始规划</h3><p>${escapeHtml({ proposed: '候选待采用', needs_decision: '需要补充决定', advance: '已采用，可以执行', waiting: '等待处理' }[value.state])}</p></header>`
    + (value.receipt.status === 'rejected' ? rejectionPanel(value.receipt) : '')
    + detailsFor('候选/采用回执', `<pre>${escapeHtml(JSON.stringify(value.receipt, null, 2))}</pre>`)
    + next + originalRequestHtml(originalRequest) + `</section>`;
}

// ---------------------------------------------------------------------------
// MVP UI connection: pure renderers.
//
// Everything below is still pure text presentation over the exact public DTOs.
// No DOM, no network, no fabricated timestamp, diff, receipt or completion. The
// MVP flows (new Goal, member mail, Kernel file CAS, command handles and the two
// execution-backed graphs) mount these functions from `main.ts`.
// ---------------------------------------------------------------------------

/** One plotted Run on the real execution timeline. The key uses the complete
 * typed RunRef, never a bare runId, so two Goals never collide. */
export type TaskTimelineDisplay = {
  /** Strictly-monotonic vertical lens: normalized focus in [0,1] and a window. */
  focus: number;
  zoom: number;
  pinned: string[];
  selected: string | null;
};

export const taskTimelineRunKey = (run: RunRef): string =>
  `run:${run.projectId}:${run.goalId}:${run.runId}`;

type TimelinePlaced = {
  record: TaskExecutionRecord;
  key: string;
  lane: number;
  startMs: number;
  endMs: number;
  running: boolean;
};

const MS = (value: string | null): number | null => {
  if (value === null || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Strictly monotonic lens over the normalized [0,1] time window. `tanh` is
 * strictly increasing, so the mapped order is identical to the real event
 * order: no crossing, no reordering, no fabricated timestamp. */
function lensMap(u: number, focus: number, zoom: number): number {
  const span = Math.max(0.02, Math.min(1, zoom));
  const hi = Math.tanh((1 - focus) / span);
  const lo = Math.tanh((0 - focus) / span);
  const here = Math.tanh((u - focus) / span);
  if (hi - lo === 0) return u;
  return 0.2 * u + 0.8 * (here - lo) / (hi - lo);
}

function timelineInterval(lane: number, laneCount: number): { left: string; width: string } {
  const slot = 100 / Math.max(1, laneCount);
  return { left: `${lane * slot}%`, width: `${Math.max(4, slot - 3)}%` };
}

/** Real Run timeline. Only `run.startedAt`/`run.endedAt` are used; a Run with
 * no `startedAt` is never plotted at a guessed time and is listed separately as
 * time-unknown. A running Run is marked and has no invented end time. */
export function renderTaskExecutionTimeline(
  page: { items: TaskExecutionRecord[]; nextCursor: string | null; readThrough?: unknown },
  display?: TaskTimelineDisplay,
  tasks?: readonly TaskRow[],
): string {
  const items = page.items;

  const known = items
    .map(record => ({ record, startMs: MS(record.run.startedAt), endMs: MS(record.run.endedAt) }))
    .filter((entry): entry is { record: TaskExecutionRecord; startMs: number; endMs: number | null } => entry.startMs !== null);
  const unknown = items.filter(entry => MS(entry.run.startedAt) === null);
  const minMs = known.length === 0 ? 0 : Math.min(...known.map(entry => entry.startMs));
  const maxKnown = known
    .map(entry => entry.endMs)
    .filter((value): value is number => value !== null);
  const maxMs = Math.max(minMs + 1, ...known.map(entry => entry.startMs), ...maxKnown);
  const span = Math.max(1, maxMs - minMs);
  const places: TimelinePlaced[] = [];
  // Global interval partitioning: overlapping real intervals are placed in
  // separate columns, and no bar is moved in time to make it fit.
  const sorted = [...known].sort((a, b) => a.startMs - b.startMs);
  const laneEnds: number[] = [];
  for (const entry of sorted) {
    const end = entry.endMs ?? maxMs;
    let lane = laneEnds.findIndex(last => last <= entry.startMs);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(entry.endMs ?? Infinity); } else laneEnds[lane] = entry.endMs ?? Infinity;
    const running = entry.record.run.status !== 'ended';
    places.push({ record: entry.record, key: taskTimelineRunKey(entry.record.run.ref), lane,
      startMs: entry.startMs, endMs: end, running });
  }
  const laneCount = Math.max(1, laneEnds.length);
  const focus = display?.focus ?? 0.5;
  const zoom = display?.zoom ?? 0.5;
  const pinned = new Set(display?.pinned ?? []);
  const selected = display?.selected ?? null;
  const bars = places.map(place => {
    const u1 = (place.startMs - minMs) / span;
    const u2 = (place.endMs - minMs) / span;
    const top = lensMap(Math.min(u1, u2), focus, zoom) * 100;
    const bottom = lensMap(Math.max(u1, u2), focus, zoom) * 100;
    const slot = timelineInterval(place.lane, laneCount);
    const ref = place.record.run.ref;
    const task = place.record.run.task;
    const isSelected = selected !== null && selected === place.key;
    const isPinned = pinned.has(place.key);
    const label = `${task.taskId} · ${place.record.run.status}`
      + (place.record.run.outcome === null ? '' : ` / ${place.record.run.outcome}`);
    const state = place.running ? '执行中' : (place.record.run.outcome ?? place.record.run.status);
    return `<button class="timeline-run${isSelected ? ' selected' : ''}${isPinned ? ' pinned' : ''}${place.running ? ' running' : ''}"`
      + ` style="top:${top.toFixed(3)}%;height:${Math.max(1.5, bottom - top).toFixed(3)}%;left:${slot.left};width:${slot.width}"`
      + ` data-action="open-execution-history" data-timeline-run="${escapeHtml(place.key)}"`
      + ` data-aggregate-type="${escapeHtml(ref.aggregateType)}" data-project-id="${escapeHtml(ref.projectId)}"`
      + ` data-goal-id="${escapeHtml(ref.goalId)}" data-run-id="${escapeHtml(ref.runId)}"`
      + ` data-task-id="${escapeHtml(task.taskId)}" title="${escapeHtml(label)}">`
      + `<span class="timeline-run-label">${escapeHtml(task.taskId)} · ${escapeHtml(state)}${place.running ? ' \u25b6' : ''}`
      + (place.running ? '<small>无结束时间</small>' : '') + `</span></button>`;
  }).join('');
  const unknownRows = unknown.map(entry => {
    const ref = entry.run.ref;
    const task = entry.run.task;
    const running = entry.run.status !== 'ended';
    return `<li data-timeline-unknown="${escapeHtml(taskTimelineRunKey(ref))}">`
      + `<button class="link" data-action="open-execution-history"`
      + ` data-aggregate-type="${escapeHtml(ref.aggregateType)}" data-project-id="${escapeHtml(ref.projectId)}"`
      + ` data-goal-id="${escapeHtml(ref.goalId)}" data-run-id="${escapeHtml(ref.runId)}"`
      + ` data-task-id="${escapeHtml(task.taskId)}">`
      + `打开 ${escapeHtml(task.taskId)} · ${escapeHtml(ref.runId)}</button> `
      + `<span class="muted">${running ? '正在执行 · ' : ''}未记录开始时间，不按猜测时间绘制</span></li>`;
  }).join('');
  return `<section class="panel" data-view="task-timeline" data-runs="${escapeHtml(items.length)}">`
    + `<header><h3>执行时间线</h3>`
    + `<p class="muted">真实 Run 起止 · 重叠区间分列 · 时间自上而下 · 连续纵向镜保持事件顺序</p>`
    + detailsFor('查看读取水位', `<p>nextCursor ${escapeHtml(page.nextCursor ?? 'none')}</p>`
      + `<p>readThrough ${escapeHtml(JSON.stringify(page.readThrough ?? null))}</p>`)
    + `</header>`
    + `<div class="timeline-lens" role="group" aria-label="时间线纵向放大镜">`
    + `<span>早</span><input type="range" data-field="timelineFocus" min="0" max="1" step="0.01" value="${focus}" aria-label="时间线焦点">`
    + `<span>晚</span><input type="range" data-field="timelineZoom" min="0.05" max="1" step="0.01" value="${zoom}" aria-label="时间线缩放">`
    + `</div>`
    + `<div class="timeline-track" role="list">${bars}</div>`
    + `<section data-timeline="unknown"><h4>时间未知</h4>`
    + (unknown.length === 0 ? '<p class="muted">没有缺少开始时间的 Run。</p>' : `<ul>${unknownRows}</ul>`)
     + `<p class="muted">缺少 startedAt 的 Run 单独列出，不占用时间轴，也不生成时间戳。</p></section>`
    + `<section data-timeline="future"><h4>尚无已加载执行记录的任务</h4><ul>`
    + (tasks ?? []).filter(task => !items.some(item => item.run.task.taskId === task.ref.taskId))
      .map(task => `<li>${escapeHtml(task.definition.title || task.ref.taskId)} · ${escapeHtml(task.effectivePhase)}${task.execution === null ? ' · 尚无当前执行' : ' · 执行记录尚未加载'}</li>`).join('')
    + `</ul><p class="muted">未来意图不生成时间戳；分页未加载不等于从未执行。</p></section></section>`;
}

/** Task folding built from the SAME listExecutions page items and Run keys as
 * the timeline. Each group opens the original execution window through the one
 * `open-execution-history` entry; no history fact is copied or re-derived. */
export function renderTaskExecutionFold(
  page: { items: TaskExecutionRecord[]; nextCursor: string | null; readThrough?: unknown },
): string {
  if (page.items.length === 0) return '<p class="muted">没有可折叠的真实执行。</p>';
  const groups = new Map<string, TaskExecutionRecord[]>();
  for (const record of page.items) {
    const taskId = record.run.task.taskId;
    const bucket = groups.get(taskId);
    if (bucket === undefined) groups.set(taskId, [record]); else bucket.push(record);
  }
  const sections = [...groups.entries()].map(([taskId, records]) => {
    const rows = records.map(record => {
      const ref = record.run.ref;
      const running = record.run.status !== 'ended';
      const start = record.run.startedAt ?? '未记录开始时间';
      const end = record.run.endedAt ?? (running ? '进行中' : '未记录结束时间');
      return `<li><button class="link" data-action="open-execution-history"`
        + ` data-aggregate-type="${escapeHtml(ref.aggregateType)}" data-project-id="${escapeHtml(ref.projectId)}"`
        + ` data-goal-id="${escapeHtml(ref.goalId)}" data-run-id="${escapeHtml(ref.runId)}"`
        + ` data-task-id="${escapeHtml(taskId)}">Run ${escapeHtml(ref.runId)}</button>`
        + ` <span class="muted">${escapeHtml(record.run.status)} · ${escapeHtml(String(start))} \u2192 ${escapeHtml(String(end))}`
        + `${record.run.outcome === null ? '' : ` · ${escapeHtml(record.run.outcome)}`}</span></li>`;
    }).join('');
    return `<details class="task-fold" data-task-fold="${escapeHtml(taskId)}"><summary>`
      + `<code>${escapeHtml(taskId)}</code> · ${records.length} 次执行</summary><ul>${rows}</ul></details>`;
  }).join('');
  return `<div class="task-fold-list" data-view="task-fold">${sections}</div>`;
}

export type ArchitectureContainmentDisplay = {
  activeModuleIds: string[];
  expanded: string[];
  pinned: string[];
  selected: string | null;
};

/** Formal containment tree. Containment comes ONLY from
 * `catalog.catalog.containment.parentOf`; a missing `containment` is a real
 * "not declared" gap and paths/dependencies are never used to infer a parent.
 * Active modules expand the union of their ancestor paths (and their siblings),
 * manual branches stay open and pinned nodes keep their ancestors open. */
export function renderArchitectureContainment(
  result: ReadResult<ArchitectureRevision>,
  display?: ArchitectureContainmentDisplay,
): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('architecture/read', '没有已采用的架构 baseline');
  if (result.status === 'not_ready') return renderGap('architecture/read', '采用架构尚未就绪');
  const revision = result.value;
  if (revision.catalog === null) {
    return `<section class="panel" data-view="architecture-containment"><h3>架构包含结构</h3>`
      + `<p class="muted">该 baseline 早于 catalog，未记录模块包含关系。</p></section>`;
  }
  const modules = revision.catalog.catalog.modules;
  const containment = revision.catalog.catalog.containment;
  // A missing containment declaration is not a guessed tree: an empty relation
  // set makes every declared module a real parallel root on the SAME roots/graph
  // path. Dependencies and paths never become edges.
  const parentOf = containment?.parentOf ?? [];
  const moduleById = new Map(modules.map(module => [module.ref.moduleId, module]));
  const children = new Map<string, string[]>();
  const parent = new Map<string, string>();
  for (const edge of parentOf) {
    const parentId = edge.parent.moduleId;
    const childId = edge.child.moduleId;
    if (!moduleById.has(parentId) || !moduleById.has(childId)) continue;
    const bucket = children.get(parentId);
    if (bucket === undefined) children.set(parentId, [childId]); else bucket.push(childId);
    parent.set(childId, parentId);
  }
  const roots = modules.filter(module => !parent.has(module.ref.moduleId)).map(module => module.ref.moduleId);
  const active = new Set(display?.activeModuleIds ?? []);
  const manualExpanded = new Set(display?.expanded ?? []);
  const pinned = new Set(display?.pinned ?? []);
  const requiredOpen = new Set<string>(manualExpanded);
  const markAncestors = (moduleId: string): void => {
    let current = parent.get(moduleId);
    let guard = 0;
    while (current !== undefined && guard < 256) { requiredOpen.add(current); current = parent.get(current); guard += 1; }
  };
  for (const moduleId of active) markAncestors(moduleId);
  for (const moduleId of pinned) markAncestors(moduleId);
  const visible = new Set<string>();
  const visit = (moduleId: string): void => {
    visible.add(moduleId);
    if (requiredOpen.has(moduleId)) for (const child of children.get(moduleId) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  const graph = renderNodeLinkGraph(modules.filter(module => visible.has(module.ref.moduleId)).map(module => ({
    id: module.ref.moduleId, label: module.name,
    caption: active.has(module.ref.moduleId) ? '工作中' : '已采用模块',
    action: 'select-node',
    data: { 'target-kind': 'module', 'project-id': module.ref.projectId, 'module-id': module.ref.moduleId },
    title: `${module.name}（${module.ref.moduleId}）\n${module.responsibility}`,
    ...((children.get(module.ref.moduleId)?.length ?? 0) > 0 ? { branch: { expanded: requiredOpen.has(module.ref.moduleId) } } : {}),
  })), parentOf.filter(edge => visible.has(edge.parent.moduleId) && visible.has(edge.child.moduleId))
    .map(edge => ({ from: edge.parent.moduleId, to: edge.child.moduleId })), '架构包含结构图',
    { pinned: [...pinned],
      labels: [...new Set([...roots, ...active, ...requiredOpen, ...[...requiredOpen].flatMap(id => children.get(id) ?? []), ...pinned, ...(display?.selected !== null && display?.selected !== undefined ? [display.selected] : [])])],
      selected: display?.selected !== undefined && display.selected !== null && moduleById.has(display.selected)
        ? { kind: 'module', nodeId: display.selected, target: { kind: 'module', ref: moduleById.get(display.selected)!.ref } } : null });
  return `<section class="panel" data-view="architecture-containment">`
    + (containment === undefined
      ? detailsFor('未声明包含关系（containment）',
        `<p class="muted">该修订未声明包含关系；包含结构不从 paths 或 dependencies 推断，以上为真实并列根模块。</p>`)
      : '')
    + graph
    + detailsFor('图信息与显示选项', `<p>${modules.length} 个模块 · 活跃 ${active.size}</p>`
      + `<button data-action="expand-active-paths">展开活跃路径</button>`
      + `<button data-action="collapse-branches">收起手动分支</button>`
      + `<p>基线 ${escapeHtml(revision.baseline.baselineId)} · 版本 ${escapeHtml(revision.baseline.revision)}</p>`)
    + `</section>`;
}

/** The independent dependency DAG. It reads only `catalog.dependencies` and is
 * never derived from containment or paths. */
export function renderArchitectureDependencies(
  result: ReadResult<ArchitectureRevision>, display?: WorkbenchGraphDisplay,
): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('architecture/read', '没有已采用的架构 baseline');
  if (result.status === 'not_ready') return renderGap('architecture/read', '采用架构尚未就绪');
  const revision = result.value;
  if (revision.catalog === null) return `<section class="panel" data-view="architecture-dependencies"><h3>模块依赖 DAG</h3><p class="muted">该 baseline 早于 catalog，未记录依赖。</p></section>`;
  const modules = revision.catalog.catalog.modules;
  const dependencies = revision.catalog.catalog.dependencies;
  const html = renderNodeLinkGraph(
    modules.map(module => ({
      id: `dep:${module.ref.moduleId}`,
      label: module.name,
      caption: '已采用模块',
      action: 'select-node',
      data: { 'target-kind': 'module', 'project-id': module.ref.projectId, 'module-id': module.ref.moduleId,
        'node-label': module.name, 'node-detail': module.responsibility },
      title: `${module.name}（${module.ref.moduleId}）`,
    })),
    dependencies.map(dependency => ({ from: `dep:${dependency.from.moduleId}`, to: `dep:${dependency.to.moduleId}`, label: dependency.reason })),
    '模块依赖 DAG', display,
  );
  const edges = dependencies.map(dependency =>
    `<li>${escapeHtml(dependency.from.moduleId)} \u2192 ${escapeHtml(dependency.to.moduleId)} `
    + `<span class="muted">${escapeHtml(dependency.reason)}</span></li>`).join('');
  return `<section class="panel" data-view="architecture-dependencies">`
    + html + (edges.length === 0 ? '<p class="muted">没有声明依赖</p>' : detailsFor('依赖依据', `<ul class="edges">${edges}</ul>`)) + `</section>`;
}

// --- File save / compare (real Kernel CAS) -----------------------------------

/** Real CAS save receipt. A rejection is shown honestly and the draft stays. */
export function renderFileSave(result: WorkspaceResult<SaveWorkbenchFileResult> | null, draftChanged: boolean): string {
  if (result === null) {
    return `<p class="muted" data-save-state="idle">${draftChanged ? '有未保存草稿。保存时会核对磁盘版本。' : '与已读取版本一致，尚无待保存内容。'}</p>`;
  }
  if (result.status !== 'ready') {
    return `<div data-save-state="rejected"><p>保存未完成（${escapeHtml(result.code)}）：${escapeHtml(result.reason)}</p>`
      + `<p class="muted">草稿保留在内存；不会自动覆盖。可重新读取当前版本并比较后再保存。</p></div>`;
  }
  return `<div data-save-state="saved"><p>已保存 <code>${escapeHtml(result.value.path)}</code>`
    + ` · 新版本 <code>${escapeHtml(result.value.revision)}</code>`
    + (result.value.oldRevision === null ? ' · 新建' : ` · 原版本 <code>${escapeHtml(result.value.oldRevision)}</code>`) + `</p></div>`;
}

/** One computed line diff. Lines come from the two real read bodies, so the
 * result is derived, never a fabricated example diff. */
export function renderTextDiff(before: string, after: string, path: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const limit = 1200;
  const a = beforeLines.slice(0, limit);
  const b = afterLines.slice(0, limit);
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? (table[i + 1]![j + 1]! + 1) : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const rows: string[] = [];
  let i = 0; let j = 0;
  let beforeNo = 1; let afterNo = 1;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push(`<div class="diff-line context"><span class="ln">${beforeNo}</span><span class="ln">${afterNo}</span><code>${escapeHtml(a[i]!)}</code></div>`);
      i += 1; j += 1; beforeNo += 1; afterNo += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      rows.push(`<div class="diff-line removed"><span class="ln">${beforeNo}</span><span class="ln"></span><code>${escapeHtml(a[i]!)}</code></div>`);
      i += 1; beforeNo += 1;
    } else {
      rows.push(`<div class="diff-line added"><span class="ln"></span><span class="ln">${afterNo}</span><code>${escapeHtml(b[j]!)}</code></div>`);
      j += 1; afterNo += 1;
    }
    if (rows.length >= 6000) break;
  }
  while (i < a.length) { rows.push(`<div class="diff-line removed"><span class="ln">${beforeNo}</span><span class="ln"></span><code>${escapeHtml(a[i]!)}</code></div>`); i += 1; beforeNo += 1; }
  while (j < b.length) { rows.push(`<div class="diff-line added"><span class="ln"></span><span class="ln">${afterNo}</span><code>${escapeHtml(b[j]!)}</code></div>`); j += 1; afterNo += 1; }
  const truncated = beforeLines.length > limit || afterLines.length > limit;
  return `<div class="text-diff" data-view="text-diff" data-path="${escapeHtml(path)}">`
    + `<p class="muted">真实前后正文行级差异${truncated ? '（超出上限，仅显示前 1200 行）' : ''}</p>`
    + `<div class="diff-body">${rows.join('')}</div></div>`;
}

/** `files/compare` forwards the existing WorkspaceToolsPort.compareWorkspace
 * result. Changes are listed exactly; a real text diff is only added when both
 * read bodies were actually supplied for the same path. */
export function renderWorkspaceComparison(
  result: WorkspaceResult<WorkspaceComparison> | null,
  textDiff?: { path: string; before: string; after: string },
): string {
  const diffHtml = textDiff === undefined ? '' : renderTextDiff(textDiff.before, textDiff.after, textDiff.path);
  if (result === null) {
    return `<section class="panel" data-view="workspace-compare"><p class="muted">尚未执行比较；选择真实的前后版本后读取结果。</p>${diffHtml}</section>`;
  }
  if (result.status !== 'ready') {
    return `<section class="panel rejected" data-view="workspace-compare"><h3>比较未完成</h3>`
      + `<p>${escapeHtml(result.reason)}（${escapeHtml(result.code)}）</p></section>`;
  }
  const comparison = result.value;
  const changes = comparison.changes.map(change => {
    if (change.kind === 'added') return `<li data-change="added"><code>${escapeHtml(change.path)}</code> · 新增</li>`;
    if (change.kind === 'deleted') return `<li data-change="deleted"><code>${escapeHtml(change.path)}</code> · 删除</li>`;
    if (change.kind === 'modified') {
      const before = 'beforeDigest' in change ? change.beforeDigest
        : ('digest' in change.before ? change.before.digest : change.before.objectId);
      const after = 'afterDigest' in change ? change.afterDigest
        : ('digest' in change.after ? change.after.digest : change.after.objectId);
      return `<li data-change="modified"><code>${escapeHtml(change.path)}</code> · 修改`
        + ` <span class="muted">${escapeHtml(String(before).slice(0, 12))} \u2192 ${escapeHtml(String(after).slice(0, 12))}</span></li>`;
    }
    return `<li data-change="renamed"><code>${escapeHtml(change.beforePath)}</code> \u2192 <code>${escapeHtml(change.afterPath)}</code> · 重命名</li>`;
  }).join('');
  return `<section class="panel" data-view="workspace-compare">`
    + `<header><h3>工作区比较</h3>`
    + `<p class="muted">${escapeHtml(comparison.comparison)} · 变更 ${escapeHtml(comparison.changes.length)} 条</p>`
    + detailsFor('查看比较范围与版本', `<p>scope <code>${escapeHtml(JSON.stringify(comparison.scope))}</code></p>`
      + `<p>before <code>${escapeHtml(JSON.stringify(comparison.before))}</code></p>`
      + `<p>after <code>${escapeHtml(JSON.stringify(comparison.after))}</code></p>`)
    + `</header>`
    + (comparison.changes.length === 0 ? '<p class="muted">两个版本没有差异。</p>' : `<ul class="changes">${changes}</ul>`)
    + diffHtml + `</section>`;
}

// --- Command handles (real Kernel ProcessSandbox) -----------------------------

/** One command handle's real snapshot. There is no interactive stdin and no
 * PTY: stdout/stderr/exit/truncation are the Kernel's own facts. */
export function renderWorkbenchCommand(
  result: WorkspaceResult<WorkbenchCommandSnapshot> | null,
  meta: { command: string; cwd: string; state?: WorkbenchCommandState | 'starting' },
): string {
  const header = `<header><h3>命令执行</h3>`
    + `<p class="muted">无交互 stdin / 非 PTY · cwd <code>${escapeHtml(meta.cwd)}</code></p>`
    + `<pre class="command-line">$ ${escapeHtml(meta.command)}</pre></header>`;
  if (result === null) {
    return `<section class="panel" data-view="command"><header><h3>命令执行</h3></header>`
      + `<p data-command-state="starting">正在启动命令…</p></section>`;
  }
  if (result.status !== 'ready') {
    return `<section class="panel rejected" data-view="command">${header}`
      + `<p data-command-state="rejected">命令不可用（${escapeHtml(result.code)}）：${escapeHtml(result.reason)}</p></section>`;
  }
  const snapshot = result.value;
  const state = meta.state ?? snapshot.state;
  const facts = `<p data-command-state="${escapeHtml(state)}">状态 ${escapeHtml(state)}`
    + ` · exit ${snapshot.exitCode === null ? '未产生' : escapeHtml(snapshot.exitCode)}`
    + (snapshot.signal === null ? '' : ` · signal ${escapeHtml(snapshot.signal)}`)
    + (snapshot.timedOut ? ' · 已超时' : '')
    + (snapshot.cancelled ? ' · 已取消' : '')
    + (snapshot.outputTruncated ? ' · 输出已截断' : '') + `</p>`;
  const error = snapshot.error === null ? ''
    : `<p data-command-error="${escapeHtml(snapshot.error.code)}">启动/执行失败：${escapeHtml(snapshot.error.reason)}</p>`;
  return `<section class="panel" data-view="command" data-command-id="${escapeHtml(snapshot.commandId)}">${header}${facts}${error}`
    + `<h4>stdout</h4><pre data-stream="stdout">${escapeHtml(snapshot.stdout)}</pre>`
    + `<h4>stderr</h4><pre data-stream="stderr">${escapeHtml(snapshot.stderr)}</pre>`
    + detailsFor('查看原始快照', `<pre>${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>`) + `</section>`;
}

// --- Project registration / new Goal -----------------------------------------

export type ProjectReadState =
  | { status: 'unread' }
  | { status: 'ready'; projectId: string; revision: number }
  | { status: 'not_found' }
  | { status: 'rejected'; code: string; reason: string }
  | { status: 'loading' };

/** Narrow Project read projection used by the cold-start new-Goal entry. It
 * shows the real revision or the real absence; revision 1 is never assumed. */
export function renderProjectRead(state: ProjectReadState): string {
  if (state.status === 'unread') return '<p class="muted" data-project-read="unread">尚未读取项目登记；新建目标会先正式读取。</p>';
  if (state.status === 'loading') return '<p data-project-read="loading">正在读取项目登记…</p>';
  if (state.status === 'not_found') return '<p data-project-read="not_found">项目尚未登记。新建目标时将完成登记。</p>';
  if (state.status === 'rejected') return `<p data-project-read="rejected">项目读取失败（${escapeHtml(state.code)}）：${escapeHtml(state.reason)}</p>`;
  return `<p data-project-read="ready">项目 <code>${escapeHtml(state.projectId)}</code> 已登记，正式版本 ${escapeHtml(state.revision)}。</p>`;
}

/** Read-only summary of the project main conversation: the current Goal text
 * the user wrote (never an ID) and whether it is registered. */
export function renderProjectConversation(input: {
  scope: CoreScope;
  workspaceName: string;
  goalText: string;
  goalId: string | null;
  projectState: ProjectReadState;
  hasProfile: boolean;
}): string {
  const goal = input.goalId === null
    ? `<p class="muted">写下希望完成的目标，从这里开始。</p>`
    : `<div class="chat-user" data-role="user"><p>${escapeHtml(input.goalText)}</p></div>`
      + detailsFor('目标与项目详情', `<p>目标 <code>${escapeHtml(input.goalId)}</code></p>` + renderProjectRead(input.projectState));
  return `<section class="conversation" data-view="project-conversation">`
    + `<p class="muted">${escapeHtml(input.workspaceName)}</p>`
    + `<div class="chat-stream">${goal}`
    + (input.hasProfile ? '' : '<p class="muted">当前工作区没有可信模型配置；普通发送会保留草稿并说明缺口。</p>')
    + `</div></section>`;
}
