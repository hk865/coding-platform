import { describe, expect, it } from "vitest";

import {
  modelEventSchema,
  modelRequestSchema,
  validateModelEventSequence,
} from "../../src/core/ports/model_client/model-client-port.js";

const base = { schemaVersion: 1 as const, requestId: "request-1" };

describe("M1-02 ModelClientPort contract", () => {
  it("接受 final answer 的有序流", () => {
    const events = [
      { ...base, sequence: 1, type: "text_delta", delta: "完成" },
      {
        ...base,
        sequence: 2,
        type: "usage_snapshot",
        usage: {
          inputTokens: 12,
          outputTokens: 2,
          cachedInputTokens: 3,
          costUsdMicros: 10,
        },
      },
      { ...base, sequence: 3, type: "completed", reason: "final_answer" },
    ];
    expect(validateModelEventSequence(events)).toEqual({ ok: true });
    expect(events.map((event) => modelEventSchema.parse(event))).toHaveLength(3);
  });

  it("只在完整 JSON object 参数后接受 tool_calls 完成", () => {
    const events = [
      {
        ...base,
        sequence: 1,
        type: "tool_call_started",
        callId: "call-1",
        name: "read",
        ordinal: 0,
      },
      {
        ...base,
        sequence: 2,
        type: "tool_arguments_delta",
        callId: "call-1",
        delta: '{"path":',
      },
      {
        ...base,
        sequence: 3,
        type: "tool_arguments_delta",
        callId: "call-1",
        delta: '"README.md"}',
      },
      { ...base, sequence: 4, type: "completed", reason: "tool_calls" },
    ];
    expect(validateModelEventSequence(events)).toEqual({ ok: true });

    const incomplete = events
      .filter((event) => event.sequence !== 3)
      .map((event, index) => ({
        ...event,
        sequence: index + 1,
      }));
    expect(validateModelEventSequence(incomplete)).toMatchObject({
      ok: false,
      violation: { code: "invalid_tool_arguments" },
    });
  });

  it("拒绝 usage 倒退、跳号和终止后的事件", () => {
    expect(
      validateModelEventSequence([
        {
          ...base,
          sequence: 1,
          type: "usage_snapshot",
          usage: { inputTokens: 2, outputTokens: 1, cachedInputTokens: 0, costUsdMicros: 2 },
        },
        {
          ...base,
          sequence: 2,
          type: "usage_snapshot",
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, costUsdMicros: 2 },
        },
        { ...base, sequence: 3, type: "completed", reason: "final_answer" },
      ]),
    ).toMatchObject({ ok: false, violation: { code: "usage_regression" } });

    expect(
      validateModelEventSequence([
        { ...base, sequence: 1, type: "completed", reason: "final_answer" },
        { ...base, sequence: 2, type: "text_delta", delta: "late" },
      ]),
    ).toMatchObject({ ok: false, violation: { code: "event_after_terminal" } });

    expect(
      validateModelEventSequence([
        { ...base, sequence: 2, type: "completed", reason: "final_answer" },
      ]),
    ).toMatchObject({ ok: false, violation: { code: "sequence_mismatch" } });
  });

  it("ModelRequest 是厂商无关、严格且可序列化的值", () => {
    const request = {
      schemaVersion: 1,
      requestId: "request-1",
      runId: "run-1",
      systemPrompt: "遵循规则",
      messages: [{ role: "user", messageId: "message-1", content: "读取文件" }],
      tools: [
        {
          name: "read",
          description: "读取文本",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
      maxOutputTokens: 100,
    };
    expect(modelRequestSchema.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
    expect(modelRequestSchema.safeParse({ ...request, provider: "openai" }).success).toBe(false);
  });
});
