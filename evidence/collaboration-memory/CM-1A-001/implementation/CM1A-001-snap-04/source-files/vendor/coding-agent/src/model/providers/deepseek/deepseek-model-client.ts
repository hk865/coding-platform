/** DeepSeek OpenAI-compatible Chat Completions 的独立适配器。 */
import OpenAI from "openai";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions/completions";

import {
  modelRequestSchema,
  type ModelCallOptions,
  type ModelClientPort,
  type ModelEvent,
  type ModelRequest,
} from "../../../core/ports/model_client/model-client-port.js";
import {
  asRecord,
  classifyProviderError,
  createEventFactory,
  numberField,
  stringField,
  zeroCostUsage,
} from "../provider-support.js";

export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";

export interface DeepSeekChatTransport {
  create(
    body: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<AsyncIterable<unknown>>;
}

export interface DeepSeekModelClientOptions {
  readonly model: string;
  readonly transport: DeepSeekChatTransport;
  readonly thinking?: "enabled" | "disabled";
  readonly reasoningEffort?: "low" | "high" | "max";
}

export class DeepSeekSdkChatTransport implements DeepSeekChatTransport {
  readonly #client: OpenAI;

  constructor(options: { readonly apiKey: string; readonly baseUrl?: string }) {
    this.#client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl ?? DEEPSEEK_DEFAULT_BASE_URL,
      maxRetries: 0,
    });
  }

  async create(
    body: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<AsyncIterable<unknown>> {
    return this.#client.chat.completions.create(
      body as unknown as ChatCompletionCreateParamsStreaming,
      { signal },
    );
  }
}

function mapMessages(request: ModelRequest): readonly Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [{ role: "system", content: request.systemPrompt }];
  for (const message of request.messages) {
    if (message.role === "user") messages.push({ role: "user", content: message.content });
    else if (message.role === "assistant") {
      messages.push({
        role: "assistant",
        content: message.content || null,
        ...(message.reasoningContent ? { reasoning_content: message.reasoningContent } : {}),
        ...(message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.callId,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      });
    } else {
      messages.push({
        role: "tool",
        tool_call_id: message.callId,
        content: JSON.stringify(message.result),
      });
    }
  }
  return messages;
}

function mapTools(request: ModelRequest): readonly Record<string, unknown>[] {
  return request.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function usageFromChunk(chunk: Record<string, unknown>) {
  const usage = asRecord(chunk["usage"]);
  if (!usage) return null;
  const details = asRecord(usage["prompt_tokens_details"]);
  return zeroCostUsage(
    numberField(usage, "prompt_tokens") ?? 0,
    numberField(usage, "completion_tokens") ?? 0,
    numberField(usage, "prompt_cache_hit_tokens") ??
      (details ? (numberField(details, "cached_tokens") ?? 0) : 0),
  );
}

export class DeepSeekModelClient implements ModelClientPort {
  readonly #options: DeepSeekModelClientOptions;

  constructor(options: Readonly<DeepSeekModelClientOptions>) {
    if (options.model.trim().length === 0) throw new Error("DeepSeek model 不能为空");
    const thinking = options.thinking ?? "enabled";
    if (options.reasoningEffort && thinking !== "enabled") {
      throw new Error("reasoningEffort 只可在 thinking=enabled 时使用");
    }
    this.#options = { ...options, thinking };
  }

  async *stream(
    candidate: Readonly<ModelRequest>,
    options: Readonly<ModelCallOptions>,
  ): AsyncIterable<ModelEvent> {
    const request = modelRequestSchema.parse(candidate);
    const event = createEventFactory(request.requestId);
    const body: Record<string, unknown> = {
      model: this.#options.model,
      messages: mapMessages(request),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (request.tools.length > 0) body["tools"] = mapTools(request);
    if (request.maxOutputTokens !== null) body["max_tokens"] = request.maxOutputTokens;
    if (this.#options.thinking) body["thinking"] = { type: this.#options.thinking };
    if (this.#options.reasoningEffort) body["reasoning_effort"] = this.#options.reasoningEffort;

    try {
      const stream = await this.#options.transport.create(body, options.signal);
      const callsByIndex = new Map<number, string>();
      let sawToolCall = false;
      let terminalReason: string | null = null;
      for await (const raw of stream) {
        const chunk = asRecord(raw);
        if (!chunk) throw new Error("DeepSeek 返回了非对象事件");
        const usage = usageFromChunk(chunk);
        if (usage) yield event({ type: "usage_snapshot", usage });

        const choices = chunk["choices"];
        if (!Array.isArray(choices) || choices.length === 0) continue;
        const choice = asRecord(choices[0]);
        if (!choice) throw new Error("DeepSeek choice 非法");
        const delta = asRecord(choice["delta"]);
        if (delta) {
          const reasoningContent = stringField(delta, "reasoning_content");
          if (reasoningContent) {
            yield event({ type: "reasoning_delta", delta: reasoningContent });
          }
          const content = stringField(delta, "content");
          if (content) yield event({ type: "text_delta", delta: content });
          const toolCalls = delta["tool_calls"];
          if (Array.isArray(toolCalls)) {
            for (const rawCall of toolCalls) {
              const call = asRecord(rawCall);
              if (!call) throw new Error("DeepSeek 工具调用片段非法");
              const index = numberField(call, "index");
              if (index === null) throw new Error("DeepSeek 工具调用缺少 index");
              const fn = asRecord(call["function"]);
              const id = stringField(call, "id");
              const name = fn ? stringField(fn, "name") : null;
              let callId = callsByIndex.get(index);
              if (!callId) {
                if (!id || !name) throw new Error("DeepSeek 首个工具调用片段缺少 id/name");
                callId = id;
                callsByIndex.set(index, callId);
                sawToolCall = true;
                yield event({ type: "tool_call_started", callId, name, ordinal: index });
              }
              const argumentsDelta = fn ? stringField(fn, "arguments") : null;
              if (argumentsDelta) {
                yield event({ type: "tool_arguments_delta", callId, delta: argumentsDelta });
              }
            }
          }
        }

        const finishReason = stringField(choice, "finish_reason");
        if (
          finishReason !== null &&
          ![
            "stop",
            "tool_calls",
            "length",
            "content_filter",
            "insufficient_system_resource",
          ].includes(finishReason)
        ) {
          throw new Error(`未知 DeepSeek finish_reason: ${finishReason}`);
        }
        if (finishReason !== null) terminalReason = finishReason;
      }
      if (terminalReason === "stop" || terminalReason === "tool_calls") {
        yield event({
          type: "completed",
          reason: terminalReason === "tool_calls" || sawToolCall ? "tool_calls" : "final_answer",
        });
      } else if (terminalReason === "length" || terminalReason === "content_filter") {
        yield event({
          type: "truncated",
          reason: terminalReason === "length" ? "max_output_tokens" : "content_filter",
          message: `DeepSeek 响应因 ${terminalReason} 截断`,
        });
      } else if (terminalReason === "insufficient_system_resource") {
        yield event({
          type: "truncated",
          reason: "provider_limit",
          message: "DeepSeek 系统资源暂时不足",
        });
      } else {
        yield event({
          type: "error",
          error: { code: "missing_terminal", message: "DeepSeek 流缺少终止事件", retryable: false },
        });
      }
    } catch (error: unknown) {
      if (options.signal.aborted) {
        yield event({ type: "cancelled", reason: "调用方取消了模型请求" });
        return;
      }
      yield event({ type: "error", error: classifyProviderError("DeepSeek", error) });
    }
  }
}
