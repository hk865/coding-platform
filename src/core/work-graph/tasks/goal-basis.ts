/**
 * Slice 5 §2.2/§2.8: the ONE default-applying Goal content basis.
 *
 * `GoalDecisionBasisV1` is optional card content and a provenance fact, not an
 * identity: every reader that needs it must apply the saved settings defaults
 * the same way. This module holds that single derivation in `tasks/` so both
 * the read model (`views/`) and the communication source facts may import it;
 * `views/goal-conflicts.ts` re-exports it for its historical importers.
 */
import type { GoalDecisionBasisV1 } from '../../../contracts/goal-decisions.js';
import type { GoalSnapshot } from '../../../contracts/ledger.js';
import { readGoalSettings } from '../persistence/record-codecs.js';

export function goalDecisionBasis(goal: GoalSnapshot): GoalDecisionBasisV1 {
  return { goalRef: { ...goal.ref }, workspaceRef: { ...goal.workspaceRef }, objective: goal.objective,
    activePlanRef: goal.activePlanRevision === null ? null : { ...goal.activePlanRevision },
    settings: structuredClone(readGoalSettings(goal)) };
}
