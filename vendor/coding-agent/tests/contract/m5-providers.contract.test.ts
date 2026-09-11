import { describe, expect, it } from "vitest";

import type { ModelRequest } from "../../src/core/ports/model_client/model-client-port.js";
import { validateModelEventSequence } from "../../src/core/ports/model_client/model-client-port.js";
import { DeepSeekModelClient } from "../../src/model/providers/deepseek/deepseek-model-client.js";
import { OpenAIModelClient } from "../../src/model/providers/openai/openai-model-client.js";
import { createBuiltinProviderRegistry } from "../../src/model/providers/registry/builtin-provider-registry.js";

const request: ModelRequest = {
  schemaVersion: 1,
  requestId: "request-m5",
  runId: "run-m5",
  systemPrompt: "Be concise.",
  messages: [{ role: "user", messageId: "message-user", content: "Read package.json" }],
  tools: [
    {
      name: "read",
      description: "Read a file",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  ],
  maxOutputTokens: 128,
};

async function* fixture(values: readonly unknown[]): AsyncIterable<unknown> {
  for (const value of values) yield value;
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

describe("M5 Provider contracts", () => {
  it("OpenAI Responses 映射工具调用、参数、usage 和 terminal", async () => {
    let body: Readonly<Record<string, unknown>> | null = null;
    const client = new OpenAIModelClient({
      model: "gpt-5.2",
      transport: {
        async create(candidate) {
          body = candidate;
          return fixture([
            {
              type: "response.output_item.added",
              item: { type: "function_call", id: "item-1", call_id: "call-1", name: "read" },
            },
            {
              type: "response.function_call_arguments.delta",
              item_id: "item-1",
              delta: '{"path":"package.json"}',
            },
            {
              type: "response.completed",
              response: {
                usage: {
                  input_tokens: 20,
                  output_tokens: 7,
                  input_tokens_details: { cached_tokens: 3 },
                },
              },
            },
          ]);
        },
      },
    });
    const events = await collect(client.stream(request, { signal: new AbortController().signal }));
    expect(validateModelEventSequence(events)).toEqual({ ok: true });
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      "tool_call_started",
      "tool_arguments_delta",
      "usage_snapshot",
      "completed",
    ]);
    expect(body).toMatchObject({
      model: "gpt-5.2",
      stream: true,
      store: false,
      max_output_tokens: 128,
    });
  });

  it("DeepSeek 等待 usage-only 最后 chunk 后再结束", async () => {
    let body: Readonly<Record<string, unknown>> | null = null;
    const client = new DeepSeekModelClient({
      model: "deepseek-v4-flash",
      transport: {
        async create(candidate) {
          body = candidate;
          return fixture([
            {
              choices: [
                {
                  delta: {
                    reasoning_content: "需要读取 package.json。",
                    tool_calls: [
                      {
                        index: 0,
                        id: "call-1",
                        function: { name: "read", arguments: '{"path":' },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              choices: [
                {
                  delta: { tool_calls: [{ index: 0, function: { arguments: '"package.json"}' } }] },
                  finish_reason: "tool_calls",
                },
              ],
            },
            {
              choices: [],
              usage: { prompt_tokens: 18, completion_tokens: 5, prompt_cache_hit_tokens: 2 },
            },
          ]);
        },
      },
    });
    const events = await collect(client.stream(request, { signal: new AbortController().signal }));
    expect(validateModelEventSequence(events)).toEqual({ ok: true });
    expect(events.at(-2)).toMatchObject({ type: "usage_snapshot" });
    expect(events.at(-1)).toMatchObject({ type: "completed", reason: "tool_calls" });
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 128,
      thinking: { type: "enabled" },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "reasoning_delta",
        delta: "需要读取 package.json。",
      }),
    );
  });

  it("DeepSeek thinking + ToolCall 会把上一轮 reasoning_content 随 ToolResult 回传", async () => {
    let transportCalls = 0;
    let body: Readonly<Record<string, unknown>> | null = null;
    const client = new DeepSeekModelClient({
      model: "deepseek-v4-flash",
      thinking: "enabled",
      transport: {
        async create(candidate) {
          transportCalls += 1;
          body = candidate;
          return fixture([
            {
              choices: [
                {
                  delta: { reasoning_content: "工具结果表明文件存在。" },
                  finish_reason: null,
                },
              ],
            },
            {
              choices: [{ delta: { content: "读取完成" }, finish_reason: "stop" }],
            },
          ]);
        },
      },
    });
    const followUpRequest: ModelRequest = {
      ...request,
      messages: [
        request.messages[0]!,
        {
          role: "assistant",
          messageId: "assistant-tool-call",
          content: "",
          reasoningContent: "先读取 package.json。",
          toolCalls: [
            {
              schemaVersion: 1,
              callId: "call-1",
              name: "read",
              arguments: { path: "package.json" },
            },
          ],
        },
        {
          role: "tool",
          callId: "call-1",
          result: {
            schemaVersion: 1,
            callId: "call-1",
            status: "success",
            output: [{ kind: "text", text: "{}" }],
            effects: {
              sideEffect: "none",
              changedPaths: [],
              workspaceRevision: null,
              artifactRefs: [],
            },
          },
        },
      ],
    };

    const events = await collect(
      client.stream(followUpRequest, { signal: new AbortController().signal }),
    );
    expect(transportCalls).toBe(1);
    expect(validateModelEventSequence(events)).toEqual({ ok: true });
    expect(body).toMatchObject({
      thinking: { type: "enabled" },
      messages: [
        { role: "system" },
        { role: "user" },
        {
          role: "assistant",
          reasoning_content: "先读取 package.json。",
          tool_calls: [expect.objectContaining({ id: "call-1" })],
        },
        { role: "tool", tool_call_id: "call-1" },
      ],
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "reasoning_delta", delta: "工具结果表明文件存在。" }),
    );
  });

  it("Registry 固定 openai/deepseek，未知 Provider fail closed", () => {
    const registry = createBuiltinProviderRegistry();
    expect(registry.list().map((provider) => provider.id)).toEqual(["openai", "deepseek"]);
    expect(() => registry.get("automatic")).toThrow("不支持的 Provider");
    expect(registry.get("openai").secretEnvironmentVariable).toBe("OPENAI_API_KEY");
    expect(registry.get("deepseek").secretEnvironmentVariable).toBe("DEEPSEEK_API_KEY");
  });
});
