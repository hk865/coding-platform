/** Control-owned deterministic domain policy. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import type {
  AmendGoalRequestV1,
  ApplyPlanChangeCommand,
  PlanProposalV1,
  PlanTaskSetDeltaV1,
  UserDecisionV1,
} from "../../../contracts/goal-change.js";
import { revisionAssignments } from "../../../contracts/plan.js";
import type {
  AcceptanceObligation,
  PlanRevisionSnapshot,
  PlanTaskAssignment,
  RuntimeExecutionDAG,
  RuntimeTask,
  TaskHierarchy,
} from "../../../contracts/plan.js";
import { PLAN_CHANGE_MAX_INSTRUCTION_BYTES } from "../../../contracts/goal-change.js";

type NewPlanDraft = NonNullable<ApplyPlanChangeCommand["payload"]["newPlanDraft"]>;

/** 任务集增量的结构化校验结果。任何 issue 都只让 applyPlanChange 拒绝，绝不产生写入。 */
export type TaskSetDeltaCheck = { ok: true } | { ok: false; issues: string[] };

/** 由「源 revision 任务集 + 增量」确定性推导出的目标任务集与取代关系。 */
export type DerivedTaskSet = {
  tasks: RuntimeTask[];
  /** 被取代的任务 id → 取代者 id。 */
  replacedBy: Map<string, string>;
  /** 本次退出执行（superseded／cancelled）的任务 id 集合。 */
  supersededIds: Set<string>;
};

/** 任务定义深拷贝：草稿与源快照不共享可变引用。 */
function cloneTask(task: RuntimeTask): RuntimeTask {
  return { ...task, scope: { ...task.scope } };
}

/**
 * ADR 0003 D1 第 2 条：任务集增量只能改「谁承担义务」，不能改义务正文与验收语义。
 * 本函数检查增量自身的形状与引用合法性（纯函数、零状态、零写入）：
 *  - addTask 必须给出完整 RuntimeTask 定义 + 它的指派（work 任务必带、gate 任务必须为 null）
 *    + 它承担的义务，且义务必须是源 revision 里已有的义务；
 *  - replaceTask 必须同时给出被取代任务与取代者；取代者必须是源 revision 里 active 的既有任务
 *    （不允许链式取代：已被取代/取消的任务不能再当取代者，已非 active 的任务不能被取代）；
 *  - cancelTask 必须给出理由，且同一任务不能同时声明取代与取消。
 * 通过本检查不等于草稿合法：最终判据是「草稿与推导结果逐项比对」（见 draftConsistencyIssues）。
 */
export function checkTaskSetDelta(delta: PlanTaskSetDeltaV1[] | null | undefined, source: PlanRevisionSnapshot): TaskSetDeltaCheck {
  if (delta === null || delta === undefined) return { ok: true };
  const issues: string[] = [];
  if (!Array.isArray(delta)) return { ok: false, issues: ["taskSetDelta must be an array or null"] };
  if (delta.length > 64) issues.push("taskSetDelta exceeds the bounded size (64 operations)");

  const sourceTaskById = new Map(source.tasks.map((t) => [t.taskId, t]));
  const sourceObligationIds = new Set(source.obligations.map((o) => o.obligationId));
  const alreadyOut = new Set(source.tasks.filter((t) => t.disposition !== "active").map((t) => t.taskId));
  const replacedBy = new Map<string, string>();
  const cancelled = new Set<string>();
  const addedTaskIds = new Set<string>();

  // 增量是有界列表，允许「先声明取代、后给出新增任务」的书写顺序：先收集所有 addTask
  // 的任务 id，取代者的存在性才不会被条目顺序误判（推导函数与这里必须同解）。
  for (const op of delta) {
    if (op !== null && typeof op === "object" && op.action === "addTask") {
      const task = op.task as RuntimeTask | undefined;
      if (task !== null && task !== undefined && typeof task === "object" && typeof task.taskId === "string") {
        addedTaskIds.add(task.taskId);
      }
    }
  }

  for (const op of delta) {
    if (op === null || typeof op !== "object") {
      issues.push("taskSetDelta entry must be an object");
      continue;
    }
    if (op.action === "addTask") {
      const task = op.task as RuntimeTask | undefined;
      if (task === null || task === undefined || typeof task !== "object") {
        issues.push("addTask requires the new task to carry a complete RuntimeTask definition");
        continue;
      }
      if (typeof task.taskId !== "string" || task.taskId.length === 0) {
        issues.push("addTask requires the new task to declare taskId");
        continue;
      }
      if (typeof op.reason !== "string" || op.reason.trim().length === 0) {
        issues.push(`addTask ${task.taskId}: a reason is required`);
      }
      if (sourceTaskById.has(task.taskId)) {
        issues.push(`addTask ${task.taskId}: the task id already exists in the source revision`);
      }
      // 完整定义：四个正交维度 + scope 都要在，缺一即拒绝（不接受部分定义）。
      if (typeof task.title !== "string" || task.title.length === 0) issues.push(`addTask ${task.taskId}: title is required`);
      if (task.requirementLevel !== "required" && task.requirementLevel !== "optional") issues.push(`addTask ${task.taskId}: requirementLevel must be required|optional`);
      if (task.taskKind !== "work" && task.taskKind !== "gate") issues.push(`addTask ${task.taskId}: taskKind must be work|gate`);
      if (task.disposition !== "active" && task.disposition !== "deferred") {
        issues.push(`addTask ${task.taskId}: disposition must be active|deferred`);
      }
      if (task.phase !== "pending") issues.push(`addTask ${task.taskId}: phase must be pending (a NEW task carries no history)`);
      if (task.scope === null || task.scope === undefined || typeof task.scope !== "object") {
        issues.push(`addTask ${task.taskId}: scope is required`);
      } else {
        const scopeKind: string = task.scope.kind;
        const stageId: string | undefined = (task.scope as { stageId?: string }).stageId;
        if (scopeKind !== "goal" && scopeKind !== "stage" && scopeKind !== "module") {
          issues.push(`addTask ${task.taskId}: unknown scope kind`);
        }
        if (stageId !== undefined && !source.stages.some((s) => s.stageId === stageId)) {
          issues.push(`addTask ${task.taskId}: scope references unknown stage ${stageId}`);
        }
      }
      // RW-07：任务与它的指派必须同属一个 revision。新增任务若只有任务定义而没有
      // 「谁按什么指令承担」，它会进入计划、通过 readiness，却没有任何派发入口认领它
      // （DispatchEngine 按 revision 的指派派发）。因此这里把「必须带指派」并入既有推导：
      // work 任务必带，gate 任务不得带（gate 的结论由证据归约产生，不派发实现运行）。
      const assignment = op.assignment as PlanTaskAssignment | undefined | null;
      if (task.taskKind === "work") {
        if (assignment === null || assignment === undefined || typeof assignment !== "object") {
          issues.push(`addTask ${task.taskId}: a new work task must carry its assignment (role + instruction)`);
        } else {
          issues.push(...assignmentShapeIssues(assignment, task.taskId, `addTask ${task.taskId}`));
        }
      } else if (assignment !== null && assignment !== undefined) {
        // 与初始规划同一约定：「Gates have no implementation assignment」。gate 的结论由
        // 证据归约产生，给它一个实现指派会让计划出现一条不会被执行、也不该被执行的承担者。
        issues.push(`addTask ${task.taskId}: a gate task carries no implementation assignment`);
      }
      if (!Array.isArray(op.obligationIds)) {
        issues.push(`addTask ${task.taskId}: obligationIds must be an array`);
      } else {
        for (const obligationId of op.obligationIds) {
          if (!sourceObligationIds.has(obligationId)) {
            issues.push(`addTask ${task.taskId}: obligation ${obligationId} does not exist in the source revision (the delta must not invent obligations)`);
          }
        }
      }
    } else if (op.action === "replaceTask") {
      const supersededTaskId = op.supersededTaskId;
      const byTaskId = op.byTaskId;
      if (typeof op.reason !== "string" || op.reason.trim().length === 0) {
        issues.push(`replaceTask ${String(supersededTaskId)}: a reason is required`);
      }
      if (typeof supersededTaskId !== "string" || typeof byTaskId !== "string") {
        issues.push("replaceTask requires supersededTaskId and byTaskId");
        continue;
      }
      const superseded = sourceTaskById.get(supersededTaskId);
      if (superseded === undefined) {
        issues.push(`replaceTask ${supersededTaskId}: the superseded task is not part of the source revision`);
      } else if (superseded.disposition !== "active") {
        issues.push(`replaceTask ${supersededTaskId}: the task is already ${superseded.disposition} in the source revision`);
      }
      const by = sourceTaskById.get(byTaskId);
      if (by === undefined && !addedTaskIds.has(byTaskId)) {
        issues.push(`replaceTask ${supersededTaskId}: the replacement task ${byTaskId} is neither part of the source revision nor declared by an addTask entry`);
      } else if (by !== undefined && by.disposition !== "active") {
        issues.push(`replaceTask ${supersededTaskId}: the replacement task ${byTaskId} is not active`);
      }
      if (supersededTaskId === byTaskId) {
        issues.push(`replaceTask ${supersededTaskId}: a task cannot replace itself`);
      }
      const previous = replacedBy.get(supersededTaskId);
      if (previous !== undefined) {
        issues.push(`replaceTask ${supersededTaskId}: already replaced by ${previous}`);
      }
      replacedBy.set(supersededTaskId, byTaskId);
    } else if (op.action === "cancelTask") {
      const taskId = op.taskId;
      if (typeof op.reason !== "string" || op.reason.trim().length === 0) {
        issues.push(`cancelTask ${String(taskId)}: a cancellation reason is required`);
      }
      if (typeof taskId !== "string") {
        issues.push("cancelTask requires taskId");
        continue;
      }
      const task = sourceTaskById.get(taskId);
      if (task === undefined) {
        issues.push(`cancelTask ${taskId}: the task is not part of the source revision`);
      } else if (task.disposition !== "active") {
        issues.push(`cancelTask ${taskId}: the task is already ${task.disposition} in the source revision`);
      }
      if (replacedBy.has(taskId)) {
        issues.push(`cancelTask ${taskId}: the task is already replaced; one task has exactly one disposition`);
      }
      if (cancelled.has(taskId)) issues.push(`cancelTask ${taskId}: duplicated entry`);
      cancelled.add(taskId);
    } else {
      issues.push(`taskSetDelta entry has an unknown action: ${String((op as { action?: unknown }).action)}`);
    }
  }
  for (const byTaskId of replacedBy.values()) {
    if (alreadyOut.has(byTaskId)) {
      issues.push(`task ${byTaskId}: a task that is not active in the source revision cannot be a replacement`);
    }
  }
  for (const taskId of cancelled) {
    if (replacedBy.has(taskId)) issues.push(`task ${taskId}: both replaceTask and cancelTask were declared`);
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/**
 * 指派的形状判据（RW-07）。与初始规划对同一形状的约定一致（role 取值、instruction 非空且
 * 有界），但**不重复它的解析职责**：那里是模型响应的公开边界解析，这里是 canonical 提交的
 * 守卫；两者判的是同一个形状，因此界取自同一常数。
 */
function assignmentShapeIssues(assignment: PlanTaskAssignment, taskId: string, label: string): string[] {
  const issues: string[] = [];
  if (typeof assignment.taskId !== "string" || assignment.taskId !== taskId) {
    issues.push(`${label}: assignment.taskId must be the id of the task it is attached to`);
  }
  if (assignment.role !== "executor" && assignment.role !== "integrator") {
    issues.push(`${label}: assignment role must be executor|integrator`);
  }
  if (typeof assignment.instruction !== "string" || assignment.instruction.trim().length === 0) {
    issues.push(`${label}: assignment instruction is required`);
  } else if (Buffer.byteLength(assignment.instruction) > PLAN_CHANGE_MAX_INSTRUCTION_BYTES) {
    issues.push(`${label}: assignment instruction exceeds ${PLAN_CHANGE_MAX_INSTRUCTION_BYTES} bytes`);
  }
  return issues;
}

/**
 * RW-07：新 revision 的指派集合 = 「源 revision 的指派（顺序不变）+ 增量里新增任务的
 * assignment（按增量书写顺序追加）」。与 deriveTaskSet 同处，因为它俩是同一次推导的两半：
 * 任务集决定"有哪些任务"，指派决定"谁按什么指令做"。
 *
 * 为什么退出执行的任务（superseded／cancelled）仍保留指派：
 *   1. 任务本身不删除，只改 disposition（ADR 0003 D1-3），它的指派是同一个 revision 内的事实；
 *   2. 派发用的 Run 身份由指派在列表中的位置推导（见 DispatchEngine 的注释），若在这里删条目，
 *      其余任务的 Run 身份会随每次返工变化，已开始的 Run 会被当成另一个身份重新派发；
 *   3. 派发候选按 disposition 过滤，因此保留不会让被取代任务被执行。
 * 草稿缺失（null／未提供）时由调用方回落到 revisionAssignments(source)，与"沿用源指派"一致。
 */
export function deriveTaskAssignments(
  source: PlanRevisionSnapshot,
  delta: PlanTaskSetDeltaV1[] | null | undefined,
): PlanTaskAssignment[] {
  const assignments: PlanTaskAssignment[] = revisionAssignments(source);
  for (const op of delta ?? []) {
    if (op === null || typeof op !== "object" || op.action !== "addTask") continue;
    const task = op.task as RuntimeTask | undefined;
    const assignment = op.assignment as PlanTaskAssignment | undefined | null;
    if (task === null || task === undefined || typeof task.taskId !== "string") continue;
    if (assignment === null || assignment === undefined) continue;
    assignments.push({ taskId: task.taskId, role: assignment.role, instruction: assignment.instruction });
  }
  return assignments;
}

/**
 * 指派集合的草稿一致性（RW-07，纯）：草稿的 assignments 必须逐项等于推导结果，并且每条
 * 指派都要指向**这个 revision 里存在的 work 任务**、同一任务不得出现两条。
 * 顺序不承载语义（指派按 taskId 归属），因此比较按 taskId 索引；这与任务集比较按 id 索引一致。
 */
function assignmentConsistencyIssues(
  draftAssignments: PlanTaskAssignment[],
  derivedAssignments: PlanTaskAssignment[],
  taskById: Map<string, RuntimeTask>,
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const entry of draftAssignments) {
    if (entry === null || entry === undefined || typeof entry !== "object" || typeof entry.taskId !== "string") {
      issues.push("assignment entry must carry the taskId it belongs to");
      continue;
    }
    if (seen.has(entry.taskId)) {
      issues.push(`assignment ${entry.taskId}: the same task must not carry two assignments`);
    }
    seen.add(entry.taskId);
    const task = taskById.get(entry.taskId);
    if (task === undefined) {
      issues.push(`assignment ${entry.taskId}: the task is not part of the derived task set`);
    } else if (task.taskKind !== "work") {
      issues.push(`assignment ${entry.taskId}: only work tasks carry an implementation assignment (a gate is reduced by evidence)`);
    }
    issues.push(...assignmentShapeIssues(entry, entry.taskId, `assignment ${entry.taskId}`));
  }
  const derivedById = new Map(derivedAssignments.map((entry) => [entry.taskId, entry]));
  for (const [taskId, expected] of derivedById) {
    const actual = draftAssignments.find((entry) => entry?.taskId === taskId);
    if (actual === undefined) {
      issues.push(`assignment ${taskId}: missing from the draft (the source revision plus the task set delta keeps it)`);
    } else if (canonicalJson(actual as never) !== canonicalJson(expected as never)) {
      issues.push(`assignment ${taskId}: draft assignment differs from the source revision plus the task set delta`);
    }
  }
  for (const entry of draftAssignments) {
    if (typeof entry?.taskId === "string" && !derivedById.has(entry.taskId)) {
      issues.push(`assignment ${entry.taskId}: present in the draft but not derived from the source revision plus the task set delta`);
    }
  }
  return issues;
}

/**
 * ADR 0003 D1：任务集增量落到任务定义、义务承担者、执行 DAG 上的确定性推导。
 * applyPlanChange 的守卫与草稿一致性检查必须共用本函数，避免出现第二份业务规则。
 *  - 任务定义不可改：源任务只可能保持原样，或被标为 superseded 并记录 replacedByTaskId；
 *  - 义务承担者换人：被取代任务从 taskIds 移除，取代者补入新任务声明的义务；
 *  - 新增任务的 DAG 前置必须指向仍然存在的任务（取代者或未受影响的任务）。
 */
export function deriveTaskSet(source: PlanRevisionSnapshot, delta: PlanTaskSetDeltaV1[] | null | undefined): DerivedTaskSet {
  const ops = delta ?? [];
  const replacedBy = new Map<string, string>();
  for (const op of ops) {
    if (op.action === "replaceTask" && typeof op.supersededTaskId === "string" && typeof op.byTaskId === "string") {
      replacedBy.set(op.supersededTaskId, op.byTaskId);
    }
  }
  const supersededIds = new Set<string>(replacedBy.keys());
  for (const op of ops) {
    if (op.action === "cancelTask" && typeof op.taskId === "string" && !replacedBy.has(op.taskId)) {
      supersededIds.add(op.taskId);
    }
  }
  const tasks: RuntimeTask[] = source.tasks.map((task) =>
    supersededIds.has(task.taskId)
      ? { ...cloneTask(task), disposition: "superseded" as const, replacedByTaskId: replacedBy.get(task.taskId) ?? null }
      : cloneTask(task),
  );
  for (const op of ops) {
    if (op.action === "addTask" && op.task !== null && op.task !== undefined && typeof op.task === "object") {
      tasks.push(cloneTask(op.task));
    }
  }
  return { tasks, replacedBy, supersededIds };
}

/**
 * 义务集合的确定性推导（新 revision 的目标义务集）：
 *  1. 任务集增量只改承担者集合（taskIds）——被取代/取消的任务退出，新增任务按声明补入；
 *  2. 提案的 obligationDeltas 再作用一次：remove 删除、change 只允许改标题、add 新增
 *     （新增义务沿用源里第一条义务的承担者与验收要求，与 P1-11 提案侧的默认一致）。
 * 正文、等级与 verificationRequirements 的语义在第 1 步逐字复制，绝不由任务集增量改写。
 */
export function deriveObligationSet(
  source: PlanRevisionSnapshot,
  delta: PlanTaskSetDeltaV1[] | null | undefined,
  replacedBy: Map<string, string>,
  obligationDeltas: AmendGoalRequestV1["obligationDeltas"] = [],
): AcceptanceObligation[] {
  const superseded = new Set<string>(replacedBy.keys());
  const addedByObligation = new Map<string, string[]>();
  for (const op of delta ?? []) {
    if (op.action === "cancelTask" && typeof op.taskId === "string") superseded.add(op.taskId);
    if (op.action === "addTask" && op.task !== null && op.task !== undefined && typeof op.task.taskId === "string") {
      for (const obligationId of Array.isArray(op.obligationIds) ? op.obligationIds : []) {
        const list = addedByObligation.get(obligationId) ?? [];
        if (!list.includes(op.task.taskId)) list.push(op.task.taskId);
        addedByObligation.set(obligationId, list);
      }
    }
  }
  const rewired = source.obligations.map((obligation) => {
    const taskIds: string[] = [];
    for (const taskId of obligation.taskIds) {
      // 被取代的任务退出承担者；有取代者时由取代者接手（同一义务、同一验收语义）。
      if (superseded.has(taskId)) continue;
      if (!taskIds.includes(taskId)) taskIds.push(taskId);
    }
    for (const taskId of addedByObligation.get(obligation.obligationId) ?? []) {
      if (!taskIds.includes(taskId)) taskIds.push(taskId);
    }
    return {
      ...obligation,
      taskIds,
      verificationRequirements: obligation.verificationRequirements.map((v) => ({ ...v })),
    };
  });
  return applyObligationDeltas(rewired, source, obligationDeltas);
}

/** 把提案的 obligationDeltas 作用到「已换过承担者」的义务集合上（纯、确定性）。 */
function applyObligationDeltas(
  rewired: AcceptanceObligation[],
  source: PlanRevisionSnapshot,
  deltas: AmendGoalRequestV1["obligationDeltas"],
): AcceptanceObligation[] {
  const byId = new Map(deltas.map((d) => [d.obligationId, d]));
  const result = rewired
    .filter((o) => byId.get(o.obligationId)?.action !== "remove")
    .map((o) => {
      const d = byId.get(o.obligationId);
      if (d?.action === "change") return { ...o, title: d.newText ?? o.title };
      return {
        ...o,
        taskIds: [...o.taskIds],
        verificationRequirements: o.verificationRequirements.map((v) => ({ ...v })),
      };
    });
  for (const d of deltas) {
    if (d.action !== "add") continue;
    const template = source.obligations[0];
    result.push({
      obligationId: d.obligationId,
      title: d.newText ?? d.obligationId,
      requirementLevel: "required",
      taskIds: template ? [...template.taskIds] : [],
      verificationRequirements: template ? template.verificationRequirements.map((v) => ({ ...v })) : [],
    });
  }
  return result;
}

/** 层级/执行 DAG 深拷贝（与 records 的折叠保持一致，避免共享可变引用）。 */
export function cloneHierarchy(hierarchy: TaskHierarchy): TaskHierarchy {
  return { parentOf: hierarchy.parentOf.map((e) => ({ ...e })) };
}
export function cloneDag(dag: RuntimeExecutionDAG): RuntimeExecutionDAG {
  return { dependsOn: dag.dependsOn.map((e) => ({ ...e, requires: { ...e.requires } })) };
}

// --------------------------------------------------------------------------- //
// 重指规则（唯一权威实现）：被取代任务在新 revision 里的执行 DAG 位置与层级归属  //
// --------------------------------------------------------------------------- //

/**
 * **重指规则**：把「源执行 DAG」按 replacedBy 映射重指到取代者。
 *
 * 为什么这是正确性要求而不是美化（本函数所在位置就是这条规则唯一的权威实现）：
 *   - 被取代任务在新 revision 里 disposition = "superseded"，永远不会变成 satisfied；
 *   - 调度只放行 active 任务，且前驱是按 taskId 查找并要求 satisfied
 *     （policies/task-eligibility.ts:78-96、policies/goal-phase.ts:372-375）；
 *   - 因此下游任务若仍依赖被取代任务，它永远等不到一个 satisfied 的前驱：Goal 再也无法
 *     归约为 RUNNING。任何构造 planDraft 的路径都必须经过本函数，否则这个保证会丢。
 *
 * 机械性质：替换是单射的（旧 id → 新 id，新 id 不参与再映射），因此重指不会引入环；
 * 重指后可能产生重复边（两条源边映射到同一对端点），这里按首次出现去重，保持源顺序。
 * requires 逐字复制：本次只是换承担者，依赖要的产物契约没有变，不允许在这里改写语义。
 */
export function rewireExecutionDag(dag: RuntimeExecutionDAG, replacedBy: Map<string, string>): RuntimeExecutionDAG {
  const seen = new Set<string>();
  const dependsOn: RuntimeExecutionDAG['dependsOn'] = [];
  for (const edge of dag.dependsOn) {
    const mapped = {
      taskId: replacedBy.get(edge.taskId) ?? edge.taskId,
      dependsOnId: replacedBy.get(edge.dependsOnId) ?? edge.dependsOnId,
      requires: { ...edge.requires },
    };
    const key = canonicalJson(mapped as never);
    if (seen.has(key)) continue;
    seen.add(key);
    dependsOn.push(mapped);
  }
  return { dependsOn };
}

/**
 * **重指规则**：把「源层级」按 replacedBy 映射重指到取代者。
 * 层级只表达工作分解与展示（不参与 readiness／环检测／完成），同样重指，是为了让取代者
 * 留在它接手的那份工作分解下，而不是变成一个没有归属的根节点。
 */
export function rewireTaskHierarchy(hierarchy: TaskHierarchy, replacedBy: Map<string, string>): TaskHierarchy {
  const seen = new Set<string>();
  const parentOf: TaskHierarchy['parentOf'] = [];
  for (const edge of hierarchy.parentOf) {
    const mapped = {
      parentTaskId: replacedBy.get(edge.parentTaskId) ?? edge.parentTaskId,
      childTaskId: replacedBy.get(edge.childTaskId) ?? edge.childTaskId,
    };
    const key = canonicalJson(mapped as never);
    if (seen.has(key)) continue;
    seen.add(key);
    parentOf.push(mapped);
  }
  return { parentOf };
}

/** 重指结果：新 revision 里执行 DAG 与层级**必须**等于这一对值。 */
export type RewiredTaskGraph = { executionDag: RuntimeExecutionDAG; taskHierarchy: TaskHierarchy };

/**
 * 源 revision + 取代关系 ⇒ 新 revision 应有的执行 DAG 与层级（守卫 f2 与提案侧共用的唯一定义）。
 *
 * 守卫侧（draftConsistencyIssues）用它逐项比对草稿，提案侧（PlanCompiler 的返工编译器）用它
 * 生成草稿：两边调用同一函数，因此「谁把新任务接进执行图」不可能各写一套规则而悄悄分叉。
 * 无取代时返回源图（逐字深拷贝），与改动前的行为一致。
 */
export function deriveExpectedTaskGraph(source: PlanRevisionSnapshot, replacedBy: Map<string, string>): RewiredTaskGraph {
  return {
    executionDag: rewireExecutionDag(source.executionDag, replacedBy),
    taskHierarchy: rewireTaskHierarchy(source.taskHierarchy, replacedBy),
  };
}

/**
 * 草稿一致性守卫（纯）：被接受的决定的 authorizedTarget 所界定的新计划草稿，
 * 必须逐项反映提案/补丁——包括 ADR 0003 D1 的任务集增量。
 *
 * 顺序：先校验增量本身（形状与引用 -> task_set_delta_invalid），再逐项比对推导结果
 * （任务集、义务承担者、验收语义、执行 DAG 与层级 -> draft_mismatch）。任何不匹配都返回
 * issue，调用方零写入。参数顺序沿用既有调用点：(proposal, decision, draft, source)。
 *
 * 检查面（RW-07 起）：目标正文、任务集（源 + 增量）、**指派集合（源 + 增量的 assignment）**、
 * 义务承担者与验收语义、执行 DAG 与层级。
 *
 * 边界（写清，因为这里只检查、不代替调用方处置）：
 *   1. 被取代任务不得再被下游依赖——新 revision 的 executionDag 与 taskHierarchy 必须等于
 *      「源图经 deriveExpectedTaskGraph 重指」的结果（见 rewireExecutionDag 的注释：
 *      superseded 任务永远不 satisfied，留着这条边会把 Goal 永久卡住）；
 *   2. 取消（cancelTask，无取代者）的任务若仍被下游依赖，本函数一律拒绝（它没有取代者，
 *      重指结果与被依赖的事实直接矛盾）。调用方要么不接受这次取消，要么由提案显式给出新的
 *      依赖目标（改由取代者或其它任务承担该前驱），不允许静默留下悬空前驱；
 *   3. 无任务集增量的草稿必须与源 revision 逐字相同（沿用旧行为，见本函数末段）。
 */
/**
 * RW-10（P8）：一致性 issue 里「越过了人的决定边界」那一类的**唯一前缀**。
 * 生产者（本文件的三条 obligation_semantics_forbidden issue）与消费者（守卫与自动受理入口的
 * 拒绝码归因）读同一个常量，避免一处改文字、另一处漏判。
 */
export const OBLIGATION_SEMANTICS_FORBIDDEN_PREFIX = "obligation_semantics_forbidden";

/**
 * RW-10（P8）：草稿一致性 issue → 既有守卫拒绝码的**唯一归因实现**。
 *
 * 为什么需要它：applyPlanChange 的守卫 f2 与返工自动受理入口的落账前预检跑的是同一个
 * draftConsistencyIssues，但两者此前各自决定拒绝码——守卫区分 obligation_semantics_forbidden 与
 * draft_mismatch，受理入口却把所有草稿不一致压成一个 invalid，于是「越过人的决定边界」这条
 * 专用信息在回执里丢失。现在两边调用同一个函数，码只有一个出处。
 *
 * 返回 null 表示没有 issue（不是拒绝）。task_set_delta_invalid 不在这里归因：增量本身的形状由
 * checkTaskSetDelta 在更早的守卫 f1 判定，调用方先跑它。
 */
export function draftAdmissionRejectionCode(issues: string[]): "obligation_semantics_forbidden" | "draft_mismatch" | null {
  if (issues.length === 0) return null;
  return issues.some((issue) => issue.startsWith(OBLIGATION_SEMANTICS_FORBIDDEN_PREFIX))
    ? "obligation_semantics_forbidden"
    : "draft_mismatch";
}

export function draftConsistencyIssues(
  proposal: PlanProposalV1,
  decision: UserDecisionV1,
  draft: NewPlanDraft,
  source: PlanRevisionSnapshot,
): string[] {
  const issues: string[] = [];
  if (draft.objective !== decision.authorizedTarget.newObjective) {
    issues.push("objective does not match the decision authorized target");
  }
  if (draft.objective !== proposal.patch.patchDraft.objective) {
    issues.push("objective does not match the proposal patch objective");
  }
  if (draft.planRevision !== proposal.sourcePlanRevision + 1) {
    issues.push(`planRevision ${draft.planRevision} != source ${proposal.sourcePlanRevision} + 1`);
  }

  const taskDelta = proposal.patch.patchDraft.taskSetDelta ?? null;
  const deltaCheck = checkTaskSetDelta(taskDelta, source);
  if (!deltaCheck.ok) issues.push(...deltaCheck.issues);
  const derived = deriveTaskSet(source, taskDelta);
  const expectedObligations = deriveObligationSet(source, taskDelta, derived.replacedBy, proposal.patch.patchDraft.obligationDeltas);

  // ADR 0003 D1 第 2 条：新任务集必须等于「源 revision 任务集 + 增量」的确定性推导结果。
  // 草稿自带 tasks 时逐项比对；旧调用方不带 tasks 时按「任务集继承自源 revision」比对。
  const draftTasks: RuntimeTask[] = Array.isArray(draft.tasks)
    ? (draft.tasks as RuntimeTask[])
    : source.tasks.map((t) => cloneTask(t));
  if (draftTasks.length !== derived.tasks.length) {
    issues.push(`tasks: draft task set has ${draftTasks.length} task(s); the source revision plus the delta derives ${derived.tasks.length}`);
  }
  const draftById = new Map(draftTasks.map((t) => [t.taskId, t]));
  const derivedById = new Map(derived.tasks.map((t) => [t.taskId, t]));
  for (const task of derived.tasks) {
    const candidate = draftById.get(task.taskId);
    if (candidate === undefined) {
      issues.push(`task ${task.taskId}: missing from the draft task set (the delta never removes tasks, it only changes their disposition)`);
    } else if (canonicalJson(candidate) !== canonicalJson(task)) {
      issues.push(`task ${task.taskId}: draft definition differs from the source revision plus the task set delta`);
    }
  }
  for (const task of draftTasks) {
    if (!derivedById.has(task.taskId)) {
      issues.push(`task ${task.taskId}: present in the draft but not derived from the source revision plus the task set delta`);
    }
  }

  // RW-07：指派与新任务同属一个 revision。草稿的 assignments 必须逐项等于「源指派 + 增量的
  // assignment」（顺序不承载语义，按 taskId 索引比较），且不得指向不存在或非 work 的任务、
  // 不得给同一任务两条指派。缺省（null／未提供）沿用源指派，与 tasks 的既有约定一致。
  const derivedAssignments = deriveTaskAssignments(source, taskDelta);
  const draftAssignments: PlanTaskAssignment[] = Array.isArray(draft.assignments)
    ? (draft.assignments as PlanTaskAssignment[])
    : revisionAssignments(source);
  issues.push(...assignmentConsistencyIssues(draftAssignments, derivedAssignments, derivedById));

  // 义务：新 revision 的义务集必须逐项等于「源义务 + 任务集增量换人 + 提案的义务增量」。
  // 这条比对同时覆盖「义务正文/验收语义被任务集增量改写」——推导结果里它们逐字复制，
  // 任何改写都会在这里成为 draft_mismatch。
  const sourceObById = new Map(source.obligations.map((o) => [o.obligationId, o]));
  const expectedById = new Map(expectedObligations.map((o) => [o.obligationId, o]));
  const targetObById = new Map(draft.obligations.map((o) => [o.obligationId, o]));
  const deltaById = new Map(proposal.patch.patchDraft.obligationDeltas.map((d) => [d.obligationId, d]));
  if (canonicalJson(draft.obligations) !== canonicalJson(expectedObligations)) {
    for (const o of source.obligations) {
      if (!targetObById.has(o.obligationId) && expectedById.has(o.obligationId)) {
        issues.push(`obligation ${o.obligationId}: missing from the draft (the source revision plus the deltas keeps it)`);
      }
    }
    for (const expected of expectedObligations) {
      const t = targetObById.get(expected.obligationId);
      if (t === undefined) continue;
      const sourceOb = sourceObById.get(expected.obligationId);
      if (sourceOb === undefined) continue;
      if (canonicalJson(t) === canonicalJson(expected)) continue;
      // 任务集增量只能换承担者：义务正文、等级与验收语义属于
      // CoordinationPolicyContentV1.scope.changesRequireHumanDecision，必须由人的决定
      // 走 proposal 的 obligationDelta，不能由增量改写。下面三条带固定前缀，
      // 供 applyPlanChange 用专用拒绝码把它与普通草稿不一致区分开。
      if (canonicalJson(t.verificationRequirements) !== canonicalJson(expected.verificationRequirements)) {
        issues.push(`${OBLIGATION_SEMANTICS_FORBIDDEN_PREFIX} obligation ${expected.obligationId}: verification requirements must keep their exact semantics`);
      } else if (t.title !== expected.title) {
        issues.push(`${OBLIGATION_SEMANTICS_FORBIDDEN_PREFIX} obligation ${expected.obligationId}: the obligation text may only change through an explicit proposal obligation delta`);
      } else if (t.requirementLevel !== expected.requirementLevel) {
        issues.push(`${OBLIGATION_SEMANTICS_FORBIDDEN_PREFIX} obligation ${expected.obligationId}: the requirement level may not change`);
      } else if (canonicalJson(t.taskIds) !== canonicalJson(expected.taskIds)) {
        issues.push(`obligation ${expected.obligationId}: task carriers must be derived from the task set delta (expected ${expected.taskIds.join(",") || "-"}, got ${t.taskIds.join(",") || "-"})`);
      } else {
        issues.push(`obligation ${expected.obligationId}: draft obligation differs from the deterministic derivation`);
      }
    }
    for (const t of draft.obligations) {
      if (!expectedById.has(t.obligationId)) {
        issues.push(`obligation ${t.obligationId}: present in the draft but not derived from the source revision plus the deltas`);
      }
    }
  }
  for (const o of source.obligations) {
    const d = deltaById.get(o.obligationId);
    if (d?.action === "remove" && targetObById.has(o.obligationId)) {
      issues.push(`obligation ${o.obligationId}: remove delta but obligation still present`);
    }
    if (d?.action === "change") {
      const t = targetObById.get(o.obligationId);
      if (t === undefined) issues.push(`obligation ${o.obligationId}: change delta but obligation absent`);
      else if (t.title !== (d.newText ?? o.title)) {
        issues.push(`obligation ${o.obligationId}: change delta allows only a title change`);
      }
    }
    if (d?.action === "add" && sourceObById.has(o.obligationId)) {
      issues.push(`obligation ${o.obligationId}: add delta but obligation already exists in source`);
    }
  }
  for (const d of proposal.patch.patchDraft.obligationDeltas) {
    if (d.action === "add" && sourceObById.has(d.obligationId)) {
      issues.push(`obligation ${d.obligationId}: add delta but obligation exists in source`);
    }
  }

  // 层级与执行 DAG：新 revision 必须等于「源图 + 取代关系」经唯一权威重指规则推导出的结果。
  // 为什么不能只做悬空引用检查：被取代任务在新 revision 里仍然存在（只是 superseded），
  // 悬空检查放行它，而调度与归约要求前驱 satisfied（task-eligibility:78-96、
  // goal-phase:372-375），于是下游任务永久 blocked、Goal 无法归约为 RUNNING。因此这里比对的是
  // 重指后的**边集合**本身：漏一条重指边、多一条重指边、把边指向不存在的任务，都要拒绝。
  const expectedGraph = deriveExpectedTaskGraph(source, derived.replacedBy);
  const expectedDagEdges = new Set(expectedGraph.executionDag.dependsOn.map((e) => canonicalJson(e as never)));
  const expectedHierarchyEdges = new Set(expectedGraph.taskHierarchy.parentOf.map((e) => canonicalJson(e as never)));
  const derivedTaskIds = new Set(derived.tasks.map((t) => t.taskId));

  // 草稿未携带（null）表示「沿用源图」，与 inheritFromSource 的语义一致；此时以源图为草稿。
  const draftHierarchy: TaskHierarchy =
    draft.taskHierarchy === null || draft.taskHierarchy === undefined ? source.taskHierarchy : draft.taskHierarchy;
  const draftDag: RuntimeExecutionDAG =
    draft.executionDag === null || draft.executionDag === undefined ? source.executionDag : draft.executionDag;

  const draftHierarchyEdges = new Set(draftHierarchy.parentOf.map((e) => canonicalJson(e as never)));
  for (const e of draftHierarchy.parentOf) {
    const key = canonicalJson(e as never);
    if (!derivedTaskIds.has(e.parentTaskId) || !derivedTaskIds.has(e.childTaskId)) {
      issues.push(`hierarchy edge ${e.parentTaskId}->${e.childTaskId}: dangling task ref`);
    } else if (!expectedHierarchyEdges.has(key)) {
      issues.push(
        `hierarchy edge ${e.parentTaskId}->${e.childTaskId}: not derived from the source hierarchy by re-pointing replaced tasks to their replacement`,
      );
    }
  }
  for (const expected of expectedGraph.taskHierarchy.parentOf) {
    if (!draftHierarchyEdges.has(canonicalJson(expected as never))) {
      issues.push(
        `hierarchy edge ${expected.parentTaskId}->${expected.childTaskId}: missing from the draft (the source hierarchy now points at the replacement task)`,
      );
    }
  }

  const draftDagEdges = new Set(draftDag.dependsOn.map((e) => canonicalJson(e as never)));
  for (const e of draftDag.dependsOn) {
    const key = canonicalJson(e as never);
    if (!derivedTaskIds.has(e.taskId) || !derivedTaskIds.has(e.dependsOnId)) {
      issues.push(`dag edge ${e.taskId}->${e.dependsOnId}: dangling task ref`);
    } else if (!expectedDagEdges.has(key)) {
      // 这条边两边都存在，但不是重指推导出来的：典型形态是下游仍在依赖被取代任务。
      issues.push(
        `dag edge ${e.taskId}->${e.dependsOnId}: not derived from the source execution DAG by re-pointing replaced tasks to their replacement` +
          ` (a superseded task never becomes satisfied, so a downstream task waiting on it would stay blocked forever)`,
      );
    }
  }
  for (const expected of expectedGraph.executionDag.dependsOn) {
    if (!draftDagEdges.has(canonicalJson(expected as never))) {
      issues.push(
        `dag edge ${expected.taskId}->${expected.dependsOnId}: missing from the draft (the source execution DAG now points at the replacement task)`,
      );
    }
  }
  if (draft.stages !== null && draft.stages !== undefined) {
    const stageIds = new Set(draft.stages.map((s) => s.stageId));
    for (const t of draftTasks) {
      if (t.stageId !== undefined && !stageIds.has(t.stageId)) {
        issues.push(`task ${t.taskId}: dangling stage ref ${t.stageId}`);
      }
    }
  }
  return issues;
}
