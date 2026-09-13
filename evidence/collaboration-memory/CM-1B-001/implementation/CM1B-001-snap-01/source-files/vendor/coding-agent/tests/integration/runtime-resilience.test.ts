import { describe, expect, it } from "vitest";

import { HookExecutor } from "../../src/core/hooks/executor/hook-executor.js";
import type { TokenEstimateInput } from "../../src/core/context/selection_policy/context-selection-policy.js";
import type { BeforeModelHookPort } from "../../src/core/hooks/protocol/hook-protocol.js";
import { HookRegistry } from "../../src/core/hooks/registry/hook-registry.js";
import type { EventSinkPort } from "../../src/core/ports/event_sink/event-sink-port.js";
import type {
  ModelClientPort,
  ModelEvent,
  ModelRequest,
} from "../../src/core/ports/model_client/model-client-port.js";
import type { AgentEvent } from "../../src/core/runtime/events/agent-events.js";
import type { ToolBatchPolicy } from "../../src/core/ports/tool_batch_policy/tool-batch-policy-port.js";
import type {
  ToolCall,
  ToolExecutorPort,
  ToolResult,
} from "../../src/core/ports/tool_executor/tool-executor-port.js";
import { RuntimeRunner } from "../../src/core/runtime/loop/runtime-runner.js";
import type { Run } from "../../src/core/runtime/state/run-state.js";
import { EventCollector } from "../fakes/event-collector.js";
import { ManualClock } from "../helpers/manual-clock.js";

const time = "2026-08-20T00:00:00.000Z";

function run(id: string): Run {
  return {
    schemaVersion: 1,
    runId: `run-${id}`,
    turn: {
      turnId: `turn-${id}`,
      userMessage: {
        schemaVersion: 1,
        messageId: `user-${id}`,
        role: "user",
        content: "执行测试",
      },
    },
    createdAt: time,
  };
}

function input(id: string) {
  return {
    run: run(id),
    baseSystemPrompt: "agent",
    tools: [{ name: "read", description: "read", inputSchema: { type: "object" } }],
    tokenBudget: 10_000,
  };
}

function success(callId: string, text = "ok"): ToolResult {
  return {
    schemaVersion: 1,
    callId,
    status: "success",
    output: [{ kind: "text", text }],
    effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
  };
}

function finalEvents(requestId: string): readonly ModelEvent[] {
  return [
    { schemaVersion: 1, requestId, sequence: 1, type: "text_delta", delta: "完成" },
    { schemaVersion: 1, requestId, sequence: 2, type: "completed", reason: "final_answer" },
  ];
}

class NeverTool implements ToolExecutorPort {
  calls = 0;

  async execute(call: Readonly<ToolCall>): Promise<ToolResult> {
    this.calls += 1;
    throw new Error(`不应执行工具 ${call.callId}`);
  }
}

describe("M2 Runtime resilience matrix", () => {
  it("墙钟回拨时 elapsedMs 保持单调，运行不会被状态机拒绝", async () => {
    const clock = new ManualClock(Date.parse(time));
    const events: AgentEvent[] = [];
    const clockRewinder: EventSinkPort = {
      sinkId: "clock-rewinder",
      delivery: "best_effort",
      async publish(event) {
        events.push(structuredClone(event));
        if (event.type === "run.started") clock.advance(100);
        if (event.type === "model.request_started") clock.reset();
      },
    };
    const model: ModelClientPort = {
      async *stream(request) {
        yield* finalEvents(request.requestId);
      },
    };

    const state = await new RuntimeRunner({
      modelClient: model,
      toolExecutor: new NeverTool(),
      clock,
      eventSinks: [clockRewinder],
    }).run(input("clock-regression"));

    expect(state.status).toBe("completed");
    expect(events.map((event) => event.meta.elapsedMs)).toEqual(
      [...events].map((event) => event.meta.elapsedMs).sort((left, right) => left - right),
    );
  });

  it("retryable 模型错误使用新 requestId 重试，并保留 retryOf 关联", async () => {
    const requests: ModelRequest[] = [];
    const model: ModelClientPort = {
      stream(request): AsyncIterable<ModelEvent> {
        requests.push(structuredClone(request));
        const call = requests.length;
        return (async function* () {
          if (call === 1) {
            yield {
              schemaVersion: 1,
              requestId: request.requestId,
              sequence: 1,
              type: "error",
              error: { code: "temporary", message: "temporary", retryable: true },
            };
            return;
          }
          yield* finalEvents(request.requestId);
        })();
      },
    };
    const collector = new EventCollector();
    const state = await new RuntimeRunner({
      modelClient: model,
      toolExecutor: new NeverTool(),
      eventSinks: [collector],
      maxModelRetries: 1,
    }).run(input("retry"));

    expect(state.status).toBe("completed");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.requestId).not.toBe(requests[0]?.requestId);
    const starts = collector.eventsOfType("model.request_started");
    expect(starts[1]?.payload.retryOfRequestId).toBe(requests[0]?.requestId);
  });

  it("一条模型消息的可信只读批次并行执行，但 ToolResult 按 ordinal 回填", async () => {
    let modelCalls = 0;
    const model: ModelClientPort = {
      stream(request): AsyncIterable<ModelEvent> {
        modelCalls += 1;
        if (modelCalls > 1) {
          return (async function* () {
            yield* finalEvents(request.requestId);
          })();
        }
        return (async function* () {
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: 1,
            type: "tool_call_started",
            callId: "call-a",
            name: "read",
            ordinal: 0,
          };
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: 2,
            type: "tool_arguments_delta",
            callId: "call-a",
            delta: '{"path":"a"}',
          };
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: 3,
            type: "tool_call_started",
            callId: "call-b",
            name: "read",
            ordinal: 1,
          };
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: 4,
            type: "tool_arguments_delta",
            callId: "call-b",
            delta: '{"path":"b"}',
          };
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: 5,
            type: "completed",
            reason: "tool_calls",
          };
        })();
      },
    };
    let release: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let maxActive = 0;
    let started = 0;
    const tool: ToolExecutorPort = {
      async execute(call) {
        active += 1;
        started += 1;
        maxActive = Math.max(maxActive, active);
        if (started === 2) release?.();
        await bothStarted;
        active -= 1;
        return success(call.callId, call.callId);
      },
    };
    const policy: ToolBatchPolicy = {
      plan(calls) {
        return [{ mode: "parallel_read_only", callIds: calls.map((call) => call.callId) }];
      },
    };
    const state = await new RuntimeRunner({
      modelClient: model,
      toolExecutor: tool,
      toolBatchPolicy: policy,
    }).run(input("parallel"));

    expect(state.status).toBe("completed");
    expect(maxActive).toBe(2);
    expect(
      state.transcript.filter((entry) => entry.kind === "tool_result").map((entry) => entry.callId),
    ).toEqual(["call-a", "call-b"]);
  });

  it("真实长会话形态连续裁剪多个工具交换后仍能完成下一轮模型请求", async () => {
    const requests: ModelRequest[] = [];
    const plans = [
      [{ callId: "call-a", path: "README.md" }],
      [{ callId: "call-b", path: "src/app/composition/app-config.ts" }],
      [
        { callId: "call-c1", path: "src/core/runtime/loop/runtime-runner.ts" },
        { callId: "call-c2", path: "src/core/context/builder/context-builder.ts" },
      ],
    ] as const;
    const model: ModelClientPort = {
      stream(request): AsyncIterable<ModelEvent> {
        requests.push(structuredClone(request));
        const plan = plans[requests.length - 1];
        if (!plan) {
          return (async function* () {
            yield* finalEvents(request.requestId);
          })();
        }
        return (async function* () {
          let sequence = 0;
          for (const [ordinal, call] of plan.entries()) {
            yield {
              schemaVersion: 1,
              requestId: request.requestId,
              sequence: (sequence += 1),
              type: "tool_call_started",
              callId: call.callId,
              name: "read",
              ordinal,
            };
            yield {
              schemaVersion: 1,
              requestId: request.requestId,
              sequence: (sequence += 1),
              type: "tool_arguments_delta",
              callId: call.callId,
              delta: JSON.stringify({ path: call.path }),
            };
          }
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: sequence + 1,
            type: "completed",
            reason: "tool_calls",
          };
        })();
      },
    };
    const collector = new EventCollector();
    const state = await new RuntimeRunner({
      modelClient: model,
      toolExecutor: {
        async execute(call) {
          return success(call.callId, `读取 ${String(call.arguments["path"])} 完成`);
        },
      },
      tokenEstimator: {
        estimate(value: Readonly<TokenEstimateInput>) {
          return "tokenBudget" in value ? value.transcript.length * 10 : value.messages.length * 10;
        },
      },
      eventSinks: [collector],
    }).run({ ...input("multi-prune-business-regression"), tokenBudget: 40 });

    expect(state.status).toBe("completed");
    expect(requests).toHaveLength(4);
    expect(requests[3]?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
    ]);
    expect(
      requests[3]?.messages
        .filter((message) => message.role === "tool")
        .map((message) => message.callId),
    ).toEqual(["call-c1", "call-c2"]);
    expect(collector.eventsOfType("run.failed")).toHaveLength(0);
  });

  it("达到 model request 上限后不启动下一次模型调用", async () => {
    let modelCalls = 0;
    let toolCalls = 0;
    const model: ModelClientPort = {
      stream(request): AsyncIterable<ModelEvent> {
        modelCalls += 1;
        return (async function* () {
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: 1,
            type: "tool_call_started",
            callId: "call-limit",
            name: "read",
            ordinal: 0,
          };
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: 2,
            type: "tool_arguments_delta",
            callId: "call-limit",
            delta: '{"path":"a"}',
          };
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: 3,
            type: "completed",
            reason: "tool_calls",
          };
        })();
      },
    };
    const state = await new RuntimeRunner({
      modelClient: model,
      toolExecutor: {
        async execute(call) {
          toolCalls += 1;
          return success(call.callId);
        },
      },
      limits: {
        maxModelRequests: 1,
        maxToolCalls: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        maxTotalTokens: null,
        maxCostUsdMicros: null,
        deadlineMs: null,
      },
    }).run(input("limit"));

    expect(state.status).toBe("limit_exceeded");
    expect(state.outcome?.kind === "limit_exceeded" && state.outcome.limit).toBe("model_requests");
    expect(modelCalls).toBe(1);
    expect(toolCalls).toBe(1);
  });

  it("模型等待期间取消会传播 signal，并只产生 cancelled 终态", async () => {
    let started: (() => void) | undefined;
    const modelStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const model: ModelClientPort = {
      stream(request, options): AsyncIterable<ModelEvent> {
        return (async function* () {
          started?.();
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            };
            if (options.signal.aborted) onAbort();
            else options.signal.addEventListener("abort", onAbort, { once: true });
          });

          // 正常取消会从上面的 Promise 抛出；该事件只是让测试桩保持合法的异步流形态。
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: 1,
            type: "cancelled",
            reason: "cancelled",
          };
        })();
      },
    };
    const collector = new EventCollector();
    const controller = new AbortController();
    const running = new RuntimeRunner({
      modelClient: model,
      toolExecutor: new NeverTool(),
      eventSinks: [collector],
    }).run(input("cancel"), {
      signal: controller.signal,
      cancellationReason: "user_interrupt",
    });
    await modelStarted;
    controller.abort();

    const state = await running;
    expect(state.status).toBe("cancelled");
    expect(state.outcome).toEqual({ kind: "cancelled", reason: "user_interrupt" });
    expect(collector.terminalEventCount).toBe(1);
  });

  it("Hook pause 后必须显式 resume，恢复时生成 run.resumed 再调用模型", async () => {
    let hookCalls = 0;
    let modelCalls = 0;
    const hook = {
      hookId: "pause-once",
      point: "before_model",
      priority: 1,
      async execute() {
        hookCalls += 1;
        return hookCalls === 1
          ? { point: "before_model", kind: "pause", reason: "等待操作者" }
          : { point: "before_model", kind: "continue" };
      },
    } satisfies BeforeModelHookPort;
    const collector = new EventCollector();
    const runner = new RuntimeRunner({
      modelClient: {
        stream(request): AsyncIterable<ModelEvent> {
          modelCalls += 1;
          return (async function* () {
            yield* finalEvents(request.requestId);
          })();
        },
      },
      toolExecutor: new NeverTool(),
      hookExecutor: new HookExecutor(new HookRegistry([hook])),
      eventSinks: [collector],
    });
    const runnerInput = input("pause");
    const paused = await runner.run(runnerInput);
    expect(paused.status).toBe("paused");
    expect(modelCalls).toBe(0);

    const completed = await runner.resume(paused, runnerInput);
    expect(completed.status).toBe("completed");
    expect(modelCalls).toBe(1);
    expect(collector.eventsOfType("run.resumed")).toHaveLength(1);
  });

  it("best-effort sink 失败不改变业务结果", async () => {
    const bestEffort = new EventCollector({
      sinkId: "best-effort-failure",
      delivery: "best_effort",
      failAtSequences: [1],
    });
    const state = await new RuntimeRunner({
      modelClient: {
        stream(request): AsyncIterable<ModelEvent> {
          return (async function* () {
            yield* finalEvents(request.requestId);
          })();
        },
      },
      toolExecutor: new NeverTool(),
      eventSinks: [bestEffort],
    }).run(input("best-effort"));

    expect(state.status).toBe("completed");
    expect(bestEffort.attempts.length).toBeGreaterThan(1);
  });

  it("required sink 即使忽略 signal，也会在投递超时后 fail closed", async () => {
    let modelCalls = 0;
    const hangingSink: EventSinkPort = {
      sinkId: "required-hanging",
      delivery: "required",
      async publish() {
        await new Promise<never>(() => undefined);
      },
    };
    const state = await new RuntimeRunner({
      modelClient: {
        stream(request): AsyncIterable<ModelEvent> {
          modelCalls += 1;
          return (async function* () {
            yield* finalEvents(request.requestId);
          })();
        },
      },
      toolExecutor: new NeverTool(),
      eventSinks: [hangingSink],
      eventSinkTimeoutMs: 10,
    }).run(input("sink-timeout"));

    expect(state.status).toBe("failed");
    expect(modelCalls).toBe(0);
    expect(state.outcome?.kind === "failed" && state.outcome.failure.category).toBe(
      "required_sink",
    );
  });
});
