/** Migrated R4a acceptance: frozen public API, temporary SQLite and local models only.
 * Provenance and the two mechanical entry adaptations are listed in README.md.
 * This verifies Kernel behavior; it does not implement platform Sessions.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  appConfigSchema, ProviderRegistry, resumeCodingAgent, runCodingAgent,
  SqliteStores, RecoveryCoordinator, kernelSessionApiVersion,
  type BeforeModelHookPort, type ModelClientPort, type ModelEvent,
  type ModelRequest, type RunLimits, type SessionRecord,
} from "../../vendor/coding-agent/dist/public-api.js";
import {
  createTempWorkspace, type TempWorkspace, buildRawTurn, rawInsertRecords,
  canonicalJson, checksum,
} from "./R4a-legacy-fixtures.js";

const SKILL_ROOT = fileURLToPath(new URL("../../vendor/coding-agent/resources/skills", import.meta.url));

// Original: vendor/coding-agent/tests/review/independent-r4a-session-recovery.test.ts (all cases).
describe("frozen public: independent-r4a-session-recovery.test.ts", () => {
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
    skills: { resourceRoot: SKILL_ROOT, enabledIds: ["coding-safety"] },
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

});

// Original: vendor/coding-agent/tests/review/R4a-recovery-contract.test.ts (all cases).
describe("frozen public: R4a-recovery-contract.test.ts", () => {
const roots: TempWorkspace[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => root.cleanup())); });
class LocalModel implements ModelClientPort {
  readonly requests: ModelRequest[] = [];
  constructor(readonly readTarget: string | null = null) {}
  async *stream(request: Readonly<ModelRequest>, options: { readonly signal: AbortSignal }): AsyncIterable<ModelEvent> {
    options.signal.throwIfAborted();
    this.requests.push(structuredClone(request));
    if (this.readTarget && this.requests.length === 1) {
      yield { schemaVersion: 1, requestId: request.requestId, sequence: 1, type: "tool_call_started", callId: "private-read", name: "read", ordinal: 0 };
      yield { schemaVersion: 1, requestId: request.requestId, sequence: 2, type: "tool_arguments_delta", callId: "private-read", delta: JSON.stringify({ path: this.readTarget }) };
      yield { schemaVersion: 1, requestId: request.requestId, sequence: 3, type: "completed", reason: "tool_calls" };
      return;
    }
    yield { schemaVersion: 1, requestId: request.requestId, sequence: 1, type: "text_delta", delta: `answer-${this.requests.length}` };
    yield { schemaVersion: 1, requestId: request.requestId, sequence: 2, type: "completed", reason: "final_answer" };
  }
}
function limits(maxModelRequests: number): RunLimits {
  return { maxModelRequests, maxToolCalls: 4, maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null, maxCostUsdMicros: null, deadlineMs: null };
}
const pause: BeforeModelHookPort = {
  hookId: "contract-pause", point: "before_model", priority: 0,
  async execute() { return { point: "before_model", kind: "pause", reason: "contract pause" }; },
};
async function setup(readTarget: string | null = null) {
  const root = await createTempWorkspace("r4a-contract-"); roots.push(root);
  const workspaceRoot = root.resolve("workspace");
  await mkdir(path.join(workspaceRoot, "private"), { recursive: true });
  await writeFile(path.join(workspaceRoot, "note.txt"), "fixture\n");
  await writeFile(path.join(workspaceRoot, "private", "note.txt"), "R4A_CONTRACT_PRIVATE_SENTINEL\n");
  const databasePath = root.resolve("session.sqlite");
  const config = appConfigSchema.parse({
    schemaVersion: 1,
    model: { provider: "deepseek", model: "local", options: {}, maxOutputTokens: 128 },
    runtime: { tokenBudget: 20_000, maxModelRequests: 6, maxToolCalls: 6 },
    tools: { enabledNames: ["read"] }, storage: { databasePath },
    skills: { resourceRoot: SKILL_ROOT, enabledIds: ["coding-safety"] },
    memory: { provider: "empty" },
  });
  const model = new LocalModel(readTarget);
  const providerRegistry = new ProviderRegistry().register({
    id: "deepseek", secretEnvironmentVariable: "DEEPSEEK_API_KEY", defaultBaseUrl: "https://invalid.test",
    capabilities: { streaming: true, toolCalls: true, usage: true }, create: () => model,
  });
  return { model, databasePath, common: { config, workspaceRoot, sessionId: "contract-session", providerRegistry, secretSource: { get: () => "synthetic-key" } } };
}
async function readRecords(databasePath: string, sessionId: string): Promise<SessionRecord[]> {
  const store = await SqliteStores.open(databasePath);
  try {
    const rows: SessionRecord[] = []; let position = 0;
    for (;;) {
      const page = await store.read(sessionId, position, 256, { signal: new AbortController().signal });
      rows.push(...page.records); position = rows.at(-1)?.position ?? position;
      if (page.nextPosition === null) return rows;
    }
  } finally { await store.close(); }
}

describe("R4a recovery contract", () => {
  it("stable identity replay selects the middle completed Run, with no model or SQLite writes", async () => {
    const h = await setup();
    const calls = ["A", "B", "C"].map((id) => ({ ...h.common, input: `question ${id}`, executionIdentity: { runId: `run-${id}`, turnId: `turn-${id}` } }));
    const results = [];
    for (const call of calls) results.push(await runCodingAgent(call));
    const before = await readRecords(h.databasePath, h.common.sessionId);
    const replay = await runCodingAgent(calls[1]!);
    expect(replay.state.runId).toBe("run-B");
    expect(replay.state.turn.turnId).toBe("turn-B");
    expect(replay.state.transcript).toEqual(results[1]!.state.transcript);
    expect(h.model.requests).toHaveLength(3);
    expect(await readRecords(h.databasePath, h.common.sessionId)).toEqual(before);
  });

  it("a paused Turn cannot resume with a larger model budget after restart", async () => {
    const h = await setup();
    const paused = await runCodingAgent({ ...h.common, input: "pause", executionIdentity: { runId: "budget", turnId: "budget-turn" }, limits: limits(1), controlHooks: [pause] });
    expect(paused.state.status).toBe("paused");
    const before = await readRecords(h.databasePath, h.common.sessionId);
    await expect(resumeCodingAgent({ ...h.common, limits: limits(4) })).rejects.toMatchObject({ code: "conflict" });
    expect(h.model.requests).toHaveLength(0);
    expect(await readRecords(h.databasePath, h.common.sessionId)).toEqual(before);
  });

  it("a paused Turn does not lose an explicit denied prefix when the resume call omits it", async () => {
    const h = await setup("private/note.txt");
    await runCodingAgent({ ...h.common, input: "pause", executionIdentity: { runId: "sandbox", turnId: "sandbox-turn" }, workspaceOptions: { deniedPrefixes: ["private"] }, controlHooks: [pause] });
    const before = await readRecords(h.databasePath, h.common.sessionId);
    const outcome = await resumeCodingAgent(h.common).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
    if (outcome.ok) {
      const deniedRead = outcome.value.state.transcript.find((entry) => entry.kind === "tool_result");
      expect(deniedRead?.kind === "tool_result" ? deniedRead.result.status : null).toBe("error");
      expect(outcome.value.state.status).toBe("completed");
      expect(JSON.stringify(h.model.requests)).not.toContain("R4A_CONTRACT_PRIVATE_SENTINEL");
    } else {
      expect(outcome.error).toMatchObject({ code: "conflict" });
      expect(h.model.requests).toHaveLength(0);
      expect(await readRecords(h.databasePath, h.common.sessionId)).toEqual(before);
    }
  });

  it("reads a legacy schemaVersion=1 Turn without new constraint fields or rewriting its checksum", async () => {
    const h = await setup();
    const store = await SqliteStores.open(h.databasePath);
    const signal = new AbortController().signal;
    await store.create({ sessionId: h.common.sessionId, recordId: `session:${h.common.sessionId}`, createdAt: "2026-09-23T00:00:00.000Z" }, { signal });
    const old = buildRawTurn({ sessionId: h.common.sessionId, startPosition: 2, runId: "old-run", turnId: "old-turn", input: "legacy" });
    rawInsertRecords(h.databasePath, old.records);
    const before = await readRecords(h.databasePath, h.common.sessionId);
    expect(before.find((record) => record.recordType === "turn.started")?.payload).not.toHaveProperty("contextBasis");
    const result = await new RecoveryCoordinator({ sessions: store, checkpoints: store }).recover(h.common.sessionId, { signal });
    expect(result.action).toBe("terminal");
    expect(result.state.runId).toBe("old-run");
    expect(await readRecords(h.databasePath, h.common.sessionId)).toEqual(before);
    await store.close();
  });
});

});

// Original: vendor/coding-agent/tests/review/R4a-resume-environment.test.ts (all cases).
describe("frozen public: R4a-resume-environment.test.ts", () => {
const roots: TempWorkspace[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => root.cleanup())); });

class LocalModel implements ModelClientPort {
  readonly requests: ModelRequest[] = [];
  constructor(readonly readFirst = false) {}
  async *stream(request: Readonly<ModelRequest>, options: { readonly signal: AbortSignal }): AsyncIterable<ModelEvent> {
    options.signal.throwIfAborted();
    this.requests.push(structuredClone(request));
    if (this.readFirst && this.requests.length === 1) {
      yield { schemaVersion: 1, requestId: request.requestId, sequence: 1, type: "tool_call_started", callId: "first-read", name: "read", ordinal: 0 };
      yield { schemaVersion: 1, requestId: request.requestId, sequence: 2, type: "tool_arguments_delta", callId: "first-read", delta: JSON.stringify({ path: "note.txt" }) };
      yield { schemaVersion: 1, requestId: request.requestId, sequence: 3, type: "completed", reason: "tool_calls" };
      return;
    }
    yield { schemaVersion: 1, requestId: request.requestId, sequence: 1, type: "text_delta", delta: "unexpected continuation" };
    yield { schemaVersion: 1, requestId: request.requestId, sequence: 2, type: "completed", reason: "final_answer" };
  }
}

const pause: BeforeModelHookPort = {
  hookId: "environment-pause", point: "before_model", priority: 0,
  async execute() { return { point: "before_model", kind: "pause", reason: "inspect recovery environment" }; },
};
function pauseBeforeSecondModel(): BeforeModelHookPort {
  let calls = 0;
  return {
    hookId: "environment-pause-after-read", point: "before_model", priority: 0,
    async execute() {
      calls += 1;
      return calls === 1
        ? { point: "before_model", kind: "continue" }
        : { point: "before_model", kind: "pause", reason: "inspect usage after read" };
    },
  };
}
const limits: RunLimits = {
  maxModelRequests: 2, maxToolCalls: 2, maxInputTokens: null, maxOutputTokens: null,
  maxTotalTokens: null, maxCostUsdMicros: null, deadlineMs: null,
};
const workspaceOptions = { deniedPrefixes: ["private"] };
const processSandboxOptions = { protectedPaths: ["private"] };
const hostAuthorizedTools: readonly string[] = [];

async function setup(options: { readonly strict?: boolean; readonly databaseInsideWorkspace?: boolean; readonly usedModelRequest?: boolean } = {}) {
  const root = await createTempWorkspace("r4a-environment-"); roots.push(root);
  const workspaceRoot = root.resolve("workspace-a");
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(path.join(workspaceRoot, "note.txt"), "same contents\n");
  if (options.databaseInsideWorkspace) {
    await mkdir(path.join(workspaceRoot, "data"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "data", "user.txt"), "ordinary user file\n");
  }
  const databasePath = options.databaseInsideWorkspace
    ? path.join(workspaceRoot, "data", "session.sqlite")
    : root.resolve("session.sqlite");
  const config = appConfigSchema.parse({
    schemaVersion: 1,
    model: { provider: "deepseek", model: "original-local-model", options: {}, maxOutputTokens: 128 },
    runtime: { tokenBudget: 20_000, maxModelRequests: 6, maxToolCalls: 6 },
    tools: { enabledNames: ["read"] }, storage: { databasePath },
    workspace: { consistencyMode: options.strict ? "strict" : "session" },
    skills: { resourceRoot: SKILL_ROOT, enabledIds: ["coding-safety"] },
    memory: { provider: "empty" },
  });
  const model = new LocalModel(options.usedModelRequest ?? false);
  const providerRegistry = new ProviderRegistry().register({
    id: "deepseek", secretEnvironmentVariable: "DEEPSEEK_API_KEY", defaultBaseUrl: "https://invalid.test",
    capabilities: { streaming: true, toolCalls: true, usage: true }, create: () => model,
  });
  const common = {
    config, workspaceRoot, sessionId: "environment-session", providerRegistry,
    secretSource: { get: () => "synthetic-key" }, limits, workspaceOptions,
    processSandboxOptions, hostAuthorizedTools,
  };
  const paused = await runCodingAgent({
    ...common, input: "pause before the model", controlHooks: [options.usedModelRequest ? pauseBeforeSecondModel() : pause],
    executionIdentity: { runId: "environment-run", turnId: "environment-turn" },
  });
  expect(paused.state.status).toBe("paused");
  expect(model.requests).toHaveLength(options.usedModelRequest ? 1 : 0);
  return { root, model, databasePath, common, paused };
}

async function records(databasePath: string, sessionId: string): Promise<SessionRecord[]> {
  const store = await SqliteStores.open(databasePath);
  try {
    const result: SessionRecord[] = [];
    let position = 0;
    for (;;) {
      const page = await store.read(sessionId, position, 256, { signal: new AbortController().signal });
      result.push(...page.records);
      position = page.records.at(-1)?.position ?? position;
      if (page.nextPosition === null) return result;
    }
  } finally { await store.close(); }
}

describe("R4a paused recovery environment", () => {
  it("rejects a changed model with original limits, sandboxes, and host authorization", async () => {
    const h = await setup();
    const before = await records(h.databasePath, h.common.sessionId);
    const changedConfig = appConfigSchema.parse({
      ...h.common.config,
      model: { ...h.common.config.model, model: "different-local-model" },
    });
    await expect(resumeCodingAgent({ ...h.common, config: changedConfig })).rejects.toMatchObject({ code: "conflict" });
    expect(h.model.requests).toHaveLength(0);
    expect(await records(h.databasePath, h.common.sessionId)).toEqual(before);
  });

  it("rejects a changed workspace root with original config, limits, and sandboxes", async () => {
    const h = await setup();
    const otherRoot = h.root.resolve("workspace-b");
    await mkdir(otherRoot, { recursive: true });
    await writeFile(path.join(otherRoot, "note.txt"), "same contents\n");
    const before = await records(h.databasePath, h.common.sessionId);
    await expect(resumeCodingAgent({ ...h.common, workspaceRoot: otherRoot })).rejects.toMatchObject({ code: "conflict" });
    expect(h.model.requests).toHaveLength(0);
    expect(await records(h.databasePath, h.common.sessionId)).toEqual(before);
  });

  it("rejects an edited ordinary workspace file under strict consistency before any resumed model call", async () => {
    const h = await setup({ strict: true });
    const before = await records(h.databasePath, h.common.sessionId);
    await writeFile(path.join(h.common.workspaceRoot, "note.txt"), "changed after pause\n");
    await expect(resumeCodingAgent(h.common)).rejects.toMatchObject({ code: "conflict" });
    expect(h.model.requests).toHaveLength(0);
    expect(await records(h.databasePath, h.common.sessionId)).toEqual(before);
  });

  it("resumes with preserved usage when only its SQLite files changed inside a strict workspace", async () => {
    const h = await setup({ strict: true, databaseInsideWorkspace: true, usedModelRequest: true });
    expect(h.paused.state.usage.modelRequestCount).toBe(1);
    const before = await records(h.databasePath, h.common.sessionId);
    const resumed = await resumeCodingAgent(h.common);
    expect(resumed.state.status).toBe("completed");
    expect(resumed.state.runId).toBe(h.paused.state.runId);
    expect(resumed.state.usage.modelRequestCount).toBe(h.paused.state.usage.modelRequestCount + 1);
    expect(h.model.requests).toHaveLength(2);
    expect((await records(h.databasePath, h.common.sessionId)).length).toBeGreaterThan(before.length);
  });

  it("does not exclude ordinary files beside the SQLite database from strict revision checks", async () => {
    const h = await setup({ strict: true, databaseInsideWorkspace: true });
    const before = await records(h.databasePath, h.common.sessionId);
    await writeFile(path.join(h.common.workspaceRoot, "data", "user.txt"), "changed after pause\n");
    await expect(resumeCodingAgent(h.common)).rejects.toMatchObject({ code: "conflict" });
    expect(h.model.requests).toHaveLength(0);
    expect(await records(h.databasePath, h.common.sessionId)).toEqual(before);
  });

  it("ignores a checksum-valid checkpoint with unsupported recovery constraint version and replays Session events", async () => {
    const h = await setup();
    const store = await SqliteStores.open(h.databasePath);
    const signal = new AbortController().signal;
    try {
      const checkpoints = await store.listCheckpoints("environment-run", { signal });
      const latest = checkpoints[0];
      expect(latest).toBeDefined();
      const fromEvents = await new RecoveryCoordinator({ sessions: store }).recover(h.common.sessionId, { signal });
      const before = await records(h.databasePath, h.common.sessionId);
      const body: Record<string, unknown> = { ...latest };
      delete body["checksum"];
      const originalConstraints = body["recoveryConstraints"];
      body["recoveryConstraints"] = {
        ...(originalConstraints && typeof originalConstraints === "object" ? originalConstraints : {}),
        version: 2,
      };
      const database = new DatabaseSync(h.databasePath);
      try {
        database.prepare("UPDATE checkpoints SET checkpoint_json=? WHERE checkpoint_id=?")
          .run(canonicalJson({ ...body, checksum: checksum(body) }), latest!.checkpointId);
      } finally { database.close(); }
      const recovered = await new RecoveryCoordinator({ sessions: store, checkpoints: store })
        .recover(h.common.sessionId, { signal });
      expect(recovered.checkpointId).not.toBe(latest!.checkpointId);
      expect(recovered.action).toBe("paused");
      expect(recovered.state).toEqual(fromEvents.state);
      expect(await records(h.databasePath, h.common.sessionId)).toEqual(before);
    } finally { await store.close(); }
  });

  it("still accepts a legacy checkpoint without recovery constraints", async () => {
    const h = await setup();
    const store = await SqliteStores.open(h.databasePath);
    const signal = new AbortController().signal;
    try {
      const latest = (await store.listCheckpoints("environment-run", { signal }))[0];
      expect(latest).toBeDefined();
      const body: Record<string, unknown> = { ...latest };
      delete body["checksum"];
      delete body["recoveryConstraints"];
      const database = new DatabaseSync(h.databasePath);
      try {
        database.prepare("UPDATE checkpoints SET checkpoint_json=? WHERE checkpoint_id=?")
          .run(canonicalJson({ ...body, checksum: checksum(body) }), latest!.checkpointId);
      } finally { database.close(); }
      const before = await records(h.databasePath, h.common.sessionId);
      const recovered = await new RecoveryCoordinator({ sessions: store, checkpoints: store })
        .recover(h.common.sessionId, { signal });
      expect(recovered.checkpointId).toBe(latest!.checkpointId);
      expect(recovered.action).toBe("paused");
      expect(await records(h.databasePath, h.common.sessionId)).toEqual(before);
    } finally { await store.close(); }
  });
});

});

// Original: tests/integration/kernel-session-api.test.ts, first two public behaviors.
describe("frozen public: version and completed history", () => {
const workspaces: TempWorkspace[] = [];
const signal = new AbortController().signal;

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.cleanup()));
});

interface ScriptedCall {
  readonly text?: string;
  readonly toolCalls?: readonly {
    readonly callId: string;
    readonly name: string;
    readonly arguments?: Record<string, unknown>;
  }[];
}

class ScriptedModelClient implements ModelClientPort {
  readonly requests: ModelRequest[] = [];
  #index = 0;

  constructor(readonly scripts: ScriptedCall[]) {}

  get callCount(): number {
    return this.#index;
  }

  async *stream(
    request: Readonly<ModelRequest>,
    options: { readonly signal: AbortSignal },
  ): AsyncIterable<ModelEvent> {
    const script = this.scripts[this.#index];
    this.#index += 1;
    if (!script) throw new Error(`缺少第 ${String(this.#index)} 次模型调用脚本`);
    this.requests.push(structuredClone(request));
    const base = { schemaVersion: 1 as const, requestId: request.requestId };
    let sequence = 1;
    for (const [ordinal, call] of (script.toolCalls ?? []).entries()) {
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
    if (script.text)
      yield { ...base, sequence: sequence++, type: "text_delta", delta: script.text };
    yield {
      ...base,
      type: "completed",
      sequence,
      reason: (script.toolCalls?.length ?? 0) > 0 ? "tool_calls" : "final_answer",
    };
  }
}

interface Harness {
  readonly workspace: TempWorkspace;
  readonly databasePath: string;
  readonly sessionId: string;
  readonly client: ScriptedModelClient;
  readonly common: {
    readonly config: ReturnType<typeof appConfigSchema.parse>;
    readonly workspaceRoot: string;
    readonly sessionId: string;
    readonly providerRegistry: ProviderRegistry;
    readonly secretSource: { get: () => string };
  };
}

async function createHarness(
  prefix: string,
  scripts: ScriptedCall[],
  overrides: { readonly tokenBudget?: number; readonly tools?: readonly string[] } = {},
): Promise<Harness> {
  const workspace = await createTempWorkspace(prefix);
  workspaces.push(workspace);
  await writeFile(workspace.resolve("notes.txt"), "fixture notes\n", "utf8");
  await mkdir(workspace.resolve("secret"), { recursive: true });
  await writeFile(workspace.resolve("secret", "notes.txt"), "hidden notes\n", "utf8");
  const databasePath = workspace.resolve("data", "sessions.sqlite");
  const config = appConfigSchema.parse({
    schemaVersion: 1,
    model: {
      provider: "deepseek",
      model: "fixture-model",
      options: {},
      maxOutputTokens: 128,
    },
    runtime: {
      tokenBudget: overrides.tokenBudget ?? 20_000,
      maxModelRequests: 6,
      maxToolCalls: 6,
    },
    tools: { enabledNames: overrides.tools ?? ["read"] },
    storage: { databasePath },
    skills: { resourceRoot: SKILL_ROOT, enabledIds: ["coding-safety"] },
    memory: { provider: "empty" },
  });
  const client = new ScriptedModelClient(scripts);
  const registry = new ProviderRegistry().register({
    id: "deepseek",
    secretEnvironmentVariable: "DEEPSEEK_API_KEY",
    defaultBaseUrl: "https://invalid.test",
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: () => client,
  });
  const sessionId = `session-${prefix}`;
  return {
    workspace,
    databasePath,
    sessionId,
    client,
    common: {
      config,
      workspaceRoot: workspace.root,
      sessionId,
      providerRegistry: registry,
      secretSource: { get: () => "fixture-secret" },
    },
  };
}

async function readRecords(
  databasePath: string,
  sessionId: string,
): Promise<readonly SessionRecord[]> {
  const store = await SqliteStores.open(databasePath);
  try {
    const records: SessionRecord[] = [];
    let position = 0;
    while (true) {
      const page = await store.read(sessionId, position, 256, { signal });
      records.push(...page.records);
      position = page.records.at(-1)?.position ?? position;
      if (page.nextPosition === null) return records;
    }
  } finally {
    await store.close();
  }
}

function userMessages(request: ModelRequest): readonly string[] {
  return request.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content);
}

describe("kernel session public extension (R4a)", () => {
  it("默认 current_turn：不写 contextBasis，请求只含当前 Turn", async () => {
    expect(kernelSessionApiVersion).toBe(2);
    const harness = await createHarness("kernel-default-", [{ text: "answer-default" }]);
    const result = await runCodingAgent({ ...harness.common, input: "default input" });
    expect(result.state.status).toBe("completed");
    const records = await readRecords(harness.databasePath, harness.sessionId);
    const turn = records.find((record) => record.recordType === "turn.started");
    expect(turn?.recordType).toBe("turn.started");
    if (turn?.recordType === "turn.started") {
      expect("contextBasis" in turn.payload).toBe(false);
    }
    expect(userMessages(harness.client.requests[0]!)).toEqual(["default input"]);
  });

  it("两轮已完成历史（含工具交换）进入真实模型请求，且当前输入只出现一次", async () => {
    const harness = await createHarness("kernel-history-", [
      {
        text: "让我读取文件",
        toolCalls: [{ callId: "call-t1", name: "read", arguments: { path: "notes.txt" } }],
      },
      { text: "answer-one" },
      { text: "answer-two" },
    ]);
    const first = await runCodingAgent({
      ...harness.common,
      input: "question-one",
      executionIdentity: { runId: "run-t1", turnId: "turn-t1" },
    });
    expect(first.state.status).toBe("completed");
    const recordsAfterFirst = await readRecords(harness.databasePath, harness.sessionId);
    // The preceding public run completed. Its final durable event supplies the
    // boundary without calling Kernel's private history-selection helper.
    expect(recordsAfterFirst.at(-1)).toMatchObject({
      recordType: "agent.event", payload: { event: { type: "run.completed" } },
    });
    const boundary = recordsAfterFirst.at(-1)!.position;
    expect(boundary).toBeGreaterThan(0);

    const second = await runCodingAgent({
      ...harness.common,
      input: "question-two",
      sessionContext: { version: 1, mode: "session_history", throughPosition: boundary! },
      executionIdentity: { runId: "run-t2", turnId: "turn-t2" },
    });
    expect(second.state.status).toBe("completed");

    const request = harness.client.requests.at(-1)!;
    expect(request.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
    const [firstUser, firstAssistant, firstTool, firstAnswer, secondUser] = request.messages;
    expect(firstUser?.role === "user" ? firstUser.content : null).toBe("question-one");
    expect(
      firstAssistant?.role === "assistant"
        ? firstAssistant.toolCalls.map((call) => call.callId)
        : [],
    ).toEqual(["call-t1"]);
    expect(firstTool?.role === "tool" ? firstTool.callId : null).toBe("call-t1");
    expect(firstTool?.role === "tool" ? firstTool.result.status : null).toBe("success");
    expect(firstAnswer?.role === "assistant" ? firstAnswer.content : null).toBe("answer-one");
    expect(secondUser?.role === "user" ? secondUser.content : null).toBe("question-two");
    expect(userMessages(request).filter((content) => content === "question-two")).toHaveLength(1);
    // 真实 system/skills/tools 一并进入请求：预算选择面对的是完整输入。
    expect(request.systemPrompt).toContain('[skill_instruction id="coding-safety"');
    expect(request.tools.map((tool) => tool.name)).toContain("read");
  });

});
});
