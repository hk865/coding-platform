/**
 * P1-07 control-plane addition (signatures unchanged; P1-03 frozen shapes
 * untouched): the DAG eligibility check reads the ACCEPTED PLAN SNAPSHOT,
 * whose task phases are plan-declarations and never move. This helper derives
 * the LIVE phase view — task phases overlaid from the canonical
 * TaskReduction snapshots (the ONLY writer of satisfaction is P1-04's
 * reduceTask; the plan snapshot stays immutable).
 *
 * Mapping (frozen): reduction verifying->verifying, blocked->blocked,
 * failed->failed, satisfied->satisfied. No reduction -> plan phase verbatim.
 * ZERO-WRITE, READ-ONLY: readiness and claim may use the derived view; the
 * canonical plan/reduction aggregates are never touched.
 */
import type { StateLedger } from "../contracts/ledger.js";
import type { PlanRevisionSnapshot, Phase } from "../contracts/plan.js";
import type { TaskReductionPhase, TaskReductionSnapshot } from "../contracts/reduction.js";

export function taskReductionPhaseToPlanPhase(phase: TaskReductionPhase): Phase {
  switch (phase) {
    case "satisfied":
      return "satisfied";
    case "verifying":
      return "verifying";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
  }
}

/** LIVE plan view: same snapshot with task phases overlaid from TaskReduction. */
export async function loadLivePlan(
  ledger: StateLedger,
  plan: PlanRevisionSnapshot,
): Promise<PlanRevisionSnapshot> {
  let changed = false;
  const tasks = [];
  for (const task of plan.tasks) {
    const reductionResult = await ledger.load({
      aggregateType: "TaskReduction",
      projectId: plan.goalRef.projectId,
      goalId: plan.goalRef.goalId,
      taskId: task.taskId,
    });
    if (
      reductionResult.status === "found" &&
      reductionResult.snapshot.ref.aggregateType === "TaskReduction"
    ) {
      const livePhase = taskReductionPhaseToPlanPhase(
        (reductionResult.snapshot as TaskReductionSnapshot).phase,
      );
      changed = changed || livePhase !== task.phase;
      tasks.push({ ...task, phase: livePhase });
    } else {
      tasks.push(task);
    }
  }
  if (!changed) return plan;
  return { ...plan, tasks };
}
