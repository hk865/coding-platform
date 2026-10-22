/**
 * PC-17 (K): thinking is filtered only from the outgoing copy.
 *
 * Part 1 uses three real runs on one Session: run 1 ends thinking-only, run 2 text plus thinking,
 * run 3 calls plus thinking and then a second request in the same run. `current_run` keeps only
 * run 3's current thinking; `none` sends no thinking at all; the public history read keeps every
 * original choice. Part 2 reaches the current thinking-only case through selectContext (a real run
 * never sends one, because a reply without calls ends the run) and checks both adapters' bodies.
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
  contextInput,
  createKernelHarness,
  deepSeekCapture,
  fixtureTool,
  fixedCountPreview,
  openAICapture,
  selectionOptions,
  userEntry,
} from "../helpers/PC-kernel-fixture.js";
import { successResult } from "../helpers/orchestration-fixture.js";

type AssistantMessage = Extract<
  ModelRequest["messages"][number],
  { readonly role: "assistant" }
>;

function assistantParts(request: ModelRequest): AssistantMessage[] {
  return request.messages.filter(
    (message): message is AssistantMessage => message.role === "assistant",
  );
}

function transcriptIds(transcript: ContextBuilderInput["transcript"]): string[] {
  return transcript.map((entry) =>
    entry.kind === "tool_result" ? entry.callId : entry.message.messageId);
}

async function realRuns(replay: "current_run" | "none") {
  const echo = fixtureTool("echo", async (call) => successResult(call.callId, "echo ok"));
  return createKernelHarness(
    [
      { reasoningContent: "think-one" },
      { text: "answer-two", reasoningContent: "think-two" },
      {
        toolCalls: [{ callId: "call-three", name: "echo", arguments: {} }],
        reasoningContent: "think-three",
      },
      { text: "answer-three" },
    ],
    { reasoningReplay: replay, tools: [echo] },
  );
}

describe("PC-17 thinking replay", () => {
  it("current_run: run 3's second request carries current thinking only", async () => {
    const harness = await realRuns("current_run");
    try {
      expect((await harness.run("run one")).state.status).toBe("completed");
      expect((await harness.run("run two")).state.status).toBe("completed");
      expect((await harness.run("run three")).state.status).toBe("completed");
      expect(harness.model.requests).toHaveLength(4);

      const assistants = assistantParts(harness.model.requests[3]!);
      expect(assistants.map((message) => [message.content, message.reasoningContent])).toEqual([
        ["answer-two", undefined],
        ["", "think-three"],
      ]);
      expect("reasoningContent" in assistants[0]!).toBe(false);
      expect(assistants[1]!.toolCalls.map((call) => call.callId)).toEqual(["call-three"]);
      expect(assistants.some((message) =>
        message.content === "" && message.toolCalls.length === 0)).toBe(false);

      const reasoning: (string | undefined)[] = [];
      for (const record of await harness.readHistory()) {
        if (record.recordType !== "agent.event") continue;
        const event = record.payload.event;
        if (event.type !== "assistant.message_completed") continue;
        reasoning.push(event.payload.message.reasoningContent);
      }
      expect(reasoning.filter((value) => value !== undefined))
        .toEqual(["think-one", "think-two", "think-three"]);
    } finally {
      await harness.close();
    }
  });

  it("none: no thinking is sent, while run 3's calls message stays", async () => {
    const harness = await realRuns("none");
    try {
      expect((await harness.run("run one")).state.status).toBe("completed");
      expect((await harness.run("run two")).state.status).toBe("completed");
      const third = await harness.run("run three");
      expect(third.state.status).toBe("completed");
      expect(harness.model.requests).toHaveLength(4);

      const kept = third.state.transcript.filter(
        (entry) => entry.kind === "assistant_message"
          && entry.message.reasoningContent === "think-three",
      );
      expect(kept).toHaveLength(1);
      if (kept[0]?.kind === "assistant_message") {
        expect(kept[0].message.content).toBe("");
        expect(kept[0].toolCalls.map((call) => call.callId)).toEqual(["call-three"]);
      }

      const assistants = assistantParts(harness.model.requests[3]!);
      expect(assistants.map((message) => message.content)).toEqual(["answer-two", ""]);
      for (const message of assistants) {
        expect("reasoningContent" in message).toBe(false);
      }
      expect(assistants[1]!.toolCalls.map((call) => call.callId)).toEqual(["call-three"]);

      const reasoning: (string | undefined)[] = [];
      for (const record of await harness.readHistory()) {
        if (record.recordType !== "agent.event") continue;
        const event = record.payload.event;
        if (event.type !== "assistant.message_completed") continue;
        reasoning.push(event.payload.message.reasoningContent);
      }
      expect(reasoning.filter((value) => value !== undefined))
        .toEqual(["think-one", "think-two", "think-three"]);
    } finally {
      await harness.close();
    }
  });

  it("current_run keeps the selected thinking-only message; DeepSeek sends it and OpenAI has no item for it", async () => {
    const transcript = [
      userEntry("h1", "history input"),
      assistantEntry("h1a", "history answer", [], "think-history"),
      userEntry("task-1", "task input"),
      assistantEntry("thought-1", "", [], "think-current"),
    ];
    const input = contextInput({
      baseSystemPrompt: "BASE", transcript, tokenBudget: 100_000, maxOutputTokens: 100,
    });
    const snapshot = structuredClone(input);
    const probe = fixedCountPreview({ window: 100_000, outputCap: 100, count: 100 });
    const result = await selectContext(
      input,
      selectionOptions(
        { historyEntryCount: 2, taskInputMessageId: "task-1", build: buildModelRequest },
        probe.previewRequest,
        "current_run",
      ),
    );
    expect(input).toEqual(snapshot);
    expect(transcriptIds(result.selected.transcript))
      .toEqual(["h1", "h1a", "task-1", "thought-1"]);
    const kept = result.selected.transcript.find(
      (entry) => entry.kind === "assistant_message" && entry.message.messageId === "thought-1",
    );
    expect(kept).toBeDefined();
    if (kept?.kind === "assistant_message") {
      expect(kept.message.reasoningContent).toBe("think-current");
    }

    const deepseek = deepSeekCapture([{ text: "ok" }]);
    for await (const _event of deepseek.client.stream(result.request, {
      signal: new AbortController().signal,
    })) {
      // consume the adapter's completion
    }
    expect(deepseek.bodies[0]).toEqual({
      model: "pc-model",
      messages: [
        { role: "system", content: "BASE" },
        { role: "user", content: "history input" },
        { role: "assistant", content: "history answer" },
        { role: "user", content: "task input" },
        { role: "assistant", content: null, reasoning_content: "think-current" },
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 100,
      thinking: { type: "enabled" },
    });

    const openai = openAICapture([{ text: "ok" }]);
    for await (const _event of openai.client.stream(result.request, {
      signal: new AbortController().signal,
    })) {
      // consume the adapter's completion
    }
    expect(openai.bodies[0]).toEqual({
      model: "pc-model",
      instructions: "BASE",
      input: [
        { type: "message", role: "user", content: "history input" },
        { type: "message", role: "assistant", content: "history answer" },
        { type: "message", role: "user", content: "task input" },
      ],
      parallel_tool_calls: true,
      stream: true,
      store: false,
      max_output_tokens: 100,
    });
  });

  it("selectContext none drops the current thinking-only message", async () => {
    const transcript = [
      userEntry("h1", "history input"),
      assistantEntry("h1a", "history answer", [], "think-history"),
      userEntry("task-1", "task input"),
      assistantEntry("thought-1", "", [], "think-current"),
    ];
    const input = contextInput({
      baseSystemPrompt: "BASE", transcript, tokenBudget: 100_000, maxOutputTokens: 100,
    });
    const snapshot = structuredClone(input);
    const probe = fixedCountPreview({ window: 100_000, outputCap: 100, count: 100 });
    const result = await selectContext(
      input,
      selectionOptions(
        { historyEntryCount: 2, taskInputMessageId: "task-1", build: buildModelRequest },
        probe.previewRequest,
        "none",
      ),
    );
    expect(input).toEqual(snapshot);
    expect(transcriptIds(result.selected.transcript)).toEqual(["h1", "h1a", "task-1"]);
    const deepseek = deepSeekCapture([{ text: "ok" }]);
    for await (const _event of deepseek.client.stream(result.request, {
      signal: new AbortController().signal,
    })) {
      // consume the adapter's completion
    }
    expect((deepseek.bodies[0]!["messages"] as Array<Record<string, unknown>>)).toEqual([
      { role: "system", content: "BASE" },
      { role: "user", content: "history input" },
      { role: "assistant", content: "history answer" },
      { role: "user", content: "task input" },
    ]);
  });
});
