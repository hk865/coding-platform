import { describe, expect, it } from "vitest";

import type {
  ModelClientPort,
  ModelRequest,
} from "../../src/core/ports/model_client/model-client-port.js";
import { consumeModelStream } from "../../src/core/runtime/loop/model-stream-consumer.js";

const request: ModelRequest = {
  schemaVersion: 1,
  requestId: "request-event-limit",
  runId: "run-event-limit",
  systemPrompt: "base",
  messages: [{ role: "user", messageId: "user", content: "test" }],
  tools: [],
  maxOutputTokens: null,
};

describe("M2 ModelStream 有界缓冲", () => {
  it("独立聚合并实时转发 Provider 公开的推理内容", async () => {
    const model: ModelClientPort = {
      async *stream() {
        yield {
          schemaVersion: 1 as const,
          requestId: request.requestId,
          sequence: 1,
          type: "reasoning_delta" as const,
          delta: "先检查",
        };
        yield {
          schemaVersion: 1 as const,
          requestId: request.requestId,
          sequence: 2,
          type: "reasoning_delta" as const,
          delta: "相关文件。",
        };
        yield {
          schemaVersion: 1 as const,
          requestId: request.requestId,
          sequence: 3,
          type: "text_delta" as const,
          delta: "完成",
        };
        yield {
          schemaVersion: 1 as const,
          requestId: request.requestId,
          sequence: 4,
          type: "completed" as const,
          reason: "final_answer" as const,
        };
      },
    };
    let visibleReasoning = "";

    const result = await consumeModelStream(model, request, {
      signal: new AbortController().signal,
      onReasoningDelta: (delta) => {
        visibleReasoning += delta;
      },
    });

    expect(result).toMatchObject({
      kind: "completed",
      reasoning: "先检查相关文件。",
      text: "完成",
    });
    expect(visibleReasoning).toBe("先检查相关文件。");
  });

  it("即使事件不增加文本字符，也会受 maxEvents 限制", async () => {
    const model: ModelClientPort = {
      async *stream() {
        for (let sequence = 1; sequence <= 3; sequence += 1) {
          yield {
            schemaVersion: 1,
            requestId: request.requestId,
            sequence,
            type: "usage_snapshot",
            usage: {
              inputTokens: sequence,
              outputTokens: 0,
              cachedInputTokens: 0,
              costUsdMicros: sequence,
            },
          };
        }
        yield {
          schemaVersion: 1,
          requestId: request.requestId,
          sequence: 4,
          type: "completed",
          reason: "final_answer",
        };
      },
    };

    const result = await consumeModelStream(model, request, {
      signal: new AbortController().signal,
      maxEvents: 2,
    });

    expect(result).toMatchObject({
      kind: "protocol_error",
      code: "event_limit_exceeded",
    });
  });
});
