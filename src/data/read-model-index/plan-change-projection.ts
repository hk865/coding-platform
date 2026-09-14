import type { GoalRevisionSnapshot, TaskDispositionRow } from '../../contracts/goal-change.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { PolicyExplanationPort } from '../../contracts/policy-explanation.js';

/** Compute displayed task dispositions while leaving snapshot lookup in the adapter. */
export function projectPlanChangeDispositions(
  revisions: readonly GoalRevisionSnapshot[],
  readPlan: (ref: PlanRevisionSnapshot['ref']) => PlanRevisionSnapshot | null | undefined,
  explain: PolicyExplanationPort['explainPlanChange'],
): TaskDispositionRow[] {
  if (revisions.length === 0) return [];
  const change = revisions[revisions.length - 1]!.change;
  if (change.supersededPlanRefs.length === 0) return [];
  const source = readPlan(change.supersededPlanRefs[change.supersededPlanRefs.length - 1]!);
  const target = readPlan(change.activePlanRef);
  if (!source || !target) return [];
  return explain({ source, target, pausedTaskIds: [] });
}
