/** Formal command/value construction. Identity, authority, scope and time are caller inputs. */
import type { RoleBindingRefV1, RunRef, TaskAttemptRef } from "../dispatch.js";
import type { CommandIdentity } from "../command-event.js";
import type { AcquireWorkspaceReadLeaseCommand, AcquireWorkspaceWriteLeaseCommand, ConflictScopeV1, ReleaseWorkspaceLeaseCommand } from "../workspace-lease.js";
import type { PatchArtifactV1, RecordPatchCommand } from "../patch.js";

export type BuildAcquireReadDeps = {
  commandId: string;
  projectId: string;
  workspaceId: string;
  leaseId: string;
  scope: ConflictScopeV1;
  holder: { runRef: RunRef; attemptRef: TaskAttemptRef; roleBinding: RoleBindingRefV1 };
  expiresAt: string | null;
  actor: WorkspaceCommandActor;
  idempotencyKey: string;
  correlationId: string;
  submittedAt: string;
};

export type BuildAcquireWriteDeps = {
  commandId: string;
  projectId: string;
  workspaceId: string;
  leaseId: string;
  scope: ConflictScopeV1;
  declaredWriteScope: string[];
  holder: { runRef: RunRef; attemptRef: TaskAttemptRef; roleBinding: RoleBindingRefV1 };
  expiresAt: string | null;
  actor: WorkspaceCommandActor;
  idempotencyKey: string;
  correlationId: string;
  submittedAt: string;
};

export type BuildReleaseDeps = {
  commandId: string;
  projectId: string;
  workspaceId: string;
  leaseId: string;
  kind: "read" | "write";
  holderRunRef: RunRef;
  actor: WorkspaceCommandActor;
  idempotencyKey: string;
  correlationId: string;
  submittedAt: string;
};

export type BuildRecordPatchDeps = {
  commandId: string;
  projectId: string;
  patch: PatchArtifactV1;
  actor: WorkspaceCommandActor;
  idempotencyKey: string;
  correlationId: string;
  submittedAt: string;
};

export type WorkspaceCommandActor = CommandIdentity["actor"];

export function buildAcquireReadLeaseCommand(deps: BuildAcquireReadDeps): AcquireWorkspaceReadLeaseCommand {
  return {
    commandId: deps.commandId,
    commandType: "AcquireWorkspaceReadLease",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor,
      idempotencyKey: deps.idempotencyKey,
    },
    aggregateId: deps.leaseId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: {
      projectId: deps.projectId,
      workspaceId: deps.workspaceId,
      scope: deps.scope,
      holder: deps.holder,
      expiresAt: deps.expiresAt,
    },
  };
}

export function buildAcquireWriteLeaseCommand(deps: BuildAcquireWriteDeps): AcquireWorkspaceWriteLeaseCommand {
  return {
    commandId: deps.commandId,
    commandType: "AcquireWorkspaceWriteLease",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor,
      idempotencyKey: deps.idempotencyKey,
    },
    aggregateId: deps.leaseId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: {
      projectId: deps.projectId,
      workspaceId: deps.workspaceId,
      scope: deps.scope,
      holder: deps.holder,
      expiresAt: deps.expiresAt,
      declaredWriteScope: deps.declaredWriteScope,
    },
  };
}

export function buildReleaseLeaseCommand(deps: BuildReleaseDeps): ReleaseWorkspaceLeaseCommand {
  return {
    commandId: deps.commandId,
    commandType: "ReleaseWorkspaceLease",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor,
      idempotencyKey: deps.idempotencyKey,
    },
    aggregateId: deps.leaseId,
    expectedRevision: 1,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: {
      projectId: deps.projectId,
      workspaceId: deps.workspaceId,
      kind: deps.kind,
      leaseId: deps.leaseId,
      holderRunRef: deps.holderRunRef,
    },
  };
}

export function buildRecordPatchCommand(deps: BuildRecordPatchDeps): RecordPatchCommand {
  return {
    commandId: deps.commandId,
    commandType: "RecordPatch",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor,
      idempotencyKey: deps.idempotencyKey,
    },
    aggregateId: deps.patch.patchId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { patch: deps.patch },
  };
}
