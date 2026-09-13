/**
 * M6 工具状态矩阵测试：cancelled / outcome_unknown / abandoned 的最小语义验证。
 *
 * 覆盖（对应 post-m6-large-repo-roadmap 阶段 1 验收）：
 *  - 正常协作式取消：先持久化 tool.cancelled（真实 ToolResult/输出/effects），再提交 run.cancelled；
 *  - 正常取消不得被标成 result_unknown / outcome_unknown；
 *  - 强制中断（工具抛 AbortError）：tool.outcome_unknown（cancelled_while_running）+ run.cancelled，不重试；
 *  - 进程中断恢复：先追加结构化 tool.outcome_unknown（含合成结果）再 run.failed，幂等且不重放；
 *  - Run 结束时未开始的调用只能 abandoned，已开始的无结果调用兜底 outcome_unknown；
 *  - tool.cancelled 的 required sink 失败必须走 run.failed(required_sink)，不能伪造成功；
 *  - 恢复后的 transcript/模型请求能看见合成 ToolResult。
 */
import { describe, expect, it } from "vitest";

import { DeterministicContextBuilder } from "../../src/core/context/builder/context-builder.js";
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
  ToolExecutorPort,
  ToolResult,
} from "../../src/core/ports/tool_executor/tool-executor-port.js";
import type { AgentEvent } from "../../src/core/runtime/events/agent-events.js";
import { RuntimeRunner } from "../../src/core/runtime/loop/runtime-runner.js";
import { RecoveryCoordinator } from "../../src/core/runtime/recovery/recovery-coordinator.js";
import { reduceRunState } from "../../src/core/runtime/reducer/run-state-reducer.js";
import { CheckpointingEventSink } from "../../src/core/runtime/checkpointing/checkpointing-event-sink.js";
import { createInitialRunState } from "../../src/core/runtime/state/run-state.js";
import type { Run, RunState } from "../../src/core/runtime/state/run-state.js";
import { InMemoryStores } from "../../src/storage/adapters/in_memory/in-memory-stores.js";
import { SessionEventSink } from "../../src/storage/session_event_sink/session-event-sink.js";
import { EventCollector } from "../fakes/event-collector.js";
import { ControllableGate } from "../fakes/controllable-gate.js";
import { createDeterministicIdGenerator } from "../helpers/deterministic-id.js";
import { ManualClock } from "../helpers/manual-clock.js";

const time = "2026-08-20T00:00:00.000Z";
const options = { signal: new AbortController().signal };
const digest = "b".repeat(64);
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
const workspaceRef: WorkspaceReference = {
  identity: "workspace",
  revision: "revision",
  reference: "workspace://test",
};

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

function cancelledResult(
  callId: string,
  reason: string,
  extraOutput: ToolResult["output"] = [],
): ToolResult {
  return {
    schemaVersion: 1,
    callId,
    status: "cancelled",
    reason,
    output: [{ kind: "text", text: "已有部分输出" }, ...extraOutput],
    effects: {
      sideEffect: "possible",
      changedPaths: ["partial.txt"],
      workspaceRevision: "revision-after-partial",
      artifactRefs: [],
    },
  };
}

/** 第一轮发出一个 read 调用，之后每轮直接给出最终回答。 */
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

describe("M6 tool state matrix", () => {
  it("工具执行中正常取消：先持久化 tool.cancelled（真实结果），再提交 run.cancelled，不标 outcome_unknown", async () => {
    const gate = new ControllableGate();
    let toolEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      toolEntered = resolve;
    });
    const tool: ToolExecutorPort = {
      async execute(call, executionOptions) {
        toolEntered?.();
        await gate.wait(executionOptions.signal);
        return cancelledResult(call.callId, "用户取消：web_user_cancelled");
      },
    };
    const collector = new EventCollector();
    const controller = new AbortController();
    const running = new RuntimeRunner({
      modelClient: new ToolThenAnswerModel(),
      toolExecutor: tool,
      eventSinks: [collector],
      clock: new ManualClock(Date.parse(time)),
      idGenerator: createDeterministicIdGenerator("cancel"),
    }).run(input("cancel"), {
      signal: controller.signal,
      cancellationReason: "user_interrupt",
    });
    await entered;
    controller.abort();
    const state = await running;

    expect(state.status).toBe("cancelled");
    expect(state.outcome).toEqual({ kind: "cancelled", reason: "user_interrupt" });

    const events = collector.events;
    const cancelledEvents = collector.eventsOfType("tool.cancelled");
    const startedEvents = collector.eventsOfType("tool.started");
    const runCancelled = collector.eventsOfType("run.cancelled");
    expect(startedEvents).toHaveLength(1);
    expect(cancelledEvents).toHaveLength(1);
    expect(runCancelled).toHaveLength(1);
    // 顺序：tool.started → tool.cancelled → run.cancelled
    const sequenceOf = (event: AgentEvent) => event.meta.sequence;
    expect(sequenceOf(startedEvents[0]!)).toBeLessThan(sequenceOf(cancelledEvents[0]!));
    expect(sequenceOf(cancelledEvents[0]!)).toBeLessThan(sequenceOf(runCancelled[0]!));

    // tool.cancelled 必须携带真实 ToolResult：取消原因、已有输出和 effects
    const persisted = cancelledEvents[0]!.payload;
    expect(persisted.callId).toBe("call-read");
    expect(persisted.result.status).toBe("cancelled");
    expect(persisted.result.reason).toBe("用户取消：web_user_cancelled");
    expect(persisted.result.output).toContainEqual({ kind: "text", text: "已有部分输出" });
    expect(persisted.result.effects).toEqual({
      sideEffect: "possible",
      changedPaths: ["partial.txt"],
      workspaceRevision: "revision-after-partial",
      artifactRefs: [],
    });

    // transcript 保留 cancelled 结果；没有 outcome_unknown / result_unknown
    const toolResults = state.transcript.filter((entry) => entry.kind === "tool_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]!.kind === "tool_result" && toolResults[0]!.result.status).toBe(
      "cancelled",
    );
    expect(collector.eventsOfType("tool.outcome_unknown")).toHaveLength(0);
    expect(state.toolBatch).toBeNull(); // 已结算并写回 transcript
    expect(
      state.transcript.some(
        (entry) =>
          entry.kind === "tool_result" &&
          entry.result.status === "error" &&
          entry.result.error.code === "outcome_unknown",
      ),
    ).toBe(false);
    expect(events.some((event) => event.type === "run.failed")).toBe(false);
  });

  it("工具返回 cancelled 但父级未取消：转为确定的 tool.failed 后 Run 继续，保持原契约", async () => {
    const tool: ToolExecutorPort = {
      async execute(call) {
        return cancelledResult(call.callId, "工具主动放弃");
      },
    };
    const collector = new EventCollector();
    const state = await new RuntimeRunner({
      modelClient: new ToolThenAnswerModel(),
      toolExecutor: tool,
      eventSinks: [collector],
      clock: new ManualClock(Date.parse(time)),
      idGenerator: createDeterministicIdGenerator("self-cancel"),
    }).run(input("self-cancel"));

    // 无父级取消时 cancelled 结果转确定失败，模型下一轮可以继续（原有契约不变）。
    expect(state.status).toBe("completed");
    const failed = collector.eventsOfType("tool.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.payload.phase).toBe("execution");
    expect(failed[0]!.payload.result.status).toBe("error");
    expect(
      failed[0]!.payload.result.status === "error" && failed[0]!.payload.result.error.code,
    ).toBe("execution_failed");
    expect(collector.eventsOfType("tool.cancelled")).toHaveLength(0);
  });

  it("并行只读组整体取消：每个结果先 tool.cancelled，最后只有一个 run.cancelled", async () => {
    const gate = new ControllableGate();
    let active = 0;
    let maxActive = 0;
    let enteredCount = 0;
    let bothEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      bothEntered = resolve;
    });
    const tool: ToolExecutorPort = {
      async execute(call, executionOptions) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        enteredCount += 1;
        if (enteredCount === 2) bothEntered?.();
        await gate.wait(executionOptions.signal);
        active -= 1;
        return cancelledResult(call.callId, "并行取消");
      },
    };
    const model: ModelClientPort = {
      stream(request: Readonly<ModelRequest>): AsyncIterable<ModelEvent> {
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
    const collector = new EventCollector();
    const controller = new AbortController();
    const running = new RuntimeRunner({
      modelClient: model,
      toolExecutor: tool,
      eventSinks: [collector],
      clock: new ManualClock(Date.parse(time)),
      idGenerator: createDeterministicIdGenerator("parallel-cancel"),
      toolBatchPolicy: {
        plan(calls) {
          return [{ mode: "parallel_read_only", callIds: calls.map((call) => call.callId) }];
        },
      },
    }).run(input("parallel-cancel"), {
      signal: controller.signal,
      cancellationReason: "caller_requested",
    });
    await entered;
    controller.abort();
    const state = await running;

    expect(maxActive).toBe(2);
    expect(state.status).toBe("cancelled");
    expect(collector.eventsOfType("tool.cancelled")).toHaveLength(2);
    expect(collector.eventsOfType("run.cancelled")).toHaveLength(1);
    expect(
      collector
        .eventsOfType("tool.cancelled")
        .map((event) => event.payload.callId)
        .sort(),
    ).toEqual(["call-a", "call-b"]);
  });

  it("并行组混合中断：协作取消的调用保留真实 tool.cancelled，只有无结果的调用标 outcome_unknown", async () => {
    // call-a 协作式返回 cancelled（真实结果）；call-b 抛 AbortError（结果未知）。
    // allSettled 协调下，call-a 的结果不得被丢弃，也不得把 call-a 标成 outcome_unknown。
    let enteredCount = 0;
    let bothEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      bothEntered = resolve;
    });
    const tool: ToolExecutorPort = {
      async execute(call, executionOptions) {
        enteredCount += 1;
        if (enteredCount === 2) bothEntered?.();
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            if (call.callId === "call-b") {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            } else {
              resolve();
            }
          };
          if (executionOptions.signal.aborted) onAbort();
          else executionOptions.signal.addEventListener("abort", onAbort, { once: true });
        });
        if (call.callId === "call-b") return cancelledResult(call.callId, "不可达");
        return cancelledResult(call.callId, "call-a 协作取消，已有输出");
      },
    };
    const model: ModelClientPort = {
      stream(request: Readonly<ModelRequest>): AsyncIterable<ModelEvent> {
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
    const collector = new EventCollector();
    const controller = new AbortController();
    const running = new RuntimeRunner({
      modelClient: model,
      toolExecutor: tool,
      eventSinks: [collector],
      clock: new ManualClock(Date.parse(time)),
      idGenerator: createDeterministicIdGenerator("parallel-mixed"),
      toolBatchPolicy: {
        plan(calls) {
          return [{ mode: "parallel_read_only", callIds: calls.map((call) => call.callId) }];
        },
      },
    }).run(input("parallel-mixed"), {
      signal: controller.signal,
      cancellationReason: "user_interrupt",
    });
    await entered;
    controller.abort();
    const state = await running;

    expect(state.status).toBe("cancelled");
    const cancelledEvents = collector.eventsOfType("tool.cancelled");
    expect(cancelledEvents).toHaveLength(1);
    expect(cancelledEvents[0]!.payload.callId).toBe("call-a");
    expect(cancelledEvents[0]!.payload.result.reason).toBe("call-a 协作取消，已有输出");
    const unknownEvents = collector.eventsOfType("tool.outcome_unknown");
    expect(unknownEvents).toHaveLength(1);
    expect(unknownEvents[0]!.payload.callId).toBe("call-b");
    expect(unknownEvents[0]!.payload.reason).toBe("cancelled_while_running");
    expect(collector.eventsOfType("run.cancelled")).toHaveLength(1);
    // transcript 保留 call-a 的真实取消结果与 call-b 的合成结果，二者泾渭分明
    const toolResults = state.transcript.filter((entry) => entry.kind === "tool_result");
    expect(toolResults).toHaveLength(2);
    const callAResult = toolResults.find(
      (entry) => entry.kind === "tool_result" && entry.callId === "call-a",
    );
    const callBResult = toolResults.find(
      (entry) => entry.kind === "tool_result" && entry.callId === "call-b",
    );
    expect(callAResult?.kind === "tool_result" && callAResult.result.status).toBe("cancelled");
    if (callAResult?.kind === "tool_result" && callAResult.result.status === "cancelled") {
      expect(callAResult.result.reason).toBe("call-a 协作取消，已有输出");
    }
    expect(callBResult?.kind === "tool_result" && callBResult.result.status).toBe("error");
    if (callBResult?.kind === "tool_result" && callBResult.result.status === "error") {
      expect(callBResult.result.error.code).toBe("outcome_unknown");
    }
  });

  it("强制中断：工具已 started 但抛 AbortError 时记录 tool.outcome_unknown（cancelled_while_running）再 run.cancelled，且不重试", async () => {
    let toolCalls = 0;
    let toolEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      toolEntered = resolve;
    });
    const tool: ToolExecutorPort = {
      async execute(call, executionOptions) {
        toolCalls += 1;
        toolEntered?.();
        await new Promise<void>((_resolve, reject) => {
          const onAbort = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (executionOptions.signal.aborted) onAbort();
          else executionOptions.signal.addEventListener("abort", onAbort, { once: true });
        });
        return cancelledResult(call.callId, "不可达");
      },
    };
    const collector = new EventCollector();
    const controller = new AbortController();
    const running = new RuntimeRunner({
      modelClient: new ToolThenAnswerModel(),
      toolExecutor: tool,
      eventSinks: [collector],
      clock: new ManualClock(Date.parse(time)),
      idGenerator: createDeterministicIdGenerator("forced"),
      toolEffectClass: (call) => (call.name === "read" ? "read_only" : "process"),
    }).run(input("forced"), {
      signal: controller.signal,
      cancellationReason: "user_interrupt",
    });
    await entered;
    controller.abort();
    const state = await running;

    expect(state.status).toBe("cancelled");
    expect(toolCalls).toBe(1); // 不自动重试
    const unknown = collector.eventsOfType("tool.outcome_unknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.payload.callId).toBe("call-read");
    expect(unknown[0]!.payload.toolName).toBe("read");
    expect(unknown[0]!.payload.effectClass).toBe("read_only");
    expect(unknown[0]!.payload.reason).toBe("cancelled_while_running");
    expect(unknown[0]!.payload.retryPolicy).toBe("never_automatic");
    expect(unknown[0]!.payload.recordedCallEventId).toBe(
      collector.eventsOfType("tool.started")[0]!.meta.eventId,
    );
    const synthesized = unknown[0]!.payload.synthesizedResult;
    expect(synthesized.status).toBe("error");
    expect(synthesized.error.code).toBe("outcome_unknown");
    expect(synthesized.error.retryable).toBe(false);
    expect(
      synthesized.output.some((part) => part.kind === "text" && part.text.includes("不能自动重试")),
    ).toBe(true);
    // 正常取消才允许 tool.cancelled；这里没有任何真实 ToolResult
    expect(collector.eventsOfType("tool.cancelled")).toHaveLength(0);
  });

  it("Run 结束时未开始的调用只能 abandoned，已开始的调用兜底 outcome_unknown（无伪造结果）", () => {
    let state = createInitialRunState(run("abandon"));
    for (const current of [
      () => event(state, "run.started", {}),
      () =>
        event(state, "model.request_started", {
          requestId: "request-abandon",
          retryOfRequestId: null,
        }),
      () =>
        event(state, "assistant.message_completed", {
          requestId: "request-abandon",
          message: {
            schemaVersion: 1,
            messageId: "assistant-abandon",
            role: "assistant",
            content: "",
          },
          toolCalls: [
            {
              schemaVersion: 1,
              callId: "call-started",
              name: "read",
              arguments: { path: "a" },
            },
            {
              schemaVersion: 1,
              callId: "call-pending",
              name: "read",
              arguments: { path: "b" },
            },
          ],
        }),
      () =>
        event(state, "tool.started", {
          call: {
            schemaVersion: 1,
            callId: "call-started",
            name: "read",
            arguments: { path: "a" },
          },
        }),
      () => event(state, "run.cancelled", { reason: "caller_requested" }),
    ]) {
      state = reduceRunState(state, current());
    }

    expect(state.status).toBe("cancelled");
    const calls = state.toolBatch!.calls;
    const started = calls.find((call) => call.requestedCall.callId === "call-started")!;
    const pending = calls.find((call) => call.requestedCall.callId === "call-pending")!;
    expect(started.status).toBe("outcome_unknown");
    expect(started.result).toBeNull(); // 兜底标记不伪造结果
    expect(pending.status).toBe("abandoned");
    expect(pending.result).toBeNull();
  });

  it("进程中断恢复：先追加结构化 tool.outcome_unknown（含合成结果）再 run.failed，幂等且不重放", async () => {
    const stores = new InMemoryStores();
    await stores.create(
      { sessionId: "session-unknown", recordId: "record-session", createdAt: time },
      options,
    );
    const runValue = run("unknown");
    await stores.append(
      "session-unknown",
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
    let state = createInitialRunState(runValue);
    let revision = 2;
    let started: AgentEvent | null = null;
    for (const makeEvent of [
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
      () => {
        const current = event(state, "tool.started", {
          call: {
            schemaVersion: 1,
            callId: "call-edit",
            name: "edit",
            arguments: { mode: "create", path: "created.txt", newText: "x" },
          },
        });
        started = current;
        return current;
      },
    ]) {
      const current = makeEvent();
      const result = await stores.append(
        "session-unknown",
        revision,
        [
          {
            recordId: `agent-event:${current.meta.eventId}`,
            recordType: "agent.event",
            schemaVersion: 1,
            recordedAt: current.meta.occurredAt,
            payload: { event: current },
          },
        ],
        options,
      );
      revision = result.revision;
      state = reduceRunState(state, current);
    }

    const recovery = new RecoveryCoordinator({
      sessions: stores,
      checkpoints: stores,
      idFactory: () => "unknown-result",
      now: () => new Date(time),
      toolEffectClass: (name) => (name === "edit" ? "workspace_write" : "process"),
    });
    const first = await recovery.recover("session-unknown", options);
    expect(first.action).toBe("side_effect_result_unknown");
    expect(first.state.status).toBe("failed");

    const records = await stores.read("session-unknown", 0, 100, options);
    const appended = records.records
      .filter(
        (
          record,
        ): record is Extract<(typeof records.records)[number], { recordType: "agent.event" }> =>
          record.recordType === "agent.event" &&
          (record.payload.event.type === "tool.outcome_unknown" ||
            record.payload.event.type === "run.failed"),
      )
      .map((record) => record.payload.event);
    expect(appended.map((item) => item.type)).toEqual(["tool.outcome_unknown", "run.failed"]);
    const unknown = appended[0]! as Extract<AgentEvent, { type: "tool.outcome_unknown" }>;
    expect(unknown.payload.callId).toBe("call-edit");
    expect(unknown.payload.toolName).toBe("edit");
    expect(unknown.payload.effectClass).toBe("workspace_write");
    expect(unknown.payload.reason).toBe("process_interrupted");
    expect(unknown.payload.retryPolicy).toBe("never_automatic");
    expect(unknown.payload.recordedCallEventId).toBe(started!.meta.eventId);
    expect(unknown.payload.synthesizedResult.status).toBe("error");
    expect(unknown.payload.synthesizedResult.error.code).toBe("outcome_unknown");
    expect(unknown.payload.synthesizedResult.error.retryable).toBe(false);
    expect(
      unknown.payload.synthesizedResult.output.some(
        (part) => part.kind === "text" && part.text.includes("可能已经产生副作用"),
      ),
    ).toBe(true);

    // 终态：合成结果写回 transcript（toolBatch 已在结算时清空）
    expect(first.state.toolBatch).toBeNull();
    const toolResults = first.state.transcript.filter((entry) => entry.kind === "tool_result");
    expect(toolResults).toHaveLength(1);
    const synthesized = toolResults[0]!;
    expect(synthesized.kind).toBe("tool_result");
    if (synthesized.kind === "tool_result") {
      expect(synthesized.result.status).toBe("error");
      if (synthesized.result.status === "error") {
        expect(synthesized.result.error.code).toBe("outcome_unknown");
      }
    }

    // 幂等：第二次恢复不再追加对账事件
    const second = await recovery.recover("session-unknown", options);
    expect(second.action).toBe("terminal");
    const afterSecond = await stores.read("session-unknown", 0, 100, options);
    expect(
      afterSecond.records.filter(
        (record) =>
          record.recordType === "agent.event" &&
          (record.payload.event.type === "tool.outcome_unknown" ||
            record.payload.event.type === "run.failed"),
      ),
    ).toHaveLength(2);
    await stores.close();
  });

  it("多组崩溃恢复：running 调用的合成结果必须冲刷进 transcript，未开始的调用 abandoned", async () => {
    // 同一 assistant message 含两个调用，只有 call-a 已 started（serial 组 1 执行中崩溃，
    // 组 2 的 call-b 尚未开始）。恢复器只结算 running 组后，整批仍未 settled；
    // 终态 Reducer 必须把 call-a 的合成结果写回 transcript，而不是只把 call-b 标 abandoned。
    const stores = new InMemoryStores();
    await stores.create(
      { sessionId: "session-multigroup", recordId: "record-session", createdAt: time },
      options,
    );
    const runValue = run("multigroup");
    await stores.append(
      "session-multigroup",
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
    let state = createInitialRunState(runValue);
    let revision = 2;
    for (const makeEvent of [
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
              callId: "call-a",
              name: "edit",
              arguments: { mode: "create", path: "a.txt", newText: "x" },
            },
            {
              schemaVersion: 1,
              callId: "call-b",
              name: "edit",
              arguments: { mode: "create", path: "b.txt", newText: "y" },
            },
          ],
        }),
      () =>
        event(state, "tool.started", {
          call: {
            schemaVersion: 1,
            callId: "call-a",
            name: "edit",
            arguments: { mode: "create", path: "a.txt", newText: "x" },
          },
        }),
    ]) {
      const current = makeEvent();
      const result = await stores.append(
        "session-multigroup",
        revision,
        [
          {
            recordId: `agent-event:${current.meta.eventId}`,
            recordType: "agent.event",
            schemaVersion: 1,
            recordedAt: current.meta.occurredAt,
            payload: { event: current },
          },
        ],
        options,
      );
      revision = result.revision;
      state = reduceRunState(state, current);
    }
    const recovery = new RecoveryCoordinator({
      sessions: stores,
      checkpoints: stores,
      idFactory: () => "multigroup-result",
      now: () => new Date(time),
    });
    const recovered = await recovery.recover("session-multigroup", options);
    expect(recovered.action).toBe("side_effect_result_unknown");
    expect(recovered.state.status).toBe("failed");

    // call-a 的合成结果必须在 transcript（终态冲刷），而不是只留在 toolBatch 里
    const toolResults = recovered.state.transcript.filter((entry) => entry.kind === "tool_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]!.kind === "tool_result" && toolResults[0]!.callId).toBe("call-a");
    if (toolResults[0]!.kind === "tool_result") {
      expect(toolResults[0]!.result.status).toBe("error");
      if (toolResults[0]!.result.status === "error") {
        expect(toolResults[0]!.result.error.code).toBe("outcome_unknown");
      }
    }
    // call-a 已结算（outcome_unknown，带合成结果）；call-b 未开始 → abandoned
    const calls = recovered.state.toolBatch!.calls;
    const callA = calls.find((call) => call.requestedCall.callId === "call-a")!;
    const callB = calls.find((call) => call.requestedCall.callId === "call-b")!;
    expect(callA.status).toBe("outcome_unknown");
    expect(callA.result).not.toBeNull();
    expect(callB.status).toBe("abandoned");
    expect(callB.result).toBeNull();
    await stores.close();
  });

  // 边界说明：side_effect_result_unknown 后原 Run 已终态，生产路径（resume-composition）
  // 不会在同一 Turn 再次调用模型。本测试验证的是「合成结果已进入 transcript，且能被
  // Context Projection（ContextBuilder）转换为模型输入」——这是审计视图与未来
  // 下一 Turn/Projection handoff 的事实基础，不是「恢复后自动续跑」的证明。
  it("合成 ToolResult 可从恢复后的 transcript 投影为模型请求（Context Projection 路径就绪）", async () => {
    const stores = new InMemoryStores();
    await stores.create(
      { sessionId: "session-visible", recordId: "record-session", createdAt: time },
      options,
    );
    const runValue = run("visible");
    await stores.append(
      "session-visible",
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
    let state = createInitialRunState(runValue);
    let revision = 2;
    for (const makeEvent of [
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
              callId: "call-shell",
              name: "shell",
              arguments: { command: "make deploy" },
            },
          ],
        }),
      () =>
        event(state, "tool.started", {
          call: {
            schemaVersion: 1,
            callId: "call-shell",
            name: "shell",
            arguments: { command: "make deploy" },
          },
        }),
    ]) {
      const current = makeEvent();
      const result = await stores.append(
        "session-visible",
        revision,
        [
          {
            recordId: `agent-event:${current.meta.eventId}`,
            recordType: "agent.event",
            schemaVersion: 1,
            recordedAt: current.meta.occurredAt,
            payload: { event: current },
          },
        ],
        options,
      );
      revision = result.revision;
      state = reduceRunState(state, current);
    }
    const recovery = new RecoveryCoordinator({
      sessions: stores,
      checkpoints: stores,
      idFactory: () => "visible-result",
      now: () => new Date(time),
    });
    const recovered = await recovery.recover("session-visible", options);
    expect(recovered.state.status).toBe("failed");

    const request = new DeterministicContextBuilder().build({
      requestId: "request-next",
      runId: runValue.runId,
      baseSystemPrompt: "agent",
      additionalInstructions: [],
      transcript: recovered.state.transcript,
      tools: [{ name: "shell", description: "shell", inputSchema: { type: "object" } }],
      skills: [],
      memories: [],
      tokenBudget: 10_000,
      maxOutputTokens: null,
    });
    const toolMessages = request.messages.filter((message) => message.role === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]!.callId).toBe("call-shell");
    expect(toolMessages[0]!.result.status).toBe("error");
    if (toolMessages[0]!.result.status === "error") {
      expect(toolMessages[0]!.result.error.code).toBe("outcome_unknown");
      expect(toolMessages[0]!.result.error.retryable).toBe(false);
    }
    await stores.close();
  });

  it("tool.cancelled 的 required sink 失败：以 run.failed(required_sink) 结束，不能假装取消成功", async () => {
    const gate = new ControllableGate();
    let toolEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      toolEntered = resolve;
    });
    const tool: ToolExecutorPort = {
      async execute(call, executionOptions) {
        toolEntered?.();
        await gate.wait(executionOptions.signal);
        return cancelledResult(call.callId, "取消");
      },
    };
    const healthy = new EventCollector();
    // 只在 tool.cancelled 上失败的 required sink：取消事实未落盘就必须 fail closed
    const scriptedSink = {
      sinkId: "required-cancel-fail",
      delivery: "required" as const,
      async publish(event: Readonly<AgentEvent>): Promise<void> {
        if (event.type === "tool.cancelled") {
          throw new Error("scripted sink failure");
        }
        await healthy.publish(event, options);
      },
    };
    const controller = new AbortController();
    const running = new RuntimeRunner({
      modelClient: new ToolThenAnswerModel(),
      toolExecutor: tool,
      eventSinks: [scriptedSink],
      clock: new ManualClock(Date.parse(time)),
      idGenerator: createDeterministicIdGenerator("sink-fail"),
      eventSinkTimeoutMs: 500,
    }).run(input("sink-fail"), {
      signal: controller.signal,
      cancellationReason: "user_interrupt",
    });
    await entered;
    controller.abort();
    const state = await running;

    expect(state.status).toBe("failed");
    expect(state.outcome?.kind === "failed" && state.outcome.failure.category).toBe(
      "required_sink",
    );
    // run.cancelled 从未提交：取消事实没有落盘就不能声称取消
    expect(healthy.eventsOfType("run.cancelled")).toHaveLength(0);
    expect(healthy.eventsOfType("tool.cancelled")).toHaveLength(0);
  });

  it("tool.started 落盘失败：不得启动工具（执行屏障），Run 以 required_sink 失败", async () => {
    let toolCalls = 0;
    const tool: ToolExecutorPort = {
      async execute(call) {
        toolCalls += 1;
        return cancelledResult(call.callId, "不可达");
      },
    };
    const healthy = new EventCollector();
    const scriptedSink = {
      sinkId: "required-started-fail",
      delivery: "required" as const,
      async publish(event: Readonly<AgentEvent>): Promise<void> {
        if (event.type === "tool.started") {
          throw new Error("scripted started failure");
        }
        await healthy.publish(event, options);
      },
    };
    const state = await new RuntimeRunner({
      modelClient: new ToolThenAnswerModel(),
      toolExecutor: tool,
      eventSinks: [scriptedSink],
      clock: new ManualClock(Date.parse(time)),
      idGenerator: createDeterministicIdGenerator("started-fail"),
      eventSinkTimeoutMs: 500,
    }).run(input("started-fail"));

    expect(state.status).toBe("failed");
    expect(state.outcome?.kind === "failed" && state.outcome.failure.category).toBe(
      "required_sink",
    );
    // 启动事实未落盘 → 工具不得执行，也不得出现任何结算事件
    expect(toolCalls).toBe(0);
    expect(healthy.eventsOfType("tool.started")).toHaveLength(0);
    expect(healthy.eventsOfType("tool.completed")).toHaveLength(0);
    expect(healthy.eventsOfType("tool.failed")).toHaveLength(0);
    expect(healthy.eventsOfType("tool.cancelled")).toHaveLength(0);
    // 已知边界：内存终态来自 RequiredSinkError 的 candidate（Reducer 已归约未落盘的
    // tool.started → running → 兜底 outcome_unknown）；日志层面 tool.started 从未落盘，
    // 恢复重放 run.failed 时该调用仍是 pending → abandoned（事实语义：工具从未开始）。
    expect(state.toolBatch?.calls[0]?.status).toBe("outcome_unknown");
  });

  it("永不返回的工具不阻塞取消：drain 超时后仍能落盘 outcome_unknown 与 run.cancelled", async () => {
    // 工具忽略 AbortSignal 且永不 resolve：有界 drain 保证 Run 能终结。
    let toolEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      toolEntered = resolve;
    });
    const tool: ToolExecutorPort = {
      async execute() {
        toolEntered?.();
        return new Promise<never>(() => undefined);
      },
    };
    const collector = new EventCollector();
    const controller = new AbortController();
    const running = new RuntimeRunner({
      modelClient: new ToolThenAnswerModel(),
      toolExecutor: tool,
      eventSinks: [collector],
      clock: new ManualClock(Date.parse(time)),
      idGenerator: createDeterministicIdGenerator("drain"),
      toolDrainTimeoutMs: 60,
    }).run(input("drain"), {
      signal: controller.signal,
      cancellationReason: "user_interrupt",
    });
    await entered;
    controller.abort();
    const state = await running;

    expect(state.status).toBe("cancelled");
    const unknown = collector.eventsOfType("tool.outcome_unknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.payload.callId).toBe("call-read");
    expect(unknown[0]!.payload.reason).toBe("cancelled_while_running");
    expect(collector.eventsOfType("run.cancelled")).toHaveLength(1);
    expect(collector.eventsOfType("tool.cancelled")).toHaveLength(0);
  });

  it("取消工具的部分写入 revision 进入 checkpoint：恢复不会误判为外部并发修改", async () => {
    const stores = new InMemoryStores();
    const runValue = run("cancel-revision");
    await stores.create(
      { sessionId: "session-cancel-revision", recordId: "record-session", createdAt: time },
      options,
    );
    await stores.append(
      "session-cancel-revision",
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
    const sessionSink = await SessionEventSink.connect(stores, "session-cancel-revision", options);
    const checkpointSink = new CheckpointingEventSink(
      createInitialRunState(runValue),
      stores,
      sessionSink,
      config,
      workspaceRef,
    );
    const gate = new ControllableGate();
    let toolEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      toolEntered = resolve;
    });
    const tool: ToolExecutorPort = {
      async execute(call, executionOptions) {
        toolEntered?.();
        await gate.wait(executionOptions.signal);
        // 取消前已产生部分写入：workspaceRevision 必须随取消结果进入 checkpoint
        return {
          ...cancelledResult(call.callId, "取消但已有部分写入"),
          effects: {
            sideEffect: "possible",
            changedPaths: ["partial.txt"],
            workspaceRevision: "revision-after-cancel",
            artifactRefs: [],
          },
        };
      },
    };
    const controller = new AbortController();
    const running = new RuntimeRunner({
      modelClient: new ToolThenAnswerModel(),
      toolExecutor: tool,
      eventSinks: [checkpointSink, sessionSink],
      clock: new ManualClock(Date.parse(time)),
      idGenerator: createDeterministicIdGenerator("cancel-revision"),
    }).run(
      {
        run: runValue,
        baseSystemPrompt: "agent",
        tools: [{ name: "read", description: "read", inputSchema: { type: "object" } }],
        tokenBudget: 10_000,
      },
      {
        signal: controller.signal,
        cancellationReason: "user_interrupt",
      },
    );
    await entered;
    controller.abort();
    const state = await running;
    expect(state.status).toBe("cancelled");

    const checkpoints = await stores.listCheckpoints(runValue.runId, options);
    expect(checkpoints.length).toBeGreaterThan(0);
    // 最新 checkpoint（run.cancelled 边界）必须携带取消结果的部分写入版本
    expect(checkpoints[0]?.workspace.revision).toBe("revision-after-cancel");
    await stores.close();
  });
});
