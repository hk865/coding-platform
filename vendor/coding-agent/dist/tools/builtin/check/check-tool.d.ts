/**
 * 模块职责：显式对账 Session 覆盖树或整个 workspace 基线，报告非 Agent 变动。
 *
 * 设计边界：check 只更新内存中的已观察基线，不修改文件；路径与 Git/fallback
 * 细节由 WorkspaceSandbox 封装。
 */
import { z } from "zod";
import type { ToolCall, ToolExecutionOptions, ToolResult } from "../../../core/ports/tool_executor/tool-executor-port.js";
import type { WorkspaceSandbox } from "../../../sandbox/workspace/workspace-sandbox.js";
import type { ToolDefinition, ToolHandler } from "../../schemas/tool-schemas.js";
export declare const checkToolInputSchema: z.ZodObject<{
    scope: z.ZodOptional<z.ZodEnum<{
        session: "session";
        workspace: "workspace";
    }>>;
}, z.core.$strict>;
export declare class CheckToolHandler implements ToolHandler {
    private readonly workspace;
    constructor(workspace: WorkspaceSandbox);
    execute(call: Readonly<ToolCall>, options: Readonly<ToolExecutionOptions>): Promise<ToolResult>;
}
export declare function createCheckToolDefinition(workspace: WorkspaceSandbox): ToolDefinition;
//# sourceMappingURL=check-tool.d.ts.map