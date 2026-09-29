/**
 * 模块职责：把 append-only Session 记录或待追加草稿纯函数地投影为 RunState。
 *
 * 设计边界：本模块不读取或写入存储，也不处理 revision 并发控制。
 * 关键流程：从 Turn 起点创建状态，随后按记录顺序把 AgentEvent 交给 reducer 重放。
 */
import { reduceRunState } from "../../runtime/reducer/run-state-reducer.js";
import { createInitialRunState, isTerminalRunStatus } from "../../runtime/state/run-state.js";
import type { RunState } from "../../runtime/state/run-state.js";
import type { SessionRecord, SessionRecordDraft } from "./session-store-port.js";
import { StoreError } from "./session-store-port.js";

export function replaySessionRecords(records: readonly SessionRecord[]): RunState | null {
  let state: RunState | null = null;
  for (const record of records) {
    if (record.recordType === "turn.started") {
      if (state && !isTerminalRunStatus(state.status)) {
        throw new StoreError("corrupt", "Session 中出现重叠的 Turn", record.position - 1);
      }
      state = createInitialRunState(record.payload.run);
    } else if (record.recordType === "agent.event") {
      if (!state)
        throw new StoreError("corrupt", "agent.event 缺少 turn.started", record.position - 1);
      try {
        state = reduceRunState(state, record.payload.event);
      } catch {
        throw new StoreError("corrupt", "Session AgentEvent 无法重放", record.position - 1);
      }
    }
  }
  return state;
}

export function applySessionDraft(state: RunState | null, draft: SessionRecordDraft): RunState {
  if (draft.recordType === "turn.started") {
    if (state && !isTerminalRunStatus(state.status)) {
      throw new StoreError("invalid_record", "Session 已有未终止 Turn");
    }
    return createInitialRunState(draft.payload.run);
  }
  if (!state) throw new StoreError("invalid_record", "agent.event 缺少当前 Turn");
  try {
    return reduceRunState(state, draft.payload.event);
  } catch {
    throw new StoreError("invalid_record", "AgentEvent 不符合当前 Session 状态");
  }
}

export function isActiveSessionState(state: RunState | null): state is RunState {
  return state !== null && !isTerminalRunStatus(state.status);
}
