/**
 * The Decide page adapter (E3-DECIDE §2.3): one pure conversion from the route
 * replies the page reads (`goals/list`, per-row `goals/display`, `lines/list`,
 * the selected `lines/read`, the archive page, every `decisions/queue` page and
 * the per-Goal `tasks/query`) into the `props.data` of `Decide.dc.html`. It
 * touches no DOM, no network and no app module.
 *
 * §2.2: every queue page keeps its own `displayToken`/`seenThrough`; a row is
 * only ever marked with the page that returned it. §2.6: a row's time is the
 * stored fact (card `openedAt`, notice `rework.requestedAt`, answer
 * `respondedAt`), never the read cursor or the wall clock. §2.7: the pins of a
 * write are the card's own captured `source.pins`, filtered only where the
 * owner's contract names a subset.
 */

import { asRecord, asText } from '../values.js';
import { goalDisplayState, localShortAt, stopWordOf, taskState } from './task-map.js';
import type { NavData } from './nav.js';
import type { WorkspaceScope } from '../../contracts/core/identity.js';
import type {
  DecisionObjectV1, DecisionOptionV1, DecisionSelectionV1, DecisionSourceV1, DecisionSubjectV1,
  NoticeCategoryV1, NoticePositionV1,
} from '../../contracts/goal-decisions.js';
import type { QueryJobRef } from '../../contracts/query-job.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { RunRef, TaskTriple } from '../../contracts/dispatch.js';

/** The `DecisionCardV1` fields this page reads (the UI keeps its own boundary
 * shape at the JSON edge; no `src/core` import). */
export type DecisionCardV1 = {
  cardKey: string;
  source: DecisionSourceV1;
  state: DecisionCardStateV1;
  subject: DecisionSubjectV1;
  requestRef: QueryJobRef | null;
  objects: DecisionObjectV1[];
  options: DecisionOptionV1[];
  answer: { decision: { selection: DecisionSelectionV1 }; respondedAt: string; bodyRef: ArtifactRef | null } | null;
  application: unknown;
  openedAt: string | null;
  taskRef: TaskTriple | null;
  runRef: RunRef | null;
  readOnly: boolean;
  actions: readonly string[];
};
export type DecisionCardStateV1 =
  | 'waiting_answer' | 'answered_pending_application' | 'applied'
  | 'answered_no_application' | 'closed';

export type NoticeItemV1 = {
  itemKey: string; category: NoticeCategoryV1; subject: DecisionSubjectV1;
  position: NoticePositionV1; summary: string; objects: DecisionObjectV1[];
  rework: { requestedAt: string } | null;
};

export type DecisionQueueReadV1 = {
  waitingAnswer: DecisionCardV1[];
  answeredPendingApplication: DecisionCardV1[];
  history: DecisionCardV1[];
  notices: NoticeItemV1[];
  counts: { waitingAnswer: number; answeredPendingApplication: number;
    notices: Partial<Record<NoticeCategoryV1, number>> };
  countsComplete: boolean;
  nextCursor: string | null;
  sourceCursor: unknown;
  seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
  displayToken: string | null;
  capabilities: unknown[];
};

/** One read's inputs; each field is one route's value (`null` = not read). */
export type DecideSource = {
  /** The shared navigation read (`adaptNav`), so the rail keeps the
   * workspace's own counts while the queue body follows the goal filter (Y1). */
  nav: NavData;
  scope: WorkspaceScope;
  workspaceRevision: number;
  queue: DecisionQueueReadV1[];
  tasks: Record<string, unknown | null>;
  selectedGoalId: string | null;
};

/** The page's own state; the adapter only needs the two tab/filter switches. */
export type DecideUi = {
  tab: 'open' | 'done';
  goalFilter: string | null;
  selectedCardKey: string | null;
  factsOpen: boolean;
  step: DecideStepKey | null;
  form: DecideForm;
  lineKey: DecideLineKey | null;
};

export type DecideLineKey = { projectId: string; sessionId: string };

export type DecideData = {
  nav: NavData;
  scope: WorkspaceScope;
  workspaceRevision: number;
  sections: DecideSection[];
  history: DecideRow[];
  counts: { waitingAnswer: number; notices: number; answeredPendingApplication: number; complete: boolean };
  /** 已处理页签的行数 (`answeredPendingApplication` + `history`); 0 when not read. */
  doneTotal: number;
  card: DecideCard | null;
  task: DecideTaskFacts | null;
  /** Raw `tasks/query` per Goal, kept for the two plan writes (§2.7). */
  plans: Record<string, unknown>;
  /** The Goals whose `tasks/query` was read this round, including `not_found`
   * (absent from `plans`), so `readDecide` keeps the original 0-phase result. */
  taskGoalIds: string[];
  /** The on-demand answer body, by cardKey. */
  answerBodies: Record<string, string>;
};

export type DecideSection = { name: '要决定' | '请知悉' | '已处理'; level: 'decide' | 'notice' | 'done'; rows: DecideRow[] };

export type DecideRow = {
  key: string;
  level: 'decide' | 'notice' | 'done';
  card: DecisionCardV1 | null;
  notice: NoticeItemV1 | null;
  label: string;
  sub: string;
  time: string | null;
  state: string;
  goalId: string | null;
  /** The conflict card's composer quote, in `goals/list.order` (later first);
   * the card header `label` when either Goal has no ordinal (§2.6/READS-4). */
  askRef: string;
  noticeWindow: { displayToken: string | null;
    seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>> } | null;
  /** The card's presentable facts; null on a notice row. */
  view: DecideCard | null;
};

export type DecideCard = {
  key: string;
  source: DecisionCardV1['source'];
  level: 'decide' | 'notice' | 'done';
  state: DecisionCardStateV1;
  title: string;
  line: string;
  path: string;
  position: string;
  facts: { k: string; v: string; files?: { path: string; parts: string[] }[] }[];
  options: { id: string; label: string; effect: 'apply' | 'reject' | 'defer' }[];
  actions: DecideActionKey[];
  subject: DecisionSubjectV1;
  requestRef: QueryJobRef | null;
  taskRef: TaskTriple | null;
  runRef: RunRef | null;
  openedAt: string | null;
  /** The Task's head verification round, its pin for `verification/reverify` (§2.7 D26). */
  roundRef: unknown | null;
  roundRevision: number | null;
  readOnly: boolean;
  askable: boolean;
  answer: { selection: string; respondedAt: string | null; bodyRef: ArtifactRef | null;
    application: 'applied' | 'pending' | null } | null;
  /* ---- the page's static step inputs (§2.7) ---- */
  /** Secondary actions and the primary one; the page renders the primary in the foot. */
  acts: DecideAct[];
  primary: DecideAct | null;
  checks: { checkId: string; reportRef: ArtifactRef | null }[];
  report: string;
  fixName: string;
  /** The repair assignment role; null when no public task carries the failed Run (X2). */
  fixRole: string | null;
  ownerTaskId: string;
  instructionChecks: string;
  /** The budget step's minimum (K units) and the prefilled default (§2.7 D35). */
  budget: { min: number; def: string; last: number } | null;
  reasonLabel: string;
  reasonPh: string;
  notePh: string;
  cancelText: string;
  after: string;
  goalId: string;
};

export type DecideAct = {
  key: DecideActionKey;
  label: string;
  /** The step it opens; null = a direct write or a local/unconnected control. */
  step: DecideStepKey | null;
  primary: boolean;
  cls: string;
  off: string;
  tip: string;
};

export type DecideActionKey =
  | 'answer' | 'ask' | 'seen' | 'locate'
  | 'defer' | 'cancel' | 'restore' | 'continue'
  | 'requeue' | 'fix' | 'note' | 'attest' | 'answer-body';

export type DecideStepKey = 'requeue' | 'fix' | 'note' | 'attest'
  | 'defer' | 'cancel' | 'restore' | 'continue';
export type DecideForm = {
  reason?: string; budget?: string; name?: string; checks?: boolean[]; note?: string;
};

export type DecideTaskFacts = {
  goalId: string;
  row: unknown;
  task: unknown;
};

const FAILURE_WORD: Record<string, string> = {
  check_failed: '检查未通过', check_incomplete: '检查不完整', run_failed: '执行失败',
  interrupted: '执行中断', cancelled: '已取消',
};

/* The twelve notice categories' page words. `adaptNav` keeps no category table;
   this is the one the Decide page shows under a notice row (§2.6). */
const CATEGORY_WORD: Record<string, string> = {
  member_notice: '成员', second_expiry: '二次到期', handoff: '交接', note_review: '注记',
  undelivered_reply: '未送达的回复', automatic_rework: '自动返工', continuation: '接续',
  disconnect: '连接中断', member_created: '新成员', project_notice: '项目',
  plan_adoption: '计划采用', plan_notice: '计划',
};

const KIND_WORD: Record<string, string> = {
  message: '消息', candidate: '计划候选', note_review: '注记复核', planning_question: '规划问题',
  message_release: '消息放行', unknown_call_review: '未知结果待核对', command_rerun_request: '命令重跑',
  member_creation: '成员创建', rework_request: '返工请求', handoff_approval: '交接确认',
  adviser_creation: '参谋创建', module_maintainer_assignment: '模块维护者指派',
  repair_approval: '修复确认', structural_proposal: '结构提案', role_capacity: '容量',
  role_line_change: '工作线变更',
};

const STATE_WORD: Record<string, string> = {
  waiting_answer: '等你答复', answered_pending_application: '已答复，等落实', applied: '已落实',
  answered_no_application: '已答复', closed: '已关闭',
};

function selectionWord(selection: DecisionSelectionV1 | undefined, options: readonly DecisionOptionV1Like[]): string {
  if (selection === undefined) return '已答复';
  if (selection.kind === 'conflict_wait') return '等前一个目标';
  if (selection.kind === 'conflict_order') return '调到前面';
  if (selection.kind === 'conflict_parallel') return '并行执行';
  if (selection.kind === 'option') return options.find((o) => o.id === selection.optionId)?.label ?? '已答复';
  return '已答复';
}
type DecisionOptionV1Like = { id: string; label: string };

function pinsOf(card: DecisionCardV1): Array<{ ref: unknown; revision: number }> {
  return Array.isArray(card.source.pins) ? card.source.pins as Array<{ ref: unknown; revision: number }> : [];
}

/** §2.7: requisition's `meta.expected` takes only the Goal and this Run pin. */
export function pinsFor(card: DecisionCardV1, kind: 'Goal' | 'Run'): Array<{ ref: unknown; revision: number }> {
  return pinsOf(card).filter((pin) => asText(asRecord(pin.ref).aggregateType) === kind);
}

/** The Task a card acts on: its `taskRef`, else the one Task pin in its own
 * `source.pins` (a `required_task_deferred` card has no `taskRef`). */
export function taskTripleOf(card: DecisionCardV1): TaskTriple | null {
  if (card.taskRef !== null) return card.taskRef;
  const hit = pinsOf(card).map((pin) => asRecord(pin.ref))
    .find((ref) => asText(ref.aggregateType) === 'Task' && asText(ref.taskId) !== '');
  if (hit === undefined) return null;
  return { projectId: asText(hit.projectId), goalId: asText(hit.goalId), taskId: asText(hit.taskId) };
}

/** §2.7: `"400K"`/`"1.5M"` -> the wire budget; anything else is no budget. */
export function budgetTokensOf(text: string | null | undefined): { tokenBudget: number; deadline: null } | null {
  const match = String(text ?? '').trim().toUpperCase().match(/^(\d+(?:\.\d+)?)\s*(K|M)?$/);
  if (match === null) return null;
  const factor = match[2] === 'M' ? 1_000_000 : match[2] === 'K' ? 1_000 : 1;
  const value = Math.round(Number(match[1]) * factor);
  return value > 0 ? { tokenBudget: value, deadline: null } : null;
}

function taskRowsOf(graph: unknown): Array<Record<string, unknown>> {
  const tasks = asRecord(graph).tasks;
  return Array.isArray(tasks) ? tasks.map((row) => asRecord(row)) : [];
}

function taskIdOf(row: Record<string, unknown>): string {
  return asText(asRecord(row.ref).taskId);
}

function taskNameOf(row: Record<string, unknown>): string {
  return asText(asRecord(row.definition).title);
}

function runIdOf(value: unknown): string {
  return asText(asRecord(value).runId);
}

function stopOf(row: Record<string, unknown>): string {
  const verdict = asRecord(asRecord(asRecord(row.failure).automation).verdict);
  return asText(verdict.kind) === 'stopped' ? asText(verdict.reason) : '';
}

function stateOfTask(row: Record<string, unknown>): string | null {
  const definition = asRecord(row.definition);
  return taskState(asText(row.effectivePhase), definition.executionIntent, asText(row.disposition),
    asText(asRecord(row.phaseCause).code), stopOf(row), asRecord(row.eligibility).eligible === true);
}

function timeOf(iso: string | null): string | null {
  return iso === null || iso === '' ? null : localShortAt(iso);
}

function subjectGoalId(subject: DecisionSubjectV1 | undefined): string | null {
  return subject?.kind === 'goal' ? subject.goalRef.goalId : null;
}

/** §2.7 D19: the four detail facts come from `TaskRow.failure`/`attemptOrdinal`. */
function factsOf(row: Record<string, unknown>): DecideCard['facts'] {
  const failure = asRecord(row.failure);
  if (Object.keys(failure).length === 0) return [];
  const definition = asRecord(row.definition);
  const run = asRecord(failure.run);
  const round = asRecord(failure.round);
  const verdict = asRecord(asRecord(failure.automation).verdict);
  const origin = asText(run.origin);
  const isGate = asText(definition.taskKind) === 'gate' || asText(failure.subjectKind) === 'gate';
  const attempt = isGate
    ? '验收第 ' + String(typeof round.ordinal === 'number' ? round.ordinal : 1) + ' 轮'
    : '第 ' + String(typeof row.attemptOrdinal === 'number' ? row.attemptOrdinal : 1) + ' 次尝试';
  const last = asText(asRecord(asRecord(failure.automation).lastRefusal).reason);
  void verdict;
  return [
    { k: '失败类别', v: FAILURE_WORD[asText(failure.failureClass)] ?? '还不能归类' },
    { k: '谁做的', v: origin === 'host_interrupted' ? '平台中断' : origin === 'human_attested' ? '人工认定' : '系统自动' },
    { k: '尝试', v: attempt },
    { k: '最近拒绝', v: last },
  ];
}

function budgetOfRow(row: Record<string, unknown>): DecideCard['budget'] {
  const verdict = asRecord(asRecord(asRecord(row.failure).automation).verdict);
  if (asText(verdict.kind) !== 'stopped' || asText(verdict.reason) !== 'budget_exhausted') return null;
  const detail = asRecord(verdict.detail);
  let min = typeof detail.minTokenBudgetExclusive === 'number' ? detail.minTokenBudgetExclusive : 0;
  if (min === 0) {
    const runBudget = asRecord(asRecord(asRecord(row.failure).run).budget);
    if (typeof runBudget.tokenBudget === 'number') min = runBudget.tokenBudget;
  }
  const requeueBudget = asRecord(row.requeueBudget);
  if (typeof requeueBudget.tokenBudget === 'number') min = requeueBudget.tokenBudget;
  if (min <= 0) return null;
  return { min: Math.round(min / 1000), def: '400K', last: Math.round(min / 1000) };
}

function ownerTaskOf(tasks: readonly Record<string, unknown>[], runRef: RunRef | null): Record<string, unknown> | null {
  if (runRef === null) return null;
  const id = runIdOf(runRef);
  return tasks.find((row) => runIdOf(row.execution) === id) ?? null;
}

function roleOf(plan: unknown, taskId: string): string | null {
  const value = asRecord(asRecord(plan).plan ?? plan);
  const assignments = value.assignments;
  if (!Array.isArray(assignments)) return null;
  const hit = assignments.map((entry) => asRecord(entry)).find((entry) => asText(entry.taskId) === taskId);
  const role = hit === undefined ? '' : asText(hit.role);
  return role === '' ? null : role;
}

function actsOf(card: DecisionCardV1, row: Record<string, unknown> | null, conflict: boolean): DecideAct[] {
  const out: DecideAct[] = [];
  const add = (key: DecideActionKey, label: string, step: DecideStepKey | null, primary: boolean,
    extra: Partial<DecideAct> = {}): void => {
    out.push({ key, label, step, primary, cls: 'btn btn-sm btn-line' + (extra.off === 'true' ? ' is-off' : ''),
      off: 'false', tip: '', ...extra });
  };
  if (card.readOnly) return out;
  if (conflict) {
    add('locate', '在架构图里看', null, false, {
      off: 'true', tip: '还没接通', cls: 'btn btn-sm btn-line is-off',
    });
    add('answer', '确定', null, true);
    return out;
  }
  if (card.source.kind === 'goal_conflict') {
    add('answer', '确定', null, true);
    return out;
  }
  if (card.options.length > 0) {
    add('answer', '确定', null, true);
    return out;
  }
  /* D6: the Goal-level `interrupted_pending_resume` card names its cause in
     `source.key`; its 继续 starts the Goal's driver (`workflow/driver-start`),
     not `tasks/requeue`. */
  const interrupted = card.source.kind === 'goal_cause'
    && asText(asRecord(card.source).key).includes('interrupted_pending_resume');
  if (interrupted) add('continue', '继续', null, true);
  if (card.source.kind === 'goal_cause' && row !== null) {
    const stop = stopOf(row);
    if (interrupted) {
      /* The cause itself supplies the action; the Task row only adds the
         disposition actions below. */
    } else if (stop === 'auto_rework_cap_reached') {
      add('defer', '延后任务', 'defer', false);
      add('fix', '添加修复任务', 'fix', false);
      add('requeue', '重新入队', 'requeue', true);
    } else if (stop === 'no_new_basis') {
      add('defer', '延后任务', 'defer', false);
      add('requeue', '重新入队', 'requeue', false);
      add('note', '附上说明作为新依据', 'note', true);
    } else if (stop === 'unknown_outcome') {
      add('attest', '核对未知结果', 'attest', true);
    } else if (stop === 'gate_needs_fix' || stop === 'verification_uncovered') {
      add('fix', '添加修复任务', 'fix', true);
    } else if (stop === 'budget_exhausted') {
      add('defer', '延后任务', 'defer', false);
      add('cancel', '取消任务', 'cancel', false);
      add('requeue', '重新入队', 'requeue', true);
    } else if (stop === 'task_paused') {
      add('cancel', '取消任务', 'cancel', false);
      add('continue', '继续', null, true);
    } else if (stop === 'task_cancelled' || stop === 'continuation_cancelled') {
      add('restore', '恢复任务', 'restore', true);
    } else if (taskTripleOf(card) !== null && card.runRef !== null) {
      add('requeue', '重新入队', 'requeue', true);
    }
    /* §2.7 D20/D23/D27: the same Task's disposition change; the three actions
       are the owner's named values, never a second front-end pre-check. */
    const disposition = asText(row.disposition);
    const has = (key: DecideActionKey): boolean => out.some((act) => act.key === key);
    if (disposition === 'deferred') {
      if (!has('restore')) add('restore', '恢复任务', 'restore', !out.some((act) => act.primary));
      if (!has('cancel')) add('cancel', '取消任务', 'cancel', false);
    } else if (disposition === 'cancelled') {
      if (!has('restore')) add('restore', '恢复任务', 'restore', !out.some((act) => act.primary));
    } else {
      if (!has('defer')) add('defer', '延后任务', 'defer', false);
      if (!has('cancel')) add('cancel', '取消任务', 'cancel', false);
    }
  }
  return out;
}

function cardTitleOf(card: DecisionCardV1, label: string): string {
  if (card.source.kind === 'goal_conflict' || card.source.kind === 'goal_cause') return label;
  if (card.source.kind === 'rework_request') return label;
  return label;
}

function makeView(args: {
  card: DecisionCardV1; level: DecideRow['level']; key: string; label: string; title: string;
  path: string; state: string; goalId: string; ordinal: number | null; taskRef: TaskTriple | null;
  goalName: string; taskName: string; taskRow: Record<string, unknown> | null;
  plan: unknown; pins: Array<{ ref: unknown; revision: number }>; files: { path: string; parts: string[] }[];
}): DecideCard {
  const { card, taskRow } = args;
  const files = args.files;
  const failure = taskRow === null ? {} : asRecord(taskRow.failure);
  const round = asRecord(failure.round);
  const failingChecks = Array.isArray(round.failingChecks) ? round.failingChecks.map((entry) => asRecord(entry)) : [];
  const conflict = card.source.kind === 'goal_conflict';
  const acts = actsOf(card, taskRow, conflict);
  const primary = acts.find((act) => act.primary) ?? null;
  const runRef = card.runRef;
  const failureRun = (failure.runRef ?? runRef) as RunRef | null;
  const owner = taskRow === null ? null : ownerTaskOf(taskRowsOf(args.plan), failureRun);
  const ownerTaskId = owner === null ? '' : taskIdOf(owner);
  const fixRole = ownerTaskId === '' ? null : roleOf(args.plan, ownerTaskId);
  const checks = failingChecks.map((entry) => ({
    checkId: asText(entry.checkId), reportRef: (entry.reportRef ?? null) as ArtifactRef | null,
  }));
  const roundOrdinal = typeof round.ordinal === 'number' ? round.ordinal : 1;
  const isGate = asText(asRecord(taskRow?.definition).taskKind) === 'gate' || asText(failure.subjectKind) === 'gate';
  const options = card.options.map((option) => ({ id: option.id, label: option.label, effect: option.effect }));
  const answer = card.answer === null ? null : {
    selection: selectionWord(card.answer.decision.selection, options),
    respondedAt: typeof card.answer.respondedAt === 'string' ? card.answer.respondedAt : null,
    bodyRef: (card.answer.bodyRef ?? null) as ArtifactRef | null,
    application: card.state === 'applied' ? 'applied' as const
      : card.state === 'answered_pending_application' ? 'pending' as const : null,
  };
  const title = cardTitleOf(card, args.title);
  return {
    key: args.key,
    source: card.source,
    level: args.level,
    state: card.state,
    title,
    line: answer !== null ? answer.selection + (answer.application === 'pending' ? '；等落实' : answer.application === 'applied' ? '；已落实' : '') : '',
    path: args.path,
    position: '',
    facts: taskRow !== null ? factsOf(taskRow)
      : conflict ? [{ k: '重叠文件', v: '', files }] : [],
    options,
    actions: [...new Set([
      ...(card.options.length > 0 && !card.readOnly ? ['answer' as const] : []),
      ...(card.source.kind === 'goal_cause' && card.taskRef !== null && card.runRef !== null && !card.readOnly ? ['requeue' as const] : []),
      ...(card.answer !== null ? ['answer-body' as const] : []),
    ])],
    subject: card.subject,
    requestRef: card.requestRef,
    taskRef: args.taskRef,
    runRef: card.runRef,
    openedAt: card.openedAt,
    roundRef: round.roundRef ?? null,
    roundRevision: typeof round.revision === 'number' ? round.revision : null,
    readOnly: card.readOnly,
    askable: !card.readOnly,
    answer,
    acts: acts.filter((act) => !act.primary),
    primary,
    checks,
    report: (isGate ? '验收第 ' : '检查第 ') + String(roundOrdinal) + ' 轮报告',
    fixName: args.taskName === '' ? '修复检查' : '修复 ' + args.taskName,
    fixRole,
    ownerTaskId,
    instructionChecks: checks.map((check) => check.checkId).join('、'),
    budget: taskRow === null ? null : budgetOfRow(taskRow),
    reasonLabel: '原因（必填；只记在记录里，不算新依据）',
    reasonPh: '例如：先把状态字段接上，再补测试',
    notePh: '例如：报告改写到 reports/e2e/ 下了，检查配置里已经登记新路径',
    cancelText: '取消后它不再画在任务图里，只在目标详情里计数；执行和检查记录都保留，之后可以恢复。',
    after: '完成后' + (isGate ? '自动重新验收“' : '自动重新检查“') + args.taskName + '”',
    goalId: args.goalId,
  };
}

/**
 * §2.3: one conversion. Every page of the queue is kept apart so each notice
 * row submits the token of the page that returned it (§2.6 D28).
 */
export function adaptDecide(source: DecideSource, ui: DecideUi): DecideData {
  const goalById = new Map(source.nav.goals.map((row) => [row.goalId, row]));
  const ordinalOf = (id: string | null): number | null => (id === null ? null : goalById.get(id)?.ordinal ?? null);
  const orderOf = (id: string): number => goalById.get(id)?.order ?? 0;
  const nameOf = (id: string | null): string => (id === null ? '' : goalById.get(id)?.objective ?? '');
  const stateOfGoal = (id: string): string => {
    const row = goalById.get(id);
    if (row === undefined) return 'pending';
    if (row.displayPhase !== null) return goalDisplayState(row.displayPhase as Parameters<typeof goalDisplayState>[0]).st;
    if (row.phase !== null) return goalDisplayState(row.phase as unknown as Parameters<typeof goalDisplayState>[0]).st;
    return 'pending';
  };

  const rows: DecideRow[] = [];
  const pushCard = (card: DecisionCardV1, level: DecideRow['level'], window: DecideRow['noticeWindow']): void => {
    const triple = taskTripleOf(card);
    const goalId = subjectGoalId(card.subject) ?? triple?.goalId ?? null;
    const taskGoalId = triple?.goalId ?? goalId;
    const graph = taskGoalId === null ? null : source.tasks[taskGoalId] ?? null;
    const tasks = taskRowsOf(graph);
    const taskRow = triple === null ? null
      : tasks.find((row) => taskIdOf(row) === triple.taskId) ?? null;
    const taskName = taskRow === null ? '' : taskNameOf(taskRow);
    const conflict = card.source.kind === 'goal_conflict';
    const pins = pinsOf(card);
    const goalPins = pins.map((pin) => asRecord(pin.ref)).filter((ref) => asText(ref.aggregateType) === 'Goal');
    const conflictGoalIds = [...new Set(goalPins.map((ref) => asText(ref.goalId)).filter((id) => id !== ''))];
    const subjectId = goalId;
    const otherId = conflict
      ? conflictGoalIds.find((id) => id !== subjectId) ?? null : null;
    const files = (Array.isArray(card.objects) ? card.objects : [])
      .map((entry) => asRecord(entry))
      .filter((object) => object.kind === 'file' && asText(object.path) !== '')
      .map((object) => ({ path: asText(object.path), parts: asText(object.path).split('/') }));
    const ordinal = ordinalOf(goalId);
    const label = conflict
      ? '与目标 ' + String(otherId === null ? '' : ordinalOf(otherId) ?? '') + ' 冲突'
      : card.source.kind === 'goal_cause'
        ? (taskRow === null ? '需要你决定' : stopWordOf(taskRow, stopOf(taskRow)) || '需要你决定')
        : card.source.kind === 'rework_request'
          ? '返工请求'
          : (nameOf(goalId) || '项目') + ' · ' + (KIND_WORD[card.source.kind] ?? '需要你决定');
    /* READS-4/lead 4: the conflict quote names the later Goal first, as
       `goals/list.order` puts it; a missing ordinal uses the card header. */
    const ordered = conflict ? conflictGoalIds.slice().sort((a, b) => orderOf(a) - orderOf(b)) : [];
    const earlierOrdinal = ordered[0] === undefined ? null : ordinalOf(ordered[0]);
    const laterOrdinal = ordered[1] === undefined ? null : ordinalOf(ordered[1]);
    const askRef = conflict && earlierOrdinal !== null && laterOrdinal !== null
      ? '目标 ' + String(laterOrdinal) + ' 与目标 ' + String(earlierOrdinal) + ' 冲突'
      : label;
    const state = conflict
      ? (() => {
        const first = ordered[0];
        return first === undefined ? 'pending' : stateOfGoal(first);
      })()
      : taskRow !== null ? (stateOfTask(taskRow) ?? 'cancelled') : stateOfGoal(goalId ?? '');
    const answerWord = card.answer === null ? '' : selectionWord(card.answer.decision.selection,
      card.options.map((option) => ({ id: option.id, label: option.label })));
    const sub = level === 'done'
      ? answerWord + (card.state === 'applied' ? '；已落实' : '')
      : conflict
        ? '都要改 ' + files.map((file) => file.path).join('、')
        : card.source.kind === 'goal_cause'
          ? nameOf(goalId) + (taskName === '' ? '' : ' / ' + taskName)
          : STATE_WORD[card.state] ?? card.state;
    const path = '目标 ' + String(ordinal ?? '') + (taskName === '' ? ' / ' + nameOf(goalId) : ' / ' + taskName);
    const time = timeOf(level === 'done'
      ? card.answer?.respondedAt ?? card.openedAt : card.openedAt);
    const view = makeView({
      card, level, key: card.cardKey, label, title: label, path, state,
      goalId: goalId ?? '', ordinal, goalName: nameOf(goalId), taskName, taskRow, taskRef: triple,
      plan: taskGoalId === null ? null : source.tasks[taskGoalId] ?? null, pins, files,
    });
    rows.push({
      key: card.cardKey, level, card, notice: null, label, sub, time, state,
      goalId, askRef, noticeWindow: window, view,
    });
  };
  const pushNotice = (notice: NoticeItemV1, window: DecideRow['noticeWindow']): void => {
    const goalId = subjectGoalId(notice.subject);
    const rework = notice.rework;
    const time = timeOf(rework === null ? null : rework.requestedAt);
    const sub = nameOf(goalId) + ' · ' + (CATEGORY_WORD[notice.category] ?? notice.category);
    rows.push({
      key: notice.itemKey, level: 'notice', card: null, notice, label: notice.summary, sub, time,
      state: 'waiting', goalId, askRef: notice.summary, noticeWindow: window, view: null,
    });
  };

  const waiting: DecideRow[] = [];
  const notices: DecideRow[] = [];
  const done: DecideRow[] = [];
  const before = rows.length;
  for (const page of source.queue) {
    const window = { displayToken: page.displayToken ?? null,
      seenThrough: page.seenThrough ?? {} };
    for (const card of page.waitingAnswer ?? []) pushCard(card, 'decide', window);
    for (const notice of page.notices ?? []) pushNotice(notice, window);
    for (const card of page.answeredPendingApplication ?? []) pushCard(card, 'done', window);
    for (const card of page.history ?? []) pushCard(card, 'done', window);
  }
  const added = rows.slice(before);
  waiting.push(...added.filter((row) => row.level === 'decide'));
  notices.push(...added.filter((row) => row.level === 'notice'));
  done.push(...added.filter((row) => row.level === 'done'));

  const first = source.queue[0];
  const noticeCounts = asRecord(asRecord(first?.counts).notices);
  const noticesN = Object.keys(noticeCounts).reduce((sum, key) => sum + (typeof noticeCounts[key] === 'number' ? noticeCounts[key] as number : 0), 0);
  const counts = {
    waitingAnswer: typeof asRecord(first?.counts).waitingAnswer === 'number' ? asRecord(first?.counts).waitingAnswer as number : 0,
    notices: noticesN,
    answeredPendingApplication: typeof asRecord(first?.counts).answeredPendingApplication === 'number'
      ? asRecord(first?.counts).answeredPendingApplication as number : 0,
    complete: first?.countsComplete !== false,
  };
  const plans: Record<string, unknown> = {};
  for (const [goalId, value] of Object.entries(source.tasks)) {
    if (value !== null) plans[goalId] = value;
  }
  const answerBodies: Record<string, string> = {};
  const sections: DecideSection[] = ui.tab === 'done'
    ? (done.length > 0 ? [{ name: '已处理', level: 'done', rows: done }] : [])
    : [
      ...(waiting.length > 0 ? [{ name: '要决定' as const, level: 'decide' as const, rows: waiting }] : []),
      ...(notices.length > 0 ? [{ name: '请知悉' as const, level: 'notice' as const, rows: notices }] : []),
    ];
  const selectedRow = ui.tab === 'done'
    ? done.find((row) => row.key === ui.selectedCardKey) ?? null
    : [...waiting, ...notices].find((row) => row.key === ui.selectedCardKey) ?? null;
  const goalId = source.selectedGoalId;
  const selectedTask = goalId === null ? null : source.tasks[goalId] ?? null;
  const selectedTaskRow = selectedTask === null || selectedRow?.card?.taskRef === null || selectedRow?.card?.taskRef === undefined
    ? null
    : taskRowsOf(selectedTask).find((row) => taskIdOf(row) === selectedRow.card?.taskRef?.taskId) ?? null;
  return {
    nav: source.nav,
    scope: source.scope,
    workspaceRevision: source.workspaceRevision,
    sections,
    history: ui.tab === 'done' ? done : [],
    counts,
    doneTotal: done.length,
    card: selectedRow?.view ?? null,
    task: goalId === null || selectedTask === null ? null
      : { goalId, row: selectedTask, task: selectedTaskRow },
    plans,
    taskGoalIds: Object.keys(source.tasks),
    answerBodies,
  };
}

/**
 * §2.7 D20/D21: the next Plan draft built from the read Plan, dropping the
 * compiler-owned fields and giving every command a fresh `planId`.
 */
export function draftOf(plan: unknown, change: {
  planId: string;
  taskId?: string;
  disposition?: 'active' | 'deferred' | 'cancelled';
  repair?: { taskId: string; name: string; role: string; instruction: string; failureTaskId: string };
}): Record<string, unknown> {
  /* `plan` is the `tasks/query` value; the adopted Plan sits under `.plan`. */
  const source = asRecord(asRecord(plan).plan ?? plan);
  const sourceTasks = Array.isArray(source.tasks) ? source.tasks : [];
  /* The real `tasks/query.plan.tasks` is the draft's task list. A fixture whose
     plan snapshot carries no tasks still has the owner's task definitions on the
     rows; use those rather than send an empty Plan. */
  const baseTasks = sourceTasks.length > 0 ? sourceTasks
    : (Array.isArray(asRecord(plan).tasks)
      ? (asRecord(plan).tasks as unknown[]).map((entry) => ({ ...asRecord(asRecord(entry).definition) }))
      : []);
  const tasks = baseTasks.map((entry) => {
    const row = asRecord(entry);
    const planTaskId = asText(row.taskId) || taskIdOf(row);
    if (change.taskId === undefined || planTaskId !== change.taskId || change.disposition === undefined) return { ...row };
    return { ...row, disposition: change.disposition };
  });
  const assignments = (Array.isArray(source.assignments) ? source.assignments : []).map((entry) => ({ ...asRecord(entry) }));
  const obligations = (Array.isArray(source.obligations) ? source.obligations : []).map((entry) => {
    const row = asRecord(entry);
    const taskIds = Array.isArray(row.taskIds) ? row.taskIds.map((id) => asText(id)) : [];
    if (change.repair === undefined || !taskIds.includes(change.repair.failureTaskId)) return { ...row };
    return { ...row, taskIds: [...taskIds, change.repair.taskId] };
  });
  if (change.repair !== undefined) {
    tasks.push({
      taskId: change.repair.taskId, title: change.repair.name, requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
      executionIntent: 'request_execution',
    });
    assignments.push({ taskId: change.repair.taskId, role: change.repair.role, instruction: change.repair.instruction });
  }
  return {
    schemaVersion: 2,
    planId: change.planId,
    planRevision: (typeof source.planRevision === 'number' ? source.planRevision : 0) + 1,
    goalId: asText(asRecord(source.goalRef).goalId),
    stages: Array.isArray(source.stages) ? source.stages : [],
    tasks,
    assignments,
    obligations,
    taskHierarchy: source.taskHierarchy ?? { parentOf: [] },
    executionDag: source.executionDag ?? { dependsOn: [] },
    ...(source.taskRelations === undefined ? {} : { taskRelations: source.taskRelations }),
    ...(source.inputRequirements === undefined ? {} : { inputRequirements: source.inputRequirements }),
  };
}

