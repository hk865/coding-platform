/**
 * P1-07 lane B unit tests: WorkspaceDriveEngineImpl.driveParallel.
 *
 * driveParallel processes the (projectId, goalId) slice's pending intents:
 * ALL eligible intents are assembled -> startRun -> runtime.start CONCURRENTLY
 * (real overlap), then the runtime handles are consumed in parallel. Material
 * overlap is measured with the frozen ParallelProbeRuntime (all start() calls
 * MUST precede any pollFreshEvents()).
 *
 * NOTE on the scenario: the frozen prepareP107Scenario bootstraps the standard
 * WORKSPACE_BOOTSTRAP_FIXTURE_V1 (proj-alpha/proj-beta) while the P1-07 project
 * is proj-p107 (NOT created by that fixture, and a later bootstrap would fail
 * the ledger's only-if-empty guard). We therefore build the P1-07 scenario
 * locally (one bootstrap for proj-p107, then install/activate/createGoal/
 * applyPlan) — mirroring the frozen builder, not modifying it.
 *
 * Coverage:
 *   - A1/A2 happy path: two readers overlap for real, started before any poll,
 *     scanned=started=completed=2, no failures, independent attempts;
 *   - maxIntents caps the per-drive scan (the second reader stays pending);
 *   - runtime.start throw -> runtime_error failure, run already started.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import type { RunPort, RunHandle, RunCapabilities } from "../../src/contracts/ports.js";
import type { TaskEnvelopeV1 } from "../../src/contracts/task-envelope.js";
import { dispatchOutboxRefFor } from "../../src/contracts/dispatch.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import {
  buildInstallCommand,
  buildActivateCommand,
  completionPolicyPinFor,
  architectureBaselinePinFor,
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  COMPLETION_POLICY_FIXTURE_V1,
} from "../../src/contracts/fixtures/governance-fixtures.js";
import { buildCreateGoalCommand } from "../../src/contracts/fixtures/goal-fixtures.js";
import { buildApplyPlanCommand } from "../../src/contracts/fixtures/plan-fixtures.js";
import {
  P107_PROJECT,
  P107_WORKSPACE,
  P107_SCHEMA,
  P107_PLAN_REVISION_FIXTURE_V1,
} from "../../src/contracts/fixtures/workspace-fixtures.js";
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
async function setupP107Scenario(h: ReturnType<typeof createInMemoryHarness>): Promise<P107Scenario> {
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

const claimReader = async (h: ReturnType<typeof toP1_07Harness>, reader: "a" | "b") => {
  await claimP107Task(h, {
    taskId: reader === "a" ? P107_TASK_READER_A : P107_TASK_READER_B,
    runId: "run-p107-read-" + reader,
    attemptId: "att-p107-read-" + reader,
    roleBinding: P107_ROLE_BINDING_READER_V1,
    declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1,
    budget: P107_BUDGET_READER_V1,
  });
};

describe("WorkspaceDriveEngineImpl.driveParallel", () => {
  it("A1/A2: two readers overlap for real; all starts precede any poll", async () => {
    const probe = new ParallelProbeRuntime((envelope) => {
      if (envelope.taskId === P107_TASK_READER_A) return p107ReaderScript("a", "2026-09-06T12:00:10.000Z", "2026-09-06T12:00:40.000Z");
      return p107ReaderScript("b", "2026-09-06T12:00:20.000Z", "2026-09-06T12:00:50.000Z");
    });
    const harness = createInMemoryHarness({ runtime: probe });
    await setupP107Scenario(harness);
    const h = toP1_07Harness(harness as unknown as P1_07HarnessLike);
    await claimReader(h, "a");
    await claimReader(h, "b");

    const result = await h.workspaceDrive.driveParallel({
      schemaVersion: 1,
      reason: "P1-07 overlap",
      projectId: P107_PROJECT,
      goalId: P107_GOAL,
      maxIntents: 4,
    });
    expect(result.failures).toHaveLength(0);
    expect(result.scanned).toBe(2);
    expect(result.started).toBe(2);
    expect(result.completed).toBe(2);
    expect(result.pendingRemaining).toBe(0);

    // REAL overlap: both fired before any consumption (no implicit ordering).
    expect(probe.started).toHaveLength(2);
    expect(probe.started).toEqual([P107_TASK_READER_A, P107_TASK_READER_B].sort((a, b) => a.localeCompare(b)));
    // windows: A [10,40], B [20,50] -> overlap = [20,40]
    const winA = probe.windows["run-p107-read-a"]!;
    const winB = probe.windows["run-p107-read-b"]!;
    expect(winA.startedAt).toBe("2026-09-06T12:00:10.000Z");
    expect(winA.terminalAt).toBe("2026-09-06T12:00:40.000Z");
    expect(winB.startedAt).toBe("2026-09-06T12:00:20.000Z");
    expect(winB.terminalAt).toBe("2026-09-06T12:00:50.000Z");
    expect(winA.startedAt < winB.startedAt && winB.startedAt < winA.terminalAt && winA.terminalAt < winB.terminalAt).toBe(true);

    // independent attempt/context/budget: each run has its own outbox entry.
    const outA = await h.ledger.load(dispatchOutboxRefFor(P107_PROJECT, P107_GOAL, P107_TASK_READER_A, "att-p107-read-a"));
    const outB = await h.ledger.load(dispatchOutboxRefFor(P107_PROJECT, P107_GOAL, P107_TASK_READER_B, "att-p107-read-b"));
    expect(outA.status).toBe("found");
    expect(outB.status).toBe("found");
    if (outA.status === "found" && outB.status === "found") {
      const intentA = (outA.snapshot as { intent: { attemptRef: { attemptId: string }; runRef: { runId: string } } }).intent;
      const intentB = (outB.snapshot as { intent: { attemptRef: { attemptId: string }; runRef: { runId: string } } }).intent;
      expect(intentA.attemptRef.attemptId).not.toBe(intentB.attemptRef.attemptId);
      expect(intentA.runRef.runId).not.toBe(intentB.runRef.runId);
    }
  });

  it("maxIntents bounds the per-drive scan (the second reader stays pending)", async () => {
    const harness = createInMemoryHarness();
    await setupP107Scenario(harness);
    const h = toP1_07Harness(harness as unknown as P1_07HarnessLike);
    await claimReader(h, "a");
    await claimReader(h, "b");

    const result = await h.workspaceDrive.driveParallel({
      schemaVersion: 1,
      reason: "P1-07 bounded",
      projectId: P107_PROJECT,
      goalId: P107_GOAL,
      maxIntents: 1,
    });
    expect(result.failures).toHaveLength(0);
    expect(result.scanned).toBe(1);
    expect(result.started).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.pendingRemaining).toBe(1);
  });

  it("runtime.start throw -> runtime_error failure; the run is already started", async () => {
    const throwingRuntime: RunPort = {
      capabilities: async (): Promise<RunCapabilities> => ({ replayable: true, supportsSnapshot: false, maxEnvelopeBytes: 64 * 1024 }),
      start: async (envelope: TaskEnvelopeV1): Promise<RunHandle> => {
        if (envelope.taskId === P107_TASK_READER_A) throw new Error("runtime trap A");
        return { runRef: envelope.runRef, pollFreshEvents: async () => [] };
      },
    };
    const harness = createInMemoryHarness({ runtime: throwingRuntime });
    await setupP107Scenario(harness);
    const h = toP1_07Harness(harness as unknown as P1_07HarnessLike);
    await claimReader(h, "a");
    await claimReader(h, "b");

    const result = await h.workspaceDrive.driveParallel({
      schemaVersion: 1,
      reason: "P1-07 runtime failure",
      projectId: P107_PROJECT,
      goalId: P107_GOAL,
      maxIntents: 4,
    });
    expect(result.started).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.intentId).toBe("att-p107-read-a");
    expect(result.failures[0]!.code).toBe("runtime_error");
  });
});
