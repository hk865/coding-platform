/**
 * 模块职责：定义工具元数据、效果分类、沙箱能力、操作摘要和 handler 契约。
 *
 * 设计边界：这里只描述工具插件边界，不包含注册、调度、审批或具体工具逻辑。
 * 关键流程：工具定义先通过元数据 schema，Dispatcher 再用统一 handler 接口执行并返回 ToolResult。
 */
import { z } from "zod";
import type { ToolCall, ToolExecutionOptions, ToolResult } from "../../core/ports/tool_executor/tool-executor-port.js";
import { toolEffectClassSchema, type ToolEffectClass } from "../../core/ports/tool_executor/tool-executor-port.js";
export { toolEffectClassSchema };
export type { ToolEffectClass };
export declare const sandboxCapabilitySchema: z.ZodEnum<{
    workspace_write: "workspace_write";
    workspace_read: "workspace_read";
    isolated_process: "isolated_process";
    network_isolated: "network_isolated";
}>;
export type SandboxCapability = z.infer<typeof sandboxCapabilitySchema>;
export interface ToolOperationSummary {
    readonly paths: readonly string[];
    readonly cwd: string | null;
    readonly commandPreview: string | null;
}
export interface ToolHandler {
    execute(call: Readonly<ToolCall>, options: Readonly<ToolExecutionOptions>): Promise<ToolResult>;
}
export interface ToolDefinition {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: z.ZodType;
    readonly handler: ToolHandler;
    readonly effectClass: ToolEffectClass;
    readonly requiredCapabilities: readonly SandboxCapability[];
    readonly defaultTimeoutMs: number;
    readonly outputLimitBytes: number;
    readonly independentReadOnly: boolean;
    summarize(argumentsValue: Readonly<ToolCall["arguments"]>): ToolOperationSummary;
}
export declare const toolDefinitionMetadataSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    effectClass: z.ZodEnum<{
        read_only: "read_only";
        workspace_write: "workspace_write";
        process: "process";
    }>;
    requiredCapabilities: z.ZodReadonly<z.ZodArray<z.ZodEnum<{
        workspace_write: "workspace_write";
        workspace_read: "workspace_read";
        isolated_process: "isolated_process";
        network_isolated: "network_isolated";
    }>>>;
    defaultTimeoutMs: z.ZodNumber;
    outputLimitBytes: z.ZodNumber;
    independentReadOnly: z.ZodBoolean;
}, z.core.$loose>;
export declare function validateToolDefinition(definition: ToolDefinition): void;
//# sourceMappingURL=tool-schemas.d.ts.map