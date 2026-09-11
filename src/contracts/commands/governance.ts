/** Formal command/value construction. Identity, authority, scope and time are caller inputs. */
import type { ActorRef, CommandIdentity } from "../command-event.js";
import type { VersionedCompletionPolicyFixture, InstallCompletionPolicyRevisionCommand, VersionedArchitectureBaselineFixture, InstallArchitectureBaselineRevisionCommand, ActivateProjectCompletionPolicyCommand, ActivateProjectArchitectureBaselineCommand, GovernanceInstallCommand, GovernanceActivateCommand, CompletionPolicyPin, ArchitectureBaselinePin } from "../governance.js";
import { governanceContentDigest } from "../governance.js";
import type { ActivateCoordinationPolicyCommand, CoordinationPolicyContentV1, CoordinationPolicyPin, InstallCoordinationPolicyCommand } from "../human-role-collaboration.js";
import { P15_COORDINATION_POLICY_REVISION, coordinationPolicyContentDigest } from "../human-role-collaboration.js";
import type { ActivateProjectArchitectureEvolutionPolicyCommand, ArchitectureEvolutionPolicyPin, InstallArchitectureEvolutionPolicyRevisionCommand, VersionedArchitectureEvolutionPolicyFixture } from "../architecture-evolution-policy.js";
import { architectureEvolutionPolicyContentDigest } from "../architecture-evolution-policy.js";
import type { ActivateRoleSpecRevisionCommand, InstallRoleSpecRevisionCommand, RoleSpecContentV1, RoleSpecPinV1 } from "../role-spec.js";
import { ROLE_SPEC_REVISION, roleSpecContentDigest } from "../role-spec.js";

export type BuildGovernanceCommandDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  projectId: string;
  actor: ActorRef;
  idempotencyKey: string;
};

export function buildInstallCommand(
  fixture: VersionedCompletionPolicyFixture | VersionedArchitectureBaselineFixture,
  deps: BuildGovernanceCommandDeps,
): GovernanceInstallCommand {
  const identity: CommandIdentity = {
    projectId: deps.projectId,
    actor: deps.actor,
    idempotencyKey: deps.idempotencyKey,
  };
  const contentDigest = governanceContentDigest(fixture);
  if ("policyId" in fixture.identity) {
    const fixture0 = fixture as VersionedCompletionPolicyFixture;
    const command: InstallCompletionPolicyRevisionCommand = {
      commandId: deps.commandId,
      commandType: "InstallCompletionPolicyRevision",
      schemaVersion: 1,
      identity,
      correlationId: deps.correlationId,
      submittedAt: deps.submittedAt,
      payload: { fixture: fixture0, contentDigest },
    };
    return command;
  }
  const fixture1 = fixture as VersionedArchitectureBaselineFixture;
  const command: InstallArchitectureBaselineRevisionCommand = {
    commandId: deps.commandId,
    commandType: "InstallArchitectureBaselineRevision",
    schemaVersion: 1,
    identity,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { fixture: fixture1, contentDigest },
  };
  return command;
}

export function buildActivateCommand(
  target: CompletionPolicyPin | ArchitectureBaselinePin,
  deps: BuildGovernanceCommandDeps & { expectedRevision: number },
): GovernanceActivateCommand {
  const identity: CommandIdentity = {
    projectId: deps.projectId,
    actor: deps.actor,
    idempotencyKey: deps.idempotencyKey,
  };
  if (target.ref.aggregateType === "CompletionPolicyRevision") {
    const t = target as CompletionPolicyPin;
    const command: ActivateProjectCompletionPolicyCommand = {
      commandId: deps.commandId,
      commandType: "ActivateProjectCompletionPolicy",
      schemaVersion: 1,
      identity,
      aggregateId: deps.projectId,
      expectedRevision: deps.expectedRevision,
      correlationId: deps.correlationId,
      submittedAt: deps.submittedAt,
      payload: { target: t },
    };
    return command;
  }
  const t = target as ArchitectureBaselinePin;
  const command: ActivateProjectArchitectureBaselineCommand = {
    commandId: deps.commandId,
    commandType: "ActivateProjectArchitectureBaseline",
    schemaVersion: 1,
    identity,
    aggregateId: deps.projectId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { target: t },
  };
  return command;
}

// ------------------------------------------------------------------------ //
// P1-15 CoordinationPolicy 与 P1-13 ArchitectureEvolutionPolicy             //
// ------------------------------------------------------------------------ //
/** 治理命令的唯一字段构造入口。应用提供身份、时间与幂等键；
 * src/fixtures 中的包装只提供样例默认值。内容摘要复用
 * coordinationPolicyContentDigest / architectureEvolutionPolicyContentDigest，
 * 与 Control 安装守卫保持同一口径。 */
export function buildCoordinationPolicyInstallCommand(
  input: { policyId: string; content: CoordinationPolicyContentV1 },
  deps: BuildGovernanceCommandDeps,
): InstallCoordinationPolicyCommand {
  return {
    commandId: deps.commandId,
    commandType: "InstallCoordinationPolicy",
    schemaVersion: 1,
    identity: { projectId: deps.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: {
      policyId: input.policyId,
      content: input.content,
      contentDigest: coordinationPolicyContentDigest(input.content, input.policyId, P15_COORDINATION_POLICY_REVISION),
    },
  };
}

export function buildCoordinationPolicyActivateCommand(
  target: CoordinationPolicyPin,
  deps: BuildGovernanceCommandDeps & { expectedRevision: number },
): ActivateCoordinationPolicyCommand {
  return {
    commandId: deps.commandId,
    commandType: "ActivateCoordinationPolicy",
    schemaVersion: 1,
    identity: { projectId: deps.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    aggregateId: deps.projectId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { target },
  };
}

// ------------------------------------------------------------------------ //
// RW-11 RoleSpecRevision                                                    //
// ------------------------------------------------------------------------ //
/**
 * 与 CoordinationPolicy 同理，这两种命令的**字段级构造**只在这里出现一次：
 * 应用层／夹具只提供 identity／时间／幂等键与规格正文，摘要口径
 * （roleSpecContentDigest(content, roleId, ROLE_SPEC_REVISION)）也在这里算，
 * 不留给每个调用方各自再算一遍（否则会出现第二份口径）。
 */
export function buildRoleSpecInstallCommand(
  input: { roleId: string; content: RoleSpecContentV1 },
  deps: BuildGovernanceCommandDeps,
): InstallRoleSpecRevisionCommand {
  return {
    commandId: deps.commandId,
    commandType: "InstallRoleSpecRevision",
    schemaVersion: 1,
    identity: { projectId: deps.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: {
      roleId: input.roleId,
      content: input.content,
      contentDigest: roleSpecContentDigest(input.content, input.roleId, ROLE_SPEC_REVISION),
    },
  };
}

export function buildRoleSpecActivateCommand(
  target: RoleSpecPinV1,
  deps: BuildGovernanceCommandDeps & { expectedRevision: number },
): ActivateRoleSpecRevisionCommand {
  return {
    commandId: deps.commandId,
    commandType: "ActivateRoleSpecRevision",
    schemaVersion: 1,
    identity: { projectId: deps.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    aggregateId: target.ref.roleId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { target },
  };
}

export function buildArchitectureEvolutionPolicyInstallCommand(
  fixture: VersionedArchitectureEvolutionPolicyFixture,
  deps: BuildGovernanceCommandDeps,
): InstallArchitectureEvolutionPolicyRevisionCommand {
  return {
    commandId: deps.commandId,
    commandType: "InstallArchitectureEvolutionPolicyRevision",
    schemaVersion: 1,
    identity: { projectId: deps.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { fixture, contentDigest: architectureEvolutionPolicyContentDigest(fixture) },
  };
}

export function buildArchitectureEvolutionPolicyActivateCommand(
  target: ArchitectureEvolutionPolicyPin,
  deps: BuildGovernanceCommandDeps & { expectedRevision: number },
): ActivateProjectArchitectureEvolutionPolicyCommand {
  return {
    commandId: deps.commandId,
    commandType: "ActivateProjectArchitectureEvolutionPolicy",
    schemaVersion: 1,
    identity: { projectId: deps.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    aggregateId: deps.projectId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { target },
  };
}
