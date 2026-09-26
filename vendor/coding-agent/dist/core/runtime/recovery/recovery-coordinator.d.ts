import type { CheckpointStorePort } from "../../ports/checkpoint_store/checkpoint-store-port.js";
import type { RunConfigSnapshot, SessionRecord, SessionStorePort, StoreCallOptions, WorkspaceReference } from "../../ports/session_store/session-store-port.js";
import type { AgentEvent } from "../events/agent-events.js";
import type { ToolEffectClass } from "../../ports/tool_executor/tool-executor-port.js";
import type { RunState } from "../state/run-state.js";
export type RecoveryAction = "start_run" | "continue_before_model" | "continue_before_tools" | "paused" | "terminal" | "side_effect_result_unknown";
export interface RecoveryResult {
    readonly sessionId: string;
    readonly revision: number;
    readonly lastPosition: number;
    readonly state: RunState;
    readonly action: RecoveryAction;
    readonly checkpointId: string | null;
    readonly reconciledEvent: AgentEvent | null;
    /** 本次恢复追加到 Session 的全部对账事件（按追加顺序），供 observer/Web Projection 消费。 */
    readonly reconciledEvents: readonly AgentEvent[];
}
export interface RecoveryEnvironment {
    readonly config: RunConfigSnapshot;
    readonly workspace: WorkspaceReference;
    /**
     * 继续执行（start_run / continue_before_* / paused 恢复）前的原有效约束核对。
     * 由组合层注入 `requireEffectiveRecoveryConstraints` 的闭包，Core 不反向依赖 app 类型；
     * Core 保证在**任何对账写入与任何继续动作之前**调用。缺省表示调用方自行保证
     * （直接调用 Coordinator 的既有路径保持兼容）。
     */
    readonly assertEffectiveConstraints?: () => void;
}
/** 精确恢复目标：稳定 runId/turnId；`null` 表示旧 CLI 的最新 Turn 语义。 */
export interface RecoveryTurnTarget {
    readonly runId: string;
    readonly turnId: string;
}
/**
 * R4a 唯一的 Turn 选择算法（Core 命名导出纯函数；app 的 `selectRecoveryTurn` 薄委托）。
 *
 * 返回目标 Turn 的**独占**记录范围：从它的 `turn.started` 起，止于下一条 `turn.started`，
 * 绝不把后续 Turn 的事件或 checkpoint 归入目标状态。`target=null` 保持旧 CLI 的
 * 「最新 Turn」语义；精确目标必须同时匹配 runId 与 turnId，不按最新 Turn 代替。
 */
export declare function selectRecoveryTurnRecords(records: readonly SessionRecord[], target: RecoveryTurnTarget | null): readonly SessionRecord[];
export interface RecoveryCoordinatorDependencies {
    readonly sessions: SessionStorePort;
    readonly checkpoints?: CheckpointStorePort;
    readonly idFactory?: () => string;
    readonly now?: () => Date;
    /**
     * 返回工具声明的副作用类别，用于 outcome_unknown 审计与合成结果。
     * 缺省按最保守的 process 处理（可能产生副作用，禁止自动重试）。
     */
    readonly toolEffectClass?: (name: string) => ToolEffectClass;
}
/**
 * 以 append-only Session 事实为真相恢复状态；checkpoint 只用于加速。
 * 恢复器先消解进程中断窗口，再把稳定状态交给 RuntimeRunner 继续。
 */
export declare class RecoveryCoordinator {
    #private;
    constructor(dependencies: RecoveryCoordinatorDependencies);
    recover(sessionId: string, options: Readonly<StoreCallOptions>, environment?: Readonly<RecoveryEnvironment>, target?: RecoveryTurnTarget | null): Promise<RecoveryResult>;
}
//# sourceMappingURL=recovery-coordinator.d.ts.map