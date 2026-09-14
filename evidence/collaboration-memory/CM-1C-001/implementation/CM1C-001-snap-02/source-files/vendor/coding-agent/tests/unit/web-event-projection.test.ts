import { describe, expect, it } from "vitest";

import { WebEventProjectionSink } from "../../src/app/web/web-event-projection.js";
import type { WebRuntimeProjection } from "../../src/app/web/web-event-projection.js";
import { agentEventSchema } from "../../src/core/runtime/events/agent-events.js";

const controller = new AbortController();

function meta(sequence: number, elapsedMs: number) {
  return {
    schemaVersion: 1 as const,
    eventId: `event-${sequence}`,
    runId: "run-web-projection",
    turnId: "turn-web-projection",
    sequence,
    occurredAt: new Date(elapsedMs).toISOString(),
    elapsedMs,
  };
}

describe("WebEventProjectionSink", () => {
  it("把已提交事件折叠为模型/工具轨迹、Token、TPS、次数和耗时", async () => {
    const projections: WebRuntimeProjection[] = [];
    const sink = new WebEventProjectionSink({
      contextWindowTokens: 1_000_000,
      maxModelRequests: 64,
      maxToolCalls: 128,
      emit: (projection) => projections.push(structuredClone(projection)),
    });
    const call = {
      schemaVersion: 1 as const,
      callId: "call-shell",
      name: "shell",
      arguments: { command: "npm test" },
    };
    const events = [
      { type: "run.started", meta: meta(1, 0), payload: {} },
      {
        type: "model.request_started",
        meta: meta(2, 0),
        payload: { requestId: "request-1", retryOfRequestId: null },
      },
      {
        type: "model.usage_recorded",
        meta: meta(3, 1_000),
        payload: {
          requestId: "request-1",
          delta: {
            inputTokens: 1_000,
            outputTokens: 100,
            cachedInputTokens: 200,
            costUsdMicros: null,
          },
        },
      },
      {
        type: "assistant.message_completed",
        meta: meta(4, 2_000),
        payload: {
          requestId: "request-1",
          message: {
            schemaVersion: 1,
            messageId: "assistant-1",
            role: "assistant",
            content: "我先运行测试确认当前状态。",
            reasoningContent: "需要先验证测试基线。",
          },
          toolCalls: [call],
        },
      },
      { type: "tool.started", meta: meta(5, 2_100), payload: { call } },
      {
        type: "tool.completed",
        meta: meta(6, 2_600),
        payload: {
          callId: "call-shell",
          result: {
            schemaVersion: 1,
            callId: "call-shell",
            status: "success",
            output: [
              { kind: "text", text: "all tests passed" },
              { kind: "json", value: { exitCode: 0 } },
            ],
            effects: {
              sideEffect: "none",
              changedPaths: [],
              workspaceRevision: null,
              artifactRefs: [],
            },
          },
        },
      },
      {
        type: "model.request_started",
        meta: meta(7, 2_700),
        payload: { requestId: "request-2", retryOfRequestId: null },
      },
      {
        type: "assistant.message_completed",
        meta: meta(8, 3_000),
        payload: {
          requestId: "request-2",
          message: {
            schemaVersion: 1,
            messageId: "assistant-2",
            role: "assistant",
            content: "## 结果\n\n测试已通过。",
          },
          toolCalls: [],
        },
      },
    ];

    for (const raw of events) {
      await sink.publish(agentEventSchema.parse(raw), { signal: controller.signal });
    }

    const modelCompleted = projections.find(
      (projection) => projection.sourceType === "assistant.message_completed",
    );
    const toolCompleted = projections.find(
      (projection) => projection.sourceType === "tool.completed",
    );
    const finalCompleted = projections.findLast(
      (projection) => projection.sourceType === "assistant.message_completed",
    );
    expect(modelCompleted).toMatchObject({
      summary: "请求工具：shell",
      assistantText: "我先运行测试确认当前状态。",
      reasoningText: "需要先验证测试基线。",
      assistantPhase: "progress",
      input: null,
      output: null,
      durationMs: 2_000,
      metrics: {
        turns: 1,
        modelRequests: 1,
        maxModelRequests: 64,
        inputTokens: 1_000,
        outputTokens: 100,
        cachedInputTokens: 200,
        tokensPerSecond: 50,
      },
    });
    expect(toolCompleted).toMatchObject({
      toolName: "shell",
      status: "completed",
      summary: "exit 0 · all tests passed",
      durationMs: 500,
      metrics: { toolCalls: 1, toolMs: 500, contextPercent: 0.1 },
    });
    expect(toolCompleted?.input).toContain("npm test");
    expect(toolCompleted?.output).toContain("all tests passed");
    expect(finalCompleted).toMatchObject({
      summary: "生成最终回答",
      assistantText: "## 结果\n\n测试已通过。",
      reasoningText: null,
      assistantPhase: "final",
    });
  });

  it("保留内部失败分类、错误码和消息供人排查", async () => {
    const projections: WebRuntimeProjection[] = [];
    const sink = new WebEventProjectionSink({
      contextWindowTokens: 1_000_000,
      maxModelRequests: 64,
      maxToolCalls: 128,
      emit: (projection) => projections.push(projection),
    });
    await sink.publish(
      agentEventSchema.parse({
        type: "run.failed",
        meta: meta(1, 200_540),
        payload: {
          failure: {
            category: "internal",
            code: "runner_internal",
            message: "ToolResult call-x 没有唯一且未结算的 ToolCall",
            retryable: false,
            operationId: null,
          },
        },
      }),
      { signal: controller.signal },
    );

    expect(projections[0]).toMatchObject({
      title: "任务失败",
      summary: "internal/runner_internal: ToolResult call-x 没有唯一且未结算的 ToolCall",
      elapsedMs: 200_540,
    });
  });

  it("正常取消投影为 cancelled 工具条目，携带真实取消原因、输出与 effects", async () => {
    const projections: WebRuntimeProjection[] = [];
    const sink = new WebEventProjectionSink({
      contextWindowTokens: 1_000_000,
      maxModelRequests: 64,
      maxToolCalls: 128,
      emit: (projection) => projections.push(projection),
    });
    const call = {
      schemaVersion: 1 as const,
      callId: "call-shell",
      name: "shell",
      arguments: { command: "npm test" },
    };
    await sink.publish(
      agentEventSchema.parse({
        type: "tool.started",
        meta: meta(1, 100),
        payload: { call },
      }),
      { signal: controller.signal },
    );
    await sink.publish(
      agentEventSchema.parse({
        type: "tool.cancelled",
        meta: meta(2, 500),
        payload: {
          callId: "call-shell",
          result: {
            schemaVersion: 1,
            callId: "call-shell",
            status: "cancelled",
            reason: "user_interrupt",
            output: [{ kind: "text", text: "已有部分输出" }],
            effects: {
              sideEffect: "possible",
              changedPaths: ["a.txt"],
              workspaceRevision: "revision-x",
              artifactRefs: [],
            },
          },
        },
      }),
      { signal: controller.signal },
    );

    const projection = projections.at(-1)!;
    expect(projection).toMatchObject({
      kind: "tool",
      status: "cancelled",
      title: "shell 已取消",
      callId: "call-shell",
      toolName: "shell",
      durationMs: 400,
    });
    expect(projection.summary).toContain("user_interrupt");
    expect(projection.output).toContain("已有部分输出");
    expect(projection.output).toContain("cancelled: user_interrupt");
  });

  it("结果未知投影为 outcome_unknown 工具条目，明确禁止自动重试", async () => {
    const projections: WebRuntimeProjection[] = [];
    const sink = new WebEventProjectionSink({
      contextWindowTokens: 1_000_000,
      maxModelRequests: 64,
      maxToolCalls: 128,
      emit: (projection) => projections.push(projection),
    });
    const call = {
      schemaVersion: 1 as const,
      callId: "call-edit",
      name: "edit",
      arguments: { mode: "create", path: "a.txt", newText: "x" },
    };
    await sink.publish(
      agentEventSchema.parse({
        type: "tool.started",
        meta: meta(1, 100),
        payload: { call },
      }),
      { signal: controller.signal },
    );
    await sink.publish(
      agentEventSchema.parse({
        type: "tool.outcome_unknown",
        meta: meta(2, 900),
        payload: {
          callId: "call-edit",
          toolName: "edit",
          effectClass: "workspace_write",
          reason: "process_interrupted",
          retryPolicy: "never_automatic",
          recordedCallEventId: "event-tool-started",
          synthesizedResult: {
            schemaVersion: 1,
            callId: "call-edit",
            status: "error",
            error: {
              code: "outcome_unknown",
              message: "工具 edit 的结果未知",
              retryable: false,
            },
            output: [{ kind: "text", text: "可能已经产生副作用；系统不能自动重试" }],
            effects: {
              sideEffect: "possible",
              changedPaths: [],
              workspaceRevision: null,
              artifactRefs: [],
            },
          },
        },
      }),
      { signal: controller.signal },
    );

    const projection = projections.at(-1)!;
    expect(projection).toMatchObject({
      kind: "tool",
      status: "outcome_unknown",
      title: "edit 结果未知",
      callId: "call-edit",
      toolName: "edit",
      durationMs: 800,
    });
    expect(projection.summary).toContain("禁止自动重试");
    expect(projection.output).toContain("outcome_unknown");
    expect(projection.output).toContain("不能自动重试");
  });
});
