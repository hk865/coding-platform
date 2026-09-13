/** Control-owned canonical record construction. */
import type { PlanRevisionRef } from "../../../contracts/plan.js";
import type { EffectivityAnchorV1, EvidenceAdmittedEvent, EvidenceSnapshot, SubmitEvidenceCommand, TaskEvidenceIndexSnapshot } from "../../../contracts/evidence.js";
import { evidenceRefFor, submitEvidenceFingerprint, taskEvidenceIndexRefFor } from "../../../contracts/evidence.js";
import type { EvidenceIntakeLedgerCommitV1 } from "../../../contracts/ledger.js";
import type { ReduceTaskCommand, TaskReductionRef, TaskReductionSnapshot, TaskReductionUpdatedEvent } from "../../../contracts/reduction.js";
import { reduceTaskFingerprint, taskReductionRefFor } from "../../../contracts/reduction.js";
import type { TaskReductionLedgerCommitV1 } from "../../../contracts/ledger.js";



/** Deterministic evidence-intake fold target (fold-equality for Control). */
export function buildEvidenceIntakeLedgerCommit(
  command: SubmitEvidenceCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    priorIndex: TaskEvidenceIndexSnapshot | null;
  },
): EvidenceIntakeLedgerCommitV1 {
  const evidence = command.payload.evidence;
  const projectId = evidence.subject.projectId;
  const goalId = evidence.subject.goalId;
  const taskId = evidence.subject.taskId;
  const evidenceIds = [...(deps.priorIndex?.evidenceIds ?? []), evidence.evidenceId];
  const evidenceSnapshot: EvidenceSnapshot = {
    ref: evidenceRefFor(projectId, evidence.evidenceId),
    revision: 1,
    schemaVersion: 1,
    evidence,
    admittedAt: deps.occurredAt,
  };
  const indexSnapshot: TaskEvidenceIndexSnapshot = {
    ref: taskEvidenceIndexRefFor(projectId, goalId, taskId),
    revision: evidenceIds.length,
    schemaVersion: 1,
    evidenceIds,
  };
  const event: EvidenceAdmittedEvent = {
    eventId: deps.eventId,
    eventType: "EvidenceAdmitted",
    schemaVersion: 1,
    projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "Evidence",
    aggregateId: evidence.evidenceId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      goalId,
      taskId,
      evidence,
      admittedAt: deps.occurredAt,
      evidenceIndex: evidenceIds.length,
      evidenceCount: evidenceIds.length,
    },
  };
  return {
    commitKind: "evidence-intake",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: submitEvidenceFingerprint(command),
    expectedVersions: [
      { ref: evidenceSnapshot.ref, revision: 0 },
      { ref: indexSnapshot.ref, revision: indexSnapshot.revision - 1 },
    ],
    events: [event],
    snapshots: [evidenceSnapshot, indexSnapshot],
    outboxIntents: [],
  };
}


export function buildTaskReductionSnapshot(
  deps: {
    projectId: string;
    goalId: string;
    taskId: string;
    revision: number;
    planRef: PlanRevisionRef;
    planRevision: number;
    taskKind: "work" | "gate";
    requirementLevel: "required" | "optional";
    disposition: "active" | "deferred" | "cancelled" | "superseded";
    phase: "verifying" | "blocked" | "failed" | "satisfied";
    currentAnchor: EffectivityAnchorV1;
    effectiveEvidenceIds: string[];
    blockingEvidenceIds: string[];
    staleEvidenceIds: string[];
    outOfScopeEvidenceIds: string[];
    satisfiedObligationIds: string[];
    causes: TaskReductionSnapshot["causes"];
    reducedAt: string;
  },
): TaskReductionSnapshot {
  return {
    ref: taskReductionRefFor(deps.projectId, deps.goalId, deps.taskId),
    revision: deps.revision,
    schemaVersion: 1,
    planRef: { ...deps.planRef },
    planRevision: deps.planRevision,
    taskKind: deps.taskKind,
    requirementLevel: deps.requirementLevel,
    disposition: deps.disposition,
    phase: deps.phase,
    currentAnchor: {
      schemaVersion: 1,
      planRef: { ...deps.currentAnchor.planRef },
      planRevision: deps.currentAnchor.planRevision,
      workspaceRevision: deps.currentAnchor.workspaceRevision,
      pinnedCompletionPolicy: { ...deps.currentAnchor.pinnedCompletionPolicy },
      pinnedArchitectureBaseline: { ...deps.currentAnchor.pinnedArchitectureBaseline },
    },
    effectiveEvidenceIds: [...deps.effectiveEvidenceIds],
    blockingEvidenceIds: [...deps.blockingEvidenceIds],
    staleEvidenceIds: [...deps.staleEvidenceIds],
    outOfScopeEvidenceIds: [...deps.outOfScopeEvidenceIds],
    satisfiedObligationIds: [...deps.satisfiedObligationIds],
    causes: deps.causes.map((c) => ({ ...c })),
    reducedAt: deps.reducedAt,
  };
}


/** Deterministic verification-result fold target (fold-equality for Control). */
export function buildTaskReductionLedgerCommit(
  command: ReduceTaskCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    reduction: TaskReductionSnapshot;
  },
): TaskReductionLedgerCommitV1 {
  const ref: TaskReductionRef = deps.reduction.ref;
  const event: TaskReductionUpdatedEvent = {
    eventId: deps.eventId,
    eventType: "TaskReductionUpdated",
    schemaVersion: 1,
    projectId: ref.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "TaskReduction",
    aggregateId: ref.taskId,
    aggregateRevision: deps.reduction.revision,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: { goalId: ref.goalId, taskId: ref.taskId, reduction: deps.reduction },
  };
  return {
    commitKind: "verification-result",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: reduceTaskFingerprint(command),
    expectedVersions: [{ ref, revision: deps.reduction.revision - 1 }],
    events: [event],
    snapshots: [deps.reduction],
    outboxIntents: [],
  };
}