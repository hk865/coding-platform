/** P1-13 shared fixtures: ArchitectureEvolutionPolicy local fixture + install/activate folds. */
import type { CommandIdentity } from "../command-event.js";
import type { VersionedArchitectureEvolutionPolicyFixture, ArchitectureEvolutionPolicyContentV1, ArchitectureEvolutionPolicyRevisionSnapshot, ProjectArchitectureEvolutionPolicyActiveSnapshot, InstallArchitectureEvolutionPolicyRevisionCommand, ActivateProjectArchitectureEvolutionPolicyCommand } from "../architecture-evolution-policy.js";
import { architectureEvolutionPolicyContentDigest, architectureEvolutionPolicyInstallFingerprint, architectureEvolutionPolicyActivateFingerprint } from "../architecture-evolution-policy.js";
import type { GovernanceInstallLedgerCommitV1, GovernanceActivateLedgerCommitV1 } from "../ledger.js";

export const P113_PROJECT = "proj-alpha";
export const P113_PROJECT_B = "proj-beta";
export const P113_SCHEMA = "2026-09-06T00:00:00.000Z";
export const P113_POLICY = "evolution-policy-1";

export const ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1: VersionedArchitectureEvolutionPolicyFixture = {
  schemaVersion: 1,
  fixtureId: "architecture-evolution-policy-v1",
  contentType: "ArchitectureEvolutionPolicy",
  revision: 1,
  identity: { kind: "local", fixtureId: P113_POLICY, source: "p1-13-local-fixture-v1" },
  content: {
    schemaVersion: 1,
    allowlist: [
      { findingCategory: "structure", scope: "module", maxRisk: "medium", reversibility: "reversible", note: "结构类局部修复放行" },
      { findingCategory: "dependency", scope: "module", maxRisk: "low", reversibility: "reversible", note: "依赖类低风险放行" },
      { findingCategory: "performance", scope: "runtime", maxRisk: "medium", reversibility: "reversible", note: "性能类局部修复放行" },
    ],
    driftBudget: { maxRemediationsPerCycle: 2 },
    upgrade: { path: "manual-decision", note: "升级需人工决策" },
  },
};

export function p113PolicyRef(projectId: string = P113_PROJECT) {
  return { aggregateType: "ArchitectureEvolutionPolicyRevision" as const, projectId, policyId: P113_POLICY, revision: 1 };
}
export function p113ActiveRef(projectId: string = P113_PROJECT) {
  return { aggregateType: "ProjectArchitectureEvolutionPolicyActive" as const, projectId };
}
export function p113PolicyPin(projectId: string = P113_PROJECT) {
  return { ref: p113PolicyRef(projectId), digest: architectureEvolutionPolicyContentDigest(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1) };
}

export function buildP113InstallCommand(fixture: VersionedArchitectureEvolutionPolicyFixture, deps: { commandId: string; projectId: string; idempotencyKey?: string; actor?: CommandIdentity["actor"] }): InstallArchitectureEvolutionPolicyRevisionCommand {
  return {
    commandId: deps.commandId,
    commandType: "InstallArchitectureEvolutionPolicyRevision",
    schemaVersion: 1,
    identity: { projectId: deps.projectId, actor: deps.actor ?? { kind: "human", id: "user-1" }, idempotencyKey: deps.idempotencyKey ?? deps.commandId + "-idem" },
    correlationId: deps.commandId + "-corr",
    submittedAt: P113_SCHEMA,
    payload: { fixture, contentDigest: architectureEvolutionPolicyContentDigest(fixture) },
  };
}

export function buildP113InstallLedgerCommit(command: InstallArchitectureEvolutionPolicyRevisionCommand, deps: { eventId: string; occurredAt: string }): GovernanceInstallLedgerCommitV1 {
  const snapshot: ArchitectureEvolutionPolicyRevisionSnapshot = {
    ref: p113PolicyRef(command.identity.projectId),
    revision: 1,
    schemaVersion: 1,
    policyId: P113_POLICY,
    contentRevision: command.payload.fixture.revision,
    content: command.payload.fixture.content,
    contentDigest: command.payload.contentDigest,
    installedAt: deps.occurredAt,
  };
  return {
    commitKind: "governance-install",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: architectureEvolutionPolicyInstallFingerprint(command),
    expectedVersions: [{ ref: snapshot.ref, revision: 0 }],
    events: [{
      eventId: deps.eventId,
      eventType: "ArchitectureEvolutionPolicyInstalled",
      schemaVersion: 1,
      projectId: command.identity.projectId,
      workspaceId: "",
      aggregateType: "ArchitectureEvolutionPolicyRevision",
      aggregateId: P113_POLICY,
      aggregateRevision: 1,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt: deps.occurredAt,
      payload: { revision: snapshot },
    }],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

export function buildP113ActivateCommand(targetPin: ReturnType<typeof p113PolicyPin>, deps: { commandId: string; projectId: string; expectedRevision: number; idempotencyKey?: string }): ActivateProjectArchitectureEvolutionPolicyCommand {
  return {
    commandId: deps.commandId,
    commandType: "ActivateProjectArchitectureEvolutionPolicy",
    schemaVersion: 1,
    identity: { projectId: deps.projectId, actor: { kind: "human", id: "user-1" }, idempotencyKey: deps.idempotencyKey ?? deps.commandId + "-idem" },
    aggregateId: deps.projectId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.commandId + "-corr",
    submittedAt: P113_SCHEMA,
    payload: { target: { ...targetPin } },
  };
}

export function buildP113ActivateLedgerCommit(command: ActivateProjectArchitectureEvolutionPolicyCommand, deps: { eventId: string; occurredAt: string; activeAggregateRevision: number; projectRevision: number }): GovernanceActivateLedgerCommitV1 {
  const snapshot: ProjectArchitectureEvolutionPolicyActiveSnapshot = {
    ref: p113ActiveRef(command.identity.projectId),
    projectId: command.identity.projectId,
    activeRevision: command.payload.target.ref,
    revision: deps.activeAggregateRevision,
  };
  return {
    commitKind: "governance-activate",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: architectureEvolutionPolicyActivateFingerprint(command),
    expectedVersions: [
      { ref: { aggregateType: "Project" as const, projectId: command.identity.projectId }, revision: deps.projectRevision },
      { ref: snapshot.ref, revision: deps.activeAggregateRevision - 1 },
    ],
    events: [{
      eventId: deps.eventId,
      eventType: "ArchitectureEvolutionPolicyActivated",
      schemaVersion: 1,
      projectId: command.identity.projectId,
      workspaceId: "",
      aggregateType: "ProjectArchitectureEvolutionPolicyActive",
      aggregateId: command.identity.projectId,
      aggregateRevision: deps.activeAggregateRevision,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt: deps.occurredAt,
      payload: { activeRef: snapshot.ref, activeRevision: snapshot.activeRevision },
    }],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

export type P113PolicyState = { command: InstallArchitectureEvolutionPolicyRevisionCommand };
