import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  ApprovalCoordinator,
  StaticApprovalRequester,
} from "../../src/policy/approval/approval-coordinator.js";
import { DefaultPermissionPolicy } from "../../src/policy/permissions/permission-policy.js";
import { ProcessSandbox } from "../../src/sandbox/process/process-sandbox.js";
import { WorkspaceSandbox } from "../../src/sandbox/workspace/workspace-sandbox.js";
import { createEditToolDefinition } from "../../src/tools/builtin/edit/edit-tool.js";
import { createCheckToolDefinition } from "../../src/tools/builtin/check/check-tool.js";
import { createReadToolDefinition } from "../../src/tools/builtin/read/read-tool.js";
import { createShellToolDefinition } from "../../src/tools/builtin/shell/shell-tool.js";
import { ToolDispatcher } from "../../src/tools/dispatcher/tool-dispatcher.js";
import { RegistryToolBatchPolicy, ToolRegistry } from "../../src/tools/registry/tool-registry.js";
import { createTempWorkspace } from "../helpers/temp-workspace.js";
import type { TempWorkspace } from "../helpers/temp-workspace.js";

const workspaces: TempWorkspace[] = [];
const execFileAsync = promisify(execFile);

async function workspace(): Promise<{ temp: TempWorkspace; sandbox: WorkspaceSandbox }> {
  const temp = await createTempWorkspace("m3-tools-");
  workspaces.push(temp);
  return { temp, sandbox: await WorkspaceSandbox.create(temp.root) };
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((entry) => entry.cleanup()));
});

describe("M3 ToolRegistry / Dispatcher / Sandbox", () => {
  it("check 区分 Session 访问树与 workspace 基线，并在对账后推进基线", async () => {
    const { temp, sandbox } = await workspace();
    await writeFile(temp.resolve("observed.txt"), "v1", "utf8");
    await writeFile(temp.resolve("unobserved.txt"), "v1", "utf8");
    await sandbox.captureBaseline();
    await sandbox.read("observed.txt");
    await writeFile(temp.resolve("observed.txt"), "v2", "utf8");
    await writeFile(temp.resolve("unobserved.txt"), "v2", "utf8");

    const sessionReport = await sandbox.checkConsistency("session");
    expect(sessionReport).toMatchObject({
      scope: "session",
      status: "drift_detected",
      changedPaths: ["observed.txt"],
      checkedPaths: 1,
    });
    expect((await sandbox.checkConsistency("session")).status).toBe("clean");

    const workspaceReport = await sandbox.checkConsistency("workspace");
    expect(workspaceReport.status).toBe("drift_detected");
    expect(workspaceReport.changedPaths).toEqual(["observed.txt", "unobserved.txt"]);
    expect((await sandbox.checkConsistency("workspace")).status).toBe("clean");
  });

  it("Agent edit 只合并自己的路径节点，不吞掉并发外部变动", async () => {
    const { temp, sandbox } = await workspace();
    await writeFile(temp.resolve("agent.txt"), "agent-v1", "utf8");
    await writeFile(temp.resolve("external.txt"), "external-v1", "utf8");
    await sandbox.captureBaseline();
    const agentFile = await sandbox.read("agent.txt");
    await writeFile(temp.resolve("external.txt"), "external-v2", "utf8");

    await sandbox.replace("agent.txt", "agent-v1", "agent-v2", agentFile.revision);
    const report = await sandbox.checkConsistency("workspace");

    expect(report.changedPaths).toEqual(["external.txt"]);
    expect(await readFile(temp.resolve("agent.txt"), "utf8")).toBe("agent-v2");
  });

  it("check 工具是无需 revision 与审批的显式只读对账", async () => {
    const { temp, sandbox } = await workspace();
    await writeFile(temp.resolve("tracked.txt"), "before", "utf8");
    await sandbox.captureBaseline();
    await sandbox.read("tracked.txt");
    await writeFile(temp.resolve("tracked.txt"), "outside", "utf8");
    const registry = new ToolRegistry();
    registry.register(createCheckToolDefinition(sandbox));
    let revisionCalls = 0;
    const dispatcher = new ToolDispatcher({
      registry: registry.freeze(["check"]),
      permissionPolicy: new DefaultPermissionPolicy(),
      capabilities: new Set(["workspace_read"]),
      runId: "run-check",
      workspaceIdentity: sandbox.identity,
      workspaceRevision: async () => {
        revisionCalls += 1;
        return sandbox.revision();
      },
      sandboxProfileVersion: "workspace-m3-v1",
    });
    const result = await dispatcher.execute(
      {
        schemaVersion: 1,
        callId: "call-check",
        name: "check",
        arguments: { scope: "session" },
      },
      { signal: new AbortController().signal },
    );

    expect(result.status).toBe("success");
    expect(JSON.stringify(result.output)).toContain("tracked.txt");
    expect(revisionCalls).toBe(0);
  });

  it("strict 模式在审批前发现外部漂移并让风险操作失效", async () => {
    const temp = await createTempWorkspace("m3-strict-");
    workspaces.push(temp);
    const sandbox = await WorkspaceSandbox.create(temp.root, { consistencyMode: "strict" });
    await writeFile(temp.resolve("source.ts"), "export const value = 1;\n", "utf8");
    await sandbox.captureBaseline();
    const file = await sandbox.read("source.ts");
    await writeFile(temp.resolve("outside.txt"), "external", "utf8");
    const registry = new ToolRegistry();
    registry.register(createEditToolDefinition(sandbox));
    const requester = new StaticApprovalRequester({
      decision: "allow_once",
      reason: "should-not-be-reached",
    });
    const dispatcher = new ToolDispatcher({
      registry: registry.freeze(["edit"]),
      permissionPolicy: new DefaultPermissionPolicy(),
      approval: new ApprovalCoordinator(requester),
      capabilities: new Set(["workspace_read", "workspace_write"]),
      runId: "run-strict",
      workspaceIdentity: sandbox.identity,
      workspaceRevision: () => sandbox.revision(),
      reconcileBeforeApproval: async () => {
        const report = await sandbox.checkConsistency("workspace");
        return { changedPaths: report.changedPaths };
      },
      sandboxProfileVersion: "workspace-m3-v1",
    });

    const result = await dispatcher.execute(
      {
        schemaVersion: 1,
        callId: "call-strict-edit",
        name: "edit",
        arguments: {
          mode: "replace",
          path: "source.ts",
          oldText: "value = 1",
          newText: "value = 2",
          expectedRevision: file.revision,
        },
      },
      { signal: new AbortController().signal },
    );

    expect(result.status === "error" && result.error.code).toBe("approval_denied");
    expect(requester.requests).toHaveLength(0);
    expect(await readFile(temp.resolve("source.ts"), "utf8")).toContain("value = 1");
  });

  it("Git 工作区用 porcelain 基线跟踪脏路径，依赖目录保持稀疏", async () => {
    const { temp, sandbox } = await workspace();
    await execFileAsync("/usr/bin/git", ["init", "--quiet", temp.root]);
    await writeFile(temp.resolve(".gitignore"), "node_modules/\n", "utf8");
    await writeFile(temp.resolve("tracked.txt"), "before", "utf8");
    await execFileAsync("/usr/bin/git", ["-C", temp.root, "add", ".gitignore", "tracked.txt"]);
    const before = await sandbox.snapshot();
    await writeFile(temp.resolve("tracked.txt"), "after!", "utf8");
    await mkdir(temp.resolve("node_modules"), { recursive: true });
    await writeFile(temp.resolve("node_modules/generated.js"), "generated", "utf8");
    const after = await sandbox.snapshot();

    expect(before.strategy).toBe("git_status_v1");
    expect(after.strategy).toBe("git_status_v1");
    expect(sandbox.diff(before, after)).toEqual(["tracked.txt"]);
    expect([...after.files.keys()]).not.toContain("node_modules/generated.js");
  });

  it("read 只读取 workspace 普通 UTF-8 文件，并拒绝越界与 symlink", async () => {
    const { temp, sandbox } = await workspace();
    await writeFile(temp.resolve("hello.txt"), "第一行\n第二行\n", "utf8");
    const outside = await createTempWorkspace("m3-outside-");
    workspaces.push(outside);
    await writeFile(outside.resolve("secret.txt"), "secret", "utf8");
    await symlink(outside.resolve("secret.txt"), temp.resolve("escape.txt"));
    await symlink(outside.root, temp.resolve("directory-escape"));

    const registry = new ToolRegistry();
    registry.register(createReadToolDefinition(sandbox));
    const snapshot = registry.freeze(["read"]);
    const dispatcher = new ToolDispatcher({
      registry: snapshot,
      permissionPolicy: new DefaultPermissionPolicy(),
      capabilities: new Set(["workspace_read"]),
      runId: "run-read",
      workspaceIdentity: sandbox.identity,
      workspaceRevision: () => sandbox.revision(),
      sandboxProfileVersion: "workspace-m3-v1",
    });

    const ok = await dispatcher.execute(
      {
        schemaVersion: 1,
        callId: "call-read",
        name: "read",
        arguments: { path: "hello.txt", startLine: 2, endLine: 2 },
      },
      { signal: new AbortController().signal },
    );
    expect(ok.status).toBe("success");
    expect(ok.output[0]).toEqual({ kind: "text", text: "第二行" });
    expect(ok.effects.sideEffect).toBe("none");

    for (const [index, path] of [
      "../outside",
      "escape.txt",
      "directory-escape/secret.txt",
    ].entries()) {
      const denied = await dispatcher.execute(
        { schemaVersion: 1, callId: `call-denied-${index}`, name: "read", arguments: { path } },
        { signal: new AbortController().signal },
      );
      expect(denied.status).toBe("error");
      expect(denied.status === "error" && denied.error.code).toBe("permission_denied");
      expect(JSON.stringify(denied)).not.toContain("secret");
    }
  });

  it("只读、硬拒绝和能力缺失路径不生成 workspace revision", async () => {
    const { temp, sandbox } = await workspace();
    await writeFile(temp.resolve("hello.txt"), "hello", "utf8");
    const registry = new ToolRegistry();
    registry.register(createReadToolDefinition(sandbox));
    const tools = registry.freeze(["read"]);
    let revisionCalls = 0;
    const dispatcher = new ToolDispatcher({
      registry: tools,
      permissionPolicy: new DefaultPermissionPolicy(),
      capabilities: new Set(["workspace_read"]),
      runId: "run-read-no-revision",
      workspaceIdentity: sandbox.identity,
      workspaceRevision: async () => {
        revisionCalls += 1;
        return sandbox.revision();
      },
      sandboxProfileVersion: "workspace-m3-v1",
    });

    const allowed = await dispatcher.execute(
      {
        schemaVersion: 1,
        callId: "call-read-no-revision",
        name: "read",
        arguments: { path: "hello.txt" },
      },
      { signal: new AbortController().signal },
    );
    const denied = await dispatcher.execute(
      {
        schemaVersion: 1,
        callId: "call-read-hidden-no-revision",
        name: "read",
        arguments: { path: ".oracle/answer.txt" },
      },
      { signal: new AbortController().signal },
    );

    expect(allowed.status).toBe("success");
    expect(denied.status === "error" && denied.error.code).toBe("permission_denied");
    expect(revisionCalls).toBe(0);
  });

  it("edit 经过 Ask→AllowOnce 后原子替换，拒绝审批时零副作用", async () => {
    const { temp, sandbox } = await workspace();
    await writeFile(temp.resolve("source.ts"), "export const value = 1;\n", "utf8");
    const before = await sandbox.read("source.ts");
    const registry = new ToolRegistry();
    registry.register(createEditToolDefinition(sandbox));
    const snapshot = registry.freeze(["edit"]);
    const requester = new StaticApprovalRequester({ decision: "deny", reason: "operator denied" });
    const base = {
      registry: snapshot,
      permissionPolicy: new DefaultPermissionPolicy(),
      capabilities: new Set(["workspace_read", "workspace_write"] as const),
      runId: "run-edit",
      workspaceIdentity: sandbox.identity,
      workspaceRevision: () => sandbox.revision(),
      sandboxProfileVersion: "workspace-m3-v1",
    };
    const call = {
      schemaVersion: 1 as const,
      callId: "call-edit",
      name: "edit",
      arguments: {
        mode: "replace",
        path: "source.ts",
        oldText: "value = 1",
        newText: "value = 2",
        expectedRevision: before.revision,
      },
    };

    const denied = await new ToolDispatcher({
      ...base,
      approval: new ApprovalCoordinator(requester),
    }).execute(call, { signal: new AbortController().signal });
    expect(denied.status === "error" && denied.error.code).toBe("approval_denied");
    expect(await readFile(temp.resolve("source.ts"), "utf8")).toContain("value = 1");
    expect(requester.requests).toHaveLength(1);

    const allowedRequester = new StaticApprovalRequester({
      decision: "allow_once",
      reason: "approved",
    });
    const allowed = await new ToolDispatcher({
      ...base,
      approval: new ApprovalCoordinator(allowedRequester),
    }).execute(call, { signal: new AbortController().signal });
    expect(allowed.status).toBe("success");
    expect(allowed.effects.sideEffect).toBe("confirmed");
    expect(allowed.effects.changedPaths).toEqual(["source.ts"]);
    // 文件 revision 用于 expectedRevision；effects 中必须是整个 workspace 的恢复版本。
    expect(allowed.effects.workspaceRevision).toBe(await sandbox.revision());
    expect(await readFile(temp.resolve("source.ts"), "utf8")).toContain("value = 2");
    expect(allowedRequester.requests[0]?.argumentsPreview).not.toContain(temp.root);
  });

  it("只并行可信独立只读调用，effectful 与 unknown 调用保持串行", async () => {
    const { sandbox } = await workspace();
    const registry = new ToolRegistry();
    registry.register(createReadToolDefinition(sandbox));
    registry.register(createEditToolDefinition(sandbox));
    const snapshot = registry.freeze(["read", "edit"]);
    const policy = new RegistryToolBatchPolicy(snapshot);
    expect(
      policy.plan([
        { schemaVersion: 1, callId: "a", name: "read", arguments: { path: "a" } },
        { schemaVersion: 1, callId: "b", name: "read", arguments: { path: "b" } },
      ]),
    ).toEqual([{ mode: "parallel_read_only", callIds: ["a", "b"] }]);
    expect(
      policy.plan([
        { schemaVersion: 1, callId: "a", name: "read", arguments: { path: "a" } },
        { schemaVersion: 1, callId: "b", name: "edit", arguments: {} },
        { schemaVersion: 1, callId: "c", name: "hidden", arguments: {} },
      ]),
    ).toEqual([
      { mode: "serial", callIds: ["a"] },
      { mode: "serial", callIds: ["b"] },
      { mode: "serial", callIds: ["c"] },
    ]);
  });

  it("隔离能力缺失时 shell fail closed，不启动 handler", async () => {
    const { temp, sandbox } = await workspace();
    const processSandbox = new ProcessSandbox(
      {
        available: false,
        version: "bwrap-m3-v1",
        bwrapPath: null,
        reason: "missing",
      },
      temp.root,
      sandbox,
    );
    const registry = new ToolRegistry();
    registry.register(createShellToolDefinition(processSandbox));
    const snapshot = registry.freeze(["shell"]);
    const dispatcher = new ToolDispatcher({
      registry: snapshot,
      permissionPolicy: new DefaultPermissionPolicy(),
      approval: new ApprovalCoordinator(
        new StaticApprovalRequester({ decision: "allow_once", reason: "approved" }),
      ),
      capabilities: new Set(["workspace_read", "workspace_write"]),
      runId: "run-shell",
      workspaceIdentity: sandbox.identity,
      workspaceRevision: () => sandbox.revision(),
      sandboxProfileVersion: processSandbox.profile.version,
    });
    const result = await dispatcher.execute(
      {
        schemaVersion: 1,
        callId: "call-shell",
        name: "shell",
        arguments: { command: "touch should-not-exist" },
      },
      { signal: new AbortController().signal },
    );
    expect(result.status === "error" && result.error.code).toBe("sandbox_unavailable");
    await expect(readFile(temp.resolve("should-not-exist"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("审批等待期间 workspace 变化时 AllowOnce 失效，handler 保持零调用", async () => {
    const { temp, sandbox } = await workspace();
    const registry = new ToolRegistry();
    registry.register(createEditToolDefinition(sandbox));
    const snapshot = registry.freeze(["edit"]);
    const requester = {
      async request() {
        // 模拟用户审批期间另一个进程修改了 workspace。
        await writeFile(temp.resolve("changed-during-approval.txt"), "changed", "utf8");
        return { decision: "allow_once" as const, reason: "approved" };
      },
    };
    const dispatcher = new ToolDispatcher({
      registry: snapshot,
      permissionPolicy: new DefaultPermissionPolicy(),
      approval: new ApprovalCoordinator(requester),
      capabilities: new Set(["workspace_read", "workspace_write"]),
      runId: "run-approval-race",
      workspaceIdentity: sandbox.identity,
      workspaceRevision: () => sandbox.revision(),
      sandboxProfileVersion: "workspace-m3-v1",
    });

    const result = await dispatcher.execute(
      {
        schemaVersion: 1,
        callId: "call-create-after-approval",
        name: "edit",
        arguments: { mode: "create", path: "must-not-exist.txt", newText: "unsafe" },
      },
      { signal: new AbortController().signal },
    );

    expect(result.status === "error" && result.error.code).toBe("approval_denied");
    await expect(readFile(temp.resolve("must-not-exist.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("ProcessSandbox 参数屏蔽隐藏资源、只读挂载 .git，并从受信 fd 绑定 workspace", async () => {
    const { temp, sandbox } = await workspace();
    await mkdir(temp.resolve(".oracle"));
    await writeFile(temp.resolve(".oracle/answer.txt"), "hidden", "utf8");
    await mkdir(temp.resolve(".git"));
    await writeFile(temp.resolve(".git/config"), "private", "utf8");
    await writeFile(temp.resolve(".env"), "TOKEN=secret", "utf8");

    const harness = await createTempWorkspace("m3-fake-bwrap-");
    workspaces.push(harness);
    const capturePath = harness.resolve("arguments.txt");
    const fakeBwrap = harness.resolve("fake-bwrap.sh");
    await writeFile(
      fakeBwrap,
      "#!/bin/sh\nprintf '%s\\n' \"$@\" > '" + capturePath + "'\nexit 0\n",
      "utf8",
    );
    await chmod(fakeBwrap, 0o755);

    const processSandbox = new ProcessSandbox(
      {
        available: true,
        version: "bwrap-m3-v2:test",
        bwrapPath: fakeBwrap,
        reason: null,
      },
      temp.root,
      sandbox,
    );
    await processSandbox.execute({
      command: "true",
      cwd: ".",
      timeoutMs: 5_000,
      outputLimitBytes: 1_024,
      signal: new AbortController().signal,
    });

    const argumentsText = await readFile(capturePath, "utf8");
    expect(argumentsText).toContain("--bind-fd\n3\n/workspace");
    expect(argumentsText).toContain("--tmpfs\n/workspace/.oracle");
    expect(argumentsText).toContain("--ro-bind\n/proc/self/fd/3/.git\n/workspace/.git");
    expect(argumentsText).toContain("--ro-bind\n/dev/null\n/workspace/.env");
    expect(argumentsText).not.toContain(temp.root);
  });
});
