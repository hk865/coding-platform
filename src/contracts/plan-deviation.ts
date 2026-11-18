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
import type { FailingCheckOutputV1, InstalledCheckOriginV1 } from './check-output.js';
import type { RunRef, TaskTriple } from './dispatch.js';
import type { GoalRef } from './ledger.js';
import type { Disposition } from './plan.js';
import type { PlanLoopLimitsV1, TaskSizeClassV1 } from './plan-loop-limits.js';
import type {
  LineReadingV1, RunChangedFilesV1, RunUsageReadingV1,
} from './run-activity.js';
import type { TaskFailureFactsV1 } from './task-failure.js';
import { verbatimLines } from './verbatim.js';

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

/** §7.1.1 第五项的标题行。人的请知悉在这一行之前截住（`plan-notices.ts` 的 `storedFactsOf`），只给参谋看。 */
export const DEVIATION_FAILING_CHECKS_TITLE = 'failing checks (command and output verbatim, not JSON):';
/**
 * 第五项（标题行、各条和最后那句省略说明）合计至多这么多 UTF-8 字节。加上路径清单的 48 KiB、请求号和其余几行，
 * 仍在 64 KiB 的系统轮上限之内。
 */
const DEVIATION_TEXT_CHECKS_MAX_BYTES = 8 * 1024;

function checkOriginText(origin: InstalledCheckOriginV1 | null): string {
  if (origin === null) return 'unknown (no installed check has this content now)';
  if (origin.kind === 'approved_list') return `approved check list, answer of Query ${origin.answerRef.queryJobId}`;
  if (origin.kind === 'plan') return `plan candidate ${origin.proposalRef.proposalId}, approved by ${origin.approvedBy}`;
  return 'Host start-up configuration';
}

/** 一条没过的检查：一行概要，命令原文和一路输出的末尾放进代码块（照原样，不是 JSON）；stderr 空的话给 stdout。 */
function failingCheckBlock(output: FailingCheckOutputV1): string {
  const observed = output.observed;
  const ending = observed === null ? `report not readable: ${output.unreadable ?? ''}`
    : observed.outcome === 'timed_out' ? 'timed out'
      : observed.outcome === 'killed' ? `killed${observed.exitCode === null ? '' : ` (exit ${observed.exitCode})`}`
        : observed.outcome === 'not_started' ? `not started: ${observed.stderrTail}`
          : `exit ${observed.exitCode}`;
  const taskIds = output.taskIds === 'all' ? 'all' : output.taskIds.join(', ');
  const lines = [
    `- ${output.checkId} (${output.kind}; taskIds: ${taskIds}; installed by: ${checkOriginText(output.origin)}): ${ending}`,
    '  command:', ...verbatimLines(output.command.text, '  '),
  ];
  if (output.command.truncated) lines.push('  (command truncated)');
  if (observed !== null && observed.outcome !== 'not_started') {
    if (observed.stderrTail !== '') lines.push('  stderr tail:', ...verbatimLines(observed.stderrTail, '  '));
    else if (observed.stdoutTail !== '') lines.push('  stderr is empty; stdout tail:', ...verbatimLines(observed.stdoutTail, '  '));
    else lines.push('  stderr and stdout are empty');
  }
  return lines.join('\n');
}

/**
 * 第五项：按顺序放，放不下的那一条和其后的都不列，最后写一句还有几条（写法同 `changedFilesList` 的预算）。省略说明也
 * 算在 8 KiB 里：加上它超了，就再去掉最后一整条，直到放得下。
 */
function failingChecksText(outputs: readonly FailingCheckOutputV1[]): string {
  let remaining = DEVIATION_TEXT_CHECKS_MAX_BYTES - Buffer.byteLength(DEVIATION_FAILING_CHECKS_TITLE, 'utf8');
  const listed: string[] = [];
  for (const output of outputs) {
    const block = failingCheckBlock(output);
    const cost = 1 + Buffer.byteLength(block, 'utf8');
    if (cost > remaining) break;
    remaining -= cost;
    listed.push(block);
  }
  const omission = (omitted: number): string => `${omitted} more failing checks not listed (see the round card)`;
  // 标题加省略说明一百来字节，去到一条不剩一定放得下，所以 pop 不会落空。
  while (listed.length < outputs.length
    && 1 + Buffer.byteLength(omission(outputs.length - listed.length), 'utf8') > remaining) {
    remaining += 1 + Buffer.byteLength(listed.pop()!, 'utf8');
  }
  const omitted = outputs.length - listed.length;
  return [DEVIATION_FAILING_CHECKS_TITLE, ...listed, ...(omitted === 0 ? [] : [omission(omitted)])].join('\n');
}

/**
 * §7.1.1 的四项：用量、改动文件和行数、任务书、停因；`stop` 再加第五项：没过的登记检查（命令原文、出处、退出码、
 * 输出末尾）。没给输出时正文和只有四项时一字不差。
 * A missing reading says unknown with its reason; it is never written as 0.
 */
export function deviationText(d: DeviationV1, taskBookPath: string | null,
  failingChecks: readonly FailingCheckOutputV1[] = []): string {
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
    ...(failingChecks.length === 0 ? [] : [failingChecksText(failingChecks)]),
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
