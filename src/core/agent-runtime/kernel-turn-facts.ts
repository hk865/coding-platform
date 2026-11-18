/**
 * Kernel Turn facts reader.
 *
 * Decodes the genuine original Kernel SessionRecords returned by the Session
 * history owner and reduces ONE fixed Turn (the locator's runId/turnId) with the
 * public Kernel reducer. The Work observer reads through it; Run reconciliation
 * and the continuation brief are to share the same reader, so a decoded record
 * and a reduced Turn mean the same thing everywhere. It only reads: it never
 * writes a platform fact and never decides a terminal.
 */
import { isRecord } from '../../contracts/validation/common.js';
import { lineDelta } from '../../contracts/line-delta.js';
import type { RunStepStatusV1 } from '../../contracts/run-steps.js';
import { createInitialRunState, reduceRunState, sessionRecordSchema } from '../../../vendor/coding-agent/dist/public-api.js';
import type {
  AgentEvent, RunState, SessionRecord as KernelSessionRecord, ToolResult,
} from '../../../vendor/coding-agent/dist/public-api.js';
import type { KernelExecutionBinding } from '../work-graph/model/execution-entry-contracts.js';
import type { SessionHistoryEntry } from './session-operations.js';

/** One original Kernel record at its verified Session position. */
export type DecodedKernelRecord = { position: number; record: KernelSessionRecord };

/**
 * Decode one history entry into its Kernel SessionRecord. A body that is not an
 * inline Kernel record, does not parse, fails the public schema or disagrees
 * with the entry's own position/recordId/Session identity is damaged: `null`.
 */
export function decodeKernelEntry(entry: SessionHistoryEntry): DecodedKernelRecord | null {
  const body: unknown = entry.body;
  if (!isRecord(body) || body['encoding'] !== 'kernel_session_record_json' || typeof body['text'] !== 'string') return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body['text']); } catch { return null; }
  const result = sessionRecordSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.position !== entry.source.position || result.data.recordId !== entry.recordId
    || result.data.sessionId !== entry.source.kernelSessionId) return null;
  return { position: result.data.position, record: result.data };
}
function findTurnStart(records: readonly DecodedKernelRecord[], kernel: KernelExecutionBinding): { run: Parameters<typeof createInitialRunState>[0]; position: number } | null {
  for (const item of records) {
    if (item.record.recordType !== 'turn.started') continue;
    const payload = item.record.payload as unknown as { run?: Parameters<typeof createInitialRunState>[0] };
    const run = payload.run;
    if (run === undefined || run.runId !== kernel.runId || run.turn.turnId !== kernel.turnId) continue;
    return { run, position: item.position };
  }
  return null;
}
/**
 * Reduce the fixed Turn from its own `turn.started` record. `null` when that
 * record is not among the decoded records.
 */
export function reduceTurnFromStart(records: readonly DecodedKernelRecord[], kernel: KernelExecutionBinding): RunState | null {
  const start = findTurnStart(records, kernel);
  if (start === null) return null;
  return applyTurnEvents(createInitialRunState(start.run), records, kernel, start.position);
}
/**
 * The Turn's final assistant message named by `finalMessageId`, or `null`.
 * The one "finalMessageId → transcript message" rule; each caller maps a
 * missing message itself (the handoff brief: `no_formal_final_answer`; the
 * witness: `absent`, after its own non-blank rule).
 */
export function finalAssistantMessageOf(
  state: RunState, finalMessageId: string,
): Extract<RunState['transcript'][number], { kind: 'assistant_message' }> | null {
  for (const entry of state.transcript) {
    if (entry.kind === 'assistant_message' && entry.message.messageId === finalMessageId) return entry;
  }
  return null;
}
/**
 * Apply this Turn's `agent.event` records after `afterPosition` to an already
 * reduced state. Events of another Run/Turn in the same Session are skipped.
 */
export function applyTurnEvents(state: RunState, records: readonly DecodedKernelRecord[], kernel: KernelExecutionBinding, afterPosition: number): RunState {
  let next = state;
  for (const item of records) {
    if (item.position <= afterPosition) continue;
    if (item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    next = reduceRunState(next, event);
  }
  return next;
}

/**
 * The calls of a reduced Turn without a determined result (RD-2, LA-7): a batch
 * call `running` or `outcome_unknown` (a `pending` call never started, an
 * `abandoned` one is determined), or a transcript result carrying the formal
 * `outcome_unknown` error. The observer's RUN-08 and the start-up reconcile's
 * RUN-20(i) read the same list.
 */
export function unresolvedToolCallIds(state: RunState): string[] {
  const ids = new Set<string>();
  for (const call of state.toolBatch?.calls ?? []) {
    if (call.status === 'running' || call.status === 'outcome_unknown') ids.add(call.requestedCall.callId);
  }
  for (const entry of state.transcript) {
    if (entry.kind === 'tool_result' && entry.result.status === 'error' && entry.result.error.code === 'outcome_unknown') {
      ids.add(entry.callId);
    }
  }
  return [...ids];
}

// --------------------------------------------------------------------------
// P1（决定 121-147、121-51）：按事件读一个固定 Turn。活动计数（run-activity-tally.ts）和
// Run 步骤（run-steps.ts）共用这几样；Kernel 的事件和工具结果格式只在这里读。
// --------------------------------------------------------------------------

function isTurnStart(record: DecodedKernelRecord, kernel: KernelExecutionBinding): boolean {
  if (record.record.recordType !== 'turn.started') return false;
  const run = (record.record.payload as unknown as { run?: { runId?: string; turn?: { turnId?: string } } }).run;
  return run?.runId === kernel.runId && run.turn?.turnId === kernel.turnId;
}

/** 固定 Turn 的一条 `agent.event` 和它的位置。 */
export type TurnEvent = { position: number; event: AgentEvent };

/** 固定 Turn 在 throughPosition 以内、它自己 turn.started 之后的事件；没有这个 turn.started 时为 null。 */
export function turnEventsOf(records: readonly DecodedKernelRecord[], kernel: KernelExecutionBinding, throughPosition: number):
  { start: DecodedKernelRecord; events: TurnEvent[]; lastRecordAt: string } | null {
  const inWindow = records.filter((record) => record.position <= throughPosition);
  const start = inWindow.find((record) => isTurnStart(record, kernel));
  if (start === undefined) return null;
  let lastRecordAt = start.record.recordedAt;
  const events: TurnEvent[] = [];
  for (const record of inWindow) {
    if (record.record.recordType !== 'agent.event' || record.position <= start.position) continue;
    const event = record.record.payload.event;
    if (event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    events.push({ position: record.position, event });
    lastRecordAt = record.record.recordedAt;
  }
  return { start, events, lastRecordAt };
}

/** 一次调用：tool.started 和它的结果，按 tool.started 的顺序。 */
export type TurnCall = {
  callId: string; name: string; arguments: Record<string, unknown>; position: number; startedAt: string;
  settled: { type: 'tool.completed' | 'tool.failed' | 'tool.cancelled'; at: string; result: ToolResult } | null;
  outcomeUnknown: boolean;
};

/**
 * Turn 里的调用。开始、结果、结果未知先各记一张表再合起来，所以和事件先后无关；
 * 同一 callId 的结果以最后一个为准。没有 tool.started 的结果不成一次调用。
 */
export function turnCallsOf(events: readonly TurnEvent[]): TurnCall[] {
  const started = new Map<string, Omit<TurnCall, 'settled' | 'outcomeUnknown'>>();
  const settled = new Map<string, NonNullable<TurnCall['settled']>>();
  const unknownResult = new Set<string>();
  for (const { position, event } of events) {
    if (event.type === 'tool.started') {
      const call = event.payload.call;
      started.set(call.callId, { callId: call.callId, name: call.name, arguments: call.arguments, position,
        startedAt: event.meta.occurredAt });
    } else if (event.type === 'tool.completed' || event.type === 'tool.failed' || event.type === 'tool.cancelled') {
      settled.set(event.payload.callId, { type: event.type, at: event.meta.occurredAt, result: event.payload.result });
    } else if (event.type === 'tool.outcome_unknown') {
      unknownResult.add(event.payload.callId);
    }
  }
  return [...started.values()].map((call) => ({ ...call, settled: settled.get(call.callId) ?? null,
    outcomeUnknown: unknownResult.has(call.callId) }));
}

/** 模型回复里非空白的 reasoningContent，原样（不 trim）。没有就不生成。 */
export function turnReasoningOf(events: readonly TurnEvent[]): { position: number; at: string; text: string }[] {
  const reasoning: { position: number; at: string; text: string }[] = [];
  for (const { position, event } of events) {
    if (event.type !== 'assistant.message_completed') continue;
    const text = event.payload.message.reasoningContent;
    if (text !== undefined && text.trim().length > 0) reasoning.push({ position, at: event.meta.occurredAt, text });
  }
  return reasoning;
}

/**
 * 一次调用的状态和错误。over：Run 或 Turn 已结束。错误消息原样，不截。
 * 结果未知优先于结果（和活动计数一样）；没有结果的调用，结束了读成 unknown，没结束读成 running。
 */
export function callStatusOf(call: TurnCall, over: boolean):
  { status: RunStepStatusV1; error: { code: string; message: string } | null } {
  const result = call.settled?.result ?? null;
  const error = result !== null && result.status === 'error' ? { code: result.error.code, message: result.error.message } : null;
  if (call.outcomeUnknown) return { status: 'unknown', error };
  if (call.settled === null || result === null) return { status: over ? 'unknown' : 'running', error: null };
  if (call.settled.type === 'tool.cancelled' || result.status === 'cancelled') return { status: 'cancelled', error: null };
  if (result.status === 'error') return { status: result.error.code === 'outcome_unknown' ? 'unknown' : 'failed', error };
  return { status: 'done', error: null };
}

/**
 * shell / run_readonly_command 结果里的命令输出：第一段文字是 stdout，JSON 那一段有退出码和 stderr。
 * 没有那段 JSON（执行前被拒、开始前取消）时为 null。truncated 是 Kernel 自己的标记（每路只收前段）。
 */
export function commandOutputOf(result: ToolResult): {
  exitCode: number | null; stdout: { text: string; truncated: boolean }; stderr: { text: string; truncated: boolean };
} | null {
  const json = result.output.find((part) => part.kind === 'json' && isRecord(part.value)
    && (typeof part.value['exitCode'] === 'number' || part.value['exitCode'] === null));
  if (json === undefined || json.kind !== 'json') return null;
  // 两个命令工具跑过以后都写这一段（shell-tool.js、readonly-command-tool.ts），形状一样。
  const value = json.value as { exitCode: number | null; stdout: { truncated: boolean }; stderr: { text: string; truncated: boolean } };
  const text = result.output.find((part) => part.kind === 'text');
  return { exitCode: value.exitCode,
    stdout: { text: text !== undefined && text.kind === 'text' ? text.text : '', truncated: value.stdout.truncated },
    stderr: { text: value.stderr.text, truncated: value.stderr.truncated } };
}

/**
 * 一次 `edit` 调用改了几行。结果未知先看，为真就是 null；然后只有成功、确认改了的
 * `create`/`replace` 给行数，其它都是 null（不编一个 0）。
 */
export function editLinesOf(call: TurnCall): { added: number; deleted: number } | null {
  if (call.outcomeUnknown || call.settled === null) return null;
  const { type, result } = call.settled;
  if (call.name !== 'edit' || type !== 'tool.completed' || result.status !== 'success'
    || result.effects.sideEffect !== 'confirmed') return null;
  const mode = call.arguments['mode'];
  const delta = mode === 'create' ? lineDelta(null, call.arguments['newText'] as string)
    : mode === 'replace' ? lineDelta(call.arguments['oldText'] as string, call.arguments['newText'] as string)
      : null;
  return delta === null ? null : { added: delta.added, deleted: delta.deleted };
}

/** 一次调用的目标：参数 path、file、filePath、command 里第一个非空字符串。 */
export function callTargetOf(args: Record<string, unknown>): string | null {
  for (const key of ['path', 'file', 'filePath', 'command']) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}
