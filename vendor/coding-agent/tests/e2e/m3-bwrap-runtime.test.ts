import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import type {
  ModelClientPort,
  ModelEvent,
  ModelRequest,
} from "../../src/core/ports/model_client/model-client-port.js";
import { RuntimeRunner } from "../../src/core/runtime/loop/runtime-runner.js";
import {
  ApprovalCoordinator,
  StaticApprovalRequester,
} from "../../src/policy/approval/approval-coordinator.js";
import { DefaultPermissionPolicy } from "../../src/policy/permissions/permission-policy.js";
import { ProcessSandbox } from "../../src/sandbox/process/process-sandbox.js";
import { WorkspaceSandbox } from "../../src/sandbox/workspace/workspace-sandbox.js";
import { createEditToolDefinition } from "../../src/tools/builtin/edit/edit-tool.js";
import { createReadToolDefinition } from "../../src/tools/builtin/read/read-tool.js";
import { createShellToolDefinition } from "../../src/tools/builtin/shell/shell-tool.js";
import { ToolDispatcher } from "../../src/tools/dispatcher/tool-dispatcher.js";
import { RegistryToolBatchPolicy, ToolRegistry } from "../../src/tools/registry/tool-registry.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

const workspaces: TempWorkspace[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.cleanup()));
});

function toolEvents(requestId: string, callId: string, name: string, args: object): ModelEvent[] {
  return [
    {
      schemaVersion: 1,
      requestId,
      sequence: 1,
      type: "tool_call_started",
      callId,
      name,
      ordinal: 0,
    },
    {
      schemaVersion: 1,
      requestId,
      sequence: 2,
      type: "tool_arguments_delta",
      callId,
      delta: JSON.stringify(args),
    },
    {
      schemaVersion: 1,
      requestId,
      sequence: 3,
      type: "completed",
      reason: "tool_calls",
    },
  ];
}

class ToolChainReplayModel implements ModelClientPort {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly expectedRevision: string) {}

  async *stream(request: Readonly<ModelRequest>): AsyncIterable<ModelEvent> {
    const call = this.requests.length;
    this.requests.push(structuredClone(request));
    const events =
      call === 0
        ? toolEvents(request.requestId, "call-read", "read", { path: "src/value.txt" })
        : call === 1
          ? toolEvents(request.requestId, "call-edit", "edit", {
              mode: "replace",
              path: "src/value.txt",
              oldText: "value=1\n",
              newText: "value=2\n",
              expectedRevision: this.expectedRevision,
            })
          : call === 2
            ? toolEvents(request.requestId, "call-shell", "shell", {
                command: 'test "$(cat src/value.txt)" = "value=2" && printf shell-ok',
                cwd: ".",
                timeoutMs: 5_000,
              })
            : [
                {
                  schemaVersion: 1 as const,
                  requestId: request.requestId,
                  sequence: 1,
                  type: "text_delta" as const,
                  delta: "isolated tool chain complete",
                },
                {
                  schemaVersion: 1 as const,
                  requestId: request.requestId,
                  sequence: 2,
                  type: "completed" as const,
                  reason: "final_answer" as const,
                },
              ];
    for (const event of events) yield event;
  }
}

async function requireProcessSandbox(workspace: TempWorkspace) {
  const sandbox = await WorkspaceSandbox.create(workspace.root);
  const configuredPath = process.env["CODING_AGENT_BWRAP_PATH"];
  const profile = await ProcessSandbox.probe(
    workspace.root,
    sandbox,
    configuredPath ? { bwrapPath: configuredPath } : {},
  );
  if (!profile.available) {
    if (process.env["CODING_AGENT_REQUIRE_BWRAP"] === "1") {
      throw new Error(`M3-08 要求真实 bubblewrap，但 capability probe 失败: ${profile.reason}`);
    }
    return null;
  }
  return { workspace: sandbox, process: new ProcessSandbox(profile, workspace.root, sandbox) };
}

async function waitForFile(file: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(file);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`等待文件超时: ${file}`);
}

async function processMarkerExists(marker: string): Promise<boolean> {
  const entries = await readdir("/proc", { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const commandLine = await readFile(`/proc/${entry.name}/cmdline`, "utf8");
      if (commandLine.includes(marker)) return true;
    } catch {
      // 进程可能在扫描期间退出，或不允许当前用户读取。
    }
  }
  return false;
}

describe("M3-08 real bubblewrap gate", () => {
  it("通过真实 Dispatcher 完成 read→edit→shell→final，且隐藏资源不可见", async (context) => {
    const workspace = await createTempWorkspace("m3-bwrap-happy-");
    workspaces.push(workspace);
    await mkdir(workspace.resolve("src"), { recursive: true });
    await mkdir(workspace.resolve(".oracle"), { recursive: true });
    await writeFile(workspace.resolve("src", "value.txt"), "value=1\n", "utf8");
    await writeFile(workspace.resolve(".oracle", "answer.txt"), "do-not-leak\n", "utf8");

    const isolated = await requireProcessSandbox(workspace);
    if (!isolated) {
      context.skip();
      return;
    }
    const expectedRevision = (await isolated.workspace.read("src/value.txt", 1_024)).revision;
    const model = new ToolChainReplayModel(expectedRevision);
    const registry = new ToolRegistry();
    registry.register(createReadToolDefinition(isolated.workspace));
    registry.register(createEditToolDefinition(isolated.workspace));
    registry.register(createShellToolDefinition(isolated.process));
    const tools = registry.freeze(["read", "edit", "shell"]);
    const dispatcher = new ToolDispatcher({
      registry: tools,
      permissionPolicy: new DefaultPermissionPolicy({ policyVersion: "m3-e2e-v1" }),
      approval: new ApprovalCoordinator(
        new StaticApprovalRequester({ decision: "allow_once", reason: "m3_e2e_fixture" }),
      ),
      capabilities: new Set([
        "workspace_read",
        "workspace_write",
        "isolated_process",
        "network_isolated",
      ]),
      runId: "run-m3-bwrap-happy",
      workspaceIdentity: isolated.workspace.identity,
      workspaceRevision: () => isolated.workspace.revision(),
      sandboxProfileVersion: isolated.process.profile.version,
    });
    const runner = new RuntimeRunner({
      modelClient: model,
      toolExecutor: dispatcher,
      toolBatchPolicy: new RegistryToolBatchPolicy(tools),
      limits: {
        maxModelRequests: 4,
        maxToolCalls: 3,
        maxInputTokens: null,
        maxOutputTokens: null,
        maxTotalTokens: null,
        maxCostUsdMicros: null,
        deadlineMs: 20_000,
      },
    });

    const state = await runner.run({
      run: {
        schemaVersion: 1,
        runId: "run-m3-bwrap-happy",
        turn: {
          turnId: "turn-m3-bwrap-happy",
          userMessage: {
            schemaVersion: 1,
            messageId: "message-m3-bwrap-happy",
            role: "user",
            content: "把 value 改为 2 并运行检查",
          },
        },
        createdAt: "2026-08-26T00:00:00.000Z",
      },
      baseSystemPrompt: "只使用提供的工具。",
      tools: tools.modelToolSpecs(),
      tokenBudget: 8_000,
      maxOutputTokens: 256,
    });

    expect(state.status).toBe("completed");
    expect(model.requests).toHaveLength(4);
    expect(await readFile(workspace.resolve("src", "value.txt"), "utf8")).toBe("value=2\n");
    expect(await readFile(workspace.resolve(".oracle", "answer.txt"), "utf8")).toBe(
      "do-not-leak\n",
    );
    expect(JSON.stringify(state.transcript)).toContain("shell-ok");
    expect(JSON.stringify(state.transcript)).not.toContain("do-not-leak");
  });

  it("真实隔离进程在超时、取消和大输出时有界结束", async (context) => {
    const workspace = await createTempWorkspace("m3-bwrap-process-");
    workspaces.push(workspace);
    const isolated = await requireProcessSandbox(workspace);
    if (!isolated) {
      context.skip();
      return;
    }

    const timeoutMarker = `m3-orphan-timeout-${String(process.pid)}`;
    const timeout = await isolated.process.execute({
      command: `bash -c 'exec -a ${timeoutMarker} sleep 30' & wait`,
      cwd: ".",
      timeoutMs: 100,
      outputLimitBytes: 128,
      signal: new AbortController().signal,
    });
    expect(timeout.timedOut).toBe(true);
    expect(timeout.cancelled).toBe(false);
    expect(await processMarkerExists(timeoutMarker)).toBe(false);

    const controller = new AbortController();
    const cancelMarker = `m3-orphan-cancel-${String(process.pid)}`;
    const cancelledPromise = isolated.process.execute({
      command: `touch cancel-started && bash -c 'exec -a ${cancelMarker} sleep 30' & wait`,
      cwd: ".",
      timeoutMs: 10_000,
      outputLimitBytes: 128,
      signal: controller.signal,
    });
    await waitForFile(workspace.resolve("cancel-started"));
    controller.abort(new Error("m3_e2e_cancel"));
    const cancelled = await cancelledPromise;
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.timedOut).toBe(false);
    expect(await processMarkerExists(cancelMarker)).toBe(false);

    const network = await isolated.process.execute({
      command: "bash -c 'exec 9<>/dev/tcp/1.1.1.1/53'",
      cwd: ".",
      timeoutMs: 2_000,
      outputLimitBytes: 128,
      signal: new AbortController().signal,
    });
    expect(network.exitCode).not.toBe(0);
    expect(network.timedOut).toBe(false);
    expect(network.cancelled).toBe(false);

    await writeFile(workspace.resolve("cache_probe.py"), "VALUE = 1\n", "utf8");
    const python = await isolated.process.execute({
      command: 'python3 -c "import cache_probe; print(cache_probe.VALUE)"',
      cwd: ".",
      timeoutMs: 5_000,
      outputLimitBytes: 128,
      signal: new AbortController().signal,
    });
    expect(python.exitCode).toBe(0);
    expect(python.stdout.text.trim()).toBe("1");
    await expect(access(workspace.resolve("__pycache__"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const output = await isolated.process.execute({
      command: "yes x | head -c 8192",
      cwd: ".",
      timeoutMs: 5_000,
      outputLimitBytes: 128,
      signal: new AbortController().signal,
    });
    expect(output.exitCode).toBe(0);
    expect(output.stdout.totalBytes).toBe(8_192);
    expect(output.stdout.text).toHaveLength(128);
    expect(output.stdout.truncated).toBe(true);
  });
});
