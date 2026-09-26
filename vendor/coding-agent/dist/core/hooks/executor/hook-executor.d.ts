/**
 * 模块职责：按注册顺序执行模型前、工具前和工具后的 Hook，并合并修改结果。
 *
 * 设计边界：Hook 只能通过协议化决策影响流程；本模块不负责注册持久化或业务策略。
 * 关键流程：冻结注册表，逐个限时调用 Hook，校验返回值，遇到短路决策立即结束。
 */
import type { ModelRequest } from "../../ports/model_client/model-client-port.js";
import type { ToolCall, ToolResult } from "../../ports/tool_executor/tool-executor-port.js";
import type { RunState } from "../../runtime/state/run-state.js";
import type { AfterToolHookDecision, BeforeModelHookDecision, BeforeToolHookDecision } from "../protocol/hook-protocol.js";
import { HookRegistry } from "../registry/hook-registry.js";
export declare class HookExecutionError extends Error {
    readonly code: "hook_timeout" | "hook_failed" | "hook_invalid_result";
    readonly hookId: string;
    constructor(code: "hook_timeout" | "hook_failed" | "hook_invalid_result", message: string, hookId: string);
}
export declare class HookExecutor {
    #private;
    constructor(registry?: HookRegistry, timeoutMs?: number | null);
    beforeModel(state: Readonly<RunState>, request: Readonly<ModelRequest>, signal: AbortSignal): Promise<BeforeModelHookDecision>;
    beforeTool(state: Readonly<RunState>, call: Readonly<ToolCall>, signal: AbortSignal): Promise<BeforeToolHookDecision>;
    afterTool(state: Readonly<RunState>, result: Readonly<ToolResult>, signal: AbortSignal): Promise<AfterToolHookDecision>;
}
//# sourceMappingURL=hook-executor.d.ts.map