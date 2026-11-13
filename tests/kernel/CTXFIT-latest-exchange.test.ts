/**
 * CTXFIT (K): the latest tool exchange is kept and its result truncated, never dropped whole.
 *
 * Ruling: lead 11-13 `next1113-lead-rulings.md:93-97` (take b) and the start draft
 * `ctxfit-start-rulings-draft.md:69-75`. The tail is the one closed current exchange whose results
 * run to the end of the transcript. Before either `required_content_over_budget` throw (there is no
 * removal unit at all, or every unit is gone and the request still does not fit), the tail's result
 * bodies are truncated to the longest common prefix `c` in bytes, each followed by the truncation
 * line; the truncation is counted in `removed.toolResultBody`; a `c = 0` request that still does not
 * fit fails with `required_content_over_budget`.
 *
 * Today the dist selector still lists the tail as an ordinary `currentExchange` and deletes the
 * call and its results together, so row 1 (both entries) and row 2 are red at the request literal
 * (the tail is absent) and row 3 is red because the run resolves where it must reject. They go
 * green once the patch lands and `build-kernel-patch --write` regenerates the dist.
 *
 * Named mutation per row (to run on the patched tree):
 * 1. revert the step-7 tail skip (tail again a `currentExchange` unit) -> the request lacks a6/c6.
 * 2. truncate but do not add to `removed.toolResultBody` -> the report count drops to 0.
 * 3. fall back to deleting the tail when `c = 0` does not fit -> the run resolves instead of rejecting.
 */
import { describe, expect, it } from "vitest";
import {
  ContextSelectionError,
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

type Entry = ContextBuilderInput["transcript"][number];

const BASE = "BASE";
const OUTPUT_CAP = 100;
const NOTE = (c: number, original: number) =>
  `结果过长，本次上下文只放得下前 ${c} 字节（原 ${original} 字节）；需要其余部分请缩小范围或分页再读`;

interface TailCall {
  readonly callId: string;
  readonly name: string;
  readonly text: string;
}

/** A single-text output truncated to `c` bytes plus the ruling's truncation line. */
function truncated(call: TailCall, c: number): { kind: "text"; text: string }[] {
  return [{ kind: "text", text: `${call.text.slice(0, c)}\n${NOTE(c, call.text.length)}` }];
}

/** The hand-written fully stripped request with the tail kept and each result capped at `caps[i]`. */
function tailRequest(tail: readonly TailCall[], caps: readonly number[]): ModelRequest {
  return {
    schemaVersion: 1,
    requestId: "pc-request",
    runId: "pc-run",
    systemPrompt: BASE,
    messages: [
      { role: "user", messageId: "task-1", content: "task input" },
      {
        role: "assistant", messageId: "a6", content: "",
        toolCalls: tail.map((call) => ({
          schemaVersion: 1, callId: call.callId, name: call.name, arguments: {},
        })),
      },
      ...tail.map((call, index) => ({
        role: "tool" as const,
        callId: call.callId,
        result: {
          schemaVersion: 1 as const,
          callId: call.callId,
          status: "success" as const,
          output: truncated(call, caps[index]!),
          effects: {
            sideEffect: "none" as const, changedPaths: [], workspaceRevision: null, artifactRefs: [],
          },
        },
      })),
    ],
    tools: [],
    maxOutputTokens: OUTPUT_CAP,
  };
}

/** The hand-written request after every removal unit is gone and the tail is deleted (today's k=N). */
const tailDeleted: ModelRequest = {
  schemaVersion: 1, requestId: "pc-request", runId: "pc-run", systemPrompt: BASE,
  messages: [{ role: "user", messageId: "task-1", content: "task input" }],
  tools: [], maxOutputTokens: OUTPUT_CAP,
};

/** The fixture preview counts JSON bytes plus 4,096, then reserves the 100-token output cap. */
function previewCount(request: ModelRequest): number {
  return Buffer.byteLength(JSON.stringify(request), "utf8") + 4_096 + OUTPUT_CAP;
}

function run(transcript: readonly Entry[], historyEntryCount: number, window: number) {
  const probe = bytePreview({ window, outputCap: OUTPUT_CAP });
  return selectContext(
    contextInput({
      baseSystemPrompt: BASE, transcript, tokenBudget: window, maxOutputTokens: OUTPUT_CAP,
    }),
    selectionOptions(
      { historyEntryCount, taskInputMessageId: "task-1", build: buildModelRequest },
      probe.previewRequest,
    ),
  );
}

const history: readonly Entry[] = [userEntry("m1", "history question")];
const earlierExchange: readonly Entry[] = [
  assistantEntry("a5", "", [{ schemaVersion: 1, callId: "c5", name: "read", arguments: {} }]),
  successEntry("c5", [{ kind: "text", text: "five" }]),
];
const tailEntries = (tail: readonly TailCall[]): readonly Entry[] => [
  assistantEntry("a6", "", tail.map((call) => ({
    schemaVersion: 1, callId: call.callId, name: call.name, arguments: {},
  }))),
  ...tail.map((call) => successEntry(call.callId, [{ kind: "text", text: call.text }])),
];
const head = (tail: readonly Entry[]): readonly Entry[] =>
  [...history, userEntry("task-1", "task input"), ...earlierExchange, ...tail];

describe("CTXFIT latest exchange", () => {
  const tail = [{ callId: "c6", name: "read", text: "x".repeat(1_000) }];
  const expected = tailRequest(tail, [200]);
  // The window sits strictly between the preview counts of c = 200 and c = 201.
  const window = previewCount(tailRequest(tail, [201])) - 1;

  it.each([
    { where: "with no removal units", historyEntryCount: 0, historyExchange: 0, currentExchange: 0 },
    { where: "after every earlier unit is removed", historyEntryCount: 1, historyExchange: 1, currentExchange: 1 },
  ])("keeps the latest closed exchange and truncates its result $where", async (scenario) => {
    expect(window).toBeGreaterThanOrEqual(previewCount(expected));
    expect(window).toBeLessThan(previewCount(tailRequest(tail, [201])));
    const transcript = scenario.historyEntryCount === 0
      ? [userEntry("task-1", "task input"), ...tailEntries(tail)]
      : head(tailEntries(tail));

    const result = await run(transcript, scenario.historyEntryCount, window);

    expect(result.request).toEqual(expected);
    expect(result.request.messages).toContainEqual(expect.objectContaining({
      role: "tool", callId: "c6", result: expect.objectContaining({ callId: "c6" }),
    }));
    expect(result.request.messages).toContainEqual(expect.objectContaining({
      role: "assistant", messageId: "a6",
    }));
    expect(result.report).toEqual({
      requestId: "pc-request",
      inputTokens: previewCount(expected) - OUTPUT_CAP,
      budget: window - OUTPUT_CAP,
      removed: {
        memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 1,
        historyExchange: scenario.historyExchange, historyConclusion: 0,
        currentExchange: scenario.currentExchange,
      },
    });
    expect(result.selected.transcript.map((entry) =>
      entry.kind === "user_message" ? entry.message.messageId
        : entry.kind === "assistant_message" ? entry.message.messageId : entry.callId))
      .toEqual(["task-1", "a6", "c6"]);
  });

  it("counts every truncated tail result in toolResultBody and states the byte cap", async () => {
    const two = [
      { callId: "c6", name: "read", text: "y".repeat(600) },
      { callId: "c7", name: "read", text: "z".repeat(900) },
    ];
    const expected = tailRequest(two, [150, 150]);
    const window = previewCount(tailRequest(two, [151, 151])) - 1;
    expect(window).toBeGreaterThanOrEqual(previewCount(expected));

    const result = await run(head(tailEntries(two)), 1, window);

    expect(result.request).toEqual(expected);
    const outputs = result.request.messages.flatMap((message) =>
      message.role === "tool" ? message.result.output : []);
    expect(outputs).toEqual([
      { kind: "text", text: `${"y".repeat(150)}\n${NOTE(150, 600)}` },
      { kind: "text", text: `${"z".repeat(150)}\n${NOTE(150, 900)}` },
    ]);
    expect(result.report.removed).toEqual({
      memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 2,
      historyExchange: 1, historyConclusion: 0, currentExchange: 1,
    });
  });

  it("fails as required_content_over_budget when even the empty tail prefix does not fit", async () => {
    // The old all-units prefix (tail deleted) fits; the kept tail truncated to zero bytes does not.
    const budget = previewCount(tailDeleted);
    expect(budget).toBeLessThan(previewCount(tailRequest(tail, [0])));

    const select = run(head(tailEntries(tail)), 1, budget);

    await expect(select).rejects.toBeInstanceOf(ContextSelectionError);
    await expect(select).rejects.toMatchObject({ code: "required_content_over_budget" });
  });
});
