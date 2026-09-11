/**
 * 模块职责：定义模型请求、流式事件、用量数据和模型客户端端口的完整协议。
 *
 * 设计边界：它不绑定任何模型供应商，也不负责把事件归并为最终文本和工具调用。
 * 关键流程：请求和事件先经 schema 校验，流结束后再检查 sequence、终止事件和调用配对。
 */
import { z } from "zod";

import { jsonObjectSchema, nonEmptyIdSchema } from "../../context/types/context-types.js";
import { toolCallSchema, toolResultSchema } from "../tool_executor/tool-executor-port.js";

export const modelMessageSchema = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("user"),
      messageId: nonEmptyIdSchema,
      content: z.string().min(1),
    })
    .strict(),
  z
    .object({
      role: z.literal("assistant"),
      messageId: nonEmptyIdSchema,
      content: z.string(),
      reasoningContent: z.string().min(1).optional(),
      toolCalls: z.array(toolCallSchema).readonly(),
    })
    .strict()
    .refine(
      (value) =>
        value.content.length > 0 ||
        value.toolCalls.length > 0 ||
        (value.reasoningContent?.length ?? 0) > 0,
      {
        message: "assistant message 不能同时缺少文本、推理内容和工具调用",
      },
    ),
  z
    .object({
      role: z.literal("tool"),
      callId: nonEmptyIdSchema,
      result: toolResultSchema,
    })
    .strict()
    .refine((value) => value.callId === value.result.callId, {
      message: "tool message 的 callId 必须与 result 一致",
    }),
]);

export const modelToolSpecSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string(),
    inputSchema: jsonObjectSchema,
  })
  .strict();

export const modelRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: nonEmptyIdSchema,
    runId: nonEmptyIdSchema,
    systemPrompt: z.string().min(1),
    messages: z.array(modelMessageSchema).min(1).readonly(),
    tools: z.array(modelToolSpecSchema).readonly(),
    maxOutputTokens: z.number().int().positive().nullable(),
  })
  .strict();

export const modelUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    costUsdMicros: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .refine((value) => value.cachedInputTokens <= value.inputTokens, {
    message: "cachedInputTokens 不能超过 inputTokens",
  });

const eventBase = {
  schemaVersion: z.literal(1),
  requestId: nonEmptyIdSchema,
  sequence: z.number().int().positive(),
};

const textDeltaEventSchema = z
  .object({ ...eventBase, type: z.literal("text_delta"), delta: z.string().min(1) })
  .strict();
const reasoningDeltaEventSchema = z
  .object({ ...eventBase, type: z.literal("reasoning_delta"), delta: z.string().min(1) })
  .strict();
const toolCallStartedEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("tool_call_started"),
    callId: nonEmptyIdSchema,
    name: z.string().trim().min(1),
    ordinal: z.number().int().nonnegative(),
  })
  .strict();
const toolArgumentsDeltaEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("tool_arguments_delta"),
    callId: nonEmptyIdSchema,
    delta: z.string().min(1),
  })
  .strict();
const usageSnapshotEventSchema = z
  .object({ ...eventBase, type: z.literal("usage_snapshot"), usage: modelUsageSchema })
  .strict();
const completedEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("completed"),
    reason: z.enum(["final_answer", "tool_calls"]),
  })
  .strict();
const truncatedEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("truncated"),
    reason: z.enum(["max_output_tokens", "content_filter", "provider_limit"]),
    message: z.string().min(1),
  })
  .strict();
const modelErrorEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("error"),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();
const modelCancelledEventSchema = z
  .object({ ...eventBase, type: z.literal("cancelled"), reason: z.string().min(1) })
  .strict();

export const modelEventSchema = z.discriminatedUnion("type", [
  textDeltaEventSchema,
  reasoningDeltaEventSchema,
  toolCallStartedEventSchema,
  toolArgumentsDeltaEventSchema,
  usageSnapshotEventSchema,
  completedEventSchema,
  truncatedEventSchema,
  modelErrorEventSchema,
  modelCancelledEventSchema,
]);

export type ModelMessage = z.infer<typeof modelMessageSchema>;
export type ModelToolSpec = z.infer<typeof modelToolSpecSchema>;
export type ModelRequest = z.infer<typeof modelRequestSchema>;
export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type ModelEvent = z.infer<typeof modelEventSchema>;

export interface ModelCallOptions {
  readonly signal: AbortSignal;
}

export interface ModelClientPort {
  stream(
    request: Readonly<ModelRequest>,
    options: Readonly<ModelCallOptions>,
  ): AsyncIterable<ModelEvent>;
}

export type ModelStreamProtocolViolationCode =
  | "invalid_event"
  | "request_mismatch"
  | "sequence_mismatch"
  | "event_after_terminal"
  | "missing_terminal"
  | "duplicate_tool_call"
  | "unknown_tool_call"
  | "invalid_tool_arguments"
  | "usage_regression"
  | "completion_mismatch";

export type ModelStreamValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly violation: {
        readonly code: ModelStreamProtocolViolationCode;
        readonly message: string;
        readonly eventIndex: number | null;
      };
    };

const terminalModelEventTypes = new Set<ModelEvent["type"]>([
  "completed",
  "truncated",
  "error",
  "cancelled",
]);

function invalidStream(
  code: ModelStreamProtocolViolationCode,
  message: string,
  eventIndex: number | null,
): ModelStreamValidationResult {
  return { ok: false, violation: { code, message, eventIndex } };
}

function usageRegressed(previous: ModelUsage, current: ModelUsage): boolean {
  return (
    current.inputTokens < previous.inputTokens ||
    current.outputTokens < previous.outputTokens ||
    current.cachedInputTokens < previous.cachedInputTokens ||
    (previous.costUsdMicros !== null &&
      (current.costUsdMicros === null || current.costUsdMicros < previous.costUsdMicros))
  );
}

export function validateModelEventSequence(
  events: readonly unknown[],
): ModelStreamValidationResult {
  let requestId: string | null = null;
  let terminalSeen = false;
  let previousUsage: ModelUsage | null = null;
  const toolCalls = new Map<string, { readonly name: string; argumentsJson: string }>();

  for (const [index, candidate] of events.entries()) {
    const parsed = modelEventSchema.safeParse(candidate);
    if (!parsed.success) {
      return invalidStream(
        "invalid_event",
        parsed.error.issues[0]?.message ?? "模型事件非法",
        index,
      );
    }
    const event = parsed.data;

    if (terminalSeen) {
      return invalidStream("event_after_terminal", "终止事件后不能再出现模型事件", index);
    }
    if (requestId === null) requestId = event.requestId;
    else if (event.requestId !== requestId) {
      return invalidStream("request_mismatch", "同一模型流只能属于一个 requestId", index);
    }
    if (event.sequence !== index + 1) {
      return invalidStream("sequence_mismatch", "模型事件 sequence 必须从 1 严格连续", index);
    }

    if (event.type === "tool_call_started") {
      if (toolCalls.has(event.callId)) {
        return invalidStream("duplicate_tool_call", `工具调用 ${event.callId} 重复开始`, index);
      }
      toolCalls.set(event.callId, { name: event.name, argumentsJson: "" });
    } else if (event.type === "tool_arguments_delta") {
      const call = toolCalls.get(event.callId);
      if (!call) {
        return invalidStream("unknown_tool_call", `参数片段引用未知调用 ${event.callId}`, index);
      }
      call.argumentsJson += event.delta;
    } else if (event.type === "usage_snapshot") {
      if (previousUsage && usageRegressed(previousUsage, event.usage)) {
        return invalidStream("usage_regression", "usage_snapshot 累计值不能倒退", index);
      }
      previousUsage = event.usage;
    } else if (event.type === "completed") {
      if (event.reason === "final_answer" && toolCalls.size > 0) {
        return invalidStream(
          "completion_mismatch",
          "包含工具调用的模型流不能以 final_answer 完成",
          index,
        );
      }
      if (event.reason === "tool_calls" && toolCalls.size === 0) {
        return invalidStream("completion_mismatch", "tool_calls 完成原因至少需要一个调用", index);
      }
      for (const [callId, call] of toolCalls) {
        try {
          const value: unknown = JSON.parse(call.argumentsJson);
          const argumentsResult = jsonObjectSchema.safeParse(value);
          if (!argumentsResult.success) throw new Error("参数必须是 JSON object");
        } catch {
          return invalidStream(
            "invalid_tool_arguments",
            `工具调用 ${callId} 的参数不是完整 JSON object`,
            index,
          );
        }
      }
    }

    terminalSeen = terminalModelEventTypes.has(event.type);
  }

  if (!terminalSeen) {
    return invalidStream("missing_terminal", "模型流必须且只能有一个终止事件", null);
  }
  return { ok: true };
}
