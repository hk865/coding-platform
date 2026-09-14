/** Control-owned deterministic domain policy. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import type { TaskDispositionRow } from "../../../contracts/goal-change.js";



/** Deterministic per-task obligation/VR signature within one plan snapshot. */
function obligationSignatureFor(plan: import("../../../contracts/plan.js").PlanRevisionSnapshot, taskId: string): string {
  const mapped = plan.obligations
    .filter((o) => o.taskIds.includes(taskId))
    .map((o) => ({
      obligationId: o.obligationId,
      title: o.title,
      requirementLevel: o.requirementLevel,
      taskIds: o.taskIds,
      verificationRequirements: o.verificationRequirements.map((v) => ({ requirementId: v.requirementId, requirementLevel: v.requirementLevel, kind: v.kind, description: v.description })),
    }))
    .sort((a, b) => (a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0));
  return canonicalJson(mapped);
}


/**
 * Pure disposition computation: which Tasks keep / cancel / replace /
 * reverify / resume when the active plan revision changes.
 */
export function computeTaskDispositions(
  source: import("../../../contracts/plan.js").PlanRevisionSnapshot,
  target: import("../../../contracts/plan.js").PlanRevisionSnapshot,
  pausedTaskIds: string[],
): TaskDispositionRow[] {
  const targetById = new Map(target.tasks.map((t) => [t.taskId, t]));
  const paused = new Set(pausedTaskIds);
  const signatureCache = new Map<string, string>();
  const sourcePlanId = source.ref.planId;
  const targetPlanId = target.ref.planId;
  const signatureFor = (plan: import("../../../contracts/plan.js").PlanRevisionSnapshot, keyId: string, taskId: string): string => {
    let s = signatureCache.get(keyId + "@" + taskId);
    if (s === undefined) {
      s = obligationSignatureFor(plan, taskId);
      signatureCache.set(keyId + "@" + taskId, s);
    }
    return s;
  };
  const rows: TaskDispositionRow[] = [];
  for (const task of source.tasks) {
    // ADR 0003 D1：被取代/取消的任务**仍然留在**新 revision 里（disposition=superseded），
    // 因此不能靠“任务消失”推断处置。这里以记录在任务上的取代关系为准，让处置视图
    // 直接看出“哪个任务被哪个取代、为什么”，而不是从相似度猜一个候选者。
    const targetTask = targetById.get(task.taskId);
    if (targetTask !== undefined && targetTask.disposition === "superseded") {
      const replacedByTaskId = targetTask.replacedByTaskId ?? null;
      rows.push(
        replacedByTaskId === null
          ? { taskId: task.taskId, disposition: "cancel", sourcePlanRef: source.ref, targetPlanRef: target.ref, replacedByTaskId: null, obligationSignatureChanged: true, reason: "cancelled by the accepted plan change (no replacement task declared)" }
          : { taskId: task.taskId, disposition: "replace", sourcePlanRef: source.ref, targetPlanRef: target.ref, replacedByTaskId, obligationSignatureChanged: true, reason: `superseded by task ${replacedByTaskId} (same obligations, same acceptance semantics — only the carrier changed)` },
      );
      continue;
    }
    if (!targetById.has(task.taskId)) {
      const candidates = target.tasks
        .filter((t) => t.taskKind === task.taskKind && t.phase === task.phase && t.requirementLevel === task.requirementLevel && t.scope.kind === task.scope.kind)
        .map((t) => t.taskId);
      if (candidates.length === 1) {
        rows.push({ taskId: task.taskId, disposition: "replace", sourcePlanRef: source.ref, targetPlanRef: target.ref, replacedByTaskId: candidates[0]!, obligationSignatureChanged: true, reason: `replaced by task ${candidates[0]} (same ${task.taskKind}/${task.phase} key)` });
      } else {
        rows.push({ taskId: task.taskId, disposition: "cancel", sourcePlanRef: source.ref, targetPlanRef: target.ref, replacedByTaskId: null, obligationSignatureChanged: true, reason: "removed by the plan change; no unique replacement" });
      }
      continue;
    }
    const changed = signatureFor(source, sourcePlanId, task.taskId) !== signatureFor(target, targetPlanId, task.taskId);
    if (changed) {
      rows.push({ taskId: task.taskId, disposition: "reverify", sourcePlanRef: source.ref, targetPlanRef: target.ref, replacedByTaskId: null, obligationSignatureChanged: true, reason: "obligation(s)/verification requirement(s) changed — evidence must be re-verified" });
    } else if (paused.has(task.taskId)) {
      rows.push({ taskId: task.taskId, disposition: "resume", sourcePlanRef: source.ref, targetPlanRef: target.ref, replacedByTaskId: null, obligationSignatureChanged: false, reason: "task unchanged and was paused at a safe point — may resume" });
    } else {
      rows.push({ taskId: task.taskId, disposition: "keep", sourcePlanRef: source.ref, targetPlanRef: target.ref, replacedByTaskId: null, obligationSignatureChanged: false, reason: "task and obligations unchanged" });
    }
  }
  return rows;
}