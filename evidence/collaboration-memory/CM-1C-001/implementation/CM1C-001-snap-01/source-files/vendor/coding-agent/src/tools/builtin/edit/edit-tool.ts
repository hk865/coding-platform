/**
 * 模块职责：实现受 WorkspaceSandbox 保护的文本写入、替换、删除和补丁工具。
 *
 * 设计边界：工具不自行绕过权限或直接访问任意文件系统；输入必须符合 edit schema。
 * 关键流程：解析编辑模式，调用 workspace 原子操作，把结果或可恢复错误映射为统一 ToolResult。
 */
import { z } from "zod";

import type {
  ToolCall,
  ToolEffects,
  ToolExecutionOptions,
  ToolResult,
} from "../../../core/ports/tool_executor/tool-executor-port.js";
import { WorkspaceSandboxError } from "../../../sandbox/workspace/workspace-sandbox.js";
import type { WorkspaceSandbox } from "../../../sandbox/workspace/workspace-sandbox.js";
import type { ToolDefinition, ToolHandler } from "../../schemas/tool-schemas.js";

const replaceInputSchema = z
  .object({
    mode: z.literal("replace"),
    path: z.string().min(1).describe("Workspace-relative file path; never absolute"),
    oldText: z.string().min(1).describe("Unique existing text to replace exactly once"),
    newText: z.string().describe("Replacement text"),
    expectedRevision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .describe("Revision returned by the latest read of this file"),
  })
  .strict();
const createInputSchema = z
  .object({
    mode: z.literal("create"),
    path: z.string().min(1).describe("Workspace-relative new file path; never absolute"),
    newText: z.string().describe("Complete initial file content"),
  })
  .strict();
export const editToolInputSchema = z.discriminatedUnion("mode", [
  replaceInputSchema,
  createInputSchema,
]);

const NONE: ToolEffects = {
  sideEffect: "none",
  changedPaths: [],
  workspaceRevision: null,
  artifactRefs: [],
};

function boundedDiff(path: string, oldText: string, newText: string, limit = 16_384): string {
  const body = `--- a/${path}\n+++ b/${path}\n-${oldText}\n+${newText}`;
  return body.length <= limit ? body : `${body.slice(0, limit)}\n… diff truncated`;
}

export class EditToolHandler implements ToolHandler {
  constructor(private readonly workspace: WorkspaceSandbox) {}

  async execute(
    call: Readonly<ToolCall>,
    options: Readonly<ToolExecutionOptions>,
  ): Promise<ToolResult> {
    if (options.signal.aborted) return this.#cancelled(call.callId, NONE);
    const parsed = editToolInputSchema.safeParse(call.arguments);
    if (!parsed.success)
      return this.#error(call.callId, "invalid_arguments", "edit 参数非法", NONE);
    const input = parsed.data;
    try {
      const write =
        input.mode === "replace"
          ? await this.workspace.replace(
              input.path,
              input.oldText,
              input.newText,
              input.expectedRevision,
            )
          : await this.workspace.createFile(input.path, input.newText);
      if (options.signal.aborted) return this.#cancelled(call.callId, write.effects);
      return {
        schemaVersion: 1,
        callId: call.callId,
        status: "success",
        output: [
          {
            kind: "text",
            text: boundedDiff(
              write.path,
              input.mode === "replace" ? input.oldText : "",
              input.newText,
            ),
          },
          {
            kind: "json",
            value: {
              path: write.path,
              oldRevision: write.oldRevision,
              newRevision: write.newRevision,
              changedBytes: write.changedBytes,
            },
          },
        ],
        effects: write.effects,
      };
    } catch (error) {
      if (error instanceof WorkspaceSandboxError) {
        const code = ["invalid_path", "permission_denied"].includes(error.code)
          ? "permission_denied"
          : "execution_failed";
        return this.#error(call.callId, code, error.message, error.effects);
      }
      return this.#error(call.callId, "execution_failed", "edit 执行失败", {
        sideEffect: "possible",
        changedPaths: [input.path],
        workspaceRevision: null,
        artifactRefs: [],
      });
    }
  }

  #error(
    callId: string,
    code: "invalid_arguments" | "permission_denied" | "execution_failed",
    message: string,
    effects: ToolEffects,
  ): ToolResult {
    return {
      schemaVersion: 1,
      callId,
      status: "error",
      error: { code, message, retryable: code === "execution_failed" },
      output: [{ kind: "text", text: message }],
      effects,
    };
  }

  #cancelled(callId: string, effects: ToolEffects): ToolResult {
    return {
      schemaVersion: 1,
      callId,
      status: "cancelled",
      reason: "edit 已取消",
      output: [],
      effects,
    };
  }
}

export function createEditToolDefinition(workspace: WorkspaceSandbox): ToolDefinition {
  return {
    name: "edit",
    description:
      "Create a file or atomically replace one unique text occurrence. Read the file first and pass its workspace-relative path and latest revision. Use this instead of shell redirection; each edit requires permission.",
    inputSchema: editToolInputSchema,
    handler: new EditToolHandler(workspace),
    effectClass: "workspace_write",
    requiredCapabilities: ["workspace_read", "workspace_write"],
    defaultTimeoutMs: 15_000,
    outputLimitBytes: 32 * 1024,
    independentReadOnly: false,
    summarize: (argumentsValue) => ({
      paths: [String(argumentsValue["path"] ?? "")],
      cwd: null,
      commandPreview: null,
    }),
  };
}
