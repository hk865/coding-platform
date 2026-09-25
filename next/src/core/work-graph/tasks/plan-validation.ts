/** Pure Plan admission rules extracted from plan-record-codecs, with one owner.
 * Codecs validate persisted shape; this file judges obligations/DAG/assignments
 * plus the v2 whiteboard-relation and exact-input membership rules. */
import type { CompletionPolicyContentV1 } from '../../../contracts/governance.js';
import type {
  AcceptanceObligation, PlanRevisionDraft, PlanRevisionSnapshot, PlanValidationError,
  PlanTaskAssignment, RuntimeTask, TaskInputRequirementV2,
} from '../../../contracts/plan.js';
import { planValidationError, revisionAssignments } from '../../../contracts/plan.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  buildFrozenTaskDefinitions, frozenTaskDefinitionsAgree, isBasisUnsupported,
  type FrozenObligation, type FrozenTaskDefinition,
} from './plan-task-basis.js';
import { buildTaskAdjacency, hasCycleInEdges, hasDirectedCycle } from './task-index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Domain admission of an initial plan (the closed PlanValidationCode vocabulary).
 * `policy` is the verified effective CompletionPolicy content, or null when no
 * policy is resolvable (kind/minimum checks are then deferred to apply).
 *
 * v2 structure is validated structurally by the record codec; here only
 * plan-membership is judged, so a malformed list is skipped (the codec rejects
 * it before persistence) instead of throwing.
 */
export function validatePlanDraft(draft: PlanRevisionDraft, policy: CompletionPolicyContentV1 | null): PlanValidationError[] {
  const issues: PlanValidationError[] = [];
  const tasks = draft.tasks ?? [];
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  const stageIds = new Set((draft.stages ?? []).map((stage) => stage.stageId));
  const requiredWork = tasks.filter((task) => task.requirementLevel === 'required'
    && task.taskKind === 'work' && task.disposition === 'active');
  if (requiredWork.length === 0) {
    issues.push(planValidationError('tasks', 'missing_required_executable_task',
      'at least one required executable task (required+work+active) is required'));
  }
  const requiredGoalGates = tasks.filter((task) => task.requirementLevel === 'required'
    && task.taskKind === 'gate' && task.disposition === 'active' && task.scope.kind === 'goal');
  if (requiredGoalGates.length === 0) {
    issues.push(planValidationError('tasks', 'missing_active_required_goal_gate',
      'at least one active required GoalGate task (required+gate+active+scope=goal) is required'));
  }
  const requiredObligations = (draft.obligations ?? []).filter((obligation) => obligation.requirementLevel === 'required');
  if (requiredObligations.length === 0) {
    issues.push(planValidationError('obligations', 'missing_required_obligation',
      'at least one required AcceptanceObligation is required'));
  }
  for (const task of [...requiredWork, ...requiredGoalGates]) {
    if (!requiredObligations.some((obligation) => obligation.taskIds.includes(task.taskId))) {
      issues.push(planValidationError(`tasks[${task.taskId}]`, 'task_obligation_mapping',
        `required task ${task.taskId} is not mapped by any required obligation`));
    }
  }
  for (const obligation of requiredObligations) {
    if (obligation.taskIds.length === 0) {
      issues.push(planValidationError(`obligations[${obligation.obligationId}]`, 'obligation_task_mapping',
        `required obligation ${obligation.obligationId} maps no tasks`));
      continue;
    }
    for (const taskId of obligation.taskIds) {
      const task = taskById.get(taskId);
      if (task === undefined || (task.taskKind !== 'work' && task.taskKind !== 'gate')) {
        issues.push(planValidationError(`obligations[${obligation.obligationId}].taskIds`, 'obligation_task_mapping',
          `required obligation ${obligation.obligationId} references a non-work/gate or unknown task ${taskId}`));
      }
    }
  }
  if (policy !== null) {
    const minimum = policy.minimumRequiredRequirementsPerObligation;
    for (const obligation of requiredObligations) {
      const requiredRequirements = obligation.verificationRequirements.filter((requirement) => requirement.requirementLevel === 'required');
      if (!Number.isSafeInteger(minimum) || minimum < 1 || requiredRequirements.length < minimum) {
        issues.push(planValidationError(`obligations[${obligation.obligationId}].verificationRequirements`,
          'empty_verification_requirements',
          `required obligation ${obligation.obligationId} compiles fewer than ${String(minimum)} required VerificationRequirement(s)`));
      }
      for (const requirement of requiredRequirements) {
        if (!policy.requirementKinds.includes(requirement.kind)) {
          issues.push(planValidationError(
            `obligations[${obligation.obligationId}].verificationRequirements[${requirement.requirementId}]`,
            'unknown_requirement_kind',
            `verification kind ${requirement.kind} is not in the effective policy requirementKinds`));
        }
      }
    }
  }
  for (const task of tasks) {
    if (task.stageId !== undefined && !stageIds.has(task.stageId)) {
      issues.push(planValidationError(`tasks[${task.taskId}].stageId`, 'dangling_stage_ref',
        `task ${task.taskId} references unknown stage ${task.stageId}`));
    }
  }
  draft.taskHierarchy.parentOf.forEach((edge, index) => {
    if (!taskById.has(edge.parentTaskId) || !taskById.has(edge.childTaskId)) {
      issues.push(planValidationError(`taskHierarchy.parentOf[${index}]`, 'dangling_task_ref',
        'hierarchy edge references a task that does not exist in the plan'));
    }
  });
  draft.executionDag.dependsOn.forEach((edge, index) => {
    if (!taskById.has(edge.taskId) || !taskById.has(edge.dependsOnId)) {
      issues.push(planValidationError(`executionDag.dependsOn[${index}]`, 'dangling_task_ref',
        'DAG edge references a task that does not exist in the plan'));
    }
  });
  draft.executionDag.dependsOn.forEach((edge, index) => {
    if (edge.taskId === edge.dependsOnId) {
      issues.push(planValidationError(`executionDag.dependsOn[${index}]`, 'self_dependency',
        `task ${edge.taskId} depends on itself`));
    }
  });
  if (hasDirectedCycle(buildTaskAdjacency(draft))) {
    issues.push(planValidationError('executionDag', 'dag_cycle', 'RuntimeExecutionDAG must be acyclic'));
  }
  if (hasCycleInEdges(draft.taskHierarchy.parentOf.map((edge) => ({ from: edge.parentTaskId, to: edge.childTaskId })))) {
    issues.push(planValidationError('taskHierarchy', 'hierarchy_cycle', 'TaskHierarchy must be acyclic'));
  }
  // v2 whiteboard relations are advisory and may cycle; only plan membership is
  // judged. Exact input requirements are pinned by ArtifactRef and consumed via
  // the real material reader; admission only checks id uniqueness and consumer
  // membership, never current availability.
  const v2 = draft as unknown as { taskRelations?: unknown; inputRequirements?: unknown };
  if (Array.isArray(v2.taskRelations)) {
    v2.taskRelations.forEach((relation, index) => {
      if (!isRecord(relation)) return;
      const from = relation['fromTaskId'];
      const to = relation['toTaskId'];
      if (typeof from !== 'string' || !taskById.has(from)) {
        issues.push(planValidationError(`taskRelations[${index}].fromTaskId`, 'dangling_task_ref',
          `relation references unknown task ${String(from)}`));
      }
      if (typeof to !== 'string' || !taskById.has(to)) {
        issues.push(planValidationError(`taskRelations[${index}].toTaskId`, 'dangling_task_ref',
          `relation references unknown task ${String(to)}`));
      }
    });
  }
  if (Array.isArray(v2.inputRequirements)) {
    const seen = new Set<string>();
    v2.inputRequirements.forEach((requirement, index) => {
      if (!isRecord(requirement)) return;
      const requirementId = requirement['requirementId'];
      if (typeof requirementId === 'string') {
        if (seen.has(requirementId)) {
          issues.push(planValidationError(`inputRequirements[${index}].requirementId`, 'duplicate_requirement_id',
            `input requirement id ${requirementId} is not unique in this plan`));
        }
        seen.add(requirementId);
      }
      const consumer = requirement['consumerTaskId'];
      if (typeof consumer !== 'string' || !taskById.has(consumer)) {
        issues.push(planValidationError(`inputRequirements[${index}].consumerTaskId`, 'dangling_task_ref',
          `input requirement references unknown consumer task ${String(consumer)}`));
      }
    });
  }
  return issues;
}

/**
 * Assignment coverage: each `work` task carries exactly one assignment (so a
 * new task is never added without a dispatch entry), and a `gate` task carries
 * none (gate conclusions come from evidence reduction, not implementation runs).
 */
export function validatePlanAssignments(draft: PlanRevisionDraft): string[] {
  const reasons: string[] = [];
  const assignments = draft.assignments ?? [];
  const counts = new Map<string, number>();
  for (const assignment of assignments) counts.set(assignment.taskId, (counts.get(assignment.taskId) ?? 0) + 1);
  const taskById = new Map(draft.tasks.map((task) => [task.taskId, task]));
  for (const task of draft.tasks) {
    const count = counts.get(task.taskId) ?? 0;
    if (task.taskKind === 'work') {
      if (count === 0) reasons.push(`work task ${task.taskId} has no assignment`);
      if (count > 1) reasons.push(`work task ${task.taskId} has ${String(count)} assignments`);
    } else if (count > 0) {
      reasons.push(`gate task ${task.taskId} must not carry an implementation assignment`);
    }
  }
  for (const assignment of assignments) {
    if (!taskById.has(assignment.taskId)) reasons.push(`assignment references unknown task ${assignment.taskId}`);
  }
  return reasons;
}

/**
 * A newly accepted plan cannot claim progress: a raw `satisfied` (or a run/
 * verification phase) task would otherwise bypass the missing completion
 * evidence. The formal reduction, not the stored draft phase, is the authority.
 */
export function planPhaseGuardReasons(tasks: readonly RuntimeTask[]): string[] {
  const reasons: string[] = [];
  for (const task of tasks) {
    if (task.phase === 'satisfied') {
      reasons.push(`task ${task.taskId} declares phase 'satisfied' before any completion evidence`);
    } else if (task.phase === 'running' || task.phase === 'verifying' || task.phase === 'failed') {
      reasons.push(`task ${task.taskId} declares phase '${task.phase}' before any run/evidence fact`);
    }
  }
  return reasons;
}

// --------------------------------------------------------------------------
// W1 future-only change checks
// --------------------------------------------------------------------------

/**
 * The execution-definition delta between an accepted source Plan and a
 * candidate draft. It is PURE: no Store read, no Run/Lease/Reduction query and
 * no model access. `taskRelations` and display-only `taskHierarchy.parentOf`
 * are deliberately OUTSIDE this set, so a prompt edge to a running Task does
 * not make that Task "changed".
 */
export type FuturePlanDelta = {
  changedTaskIds: string[];
  addedTaskIds: string[];
  cancelledTaskIds: string[];
};

export type FuturePlanDeltaResult =
  | { status: 'supported'; delta: FuturePlanDelta }
  | { status: 'unsupported'; reason: string };

function frozenObligationSemantics(obligation: AcceptanceObligation): FrozenObligation {
  const { taskIds: _carriers, ...semantics } = obligation;
  void _carriers;
  return semantics;
}

function canonicalObligation(obligation: AcceptanceObligation): string {
  return canonicalJson(JSON.parse(JSON.stringify(frozenObligationSemantics(obligation))) as JsonValue);
}

function sameOptionalJson(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  try {
    return canonicalJson(JSON.parse(JSON.stringify(left)) as JsonValue)
      === canonicalJson(JSON.parse(JSON.stringify(right)) as JsonValue);
  } catch {
    return false;
  }
}

function sourceInputs(plan: PlanRevisionSnapshot): readonly TaskInputRequirementV2[] {
  return plan.schemaVersion === 2 ? plan.inputRequirements ?? [] : [];
}
function draftInputs(plan: PlanRevisionDraft): readonly TaskInputRequirementV2[] {
  return plan.schemaVersion === 2 ? plan.inputRequirements ?? [] : [];
}
function definitionIndex(plan: PlanRevisionSnapshot): ReadonlyMap<string, FrozenTaskDefinition> {
  return buildFrozenTaskDefinitions({ tasks: plan.tasks, assignments: revisionAssignments(plan),
    inputRequirements: sourceInputs(plan), obligations: plan.obligations });
}
function draftDefinitionIndex(plan: PlanRevisionDraft): ReadonlyMap<string, FrozenTaskDefinition> {
  return buildFrozenTaskDefinitions({ tasks: plan.tasks, assignments: revisionAssignments(plan),
    inputRequirements: draftInputs(plan), obligations: plan.obligations });
}

/** Derives the future-only change set from source+draft. The delta is computed
 * from the execution definition only; display hierarchy and advisory relations
 * are intentionally excluded. A physically removed task is unsupported: W1 keeps
 * the taskId and records disposition instead. */
export function deriveFuturePlanDelta(
  source: PlanRevisionSnapshot,
  target: PlanRevisionDraft,
): FuturePlanDeltaResult {
  const sourceTaskIds = new Set(source.tasks.map((task) => task.taskId));
  const targetTaskIds = new Set<string>();
  for (const task of target.tasks) {
    if (targetTaskIds.has(task.taskId)) {
      return { status: 'unsupported', reason: `the candidate repeats taskId ${task.taskId}` };
    }
    targetTaskIds.add(task.taskId);
  }
  for (const task of source.tasks) {
    if (!targetTaskIds.has(task.taskId)) {
      return { status: 'unsupported', reason: `W1 cannot physically remove task ${task.taskId}; record a disposition instead` };
    }
  }
  const sourceDefinitions = definitionIndex(source);
  const targetDefinitions = draftDefinitionIndex(target);
  const addedTaskIds: string[] = [];
  const changedTaskIds: string[] = [];
  const cancelledTaskIds: string[] = [];
  for (const task of target.tasks) {
    if (!sourceTaskIds.has(task.taskId)) {
      addedTaskIds.push(task.taskId);
      continue;
    }
    const left = sourceDefinitions.get(task.taskId);
    const right = targetDefinitions.get(task.taskId);
    if (left === undefined || right === undefined) {
      return { status: 'unsupported', reason: `task ${task.taskId} execution definition cannot be extracted` };
    }
    const agree = frozenTaskDefinitionsAgree({ left, right });
    if (isBasisUnsupported(agree)) return { status: 'unsupported', reason: agree.reason };
    if (!agree) changedTaskIds.push(task.taskId);
    if (task.disposition !== 'active') cancelledTaskIds.push(task.taskId);
  }
  changedTaskIds.sort();
  addedTaskIds.sort();
  cancelledTaskIds.sort();
  return { status: 'supported', delta: { changedTaskIds, addedTaskIds, cancelledTaskIds } };
}

export type FutureObligationCoverageResult =
  | { status: 'supported' }
  | { status: 'rejected'; issues: PlanValidationError[] }
  | { status: 'unsupported'; reason: string };

/**
 * Source -> target semantic-preservation coverage. Runs AFTER the existing
 * `validatePlanDraft`/`validatePlanAssignments`: a merely non-empty target
 * obligation list is not proof that every original required obligation still
 * has a valid, required carrier. It also rejects acceptance-protocol/origin
 * changes, semantic weakening (title / requirementLevel /
 * verificationRequirements), gate changes, role changes and non-pending new
 * tasks that the source never authorized.
 */
export function validateFutureObligationCoverage(input: {
  source: PlanRevisionSnapshot;
  target: PlanRevisionDraft;
  delta: FuturePlanDelta;
}): FutureObligationCoverageResult {
  const { source, target, delta } = input;
  const issues: PlanValidationError[] = [];
  const targetTaskById = new Map(target.tasks.map((task) => [task.taskId, task]));
  const targetObligations = new Map(target.obligations.map((obligation) => [obligation.obligationId, obligation]));
  const sourceDefinitions = definitionIndex(source);
  const targetDefinitions = draftDefinitionIndex(target);
  const sourceAssignments = revisionAssignments(source);
  const targetAssignments = revisionAssignments(target);

  // The review-admission protocol is part of the original acceptance contract.
  // W1 cannot add, remove or switch it; the compiler preserves the source value.
  if (target.reviewAdmissionProtocol !== source.reviewAdmissionProtocol) {
    issues.push(planValidationError('reviewAdmissionProtocol', 'unsupported_execution_change',
      'a W1 revision cannot add, remove or switch the source review-admission protocol'));
  }
  // A candidate may not introduce or replace the source origin. Omitting it is
  // allowed only because the compiler writes the source origin back verbatim.
  if (target.origin !== undefined && !sameOptionalJson(target.origin, source.origin)) {
    issues.push(planValidationError('origin', 'unsupported_execution_change',
      'a W1 candidate cannot introduce or replace the source plan origin'));
  }

  for (const obligation of source.obligations) {
    const candidate = targetObligations.get(obligation.obligationId);
    if (candidate === undefined) {
      issues.push(planValidationError(`obligations[${obligation.obligationId}]`, 'obligation_semantics_changed',
        `source obligation ${obligation.obligationId} is missing from the candidate`));
      continue;
    }
    if (canonicalObligation(obligation) !== canonicalObligation(candidate)) {
      issues.push(planValidationError(`obligations[${obligation.obligationId}]`, 'obligation_semantics_changed',
        `source obligation ${obligation.obligationId} changed its title, strength or verification requirements`));
      continue;
    }
    if (obligation.requirementLevel === 'required') {
      const hasRequiredCarrier = candidate.taskIds.some((taskId) => {
        const task = targetTaskById.get(taskId);
        return task !== undefined && task.disposition === 'active'
          && task.requirementLevel === 'required' && (task.taskKind === 'work' || task.taskKind === 'gate');
      });
      if (!hasRequiredCarrier) {
        issues.push(planValidationError(`obligations[${obligation.obligationId}].taskIds`, 'obligation_task_mapping',
          `required obligation ${obligation.obligationId} no longer has a valid active required carrier`));
      }
    }
  }

  for (const task of source.tasks) {
    if (task.taskKind !== 'gate') continue;
    const candidate = targetTaskById.get(task.taskId);
    if (candidate === undefined) {
      issues.push(planValidationError(`tasks[${task.taskId}]`, 'task_removed',
        `source gate task ${task.taskId} cannot be removed by W1`));
      continue;
    }
    const left = sourceDefinitions.get(task.taskId);
    const right = targetDefinitions.get(task.taskId);
    if (left === undefined || right === undefined) {
      return { status: 'unsupported', reason: `gate ${task.taskId} execution definition cannot be extracted` };
    }
    const agree = frozenTaskDefinitionsAgree({ left, right });
    if (isBasisUnsupported(agree)) return { status: 'unsupported', reason: agree.reason };
    if (!agree) {
      issues.push(planValidationError(`tasks[${task.taskId}]`, 'gate_definition_changed',
        `source gate task ${task.taskId} changed its definition or acceptance relationships`));
    }
  }

  const addedTaskIds = new Set(delta.addedTaskIds);
  for (const taskId of delta.addedTaskIds) {
    const task = targetTaskById.get(taskId);
    if (task === undefined) continue;
    if (task.taskKind === 'gate') {
      issues.push(planValidationError(`tasks[${taskId}]`, 'gate_definition_changed',
        'W1 does not introduce new gate tasks'));
    }
    // A new Task is a definition only: it must start pending, never with a
    // caller-invented blocked/running execution state.
    if (task.phase !== 'pending') {
      issues.push(planValidationError(`tasks[${taskId}].phase`, 'unsupported_execution_change',
        `new task ${taskId} must start in phase pending, not ${task.phase}`));
    }
  }

  // Existing tasks keep their authorized role; a role already used elsewhere in
  // the source does not authorize reassigning a different existing task. Only a
  // newly added task may pick a role the source already authorized.
  const sourceAssignmentByTask = new Map(sourceAssignments.map((assignment) => [assignment.taskId, assignment]));
  const authorizedRoles = new Set(sourceAssignments.map((assignment) => assignment.role));
  for (const assignment of targetAssignments) {
    if (addedTaskIds.has(assignment.taskId)) {
      if (!authorizedRoles.has(assignment.role)) {
        issues.push(planValidationError(`assignments[${assignment.taskId}].role`, 'role_not_authorized',
          `role ${assignment.role} is not among the roles the source plan already authorized`));
      }
      continue;
    }
    const original = sourceAssignmentByTask.get(assignment.taskId);
    if (original === undefined) {
      issues.push(planValidationError(`assignments[${assignment.taskId}].role`, 'role_not_authorized',
        `assignment for task ${assignment.taskId} has no source assignment to preserve`));
    } else if (original.role !== assignment.role) {
      issues.push(planValidationError(`assignments[${assignment.taskId}].role`, 'role_not_authorized',
        `existing task ${assignment.taskId} cannot change its role from ${original.role} to ${assignment.role}`));
    }
  }

  return issues.length > 0 ? { status: 'rejected', issues } : { status: 'supported' };
}
