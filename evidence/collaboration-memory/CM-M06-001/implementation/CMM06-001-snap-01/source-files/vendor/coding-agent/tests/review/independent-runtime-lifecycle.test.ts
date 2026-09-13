import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { appConfigSchema } from "../../src/app/composition/app-config.js";
import { resumeCodingAgent } from "../../src/app/composition/resume-composition.js";
import type { EventSinkPort } from "../../src/core/ports/event_sink/event-sink-port.js";
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
import type { AgentEvent } from "../../src/core/runtime/events/agent-events.js";
import { RuntimeRunner } from "../../src/core/runtime/loop/runtime-runner.js";
import { RecoveryCoordinator } from "../../src/core/runtime/recovery/recovery-coordinator.js";
import { createInitialRunState } from "../../src/core/runtime/state/run-state.js";
import type { Run } from "../../src/core/runtime/state/run-state.js";
import { ProviderRegistry } from "../../src/model/providers/registry/provider-registry.js";
import { InMemoryStores } from "../../src/storage/adapters/in_memory/in-memory-stores.js";
import { SqliteStores } from "../../src/storage/adapters/sqlite/sqlite-stores.js";
import { SessionEventSink } from "../../src/storage/session_event_sink/session-event-sink.js";

const fixedTime = "2026-08-28T00:00:00.000Z";
const storeOptions = { signal: new AbortController().signal };
const digest = "c".repeat(64);
const configSnapshot: RunConfigSnapshot = {
  modelConfigId: "review-model",
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
  policyVersion: "review-policy",
  sandboxProfileVersion: "review-sandbox",
  baseConfigDigest: digest,
};
const originalWorkspace: WorkspaceReference = {
  identity: "review-workspace",
  revision: "revision-before",
  reference: "workspace:review",
};

function reviewRun(suffix: string): Run {
  return {
    schemaVersion: 1,
    runId: `review-run-${suffix}`,
    turn: {
      turnId: `review-turn-${suffix}`,
      userMessage: {
        schemaVersion: 1,
        messageId: `review-user-${suffix}`,
        role: "user",
        content: "独立状态测试",
      },
    },
    createdAt: fixedTime,
  };
}

function success(callId: string, text = "ok"): ToolResult {
  return {
    schemaVersion: 1,
    callId,
    status: "success",
    output: [{ kind: "text", text }],
    effects: {
      sideEffect: "none",
      changedPaths: [],
      workspaceRevision: null,
      artifactRefs: [],
    },
  };
}

function cancelled(callId: string, revision: string | null = null): ToolResult {
  return {
    schemaVersion: 1,
    callId,
    status: "cancelled",
    reason: "review cancellation",
    output: [{ kind: "text", text: "partial-output" }],
    effects: {
      sideEffect: revision ? "confirmed" : "none",
      changedPaths: revision ? ["partial-change.txt"] : [],
      workspaceRevision: revision,
      artifactRefs: [],
    },
  };
}

class CallsThenAnswerModel implements ModelClientPort {
  #requests = 0;

  constructor(private readonly calls: readonly ToolCall[]) {}

  stream(request: Readonly<ModelRequest>): AsyncIterable<ModelEvent> {
    this.#requests += 1;
    if (this.#requests > 1) return this.#answer(request.requestId);
    return this.#calls(request.requestId);
  }

  async *#calls(requestId: string): AsyncIterable<ModelEvent> {
    let sequence = 0;
    for (const [ordinal, call] of this.calls.entries()) {
      yield {
        schemaVersion: 1,
        requestId,
        sequence: (sequence += 1),
        type: "tool_call_started",
        callId: call.callId,
        name: call.name,
        ordinal,
      };
      yield {
        schemaVersion: 1,
        requestId,
        sequence: (sequence += 1),
        type: "tool_arguments_delta",
        callId: call.callId,
        delta: JSON.stringify(call.arguments),
      };
    }
    yield {
      schemaVersion: 1,
      requestId,
      sequence: sequence + 1,
      type: "completed",
      reason: "tool_calls",
    };
  }

  async *#answer(requestId: string): AsyncIterable<ModelEvent> {
    yield {
      schemaVersion: 1,
      requestId,
      sequence: 1,
      type: "text_delta",
      delta: "finished",
    };
    yield {
      schemaVersion: 1,
      requestId,
      sequence: 2,
      type: "completed",
      reason: "final_answer",
    };
  }
}

function runnerInput(run: Run, calls: readonly ToolCall[]) {
  return {
    run,
    baseSystemPrompt: "review-agent",
    tools: [...new Set(calls.map((call) => call.name))].map((name) => ({
      name,
      description: name,
      inputSchema: { type: "object" },
    })),
    tokenBudget: 8_000,
  };
}

function memoryObserver(
  events: AgentEvent[],
  sinkId = "99-review-observer",
): EventSinkPort & { readonly delivery: "best_effort" } {
  return {
    sinkId,
    delivery: "best_effort",
    async publish(event) {
      events.push(structuredClone(event));
    },
  };
}

describe("independent runtime lifecycle review", () => {
  it("fails closed at the exact tool.started barrier without invoking the executor", async () => {
    const call: ToolCall = {
      schemaVersion: 1,
      callId: "review-start-barrier-call",
      name: "edit",
      arguments: { path: "never-created.txt" },
    };
    let executorCalls = 0;
    let sideEffects = 0;
    const tool: ToolExecutorPort = {
      async execute() {
        executorCalls += 1;
        sideEffects += 1;
        return success(call.callId);
      },
    };
    const visibleEvents: AgentEvent[] = [];
    const failingRequired: EventSinkPort = {
      sinkId: "00-review-required",
      delivery: "required",
      async publish(event) {
        if (event.type === "tool.started") throw new Error("injected tool.started sink failure");
      },
    };
    const run = reviewRun("start-barrier");
    const state = await new RuntimeRunner({
      modelClient: new CallsThenAnswerModel([call]),
      toolExecutor: tool,
      eventSinks: [failingRequired, memoryObserver(visibleEvents)],
      eventSinkTimeoutMs: 250,
    }).run(runnerInput(run, [call]));

    expect({ status: state.status, executorCalls, sideEffects }).toEqual({
      status: "failed",
      executorCalls: 0,
      sideEffects: 0,
    });
    expect(visibleEvents.at(-1)?.type).toBe("run.failed");
    expect(
      visibleEvents.some((event) =>
        ["tool.started", "tool.completed", "tool.failed", "tool.cancelled"].includes(event.type),
      ),
    ).toBe(false);
  });

  it("carries a cancelled partial-write revision into the newest usable checkpoint", async () => {
    const stores = new InMemoryStores();
    const run = reviewRun("cancel-revision");
    const sessionId = "review-cancel-revision-session";
    await stores.create(
      { sessionId, recordId: "review-session-record", createdAt: fixedTime },
      storeOptions,
    );
    await stores.append(
      sessionId,
      1,
      [
        {
          recordId: "review-turn-record",
          recordType: "turn.started",
          schemaVersion: 1,
          recordedAt: fixedTime,
          payload: { run, config: configSnapshot, workspace: originalWorkspace },
        },
      ],
      storeOptions,
    );
    const sessionSink = await SessionEventSink.connect(stores, sessionId, storeOptions);
    const checkpointSink = new CheckpointingEventSink(
      createInitialRunState(run),
      stores,
      sessionSink,
      configSnapshot,
      originalWorkspace,
      "90-review-checkpoints",
    );
    const call: ToolCall = {
      schemaVersion: 1,
      callId: "review-cancel-revision-call",
      name: "edit",
      arguments: { path: "partial-change.txt" },
    };
    let enteredResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const tool: ToolExecutorPort = {
      async execute(_call, options) {
        enteredResolve?.();
        if (!options.signal.aborted) {
          await new Promise<void>((resolve) =>
            options.signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        }
        return cancelled(call.callId, "revision-after-partial-change");
      },
    };
    const controller = new AbortController();
    const running = new RuntimeRunner({
      modelClient: new CallsThenAnswerModel([call]),
      toolExecutor: tool,
      eventSinks: [sessionSink, checkpointSink],
    }).run(runnerInput(run, [call]), {
      signal: controller.signal,
      cancellationReason: "user_interrupt",
    });
    await entered;
    controller.abort();
    const state = await running;
    const checkpoints = await stores.listCheckpoints(run.runId, storeOptions);
    const recovered = await new RecoveryCoordinator({
      sessions: stores,
      checkpoints: stores,
    }).recover(sessionId, storeOptions, {
      config: configSnapshot,
      workspace: { ...originalWorkspace, revision: "revision-after-partial-change" },
    });

    expect(state.status).toBe("cancelled");
    expect(checkpoints[0]?.workspace.revision).toBe("revision-after-partial-change");
    expect(recovered.checkpointId).toBe(checkpoints[0]?.checkpointId);
    expect(recovered.action).toBe("terminal");
  });

  it("keeps success, cooperative cancellation, and AbortError outcomes distinct in one group", async () => {
    const calls: ToolCall[] = [
      { schemaVersion: 1, callId: "review-success", name: "read", arguments: { path: "a" } },
      { schemaVersion: 1, callId: "review-cancelled", name: "read", arguments: { path: "b" } },
      { schemaVersion: 1, callId: "review-abort-error", name: "read", arguments: { path: "c" } },
    ];
    let enteredCount = 0;
    let allEnteredResolve: (() => void) | undefined;
    const allEntered = new Promise<void>((resolve) => {
      allEnteredResolve = resolve;
    });
    const tool: ToolExecutorPort = {
      async execute(call, options) {
        enteredCount += 1;
        if (enteredCount === calls.length) allEnteredResolve?.();
        if (call.callId === "review-success") return success(call.callId, "success-output");
        if (!options.signal.aborted) {
          await new Promise<void>((resolve) =>
            options.signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        }
        if (call.callId === "review-cancelled") return cancelled(call.callId);
        const error = new Error("executor aborted without a ToolResult");
        error.name = "AbortError";
        throw error;
      },
    };
    const events: AgentEvent[] = [];
    const controller = new AbortController();
    const run = reviewRun("mixed-parallel");
    const running = new RuntimeRunner({
      modelClient: new CallsThenAnswerModel(calls),
      toolExecutor: tool,
      eventSinks: [memoryObserver(events)],
      toolBatchPolicy: {
        plan(plannedCalls) {
          return [{ mode: "parallel_read_only", callIds: plannedCalls.map((call) => call.callId) }];
        },
      },
      toolDrainTimeoutMs: 200,
      toolEffectClass: () => "read_only",
    }).run(runnerInput(run, calls), {
      signal: controller.signal,
      cancellationReason: "caller_requested",
    });
    await allEntered;
    controller.abort();
    const state = await running;
    const settlement = new Map(
      events
        .filter((event) =>
          ["tool.completed", "tool.cancelled", "tool.outcome_unknown"].includes(event.type),
        )
        .map((event) => ["callId" in event.payload ? event.payload.callId : "", event.type]),
    );

    expect(state.status).toBe("cancelled");
    expect(Object.fromEntries(settlement)).toEqual({
      "review-abort-error": "tool.outcome_unknown",
      "review-success": "tool.completed",
      "review-cancelled": "tool.cancelled",
    });
    const transcriptStatuses = Object.fromEntries(
      state.transcript
        .filter((entry) => entry.kind === "tool_result")
        .map((entry) => [entry.callId, entry.result.status]),
    );
    expect(transcriptStatuses).toEqual({
      "review-success": "success",
      "review-cancelled": "cancelled",
      "review-abort-error": "error",
    });
  });

  it("terminates cancellation within a bounded interval when an executor never settles", async () => {
    const call: ToolCall = {
      schemaVersion: 1,
      callId: "review-hung-call",
      name: "shell",
      arguments: { command: "never" },
    };
    let enteredResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const tool: ToolExecutorPort = {
      execute() {
        enteredResolve?.();
        return new Promise<ToolResult>(() => undefined);
      },
    };
    const events: AgentEvent[] = [];
    const controller = new AbortController();
    const run = reviewRun("hung");
    const startedAt = performance.now();
    const running = new RuntimeRunner({
      modelClient: new CallsThenAnswerModel([call]),
      toolExecutor: tool,
      eventSinks: [memoryObserver(events)],
      toolDrainTimeoutMs: 50,
    }).run(runnerInput(run, [call]), {
      signal: controller.signal,
      cancellationReason: "user_interrupt",
    });
    await entered;
    controller.abort();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const state = await Promise.race([
      running,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("review harness timeout")), 750);
      }),
    ]);
    clearTimeout(timeoutHandle);

    expect(performance.now() - startedAt).toBeLessThan(750);
    expect(state.status).toBe("cancelled");
    expect(events.map((event) => event.type).slice(-2)).toEqual([
      "tool.outcome_unknown",
      "run.cancelled",
    ]);
  });

  it("recovers a started tool across processes exactly once and does not hand the failed turn back to the model", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "review-cross-process-"));
    const databasePath = path.join(tempRoot, "sessions.sqlite");
    const markerPath = path.join(tempRoot, "external-side-effect.txt");
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "fixtures/seed-started-tool.mjs",
    );
    const seeded = spawnSync(process.execPath, [fixturePath, databasePath, markerPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(seeded.status, seeded.stderr).toBe(0);
    expect(await readFile(markerPath, "utf8")).toBe("executed-once");

    const appConfig = appConfigSchema.parse({
      schemaVersion: 1,
      model: {
        provider: "deepseek",
        model: "review-model",
        options: {},
        maxOutputTokens: 64,
      },
      runtime: { tokenBudget: 4_000, maxModelRequests: 4, maxToolCalls: 4 },
      tools: { enabledNames: ["read", "edit"] },
      storage: { databasePath },
      skills: { resourceRoot: path.resolve("resources/skills"), enabledIds: [] },
      memory: { provider: "empty" },
    });
    let modelStreamCalls = 0;
    const modelClient: ModelClientPort = {
      async *stream(request): AsyncIterable<ModelEvent> {
        modelStreamCalls += 1;
        yield {
          schemaVersion: 1,
          requestId: request.requestId,
          sequence: 1,
          type: "text_delta",
          delta: "must-not-run",
        };
        yield {
          schemaVersion: 1,
          requestId: request.requestId,
          sequence: 2,
          type: "completed",
          reason: "final_answer",
        };
      },
    };
    const registry = new ProviderRegistry().register({
      id: "deepseek",
      secretEnvironmentVariable: "DEEPSEEK_API_KEY",
      defaultBaseUrl: "https://invalid.test",
      capabilities: { streaming: true, toolCalls: true, usage: true },
      create: () => modelClient,
    });
    const observerEvents: AgentEvent[] = [];
    const resumeInput = {
      config: appConfig,
      workspaceRoot: tempRoot,
      sessionId: "review-cross-process-session",
      providerRegistry: registry,
      secretSource: { get: () => "review-secret" },
      observerEventSinks: [memoryObserver(observerEvents, "review-production-observer")],
    };
    const first = await resumeCodingAgent(resumeInput);
    const second = await resumeCodingAgent(resumeInput);

    expect(first.action).toBe("side_effect_result_unknown");
    expect(first.state.status).toBe("failed");
    expect(second.action).toBe("terminal");
    expect(modelStreamCalls).toBe(0);
    expect(await readFile(markerPath, "utf8")).toBe("executed-once");
    const calls = first.state.toolBatch?.calls ?? [];
    expect(
      calls.find((item) => item.requestedCall.callId === "review-never-started-call")?.status,
    ).toBe("abandoned");
    const synthesized = first.state.transcript.filter(
      (entry) => entry.kind === "tool_result" && entry.callId === "review-effect-call",
    );
    expect(synthesized).toHaveLength(1);
    if (synthesized[0]?.kind === "tool_result") {
      expect(synthesized[0].result.status).toBe("error");
      if (synthesized[0].result.status === "error") {
        expect(synthesized[0].result.error.code).toBe("outcome_unknown");
      }
    }

    const store = await SqliteStores.open(databasePath);
    const page = await store.read("review-cross-process-session", 0, 100, storeOptions);
    await store.close();
    const recoveredTypes = page.records
      .filter((record) => record.recordType === "agent.event")
      .map((record) => record.payload.event.type);
    expect(recoveredTypes.filter((type) => type === "tool.outcome_unknown")).toHaveLength(1);
    expect(recoveredTypes.filter((type) => type === "run.failed")).toHaveLength(1);

    // 恢复追加的事实必须经统一投递路径到达 observer/Web Projection（P1-3 修复后）。
    const observerTypes = observerEvents.map((event) => event.type);
    expect(observerTypes).toContain("tool.outcome_unknown");
    expect(observerTypes).toContain("run.failed");
    // 第二次恢复是幂等 terminal：不再产生对账事件
    expect(observerEvents.filter((event) => event.type === "tool.outcome_unknown")).toHaveLength(1);
  });
});
