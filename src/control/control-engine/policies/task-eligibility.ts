/** Control-owned deterministic domain policy. */
import type { Phase } from "../../../contracts/plan.js";
import type { DispatchReadinessFacts, TaskIneligibilityReason, TaskEligibility } from "../../../contracts/dispatch.js";



/**
 * Frozen eligibility rule (Acceptance 1):
 *   - goal desiredState active;
 *   - an accepted PlanRevision exists;
 *   - task is in the plan, taskKind = work (gates are reduced by evidence, P1-04);
 *   - disposition = active (desired state);
 *   - no Blocker: phase !== blocked, and phase is dispatchable (pending|ready);
 *   - EVERY explicit DAG hard dependency (dependsOn) target phase === "satisfied";
 *   - resource available: no active lease, positive tokenBudget, deadline not passed.
 * Reasons are accumulated in deterministic order; eligible <=> reasons = [].
 */
export function evaluateTaskEligibility(
  facts: DispatchReadinessFacts,
  taskId: string,
): TaskEligibility {
  const reasons: TaskIneligibilityReason[] = [];

  if (facts.goalDesiredState !== "active") {
    reasons.push({
      code: "goal_not_active",
      message: "goal desiredState is not active: " + String(facts.goalDesiredState),
    });
  }
  if (facts.goalActivePlanRevision === null || facts.plan === null) {
    reasons.push({ code: "plan_not_accepted", message: "goal has no accepted PlanRevision" });
  }

  const plan = facts.plan;
  if (plan !== null) {
    const task = plan.tasks.find((t) => t.taskId === taskId);
    if (task === undefined) {
      reasons.push({
        code: "task_not_found",
        taskId,
        message: "task is not part of the accepted plan",
      });
    } else {
      if (task.taskKind !== "work") {
        reasons.push({
          code: "task_kind_not_work",
          taskId,
          taskKind: task.taskKind,
          message: "only work tasks are dispatched; gate evidence reduction is P1-04",
        });
      }
      if (task.disposition !== "active") {
        reasons.push({
          code: "task_not_active",
          taskId,
          disposition: task.disposition,
          message: "task disposition is not active (desired state)",
        });
      }
      if (task.phase === "blocked") {
        reasons.push({
          code: "task_phase_not_dispatchable",
          taskId,
          phase: task.phase,
          blocked: true,
          message: "task is blocked",
        });
      } else if (task.phase !== "pending" && task.phase !== "ready") {
        reasons.push({
          code: "task_phase_not_dispatchable",
          taskId,
          phase: task.phase,
          blocked: false,
          message: "task phase is not dispatchable (pending|ready)",
        });
      }

      const unsatisfied = plan.executionDag.dependsOn
        .filter((edge) => edge.taskId === taskId)
        .map((edge) => {
          const dep = plan.tasks.find((t) => t.taskId === edge.dependsOnId);
          return {
            dependsOnId: edge.dependsOnId,
            requires: edge.requires,
            phase: (dep?.phase ?? "missing") as Phase | "missing",
          };
        })
        .filter((dep) => dep.phase !== "satisfied");
      if (unsatisfied.length > 0) {
        reasons.push({
          code: "deps_unsatisfied",
          taskId,
          deps: unsatisfied,
          message: unsatisfied.map((d) => d.dependsOnId + ":" + d.phase).join(", "),
        });
      }
    }
  }

  if (facts.lease.status === "leased") {
    reasons.push({
      code: "resource_unavailable",
      taskId,
      detail: "leased",
      message: "task already has an active lease (holder run " + facts.lease.holderRunId + ")",
    });
  }
  if (!Number.isSafeInteger(facts.resource.tokenBudget) || !(facts.resource.tokenBudget > 0)) {
    reasons.push({
      code: "resource_unavailable",
      taskId,
      detail: "budget_exhausted",
      message: "tokenBudget is not a positive integer",
    });
  }
  if (facts.resource.deadline !== null && facts.resource.deadline < facts.resource.now) {
    reasons.push({
      code: "resource_unavailable",
      taskId,
      detail: "deadline_passed",
      message: "deadline " + facts.resource.deadline + " is before now",
    });
  }

  return reasons.length === 0 ? { eligible: true, reasons: [] } : { eligible: false, reasons };
}