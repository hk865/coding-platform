import { describe, expect, it } from "vitest";

import {
  buildModelRequest,
  ContextBuildError,
} from "../../src/core/context/builder/context-builder.js";
import type { ContextBuilderInput } from "../../src/core/context/builder/context-builder.js";

const successResult = {
  schemaVersion: 1 as const,
  callId: "call-read",
  status: "success" as const,
  output: [{ kind: "text" as const, text: "# Project" }],
  effects: {
    sideEffect: "none" as const,
    changedPaths: [],
    workspaceRevision: null,
    artifactRefs: [],
  },
};

function input(): ContextBuilderInput {
  return {
    requestId: "request-1",
    runId: "run-1",
    baseSystemPrompt: "BASE RULE",
    additionalInstructions: [
      { schemaVersion: 1, id: "b", content: "B", priority: 10, source: "project" },
      { schemaVersion: 1, id: "a", content: "A", priority: 10, source: "project" },
    ],
    skills: [
      {
        schemaVersion: 1,
        id: "skill-ref",
        title: "参考",
        content: "REFERENCE",
        kind: "reference",
        priority: 100,
        source: "skill",
      },
      {
        schemaVersion: 1,
        id: "skill-instruction",
        title: "流程",
        content: "INSTRUCTION",
        kind: "instruction",
        priority: 1,
        source: "skill",
      },
    ],
    memories: [
      {
        schemaVersion: 1,
        id: "memory-1",
        content: "MEMORY",
        priority: 50,
        source: "session",
        createdAt: "2026-08-20T00:00:00.000Z",
      },
    ],
    transcript: [
      {
        kind: "user_message",
        message: {
          schemaVersion: 1,
          messageId: "message-user",
          role: "user",
          content: "读取 README",
        },
      },
      {
        kind: "assistant_message",
        message: {
          schemaVersion: 1,
          messageId: "message-assistant",
          role: "assistant",
          content: "",
          reasoningContent: "需要先读取 README，再根据文件内容回答。",
        },
        toolCalls: [
          { schemaVersion: 1, callId: "call-read", name: "read", arguments: { path: "README.md" } },
        ],
      },
      { kind: "tool_result", callId: "call-read", result: successResult },
    ],
    tools: [
      { name: "shell", description: "执行命令", inputSchema: { type: "object" } },
      { name: "read", description: "读取文本", inputSchema: { type: "object" } },
    ],
    tokenBudget: 4_000,
    maxOutputTokens: 500,
  };
}

describe("M1-04 ContextBuilder boundary", () => {
  it("按固定优先级组装请求，保持 transcript 顺序并稳定排序 tools", () => {
    const source = input();
    const snapshot = structuredClone(source);
    const request = buildModelRequest(source);

    expect(request.systemPrompt.indexOf("BASE RULE")).toBeLessThan(
      request.systemPrompt.indexOf("additional_instruction"),
    );
    expect(request.systemPrompt.indexOf('id="a"')).toBeLessThan(
      request.systemPrompt.indexOf('id="b"'),
    );
    expect(request.systemPrompt.indexOf("skill_instruction")).toBeLessThan(
      request.systemPrompt.indexOf("reference_data"),
    );
    expect(request.systemPrompt.indexOf("reference_data")).toBeLessThan(
      request.systemPrompt.indexOf("memory_data"),
    );
    expect(request.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
    expect(request.messages[1]).toMatchObject({
      role: "assistant",
      reasoningContent: "需要先读取 README，再根据文件内容回答。",
    });
    expect(request.tools.map((tool) => tool.name)).toEqual(["read", "shell"]);
    expect(source).toEqual(snapshot);
    expect(buildModelRequest(source)).toEqual(request);
  });

  it("拒绝重复工具名和孤立 ToolResult", () => {
    const source = input();
    const duplicateTools: ContextBuilderInput = {
      ...source,
      tools: [source.tools[0]!, source.tools[0]!],
    };
    expect(() => buildModelRequest(duplicateTools)).toThrowError(ContextBuildError);

    const orphanSource = input();
    const orphanResult: ContextBuilderInput = {
      ...orphanSource,
      transcript: [orphanSource.transcript[0]!, orphanSource.transcript[2]!],
    };
    expect(() => buildModelRequest(orphanResult)).toThrowError(/没有唯一且未结算/);
  });

  it("只接收传入值，不读取 Provider、Storage 或工作区", () => {
    const request = buildModelRequest({
      ...input(),
      additionalInstructions: [],
      skills: [],
      memories: [],
    });
    expect(request.systemPrompt).toBe("BASE RULE");
  });
});
