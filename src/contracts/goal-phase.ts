// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
import type { PlanRevisionRef } from "./plan.js";
import type { TaskReductionRef } from "./reduction.js";
// ------------------------------------------------------------------------ //
// GoalPhase aggregate                                                        //
// ------------------------------------------------------------------------ //
export type GoalPhaseRef = {
    aggregateType: "GoalPhase";
    projectId: string;
    goalId: string;
};

/**
 * R3e.3 first formal Goal terminal snapshot.
 *
 * This batch declares ONLY the real `COMPLETED` result written by
 * `completeGoal`; the legacy ten-state controller (paused/maintenance/Decision
 * inputs) is intentionally not migrated here. `adoptedTaskReductions` pins the
 * exact formal reductions the Goal completion consumed and
 * `satisfiedObligationIds` records the obligations actually covered.
 */
export type GoalPhaseSnapshot = {
    ref: GoalPhaseRef;
    revision: number;
    schemaVersion: 1;
    planRef: PlanRevisionRef;
    planRevision: number;
    phase: 'COMPLETED';
    adoptedTaskReductions: { ref: TaskReductionRef; revision: number }[];
    satisfiedObligationIds: string[];
    reducedAt: string;
};
