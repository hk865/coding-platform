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
import type { EventSinkPort } from "../../src/core/ports/event_sink/event-sink-port.js";
import type {
  RunConfigSnapshot,
  WorkspaceReference,
} from "../../src/core/ports/session_store/session-store-port.js";
import type {
  ToolCall,
  ToolExecutorPort,
  ToolResult,
} from "../../src/core/ports/tool_executor/tool-executor-port.js";
import { CheckpointingEventSink } from "../../src/core/runtime/checkpointing/checkpointing-event-sink.js";
import { RuntimeRunner } from "../../src/core/runtime/loop/runtime-runner.js";
import { RecoveryCoordinator } from "../../src/core/runtime/recovery/recovery-coordinator.js";
import { createInitialRunState } from "../../src/core/runtime/state/run-state.js";
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
const digest = "d".repeat(64);
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
    runId: "run-stable-cross-process",
    turn: {
      turnId: "turn-stable-cross-process",
      userMessage: {
        schemaVersion: 1,
        messageId: "user-stable-cross-process",
        role: "user",
        content: "create stable marker",
      },
    },
    createdAt: time,
  };
}

class EditModel implements ModelClientPort {
  stream(request: Readonly<ModelRequest>): AsyncIterable<ModelEvent> {
    return (async function* () {
      yield {
        schemaVersion: 1,
        requestId: request.requestId,
        sequence: 1,
        type: "tool_call_started",
        callId: "call-stable-edit",
        name: "edit",
        ordinal: 0,
      };
      yield {
        schemaVersion: 1,
        requestId: request.requestId,
        sequence: 2,
        type: "tool_arguments_delta",
        callId: "call-stable-edit",
        delta: '{"mode":"create","path":"stable.txt","newText":"once"}',
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

class FinalModel implements ModelClientPort {
  stream(request: Readonly<ModelRequest>): AsyncIterable<ModelEvent> {
    return (async function* () {
      yield {
        schemaVersion: 1,
        requestId: request.requestId,
        sequence: 1,
        type: "text_delta",
        delta: "恢复后完成",
      };
      yield {
        schemaVersion: 1,
        requestId: request.requestId,
        sequence: 2,
        type: "completed",
        reason: "final_answer",
      };
    })();
  }
}

class NeverTool implements ToolExecutorPort {
  async execute(call: Readonly<ToolCall>): Promise<ToolResult> {
    throw new Error(`已完成的工具不应重放：${call.callId}`);
  }
}

class CrashAfterStableCheckpoint implements EventSinkPort {
  readonly sinkId = "zz-crash-after-stable-checkpoint";
  readonly delivery = "best_effort" as const;

  async publish(event: Parameters<EventSinkPort["publish"]>[0]): Promise<void> {
    if (event.type !== "tool.completed") return;
    // SessionEventSink 与 CheckpointingEventSink 的 id 排在本 sink 前面；
    // 到达这里说明 ToolResult 事实和稳定 checkpoint 都已提交。
    process.kill(process.ppid, "SIGKILL");
    process.kill(process.pid, "SIGKILL");
    await new Promise<never>(() => undefined);
  }
}

async function createStableWindow(databasePath: string, workspaceRoot: string): Promise<never> {
  const workspaceSandbox = await WorkspaceSandbox.create(workspaceRoot);
  const workspace: WorkspaceReference = {
    identity: workspaceSandbox.identity,
    revision: await workspaceSandbox.revision(),
    reference: "workspace://stable-cross-process",
  };
  const stores = await SqliteStores.open(databasePath);
  const runValue = run();
  const options = { signal: new AbortController().signal };
  await stores.create(
    { sessionId: "session-stable-cross-process", recordId: "record-session", createdAt: time },
    options,
  );
  await stores.append(
    "session-stable-cross-process",
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
    options,
  );

  const registry = new ToolRegistry();
  registry.register(createEditToolDefinition(workspaceSandbox));
  const dispatcher = new ToolDispatcher({
    registry: registry.freeze(["edit"]),
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
  const sessionSink = await SessionEventSink.connect(
    stores,
    "session-stable-cross-process",
    options,
  );
  const checkpointSink = new CheckpointingEventSink(
    createInitialRunState(runValue),
    stores,
    sessionSink,
    config,
    workspace,
  );
  await new RuntimeRunner({
    modelClient: new EditModel(),
    toolExecutor: dispatcher,
    eventSinks: [sessionSink, checkpointSink, new CrashAfterStableCheckpoint()],
  }).run({
    run: runValue,
    baseSystemPrompt: "agent",
    tools: [{ name: "edit", description: "edit", inputSchema: { type: "object" } }],
    tokenBudget: 10_000,
  });
  throw new Error("故障注入没有终止进程");
}

async function recoverToFinal(
  databasePath: string,
  workspaceRoot: string,
  resultPath: string,
): Promise<void> {
  const stores = await SqliteStores.open(databasePath);
  const workspaceSandbox = await WorkspaceSandbox.create(workspaceRoot);
  const currentWorkspace: WorkspaceReference = {
    identity: workspaceSandbox.identity,
    revision: await workspaceSandbox.revision(),
    reference: "workspace://stable-cross-process",
  };
  const options = { signal: new AbortController().signal };
  const recovered = await new RecoveryCoordinator({
    sessions: stores,
    checkpoints: stores,
  }).recover("session-stable-cross-process", options, {
    config,
    workspace: currentWorkspace,
  });
  const sessionSink = await SessionEventSink.connect(
    stores,
    "session-stable-cross-process",
    options,
  );
  const finalState = await new RuntimeRunner({
    modelClient: new FinalModel(),
    toolExecutor: new NeverTool(),
    eventSinks: [sessionSink],
  }).continueRecovered(
    recovered.state,
    {
      run: run(),
      baseSystemPrompt: "agent",
      tools: [{ name: "edit", description: "edit", inputSchema: { type: "object" } }],
      tokenBudget: 10_000,
    },
    options,
  );
  const records = await stores.read("session-stable-cross-process", 0, 100, options);
  const events = records.records.filter((record) => record.recordType === "agent.event");
  const latestCheckpoint = await stores.loadLatest(run().runId, options);
  await writeFile(
    resultPath,
    JSON.stringify({
      action: recovered.action,
      finalStatus: finalState.status,
      runStartedCount: events.filter((record) => record.payload.event.type === "run.started")
        .length,
      toolCompletedCount: events.filter((record) => record.payload.event.type === "tool.completed")
        .length,
      terminalCount: events.filter((record) =>
        ["run.completed", "run.cancelled", "run.limit_exceeded", "run.failed"].includes(
          record.payload.event.type,
        ),
      ).length,
      checkpointRevision: latestCheckpoint?.workspace.revision,
      currentRevision: currentWorkspace.revision,
    }),
    "utf8",
  );
  await stores.close();
}

const childMode = process.env["M4_STABLE_CHILD_MODE"];
if (childMode) {
  describe(`M4 stable child ${childMode}`, () => {
    it("执行真实稳定边界的跨进程阶段", async () => {
      const databasePath = process.env["M4_STABLE_DATABASE_PATH"]!;
      const workspaceRoot = process.env["M4_STABLE_WORKSPACE_ROOT"]!;
      const resultPath = process.env["M4_STABLE_RESULT_PATH"]!;
      if (childMode === "create") await createStableWindow(databasePath, workspaceRoot);
      else await recoverToFinal(databasePath, workspaceRoot, resultPath);
    });
  });
} else {
  describe("M4 stable cross-process recovery", () => {
    it("真实 edit 已提交后崩溃，新进程不重放副作用并继续到 final", async () => {
      const temp = await createTempWorkspace("m4-stable-cross-process-");
      try {
        const databasePath = temp.resolve("sessions.sqlite");
        const workspaceRoot = temp.resolve("workspace");
        const resultPath = temp.resolve("stable-result.json");
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
                M4_STABLE_CHILD_MODE: mode,
                M4_STABLE_DATABASE_PATH: databasePath,
                M4_STABLE_WORKSPACE_ROOT: workspaceRoot,
                M4_STABLE_RESULT_PATH: resultPath,
              },
              timeout: 20_000,
            },
          );

        await expect(runChild("create")).rejects.toMatchObject({ signal: "SIGKILL" });
        await runChild("recover");

        // create 模式若被重放，stable.txt 会因 already_exists 失败；内容和事件计数共同证明仅执行一次。
        expect(await readFile(temp.resolve("workspace/stable.txt"), "utf8")).toBe("once");
        const result = JSON.parse(await readFile(resultPath, "utf8"));
        expect(result).toMatchObject({
          action: "continue_before_model",
          finalStatus: "completed",
          runStartedCount: 1,
          toolCompletedCount: 1,
          terminalCount: 1,
        });
        expect(result.checkpointRevision).toBe(result.currentRevision);
      } finally {
        await temp.cleanup();
      }
    }, 30_000);
  });
}
