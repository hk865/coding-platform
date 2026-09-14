/**
 * 模块职责：在模型调用前按 token 预算选择可保留的上下文，并记录被移除的内容。
 *
 * 设计边界：不可移除当前用户消息和未闭合工具调用；本模块不改变内容格式。
 * 关键流程：先估算总量，再依次裁剪记忆、技能引用、附加指令、技能指令和完整对话组。
 */
import type { ContextBuilderInput } from "../builder/context-builder.js";
import type { ModelRequest } from "../../ports/model_client/model-client-port.js";
import type { TranscriptEntry } from "../../runtime/state/run-state.js";
import type { ContextFragment, MemoryItem, SkillContext } from "../types/context-types.js";

export type TokenEstimateInput = ContextBuilderInput | ModelRequest;

export interface TokenEstimator {
  estimate(input: Readonly<TokenEstimateInput>): number;
}

export interface RemovedContextItem {
  readonly kind:
    | "memory"
    | "skill_reference"
    | "additional_instruction"
    | "skill_instruction"
    | "transcript_group";
  readonly id: string;
  readonly source: string;
  readonly reason: "budget";
}

export interface ContextSelectionResult {
  readonly input: ContextBuilderInput;
  readonly estimatedTokens: number;
  readonly removed: readonly RemovedContextItem[];
}

export class ContextSelectionError extends Error {
  constructor(
    readonly code: "token_estimation_failed" | "required_content_over_budget",
    message: string,
  ) {
    super(message);
    this.name = "ContextSelectionError";
  }
}

export class CharacterTokenEstimator implements TokenEstimator {
  estimate(input: Readonly<TokenEstimateInput>): number {
    const serialized = JSON.stringify(input);
    return Math.max(1, Math.ceil(serialized.length / 3));
  }
}

/** 统一校验估算器结果，避免 SelectionPolicy 和 Hook 后复核出现语义分叉。 */
export function estimateTokens(
  input: Readonly<TokenEstimateInput>,
  estimator: TokenEstimator,
): number {
  try {
    const value = estimator.estimate(input);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("invalid token estimate");
    return value;
  } catch (error) {
    throw new ContextSelectionError(
      "token_estimation_failed",
      error instanceof Error ? error.message : "token estimator 失败",
    );
  }
}

type TranscriptGroup =
  | {
      readonly kind: "user_message";
      readonly id: string;
      readonly messageId: string;
    }
  | {
      readonly kind: "assistant_tool_exchange";
      readonly id: string;
      readonly messageId: string;
      readonly callIds: readonly string[];
    };

/**
 * assistant 与其完整 ToolResult 必须作为一个整体淘汰；当前用户消息和未闭合调用永不移除。
 */
function removableTranscriptGroups(transcript: readonly TranscriptEntry[]): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];
  const latestUserIndex = transcript.findLastIndex((entry) => entry.kind === "user_message");
  for (let index = 0; index < transcript.length; index += 1) {
    const entry = transcript[index]!;
    if (entry.kind === "user_message") {
      if (index !== latestUserIndex) {
        groups.push({
          kind: "user_message",
          id: entry.message.messageId,
          messageId: entry.message.messageId,
        });
      }
      continue;
    }
    if (entry.kind !== "assistant_message") continue;
    const expected = new Set(entry.toolCalls.map((call) => call.callId));
    let cursor = index + 1;
    while (cursor < transcript.length && transcript[cursor]?.kind === "tool_result") {
      const result = transcript[cursor] as Extract<TranscriptEntry, { kind: "tool_result" }>;
      if (!expected.has(result.callId)) break;
      expected.delete(result.callId);
      cursor += 1;
    }
    if (expected.size === 0 && entry.toolCalls.length > 0) {
      groups.push({
        kind: "assistant_tool_exchange",
        id: entry.message.messageId,
        messageId: entry.message.messageId,
        callIds: entry.toolCalls.map((call) => call.callId),
      });
    }
    index = cursor - 1;
  }
  return groups;
}

/**
 * 通过稳定业务标识删除完整交换，而不是复用会随前一次删除漂移的数组下标。
 * assistant messageId 与它声明的 callId 集合共同定义一个原子裁剪单位。
 */
function withoutTranscriptGroup(
  transcript: readonly TranscriptEntry[],
  group: TranscriptGroup,
): TranscriptEntry[] {
  if (group.kind === "user_message") {
    return transcript.filter(
      (entry) => entry.kind !== "user_message" || entry.message.messageId !== group.messageId,
    );
  }
  const callIds = new Set(group.callIds);
  return transcript.filter((entry) => {
    if (entry.kind === "assistant_message") {
      return entry.message.messageId !== group.messageId;
    }
    if (entry.kind === "tool_result") return !callIds.has(entry.callId);
    return true;
  });
}

function removalOrder<T extends { readonly priority: number; readonly id: string }>(
  left: T,
  right: T,
): number {
  return left.priority - right.priority || right.id.localeCompare(left.id, "en");
}

function withoutId<T extends { readonly id: string }>(values: readonly T[], id: string): T[] {
  return values.filter((value) => value.id !== id);
}

export function selectContext(
  input: Readonly<ContextBuilderInput>,
  estimator: TokenEstimator,
): ContextSelectionResult {
  let additionalInstructions: readonly ContextFragment[] = [...input.additionalInstructions];
  let skills: readonly SkillContext[] = [...input.skills];
  let memories: readonly MemoryItem[] = [...input.memories];
  let transcript: readonly TranscriptEntry[] = [...input.transcript];
  const removed: RemovedContextItem[] = [];

  const buildInput = (): ContextBuilderInput => ({
    ...input,
    additionalInstructions,
    skills,
    memories,
    transcript,
  });
  const estimate = (): number => estimateTokens(buildInput(), estimator);

  let estimatedTokens = estimate();
  if (estimatedTokens <= input.tokenBudget) {
    return { input: buildInput(), estimatedTokens, removed };
  }

  const remove = (kind: RemovedContextItem["kind"], item: { id: string; source: string }) => {
    if (kind === "memory") memories = withoutId(memories, item.id);
    else if (kind === "additional_instruction") {
      additionalInstructions = withoutId(additionalInstructions, item.id);
    } else skills = withoutId(skills, item.id);
    removed.push({ kind, id: item.id, source: item.source, reason: "budget" });
    estimatedTokens = estimate();
  };

  for (const item of [...memories].sort(removalOrder)) {
    if (estimatedTokens <= input.tokenBudget) break;
    remove("memory", item);
  }
  for (const item of skills.filter((value) => value.kind === "reference").sort(removalOrder)) {
    if (estimatedTokens <= input.tokenBudget) break;
    remove("skill_reference", item);
  }
  for (const item of [...additionalInstructions].sort(removalOrder)) {
    if (estimatedTokens <= input.tokenBudget) break;
    remove("additional_instruction", item);
  }
  for (const item of skills.filter((value) => value.kind === "instruction").sort(removalOrder)) {
    if (estimatedTokens <= input.tokenBudget) break;
    remove("skill_instruction", item);
  }
  for (const group of removableTranscriptGroups(transcript)) {
    if (estimatedTokens <= input.tokenBudget) break;
    transcript = withoutTranscriptGroup(transcript, group);
    removed.push({
      kind: "transcript_group",
      id: group.id,
      source: "transcript",
      reason: "budget",
    });
    estimatedTokens = estimate();
  }

  if (estimatedTokens > input.tokenBudget) {
    throw new ContextSelectionError(
      "required_content_over_budget",
      `不可裁剪 Context 需要 ${estimatedTokens} tokens，预算为 ${input.tokenBudget}`,
    );
  }
  return { input: buildInput(), estimatedTokens, removed };
}
