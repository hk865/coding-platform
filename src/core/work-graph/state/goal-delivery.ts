/**
 * Delivery acceptance (decision 121-45, acc), the pure half: whether a completed Goal has a delivery to accept, and the
 * one `GoalDeliveryAcceptance@1` constructor. No store, clock or `now()` here; the owner reads the facts and passes
 * them in. The acceptance never changes the Goal, its GoalPhase, its Plan, its Tasks or any Run: it only records that
 * the person acknowledged this completion of this active Plan.
 */
import type { GoalDeliveryAcceptanceV1 } from '../../../contracts/goal-delivery.js';
import type { GoalPhaseSnapshot } from '../../../contracts/goal-phase.js';
import type { GoalSnapshot } from '../../../contracts/ledger.js';
import { samePlanPointer } from './plan-machine.js';

const NOT_COMPLETED = 'the Goal is not completed for its active Plan; there is no delivery to accept';

/**
 * ACC-04.2: why this Goal has no delivery to accept, or null when it does. A cancelled Goal, a missing GoalPhase, a
 * GoalPhase that is not `COMPLETED`, and a GoalPhase whose Plan the active Plan has replaced all read the same way: a
 * new Plan is a new delivery, so an old phase's completion is not the current one.
 */
export function goalDeliveryProblem(goal: GoalSnapshot, phase: GoalPhaseSnapshot | null): string | null {
  if (goal.desiredState === 'cancelled') return NOT_COMPLETED;
  if (phase === null || phase.phase !== 'COMPLETED') return NOT_COMPLETED;
  if (!samePlanPointer(goal.activePlanRevision, phase.planRef)) return NOT_COMPLETED;
  return null;
}

/** ACC-05: the one constructor; the ref names the GoalPhase revision, and the Plan comes from that phase. */
export function goalDeliveryAcceptanceOf(input: {
  goal: GoalSnapshot;
  phase: GoalPhaseSnapshot;
  acceptedBy: { kind: 'human'; id: string };
  acceptedAt: string;
  requestId: string;
}): GoalDeliveryAcceptanceV1 {
  const { goal, phase } = input;
  return {
    ref: { aggregateType: 'GoalDeliveryAcceptance', projectId: goal.ref.projectId, goalId: goal.ref.goalId,
      phaseRevision: phase.revision },
    schemaVersion: 1,
    revision: 1,
    goalRef: { ...goal.ref },
    planRef: { ...phase.planRef },
    planRevision: phase.planRevision,
    acceptedBy: { ...input.acceptedBy },
    acceptedAt: input.acceptedAt,
    requestId: input.requestId,
  };
}
