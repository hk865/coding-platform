/** Pure original-history parsing: record labels, tool-call parsing and index, activity grouping facts. */

import type { SessionHistoryEntry } from '../../../app/core-http-types.js';
import { list, record } from '../../components/html.js';

// --- Original-history timeline -------------------------------------------------

export const HISTORY_BODY_LABEL = {
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

export type ToolIdentity = { adapterId: string; kernelSessionId: string; runId: string; callId: string };
type ToolStatus = 'completed' | 'failed' | 'cancelled' | 'outcome_unknown';

/** Readable status label. A failed/cancelled/unknown result is NEVER shown as a
 * success, and an unknown result is never turned into "still running". */
export const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  completed: '完成', failed: '失败', cancelled: '已取消', outcome_unknown: '结果未知',
};

type DeclaredToolCall = ToolIdentity & { name: string; argumentsJson: string };

export type ParsedHistoryBody =
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
export const toolKey = (identity: ToolIdentity): string =>
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
export function parseHistoryBody(entry: SessionHistoryEntry): ParsedHistoryBody {
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
export type ToolIndexEntry = { identity: ToolIdentity; name: string; argumentsJson: string | null;
  startRecordId: string | null; terminalRecordId: string | null };

export function buildToolIndex(entries: readonly SessionHistoryEntry[]): Map<string, ToolIndexEntry> {
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
export type ActivityMember = { entry: SessionHistoryEntry; parsed: ParsedHistoryBody; meta: HistoryEntryMeta };

export function historyEntryMeta(entry: SessionHistoryEntry): HistoryEntryMeta {
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
export const isMessageBoundary = (parsed: ParsedHistoryBody): boolean =>
  parsed.kind === 'user_input' || parsed.kind === 'assistant_text' || parsed.kind === 'context_input';

export const activityGroupKey = (meta: HistoryEntryMeta): string =>
  `${meta.session}\u0000${meta.runId}\u0000${meta.turnId}`;

/** One honest line for the collapsed process row: real tool names and real
 * status counts, never an invented duration or task count. A failed/cancelled/
 * unknown member is always named here, so it can never read as success. */
export function activitySummary(members: readonly ActivityMember[], tools: Map<string, ToolIndexEntry>): string {
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
