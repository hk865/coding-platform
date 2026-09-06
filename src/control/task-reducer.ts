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
import type { StateLedger, AggregateSnapshot } from "../contracts/ledger.js";
import type { LedgerCommitReceipt } from "../contracts/ledger.js";
import type { EvidenceSnapshot, TaskEvidenceIndexSnapshot } from "../contracts/evidence.js";
import type { EffectivityAnchorV1 } from "../contracts/evidence.js";
import type { PlanRevisionSnapshot } from "../contracts/plan.js";
import type { RunSnapshot, TaskLeaseSnapshot } from "../contracts/dispatch.js";
import type { ReduceTaskCommand, ReduceTaskReceipt, RunSignal, TaskReductionSnapshot } from "../contracts/reduction.js";
import { taskReductionRefFor } from "../contracts/reduction.js";
import { reduceTaskVerification, type TaskReductionInput } from "../contracts/reduction.js";
import { validateReduceTaskCommand } from "../contracts/validation.js";
import { buildTaskReductionLedgerCommit } from "../contracts/fixtures/evidence-fixtures.js";
import type { ControlEngineDeps } from "./control-engine.js";

async function reduceTaskImpl(
  deps: ControlEngineDeps,
  command: ReduceTaskCommand,
): Promise<ReduceTaskReceipt> {
  throw new Error("P1-04 task-reducer: not implemented yet");
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
