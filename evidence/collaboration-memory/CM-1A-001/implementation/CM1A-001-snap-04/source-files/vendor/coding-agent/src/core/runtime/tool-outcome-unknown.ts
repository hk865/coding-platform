/**
 * 模块职责：构造「结果未知」的模型可见合成 ToolResult 与 tool.outcome_unknown 事件 payload。
 *
 * 设计边界：合成结果只是事实缺失时的诚实占位，不得伪装成工具的真实返回；
 * 它明确声明副作用可能已发生并禁止自动重试，供下一轮模型与审计视图阅读。
 */
import type {
  FailedToolResult,
  ToolCall,
  ToolEffectClass,
} from "../ports/tool_executor/tool-executor-port.js";
import type { ExtractAgentEventPayload } from "./events/agent-events.js";

export type ToolOutcomeUnknownReason = "process_interrupted" | "cancelled_while_running";

const REASON_TEXT: Record<ToolOutcomeUnknownReason, string> = {
  process_interrupted:
    "工具已经开始执行，但 Runtime 进程中断，没有持久化的执行结果。该工具可能已经产生副作用；系统不能自动重试。请检查工作区或外部系统的实际状态，确认没有副作用或副作用已消除后，才能安全地重新执行。",
  cancelled_while_running:
    "工具已经开始执行，但在运行期间被强制取消，且没有返回可用的取消结果。该工具可能已经产生副作用；系统不能自动重试。请检查工作区或外部系统的实际状态，确认没有副作用或副作用已消除后，才能安全地重新执行。",
};

export function synthesizeOutcomeUnknownResult(
  call: Pick<ToolCall, "callId" | "name">,
  reason: ToolOutcomeUnknownReason,
  effectClass: ToolEffectClass,
): FailedToolResult {
  return {
    schemaVersion: 1,
    callId: call.callId,
    status: "error",
    error: {
      code: "outcome_unknown",
      message: `工具 ${call.name} 的结果未知（${reason}）`,
      retryable: false,
    },
    output: [
      {
        kind: "text",
        text: REASON_TEXT[reason],
      },
    ],
    effects: {
      sideEffect: effectClass === "read_only" ? "none" : "possible",
      changedPaths: [],
      workspaceRevision: null,
      artifactRefs: [],
    },
  };
}

export function outcomeUnknownPayload(
  call: Pick<ToolCall, "callId" | "name">,
  reason: ToolOutcomeUnknownReason,
  effectClass: ToolEffectClass,
  recordedCallEventId: string,
): ExtractAgentEventPayload<"tool.outcome_unknown"> {
  return {
    callId: call.callId,
    toolName: call.name,
    effectClass,
    reason,
    retryPolicy: "never_automatic",
    recordedCallEventId,
    synthesizedResult: synthesizeOutcomeUnknownResult(call, reason, effectClass),
  };
}
