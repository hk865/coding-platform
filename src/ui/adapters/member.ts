/**
 * The Member page adapter (E3 Member §2.3): one pure conversion from the route
 * replies this page reads into `props.data`. It touches no DOM, no network and
 * no app module; the page keeps its layout, theme and drafts.
 *
 * The adapter is the only place the route words (`delivery`, `appliedAt`,
 * `controls`, `pins`, `goalRef`, ...) enter the page; `MemberData` carries the
 * board's own words and rows.
 */
import type { GraphHoverReadV1, LineArchivedTagV1, LineControlV1, LineExecutionItemV1, LineMessageStateV1, LineRowV1, WorkLineDetailV1 } from '../../contracts/work-line.js';
import type { CoreScope } from '../host-client.js';
import type { SessionHistoryEntry } from '../../contracts/session-activity.js';
import type { TaskExecutionRecord } from '../../contracts/execution-read.js';
import type { TaskGraph, TaskRow } from '../../contracts/task-graph.js';
import type { ControlIntentSnapshotV1 } from '../../contracts/control-intent.js';
import type { ContinuationBriefV1, ContinuationSessionContinuity } from '../../contracts/continuation-brief.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { QueryExecutionRecord, QueryJobAnswerSnapshot, QueryRunRef } from '../../contracts/query-job.js';
import type { SessionMessageReadV1, MessageBody } from '../../contracts/mailbox.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { RunOutcome, RunRef, TaskTriple } from '../../contracts/dispatch.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { UncommittedFilesV1 } from '../../contracts/workspace-files.js';
import type { CreatorContactV1 } from '../../contracts/role-lines.js';
import { asRecord, asText } from '../values.js';
import { lineNameOf, lineStatusView, localShortAt, planVersionText, taskState, taskWhyOf, PHASE_WORD } from './task-map.js';
import { dutyWordOf, lineHref, lineNameOfSession, railCardOf,
  type LineKey, type NavData, type NavGoal, type NavInbox, type NavLine } from './nav.js';
import { archivedBannerOf, runHostsTextOf } from './chain.js';
import { continuationControlOf, requeueVisible, reviewOfTaskRow, type LineReview } from './line-shared.js';
import type { MainRunStep, MainRunSteps } from './main.js';
import { auxChangedRowsOf } from './aux-panel.js';

/** One copies-section item, its deterministic Query and that Query's last answer. */
export type MemberCopySource = {
  item: Extract<import('../../contracts/work-line.js').WorkLineSectionPageV1, { section: 'copies' }>['items'][number];
  query: QueryExecutionRecord | null;
  answer: QueryJobAnswerSnapshot | null;
};

/** The public facts one `tasks/requeue` click needs; only a successful read fills them. */
export type MemberWriteBasis = {
  taskRef: TaskTriple;
  afterRunRef: RunRef;
  runRevision: number;
  goalRef: GoalRef;
  goalRevision: number;
};

/** One collapsed 启动核对 section: grouped start-up rows; hidden when there is nothing to report. */
export type MemberStartup = {
  show: boolean;
  count: number;
  groups: Array<{ label: string; rows: Array<{ text: string }> }>;
  /** `host/reconcile-report`'s read failure, drawn in this section only. */
  error: string | null;
};

/** The four display fields of one reconcile line; the page never reads the Host type. */
export type MemberStartupLine = { ref: string; row: string; status: string; reason: string };
export type MemberStartupReport = {
  sessions: MemberStartupLine[]; runs: MemberStartupLine[]; queries: MemberStartupLine[];
  checks: MemberStartupLine[]; controls: MemberStartupLine[]; reviews: MemberStartupLine[];
  fanOut: Array<{ goalId: string; control: string; problem: string; runs: number; continuations: number }>;
  redriveGoals: Array<{ goalId: string; taskIds: string[] }>;
  interruptedGoals: Array<{ goalId: string; taskIds: string[]; runRefs: number; close: string; status: string }>;
  problems: string[];
  /** §5.6-1: the Host instance lease behind the report. */
  lease: 'owned' | 'held_by_other';
  leaseRow: string;
  /** §5.8b-4: the resume mode in force when the report was produced. */
  resumeOnStartup: 'auto' | 'ask' | 'off';
};

export type MemberSource = {
  scope: CoreScope;
  nav: NavData;
  line: import('./line-shared.js').LineReadValue | null;
  ownKey: LineKey | null;
  executions: LineExecutionItemV1[];
  messages: LineMessageStateV1[];
  messageViews: SessionMessageReadV1[];
  messageBodies: Record<string, MessageBody>;
  copies: MemberCopySource[];
  controls: ControlIntentSnapshotV1 | null;
  brief: { brief: ContinuationBriefV1; digest: string } | null;
  history: SessionHistoryEntry[] | null;
  files: UncommittedFilesV1 | null;
  /** `files/list`'s own `partial` fact: the listing, not the uncommitted read, was truncated. */
  filesPartial?: boolean;
  hover: GraphHoverReadV1 | null;
  /** The Run's own read; `null` when the line has no execution or it could not be read. */
  execution: TaskExecutionRecord | null;
  /** The graph of the Goal the line's task belongs to; `null` for no Plan. */
  taskGraph: TaskGraph | null;
  write: MemberWriteBasis | null;
  /** The Host's start-up reconcile report; `null` when this Host did not reconcile. */
  startup: MemberStartupReport | null;
  /** A failed `host/reconcile-report`: the message 启动核对 shows; never the page's error. */
  startupError: string | null;
  /** B2: every workspace line's creator contact, keyed `projectId/sessionId`;
   * `null` when the page's one `role-lines/read` failed (no card says 建它的). */
  creators: ReadonlyMap<string, CreatorContactV1> | null;
  /** A5 (121-147): every Run the record draws, keyed by its own run id, from
   * that Run's `executions/steps` projection. A Run whose snapshot could not be
   * read is absent, never given a guessed scope. */
  runStepsByRun: ReadonlyMap<string, MainRunSteps>;
  /** B6: the selected Run detail's network record, read only while
   * `demand.memberRunHosts` names it; `null` when no Run detail is open. */
  runHosts: { runRef: RunRef; text: string } | null;
  /** S7: the selected line's open waits from `sessions/facts`, already named;
   * `[]` when the read failed or nothing is open. */
  waits: MemberWait[];
  /** S6: the QueryRun's unknown cause from `queries/read`; null for a Run or none. */
  attestWhy: string | null;
};

export type MemberRailRow = NavLine & {
  current: boolean;
  /** The rail card's rows for a live line; `null` for the main-conversation link
   * and archived rows, whose templates draw no card. */
  card: { rows: Array<{ k: string; v: string }> } | null;
};

/** S7: one open wait; `name` is the recipient line's name, `deadline` the browser-local
 * `MM-DD HH:mm` (`localShortAt`), never an ISO string. */
export type MemberWait = { name: string; deadline: string | null };

export type MemberLine = {
  key: LineKey;
  title: string;
  sub: string;
  duty: { code: string; word: string; text: string };
  scopeText: string;
  task: { name: string; st: string; tip: string } | null;
  status: { live: boolean; advancing: boolean; still: boolean; word: string; dot: string; advText: string };
  attempt: { ordinal: number | null; text: string };
  controls: LineControlV1[];
  canPause: boolean;
  canResume: boolean;
  /** S3: 继续 goes through the paused Task's `continue` control (a new Run). */
  resumeStartsNewRun: boolean;
  canCancel: boolean;
  canRequeue: boolean;
  canAsk: boolean;
  canIntervene: boolean;
  interveneReason: string | null;
  readOnly: boolean;
  /** K3 L7: the line Task's review and its two buttons, or `null` without a record. */
  review: LineReview | null;
  /** B3: the plan the current Run was claimed under, plus a newer current
   * plan when there is one; empty without a Run. */
  claimedPlan: Array<{ k: string; v: string }>;
  /** B5: the line's archive tag and head-Session instant, as Chain reads them. */
  archived: { tag: LineArchivedTagV1; at: string | null } | null;
  /** B5: the line-view banner sentence; empty unless the line is archived. */
  archivedText: string;
  /** S6: the line's available `attest_unknown` control, or null. */
  attest: { route: string; target: LineControlV1['target']; pins: LineControlV1['pins'] } | null;
  /** S6: why a QueryRun's result is unknown, from its own record; empty for a Run. */
  attestWhy: string;
  /** S7: the line's open waits, for the head's 状态 card. */
  waits: MemberWait[];
  /** The TaskTriple the line is responsible for; the one `writeBasisOf` reads. */
  taskRef: TaskTriple | null;
  /** The Goal the page's subtitle shows (the line's own Goal, else the selected one); the person's words on this
   *  line count toward it. */
  goalId: string | null;
  items: MemberItem[];
  groups: MemberRecordGroup[];
  /** §2.2: the two whole-line links, encoded once by `lineHref`. */
  pageMemberHref: string;
  pageChainHref: string;
};

export type MemberItem =
  | { kind: 'sys'; code: 'start' | 'pause' | 'resume' | 'cancel' | 'requeue' | 'check'; text: string; at: string }
  | { kind: 'run'; runRef: RunRef; head: string; word: string; at: string; time: string; checks: MemberCheck[];
      runSteps: MainRunSteps | null }
  | { kind: 'message'; messageRef: SessionMessageRef; text: string; at: string; track: MemberTrack; reply: string | null;
      replyWord: string; wakeWord: string }
  | { kind: 'ask'; messageRef: SessionMessageRef; question: string; answer: string | null; phase: string | null; at: string }
  | { kind: 'brief'; rows: Array<{ k: string; v: string }> }
  | { kind: 'mark'; text: string; at: string; sq: string; go: 'main' | null }
  | { kind: 'sep'; text: string }
  | { kind: 'day'; text: string };

export type MemberCheck = { at: string; status: string; label: string };
export type MemberTrack = { delivery: string; appliedAt: string | null; rejectedAt: string | null };
export type MemberRecordGroup = { key: string; goalRef: GoalRef | null; task: string; name: string; st: string; word: string; tip: string; rows: MemberItem[] };
export type MemberTraceRow = { recordId: string; at: string; kind: string; body: string; raw: string | null };
export type MemberChanges = {
  repository: 'git' | 'not_git';
  files: Array<{ path: string; added: number | null; deleted: number | null; state: string }>;
  note: string;
};

export type MemberData = {
  scope: CoreScope;
  goal: { id: string; ordinal: number | null; name: string } | null;
  inbox: NavInbox;
  goals: NavGoal[];
  lines: MemberRailRow[];
  archived: MemberRailRow[];
  archivedText: string;
  head: string;
  headTip: string;
  line: MemberLine | null;
  ownKey: LineKey | null;
  ownName: string;
  trace: MemberTraceRow[];
  changes: MemberChanges;
  write: MemberWriteBasis | null;
  startup: MemberStartup;
  /** B6: the open Run detail's hosts, or `null` when no Run detail is open. */
  runHosts: MemberSource['runHosts'];
};

/** The one key both reads use for a message body: workspace + message + part. */
export function messageBodyKey(ref: SessionMessageRef, part: 'message' | 'response'): string {
  return ref.workspaceId + '/' + ref.messageId + '/' + part;
}

/** §2.8: the two stored facts a line's message row shows — whether it needs a
 * reply and whether it wakes the recipient. Main's line record and Member's
 * message rows read the same `LineMessageStateV1` value here, so neither page
 * keeps its own wording. */
export function messageFlagsOf(state: LineMessageStateV1): { replyWord: string; wakeWord: string } {
  return {
    replyWord: state.needsReply ? '要回复' : '不用回复',
    wakeWord: state.wake ? '会叫醒' : '不叫醒',
  };
}

export const RUN_STATUS_WORD: Record<string, string> = { starting: '启动中', running: '执行中', ended: '已结束' };
export const OUTCOME_WORD: Record<RunOutcome, string> = {
  completed: '完成', failed: '失败', cancelled: '已取消', yielded: '已让出', crashed: '中断',
  budget_exhausted: '预算耗尽', outcome_unknown: '结果未知',
};
const BRIEF_MODE_WORD: Record<string, string> = { rework: '返工', resume_after_interruption: '中断后接着做' };
const FAILURE_CLASS_WORD: Record<string, string> = {
  run_failed: '执行失败', check_failed: '检查未通过', check_incomplete: '检查不完整',
  interrupted: '平台中断', cancelled: '已取消',
};

function sameKey(a: LineKey | null, b: LineKey): boolean {
  return a !== null && a.projectId === b.projectId && a.sessionId === b.sessionId;
}

function goalOf(goalId: string, projectId: string): GoalRef {
  return { aggregateType: 'Goal', projectId, goalId };
}

function taskRowOf(graph: TaskGraph | null, task: TaskTriple): TaskRow | null {
  if (graph === null) return null;
  return graph.tasks.find((row) => row.ref.projectId === task.projectId
    && row.ref.goalId === task.goalId && row.ref.taskId === task.taskId) ?? null;
}

/** The line's own task: the one rule `readLineFacts`, Chain's reader and this adapter use (READS-10 b). */
export function taskOfLine(row: LineRowV1): TaskTriple | null {
  return row.responsibleNow[0]?.task ?? row.name.tasks[0] ?? row.groups.task ?? null;
}

/** §2.6: the task's word comes from the same `taskState`/`PHASE_WORD` tables the
 * map uses; without a TaskRow the line's own phase word is the closest fact. */
function taskViewOf(lineRow: LineRowV1, graph: TaskGraph | null): { name: string; st: string; tip: string } | null {
  const brief = lineRow.responsibleNow[0];
  const triple = taskOfLine(lineRow);
  if (triple === null) return null;
  const task = taskRowOf(graph, triple);
  const phase = brief?.phase ?? task?.effectivePhase ?? '';
  const verdict = asRecord(asRecord(asRecord(asRecord(task).failure).automation).verdict);
  const stop = asText(verdict.kind) === 'stopped' ? asText(verdict.reason) : '';
  const st = task === null ? phase
    : taskState(phase, asRecord(task.definition).executionIntent, task.disposition,
      asText(asRecord(task.phaseCause).code), stop, task.eligibility.eligible) ?? 'pending';
  return {
    name: brief?.title ?? (asText(asRecord(task?.definition).title) || triple.taskId),
    st,
    tip: task === null ? '' : taskWhyOf(task as unknown as Record<string, unknown>, st),
  };
}

function controlOf(controls: LineControlV1[], kind: LineControlV1['kind']): LineControlV1 | null {
  return controls.find((control) => control.kind === kind) ?? null;
}

function canSubmit(controls: LineControlV1[], kind: LineControlV1['kind']): boolean {
  return controlOf(controls, kind)?.availability === 'available';
}

/** S6: why the QueryRun is unknown, from its own `executionState.unknown`
 * (QRR-05). A cause no page word exists for writes nothing. */
export function queryUnknownTextOf(cause: unknown): string {
  const row = asRecord(cause);
  if (asText(row.kind) === 'unresolved_tools') {
    const calls = Array.isArray(row.toolCallIds) ? row.toolCallIds.length : 0;
    return calls === 0 ? '还有工具调用没有结果' : '还有 ' + String(calls) + ' 个工具调用没有结果';
  }
  if (asText(row.kind) === 'kernel_unreadable') {
    return asText(row.verdict) === 'damaged' ? '执行记录损坏' : '执行记录缺失';
  }
  return '';
}

/** S7: the line's open waits, each named by the recipient line. A recipient
 * this page has no line for stays 一条不在列表里的工作线, never an id. */
export function waitRowsOf(waits: unknown, nav: NavData): MemberWait[] {
  const rows: MemberWait[] = [];
  for (const entry of Array.isArray(waits) ? waits : []) {
    const row = asRecord(entry);
    if (asText(asRecord(row.state).state) !== 'open') continue;
    const recipient = asRecord(row.recipient);
    const name = asText(recipient.kind) === 'user' ? '你'
      : lineNameOfSession([...nav.lines, ...nav.archived], {
        projectId: asText(recipient.projectId), sessionId: asText(recipient.sessionId),
      }) || '一条不在列表里的工作线';
    const deadline = asText(row.deadline);
    rows.push({ name, deadline: deadline === '' ? null : localShortAt(deadline) });
  }
  return rows;
}

/** S1 (lead 11-26): the word a control intent puts on the line. `settled`
 * means the intent has an outcome and owns the status word; a queued intent
 * keeps the line's own word and travels in the advancing sentence. Null means
 * the line's own state word is right (a landed pause/cancel/resume/steer). */
export function controlIntentWordOf(intent: ControlIntentSnapshotV1 | null): { word: string; settled: boolean } | null {
  if (intent === null) return null;
  if (intent.status === 'queued') {
    if (intent.kind === 'pause') return { word: '已请求暂停，等安全点', settled: false };
    if (intent.kind === 'cancel') return { word: '已请求取消，等安全点', settled: false };
    return null;
  }
  if (intent.status === 'outcome_unknown') return { word: '待核对', settled: true };
  const observation = intent.observation;
  if (intent.status === 'superseded') {
    return observation.kind === 'terminal_without_cancel'
      ? { word: '未生效（执行先结束）', settled: true }
      : { word: '已被较新的控制取代', settled: true };
  }
  /* applied: only a Run the platform never entered has its own word; every
     other applied intent keeps the line state (已暂停 and so on). */
  if (observation.kind === 'cancelled' && 'origin' in observation
    && observation.origin === 'platform_not_entered') {
    return { word: '已取消（未进入执行）', settled: true };
  }
  if (observation.kind === 'paused' && 'origin' in observation
    && observation.origin === 'platform_not_entered') {
    return { word: '已暂停（还没进入执行）', settled: true };
  }
  return null;
}

/** One line's attempt words (M16): a real ordinal is shown as 第 n 次; an
 * execution without an ordinal is `—`, never a made-up first attempt. */
function attemptOf(task: TaskRow | null): { ordinal: number | null; text: string } {
  const ordinal = typeof task?.attemptOrdinal === 'number' ? task.attemptOrdinal : null;
  if (ordinal !== null) return { ordinal, text: '第 ' + String(ordinal) + ' 次尝试' };
  if (task?.execution !== null && task?.execution !== undefined) return { ordinal: null, text: '—' };
  return { ordinal: null, text: '第 1 次尝试' };
}

function dayOf(at: string): string {
  return at.slice(0, 5);
}

/** One execution's word, "状态 · 结果": the one spelling Member's rows and
 * Main's line record use (READS-10 c). */
export function runWordOf(item: Extract<LineExecutionItemV1, { kind: 'execution' }>): string {
  const word = RUN_STATUS_WORD[item.status] ?? item.status;
  return item.outcome === null ? word : word + ' · ' + (OUTCOME_WORD[item.outcome] ?? item.outcome);
}

/** §2.7: one execution row. The status and the outcome stay two facts; the
 * adapter never invents the word "完成". */
function runItemOf(item: Extract<LineExecutionItemV1, { kind: 'execution' }>, title: string,
  projected: MainRunSteps | null): MemberItem {
  const at = item.startedAt === null ? '' : localShortAt(item.startedAt);
  /* A5: the summary head and the `HH:MM–HH:MM` time are the projection's; a Run
   * whose workspace was not in the snapshot keeps the event stamp and title. */
  return {
    kind: 'run',
    runRef: item.runRef,
    head: projected === null ? title : projected.head,
    word: runWordOf(item),
    at,
    time: projected === null ? at : projected.time,
    checks: item.checks.map((check) => ({
      at: check.at === null ? '' : localShortAt(check.at),
      status: check.status,
      label: '检查',
    })),
    runSteps: projected,
  };
}

/** The one group a message belongs to: its own task from the view read, else
 * the selected line's task. */
function messageTaskOf(state: LineMessageStateV1, views: Map<string, SessionMessageReadV1>,
  lineTask: TaskTriple | null): TaskTriple | null {
  const view = views.get(state.messageRef.messageId);
  return view?.message.taskRef ?? lineTask;
}

/** B4 (lead's 甲): one stop word, never a code. An interrupted Run also carries
 * an error code (`continuation-brief-assembly`), so the interruption is read
 * first; only then who cancelled, the error, and finally the outcome. */
function lastStopOf(previous: ContinuationBriefV1['previous']): string {
  if (previous.interruption !== null) {
    return previous.interruption.kind === 'paused' ? '暂停时被打断' : '执行中被打断';
  }
  if (previous.cancelledBy !== null) {
    const who = previous.cancelledBy === 'human' ? '你'
      : previous.cancelledBy === 'goal_fan_out' ? '目标暂停或取消时一起' : '平台';
    return who + '取消了这次执行';
  }
  if (previous.error !== null) return '出错停下（原文在思维链页的轨迹里）';
  return OUTCOME_WORD[previous.outcome];
}

/** B4: the continuity sentence; `seededName` empty says 上一段工作记录. */
function continuityTextOf(continuity: ContinuationSessionContinuity, seededName: string): string {
  if (continuity === 'same_session_history') return '接着原来的工作记录做，带着原来的历史';
  if (continuity === 'same_session_without_previous_turn') return '接着原来的工作记录做，上一轮没有接上';
  if (continuity === 'other_session_seeded') {
    return '另开一段工作记录，接续自' + (seededName === '' ? '上一段工作记录' : seededName) + '，带入了它的记录';
  }
  return '另开一段工作记录，没有带入原来的历史';
}

/** B4: a seed from this line's own earlier Session says 这条线上一段工作记录;
 * another Session uses its line's name; an unnamed one stays empty. */
export function seededNameOf(brief: ContinuationBriefV1, chainSessions: readonly SessionRef[],
  lines: readonly NavLine[]): string {
  const seeded = brief.session.seededFrom?.sessionRef ?? null;
  if (seeded === null) return '';
  if (chainSessions.some((ref) => ref.projectId === seeded.projectId && ref.sessionId === seeded.sessionId)) {
    return '这条线上一段工作记录';
  }
  return lineNameOfSession(lines, seeded);
}

export function briefRowsOf(brief: ContinuationBriefV1, seededName = ''): Array<{ k: string; v: string }> {
  return [
    { k: '接续方式', v: BRIEF_MODE_WORD[brief.mode] ?? brief.mode },
    { k: '停下原因', v: FAILURE_CLASS_WORD[brief.failureClass] ?? brief.failureClass },
    { k: '上次停在', v: lastStopOf(brief.previous) },
    { k: '工作记录', v: continuityTextOf(brief.session.continuity, seededName) },
  ];
}

/** The six step arrays of the report, in the order the 启动核对 section lists them. */
const STARTUP_STEPS = ['sessions', 'runs', 'queries', 'checks', 'controls', 'reviews'] as const;
const STARTUP_STEP_WORD: Record<typeof STARTUP_STEPS[number], string> = {
  sessions: '工作记录', runs: '执行', queries: '咨询', checks: '检查', controls: '控制', reviews: '审阅',
};

const startupTexts = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).map((entry) => asText(entry)).filter((text) => text !== '');
const startupNumber = (value: unknown): number => typeof value === 'number' ? value : 0;

/** The JSON boundary of `host/reconcile-report`: keep the fields the section shows.
 * The lease and the resume mode sit on the answer's top level; `report` itself
 * is null when this Host holds no lease, and the section still shows the lease
 * line then (§5.6-1). */
export function startupReportOf(value: unknown): MemberStartupReport | null {
  if (value === null || value === undefined) return null;
  const answer = asRecord(value);
  const report = asRecord(answer.report);
  const resumeOnStartup = asText(asRecord(answer.automation).resumeOnStartup);
  const lease = asText(answer.lease) === 'held_by_other' ? 'held_by_other' : 'owned';
  const lines = (step: typeof STARTUP_STEPS[number]): MemberStartupLine[] =>
    (Array.isArray(report[step]) ? report[step] : []).map((entry) => {
      const line = asRecord(entry);
      return { ref: asText(line.ref), row: asText(line.row), status: asText(line.status), reason: asText(line.reason) };
    });
  return {
    sessions: lines('sessions'), runs: lines('runs'), queries: lines('queries'),
    checks: lines('checks'), controls: lines('controls'), reviews: lines('reviews'),
    fanOut: (Array.isArray(report.fanOut) ? report.fanOut : []).map((entry) => {
      const row = asRecord(entry);
      return { goalId: asText(row.goalId), control: asText(row.control), problem: asText(row.problem),
        runs: startupNumber(row.runs), continuations: startupNumber(row.continuations) };
    }),
    redriveGoals: (Array.isArray(report.redriveGoals) ? report.redriveGoals : []).map((entry) => {
      const row = asRecord(entry);
      return { goalId: asText(asRecord(row.goalRef).goalId), taskIds: startupTexts(row.taskIds) };
    }),
    interruptedGoals: (Array.isArray(report.interruptedGoals) ? report.interruptedGoals : []).map((entry) => {
      const row = asRecord(entry);
      return { goalId: asText(asRecord(row.goalRef).goalId), taskIds: startupTexts(row.taskIds),
        runRefs: Array.isArray(row.runRefs) ? row.runRefs.length : 0,
        close: asText(row.close), status: asText(row.status) };
    }),
    problems: startupTexts(report.problems),
    lease,
    leaseRow: asText(answer.leaseRow),
    resumeOnStartup: resumeOnStartup === 'auto' || resumeOnStartup === 'off' ? resumeOnStartup : 'ask',
  };
}

/** S5: one Goal named by its rail ordinal and objective; a Goal no longer in
 * the list is never printed as its id. */
function startupGoalTextOf(goalId: string, nav: NavData): string {
  const goal = nav.goals.find((entry) => entry.goalId === goalId);
  if (goal === undefined) return '一个已不在列表里的目标';
  return '目标 ' + (goal.ordinal === null ? '—' : String(goal.ordinal)) + ' · ' + goal.objective;
}

/** S5: the Task names from the selected Goal's own graph; another Goal's tasks
 * can only be counted, and a missing title falls back to the count. */
function startupTaskTextOf(goalId: string, taskIds: readonly string[], nav: NavData): string {
  if (taskIds.length === 0) return '—';
  const graph = nav.tasks;
  const planGoalId = graph === null ? '' : asText(asRecord(asRecord(graph.plan).goalRef).goalId);
  if (graph === null || planGoalId !== goalId) return String(taskIds.length) + ' 个任务';
  const titles = taskIds.map((taskId) => asText(asRecord(graph.tasks.find((row) =>
    row.ref.goalId === goalId && row.ref.taskId === taskId)?.definition).title));
  if (titles.some((title) => title === '')) return String(taskIds.length) + ' 个任务';
  return titles.join('、');
}

/** S5: the interrupted Goal's status and close codes share one word table; a
 * code outside it is never printed, only said to be unchecked. */
const STARTUP_CODE_WORD: Record<string, string> = {
  recorded: '已记下，等你继续',
  kept: '沿用已记下的',
  driven: '已自动继续',
  clean: '上次正常关闭',
  unclean: '上次没有正常关闭',
};

/** The 启动核对 rows, grouped by step; an empty report hides the section, but a
 * lease held elsewhere always shows its one line (§5.6-1). */
export function startupViewOf(report: MemberStartupReport | null, error: string | null, nav: NavData): MemberStartup {
  if (error !== null) return { show: true, count: 0, groups: [], error };
  if (report === null) return { show: false, count: 0, groups: [], error: null };
  const lineRows = (lines: MemberStartupLine[]): Array<{ text: string }> => lines.map((line) => ({
    text: line.ref + ' · ' + line.row + ' · ' + line.status
      + (line.reason === '' ? '' : ' · ' + line.reason),
  }));
  /* 5.6-1: the lease line is 这台主机's first row; the code HL-04 is a
     damaged lock file, every other row is another Host using the project. */
  const leaseRows = report.lease === 'held_by_other' ? [{ text: report.leaseRow === 'HL-04'
    ? '锁文件损坏：确认没有别的进程后删除项目库目录里的 host-instance.lock'
    : '另一个工作台进程正在使用这个项目库，执行只在那里进行' }] : [];
  /* 5.7-2 / 5.8b-4 / 5.9b-8: the resume mode is said once, then each redriven Goal. */
  const redriveRows: Array<{ text: string }> = [];
  if (report.resumeOnStartup === 'auto') {
    redriveRows.push(...report.redriveGoals.map((row) => ({ text: '启动后自动继续：'
      + startupGoalTextOf(row.goalId, nav) + '（' + startupTaskTextOf(row.goalId, row.taskIds, nav) + '）' })));
  } else {
    redriveRows.push({ text: report.resumeOnStartup === 'ask'
      ? '不自动继续（问我：等你点继续）' : '不自动继续（设置已关闭）' });
    redriveRows.push(...report.redriveGoals.map((row) => ({ text: startupGoalTextOf(row.goalId, nav) })));
  }
  const groups = [
    { label: '这台主机', rows: leaseRows },
    ...STARTUP_STEPS.map((step) => ({ label: STARTUP_STEP_WORD[step], rows: lineRows(report[step]) })),
    { label: '扇出', rows: report.fanOut.map((row) => ({
      text: startupGoalTextOf(row.goalId, nav) + ' · 控制 ' + (row.control === '' ? '—' : row.control)
        + ' · 执行 ' + String(row.runs) + ' · 接续 ' + String(row.continuations)
        + (row.problem === '' ? '' : ' · ' + row.problem),
    })) },
    { label: '重新驱动', rows: redriveRows },
    { label: '被中断的目标', rows: report.interruptedGoals.map((row) => ({
      text: startupGoalTextOf(row.goalId, nav) + ' · ' + (STARTUP_CODE_WORD[row.status] ?? '待核对')
        + ' · ' + (STARTUP_CODE_WORD[row.close] ?? '待核对')
        + ' · 任务 ' + startupTaskTextOf(row.goalId, row.taskIds, nav)
        + (row.runRefs === 0 ? '' : ' · 执行 ' + String(row.runRefs)),
    })) },
    { label: '问题', rows: report.problems.map((text) => ({ text })) },
  ].filter((group) => group.rows.length > 0);
  const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
  return { show: count > 0, count, groups, error: null };
}

/** B2: the card's fifth row, the line that created this one (E3 D60-6). A
 * contact the read does not know, or a line missing from it, writes no row. */
function creatorRowsOf(creator: CreatorContactV1 | undefined,
  lines: readonly NavLine[], archived: readonly NavLine[]): Array<{ k: string; v: string }> {
  if (creator === undefined || creator.kind === 'unknown') return [];
  if (creator.kind === 'session') {
    return [{ k: '建它的', v: lineNameOfSession([...lines, ...archived], creator.session) || '另一条工作线' }];
  }
  if (creator.kind === 'human') return [{ k: '建它的', v: '你' }];
  if (creator.kind === 'platform') return [{ k: '建它的', v: '平台' }];
  /* lapsed: the line that created this one is archived and has no successor. */
  return [{ k: '建它的', v: '建它的线已归档' }];
}

/** The member data of one read. `selected` is the line in the centre; `null`
 * is the empty state. */
export function adaptMember(source: MemberSource, selected: LineKey | null): MemberData {
  const nav = source.nav;
  const ownKey = source.ownKey;
  const currentRailRow = (row: NavLine): MemberRailRow => ({
    ...row,
    current: ownKey !== null && sameKey(ownKey, row.key),
    /* B1: a live line gets Chain's card; the main-conversation link has no line
       facts and the archived template binds no hover, so both stay cardless. */
    card: row.synth || row.archived ? null
      : { rows: railCardOf(row, creatorRowsOf(source.creators?.get(row.id), nav.lines, nav.archived)).rows },
  });
  const lines = nav.lines.map(currentRailRow);
  const archived = nav.archived.map(currentRailRow);
  const selectedGoal = nav.selectedGoalId === null ? null
    : nav.goals.find((goal) => goal.goalId === nav.selectedGoalId) ?? null;
  const line = source.line !== null && source.line.kind === 'line'
    ? adaptMemberLine(source, source.line) : null;
  const ownLine = ownKey === null ? null
    : [...nav.lines, ...nav.archived].find((row) => sameKey(ownKey, row.key)) ?? null;
  const changes = changesOf(source.files, source.filesPartial === true);
  return {
    scope: source.scope,
    goal: selectedGoal === null ? null
      : { id: selectedGoal.goalId, ordinal: selectedGoal.ordinal, name: selectedGoal.objective },
    inbox: nav.inbox,
    goals: nav.goals,
    lines,
    archived,
    archivedText: nav.archivedText,
    head: line !== null ? nav.head
      : source.line !== null && source.line.kind === 'branched' ? '这条工作线分成了几条，请从左栏选一条'
        : selected !== null ? '这条工作线不在了' : nav.head,
    headTip: nav.headTip,
    line,
    ownKey,
    ownName: ownLine === null ? '' : ownLine.name,
    trace: traceOf(source.history),
    changes,
    write: source.write,
    startup: startupViewOf(source.startup, source.startupError, nav),
    runHosts: source.runHosts,
  };
}

/** §2.2: the one line projection Member's page and Main's line view share. */
export function adaptMemberLine(source: MemberSource, detail: WorkLineDetailV1): MemberLine {
  const row = detail.row;
  const key: LineKey = { projectId: row.key.projectId, sessionId: row.key.sessionId };
  const navLine = source.nav.lines.find((entry) => sameKey(entry.key, key));
  const view = lineStatusView(row.status);
  const controls = row.controls;
  const task = taskViewOf(row, source.nav.tasks);
  const taskRow = (() => {
    const triple = taskOfLine(row);
    return triple === null ? null : taskRowOf(source.nav.tasks, triple);
  })();
  const control = source.controls;
  const pendingKind = control !== null && (control.status === 'queued' || control.status === 'applied')
    ? control.kind : null;
  /* S1: a settled intent owns the status word; a queued one keeps the line's
     own word and travels in the advancing sentence (E3 5.1-1 … 5.1-9). */
  const intentWord = controlIntentWordOf(control);
  const settled = intentWord !== null && intentWord.settled;
  /* §2.6: a pause that has landed (`own:'paused'`) reads 已暂停, not 等安全点;
     a cancel still keeps travelling through the last safe point. */
  const pausePending = !settled && (pendingKind === 'pause'
    || row.status.markers.some((marker) => marker.kind === 'stop_pending'));
  /* A cancel that landed stops the advancing text: prototype
     `docs/ui-reference/workbench-2026-10/Member.dc.html:1455-1461` (cancelling keeps the
     working word; the landed cancel reads 已取消，可重新入队). */
  const cancelLanded = pendingKind === 'cancel'
    && source.execution !== null
    && source.execution.run.status === 'ended'
    && source.execution.run.outcome === 'cancelled';
  const advancing = !settled && !cancelLanded && (pendingKind === 'cancel'
    || (pausePending && row.status.own !== 'paused'));
  const live = view.st === 'doing';
  const continuation = continuationControlOf(row.controls, taskOfLine(row));
  const attestControl = controls.find((entry) => entry.kind === 'attest_unknown'
    && entry.availability === 'available') ?? null;
  const intervene = controlOf(controls, 'intervene');
  const lineGoalRef = row.name.goalRef;
  const subGoalId = lineGoalRef?.goalId ?? source.nav.selectedGoalId;
  const goalContext = subGoalId === null ? null : source.nav.goals.find((goal) => goal.goalId === subGoalId) ?? null;
  const scopeParts = [row.groups.module?.moduleId ?? '',
    row.responsibleNow[0]?.title ?? row.groups.task?.taskId ?? ''].filter((part) => part !== '');
  const { items, groups } = recordsOf(source, detail);
  /* 16a T3: the one line-name rule, shared with Chain and the rail. */
  const title = navLine?.name ?? lineNameOf(row.name);
  /* B3: the claimed version; a newer current plan is a fact, not an expiry. */
  const claimed = source.execution?.plan.planRevision ?? null;
  const currentPlan = source.nav.tasks?.plan.planRevision ?? null;
  const claimedPlan: Array<{ k: string; v: string }> = claimed === null ? [] : [
    { k: '领取时用的计划', v: planVersionText(claimed) },
    ...(currentPlan !== null && currentPlan > claimed
      ? [{ k: '当前计划', v: '计划第 ' + String(currentPlan) + ' 版，这个任务原样保留' }] : []),
  ];
  /* B5: the same archive facts Chain's banner reads. */
  const archivedTag = row.status.archivedTag;
  const archived = archivedTag === null ? null : { tag: archivedTag, at: detail.chain[0]?.archivedAt ?? null };
  return {
    key,
    title,
    sub: goalContext === null ? ''
      : '目标 ' + (goalContext.ordinal === null ? '—' : String(goalContext.ordinal)) + ' · ' + goalContext.objective,
    duty: {
      code: row.duty,
      word: dutyWordOf(row.duty),
      text: row.duty === 'executor' ? '写代码、跑检查' : '',
    },
    scopeText: scopeParts.join('、'),
    task,
    status: {
      live,
      advancing,
      still: !live && !advancing,
      word: settled ? intentWord!.word : cancelLanded ? '已取消，可重新入队' : view.word,
      dot: cancelLanded ? 'dot s-cancelled' : view.dot,
      advText: intentWord !== null && !intentWord.settled ? intentWord.word
        : pendingKind === 'cancel' ? '已请求取消，等安全点' : '已请求暂停，等安全点',
    },
    attempt: attemptOf(taskRow),
    controls,
    canPause: canSubmit(controls, 'pause'),
    canResume: canSubmit(controls, 'resume') || continuation !== null,
    resumeStartsNewRun: continuation !== null,
    canCancel: canSubmit(controls, 'cancel'),
    canRequeue: taskRow !== null && requeueVisible(taskRow),
    canAsk: true,
    canIntervene: row.status.readOnly !== true && intervene?.availability === 'available',
    interveneReason: intervene !== null && intervene.availability !== 'available' ? intervene.reason : null,
    readOnly: row.status.readOnly === true,
    review: row.status.readOnly === true ? null : reviewOfTaskRow(taskRow),
    claimedPlan,
    archived,
    archivedText: archivedBannerOf(archived),
    attest: attestControl === null ? null
      : { route: attestControl.route, target: attestControl.target, pins: attestControl.pins },
    attestWhy: source.attestWhy ?? '',
    waits: source.waits,
    taskRef: taskOfLine(row),
    goalId: subGoalId,
    items,
    groups,
    pageMemberHref: lineHref('Member.dc.html', subGoalId, key),
    pageChainHref: lineHref('Chain.dc.html', subGoalId, key),
  };
}

/** Merge the four sections into the centre's rows and the right panel's groups. */
function recordsOf(source: MemberSource, detail: WorkLineDetailV1): { items: MemberItem[]; groups: MemberRecordGroup[] } {
  const views = new Map(source.messageViews.map((entry) => [entry.message.ref.messageId, entry]));
  const bodies = source.messageBodies;
  const lineTask = taskOfLine(detail.row);
  const groups = new Map<string, MemberRecordGroup>();
  /* §2.9: the group is the whole TaskTriple, not its taskId alone: one line
     can answer for the same task id under two Goals. */
  const taskKeyOf = (task: TaskTriple): string => task.projectId + '/' + task.goalId + '/' + task.taskId;
  const groupFor = (task: TaskTriple | null): MemberRecordGroup => {
    const id = task === null ? '' : taskKeyOf(task);
    const found = groups.get(id);
    if (found !== undefined) return found;
    const brief = task === null ? undefined
      : detail.row.responsibleNow.find((entry) => taskKeyOf(entry.task) === id);
    const row = task === null ? null : taskRowOf(source.nav.tasks, task);
    const state = row === null ? null : taskState(row.effectivePhase,
      asRecord(row.definition).executionIntent, row.disposition,
      asText(asRecord(row.phaseCause).code), '', row.eligibility.eligible);
    const st = state ?? (row?.disposition === 'cancelled' ? 'cancelled' : '');
    const group: MemberRecordGroup = {
      key: id === '' ? 'line' : id,
      goalRef: task === null ? detail.row.name.goalRef : goalOf(task.goalId, task.projectId),
      task: id === '' ? '' : task!.taskId,
      name: brief?.title ?? (task === null ? '这条工作线' : task.taskId),
      st,
      word: st === '' ? '' : PHASE_WORD[st] ?? st,
      tip: row === null ? '' : taskWhyOf(row as unknown as Record<string, unknown>, st),
      rows: [],
    };
    groups.set(id, group);
    return group;
  };
  const timed: Array<{ at: string; item: MemberItem; task: TaskTriple | null }> = [];
  const executions = source.executions.slice().sort((a, b) => a.generation - b.generation);
  for (const entry of executions) {
    if (entry.kind === 'query') {
      timed.push({
        at: entry.startedAt === null ? '' : localShortAt(entry.startedAt),
        item: {
          kind: 'sys', code: 'check',
          text: '只读咨询 · ' + (entry.phase ?? '') + (entry.outcome === null ? '' : ' · ' + entry.outcome),
          at: entry.startedAt === null ? '' : localShortAt(entry.startedAt),
        },
        task: lineTask,
      });
      continue;
    }
    const group = groupFor(entry.task);
    const item = runItemOf(entry, group.name, source.runStepsByRun.get(entry.runRef.runId) ?? null);
    timed.push({ at: entry.startedAt === null ? '' : localShortAt(entry.startedAt), item, task: entry.task });
    group.rows.push(item);
  }
  for (const state of source.messages) {
    const view = views.get(state.messageRef.messageId) ?? null;
    const message = view?.message ?? null;
    const text = bodies[messageBodyKey(state.messageRef, 'message')]?.text ?? '';
    const reply = bodies[messageBodyKey(state.messageRef, 'response')]?.text ?? null;
    const at = message === null ? localShortAt(state.createdAt) : localShortAt(message.createdAt);
    const flags = messageFlagsOf(state);
    const item: MemberItem = {
      kind: 'message',
      messageRef: state.messageRef,
      text,
      at,
      track: {
        delivery: state.delivery,
        appliedAt: message?.appliedAt ?? null,
        rejectedAt: message?.rejectedAt ?? null,
      },
      reply,
      replyWord: flags.replyWord,
      wakeWord: flags.wakeWord,
    };
    const task = messageTaskOf(state, views, lineTask);
    timed.push({ at, item, task });
    groupFor(task).rows.push(item);
  }
  for (const copy of source.copies) {
    const question = copy.query === null ? '' : asText(asRecord(copy.query.job.job.intent).question);
    const answer = copy.answer === null ? null : asText(asRecord(copy.answer.answer).answer);
    const phase = copy.item.phase;
    const startedAt = copy.query === null ? '' : copy.query.run.run.startedAt;
    const at = startedAt === null || startedAt === undefined || startedAt === '' ? '' : localShortAt(startedAt);
    const item: MemberItem = {
      kind: 'ask', messageRef: copy.item.messageRef, question, answer, phase, at,
    };
    const parent = source.messages.find((state) => state.messageRef.messageId === copy.item.messageRef.messageId);
    const task = parent === undefined ? lineTask : messageTaskOf(parent, views, lineTask);
    timed.push({ at, item, task });
    groupFor(task).rows.push(item);
  }
  if (source.brief !== null) {
    const seededName = seededNameOf(source.brief.brief, detail.row.chainSessions,
      [...source.nav.lines, ...source.nav.archived]);
    const item: MemberItem = { kind: 'brief', rows: briefRowsOf(source.brief.brief, seededName) };
    timed.push({ at: '', item, task: lineTask });
    groupFor(lineTask).rows.push(item);
  }
  timed.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  const items: MemberItem[] = [];
  let day = '';
  for (const entry of timed) {
    const currentDay = dayOf(entry.at);
    if (entry.at !== '' && currentDay !== day) {
      day = currentDay;
      items.push({ kind: 'day', text: day });
    }
    items.push(entry.item);
  }
  return { items, groups: [...groups.values()].filter((group) => group.rows.length > 0) };
}

export function traceOf(history: SessionHistoryEntry[] | null): MemberTraceRow[] {
  if (history === null) return [];
  return history.map((entry) => {
    const body = entry.body;
    const text = 'encoding' in body ? body.text : '';
    return {
      recordId: entry.recordId,
      at: localShortAt(entry.recordedAt),
      kind: entry.kind,
      body: text === '' ? '原始记录' : text,
      raw: text === '' ? null : text,
    };
  });
}

function changesOf(files: UncommittedFilesV1 | null, partial: boolean): MemberChanges {
  if (files === null) return { repository: 'git', files: [], note: '' };
  if (files.repository === 'not_git') {
    return { repository: 'not_git', files: [], note: '这个工作区不是 git 工作区' };
  }
  return { repository: 'git', files: auxChangedRowsOf(files), note: partial ? '只列了部分' : '' };
}
