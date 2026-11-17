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
 * G8B B5 R2（lead 11-17 补充裁定 2）：一条源义务被这次改动放开了：它列的任务在目标里都不再活动，其中至少一个是这次
 * 从活动变成不再活动的源关口。合并不带它（段只能替换和追加，这是段“不带只由旧关口列着的义务”的唯一写法），人采用时
 * 可以不带它（`validateFutureObligationCoverage`），两处都只问这里。要求有关口跟着变：只由早就不活动的任务（延后、
 * 取消）列着的可选义务不会在每次细化时被合并丢掉，否则普通细化会变成降标，agent 就采用不了。能不能取代那个关口
 * 由采用时的 R1 判。
 */
export function obligationReleasedByGateChange(obligation: Pick<AcceptanceObligation, 'taskIds'>,
  sourceTaskById: ReadonlyMap<string, Pick<RuntimeTask, 'taskKind' | 'disposition'>>,
  targetTaskById: ReadonlyMap<string, Pick<RuntimeTask, 'disposition'>>): boolean {
  const inactive = (taskId: string): boolean => targetTaskById.get(taskId)?.disposition !== 'active';
  const releasedGate = (taskId: string): boolean => {
    const before = sourceTaskById.get(taskId);
    return before !== undefined && before.taskKind === 'gate' && before.disposition === 'active' && inactive(taskId);
  };
  return obligation.taskIds.every(inactive) && obligation.taskIds.some(releasedGate);
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
 * - G8B B5：段没重写、又被这次改动放开的基准义务（`obligationReleasedByGateChange`）不带进结果。
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
  const baseTaskById = new Map(base.tasks.map((entry) => [entry.taskId, entry]));
  const mergedTaskById = new Map(tasks.map((entry) => [entry.taskId, entry]));
  const restated = new Set(segment.obligations.map((entry) => entry.obligationId));
  const obligations: AcceptanceObligation[] = mergeByKey(
    base.obligations, segment.obligations, (entry) => entry.obligationId,
  ).filter((entry) => restated.has(entry.obligationId)
    || !obligationReleasedByGateChange(entry, baseTaskById, mergedTaskById));

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
