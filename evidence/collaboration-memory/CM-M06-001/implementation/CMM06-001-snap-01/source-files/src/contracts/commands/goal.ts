/** Formal command/value construction. Identity, authority, scope and time are caller inputs. */
import type { ActorRef, CreateGoalCommand } from "../command-event.js";

export type CreateGoalScope = {
  projectId: string;
  workspaceId: string;
  goalId: string;
  objective: string;
  actor: ActorRef;
};

export type BuildCreateGoalDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  idempotencyKey: string;
};

export function buildCreateGoalCommand(
  scope: CreateGoalScope,
  deps: BuildCreateGoalDeps,
): CreateGoalCommand {
  return {
    commandId: deps.commandId,
    commandType: "CreateGoal",
    schemaVersion: 1,
    identity: {
      projectId: scope.projectId,
      actor: { ...scope.actor },
      idempotencyKey: deps.idempotencyKey,
    },
    aggregateId: scope.goalId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: {
      workspaceId: scope.workspaceId,
      objective: scope.objective,
    },
  };
}
