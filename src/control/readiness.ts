/**
 * P1-03 Control entry: dispatch readiness (read-only eligibility evaluation).
 *
 * ZERO-WRITE: this entry only loads canonical aggregates and evaluates the
 * frozen eligibility rule (evaluateTaskEligibility). It never commits.
 *
 * Guard order (all zero-write):
 *   1. Goal exists (else not_found/goal);
 *   2. Workspace exists (else not_found/workspace);
 *   3. an accepted PlanRevision exists (goal.activePlanRevision non-null AND
 *      loadable — else not_found/plan);
 *   4. evaluateTaskEligibility over the loaded facts -> status ready with the
 *      exact eligibility result (eligible or reasons). "ready" is returned even
 *      for an ineligible task so the caller can inspect WHY (readiness is a
 *      diagnostic, not a gate — the gate is claimTask's ineligible rejection).
 *
 * Resource check: the lease is ALWAYS checked. The declared budget is optional
 * in a readiness query; when absent we treat the budget dimension as available
 * (a large tokenBudget, no deadline) so only the lease gates readiness. When a
 * budget IS supplied it is honored verbatim (tokenBudget>0, deadline not past).
 */
import type {
  DispatchReadinessFacts,
  DispatchReadinessQuery,
  DispatchReadinessResult,
  TaskEligibility,
  TaskLeaseSnapshot,
} from "../contracts/dispatch.js";
import { evaluateTaskEligibility, taskLeaseRefFor } from "../contracts/dispatch.js";
import type { GoalSnapshot } from "../contracts/ledger.js";
import type { PlanRevisionSnapshot, PlanRevisionRef } from "../contracts/plan.js";
import type { ControlEngineDeps } from "./control-engine.js";

const BUDGET_ABSENT_TOKEN_BUDGET = Number.MAX_SAFE_INTEGER;

export async function evaluateDispatchReadiness(
  deps: ControlEngineDeps,
  query: DispatchReadinessQuery,
): Promise<DispatchReadinessResult> {
  const projectId = query.projectId;
  const goalId = query.goalId;
  const taskId = query.taskId;

  // Guard 1: Goal.
  const goalRef = { aggregateType: "Goal" as const, projectId, goalId };
  const goalResult = await deps.ledger.load(goalRef);
  if (goalResult.status === "not_found") {
    return { status: "not_found", code: "goal" };
  }
  const goal = goalResult.snapshot as GoalSnapshot;

  // Guard 2: Workspace (the goal's linked workspace at its canonical revision).
  const workspaceRef = goal.workspaceRef;
  const workspaceResult = await deps.ledger.load(workspaceRef);
  if (workspaceResult.status === "not_found") {
    return { status: "not_found", code: "workspace" };
  }
  const workspaceRevision = workspaceResult.snapshot.revision;

  // Guard 3: accepted PlanRevision (goal.activePlanRevision -> exact pin load).
  const planRef = goal.activePlanRevision;
  let plan: PlanRevisionSnapshot | null = null;
  if (planRef === null) {
    return { status: "not_found", code: "plan" };
  }
  const planResult = await deps.ledger.load(planRef);
  if (planResult.status === "not_found") {
    return { status: "not_found", code: "plan" };
  }
  plan = planResult.snapshot as PlanRevisionSnapshot;

  // Lease (always checked).
  const leaseRef = taskLeaseRefFor(projectId, goalId, taskId);
  const leaseResult = await deps.ledger.load(leaseRef);
  const leaseSnapshot =
    leaseResult.status === "found" && leaseResult.snapshot.ref.aggregateType === "TaskLease"
      ? (leaseResult.snapshot as TaskLeaseSnapshot)
      : null;

  const facts: DispatchReadinessFacts = {
    projectId,
    goalId,
    goalDesiredState: goal.desiredState,
    goalActivePlanRevision: goal.activePlanRevision,
    plan,
    lease: leaseSnapshot
      ? { status: "leased", holderRunId: leaseSnapshot.holderRunId, grantedAt: leaseSnapshot.grantedAt }
      : { status: "none" },
    resource: {
      tokenBudget: query.budget ? query.budget.tokenBudget : BUDGET_ABSENT_TOKEN_BUDGET,
      deadline: query.budget ? query.budget.deadline : null,
      now: deps.now(),
    },
  };

  const eligibility: TaskEligibility = evaluateTaskEligibility(facts, taskId);

  return {
    status: "ready",
    eligibility,
    goalRevision: goal.revision,
    workspaceRevision,
    planRef: goal.activePlanRevision as PlanRevisionRef,
  };
}
