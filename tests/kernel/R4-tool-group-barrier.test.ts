/**
 * R4.2 Kernel 工具组安全点公开测试（第一阶段骨架）。
 *
 * 只通过冻结公开入口 `vendor/coding-agent/dist/public-api.js` 使用 RuntimeRunner、
 * HookExecutor/HookRegistry、ToolRegistry/ToolBatchPolicy、SqliteStores、ProviderRegistry、
 * 公共 ToolDefinition 与脚本化模型；不导入 Kernel 私有路径或原测试夹具。
 *
 * 六组断言描述 R4.2 的目标行为：组前 await、串行组间暂停与原 Turn 恢复、并发组排空与
 * 最后一组屏障、required pause sink、cancel/unknown、Hook 与无 callback 旧路径不退化。
 * 骨架阶段显式 unsupported 接缝使前五组在到达新边界时为首红；第六组不提供 callback，
 * 保持旧行为为绿。测试不 seed paused，也不把 callback 未返回当作已暂停。
 *
 * §10.6 返修只强化真实消费者时序：group3 的 entered/release 落在 required result publish
 * 内；group2 恢复时在第二组 before_group 观察原身份；所有可控 Promise 在 finally 释放并
 * 等待 outcome 清理；group5 区分 g5-a cancelled、g5-b outcome_unknown、g5-c 零 started。
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  HookExecutor,
  HookRegistry,
  ProviderRegistry,
  RegistryToolBatchPolicy,
  RuntimeRunner,
  SerialToolBatchPolicy,
  SqliteStores,
  ToolRegistry,
  appConfigSchema,
  runCodingAgent,
  toolSchema as z,
  type AgentEvent,
  type BeforeModelHookPort,
  type BeforeToolHookPort,
  type EventSinkPort,
  type ModelClientPort,
  type ModelEvent,
  type ModelRequest,
  type Run,
  type RunLimits,
  type SessionRecord,
  type ToolBatchPolicy,
  type ToolCall,
  type ToolDefinition,
  type ToolExecutionGroup,
  type ToolExecutorPort,
  type ToolGroupBarrier,
  type ToolGroupBarrierInvocation,
  type ToolResult,
} from "../../vendor/coding-agent/dist/public-api.js";

const SKILL_ROOT = fileURLToPath(new URL("../../vendor/coding-agent/resources/skills", import.meta.url));
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type Outcome<T> =
  | { readonly status: "fulfilled"; readonly value: T }
  | { readonly status: "rejected"; readonly reason: unknown };

function settle<T>(run: Promise<T>): Promise<Outcome<T>> {
  return run.then(
    (value): Outcome<T> => ({ status: "fulfilled", value }),
    (reason): Outcome<T> => ({ status: "rejected", reason }),
  );
}

/** 等待可控信号或 Run 结束，二者先到者决定控制流；不阻塞在不会到达的开关上。 */
function waitFor<T>(outcome: Promise<Outcome<T>>, signal: Promise<void>): Promise<boolean> {
  return Promise.race([outcome.then(() => false), signal.then(() => true)]);
}

/** 仅用于一次性放行开关；resolve 只表达已放行，不承载业务值。 */
function deferred() {
  let settleResolve!: () => void;
  let settleReject!: (reason?: unknown) => void;
  let isSettled = false;
  const promise = new Promise<void>((resolve, reject) => {
    settleResolve = () => resolve();
    settleReject = reject;
  });
  return {
    promise,
    resolve: (_value?: void) => {
      isSettled = true;
      settleResolve();
    },
    reject: (reason?: unknown) => {
      isSettled = true;
      settleReject(reason);
    },
    get settled(): boolean {
      return isSettled;
    },
  };
}

type Gate = ReturnType<typeof deferred>;

/** 断言失败也不能遗留执行：释放所有未释放开关并等待 Run 结果清理。 */
async function releaseAll(gates: readonly Gate[], outcome: Promise<unknown>): Promise<void> {
  for (const gate of gates) if (!gate.settled) gate.resolve(undefined);
  await outcome;
}

type ScriptedReply =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "tools";
      readonly calls: readonly {
        readonly callId: string;
        readonly name: string;
        readonly arguments?: Readonly<Record<string, unknown>>;
      }[];
    };

class ScriptedModel implements ModelClientPort {
  readonly requests: ModelRequest[] = [];
  readonly #replies: ScriptedReply[];

  constructor(replies: readonly ScriptedReply[]) {
    this.#replies = [...replies];
  }

  async *stream(
    request: Readonly<ModelRequest>,
    options: { readonly signal: AbortSignal },
  ): AsyncIterable<ModelEvent> {
    options.signal.throwIfAborted();
    const reply = this.#replies.shift();
    this.requests.push(structuredClone(request));
    if (!reply) throw new Error("ScriptedModel: replies exhausted");
    const base = { schemaVersion: 1 as const, requestId: request.requestId };
    let sequence = 1;
    if (reply.kind === "text") {
      yield { ...base, sequence: sequence++, type: "text_delta", delta: reply.text };
      yield { ...base, sequence, type: "completed", reason: "final_answer" };
      return;
    }
    for (const [ordinal, call] of reply.calls.entries()) {
      yield {
        ...base,
        sequence: sequence++,
        type: "tool_call_started",
        callId: call.callId,
        name: call.name,
        ordinal,
      };
      yield {
        ...base,
        sequence: sequence++,
        type: "tool_arguments_delta",
        callId: call.callId,
        delta: JSON.stringify(call.arguments ?? {}),
      };
    }
    yield { ...base, sequence, type: "completed", reason: "tool_calls" };
  }
}

type ToolHandlerFn = (
  call: ToolCall,
  options: Readonly<{ signal: AbortSignal }>,
) => Promise<ToolResult>;

class ControlledExecutor implements ToolExecutorPort {
  readonly calls: ToolCall[] = [];
  #active = 0;
  #maxActive = 0;
  readonly #handlers: Readonly<Record<string, ToolHandlerFn>>;
  readonly #onEnter: ((call: ToolCall) => void) | undefined;

  constructor(
    handlers: Readonly<Record<string, ToolHandlerFn>>,
    onEnter?: (call: ToolCall) => void,
  ) {
    this.#handlers = handlers;
    this.#onEnter = onEnter;
  }

  get maxConcurrent(): number {
    return this.#maxActive;
  }

  async execute(
    call: Readonly<ToolCall>,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<ToolResult> {
    const snapshot = structuredClone(call) as ToolCall;
    this.calls.push(snapshot);
    this.#active += 1;
    this.#maxActive = Math.max(this.#maxActive, this.#active);
    this.#onEnter?.(snapshot);
    try {
      const handler = this.#handlers[call.name];
      if (!handler) throw new Error(`ControlledExecutor: no handler for ${call.name}`);
      return await handler(snapshot, options);
    } finally {
      this.#active -= 1;
    }
  }
}

class RecordingSink implements EventSinkPort {
  readonly sinkId: string;
  readonly delivery = "required" as const;
  readonly events: AgentEvent[] = [];
  readonly #onEvent: ((event: AgentEvent) => Promise<void> | void) | undefined;

  constructor(sinkId: string, onEvent?: (event: AgentEvent) => Promise<void> | void) {
    this.sinkId = sinkId;
    this.#onEvent = onEvent;
  }

  async publish(event: Readonly<AgentEvent>): Promise<void> {
    this.events.push(event);
    await this.#onEvent?.(event);
  }
}

/** best-effort 观察器：required Session sink 提交后才收到事件，用于不打开第二个 SQLite。 */
class ObserverSink implements EventSinkPort {
  readonly sinkId: string;
  readonly delivery = "best_effort" as const;
  readonly events: AgentEvent[] = [];

  constructor(sinkId: string) {
    this.sinkId = sinkId;
  }

  async publish(event: Readonly<AgentEvent>): Promise<void> {
    this.events.push(event);
  }
}

function successResult(callId: string, text = "ok"): ToolResult {
  return {
    schemaVersion: 1,
    callId,
    status: "success",
    output: [{ kind: "text", text }],
    effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
  };
}

function cancelledResult(callId: string): ToolResult {
  return {
    schemaVersion: 1,
    callId,
    status: "cancelled",
    reason: "fixture aborted",
    output: [],
    effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
  };
}

function baseRun(runId: string, turnId: string): Run {
  return {
    schemaVersion: 1,
    runId,
    turn: {
      turnId,
      userMessage: {
        schemaVersion: 1,
        messageId: `user-${turnId}`,
        role: "user",
        content: "R4.2 fixture input",
      },
    },
    createdAt: "2026-09-26T00:00:00.000Z",
  };
}

function runnerInput(run: Run, toolNames: readonly string[]) {
  return {
    run,
    baseSystemPrompt: "R4.2 kernel tool-group barrier fixture.",
    tools: toolNames.map((name) => ({
      name,
      description: `${name} fixture`,
      inputSchema: { type: "object" },
    })),
    tokenBudget: 20_000,
  };
}

function readOnlyTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} read-only R4.2 fixture`,
    inputSchema: z.object({}).strict(),
    effectClass: "read_only",
    requiredCapabilities: ["workspace_read"],
    defaultTimeoutMs: 1_000,
    outputLimitBytes: 1_024,
    independentReadOnly: true,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: { execute: async (call) => successResult(call.callId) },
  };
}

function serialTool(
  name: string,
  execute: (call: ToolCall) => Promise<ToolResult>,
): ToolDefinition {
  return {
    name,
    description: `${name} serial R4.2 fixture`,
    inputSchema: z.object({}).strict(),
    effectClass: "workspace_write",
    requiredCapabilities: ["workspace_write"],
    defaultTimeoutMs: 1_000,
    outputLimitBytes: 1_024,
    independentReadOnly: false,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: { execute: async (call) => execute(structuredClone(call) as ToolCall) },
  };
}

function limits(maxModelRequests: number): RunLimits {
  return {
    maxModelRequests,
    maxToolCalls: 4,
    maxInputTokens: null,
    maxOutputTokens: null,
    maxTotalTokens: null,
    maxCostUsdMicros: null,
    deadlineMs: null,
  };
}

async function readRecords(databasePath: string, sessionId: string): Promise<SessionRecord[]> {
  const store = await SqliteStores.open(databasePath);
  try {
    const result: SessionRecord[] = [];
    let position = 0;
    for (;;) {
      const page = await store.read(sessionId, position, 256, {
        signal: new AbortController().signal,
      });
      result.push(...page.records);
      position = page.records.at(-1)?.position ?? position;
      if (page.nextPosition === null) return result;
    }
  } finally {
    await store.close();
  }
}

function startedCallIds(records: readonly SessionRecord[]): string[] {
  return records.flatMap((record) =>
    record.recordType === "agent.event" && record.payload.event.type === "tool.started"
      ? [record.payload.event.payload.call.callId]
      : [],
  );
}

describe("R4.2 group 1: group-start await", () => {
  it("keeps the group unstarted while the before_group callback is pending, then continues once", async () => {
    const model = new ScriptedModel([
      { kind: "tools", calls: [{ callId: "g1-a", name: "tool_a" }] },
      { kind: "text", text: "group one done" },
    ]);
    const executor = new ControlledExecutor({ tool_a: async (call) => successResult(call.callId) });
    const sink = new RecordingSink("g1-required");
    const entered = deferred();
    const release = deferred();
    const invocations: ToolGroupBarrierInvocation[] = [];
    const barrier: ToolGroupBarrier = async (invocation) => {
      invocations.push(structuredClone(invocation));
      if (invocation.point === "before_group") {
        entered.resolve(undefined);
        await release.promise;
      }
      return { kind: "continue" };
    };
    const runner = new RuntimeRunner({
      modelClient: model,
      toolExecutor: executor,
      eventSinks: [sink],
      toolGroupBarrier: barrier,
    });
    const outcome = settle(runner.run(runnerInput(baseRun("run-g1", "turn-g1"), ["tool_a"])));
    try {
      if (await waitFor(outcome, entered.promise)) {
        expect(sink.events.filter((event) => event.type === "tool.started")).toHaveLength(0);
        expect(executor.calls).toHaveLength(0);
        release.resolve(undefined);
      }
      const final = await outcome;
      expect(final.status).toBe("fulfilled");
      if (final.status !== "fulfilled") return;
      expect(final.value.status, JSON.stringify(final.value.outcome)).toBe("completed");
      expect(executor.calls.map((call) => call.name)).toEqual(["tool_a"]);
      expect(invocations.map((invocation) => invocation.point)).toEqual([
        "before_group",
        "after_group",
      ]);
    } finally {
      await releaseAll([release], outcome);
    }
  });

  it("still awaits the original before_model Hook ahead of the provider without using it as the group barrier", async () => {
    const model = new ScriptedModel([{ kind: "text", text: "plain answer" }]);
    const entered = deferred();
    const release = deferred();
    const hook: BeforeModelHookPort = {
      hookId: "g1-before-model",
      point: "before_model",
      priority: 0,
      async execute() {
        entered.resolve(undefined);
        await release.promise;
        return { point: "before_model", kind: "continue" };
      },
    };
    const runner = new RuntimeRunner({
      modelClient: model,
      toolExecutor: new ControlledExecutor({}),
      hookExecutor: new HookExecutor(new HookRegistry([hook])),
    });
    const outcome = settle(runner.run(runnerInput(baseRun("run-g1b", "turn-g1b"), [])));
    try {
      expect(await waitFor(outcome, entered.promise)).toBe(true);
      expect(model.requests).toHaveLength(0);
      release.resolve(undefined);
      const final = await outcome;
      expect(final.status).toBe("fulfilled");
      if (final.status === "fulfilled") expect(final.value.status).toBe("completed");
    } finally {
      await releaseAll([release], outcome);
    }
  });
});

async function serialHarness() {
  const root = await mkdtemp(path.join(tmpdir(), "r42-serial-"));
  tempRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const databasePath = path.join(root, "session.sqlite");
  const config = appConfigSchema.parse({
    schemaVersion: 1,
    model: { provider: "deepseek", model: "r42-local", options: {}, maxOutputTokens: 128 },
    runtime: { tokenBudget: 20_000, maxModelRequests: 8, maxToolCalls: 8 },
    tools: { enabledNames: ["tool_a", "tool_b"] },
    storage: { databasePath },
    skills: { resourceRoot: SKILL_ROOT, enabledIds: ["coding-safety"] },
    memory: { provider: "empty" },
  });
  const model = new ScriptedModel([
    {
      kind: "tools",
      calls: [
        { callId: "g2-a", name: "tool_a" },
        { callId: "g2-b", name: "tool_b" },
      ],
    },
    { kind: "text", text: "serial groups complete" },
  ]);
  const providerRegistry = new ProviderRegistry().register({
    id: "deepseek",
    secretEnvironmentVariable: "DEEPSEEK_API_KEY",
    defaultBaseUrl: "https://invalid.test",
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: () => model,
  });
  const sessionId = "g2-session";
  return {
    model,
    databasePath,
    sessionId,
    toolCalls: [] as string[],
    common: {
      config,
      workspaceRoot,
      sessionId,
      providerRegistry,
      secretSource: { get: () => "synthetic-fixture-key" },
    },
  };
}

describe("R4.2 group 2: serial group pause and original-Turn resume", () => {
  it("pauses at the serial boundary, persists run.paused, and resumes only the second group with the original identity", async () => {
    const h = await serialHarness();
    const observer = new ObserverSink("g2-observer");
    const firstStarted = deferred();
    const releaseFirst = deferred();
    let pauseRequested = false;
    const firstBarrier: ToolGroupBarrier = async (invocation) => {
      if (invocation.point === "after_group" && pauseRequested) return { kind: "pause" };
      return { kind: "continue" };
    };
    const tools = (): readonly ToolDefinition[] => [
      serialTool("tool_a", async (call) => {
        h.toolCalls.push(call.name);
        firstStarted.resolve(undefined);
        await releaseFirst.promise;
        return successResult(call.callId);
      }),
      serialTool("tool_b", async (call) => {
        h.toolCalls.push(call.name);
        return successResult(call.callId);
      }),
    ];
    const firstOutcome = settle(
      runCodingAgent({
        ...h.common,
        input: "run two serial fixtures",
        executionIdentity: { runId: "g2-run", turnId: "g2-turn" },
        limits: limits(4),
        additionalTools: tools,
        hostAuthorizedTools: ["tool_a", "tool_b"],
        observerEventSinks: [observer],
        toolGroupBarrier: firstBarrier,
      }),
    );
    try {
      if (await waitFor(firstOutcome, firstStarted.promise)) {
        pauseRequested = true;
        releaseFirst.resolve(undefined);
      }
      const first = await firstOutcome;
      expect(first.status).toBe("fulfilled");
      if (first.status !== "fulfilled") return;
      expect(first.value.state.status, JSON.stringify(first.value.state.outcome)).toBe("paused");
      expect(h.toolCalls).toEqual(["tool_a"]);
      const afterPause = await readRecords(h.databasePath, h.sessionId);
      expect(afterPause.filter((record) => record.recordType === "turn.started")).toHaveLength(1);
      expect(
        afterPause.some(
          (record) =>
            record.recordType === "agent.event" && record.payload.event.type === "run.paused",
        ),
      ).toBe(true);
      expect(startedCallIds(afterPause)).toEqual(["g2-a"]);
    } finally {
      await releaseAll([releaseFirst], firstOutcome);
    }

    // 恢复原 identity：第二组 before_group 实际收到回调，且此时第二组尚无 started/execute。
    const resumeInvocations: ToolGroupBarrierInvocation[] = [];
    const resumeEntered = deferred();
    const releaseResume = deferred();
    const resumeBarrier: ToolGroupBarrier = async (invocation) => {
      resumeInvocations.push(structuredClone(invocation));
      if (invocation.point === "before_group") {
        resumeEntered.resolve(undefined);
        await releaseResume.promise;
      }
      return { kind: "continue" };
    };
    const resumedOutcome = settle(
      runCodingAgent({
        ...h.common,
        input: "run two serial fixtures",
        executionIdentity: { runId: "g2-run", turnId: "g2-turn" },
        limits: limits(4),
        additionalTools: tools,
        hostAuthorizedTools: ["tool_a", "tool_b"],
        observerEventSinks: [observer],
        toolGroupBarrier: resumeBarrier,
      }),
    );
    try {
      if (await waitFor(resumedOutcome, resumeEntered.promise)) {
        const invocation = resumeInvocations.find(
          (candidate) => candidate.point === "before_group",
        );
        expect(invocation?.runId).toBe("g2-run");
        expect(invocation?.turnId).toBe("g2-turn");
        expect(invocation?.callIds).toEqual(["g2-b"]);
        expect(h.toolCalls).toEqual(["tool_a"]);
        expect(
          observer.events.flatMap((event) =>
            event.type === "tool.started" ? [event.payload.call.callId] : [],
          ),
        ).toEqual(["g2-a"]);
        releaseResume.resolve(undefined);
      }
      const resumed = await resumedOutcome;
      expect(
        resumeInvocations.filter(
          (candidate) =>
            candidate.point === "before_group" && candidate.callIds.includes("g2-b"),
        ),
        "identity 恢复丢失 toolGroupBarrier 时不会收到第二组 before_group",
      ).toHaveLength(1);
      expect(resumed.status).toBe("fulfilled");
      if (resumed.status !== "fulfilled") return;
      expect(resumed.value.state.status, JSON.stringify(resumed.value.state.outcome)).toBe(
        "completed",
      );
      expect(h.toolCalls).toEqual(["tool_a", "tool_b"]);
      const afterResume = await readRecords(h.databasePath, h.sessionId);
      expect(afterResume.filter((record) => record.recordType === "turn.started")).toHaveLength(1);
      expect(startedCallIds(afterResume)).toEqual(["g2-a", "g2-b"]);
      expect(
        observer.events.flatMap((event) =>
          event.type === "tool.started" ? [event.payload.call.callId] : [],
        ),
      ).toEqual(["g2-a", "g2-b"]);
    } finally {
      await releaseAll([releaseResume], resumedOutcome);
    }
  });
});

describe("R4.2 group 3: parallel group drain and last-group barrier", () => {
  it("waits for every settled result and required sink before after_group and never calls the next provider while waiting", async () => {
    const model = new ScriptedModel([
      {
        kind: "tools",
        calls: [
          { callId: "g3-a", name: "tool_a" },
          { callId: "g3-b", name: "tool_b" },
        ],
      },
      { kind: "text", text: "parallel group complete" },
    ]);
    const bothEntered = deferred();
    const releaseB = deferred();
    const resultSinkEntered = deferred();
    const releaseResultSink = deferred();
    const afterGroupEntered = deferred();
    const releaseAfterGroup = deferred();
    const barrierInvocations: ToolGroupBarrierInvocation[] = [];
    const entered: string[] = [];
    const executor = new ControlledExecutor(
      {
        tool_a: async (call) => successResult(call.callId),
        tool_b: async (call) => {
          await releaseB.promise;
          return successResult(call.callId);
        },
      },
      (call) => {
        entered.push(call.name);
        if (entered.length === 2) bothEntered.resolve(undefined);
      },
    );
    const registry = new ToolRegistry();
    registry.register(readOnlyTool("tool_a"));
    registry.register(readOnlyTool("tool_b"));
    const policy = new RegistryToolBatchPolicy(registry.freeze(["tool_a", "tool_b"]));
    // entered/release 落在真实 required result publish 内：两个工具已返回但 result sink
    // 未 settled 时，after_group 不可进入，也不可 paused。
    const sink = new RecordingSink("g3-required", async (event) => {
      if (event.type === "tool.completed" && event.payload.callId === "g3-b") {
        resultSinkEntered.resolve(undefined);
        await releaseResultSink.promise;
      }
    });
    const barrier: ToolGroupBarrier = async (invocation) => {
      barrierInvocations.push(structuredClone(invocation));
      if (invocation.point === "before_group") return { kind: "continue" };
      afterGroupEntered.resolve(undefined);
      await releaseAfterGroup.promise;
      return { kind: "pause" };
    };
    const runner = new RuntimeRunner({
      modelClient: model,
      toolExecutor: executor,
      eventSinks: [sink],
      toolBatchPolicy: policy,
      toolGroupBarrier: barrier,
    });
    const outcome = settle(
      runner.run(runnerInput(baseRun("run-g3", "turn-g3"), ["tool_a", "tool_b"])),
    );
    try {
      if (await waitFor(outcome, bothEntered.promise)) {
        expect(executor.maxConcurrent).toBe(2);
        expect(afterGroupEntered.settled).toBe(false);
        releaseB.resolve(undefined);
      }
      // releaseB 后不能只竞速 result sink：错误实现若提前 await/进入 after_group 会卡住，
      // finally 不可达。三路竞速，提前进入 after_group 立即断言失败，再走现有 finally。
      const resultBoundary = await Promise.race([
        resultSinkEntered.promise.then(() => "result_sink" as const),
        afterGroupEntered.promise.then(() => "after_group" as const),
        outcome.then(() => "outcome" as const),
      ]);
      expect(
        resultBoundary,
        "after_group 在 required result sink settled 前被调用",
      ).not.toBe("after_group");
      if (resultBoundary === "result_sink") {
        expect(afterGroupEntered.settled).toBe(false);
        expect(model.requests).toHaveLength(1);
        expect(sink.events.some((event) => event.type === "run.paused")).toBe(false);
        releaseResultSink.resolve(undefined);
      }
      if (await waitFor(outcome, afterGroupEntered.promise)) {
        expect(model.requests).toHaveLength(1);
        expect(sink.events.some((event) => event.type === "run.paused")).toBe(false);
        releaseAfterGroup.resolve(undefined);
      }
      const final = await outcome;
      expect(final.status).toBe("fulfilled");
      if (final.status !== "fulfilled") return;
      expect(final.value.status, JSON.stringify(final.value.outcome)).toBe("paused");
      expect(executor.calls.map((call) => call.name).sort()).toEqual(["tool_a", "tool_b"]);
      expect(barrierInvocations.map((invocation) => invocation.point)).toEqual([
        "before_group",
        "after_group",
      ]);
    } finally {
      await releaseAll(
        [bothEntered, releaseB, resultSinkEntered, releaseResultSink, afterGroupEntered, releaseAfterGroup],
        outcome,
      );
    }
  });
});

describe("R4.2 callback failure after a completed group", () => {
  it(
    "persists an after_group failure against the latest SQLite state without losing completed tools",
    async () => {
      const h = await serialHarness();
      const invocations: ToolGroupBarrierInvocation[] = [];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const barrier: ToolGroupBarrier = async (invocation) => {
        invocations.push(structuredClone(invocation));
        if (invocation.point === "before_group") return { kind: "continue" };
        throw new Error("after-group storage unavailable");
      };
      const outcome = settle(runCodingAgent({
        ...h.common,
        input: "fail the barrier after the first real tool result",
        executionIdentity: { runId: "barrier-failure-run", turnId: "barrier-failure-turn" },
        signal: controller.signal,
        limits: limits(4),
        additionalTools: () => ["tool_a", "tool_b"].map((name) => serialTool(name, async (call) => {
          h.toolCalls.push(call.name);
          return successResult(call.callId);
        })),
        hostAuthorizedTools: ["tool_a", "tool_b"],
        toolGroupBarrier: barrier,
      }));
      try {
        const final = await outcome;
        const records = await readRecords(h.databasePath, h.sessionId);
        const events = records.flatMap((record) => record.recordType === "agent.event"
          ? [record.payload.event] : []);
        expect(invocations.map((invocation) => invocation.point)).toEqual(["before_group", "after_group"]);
        expect(h.toolCalls).toEqual(["tool_a"]);
        expect(h.model.requests).toHaveLength(1);
        expect(startedCallIds(records)).toEqual(["g2-a"]);
        expect(events.filter((event) => event.type === "tool.completed").map((event) => event.payload.callId))
          .toEqual(["g2-a"]);
        expect(events.map((event) => event.meta.sequence)).toEqual(events.map((_, index) => index + 1));
        expect(events.filter((event) => event.type === "run.failed")).toHaveLength(1);
        expect(events.at(-1)?.type).toBe("run.failed");
        expect(events.some((event) => event.type === "run.paused")).toBe(false);
        expect(final.status).toBe("fulfilled");
        if (final.status !== "fulfilled") return;
        expect(final.value.state.status).toBe("failed");
        expect(final.value.state.lastEventSequence).toBe(events.at(-1)?.meta.sequence);
        expect(final.value.state.toolBatch?.calls.find((call) => call.requestedCall.callId === "g2-a")?.status)
          .toBe("completed");
      } finally {
        clearTimeout(timer);
        controller.abort();
        await outcome;
      }
    },
    10_000,
  );
});

describe("R4.2 group 4: required pause sink", () => {
  it("does not resolve paused until the required run.paused sink settles", async () => {
    const model = new ScriptedModel([
      { kind: "tools", calls: [{ callId: "g4-a", name: "tool_a" }] },
    ]);
    const executor = new ControlledExecutor({ tool_a: async (call) => successResult(call.callId) });
    const pauseSinkEntered = deferred();
    const releaseSink = deferred();
    const sink = new RecordingSink("g4-required", async (event) => {
      if (event.type === "run.paused") {
        pauseSinkEntered.resolve(undefined);
        await releaseSink.promise;
      }
    });
    const runner = new RuntimeRunner({
      modelClient: model,
      toolExecutor: executor,
      eventSinks: [sink],
      toolGroupBarrier: async () => ({ kind: "pause" }),
    });
    const outcome = settle(runner.run(runnerInput(baseRun("run-g4", "turn-g4"), ["tool_a"])));
    let runSettled = false;
    void outcome.then(() => {
      runSettled = true;
    });
    try {
      if (await waitFor(outcome, pauseSinkEntered.promise)) {
        expect(runSettled).toBe(false);
        releaseSink.resolve(undefined);
      }
      const final = await outcome;
      expect(final.status).toBe("fulfilled");
      if (final.status !== "fulfilled") return;
      expect(final.value.status, JSON.stringify(final.value.outcome)).toBe("paused");
      expect(executor.calls).toHaveLength(0);
    } finally {
      await releaseAll([releaseSink], outcome);
    }
  });

  it("does not report a successful paused state when the required pause sink rejects", async () => {
    const model = new ScriptedModel([
      { kind: "tools", calls: [{ callId: "g4b-a", name: "tool_a" }] },
    ]);
    const executor = new ControlledExecutor({ tool_a: async (call) => successResult(call.callId) });
    const sink = new RecordingSink("g4b-required", async (event) => {
      if (event.type === "run.paused") throw new Error("required sink rejected run.paused");
    });
    const runner = new RuntimeRunner({
      modelClient: model,
      toolExecutor: executor,
      eventSinks: [sink],
      toolGroupBarrier: async () => ({ kind: "pause" }),
    });
    const outcome = settle(runner.run(runnerInput(baseRun("run-g4b", "turn-g4b"), ["tool_a"])));
    const final = await outcome;
    expect(final.status).toBe("fulfilled");
    if (final.status !== "fulfilled") return;
    expect(final.value.status).not.toBe("paused");
    expect(executor.calls).toHaveLength(0);
    expect(
      sink.events.some((event) => event.type === "run.paused"),
      JSON.stringify(final.value.outcome),
    ).toBe(true);
  });
});

describe("R4.2 group 5: cancellation and unknown tools", () => {
  it("settles g5-a cancelled, records g5-b outcome_unknown, never starts g5-c or after_group, and keeps the 40ms drain", async () => {
    const model = new ScriptedModel([
      {
        kind: "tools",
        calls: [
          { callId: "g5-a", name: "tool_a" },
          { callId: "g5-b", name: "tool_b" },
          { callId: "g5-c", name: "tool_c" },
        ],
      },
      { kind: "text", text: "unreachable" },
    ]);
    const bothEntered = deferred();
    const entered: string[] = [];
    const executor = new ControlledExecutor(
      {
        tool_a: async (call, options) => {
          if (!options.signal.aborted) {
            await new Promise<void>((resolve) => {
              options.signal.addEventListener("abort", () => resolve(), { once: true });
            });
          }
          return options.signal.aborted ? cancelledResult(call.callId) : successResult(call.callId);
        },
        tool_b: async () => new Promise<ToolResult>(() => {}),
        tool_c: async (call) => successResult(call.callId),
      },
      (call) => {
        entered.push(call.name);
        if (entered.length === 2) bothEntered.resolve(undefined);
      },
    );
    const policy: ToolBatchPolicy = {
      plan: (calls): readonly ToolExecutionGroup[] => [
        { mode: "parallel_read_only", callIds: [calls[0]!.callId, calls[1]!.callId] },
        { mode: "serial", callIds: [calls[2]!.callId] },
      ],
    };
    const sink = new RecordingSink("g5-required");
    const barrierInvocations: ToolGroupBarrierInvocation[] = [];
    const controller = new AbortController();
    const barrier: ToolGroupBarrier = async (invocation) => {
      barrierInvocations.push(structuredClone(invocation));
      return invocation.point === "after_group" ? { kind: "pause" } : { kind: "continue" };
    };
    const runner = new RuntimeRunner({
      modelClient: model,
      toolExecutor: executor,
      eventSinks: [sink],
      toolBatchPolicy: policy,
      toolDrainTimeoutMs: 40,
      toolGroupBarrier: barrier,
    });
    const outcome = settle(
      runner.run(runnerInput(baseRun("run-g5", "turn-g5"), ["tool_a", "tool_b", "tool_c"]), {
        signal: controller.signal,
      }),
    );
    try {
      if (await waitFor(outcome, bothEntered.promise)) controller.abort();
      const final = await outcome;
      expect(final.status).toBe("fulfilled");
      if (final.status !== "fulfilled") return;
      expect(final.value.status, JSON.stringify(final.value.outcome)).toBe("cancelled");
      expect(executor.calls.map((call) => call.name).sort()).toEqual(["tool_a", "tool_b"]);
      const cancelledCallIds = sink.events.flatMap((event) =>
        event.type === "tool.cancelled" ? [event.payload.callId] : [],
      );
      expect(cancelledCallIds).toEqual(["g5-a"]);
      const unknown = sink.events.flatMap((event) =>
        event.type === "tool.outcome_unknown" ? [event.payload] : [],
      );
      expect(unknown.map((payload) => payload.callId)).toEqual(["g5-b"]);
      expect(unknown[0]?.reason).toBe("cancelled_while_running");
      expect(
        sink.events.flatMap((event) =>
          event.type === "tool.started" ? [event.payload.call.callId] : [],
        ),
      ).toEqual(["g5-a", "g5-b"]);
      expect(barrierInvocations.filter((invocation) => invocation.point === "before_group")).toHaveLength(1);
      expect(barrierInvocations.filter((invocation) => invocation.point === "after_group")).toHaveLength(0);
      expect(sink.events.some((event) => event.type === "run.paused")).toBe(false);
    } finally {
      if (!controller.signal.aborted) controller.abort();
      await outcome;
    }
  });
});

describe("R4.2 group 6: Hook and no-callback paths stay unchanged", () => {
  it("keeps before_tool.block as one paired hook_blocked tool error without executing the tool", async () => {
    const model = new ScriptedModel([
      { kind: "tools", calls: [{ callId: "g6-a", name: "tool_a" }] },
      { kind: "text", text: "block observed" },
    ]);
    const executor = new ControlledExecutor({ tool_a: async (call) => successResult(call.callId) });
    const sink = new RecordingSink("g6-required");
    const hook: BeforeToolHookPort = {
      hookId: "g6-block",
      point: "before_tool",
      priority: 0,
      async execute() {
        return { point: "before_tool", kind: "block", reason: "fixture blocks this tool" };
      },
    };
    const runner = new RuntimeRunner({
      modelClient: model,
      toolExecutor: executor,
      eventSinks: [sink],
      hookExecutor: new HookExecutor(new HookRegistry([hook])),
    });
    const state = await runner.run(runnerInput(baseRun("run-g6", "turn-g6"), ["tool_a"]));
    expect(state.status).toBe("completed");
    expect(executor.calls).toHaveLength(0);
    const failures = sink.events.filter((event) => event.type === "tool.failed");
    expect(failures).toHaveLength(1);
    const failure = failures[0]!;
    if (failure.type === "tool.failed") {
      expect(failure.payload.phase).toBe("pre_execution");
      expect(failure.payload.result.status).toBe("error");
      if (failure.payload.result.status === "error") {
        expect(failure.payload.result.error.code).toBe("hook_blocked");
      }
    }
  });

  it("runs the normal serial path without any callback", async () => {
    const model = new ScriptedModel([
      {
        kind: "tools",
        calls: [
          { callId: "g6b-a", name: "tool_a" },
          { callId: "g6b-b", name: "tool_b" },
        ],
      },
      { kind: "text", text: "serial complete" },
    ]);
    const executor = new ControlledExecutor({
      tool_a: async (call) => successResult(call.callId),
      tool_b: async (call) => successResult(call.callId),
    });
    const runner = new RuntimeRunner({
      modelClient: model,
      toolExecutor: executor,
      toolBatchPolicy: new SerialToolBatchPolicy(),
    });
    const state = await runner.run(
      runnerInput(baseRun("run-g6b", "turn-g6b"), ["tool_a", "tool_b"]),
    );
    expect(state.status).toBe("completed");
    expect(executor.calls.map((call) => call.name)).toEqual(["tool_a", "tool_b"]);
  });

  it("does not remove before_tool.modify rescheduling", async () => {
    const model = new ScriptedModel([
      { kind: "tools", calls: [{ callId: "g6c-a", name: "tool_a", arguments: { path: "original" } }] },
      { kind: "text", text: "modified" },
    ]);
    const executor = new ControlledExecutor({ tool_a: async (call) => successResult(call.callId) });
    const hook: BeforeToolHookPort = {
      hookId: "g6-modify",
      point: "before_tool",
      priority: 0,
      async execute(invocation) {
        return {
          point: "before_tool",
          kind: "modify",
          value: { ...invocation.call, arguments: { path: "modified" } },
        };
      },
    };
    const runner = new RuntimeRunner({
      modelClient: model,
      toolExecutor: executor,
      hookExecutor: new HookExecutor(new HookRegistry([hook])),
    });
    const state = await runner.run(runnerInput(baseRun("run-g6c", "turn-g6c"), ["tool_a"]));
    expect(state.status).toBe("completed");
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]?.arguments).toEqual({ path: "modified" });
  });
});
