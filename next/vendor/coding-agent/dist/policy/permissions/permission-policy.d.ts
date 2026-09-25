/**
 * 模块职责：规范化工具操作并根据路径、效果类型和敏感资源生成 allow、deny 或 ask 决策。
 *
 * 设计边界：策略不执行工具，也不弹出审批界面；未知操作采用默认拒绝。
 * 关键流程：先阻止绝对路径和目录逃逸，再检查敏感资源，最后按读、写、进程规则决策。
 */
import type { JsonObject } from "../../core/context/types/context-types.js";
import type { SandboxCapability, ToolEffectClass } from "../../tools/schemas/tool-schemas.js";
export type PermissionDecisionKind = "allow" | "deny" | "ask";
export interface ToolOperation {
    readonly runId: string;
    readonly callId: string;
    readonly tool: string;
    readonly effectClass: ToolEffectClass;
    readonly arguments: Readonly<JsonObject>;
    readonly paths: readonly string[];
    readonly cwd: string | null;
    readonly commandPreview: string | null;
    readonly capabilities: readonly SandboxCapability[];
    readonly workspaceIdentity: string;
    readonly workspaceRevision: string;
    readonly sandboxProfileVersion: string;
}
export interface NormalizedToolOperation extends Omit<ToolOperation, "paths" | "cwd"> {
    readonly paths: readonly string[];
    readonly cwd: string | null;
}
export interface PermissionDecision {
    readonly decision: PermissionDecisionKind;
    readonly reasonCode: string;
    readonly summary: string;
    readonly policyVersion: string;
    readonly operation: NormalizedToolOperation | null;
}
export interface PermissionPolicyConfig {
    /** Host-selected, enabled tools with read-only workspace capability. */
    readonly registeredReadOnlyTools?: readonly string[];
    /**
     * 宿主**按真实 effectClass 显式授权**的非只读扩展工具名。
     *
     * 为什么需要它：宿主扩展工具（例如平台自己的协调工具）会修改**平台状态**，它们既不是
     * workspace 读操作，也不该被自报成只读来绕过检查。授权来自组合入口（宿主显式列名），
     * 而不是来自工具自己的声明；只有**本次确实注册过的 additionalTools** 且 effectClass
     * 不是 read_only 的名字才可能生效（见 composition-root 的过滤）。
     *
     * 不改变的安全边界：凭据/隐藏路径检查、内置 read/check/edit/shell 的既有规则、
     * 以及"未授权的未知操作默认拒绝"全部继续优先执行。
     */
    readonly hostAuthorizedTools?: readonly string[];
    readonly policyVersion?: string;
    readonly hiddenPrefixes?: readonly string[];
    readonly secretNames?: readonly string[];
}
export declare class PathPolicyError extends Error {
    readonly code: string;
    constructor(code: string);
}
export declare function normalizeWorkspacePath(value: string, allowRoot?: boolean): string;
export declare class DefaultPermissionPolicy {
    #private;
    readonly policyVersion: string;
    constructor(config?: PermissionPolicyConfig);
    evaluate(candidate: ToolOperation): PermissionDecision;
}
//# sourceMappingURL=permission-policy.d.ts.map