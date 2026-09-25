/**
 * 模块职责：实现受 WorkspaceSandbox 保护的文本与目录读取工具。
 *
 * 设计边界：只允许 workspace 内的只读访问，并通过大小和条目上限控制返回量。
 * 关键流程：校验路径和分页参数，读取文件或目录，再转换成模型可消费的结构化输出。
 */
import { z } from "zod";
import type { ToolCall, ToolExecutionOptions, ToolResult } from "../../../core/ports/tool_executor/tool-executor-port.js";
import type { WorkspaceSandbox } from "../../../sandbox/workspace/workspace-sandbox.js";
import type { ToolDefinition, ToolHandler } from "../../schemas/tool-schemas.js";
export declare const readToolInputSchema: z.ZodObject<{
    path: z.ZodString;
    startLine: z.ZodOptional<z.ZodNumber>;
    endLine: z.ZodOptional<z.ZodNumber>;
    maxBytes: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export interface ReadToolConfig {
    readonly maxRawBytes?: number;
    readonly maxOutputBytes?: number;
    readonly maxLines?: number;
}
export declare class ReadToolHandler implements ToolHandler {
    #private;
    private readonly workspace;
    constructor(workspace: WorkspaceSandbox, config?: ReadToolConfig);
    execute(call: Readonly<ToolCall>, options: Readonly<ToolExecutionOptions>): Promise<ToolResult>;
}
export declare function createReadToolDefinition(workspace: WorkspaceSandbox): ToolDefinition;
//# sourceMappingURL=read-tool.d.ts.map