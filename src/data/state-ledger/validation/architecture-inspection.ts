/** Internal StateLedger architecture-inspection rules. Both adapters invoke these inside their commit protocol. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { validateArchitectureCandidateProposal } from '../../../contracts/validation/architecture.js';
import { isKnownEventType } from "../../../contracts/events.js";
import { candidateProposalDigest } from "../../../contracts/architecture-inspection.js";
import { identityMatchesActor } from './batch-identity.js';


// ------------------------------------------------------------------------ //
// Architecture-inspection commit validators shared by both adapters.           //
// ------------------------------------------------------------------------ //

export function validateArchitectureInspectionRecordCommit(batch: import("../../../contracts/ledger.js").ArchitectureInspectionRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ArchitectureInspectionRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ArchitectureInspection") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ArchitectureInspection") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  if (canonicalJson(snapshot) !== canonicalJson(event.payload.inspection)) return false;
  if (snapshot.intent.inspectionId !== event.aggregateId) return false;
  if (snapshot.intent.projectId !== event.projectId) return false;
  if (snapshot.intent.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.inspectionId !== snapshot.intent.inspectionId) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateArchitectureFindingRecordCommit(batch: import("../../../contracts/ledger.js").ArchitectureFindingRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ArchitectureFindingRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ArchitectureFinding") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ArchitectureFinding") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const finding = snapshot.finding;
  if (finding.findingId !== event.aggregateId) return false;
  if (canonicalJson(finding) !== canonicalJson(event.payload.finding)) return false;
  if (finding.projectId !== event.projectId) return false;
  if (finding.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.findingId !== finding.findingId) return false;
  if (snapshot.recordedAt !== event.payload.recordedAt) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateArchitectureBriefRecordCommit(batch: import("../../../contracts/ledger.js").ArchitectureBriefRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ArchitectureDecisionBriefRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ArchitectureDecisionBrief") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ArchitectureDecisionBrief") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const brief = snapshot.brief;
  if (brief.briefId !== event.aggregateId) return false;
  if (canonicalJson(brief) !== canonicalJson(event.payload.brief)) return false;
  if (brief.projectId !== event.projectId) return false;
  if (brief.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.briefId !== brief.briefId) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateArchitectureProposalRecordCommit(batch: import("../../../contracts/ledger.js").ArchitectureProposalRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ArchitectureCandidateProposalRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ArchitectureCandidateProposal") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ArchitectureCandidateProposal") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const proposal = snapshot.proposal;
  if (proposal.proposalId !== event.aggregateId) return false;
  if (canonicalJson(proposal) !== canonicalJson(event.payload.proposal)) return false;
  if (proposal.projectId !== event.projectId) return false;
  if (proposal.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.proposalId !== proposal.proposalId) return false;
  if (proposal.proposalDigest !== candidateProposalDigest(proposal)) return false;
  if (validateArchitectureCandidateProposal(proposal).length) return false;
  const requiredVersions=[{ref:snapshot.ref,revision:0},...(proposal.selectedBriefRef?[{ref:proposal.selectedBriefRef,revision:1}]:[])];
  if(canonicalJson(batch.expectedVersions)!==canonicalJson(requiredVersions))return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}
