import { describe, expect, it } from "vitest";

import type { ContextBuilderInput } from "../../src/core/context/builder/context-builder.js";
import { DeterministicContextBuilder } from "../../src/core/context/builder/context-builder.js";
import {
  ContextSelectionError,
  selectContext,
} from "../../src/core/context/selection_policy/context-selection-policy.js";
import type {
  TokenEstimateInput,
  TokenEstimator,
} from "../../src/core/context/selection_policy/context-selection-policy.js";

const successResult = {
  schemaVersion: 1 as const,
  status: "success" as const,
  output: [{ kind: "text" as const, text: "ok" }],
  effects: {
    sideEffect: "none" as const,
    changedPaths: [],
    workspaceRevision: null,
    artifactRefs: [],
  },
};

function toolGroup(messageId: string, callId: string): ContextBuilderInput["transcript"] {
  return [
    {
      kind: "assistant_message",
      message: {
        schemaVersion: 1,
        messageId,
        role: "assistant",
        content: "",
      },
      toolCalls: [
        {
          schemaVersion: 1,
          callId,
          name: "read",
          arguments: { path: `${callId}.txt` },
        },
      ],
    },
    {
      kind: "tool_result",
      callId,
      result: { ...successResult, callId },
    },
  ];
}

function multiToolGroup(
  messageId: string,
  callIds: readonly string[],
): ContextBuilderInput["transcript"] {
  return [
    {
      kind: "assistant_message",
      message: {
        schemaVersion: 1,
        messageId,
        role: "assistant",
        content: "",
      },
      toolCalls: callIds.map((callId) => ({
        schemaVersion: 1 as const,
        callId,
        name: "read",
        arguments: { path: `${callId}.txt` },
      })),
    },
    ...callIds.map((callId) => ({
      kind: "tool_result" as const,
      callId,
      result: { ...successResult, callId },
    })),
  ];
}

function input(): ContextBuilderInput {
  return {
    requestId: "request-selection",
    runId: "run-selection",
    baseSystemPrompt: "base",
    additionalInstructions: [
      { schemaVersion: 1, id: "additional", content: "a", priority: 0, source: "project" },
    ],
    skills: [
      {
        schemaVersion: 1,
        id: "reference",
        title: "reference",
        content: "r",
        kind: "reference",
        priority: 0,
        source: "skill",
      },
      {
        schemaVersion: 1,
        id: "instruction",
        title: "instruction",
        content: "i",
        kind: "instruction",
        priority: 0,
        source: "skill",
      },
    ],
    memories: [
      {
        schemaVersion: 1,
        id: "memory",
        content: "m",
        priority: 0,
        source: "session",
        createdAt: "2026-08-20T00:00:00.000Z",
      },
    ],
    transcript: [
      {
        kind: "user_message",
        message: {
          schemaVersion: 1,
          messageId: "current-user",
          role: "user",
          content: "继续",
        },
      },
      ...toolGroup("assistant-old", "call-old"),
      ...toolGroup("assistant-new", "call-new"),
    ],
    tools: [{ name: "read", description: "read", inputSchema: { type: "object" } }],
    tokenBudget: 30,
    maxOutputTokens: null,
  };
}

class WeightedEstimator implements TokenEstimator {
  estimate(value: Readonly<TokenEstimateInput>): number {
    if (!("tokenBudget" in value)) return JSON.stringify(value).length;
    return (
      value.transcript.length * 10 +
      value.additionalInstructions.length * 10 +
      value.skills.length * 10 +
      value.memories.length * 10
    );
  }
}

describe("M2 Context SelectionPolicy", () => {
  it("先淘汰可选上下文，再按完整 assistant/tool group 删除最旧历史", () => {
    const source = input();
    const snapshot = structuredClone(source);

    const selected = selectContext(source, new WeightedEstimator());

    // 当前用户消息和较新的完整 ToolCall/ToolResult 配对必须保留。
    expect(selected.input.transcript.map((entry) => entry.kind)).toEqual([
      "user_message",
      "assistant_message",
      "tool_result",
    ]);
    expect(
      selected.input.transcript
        .filter((entry) => entry.kind === "assistant_message")
        .map((entry) => entry.message.messageId),
    ).toEqual(["assistant-new"]);
    expect(selected.removed.map((item) => item.kind)).toEqual([
      "memory",
      "skill_reference",
      "additional_instruction",
      "skill_instruction",
      "transcript_group",
    ]);
    expect(selected.removed.at(-1)?.id).toBe("assistant-old");
    expect(selected.estimatedTokens).toBe(30);
    expect(source).toEqual(snapshot);
  });

  it("未闭合 ToolCall 属于不可裁剪内容，超预算时明确失败", () => {
    const source = input();
    const pendingGroup = toolGroup("assistant-pending", "call-pending")[0]!;
    expect(() =>
      selectContext(
        {
          ...source,
          additionalInstructions: [],
          skills: [],
          memories: [],
          transcript: [source.transcript[0]!, pendingGroup],
          tokenBudget: 10,
        },
        new WeightedEstimator(),
      ),
    ).toThrowError(ContextSelectionError);
  });

  it("连续删除多个不同长度的历史组后仍保持 ToolCall/ToolResult 配对", () => {
    const currentUser = input().transcript[0]!;
    const source: ContextBuilderInput = {
      ...input(),
      additionalInstructions: [],
      skills: [],
      memories: [],
      transcript: [
        currentUser,
        ...toolGroup("assistant-a", "call-a"),
        ...toolGroup("assistant-b", "call-b"),
        ...multiToolGroup("assistant-c", ["call-c1", "call-c2"]),
      ],
      tokenBudget: 40,
    };

    const selected = selectContext(source, new WeightedEstimator());
    const request = new DeterministicContextBuilder().build(selected.input);

    expect(selected.removed.filter((item) => item.kind === "transcript_group")).toEqual([
      {
        kind: "transcript_group",
        id: "assistant-a",
        source: "transcript",
        reason: "budget",
      },
      {
        kind: "transcript_group",
        id: "assistant-b",
        source: "transcript",
        reason: "budget",
      },
    ]);
    expect(request.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
    ]);
    expect(
      request.messages
        .filter((message) => message.role === "tool")
        .map((message) => message.callId),
    ).toEqual(["call-c1", "call-c2"]);
  });

  it("估算器异常或返回非法值时 fail closed", () => {
    expect(() =>
      selectContext(input(), {
        estimate() {
          return 0;
        },
      }),
    ).toThrowError(/invalid token estimate/);
  });
});
