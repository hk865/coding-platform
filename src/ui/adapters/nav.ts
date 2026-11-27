/**
 * The navigation adapter (E3-NAV §2.11): one pure conversion from the route
 * replies the chrome reads (`goals/list`, `lines/list`, the selected
 * `goals/display`, the inbox `decisions/queue` and, on demand, `lines/read` and
 * `lines/archived`) into the `props.data` of every board. It touches no DOM,
 * no network and no app module.
 *
 * §2.7: a Goal row's status word comes from `goals/display` when it was read;
 * a `null` list phase means "not read yet" and is never guessed as running.
 * §2.4: a line row is shown from `LineRowV1`'s own fields; the list read is not
 * a line detail and `branched` only has heads.
 */

import type { TaskGraph } from '../../contracts/task-graph.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { LineWokenByV1 } from '../../contracts/work-line.js';
import { asRecord, asText } from '../values.js';
import { decisionCardCountPartial, goalDisplayState, isFinishedGoalDisplayPhase, lineNameOf, localShortAt,
  type GoalDisplayPhaseCode, type TaskMapQueueRead } from './task-map.js';
import type { LineReadValue } from './line-shared.js';

/** The eleven line own states (`LineOwnStateV1`) in the boards' words. One
 * table, the copy `task-map.ts`'s track already uses; it is private there, so
 * the chrome keeps the same words here rather than leaking a code. */
const OWN_WORD: Record<string, string> = {
  working: '工作中', checking: '正式检查中', starting: '启动中', waiting_reply: '等回复',
  paused: '已暂停', unknown: '待核对', done: '已做完', retired: '已退役', standby: '待命',
};
const ATTENTION_WORD: Record<string, string> = {
  decide: '等你决定', failed: '停下（失败）', blocked: '停下（受阻）', unknown: '待核对',
};
const ATTENTION_ST: Record<string, string> = {
  decide: 'waiting', failed: 'idle', blocked: 'idle', unknown: 'waiting',
};
const DUTY_WORD: Record<string, string> = {
  secretary: '秘书', adviser: '参谋', scribe: '书记', reviewer: '审阅者', executor: '执行者',
};

export type NavGoalPhase = 'PLANNING' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';

/** One goal row of the rail (`GoalListRowV1` + the selected display read). */
export type NavGoal = {
  goalId: string;
  revision: number;
  ordinal: number | null;
  objective: string;
  order: number;
  /** The list's phase; `null` means this row still needs `goals/display`. */
  phase: NavGoalPhase | null;
  /** The selected row's formal display phase, when it was read. */
  displayPhase: string | null;
  st: string;
  word: string;
  name: string;
  sub: string;
  hasSub: boolean;
  n: number;
  hasN: boolean;
  tip: string;
  /** `waitForGoalRef` is set: the prototype draws this Goal's row hollow (s-future). */
  future: boolean;
};

export type LineKey = { projectId: string; sessionId: string };
export type NavLineKey = LineKey;

/** §2.8: whose input message last woke a line. `senderName` is filled from the
 * same navigation read once its rows are known; a sender Session this page has
 * no line for stays a Session reference, and a Host message has none. */
export type NavWakeBy = {
  at: string;
  senderName: string;
  senderSessionRef: SessionRef | null;
};

/** One rail line (`LineRowV1`'s chrome fields, §2.4). */
export type NavLine = {
  id: string;
  key: NavLineKey;
  name: string;
  duty: string;
  status: string;
  st: string;
  word: string;
  dot: string;
  why: string;
  recent: string;
  short: string;
  task: string | null;
  /** `LineNameV1.goalRef`'s Goal: the line serves this Goal; empty when it has none.
   * Chain uses it to pick the Goal's own line (DC3) and to say the Goal has no line. */
  goalId: string;
  /** The line's module id (`groups.module.moduleId`); empty when it has none. */
  scope: string;
  /** The kept tag of an archived line (`status.archivedTag`); empty when none. */
  archivedTag: string;
  chainSessions: unknown[];
  pinned: boolean;
  archived: boolean;
  /** The rail's first row is the main conversation, not a `lines/list` row. */
  synth: boolean;
  /** §2.5: the line's hover card's two read-only fields, filled from the same
   * `lines/list` row; no board but Chain reads them. */
  responsibleNow: string[];
  lastActivityAt: string;
  /** §2.8: the input message that last woke this line; null when the last
   * activity was not an input message (or the line has no activity record). */
  wokenBy: NavWakeBy | null;
};

export type NavInbox = {
  decideN: number;
  /** 121-146/U3：给人看的那个数；来源暂时读不到时是“至少 n”或“暂时读不到”。 */
  decideText: string;
  noticeN: number;
  /** 121-146：给人看的“请知悉”的数；队列整次没读到时是“暂时读不到”，不写 0。 */
  noticeText: string;
  hasDecide: boolean;
  hasNotice: boolean;
  none: boolean;
};

/** The Goal reference a display fact names (the same three fields every RunRef has). */
export type NavRunRefFact = { projectId: string; goalId: string; runId: string };

/** One Run's actual stop state (`GoalRunStopStateV1`) as the reason line reads it.
 * Only the fields the line words are narrowed here; the code never crosses the
 * adapter boundary. */
export type NavStopStateFact = {
  kind: string;
  pausedBy: string;
  outcome: string;
  reason: string;
  intentKind: string;
  status: string;
};

export type NavRunStopFact = { runRef: NavRunRefFact; stop: NavStopStateFact };

/** A Run still waiting for its resume (`GoalResumePendingRunV1`). */
export type NavResumePendingFact = { runRef: NavRunRefFact; intentKind: string; status: string };

/** This Host's failed resume re-entry (`GoalReentryFailureV1`); `reason` is English
 * and never drawn. */
export type NavReentryFailureFact = { runRef: NavRunRefFact; reason: string };

/** The cancelled Goal a copy continues from, with its rail number and objective. */
export type NavContinuationFact = { goalId: string; ordinal: number | null; name: string };

/** One `GoalDisplayCauseV1` row, kept at the JSON edge; `main.ts` owns the words. */
export type NavCauseFact = Record<string, unknown>;

/**
 * The selected `goals/display` facts the Goal bar and the line view need: the
 * causes, each Run's actual stop, the resume waits, the re-entry failures, the
 * copy's source and the live set. Declared here, never imported from `src/core`.
 */
export type NavGoalFacts = {
  cause: NavCauseFact | null;
  causes: NavCauseFact[];
  runStops: NavRunStopFact[];
  liveRuns: NavRunRefFact[];
  resumePending: NavResumePendingFact[];
  reentryFailures: NavReentryFailureFact[];
  continuedFrom: NavContinuationFact | null;
};

export type NavDisplay = {
  phase: string; st: string; word: string; why: string; facts: NavGoalFacts;
};

/** §10: the selected line read's value, shared with Chain; the chrome reads
 * `row` and `kind`, Member reads the whole line. */
export type NavLineDetail = LineReadValue;

export type NavData = {
  goals: NavGoal[];
  selectedGoalId: string | null;
  selectedGoalRevision: number | null;
  selectedDisplay: NavDisplay | null;
  lines: NavLine[];
  archived: NavLine[];
  archivedText: string;
  head: string;
  headTip: string;
  counts: { working: number; standby: number; archived: number };
  inbox: NavInbox;
  /** The selected line's `lines/read`, read only while a line is open. */
  detail: NavLineDetail | null;
  /** The selected Goal's `tasks/query`, or `null` for no adopted Plan / no Goal. */
  tasks: TaskGraph | null;
  hasGoal: boolean;
  /** The selected Goal's GoalPhase revision (`tasks/query` completion), or
   * `null` when no Goal is selected. */
  phaseRevision: number | null;
  scope: { projectId: string; workspaceId: string } | null;
};

export type NavReads = {
  goals: unknown;
  lines: unknown;
  display?: unknown;
  queue?: unknown;
  archived?: unknown;
  detail?: unknown;
  phase?: unknown;
  tasks?: unknown;
};

function countValue(count: unknown): number {
  const row = asRecord(count);
  if (row.status === 'exact' && typeof row.value === 'number') return row.value;
  if (row.status === 'partial' && typeof row.atLeast === 'number') return row.atLeast;
  return 0;
}

/** §2.4: the word is the line's own state, or the most urgent attention when
 * there is one; `unavailable` controls stay with their guard reason and are
 * not drawn as `not_yet`. */
export function lineStatusView(status: unknown): { st: string; word: string; dot: string } {
  const row = asRecord(status);
  const attention = asText(asRecord(row.attention).code);
  const own = asText(row.own);
  /* A waiting line's own word is the member state word (等回复); the decide
     attention stays in the queue instead of replacing it (`tests/ui/E3M-8-waits.test.ts` P11-3; UI-WORKBENCH §5). */
  if (own === 'waiting_reply' && attention === 'decide') {
    return { st: 'waiting', word: OWN_WORD.waiting_reply!, dot: 'dot s-waiting' };
  }
  if (attention !== '' && ATTENTION_WORD[attention] !== undefined) {
    const st = ATTENTION_ST[attention] ?? 'waiting';
    return { st, word: ATTENTION_WORD[attention]!, dot: 'dot s-' + (st === 'waiting' ? 'waiting' : 'idle') };
  }
  const st = own === 'working' || own === 'checking' || own === 'starting' ? 'doing'
    : own === 'paused' || own === 'waiting_reply' || own === 'unknown' ? 'waiting' : 'idle';
  return { st, word: OWN_WORD[own] ?? '待命', dot: 'dot s-' + (st === 'doing' ? 'running' : st === 'waiting' ? 'waiting' : 'idle') };
}

/** The five duties' Chinese words (`PlatformDutyV1`); `unknown`/unknown is the
 * board's 未分组, never the raw code. */
export function dutyWordOf(duty: unknown): string {
  return DUTY_WORD[asText(duty)] ?? '未分组';
}

const WAKE_SENDER_KINDS = new Set(['work_run', 'query_run', 'secretary_round', 'host']);

/** The JSON edge's SessionRef for the shared session → line-name lookup; a ref
 * without both ids has no identity. */
export function sessionRefAtEdge(value: unknown): SessionRef | null {
  const row = asRecord(value);
  const projectId = asText(row.projectId);
  const sessionId = asText(row.sessionId);
  return projectId === '' || sessionId === '' ? null : { projectId, sessionId };
}

/** §2.8: the read's wake fact, never the removed message `intent`; a Host
 * message carries no sender Session and an unreadable fact is not guessed. */
function navWakeByOf(value: unknown): NavWakeBy | null {
  const row = asRecord(value);
  const at = asText(row.at);
  const kind = asText(row.senderKind);
  if (at === '' || !WAKE_SENDER_KINDS.has(kind)) return null;
  const senderSessionRef = sessionRefAtEdge(row.senderSessionRef);
  if (kind !== 'host' && senderSessionRef === null) return null;
  return { at, senderName: '', senderSessionRef };
}

/** §2.8: a sender Session's line name from the same navigation read; empty
 * when this page has no line for it. A name is never guessed from a duty. */
export function lineNameOfSession(lines: readonly NavLine[], ref: SessionRef | null): string {
  if (ref === null) return '';
  return lines.find((line) => line.key.projectId === ref.projectId
    && line.key.sessionId === ref.sessionId)?.name ?? '';
}

/** The line-card fields both pages draw: the name, its state word, who is
 * responsible now, the last activity instant and the message that woke it. */
export type RailCardLine = Pick<NavLine, 'name' | 'word' | 'responsibleNow' | 'lastActivityAt' | 'wokenBy'>;

/** One line card: the head words and its rows; Member adds `建它的` through
 * `extra`, after the four shared rows. */
export type RailCard = { name: string; word: string; rows: Array<{ k: string; v: string }> };

/** §2.8: who last woke the line, named from the same page's lines; a sender
 * Session this page cannot name stays a Session reference, and a Host message
 * has no Session. The message's removed `intent` is never read. */
export function wakeByOf(wake: LineWokenByV1 | null, lines: readonly NavLine[]): NavWakeBy | null {
  if (wake === null || wake.at === '') return null;
  return {
    at: wake.at,
    senderName: lineNameOfSession(lines, wake.senderSessionRef),
    senderSessionRef: wake.senderSessionRef,
  };
}

/** The card's one row: the sender and the instant, never a message kind and
 * never an internal id (G3b R2); an unnamed sender still says what it is. */
export function wakeByTextOf(wake: NavWakeBy | null): string {
  if (wake === null || wake.at === '') return '没有记录';
  const sender = wake.senderSessionRef !== null
    ? wake.senderName !== '' ? '“' + wake.senderName + '”' : '一条不在列表里的工作线'
    : '你或平台';
  return '最近由' + sender + '的消息叫醒（' + localShortAt(wake.at) + '）';
}

/** Both rails' card (§2.8): 负责 · 正在做 · 最近一步 · 叫醒; a time is written
 * as the browser-local MM-DD HH:mm, never an ISO string (design §4). */
export function railCardOf(line: RailCardLine, extra: Array<{ k: string; v: string }> = []): RailCard {
  return {
    name: line.name,
    word: line.word,
    rows: [
      { k: '负责', v: line.responsibleNow.length === 0 ? '未分配' : line.responsibleNow.join('、') },
      { k: '正在做', v: line.word },
      { k: '最近一步', v: line.lastActivityAt === '' ? '没有记录' : localShortAt(line.lastActivityAt) },
      { k: '叫醒', v: wakeByTextOf(line.wokenBy) },
      ...extra,
    ],
  };
}

/** §2.8: fill each row's sender name from the same page; a sender this page
 * cannot name keeps its Session reference rather than a guessed name. */
function withWakeNames(rows: NavLine[], known: readonly NavLine[]): NavLine[] {
  return rows.map((line) => line.wokenBy === null ? line : {
    ...line,
    wokenBy: { ...line.wokenBy, senderName: lineNameOfSession(known, line.wokenBy.senderSessionRef) },
  });
}

function navLineOf(entry: unknown, archived: boolean): NavLine {
  const row = asRecord(entry);
  const key = asRecord(row.key);
  const projectId = asText(key.projectId);
  const sessionId = asText(key.sessionId);
  const status = asRecord(row.status);
  const view = lineStatusView(status);
  const task = asText(asRecord((Array.isArray(row.responsibleNow) ? row.responsibleNow : [])[0]).title);
  const nameRow = asRecord(row.name);
  const name = lineNameOf(row.name);
  return {
    id: projectId + '/' + sessionId,
    key: { projectId, sessionId },
    name,
    duty: asText(row.duty),
    status: asText(status.own),
    st: view.st,
    word: view.word,
    dot: view.dot,
    why: '',
    recent: '',
    short: task,
    task: task === '' ? null : task,
    goalId: asText(asRecord(nameRow.goalRef).goalId),
    scope: asText(asRecord(asRecord(row.groups).module).moduleId),
    archivedTag: asText(status.archivedTag),
    chainSessions: Array.isArray(row.chainSessions) ? row.chainSessions : [],
    pinned: row.pinned === true,
    archived,
    synth: false,
    responsibleNow: (Array.isArray(row.responsibleNow) ? row.responsibleNow : [])
      .map((entry) => asText(asRecord(entry).title)).filter((title) => title !== ''),
    lastActivityAt: asText(row.lastActivityAt),
    wokenBy: navWakeByOf(row.wokenBy),
  };
}

/** §2.8: `completion.snapshot.revision` when recorded; `not_recorded`, an
 * absent completion and `tasks/query` `not_found` are 0. */
export function completionRevisionOf(graph: unknown): number {
  const completion = asRecord(asRecord(graph).completion);
  if (completion.status !== 'recorded') return 0;
  const revision = asRecord(completion.snapshot).revision;
  return typeof revision === 'number' ? revision : 0;
}

/** The rail's first row is the main conversation (§2.4): it is not a
 * `lines/list` row and clicking it goes back to the main conversation. */
function synthLine(): NavLine {
  return {
    id: 'main', key: { projectId: '', sessionId: '' }, name: '秘书（主对话）', duty: 'secretary',
    status: '', st: 'idle', word: '', dot: 'dot s-idle', why: '', recent: '', short: '', task: null,
    goalId: '', scope: '', archivedTag: '',
    chainSessions: [], pinned: false, archived: false, synth: true, responsibleNow: [], lastActivityAt: '',
    wokenBy: null,
  };
}

function runRefFactOf(value: unknown): NavRunRefFact | null {
  const row = asRecord(value);
  const projectId = asText(row.projectId);
  const goalId = asText(row.goalId);
  const runId = asText(row.runId);
  return projectId === '' || goalId === '' || runId === '' ? null : { projectId, goalId, runId };
}

function stopStateFactOf(value: unknown): NavStopStateFact | null {
  const row = asRecord(value);
  const kind = asText(row.kind);
  if (kind === '') return null;
  return {
    kind, pausedBy: asText(row.pausedBy), outcome: asText(row.outcome), reason: asText(row.reason),
    intentKind: asText(row.intentKind), status: asText(row.status),
  };
}

/** §2.1 display facts at the JSON edge: the same shape the `goals/display`
 * answer carries, narrowed to what the Goal bar and the line view read. */
function goalFactsOf(
  selectedDisplay: Record<string, unknown> | null, goals: readonly NavGoal[],
): NavGoalFacts {
  const display = asRecord(selectedDisplay?.display);
  const goal = asRecord(selectedDisplay?.goal);
  const cause = asRecord(display.cause);
  const causes = (Array.isArray(display.causes) ? display.causes : []).map((entry) => asRecord(entry));
  const runStops: NavRunStopFact[] = [];
  for (const entry of Array.isArray(display.runStops) ? display.runStops : []) {
    const row = asRecord(entry);
    const runRef = runRefFactOf(row.runRef);
    const stop = stopStateFactOf(row.stop);
    if (runRef !== null && stop !== null) runStops.push({ runRef, stop });
  }
  const liveRuns = (Array.isArray(selectedDisplay?.liveRuns) ? selectedDisplay.liveRuns : [])
    .map(runRefFactOf).filter((ref): ref is NavRunRefFact => ref !== null);
  const resumePending: NavResumePendingFact[] = [];
  for (const entry of Array.isArray(selectedDisplay?.resumePending) ? selectedDisplay.resumePending : []) {
    const row = asRecord(entry);
    const runRef = runRefFactOf(row.runRef);
    if (runRef !== null) {
      resumePending.push({ runRef, intentKind: asText(row.intentKind), status: asText(row.status) });
    }
  }
  const reentryFailures: NavReentryFailureFact[] = [];
  for (const entry of Array.isArray(selectedDisplay?.reentryFailures) ? selectedDisplay.reentryFailures : []) {
    const row = asRecord(entry);
    const runRef = runRefFactOf(row.runRef);
    if (runRef !== null) reentryFailures.push({ runRef, reason: asText(row.reason) });
  }
  const continuation = asRecord(goal.continuedFrom);
  const sourceId = asText(asRecord(continuation.goal).goalId);
  const source = sourceId === '' ? null : goals.find((row) => row.goalId === sourceId) ?? null;
  return {
    cause: Object.keys(cause).length === 0 ? null : cause,
    causes,
    runStops,
    liveRuns,
    resumePending,
    reentryFailures,
    continuedFrom: sourceId === '' ? null : { goalId: sourceId, ordinal: source?.ordinal ?? null, name: source?.objective ?? '' },
  };
}

function archivedTextOf(count: number): string {
  return count === 0 ? '没有已归档的工作线' : '已归档 ' + String(count);
}

/** 121-146：读不到时给人看的字。 */
const UNREADABLE_TEXT = '暂时读不到';

/** 121-146/U3：给人看的“需要你决定”的数。`partial` 是下限（有卡的来源读不到，或队列整次没读到）时
 * 写“至少 n”，下限又是 0 时写“暂时读不到”。左栏、Plan、Chain 共用这一条。 */
export function decideTextOf(n: number, partial: boolean): string {
  return !partial ? String(n) : n > 0 ? '至少 ' + String(n) : UNREADABLE_TEXT;
}

/** The one chrome conversion of this package. `selectedGoalId` is the Goal the
 * URL/state chose; the list's rows still show that choice, and a `null` phase
 * is not a state word (§2.7). */
export function adaptNav(
  reads: NavReads, selectedGoalId: string | null,
  scope: { projectId: string; workspaceId: string } | null = null,
): NavData {
  const goalList = asRecord(reads.goals);
  const goalRows = Array.isArray(goalList.goals) ? goalList.goals : [];
  const selectedDisplay = reads.display === undefined || reads.display === null ? null : asRecord(reads.display);
  const displayGoal = asRecord(selectedDisplay?.goal);
  const displayPhase = asText(asRecord(selectedDisplay?.display).phase);
  const displayState = displayPhase === '' ? null : goalDisplayState(displayPhase as GoalDisplayPhaseCode);
  const queue = asRecord(reads.queue);
  const noticeCounts = asRecord(asRecord(queue.counts).notices);
  const noticeN = Object.keys(noticeCounts).reduce((sum, key) => sum + (typeof noticeCounts[key] === 'number' ? (noticeCounts[key] as number) : 0), 0);
  const decideN = typeof asRecord(queue.counts).waitingAnswer === 'number' ? asRecord(queue.counts).waitingAnswer as number : 0;
  /* 121-146/U3：队列读到了、但有卡的来源暂时读不到时，0 也说“暂时读不到”，不能当成没有。
     队列整次没读到（null）时 `none` 不为真；Main 按 `hasDecide`、`hasNotice` 把两行藏起来，
     其余常显左栏的画板两行都写“暂时读不到”，不写 0（lead 11-18）。 */
  const queueRead = reads.queue !== null && reads.queue !== undefined;
  const decidePartial = decisionCardCountPartial(reads.queue as TaskMapQueueRead);
  const decideText = decideTextOf(decideN, decidePartial || !queueRead);
  const noticeText = queueRead ? String(noticeN) : UNREADABLE_TEXT;
  const goals: NavGoal[] = goalRows.map((entry) => {
    const row = asRecord(entry);
    const ref = asRecord(row.ref);
    const goalId = asText(ref.goalId);
    const ordinal = typeof row.ordinal === 'number' ? row.ordinal : null;
    const phase = row.display === undefined ? null : asRecord(row.display).phase;
    const listPhase = typeof phase === 'string' ? phase as NavGoalPhase : null;
    const isSelected = goalId === selectedGoalId;
    const state = isSelected && displayState !== null ? displayState
      : listPhase === null ? null : goalDisplayState(listPhase as unknown as GoalDisplayPhaseCode);
    const objective = asText(row.objective);
    /* The row's sub-line is a setting, not a second display read: a paused or
       cancelled Goal says so; a Goal that waits for another says what it waits
       for. Nothing else invents a state. */
    const effectivePhase = isSelected && displayPhase !== '' ? displayPhase : listPhase;
    const waitFor = row.waitForGoalRef !== null && row.waitForGoalRef !== undefined;
    const sub = effectivePhase === 'PAUSED' ? '已暂停，可继续'
      : effectivePhase === 'CANCELLED' ? '已取消'
      : waitFor ? '等前面的目标完成' : '';
    return {
      goalId,
      revision: typeof row.revision === 'number' ? row.revision : 0,
      ordinal,
      objective,
      order: typeof row.order === 'number' ? row.order : 0,
      phase: listPhase,
      displayPhase: isSelected && displayPhase !== '' ? displayPhase : null,
      st: state === null ? 'pending' : state.st,
      word: state === null ? '状态未读' : state.word,
      name: ordinal === null ? objective : '目标 ' + String(ordinal) + ' · ' + objective,
      sub: sub,
      hasSub: sub !== '',
      n: 0,
      hasN: false,
      tip: state === null ? objective : state.word + (objective === '' ? '' : ' · ' + objective),
      future: waitFor,
    };
  });
  const lineList = asRecord(reads.lines);
  const rawLines = [synthLine(), ...(Array.isArray(lineList.rows) ? lineList.rows : []).map((entry) => navLineOf(entry, false))];
  const lines = withWakeNames(rawLines, rawLines);
  const archivedRead = asRecord(reads.archived);
  const rawArchived = (Array.isArray(archivedRead.rows) ? archivedRead.rows : []).map((entry) => navLineOf(entry, true));
  const archived = withWakeNames(rawArchived, [...lines, ...rawArchived]);
  const counts = asRecord(lineList.counts);
  const working = countValue(counts.working);
  const standby = countValue(counts.standby);
  const archivedCount = countValue(counts.archived);
  const detail = reads.detail === undefined || reads.detail === null ? null : asRecord(reads.detail) as unknown as NavLineDetail;
  return {
    goals,
    selectedGoalId,
    selectedGoalRevision: typeof displayGoal.revision === 'number' ? displayGoal.revision
      : goals.filter((goal) => goal.goalId === selectedGoalId)[0]?.revision ?? null,
    selectedDisplay: displayState === null ? null : {
      phase: displayPhase, st: displayState.st, word: displayState.word, why: '',
      facts: goalFactsOf(selectedDisplay, goals),
    },
    lines,
    archived,
    archivedText: archivedTextOf(archivedCount),
    head: '工作中 ' + String(working) + ' · 待命 ' + String(standby),
    headTip: '工作中：有执行、检查、咨询或对话正在进行；待命：其余没有归档的工作线；已归档：任务已满足超过一天的执行者工作线。一条工作线是一个工作记录，加上中断后接着它的工作记录；执行者每个任务开一条',
    counts: { working, standby, archived: archivedCount },
    inbox: {
      decideN, decideText, noticeN, noticeText,
      hasDecide: decidePartial || decideN > 0, hasNotice: noticeN > 0,
      none: queueRead && !decidePartial && decideN + noticeN === 0,
    },
    detail,
    tasks: reads.tasks === undefined || reads.tasks === null ? null : reads.tasks as TaskGraph,
    hasGoal: selectedGoalId !== null,
    phaseRevision: reads.phase === undefined ? null : completionRevisionOf(reads.phase),
    scope,
  };
}

/** §2.9: the Goal bar's four controls, the same rule the prototype draws inline
 * (`Main.dc.html:3145-3148`): a finished Goal has none, a paused one only
 * resumes, and a cancelled one can be requeued (a copy, never a revive). */
export function goalControlsOf(display: NavDisplay | null): {
  canPause: boolean; canResume: boolean; canCancel: boolean; canRequeue: boolean;
} {
  const phase = display === null ? null : display.phase;
  const finished = phase !== null && isFinishedGoalDisplayPhase(phase as GoalDisplayPhaseCode);
  return {
    canPause: display !== null && !finished && phase !== 'PAUSED',
    canResume: phase === 'PAUSED',
    canCancel: display !== null && !finished,
    canRequeue: phase === 'CANCELLED',
  };
}

/** §2.2: a page link carries `?goal=` only when there is a Goal, encoded once,
 * and never invents a target from an empty id. */
export function goalHref(file: string, goalId: string | null): string {
  return goalId === null || goalId === '' ? file : file + '?goal=' + encodeURIComponent(goalId);
}

/** §2.2/§10: a whole-line link carries the Goal (when there is one) and the
 * line's two identity values, each encoded once; an empty key falls back to
 * the one-parameter `goalHref`. */
export function lineHref(file: string, goalId: string | null, key: LineKey): string {
  if (key.projectId === '' || key.sessionId === '') return goalHref(file, goalId);
  const query = new URLSearchParams();
  if (goalId !== null && goalId !== '') query.set('goal', goalId);
  query.set('lineProject', key.projectId);
  query.set('lineSession', key.sessionId);
  return file + '?' + query.toString();
}
