import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type {
  ModelClientPort,
  ModelEvent,
  ModelRequest,
} from "../../src/core/ports/model_client/model-client-port.js";
import type {
  RunConfigSnapshot,
  WorkspaceReference,
} from "../../src/core/ports/session_store/session-store-port.js";
import type {
  ToolCall,
  ToolExecutionOptions,
  ToolExecutorPort,
  ToolResult,
} from "../../src/core/ports/tool_executor/tool-executor-port.js";
import { RuntimeRunner } from "../../src/core/runtime/loop/runtime-runner.js";
import { RecoveryCoordinator } from "../../src/core/runtime/recovery/recovery-coordinator.js";
import type { Run } from "../../src/core/runtime/state/run-state.js";
import {
  ApprovalCoordinator,
  StaticApprovalRequester,
} from "../../src/policy/approval/approval-coordinator.js";
import { DefaultPermissionPolicy } from "../../src/policy/permissions/permission-policy.js";
import { WorkspaceSandbox } from "../../src/sandbox/workspace/workspace-sandbox.js";
import { SqliteStores } from "../../src/storage/adapters/sqlite/sqlite-stores.js";
import { SessionEventSink } from "../../src/storage/session_event_sink/session-event-sink.js";
import { createEditToolDefinition } from "../../src/tools/builtin/edit/edit-tool.js";
import { ToolDispatcher } from "../../src/tools/dispatcher/tool-dispatcher.js";
import { ToolRegistry } from "../../src/tools/registry/tool-registry.js";
import { createTempWorkspace } from "../helpers/temp-workspace.js";

const executeFile = promisify(execFile);
const time = "2026-08-20T00:00:00.000Z";
const digest = "c".repeat(64);
const config: RunConfigSnapshot = {
  modelConfigId: "fake",
  limits: {
    maxModelRequests: null,
    maxToolCalls: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    maxTotalTokens: null,
    maxCostUsdMicros: null,
    deadlineMs: null,
  },
  enabledToolSchemaDigest: digest,
  policyVersion: "m3-v1",
  sandboxProfileVersion: "workspace-m3-v2",
  baseConfigDigest: digest,
};

function run(): Run {
  return {
    schemaVersion: 1,
    runId: "run-cross-process",
    turn: {
      turnId: "turn-cross-process",
      userMessage: {
        schemaVersion: 1,
        messageId: "user-cross-process",
        role: "user",
        content: "create marker",
      },
    },
    createdAt: time,
  };
}

class EditThenCrashModel implements ModelClientPort {
  stream(request: Readonly<ModelRequest>): AsyncIterable<ModelEvent> {
    return (async function* () {
      yield {
        schemaVersion: 1,
        requestId: request.requestId,
        sequence: 1,
        type: "tool_call_started",
        callId: "call-cross",
        name: "edit",
        ordinal: 0,
      };
      yield {
        schemaVersion: 1,
        requestId: request.requestId,
        sequence: 2,
        type: "tool_arguments_delta",
        callId: "call-cross",
        delta: '{"mode":"create","path":"marker.txt","newText":"executed"}',
      };
      yield {
        schemaVersion: 1,
        requestId: request.requestId,
        sequence: 3,
        type: "completed",
        reason: "tool_calls",
      };
    })();
  }
}

class CrashAfterConcreteEdit implements ToolExecutorPort {
  constructor(private readonly dispatcher: ToolDispatcher) {}

  async execute(
    call: Readonly<ToolCall>,
    options: Readonly<ToolExecutionOptions>,
  ): Promise<ToolResult> {
    const result = await this.dispatcher.execute(call, options);
    if (result.status !== "success") {
      throw new Error("真实 edit 未成功，不能进入故障注入点");
    }
    // Vitest 使用 fork worker；同时杀死 runner 主进程和当前 worker，模拟不可捕获的断电。
    process.kill(process.ppid, "SIGKILL");
    process.kill(process.pid, "SIGKILL");
    return await new Promise<never>(() => undefined);
  }
}

async function createCrashWindow(databasePath: string, workspaceRoot: string): Promise<never> {
  const workspaceSandbox = await WorkspaceSandbox.create(workspaceRoot);
  const workspace: WorkspaceReference = {
    identity: workspaceSandbox.identity,
    revision: await workspaceSandbox.revision(),
    reference: "workspace://cross-process",
  };
  const stores = await SqliteStores.open(databasePath);
  const runValue = run();
  await stores.create(
    { sessionId: "session-cross-process", recordId: "record-session", createdAt: time },
    { signal: new AbortController().signal },
  );
  await stores.append(
    "session-cross-process",
    1,
    [
      {
        recordId: "record-turn",
        recordType: "turn.started",
        schemaVersion: 1,
        recordedAt: time,
        payload: { run: runValue, config, workspace },
      },
    ],
    { signal: new AbortController().signal },
  );

  const registry = new ToolRegistry();
  registry.register(createEditToolDefinition(workspaceSandbox));
  const snapshot = registry.freeze(["edit"]);
  const dispatcher = new ToolDispatcher({
    registry: snapshot,
    permissionPolicy: new DefaultPermissionPolicy(),
    approval: new ApprovalCoordinator(
      new StaticApprovalRequester({ decision: "allow_once", reason: "e2e approved" }),
    ),
    capabilities: new Set(["workspace_read", "workspace_write"]),
    runId: runValue.runId,
    workspaceIdentity: workspaceSandbox.identity,
    workspaceRevision: () => workspaceSandbox.revision(),
    sandboxProfileVersion: config.sandboxProfileVersion,
  });
  const sessionSink = await SessionEventSink.connect(stores, "session-cross-process", {
    signal: new AbortController().signal,
  });
  await new RuntimeRunner({
    modelClient: new EditThenCrashModel(),
    toolExecutor: new CrashAfterConcreteEdit(dispatcher),
    eventSinks: [sessionSink],
  }).run({
    run: runValue,
    baseSystemPrompt: "agent",
    tools: [{ name: "edit", description: "edit", inputSchema: { type: "object" } }],
    tokenBudget: 10_000,
  });
  throw new Error("故障注入没有终止进程");
}

async function recoverCrashWindow(databasePath: string, resultPath: string): Promise<void> {
  const stores = await SqliteStores.open(databasePath);
  const coordinator = new RecoveryCoordinator({
    sessions: stores,
    checkpoints: stores,
    idFactory: () => "cross-process-result",
    now: () => new Date(time),
  });
  const options = { signal: new AbortController().signal };
  const first = await coordinator.recover("session-cross-process", options);
  const second = await coordinator.recover("session-cross-process", options);
  // toolBatch 在结算时写回 transcript；合成结果（outcome_unknown）应可被下一轮模型读取。
  const toolResults = first.state.transcript.filter((entry) => entry.kind === "tool_result");
  const firstToolResult = toolResults[0]?.kind === "tool_result" ? toolResults[0].result : null;
  await writeFile(
    resultPath,
    JSON.stringify({
      firstAction: first.action,
      firstStatus: first.state.status,
      toolBatchCleared: first.state.toolBatch === null,
      toolResultStatus: firstToolResult?.status ?? null,
      toolResultErrorCode: firstToolResult?.status === "error" ? firstToolResult.error.code : null,
      secondAction: second.action,
    }),
    "utf8",
  );
  await stores.close();
}

const childMode = process.env["M4_CHILD_MODE"];
if (childMode) {
  describe(`M4 child ${childMode}`, () => {
    it("执行单个真实跨进程阶段", async () => {
      const databasePath = process.env["M4_DATABASE_PATH"]!;
      const workspaceRoot = process.env["M4_WORKSPACE_ROOT"]!;
      const resultPath = process.env["M4_RESULT_PATH"]!;
      if (childMode === "create") await createCrashWindow(databasePath, workspaceRoot);
      else await recoverCrashWindow(databasePath, resultPath);
    });
  });
} else {
  describe("M4 cross-process recovery", () => {
    it("真实 edit 在 ToolResult 前崩溃时，新进程标记 outcome_unknown 且不重复副作用", async () => {
      const temp = await createTempWorkspace("m4-cross-process-");
      try {
        const databasePath = temp.resolve("sessions.sqlite");
        const workspaceRoot = temp.resolve("workspace");
        const resultPath = temp.resolve("recovery-result.json");
        await mkdir(workspaceRoot);
        const testFile = fileURLToPath(import.meta.url);
        const vitestCli = fileURLToPath(
          new URL("../../node_modules/vitest/vitest.mjs", import.meta.url),
        );
        const runChild = async (mode: "create" | "recover") =>
          executeFile(
            process.execPath,
            [vitestCli, "run", testFile, "--pool=forks", "--maxWorkers=1"],
            {
              cwd: process.cwd(),
              env: {
                ...process.env,
                M4_CHILD_MODE: mode,
                M4_DATABASE_PATH: databasePath,
                M4_WORKSPACE_ROOT: workspaceRoot,
                M4_RESULT_PATH: resultPath,
              },
              timeout: 20_000,
            },
          );

        await expect(runChild("create")).rejects.toMatchObject({ signal: "SIGKILL" });
        await runChild("recover");

        // marker.txt 来自真实 EditToolHandler；若恢复重放同一 create，测试会因 already_exists 失败。
        expect(await readFile(temp.resolve("workspace/marker.txt"), "utf8")).toBe("executed");
        expect(JSON.parse(await readFile(resultPath, "utf8"))).toEqual({
          firstAction: "side_effect_result_unknown",
          firstStatus: "failed",
          toolBatchCleared: true,
          toolResultStatus: "error",
          toolResultErrorCode: "outcome_unknown",
          secondAction: "terminal",
        });
      } finally {
        await temp.cleanup();
      }
    }, 30_000);
  });
}
