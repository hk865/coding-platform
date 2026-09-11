/**
 * 模块职责：把系统提示、指令、技能、记忆、对话记录和工具定义组装成确定性的模型请求。
 *
 * 设计边界：这里只校验并格式化已选中的上下文，不负责预算裁剪，也不调用模型。
 * 关键流程：校验输入与唯一性，按稳定顺序拼接系统提示，转换对话记录，最后通过请求 schema。
 */
import type { ContextFragment, MemoryItem, SkillContext } from "../types/context-types.js";
import {
  contextFragmentSchema,
  memoryItemSchema,
  skillContextSchema,
} from "../types/context-types.js";
import type {
  ModelMessage,
  ModelRequest,
  ModelToolSpec,
} from "../../ports/model_client/model-client-port.js";
import {
  modelRequestSchema,
  modelToolSpecSchema,
} from "../../ports/model_client/model-client-port.js";
import type { TranscriptEntry } from "../../runtime/state/run-state.js";
import { transcriptEntrySchema } from "../../runtime/state/run-state.js";

export interface ContextBuilderInput {
  readonly requestId: string;
  readonly runId: string;
  readonly baseSystemPrompt: string;
  readonly additionalInstructions: readonly ContextFragment[];
  readonly transcript: readonly TranscriptEntry[];
  readonly tools: readonly ModelToolSpec[];
  readonly skills: readonly SkillContext[];
  readonly memories: readonly MemoryItem[];
  /** 模型最大上下文窗口；真正的超窗裁剪由 M2 SelectionPolicy 负责。 */
  readonly tokenBudget: number;
  readonly maxOutputTokens: number | null;
}

export interface ContextBuilderPort {
  build(input: Readonly<ContextBuilderInput>): ModelRequest;
}

export type ContextBuildErrorCode =
  "invalid_input" | "duplicate_id" | "duplicate_tool" | "invalid_transcript";

export class ContextBuildError extends Error {
  constructor(
    readonly code: ContextBuildErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContextBuildError";
  }
}

function byPriorityThenId<T extends { readonly priority: number; readonly id: string }>(
  left: T,
  right: T,
): number {
  return right.priority - left.priority || left.id.localeCompare(right.id, "en");
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new ContextBuildError("duplicate_id", `${label} 中存在重复 id`);
  }
}

function section(kind: string, id: string, source: string, content: string): string {
  return `[${kind} id=${JSON.stringify(id)} source=${JSON.stringify(source)}]\n${content}`;
}

function buildSystemPrompt(input: ContextBuilderInput): string {
  const parts = [input.baseSystemPrompt];
  const instructions = [...input.additionalInstructions].sort(byPriorityThenId);
  const skillInstructions = input.skills
    .filter((skill) => skill.kind === "instruction")
    .sort(byPriorityThenId);
  const references = input.skills
    .filter((skill) => skill.kind === "reference")
    .sort(byPriorityThenId);
  const memories = [...input.memories].sort(byPriorityThenId);

  for (const item of instructions) {
    parts.push(section("additional_instruction", item.id, item.source, item.content));
  }
  for (const item of skillInstructions) {
    parts.push(section("skill_instruction", item.id, item.source, item.content));
  }
  for (const item of references) {
    parts.push(section("reference_data", item.id, item.source, item.content));
  }
  for (const item of memories) {
    parts.push(section("memory_data", item.id, item.source, item.content));
  }
  return parts.join("\n\n");
}

function toModelMessages(transcript: readonly TranscriptEntry[]): readonly ModelMessage[] {
  const pendingCallIds = new Set<string>();
  const settledCallIds = new Set<string>();

  return transcript.map((entry, index) => {
    const parsed = transcriptEntrySchema.safeParse(entry);
    if (!parsed.success) {
      throw new ContextBuildError(
        "invalid_transcript",
        `transcript[${index}] 非法：${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }
    const item = parsed.data;
    if (item.kind === "user_message") {
      return {
        role: "user",
        messageId: item.message.messageId,
        content: item.message.content,
      };
    }
    if (item.kind === "assistant_message") {
      for (const call of item.toolCalls) {
        if (pendingCallIds.has(call.callId) || settledCallIds.has(call.callId)) {
          throw new ContextBuildError("invalid_transcript", `重复 ToolCall ${call.callId}`);
        }
        pendingCallIds.add(call.callId);
      }
      return {
        role: "assistant",
        messageId: item.message.messageId,
        content: item.message.content,
        ...(item.message.reasoningContent
          ? { reasoningContent: item.message.reasoningContent }
          : {}),
        toolCalls: item.toolCalls,
      };
    }
    if (!pendingCallIds.has(item.callId) || settledCallIds.has(item.callId)) {
      throw new ContextBuildError(
        "invalid_transcript",
        `ToolResult ${item.callId} 没有唯一且未结算的 ToolCall`,
      );
    }
    pendingCallIds.delete(item.callId);
    settledCallIds.add(item.callId);
    return { role: "tool", callId: item.callId, result: item.result };
  });
}

function validateInput(input: ContextBuilderInput): void {
  if (
    input.requestId.trim().length === 0 ||
    input.runId.trim().length === 0 ||
    input.baseSystemPrompt.length === 0 ||
    !Number.isSafeInteger(input.tokenBudget) ||
    input.tokenBudget <= 0 ||
    (input.maxOutputTokens !== null &&
      (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0))
  ) {
    throw new ContextBuildError("invalid_input", "ContextBuilder 的标识、提示或预算非法");
  }

  for (const item of input.additionalInstructions) contextFragmentSchema.parse(item);
  for (const item of input.skills) skillContextSchema.parse(item);
  for (const item of input.memories) memoryItemSchema.parse(item);
  for (const item of input.tools) modelToolSpecSchema.parse(item);

  assertUnique(
    input.additionalInstructions.map((item) => item.id),
    "additionalInstructions",
  );
  assertUnique(
    input.skills.map((item) => item.id),
    "skills",
  );
  assertUnique(
    input.memories.map((item) => item.id),
    "memories",
  );
}

export function buildModelRequest(input: Readonly<ContextBuilderInput>): ModelRequest {
  validateInput(input);
  const tools = [...input.tools].sort((left, right) => left.name.localeCompare(right.name, "en"));
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
    throw new ContextBuildError("duplicate_tool", "工具名必须唯一");
  }

  return modelRequestSchema.parse({
    schemaVersion: 1,
    requestId: input.requestId,
    runId: input.runId,
    systemPrompt: buildSystemPrompt(input),
    messages: toModelMessages(input.transcript),
    tools,
    maxOutputTokens: input.maxOutputTokens,
  });
}

export class DeterministicContextBuilder implements ContextBuilderPort {
  build(input: Readonly<ContextBuilderInput>): ModelRequest {
    return buildModelRequest(input);
  }
}
