/**
 * The TaskMap adapter (E3-2 ruling item 3; E3-4 ruling items 1 and 3): a pure
 * function that turns the route replies (`goals/read`, `goals/display`,
 * `tasks/query` and the per-notification `lines/list` / `graph/hover`) into the
 * shape the board reads through `props.data`. It touches no DOM, no network and
 * no app module.
 *
 * Ruling items 2 and 6: the Goal's status word and square come from the formal
 * `goals/display` phase, never from `desiredState`. The outline and the DAG read
 * one task row and one state mapping; the DAG's edges are the plan's real
 * `executionDag.dependsOn`, and a real gate is the Task with
 * `definition.taskKind === 'gate'` — no node is synthesized for a Goal.
 */

import { pathOwnershipOf } from '../../contracts/path-ownership.js';
import { catalogForWorkspace } from '../../contracts/workspace-catalog.js';
import { displayProjectPath, qualifyProjectPath } from '../../contracts/workspace-path.js';
import type { AdoptedArchitecture } from '../../contracts/architecture-catalog.js';
import type { TaskRow } from '../../contracts/task-graph.js';
import type { RunRef, TaskTriple } from '../../contracts/dispatch.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import { revisionAssignments } from '../../contracts/plan.js';
import { asRecord, asText, type JsonRecord } from '../values.js';
import { firstLine, runningMinutesText, type RunningCommandItemV1 } from './run-steps.js';

/** Ruling item 1: a Goal with no adopted Plan shows this empty text. */
export const NO_PLAN_TEXT = '这个目标还没有采用的计划。';

export type GoalDisplayPhaseCode =
  | 'PLANNING' | 'RUNNING' | 'CHANGE_PENDING' | 'NEEDS_DECISION' | 'BLOCKED' | 'FAILED'
  | 'PAUSED' | 'CANCELLED' | 'COMPLETED' | 'ACCEPTED_PARTIAL';

/** The unwrapped `ReadResult<GoalReadV1>` value (ruling item 3: boot unwraps). `ordinal` is the
 * Goal's 目标 n in its project, null or absent when the Host cannot tell. */
export type TaskMapGoalRead = { goal: { ref: { goalId: string }; objective: string; revision?: number }; ordinal?: number | null };

/** The unwrapped `ReadResult<GoalDisplayRead>` value. */
export type TaskMapDisplayRead = { display: { phase: GoalDisplayPhaseCode } };

/** The unwrapped `ReadResult<TaskGraph>` value; rows stay at the JSON boundary. */
export type TaskMapGraphRead = {
  plan: { ref?: unknown; stages: unknown[]; obligations?: unknown[]; executionDag: { dependsOn: unknown[] } };
  tasks: unknown[];
};

/** The two route replies read on every notification with the base four. */
export type TaskMapHoverRead = { groups?: unknown[]; tasks?: unknown[]; modules?: unknown[] };
export type TaskMapLineRead = { counts?: { working?: unknown }; rows?: unknown[] };
export type TaskMapExtraReads = { hover?: TaskMapHoverRead | null; lines?: TaskMapLineRead | null;
  /** D101-3: this Goal's blocked Tasks, read when it has a waiting card. */ waits?: unknown };

export type TaskMapTask = {
  id: string; stageId: string | null; name: string; st: string; why: string;
  deps: string[]; gate: boolean; optional: boolean; scopeKind: string; owner: string;
  /** The adopted assignment's instruction: the Task's 语义 (DESIGN `:492-507`); empty hides the row. */
  instruction: string;
  rework: string[];
  /** `rework.cap`: the automatic requeue count on a bar reads (n/cap). */
  reworkCap: number | null;
  /** The row's `attemptOrdinal` (its selected Run's attempt); null when the row has none. */
  attempt: number | null;
  /** `failure.round.gapCodes` in the page's words; empty when the row has no failure round. */
  gaps: string;
  /** D42-2: this Task's unclaimed anomaly anchors (`display.anomaly.pending`). */
  anchors: number;
};

export type TaskMapDagEdge = {
  taskId: string; dependsOnId: string; requires: { kind: string; label: string } | null;
};

export type TaskMapDropped = { id: string; name: string; word: string; why: string;
  /** The adopted revision that made this disposition change; boot reads its acceptedAt. */
  setIn?: unknown; at?: string;
  /** 5.10-3: a cancelled non-gate Task can be restored from the dropped list. */
  canRestore: boolean };

/** One running command of a Task, as the boards draw it: the command's first
 * line, the Host's minute count, and the line and Run that can stop it. */
type TaskMapRunning = {
  cmd: string; minutes: string; runRef: RunRef; sessionRef: SessionRef;
  workspaceId: string; stopping: boolean;
};

/** The real DAG facts: nodes (non-band), band, edges, real gates, the critical
 * path and the current owners. Nothing is invented for a missing Goal gate. */
export type TaskMapDag = {
  edges: TaskMapDagEdge[];
  nodes: string[];
  band: string[];
  dropped: TaskMapDropped[];
  gateIds: string[];
  /** The longest unfinished dependency chain, upper → lower. */
  crit: string[];
  /** The same chain from a supplied state map, for a historical cursor. */
  critAt?: (st: Record<string, string>) => string[];
  owners: Record<string, string>;
  goalOwner: string;
};

export type TaskMapData = {
  /** `ordinal`: the Host's number only; never counted from the Goal list. */
  goal: { id: string; name: string; st: string; word: string; ordinal?: number | null };
  /** boot stamps this read's own workspace scope; `publish` hands it to the one
   * `tasks/hold/release` write, so the TaskMap card releases holds without a
   * second navigation read. */
  scope?: { projectId: string; workspaceId: string };
  stages: Array<{ id: string; name: string; description: string }>;
  tasks: TaskMapTask[];
  /** The TaskMap's one running command per Task (first by the Host's order);
   * empty when none matched this Goal or the read failed. */
  running: Record<string, TaskMapRunning>;
  dag: TaskMapDag;
  /** Ruling item 1: `tasks/query` answered `not_found` because no Plan is adopted. */
  planMissing?: boolean;
  /** The selected node's `graph/detail` projection (ruling 4: read on demand). */
  detail?: TaskMapNodeDetailData | null;
  detailFor?: string;
  /** Ruling 4: present only after the track is opened. */
  time?: TaskMapTimeData;
  /** This Goal's waiting decision cards (HO:2051); null when unread or none. */
  decisionCards?: { n: number; atLeast: boolean } | null;
  /** `graph/hover` `modules[]`: moduleId → name, the 模块 group names (no id reaches the page). */
  moduleNames?: Record<string, string>;
  /** D42-2: the unclaimed anchor total for 需要关注; null when there is none. */
  anchorCount?: { n: number; atLeast: boolean } | null;
  /** D101-3: “the claimable Tasks are all waiting for you”, '' when not all blocked. */
  allBlocked?: string;
  /** T6: the plan and Goal revision this page last read, for a disposition write. */
  planWrite?: { goalRevision: number; graph: unknown } | null;
};

/**
 * This Goal's running Work commands, one per Task. The Host returns every
 * command of this Host and orders them by `startedAt`, so a Task with several
 * keeps the first. Query rounds carry no Task and are not part of this map.
 */
export function runningCommandsByTask(
  items: readonly RunningCommandItemV1[], goalId: string,
): Record<string, TaskMapRunning> {
  const byTask: Record<string, TaskMapRunning> = {};
  for (const item of items) {
    if (item.run.kind !== 'run' || item.run.runRef.goalId !== goalId) continue;
    const taskId = item.run.taskId;
    if (byTask[taskId] !== undefined) continue;
    const preview = firstLine(item.commandPreview);
    byTask[taskId] = {
      cmd: preview === '' ? '命令' : preview,
      minutes: runningMinutesText(item),
      runRef: item.run.runRef,
      sessionRef: item.sessionRef,
      workspaceId: item.workspaceId,
      stopping: false,
    };
  }
  return byTask;
}

/** The `decisions/queue` value the attention item reads: the waiting total
 * before paging and which sources could be read. */
export type TaskMapQueueRead = {
  counts?: { waitingAnswer?: unknown };
  capabilities?: Array<{ source?: unknown; availability?: unknown }>;
};

/* The eleven notice-only categories (`NoticeCategoryV1`, without `note_review`):
   a notice kind the Host has no source for never hides a card, so only an
   unavailable card source (or a source this page does not know) makes the count
   partial; the queue's own `countsComplete` also waits on every notice kind and
   is never true on a real Host. `note_review` is both a card kind and a notice
   category, and its card read shares the same capability key, so a failed one
   makes the card count partial too. The page keeps its own copy of the names
   (it imports no contract values). */
const NOTICE_ONLY_CATEGORIES = new Set(['member_notice', 'second_expiry', 'handoff', 'undelivered_reply',
  'automatic_rework', 'continuation', 'disconnect', 'member_created', 'project_notice', 'plan_adoption', 'plan_notice']);

/** 121-146/U2: whether any card source is not fully available, so a card count is a lower bound. A notice-only
 * category that is not connected does not count; `note_review` counts as a card. */
export function decisionCardCountPartial(read: TaskMapQueueRead | null): boolean {
  const capabilities = asRecord(read).capabilities;
  return (Array.isArray(capabilities) ? capabilities : []).some((entry) => {
    const row = asRecord(entry);
    return row.availability !== 'available' && !NOTICE_ONLY_CATEGORIES.has(asText(row.source));
  });
}

/** HO:2051: the number of this Goal's cards waiting for an answer; a zero or
 * an unreadable count is no item (a complete 0 needs nothing, a partial 0 is
 * no fact). */
export function adaptTaskMapDecisionCards(read: TaskMapQueueRead | null): { n: number; atLeast: boolean } | null {
  const n = asRecord(asRecord(read).counts).waitingAnswer;
  if (typeof n !== 'number' || n <= 0) return null;
  return { n, atLeast: decisionCardCountPartial(read) };
}

/** Ruling item 2: the ten formal display phases, worded as the board's own goal
 * words (`Main.dc.html:1765`, `Plan.dc.html:1773`) and task words
 * (`TaskMap.dc.html:745`) are worded. One place, no second copy in the board. */
export function goalDisplayState(phase: GoalDisplayPhaseCode): { st: string; word: string } {
  return {
    PLANNING: { st: 'pending', word: '规划中' },
    RUNNING: { st: 'running', word: '运行中' },
    CHANGE_PENDING: { st: 'waiting', word: '变更待处理' },
    NEEDS_DECISION: { st: 'decide', word: '需要你决定' },
    BLOCKED: { st: 'blocked', word: '受阻' },
    FAILED: { st: 'failed', word: '失败' },
    PAUSED: { st: 'waiting', word: '已暂停，可继续' },
    CANCELLED: { st: 'cancelled', word: '已取消' },
    COMPLETED: { st: 'satisfied', word: '已完成' },
    ACCEPTED_PARTIAL: { st: 'satisfied', word: '部分完成' },
  }[phase];
}

/** Ruling item 2 and ruling 8: a Goal is finished in the display state only when
 * it is completed or cancelled; `desiredState` is not the display. */
export function isFinishedGoalDisplayPhase(phase: GoalDisplayPhaseCode): boolean {
  return phase === 'COMPLETED' || phase === 'CANCELLED';
}

/** Ruling item 6's task words: the TaskRow phase plus the adopted execution intent.
 * Disposition `deferred` wins; `cancelled`/`superseded` tasks are not returned.
 * `ready` and `pending` are renamed; the other phases are their own word. A
 * blocked Task whose phase cause is an unknown outcome needs a person; a paused
 * continuation/interruption reads 已暂停，可继续. A failed Task whose automation
 * verdict is one of the stops that needs a person is shown as 需要你决定
 * (`DESIGN.md:173`), with the stop reason read from the failure verdict, never
 * from `phaseCause.code` (that code is a phase projection: check_failed here). */
const DECIDE_STOPS = new Set(['gate_needs_fix', 'auto_rework_cap_reached', 'no_new_basis',
  'verification_uncovered', 'unknown_outcome']);
export function automationStopOf(row: Record<string, unknown>): string {
  const verdict = asRecord(asRecord(asRecord(row.failure).automation).verdict);
  return asText(verdict.kind) === 'stopped' ? asText(verdict.reason) : '';
}
export function taskState(
  phase: string, intent: unknown, disposition: unknown, cause: string, stopReason: string,
  /** The row's `eligibility.eligible`: claimable is the platform's verdict
   * (E3I:142), which never waits on dependencies (UIW:96); a ready Task under a
   * paused Goal is not claimable. */
  eligible: boolean,
): string | null {
  if (disposition === 'cancelled' || disposition === 'superseded') return null;
  if (disposition === 'deferred') return 'deferred';
  if (phase === 'ready' || phase === 'pending') return intent === 'plan_only' ? 'future' : eligible ? 'claimable' : 'pending';
  if (phase === 'blocked') {
    if (cause === 'run_outcome_unknown') return 'decide';
    if (cause === 'continuation_paused' || cause === 'paused_interrupted') return 'waiting';
  }
  if (phase === 'failed' && DECIDE_STOPS.has(stopReason)) return 'decide';
  return phase;
}

/** The same Task state from a whole row: the one rule every board calls
 * (`done.ts` and `chain.ts` had their own copies), with the automation stop read
 * from the failure facts. */
export function taskStateOfRow(row: TaskRow): string | null {
  return taskState(row.effectivePhase, row.definition.executionIntent, row.disposition,
    asText(asRecord(row.phaseCause).code), automationStopOf({ ...row }), row.eligibility.eligible);
}

/** The short current reason a TaskRow carries, in the A.2 words (DESIGN `:606`,
 * E3I:47) and the cause-code table (E3I:139); stop reasons and phase causes
 * share it. The route has no long prose. */
const PHASE_CAUSE_WORD: Record<string, string> = {
  requeued: '已重新入队', run_outcome_unknown: '执行结果待核对', run_failed: '执行失败',
  check_failed: '检查未通过', round_inconclusive: '检查不完整', check_interrupted: '检查被中断',
  round_ambiguous: '轮次链无效，需要计划处理', awaiting_verification: '等待正式检查',
  verification_running: '正式检查进行中', awaiting_completion: '等待完成确认',
  origin_unresolvable: '来源无法核对', continuation_cancelled: '已取消，可重新入队',
  continuation_paused: '接续已暂停', paused_interrupted: '主机重启时已暂停',
  gate_needs_fix: '验收未通过，需要添加修复任务', auto_rework_cap_reached: '自动返工已达上限',
  no_new_basis: '没有新依据，自动返工已停止', verification_uncovered: '没有覆盖验收的检查',
  unknown_outcome: '执行结果待核对', budget_exhausted: '预算耗尽',
  task_cancelled: '人工已取消，不会自动返工', task_paused: '人工已暂停，不会自动返工',
  unknown_call_review: '结果未知的调用待核对', interrupted_pending_resume: '被中断，等你继续',
  round_chain_limit: '检查轮次已到上限',
};

/** A phase-cause code's page word (the one table above); an unknown code is ''. */
export function causeWordOf(code: string): string {
  return PHASE_CAUSE_WORD[code] ?? '';
}

/* 5.9b-3: a gate's own cause words. Its chain position is named only from the
   second round on (the first round has no `ordinal`, like a first attempt). */
const GATE_CAUSE_WORD: Record<string, string> = {
  verification_running: '验收进行中', awaiting_completion: '验收通过，等待完成',
  check_failed: '验收未通过', round_inconclusive: '验收不完整', check_interrupted: '验收不完整',
};

/** One gate row's reason: the gate's own words for a gate cause, 等待验收 for a
 * gate with no chain, '' for every other row. */
function gateWhyOf(row: Record<string, unknown>, st: string, cause: Record<string, unknown>, code: string): string {
  const detail = asRecord(cause.detail);
  if (detail.gate !== true) {
    return code === '' && st === 'pending' && asText(asRecord(row.definition).taskKind) === 'gate' ? '等待验收' : '';
  }
  const word = GATE_CAUSE_WORD[code];
  if (word === undefined) return '';
  const ordinal = detail.ordinal;
  return word + (typeof ordinal === 'number' && ordinal >= 2 ? '，第 ' + String(ordinal) + ' 轮' : '');
}

/* The automatic rework count and its cap in brackets; a missing value drops
   only the brackets. */
const countOf = (n: unknown, cap: unknown): string =>
  typeof n === 'number' && typeof cap === 'number' ? '（' + String(n) + '/' + String(cap) + '）' : '';

/** A stop reason's word. `not_reworkable` is worded by its cause; the cap
 * counts the requeues, or the round chain for a reverify (E3I:228). */
export function stopWordOf(row: Record<string, unknown>, stop: string): string {
  const failure = asRecord(row.failure);
  const automation = asRecord(failure.automation);
  const detail = asRecord(asRecord(automation.verdict).detail);
  if (stop === 'not_reworkable') return causeWordOf(asText(detail.cause));
  if (stop === 'auto_rework_cap_reached') {
    return PHASE_CAUSE_WORD.auto_rework_cap_reached + countOf(detail.operation === 'reverify'
      ? asRecord(failure.round).autoCount : automation.requeueAutoCount, automation.cap);
  }
  return PHASE_CAUSE_WORD[stop] ?? '';
}

/** `st` is the state the board shows. A reason never repeats the state word
 * (DESIGN `:622`): a waiting Task already reads 已暂停，可继续, so its paused stop
 * gives way to the phase cause. */
export function taskWhyOf(row: Record<string, unknown>, st: string): string {
  /* The automation stop explains a person's decision; it lives in the failure
     verdict, while `phaseCause.code` is only the phase projection. */
  const stop = automationStopOf(row);
  if (st === 'deferred') {
    /* 5.10-3: a requeued Task deferred again has been requeued before, so it
       resumes claiming once restored. */
    if (asText(asRecord(row.phaseCause).code) === 'requeued') return '已重新入队（已延后），恢复后接着领取';
    /* An inactive Task keeps its projected phase and reason when it ran
       (`traced`, E3I:244); otherwise the reason it was deferred is its cause
       (the detail's 处置 row has the same text). */
    const change = asRecord(row.dispositionChange);
    if (change.traced !== true) return asText(asRecord(change.reason).text);
    const phaseSt = taskState(asText(row.effectivePhase), asRecord(row.definition).executionIntent, '',
      asText(asRecord(row.phaseCause).code), stop, false) ?? '';
    const reason = taskWhyOf(row, phaseSt);
    return (PHASE_WORD[phaseSt] ?? '') + (reason !== '' ? '，' + reason : '');
  }
  const stopWord = stop === '' || (st === 'waiting' && stop === 'task_paused') ? '' : stopWordOf(row, stop);
  if (stopWord !== '') return stopWord;
  const cause = asRecord(row.phaseCause);
  const code = asText(cause.code);
  const gateWord = gateWhyOf(row, st, cause, code);
  if (gateWord !== '') return gateWord;
  if (code === 'requeued') {
    /* Who requeued is the last rework entry; the `claim_requeued` verdict
       covers every requeue, manual or automatic, so it has no word. */
    const rework = asRecord(row.rework);
    const entries = Array.isArray(rework.entries) ? rework.entries : [];
    const last = asRecord(entries[entries.length - 1]);
    const budget = asRecord(row.requeueBudget).tokenBudget;
    const budgetText = typeof budget === 'number' ? '，预算 ' + String(Math.round(budget / 1000)) + 'K' : '';
    return (last.automatic === true ? '系统自动重新入队' + countOf(last.autoCount, rework.cap) : PHASE_CAUSE_WORD.requeued!)
      + budgetText;
  }
  const word = code === '' ? '' : PHASE_CAUSE_WORD[code] ?? '';
  /* 5.6-3: the Host stopped before the pause reached its safe point. */
  if (code === 'paused_interrupted' && asRecord(asRecord(row.phaseCause).detail).kernelPaused === false) {
    return word + '，暂停尚未到达安全点';
  }
  /* 2C's sentence: the failure word, then what the automation does next
     (slice-2C-SPEC.md:1192; E3I:202, :228). An interruption is not counted. */
  const automation = asRecord(asRecord(row.failure).automation);
  const verdict = asRecord(automation.verdict);
  const lead = word === '' ? '' : word + '，';
  if (verdict.kind === 'requeue') {
    const next = typeof automation.requeueAutoCount === 'number' ? automation.requeueAutoCount + 1 : undefined;
    return lead + '系统自动重新入队' + (verdict.failureClass === 'interrupted' ? '' : countOf(next, automation.cap)) + '，等待推进';
  }
  if (verdict.kind === 'reverify') return lead + '推进时自动重新检查';
  if (word !== '') return word;
  return st === 'claimable' ? '等成员领取' : '';
}

/** The Task's display stage: `definition.stageId`, else the scope's stage — a
 * real stage gate declares its stage only in `definition.scope.stageId`. */
function stageOf(definition: Record<string, unknown>): string {
  const declared = asText(definition.stageId);
  if (declared !== '') return declared;
  const scope = asRecord(definition.scope);
  return scope.kind === 'stage' || scope.kind === 'module' ? asText(scope.stageId) : '';
}

/* What an interruption anchor waits for (slice-2C-SPEC.md:1195, `anomaly_pending`);
   a blocked rework names no code (DESIGN `:604`), an unknown value names nothing. */
const ANCHOR_NEXT_WORD: Record<string, string> = {
  '': '等待推进', dispatch: '等待派工', human_continue: '等你点“继续”', rework_blocked: '不能自动返工',
};
const ANCHOR_GOAL_WORD: Record<string, string> = { paused: '目标已暂停', cancelled: '目标已取消' };

/* D101-3: what one blocked Task waits for, by the L46 reason's code. A reason
   with an unknown code names nothing. */
const L46_WAIT_WORD: Record<string, string> = {
  'automation_confirmation_required:system_requeue': '等你确认自动重新入队',
  'automation_confirmation_required:auto_reverify': '等你确认自动重新检查',
  automation_confirmation_required: '等你确认自动返工',
  member_creation_pending: '等你确认创建成员',
  rework_request_pending: '等你确认返工请求',
  handoff_approval_pending: '等你确认交接',
  l46_dependency_blocked: '等前面的任务确认后再做',
};

/** D101-3: every blocked Task's word, and the roots (everything but a Task
 * waiting on another Task). A row with an unknown code is still a root. */
function l46WhyOf(extra: TaskMapExtraReads | undefined): { byTask: Record<string, string>; roots: string[] } {
  const byTask: Record<string, string> = {};
  const roots: string[] = [];
  const rows = asRecord(extra?.waits).waits;
  for (const entry of Array.isArray(rows) ? rows : []) {
    const row = asRecord(entry);
    const id = asText(row.taskId);
    if (id === '') continue;
    const reason = asText(row.reason);
    const cut = reason.indexOf(':');
    const code = cut < 0 ? reason : reason.slice(0, cut);
    const suffix = cut < 0 ? '' : reason.slice(cut + 1).trim();
    const word = L46_WAIT_WORD[code + ':' + suffix] ?? L46_WAIT_WORD[code] ?? '';
    if (word !== '') byTask[id] = word;
    if (code !== 'l46_dependency_blocked') roots.push(id);
  }
  return { byTask, roots };
}

/** D42-2: how many unclaimed anchors each Task has; `partial` is an at-least count. */
function anchorCountsOf(extra: TaskMapExtraReads | undefined): {
  byTask: Record<string, number>; total: number; atLeast: boolean;
} {
  const byTask: Record<string, number> = {};
  let total = 0;
  let atLeast = false;
  for (const entry of Array.isArray(extra?.hover?.tasks) ? extra.hover.tasks : []) {
    const row = asRecord(entry);
    const id = asText(asRecord(row.task).taskId);
    const pending = asRecord(asRecord(asRecord(row.display).anomaly).pending);
    const n = pending.status === 'exact' ? pending.value : pending.status === 'partial' ? pending.atLeast : 0;
    if (id === '' || typeof n !== 'number' || n <= 0) continue;
    if (pending.status === 'partial') atLeast = true;
    byTask[id] = n;
    total += n;
  }
  return { byTask, total, atLeast };
}

/** Decision 42 (UIW:129): a Task with an unclaimed interruption anchor reads
 * 中断，待核对 and what it waits for; its state and square stay. */
function anchorWhyOf(extra: TaskMapExtraReads | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of Array.isArray(extra?.hover?.tasks) ? extra.hover.tasks : []) {
    const row = asRecord(entry);
    const anomaly = asRecord(asRecord(row.display).anomaly);
    const id = asText(asRecord(row.task).taskId);
    if (id === '' || asText(anomaly.label) === '') continue;
    const next = asRecord(anomaly.next);
    const params = asRecord(next.params);
    const word = asText(next.code) !== 'anomaly_pending' ? ''
      : params.next === 'goal_stopped' ? ANCHOR_GOAL_WORD[asText(params.goal)] ?? '' : ANCHOR_NEXT_WORD[asText(params.next)] ?? '';
    out[id] = '中断，待核对' + (word === '' ? '' : ' · ' + word);
  }
  return out;
}

/** D42-2: one line per anomaly anchor: the line, how it broke, who archived it,
 * what it changed, that its result is unchecked and who picked it up. */
export function anchorLinesOf(items: unknown, taskRow: Record<string, unknown> | null): string[] {
  const out: string[] = [];
  for (const entry of Array.isArray(items) ? items : []) {
    const view = asRecord(entry);
    const anchor = asRecord(view.anchor);
    const line = asRecord(view.line);
    const lineName = Object.keys(line).length > 0 ? lineNameOf(line.name) || '一条工作线' : '一条工作线';
    const cause = asText(anchor.cause) === 'archive_interrupted' ? '执行中被归档，执行被中断'
      : asText(anchor.cause) === 'retired_archive' ? '退役后归档，任务没做完' : '';
    const by = asText(asRecord(anchor.archivedBy).kind) === 'human' ? '你' : '平台';
    const at = asText(anchor.recordedAt);
    const files = changedFilesTextOf(asRecord(anchor.changedFiles));
    const parts = [lineName + cause + '（' + by + '归档' + (at !== '' ? '，' + localShortAt(at) : '') + '）', files,
      '结果没核对'];
    const picked = asRecord(view.pickedUpBy);
    if (Object.keys(picked).length > 0) {
      const same = taskRow !== null && asText(picked.runId) === asText(asRecord(taskRow.execution).runId);
      const attempt = same && typeof taskRow?.attemptOrdinal === 'number' ? taskRow.attemptOrdinal : null;
      parts.push(same ? (attempt === null ? '已由最近的一次运行接手' : '已由第 ' + String(attempt) + ' 次尝试接手')
        : '已由这个任务较早的一次运行接手');
    }
    out.push(parts.join('；'));
  }
  return out;
}

/** D42-2: what an anchor's archive changed, in the four states the record has. */
function changedFilesTextOf(files: Record<string, unknown>): string {
  const status = asText(files.status);
  if (status === 'not_entered') return '没开始改';
  if (status === 'unavailable') return '改动未知';
  const confirmed = (Array.isArray(files.confirmed) ? files.confirmed : []).map(asText).filter((path) => path !== '');
  const possible = (Array.isArray(files.possible) ? files.possible : []).map(asText).filter((path) => path !== '');
  const omitted = typeof files.omitted === 'number' ? files.omitted : 0;
  const parts: string[] = [];
  if (confirmed.length > 0) parts.push('确定改过 ' + confirmed.join('、'));
  if (possible.length > 0) parts.push('可能改过 ' + possible.join('、'));
  if (omitted > 0) parts.push('另有 ' + String(omitted) + ' 个没列');
  let text = parts.length === 0 ? '没有改过文件' : parts.join('；');
  if (status === 'partial') text += '（可能不全）';
  if (asText(files.source) === 'worktree') text += '，按工作区比对，可能混有别的执行的改动';
  return text;
}

/** Decision 49·01 (prototype:2272): an unfinished Task that was read and that
 * nobody is responsible for says so; a satisfied, cancelled or superseded one
 * does not. */
function unassignedOf(st: string): string {
  if (st === 'satisfied' || st === 'cancelled' || st === 'superseded') return '';
  return '未分配' + (st === 'claimable' ? '，等成员领取' : '') + (st === 'claimable' || st === 'pending' ? '；开工时开一条工作线' : '');
}

/** The user's rule (HO:2390): the first attempt says nothing; from the second on 第 n 次尝试 (A.2, E3I:47).
 * The board writes the same words with its own copy (the board does not import the adapter). */
function attemptText(n: number | null): string {
  return typeof n === 'number' && n >= 2 ? '第 ' + String(n) + ' 次尝试' : '';
}

/** `none`: the Tasks the hover read with an empty `owners`. */
function ownersOf(extra: TaskMapExtraReads | undefined): { byTask: Record<string, string>; goal: string; none: Set<string> } {
  const byTask: Record<string, string> = {};
  const none = new Set<string>();
  let goal = '';
  const hover = extra?.hover;
  if (hover === null || hover === undefined) return { byTask, goal, none };
  for (const entry of Array.isArray(hover.tasks) ? hover.tasks : []) {
    const row = asRecord(entry);
    const id = asText(asRecord(row.task).taskId);
    const text = ownerWords(row.owners);
    if (id !== '' && text !== '') byTask[id] = text;
    if (id !== '' && Array.isArray(row.owners) && row.owners.length === 0) none.add(id);
  }
  for (const entry of Array.isArray(hover.groups) ? hover.groups : []) {
    const row = asRecord(entry);
    if (asRecord(row.node).kind !== 'goal') continue;
    /* DESIGN `:362`, `:1220` (prototype goalAgentAt): the other lines working, else paused */
    const more = (count: unknown): string => { const c = archivedCountOf(count); return c.known && !/^(至少 )?0$/.test(c.text) ? c.text : ''; };
    const working = more(row.workingLines); const paused = more(row.pausedLines);
    goal = ownerWords(row.owners);
    if (goal !== '') goal += working !== '' ? '，另有 ' + working + ' 条工作线工作中' : paused !== '' ? '，另有 ' + paused + ' 条工作线已暂停' : '';
  }
  return { byTask, goal, none };
}

/** The longest unfinished dependency chain over the graph's real edges. A Task
 * is open until satisfied/cancelled; no duration is estimated. */
function criticalPath(
  nodes: readonly string[], deps: Record<string, string[]>, st: Record<string, string>,
): string[] {
  const memo = new Map<string, number>();
  /* A Task with no state at this instant is not in the plan then; the timeline's
     `not_in_plan` arrives as an omitted key and is no part of the chain. */
  const isOpenTask = (id: string): boolean =>
    st[id] !== undefined && st[id] !== 'satisfied' && st[id] !== 'cancelled';
  const longest = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, 0);
    if (!isOpenTask(id)) return 0;
    let best = 0;
    for (const dep of deps[id] ?? []) best = Math.max(best, longest(dep));
    memo.set(id, best + 1);
    return best + 1;
  };
  /* An absent Task and its edges are gone before the end of the chain is chosen. */
  const present = nodes.filter((id) => st[id] !== undefined);
  const next: Record<string, string[]> = {};
  present.forEach((id) => (deps[id] ?? []).forEach((dep) => { (next[dep] = next[dep] ?? []).push(id); }));
  let sink = '';
  let size = -1;
  for (const id of present) {
    if ((next[id] ?? []).length > 0) continue;
    const s = longest(id);
    if (s > size) { size = s; sink = id; }
  }
  /* Ruling 5: a chain of zero open Tasks is no critical path; never keep a
   * satisfied sink just because it is the only one. */
  if (sink === '' || size <= 0) return [];
  const chain: string[] = [];
  let cur = sink;
  while (cur !== '') {
    chain.unshift(cur);
    let best = '';
    for (const dep of deps[cur] ?? []) {
      if (isOpenTask(dep) && (best === '' || longest(dep) > longest(best))) best = dep;
    }
    cur = best;
  }
  return chain;
}

/** Browser-local `MM-DD HH:mm` for a stored instant; never `slice` an ISO string
 * (design §4). An unreadable instant keeps the raw text. */
export function localShortAt(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' '
    + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** Who requested or adopted a change (DESIGN `:607`). */
export const ACTOR_WORD: Record<string, string> = { human: '人工', system: '系统自动', agent: 'Agent' };

/** The five failure classes (DESIGN `:607`). */
export const FAILURE_CLASS_WORD: Record<string, string> = {
  run_failed: '执行失败', check_failed: '检查未通过', check_incomplete: '检查不完整',
  interrupted: '平台中断', cancelled: '已取消',
};

/* The gap-code words; a code outside this table is 其他缺项. The page reads the
   words, never the codes. */
const GAP_WORD: Record<string, string> = {
  uncovered_requirement: '没有检查覆盖的必需要求',
  missing_check: '少了必需的检查',
  pending_check: '必需的检查没有跑',
  interrupted_check: '检查被中断',
  reviewer_missing: '缺审阅',
};

/** `failure.round.gapCodes` as the page reads them: distinct words, joined by
 * 、; a repeated code or a second code with the same word adds nothing. */
export function gapTextOf(codes: string[]): string {
  const words: string[] = [];
  for (const code of codes) {
    const word = GAP_WORD[code] ?? '其他缺项';
    if (words.indexOf(word) < 0) words.push(word);
  }
  return words.join('、');
}

/** An automatic rework's reason is the code `auto-rework:<class>#<n>`
 * (`workflow.ts`); its class and count are shown from their own fields. */
const isAutoReworkCode = (reason: string): boolean => reason.startsWith('auto-rework:');

/** Ruling 5: rework history from `tasks[].rework.entries`, no demo batch:
 * 第 n 次 · who · class · reason · date (DESIGN `:507`). 第 n 次 is the
 * rework's order, never an attempt ordinal. */
export function reworkLines(rework: unknown): string[] {
  const entries = asRecord(rework).entries;
  const cap = asRecord(rework).cap;
  return (Array.isArray(entries) ? entries : []).map((entry, index) => {
    const row = asRecord(entry);
    const at = asText(row.requestedAt);
    /* 5.4-6: an automatic entry names its count and cap; a manual requeue resets
       the automatic count, so the two numbers can differ. */
    const who = row.automatic === true ? '系统自动' + countOf(row.autoCount, cap)
      : ACTOR_WORD[asText(asRecord(row.requestedBy).kind)] ?? '人工';
    return ['第 ' + String(index + 1) + ' 次', who, FAILURE_CLASS_WORD[asText(row.failureClass)] ?? '',
      isAutoReworkCode(asText(row.reason)) ? '' : asText(row.reason), at !== '' ? localShortAt(at) : '']
      .filter((part) => part !== '').join(' · ');
  });
}

/** 5.5-7: a non-claimable Task under a paused/cancelled Goal says why, from the
 * display phase this page read; another Goal state says it is not running. */
function goalNotActiveWhy(display: TaskMapDisplayRead, row: Record<string, unknown>): string {
  const reasons = asRecord(row.eligibility).reasons;
  const notActive = (Array.isArray(reasons) ? reasons : [])
    .some((entry) => asText(asRecord(entry).code) === 'goal_not_active');
  if (!notActive) return '';
  return display.display.phase === 'PAUSED' ? '目标已暂停，暂不领取'
    : display.display.phase === 'CANCELLED' ? '目标已取消，不再领取' : '目标没在进行，暂不领取';
}

/** `goal` is the unwrapped `ReadResult<GoalDetail>` value; `graph` is the
 * unwrapped `ReadResult<TaskGraph>` value, or null for the ruled `not_found`. */
export function adaptTaskMap(
  goal: TaskMapGoalRead, graph: TaskMapGraphRead | null, display: TaskMapDisplayRead,
  extra?: TaskMapExtraReads,
): TaskMapData {
  const goalBody = goal.goal;
  const goalRef = goalBody.ref;
  const state = goalDisplayState(display.display.phase);
  const goalData = { id: asText(goalRef.goalId), name: asText(goalBody.objective), st: state.st, word: state.word,
    ordinal: typeof goal.ordinal === 'number' ? goal.ordinal : null };
  const owners = ownersOf(extra);
  const anchors = anchorWhyOf(extra);
  const l46 = l46WhyOf(extra);
  const anchorCounts = anchorCountsOf(extra);
  const emptyDag: TaskMapDag = { edges: [], nodes: [], band: [], dropped: [], gateIds: [], crit: [], owners: {}, goalOwner: '' };
  if (graph === null) return { goal: goalData, stages: [], tasks: [], running: {}, dag: emptyDag, planMissing: true };

  const plan = graph.plan;
  const stages = plan.stages.map((entry) => {
    const stage = asRecord(entry);
    return { id: asText(stage.stageId), name: asText(stage.title), description: asText(stage.description) };
  });
  const instructions = new Map(revisionAssignments(plan as unknown as Parameters<typeof revisionAssignments>[0]).map((entry) => [entry.taskId, entry.instruction]));
  const kept: TaskMapTask[] = [];
  const dropped: TaskMapDropped[] = [];
  for (const entry of graph.tasks) {
    const row = asRecord(entry);
    const definition = asRecord(row.definition);
    const id = asText(definition.taskId);
    const disposition = asText(row.disposition) || asText(definition.disposition);
    const cause = asText(asRecord(row.phaseCause).code);
    const st = taskState(asText(row.effectivePhase), definition.executionIntent, disposition, cause,
      automationStopOf(row), asRecord(row.eligibility).eligible === true);
    if (st === null) {
      const replaced = asText(asRecord(row.dispositionChange).replacedByTaskId) || asText(definition.replacedByTaskId);
      const why = asText(asRecord(asRecord(row.dispositionChange).reason).text);
      dropped.push({ id, name: asText(definition.title),
        word: disposition === 'superseded' ? '已替代' : '已取消',
        why: why !== '' ? why : replaced !== '' ? '由 ' + replaced + ' 取代' : '',
        setIn: asRecord(row.dispositionChange).setIn,
        /* 5.10-3: a cancelled work Task can be restored; a superseded one and a
           gate cannot. */
        canRestore: disposition === 'cancelled' && definition.taskKind !== 'gate' });
      continue;
    }
    const stage = stageOf(definition);
    const attempt = typeof row.attemptOrdinal === 'number' ? row.attemptOrdinal : null;
    const gapCodes = asRecord(asRecord(row.failure).round).gapCodes;
    const gaps = Array.isArray(gapCodes)
      ? gapTextOf(gapCodes.map((code) => asText(code)).filter((code) => code !== '')) : '';
    /* 负责 names the attempt after a line from the second on (prototype:2276); 未分配 has none */
    if (owners.byTask[id] !== undefined && attemptText(attempt) !== '') owners.byTask[id] += '，' + attemptText(attempt);
    /* the cards read `dag.owners`, so 未分配 goes there too */
    const unassigned = owners.byTask[id] === undefined && owners.none.has(id) ? unassignedOf(st) : '';
    if (unassigned !== '') owners.byTask[id] = unassigned;
    /* D101-3: a blocked Task names what blocks it; an anchor still comes first.
       5.5-7: a claimable Task under a Goal that is not running says why. */
    let why = anchors[id] ?? l46.byTask[id] ?? taskWhyOf(row, st);
    if (why === '' && st === 'pending') why = goalNotActiveWhy(display, row);
    kept.push({
      id,
      stageId: stage === '' ? null : stage,
      name: asText(definition.title),
      st,
      why: why,
      deps: [],
      gate: definition.taskKind === 'gate',
      optional: definition.requirementLevel === 'optional',
      scopeKind: asText(asRecord(definition.scope).kind),
      owner: owners.byTask[id] ?? '',
      instruction: instructions.get(id) ?? '',
      rework: reworkLines(row.rework),
      reworkCap: typeof asRecord(row.rework).cap === 'number' ? asRecord(row.rework).cap as number : null,
      attempt,
      gaps,
      anchors: anchorCounts.byTask[id] ?? 0,
    });
  }
  const keptById = new Map(kept.map((task) => [task.id, task]));
  const edges: TaskMapDagEdge[] = [];
  for (const entry of plan.executionDag.dependsOn) {
    const fact = asRecord(entry);
    const taskId = asText(fact.taskId);
    const dependsOnId = asText(fact.dependsOnId);
    if (!keptById.has(taskId) || !keptById.has(dependsOnId)) continue;
    const requires = asRecord(fact.requires);
    edges.push({ taskId, dependsOnId,
      requires: asText(requires.kind) === '' ? null : { kind: asText(requires.kind), label: asText(requires.label) } });
  }
  const incoming = new Set(edges.map((edge) => edge.taskId));
  const outgoing = new Set(edges.map((edge) => edge.dependsOnId));
  const obligated = new Set<string>();
  for (const entry of Array.isArray(plan.obligations) ? plan.obligations : []) {
    for (const id of (Array.isArray(asRecord(entry).taskIds) ? asRecord(entry).taskIds as unknown[] : [])) {
      const text = asText(id);
      if (text !== '') obligated.add(text);
    }
  }
  /* Design line 169: the unscheduled band needs all four — no incoming edge, no
   * outgoing edge, not a gate, and no acceptance obligation. */
  const band = kept.filter((task) => (task.st === 'future' || task.st === 'deferred')
    && !task.gate && !incoming.has(task.id) && !outgoing.has(task.id) && !obligated.has(task.id))
    .map((task) => task.id);
  const bandSet = new Set(band);
  const nodes = kept.filter((task) => !bandSet.has(task.id)).map((task) => task.id);
  const nodeSet = new Set(nodes);
  const deps: Record<string, string[]> = {};
  for (const id of nodes) deps[id] = [];
  for (const edge of edges) {
    if (nodeSet.has(edge.taskId) && nodeSet.has(edge.dependsOnId)) (deps[edge.taskId] ??= []).push(edge.dependsOnId);
  }
  for (const task of kept) task.deps = deps[task.id] ?? [];
  const st: Record<string, string> = {};
  kept.forEach((task) => { st[task.id] = task.st; });
  const rootNames = l46.roots.map((id) => keptById.get(id)?.name ?? '').filter((name) => name !== '');
  const waits = asRecord(extra?.waits);
  const allBlocked = Object.keys(asRecord(waits.goalBlocked)).length > 0 && rootNames.length > 0
    ? '能做的任务都在等你确认：' + rootNames.map((name) => '「' + name + '」').join('、') : '';
  const dag: TaskMapDag = {
    edges,
    nodes,
    band,
    dropped,
    gateIds: kept.filter((task) => task.gate).map((task) => task.id),
    crit: criticalPath(nodes, deps, st),
    critAt: (states: Record<string, string>) => criticalPath(nodes, deps, states),
    owners: owners.byTask,
    goalOwner: owners.goal,
  };
  return { goal: goalData, stages, tasks: kept, running: {}, dag, moduleNames: moduleNamesOf(extra?.hover),
    anchorCount: anchorCounts.total > 0 ? { n: anchorCounts.total, atLeast: anchorCounts.atLeast } : null,
    allBlocked };
}

/** Module id → name from one `graph/hover` read; TaskMap and Main's right panel name a Task's module by it. */
export function moduleNamesOf(hover: TaskMapHoverRead | null | undefined): Record<string, string> {
  const moduleNames: Record<string, string> = {};
  for (const entry of Array.isArray(hover?.modules) ? hover.modules : []) {
    const row = asRecord(entry); const moduleId = asText(asRecord(row.module).moduleId);
    if (moduleId !== '' && asText(row.name) !== '') moduleNames[moduleId] = asText(row.name);
  }
  return moduleNames;
}

/** The historical state of every Task at one instant (design §6). The timeline
 * is approximate and the segments are half-open; `not_in_plan` and `unknown`
 * keep their own state rather than a guessed one. */
export type TaskMapTimelineRead = {
  tasks: Array<{ taskId: string; segments: Array<{ from: string | null; to: string | null; state: string;
    /** The point that opened the segment (`TaskStateSegmentV1.point`). */
    point?: { kind?: unknown; source?: unknown } | null }> }>;
};
/** One Task's state at an instant: the board state word, the raw timeline state
 * and the two flags only the timeline can justify. */
export type TaskMapHistoricalState = {
  st: string; word: string; raw: string; off?: boolean; faint?: boolean;
  /** `not_in_plan`: when the Task joined, the next segment's `from`. */
  addedAt?: string;
  /** The Run whose end opened the segment, in the run bar's key: its reason is
   * that bar's, never the Task's last bar's. */
  runKey?: string;
};

/** Raw timeline state -> the board's square state and word. `not_in_plan` is the
 * task not being in the plan yet (off/faint); `unknown` is the timeline not
 * knowing, never 需要你决定. */
const HISTORICAL_STATE: Record<string, { st: string; word: string; off?: boolean; faint?: boolean }> = {
  not_in_plan: { st: 'pending', word: '不在计划里', off: true, faint: true },
  unknown: { st: 'pending', word: '未知' },
  pending: { st: 'pending', word: '待执行' },
  running: { st: 'running', word: '执行中' },
  awaiting_check: { st: 'verifying', word: '待检查' },
  verifying: { st: 'verifying', word: '验证中' },
  satisfied: { st: 'satisfied', word: '已满足' },
  check_failed: { st: 'failed', word: '检查未通过' },
  check_incomplete: { st: 'blocked', word: '检查不完整' },
  run_failed: { st: 'failed', word: '执行失败' },
  run_cancelled: { st: 'cancelled', word: '执行已取消' },
  interrupted: { st: 'blocked', word: '中断，待核对' },
  interrupted_pending_check: { st: 'blocked', word: '中断，待检查' },
  paused: { st: 'waiting', word: '已暂停' },
  waiting_reply: { st: 'waiting', word: '等回答' },
  outcome_unknown: { st: 'decide', word: '执行结果待核对' },
  deferred: { st: 'deferred', word: '已延后' },
  cancelled: { st: 'cancelled', word: '已取消' },
  superseded: { st: 'cancelled', word: '已替代' },
};

export function taskMapStatesAt(
  timeline: TaskMapTimelineRead, at: string,
): ReadonlyMap<string, TaskMapHistoricalState> {
  const instant = Date.parse(at);
  const out = new Map<string, TaskMapHistoricalState>();
  if (Number.isNaN(instant)) return out;
  for (const task of timeline.tasks) {
    let found = 'unknown';
    let next: string | null = null;
    let point: Record<string, unknown> = {};
    for (const [index, segment] of task.segments.entries()) {
      /* Half-open [from, to): the ending instant belongs to the next segment. */
      const from = segment.from === null ? -Infinity : Date.parse(segment.from);
      const to = segment.to === null ? Infinity : Date.parse(segment.to);
      if (from <= instant && instant < to) { found = segment.state; next = task.segments[index + 1]?.from ?? null; point = asRecord(segment.point); break; }
    }
    const known = HISTORICAL_STATE[found] ?? { st: 'pending', word: '未知' };
    const ran = point.kind === 'run_end' && asRecord(point.source).aggregateType === 'Run';
    out.set(task.taskId, { ...known, raw: found, ...(found === 'not_in_plan' && next !== null ? { addedAt: next } : {}),
      ...(ran ? { runKey: previousKeyOf(point.source) } : {}) });
  }
  return out;
}

/* ------------------------------------------------------------------ detail */

/** One `graph/detail` summary task: only the fields the panel shows. */
export type TaskMapDetailTaskRead = {
  task: unknown; planRef?: unknown; title?: unknown; phase?: unknown; phaseCause?: unknown;
  /** The Task's Goal workspace, supplied by the `graph/detail` read from that Goal. */
  workspaceId?: unknown;
  disposition?: unknown; owners?: unknown; participatedLines?: unknown; failure?: unknown;
  actualFiles?: unknown; responsibleNow?: unknown; plannedModules?: unknown; plannedFiles?: unknown;
  /** §2.8: the held claim-hold reasons, the release-all affordance, the dispatch request and the stop card. */
  holds?: unknown; holdRelease?: unknown; dispatch?: unknown; stop?: unknown;
};
/** The Task's Goal workspace and the board's main workspace are both required:
 * a Task living in another workspace is never keyed by the board's scope. */
export type TaskMapSummaryRead = { section: 'summary'; task: TaskMapDetailTaskRead | null;
  workspaceId: string; mainWorkspaceId: string };
/** One `graph/detail` `section:'risks'` page: Tasks with no edge to this one that share its module or a file. */
export type TaskMapRiskRead = { items?: unknown[]; nextCursor?: string | null };

export type TaskMapParticipantRead = {
  items: Array<{ key?: unknown; name?: unknown; status?: unknown; via?: unknown; duty?: unknown }>;
  nextCursor?: string | null;
};
export type TaskMapParticipationCounts = {
  complete: boolean; executions: number; checks: number; consultations: number;
} | null;
export type TaskMapCatalogRead = {
  modules?: Array<{ ref?: { moduleId?: unknown }; name?: unknown; paths?: unknown }>;
  containment?: { parentOf?: Array<{ parent?: { moduleId?: unknown }; child?: { moduleId?: unknown } }> };
} | null;

export type TaskMapDetailFile = { path: string; name: string; certainty: string; tag: string };
/** `files/uncommitted`'s value (E3-7): the Task's files against the workspace's HEAD, now. */
export type TaskMapUncommittedRead = {
  repository?: unknown;
  files?: Array<{ path?: unknown; state?: unknown; lines?: { added?: unknown; deleted?: unknown } | null }>;
} | null;
export type TaskMapDetailArchGroup = { crumb: string; files: TaskMapDetailFile[] };
export type TaskMapNodeDetailData = {
  id: string; word: string; why: string;
  stageName: string;
  owner: string; hasOwner: boolean;
  /** Current owner is "现在"; a replay hides the historical relation (ruling 5). */
  ownerNow: boolean;
  files: TaskMapDetailArchGroup[];
  hasFiles: boolean;
  /** How many files the plan lists (prototype:3388 计划要改 n 个文件); 0 when it lists none. */
  plannedFileCount: number;
  /** E3-7: what the 架构 summary adds after 实际改过／可能改过（现在）, without the ` · `; '' adds nothing. */
  filesNote: string;
  /** D42-2: the record could not say which files changed (or may be incomplete
   * with none named), so the detail says 改动未知. */
  filesUnknown: boolean;
  /** `archived`: the line's `status.bucket`; the track opens it among the archived lines. */
  participants: Array<{ name: string; text: string; key: { projectId: string; sessionId: string } | null; archived: boolean; role: string }>;
  hasParticipants: boolean;
  noParticipants: boolean;
  /** Whether the participants pages were read and whether the last page ended. */
  participantsLoaded: boolean;
  participantsComplete: boolean;
  countsComplete: boolean;
  /** The `tasks/query` row's `attemptOrdinal`; it shows words only from the second attempt on. */
  attemptOrdinal: number | null;
  /** Decision 26: 重叠, one row per risk (`<task> · <module | file>（没有连线）`). */
  overlaps: Array<{ id: string; text: string }>; overlapsComplete: boolean;
  /** E3I:244 without 从 <from> (`active` has no word): 由 <actor> 于计划 <time> 改为 <to>：<reason>. */
  disposition: { word: string; text: string } | null;
  /** §2.8: every hold reason worded as one line, including released and expired ones;
   * `current` marks a held, unexpired reason. */
  holds: Array<{ text: string; current: boolean }>;
  /** §2.8: the release-all affordance; null when the read carried none. */
  holdRelease: { available: boolean; task: TaskTriple } | null;
  /** §2.8: the dispatch request's detail lines and its short mini-card state. */
  dispatch: { lines: string[]; cardStatus: string } | null;
  /** §2.8: the stop request's steps and not-sent reason, and its short mini-card state. */
  stop: { lines: string[]; cardStatus: string } | null;
  /** §2.8: the mini card's one status line: the current holds, the waiting stop card and the dispatch request. */
  cardStatus: string;
  /** T5: the failure facts and the round chain, worded; [] when there are none. */
  failure: Array<{ k: string; v: string }>;
  /** T7: one line per anomaly anchor, already worded; [] when there are none. */
  anchors: string[];
};

export const PHASE_WORD: Record<string, string> = {
  ready: '可领取', claimable: '可领取', pending: '待执行', future: '未来意图', running: '执行中',
  awaiting_check: '待检查', verifying: '验证中', check_failed: '检查未通过', check_incomplete: '检查不完整',
  run_failed: '执行失败', run_cancelled: '执行已取消', interrupted: '中断，待核对',
  interrupted_pending_check: '中断，待检查', paused: '已暂停', waiting: '已暂停，可继续', waiting_reply: '等回答',
  outcome_unknown: '结果未知', decide: '需要你决定', blocked: '受阻', failed: '失败',
  satisfied: '已满足', cancelled: '已取消', superseded: '已替代', deferred: '已延后',
};

/* The line's own state code -> the line state words (slice-2C-SPEC.md:1049-1059;
 * DESIGN `:608`; decision 38 retired 已结束). The track rows and the owners
 * read this one table; an unrecognized code is shown as 未知 rather than
 * leaking an English code into the page. */
const OWN_WORD: Record<string, string> = {
  working: '工作中', checking: '正式检查中', starting: '启动中', waiting_reply: '等回复',
  paused: '已暂停', unknown: '待核对', done: '已做完', retired: '已退役', standby: '待命',
};
/* The line's most urgent attention, in the track's own words (board `wlStatus`). */
const ATTENTION_WORD: Record<string, string> = {
  decide: '等你决定', failed: '停下（失败）', blocked: '停下（受阻）', unknown: '待核对',
};

/* A line with no task is named by its duty code (`source: 'duty_only'`); the
   page shows the board's own group word for it, never the code (DESIGN `:604`). */
const DUTY_WORD: Record<string, string> = {
  secretary: '秘书', adviser: '参谋', scribe: '书记', reviewer: '审阅者', executor: '执行者',
};
/** D49-01: a line's name; when it counts more than its first Task, “首项 等 n 项”. */
export function lineNameOf(name: unknown): string {
  const row = asRecord(name);
  if (row.source === 'duty_only') return DUTY_WORD[asText(row.primary)] ?? '未分组';
  const extra = typeof row.extraCount === 'number' ? row.extraCount : 0;
  return asText(row.primary) + (extra > 0 ? ' 等 ' + String(extra) + ' 项' : '');
}

function ownerWords(owners: unknown): string {
  return (Array.isArray(owners) ? owners : []).flatMap((entry) => {
    const row = asRecord(entry);
    const name = lineNameOf(row.name);
    if (name === '') return [];
    /* The hover card and the track show one main state plus the most urgent attention (E3I:310). */
    const status = asRecord(row.status);
    const own = asText(status.own);
    const word = ATTENTION_WORD[asText(asRecord(status.attention).code)] ?? (own === '' ? '' : OWN_WORD[own] ?? '未知');
    return [word === '' ? name : name + ' · ' + word];
  }).join('、');
}

function detailWhy(task: TaskMapDetailTaskRead): string {
  /* `phaseCause.code` is a phase-cause code. The summary carries no failure
   * verdict (WL:296-299): a stop reason reaches the detail as the map row's why. */
  const code = asText(asRecord(task.phaseCause).code);
  return code === '' ? '' : PHASE_CAUSE_WORD[code] ?? '';
}

/** Decision 49·01 (E3I:309): a participation is 现在负责 or 曾参与. The
 * relation includes closed ones, so `responsible` alone is not "now": only a
 * line also in `responsibleNow` is. */
const PARTICIPATION_CODES = new Set(['responsible', 'participates', 'investigated', 'claimed']);

/** The participant text counts only a complete history range; an incomplete
 * window shows the line and hides every total (design §1, row 975). */
function participantText(item: Record<string, unknown>, counts: TaskMapParticipationCounts, now: ReadonlySet<string>): string {
  if (counts === null || !counts.complete) {
    if (now.has(trackSessionKeyOf(item.key))) return '现在负责';
    return PARTICIPATION_CODES.has(asText(item.via)) ? '曾参与' : '';
  }
  const parts: string[] = [];
  if (counts.executions > 0) parts.push('执行 ' + counts.executions + ' 次');
  if (counts.checks > 0) parts.push('检查 ' + counts.checks + ' 轮');
  if (counts.consultations > 0) parts.push('回答咨询 ' + counts.consultations + ' 次');
  return parts.join(' · ');
}

/* §2.8: the actions a task card names in the same words Decide's release card
 * uses; this module owns the one copy both cards import. */
const HOLD_KIND_WORD: Record<string, string> = {
  agent: '暂缓', stop: '叫停', scribe_stop: '书记暂缓',
};
const TARGET_BLOCKER_WORD: Record<string, string> = {
  module_gate: '模块门', node_occupied: '节点被占用', line_busy: '工作线都在忙',
};

/** The three hold kinds' words: the task card and the request feedback share
 * this one table, and an unknown kind falls back to 暂缓. */
export function holdKindWordOf(kind: unknown): string {
  return HOLD_KIND_WORD[asText(kind)] ?? '暂缓';
}

/** The one “计划第 n 版 / 还没有计划” wording the task card, the release card
 * and the request feedback share. */
export function planVersionText(revision: number | null): string {
  return revision === null ? '还没有计划' : '计划第 ' + String(revision) + ' 版';
}

/** One plan reference in human words: the current version's number when it is
 * that same version, otherwise only how it stands against the plan read now. */
export function planRefText(planId: string, current: unknown): string {
  const plan = asRecord(current);
  if (Object.keys(plan).length === 0) return '当时的那一版计划';
  if (asText(plan.planId) !== planId) return '较早的一版计划';
  return planVersionText(typeof plan.planRevision === 'number' ? plan.planRevision : null);
}

/** The Run a stop request names, in human words; the attempt ordinal is the
 * row's own, never a counter kept here. */
export function stopRunText(stopRun: unknown, taskRow: Record<string, unknown> | null): string {
  if (taskRow === null) return '这个任务的一次运行';
  if (asText(asRecord(stopRun).runId) !== asText(asRecord(taskRow.execution).runId)) {
    return '这个任务较早的一次运行';
  }
  const attempt = attemptText(typeof taskRow.attemptOrdinal === 'number' ? taskRow.attemptOrdinal : null);
  return '正在跑的这一次' + (attempt === '' ? '' : '（' + attempt + '）');
}

/** One claim blocker as the task card's own sentence; an unknown kind adds nothing. */
export function blockerTextOf(row: Record<string, unknown>): string {
  const kind = asText(row.kind);
  const reason = asText(row.reason);
  if (kind === 'claim_hold') {
    return holdKindWordOf(row.holdKind) + (reason === '' ? '' : '：' + reason);
  }
  if (kind === 'stop_pending') return '有叫停请求在等答复';
  if (kind === 'goal_paused') return '目标已暂停';
  const word = TARGET_BLOCKER_WORD[kind];
  return word === undefined ? '' : word + (reason === '' ? '' : '：' + reason);
}

/* §2.8: the stop request's steps in the order the record proves them. */
const STOP_STEP_WORD: Record<string, string> = {
  requested: '已请求', hold_placed: '已暂缓领取', sent: '已发送', delivered: '已送达',
  run_ended: '运行已结束', not_sent: '没有发送', void: '已作废',
};

/** A released stop's not-sent cause; anything else adds no sentence. */
function notSentWordOf(outcome: Record<string, unknown>): string {
  const notSent = asText(outcome.notSent);
  return notSent === 'person_stopped' ? '你叫停了' : notSent === 'run_ended' ? '运行已结束' : '';
}

/** Pure detail projection (design §6): no request, no DOM. `summary` is the
 * unwrapped `graph/detail` summary; participants are its `section:'participants'`
 * pages; `catalog` names planned modules and groups actual files. A plan that lists
 * files names them (计划要改); an actual file's line counts and "未提交" come only from the `files/uncommitted` read (E3-7). */
export function adaptTaskMapDetail(
  summary: TaskMapSummaryRead, participants: readonly TaskMapParticipantRead[],
  counts: TaskMapParticipationCounts, catalog: TaskMapCatalogRead,
  /** The state the map already shows for this node. The detail must not
   * recompute it from `phase/disposition`: a future intention stays 未来意图. */
  state: string,
  /** The reason the map row already shows. The summary does not carry the
   * failure verdict, so its `phaseCause` would otherwise hide a stop reason
   * (e.g. 自动返工已达上限) that the map already read. */
  mapWhy = '',
  /** The `tasks/query` row's `dispositionChange` (the summary has none) and
   * the local text of its plan's acceptedAt; '' drops 于计划 …. */
  dispositionChange: unknown = null, changeAt = '',
  /** The `risks` pages read with the detail. */
  risks: readonly TaskMapRiskRead[] = [],
  /** The `tasks/query` row's `attemptOrdinal`; 负责 names it after a line, never after 未分配. */
  attempt: number | null = null,
  /** E3-7: the `files/uncommitted` value for this Task's actual paths; null when it was not read or failed. */
  uncommitted: TaskMapUncommittedRead = null,
  /** The `tasks/query` plan read at this place; the claimed plan is worded against it. */
  currentPlan: unknown = null,
  /** The `tasks/query` Task row read at this place; the stop Run is worded against it. */
  taskRow: Record<string, unknown> | null = null,
): TaskMapNodeDetailData | null {
  const task = summary.task;
  if (task === null) return null;
  const body = asRecord(task.task);
  const id = asText(body.taskId);
  const disposition = asText(task.disposition) || asText(body.disposition);
  const word = PHASE_WORD[state] ?? '未知';
  const line = ownerWords(task.responsibleNow) || ownerWords(task.owners);
  const who = line !== '' ? line + (attemptText(attempt) !== '' ? '，' + attemptText(attempt) : '')
    : asRecord(task).responsibility === 'none' ? unassignedOf(state) : '';
  const modules = (catalog?.modules ?? []).flatMap((entry) => {
    const paths = (Array.isArray(entry.paths) ? entry.paths : []).filter((path): path is string => typeof path === 'string');
    /* a module with paths: [] stays: it can be planned, and pathOwnershipOf skips it for real files */
    return [{ value: { id: asText(entry.ref?.moduleId), name: asText(entry.name) }, paths }];
  });
  // The task map keys one row per PROJECT path: a main-workspace file stays bare,
  // another workspace's file carries the canonical `/@ws:` prefix. Module
  // ownership is then read on that one workspace's projection of the ONE project
  // catalog, and only the row DTO's last step turns the key into display text.
  const mainWorkspaceId = asText(summary.mainWorkspaceId);
  const taskWorkspaceId = asText(task.workspaceId) || asText(summary.workspaceId);
  const projectPathOf = (path: string, workspaceId: string): string =>
    qualifyProjectPath(workspaceId, path, mainWorkspaceId);
  const displayRow = (projectPath: string): { path: string; name: string } => {
    const shown = displayProjectPath(projectPath);
    return { path: shown, name: shown.split('/').pop() ?? shown };
  };
  const adopted: AdoptedArchitecture = {
    modules: (catalog?.modules ?? []).map((entry) => ({
      ref: { projectId: '', moduleId: asText(entry.ref?.moduleId) },
      name: asText(entry.name), responsibility: '',
      paths: (Array.isArray(entry.paths) ? entry.paths : []).filter((path): path is string => typeof path === 'string'),
      interfaces: [] })),
    dependencies: [], requireDag: false,
    ...(catalog?.containment === undefined ? {} : {
      containment: { parentOf: (catalog.containment.parentOf ?? []).flatMap((edge) => {
        const parent = asText(edge.parent?.moduleId);
        const child = asText(edge.child?.moduleId);
        return parent === '' || child === '' ? [] : [{ parent: { projectId: '', moduleId: parent },
          child: { projectId: '', moduleId: child } }];
      }) } }),
  };
  const workspaceModules = new Map<string, typeof modules>();
  const projectedModulesOf = (workspaceId: string): typeof modules => {
    let cached = workspaceModules.get(workspaceId);
    if (cached === undefined) {
      cached = catalogForWorkspace(adopted, workspaceId, mainWorkspaceId).modules.map((module) => ({
        value: { id: module.ref.moduleId, name: module.name }, paths: module.paths }));
      workspaceModules.set(workspaceId, cached);
    }
    return cached;
  };
  const parents = new Map<string, string>();
  for (const edge of catalog?.containment?.parentOf ?? []) {
    const parent = asText(edge.parent?.moduleId);
    const child = asText(edge.child?.moduleId);
    if (parent !== '' && child !== '') parents.set(child, parent);
  }
  /* the module and its catalog ancestors, the module first */
  const chainOf = (moduleId: string): Array<{ id: string; name: string }> => {
    const chain: Array<{ id: string; name: string }> = [];
    let cur = moduleId;
    for (let step = 0; cur !== '' && step < 32; step += 1) {
      const found = modules.find((entry) => entry.value.id === cur);
      if (found === undefined) break;
      chain.push(found.value);
      cur = parents.get(cur) ?? '';
    }
    return chain;
  };
  const crumbOf = (moduleId: string): string => chainOf(moduleId).map((entry) => entry.name).reverse().join(' / ');
  const actual = asRecord(task.actualFiles);
  /* Contract `FromExecutedFilesV1` carries `availability`; `status` is never a
   * field of it, so reading `status` hid every real file (design §3/§5). */
  const executed = actual.availability === 'available' && Array.isArray(actual.value) ? actual.value : [];
  const groups = new Map<string, TaskMapDetailFile[]>();
  const push = (crumb: string, row: TaskMapDetailFile): void => {
    const rows = groups.get(crumb) ?? [];
    rows.push(row);
    groups.set(crumb, rows);
  };
  const moduleIdOfPath = (path: string, workspaceId: string): string => {
    const own = pathOwnershipOf(path, projectedModulesOf(workspaceId));
    return own.status === 'owner' ? String(own.owner.id) : '';
  };
  const crumbOfPath = (path: string, workspaceId: string): string => {
    const moduleId = moduleIdOfPath(path, workspaceId);
    return moduleId === '' ? '未归入模块' : crumbOf(moduleId);
  };
  /* 计划要改 (prototype:3381-3383, decision 121-10): a plan that lists files names each one under its own module, in
   * the plan's order and ahead of the other actual files; a plan without a list keeps one row per planned module.
   * The plan's files are the Task workspace's, so they key by their canonical project path. */
  const listed = (Array.isArray(task.plannedFiles) ? task.plannedFiles : []).map(asText).filter((path) => path !== '');
  const listedProjectPaths = listed.map((path) => projectPathOf(path, taskWorkspaceId));
  const inList = new Set(listedProjectPaths);
  const planned = new Set<string>();
  if (inList.size === 0) {
    for (const ref of Array.isArray(task.plannedModules) ? task.plannedModules : []) {
      const moduleId = asText(asRecord(ref).moduleId);
      const crumb = moduleId === '' ? '' : crumbOf(moduleId);
      if (crumb === '') continue;
      planned.add(moduleId);
      push(crumb, { path: '', name: crumb.split(' / ').pop() ?? crumb, certainty: 'planned', tag: '计划要改' });
    }
  }
  /* E3-7: one row per project path. Several Runs of the Task can name the same path -- and the
   * same relative path in two workspaces is two rows; one `definite` makes a row 实际改过.
   * The first appearance keeps its place (the summary is sorted by path). */
  const certaintyOf = new Map<string, 'definite' | 'possible'>();
  const fileWorkspace = new Map<string, string>();
  const filePath = new Map<string, string>();
  for (const entry of executed) {
    const file = asRecord(entry);
    const path = asText(file.path);
    if (path === '') continue;
    const workspaceId = asText(file.workspaceId);
    const projectPath = projectPathOf(path, workspaceId);
    const certainty = asText(file.certainty) === 'possible' ? 'possible' : 'definite';
    if (certaintyOf.get(projectPath) !== 'definite') certaintyOf.set(projectPath, certainty);
    if (!fileWorkspace.has(projectPath)) {
      fileWorkspace.set(projectPath, workspaceId);
      filePath.set(projectPath, path);
    }
  }
  /* E3-7: how each PROJECT path stands against HEAD now. The read is keyed by the same canonical
   * project path as the rows, so two workspaces' same-named files never share a number. No read,
   * not_git or a path the read does not name writes no number (decision 112-3). */
  const headRead = asRecord(uncommitted);
  const stateOf = new Map<string, JsonRecord>();
  if (headRead.repository === 'git' && Array.isArray(headRead.files)) {
    for (const entry of headRead.files) stateOf.set(asText(asRecord(entry).path), asRecord(entry));
  }
  /* E3-7's words for one actual file against HEAD, with this plan's outside (decision 121-10) */
  const actualTag = (projectPath: string, certainty: 'definite' | 'possible', outside: boolean): string => {
    const vsHead = stateOf.get(projectPath);
    const counts = asRecord(vsHead?.lines);
    /* prototype:3381-3382: ` +a −d（未提交）`, the minus is U+2212 */
    const mark = vsHead?.state !== 'uncommitted' ? ''
      : typeof counts.added === 'number' && typeof counts.deleted === 'number'
        ? ' +' + String(counts.added) + ' −' + String(counts.deleted) + '（未提交）' : '（未提交）';
    return (certainty === 'definite' ? '实际改过' : '可能改过') + mark + (outside ? (mark === '' ? ' · ' : '· ') + '不在计划里' : '');
  };
  /* a listed file that ran: 计划要改 · 实际改过 (prototype:3381); one that has not: 计划要改 (prototype:3383) */
  for (const [index, path] of listed.entries()) {
    const projectPath = listedProjectPaths[index]!;
    const certainty = certaintyOf.get(projectPath);
    push(crumbOfPath(path, taskWorkspaceId), certainty === undefined
      ? { ...displayRow(projectPath), certainty: 'planned', tag: '计划要改' }
      : { ...displayRow(projectPath), certainty, tag: '计划要改 · ' + actualTag(projectPath, certainty, false) });
  }
  for (const [projectPath, certainty] of certaintyOf) {
    if (inList.has(projectPath)) continue;
    const path = filePath.get(projectPath) ?? projectPath;
    const moduleId = moduleIdOfPath(path, fileWorkspace.get(projectPath) ?? taskWorkspaceId);
    /* 不在计划里 (prototype:3382): with a list, by file; without one, by module (E3-6 item 6): the file's module
     * is neither a planned module nor under one, or it has none; a plan without modules says nothing. */
    const outside = inList.size > 0 || (planned.size > 0 && !chainOf(moduleId).some((chain) => planned.has(chain.id)));
    push(moduleId === '' ? '未归入模块' : crumbOf(moduleId),
      { ...displayRow(projectPath), certainty, tag: actualTag(projectPath, certainty, outside) });
  }
  /* E3-7: the summary's second half, from the same read (E3I:291; prototype:3389's first clause) */
  const shown = [...certaintyOf.keys()].map((projectPath) => stateOf.get(projectPath)?.state);
  const filesNote = shown.includes('uncommitted') ? '工作区里还没提交的改动，可能混有别的执行的改动'
    : shown.length > 0 && shown.every((entry) => entry === 'clean') ? '工作区里没有它未提交的改动' : '';
  /* D42-2/UI-WORKBENCH:129: an unreadable record, or a possibly incomplete one
   * with no file named, says 改动未知; a known empty record says nothing. */
  const filesUnknown = actual.availability === 'unavailable'
    || (actual.availability === 'available' && executed.length === 0 && actual.possiblyIncomplete === true);
  const lines: TaskMapNodeDetailData['participants'] = [];
  const responsibleNow = new Set((Array.isArray(task.responsibleNow) ? task.responsibleNow : [])
    .map((entry) => trackSessionKeyOf(asRecord(entry).key)));
  for (const page of participants) {
    for (const item of page.items) {
      const row = asRecord(item);
      const name = lineNameOf(row.name) || asText(row.name);
      const key = asRecord(row.key);
      const sessionKey = asText(key.projectId) !== '' && asText(key.sessionId) !== ''
        ? { projectId: asText(key.projectId), sessionId: asText(key.sessionId) } : null;
      if (name !== '') lines.push({ name, text: participantText(row, counts, responsibleNow), key: sessionKey,
        archived: asRecord(row.status).bucket === 'archived', role: asText(row.duty) });
    }
  }
  const participantsLoaded = participants.length > 0;
  const participantsComplete = participantsLoaded
    && (participants[participants.length - 1]?.nextCursor ?? null) === null;
  /* §2.8: who placed a hold, claimed the Task or asked for the stop is a line;
   * this read already carries the current owners and the participation pages,
   * so a SessionRef is named from them and never printed as an id. */
  const nameBySession = new Map<string, string>();
  const rememberLine = (key: unknown, name: unknown): void => {
    const sessionKey = trackSessionKeyOf(key);
    const word = lineNameOf(name) || asText(name);
    if (sessionKey !== '/' && word !== '') nameBySession.set(sessionKey, word);
  };
  for (const entry of Array.isArray(task.responsibleNow) ? task.responsibleNow : []) {
    const row = asRecord(entry); rememberLine(row.key, row.name);
  }
  for (const page of participants) {
    for (const item of page.items) { const row = asRecord(item); rememberLine(row.key, row.name); }
  }
  const lineOfSession = (session: unknown): string =>
    nameBySession.get(trackSessionKeyOf(session)) ?? '';
  const requesterWordOf = (requester: unknown): string => {
    const row = asRecord(requester);
    return lineOfSession(row.session) || DUTY_WORD[asText(row.duty)] || '';
  };
  /* §2.8: every hold reason stays on the card with who, why, its expiry rule and
   * whether it was released or expired; only a held, unexpired reason is current. */
  const holds: TaskMapNodeDetailData['holds'] = [];
  const currentHoldWords: string[] = [];
  for (const entry of Array.isArray(task.holds) ? task.holds : []) {
    const hold = asRecord(entry);
    const kind = asText(hold.kind);
    const placedBy = asRecord(hold.placedBy);
    const placedKind = asText(placedBy.kind);
    const who = placedKind === 'agent'
      ? lineOfSession(placedBy.session) || DUTY_WORD[asText(placedBy.duty)] || ''
      : placedKind === 'action' ? requesterWordOf(hold.requester)
        : placedKind === 'platform' ? '平台' : '';
    const reason = asText(hold.reason);
    const lead = kind === 'scribe_stop' ? '由书记暂缓'
      : kind === 'stop' ? '叫停请求' + (who === '' ? '' : '（' + who + '）') + '批准后暂缓'
        : who === '' ? '暂缓' : '由 ' + who + ' 暂缓';
    const current = asText(hold.state) === 'held' && hold.expired !== true;
    let stateText: string;
    if (current) {
      stateText = asText(asRecord(hold.expiry).rule) === 'never'
        ? '不会自动失效' : '等同一来源的候选了结后失效';
    } else if (asText(hold.state) === 'released') {
      const releasedBy = asRecord(hold.releasedBy);
      const releasedKind = asText(releasedBy.kind);
      const by = releasedKind === 'agent' ? (lineOfSession(releasedBy.session) || '一条工作线')
        : releasedKind === 'person' ? (asText(asRecord(releasedBy.actor).kind) === 'human' ? '你' : '平台')
          : releasedKind === 'intervention' ? '你的直接干预' : '';
      const note = asText(hold.releaseNote);
      stateText = '已撤销' + (by === '' ? '' : '：' + by) + (note === '' ? '' : '，' + note);
    } else {
      stateText = '已失效：同一来源的候选已了结';
    }
    holds.push({ text: lead + (reason === '' ? '' : '：' + reason) + '（' + stateText + '）', current });
    if (current) currentHoldWords.push(holdKindWordOf(kind) + (reason === '' ? '' : '：' + reason));
  }
  const release = asRecord(task.holdRelease);
  const releaseTask = asRecord(asRecord(release.target).task);
  const releaseProjectId = asText(releaseTask.projectId);
  const releaseGoalId = asText(releaseTask.goalId);
  const releaseTaskId = asText(releaseTask.taskId);
  const holdRelease: TaskMapNodeDetailData['holdRelease'] = asText(release.availability) === 'available'
    && releaseProjectId !== '' && releaseGoalId !== '' && releaseTaskId !== ''
    ? { available: true, task: { projectId: releaseProjectId, goalId: releaseGoalId, taskId: releaseTaskId } }
    : null;
  /* §2.8: the dispatch request's own row. A waiting card never blocks the claim:
   * the target loop still claims, and the claim closes the card. The target loop's
   * gate/node/line judgment is shown only when the read supplied it. */
  const dispatchRead = asRecord(task.dispatch);
  const dispatchRequest = asRecord(dispatchRead.request);
  const dispatchLines: string[] = [];
  let dispatchCard = '';
  if (asText(dispatchRequest.action) === 'dispatch') {
    const who = requesterWordOf(dispatchRequest.requester);
    const reason = asText(dispatchRequest.reason);
    dispatchLines.push((who === '' ? '派活请求' : '由 ' + who + ' 请求派活') + (reason === '' ? '' : '：' + reason));
    const planVersion = asRecord(dispatchRequest.planVersion);
    if (Object.keys(planVersion).length > 0) {
      dispatchLines.push('请求时的计划版本：' + planVersionText(
        typeof planVersion.planRevision === 'number' ? planVersion.planRevision : null));
    }
    const state = asText(dispatchRequest.state);
    const outcome = asRecord(dispatchRequest.outcome);
    if (state === 'applied') {
      const claimed = lineOfSession(outcome.session);
      dispatchCard = claimed === '' ? '已有工作线领取' : '已由 ' + claimed + ' 领取';
      dispatchLines.push(dispatchCard);
      const planId = asText(asRecord(dispatchRead.claimedPlanRef).planId);
      if (planId !== '') dispatchLines.push('领取时用的计划：' + planRefText(planId, currentPlan));
    } else if (state === 'void' || asText(outcome.kind) === 'void') {
      const why = asText(outcome.reason);
      dispatchCard = '派活请求作废' + (why === '' ? '' : '：' + why);
      dispatchLines.push(dispatchCard);
    } else if (state === 'released' || state === 'denied' || state === 'withdrawn') {
      const notSent = asText(outcome.kind) === 'released' ? notSentWordOf(outcome) : '';
      dispatchCard = '派活请求已关闭';
      dispatchLines.push(dispatchCard + (notSent === '' ? '' : '：' + notSent));
    } else if (state === 'pending' || state === 'open') {
      dispatchLines.push('平台会照常安排领取，领到后这张卡自动关闭');
      dispatchCard = '等领取';
      const blockers = (Array.isArray(dispatchRead.claimBlockers) ? dispatchRead.claimBlockers : [])
        .map((entry) => blockerTextOf(asRecord(entry))).filter((text) => text !== '');
      const target = dispatchRead.targetLoopBlockers;
      if (target !== 'not_read' && target !== undefined && target !== null) {
        const targetRows = asRecord(target).blockers;
        for (const entry of Array.isArray(targetRows) ? targetRows : []) {
          const text = blockerTextOf(asRecord(entry));
          if (text !== '') blockers.push(text);
        }
      }
      if (blockers.length > 0) dispatchLines.push('现在不能领取：' + blockers.join('；'));
      else if (dispatchRead.claimableNow === false) dispatchLines.push('现在不能领取');
      else if (dispatchRead.claimableNow === true) dispatchLines.push('现在可以领取');
    }
  }
  const dispatch = dispatchLines.length > 0 ? { lines: dispatchLines, cardStatus: dispatchCard } : null;
  /* §2.8: the stop card's steps and its not-sent reason; while its card waits,
   * the task is not claimable. */
  const stopRead = asRecord(task.stop);
  const stopRequest = asRecord(stopRead.request);
  const stopLines: string[] = [];
  let stopCard = '';
  if (Object.keys(stopRequest).length > 0) {
    const who = requesterWordOf(stopRequest.requester);
    const reason = asText(stopRequest.reason);
    stopLines.push((who === '' ? '叫停请求' : '由 ' + who + ' 请求叫停') + (reason === '' ? '' : '：' + reason));
    const runId = asText(asRecord(stopRequest.stopRun).runId);
    if (runId !== '') stopLines.push('要停的运行：' + stopRunText(stopRequest.stopRun, taskRow));
  }
  const steps = (Array.isArray(stopRead.steps) ? stopRead.steps : []).map(asText).filter((step) => step !== '');
  if (steps.length > 0) {
    stopLines.push('各步：' + steps.map((step) => STOP_STEP_WORD[step] ?? '').filter((word) => word !== '').join(' → '));
  }
  const notSent = notSentWordOf(asRecord(stopRequest.outcome));
  if (notSent !== '') stopLines.push('没有发送：' + notSent);
  if (asText(stopRead.claim) === 'answer_card_first') stopCard = '先答卡、暂不领';
  const stop = stopLines.length > 0 || stopCard !== '' ? { lines: stopLines, cardStatus: stopCard } : null;
  const cardParts: string[] = [];
  if (currentHoldWords.length > 0) cardParts.push(currentHoldWords.join('；'));
  if (stopCard !== '') cardParts.push(stopCard);
  if (dispatchCard !== '') cardParts.push(dispatchCard);
  const cardStatus = cardParts.join(' · ');
  return {
    id, word, why: mapWhy !== '' ? mapWhy : detailWhy(task),
    stageName: '',
    owner: who, hasOwner: who !== '', ownerNow: true,
    files: [...groups.entries()].map(([crumb, files]) => ({ crumb, files })),
    hasFiles: groups.size > 0,
    plannedFileCount: inList.size,
    filesNote,
    filesUnknown,
    participants: lines, hasParticipants: lines.length > 0, noParticipants: lines.length === 0,
    participantsLoaded, participantsComplete,
    overlaps: risks.flatMap((page) => (Array.isArray(page.items) ? page.items : []).map((entry) => {
      const risk = asRecord(entry); const shared = asRecord(risk.shared);
      const moduleId = asText(asRecord(shared.module).moduleId);
      /* a shared file is named by its file name, as the prototype does (prototype:3400) */
      const what = shared.kind === 'module' ? (modules.find((m) => m.value.id === moduleId)?.value.name ?? '') : asText(shared.path).split('/').pop() ?? '';
      return { id: 'task:' + asText(asRecord(risk.task).taskId), text: asText(risk.title) + (what !== '' ? ' · ' + what : '') + '（没有连线）' };
    })),
    overlapsComplete: (risks[risks.length - 1]?.nextCursor ?? null) === null,
    countsComplete: counts !== null && counts.complete,
    attemptOrdinal: attempt,
    holds, holdRelease, dispatch, stop, cardStatus,
    failure: [], anchors: [],
    disposition: (disposition === 'cancelled' || disposition === 'superseded' || disposition === 'deferred') ? (() => {
      const change = asRecord(dispositionChange);
      const word = PHASE_WORD[disposition] ?? disposition;
      if (dispositionChange === null) return { word, text: word };
      const actor = ACTOR_WORD[asText(asRecord(change.actor).kind)] ?? '';
      const reason = asText(asRecord(change.reason).text);
      /* 5.10-3: the previous disposition, when it has a word (`active` has none). */
      const from = asText(change.from);
      const fromText = from !== '' && from !== 'active' ? '从 ' + (PHASE_WORD[from] ?? from) + ' ' : '';
      return { word, text: (actor !== '' ? '由 ' + actor + ' ' : '') + (changeAt !== '' ? '于计划 ' + changeAt + ' ' : '')
        + fromText + '改为 ' + (PHASE_WORD[asText(change.to)] ?? word) + (reason !== '' ? '：' + reason : '') };
    })() : null,
  };
}

/* ------------------------------------------------------------------ track */

/** One `activity/track` page as the UI sees it (narrow route value). */
export type TaskMapTrackPageRead = {
  bars: unknown[];
  next: string | null;
  from?: unknown;
  to?: unknown;
  hostRestarts?: unknown[];
  queriesIncluded?: boolean;
  /** Bars the route could not place on a line; a fact, never silently dropped. */
  unplaced?: { runs?: unknown; rounds?: unknown; gateRounds?: unknown };
};
/** One `lines/list` row's fields the track and its line card need. */
export type TaskMapTrackLineRead = {
  key: unknown; name?: { primary?: unknown; source?: unknown; extraCount?: unknown }; status?: { own?: unknown; bucket?: unknown };
  sessionCount?: unknown; pinned?: unknown; pinnedBy?: unknown; chainSessions?: unknown;
  archived?: unknown;
  lastActivityAt?: unknown;
  /** The role duty fixed at Session creation; the board groups lines by it. */
  duty?: unknown;
  /** The line's formal module and task groups; module grouping reads the module id. */
  groups?: unknown;
  /** D49-01: the Tasks the line is responsible for now; the hover lists them. */
  responsibleNow?: unknown;
};
/** One `activity/calendar` page as the UI sees it (narrow route value). */
export type TaskMapCalendarRead = {
  goalRef?: { goalId?: unknown } | null;
  from?: unknown; to?: unknown; granularity?: unknown; timeZone?: unknown;
  cells: unknown[];
  totals?: unknown;
  coverage?: unknown;
  recordingSince?: unknown;
  /** The route's own instant for "now"; the calendar has no top-level complete. */
  now?: unknown;
  /** @deprecated The contract has no top-level `complete`; kept only so an old
   * caller can still pass its reply. Never read for completeness. */
  complete?: unknown;
  /** The split windows this page was assembled from (design §3). */
  windows?: unknown[];
  scope?: unknown;
};
export type TaskMapCalendarTask = { taskId: string; goalId: string | null };
export type TaskMapCalendarHour = {
  /** Identity: local date + local hour + the real bucket start/end (DST-safe). */
  key: string; localDate: string; localHour: number;
  /** Civil day index of `localDate` and the bucket's real instants. */
  dayIndex: number;
  startAt: string; endAt: string;
  steps: number; edits: number; checks: number; complete: boolean; future: boolean;
  tasks: TaskMapCalendarTask[]; moreTasks: number;
  sessions: string[]; moreSessions: number;
  unknown: TaskMapUnknownCounts;
};
/** Why a cell is not complete (`ActivityCellV1`; decision 49·03): Runs and Queries still going or not counted. */
export type TaskMapUnknownCounts = { inProgressRuns: number; inProgressQueries: number; uncountedRuns: number; uncountedQueries: number };
export type TaskMapCalendarDay = {
  /** Identity: local date + the real bucket start/end. */
  key: string; localDate: string; dayIndex: number;
  startAt: string; endAt: string;
  steps: number; edits: number; checks: number; complete: boolean; future: boolean;
  tasks: TaskMapCalendarTask[]; moreTasks: number;
  sessions: string[]; moreSessions: number;
  unknown: TaskMapUnknownCounts;
  /** Only the hours the calendar returned: DST days really have 23 or 25. */
  hours: TaskMapCalendarHour[];
};
export type TaskMapCalendarData = {
  scope: 'goal' | 'workspace';
  from: string; to: string; timeZone: string;
  /** The granularity of the read the data came from (day for the long range,
   * hour for a short window or a drilled day); day and hour buckets are kept
   * apart and their totals never added. */
  granularity: 'day' | 'hour';
  days: TaskMapCalendarDay[]; hours: TaskMapCalendarHour[];
  totals: { steps: number; edits: number; checks: number; complete: boolean };
  windows: Array<{ granularity: 'hour' | 'day'; from: string; to: string; complete: boolean }>;
  /** The route's coverage facts (unplaced/unrecorded), never flattened to 0. */
  coverage: unknown;
  recordingSince: string;
  now: string; nowMinute: number;
  complete: boolean;
  summary: string;
  /** D49-03: why records were not counted, worded, from every page's coverage; ''. */
  uncountedWhy: string;
  /** D49-03: some page has records not yet backfilled. */
  canBackfill: boolean;
};
export type TaskMapHistoryLine = {
  taskId: string; segments: Array<{ from: string | null; to: string | null; state: string; word: string }>;
};
export type TaskMapTimeBar = {
  id: string; kind: 'run' | 'check' | 'query'; startAt: string; endAt: string | null;
  /** The same instants at the adapter fact boundary (design §4). */
  startMinute: number; endMinute: number | null;
  result: string; word: string; taskId: string; ordinal: number | null; via: string;
  /** A Run's crash error or cancel reason as the Host wrote it (`TrackRunBarV1.reason`),
   * shown verbatim and cut by the layout; '' for a check or a query. */
  reason: string;
  /** The bar's own Session as a `project/session` key; '' when the bar carries none. */
  sessionRef: string;
  /** The formal predecessor on the same line, for the link under the bars. */
  previousId: string;
  /** The real pauses with their intervals and intents; never a fabricated count. */
  pauses: Array<{ from: string; to: string | null; intentRef: unknown }>;
  /** A Run's attempt facts; a check/query bar has none. */
  attempt: { via: string;
    /** The Host's attempt ordinal (every requeue counts, a wait continuation does not); null when absent. */
    ordinal: number | null;
    requeue: { actorClass: string; automaticCount: number | null; reason: string;
    /** The class word parsed from an automatic `auto-rework:<class>#<n>` reason; '' otherwise. */
    classWord: string;
    /** Where the requeue came from (TaskRequeue facts): its failure class, a GOAL-29 resume, when it was asked and,
     * for an interruption, whether the Run was paused or executing; '' / false / '' / null when absent. */
    failureClass: string; goalResume: boolean; requestedAt: string; interruption: 'executing' | 'paused' | null } | null } | null;
  /** A check's real ordinal and the number of checks begun; no cursor-completed count. */
  checksBegun: number | null;
  /** Run/Query activity totals; a check bar has only its begun count. */
  activity: { steps: number; edits: number;
    changedFiles: { definite: number; possible: number; possiblyIncomplete: boolean } | null } | null;
  /** Only facts the bar itself carries: a stop result or an incomplete check. */
  marks: string[];
};
export type TaskMapTimeLine = {
  id: string; projectId: string; workspaceId: string; sessionId: string;
  name: string; status: string; word: string;
  /** The Session's fixed platform duty from `lines/list`. */
  role: string;
  /** The line's formal groups exactly as `lines/list` carries them; the board
   * reads the prototype's `groups.task.taskId` and `groups.module.moduleId`. */
  groups: { task: { taskId: string } | null; module: { moduleId: string } | null };
  sessionCount: string; countPartial: boolean; pinned: boolean; pinnedBy: string[];
  /** `chainSessions` as `project/session` keys, the line head first (at most 33). */
  chainSessions: string[];
  /** The earliest activity of this line inside this window; not its creation. */
  startAt: string; bars: TaskMapTimeBar[];
  /** `lines/read` chain entries (with provenance) and its omitted count; absent
   * until the line's chain was read. */
  chain: unknown[]; omitted: unknown; lineRead: boolean;
  /** An archived line, merged before the bar index when the list expands. */
  archived: boolean;
  /** `lines/list` `lastActivityAt`: a line older than today opens in 全部. */
  lastActivityAt: string | null;
  /** D49-01: the responsible Tasks' titles, when the name counts more than one. */
  tasksText: string;
};
export type TaskMapTimeData = {
  window: { from: string; to: string; fromMinute: number; toMinute: number } | null;
  rows: TaskMapTimeLine[];
  hostRestarts: Array<{ at: string; approximate: true }>;
  queriesIncluded: boolean;
  history: TaskMapHistoryLine[];
  /** One half-open lookup for the board's replay, from the adapter's single
   * `taskMapStatesAt`; absent until a timeline page was read. */
  historyAt?: (at: string) => ReadonlyMap<string, TaskMapHistoricalState>;
  /** The real calendar (design §3/§5); absent until the track/calendar opens. */
  calendar: TaskMapCalendarData | null;
  /** False while any track/Query page is still unread (final cursor). */
  complete: boolean;
  /** The route's own count of bars it could not place. */
  unplaced: { runs: number; rounds: number; gateRounds: number };
  /** The one `now` minute every live bar and cursor uses. */
  nowMinute: number;
  executionsRead: number;
  /** `lines/list.counts.archived`: exact / partial / unavailable, never a 0. */
  archivedCount: { text: string; complete: boolean; known: boolean };
  /** `lines/list.counts.working` in the prototype goal-bar words; absent is hidden. */
  workingCount: { text: string; complete: boolean; known: boolean };
};

/* The archived line total is a LineCount: exact, at least n, or unavailable.
   The board shows the text and never turns an incomplete count into 0. */
function archivedCountOf(value: unknown): { text: string; complete: boolean; known: boolean } {
  const count = asRecord(value);
  if (count.status === 'exact' && typeof count.value === 'number') {
    return { text: String(count.value), complete: true, known: true };
  }
  if (count.status === 'partial' && typeof count.atLeast === 'number') {
    return { text: '至少 ' + String(count.atLeast), complete: false, known: true };
  }
  return { text: '', complete: false, known: false };
}

/* The goal bar's own sentence (prototype `wlGoalBar`): the working line count,
   or "没有工作线在工作" for a complete zero. A partial count says 至少; an
   unavailable count is hidden, never rendered as zero. */
function workingCountOf(value: unknown): { text: string; complete: boolean; known: boolean } {
  const count = asRecord(value);
  if (count.status === 'exact' && typeof count.value === 'number') {
    return { text: count.value > 0 ? String(count.value) + ' 条工作线工作中' : '没有工作线在工作',
      complete: true, known: true };
  }
  if (count.status === 'partial' && typeof count.atLeast === 'number') {
    return { text: '至少 ' + String(count.atLeast) + ' 条工作线工作中', complete: false, known: true };
  }
  return { text: '', complete: false, known: false };
}

function civilDayIndex(localDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (match === null) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000;
}

function calendarTasksOf(cell: Record<string, unknown>): TaskMapCalendarTask[] {
  return (Array.isArray(cell.tasks) ? cell.tasks : []).map((task) => {
    const row = asRecord(task);
    return { taskId: asText(row.taskId), goalId: asText(row.goalId) || null };
  }).filter((task) => task.taskId !== '');
}

function calendarSessionsOf(cell: Record<string, unknown>): string[] {
  return (Array.isArray(cell.sessions) ? cell.sessions : []).map(trackSessionKeyOf).filter((key) => key !== '//');
}

/* A Run is counted in every cell it touches (activity-read-model.ts:369-383), so counts are not added across
 * cells: one cell with counts gives its own, two or more give none, and the page writes 未知 alone. */
function unknownCountsOf(cells: Array<Record<string, unknown>>): TaskMapUnknownCounts {
  const num = (cell: Record<string, unknown>, key: string): number => (typeof cell[key] === 'number' ? cell[key] as number : 0);
  const keys = ['inProgressRuns', 'inProgressQueries', 'uncountedRuns', 'uncountedQueries'];
  const has = cells.filter((cell) => keys.some((key) => num(cell, key) > 0));
  const one = has.length === 1 ? has[0]! : {};
  return { inProgressRuns: num(one, 'inProgressRuns'), inProgressQueries: num(one, 'inProgressQueries'), uncountedRuns: num(one, 'uncountedRuns'), uncountedQueries: num(one, 'uncountedQueries') };
}

function calendarHourOf(entry: unknown): TaskMapCalendarHour | null {
  const cell = asRecord(entry);
  const localDate = asText(cell.localDate);
  const startAt = asText(cell.startAt);
  const endAt = asText(cell.endAt);
  const hour = typeof cell.localHour === 'number' ? cell.localHour : null;
  if (localDate === '' || startAt === '' || endAt === '' || hour === null) return null;
  return {
    /* A repeated local hour (autumn DST) is two buckets: startAt/endAt are part
     * of the identity, never only date + hour. */
    key: localDate + '|' + String(hour).padStart(2, '0') + '|' + startAt + '|' + endAt,
    localDate, localHour: hour, dayIndex: civilDayIndex(localDate), startAt, endAt,
    steps: typeof cell.steps === 'number' ? cell.steps : 0,
    edits: typeof cell.edits === 'number' ? cell.edits : 0,
    checks: typeof cell.checks === 'number' ? cell.checks : 0,
    complete: cell.complete === true, future: cell.future === true,
    tasks: calendarTasksOf(cell), moreTasks: typeof cell.moreTasks === 'number' ? cell.moreTasks : 0,
    sessions: calendarSessionsOf(cell), moreSessions: typeof cell.moreSessions === 'number' ? cell.moreSessions : 0,
    unknown: unknownCountsOf([cell]),
  };
}

function metricText(value: number, complete: boolean, label: string): string {
  /* Ruling 5: an incomplete read never shows a full 0 for a count it did not record. */
  if (!complete && value === 0) return label + ' 未记全';
  return label + ' ' + String(value);
}

type CalendarWindowFact = { granularity: 'hour' | 'day'; from: string; to: string; complete: boolean };

function calendarWindowsOf(read: TaskMapCalendarRead): CalendarWindowFact[] {
  const totals = asRecord(read.totals);
  const complete = totals.complete === true;
  const declared = Array.isArray(read.windows) ? read.windows : [];
  if (declared.length > 0) {
    return declared.map((entry) => {
      const row = asRecord(entry);
      return {
        granularity: asText(row.granularity) === 'hour' ? 'hour' as const : 'day' as const,
        from: asText(row.from), to: asText(row.to), complete,
      };
    });
  }
  return [{
    granularity: asText(read.granularity) === 'hour' ? 'hour' as const : 'day' as const,
    from: asText(read.from), to: asText(read.to), complete,
  }];
}

/**
 * Design §3/§5 calendar projection. Day and hour identities are exactly the
 * returned `localDate/localHour/startAt/endAt`; `MM-DD HH:MM` is never parsed
 * and no 24-hour grid is assumed (a DST day has the hours the route returned).
 * Completeness comes from each window's `totals.complete`, never from a
 * top-level field the route does not have.
 */
/* D49-03: why the calendar did not count some records, in the table's order,
   deduplicated across every page. A window can count the same Run again, so
   the reasons are written without their counts. */
const UNCOUNTED_WORD: Record<string, string> = {
  kernel_unreadable: '读不了', history_read_failed: '读不了', history_damaged: '读不了',
  no_history_locator: '读不了', turn_not_found: '读不了',
  capacity: '太长，没算完', not_backfilled: '还没补算',
  not_recorded: '没有记', no_recording_epoch: '没有记',
};
const UNCOUNTED_ORDER = ['读不了', '太长，没算完', '还没补算', '没有记'];

/** D49-03: two reason texts merged in the table's order, without duplicates;
 * the drilled day's hour pages add their reasons to the year page's. */
export function mergeUncountedWhy(...texts: string[]): string {
  const seen = new Set<string>();
  for (const text of texts) {
    for (const word of text.replace(/^有的记录/, '').split('、')) if (word !== '') seen.add(word);
  }
  return countedWhyText(seen);
}

function countedWhyText(seen: ReadonlySet<string>): string {
  return seen.size === 0 ? '' : '有的记录' + UNCOUNTED_ORDER.filter((word) => seen.has(word)).join('、');
}

function uncountedFactsOf(pages: readonly TaskMapCalendarRead[]): { why: string; canBackfill: boolean } {
  const seen = new Set<string>();
  let canBackfill = false;
  for (const page of pages) {
    const coverage = asRecord(page.coverage);
    const tables = [asRecord(coverage.runsUncounted), asRecord(asRecord(coverage.queries).runsUncounted)];
    for (const table of tables) {
      for (const entry of Array.isArray(table) ? table : []) {
        const row = asRecord(entry);
        const count = typeof row.count === 'number' ? row.count : 0;
        if (count <= 0) continue;
        const reason = asText(row.reason);
        const word = UNCOUNTED_WORD[reason];
        if (word !== undefined) seen.add(word);
        if (reason === 'not_backfilled') canBackfill = true;
      }
    }
  }
  return { why: countedWhyText(seen), canBackfill };
}

export function adaptTaskMapCalendar(
  read: TaskMapCalendarRead | readonly TaskMapCalendarRead[], windows?: unknown[],
): TaskMapCalendarData {
  const reads = Array.isArray(read) ? read as readonly TaskMapCalendarRead[] : [read as TaskMapCalendarRead];
  /* One range has one granularity. If a caller still passes both, the finest
   * (hour) pages are the only ones that feed totals; day and hour buckets are
   * never added together. */
  const hasHour = reads.some((page) => asText(page.granularity) === 'hour');
  const chosen = hasHour ? reads.filter((page) => asText(page.granularity) === 'hour')
    : reads.filter((page) => asText(page.granularity) !== 'hour');
  const pages = chosen.length > 0 ? chosen : reads;
  const cellById = new Map<string, unknown>();
  const windowFacts: CalendarWindowFact[] = [];
  const seenWindow = new Set<string>();
  for (const page of pages) {
    for (const cell of Array.isArray(page.cells) ? page.cells : []) {
      const hour = calendarHourOf(cell);
      const row = asRecord(cell);
      const key = hour !== null ? hour.key
        : asText(row.localDate) + '|day|' + asText(row.startAt) + '|' + asText(row.endAt);
      if (!cellById.has(key)) cellById.set(key, cell);
    }
    for (const fact of calendarWindowsOf(page)) {
      const key = fact.granularity + '|' + fact.from + '|' + fact.to;
      if (seenWindow.has(key)) continue;
      seenWindow.add(key);
      windowFacts.push(fact);
    }
  }
  const cellEntries = [...cellById.values()];
  const hours = cellEntries.map(calendarHourOf)
    .filter((cell): cell is TaskMapCalendarHour => cell !== null)
    .sort((a, b) => a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0);
  const days: TaskMapCalendarDay[] = [];
  for (const entry of cellEntries) {
    const cell = asRecord(entry);
    const localDate = asText(cell.localDate);
    if (localDate === '' || typeof cell.localHour === 'number') continue;
    days.push({
      key: localDate + '|day|' + asText(cell.startAt) + '|' + asText(cell.endAt),
      localDate, dayIndex: civilDayIndex(localDate),
      startAt: asText(cell.startAt), endAt: asText(cell.endAt),
      steps: typeof cell.steps === 'number' ? cell.steps : 0,
      edits: typeof cell.edits === 'number' ? cell.edits : 0,
      checks: typeof cell.checks === 'number' ? cell.checks : 0,
      complete: cell.complete === true, future: cell.future === true,
      tasks: calendarTasksOf(cell), moreTasks: typeof cell.moreTasks === 'number' ? cell.moreTasks : 0,
      sessions: calendarSessionsOf(cell), moreSessions: typeof cell.moreSessions === 'number' ? cell.moreSessions : 0,
      unknown: unknownCountsOf([cell]), hours: hours.filter((hour) => hour.localDate === localDate),
    });
  }
  days.sort((a, b) => a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0);
  /* An hour-only read still names its days: the identity and range come from the
     returned hour cells, never from a synthesized 24-hour grid. */
  for (const date of [...new Set(hours.map((hour) => hour.localDate))].sort()) {
    if (days.some((day) => day.localDate === date)) continue;
    const own = hours.filter((hour) => hour.localDate === date);
    const tasks = new Map<string, TaskMapCalendarTask>();
    const sessions = new Set<string>();
    for (const hour of own) {
      for (const task of hour.tasks) tasks.set(task.goalId + '/' + task.taskId, task);
      for (const session of hour.sessions) sessions.add(session);
    }
    days.push({
      key: date + '|hours|' + own[0]!.startAt + '|' + own.at(-1)!.endAt,
      localDate: date, dayIndex: civilDayIndex(date), startAt: own[0]!.startAt, endAt: own.at(-1)!.endAt,
      steps: own.reduce((sum, hour) => sum + hour.steps, 0),
      edits: own.reduce((sum, hour) => sum + hour.edits, 0),
      checks: own.reduce((sum, hour) => sum + hour.checks, 0),
      complete: own.every((hour) => hour.complete), future: own.every((hour) => hour.future),
      tasks: [...tasks.values()], moreTasks: own.reduce((sum, hour) => sum + hour.moreTasks, 0),
      sessions: [...sessions], moreSessions: own.reduce((sum, hour) => sum + hour.moreSessions, 0),
      unknown: unknownCountsOf(own.map((hour) => hour.unknown)), hours: own,
    });
  }
  days.sort((a, b) => a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0);
  /* Totals are the chosen granularity's window totals; overlapping windows are
   * counted once, and a day window and an hour window are never summed. */
  let totals = { steps: 0, edits: 0, checks: 0 };
  for (const page of pages) {
    const pageTotals = asRecord(page.totals);
    totals = {
      steps: totals.steps + (typeof pageTotals.steps === 'number' ? pageTotals.steps : 0),
      edits: totals.edits + (typeof pageTotals.edits === 'number' ? pageTotals.edits : 0),
      checks: totals.checks + (typeof pageTotals.checks === 'number' ? pageTotals.checks : 0),
    };
  }
  const rawComplete = windowFacts.length > 0 && windowFacts.every((window) => window.complete);
  const totalsValue = { ...totals, complete: rawComplete };
  const first = pages[0] ?? reads[0];
  const scope = first?.scope === 'workspace' || (first?.goalRef === null && first?.scope !== 'goal')
    ? 'workspace' : 'goal';
  const scopeWord = scope === 'workspace' ? '整个工作区' : '本目标范围';
  const empty = cellEntries.length === 0;
  /* Ruling 5: an incomplete read is not an empty state and never claims a full
   * zero; only a complete window with no cells says there was no activity. */
  const summary = !rawComplete
    ? scopeWord + '：覆盖不完整，' + metricText(totalsValue.steps, false, '步骤') + ' · '
      + metricText(totalsValue.edits, false, '编辑') + ' · ' + metricText(totalsValue.checks, false, '检查') + ' 次'
    : empty
      ? scopeWord + '：这段时间没有活动。'
      : scopeWord + '：' + metricText(totalsValue.steps, true, '步骤') + ' · ' + metricText(totalsValue.edits, true, '编辑')
        + ' · ' + metricText(totalsValue.checks, true, '检查') + ' 次';
  const uncounted = uncountedFactsOf(pages);
  const nowIso = asText(first?.now);
  const nowMs = Date.parse(nowIso);
  const from = asText(first?.from);
  const to = asText(first?.to);
  return {
    scope, from, to, timeZone: asText(first?.timeZone),
    granularity: hasHour ? 'hour' as const : 'day' as const,
    days, hours, totals: totalsValue,
    windows: (Array.isArray(windows) ? windows : windowFacts).map((window) => {
      const row = asRecord(window);
      const fact = windowFacts.find((entry) => entry.from === asText(row.from) && entry.to === asText(row.to));
      return {
        granularity: asText(row.granularity) === 'hour' ? 'hour' as const : 'day' as const,
        from: asText(row.from), to: asText(row.to), complete: fact?.complete ?? false,
      };
    }),
    coverage: first?.coverage ?? null,
    recordingSince: asText(first?.recordingSince),
    now: nowIso, nowMinute: Number.isNaN(nowMs) ? NaN : nowMs / 60000,
    complete: rawComplete, summary, uncountedWhy: uncounted.why, canBackfill: uncounted.canBackfill,
  };
}

export const RUN_RESULT_WORD: Record<string, string> = {
  running: '执行中', completed: '已结束', failed: '失败', budget_exhausted: '预算耗尽',
  cancelled: '已取消', paused: '已暂停', interrupted: '中断', outcome_unknown: '结果未知', yielded: '已让出',
};
export const CHECK_RESULT_WORD: Record<string, string> = {
  open: '检查中', PASS: '通过', FAIL: '未通过', INCONCLUSIVE: '检查不完整',
};
/** A delivery requirement's five states: the three results are `CHECK_RESULT_WORD`'s; only pending/missing are new. */
export const REQUIREMENT_STATE_WORD: Record<string, string> = {
  pass: CHECK_RESULT_WORD.PASS!, fail: CHECK_RESULT_WORD.FAIL!, inconclusive: CHECK_RESULT_WORD.INCONCLUSIVE!,
  pending: '待检查', missing: '没有检查',
};
export function requirementWordOf(state: string): string { return REQUIREMENT_STATE_WORD[state] ?? state; }
const QUERY_RESULT_WORD: Record<string, string> = {
  running: '进行中', answered: '已回答', completed: '已回答', failed: '失败', cancelled: '已取消', unknown: '未知',
  timeout: '超时', gap: '没有正式回答', not_entered: '没有开始',
};
const stateWordOf = (state: string): string =>
  HISTORICAL_STATE[state]?.word ?? PHASE_WORD[state] ?? '未知';

/* A SessionRef is exactly { projectId, sessionId }; workspaceId is not part of
 * its identity and must never be added to a pin or a line key (the 503 came
 * from sending the extra workspaceId key). */
function trackSessionKeyOf(value: unknown): string {
  const row = asRecord(value);
  return asText(row.projectId) + '/' + asText(row.sessionId);
}
/* The complete aggregate ref: type + project + the aggregate's own ids. */
function barIdOf(bar: Record<string, unknown>): string {
  const ref = asRecord(bar.runRef ?? bar.roundRef ?? bar.queryRunRef);
  return asText(ref.aggregateType) + '/' + asText(ref.projectId) + '/' + asText(ref.sessionId)
    + '/' + asText(ref.runId) + '/' + asText(ref.roundId) + '/' + asText(ref.queryJobId);
}
function previousKeyOf(value: unknown): string {
  const ref = asRecord(value);
  return asText(ref.aggregateType) + '/' + asText(ref.projectId) + '/' + asText(ref.sessionId)
    + '/' + asText(ref.runId) + '/' + asText(ref.roundId) + '/' + asText(ref.queryJobId);
}

/**
 * Design §6 track projection. `lines` are `lines/list.rows`; `tracks` are the
 * unfiltered Work/check page plus every per-line Query page, already merged.
 * One row per `LineRowV1.key`, including the continuation Sessions; role, module
 * and Task never split a line and a read-only copy is never a continuation.
 * Bars carry only their own facts; a missing relation invents no mark.
 */
export function adaptTaskMapTime(
  tracks: readonly TaskMapTrackPageRead[], calendar: TaskMapCalendarRead | readonly TaskMapCalendarRead[] | null,
  timeline: TaskMapTimelineRead | null, lines: readonly TaskMapTrackLineRead[],
  /** The read's `now`; boot passes the same instant the page draws. */
  nowIso?: string,
  /** `lines/list.counts`; the archived total is shown as exact/at-least. */
  lineCounts?: unknown,
): TaskMapTimeData {
  const bars: Array<Record<string, unknown>> = [];
  const hostRestarts: Array<{ at: string; approximate: true }> = [];
  let queriesIncluded = false;
  let from = '';
  let to = '';
  let unplaced = { runs: 0, rounds: 0, gateRounds: 0 };
  let sawUnplaced = false;
  for (const page of tracks) {
    for (const entry of page.bars) bars.push(asRecord(entry));
    for (const entry of Array.isArray(page.hostRestarts) ? page.hostRestarts : []) {
      const at = asText(asRecord(entry).at);
      if (at !== '') hostRestarts.push({ at, approximate: true });
    }
    queriesIncluded = queriesIncluded || page.queriesIncluded === true;
    const pageFrom = asText(page.from);
    const pageTo = asText(page.to);
    if (pageFrom !== '' && (from === '' || pageFrom < from)) from = pageFrom;
    if (pageTo !== '' && (to === '' || pageTo > to)) to = pageTo;
    /* The unfiltered page's unplaced count is the real one; the Query passes
     * repeat the same bars and must not add to it. */
    if (!sawUnplaced && page.unplaced !== undefined) {
      sawUnplaced = true;
      const raw = asRecord(page.unplaced);
      unplaced = {
        runs: typeof raw.runs === 'number' ? raw.runs : 0,
        rounds: typeof raw.rounds === 'number' ? raw.rounds : 0,
        gateRounds: typeof raw.gateRounds === 'number' ? raw.gateRounds : 0,
      };
    }
  }
  /* Complete only when the last page has no cursor: an intermediate page's
   * `next` is not evidence of a missing tail (ruling 5 / design §3). */
  const complete = tracks.length > 0 && (tracks[tracks.length - 1]?.next ?? null) === null;
  const rows: TaskMapTimeLine[] = [];
  const bySession = new Map<string, TaskMapTimeLine>();
  for (const entry of lines) {
    const line = asRecord(entry);
    const key = asRecord(line.key);
    const id = trackSessionKeyOf(key);
    if (id === '/' || id === '' || bySession.has(id)) continue;
    const name = lineNameOf(line.name);
    const status = asText(asRecord(line.status).own);
    const count = asRecord(line.sessionCount);
    const countValue = typeof count.value === 'number' ? String(count.value)
      : typeof count.atLeast === 'number' ? '至少 ' + String(count.atLeast) : '';
    const chain = (Array.isArray(line.chainSessions) ? line.chainSessions : []).map(trackSessionKeyOf).filter((x) => x !== '/' && x !== '');
    const rawName = asRecord(line.name);
    const extraCount = typeof rawName.extraCount === 'number' ? rawName.extraCount : 0;
    const tasksText = extraCount > 0
      ? (Array.isArray(line.responsibleNow) ? line.responsibleNow : [])
        .map((entry) => asText(asRecord(entry).title)).filter((title) => title !== '').join('、')
      : '';
    const groupsRaw = asRecord(line.groups);
    const moduleRaw = asRecord(groupsRaw.module);
    const taskRaw = asRecord(groupsRaw.task);
    const taskGroup = asText(taskRaw.taskId);
    const moduleGroup = asText(moduleRaw.moduleId);
    const row: TaskMapTimeLine = {
      id, projectId: asText(key.projectId), workspaceId: asText(key.workspaceId),
      sessionId: asText(key.sessionId), name: name === '' ? asText(key.sessionId) : name,
      status, word: OWN_WORD[status] ?? '未知',
      role: asText(line.duty),
      groups: {
        task: taskGroup === '' ? null : { taskId: taskGroup },
        module: moduleGroup === '' ? null : { moduleId: moduleGroup },
      },
      sessionCount: countValue, chainSessions: chain,
      countPartial: count.status !== 'exact', pinned: line.pinned === true,
      pinnedBy: (Array.isArray(line.pinnedBy) ? line.pinnedBy : []).map((x) => asText(asRecord(x).sessionId)).filter((x) => x !== ''),
      startAt: '', bars: [], chain: [], omitted: null, lineRead: false,
      archived: line.archived === true || asRecord(line.status).bucket === 'archived',
      lastActivityAt: asText(line.lastActivityAt) || null,
      tasksText,
    };
    rows.push(row);
    bySession.set(id, row);
    for (const session of chain) if (!bySession.has(session)) bySession.set(session, row);
  }
  const seenBars = new Set<string>();
  const seenQueries = new Set<string>();
  const placed = new Map<string, Record<string, unknown>>();
  const STOP_RUN_RESULTS = new Set(['failed', 'budget_exhausted', 'cancelled', 'paused', 'interrupted', 'outcome_unknown', 'yielded']);
  for (const bar of bars) {
    const kind = asText(bar.kind);
    const startAt = asText(bar.startAt);
    if (startAt === '') continue;
    const barKey = kind + ':' + barIdOf(bar);
    if (seenBars.has(barKey)) continue;
    seenBars.add(barKey);
    if (kind === 'query') {
      const key = barIdOf(bar);
      if (seenQueries.has(key)) continue;
      seenQueries.add(key);
    }
    const targets: TaskMapTimeLine[] = [];
    if (kind === 'run') {
      const row = bySession.get(trackSessionKeyOf(bar.sessionRef));
      if (row) targets.push(row);
    } else if (kind === 'check') {
      const owners = Array.isArray(bar.ownerSessionRefs) ? bar.ownerSessionRefs : null;
      if (owners !== null && owners.length > 0) {
        for (const owner of owners) {
          const row = bySession.get(trackSessionKeyOf(owner));
          if (row && !targets.includes(row)) targets.push(row);
        }
      } else {
        const row = bySession.get(trackSessionKeyOf(bar.sessionRef));
        if (row) targets.push(row);
      }
    } else if (kind === 'query') {
      const asked = bar.via === 'consultation' ? bar.askedSessionRef ?? bar.sessionRef : bar.sessionRef;
      const row = bySession.get(trackSessionKeyOf(asked));
      if (row) targets.push(row);
    }
    if (targets.length === 0) continue;
    const result = asText(bar.result);
    const word = kind === 'check' ? CHECK_RESULT_WORD[result] ?? '检查'
      : kind === 'query' ? QUERY_RESULT_WORD[result] ?? '对话'
      : RUN_RESULT_WORD[result] ?? '执行';
    const key = barIdOf(bar);
    const id = kind + ':' + key;
    const pauses = (Array.isArray(bar.pauses) ? bar.pauses : []).map((entry) => {
      const pause = asRecord(entry);
      return { from: asText(pause.from), to: asText(pause.to) || null, intentRef: pause.intentRef ?? null };
    });
    const attemptRaw = kind === 'run' ? asRecord(bar.attempt) : {};
    const requeueRaw = asRecord(attemptRaw.requeue);
    const attemptVia = asText(attemptRaw.via);
    const interruption = requeueRaw.interruption;
    const attempt: TaskMapTimeBar['attempt'] = kind === 'run' && attemptVia !== '' ? {
      via: attemptVia,
      ordinal: typeof attemptRaw.ordinal === 'number' ? attemptRaw.ordinal : null,
      requeue: Object.keys(requeueRaw).length === 0 ? null : {
        actorClass: asText(requeueRaw.actorClass),
        automaticCount: typeof requeueRaw.automaticCount === 'number' ? requeueRaw.automaticCount : null,
        reason: asText(requeueRaw.reason),
        classWord: FAILURE_CLASS_WORD[/^auto-rework:([a-z_]+)#\d+$/.exec(asText(requeueRaw.reason))?.[1] ?? ''] ?? '',
        failureClass: asText(requeueRaw.failureClass),
        goalResume: requeueRaw.goalResume === true,
        requestedAt: asText(requeueRaw.requestedAt),
        interruption: interruption === 'executing' || interruption === 'paused' ? interruption : null,
      },
    } : null;
    const marks: string[] = [];
    if (kind === 'run') {
      /* A completed Run is a normal end, not a stop; only a stop result is a mark. */
      if (STOP_RUN_RESULTS.has(result)) marks.push(word);
      if (pauses.length > 0) marks.push('暂停 ' + String(pauses.length));
    } else if (kind === 'check' && result === 'INCONCLUSIVE') marks.push('检查不完整');
    else if (kind === 'query' && ['failed', 'cancelled', 'unknown'].indexOf(result) >= 0) marks.push(word);
    const previousKey = previousKeyOf(bar.previous);
    const startMs = Date.parse(startAt);
    const endAt = asText(bar.endAt) || null;
    const endMs = endAt === null ? NaN : Date.parse(endAt);
    for (const row of targets) {
      const projected: TaskMapTimeBar = {
        id, kind: kind === 'check' ? 'check' : kind === 'query' ? 'query' : 'run',
        startAt, endAt, result, word,
        startMinute: Number.isNaN(startMs) ? 0 : startMs / 60000,
        endMinute: endAt === null || Number.isNaN(endMs) ? null : endMs / 60000,
        taskId: asText(bar.taskId),
        /* A check's round ordinal; a Run's attempt ordinal is the Host's, in `attempt`. */
        ordinal: kind === 'check' && typeof bar.ordinal === 'number' ? bar.ordinal : null,
        checksBegun: kind === 'check' && typeof bar.checksBegun === 'number' ? bar.checksBegun : null,
        via: asText(bar.via), reason: kind === 'run' ? asText(bar.reason) : '', previousId: previousKey,
        sessionRef: trackSessionKeyOf(bar.sessionRef) === '/' ? '' : trackSessionKeyOf(bar.sessionRef),
        pauses, attempt, marks,
        activity: kind === 'check' ? null : (() => {
          const activity = asRecord(bar.activity);
          const totals = asRecord(activity.totals);
          if (typeof totals.steps !== 'number') return null;
          const changed = asRecord(activity.changedFiles);
          return {
            steps: totals.steps,
            edits: typeof totals.edits === 'number' ? totals.edits : 0,
            /* The real file count the now column shows; `definite` only, with
               `possiblyIncomplete` becoming 至少 in the board. */
            changedFiles: typeof changed.definite === 'number' ? {
              definite: changed.definite,
              possible: typeof changed.possible === 'number' ? changed.possible : 0,
              possiblyIncomplete: changed.possiblyIncomplete === true,
            } : null,
          };
        })(),
      };
      row.bars.push(projected);
      placed.set(id, bar);
    }
  }
  /* A link needs both ends on the same line; no formal relation makes no link. */
  for (const row of rows) {
    const ids = new Set(row.bars.map((bar) => bar.id.replace(/^[a-z]+:/, '')));
    row.bars.forEach((bar) => { if (!ids.has(bar.previousId)) bar.previousId = ''; });
    row.bars.sort((a, b) => a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0);
    const first = row.bars[0]?.startAt ?? from;
    row.startAt = first;
  }
  rows.sort((a, b) => (Number(b.pinned) - Number(a.pinned))
    || (a.bars.at(-1)?.startAt ?? '').localeCompare(b.bars.at(-1)?.startAt ?? ''));
  const history: TaskMapHistoryLine[] = (timeline?.tasks ?? []).map((task) => ({
    taskId: task.taskId,
    segments: task.segments.map((segment) => ({ from: segment.from, to: segment.to, state: segment.state,
      word: stateWordOf(segment.state) })),
  }));
  const calendarData = calendar === null ? null : adaptTaskMapCalendar(calendar);
  const firstCalendar = calendar === null ? null : Array.isArray(calendar) ? calendar[0] : calendar;
  const nowValue = nowIso ?? (asText(firstCalendar?.now) || new Date().toISOString());
  const nowMs = Date.parse(nowValue);
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  return {
    window: from === '' ? null : {
      from, to: to === '' ? from : to,
      fromMinute: Number.isNaN(fromMs) ? 0 : fromMs / 60000,
      toMinute: Number.isNaN(toMs) ? 0 : toMs / 60000,
    },
    rows, hostRestarts, queriesIncluded, history,
    ...(timeline === null ? {} : { historyAt: (at: string) => taskMapStatesAt(timeline, at) }),
    calendar: calendarData, complete, unplaced,
    nowMinute: Number.isNaN(nowMs) ? 0 : nowMs / 60000,
    executionsRead: placed.size,
    archivedCount: archivedCountOf(asRecord(lineCounts).archived),
    workingCount: workingCountOf(asRecord(lineCounts).working),
  };
}
