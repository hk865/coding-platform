/**
 * P1（决定 121-147）：把一个固定 Kernel Turn 的记录排成 Run 步骤。纯函数，只做分类、截文字和分页。
 *
 * Kernel 的记录格式和工具结果格式只在现有读点里读（kernel-turn-facts.ts，“成功的读”在
 * witness-facts.ts；决定 121-51），这里不直接读。头行数字用活动计数（`tallyTurnActivity`）
 * 给的 Turn 起止、是否结束和改动文件，改动文件的个数照活动视图。
 *
 * 思考只来自模型回复里已保存的 `reasoningContent`，没有就不生成；回答正文不是一步
 * （UI-WORKBENCH §1 第 2 条）。
 */
import {
  RUN_STEP_OUTPUT_TAIL_BYTES, RUN_STEP_TARGET_BYTES, RUN_STEP_TEXT_BYTES, RUN_STEP_THINK_BYTES,
  type RunStepV1, type RunStepsReadV1,
} from '../../contracts/run-steps.js';
import type { BoundedTextV1 } from '../../contracts/continuation-brief.js';
import type { RunActivityBound } from '../../contracts/run-activity.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import { streamTail, truncateUtf8, utf8ByteLength } from '../../contracts/utf8.js';
import { isRecord } from '../../contracts/validation/common.js';
import type { KernelExecutionBinding } from '../work-graph/model/execution-entry-contracts.js';
import {
  PERSON_MESSAGE_TOOL_NAMES, type SESSION_MAILBOX_TOOL_NAMES,
} from './communication-tools.js';
import {
  callStatusOf, callTargetOf, commandOutputOf, editLinesOf, turnCallsOf, turnEventsOf, turnReasoningOf,
  type DecodedKernelRecord, type TurnCall, type reduceTurnFromStart,
} from './kernel-turn-facts.js';
import { READONLY_COMMAND_TOOL_NAME } from './readonly-command-tool.js';
import { tallyTurnActivity } from './run-activity-tally.js';
import { isSuccessfulRead } from './witness-facts.js';

/** 按工具名分类。平台的写在 Kernel 里记成 `edit`（run-activity.ts 的 FILE_EDIT_TOOL_NAMES）。 */
const READ_TOOL_NAMES: ReadonlySet<string> = new Set(['read', 'read_source']);
const COMMAND_TOOL_NAMES: ReadonlySet<string> = new Set(['shell', READONLY_COMMAND_TOOL_NAME]);
const SEND_SESSION_MESSAGE = 'send_session_message' satisfies (typeof SESSION_MAILBOX_TOOL_NAMES)[number];
const RESPOND_SESSION_MESSAGE = 'respond_session_message' satisfies (typeof SESSION_MAILBOX_TOOL_NAMES)[number];
/** 人件消息（通知、问人）：收件人固定是人，不走 Session 收件人参数。 */
const PERSON_MESSAGE_TOOL_NAME_SET: ReadonlySet<string> = new Set<string>(PERSON_MESSAGE_TOOL_NAMES);

/** 从头截到 `maxBytes` 个 UTF-8 字节，不切开一个字。 */
function bounded(text: string, maxBytes: number): BoundedTextV1 {
  const cut = truncateUtf8(text, maxBytes);
  return { text: cut, truncated: cut.length !== text.length };
}

/** 一路命令输出取末尾（和检查基线同一条规则）：Kernel 已截的带标记，原文超过上限也算截了。 */
function outputTail(stream: { text: string; truncated: boolean }): BoundedTextV1 {
  return { text: streamTail(stream, RUN_STEP_OUTPUT_TAIL_BYTES),
    truncated: stream.truncated || utf8ByteLength(stream.text) > RUN_STEP_OUTPUT_TAIL_BYTES };
}

/** 参数里的一个字符串；形状不对（多半是执行前被拒的调用）是 null。 */
function stringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' ? value : null;
}

function boundedArg(args: Record<string, unknown>, key: string, maxBytes: number): BoundedTextV1 | null {
  const value = stringArg(args, key);
  return value === null ? null : bounded(value, maxBytes);
}

function sessionRecipientOf(value: unknown): { kind: 'session'; sessionRef: SessionRef } | null {
  if (!isRecord(value) || typeof value['projectId'] !== 'string' || typeof value['sessionId'] !== 'string') return null;
  return { kind: 'session', sessionRef: { projectId: value['projectId'], sessionId: value['sessionId'] } };
}

function replyTargetOf(value: unknown): { kind: 'reply'; messageRef: SessionMessageRef } | null {
  if (!isRecord(value) || value['aggregateType'] !== 'SessionMessage' || typeof value['projectId'] !== 'string'
    || typeof value['workspaceId'] !== 'string' || typeof value['messageId'] !== 'string') return null;
  return { kind: 'reply', messageRef: { aggregateType: 'SessionMessage', projectId: value['projectId'],
    workspaceId: value['workspaceId'], messageId: value['messageId'] } };
}

function thinkStep(item: { position: number; at: string; text: string }): RunStepV1 {
  return { kind: 'think', position: item.position, at: item.at, text: bounded(item.text, RUN_STEP_THINK_BYTES) };
}

/** 一次调用成一步：状态和错误由 `callStatusOf` 定，其余按工具名分类。 */
function callStep(call: TurnCall, over: boolean): RunStepV1 {
  const { status, error } = callStatusOf(call, over);
  const base = { position: call.position, callId: call.callId, tool: call.name, status, startedAt: call.startedAt,
    endedAt: call.settled === null ? null : call.settled.at,
    error: error === null ? null : { code: error.code, message: bounded(error.message, RUN_STEP_TARGET_BYTES) } };
  const args = call.arguments;
  const path = stringArg(args, 'path');
  if (READ_TOOL_NAMES.has(call.name)) {
    return { ...base, kind: 'read', path: path === null ? null : truncateUtf8(path, RUN_STEP_TARGET_BYTES) };
  }
  if (call.name === 'edit') {
    return { ...base, kind: 'edit', path: path === null ? null : truncateUtf8(path, RUN_STEP_TARGET_BYTES), lines: editLinesOf(call) };
  }
  if (COMMAND_TOOL_NAMES.has(call.name)) {
    // 没有结果，或结果里没有命令输出（执行前被拒、开始前取消）：三项都是 null。
    const output = call.settled === null ? null : commandOutputOf(call.settled.result);
    return { ...base, kind: 'command', command: boundedArg(args, 'command', RUN_STEP_TARGET_BYTES),
      exitCode: output === null ? null : output.exitCode,
      stdout: output === null ? null : outputTail(output.stdout),
      stderr: output === null ? null : outputTail(output.stderr) };
  }
  if (call.name === SEND_SESSION_MESSAGE) {
    return { ...base, kind: 'message', to: sessionRecipientOf(args['recipient']), text: boundedArg(args, 'text', RUN_STEP_TEXT_BYTES) };
  }
  if (PERSON_MESSAGE_TOOL_NAME_SET.has(call.name)) {
    return { ...base, kind: 'message', to: { kind: 'person' }, text: boundedArg(args, 'text', RUN_STEP_TEXT_BYTES) };
  }
  if (call.name === RESPOND_SESSION_MESSAGE) {
    // 拒绝的回复（`reject: true`）写的是理由。
    return { ...base, kind: 'message', to: replyTargetOf(args['messageRef']),
      text: boundedArg(args, args['reject'] === true ? 'reason' : 'text', RUN_STEP_TEXT_BYTES) };
  }
  const target = callTargetOf(args);
  return { ...base, kind: 'tool', target: target === null ? null : bounded(target, RUN_STEP_TARGET_BYTES) };
}

/**
 * 一个 Turn 的一页步骤。`window` 是读窗的起点、冻住的上界和上界从哪来；`runEnded` 是 Run（或
 * Query 轮）已结束。读不出这个 Turn（没有它的 turn.started）时是 `unknown`，原因和计数一样。
 * 每一步的位置是 Kernel 位置，不变；新步只接在后面，所以分页和刷新都按位置。
 * `reducedTurn` 是接着读时已经归约好的这个 Turn（P1 更正 3），照原样交给计数，省掉从头归约。
 */
export function buildRunSteps(input: {
  decoded: readonly DecodedKernelRecord[]; kernel: KernelExecutionBinding;
  window: { fromPosition: number; throughPosition: number; bound: RunActivityBound };
  runEnded: boolean; after: number | null; limit: number;
  reducedTurn?: ReturnType<typeof reduceTurnFromStart>;
}): Extract<RunStepsReadV1, { kind: 'steps' | 'unknown' }> {
  const facts = tallyTurnActivity(input.decoded, input.kernel, input.window, input.reducedTurn);
  if (facts.status === 'unknown') return { kind: 'unknown', reason: facts.reason, detail: facts.detail };
  // 计数刚找到了这个 Turn 的 turn.started，这里不会是 null。
  const turn = turnEventsOf(input.decoded, input.kernel, input.window.throughPosition)!;
  // Run 结束或 Turn 结束都算结束：Host 崩了、Turn 没关上的 Run，没结果的调用读成 unknown。
  const over = input.runEnded || facts.window.turnTerminal;
  const calls = turnCallsOf(turn.events);
  const items: RunStepV1[] = [...turnReasoningOf(turn.events).map(thinkStep), ...calls.map((call) => callStep(call, over))]
    .sort((left, right) => left.position - right.position);

  const readPaths = new Set<string>();
  for (const call of calls) {
    const path = stringArg(call.arguments, 'path');
    if (call.settled !== null && path !== null && isSuccessfulRead(call.name, path, call.settled.result)) readPaths.add(path);
  }
  const summary = {
    startedAt: facts.window.turnStartedAt, lastAt: facts.window.lastRecordAt, live: !over,
    reads: readPaths.size,
    // 字段名和算法照活动视图（activity-read-helpers.ts）：列出的个数。
    changedFiles: { definite: facts.changedFiles.definite.length, possible: facts.changedFiles.possible.length,
      possiblyIncomplete: facts.changedFiles.possiblyIncomplete },
    commands: items.filter((step) => step.kind === 'command').length,
  };

  const after = input.after;
  const rest = after === null ? items : items.filter((step) => step.position > after);
  const steps = rest.slice(0, input.limit);
  const next = rest.length > steps.length ? steps[steps.length - 1]!.position : null;
  const running = items.find((step) => step.kind !== 'think' && step.status === 'running');
  return { kind: 'steps', summary, steps, next, runningFrom: running === undefined ? null : running.position };
}
