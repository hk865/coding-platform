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
