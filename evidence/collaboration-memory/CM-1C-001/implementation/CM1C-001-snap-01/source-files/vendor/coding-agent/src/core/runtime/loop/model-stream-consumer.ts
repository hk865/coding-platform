/**
 * 模块职责：消费模型异步事件流，并归并为文本、工具调用、截断、错误或取消结果。
 *
 * 设计边界：它不推进 RunState，也不执行工具；只负责模型流协议和缓冲安全。
 * 关键流程：逐事件校验身份与顺序，累计文本和参数，限制缓冲，最后校验终止序列。
 */
import { jsonObjectSchema } from "../../context/types/context-types.js";
import {
  modelEventSchema,
  validateModelEventSequence,
} from "../../ports/model_client/model-client-port.js";
import type {
  ModelClientPort,
  ModelEvent,
  ModelRequest,
  ModelUsage,
} from "../../ports/model_client/model-client-port.js";
import { toolCallSchema } from "../../ports/tool_executor/tool-executor-port.js";
import type { ToolCall } from "../../ports/tool_executor/tool-executor-port.js";
import { isAbortError } from "../cancellation/cancellation-controller.js";

export type ModelStreamResult =
  | {
      readonly kind: "completed";
      readonly reason: "final_answer" | "tool_calls";
      readonly text: string;
      readonly reasoning: string;
      readonly toolCalls: readonly ToolCall[];
      readonly usage: ModelUsage | null;
    }
  | {
      readonly kind: "truncated";
      readonly code: string;
      readonly message: string;
      readonly usage: ModelUsage | null;
    }
  | {
      readonly kind: "error";
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
      readonly usage: ModelUsage | null;
    }
  | { readonly kind: "cancelled"; readonly message: string; readonly usage: ModelUsage | null }
  | { readonly kind: "protocol_error"; readonly code: string; readonly message: string };

export interface ModelStreamConsumerOptions {
  readonly signal: AbortSignal;
  readonly maxBufferedCharacters?: number;
  readonly maxEvents?: number;
  readonly onTextDelta?: (delta: string) => void;
  readonly onReasoningDelta?: (delta: string) => void;
}

export async function consumeModelStream(
  client: ModelClientPort,
  request: Readonly<ModelRequest>,
  options: Readonly<ModelStreamConsumerOptions>,
): Promise<ModelStreamResult> {
  const events: ModelEvent[] = [];
  let text = "";
  let reasoning = "";
  let usage: ModelUsage | null = null;
  const calls = new Map<
    string,
    {
      readonly callId: string;
      readonly name: string;
      readonly ordinal: number;
      argumentsJson: string;
    }
  >();
  const ordinals = new Set<number>();
  const maxBufferedCharacters = options.maxBufferedCharacters ?? 1_000_000;
  const maxEvents = options.maxEvents ?? 100_000;
  if (
    !Number.isSafeInteger(maxBufferedCharacters) ||
    maxBufferedCharacters <= 0 ||
    !Number.isSafeInteger(maxEvents) ||
    maxEvents <= 0
  ) {
    throw new RangeError("模型流缓冲上限必须为正安全整数");
  }

  try {
    for await (const candidate of client.stream(request, { signal: options.signal })) {
      const parsed = modelEventSchema.safeParse(candidate);
      if (!parsed.success) {
        return {
          kind: "protocol_error",
          code: "invalid_event",
          message: parsed.error.issues[0]?.message ?? "模型事件非法",
        };
      }
      const event = parsed.data;
      if (events.length >= maxEvents) {
        return {
          kind: "protocol_error",
          code: "event_limit_exceeded",
          message: "模型流事件数量超过限制",
        };
      }
      events.push(event);
      if (event.requestId !== request.requestId || event.sequence !== events.length) {
        return {
          kind: "protocol_error",
          code: event.requestId !== request.requestId ? "request_mismatch" : "sequence_mismatch",
          message: "模型事件身份或 sequence 不一致",
        };
      }
      if (event.type === "text_delta") {
        text += event.delta;
        options.onTextDelta?.(event.delta);
      } else if (event.type === "reasoning_delta") {
        reasoning += event.delta;
        options.onReasoningDelta?.(event.delta);
      } else if (event.type === "tool_call_started") {
        if (ordinals.has(event.ordinal)) {
          return {
            kind: "protocol_error",
            code: "duplicate_tool_ordinal",
            message: `重复工具 ordinal ${event.ordinal}`,
          };
        }
        ordinals.add(event.ordinal);
        calls.set(event.callId, {
          callId: event.callId,
          name: event.name,
          ordinal: event.ordinal,
          argumentsJson: "",
        });
      } else if (event.type === "tool_arguments_delta") {
        const call = calls.get(event.callId);
        if (call) call.argumentsJson += event.delta;
      } else if (event.type === "usage_snapshot") usage = event.usage;

      const buffered =
        text.length +
        reasoning.length +
        [...calls.values()].reduce((sum, call) => sum + call.argumentsJson.length, 0);
      if (buffered > maxBufferedCharacters) {
        return {
          kind: "protocol_error",
          code: "buffer_limit_exceeded",
          message: "模型流缓冲超过限制",
        };
      }
    }
  } catch (error) {
    if (options.signal.aborted || isAbortError(error)) {
      return { kind: "cancelled", message: "模型调用已取消", usage };
    }
    return {
      kind: "protocol_error",
      code: "iterator_threw",
      message: error instanceof Error ? error.message : "模型迭代器异常",
    };
  }

  const validation = validateModelEventSequence(events);
  if (!validation.ok) {
    return {
      kind: "protocol_error",
      code: validation.violation.code,
      message: validation.violation.message,
    };
  }
  const terminal = events.at(-1)!;
  if (terminal.type === "truncated") {
    return { kind: "truncated", code: terminal.reason, message: terminal.message, usage };
  }
  if (terminal.type === "error") {
    return { kind: "error", ...terminal.error, usage };
  }
  if (terminal.type === "cancelled") {
    return { kind: "cancelled", message: terminal.reason, usage };
  }
  if (terminal.type !== "completed") {
    return { kind: "protocol_error", code: "missing_terminal", message: "模型流缺少终止事件" };
  }

  const toolCalls = [...calls.values()]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((call) => {
      const value: unknown = JSON.parse(call.argumentsJson);
      return toolCallSchema.parse({
        schemaVersion: 1,
        callId: call.callId,
        name: call.name,
        arguments: jsonObjectSchema.parse(value),
      });
    });
  return { kind: "completed", reason: terminal.reason, text, reasoning, toolCalls, usage };
}
