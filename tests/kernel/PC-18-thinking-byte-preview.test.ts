/**
 * PC-18 (K/PE4): the byte preview measures the already-filtered outgoing request.
 *
 * History holds four thinking-only assistant messages; under `current_run` all four are removed
 * before the candidate list, so they never reach a preview. The current task input and one
 * complete tool exchange are classified as current. A budget one byte under the unfiltered
 * prefix count forces the least removal (the old user message) and keeps the exchange current.
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

type Entry = ContextBuilderInput["transcript"][number];

const OUTPUT_CAP = 100;

const history: readonly Entry[] = [
  userEntry("h1", "history question"),
  assistantEntry("h2", "history conclusion"),
  assistantEntry("t1", "", [], "think-one"),
  assistantEntry("t2", "", [], "think-two"),
  assistantEntry("t3", "", [], "think-three"),
  assistantEntry("t4", "", [], "think-four"),
];
const current: readonly Entry[] = [
  userEntry("task-1", "task input"),
  assistantEntry("a1", "", [{ schemaVersion: 1, callId: "c1", name: "read", arguments: {} }]),
  successEntry("c1", [{ kind: "text", text: "R".repeat(400) }]),
];
const transcript: readonly Entry[] = [...history, ...current];
const historyEntryCount = history.length;

/** The filter removes t1..t4; prefix 1 then removes the remaining old user message h1. */
function referenceEntries(k: 0 | 1): readonly Entry[] {
  return k === 0
    ? [history[0]!, history[1]!, ...current]
    : [history[1]!, ...current];
}

function referenceRequest(k: 0 | 1): ModelRequest {
  const messages = referenceEntries(k).map((entry) => {
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
    return { role: "tool" as const, callId: entry.callId, result: entry.result };
  });
  return {
    schemaVersion: 1, requestId: "pc-request", runId: "pc-run", systemPrompt: "BASE",
    messages, tools: [], maxOutputTokens: OUTPUT_CAP,
  };
}

function requestBytes(k: 0 | 1): number {
  return Buffer.byteLength(JSON.stringify(referenceRequest(k)), "utf8");
}

function previewCount(k: 0 | 1): number {
  return requestBytes(k) + 4_096 + OUTPUT_CAP;
}

function transcriptIds(entries: readonly Entry[]): string[] {
  return entries.map((entry) =>
    entry.kind === "tool_result" ? entry.callId : entry.message.messageId);
}

describe("PC-18 byte preview after the thinking filter", () => {
  it("previews the filtered request, keeps the current exchange and removes one old user message", async () => {
    const window = previewCount(0) - 1;
    expect(window).toBeGreaterThanOrEqual(previewCount(1));

    const probe = bytePreview({ window, outputCap: OUTPUT_CAP });
    const result = await selectContext(
      contextInput({
        baseSystemPrompt: "BASE", transcript, tokenBudget: window, maxOutputTokens: OUTPUT_CAP,
      }),
      selectionOptions(
        { historyEntryCount, taskInputMessageId: "task-1", build: buildModelRequest },
        probe.previewRequest,
      ),
    );

    expect(result.request).toEqual(referenceRequest(1));
    expect(result.report).toEqual({
      requestId: "pc-request",
      inputTokens: requestBytes(1) + 4_096,
      budget: window - OUTPUT_CAP,
      removed: {
        memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 0,
        historyExchange: 1, historyConclusion: 0, currentExchange: 0,
      },
    });
    expect(transcriptIds(result.selected.transcript))
      .toEqual(["h2", "task-1", "a1", "c1"]);
    const currentResult = result.selected.transcript.find(
      (entry) => entry.kind === "tool_result" && entry.callId === "c1",
    );
    expect(currentResult).toEqual(current[2]);

    for (const call of probe.calls) {
      for (const message of call.request.messages) {
        if (message.role !== "assistant") continue;
        // t1..t4 are gone before any preview; the filtered request has no thinking at all.
        expect(message.reasoningContent).toBeUndefined();
        expect(message.content === "" && message.toolCalls.length === 0).toBe(false);
      }
    }
  });
});
