import { describe, expect, it } from "vitest";

import type {
  ModelClientPort,
  ModelEvent,
  ModelRequest,
} from "../../src/core/ports/model_client/model-client-port.js";
import type {
  RunConfigSnapshot,
  WorkspaceReference,
} from "../../src/core/ports/session_store/session-store-port.js";
import type {
  ToolCall,
  ToolExecutorPort,
  ToolResult,
} from "../../src/core/ports/tool_executor/tool-executor-port.js";
import { CheckpointingEventSink } from "../../src/core/runtime/checkpointing/checkpointing-event-sink.js";
import { RuntimeRunner } from "../../src/core/runtime/loop/runtime-runner.js";
import { createInitialRunState } from "../../src/core/runtime/state/run-state.js";
import type { Run } from "../../src/core/runtime/state/run-state.js";
import { InMemoryStores } from "../../src/storage/adapters/in_memory/in-memory-stores.js";
import { SessionEventSink } from "../../src/storage/session_event_sink/session-event-sink.js";
import { createDeterministicIdGenerator } from "../helpers/deterministic-id.js";
import { ManualClock } from "../helpers/manual-clock.js";

const time = "2026-08-20T00:00:00.000Z";
const digest = "b".repeat(64);
const options = { signal: new AbortController().signal };
const config: RunConfigSnapshot = {
  modelConfigId: "fake",
  limits: {
    maxModelRequests: null,
    maxToolCalls: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    maxTotalTokens: null,
    maxCostUsdMicros: null,
    deadlineMs: null,
  },
  enabledToolSchemaDigest: digest,
  policyVersion: "m3-v1",
  sandboxProfileVersion: "workspace-m3-v1",
  baseConfigDigest: digest,
};
const workspace: WorkspaceReference = {
  identity: "workspace",
  revision: "revision",
  reference: "workspace://test",
};

class ToolThenAnswerModel implements ModelClientPort {
  #count = 0;

  stream(request: Readonly<ModelRequest>): AsyncIterable<ModelEvent> {
    this.#count += 1;
    return this.#count === 1 ? this.#tool(request.requestId) : this.#answer(request.requestId);
  }

  async *#tool(requestId: string): AsyncIterable<ModelEvent> {
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
    yield { schemaVersion: 1, requestId, sequence: 3, type: "completed", reason: "tool_calls" };
  }

  async *#answer(requestId: string): AsyncIterable<ModelEvent> {
    yield { schemaVersion: 1, requestId, sequence: 1, type: "text_delta", delta: "done" };
    yield { schemaVersion: 1, requestId, sequence: 2, type: "completed", reason: "final_answer" };
  }
}

class PersistenceAssertingTool implements ToolExecutorPort {
  observedStarted = false;

  constructor(private readonly stores: InMemoryStores) {}

  async execute(call: Readonly<ToolCall>): Promise<ToolResult> {
    const page = await this.stores.read("session-runtime", 0, 100, options);
    this.observedStarted = page.records.some(
      (record) =>
        record.recordType === "agent.event" &&
        record.payload.event.type === "tool.started" &&
        record.payload.event.payload.call.callId === call.callId,
    );
    return {
      schemaVersion: 1,
      callId: call.callId,
      status: "success",
      output: [{ kind: "text", text: "content" }],
      // 模拟真实 edit：工具结果携带写入后的 workspace revision。
      effects: {
        sideEffect: "confirmed",
        changedPaths: ["README.md"],
        workspaceRevision: "revision-after-tool",
        artifactRefs: [],
      },
    };
  }
}

describe("M4 Runtime persistence ordering", () => {
  it("required Session sink 先持久化 ToolStarted，再启动工具，并在稳定边界保存 checkpoint", async () => {
    const stores = new InMemoryStores();
    const run: Run = {
      schemaVersion: 1,
      runId: "run-runtime",
      turn: {
        turnId: "turn-runtime",
        userMessage: {
          schemaVersion: 1,
          messageId: "user-runtime",
          role: "user",
          content: "read",
        },
      },
      createdAt: time,
    };
    await stores.create(
      { sessionId: "session-runtime", recordId: "session-created", createdAt: time },
      options,
    );
    await stores.append(
      "session-runtime",
      1,
      [
        {
          recordId: "turn-started",
          recordType: "turn.started",
          schemaVersion: 1,
          recordedAt: time,
          payload: { run, config, workspace },
        },
      ],
      options,
    );
    const sessionSink = await SessionEventSink.connect(stores, "session-runtime", options);
    const checkpointSink = new CheckpointingEventSink(
      createInitialRunState(run),
      stores,
      sessionSink,
      config,
      workspace,
    );
    const tool = new PersistenceAssertingTool(stores);
    const runner = new RuntimeRunner({
      modelClient: new ToolThenAnswerModel(),
      toolExecutor: tool,
      eventSinks: [checkpointSink, sessionSink],
      idGenerator: createDeterministicIdGenerator("persistent"),
      clock: new ManualClock(Date.parse(time)),
    });
    const finalState = await runner.run({
      run,
      baseSystemPrompt: "agent",
      tools: [{ name: "read", description: "read", inputSchema: { type: "object" } }],
      tokenBudget: 10_000,
    });

    expect(finalState.status).toBe("completed");
    expect(tool.observedStarted).toBe(true);
    const records = await stores.read("session-runtime", 0, 100, options);
    const lastRecord = records.records.at(-1);
    expect(lastRecord?.recordType).toBe("agent.event");
    expect(lastRecord?.recordType === "agent.event" ? lastRecord.payload.event.type : null).toBe(
      "run.completed",
    );
    const checkpoints = await stores.listCheckpoints(run.runId, options);
    expect(checkpoints).toHaveLength(3);
    expect(checkpoints[0]?.state).toEqual(finalState);
    // 后续恢复应接受 Agent 自己写入后的 workspace，而不是只认 turn 启动版本。
    expect(checkpoints[0]?.workspace.revision).toBe("revision-after-tool");
    await stores.close();
  });
});
