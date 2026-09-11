import { describe, expect, it } from "vitest";

import type {
  ModelClientPort,
  ModelEvent,
  ModelRequest,
} from "../../src/core/ports/model_client/model-client-port.js";
import type {
  ToolCall,
  ToolExecutorPort,
  ToolResult,
} from "../../src/core/ports/tool_executor/tool-executor-port.js";
import { HookExecutor } from "../../src/core/hooks/executor/hook-executor.js";
import type { BeforeModelHookPort } from "../../src/core/hooks/protocol/hook-protocol.js";
import { HookRegistry } from "../../src/core/hooks/registry/hook-registry.js";
import { RuntimeRunner } from "../../src/core/runtime/loop/runtime-runner.js";
import { EventCollector } from "../fakes/event-collector.js";
import { createDeterministicIdGenerator } from "../helpers/deterministic-id.js";
import { ManualClock } from "../helpers/manual-clock.js";

class TwoTurnModel implements ModelClientPort {
  readonly requests: ModelRequest[] = [];

  stream(request: Readonly<ModelRequest>): AsyncIterable<ModelEvent> {
    this.requests.push(structuredClone(request));
    return this.requests.length === 1
      ? this.#toolCall(request.requestId)
      : this.#answer(request.requestId);
  }

  async *#toolCall(requestId: string): AsyncIterable<ModelEvent> {
    yield {
      schemaVersion: 1,
      requestId,
      sequence: 1,
      type: "tool_call_started",
      callId: "call-read",
      name: "read",
      ordinal: 0,
    };
    yield {
      schemaVersion: 1,
      requestId,
      sequence: 2,
      type: "tool_arguments_delta",
      callId: "call-read",
      delta: '{"path":"README.md"}',
    };
    yield {
      schemaVersion: 1,
      requestId,
      sequence: 3,
      type: "usage_snapshot",
      usage: { inputTokens: 20, outputTokens: 5, cachedInputTokens: 0, costUsdMicros: 10 },
    };
    yield { schemaVersion: 1, requestId, sequence: 4, type: "completed", reason: "tool_calls" };
  }

  async *#answer(requestId: string): AsyncIterable<ModelEvent> {
    yield { schemaVersion: 1, requestId, sequence: 1, type: "text_delta", delta: "完成" };
    yield {
      schemaVersion: 1,
      requestId,
      sequence: 2,
      type: "usage_snapshot",
      usage: { inputTokens: 30, outputTokens: 2, cachedInputTokens: 0, costUsdMicros: 8 },
    };
    yield { schemaVersion: 1, requestId, sequence: 3, type: "completed", reason: "final_answer" };
  }
}

class ReadTool implements ToolExecutorPort {
  readonly calls: ToolCall[] = [];

  async execute(call: Readonly<ToolCall>): Promise<ToolResult> {
    this.calls.push(structuredClone(call));
    return {
      schemaVersion: 1,
      callId: call.callId,
      status: "success",
      output: [{ kind: "text", text: "# Project" }],
      effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    };
  }
}

describe("M2 RuntimeRunner", () => {
  it("完成 model -> tool -> model 闭环并累计 usage", async () => {
    const model = new TwoTurnModel();
    const tool = new ReadTool();
    const runner = new RuntimeRunner({
      modelClient: model,
      toolExecutor: tool,
      idGenerator: createDeterministicIdGenerator("runtime"),
      clock: new ManualClock(Date.parse("2026-08-20T00:00:00.000Z")),
    });

    const state = await runner.run({
      run: {
        schemaVersion: 1,
        runId: "run-1",
        turn: {
          turnId: "turn-1",
          userMessage: {
            schemaVersion: 1,
            messageId: "user-1",
            role: "user",
            content: "读取 README",
          },
        },
        createdAt: "2026-08-20T00:00:00.000Z",
      },
      baseSystemPrompt: "You are an agent.",
      tools: [{ name: "read", description: "读取文件", inputSchema: { type: "object" } }],
      tokenBudget: 10_000,
    });

    expect(state.status).toBe("completed");
    expect(state.transcript.map((entry) => entry.kind)).toEqual([
      "user_message",
      "assistant_message",
      "tool_result",
      "assistant_message",
    ]);
    expect(state.usage).toMatchObject({
      modelRequestCount: 2,
      toolCallCount: 1,
      inputTokens: 50,
      outputTokens: 7,
      costUsdMicros: 18,
    });
    expect(model.requests[1]?.messages.at(-1)?.role).toBe("tool");
    expect(tool.calls).toHaveLength(1);
  });

  it("模型事件乱序时以 model_protocol 失败且不执行工具", async () => {
    const model: ModelClientPort = {
      async *stream(request) {
        yield {
          schemaVersion: 1,
          requestId: request.requestId,
          sequence: 2,
          type: "text_delta",
          delta: "bad",
        };
      },
    };
    const tool = new ReadTool();
    const state = await new RuntimeRunner({ modelClient: model, toolExecutor: tool }).run({
      run: {
        schemaVersion: 1,
        runId: "run-protocol",
        turn: {
          turnId: "turn-protocol",
          userMessage: {
            schemaVersion: 1,
            messageId: "user-protocol",
            role: "user",
            content: "test",
          },
        },
        createdAt: "2026-08-20T00:00:00.000Z",
      },
      baseSystemPrompt: "test",
      tokenBudget: 1_000,
    });

    expect(state.status).toBe("failed");
    expect(state.outcome?.kind === "failed" && state.outcome.failure.category).toBe(
      "model_protocol",
    );
    expect(tool.calls).toHaveLength(0);
  });

  it("before_model Hook 修改请求后重新估算，超预算时不调用模型", async () => {
    let modelCalls = 0;
    const model: ModelClientPort = {
      async *stream(request) {
        modelCalls += 1;
        yield {
          schemaVersion: 1,
          requestId: request.requestId,
          sequence: 1,
          type: "completed",
          reason: "final_answer",
        };
      },
    };
    const hook = {
      hookId: "expand-system-prompt",
      point: "before_model",
      priority: 10,
      async execute(invocation) {
        return {
          point: "before_model",
          kind: "modify",
          value: {
            ...invocation.request,
            systemPrompt: invocation.request.systemPrompt + "x".repeat(200),
          },
        };
      },
    } satisfies BeforeModelHookPort;
    const state = await new RuntimeRunner({
      modelClient: model,
      toolExecutor: new ReadTool(),
      hookExecutor: new HookExecutor(new HookRegistry([hook])),
      tokenEstimator: {
        estimate(value) {
          return "tokenBudget" in value ? 10 : value.systemPrompt.length;
        },
      },
    }).run({
      run: {
        schemaVersion: 1,
        runId: "run-hook-budget",
        turn: {
          turnId: "turn-hook-budget",
          userMessage: {
            schemaVersion: 1,
            messageId: "user-hook-budget",
            role: "user",
            content: "test",
          },
        },
        createdAt: "2026-08-20T00:00:00.000Z",
      },
      baseSystemPrompt: "base",
      tokenBudget: 50,
    });

    expect(state.status).toBe("failed");
    expect(state.outcome?.kind === "failed" && state.outcome.failure.category).toBe("context");
    expect(modelCalls).toBe(0);
  });

  it("某个 required sink 失败时，其他健康 sink 仍收到连续的原事件和终止事件", async () => {
    let modelCalls = 0;
    const failing = new EventCollector({
      sinkId: "a-failing-required",
      delivery: "required",
      failAtSequences: [1],
    });
    const healthy = new EventCollector({
      sinkId: "z-healthy-required",
      delivery: "required",
    });
    const state = await new RuntimeRunner({
      modelClient: {
        async *stream(request) {
          modelCalls += 1;
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: 1,
            type: "completed",
            reason: "final_answer",
          };
        },
      },
      toolExecutor: new ReadTool(),
      eventSinks: [failing, healthy],
    }).run({
      run: {
        schemaVersion: 1,
        runId: "run-required-sink",
        turn: {
          turnId: "turn-required-sink",
          userMessage: {
            schemaVersion: 1,
            messageId: "user-required-sink",
            role: "user",
            content: "test",
          },
        },
        createdAt: "2026-08-20T00:00:00.000Z",
      },
      baseSystemPrompt: "base",
      tokenBudget: 1_000,
    });

    // run.started 未获得所有 required sink 确认，所以模型不能启动。
    expect(state.status).toBe("failed");
    expect(modelCalls).toBe(0);
    expect(healthy.events.map((event) => [event.meta.sequence, event.type])).toEqual([
      [1, "run.started"],
      [2, "run.failed"],
    ]);
    expect(failing.attempts).toHaveLength(1);
  });
});
