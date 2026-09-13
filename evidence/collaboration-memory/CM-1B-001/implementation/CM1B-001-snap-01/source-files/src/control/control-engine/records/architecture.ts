/** Control-owned canonical record construction. */
import { architectureCandidateProposalRefFor, architectureDecisionBriefRefFor, architectureFindingRefFor } from "../../../contracts/architecture-inspection.js";
import type { ArchitectureBriefRecordLedgerCommitV1, ArchitectureFindingRecordLedgerCommitV1, ArchitectureInspectionRecordLedgerCommitV1, ArchitectureProposalRecordLedgerCommitV1 } from "../../../contracts/ledger.js";
import { recordArchitectureDecisionBriefFingerprint, recordArchitectureFindingFingerprint, recordArchitectureInspectionFingerprint, recordCandidateBaselineProposalFingerprint } from "../../../contracts/architecture-inspection.js";
import type { RecordArchitectureDecisionBriefCommand, RecordArchitectureFindingCommand, RecordArchitectureInspectionCommand, RecordCandidateBaselineProposalCommand } from "../../../contracts/architecture-inspection.js";



// ------------------------------------------------------------------------ //
// Ledger-fold builders                                                      //
// ------------------------------------------------------------------------ //

export function buildArchitectureInspectionRecordLedgerCommit(
  command: RecordArchitectureInspectionCommand,
  deps: { eventId: string; occurredAt: string },
): ArchitectureInspectionRecordLedgerCommitV1 {
  const inspection = command.payload.inspection;
  return {
    commitKind: "architecture-inspection-record",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: recordArchitectureInspectionFingerprint(command),
    expectedVersions: [{ ref: inspection.ref, revision: 0 }],
    events: [{
      eventId: deps.eventId,
      eventType: "ArchitectureInspectionRecorded",
      schemaVersion: 1,
      projectId: inspection.intent.projectId,
      workspaceId: inspection.intent.workspaceId,
      aggregateType: "ArchitectureInspection",
      aggregateId: inspection.intent.inspectionId,
      aggregateRevision: 1,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt: deps.occurredAt,
      payload: { inspection },
    }],
    snapshots: [inspection],
    outboxIntents: [],
  };
}


export function buildArchitectureFindingRecordLedgerCommit(
  command: RecordArchitectureFindingCommand,
  deps: { eventId: string; occurredAt: string },
): ArchitectureFindingRecordLedgerCommitV1 {
  const finding = command.payload.finding;
  return {
    commitKind: "architecture-finding-record",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: recordArchitectureFindingFingerprint(command),
    expectedVersions: [{ ref: architectureFindingRefFor(finding.projectId, finding.workspaceId, finding.findingId), revision: 0 }],
    events: [{
      eventId: deps.eventId, eventType: "ArchitectureFindingRecorded", schemaVersion: 1,
      projectId: finding.projectId, workspaceId: finding.workspaceId,
      aggregateType: "ArchitectureFinding", aggregateId: finding.findingId, aggregateRevision: 1,
      causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor }, occurredAt: deps.occurredAt,
      payload: { finding, recordedAt: deps.occurredAt },
    }],
    snapshots: [{ ref: architectureFindingRefFor(finding.projectId, finding.workspaceId, finding.findingId), revision: 1, schemaVersion: 1, finding, recordedAt: deps.occurredAt }],
    outboxIntents: [],
  };
}


export function buildArchitectureBriefRecordLedgerCommit(
  command: RecordArchitectureDecisionBriefCommand,
  deps: { eventId: string; occurredAt: string },
): ArchitectureBriefRecordLedgerCommitV1 {
  const brief = command.payload.brief;
  return {
    commitKind: "architecture-brief-record",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: recordArchitectureDecisionBriefFingerprint(command),
    expectedVersions: [{ ref: architectureDecisionBriefRefFor(brief.projectId, brief.workspaceId, brief.briefId), revision: 0 }],
    events: [{
      eventId: deps.eventId, eventType: "ArchitectureDecisionBriefRecorded", schemaVersion: 1,
      projectId: brief.projectId, workspaceId: brief.workspaceId,
      aggregateType: "ArchitectureDecisionBrief", aggregateId: brief.briefId, aggregateRevision: 1,
      causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor }, occurredAt: deps.occurredAt,
      payload: { brief, recordedAt: deps.occurredAt },
    }],
    snapshots: [{ ref: architectureDecisionBriefRefFor(brief.projectId, brief.workspaceId, brief.briefId), revision: 1, schemaVersion: 1, brief, recordedAt: deps.occurredAt }],
    outboxIntents: [],
  };
}


export function buildArchitectureProposalRecordLedgerCommit(
  command: RecordCandidateBaselineProposalCommand,
  deps: { eventId: string; occurredAt: string },
): ArchitectureProposalRecordLedgerCommitV1 {
  const proposal = command.payload.proposal;
  return {
    commitKind: "architecture-proposal-record",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: recordCandidateBaselineProposalFingerprint(command),
    expectedVersions: [{ ref: architectureCandidateProposalRefFor(proposal.projectId, proposal.workspaceId, proposal.proposalId), revision: 0 }],
    events: [{
      eventId: deps.eventId, eventType: "ArchitectureCandidateProposalRecorded", schemaVersion: 1,
      projectId: proposal.projectId, workspaceId: proposal.workspaceId,
      aggregateType: "ArchitectureCandidateProposal", aggregateId: proposal.proposalId, aggregateRevision: 1,
      causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor }, occurredAt: deps.occurredAt,
      payload: { proposal, recordedAt: deps.occurredAt },
    }],
    snapshots: [{ ref: architectureCandidateProposalRefFor(proposal.projectId, proposal.workspaceId, proposal.proposalId), revision: 1, schemaVersion: 1, proposal, recordedAt: deps.occurredAt }],
    outboxIntents: [],
  };
}