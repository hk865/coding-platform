/**
 * P1-04 Control entry: Task/Gate reduction — the ONLY writer of the canonical
 * TaskReduction phase (Worker/Reviewer never touch Task.phase; Goal phase is
 * P1-05).
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN). Frozen flow (all
 * zero-write except the single atomic verification-result commit):
 *   1. schema validation (validateReduceTaskCommand) -> invalid;
 *   2. Goal exists (else not_found); goal.activePlanRevision === null ->
 *      not_found; plan loads (else not_found);
 *   3. task must be part of the plan (task_not_in_plan);
 *   4. load the task evidence index + every Evidence snapshot; load the
 *      TaskLease/Run (run signals: outcome/exitCode of the latest attempt);
 *   5. build the canonical current effectivity tuple (plan pins + canonical
 *      Workspace revision) and run the PURE reduceTaskVerification
 *      (TaskSatisfied formula) — deterministic, no model calls;
 *   6. deterministic fold (buildTaskReductionLedgerCommit with the computed
 *      snapshot) -> ledger.commit -> mapReduceTaskReceipt.
 * Re-reduction with the same state yields the same phase; a fresh command
 * identity/expectedRevision is required after new evidence (idempotency keys
 * are per command — P1-00 discipline).
 */
import type { StateLedger, AggregateSnapshot, GoalSnapshot } from "../contracts/ledger.js";
import type { LedgerCommitReceipt } from "../contracts/ledger.js";
import type { EvidenceSnapshot, EvidenceV1, TaskEvidenceIndexSnapshot } from "../contracts/evidence.js";
import { evidenceRefFor } from "../contracts/evidence.js";
import type { EffectivityAnchorV1 } from "../contracts/evidence.js";
import type { PlanRevisionSnapshot } from "../contracts/plan.js";
import type { RunSnapshot, TaskLeaseSnapshot } from "../contracts/dispatch.js";
import { runRefFor, taskLeaseRefFor } from "../contracts/dispatch.js";
import type { ReduceTaskCommand, ReduceTaskReceipt, RunSignal, TaskReductionSnapshot } from "../contracts/reduction.js";
import { taskReductionRefFor } from "../contracts/reduction.js";
import { reduceTaskVerification, type TaskReductionInput } from "../contracts/reduction.js";
import { validateReduceTaskCommand } from "../contracts/validation.js";
import { buildTaskReductionLedgerCommit, buildTaskReductionSnapshot } from "../contracts/fixtures/evidence-fixtures.js";
import type { ControlEngineDeps } from "./control-engine.js";
import { taskEvidenceIndexRefFor } from "../contracts/evidence.js";

async function reduceTaskImpl(
  deps: ControlEngineDeps,
  command: ReduceTaskCommand,
): Promise<ReduceTaskReceipt> {
  // Guard 1: schema validation (zero write).
  const issues = validateReduceTaskCommand(command);
  if (issues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const projectId = command.identity.projectId;
  const goalId = command.payload.goalId;
  const taskId = command.aggregateId;

  // Guard 2: Goal exists (else not_found); goal.activePlanRevision === null ->
  // not_found; plan loads (else not_found).
  const goalRef = { aggregateType: "Goal" as const, projectId, goalId };
  const goalResult = await deps.ledger.load(goalRef);
  if (goalResult.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const goal = goalResult.snapshot as GoalSnapshot;
  const planRef = goal.activePlanRevision;
  if (planRef === null) {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const planResult = await deps.ledger.load(planRef);
  if (planResult.status === "not_found" || !isPlanRevisionSnapshot(planResult.snapshot)) {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const plan = planResult.snapshot as PlanRevisionSnapshot;

  // Guard 3: task must be part of the plan (task_not_in_plan).
  const task = plan.tasks.find((t) => t.taskId === taskId);
  if (task === undefined) {
    return { status: "rejected", commandId: command.commandId, code: "task_not_in_plan" };
  }

  // Guard 4: load the task evidence index + every Evidence snapshot; load the
  // TaskLease/Run (run signals: outcome/exitCode of the latest attempt).
  const indexResult = await deps.ledger.load(taskEvidenceIndexRefFor(projectId, goalId, taskId));
  const index: TaskEvidenceIndexSnapshot | null =
    indexResult.status === "found" && isTaskEvidenceIndexSnapshot(indexResult.snapshot)
      ? (indexResult.snapshot as TaskEvidenceIndexSnapshot)
      : null;
  const evidence: EvidenceV1[] = [];
  if (index !== null) {
    for (const evidenceId of index.evidenceIds) {
      const evResult = await deps.ledger.load(evidenceRefFor(projectId, evidenceId));
      if (evResult.status === "found" && isEvidenceSnapshot(evResult.snapshot)) {
        evidence.push((evResult.snapshot as EvidenceSnapshot).evidence);
      }
    }
  }

  const leaseResult = await deps.ledger.load(taskLeaseRefFor(projectId, goalId, taskId));
  const lease: TaskLeaseSnapshot | null =
    leaseResult.status === "found" && isTaskLeaseSnapshot(leaseResult.snapshot)
      ? (leaseResult.snapshot as TaskLeaseSnapshot)
      : null;
  let runSignals: RunSignal[] = emptyRunSignals();
  const unreconciledSideEffects: TaskReductionInput["unreconciledSideEffects"] = [];
  if (lease !== null) {
    const runResult = await deps.ledger.load(runRefFor(projectId, goalId, lease.holderRunId));
    if (runResult.status === "found" && isRunSnapshot(runResult.snapshot)) {
      const run = runResult.snapshot as RunSnapshot;
      runSignals = collectRunSignals(run);
      // integrator ruling (frozen sem #9 mapping): an outcome_unknown ENDED
      // run is an EXPLICIT terminal fact (never inferred); as a side effect it
      // blocks satisfaction. It is NEVER a run-failed signal; crashed / a
      // completed+exit!==0 run are run-failed; completed+exit===0 and
      // budget_exhausted / cancelled are neutral (never a satisfaction signal).
      if (run.status === "ended" && run.outcome === "outcome_unknown") {
        unreconciledSideEffects.push({ kind: "outcome_unknown", runRef: run.ref });
      }
    }
  }

  // Guard 5: canonical current effectivity tuple (plan pins + canonical
  // Workspace revision) — the ONLY admissible "current" anchor.
  const workspaceResult = await deps.ledger.load(goal.workspaceRef);
  const workspaceRevision =
    workspaceResult.status === "found" ? workspaceResult.snapshot.revision : 1;
  const currentAnchor = buildCurrentEffectivityAnchor({ plan, workspaceRevision });

  // Guard 6: run the PURE reduceTaskVerification (TaskSatisfied formula) —
  // deterministic, no model calls.
  const input: TaskReductionInput = {
    projectId,
    goalId,
    taskId,
    plan,
    goalActivePlanRevision: planRef,
    currentAnchor,
    evidence,
    runSignals,
    unresolvedFindings: [],
    unreconciledSideEffects,
  };
  const computation = reduceTaskVerification(input);

  // Deterministic fold (buildTaskReductionLedgerCommit with the computed
  // snapshot, revision = expectedRevision + 1) -> ledger.commit -> receipt.
  const reduction: TaskReductionSnapshot = buildTaskReductionSnapshot({
    projectId,
    goalId,
    taskId,
    revision: command.expectedRevision + 1,
    planRef: plan.ref,
    planRevision: plan.planRevision,
    taskKind: task.taskKind,
    requirementLevel: task.requirementLevel,
    disposition: task.disposition,
    phase: computation.phase,
    currentAnchor,
    effectiveEvidenceIds: computation.effectiveEvidenceIds,
    blockingEvidenceIds: computation.blockingEvidenceIds,
    staleEvidenceIds: computation.staleEvidenceIds,
    outOfScopeEvidenceIds: computation.outOfScopeEvidenceIds,
    satisfiedObligationIds: computation.satisfiedObligationIds,
    causes: computation.causes,
    reducedAt: deps.now(),
  });

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const workspaceId = goal.workspaceRef.workspaceId;
  const batch = buildTaskReductionLedgerCommit(command, {
    eventId,
    occurredAt,
    workspaceId,
    reduction,
  });

  const receipt = await deps.ledger.commit(batch);
  return mapReduceTaskReceipt(receipt, command, computation.phase);
}

export function reduceTask(
  deps: ControlEngineDeps,
  command: ReduceTaskCommand,
): Promise<ReduceTaskReceipt> {
  return reduceTaskImpl(deps, command);
}

/** Canonical current effectivity tuple: the plan pins + the canonical
 * Workspace aggregate revision (the ONLY admissible "current" anchor). */
export function buildCurrentEffectivityAnchor(deps: {
  plan: PlanRevisionSnapshot;
  workspaceRevision: number;
}): EffectivityAnchorV1 {
  return {
    schemaVersion: 1,
    planRef: { ...deps.plan.ref },
    planRevision: deps.plan.planRevision,
    workspaceRevision: deps.workspaceRevision,
    pinnedCompletionPolicy: { ...deps.plan.effectiveCompletionPolicy },
    pinnedArchitectureBaseline: { ...deps.plan.effectiveArchitectureBaseline },
  };
}

export function mapReduceTaskReceipt(
  receipt: LedgerCommitReceipt,
  command: ReduceTaskCommand,
  phase: TaskReductionSnapshot["phase"],
): ReduceTaskReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      reductionRef: taskReductionRefFor(
        command.identity.projectId,
        command.payload.goalId,
        command.aggregateId,
      ),
      phase,
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
          v.ref.aggregateType === "TaskReduction" &&
          v.ref.projectId === command.identity.projectId &&
          v.ref.goalId === command.payload.goalId &&
          v.ref.taskId === command.aggregateId,
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

export function collectRunSignals(snapshot: RunSnapshot | null): RunSignal[] {
  if (snapshot === null) return [];
  return [
    {
      runRef: snapshot.ref,
      outcome: snapshot.outcome ?? "outcome_unknown",
      exitCode: snapshot.exitCode,
      terminal: snapshot.status === "ended",
    },
  ];
}

export const inferenceTasks = (input: TaskReductionInput) => reduceTaskVerification(input);

export function isEvidenceSnapshot(snapshot: AggregateSnapshot): snapshot is EvidenceSnapshot {
  return snapshot.ref.aggregateType === "Evidence";
}

export function isTaskEvidenceIndexSnapshot(
  snapshot: AggregateSnapshot,
): snapshot is TaskEvidenceIndexSnapshot {
  return snapshot.ref.aggregateType === "TaskEvidenceIndex";
}

export function isPlanRevisionSnapshot(snapshot: AggregateSnapshot): snapshot is PlanRevisionSnapshot {
  return snapshot.ref.aggregateType === "PlanRevision";
}

export function isTaskLeaseSnapshot(snapshot: AggregateSnapshot): snapshot is TaskLeaseSnapshot {
  return snapshot.ref.aggregateType === "TaskLease";
}

export function isRunSnapshot(snapshot: AggregateSnapshot): snapshot is RunSnapshot {
  return snapshot.ref.aggregateType === "Run";
}

export function emptyRunSignals(): RunSignal[] {
  return [];
}

export async function loadStateLedger(
  ledger: StateLedger,
  ref: import("../contracts/ledger.js").AggregateRef,
): Promise<import("../contracts/ledger.js").SnapshotResult> {
  return ledger.load(ref);
}