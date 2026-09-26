/**
 * 模块职责：集中检查步数、模型调用、工具调用、运行时长和 token 等运行上限。
 *
 * 设计边界：这里只报告超限项，不决定暂停、失败或生成哪个终止事件。
 * 关键流程：Runner 在关键边界用当前状态和时间检查，发现 violation 后转成确定性事件。
 */
import { z } from "zod";
import type { RunState } from "../state/run-state.js";
export declare const runLimitsSchema: z.ZodObject<{
    maxModelRequests: z.ZodNullable<z.ZodNumber>;
    maxToolCalls: z.ZodNullable<z.ZodNumber>;
    maxInputTokens: z.ZodNullable<z.ZodNumber>;
    maxOutputTokens: z.ZodNullable<z.ZodNumber>;
    maxTotalTokens: z.ZodNullable<z.ZodNumber>;
    maxCostUsdMicros: z.ZodNullable<z.ZodNumber>;
    deadlineMs: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>;
export type RunLimits = z.infer<typeof runLimitsSchema>;
export type LimitName = "model_requests" | "tool_calls" | "input_tokens" | "output_tokens" | "total_tokens" | "cost" | "deadline";
export interface LimitViolation {
    readonly limit: LimitName;
    readonly observed: number;
    readonly allowed: number;
}
export declare const UNLIMITED_RUN_LIMITS: RunLimits;
export declare class LimitGuard {
    readonly limits: RunLimits;
    constructor(limits?: Readonly<RunLimits>);
    beforeModel(state: Readonly<RunState>): LimitViolation | null;
    beforeTool(state: Readonly<RunState>): LimitViolation | null;
    afterUsage(state: Readonly<RunState>): LimitViolation | null;
    atElapsed(elapsedMs: number): LimitViolation | null;
    requiresKnownCost(): boolean;
}
//# sourceMappingURL=limit-guard.d.ts.map