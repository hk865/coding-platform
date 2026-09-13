/**
 * 模块职责：定义工具元数据、效果分类、沙箱能力、操作摘要和 handler 契约。
 *
 * 设计边界：这里只描述工具插件边界，不包含注册、调度、审批或具体工具逻辑。
 * 关键流程：工具定义先通过元数据 schema，Dispatcher 再用统一 handler 接口执行并返回 ToolResult。
 */
import { z } from "zod";

import type {
  ToolCall,
  ToolExecutionOptions,
  ToolResult,
} from "../../core/ports/tool_executor/tool-executor-port.js";
import {
  toolEffectClassSchema,
  type ToolEffectClass,
} from "../../core/ports/tool_executor/tool-executor-port.js";

export { toolEffectClassSchema };
export type { ToolEffectClass };

export const sandboxCapabilitySchema = z.enum([
  "workspace_read",
  "workspace_write",
  "isolated_process",
  "network_isolated",
]);
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

export const toolDefinitionMetadataSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    description: z.string().min(1),
    effectClass: toolEffectClassSchema,
    requiredCapabilities: z.array(sandboxCapabilitySchema).readonly(),
    defaultTimeoutMs: z.number().int().positive(),
    outputLimitBytes: z.number().int().positive(),
    independentReadOnly: z.boolean(),
  })
  .passthrough();

export function validateToolDefinition(definition: ToolDefinition): void {
  toolDefinitionMetadataSchema.parse(definition);
  if (definition.effectClass !== "read_only" && definition.independentReadOnly) {
    throw new Error("只有 read_only 工具可以声明 independentReadOnly");
  }
}
