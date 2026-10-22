/**
 * 模块职责：在模型调用前按预算选择可保留的上下文，返回被选中的输入、真正发送的请求和选择报告。
 *
 * 设计边界：删除单位按固定顺序排列；base 提示词、instruction Skill、本次任务输入、最新 user
 * 消息和未闭合调用永不删除。本模块只复制出站副本，不改 RunState、已存事件或历史读取。
 * 关键流程：历史/当前分界 → 思考过滤 → 固定删除单位序列 → 前缀预览 → 报告。
 */
import type { ContextBuilderInput } from "../builder/context-builder.js";
import type { ModelRequest } from "../../ports/model_client/model-client-port.js";
import type { ToolResult } from "../../ports/tool_executor/tool-executor-port.js";
import type { TranscriptEntry } from "../../runtime/state/run-state.js";
import type { ContextFragment, MemoryItem, SkillContext } from "../types/context-types.js";

export type TokenEstimateInput = ContextBuilderInput | ModelRequest;

export interface TokenEstimator {
  estimate(input: Readonly<TokenEstimateInput>): number;
}

export type ReasoningReplay = "current_run" | "none";

export type BaseSystemPromptInput = { templateId: string; version: number; text: string };

export type ContextPreviewResult = {
  outgoing: ModelRequest;
  inputTokens: number;
  outputReserve: number;
  fits: boolean;
};

export type ContextPreview = (request: ModelRequest) => Promise<ContextPreviewResult>;

export type ContextSelectionRemoved = {
  memory: number;
  skillReference: number;
  additionalInstruction: number;
  toolResultBody: number;
  historyExchange: number;
  historyConclusion: number;
  currentExchange: number;
};

export type ContextSelectionReport = {
  requestId: string;
  inputTokens: number;
  budget: number;
  removed: ContextSelectionRemoved;
};

export type ContextSelectionOptions = {
  /** input.transcript 的前 n 条是历史，其余属于当前执行。 */
  historyEntryCount: number;
  taskInputMessageId: string | null;
  build: (input: ContextBuilderInput) => ModelRequest;
  previewRequest: ContextPreview;
  /** 缺席时不做出站思考过滤。 */
  reasoningReplay?: ReasoningReplay;
};

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

const TOOL_RESULT_PLACEHOLDER = (toolName: string, callId: string): string =>
  `内容因长度省略（工具 ${toolName}，调用 ${callId}），需要时重新读`;

type WorkingEntry = {
  readonly entry: TranscriptEntry;
  readonly history: boolean;
};

type UnitKind = keyof ContextSelectionRemoved;

/**
 * 一个删除单位只由稳定业务身份描述；前缀切分不依赖会随删除漂移的数组下标。
 * historyExchange 的 callIds 缺席表示该单位是一条历史 user 消息。
 */
interface RemovalUnit {
  readonly kind: UnitKind;
  readonly id?: string;
  readonly callIds?: readonly string[];
  readonly callId?: string;
  readonly output?: ToolResult["output"];
}

interface ExchangeScan {
  readonly assistantIndex: number;
  readonly callIds: readonly string[];
  readonly resultIndexes: readonly number[];
  readonly closed: boolean;
}

function emptyRemoved(): ContextSelectionRemoved {
  return {
    memory: 0,
    skillReference: 0,
    additionalInstruction: 0,
    toolResultBody: 0,
    historyExchange: 0,
    historyConclusion: 0,
    currentExchange: 0,
  };
}

/**
 * 历史/当前标记只在过滤前计算一次；过滤只复制被改动的 entry 和 message，
 * 不在原对象上 delete。思考过滤后既无正文、又无思考、也无调用的 assistant 才从出站副本移除。
 */
function outgoingEntries(
  transcript: readonly TranscriptEntry[],
  historyEntryCount: number,
  replay: ReasoningReplay | undefined,
): WorkingEntry[] {
  const result: WorkingEntry[] = [];
  transcript.forEach((entry, index) => {
    const history = index < historyEntryCount;
    if (replay === undefined) {
      result.push({ entry, history });
      return;
    }
    let outgoing = entry;
    if (
      entry.kind === "assistant_message" &&
      entry.message.reasoningContent !== undefined &&
      (replay === "none" || history)
    ) {
      const { reasoningContent: _removed, ...message } = entry.message;
      outgoing = { ...entry, message };
    }
    if (outgoing.kind === "assistant_message") {
      const hasContent = outgoing.message.content.length > 0;
      const hasReasoning = (outgoing.message.reasoningContent?.length ?? 0) > 0;
      const hasCalls = outgoing.toolCalls.length > 0;
      if (!hasContent && !hasReasoning && !hasCalls) return;
    }
    result.push({ entry: outgoing, history });
  });
  return result;
}

/**
 * 完整交换 = assistant 声明的全部 callId 紧接着都有一条自己的结果。
 * 只按真实相邻位置收结果；缺失结果的组保持未闭合，整组受保护。
 */
function scanExchanges(entries: readonly WorkingEntry[]): ExchangeScan[] {
  const scans: ExchangeScan[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!.entry;
    if (entry.kind !== "assistant_message" || entry.toolCalls.length === 0) continue;
    const expected = new Set(entry.toolCalls.map((call) => call.callId));
    const resultIndexes: number[] = [];
    let cursor = index + 1;
    while (cursor < entries.length) {
      const candidate = entries[cursor]!.entry;
      if (candidate.kind !== "tool_result" || !expected.has(candidate.callId)) break;
      expected.delete(candidate.callId);
      resultIndexes.push(cursor);
      cursor += 1;
    }
    scans.push({
      assistantIndex: index,
      callIds: entry.toolCalls.map((call) => call.callId),
      resultIndexes,
      closed: expected.size === 0,
    });
  }
  return scans;
}

function removalOrder<T extends { readonly priority: number; readonly id: string }>(
  left: T,
  right: T,
): number {
  return left.priority - right.priority || right.id.localeCompare(left.id, "en");
}

function buildRemovalUnits(
  input: Readonly<ContextBuilderInput>,
  entries: readonly WorkingEntry[],
  taskInputMessageId: string | null,
): RemovalUnit[] {
  const units: RemovalUnit[] = [];

  for (const memory of [...input.memories].sort(removalOrder)) {
    units.push({ kind: "memory", id: memory.id });
  }
  for (const skill of input.skills
    .filter((value) => value.kind === "reference")
    .sort(removalOrder)) {
    units.push({ kind: "skillReference", id: skill.id });
  }
  for (const instruction of [...input.additionalInstructions].sort(removalOrder)) {
    units.push({ kind: "additionalInstruction", id: instruction.id });
  }

  const callNames = new Map<string, string>();
  for (const value of entries) {
    if (value.entry.kind !== "assistant_message") continue;
    for (const call of value.entry.toolCalls) callNames.set(call.callId, call.name);
  }
  const scans = scanExchanges(entries);
  const partlyClosedResults = new Set<number>();
  for (const scan of scans) {
    if (scan.closed) continue;
    for (const resultIndex of scan.resultIndexes) partlyClosedResults.add(resultIndex);
  }

  // 第 4 步：只缩历史成功结果正文；新 output 的 UTF-8 JSON 必须严格更短。
  for (let index = 0; index < entries.length; index += 1) {
    const { entry, history } = entries[index]!;
    if (!history || entry.kind !== "tool_result") continue;
    if (entry.result.status !== "success" || partlyClosedResults.has(index)) continue;
    const toolName = callNames.get(entry.callId);
    if (toolName === undefined) continue;
    const output: ToolResult["output"] = [
      { kind: "text", text: TOOL_RESULT_PLACEHOLDER(toolName, entry.callId) },
    ];
    if (
      Buffer.byteLength(JSON.stringify(output), "utf8") <
      Buffer.byteLength(JSON.stringify(entry.result.output), "utf8")
    ) {
      units.push({ kind: "toolResultBody", callId: entry.callId, output });
    }
  }

  const latestUserIndex = entries.findLastIndex(
    (value) => value.entry.kind === "user_message",
  );
  const protectedIds = new Set<string>();
  if (latestUserIndex >= 0) {
    const latest = entries[latestUserIndex]!.entry;
    if (latest.kind === "user_message") protectedIds.add(latest.message.messageId);
  }
  if (taskInputMessageId !== null) protectedIds.add(taskInputMessageId);
  const scanByAssistant = new Map<number, ExchangeScan>();
  for (const scan of scans) scanByAssistant.set(scan.assistantIndex, scan);

  // 第 5 步：历史消息按位置，完整交换与 user 消息各算一个单位。
  for (let index = 0; index < entries.length; index += 1) {
    const { entry, history } = entries[index]!;
    if (!history) continue;
    if (entry.kind === "user_message") {
      if (protectedIds.has(entry.message.messageId)) continue;
      units.push({ kind: "historyExchange", id: entry.message.messageId });
      continue;
    }
    const scan = scanByAssistant.get(index);
    if (scan !== undefined && scan.closed) {
      if (entry.kind !== "assistant_message") continue;
      units.push({
        kind: "historyExchange",
        id: entry.message.messageId,
        callIds: scan.callIds,
      });
    }
  }

  // 第 6 步：历史中无工具调用的 assistant 结论。
  for (const { entry, history } of entries) {
    if (!history || entry.kind !== "assistant_message" || entry.toolCalls.length > 0) continue;
    units.push({ kind: "historyConclusion", id: entry.message.messageId });
  }

  // 第 7 步：当前执行的完整工具交换；当前 user 与无调用 assistant 不在此列。
  for (const scan of scans) {
    if (entries[scan.assistantIndex]!.history || !scan.closed) continue;
    const assistant = entries[scan.assistantIndex]!.entry;
    if (assistant.kind !== "assistant_message") continue;
    units.push({
      kind: "currentExchange",
      id: assistant.message.messageId,
      callIds: scan.callIds,
    });
  }

  return units;
}

interface AppliedPrefix {
  readonly selected: ContextBuilderInput;
  readonly removed: ContextSelectionRemoved;
}

function applyPrefix(
  input: Readonly<ContextBuilderInput>,
  entries: readonly WorkingEntry[],
  units: readonly RemovalUnit[],
  count: number,
): AppliedPrefix {
  let memories: readonly MemoryItem[] = [...input.memories];
  let skills: readonly SkillContext[] = [...input.skills];
  let additionalInstructions: readonly ContextFragment[] = [...input.additionalInstructions];
  let transcript: readonly WorkingEntry[] = [...entries];
  const removed = emptyRemoved();

  for (let index = 0; index < count; index += 1) {
    const unit = units[index]!;
    removed[unit.kind] += 1;
    switch (unit.kind) {
      case "memory":
        memories = memories.filter((value) => value.id !== unit.id);
        break;
      case "skillReference":
        skills = skills.filter((value) => value.id !== unit.id);
        break;
      case "additionalInstruction":
        additionalInstructions = additionalInstructions.filter((value) => value.id !== unit.id);
        break;
      case "toolResultBody": {
        const output = unit.output;
        if (output === undefined) throw new Error("toolResultBody 单位缺少替换正文");
        transcript = transcript.map((value) =>
          value.entry.kind === "tool_result" && value.entry.callId === unit.callId
            ? {
                ...value,
                entry: {
                  ...value.entry,
                  result: { ...value.entry.result, output } as ToolResult,
                },
              }
            : value,
        );
        break;
      }
      case "historyConclusion":
        transcript = transcript.filter(
          (value) =>
            value.entry.kind !== "assistant_message" ||
            value.entry.message.messageId !== unit.id,
        );
        break;
      case "historyExchange":
      case "currentExchange": {
        if (unit.callIds === undefined) {
          transcript = transcript.filter(
            (value) =>
              value.entry.kind !== "user_message" ||
              value.entry.message.messageId !== unit.id,
          );
          break;
        }
        const callIds = new Set(unit.callIds);
        transcript = transcript.filter((value) => {
          if (value.entry.kind === "assistant_message") {
            return value.entry.message.messageId !== unit.id;
          }
          if (value.entry.kind === "tool_result") return !callIds.has(value.entry.callId);
          return true;
        });
        break;
      }
    }
  }

  return {
    selected: {
      ...input,
      memories,
      skills,
      additionalInstructions,
      transcript: transcript.map((value) => value.entry),
    },
    removed,
  };
}

interface PreviewOutcome {
  readonly prefix: AppliedPrefix;
  readonly preview: ContextPreviewResult;
}

/**
 * 先 k=0；再 k=N；否则在 (0, N] 二分最小的可行前缀。
 * 只使用自身预览返回 fits 的前缀；返回的是该次预览的 outgoing 请求。
 */
export async function selectContext(
  input: Readonly<ContextBuilderInput>,
  options: ContextSelectionOptions,
): Promise<{
  selected: ContextBuilderInput;
  request: ModelRequest;
  report: ContextSelectionReport;
}> {
  const entries = outgoingEntries(
    input.transcript,
    options.historyEntryCount,
    options.reasoningReplay,
  );
  const units = buildRemovalUnits(
    input,
    entries,
    options.taskInputMessageId,
  );

  const preview = async (count: number): Promise<PreviewOutcome> => {
    const prefix = applyPrefix(input, entries, units, count);
    const request = options.build(prefix.selected);
    const result = await options.previewRequest(request);
    return { prefix, preview: result };
  };

  const report = (outcome: PreviewOutcome): ContextSelectionReport => ({
    requestId: input.requestId,
    inputTokens: outcome.preview.inputTokens,
    budget: input.tokenBudget - outcome.preview.outputReserve,
    removed: outcome.prefix.removed,
  });
  const finish = (outcome: PreviewOutcome) => ({
    selected: outcome.prefix.selected,
    request: outcome.preview.outgoing,
    report: report(outcome),
  });

  const zero = await preview(0);
  if (zero.preview.fits) return finish(zero);
  if (units.length === 0) {
    throw new ContextSelectionError(
      "required_content_over_budget",
      `不可裁剪 Context 需要 ${zero.preview.inputTokens} tokens，输入预算为 ${input.tokenBudget - zero.preview.outputReserve}`,
    );
  }

  const all = await preview(units.length);
  const cache = new Map<number, PreviewOutcome>([
    [0, zero],
    [units.length, all],
  ]);
  if (!all.preview.fits) {
    throw new ContextSelectionError(
      "required_content_over_budget",
      `不可裁剪 Context 需要 ${all.preview.inputTokens} tokens，输入预算为 ${input.tokenBudget - all.preview.outputReserve}`,
    );
  }

  let low = 1;
  let high = units.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    let candidate = cache.get(middle);
    if (candidate === undefined) {
      candidate = await preview(middle);
      cache.set(middle, candidate);
    }
    if (candidate.preview.fits) high = middle;
    else low = middle + 1;
  }
  const chosen = cache.get(high)!;
  if (!chosen.preview.fits) {
    throw new ContextSelectionError(
      "required_content_over_budget",
      `不可裁剪 Context 需要 ${chosen.preview.inputTokens} tokens，输入预算为 ${input.tokenBudget - chosen.preview.outputReserve}`,
    );
  }
  return finish(chosen);
}
