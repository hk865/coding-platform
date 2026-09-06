/**
 * P1-04 Control entry: evidence intake — ONE immutable Evidence + the task
 * evidence index update, atomically.
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN). Guard order (all
 * zero-write except the single atomic evidence-intake commit):
 *   1. schema validation (validateSubmitEvidenceCommand) -> invalid;
 *   2. Goal exists (else not_found) and its Workspace exists (else not_found);
 *   3. the anchor plan must exist (load) and the subject task must be part of
 *      that plan (dangling_ref — deterministic failure, never a default);
 *   4. every coverage entry must reference a VerificationRequirement of an
 *      obligation mapped to the subject task IN THE ANCHOR PLAN
 *      (dangling_ref — deterministic failure);
 *   5. per-task admission cap (MAX_EVIDENCE_PER_TASK) -> evidence_limit_exceeded
 *      (zero write);
 *   6. deterministic fold (buildEvidenceIntakeLedgerCommit — fold-equality with
 *      the shared fixture builder, given the same ids) -> ledger.commit ->
 *      mapEvidenceIntakeReceipt (committed/replayed vs invalid/...).
 * Frozen semantics: claim/observation/verdict; a claim is forced INCONCLUSIVE
 * (a self-report is NEVER evidence PASS); Worker/Reviewer never touch a Task
 * phase; the effectivity anchor is recorded immutably (historical/old-revision
 * evidence is admitted and its applicability is derived, never written back);
 * the Evidence body is body-first in the ArtifactVault (Control only records
 * the reference).
 */
import type { StateLedger, GoalSnapshot, AggregateSnapshot } from "../contracts/ledger.js";
import type { LedgerCommitReceipt } from "../contracts/ledger.js";
import type { EvidenceSnapshot, SubmitEvidenceCommand, SubmitEvidenceReceipt, TaskEvidenceIndexSnapshot } from "../contracts/evidence.js";
import { MAX_EVIDENCE_PER_TASK, evidenceRefFor } from "../contracts/evidence.js";
import { taskEvidenceIndexRefFor } from "../contracts/evidence.js";
import type { PlanRevisionSnapshot } from "../contracts/plan.js";
import { validateSubmitEvidenceCommand } from "../contracts/validation.js";
import { buildEvidenceIntakeLedgerCommit } from "../contracts/fixtures/evidence-fixtures.js";
import type { ControlEngineDeps } from "./control-engine.js";

async function submitEvidenceImpl(
  deps: ControlEngineDeps,
  command: SubmitEvidenceCommand,
): Promise<SubmitEvidenceReceipt> {
  // Guard 1: schema validation (zero write).
  const issues = validateSubmitEvidenceCommand(command);
  if (issues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const evidence = command.payload.evidence;
  const projectId = command.identity.projectId;
  const goalId = evidence.subject.goalId;
  const taskId = evidence.subject.taskId;

  // Guard 2: Goal exists (else not_found) and its Workspace exists (else not_found).
  const goalRef = { aggregateType: "Goal" as const, projectId, goalId };
  const goalResult = await deps.ledger.load(goalRef);
  if (goalResult.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const goal = goalResult.snapshot as GoalSnapshot;
  const workspaceResult = await deps.ledger.load(goal.workspaceRef);
  if (workspaceResult.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const workspaceId = goal.workspaceRef.workspaceId;

  // Guard 3: the anchor plan must exist (load) and the subject task must be
  // part of that plan (dangling_ref — deterministic failure, never a default).
  const anchorPlanRef = evidence.anchor.planRef;
  const planResult = await deps.ledger.load(anchorPlanRef);
  if (planResult.status === "not_found" || !isPlanRevisionSnapshot(planResult.snapshot)) {
    return { status: "rejected", commandId: command.commandId, code: "dangling_ref" };
  }
  const plan = planResult.snapshot as PlanRevisionSnapshot;
  const subjectTask = plan.tasks.find((t) => t.taskId === taskId);
  if (subjectTask === undefined) {
    return { status: "rejected", commandId: command.commandId, code: "dangling_ref" };
  }

  // Guard 4: every coverage entry must reference a VerificationRequirement of
  // an obligation mapped to the subject task IN THE ANCHOR PLAN (dangling_ref).
  const knownKeys = new Set<string>();
  for (const obligation of plan.obligations) {
    if (!obligation.taskIds.includes(taskId)) continue;
    for (const vr of obligation.verificationRequirements) {
      knownKeys.add(obligation.obligationId + "\u0000" + vr.requirementId);
    }
  }
  for (const coverage of evidence.coverage) {
    if (!knownKeys.has(coverage.obligationId + "\u0000" + coverage.requirementId)) {
      return { status: "rejected", commandId: command.commandId, code: "dangling_ref" };
    }
  }

  // Guard 5: per-task admission cap (zero write).
  const indexResult = await deps.ledger.load(taskEvidenceIndexRefFor(projectId, goalId, taskId));
  const priorIndex: TaskEvidenceIndexSnapshot | null =
    indexResult.status === "found" && isTaskEvidenceIndexSnapshot(indexResult.snapshot)
      ? (indexResult.snapshot as TaskEvidenceIndexSnapshot)
      : null;
  if ((priorIndex?.evidenceIds.length ?? 0) >= MAX_EVIDENCE_PER_TASK) {
    return { status: "rejected", commandId: command.commandId, code: "evidence_limit_exceeded" };
  }

  // Guard 6: deterministic fold (fold-equality with the shared fixture builder,
  // given the same ids) -> ledger.commit -> mapEvidenceIntakeReceipt.
  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildEvidenceIntakeLedgerCommit(command, {
    eventId,
    occurredAt,
    workspaceId,
    priorIndex,
  });

  const receipt = await deps.ledger.commit(batch);
  return mapEvidenceIntakeReceipt(receipt, command);
}

export function submitEvidence(
  deps: ControlEngineDeps,
  command: SubmitEvidenceCommand,
): Promise<SubmitEvidenceReceipt> {
  return submitEvidenceImpl(deps, command);
}

export function mapEvidenceIntakeReceipt(
  receipt: LedgerCommitReceipt,
  command: SubmitEvidenceCommand,
): SubmitEvidenceReceipt {
  if (receipt.status === "committed") {
    const snapshot = receipt.aggregateRevisions.find(
      (v) =>
        v.ref.aggregateType === "TaskEvidenceIndex" &&
        v.ref.projectId === command.payload.evidence.subject.projectId &&
        v.ref.goalId === command.payload.evidence.subject.goalId &&
        v.ref.taskId === command.payload.evidence.subject.taskId,
    );
    const count = snapshot?.revision ?? 1;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      evidenceRef: evidenceRefFor(
        command.payload.evidence.subject.projectId,
        command.payload.evidence.evidenceId,
      ),
      evidenceIndex: count,
      evidenceCount: count,
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
      const evidence = receipt.currentVersions?.find(
        (v) =>
          v.ref.aggregateType === "Evidence" &&
          v.ref.projectId === command.payload.evidence.subject.projectId &&
          v.ref.evidenceId === command.payload.evidence.evidenceId,
      );
      return {
        status: "rejected",
        commandId: command.commandId,
        code: evidence !== undefined ? "revision_conflict" : "revision_conflict",
        ...(evidence !== undefined ? { issues: ["Evidence aggregate already exists (different identity)"] } : {}),
      };
    }
  }
}

export function isEvidenceSnapshot(
  snapshot: AggregateSnapshot,
): snapshot is EvidenceSnapshot {
  return snapshot.ref.aggregateType === "Evidence";
}

export function isTaskEvidenceIndexSnapshot(
  snapshot: AggregateSnapshot,
): snapshot is TaskEvidenceIndexSnapshot {
  return snapshot.ref.aggregateType === "TaskEvidenceIndex";
}

export function isGoalSnapshot(snapshot: AggregateSnapshot): snapshot is GoalSnapshot {
  return snapshot.ref.aggregateType === "Goal";
}

export function isPlanRevisionSnapshot(snapshot: AggregateSnapshot): snapshot is PlanRevisionSnapshot {
  return snapshot.ref.aggregateType === "PlanRevision";
}

export function loadEvidenceIndexFor(
  ledger: StateLedger,
  command: SubmitEvidenceCommand,
): Promise<import("../contracts/ledger.js").SnapshotResult> {
  const evidence = command.payload.evidence;
  return ledger.load(
    taskEvidenceIndexRefFor(evidence.subject.projectId, evidence.subject.goalId, evidence.subject.taskId),
  );
}

export { MAX_EVIDENCE_PER_TASK };
