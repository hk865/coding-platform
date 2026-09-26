import type { ContextBuilderPort } from "../../context/builder/context-builder.js";
import type { TokenEstimator } from "../../context/selection_policy/context-selection-policy.js";
import type { ContextFragment, MemoryItem, SkillContext } from "../../context/types/context-types.js";
import { HookExecutor } from "../../hooks/executor/hook-executor.js";
import type { ModelClientPort, ModelToolSpec } from "../../ports/model_client/model-client-port.js";
import type { ToolBatchPolicy } from "../../ports/tool_batch_policy/tool-batch-policy-port.js";
import type { ToolCall, ToolEffectClass, ToolExecutorPort } from "../../ports/tool_executor/tool-executor-port.js";
import type { EventSinkPort } from "../../ports/event_sink/event-sink-port.js";
import type { CancellationReason } from "../cancellation/cancellation-controller.js";
import type { RunLimits } from "../limits/limit-guard.js";
import type { Run, RunState, TranscriptEntry } from "../state/run-state.js";
export interface RuntimeClock {
    now(): Date;
}
export interface RuntimeIdGenerator {
    next(): string;
}
export interface RunnerContextInput {
    readonly run: Run;
    readonly baseSystemPrompt: string;
    readonly additionalInstructions?: readonly ContextFragment[];
    readonly tools?: readonly ModelToolSpec[];
    readonly skills?: readonly SkillContext[];
    readonly memories?: readonly MemoryItem[];
    readonly tokenBudget: number;
    readonly maxOutputTokens?: number | null;
    /**
     * 已完成轮次重建出的会话历史前缀；与当前 Turn 的 transcript 一起只做**一次**
     * 预算选择（selectContext），不做第二套历史选择算法。
     * 缺省为空数组，旧 CLI 的 `current_turn` 语义不变。
     */
    readonly historyTranscript?: readonly TranscriptEntry[];
}
export interface RunnerCallOptions {
    readonly signal?: AbortSignal;
    readonly cancellationReason?: CancellationReason;
}
/**
 * R4.2 Kernel 工具组安全点：宿主协作控制在工具组边界的只读观察定位。
 *
 * 这些字段只描述当前 state/group，不能被平台当作已持久化的 pause ack；它们只说明
 * 屏障在哪个真实时点被询问，不证明暂停、排空或副作用停止已经发生。
 */
export type ToolGroupBarrierInvocation = {
    readonly point: "before_group" | "after_group";
    readonly runId: string;
    readonly turnId: string;
    readonly lastEventSequence: number;
    readonly callIds: readonly string[];
};
export type ToolGroupBarrierDecision = {
    readonly kind: "continue";
} | {
    readonly kind: "pause";
};
export type ToolGroupBarrier = (invocation: Readonly<ToolGroupBarrierInvocation>, options: Readonly<{
    signal: AbortSignal;
}>) => Promise<ToolGroupBarrierDecision>;
export interface RuntimeRunnerDependencies {
    readonly modelClient: ModelClientPort;
    readonly toolExecutor: ToolExecutorPort;
    readonly contextBuilder?: ContextBuilderPort;
    readonly tokenEstimator?: TokenEstimator;
    readonly hookExecutor?: HookExecutor;
    readonly eventSinks?: readonly EventSinkPort[];
    readonly limits?: RunLimits;
    readonly clock?: RuntimeClock;
    readonly idGenerator?: RuntimeIdGenerator;
    readonly toolBatchPolicy?: ToolBatchPolicy;
    readonly maxModelRetries?: number;
    readonly eventSinkTimeoutMs?: number;
    readonly onTextDelta?: (delta: string, requestId: string) => void;
    readonly onReasoningDelta?: (delta: string, requestId: string) => void;
    /**
     * 返回工具声明的副作用类别，用于 outcome_unknown 的审计与合成结果。
     * 缺省按最保守的 process 处理（可能产生副作用，禁止自动重试）。
     */
    readonly toolEffectClass?: (call: Readonly<ToolCall>) => ToolEffectClass;
    /**
     * 工具组收尾的有界等待时间（毫秒）。组内个别工具忽略 AbortSignal 且永不返回时，
     * drain 超时后按「结果未知」落盘 cancelled/outcome_unknown，避免取消流程永久挂起。
     * 0 表示无限等待（不推荐）；默认 5_000。
     */
    readonly toolDrainTimeoutMs?: number;
    /**
     * 可选工具组屏障；缺省不调用任何新逻辑，旧 CLI/Kernel 行为不变。
     * R4.2 第一阶段只接通类型与透传，决策归约尚未实现：提供 callback 时在首个
     * 工具组边界显式 unsupported，绝不悄悄忽略后继续执行工具。
     */
    readonly toolGroupBarrier?: ToolGroupBarrier;
}
export declare class RunnerBusyError extends Error {
    readonly code = "runner_busy";
    constructor();
}
/**
 * Runtime 的唯一编排入口：所有状态变化先构造 AgentEvent，再经 required sink
 * 提交和 Reducer 推进；模型、Hook、工具都不能直接修改 RunState。
 */
export declare class RuntimeRunner {
    #private;
    constructor(dependencies: RuntimeRunnerDependencies);
    run(input: Readonly<RunnerContextInput>, options?: RunnerCallOptions): Promise<RunState>;
    resume(pausedState: Readonly<RunState>, input: Readonly<RunnerContextInput>, options?: RunnerCallOptions): Promise<RunState>;
    /**
     * 接收 RecoveryCoordinator 已完成 reconciliation 的稳定状态。
     * awaiting_model 或 running tool 必须先由恢复器消解，不能在这里猜测执行结果。
     */
    continueRecovered(recoveredState: Readonly<RunState>, input: Readonly<RunnerContextInput>, options?: RunnerCallOptions): Promise<RunState>;
}
//# sourceMappingURL=runtime-runner.d.ts.map