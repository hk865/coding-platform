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
    payload: { envelope: deps.envelope, manifest: deps.manifest },
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
