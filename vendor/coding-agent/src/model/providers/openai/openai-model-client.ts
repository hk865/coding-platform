/** OpenAI Responses API 的 ModelClientPort 适配器。 */
import OpenAI from "openai";
import type {
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";

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

export interface OpenAIResponsesTransport {
  create(
    body: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<AsyncIterable<unknown>>;
}

export interface OpenAIModelClientOptions {
  readonly model: string;
  readonly transport: OpenAIResponsesTransport;
}

export class OpenAISdkResponsesTransport implements OpenAIResponsesTransport {
  readonly #client: OpenAI;

  constructor(options: {
    readonly apiKey: string;
    readonly baseUrl?: string;
    readonly organization?: string;
    readonly project?: string;
  }) {
    this.#client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      organization: options.organization,
      project: options.project,
      maxRetries: 0,
    });
  }

  async create(
    body: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<AsyncIterable<ResponseStreamEvent>> {
    return this.#client.responses.create(body as unknown as ResponseCreateParamsStreaming, {
      signal,
    });
  }
}

function mapMessages(request: ModelRequest): readonly Record<string, unknown>[] {
  return request.messages.flatMap((message): readonly Record<string, unknown>[] => {
    if (message.role === "user") {
      return [{ type: "message", role: "user", content: message.content }];
    }
    if (message.role === "assistant") {
      const text =
        message.content.length > 0
          ? [{ type: "message", role: "assistant", content: message.content }]
          : [];
      const calls = message.toolCalls.map((call) => ({
        type: "function_call",
        call_id: call.callId,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      }));
      return [...text, ...calls];
    }
    return [
      {
        type: "function_call_output",
        call_id: message.callId,
        output: JSON.stringify(message.result),
      },
    ];
  });
}

function mapTools(request: ModelRequest): readonly Record<string, unknown>[] {
  return request.tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }));
}

function usageFromResponse(response: Record<string, unknown>) {
  const usage = asRecord(response["usage"]);
  if (!usage) return null;
  const inputDetails = asRecord(usage["input_tokens_details"]);
  return zeroCostUsage(
    numberField(usage, "input_tokens") ?? 0,
    numberField(usage, "output_tokens") ?? 0,
    inputDetails ? (numberField(inputDetails, "cached_tokens") ?? 0) : 0,
  );
}

export class OpenAIModelClient implements ModelClientPort {
  readonly #model: string;
  readonly #transport: OpenAIResponsesTransport;

  constructor(options: Readonly<OpenAIModelClientOptions>) {
    if (options.model.trim().length === 0) throw new Error("OpenAI model 不能为空");
    this.#model = options.model;
    this.#transport = options.transport;
  }

  async *stream(
    candidate: Readonly<ModelRequest>,
    options: Readonly<ModelCallOptions>,
  ): AsyncIterable<ModelEvent> {
    const request = modelRequestSchema.parse(candidate);
    const event = createEventFactory(request.requestId);
    const body: Record<string, unknown> = {
      model: this.#model,
      instructions: request.systemPrompt,
      input: mapMessages(request),
      parallel_tool_calls: true,
      stream: true,
      store: false,
    };
    if (request.tools.length > 0) body["tools"] = mapTools(request);
    if (request.maxOutputTokens !== null) body["max_output_tokens"] = request.maxOutputTokens;

    try {
      const stream = await this.#transport.create(body, options.signal);
      const calls = new Map<string, { readonly name: string; readonly ordinal: number }>();
      const itemToCallId = new Map<string, string>();
      let ordinal = 0;
      for await (const raw of stream) {
        const record = asRecord(raw);
        if (!record) throw new Error("OpenAI 返回了非对象事件");
        const type = stringField(record, "type");
        if (type === "response.output_text.delta") {
          const delta = stringField(record, "delta");
          if (delta) yield event({ type: "text_delta", delta });
        } else if (type === "response.output_item.added") {
          const item = asRecord(record["item"]);
          if (item && stringField(item, "type") === "function_call") {
            const callId = stringField(item, "call_id");
            const itemId = stringField(item, "id");
            const name = stringField(item, "name");
            if (!callId || !name || calls.has(callId)) throw new Error("OpenAI 工具调用事件非法");
            calls.set(callId, { name, ordinal });
            if (itemId) itemToCallId.set(itemId, callId);
            yield event({ type: "tool_call_started", callId, name, ordinal: ordinal++ });
          }
        } else if (type === "response.function_call_arguments.delta") {
          const itemId = stringField(record, "item_id");
          const callId =
            (itemId ? itemToCallId.get(itemId) : undefined) ?? stringField(record, "call_id");
          const delta = stringField(record, "delta");
          if (callId && delta) yield event({ type: "tool_arguments_delta", callId, delta });
        } else if (type === "response.completed") {
          const response = asRecord(record["response"]);
          const usage = response ? usageFromResponse(response) : null;
          if (usage) yield event({ type: "usage_snapshot", usage });
          yield event({
            type: "completed",
            reason: calls.size > 0 ? "tool_calls" : "final_answer",
          });
          return;
        } else if (type === "response.incomplete") {
          yield event({
            type: "truncated",
            reason: "max_output_tokens",
            message: "OpenAI 响应未完整结束",
          });
          return;
        } else if (type === "response.failed" || type === "error") {
          yield event({
            type: "error",
            error: {
              code: "provider_response_failed",
              message: "OpenAI 响应失败",
              retryable: false,
            },
          });
          return;
        }
      }
      yield event({
        type: "error",
        error: { code: "missing_terminal", message: "OpenAI 流缺少终止事件", retryable: false },
      });
    } catch (error: unknown) {
      if (options.signal.aborted) {
        yield event({ type: "cancelled", reason: "调用方取消了模型请求" });
        return;
      }
      yield event({ type: "error", error: classifyProviderError("OpenAI", error) });
    }
  }
}
