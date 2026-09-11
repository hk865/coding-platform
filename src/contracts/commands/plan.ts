/** Formal command/value construction. Identity, authority, scope and time are caller inputs. */
import type { CommandIdentity } from "../command-event.js";
import type { ApplyPlanRevisionCommand, PlanRevisionDraft } from "../plan.js";

export type BuildApplyPlanDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  projectId: string;
  actor: CommandIdentity["actor"];
  idempotencyKey: string;
  /** expected Goal revision (CAS; 1 after CreateGoal). */
  expectedRevision: number;
  goalId: string;
};

export function buildApplyPlanCommand(
  draft: PlanRevisionDraft,
  deps: BuildApplyPlanDeps,
): ApplyPlanRevisionCommand {
  const goalId = deps.goalId;
  return {
    commandId: deps.commandId,
    commandType: "ApplyPlanRevision",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor,
      idempotencyKey: deps.idempotencyKey,
    },
    aggregateId: goalId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { plan: draft },
  };
}
