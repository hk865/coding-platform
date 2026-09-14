/** Internal StateLedger evidence-reduction rules. Both adapters invoke these inside their commit protocol. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import { identityMatchesActor } from './batch-identity.js';


// ------------------------------------------------------------------------ //
// evidence-intake (verification)                                                   //
// ------------------------------------------------------------------------ //

export function validateEvidenceIntakeCommit(
  batch: import("../../../contracts/ledger.js").EvidenceIntakeLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "EvidenceAdmitted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "Evidence") return false;
  if (event.aggregateRevision !== 1) return false;

  const evidenceSnapshot = batch.snapshots.find(
    (s): s is import("../../../contracts/evidence.js").EvidenceSnapshot => s.ref.aggregateType === "Evidence",
  );
  const indexSnapshot = batch.snapshots.find(
    (s): s is import("../../../contracts/evidence.js").TaskEvidenceIndexSnapshot =>
      s.ref.aggregateType === "TaskEvidenceIndex",
  );
  if (evidenceSnapshot === undefined || indexSnapshot === undefined) return false;
  if (evidenceSnapshot.revision !== 1 || evidenceSnapshot.schemaVersion !== 1) return false;
  if (indexSnapshot.schemaVersion !== 1) return false;
  const evidence = evidenceSnapshot.evidence;
  if (evidenceSchemaVersionInvalid(evidence)) return false;
  if (evidenceSnapshot.ref.projectId !== event.projectId || evidenceSnapshot.ref.evidenceId !== event.aggregateId) {
    return false;
  }
  if (evidence.evidenceId !== event.aggregateId) return false;
  if (canonicalJson(evidence) !== canonicalJson(event.payload.evidence)) return false;
  if (evidence.subject.projectId !== event.projectId) return false;
  if (evidence.subject.goalId !== event.payload.goalId) return false;
  if (evidence.subject.taskId !== event.payload.taskId) return false;
  if (evidence.coverage.length === 0) return false;
  // A CompletionClaim is a self-report: it can NEVER be evidence PASS.
  if (evidence.kind === "claim" && evidence.outcome !== "INCONCLUSIVE") return false;
  if (evidence.verificationPlanRef.planId.length === 0 || evidence.verificationPlanRef.planDigest.length === 0) {
    return false;
  }
  if (evidence.source.actor.kind !== event.actor.kind || evidence.source.actor.id !== event.actor.id) {
    return false;
  }
  if (evidence.anchor.schemaVersion !== 1) return false;
  if (canonicalJson(evidence.anchor.planRef) !== canonicalJson(event.payload.evidence.anchor.planRef)) {
    return false;
  }
  if (evidence.anchor.planRevision < 1 || evidence.anchor.workspaceRevision < 1) return false;
  if (evidence.anchor.pinnedCompletionPolicy.ref.aggregateType !== "CompletionPolicyRevision") return false;
  if (evidence.anchor.pinnedArchitectureBaseline.ref.aggregateType !== "ArchitectureBaselineRevision") return false;
  if (evidence.anchor.pinnedCompletionPolicy.digest.length === 0) return false;
  if (evidence.anchor.pinnedArchitectureBaseline.digest.length === 0) return false;

  // Index alignment: revision == count; this evidence is the newest entry.
  const index = indexSnapshot;
  if (index.revision !== index.evidenceIds.length) return false;
  if (index.evidenceIds.length === 0) return false;
  if (index.evidenceIds[index.evidenceIds.length - 1] !== evidence.evidenceId) return false;
  if (index.ref.projectId !== event.projectId || index.ref.goalId !== event.payload.goalId || index.ref.taskId !== event.payload.taskId) {
    return false;
  }
  if (event.payload.evidenceIndex !== index.evidenceIds.length) return false;
  if (event.payload.evidenceCount !== index.evidenceIds.length) return false;
  if (event.payload.admittedAt !== event.occurredAt) return false;

  // CAS: Evidence@0 + TaskEvidenceIndex@(count-1).
  if (batch.expectedVersions.length !== 2) return false;
  if (batch.expectedVersions[0]!.revision !== 0) return false;
  if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(evidenceSnapshot.ref)) return false;
  if (batch.expectedVersions[1]!.revision !== index.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(index.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}


export function evidenceSchemaVersionInvalid(evidence: { schemaVersion: number }): boolean {
  return evidence.schemaVersion !== 1;
}


// ------------------------------------------------------------------------ //
// verification-result (verification)                                               //
// ------------------------------------------------------------------------ //

export function validateTaskReductionCommit(
  batch: import("../../../contracts/ledger.js").TaskReductionLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "TaskReductionUpdated") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "TaskReduction") return false;
  const reduction = batch.snapshots[0]!;
  if (reduction.ref.aggregateType !== "TaskReduction") return false;
  if (reduction.schemaVersion !== 1) return false;
  if (!Number.isSafeInteger(reduction.revision) || reduction.revision < 1) return false;
  if (event.aggregateRevision !== reduction.revision) return false;
  if (event.aggregateId !== reduction.ref.taskId) return false;
  if (event.projectId !== reduction.ref.projectId) return false;
  if (event.payload.goalId !== reduction.ref.goalId || event.payload.taskId !== reduction.ref.taskId) {
    return false;
  }
  if (reduction.phase !== "verifying" && reduction.phase !== "blocked" && reduction.phase !== "failed" && reduction.phase !== "satisfied") {
    return false;
  }
  if (canonicalJson(event.payload.reduction) !== canonicalJson(reduction)) return false;
  if (reduction.currentAnchor.schemaVersion !== 1) return false;
  if (reduction.reducedAt !== event.occurredAt) return false;

  if (batch.reviewProtocol === 'independent-review-v1') {
    if (!batch.expectedVersions.some(v => v.ref.aggregateType === 'TaskReviewProtocol') || new Set(batch.expectedVersions.map(v => canonicalJson(v.ref))).size !== batch.expectedVersions.length) return false;
  } else if (batch.expectedVersions.length !== 1) return false;
  if (batch.expectedVersions[0]!.revision !== reduction.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(reduction.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}


// ------------------------------------------------------------------------ //
// goal-reduction (context assembly)                                                    //
// ------------------------------------------------------------------------ //

export function validateGoalReductionCommit(
  batch: import("../../../contracts/ledger.js").GoalReductionLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "GoalPhaseUpdated") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "GoalPhase") return false;
  const phase = batch.snapshots[0]!;
  if (phase.ref.aggregateType !== "GoalPhase") return false;
  if (phase.schemaVersion !== 1) return false;
  if (!Number.isSafeInteger(phase.revision) || phase.revision < 1) return false;
  if (event.aggregateRevision !== phase.revision) return false;
  if (event.aggregateId !== phase.ref.goalId) return false;
  if (event.projectId !== phase.ref.projectId) return false;
  if (event.payload.goalId !== phase.ref.goalId) return false;
  if (event.payload.phase !== phase.phase) return false;
  if (event.payload.previousPhase !== phase.previousPhase) return false;
  if (canonicalJson(event.payload.reasonCodes) !== canonicalJson(phase.reasonCodes)) return false;
  if (canonicalJson(event.payload.explanation) !== canonicalJson(phase.explanation)) return false;
  if (canonicalJson(event.payload.sideEffectReconciliation) !== canonicalJson(phase.sideEffectReconciliation)) return false;
  if (canonicalJson(event.payload.planRef) !== canonicalJson(phase.planRef)) return false;
  if (phase.reducedAt !== event.occurredAt) return false;
  if (event.payload.reducedAt !== event.occurredAt) return false;
  if (batch.reviewProtocol === 'independent-review-v1') {
    if (!batch.expectedVersions.some(v => v.ref.aggregateType === 'TaskReviewProtocol') || new Set(batch.expectedVersions.map(v => canonicalJson(v.ref))).size !== batch.expectedVersions.length) return false;
  } else if (batch.expectedVersions.length !== 1) return false;
  if (batch.expectedVersions[0]!.revision !== phase.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(phase.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}
