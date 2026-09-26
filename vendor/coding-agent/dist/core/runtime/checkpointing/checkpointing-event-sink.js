import { checkpointDraft, deriveCheckpointResumeMode, } from "../../ports/checkpoint_store/checkpoint-store-port.js";
import { reduceRunState } from "../reducer/run-state-reducer.js";
const CHECKPOINT_BOUNDARIES = new Set([
    "run.started",
    "assistant.message_completed",
    "tool.completed",
    "tool.failed",
    "tool.cancelled",
    "tool.outcome_unknown",
    "model.request_failed",
    "run.paused",
    "run.completed",
    "run.cancelled",
    "run.limit_exceeded",
    "run.failed",
]);
export class CheckpointingEventSink {
    store;
    cursor;
    config;
    contextBasis;
    recoveryConstraints;
    sinkId;
    delivery = "best_effort";
    #state;
    #workspace;
    constructor(initialState, store, cursor, config, workspace, sinkId = "99-checkpoint-store", 
    /**
     * 与本 Run 的 turn.started 相同的会话历史绑定；缺省不写入该字段，
     * 旧 checkpoint 正文与 current_turn 语义保持不变。
     */
    contextBasis, 
    /**
     * 与本 Run 的 turn.started 相同的实际生效恢复约束；缺省不写入该字段，
     * 旧 checkpoint 正文与「无有效约束证据」语义保持不变。
     */
    recoveryConstraints) {
        this.store = store;
        this.cursor = cursor;
        this.config = config;
        this.contextBasis = contextBasis;
        this.recoveryConstraints = recoveryConstraints;
        this.#state = structuredClone(initialState);
        this.#workspace = structuredClone(workspace);
        this.sinkId = sinkId;
    }
    get state() {
        return structuredClone(this.#state);
    }
    async publish(event, options) {
        this.#state = reduceRunState(this.#state, event);
        // 结算事件（含正常取消）都可能携带部分写入后的 workspace revision；
        // 必须纳入版本推进，否则恢复时会把 Agent 在取消前产生的修改误判为外部并发变更。
        if (event.type === "tool.completed" ||
            event.type === "tool.failed" ||
            event.type === "tool.cancelled") {
            const revision = event.payload.result.effects.workspaceRevision;
            if (revision)
                this.#workspace = { ...this.#workspace, revision };
        }
        if (!CHECKPOINT_BOUNDARIES.has(event.type))
            return;
        try {
            deriveCheckpointResumeMode(this.#state);
        }
        catch {
            return;
        }
        const position = this.cursor.lastPosition;
        await this.store.save(checkpointDraft(`checkpoint:${this.#state.runId}:${String(position)}`, this.cursor.sessionId, position, this.#state, this.config, this.#workspace, event.meta.occurredAt, this.contextBasis, this.recoveryConstraints), options);
    }
}
//# sourceMappingURL=checkpointing-event-sink.js.map