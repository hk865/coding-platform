/** Pure Plan admission rules with one owner.
 * Codecs validate persisted shape; this file judges obligations/DAG/assignments
 * plus the v2 whiteboard-relation and exact-input membership rules. */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { CompletionPolicyContentV1 } from '../../../contracts/governance.js';
import type {
  AcceptanceObligation, PlanRevisionDraft, PlanRevisionSnapshot, PlanValidationError,
  RuntimeTask, TaskInputRequirementV2, VerificationRequirement,
} from '../../../contracts/plan.js';
import { planValidationError, revisionAssignments } from '../../../contracts/plan.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { canonicalJson, sameJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { InitialPlanningResponsePlanV2 } from '../../../contracts/initial-planning.js';
import { isRecord } from '../../../contracts/validation/common.js';
import { fileModuleId, projectModuleIdOfFile } from '../../../contracts/workspace-module-id.js';
import type { CheckCapabilityV1 } from '../../../contracts/verification.js';
import { checksApplyingTo, planCoverageGaps } from '../state/plan-candidate.js';
import type { FutureCarrierRemovalV1, FutureDispositionChangeV1 } from '../state/plan-machine.js';
import {
  buildFrozenTaskDefinitions, executionDefinitionsAgree, frozenTaskDefinitionsAgree, isBasisUnsupported,
  type FrozenObligation, type FrozenTaskDefinition,
} from './plan-task-basis.js';
import { buildTaskAdjacency, hasCycleInEdges, hasDirectedCycle } from '../model/task-index.js';
import { mergeStageRefinement } from './stage-segment.js';
import type { PlanAdmissionFactsV1 } from '../model/secretary-contracts.js';
import {
  draftHasModuleTask, futureChangeTraceProblem, tracedDispositionChangeProblem, type TracedTaskFactsV1,
} from '../state/plan-machine.js';

/** One task member as these rules read it: a v2 answer's task carries no `phase` yet, and no reader here needs one. */
export type PlanTaskView = Pick<RuntimeTask,
  'taskId' | 'stageId' | 'requirementLevel' | 'taskKind' | 'disposition' | 'scope' | 'executionIntent' | 'sizeClass'>;

/** The plan members the admission rules read, so the answer's `InitialPlanningResponsePlanV2` passes directly. */
export type PlanDraftView = Pick<PlanRevisionDraft,
  'stages' | 'assignments' | 'obligations' | 'taskHierarchy' | 'executionDag' | 'taskRelations' | 'inputRequirements'>
  & { tasks: readonly PlanTaskView[] };

/**
 * Domain admission of an initial plan (the closed PlanValidationCode vocabulary).
 * `policy` is the verified effective CompletionPolicy content, or null when no
 * policy is resolvable (kind/minimum checks are then deferred to apply).
 *
 * v2 structure is validated structurally by the record codec; here only
 * plan-membership is judged, so a malformed list is skipped (the codec rejects
 * it before persistence) instead of throwing. `source` is the adopted Plan the
 * draft revises (null for a first plan): a witness mapping it carries unchanged
 * is not judged again.
 */
export function validatePlanDraft(draft: PlanDraftView, policy: CompletionPolicyContentV1 | null,
  source: Pick<PlanRevisionSnapshot, 'obligations' | 'tasks'> | null): PlanValidationError[] {
  const issues: PlanValidationError[] = [];
  const tasks = draft.tasks ?? [];
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  const stageIds = new Set((draft.stages ?? []).map((stage) => stage.stageId));
  // One new plan names each task once: a duplicate would silently overwrite
  // the earlier definition in every task-keyed read (propose and apply share this rule).
  const seenTaskIds = new Set<string>();
  for (const task of tasks) {
    if (seenTaskIds.has(task.taskId)) {
      issues.push(planValidationError(`tasks[${task.taskId}].taskId`, 'duplicate_task_id',
        `task id ${task.taskId} is not unique in this plan`));
    }
    seenTaskIds.add(task.taskId);
  }
  // The old "at least one required executable task" gate is count-orthogonal to
  // an explicit v2 intent: an optional/active or required/deferred `plan_only`
  // node is a real adopted intent even though it is not a required+active work.
  const explicitWorkPresent = tasks.some((task) => task.taskKind === 'work'
    && task.executionIntent !== undefined);
  const assignmentCounts = new Map<string, number>();
  for (const assignment of draft.assignments ?? []) {
    assignmentCounts.set(assignment.taskId, (assignmentCounts.get(assignment.taskId) ?? 0) + 1);
  }
  // An explicit request for execution is not yet admissible without its single
  // legal role/instruction assignment. The candidate may still be persisted
  // with this issue (diagnosis), while apply maps it to `incomplete`.
  for (const task of tasks) {
    if (task.taskKind !== 'work' || task.executionIntent !== 'request_execution') continue;
    if ((assignmentCounts.get(task.taskId) ?? 0) !== 1) {
      issues.push(planValidationError(`tasks[${task.taskId}]`, 'missing_task_assignment',
        `task ${task.taskId} requests execution without exactly one role/instruction assignment`));
    }
  }
  const requiredWork = tasks.filter((task) => task.requirementLevel === 'required'
    && task.taskKind === 'work' && task.disposition === 'active');
  if (requiredWork.length === 0 && !explicitWorkPresent) {
    issues.push(planValidationError('tasks', 'missing_required_executable_task',
      'at least one required executable task (required+work+active) is required'));
  }
  // Goal completion (`completion-policy.ts` evaluateGoalCompletion) needs one active required GoalGate, a required
  // obligation, and a formal reduction of every active required work and gate. So every required active work that
  // is meant to run (no intent, or `request_execution`) brings that template, or the adopted plan could never
  // complete: the goal gate exists, and that work and every required active gate (goal, stage or module) is listed
  // in a required obligation, since only a mapped gate can be formally satisfied. Only a `plan_only` future intent
  // may stand without acceptance (product 09-26), so a plan whose required work is all `plan_only` keeps no template.
  const executableRequiredWork = requiredWork.filter((task) => task.executionIntent !== 'plan_only');
  const requiredGates = tasks.filter((task) => task.requirementLevel === 'required'
    && task.taskKind === 'gate' && task.disposition === 'active');
  const requiredGoalGates = requiredGates.filter((task) => task.scope.kind === 'goal');
  const requiredObligations = (draft.obligations ?? []).filter((obligation) => obligation.requirementLevel === 'required');
  if (executableRequiredWork.length > 0) {
    if (requiredGoalGates.length === 0) {
      issues.push(planValidationError('tasks', 'missing_active_required_goal_gate',
        'at least one active required GoalGate task (required+gate+active+scope=goal) is required: add one required '
        + 'active gate task with scope {kind:"goal"} and list it in a required obligation\'s taskIds'));
    }
    if (requiredObligations.length === 0) {
      issues.push(planValidationError('obligations', 'missing_required_obligation',
        'at least one required AcceptanceObligation is required: add one with requirementLevel "required" whose '
        + 'taskIds list the required work and the goal gate'));
    }
    for (const task of [...executableRequiredWork, ...requiredGates]) {
      if (!requiredObligations.some((obligation) => obligation.taskIds.includes(task.taskId))) {
        issues.push(planValidationError(`tasks[${task.taskId}]`, 'task_obligation_mapping',
          `required task ${task.taskId} is not mapped by any required obligation: `
          + `list ${task.taskId} in a required obligation's taskIds`));
      }
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
  // A witness proves only that the Run read its files and changed none (`witness-check.ts`), so a work task that
  // edits files fails it on every round. It belongs only on an obligation whose work tasks are all exploration tasks
  // (sizeClass "explore", not plan_only); a gate the obligation lists runs no Run and is not judged. Adopted plans
  // are not judged again: a mapping the source carries unchanged (the same obligation and requirements already listing
  // the task, whose size class and intent did not change) passes; a new or changed mapping is judged.
  const sourceObligations = new Map((source?.obligations ?? []).map((obligation) => [obligation.obligationId, obligation]));
  const sourceTasks = new Map((source?.tasks ?? []).map((task) => [task.taskId, task]));
  for (const obligation of draft.obligations ?? []) {
    if (!obligation.verificationRequirements.some((requirement) => requirement.kind === 'witness')) continue;
    const carried = sourceObligations.get(obligation.obligationId);
    const sameRequirements = carried !== undefined
      && sameJson(carried.verificationRequirements, obligation.verificationRequirements);
    for (const taskId of obligation.taskIds) {
      const task = taskById.get(taskId);
      if (task === undefined || task.taskKind !== 'work') continue;
      if (task.sizeClass === 'explore' && task.executionIntent !== 'plan_only') continue;
      const before = sourceTasks.get(taskId);
      if (sameRequirements && carried.taskIds.includes(taskId) && before !== undefined
        && before.sizeClass === task.sizeClass && before.executionIntent === task.executionIntent) continue;
      issues.push(planValidationError(`obligations[${obligation.obligationId}].verificationRequirements`,
        'obligation_task_mapping',
        `obligation ${obligation.obligationId} carries a witness requirement, but its task ${taskId} is not an `
        + 'exploration task (sizeClass "explore" and not plan_only): a witness proves the Run only read files and '
        + `changed none, so it fails on every round of a task that edits files. Keep the witness only on the `
        + `obligation that maps exploration tasks alone, and give ${taskId}'s obligation a requirement of another kind`));
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
  if (hasDirectedCycle(buildTaskAdjacency({ tasks, executionDag: draft.executionDag }))) {
    issues.push(planValidationError('executionDag', 'dag_cycle', 'RuntimeExecutionDAG must be acyclic'));
  }
  if (hasCycleInEdges(draft.taskHierarchy.parentOf.map((edge) => ({ from: edge.parentTaskId, to: edge.childTaskId })))) {
    issues.push(planValidationError('taskHierarchy', 'hierarchy_cycle', 'TaskHierarchy must be acyclic'));
  }
  // v2 whiteboard relations are advisory and may cycle; only plan membership is
  // judged. Exact input requirements are pinned by ArtifactRef (nothing reads
  // them at execution yet, lead decision LA-11); admission only checks id
  // uniqueness and consumer membership, never current availability.
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
 * Every required verification requirement needs, on each active Task its obligation maps, a check of its kind that
 * applies to that Task's round, or that round could never pass it and the plan could never complete. The coverage is
 * the one the check round compiles (`planCoverageGaps` over `taskVerificationCoverage`): a reviewer requirement is
 * never uncovered, a witness one is the platform's. Kind legality is `validatePlanDraft`'s (`unknown_requirement_kind`):
 * every kind the draft names counts as known to the coverage, and a kind outside a known policy (`policyKinds`) is
 * left to that one problem, so one requirement gets one problem, naming every Task it is uncovered on. `checks` are
 * the capabilities of the check list the plan will run under (`checkCapabilitiesOf`); `null` (no installed
 * configuration) is unknown coverage and judges nothing. `checksAt` names that list: the answer's own `setup.checks`,
 * where the one who plans may add a check, or the workspace's `installed` checks, which only the person's check
 * approval changes, so that problem names the installed checks that do apply and says to use a kind they cover.
 */
export function uncoveredRequirementIssues(draft: Pick<PlanDraftView, 'obligations' | 'tasks'>, input: {
  checks: readonly CheckCapabilityV1[] | null; checksAt: 'setup.checks' | 'installed'; policyKinds: readonly string[] | null;
}): PlanValidationError[] {
  const { checks, checksAt, policyKinds } = input;
  if (checks === null) return [];
  const taskById = new Map(draft.tasks.map((task) => [task.taskId, task]));
  const kinds = draft.obligations.flatMap((obligation) => obligation.verificationRequirements.map((requirement) => requirement.kind));
  const byRequirement = new Map<string, { obligationId: string; requirementId: string; kind: string; taskIds: string[] }>();
  for (const gap of planCoverageGaps({ tasks: draft.tasks, obligations: draft.obligations, requirementKinds: kinds, checks })) {
    if (policyKinds !== null && !policyKinds.includes(gap.kind)) continue;
    const key = `${gap.obligationId}\u0000${gap.requirementId}`;
    const entry = byRequirement.get(key);
    if (entry === undefined) byRequirement.set(key, { ...gap, taskIds: [gap.taskId] });
    else entry.taskIds.push(gap.taskId);
  }
  return [...byRequirement.values()].map((entry) => {
    const tasks = entry.taskIds.join(', ');
    const path = `obligations[${entry.obligationId}].verificationRequirements[${entry.requirementId}]`;
    const needs = `requirement ${entry.requirementId} of obligation ${entry.obligationId} needs a check of kind `
      + `${entry.kind} that applies to task ${tasks}`;
    if (checksAt === 'setup.checks') {
      return planValidationError(path, 'uncovered_verification_requirement', `${needs}, but no check of that kind in `
        + 'setup.checks does: a check applies to every task when its taskIds is "all", else only to the tasks it lists '
        + `(a gate also takes a check listing a task it covers). Add a check of kind ${entry.kind} whose taskIds include `
        + `${tasks} (or "all") to setup.checks, or change the requirement`);
    }
    // The platform's own witness is not an installed check; only the registered commands are named.
    const named = entry.taskIds.map((taskId) => checksApplyingTo(draft.tasks, taskById.get(taskId)!, checks)
      .filter((check) => check.kind !== 'witness').map((check) => `${check.checkId} (${check.kind})`));
    const applying = entry.taskIds.map((taskId, index) =>
      `${taskId}: ${named[index]!.length === 0 ? 'none' : named[index]!.join(', ')}`);
    const none = named.every((list) => list.length === 0);
    return planValidationError(path, 'uncovered_verification_requirement', `${needs}, but no installed check of that `
      + `kind does. The installed checks that apply, by task: ${applying.join('; ')}. ` + (none
      ? 'No installed check applies to these tasks, and a new check needs the person\'s check approval, which cannot '
        + `be given in this round: answer with questions that ask the person to approve a check of kind ${entry.kind} `
        + `for ${tasks}`
      : 'In this round use a requirement kind those checks cover; a new check needs the person\'s check approval and '
        + 'cannot be added in this round'));
  });
}

/**
 * Assignment coverage: each `work` task carries exactly one assignment (so a
 * new task is never added without a dispatch entry), and a `gate` task carries
 * none (gate conclusions come from evidence reduction, not implementation runs).
 */
export function validatePlanAssignments(draft: Pick<PlanDraftView, 'tasks' | 'assignments'>): string[] {
  const reasons: string[] = [];
  const assignments = draft.assignments ?? [];
  const tasks = draft.tasks;
  const counts = new Map<string, number>();
  for (const assignment of assignments) counts.set(assignment.taskId, (counts.get(assignment.taskId) ?? 0) + 1);
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  for (const task of tasks) {
    const count = counts.get(task.taskId) ?? 0;
    if (task.taskKind === 'work') {
      // An explicit plan_only node records intent only and may legitimately
      // have no assignment. Every other work node keeps the single-assignment
      // rule: a legacy unmarked node, or an explicit request_execution node
      // whose missing assignment is diagnosed as `missing_task_assignment`.
      if (task.executionIntent !== 'plan_only' && count === 0) {
        reasons.push(`work task ${task.taskId} has no assignment`);
      }
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
// future-only change checks
// --------------------------------------------------------------------------

/**
 * The execution-definition delta between an accepted source Plan and a
 * candidate draft. It is PURE: no Store read, no Run/Lease/Reduction query and
 * no model access. `taskRelations` and display-only `taskHierarchy.parentOf`
 * are deliberately OUTSIDE this set, so a prompt edge to a running Task does
 * not make that Task "changed".
 *
 * C7 (STATE-MACHINES-SPEC §3.3 point 6, A.2 step 5.10) splits the existing
 * Tasks in three: a different EXECUTION definition (`executionDefinitionsAgree`:
 * the frozen definition without `disposition`/`replacedByTaskId`, the carried
 * obligations included) is `changed`; the same execution definition with a
 * different `disposition` or `replacedByTaskId` (an absent replacement and
 * `null` are the same) is `dispositionOnly`, written from its source
 * definition with its basis inherited; otherwise the Task is unchanged.
 */
export type FuturePlanDelta = {
  changedTaskIds: string[];
  addedTaskIds: string[];
  cancelledTaskIds: string[];
  dispositionOnlyTaskIds: string[];
  /**
   * Every existing Task whose `disposition` or `replacedByTaskId` changes
   * (changed or disposition-only), in taskId order: one `disposition_changed` each.
   */
  dispositionChanges: FutureDispositionChangeV1[];
  /** Changed Tasks that left source obligations' `taskIds` (the untraced rule's hint for a traced one). */
  carrierRemovals: FutureCarrierRemovalV1[];
};

/** C7: an existing Task's `disposition` or `replacedByTaskId` changes (an absent replacement is `null`). */
function dispositionMoved(original: RuntimeTask, task: RuntimeTask): boolean {
  return original.disposition !== task.disposition || (original.replacedByTaskId ?? null) !== (task.replacedByTaskId ?? null);
}

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

/**
 * A person's adoption may change an obligation's semantics only when every
 * changed verification requirement carries a NEW `requirementId`. Reusing an
 * old id for different content is refused: old evidence would then read as
 * covering the new requirement. Requirements that are unchanged keep their id.
 */
function changedRequirementKeepsOldId(source: AcceptanceObligation, target: AcceptanceObligation): boolean {
  const canonicalRequirement = (requirement: VerificationRequirement): string =>
    canonicalJson(JSON.parse(JSON.stringify(requirement)) as JsonValue);
  const next = new Map(target.verificationRequirements
    .map((requirement) => [requirement.requirementId, canonicalRequirement(requirement)]));
  return source.verificationRequirements.some((requirement) => {
    const sameId = next.get(requirement.requirementId);
    return sameId !== undefined && sameId !== canonicalRequirement(requirement);
  });
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
  return plan.inputRequirements ?? [];
}
function draftInputs(plan: PlanRevisionDraft): readonly TaskInputRequirementV2[] {
  return plan.inputRequirements ?? [];
}
function definitionIndex(plan: PlanRevisionSnapshot): ReadonlyMap<string, FrozenTaskDefinition> {
  return buildFrozenTaskDefinitions({ tasks: plan.tasks, assignments: revisionAssignments(plan),
    inputRequirements: sourceInputs(plan), obligations: plan.obligations });
}
function draftDefinitionIndex(plan: PlanRevisionDraft): ReadonlyMap<string, FrozenTaskDefinition> {
  return buildFrozenTaskDefinitions({ tasks: plan.tasks, assignments: revisionAssignments(plan),
    inputRequirements: draftInputs(plan), obligations: plan.obligations });
}

/** The refusal of a candidate that drops a task of its source plan, or null. */
export function removedTaskProblem(source: PlanRevisionSnapshot, targetTaskIds: ReadonlySet<string>): string | null {
  const removed = source.tasks.find((task) => !targetTaskIds.has(task.taskId));
  return removed === undefined ? null
    : `W1 cannot physically remove task ${removed.taskId}; record a disposition instead`;
}

/** Derives the future-only change set from source+draft. The delta is computed
 * from the execution definition only; display hierarchy and advisory relations
 * are intentionally excluded. A physically removed task is unsupported: the
 * revision keeps the taskId and records disposition instead. */
export function deriveFuturePlanDelta(
  source: PlanRevisionSnapshot,
  target: PlanRevisionDraft,
): FuturePlanDeltaResult {
  const targetTaskIds = new Set<string>();
  for (const task of target.tasks) {
    if (targetTaskIds.has(task.taskId)) {
      return { status: 'unsupported', reason: `the candidate repeats taskId ${task.taskId}` };
    }
    targetTaskIds.add(task.taskId);
  }
  const removed = removedTaskProblem(source, targetTaskIds);
  if (removed !== null) return { status: 'unsupported', reason: removed };
  const sourceDefinitions = definitionIndex(source);
  const targetDefinitions = draftDefinitionIndex(target);
  const sourceTaskById = new Map(source.tasks.map((task) => [task.taskId, task]));
  const addedTaskIds: string[] = [];
  const changedTaskIds: string[] = [];
  const cancelledTaskIds: string[] = [];
  const dispositionOnlyTaskIds: string[] = [];
  const dispositionChanges: FutureDispositionChangeV1[] = [];
  const carrierRemovals: FutureCarrierRemovalV1[] = [];
  for (const task of target.tasks) {
    const original = sourceTaskById.get(task.taskId);
    if (original === undefined) {
      addedTaskIds.push(task.taskId);
      continue;
    }
    const left = sourceDefinitions.get(task.taskId);
    const right = targetDefinitions.get(task.taskId);
    if (left === undefined || right === undefined) {
      return { status: 'unsupported', reason: `task ${task.taskId} execution definition cannot be extracted` };
    }
    const sameExecution = executionDefinitionsAgree({ left, right });
    if (isBasisUnsupported(sameExecution)) return { status: 'unsupported', reason: sameExecution.reason };
    const moved = dispositionMoved(original, task);
    if (!sameExecution) {
      changedTaskIds.push(task.taskId);
      const removal = carrierRemovalOf(source, target, task.taskId);
      if (removal !== null) carrierRemovals.push(removal);
    } else if (moved) {
      // The execution definitions agree, so only `disposition`/`replacedByTaskId` can differ.
      dispositionOnlyTaskIds.push(task.taskId);
    }
    if (moved) {
      dispositionChanges.push({ taskId: task.taskId, from: original.disposition, to: task.disposition,
        replacedByTaskId: task.replacedByTaskId ?? null });
    }
    if (task.disposition !== 'active') cancelledTaskIds.push(task.taskId);
  }
  const byTaskId = (left: { taskId: string }, right: { taskId: string }): number =>
    (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0);
  changedTaskIds.sort();
  addedTaskIds.sort();
  cancelledTaskIds.sort();
  dispositionOnlyTaskIds.sort();
  dispositionChanges.sort(byTaskId);
  carrierRemovals.sort(byTaskId);
  return { status: 'supported', delta: { changedTaskIds, addedTaskIds, cancelledTaskIds, dispositionOnlyTaskIds,
    dispositionChanges, carrierRemovals } };
}

/**
 * L10 (`book-8c.md:809`): the source Tasks a target carries forward as UNCHANGED
 * terminal history — the only Tasks the module fact leaves out. `terminalTaskIds`
 * is the canonical closure of the SOURCE Plan's Tasks (the same non-open set the
 * delete rule's `module_in_use` reads), so a satisfied Task with an `active`
 * disposition is terminal history too. A terminal source Task that is neither
 * changed nor disposition-only in this delta keeps both its execution definition
 * and its terminal closure; every other Task (new, changed, re-enabled, or turned
 * terminal now) is not exempt. A delta the existing rules cannot derive
 * (a repeated or removed Task) exempts nothing: the full draft stays checked.
 */
export function unchangedTerminalTaskIds(source: PlanRevisionSnapshot, target: PlanRevisionDraft,
  terminalTaskIds: ReadonlySet<string>): ReadonlySet<string> {
  const delta = deriveFuturePlanDelta(source, target);
  if (delta.status !== 'supported') return new Set();
  const moved = new Set([...delta.delta.changedTaskIds, ...delta.delta.dispositionOnlyTaskIds]);
  return new Set(source.tasks
    .filter((task) => terminalTaskIds.has(task.taskId) && !moved.has(task.taskId))
    .map((task) => task.taskId));
}

/**
 * C7 (§3.3 无痕规则): the source obligations a changed Task left (no longer
 * listed in their `taskIds`). Leaving an obligation changes the execution
 * definition, so the untraced rule's refusal of a traced Task that did so says
 * how to keep it: leave it listed and add the replacement as another carrier.
 * `null` when the Task left no obligation.
 */
function carrierRemovalOf(source: PlanRevisionSnapshot, target: PlanRevisionDraft, taskId: string): FutureCarrierRemovalV1 | null {
  const kept = new Set(target.obligations.filter((obligation) => obligation.taskIds.includes(taskId))
    .map((obligation) => obligation.obligationId));
  const obligationIds = source.obligations
    .filter((obligation) => obligation.taskIds.includes(taskId) && !kept.has(obligation.obligationId))
    .map((obligation) => obligation.obligationId).sort();
  return obligationIds.length === 0 ? null : { taskId, obligationIds };
}

/**
 * C7 (§3.3 任务定义守卫表, `replacedByTaskId` 合法): checked only for an
 * existing Task whose `disposition` or `replacedByTaskId` changes. A
 * `superseded` Task names no replacement (null) or another Task of the target
 * with the same `taskKind`; any other disposition names none. Reported as
 * `unsupported_execution_change` (no new PlanValidationCode).
 */
function replacementIssues(source: PlanRevisionSnapshot, target: PlanRevisionDraft): PlanValidationError[] {
  const issues: PlanValidationError[] = [];
  const sourceTaskById = new Map(source.tasks.map((task) => [task.taskId, task]));
  const targetTaskById = new Map(target.tasks.map((task) => [task.taskId, task]));
  for (const task of target.tasks) {
    const original = sourceTaskById.get(task.taskId);
    if (original === undefined) continue;
    const replacedBy = task.replacedByTaskId ?? null;
    if (!dispositionMoved(original, task) || replacedBy === null) continue;
    const path = `tasks[${task.taskId}].replacedByTaskId`;
    if (task.disposition !== 'superseded') {
      issues.push(planValidationError(path, 'unsupported_execution_change',
        `task ${task.taskId} is ${task.disposition}; only a superseded task names a replacement`));
      continue;
    }
    const replacement = targetTaskById.get(replacedBy);
    if (replacedBy === task.taskId || replacement === undefined || replacement.taskKind !== task.taskKind) {
      issues.push(planValidationError(path, 'unsupported_execution_change',
        `superseded task ${task.taskId} must name another ${task.taskKind} task of the target plan, not ${replacedBy}`));
    }
  }
  return issues;
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
  /** A person's explicit adoption may change acceptance semantics under `changedRequirementKeepsOldId`. */
  personAdopts: boolean;
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
      if (!input.personAdopts || changedRequirementKeepsOldId(obligation, candidate)) {
        issues.push(planValidationError(`obligations[${obligation.obligationId}]`, 'obligation_semantics_changed',
          `source obligation ${obligation.obligationId} changed its title, strength or verification requirements: an `
          + 'adopted obligation keeps them (a person adopting may change a requirement only under a new requirementId). '
          + `Leave ${obligation.obligationId} as adopted and put the changed acceptance in a new obligation with a new `
          + 'obligationId and new requirementIds, carried by the new or replacement work task'));
        continue;
      }
    }
    if (candidate.requirementLevel === 'required') {
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
        `source gate task ${task.taskId} changed its definition or acceptance relationships: an adopted gate keeps `
        + 'its definition and exactly the obligations that list it, with their content. Leave the gate and those '
        + 'obligations as adopted; a new obligation lists the new work tasks and, when it needs a gate, a new gate task'));
    }
  }

  // A source task that declared an explicit executionIntent must keep an
  // explicit value: omission would silently reinterpret plan_only as a legacy
  // complete definition, or request_execution as intent-less. Adding an intent
  // to an old intent-less Task stays an ordinary future definition change.
  for (const task of source.tasks) {
    if (task.executionIntent === undefined) continue;
    const candidate = targetTaskById.get(task.taskId);
    if (candidate === undefined) continue;
    if (candidate.executionIntent === undefined) {
      issues.push(planValidationError(`tasks[${task.taskId}].executionIntent`, 'unsupported_execution_change',
        `source task ${task.taskId} declared executionIntent ${task.executionIntent}; the candidate cannot omit it`));
    }
  }

  // C7: a superseded Task names its replacement correctly; no other disposition names one.
  issues.push(...replacementIssues(source, target));

  const sourceObligationIds = new Set(source.obligations.map((obligation) => obligation.obligationId));
  const addedObligationIds = new Set(target.obligations
    .filter((obligation) => !sourceObligationIds.has(obligation.obligationId))
    .map((obligation) => obligation.obligationId));
  for (const taskId of delta.addedTaskIds) {
    const task = targetTaskById.get(taskId);
    if (task === undefined) continue;
    if (task.taskKind === 'gate') {
      // A newly added gate is allowed only as the carrier of a newly added
      // acceptance obligation; it is never an implementation node.
      if (task.executionIntent !== undefined) {
        issues.push(planValidationError(`tasks[${taskId}].executionIntent`, 'unsupported_execution_change',
          `new gate ${taskId} cannot declare an execution intent`));
      }
      const carriesNewObligation = [...addedObligationIds]
        .some((obligationId) => targetObligations.get(obligationId)?.taskIds.includes(taskId) === true);
      if (!carriesNewObligation) {
        issues.push(planValidationError(`tasks[${taskId}]`, 'gate_definition_changed',
          `new gate ${taskId} must carry at least one newly added acceptance obligation`));
      }
    }
    // A new Task is a definition only: it must start pending, never with a
    // caller-invented blocked/running execution state.
    if (task.phase !== 'pending') {
      issues.push(planValidationError(`tasks[${taskId}].phase`, 'unsupported_execution_change',
        `new task ${taskId} must start in phase pending, not ${task.phase}`));
    }
  }

  // Existing tasks with an assignment keep their authorized role. An existing
  // task whose source assignment was null may receive its FIRST assignment, and
  // an explicitly intended added node may declare a role the source never
  // authorized. An unmarked added node keeps the source-role rule.
  const sourceAssignmentByTask = new Map(sourceAssignments.map((assignment) => [assignment.taskId, assignment]));
  const authorizedRoles = new Set(sourceAssignments.map((assignment) => assignment.role));
  for (const assignment of targetAssignments) {
    const original = sourceAssignmentByTask.get(assignment.taskId);
    if (original !== undefined) {
      if (original.role !== assignment.role) {
        issues.push(planValidationError(`assignments[${assignment.taskId}].role`, 'role_not_authorized',
          `existing task ${assignment.taskId} cannot change its role from ${original.role} to ${assignment.role}`));
      }
      continue;
    }
    const task = targetTaskById.get(assignment.taskId);
    if (task !== undefined && task.executionIntent !== undefined) continue;
    if (!authorizedRoles.has(assignment.role)) {
      issues.push(planValidationError(`assignments[${assignment.taskId}].role`, 'role_not_authorized',
        `role ${assignment.role} is not among the roles the source plan already authorized`));
    }
  }
  // A role the source already committed cannot be deleted to make the Task
  // intent-less again; the removed assignment would silently weaken the plan.
  const targetAssignmentTaskIds = new Set(targetAssignments.map((assignment) => assignment.taskId));
  for (const assignment of sourceAssignments) {
    if (targetAssignmentTaskIds.has(assignment.taskId)) continue;
    issues.push(planValidationError(`assignments[${assignment.taskId}]`, 'role_not_authorized',
      `source assignment for task ${assignment.taskId} cannot be removed by a W1 revision`));
  }

  return issues.length > 0 ? { status: 'rejected', issues } : { status: 'supported' };
}

/**
 * The obligations a future change answers for: only a change that adds a new obligationId reads the source plan's
 * pinned policy and is judged, over the obligations it adds or whose level or requirements it alters (an optional
 * obligation made required is judged now). An obligation carried unchanged was judged when it was adopted; a later
 * change of the installed checks is not this change's to answer.
 */
export function changedObligationsOf(source: Pick<PlanRevisionSnapshot, 'obligations'>,
  target: Pick<PlanRevisionDraft, 'obligations'>): { hasNewObligation: boolean; changed: AcceptanceObligation[] } {
  const sourceObligationIds = new Set(source.obligations.map((obligation) => obligation.obligationId));
  const hasNewObligation = target.obligations.some((obligation) => !sourceObligationIds.has(obligation.obligationId));
  const changed = hasNewObligation ? target.obligations.filter((obligation) => {
    const carried = source.obligations.find((entry) => entry.obligationId === obligation.obligationId);
    return carried === undefined || carried.requirementLevel !== obligation.requirementLevel
      || !sameJson(carried.verificationRequirements, obligation.verificationRequirements);
  }) : [];
  return { hasNewObligation, changed };
}

/**
 * L10 (`book-8c.md:809`): the Tasks a draft's module fact judges and the unknown ones among them: every Task but the
 * ones `source` carries forward as unchanged terminal history (`unchangedTerminalTaskIds` over the source's canonical
 * closure, `terminalTaskIds`). A first draft has no source and is judged whole. The adoption's module fact
 * (`plan-service.ts` `moduleFactOf`) and a plan answer's submit check share it.
 */
export function moduleCheckOf(draft: PlanRevisionDraft, catalog: AdoptedArchitecture, source: PlanRevisionSnapshot | null,
  terminalTaskIds: ReadonlySet<string>): { tasks: PlanRevisionDraft['tasks']; unknown: UnknownModuleTaskV1[] } {
  const exempt = source === null ? new Set<string>() : unchangedTerminalTaskIds(source, draft, terminalTaskIds);
  const tasks = exempt.size === 0 || !Array.isArray(draft.tasks) ? draft.tasks
    : draft.tasks.filter((task) => !exempt.has(task.taskId));
  return { tasks, unknown: unknownModuleTasksOf({ tasks }, catalog) };
}

/** A module scope's id written in the round's workspace, put in the project view as the formal proposal puts it. */
function qualifiedOrProblem(draft: PlanRevisionDraft, workspaceId: string, mainWorkspaceId: string):
PlanRevisionDraft | string {
  try {
    return qualifyPlanDraft(draft, workspaceId, mainWorkspaceId);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function unknownModuleReasons(unknown: readonly UnknownModuleTaskV1[], catalog: AdoptedArchitecture): string[] {
  const validModules = catalog.modules.map((module) => module.ref.moduleId).join(', ') || '(none)';
  return unknown.map((entry) => `task ${entry.taskId} names module ${entry.moduleId}, `
    + `which is not a module of the catalog (modules: ${validModules})`);
}

/**
 * An initial plan answer's module scopes against the catalog its propose reads: the draft in the project view
 * (`qualifyPlanDraft`), then the module fact a first draft gets (`moduleCheckOf`, no source).
 */
export function planModuleIssues(input: { plan: InitialPlanningResponsePlanV2; catalog: AdoptedArchitecture;
  workspaceId: string; mainWorkspaceId: string }): string[] {
  const qualified = qualifiedOrProblem({ ...input.plan, planId: '', planRevision: 1, goalId: '' },
    input.workspaceId, input.mainWorkspaceId);
  if (typeof qualified === 'string') return [qualified];
  return unknownModuleReasons(moduleCheckOf(qualified, input.catalog, null, new Set()).unknown, input.catalog);
}

/** A trace-free Task: one a candidate adds is new to the Goal (Plans never drop a Task), so nothing ran it. */
function untracedFacts(taskId: string): TracedTaskFactsV1 {
  return { taskId, runs: [], lease: null, reduction: null, selectedRun: null, pointerIntent: null };
}

/**
 * 97-3: the plan rules a planning round's plan answer is held to when it is submitted, so the secretary fixes it in
 * the same round instead of meeting them at adoption. They are the adoption's own judgements on the facts the
 * adoption reads (`PlanAdmissionFactsV1`): the answer's segment merged onto its base put back in the round's frame
 * (`planInCallerView`, `mergeStageRefinement`) and the merged plan qualified once (`qualifyPlanDraft`), as the formal
 * candidate is merged and proposed; for a first plan the initial adoption's draft checks
 * under the active policy; for a later one the future adoption's (`deriveFuturePlanDelta`,
 * `validateFutureObligationCoverage`, the draft checks over `changedObligationsOf` under the base's pinned policy when
 * an obligation is added, the untraced rule `futureChangeTraceProblem` and the traced disposition guards
 * `tracedDispositionChangeProblem` over the base Tasks' execution facts); and the module fact (`moduleCheckOf`, with
 * its unchanged-terminal exemption) against the current catalog the propose reads and, for a first plan, against the
 * catalog governance selected, which the first adoption reads. Acceptance is judged as a person adopts (the request's
 * candidate is the person's), so the guard a system adopter alone meets (guard 9) is the adoption's. The adoption
 * judges everything again.
 */
export function planRoundAnswerIssues(input: {
  plan: InitialPlanningResponsePlanV2;
  admission: PlanAdmissionFactsV1;
  /** The project's active policy content: what a first plan is judged under. */
  activePolicy: CompletionPolicyContentV1 | null;
  checks: readonly CheckCapabilityV1[] | null;
  /** The round's workspace: the frame the answer's module ids are written in. */
  workspaceId: string;
  /** The answer's `reason.affectedTaskIds`, which the traced disposition guards read. */
  affectedTaskIds: readonly string[] | undefined;
}): string[] {
  const { plan, admission, checks } = input;
  const base = admission.base;
  const reasons: string[] = [];
  const rendered = (issue: PlanValidationError): string => `${issue.path}: ${issue.message}`;
  const segment: PlanRevisionDraft = { ...plan, planId: base?.plan.planId ?? '',
    planRevision: (base?.plan.planRevision ?? 0) + 1, goalId: base?.plan.goalRef.goalId ?? '' };
  let written = segment;
  if (base !== null) {
    const merged = mergeStageRefinement(planInCallerView(base.plan, input.workspaceId, admission.mainWorkspaceId), segment);
    if (merged.status !== 'merged') return [merged.reason];
    written = merged.draft;
  }
  const draft = qualifiedOrProblem(written, input.workspaceId, admission.mainWorkspaceId);
  if (typeof draft === 'string') return [draft];
  let judged = draft.obligations;
  let policy = input.activePolicy;
  if (base !== null) {
    const delta = deriveFuturePlanDelta(base.plan, draft);
    if (delta.status !== 'supported') return [delta.reason];
    const coverage = validateFutureObligationCoverage({ source: base.plan, target: draft, delta: delta.delta,
      personAdopts: true });
    if (coverage.status === 'unsupported') return [coverage.reason];
    if (coverage.status === 'rejected') reasons.push(...coverage.issues.map(rendered));
    const changed = changedObligationsOf(base.plan, draft);
    judged = changed.changed;
    policy = null;
    if (changed.hasNewObligation) {
      if (base.pinnedPolicy.status === 'resolved') policy = base.pinnedPolicy.content;
      else reasons.push(base.pinnedPolicy.reason);
    }
    const executionFactsOf = (taskIds: readonly string[]): TracedTaskFactsV1[] => taskIds.map((taskId) =>
      base.tasks.find((task) => task.taskId === taskId) ?? untracedFacts(taskId));
    const trace = futureChangeTraceProblem(executionFactsOf(
      [...new Set([...delta.delta.changedTaskIds, ...delta.delta.addedTaskIds])]), delta.delta.carrierRemovals);
    if (trace !== null) reasons.push(trace.detail);
    const traced = tracedDispositionChangeProblem({ goalDesiredState: base.goalDesiredState,
      tasks: executionFactsOf(delta.delta.dispositionOnlyTaskIds), affectedTaskIds: input.affectedTaskIds,
      adopterClass: 'human', changes: delta.delta.dispositionChanges });
    if (traced !== null) reasons.push(traced.detail);
  }
  for (const issue of [...validatePlanDraft(draft, policy, base?.plan ?? null), ...uncoveredRequirementIssues(
    { tasks: draft.tasks, obligations: judged },
    { checks, checksAt: 'installed', policyKinds: policy?.requirementKinds ?? null })]) {
    reasons.push(rendered(issue));
  }
  reasons.push(...validatePlanAssignments(draft));
  if (admission.catalog !== null) {
    reasons.push(...unknownModuleReasons(moduleCheckOf(draft, admission.catalog, base?.plan ?? null,
      new Set(base?.terminalTaskIds ?? [])).unknown, admission.catalog));
  } else if (base !== null && draftHasModuleTask(draft)) {
    reasons.push('the project has no active architecture catalog');
  }
  // A first plan's adoption checks its module scopes against the catalog governance selected, beside the propose's.
  const selected = admission.firstAdoptionCatalog;
  if (selected !== null && draftHasModuleTask(draft)) {
    const selectedReasons = selected.status === 'rejected' ? [selected.reason]
      : unknownModuleReasons(moduleCheckOf(draft, selected.catalog, null, new Set()).unknown, selected.catalog);
    reasons.push(...selectedReasons.filter((reason) => !reasons.includes(reason)));
  }
  return reasons;
}

/** L10 (8B §3.3): one module-scoped task whose moduleRef names no module of the catalog. */
export type UnknownModuleTaskV1 = { taskId: string; moduleId: string };

/** L10: every task with `scope.kind === 'module'` whose `moduleRef` is not a `catalog.modules[].ref.moduleId`, in
 * draft task order, whatever its kind, level, disposition or acceptance. Tolerant like `validatePlanDraft` (:34–:36):
 * `draft.tasks ?? []`, a task without an object `scope` is skipped; never throws. (body free) */
export function unknownModuleTasksOf(draft: Pick<PlanDraftView, 'tasks'>, catalog: AdoptedArchitecture): UnknownModuleTaskV1[] {
  const known = new Set(catalog.modules.map((module) => module.ref.moduleId));
  const unknown: UnknownModuleTaskV1[] = [];
  const tasks = Array.isArray(draft.tasks) ? draft.tasks : [];
  for (const task of tasks) {
    if (task === null || typeof task !== 'object') continue;
    const scope = task.scope;
    if (scope === null || typeof scope !== 'object' || scope.kind !== 'module') continue;
    if (!known.has(scope.moduleRef)) unknown.push({ taskId: task.taskId, moduleId: scope.moduleRef });
  }
  return unknown;
}

/** The one refusal; called only with a non-empty list. One entry per task, no de-duplication of module ids. */
export function unknownModuleRejection(tasks: readonly UnknownModuleTaskV1[]): CoreRejection {
  return rejected('invalid', `unknown_module: ${tasks.map((task) => `${task.taskId}=${task.moduleId}`).join(', ')}`);
}

/**
 * [2B-26]: every module scope's `moduleRef` from the caller frame (the Goal's workspace) to the project view.
 * The propose entries call it once, where they read the draft; an adoption's source proof puts the draft it
 * re-normalizes from the answer in the same view before comparing. A task or scope that is not an object stays as
 * it is (`validatePlanDraft` names it); a reference that is not a module id of the grammar throws, and
 * `planDraftInProjectView` catches it as the draft's `invalid` (workspace-module-id.ts `rawModuleId`).
 */
export function qualifyPlanDraft(draft: PlanRevisionDraft, goalWorkspaceId: string,
  mainWorkspaceId: string): PlanRevisionDraft {
  return withModuleRefs(draft, (moduleRef, taskId) => {
    try {
      return projectModuleIdOfFile(moduleRef, goalWorkspaceId, mainWorkspaceId);
    } catch {
      throw new Error(`task ${String(taskId)}: ${moduleRef} is not a module id`);
    }
  });
}

/**
 * The inverse of `qualifyPlanDraft` on the ids it writes: every module scope's `moduleRef` from the project view back
 * to the caller frame of `goalWorkspaceId` (`fileModuleId`), so `qualifyPlanDraft(planInCallerView(plan, w, m), w, m)`
 * holds exactly the module ids of `plan`. A round's segment is written in that frame: it merges onto the base put back
 * this way, and the merged plan is qualified once, where the propose reads it and where a submit judges it.
 */
export function planInCallerView<P extends PlanRevisionSnapshot | PlanRevisionDraft>(plan: P, goalWorkspaceId: string,
  mainWorkspaceId: string): P {
  return withModuleRefs(plan, (moduleRef) => fileModuleId(moduleRef, goalWorkspaceId, mainWorkspaceId));
}

/** Every module scope's `moduleRef` through `reframe`; a task or scope that is not an object stays as it is. */
function withModuleRefs<P extends PlanRevisionSnapshot | PlanRevisionDraft>(plan: P,
  reframe: (moduleRef: string, taskId: unknown) => string): P {
  if (!Array.isArray(plan.tasks)) return plan;
  const tasks = plan.tasks.map(task => {
    if (!isRecord(task) || !isRecord(task.scope) || task.scope.kind !== 'module' || typeof task.scope.moduleRef !== 'string') {
      return task;
    }
    return { ...task, scope: { ...task.scope, moduleRef: reframe(task.scope.moduleRef, task.taskId) } };
  });
  return { ...plan, tasks };
}
