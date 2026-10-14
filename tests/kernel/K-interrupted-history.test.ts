/**
 * Group K KE2: the public run entry over a Session whose earlier Turn was
 * interrupted by a platform closure.
 *
 * Entry: the public `runCodingAgent` with a scripted model. The Session cursor
 * positions come from the public `readTurnBounds`, never from a raw DB read.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appConfigSchema,
  closeOpenTurn,
  ProviderRegistry,
  readTurnBounds,
  runCodingAgent,
  SqliteStores,
  toolSchema as z,
  type ModelClientPort,
  type ModelEvent,
  type ModelRequest,
  type BeforeModelHookPort,
  type BeforeToolHookPort,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
} from "../../vendor/coding-agent/dist/public-api.js";
import {
  K_AT_LATER,
  KernelSessionFixture,
  openTempKernelStore,
  type TempKernelStore,
} from "../helpers/K-session-support.js";

const SKILL_ROOT = fileURLToPath(new URL("../../vendor/coding-agent/resources/skills", import.meta.url));
const opened: TempKernelStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map((item) => item.cleanup()));
});

type ScriptedReply =
  | string
  | { readonly calls: readonly { readonly callId: string; readonly name: string }[] };

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
    if (reply === undefined) throw new Error("K ScriptedModel: replies exhausted");
    const base = { schemaVersion: 1 as const, requestId: request.requestId };
    if (typeof reply === "string") {
      yield { ...base, sequence: 1, type: "text_delta", delta: reply };
      yield { ...base, sequence: 2, type: "completed", reason: "final_answer" };
      return;
    }
    let sequence = 1;
    for (const [ordinal, call] of reply.calls.entries()) {
      yield {
        ...base,
        sequence: sequence++,
        type: "tool_call_started",
        callId: call.callId,
        name: call.name,
        ordinal,
      };
      yield { ...base, sequence: sequence++, type: "tool_arguments_delta", callId: call.callId, delta: "{}" };
    }
    yield { ...base, sequence, type: "completed", reason: "tool_calls" };
  }
}

function pauseBeforeModel(hookId: string): BeforeModelHookPort {
  return {
    hookId,
    point: "before_model",
    priority: 0,
    async execute() {
      return { point: "before_model", kind: "pause", reason: `${hookId} pause` };
    },
  };
}

function pauseBeforeTool(hookId: string): BeforeToolHookPort {
  return {
    hookId,
    point: "before_tool",
    priority: 0,
    async execute() {
      return { point: "before_tool", kind: "pause", reason: `${hookId} pause` };
    },
  };
}

/** KA-06 fixture tool: its handler must never run while replaying an interrupted Turn. */
function probeTool(onExecute: () => void): ToolDefinition {
  return {
    name: "ka06-probe",
    description: "KA-06 replay fixture; executing this would prove the interrupted Turn re-ran",
    inputSchema: z.object({}).strict(),
    effectClass: "workspace_write",
    requiredCapabilities: ["workspace_write"],
    defaultTimeoutMs: 1_000,
    outputLimitBytes: 1_024,
    independentReadOnly: false,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: {
      execute: async (call: ToolCall): Promise<ToolResult> => {
        onExecute();
        return {
          schemaVersion: 1,
          callId: call.callId,
          status: "success",
          output: [],
          effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
        };
      },
    },
  };
}

async function historyHarness(replies: readonly ScriptedReply[], enabledTools: readonly string[] = []) {
  const temp = await openTempKernelStore("k-history-");
  opened.push(temp);
  const workspaceRoot = path.join(temp.root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const config = appConfigSchema.parse({
    schemaVersion: 1,
    model: { provider: "deepseek", model: "k-local", options: {}, maxOutputTokens: 128 },
    runtime: { tokenBudget: 20_000, maxModelRequests: 6, maxToolCalls: 6 },
    tools: { enabledNames: ["read", ...enabledTools] },
    storage: { databasePath: temp.databasePath },
    skills: { resourceRoot: SKILL_ROOT, enabledIds: ["coding-safety"] },
    memory: { provider: "empty" },
  });
  const model = new ScriptedModel(replies);
  const providerRegistry = new ProviderRegistry().register({
    id: "deepseek",
    secretEnvironmentVariable: "DEEPSEEK_API_KEY",
    defaultBaseUrl: "https://invalid.test",
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: () => model,
  });
  const sessionId = "k-history-session";
  return {
    temp,
    sessionId,
    model,
    common: {
      config,
      workspaceRoot,
      sessionId,
      providerRegistry,
      secretSource: { get: () => "synthetic-fixture-key" },
    },
  };
}

function userContents(request: ModelRequest): string[] {
  return request.messages.filter((message) => message.role === "user").map((message) => message.content);
}

type HistoryHarness = Awaited<ReturnType<typeof historyHarness>>;

async function closeTurn(h: HistoryHarness, kernelRunId: string): Promise<void> {
  const header = await h.temp.store.get(h.sessionId, { signal: new AbortController().signal });
  const result = await closeOpenTurn(h.temp.store, {
    sessionId: h.sessionId,
    kernelRunId,
    expectedRevision: header.revision,
    at: K_AT_LATER,
  });
  if (result.status !== "closed") throw new Error(`K fixture: close ${kernelRunId} -> ${result.status}`);
}

describe("K interrupted history (KE2)", () => {
  it("KA-04 refuses a new Turn while the Kernel Turn is open, and after closure continues the same Session: the pre-close cursor and the cursor past the closure both keep the completed Turns in order and never show the interrupted step", async () => {
    const h = await historyHarness(["answer-A", "answer-C", "answer-D"]);
    const store = h.temp.store;

    const a = await runCodingAgent({
      ...h.common,
      input: "question-A",
      executionIdentity: { runId: "run-A", turnId: "turn-A" },
    });
    expect(a.state.status).toBe("completed");

    const boundsA = await readTurnBounds(store, { sessionId: h.sessionId, kernelRunId: "run-A" });
    expect(boundsA.status).toBe("found");
    if (boundsA.status !== "found" || boundsA.endPosition === null) throw new Error("K fixture: no A boundary");
    const boundaryA = boundsA.endPosition;

    const b = await runCodingAgent({
      ...h.common,
      input: "question-B",
      executionIdentity: { runId: "run-B", turnId: "turn-B" },
      controlHooks: [pauseBeforeModel("k-history-pause")],
    });
    expect(b.state.status).toBe("paused");
    expect(h.model.requests).toHaveLength(1);

    // Before the closure a new Turn in the same Session is refused.
    await expect(
      runCodingAgent({
        ...h.common,
        input: "question-C0",
        executionIdentity: { runId: "run-C0", turnId: "turn-C0" },
        sessionContext: { version: 1, mode: "session_history", throughPosition: boundaryA },
      }),
    ).rejects.toThrow();
    expect(h.model.requests).toHaveLength(1);

    await closeTurn(h, "run-B");
    const boundsB = await readTurnBounds(store, { sessionId: h.sessionId, kernelRunId: "run-B" });
    expect(boundsB).toMatchObject({ status: "found", terminalStatus: "interrupted" });
    if (boundsB.status !== "found" || boundsB.endPosition === null) throw new Error("K fixture: no B boundary");

    // Second round: the platform cursor is still the boundary before the interrupted step.
    const c = await runCodingAgent({
      ...h.common,
      input: "question-C",
      executionIdentity: { runId: "run-C", turnId: "turn-C" },
      sessionContext: { version: 1, mode: "session_history", throughPosition: boundaryA },
    });
    expect(c.state.status).toBe("completed");
    expect(userContents(h.model.requests.at(-1)!)).toEqual(["question-A", "question-C"]);

    const boundsC = await readTurnBounds(store, { sessionId: h.sessionId, kernelRunId: "run-C" });
    if (boundsC.status !== "found" || boundsC.endPosition === null) throw new Error("K fixture: no C boundary");

    // Third round: the cursor is past the closure record, so the prefix contains
    // the interrupted Turn and must skip its content while keeping A and C.
    const d = await runCodingAgent({
      ...h.common,
      input: "question-D",
      executionIdentity: { runId: "run-D", turnId: "turn-D" },
      sessionContext: { version: 1, mode: "session_history", throughPosition: boundsC.endPosition },
    });
    expect(d.state.status).toBe("completed");
    const dRequest = h.model.requests.at(-1)!;
    expect(userContents(dRequest)).toEqual(["question-A", "question-C", "question-D"]);
    expect(JSON.stringify(dRequest.messages)).not.toContain("question-B");

    // §9 M7: the `run.interrupted` record itself is asserted only in KA-01 (KE1);
    // this KE2 case only pins the model inputs and the call count.
    expect(h.model.requests).toHaveLength(3);
  });

  it("KA-05 keeps the boundaries right when the first Turn, two consecutive Turns, or an interleaved Turn are interrupted, and still refuses a non-interrupted terminal with an unknown tool result, a boundary that is not a completed boundary, and an identity overlap with a skipped Turn", async () => {
    // (a) The very first Turn is interrupted: turns is not empty, the transcript
    // prefix is empty and the new Turn only sees its own input.
    const first = await historyHarness(["answer-C"]);
    await runCodingAgent({
      ...first.common,
      input: "question-B",
      executionIdentity: { runId: "run-B", turnId: "turn-B" },
      controlHooks: [pauseBeforeModel("k-first-pause")],
    });
    await closeTurn(first, "run-B");
    const firstBounds = await readTurnBounds(first.temp.store, { sessionId: first.sessionId, kernelRunId: "run-B" });
    if (firstBounds.status !== "found" || firstBounds.endPosition === null) throw new Error("K fixture: no first boundary");
    const firstContinuation = await runCodingAgent({
      ...first.common,
      input: "question-C",
      executionIdentity: { runId: "run-C", turnId: "turn-C" },
      sessionContext: { version: 1, mode: "session_history", throughPosition: firstBounds.endPosition },
    });
    expect(firstContinuation.state.status).toBe("completed");
    expect(userContents(first.model.requests.at(-1)!)).toEqual(["question-C"]);

    // (b) Two consecutive interrupted Turns keep their boundaries and contribute
    // no model content.
    const consecutive = await historyHarness(["answer-C"]);
    for (const id of ["B1", "B2"]) {
      await runCodingAgent({
        ...consecutive.common,
        input: `question-${id}`,
        executionIdentity: { runId: `run-${id}`, turnId: `turn-${id}` },
        controlHooks: [pauseBeforeModel(`k-consecutive-${id}`)],
      });
      await closeTurn(consecutive, `run-${id}`);
    }
    const secondBounds = await readTurnBounds(consecutive.temp.store, { sessionId: consecutive.sessionId, kernelRunId: "run-B2" });
    if (secondBounds.status !== "found" || secondBounds.endPosition === null) throw new Error("K fixture: no second boundary");
    await runCodingAgent({
      ...consecutive.common,
      input: "question-C",
      executionIdentity: { runId: "run-C", turnId: "run-C" },
      sessionContext: { version: 1, mode: "session_history", throughPosition: secondBounds.endPosition },
    });
    expect(userContents(consecutive.model.requests.at(-1)!)).toEqual(["question-C"]);

    // (c) completed -> interrupted -> completed -> interrupted: the cursor sits
    // exactly on the last closure event and the skipped Turns are invisible.
    const interleaved = await historyHarness(["answer-A", "answer-C", "answer-E"]);
    await runCodingAgent({
      ...interleaved.common,
      input: "question-A",
      executionIdentity: { runId: "run-A", turnId: "turn-A" },
    });
    await runCodingAgent({
      ...interleaved.common,
      input: "question-B",
      executionIdentity: { runId: "run-B", turnId: "turn-B" },
      controlHooks: [pauseBeforeModel("k-interleaved-B")],
    });
    await closeTurn(interleaved, "run-B");
    await runCodingAgent({
      ...interleaved.common,
      input: "question-C",
      executionIdentity: { runId: "run-C", turnId: "turn-C" },
    });
    await runCodingAgent({
      ...interleaved.common,
      input: "question-D",
      executionIdentity: { runId: "run-D", turnId: "turn-D" },
      controlHooks: [pauseBeforeModel("k-interleaved-D")],
    });
    await closeTurn(interleaved, "run-D");
    const dBounds = await readTurnBounds(interleaved.temp.store, { sessionId: interleaved.sessionId, kernelRunId: "run-D" });
    if (dBounds.status !== "found" || dBounds.endPosition === null) throw new Error("K fixture: no D boundary");
    const last = await runCodingAgent({
      ...interleaved.common,
      input: "question-E",
      executionIdentity: { runId: "run-E", turnId: "run-E" },
      sessionContext: { version: 1, mode: "session_history", throughPosition: dBounds.endPosition },
    });
    expect(last.state.status).toBe("completed");
    expect(userContents(interleaved.model.requests.at(-1)!)).toEqual(["question-A", "question-C", "question-E"]);

    // Refusal 1: a non-interrupted terminal carrying an unknown tool result is
    // not released, exactly as before.
    const unknown = await historyHarness([]);
    const unknownFixture = await KernelSessionFixture.create(unknown.temp.store, unknown.sessionId);
    await unknownFixture.startTurn({ runId: "run-unknown", turnId: "turn-unknown", input: "question-unknown" });
    await unknownFixture.event("run.started", {});
    await unknownFixture.event("model.request_started", { requestId: "req-unknown", retryOfRequestId: null });
    await unknownFixture.event("assistant.message_completed", {
      requestId: "req-unknown",
      message: { schemaVersion: 1, messageId: "msg-unknown", role: "assistant", content: "calling" },
      toolCalls: [{ schemaVersion: 1, callId: "call-unknown", name: "read", arguments: {} }],
    });
    await unknownFixture.event("tool.started", {
      call: { schemaVersion: 1, callId: "call-unknown", name: "read", arguments: {} },
    });
    await unknownFixture.event("tool.outcome_unknown", {
      callId: "call-unknown",
      toolName: "read",
      effectClass: "workspace_write",
      reason: "process_interrupted",
      retryPolicy: "never_automatic",
      recordedCallEventId: "evt-turn-unknown-4",
      synthesizedResult: {
        status: "error",
        error: { code: "outcome_unknown", message: "side effect unknown", retryable: false },
        schemaVersion: 1,
        callId: "call-unknown",
        output: [],
        effects: { sideEffect: "possible", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
      },
    });
    await unknownFixture.event("run.cancelled", { reason: "caller_requested" });
    const unknownBounds = await readTurnBounds(unknown.temp.store, { sessionId: unknown.sessionId, kernelRunId: "run-unknown" });
    expect(unknownBounds).toMatchObject({ status: "found", terminalStatus: "cancelled" });
    if (unknownBounds.status !== "found" || unknownBounds.endPosition === null) throw new Error("K fixture: no unknown boundary");
    await expect(
      runCodingAgent({
        ...unknown.common,
        input: "question-after-unknown",
        executionIdentity: { runId: "run-after-unknown", turnId: "turn-after-unknown" },
        sessionContext: { version: 1, mode: "session_history", throughPosition: unknownBounds.endPosition },
      }),
    ).rejects.toThrow(/outcome_unknown/);
    expect(unknown.model.requests).toHaveLength(0);

    // Refusal 2: a boundary that is not a completed-turn boundary (here inside a
    // terminated Turn, just after run.started) is still refused.
    const inside = await historyHarness(["answer-A"]);
    await runCodingAgent({
      ...inside.common,
      input: "question-A",
      executionIdentity: { runId: "run-A", turnId: "turn-A" },
    });
    const aBounds = await readTurnBounds(inside.temp.store, { sessionId: inside.sessionId, kernelRunId: "run-A" });
    if (aBounds.status !== "found") throw new Error("K fixture: no A bounds");
    await expect(
      runCodingAgent({
        ...inside.common,
        input: "question-inside",
        executionIdentity: { runId: "run-inside", turnId: "turn-inside" },
        sessionContext: { version: 1, mode: "session_history", throughPosition: aBounds.startPosition + 1 },
      }),
    ).rejects.toThrow(/不是已完成轮次的稳定边界/);
    expect(inside.model.requests).toHaveLength(1);

    // Refusal 3: a fresh run id that reuses the interrupted Turn's turnId
    // overlaps the skipped Turn's identity in the restored prefix, with the
    // cursor exactly at that Turn's closure, and is still refused.
    const overlap = await historyHarness(["answer-C"]);
    await runCodingAgent({
      ...overlap.common,
      input: "question-B",
      executionIdentity: { runId: "run-B", turnId: "turn-B" },
      controlHooks: [pauseBeforeModel("k-overlap-B")],
    });
    await closeTurn(overlap, "run-B");
    const overlapBounds = await readTurnBounds(overlap.temp.store, { sessionId: overlap.sessionId, kernelRunId: "run-B" });
    if (overlapBounds.status !== "found" || overlapBounds.endPosition === null) throw new Error("K fixture: no overlap boundary");
    await expect(
      runCodingAgent({
        ...overlap.common,
        input: "question-B2",
        executionIdentity: { runId: "run-B2", turnId: "turn-B" },
        sessionContext: { version: 1, mode: "session_history", throughPosition: overlapBounds.endPosition },
      }),
    ).rejects.toThrow(/历史前缀包含当前 Turn/);
    expect(overlap.model.requests).toHaveLength(0);
  });

  it("KA-05 drops the interrupted Turn's assistant message and tool process, not only its user message, when the restored prefix runs past the closure", async () => {
    const h = await historyHarness(["answer-C"]);
    const store = h.temp.store;
    const fixture = await KernelSessionFixture.create(store, h.sessionId);
    // A completed Turn whose transcript must survive.
    await fixture.startTurn({ runId: "run-A", turnId: "turn-A", input: "question-A" });
    await fixture.event("run.started", {});
    await fixture.event("model.request_started", { requestId: "req-A", retryOfRequestId: null });
    await fixture.event("assistant.message_completed", {
      requestId: "req-A",
      message: { schemaVersion: 1, messageId: "msg-A", role: "assistant", content: "answer-A" },
      toolCalls: [],
    });
    await fixture.event("run.completed", { finalMessageId: "msg-A" });
    // The interrupted Turn has a user message, an assistant message and a fully
    // settled tool exchange, so an L3 that drops only the user message leaks both.
    await fixture.startTurn({ runId: "run-B", turnId: "turn-B", input: "question-B" });
    await fixture.event("run.started", {});
    await fixture.event("model.request_started", { requestId: "req-B", retryOfRequestId: null });
    await fixture.event("assistant.message_completed", {
      requestId: "req-B",
      message: { schemaVersion: 1, messageId: "msg-B", role: "assistant", content: "process-B" },
      toolCalls: [{ schemaVersion: 1, callId: "call-B", name: "read", arguments: {} }],
    });
    await fixture.event("tool.started", {
      call: { schemaVersion: 1, callId: "call-B", name: "read", arguments: {} },
    });
    await fixture.event("tool.completed", {
      callId: "call-B",
      result: {
        status: "success",
        schemaVersion: 1,
        callId: "call-B",
        output: [{ kind: "text", text: "tool-output-B" }],
        effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
      },
    });
    await closeTurn(h, "run-B");
    const boundsB = await readTurnBounds(store, { sessionId: h.sessionId, kernelRunId: "run-B" });
    if (boundsB.status !== "found" || boundsB.endPosition === null) throw new Error("K fixture: no B boundary");

    const c = await runCodingAgent({
      ...h.common,
      input: "question-C",
      executionIdentity: { runId: "run-C", turnId: "turn-C" },
      sessionContext: { version: 1, mode: "session_history", throughPosition: boundsB.endPosition },
    });
    expect(c.state.status).toBe("completed");
    const request = h.model.requests.at(-1)!;
    expect(userContents(request)).toEqual(["question-A", "question-C"]);
    expect(JSON.stringify(request.messages)).not.toContain("process-B");
    expect(JSON.stringify(request.messages)).not.toContain("tool-output-B");
    expect(JSON.stringify(request.messages)).not.toContain("call-B");
  });

  it("KA-06 replays an interrupted identity straight to its terminal with no model call, no tool execution and no store write, both when the pause checkpoint predates the closure and after a newer Turn exists", async () => {
    let probeExecutions = 0;
    const probe = () => [probeTool(() => { probeExecutions += 1; })];
    const runInput = { additionalTools: probe, hostAuthorizedTools: ["ka06-probe"] };
    const h = await historyHarness(
      [
        { calls: [{ callId: "ka06-call", name: "ka06-probe" }] },
        "answer-C",
      ],
      ["ka06-probe"],
    );

    // B does real model work and declares real tool work, then pauses before the
    // tool executes; the closure lands after that pause checkpoint.
    const pausedB = await runCodingAgent({
      ...h.common,
      ...runInput,
      input: "question-B",
      executionIdentity: { runId: "run-B", turnId: "turn-B" },
      controlHooks: [pauseBeforeTool("k-replay-B")],
    });
    expect(pausedB.state.status).toBe("paused");
    expect(pausedB.enabledTools).toContain("ka06-probe");
    expect(h.model.requests).toHaveLength(1);
    await closeTurn(h, "run-B");

    // Boundary write instrumentation: the Kernel store is the system boundary, so
    // count its appends instead of reading the database back.
    const appendSpy = vi.spyOn(SqliteStores.prototype, "append");
    const appendsAfterClose = appendSpy.mock.calls.length;

    const beforeNewerTurn = await runCodingAgent({
      ...h.common,
      ...runInput,
      input: "question-B",
      executionIdentity: { runId: "run-B", turnId: "turn-B" },
    });
    expect(beforeNewerTurn.state.status).toBe("interrupted");
    expect(beforeNewerTurn.state.runId).toBe("run-B");
    expect(beforeNewerTurn.state.turn.turnId).toBe("turn-B");
    expect(h.model.requests).toHaveLength(1);
    expect(probeExecutions).toBe(0);
    expect(appendSpy.mock.calls.length).toBe(appendsAfterClose);

    const newer = await runCodingAgent({
      ...h.common,
      ...runInput,
      input: "question-C",
      executionIdentity: { runId: "run-C", turnId: "turn-C" },
    });
    expect(newer.state.status).toBe("completed");
    const appendsAfterNewer = appendSpy.mock.calls.length;
    // The spy is live: a real new Turn goes through the instrumented boundary.
    expect(appendsAfterNewer).toBeGreaterThan(appendsAfterClose);

    const afterNewerTurn = await runCodingAgent({
      ...h.common,
      ...runInput,
      input: "question-B",
      executionIdentity: { runId: "run-B", turnId: "turn-B" },
    });
    expect(afterNewerTurn.state.status).toBe("interrupted");
    expect(afterNewerTurn.state.runId).toBe("run-B");
    expect(afterNewerTurn.state.turn.turnId).toBe("turn-B");
    expect(h.model.requests).toHaveLength(2);
    expect(probeExecutions).toBe(0);
    expect(appendSpy.mock.calls.length).toBe(appendsAfterNewer);
  });
});
