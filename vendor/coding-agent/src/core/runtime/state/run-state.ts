/**
 * 模块职责：定义 Run、Turn、对话记录、工具批次、终态结果和 RunState 不变量。
 *
 * 设计边界：本模块表达状态结构与派生判断，不负责事件投递或状态推进。
 * 关键流程：边界值先经 schema 校验；创建初始状态后，只应通过 reducer 演进。
 */
import { z } from "zod";

import {
  assistantMessageSchema,
  isoUtcDateTimeSchema,
  nonEmptyIdSchema,
  userMessageSchema,
} from "../../context/types/context-types.js";
import { toolCallSchema, toolResultSchema } from "../../ports/tool_executor/tool-executor-port.js";

export const runStatusSchema = z.enum([
  "created",
  "running",
  "paused",
  "completed",
  "cancelled",
  "limit_exceeded",
  "failed",
]);

export const runFailureSchema = z
  .object({
    category: z.enum([
      "context",
      "model",
      "model_protocol",
      "tool_executor",
      "hook",
      "required_sink",
      "invariant",
      "internal",
    ]),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    operationId: nonEmptyIdSchema.nullable(),
  })
  .strict();

export const runOutcomeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("completed"),
      reason: z.literal("final_answer"),
      finalMessageId: nonEmptyIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("cancelled"),
      reason: z.enum(["caller_requested", "user_interrupt", "process_signal"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("limit_exceeded"),
      limit: z.enum([
        "model_requests",
        "tool_calls",
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "cost",
        "deadline",
      ]),
      observed: z.number().int().nonnegative(),
      allowed: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ kind: z.literal("failed"), failure: runFailureSchema }).strict(),
]);

export const pauseStateSchema = z
  .object({
    reason: z.enum([
      "operator_requested",
      "hook_requested",
      "approval_required",
      "external_input_required",
    ]),
    requestedBy: z.enum(["runtime", "hook", "tool_executor", "app"]),
    pausedAt: isoUtcDateTimeSchema,
    pendingToolCallId: nonEmptyIdSchema.nullable(),
  })
  .strict();

export const turnSchema = z
  .object({
    turnId: nonEmptyIdSchema,
    userMessage: userMessageSchema,
  })
  .strict();

export const runSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: nonEmptyIdSchema,
    turn: turnSchema,
    createdAt: isoUtcDateTimeSchema,
  })
  .strict();

export const transcriptEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user_message"), message: userMessageSchema }).strict(),
  z
    .object({
      kind: z.literal("assistant_message"),
      message: assistantMessageSchema,
      toolCalls: z.array(toolCallSchema).readonly(),
    })
    .strict()
    .refine(
      (value) =>
        value.message.content.length > 0 ||
        value.toolCalls.length > 0 ||
        (value.message.reasoningContent?.length ?? 0) > 0,
      { message: "assistant transcript entry 不能同时缺少文本、推理内容和工具调用" },
    ),
  z
    .object({
      kind: z.literal("tool_result"),
      callId: nonEmptyIdSchema,
      result: toolResultSchema,
    })
    .strict()
    .refine((value) => value.callId === value.result.callId, {
      message: "tool_result 的 callId 必须与 result 一致",
    }),
]);

export const activeModelRequestSchema = z
  .object({
    requestId: nonEmptyIdSchema,
    retryOfRequestId: nonEmptyIdSchema.nullable(),
    startedAt: isoUtcDateTimeSchema,
  })
  .strict();

/**
 * 工具生命周期最小矩阵：
 *  - pending：模型已提出，尚未进入执行（Run 结束未启动则 abandoned）；
 *  - running：tool.started 已持久化，副作用已允许开始（矩阵中的 started）；
 *  - completed / failed / cancelled：取得确定结果（success / error / cancelled）并持久化；
 *  - outcome_unknown：已开始执行但 Runtime 因崩溃或强制中断未取得结果；
 *     显式路径由 tool.outcome_unknown 事件携带合成结果；Run 终结兜底时不携带结果；
 *  - abandoned：Run 结束时尚未开始的调用被放弃，不允许伪造结果。
 */
export const toolExecutionStateSchema = z
  .object({
    ordinal: z.number().int().nonnegative(),
    requestedCall: toolCallSchema,
    effectiveCall: toolCallSchema.nullable(),
    status: z.enum([
      "pending",
      "running",
      "completed",
      "failed",
      "cancelled",
      "outcome_unknown",
      "abandoned",
    ]),
    result: toolResultSchema.nullable(),
  })
  .strict();

export const toolBatchStateSchema = z
  .object({
    sourceMessageId: nonEmptyIdSchema,
    calls: z.array(toolExecutionStateSchema).min(1).readonly(),
  })
  .strict();

export const runUsageSchema = z
  .object({
    modelRequestCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    costUsdMicros: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .refine((value) => value.cachedInputTokens <= value.inputTokens, {
    message: "cachedInputTokens 不能超过 inputTokens",
  });

export const runStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: nonEmptyIdSchema,
    turn: turnSchema,
    status: runStatusSchema,
    transcript: z.array(transcriptEntrySchema).min(1).readonly(),
    activeModelRequest: activeModelRequestSchema.nullable(),
    toolBatch: toolBatchStateSchema.nullable(),
    pause: pauseStateSchema.nullable(),
    outcome: runOutcomeSchema.nullable(),
    usage: runUsageSchema,
    createdAt: isoUtcDateTimeSchema,
    startedAt: isoUtcDateTimeSchema.nullable(),
    updatedAt: isoUtcDateTimeSchema,
    endedAt: isoUtcDateTimeSchema.nullable(),
    elapsedMs: z.number().int().nonnegative(),
    lastEventSequence: z.number().int().nonnegative(),
    lastEventId: nonEmptyIdSchema.nullable(),
  })
  .strict();

export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunFailure = z.infer<typeof runFailureSchema>;
export type RunOutcome = z.infer<typeof runOutcomeSchema>;
export type PauseState = z.infer<typeof pauseStateSchema>;
export type Turn = z.infer<typeof turnSchema>;
export type Run = z.infer<typeof runSchema>;
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;
export type ActiveModelRequest = z.infer<typeof activeModelRequestSchema>;
export type ToolExecutionState = z.infer<typeof toolExecutionStateSchema>;
export type ToolBatchState = z.infer<typeof toolBatchStateSchema>;
export type RunUsage = z.infer<typeof runUsageSchema>;
export type RunState = z.infer<typeof runStateSchema>;

export type DerivedRunPhase =
  | "created"
  | "before_model"
  | "awaiting_model"
  | "before_tools"
  | "ready_to_complete"
  | "paused"
  | "terminal";

export type RunStateInvariantResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

const terminalStatuses = new Set<RunStatus>(["completed", "cancelled", "limit_exceeded", "failed"]);

export function isTerminalRunStatus(status: RunStatus): boolean {
  return terminalStatuses.has(status);
}

export function createInitialRunState(runInput: Run): RunState {
  const run = runSchema.parse(runInput);
  return {
    schemaVersion: 1,
    runId: run.runId,
    turn: run.turn,
    status: "created",
    transcript: [{ kind: "user_message", message: run.turn.userMessage }],
    activeModelRequest: null,
    toolBatch: null,
    pause: null,
    outcome: null,
    usage: {
      modelRequestCount: 0,
      toolCallCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsdMicros: null,
    },
    createdAt: run.createdAt,
    startedAt: null,
    updatedAt: run.createdAt,
    endedAt: null,
    elapsedMs: 0,
    lastEventSequence: 0,
    lastEventId: null,
  };
}

function invalidState(message: string): RunStateInvariantResult {
  return { ok: false, message };
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export function validateRunStateInvariants(input: unknown): RunStateInvariantResult {
  const parsed = runStateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidState(parsed.error.issues[0]?.message ?? "RunState schema 非法");
  }
  const state = parsed.data;

  const firstTranscriptEntry = state.transcript[0];
  if (
    firstTranscriptEntry?.kind !== "user_message" ||
    state.turn.userMessage.messageId !== firstTranscriptEntry.message.messageId
  ) {
    return invalidState("transcript 第一项必须是当前 Turn 的 user message");
  }
  if (state.lastEventSequence === 0 && state.lastEventId !== null) {
    return invalidState("尚无事件时 lastEventId 必须为 null");
  }
  if (state.lastEventSequence > 0 && state.lastEventId === null) {
    return invalidState("已有事件时 lastEventId 不能为空");
  }
  if (state.activeModelRequest !== null && state.toolBatch !== null) {
    return invalidState("activeModelRequest 与 toolBatch 必须互斥");
  }

  const messageIds = state.transcript
    .filter((entry) => entry.kind !== "tool_result")
    .map((entry) => entry.message.messageId);
  if (hasDuplicate(messageIds)) return invalidState("transcript 中 messageId 不能重复");

  if (state.toolBatch) {
    // batch 必须对应 transcript 中最近的 assistant message；终态冲刷 tool_result
    // 后末尾不再是 assistant message，因此从尾部回溯查找。
    const sourceMessage = [...state.transcript]
      .reverse()
      .find((entry) => entry.kind === "assistant_message");
    if (
      sourceMessage?.kind !== "assistant_message" ||
      state.toolBatch.sourceMessageId !== sourceMessage.message.messageId
    ) {
      return invalidState("toolBatch 必须来自 transcript 最后的 assistant message");
    }
    const ordinals = state.toolBatch.calls.map((call) => call.ordinal);
    const callIds = state.toolBatch.calls.map((call) => call.requestedCall.callId);
    if (hasDuplicate(ordinals.map(String)) || hasDuplicate(callIds)) {
      return invalidState("toolBatch 的 ordinal 和 callId 必须唯一");
    }
    for (const call of state.toolBatch.calls) {
      if (call.effectiveCall && call.effectiveCall.callId !== call.requestedCall.callId) {
        return invalidState("effectiveCall 不能修改 callId");
      }
      if (call.result && call.result.callId !== call.requestedCall.callId) {
        return invalidState("ToolResult 必须匹配 requestedCall.callId");
      }
      if (call.status === "pending" && (call.effectiveCall !== null || call.result !== null)) {
        return invalidState("pending tool 不能已有 effectiveCall 或 result");
      }
      if (call.status === "running" && (call.effectiveCall === null || call.result !== null)) {
        return invalidState("running tool 必须有 effectiveCall 且尚无 result");
      }
      if (["completed", "failed", "cancelled"].includes(call.status) && call.result === null) {
        return invalidState("已结算 tool（completed/failed/cancelled）必须有 result");
      }
      if (call.status === "outcome_unknown" && call.effectiveCall === null) {
        return invalidState("outcome_unknown 必须对应已开始的调用");
      }
      if (call.status === "abandoned" && call.result !== null) {
        return invalidState("abandoned 不能伪造 result");
      }
    }
  }

  if (state.status === "created") {
    if (
      state.startedAt !== null ||
      state.endedAt !== null ||
      state.pause !== null ||
      state.outcome !== null ||
      state.activeModelRequest !== null ||
      state.toolBatch !== null
    ) {
      return invalidState("created State 不能含运行中或终止字段");
    }
  } else if (state.status === "running") {
    if (
      state.startedAt === null ||
      state.endedAt !== null ||
      state.pause !== null ||
      state.outcome !== null
    ) {
      return invalidState("running State 的时间、pause 或 outcome 组合非法");
    }
    if (
      state.toolBatch &&
      state.toolBatch.calls.every((call) =>
        ["completed", "failed", "cancelled", "outcome_unknown"].includes(call.status),
      )
    ) {
      return invalidState("全部结算的 toolBatch 应已写回 transcript 并清空");
    }
  } else if (state.status === "paused") {
    if (
      state.startedAt === null ||
      state.endedAt !== null ||
      state.pause === null ||
      state.outcome !== null ||
      state.activeModelRequest !== null ||
      state.toolBatch?.calls.some((call) => call.status === "running")
    ) {
      return invalidState("paused State 必须位于稳定边界");
    }
    if (
      state.pause.pendingToolCallId !== null &&
      !state.toolBatch?.calls.some(
        (call) =>
          call.requestedCall.callId === state.pause?.pendingToolCallId && call.status === "pending",
      )
    ) {
      return invalidState("pause.pendingToolCallId 必须指向 pending tool");
    }
  } else {
    if (
      state.startedAt === null ||
      state.endedAt === null ||
      state.pause !== null ||
      state.outcome === null ||
      state.activeModelRequest !== null ||
      state.outcome.kind !== state.status
    ) {
      return invalidState("terminal State 的 status、outcome 和时间必须一致");
    }
  }

  return { ok: true };
}

export function deriveRunPhase(state: RunState): DerivedRunPhase {
  const invariant = validateRunStateInvariants(state);
  if (!invariant.ok) throw new Error(`RunState invariant violation: ${invariant.message}`);
  if (state.status === "created") return "created";
  if (state.status === "paused") return "paused";
  if (isTerminalRunStatus(state.status)) return "terminal";
  if (state.activeModelRequest) return "awaiting_model";
  if (state.toolBatch) return "before_tools";

  const last = state.transcript.at(-1);
  if (last?.kind === "assistant_message" && last.toolCalls.length === 0) {
    return "ready_to_complete";
  }
  return "before_model";
}
