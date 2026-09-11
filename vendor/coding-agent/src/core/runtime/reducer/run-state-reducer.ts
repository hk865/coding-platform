/**
 * 模块职责：把一个合法 AgentEvent 纯函数地归约为新的 RunState。
 *
 * 设计边界：Reducer 不执行 I/O、不产生事件，也不容忍非法转换或破坏状态不变量。
 * 关键流程：先校验事件和转换，再按事件类型更新副本，最后校验完整状态并返回。
 */
import { agentEventSchema, validateTransition } from "../events/agent-events.js";
import type { AgentEvent } from "../events/agent-events.js";
import { runStateSchema, validateRunStateInvariants } from "../state/run-state.js";
import type {
  RunOutcome,
  RunState,
  ToolBatchState,
  ToolExecutionState,
} from "../state/run-state.js";
import type { ModelUsage } from "../../ports/model_client/model-client-port.js";

export class ReducerError extends Error {
  constructor(
    readonly code: "transition_rejected" | "state_invalid",
    message: string,
  ) {
    super(message);
    this.name = "ReducerError";
  }
}

function addUsage(state: RunState, delta: ModelUsage): RunState["usage"] {
  const isFirstRecordedRequest =
    state.usage.modelRequestCount === 1 &&
    state.usage.inputTokens === 0 &&
    state.usage.outputTokens === 0 &&
    state.usage.cachedInputTokens === 0 &&
    state.usage.costUsdMicros === null;
  const costUsdMicros =
    delta.costUsdMicros === null
      ? null
      : state.usage.costUsdMicros === null
        ? isFirstRecordedRequest
          ? delta.costUsdMicros
          : null
        : state.usage.costUsdMicros + delta.costUsdMicros;

  return {
    ...state.usage,
    inputTokens: state.usage.inputTokens + delta.inputTokens,
    outputTokens: state.usage.outputTokens + delta.outputTokens,
    cachedInputTokens: state.usage.cachedInputTokens + delta.cachedInputTokens,
    costUsdMicros,
  };
}

function settleToolBatch(
  batch: ToolBatchState,
  updatedCall: ToolExecutionState,
): { readonly batch: ToolBatchState | null; readonly results: readonly ToolExecutionState[] } {
  const calls = batch.calls.map((call) =>
    call.requestedCall.callId === updatedCall.requestedCall.callId ? updatedCall : call,
  );
  const settled = calls.every((call) =>
    ["completed", "failed", "cancelled", "outcome_unknown"].includes(call.status),
  );
  return {
    batch: settled ? null : { ...batch, calls },
    results: settled ? [...calls].sort((left, right) => left.ordinal - right.ordinal) : [],
  };
}

function abandonUnsettledTools(batch: ToolBatchState | null): ToolBatchState | null {
  if (!batch) return null;
  return {
    ...batch,
    calls: batch.calls.map((call) => {
      if (call.status === "pending") return { ...call, status: "abandoned" as const };
      // 已开始但 Run 结束前未取得结果的调用：结果未知（兜底标记，不携带伪造结果）。
      if (call.status === "running") return { ...call, status: "outcome_unknown" as const };
      return call;
    }),
  };
}

function terminalState(
  state: RunState,
  event: AgentEvent,
  status: "completed" | "cancelled" | "limit_exceeded" | "failed",
  outcome: RunOutcome,
): RunState {
  const toolBatch = abandonUnsettledTools(state.toolBatch);
  // 部分结算的批（settle 未完成时仍留在 toolBatch 中）可能已经带确定/合成结果：
  // 终态前必须冲刷进 transcript，否则多组 ToolCall 下崩溃恢复时这些结果在状态层不可见。
  const pendingResults = (toolBatch?.calls ?? [])
    .filter((call) => call.result !== null)
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((call) => ({
      kind: "tool_result" as const,
      callId: call.requestedCall.callId,
      result: call.result!,
    }));
  return {
    ...state,
    status,
    activeModelRequest: null,
    toolBatch,
    transcript:
      pendingResults.length === 0 ? state.transcript : [...state.transcript, ...pendingResults],
    pause: null,
    outcome,
    endedAt: event.meta.occurredAt,
  };
}

function applyEvent(state: RunState, event: AgentEvent): RunState {
  let next: RunState;
  switch (event.type) {
    case "run.started":
      next = { ...state, status: "running", startedAt: event.meta.occurredAt };
      break;
    case "model.request_started":
      next = {
        ...state,
        activeModelRequest: {
          requestId: event.payload.requestId,
          retryOfRequestId: event.payload.retryOfRequestId,
          startedAt: event.meta.occurredAt,
        },
        usage: {
          ...state.usage,
          modelRequestCount: state.usage.modelRequestCount + 1,
        },
      };
      break;
    case "model.usage_recorded":
      next = { ...state, usage: addUsage(state, event.payload.delta) };
      break;
    case "model.request_failed":
      next = { ...state, activeModelRequest: null };
      break;
    case "assistant.message_completed":
      next = {
        ...state,
        activeModelRequest: null,
        transcript: [
          ...state.transcript,
          {
            kind: "assistant_message",
            message: event.payload.message,
            toolCalls: event.payload.toolCalls,
          },
        ],
        toolBatch:
          event.payload.toolCalls.length === 0
            ? null
            : {
                sourceMessageId: event.payload.message.messageId,
                calls: event.payload.toolCalls.map((requestedCall, ordinal) => ({
                  ordinal,
                  requestedCall,
                  effectiveCall: null,
                  status: "pending" as const,
                  result: null,
                })),
              },
      };
      break;
    case "tool.started": {
      const batch = state.toolBatch;
      if (!batch) throw new ReducerError("state_invalid", "tool.started 缺少 toolBatch");
      next = {
        ...state,
        usage: { ...state.usage, toolCallCount: state.usage.toolCallCount + 1 },
        toolBatch: {
          ...batch,
          calls: batch.calls.map((call) =>
            call.requestedCall.callId === event.payload.call.callId
              ? { ...call, effectiveCall: event.payload.call, status: "running" as const }
              : call,
          ),
        },
      };
      break;
    }
    case "tool.completed":
    case "tool.failed":
    case "tool.cancelled":
    case "tool.outcome_unknown": {
      const batch = state.toolBatch;
      if (!batch) throw new ReducerError("state_invalid", `${event.type} 缺少 toolBatch`);
      const existing = batch.calls.find(
        (call) => call.requestedCall.callId === event.payload.callId,
      );
      if (!existing) throw new ReducerError("state_invalid", "工具结果找不到对应调用");
      const result =
        event.type === "tool.outcome_unknown"
          ? event.payload.synthesizedResult
          : event.payload.result;
      const status =
        event.type === "tool.completed"
          ? "completed"
          : event.type === "tool.failed"
            ? "failed"
            : event.type === "tool.cancelled"
              ? "cancelled"
              : "outcome_unknown";
      const settled = settleToolBatch(batch, {
        ...existing,
        status,
        result,
      });
      next = {
        ...state,
        toolBatch: settled.batch,
        transcript:
          settled.results.length === 0
            ? state.transcript
            : [
                ...state.transcript,
                ...settled.results.map((call) => ({
                  kind: "tool_result" as const,
                  callId: call.requestedCall.callId,
                  result: call.result!,
                })),
              ],
      };
      break;
    }
    case "run.paused":
      next = { ...state, status: "paused", pause: event.payload.pause };
      break;
    case "run.resumed":
      next = { ...state, status: "running", pause: null };
      break;
    case "run.completed":
      next = terminalState(state, event, "completed", {
        kind: "completed",
        reason: "final_answer",
        finalMessageId: event.payload.finalMessageId,
      });
      break;
    case "run.cancelled":
      next = terminalState(state, event, "cancelled", {
        kind: "cancelled",
        reason: event.payload.reason,
      });
      break;
    case "run.limit_exceeded":
      next = terminalState(state, event, "limit_exceeded", {
        kind: "limit_exceeded",
        ...event.payload,
      });
      break;
    case "run.failed":
      next = terminalState(state, event, "failed", {
        kind: "failed",
        failure: event.payload.failure,
      });
      break;
  }

  return {
    ...next,
    updatedAt: event.meta.occurredAt,
    elapsedMs: event.meta.elapsedMs,
    lastEventSequence: event.meta.sequence,
    lastEventId: event.meta.eventId,
  };
}

export function reduceRunState(stateInput: Readonly<RunState>, eventInput: unknown): RunState {
  const state = runStateSchema.parse(stateInput);
  const event = agentEventSchema.parse(eventInput);
  const transition = validateTransition(state, event);
  if (!transition.ok) {
    throw new ReducerError(
      "transition_rejected",
      `${transition.violation.code}: ${transition.violation.message}`,
    );
  }

  const next = runStateSchema.parse(applyEvent(state, event));
  const invariant = validateRunStateInvariants(next);
  if (!invariant.ok) throw new ReducerError("state_invalid", invariant.message);
  return next;
}
