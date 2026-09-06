/**
 * P1-16 real-kernel evidence helper: local OpenAI-compatible SSE replay
 * server + real coding-agent CLI runner (headless, no external network).
 * Pattern ports the kernel's own e2e (coding-agent tests/e2e/m5-cli-child):
 * the REAL CLI process (dist/app/cli/main.js) is exercised end-to-end
 * (run + resume --session), only the model endpoint is the fixture — this IS
 * the documented capability-degradation evidence boundary.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

export const KERNEL_ROOT =
  process.env["AGENT_PLATFORM_KERNEL_ROOT"] ?? "/home/han001/projects/agents/coding-agent";

export async function kernelCliReady(): Promise<{ ready: boolean; reason: string }> {
  try {
    await stat(path.join(KERNEL_ROOT, "dist", "app", "cli", "main.js"));
    return { ready: true, reason: "dist/app/cli/main.js present" };
  } catch (error) {
    return { ready: false, reason: String(error) };
  }
}

type ChatChunk = Record<string, unknown>;

export function toolCallChunk(name: string, callId: string, argumentsJson: string): ChatChunk {
  return {
    id: "fixture-tool-call",
    object: "chat.completion.chunk",
    created: 0,
    model: "fixture-model",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: null, tool_calls: [
          { index: 0, id: callId, type: "function", function: { name, arguments: argumentsJson } },
        ] },
        finish_reason: "tool_calls",
      },
    ],
  };
}

export function finalChunks(text: string): ChatChunk[] {
  return [
    { id: "fixture-final", object: "chat.completion.chunk", created: 0, model: "fixture-model",
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: "stop" }] },
    { id: "fixture-usage", object: "chat.completion.chunk", created: 0, model: "fixture-model",
      choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } },
  ];
}

export type ReplayServer = {
  baseUrl: string;
  requests: { url: string; body: Record<string, unknown> }[];
  close(): Promise<void>;
};

/** Replay server: respond per global request index (handlers per index). */
export async function startReplayServer(handlers: ((index: number, response: http.ServerResponse) => void)[]): Promise<ReplayServer> {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const server = http.createServer(async (incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (c: Buffer) => chunks.push(c));
    await once(incoming, "end");
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const index = requests.length;
    requests.push({ url: incoming.url ?? "", body });
    const handler = handlers[index] ?? handlers[handlers.length - 1]!;
    try {
      handler(index, response);
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    baseUrl: "http://127.0.0.1:" + String(address.port) + "/v1",
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    },
  };
}

export function sse(response: http.ServerResponse, chunks: readonly ChatChunk[]): void {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  for (const chunk of chunks) response.write("data: " + JSON.stringify(chunk) + "\n\n");
  response.end("data: [DONE]\n\n");
}

export function replayToolThenHang(name: string, callId: string, argumentsJson: string) {
  return (index: number, response: http.ServerResponse): void => {
    if (index === 0) sse(response, [toolCallChunk(name, callId, argumentsJson)]);
    // index >= 1: NEVER respond — the turn stays OPEN (interruptible).
    void response;
  };
}

export function replayToolThenFinal(name: string, callId: string, argumentsJson: string, finalText: string) {
  return (index: number, response: http.ServerResponse): void => {
    if (index === 0) sse(response, [toolCallChunk(name, callId, argumentsJson)]);
    else sse(response, finalChunks(finalText));
  };
}

export type CliRunResult = {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
};

export function spawnCli(args: readonly string[], cwd?: string, timeoutMs = 20_000, killAfterMs?: number): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(KERNEL_ROOT, "dist", "app", "cli", "main.js"), ...args], {
      cwd,
      env: { ...process.env, DEEPSEEK_API_KEY: "agent-platform-fixture-secret" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CLI timeout after " + String(timeoutMs) + "ms"));
    }, timeoutMs);
    timer.unref?.();
    const killTimer = killAfterMs === undefined ? null : setTimeout(() => child.kill("SIGKILL"), killAfterMs);
    killTimer?.unref?.();
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (killTimer !== null) clearTimeout(killTimer);
      resolve({ code, signal, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
  });
}

export async function writeKernelConfig(workspaceDir: string, baseUrl: string, enabledNames: readonly string[], opts: { maxModelRequests?: number; tokenBudget?: number; storageDir?: string } = {}): Promise<string> {
  const config = {
    schemaVersion: 1,
    model: { provider: "deepseek", model: "fixture-model", baseUrl, options: { thinking: "disabled" }, maxOutputTokens: 128 },
    runtime: { tokenBudget: opts.tokenBudget ?? 8_000, maxModelRequests: opts.maxModelRequests ?? 4, maxToolCalls: 3 },
    tools: { enabledNames },
    storage: { databasePath: path.join(opts.storageDir ?? path.join(workspaceDir, "state"), "sessions.sqlite") },
    skills: { resourceRoot: path.join(workspaceDir, "resources", "skills"), enabledIds: [] },
    memory: { provider: "empty" },
  };
  await mkdir(path.join(workspaceDir, "state"), { recursive: true });
  await mkdir(path.join(workspaceDir, "resources", "skills"), { recursive: true });
  const configPath = path.join(workspaceDir, "coding-agent.json");
  await writeFile(configPath, JSON.stringify(config), "utf8");
  return configPath;
}

export async function readFileOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}
