import { describe, expect, it } from "vitest";

import {
  assertToolResultMatchesCall,
  toolCallSchema,
  ToolProtocolError,
  toolResultSchema,
} from "../../src/core/ports/tool_executor/tool-executor-port.js";

const effects = {
  sideEffect: "none" as const,
  changedPaths: [],
  workspaceRevision: null,
  artifactRefs: [],
};

describe("M1-03 ToolExecutorPort contract", () => {
  it("ToolCall 只包含模型可提供的名称和 JSON 参数", () => {
    const call = {
      schemaVersion: 1,
      callId: "call-1",
      name: "read",
      arguments: { path: "README.md", lines: [1, 20] },
    };
    expect(toolCallSchema.parse(JSON.parse(JSON.stringify(call)))).toEqual(call);
    expect(toolCallSchema.safeParse({ ...call, approved: true }).success).toBe(false);
    expect(toolCallSchema.safeParse({ ...call, arguments: { invalid: Number.NaN } }).success).toBe(
      false,
    );
  });

  it.each([
    {
      schemaVersion: 1,
      callId: "call-1",
      status: "success",
      output: [{ kind: "text", text: "content" }],
      effects,
    },
    {
      schemaVersion: 1,
      callId: "call-1",
      status: "error",
      error: { code: "permission_denied", message: "outside workspace", retryable: false },
      output: [],
      effects,
    },
    {
      schemaVersion: 1,
      callId: "call-1",
      status: "cancelled",
      reason: "caller aborted",
      output: [],
      effects: { ...effects, sideEffect: "possible" },
    },
  ])("支持 success/error/cancelled 结果并保留 effects", (result) => {
    expect(toolResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });

  it("强制 ToolResult 原样关联 callId", () => {
    const call = toolCallSchema.parse({
      schemaVersion: 1,
      callId: "call-1",
      name: "read",
      arguments: {},
    });
    const result = toolResultSchema.parse({
      schemaVersion: 1,
      callId: "call-other",
      status: "success",
      output: [],
      effects,
    });
    expect(() => assertToolResultMatchesCall(call, result)).toThrowError(ToolProtocolError);
  });
});
