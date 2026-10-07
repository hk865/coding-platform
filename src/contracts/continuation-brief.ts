/**
 * C3 continuation brief (spec §6.1 contract (e); §4 C1/C3; GAP-49).
 *
 * A requeued Run carries one bounded, pure-data brief inside its
 * content-addressed task manifest (`PreparedTaskManifestV1.continuationBrief`);
 * the Run's immutable `inputBinding.continuationBriefDigest` pins it. The shape,
 * its digest and marker, the shape validator, the source-checkpoint comparison
 * and the Chinese renderer are shared here so the AgentRuntime assembly, the
 * WorkGraph read model and the RUN-02 guard agree. No writer produces a brief
 * before §15 sub-step 5.4.
 */
import type { ArtifactRef } from './artifact.js';
import type { SessionRef } from './core/identity.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { ControlIntentRef } from './control-intent.js';
import type { RunOutcome, RunRef, TaskAttemptRef, TaskTriple } from './dispatch.js';
import { EVIDENCE_OUTCOMES } from './evidence.js';
import { canonicalJson, sha256Hex, type JsonValue } from './fingerprint.js';
import type { RunFailureOrigin } from './no-progress.js';
import type { FailingCheckFactV1 } from './task-failure.js';
import {
  REWORK_FAILURE_CLASSES, type ReworkActorClass, type ReworkFailureClass, type StopRequester, type TaskRequeueRef,
} from './task-requeue.js';
import { ROUND_CHECK_INCOMPLETE_CAUSES, type VerificationRoundRef } from './verification.js';

// ------------------------------------------------------------------------ //
// Shapes                                                                    //
// ------------------------------------------------------------------------ //
/** Text cut to `CONTINUATION_BRIEF_LIMITS.textChars`; `truncated` says whether anything was cut. */
export type BoundedTextV1 = { text: string; truncated: boolean };
/** Whether the workspace source changed between two persisted checkpoints. */
export type SourceChangeVerdictV1 = 'changed' | 'unchanged' | 'unknown';
export type ContinuationToolCallV1 = {
  callId: string;
  name: string;
  target: BoundedTextV1 | null;
  result: 'success' | 'error' | 'cancelled' | 'not_started' | 'outcome_unknown';
  sideEffect: 'none' | 'possible' | 'confirmed' | null;
  /** At most `pathsPerCall`. */
  changedPaths: string[];
  changedPathsOmitted: number;
  error: BoundedTextV1 | null;
};
/** Only session messages and artifacts; there is no instruction input. */
export type ContinuationNewInputV1 =
  /**
   * `replyBody` is inlined only when the reply does not go back to the new Run's claim Session, i.e. the message's
   * sender is not a work Run of that Session (§6.1 contract (e) "发给新 Run 所在 Session 之外时"); otherwise that
   * Session's input channel supplies the reply and `replyBody` is null.
   */
  | { kind: 'session_message'; ref: SessionMessageRef; replyBody: BoundedTextV1 | null }
  | { kind: 'artifact'; ref: ArtifactRef; body: BoundedTextV1 | null };
export type ContinuationSourceCheckpointV1 = {
  kind: 'round_open' | 'requeue' | 'brief';
  at: string;
  workspaceRevision: number | null;
  sourceDigest: string | null;
  unavailableReason: string | null;
};
export type ContinuationSessionContinuity =
  | 'same_session_history'
  | 'same_session_without_previous_turn'
  | 'other_session_seeded'
  | 'other_session';
/**
 * Every field is required (null when absent) so the canonical digest is total.
 * The previous Run is always the requeue's afterRun.
 */
export type ContinuationBriefV1 = {
  schemaVersion: 1;
  /** The new (continuing) Run. */
  runRef: RunRef;
  task: TaskTriple;
  requeueRef: TaskRequeueRef;
  /** Class `interrupted` ⇒ `resume_after_interruption`; every other class ⇒ `rework`. */
  mode: 'rework' | 'resume_after_interruption';
  failureClass: ReworkFailureClass;
  trigger: {
    actorClass: ReworkActorClass;
    goalResume: boolean;
    /** This Task's n-th TaskRequeue, from 1. */
    requeueNumber: number;
    /** From the immutable `TaskRequeue.automation`; null for a non-automatic requeue. */
    autoRework: { count: number; cap: number } | null;
    /** At most `earlierRequeues`. */
    earlierRequeues: Array<{ afterRunId: string; failureClass: ReworkFailureClass }>;
  };
  previous: {
    runRef: RunRef;
    attemptRef: TaskAttemptRef;
    sessionRef: SessionRef;
    outcome: Exclude<RunOutcome, 'outcome_unknown'>;
    origin: RunFailureOrigin;
    interruption: { kind: 'executing' | 'paused'; kernelPaused: boolean; pausedBy: StopRequester | null } | null;
    /** Copied from `TaskRequeue.stopRequester`; `none` is recorded as null. */
    cancelledBy: Exclude<StopRequester, 'none'> | null;
    error: BoundedTextV1 | null;
    limit: { kind: string; observed: number; allowed: number } | null;
    budget: { previousTokenBudget: number; currentTokenBudget: number } | null;
    wait: { messageRef: SessionMessageRef; status: 'pending' | 'read' | 'responded' } | null;
    unacceptedSteers: Array<{ intentRef: ControlIntentRef; text: BoundedTextV1 }>;
    endedAt: string | null;
  };
  /** The nearest ancestor that entered the Kernel when afterRun never did (hops ≤ `factsFromHops`). */
  factsFrom: { runRef: RunRef; hops: number; truncated: boolean };
  stoppedAt: {
    kernel: 'read' | 'not_entered' | 'unavailable';
    reason: string | null;
    turnStatus: 'completed' | 'failed' | 'cancelled' | 'limit_exceeded' | 'yielded' | 'paused' | 'running' | null;
    lastPosition: number | null;
    lastToolGroup: { sourceMessageId: string; calls: number } | null;
    lastAssistant: BoundedTextV1 | null;
    window: { fromPosition: number; throughPosition: number; omittedRecords: number } | null;
  };
  toolCalls: {
    confirmed: ContinuationToolCallV1[];
    /** Kernel `pending`/abandoned calls (LA-7). */
    notExecuted: ContinuationToolCallV1[];
    unknown: ContinuationToolCallV1[];
    confirmedOmitted: number;
    notExecutedOmitted: number;
    unknownOmitted: number;
  };
  /** Empty for `same_session_history`: the history already holds them. */
  acceptedInputs: {
    steers: Array<{ intentRef: ControlIntentRef; text: BoundedTextV1 }>;
    steersOmitted: number;
    messages: Array<{ messageRef: SessionMessageRef; part: 'message' | 'response'; excerpt: BoundedTextV1 }>;
    messagesOmitted: number;
  };
  /** The previous Run's chain head. */
  checks: { roundRef: VerificationRoundRef; roundOrdinal: number; failing: FailingCheckFactV1[]; gapCodes: string[] } | null;
  requeue: { reason: BoundedTextV1; reasonAuthor: ReworkActorClass; newInputs: ContinuationNewInputV1[] };
  /** Best effort; never claims "no change" for a window it could not observe. */
  workspace: {
    selfChanged: { status: 'known' | 'partial' | 'not_entered' | 'unavailable'; confirmed: string[]; possible: string[]; omitted: number };
    checkpoints: ContinuationSourceCheckpointV1[];
    /** `from`/`to` are indexes into `checkpoints`; the verdict comes from `compareSourceCheckpoints`. */
    segments: Array<{ from: number; to: number; verdict: SourceChangeVerdictV1; reason: string }>;
    /** Previous Run end → first checkpoint (index `to`, null without one) is never observed. */
    unobserved: { from: 'previous_run_end'; to: number | null; previousEndedAt: string | null };
    uncommitted: { status: 'git' | 'not_git' | 'unavailable'; baseCommit: string | null; paths: string[]; omitted: number; reason: string | null };
  };
  session: {
    continuity: ContinuationSessionContinuity;
    /** The new Run's claim Session. */
    sessionRef: SessionRef;
    seededFrom: { sessionRef: SessionRef; throughPosition: number | null } | null;
    boundaryPosition: number | null;
  };
  /** Fixed instruction block (must say files may have changed; re-read before editing). Text change ⇒ new version. */
  standingInstructionVersion: 1;
};

/** Bounds of the brief; over-long fields are truncated and counted in `…Omitted` / `truncated`. */
export const CONTINUATION_BRIEF_LIMITS = Object.freeze({
  confirmedToolCalls: 40,
  notExecutedToolCalls: 20,
  unknownToolCalls: 20,
  /** Paths across `selfChanged` and across `uncommitted`. */
  paths: 64,
  pathsPerCall: 8,
  /** Kernel records read while assembling. */
  kernelRecords: 5000,
  /** Rendered text; the fixed instruction block is always kept. */
  renderedBytes: 16_384,
  earlierRequeues: 5,
  factsFromHops: 4,
  newInputs: 16,
  /** Per `BoundedTextV1` field, in UTF-16 code units. */
  textChars: 4000,
} as const);

// ------------------------------------------------------------------------ //
// Digest and marker                                                         //
// ------------------------------------------------------------------------ //
/** `RuntimeInputBindingV1.continuationBriefDigest` = sha256Hex(canonicalJson(brief)). */
export function continuationBriefDigest(brief: ContinuationBriefV1): string {
  return sha256Hex(canonicalJson(brief as unknown as JsonValue));
}
/** The second line of the rendered brief; WorkGraph re-renders and compares the suffix. */
export function continuationBriefMarker(digest: string): string {
  return `[continuation-brief v1 sha256:${digest}]`;
}

// ------------------------------------------------------------------------ //
// Source checkpoints                                                        //
// ------------------------------------------------------------------------ //
/** Any persisted stamp: a checkpoint, a round identity or a refusal's captured source. */
export type SourceCheckpointStampV1 = { sourceDigest: string | null; unavailableReason?: string | null };
/** Compares persisted stamps only; anything it cannot decide is `unknown`. */
export function compareSourceCheckpoints(
  from: SourceCheckpointStampV1 | null,
  to: SourceCheckpointStampV1 | null,
): { verdict: SourceChangeVerdictV1; reason: string } {
  if (from === null || to === null) return { verdict: 'unknown', reason: 'no persisted source checkpoint to compare with' };
  if (from.sourceDigest === null) return { verdict: 'unknown', reason: `the earlier checkpoint has no source digest${because(from)}` };
  if (to.sourceDigest === null) return { verdict: 'unknown', reason: `the later checkpoint has no source digest${because(to)}` };
  return from.sourceDigest === to.sourceDigest
    ? { verdict: 'unchanged', reason: 'the workspace source digest is identical' }
    : { verdict: 'changed', reason: 'the workspace source digest differs' };
}
function because(stamp: SourceCheckpointStampV1): string {
  return stamp.unavailableReason === undefined || stamp.unavailableReason === null ? '' : `: ${stamp.unavailableReason}`;
}

// ------------------------------------------------------------------------ //
// Chinese renderer                                                          //
// ------------------------------------------------------------------------ //
/**
 * Labels of the failure and actor classes (spec §2, "失败类别与操作者类别的标签").
 * The UI keeps its own copy (it cannot import contract values); a test asserts
 * that the copies agree.
 */
export const REWORK_FAILURE_CLASS_LABELS_ZH: Readonly<Record<ReworkFailureClass, string>> = Object.freeze({
  interrupted: '平台中断', cancelled: '已取消', check_failed: '检查未通过', run_failed: '执行失败', check_incomplete: '检查不完整',
});
export const REWORK_ACTOR_CLASS_LABELS_ZH: Readonly<Record<ReworkActorClass, string>> = Object.freeze({
  human: '人工', system: '系统自动', agent: 'Agent',
});
/** The fixed block of `standingInstructionVersion: 1`, always kept; changing its text is a new version. */
export const CONTINUATION_STANDING_INSTRUCTIONS_ZH_V1: readonly string[] = Object.freeze([
  '### 继续之前',
  '- 文件可能已经变化，编辑前先重新读取。',
  '- “结果未知”的工具调用可能已经产生副作用，重做之前先核实当前状态。',
  '- “没有执行”的工具调用没有产生结果，需要时重新发起。',
  '- 本说明只陈述持久记录中的事实；写明“无法确定”的地方不代表没有变化。',
]);

const STOP_REQUESTER_ZH: Readonly<Record<StopRequester, string>> = { human: '人工', goal_fan_out: '目标级控制', system: '系统', none: '无' };
const TOOL_RESULT_ZH: Readonly<Record<ContinuationToolCallV1['result'], string>> = {
  success: '成功', error: '出错', cancelled: '已取消', not_started: '未开始', outcome_unknown: '结果未知',
};
const SIDE_EFFECT_ZH: Readonly<Record<NonNullable<ContinuationToolCallV1['sideEffect']>, string>> = {
  none: '无副作用', possible: '可能有副作用', confirmed: '有副作用',
};
const WAIT_STATUS_ZH: Readonly<Record<'pending' | 'read' | 'responded', string>> = { pending: '尚未读取', read: '已读、未回复', responded: '已回复' };
const CHECKPOINT_ZH: Readonly<Record<ContinuationSourceCheckpointV1['kind'], string>> = {
  round_open: '检查轮次开始', requeue: '重新入队', brief: '本次执行开始前',
};
/** Successively shorter caps (UTF-16 code units) tried on every text before body items are left out. */
const RENDER_TEXT_CAPS: readonly number[] = [CONTINUATION_BRIEF_LIMITS.textChars, 1000, 250, 60];
const UTF8 = new TextEncoder();

/**
 * Renders the brief as the last section of `manifest.input` (spec §6.1 (e)):
 * line 1 is the title, line 2 `continuationBriefMarker(digest)`; WorkGraph
 * re-renders and compares this suffix. Pure and deterministic. The result stays
 * within `renderedBytes` UTF-8 bytes: every text is first cut shorter step by
 * step, then trailing body lines are left out with a note; the fixed
 * instruction block is always kept. Where the records cannot tell, it says so
 * and never claims "no change".
 *
 * The previous Run's ending: `origin: 'observed'` reads "执行记录" (D-7
 * not-entered cancels and RUN-23 are observed too); a not-entered Run renders
 * from `stoppedAt.kernel: 'not_entered'`; a RUN-23 cancel is recognized by the
 * synthesized `run_cancelled` reason carried in `stoppedAt.reason`
 * (`cancelled_at_reconcile`: Host-restart wording; `cancelled_while_paused`:
 * the in-process wording).
 */
export function renderContinuationBriefZh(brief: ContinuationBriefV1, digest: string): string {
  const head = ['## 接续说明', continuationBriefMarker(digest)];
  const tail = ['', ...CONTINUATION_STANDING_INSTRUCTIONS_ZH_V1];
  const limit = CONTINUATION_BRIEF_LIMITS.renderedBytes;
  let body: string[] = [];
  for (const cap of RENDER_TEXT_CAPS) {
    body = briefBodyZh(brief, cap);
    const text = [...head, ...body, ...tail].join('\n');
    if (utf8Length(text) <= limit) return text;
  }
  // Still too long with the shortest texts: keep the longest prefix of body lines that fits.
  const fixed = utf8Length([...head, ...tail].join('\n'));
  let used = fixed;
  let kept = 0;
  for (const line of body) {
    const next = used + 1 + utf8Length(line);
    if (next + 1 + utf8Length(omittedNoteZh(body.length - kept - 1)) > limit) break;
    used = next;
    kept += 1;
  }
  return [...head, ...body.slice(0, kept), omittedNoteZh(body.length - kept), ...tail].join('\n');
}

function omittedNoteZh(lines: number): string {
  return `……（接续说明超过 ${String(CONTINUATION_BRIEF_LIMITS.renderedBytes)} 字节，其余 ${String(lines)} 行已省略）`;
}
function utf8Length(text: string): number {
  return UTF8.encode(text).length;
}
/** `text` cut to `cap` UTF-16 code units without splitting a surrogate pair; continuation lines are indented. */
function clip(text: string, cap: number): string {
  let cut = text;
  if (text.length > cap) {
    const end = cap > 0 && /[\uD800-\uDBFF]/.test(text.charAt(cap - 1)) ? cap - 1 : cap;
    cut = `${text.slice(0, end)}…（已截断）`;
  }
  return cut.replace(/\r?\n/g, '\n  ');
}
function boundedZh(value: BoundedTextV1, cap: number): string {
  const text = clip(value.text, cap);
  return value.truncated && !text.endsWith('…（已截断）') ? `${text}…（已截断）` : text;
}
function listZh(items: readonly string[], cap: number): string {
  return items.length === 0 ? '无' : items.map((item) => clip(item, cap)).join('、');
}
function moreZh(omitted: number): string {
  return omitted > 0 ? `（另有 ${String(omitted)} 项未列出）` : '';
}

function briefBodyZh(brief: ContinuationBriefV1, cap: number): string[] {
  const t = (value: BoundedTextV1): string => boundedZh(value, cap);
  const lines: string[] = [];
  const section = (title: string): void => { lines.push('', `### ${title}`); };
  const trigger = brief.trigger;
  const previous = brief.previous;
  const stoppedAt = brief.stoppedAt;

  let summary = `这是任务 ${brief.task.taskId} 的接续执行（${brief.mode === 'rework' ? '返工' : '中断后继续'}）：`
    + `第 ${String(trigger.requeueNumber)} 次重新入队，失败类别：${REWORK_FAILURE_CLASS_LABELS_ZH[brief.failureClass]}，`
    + `发起方：${REWORK_ACTOR_CLASS_LABELS_ZH[trigger.actorClass]}`;
  if (trigger.goalResume) summary += '，随目标恢复接续';
  if (trigger.autoRework !== null) summary += `，自动返工 ${String(trigger.autoRework.count)}/${String(trigger.autoRework.cap)}`;
  lines.push(`${summary}。`);
  if (trigger.earlierRequeues.length > 0) {
    lines.push(`更早的重新入队：${trigger.earlierRequeues
      .map((earlier) => `${earlier.afterRunId}（${REWORK_FAILURE_CLASS_LABELS_ZH[earlier.failureClass]}）`).join('、')}。`);
  }
  lines.push(continuityZh(brief.session));

  section('上一次执行');
  lines.push(`- 执行 ${previous.runRef.runId}（Session ${previous.sessionRef.sessionId}）${endingZh(brief)}。`);
  if (brief.factsFrom.hops > 0) {
    lines.push(`- 下面的执行事实来自更早的执行 ${brief.factsFrom.runRef.runId}（向前第 ${String(brief.factsFrom.hops)} 次`
      + `${brief.factsFrom.truncated ? '，更早的执行未再查找' : ''}）。`);
  }
  if (previous.interruption !== null) {
    const interruption = previous.interruption;
    lines.push(`- 中断时${interruption.kind === 'paused' ? '处于暂停' : '正在执行'}，Kernel ${interruption.kernelPaused ? '已' : '未'}到达暂停点`
      + `${interruption.pausedBy === null || interruption.pausedBy === 'none' ? '' : `，暂停请求者：${STOP_REQUESTER_ZH[interruption.pausedBy]}`}。`);
  }
  if (previous.cancelledBy !== null) lines.push(`- 取消请求者：${STOP_REQUESTER_ZH[previous.cancelledBy]}。`);
  if (previous.error !== null) lines.push(`- 错误：${t(previous.error)}`);
  if (previous.limit !== null) {
    lines.push(`- 超出限制 ${clip(previous.limit.kind, cap)}：实际 ${String(previous.limit.observed)}，上限 ${String(previous.limit.allowed)}。`);
  }
  if (previous.budget !== null) {
    lines.push(`- token 预算：上一次 ${String(previous.budget.previousTokenBudget)}，本次 ${String(previous.budget.currentTokenBudget)}。`);
  }
  if (previous.wait !== null) lines.push(`- 等待的消息 ${previous.wait.messageRef.messageId}：${WAIT_STATUS_ZH[previous.wait.status]}。`);
  for (const steer of previous.unacceptedSteers) lines.push(`- 没有被 Kernel 接受的引导 ${steer.intentRef.intentId}：${t(steer.text)}`);
  if (previous.endedAt !== null) lines.push(`- 结束时间：${previous.endedAt}。`);

  section('停在哪里');
  if (stoppedAt.kernel === 'read') {
    lines.push(`- 执行记录读到位置 ${stoppedAt.lastPosition === null ? '未知' : String(stoppedAt.lastPosition)}，`
      + `Turn 状态：${stoppedAt.turnStatus ?? '未知'}。`);
  } else {
    lines.push(stoppedAt.kernel === 'not_entered' ? '- 没有进入 Kernel，没有执行记录。' : '- 执行记录无法读取，停在哪里无法确定。');
  }
  if (stoppedAt.reason !== null) lines.push(`- 原因：${clip(stoppedAt.reason, cap)}`);
  if (stoppedAt.lastToolGroup !== null) {
    lines.push(`- 最后一组工具调用：消息 ${stoppedAt.lastToolGroup.sourceMessageId}，${String(stoppedAt.lastToolGroup.calls)} 个调用。`);
  }
  if (stoppedAt.lastAssistant !== null) lines.push(`- 最后的助手输出：${t(stoppedAt.lastAssistant)}`);
  if (stoppedAt.window !== null) {
    lines.push(`- 读取的记录范围：位置 ${String(stoppedAt.window.fromPosition)}–${String(stoppedAt.window.throughPosition)}`
      + `${stoppedAt.window.omittedRecords > 0 ? `，其中 ${String(stoppedAt.window.omittedRecords)} 条未读` : ''}。`);
  }

  section('工具调用');
  const calls = brief.toolCalls;
  const groups: Array<[string, ContinuationToolCallV1[], number]> = [
    ['已有确定结果', calls.confirmed, calls.confirmedOmitted],
    ['没有执行（没有结果）', calls.notExecuted, calls.notExecutedOmitted],
    ['结果未知（可能已产生副作用）', calls.unknown, calls.unknownOmitted],
  ];
  if (groups.every(([, listed, omitted]) => listed.length === 0 && omitted === 0)) {
    lines.push(stoppedAt.kernel === 'unavailable' ? '- 执行记录无法读取，工具调用无法确定。' : '- 执行记录中没有工具调用。');
  }
  for (const [label, listed, omitted] of groups) {
    if (listed.length === 0 && omitted === 0) continue;
    lines.push(`- ${label}：${String(listed.length + omitted)} 个${moreZh(omitted)}`);
    for (const call of listed) lines.push(`  - ${toolCallZh(call, cap)}`);
  }

  if (brief.checks !== null) {
    const checks = brief.checks;
    section('检查');
    lines.push(`- 轮次 ${checks.roundRef.roundId}（第 ${String(checks.roundOrdinal)} 轮）未通过的检查：${checks.failing.length === 0 ? '无' : ''}`);
    for (const failing of checks.failing) {
      lines.push(`  - ${failing.checkId}：阶段 ${failing.phase}，结果 ${failing.outcome ?? '无'}`
        + `${failing.cause === null ? '' : `，原因 ${failing.cause}`}`
        + `${failing.reportRef === null ? '，没有报告' : `，报告 sha256:${failing.reportRef.digest}`}`);
    }
    if (checks.gapCodes.length > 0) lines.push(`- 缺口：${listZh(checks.gapCodes, cap)}`);
  }

  section('重新入队');
  lines.push(`- 原因（${REWORK_ACTOR_CLASS_LABELS_ZH[brief.requeue.reasonAuthor]}）：${t(brief.requeue.reason)}`);
  if (brief.requeue.newInputs.length === 0) lines.push('- 没有新输入。');
  for (const input of brief.requeue.newInputs) {
    lines.push(input.kind === 'session_message'
      ? `- 新输入：消息 ${input.ref.messageId}${input.replyBody === null ? '' : `，回复：${t(input.replyBody)}`}`
      : `- 新输入：材料 ${input.ref.contentType} sha256:${input.ref.digest}${input.body === null ? '' : `：${t(input.body)}`}`);
  }

  section('工作区');
  const workspace = brief.workspace;
  const self = workspace.selfChanged;
  if (self.status === 'unavailable') lines.push('- 上一次执行经工具改动的文件：无法确定。');
  else if (self.status === 'not_entered') lines.push('- 上一次执行没有进入 Kernel，没有经工具改动文件。');
  else {
    lines.push(`- 上一次执行经工具改动的文件（${self.status === 'known' ? '完整' : '不完整'}）：${listZh(self.confirmed, cap)}`
      + `${self.possible.length === 0 ? '' : `；可能改动：${listZh(self.possible, cap)}`}${moreZh(self.omitted)}`);
  }
  const unobservedTo = workspace.unobserved.to === null ? null : workspace.checkpoints[workspace.unobserved.to];
  lines.push(`- 上一次执行结束（${workspace.unobserved.previousEndedAt ?? '时间未知'}）到`
    + `${unobservedTo === undefined || unobservedTo === null ? '本次执行开始' : `“${CHECKPOINT_ZH[unobservedTo.kind]}”`}之间：`
    + '无法从持久记录确定是否有改动。');
  for (const segment of workspace.segments) {
    const from = workspace.checkpoints[segment.from];
    const to = workspace.checkpoints[segment.to];
    if (from === undefined || to === undefined) continue;
    const verdict = segment.verdict === 'changed' ? '有变化（具体文件无法从持久记录确定）'
      : segment.verdict === 'unchanged' ? '源码摘要相同' : `无法确定（${clip(segment.reason, cap)}）`;
    lines.push(`- ${CHECKPOINT_ZH[from.kind]} → ${CHECKPOINT_ZH[to.kind]}：${verdict}`);
  }
  const uncommitted = workspace.uncommitted;
  if (uncommitted.status === 'git') {
    lines.push(`- 未提交的改动（相对 ${uncommitted.baseCommit ?? '未知提交'}）：${listZh(uncommitted.paths, cap)}${moreZh(uncommitted.omitted)}`);
  } else if (uncommitted.status === 'not_git') {
    lines.push('- 工作区不是 git 仓库，未提交的改动无法列出。');
  } else {
    lines.push(`- 未提交的改动无法读取${uncommitted.reason === null ? '' : `：${clip(uncommitted.reason, cap)}`}。`);
  }

  const accepted = brief.acceptedInputs;
  if (accepted.steers.length + accepted.steersOmitted + accepted.messages.length + accepted.messagesOmitted > 0) {
    section('已接受的输入');
    for (const steer of accepted.steers) lines.push(`- 引导 ${steer.intentRef.intentId}：${t(steer.text)}`);
    if (accepted.steersOmitted > 0) lines.push(`- 另有 ${String(accepted.steersOmitted)} 条引导未列出。`);
    for (const message of accepted.messages) {
      lines.push(`- 消息 ${message.messageRef.messageId}（${message.part === 'message' ? '来信' : '回复'}）：${t(message.excerpt)}`);
    }
    if (accepted.messagesOmitted > 0) lines.push(`- 另有 ${String(accepted.messagesOmitted)} 条消息未列出。`);
  }
  return lines;
}

function endingZh(brief: ContinuationBriefV1): string {
  const previous = brief.previous;
  // `factsFrom.hops > 0` only when the previous Run itself never entered the Kernel.
  if (brief.stoppedAt.kernel === 'not_entered' || brief.factsFrom.hops > 0) return `没有进入 Kernel 就结束（${previous.outcome}）`;
  if (previous.outcome === 'cancelled' && brief.stoppedAt.reason === 'cancelled_at_reconcile') return '在 Host 重启核对时按你的取消结束';
  if (previous.outcome === 'cancelled' && brief.stoppedAt.reason === 'cancelled_while_paused') return '暂停后按取消请求结束';
  switch (previous.origin) {
    case 'observed':
      return `依据执行记录以 ${previous.outcome} 结束`;
    case 'host_interrupted':
      return `被 Host 重启中断，平台核对后记为 ${previous.outcome}`;
    case 'human_attested':
      return `的结果无法从执行记录确定，由人工认定为 ${previous.outcome}`;
  }
}

function continuityZh(session: ContinuationBriefV1['session']): string {
  const here = `Session ${session.sessionRef.sessionId}`;
  switch (session.continuity) {
    case 'same_session_history':
      return `接续方式：在同一 ${here} 中继续，上一次的对话历史仍在。`;
    case 'same_session_without_previous_turn':
      return `接续方式：在同一 ${here} 中继续，但上一次执行的 Turn 不在模型历史中。`;
    case 'other_session_seeded': {
      const seeded = session.seededFrom;
      const from = seeded === null ? '之前' : `Session ${seeded.sessionRef.sessionId}`
        + `${seeded.throughPosition === null ? '' : ` 到位置 ${String(seeded.throughPosition)}`}`;
      return `接续方式：在新的 ${here} 中继续，带有 ${from} 的历史。`;
    }
    case 'other_session':
      return `接续方式：在新的 ${here} 中继续，没有上一次的对话历史。`;
  }
}

function toolCallZh(call: ContinuationToolCallV1, cap: number): string {
  const parts = [`${call.name}（${call.callId}）：${TOOL_RESULT_ZH[call.result]}`];
  if (call.sideEffect !== null) parts.push(SIDE_EFFECT_ZH[call.sideEffect]);
  if (call.target !== null) parts.push(`目标 ${boundedZh(call.target, cap)}`);
  if (call.changedPaths.length > 0 || call.changedPathsOmitted > 0) {
    parts.push(`改动 ${listZh(call.changedPaths, cap)}${moreZh(call.changedPathsOmitted)}`);
  }
  if (call.error !== null) parts.push(`错误 ${boundedZh(call.error, cap)}`);
  return parts.join('；');
}

// ------------------------------------------------------------------------ //
// Shape validator (used by the manifest codec)                              //
// ------------------------------------------------------------------------ //
type Obj = Record<string, unknown>;
type Problem = string | null;
const LIMITS = CONTINUATION_BRIEF_LIMITS;
const ACTOR_CLASSES: readonly ReworkActorClass[] = ['human', 'system', 'agent'];
const STOP_REQUESTERS: readonly StopRequester[] = ['human', 'goal_fan_out', 'system', 'none'];
const KNOWN_OUTCOMES: readonly string[] = ['completed', 'failed', 'cancelled', 'budget_exhausted', 'crashed', 'yielded'];
const ORIGINS: readonly RunFailureOrigin[] = ['observed', 'host_interrupted', 'human_attested'];
const MESSAGE_STATUSES: readonly string[] = ['pending', 'read', 'responded'];
const TURN_STATUSES: readonly string[] = ['completed', 'failed', 'cancelled', 'limit_exceeded', 'yielded', 'paused', 'running'];
const TOOL_RESULTS: readonly string[] = ['success', 'error', 'cancelled', 'not_started', 'outcome_unknown'];
const SIDE_EFFECTS: readonly string[] = ['none', 'possible', 'confirmed'];
const CHECK_PHASES: readonly string[] = ['pending', 'executing', 'finished', 'interrupted'];
const SOURCE_REF_KINDS: readonly string[] = ['plan-revision', 'workspace', 'governance', 'artifact', 'memory'];
const CONTINUITIES: readonly ContinuationSessionContinuity[] = [
  'same_session_history', 'same_session_without_previous_turn', 'other_session_seeded', 'other_session',
];

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** The object with exactly `keys` (all required), or the problem. */
function exact(value: unknown, path: string, keys: readonly string[]): Obj | string {
  if (!isObj(value)) return `${path} must be an object`;
  for (const key of Object.keys(value)) if (!keys.includes(key)) return `${path} carries unknown field ${key}`;
  for (const key of keys) if (!Object.hasOwn(value, key)) return `${path}.${key} is required`;
  return value;
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function isSha256(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function inList(value: unknown, allowed: readonly string[], path: string): Problem {
  return typeof value === 'string' && allowed.includes(value) ? null : `${path} must be one of ${allowed.join('|')}`;
}
function nullableString(value: unknown, path: string): Problem {
  return value === null || typeof value === 'string' ? null : `${path} must be a string or null`;
}
function nullableCount(value: unknown, path: string): Problem {
  return value === null || isCount(value) ? null : `${path} must be a non-negative safe integer or null`;
}
function boolean(value: unknown, path: string): Problem {
  return typeof value === 'boolean' ? null : `${path} must be a boolean`;
}
function count(value: unknown, path: string): Problem {
  return isCount(value) ? null : `${path} must be a non-negative safe integer`;
}
function list(value: unknown, path: string, max: number | null, item: (entry: unknown, path: string) => Problem): Problem {
  if (!Array.isArray(value)) return `${path} must be an array`;
  if (max !== null && value.length > max) return `${path} holds more than ${max} entries`;
  for (const [index, entry] of value.entries()) {
    const problem = item(entry, `${path}[${index}]`);
    if (problem !== null) return problem;
  }
  return null;
}
function pathList(value: unknown, path: string, max: number): Problem {
  return list(value, path, max, (entry, at) => (nonEmpty(entry) ? null : `${at} must be a non-empty string`));
}
function boundedText(value: unknown, path: string): Problem {
  const text = exact(value, path, ['text', 'truncated']);
  if (typeof text === 'string') return text;
  if (typeof text['text'] !== 'string') return `${path}.text must be a string`;
  if (text['text'].length > LIMITS.textChars) return `${path}.text exceeds ${LIMITS.textChars} characters`;
  return boolean(text['truncated'], `${path}.truncated`);
}
function nullableBoundedText(value: unknown, path: string): Problem {
  return value === null ? null : boundedText(value, path);
}
function ref(value: unknown, path: string, aggregateType: string | null, fields: readonly string[]): Problem {
  const keys = aggregateType === null ? fields : ['aggregateType', ...fields];
  const record = exact(value, path, keys);
  if (typeof record === 'string') return record;
  if (aggregateType !== null && record['aggregateType'] !== aggregateType) return `${path}.aggregateType must be ${aggregateType}`;
  for (const field of fields) if (!nonEmpty(record[field])) return `${path}.${field} must be a non-empty string`;
  return null;
}
const runRef = (value: unknown, path: string): Problem => ref(value, path, 'Run', ['projectId', 'goalId', 'runId']);
const attemptRef = (value: unknown, path: string): Problem =>
  ref(value, path, 'TaskAttempt', ['projectId', 'goalId', 'taskId', 'attemptId']);
const taskTriple = (value: unknown, path: string): Problem => ref(value, path, null, ['projectId', 'goalId', 'taskId']);
const requeueRef = (value: unknown, path: string): Problem =>
  ref(value, path, 'TaskRequeue', ['projectId', 'goalId', 'taskId', 'afterRunId']);
const sessionRef = (value: unknown, path: string): Problem => ref(value, path, null, ['projectId', 'sessionId']);
const messageRef = (value: unknown, path: string): Problem =>
  ref(value, path, 'SessionMessage', ['projectId', 'workspaceId', 'messageId']);
const intentRef = (value: unknown, path: string): Problem =>
  ref(value, path, 'ControlIntent', ['projectId', 'workspaceId', 'intentId']);
const roundRef = (value: unknown, path: string): Problem =>
  ref(value, path, 'VerificationRound', ['projectId', 'workspaceId', 'goalId', 'taskId', 'runId', 'roundId']);
function artifactRef(value: unknown, path: string): Problem {
  const artifact = exact(value, path, ['kind', 'contentType', 'digest', 'sizeBytes', 'source']);
  if (typeof artifact === 'string') return artifact;
  if (artifact['kind'] !== 'artifact') return `${path}.kind must be artifact`;
  if (!nonEmpty(artifact['contentType'])) return `${path}.contentType must be a non-empty string`;
  if (!isSha256(artifact['digest'])) return `${path}.digest must be a sha256 hex`;
  if (!isCount(artifact['sizeBytes'])) return `${path}.sizeBytes must be a non-negative safe integer`;
  const source = artifact['source'];
  if (!isObj(source)) return `${path}.source must be an object`;
  for (const key of Object.keys(source)) {
    if (!['kind', 'refId', 'revision', 'digest'].includes(key)) return `${path}.source carries unknown field ${key}`;
  }
  return inList(source['kind'], SOURCE_REF_KINDS, `${path}.source.kind`)
    ?? (nonEmpty(source['refId']) ? null : `${path}.source.refId must be a non-empty string`)
    ?? (typeof source['revision'] === 'string' ? null : `${path}.source.revision must be a string`)
    ?? (source['digest'] === undefined || typeof source['digest'] === 'string' ? null : `${path}.source.digest must be a string`);
}

const BRIEF_KEYS = [
  'schemaVersion', 'runRef', 'task', 'requeueRef', 'mode', 'failureClass', 'trigger', 'previous', 'factsFrom',
  'stoppedAt', 'toolCalls', 'acceptedInputs', 'checks', 'requeue', 'workspace', 'session', 'standingInstructionVersion',
] as const;

/** Null when `value` is a well-formed `ContinuationBriefV1`; otherwise the first problem. */
export function continuationBriefShapeProblem(value: unknown): string | null {
  const brief = exact(value, 'continuationBrief', BRIEF_KEYS);
  if (typeof brief === 'string') return brief;
  if (brief['schemaVersion'] !== 1) return 'continuationBrief.schemaVersion must be 1';
  if (brief['standingInstructionVersion'] !== 1) return 'continuationBrief.standingInstructionVersion must be 1';
  const shape = runRef(brief['runRef'], 'continuationBrief.runRef')
    ?? taskTriple(brief['task'], 'continuationBrief.task')
    ?? requeueRef(brief['requeueRef'], 'continuationBrief.requeueRef')
    ?? inList(brief['mode'], ['rework', 'resume_after_interruption'], 'continuationBrief.mode')
    ?? inList(brief['failureClass'], REWORK_FAILURE_CLASSES, 'continuationBrief.failureClass')
    ?? triggerProblem(brief['trigger'])
    ?? previousProblem(brief['previous'])
    ?? factsFromProblem(brief['factsFrom'])
    ?? stoppedAtProblem(brief['stoppedAt'])
    ?? toolCallsProblem(brief['toolCalls'])
    ?? acceptedInputsProblem(brief['acceptedInputs'])
    ?? checksProblem(brief['checks'])
    ?? requeueProblem(brief['requeue'])
    ?? workspaceProblem(brief['workspace'])
    ?? sessionProblem(brief['session']);
  if (shape !== null) return shape;
  if ((brief['failureClass'] === 'interrupted') !== (brief['mode'] === 'resume_after_interruption')) {
    return 'continuationBrief.mode must be resume_after_interruption exactly when failureClass is interrupted';
  }
  return null;
}

function triggerProblem(value: unknown): Problem {
  const path = 'continuationBrief.trigger';
  const trigger = exact(value, path, ['actorClass', 'goalResume', 'requeueNumber', 'autoRework', 'earlierRequeues']);
  if (typeof trigger === 'string') return trigger;
  return inList(trigger['actorClass'], ACTOR_CLASSES, `${path}.actorClass`)
    ?? boolean(trigger['goalResume'], `${path}.goalResume`)
    ?? (Number.isSafeInteger(trigger['requeueNumber']) && (trigger['requeueNumber'] as number) >= 1
      ? null : `${path}.requeueNumber must be a positive safe integer`)
    ?? (trigger['autoRework'] === null ? null : autoReworkProblem(trigger['autoRework'], `${path}.autoRework`))
    ?? list(trigger['earlierRequeues'], `${path}.earlierRequeues`, LIMITS.earlierRequeues, (entry, at) => {
      const earlier = exact(entry, at, ['afterRunId', 'failureClass']);
      if (typeof earlier === 'string') return earlier;
      return (nonEmpty(earlier['afterRunId']) ? null : `${at}.afterRunId must be a non-empty string`)
        ?? inList(earlier['failureClass'], REWORK_FAILURE_CLASSES, `${at}.failureClass`);
    });
}
function autoReworkProblem(value: unknown, path: string): Problem {
  const auto = exact(value, path, ['count', 'cap']);
  if (typeof auto === 'string') return auto;
  return count(auto['count'], `${path}.count`) ?? count(auto['cap'], `${path}.cap`);
}

function previousProblem(value: unknown): Problem {
  const path = 'continuationBrief.previous';
  const previous = exact(value, path, [
    'runRef', 'attemptRef', 'sessionRef', 'outcome', 'origin', 'interruption', 'cancelledBy', 'error', 'limit',
    'budget', 'wait', 'unacceptedSteers', 'endedAt',
  ]);
  if (typeof previous === 'string') return previous;
  return runRef(previous['runRef'], `${path}.runRef`)
    ?? attemptRef(previous['attemptRef'], `${path}.attemptRef`)
    ?? sessionRef(previous['sessionRef'], `${path}.sessionRef`)
    ?? inList(previous['outcome'], KNOWN_OUTCOMES, `${path}.outcome`)
    ?? inList(previous['origin'], ORIGINS, `${path}.origin`)
    ?? (previous['interruption'] === null ? null : interruptionProblem(previous['interruption'], `${path}.interruption`))
    ?? (previous['cancelledBy'] === null ? null
      : inList(previous['cancelledBy'], STOP_REQUESTERS.filter((requester) => requester !== 'none'), `${path}.cancelledBy`))
    ?? nullableBoundedText(previous['error'], `${path}.error`)
    ?? (previous['limit'] === null ? null : limitProblem(previous['limit'], `${path}.limit`))
    ?? (previous['budget'] === null ? null : budgetProblem(previous['budget'], `${path}.budget`))
    ?? (previous['wait'] === null ? null : waitProblem(previous['wait'], `${path}.wait`))
    ?? list(previous['unacceptedSteers'], `${path}.unacceptedSteers`, null, steerProblem)
    ?? nullableString(previous['endedAt'], `${path}.endedAt`);
}
function interruptionProblem(value: unknown, path: string): Problem {
  const interruption = exact(value, path, ['kind', 'kernelPaused', 'pausedBy']);
  if (typeof interruption === 'string') return interruption;
  return inList(interruption['kind'], ['executing', 'paused'], `${path}.kind`)
    ?? boolean(interruption['kernelPaused'], `${path}.kernelPaused`)
    ?? (interruption['pausedBy'] === null ? null : inList(interruption['pausedBy'], STOP_REQUESTERS, `${path}.pausedBy`));
}
function limitProblem(value: unknown, path: string): Problem {
  const limit = exact(value, path, ['kind', 'observed', 'allowed']);
  if (typeof limit === 'string') return limit;
  return (nonEmpty(limit['kind']) ? null : `${path}.kind must be a non-empty string`)
    ?? count(limit['observed'], `${path}.observed`) ?? count(limit['allowed'], `${path}.allowed`);
}
function budgetProblem(value: unknown, path: string): Problem {
  const budget = exact(value, path, ['previousTokenBudget', 'currentTokenBudget']);
  if (typeof budget === 'string') return budget;
  return count(budget['previousTokenBudget'], `${path}.previousTokenBudget`)
    ?? count(budget['currentTokenBudget'], `${path}.currentTokenBudget`);
}
function waitProblem(value: unknown, path: string): Problem {
  const wait = exact(value, path, ['messageRef', 'status']);
  if (typeof wait === 'string') return wait;
  return messageRef(wait['messageRef'], `${path}.messageRef`) ?? inList(wait['status'], MESSAGE_STATUSES, `${path}.status`);
}
function steerProblem(value: unknown, path: string): Problem {
  const steer = exact(value, path, ['intentRef', 'text']);
  if (typeof steer === 'string') return steer;
  return intentRef(steer['intentRef'], `${path}.intentRef`) ?? boundedText(steer['text'], `${path}.text`);
}

function factsFromProblem(value: unknown): Problem {
  const path = 'continuationBrief.factsFrom';
  const factsFrom = exact(value, path, ['runRef', 'hops', 'truncated']);
  if (typeof factsFrom === 'string') return factsFrom;
  return runRef(factsFrom['runRef'], `${path}.runRef`)
    ?? (isCount(factsFrom['hops']) && factsFrom['hops'] <= LIMITS.factsFromHops
      ? null : `${path}.hops must be an integer 0..${LIMITS.factsFromHops}`)
    ?? boolean(factsFrom['truncated'], `${path}.truncated`);
}

function stoppedAtProblem(value: unknown): Problem {
  const path = 'continuationBrief.stoppedAt';
  const stoppedAt = exact(value, path, ['kernel', 'reason', 'turnStatus', 'lastPosition', 'lastToolGroup', 'lastAssistant', 'window']);
  if (typeof stoppedAt === 'string') return stoppedAt;
  return inList(stoppedAt['kernel'], ['read', 'not_entered', 'unavailable'], `${path}.kernel`)
    ?? nullableString(stoppedAt['reason'], `${path}.reason`)
    ?? (stoppedAt['turnStatus'] === null ? null : inList(stoppedAt['turnStatus'], TURN_STATUSES, `${path}.turnStatus`))
    ?? nullableCount(stoppedAt['lastPosition'], `${path}.lastPosition`)
    ?? (stoppedAt['lastToolGroup'] === null ? null : toolGroupProblem(stoppedAt['lastToolGroup'], `${path}.lastToolGroup`))
    ?? nullableBoundedText(stoppedAt['lastAssistant'], `${path}.lastAssistant`)
    ?? (stoppedAt['window'] === null ? null : windowProblem(stoppedAt['window'], `${path}.window`));
}
function toolGroupProblem(value: unknown, path: string): Problem {
  const group = exact(value, path, ['sourceMessageId', 'calls']);
  if (typeof group === 'string') return group;
  return (nonEmpty(group['sourceMessageId']) ? null : `${path}.sourceMessageId must be a non-empty string`)
    ?? count(group['calls'], `${path}.calls`);
}
function windowProblem(value: unknown, path: string): Problem {
  const window = exact(value, path, ['fromPosition', 'throughPosition', 'omittedRecords']);
  if (typeof window === 'string') return window;
  const shape = count(window['fromPosition'], `${path}.fromPosition`)
    ?? count(window['throughPosition'], `${path}.throughPosition`)
    ?? count(window['omittedRecords'], `${path}.omittedRecords`);
  if (shape !== null) return shape;
  return (window['fromPosition'] as number) <= (window['throughPosition'] as number)
    ? null : `${path}.fromPosition must not exceed throughPosition`;
}

function toolCallsProblem(value: unknown): Problem {
  const path = 'continuationBrief.toolCalls';
  const calls = exact(value, path, ['confirmed', 'notExecuted', 'unknown', 'confirmedOmitted', 'notExecutedOmitted', 'unknownOmitted']);
  if (typeof calls === 'string') return calls;
  return list(calls['confirmed'], `${path}.confirmed`, LIMITS.confirmedToolCalls, toolCallProblem)
    ?? list(calls['notExecuted'], `${path}.notExecuted`, LIMITS.notExecutedToolCalls, toolCallProblem)
    ?? list(calls['unknown'], `${path}.unknown`, LIMITS.unknownToolCalls, toolCallProblem)
    ?? count(calls['confirmedOmitted'], `${path}.confirmedOmitted`)
    ?? count(calls['notExecutedOmitted'], `${path}.notExecutedOmitted`)
    ?? count(calls['unknownOmitted'], `${path}.unknownOmitted`);
}
function toolCallProblem(value: unknown, path: string): Problem {
  const call = exact(value, path, ['callId', 'name', 'target', 'result', 'sideEffect', 'changedPaths', 'changedPathsOmitted', 'error']);
  if (typeof call === 'string') return call;
  return (nonEmpty(call['callId']) ? null : `${path}.callId must be a non-empty string`)
    ?? (nonEmpty(call['name']) ? null : `${path}.name must be a non-empty string`)
    ?? nullableBoundedText(call['target'], `${path}.target`)
    ?? inList(call['result'], TOOL_RESULTS, `${path}.result`)
    ?? (call['sideEffect'] === null ? null : inList(call['sideEffect'], SIDE_EFFECTS, `${path}.sideEffect`))
    ?? pathList(call['changedPaths'], `${path}.changedPaths`, LIMITS.pathsPerCall)
    ?? count(call['changedPathsOmitted'], `${path}.changedPathsOmitted`)
    ?? nullableBoundedText(call['error'], `${path}.error`);
}

function acceptedInputsProblem(value: unknown): Problem {
  const path = 'continuationBrief.acceptedInputs';
  const inputs = exact(value, path, ['steers', 'steersOmitted', 'messages', 'messagesOmitted']);
  if (typeof inputs === 'string') return inputs;
  return list(inputs['steers'], `${path}.steers`, null, steerProblem)
    ?? count(inputs['steersOmitted'], `${path}.steersOmitted`)
    ?? list(inputs['messages'], `${path}.messages`, null, (entry, at) => {
      const message = exact(entry, at, ['messageRef', 'part', 'excerpt']);
      if (typeof message === 'string') return message;
      return messageRef(message['messageRef'], `${at}.messageRef`)
        ?? inList(message['part'], ['message', 'response'], `${at}.part`)
        ?? boundedText(message['excerpt'], `${at}.excerpt`);
    })
    ?? count(inputs['messagesOmitted'], `${path}.messagesOmitted`);
}

function checksProblem(value: unknown): Problem {
  if (value === null) return null;
  const path = 'continuationBrief.checks';
  const checks = exact(value, path, ['roundRef', 'roundOrdinal', 'failing', 'gapCodes']);
  if (typeof checks === 'string') return checks;
  return roundRef(checks['roundRef'], `${path}.roundRef`)
    ?? (Number.isSafeInteger(checks['roundOrdinal']) && (checks['roundOrdinal'] as number) >= 1
      ? null : `${path}.roundOrdinal must be a positive safe integer`)
    ?? list(checks['failing'], `${path}.failing`, null, failingCheckProblem)
    ?? list(checks['gapCodes'], `${path}.gapCodes`, null, (entry, at) => (nonEmpty(entry) ? null : `${at} must be a non-empty string`));
}
function failingCheckProblem(value: unknown, path: string): Problem {
  const check = exact(value, path, ['checkId', 'phase', 'outcome', 'cause', 'reportRef']);
  if (typeof check === 'string') return check;
  return (nonEmpty(check['checkId']) ? null : `${path}.checkId must be a non-empty string`)
    ?? inList(check['phase'], CHECK_PHASES, `${path}.phase`)
    ?? (check['outcome'] === null ? null : inList(check['outcome'], EVIDENCE_OUTCOMES, `${path}.outcome`))
    ?? (check['cause'] === null ? null : inList(check['cause'], ROUND_CHECK_INCOMPLETE_CAUSES, `${path}.cause`))
    ?? (check['reportRef'] === null ? null : artifactRef(check['reportRef'], `${path}.reportRef`));
}

function requeueProblem(value: unknown): Problem {
  const path = 'continuationBrief.requeue';
  const requeue = exact(value, path, ['reason', 'reasonAuthor', 'newInputs']);
  if (typeof requeue === 'string') return requeue;
  return boundedText(requeue['reason'], `${path}.reason`)
    ?? inList(requeue['reasonAuthor'], ACTOR_CLASSES, `${path}.reasonAuthor`)
    ?? list(requeue['newInputs'], `${path}.newInputs`, LIMITS.newInputs, newInputProblem);
}
function newInputProblem(value: unknown, path: string): Problem {
  if (!isObj(value)) return `${path} must be an object`;
  if (value['kind'] === 'session_message') {
    const input = exact(value, path, ['kind', 'ref', 'replyBody']);
    if (typeof input === 'string') return input;
    return messageRef(input['ref'], `${path}.ref`) ?? nullableBoundedText(input['replyBody'], `${path}.replyBody`);
  }
  if (value['kind'] === 'artifact') {
    const input = exact(value, path, ['kind', 'ref', 'body']);
    if (typeof input === 'string') return input;
    return artifactRef(input['ref'], `${path}.ref`) ?? nullableBoundedText(input['body'], `${path}.body`);
  }
  return `${path}.kind must be session_message or artifact`;
}

function workspaceProblem(value: unknown): Problem {
  const path = 'continuationBrief.workspace';
  const workspace = exact(value, path, ['selfChanged', 'checkpoints', 'segments', 'unobserved', 'uncommitted']);
  if (typeof workspace === 'string') return workspace;
  const checkpoints = workspace['checkpoints'];
  const shape = selfChangedProblem(workspace['selfChanged'], `${path}.selfChanged`)
    ?? list(checkpoints, `${path}.checkpoints`, null, checkpointProblem)
    ?? uncommittedProblem(workspace['uncommitted'], `${path}.uncommitted`);
  if (shape !== null) return shape;
  const checkpointCount = (checkpoints as unknown[]).length;
  const isIndex = (index: unknown): boolean => isCount(index) && index < checkpointCount;
  return list(workspace['segments'], `${path}.segments`, null, (entry, at) => {
    const segment = exact(entry, at, ['from', 'to', 'verdict', 'reason']);
    if (typeof segment === 'string') return segment;
    return (isIndex(segment['from']) && isIndex(segment['to']) ? null : `${at}.from/to must be checkpoint indexes`)
      ?? inList(segment['verdict'], ['changed', 'unchanged', 'unknown'], `${at}.verdict`)
      ?? (typeof segment['reason'] === 'string' ? null : `${at}.reason must be a string`);
  }) ?? unobservedProblem(workspace['unobserved'], `${path}.unobserved`, isIndex);
}
function selfChangedProblem(value: unknown, path: string): Problem {
  const changed = exact(value, path, ['status', 'confirmed', 'possible', 'omitted']);
  if (typeof changed === 'string') return changed;
  const shape = inList(changed['status'], ['known', 'partial', 'not_entered', 'unavailable'], `${path}.status`)
    ?? pathList(changed['confirmed'], `${path}.confirmed`, LIMITS.paths)
    ?? pathList(changed['possible'], `${path}.possible`, LIMITS.paths)
    ?? count(changed['omitted'], `${path}.omitted`);
  if (shape !== null) return shape;
  return (changed['confirmed'] as unknown[]).length + (changed['possible'] as unknown[]).length <= LIMITS.paths
    ? null : `${path} lists more than ${LIMITS.paths} paths`;
}
function checkpointProblem(value: unknown, path: string): Problem {
  const checkpoint = exact(value, path, ['kind', 'at', 'workspaceRevision', 'sourceDigest', 'unavailableReason']);
  if (typeof checkpoint === 'string') return checkpoint;
  return inList(checkpoint['kind'], ['round_open', 'requeue', 'brief'], `${path}.kind`)
    ?? (nonEmpty(checkpoint['at']) ? null : `${path}.at must be a non-empty string`)
    ?? nullableCount(checkpoint['workspaceRevision'], `${path}.workspaceRevision`)
    ?? (checkpoint['sourceDigest'] === null || isSha256(checkpoint['sourceDigest'])
      ? null : `${path}.sourceDigest must be a sha256 hex or null`)
    ?? nullableString(checkpoint['unavailableReason'], `${path}.unavailableReason`);
}
function unobservedProblem(value: unknown, path: string, isIndex: (index: unknown) => boolean): Problem {
  const unobserved = exact(value, path, ['from', 'to', 'previousEndedAt']);
  if (typeof unobserved === 'string') return unobserved;
  return (unobserved['from'] === 'previous_run_end' ? null : `${path}.from must be previous_run_end`)
    ?? (unobserved['to'] === null || isIndex(unobserved['to']) ? null : `${path}.to must be a checkpoint index or null`)
    ?? nullableString(unobserved['previousEndedAt'], `${path}.previousEndedAt`);
}
function uncommittedProblem(value: unknown, path: string): Problem {
  const uncommitted = exact(value, path, ['status', 'baseCommit', 'paths', 'omitted', 'reason']);
  if (typeof uncommitted === 'string') return uncommitted;
  return inList(uncommitted['status'], ['git', 'not_git', 'unavailable'], `${path}.status`)
    ?? nullableString(uncommitted['baseCommit'], `${path}.baseCommit`)
    ?? pathList(uncommitted['paths'], `${path}.paths`, LIMITS.paths)
    ?? count(uncommitted['omitted'], `${path}.omitted`)
    ?? nullableString(uncommitted['reason'], `${path}.reason`);
}

function sessionProblem(value: unknown): Problem {
  const path = 'continuationBrief.session';
  const session = exact(value, path, ['continuity', 'sessionRef', 'seededFrom', 'boundaryPosition']);
  if (typeof session === 'string') return session;
  return inList(session['continuity'], CONTINUITIES, `${path}.continuity`)
    ?? sessionRef(session['sessionRef'], `${path}.sessionRef`)
    ?? (session['seededFrom'] === null ? null : seededFromProblem(session['seededFrom'], `${path}.seededFrom`))
    ?? nullableCount(session['boundaryPosition'], `${path}.boundaryPosition`);
}
function seededFromProblem(value: unknown, path: string): Problem {
  const seeded = exact(value, path, ['sessionRef', 'throughPosition']);
  if (typeof seeded === 'string') return seeded;
  return sessionRef(seeded['sessionRef'], `${path}.sessionRef`)
    ?? nullableCount(seeded['throughPosition'], `${path}.throughPosition`);
}
