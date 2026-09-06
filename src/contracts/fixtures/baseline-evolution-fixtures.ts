/** P1-14 shared fixtures: baseline-evolution builders + ledger folds. */
import type { CommandIdentity } from "../command-event.js";
import type { ArchitectureCandidateProposalV1 } from "../architecture-inspection.js";
import type { ArchitectureBaselinePin } from "../governance.js";
import type {
  CandidateArchitectureBaselineV1, CandidateArchitectureBaselineSnapshot, CandidateArchitectureBaselineRef,
  ArchitectureChangeDecisionV1, ArchitectureChangeDecisionRef,
  MigrationGateTaskV1, MigrationGateTaskRef, MigrationPlanV1,
  BaselineActivationV1, BaselineActivationRef,
  MaterializeCandidateBaselineCommand, RecordArchitectureChangeDecisionCommand, RecordMigrationGateCommand, RecordBaselineActivationCommand,
} from "../baseline-evolution.js";
import {
  candidateContentDigest, candidateIdFromDigest, candidateRefFor, architectureChangeDecisionRefFor, migrationGateRefFor, baselineActivationRefFor,
  materializeCandidateBaselineFingerprint, recordArchitectureChangeDecisionFingerprint, recordMigrationGateFingerprint, recordBaselineActivationFingerprint,
} from "../baseline-evolution.js";
import type { CandidateBaselineMaterializeLedgerCommitV1, ArchitectureChangeDecisionRecordLedgerCommitV1, MigrationGateRecordLedgerCommitV1, BaselineActivationRecordLedgerCommitV1 } from "../ledger.js";

export const P114_PROJECT = "proj-alpha";
export const P114_WORKSPACE = "ws-shared";
export const P114_SCHEMA = "2026-09-06T00:00:00.000Z";
export const P114_PROPOSAL = "proposal-p112-1";
export const P114_CANDIDATE = "candidate-p114-1";
export const P114_DECISION = "decision-p114-1";
export const P114_GATE = "gate-p114-1";
export const P114_ACTIVATION = "activation-p114-1";

export function p114ProposalRef(projectId: string = P114_PROJECT) {
  return { aggregateType: "ArchitectureCandidateProposal" as const, projectId, workspaceId: P114_WORKSPACE, proposalId: P114_PROPOSAL };
}
export function p114CandidateRef(projectId: string = P114_PROJECT, candidateId: string = P114_CANDIDATE): CandidateArchitectureBaselineRef {
  return candidateRefFor(projectId, P114_WORKSPACE, candidateId);
}
export function p114DecisionRef(projectId: string = P114_PROJECT): ArchitectureChangeDecisionRef {
  return architectureChangeDecisionRefFor(projectId, P114_WORKSPACE, P114_DECISION);
}
export function p114GateRef(projectId: string = P114_PROJECT): MigrationGateTaskRef {
  return migrationGateRefFor(projectId, P114_WORKSPACE, P114_GATE);
}
export function p114ActivationRef(projectId: string = P114_PROJECT): BaselineActivationRef {
  return baselineActivationRefFor(projectId, P114_WORKSPACE, P114_ACTIVATION);
}

export function buildP114Candidate(proposal: ArchitectureCandidateProposalV1, overrides: Partial<CandidateArchitectureBaselineV1> = {}): CandidateArchitectureBaselineV1 {
  const digest = candidateContentDigest(proposal.normalizedContent);
  const normalizedContent = { description: proposal.normalizedContent.description, constraints: proposal.normalizedContent.constraints.map((c) => ({ ...c })) };
  return {
    schemaVersion: 1,
    candidateId: candidateIdFromDigest(digest),
    projectId: proposal.projectId,
    workspaceId: proposal.workspaceId,
    proposalRef: p114ProposalRef(proposal.projectId),
    parentSourcePin: { ...proposal.sourceBaselinePin },
    normalizedContent,
    contentDigest: digest,
    materializedAt: P114_SCHEMA,
    ...overrides,
  };
}

export function buildP114Decision(candidate: CandidateArchitectureBaselineV1, overrides: { outcome?: ArchitectureChangeDecisionV1["outcome"]; fromPin?: ArchitectureBaselinePin; authority?: ArchitectureChangeDecisionV1["authority"]; actor?: import("../command-event.js").ActorRef } = {}): ArchitectureChangeDecisionV1 {
  const fromPin = overrides.fromPin ?? { ...candidate.parentSourcePin };
  return {
    schemaVersion: 1,
    decisionId: P114_DECISION,
    projectId: candidate.projectId,
    workspaceId: candidate.workspaceId,
    subject: { fromPin, candidateRef: { ...candidateRefFor(candidate.projectId, candidate.workspaceId, candidate.candidateId) } },
    outcome: overrides.outcome ?? "accept",
    actor: overrides.actor ?? { kind: "human", id: "user-owner-1" },
    authority: overrides.authority ?? { strategy: "user", delegator: null, policyVersion: "architecture-decision-policy@1" },
    authorizedTarget: { fromPin, candidateDigest: candidate.contentDigest },
    summary: "接受候选基线物化",
    decidedAt: P114_SCHEMA,
  };
}

export function buildP114Gate(candidate: CandidateArchitectureBaselineV1, overrides: Partial<MigrationGateTaskV1> = {}): MigrationGateTaskV1 {
  return {
    schemaVersion: 1,
    gateId: P114_GATE,
    projectId: candidate.projectId,
    workspaceId: candidate.workspaceId,
    planRef: "plan-mvp-1",
    candidateRef: { ...candidateRefFor(candidate.projectId, candidate.workspaceId, candidate.candidateId) },
    workspaceRevision: 2,
    status: "pass",
    gateEvidenceRefs: [{ aggregateType: "Evidence" as const, projectId: candidate.projectId, evidenceId: "p114-gate-evidence-1" }],
    createdAt: P114_SCHEMA,
    updatedAt: P114_SCHEMA,
    ...overrides,
  };
}

export function buildP114PlanV1(candidate: CandidateArchitectureBaselineV1, decision: ArchitectureChangeDecisionV1, overrides: Partial<MigrationPlanV1> = {}): MigrationPlanV1 {
  return {
    schemaVersion: 1,
    planId: "migration-p114-1",
    projectId: candidate.projectId,
    workspaceId: candidate.workspaceId,
    decisionRef: { ...p114DecisionRef(candidate.projectId) },
    candidateRef: { ...candidateRefFor(candidate.projectId, candidate.workspaceId, candidate.candidateId) },
    fromPin: { ...decision.authorizedTarget.fromPin },
    candidatePin: { ref: { aggregateType: "ArchitectureBaselineRevision" as const, projectId: candidate.projectId, baselineId: "architecture-baseline-1", revision: 2 }, digest: candidate.contentDigest },
    affectedPlanRefs: [{ planRef: { aggregateType: "PlanRevision" as const, projectId: candidate.projectId, planId: "plan-mvp-1" }, pinnedBaselinePin: { ...decision.authorizedTarget.fromPin } }],
    migrationEvidenceRefs: [],
    materialsToRefresh: ["baselinePinnedPlanContext"],
    notImplicitRebase: true,
    createdAt: P114_SCHEMA,
    ...overrides,
  };
}

export function buildP114Activation(candidate: CandidateArchitectureBaselineV1, decision: ArchitectureChangeDecisionV1, gate: MigrationGateTaskV1, toPin: ArchitectureBaselinePin, overrides: Partial<BaselineActivationV1> = {}): BaselineActivationV1 {
  return {
    schemaVersion: 1,
    activationId: P114_ACTIVATION,
    projectId: candidate.projectId,
    workspaceId: candidate.workspaceId,
    proposalRef: { ...candidate.proposalRef },
    decisionRef: { ...p114DecisionRef(candidate.projectId) },
    gateRef: { ...p114GateRef(candidate.projectId) },
    fromPin: { ...decision.authorizedTarget.fromPin },
    toPin: { ...toPin },
    activatedAt: P114_SCHEMA,
    ...overrides,
  };
}

// ------------------------------------------------------------------------ //
// Command + fold builders                                                    //
// ------------------------------------------------------------------------ //

export function buildP114MaterializeCommand(proposalRef: ReturnType<typeof p114ProposalRef>, deps: { commandId: string }): MaterializeCandidateBaselineCommand {
  return { commandId: deps.commandId, commandType: "MaterializeCandidateBaseline", schemaVersion: 1, identity: { projectId: proposalRef.projectId, actor: { kind: "system", id: "architecture-reconciler" }, idempotencyKey: deps.commandId + "-idem" }, aggregateId: P114_CANDIDATE, expectedRevision: 0, correlationId: deps.commandId + "-corr", submittedAt: P114_SCHEMA, payload: { proposalRef } };
}
export function buildP114DecisionCommand(decision: ArchitectureChangeDecisionV1, deps: { commandId: string }): RecordArchitectureChangeDecisionCommand {
  return { commandId: deps.commandId, commandType: "RecordArchitectureChangeDecision", schemaVersion: 1, identity: { projectId: decision.projectId, actor: decision.actor, idempotencyKey: deps.commandId + "-idem" }, aggregateId: decision.decisionId, expectedRevision: 0, correlationId: deps.commandId + "-corr", submittedAt: P114_SCHEMA, payload: { decision } };
}
export function buildP114GateCommand(gate: MigrationGateTaskV1, deps: { commandId: string }): RecordMigrationGateCommand {
  return { commandId: deps.commandId, commandType: "RecordMigrationGate", schemaVersion: 1, identity: { projectId: gate.projectId, actor: { kind: "system", id: "verification-engine" }, idempotencyKey: deps.commandId + "-idem" }, aggregateId: gate.gateId, expectedRevision: 0, correlationId: deps.commandId + "-corr", submittedAt: P114_SCHEMA, payload: { gate } };
}
export function buildP114ActivationCommand(activation: BaselineActivationV1, deps: { commandId: string }): RecordBaselineActivationCommand {
  return { commandId: deps.commandId, commandType: "RecordBaselineActivation", schemaVersion: 1, identity: { projectId: activation.projectId, actor: { kind: "system", id: "control-engine" }, idempotencyKey: deps.commandId + "-idem" }, aggregateId: activation.activationId, expectedRevision: 0, correlationId: deps.commandId + "-corr", submittedAt: P114_SCHEMA, payload: { activation } };
}

export function buildP114CandidateFold(command: MaterializeCandidateBaselineCommand, deps: { eventId: string; occurredAt: string; candidate: CandidateArchitectureBaselineV1 }): CandidateBaselineMaterializeLedgerCommitV1 {
  const snap: CandidateArchitectureBaselineSnapshot = { ref: { ...p114CandidateRef(command.identity.projectId) }, revision: 1, schemaVersion: 1, candidate: deps.candidate, materializedAt: deps.candidate.materializedAt };
  return { commitKind: "candidate-baseline-materialize", schemaVersion: 1, identity: { ...command.identity }, fingerprint: materializeCandidateBaselineFingerprint(command), expectedVersions: [{ ref: snap.ref, revision: 0 }], events: [{ eventId: deps.eventId, eventType: "CandidateBaselineMaterialized", schemaVersion: 1, projectId: deps.candidate.projectId, workspaceId: deps.candidate.workspaceId, aggregateType: "CandidateArchitectureBaseline", aggregateId: deps.candidate.candidateId, aggregateRevision: 1, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { candidate: deps.candidate, materializedAt: snap.materializedAt } }], snapshots: [snap], outboxIntents: [] };
}

export function buildP114DecisionFold(command: RecordArchitectureChangeDecisionCommand, deps: { eventId: string; occurredAt: string }): ArchitectureChangeDecisionRecordLedgerCommitV1 {
  const decision = command.payload.decision;
  const snap = { ref: { ...p114DecisionRef(decision.projectId) }, revision: 1 as const, schemaVersion: 1 as const, decision, recordedAt: deps.occurredAt };
  return { commitKind: "architecture-change-decision-record", schemaVersion: 1, identity: { ...command.identity }, fingerprint: recordArchitectureChangeDecisionFingerprint(command), expectedVersions: [{ ref: snap.ref, revision: 0 }], events: [{ eventId: deps.eventId, eventType: "ArchitectureChangeDecisionRecorded", schemaVersion: 1, projectId: decision.projectId, workspaceId: decision.workspaceId, aggregateType: "ArchitectureChangeDecision", aggregateId: decision.decisionId, aggregateRevision: 1, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { decision, recordedAt: deps.occurredAt } }], snapshots: [snap], outboxIntents: [] };
}

export function buildP114GateFold(command: RecordMigrationGateCommand, deps: { eventId: string; occurredAt: string }): MigrationGateRecordLedgerCommitV1 {
  const gate = command.payload.gate;
  const snap = { ref: { ...p114GateRef(gate.projectId) }, revision: 1 as const, schemaVersion: 1 as const, gate, recordedAt: deps.occurredAt };
  return { commitKind: "migration-gate-record", schemaVersion: 1, identity: { ...command.identity }, fingerprint: recordMigrationGateFingerprint(command), expectedVersions: [{ ref: snap.ref, revision: 0 }], events: [{ eventId: deps.eventId, eventType: "MigrationGateRecorded", schemaVersion: 1, projectId: gate.projectId, workspaceId: gate.workspaceId, aggregateType: "MigrationGateTask", aggregateId: gate.gateId, aggregateRevision: 1, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { gate, recordedAt: deps.occurredAt } }], snapshots: [snap], outboxIntents: [] };
}

export function buildP114ActivationFold(command: RecordBaselineActivationCommand, deps: { eventId: string; occurredAt: string }): BaselineActivationRecordLedgerCommitV1 {
  const activation = command.payload.activation;
  const snap = { ref: { ...p114ActivationRef(activation.projectId) }, revision: 1 as const, schemaVersion: 1 as const, activation, recordedAt: deps.occurredAt };
  return { commitKind: "baseline-activation-record", schemaVersion: 1, identity: { ...command.identity }, fingerprint: recordBaselineActivationFingerprint(command), expectedVersions: [{ ref: snap.ref, revision: 0 }], events: [{ eventId: deps.eventId, eventType: "BaselineActivationRecorded", schemaVersion: 1, projectId: activation.projectId, workspaceId: activation.workspaceId, aggregateType: "BaselineActivation", aggregateId: activation.activationId, aggregateRevision: 1, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { activation, recordedAt: deps.occurredAt } }], snapshots: [snap], outboxIntents: [] };
}
