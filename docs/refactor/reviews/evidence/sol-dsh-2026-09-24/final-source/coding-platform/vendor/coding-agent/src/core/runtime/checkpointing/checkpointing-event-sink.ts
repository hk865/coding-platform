/**
 * 模块职责：在关键 AgentEvent 边界把已提交状态保存为可恢复的 checkpoint。
 *
 * 设计边界：checkpoint 是 best_effort 加速层，Session 事件日志仍是恢复时的事实来源。
 * 关键流程：先用 reducer 更新镜像状态和 workspace 版本，再在安全边界生成并保存草稿。
 */
import type { CheckpointStorePort } from "../../ports/checkpoint_store/checkpoint-store-port.js";
import {
  checkpointDraft,
  deriveCheckpointResumeMode,
} from "../../ports/checkpoint_store/checkpoint-store-port.js";
import type { EventSinkPort } from "../../ports/event_sink/event-sink-port.js";
import type {
  ContextBasis,
  EffectiveRecoveryConstraintsRecord,
  RunConfigSnapshot,
  WorkspaceReference,
} from "../../ports/session_store/session-store-port.js";
import { reduceRunState } from "../reducer/run-state-reducer.js";
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

export class CheckpointingEventSink implements EventSinkPort {
  readonly sinkId: string;
  readonly delivery = "best_effort" as const;
  #state: RunState;
  #workspace: WorkspaceReference;

  constructor(
    initialState: Readonly<RunState>,
    private readonly store: CheckpointStorePort,
    private readonly cursor: CommittedSessionCursor,
    private readonly config: RunConfigSnapshot,
    workspace: WorkspaceReference,
    sinkId = "99-checkpoint-store",
    /**
     * 与本 Run 的 turn.started 相同的会话历史绑定；缺省不写入该字段，
     * 旧 checkpoint 正文与 current_turn 语义保持不变。
     */
    private readonly contextBasis?: ContextBasis,
    /**
     * 与本 Run 的 turn.started 相同的实际生效恢复约束；缺省不写入该字段，
     * 旧 checkpoint 正文与「无有效约束证据」语义保持不变。
     */
    private readonly recoveryConstraints?: EffectiveRecoveryConstraintsRecord,
  ) {
    this.#state = structuredClone(initialState);
    this.#workspace = structuredClone(workspace);
    this.sinkId = sinkId;
  }

  get state(): RunState {
    return structuredClone(this.#state);
  }

  async publish(
    event: Parameters<EventSinkPort["publish"]>[0],
    options: Parameters<EventSinkPort["publish"]>[1],
  ): Promise<void> {
    this.#state = reduceRunState(this.#state, event);
    // 结算事件（含正常取消）都可能携带部分写入后的 workspace revision；
    // 必须纳入版本推进，否则恢复时会把 Agent 在取消前产生的修改误判为外部并发变更。
    if (
      event.type === "tool.completed" ||
      event.type === "tool.failed" ||
      event.type === "tool.cancelled"
    ) {
      const revision = event.payload.result.effects.workspaceRevision;
      if (revision) this.#workspace = { ...this.#workspace, revision };
    }
    if (!CHECKPOINT_BOUNDARIES.has(event.type)) return;
    try {
      deriveCheckpointResumeMode(this.#state);
    } catch {
      return;
    }
    const position = this.cursor.lastPosition;
    await this.store.save(
      checkpointDraft(
        `checkpoint:${this.#state.runId}:${String(position)}`,
        this.cursor.sessionId,
        position,
        this.#state,
        this.config,
        this.#workspace,
        event.meta.occurredAt,
        this.contextBasis,
        this.recoveryConstraints,
      ),
      options,
    );
  }
}
