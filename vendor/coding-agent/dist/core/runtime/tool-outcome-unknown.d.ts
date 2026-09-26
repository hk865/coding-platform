/**
 * 模块职责：构造「结果未知」的模型可见合成 ToolResult 与 tool.outcome_unknown 事件 payload。
 *
 * 设计边界：合成结果只是事实缺失时的诚实占位，不得伪装成工具的真实返回；
 * 它明确声明副作用可能已发生并禁止自动重试，供下一轮模型与审计视图阅读。
 */
import type { FailedToolResult, ToolCall, ToolEffectClass } from "../ports/tool_executor/tool-executor-port.js";
import type { ExtractAgentEventPayload } from "./events/agent-events.js";
export type ToolOutcomeUnknownReason = "process_interrupted" | "cancelled_while_running";
export declare function synthesizeOutcomeUnknownResult(call: Pick<ToolCall, "callId" | "name">, reason: ToolOutcomeUnknownReason, effectClass: ToolEffectClass): FailedToolResult;
export declare function outcomeUnknownPayload(call: Pick<ToolCall, "callId" | "name">, reason: ToolOutcomeUnknownReason, effectClass: ToolEffectClass, recordedCallEventId: string): ExtractAgentEventPayload<"tool.outcome_unknown">;
//# sourceMappingURL=tool-outcome-unknown.d.ts.map