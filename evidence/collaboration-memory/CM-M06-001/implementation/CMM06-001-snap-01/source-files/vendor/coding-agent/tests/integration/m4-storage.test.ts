import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import type { CheckpointStorePort } from "../../src/core/ports/checkpoint_store/checkpoint-store-port.js";
import { checkpointDraft } from "../../src/core/ports/checkpoint_store/checkpoint-store-port.js";
import type {
  RunConfigSnapshot,
  SessionRecordDraft,
  SessionStorePort,
  WorkspaceReference,
} from "../../src/core/ports/session_store/session-store-port.js";
import { StoreError } from "../../src/core/ports/session_store/session-store-port.js";
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
import type { AgentEvent } from "../../src/core/runtime/events/agent-events.js";
import { RuntimeRunner } from "../../src/core/runtime/loop/runtime-runner.js";
import { RecoveryCoordinator } from "../../src/core/runtime/recovery/recovery-coordinator.js";
import { reduceRunState } from "../../src/core/runtime/reducer/run-state-reducer.js";
import { createInitialRunState } from "../../src/core/runtime/state/run-state.js";
import type { Run, RunState } from "../../src/core/runtime/state/run-state.js";
import { InMemoryStores } from "../../src/storage/adapters/in_memory/in-memory-stores.js";
import { SqliteStores } from "../../src/storage/adapters/sqlite/sqlite-stores.js";
import { SessionEventSink } from "../../src/storage/session_event_sink/session-event-sink.js";
import { createTempWorkspace } from "../helpers/temp-workspace.js";
import type { TempWorkspace } from "../helpers/temp-workspace.js";

type Stores = SessionStorePort & CheckpointStorePort;
const resources: Array<{ close(): Promise<void> }> = [];
const workspaces: TempWorkspace[] = [];
const options = { signal: new AbortController().signal };
const time = "2026-08-20T00:00:00.000Z";
const digest = "a".repeat(64);

const config: RunConfigSnapshot = {
  modelConfigId: "fake-model",
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
const workspaceRef: WorkspaceReference = {
  identity: "workspace-1",
  revision: "revision-1",
  reference: "workspace://fixture",
};

function run(runId = "run-1"): Run {
  return {
    schemaVersion: 1,
    runId,
    turn: {
      turnId: `turn-${runId}`,
      userMessage: {
        schemaVersion: 1,
        messageId: `user-${runId}`,
        role: "user",
        content: "执行任务",
      },
    },
    createdAt: time,
  };
}

function event<TType extends AgentEvent["type"]>(
  state: RunState,
  type: TType,
  payload: Extract<AgentEvent, { type: TType }>["payload"],
): Extract<AgentEvent, { type: TType }> {
  return {
    type,
    meta: {
      schemaVersion: 1,
      eventId: `event-${String(state.lastEventSequence + 1)}-${type}`,
      runId: state.runId,
      turnId: state.turn.turnId,
      sequence: state.lastEventSequence + 1,
      occurredAt: time,
      elapsedMs: state.elapsedMs,
    },
    payload,
  } as Extract<AgentEvent, { type: TType }>;
}

async function createTurn(
  stores: Stores,
  runValue = run(),
): Promise<{ revision: number; state: RunState }> {
  await stores.create(
    { sessionId: "session-1", recordId: "record-session", createdAt: time },
    options,
  );
  const result = await stores.append(
    "session-1",
    1,
    [
      {
        recordId: "record-turn",
        recordType: "turn.started",
        schemaVersion: 1,
        recordedAt: time,
        payload: { run: runValue, config, workspace: workspaceRef },
      },
    ],
    options,
  );
  return { revision: result.revision, state: createInitialRunState(runValue) };
}

async function appendEvent(
  stores: Stores,
  revision: number,
  state: RunState,
  value: AgentEvent,
): Promise<{ revision: number; state: RunState; position: number }> {
  const result = await stores.append(
    "session-1",
    revision,
    [
      {
        recordId: `record-${value.meta.eventId}`,
        recordType: "agent.event",
        schemaVersion: 1,
        recordedAt: value.meta.occurredAt,
        payload: { event: value },
      },
    ],
    options,
  );
  return {
    revision: result.revision,
    state: reduceRunState(state, value),
    position: result.positions[0]!,
  };
}

async function inMemory(): Promise<Stores> {
  const stores = new InMemoryStores();
  resources.push(stores);
  return stores;
}

async function sqlite(): Promise<Stores> {
  const temp = await createTempWorkspace("m4-sqlite-");
  workspaces.push(temp);
  const stores = await SqliteStores.open(temp.resolve("sessions.sqlite"));
  resources.push(stores);
  return stores;
}

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.cleanup()));
});

for (const [name, factory] of [
  ["InMemory", inMemory],
  ["SQLite", sqlite],
] as const) {
  describe(`${name} Store contract`, () => {
    it("create/append/read 支持 revision conflict、批次原子性和 ACK 丢失幂等重试", async () => {
      const stores = await factory();
      const { revision, state } = await createTurn(stores);
      const started = event(state, "run.started", {});
      const draft: SessionRecordDraft = {
        recordId: "record-run-started",
        recordType: "agent.event",
        schemaVersion: 1,
        recordedAt: time,
        payload: { event: started },
      };
      const appended = await stores.append("session-1", revision, [draft], options);
      const retried = await stores.append("session-1", revision, [draft], options);
      expect(retried.positions).toEqual(appended.positions);
      expect(retried.revision).toBe(appended.revision);
      await expect(
        stores.append("session-1", revision, [{ ...draft, recordId: "new" }], options),
      ).rejects.toMatchObject({
        code: "conflict",
      });

      const startedState = reduceRunState(state, started);
      const valid = event(startedState, "model.request_started", {
        requestId: "request-1",
        retryOfRequestId: null,
      });
      const invalid = { ...valid, meta: { ...valid.meta, eventId: "gap", sequence: 3 } };
      await expect(
        stores.append(
          "session-1",
          appended.revision,
          [
            {
              recordId: "batch-valid",
              recordType: "agent.event",
              schemaVersion: 1,
              recordedAt: time,
              payload: { event: valid },
            },
            {
              recordId: "batch-invalid",
              recordType: "agent.event",
              schemaVersion: 1,
              recordedAt: time,
              payload: { event: invalid as AgentEvent },
            },
          ],
          options,
        ),
      ).rejects.toBeInstanceOf(StoreError);
      const page = await stores.read("session-1", 0, 20, options);
      expect(page.records.map((record) => record.recordId)).not.toContain("batch-valid");
    });

    it("checkpoint 拒绝游标倒退并只保留最近三个", async () => {
      const stores = await factory();
      let { revision, state } = await createTurn(stores);
      let position: number;
      const started = event(state, "run.started", {});
      ({ revision, state, position } = await appendEvent(stores, revision, state, started));
      await stores.save(
        checkpointDraft("cp-1", "session-1", position, state, config, workspaceRef, time),
        options,
      );
      for (let index = 2; index <= 4; index += 1) {
        const request = event(state, "model.request_started", {
          requestId: `request-${index}`,
          retryOfRequestId: null,
        });
        ({ revision, state } = await appendEvent(stores, revision, state, request));
        const failed = event(state, "model.request_failed", {
          requestId: `request-${index}`,
          failure: {
            category: "model",
            code: "temporary",
            message: "temporary",
            retryable: true,
            operationId: `request-${index}`,
          },
        });
        ({ revision, state, position } = await appendEvent(stores, revision, state, failed));
        await stores.save(
          checkpointDraft(`cp-${index}`, "session-1", position, state, config, workspaceRef, time),
          options,
        );
      }
      expect(
        (await stores.listCheckpoints(state.runId, options)).map((item) => item.checkpointId),
      ).toEqual(["cp-4", "cp-3", "cp-2"]);
      await expect(
        stores.save(
          checkpointDraft("cp-old", "session-1", 3, state, config, workspaceRef, time),
          options,
        ),
      ).rejects.toMatchObject({ code: "conflict" });
    });
  });
}

describe("M4 Recovery", () => {
  it("ToolStarted 已提交但无结果时先追加一次 tool.outcome_unknown 再 run.failed，绝不重放调用", async () => {
    const stores = await inMemory();
    let { revision, state } = await createTurn(stores, run("unknown"));
    for (const value of [
      () => event(state, "run.started", {}),
      () =>
        event(state, "model.request_started", {
          requestId: "request-tools",
          retryOfRequestId: null,
        }),
      () =>
        event(state, "assistant.message_completed", {
          requestId: "request-tools",
          message: {
            schemaVersion: 1,
            messageId: "assistant-tools",
            role: "assistant",
            content: "",
          },
          toolCalls: [
            {
              schemaVersion: 1,
              callId: "call-edit",
              name: "edit",
              arguments: { mode: "create", path: "created.txt", newText: "x" },
            },
          ],
        }),
      () =>
        event(state, "tool.started", {
          call: {
            schemaVersion: 1,
            callId: "call-edit",
            name: "edit",
            arguments: { mode: "create", path: "created.txt", newText: "x" },
          },
        }),
    ]) {
      const current = value();
      ({ revision, state } = await appendEvent(stores, revision, state, current));
    }
    const recovery = new RecoveryCoordinator({
      sessions: stores,
      checkpoints: stores,
      idFactory: () => "unknown-result",
      now: () => new Date(time),
    });
    const first = await recovery.recover("session-1", options);
    expect(first.action).toBe("side_effect_result_unknown");
    expect(first.state.status).toBe("failed");
    // toolBatch 在结算时写回 transcript，合成结果对模型可见
    expect(first.state.toolBatch).toBeNull();
    const toolResults = first.state.transcript.filter((entry) => entry.kind === "tool_result");
    expect(toolResults).toHaveLength(1);
    const recoveredRecords = await stores.read("session-1", 0, 20, options);
    const reconciled = recoveredRecords.records
      .filter(
        (
          record,
        ): record is Extract<
          (typeof recoveredRecords.records)[number],
          { recordType: "agent.event" }
        > =>
          record.recordType === "agent.event" &&
          (record.payload.event.type === "tool.outcome_unknown" ||
            record.payload.event.type === "run.failed"),
      )
      .map((record) => record.payload.event);
    expect(reconciled.map((item) => item.type)).toEqual(["tool.outcome_unknown", "run.failed"]);
    const synthesizedResult = toolResults[0]!;
    expect(synthesizedResult.kind).toBe("tool_result");
    if (synthesizedResult.kind === "tool_result") {
      expect(synthesizedResult.result.status).toBe("error");
      if (synthesizedResult.result.status === "error") {
        expect(synthesizedResult.result.error.code).toBe("outcome_unknown");
      }
    }
    const second = await recovery.recover("session-1", options);
    expect(second.action).toBe("terminal");
    const records = await stores.read("session-1", 0, 20, options);
    expect(
      records.records.filter(
        (record) =>
          record.recordType === "agent.event" && record.payload.event.type === "run.failed",
      ),
    ).toHaveLength(1);
  });

  it("稳定状态只有在当前环境兼容时才能接回 Runner 并继续到 final", async () => {
    const stores = await inMemory();
    const runValue = run("continue");
    const { revision, state } = await createTurn(stores, runValue);
    await appendEvent(stores, revision, state, event(state, "run.started", {}));
    const recovery = new RecoveryCoordinator({ sessions: stores, checkpoints: stores });

    await expect(recovery.recover("session-1", options)).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      recovery.recover("session-1", options, {
        config,
        workspace: { ...workspaceRef, revision: "changed" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const recovered = await recovery.recover("session-1", options, {
      config,
      workspace: workspaceRef,
    });
    expect(recovered.action).toBe("continue_before_model");

    const model: ModelClientPort = {
      stream(request: Readonly<ModelRequest>): AsyncIterable<ModelEvent> {
        return (async function* () {
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: 1,
            type: "text_delta",
            delta: "恢复完成",
          };
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence: 2,
            type: "completed",
            reason: "final_answer",
          };
        })();
      },
    };
    const tool: ToolExecutorPort = {
      async execute(call: Readonly<ToolCall>): Promise<ToolResult> {
        throw new Error(`不应执行工具 ${call.callId}`);
      },
    };
    const sessionSink = await SessionEventSink.connect(stores, "session-1", options);
    const finalState = await new RuntimeRunner({
      modelClient: model,
      toolExecutor: tool,
      eventSinks: [sessionSink],
    }).continueRecovered(recovered.state, {
      run: runValue,
      baseSystemPrompt: "agent",
      tokenBudget: 10_000,
    });

    expect(finalState.status).toBe("completed");
    const records = await stores.read("session-1", 0, 100, options);
    const eventTypes = records.records
      .filter((record) => record.recordType === "agent.event")
      .map((record) => record.payload.event.type);
    // 恢复继续不能重复生成 run.started。
    expect(eventTypes.filter((type) => type === "run.started")).toHaveLength(1);
    expect(eventTypes.at(-1)).toBe("run.completed");
  });

  it("最新 SQLite checkpoint 损坏时删除坏记录并回退旧 checkpoint 重放 tail", async () => {
    const temp = await createTempWorkspace("m4-corrupt-checkpoint-");
    workspaces.push(temp);
    const databasePath = temp.resolve("sessions.sqlite");
    const stores = await SqliteStores.open(databasePath);
    resources.push(stores);

    let { revision, state } = await createTurn(stores, run("checkpoint-fallback"));
    let position: number;
    ({ revision, state, position } = await appendEvent(
      stores,
      revision,
      state,
      event(state, "run.started", {}),
    ));
    await stores.save(
      checkpointDraft("cp-valid-old", "session-1", position, state, config, workspaceRef, time),
      options,
    );

    ({ revision, state } = await appendEvent(
      stores,
      revision,
      state,
      event(state, "model.request_started", {
        requestId: "request-fallback",
        retryOfRequestId: null,
      }),
    ));
    ({ state, position } = await appendEvent(
      stores,
      revision,
      state,
      event(state, "model.request_failed", {
        requestId: "request-fallback",
        failure: {
          category: "model",
          code: "temporary",
          message: "temporary",
          retryable: true,
          operationId: "request-fallback",
        },
      }),
    ));
    await stores.save(
      checkpointDraft("cp-corrupt-new", "session-1", position, state, config, workspaceRef, time),
      options,
    );
    await stores.close();

    const raw = new DatabaseSync(databasePath);
    raw
      .prepare("UPDATE checkpoints SET checkpoint_json=? WHERE checkpoint_id=?")
      .run("{", "cp-corrupt-new");
    raw.close();

    const reopened = await SqliteStores.open(databasePath);
    resources.push(reopened);
    const recovered = await new RecoveryCoordinator({
      sessions: reopened,
      checkpoints: reopened,
    }).recover("session-1", options, { config, workspace: workspaceRef });

    expect(recovered.checkpointId).toBe("cp-valid-old");
    expect(recovered.action).toBe("continue_before_model");
    expect(
      (await reopened.listCheckpoints("checkpoint-fallback", options)).map(
        (checkpoint) => checkpoint.checkpointId,
      ),
    ).toEqual(["cp-valid-old"]);
  });

  it("active model 中断只追加一次 process_interrupted，然后允许新 requestId 继续", async () => {
    const stores = await inMemory();
    let { revision, state } = await createTurn(stores, run("model-interrupted"));
    for (const create of [
      () => event(state, "run.started", {}),
      () =>
        event(state, "model.request_started", {
          requestId: "request-interrupted",
          retryOfRequestId: null,
        }),
    ]) {
      ({ revision, state } = await appendEvent(stores, revision, state, create()));
    }
    const coordinator = new RecoveryCoordinator({
      sessions: stores,
      checkpoints: stores,
      idFactory: () => "model-interrupted-reconcile",
      now: () => new Date(time),
    });

    const first = await coordinator.recover("session-1", options, {
      config,
      workspace: workspaceRef,
    });
    expect(first.action).toBe("continue_before_model");
    expect(first.reconciledEvent?.type).toBe("model.request_failed");
    expect(first.state.activeModelRequest).toBeNull();

    const second = await coordinator.recover("session-1", options, {
      config,
      workspace: workspaceRef,
    });
    expect(second.reconciledEvent).toBeNull();
    const records = await stores.read("session-1", 0, 100, options);
    expect(
      records.records.filter(
        (record) =>
          record.recordType === "agent.event" &&
          record.payload.event.type === "model.request_failed",
      ),
    ).toHaveLength(1);
  });

  it("只有 pending ToolCall、没有 ToolStarted 时，恢复后首次执行一次并继续到 final", async () => {
    const stores = await inMemory();
    const runValue = run("pending-tool");
    let { revision, state } = await createTurn(stores, runValue);
    for (const create of [
      () => event(state, "run.started", {}),
      () =>
        event(state, "model.request_started", {
          requestId: "request-pending-tool",
          retryOfRequestId: null,
        }),
      () =>
        event(state, "assistant.message_completed", {
          requestId: "request-pending-tool",
          message: {
            schemaVersion: 1,
            messageId: "assistant-pending-tool",
            role: "assistant",
            content: "",
          },
          toolCalls: [
            {
              schemaVersion: 1,
              callId: "call-pending-tool",
              name: "read",
              arguments: { path: "README.md" },
            },
          ],
        }),
    ]) {
      ({ revision, state } = await appendEvent(stores, revision, state, create()));
    }

    const recovered = await new RecoveryCoordinator({
      sessions: stores,
      checkpoints: stores,
    }).recover("session-1", options, { config, workspace: workspaceRef });
    expect(recovered.action).toBe("continue_before_tools");

    let toolCalls = 0;
    const sessionSink = await SessionEventSink.connect(stores, "session-1", options);
    const completed = await new RuntimeRunner({
      modelClient: {
        stream(request): AsyncIterable<ModelEvent> {
          return (async function* () {
            yield {
              schemaVersion: 1,
              requestId: request.requestId,
              sequence: 1,
              type: "text_delta",
              delta: "恢复完成",
            };
            yield {
              schemaVersion: 1,
              requestId: request.requestId,
              sequence: 2,
              type: "completed",
              reason: "final_answer",
            };
          })();
        },
      },
      toolExecutor: {
        async execute(call) {
          toolCalls += 1;
          return {
            schemaVersion: 1,
            callId: call.callId,
            status: "success",
            output: [{ kind: "text", text: "content" }],
            effects: {
              sideEffect: "none",
              changedPaths: [],
              workspaceRevision: null,
              artifactRefs: [],
            },
          };
        },
      },
      eventSinks: [sessionSink],
    }).continueRecovered(recovered.state, {
      run: runValue,
      baseSystemPrompt: "agent",
      tools: [{ name: "read", description: "read", inputSchema: { type: "object" } }],
      tokenBudget: 10_000,
    });

    expect(completed.status).toBe("completed");
    expect(toolCalls).toBe(1);
  });
});
