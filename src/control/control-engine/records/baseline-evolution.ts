/** Control-owned canonical record construction. */
import type { CandidateArchitectureBaselineV1, CandidateArchitectureBaselineSnapshot, MaterializeCandidateBaselineCommand, RecordArchitectureChangeDecisionCommand, RecordMigrationGateCommand, RecordBaselineActivationCommand } from "../../../contracts/baseline-evolution.js";
import { candidateRefFor, architectureChangeDecisionRefFor, migrationGateRefFor, baselineActivationRefFor, materializeCandidateBaselineFingerprint, recordArchitectureChangeDecisionFingerprint, recordMigrationGateFingerprint, recordBaselineActivationFingerprint } from "../../../contracts/baseline-evolution.js";
import type { CandidateBaselineMaterializeLedgerCommitV1, ArchitectureChangeDecisionRecordLedgerCommitV1, MigrationGateRecordLedgerCommitV1, BaselineActivationRecordLedgerCommitV1 } from "../../../contracts/ledger.js";



export function buildP114CandidateFold(command: MaterializeCandidateBaselineCommand, deps: { eventId: string; occurredAt: string; candidate: CandidateArchitectureBaselineV1 }): CandidateBaselineMaterializeLedgerCommitV1 {
  const snap: CandidateArchitectureBaselineSnapshot = { ref: candidateRefFor(deps.candidate.projectId, deps.candidate.workspaceId, deps.candidate.candidateId), revision: 1, schemaVersion: 1, candidate: deps.candidate, materializedAt: deps.candidate.materializedAt };
  return { commitKind: "candidate-baseline-materialize", schemaVersion: 1, identity: { ...command.identity }, fingerprint: materializeCandidateBaselineFingerprint(command), expectedVersions: [{ ref: snap.ref, revision: 0 }], events: [{ eventId: deps.eventId, eventType: "CandidateBaselineMaterialized", schemaVersion: 1, projectId: deps.candidate.projectId, workspaceId: deps.candidate.workspaceId, aggregateType: "CandidateArchitectureBaseline", aggregateId: deps.candidate.candidateId, aggregateRevision: 1, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { candidate: deps.candidate, materializedAt: snap.materializedAt } }], snapshots: [snap], outboxIntents: [] };
}


export function buildP114DecisionFold(command: RecordArchitectureChangeDecisionCommand, deps: { eventId: string; occurredAt: string }): ArchitectureChangeDecisionRecordLedgerCommitV1 {
  const decision = command.payload.decision;
  const snap = { ref: architectureChangeDecisionRefFor(decision.projectId, decision.workspaceId, decision.decisionId), revision: 1 as const, schemaVersion: 1 as const, decision, recordedAt: deps.occurredAt };
  return { commitKind: "architecture-change-decision-record", schemaVersion: 1, identity: { ...command.identity }, fingerprint: recordArchitectureChangeDecisionFingerprint(command), expectedVersions: [{ ref: snap.ref, revision: 0 }], events: [{ eventId: deps.eventId, eventType: "ArchitectureChangeDecisionRecorded", schemaVersion: 1, projectId: decision.projectId, workspaceId: decision.workspaceId, aggregateType: "ArchitectureChangeDecision", aggregateId: decision.decisionId, aggregateRevision: 1, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { decision, recordedAt: deps.occurredAt } }], snapshots: [snap], outboxIntents: [] };
}


export function buildP114GateFold(command: RecordMigrationGateCommand, deps: { eventId: string; occurredAt: string }): MigrationGateRecordLedgerCommitV1 {
  const gate = command.payload.gate;
  const snap = { ref: migrationGateRefFor(gate.projectId, gate.workspaceId, gate.gateId), revision: 1 as const, schemaVersion: 1 as const, gate, recordedAt: deps.occurredAt };
  return { commitKind: "migration-gate-record", schemaVersion: 1, identity: { ...command.identity }, fingerprint: recordMigrationGateFingerprint(command), expectedVersions: [{ ref: snap.ref, revision: 0 }], events: [{ eventId: deps.eventId, eventType: "MigrationGateRecorded", schemaVersion: 1, projectId: gate.projectId, workspaceId: gate.workspaceId, aggregateType: "MigrationGateTask", aggregateId: gate.gateId, aggregateRevision: 1, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { gate, recordedAt: deps.occurredAt } }], snapshots: [snap], outboxIntents: [] };
}


export function buildP114ActivationFold(command: RecordBaselineActivationCommand, deps: { eventId: string; occurredAt: string; guardVersions?: import("../../../contracts/ledger.js").ExpectedVersion[] }): BaselineActivationRecordLedgerCommitV1 {
  const activation = command.payload.activation;
  const snap = { ref: baselineActivationRefFor(activation.projectId, activation.workspaceId, activation.activationId), revision: 1 as const, schemaVersion: 1 as const, activation, recordedAt: deps.occurredAt };
  return { commitKind: "baseline-activation-record", schemaVersion: 1, identity: { ...command.identity }, fingerprint: recordBaselineActivationFingerprint(command), expectedVersions: [{ ref: snap.ref, revision: 0 }, ...(deps.guardVersions ?? [])], events: [{ eventId: deps.eventId, eventType: "BaselineActivationRecorded", schemaVersion: 1, projectId: activation.projectId, workspaceId: activation.workspaceId, aggregateType: "BaselineActivation", aggregateId: activation.activationId, aggregateRevision: 1, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { activation, recordedAt: deps.occurredAt } }], snapshots: [snap], outboxIntents: [] };
}