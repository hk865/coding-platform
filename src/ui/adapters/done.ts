/**
 * E3-DONE §2.2: the Done board's one read adapter. Its input is the route values
 * `readDone` read in order (task graph, completion policy, verification round,
 * change scope, the per-Task actual files, uncommitted file states, Runs,
 * continuation briefs and activity); its output is `DoneData`, the five
 * delivery sections plus the card and the composer's data. It touches no DOM,
 * no network and no `src/app`; words and formats reuse the TaskMap/Member
 * tables instead of a second copy.
 *
 * `deliveryState` is chosen by the read order (`no_plan`/`no_gate`/`no_round`/
 * `many_gates`/`ready`), never guessed from `delivery === null` (§2.2).
 */
import type { ArchitectureChangeScopeV1 } from '../../contracts/architecture-search.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { ContinuationBriefV1 } from '../../contracts/continuation-brief.js';
import type { EvidenceOutcome } from '../../contracts/evidence.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { TaskExecutionRecord } from '../../contracts/execution-read.js';
import type { TaskRow } from '../../contracts/task-graph.js';
import type { UncommittedFileV1, UncommittedFilesV1 } from '../../contracts/workspace-files.js';
import type { CheckHostActor } from '../../contracts/verification.js';
import { asText } from '../values.js';
import { goalHref, type NavData } from './nav.js';
import { taskProgressOf } from './goals.js';
import { briefRowsOf } from './member.js';
import {
  CHECK_RESULT_WORD, FAILURE_CLASS_WORD, goalDisplayState, reworkLines, taskStateOfRow,
} from './task-map.js';

/** The `verification/round` projection this page reads (§2.3): the delivery's
 * requirements/obligations/summary and each check's report/executor. The route
 * value's other fields stay at the boundary. */
export type DoneRequirementState = 'pass' | 'fail' | 'inconclusive' | 'pending' | 'missing';
export type DoneRoundRead = {
  delivery: {
    obligations: { obligationId: string; title: string; requirementLevel: string; taskIds: string[] }[];
    requirements: {
      obligationId: string; obligationTitle: string; requirementId: string; requirementLevel: string;
      kind: string; description: string; state: DoneRequirementState;
      checks: {
        roundOrdinal: number; checkId: string; outcome: EvidenceOutcome | null;
        incompleteCause: string | null; reportRef: ArtifactRef | null;
        executor: CheckHostActor; command: string;
      }[];
    }[];
    summary: {
      obligations: number; requirements: number; pass: number; fail: number;
      inconclusive: number; pending: number; missing: number; rounds: number;
    };
  };
};
/** `completion-policies/read`'s one note field (§2.5). */
export type DonePolicyRead = {
  policy: { content: { requirementKinds: string[]; minimumRequiredRequirementsPerObligation: number } };
};
/** `activity/runs`'s one reading this page sums (§2.9). */
export type DoneRunActivity = {
  runRef: RunRef;
  status: 'counted' | 'not_entered' | 'in_progress' | 'unknown';
  readings: { usage: { tokens: number | null; complete: boolean } };
};

export type DoneBlank = 'no_goal' | 'no_completed_goal' | null;
export type DoneDeliveryState = 'no_plan' | 'no_gate' | 'no_round' | 'many_gates' | 'ready';

const CHECK_ACTOR_WORD: Record<string, string> = { human: '人', system: '系统' };

export type DoneRequirement = {
  key: string;
  req: string;
  gate: string;
  check: string;
  who: string;
  report: string;
  reportRef: ArtifactRef | null;
  state: DoneRequirementState;
  /** §2.5's word, square and text classes; the state word table lives here, not in the page. */
  word: string;
  sq: string;
  tx: string;
  rounds: { n: number; outcome: EvidenceOutcome | null; word: string; why: string; tx: string }[];
  taskIds: string[];
};

export type DoneFileRow = {
  key: string;
  rel: string;
  certainty: 'definite' | 'possible';
  state: 'uncommitted' | 'clean' | 'unknown';
  add: number | null;
  del: number | null;
  /** §2.6: the Tasks that changed this path, with the TaskMap state code the
   * page's own `sqAt` turns into a square. */
  tasks: { taskId: string; name: string; state: string }[];
};

export type DoneFilesSection = {
  n: number;
  countText: string;
  add: number | null;
  del: number | null;
  groups: {
    name: string; path: string; hasPath: boolean; add: number | null; del: number | null; files: DoneFileRow[];
  }[];
  partial: boolean;
  note: string;
};

export type DoneTodoSection = {
  sum: string;
  later: { taskId: string; name: string; phase: string }[];
};

export type DoneReworkSection = {
  sum: string;
  rows: {
    key: string; taskId: string; name: string; kind: 'rework' | 'cont'; state: string;
    failureClass: string; lines: string[]; sum: string;
  }[];
  autoNote: string;
};

export type DoneUsageSection = {
  sum: string;
  rows: { who: string; tokens: number; complete: boolean }[];
  totalTokens: number;
  note: string;
};

export type DoneDelivery = {
  goalId: string;
  title: string;
  acc: { sum: string; reqs: DoneRequirement[]; note: string };
  files: DoneFilesSection;
  todo: DoneTodoSection;
  rework: DoneReworkSection;
  usage: DoneUsageSection;
};

export type DoneDeliveryCard = {
  key: 'delivery';
  level: '要决定';
  title: string;
  line: string;
  path: string;
  facts: { k: string; v: string }[];
  hasFacts: boolean;
  /** §2.10/N43: the composer's prefill, built here so the page never parses `path`. */
  askRef: string;
  actions: { key: 'redo' | 'partial'; label: string }[];
  primary: { key: 'accept'; label: '接受' };
};

export type DoneData = {
  nav: NavData;
  inboxRows: { href: string; title: string; sq: string; name: string; n: string }[];
  blank: DoneBlank;
  delivery: DoneDelivery | null;
  deliveryState: DoneDeliveryState;
  card: DoneDeliveryCard | null;
  reports: Record<string, string>;
  reportError: string | null;
  /** §2.7 A07 (F5): the one `taskProgressOf` rule Goals and Main draw. The
   * board's inline logic cannot call a TS function, so the result rides here. */
  progress: { done: number; total: number };
};

/** The route values `readDone` read, in §2.2's order. */
export type DoneSource = {
  nav: NavData;
  deliveryState: DoneDeliveryState;
  round: DoneRoundRead | null;
  policy: DonePolicyRead | null;
  changeScope: ArchitectureChangeScopeV1;
  /** A Task's actual files (`graph/detail.summary.task.actualFiles`), by taskId. */
  taskFiles: Record<string, string[]>;
  taskFilesIncomplete: boolean;
  /** `files/uncommitted` for the shown paths; `null` is the ruled "numbers only". */
  files: UncommittedFilesV1 | null;
  runs: TaskExecutionRecord[];
  /** A continuing Run's brief; `null` is "no continuation brief". */
  briefs: Record<string, ContinuationBriefV1 | null>;
  activity: DoneRunActivity[];
  reports: Record<string, string>;
  reportError: string | null;
};

const NO_CHECK = '—';
const NO_REPORT = '—';

/** §2.5's state words, squares and text classes. The three result words are
 * `CHECK_RESULT_WORD`'s; only `pending` and `missing` are new here (§2.3). */
const REQUIREMENT_VIEW: Record<DoneRequirementState, [string, string, string]> = {
  pass: [CHECK_RESULT_WORD.PASS!, 'sq z10 s-satisfied', 'tx-satisfied'],
  fail: [CHECK_RESULT_WORD.FAIL!, 'sq z10 s-failed', 'tx-failed'],
  inconclusive: [CHECK_RESULT_WORD.INCONCLUSIVE!, 'sq z10 s-blocked', 'tx-blocked'],
  pending: ['待检查', 'sq z10 s-pending', ''],
  missing: ['没有检查', 'sq z10 s-idle', ''],
};

function digestShort(ref: ArtifactRef | null): string {
  return ref === null ? NO_REPORT : ref.digest.slice(0, 12);
}

function doneTaskTitle(row: TaskRow): string {
  return asText(row.definition.title);
}

function requirementsOf(round: DoneRoundRead): DoneRequirement[] {
  const taskIdsOf = new Map<string, string[]>();
  for (const obligation of round.delivery.obligations) taskIdsOf.set(obligation.obligationId, obligation.taskIds);
  return round.delivery.requirements.map((requirement) => {
    const first = requirement.checks[0] ?? null;
    const firstReport = requirement.checks.find((check) => check.reportRef !== null)?.reportRef ?? null;
    const view = REQUIREMENT_VIEW[requirement.state];
    return {
      key: requirement.obligationId + '/' + requirement.requirementId,
      req: requirement.description,
      gate: requirement.obligationTitle,
      check: first === null ? NO_CHECK : first.command,
      who: first === null ? NO_CHECK : CHECK_ACTOR_WORD[first.executor.kind] ?? first.executor.kind,
      report: digestShort(firstReport),
      reportRef: firstReport,
      state: requirement.state,
      word: view[0],
      sq: view[1],
      tx: view[2],
      rounds: requirement.checks.map((check) => ({
        n: check.roundOrdinal,
        outcome: check.outcome,
        word: check.outcome === null ? '' : CHECK_RESULT_WORD[check.outcome] ?? check.outcome,
        why: check.incompleteCause === null ? '' : '：' + check.incompleteCause,
        tx: check.outcome === 'PASS' ? 'tx-satisfied' : check.outcome === 'FAIL' ? 'tx-failed'
          : check.outcome === null ? '' : 'tx-blocked',
      })),
      taskIds: taskIdsOf.get(requirement.obligationId) ?? [],
    };
  });
}

function accSumOf(state: DoneDeliveryState, round: DoneRoundRead | null): string {
  /* §0.4: the blank sentence already says there is no plan; the section head stays empty. */
  if (state === 'no_plan') return '';
  if (state === 'many_gates') return '有多个验收关口，还没接通';
  if (state === 'no_gate' || state === 'no_round' || round === null) return '还没有验收轮次';
  const summary = round.delivery.summary;
  if (summary.requirements === 0) return '还没有验收要求';
  return String(summary.pass) + '/' + String(summary.requirements) + ' 通过 · 验收检查 ' + String(summary.rounds) + ' 轮';
}

function policyNote(policy: DonePolicyRead | null): string {
  if (policy === null) return '';
  const content = policy.policy.content;
  return '这份策略认 ' + String(content.requirementKinds.length) + ' 类要求；每个必需义务至少 '
    + String(content.minimumRequiredRequirementsPerObligation) + ' 个必需检查';
}

function uncommittedAt(files: UncommittedFilesV1 | null, path: string): UncommittedFileV1 | null {
  if (files === null || files.repository !== 'git') return null;
  return files.files.find((row) => row.path === path) ?? null;
}

function filesSectionOf(source: DoneSource): DoneFilesSection {
  const scopePath = source.nav.scope === null ? '' : source.nav.scope.workspaceId;
  const taskRowsOfPath = new Map<string, TaskRow[]>();
  for (const row of source.nav.tasks?.tasks ?? []) {
    for (const path of source.taskFiles[row.ref.taskId] ?? []) {
      const list = taskRowsOfPath.get(path) ?? [];
      list.push(row);
      taskRowsOfPath.set(path, list);
    }
  }
  const groups = new Map<string, { name: string; path: string; files: DoneFileRow[] }>();
  let addTotal: number | null = 0;
  let delTotal: number | null = 0;
  for (const file of source.changeScope.files) {
    const found = uncommittedAt(source.files, file.path);
    const state: DoneFileRow['state'] = found === null ? 'unknown'
      : found.state === 'uncommitted' ? 'uncommitted' : found.state;
    const lines = found !== null && found.state === 'uncommitted' ? found.lines : null;
    const add = lines === null ? null : lines.added;
    const del = lines === null ? null : lines.deleted;
    addTotal = addTotal === null || add === null ? null : addTotal + add;
    delTotal = delTotal === null || del === null ? null : delTotal + del;
    const row: DoneFileRow = {
      key: scopePath + '/' + file.path,
      rel: file.path + (file.certainty === 'possible' ? '（可能）' : ''),
      certainty: file.certainty,
      state,
      add,
      del,
      tasks: (taskRowsOfPath.get(file.path) ?? []).map((row) => ({
        taskId: row.ref.taskId, name: doneTaskTitle(row), state: taskStateOfRow(row) ?? 'cancelled',
      })),
    };
    const moduleId = file.moduleRef === null ? null : file.moduleRef.moduleId;
    const name = moduleId === null ? '未归属模块' : moduleId;
    const group = groups.get(name) ?? { name, path: '', files: [] };
    group.files.push(row);
    groups.set(name, group);
  }
  const groupRows = [...groups.values()].map((group) => {
    const add = group.files.every((file) => file.add !== null) ? group.files.reduce((sum, file) => sum + (file.add ?? 0), 0) : null;
    const del = group.files.every((file) => file.del !== null) ? group.files.reduce((sum, file) => sum + (file.del ?? 0), 0) : null;
    return { name: group.name, path: group.path, hasPath: false, add, del, files: group.files };
  });
  const empty = source.changeScope.files.length === 0;
  const note = empty ? '没有改动的文件'
    : '对照工作区，不是交付基线' + (source.taskFilesIncomplete ? '；可能不全' : '');
  return {
    n: source.changeScope.counts.files,
    countText: (source.changeScope.complete ? '' : '至少 ') + String(source.changeScope.counts.files) + ' 个文件',
    add: empty ? null : addTotal,
    del: empty ? null : delTotal,
    groups: groupRows,
    partial: true,
    note,
  };
}

function todoSectionOf(tasks: readonly TaskRow[]): DoneTodoSection {
  const later = tasks.filter((row) => row.definition.taskKind === 'work').map((row) => {
    const state = taskStateOfRow(row);
    if (state !== 'future' && state !== 'deferred') return null;
    return { taskId: row.ref.taskId, name: doneTaskTitle(row) + (state === 'deferred' ? '（已延后）' : ''), phase: state };
  }).filter((row): row is { taskId: string; name: string; phase: string } => row !== null);
  return { sum: '以后再做 ' + String(later.length) + ' 项', later };
}

function reworkSectionOf(source: DoneSource, tasks: readonly TaskRow[]): DoneReworkSection {
  const rows: DoneReworkSection['rows'] = [];
  let entries = 0;
  let automatic = 0;
  const taskIds: string[] = [];
  for (const row of tasks) {
    const state = taskStateOfRow(row);
    const reworks = row.rework?.entries ?? [];
    if (reworks.length > 0) {
      taskIds.push(row.ref.taskId);
      entries += reworks.length;
      const lines = reworkLines(row.rework);
      reworks.forEach((entry, index) => {
        if (entry.automatic) automatic += 1;
        rows.push({
          key: row.ref.taskId + ':rework:' + String(index),
          taskId: row.ref.taskId,
          name: doneTaskTitle(row),
          kind: 'rework',
          state: state ?? 'cancelled',
          failureClass: FAILURE_CLASS_WORD[entry.failureClass] ?? entry.failureClass,
          lines: [lines[index] ?? ''],
          sum: '第 ' + String(row.attemptOrdinal ?? '—') + ' 次尝试' + (state === 'satisfied' ? '通过' : ''),
        });
      });
    }
    const run = row.execution;
    const brief = run === null ? null : source.briefs[run.runId] ?? null;
    if (run !== null && brief !== null && brief.mode === 'resume_after_interruption') {
      rows.push({
        key: row.ref.taskId + ':cont',
        taskId: row.ref.taskId,
        name: doneTaskTitle(row),
        kind: 'cont',
        state: state ?? 'cancelled',
        failureClass: FAILURE_CLASS_WORD[brief.failureClass] ?? brief.failureClass,
        lines: briefRowsOf(brief).map((entry) => entry.k + '：' + entry.v),
        sum: '接续 1 次',
      });
    }
  }
  const cont = rows.filter((row) => row.kind === 'cont').length;
  return {
    sum: '返工 ' + String(taskIds.length) + ' 个任务，共 ' + String(entries) + ' 次 · 接续 ' + String(cont) + ' 次',
    rows,
    autoNote: automatic === 0 ? '没有自动返工' : '另有 ' + String(automatic) + ' 次自动返工',
  };
}

function usageSectionOf(source: DoneSource): DoneUsageSection {
  const roleOfRun = new Map<string, string>();
  for (const record of source.runs) roleOfRun.set(record.run.ref.runId, record.run.roleBinding.templateId);
  const byRole = new Map<string, { tokens: number; complete: boolean }>();
  let counted = 0;
  let uncounted = 0;
  for (const view of source.activity) {
    if (view.status !== 'counted') { uncounted += 1; continue; }
    counted += 1;
    const who = roleOfRun.get(view.runRef.runId) ?? '';
    const tokens = view.readings.usage.tokens;
    const previous = byRole.get(who) ?? { tokens: 0, complete: true };
    byRole.set(who, {
      tokens: previous.tokens + (tokens ?? 0),
      complete: previous.complete && tokens !== null && view.readings.usage.complete,
    });
  }
  const rows = [...byRole.entries()].map(([who, reading]) => ({
    who, tokens: reading.tokens, complete: reading.complete,
  }));
  const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  const note = [
    counted === 0 ? '没有计数的执行' : '',
    uncounted > 0 ? String(uncounted) + ' 次执行没有计数' : '',
    '请求数和工作时长没有读口，还没接通',
  ].filter((part) => part !== '').join('；');
  return { sum: '模型请求 — · ' + String(totalTokens) + ' token', rows, totalTokens, note };
}

function doneDelivery(source: DoneSource): DoneDelivery | null {
  const nav = source.nav;
  const goal = nav.goals.find((row) => row.goalId === nav.selectedGoalId) ?? null;
  if (goal === null) return null;
  const ordinal = goal.ordinal;
  const title = '交付' + (ordinal === null ? '' : ' · 目标 ' + String(ordinal));
  const round = source.round;
  const reqs = round === null ? [] : requirementsOf(round);
  return {
    goalId: goal.goalId,
    title,
    acc: { sum: accSumOf(source.deliveryState, round), reqs, note: policyNote(source.policy) },
    files: filesSectionOf(source),
    todo: todoSectionOf(nav.tasks?.tasks ?? []),
    rework: reworkSectionOf(source, nav.tasks?.tasks ?? []),
    usage: usageSectionOf(source),
  };
}

function doneCard(source: DoneSource, delivery: DoneDelivery | null, ordinal: number | null): DoneDeliveryCard | null {
  const phase = source.nav.selectedDisplay?.phase ?? '';
  if (phase !== 'COMPLETED' || delivery === null) return null;
  const number = ordinal === null ? '' : ' ' + String(ordinal);
  return {
    key: 'delivery',
    level: '要决定',
    title: '交付：目标' + number,
    line: '交付还等你验收：可以接受、部分接受，或者要求补做。',
    path: '目标' + number + ' / 交付',
    facts: [{ k: '现在', v: goalDisplayState('COMPLETED').word }],
    hasFacts: true,
    askRef: ordinal === null ? '交付' : '目标 ' + String(ordinal) + ' 的交付',
    actions: [{ key: 'redo', label: '要求补做' }, { key: 'partial', label: '部分接受' }],
    primary: { key: 'accept', label: '接受' },
  };
}

/** The inbox's two rows are links into the main conversation, never a second
 * queue read (§2.12/M4). The counts are written even at 0. */
function inboxRowsOf(nav: NavData): DoneData['inboxRows'] {
  const href = goalHref('Main.dc.html', nav.selectedGoalId);
  return [
    { href, title: '在主对话里处理', sq: 'sq z10 s-decide', name: '需要你决定', n: String(nav.inbox.decideN) },
    { href, title: '在主对话里查看', sq: 'sq z10 s-waiting', name: '请知悉', n: String(nav.inbox.noticeN) },
  ];
}

/** The one conversion of this package. `nav` is `readNav`'s chrome read; every
 * other field is a route value or a fold over one (§2.2). */
export function adaptDone(source: DoneSource): DoneData {
  const nav = source.nav;
  const delivery = nav.selectedGoalId === null ? null : doneDelivery(source);
  const goal = nav.goals.find((row) => row.goalId === nav.selectedGoalId) ?? null;
  const blank: DoneBlank = nav.selectedGoalId !== null ? null
    : nav.goals.length === 0 ? 'no_goal' : 'no_completed_goal';
  return {
    nav,
    inboxRows: inboxRowsOf(nav),
    blank,
    delivery,
    deliveryState: source.deliveryState,
    card: doneCard(source, delivery, goal === null ? null : goal.ordinal),
    reports: source.reports,
    reportError: source.reportError,
    progress: taskProgressOf(nav.tasks),
  };
}
