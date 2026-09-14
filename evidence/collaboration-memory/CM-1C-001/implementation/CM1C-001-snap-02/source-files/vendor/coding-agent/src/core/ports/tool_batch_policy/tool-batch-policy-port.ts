/**
 * 模块职责：定义一次模型返回的多个 ToolCall 应如何分组执行。
 *
 * 设计边界：策略只划分执行组，不实际运行工具，也不判断权限。
 * 关键流程：Runner 先请求分组；默认实现把每个调用拆成单独组，从而串行执行。
 */
import type { ToolCall } from "../tool_executor/tool-executor-port.js";

export interface ToolExecutionGroup {
  readonly mode: "serial" | "parallel_read_only";
  readonly callIds: readonly string[];
}

export interface ToolBatchPolicy {
  plan(calls: readonly Readonly<ToolCall>[]): readonly ToolExecutionGroup[];
}

export class SerialToolBatchPolicy implements ToolBatchPolicy {
  plan(calls: readonly Readonly<ToolCall>[]): readonly ToolExecutionGroup[] {
    return calls.map((call) => ({ mode: "serial", callIds: [call.callId] }));
  }
}
