import { describe, expect, it } from "vitest";

import type {
  ModelClientPort,
  ModelEvent,
  ModelRequest,
} from "../../src/core/ports/model_client/model-client-port.js";
import type { ToolExecutorPort } from "../../src/core/ports/tool_executor/tool-executor-port.js";
import type { AgentEvent } from "../../src/core/runtime/events/agent-events.js";
import { RuntimeRunner } from "../../src/core/runtime/loop/runtime-runner.js";

describe("tool drain timeout regression review", () => {
  it("does not time out an ordinary long-running tool before cancellation begins", async () => {
    let modelRequests = 0;
    const model: ModelClientPort = {
      stream(request: Readonly<ModelRequest>): AsyncIterable<ModelEvent> {
        modelRequests += 1;
        return modelRequests === 1 ? toolRequest(request.requestId) : answer(request.requestId);
      },
    };
    let sideEffects = 0;
    const tool: ToolExecutorPort = {
      async execute(call) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        sideEffects += 1;
        return {
          schemaVersion: 1,
          callId: call.callId,
          status: "success",
          output: [{ kind: "text", text: "late success" }],
          effects: {
            sideEffect: "confirmed",
            changedPaths: ["late-effect.txt"],
            workspaceRevision: "late-revision",
            artifactRefs: [],
          },
        };
      },
    };
    const events: AgentEvent[] = [];
    const state = await new RuntimeRunner({
      modelClient: model,
      toolExecutor: tool,
      eventSinks: [
        {
          sinkId: "review-drain-observer",
          delivery: "best_effort",
          async publish(event) {
            events.push(structuredClone(event));
          },
        },
      ],
      // 缩短同一生产选项以得到快速复现；生产缺省值为 5 秒。
      toolDrainTimeoutMs: 20,
    }).run({
      run: {
        schemaVersion: 1,
        runId: "review-long-tool-run",
        turn: {
          turnId: "review-long-tool-turn",
          userMessage: {
            schemaVersion: 1,
            messageId: "review-long-tool-user",
            role: "user",
            content: "执行一个正常的长工具",
          },
        },
        createdAt: "2026-08-28T00:00:00.000Z",
      },
      baseSystemPrompt: "review-agent",
      tools: [{ name: "edit", description: "edit", inputSchema: { type: "object" } }],
      tokenBudget: 8_000,
    });
    // 等待底层执行器在 Run 已终止后继续完成，证明副作用逃逸了事件结算。
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect({
      status: state.status,
      modelRequests,
      sideEffects,
      eventTypes: events.map((event) => event.type),
    }).toMatchObject({
      status: "completed",
      modelRequests: 2,
      sideEffects: 1,
      eventTypes: expect.arrayContaining(["tool.completed", "run.completed"]),
    });
  });
});

async function* toolRequest(requestId: string): AsyncIterable<ModelEvent> {
  yield {
    schemaVersion: 1,
    requestId,
    sequence: 1,
    type: "tool_call_started",
    callId: "review-long-tool-call",
    name: "edit",
    ordinal: 0,
  };
  yield {
    schemaVersion: 1,
    requestId,
    sequence: 2,
    type: "tool_arguments_delta",
    callId: "review-long-tool-call",
    delta: '{"path":"late-effect.txt"}',
  };
  yield {
    schemaVersion: 1,
    requestId,
    sequence: 3,
    type: "completed",
    reason: "tool_calls",
  };
}

async function* answer(requestId: string): AsyncIterable<ModelEvent> {
  yield {
    schemaVersion: 1,
    requestId,
    sequence: 1,
    type: "text_delta",
    delta: "done",
  };
  yield {
    schemaVersion: 1,
    requestId,
    sequence: 2,
    type: "completed",
    reason: "final_answer",
  };
}
