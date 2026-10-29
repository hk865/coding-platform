/**
 * The Goal interruption record's two transitions. Absent or `resumed` starts a new `pending` revision; an already
 * `pending` record is kept; only `pending` can be `resumed`. The expected revision is the caller's absent guard.
 */
import type { RunRef } from '../../../contracts/dispatch.js';
import type { GoalInterruptionClose, GoalInterruptionRef, GoalInterruptionV1 } from '../../../contracts/goal-interruption.js';
import type { GoalRef } from '../../../contracts/ledger.js';

export type GoalInterruptionWriteV1 = { record: GoalInterruptionV1; expectedRevision: number | null };

export type PendingGoalInterruptionInputV1 = {
  goalRef: GoalRef; close: GoalInterruptionClose; detectedAt: string;
  taskIds: readonly string[]; runRefs: readonly RunRef[];
};

/** The record's address: one record per Goal. */
export function interruptionRefOf(goalRef: GoalRef): GoalInterruptionRef {
  return { aggregateType: 'GoalInterruption', projectId: goalRef.projectId, goalId: goalRef.goalId };
}

/** Absent or `resumed` → `pending` at revision + 1; `pending` → null, kept. */
export function pendingGoalInterruption(
  current: GoalInterruptionV1 | null,
  input: PendingGoalInterruptionInputV1,
): GoalInterruptionWriteV1 | null {
  if (current !== null && current.status === 'pending') return null;
  return {
    record: {
      ref: interruptionRefOf(input.goalRef),
      revision: (current?.revision ?? 0) + 1, status: 'pending', close: input.close, detectedAt: input.detectedAt,
      taskIds: [...input.taskIds], runRefs: input.runRefs.map((run) => ({ ...run })),
    },
    expectedRevision: current === null ? null : current.revision,
  };
}

/** `pending` → `resumed` at revision + 1; absent or already `resumed` → null, no write. */
export function resumedGoalInterruption(current: GoalInterruptionV1 | null): GoalInterruptionWriteV1 | null {
  if (current === null || current.status !== 'pending') return null;
  return { record: { ...current, revision: current.revision + 1, status: 'resumed' },
    expectedRevision: current.revision };
}
