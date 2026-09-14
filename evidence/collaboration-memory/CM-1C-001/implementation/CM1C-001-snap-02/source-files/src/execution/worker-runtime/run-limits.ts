import type { RuntimeBudget } from './model-budget.js';

/**
 * The kernel's RunLimits tuple, built from the platform budget.
 *
 * null means "no limit at this layer". The mapping is deliberately total: no
 * branch may replace a null cumulative limit with a hidden default, because the
 * operator did not configure one. Declared capacities (context window, single
 * response output) live in the model config, not here.
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

export function kernelRunLimits(budget: RuntimeBudget): KernelRunLimits {
  return {
    maxModelRequests: budget.maxRequests,
    maxToolCalls: budget.maxToolCalls,
    maxInputTokens: budget.inputTokens,
    maxOutputTokens: budget.outputTokens,
    maxTotalTokens: null,
    maxCostUsdMicros: null,
    deadlineMs: budget.timeoutMs,
  };
}
