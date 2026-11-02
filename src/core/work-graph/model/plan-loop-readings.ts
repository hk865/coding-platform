/**
 * The three Run readings from `slice-PL-SPEC.md` §10.4: cumulative tokens, the
 * context growth, and the confirmed changed lines.
 *
 * Pure: each function reads one already-recorded `RunActivityFactsV1` and adds
 * nothing. Unknown facts stay unknown (`null` plus the existing reason); they
 * are never written or returned as a complete zero.
 */
import type {
  LineReadingV1, RunActivityFactsV1, RunGrowthReadingV1, RunModelUsageV1, RunUsageReadingV1,
} from '../../../contracts/run-activity.js';
import type { PlanLoopLimitsV1 } from '../../../contracts/plan-loop-limits.js';

/** §10.4 (2): the growth reading; the first input is not counted. */
export function runGrowthOf(usage: RunModelUsageV1): RunGrowthReadingV1 {
  // 看不到最后一段（第 257 次起被截掉）：不补算。
  if (usage.omitted > 0) return { tokens: null, complete: false };
  const requests = usage.requests;
  if (requests.length === 0) return { tokens: null, complete: false };
  let complete = usage.complete;
  let sum = 0;
  // 第一次请求的 inputTokens 不计：从 i = 1 开始看相邻上涨。
  for (let i = 1; i < requests.length; i += 1) {
    const prev = requests[i - 1]!;
    const cur = requests[i]!;
    if (prev.usageStatus !== 'reported' || cur.usageStatus !== 'reported') {
      complete = false;                    // 跳过这一段，不跨过未知去接下一段
      continue;
    }
    sum += Math.max(0, (cur.inputTokens ?? 0) - (prev.inputTokens ?? 0));
  }
  const last = requests[requests.length - 1]!;
  if (last.usageStatus !== 'reported') return { tokens: null, complete: false };
  // 只有一次请求时 sum = 0，正好等于最后一次输出。
  return { tokens: sum + (last.outputTokens ?? 0), complete };
}

/** §10.4 (1): the cumulative tokens; cache is not deducted and unknown requests are skipped. */
export function runUsageOf(facts: RunActivityFactsV1): RunUsageReadingV1 {
  if (facts.status !== 'counted') {
    return { tokens: null, complete: false, growth: { tokens: null, complete: false }, reason: facts.reason };
  }
  const totals = facts.usage.totals;
  return {
    tokens: totals.inputTokens + totals.outputTokens,
    complete: facts.usage.complete && facts.usage.omitted === 0,
    growth: runGrowthOf(facts.usage),
    reason: null,
  };
}

/** §10.4 (3): the stored line total; a missing tally is unknown, not a complete zero. */
export function lineReadingOf(facts: RunActivityFactsV1): LineReadingV1 {
  if (facts.status !== 'counted') {
    return { added: null, deleted: null, complete: false, reason: facts.reason };
  }
  return {
    added: facts.changedLines.added,
    deleted: facts.changedLines.deleted,
    complete: facts.changedLines.complete,
    reason: null,
  };
}

/** §10.5: the stage reading, summed over the stage's tasks and their runs. */
export type StageReadingV1 = {
  usage: RunUsageReadingV1;
  lines: LineReadingV1;
  estimatedLines: number | null;
};

/** §10.5: aggregate the stage's tasks; unknown stays unknown, zero is never substituted. */
export function stageReadingOf(tasks: readonly {
  estimatedLines?: number;
  readings: readonly { usage: RunUsageReadingV1; lines: LineReadingV1 }[];
}[]): StageReadingV1 {
  const runs = tasks.flatMap((task) => task.readings);
  const usages = runs.map((run) => run.usage);
  const lines = runs.map((run) => run.lines);
  // 一条任务没写预估就是「未预估」，不拿 0 当它的预估。
  const estimatedLines = tasks.some((task) => task.estimatedLines === undefined)
    ? null
    : tasks.reduce((sum, task) => sum + (task.estimatedLines ?? 0), 0);
  return {
    usage: {
      tokens: sumOrNull(usages.map((usage) => usage.tokens)),
      // 任一 Run 未知（tokens 为 null）或不完整，阶段读数就不完整。
      complete: usages.every((usage) => usage.complete && usage.tokens !== null),
      growth: {
        tokens: sumOrNull(usages.map((usage) => usage.growth.tokens)),
        complete: usages.every((usage) => usage.growth.complete && usage.growth.tokens !== null),
      },
      reason: firstReason(usages),
    },
    lines: {
      added: sumOrNull(lines.map((line) => line.added)),
      deleted: sumOrNull(lines.map((line) => line.deleted)),
      complete: lines.every((line) => line.complete && line.added !== null && line.deleted !== null),
      reason: firstReason(lines),
    },
    estimatedLines,
  };
}

/** §10.5/§13.2.4: a strict over-line test that is false whenever the reading is unknown or incomplete. */
export function stageOverLine(reading: StageReadingV1, limits: PlanLoopLimitsV1): boolean {
  if (reading.estimatedLines === null) return false;
  if (reading.usage.tokens === null || !reading.usage.complete) return false;
  // 严格大于：正好在预算上不算超线。
  return reading.estimatedLines > limits.stageLineBudget || reading.usage.tokens > limits.stageTokenBudget;
}

/**
 * §10.5: an empty set sums to 0; when every entry is unknown the field is
 * unknown (null); a mix sums the known part and the aggregate stays incomplete
 * (`complete: false` at the caller), never discarding the known lower bound.
 */
function sumOrNull(values: readonly (number | null)[]): number | null {
  if (values.length === 0) return 0;
  let sum = 0;
  let known = 0;
  for (const value of values) {
    if (value === null) continue;
    sum += value;
    known += 1;
  }
  return known === 0 ? null : sum;
}

/** 第一条非空原因，读失败的原因沿聚合往上带。 */
function firstReason(readings: readonly { reason: string | null }[]): string | null {
  for (const reading of readings) {
    if (reading.reason !== null) return reading.reason;
  }
  return null;
}
