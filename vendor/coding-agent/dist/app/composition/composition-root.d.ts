import type { ApprovalRequester } from "../../policy/approval/approval-coordinator.js";
import type { EventSinkPort } from "../../core/ports/event_sink/event-sink-port.js";
import type { HookPort } from "../../core/hooks/protocol/hook-protocol.js";
import { type ToolGroupBarrier } from "../../core/runtime/loop/runtime-runner.js";
import type { RunState } from "../../core/runtime/state/run-state.js";
import type { ProviderRegistry } from "../../model/providers/registry/provider-registry.js";
import { WorkspaceSandbox } from "../../sandbox/workspace/workspace-sandbox.js";
import type { AppConfig } from "./app-config.js";
import { kernelSessionApiVersion, type AppRuntimeConfiguration, type ExecutionIdentity, type SecretSource, type SessionContextMode } from "./composition-contracts.js";
/**
 * 共享类型继续从本文件可达，`m5-public-api` 的既有导出路径不变。
 * 定义在 composition-contracts.ts，避免与 resume-composition 形成循环导入。
 */
export type { AppRuntimeConfiguration, SecretSource } from "./composition-contracts.js";
export { kernelSessionApiVersion };
export type { ExecutionIdentity, SessionContextMode };
export interface RunAppInput {
    /** Host-provided tools still use registry validation, permissions and output limits. */
    readonly additionalTools?: (workspace: WorkspaceSandbox) => readonly import("../../tools/schemas/tool-schemas.js").ToolDefinition[];
    /**
     * 宿主对**非只读**扩展能力的显式授权（工具名）。
     *
     * 只有同时出现在 `additionalTools`（本轮确实注册）且 effectClass 不是 read_only 的名字
     * 才会被采纳；内置 read/check/edit/shell 的规则与路径/敏感资源检查不受影响。
     * 这是"宿主必须明确授权"的唯一入口：工具自身不能把自己的能力声明成只读来换取放行。
     */
    readonly hostAuthorizedTools?: readonly string[];
    /** Host integration: additive controls, no changes to default CLI behavior. */
    readonly limits?: import("../../core/runtime/limits/limit-guard.js").RunLimits;
    readonly processSandboxOptions?: import("../../sandbox/process/process-sandbox.js").ProcessSandboxOptions;
    readonly workspaceOptions?: import("../../sandbox/workspace/workspace-sandbox.js").WorkspaceSandboxOptions;
    /**
     * 会话上下文模式；缺省 `current_turn`，即与旧 CLI 完全相同的单轮输入。
     * `session_history` 要求 Session 已存在，且 `throughPosition` 是真实已完成轮次的边界。
     */
    readonly sessionContext?: SessionContextMode;
    /** 稳定执行身份；缺省随机生成。提供时同一身份+相同内容进入恢复/回放，不追加第二个 Turn。 */
    readonly executionIdentity?: ExecutionIdentity;
    /**
     * 宿主控制 Hook；只接入 `before_model`/`before_tool` 的 `pause`/`continue`。
     * `after_tool` 与 block/modify/fail 显式 unsupported，不假装已接通。
     */
    readonly controlHooks?: readonly HookPort[];
    /**
     * 可选工具组安全点回调；缺省不调用，旧 CLI/Kernel 行为不变。R4.2 第一阶段
     * 只做类型与透传，实际决策归约在受管 Kernel 实现阶段接通。
     */
    readonly toolGroupBarrier?: ToolGroupBarrier;
    /** Host input supply read at a real drained before_model boundary. */
    readonly inputSupply?: import("./composition-contracts.js").AppInputSupply;
    readonly config: AppConfig;
    readonly workspaceRoot: string;
    readonly input: string;
    readonly sessionId?: string;
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
export interface RunAppResult {
    readonly sessionId: string;
    readonly state: RunState;
    readonly enabledTools: readonly string[];
    readonly provider: string;
}
export declare function runCodingAgent(input: Readonly<RunAppInput>): Promise<RunAppResult>;
//# sourceMappingURL=composition-root.d.ts.map