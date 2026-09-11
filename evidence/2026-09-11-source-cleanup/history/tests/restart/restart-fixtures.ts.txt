/**
 * P1-01 restart-path fixtures — deterministic bootstrap + two-scope CreateGoal
 * steps. Reuses the SHARED P1-00 contract fixtures (no re-interpretation of
 * the protocol here); only command envelope deps are fixed per run.
 * Owner: P1-01 lane C (skeleton by integrator, 2026-09-05).
 */
import type {
  WorkspaceBootstrapCommand,
  WorkspaceBootstrapReceipt,
} from "../../src/contracts/bootstrap.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  type GoalFixtureScope,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import type { CreateGoalResult } from "../../src/contracts/modules.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";

/** Shared fixture: two projects REUSE the same local workspaceId/goalId. */
export const RESTART_FIXTURE = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1;
export const RESTART_ALPHA: GoalFixtureScope = RESTART_FIXTURE.scopes[0]!;
export const RESTART_BETA: GoalFixtureScope = RESTART_FIXTURE.scopes[1]!;

export function bootCommandFor(commandId: string): WorkspaceBootstrapCommand {
  return buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId,
    correlationId: "corr-boot-" + commandId,
    submittedAt: FIXED_ISO_2026_09_05,
  });
}

export interface RestartRuns {
  bootstrap: WorkspaceBootstrapReceipt;
  alpha: CreateGoalResult;
  beta: CreateGoalResult;
}

/** bootstrap -> CreateGoal(alpha) -> CreateGoal(beta), same idempotency key per scope. */
export async function runBootstrapAndCreateGoals(
  harness: PersistentSqliteHarness,
): Promise<RestartRuns> {
  const bootstrap = await harness.bootstrap(bootCommandFor("r-boot-1"));
  const alpha = await harness.collaboration.createGoal({
    projectId: RESTART_ALPHA.projectId,
    workspaceId: RESTART_ALPHA.workspaceId,
    goalId: RESTART_ALPHA.goalId,
    objective: RESTART_ALPHA.objective,
    actor: RESTART_ALPHA.actor,
    idempotencyKey: RESTART_FIXTURE.sharedIdempotencyKey,
  });
  const beta = await harness.collaboration.createGoal({
    projectId: RESTART_BETA.projectId,
    workspaceId: RESTART_BETA.workspaceId,
    goalId: RESTART_BETA.goalId,
    objective: RESTART_BETA.objective,
    actor: RESTART_BETA.actor,
    idempotencyKey: RESTART_FIXTURE.sharedIdempotencyKey,
  });
  return { bootstrap, alpha, beta };
}
