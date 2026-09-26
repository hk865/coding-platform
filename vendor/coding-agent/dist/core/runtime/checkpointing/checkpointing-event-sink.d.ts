/**
 * 模块职责：在关键 AgentEvent 边界把已提交状态保存为可恢复的 checkpoint。
 *
 * 设计边界：checkpoint 是 best_effort 加速层，Session 事件日志仍是恢复时的事实来源。
 * 关键流程：先用 reducer 更新镜像状态和 workspace 版本，再在安全边界生成并保存草稿。
 */
import type { CheckpointStorePort } from "../../ports/checkpoint_store/checkpoint-store-port.js";
import type { EventSinkPort } from "../../ports/event_sink/event-sink-port.js";
import type { ContextBasis, EffectiveRecoveryConstraintsRecord, RunConfigSnapshot, WorkspaceReference } from "../../ports/session_store/session-store-port.js";
import type { RunState } from "../state/run-state.js";
export interface CommittedSessionCursor {
    readonly sessionId: string;
    readonly lastPosition: number;
}
export interface CheckpointDiagnostic {
    readonly runId: string;
    readonly recordPosition: number;
    readonly message: string;
}
export declare class CheckpointingEventSink implements EventSinkPort {
    #private;
    private readonly store;
    private readonly cursor;
    private readonly config;
    /**
     * 与本 Run 的 turn.started 相同的会话历史绑定；缺省不写入该字段，
     * 旧 checkpoint 正文与 current_turn 语义保持不变。
     */
    private readonly contextBasis?;
    /**
     * 与本 Run 的 turn.started 相同的实际生效恢复约束；缺省不写入该字段，
     * 旧 checkpoint 正文与「无有效约束证据」语义保持不变。
     */
    private readonly recoveryConstraints?;
    readonly sinkId: string;
    readonly delivery: "best_effort";
    constructor(initialState: Readonly<RunState>, store: CheckpointStorePort, cursor: CommittedSessionCursor, config: RunConfigSnapshot, workspace: WorkspaceReference, sinkId?: string, 
    /**
     * 与本 Run 的 turn.started 相同的会话历史绑定；缺省不写入该字段，
     * 旧 checkpoint 正文与 current_turn 语义保持不变。
     */
    contextBasis?: ContextBasis | undefined, 
    /**
     * 与本 Run 的 turn.started 相同的实际生效恢复约束；缺省不写入该字段，
     * 旧 checkpoint 正文与「无有效约束证据」语义保持不变。
     */
    recoveryConstraints?: EffectiveRecoveryConstraintsRecord | undefined);
    get state(): RunState;
    publish(event: Parameters<EventSinkPort["publish"]>[0], options: Parameters<EventSinkPort["publish"]>[1]): Promise<void>;
}
//# sourceMappingURL=checkpointing-event-sink.d.ts.map