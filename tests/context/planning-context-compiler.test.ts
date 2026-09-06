/**
 * P1-11 lane B unit tests — PlanningContextCompilerImpl.assemblePlanningContext.
 *
 * Tests the frozen ctor deps (ledger / vault / contextCompiler / readModel / now)
 * and the delegation contract:
 *   - a normal byte budget over a real bootstrap + accepted plan -> ready, with
 *     the manifest bounded (totalBytes <= budget, non-empty selectedSources,
 *     nullable freshnessCursor) and ZERO ledger writes;
 *   - an over-tight budget -> needs_material (delegate yields a ready bundle that
 *     exceeds the byte budget, so the planning port reports the gap);
 *   - an unknown workspace -> rejected (the delegate refuses the invalid
 *     workspaceSnapshot.revision at the contract boundary; the mapped code is in
 *     the allowed rejected set);
 *   - an injected contextCompiler (frozen deps / DI) proves the forbidden and
 *     unavailable code mapping + needs_material passthrough are delegated
 *     authoritatively to the ContextCompiler.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { PlanningContextCompilerImpl } from "../../src/context/planning-context-compiler.js";
import { buildApplyPlanCommand } from "../../src/contracts/fixtures/plan-fixtures.js";
import { HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1 } from "../../src/contracts/fixtures/plan-fixtures.js";
import {
  P111_PROJECT,
  p111GoalRef,
  p111PlanRef,
} from "../../src/contracts/fixtures/goal-change-fixtures.js";
import { p111BootstrapGoalGovernance } from "../contract-suite/p1-11-harness.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import type { TaskContextPort, TaskContextRequestV1, TaskContextResultV1 } from "../../src/contracts/task-envelope.js";

const FIXED = FIXED_ISO_2026_09_05;
const NOW = () => FIXED;
const WORKSPACE = "ws-shared"; // the bootstrap-created workspace under proj-alpha
const PLAN_ID = HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1.planId;

class FakeContextCompiler implements TaskContextPort {
  calls = 0;
  constructor(private readonly result: TaskContextResultV1) {}
  async assemble(_request: TaskContextRequestV1): Promise<TaskContextResultV1> {
    this.calls += 1;
    return this.result;
  }
}

async function committedScenario() {
  const h = createInMemoryHarness();
  await p111BootstrapGoalGovernance(h.ledger, P111_PROJECT);
  const planCommand = buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, {
    commandId: "planctx-accept-plan",
    correlationId: "planctx-accept-plan-corr",
    submittedAt: FIXED,
    projectId: P111_PROJECT,
    expectedRevision: 1,
    idempotencyKey: "planctx-accept-plan",
  });
  const planReceipt = await h.applyPlan(planCommand);
  expect(planReceipt.status).toBe("committed");
  return h;
}

function eventCount(h: ReturnType<typeof createInMemoryHarness>): Promise<number> {
  return h.ledger.events({ afterCursor: null, limit: 1000 }).then((p) => p.events.length);
}

function baseRequest(overrides: Partial<{
  workspaceId: string;
  budget: { maxBundleBytes: number };
  planRef: import("../../src/contracts/plan.js").PlanRevisionRef | null;
}> = {}) {
  return {
    schemaVersion: 1 as const,
    requestId: "planctx-1",
    projectId: P111_PROJECT,
    workspaceId: WORKSPACE,
    goalRef: p111GoalRef(P111_PROJECT),
    planRef: p111PlanRef(PLAN_ID, P111_PROJECT),
    budget: { maxBundleBytes: 64 * 1024 },
    ...overrides,
  };
}

describe("PlanningContextCompilerImpl.assemblePlanningContext", () => {
  it("returns a bounded ready manifest for a normal budget with zero ledger writes", async () => {
    const h = await committedScenario();
    const compiler = new PlanningContextCompilerImpl({
      ledger: h.ledger,
      vault: h.vault,
      contextCompiler: h.contextCompiler,
      readModel: h.readModel,
      now: NOW,
    });

    const before = await eventCount(h);
    const result = await compiler.assemblePlanningContext(baseRequest());
    const after = await eventCount(h);
    expect(after).toBe(before);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.manifest.totalBytes).toBeLessThanOrEqual(64 * 1024);
    expect(result.manifest.selectedSources.length).toBeGreaterThan(0);
    expect(result.manifest.freshnessCursor === null || typeof result.manifest.freshnessCursor === "string").toBe(true);
    expect(result.bundleRef.kind).toBe("artifact");
  });

  it("reports needs_material when the byte budget is too small", async () => {
    const h = await committedScenario();
    const compiler = new PlanningContextCompilerImpl({
      ledger: h.ledger,
      vault: h.vault,
      contextCompiler: h.contextCompiler,
      readModel: h.readModel,
      now: NOW,
    });
    const before = await eventCount(h);
    const result = await compiler.assemblePlanningContext(baseRequest({ budget: { maxBundleBytes: 1 } }));
    const after = await eventCount(h);
    expect(after).toBe(before);
    expect(result.status).toBe("needs_material");
    if (result.status !== "needs_material") return;
    expect(result.gaps).toContain("budget_exhausted");
  });

  it("rejects an unknown workspace with a code in the allowed rejected set", async () => {
    const h = await committedScenario();
    const compiler = new PlanningContextCompilerImpl({
      ledger: h.ledger,
      vault: h.vault,
      contextCompiler: h.contextCompiler,
      readModel: h.readModel,
      now: NOW,
    });
    const before = await eventCount(h);
    const result = await compiler.assemblePlanningContext(baseRequest({ workspaceId: "ws-bogus" }));
    const after = await eventCount(h);
    expect(after).toBe(before);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(["invalid_request", "forbidden_tool_or_scope", "unavailable"]).toContain(result.code);
  });

  it("rejects a malformed request shape as invalid_request", async () => {
    const h = await committedScenario();
    const compiler = new PlanningContextCompilerImpl({
      ledger: h.ledger,
      vault: h.vault,
      contextCompiler: h.contextCompiler,
      readModel: h.readModel,
      now: NOW,
    });
    const bad = baseRequest({ budget: { maxBundleBytes: 0 } });
    const result = await compiler.assemblePlanningContext({ ...bad, schemaVersion: 1 });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("invalid_request");
  });

  it("delegates forbidden / unavailable to the injected contextCompiler (frozen DI)", async () => {
    const h = await committedScenario();

    const forbiddenCompiler = new PlanningContextCompilerImpl({
      ledger: h.ledger,
      vault: h.vault,
      contextCompiler: new FakeContextCompiler({
        status: "rejected",
        code: "forbidden_tool_or_scope",
        issues: ["scope not within declaredPermissions"],
      }),
      readModel: h.readModel,
      now: NOW,
    });
    const forbidden = await forbiddenCompiler.assemblePlanningContext(baseRequest());
    expect(forbidden.status).toBe("rejected");
    if (forbidden.status !== "rejected") return;
    expect(forbidden.code).toBe("forbidden_tool_or_scope");

    // A non-planning rejection code (e.g. budget_exhausted) maps to "unavailable".
    const unavailableCompiler = new PlanningContextCompilerImpl({
      ledger: h.ledger,
      vault: h.vault,
      contextCompiler: new FakeContextCompiler({
        status: "rejected",
        code: "budget_exhausted",
        issues: ["tokenBudget must be positive"],
      }),
      readModel: h.readModel,
      now: NOW,
    });
    const unavailable = await unavailableCompiler.assemblePlanningContext(baseRequest());
    expect(unavailable.status).toBe("rejected");
    if (unavailable.status !== "rejected") return;
    expect(unavailable.code).toBe("unavailable");
  });

  it("passes through needs_material from the injected contextCompiler", async () => {
    const h = await committedScenario();
    const fake = new FakeContextCompiler({
      status: "needs_material",
      gaps: [{ kind: "plan-revision", refId: PLAN_ID, message: "accepted PlanRevision not found in the ledger" }],
      selectedRefs: [],
    });
    const compiler = new PlanningContextCompilerImpl({
      ledger: h.ledger,
      vault: h.vault,
      contextCompiler: fake,
      readModel: h.readModel,
      now: NOW,
    });
    const result = await compiler.assemblePlanningContext(baseRequest());
    expect(fake.calls).toBe(1);
    expect(result.status).toBe("needs_material");
    if (result.status !== "needs_material") return;
    expect(result.gaps.some((g) => g.includes("plan-revision"))).toBe(true);
  });
});
