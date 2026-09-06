/**
 * P1-03 Control entry: unique claim (dispatch intent + lease + attempt + run).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN). Guard order (all
 * zero-write except the single atomic dispatch-claim commit):
 *   1. schema validation (validateDispatchClaimCommand) -> invalid;
 *   2. Goal exists (else not_found) and its Workspace exists (else not_found);
 *   3. evaluateTaskEligibility over loaded facts (goal/workspace/plan/lease/
 *      resource = command budget + now). A structural ineligibility (any reason
 *      other than resource_unavailable/leased) -> rejected(ineligible, issues),
 *      zero write.
 *   4. The ONLY structural resource signal is an existing lease. If that lease
 *      is held by a DIFFERENT run the claim is a competing claim -> surfaced as
 *      revision_conflict (the loser, zero write) BEFORE the commit; if it is the
 *      SAME run (an idempotent replay of this exact claim, or the caller's own
 *      prior claim) we proceed to the commit and let the ledger's idempotency
 *      replay win (committed/replayed) — replay priority over CAS.
 *   5. Deterministic footprint: buildDispatchClaimLedgerCommit (fold-equality
 *      with the shared fixture builder, given the same ids), then
 *      ledger.commit and map the receipt (committed/replayed vs rejected:
 *      invalid/revision_conflict/idempotency_conflict/unavailable).
 */
import type {
  DispatchClaimCommand,
  DispatchClaimReceipt,
  DispatchReadinessFacts,
  TaskEligibility,
  TaskLeaseSnapshot,
} from "../contracts/dispatch.js";
import {
  dispatchOutboxRefFor,
  evaluateTaskEligibility,
  runRefFor,
  taskAttemptRefFor,
  taskLeaseRefFor,
} from "../contracts/dispatch.js";
import { loadLivePlan } from "./dispatch-facts.js";
import type { LedgerCommitReceipt } from "../contracts/ledger.js";
import type { GoalSnapshot } from "../contracts/ledger.js";
import type { PlanRevisionSnapshot, PlanRevisionRef } from "../contracts/plan.js";
import { validateDispatchClaimCommand } from "../contracts/validation.js";
import { buildDispatchClaimLedgerCommit } from "../contracts/fixtures/dispatch-fixtures.js";
import type { ControlEngineDeps } from "./control-engine.js";

function isLeaseOnly(eligibility: TaskEligibility): boolean {
  if (eligibility.eligible) return false;
  return eligibility.reasons.every(
    (r) => r.code === "resource_unavailable" && r.detail === "leased",
  );
}

async function claimTaskImpl(
  deps: ControlEngineDeps,
  command: DispatchClaimCommand,
): Promise<DispatchClaimReceipt> {
  // Guard 1: schema validation.
  const validationIssues = validateDispatchClaimCommand(command);
  if (validationIssues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const projectId = command.identity.projectId;
  const goalId = command.payload.goalId;
  const taskId = command.aggregateId;

  // Guard 2: ref resolution (Goal then its Workspace).
  const goalRef = { aggregateType: "Goal" as const, projectId, goalId };
  const goalResult = await deps.ledger.load(goalRef);
  if (goalResult.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const goal = goalResult.snapshot as GoalSnapshot;
  const workspaceRef = goal.workspaceRef;
  const workspaceResult = await deps.ledger.load(workspaceRef);
  if (workspaceResult.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const workspaceRevision = workspaceResult.snapshot.revision;
  const workspaceId = workspaceRef.workspaceId;

  // Guard 3: accepted PlanRevision (for eligibility + the deterministic fold).
  const planRef: PlanRevisionRef | null = goal.activePlanRevision;
  let plan: PlanRevisionSnapshot | null = null;
  if (planRef !== null) {
    const planResult = await deps.ledger.load(planRef);
    if (planResult.status === "found") {
      plan = await loadLivePlan(deps.ledger, planResult.snapshot as PlanRevisionSnapshot);
    }
  }

  // Lease.
  const leaseRef = taskLeaseRefFor(projectId, goalId, taskId);
  const leaseResult = await deps.ledger.load(leaseRef);
  const leaseSnapshot: TaskLeaseSnapshot | null =
    leaseResult.status === "found" && leaseResult.snapshot.ref.aggregateType === "TaskLease"
      ? (leaseResult.snapshot as TaskLeaseSnapshot)
      : null;
  const lease = leaseSnapshot
    ? { status: "leased" as const, holderRunId: leaseSnapshot.holderRunId, grantedAt: leaseSnapshot.grantedAt }
    : { status: "none" as const };

  const facts: DispatchReadinessFacts = {
    projectId,
    goalId,
    goalDesiredState: goal.desiredState,
    goalActivePlanRevision: goal.activePlanRevision,
    plan,
    lease,
    resource: {
      tokenBudget: command.payload.budget.tokenBudget,
      deadline: command.payload.budget.deadline,
      now: deps.now(),
    },
  };
  const eligibility: TaskEligibility = evaluateTaskEligibility(facts, taskId);

  if (!eligibility.eligible) {
    if (isLeaseOnly(eligibility)) {
      // The only structural blocker is an existing lease. A competing claimant
      // (different run) loses as revision_conflict; the owner's own replay
      // proceeds so the ledger's idempotency can return committed/replayed.
      if (leaseSnapshot !== null && leaseSnapshot.holderRunId !== command.payload.runId) {
        return {
          status: "rejected",
          commandId: command.commandId,
          code: "revision_conflict",
          currentRevision: leaseSnapshot.revision,
        };
      }
      // Self-lease: fall through to the commit; ledger decides replay vs conflict.
    } else {
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "ineligible",
        issues: eligibility.reasons,
      };
    }
  }

  if (planRef === null) {
    // Unreachable for an eligible claim (plan_not_accepted is structural), but
    // keep the fold safe: a claim can never proceed without an accepted plan.
    return { status: "rejected", commandId: command.commandId, code: "ineligible", issues: eligibility.reasons };
  }

  // Guard 5: deterministic fold + atomic commit (fold-equality with the fixture
  // builder — the ledger validator + CAS/idempotency resolve the outcome).
  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildDispatchClaimLedgerCommit(command, {
    eventId,
    occurredAt,
    workspaceId,
    planRef,
    workspaceRevision,
  });

  const receipt = await deps.ledger.commit(batch);
  return mapClaimReceipt(receipt, command);
}

function mapClaimReceipt(
  receipt: LedgerCommitReceipt,
  command: DispatchClaimCommand,
): DispatchClaimReceipt {
  if (receipt.status === "committed") {
    const projectId = command.identity.projectId;
    const goalId = command.payload.goalId;
    const taskId = command.aggregateId;
    const attemptId = command.payload.attemptId;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      leaseRef: taskLeaseRefFor(projectId, goalId, taskId),
      attemptRef: taskAttemptRefFor(projectId, goalId, taskId, attemptId),
      runRef: runRefFor(projectId, goalId, command.payload.runId),
      outboxRef: dispatchOutboxRefFor(projectId, goalId, taskId, attemptId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }

  switch (receipt.code) {
    case "invalid_commit":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "idempotency_conflict":
      return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
    case "unavailable":
      return { status: "rejected", commandId: command.commandId, code: "unavailable" };
    case "not_empty":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "revision_conflict": {
      const target = receipt.currentVersions?.find(
        (v) =>
          v.ref.aggregateType === "TaskLease" &&
          v.ref.projectId === command.identity.projectId &&
          v.ref.goalId === command.payload.goalId &&
          v.ref.taskId === command.aggregateId,
      );
      const currentRevision = target?.revision ?? receipt.currentVersions?.[0]?.revision;
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "revision_conflict",
        ...(currentRevision !== undefined ? { currentRevision } : {}),
      };
    }
  }
}

export function claimTask(
  deps: ControlEngineDeps,
  command: DispatchClaimCommand,
): Promise<DispatchClaimReceipt> {
  return claimTaskImpl(deps, command);
}
