/**
 * 模块职责：定义 Hook 调用、注册信息、失败结果和决策结果的版本化协议。
 *
 * 设计边界：协议只描述合法输入输出，不执行 Hook，也不决定具体 Hook 的先后顺序。
 * 关键流程：调用端按 Hook 点构造 invocation，执行后用配对规则校验 decision。
 */
import { z } from "zod";

import { nonEmptyIdSchema } from "../../context/types/context-types.js";
import { modelRequestSchema } from "../../ports/model_client/model-client-port.js";
import {
  toolCallSchema,
  toolOutputPartSchema,
  toolResultSchema,
} from "../../ports/tool_executor/tool-executor-port.js";
import { runStateSchema } from "../../runtime/state/run-state.js";

export const hookPointSchema = z.enum(["before_model", "before_tool", "after_tool"]);

export const hookRegistrationSchema = z
  .object({
    schemaVersion: z.literal(1),
    hookId: nonEmptyIdSchema,
    point: hookPointSchema,
    priority: z.number().int(),
  })
  .strict();

const hookInvocationBase = {
  schemaVersion: z.literal(1),
  state: runStateSchema,
};

export const beforeModelHookInvocationSchema = z
  .object({
    ...hookInvocationBase,
    point: z.literal("before_model"),
    request: modelRequestSchema,
  })
  .strict();

export const beforeToolHookInvocationSchema = z
  .object({
    ...hookInvocationBase,
    point: z.literal("before_tool"),
    call: toolCallSchema,
  })
  .strict();

export const afterToolHookInvocationSchema = z
  .object({
    ...hookInvocationBase,
    point: z.literal("after_tool"),
    result: toolResultSchema,
  })
  .strict();

export const hookInvocationSchema = z.discriminatedUnion("point", [
  beforeModelHookInvocationSchema,
  beforeToolHookInvocationSchema,
  afterToolHookInvocationSchema,
]);

export const hookFailureSchema = z
  .object({
    category: z.literal("hook"),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    operationId: nonEmptyIdSchema.nullable(),
  })
  .strict();

export const toolResultPresentationSchema = z
  .object({
    output: z.array(toolOutputPartSchema).readonly(),
  })
  .strict();

const continueDecision = <TPoint extends z.ZodLiteral<string>>(point: TPoint) =>
  z.object({ point, kind: z.literal("continue") }).strict();
const blockDecision = <TPoint extends z.ZodLiteral<string>>(point: TPoint) =>
  z.object({ point, kind: z.literal("block"), reason: z.string().min(1) }).strict();
const pauseDecision = <TPoint extends z.ZodLiteral<string>>(point: TPoint) =>
  z.object({ point, kind: z.literal("pause"), reason: z.string().min(1) }).strict();
const failDecision = <TPoint extends z.ZodLiteral<string>>(point: TPoint) =>
  z.object({ point, kind: z.literal("fail"), failure: hookFailureSchema }).strict();

const beforeModelPoint = z.literal("before_model");
const beforeToolPoint = z.literal("before_tool");
const afterToolPoint = z.literal("after_tool");

export const beforeModelHookDecisionSchema = z.discriminatedUnion("kind", [
  continueDecision(beforeModelPoint),
  z
    .object({
      point: beforeModelPoint,
      kind: z.literal("modify"),
      value: modelRequestSchema,
    })
    .strict(),
  blockDecision(beforeModelPoint),
  pauseDecision(beforeModelPoint),
  failDecision(beforeModelPoint),
]);

export const beforeToolHookDecisionSchema = z.discriminatedUnion("kind", [
  continueDecision(beforeToolPoint),
  z
    .object({
      point: beforeToolPoint,
      kind: z.literal("modify"),
      value: toolCallSchema,
    })
    .strict(),
  blockDecision(beforeToolPoint),
  pauseDecision(beforeToolPoint),
  failDecision(beforeToolPoint),
]);

export const afterToolHookDecisionSchema = z.discriminatedUnion("kind", [
  continueDecision(afterToolPoint),
  z
    .object({
      point: afterToolPoint,
      kind: z.literal("modify"),
      value: toolResultPresentationSchema,
    })
    .strict(),
  pauseDecision(afterToolPoint),
  failDecision(afterToolPoint),
]);

export const hookDecisionSchema = z.union([
  beforeModelHookDecisionSchema,
  beforeToolHookDecisionSchema,
  afterToolHookDecisionSchema,
]);

export type HookPoint = z.infer<typeof hookPointSchema>;
export type HookRegistration = z.infer<typeof hookRegistrationSchema>;
export type BeforeModelHookInvocation = z.infer<typeof beforeModelHookInvocationSchema>;
export type BeforeToolHookInvocation = z.infer<typeof beforeToolHookInvocationSchema>;
export type AfterToolHookInvocation = z.infer<typeof afterToolHookInvocationSchema>;
export type HookInvocation = z.infer<typeof hookInvocationSchema>;
export type HookFailure = z.infer<typeof hookFailureSchema>;
export type ToolResultPresentation = z.infer<typeof toolResultPresentationSchema>;
export type BeforeModelHookDecision = z.infer<typeof beforeModelHookDecisionSchema>;
export type BeforeToolHookDecision = z.infer<typeof beforeToolHookDecisionSchema>;
export type AfterToolHookDecision = z.infer<typeof afterToolHookDecisionSchema>;
export type HookDecision = z.infer<typeof hookDecisionSchema>;

export interface HookExecutionOptions {
  readonly signal: AbortSignal;
}

interface HookPortBase<TPoint extends HookPoint> {
  readonly hookId: string;
  readonly point: TPoint;
  readonly priority: number;
}

export interface BeforeModelHookPort extends HookPortBase<"before_model"> {
  execute(
    invocation: Readonly<BeforeModelHookInvocation>,
    options: Readonly<HookExecutionOptions>,
  ): Promise<BeforeModelHookDecision>;
}

export interface BeforeToolHookPort extends HookPortBase<"before_tool"> {
  execute(
    invocation: Readonly<BeforeToolHookInvocation>,
    options: Readonly<HookExecutionOptions>,
  ): Promise<BeforeToolHookDecision>;
}

export interface AfterToolHookPort extends HookPortBase<"after_tool"> {
  execute(
    invocation: Readonly<AfterToolHookInvocation>,
    options: Readonly<HookExecutionOptions>,
  ): Promise<AfterToolHookDecision>;
}

export type HookPort = BeforeModelHookPort | BeforeToolHookPort | AfterToolHookPort;

export type HookDecisionViolationCode =
  "invalid_invocation" | "invalid_decision" | "point_mismatch" | "identity_modified";

export type HookDecisionValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly violation: {
        readonly code: HookDecisionViolationCode;
        readonly message: string;
      };
    };

function rejected(code: HookDecisionViolationCode, message: string): HookDecisionValidationResult {
  return { ok: false, violation: { code, message } };
}

function decisionSchemaFor(point: HookPoint) {
  switch (point) {
    case "before_model":
      return beforeModelHookDecisionSchema;
    case "before_tool":
      return beforeToolHookDecisionSchema;
    case "after_tool":
      return afterToolHookDecisionSchema;
  }
}

export function validateHookDecision(
  invocationInput: unknown,
  decisionInput: unknown,
): HookDecisionValidationResult {
  const invocationResult = hookInvocationSchema.safeParse(invocationInput);
  if (!invocationResult.success) {
    return rejected(
      "invalid_invocation",
      invocationResult.error.issues[0]?.message ?? "Hook invocation 非法",
    );
  }
  const invocation = invocationResult.data;
  const rawPoint =
    typeof decisionInput === "object" && decisionInput !== null && "point" in decisionInput
      ? (decisionInput as { readonly point?: unknown }).point
      : undefined;
  if (rawPoint !== invocation.point) {
    return rejected("point_mismatch", "Hook decision point 必须与 invocation point 一致");
  }

  const decisionResult = decisionSchemaFor(invocation.point).safeParse(decisionInput);
  if (!decisionResult.success) {
    return rejected(
      "invalid_decision",
      decisionResult.error.issues[0]?.message ?? "Hook decision 非法",
    );
  }

  if (invocation.point === "before_model") {
    const decision = beforeModelHookDecisionSchema.parse(decisionInput);
    if (
      decision.kind === "modify" &&
      (decision.value.requestId !== invocation.request.requestId ||
        decision.value.runId !== invocation.request.runId)
    ) {
      return rejected("identity_modified", "before_model Hook 不能修改 requestId 或 runId");
    }
  }
  if (invocation.point === "before_tool") {
    const decision = beforeToolHookDecisionSchema.parse(decisionInput);
    if (decision.kind === "modify" && decision.value.callId !== invocation.call.callId) {
      return rejected("identity_modified", "before_tool Hook 不能修改 callId");
    }
  }

  return { ok: true };
}
