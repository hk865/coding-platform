/**
 * 模块职责：定义工具调用、输出、副作用、失败和取消结果，以及统一执行端口。
 *
 * 设计边界：这里只规定 Core 与工具系统的边界，不包含注册、审批或沙箱实现。
 * 关键流程：调用和结果都经 schema 校验，并通过 callId 与 toolName 进行严格关联检查。
 */
import { z } from "zod";

import {
  jsonObjectSchema,
  jsonValueSchema,
  nonEmptyIdSchema,
} from "../../context/types/context-types.js";

export const toolCallSchema = z
  .object({
    schemaVersion: z.literal(1),
    callId: nonEmptyIdSchema,
    name: z.string().trim().min(1),
    arguments: jsonObjectSchema,
  })
  .strict();

export const toolOutputPartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }).strict(),
  z.object({ kind: z.literal("json"), value: jsonValueSchema }).strict(),
  z
    .object({
      kind: z.literal("artifact_ref"),
      uri: z.string().trim().min(1),
      summary: z.string(),
    })
    .strict(),
]);

export const toolEffectsSchema = z
  .object({
    sideEffect: z.enum(["none", "possible", "confirmed"]),
    changedPaths: z.array(z.string()).readonly(),
    workspaceRevision: z.string().min(1).nullable(),
    artifactRefs: z.array(z.string().min(1)).readonly(),
  })
  .strict();

/** 工具副作用类别：read_only 只读、workspace_write 写工作区、process 运行外部进程/系统操作。 */
export const toolEffectClassSchema = z.enum(["read_only", "workspace_write", "process"]);
export type ToolEffectClass = z.infer<typeof toolEffectClassSchema>;

export const toolErrorCodeSchema = z.enum([
  "unknown_tool",
  "invalid_arguments",
  "permission_denied",
  "approval_denied",
  "sandbox_unavailable",
  "execution_failed",
  "timeout",
  "protocol_error",
  "hook_blocked",
  "outcome_unknown",
]);

export const toolErrorSchema = z
  .object({
    code: toolErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();

const toolResultBase = {
  schemaVersion: z.literal(1),
  callId: nonEmptyIdSchema,
  output: z.array(toolOutputPartSchema).readonly(),
  effects: toolEffectsSchema,
};

export const successfulToolResultSchema = z
  .object({
    ...toolResultBase,
    status: z.literal("success"),
  })
  .strict();

export const failedToolResultSchema = z
  .object({
    ...toolResultBase,
    status: z.literal("error"),
    error: toolErrorSchema,
  })
  .strict();

export const cancelledToolResultSchema = z
  .object({
    ...toolResultBase,
    status: z.literal("cancelled"),
    reason: z.string().min(1),
  })
  .strict();

export const toolResultSchema = z.discriminatedUnion("status", [
  successfulToolResultSchema,
  failedToolResultSchema,
  cancelledToolResultSchema,
]);

export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolOutputPart = z.infer<typeof toolOutputPartSchema>;
export type ToolEffects = z.infer<typeof toolEffectsSchema>;
export type ToolError = z.infer<typeof toolErrorSchema>;
export type SuccessfulToolResult = z.infer<typeof successfulToolResultSchema>;
export type FailedToolResult = z.infer<typeof failedToolResultSchema>;
export type CancelledToolResult = z.infer<typeof cancelledToolResultSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;

export interface ToolExecutionOptions {
  readonly signal: AbortSignal;
}

export interface ToolExecutorPort {
  execute(call: Readonly<ToolCall>, options: Readonly<ToolExecutionOptions>): Promise<ToolResult>;
}

export function assertToolResultMatchesCall(call: ToolCall, result: ToolResult): void {
  if (result.callId !== call.callId) {
    throw new ToolProtocolError(
      "call_id_mismatch",
      `工具结果 ${result.callId} 不属于调用 ${call.callId}`,
    );
  }
}

export type ToolProtocolErrorCode = "call_id_mismatch" | "invalid_call" | "invalid_result";

export class ToolProtocolError extends Error {
  constructor(
    readonly code: ToolProtocolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolProtocolError";
  }
}
