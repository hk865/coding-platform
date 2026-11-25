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
import {
  ACTOR_WORD, blockerTextOf, causeWordOf, decisionCardCountPartial, gapTextOf, goalDisplayState, localShortAt,
  planRefText, planVersionText, reworkLines, stopRunText, stopWordOf, taskState,
} from './task-map.js';
import { dutyWordOf, lineNameOfSession, sessionRefAtEdge, type NavData } from './nav.js';
import { OUTCOME_WORD } from './member.js';
import { canonicalJson, type JsonValue } from '../../contracts/canonical-json.js';
import type { SettingsCheckRow } from './settings.js';
import type { SessionRef, WorkspaceScope } from '../../contracts/core/identity.js';
import type {
  DecisionObjectV1, DecisionOptionV1, DecisionSelectionV1, DecisionSourceV1, DecisionSubjectV1,
  NoticeCategoryV1, NoticePositionV1,
} from '../../contracts/goal-decisions.js';
import type { QueryJobRef } from '../../contracts/query-job.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { RunRef, TaskTriple } from '../../contracts/dispatch.js';
import type {
  KnowledgeFileSourceV1, KnowledgeProblemKindV1, KnowledgeProblemV1, KnowledgeRecoveryItemV1,
  KnowledgeRecoverySourceV1, ProposalBatchFileV1,
} from '../../contracts/knowledge.js';
import { rawModuleId } from '../../contracts/workspace-module-id.js';
import type { AuxPanelData } from './aux-panel.js';
import type { MemberLine, MemberWriteBasis } from './member.js';

/** The `DecisionCardV1` fields this page reads (the UI keeps its own boundary
 * shape at the JSON edge; no `src/core` import). */
export type DecisionCardV1 = {
  cardKey: string;
  source: DecisionSourceV1;
  state: DecisionCardStateV1;
  subject: DecisionSubjectV1;
  /** Y14b (121-110): the line that sent a platform card; null for platform cards. */
  senderSessionRef?: SessionRef | null;
  requestRef: QueryJobRef | null;
  objects: DecisionObjectV1[];
  options: DecisionOptionV1[];
  answer: { decision: { selection: DecisionSelectionV1 }; respondedAt: string; bodyRef: ArtifactRef | null } | null;
  application: unknown;
  openedAt: string | null;
  taskRef: TaskTriple | null;
  runRef: RunRef | null;
  readOnly: boolean;
  /** Y14: why a closed card closed; absent on old records. */
  closedReason?: 'goal_cancelled' | 'source_resolved' | null;
  actions: readonly string[];
  /** Y3/R2: the checks this stop card may withdraw and reverify. */
  withdrawableChecks?: readonly string[];
  /** §2.8: the release card's request view; absent on every other source kind. */
  actionRelease?: ActionReleaseViewV1;
};

/** §2.8: the request facts a release card can show. Every field is guarded at
 * its use (the route value crosses the JSON edge); a fact is drawn only when
 * the read supplies its field. */
export type ActionReleaseViewV1 = {
  action: 'dispatch' | 'stop';
  requester: { session: SessionRef; duty: 'executor' | 'adviser' | 'secretary' };
  reason: string;
  planVersion: { planRevision: number | null } | null;
  preferredLine: SessionRef | null;
  stopRun: RunRef | null;
  blockedBy: readonly { kind: string; reason?: string; reasonId?: string; holdKind?: string }[];
  targetLoopBlockers: 'not_read' | { blockers: readonly { kind: string; reason: string }[] };
  /** The plan the claiming Run read; only a closed card carries it. */
  claimedPlanRef: { planId: string } | null;
};
export type DecisionCardStateV1 =
  | 'waiting_answer' | 'answered_pending_application' | 'applied'
  | 'answered_no_application' | 'closed';

export type NoticeItemV1 = {
  itemKey: string; category: NoticeCategoryV1; subject: DecisionSubjectV1;
  position: NoticePositionV1; summary: string; objects: DecisionObjectV1[];
  rework: { requestedAt: string } | null;
  /** KC-1 4-10: the three knowledge kinds carry their kind; every other project notice omits it.
   * The five literals are `decision-contracts.ts:499-501`'s union, copied because `src/ui`
   * cannot import `src/core`. */
  noticeKind?: 'knowledge_write_unconfirmed' | 'knowledge_reverted' | 'knowledge_conflict'
    | 'check_approved' | 'check_to_person';
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
  capabilities: Array<{ source?: unknown; availability?: unknown }>;
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
  /** KC-1 G2: each waiting structural card's `architecture/proposal-batch-files`, by
   * cardKey; `null` is that card's failed read. Absent when the caller did not read
   * the list (the Plan page draws no structural card). */
  proposalFiles?: Record<string, readonly ProposalBatchFileV1[] | null>;
  /** X9: each knowledge notice's detail reads, by notice item key. `null` in either
   * field is that read's failure; `'not_found'` is the route's “nothing there”. */
  noticeFacts?: Record<string, KnowledgeNoticeRead>;
  /** The project's workspace names; with more than one, every file row says which. */
  workspaceNames?: Record<string, string>;
  /** Y3: the settings snapshot's checks by checkId, with their structured taskIds;
   * absent when the caller did not read the snapshot, null when that read failed. */
  checkRows?: Record<string, DecideCheckRow> | null;
  /** Y12: the raw answer bodies by cardKey, read on demand. */
  answerBodies?: Record<string, string>;
};

/** Y3: one settings check row plus the structured task list the snapshot carries
 * (never the page's `tasksText`). */
export type DecideCheckRow = SettingsCheckRow & { taskIds?: 'all' | string[] };

/** X9: one knowledge notice's two reads. `'not_found'` is the read saying there is
 * nothing (recovery items all gone, or the notice's problems gone), never a failure. */
export type KnowledgeRecoveryRead = readonly KnowledgeRecoveryItemV1[] | 'not_found' | null;
export type KnowledgeProblemsRead = readonly KnowledgeProblemV1[] | 'not_found' | null;
export type KnowledgeNoticeRead = { recovery: KnowledgeRecoveryRead; problems?: KnowledgeProblemsRead };

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
  /** Y2: the Goal the queue read was filtered to, from the URL's `?goal=` or
   * the rail; the board draws the filter and its clear control from it. */
  goalFilter: string | null;
  counts: { waitingAnswer: number; notices: number; answeredPendingApplication: number; complete: boolean };
  /** 121-146：所有页里 `read_failed` 的来源，按 capabilities 顺序去重，用中文种类词；为空时页面不写那一行。 */
  unreadable: string[];
  /** 已处理页签的行数 (`answeredPendingApplication` + `history`); 0 when not read. */
  doneTotal: number;
  card: DecideCard | null;
  task: DecideTaskFacts | null;
  /** Raw `tasks/query` per Goal, kept for the two plan writes (§2.7). */
  plans: Record<string, unknown>;
  /** The Goals whose `tasks/query` was read this round, including `not_found`
   * (absent from `plans`), so `readDecide` keeps the original 0-phase result. */
  taskGoalIds: string[];
  /** Decide's right panel: the open tab's own read (`readAuxPanel`); absent
   * when the panel is closed or the tab does not read. */
  aux?: AuxPanelData | null;
  /** The open line's record and requeue basis, through Member's own projection. */
  line?: { line: MemberLine; write: MemberWriteBasis | null } | null;
  /** The open line's read failure, as its page text; other failures still fail
   * the whole read. */
  lineError?: string | null;
  /** The on-demand answer body, by cardKey. */
  answerBodies: Record<string, string>;
  /** X9: the knowledge notices' detail rows, by notice item key (the notice's
   * `itemKey`, the same key `answerBodies` uses for cards). */
  noticeFacts: Record<string, DecideFact[]>;
};

/** One row of a card's or a notice's 详情. X9 gives a notice row a row-end write:
 * the recovery item it writes back and the words of the step that confirms it. */
export type DecideFact = {
  k: string;
  v: string;
  files?: { path: string; parts: string[] }[];
  recover?: { itemNo: number; label: string; path: string; source: string };
};

export type DecideSection = { name: '要决定' | '请知悉' | '已处理' | '已答复、待落实'; level: 'decide' | 'notice' | 'done'; rows: DecideRow[] };

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
  facts: DecideFact[];
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
  checks: { checkId: string; reportRef: ArtifactRef | null; text: string }[];
  report: string;
  fixName: string;
  /** The repair assignment role; null when no public task carries the failed Run (X2). */
  fixRole: string | null;
  ownerTaskId: string;
  instructionChecks: string;
  /** Y3: the withdrawable checks, each with the command · task count · source line. */
  withdraw: { checkId: string; text: string }[];
  /** Y14b: the card's “来自 〈line〉 · 〈range〉” line; empty for platform cards. */
  sourceLine: string;
  /** Y15: the release card's plan version is older than the Goal's current plan. */
  stale: boolean;
  /** Y11: the answer box's pure judgments, computed here so 4a shares them. */
  answerBox: boolean;
  needsOption: boolean;
  askOnly: boolean;
  /** Y11: the card's objects, each with its canonical key and Chinese label. */
  objects: { objectKey: string; label: string }[];
  /** Y1/Y3: the Task is a gate (the reverify step says 重新验收). */
  isGate: boolean;
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
  | 'requeue' | 'fix' | 'note' | 'attest' | 'answer-body'
  | 'reverify' | 'withdraw' | 'speak';

export type DecideStepKey = 'requeue' | 'fix' | 'note' | 'attest'
  | 'defer' | 'cancel' | 'restore' | 'continue' | 'recover' | 'seen' | 'reverify' | 'withdraw';
export type DecideForm = {
  reason?: string; budget?: string; name?: string; checks?: boolean[]; note?: string;
};

export type DecideTaskFacts = {
  goalId: string;
  row: unknown;
  task: unknown;
};

export const FAILURE_WORD: Record<string, string> = {
  check_failed: '检查未通过', check_incomplete: '检查不完整', run_failed: '执行失败',
  interrupted: '执行中断', cancelled: '已取消',
};

/** Y1/Y6: the five policy refusal codes as page words; the one table the facts
 * rows and the refusal sentences share. */
const REWORK_REFUSAL_WORD: Record<string, string> = {
  no_new_basis: '没有新依据',
  auto_rework_cap_reached: '已达自动返工上限',
  budget_not_increased: '预算没有加大',
  source_unchanged: '源码没有变化',
  verification_uncovered: '没有检查覆盖必需的要求',
};
export function reworkRefusalWordOf(code: string): string {
  return REWORK_REFUSAL_WORD[code] ?? '';
}

/** Y6 (a): one committed policy refusal as a sentence. `rework` is the Task
 * row's `rework` summary, read only to name the earlier requeue (`matchedRequeueRef`). */
export function reworkRefusalTextOf(
  op: 'requeue' | 'reverify', refusal: unknown, rework: unknown = null,
): string {
  const record = asRecord(refusal);
  const code = asText(record.code);
  if (op === 'requeue') {
    if (code === 'no_new_basis') {
      const after = asText(asRecord(record.matchedRequeueRef).afterRunId);
      const entries = asRecord(rework).entries;
      const index = after === '' || !Array.isArray(entries) ? -1
        : entries.findIndex((entry) => asText(asRecord(asRecord(entry).ref).afterRunId) === after);
      const nth = index < 0 ? '上次重新入队' : '第 ' + String(index + 1) + ' 次重新入队';
      return '未重新入队：没有新依据，和' + nth + '时的失败、源码、计划都一样。补一句说明，或先改文件再试。';
    }
    if (code === 'budget_not_increased') return '未重新入队：预算耗尽后要给更大的预算，或补一句说明。';
    if (code === 'auto_rework_cap_reached') return '未重新入队：已达自动返工上限。';
    return '未重新入队：' + (reworkRefusalWordOf(code) || '没有通过') + '。';
  }
  if (code === 'no_new_basis') {
    return '没有重新检查：没有新依据，失败、源码和检查配置都和上一轮一样。附上说明，或先改文件再试。';
  }
  if (code === 'source_unchanged') return '没有重新检查：源码自上一轮以来没有变化。先改文件再验收。';
  if (code === 'verification_uncovered') {
    return '没有重新检查：没有检查覆盖必需的要求。要补检查，在主对话里说，参谋会起草带新检查的计划；'
      + '你采用以后再重新检查。';
  }
  if (code === 'auto_rework_cap_reached') return '没有重新检查：已达自动返工上限。';
  return '没有重新检查：' + (reworkRefusalWordOf(code) || '没有通过') + '。';
}

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
  goal_cause: '目标原因', goal_conflict: '目标冲突',
  action_release: '放行请求', unknown_call_review: '未知结果待核对', command_rerun_request: '命令重跑',
  member_creation: '成员创建', rework_request: '返工请求', handoff_approval: '交接确认',
  adviser_creation: '参谋创建', module_maintainer_assignment: '模块维护者指派',
  repair_approval: '修复确认', structural_proposal: '结构提案', role_capacity: '容量',
  role_line_change: '工作线变更',
};

const STATE_WORD: Record<string, string> = {
  waiting_answer: '等你答复', answered_pending_application: '已答复，等落实', applied: '已落实',
  answered_no_application: '已答复', closed: '已关闭',
};

/** The card state's page word (`STATE_WORD`), shared by the two pages. */
export function cardStateWordOf(state: string): string {
  return STATE_WORD[state] ?? '';
}

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

/** §2.7: requisition's `meta.expected` takes only the Goal and this Run pin; the
 * structural card also takes its one batch pin by the same aggregate type. */
export function pinsFor(card: DecisionCardV1,
  kind: 'Goal' | 'Run' | 'ArchitectureProposalBatch'): Array<{ ref: unknown; revision: number }> {
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

export function subjectGoalId(subject: DecisionSubjectV1 | undefined): string | null {
  return subject?.kind === 'goal' ? subject.goalRef.goalId : null;
}

/** Y1: the structured task count of one snapshot check; a missing `taskIds`
 * reads as the same “n 个任务” shape, never by splitting `tasksText`. */
function checkTaskCountText(taskIds: 'all' | string[] | undefined): string {
  if (taskIds === 'all') return '全部任务';
  if (Array.isArray(taskIds)) return String(taskIds.length) + ' 个任务';
  return 'n 个任务';
}

/** Y1/Y3: one check's command and task count; a check the snapshot does not
 * carry (or a failed snapshot read) is “一条检查”, with no checkId shown. */
function checkTextOf(checkId: string, rows: Record<string, DecideCheckRow> | null | undefined): string {
  const row = rows?.[checkId];
  return row === undefined ? '一条检查' : row.command + ' · ' + checkTaskCountText(row.taskIds);
}

/** Y3: the withdrawable check's one line: command · task count · source. */
function withdrawTextOf(checkId: string, rows: Record<string, DecideCheckRow> | null | undefined): string {
  const row = rows?.[checkId];
  if (row === undefined) return '一条检查（命令暂时读不到）';
  return row.command + ' · ' + checkTaskCountText(row.taskIds) + ' · ' + row.sourceText;
}

/** Y1: one refusal fact's sentence: the stored time, who, the operation and the
 * code word; `stale` adds the owner's “can try again” note. */
function refusalFactText(refusal: unknown, operation: string): string {
  const record = asRecord(refusal);
  if (Object.keys(record).length === 0) return '没有';
  const at = asText(record.refusedAt);
  const who = ACTOR_WORD[asText(asRecord(record.requestedBy).kind)] ?? '人工';
  const code = reworkRefusalWordOf(asText(record.code)) || '没有通过';
  return (at === '' ? '' : localShortAt(at) + ' ') + who + operation + '被拒绝：' + code
    + (record.stale === true ? '（已过期，可再试）' : '');
}

/** Y1: the round's result word (the owner stores PASS/FAIL/INCONCLUSIVE). */
function roundResultWord(outcome: string): string {
  return outcome === 'PASS' ? '通过' : outcome === 'FAIL' ? '未通过'
    : outcome === 'INCONCLUSIVE' ? '不完整' : '还没有结果';
}

/** Y1: the eleven-plus failure facts from `TaskRow.failure`/`rework`/`attemptOrdinal`.
 * The first three keys and their order are the unknown-outcome step's known facts
 * (`Decide.dc.html` takes `facts.slice(0, 3)`). */
function factsOf(row: Record<string, unknown>, checkRows?: Record<string, DecideCheckRow> | null): DecideCard['facts'] {
  const failure = asRecord(row.failure);
  if (Object.keys(failure).length === 0) return [];
  const definition = asRecord(row.definition);
  const run = asRecord(failure.run);
  const round = asRecord(failure.round);
  const automation = asRecord(failure.automation);
  const verdict = asRecord(automation.verdict);
  const origin = asText(run.origin);
  const isGate = asText(definition.taskKind) === 'gate' || asText(failure.subjectKind) === 'gate';
  const attempt = isGate
    ? '验收第 ' + String(typeof round.ordinal === 'number' ? round.ordinal : 1) + ' 轮'
    : '第 ' + String(typeof row.attemptOrdinal === 'number' ? row.attemptOrdinal : 1) + ' 次尝试';
  const failureClass = asText(failure.failureClass);
  const cause = asText(failure.notReworkableCause);
  const out: DecideCard['facts'] = [];
  /* 1: the failure class; without one, the not-reworkable cause's word. */
  out.push({ k: '失败类别', v: (failureClass === '' ? '还不能归类' : FAILURE_WORD[failureClass] ?? '还不能归类')
    + (failureClass === '' && cause !== '' ? '：' + causeWordOf(cause) : '') });
  /* 2: who did it. */
  out.push({ k: '谁做的', v: origin === 'host_interrupted' ? '平台中断' : origin === 'human_attested' ? '人工认定' : '系统自动' });
  /* 3: the attempt. */
  out.push({ k: '尝试', v: attempt });
  /* 4: the latest requeue refusal. */
  out.push({ k: '最近拒绝', v: refusalFactText(automation.lastRefusal, '重新入队') });
  /* 5: the latest reverify refusal, when one exists. */
  if (Object.keys(asRecord(automation.lastReverifyRefusal)).length > 0) {
    out.push({ k: '最近重新检查被拒绝',
      v: refusalFactText(automation.lastReverifyRefusal, isGate ? '重新验收' : '重新检查') });
  }
  /* 6: the Run's outcome, budget and end time. */
  if (Object.keys(run).length > 0) {
    let text = OUTCOME_WORD[asText(run.outcome) as keyof typeof OUTCOME_WORD] ?? '';
    const budget = asRecord(run.budget).tokenBudget;
    if (typeof budget === 'number') text += ' · 预算 ' + String(Math.round(budget / 1000)) + 'K';
    const endedAt = asText(run.endedAt);
    if (endedAt !== '') text += ' · ' + localShortAt(endedAt) + ' 结束';
    out.push({ k: '执行', v: text });
  }
  /* 7: who paused or cancelled the execution. */
  const stop = asRecord(failure.stop);
  if (Object.keys(stop).length > 0) {
    const requester = asText(stop.requester);
    const who = requester === 'human' ? '你' : requester === 'goal_fan_out' ? '目标暂停或取消时一起'
      : '平台';
    out.push({ k: '停止', v: who + (asText(stop.kind) === 'cancel' ? '取消了这次执行' : '暂停了这次执行') });
  }
  /* 8: the chain head and the failed checks, from the snapshot's own taskIds. */
  if (Object.keys(round).length > 0) {
    let text = '第 ' + String(typeof round.ordinal === 'number' ? round.ordinal : 1) + ' 轮 · '
      + roundResultWord(asText(round.outcome));
    const failing = Array.isArray(round.failingChecks) ? round.failingChecks.map((entry) => asRecord(entry)) : [];
    if (failing.length > 0) {
      text += ' · 没过：' + failing.map((entry) => checkTextOf(asText(entry.checkId), checkRows)).join('、');
    }
    const gaps = Array.isArray(round.gapCodes) ? round.gapCodes.map((code) => asText(code)) : [];
    if (gaps.length > 0) text += ' · 缺项：' + gapTextOf(gaps);
    out.push({ k: '检查', v: text });
  }
  /* 9: whether the source changed after the failure. */
  const sinceFailure = asText(asRecord(failure.source).sinceFailure);
  if (sinceFailure === 'changed' || sinceFailure === 'unchanged') {
    out.push({ k: '源码', v: sinceFailure === 'changed' ? '失败以后改过' : '失败以后没改过' });
  }
  /* 10: the counted automatic rework and its cap; a reverify counts the round chain. */
  if (typeof automation.cap === 'number') {
    const n = asText(asRecord(verdict.detail).operation) === 'reverify'
      ? Number(round.autoCount ?? 0) : Number(automation.requeueAutoCount ?? 0);
    const stopped = asText(verdict.kind) === 'stopped' && asText(verdict.reason) === 'auto_rework_cap_reached';
    out.push({ k: '自动返工', v: String(n) + '/' + String(automation.cap)
      + (stopped ? '（上限是当前设置，调高会立刻解除停止）' : '') });
  }
  /* 11: the owner's automation verdict, never “正在执行”. */
  const kind = asText(verdict.kind);
  if (kind !== 'none' && kind !== 'stopped' && kind !== '') {
    let text = '';
    if (kind === 'requeue') text = '待自动返工（' + (FAILURE_WORD[asText(verdict.failureClass)] ?? '还不能归类') + '）';
    else if (kind === 'claim_requeued') text = '已重新入队，等待领取';
    else if (kind === 'reverify') text = '待自动重新检查';
    if (text !== '' && verdict.retryAfterRefusal === true) text += '；拒绝已过期，将重试一次';
    if (text !== '') out.push({ k: '判定', v: text });
  }
  /* 12…: one row per rework history line. */
  for (const line of reworkLines(row.rework)) out.push({ k: '返工', v: line });
  /* 末: the one exit when no check covers the requirement. */
  const stopReason = kind === 'stopped' ? asText(verdict.reason) : '';
  const lastReverify = asRecord(automation.lastReverifyRefusal);
  if (stopReason === 'verification_uncovered'
    || (asText(lastReverify.code) === 'verification_uncovered' && lastReverify.stale !== true)) {
    out.push({ k: '出路', v: '要补检查，在主对话里说，参谋会起草带新检查的计划' });
  }
  return out;
}

/** Y11: the four sources D103-1 names as “must pick an option”; the page sends
 * text-only answers for these through the secretary, never `decisions/answer`.
 * Copied as literals because `src/ui` cannot import `src/core`. */
const ASK_ONLY_SOURCES: readonly string[] = ['member_creation', 'rework_request', 'handoff_approval', 'adviser_creation'];

/** Y11: the answer box's one judgment, shared with 4a. Not read-only, the card
 * accepts an answer, and its source is neither a stop card nor a plan candidate. */
export function hasAnswerBox(card: DecisionCardV1): boolean {
  return !card.readOnly && card.actions.includes('answer')
    && card.source.kind !== 'goal_cause' && card.source.kind !== 'candidate';
}

/* Y7: the source kinds the server's `OPTION_REQUIRED_SOURCE_KINDS` refuses a
 * text-only answer for (`decision-service.ts:503-513`); copied as literals
 * because `src/ui` cannot import `src/core`. A conflict card must pick one of
 * its three choices as well. */
const OPTION_REQUIRED_SOURCE_KINDS: readonly string[] = ['action_release', 'unknown_call_review', 'member_creation',
  'rework_request', 'handoff_approval', 'adviser_creation', 'module_maintainer_assignment', 'repair_approval',
  'structural_proposal', 'role_capacity', 'role_line_change'];

/** Y11: whether the card's choices must be shown and, for a conflict card,
 * picked. The server's own set decides: a planning question that carries
 * options still accepts a text-only answer. */
export function needsOption(card: DecisionCardV1): boolean {
  return card.source.kind === 'goal_conflict' || OPTION_REQUIRED_SOURCE_KINDS.includes(card.source.kind);
}

/** Y11: the object's canonical key, the same JSON the owner compares. */
export function objectKeyOf(object: DecisionObjectV1): string {
  /* The owner compares the same JSON value; the clone drops the UI's readonly
     wrapper so the canonical encoder sees plain JSON. */
  const plain = JSON.parse(JSON.stringify(object)) as JsonValue;
  return canonicalJson(plain);
}

/** Y11: one object's Chinese label; unrecognised English labels fall back to the
 * pin's aggregate type, never the owner's raw word. */
export function objectLabelOf(object: DecisionObjectV1, taskName: string): string {
  const record = asRecord(object);
  if (asText(record.kind) === 'file') {
    return asText(record.label) || asText(record.path);
  }
  const raw = asText(record.label);
  if (raw === 'task') return taskName === '' ? '任务' : taskName;
  if (raw === 'rework request' || raw === 'rework_request') return '返工请求';
  if (raw === 'candidate') return '计划候选';
  if (raw !== '' && !/^[\x20-\x7e]*$/.test(raw)) return raw;
  const aggregate = asText(asRecord(asRecord(record.pin).ref).aggregateType);
  const word = ({ Goal: '目标', Task: '任务', Run: '运行', Workspace: '工作区',
    Project: '项目', Session: '会话', VerificationRound: '检查' } as Record<string, string>)[aggregate];
  return word ?? '一个对象';
}

/** Y12: an answer body's page view: the person's own words as the line and the
 * annotations as detail rows. Unparseable/other bodies keep their raw text. */
export function answerBodyViewOf(
  body: string, objects: readonly DecisionObjectV1[],
): { line: string; facts: DecideCard['facts'] } {
  const parse = (text: string): unknown => {
    try { return JSON.parse(text); } catch { return null; }
  };
  let record = asRecord(parse(body));
  /* A message card's body is the session-message envelope; its `text` is the
     canonical answer JSON (`message-body-envelope.ts:45-47`). */
  if (asText(record.kind) !== 'user_decision_response' && asText(record.text) !== '') {
    record = asRecord(parse(asText(record.text)));
  }
  if (asText(record.kind) !== 'user_decision_response') return { line: body, facts: [] };
  const text = asText(record.text);
  const byKey = new Map(objects.map((object) => [objectKeyOf(object), objectLabelOf(object, '')]));
  const annotations = Array.isArray(record.annotations) ? record.annotations.map((entry) => asRecord(entry)) : [];
  const facts = annotations.map((annotation) => {
    const key = asText(annotation.objectKey);
    return { k: '批注', v: (byKey.get(key) ?? '一个对象') + '：' + asText(annotation.text) };
  });
  return { line: text === '' ? '' : '你的话：' + text, facts };
}

/** Y14b: “来自 〈line〉 · 〈range〉” for a platform card; a platform card with no
 * sender line shows nothing. A line outside this page's rail is “其他工作线”. */
export function cardFromOf(card: DecisionCardV1, nav: NavData): string {
  const ref = card.senderSessionRef;
  if (ref === null || ref === undefined) return '';
  const session = sessionRefAtEdge(ref);
  const line = lineNameOfSession(nav.lines, session) || lineNameOfSession(nav.archived, session) || '其他工作线';
  const subject = asRecord(card.subject);
  let range = '';
  if (asText(subject.kind) === 'goal') {
    const goalId = asText(asRecord(subject.goalRef).goalId);
    const goal = nav.goals.find((entry) => entry.goalId === goalId);
    range = goal === undefined ? '这个目标'
      : '目标 ' + String(goal.ordinal ?? '') + '「' + goal.objective + '」';
  } else if (asText(subject.kind) === 'project') {
    range = '项目';
  }
  return range === '' ? '' : '来自 ' + line + ' · ' + range;
}

/** Y11/M9: one answerable card's empty reply state, the one Decide and the main
 * card share. The object keys and labels are the same ones `makeView` gives the
 * card; a conflict card takes only its words, never annotation fields, because
 * the server refuses an annotation on it (`objects` is empty in the answer source). */
export type DecideCardReply = {
  hasAnswerBox: boolean;
  needsOption: boolean;
  note: string;
  annotations: { objectKey: string; label: string; text: string }[];
  busy: boolean;
  error: string;
};

export function cardReplyOf(card: DecisionCardV1, taskName = ''): DecideCardReply {
  return {
    hasAnswerBox: hasAnswerBox(card),
    needsOption: needsOption(card),
    note: '',
    annotations: card.source.kind === 'goal_conflict' ? [] : card.objects.map((object) => ({
      objectKey: objectKeyOf(object), label: objectLabelOf(object, taskName), text: '',
    })),
    busy: false,
    error: '',
  };
}

/** KC-1 G2/X9: who last wrote a knowledge file, the one file-source word both the
 * proposal card's file list and a conflict notice's place use. */
const FILE_SOURCE_WORD: Record<KnowledgeFileSourceV1, string> = {
  platform: '平台写的', committed: '已提交', uncommitted: '未提交',
};

/** X9: a recovery item's kind as the notice detail's key. */
const RECOVERY_WORD: Record<KnowledgeRecoveryItemV1['kind'], string> = {
  reverted: '被撤回', write_unconfirmed: '没确认落盘', unreadable: '读不出',
};

/** X9: a conflict notice place's kind as the notice detail's key (contracts/knowledge.ts:37-38). */
const PROBLEM_WORD: Record<KnowledgeProblemKindV1, string> = {
  bad_file: '读不出', duplicate_module_id: '模块号重了',
  path_claimed_by_two_modules: '两个模块认领同一路径',
  dangling_reference: '引用了不存在的模块', module_without_file: '缺模块文件',
  unreachable: '走不到', partial_contains: '包含不全', cycle: '依赖成环',
  project_merge: '几个工作区合不起来', other: '其他',
};

/** KC-2 121-106 ④: where a bad file's recovery takes its bytes; the button says “用 …”
 * and the step's “写回” sentence names the same place without it. */
function recoverySourceWords(source: KnowledgeRecoverySourceV1): { button: string; step: string } {
  if (source.source === 'snapshot') {
    const at = localShortAt(source.takenAt);
    return { button: '用 ' + at + ' 的快照', step: ' ' + at + ' 快照里的版本' };
  }
  if (source.source === 'head') {
    const at = localShortAt(source.takenAt);
    return { button: '用上次提交（' + at + '）的版本', step: '上次提交（' + at + '）的版本' };
  }
  return { button: '用平台记录的版本', step: '平台记录的版本' };
}

/** One path's directory parts; the only split of a shown path in this file. Each
 * part keeps its trailing slash the way the board's own `pathParts` draws it. */
function filePartsOf(path: string): string[] {
  const parts = path.split('/');
  return parts.map((part, index) => (index < parts.length - 1 ? part + '/' : part));
}

/**
 * X9 (121-106 ④): one knowledge notice's 详情. A reverted or unconfirmed notice
 * lists every remaining recovery item as one 被撤回/没确认落盘 row with its path
 * and one 恢复 button; once the items read says there is nothing, its one row
 * says the files are all restored. A conflict notice lists every place instead
 * (its kind word, the backend's own Chinese reason, then each file's writer): a
 * place with a `recovery` source gets its button only while the same `itemNo` is
 * still an `unreadable` recovery item; after the recovery the place stays and
 * ends "已恢复". A conflict never says "都已恢复" (double claims, dangling refs
 * and the like have no recovery item at all). Any failed read is this notice's
 * one "暂时读不到" row, never a throw.
 */
export function knowledgeNoticeFactsOf(
  noticeKind: string | undefined,
  read: KnowledgeNoticeRead,
): DecideFact[] {
  if (noticeKind !== 'knowledge_reverted' && noticeKind !== 'knowledge_write_unconfirmed'
    && noticeKind !== 'knowledge_conflict') return [];
  if (noticeKind !== 'knowledge_conflict') {
    if (read.recovery === null) return [{ k: '恢复', v: '暂时读不到' }];
    if (read.recovery === 'not_found') return [{ k: '恢复', v: '这条通知里的文件都已恢复' }];
    const source = noticeKind === 'knowledge_reverted' ? '被撤回之前的版本' : '平台当时要写的内容';
    return read.recovery.map((item) => ({
      k: RECOVERY_WORD[item.kind],
      v: '',
      files: [{ path: item.path, parts: filePartsOf(item.path) }],
      recover: { itemNo: item.itemNo, label: '恢复', path: item.path, source },
    }));
  }
  if (read.problems === undefined || read.problems === null || read.recovery === null) {
    return [{ k: '问题', v: '暂时读不到' }];
  }
  if (read.problems === 'not_found') return [{ k: '问题', v: '这条通知里的问题已经没有了' }];
  const items = read.recovery === 'not_found' ? [] : read.recovery;
  return read.problems.map((problem): DecideFact => {
    const places = problem.files.map((file) => file.path + ' ' + FILE_SOURCE_WORD[file.source]).join('；');
    const v = problem.reason + (places === '' ? '' : '（' + places + '）');
    const source = problem.recovery;
    const path = problem.files[0]?.path ?? '';
    if (source === undefined || path === '') return { k: PROBLEM_WORD[problem.kind], v };
    const item = items.find((entry) => entry.itemNo === problem.itemNo && entry.kind === 'unreadable');
    if (item === undefined) return { k: PROBLEM_WORD[problem.kind], v: v + '已恢复' };
    const words = recoverySourceWords(source);
    return { k: PROBLEM_WORD[problem.kind], v,
      recover: { itemNo: problem.itemNo, label: '恢复（' + words.button + '）', path, source: words.step } };
  });
}

/**
 * §2.3 (KC-1 G2): the structural proposal card's file list. The backend's
 * read-only trial already names each file's action and writer; this only groups
 * the rows the page draws. A `willRevert` file appears once, in 会改回, because
 * approving would overwrite the person's own bytes (ruling 4-9, user 问 3 甲).
 * Paths are relative to their own workspace, so a project with more than one
 * workspace prefixes every row's value (and a nameless new module's id is the
 * module's own frame, `rawModuleId`).
 */
export function proposalFileFactsOf(
  files: readonly ProposalBatchFileV1[] | null,
  workspaceNames: Record<string, string>,
): DecideCard['facts'] {
  if (files === null) return [{ k: '会改的文件', v: '暂时读不到' }];
  const byWorkspace = new Map<string, ProposalBatchFileV1[]>();
  for (const file of files) {
    const rows = byWorkspace.get(file.workspaceId);
    if (rows === undefined) byWorkspace.set(file.workspaceId, [file]);
    else rows.push(file);
  }
  const multiWorkspace = Object.keys(workspaceNames).length > 1;
  const proposalFileParts = (rows: readonly ProposalBatchFileV1[]): { path: string; parts: string[] }[] =>
    rows.flatMap((file) => file.path === null ? [] : [{ path: file.path, parts: filePartsOf(file.path) }]);
  const out: DecideCard['facts'] = [];
  for (const [workspaceId, rows] of byWorkspace) {
    const name = workspaceNames[workspaceId] ?? '';
    const prefix = multiWorkspace && name !== '' ? name + '：' : '';
    const revert = rows.filter((file) => file.willRevert);
    if (revert.length > 0) {
      out.push({ k: '会改回', v: prefix + '批准后会改回平台记录的版本，你在这个文件里的改动会被盖掉',
        files: proposalFileParts(revert) });
    }
    for (const file of rows) {
      if (file.willRevert || file.action !== 'create' || file.path !== null) continue;
      const moduleId = file.moduleId === null ? '' : rawModuleId(file.moduleId).moduleId;
      out.push({ k: '会新建', v: prefix + '新模块 ' + moduleId + ' 的文件，批准时定名' });
    }
    const creates = rows.filter((file) => !file.willRevert && file.action === 'create' && file.path !== null);
    if (creates.length > 0) out.push({ k: '会新建', v: prefix, files: proposalFileParts(creates) });
    for (const action of ['modify', 'delete'] as const) {
      const word = action === 'modify' ? '会修改' : '会删除';
      for (const source of ['platform', 'committed', 'uncommitted'] as const) {
        const subset = rows.filter((file) => !file.willRevert && file.action === action && file.source === source);
        if (subset.length > 0) out.push({ k: word, v: prefix + FILE_SOURCE_WORD[source], files: proposalFileParts(subset) });
      }
    }
  }
  return out;
}

/**
 * §2.8: the release card's facts. Each fact is conditioned on its own field, so
 * a stop card never asks for a plan version or a preferred line, and a waiting
 * card never shows the claimed plan. The read projection supplies the live
 * blockers; when it says `not_read`, that fact is not invented here.
 */
function actionReleaseFactsOf(
  card: DecisionCardV1, nav: NavData, taskName: string, currentPlan: unknown,
  taskRow: Record<string, unknown> | null,
): DecideCard['facts'] {
  const view = asRecord(card.actionRelease);
  if (Object.keys(view).length === 0) return [];
  const out: DecideCard['facts'] = [];
  const action = asText(view.action);
  if (action === 'dispatch') out.push({ k: '动作', v: '派活' });
  else if (action === 'stop') out.push({ k: '动作', v: '叫停' });
  if (taskName !== '') out.push({ k: '任务', v: taskName });
  const requester = asRecord(view.requester);
  const duty = asText(requester.duty);
  const who = lineNameOfSession(nav.lines, sessionRefAtEdge(requester.session))
    || (duty === '' ? '' : dutyWordOf(duty));
  if (who !== '') out.push({ k: '谁要', v: who });
  const reason = asText(view.reason);
  if (reason !== '') out.push({ k: '理由', v: reason });
  const planVersion = asRecord(view.planVersion);
  if (Object.keys(planVersion).length > 0) {
    out.push({ k: '请求时的计划版本', v: planVersionText(
      typeof planVersion.planRevision === 'number' ? planVersion.planRevision : null) });
  }
  const blocked = Array.isArray(view.blockedBy) ? view.blockedBy.map((entry) => asRecord(entry)) : [];
  const target = view.targetLoopBlockers;
  const targetSupplied = target !== undefined && target !== null && target !== 'not_read';
  const targetBlockers = targetSupplied && Array.isArray(asRecord(target).blockers)
    ? (asRecord(target).blockers as unknown[]).map((entry) => asRecord(entry)) : [];
  if (blocked.length > 0 || targetSupplied) {
    const parts = [...blocked, ...targetBlockers].map(blockerTextOf).filter((text) => text !== '');
    out.push({ k: '当前阻塞', v: parts.length === 0 ? '没有' : parts.join('；') });
  }
  const preferred = asRecord(view.preferredLine);
  if (Object.keys(preferred).length > 0) {
    const name = lineNameOfSession(nav.lines, sessionRefAtEdge(preferred));
    if (name !== '') out.push({ k: '首选线', v: name });
  }
  const stopRun = asRecord(view.stopRun);
  if (Object.keys(stopRun).length > 0) {
    const runId = asText(stopRun.runId);
    if (runId !== '') out.push({ k: '要停的运行', v: stopRunText(stopRun, taskRow) });
  }
  const claimed = asRecord(view.claimedPlanRef);
  if (Object.keys(claimed).length > 0) {
    const planId = asText(claimed.planId);
    if (planId !== '') out.push({ k: '领取时用的计划', v: planRefText(planId, currentPlan) });
  }
  return out;
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

function actsOf(
  card: DecisionCardV1, row: Record<string, unknown> | null, conflict: boolean,
  files: { path: string; parts: string[] }[],
): DecideAct[] {
  const out: DecideAct[] = [];
  const add = (key: DecideActionKey, label: string, step: DecideStepKey | null, primary: boolean,
    extra: Partial<DecideAct> = {}): DecideAct => {
    const act: DecideAct = { key, label, step, primary, cls: 'btn btn-sm btn-line' + (extra.off === 'true' ? ' is-off' : ''),
      off: 'false', tip: '', ...extra };
    out.push(act);
    return act;
  };
  const markPrimary = (key: DecideActionKey): void => {
    for (const act of out) act.primary = act.key === key;
  };
  if (card.readOnly) return out;
  if (conflict) {
    const names = files.map((file) => file.path.slice(file.path.lastIndexOf('/') + 1));
    const shown = names.slice(0, 3).join('、') + (names.length > 3 ? ' 等 ' + names.length + ' 个文件' : '');
    add('locate', '在架构图里看', null, false, { tip: '在架构图里点亮 ' + shown });
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
    const failure = asRecord(row.failure);
    const stop = stopOf(row);
    const disposition = asText(row.disposition);
    const inactive = disposition === 'deferred' || disposition === 'cancelled' || disposition === 'superseded';
    const gate = asText(asRecord(row.definition).taskKind) === 'gate' || asText(failure.subjectKind) === 'gate';
    const actors = (value: unknown): string[] => Array.isArray(value) ? value.map((entry) => asText(entry)) : [];
    const rq = actors(failure.requeueActors).includes('human');
    const rv = actors(failure.reverifyActors).includes('human') && Object.keys(asRecord(failure.round)).length > 0;
    const withdrawable = Array.isArray(card.withdrawableChecks) && card.withdrawableChecks.length > 0;
    const W = withdrawable && rv;
    const reverifyLabel = gate ? '重新验收' : '重新检查';
    const reverifyAct = (): DecideAct => add('reverify', reverifyLabel, 'reverify', false);
    const withdrawAct = (): DecideAct => add('withdraw', '撤回这些检查并重新检查', 'withdraw', false);
    if (interrupted) {
      /* The cause itself supplies the action; the Task row only adds the
         disposition actions below. */
    } else if (stop === 'auto_rework_cap_reached') {
      if (!gate) add('defer', '延后任务', 'defer', false);
      add('fix', '添加修复任务', 'fix', false);
      if (rv && asText(asRecord(asRecord(asRecord(asRecord(row.failure).automation).verdict).detail).operation) === 'reverify') reverifyAct();
      if (W) withdrawAct();
      if (rq) add('requeue', '重新入队', 'requeue', false);
      markPrimary(rq ? 'requeue' : W ? 'withdraw' : rv ? 'reverify' : 'fix');
    } else if (stop === 'no_new_basis') {
      if (!gate) add('defer', '延后任务', 'defer', false);
      if (rq) add('requeue', '重新入队', 'requeue', false);
      if (rv) add('note', '附上说明作为新依据', 'note', false);
      if (W) withdrawAct();
      markPrimary(W ? 'withdraw' : rv ? 'note' : rq ? 'requeue' : 'defer');
    } else if (stop === 'unknown_outcome') {
      add('attest', '核对未知结果', 'attest', true);
    } else if (stop === 'gate_needs_fix') {
      add('fix', '添加修复任务', 'fix', true);
    } else if (stop === 'verification_uncovered') {
      add('speak', '去主对话说', null, true);
    } else if (stop === 'budget_exhausted') {
      if (!gate) {
        add('defer', '延后任务', 'defer', false);
        add('cancel', '取消任务', 'cancel', false);
      }
      if (rq) add('requeue', '重新入队', 'requeue', true);
    } else if (stop === 'task_paused') {
      add('cancel', '取消任务', 'cancel', false);
      add('continue', '继续', null, true);
    } else if (stop === 'task_cancelled' || stop === 'continuation_cancelled') {
      add('restore', '恢复任务', 'restore', true);
    } else if (taskTripleOf(card) !== null && card.runRef !== null && rq) {
      add('requeue', '重新入队', 'requeue', true);
    }
    /* Y2/Y8: a gate's disposition is never changed; an inactive Task keeps only
       its disposition actions (E3 :242). */
    if (!gate && !interrupted) {
      if (inactive) {
        out.splice(0, out.length);
        if (disposition === 'deferred') {
          add('restore', '恢复任务', 'restore', true);
          add('cancel', '取消任务', 'cancel', false);
        } else if (disposition === 'cancelled') {
          add('restore', '恢复任务', 'restore', true);
        }
      } else {
        const hasAct = (key: DecideActionKey): boolean => out.some((act) => act.key === key);
        if (!hasAct('defer')) add('defer', '延后任务', 'defer', false);
        if (!hasAct('cancel')) add('cancel', '取消任务', 'cancel', false);
      }
    }
    /* Y4: while a fresh `verification_uncovered` refusal stands, both the
       reverify and the withdraw would be refused again; stale restores them. */
    const lastReverify = asRecord(asRecord(failure.automation).lastReverifyRefusal);
    if (asText(lastReverify.code) === 'verification_uncovered' && lastReverify.stale !== true) {
      const tip = '没有检查覆盖这条要求，再点也会被拒；先按详情里的出路加检查';
      for (const act of out) {
        if (act.key !== 'reverify' && act.key !== 'withdraw') continue;
        act.off = 'true';
        act.tip = tip;
        act.cls += ' is-off';
      }
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
  card: DecisionCardV1; nav: NavData; level: DecideRow['level']; key: string; label: string; title: string;
  path: string; state: string; goalId: string; ordinal: number | null; taskRef: TaskTriple | null;
  goalName: string; taskName: string; taskRow: Record<string, unknown> | null;
  plan: unknown; pins: Array<{ ref: unknown; revision: number }>; files: { path: string; parts: string[] }[];
  proposalFiles?: readonly ProposalBatchFileV1[] | null;
  workspaceNames: Record<string, string>;
  checkRows?: Record<string, DecideCheckRow> | null;
  answerBody?: string;
}): DecideCard {
  const { card, taskRow } = args;
  const files = args.files;
  const failure = taskRow === null ? {} : asRecord(taskRow.failure);
  const round = asRecord(failure.round);
  const failingChecks = Array.isArray(round.failingChecks) ? round.failingChecks.map((entry) => asRecord(entry)) : [];
  const conflict = card.source.kind === 'goal_conflict';
  const acts = actsOf(card, taskRow, conflict, files);
  const primary = acts.find((act) => act.primary) ?? null;
  const runRef = card.runRef;
  const failureRun = (failure.runRef ?? runRef) as RunRef | null;
  const owner = taskRow === null ? null : ownerTaskOf(taskRowsOf(args.plan), failureRun);
  const ownerTaskId = owner === null ? '' : taskIdOf(owner);
  const fixRole = ownerTaskId === '' ? null : roleOf(args.plan, ownerTaskId);
  const checks = failingChecks.map((entry) => ({
    checkId: asText(entry.checkId), reportRef: (entry.reportRef ?? null) as ArtifactRef | null,
    text: checkTextOf(asText(entry.checkId), args.checkRows),
  }));
  const roundOrdinal = typeof round.ordinal === 'number' ? round.ordinal : 1;
  const isGate = asText(asRecord(taskRow?.definition).taskKind) === 'gate' || asText(failure.subjectKind) === 'gate';
  /* §2.8: the release card's own words, only when its request view is present. */
  const release = card.actionRelease === undefined ? null : card.actionRelease;
  const options = card.options.map((option) => ({
    id: option.id,
    label: release === null ? option.label
      : option.id === 'approve' ? '批准' : option.id === 'deny' ? '拒绝' : option.label,
    effect: option.effect,
  }));
  const actionFacts = release === null ? [] : actionReleaseFactsOf(card, args.nav, args.taskName,
    asRecord(args.plan).plan, taskRow);
  const answer = card.answer === null ? null : {
    selection: selectionWord(card.answer.decision.selection, options),
    respondedAt: typeof card.answer.respondedAt === 'string' ? card.answer.respondedAt : null,
    bodyRef: (card.answer.bodyRef ?? null) as ArtifactRef | null,
    application: card.state === 'applied' ? 'applied' as const
      : card.state === 'answered_pending_application' ? 'pending' as const : null,
  };
  const title = cardTitleOf(card, args.title);
  const withdraw = (card.withdrawableChecks ?? []).map((checkId) => ({
    checkId, text: withdrawTextOf(checkId, args.checkRows),
  }));
  const sourceLine = cardFromOf(card, args.nav);
  /* One reply state, shared with 4a: the card's own judgments and object keys. */
  const reply = cardReplyOf(card, args.taskName);
  const answerBox = reply.hasAnswerBox;
  const optionNeeded = reply.needsOption;
  const objects = reply.annotations.map(({ objectKey, label }) => ({ objectKey, label }));
  const currentPlanRevision = asRecord(asRecord(args.plan).plan ?? args.plan).planRevision;
  const requestedPlanRevision = asRecord(release?.planVersion).planRevision;
  const stale = typeof requestedPlanRevision === 'number' && typeof currentPlanRevision === 'number'
    && requestedPlanRevision !== currentPlanRevision;
  if (stale) {
    const fact = actionFacts.find((entry) => entry.k === '请求时的计划版本');
    if (fact !== undefined) {
      fact.v += '（已过期：现在是计划第 ' + String(currentPlanRevision) + ' 版）';
    }
  }
  const body = args.answerBody === undefined ? null : answerBodyViewOf(args.answerBody, card.objects);
  const baseLine = answer !== null ? answer.selection + (answer.application === 'pending' ? '；等落实' : answer.application === 'applied' ? '；已落实' : '') : sourceLine;
  const factsBase = args.proposalFiles !== undefined ? proposalFileFactsOf(args.proposalFiles, args.workspaceNames)
    : release !== null ? actionFacts
      : taskRow !== null ? factsOf(taskRow, args.checkRows)
        : conflict ? [{ k: '重叠文件', v: '', files }] : [];
  return {
    key: args.key,
    source: card.source,
    level: args.level,
    state: card.state,
    title,
    line: body !== null && body.line !== '' ? body.line : baseLine,
    path: args.path,
    position: '',
    facts: body === null ? factsBase : [...factsBase, ...body.facts],
    options,
    actions: [...new Set([
      ...(answerBox ? ['answer' as const] : []),
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
    withdraw,
    sourceLine,
    stale,
    answerBox,
    needsOption: optionNeeded,
    askOnly: ASK_ONLY_SOURCES.includes(card.source.kind),
    objects,
    isGate,
    budget: taskRow === null ? null : budgetOfRow(taskRow),
    reasonLabel: '原因（必填；只记在记录里，不算新依据）',
    reasonPh: '例如：先把状态字段接上，再补测试',
    notePh: '例如：报告改写到 reports/e2e/ 下了，检查配置里已经登记新路径',
    cancelText: '取消后它不再画在任务图里，只在目标详情里计数；执行和检查记录都保留，之后可以恢复。',
    after: (isGate ? '自动重新验收“' : '自动重新检查“') + args.taskName + '”',
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
  /* X9: one table for the knowledge notices' details, keyed by the notice's own
     item key (like `answerBodies`); a read that did not happen leaves no entry. */
  const noticeFacts: Record<string, DecideFact[]> = {};
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
      .map((object) => ({ path: asText(object.path), parts: filePartsOf(asText(object.path)) }));
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
      ? card.state === 'closed'
        ? card.closedReason === 'source_resolved' ? '已关闭：来源已解决'
          : card.closedReason === 'goal_cancelled' ? '已关闭：目标已取消' : '已关闭'
        : answerWord + (card.state === 'applied' ? '；已落实' : '')
      : conflict
        ? '都要改 ' + files.map((file) => file.path).join('、')
        : card.source.kind === 'goal_cause'
          ? nameOf(goalId) + (taskName === '' ? '' : ' / ' + taskName)
          : STATE_WORD[card.state] ?? card.state;
    const path = '目标 ' + String(ordinal ?? '') + (taskName === '' ? ' / ' + nameOf(goalId) : ' / ' + taskName);
    const time = timeOf(level === 'done'
      ? card.answer?.respondedAt ?? card.openedAt : card.openedAt);
    const proposalFiles = card.source.kind === 'structural_proposal'
      ? source.proposalFiles?.[card.cardKey] : undefined;
    const view = makeView({
      card, nav: source.nav, level, key: card.cardKey, label, title: label, path, state,
      goalId: goalId ?? '', ordinal, goalName: nameOf(goalId), taskName, taskRow, taskRef: triple,
      plan: taskGoalId === null ? null : source.tasks[taskGoalId] ?? null, pins, files,
      ...(proposalFiles === undefined ? {} : { proposalFiles }), workspaceNames: source.workspaceNames ?? {},
      ...(source.checkRows === undefined ? {} : { checkRows: source.checkRows }),
      ...(source.answerBodies?.[card.cardKey] === undefined ? {} : { answerBody: source.answerBodies[card.cardKey] }),
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
    const detail = source.noticeFacts?.[notice.itemKey];
    if (detail !== undefined) noticeFacts[notice.itemKey] = knowledgeNoticeFactsOf(notice.noticeKind, detail);
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
  /* 121-146/U1：所有页里读失败的来源；`note_review` 既是卡又是通知，这一行只写“注记”。 */
  const unreadable: string[] = [];
  for (const page of source.queue) {
    for (const row of page.capabilities) {
      if (row.availability !== 'read_failed') continue;
      const kind = asText(row.source);
      const word = kind === 'note_review' ? CATEGORY_WORD.note_review! : KIND_WORD[kind] ?? kind;
      if (!unreadable.includes(word)) unreadable.push(word);
    }
  }
  const counts = {
    waitingAnswer: typeof asRecord(first?.counts).waitingAnswer === 'number' ? asRecord(first?.counts).waitingAnswer as number : 0,
    notices: noticesN,
    answeredPendingApplication: typeof asRecord(first?.counts).answeredPendingApplication === 'number'
      ? asRecord(first?.counts).answeredPendingApplication as number : 0,
    /* 121-146/U2：和“至少”同一个判断，看所有页；不再取 `countsComplete`（它在真实 Host 上永远为 false）。 */
    complete: !source.queue.some((page) => decisionCardCountPartial(page)),
  };
  const plans: Record<string, unknown> = {};
  for (const [goalId, value] of Object.entries(source.tasks)) {
    if (value !== null) plans[goalId] = value;
  }
  const answerBodies: Record<string, string> = source.answerBodies ?? {};
  const pendingApplication = done.filter((row) => row.card?.state === 'answered_pending_application');
  const processed = done.filter((row) => row.card?.state !== 'answered_pending_application');
  const sections: DecideSection[] = ui.tab === 'done'
    ? [
      ...(pendingApplication.length > 0
        ? [{ name: '已答复、待落实' as const, level: 'done' as const, rows: pendingApplication }] : []),
      ...(processed.length > 0 ? [{ name: '已处理' as const, level: 'done' as const, rows: processed }] : []),
    ]
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
    goalFilter: ui.goalFilter,
    counts,
    unreadable,
    doneTotal: done.length,
    card: selectedRow?.view ?? null,
    task: goalId === null || selectedTask === null ? null
      : { goalId, row: selectedTask, task: selectedTaskRow },
    plans,
    taskGoalIds: Object.keys(source.tasks),
    answerBodies,
    noticeFacts,
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
    /* E3 :242: restore, defer and cancel all clear the Task's replacedByTaskId;
       copying the old one back would be rejected. */
    const { replacedByTaskId: _replaced, ...rest } = row;
    void _replaced;
    return { ...rest, disposition: change.disposition };
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

