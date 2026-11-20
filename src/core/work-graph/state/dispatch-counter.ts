import type { DispatchCounterV1, GoalRef } from '../../../contracts/ledger.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';

export type DispatchCounterWriteV1 = { record: DispatchCounterV1; expectedRevision: number | null };

// `messageRef` 是这次 +1 的来源消息：放行的“请动手”信填它；按派活请求领取的那次没有消息，填 `null`（Q5c 甲，格式本可空）。

/**
 * S7-DC-01: absent -> 1, expectedRevision null; never writes 0. The caller's absent guard is the null revision, so
 * the first commit only succeeds while no counter exists.
 */
export function firstDispatch(goalRef: GoalRef, messageRef: SessionMessageRef | null): DispatchCounterWriteV1 {
  return {
    record: {
      ref: { aggregateType: 'DispatchCounter', projectId: goalRef.projectId, goalId: goalRef.goalId },
      schemaVersion: 1,
      revision: 1,
      goalId: goalRef.goalId,
      sequence: 1,
      lastMessageRef: messageRef,
    },
    expectedRevision: null,
  };
}

/**
 * S7-DC-02: n -> n+1, expectedRevision = the read revision. The guard is the version the read observed, so a second
 * writer that read the same revision conflicts instead of overwriting the increment.
 */
export function nextDispatch(current: DispatchCounterV1, messageRef: SessionMessageRef | null): DispatchCounterWriteV1 {
  return {
    record: {
      ref: current.ref,
      schemaVersion: current.schemaVersion,
      revision: current.revision + 1,
      goalId: current.goalId,
      sequence: current.sequence + 1,
      lastMessageRef: messageRef,
    },
    expectedRevision: current.revision,
  };
}
