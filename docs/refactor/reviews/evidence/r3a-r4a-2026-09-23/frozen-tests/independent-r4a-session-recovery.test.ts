/** R4a 独立验收：真实 SQLite / 公开组合入口 / 本地模型，不读取 dist、不调用外网。 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appConfigSchema,
  ProviderRegistry,
  resumeCodingAgent,
  runCodingAgent,
} from "../../src/m5-public-api.js";
import {
  SqliteStores,
  type BeforeModelHookPort,
  type ModelClientPort,
  type ModelEvent,
  type ModelRequest,
  type RunLimits,
} from "../../src/public-api.js";
import type { SessionRecord } from "../../src/core/ports/session_store/session-store-port.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

const roots: TempWorkspace[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => root.cleanup()));
});
type Reply = { kind: "text"; text: string } | { kind: "read"; callId: string; file: string };
class LocalModel implements ModelClientPort {
  readonly requests: ModelRequest[] = [];
  constructor(readonly replies: readonly Reply[]) {}
  async *stream(
    request: Readonly<ModelRequest>,
    options: { readonly signal: AbortSignal },
  ): AsyncIterable<ModelEvent> {
    options.signal.throwIfAborted();
    const reply = this.replies[this.requests.length];
    this.requests.push(structuredClone(request));
    if (!reply) throw new Error("independent fixture exhausted");
    const base = { schemaVersion: 1 as const, requestId: request.requestId };
    if (reply.kind === "read") {
      yield {
        ...base,
        sequence: 1,
        type: "tool_call_started",
        callId: reply.callId,
        name: "read",
        ordinal: 0,
      };
      yield {
        ...base,
        sequence: 2,
        type: "tool_arguments_delta",
        callId: reply.callId,
        delta: JSON.stringify({ path: reply.file }),
      };
      yield { ...base, sequence: 3, type: "completed", reason: "tool_calls" };
    } else {
      yield { ...base, sequence: 1, type: "text_delta", delta: reply.text };
      yield { ...base, sequence: 2, type: "completed", reason: "final_answer" };
    }
  }
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
function pauseBeforeFirstModel(): BeforeModelHookPort {
  return {
    hookId: "independent-pause-before-model",
    point: "before_model",
    priority: 0,
    async execute() {
      return { point: "before_model", kind: "pause", reason: "independent pause" };
    },
  };
}
async function harness(replies: readonly Reply[]) {
  const outer = await createTempWorkspace("independent-r4a-");
  roots.push(outer);
  const workspaceRoot = outer.resolve("workspace");
  await mkdir(path.join(workspaceRoot, "private"), { recursive: true });
  await writeFile(path.join(workspaceRoot, "note.txt"), "public fixture\n");
  await writeFile(
    path.join(workspaceRoot, "private", "note.txt"),
    "INDEPENDENT_SYNTHETIC_PRIVATE_CONTENT\n",
  );
  const databasePath = outer.resolve("session.sqlite");
  const config = appConfigSchema.parse({
    schemaVersion: 1,
    model: { provider: "deepseek", model: "independent-local", options: {}, maxOutputTokens: 128 },
    runtime: { tokenBudget: 20_000, maxModelRequests: 6, maxToolCalls: 6 },
    tools: { enabledNames: ["read"] },
    storage: { databasePath },
    skills: { resourceRoot: path.resolve("resources/skills"), enabledIds: ["coding-safety"] },
    memory: { provider: "empty" },
  });
  const model = new LocalModel(replies);
  const providerRegistry = new ProviderRegistry().register({
    id: "deepseek",
    secretEnvironmentVariable: "DEEPSEEK_API_KEY",
    defaultBaseUrl: "https://invalid.test",
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: () => model,
  });
  const sessionId = "independent-session";
  return {
    model,
    databasePath,
    sessionId,
    common: {
      config,
      workspaceRoot,
      sessionId,
      providerRegistry,
      secretSource: { get: () => "synthetic-fixture-key" },
    },
  };
}
async function records(databasePath: string, sessionId: string): Promise<SessionRecord[]> {
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
function turnIds(rows: readonly SessionRecord[]): string[] {
  return rows.flatMap((row) =>
    row.recordType === "turn.started" ? [row.payload.run.turn.turnId] : [],
  );
}

describe("independent R4a execution identity and paused recovery", () => {
  it("replays the requested old identity after a newer completed Turn without returning the newer Run", async () => {
    const h = await harness([
      { kind: "text", text: "answer A" },
      { kind: "text", text: "answer B" },
    ]);
    const first = {
      ...h.common,
      input: "question A",
      executionIdentity: { runId: "run-A", turnId: "turn-A" },
    };
    const a = await runCodingAgent(first);
    expect(a.state.status).toBe("completed");
    const b = await runCodingAgent({
      ...h.common,
      input: "question B",
      executionIdentity: { runId: "run-B", turnId: "turn-B" },
    });
    expect(b.state.status).toBe("completed");
    const before = await records(h.databasePath, h.sessionId);
    const replay = await runCodingAgent(first);
    expect(replay.state.runId).toBe("run-A");
    expect(replay.state.turn.turnId).toBe("turn-A");
    expect(replay.state.transcript).toEqual(a.state.transcript);
    expect(h.model.requests).toHaveLength(2);
    expect(await records(h.databasePath, h.sessionId)).toEqual(before);
  });
  it("replays the latest completed identity without another model request or Turn", async () => {
    const h = await harness([{ kind: "text", text: "only answer" }]);
    const input = {
      ...h.common,
      input: "same question",
      executionIdentity: { runId: "same-run", turnId: "same-turn" },
    };
    const first = await runCodingAgent(input);
    const before = await records(h.databasePath, h.sessionId);
    const replay = await runCodingAgent(input);
    expect(replay.state).toEqual(first.state);
    expect(h.model.requests).toHaveLength(1);
    expect(await records(h.databasePath, h.sessionId)).toEqual(before);
  });
  it("rejects a paused recovery that raises the persisted model-request budget before any model call", async () => {
    const h = await harness([
      { kind: "read", callId: "read-1", file: "note.txt" },
      { kind: "text", text: "second request beyond original budget" },
    ]);
    const paused = await runCodingAgent({
      ...h.common,
      input: "read the fixture",
      executionIdentity: { runId: "budget-run", turnId: "budget-turn" },
      limits: limits(1),
      controlHooks: [pauseBeforeFirstModel()],
    });
    expect(paused.state.status).toBe("paused");
    expect(h.model.requests).toHaveLength(0);
    const before = await records(h.databasePath, h.sessionId);
    await expect(resumeCodingAgent({ ...h.common, limits: limits(4) })).rejects.toMatchObject({
      code: "conflict",
    });
    expect(h.model.requests).toHaveLength(0);
    expect(await records(h.databasePath, h.sessionId)).toEqual(before);
  });
  it("does not expose a previously denied path when paused recovery omits workspace options", async () => {
    const h = await harness([
      { kind: "read", callId: "read-private", file: "private/note.txt" },
      { kind: "text", text: "after the read" },
    ]);
    const paused = await runCodingAgent({
      ...h.common,
      input: "inspect the requested file",
      executionIdentity: { runId: "sandbox-run", turnId: "sandbox-turn" },
      limits: limits(4),
      workspaceOptions: { deniedPrefixes: ["private"] },
      controlHooks: [pauseBeforeFirstModel()],
    });
    expect(paused.state.status).toBe("paused");
    expect(h.model.requests).toHaveLength(0);
    // 可拒绝不兼容恢复，或从原记录恢复约束；不能扩大可读范围。
    const outcome = await resumeCodingAgent({ ...h.common, limits: limits(4) }).then(
      (value) => ({ status: "resolved" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    if (outcome.status === "rejected") {
      expect(outcome.error).toMatchObject({ code: "conflict" });
      expect(h.model.requests).toHaveLength(0);
    } else {
      const results = outcome.value.state.transcript.filter((row) => row.kind === "tool_result");
      expect(results).toHaveLength(1);
      expect(results[0]?.result.status).toBe("error");
      expect(JSON.stringify(h.model.requests)).not.toContain(
        "INDEPENDENT_SYNTHETIC_PRIVATE_CONTENT",
      );
    }
  });
  it("resumes the same paused Turn with unchanged limits and denied paths and preserves durable pause evidence", async () => {
    const h = await harness([
      { kind: "read", callId: "denied", file: "private/note.txt" },
      { kind: "text", text: "denial handled" },
    ]);
    const originalLimits = limits(4);
    const workspaceOptions = { deniedPrefixes: ["private"] };
    const paused = await runCodingAgent({
      ...h.common,
      input: "inspect the requested file",
      executionIdentity: { runId: "unchanged-run", turnId: "unchanged-turn" },
      limits: originalLimits,
      workspaceOptions,
      controlHooks: [pauseBeforeFirstModel()],
    });
    expect(paused.state.status).toBe("paused");
    const pausedRows = await records(h.databasePath, h.sessionId);
    expect(
      pausedRows.some(
        (row) =>
          row.recordType === "agent.event" &&
          row.payload.event.type === "run.paused" &&
          row.payload.event.meta.eventId === paused.state.lastEventId,
      ),
    ).toBe(true);
    const resumed = await resumeCodingAgent({
      ...h.common,
      limits: originalLimits,
      workspaceOptions,
    });
    expect(resumed.state.status).toBe("completed");
    expect(resumed.state.runId).toBe("unchanged-run");
    expect(resumed.state.turn.turnId).toBe("unchanged-turn");
    expect(resumed.state.usage.modelRequestCount).toBe(2);
    const result = resumed.state.transcript.find((row) => row.kind === "tool_result");
    expect(result?.kind === "tool_result" ? result.result.status : null).toBe("error");
    expect(JSON.stringify(h.model.requests)).not.toContain("INDEPENDENT_SYNTHETIC_PRIVATE_CONTENT");
    expect(turnIds(await records(h.databasePath, h.sessionId))).toEqual(["unchanged-turn"]);
  });
  it("does not admit a new history Turn beyond an older boundary while a later Turn remains paused", async () => {
    const h = await harness([
      { kind: "text", text: "A complete" },
      { kind: "text", text: "C must not run" },
    ]);
    const a = await runCodingAgent({
      ...h.common,
      input: "A",
      executionIdentity: { runId: "history-A", turnId: "history-turn-A" },
    });
    expect(a.state.status).toBe("completed");
    const boundary = (await records(h.databasePath, h.sessionId)).at(-1)!.position;
    const b = await runCodingAgent({
      ...h.common,
      input: "B",
      executionIdentity: { runId: "history-B", turnId: "history-turn-B" },
      sessionContext: { version: 1, mode: "session_history", throughPosition: boundary },
      controlHooks: [pauseBeforeFirstModel()],
    });
    expect(b.state.status).toBe("paused");
    const before = await records(h.databasePath, h.sessionId);
    await expect(
      runCodingAgent({
        ...h.common,
        input: "C",
        executionIdentity: { runId: "history-C", turnId: "history-turn-C" },
        sessionContext: { version: 1, mode: "session_history", throughPosition: boundary },
      }),
    ).rejects.toThrow();
    expect(h.model.requests).toHaveLength(1);
    expect(await records(h.databasePath, h.sessionId)).toEqual(before);
  });
});
