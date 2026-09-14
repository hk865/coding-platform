import { describe, expect, it } from "vitest";

import {
  modelRequestSchema,
  validateModelEventSequence,
} from "../../src/core/ports/model_client/model-client-port.js";
import {
  toolCallSchema,
  toolResultSchema,
} from "../../src/core/ports/tool_executor/tool-executor-port.js";
import { agentEventSchema } from "../../src/core/runtime/events/agent-events.js";
import {
  ControllableGate,
  EventCollector,
  FakeModelClient,
  FakeToolExecutor,
} from "../fakes/test-fakes.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

const request = modelRequestSchema.parse({
  schemaVersion: 1,
  requestId: "request-1",
  runId: "run-1",
  systemPrompt: "遵循规则",
  messages: [{ role: "user", messageId: "message-1", content: "读取 README" }],
  tools: [],
  maxOutputTokens: 100,
});

const noEffects = {
  sideEffect: "none" as const,
  changedPaths: [],
  workspaceRevision: null,
  artifactRefs: [],
};

describe("M1-06 FakeModelClient", () => {
  it("按调用顺序重放脚本，深拷贝请求并允许注入非法协议", async () => {
    const validScript = [
      {
        kind: "emit" as const,
        event: {
          schemaVersion: 1,
          requestId: "request-1",
          sequence: 1,
          type: "text_delta",
          delta: "完成",
        },
      },
      {
        kind: "emit" as const,
        event: {
          schemaVersion: 1,
          requestId: "request-1",
          sequence: 2,
          type: "completed",
          reason: "final_answer",
        },
      },
    ];
    const client = new FakeModelClient([
      validScript,
      [
        {
          kind: "emit",
          event: {
            schemaVersion: 1,
            requestId: "request-1",
            sequence: 2,
            type: "completed",
            reason: "final_answer",
          },
        },
      ],
    ]);

    const first = await collect(client.stream(request, { signal: new AbortController().signal }));
    const invalid = await collect(client.stream(request, { signal: new AbortController().signal }));
    request.systemPrompt = "caller mutated";

    expect(validateModelEventSequence(first)).toEqual({ ok: true });
    expect(validateModelEventSequence(invalid)).toMatchObject({
      ok: false,
      violation: { code: "sequence_mismatch" },
    });
    expect(client.requests.map((item) => item.systemPrompt)).toEqual(["遵循规则", "遵循规则"]);
    expect(client.actionPositions).toEqual([2, 1]);
    expect(client.maxConcurrentCalls).toBe(1);
  });

  it("用显式 gate 等待并观察取消，不依赖真实 sleep", async () => {
    const gate = new ControllableGate();
    const controller = new AbortController();
    const client = new FakeModelClient([[{ kind: "wait", gate }]]);
    const pending = collect(client.stream(request, { signal: controller.signal }));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(client.abortObservationCount).toBe(1);
    expect(gate.released).toBe(false);
  });
});

describe("M1-06 FakeToolExecutor", () => {
  it("支持按 callId 和调用顺序脚本化并记录副作用", async () => {
    const readCall = toolCallSchema.parse({
      schemaVersion: 1,
      callId: "call-read",
      name: "read",
      arguments: { path: "README.md" },
    });
    const editCall = toolCallSchema.parse({
      schemaVersion: 1,
      callId: "call-edit",
      name: "edit",
      arguments: { path: "README.md", text: "updated" },
    });
    const success = {
      schemaVersion: 1,
      callId: "call-edit",
      status: "success",
      output: [{ kind: "text", text: "updated" }],
      effects: {
        sideEffect: "confirmed",
        changedPaths: ["README.md"],
        workspaceRevision: "revision-1",
        artifactRefs: [],
      },
    };
    const unknown = {
      schemaVersion: 1,
      callId: "call-read",
      status: "error",
      error: { code: "unknown_tool", message: "unknown", retryable: false },
      output: [],
      effects: noEffects,
    };
    const executor = new FakeToolExecutor({
      byOrder: [[{ kind: "return", result: unknown }]],
      byCallId: {
        "call-edit": [{ kind: "return", result: success }],
      },
    });

    const first = await executor.execute(readCall, { signal: new AbortController().signal });
    const second = await executor.execute(editCall, { signal: new AbortController().signal });

    expect(toolResultSchema.parse(first)).toMatchObject({ status: "error" });
    expect(toolResultSchema.parse(second)).toMatchObject({ status: "success" });
    expect(executor.calls.map((call) => call.callId)).toEqual(["call-read", "call-edit"]);
    expect(executor.actionPositions).toEqual([1, 1]);
    expect(executor.sideEffectCount).toBe(1);
    expect(executor.confirmedSideEffectCount).toBe(1);
    expect(executor.maxConcurrentCalls).toBe(1);
  });

  it("等待 gate 时可按脚本返回带 effects 的 cancelled 结果", async () => {
    const call = toolCallSchema.parse({
      schemaVersion: 1,
      callId: "call-shell",
      name: "shell",
      arguments: { command: "test" },
    });
    const gate = new ControllableGate();
    const controller = new AbortController();
    const executor = new FakeToolExecutor({
      byOrder: [
        [
          {
            kind: "wait",
            gate,
            onAbort: "cancel",
            reason: "runtime aborted",
            effects: { ...noEffects, sideEffect: "possible" },
          },
        ],
      ],
    });
    const pending = executor.execute(call, { signal: controller.signal });

    controller.abort();

    await expect(pending).resolves.toMatchObject({
      callId: "call-shell",
      status: "cancelled",
      effects: { sideEffect: "possible" },
    });
    expect(executor.actionPositions).toEqual([1]);
    expect(executor.abortObservationCount).toBe(1);
    expect(executor.sideEffectCount).toBe(1);
  });
});

describe("M1-06 EventCollector", () => {
  const event = () =>
    agentEventSchema.parse({
      type: "run.cancelled",
      meta: {
        schemaVersion: 1,
        eventId: "event-1",
        runId: "run-1",
        turnId: "turn-1",
        sequence: 1,
        occurredAt: "2026-08-20T00:00:00.000Z",
        elapsedMs: 1,
      },
      payload: { reason: "caller_requested" },
    });

  it("按序保存深拷贝并查询终止事件", async () => {
    const collector = new EventCollector();
    const source = event();
    await collector.publish(source, { signal: new AbortController().signal });
    source.meta.eventId = "caller-mutated";

    expect(collector.events[0]?.meta.eventId).toBe("event-1");
    expect(collector.eventsOfType("run.cancelled")).toHaveLength(1);
    expect(collector.terminalEventCount).toBe(1);
  });

  it("可在指定 sequence 失败或阻塞，并保留投递尝试", async () => {
    const failing = new EventCollector({
      sinkId: "required-audit",
      delivery: "required",
      failAtSequences: [1],
    });
    await expect(
      failing.publish(event(), { signal: new AbortController().signal }),
    ).rejects.toThrow(/scripted failure/);
    expect(failing.attempts).toHaveLength(1);
    expect(failing.events).toHaveLength(0);

    const gate = new ControllableGate();
    const blocked = new EventCollector({ gatesBySequence: new Map([[1, gate]]) });
    const publishing = blocked.publish(event(), { signal: new AbortController().signal });
    expect(blocked.events).toHaveLength(0);
    gate.release();
    await publishing;
    expect(blocked.events).toHaveLength(1);
  });
});
