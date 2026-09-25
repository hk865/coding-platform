/**
 * 模块职责：实现通过 ProcessSandbox 运行命令的内置 shell 工具。
 *
 * 设计边界：命令必须先经过权限与审批；此处只处理已授权调用和资源上限。
 * 关键流程：校验命令、参数和 cwd，交给进程沙箱执行，再映射退出、超时、取消和输出截断。
 */
import { z } from "zod";
import type { ToolCall, ToolExecutionOptions, ToolResult } from "../../../core/ports/tool_executor/tool-executor-port.js";
import type { ProcessSandbox } from "../../../sandbox/process/process-sandbox.js";
import type { ToolDefinition, ToolHandler } from "../../schemas/tool-schemas.js";
export declare const shellToolInputSchema: z.ZodObject<{
    command: z.ZodString;
    cwd: z.ZodOptional<z.ZodString>;
    timeoutMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export interface ShellToolConfig {
    readonly defaultTimeoutMs?: number;
    readonly maxTimeoutMs?: number;
    readonly outputLimitBytes?: number;
}
export declare class ShellToolHandler implements ToolHandler {
    #private;
    private readonly sandbox;
    constructor(sandbox: ProcessSandbox, config?: ShellToolConfig);
    execute(call: Readonly<ToolCall>, options: Readonly<ToolExecutionOptions>): Promise<ToolResult>;
}
export declare function createShellToolDefinition(sandbox: ProcessSandbox): ToolDefinition;
//# sourceMappingURL=shell-tool.d.ts.map