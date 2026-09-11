/**
 * Runtime budget.
 *
 * Two different things share this type and must not be conflated:
 *   - declared capacities (contextWindowTokens, perResponseTokens): what one model
 *     call may carry. They always have a value, are conservative by default and
 *     are the operator's declaration, not a probe of the provider's real window.
 *   - cumulative run limits (inputTokens, outputTokens, maxRequests, maxToolCalls,
 *     timeoutMs): a cap over the whole run. They are null unless the operator
 *     explicitly configures them. The platform never invents a run-wide token,
 *     call-count or wall-clock budget; usage is still recorded either way.
 */
export type RuntimeBudget = { contextWindowTokens: number; inputTokens: number | null; outputTokens: number | null; maxRequests: number | null; maxToolCalls: number | null; timeoutMs: number | null; perResponseTokens: number };
/**
 * No cumulative limit by default; the operator must opt in. The declared single
 * response capacity (4096) is the transport bound for one model answer, not a
 * run-wide budget: a smaller value truncates normal file-writing tool calls.
 */
export const DEFAULT_RUNTIME_BUDGET: RuntimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 };
/**
 * Normalize an untrusted budget value from the HTTP layer.
 *   - a missing value means "no cumulative limit" (declared capacities only);
 *   - cumulative fields may be null at any layer, and stay null: nothing here
 *     substitutes a hidden default cap;
 *   - declared capacities must be positive and stay within the transport bounds.
 */
export function validateRuntimeBudget(value: unknown, contextOnlyTask = false): RuntimeBudget {
  if (value === undefined) return { ...DEFAULT_RUNTIME_BUDGET };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('预算格式错误');
  const b = { ...DEFAULT_RUNTIME_BUDGET, ...value };
  const max: Record<keyof RuntimeBudget, number> = { contextWindowTokens: 1000000, inputTokens: 25000000, outputTokens: 128000, maxRequests: 128, maxToolCalls: 256, timeoutMs: 900000, perResponseTokens: contextOnlyTask ? 384000 : 8192 };
  const optional = new Set<keyof RuntimeBudget>(['inputTokens', 'outputTokens', 'maxRequests', 'maxToolCalls', 'timeoutMs']);
  for (const k of Object.keys(b) as (keyof RuntimeBudget)[]) {
    const v = b[k];
    if (optional.has(k) && v === null) continue;
    if (!Object.hasOwn(max, k) || typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0 || v > max[k]) throw Error('预算超出允许范围');
  }
  return b;
}
