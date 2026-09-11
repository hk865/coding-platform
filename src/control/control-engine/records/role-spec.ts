/** Control-owned canonical record construction (RW-11 role-spec governance). */
import {
  ROLE_SPEC_REVISION,
  activateRoleSpecRevisionFingerprint,
  installRoleSpecRevisionFingerprint,
  projectRoleSpecActiveRefFor,
  roleSpecRevisionRefFor,
  type ActivateRoleSpecRevisionCommand,
  type InstallRoleSpecRevisionCommand,
  type ProjectRoleSpecActiveSnapshot,
  type RoleSpecRevisionSnapshot,
} from "../../../contracts/role-spec.js";

/**
 * role-spec-install：一个不可改写的 RoleSpecRevision（CAS@0）+ 一条安装事件。
 * 与 P1-15 的 policy install fold 同构，区别只在聚合身份（roleId）与内容类型。
 */
export function buildRoleSpecInstallFold(
  command: InstallRoleSpecRevisionCommand,
  deps: { eventId: string; occurredAt: string },
): import("../../../contracts/ledger.js").RoleSpecInstallRecordLedgerCommitV1 {
  const snap: RoleSpecRevisionSnapshot = {
    ref: roleSpecRevisionRefFor(command.identity.projectId, command.payload.roleId),
    revision: 1,
    schemaVersion: 1,
    roleId: command.payload.roleId,
    contentRevision: ROLE_SPEC_REVISION,
    content: command.payload.content,
    contentDigest: command.payload.contentDigest,
    installedAt: deps.occurredAt,
  };
  return {
    commitKind: "role-spec-install",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: installRoleSpecRevisionFingerprint(command),
    expectedVersions: [{ ref: snap.ref, revision: 0 }],
    events: [
      {
        eventId: deps.eventId,
        eventType: "RoleSpecInstalled",
        schemaVersion: 1,
        projectId: command.identity.projectId,
        workspaceId: "",
        aggregateType: "RoleSpecRevision",
        aggregateId: command.payload.roleId,
        aggregateRevision: 1,
        causationId: command.commandId,
        correlationId: command.correlationId,
        idempotencyKey: command.identity.idempotencyKey,
        actor: { ...command.identity.actor },
        occurredAt: deps.occurredAt,
        payload: { revision: snap },
      },
    ],
    snapshots: [snap],
    outboxIntents: [],
  };
}

/**
 * role-spec-activate：把一个角色在项目上的生效引用 CAS 到已安装的规格 revision。
 * CAS 是 [Project@expected（形状；运行时由账本判定）] + [该角色生效聚合 @(revision-1)]，
 * 与 P1-02／P1-15 同口径；被拒绝的提交绝不移动生效引用（零写入）。
 */
export function buildRoleSpecActivateFold(
  command: ActivateRoleSpecRevisionCommand,
  deps: { eventId: string; occurredAt: string; activeAggregateRevision: number; projectRevision: number },
): import("../../../contracts/ledger.js").RoleSpecActivateRecordLedgerCommitV1 {
  const roleId = command.payload.target.ref.roleId;
  const snap: ProjectRoleSpecActiveSnapshot = {
    ref: projectRoleSpecActiveRefFor(command.identity.projectId, roleId),
    projectId: command.identity.projectId,
    roleId,
    activeRevision: command.payload.target.ref,
    revision: deps.activeAggregateRevision,
  };
  return {
    commitKind: "role-spec-activate",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: activateRoleSpecRevisionFingerprint(command),
    expectedVersions: [
      { ref: { aggregateType: "Project" as const, projectId: command.identity.projectId }, revision: deps.projectRevision },
      { ref: snap.ref, revision: deps.activeAggregateRevision - 1 },
    ],
    events: [
      {
        eventId: deps.eventId,
        eventType: "RoleSpecActivated",
        schemaVersion: 1,
        projectId: command.identity.projectId,
        workspaceId: "",
        aggregateType: "ProjectRoleSpecActive",
        aggregateId: roleId,
        aggregateRevision: deps.activeAggregateRevision,
        causationId: command.commandId,
        correlationId: command.correlationId,
        idempotencyKey: command.identity.idempotencyKey,
        actor: { ...command.identity.actor },
        occurredAt: deps.occurredAt,
        payload: { activeRef: snap.ref, activeRevision: snap.activeRevision },
      },
    ],
    snapshots: [snap],
    outboxIntents: [],
  };
}
