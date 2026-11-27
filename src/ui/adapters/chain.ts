/**
 * The Chain page adapter (E3 Chain §2.3): one pure conversion from the route
 * replies this page reads into `props.data`. It touches no DOM, no network and
 * no app module; the page keeps its template, theme and local state.
 *
 * The execution chain is read in the owner's page order and cut to the newest
 * ten executions (§2.4); the page never re-sorts it. The task bar's words are
 * the TaskMap tables' own (`task-map.ts`), not a second copy here.
 */
import type { ArchivedLinePageV1, LineControlV1, LineExecutionItemV1, LineRowV1, WorkLineDetailV1, WorkLineSectionPageV1 } from '../../contracts/work-line.js';
import type { RunOutcome, RunRef, TaskTriple } from '../../contracts/dispatch.js';
import type { TaskExecutionRecord } from '../../contracts/execution-read.js';
import type { SessionHistoryEntry } from '../../contracts/session-activity.js';
import type { RoundCheckIncompleteCause, VerificationRoundRef } from '../../contracts/verification.js';
import type { ContinuationBriefV1 } from '../../contracts/continuation-brief.js';
import type { RunNetworkSnapshotV1 } from '../../contracts/run-network.js';
import type { ControlIntentSnapshotV1 } from '../../contracts/control-intent.js';
import type { TaskGraph, TaskRow } from '../../contracts/task-graph.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import { asRecord, asText } from '../values.js';
import {
  ACTOR_WORD, CHECK_RESULT_WORD, FAILURE_CLASS_WORD, PHASE_WORD, RUN_RESULT_WORD, gapTextOf,
  lineNameOf, lineStatusView, localShortAt, planVersionText, requirementWordOf, taskStateOfRow, taskWhyOf,
} from './task-map.js';
import { decideTextOf, dutyWordOf, lineHref, railCardOf, wakeByOf,
  type LineKey, type NavData, type NavLine, type RailCard } from './nav.js';
import { continuationControlOf, requeueVisible, reviewOfTaskRow, type LineReview } from './line-shared.js';
import { briefRowsOf, seededNameOf } from './member.js';
import { firstLine } from './run-steps.js';
import type { MainRunSteps } from './main.js';

/** B06: the word a check row shows for the platform witness, which runs no command (never a literal "null"). */
export const WITNESS_CHECK_WORD = '平台只读核对';

/** One `verification/round` read, cut to the fields the chain shows: the
 * round itself, its checks, and the chain's own counts (§2.4). */
type RoundRead = {
  roundRef: VerificationRoundRef;
  displayStatus: 'incomplete' | 'running' | 'interrupted' | 'completed';
  outcome: string | null;
  checks: Array<{
    checkId: string; phase: string; outcome: string | null;
    /** Null for the platform witness check, which runs no command (B06). */
    incompleteCause: RoundCheckIncompleteCause | null; command: string | null; reason: string | null;
  }>;
  gaps: Array<{ code: string }>;
  chain: {
    ordinal: number;
    autoCount: number;
    /** Who opened this round and why; null on the first round. */
    reverify: {
      requestedBy: { kind: string; queryRunRef?: unknown };
      actorClass: string;
      failureClass: string;
      sourceChanged: boolean;
      exemption: string;
      reason: string | null;
    } | null;
    rounds: Array<{
      ordinal: number; roundRef: VerificationRoundRef;
      status: 'open' | 'finalized'; outcome: string | null;
      counts: { total: number; pass: number; fail: number };
    }>;
  };
  /** The public `delivery`; a reviewer requirement's `state` is its conclusion (S9). */
  delivery: {
    requirements: Array<{
      requirementId: string; kind: string; description: string; state: string;
    }>;
  };
};

/** One read page of `executions/history`; only the raw entries and the next
 * cursor are used (a non-null cursor is reported, never followed, §2.4). */
type HistoryRead = { items: SessionHistoryEntry[]; nextCursor: string | null };

/** Once read's whole input; a field is one route's value (null = not read). */
export type ChainSource = {
  nav: NavData;
  line: LineRowV1 | null;
  /** The whole `lines/read` answer: the banner needs `chain[0].archivedAt`. */
  detail: WorkLineDetailV1 | null;
  archive: ArchivedLinePageV1 | null;
  executions: Extract<WorkLineSectionPageV1, { section: 'executions' }> | null;
  runs: TaskExecutionRecord[];
  histories: Record<string, HistoryRead>;
  briefs: Record<string, { brief: ContinuationBriefV1; digest: string } | null>;
  rounds: Record<string, RoundRead[]>;
  tasks: unknown | null;
  goalWaiting: number | null;
  /** 121-146/U4：这个目标的数是不是“至少”（有卡的来源暂时读不到）。 */
  goalWaitingPartial: boolean;
  controls: Record<string, ControlIntentSnapshotV1>;
  /** A2/A4: each drawn Run's steps and positions, from the one steps read. */
  runStepsByRun: ReadonlyMap<string, MainRunSteps>;
  /** A7: each Run's network record; `null` when that read failed. */
  hosts: Record<string, RunNetworkSnapshotV1 | null>;
  /** A5: the body of the trace record the page asked to open, if any. */
  recordBody: { recordId: string; text: string } | { recordId: string; error: true } | null;
};

export type ChainData = {
  goal: { id: string; objective: string; ordinal: number | null } | null;
  goals: ChainGoal[];
  inbox: { decideText: string; noticeText: string };
  goalWaiting: number | null;
  /** The page's own line (URL lineKey or the first default) and its rail name;
   * L1 goes back to it, L2 links the shown line to Member. */
  ownKey: SessionRef | null;
  ownName: string;
  rail: ChainRail;
  line: ChainLine | null;
  task: ChainTask | null;
  attempts: ChainAttempt[];
  trace: ChainTraceRecord[];
  bar: ChainBar;
  /** A6: the archive banner's whole sentence (empty without an archive). */
  archivedText: string;
  /** A5: the selected trace record's opened body; null when none is wanted. */
  recordBody: { recordId: string; text: string } | { recordId: string; error: true } | null;
  /** A4: at least one drawn Run still has an unread step page. */
  stepsIncomplete: boolean;
};

export type ChainGoal = {
  id: string; ordinal: number | null; objective: string; order: number;
  name: string; sub: string; hasSub: boolean;
  n: string; hasN: boolean;
  st: string; word: string; future: boolean; on: boolean;
  cls: string; sq: string;
};

export type ChainAttempt = {
  ordinal: number;
  runRef: RunRef;
  statusWord: string;
  outcomeWord: string | null;
  startedAt: string | null;
  endedAt: string | null;
  requeue: { number: number; automatic: boolean; autoCount: number; cap: number | null } | null;
  /** The continuation brief's ruled facts, or null without a brief. */
  brief: { rows: Array<{ k: string; v: string }> } | null;
  /** A1: this Run's step projection; null when its workspace was unreadable. */
  steps: MainRunSteps | null;
  /** A1/A2: the projection as the board's `stepV` draws it, raw-record link included. */
  stepRows: ChainStepRow[];
  /** A6: the plan this attempt was claimed under, plus a newer current one when so. */
  plan: string;
  /** A7: the hosts this Run's commands reached; empty when not read or none. */
  hosts: string;
  rounds: ChainRound[];
};

export type ChainRound = {
  ref: VerificationRoundRef;
  ordinal: number;
  statusWord: string;
  total: number;
  pass: number;
  fail: number;
  /** A10: the next round's ordinal when a later round replaced this one. */
  supersededBy: number | null;
  /** A10: the round's gaps in the page's words; empty when none. */
  gapText: string;
  /** A10: the reverify facts of this round; empty on the first round. */
  reverifyText: string;
  checks: ChainCheck[];
};
export type ChainCheck = {
  checkId: string; command: string; outcomeWord: string;
  fail: boolean; reason: string | null;
  /** A check that did not reach PASS or FAIL: listed apart and never counted as passing (A10). */
  incomplete: boolean;
  /** A reviewer requirement's conclusion: shown even when it passes (S9). */
  review: boolean;
};

export type ChainTraceRecord = {
  attemptOrdinal: number;
  runId: string;
  /** The Kernel position; a drawn step with the same position is this row. */
  position: number;
  recordId: string; recordedAt: string; kind: string;
  /** A4: the step this row starts, or null when it is not a drawn step. */
  stepKind: 'think' | 'tool' | 'message' | null;
  /** A4: the step's verb · object, else the record kind's word. */
  summary: string;
  bodyKind: 'artifact' | 'json' | 'empty';
  bodyText: string;
};

export type ChainRail = {
  head: string;
  rows: ChainRailRow[];
  archived: ChainRailRow[];
  counts: { working: number; standby: number; archived: number };
  archName: string; archSub: string;
};
export type ChainRailRow = {
  key: SessionRef; name: string; duty: string;
  /** The Goal this line serves (`LineNameV1.goalRef`); empty for the main row. */
  goalId: string;
  st: string; word: string; railWord: string; dot: string;
  task: string | null; chainSessions: SessionRef[];
  pinned: boolean; current: boolean;
  card: RailCard;
};
export type ChainLine = {
  key: SessionRef; name: string;
  chainSessions: SessionRef[];
  controls: LineControlV1[];
  pageMemberHref: string;
  /** A6: the archive tag and the head Session's archive instant. */
  archived: { tag: 'done' | 'retired' | 'plain'; at: string | null } | null;
};
export type ChainTask = {
  id: string; title: string;
  /** The Task's whole triple: the continuation control is matched by it. */
  ref: TaskTriple;
  phase: string; phaseWord: string; phaseWhy: string;
  attemptOrdinal: number | null;
  rework: { autoCount: number; cap: number | null } | null;
  failureClassWord: string | null;
};
export type ChainBar = {
  /** A task is shown: the bar exists only with a `TaskRow` (§2.12). */
  show: boolean;
  sq: string; word: string; why: string;
  reworkText: string;
  canPause: boolean; canResume: boolean; canCancel: boolean; canRequeue: boolean;
  /** A9: the line Task's review; the board reads its two booleans. */
  review: LineReview | null;
  tip: { pause: string; resume: string; cancel: string };
  confirmText: string;
};

/** The page state the conversion needs: the selected line marks the current
 * rail row; density and theme stay the page's. */
export type ChainUi = { selected: SessionRef | null; ownKey: SessionRef | null; dens: string; theme: 'dark' | 'light' };

const RUN_STATUS_WORD: Record<string, string> = { starting: '启动中', running: '执行中', ended: '已结束' };

function countOfCount(value: unknown): number {
  const row = asRecord(value);
  if (row.status === 'exact' && typeof row.value === 'number') return row.value;
  if (row.status === 'partial' && typeof row.atLeast === 'number') return row.atLeast;
  return 0;
}

function sameSessionRef(a: SessionRef | null, b: SessionRef): boolean {
  return a !== null && a.projectId === b.projectId && a.sessionId === b.sessionId;
}

function sameRound(a: VerificationRoundRef, b: VerificationRoundRef): boolean {
  return a.projectId === b.projectId && a.goalId === b.goalId
    && a.taskId === b.taskId && a.roundId === b.roundId;
}

function lineControlOf(controls: LineControlV1[], kind: LineControlV1['kind']): LineControlV1 | null {
  return controls.find((control) => control.kind === kind) ?? null;
}

function controlAvailable(controls: LineControlV1[], kind: LineControlV1['kind']): boolean {
  return lineControlOf(controls, kind)?.availability === 'available';
}

function chainTaskRowOf(graph: TaskGraph | null, task: { projectId: string; goalId: string; taskId: string }): TaskRow | null {
  if (graph === null) return null;
  return graph.tasks.find((row) => row.ref.projectId === task.projectId
    && row.ref.goalId === task.goalId && row.ref.taskId === task.taskId) ?? null;
}

/** The task state the bar and its square use; `taskState` is the TaskMap
 * table's own, with the automation stop read from the failure facts (§2.7). */
function chainTaskStateOf(row: TaskRow): string | null {
  return taskStateOfRow(row);
}

function taskOf(graph: TaskGraph | null, task: TaskRow['ref'] | null): ChainTask | null {
  const row = task === null ? null : chainTaskRowOf(graph, task);
  if (row === null) return null;
  const state = chainTaskStateOf(row);
  const failure = row.failure ?? null;
  const why = state === null ? '' : taskWhyOf(row as unknown as Record<string, unknown>, state);
  const classWord = failure?.failureClass == null ? null : FAILURE_CLASS_WORD[failure.failureClass] ?? null;
  return {
    id: row.ref.taskId,
    ref: row.ref,
    title: asText(asRecord(row.definition).title) || row.ref.taskId,
    phase: row.effectivePhase,
    phaseWord: state === null ? '' : PHASE_WORD[state] ?? state,
    phaseWhy: classWord === null ? why : (why === '' ? classWord : why + '，' + classWord),
    attemptOrdinal: typeof row.attemptOrdinal === 'number' ? row.attemptOrdinal : null,
    rework: failure === null ? null : {
      autoCount: failure.automation.requeueAutoCount,
      cap: typeof failure.automation.cap === 'number' ? failure.automation.cap : null,
    },
    failureClassWord: classWord,
  };
}

/** The `RoundCheckIncompleteCause` codes in the page's words (5.3-4,
 * 5.6-12); a code outside the table never reaches the page as a code. */
const INCOMPLETE_CAUSE_WORD: Record<RoundCheckIncompleteCause, string> = {
  not_started: '检查还没开始',
  source_not_matched: '源码和这一轮对不上',
  process_timed_out: '检查超时',
  process_cancelled: '检查被取消',
  process_abnormal: '检查进程异常退出',
  ticket_invalid: '检查凭据失效',
  host_restart: '主机重启',
  result_not_recorded: '检查跑完了，结果没记上',
};

/** §2.8: 通过 / 未通过 / 检查中 / 检查不完整, from the read's own outcome and
 * display status, never from opening the report. A round the platform only
 * interrupted says so, instead of sharing 检查不完整 (5.3-5). */
function roundWordOf(read: RoundRead): string {
  if (read.displayStatus === 'running') return CHECK_RESULT_WORD.open!;
  if (read.displayStatus === 'interrupted') return '检查被打断，平台会结束这一轮';
  if (read.displayStatus === 'incomplete') return CHECK_RESULT_WORD.INCONCLUSIVE!;
  return read.outcome === null ? CHECK_RESULT_WORD.INCONCLUSIVE! : CHECK_RESULT_WORD[read.outcome] ?? read.outcome;
}

function checkWordOf(check: RoundRead['checks'][number]): string {
  if (check.phase === 'pending' || check.phase === 'executing') return CHECK_RESULT_WORD.open!;
  if (check.phase === 'finished' && check.outcome === null) return CHECK_RESULT_WORD.INCONCLUSIVE!;
  return check.outcome === null ? CHECK_RESULT_WORD.INCONCLUSIVE! : CHECK_RESULT_WORD[check.outcome] ?? check.outcome;
}

/** 5.9a-3: a later round replaced this one; the next chain entry's ordinal. */
function supersededByOf(read: RoundRead): number | null {
  const index = read.chain.rounds.findIndex((entry) => sameRound(entry.roundRef, read.roundRef));
  if (index < 0 || index >= read.chain.rounds.length - 1) return null;
  return read.chain.rounds[index + 1]?.ordinal ?? null;
}

/** 5.9a-3: the reverify facts in one line; the first round has none. */
function reverifyTextOf(read: RoundRead): string {
  const fact = read.chain.reverify;
  if (fact === null) return '';
  const who = 'queryRunRef' in fact.requestedBy ? '参谋规划轮'
    : ACTOR_WORD[fact.actorClass] ?? fact.actorClass;
  const parts = [
    who + '重新检查',
    fact.failureClass === '' ? '' : '上一轮' + (FAILURE_CLASS_WORD[fact.failureClass] ?? fact.failureClass),
    fact.sourceChanged ? '源码改过' : '源码没改过',
    fact.exemption === 'host_interruption' ? '上一轮只被主机重启打断，不计入上限'
      : fact.exemption === 'not_started' ? '上一轮有检查没开始' : '',
    fact.reason === null || fact.reason === '' ? '' : '原因：' + firstLine(fact.reason),
    read.chain.autoCount > 0 ? '自动重新检查已计 ' + String(read.chain.autoCount) + ' 次' : '',
  ];
  return parts.filter((part) => part !== '').join(' · ');
}

function roundViewOf(read: RoundRead): ChainRound {
  const chainRound = read.chain.rounds.find((entry) => sameRound(entry.roundRef, read.roundRef))
    ?? read.chain.rounds.find((entry) => entry.ordinal === read.chain.ordinal) ?? null;
  return {
    ref: read.roundRef,
    ordinal: chainRound?.ordinal ?? read.chain.ordinal,
    statusWord: roundWordOf(read),
    total: chainRound?.counts.total ?? read.checks.length,
    pass: chainRound?.counts.pass ?? read.checks.filter((check) => check.outcome === 'PASS').length,
    fail: chainRound?.counts.fail ?? read.checks.filter((check) => check.outcome === 'FAIL').length,
    supersededBy: supersededByOf(read),
    gapText: gapTextOf(read.gaps.map((gap) => gap.code)),
    reverifyText: reverifyTextOf(read),
    checks: [
      ...read.checks.map((check) => ({
        // B06: the witness runs no command; the page shows what it is, never a literal "null".
        checkId: check.checkId, command: check.command ?? WITNESS_CHECK_WORD, outcomeWord: checkWordOf(check),
        fail: check.outcome === 'FAIL',
        incomplete: check.outcome !== 'PASS' && check.outcome !== 'FAIL',
        reason: check.reason ?? (check.incompleteCause === null ? null
          : INCOMPLETE_CAUSE_WORD[check.incompleteCause]),
        review: false,
      })),
      /* S9: a reviewer requirement is answered by booked review Evidence, not by a
         command check; its public conclusion is `delivery.requirements[].state`. */
      ...read.delivery.requirements.filter((requirement) => requirement.kind === 'reviewer').map((requirement) => ({
        checkId: requirement.requirementId, command: '审阅结论',
        outcomeWord: requirementWordOf(requirement.state),
        fail: requirement.state === 'fail', reason: requirement.description, incomplete: false, review: true,
      })),
    ],
  };
}

/** A4: what a record that is not any drawn step says, one word per kind. */
const RECORD_KIND_WORD: Record<string, string> = {
  session_created: '开了工作记录',
  turn_started: '开始一轮',
  agent_event: '过程记录',
  context_compacted: '压缩了上下文',
};

/** A1/A2: one projection step as the Chain board's `stepV` takes it. `int`
 *  becomes the board's `send` icon; the trace row with the step's position is
 *  its raw-record entry (`rec`), or none when that history page cut it. */
export type ChainStepRow = {
  id: string; kind: string; /** The projection's own icon, before `int→send`; A3 draws it here. */
  ic: 'think' | 'file' | 'edit' | 'cmd' | 'int';
  verb: string; obj: string; path: boolean;
  meta: string; detail: string; prose: boolean; live: boolean; liveText: string; fail: boolean;
  rec: string | null;
};

export function chainStepRowsOf(
  view: MainRunSteps, ordinal: number, runRecords: readonly ChainTraceRecord[],
): ChainStepRow[] {
  return view.steps.map((step, index) => {
    const record = runRecords.find((row) => row.position === view.positions[index]) ?? null;
    return {
      id: 's-' + String(ordinal) + '-' + String(index),
      kind: step.ic === 'int' ? 'send' : step.ic,
      ic: step.ic,
      verb: step.verb, obj: step.obj, path: step.path, meta: step.meta,
      detail: step.detail, prose: step.prose, live: step.live,
      /* A1: a long command's own “正在跑，已 N 分钟” wins over 进行中. */
      liveText: step.live ? (step.meta || '进行中') : '',
      fail: step.fail, rec: record === null ? null : record.recordId,
    };
  });
}

/** A2/A4: each step's position names the one trace row it starts, so the
 *  summary says what that step was and the filter reads its kind. A record
 *  that starts no step keeps its kind's word. */
function chainTraceOf(source: ChainSource): ChainTraceRecord[] {
  const records: ChainTraceRecord[] = [];
  const stepKinds = (runId: string): Map<number, { kind: ChainTraceRecord['stepKind']; summary: string }> => {
    const view = source.runStepsByRun.get(runId);
    const byPosition = new Map<number, { kind: ChainTraceRecord['stepKind']; summary: string }>();
    if (view === undefined) return byPosition;
    view.steps.forEach((step, index) => {
      byPosition.set(view.positions[index] ?? -1, {
        kind: step.ic === 'think' ? 'think' : step.ic === 'int' ? 'message' : 'tool',
        summary: step.obj === '' ? step.verb : step.verb + ' · ' + step.obj,
      });
    });
    return byPosition;
  };
  for (const run of source.runs) {
    const history = source.histories[run.run.ref.runId];
    if (history === undefined) continue;
    const ordinal = source.runs.indexOf(run) + 1;
    const byPosition = stepKinds(run.run.ref.runId);
    for (const entry of history.items) {
      const body = entry.body;
      const json = 'encoding' in body;
      const step = byPosition.get(entry.source.position) ?? null;
      records.push({
        attemptOrdinal: ordinal,
        runId: run.run.ref.runId,
        position: entry.source.position,
        recordId: entry.recordId,
        recordedAt: entry.recordedAt,
        kind: entry.kind,
        stepKind: step === null ? null : step.kind,
        summary: step === null ? RECORD_KIND_WORD[entry.kind] ?? '过程记录' : step.summary,
        bodyKind: json ? 'json' : 'artifact',
        bodyText: json ? body.text : body.digest,
      });
    }
  }
  return records;
}

/** A6: the archive banner, from the tag and the head Session's archive time. */
export function archivedBannerOf(archived: ChainLine['archived']): string {
  if (archived === null) return '';
  const at = archived.at === null ? '' : localShortAt(archived.at);
  const when = at === '' ? '' : '（' + at + '）';
  const archivedWhen = at === '' ? '' : '（' + at + ' 归档）';
  const rest = '只能问一问（只读）：副本从它保存的工作记录回答，不会重新打开它。';
  if (archived.tag === 'done') return '已归档：这条线的任务已做完' + archivedWhen + '。' + rest;
  if (archived.tag === 'retired') return '已归档：这条线已退役' + archivedWhen + '。' + rest;
  return '已归档' + when + '。' + rest;
}

/** A7: the hosts this Run reached, in first-seen order; a refused entry names
 *  the address it resolved to. The caller writes its own prefix. */
export function runHostsTextOf(snapshot: RunNetworkSnapshotV1): string {
  const hosts = snapshot.hosts.map((host) => host.host + ':' + String(host.port)
    + (host.verdict === 'refused' ? '（被拦，' + host.address + '）' : ''));
  return hosts.join('、') + (snapshot.omitted > 0 ? '；另有 ' + String(snapshot.omitted) + ' 个没列出' : '');
}

/** A10: the plan an attempt was claimed under; a newer current plan is a fact,
 *  not an expiry (E3 :118): the task stays as it is. */
function planTextOf(run: TaskExecutionRecord, graph: TaskGraph | null): string {
  const claimed = run.plan.planRevision;
  const current = graph?.plan.planRevision ?? null;
  return '领取时用的计划：' + planVersionText(claimed)
    + (current !== null && current > claimed
      ? '；当前是计划第 ' + String(current) + ' 版，这个任务原样保留' : '');
}

function railRowOf(line: NavLine, selected: SessionRef | null): ChainRailRow {
  return {
    key: line.key,
    name: line.name,
    duty: dutyWordOf(line.duty),
    goalId: line.goalId,
    st: line.st,
    word: line.word,
    railWord: line.railWord,
    dot: line.dot,
    task: line.task,
    chainSessions: line.chainSessions as SessionRef[],
    pinned: line.pinned,
    current: sameSessionRef(selected, line.key),
    card: railCardOf(line),
  };
}

function archivedRowOf(row: LineRowV1, selected: SessionRef | null, nav: NavData): ChainRailRow {
  const view = lineStatusView(row.status);
  /* 16a T3: the one line-name rule; a duty-only row falls back to its duty word. */
  const name = lineNameOf(row.name) || dutyWordOf(row.duty);
  const responsible = row.responsibleNow.map((entry) => entry.title);
  const wakeBy = wakeByOf(row.wokenBy, [...nav.lines, ...nav.archived]);
  return {
    key: { projectId: row.key.projectId, sessionId: row.key.sessionId },
    name,
    duty: dutyWordOf(row.duty),
    goalId: asText(asRecord(asRecord(row.name).goalRef).goalId),
    st: view.st,
    word: view.word,
    railWord: view.railWord,
    dot: view.dot,
    task: row.responsibleNow[0]?.title ?? null,
    chainSessions: row.chainSessions,
    pinned: row.pinned,
    current: sameSessionRef(selected, row.key),
    card: railCardOf({ name, st: view.st, word: view.word, why: view.why, responsibleNow: responsible,
      lastActivityAt: row.lastActivityAt, wokenBy: wakeBy }),
  };
}

/** §2.7: the bar's four buttons come only from the line's own controls, and
 * 重新入队 from the TaskRow's public failure facts. */
function barOf(task: ChainTask | null, line: ChainLine | null, row: TaskRow | null): ChainBar {
  const controls = line === null ? [] : line.controls;
  const paused = task !== null && task.phase === 'failed';
  const confirmText = paused
    ? '取消这次执行：它已停在安全点，立即生效；改动和工作记录保留，任务记为已取消，之后可以重新入队。'
    : '取消这次执行：当前命令结束后在安全点停下；改动和工作记录保留，任务记为已取消，之后可以重新入队。';
  const controlReason = (kind: LineControlV1['kind']): string => {
    const control = lineControlOf(controls, kind);
    return control === null || control.availability === 'available' ? '' : control.reason ?? '';
  };
  /* S3: a paused-interrupted Task's one way on is its `continue` control; the
     owner gives no `resume` then (slice-2C §3.10), so the same 继续 button serves
     both. The control names the bar's own Task, never another paused Task's. */
  const continuation = task === null ? null : continuationControlOf(controls, task.ref);
  return {
    show: task !== null,
    sq: 'sq z10 s-' + (task === null ? 'notyet' : task.phase === 'pending' ? 'notyet' : task.phase),
    word: task === null ? '' : task.phaseWord,
    why: task === null ? '' : task.phaseWhy,
    reworkText: task === null || task.rework === null
      ? '自动返工 —'
      : '自动返工 ' + String(task.rework.autoCount) + '/' + (task.rework.cap === null ? '—' : String(task.rework.cap)),
    canPause: controlAvailable(controls, 'pause'),
    canResume: controlAvailable(controls, 'resume') || continuation !== null,
    canCancel: controlAvailable(controls, 'cancel'),
    canRequeue: row !== null && requeueVisible(row),
    review: reviewOfTaskRow(row),
    tip: { pause: controlReason('pause'), resume: controlReason('resume'), cancel: controlReason('cancel') },
    confirmText,
  };
}

/** One attempt's continuation facts; `null` when the Run has no brief. */
function requeueOf(brief: { brief: ContinuationBriefV1 } | null): ChainAttempt['requeue'] {
  if (brief === null) return null;
  const trigger = brief.brief.trigger;
  return {
    number: trigger.requeueNumber,
    automatic: trigger.autoRework !== null,
    autoCount: trigger.autoRework?.count ?? 0,
    cap: trigger.autoRework?.cap ?? null,
  };
}

/* The UI bundle cannot value-import `renderContinuationBriefZh`: it pulls
   `fingerprint.ts`'s `node:crypto` into the browser build (E3N-2 fails). These are the
   prototype `cbrief`'s facts, read from the same `ContinuationBriefV1`. */
const BRIEF_CHECKPOINT_WORD: Record<'round_open' | 'requeue' | 'brief', string> = {
  round_open: '检查轮次开始', requeue: '重新入队', brief: '本次执行开始前',
};

/** The continuation brief's own facts: Member's four shared rows plus the
 * prototype `cbrief`'s check, change, source and rework rows. */
function chainBriefRowsOf(brief: ContinuationBriefV1, seededName: string): Array<{ k: string; v: string }> {
  const failed = brief.checks === null ? [] : brief.checks.failing;
  const self = brief.workspace.selfChanged;
  const changed = self.confirmed.concat(self.possible);
  const segments = brief.workspace.segments.map((segment) => {
    const from = brief.workspace.checkpoints[segment.from]!;
    const to = brief.workspace.checkpoints[segment.to]!;
    const verdict = segment.verdict === 'unchanged' ? '源码摘要相同'
      : segment.verdict === 'changed' ? '源码摘要变了' : '无法确定';
    return BRIEF_CHECKPOINT_WORD[from.kind] + ' → ' + BRIEF_CHECKPOINT_WORD[to.kind] + '：' + verdict;
  });
  const auto = brief.trigger.autoRework;
  const inputs = brief.acceptedInputs;
  const steers = inputs.steers.map((steer) => firstLine(steer.text.text));
  const messages = inputs.messages.map((message) => firstLine(message.excerpt.text));
  const omittedText = (count: number): string => count > 0 ? '；另有 ' + String(count) + ' 条' : '';
  const rows = [
    ...briefRowsOf(brief, seededName),
    { k: '失败的检查', v: failed.length === 0 ? '没有' : failed.map((check) => check.checkId
      + '：' + (check.outcome === null ? '没有结果' : CHECK_RESULT_WORD[check.outcome] ?? check.outcome)
      + '，阶段 ' + (PHASE_WORD[check.phase] ?? check.phase)
      + (check.reportRef === null ? '' : '，报告 sha256:' + check.reportRef.digest)).join('；') },
    { k: '已保存的改动', v: self.status === 'unavailable' ? '无法读到改动'
      : self.status === 'not_entered' ? '上一次执行没有进入，改动无法确定'
        : changed.length === 0 ? (self.status === 'known' ? '没有记录到改动' : '改动可能没列全')
          : self.confirmed.join('、')
            + (self.possible.length === 0 ? '' : (self.confirmed.length === 0 ? '可能：' : '；可能：')
              + self.possible.join('、')) },
    { k: '来源对比', v: segments.length === 0 ? '没有可比较的检查点' : segments.join('；') },
  ];
  /* 5.4-8: what reached the executor before it resumed; the two lists are empty
     when the continuation is the same Session, so no row is drawn then. */
  if (steers.length > 0 || inputs.steersOmitted > 0) {
    rows.push({ k: '接着做之前你插的话', v: steers.join('；') + omittedText(inputs.steersOmitted) });
  }
  if (messages.length > 0 || inputs.messagesOmitted > 0) {
    rows.push({ k: '接着做之前收到的消息', v: messages.join('；') + omittedText(inputs.messagesOmitted) });
  }
  rows.push({ k: '自动返工', v: auto === null ? '不是自动返工' : String(auto.count) + '/' + String(auto.cap) });
  return rows;
}

/** The whole page's data of one read. `attempts` stays in owner page order,
 * oldest first; `selected` only marks the rail's current row. */
export function adaptChain(source: ChainSource, ui: ChainUi): ChainData {
  const nav = source.nav;
  const selectedGoal = nav.selectedGoalId === null ? null
    : nav.goals.find((goal) => goal.goalId === nav.selectedGoalId) ?? null;
  const selected = ui.selected;
  const rows = nav.lines.map((line) => railRowOf(line, selected));
  const archived = (source.archive?.rows ?? []).map((row) => archivedRowOf(row, selected, nav));
  const archivedText = String(nav.archivedText);
  const parts = archivedText.split('（');
  const withoutArchivedAt = countOfCount(source.archive?.withoutArchivedAt);
  const lineGoalId = source.line === null ? nav.selectedGoalId
    : (source.line.name.goalRef?.goalId ?? nav.selectedGoalId);
  const lineName = source.line === null ? '' : lineNameOf(source.line.name) || dutyWordOf(source.line.duty);
  const archivedTag = source.detail?.row.status.archivedTag ?? null;
  const line = source.line === null ? null : {
    key: { projectId: source.line.key.projectId, sessionId: source.line.key.sessionId },
    name: lineName,
    chainSessions: source.line.chainSessions,
    controls: source.line.controls,
    pageMemberHref: lineHref('Member.dc.html', lineGoalId, {
      projectId: source.line.key.projectId, sessionId: source.line.key.sessionId,
    }),
    /* A6: the line head is `chain[0]`; its instant labels the archive banner. */
    archived: archivedTag === null ? null : {
      tag: archivedTag,
      at: source.detail?.chain[0]?.archivedAt ?? null,
    },
  };
  const ownKey = ui.ownKey;
  const ownLine = ownKey === null ? null : nav.lines.find((row) => sameSessionRef(ownKey, row.key)) ?? null;
  const lastRun = source.runs.at(-1) ?? null;
  const graph = source.tasks === null || source.tasks === undefined ? null : source.tasks as TaskGraph;
  const task = lastRun === null ? null : taskOf(graph, lastRun.run.task);
  const taskRow = lastRun === null ? null : chainTaskRowOf(graph, lastRun.run.task);
  const trace = chainTraceOf(source);
  const attempts = source.runs.map((run, index) => {
    const brief = source.briefs[run.run.ref.runId] ?? null;
    const briefRows = brief === null ? null : chainBriefRowsOf(brief.brief,
      seededNameOf(brief.brief, source.line?.chainSessions ?? [], [...nav.lines, ...nav.archived]));
    const requeue = requeueOf(brief);
    const item: LineExecutionItemV1 | null = source.executions?.items.find((entry) =>
      entry.kind === 'execution' && entry.runRef.runId === run.run.ref.runId) ?? null;
    const hostRecord = source.hosts[run.run.ref.runId] ?? null;
    const ordinal = requeue === null ? index + 1 : requeue.number + 1;
    return {
      ordinal,
      runRef: run.run.ref,
      statusWord: RUN_STATUS_WORD[run.run.status] ?? run.run.status,
      outcomeWord: run.run.outcome === null ? null : RUN_RESULT_WORD[run.run.outcome] ?? run.run.outcome,
      startedAt: run.attempt.startedAt ?? (item !== null && item.kind === 'execution' ? item.startedAt : null),
      endedAt: run.attempt.endedAt,
      requeue,
      brief: briefRows === null ? null : { rows: briefRows },
      steps: source.runStepsByRun.get(run.run.ref.runId) ?? null,
      stepRows: source.runStepsByRun.has(run.run.ref.runId)
        ? chainStepRowsOf(source.runStepsByRun.get(run.run.ref.runId)!, ordinal,
          trace.filter((row) => row.runId === run.run.ref.runId))
        : [],
      plan: planTextOf(run, graph),
      hosts: hostRecord === null || hostRecord.hosts.length === 0 ? '' : runHostsTextOf(hostRecord),
      rounds: (source.rounds[run.run.ref.runId] ?? []).map(roundViewOf),
    };
  });
  const selectedIndex = nav.goals.findIndex((goal) => goal.goalId === nav.selectedGoalId);
  const goals = nav.goals.map((goal, index) => ({
    id: goal.goalId, ordinal: goal.ordinal, objective: goal.objective, order: goal.order,
    name: goal.name, sub: goal.sub, hasSub: goal.hasSub,
    n: index === selectedIndex && source.goalWaiting !== null
      ? decideTextOf(source.goalWaiting, source.goalWaitingPartial) : '',
    hasN: index === selectedIndex && source.goalWaiting !== null,
    st: goal.st, word: goal.word, future: goal.future,
    on: goal.goalId === nav.selectedGoalId,
    cls: 'row' + (goal.goalId === nav.selectedGoalId ? ' is-on' : ' is-static'),
    sq: 'sq z10 ' + (goal.future ? 's-future' : 's-' + (goal.st === 'pending' ? 'pending' : goal.st)),
  }));
  return {
    goal: selectedGoal === null ? null
      : { id: selectedGoal.goalId, objective: selectedGoal.objective, ordinal: selectedGoal.ordinal },
    goals,
    inbox: { decideText: nav.inbox.decideText, noticeText: nav.inbox.noticeText },
    goalWaiting: source.goalWaiting,
    ownKey,
    ownName: ownLine === null ? '' : ownLine.name,
    rail: {
      head: nav.head,
      rows,
      archived,
      counts: nav.counts,
      archName: parts[0] ?? '',
      archSub: [(parts[1] ?? '').replace('）', ''),
        withoutArchivedAt > 0 ? '另有 ' + String(withoutArchivedAt) + ' 条没有归档时间' : '']
        .filter((part) => part !== '').join(' · '),
    },
    line,
    task,
    attempts,
    trace,
    bar: barOf(task, line, taskRow),
    archivedText: archivedBannerOf(line?.archived ?? null),
    recordBody: source.recordBody,
    stepsIncomplete: [...source.runStepsByRun.values()].some((view) => view.next !== null),
  };
}
