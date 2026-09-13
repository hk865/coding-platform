/** Shared P1-07 canonical plan setup for actual Runtime concurrency scenarios. */
import { expect } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import type { RunPort, RunHandle, RunCapabilities } from "../../src/contracts/ports.js";
import type { TaskEnvelopeV1 } from "../../src/contracts/task-envelope.js";
import { dispatchOutboxRefFor } from "../../src/contracts/dispatch.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { buildInstallCommand, buildActivateCommand, ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1 } from "../../src/fixtures/governance-fixtures.js";
import { completionPolicyPinFor, architectureBaselinePinFor } from "../../src/contracts/governance.js";
import { buildCreateGoalCommand } from "../contract-support/fixtures/goal-fixtures.js";
import { buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import {
  P107_PROJECT,
  P107_WORKSPACE,
  P107_SCHEMA,
  P107_PLAN_REVISION_FIXTURE_V1,
} from "../contract-support/fixtures/workspace-fixtures.js";
import {
  p107GoalScope,
  p107PlanRef,
  toP1_07Harness,
  claimP107Task,
  ParallelProbeRuntime,
  p107ReaderScript,
  P107_GOAL,
  P107_TASK_READER_A,
  P107_TASK_READER_B,
  P107_ROLE_BINDING_READER_V1,
  P107_DECLARED_READ_PERMISSIONS_V1,
  P107_BUDGET_READER_V1,
} from "../contract-suite/p1-07-harness.js";
import type { P1_07HarnessLike } from "../contract-suite/p1-07-harness.js";
import type { PlanRevisionSnapshot, PlanRevisionRef } from "../../src/contracts/plan.js";

type P107Scenario = {
  planRef: PlanRevisionRef;
  planSnapshot: PlanRevisionSnapshot;
  workspaceRevision: number;
  pinnedCompletionPolicy: ReturnType<typeof completionPolicyPinFor>;
  pinnedArchitectureBaseline: ReturnType<typeof architectureBaselinePinFor>;
};

/** Build the P1-07 scenario locally (proj-p107 is the only project). */
export async function setupP107Scenario(h: Pick<ReturnType<typeof createInMemoryHarness>, 'bootstrap' | 'install' | 'activate' | 'control' | 'applyPlan' | 'ledger'>): Promise<P107Scenario> {
  const boot = await h.bootstrap(
    buildBootstrapCommand(
      { schemaVersion: 1, entries: [{ projectId: P107_PROJECT, workspaceId: P107_WORKSPACE }] },
      { commandId: "cmd-p107-boot", correlationId: "corr-p107-boot", submittedAt: P107_SCHEMA },
    ),
  );
  expect(boot.status).toBe("committed");

  const installPolicy = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-p107-install-policy", correlationId: "corr-p107-install-policy", submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT, idempotencyKey: "p107-install-policy",
  });
  const installBaseline = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-p107-install-baseline", correlationId: "corr-p107-install-baseline", submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT, idempotencyKey: "p107-install-baseline",
  });
  expect((await h.install(installPolicy)).status).toBe("committed");
  expect((await h.install(installBaseline)).status).toBe("committed");

  const actPolicy = buildActivateCommand(completionPolicyPinFor(installPolicy as never), {
    commandId: "cmd-p107-activate-policy", correlationId: "corr-p107-activate-policy", submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT, expectedRevision: 1, idempotencyKey: "p107-activate-policy",
  });
  const actBaseline = buildActivateCommand(architectureBaselinePinFor(installBaseline as never), {
    commandId: "cmd-p107-activate-baseline", correlationId: "corr-p107-activate-baseline", submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT, expectedRevision: 1, idempotencyKey: "p107-activate-baseline",
  });
  expect((await h.activate(actPolicy)).status).toBe("committed");
  expect((await h.activate(actBaseline)).status).toBe("committed");

  const goal = await h.control.submit(
    buildCreateGoalCommand(p107GoalScope(), {
      commandId: "cmd-p107-create-goal", correlationId: "corr-p107-create-goal", submittedAt: P107_SCHEMA,
      idempotencyKey: "p1-07-create-goal",
    }),
  );
  expect(goal.status).toBe("committed");

  const plan = await h.applyPlan(
    buildApplyPlanCommand(P107_PLAN_REVISION_FIXTURE_V1, {
      commandId: "cmd-p107-apply-plan", correlationId: "corr-p107-apply-plan", submittedAt: P107_SCHEMA,
      projectId: P107_PROJECT, expectedRevision: 1, idempotencyKey: "p1-07-apply-plan",
    }),
  );
  expect(plan.status).toBe("committed");

  const planLoad = await h.ledger.load(p107PlanRef(P107_PROJECT));
  const wsLoad = await h.ledger.load({ aggregateType: "Workspace" as const, projectId: P107_PROJECT, workspaceId: P107_WORKSPACE });
  expect(planLoad.status).toBe("found");
  expect(wsLoad.status).toBe("found");
  return {
    planRef: p107PlanRef(P107_PROJECT),
    planSnapshot: planLoad.status === "found" ? (planLoad.snapshot as PlanRevisionSnapshot) : (null as unknown as PlanRevisionSnapshot),
    workspaceRevision: wsLoad.status === "found" ? (wsLoad.snapshot as { revision: number }).revision : 1,
    pinnedCompletionPolicy: completionPolicyPinFor(installPolicy as never),
    pinnedArchitectureBaseline: architectureBaselinePinFor(installBaseline as never),
  };
}

