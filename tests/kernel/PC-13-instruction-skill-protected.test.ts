/**
 * PC-13 (K): protected content plus the instruction Skill cost one more than the budget.
 *
 * The instruction Skill is not a removal unit, so the fully stripped request still carries it,
 * the base prompt, the task input, the latest user message and the unclosed call. One token less
 * than that request must fail as required_content_over_budget.
 */
import { describe, expect, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
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
  userEntry,
} from "../helpers/PC-kernel-fixture.js";

type Entry = ContextBuilderInput["transcript"][number];

const BASE = "BASE";
const INSTRUCTION_SKILL = {
  schemaVersion: 1, id: "skill-i", title: "instruction", content: "INSTRUCTION BODY",
  kind: "instruction", priority: 1, source: "host",
} as const;
const REFERENCE_SKILL = {
  schemaVersion: 1, id: "skill-r", title: "reference", content: "REFERENCE BODY",
  kind: "reference", priority: 1, source: "host",
} as const;
const MEMORY = {
  schemaVersion: 1, id: "m1", content: "MEMORY BODY", priority: 1, source: "history",
  createdAt: "2026-10-22T00:00:00.000Z",
} as const;
const ADDITIONAL = {
  schemaVersion: 1, id: "i1", content: "ADDITIONAL BODY", priority: 1, source: "host",
} as const;

const transcript: readonly Entry[] = [
  userEntry("h1", "old history question"),
  assistantEntry("a1", "old history answer"),
  userEntry("task-1", "task input"),
  assistantEntry("a2", "", [{ schemaVersion: 1, callId: "c1", name: "pending", arguments: {} }]),
];

/** The fully stripped request: memory, reference Skill, additional instruction and history gone. */
const fullyStripped: ModelRequest = {
  schemaVersion: 1,
  requestId: "pc-request",
  runId: "pc-run",
  systemPrompt: `${BASE}\n\n[skill_instruction id="skill-i" source="host"]\nINSTRUCTION BODY`,
  messages: [
    { role: "user", messageId: "task-1", content: "task input" },
    {
      role: "assistant", messageId: "a2", content: "",
      toolCalls: [{ schemaVersion: 1, callId: "c1", name: "pending", arguments: {} }],
    },
  ],
  tools: [],
  maxOutputTokens: 100,
};

const fullyStrippedPreview = Buffer.byteLength(JSON.stringify(fullyStripped), "utf8") + 4_096 + 100;

function inputFor(window: number): ContextBuilderInput {
  return contextInput({
    baseSystemPrompt: BASE,
    memories: [MEMORY],
    skills: [INSTRUCTION_SKILL, REFERENCE_SKILL],
    additionalInstructions: [ADDITIONAL],
    transcript,
    tokenBudget: window,
    maxOutputTokens: 100,
  });
}

const selection = {
  historyEntryCount: 2,
  taskInputMessageId: "task-1",
  build: buildModelRequest,
} as const;

describe("PC-13 instruction Skill is protected", () => {
  it("fails with required_content_over_budget when protected content is one over", async () => {
    const probe = bytePreview({ window: fullyStrippedPreview - 1, outputCap: 100 });
    let captured: unknown;
    try {
      await selectContext(
        inputFor(fullyStrippedPreview - 1),
        selectionOptions(selection, probe.previewRequest),
      );
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(ContextSelectionError);
    expect((captured as ContextSelectionError).code).toBe("required_content_over_budget");
    // Every preview, including the fully stripped one, still carries the instruction Skill.
    expect(probe.calls.length).toBeGreaterThan(0);
    for (const call of probe.calls) {
      expect(call.request.systemPrompt).toContain(INSTRUCTION_SKILL.content);
      expect(call.request.systemPrompt).toContain(BASE);
    }
    const stripped = probe.calls.find(
      (call) => isDeepStrictEqual(call.request, fullyStripped),
    );
    expect(stripped).toBeDefined();
    expect(stripped!.request.messages).toContainEqual(
      expect.objectContaining({ role: "assistant", messageId: "a2" }),
    );
    expect(stripped!.request.messages).toContainEqual(
      { role: "user", messageId: "task-1", content: "task input" },
    );
    expect(probe.calls).toHaveLength(2);
  });

  it("fits at exactly that budget and reports the protected instruction Skill as kept", async () => {
    const probe = bytePreview({ window: fullyStrippedPreview, outputCap: 100 });
    const result = await selectContext(
      inputFor(fullyStrippedPreview),
      selectionOptions(selection, probe.previewRequest),
    );
    expect(result.request).toEqual(fullyStripped);
    expect(result.report).toEqual({
      requestId: "pc-request",
      inputTokens: fullyStrippedPreview - 100,
      budget: fullyStrippedPreview - 100,
      removed: {
        memory: 1, skillReference: 1, additionalInstruction: 1, toolResultBody: 0,
        historyExchange: 1, historyConclusion: 1, currentExchange: 0,
      },
    });
    expect(result.selected.skills.map((skill) => skill.id)).toEqual(["skill-i"]);
    expect(result.selected.memories).toEqual([]);
    expect(result.selected.additionalInstructions).toEqual([]);
    expect(result.selected.transcript.map((entry) =>
      entry.kind === "user_message" ? entry.message.messageId
        : entry.kind === "assistant_message" ? entry.message.messageId : entry.callId))
      .toEqual(["task-1", "a2"]);
  });
});
