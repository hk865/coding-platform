/**
 * Pure task-state-basis helpers.
 *
 * This module owns ONLY pure resolution/generation/consistency logic shared by
 * the future-only adoption compiler and the Plan reader:
 *  - resolve a Task's EFFECTIVE basis (an accepted v2 Plan without the field is
 *    equivalent to every Task pointing at itself; refs are absolute, never a
 *    chain and never a cross-Goal fallback), in ONE per-Plan index;
 *  - build the compiler-owned target basis (complete, unique, stable-sorted,
 *    same project) from the trusted source plus the validated delta;
 *  - extract and compare the frozen execution definition of the same Task
 *    across Plans, reusing ONE extraction/comparison implementation for the
 *    validator and the reader (neither builds a second parser);
 *  - verify one Plan's declared basis for a Task (`verifyBasisDelegation`) and
 *    decide whether a Run/Reduction fact pinned to an origin Plan describes a
 *    Task of the selected Plan (`taskOriginVerdict`), over the per-Plan index
 *    `planTaskFacts` (STATE-MACHINES-SPEC §3.3 point 5 / §15.2 step 3).
 *    Both compare EXECUTION definitions
 *    (`executionDefinitionsAgree`, A.2 step 5.4b): a Task's disposition is not
 *    part of what its Runs and evidence describe;
 *  - decide whether a claim pinned to an older Plan may still enter while the
 *    Goal's active Plan carries its Task unchanged (`entryPlanVerdict`, C6).
 *
 * An obligation's frozen semantics keep its identity, title, requirementLevel
 * and compiled verificationRequirements; only the cross-Task carrier list
 * (`taskIds`) is excluded, so adding a replacement carrier for future B never
 * reads as a change to running A.
 *
 * It owns no state and no Port, reads no Store and accepts no caller-authored
 * basis. The helper never defaults a missing task/basis to a fabricated success
 * or an empty basis; an unprovable resolution is an explicit unsupported result.
 *
 * Specification: docs/refactor/tasks/W1-future-plan-skeleton.md §5.
 */
import type { EntryPlanVerdict } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import {
  revisionAssignments,
  type AcceptanceObligation,
  type PlanRevisionRef,
  type PlanRevisionSnapshot,
  type PlanTaskAssignment,
  type RuntimeTask,
  type TaskInputRequirementV2,
  type TaskStateBasisV1,
} from '../../../contracts/plan.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { planRevisionRefKey } from '../persistence/plan-record-codecs.js';

/** Explicit invalid/unprovable marker. A helper never invents a valid basis or
 * silently reports two definitions as equal. */
export type BasisUnsupported = { status: 'unsupported'; reason: string };

/** One Task-carried obligation's full semantics, with ONLY the mutual carrier
 * membership list removed. Identity/title/requirementLevel/verificationRequirements
 * are all preserved. */
export type FrozenObligation = Omit<AcceptanceObligation, 'taskIds'>;

/** The execution-definition slice of one Task that a future-only delta and the
 * basis consistency check compare. Display hierarchy and advisory
 * `taskRelations` are deliberately excluded. */
export type FrozenTaskDefinition = {
  task: RuntimeTask;
  assignment: PlanTaskAssignment | null;
  inputRequirements: readonly TaskInputRequirementV2[];
  carriedObligations: readonly FrozenObligation[];
};

function unsupported(reason: string): BasisUnsupported {
  return { status: 'unsupported', reason };
}

export function isBasisUnsupported(value: unknown): value is BasisUnsupported {
  return typeof value === 'object' && value !== null && (value as { status?: unknown }).status === 'unsupported';
}

function frozenObligation(obligation: AcceptanceObligation): FrozenObligation {
  const { taskIds: _carriers, ...semantics } = obligation;
  void _carriers;
  return semantics;
}

/** Deterministic canonical text of a frozen definition. The JSON round-trip
 * drops `undefined` optional fields so two structural equals compare equal
 * regardless of key insertion order; obligations/inputs are ordered by their
 * stable identity before canonicalization. */
function canonicalDefinition(definition: FrozenTaskDefinition): string {
  const shape = {
    task: definition.task,
    assignment: definition.assignment,
    inputRequirements: [...definition.inputRequirements]
      .sort((left, right) => (left.requirementId < right.requirementId ? -1 : left.requirementId > right.requirementId ? 1 : 0)),
    carriedObligations: [...definition.carriedObligations]
      .sort((left, right) => (left.obligationId < right.obligationId ? -1 : left.obligationId > right.obligationId ? 1 : 0)),
  };
  return canonicalJson(JSON.parse(JSON.stringify(shape)) as JsonValue);
}

/** ONE per-Plan taskId -> effective basis index. An accepted v2 Plan without the
 * field is equivalent to every Task pointing at itself; a Task missing its
 * entry is an explicit unsupported value, never a silent self fallback. */
export function buildEffectiveTaskBasis(
  plan: PlanRevisionSnapshot,
): ReadonlyMap<string, PlanRevisionRef | BasisUnsupported> {
  const index = new Map<string, PlanRevisionRef | BasisUnsupported>();
  if (plan.taskStateBasis !== undefined) {
    const entries = new Map(plan.taskStateBasis.entries.map((entry) => [entry.taskId, entry.planRef]));
    for (const task of plan.tasks) {
      const ref = entries.get(task.taskId);
      index.set(task.taskId, ref ?? unsupported(`accepted Plan ${plan.planId} carries a taskStateBasis without task ${task.taskId}`));
    }
    return index;
  }
  for (const task of plan.tasks) index.set(task.taskId, plan.ref);
  return index;
}

/** Compiler-owned target basis for a candidate adoption. The result must be
 * complete, unique, stable taskId order and limited to the target's project. */
export function buildTargetTaskBasis(input: {
  source: PlanRevisionSnapshot;
  targetRef: PlanRevisionRef;
  changedTaskIds: readonly string[];
  addedTaskIds: readonly string[];
}): TaskStateBasisV1 | BasisUnsupported {
  const changed = new Set(input.changedTaskIds);
  const inherited = buildEffectiveTaskBasis(input.source);
  const seen = new Set<string>();
  const entries: { taskId: string; planRef: PlanRevisionRef }[] = [];
  for (const task of input.source.tasks) {
    if (seen.has(task.taskId)) return unsupported(`source Plan repeats taskId ${task.taskId}`);
    seen.add(task.taskId);
    if (changed.has(task.taskId)) {
      entries.push({ taskId: task.taskId, planRef: input.targetRef });
      continue;
    }
    const basis = inherited.get(task.taskId);
    if (basis === undefined || isBasisUnsupported(basis)) {
      return unsupported(`task ${task.taskId} has no effective basis in the source Plan`);
    }
    if (basis.projectId !== input.targetRef.projectId) {
      return unsupported(`task ${task.taskId} basis is outside the target project`);
    }
    entries.push({ taskId: task.taskId, planRef: basis });
  }
  for (const taskId of input.addedTaskIds) {
    if (seen.has(taskId)) return unsupported(`added task ${taskId} collides with a source task`);
    seen.add(taskId);
    entries.push({ taskId, planRef: input.targetRef });
  }
  entries.sort((left, right) => (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0));
  return { schemaVersion: 1, entries };
}

/** The ONE shared one-pass extraction of a whole Plan's frozen definitions.
 * Each task/assignment/input/obligation list is grouped once so a caller that
 * inspects every task of a Plan never re-scans the whole Plan per task. */
export function buildFrozenTaskDefinitions(input: {
  tasks: readonly RuntimeTask[];
  assignments: readonly PlanTaskAssignment[];
  inputRequirements: readonly TaskInputRequirementV2[];
  obligations: readonly AcceptanceObligation[];
}): ReadonlyMap<string, FrozenTaskDefinition> {
  const assignmentByTask = new Map(input.assignments.map((assignment) => [assignment.taskId, assignment]));
  const inputsByTask = new Map<string, TaskInputRequirementV2[]>();
  for (const requirement of input.inputRequirements) {
    const list = inputsByTask.get(requirement.consumerTaskId);
    if (list === undefined) inputsByTask.set(requirement.consumerTaskId, [requirement]);
    else list.push(requirement);
  }
  const obligationsByTask = new Map<string, FrozenObligation[]>();
  for (const obligation of input.obligations) {
    const semantics = frozenObligation(obligation);
    for (const taskId of obligation.taskIds) {
      const list = obligationsByTask.get(taskId);
      if (list === undefined) obligationsByTask.set(taskId, [semantics]);
      else list.push(semantics);
    }
  }
  const definitions = new Map<string, FrozenTaskDefinition>();
  for (const task of input.tasks) {
    definitions.set(task.taskId, {
      task,
      assignment: assignmentByTask.get(task.taskId) ?? null,
      inputRequirements: inputsByTask.get(task.taskId) ?? [],
      carriedObligations: obligationsByTask.get(task.taskId) ?? [],
    });
  }
  return definitions;
}

/** Compares the frozen execution definition of the SAME Task across two Plans
 * that share one effective basis. A mismatch/corruption must surface as an
 * unavailable reader result, never as an equal/absent answer here. */
export function frozenTaskDefinitionsAgree(input: {
  left: FrozenTaskDefinition;
  right: FrozenTaskDefinition;
}): boolean | BasisUnsupported {
  try {
    return canonicalDefinition(input.left) === canonicalDefinition(input.right);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return unsupported(`the frozen task definition is not canonicalizable: ${detail}`);
  }
}

/** A frozen definition without the Task's `disposition` and `replacedByTaskId`. */
function executionDefinition(definition: FrozenTaskDefinition): FrozenTaskDefinition {
  const { disposition: _disposition, replacedByTaskId: _replacedBy, ...task } = definition.task;
  void _disposition; void _replacedBy;
  return { ...definition, task: task as RuntimeTask };
}

/**
 * Compares the EXECUTION definition of the same Task across two Plans
 * (STATE-MACHINES-SPEC §3.3): the frozen definition without `disposition` and
 * `replacedByTaskId`, so a disposition-only change is not a different Task.
 * The basis readers (`verifyBasisDelegation`, `taskOriginVerdict`) and the
 * evidence applicability use it; the future-only validator keeps the full
 * comparison (`frozenTaskDefinitionsAgree`), and so does the gate freeze.
 */
export function executionDefinitionsAgree(input: {
  left: FrozenTaskDefinition;
  right: FrozenTaskDefinition;
}): boolean | BasisUnsupported {
  return frozenTaskDefinitionsAgree({ left: executionDefinition(input.left), right: executionDefinition(input.right) });
}

/** The per-Plan frozen definition index plus the per-Plan effective-basis
 * index. The reader builds each ONCE and reuses it, never re-scanning a Plan per
 * Task or per Run. */
export type PlanTaskFacts = {
  plan: PlanRevisionSnapshot;
  definitions: ReadonlyMap<string, FrozenTaskDefinition>;
  basis: ReadonlyMap<string, PlanRevisionRef | BasisUnsupported>;
};

export function planTaskFacts(plan: PlanRevisionSnapshot): PlanTaskFacts {
  return {
    plan,
    definitions: buildFrozenTaskDefinitions({
      tasks: plan.tasks,
      assignments: revisionAssignments(plan),
      inputRequirements: plan.inputRequirements ?? [],
      obligations: plan.obligations,
    }),
    basis: buildEffectiveTaskBasis(plan),
  };
}

export type TaskOriginVerdict =
  | { status: 'accepted' }
  | { status: 'excluded' }
  | { status: 'unavailable'; reason: string };

export type BasisDelegationVerdict = { status: 'ok' } | { status: 'unavailable'; reason: string };

/**
 * Verifies ONE Plan's declared basis for one Task. The basis is either the Plan
 * itself (an absolute source) or a same-Goal Plan, no later than the referrer,
 * present, defining the Task, agreeing on its frozen definition, and itself an
 * absolute source. It never walks a second hop, so a chained/degenerate basis is
 * an explicit `unavailable`, not a silent success.
 */
export function verifyBasisDelegation(input: {
  referrer: PlanTaskFacts;
  taskId: string;
  index: ReadonlyMap<string, PlanTaskFacts>;
  goalRef: GoalRef;
}): BasisDelegationVerdict {
  const { referrer, taskId } = input;
  const basis = referrer.basis.get(taskId);
  if (basis === undefined) {
    return { status: 'unavailable', reason: `plan ${referrer.plan.planId} has no task ${taskId}` };
  }
  if (isBasisUnsupported(basis)) return { status: 'unavailable', reason: basis.reason };
  if (planRevisionRefKey(basis) === planRevisionRefKey(referrer.plan.ref)) return { status: 'ok' };
  const source = input.index.get(planRevisionRefKey(basis));
  if (source === undefined) {
    return { status: 'unavailable', reason: `basis source ${basis.planId} for task ${taskId} is missing` };
  }
  if (source.plan.ref.projectId !== input.goalRef.projectId
    || source.plan.goalRef.goalId !== input.goalRef.goalId) {
    return { status: 'unavailable', reason: `basis source ${basis.planId} for task ${taskId} belongs to another goal` };
  }
  if (source.plan.planRevision > referrer.plan.planRevision) {
    return { status: 'unavailable', reason: `basis source ${basis.planId} for task ${taskId} is later than its referrer` };
  }
  const sourceDefinition = source.definitions.get(taskId);
  const referrerDefinition = referrer.definitions.get(taskId);
  if (sourceDefinition === undefined || referrerDefinition === undefined) {
    return { status: 'unavailable', reason: `basis source ${basis.planId} does not define task ${taskId}` };
  }
  const agree = executionDefinitionsAgree({ left: sourceDefinition, right: referrerDefinition });
  if (isBasisUnsupported(agree)) return { status: 'unavailable', reason: agree.reason };
  if (!agree) {
    return { status: 'unavailable',
      reason: `basis source ${basis.planId} and referrer ${referrer.plan.planId} disagree on task ${taskId}` };
  }
  const sourceBasis = source.basis.get(taskId);
  if (sourceBasis === undefined || isBasisUnsupported(sourceBasis)) {
    return { status: 'unavailable', reason: `basis source ${basis.planId} has no effective basis for task ${taskId}` };
  }
  if (planRevisionRefKey(sourceBasis) !== planRevisionRefKey(source.plan.ref)) {
    return { status: 'unavailable', reason: `basis source ${basis.planId} is not an absolute source for task ${taskId}` };
  }
  return { status: 'ok' };
}

/**
 * Whether one Run/Reduction fact pinned to `origin` may describe `taskId` of
 * the selected Plan. Accepted only when the origin is the same Goal, the Task's
 * EFFECTIVE basis is identical, both the origin's and the selected Plan's
 * declared basis sources verify, the frozen execution definition agrees with
 * the selected Plan, and the origin is not a later revision. A basis match with
 * a differing definition is corruption and must be `unavailable`, never absent.
 */
export function taskOriginVerdict(input: {
  origin: PlanTaskFacts;
  selected: PlanTaskFacts;
  selectedBasis: PlanRevisionRef;
  selectedDefinition: FrozenTaskDefinition;
  taskId: string;
  index: ReadonlyMap<string, PlanTaskFacts>;
  goalRef: GoalRef;
}): TaskOriginVerdict {
  const { origin } = input;
  if (origin.plan.ref.projectId !== input.goalRef.projectId || origin.plan.goalRef.projectId !== input.goalRef.projectId) {
    return { status: 'unavailable', reason: `origin plan ${origin.plan.planId} is outside the requested project` };
  }
  if (origin.plan.goalRef.goalId !== input.goalRef.goalId
    || origin.plan.goalRef.goalId !== input.selected.plan.goalRef.goalId) {
    return { status: 'unavailable', reason: `origin plan ${origin.plan.planId} belongs to another goal` };
  }
  const originBasis = origin.basis.get(input.taskId);
  if (originBasis === undefined) {
    return { status: 'unavailable', reason: `origin plan ${origin.plan.planId} has no task ${input.taskId}` };
  }
  if (isBasisUnsupported(originBasis)) return { status: 'unavailable', reason: originBasis.reason };
  if (planRevisionRefKey(originBasis) !== planRevisionRefKey(input.selectedBasis)) return { status: 'excluded' };
  const originChain = verifyBasisDelegation({ referrer: origin, taskId: input.taskId,
    index: input.index, goalRef: input.goalRef });
  if (originChain.status === 'unavailable') return originChain;
  const originDefinition = origin.definitions.get(input.taskId);
  if (originDefinition === undefined) {
    return { status: 'unavailable', reason: `origin plan ${origin.plan.planId} does not define task ${input.taskId}` };
  }
  const agree = executionDefinitionsAgree({ left: originDefinition, right: input.selectedDefinition });
  if (isBasisUnsupported(agree)) return { status: 'unavailable', reason: agree.reason };
  if (!agree) {
    return { status: 'unavailable',
      reason: `origin plan ${origin.plan.planId} shares the basis for task ${input.taskId} but its execution definition differs` };
  }
  if (origin.plan.planRevision > input.selected.plan.planRevision) return { status: 'excluded' };
  return { status: 'accepted' };
}

/**
 * W3's relaxed Plan guard (C6; STATE-MACHINES-SPEC §3.3 point 5, §6.1 contract
 * (g)): may a claim pinned to `claimPlan` enter the Kernel while the Goal's
 * active Plan is `activePlan`?
 *
 * - `active_plan`: the two are the same Plan (today's path);
 * - `carried_unchanged`: both belong to the Goal, the claim Plan is older, the
 *   active Plan's basis for the Task verifies (`verifyBasisDelegation`), the
 *   claim Plan as origin is `accepted` for it (same effective basis, both
 *   chains verified, `executionDefinitionsAgree`), and the active Plan holds it
 *   as a `work` Task with `disposition: 'active'` (asked on its own, because
 *   the agreement does not look at the disposition);
 * - `changed`: the origin is `excluded`, or the Task is missing, not work or
 *   not active in the active Plan (also a claim Plan that is not older);
 * - `unavailable`: a basis chain, a definition or a basis source cannot be
 *   resolved.
 *
 * `basisSources` holds the Plans the two basis entries of the Task name (keyed
 * by `planRevisionRefKey`); a missing one is `unavailable`. Pure: the caller
 * reads every Plan (all immutable) and pins what it read.
 */
export function entryPlanVerdict(input: {
  claimPlan: PlanRevisionSnapshot;
  activePlan: PlanRevisionSnapshot;
  basisSources: ReadonlyMap<string, PlanRevisionSnapshot>;
  taskId: string;
  goalRef: GoalRef;
}): EntryPlanVerdict {
  const { claimPlan, activePlan, taskId, goalRef } = input;
  const claimKey = planRevisionRefKey(claimPlan.ref);
  const activeKey = planRevisionRefKey(activePlan.ref);
  if (claimKey === activeKey) return { kind: 'active_plan' };
  for (const plan of [claimPlan, activePlan]) {
    if (plan.ref.projectId !== goalRef.projectId || plan.goalRef.projectId !== goalRef.projectId
      || plan.goalRef.goalId !== goalRef.goalId) {
      return { kind: 'unavailable', reason: `plan ${plan.planId} does not belong to goal ${goalRef.goalId}` };
    }
  }
  if (claimPlan.planRevision >= activePlan.planRevision) {
    return { kind: 'changed',
      reason: `the claim Plan ${claimPlan.planId} is not older than the Goal active Plan ${activePlan.planId}` };
  }
  const activeTask = activePlan.tasks.find((task) => task.taskId === taskId);
  if (activeTask === undefined) {
    return { kind: 'changed', reason: `the Goal active Plan ${activePlan.planId} no longer has task ${taskId}` };
  }
  const selected = planTaskFacts(activePlan);
  const origin = planTaskFacts(claimPlan);
  const index = new Map<string, PlanTaskFacts>([[activeKey, selected], [claimKey, origin]]);
  for (const [key, plan] of input.basisSources) if (!index.has(key)) index.set(key, planTaskFacts(plan));
  const selectedBasis = selected.basis.get(taskId);
  const selectedDefinition = selected.definitions.get(taskId);
  if (selectedBasis === undefined || isBasisUnsupported(selectedBasis) || selectedDefinition === undefined) {
    return { kind: 'unavailable', reason: isBasisUnsupported(selectedBasis) ? selectedBasis.reason
      : `the Goal active Plan ${activePlan.planId} has no effective basis for task ${taskId}` };
  }
  const chain = verifyBasisDelegation({ referrer: selected, taskId, index, goalRef });
  if (chain.status === 'unavailable') return { kind: 'unavailable', reason: chain.reason };
  const verdict = taskOriginVerdict({ origin, selected, selectedBasis, selectedDefinition, taskId, index, goalRef });
  if (verdict.status === 'unavailable') return { kind: 'unavailable', reason: verdict.reason };
  if (verdict.status === 'excluded') {
    return { kind: 'changed',
      reason: `the Goal active Plan ${activePlan.planId} changed the basis or the execution definition of task ${taskId}` };
  }
  if (activeTask.taskKind !== 'work' || activeTask.disposition !== 'active') {
    return { kind: 'changed',
      reason: `task ${taskId} is not an active work Task in the Goal active Plan ${activePlan.planId}` };
  }
  return { kind: 'carried_unchanged', activePlanRef: activePlan.ref };
}
