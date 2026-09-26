/**
 * B2 Kernel 历史配对校验公开导出（第一阶段骨架测试）。
 *
 * 只通过冻结公开入口 `vendor/coding-agent/dist/public-api.js` 使用
 * `assertTranscriptExchangeIntegrity`、公开 `RunState` 类型与 `StoreError`；
 * 不导入 Kernel 私有路径，也不实现平台释放判据。
 *
 * 第一阶段预期：旧公开面保留断言通过；依赖真实原函数行为的新正/反例在
 * unsupported stub 下为红，且失败原因必须是 StoreError/corrupt 语义，而不是
 * 任意异常。此处不 skip、不放宽为 toThrow()。
 */
import { describe, expect, it } from "vitest";
import {
  assertTranscriptExchangeIntegrity,
  kernelSessionApiVersion,
  StoreError,
  type RunState,
} from "../../vendor/coding-agent/dist/public-api.js";
import * as publicApi from "../../vendor/coding-agent/dist/public-api.js";

type Transcript = RunState["transcript"];
type Entry = Transcript[number];

/** 错误消息必须携带本测试的 label，避免 stub 的任意异常被误当作正确实现。 */
const BASE_LABEL = "b2-history-public-export-fixture";

function userMessage(messageId: string, content: string): Entry {
  return {
    kind: "user_message",
    message: { schemaVersion: 1, messageId, role: "user", content },
  };
}

function assistantMessage(messageId: string, content: string, callIds: readonly string[]): Entry {
  return {
    kind: "assistant_message",
    message: { schemaVersion: 1, messageId, role: "assistant", content },
    toolCalls: callIds.map((callId) => ({
      schemaVersion: 1 as const,
      callId,
      name: "read",
      arguments: {},
    })),
  };
}

function successResult(callId: string): Entry {
  return {
    kind: "tool_result",
    callId,
    result: {
      status: "success",
      schemaVersion: 1,
      callId,
      output: [{ kind: "text", text: `${callId}:ok` }],
      effects: {
        sideEffect: "none",
        changedPaths: [],
        workspaceRevision: null,
        artifactRefs: [],
      },
    },
  };
}

function outcomeUnknownResult(callId: string): Entry {
  return {
    kind: "tool_result",
    callId,
    result: {
      status: "error",
      error: {
        code: "outcome_unknown",
        message: "tool started but its side effect was not observed",
        retryable: false,
      },
      schemaVersion: 1,
      callId,
      output: [],
      effects: {
        sideEffect: "possible",
        changedPaths: [],
        workspaceRevision: null,
        artifactRefs: [],
      },
    },
  };
}

// Frozen 2026-09-24 public entry (`dist/public-api.js`) runtime export names,
// read before this batch added its seam and approved as the fixed baseline.
// Runtime enumeration covers value exports only; erased types are checked by the
// managed-source diff and compilation, not by faking names here.
const FROZEN_PUBLIC_RUNTIME_EXPORTS = [
  "ApprovalCoordinator", "CancellationController", "CharacterTokenEstimator", "CheckpointingEventSink",
  "ContextBuildError", "ContextSelectionError", "DeepSeekModelClient", "DefaultPermissionPolicy",
  "DeterministicContextBuilder", "ENGINEERING_STATUS", "EditToolHandler", "EmptyMemoryProvider",
  "EventDeliveryCoordinator", "FileSkillLoader", "HookExecutionError", "HookExecutor", "HookRegistry",
  "InMemoryStores", "LimitGuard", "OpenAIModelClient", "ProcessSandbox", "ProcessSandboxError",
  "ProviderRegistry", "ReadToolHandler", "RecoveryCoordinator", "ReducerError", "RegistryToolBatchPolicy",
  "RequiredSinkError", "RunnerBusyError", "RuntimeRunner", "SerialToolBatchPolicy", "SessionEventSink",
  "ShellToolHandler", "SkillRegistry", "SqliteStores", "StaticApprovalRequester", "StoreError",
  "StructuredEventLogger", "ToolDispatcher", "ToolRegistry", "ToolRegistrySnapshot", "UNLIMITED_RUN_LIMITS",
  "WorkspaceSandbox", "WorkspaceSandboxError", "afterToolHookDecisionSchema", "afterToolHookInvocationSchema",
  "agentEventSchema", "appConfigSchema", "assertToolResultMatchesCall", "beforeModelHookDecisionSchema",
  "beforeModelHookInvocationSchema", "beforeToolHookDecisionSchema", "beforeToolHookInvocationSchema",
  "buildModelRequest", "checkpointDraft", "checkpointSchema", "consumeModelStream",
  "createBuiltinProviderRegistry", "createCheckpoint", "createEditToolDefinition", "createInitialRunState",
  "createReadToolDefinition", "createShellToolDefinition", "deriveRunPhase", "eventMetaSchema",
  "eventSinkDeliverySchema", "hookDecisionSchema", "hookFailureSchema", "hookInvocationSchema",
  "hookPointSchema", "hookRegistrationSchema", "isRequiredEventSink", "kernelSessionApiVersion",
  "loadAppConfig", "memoryRecallRequestSchema", "memoryWriteRequestSchema", "memoryWriteResultSchema",
  "modelEventSchema", "modelRequestSchema", "normalizeWorkspacePath", "parseCliCommand", "reduceRunState",
  "resumeCodingAgent", "runCli", "runCodingAgent", "runLimitsSchema", "runSchema", "runStateSchema",
  "selectContext", "sessionRecordSchema", "skillSelectionRequestSchema", "toolCallSchema",
  "toolResultPresentationSchema", "toolResultSchema", "toolSchema", "validateHookDecision",
  "validateModelEventSequence", "validateRunStateInvariants", "validateTransition",
] as const;

const KEY_PUBLIC_EXPORTS = [
  "runCodingAgent",
  "resumeCodingAgent",
  "SqliteStores",
  "createInitialRunState",
  "reduceRunState",
  "kernelSessionApiVersion",
] as const;

describe("B2 transcript exchange integrity public export", () => {
  it("accepts a text-only user/assistant transcript and leaves the input unmodified", () => {
    const transcript: Transcript = [
      userMessage("u1", "hello"),
      assistantMessage("a1", "plain answer", []),
    ];
    const snapshot = structuredClone(transcript);
    expect(() => assertTranscriptExchangeIntegrity(transcript, BASE_LABEL)).not.toThrow();
    expect(transcript).toEqual(snapshot);
  });

  it("accepts two ToolCalls each paired with exactly one ToolResult and leaves the input unmodified", () => {
    const transcript: Transcript = [
      userMessage("u1", "run both"),
      assistantMessage("a1", "calling", ["c1", "c2"]),
      successResult("c1"),
      successResult("c2"),
    ];
    const snapshot = structuredClone(transcript);
    expect(() => assertTranscriptExchangeIntegrity(transcript, BASE_LABEL)).not.toThrow();
    expect(transcript).toEqual(snapshot);
  });

  it("accepts a paired outcome_unknown synthetic result: pairing alone is not a release judgment", () => {
    const transcript: Transcript = [
      userMessage("u1", "maybe wrote"),
      assistantMessage("a1", "calling", ["c1"]),
      outcomeUnknownResult("c1"),
    ];
    expect(() => assertTranscriptExchangeIntegrity(transcript, BASE_LABEL)).not.toThrow();
  });

  const rejectionCases: ReadonlyArray<{
    readonly name: string;
    readonly transcript: Transcript;
    readonly reason: string;
  }> = [
    {
      name: "rejects a ToolResult that settles the same callId twice",
      transcript: [
        userMessage("u1", "once"),
        assistantMessage("a1", "calling", ["c1"]),
        successResult("c1"),
        successResult("c1"),
      ],
      reason: "重复结算",
    },
    {
      name: "rejects an orphan ToolResult without a preceding ToolCall",
      transcript: [
        userMessage("u1", "nothing"),
        assistantMessage("a1", "plain", []),
        successResult("c-orphan"),
      ],
      reason: "没有唯一且未结算的 ToolCall",
    },
    {
      name: "rejects a callId reused across assistant batches",
      transcript: [
        userMessage("u1", "first batch"),
        assistantMessage("a1", "calling", ["c1"]),
        successResult("c1"),
        assistantMessage("a2", "reuses old id", ["c1"]),
      ],
      reason: "重复 ToolCall c1",
    },
    {
      name: "rejects an unsettled ToolCall missing its ToolResult",
      transcript: [
        userMessage("u1", "call two"),
        assistantMessage("a1", "calling", ["c1", "c-missing"]),
        successResult("c1"),
      ],
      reason: "缺少工具结果",
    },
    {
      name: "rejects a following assistant message before the open ToolCall is settled",
      transcript: [
        userMessage("u1", "call"),
        assistantMessage("a1", "calling", ["c1"]),
        assistantMessage("a2", "runs ahead", []),
      ],
      reason: "assistant message 前仍有未结算工具调用",
    },
    {
      name: "rejects a following user message before the open ToolCall is settled",
      transcript: [
        userMessage("u1", "call"),
        assistantMessage("a1", "calling", ["c1"]),
        userMessage("u2", "runs ahead"),
      ],
      reason: "user message 出现在未闭合工具调用之前",
    },
  ];

  it.each(rejectionCases)("$name", ({ transcript, reason }) => {
    const label = BASE_LABEL;
    let captured: unknown;
    try {
      assertTranscriptExchangeIntegrity(transcript, label);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(StoreError);
    const storeError = captured as StoreError;
    expect(storeError.code).toBe("corrupt");
    expect(storeError.message).toContain(label);
    expect(storeError.message).toContain(reason);
  });

  it("retains every frozen runtime export and adds no name other than the new seam", () => {
    const namespace = publicApi as unknown as Record<string, unknown>;
    const actual = Object.keys(namespace);
    const baseline = FROZEN_PUBLIC_RUNTIME_EXPORTS as readonly string[];
    expect(baseline.filter((name) => !actual.includes(name))).toEqual([]);
    const unexpected = actual.filter(
      (name) => !baseline.includes(name) && name !== "assertTranscriptExchangeIntegrity" && name !== "projectTerminalTranscript",
    );
    expect(unexpected).toEqual([]);
    for (const name of baseline) {
      expect(namespace[name]).toBeDefined();
    }
    for (const name of KEY_PUBLIC_EXPORTS) {
      expect(namespace[name]).toBeDefined();
    }
    expect(kernelSessionApiVersion).toBeGreaterThanOrEqual(2);
  });
});
