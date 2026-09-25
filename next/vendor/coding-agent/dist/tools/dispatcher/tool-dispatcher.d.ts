import type { ToolCall, ToolExecutionOptions, ToolExecutorPort, ToolResult } from "../../core/ports/tool_executor/tool-executor-port.js";
import type { ApprovalCoordinator } from "../../policy/approval/approval-coordinator.js";
import type { DefaultPermissionPolicy } from "../../policy/permissions/permission-policy.js";
import type { ToolRegistrySnapshot } from "../registry/tool-registry.js";
import type { SandboxCapability } from "../schemas/tool-schemas.js";
export interface ToolDispatcherDependencies {
    readonly registry: ToolRegistrySnapshot;
    readonly permissionPolicy: DefaultPermissionPolicy;
    readonly approval?: ApprovalCoordinator;
    readonly capabilities: ReadonlySet<SandboxCapability>;
    readonly runId: string;
    readonly workspaceIdentity: string;
    readonly workspaceRevision: () => Promise<string>;
    readonly reconcileBeforeApproval?: () => Promise<{
        readonly changedPaths: readonly string[];
    }>;
    readonly sandboxProfileVersion: string;
}
/**
 * 真实工具的强制安全链。schema、Permission、Approval、revision 与 capability
 * 任一步失败都会在 handler 启动前返回，因此拒绝路径没有业务副作用。
 */
export declare class ToolDispatcher implements ToolExecutorPort {
    #private;
    private readonly dependencies;
    constructor(dependencies: ToolDispatcherDependencies);
    execute(callInput: Readonly<ToolCall>, options: Readonly<ToolExecutionOptions>): Promise<ToolResult>;
}
//# sourceMappingURL=tool-dispatcher.d.ts.map