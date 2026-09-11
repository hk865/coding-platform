/**
 * 模块职责：实现通过 ProcessSandbox 运行命令的内置 shell 工具。
 *
 * 设计边界：命令必须先经过权限与审批；此处只处理已授权调用和资源上限。
 * 关键流程：校验命令、参数和 cwd，交给进程沙箱执行，再映射退出、超时、取消和输出截断。
 */
import { z } from "zod";

import type {
  ToolCall,
  ToolExecutionOptions,
  ToolResult,
} from "../../../core/ports/tool_executor/tool-executor-port.js";
import { ProcessSandboxError } from "../../../sandbox/process/process-sandbox.js";
import type { ProcessSandbox } from "../../../sandbox/process/process-sandbox.js";
import type { ToolDefinition, ToolHandler } from "../../schemas/tool-schemas.js";

export const shellToolInputSchema = z
  .object({
    command: z.string().min(1).describe("Non-interactive bash command to run"),
    cwd: z
      .string()
      .optional()
      .describe("Workspace-relative working directory; defaults to workspace root"),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in milliseconds, capped by the runtime"),
  })
  .strict();

const NONE = {
  sideEffect: "none" as const,
  changedPaths: [] as const,
  workspaceRevision: null,
  artifactRefs: [] as const,
};

export interface ShellToolConfig {
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly outputLimitBytes?: number;
}

export class ShellToolHandler implements ToolHandler {
  readonly #defaultTimeoutMs: number;
  readonly #maxTimeoutMs: number;
  readonly #outputLimitBytes: number;

  constructor(
    private readonly sandbox: ProcessSandbox,
    config: ShellToolConfig = {},
  ) {
    this.#defaultTimeoutMs = config.defaultTimeoutMs ?? 30_000;
    this.#maxTimeoutMs = config.maxTimeoutMs ?? 120_000;
    this.#outputLimitBytes = config.outputLimitBytes ?? 64 * 1024;
  }

  async execute(
    call: Readonly<ToolCall>,
    options: Readonly<ToolExecutionOptions>,
  ): Promise<ToolResult> {
    if (options.signal.aborted) return this.#cancelled(call.callId, NONE);
    const parsed = shellToolInputSchema.safeParse(call.arguments);
    if (!parsed.success)
      return this.#error(call.callId, "invalid_arguments", "shell 参数非法", NONE);
    const input = parsed.data;
    try {
      const result = await this.sandbox.execute({
        command: input.command,
        cwd: input.cwd ?? ".",
        timeoutMs: Math.min(input.timeoutMs ?? this.#defaultTimeoutMs, this.#maxTimeoutMs),
        outputLimitBytes: this.#outputLimitBytes,
        signal: options.signal,
      });
      const output = [
        { kind: "text" as const, text: result.stdout.text },
        {
          kind: "json" as const,
          value: {
            exitCode: result.exitCode,
            signal: result.signal,
            stdout: {
              totalBytes: result.stdout.totalBytes,
              truncated: result.stdout.truncated,
            },
            stderr: {
              text: result.stderr.text,
              totalBytes: result.stderr.totalBytes,
              truncated: result.stderr.truncated,
            },
            sandboxProfileVersion: result.sandboxProfileVersion,
            timings: result.timings,
          },
        },
      ];
      if (result.cancelled) {
        return {
          schemaVersion: 1,
          callId: call.callId,
          status: "cancelled",
          reason: "shell 已取消",
          output,
          effects: result.effects,
        };
      }
      if (result.timedOut) {
        return this.#error(call.callId, "timeout", "shell 执行超时", result.effects, output);
      }
      if (result.exitCode !== 0) {
        return this.#error(
          call.callId,
          "execution_failed",
          `shell 退出码 ${String(result.exitCode)}`,
          result.effects,
          output,
        );
      }
      return {
        schemaVersion: 1,
        callId: call.callId,
        status: "success",
        output,
        effects: result.effects,
      };
    } catch (error) {
      if (error instanceof ProcessSandboxError) {
        return this.#error(
          call.callId,
          error.code === "sandbox_unavailable" ? "sandbox_unavailable" : "execution_failed",
          error.message,
          NONE,
        );
      }
      return this.#error(call.callId, "execution_failed", "shell 执行失败", {
        sideEffect: "possible",
        changedPaths: [],
        workspaceRevision: null,
        artifactRefs: [],
      });
    }
  }

  #error(
    callId: string,
    code: "invalid_arguments" | "sandbox_unavailable" | "execution_failed" | "timeout",
    message: string,
    effects: ToolResult["effects"],
    output: ToolResult["output"] = [{ kind: "text", text: message }],
  ): ToolResult {
    return {
      schemaVersion: 1,
      callId,
      status: "error",
      error: { code, message, retryable: code === "timeout" || code === "execution_failed" },
      output,
      effects,
    };
  }

  #cancelled(callId: string, effects: ToolResult["effects"]): ToolResult {
    return {
      schemaVersion: 1,
      callId,
      status: "cancelled",
      reason: "shell 已取消",
      output: [],
      effects,
    };
  }
}

export function createShellToolDefinition(sandbox: ProcessSandbox): ToolDefinition {
  return {
    name: "shell",
    description:
      "Run a non-interactive bash command in a network-disabled bubblewrap sandbox. Use for search, builds, and tests—not for file reading or editing when read/edit applies. The workspace is /workspace inside shell; cwd is workspace-relative. Group related checks to avoid many tiny calls. Requires user permission.",
    inputSchema: shellToolInputSchema,
    handler: new ShellToolHandler(sandbox),
    effectClass: "process",
    requiredCapabilities: [
      "workspace_read",
      "workspace_write",
      "isolated_process",
      "network_isolated",
    ],
    defaultTimeoutMs: 30_000,
    outputLimitBytes: 128 * 1024,
    independentReadOnly: false,
    summarize: (argumentsValue) => ({
      paths: [],
      cwd: String(argumentsValue["cwd"] ?? "."),
      commandPreview: String(argumentsValue["command"] ?? "").slice(0, 512),
    }),
  };
}
