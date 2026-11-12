/**
 * The Goals page adapter (E3 Goals §2.1–§2.6): one pure conversion from the
 * route replies the page reads (`goals/list`, the per-row `goals/display`,
 * `lines/list`, `goals/conflicts`, the two `tasks/query` values and
 * `architecture/read`) into the `props.data` of `Goals.dc.html`. It touches no
 * DOM, no network and no app module.
 *
 * The two rules this file never breaks: a `null` list phase is "not read yet"
 * and is never guessed as running; overlap is only what `goals/conflicts`
 * returns in `cards[].objects`, never a second intersection of the two
 * Goals' `plannedFiles`.
 */

import { asRecord, asText } from '../values.js';
import { goalDisplayState, type GoalDisplayPhaseCode } from './task-map.js';
import { completionRevisionOf } from './nav.js';
import type { DecisionSelectionV1, GoalAutonomyV1 } from '../../contracts/goal-decisions.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { TaskGraph } from '../../contracts/task-graph.js';

/** The four expanded-row facts (`Goals.dc.html:128-136`). */
export type GoalsKv = {
  /** "2/5 已满足"; a Goal whose `tasks/query` is null has no tasks. */
  progress: string;
  /** The work line whose `groups.task` points at this Goal, or "—". */
  line: string;
  /** The distinct `definition.plannedFiles` count, as a decimal string. */
  changed: string;
  /** The autonomy in the page's own words (B3), never the raw enum. */
  autonomy: string;
};

/** One ordered Goal row. The page's own local state adds `open`; everything
 * below is derived from the reads. */
export type GoalsGoal = {
  id: string;
  ref: GoalRef;
  revision: number;
  ordinal: number | null;
  /** The Objective is the row's name; `ordinal` is its number, never the position. */
  name: string;
  order: number;
  autonomy: GoalAutonomyV1;
  waitForGoalRef: GoalRef | null;
  /** The `goals/display` phase when the list phase was null; null stays null. */
  displayPhase: string | null;
  statusWord: string;
  /** The board square/state code (`running`, `pending`, `waiting`, …). */
  st: string;
  /** The row's status line (运行中/规划中/等待中 plus the conflict/wait clause). */
  line: string;
  current: boolean;
  upOff: boolean;
  downOff: boolean;
  hasN: boolean;
  n: number;
  kv: GoalsKv;
  /** 1-based visual position (the template's `style="order: …"`). */
  pos: number;
  sq: string;
  tip: string;
  upCls: string;
  downCls: string;
  upLabel: string;
  downLabel: string;
};

export type GoalsConflictFile = { path: string; label: string };
export type GoalsConflictOption = { id: string; label: string };

/** One task of a Goal that changes one of the card's overlap files. */
export type GoalsConflictTask = { id: string; name: string; files: string[]; st: string };

export type GoalsConflict = {
  open: boolean;
  done: boolean;
  cardKey: string;
  /** The card's own source, passed back to `decisions/answer` unchanged. */
  source: unknown;
  title: string;
  /** The rail hint: "1 处" while open, "已决定" after an answer/close. */
  label: string;
  scopeText: string;
  /** The two Goal ids, earlier first by `goals/list.order`. */
  earlier: string;
  later: string;
  earlierRef: GoalRef;
  laterRef: GoalRef;
  earlierId: string;
  laterId: string;
  earlierName: string;
  laterName: string;
  earlierOrdinal: number | null;
  laterOrdinal: number | null;
  files: GoalsConflictFile[];
  openedAt: string | null;
  options: GoalsConflictOption[];
  /** The raw `conflicts.labels[].text` for this pair (empty when none). */
  labels: string[];
  hitA: GoalsConflictTask[];
  hitB: GoalsConflictTask[];
  /** The earlier Goal's GoalPhase revision (`tasks/query.completion`), or 0. */
  earlierPhaseRevision: number;
  /** The raw `DecisionCardV1.state`. */
  state: string;
};

/** A raw architecture node: modules and the files they declare. The page runs
 * its existing `finishTree` over this tree to add parent/depth/aggregate fields. */
export type GoalsArchNode = {
  id: string;
  name: string;
  kind: string;
  kids: GoalsArchNode[];
  sem?: string;
  path?: string;
  both?: boolean;
  tasks?: string[];
  st?: string;
  hit?: boolean;
};

/** A raw task-graph node: project → the two conflict Goals by order → plan
 * stages → tasks. The page's `finishTree` adds the aggregate fields. */
export type GoalsTaskNode = {
  id: string;
  name: string;
  kind: string;
  kids: GoalsTaskNode[];
  goal?: string;
  stage?: string;
  st?: string;
  files?: string[];
  hit?: boolean;
  deps?: string[];
};

export type GoalsMaps = {
  arch: GoalsArchNode | null;
  task: GoalsTaskNode | null;
};

export type GoalsData = {
  goals: GoalsGoal[];
  conflict: GoalsConflict | null;
  maps: GoalsMaps;
  /** `goals/list.sourceCursor`, exactly as read. */
  sourceCursor: unknown;
  selectedGoalId: string | null;
  projectId: string;
  count: number;
  /** The resolved read scope, so the page's actions can address it. */
  scope: { projectId: string; workspaceId: string } | null;
};

/** The ready values of the reads `readGoals` joins. `tasks` is keyed by Goal id
 * and holds `null` for `tasks/query` `not_found`; a missing key means the Goal
 * was not part of the card (its progress is then the empty 0/0 wording). */
export type GoalsInput = {
  goals: unknown;
  displays?: Record<string, unknown> | null;
  lines?: unknown;
  conflicts?: unknown;
  tasks?: Record<string, unknown | null> | null;
  architecture?: unknown;
  projectId?: string;
  scope?: { projectId: string; workspaceId: string } | null;
};

type GoalBase = {
  id: string;
  ref: GoalRef;
  revision: number;
  ordinal: number | null;
  objective: string;
  order: number;
  autonomy: GoalAutonomyV1;
  waitForGoalRef: GoalRef | null;
  displayPhase: string | null;
};

/** The seven `Phase` values plus the adopted intent become the board's task
 * states (the same rule as `adapters/task-map.ts`, kept small here so the
 * Goals adapter does not import the whole TaskMap conversion). */
const TASK_DECIDE_STOPS = new Set(['gate_needs_fix', 'auto_rework_cap_reached', 'no_new_basis',
  'verification_uncovered', 'unknown_outcome']);

const WORST_ORDER = ['decide', 'failed', 'blocked', 'running', 'verifying', 'waiting',
  'claimable', 'pending', 'future', 'deferred', 'cancelled', 'satisfied', 'none'];

/** B3: the two `GoalAutonomyV1` values in the prototype's own words (`Goals.dc.html:3037`). */
export const AUTONOMY_TEXT: Record<GoalAutonomyV1, string> = {
  after_plan_confirmation: '方案确认后自动',
  every_step: '每一步都等你确认',
};

function worstState(a: string, b: string): string {
  return WORST_ORDER.indexOf(a) <= WORST_ORDER.indexOf(b) ? a : b;
}

function ordinalLabel(ordinal: number | null, objective: string): string {
  return ordinal === null ? objective : String(ordinal);
}

/** A `null`/unknown display phase has no state; the page shows 状态未读 and never
 * falls back to RUNNING. */
function goalBoardStateOf(phase: string | null): { st: string; word: string } | null {
  if (phase === null || phase === '') return null;
  return goalDisplayState(phase as GoalDisplayPhaseCode) ?? null;
}

function taskStopReasonOf(row: Record<string, unknown>): string {
  const verdict = asRecord(asRecord(asRecord(row.failure).automation).verdict);
  return asText(verdict.kind) === 'stopped' ? asText(verdict.reason) : '';
}

function taskStateOf(row: Record<string, unknown>): string | null {
  const definition = asRecord(row.definition);
  const disposition = asText(row.disposition) || asText(definition.disposition);
  if (disposition === 'cancelled' || disposition === 'superseded') return null;
  if (disposition === 'deferred') return 'deferred';
  const phase = asText(row.effectivePhase);
  if (phase === 'ready' || phase === 'pending') {
    if (definition.executionIntent === 'plan_only') return 'future';
    return asRecord(row.eligibility).eligible === true ? 'claimable' : 'pending';
  }
  if (phase === 'blocked') {
    const cause = asText(asRecord(row.phaseCause).code);
    if (cause === 'run_outcome_unknown') return 'decide';
    if (cause === 'continuation_paused' || cause === 'paused_interrupted') return 'waiting';
  }
  if (phase === 'failed' && TASK_DECIDE_STOPS.has(taskStopReasonOf(row))) return 'decide';
  return phase === '' ? null : phase;
}

export function taskStageOf(definition: Record<string, unknown>): string {
  const declared = asText(definition.stageId);
  if (declared !== '') return declared;
  const scope = asRecord(definition.scope);
  return scope.kind === 'stage' || scope.kind === 'module' ? asText(scope.stageId) : '';
}

function plannedFilesOf(row: Record<string, unknown>): string[] {
  const files = asRecord(row.definition).plannedFiles;
  if (!Array.isArray(files)) return [];
  return [...new Set(files.map((file) => asText(file)).filter((path) => path !== ''))];
}

function taskRowsOf(graph: unknown): Array<Record<string, unknown>> {
  const tasks = asRecord(graph).tasks;
  return Array.isArray(tasks) ? tasks.map((entry) => asRecord(entry)) : [];
}

/** §2.7 A07: the one done/total rule Goals, Main and Done share. A Goal without an
 * adopted Plan reads as 0/0, not as an error. */
export function taskProgressOf(graph: unknown): { done: number; total: number } {
  const rows = taskRowsOf(graph);
  return {
    done: rows.filter((row) => asText(row.effectivePhase) === 'satisfied').length,
    total: rows.length,
  };
}

function taskIdOf(row: Record<string, unknown>): string {
  return asText(asRecord(row.definition).taskId);
}

function taskNameOf(row: Record<string, unknown>): string {
  return asText(asRecord(row.definition).title);
}

/** The Goal ids named by a conflict card's `source.pins` (exactly two on a real
 * card; the Plan pins beside them are ignored). */
function goalPinsOf(card: Record<string, unknown>): GoalRef[] {
  const pins = asRecord(card.source).pins;
  if (!Array.isArray(pins)) return [];
  return pins.map((pin) => asRecord(pin)).map((pin) => asRecord(pin.ref))
    .filter((ref) => ref.aggregateType === 'Goal' && asText(ref.goalId) !== '')
    .map((ref) => ref as unknown as GoalRef);
}

function labelOfEntry(entry: unknown, aId: string, bId: string): string {
  const row = asRecord(entry);
  const first = asText(asRecord(row.goalRef).goalId);
  const second = asText(asRecord(row.otherGoalRef).goalId);
  return first === aId && second === bId || first === bId && second === aId ? asText(row.text) : '';
}

/** §2.6 D18/D30: the goal-conflict answer's structured selection. `earlier`/
 * `later` are the card's two Goal pins in `goals/list.order`; `order` moves
 * `later` in front of `earlier` and keeps every other Goal in place. One
 * implementation serves the Goals conflict card and the Decide card. */
export function conflictSelectionOf(
  optionId: string,
  earlier: { ref: GoalRef },
  later: { ref: GoalRef },
  goals: ReadonlyArray<{ ref: GoalRef }>,
): DecisionSelectionV1 {
  if (optionId === 'wait') return { kind: 'conflict_wait', earlier: earlier.ref, later: later.ref };
  if (optionId === 'parallel') return { kind: 'conflict_parallel', earlier: earlier.ref, later: later.ref };
  const idOf = (goal: { ref: GoalRef }): string => asText(asRecord(goal.ref).goalId);
  const earlierId = idOf(earlier);
  const laterId = idOf(later);
  const order = goals.map(idOf).filter((id) => id !== laterId);
  const at = order.indexOf(earlierId);
  order.splice(at < 0 ? 0 : at, 0, laterId);
  const byId = new Map(goals.map((goal) => [idOf(goal), goal]));
  return { kind: 'conflict_order', goalOrder: order.map((id) => byId.get(id)!.ref) };
}

/** The `goals/list.order` of a Goal id, or +∞ when the Goal is not listed. */
export function goalOrderOf(orderById: ReadonlyMap<string, number>, id: string): number {
  return orderById.get(id) ?? Number.POSITIVE_INFINITY;
}

/** The one Goals conversion. `selected` is the Goal the URL/default rule chose;
 * it only marks `current`, the rows always show the whole list. */
export function adaptGoals(input: GoalsInput, selected: string | null): GoalsData {
  const goalList = asRecord(input.goals);
  const rawRows = Array.isArray(goalList.goals) ? goalList.goals : [];
  const displays = input.displays ?? {};
  const records = rawRows.map((entry) => asRecord(entry))
    .map((row, index) => ({ row, order: typeof row.order === 'number' ? row.order : index }))
    .sort((a, b) => a.order - b.order);
  const projectId = input.projectId ?? input.scope?.projectId ?? '';
  const bases: GoalBase[] = records.map(({ row, order }) => {
    const ref = asRecord(row.ref) as unknown as GoalRef;
    const id = asText(ref.goalId);
    const listPhase = row.display === undefined || row.display === null ? null : asRecord(row.display).phase;
    const listPhaseText = typeof listPhase === 'string' ? listPhase : null;
    const display = displays[id];
    const displayPhase = listPhaseText !== null ? listPhaseText
      : display === undefined || display === null ? null : asText(asRecord(asRecord(display).display).phase) || null;
    const autonomy = asText(row.autonomy);
    return {
      id,
      ref,
      revision: typeof row.revision === 'number' ? row.revision : 0,
      ordinal: typeof row.ordinal === 'number' ? row.ordinal : null,
      objective: asText(row.objective),
      order,
      autonomy: autonomy as GoalAutonomyV1,
      waitForGoalRef: row.waitForGoalRef === null || row.waitForGoalRef === undefined
        ? null : asRecord(row.waitForGoalRef) as unknown as GoalRef,
      displayPhase,
    };
  });
  const byId = new Map(bases.map((goal) => [goal.id, goal]));
  const orderById = new Map(bases.map((goal) => [goal.id, goal.order]));

  const conflictRead = asRecord(input.conflicts);
  const cards = Array.isArray(conflictRead.cards) ? conflictRead.cards.map((entry) => asRecord(entry)) : [];
  const card = cards.length > 0 ? cards[0]! : null;
  const labelEntries = Array.isArray(conflictRead.labels) ? conflictRead.labels : [];

  /* The pair is the two Goal pins sorted by `goals/list.order`; the label-only
     state (no card, an accepted parallel risk) takes its pair from the first
     label row. `source.subject`/`source.key` are never parsed. */
  let earlierId = '';
  let laterId = '';
  let earlierRef: GoalRef | null = null;
  let laterRef: GoalRef | null = null;
  if (card !== null) {
    const pins = goalPinsOf(card);
    const ids = [...new Set(pins.map((ref) => asText(ref.goalId)).filter((id) => id !== ''))];
    ids.sort((a, b) => goalOrderOf(orderById, a) - goalOrderOf(orderById, b));
    earlierId = ids[0] ?? '';
    laterId = ids[1] ?? '';
    earlierRef = pins.find((ref) => asText(ref.goalId) === earlierId) ?? null;
    laterRef = pins.find((ref) => asText(ref.goalId) === laterId) ?? null;
    /* T3: both Goals must be in the list; a half card is not drawn. */
    for (const id of [earlierId, laterId]) {
      if (id !== '' && !byId.has(id)) throw new Error('goal conflict card names a goal outside goals/list');
    }
  } else {
    const firstLabel = labelEntries.length > 0 ? asRecord(labelEntries[0]) : null;
    if (firstLabel !== null) {
      const first = asText(asRecord(firstLabel.goalRef).goalId);
      const second = asText(asRecord(firstLabel.otherGoalRef).goalId);
      if (first !== '' && second !== '') {
        earlierId = goalOrderOf(orderById, first) <= goalOrderOf(orderById, second) ? first : second;
        laterId = earlierId === first ? second : first;
        earlierRef = asRecord(firstLabel.goalRef) as unknown as GoalRef;
        laterRef = asRecord(firstLabel.otherGoalRef) as unknown as GoalRef;
      }
    }
  }
  const labels = card === null && earlierId === ''
    ? []
    : labelEntries.map((entry) => labelOfEntry(entry, earlierId, laterId)).filter((text) => text !== '');
  const hasConflict = card !== null || labels.length > 0;
  const tasks = input.tasks ?? {};

  const overlapFiles = card === null ? [] : (Array.isArray(card.objects) ? card.objects : [])
    .map((entry) => asRecord(entry))
    .filter((object) => object.kind === 'file' && asText(object.path) !== '')
    .map((object) => ({ path: asText(object.path), label: asText(object.label) }));
  const overlapPaths = overlapFiles.map((file) => file.path);
  const overlapSet = new Set(overlapPaths);

  const hitTasks = (goalId: string): GoalsConflictTask[] => {
    if (goalId === '') return [];
    return taskRowsOf(tasks[goalId]).map((row) => {
      const files = plannedFilesOf(row);
      if (!files.some((path) => overlapSet.has(path))) return null;
      const st = taskStateOf(row);
      if (st === null) return null;
      return { id: taskIdOf(row), name: taskNameOf(row), files, st };
    }).filter((task): task is GoalsConflictTask => task !== null);
  };
  const hitA = hitTasks(earlierId);
  const hitB = hitTasks(laterId);

  const options = card === null ? [] : (Array.isArray(card.options) ? card.options : [])
    .map((entry) => asRecord(entry))
    .map((option) => ({ id: asText(option.id), label: asText(option.label) }))
    .filter((option) => option.id !== '');
  const answer = card === null ? null : card.answer;
  const open = card !== null && card.state === 'waiting_answer' && (answer === null || answer === undefined);
  const earlierName = byId.get(earlierId)?.objective ?? '';
  const laterName = byId.get(laterId)?.objective ?? '';
  const earlierOrdinal = byId.get(earlierId)?.ordinal ?? null;
  const laterOrdinal = byId.get(laterId)?.ordinal ?? null;
  const earlierPhaseRevision = completionRevisionOf(earlierId === '' ? null : tasks[earlierId]);
  const conflict: GoalsConflict | null = hasConflict ? {
    open,
    done: !open,
    cardKey: card === null ? '' : asText(card.cardKey),
    source: card === null ? null : card.source,
    title: '目标 ' + ordinalLabel(laterOrdinal, laterName) + ' 与目标 '
      + ordinalLabel(earlierOrdinal, earlierName) + ' 冲突',
    label: open ? '1 处' : '已决定',
    scopeText: '重叠 ' + String(overlapFiles.length) + ' 个文件',
    earlier: earlierId,
    later: laterId,
    earlierRef: earlierRef ?? { aggregateType: 'Goal', projectId, goalId: earlierId },
    laterRef: laterRef ?? { aggregateType: 'Goal', projectId, goalId: laterId },
    earlierId,
    laterId,
    earlierName,
    laterName,
    earlierOrdinal,
    laterOrdinal,
    files: overlapFiles,
    openedAt: card === null ? null : (typeof card.openedAt === 'string' ? card.openedAt : null),
    options,
    labels,
    hitA,
    hitB,
    earlierPhaseRevision,
    state: card === null ? '' : asText(card.state),
  } : null;

  const lineRows = Array.isArray(asRecord(input.lines).rows) ? asRecord(input.lines).rows as unknown[] : [];
  const workLineOf = (goalId: string): string => {
    for (const entry of lineRows) {
      const row = asRecord(entry);
      const task = asRecord(row.groups).task;
      if (asText(asRecord(task).goalId) !== goalId) continue;
      const name = asRecord(row.name);
      const primary = asText(name.primary);
      if (primary !== '') return primary;
    }
    return '—';
  };

  const goals: GoalsGoal[] = bases.map((goal, index) => {
    const state = goalBoardStateOf(goal.displayPhase);
    const statusWord = state === null ? '状态未读' : state.word;
    const st = state === null ? 'pending' : state.st;
    const isPair = conflict !== null && (goal.id === conflict.earlierId || goal.id === conflict.laterId);
    const n = conflict !== null && conflict.open && isPair ? 1 : 0;
    const other = conflict === null || !conflict.open ? null
      : goal.id === conflict.earlierId ? conflict.laterId
        : goal.id === conflict.laterId ? conflict.earlierId : null;
    let line = statusWord;
    if (other !== null) {
      const otherOrdinal = goal.id === conflict!.earlierId ? conflict!.laterOrdinal : conflict!.earlierOrdinal;
      const otherName = goal.id === conflict!.earlierId ? conflict!.laterName : conflict!.earlierName;
      line += ' · 与目标 ' + ordinalLabel(otherOrdinal, otherName) + ' 冲突';
    } else if (goal.waitForGoalRef !== null) {
      const waitId = asText(asRecord(goal.waitForGoalRef).goalId);
      const target = byId.get(waitId);
      line += ' · 等目标 ' + ordinalLabel(target?.ordinal ?? null, target?.objective ?? waitId) + ' 完成';
    }
    const graph = tasks[goal.id];
    const rows = taskRowsOf(graph);
    const progress = taskProgressOf(graph);
    const changed = new Set(rows.flatMap((row) => plannedFilesOf(row))).size;
    const last = index === bases.length - 1;
    return {
      id: goal.id,
      ref: goal.ref,
      revision: goal.revision,
      ordinal: goal.ordinal,
      name: goal.objective,
      order: goal.order,
      autonomy: goal.autonomy,
      waitForGoalRef: goal.waitForGoalRef,
      displayPhase: goal.displayPhase,
      statusWord,
      st,
      line,
      current: goal.id === selected,
      upOff: index === 0,
      downOff: last,
      hasN: n > 0,
      n,
      kv: {
        progress: String(progress.done) + '/' + String(progress.total) + ' 已满足',
        line: workLineOf(goal.id),
        changed: String(changed),
        autonomy: AUTONOMY_TEXT[goal.autonomy],
      },
      pos: index + 1,
      sq: 'sq z10 s-' + st,
      tip: goal.objective + '：' + statusWord + (n > 0 ? '，需要你决定 ' + String(n) : ''),
      upCls: 'btn btn-icon btn-sm' + (index === 0 ? ' is-off' : ''),
      downCls: 'btn btn-icon btn-sm' + (last ? ' is-off' : ''),
      upLabel: index === 0 ? '已经在第 1 位' : '上移：调到第 ' + String(index) + ' 位',
      downLabel: last ? '已经在最后' : '下移：调到第 ' + String(index + 2) + ' 位',
    };
  });

  const maps: GoalsMaps = {
    arch: buildArchMap(input.architecture, overlapSet, hitA, hitB, open, projectId),
    task: buildTaskMap(conflict, goals, tasks, overlapSet, projectId),
  };

  return {
    goals,
    conflict,
    maps,
    sourceCursor: goalList.sourceCursor ?? null,
    selectedGoalId: selected,
    projectId,
    count: goals.length,
    scope: input.scope ?? null,
  };
}

/** §2.3: one Goal's stage/task tree. The Goals conflict map and Main's task
 * panel are the same rule; the caller adds its own conflict highlighting. */
export function goalTaskTree(goal: { id: string; name: string }, graph: TaskGraph | null): GoalsTaskNode | null {
  const root: GoalsTaskNode = { id: goal.id, name: goal.name, kind: 'goal', goal: goal.id, kids: [] };
  const stages = asRecord(asRecord(graph).plan).stages;
  const stageNodes = new Map<string, GoalsTaskNode>();
  for (const entry of Array.isArray(stages) ? stages : []) {
    const stage = asRecord(entry);
    const id = asText(stage.stageId);
    if (id === '') continue;
    const node: GoalsTaskNode = { id, name: asText(stage.title), kind: 'stage', goal: goal.id, kids: [] };
    stageNodes.set(id, node);
    root.kids.push(node);
  }
  const dependsOn = asRecord(asRecord(asRecord(graph).plan).executionDag).dependsOn;
  const depsOf = (taskId: string): string[] => (Array.isArray(dependsOn) ? dependsOn : [])
    .map((entry) => asRecord(entry))
    .filter((edge) => asText(edge.taskId) === taskId)
    .map((edge) => asText(edge.dependsOnId))
    .filter((id) => id !== '');
  for (const row of taskRowsOf(graph)) {
    const st = taskStateOf(row);
    if (st === null) continue;
    const id = taskIdOf(row);
    const files = plannedFilesOf(row);
    const stageId = taskStageOf(asRecord(row.definition));
    const task: GoalsTaskNode = {
      id, name: taskNameOf(row), kind: 'task', goal: goal.id, st, files, hit: false, deps: depsOf(id), kids: [],
    };
    /* A task without a stage hangs on its goal, as TaskMap's tree does (lead 11-12). */
    if (stageId === '') {
      root.kids.push(task);
      continue;
    }
    let stageNode = stageNodes.get(stageId);
    if (stageNode === undefined) {
      stageNode = { id: stageId, name: stageId, kind: 'stage', goal: goal.id, kids: [] };
      stageNodes.set(stageId, stageNode);
      root.kids.push(stageNode);
    }
    stageNode.kids.push({ ...task, stage: stageNode.id });
  }
  return root;
}

/** §2.3: the catalog → module → file tree before any conflict lighting. Goals
 * lights its overlap files over this result; Main draws it as it is. A file's
 * state is the worst state of the plan's Tasks that name it. `work` is S12's
 * current-work file set: non-null keeps only those files (and their modules). */
export function catalogArchTree(
  architecture: unknown, projectId: string, graph: TaskGraph | null, work: ReadonlySet<string> | null,
): GoalsArchNode | null {
  if (architecture === null || architecture === undefined) return null;
  const adopted = asRecord(asRecord(asRecord(architecture).catalog).catalog);
  const modules = Array.isArray(adopted.modules) ? adopted.modules.map((entry) => asRecord(entry)) : [];
  if (modules.length === 0) return null;
  const containment = asRecord(adopted.containment);
  const parentOf = Array.isArray(containment.parentOf) ? containment.parentOf.map((entry) => asRecord(entry)) : [];
  const parentByChild = new Map<string, string>();
  for (const edge of parentOf) {
    const parent = asText(asRecord(edge.parent).moduleId);
    const child = asText(asRecord(edge.child).moduleId);
    if (parent !== '' && child !== '' && parent !== child) parentByChild.set(child, parent);
  }
  const fileState = new Map<string, string>();
  const fileTasks = new Map<string, string[]>();
  for (const row of taskRowsOf(graph)) {
    const st = taskStateOf(row);
    if (st === null) continue;
    const id = taskIdOf(row);
    for (const path of plannedFilesOf(row)) {
      fileState.set(path, worstState(fileState.get(path) ?? 'none', st));
      const tasks = fileTasks.get(path) ?? [];
      if (!tasks.includes(id)) tasks.push(id);
      fileTasks.set(path, tasks);
    }
  }
  const seenPaths = new Set<string>();
  const nodes = new Map<string, GoalsArchNode>();
  const order: string[] = [];
  for (const module of modules) {
    const id = asText(asRecord(module.ref).moduleId);
    if (id === '' || nodes.has(id)) continue;
    nodes.set(id, { id, name: asText(module.name), kind: 'module', sem: asText(module.responsibility), kids: [] });
    order.push(id);
  }
  const root: GoalsArchNode = { id: 'ARCH', name: projectId === '' ? '架构' : projectId, kind: 'system', kids: [] };
  for (const id of order) {
    const node = nodes.get(id)!;
    const parentId = parentByChild.get(id);
    const parent = parentId === undefined ? undefined : nodes.get(parentId);
    if (parent === undefined) root.kids.push(node);
    else parent.kids.push(node);
  }
  for (const module of modules) {
    const moduleId = asText(asRecord(module.ref).moduleId);
    const moduleNode = nodes.get(moduleId);
    if (moduleNode === undefined) continue;
    const paths = Array.isArray(module.paths) ? module.paths.map((path) => asText(path)) : [];
    for (const path of paths) {
      if (path === '' || seenPaths.has(path)) continue;
      if (work !== null && !work.has(path)) continue;
      seenPaths.add(path);
      moduleNode.kids.push({
        id: path, name: path.split('/').pop() ?? path, kind: 'file', path,
        st: fileState.get(path) ?? 'none', hit: false, both: false,
        tasks: fileTasks.get(path) ?? [], kids: [],
      });
    }
  }
  if (work !== null) {
    /* S12: only the modules that keep a current file, directly or below. */
    const keep = (node: GoalsArchNode): boolean => {
      node.kids = node.kids.filter((kid) => kid.kind === 'file' || keep(kid));
      return node.kids.length > 0;
    };
    keep(root);
  }
  return root;
}

/** The architecture tree: modules from the adopted catalog and their declared
 * files. Containment is optional; absent means flat, never inferred from paths. */
function buildArchMap(
  architecture: unknown, overlap: Set<string>, hitA: GoalsConflictTask[], hitB: GoalsConflictTask[],
  undecided: boolean, projectId: string,
): GoalsArchNode | null {
  const root = catalogArchTree(architecture, projectId, null, null);
  if (root === null) return null;
  const hitIds = [...hitA, ...hitB];
  const worstByPath = new Map<string, string>();
  for (const task of hitIds) {
    for (const path of task.files) {
      if (!overlap.has(path)) continue;
      worstByPath.set(path, worstState(worstByPath.get(path) ?? 'none', task.st));
    }
  }
  const light = (node: GoalsArchNode): void => {
    if (node.kind === 'file' && node.path !== undefined) {
      const both = overlap.has(node.path);
      node.both = both;
      node.hit = both;
      node.tasks = both ? hitIds.filter((task) => task.files.includes(node.path!)).map((task) => task.id) : [];
      node.st = both ? (undecided ? 'decide' : worstByPath.get(node.path) ?? 'none') : 'none';
    }
    node.kids.forEach(light);
  };
  light(root);
  return root;
}

/** The task map: the project root, the two conflict Goals in order, their plan
 * stages and tasks. A Goal without an adopted Plan is a Goal node with no kids. */
function buildTaskMap(
  conflict: GoalsConflict | null, goals: GoalsGoal[], tasks: Record<string, unknown | null>,
  overlap: Set<string>, projectId: string,
): GoalsTaskNode | null {
  if (conflict === null) return null;
  const root: GoalsTaskNode = { id: 'GOALS', name: projectId === '' ? '项目' : projectId, kind: 'project', kids: [] };
  for (const goalId of [conflict.earlierId, conflict.laterId]) {
    if (goalId === '') continue;
    const goalRow = goals.find((goal) => goal.id === goalId);
    const graph = tasks[goalId] === null || tasks[goalId] === undefined ? null : tasks[goalId] as TaskGraph;
    const goalNode = goalTaskTree({ id: goalId, name: goalRow?.name ?? '' }, graph);
    if (goalNode === null) continue;
    const light = (node: GoalsTaskNode): void => {
      if (node.kind === 'task') node.hit = (node.files ?? []).some((path) => overlap.has(path));
      node.kids.forEach(light);
    };
    light(goalNode);
    root.kids.push(goalNode);
  }
  return root;
}
