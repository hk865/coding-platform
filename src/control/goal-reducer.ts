/**
 * P1-05 Control entry: Goal phase reduction — the ONLY writer of the canonical
 * GoalPhase aggregate (Worker/Reviewer/ReadModel never write a Goal phase;
 * ModuleProgress/StageProgress are projections and are NEVER reducer inputs).
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN). Frozen flow (all
 * zero-write except the single atomic goal-reduction commit):
 *   1. schema validation (validateReduceGoalCommand) -> invalid;
 *   2. Goal exists (else not_found); goal.activePlanRevision may be null
 *      (PLANNING territory — still a valid reduction); plan loads when set
 *      (else not_found);
 *   3. load the CURRENT plan snapshot (tasks/obligations) + per-task
 *      TaskReduction snapshots (point reads; future: summarizer provider);
 *   4. per required obligation build the coverage summary from the P1-04
 *      pure functions (selectEffectiveEvidenceSet per task, then fold an
 *      obligation-level summary: required VRs / covered VRs / blocking /
 *      historical FAIL audit flag / stale / out-of-scope) — current-ANCHOR
 *      applicability ONLY (historical FAIL preserved, never in the guard);
 *   5. identify side effects from Run snapshots (ended + outcome_unknown ->
 *      unreconciled; P1-05 has NO disposal path — reconcileGoalSideEffects
 *      identifies and blocks only);
 *   6. decisions/changePending/decisionNeeds/planning come from the seam
 *      (P1-05: decisions = [], changePending = null, decisionNeeds = [],
 *      planning = { possible: !activePlan, failed: false, blockedReason: null });
 *   7. run the PURE reduceGoalPhase (10-level priority table + §3/§8 guard)
 *      and the DETERMINISTIC renderGoalCompletionExplanation — no model calls;
 *   8. deterministic fold (buildGoalReductionLedgerCommit) -> ledger.commit
 *      -> mapReduceGoalReceipt.
 * Re-reduction with the same state yields the same phase/reason codes; a fresh
 * command identity/expectedRevision is required after facts changed
 * (idempotency keys are per command — P1-00 discipline).
 */
import type { StateLedger, AggregateSnapshot, GoalSnapshot, LedgerCommitReceipt } from "../contracts/ledger.js";
import type { PlanRevisionSnapshot } from "../contracts/plan.js";
import type { TaskReductionSnapshot } from "../contracts/reduction.js";
import type { RunSnapshot } from "../contracts/dispatch.js";
import type { ControlEngineDeps } from "./control-engine.js";
import type {
  ReduceGoalCommand,
  ReduceGoalReceipt,
  GoalReductionInput,
  GoalObligationFact,
  GoalSideEffectFact,
  GoalTaskReductionFact,
  GoalPhaseSnapshot,
} from "../contracts/goal-phase.js";
import {
  goalPhaseRefFor,
  reduceGoalPhase,
  renderGoalCompletionExplanation,
  reconcileGoalSideEffects,
} from "../contracts/goal-phase.js";
import { validateReduceGoalCommand } from "../contracts/validation.js";
import {
  buildGoalPhaseSnapshot,
  buildGoalReductionLedgerCommit,
} from "../contracts/fixtures/goal-phase-fixtures.js";
import { taskReductionRefFor } from "../contracts/reduction.js";
import { runRefFor, taskLeaseRefFor } from "../contracts/dispatch.js";
import {
  taskEvidenceIndexRefFor,
  evidenceRefFor,
  selectEffectiveEvidenceSet,
} from "../contracts/evidence.js";

async function reduceGoalImpl(
  deps: ControlEngineDeps,
  command: ReduceGoalCommand,
): Promise<ReduceGoalReceipt> {
  // Guard 1: schema validation (zero write).
  const issues = validateReduceGoalCommand(command);
  if (issues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const projectId = command.identity.projectId;
  const goalId = command.payload.goalId;

  // Guard 2: Goal exists (else not_found); plan loads when activePlanRevision set.
  const goalResult = await deps.ledger.load({ aggregateType: "Goal", projectId, goalId });
  if (goalResult.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const goal = goalResult.snapshot as GoalSnapshot;
  const planRef = goal.activePlanRevision;
  let plan: PlanRevisionSnapshot | null = null;
  if (planRef !== null) {
    const planResult = await deps.ledger.load(planRef);
    if (planResult.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    plan = planResult.snapshot as PlanRevisionSnapshot;
  }

  // Guard 3-6: facts -> pure input (see header flow). Implemented by lane A.
  const input = await buildGoalReductionInput(deps, {
    projectId,
    goalId,
    goal,
    plan,
  });

  // Guard 7: PURE reduceGoalPhase + deterministic explanation.
  const reduction = reduceGoalPhase(input);
  const explanation = renderGoalCompletionExplanation(reduction, goalId);

  // Guard 8: deterministic fold -> single atomic commit.
  return commitGoalReduction(deps, command, {
    goalId,
    workspaceId: goal.workspaceRef.workspaceId,
    previousPhase: await previousGoalPhase(deps, projectId, goalId),
    phase: reduction.phase,
    reasonCodes: reduction.reasonCodes,
    explanation,
    sideEffectReconciliation: reduction.sideEffectReconciliation,
    planRef,
    reducedAt: deps.now(),
    expectedRevision: command.expectedRevision,
  });
}

export function reduceGoal(
  deps: ControlEngineDeps,
  command: ReduceGoalCommand,
): Promise<ReduceGoalReceipt> {
  return reduceGoalImpl(deps, command);
}

/** Current GoalPhase snapshot revision (0 when never reduced) — CAS window source. */
export async function previousGoalPhase(
  deps: ControlEngineDeps,
  projectId: string,
  goalId: string,
): Promise<import("../contracts/goal-phase.js").GoalPhase | null> {
  const result = await deps.ledger.load(goalPhaseRefFor(projectId, goalId));
  if (result.status === "found" && result.snapshot.ref.aggregateType === "GoalPhase") {
    return (result.snapshot as GoalPhaseSnapshot).phase;
  }
  return null;
}

export async function buildGoalReductionInput(
  deps: ControlEngineDeps,
  refs: { projectId: string; goalId: string; goal: GoalSnapshot; plan: PlanRevisionSnapshot | null },
): Promise<GoalReductionInput> {
  throw new Error("P1-05: not implemented yet (lane A)");
}

/** Deterministic goal-reduction fold target (fold-equality for Control). */
export async function commitGoalReduction(
  deps: ControlEngineDeps,
  command: ReduceGoalCommand,
  deps2: {
    goalId: string;
    workspaceId: string;
    previousPhase: import("../contracts/goal-phase.js").GoalPhase | null;
    phase: import("../contracts/goal-phase.js").GoalPhase;
    reasonCodes: import("../contracts/goal-phase.js").GoalPhaseReasonCode[];
    explanation: import("../contracts/goal-phase.js").GoalCompletionExplanation;
    sideEffectReconciliation: import("../contracts/goal-phase.js").GoalSideEffectReconciliation;
    planRef: import("../contracts/plan.js").PlanRevisionRef | null;
    reducedAt: string;
    expectedRevision: number;
  },
): Promise<ReduceGoalReceipt> {
  const snapshot: GoalPhaseSnapshot = buildGoalPhaseSnapshot({
    projectId: command.identity.projectId,
    goalId: deps2.goalId,
    revision: deps2.expectedRevision + 1,
    planRef: deps2.planRef,
    previousPhase: deps2.previousPhase,
    phase: deps2.phase,
    reasonCodes: deps2.reasonCodes,
    explanation: deps2.explanation,
    sideEffectReconciliation: deps2.sideEffectReconciliation,
    reducedAt: deps2.reducedAt,
  });
  const batch = buildGoalReductionLedgerCommit(command, {
    eventId: deps.eventId(),
    occurredAt: deps2.reducedAt,
    workspaceId: deps2.workspaceId,
    phase: snapshot,
  });
  const receipt = await deps.ledger.commit(batch);
  return mapReduceGoalReceipt(receipt, command, snapshot.phase, snapshot.reasonCodes);
}

export function mapReduceGoalReceipt(
  receipt: LedgerCommitReceipt,
  command: ReduceGoalCommand,
  phase: import("../contracts/goal-phase.js").GoalPhase,
  reasonCodes: import("../contracts/goal-phase.js").GoalPhaseReasonCode[],
): ReduceGoalReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      phaseRef: goalPhaseRefFor(command.identity.projectId, command.payload.goalId),
      phase,
      reasonCodes,
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
      const current = receipt.currentVersions?.find(
        (v) =>
          v.ref.aggregateType === "GoalPhase" &&
          v.ref.projectId === command.identity.projectId &&
          v.ref.goalId === command.payload.goalId,
      );
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "revision_conflict",
        ...(current !== undefined ? { currentRevision: current.revision } : {}),
      };
    }
  }
}

export function isGoalPhaseSnapshot(snapshot: AggregateSnapshot): snapshot is GoalPhaseSnapshot {
  return snapshot.ref.aggregateType === "GoalPhase";
}
