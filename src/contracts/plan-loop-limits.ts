/**
 * The plan-loop limits from `slice-PL-SPEC.md` §10.3: the per-size-class token
 * thresholds, the task line multiplier and the two stage budgets. Pure
 * defaults; the Host settings layer in a later slice publishes the effective
 * values.
 */
export type TaskSizeClassV1 = 'small' | 'medium' | 'large' | 'explore';

export type PlanLoopLimitsV1 = {
  schemaVersion: 1;
  taskReminderTokens: Record<TaskSizeClassV1, number>;
  taskTwoTimesTokens: Record<TaskSizeClassV1, number>;
  lineMultiplier: number;
  stageLineBudget: number;
  stageTokenBudget: number;
};

export const DEFAULT_PLAN_LOOP_LIMITS: Readonly<PlanLoopLimitsV1> = Object.freeze({
  schemaVersion: 1,
  taskReminderTokens: { small: 1_000_000, medium: 2_500_000, large: 4_000_000, explore: 4_000_000 },
  taskTwoTimesTokens: { small: 2_000_000, medium: 5_000_000, large: 8_000_000, explore: 8_000_000 },
  lineMultiplier: 2,
  stageLineBudget: 2_000,
  stageTokenBudget: 600_000_000,
});

/** §10.5: the measured conversion between cumulative tokens and growth units. */
export const GROWTH_UNIT_TOKENS = 64;

/** §10.5: the growth-unit conversion; `tokens` divided by 64, not rounded. */
export function growthUnitsOf(tokens: number): number {
  return tokens / GROWTH_UNIT_TOKENS;
}
