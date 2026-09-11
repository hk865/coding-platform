
/** P1-14 shared fixtures: baseline-evolution builders + ledger folds. */

import type { ArchitectureCandidateProposalV1 } from "../../../src/contracts/architecture-inspection.js";
import type { ArchitectureBaselinePin } from "../../../src/contracts/governance.js";
import type { CandidateArchitectureBaselineV1, CandidateArchitectureBaselineRef, ArchitectureChangeDecisionV1, ArchitectureChangeDecisionRef, MigrationGateTaskV1, MigrationGateTaskRef, MigrationPlanV1, BaselineActivationV1, BaselineActivationRef, MaterializeCandidateBaselineCommand, RecordArchitectureChangeDecisionCommand, RecordMigrationGateCommand, RecordBaselineActivationCommand } from "../../../src/contracts/baseline-evolution.js";
import { candidateContentDigest, candidateRefFor, architectureChangeDecisionRefFor, migrationGateRefFor, baselineActivationRefFor } from "../../../src/contracts/baseline-evolution.js";


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
  const normalizedContent = structuredClone(proposal.normalizedContent);
  // 聚合身份 = 调用方提供的稳定 aggregateId（内容寻址仅作为 contentDigest 字段写入；integrator ruling 2026-09-07）。
  return {
    schemaVersion: 1,
    candidateId: P114_CANDIDATE,
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

export function buildP114Decision(candidate: CandidateArchitectureBaselineV1, overrides: { outcome?: ArchitectureChangeDecisionV1["outcome"]; fromPin?: ArchitectureBaselinePin; authority?: ArchitectureChangeDecisionV1["authority"]; actor?: import("../../../src/contracts/command-event.js").ActorRef } = {}): ArchitectureChangeDecisionV1 {
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
    workspaceRevision: 1, // P1-11 bootstrap world leaves Workspace at revision 1 (integrator ruling 2026-09-07)
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
