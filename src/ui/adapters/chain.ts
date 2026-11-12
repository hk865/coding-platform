/**
 * The Chain page adapter (E3 Chain §2.3): one pure conversion from the route
 * replies this page reads into `props.data`. It touches no DOM, no network and
 * no app module; the page keeps its template, theme and local state.
 *
 * The execution chain is read in the owner's page order and cut to the newest
 * ten executions (§2.4); the page never re-sorts it. The task bar's words are
 * the TaskMap tables' own (`task-map.ts`), not a second copy here.
 */
import type { ArchivedLinePageV1, LineControlV1, LineExecutionItemV1, LineRowV1, WorkLineSectionPageV1 } from '../../contracts/work-line.js';
import type { RunOutcome, RunRef } from '../../contracts/dispatch.js';
import type { TaskExecutionRecord } from '../../contracts/execution-read.js';
import type { SessionHistoryEntry } from '../../contracts/session-activity.js';
import type { VerificationRoundRef } from '../../contracts/verification.js';
import type { ContinuationBriefV1 } from '../../contracts/continuation-brief.js';
import type { ControlIntentSnapshotV1 } from '../../contracts/control-intent.js';
import type { TaskGraph, TaskRow } from '../../contracts/task-graph.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import { asRecord, asText } from '../values.js';
import {
  CHECK_RESULT_WORD, FAILURE_CLASS_WORD, PHASE_WORD, RUN_RESULT_WORD,
  taskStateOfRow, taskWhyOf,
} from './task-map.js';
import { dutyWordOf, lineHref, lineStatusView, type LineKey, type NavData, type NavLine } from './nav.js';
import { requeueVisible } from './line-shared.js';

/** One `verification/round` read, cut to the fields the chain shows: the
 * round itself, its checks, and the chain's own counts (§2.4). */
type RoundRead = {
  roundRef: VerificationRoundRef;
  displayStatus: 'incomplete' | 'running' | 'interrupted' | 'completed';
  outcome: string | null;
  checks: Array<{
    checkId: string; phase: string; outcome: string | null;
    incompleteCause: string | null; command: string; reason: string | null;
  }>;
  chain: {
    ordinal: number;
    rounds: Array<{
      ordinal: number; roundRef: VerificationRoundRef;
      status: 'open' | 'finalized'; outcome: string | null;
      counts: { total: number; pass: number; fail: number };
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
  archive: ArchivedLinePageV1 | null;
  executions: Extract<WorkLineSectionPageV1, { section: 'executions' }> | null;
  runs: TaskExecutionRecord[];
  histories: Record<string, HistoryRead>;
  briefs: Record<string, { brief: ContinuationBriefV1; digest: string } | null>;
  rounds: Record<string, RoundRead[]>;
  tasks: unknown | null;
  goalWaiting: number | null;
  controls: Record<string, ControlIntentSnapshotV1>;
};

export type ChainData = {
  goal: { id: string; objective: string; ordinal: number | null } | null;
  goals: ChainGoal[];
  inbox: { decideN: number; noticeN: number };
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
  process: 'not_connected';
  rounds: ChainRound[];
};

export type ChainRound = {
  ref: VerificationRoundRef;
  ordinal: number;
  statusWord: string;
  total: number;
  pass: number;
  fail: number;
  checks: ChainCheck[];
};
export type ChainCheck = {
  checkId: string; command: string; outcomeWord: string;
  fail: boolean; reason: string | null;
};

export type ChainTraceRecord = {
  attemptOrdinal: number;
  recordId: string; recordedAt: string; kind: string;
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
  st: string; word: string; dot: string;
  task: string | null; chainSessions: SessionRef[];
  pinned: boolean; current: boolean;
  card: { name: string; word: string; rows: Array<{ k: string; v: string }> };
};
export type ChainLine = {
  key: SessionRef; name: string;
  chainSessions: SessionRef[];
  controls: LineControlV1[];
  pageMemberHref: string;
};
export type ChainTask = {
  id: string; title: string;
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

/** §2.8: 通过 / 未通过 / 检查中 / 检查不完整, from the read's own outcome and
 * display status, never from opening the report. */
function roundWordOf(read: RoundRead): string {
  if (read.displayStatus === 'running') return CHECK_RESULT_WORD.open!;
  if (read.displayStatus === 'interrupted' || read.displayStatus === 'incomplete') return CHECK_RESULT_WORD.INCONCLUSIVE!;
  return read.outcome === null ? CHECK_RESULT_WORD.INCONCLUSIVE! : CHECK_RESULT_WORD[read.outcome] ?? read.outcome;
}

function checkWordOf(check: RoundRead['checks'][number]): string {
  if (check.phase === 'pending' || check.phase === 'executing') return CHECK_RESULT_WORD.open!;
  if (check.phase === 'finished' && check.outcome === null) return CHECK_RESULT_WORD.INCONCLUSIVE!;
  return check.outcome === null ? CHECK_RESULT_WORD.INCONCLUSIVE! : CHECK_RESULT_WORD[check.outcome] ?? check.outcome;
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
    checks: read.checks.map((check) => ({
      checkId: check.checkId, command: check.command, outcomeWord: checkWordOf(check),
      fail: check.outcome === 'FAIL', reason: check.reason ?? check.incompleteCause,
    })),
  };
}

function chainTraceOf(source: ChainSource): ChainTraceRecord[] {
  const records: ChainTraceRecord[] = [];
  for (const run of source.runs) {
    const history = source.histories[run.run.ref.runId];
    if (history === undefined) continue;
    const ordinal = source.runs.indexOf(run) + 1;
    for (const entry of history.items) {
      const body = entry.body;
      const json = 'encoding' in body;
      records.push({
        attemptOrdinal: ordinal,
        recordId: entry.recordId,
        recordedAt: entry.recordedAt,
        kind: entry.kind,
        bodyKind: json ? 'json' : 'artifact',
        bodyText: json ? body.text : body.digest,
      });
    }
  }
  return records;
}

function railCardOf(name: string, word: string, responsibleNow: string[], lastActivityAt: string): ChainRailRow['card'] {
  return {
    name,
    word,
    rows: [
      { k: '负责', v: responsibleNow.length === 0 ? '未分配' : responsibleNow.join('、') },
      { k: '正在做', v: word },
      { k: '最近一步', v: lastActivityAt === '' ? '没有记录' : lastActivityAt },
    ],
  };
}

function railRowOf(line: NavLine, selected: SessionRef | null): ChainRailRow {
  return {
    key: line.key,
    name: line.name,
    duty: dutyWordOf(line.duty),
    goalId: line.goalId,
    st: line.st,
    word: line.word,
    dot: line.dot,
    task: line.task,
    chainSessions: line.chainSessions as SessionRef[],
    pinned: line.pinned,
    current: sameSessionRef(selected, line.key),
    card: railCardOf(line.name, line.word, line.responsibleNow, line.lastActivityAt),
  };
}

function archivedRowOf(row: LineRowV1, selected: SessionRef | null): ChainRailRow {
  const view = lineStatusView(row.status);
  const nameRow = asRecord(row.name);
  const name = nameRow.source === 'duty_only' ? dutyWordOf(row.duty)
    : (asText(nameRow.primary) || dutyWordOf(row.duty));
  const responsible = row.responsibleNow.map((entry) => entry.title);
  return {
    key: { projectId: row.key.projectId, sessionId: row.key.sessionId },
    name,
    duty: dutyWordOf(row.duty),
    goalId: asText(asRecord(asRecord(row.name).goalRef).goalId),
    st: view.st,
    word: view.word,
    dot: view.dot,
    task: row.responsibleNow[0]?.title ?? null,
    chainSessions: row.chainSessions,
    pinned: row.pinned,
    current: sameSessionRef(selected, row.key),
    card: railCardOf(name, view.word, responsible, row.lastActivityAt),
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
  return {
    show: task !== null,
    sq: 'sq z10 s-' + (task === null ? 'notyet' : task.phase === 'pending' ? 'notyet' : task.phase),
    word: task === null ? '' : task.phaseWord,
    why: task === null ? '' : task.phaseWhy,
    reworkText: task === null || task.rework === null
      ? '自动返工 —'
      : '自动返工 ' + String(task.rework.autoCount) + '/' + (task.rework.cap === null ? '—' : String(task.rework.cap)),
    canPause: controlAvailable(controls, 'pause'),
    canResume: controlAvailable(controls, 'resume'),
    canCancel: controlAvailable(controls, 'cancel'),
    canRequeue: row !== null && requeueVisible(row),
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

/** The whole page's data of one read. `attempts` stays in owner page order,
 * oldest first; `selected` only marks the rail's current row. */
export function adaptChain(source: ChainSource, ui: ChainUi): ChainData {
  const nav = source.nav;
  const selectedGoal = nav.selectedGoalId === null ? null
    : nav.goals.find((goal) => goal.goalId === nav.selectedGoalId) ?? null;
  const selected = ui.selected;
  const rows = nav.lines.map((line) => railRowOf(line, selected));
  const archived = (source.archive?.rows ?? []).map((row) => archivedRowOf(row, selected));
  const archivedText = String(nav.archivedText);
  const parts = archivedText.split('（');
  const withoutArchivedAt = countOfCount(source.archive?.withoutArchivedAt);
  const lineGoalId = source.line === null ? nav.selectedGoalId
    : (source.line.name.goalRef?.goalId ?? nav.selectedGoalId);
  const lineName = source.line === null ? '' : asRecord(source.line.name).source === 'duty_only'
    ? dutyWordOf(source.line.duty) : (asText(asRecord(source.line.name).primary) || dutyWordOf(source.line.duty));
  const line = source.line === null ? null : {
    key: { projectId: source.line.key.projectId, sessionId: source.line.key.sessionId },
    name: lineName,
    chainSessions: source.line.chainSessions,
    controls: source.line.controls,
    pageMemberHref: lineHref('Member.dc.html', lineGoalId, {
      projectId: source.line.key.projectId, sessionId: source.line.key.sessionId,
    }),
  };
  const ownKey = ui.ownKey;
  const ownLine = ownKey === null ? null : nav.lines.find((row) => sameSessionRef(ownKey, row.key)) ?? null;
  const lastRun = source.runs.at(-1) ?? null;
  const graph = source.tasks === null || source.tasks === undefined ? null : source.tasks as TaskGraph;
  const task = lastRun === null ? null : taskOf(graph, lastRun.run.task);
  const taskRow = lastRun === null ? null : chainTaskRowOf(graph, lastRun.run.task);
  const attempts = source.runs.map((run, index) => {
    const brief = source.briefs[run.run.ref.runId] ?? null;
    const requeue = requeueOf(brief);
    const item: LineExecutionItemV1 | null = source.executions?.items.find((entry) =>
      entry.kind === 'execution' && entry.runRef.runId === run.run.ref.runId) ?? null;
    return {
      ordinal: requeue === null ? index + 1 : requeue.number + 1,
      runRef: run.run.ref,
      statusWord: RUN_STATUS_WORD[run.run.status] ?? run.run.status,
      outcomeWord: run.run.outcome === null ? null : RUN_RESULT_WORD[run.run.outcome] ?? run.run.outcome,
      startedAt: run.attempt.startedAt ?? (item !== null && item.kind === 'execution' ? item.startedAt : null),
      endedAt: run.attempt.endedAt,
      requeue,
      process: 'not_connected' as const,
      rounds: (source.rounds[run.run.ref.runId] ?? []).map(roundViewOf),
    };
  });
  const selectedIndex = nav.goals.findIndex((goal) => goal.goalId === nav.selectedGoalId);
  const goals = nav.goals.map((goal, index) => ({
    id: goal.goalId, ordinal: goal.ordinal, objective: goal.objective, order: goal.order,
    name: goal.name, sub: goal.sub, hasSub: goal.hasSub,
    n: index === selectedIndex && source.goalWaiting !== null ? String(source.goalWaiting) : '',
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
    inbox: { decideN: nav.inbox.decideN, noticeN: nav.inbox.noticeN },
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
    trace: chainTraceOf(source),
    bar: barOf(task, line, taskRow),
  };
}
