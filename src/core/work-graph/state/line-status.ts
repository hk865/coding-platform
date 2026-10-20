/**
 * Slice 2C pure line state (spec §3.2–§3.6, §3.9; L1a, L1b, L10, L16).
 *
 * Everything here is a pure function over facts the views read: no store, no
 * clock, no model. `deriveLineStatus` is the one place the own word, the
 * attention, the markers, the bucket and the archived tag are computed, so the
 * list, the hover card and the detail always agree.
 *
 * The input types live here (not in `src/contracts/`) because they name
 * `state/task-machine.ts` types (`TaskState`, `TaskReworkFacts`), which
 * `contracts/` cannot reach.
 */
import type { ControlIntentSnapshotV1 } from '../../../contracts/control-intent.js';
import type { ModuleRef, SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError } from '../../../contracts/core/results.js';
import type { SessionArchiveRequestV1 } from '../../../contracts/core/session-archive.js';
import type { SessionHealthConclusion, SessionRecord } from '../../../contracts/core/session.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import type { DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import type { GoalDesiredState } from '../../../contracts/ledger.js';
import type { Disposition, Phase } from '../../../contracts/plan.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { QueryExecutionStateV1, QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { TaskPhaseCauseV1 } from '../../../contracts/task-failure.js';
import type { ReworkFailureClass } from '../../../contracts/task-requeue.js';
import type {
  LineArchivedTagV1, LineAttentionCodeV1, LineAttentionV1, LineBucketV1, LineChainEntryV1, LineControlKindV1,
  LineControlV1, LineCountV1, LineHistoryPartV1, LineMarkerV1, LineOwnStateV1, LineReasonCodeV1, LineReasonV1,
  LineSourceRefV1, LineStatusV1, TaskDisplayFactsV1,
} from '../../../contracts/work-line.js';
import { controlSubmissionProblem, type ControlPointerIntent } from './control-intent-machine.js';
import { isPausedInterrupted, runControlNodeOf } from './run-machine.js';
import { stopRequesterOf } from './task-failure.js';
import { taskRequeueStateProblem, type TaskReworkFacts, type TaskState } from './task-machine.js';

// -------------------------------------------------------------------------- //
// Pure-function inputs (spec §2)                                             //
// -------------------------------------------------------------------------- //

export type LineCardInputV1 = { senderSessionRef: SessionRef | null; forwardedFromSender: SessionRef | null;
  taskPins: TaskTriple[];                             // 目标原因卡取 source.pins 里的任务 pin，其它卡取 objects 里的（L8）
  excluded: boolean };                                // required_task_deferred 等不落到线上的（L8）
export type LineOwnerIndexV1 = { lineOfSession: Map<string, SessionRef[]>;   // Session 的规范键 → 它所在的线（前任可在几条线上）
  linesOfTask: Map<string, SessionRef[]> };          // 任务的规范键 → 现在负责它的线
export type LineTaskArchiveNextV1 = { kind: 'dispatch' } | { kind: 'human_continue' }
  | { kind: 'goal_stopped'; desiredState: 'paused' | 'cancelled' } | { kind: 'rework_blocked'; code: string };
export type LineCardFactV1 = { source: DecisionSourceV1; cardKey: string;
  code: string | null; codeReadable: boolean };                           // code：目标原因码；消息卡为 null；解析不了 codeReadable=false
export type LineTaskFactV1 = {
  task: TaskTriple; title: string; planOrder: number;
  goalDesiredState: GoalDesiredState;
  phase: Phase; phaseCause: TaskPhaseCauseV1 | null; disposition: Disposition;
  everRan: boolean;                                   // 这个任务有没有过 Run
  terminal: boolean;                                  // satisfied，或处置 cancelled/superseded
  lastRequeue: { automatic: boolean; failureClass: ReworkFailureClass; autoCount: number; cap: number } | null;
  module: ModuleRef | null;
  anomaly: { pending: LineCountV1; next: LineTaskArchiveNextV1 | null } | null;   // null = 没有未接手的锚点
  anomalyComplete: boolean;
  cards: LineCardFactV1[];                            // 落到这个任务上的 waiting_answer 卡
};
export type LineFactsV1 = {
  head: SessionRecord;
  chain: LineChainEntryV1[]; omitted: LineCountV1;    // 线头在前
  duty: PlatformDutyV1 | 'unknown';
  holder:
    | { kind: 'run'; run: LineRunFactsV1 }
    | { kind: 'query'; query: QueryRunSnapshot }
    | { kind: 'maintenance' }
    | null;
  latestWork: (LineRunFactsV1 & { waitRecipient: SessionRef | 'user' | null }) | null;   // 没有占用时才填；generation 最大的那次
  responsibleOpen: LineTaskFactV1[];                  // 链上开着的 task 负责链接，去重
  responsibleOpenOther: ('work' | 'module')[];        // 链上开着的 work、module 负责链接
  doneEvidence: LineDoneEvidenceV1;                   // L1a；不是执行者、或现在负责的任务没全终结时 not_applicable
  pausedTasks: LinePausedTaskFactsV1[];               // L16：每个暂停中断的任务一项，给“继续”和 T0、T3(c) 用
  lineCards: LineCardFactV1[];                        // 发卡 Session 在线上、或转来的原消息发信 Session 在线上的 waiting_answer 卡
  writtenAnchorsPending: LineCountV1;                 // 线上 Session 写下、还没被接手的锚点；超读预算时 partial（L1b）
  /** L1b/§3.4: the authoritative archive-state `next` of the outstanding written anchors. */
  writtenAnchorsNext?: LineTaskArchiveNextV1 | null;
  copies: { session: SessionRef; phase: QueryExecutionStateV1['phase'] | null;
    startedAt: string | null }[];                     // 活跃副本（L10：副本那一轮的 startedAt 也算最近活动）
  undelivered: { status: 'not_applicable' } | LineCountV1;   // 线头可用时 not_applicable；超读预算时 partial（L1b）
  partialParts: { part: LineHistoryPartV1; reason: string }[];   // L1b：原样进 LineStatusV1
  handoffFrom: SessionRef | null; handoffFromLine: SessionRef | null;
  handedTo: SessionRef | null;                        // 已归档线：它的换手接任者
  unknownCallReviewsPending: number;                  // K3 合入前恒为 0
  queueComplete: boolean;
  pinned: boolean;
  lastActivityAt: string;
  /**
   * The row-level read problem (`LineRowV1.problem`). B4 makes `bucket: null`
   * before any other bucket when it is set (spec §3.5). Optional because the
   * happy path has none.
   */
  problem?: { code: CoreError | 'source_moving'; reason: string } | null;
};
export type LineRunFactsV1 = {                        // 控制和状态要用的一次 Run 的事实（L16）
  run: RunSnapshot;
  pointer: ControlIntentSnapshotV1 | null;            // controlState.intentRef 指的意图
  pointerFromGoal: boolean;                           // GOAL-29 的那一种：意图是目标扇出的暂停
  continuationConsumed: boolean;                      // RD-8：YieldedWait 的接续已被后继 Run 用掉
  goalDesiredState: GoalDesiredState;                 // 这次 Run 所属目标
  /** L10 claim-time fallback (from the DispatchOutboxEntry claim); null when not read. */
  claimedAt?: string | null;
};
export type LineClosureModeV1 = 'terminal' | 'transfer' | 'drop' | 'unknown';
export type LineDoneEvidenceV1 =                      // 纯函数照 L1a 的真值表（DE1–DE5）算结论；这里只放读到的事实
  | { status: 'not_applicable' }
  | { status: 'read';
      openTerminal: { task: TaskTriple; title: string }[];   // L1a (a)：线上开着的负责链接、任务现在已终结；不受预算管
      recent: { task: TaskTriple; title: string; closure: LineClosureModeV1; archiveStep: boolean }[];
      // L1a (b)：H 最新的关了的 task 负责链接，最新的在前，至多 21 条；closure 由 eventAt(until) 读出，对不上记 unknown；
      // 预算用完时只有用完以前读到的那几条
      total: LineCountV1;                             // 关了的 task 负责链接总数（countLookup）；预算用完、没数到时 unavailable
      budgetExhausted: boolean };                     // L1b：读预算在 21 条读完之前用完了
export type LinePausedTaskFactsV1 = {                 // L16：现在负责的、原因是 paused_interrupted 的一个任务
  task: TaskTriple;
  afterRun: LineRunFactsV1;                           // 原因里 afterRunRef 那次 Run，和它的指针意图
  state: TaskState;                                   // 重新入队检查要的（task-machine.ts 的 TaskState）
  rework: TaskReworkFacts;                            // 选中的 Run、afterRunIsSelected、检查链、依据、Goal 状态
  pins: VersionPin[];                                 // 提交 tasks/requeue 要带的版本
};

// -------------------------------------------------------------------------- //
// Canonical keys (the view and this module must agree)                       //
// -------------------------------------------------------------------------- //

/** Canonical JSON key of a ref, used to key `LineOwnerIndexV1` (spec L8). */
function refKey(ref: unknown): string {
  return canonicalJsonOf(ref);
}
/** Canonical JSON key of a task triple, used to key `LineOwnerIndexV1`. */
function taskKey(task: TaskTriple): string {
  return canonicalJsonOf(task);
}

function canonicalJsonOf(value: unknown): string {
  // The refs are plain JSON records; `canonicalJson` ignores key order.
  return canonicalJson(value as never);
}

// -------------------------------------------------------------------------- //
// Fall-through walk (L8)                                                     //
// -------------------------------------------------------------------------- //

/**
 * The lines one waiting-answer card falls on (spec L8): the sender's line, a
 * forwarded card's original sender line, and every task pin's responsible
 * lines; one line appears once. `excluded` cards (deferred tasks and the other
 * non-line goal causes) fall on no line at all.
 */
export function cardLineKeys(card: LineCardInputV1, owners: LineOwnerIndexV1): SessionRef[] {
  if (card.excluded) return [];
  const lines = new Map<string, SessionRef>();
  const add = (refs: readonly SessionRef[] | undefined): void => {
    if (refs === undefined) return;
    for (const ref of refs) {
      const key = refKey(ref);
      if (!lines.has(key)) lines.set(key, ref);
    }
  };
  if (card.senderSessionRef !== null) add(owners.lineOfSession.get(refKey(card.senderSessionRef)));
  if (card.forwardedFromSender !== null) add(owners.lineOfSession.get(refKey(card.forwardedFromSender)));
  for (const task of card.taskPins) add(owners.linesOfTask.get(taskKey(task)));
  return [...lines.values()];
}

// -------------------------------------------------------------------------- //
// Attention (§3.4)                                                           //
// -------------------------------------------------------------------------- //

const ATTENTION_RANK: Record<LineAttentionCodeV1, number> = { decide: 0, failed: 1, blocked: 2, unknown: 3 };

/** `classifyTaskAttention`: the attention one currently-responsible task gives (AT2–AT4; AT0 → null). */
export function classifyTaskAttention(task: LineTaskFactV1): LineAttentionV1 | null {
  const cause = task.phaseCause?.code ?? null;
  // AT2、AT3 don't apply on a cancelled Goal (L19); AT4 does.
  if (task.goalDesiredState !== 'cancelled') {
    const failed = taskAttentionFailed(task, cause);
    if (failed !== null) return failed;
    const blocked = taskAttentionBlocked(task, cause);
    if (blocked !== null) return blocked;
  }
  // AT4: a result the platform cannot trust is hidden by nothing.
  if (cause === 'run_outcome_unknown') return attention('unknown', reason('run_outcome_unknown'));
  if (task.anomaly !== null) return attention('unknown', anomalyPendingReason(task.anomaly));
  return null;
}

function taskAttentionFailed(task: LineTaskFactV1, cause: TaskPhaseCauseV1['code'] | null): LineAttentionV1 | null {
  if (task.phase === 'failed') {
    const code: LineReasonCodeV1 = cause === 'check_failed' ? 'check_failed'
      : cause === 'continuation_cancelled' ? 'continuation_cancelled'
        : 'run_failed';
    return attention('failed', reason(code));
  }
  const requeue = task.lastRequeue;
  if (isPendingPhase(task.phase) && requeue !== null && requeue.automatic
    && (requeue.failureClass === 'run_failed' || requeue.failureClass === 'check_failed')) {
    return attention('failed', reason(requeue.failureClass, autoRequeueParams(requeue)));
  }
  return null;
}

function taskAttentionBlocked(task: LineTaskFactV1, cause: TaskPhaseCauseV1['code'] | null): LineAttentionV1 | null {
  if (task.phase === 'blocked' && (cause === 'round_inconclusive' || cause === 'check_interrupted'
    || cause === 'round_ambiguous' || cause === 'origin_unresolvable' || cause === 'run_failed')) {
    return attention('blocked', reason(cause));
  }
  const requeue = task.lastRequeue;
  if (isPendingPhase(task.phase) && requeue !== null && requeue.automatic
    && requeue.failureClass === 'check_incomplete') {
    return attention('blocked', reason('round_inconclusive', autoRequeueParams(requeue)));
  }
  return null;
}

function isPendingPhase(phase: Phase): boolean {
  return phase === 'pending' || phase === 'ready';
}

function autoRequeueParams(requeue: NonNullable<LineTaskFactV1['lastRequeue']>): Record<string, string | number> {
  return { autoCount: requeue.autoCount, cap: requeue.cap };
}

function anomalyPendingReason(anomaly: NonNullable<LineTaskFactV1['anomaly']>): LineReasonV1 {
  const next = anomaly.next;
  if (next === null) return reason('anomaly_pending');
  switch (next.kind) {
    case 'dispatch': return reason('anomaly_pending', { next: 'dispatch' });
    case 'human_continue': return reason('anomaly_pending', { next: 'human_continue' });
    case 'goal_stopped': return reason('anomaly_pending', { next: 'goal_stopped', goal: next.desiredState });
    case 'rework_blocked': return reason('anomaly_pending', { next: 'rework_blocked', code: next.code });
    default: return reason('anomaly_pending');
  }
}

/** §3.4 AT4: the written-anchor attention uses the read archive-state `next`, never a guessed dispatch. */
function writtenAnchorsReason(facts: LineFactsV1): LineReasonV1 {
  return anomalyPendingReason({ pending: facts.writtenAnchorsPending, next: facts.writtenAnchorsNext ?? null });
}

/**
 * Task display facts (spec §2, L21): the projection the task hover and the node
 * detail show next to the formal `phase`, without changing it. A task that was
 * cancelled or superseded and never ran is shown as cancelled/superseded; a
 * task with an unclaimed anchor keeps its "中断，待核对" label and `next`; the
 * attention is the same one the line table computes (§3.4).
 */
export function deriveTaskDisplayFacts(task: LineTaskFactV1): TaskDisplayFactsV1 {
  const neverRanTerminal = !task.everRan && (task.disposition === 'cancelled' || task.disposition === 'superseded')
    ? task.disposition
    : null;
  const anomaly = task.anomaly === null
    ? null
    : { label: '中断，待核对' as const, next: anomalyPendingReason(task.anomaly), pending: task.anomaly.pending };
  return { neverRanTerminal, anomaly, attention: classifyTaskAttention(task) };
}

export function deriveLineStatus(facts: LineFactsV1): LineStatusV1 {
  const archived = facts.head.lifecycle === 'archived';
  const done = evaluateDoneEvidence(facts, archived);
  const ownState = archived ? archivedOwn(facts, done) : activeOwn(facts, done);
  const markers = deriveMarkers(facts);
  const attentionState = deriveAttention(facts);
  const status: LineStatusV1 = {
    own: ownState.own,
    ownReason: ownState.ownReason,
    attention: attentionState.attention,
    attentionCounts: attentionState.counts,
    attentionComplete: attentionState.complete,
    doneEvidence: done.evidence,
    partialParts: facts.partialParts,
    markers,
    bucket: deriveBucket(facts, archived, ownState.own, markers),
    archivedTag: archived ? archivedLineTag(facts) : null,
    readOnly: archived || ownState.own === 'retired',
  };
  return status;
}

function activeOwn(facts: LineFactsV1, done: DoneVerdict): { own: LineOwnStateV1; ownReason: LineReasonV1 } {
  const head = facts.head;
  const holder = facts.holder;
  if (head.health === 'unavailable') {
    const t0 = pausedInterruptedT0(facts);
    if (t0 !== null) return { own: 'paused', ownReason: t0 };
    return { own: 'retired', ownReason: retiredReason(head.healthConclusion ?? null) };
  }
  // T2
  if (holder !== null && holder.kind === 'run' && holder.run.run.status === 'ended'
    && holder.run.run.outcome === 'outcome_unknown') {
    return { own: 'unknown', ownReason: reason('unknown_run') };
  }
  if (holder !== null && holder.kind === 'query' && holder.query.run.executionState?.phase === 'unknown') {
    return { own: 'unknown', ownReason: reason('unknown_query') };
  }
  if (head.health === 'recoverable') return { own: 'unknown', ownReason: reason('health_recoverable') };
  if (holder !== null && holder.kind === 'maintenance') return { own: 'unknown', ownReason: reason('occupancy_unexplained') };
  // T3
  if (holder !== null && holder.kind === 'run' && holder.run.run.status === 'running'
    && isAppliedPause(holder.run.pointer)) {
    return { own: 'paused', ownReason: pauseReason(holder.run.pointerFromGoal) };
  }
  if (holder === null && facts.latestWork !== null && isYielded(facts.latestWork.run)
    && hasContinuation(facts.latestWork.run) && facts.latestWork.run.controlState?.desiredState === 'paused') {
    return { own: 'paused', ownReason: reason('paused_yielded') };
  }
  if (holder === null && facts.pausedTasks.length > 0) {
    const paused = facts.pausedTasks[0]!;
    return { own: 'paused', ownReason: pausedInterruptedReason(paused.afterRun.pointerFromGoal, paused.afterRun.goalDesiredState) };
  }
  if (holder !== null && holder.kind === 'run' && holder.run.run.status === 'starting'
    && isAppliedPause(holder.run.pointer)) {
    return { own: 'paused', ownReason: pauseReason(holder.run.pointerFromGoal) };
  }
  // T4
  if (holder !== null && holder.kind === 'run' && holder.run.run.status === 'starting') {
    return { own: 'starting', ownReason: reason('starting') };
  }
  if (holder !== null && holder.kind === 'query' && isStartingQuery(holder.query)) {
    return { own: 'starting', ownReason: reason('starting') };
  }
  // T5
  if (holder !== null && holder.kind === 'run' && holder.run.run.status === 'running') {
    return { own: 'working', ownReason: reason('running_task', { task: holder.run.run.task.taskId }) };
  }
  if (holder !== null && holder.kind === 'query' && holder.query.run.executionState?.phase === 'entered') {
    return { own: 'working', ownReason: reason('query_turn') };
  }
  // T6
  if (holder === null && facts.responsibleOpen.some((task) => task.phaseCause?.code === 'verification_running')) {
    return { own: 'checking', ownReason: reason('checking') };
  }
  const waiting = isWaitingReply(facts);
  // T7
  if (waiting) {
    const recipient = facts.latestWork?.waitRecipient ?? null;
    return { own: 'waiting_reply', ownReason: reason('waiting_reply', recipient === null ? {}
      : { recipient: recipient === 'user' ? 'user' : recipient.sessionId }) };
  }
  // T8
  if (isExecutorEvidenceReady(facts, waiting) && done.done) {
    return { own: 'done', ownReason: reason('done_tasks', { count: facts.responsibleOpen.length }) };
  }
  // T9
  return { own: 'standby', ownReason: standbyReason(facts, done, waiting) };
}

function archivedOwn(facts: LineFactsV1, done: DoneVerdict): { own: LineOwnStateV1; ownReason: LineReasonV1 } {
  if (facts.head.health === 'unavailable') {
    return { own: 'retired', ownReason: retiredReason(facts.head.healthConclusion ?? null) };
  }
  if (done.done) return { own: 'done', ownReason: reason('done_tasks', { count: facts.doneEvidence.status === 'read' ? facts.doneEvidence.recent.length : 0 }) };
  // L1a DE5 / §3.6 A3: an archived line whose closed links were not read in full says so.
  if (done.evidence === 'incomplete') return { own: 'standby', ownReason: reason('done_unproven') };
  if (facts.handedTo !== null) return { own: 'standby', ownReason: reason('handed_to') };
  return { own: 'standby', ownReason: reason('archived') };
}

/** T0: the pause binds to the latest Work Run itself (`afterRunRef`), not just to any paused task. */
function pausedInterruptedT0(facts: LineFactsV1): LineReasonV1 | null {
  if (facts.head.healthConclusion !== 'kernel_turn_open') return null;
  const latest = facts.latestWork;
  if (latest === null) return null;
  if (!isPausedInterrupted(latest.run)) return null;
  const bound = facts.responsibleOpen.find((task) => sameTask(task.task, latest.run.task)
    && task.phaseCause?.code === 'paused_interrupted'
    && task.phaseCause.detail?.afterRunRef !== undefined
    && sameRun(task.phaseCause.detail.afterRunRef, latest.run.ref));
  if (bound === undefined) return null;
  return pausedInterruptedReason(latest.pointerFromGoal, latest.goalDesiredState);
}

function isWaitingReply(facts: LineFactsV1): boolean {
  if (facts.holder !== null || facts.latestWork === null) return false;
  const run = facts.latestWork.run;
  if (!isYielded(run) || !hasContinuation(run)) return false;
  const desired = run.controlState?.desiredState;
  return desired !== 'cancelled' && desired !== 'paused';
}

/** T8 without the evidence: executor, unoccupied, not waiting, no other open responsibility, all terminal. */
function isExecutorEvidenceReady(facts: LineFactsV1, waiting: boolean): boolean {
  return facts.duty === 'executor' && facts.holder === null && !waiting
    && facts.responsibleOpenOther.length === 0
    && facts.responsibleOpen.every((task) => task.terminal);
}

function standbyReason(facts: LineFactsV1, done: DoneVerdict, waiting: boolean): LineReasonV1 {
  const open = facts.responsibleOpen;
  if (open.length > 0 && open.every((task) => task.goalDesiredState === 'cancelled')) {
    return reason('goal_cancelled');
  }
  if (open.some((task) => task.phaseCause?.code === 'awaiting_verification')) {
    return reason('awaiting_check');
  }
  const nonTerminal = open.filter((task) => !task.terminal);
  if (nonTerminal.length > 0 && nonTerminal.every((task) => task.disposition === 'deferred')) {
    return reason('task_deferred');
  }
  const nonDeferred = nonTerminal.filter((task) => task.disposition !== 'deferred');
  if (nonDeferred.length > 0 && nonDeferred.every((task) => task.goalDesiredState === 'paused')) {
    return reason('paused_by_goal');
  }
  if (nonTerminal.length > 0) return reason('waiting_dispatch');
  if (isExecutorEvidenceReady(facts, waiting) && done.evidence === 'incomplete') return reason('done_unproven');
  return reason('idle');
}

// -------------------------------------------------------------------------- //
// Markers (§3.3)                                                             //
// -------------------------------------------------------------------------- //

function deriveMarkers(facts: LineFactsV1): LineMarkerV1[] {
  const markers: LineMarkerV1[] = [];
  const head = facts.head;
  if (facts.holder !== null && facts.holder.kind === 'run') {
    const pointer = facts.holder.run.pointer;
    if (pointer !== null && (pointer.kind === 'pause' || pointer.kind === 'cancel') && pointer.status === 'queued') {
      markers.push({ kind: 'stop_pending', intentRef: pointer.ref });
    }
  }
  const request: SessionArchiveRequestV1 | null | undefined = head.archiveRequest;
  if (request !== null && request !== undefined) {
    markers.push({ kind: 'archiving', archiveRequestId: request.requestId, waitingForStop: facts.holder !== null });
  }
  if (head.health === 'unavailable' && facts.undelivered.status !== 'not_applicable') {
    markers.push({ kind: 'undelivered', count: facts.undelivered });
  }
  const earliest = facts.chain[facts.chain.length - 1];
  if (earliest !== undefined && earliest.provenance?.kind === 'handoff') {
    markers.push({ kind: 'handoff_from', from: earliest.provenance.from, fromLine: facts.handoffFromLine });
  }
  if (facts.omitted.status !== 'exact' || facts.omitted.value > 0) {
    markers.push({ kind: 'omitted', count: facts.omitted });
  }
  const answeringCopies = facts.copies
    .filter((copy) => copy.phase === 'claimed' || copy.phase === 'prepared' || copy.phase === 'entering' || copy.phase === 'entered')
    .map((copy) => copy.session);
  if (answeringCopies.length > 0) markers.push({ kind: 'copy_answering', copies: answeringCopies });
  return markers;
}

// -------------------------------------------------------------------------- //
// Bucket (§3.5) and archived tag (§3.6)                                      //
// -------------------------------------------------------------------------- //

function deriveBucket(facts: LineFactsV1, archived: boolean, own: LineOwnStateV1, markers: LineMarkerV1[]): LineBucketV1 | null {
  // B4: a row whose own facts could not be read is in no bucket.
  if (facts.problem !== undefined && facts.problem !== null) return null;
  if (archived) return 'archived';
  if (own === 'working' || own === 'checking' || own === 'starting'
    || markers.some((marker) => marker.kind === 'copy_answering')) {
    return 'working';
  }
  return 'standby';
}

export function archivedLineTag(facts: LineFactsV1): LineArchivedTagV1 {
  if (facts.head.health === 'unavailable') return 'retired';
  return evaluateDoneEvidence(facts, true).done ? 'done' : 'plain';
}

// -------------------------------------------------------------------------- //
// Controls (L16, §3.10)                                                      //
// -------------------------------------------------------------------------- //

const ROUTE_CONTROL = 'controls/submit';
const ROUTE_REQUEUE = 'tasks/requeue';
const ROUTE_RESOLVE_RUN = 'executions/resolve-unknown';
const ROUTE_RESOLVE_QUERY = 'queries/resolve-unknown';
const ROUTE_ARCHIVE_LINE = 'sessions/archive-line';
const ROUTE_REACTIVATE = 'sessions/reactivate';
const ROUTE_ASK = 'queries/submit';

/**
 * L16 / §3.10: the controls this line can offer, computed with the SAME pure
 * guards a submission runs (`controlSubmissionProblem` after the ended-Run row,
 * `taskRequeueStateProblem` plus the Goal-active row). The availability, the
 * refusal code and the refusal reason are exactly what a submission answers, so
 * a control listed `available` is accepted while the facts stand and one listed
 * `unavailable` is refused with the same code and reason. Controls this slice
 * has not wired are `not_yet` and name the slice that will.
 */
export function deriveLineControls(facts: LineFactsV1, status: LineStatusV1): LineControlV1[] {
  const controls: LineControlV1[] = [];
  if (facts.head.lifecycle === 'archived') {
    controls.push(reactivateControl(facts));
    controls.push(notYet('ask', ROUTE_ASK, '第 7 片接上问一问'));
    return controls;
  }
  // Work pause/resume/cancel (T3a/T3b/T3d/T4/T5/T7). T0 and T3c give no
  // pause/resume/cancel; their "继续" is one control per paused task below.
  if (status.own === 'working' || status.own === 'starting' || status.own === 'waiting_reply' || status.own === 'paused') {
    const runFacts = workControlTarget(facts);
    if (runFacts !== null) {
      const resume = status.own === 'paused' && facts.head.health === 'available';
      controls.push(workControl(resume ? 'resume' : 'pause', runFacts));
      controls.push(workControl('cancel', runFacts));
    }
  }
  // Query: a control on a Query Run is refused as invalid (§0.2, §3.10).
  const holder = facts.holder;
  if (holder !== null && holder.kind === 'query' && (status.own === 'starting' || status.own === 'working')) {
    controls.push(queryRefusal('pause', holder.query));
    controls.push(queryRefusal('cancel', holder.query));
  }
  // 认定: only an unresolved occupancy has a result to attest.
  if (holder !== null && holder.kind === 'run' && holder.run.run.status === 'ended'
    && holder.run.run.outcome === 'outcome_unknown') {
    controls.push(available('attest_unknown', ROUTE_RESOLVE_RUN,
      { runRef: holder.run.run.ref }, runPins(holder.run)));
  } else if (holder !== null && holder.kind === 'query' && holder.query.run.executionState?.phase === 'unknown') {
    controls.push(available('attest_unknown', ROUTE_RESOLVE_QUERY,
      { queryRunRef: holder.query.ref }, [{ ref: holder.query.ref, revision: holder.query.revision }]));
  }
  // "继续": one per paused-interrupted task this line now owns (L16).
  for (const paused of facts.pausedTasks) {
    const problem = continueProblem(paused);
    const target = { task: paused.task, runRef: paused.afterRun.run.ref };
    controls.push(problem === null
      ? available('continue', ROUTE_REQUEUE, target, paused.pins)
      : refused('continue', ROUTE_REQUEUE, target, paused.pins, problem));
  }
  if (status.own !== 'retired') controls.push(available('archive', ROUTE_ARCHIVE_LINE, { sessionRef: headRef(facts) }, []));
  controls.push(askControl(facts));
  controls.push(notYet('intervene', ROUTE_CONTROL, '第 7 片接上直接干预'));
  return controls;
}

function headRef(facts: LineFactsV1): SessionRef {
  return { projectId: facts.head.ref.projectId, sessionId: facts.head.ref.sessionId };
}

/** The Work Run pause/resume/cancel act on: the occupancy Run, or a yielded latest Work (T3b/T7). */
function workControlTarget(facts: LineFactsV1): LineRunFactsV1 | null {
  if (facts.head.health !== 'available') return null;
  const holder = facts.holder;
  if (holder !== null && holder.kind === 'run') return holder.run;
  if (holder === null && facts.latestWork !== null && isYielded(facts.latestWork.run)) return facts.latestWork;
  return null;
}

function workControl(kind: 'pause' | 'resume' | 'cancel', runFacts: LineRunFactsV1): LineControlV1 {
  const target = { runRef: runFacts.run.ref };
  const pins = runPins(runFacts);
  const problem = workControlProblem(kind, runFacts);
  return problem === null ? available(kind, ROUTE_CONTROL, target, pins)
    : refused(kind, ROUTE_CONTROL, target, pins, problem);
}

/** L16: the target-Run rows the control service asks before `controlSubmissionProblem`. */
function workControlProblem(kind: 'pause' | 'resume' | 'cancel', facts: LineRunFactsV1): { code: string; reason: string } | null {
  const node = runControlNodeOf(facts.run);
  if (node === 'Ended' || node === 'EndedUnknown') {
    return { code: 'busy', reason: isPausedInterrupted(facts.run)
      ? 'the paused Run ended at the Host restart; continue the Task'
      : 'the Run already ended; no new control intent is accepted' };
  }
  const rejected = controlSubmissionProblem({
    kind,
    reason: null,
    pointer: facts.run.controlState?.desiredState ?? 'none',
    yielded: node === 'YieldedWait',
    continuationConsumed: facts.continuationConsumed,
    pointerIntent: pointerIntentOf(facts.pointer),
    goal: facts.goalDesiredState,
  });
  return rejected === null ? null : { code: rejected.code, reason: rejected.reason };
}

function pointerIntentOf(pointer: ControlIntentSnapshotV1 | null): ControlPointerIntent | null {
  if (pointer === null) return null;
  if (pointer.status === 'queued') return { kind: pointer.kind, status: pointer.status, observed: null };
  return { kind: pointer.kind, status: pointer.status, observed: pointer.observation.kind };
}

/** L16: the requeue guard, then the Goal-active row (`task-machine.ts:1240`). */
function continueProblem(paused: LinePausedTaskFactsV1): { code: string; reason: string } | null {
  const rejected = taskRequeueStateProblem(paused.state, paused.rework);
  if (rejected !== null) {
    if (rejected.ok) return null;   // defensive: the guard returns only refusals
    return { code: rejected.code, reason: rejected.detail };
  }
  if (paused.rework.goalDesiredState !== 'active') {
    return { code: 'busy', reason: `the Goal is ${paused.rework.goalDesiredState}; resume the Goal first` };
  }
  return null;
}

function queryRefusal(kind: 'pause' | 'cancel', query: QueryRunSnapshot): LineControlV1 {
  return refused(kind, ROUTE_CONTROL, { queryRunRef: query.ref },
    [{ ref: query.ref, revision: query.revision }],
    { code: 'invalid', reason: 'Query 不能暂停或取消' });
}

function reactivateControl(facts: LineFactsV1): LineControlV1 {
  const target = { sessionRef: headRef(facts) };
  if (facts.head.health === 'unavailable') {
    return refused('reactivate', ROUTE_REACTIVATE, target, [], {
      code: 'reactivate_refused_retired', reason: `the line is retired (${facts.head.healthConclusion ?? 'unrecorded'})` });
  }
  return available('reactivate', ROUTE_REACTIVATE, target, []);
}

function askControl(facts: LineFactsV1): LineControlV1 {
  if (facts.head.health === 'unavailable') {
    // §3.10: the derived-copy "ask" path only needs an ACTIVE (lifecycle) Session,
    // which a `kernel_turn_open` retired line still is; missing/damaged wait for slice 7.
    if (facts.head.healthConclusion === 'kernel_turn_open') {
      return available('ask', ROUTE_ASK, { sessionRef: headRef(facts) }, []);
    }
    return notYet('ask', ROUTE_ASK, '第 7 片接上已退役线的问一问');
  }
  return available('ask', ROUTE_ASK, { sessionRef: headRef(facts) }, []);
}

function runPins(facts: LineRunFactsV1): VersionPin[] {
  return [{ ref: facts.run.ref, revision: facts.run.revision }];
}

function available(
  kind: LineControlKindV1, route: string,
  target: LineControlV1['target'], pins: VersionPin[],
): LineControlV1 {
  return { kind, availability: 'available', reason: null, reasonCode: null, route, target, pins };
}

function refused(
  kind: LineControlKindV1, route: string, target: LineControlV1['target'], pins: VersionPin[],
  problem: { code: string; reason: string },
): LineControlV1 {
  return { kind, availability: 'unavailable', reason: problem.reason, reasonCode: problem.code, route, target, pins };
}

function notYet(kind: LineControlKindV1, route: string, reason: string): LineControlV1 {
  return { kind, availability: 'not_yet', reason, reasonCode: 'not_yet', route, target: {}, pins: [] };
}

// -------------------------------------------------------------------------- //
// Completion evidence (L1a truth table)                                      //
// -------------------------------------------------------------------------- //

type DoneVerdict = { evidence: 'complete' | 'incomplete' | 'not_applicable'; done: boolean };

function evaluateDoneEvidence(facts: LineFactsV1, archived: boolean): DoneVerdict {
  const evidence = facts.doneEvidence;
  if (evidence.status === 'not_applicable') return { evidence: 'not_applicable', done: false };
  const fullyRead = evidence.total.status === 'exact' && evidence.total.value <= 21
    && evidence.recent.length === evidence.total.value && !evidence.budgetExhausted
    && evidence.recent.every((entry) => entry.closure !== 'unknown');
  // DE1 is only positive evidence for an ACTIVE head. An archived head has no
  // open task responsibility of its own; an open terminal inherited from an
  // active predecessor must not bypass A2's conservative DE3 -> DE2 -> DE5/DE4.
  if (!archived && evidence.openTerminal.length > 0) return { evidence: 'complete', done: true };   // DE1, never over budget
  if (archived) {
    // DE3 first: an archive that put a task down or handed it over is never "done".
    if (evidence.recent.some((entry) => entry.archiveStep)) return { evidence: 'complete', done: false };
    if (fullyRead && evidence.recent.some((entry) => entry.closure === 'terminal')) {
      return { evidence: 'complete', done: true };                                    // DE2
    }
    if (!fullyRead) return { evidence: 'incomplete', done: false };                    // DE5
    return { evidence: 'complete', done: false };                                      // DE4
  }
  if (evidence.recent.some((entry) => entry.closure === 'terminal')) {
    return { evidence: 'complete', done: true };                                       // DE2
  }
  if (!fullyRead) return { evidence: 'incomplete', done: false };                      // DE5
  return { evidence: 'complete', done: false };                                        // DE4
}

// -------------------------------------------------------------------------- //
// Attention assembly (§3.4)                                                  //
// -------------------------------------------------------------------------- //

type AttentionState = { attention: LineAttentionV1 | null; counts: Record<LineAttentionCodeV1, number>; complete: boolean };
type Candidate = { attention: LineAttentionV1; rank: number; order: number; key: string; source: LineSourceRefV1 | null };

type AttentionCandidateEntry = {
  attention: LineAttentionV1 | null; order: number; key: string;
  /** A card's own source; null for task- and line-level candidates. */
  cardSource: LineSourceRefV1 | null; incomplete: boolean;
};

/**
 * Enumerates every attention source once, in task → card → line-level unknown
 * → written-anchor order. The summary and the detail each project from it.
 */
function* attentionCandidates(facts: LineFactsV1): Generator<AttentionCandidateEntry> {
  for (const task of facts.responsibleOpen) {
    yield { attention: classifyTaskAttention(task), order: task.planOrder, key: taskKey(task.task),
      cardSource: null, incomplete: !task.anomalyComplete };
  }
  for (const card of facts.lineCards) {
    const cardSource: LineSourceRefV1 | null = card.codeReadable
      ? { kind: 'card', source: card.source, cardKey: card.cardKey } : null;
    yield {
      attention: !card.codeReadable ? null : card.code === 'unknown_outcome'
        ? attention('unknown', reason('run_outcome_unknown')) : attention('decide', cardReason(card)),
      order: Number.MAX_SAFE_INTEGER, key: card.cardKey, cardSource, incomplete: !card.codeReadable,
    };
  }
  // Line-level attention that is not tied to one task or card.
  const lineUnknown = lineUnknownSource(facts);
  yield { attention: lineUnknown === null ? null : attention('unknown', lineUnknown.reason),
    order: Number.MAX_SAFE_INTEGER, key: lineUnknown === null ? '' : lineUnknown.key,
    cardSource: null, incomplete: false };
  const anchors = facts.writtenAnchorsPending;
  const anchorPending = anchors.status === 'partial' ? anchors.atLeast > 0
    : anchors.status === 'exact' ? anchors.value > 0 : false;
  yield { attention: anchorPending ? attention('unknown', writtenAnchorsReason(facts)) : null,
    order: Number.MAX_SAFE_INTEGER, key: 'written_anchors', cardSource: null,
    incomplete: anchors.status === 'unavailable' || anchors.status === 'partial'
      || facts.partialParts.some((part) => part.part === 'written_anchors') };
}

function deriveAttention(facts: LineFactsV1): AttentionState {
  const counts: Record<LineAttentionCodeV1, number> = { decide: 0, failed: 0, blocked: 0, unknown: 0 };
  let best: Candidate | null = null;
  let complete = facts.queueComplete;
  for (const entry of attentionCandidates(facts)) {
    if (entry.incomplete) complete = false;
    if (entry.attention === null) continue;
    counts[entry.attention.code] += 1;
    const candidate: Candidate = { attention: entry.attention, rank: ATTENTION_RANK[entry.attention.code],
      order: entry.order, key: entry.key, source: entry.cardSource };
    if (best === null || candidate.rank < best.rank
      || (candidate.rank === best.rank && candidate.order < best.order)
      || (candidate.rank === best.rank && candidate.order === best.order && candidate.key < best.key)) {
      best = candidate;
    }
  }
  return { attention: best === null ? null : (best as Candidate).attention, counts, complete };
}

/**
 * §2 `WorkLineDetailV1.attentionAll` (L8): EVERY attention candidate of this
 * line with its source, not only the most urgent one. Task-level and line-level
 * facts use the line head's real Session pin; card facts use the card source.
 */
export function deriveAttentionAll(facts: LineFactsV1): (LineAttentionV1 & { source: LineSourceRefV1 })[] {
  const headSource: LineSourceRefV1 = { kind: 'record',
    pin: { ref: { ...facts.head.ref }, revision: facts.head.revision } };
  const result: (LineAttentionV1 & { source: LineSourceRefV1 })[] = [];
  for (const entry of attentionCandidates(facts)) {
    if (entry.attention !== null) result.push({ ...entry.attention, source: entry.cardSource ?? headSource });
  }
  return result;
}

function cardReason(card: LineCardFactV1): LineReasonV1 {
  return { code: 'card', params: card.code === null ? {} : { code: card.code }, refs: [{ kind: 'card', source: card.source, cardKey: card.cardKey }] };
}

function lineUnknownSource(facts: LineFactsV1): { reason: LineReasonV1; key: string } | null {
  const holder = facts.holder;
  if (holder !== null && holder.kind === 'run' && holder.run.run.status === 'ended'
    && holder.run.run.outcome === 'outcome_unknown') {
    return { reason: reason('unknown_run'), key: 'occupancy' };
  }
  if (holder !== null && holder.kind === 'query' && holder.query.run.executionState?.phase === 'unknown') {
    return { reason: reason('unknown_query'), key: 'occupancy' };
  }
  if (facts.copies.some((copy) => copy.phase === 'unknown')) {
    return { reason: reason('copy_unknown'), key: 'copy' };
  }
  if (facts.unknownCallReviewsPending > 0) {
    return { reason: reason('unknown_call_review'), key: 'unknown_call_review' };
  }
  return null;
}

// -------------------------------------------------------------------------- //
// Sort key (L10)                                                             //
// -------------------------------------------------------------------------- //

/**
 * The exact row sort key (L10): pinned first → attention tier (decide, failed,
 * blocked, unknown, read-incomplete, none) → latest activity DESC → head
 * refKey. Compare with plain string ordering; the time part is inverted so a
 * later `lastActivityAt` sorts first.
 */
export function lineSortKey(input: { pinned: boolean; attention: LineAttentionCodeV1 | null;
  attentionComplete: boolean; lastActivityAt: string; headRefKey: string }): string {
  const pinnedRank = input.pinned ? 0 : 1;
  const attentionRank = input.attention === null
    ? (input.attentionComplete ? 5 : 4)
    : ATTENTION_RANK[input.attention];
  return `${pinnedRank}|${attentionRank}|${descendingTimeKey(input.lastActivityAt)}|${input.headRefKey}`;
}

const MAX_EPOCH_MS = 9_007_199_254_740_991;

function descendingTimeKey(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return '9'.repeat(17);   // unparseable times sort last
  return String(MAX_EPOCH_MS - ms).padStart(17, '0');
}

// -------------------------------------------------------------------------- //
// Small helpers                                                              //
// -------------------------------------------------------------------------- //

function reason(code: LineReasonCodeV1, params: Record<string, string | number> = {}): LineReasonV1 {
  return { code, params, refs: [] };
}

function attention(code: LineAttentionCodeV1, reasonValue: LineReasonV1): LineAttentionV1 {
  return { code, reason: reasonValue };
}

function retiredReason(conclusion: SessionHealthConclusion | null): LineReasonV1 {
  switch (conclusion) {
    case 'kernel_turn_open': return reason('retired_turn_open');
    case 'missing': return reason('retired_missing');
    case 'damaged': return reason('retired_damaged');
    default: return reason('retired_unrecorded');
  }
}

function pauseReason(pointerFromGoal: boolean): LineReasonV1 {
  return pointerFromGoal ? reason('paused_by_goal') : reason('paused_by_you');
}

function pausedInterruptedReason(pointerFromGoal: boolean, goal: GoalDesiredState): LineReasonV1 {
  return reason('paused_interrupted', { by: pointerFromGoal ? 'goal' : 'you', goal });
}

function isAppliedPause(pointer: ControlIntentSnapshotV1 | null): boolean {
  if (pointer === null) return false;
  if (pointer.kind !== 'pause') return false;
  if (pointer.status !== 'applied') return false;
  return pointer.observation.kind === 'paused';
}

function isStartingQuery(query: QueryRunSnapshot): boolean {
  const phase = query.run.executionState?.phase;
  return phase === 'claimed' || phase === 'prepared' || phase === 'entering';
}

function isYielded(run: RunSnapshot): boolean {
  return run.status === 'ended' && run.outcome === 'yielded';
}

function hasContinuation(run: RunSnapshot): boolean {
  return run.continuation !== undefined && run.continuation !== null;
}

function sameTask(left: TaskTriple, right: TaskTriple): boolean {
  return taskKey(left) === taskKey(right);
}

function sameRun(left: RunRef, right: RunRef): boolean {
  return left.projectId === right.projectId && left.goalId === right.goalId && left.runId === right.runId;
}
