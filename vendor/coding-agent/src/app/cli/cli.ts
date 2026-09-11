/** 最小非 REPL CLI：严格解析 run/resume 命令并映射稳定退出码。 */
import { createInterface } from "node:readline/promises";

import type {
  ApprovalRequest,
  ApprovalRequester,
  ApprovalResponse,
} from "../../policy/approval/approval-coordinator.js";
import { loadAppConfig } from "../composition/app-config.js";
import { runCodingAgent } from "../composition/composition-root.js";
import { resumeCodingAgent } from "../composition/resume-composition.js";

interface RunCommand {
  readonly command: "run";
  readonly input: string;
  readonly cwd: string;
  readonly sessionId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly configPath?: string;
  readonly nonInteractive: boolean;
}

interface ResumeCommand {
  readonly command: "resume";
  readonly sessionId: string;
  readonly cwd: string;
  readonly provider?: string;
  readonly model?: string;
  readonly configPath?: string;
  readonly nonInteractive: boolean;
}

type CliCommand = RunCommand | ResumeCommand;

export interface CliIo {
  readonly stdout: Pick<NodeJS.WriteStream, "write">;
  readonly stderr: Pick<NodeJS.WriteStream, "write">;
  readonly stdin: NodeJS.ReadStream;
}

class TerminalApprovalRequester implements ApprovalRequester {
  constructor(private readonly io: CliIo) {}

  async request(
    request: Readonly<ApprovalRequest>,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<ApprovalResponse> {
    const prompt = [
      `工具 ${request.tool} 请求执行`,
      request.paths.length > 0 ? `路径: ${request.paths.join(", ")}` : "",
      request.commandPreview ? `命令: ${request.commandPreview}` : "",
      "允许一次？[y/N] ",
    ]
      .filter(Boolean)
      .join("\n");
    const reader = createInterface({
      input: this.io.stdin,
      output: this.io.stderr as NodeJS.WriteStream,
    });
    try {
      const answer = await reader.question(prompt, { signal: options.signal });
      return /^y(?:es)?$/i.test(answer.trim())
        ? { decision: "allow_once", reason: "operator_approved" }
        : { decision: "deny", reason: "operator_denied" };
    } finally {
      reader.close();
    }
  }
}

function value(argv: readonly string[], index: number, name: string): string {
  const candidate = argv[index + 1];
  if (!candidate || candidate.startsWith("--")) throw new Error(`${name} 缺少值`);
  return candidate;
}

export function parseCliCommand(argv: readonly string[], cwd = process.cwd()): CliCommand {
  const command = argv[0];
  if (command !== "run" && command !== "resume") throw new Error("命令必须是 run 或 resume");
  const options = new Map<string, string | true>();
  for (let index = 1; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (name === "--non-interactive") {
      if (options.has(name)) throw new Error(`${name} 不能重复`);
      options.set(name, true);
      continue;
    }
    if (!["--input", "--cwd", "--session", "--provider", "--model", "--config"].includes(name)) {
      throw new Error(`未知参数 ${name}`);
    }
    if (options.has(name)) throw new Error(`${name} 不能重复`);
    options.set(name, value(argv, index, name));
    index += 1;
  }
  const common = {
    cwd: String(options.get("--cwd") ?? cwd),
    ...(options.has("--provider") ? { provider: String(options.get("--provider")) } : {}),
    ...(options.has("--model") ? { model: String(options.get("--model")) } : {}),
    ...(options.has("--config") ? { configPath: String(options.get("--config")) } : {}),
    nonInteractive: options.has("--non-interactive"),
  };
  if (command === "run") {
    const input = options.get("--input");
    if (typeof input !== "string" || input.trim().length === 0) throw new Error("run 需要 --input");
    return {
      command,
      input,
      ...(options.has("--session") ? { sessionId: String(options.get("--session")) } : {}),
      ...common,
    };
  }
  if (options.has("--input")) throw new Error("resume 不接受 --input");
  const sessionId = options.get("--session");
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new Error("resume 需要 --session");
  }
  return { command, sessionId, ...common };
}

function exitCode(status: string): number {
  if (status === "completed") return 0;
  if (status === "cancelled") return 10;
  if (status === "limit_exceeded") return 11;
  return 12;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  let command: CliCommand;
  try {
    command = parseCliCommand(argv);
  } catch (error: unknown) {
    io.stderr.write(`${error instanceof Error ? error.message : "参数非法"}\n`);
    return 2;
  }
  const controller = new AbortController();
  const onSignal = () => controller.abort(new Error("process_signal"));
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const config = await loadAppConfig({
      cwd: command.cwd,
      ...(command.configPath ? { configPath: command.configPath } : {}),
      overrides: {
        cwd: command.cwd,
        ...(command.provider ? { provider: command.provider } : {}),
        ...(command.model ? { model: command.model } : {}),
      },
    });
    const execution = {
      config,
      workspaceRoot: command.cwd,
      signal: controller.signal,
      onTextDelta: (delta: string) => io.stdout.write(delta),
      ...(!command.nonInteractive && io.stdin.isTTY
        ? { approvalRequester: new TerminalApprovalRequester(io) }
        : {}),
    };
    const result =
      command.command === "run"
        ? await runCodingAgent({
            ...execution,
            input: command.input,
            ...(command.sessionId ? { sessionId: command.sessionId } : {}),
          })
        : await resumeCodingAgent({
            ...execution,
            sessionId: command.sessionId,
          });
    if ("action" in result && result.action === "side_effect_result_unknown") {
      io.stderr.write("恢复发现副作用结果未知，需要人工核对。\n");
      return 13;
    }
    if (result.state.status === "completed") io.stdout.write("\n");
    else io.stderr.write(`Run 结束状态: ${result.state.status}\n`);
    return controller.signal.aborted ? 130 : exitCode(result.state.status);
  } catch (error: unknown) {
    io.stderr.write(`${error instanceof Error ? error.message : "App 启动失败"}\n`);
    return controller.signal.aborted ? 130 : 14;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}
