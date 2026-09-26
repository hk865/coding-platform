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
  WorkspaceResult,
} from '../app/core-http-types.js';
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
};
type GraphEdgeSpec = { from: string; to: string; label?: string };

let graphArrowSeq = 0;

/** Deterministic layered node-link canvas: real nodes and real connector lines,
 * no layout engine and no fabricated time. Nodes with an `action` are focusable
 * and clickable; `title` is the hover preview. A pinned node renders its full
 * label (its box grows so the text is not cropped) and the selected node is
 * marked: both are pure display state, never frozen domain data. */
function renderNodeLinkGraph(
  nodes: GraphNodeSpec[], edges: GraphEdgeSpec[], ariaLabel: string, display?: WorkbenchGraphDisplay,
): string {
  if (nodes.length === 0) return '';
  const baseWidth = 200;
  const nodeHeight = 48;
  const gapX = 36;
  const gapY = 66;
  const margin = 16;
  const pinned = new Set(display?.pinned ?? []);
  const selectedId = display?.selected?.nodeId;
  // Deterministic text width: a CJK/full-width glyph is about two Latin glyphs.
  // Counting glyph units keeps a full pinned label (Chinese or English) inside
  // its own box without font measurement and without drawing past the box.
  const glyphUnits = (text: string): number => {
    let units = 0;
    for (const char of text) units += (char.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1;
    return units;
  };
  const textWidth = (text: string): number => glyphUnits(text) * 7.2;
  // Caption text renders at 10px, so one glyph unit is about 6px there.
  const captionWidth = (text: string): number => glyphUnits(text) * 6;
  const widthOf = (node: GraphNodeSpec): number => {
    if (!pinned.has(node.id)) return baseWidth;
    const caption = node.caption === undefined ? 0 : captionWidth(node.caption) + 24;
    return Math.max(baseWidth, Math.ceil(textWidth(node.label)) + 28, caption);
  };
  const fitLabel = (node: GraphNodeSpec): string => {
    if (pinned.has(node.id) || textWidth(node.label) <= baseWidth - 28) return node.label;
    const available = baseWidth - 28 - 7.2; // reserve one glyph for the ellipsis
    let cut = '';
    for (const char of node.label) {
      if (textWidth(cut + char) > available) break;
      cut += char;
    }
    return `${cut}…`;
  };
  const fitCaption = (node: GraphNodeSpec): string => {
    const caption = node.caption;
    if (caption === undefined) return '';
    if (pinned.has(node.id) || captionWidth(caption) <= baseWidth - 24) return caption;
    const available = baseWidth - 24 - 6; // reserve one glyph for the ellipsis
    let cut = '';
    for (const char of caption) {
      if (captionWidth(cut + char) > available) break;
      cut += char;
    }
    return `${cut}…`;
  };
  const widths = new Map(nodes.map(node => [node.id, widthOf(node)]));
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
  // One vertical band per depth; inside a band the real nodes sit next to each
  // other by their own width, so same-depth nodes never overlap. Bands are
  // centered on the widest band; the canvas grows to that band + margin.
  const bandWidth = (depth: number): number => {
    const bucket = layers.get(depth) ?? [];
    return bucket.reduce((total, node, index) =>
      total + (widths.get(node.id) ?? baseWidth) + (index === 0 ? 0 : gapX), 0);
  };
  const depths: number[] = [];
  for (let depth = 0; depth <= maxLayer; depth += 1) depths.push(depth);
  const contentWidth = Math.max(baseWidth, ...depths.map(bandWidth));
  const canvasWidth = margin * 2 + contentWidth;
  const canvasHeight = margin * 2 + (maxLayer + 1) * nodeHeight + maxLayer * gapY;
  const position = new Map<string, { x: number; y: number; width: number }>();
  for (const depth of depths) {
    const bucket = layers.get(depth) ?? [];
    let x = margin + (contentWidth - bandWidth(depth)) / 2;
    const y = margin + depth * (nodeHeight + gapY);
    for (const node of bucket) {
      const width = widths.get(node.id) ?? baseWidth;
      position.set(node.id, { x, y, width });
      x += width + gapX;
    }
  }
  const marker = `graph-arrow-${graphArrowSeq++}`;
  const edgeHtml = validEdges.map(edge => {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    if (from === undefined || to === undefined) return '';
    const x1 = from.x + from.width / 2;
    const y1 = from.y + nodeHeight;
    const x2 = to.x + to.width / 2;
    const y2 = to.y;
    const label = edge.label === undefined || edge.label.length === 0 ? ''
      : `<text class="graph-edge-label" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 3}">${escapeHtml(edge.label)}</text>`;
    return `<g class="graph-edge-group"><line class="graph-edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#${marker})"/>${label}</g>`;
  }).join('');
  const nodeHtml = nodes.map(node => {
    const point = position.get(node.id);
    if (point === undefined) return '';
    const isPinned = pinned.has(node.id);
    const attributes = node.action === undefined ? '' : ` data-action="${escapeHtml(node.action)}" tabindex="0" role="button"`;
    const data = node.data === undefined ? ''
      : Object.entries(node.data).map(([key, value]) => ` data-${key}="${escapeHtml(value)}"`).join('');
    const label = fitLabel(node);
    const classes = `graph-node${selectedId === node.id ? ' selected' : ''}${isPinned ? ' pinned' : ''}`;
    const captionText = fitCaption(node);
    const caption = captionText.length === 0 ? ''
      : `<text class="graph-node-caption" x="${point.x + point.width / 2}" y="${point.y + 36}" text-anchor="middle">${escapeHtml(captionText)}</text>`;
    const pinBadge = isPinned
      ? `<text class="graph-pin-badge" x="${point.x + point.width - 8}" y="${point.y + 13}" text-anchor="end">已固定</text>`
      : '';
    return `<g class="${classes}" data-node="${escapeHtml(node.id)}"${attributes}${data} aria-pressed="${String(isPinned)}">`
      + `<title>${escapeHtml(node.title)}</title>`
      + `<rect x="${point.x}" y="${point.y}" width="${point.width}" height="${nodeHeight}" rx="8"/>`
      + `<text class="graph-node-label" x="${point.x + point.width / 2}" y="${point.y + 20}" text-anchor="middle">${escapeHtml(label)}</text>`
      + caption + pinBadge + `</g>`;
  }).join('');
  return `<svg class="graph-canvas" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}" role="group" aria-label="${escapeHtml(ariaLabel)}">`
    + `<defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>`
    + edgeHtml + nodeHtml + `</svg>`;
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
      caption: module.ref.moduleId,
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
      caption: `${node.nodeId} · ${node.kind}`,
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
  | 'setup' | 'task_graph' | 'architecture_graph';

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
export type WorkbenchGraphDisplay = { selected: WorkbenchNodeSelection | null; pinned: string[] };

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
    + `<button class="tab new" data-action="open-setup-tab" title="打开项目/计划辅助页">＋ 辅助页</button>`
    + `</div></section>`;
}

// --- Original-history timeline -------------------------------------------------

const HISTORY_BODY_LABEL = {
  user_input: '用户输入', assistant_text: '助手正文', tool_result: '工具结果',
  artifact: '工件引用', unknown: '未识别记录',
} as const;

type ParsedHistoryBody =
  | { kind: 'user_input' | 'assistant_text' | 'tool_result'; text: string }
  | { kind: 'artifact'; contentType: string; digest: string; sizeBytes: number; sourceKind: string; refId: string; revision: string }
  | { kind: 'unknown'; recordType: string };

/** Parse one raw entry into the segmented summary shown by default. The
 * summary only names the public message text; the complete saved record stays
 * reachable through `renderRawDisclosure`, which does not drop any field. */
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
    const eventPayload = record(event.payload);
    if (type === 'assistant.message_completed') {
      // The default summary names the public assistant text; the raw disclosure
      // below carries the complete saved record (including reasoning fields).
      const message = record(eventPayload.message);
      if (typeof message.content === 'string' && message.content.length > 0) {
        return { kind: 'assistant_text', text: message.content };
      }
    }
    if (type === 'tool.completed') {
      const result = record(eventPayload.result);
      const output = list(result.output)
        .map(item => { const text = record(item).text; return typeof text === 'string' ? text : ''; })
        .filter(part => part.length > 0);
      const status = typeof result.status === 'string' ? result.status : '';
      return { kind: 'tool_result', text: output.join('\n') + (status.length === 0 ? '' : `\n[${status}]`) };
    }
  }
  return { kind: 'unknown', recordType };
}

/** Segmented default view of one original record. It names the public text; it
 * is NOT a substitute for the saved original, which the raw disclosure carries. */
function renderParsedHistoryBody(parsed: ParsedHistoryBody): string {
  if (parsed.kind === 'artifact') {
    return `<div data-history-body="artifact"><p>工件 <code>${escapeHtml(parsed.refId)}</code>`
      + ` · ${escapeHtml(parsed.contentType)} · ${escapeHtml(parsed.sizeBytes)} 字节`
      + ` · ${escapeHtml(parsed.sourceKind)}@${escapeHtml(parsed.revision)}</p>`
      + `<p class="muted">正文未读取</p></div>`;
  }
  if (parsed.kind === 'unknown') {
    return `<details class="history-body" data-history-body="unknown"><summary>未识别记录</summary>`
      + `<p>记录类型 <code>${escapeHtml(parsed.recordType)}</code>；完整已保存原文见下方“原始记录”，此处不生成解释代替原文。</p>`
      + `</details>`;
  }
  return `<details class="history-body" data-history-body="${parsed.kind}">`
    + `<summary>${escapeHtml(HISTORY_BODY_LABEL[parsed.kind])}</summary>`
    + `<pre>${escapeHtml(parsed.text)}</pre></details>`;
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
    + `<summary>原始记录（完整保存原文）</summary>`
    + `<p class="muted">recordId <code>${escapeHtml(entry.recordId)}</code>`
    + ` · kind ${escapeHtml(entry.kind)}`
    + ` · cursor <code>${escapeHtml(entry.cursor)}</code>`
    + ` · position ${escapeHtml(entry.source.position)}`
    + ` · ${escapeHtml(entry.recordedAt)}`
    + ` · source ${escapeHtml(entry.source.adapterId)}/${escapeHtml(entry.source.kernelSessionId)}</p>`
    + `<pre>${escapeHtml(rawRecordBody(entry))}</pre>`
    + `</details>`;
}

function renderHistoryEntry(entry: SessionHistoryEntry): string {
  const parsed = parseHistoryBody(entry);
  // The always-visible line stays short: the exact recordId/cursor/position are
  // long technical facts and live in the default-closed raw disclosure below,
  // never widening the conversation column.
  const identity = `<span class="muted">${escapeHtml(entry.recordedAt)} · position ${escapeHtml(entry.source.position)}</span>`;
  const header = `<header><strong>${escapeHtml(HISTORY_BODY_LABEL[parsed.kind])}</strong> ${identity}</header>`;
  return `<li data-history="${escapeHtml(entry.recordId)}" data-history-kind="${parsed.kind}">`
    + `${header}${renderParsedHistoryBody(parsed)}${renderRawDisclosure(entry)}</li>`;
}

/** Original-history timeline. It preserves the exact recordId, cursor and
 * source.position order, keeps ArtifactRef unread, and never invents a public
 * summary or re-sorts parallel events into a causal chain. */
export function renderSessionHistoryTimeline(result: ReadResult<Page<SessionHistoryEntry>>): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('sessions/history', '该会话没有可读的原历史');
  if (result.status === 'not_ready') return renderGap('sessions/history', '原历史尚未就绪');
  const page = result.value;
  const rows = page.items.map(renderHistoryEntry).join('');
  return `<section class="panel history-timeline" data-view="history-timeline"><header><h3>原历史</h3>`
    + `<p>共 ${page.items.length} 条 · ${page.nextCursor === null ? '没有更多' : '还有更多'}</p>`
    + detailsFor('查看历史游标与依据', `<p>nextCursor ${escapeHtml(page.nextCursor ?? 'none')}</p>`
      + `<p>basis <code>${escapeHtml(JSON.stringify(page.basis))}</code></p>`)
    + `</header>`
    + (page.items.length === 0 ? '<p class="muted">该页没有记录</p>' : `<ol class="history">${rows}</ol>`)
    + `</section>`;
}

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

function structureTaskRow(row: TaskRow): string {
  const title = record(row.definition).title;
  const intent = row.definition.executionIntent;
  return `<li data-task="${escapeHtml(row.ref.taskId)}"><code>${escapeHtml(row.ref.taskId)}</code>`
    + ` <strong>${escapeHtml(title ?? '')}</strong>`
    + ` <span class="phase">${escapeHtml(row.effectivePhase)}</span>`
    + ` <span class="muted">${escapeHtml(row.disposition)} · ${escapeHtml(row.definition.requirementLevel)}`
    + ` · ${escapeHtml(row.definition.taskKind)} · ${escapeHtml(intent ?? '未标注执行意图')}</span>`
    + ` <button class="link" data-action="open-task-detail"`
    + ` data-project-id="${escapeHtml(row.ref.projectId)}" data-goal-id="${escapeHtml(row.ref.goalId)}"`
    + ` data-task-id="${escapeHtml(row.ref.taskId)}">打开任务详情</button></li>`;
}

/** Work-breakdown (`taskHierarchy.parentOf`) and real execution dependencies
 * (`executionDag.dependsOn`) stay in separate sections; advisory relations are
 * a third list. Planning-only/optional/deferred/future rows are never filtered
 * and no execution time is invented. */
export function renderTaskStructure(result: ReadResult<TaskGraph>, display?: WorkbenchGraphDisplay): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('tasks/query', '该 Goal 还没有已采用的 Plan');
  if (result.status === 'not_ready') return renderGap('tasks/query', '任务图尚未就绪');
  const graph = result.value;
  const plan = graph.plan;
  const tasks: { taskId: string; title: string; phase: string; disposition: string; intent: string }[] =
    graph.tasks.length > 0
      ? graph.tasks.map(row => ({ taskId: row.ref.taskId, title: String(record(row.definition).title ?? ''),
          phase: row.effectivePhase, disposition: row.disposition, intent: row.definition.executionIntent ?? '未标注执行意图' }))
      : plan.tasks.map(task => ({ taskId: task.taskId, title: task.title, phase: task.phase,
          disposition: task.disposition, intent: task.executionIntent ?? '未标注执行意图' }));
  const taskNode = (task: { taskId: string; title: string; phase: string; disposition: string; intent: string }): GraphNodeSpec => ({
    id: task.taskId,
    label: task.title.length > 0 ? task.title : task.taskId,
    caption: `${task.taskId} · ${task.phase} · ${task.intent}`,
    action: 'select-node',
    data: { 'target-kind': 'task', 'project-id': plan.goalRef.projectId, 'goal-id': plan.goalRef.goalId, 'task-id': task.taskId },
    title: `${task.title || task.taskId}（${task.taskId}）\nphase: ${task.phase}\ndisposition: ${task.disposition}\nintent: ${task.intent}`,
  });
  const hierarchyGraph = renderNodeLinkGraph(tasks.map(taskNode),
    plan.taskHierarchy.parentOf.map(edge => ({ from: edge.parentTaskId, to: edge.childTaskId })), '任务包含结构图', display);
  const executionGraph = renderNodeLinkGraph(tasks.map(taskNode),
    plan.executionDag.dependsOn.map(edge => ({ from: edge.dependsOnId, to: edge.taskId, label: edge.requires.kind })), '任务执行依赖图', display);
  const hierarchy = plan.taskHierarchy.parentOf.map(edge =>
    `<li>${escapeHtml(edge.parentTaskId)} → ${escapeHtml(edge.childTaskId)}</li>`).join('');
  const execution = plan.executionDag.dependsOn.map(edge =>
    `<li>${escapeHtml(edge.taskId)} 依赖 ${escapeHtml(edge.dependsOnId)} `
    + `<span class="muted">${escapeHtml(edge.requires.kind)} · ${escapeHtml(edge.requires.label)}</span></li>`).join('');
  const relations = ('taskRelations' in plan ? plan.taskRelations ?? [] : []).map(relation =>
    `<li>${escapeHtml(relation.kind)}: ${escapeHtml(relation.fromTaskId)} → ${escapeHtml(relation.toTaskId)} `
    + `<span class="muted">${escapeHtml(relation.note)}</span></li>`).join('');
  return `<section class="panel" data-view="task-structure"><header><h3>任务结构</h3>`
    + `<p>目标 <code>${escapeHtml(plan.goalRef.goalId)}</code> · 计划 <code>${escapeHtml(plan.ref.planId)}</code>`
    + ` · 业务版本 ${escapeHtml(plan.planRevision)} · 任务 ${graph.tasks.length}</p></header>`
    + `<section data-structure="hierarchy"><h4>包含结构（parent_of）</h4>`
    + hierarchyGraph
    + (hierarchy.length === 0 ? '<p class="muted">没有记录包含边</p>' : `<ul>${hierarchy}</ul>`)
    + `<p class="muted">包含关系只表达工作分解，不代表执行依赖。</p></section>`
    + `<section data-structure="execution"><h4>执行依赖（depends_on）</h4>`
    + executionGraph
    + (execution.length === 0 ? '<p class="muted">没有记录执行依赖</p>' : `<ul>${execution}</ul>`)
    + `<p class="muted">依赖边来自已采用 Plan 的执行 DAG，与包含关系分开。</p></section>`
    + `<section data-structure="relations"><h4>协作关系（advisory）</h4>`
    + (relations.length === 0 ? '<p class="muted">没有记录协作关系</p>' : `<ul>${relations}</ul>`)
    + `<p class="muted">协作关系只是建议，不构成调度前置。</p></section>`
    + `<section data-structure="tasks"><h4>全部任务</h4>`
    + (graph.tasks.length === 0 ? '<p class="muted">没有任务</p>' : `<ul class="tasks">${graph.tasks.map(structureTaskRow).join('')}</ul>`)
    + `</section></section>`;
}

// --- Work-link navigation ------------------------------------------------------

/** Navigation from a real `WorkLinkTarget` to its related Sessions. The exact
 * typed ref travels in data attributes; nothing is parsed from a title/tabId and
 * no Task↔Kernel link is guessed. Archived sessions are included by the caller. */
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
    + ` data-next-kind="${escapeHtml(nextKind)}"><header><h3>初始规划</h3></header>`
    + detailsFor('候选/采用回执', `<pre>${escapeHtml(JSON.stringify(value.receipt, null, 2))}</pre>`)
    + next + originalRequestHtml(originalRequest) + `</section>`;
}
