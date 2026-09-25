import type { ApprovalRequester } from "../../policy/approval/approval-coordinator.js";
import type { EventSinkPort } from "../../core/ports/event_sink/event-sink-port.js";
import type { HookPort } from "../../core/hooks/protocol/hook-protocol.js";
import type { RecoveryAction } from "../../core/runtime/recovery/recovery-coordinator.js";
import type { RunState } from "../../core/runtime/state/run-state.js";
import type { ProviderRegistry } from "../../model/providers/registry/provider-registry.js";
import type { RunLimits } from "../../core/runtime/limits/limit-guard.js";
import type { ProcessSandboxOptions } from "../../sandbox/process/process-sandbox.js";
import { WorkspaceSandbox } from "../../sandbox/workspace/workspace-sandbox.js";
import type { WorkspaceSandboxOptions } from "../../sandbox/workspace/workspace-sandbox.js";
import type { AppConfig } from "./app-config.js";
import type { AppRuntimeConfiguration, SecretSource } from "./composition-contracts.js";
import { type RecoveryTarget } from "./recovery-contract.js";
export interface ResumeAppInput {
    /** Host-provided tools still use registry validation, permissions and output limits. */
    readonly additionalTools?: (workspace: WorkspaceSandbox) => readonly import("../../tools/schemas/tool-schemas.js").ToolDefinition[];
    /** 宿主对**非只读**扩展能力的显式授权（工具名）；语义与 `RunAppInput.hostAuthorizedTools` 相同。 */
    readonly hostAuthorizedTools?: readonly string[];
    /**
     * 控制 Hook；语义与 `RunAppInput.controlHooks` 相同。
     * `resume` 不接新的 user input、不创建新身份，只沿原 Turn 继续。
     */
    readonly controlHooks?: readonly HookPort[];
    /**
     * 恢复沿用的运行上限。缺省按 config 派生；显式传入才能与 Run 时的
     * `RunAppInput.limits` 一致——恢复不得悄悄丢失这些约束（不同的 limits 会被
     * RecoveryCoordinator 的环境核对判为 conflict，而不是被忽略）。
     */
    readonly limits?: RunLimits;
    readonly workspaceOptions?: WorkspaceSandboxOptions;
    readonly processSandboxOptions?: ProcessSandboxOptions;
    readonly config: AppConfig;
    readonly workspaceRoot: string;
    readonly sessionId: string;
    readonly secretSource?: SecretSource;
    readonly approvalRequester?: ApprovalRequester;
    readonly providerRegistry?: ProviderRegistry;
    readonly signal?: AbortSignal;
    readonly onTextDelta?: (delta: string, requestId: string) => void;
    readonly onReasoningDelta?: (delta: string, requestId: string) => void;
    readonly onConfiguration?: (configuration: Readonly<AppRuntimeConfiguration>) => void;
    /** 只读观察器；Session required sink 提交成功后才会收到事件。 */
    readonly observerEventSinks?: readonly (EventSinkPort & {
        readonly delivery: "best_effort";
    })[];
}
export interface ResumeAppResult {
    readonly sessionId: string;
    readonly state: RunState;
    readonly action: RecoveryAction;
    readonly enabledTools: readonly string[];
    readonly provider: string;
}
/**
 * 公开恢复入口：没有显式目标时保持旧 CLI 的「最新 Turn」语义。
 */
export declare function resumeCodingAgent(input: Readonly<ResumeAppInput>): Promise<ResumeAppResult>;
/**
 * 内部恢复入口：把稳定执行身份解析出的 `{runId, turnId}` 贯穿 Turn 选择与
 * `RecoveryCoordinator`，使旧身份重放不再退回「最新 Turn」。公开签名不变。
 */
export declare function resumeCodingAgentInternal(input: Readonly<ResumeAppInput>, target: RecoveryTarget): Promise<ResumeAppResult>;
//# sourceMappingURL=resume-composition.d.ts.map