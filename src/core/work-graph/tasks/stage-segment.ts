import type {
    AcceptanceObligation,
    PlanRevisionDraft,
    PlanRevisionSnapshot,
    PlanStage,
    RuntimeTask,
    TaskInputRequirementV2,
    TaskRelationV2,
} from '../../../contracts/plan.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';

/**
 * Replaces entries with the same key in place and appends the segment's new
 * entries in segment order, so the result is "base then segment" (§5.1.2).
 */
function mergeByKey<T>(base: readonly T[], segment: readonly T[], keyOf: (entry: T) => string): T[] {
  const merged = [...base];
  for (const entry of segment) {
    const key = keyOf(entry);
    const index = merged.findIndex((existing) => keyOf(existing) === key);
    if (index === -1) merged.push(entry);
    else merged[index] = entry;
  }
  return merged;
}

/**
 * Merges one segment's draft into the base it refines (§5.1.2).
 *
 * - An empty segment (no stage and no task) is rejected; every other invalid
 *   combination is left to the plan codec, `validatePlanDraft` and the
 *   plan-machine's future branch.
 * - The result keeps the base `reviewAdmissionProtocol`. `origin` is kept only
 *   when the base is an adopted snapshot; a candidate draft base carries none.
 *   The segment's own `origin` never enters the result.
 * - `planId`/`planRevision` are the segment's new values.
 * - Stages replace by stageId and new stages append in segment order; tasks,
 *   assignments and obligations replace by their key and append the rest. No
 *   task is deleted: a closed task expresses its removal through disposition.
 * - Edges owned by a segment task are dropped from the base and the segment's
 *   edges append; other base edges stay. Instructions are copied verbatim.
 *
 * Only `segment.stages` carry stage definitions. A segment task that names a
 * stage without its own definition is left to the existing dangling-stage
 * check; the merger does not invent a stage.
 */
export function mergeStageRefinement(base: PlanRevisionSnapshot | PlanRevisionDraft,
  segment: Omit<PlanRevisionDraft, 'origin'>):
  { status: 'merged'; draft: PlanRevisionDraft } | CoreRejection {
  if (segment.stages.length === 0 && segment.tasks.length === 0) {
    return rejected('invalid', 'the segment names no stage and no task');
  }

  const segmentTaskIds = new Set(segment.tasks.map((entry) => entry.taskId));
  const stages: PlanStage[] = mergeByKey(base.stages, segment.stages, (entry) => entry.stageId);
  const tasks: RuntimeTask[] = mergeByKey(base.tasks, segment.tasks, (entry) => entry.taskId);
  const assignments = base.assignments === undefined && segment.assignments === undefined
    ? undefined
    : mergeByKey(base.assignments ?? [], segment.assignments ?? [], (entry) => entry.taskId);
  const obligations: AcceptanceObligation[] = mergeByKey(
    base.obligations, segment.obligations, (entry) => entry.obligationId,
  );

  const parentOf = [
    ...base.taskHierarchy.parentOf.filter((edge) => !segmentTaskIds.has(edge.childTaskId)),
    ...segment.taskHierarchy.parentOf,
  ];
  const dependsOn = [
    ...base.executionDag.dependsOn.filter((edge) => !segmentTaskIds.has(edge.taskId)),
    ...segment.executionDag.dependsOn,
  ];
  const taskRelations: TaskRelationV2[] | undefined = base.taskRelations === undefined && segment.taskRelations === undefined
    ? undefined
    : [
        ...(base.taskRelations ?? []).filter((edge) => !segmentTaskIds.has(edge.fromTaskId)),
        ...(segment.taskRelations ?? []),
      ];
  const inputRequirements: TaskInputRequirementV2[] | undefined =
    base.inputRequirements === undefined && segment.inputRequirements === undefined
      ? undefined
      : [
          ...(base.inputRequirements ?? []).filter((edge) => !segmentTaskIds.has(edge.consumerTaskId)),
          ...(segment.inputRequirements ?? []),
        ];

  // An adopted snapshot keeps its adoption origin; a candidate draft has no
  // own origin, and the segment's freshly normalized origin never appears.
  const origin = 'ref' in base ? base.origin : undefined;

  return {
    status: 'merged',
    draft: {
      schemaVersion: 2,
      ...(base.reviewAdmissionProtocol === undefined ? {} : { reviewAdmissionProtocol: base.reviewAdmissionProtocol }),
      ...(origin === undefined ? {} : { origin }),
      planId: segment.planId,
      planRevision: segment.planRevision,
      goalId: segment.goalId,
      stages,
      tasks,
      ...(assignments === undefined ? {} : { assignments }),
      obligations,
      taskHierarchy: { parentOf },
      executionDag: { dependsOn },
      ...(taskRelations === undefined ? {} : { taskRelations }),
      ...(inputRequirements === undefined ? {} : { inputRequirements }),
    },
  };
}
