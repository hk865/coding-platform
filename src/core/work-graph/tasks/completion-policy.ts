/**
 * R3e.3 completion policy — the ONE pure Task/Goal completion rules seam.
 *
 * `evaluateTaskCompletion` consumes the single R3e effective-evidence fold
 * (`EffectiveEvidenceSet`) already computed by the completion service; it never
 * recomputes applicability, reviewer coverage or source status itself. A
 * required reviewer that has no formal producer is passed as
 * `requiredReviewerMissing`; when no adopted requirement asks for a reviewer the
 * caller passes `false` and this seam adds no prerequisite.
 *
 * `evaluateGoalCompletion` consumes only the selected Plan plus the canonical
 * task facts already read by the service (formal reductions + effective phases).
 *
 * `CanonicalTaskFacts`/`CanonicalTaskState` are TYPE-ONLY imports so this file
 * stays free of the reader's runtime (avoiding a completion <-> reader cycle).
 */
import type { EffectiveEvidenceSet } from '../../../contracts/evidence.js';
import { requirementKeyOf } from '../../../contracts/evidence.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { TaskReductionCause, TaskReductionPhase, TaskReductionSnapshot } from '../../../contracts/reduction.js';
import type { CanonicalTaskFacts, CanonicalTaskState } from './plan-readers.js';

export type TaskCompletionEvaluation = {
  satisfied: boolean;
  phase: TaskReductionPhase;
  causes: TaskReductionCause[];
  satisfiedObligationIds: string[];
};

export type GoalCompletionEvaluation = {
  completed: boolean;
  unfinishedTaskIds: string[];
  unsatisfiedObligationIds: string[];
  reasons: string[];
};

type RequiredRequirement = { obligationId: string; requirementId: string; kind: string };

/** The adopted required verification requirements of one Task, keyed by the
 * composite `obligationId + requirementId` identity (never a bare requirementId). */
function requiredRequirementsOf(plan: PlanRevisionSnapshot, taskId: string): {
  required: Map<string, RequiredRequirement>;
  requiredObligations: Set<string>;
} {
  const required = new Map<string, RequiredRequirement>();
  const requiredObligations = new Set<string>();
  for (const obligation of plan.obligations) {
    if (!obligation.taskIds.includes(taskId)) continue;
    if (obligation.requirementLevel !== 'required') continue;
    requiredObligations.add(obligation.obligationId);
    for (const requirement of obligation.verificationRequirements) {
      if (requirement.requirementLevel !== 'required') continue;
      const key = requirementKeyOf({ obligationId: obligation.obligationId, requirementId: requirement.requirementId });
      required.set(key, { obligationId: obligation.obligationId, requirementId: requirement.requirementId, kind: requirement.kind });
    }
  }
  return { required, requiredObligations };
}

/** A run whose real state blocks completion: still active, ended with an unknown
 * outcome, quarantined, unreconciled, or carrying an unreconciled entry
 * authorization. A normal ended Run is NEUTRAL: it never produces PASS. */
function runBlocker(run: RunSnapshot): string | null {
  if (run.status === 'starting' || run.status === 'running') {
    return `run ${run.ref.runId} is ${run.status} and has not ended`;
  }
  if (run.status === 'ended' && run.outcome === 'outcome_unknown') {
    return `run ${run.ref.runId} ended with an unknown outcome`;
  }
  const reconciliation = run.reconciliation;
  if (reconciliation !== undefined) {
    if (reconciliation.status === 'quarantined') return `run ${run.ref.runId} is quarantined and not reconciled`;
    if (reconciliation.observation.kind === 'unresolved') return `run ${run.ref.runId} carries an unresolved reconciliation`;
  }
  const authorization = run.executionAuthorization;
  if (authorization !== undefined && (authorization.phase === 'unknown' || authorization.phase === 'quarantined')) {
    return `run ${run.ref.runId} carries an unreconciled ${authorization.phase} entry authorization`;
  }
  return null;
}

/** PURE Task completion decision over the ONE effective-evidence set. */
export function evaluateTaskCompletion(input: {
  plan: PlanRevisionSnapshot;
  taskId: string;
  effectiveSet: EffectiveEvidenceSet;
  runs: readonly RunSnapshot[];
  lease: CanonicalTaskState['lease'];
  requiredReviewerMissing: boolean;
}): TaskCompletionEvaluation {
  const { plan, taskId, effectiveSet, runs, lease, requiredReviewerMissing } = input;
  const causes: TaskReductionCause[] = [];
  const task = plan.tasks.find(candidate => candidate.taskId === taskId);
  if (task === undefined) {
    return { satisfied: false, phase: 'verifying',
      causes: [{ code: 'not_current_plan', message: 'task not found in the current plan revision' }],
      satisfiedObligationIds: [] };
  }
  if (task.disposition !== 'active') {
    causes.push({ code: 'not_active',
      message: `disposition is ${task.disposition} — deferred/cancelled/superseded never satisfy` });
  }

  const { required, requiredObligations } = requiredRequirementsOf(plan, taskId);
  if (requiredObligations.size === 0) {
    causes.push({ code: 'no_required_obligation', message: 'no required obligation maps this task' });
  }

  const blocking: string[] = [];
  for (const [key, ids] of Object.entries(effectiveSet.blockingByRequirement)) {
    blocking.push(...ids);
    causes.push({ code: 'blocking_evidence',
      message: 'an applicable PASS is missing: blocking FAIL/INCONCLUSIVE evidence is visible',
      requirementKey: key, evidenceIds: ids });
  }

  let runUnresolved = false;
  for (const run of runs) {
    const blocker = runBlocker(run);
    if (blocker === null) continue;
    runUnresolved = true;
    causes.push({ code: 'unreconciled_side_effect', message: blocker, evidenceIds: [run.ref.runId] });
  }
  const leaseActive = lease.status === 'leased';
  if (leaseActive) {
    causes.push({ code: 'unreconciled_side_effect', message: 'the task still holds a valid lease',
      evidenceIds: [lease.holderRunId] });
  }

  const reviewerRequired = [...required.values()].some(entry => entry.kind === 'reviewer');
  const reviewerMissing = requiredReviewerMissing && reviewerRequired;
  if (reviewerMissing) {
    causes.push({ code: 'missing_evidence',
      message: 'a required independent review requirement has no formal producer yet' });
  }

  const hasGapEvidence = effectiveSet.staleEvidenceIds.length > 0 || effectiveSet.outOfScopeEvidenceIds.length > 0;
  const missingKeys: string[] = [];
  const staleKeys: string[] = [];
  for (const key of required.keys()) {
    if (effectiveSet.coverageByRequirement[key] !== undefined) continue;
    if ((effectiveSet.blockingByRequirement[key]?.length ?? 0) > 0) continue;
    if (hasGapEvidence) staleKeys.push(key);
    else missingKeys.push(key);
  }

  const hardNotSatisfied = task.disposition !== 'active' || runUnresolved || leaseActive || reviewerMissing;
  const allCovered = required.size > 0 && requiredObligations.size > 0
    && [...required.keys()].every(key => effectiveSet.coverageByRequirement[key] !== undefined);

  let phase: TaskReductionPhase;
  if (hardNotSatisfied) {
    phase = 'verifying';
  } else if (blocking.length > 0) {
    phase = 'failed';
  } else if (missingKeys.length > 0) {
    phase = 'blocked';
    causes.push({ code: 'missing_evidence',
      message: 'required verification requirements have no applicable evidence yet' });
  } else if (allCovered) {
    phase = 'satisfied';
  } else {
    phase = 'verifying';
    if (staleKeys.length > 0) {
      causes.push({ code: 'stale_or_out_of_scope',
        message: 'evidence exists but no applicable PASS covers every required requirement',
        evidenceIds: staleKeys });
    }
  }

  // Only obligations whose required requirements are all covered by an
  // applicable, unblocked PASS are listed (never every mapped required id).
  const satisfiedObligationIds: string[] = [];
  for (const obligation of plan.obligations) {
    if (obligation.requirementLevel !== 'required') continue;
    if (!obligation.taskIds.includes(taskId)) continue;
    const requiredRequirements = obligation.verificationRequirements
      .filter(requirement => requirement.requirementLevel === 'required');
    if (requiredRequirements.length === 0) continue;
    const allRequirementsCovered = requiredRequirements.every(requirement => {
      const key = requirementKeyOf({ obligationId: obligation.obligationId, requirementId: requirement.requirementId });
      return effectiveSet.coverageByRequirement[key] !== undefined
        && (effectiveSet.blockingByRequirement[key]?.length ?? 0) === 0;
    });
    if (allRequirementsCovered) satisfiedObligationIds.push(obligation.obligationId);
  }

  return { satisfied: phase === 'satisfied', phase, causes, satisfiedObligationIds };
}

/** Whether one Task's formal reduction is effective AND satisfied in the
 * canonical read. Applicability is already folded into `effectivePhase`. */
function satisfiedReduction(taskFacts: CanonicalTaskFacts, taskId: string): TaskReductionSnapshot | null {
  const state = taskFacts.byTaskId.get(taskId);
  const reduction = taskFacts.reductionsByTaskId.get(taskId);
  if (state === undefined || state.effectivePhase !== 'satisfied') return null;
  if (reduction === undefined || reduction.phase !== 'satisfied') return null;
  return reduction;
}

/** PURE Goal completion decision over the selected Plan and the canonical task
 * facts. It never counts a cached satisfied number: required active work, a
 * required active Goal gate and a non-empty required obligation set must all be
 * covered by formal reductions. Required plan_only/deferred stay unfinished;
 * an optional intent alone never blocks, but a REAL already-started side effect
 * on any adopted task — an active/unknown/quarantined/unresolved Run or a valid
 * Lease — must be reconciled and therefore blocks completion. */
export function evaluateGoalCompletion(input: {
  plan: PlanRevisionSnapshot;
  taskFacts: CanonicalTaskFacts;
}): GoalCompletionEvaluation {
  const { plan, taskFacts } = input;
  const reasons: string[] = [];
  const unfinishedTaskIds: string[] = [];
  const unsatisfiedObligationIds: string[] = [];

  const requiredWork = plan.tasks.filter(task => task.requirementLevel === 'required' && task.taskKind === 'work');
  const requiredGates = plan.tasks.filter(task => task.requirementLevel === 'required' && task.taskKind === 'gate');
  const requiredGoalGates = requiredGates.filter(task =>
    task.disposition === 'active' && task.scope.kind === 'goal');
  if (!requiredWork.some(task => task.disposition === 'active')) {
    reasons.push('the plan has no active required work task');
  }
  if (requiredGoalGates.length === 0) reasons.push('the plan has no active required Goal gate');
  const requiredObligations = plan.obligations.filter(obligation => obligation.requirementLevel === 'required');
  if (requiredObligations.length === 0) reasons.push('the plan has no required obligation');

  const satisfiedObligations = new Set<string>();
  for (const task of plan.tasks) {
    const reduction = satisfiedReduction(taskFacts, task.taskId);
    if (reduction === null) continue;
    for (const obligationId of reduction.satisfiedObligationIds) satisfiedObligations.add(obligationId);
  }

  for (const task of [...requiredWork, ...requiredGates]) {
    // A cancelled/superseded required task no longer carries work, but its
    // obligations are still checked below and never silently disappear.
    if (task.disposition === 'cancelled' || task.disposition === 'superseded') continue;
    const reduction = satisfiedReduction(taskFacts, task.taskId);
    if (task.disposition !== 'active' || reduction === null) {
      unfinishedTaskIds.push(task.taskId);
      reasons.push(`required task ${task.taskId} is not formally satisfied`);
    }
  }

  for (const obligation of requiredObligations) {
    const requiredRequirements = obligation.verificationRequirements
      .filter(requirement => requirement.requirementLevel === 'required');
    if (requiredRequirements.length === 0) {
      unsatisfiedObligationIds.push(obligation.obligationId);
      reasons.push(`required obligation ${obligation.obligationId} has no required verification requirement`);
      continue;
    }
    if (!satisfiedObligations.has(obligation.obligationId)) {
      unsatisfiedObligationIds.push(obligation.obligationId);
      reasons.push(`required obligation ${obligation.obligationId} is not formally satisfied`);
    }
  }

  // Consume the actual Runs and Task leases the canonical reader already
  // returned. A pending/plan_only optional node with no Run and no Lease is NOT
  // a gate; an already-started execution (active, unknown, quarantined or
  // unreconciled) or a still-valid Lease on ANY adopted task is a real side
  // effect that must be reconciled before the Goal can be COMPLETED.
  for (const [taskId, runs] of taskFacts.runsByTaskId) {
    for (const run of runs) {
      const blocker = runBlocker(run);
      if (blocker !== null) reasons.push(`task ${taskId}: ${blocker}`);
    }
  }
  for (const [taskId, state] of taskFacts.byTaskId) {
    if (state.lease.status === 'leased') {
      reasons.push(`task ${taskId} still holds a valid lease held by run ${state.lease.holderRunId}`);
    }
  }

  return { completed: reasons.length === 0, unfinishedTaskIds, unsatisfiedObligationIds, reasons };
}
