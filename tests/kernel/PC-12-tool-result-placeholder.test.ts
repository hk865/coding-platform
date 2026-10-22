/**
 * PC-12 (K): the history tool-result body placeholder.
 *
 * Only a success result whose placeholder JSON is strictly shorter becomes a unit. Empty, short,
 * error and cancelled results stay byte-identical; both adapters keep one result id per call id.
 */
import { describe, expect, it } from "vitest";
import {
  buildModelRequest,
  selectContext,
  type ContextBuilderInput,
  type ToolResult,
} from "../../vendor/coding-agent/dist/public-api.js";
import {
  assistantEntry,
  bytePreview,
  cancelledEntry,
  contextInput,
  deepSeekCapture,
  errorEntry,
  openAICapture,
  selectionOptions,
  successEntry,
  userEntry,
} from "../helpers/PC-kernel-fixture.js";

type Entry = ContextBuilderInput["transcript"][number];
const PLACEHOLDER = "内容因长度省略（工具 read，调用 c1），需要时重新读";

const originalLong: ToolResult = {
  schemaVersion: 1, callId: "c1", status: "success",
  output: [{ kind: "text", text: "L".repeat(400) }],
  effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
};
const originalEmpty: ToolResult = {
  schemaVersion: 1, callId: "c2", status: "success", output: [],
  effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
};
const originalShort: ToolResult = {
  schemaVersion: 1, callId: "c3", status: "success", output: [{ kind: "text", text: "ok" }],
  effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
};
const originalError: ToolResult = {
  schemaVersion: 1, callId: "c4", status: "error",
  error: { code: "execution_failed", message: "boom", retryable: false },
  output: [{ kind: "text", text: "error body" }],
  effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
};
const originalCancelled: ToolResult = {
  schemaVersion: 1, callId: "c5", status: "cancelled", reason: "cancelled by caller",
  output: [{ kind: "text", text: "cancelled body" }],
  effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
};

const transcript: readonly Entry[] = [
  userEntry("h1", "history question"),
  assistantEntry("a1", "", [
    { schemaVersion: 1, callId: "c1", name: "read", arguments: {} },
    { schemaVersion: 1, callId: "c2", name: "read", arguments: {} },
    { schemaVersion: 1, callId: "c3", name: "read", arguments: {} },
    { schemaVersion: 1, callId: "c4", name: "read", arguments: {} },
    { schemaVersion: 1, callId: "c5", name: "read", arguments: {} },
  ]),
  { kind: "tool_result", callId: "c1", result: originalLong },
  { kind: "tool_result", callId: "c2", result: originalEmpty },
  { kind: "tool_result", callId: "c3", result: originalShort },
  { kind: "tool_result", callId: "c4", result: originalError },
  { kind: "tool_result", callId: "c5", result: originalCancelled },
  userEntry("task-1", "task input"),
];
const historyEntryCount = 7;

function referenceRequest(k: 0 | 1): ReturnType<typeof buildModelRequest> {
  const results = transcript.filter((entry) => entry.kind === "tool_result").map((entry) => {
    if (entry.kind !== "tool_result") throw new Error("unreachable");
    if (k === 1 && entry.callId === "c1") {
      return {
        ...entry,
        result: {
          ...entry.result,
          output: [{ kind: "text" as const, text: PLACEHOLDER }],
        } as ToolResult,
      };
    }
    return entry;
  });
  const messages = [
    { role: "user" as const, messageId: "h1", content: "history question" },
    {
      role: "assistant" as const,
      messageId: "a1",
      content: "",
      toolCalls: transcript[1]!.kind === "assistant_message" ? transcript[1]!.toolCalls : [],
    },
    ...results.map((entry) => {
      if (entry.kind !== "tool_result") throw new Error("unreachable");
      return { role: "tool" as const, callId: entry.callId, result: entry.result };
    }),
    { role: "user" as const, messageId: "task-1", content: "task input" },
  ];
  return {
    schemaVersion: 1, requestId: "pc-request", runId: "pc-run", systemPrompt: "BASE",
    messages, tools: [], maxOutputTokens: 100,
  };
}

function previewCount(k: 0 | 1): number {
  return Buffer.byteLength(JSON.stringify(referenceRequest(k)), "utf8") + 4_096 + 100;
}

function bodyMessages(body: Record<string, unknown>): Array<Record<string, unknown>> {
  return body["messages"] as Array<Record<string, unknown>>;
}
function inputItems(body: Record<string, unknown>): Array<Record<string, unknown>> {
  return body["input"] as Array<Record<string, unknown>>;
}

async function selectLongOutput() {
  const window = previewCount(0) - 1;
  expect(window).toBeGreaterThanOrEqual(previewCount(1));
  const probe = bytePreview({ window, outputCap: 100 });
  return selectContext(
    contextInput({
      baseSystemPrompt: "BASE", transcript, tokenBudget: window, maxOutputTokens: 100,
    }),
    selectionOptions(
      { historyEntryCount, taskInputMessageId: "task-1", build: buildModelRequest },
      probe.previewRequest,
    ),
  );
}

describe("PC-12 tool-result placeholder", () => {
  it("replaces exactly the long success output and leaves every other result untouched", async () => {
    const result = await selectLongOutput();

    expect(result.report.removed).toEqual({
      memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 1,
      historyExchange: 0, historyConclusion: 0, currentExchange: 0,
    });
    const selected = result.selected.transcript.filter(
      (entry) => entry.kind === "tool_result",
    );
    expect(selected).toHaveLength(5);
    const byCall = new Map<string, ToolResult>();
    for (const entry of selected) {
      if (entry.kind === "tool_result") byCall.set(entry.callId, entry.result);
    }
    const long = byCall.get("c1")!;
    expect(long.output).toEqual([{ kind: "text", text: PLACEHOLDER }]);
    const { output: _longOutput, ...longRest } = long;
    const { output: _originalOutput, ...originalLongRest } = originalLong;
    expect(longRest).toEqual(originalLongRest);
    expect(byCall.get("c2")).toEqual(originalEmpty);
    expect(byCall.get("c3")).toEqual(originalShort);
    expect(byCall.get("c4")).toEqual(originalError);
    expect(byCall.get("c5")).toEqual(originalCancelled);
    expect(result.request).toEqual(referenceRequest(1));
  });

  it("both adapter bodies keep every call id matched by exactly one result id", async () => {
    const request = (await selectLongOutput()).request;
    const deepseek = deepSeekCapture([{ text: "ok" }]);
    for await (const _event of deepseek.client.stream(request, {
      signal: new AbortController().signal,
    })) {
      // consume the adapter's completion
    }
    const openai = openAICapture([{ text: "ok" }]);
    for await (const _event of openai.client.stream(request, {
      signal: new AbortController().signal,
    })) {
      // consume the adapter's completion
    }

    const callIds = ["c1", "c2", "c3", "c4", "c5"];
    const deepseekMessages = bodyMessages(deepseek.bodies[0]!);
    const deepseekCalls = deepseekMessages
      .filter((message) => message["role"] === "assistant")
      .flatMap((message) => (message["tool_calls"] as Array<Record<string, unknown>>)
        .map((call) => call["id"]));
    const deepseekResults = deepseekMessages
      .filter((message) => message["role"] === "tool")
      .map((message) => message["tool_call_id"]);
    expect(deepseekCalls).toEqual(callIds);
    expect(deepseekResults).toEqual(callIds);
    const placeholderTool = deepseekMessages.find((message) => message["tool_call_id"] === "c1");
    expect(JSON.parse(placeholderTool!["content"] as string).output[0].text).toBe(PLACEHOLDER);

    const openaiItems = inputItems(openai.bodies[0]!);
    const openaiCalls = openaiItems
      .filter((item) => item["type"] === "function_call")
      .map((item) => item["call_id"]);
    const openaiResults = openaiItems
      .filter((item) => item["type"] === "function_call_output")
      .map((item) => item["call_id"]);
    expect(openaiCalls).toEqual(callIds);
    expect(openaiResults).toEqual(callIds);
    const openaiPlaceholder = openaiItems.find((item) => item["call_id"] === "c1"
      && item["type"] === "function_call_output");
    expect(JSON.parse(openaiPlaceholder!["output"] as string).output[0].text).toBe(PLACEHOLDER);
  });
});

const ELIGIBLE_CAP = 100;
const eligiblePlaceholder = (tool: string, callId: string): string =>
  `内容因长度省略（工具 ${tool}，调用 ${callId}），需要时重新读`;

function toolCall(callId: string, name = "read") {
  return { schemaVersion: 1 as const, callId, name, arguments: {} };
}

function emptyRemoved(toolResultBody = 0) {
  return {
    memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody,
    historyExchange: 0, historyConclusion: 0, currentExchange: 0,
  };
}

function resultsByCall(transcript: readonly Entry[]): Map<string, ToolResult> {
  const byCall = new Map<string, ToolResult>();
  for (const entry of transcript) {
    if (entry.kind === "tool_result") byCall.set(entry.callId, entry.result);
  }
  return byCall;
}

/**
 * The expected request is written from the input transcript plus the callIds whose body the
 * test says must be replaced. Nothing here reads the request the production selector built.
 */
function eligibleRequest(
  transcript: readonly Entry[],
  replacements: ReadonlyMap<string, string>,
): ReturnType<typeof buildModelRequest> {
  const messages = transcript.map((entry) => {
    if (entry.kind === "user_message") {
      return { role: "user" as const, messageId: entry.message.messageId, content: entry.message.content };
    }
    if (entry.kind === "assistant_message") {
      return {
        role: "assistant" as const,
        messageId: entry.message.messageId,
        content: entry.message.content,
        toolCalls: entry.toolCalls,
      };
    }
    const replacement = replacements.get(entry.callId);
    const result = replacement === undefined
      ? entry.result
      : ({
          ...entry.result,
          output: [{ kind: "text" as const, text: replacement }],
        } as ToolResult);
    return { role: "tool" as const, callId: entry.callId, result };
  });
  return {
    schemaVersion: 1, requestId: "pc-request", runId: "pc-run", systemPrompt: "BASE",
    messages, tools: [], maxOutputTokens: ELIGIBLE_CAP,
  };
}

function requestBytes(request: ReturnType<typeof buildModelRequest>): number {
  return Buffer.byteLength(JSON.stringify(request), "utf8");
}

async function eligibleSelection(
  transcript: readonly Entry[],
  historyEntryCount: number,
  replacements: ReadonlyMap<string, string>,
) {
  const before = requestBytes(eligibleRequest(transcript, new Map()));
  const expected = eligibleRequest(transcript, replacements);
  const expectedCount = requestBytes(expected) + 4_096 + ELIGIBLE_CAP;
  const window = before + 4_096 + ELIGIBLE_CAP - 1;
  expect(window).toBeGreaterThanOrEqual(expectedCount);

  const probe = bytePreview({ window, outputCap: ELIGIBLE_CAP });
  const result = await selectContext(
    contextInput({
      baseSystemPrompt: "BASE", transcript, tokenBudget: window, maxOutputTokens: ELIGIBLE_CAP,
    }),
    selectionOptions(
      { historyEntryCount, taskInputMessageId: "task-1", build: buildModelRequest },
      probe.previewRequest,
    ),
  );
  return {
    result,
    expected,
    report: {
      requestId: "pc-request",
      inputTokens: requestBytes(expected) + 4_096,
      budget: window - ELIGIBLE_CAP,
      removed: emptyRemoved(1),
    },
  };
}

describe("PC-12 hand-computed eligibility cases", () => {
  it("keeps long error and cancelled results before the replaceable success", async () => {
    const transcript: readonly Entry[] = [
      assistantEntry("a-state", "", [toolCall("e1"), toolCall("x1"), toolCall("s1")]),
      errorEntry("e1", "boom", [{ kind: "text", text: "E".repeat(300) }]),
      cancelledEntry("x1", "stopped", [{ kind: "text", text: "C".repeat(300) }]),
      successEntry("s1", [{ kind: "text", text: "S".repeat(400) }]),
      userEntry("task-1", "task input"),
    ];
    const { result, expected, report } = await eligibleSelection(
      transcript, 4, new Map([["s1", eligiblePlaceholder("read", "s1")]]),
    );
    const originals = resultsByCall(transcript);
    const selected = resultsByCall(result.selected.transcript);

    expect(result.request).toEqual(expected);
    expect(result.report).toEqual(report);
    expect(selected.get("e1")).toEqual(originals.get("e1"));
    expect(selected.get("x1")).toEqual(originals.get("x1"));
    const replaced = selected.get("s1")!;
    expect(replaced.output).toEqual([{ kind: "text", text: eligiblePlaceholder("read", "s1") }]);
    const { output: _replacedOutput, ...replacedRest } = replaced;
    const { output: _originalOutput, ...originalRest } = originals.get("s1")!;
    expect(replacedRest).toEqual(originalRest);
  });

  it("keeps an output exactly as long as the placeholder (strict <, not <=)", async () => {
    const equalBytes = "a".repeat(Buffer.byteLength(eligiblePlaceholder("read", "q1"), "utf8"));
    expect(Buffer.byteLength(JSON.stringify([{ kind: "text", text: equalBytes }]), "utf8"))
      .toBe(Buffer.byteLength(
        JSON.stringify([{ kind: "text", text: eligiblePlaceholder("read", "q1") }]), "utf8",
      ));
    const transcript: readonly Entry[] = [
      assistantEntry("a-equal", "", [toolCall("q1")]),
      successEntry("q1", [{ kind: "text", text: equalBytes }]),
      assistantEntry("a-long", "", [toolCall("q2")]),
      successEntry("q2", [{ kind: "text", text: "L".repeat(400) }]),
      userEntry("task-1", "task input"),
    ];
    const { result, expected, report } = await eligibleSelection(
      transcript, 4, new Map([["q2", eligiblePlaceholder("read", "q2")]]),
    );
    const originals = resultsByCall(transcript);
    const selected = resultsByCall(result.selected.transcript);

    expect(result.request).toEqual(expected);
    expect(result.report).toEqual(report);
    expect(selected.get("q1")).toEqual(originals.get("q1"));
    const replaced = selected.get("q2")!;
    expect(replaced.output).toEqual([{ kind: "text", text: eligiblePlaceholder("read", "q2") }]);
    const { output: _replacedOutput, ...replacedRest } = replaced;
    const { output: _originalOutput, ...originalRest } = originals.get("q2")!;
    expect(replacedRest).toEqual(originalRest);
  });

  it("measures UTF-8 bytes, not characters, at the placeholder length", async () => {
    const multibyte = "中".repeat(29);
    expect(multibyte.length).toBe(29);
    expect(Buffer.byteLength(multibyte, "utf8")).toBe(87);
    expect(Buffer.byteLength(eligiblePlaceholder("read", "m1"), "utf8")).toBe(71);
    const transcript: readonly Entry[] = [
      assistantEntry("a-multibyte", "", [toolCall("m1")]),
      successEntry("m1", [{ kind: "text", text: multibyte }]),
      userEntry("task-1", "task input"),
    ];
    const { result, expected, report } = await eligibleSelection(
      transcript, 2, new Map([["m1", eligiblePlaceholder("read", "m1")]]),
    );
    const originals = resultsByCall(transcript);
    const selected = resultsByCall(result.selected.transcript);

    expect(result.request).toEqual(expected);
    expect(result.report).toEqual(report);
    expect(selected.get("m1")!.output)
      .toEqual([{ kind: "text", text: eligiblePlaceholder("read", "m1") }]);
    const { output: _replacedOutput, ...replacedRest } = selected.get("m1")!;
    const { output: _originalOutput, ...originalRest } = originals.get("m1")!;
    expect(replacedRest).toEqual(originalRest);
  });

  it("carries a tool name other than read and the real call id", async () => {
    const transcript: readonly Entry[] = [
      assistantEntry("a-grep", "", [toolCall("g1", "grep")]),
      successEntry("g1", [{ kind: "text", text: "G".repeat(400) }]),
      userEntry("task-1", "task input"),
    ];
    const { result, expected, report } = await eligibleSelection(
      transcript, 2, new Map([["g1", eligiblePlaceholder("grep", "g1")]]),
    );
    const originals = resultsByCall(transcript);
    const selected = resultsByCall(result.selected.transcript);

    expect(result.request).toEqual(expected);
    expect(result.report).toEqual(report);
    expect(selected.get("g1")!.output)
      .toEqual([{ kind: "text", text: eligiblePlaceholder("grep", "g1") }]);
    const { output: _replacedOutput, ...replacedRest } = selected.get("g1")!;
    const { output: _originalOutput, ...originalRest } = originals.get("g1")!;
    expect(replacedRest).toEqual(originalRest);
  });

  it("never makes a partly closed group's result a unit", async () => {
    const transcript: readonly Entry[] = [
      assistantEntry("a-part", "", [toolCall("p1"), toolCall("p2")]),
      successEntry("p1", [{ kind: "text", text: "P".repeat(400) }]),
      assistantEntry("a-full", "", [toolCall("p3")]),
      successEntry("p3", [{ kind: "text", text: "Q".repeat(300) }]),
      userEntry("task-1", "task input"),
    ];
    const { result, expected, report } = await eligibleSelection(
      transcript, 4, new Map([["p3", eligiblePlaceholder("read", "p3")]]),
    );
    const originals = resultsByCall(transcript);
    const selected = resultsByCall(result.selected.transcript);

    expect(result.request).toEqual(expected);
    expect(result.report).toEqual(report);
    expect(selected.get("p1")).toEqual(originals.get("p1"));
    const replaced = selected.get("p3")!;
    expect(replaced.output).toEqual([{ kind: "text", text: eligiblePlaceholder("read", "p3") }]);
    const { output: _replacedOutput, ...replacedRest } = replaced;
    const { output: _originalOutput, ...originalRest } = originals.get("p3")!;
    expect(replacedRest).toEqual(originalRest);
  });
});
