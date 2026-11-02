/**
 * The shared deviation table (`slice-PL-SPEC.md` §7.5, §10.3, §13.2.4).
 *
 * Pure: `deviationsOfGoal` judges the already-aggregated Task facts and never
 * reads I/O, recomputes a reading or sends anything. Workflow's `selectNext`
 * and WorkGraph's `readGoalDecisionCauses` import this one copy, so the
 * deviation a round is opened for and the card that says nobody can take it
 * are the same judgment.
 *
 * §13.2.4: the reminder line only notifies; the two-times line and the line
 * overrun open one round each; a hard stop (`budget`/`stop`) on the same Task
 * suppresses the soft lines. Every judgment is separate per kind and per
 * `(taskId, kind, planRevision)`.
 */
import type { RunRef, TaskTriple } from './dispatch.js';
import type { GoalRef } from './ledger.js';
import type { Disposition } from './plan.js';
import type { PlanLoopLimitsV1, TaskSizeClassV1 } from './plan-loop-limits.js';
import type {
  LineReadingV1, RunChangedFilesV1, RunUsageReadingV1,
} from './run-activity.js';
import type { TaskFailureFactsV1 } from './task-failure.js';

/** §7.5: the four platform discoveries. A reminder is not a fifth kind. */
export type DeviationKindV1 = 'growth' | 'lines' | 'budget' | 'stop';
/** §7.1.1: the two stop causes `stop` carries in its body. */
export type DeviationStopReasonV1 = 'auto_rework_cap_reached' | 'no_new_basis';

/** The file projection of one Task's confirmed activity (never a second snapshot). */
export type DeviationChangedFilesV1 = {
  definite: readonly string[];
  possible: readonly string[];
  possiblyIncomplete: boolean;
};

/**
 * §7.5: one deviation. The two read-only additions are §7.5's body facts: the
 * changed-file paths (reused from `GoalExecutedFilesPort`) and the budget's
 * `minTokenBudgetExclusive` (reused from the failure verdict).
 */
export type DeviationV1 = {
  kind: DeviationKindV1;
  goalRef: GoalRef;
  taskRef: TaskTriple;
  /** The triggering Run's plan revision; a Run-less stop uses the current plan's. */
  planRevision: number;
  /** growth/lines/budget always name their Run; a Run-less stop keeps null. */
  runRef: RunRef | null;
  stopReason: DeviationStopReasonV1 | null;
  usage: RunUsageReadingV1 | null;
  lines: LineReadingV1 | null;
  estimatedLines: number | null;
  changedFiles: DeviationChangedFilesV1 | null;
  minTokenBudgetExclusive: number | null;
};

/**
 * §7.5 + rulings: the facts one Task presents to the pure table. The readings
 * are the already-aggregated Task totals; the trigger basis names the Run that
 * crossed the line and the plan revision it ran under. The raw
 * `runs[].facts` shape is gone.
 */
export type DeviationTaskFactsV1 = {
  taskId: string;
  disposition: Disposition;
  /** A Task with no size class only accumulates (never reminds or opens `growth`). */
  sizeClass?: TaskSizeClassV1;
  estimatedLines?: number;
  stageId?: string;
  failure: Pick<TaskFailureFactsV1, 'runRef' | 'automation'> | null;
  usage: RunUsageReadingV1 | null;
  lines: LineReadingV1 | null;
  changedFiles: DeviationChangedFilesV1 | null;
  trigger: { runRef: RunRef; planRevision: number } | null;
};

/** §7.5: the pure input. `limits` is the Host's effective value, injected per round. */
export type DeviationInputV1 = {
  goal: { ref: GoalRef; desiredState: 'active' | 'paused' | 'cancelled' };
  plan: { planRevision: number; tasks: readonly DeviationTaskFactsV1[] };
  limits: PlanLoopLimitsV1;
};

/** A separate description for the reminder line (§7.1 row 3), never a `DeviationKindV1`. */
export type TaskReminderV1 = {
  goalRef: GoalRef;
  taskRef: TaskTriple;
  planRevision: number;
  sizeClass: TaskSizeClassV1;
  growthTokens: number;
};

/** §13.2.4: the strict line overrun; unknown or incomplete readings never trigger. */
export function lineOverrun(
  reading: LineReadingV1,
  estimatedLines: number | null | undefined,
  limits: PlanLoopLimitsV1,
): boolean {
  if (estimatedLines === null || estimatedLines === undefined) return false;
  if (!reading.complete || reading.added === null || reading.deleted === null) return false;
  // 严格大于：正好 lineMultiplier × estimatedLines 不算超线。
  return reading.added + reading.deleted > limits.lineMultiplier * estimatedLines;
}

/** §7.1.1: `deviation:<goalId>:<taskId>:<kind>:<planRevision>`. */
export function deviationRequestId(d: DeviationV1): string {
  return `deviation:${d.goalRef.goalId}:${d.taskRef.taskId}:${d.kind}:${d.planRevision}`;
}

function usageText(usage: RunUsageReadingV1 | null): string {
  if (usage === null || usage.tokens === null) {
    return usage === null
      ? 'usage: unknown'
      : `usage: unknown (${usage.reason ?? 'no complete reading'})`;
  }
  const total = usage.complete ? `${usage.tokens}` : `at least ${usage.tokens}, incomplete`;
  const growth = usage.growth.tokens === null
    ? 'growth: unknown'
    : `growth: ${usage.growth.complete ? `${usage.growth.tokens}` : `at least ${usage.growth.tokens}, incomplete`}`;
  return `usage: ${total}; ${growth}`;
}

function linesText(lines: LineReadingV1 | null): string {
  if (lines === null || lines.added === null || lines.deleted === null) {
    return lines === null ? 'lines: unknown' : `lines: unknown (${lines.reason ?? 'no complete reading'})`;
  }
  const total = `${lines.added + lines.deleted} (added ${lines.added}, deleted ${lines.deleted})`;
  return `lines: ${lines.complete ? total : `at least ${total}, incomplete`}`;
}

/**
 * §7.5: the most UTF-8 bytes the changed-file path list may take. The 64 KiB
 * system-round body also carries the request id, the header and the other
 * facts; this leaves 16 KiB of headroom for them and the omission sentence.
 */
const DEVIATION_TEXT_PATH_MAX_BYTES = 48 * 1024;

/** The paths that fit the remaining byte budget, plus one omission sentence. */
function changedFilesList(paths: readonly string[], remaining: { bytes: number }): string {
  const listed: string[] = [];
  for (const path of paths) {
    const cost = (listed.length === 0 ? 0 : 2) + Buffer.byteLength(path, 'utf8');
    if (cost > remaining.bytes) break;
    remaining.bytes -= cost;
    listed.push(path);
  }
  const omitted = paths.length - listed.length;
  if (omitted === 0) return listed.join(', ');
  return `${listed.length === 0 ? '' : `${listed.join(', ')}, `}另有 ${omitted} 个未列出`;
}

/** The two counts stay written even when the byte budget stops the path list. */
function changedFilesText(files: DeviationChangedFilesV1): string {
  const remaining = { bytes: DEVIATION_TEXT_PATH_MAX_BYTES };
  const definite = files.definite.length === 0 ? '' : ` (${changedFilesList(files.definite, remaining)})`;
  const possible = files.possible.length === 0 ? '' : ` (${changedFilesList(files.possible, remaining)})`;
  return `changed files: ${files.definite.length} definite${definite}`
    + `, ${files.possible.length} possible${possible}`
    + `${files.possiblyIncomplete ? ' (possibly incomplete)' : ''}`;
}

/**
 * §7.1.1's four items: usage, changed files/lines, taskbook and stop cause.
 * A missing reading says unknown with its reason; it is never written as 0.
 */
export function deviationText(d: DeviationV1, taskBookPath: string | null): string {
  const files = d.changedFiles === null ? 'changed files: unknown' : changedFilesText(d.changedFiles);
  const taskBook = taskBookPath ?? `plan revision ${d.planRevision}, task ${d.taskRef.taskId}`;
  const stop = d.kind === 'budget'
    ? `stop cause: budget_exhausted (min token budget exclusive: ${d.minTokenBudgetExclusive ?? 'unknown'})`
    : d.kind === 'stop'
      ? `stop cause: ${d.stopReason ?? 'unknown'}`
      : 'stop cause: none';
  return [
    `departure for task ${d.taskRef.taskId} at plan revision ${d.planRevision} (${d.kind})`,
    usageText(d.usage),
    `${files}; ${linesText(d.lines)}`,
    `taskbook: ${taskBook}`,
    stop,
  ].join('\n');
}

function hardDeviationOf(
  input: DeviationInputV1, task: DeviationTaskFactsV1,
): DeviationV1 | null {
  const failure = task.failure;
  if (failure === null) return null;
  const verdict = failure.automation.verdict;
  if (verdict.kind !== 'stopped') return null;
  if (verdict.reason !== 'budget_exhausted' && verdict.reason !== 'auto_rework_cap_reached'
    && verdict.reason !== 'no_new_basis') return null;
  const runRef = failure.runRef;
  const trigger = task.trigger;
  const planRevision = trigger !== null && runRef !== null
    && trigger.runRef.runId === runRef.runId ? trigger.planRevision : input.plan.planRevision;
  const base = {
    goalRef: input.goal.ref,
    taskRef: { projectId: input.goal.ref.projectId, goalId: input.goal.ref.goalId, taskId: task.taskId },
    planRevision,
    runRef,
    usage: task.usage,
    lines: task.lines,
    estimatedLines: task.estimatedLines ?? null,
    changedFiles: task.changedFiles,
  };
  if (verdict.reason === 'budget_exhausted') {
    return { ...base, kind: 'budget', stopReason: null,
      minTokenBudgetExclusive: verdict.detail.minTokenBudgetExclusive ?? null };
  }
  return { ...base, kind: 'stop', stopReason: verdict.reason, minTokenBudgetExclusive: null };
}

function softDeviationOf(
  input: DeviationInputV1, task: DeviationTaskFactsV1, kind: 'growth' | 'lines',
): DeviationV1 | null {
  const trigger = task.trigger;
  // A soft line is always crossed by a Run that ran under a plan revision.
  if (trigger === null) return null;
  const base = {
    goalRef: input.goal.ref,
    taskRef: { projectId: input.goal.ref.projectId, goalId: input.goal.ref.goalId, taskId: task.taskId },
    planRevision: trigger.planRevision,
    runRef: trigger.runRef,
    usage: task.usage,
    lines: task.lines,
    estimatedLines: task.estimatedLines ?? null,
    changedFiles: task.changedFiles,
    stopReason: null,
    minTokenBudgetExclusive: null,
  };
  if (kind === 'growth') {
    const sizeClass = task.sizeClass;
    if (sizeClass === undefined) return null;
    const growth = task.usage?.growth;
    if (growth === undefined || growth === null || growth.tokens === null || !growth.complete) return null;
    if (growth.tokens < input.limits.taskTwoTimesTokens[sizeClass]) return null;
    return { ...base, kind: 'growth' };
  }
  if (task.lines === null) return null;
  if (!lineOverrun(task.lines, task.estimatedLines, input.limits)) return null;
  return { ...base, kind: 'lines' };
}

/**
 * §7.5 exit: every Task is judged separately and the result is empty when
 * nothing needs a round. A Task with a hard stop yields only that stop; the
 * soft lines stay informational (`deviationText` still carries the readings).
 */
export function deviationsOfGoal(input: DeviationInputV1): DeviationV1[] {
  const deviations: DeviationV1[] = [];
  for (const task of input.plan.tasks) {
    if (task.disposition !== 'active') continue;
    const hard = hardDeviationOf(input, task);
    if (hard !== null) {
      deviations.push(hard);
      continue;
    }
    const growth = softDeviationOf(input, task, 'growth');
    if (growth !== null) deviations.push(growth);
    const lines = softDeviationOf(input, task, 'lines');
    if (lines !== null) deviations.push(lines);
  }
  return deviations;
}

/**
 * §7.1 row 3 / §10.3: the reminder line per Task and size class. It returns a
 * description only; it is not a deviation and opens no round.
 */
export function taskRemindersOfGoal(input: DeviationInputV1): TaskReminderV1[] {
  const reminders: TaskReminderV1[] = [];
  for (const task of input.plan.tasks) {
    if (task.disposition !== 'active' || task.sizeClass === undefined) continue;
    const growth = task.usage?.growth;
    if (growth === undefined || growth === null || growth.tokens === null || !growth.complete) continue;
    if (growth.tokens < input.limits.taskReminderTokens[task.sizeClass]) continue;
    reminders.push({
      goalRef: input.goal.ref,
      taskRef: { projectId: input.goal.ref.projectId, goalId: input.goal.ref.goalId, taskId: task.taskId },
      planRevision: task.trigger?.planRevision ?? input.plan.planRevision,
      sizeClass: task.sizeClass,
      growthTokens: growth.tokens,
    });
  }
  return reminders;
}
