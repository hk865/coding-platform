/** Formal command/value construction. Identity, authority, scope and time are caller inputs. */
import type { CommandIdentity } from "../command-event.js";
import type { DispatchClaimCommand, DispatchStartCommand, RoleBindingRefV1, RunFactCommand, RunFactV1, TaskBudgetV1 } from "../dispatch.js";
import type { TaskEnvelopeV1, ContextManifestV1 } from "../task-envelope.js";

export type BuildDispatchClaimDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  projectId: string;
  actor: CommandIdentity["actor"];
  idempotencyKey: string;
  goalId: string;
  taskId: string;
  attemptId: string;
  runId: string;
  roleBinding: RoleBindingRefV1;
  declaredPermissions: { tools: string[]; writeScope: string[] };
  budget: TaskBudgetV1;
};

export type BuildRunFactDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  projectId: string;
  actor: CommandIdentity["actor"];
  idempotencyKey: string;
  runId: string;
  expectedRevision: number;
  fact: RunFactV1;
};

export function buildDispatchClaimCommand(
  deps: BuildDispatchClaimDeps,
): DispatchClaimCommand {
  return {
    commandId: deps.commandId,
    commandType: "DispatchClaimTask",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor,
      idempotencyKey: deps.idempotencyKey,
    },
    aggregateId: deps.taskId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: {
      goalId: deps.goalId,
      attemptId: deps.attemptId,
      runId: deps.runId,
      roleBinding: deps.roleBinding,
      declaredPermissions: deps.declaredPermissions,
      budget: deps.budget,
    },
  };
}

export function buildDispatchStartCommand(
  deps: {
    commandId: string;
    correlationId: string;
    submittedAt: string;
    projectId: string;
    actor: CommandIdentity["actor"];
    idempotencyKey: string;
    runId: string;
    expectedRevision: number;
    envelope: TaskEnvelopeV1;
    manifest: ContextManifestV1;
    executionConsumerId?: string;
  },
): DispatchStartCommand {
  return {
    commandId: deps.commandId,
    commandType: "DispatchStartRun",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor,
      idempotencyKey: deps.idempotencyKey,
    },
    aggregateId: deps.runId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { envelope: deps.envelope, manifest: deps.manifest, ...(deps.executionConsumerId === undefined ? {} : { executionConsumerId: deps.executionConsumerId }) },
  };
}

export function buildRunFactCommand(deps: BuildRunFactDeps): RunFactCommand {
  return {
    commandId: deps.commandId,
    commandType: "RunFact",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor,
      idempotencyKey: deps.idempotencyKey,
    },
    aggregateId: deps.runId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { fact: deps.fact },
  };
}
export type BuildAuthorizeModelRequestDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  projectId: string;
  actor: CommandIdentity["actor"];
  idempotencyKey: string;
  runId: string;
  expectedRevision: number;
  workspaceId: string;
  goalId: string;
  permitId: string;
  requestId?: string; requestDigest?: string; contextInputDigest?: string; manifestDigest?: string;
};

/** 签发一次性模型调用许可（Control 复核 exact Run + 材料版本 + 授权后写这条命令）。 */
export function buildAuthorizeModelRequestCommand(deps: BuildAuthorizeModelRequestDeps): import("../dispatch.js").AuthorizeModelRequestCommand {
  return {
    commandId: deps.commandId,
    commandType: "AuthorizeModelRequest",
    schemaVersion: 1,
    identity: { projectId: deps.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    aggregateId: deps.runId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { workspaceId: deps.workspaceId, goalId: deps.goalId, permitId: deps.permitId,
      ...(deps.requestId === undefined ? {} : { requestId: deps.requestId }),
      ...(deps.requestDigest === undefined ? {} : { requestDigest: deps.requestDigest }),
      ...(deps.contextInputDigest === undefined ? {} : { contextInputDigest: deps.contextInputDigest }),
      ...(deps.manifestDigest === undefined ? {} : { manifestDigest: deps.manifestDigest }) },
  };
}

/** 一次调用尝试的事实命令（Runtime 侧消费许可；第二次尝试用同一许可会被账本拒绝）。 */
export function buildModelRequestEvidenceFactCommand(deps: Omit<BuildRunFactDeps, "fact"> & {
  fact: Extract<RunFactV1, { kind: "model_request_evidence" }>;
}): RunFactCommand {
  return buildRunFactCommand(deps);
}