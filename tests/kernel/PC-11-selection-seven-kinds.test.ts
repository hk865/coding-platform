/**
 * PC-11 (K): one input with all seven removal kinds.
 *
 * The reference below is deliberately written out by hand: the unit order, the placeholder
 * replacement, the request literal for every prefix and its UTF-8 byte count are independent of
 * the production selector. Budgets sit between neighbouring prefix counts, so both the
 * step-by-step reference and the binary search must land on the same k.
 */
import { describe, expect, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
import {
  buildModelRequest,
  selectContext,
  type ContextBuilderInput,
  type ModelRequest,
  type ToolResult,
} from "../../vendor/coding-agent/dist/public-api.js";
import {
  assistantEntry,
  bytePreview,
  contextInput,
  errorEntry,
  selectionOptions,
  successEntry,
  userEntry,
} from "../helpers/PC-kernel-fixture.js";

type Entry = ContextBuilderInput["transcript"][number];
type Memory = ContextBuilderInput["memories"][number];
type Skill = ContextBuilderInput["skills"][number];
type Fragment = ContextBuilderInput["additionalInstructions"][number];

const BASE = "BASE";
const OUTPUT_CAP = 100;
const PLACEHOLDER = (tool: string, callId: string) =>
  `内容因长度省略（工具 ${tool}，调用 ${callId}），需要时重新读`;

const memories: readonly Memory[] = [
  {
    schemaVersion: 1, id: "mem-low", content: "low priority memory", priority: 1,
    source: "history", createdAt: "2026-10-22T00:00:00.000Z",
  },
  {
    schemaVersion: 1, id: "mem-high", content: "high priority memory", priority: 5,
    source: "history", createdAt: "2026-10-22T00:00:00.000Z",
  },
];
const skills: readonly Skill[] = [
  {
    schemaVersion: 1, id: "ref-skill", title: "reference", content: "REFERENCE BODY",
    kind: "reference", priority: 1, source: "host",
  },
];
const additionalInstructions: readonly Fragment[] = [
  { schemaVersion: 1, id: "instr", content: "ADDITIONAL BODY", priority: 1, source: "host" },
];

const history: readonly Entry[] = [
  userEntry("m1", "history question"),
  assistantEntry("a1", "history answer"),
  assistantEntry("a2", "", [
    { schemaVersion: 1, callId: "c2", name: "read", arguments: {} },
    { schemaVersion: 1, callId: "c3", name: "echo", arguments: {} },
    { schemaVersion: 1, callId: "c4", name: "failing", arguments: {} },
  ]),
  successEntry("c2", [{ kind: "text", text: "L".repeat(400) }]),
  successEntry("c3", [{ kind: "text", text: "ok" }]),
  errorEntry("c4", "boom"),
];
const current: readonly Entry[] = [
  userEntry("task-1", "task input"),
  assistantEntry("a5", "", [{ schemaVersion: 1, callId: "c5", name: "read", arguments: {} }]),
  successEntry("c5", [{ kind: "text", text: "five" }]),
  assistantEntry("a6", "", [{ schemaVersion: 1, callId: "c6", name: "read", arguments: {} }]),
  successEntry("c6", [{ kind: "text", text: "six" }]),
  userEntry("input-later", "later input"),
  assistantEntry("a7", "", [{ schemaVersion: 1, callId: "c7", name: "pending", arguments: {} }]),
];
const transcript: readonly Entry[] = [...history, ...current];
const historyEntryCount = history.length;

/** Hand-written removal units, in the ruling's seven-step order. */
const referenceUnits = [
  { kind: "memory", id: "mem-low" },
  { kind: "memory", id: "mem-high" },
  { kind: "skillReference", id: "ref-skill" },
  { kind: "additionalInstruction", id: "instr" },
  { kind: "toolResultBody", callId: "c2", toolName: "read" },
  { kind: "historyExchange", messageId: "m1" },
  { kind: "historyExchange", messageId: "a2", callIds: ["c2", "c3", "c4"] },
  { kind: "historyConclusion", messageId: "a1" },
  { kind: "currentExchange", messageId: "a5", callIds: ["c5"] },
  { kind: "currentExchange", messageId: "a6", callIds: ["c6"] },
] as const;
const N = referenceUnits.length;

interface ReferenceSelection {
  readonly memories: readonly Memory[];
  readonly skills: readonly Skill[];
  readonly instructions: readonly Fragment[];
  readonly transcript: readonly Entry[];
  readonly removed: Record<string, number>;
}

function referencePrefix(count: number): ReferenceSelection {
  let selectedMemories = [...memories];
  let selectedSkills = [...skills];
  let selectedInstructions = [...additionalInstructions];
  let selectedTranscript = [...transcript];
  const removed: Record<string, number> = {
    memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 0,
    historyExchange: 0, historyConclusion: 0, currentExchange: 0,
  };
  for (let index = 0; index < count; index += 1) {
    const unit = referenceUnits[index]!;
    removed[unit.kind] = (removed[unit.kind] ?? 0) + 1;
    if (unit.kind === "memory") {
      selectedMemories = selectedMemories.filter((value) => value.id !== unit.id);
    } else if (unit.kind === "skillReference") {
      selectedSkills = selectedSkills.filter((value) => value.id !== unit.id);
    } else if (unit.kind === "additionalInstruction") {
      selectedInstructions = selectedInstructions.filter((value) => value.id !== unit.id);
    } else if (unit.kind === "toolResultBody") {
      selectedTranscript = selectedTranscript.map((entry) =>
        entry.kind === "tool_result" && entry.callId === unit.callId
          ? {
              ...entry,
              result: {
                ...entry.result,
                output: [{ kind: "text" as const, text: PLACEHOLDER(unit.toolName, unit.callId) }],
              } as ToolResult,
            }
          : entry,
      );
    } else if (unit.kind === "historyConclusion") {
      selectedTranscript = selectedTranscript.filter(
        (entry) =>
          entry.kind !== "assistant_message" || entry.message.messageId !== unit.messageId,
      );
    } else if ("callIds" in unit) {
      const callIds = new Set<string>(unit.callIds);
      selectedTranscript = selectedTranscript.filter((entry) => {
        if (entry.kind === "assistant_message") return entry.message.messageId !== unit.messageId;
        if (entry.kind === "tool_result") return !callIds.has(entry.callId);
        return true;
      });
    } else {
      selectedTranscript = selectedTranscript.filter(
        (entry) => entry.kind !== "user_message" || entry.message.messageId !== unit.messageId,
      );
    }
  }
  return {
    memories: selectedMemories,
    skills: selectedSkills,
    instructions: selectedInstructions,
    transcript: selectedTranscript,
    removed,
  };
}

function section(kind: string, id: string, source: string, content: string): string {
  return `[${kind} id=${JSON.stringify(id)} source=${JSON.stringify(source)}]\n${content}`;
}

function byPriorityThenId<T extends { readonly priority: number; readonly id: string }>(
  values: readonly T[],
): T[] {
  return [...values].sort(
    (left, right) => right.priority - left.priority || left.id.localeCompare(right.id, "en"),
  );
}

function referenceRequest(count: number): ModelRequest {
  const selection = referencePrefix(count);
  const parts = [BASE];
  for (const item of byPriorityThenId(selection.instructions)) {
    parts.push(section("additional_instruction", item.id, item.source, item.content));
  }
  for (const item of byPriorityThenId(
    selection.skills.filter((value) => value.kind === "instruction"),
  )) {
    parts.push(section("skill_instruction", item.id, item.source, item.content));
  }
  for (const item of byPriorityThenId(
    selection.skills.filter((value) => value.kind === "reference"),
  )) {
    parts.push(section("reference_data", item.id, item.source, item.content));
  }
  for (const item of byPriorityThenId(selection.memories)) {
    parts.push(section("memory_data", item.id, item.source, item.content));
  }
  const messages = selection.transcript.map((entry) => {
    if (entry.kind === "user_message") {
      return { role: "user" as const, messageId: entry.message.messageId, content: entry.message.content };
    }
    if (entry.kind === "assistant_message") {
      return {
        role: "assistant" as const,
        messageId: entry.message.messageId,
        content: entry.message.content,
        ...(entry.message.reasoningContent === undefined
          ? {}
          : { reasoningContent: entry.message.reasoningContent }),
        toolCalls: entry.toolCalls,
      };
    }
    return { role: "tool" as const, callId: entry.callId, result: entry.result };
  });
  return {
    schemaVersion: 1,
    requestId: "pc-request",
    runId: "pc-run",
    systemPrompt: parts.join("\n\n"),
    messages,
    tools: [],
    maxOutputTokens: OUTPUT_CAP,
  };
}

function utf8Bytes(count: number): number {
  return Buffer.byteLength(JSON.stringify(referenceRequest(count)), "utf8");
}

/** The fixture preview counts the outgoing request plus 4,096 and reserves the output cap. */
function previewCount(count: number): number {
  return utf8Bytes(count) + 4_096 + OUTPUT_CAP;
}
function inputTokens(count: number): number {
  return utf8Bytes(count) + 4_096;
}

/** The least prefix whose preview count fits; the reference removes exactly one unit at a time. */
function stepByStepLeastFitting(window: number): number {
  for (let count = 0; count <= N; count += 1) {
    if (previewCount(count) <= window) return count;
  }
  return N + 1;
}

function windowBetween(count: number): number {
  if (count === 0) return previewCount(0);
  const window = previewCount(count - 1) - 1;
  expect(window).toBeGreaterThanOrEqual(previewCount(count));
  return window;
}

describe("PC-11 seven removal kinds", () => {
  it("binary search selects the same k as the step-by-step reference for every budget", async () => {
    for (let expectedK = 0; expectedK <= N; expectedK += 1) {
      const window = windowBetween(expectedK);
      expect(stepByStepLeastFitting(window)).toBe(expectedK);
      const expected = referencePrefix(expectedK);
      const probe = bytePreview({ window, outputCap: OUTPUT_CAP });
      const result = await selectContext(
        contextInput({
          baseSystemPrompt: BASE,
          memories,
          skills,
          additionalInstructions,
          transcript,
          tokenBudget: window,
          maxOutputTokens: OUTPUT_CAP,
        }),
        selectionOptions(
          { historyEntryCount, taskInputMessageId: "task-1", build: buildModelRequest },
          probe.previewRequest,
        ),
      );

      // The chosen request is the hand-written literal, and its own preview said it fits.
      expect(result.request).toEqual(referenceRequest(expectedK));
      expect(result.report).toEqual({
        requestId: "pc-request",
        inputTokens: inputTokens(expectedK),
        budget: window - OUTPUT_CAP,
        removed: expected.removed,
      });
      expect(result.selected.memories.map((value) => value.id))
        .toEqual(expected.memories.map((value) => value.id));
      expect(result.selected.skills.map((value) => value.id))
        .toEqual(expected.skills.map((value) => value.id));
      expect(result.selected.additionalInstructions.map((value) => value.id))
        .toEqual(expected.instructions.map((value) => value.id));
      expect(result.selected.transcript).toEqual(expected.transcript);

      const matching = probe.calls.filter(
        (call) => isDeepStrictEqual(call.request, referenceRequest(expectedK)),
      );
      expect(matching).toHaveLength(1);
      expect(matching[0]!.result.fits).toBe(true);
      expect(probe.calls.length).toBeLessThanOrEqual(2 + Math.ceil(Math.log2(N)));
      if (expectedK === 0) expect(probe.calls).toHaveLength(1);
    }
  });
});
