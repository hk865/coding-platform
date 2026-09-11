/** Control-owned deterministic domain policy. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import type { Phase } from "../../../contracts/plan.js";
import type { ReplacementEligibilityFacts, ReplacementIneligibilityReason, ReplacementEligibility } from "../../../contracts/handoff.js";



/**
 * FROZEN replacement eligibility (Acceptance "A 过期 lease 与迟到结果不能覆盖
 * B 的新 Attempt"):
 *   - same structural rules as P1-03 eligibility (active goal, accepted plan,
 *     work task, active disposition, dispatchable phase, DAG deps satisfied);
 *   - a PRIOR attempt must exist (a replacement of nothing is ineligible);
 *   - the prior attempt must be ENDED or the prior lease EXPIRED (deadline
 *     passed) — otherwise lease_active;
 *   - the packet must exist, reference the SAME task + same planRef, and carry
 *     the CURRENT canonical workspace revision — a stale/mismatched packet is
 *     explicit (stale_packet / packet_mismatch, zero write) — never silently
 *     reused;
 *   - budget/deadline resource checks are preserved.
 * Deterministic: same facts -> same eligibility; it NEVER writes history.
 */
export function evaluateReplacementEligibility(
  facts: ReplacementEligibilityFacts,
): ReplacementEligibility {
  const reasons: ReplacementIneligibilityReason[] = [];

  if (facts.goalDesiredState !== "active") {
    reasons.push({ code: "goal_not_active", message: "goal desiredState is not active" });
  }
  if (facts.goalActivePlanRevision === null || facts.plan === null) {
    reasons.push({ code: "plan_not_accepted", message: "goal has no accepted PlanRevision" });
  }

  const plan = facts.plan;
  if (plan !== null) {
    const task = plan.tasks.find((t) => t.taskId === facts.taskId);
    if (task === undefined) {
      reasons.push({ code: "task_not_found", taskId: facts.taskId, message: "task is not part of the accepted plan" });
    } else {
      if (task.taskKind !== "work") {
        reasons.push({ code: "task_kind_not_work", taskId: facts.taskId, taskKind: task.taskKind, message: "only work tasks are dispatched" });
      }
      if (task.disposition !== "active") {
        reasons.push({ code: "task_not_active", taskId: facts.taskId, disposition: task.disposition, message: "task disposition is not active" });
      }
      if (task.phase === "blocked" || (task.phase !== "pending" && task.phase !== "ready")) {
        reasons.push({ code: "task_phase_not_dispatchable", taskId: facts.taskId, phase: task.phase, message: "task phase is not dispatchable (pending|ready)" });
      }
      const unsatisfied = plan.executionDag.dependsOn
        .filter((edge) => edge.taskId === facts.taskId)
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
        reasons.push({ code: "deps_unsatisfied", taskId: facts.taskId, deps: unsatisfied, message: "unsatisfied dependencies" });
      }
    }
  }

  if (facts.priorLease.status === "none") {
    reasons.push({ code: "no_prior_attempt", message: "no prior lease — nothing to replace (use claimTask)" });
  } else {
    const ended = facts.priorAttempt?.status === "ended";
    const expired =
      facts.priorLease.expiresAt !== null &&
      facts.priorLease.expiresAt < facts.resource.now;
    if (!ended && !expired) {
      reasons.push({ code: "lease_active", message: "prior attempt is not ended and the prior lease is not expired" });
    }
  }

  if (!facts.packet.present) {
    reasons.push({ code: "packet_not_found", message: "handoff packet is not registered" });
  } else {
    const p = facts.packet;
    if (
      p.projectId !== facts.projectId ||
      p.goalId !== facts.goalId ||
      p.taskId !== facts.taskId ||
      (facts.goalActivePlanRevision !== null &&
        canonicalJson(p.planRef) !== canonicalJson(facts.goalActivePlanRevision)) ||
      (plan !== null && p.taskRevision !== plan.planRevision)
    ) {
      reasons.push({ code: "packet_mismatch", message: "packet references a different task/plan/revision tuple" });
    }
    if (p.workspaceSnapshot.revision !== facts.canonicalWorkspaceRevision) {
      reasons.push({ code: "stale_packet", message: "packet workspace revision is stale — re-project before replacement" });
    }
  }

  if (!Number.isSafeInteger(facts.resource.tokenBudget) || !(facts.resource.tokenBudget > 0)) {
    reasons.push({ code: "resource_unavailable", taskId: facts.taskId, detail: "budget_exhausted", message: "tokenBudget is not a positive integer" });
  }
  if (facts.resource.deadline !== null && facts.resource.deadline < facts.resource.now) {
    reasons.push({ code: "resource_unavailable", taskId: facts.taskId, detail: "deadline_passed", message: "deadline has passed" });
  }

  return reasons.length === 0 ? { eligible: true, reasons: [] } : { eligible: false, reasons };
}