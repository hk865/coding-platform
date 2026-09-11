/**
 * 模块职责：实现受 WorkspaceSandbox 保护的文本与目录读取工具。
 *
 * 设计边界：只允许 workspace 内的只读访问，并通过大小和条目上限控制返回量。
 * 关键流程：校验路径和分页参数，读取文件或目录，再转换成模型可消费的结构化输出。
 */
import { z } from "zod";

import type {
  ToolCall,
  ToolExecutionOptions,
  ToolResult,
} from "../../../core/ports/tool_executor/tool-executor-port.js";
import { WorkspaceSandboxError } from "../../../sandbox/workspace/workspace-sandbox.js";
import type { WorkspaceSandbox } from "../../../sandbox/workspace/workspace-sandbox.js";
import type { ToolDefinition, ToolHandler } from "../../schemas/tool-schemas.js";

export const readToolInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe("Workspace-relative file or directory path, for example README.md; never absolute"),
    startLine: z.number().int().positive().optional().describe("First line to return, 1-based"),
    endLine: z.number().int().positive().optional().describe("Last line to return, inclusive"),
    maxBytes: z.number().int().positive().optional().describe("Maximum source bytes to read"),
  })
  .strict()
  .refine(
    (value) => value.endLine === undefined || value.endLine >= (value.startLine ?? 1),
    "endLine 不能小于 startLine",
  );

const NONE = {
  sideEffect: "none" as const,
  changedPaths: [] as const,
  workspaceRevision: null,
  artifactRefs: [] as const,
};

export interface ReadToolConfig {
  readonly maxRawBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxLines?: number;
}

export class ReadToolHandler implements ToolHandler {
  readonly #maxRawBytes: number;
  readonly #maxOutputBytes: number;
  readonly #maxLines: number;

  constructor(
    private readonly workspace: WorkspaceSandbox,
    config: ReadToolConfig = {},
  ) {
    this.#maxRawBytes = config.maxRawBytes ?? 256 * 1024;
    this.#maxOutputBytes = config.maxOutputBytes ?? 64 * 1024;
    this.#maxLines = config.maxLines ?? 2_000;
  }

  async execute(
    call: Readonly<ToolCall>,
    options: Readonly<ToolExecutionOptions>,
  ): Promise<ToolResult> {
    if (options.signal.aborted) return this.#cancelled(call.callId);
    const parsed = readToolInputSchema.safeParse(call.arguments);
    if (!parsed.success) return this.#error(call.callId, "invalid_arguments", "read 参数非法");
    const input = parsed.data;
    try {
      const file = await this.workspace.read(
        input.path,
        Math.min(input.maxBytes ?? this.#maxRawBytes, this.#maxRawBytes),
      );
      if (options.signal.aborted) return this.#cancelled(call.callId);
      const allLines = file.content.split("\n");
      const start = input.startLine ?? 1;
      if (start > allLines.length && file.content.length > 0) {
        return this.#error(call.callId, "invalid_arguments", "startLine 超出文件范围");
      }
      const requestedEnd = Math.min(input.endLine ?? allLines.length, allLines.length);
      const selected = allLines.slice(start - 1, requestedEnd).slice(0, this.#maxLines);
      let text = selected.join("\n");
      let truncated = requestedEnd - start + 1 > selected.length;
      while (Buffer.byteLength(text, "utf8") > this.#maxOutputBytes && selected.length > 0) {
        selected.pop();
        text = selected.join("\n");
        truncated = true;
      }
      const actualEnd = selected.length === 0 ? start - 1 : start + selected.length - 1;
      return {
        schemaVersion: 1,
        callId: call.callId,
        status: "success",
        output: [
          { kind: "text", text },
          {
            kind: "json",
            value: {
              path: file.path,
              startLine: start,
              endLine: actualEnd,
              totalLines: allLines.length,
              totalLinesKnown: true,
              truncated,
              utf8Bytes: Buffer.byteLength(text, "utf8"),
              revision: file.revision,
            },
          },
        ],
        effects: NONE,
      };
    } catch (error) {
      if (error instanceof WorkspaceSandboxError) {
        const code = ["invalid_path", "permission_denied"].includes(error.code)
          ? "permission_denied"
          : "execution_failed";
        return this.#error(call.callId, code, error.message);
      }
      return this.#error(call.callId, "execution_failed", "read 执行失败");
    }
  }

  #error(
    callId: string,
    code: "invalid_arguments" | "permission_denied" | "execution_failed",
    message: string,
  ): ToolResult {
    return {
      schemaVersion: 1,
      callId,
      status: "error",
      error: { code, message, retryable: false },
      output: [{ kind: "text", text: message }],
      effects: NONE,
    };
  }

  #cancelled(callId: string): ToolResult {
    return {
      schemaVersion: 1,
      callId,
      status: "cancelled",
      reason: "read 已取消",
      output: [],
      effects: NONE,
    };
  }
}

export function createReadToolDefinition(workspace: WorkspaceSandbox): ToolDefinition {
  return {
    name: "read",
    description:
      "Read a UTF-8 file or list a directory inside the workspace. Path must be workspace-relative (README.md, never /workspace/README.md or a host path). Prefer this tool over shell cat/ls; use line ranges for large files.",
    inputSchema: readToolInputSchema,
    handler: new ReadToolHandler(workspace),
    effectClass: "read_only",
    requiredCapabilities: ["workspace_read"],
    defaultTimeoutMs: 10_000,
    outputLimitBytes: 64 * 1024,
    independentReadOnly: true,
    summarize: (argumentsValue) => ({
      paths: [String(argumentsValue["path"] ?? "")],
      cwd: null,
      commandPreview: null,
    }),
  };
}
