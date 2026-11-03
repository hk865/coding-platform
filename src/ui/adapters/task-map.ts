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
import { revisionAssignments } from '../../contracts/plan.js';
import { asRecord, asText } from '../values.js';

/** Ruling item 1: a Goal with no adopted Plan shows this empty text. */
export const NO_PLAN_TEXT = '这个目标还没有采用的计划。';

export type GoalDisplayPhaseCode =
  | 'PLANNING' | 'RUNNING' | 'CHANGE_PENDING' | 'NEEDS_DECISION' | 'BLOCKED' | 'FAILED'
  | 'PAUSED' | 'CANCELLED' | 'COMPLETED' | 'ACCEPTED_PARTIAL';

/** The unwrapped `ReadResult<GoalDetail>` value (ruling item 3: boot unwraps). */
export type TaskMapGoalRead = { goal: { ref: { goalId: string }; objective: string } };

/** The unwrapped `ReadResult<GoalDisplayRead>` value. */
export type TaskMapDisplayRead = { display: { phase: GoalDisplayPhaseCode } };

/** The unwrapped `ReadResult<TaskGraph>` value; rows stay at the JSON boundary. */
export type TaskMapGraphRead = {
  plan: { ref?: unknown; stages: unknown[]; obligations?: unknown[]; executionDag: { dependsOn: unknown[] } };
  tasks: unknown[];
};

/** The two route replies read on every notification with the base four. */
export type TaskMapHoverRead = { groups?: unknown[]; tasks?: unknown[] };
export type TaskMapLineRead = { counts?: { working?: unknown }; rows?: unknown[] };
export type TaskMapExtraReads = { hover?: TaskMapHoverRead | null; lines?: TaskMapLineRead | null };

export type TaskMapTask = {
  id: string; stageId: string | null; name: string; st: string; why: string;
  deps: string[]; gate: boolean; scopeKind: string; owner: string;
  /** The adopted assignment's instruction; empty hides the row (never the title). */
  instruction: string;
  rework: string[];
};

export type TaskMapDagEdge = {
  taskId: string; dependsOnId: string; requires: { kind: string; label: string } | null;
};

export type TaskMapDropped = { id: string; name: string; word: string; why: string;
  /** The adopted revision that made this disposition change; boot reads its acceptedAt. */
  setIn?: unknown; at?: string };

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
  goal: { id: string; name: string; st: string; word: string };
  stages: Array<{ id: string; name: string; description: string }>;
  tasks: TaskMapTask[];
  dag: TaskMapDag;
  /** Ruling item 1: `tasks/query` answered `not_found` because no Plan is adopted. */
  planMissing?: boolean;
  /** The selected node's `graph/detail` projection (ruling 4: read on demand). */
  detail?: TaskMapNodeDetailData | null;
  detailFor?: string;
  /** Ruling 4: present only after the track is opened. */
  time?: TaskMapTimeData;
};

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
function automationStopOf(row: Record<string, unknown>): string {
  const verdict = asRecord(asRecord(asRecord(row.failure).automation).verdict);
  return asText(verdict.kind) === 'stopped' ? asText(verdict.reason) : '';
}
function taskState(
  phase: string, intent: unknown, disposition: unknown, cause = '', stopReason = '',
): string | null {
  if (disposition === 'cancelled' || disposition === 'superseded') return null;
  if (disposition === 'deferred') return 'deferred';
  if (phase === 'ready') return 'claimable';
  if (phase === 'pending') return intent === 'plan_only' ? 'future' : 'pending';
  if (phase === 'blocked') {
    if (cause === 'run_outcome_unknown') return 'decide';
    if (cause === 'continuation_paused' || cause === 'paused_interrupted') return 'waiting';
  }
  if (phase === 'failed' && DECIDE_STOPS.has(stopReason)) return 'decide';
  return phase;
}

/** The short current reason a TaskRow carries; the route has no long prose. */
const PHASE_CAUSE_WORD: Record<string, string> = {
  requeued: '已重新入队', run_outcome_unknown: '执行结果未知', run_failed: '执行失败',
  check_failed: '检查未通过', round_inconclusive: '检查不完整', check_interrupted: '检查被中断',
  round_ambiguous: '检查轮次无法判定', awaiting_verification: '等待正式检查',
  verification_running: '正式检查进行中', awaiting_completion: '等待完成确认',
  origin_unresolvable: '来源无法核对', continuation_cancelled: '接续已取消',
  continuation_paused: '接续已暂停', paused_interrupted: '暂停时被中断',
  gate_needs_fix: '验收未通过，需要修', auto_rework_cap_reached: '自动返工已达上限',
  no_new_basis: '没有新的依据', verification_uncovered: '没有覆盖验收的检查',
  unknown_outcome: '结果未知，需要核对', budget_exhausted: '预算用尽',
  task_cancelled: '任务已取消', task_paused: '任务已暂停',
};

function taskWhyOf(row: Record<string, unknown>): string {
  /* The automation stop explains a person's decision; it lives in the failure
     verdict, while `phaseCause.code` is only the phase projection. */
  const stop = automationStopOf(row);
  if (stop !== '') return PHASE_CAUSE_WORD[stop] ?? '';
  const code = asText(asRecord(row.phaseCause).code);
  return code === '' ? '' : PHASE_CAUSE_WORD[code] ?? '';
}

/** The Task's display stage: `definition.stageId`, else the scope's stage — a
 * real stage gate declares its stage only in `definition.scope.stageId`. */
function stageOf(definition: Record<string, unknown>): string {
  const declared = asText(definition.stageId);
  if (declared !== '') return declared;
  const scope = asRecord(definition.scope);
  return scope.kind === 'stage' || scope.kind === 'module' ? asText(scope.stageId) : '';
}

function ownersOf(extra: TaskMapExtraReads | undefined): { byTask: Record<string, string>; goal: string } {
  const byTask: Record<string, string> = {};
  let goal = '';
  const hover = extra?.hover;
  if (hover === null || hover === undefined) return { byTask, goal };
  for (const entry of Array.isArray(hover.tasks) ? hover.tasks : []) {
    const row = asRecord(entry);
    const id = asText(asRecord(row.task).taskId);
    const text = ownerWords(row.owners);
    if (id !== '' && text !== '') byTask[id] = text;
  }
  for (const entry of Array.isArray(hover.groups) ? hover.groups : []) {
    const row = asRecord(entry);
    if (asRecord(row.node).kind === 'goal') goal = ownerWords(row.owners);
  }
  return { byTask, goal };
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

const FAILURE_CLASS_WORD: Record<string, string> = {
  run_failed: '执行失败', check_failed: '检查未通过', check_incomplete: '检查不完整',
};

/** Ruling 5: rework history from `tasks[].rework.entries`; no attempt ordinal
 * and no demo batch. `autoCount` is the automatic rework count, never an attempt
 * ordinal. */
function reworkLines(rework: unknown): string[] {
  const entries = asRecord(rework).entries;
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    const row = asRecord(entry);
    const reason = asText(row.reason);
    const at = asText(row.requestedAt);
    const kind = row.automatic === true ? '系统自动' : '人工';
    const count = typeof row.autoCount === 'number' ? '（' + String(row.autoCount) + ' 次）' : '';
    const failure = FAILURE_CLASS_WORD[asText(row.failureClass)] ?? '';
    const parts = [kind + count, failure, reason].filter((part) => part !== '');
    if (parts.length === 0 && at === '') return [];
    return [(at !== '' ? localShortAt(at) + ' · ' : '') + parts.join(' · ')];
  });
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
  const goalData = { id: asText(goalRef.goalId), name: asText(goalBody.objective), st: state.st, word: state.word };
  const owners = ownersOf(extra);
  const emptyDag: TaskMapDag = { edges: [], nodes: [], band: [], dropped: [], gateIds: [], crit: [], owners: {}, goalOwner: '' };
  if (graph === null) return { goal: goalData, stages: [], tasks: [], dag: emptyDag, planMissing: true };

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
      automationStopOf(row));
    if (st === null) {
      const replaced = asText(asRecord(row.dispositionChange).replacedByTaskId) || asText(definition.replacedByTaskId);
      const why = asText(asRecord(asRecord(row.dispositionChange).reason).text);
      dropped.push({ id, name: asText(definition.title),
        word: disposition === 'superseded' ? '已替代' : '已取消',
        why: why !== '' ? why : replaced !== '' ? '由 ' + replaced + ' 取代' : '',
        setIn: asRecord(row.dispositionChange).setIn });
      continue;
    }
    const stage = stageOf(definition);
    kept.push({
      id,
      stageId: stage === '' ? null : stage,
      name: asText(definition.title),
      st,
      why: taskWhyOf(row),
      deps: [],
      gate: definition.taskKind === 'gate',
      scopeKind: asText(asRecord(definition.scope).kind),
      owner: owners.byTask[id] ?? '',
      instruction: instructions.get(id) ?? '',
      rework: reworkLines(row.rework),
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
  return { goal: goalData, stages, tasks: kept, dag };
}

/** The historical state of every Task at one instant (design §6). The timeline
 * is approximate and the segments are half-open; `not_in_plan` and `unknown`
 * keep their own state rather than a guessed one. */
export type TaskMapTimelineRead = {
  tasks: Array<{ taskId: string; segments: Array<{ from: string | null; to: string | null; state: string }> }>;
};
/** One Task's state at an instant: the board state word, the raw timeline state
 * and the two flags only the timeline can justify. */
export type TaskMapHistoricalState = {
  st: string; word: string; raw: string; off?: boolean; faint?: boolean;
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
  outcome_unknown: { st: 'decide', word: '结果未知' },
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
    for (const segment of task.segments) {
      /* Half-open [from, to): the ending instant belongs to the next segment. */
      const from = segment.from === null ? -Infinity : Date.parse(segment.from);
      const to = segment.to === null ? Infinity : Date.parse(segment.to);
      if (from <= instant && instant < to) { found = segment.state; break; }
    }
    const known = HISTORICAL_STATE[found] ?? { st: 'pending', word: '未知' };
    out.set(task.taskId, { ...known, raw: found });
  }
  return out;
}

/* ------------------------------------------------------------------ detail */

/** One `graph/detail` summary task: only the fields the panel shows. */
export type TaskMapDetailTaskRead = {
  task: unknown; planRef?: unknown; title?: unknown; phase?: unknown; phaseCause?: unknown;
  disposition?: unknown; owners?: unknown; participatedLines?: unknown; failure?: unknown;
  actualFiles?: unknown; responsibleNow?: unknown; plannedModules?: unknown;
};
export type TaskMapSummaryRead = { section: 'summary'; task: TaskMapDetailTaskRead | null };
export type TaskMapParticipantRead = {
  items: Array<{ key?: unknown; name?: unknown; status?: unknown; via?: unknown }>;
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
export type TaskMapDetailArchGroup = { crumb: string; files: TaskMapDetailFile[] };
export type TaskMapNodeDetailData = {
  id: string; word: string; why: string;
  instruction: string; stageName: string;
  owner: string; hasOwner: boolean;
  /** Current owner is "现在"; a replay hides the historical relation (ruling 5). */
  ownerNow: boolean;
  files: TaskMapDetailArchGroup[];
  hasFiles: boolean;
  participants: Array<{ name: string; text: string; key: { projectId: string; sessionId: string } | null }>;
  hasParticipants: boolean;
  noParticipants: boolean;
  /** Whether the participants pages were read and whether the last page ended. */
  participantsLoaded: boolean;
  participantsComplete: boolean;
  countsComplete: boolean;
  /** No route returns an attempt ordinal; the row stays hidden. */
  attemptOrdinal: null;
  disposition: { word: string; why: string; atText: string } | null;
};

const PHASE_WORD: Record<string, string> = {
  ready: '可领取', claimable: '可领取', pending: '待执行', future: '未来意图', running: '执行中',
  awaiting_check: '待检查', verifying: '验证中', check_failed: '检查未通过', check_incomplete: '检查不完整',
  run_failed: '执行失败', run_cancelled: '执行已取消', interrupted: '中断，待核对',
  interrupted_pending_check: '中断，待检查', paused: '已暂停', waiting: '已暂停，可继续', waiting_reply: '等回答',
  outcome_unknown: '结果未知', decide: '需要你决定', blocked: '受阻', failed: '失败',
  satisfied: '已满足', cancelled: '已取消', superseded: '已替代', deferred: '已延后',
};

const CAUSE_WORD: Record<string, string> = {
  auto_rework_cap_reached: '自动返工已达上限', gate_needs_fix: '验收未通过，需要修',
  verification_uncovered: '没有覆盖验收的检查', budget_exhausted: '预算用尽',
  no_new_basis: '没有新的依据', unknown_outcome: '结果未知，需要核对',
  task_cancelled: '任务已取消', task_paused: '任务已暂停',
};

/* The line's own state code -> the board's Chinese word; an unknown code is
 * shown as 未知 rather than leaking an English code into the page. */
const OWN_WORD: Record<string, string> = {
  working: '执行中', checking: '检查中', starting: '启动中', waiting_reply: '等回答',
  paused: '已暂停', unknown: '未知', done: '已完成', retired: '已结束', standby: '待命',
};

function ownerWords(owners: unknown): string {
  return (Array.isArray(owners) ? owners : []).flatMap((entry) => {
    const row = asRecord(entry);
    const name = asText(asRecord(row.name).primary);
    if (name === '') return [];
    const own = asText(asRecord(row.status).own);
    const word = own === '' ? '' : OWN_WORD[own] ?? '未知';
    return [word === '' ? name : name + ' · ' + word];
  }).join('、');
}

function detailWhy(task: TaskMapDetailTaskRead): string {
  /* `phaseCause.code` is a phase-cause code, not an automation stop reason; an
   * unknown cause falls through to the failure verdict instead of hiding it. */
  const code = asText(asRecord(task.phaseCause).code);
  if (code !== '') {
    const word = PHASE_CAUSE_WORD[code] ?? CAUSE_WORD[code];
    if (word !== undefined) return word;
  }
  const verdict = asRecord(asRecord(asRecord(task.failure).automation).verdict);
  if (asText(verdict.kind) === 'stopped') {
    const reason = asText(verdict.reason);
    return CAUSE_WORD[reason] ?? PHASE_CAUSE_WORD[reason] ?? '';
  }
  return '';
}

/** The participant text counts only a complete history range; an incomplete
 * window shows the line and hides every total (design §1, row 975). */
function participantText(item: Record<string, unknown>, counts: TaskMapParticipationCounts): string {
  const via = asText(item.via);
  if (counts === null || !counts.complete) return via === '' ? '' : via;
  const parts: string[] = [];
  if (counts.executions > 0) parts.push('执行 ' + counts.executions + ' 次');
  if (counts.checks > 0) parts.push('检查 ' + counts.checks + ' 轮');
  if (counts.consultations > 0) parts.push('回答咨询 ' + counts.consultations + ' 次');
  return parts.join(' · ');
}

/** Pure detail projection (design §6): no request, no DOM. `summary` is the
 * unwrapped `graph/detail` summary; participants are its `section:'participants'`
 * pages; `catalog` is only needed when actual files must be grouped. Planned
 * files, per-file line counts, "未提交" and attempt ordinals are never shown. */
export function adaptTaskMapDetail(
  summary: TaskMapSummaryRead, participants: readonly TaskMapParticipantRead[],
  counts: TaskMapParticipationCounts, catalog: TaskMapCatalogRead,
  /** The adopted assignment's instruction from the task row; the summary has none. */
  instruction: string,
  /** The state the map already shows for this node. The detail must not
   * recompute it from `phase/disposition`: a future intention stays 未来意图. */
  state: string,
  /** The reason the map row already shows. The summary does not carry the
   * failure verdict, so its `phaseCause` would otherwise hide a stop reason
   * (e.g. 自动返工已达上限) that the map already read. */
  mapWhy = '',
): TaskMapNodeDetailData | null {
  const task = summary.task;
  if (task === null) return null;
  const body = asRecord(task.task);
  const id = asText(body.taskId);
  const disposition = asText(task.disposition) || asText(body.disposition);
  const word = PHASE_WORD[state] ?? '未知';
  const who = ownerWords(task.responsibleNow) || ownerWords(task.owners);
  const modules = (catalog?.modules ?? []).flatMap((entry) => {
    const paths = (Array.isArray(entry.paths) ? entry.paths : []).filter((path): path is string => typeof path === 'string');
    return paths.length === 0 ? [] : [{ value: { id: asText(entry.ref?.moduleId), name: asText(entry.name) }, paths }];
  });
  const parents = new Map<string, string>();
  for (const edge of catalog?.containment?.parentOf ?? []) {
    const parent = asText(edge.parent?.moduleId);
    const child = asText(edge.child?.moduleId);
    if (parent !== '' && child !== '') parents.set(child, parent);
  }
  const crumbOf = (moduleId: string): string => {
    const names: string[] = [];
    let cur = moduleId;
    for (let step = 0; cur !== '' && step < 32; step += 1) {
      const found = modules.find((entry) => entry.value.id === cur);
      if (found === undefined) break;
      names.unshift(found.value.name);
      cur = parents.get(cur) ?? '';
    }
    return names.join(' / ');
  };
  const actual = asRecord(task.actualFiles);
  /* Contract `FromExecutedFilesV1` carries `availability`; `status` is never a
   * field of it, so reading `status` hid every real file (design §3/§5). */
  const executed = actual.availability === 'available' && Array.isArray(actual.value) ? actual.value : [];
  const groups = new Map<string, TaskMapDetailFile[]>();
  for (const entry of executed) {
    const file = asRecord(entry);
    const path = asText(file.path);
    if (path === '') continue;
    const own = pathOwnershipOf(path, modules);
    const moduleId = own.status === 'owner' ? String(own.owner.id) : '';
    const crumb = moduleId === '' ? '未归入模块' : crumbOf(moduleId);
    const certainty = asText(file.certainty) === 'possible' ? 'possible' : 'definite';
    const list = groups.get(crumb) ?? [];
    list.push({ path, name: path.split('/').pop() ?? path, certainty,
      tag: certainty === 'definite' ? '实际改过' : '可能改过' });
    groups.set(crumb, list);
  }
  const lines: Array<{ name: string; text: string; key: { projectId: string; sessionId: string } | null }> = [];
  for (const page of participants) {
    for (const item of page.items) {
      const row = asRecord(item);
      const name = asText(asRecord(row.name).primary) || asText(row.name);
      const key = asRecord(row.key);
      const sessionKey = asText(key.projectId) !== '' && asText(key.sessionId) !== ''
        ? { projectId: asText(key.projectId), sessionId: asText(key.sessionId) } : null;
      if (name !== '') lines.push({ name, text: participantText(row, counts), key: sessionKey });
    }
  }
  const participantsLoaded = participants.length > 0;
  const participantsComplete = participantsLoaded
    && (participants[participants.length - 1]?.nextCursor ?? null) === null;
  return {
    id, word, why: mapWhy !== '' ? mapWhy : detailWhy(task),
    instruction, stageName: '',
    owner: who, hasOwner: who !== '', ownerNow: true,
    files: [...groups.entries()].map(([crumb, files]) => ({ crumb, files })),
    hasFiles: groups.size > 0,
    participants: lines, hasParticipants: lines.length > 0, noParticipants: lines.length === 0,
    participantsLoaded, participantsComplete,
    countsComplete: counts !== null && counts.complete,
    attemptOrdinal: null,
    disposition: (disposition === 'cancelled' || disposition === 'superseded' || disposition === 'deferred') ? {
      word: PHASE_WORD[disposition] ?? disposition,
      why: asText(asRecord(asRecord(asRecord(task).dispositionChange).reason).text),
      atText: '',
    } : null,
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
  key: unknown; name?: { primary?: unknown }; status?: { own?: unknown; bucket?: unknown };
  sessionCount?: unknown; pinned?: unknown; pinnedBy?: unknown; chainSessions?: unknown;
  archived?: unknown;
  /** The role duty fixed at Session creation; the board groups lines by it. */
  duty?: unknown;
  /** The line's formal module and task groups; module grouping reads the module id. */
  groups?: unknown;
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
};
export type TaskMapCalendarDay = {
  /** Identity: local date + the real bucket start/end. */
  key: string; localDate: string; dayIndex: number;
  startAt: string; endAt: string;
  steps: number; edits: number; checks: number; complete: boolean; future: boolean;
  tasks: TaskMapCalendarTask[]; moreTasks: number;
  sessions: string[]; moreSessions: number;
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
};
export type TaskMapHistoryLine = {
  taskId: string; segments: Array<{ from: string | null; to: string | null; state: string; word: string }>;
};
export type TaskMapTimeBar = {
  id: string; kind: 'run' | 'check' | 'query'; startAt: string; endAt: string | null;
  /** The same instants at the adapter fact boundary (design §4). */
  startMinute: number; endMinute: number | null;
  result: string; word: string; taskId: string; ordinal: number | null; via: string;
  /** The formal predecessor on the same line, for the link under the bars. */
  previousId: string;
  /** The real pauses with their intervals and intents; never a fabricated count. */
  pauses: Array<{ from: string; to: string | null; intentRef: unknown }>;
  /** A Run's attempt facts; a check/query bar has none. */
  attempt: { via: string; requeue: { actorClass: string; automaticCount: number | null; reason: string } | null } | null;
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
  /** The earliest activity of this line inside this window; not its creation. */
  startAt: string; bars: TaskMapTimeBar[];
  /** `lines/read` chain entries (with provenance) and its omitted count; absent
   * until the line's chain was read. */
  chain: unknown[]; omitted: unknown; lineRead: boolean;
  /** An archived line, merged before the bar index when the list expands. */
  archived: boolean;
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
      hours: hours.filter((hour) => hour.localDate === localDate),
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
      hours: own,
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
    complete: rawComplete, summary,
  };
}

const LINE_WORD: Record<string, string> = {
  working: '执行中', checking: '检查中', starting: '启动中', waiting_reply: '等回答',
  paused: '已暂停', unknown: '未知', done: '已完成', retired: '已结束', standby: '待命',
};
const RUN_RESULT_WORD: Record<string, string> = {
  running: '执行中', completed: '已结束', failed: '失败', budget_exhausted: '预算用尽',
  cancelled: '已取消', paused: '已暂停', interrupted: '中断', outcome_unknown: '结果未知', yielded: '已让出',
};
const CHECK_RESULT_WORD: Record<string, string> = {
  open: '检查中', PASS: '通过', FAIL: '未通过', INCONCLUSIVE: '检查不完整',
};
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
    const name = asText(asRecord(line.name).primary);
    const status = asText(asRecord(line.status).own);
    const count = asRecord(line.sessionCount);
    const countValue = typeof count.value === 'number' ? String(count.value)
      : typeof count.atLeast === 'number' ? '至少 ' + String(count.atLeast) : '';
    const chain = (Array.isArray(line.chainSessions) ? line.chainSessions : []).map(trackSessionKeyOf).filter((x) => x !== '/' && x !== '');
    const groupsRaw = asRecord(line.groups);
    const moduleRaw = asRecord(groupsRaw.module);
    const taskRaw = asRecord(groupsRaw.task);
    const taskGroup = asText(taskRaw.taskId);
    const moduleGroup = asText(moduleRaw.moduleId);
    const row: TaskMapTimeLine = {
      id, projectId: asText(key.projectId), workspaceId: asText(key.workspaceId),
      sessionId: asText(key.sessionId), name: name === '' ? asText(key.sessionId) : name,
      status, word: LINE_WORD[status] ?? '未知',
      role: asText(line.duty),
      groups: {
        task: taskGroup === '' ? null : { taskId: taskGroup },
        module: moduleGroup === '' ? null : { moduleId: moduleGroup },
      },
      sessionCount: countValue,
      countPartial: count.status !== 'exact', pinned: line.pinned === true,
      pinnedBy: (Array.isArray(line.pinnedBy) ? line.pinnedBy : []).map((x) => asText(asRecord(x).sessionId)).filter((x) => x !== ''),
      startAt: '', bars: [], chain: [], omitted: null, lineRead: false,
      archived: line.archived === true || asRecord(line.status).bucket === 'archived',
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
    const attempt = kind === 'run' && attemptVia !== '' ? {
      via: attemptVia,
      requeue: Object.keys(requeueRaw).length === 0 ? null : {
        actorClass: asText(requeueRaw.actorClass),
        automaticCount: typeof requeueRaw.automaticCount === 'number' ? requeueRaw.automaticCount : null,
        reason: asText(requeueRaw.reason),
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
        /* A check has a real ordinal; a Run has none (no invented attempt ordinal). */
        ordinal: kind === 'check' && typeof bar.ordinal === 'number' ? bar.ordinal : null,
        checksBegun: kind === 'check' && typeof bar.checksBegun === 'number' ? bar.checksBegun : null,
        via: asText(bar.via), previousId: previousKey,
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
