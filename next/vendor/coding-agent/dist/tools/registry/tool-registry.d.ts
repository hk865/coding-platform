/**
 * 模块职责：注册工具定义，生成不可变快照，并根据并行安全属性提供工具分组策略。
 *
 * 设计边界：注册表不执行工具、不做权限判断，也不修改模型生成的调用。
 * 关键流程：注册时校验名称和元数据；冻结后提供模型规格、handler 查询及稳定执行分组。
 */
import type { ModelToolSpec } from "../../core/ports/model_client/model-client-port.js";
import type { ToolBatchPolicy, ToolExecutionGroup } from "../../core/ports/tool_batch_policy/tool-batch-policy-port.js";
import type { ToolCall } from "../../core/ports/tool_executor/tool-executor-port.js";
import type { ToolDefinition } from "../schemas/tool-schemas.js";
export declare class ToolRegistrySnapshot {
    #private;
    constructor(definitions: readonly ToolDefinition[]);
    resolve(name: string): ToolDefinition | undefined;
    list(): readonly ToolDefinition[];
    modelToolSpecs(): readonly ModelToolSpec[];
}
export declare class ToolRegistry {
    #private;
    register(definition: ToolDefinition): void;
    freeze(enabledNames: readonly string[]): ToolRegistrySnapshot;
}
export declare class RegistryToolBatchPolicy implements ToolBatchPolicy {
    private readonly snapshot;
    constructor(snapshot: ToolRegistrySnapshot);
    plan(calls: readonly Readonly<ToolCall>[]): readonly ToolExecutionGroup[];
}
//# sourceMappingURL=tool-registry.d.ts.map