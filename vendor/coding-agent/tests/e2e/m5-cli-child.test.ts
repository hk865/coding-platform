import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceSandbox } from "../../src/sandbox/workspace/workspace-sandbox.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

interface RecordedRequest {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

interface ReplayServer {
  readonly baseUrl: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

interface CliResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

const workspaces: TempWorkspace[] = [];
const servers: ReplayServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.cleanup()));
});

function sse(response: http.ServerResponse, chunks: readonly object[]): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.end("data: [DONE]\n\n");
}

async function startReplayServer(
  handler: (
    index: number,
    request: RecordedRequest,
    response: http.ServerResponse,
  ) => void | Promise<void>,
): Promise<ReplayServer> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer(async (incoming, response) => {
    try {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      await once(incoming, "end");
      const raw = Buffer.concat(chunks).toString("utf8");
      const request = {
        url: incoming.url ?? "",
        body: JSON.parse(raw) as Record<string, unknown>,
      };
      const index = requests.length;
      requests.push(request);
      await handler(index, request, response);
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : "fixture failure");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function writeConfig(
  workspace: TempWorkspace,
  baseUrl: string,
  enabledNames: readonly string[],
): Promise<string> {
  await mkdir(workspace.resolve("resources", "skills"), { recursive: true });
  const configPath = workspace.resolve("coding-agent.json");
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      model: {
        provider: "deepseek",
        model: "fixture-model",
        baseUrl,
        options: { thinking: "disabled" },
        maxOutputTokens: 128,
      },
      runtime: { tokenBudget: 8_000, maxModelRequests: 4, maxToolCalls: 3 },
      tools: { enabledNames },
      storage: { databasePath: workspace.resolve("state", "sessions.sqlite") },
      skills: { resourceRoot: workspace.resolve("resources", "skills"), enabledIds: [] },
      memory: { provider: "empty" },
    }),
    "utf8",
  );
  return configPath;
}

function spawnCli(args: readonly string[]): {
  readonly child: ReturnType<typeof spawn>;
  readonly result: Promise<CliResult>;
} {
  const child = spawn(process.execPath, [path.resolve("dist/app/cli/main.js"), ...args], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: "m5-cli-fixture-secret",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const result = new Promise<CliResult>((resolve, reject) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    timer.unref?.();
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
  return { child, result };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function spawnPtyLauncher(launcherPath: string): {
  readonly child: ReturnType<typeof spawn>;
  readonly result: Promise<CliResult>;
  waitForOutput(text: string, count: number): Promise<void>;
} {
  const child = spawn(
    "script",
    ["-qefc", `${shellQuote(process.execPath)} ${shellQuote(launcherPath)}`, "/dev/null"],
    {
      cwd: path.resolve("."),
      env: { ...process.env, DEEPSEEK_API_KEY: "m5-cli-fixture-secret" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const result = new Promise<CliResult>((resolve, reject) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    timer.unref?.();
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
  const waitForOutput = (text: string, count: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`等待 PTY 输出超时: ${text}`)), 10_000);
      timer.unref?.();
      const occurrences = () => Buffer.concat(stdout).toString("utf8").split(text).length - 1;
      const onData = () => {
        if (occurrences() >= count) finish();
      };
      const onClose = () => finish(new Error(`PTY 在等待输出前退出: ${text}`));
      const finish = (error?: Error) => {
        clearTimeout(timer);
        child.stdout.removeListener("data", onData);
        child.removeListener("close", onClose);
        if (error) reject(error);
        else resolve();
      };
      child.stdout.on("data", onData);
      child.once("close", onClose);
      onData();
    });
  return { child, result, waitForOutput };
}

function toolCallChunk(name: string, callId: string, argumentsJson: string) {
  return {
    id: "fixture-tool-call",
    object: "chat.completion.chunk",
    created: 0,
    model: "fixture-model",
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              index: 0,
              id: callId,
              type: "function",
              function: { name, arguments: argumentsJson },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function finalChunks(text: string): object[] {
  return [
    {
      id: "fixture-final",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture-model",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
    },
    {
      id: "fixture-usage",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture-model",
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    },
  ];
}

describe("M5 CLI child-process replay", () => {
  it("真实 CLI 子进程通过本地 SSE 完成 read→final，并持久化 Session", async () => {
    const workspace = await createTempWorkspace("m5-cli-read-");
    workspaces.push(workspace);
    await writeFile(workspace.resolve("note.txt"), "fixture-note\n", "utf8");
    const server = await startReplayServer((index, request, response) => {
      expect(request.url).toBe("/v1/chat/completions");
      if (index === 0) {
        sse(response, [toolCallChunk("read", "call-read", '{"path":"note.txt"}')]);
      } else {
        sse(response, finalChunks("CLI replay complete"));
      }
    });
    servers.push(server);
    const configPath = await writeConfig(workspace, server.baseUrl, ["read"]);

    const execution = spawnCli([
      "run",
      "--input",
      "读取 note.txt 后结束",
      "--cwd",
      workspace.root,
      "--config",
      configPath,
      "--session",
      "m5-cli-read-session",
      "--non-interactive",
    ]);
    const result = await execution.result;

    expect(result).toMatchObject({ code: 0, signal: null, stdout: "CLI replay complete\n" });
    expect(result.stderr).toBe("");
    expect(result.stdout + result.stderr).not.toContain("m5-cli-fixture-secret");
    expect(server.requests).toHaveLength(2);
    expect(JSON.stringify(server.requests[1]!.body)).toContain("fixture-note");
    expect(await readFile(workspace.resolve("note.txt"), "utf8")).toBe("fixture-note\n");
    expect(await readFile(workspace.resolve("state", "sessions.sqlite"))).not.toHaveLength(0);
  });

  it("非交互 CLI 对 edit 审批 fail closed，拒绝结果仍可回填模型", async () => {
    const workspace = await createTempWorkspace("m5-cli-deny-");
    workspaces.push(workspace);
    const server = await startReplayServer((index, _request, response) => {
      if (index === 0) {
        sse(response, [
          toolCallChunk(
            "edit",
            "call-edit",
            '{"mode":"create","path":"forbidden.txt","newText":"must-not-exist"}',
          ),
        ]);
      } else {
        sse(response, finalChunks("approval denied safely"));
      }
    });
    servers.push(server);
    const configPath = await writeConfig(workspace, server.baseUrl, ["edit"]);

    const result = await spawnCli([
      "run",
      "--input",
      "尝试写文件",
      "--cwd",
      workspace.root,
      "--config",
      configPath,
      "--non-interactive",
    ]).result;

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("approval denied safely\n");
    expect(JSON.stringify(server.requests[1]!.body)).toContain("interaction_unavailable");
    await expect(readFile(workspace.resolve("forbidden.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("模型流等待期间收到 SIGINT 时退出 130，且不泄漏 secret", async () => {
    const workspace = await createTempWorkspace("m5-cli-sigint-");
    workspaces.push(workspace);
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const server = await startReplayServer((_index, _request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(": stream-open\n\n");
      markStarted?.();
    });
    servers.push(server);
    const configPath = await writeConfig(workspace, server.baseUrl, ["read"]);
    const execution = spawnCli([
      "run",
      "--input",
      "等待取消",
      "--cwd",
      workspace.root,
      "--config",
      configPath,
      "--non-interactive",
    ]);
    await started;
    execution.child.kill("SIGINT");
    const result = await execution.result;

    expect(result.code).toBe(130);
    expect(result.signal).toBeNull();
    expect(result.stderr).toContain("Run 结束状态: cancelled");
    expect(result.stdout + result.stderr).not.toContain("m5-cli-fixture-secret");
  });

  it("真实 PTY CLI 在 bubblewrap 中完成 read→edit→shell→final", async (context) => {
    if (process.env["CODING_AGENT_REQUIRE_BWRAP"] !== "1") {
      context.skip();
      return;
    }
    const workspace = await createTempWorkspace("m5-cli-full-");
    workspaces.push(workspace);
    await mkdir(workspace.resolve("src"), { recursive: true });
    await writeFile(workspace.resolve("src", "value.txt"), "value=1\n", "utf8");
    const sandbox = await WorkspaceSandbox.create(workspace.root);
    const expectedRevision = (await sandbox.read("src/value.txt", 1_024)).revision;
    const server = await startReplayServer((index, request, response) => {
      if (index === 0) {
        sse(response, [toolCallChunk("read", "call-read", '{"path":"src/value.txt"}')]);
      } else if (index === 1) {
        expect(JSON.stringify(request.body)).toContain("value=1");
        sse(response, [
          toolCallChunk(
            "edit",
            "call-edit",
            JSON.stringify({
              mode: "replace",
              path: "src/value.txt",
              oldText: "value=1\n",
              newText: "value=2\n",
              expectedRevision,
            }),
          ),
        ]);
      } else if (index === 2) {
        expect(JSON.stringify(request.body)).toContain("value=2");
        sse(response, [
          toolCallChunk(
            "shell",
            "call-shell",
            JSON.stringify({
              command: 'test "$(cat src/value.txt)" = "value=2" && printf shell-ok',
              cwd: ".",
              timeoutMs: 5_000,
            }),
          ),
        ]);
      } else {
        expect(JSON.stringify(request.body)).toContain("shell-ok");
        sse(response, finalChunks("full CLI replay complete"));
      }
    });
    servers.push(server);
    const configPath = await writeConfig(workspace, server.baseUrl, ["read", "edit", "shell"]);
    const launcherPath = workspace.resolve("pty-launcher.mjs");
    const cliModule = pathToFileURL(path.resolve("dist/app/cli/cli.js")).href;
    await writeFile(
      launcherPath,
      `import { runCli } from ${JSON.stringify(cliModule)};\n` +
        `process.exitCode = await runCli(${JSON.stringify([
          "run",
          "--input",
          "读取、修改并检查 value",
          "--cwd",
          workspace.root,
          "--config",
          configPath,
        ])});\n`,
      "utf8",
    );

    const execution = spawnPtyLauncher(launcherPath);
    await execution.waitForOutput("允许一次？[y/N]", 1);
    execution.child.stdin!.write("y\n");
    await execution.waitForOutput("允许一次？[y/N]", 2);
    execution.child.stdin!.end("y\n");
    const result = await execution.result;

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("full CLI replay complete");
    expect(result.stdout + result.stderr).not.toContain("m5-cli-fixture-secret");
    expect(server.requests).toHaveLength(4);
    expect(await readFile(workspace.resolve("src", "value.txt"), "utf8")).toBe("value=2\n");
  }, 25_000);
});
