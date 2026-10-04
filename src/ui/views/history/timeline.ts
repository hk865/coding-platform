/** Pure original-history timeline: activity groups, tool entries, initial-plan review and execution history. */

import type {
  CoreScope,
  ExecutionHistoryPage,
  Page,
  ReadResult,
  RunRef,
  SessionHistoryEntry,
  TaskExecutionRecord,
} from '../../../app/core-http-types.js';
import { renderMarkdown } from '../../markdown.js';
import { detailsFor, escapeHtml, list, record, rejectionPanel, renderGap } from '../../components/html.js';
import {
  HISTORY_BODY_LABEL,
  TOOL_STATUS_LABEL,
  activityGroupKey,
  activitySummary,
  buildToolIndex,
  historyEntryMeta,
  isMessageBoundary,
  parseHistoryBody,
  toolKey,
} from './parse.js';
import type { ActivityMember, ParsedHistoryBody, ToolIdentity, ToolIndexEntry } from './parse.js';

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
export function renderParsedHistoryBody(parsed: ParsedHistoryBody, inputRecord = ''): string {
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
export function renderRawDisclosure(entry: SessionHistoryEntry): string {
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
