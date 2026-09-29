import type { ModelTokenBudget } from './model-budget.js';
import type { RuntimeBudget } from './model-budget.js';

/**
 * The kernel's RunLimits tuple, built from the platform budget.
 *
 * null means "no limit at this layer". The mapping is deliberately total: no
 * branch may replace a null cumulative limit with a hidden default, because the
 * operator did not configure one. Declared capacities (context window, single
 * response output) live in the model config, not here.
 *
 * The persistent Run's `ModelTokenBudget` is a real cumulative constraint. Its
 * absolute `deadline` is turned into the remaining wall-clock budget against the
 * same trusted `now()` clock the meter uses; the earlier of the relative
 * `timeoutMs` and the absolute remainder wins. A null deadline contributes
 * nothing and a missing task budget keeps the exact legacy mapping.
 */
export type KernelRunLimits = {
  maxModelRequests: number | null;
  maxToolCalls: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  maxTotalTokens: number | null;
  maxCostUsdMicros: number | null;
  deadlineMs: number | null;
};

/** Shared deadline evaluation: the remaining milliseconds until the persistent
 * task deadline, or null when no absolute deadline is pinned. A passed deadline
 * yields 0 (never a negative Kernel limit). */
export function remainingTaskDeadlineMs(taskBudget: ModelTokenBudget | null | undefined, now: () => string): number | null {
  if (taskBudget === null || taskBudget === undefined || taskBudget.deadline === null) return null;
  const currentMs = Date.parse(now());
  const deadlineMs = Date.parse(taskBudget.deadline);
  if (!Number.isFinite(currentMs) || !Number.isFinite(deadlineMs)) {
    throw new Error('the persistent task deadline is not an ISO instant and cannot be evaluated');
  }
  return Math.max(0, deadlineMs - currentMs);
}

export function kernelRunLimits(budget: RuntimeBudget, taskBudget?: ModelTokenBudget, now?: () => string): KernelRunLimits {
  const maxTotalTokens = taskBudget === undefined ? null : taskBudget.tokenBudget;
  let deadlineMs = budget.timeoutMs;
  if (taskBudget !== undefined && taskBudget.deadline !== null) {
    if (now === undefined) throw new Error('unsupported: evaluating a persistent task deadline requires the trusted now() clock');
    const remaining = remainingTaskDeadlineMs(taskBudget, now)!;
    deadlineMs = deadlineMs === null ? remaining : Math.min(deadlineMs, remaining);
  }
  return {
    maxModelRequests: budget.maxRequests,
    maxToolCalls: budget.maxToolCalls,
    maxInputTokens: budget.inputTokens,
    maxOutputTokens: budget.outputTokens,
    maxTotalTokens,
    maxCostUsdMicros: null,
    deadlineMs,
  };
}
