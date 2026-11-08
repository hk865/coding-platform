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

import { asRecord, asText } from '../values.js';
import { goalDisplayState, type GoalDisplayPhaseCode } from './task-map.js';

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
};

export type NavLineKey = { projectId: string; sessionId: string };

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
  chainSessions: unknown[];
  pinned: boolean;
  archived: boolean;
  /** The rail's first row is the main conversation, not a `lines/list` row. */
  synth: boolean;
};

export type NavInbox = {
  decideN: number;
  noticeN: number;
  hasDecide: boolean;
  hasNotice: boolean;
  none: boolean;
};

export type NavDisplay = { phase: string; st: string; word: string; why: string; runStops: number };

/** `WorkLineDetailV1`, kept at the JSON boundary; only `row` and `kind` are
 * read by the chrome. */
export type NavLineDetail = { kind?: unknown; row?: unknown; chain?: unknown[]; omitted?: unknown };

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
function lineView(status: unknown): { st: string; word: string; dot: string } {
  const row = asRecord(status);
  const attention = asText(asRecord(row.attention).code);
  if (attention !== '' && ATTENTION_WORD[attention] !== undefined) {
    const st = ATTENTION_ST[attention] ?? 'waiting';
    return { st, word: ATTENTION_WORD[attention]!, dot: 'dot s-' + (st === 'waiting' ? 'waiting' : 'idle') };
  }
  const own = asText(row.own);
  const st = own === 'working' || own === 'checking' || own === 'starting' ? 'doing'
    : own === 'paused' || own === 'waiting_reply' || own === 'unknown' ? 'waiting' : 'idle';
  return { st, word: OWN_WORD[own] ?? '待命', dot: 'dot s-' + (st === 'doing' ? 'running' : st === 'waiting' ? 'waiting' : 'idle') };
}

function navLineOf(entry: unknown, archived: boolean): NavLine {
  const row = asRecord(entry);
  const key = asRecord(row.key);
  const projectId = asText(key.projectId);
  const sessionId = asText(key.sessionId);
  const status = asRecord(row.status);
  const view = lineView(status);
  const task = asText(asRecord((Array.isArray(row.responsibleNow) ? row.responsibleNow : [])[0]).task);
  const nameRow = asRecord(row.name);
  const primary = asText(nameRow.primary);
  const name = nameRow.source === 'duty_only' ? DUTY_WORD[primary] ?? '未分组' : primary;
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
    chainSessions: Array.isArray(row.chainSessions) ? row.chainSessions : [],
    pinned: row.pinned === true,
    archived,
    synth: false,
  };
}

/** §2.8: `completion.snapshot.revision` when recorded; `not_recorded`, an
 * absent completion and `tasks/query` `not_found` are 0. */
function completionRevisionOf(graph: unknown): number {
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
    chainSessions: [], pinned: false, archived: false, synth: true,
  };
}

function archivedTextOf(count: number): string {
  return count === 0 ? '没有已归档的工作线' : '已归档 ' + String(count);
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
    };
  });
  const lineList = asRecord(reads.lines);
  const lines = [synthLine(), ...(Array.isArray(lineList.rows) ? lineList.rows : []).map((entry) => navLineOf(entry, false))];
  const archivedRead = asRecord(reads.archived);
  const archived = (Array.isArray(archivedRead.rows) ? archivedRead.rows : []).map((entry) => navLineOf(entry, true));
  const counts = asRecord(lineList.counts);
  const working = countValue(counts.working);
  const standby = countValue(counts.standby);
  const archivedCount = countValue(counts.archived);
  const detail = reads.detail === undefined || reads.detail === null ? null : asRecord(reads.detail) as NavLineDetail;
  return {
    goals,
    selectedGoalId,
    selectedGoalRevision: typeof displayGoal.revision === 'number' ? displayGoal.revision
      : goals.filter((goal) => goal.goalId === selectedGoalId)[0]?.revision ?? null,
    selectedDisplay: displayState === null ? null : {
      phase: displayPhase, st: displayState.st, word: displayState.word, why: '',
      runStops: Array.isArray(asRecord(selectedDisplay?.display).runStops) ? (asRecord(selectedDisplay?.display).runStops as unknown[]).length : 0,
    },
    lines,
    archived,
    archivedText: archivedTextOf(archivedCount),
    head: '工作中 ' + String(working) + ' · 待命 ' + String(standby),
    headTip: '工作中：有执行、检查、咨询或对话正在进行；待命：其余没有归档的工作线；已归档：任务已满足超过一天的执行者工作线。一条工作线是一个工作记录，加上中断后接着它的工作记录；执行者每个任务开一条',
    counts: { working, standby, archived: archivedCount },
    inbox: {
      decideN, noticeN, hasDecide: decideN > 0, hasNotice: noticeN > 0, none: decideN + noticeN === 0,
    },
    detail,
    hasGoal: selectedGoalId !== null,
    phaseRevision: reads.phase === undefined ? null : completionRevisionOf(reads.phase),
    scope,
  };
}
