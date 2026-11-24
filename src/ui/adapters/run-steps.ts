/**
 * 共用投影（1A A1）：`executions/steps` 的回答 `RunStepsReadV1` → 线视图
 * `lvSteps` 已经吃的步骤对象（Main、Plan、Member 同一份）。头行、时间和
 * 三句非步骤的话也在这里，页面只贴字。
 *
 * 纯函数：不取数、不读时钟、不带选项；页面把路由回答原样交进来。
 */
import type { RunStepsReadV1, RunStepsSummaryV1, RunStepV1 } from '../../contracts/run-steps.js';
import type { RunActivityUnknownReason } from '../../contracts/run-activity.js';
import { localShortAt } from './task-map.js';

/** 线视图一步：字段全部显式，没有值的字符串写空。 */
export type RunStepView = {
  ic: 'think' | 'file' | 'edit' | 'cmd' | 'int';
  verb: string; obj: string; path: boolean; meta: string; detail: string;
  prose: boolean; live: boolean; fail: boolean;
};

const THINK_TRUNCATED_TEXT = '思考较长，只显示前 16 KB';
const RUN_STEP_MORE_TEXT = '（可能还有）';

export const RUN_STEPS_NOT_STARTED_TEXT = '这一次还没开始。';
export const RUN_STEPS_NOT_ENTERED_TEXT = '这一次没进入执行。';

/** 读不出时的中文原因词；页面只写词，不印码。 */
const UNKNOWN_REASON_WORD: Record<RunActivityUnknownReason, string> = {
  no_history_locator: '没有这次执行的位置记录',
  kernel_unreadable: '读不到原始记录',
  history_read_failed: '读取原始记录失败',
  history_damaged: '原始记录损坏',
  turn_not_found: '找不到这一轮的记录',
  capacity: '记录太多，超过读取上限',
};

/** 首行；`text` 为空时是空串。 */
function firstLine(text: string): string {
  const end = text.search(/\r|\n/);
  return end < 0 ? text : text.slice(0, end);
}

function isRunning(status: string): boolean {
  return status === 'running';
}

function isFailed(status: string): boolean {
  return status === 'failed';
}

/** 编辑行数的原型写法：`+a −d`（U+2212）。 */
function editMetaOf(lines: { added: number; deleted: number } | null): string {
  return lines === null ? '' : '+' + String(lines.added) + ' −' + String(lines.deleted);
}

/** 命令用时（秒）；没有结束时间就不写。 */
function commandSeconds(step: Extract<RunStepV1, { kind: 'command' }>): number | null {
  if (step.endedAt === null) return null;
  return Math.max(0, Math.round((Date.parse(step.endedAt) - Date.parse(step.startedAt)) / 1000));
}

/** 照原型 `通过，41 秒`：退出码 0 且没失败是“通过”，否则写退出码。 */
function commandMetaOf(step: Extract<RunStepV1, { kind: 'command' }>): string {
  if (step.status === 'running') return '';
  const seconds = commandSeconds(step);
  const took = seconds === null ? '' : '，' + String(seconds) + ' 秒';
  if (step.exitCode === 0 && step.status !== 'failed') return '通过' + took;
  if (step.exitCode !== null) return '退出码 ' + String(step.exitCode) + took;
  return seconds === null ? '' : String(seconds) + ' 秒';
}

/** `$ 命令`，接 stdout、stderr 的末尾；两者都空时只剩命令行。 */
function commandDetailOf(step: Extract<RunStepV1, { kind: 'command' }>): string {
  const parts: string[] = [];
  if (step.command !== null) parts.push('$ ' + step.command.text);
  if (step.stdout !== null && step.stdout.text !== '') parts.push(step.stdout.text.replace(/\n$/, ''));
  if (step.stderr !== null && step.stderr.text !== '') parts.push(step.stderr.text.replace(/\n$/, ''));
  return parts.join('\n');
}

type MessageRecipient = Extract<RunStepV1, { kind: 'message' }>['to'];

/** 收件方：回复、对人（告诉你）、对 Session 或没写清（发消息）。 */
function messageVerbOf(to: MessageRecipient): string {
  if (to === null) return '发消息';
  if (to.kind === 'reply') return '回复';
  if (to.kind === 'person') return '告诉你';
  return '发消息';
}

function stepOf(step: RunStepV1): RunStepView {
  switch (step.kind) {
    case 'think': {
      /* Note 3: `obj` already draws the first line, so the expanded detail
         carries only the remainder; the truncation note stays at its end. */
      const body = step.text.text;
      const rest = body.slice(firstLine(body).length).replace(/^\r?\n/, '');
      const note = step.text.truncated ? THINK_TRUNCATED_TEXT : '';
      const detail = rest === '' ? note : note === '' ? rest : rest + '\n' + note;
      return { ic: 'think', verb: '思考', obj: firstLine(step.text.text), path: false, meta: '', detail,
        prose: true, live: false, fail: false };
    }
    case 'read':
      /* Note 8: a failed read is red text, not a clickable path; a successful
         read keeps the one path button. */
      return { ic: 'file', verb: '读取', obj: step.path ?? '', path: !isFailed(step.status), meta: '', detail: '',
        prose: false, live: isRunning(step.status), fail: isFailed(step.status) };
    case 'edit':
      return { ic: 'edit', verb: '编辑', obj: step.path ?? '', path: true, meta: editMetaOf(step.lines), detail: '',
        prose: false, live: isRunning(step.status), fail: isFailed(step.status) };
    case 'command': {
      const text = step.command === null ? '' : step.command.text;
      const fail = isFailed(step.status) || (step.exitCode !== null && step.exitCode !== 0);
      return { ic: 'cmd', verb: '运行命令', obj: firstLine(text), path: false, meta: commandMetaOf(step),
        detail: commandDetailOf(step), prose: false, live: isRunning(step.status), fail };
    }
    case 'message': {
      const text = step.text === null ? '' : step.text.text;
      return { ic: 'int', verb: messageVerbOf(step.to), obj: firstLine(text), path: false, meta: '', detail: text,
        prose: true, live: isRunning(step.status), fail: isFailed(step.status) };
    }
    case 'tool': {
      const target = step.target === null ? '' : step.target.text;
      return { ic: 'file', verb: '用工具', obj: firstLine(target), path: false, meta: '', detail: '',
        prose: false, live: isRunning(step.status), fail: isFailed(step.status) };
    }
  }
}

/** 一页步骤；`not_started`/`not_entered`/`unknown` 没有步骤，是空表（话在 `runStepsSentenceOf`）。 */
export function runStepsOf(read: RunStepsReadV1): RunStepView[] {
  return read.kind === 'steps' ? read.steps.map(stepOf) : [];
}

/** 头行：`用时 n 分，已读取 a 个文件、编辑 b 个文件、运行命令 c 次`。 */
export function runStepsHeadOf(summary: RunStepsSummaryV1): string {
  const minutes = Math.max(1, Math.round((Date.parse(summary.lastAt) - Date.parse(summary.startedAt)) / 60000));
  const more = summary.changedFiles.possible > 0 || summary.changedFiles.possiblyIncomplete ? RUN_STEP_MORE_TEXT : '';
  return '用时 ' + String(minutes) + ' 分，已读取 ' + String(summary.reads) + ' 个文件、编辑 '
    + String(summary.changedFiles.definite) + ' 个文件、运行命令 ' + String(summary.commands) + ' 次' + more;
}

/** 板上的钟点 `HH:MM`；`localShortAt` 的 `MM-DD HH:mm` 尾段就是它。 */
function runStepClockOf(iso: string): string {
  return localShortAt(iso).slice(6);
}

/** 时间：结束的写 `HH:MM–HH:MM`，在跑的写 `HH:MM 起`。 */
export function runStepsTimeOf(summary: RunStepsSummaryV1): string {
  const start = runStepClockOf(summary.startedAt);
  return summary.live ? start + ' 起' : start + '–' + runStepClockOf(summary.lastAt);
}

/** `unknown` 的一句：中文原因词，不印码。 */
export function runStepsUnknownText(reason: RunActivityUnknownReason): string {
  return '读不到这一次的步骤：' + UNKNOWN_REASON_WORD[reason] + '。';
}

/** 三种非步骤回答各一句；`steps` 没有这句话（空串）。 */
export function runStepsSentenceOf(read: RunStepsReadV1): string {
  if (read.kind === 'not_started') return RUN_STEPS_NOT_STARTED_TEXT;
  if (read.kind === 'not_entered') return RUN_STEPS_NOT_ENTERED_TEXT;
  if (read.kind === 'unknown') return runStepsUnknownText(read.reason);
  return '';
}
