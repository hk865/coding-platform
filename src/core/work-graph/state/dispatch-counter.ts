import type { DispatchCounterV1, GoalRef } from '../../../contracts/ledger.js';
import type { ActionRequestRef } from '../../../contracts/action-request.js';

export type DispatchCounterWriteV1 = { record: DispatchCounterV1; expectedRevision: number | null };

// `actionRef` is the action request this +1 came from: a request-based claim fills it; a write that does not count a
// request passes `null` (Q5c 甲, the format allows it).

/**
 * S7-DC-01: absent -> 1, expectedRevision null; never writes 0. The caller's absent guard is the null revision, so
 * the first commit only succeeds while no counter exists.
 */
export function firstDispatch(goalRef: GoalRef, actionRef: ActionRequestRef | null): DispatchCounterWriteV1 {
  return {
    record: {
      ref: { aggregateType: 'DispatchCounter', projectId: goalRef.projectId, goalId: goalRef.goalId },
      schemaVersion: 1,
      revision: 1,
      goalId: goalRef.goalId,
      sequence: 1,
      lastActionRef: actionRef,
    },
    expectedRevision: null,
  };
}

/**
 * S7-DC-02: n -> n+1, expectedRevision = the read revision. The guard is the version the read observed, so a second
 * writer that read the same revision conflicts instead of overwriting the increment.
 */
export function nextDispatch(current: DispatchCounterV1, actionRef: ActionRequestRef | null): DispatchCounterWriteV1 {
  return {
    record: {
      ref: current.ref,
      schemaVersion: current.schemaVersion,
      revision: current.revision + 1,
      goalId: current.goalId,
      sequence: current.sequence + 1,
      lastActionRef: actionRef,
    },
    expectedRevision: current.revision,
  };
}
