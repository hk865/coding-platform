/**
 * CTXFIT (K): the latest closed current exchange is not a removal unit. When every
 * earlier unit is gone and the request still exceeds the budget, the selector truncates
 * that exchange's results to the longest fitting prefix, on a character boundary, and
 * says how many bytes it kept. The expected requests below are written out by hand.
 */
import { describe, expect, it } from "vitest";
import {
  buildModelRequest,
  selectContext,
  type ContextBuilderInput,
  type ModelRequest,
} from "../../vendor/coding-agent/dist/public-api.js";
import {
  assistantEntry,
  bytePreview,
  contextInput,
  selectionOptions,
  successEntry,
  userEntry,
} from "../helpers/PC-kernel-fixture.js";

const BASE = "BASE";
const OUTPUT_CAP = 100;
const ORIGINAL = "L".repeat(2_000);
const CALL = { schemaVersion: 1 as const, callId: "c5", name: "read", arguments: {} };

const note = (kept: number, total: number) =>
  `结果过长，本次上下文只放得下前 ${kept} 字节（原 ${total} 字节）；需要其余部分请缩小范围或分页再读`;

function expectedRequest(tail: string | null): ModelRequest {
  const messages: ModelRequest["messages"] = tail === null ? [
    { role: "user", messageId: "task-1", content: "task input" },
  ] : [
    { role: "user", messageId: "task-1", content: "task input" },
    { role: "assistant", messageId: "a5", content: "", toolCalls: [CALL] },
    { role: "tool", callId: "c5", result: {
      schemaVersion: 1, callId: "c5", status: "success",
      output: [{ kind: "text", text: tail }],
      effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    } },
  ];
  return {
    schemaVersion: 1, requestId: "pc-request", runId: "pc-run", systemPrompt: BASE,
    messages, tools: [], maxOutputTokens: OUTPUT_CAP,
  };
}

const bytes = (value: ModelRequest): number => Buffer.byteLength(JSON.stringify(value), "utf8");
const ascii = (cap: number) => expectedRequest(`${ORIGINAL.slice(0, cap)}\n${note(cap, ORIGINAL.length)}`);

const full: ContextBuilderInput = contextInput({
  baseSystemPrompt: BASE,
  memories: [{ schemaVersion: 1, id: "mem", content: "memory", priority: 1,
    source: "history", createdAt: "2026-10-22T00:00:00.000Z" }],
  transcript: [
    userEntry("task-1", "task input"),
    assistantEntry("a5", "", [CALL]),
    successEntry("c5", [{ kind: "text", text: ORIGINAL }]),
  ],
  tokenBudget: 100_000, maxOutputTokens: OUTPUT_CAP,
});

async function selectAt(window: number, input: ContextBuilderInput = full) {
  const probe = bytePreview({ window, outputCap: OUTPUT_CAP });
  return selectContext({ ...input, tokenBudget: window }, selectionOptions(
    { historyEntryCount: 0, taskInputMessageId: "task-1", build: buildModelRequest },
    probe.previewRequest,
  ));
}

function tailText(result: Awaited<ReturnType<typeof selectAt>>): string {
  type Message = ModelRequest["messages"][number];
  const tool = result.request.messages.find(
    (message): message is Extract<Message, { role: "tool" }> =>
      message.role === "tool" && message.callId === "c5",
  );
  expect(tool?.result.status).toBe("success");
  expect(result.request.messages.map((message) =>
    message.role === "tool" ? message.callId : message.messageId,
  )).toEqual(["task-1", "a5", "c5"]);
  const part = tool?.result.output[0];
  return part?.kind === "text" ? part.text : "";
}

describe("CTXFIT latest-exchange truncation", () => {
  it("keeps the latest closed exchange and truncates it to the largest fitting cap", async () => {
    const cap = 500;
    const window = bytes(ascii(cap)) + 4_096 + OUTPUT_CAP;
    expect(bytes(ascii(cap + 1)) + 4_096 + OUTPUT_CAP).toBeGreaterThan(window);
    const result = await selectAt(window);
    expect(result.request).toEqual(ascii(cap));
    expect(tailText(result)).toBe(`${ORIGINAL.slice(0, cap)}\n${note(cap, ORIGINAL.length)}`);
    expect(result.report).toEqual({
      requestId: "pc-request", inputTokens: bytes(ascii(cap)) + 4_096, budget: window - OUTPUT_CAP,
      removed: { memory: 1, skillReference: 0, additionalInstruction: 0,
        toolResultBody: 1, historyExchange: 0, historyConclusion: 0, currentExchange: 0 },
    });
  });

  it("does not split a multi-byte character and reports the bytes kept", async () => {
    const original = "😀".repeat(100);
    const expected = `${"😀".repeat(2)}\n${note(8, 400)}`;
    const eleven = expectedRequest(expected);
    const twelve = expectedRequest(`${"😀".repeat(3)}\n${note(12, 400)}`);
    const window = bytes(eleven) + 4_096 + OUTPUT_CAP;
    expect(bytes(twelve) + 4_096 + OUTPUT_CAP).toBeGreaterThan(window);
    const input: ContextBuilderInput = { ...full, transcript: [
      userEntry("task-1", "task input"), assistantEntry("a5", "", [CALL]),
      successEntry("c5", [{ kind: "text", text: original }]),
    ] };
    const result = await selectAt(window, input);
    expect(result.request).toEqual(eleven);
    expect(tailText(result)).toBe(expected);
  });

  it("keeps whole characters when the largest fitting cap falls inside one", async () => {
    // The fitting cap is 10 (not a multiple of 3); U+20000 (CJK Ext B, 4 bytes) makes its hard
    // cut keep 10 bytes, where a 3-byte-only tail's U+FFFD would also be 3 bytes and hide it.
    const original = `汉汉a${"𠀀".repeat(100)}`;
    const kept = "汉汉a";
    const total = Buffer.byteLength(original, "utf8");
    const next = `${kept}𠀀\n${note(11, total)}`;
    const window = bytes(expectedRequest(next)) + 4_096 + OUTPUT_CAP - 1;
    const input: ContextBuilderInput = { ...full, transcript: [
      userEntry("task-1", "task input"), assistantEntry("a5", "", [CALL]),
      successEntry("c5", [{ kind: "text", text: original }]),
    ] };
    const result = await selectAt(window, input);
    const expected = `${kept}\n${note(7, total)}`;
    expect(result.request).toEqual(expectedRequest(expected));
    expect(tailText(result)).toBe(expected);
    expect(Buffer.from(expected, "utf8").toString("utf8")).toBe(expected);
    expect(expected).not.toContain("\uFFFD");
    expect(Buffer.byteLength(kept, "utf8")).toBe(7);
  });

  it("still fails clearly when even the empty result does not fit", async () => {
    const empty = expectedRequest(`\n${note(0, ORIGINAL.length)}`);
    const plain = expectedRequest(null);
    const window = bytes(plain) + 4_096 + OUTPUT_CAP;
    expect(bytes(empty)).toBeGreaterThan(bytes(plain));
    await expect(selectAt(window)).rejects.toMatchObject({
      code: "required_content_over_budget",
    });
  });
});
