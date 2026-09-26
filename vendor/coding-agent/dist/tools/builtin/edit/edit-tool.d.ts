/**
 * 模块职责：实现受 WorkspaceSandbox 保护的文本写入、替换、删除和补丁工具。
 *
 * 设计边界：工具不自行绕过权限或直接访问任意文件系统；输入必须符合 edit schema。
 * 关键流程：解析编辑模式，调用 workspace 原子操作，把结果或可恢复错误映射为统一 ToolResult。
 */
import { z } from "zod";
import type { ToolCall, ToolExecutionOptions, ToolResult } from "../../../core/ports/tool_executor/tool-executor-port.js";
import type { WorkspaceSandbox } from "../../../sandbox/workspace/workspace-sandbox.js";
import type { ToolDefinition, ToolHandler } from "../../schemas/tool-schemas.js";
export declare const editToolInputSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    mode: z.ZodLiteral<"replace">;
    path: z.ZodString;
    oldText: z.ZodString;
    newText: z.ZodString;
    expectedRevision: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    mode: z.ZodLiteral<"create">;
    path: z.ZodString;
    newText: z.ZodString;
}, z.core.$strict>], "mode">;
export declare class EditToolHandler implements ToolHandler {
    #private;
    private readonly workspace;
    constructor(workspace: WorkspaceSandbox);
    execute(call: Readonly<ToolCall>, options: Readonly<ToolExecutionOptions>): Promise<ToolResult>;
}
export declare function createEditToolDefinition(workspace: WorkspaceSandbox): ToolDefinition;
//# sourceMappingURL=edit-tool.d.ts.map