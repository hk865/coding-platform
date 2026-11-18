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
import type { CheckCapabilityV1, RegisteredCommandCheck } from '../../../contracts/verification.js';
import { checksApplyingTo, planCoverageGaps } from '../state/plan-candidate.js';
import type { FutureCarrierRemovalV1, FutureDispositionChangeV1 } from '../state/plan-machine.js';
import {
  buildFrozenTaskDefinitions, executionDefinitionsAgree, frozenTaskDefinitionsAgree, isBasisUnsupported,
  type FrozenObligation, type FrozenTaskDefinition,
} from './plan-task-basis.js';
import { buildTaskAdjacency, hasCycleInEdges, hasDirectedCycle } from '../model/task-index.js';
import { mergeStageRefinement, obligationReleasedByGateChange } from './stage-segment.js';
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
  // E08（G6 第六次）：改计划时新造一个一出生就是已取消的任务，原任务照旧 active，计划自相矛盾。上一版没有这个任务号、
  // disposition 却是 cancelled 或 superseded（lead 11-17：取代同理），就报出来：要取消或取代的是已有任务，就改那个任务本身。
  // 首版计划没有上一版（source 为 null），不查。代码沿用“新任务必须从 pending 开始”那一条的 `unsupported_execution_change`。
  if (source !== null) {
    for (const task of tasks) {
      if ((task.disposition !== 'cancelled' && task.disposition !== 'superseded') || sourceTasks.has(task.taskId)) continue;
      issues.push(planValidationError(`tasks[${task.taskId}].disposition`, 'unsupported_execution_change',
        `new task ${task.taskId} starts ${task.disposition}: to cancel or supersede an existing task, set that task's own `
        + 'disposition and keep its taskId; a task that is new in this revision never starts cancelled or superseded'));
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

/** 决定 121-1xx（CPL-3 的“恰好一道目标关口”进校验）：一份计划恰好一道还没了结的活动必需目标关口。改计划的段里没写的
 *  旧关口照旧 active（合并只替换同号、追加新号，stage-segment.ts:56-58），再加一道新关口就成了两道。源计划原样带过来、
 *  已了结（满足）的关口不算：已满足的关口处置是终态（TASK-19 守卫 5，G8B B5），已完成的目标接着做时只能保留它、再加
 *  一道新的。只报这一版比上一版多出来的多道：上一版已经是多道的旧账本不重判。只在有可执行的必需工作时查，和“缺目标
 *  关口”同一范围；首版交表的 `PlanForm` 没有 `planId`，source 为 null 时不交给增量判定。 */
export function goalGateCountIssue(draft: PlanRevisionDraft | PlanDraftView, source: PlanRevisionSnapshot | null,
  terminalTaskIds: ReadonlySet<string>): PlanValidationError | null {
  const tasks: readonly PlanTaskView[] = draft.tasks;
  const executableRequiredWork = tasks.some((task) => task.requirementLevel === 'required'
    && task.taskKind === 'work' && task.disposition === 'active' && task.executionIntent !== 'plan_only');
  if (!executableRequiredWork) return null;
  const closed = source === null || !('planId' in draft) ? new Set<string>()
    : unchangedTerminalTaskIds(source, draft, terminalTaskIds);
  const activeGoalGates = (members: readonly PlanTaskView[]): PlanTaskView[] => members.filter((task) =>
    task.requirementLevel === 'required' && task.taskKind === 'gate' && task.disposition === 'active'
    && task.scope.kind === 'goal' && !closed.has(task.taskId));
  const now = activeGoalGates(tasks);
  const before = activeGoalGates(source?.tasks ?? []);
  if (now.length <= 1 || now.length <= before.length) return null;
  const rule = `the plan has ${now.length} active required goal gates (${now.map((task) => task.taskId).join(', ')}); `
    + 'a plan has exactly one open goal gate';
  // 没有还没了结的已采用目标关口（首版，或源计划的目标关口都已了结）：没有可放验收、可取代的旧关口，只写这一句。
  if (before.length === 0) return planValidationError('tasks', 'multiple_active_goal_gates', rule);
  const adoptedIds = new Set(before.map((task) => task.taskId));
  const adopted = tasks.filter((task) => adoptedIds.has(task.taskId)).map((task) => task.taskId).join(', ');
  // 带条件：人没有明确改目标要满足的东西时保留关口，只有人改了才把旧关口标成 superseded（P2 原文）。新义务不挂到已采用的
  // 关口上：关口冻结（validateFutureObligationCoverage）只许已采用关口带着原来那几条义务。
  return planValidationError('tasks', 'multiple_active_goal_gates', `${rule}. Keep one: leave out the new gate and let `
    + 'the new obligation list only the new work tasks (an adopted gate keeps exactly the obligations that list it), '
    + 'or, if the person changed what the goal must meet, list the adopted gate '
    + `(${adopted}) with its own taskId and disposition "superseded" and replacedByTaskId naming the new gate; `
    + 'a task you leave out of a segment stays as it is and stays active');
}

/**
 * Every required verification requirement needs, on each active Task its obligation maps, a check of its kind that
 * applies to that Task's round, or that round could never pass it and the plan could never complete. The coverage is
 * the one the check round compiles (`planCoverageGaps` over `taskVerificationCoverage`): a reviewer requirement is
 * never uncovered, a witness one is the platform's. Kind legality is `validatePlanDraft`'s (`unknown_requirement_kind`):
 * every kind the draft names counts as known to the coverage, and a kind outside a known policy (`policyKinds`) is
 * left to that one problem, so one requirement gets one problem, naming every Task it is uncovered on. `checks` are
 * the capabilities of the check list the plan will run under (`checkCapabilitiesOf`); `null` (no installed
 * configuration) is unknown coverage and judges nothing. `checksAt` names that list: a first plan's own `setup.checks`,
 * or (121-136) the workspace's `installed` checks with the ones this plan proposes (`checksWithProposed`), where the
 * plan may propose a check that is installed when the person adopts it; that problem names the checks that do apply.
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
    // The platform's own witness is not a registered check; only the registered commands are named.
    const named = entry.taskIds.map((taskId) => checksApplyingTo(draft.tasks, taskById.get(taskId)!, checks)
      .filter((check) => check.kind !== 'witness').map((check) => `${check.checkId} (${check.kind})`));
    const applying = entry.taskIds.map((taskId, index) =>
      `${taskId}: ${named[index]!.length === 0 ? 'none' : named[index]!.join(', ')}`);
    return planValidationError(path, 'uncovered_verification_requirement', `${needs}, but neither an installed check `
      + `nor one this plan proposes does. The checks that apply, installed or proposed, by task: ${applying.join('; ')}. `
      + `Propose in this plan's checks a check of kind ${entry.kind} whose taskIds include ${tasks}: it is installed when `
      + 'the plan is adopted (when the platform adopts the plan by itself, an agent that did not write the plan approves '
      + 'each new check, and only one that fails on the workspace as it is before this change). Or use a requirement '
      + 'kind the checks that apply cover');
  });
}

/**
 * E09F（lead 11-17）：平台现在满足不了的依赖种类。`decision` 边要读上游 Run 发出、已回复并已应用的一条消息，而决定的
 * 应用没有接上，一律 `unsupported`（`context-input-service.ts:621-627`）；`output-contract` 边没有正式的带标签产出，
 * 一律缺（同文件 :693-697）。依赖又不挡领取（决定 11），照这种边写的计划，下游会马上开工然后卡住（G6 E09）。
 */
const UNSUPPORTED_DEPENDENCY_KINDS: readonly string[] = ['decision', 'output-contract'];

/**
 * E09F：交表时（首版计划的表；每个规划轮的表，秘书的请求轮和参谋的规划轮一样，都由 `answer-tools.ts` 的
 * `answerProblems` 调）退回用了上面两种依赖的边，每条一句，写明改法（lead 11-17 18:0x 定的说法：
 * 要等别的任务做完，用执行先后表达；要定的事交给参谋或人。不建议改用 `artifact`，它同样满足不了）。`source` 是这次计划
 * 所依据的已采用计划（首版为 null）：原样沿用的边不再判，因为规划轮只交一段，改不到别段已有的边。
 */
export function unsupportedDependencyIssues(draft: Pick<PlanDraftView, 'executionDag'>,
  source: Pick<PlanRevisionSnapshot, 'executionDag'> | null): string[] {
  const carried = new Set((source?.executionDag.dependsOn ?? []).map((edge) => canonicalJson(edge as unknown as JsonValue)));
  return draft.executionDag.dependsOn.flatMap((edge, index) => {
    const kind = edge.requires.kind;
    if (!UNSUPPORTED_DEPENDENCY_KINDS.includes(kind) || carried.has(canonicalJson(edge as unknown as JsonValue))) return [];
    return [`executionDag.dependsOn[${index}]: ${edge.taskId} depends on ${edge.dependsOnId} with requires.kind "${kind}", `
      + `which the platform does not support yet (such an edge is never satisfied and does not hold ${edge.taskId} back). `
      + 'To wait until another task is done, express that as execution order (executionDag.dependsOn); hand a decision '
      + 'someone still has to make to the adviser or the person'];
  });
}

/**
 * 121-136: a plan's own checks against the plan: each lists only Tasks of this plan in `taskIds` (or is `"all"`), and
 * each id is used once in the plan. Form time and the propose share it; whether an id is already installed is the
 * adoption's (`proposedCheckSplit`).
 */
export function planCheckIssues(checks: readonly RegisteredCommandCheck[], tasks: readonly { taskId: string }[]): string[] {
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const seen = new Set<string>();
  const issues: string[] = [];
  for (const check of checks) {
    if (seen.has(check.checkId)) {
      issues.push(`checks: check id ${check.checkId} is used twice in this plan; give each check its own checkId`);
    }
    seen.add(check.checkId);
    const unknown = check.taskIds === 'all' ? [] : check.taskIds.filter((taskId) => !taskIds.has(taskId));
    if (unknown.length > 0) {
      issues.push(`checks: check ${check.checkId} lists ${unknown.join(', ')}, not a task of this plan: taskIds lists `
        + 'the tasks of this plan it checks, or is "all" for a check every later goal keeps using');
    }
  }
  return issues;
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

/**
 * G8B B5（11-17 用户）：一份候选降低或改变了关口的标准：源计划里活动的关口在目标里不再是 active（带上它写的取代者），
 * 或者源义务没带进目标。人采用时的放宽（`validateFutureObligationCoverage` 的 R1）、候选卡的事实和 PL 的决定表三处
 * 都从这里取，不另判。
 */
export type StandardChangeV1 = {
  supersededGates: { taskId: string; replacedByTaskId: string | null }[];
  droppedObligationIds: string[];
};

/** G8B B5：只比源和目标两份计划；没有这种改动是 null。两个列表都按 id 排序。 */
export function standardChangeOf(source: Pick<PlanRevisionSnapshot, 'tasks' | 'obligations'>,
  target: Pick<PlanRevisionDraft, 'tasks' | 'obligations'>): StandardChangeV1 | null {
  const targetTaskById = new Map(target.tasks.map((task) => [task.taskId, task]));
  const supersededGates: StandardChangeV1['supersededGates'] = [];
  for (const task of source.tasks) {
    const next = targetTaskById.get(task.taskId);
    // 目标里没有这个关口是物理删除，`deriveFuturePlanDelta` 报它，不算降标。
    if (task.taskKind !== 'gate' || task.disposition !== 'active' || next === undefined || next.disposition === 'active') continue;
    supersededGates.push({ taskId: task.taskId, replacedByTaskId: next.replacedByTaskId ?? null });
  }
  supersededGates.sort((left, right) => (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0));
  const carried = new Set(target.obligations.map((obligation) => obligation.obligationId));
  const droppedObligationIds = source.obligations.map((obligation) => obligation.obligationId)
    .filter((obligationId) => !carried.has(obligationId)).sort();
  return supersededGates.length === 0 && droppedObligationIds.length === 0 ? null
    : { supersededGates, droppedObligationIds };
}

/**
 * G8B B5 R1：人采用时可以取代的源关口。`standardChangeOf` 读出的不再活动的源关口里，只算这样的：目标里是 superseded，
 * replacedByTaskId 指向本次新增的任务，它自己的任务字段除处置和取代者外不变（`executionDefinitionsAgree` 的去字段比较，
 * 且不比它所在的义务：取代时它带的义务本来就跟着变）。取代者是不是同类任务由 `replacementIssues` 一处判。其余的照旧
 * 由关口冻结报 `gate_definition_changed`：取消或延后关口、原地改关口、指向已有的任务。
 */
function replaceableGateIds(change: StandardChangeV1 | null, targetTaskById: ReadonlyMap<string, RuntimeTask>,
  addedTaskIds: readonly string[], sourceDefinitions: ReadonlyMap<string, FrozenTaskDefinition>,
  targetDefinitions: ReadonlyMap<string, FrozenTaskDefinition>): ReadonlySet<string> {
  const added = new Set(addedTaskIds);
  const withoutObligations = (definition: FrozenTaskDefinition): FrozenTaskDefinition =>
    ({ ...definition, carriedObligations: [] });
  const replaceable = new Set<string>();
  for (const gate of change?.supersededGates ?? []) {
    // 取代清单里的关口两份计划里都有，两份定义索引由同一份任务表建出，所以三处都取得到。
    if (targetTaskById.get(gate.taskId)!.disposition !== 'superseded' || gate.replacedByTaskId === null
      || !added.has(gate.replacedByTaskId)) continue;
    const agree = executionDefinitionsAgree({ left: withoutObligations(sourceDefinitions.get(gate.taskId)!),
      right: withoutObligations(targetDefinitions.get(gate.taskId)!) });
    // 定义取不出规范文本时不算可取代：下面的关口冻结比同一份定义，会把它报成 unsupported。
    if (agree === true) replaceable.add(gate.taskId);
  }
  return replaceable;
}

/**
 * G8B B5 R1（lead 11-17 补充裁定 1）：这次采用合规取代的源关口；只有人采用时才有，否则是空集。计划校验的关口冻结
 * （下面的 `validateFutureObligationCoverage`）和任务状态机的关口处置冻结都按它放宽：采用时由计划服务算好，经处置
 * 事实传给状态机（`TaskDispositionFacts.gateReplaced`），条件只在 `replaceableGateIds` 一处。
 */
export function replacedGateIdsOf(input: { source: PlanRevisionSnapshot; target: PlanRevisionDraft; delta: FuturePlanDelta;
  personAdopts: boolean }): ReadonlySet<string> {
  if (!input.personAdopts) return new Set();
  return replaceableGateIds(standardChangeOf(input.source, input.target),
    new Map(input.target.tasks.map((task) => [task.taskId, task])), input.delta.addedTaskIds,
    definitionIndex(input.source), draftDefinitionIndex(input.target));
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
  /**
   * A person's explicit adoption may change acceptance semantics under `changedRequirementKeepsOldId`.
   * G8B B5：人采用时还可以取代关口（R1），并不带被这次改动放开的义务（R2，`obligationReleasedByGateChange`）。
   */
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
  // G8B B5（11-17 用户）：降低或改变关口的标准只由人采用的计划来做。人采用时，R1 合规取代的源关口不报冻结；R2 被这次
  // 改动放开的源义务可以不带进目标（和合并同一个判断）。agent 或平台采用照旧冻结。
  const replacedGates = input.personAdopts
    ? replaceableGateIds(standardChangeOf(source, target), targetTaskById, delta.addedTaskIds, sourceDefinitions,
      targetDefinitions)
    : new Set<string>();
  const sourceTaskById = new Map(source.tasks.map((task) => [task.taskId, task]));
  // R2：人采用时，这次真的没带进目标、又被这次改动放开的源义务。
  const released = new Set(input.personAdopts ? source.obligations
    .filter((obligation) => !targetObligations.has(obligation.obligationId)
      && obligationReleasedByGateChange(obligation, sourceTaskById, targetTaskById))
    .map((obligation) => obligation.obligationId) : []);

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
      if (released.has(obligation.obligationId)) continue;
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
    // R2 放开的义务不再算进源关口的冻结定义：连续取代时，早先被取代的关口也列着它（Astra 审查 G8B-2 第 2 条）。
    // 只从源定义里去掉这些义务，任务字段和其余义务照旧完整比较。
    const kept = released.size === 0 ? left : { ...left,
      carriedObligations: left.carriedObligations.filter((obligation) => !released.has(obligation.obligationId)) };
    const agree = frozenTaskDefinitionsAgree({ left: kept, right });
    if (isBasisUnsupported(agree)) return { status: 'unsupported', reason: agree.reason };
    if (!agree && !replacedGates.has(task.taskId)) {
      issues.push(planValidationError(`tasks[${task.taskId}]`, 'gate_definition_changed',
        `source gate task ${task.taskId} changed its definition or acceptance relationships: an adopted gate keeps `
        + 'its definition and exactly the obligations that list it, with their content. Leave the gate and those '
        + 'obligations as adopted; a new obligation lists the new work tasks and, when it needs a gate, a new gate task '
        + `(a new stage's own gate, or a new goal gate only when no goal gate is still open: a plan keeps exactly one `
        + 'open goal gate). '
        + 'Only a plan the person adopts may supersede a gate: mark it superseded with replacedByTaskId naming a new '
        + 'gate task that carries a new obligation'));
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
 * judges everything again. 决定 121-1xx（lead 裁定 E08 C）：交表时守卫 1、2、2b 和 4 的后半（执行还没停稳）留给采用时判，
 * 守卫 3（挂着没收的让出等待）交表时照判。
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
  /** 121-136: the checks the answer's plan proposes, judged against the merged plan's Tasks (`planCheckIssues`). */
  proposedChecks: readonly RegisteredCommandCheck[];
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
      adopterClass: 'human', changes: delta.delta.dispositionChanges, deferBusy: true,
      taskKinds: new Map(base.plan.tasks.map((task) => [task.taskId, task.taskKind])) });
    if (traced !== null) reasons.push(traced.detail);
  }
  const gateCount = goalGateCountIssue(draft, base?.plan ?? null, new Set(base?.terminalTaskIds ?? []));
  for (const issue of [...validatePlanDraft(draft, policy, base?.plan ?? null), ...uncoveredRequirementIssues(
    { tasks: draft.tasks, obligations: judged },
    { checks, checksAt: 'installed', policyKinds: policy?.requirementKinds ?? null }),
  ...(gateCount === null ? [] : [gateCount])]) {
    reasons.push(rendered(issue));
  }
  reasons.push(...validatePlanAssignments(draft));
  reasons.push(...planCheckIssues(input.proposedChecks, draft.tasks));
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
