/**
 * The Member page adapter (E3 Member §2.3): one pure conversion from the route
 * replies this page reads into `props.data`. It touches no DOM, no network and
 * no app module; the page keeps its layout, theme and drafts.
 *
 * The adapter is the only place the route words (`delivery`, `appliedAt`,
 * `controls`, `pins`, `goalRef`, ...) enter the page; `MemberData` carries the
 * board's own words and rows.
 */
import type { GraphHoverReadV1, LineControlV1, LineExecutionItemV1, LineMessageStateV1, LineRowV1, WorkLineDetailV1 } from '../../contracts/work-line.js';
import type { CoreScope } from '../host-client.js';
import type { SessionHistoryEntry } from '../../contracts/session-activity.js';
import type { TaskExecutionRecord } from '../../contracts/execution-read.js';
import type { TaskGraph, TaskRow } from '../../contracts/task-graph.js';
import type { ControlIntentSnapshotV1 } from '../../contracts/control-intent.js';
import type { ContinuationBriefV1 } from '../../contracts/continuation-brief.js';
import type { QueryJobAnswerSnapshot } from '../../contracts/query-job.js';
import type { QueryExecutionRecord } from '../../contracts/query-job.js';
import type { SessionMessageReadV1, MessageBody } from '../../contracts/mailbox.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { RunOutcome, RunRef, TaskTriple } from '../../contracts/dispatch.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { UncommittedFilesV1 } from '../../contracts/workspace-files.js';
import { asRecord, asText } from '../values.js';
import { localShortAt, taskState, taskWhyOf, PHASE_WORD } from './task-map.js';
import { lineStatusView, dutyWordOf, lineHref, type LineKey, type NavData, type NavGoal, type NavInbox, type NavLine } from './nav.js';
import { requeueVisible } from './line-shared.js';

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
  write: MemberWriteBasis | null;
};

export type MemberRailRow = NavLine & { current: boolean };

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
  canCancel: boolean;
  canRequeue: boolean;
  canAsk: boolean;
  canIntervene: boolean;
  interveneReason: string | null;
  readOnly: boolean;
  items: MemberItem[];
  groups: MemberRecordGroup[];
  /** §2.2: the two whole-line links, encoded once by `lineHref`. */
  pageMemberHref: string;
  pageChainHref: string;
};

export type MemberItem =
  | { kind: 'sys'; code: 'start' | 'pause' | 'resume' | 'cancel' | 'requeue' | 'check'; text: string; at: string }
  | { kind: 'run'; runRef: RunRef; head: string; word: string; at: string; checks: MemberCheck[] }
  | { kind: 'message'; messageRef: SessionMessageRef; text: string; at: string; track: MemberTrack; reply: string | null }
  | { kind: 'ask'; messageRef: SessionMessageRef; question: string; answer: string | null; phase: string | null; at: string }
  | { kind: 'brief'; rows: Array<{ k: string; v: string }> }
  | { kind: 'mark'; text: string; at: string; sq: string; go: 'main' | null }
  | { kind: 'sep'; text: string }
  | { kind: 'day'; text: string };

export type MemberCheck = { at: string; status: string; label: string };
export type MemberTrack = { delivery: string; appliedAt: string | null; rejectedAt: string | null };
export type MemberRecordGroup = { key: string; goalRef: GoalRef | null; task: string; name: string; st: string; word: string; rows: MemberItem[] };
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
};

/** The one key both reads use for a message body: workspace + message + part. */
export function messageBodyKey(ref: SessionMessageRef, part: 'message' | 'response'): string {
  return ref.workspaceId + '/' + ref.messageId + '/' + part;
}

const RUN_STATUS_WORD: Record<string, string> = { starting: '启动中', running: '执行中', ended: '已结束' };
const OUTCOME_WORD: Record<RunOutcome, string> = {
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

function taskOfLine(row: LineRowV1): TaskTriple | null {
  return row.responsibleNow[0]?.task ?? row.name.tasks[0] ?? row.groups.task ?? null;
}

/** §2.6: the task's word comes from the same `taskState`/`PHASE_WORD` tables the
 * map uses; without a TaskRow the line's own phase word is the closest fact. */
function taskViewOf(lineRow: LineRowV1, graph: TaskGraph | null): { name: string; st: string; tip: string } | null {
  const brief = lineRow.responsibleNow[0];
  const triple = brief?.task ?? lineRow.name.tasks[0] ?? lineRow.groups.task;
  if (triple === undefined || triple === null) return null;
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

/** §2.7: one execution row. The status and the outcome stay two facts; the
 * adapter never invents the word "完成". */
function runItemOf(item: Extract<LineExecutionItemV1, { kind: 'execution' }>, title: string): MemberItem {
  const word = RUN_STATUS_WORD[item.status] ?? item.status;
  const outcome = item.outcome === null ? '' : ' · ' + (OUTCOME_WORD[item.outcome] ?? item.outcome);
  return {
    kind: 'run',
    runRef: item.runRef,
    head: title,
    word: word + outcome,
    at: item.startedAt === null ? '' : localShortAt(item.startedAt),
    checks: item.checks.map((check) => ({
      at: check.at === null ? '' : localShortAt(check.at),
      status: check.status,
      label: '检查',
    })),
  };
}

/** The one group a message belongs to: its own task from the view read, else
 * the selected line's task. */
function messageTaskOf(state: LineMessageStateV1, views: Map<string, SessionMessageReadV1>,
  lineTask: TaskTriple | null): TaskTriple | null {
  const view = views.get(state.messageRef.messageId);
  return view?.message.taskRef ?? lineTask;
}

function briefRowsOf(brief: ContinuationBriefV1): Array<{ k: string; v: string }> {
  const previous = brief.previous;
  const last = previous.error !== null ? previous.error.text
    : previous.interruption !== null ? '中断（' + previous.interruption.kind + '）'
      : previous.cancelledBy !== null ? '已取消（' + previous.cancelledBy + '）'
        : OUTCOME_WORD[previous.outcome];
  return [
    { k: '接续方式', v: BRIEF_MODE_WORD[brief.mode] ?? brief.mode },
    { k: '停下原因', v: FAILURE_CLASS_WORD[brief.failureClass] ?? brief.failureClass },
    { k: '上次停在', v: last },
  ];
}

/** The member data of one read. `selected` is the line in the centre; `null`
 * is the empty state. */
export function adaptMember(source: MemberSource, selected: LineKey | null): MemberData {
  const nav = source.nav;
  const ownKey = source.ownKey;
  const current = (row: NavLine): MemberRailRow => ({ ...row, current: ownKey !== null && sameKey(ownKey, row.key) });
  const lines = nav.lines.map(current);
  const archived = nav.archived.map(current);
  const selectedGoal = nav.selectedGoalId === null ? null
    : nav.goals.find((goal) => goal.goalId === nav.selectedGoalId) ?? null;
  const line = source.line !== null && source.line.kind === 'line'
    ? buildLine(source, source.line, selected) : null;
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
  };
}

function buildLine(source: MemberSource, detail: WorkLineDetailV1, _selected: LineKey | null): MemberLine {
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
  /* §2.6: a pause that has landed (`own:'paused'`) reads 已暂停, not 等安全点;
     a cancel still keeps travelling through the last safe point. */
  const pausePending = pendingKind === 'pause'
    || row.status.markers.some((marker) => marker.kind === 'stop_pending');
  const advancing = pendingKind === 'cancel'
    || (pausePending && row.status.own !== 'paused');
  const live = view.st === 'doing';
  const intervene = controlOf(controls, 'intervene');
  const lineGoalRef = row.name.goalRef;
  const subGoalId = lineGoalRef?.goalId ?? source.nav.selectedGoalId;
  const goalContext = subGoalId === null ? null : source.nav.goals.find((goal) => goal.goalId === subGoalId) ?? null;
  const scopeParts = [row.groups.module?.moduleId ?? '',
    row.responsibleNow[0]?.title ?? row.groups.task?.taskId ?? ''].filter((part) => part !== '');
  const { items, groups } = recordsOf(source, detail);
  const title = navLine?.name ?? (row.name.source === 'duty_only' ? dutyWordOf(row.duty) : row.name.primary);
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
      word: view.word,
      dot: view.dot,
      advText: pendingKind === 'cancel' ? '已请求取消，等安全点' : '已请求暂停，等安全点',
    },
    attempt: attemptOf(taskRow),
    controls,
    canPause: canSubmit(controls, 'pause'),
    canResume: canSubmit(controls, 'resume'),
    canCancel: canSubmit(controls, 'cancel'),
    canRequeue: taskRow !== null && requeueVisible(taskRow),
    canAsk: true,
    canIntervene: row.status.readOnly !== true && intervene?.availability === 'available',
    interveneReason: intervene !== null && intervene.availability !== 'available' ? intervene.reason : null,
    readOnly: row.status.readOnly === true,
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
    const item = runItemOf(entry, group.name);
    timed.push({ at: entry.startedAt === null ? '' : localShortAt(entry.startedAt), item, task: entry.task });
    group.rows.push(item);
  }
  for (const state of source.messages) {
    const view = views.get(state.messageRef.messageId) ?? null;
    const message = view?.message ?? null;
    const text = bodies[messageBodyKey(state.messageRef, 'message')]?.text ?? '';
    const reply = bodies[messageBodyKey(state.messageRef, 'response')]?.text ?? null;
    const at = message === null ? localShortAt(state.createdAt) : localShortAt(message.createdAt);
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
    const item: MemberItem = { kind: 'brief', rows: briefRowsOf(source.brief.brief) };
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
  const rows = files.files.filter((file) => file.state !== 'clean').map((file) => ({
    path: file.path,
    added: file.state === 'uncommitted' && file.lines !== null ? file.lines.added : null,
    deleted: file.state === 'uncommitted' && file.lines !== null ? file.lines.deleted : null,
    state: file.state,
  }));
  return { repository: 'git', files: rows, note: partial ? '只列了部分' : '' };
}
