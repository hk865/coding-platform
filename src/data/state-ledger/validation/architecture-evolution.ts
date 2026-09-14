/** Internal StateLedger architecture-evolution rules. Both adapters invoke these inside their commit protocol. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import { identityMatchesActor } from './batch-identity.js';



// ------------------------------------------------------------------------ //
// Architecture-remediation commit validators shared by both adapters.            //
// ------------------------------------------------------------------------ //

export function validateRemediationPlanPatchRecordCommit(batch: import("../../../contracts/ledger.js").RemediationPlanPatchRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "RemediationPlanPatchRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "RemediationPlanPatch" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.ref.aggregateType !== "RemediationPlanPatch" || snap.revision !== 1 || snap.schemaVersion !== 1) return false;
  if (snap.patch.patchId !== event.aggregateId) return false;
  if (canonicalJson(snap.patch) !== canonicalJson(event.payload.patch)) return false;
  if (snap.recordedAt !== event.payload.recordedAt) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0 || canonicalJson(expected.ref) !== canonicalJson(snap.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateRemediationTaskRecordCommit(batch: import("../../../contracts/ledger.js").RemediationTaskRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "RemediationTaskCreated" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "RemediationTask" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.ref.aggregateType !== "RemediationTask" || snap.revision !== 1 || snap.schemaVersion !== 1) return false;
  if (snap.task.taskId !== event.aggregateId) return false;
  if (canonicalJson(snap.task) !== canonicalJson(event.payload.task)) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0 || canonicalJson(expected.ref) !== canonicalJson(snap.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateRemediationTaskAdvanceCommit(batch: import("../../../contracts/ledger.js").RemediationTaskAdvanceLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "RemediationTaskAdvanced" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "RemediationTask") return false;
  const snap = batch.snapshots[0]!;
  if (snap.ref.aggregateType !== "RemediationTask" || snap.schemaVersion !== 1) return false;
  if (event.aggregateRevision !== snap.revision) return false;
  if (snap.task.taskId !== event.aggregateId) return false;
  if (canonicalJson(snap.task) !== canonicalJson(event.payload.task)) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== snap.revision - 1 || canonicalJson(expected.ref) !== canonicalJson(snap.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}



// ------------------------------------------------------------------------ //
// Baseline-evolution commit validators shared by both adapters.                  //
// ------------------------------------------------------------------------ //

export function validateCandidateBaselineMaterializeCommit(batch: import("../../../contracts/ledger.js").CandidateBaselineMaterializeLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "CandidateBaselineMaterialized" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "CandidateArchitectureBaseline" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.candidate.candidateId !== event.aggregateId) return false;
  if (snap.schemaVersion !== 1 || snap.revision !== 1 || snap.ref.aggregateType !== "CandidateArchitectureBaseline" || snap.ref.candidateId !== event.aggregateId || snap.ref.projectId !== event.projectId || snap.ref.workspaceId !== event.workspaceId || snap.candidate.projectId !== event.projectId || snap.candidate.workspaceId !== event.workspaceId) return false;
  if (canonicalJson(snap.candidate) !== canonicalJson(event.payload.candidate)) return false;
  if (snap.materializedAt !== event.payload.materializedAt) return false;
  if ((batch.expectedVersions.length !== 1 && batch.expectedVersions.length !== 2) || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  if (batch.expectedVersions.length === 2) {
    const active = batch.expectedVersions[1]!;
    if (active.ref.aggregateType !== "ProjectArchitectureBaselineActive" || active.ref.projectId !== snap.candidate.projectId || !Number.isInteger(active.revision) || active.revision < 1) return false;
  }
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateArchitectureChangeDecisionRecordCommit(batch: import("../../../contracts/ledger.js").ArchitectureChangeDecisionRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "ArchitectureChangeDecisionRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ArchitectureChangeDecision" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.decision.decisionId !== event.aggregateId) return false;
  if (snap.schemaVersion !== 1 || snap.revision !== 1 || snap.ref.aggregateType !== "ArchitectureChangeDecision" || snap.ref.decisionId !== event.aggregateId || snap.ref.projectId !== event.projectId || snap.ref.workspaceId !== event.workspaceId || snap.decision.projectId !== event.projectId || snap.decision.workspaceId !== event.workspaceId) return false;
  if (canonicalJson(snap.decision) !== canonicalJson(event.payload.decision)) return false;
  if (snap.recordedAt !== event.payload.recordedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateMigrationGateRecordCommit(batch: import("../../../contracts/ledger.js").MigrationGateRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "MigrationGateRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "MigrationGateTask" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.gate.gateId !== event.aggregateId) return false;
  if (snap.schemaVersion !== 1 || snap.revision !== 1 || snap.ref.aggregateType !== "MigrationGateTask" || snap.ref.gateId !== event.aggregateId || snap.ref.projectId !== event.projectId || snap.ref.workspaceId !== event.workspaceId || snap.gate.projectId !== event.projectId || snap.gate.workspaceId !== event.workspaceId) return false;
  if (canonicalJson(snap.gate) !== canonicalJson(event.payload.gate)) return false;
  if (snap.recordedAt !== event.payload.recordedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateBaselineActivationRecordCommit(batch: import("../../../contracts/ledger.js").BaselineActivationRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "BaselineActivationRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "BaselineActivation" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.activation.activationId !== event.aggregateId) return false;
  if (snap.schemaVersion !== 1 || snap.revision !== 1 || snap.ref.aggregateType !== "BaselineActivation" || snap.ref.activationId !== event.aggregateId || snap.ref.projectId !== event.projectId || snap.ref.workspaceId !== event.workspaceId || snap.activation.projectId !== event.projectId || snap.activation.workspaceId !== event.workspaceId) return false;
  if (canonicalJson(snap.activation) !== canonicalJson(event.payload.activation)) return false;
  if (snap.recordedAt !== event.payload.recordedAt) return false;
  if ((batch.expectedVersions.length !== 1 && batch.expectedVersions.length !== 3) || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  if (batch.expectedVersions.length === 3) {
    const workspace = batch.expectedVersions[1]!;
    const active = batch.expectedVersions[2]!;
    if (workspace.ref.aggregateType !== "Workspace" || workspace.ref.projectId !== snap.activation.projectId || workspace.ref.workspaceId !== snap.activation.workspaceId || !Number.isInteger(workspace.revision) || workspace.revision < 1) return false;
    if (active.ref.aggregateType !== "ProjectArchitectureBaselineActive" || active.ref.projectId !== snap.activation.projectId || !Number.isInteger(active.revision) || active.revision < 1) return false;
  }
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}



// ------------------------------------------------------------------------ //
// Initial-design and coordination-policy commit validators.                      //
// ------------------------------------------------------------------------ //

export function validateInitialDesignCommon(event: { eventType: string; projectId: string; workspaceId: string; aggregateRevision: number; aggregateId: string; actor: import("../../../contracts/command-event.js").ActorRef; idempotencyKey: string }, batch: { identity: import("../../../contracts/command-event.js").CommandIdentity }): boolean {
  return event.aggregateRevision === 1 && identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateInitialDesignProposalRecordCommit(batch: import("../../../contracts/ledger.js").InitialDesignProposalRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "InitialDesignProposalRecorded" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.proposal.designId !== event.aggregateId || canonicalJson(snap.proposal) !== canonicalJson(event.payload.proposal) || snap.recordedAt !== event.payload.recordedAt) return false;
  if (!validateInitialDesignCommon(event, batch)) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return true;
}

export function validateInitialDesignDecisionRecordCommit(batch: import("../../../contracts/ledger.js").InitialDesignDecisionRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "InitialDesignDecisionRecorded" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.decision.decisionId !== event.aggregateId || canonicalJson(snap.decision) !== canonicalJson(event.payload.decision) || snap.recordedAt !== event.payload.recordedAt) return false;
  if (!validateInitialDesignCommon(event, batch)) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return true;
}
