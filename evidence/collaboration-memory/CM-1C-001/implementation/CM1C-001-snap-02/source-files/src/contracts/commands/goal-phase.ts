/** Formal command/value construction. Identity, authority, scope and time are caller inputs. */
import type { CommandIdentity } from "../command-event.js";

export type BuildReduceGoalDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  expectedRevision: number;
  projectId: string;
  goalId: string;
  actor: CommandIdentity["actor"];
  idempotencyKey: string;
};

export function buildReduceGoalCommand(deps: BuildReduceGoalDeps) {
  return {
    commandId: deps.commandId,
    commandType: "ReduceGoal" as const,
    schemaVersion: 1 as const,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor,
      idempotencyKey: deps.idempotencyKey,
    },
    aggregateId: deps.goalId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { goalId: deps.goalId },
  };
}
