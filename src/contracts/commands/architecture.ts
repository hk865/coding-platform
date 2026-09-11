/** Formal command/value construction. Identity, authority, scope and time are caller inputs. */
import type { CommandIdentity } from "../command-event.js";
import type { ArchitectureCandidateProposalV1, ArchitectureDecisionBriefV1, ArchitectureFindingV1, ArchitectureInspectionSnapshot } from "../architecture-inspection.js";
import type { RecordArchitectureDecisionBriefCommand, RecordArchitectureFindingCommand, RecordArchitectureInspectionCommand, RecordCandidateBaselineProposalCommand } from "../architecture-inspection.js";

export type BuildArchitectureCommandDeps = {
  commandId: string;
  actor: CommandIdentity["actor"];
  idempotencyKey: string;
  correlationId: string;
  submittedAt: string;
};

export function buildRecordArchitectureInspectionCommand(inspection: ArchitectureInspectionSnapshot, deps: BuildArchitectureCommandDeps): RecordArchitectureInspectionCommand {
  return {
    commandId: deps.commandId,
    commandType: "RecordArchitectureInspection",
    schemaVersion: 1,
    identity: { projectId: inspection.intent.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    aggregateId: inspection.intent.inspectionId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { inspection },
  };
}

export function buildRecordArchitectureFindingCommand(finding: ArchitectureFindingV1, deps: BuildArchitectureCommandDeps): RecordArchitectureFindingCommand {
  return {
    commandId: deps.commandId,
    commandType: "RecordArchitectureFinding",
    schemaVersion: 1,
    identity: { projectId: finding.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    aggregateId: finding.findingId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { finding },
  };
}

export function buildRecordArchitectureDecisionBriefCommand(brief: ArchitectureDecisionBriefV1, deps: BuildArchitectureCommandDeps): RecordArchitectureDecisionBriefCommand {
  return {
    commandId: deps.commandId,
    commandType: "RecordArchitectureDecisionBrief",
    schemaVersion: 1,
    identity: { projectId: brief.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    aggregateId: brief.briefId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { brief },
  };
}

export function buildRecordCandidateBaselineProposalCommand(proposal: ArchitectureCandidateProposalV1, deps: BuildArchitectureCommandDeps): RecordCandidateBaselineProposalCommand {
  return {
    commandId: deps.commandId,
    commandType: "RecordCandidateBaselineProposal",
    schemaVersion: 1,
    identity: { projectId: proposal.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    aggregateId: proposal.proposalId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { proposal },
  };
}
