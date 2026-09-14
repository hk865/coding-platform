/**
 * 模块职责：显式对账 Session 覆盖树或整个 workspace 基线，报告非 Agent 变动。
 *
 * 设计边界：check 只更新内存中的已观察基线，不修改文件；路径与 Git/fallback
 * 细节由 WorkspaceSandbox 封装。
 */
import { z } from "zod";

import type {
  ToolCall,
  ToolExecutionOptions,
  ToolResult,
} from "../../../core/ports/tool_executor/tool-executor-port.js";
import type { WorkspaceSandbox } from "../../../sandbox/workspace/workspace-sandbox.js";
import type { ToolDefinition, ToolHandler } from "../../schemas/tool-schemas.js";

export const checkToolInputSchema = z
  .object({
    scope: z
      .enum(["session", "workspace"])
      .optional()
      .describe(
        "session checks only paths observed by this run; workspace reconciles the Git/fallback baseline",
      ),
  })
  .strict();

const NONE = {
  sideEffect: "none" as const,
  changedPaths: [] as const,
  workspaceRevision: null,
  artifactRefs: [] as const,
};

export class CheckToolHandler implements ToolHandler {
  constructor(private readonly workspace: WorkspaceSandbox) {}

  async execute(
    call: Readonly<ToolCall>,
    options: Readonly<ToolExecutionOptions>,
  ): Promise<ToolResult> {
    if (options.signal.aborted) {
      return {
        schemaVersion: 1,
        callId: call.callId,
        status: "cancelled",
        reason: "check 已取消",
        output: [],
        effects: NONE,
      };
    }
    const parsed = checkToolInputSchema.safeParse(call.arguments);
    if (!parsed.success) {
      return {
        schemaVersion: 1,
        callId: call.callId,
        status: "error",
        error: { code: "invalid_arguments", message: "check 参数非法", retryable: false },
        output: [{ kind: "text", text: "check 参数非法" }],
        effects: NONE,
      };
    }
    try {
      const report = await this.workspace.checkConsistency(parsed.data.scope);
      return {
        schemaVersion: 1,
        callId: call.callId,
        status: "success",
        output: [
          {
            kind: "text",
            text:
              report.status === "clean"
                ? report.scope + " 基线一致，未发现外部变动"
                : "发现 " + String(report.changedPaths.length) + " 个非 Agent 基线变动",
          },
          {
            kind: "json",
            value: {
              mode: report.mode,
              scope: report.scope,
              status: report.status,
              checkedPaths: report.checkedPaths,
              changedPaths: [...report.changedPaths],
              revision: report.revision,
              revisionStrategy: report.revisionStrategy,
            },
          },
        ],
        effects: NONE,
      };
    } catch {
      return {
        schemaVersion: 1,
        callId: call.callId,
        status: "error",
        error: {
          code: "execution_failed",
          message: "workspace 对账失败",
          retryable: true,
        },
        output: [{ kind: "text", text: "workspace 对账失败" }],
        effects: NONE,
      };
    }
  }
}

export function createCheckToolDefinition(workspace: WorkspaceSandbox): ToolDefinition {
  return {
    name: "check",
    description:
      "Reconcile workspace state with the Agent-maintained baseline. Use session scope for a fast check of paths already observed in this run; use workspace scope before broad commands or when the user may have changed files. Reports drift without modifying files.",
    inputSchema: checkToolInputSchema,
    handler: new CheckToolHandler(workspace),
    effectClass: "read_only",
    requiredCapabilities: ["workspace_read"],
    defaultTimeoutMs: 10_000,
    outputLimitBytes: 64 * 1024,
    independentReadOnly: false,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
  };
}
