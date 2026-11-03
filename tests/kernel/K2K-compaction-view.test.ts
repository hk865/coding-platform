/**
 * Slice K2 KE2: the compacted view a new or resumed Turn hands the model.
 *
 * Entry: the public `runCodingAgent` / `resumeCodingAgent` with the frozen PC scripted
 * provider and a `fixture_read` test tool; compaction records come from the public
 * `appendCompactionRecord`. Assertions read `ModelRequest.messages` (slice-K2-SPEC §4,
 * rows K2K-03..07, K2K-10, K2K-11).
 *
 * Hand-counted positions (session.created = 1). A Turn whose first reply makes n tool calls
 * and whose second reply answers writes 9 + 2n records: turn.started, run.started,
 * model.request_started, model.usage_recorded, assistant.message_completed, n tool.started,
 * the n results (tool.completed / tool.failed, in call order), model.request_started,
 * model.usage_recorded, assistant.message_completed, run.completed. So a one-call Turn that
 * starts at s ends at s + 10 and records its tool.completed at s + 6; with one-call Turns
 * only, T_k = 1 + 11k. A compaction record is the tail + 1.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  appConfigSchema,
  appendCompactionRecord,
  ProviderRegistry,
  readTurnBounds,
  resumeCodingAgent,
  runCodingAgent,
  type AppendCompactionRecordInput,
  type BeforeModelHookPort,
  type ModelRequest,
  type ToolCall,
  type ToolResult,
} from "../../vendor/coding-agent/dist/public-api.js";
import { fixtureTool, ScriptedProvider, type ScriptedStep } from "../helpers/PC-kernel-fixture.js";
import {
  K_AT,
  K_AT_LATER,
  K_SIGNAL,
  openTempKernelStore,
  readAllRecords,
  type TempKernelStore,
} from "../helpers/K-session-support.js";

const SKILL_ROOT = fileURLToPath(new URL("../../vendor/coding-agent/resources/skills", import.meta.url));
const opened: TempKernelStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((item) => item.cleanup()));
});

const EFFECTS = { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] } as const;

interface Call {
  readonly callId: string;
  readonly args?: Record<string, string>;
  readonly body: string;
  /** Only c1f of K2K-03: an execution_failed result whose output is the body. */
  readonly failed?: true;
}

function resultOf(call: Call, text = call.body): ToolResult {
  const output = [{ kind: "text" as const, text }];
  return call.failed
    ? { schemaVersion: 1, callId: call.callId, status: "error", output, effects: EFFECTS,
        error: { code: "execution_failed", message: "fixture failure", retryable: false } }
    : { schemaVersion: 1, callId: call.callId, status: "success", output, effects: EFFECTS };
}

/** One call per Turn k with a short body, unless the row says otherwise. */
function short(k: number): Call[] {
  return [{ callId: `c${String(k)}`, body: `body-${String(k)}` }];
}

/** The unchanged model messages of scripted Turn k (message ids left out), with optional stub texts. */
function turnView(k: number, calls: readonly Call[], stubs: Record<string, string> = {}): unknown[] {
  return [
    { role: "user", content: `input-${String(k)}` },
    { role: "assistant", content: "", toolCalls: calls.map((call) => ({
      schemaVersion: 1, callId: call.callId, name: "fixture_read", arguments: call.args ?? {} })) },
    ...calls.map((call) => ({ role: "tool", callId: call.callId, result: resultOf(call, stubs[call.callId]) })),
    { role: "assistant", content: `answer-${String(k)}`, toolCalls: [] },
  ];
}

function withoutIds(request: ModelRequest): unknown[] {
  return request.messages.map((message) => ("messageId" in message ? { ...message, messageId: undefined } : message));
}

function summaryMessage(record: number, through: number, text: string): unknown {
  return { role: "user", content: `以下是本线更早对话的压缩摘要（压缩记录 ${String(record)}，覆盖到位置 ${String(through)}）。原记录没有删除。\n\n${text}` };
}

function stubText(callId: string, args: string, position: number, readBack: string): string {
  return `旧工具结果已清（工具 fixture_read，调用 ${callId}，参数 ${args}，位置 ${String(position)}，原 2027 字节）。要原文：${readBack}`;
}

const C1: Call = { callId: "c1", args: { path: "a.txt" }, body: "x".repeat(2000) };
const C2: Call = { callId: "c2", args: { q: "a".repeat(95) }, body: "y".repeat(2000) };
/** `{"q":"` + 95 a + `"}` is 103 code points; the summary keeps the first 80 and adds `…`. */
const C2_ARGS = `{"q":"${"a".repeat(74)}…`;

type HistoryContext = { throughPosition: number; sourceSessionId?: string; viewPosition?: number };

async function viewHarness() {
  const temp = await openTempKernelStore("k2k-view-");
  opened.push(temp);
  const workspaceRoot = path.join(temp.root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const config = appConfigSchema.parse({
    schemaVersion: 1,
    model: { provider: "deepseek", model: "k2k-local", options: {}, maxOutputTokens: 128 },
    runtime: { tokenBudget: 1_000_000, maxModelRequests: 6, maxToolCalls: 6 },
    tools: { enabledNames: ["fixture_read"] },
    storage: { databasePath: temp.databasePath },
    skills: { resourceRoot: SKILL_ROOT, enabledIds: ["coding-safety"] },
    memory: { provider: "empty" },
  });
  // Steps are queued right before each run, so the scripted provider answers in run order.
  const steps: ScriptedStep[] = [];
  const provider = new ScriptedProvider(steps);
  const calls = new Map<string, Call>();
  const tool = {
    ...fixtureTool("fixture_read", async (call: ToolCall) => resultOf(calls.get(call.callId)!)),
    // The Host permission policy admits a registered read-only tool with workspace_read.
    requiredCapabilities: ["workspace_read"] as const,
  };
  const common = {
    config, workspaceRoot,
    providerRegistry: new ProviderRegistry().register({
      id: "deepseek", secretEnvironmentVariable: "DEEPSEEK_API_KEY", defaultBaseUrl: "https://invalid.test",
      capabilities: { streaming: true, toolCalls: true, usage: true }, create: () => provider,
    }),
    secretSource: { get: () => "synthetic-fixture-key" },
    additionalTools: () => [tool],
  };
  const identity = (sessionId: string, label: string) =>
    ({ runId: `${sessionId}-run-${label}`, turnId: `${sessionId}-turn-${label}` });
  const history = (context: HistoryContext) => ({ version: 1 as const, mode: "session_history" as const, ...context });
  return {
    temp, provider, common, identity, history,
    queue: (step: ScriptedStep) => { steps.push(step); },
    /** Scripted Turn k: one reply with the calls, then the answer `answer-k`. */
    async turn(sessionId: string, k: number, turnCalls: readonly Call[]): Promise<void> {
      for (const call of turnCalls) calls.set(call.callId, call);
      steps.push({ toolCalls: turnCalls.map((call) => ({ callId: call.callId, name: "fixture_read", arguments: call.args ?? {} })) },
        { text: `answer-${String(k)}` });
      const result = await runCodingAgent({ ...common, sessionId, input: `input-${String(k)}`,
        executionIdentity: identity(sessionId, String(k)) });
      expect(result.state.status).toBe("completed");
    },
    async compact(sessionId: string, payload: Omit<AppendCompactionRecordInput, "sessionId" | "expectedRevision" | "at">): Promise<number> {
      const header = await temp.store.get(sessionId, { signal: K_SIGNAL });
      const result = await appendCompactionRecord(temp.store, { sessionId, expectedRevision: header.revision, at: K_AT_LATER, ...payload });
      if (result.status !== "appended") throw new Error(`K2K fixture: compaction ${result.status}`);
      return result.position;
    },
    /** A new Turn `label` that restores the history; returns its first model request. */
    async restore(sessionId: string, label: string, context: HistoryContext): Promise<ModelRequest> {
      steps.push({ text: `answer-${label}` });
      await runCodingAgent({ ...common, sessionId, input: `input-${label}`,
        executionIdentity: identity(sessionId, label), sessionContext: history(context) });
      return provider.requests.at(-1)!;
    },
  };
}

describe("K2 the compacted view (KE2, Kernel SQLite)", () => {
  it("K2K-03 stubs only the successful results up to the stubs range, with the tool, call, argument digest, position, size and read-back text; failed and too-short results stay", async () => {
    const h = await viewHarness();
    const c1f: Call = { callId: "c1f", body: "z".repeat(2000), failed: true };
    const c2s: Call = { callId: "c2s", body: "ok" };
    // T1 (two calls) is 2..14 with c1's tool.completed at 9; T2 (two calls) is 15..27 with
    // c2's at 22; T3..T5 are 28..38, 39..49, 50..60; c is 61.
    await h.turn("s1", 1, [C1, c1f]);
    await h.turn("s1", 2, [C2, c2s]);
    for (const k of [3, 4, 5]) await h.turn("s1", k, short(k));
    const c = await h.compact("s1", { basedOnPosition: 60, outcome: "compacted", summary: null, failure: null,
      stubs: { throughPosition: 27, readBack: { "s1-run-1": "RB-1", "s1-run-2": "RB-2" } } });

    const request = await h.restore("s1", "r", { throughPosition: c });

    expect(withoutIds(request)).toEqual([
      ...turnView(1, [C1, c1f], { c1: stubText("c1", '{"path":"a.txt"}', 9, "RB-1") }),
      ...turnView(2, [C2, c2s], { c2: stubText("c2", C2_ARGS, 22, "RB-2") }),
      ...turnView(3, short(3)), ...turnView(4, short(4)), ...turnView(5, short(5)),
      { role: "user", content: "input-r" },
    ]);
  });

  it("K2K-04 puts the summary message first and leaves the summarised Turns out of the input but in the identity check", async () => {
    const h = await viewHarness();
    for (const k of [1, 2, 3, 4]) await h.turn("s1", k, short(k));
    // T1..T4 = 12, 23, 34, 45; c = 46.
    const c = await h.compact("s1", { basedOnPosition: 45, outcome: "compacted", stubs: null, failure: null,
      summary: { throughPosition: 23, text: "摘要正文" } });

    const request = await h.restore("s1", "r", { throughPosition: c });

    expect(request.messages[0]).toEqual({ role: "user", messageId: "context-summary:s1:46",
      content: "以下是本线更早对话的压缩摘要（压缩记录 46，覆盖到位置 23）。原记录没有删除。\n\n摘要正文" });
    expect(withoutIds(request)).toEqual([
      summaryMessage(46, 23, "摘要正文"), ...turnView(3, short(3)), ...turnView(4, short(4)),
      { role: "user", content: "input-r" },
    ]);
    const records = (await readAllRecords(h.temp.store, "s1")).length;
    await expect(runCodingAgent({ ...h.common, sessionId: "s1", input: "input-new",
      executionIdentity: { runId: "run-new", turnId: "s1-turn-1" }, sessionContext: h.history({ throughPosition: c }) }))
      .rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("历史前缀包含当前 Turn") });
    expect(h.provider.requests).toHaveLength(9);
    expect(await readAllRecords(h.temp.store, "s1")).toHaveLength(records);
  });

  it("K2K-05 restores the latest compacted record at or before the boundary, skips a failed one and carries the summary forward", async () => {
    const h = await viewHarness();
    const long = (k: number): Call[] => [{ callId: `c${String(k)}`, body: String(k).repeat(2000) }];
    for (const k of [1, 2, 3, 4]) await h.turn("s1", k, long(k));
    // T1..T4 = 12, 23, 34, 45 (c3 completed at 30, c4 at 41); A = 46; T5 = 47..57; B = 58;
    // T6 = 59..69; C = 70.
    const a = await h.compact("s1", { basedOnPosition: 45, outcome: "compacted", failure: null,
      summary: { throughPosition: 23, text: "SA" }, stubs: { throughPosition: 34, readBack: { "s1-run-3": "RB-3" } } });
    await h.turn("s1", 5, long(5));
    const b = await h.compact("s1", { basedOnPosition: 57, outcome: "compacted", failure: null, summary: null,
      stubs: { throughPosition: 45, readBack: { "s1-run-3": "RB-3", "s1-run-4": "RB-4" } } });
    await h.turn("s1", 6, long(6));
    const c = await h.compact("s1", { basedOnPosition: 69, outcome: "failed", stubs: null, summary: null,
      failure: { reason: "summary_unsupported" } });
    expect([a, b, c]).toEqual([46, 58, 70]);

    const atC = await h.restore("s1", "rc", { throughPosition: 70 });
    expect(atC.messages[0]).toMatchObject({ messageId: "context-summary:s1:58" });
    expect(withoutIds(atC)).toEqual([
      summaryMessage(58, 23, "SA"),
      ...turnView(3, long(3), { c3: stubText("c3", "{}", 30, "RB-3") }),
      ...turnView(4, long(4), { c4: stubText("c4", "{}", 41, "RB-4") }),
      ...turnView(5, long(5)), ...turnView(6, long(6)),
      { role: "user", content: "input-rc" },
    ]);

    const atT5 = await h.restore("s1", "r5", { throughPosition: 57 });
    expect(atT5.messages[0]).toMatchObject({ messageId: "context-summary:s1:46" });
    expect(withoutIds(atT5)).toEqual([
      summaryMessage(46, 23, "SA"),
      ...turnView(3, long(3), { c3: stubText("c3", "{}", 30, "RB-3") }),
      ...turnView(4, long(4)), ...turnView(5, long(5)),
      { role: "user", content: "input-r5" },
    ]);

    const atT4 = await h.restore("s1", "r4", { throughPosition: 45 });
    expect(withoutIds(atT4)).toEqual([
      ...turnView(1, long(1)), ...turnView(2, long(2)), ...turnView(3, long(3)), ...turnView(4, long(4)),
      { role: "user", content: "input-r4" },
    ]);
  });

  describe("K2K-06 the restore boundary may be a compaction record; other non-terminal records stay refused", () => {
    // T1..T3 = 12, 23, 34 (T3's turn.started is 24 and its tool.completed 30); c = 35.
    it.each([
      { name: "a compaction record is accepted", through: 35, refused: false },
      { name: "rejects: the turn.started of T3", through: 24, refused: true },
      { name: "rejects: a non-terminal event inside T3", through: 30, refused: true },
      { name: "rejects: position 1 (session.created)", through: 1, refused: true },
    ])("K2K-06 $name", async ({ through, refused }) => {
      const h = await viewHarness();
      for (const k of [1, 2, 3]) await h.turn("s1", k, short(k));
      await h.compact("s1", { basedOnPosition: 34, outcome: "compacted", summary: null, failure: null,
        stubs: { throughPosition: 12, readBack: { "s1-run-1": "RB-1" } } });
      const records = (await readAllRecords(h.temp.store, "s1")).length;

      const run = h.restore("s1", "r", { throughPosition: through });

      if (!refused) {
        await expect(run).resolves.toBeDefined();
        expect(h.provider.requests).toHaveLength(7);
        return;
      }
      await expect(run).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("不是已完成轮次的稳定边界") });
      expect(h.provider.requests).toHaveLength(6);
      expect(await readAllRecords(h.temp.store, "s1")).toHaveLength(records);
    });
  });

  it("K2K-07 a Turn started on the compacted view pauses and resumes with the same input, and the next round still restores the compacted view", async () => {
    const h = await viewHarness();
    for (const k of [1, 2, 3, 4]) await h.turn("s1", k, short(k));
    const c = await h.compact("s1", { basedOnPosition: 45, outcome: "compacted", stubs: null, failure: null,
      summary: { throughPosition: 23, text: "摘要正文" } });
    let hooked: ModelRequest | undefined;
    const pause: BeforeModelHookPort = {
      hookId: "k2k07-pause", point: "before_model", priority: 0,
      async execute(invocation) {
        hooked = structuredClone(invocation.request);
        return { point: "before_model", kind: "pause", reason: "k2k07 pause" };
      },
    };
    const compacted = [summaryMessage(46, 23, "摘要正文"), ...turnView(3, short(3)), ...turnView(4, short(4))];

    const first = await runCodingAgent({ ...h.common, sessionId: "s1", input: "input-p",
      executionIdentity: h.identity("s1", "p"), sessionContext: h.history({ throughPosition: c }), controlHooks: [pause] });
    expect(first.state.status).toBe("paused");
    expect(h.provider.requests).toHaveLength(8);
    h.queue({ text: "answer-p" });
    const resumed = await resumeCodingAgent({ ...h.common, sessionId: "s1" });

    expect(resumed.state.status).toBe("completed");
    const sent = h.provider.requests.at(-1)!;
    const viewed = [...compacted, { role: "user", content: "input-p" }];
    expect(withoutIds(hooked!)).toEqual(viewed);
    expect(withoutIds(sent)).toEqual(viewed);
    const hookedBytes = JSON.stringify(hooked!.messages);
    expect(JSON.stringify(sent.messages)).toBe(hookedBytes);
    const bounds = await readTurnBounds(h.temp.store, { sessionId: "s1", kernelRunId: "s1-run-p" });
    if (bounds.status !== "found" || bounds.endPosition === null) throw new Error("K2K fixture: no p boundary");
    const next = await h.restore("s1", "q", { throughPosition: bounds.endPosition });
    expect(withoutIds(next)).toEqual([
      ...compacted, { role: "user", content: "input-p" }, { role: "assistant", content: "answer-p", toolCalls: [] },
      { role: "user", content: "input-q" },
    ]);
  });

  it("K2K-10 a derived basis applies the source Session's compaction record at or before the seed boundary only", async () => {
    const h = await viewHarness();
    for (const k of [1, 2, 3]) await h.turn("s1", k, short(k));
    // T1..T3 = 12, 23, 34; A = 35; T4 = 36..46.
    await h.compact("s1", { basedOnPosition: 34, outcome: "compacted", stubs: null, failure: null,
      summary: { throughPosition: 23, text: "SA" } });
    await h.turn("s1", 4, short(4));
    await h.temp.store.create({ sessionId: "s2", recordId: "session:s2", createdAt: K_AT }, { signal: K_SIGNAL });

    const atT4 = await h.restore("s2", "r4", { throughPosition: 46, sourceSessionId: "s1" });
    expect(atT4.messages[0]).toMatchObject({ messageId: "context-summary:s1:35" });
    expect(withoutIds(atT4)).toEqual([
      summaryMessage(35, 23, "SA"), ...turnView(3, short(3)), ...turnView(4, short(4)),
      { role: "user", content: "input-r4" },
    ]);

    const atT3 = await h.restore("s2", "r3", { throughPosition: 34, sourceSessionId: "s1" });
    expect(withoutIds(atT3)).toEqual([
      ...turnView(1, short(1)), ...turnView(2, short(2)), ...turnView(3, short(3)),
      { role: "user", content: "input-r3" },
    ]);
  });

  describe("K2K-11 viewPosition picks an old compacted record after the history boundary", () => {
    // T1..T4 = 12, 23, 34, 45 (c1 completed at 8, c2 at 19); A / B = 46; T5 = 47..57.
    it.each([
      { name: "(a) summary to T1 and stubs to T2", source: "s1", child: "s2",
        record: (s: string) => ({ summary: { throughPosition: 12, text: "SA" },
          stubs: { throughPosition: 23, readBack: { [`${s}-run-2`]: "RB-2" } } }),
        viewed: [summaryMessage(46, 12, "SA"), ...turnView(2, [C2], { c2: stubText("c2", C2_ARGS, 19, "RB-2") })] },
      { name: "(b) stubs only, to T2", source: "s3", child: "s4",
        record: (s: string) => ({ summary: null,
          stubs: { throughPosition: 23, readBack: { [`${s}-run-1`]: "RB-1", [`${s}-run-2`]: "RB-2" } } }),
        viewed: [...turnView(1, [C1], { c1: stubText("c1", '{"path":"a.txt"}', 8, "RB-1") }),
          ...turnView(2, [C2], { c2: stubText("c2", C2_ARGS, 19, "RB-2") })] },
    ])("K2K-11 $name", async ({ source, child, record, viewed }) => {
      const h = await viewHarness();
      await h.turn(source, 1, [C1]);
      await h.turn(source, 2, [C2]);
      await h.turn(source, 3, [{ callId: "c3", body: "ok" }]);
      await h.turn(source, 4, short(4));
      const at = await h.compact(source, { basedOnPosition: 45, outcome: "compacted", failure: null, ...record(source) });
      await h.turn(source, 5, short(5));
      expect(at).toBe(46);
      await h.temp.store.create({ sessionId: child, recordId: `session:${child}`, createdAt: K_AT }, { signal: K_SIGNAL });

      const withView = await h.restore(child, "v", { throughPosition: 34, sourceSessionId: source, viewPosition: 57 });
      expect(withoutIds(withView)).toEqual([...viewed, ...turnView(3, [{ callId: "c3", body: "ok" }]),
        { role: "user", content: "input-v" }]);
      if (source === "s1") expect(withView.messages[0]).toMatchObject({ messageId: "context-summary:s1:46" });

      const plain = await h.restore(child, "p", { throughPosition: 34, sourceSessionId: source });
      expect(withoutIds(plain)).toEqual([...turnView(1, [C1]), ...turnView(2, [C2]),
        ...turnView(3, [{ callId: "c3", body: "ok" }]), { role: "user", content: "input-p" }]);
    });
  });
});
