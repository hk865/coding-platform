import { describe, expect, it } from "vitest";

import {
  afterToolHookDecisionSchema,
  beforeModelHookDecisionSchema,
  hookRegistrationSchema,
  validateHookDecision,
} from "../../src/core/hooks/protocol/hook-protocol.js";
import {
  eventSinkDeliverySchema,
  isRequiredEventSink,
} from "../../src/core/ports/event_sink/event-sink-port.js";
import { modelRequestSchema } from "../../src/core/ports/model_client/model-client-port.js";
import { toolCallSchema } from "../../src/core/ports/tool_executor/tool-executor-port.js";
import { createInitialRunState } from "../../src/core/runtime/state/run-state.js";

const runState = createInitialRunState({
  schemaVersion: 1,
  runId: "run-1",
  turn: {
    turnId: "turn-1",
    userMessage: {
      schemaVersion: 1,
      messageId: "message-1",
      role: "user",
      content: "读取 README",
    },
  },
  createdAt: "2026-08-20T00:00:00.000Z",
});

const request = modelRequestSchema.parse({
  schemaVersion: 1,
  requestId: "request-1",
  runId: "run-1",
  systemPrompt: "遵循规则",
  messages: [{ role: "user", messageId: "message-1", content: "读取 README" }],
  tools: [],
  maxOutputTokens: 100,
});

const call = toolCallSchema.parse({
  schemaVersion: 1,
  callId: "call-1",
  name: "read",
  arguments: { path: "README.md" },
});

const hookFailure = {
  category: "hook" as const,
  code: "hook_failed",
  message: "hook failed",
  retryable: false,
  operationId: "hook-1",
};

describe("M1-05 Hook protocol contract", () => {
  it("固定三个生命周期点、稳定标识和优先级", () => {
    expect(
      hookRegistrationSchema.parse({
        schemaVersion: 1,
        hookId: "hook-1",
        point: "before_tool",
        priority: 10,
      }),
    ).toEqual({
      schemaVersion: 1,
      hookId: "hook-1",
      point: "before_tool",
      priority: 10,
    });
    expect(
      hookRegistrationSchema.safeParse({
        schemaVersion: 1,
        hookId: "hook-1",
        point: "before_tool",
        priority: 10,
        requiredPermission: true,
      }).success,
    ).toBe(false);
  });

  it("before_model 支持 continue/modify/block/pause/fail 并拒绝身份改写", () => {
    const invocation = {
      schemaVersion: 1,
      point: "before_model",
      state: runState,
      request,
    };

    const decisions = [
      { point: "before_model", kind: "continue" },
      {
        point: "before_model",
        kind: "modify",
        value: { ...request, systemPrompt: "修改后的受信规则" },
      },
      { point: "before_model", kind: "block", reason: "blocked" },
      { point: "before_model", kind: "pause", reason: "need input" },
      { point: "before_model", kind: "fail", failure: hookFailure },
    ];
    for (const decision of decisions) {
      expect(beforeModelHookDecisionSchema.safeParse(decision).success).toBe(true);
      expect(validateHookDecision(invocation, decision)).toEqual({ ok: true });
    }

    expect(
      validateHookDecision(invocation, {
        point: "before_model",
        kind: "modify",
        value: { ...request, requestId: "request-other" },
      }),
    ).toMatchObject({ ok: false, violation: { code: "identity_modified" } });
  });

  it("before_tool 不能修改 callId，decision 不能跨生命周期点", () => {
    const invocation = {
      schemaVersion: 1,
      point: "before_tool",
      state: runState,
      call,
    };

    expect(
      validateHookDecision(invocation, {
        point: "before_tool",
        kind: "modify",
        value: { ...call, arguments: { path: "src/public-api.ts" } },
      }),
    ).toEqual({ ok: true });
    expect(
      validateHookDecision(invocation, {
        point: "before_tool",
        kind: "modify",
        value: { ...call, callId: "call-other" },
      }),
    ).toMatchObject({ ok: false, violation: { code: "identity_modified" } });
    expect(
      validateHookDecision(invocation, { point: "before_model", kind: "continue" }),
    ).toMatchObject({ ok: false, violation: { code: "point_mismatch" } });
  });

  it("after_tool 只允许修改回填输出，不能改写 status、callId 或 effects", () => {
    const result = {
      schemaVersion: 1 as const,
      callId: "call-1",
      status: "success" as const,
      output: [{ kind: "text" as const, text: "raw" }],
      effects: {
        sideEffect: "confirmed" as const,
        changedPaths: ["README.md"],
        workspaceRevision: "revision-1",
        artifactRefs: [],
      },
    };
    const invocation = {
      schemaVersion: 1,
      point: "after_tool",
      state: runState,
      result,
    };

    expect(
      validateHookDecision(invocation, {
        point: "after_tool",
        kind: "modify",
        value: { output: [{ kind: "text", text: "redacted" }] },
      }),
    ).toEqual({ ok: true });
    expect(
      afterToolHookDecisionSchema.safeParse({
        point: "after_tool",
        kind: "modify",
        value: {
          output: [],
          effects: { ...result.effects, sideEffect: "none" },
        },
      }).success,
    ).toBe(false);
    expect(
      afterToolHookDecisionSchema.safeParse({
        point: "after_tool",
        kind: "block",
        reason: "too late",
      }).success,
    ).toBe(false);
  });
});

describe("M1-05 EventSinkPort contract", () => {
  it("只区分 best_effort 与 required，不提供控制型结果", () => {
    expect(eventSinkDeliverySchema.options).toEqual(["best_effort", "required"]);
    expect(isRequiredEventSink({ delivery: "best_effort" })).toBe(false);
    expect(isRequiredEventSink({ delivery: "required" })).toBe(true);
  });
});
