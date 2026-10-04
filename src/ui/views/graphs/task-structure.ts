/** Pure Task structure lens (hierarchy and execution sections) and the work-link target. */

import type { ReadResult, TaskExecutionRecord, TaskGraph } from '../../../app/core-http-types.js';
import { detailsFor, escapeHtml, record, rejectionPanel, renderGap } from '../../components/html.js';
import type { WorkLinkTarget, WorkbenchGraphDisplay } from '../../state/layout.js';
import { TASK_PHASE_LABEL } from './node-link.js';
import { MS, lensMap } from '../observe/render.js';

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
