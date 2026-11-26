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
 * G6 partial acceptance: the person's trade-off text and who accepted. Only the
 * configured operator writes one (MVP: a required cancellation never counts as
 * complete by itself); the instant is the record's `reducedAt`.
 */
export type GoalPartialAcceptanceV1 = { rationale: string; acceptedBy: { kind: 'human'; id: string } };

/**
 * The formal Goal result for one plan. `COMPLETED` is written by `completeGoal`
 * when everything required is formally satisfied; `ACCEPTED_PARTIAL` by
 * `acceptPartialResult` when the person ends the Goal with what is done (G6).
 * `adoptedTaskReductions` pins the formal reductions satisfied at that moment
 * and `satisfiedObligationIds` the obligations actually covered; for a partial
 * acceptance they are its evidence refs.
 *
 * Both variants stay in ONE alias (an intersection with a parenthesised union):
 * the state-write check reads only this form as `GoalPhaseSnapshot` fields.
 */
export type GoalPhaseSnapshot = {
    ref: GoalPhaseRef;
    revision: number;
    schemaVersion: 1;
    planRef: PlanRevisionRef;
    planRevision: number;
    adoptedTaskReductions: { ref: TaskReductionRef; revision: number }[];
    satisfiedObligationIds: string[];
    reducedAt: string;
} & ({ phase: 'COMPLETED' } | { phase: 'ACCEPTED_PARTIAL'; partialAcceptance: GoalPartialAcceptanceV1 });
