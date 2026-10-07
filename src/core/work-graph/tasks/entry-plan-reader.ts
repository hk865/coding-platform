/**
 * C6 (STATE-MACHINES-SPEC §3.3 point 5, §6.1 contract (g); A.2 step 5.4b): the
 * reads behind the pure `entryPlanVerdict`. W3 (`authorizeRuntimeEntry`, and
 * the RUN-03 re-authorization through the same call) asks whether a claim
 * pinned to an older Plan may still enter. The LA-2 predicate that asked the
 * same of a reader Run's material grant was deleted with the grants (decision 34).
 */
import type { EntryPlanVerdict } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import { readOriginPlans, type Rejected } from './plan-readers.js';
import { planRevisionRefKey } from './plan-record-codecs.js';
import { entryPlanVerdict, isBasisUnsupported, planTaskFacts } from './plan-task-basis.js';

export type EntryPlanRead = { status: 'ready'; verdict: EntryPlanVerdict; guards: RecordGuard[] };

function planGuard(plan: PlanRevisionSnapshot): RecordGuard {
  return { refKey: planRevisionRefKey(plan.ref), expectedRevision: plan.revision };
}

/**
 * The entry Plan verdict of a claim on `claimPlan` (held by the caller) while
 * the Goal's active Plan is `activePlanRef`. A Goal without an active Plan is
 * `changed` (today's `revision_conflict`); the active Plan itself is
 * `active_plan` without another read. Otherwise the active Plan, then the basis
 * sources the two Plans name for the Task, are read (`readOriginPlans`, all
 * immutable). `guards` pin the active Plan and every basis source read, and
 * are returned only with `carried_unchanged`, the one verdict a commit follows;
 * the caller's Goal@rev guard serializes that commit with a later adoption.
 */
export async function readEntryPlanVerdict(
  records: GoalRecordTransactionPort,
  input: { goalRef: GoalRef; taskId: string; claimPlan: PlanRevisionSnapshot; activePlanRef: PlanRevisionRef | null },
): Promise<EntryPlanRead | Rejected> {
  const { goalRef, taskId, claimPlan, activePlanRef } = input;
  if (activePlanRef === null) {
    return { status: 'ready', verdict: { kind: 'changed', reason: 'the Goal has no active Plan' }, guards: [] };
  }
  const activeKey = planRevisionRefKey(activePlanRef);
  if (activeKey === planRevisionRefKey(claimPlan.ref)) {
    return { status: 'ready', verdict: { kind: 'active_plan' }, guards: [] };
  }
  const active = await readOriginPlans(records, [activePlanRef]);
  if (active.status !== 'ready') return active;
  const activePlan = active.value.plansByRefKey.get(activeKey);
  if (activePlan === undefined) {
    return { status: 'ready', guards: [],
      verdict: { kind: 'unavailable', reason: `the Goal active Plan ${activePlanRef.planId} is missing` } };
  }
  const held = new Set([activeKey, planRevisionRefKey(claimPlan.ref)]);
  const sourceRefs = new Map<string, PlanRevisionRef>();
  for (const plan of [claimPlan, activePlan]) {
    const basis = planTaskFacts(plan).basis.get(taskId);
    if (basis === undefined || isBasisUnsupported(basis)) continue; // `entryPlanVerdict` reports it
    const key = planRevisionRefKey(basis);
    if (!held.has(key)) sourceRefs.set(key, basis);
  }
  const sources = await readOriginPlans(records, [...sourceRefs.values()]);
  if (sources.status !== 'ready') return sources;
  const verdict = entryPlanVerdict({ claimPlan, activePlan, basisSources: sources.value.plansByRefKey, taskId, goalRef });
  const guards = verdict.kind !== 'carried_unchanged' ? []
    : [activePlan, ...sources.value.plansByRefKey.values()].map(planGuard);
  return { status: 'ready', verdict, guards };
}
