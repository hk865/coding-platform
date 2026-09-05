/**
 * P1-03 lane A unit tests: evaluateDispatchReadiness (read-only eligibility).
 *
 * Driven through a real ControlEngineImpl over a real InMemoryLedger, with the
 * scenario state (goal with accepted plan) established via direct ledger commits
 * so the readiness path is exercised deterministically. Readiness is ZERO-WRITE.
 *
 * Coverage:
 *   - readiness table over the shared fixture (deps / blocked / deferred / gate
 *     / absent / eligible) — status ready with the exact eligibility reasons;
 *   - goal without an accepted plan -> not_found/plan; missing goal ->
 *     not_found/goal;
 *   - a held lease -> resource_unavailable(leased) (readiness reflects the lease
 *     even though readiness is read-only); budget/deadline rules.
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine.js";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import type { StateLedger } from "../../src/contracts/ledger.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  buildGoalCreateLedgerCommit,
  goalSnapshotFor,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  COMPLETION_POLICY_FIXTURE_V1,
  buildActivateCommand,
  buildActivateLedgerCommit,
  buildInstallCommand,
  buildInstallLedgerCommit,
  completionPolicyPinFor,
  architectureBaselinePinFor,
} from "../../src/contracts/fixtures/governance-fixtures.js";
import {
  DISPATCH_PLAN_REVISION_FIXTURE_V1,
  DISPATCH_ELIGIBLE_TASK_ID,
  DISPATCH_DEPENDENT_TASK_ID,
  DISPATCH_BLOCKED_TASK_ID,
  DISPATCH_DEFERRED_TASK_ID,
  DISPATCH_GATE_TASK_ID,
  buildDispatchClaimCommand,
} from "../../src/contracts/fixtures/dispatch-fixtures.js";
import type { InstallArchitectureBaselineRevisionCommand, InstallCompletionPolicyRevisionCommand } from "../../src/contracts/governance.js";
import { buildApplyPlanCommand, buildPlanLedgerCommit } from "../../src/contracts/fixtures/plan-fixtures.js";
import type { DispatchReadinessResult, DispatchReadinessQuery } from "../../src/contracts/dispatch.js";

const FIXED = FIXED_ISO_2026_09_05;

function makeHarness() {
  const ledger = new InMemoryLedger();
  const d = createDeterministicDeps();
  const engine = createControlEngine({ ledger, now: d.clock, eventId: d.eventId });
  return { ledger, engine };
}

async function bootstrap(ledger: StateLedger): Promise<void> {
  const bootCmd = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, { commandId: "cmd-bootstrap", correlationId: "corr-bootstrap", submittedAt: FIXED });
  await ledger.commit(
    buildBootstrapLedgerCommit(bootCmd, { eventIds: ["evt-bootstrap-1", "evt-bootstrap-2", "evt-bootstrap-3", "evt-bootstrap-4"], occurredAt: FIXED }),
  );
}

async function createGoal(ledger: StateLedger): Promise<void> {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
  const cmd = buildCreateGoalCommand(scope, { commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: FIXED });
  await ledger.commit(
    buildGoalCreateLedgerCommit(cmd, { eventId: "evt-goal", occurredAt: FIXED, projectRevision: 1, workspaceRevision: 1 }),
  );
}

async function installActivateAndPlan(ledger: StateLedger): Promise<void> {
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, { commandId: "cmd-install-cp", correlationId: "corr-install-cp", submittedAt: FIXED, projectId: "proj-alpha", idempotencyKey: "inst-cp" }) as InstallCompletionPolicyRevisionCommand;
  await ledger.commit(buildInstallLedgerCommit(cp, { eventId: "evt-install-cp", occurredAt: FIXED }));
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, { commandId: "cmd-install-ab", correlationId: "corr-install-ab", submittedAt: FIXED, projectId: "proj-alpha", idempotencyKey: "inst-ab" }) as InstallArchitectureBaselineRevisionCommand;
  await ledger.commit(buildInstallLedgerCommit(ab, { eventId: "evt-install-ab", occurredAt: FIXED }));
  await ledger.commit(
    buildActivateLedgerCommit(
      buildActivateCommand(completionPolicyPinFor(cp), { commandId: "cmd-act-cp", correlationId: "corr-act-cp", submittedAt: FIXED, projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "act-cp" }),
      { eventId: "evt-act-cp", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
    ),
  );
  await ledger.commit(
    buildActivateLedgerCommit(
      buildActivateCommand(architectureBaselinePinFor(ab), { commandId: "cmd-act-ab", correlationId: "corr-act-ab", submittedAt: FIXED, projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "act-ab" }),
      { eventId: "evt-act-ab", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
    ),
  );
  const apply = buildApplyPlanCommand(DISPATCH_PLAN_REVISION_FIXTURE_V1, { commandId: "cmd-apply", correlationId: "corr-apply", submittedAt: FIXED, projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "apply" });
  await ledger.commit(
    buildPlanLedgerCommit(apply, {
      eventId: "evt-apply", occurredAt: FIXED, acceptedAt: FIXED,
      pins: { completionPolicy: completionPolicyPinFor(cp), architectureBaseline: architectureBaselinePinFor(ab) },
      baseGoal: goalSnapshotFor(buildCreateGoalCommand(MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!, { commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: FIXED })),
    }),
  );
}

async function setupAccepted() {
  const { ledger, engine } = makeHarness();
  await bootstrap(ledger);
  await createGoal(ledger);
  await installActivateAndPlan(ledger);
  return { ledger, engine };
}

function codes(result: DispatchReadinessResult): string[] {
  if (result.status !== "ready") return [];
  return result.eligibility.eligible ? [] : result.eligibility.reasons.map((r) => r.code);
}

describe("dispatchReadiness: eligibility table (read-only)", () => {
  it("only deps-satisfied active unblocked budgeted WORK tasks are eligible", async () => {
    const { engine } = await setupAccepted();
    const cases: { taskId: string; codes: string[] }[] = [
      { taskId: DISPATCH_ELIGIBLE_TASK_ID, codes: [] },
      { taskId: DISPATCH_DEPENDENT_TASK_ID, codes: ["deps_unsatisfied"] },
      { taskId: DISPATCH_BLOCKED_TASK_ID, codes: ["task_phase_not_dispatchable"] },
      { taskId: DISPATCH_DEFERRED_TASK_ID, codes: ["task_not_active"] },
      // gate-dispatch is a gate (task_kind_not_work) AND depends on the
      // pending verify-view task (deps_unsatisfied); the frozen pure eligibility
      // rule accumulates both. (The shared dispatch.contract.suite.ts lists only
      // task_kind_not_work here — a baseline inconsistency to reconcile.)
      { taskId: DISPATCH_GATE_TASK_ID, codes: ["task_kind_not_work", "deps_unsatisfied"] },
      { taskId: "task-absent", codes: ["task_not_found"] },
    ];
    for (const c of cases) {
      const r = await engine.dispatchReadiness({ projectId: "proj-alpha", goalId: "goal-1", taskId: c.taskId });
      expect(r.status).toBe("ready");
      expect(codes(r).sort()).toEqual([...c.codes].sort());
      if (c.codes.length === 0 && r.status === "ready") {
        expect(r.eligibility.eligible).toBe(true);
      }
    }
  });

  it("ready result carries the plan ref + goal/workspace revisions", async () => {
    const { engine } = await setupAccepted();
    const r = await engine.dispatchReadiness({ projectId: "proj-alpha", goalId: "goal-1", taskId: DISPATCH_ELIGIBLE_TASK_ID });
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    expect(r.planRef).toEqual({ aggregateType: "PlanRevision", projectId: "proj-alpha", planId: "plan-dispatch-mvp" });
    expect(r.goalRevision).toBe(2);
    expect(r.workspaceRevision).toBe(1);
  });
});

describe("dispatchReadiness: not_found branches (zero write)", () => {
  it("goal without an accepted plan -> not_found/plan", async () => {
    const { ledger, engine } = await setupAccepted();
    const scope = { projectId: "proj-alpha", workspaceId: "ws-shared", goalId: "goal-2", objective: "second goal (no plan)", actor: { kind: "human" as const, id: "user-1" } };
    await ledger.commit(
      buildGoalCreateLedgerCommit(buildCreateGoalCommand(scope, { commandId: "cmd-goal2", correlationId: "corr-goal2", submittedAt: FIXED, idempotencyKey: "goal2-create" }), {
        eventId: "evt-goal2", occurredAt: FIXED, projectRevision: 1, workspaceRevision: 1,
      }),
    );
    const r = await engine.dispatchReadiness({ projectId: "proj-alpha", goalId: "goal-2", taskId: DISPATCH_ELIGIBLE_TASK_ID });
    expect(r.status).toBe("not_found");
    if (r.status === "not_found") expect(r.code).toBe("plan");
  });

  it("missing goal -> not_found/goal", async () => {
    const { engine } = await setupAccepted();
    const r = await engine.dispatchReadiness({ projectId: "proj-alpha", goalId: "goal-absent", taskId: DISPATCH_ELIGIBLE_TASK_ID });
    expect(r).toEqual({ status: "not_found", code: "goal" });
  });
});

describe("dispatchReadiness: resource / lease rule", () => {
  it("a held lease surfaces as resource_unavailable(leased)", async () => {
    const { engine } = await setupAccepted();
    const claim = await engine.claimTask(
      buildDispatchClaimCommand({ commandId: "cmd-claim-lease", correlationId: "corr-lease", submittedAt: FIXED, projectId: "proj-alpha", attemptId: "att-lease", runId: "run-lease", idempotencyKey: "lease-1" }),
    );
    expect(claim.status).toBe("committed");
    const r = await engine.dispatchReadiness({ projectId: "proj-alpha", goalId: "goal-1", taskId: DISPATCH_ELIGIBLE_TASK_ID });
    expect(r.status).toBe("ready");
    expect(codes(r)).toEqual(["resource_unavailable"]);
  });

  it("an exhausted budget / passed deadline -> resource_unavailable", async () => {
    const { engine } = await setupAccepted();
    const query: DispatchReadinessQuery = {
      projectId: "proj-alpha", goalId: "goal-1", taskId: DISPATCH_ELIGIBLE_TASK_ID,
      budget: { tokenBudget: 0, deadline: null },
    };
    expect(codes(await engine.dispatchReadiness(query))).toEqual(["resource_unavailable"]);
    const one = await engine.dispatchReadiness({
      projectId: "proj-alpha", goalId: "goal-1", taskId: DISPATCH_ELIGIBLE_TASK_ID,
      budget: { tokenBudget: 10, deadline: "2000-01-01T00:00:00.000Z" },
    });
    expect(codes(one)).toEqual(["resource_unavailable"]);
  });
});
