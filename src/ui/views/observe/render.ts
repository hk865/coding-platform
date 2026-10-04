/** Pure observe renderers: the Task execution timeline lens and the Task fold. */

import type { RunRef, TaskExecutionRecord, TaskRow } from '../../../app/core-http-types.js';
import { detailsFor, escapeHtml } from '../../components/html.js';

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

export const MS = (value: string | null): number | null => {
  if (value === null || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Strictly monotonic lens over the normalized [0,1] time window. `tanh` is
 * strictly increasing, so the mapped order is identical to the real event
 * order: no crossing, no reordering, no fabricated timestamp. */
export function lensMap(u: number, focus: number, zoom: number): number {
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
