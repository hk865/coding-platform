/**
 * 模块职责：集中检查步数、模型调用、工具调用、运行时长和 token 等运行上限。
 *
 * 设计边界：这里只报告超限项，不决定暂停、失败或生成哪个终止事件。
 * 关键流程：Runner 在关键边界用当前状态和时间检查，发现 violation 后转成确定性事件。
 */
import { z } from "zod";

import type { RunState } from "../state/run-state.js";

const optionalPositiveLimit = z.number().int().positive().nullable();

export const runLimitsSchema = z
  .object({
    maxModelRequests: optionalPositiveLimit,
    maxToolCalls: optionalPositiveLimit,
    maxInputTokens: optionalPositiveLimit,
    maxOutputTokens: optionalPositiveLimit,
    maxTotalTokens: optionalPositiveLimit,
    maxCostUsdMicros: optionalPositiveLimit,
    deadlineMs: optionalPositiveLimit,
  })
  .strict();

export type RunLimits = z.infer<typeof runLimitsSchema>;
export type LimitName =
  | "model_requests"
  | "tool_calls"
  | "input_tokens"
  | "output_tokens"
  | "total_tokens"
  | "cost"
  | "deadline";

export interface LimitViolation {
  readonly limit: LimitName;
  readonly observed: number;
  readonly allowed: number;
}

export const UNLIMITED_RUN_LIMITS: RunLimits = Object.freeze({
  maxModelRequests: null,
  maxToolCalls: null,
  maxInputTokens: null,
  maxOutputTokens: null,
  maxTotalTokens: null,
  maxCostUsdMicros: null,
  deadlineMs: null,
});

function exceeded(
  observed: number,
  allowed: number | null,
  limit: LimitName,
): LimitViolation | null {
  return allowed !== null && observed > allowed ? { limit, observed, allowed } : null;
}

export class LimitGuard {
  readonly limits: RunLimits;

  constructor(limits: Readonly<RunLimits> = UNLIMITED_RUN_LIMITS) {
    this.limits = runLimitsSchema.parse(limits);
  }

  beforeModel(state: Readonly<RunState>): LimitViolation | null {
    return exceeded(
      state.usage.modelRequestCount + 1,
      this.limits.maxModelRequests,
      "model_requests",
    );
  }

  beforeTool(state: Readonly<RunState>): LimitViolation | null {
    return exceeded(state.usage.toolCallCount + 1, this.limits.maxToolCalls, "tool_calls");
  }

  afterUsage(state: Readonly<RunState>): LimitViolation | null {
    return (
      exceeded(state.usage.inputTokens, this.limits.maxInputTokens, "input_tokens") ??
      exceeded(state.usage.outputTokens, this.limits.maxOutputTokens, "output_tokens") ??
      exceeded(
        state.usage.inputTokens + state.usage.outputTokens,
        this.limits.maxTotalTokens,
        "total_tokens",
      ) ??
      (state.usage.costUsdMicros === null
        ? null
        : exceeded(state.usage.costUsdMicros, this.limits.maxCostUsdMicros, "cost"))
    );
  }

  atElapsed(elapsedMs: number): LimitViolation | null {
    if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0) {
      throw new RangeError("elapsedMs 必须是非负安全整数");
    }
    return exceeded(elapsedMs, this.limits.deadlineMs, "deadline");
  }

  requiresKnownCost(): boolean {
    return this.limits.maxCostUsdMicros !== null;
  }
}
