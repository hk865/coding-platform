/**
 * P1-11 lane B unit tests — PlanCompilerImpl.request.
 *
 * Drives a real in-memory ledger through the P1-11 bootstrap + accepted-plan
 * scenario (reusing the shared contract-suite harness helper + applyPlan) and
 * asserts the compiler produces a bounded, deterministic, ZERO-write proposal /
 * refusal:
 *   - accepted plan -> proposal (source refs/revision, patch objective from the
 *     delta, obligationDeltas carried verbatim, non-empty in/out scope, impact
 *     affectedWorks from the delta's tasks) with no ledger event change;
 *   - missing goal -> rejected not_found (zero-write);
 *   - goal without an active plan -> needs_material active_plan_missing;
 *   - malformed intent (invalid objectiveDelta.kind / empty justification) ->
 *     rejected invalid_request.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { CoordinationContextCompiler } from "../../src/data/context-compiler/coordination-context-compiler.js";
import { PlanCompilerImpl } from "../../src/control/plan-compiler/plan-compiler.js";
import { buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import { HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1 } from "../../src/fixtures/plan-fixtures.js";
import {
  buildAmendGoalRequestV1,
  P111_PROJECT,
  P111_WORKSPACE,
  P111_SOURCE_PLAN,
  p111GoalRef,
  p111PlanRef,
} from "../contract-support/fixtures/goal-change-fixtures.js";
import { p111BootstrapGoalGovernance } from "../contract-suite/p1-11-harness.js";
import { FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";
import type { AmendGoalRequestV1 } from "../../src/contracts/goal-change.js";

const FIXED = FIXED_ISO_2026_09_05;
const NOW = () => FIXED;

async function committedScenario() {
  const h = createInMemoryHarness();
  await p111BootstrapGoalGovernance(h.ledger, P111_PROJECT);
  const planCommand = buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, {
    commandId: "plan-compiler-accept-plan",
    correlationId: "plan-compiler-accept-plan-corr",
    submittedAt: FIXED,
    projectId: P111_PROJECT,
    expectedRevision: 1,
    idempotencyKey: "plan-compiler-accept-plan",
  });
  const planReceipt = await h.applyPlan(planCommand);
  expect(planReceipt.status).toBe("committed");
  return h;
}

function eventCount(h: ReturnType<typeof createInMemoryHarness>): Promise<number> {
  return h.ledger.events({ afterCursor: null, limit: 1000 }).then((p) => p.events.length);
}

describe("PlanCompilerImpl.request", () => {
  it("rejects foreign scope and stale requested plans before producing a proposal", async () => {
    const h = await committedScenario();
    const compiler = new PlanCompilerImpl({ materials: new CoordinationContextCompiler({ ledger: h.ledger }), now: NOW });
    const intent = buildAmendGoalRequestV1({ projectId: P111_PROJECT, workspaceId: P111_WORKSPACE, goalRef: p111GoalRef(P111_PROJECT), planRef: p111PlanRef(P111_SOURCE_PLAN, P111_PROJECT) });
    const before = await eventCount(h);
    expect(await compiler.request({ ...intent, goalRef: { ...intent.goalRef, projectId: 'foreign-project' } })).toMatchObject({ status: 'rejected', code: 'forbidden_tool_or_scope' });
    expect(await compiler.request({ ...intent, planRef: { ...intent.planRef!, planId: 'old-plan' } })).toMatchObject({ status: 'rejected', code: 'source_stale' });
    expect(await eventCount(h)).toBe(before);
  });

  it("produces a bounded, deterministic ZERO-write proposal for an accepted plan goal", async () => {
    const h = await committedScenario();
    const compiler = new PlanCompilerImpl({ materials: new CoordinationContextCompiler({ ledger: h.ledger }), now: NOW });

    const intent = buildAmendGoalRequestV1({
      projectId: P111_PROJECT,
      workspaceId: P111_WORKSPACE,
      goalRef: p111GoalRef(P111_PROJECT),
      planRef: p111PlanRef(P111_SOURCE_PLAN, P111_PROJECT),
    });

    const before = await eventCount(h);
    const result = await compiler.request(intent);
    const after = await eventCount(h);
    expect(after).toBe(before); // zero ledger write

    expect(result.status).toBe("proposal");
    if (result.status !== "proposal") return;

    const p = result.proposal;
    // versioned / deterministic surface
    expect(p.schemaVersion).toBe(1);
    expect(p.proposalId).toBe("proposal-" + intent.requestId);
    expect(p.projectId).toBe(P111_PROJECT);
    expect(p.workspaceId).toBe(P111_WORKSPACE);
    expect(p.sourceGoalRef).toEqual(intent.goalRef);
    // source plan ref + revision
    const sourceLoad = await h.ledger.load(p111PlanRef(P111_SOURCE_PLAN, P111_PROJECT));
    expect(sourceLoad.status).toBe("found");
    if (sourceLoad.status !== "found") return;
    expect(p.sourcePlanRef).toEqual((sourceLoad.snapshot as { ref: unknown }).ref);
    expect(p.sourcePlanRevision).toBe(1);
    // patch
    expect(p.patch.schemaVersion).toBe(1);
    expect(p.patch.sourcePlanRef).toEqual(p.sourcePlanRef);
    expect(p.patch.sourcePlanRevision).toBe(p.sourcePlanRevision);
    expect(p.patch.patchDraft.objective).toBe(intent.objectiveDelta!.newObjective);
    expect(p.patch.patchDraft.obligationDeltas).toEqual(intent.obligationDeltas);
    expect(p.patch.patchDraft.taskHierarchy).toBeNull();
    expect(p.patch.inScope.length).toBeGreaterThan(0);
    expect(p.patch.outOfScope.length).toBeGreaterThan(0);
    // impact: affectedWorks derived from the delta's task(s)
    expect(p.impact.schemaVersion).toBe(1);
    expect(p.impact.patchRef).toEqual(p.sourcePlanRef);
    expect(p.impact.materialsToRefresh).toEqual(["planContext", "evidenceBindings"]);
    // Without a configured authority, no guessed work id may appear.
    expect(p.impact.affectedWorks).toEqual([]);
    expect(p.impact.staleAssumptions.some(row => row.assumption.startsWith('工作影响清单完整'))).toBe(true);
    expect(p.impact.staleAssumptions.length).toBeGreaterThan(0);
    expect(p.impact.independentWork).toEqual([]);
    expect(p.alternatives).toEqual([]);
    expect(p.generatedAt).toBe(FIXED);
  });

  it("is deterministic for the same intent (only derived proposalId/generatedAt vary with now)", async () => {
    const h = await committedScenario();
    const compiler = new PlanCompilerImpl({ materials: new CoordinationContextCompiler({ ledger: h.ledger }), now: NOW });
    const intent = buildAmendGoalRequestV1({ projectId: P111_PROJECT, workspaceId: P111_WORKSPACE, goalRef: p111GoalRef(P111_PROJECT), planRef: p111PlanRef(P111_SOURCE_PLAN, P111_PROJECT) });
    const a = await compiler.request(intent);
    const b = await compiler.request(intent);
    expect(a.status).toBe("proposal");
    expect(b.status).toBe("proposal");
    if (a.status !== "proposal" || b.status !== "proposal") return;
    const { patch: patchA, impact: impactA } = a.proposal;
    const { patch: patchB, impact: impactB } = b.proposal;
    expect(patchA).toEqual(patchB);
    expect(impactA).toEqual(impactB);
  });

  it("rejects a non-existent goal with not_found and zero writes", async () => {
    const h = await committedScenario();
    const compiler = new PlanCompilerImpl({ materials: new CoordinationContextCompiler({ ledger: h.ledger }), now: NOW });
    const intent = buildAmendGoalRequestV1({
      projectId: P111_PROJECT,
      workspaceId: P111_WORKSPACE,
      goalRef: { ...p111GoalRef(P111_PROJECT), goalId: "goal-does-not-exist" },
      planRef: p111PlanRef(P111_SOURCE_PLAN, P111_PROJECT),
    });
    const before = await eventCount(h);
    const result = await compiler.request(intent);
    const after = await eventCount(h);
    expect(after).toBe(before);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("not_found");
  });

  it("returns needs_material active_plan_missing when the goal has no active plan revision", async () => {
    const h = createInMemoryHarness();
    await p111BootstrapGoalGovernance(h.ledger, P111_PROJECT);
    // goal created, but NO accepted plan revision yet -> activePlanRevision is null
    const compiler = new PlanCompilerImpl({ materials: new CoordinationContextCompiler({ ledger: h.ledger }), now: NOW });
    const intent = buildAmendGoalRequestV1({
      projectId: P111_PROJECT,
      workspaceId: P111_WORKSPACE,
      goalRef: p111GoalRef(P111_PROJECT),
      planRef: p111PlanRef(P111_SOURCE_PLAN, P111_PROJECT),
    });
    const before = await eventCount(h);
    const result = await compiler.request(intent);
    const after = await eventCount(h);
    expect(after).toBe(before);
    expect(result.status).toBe("needs_material");
    if (result.status !== "needs_material") return;
    expect(result.gaps).toContain("active_plan_missing");
  });

  it("rejects an invalid objectiveDelta.kind with invalid_request", async () => {
    const h = await committedScenario();
    const compiler = new PlanCompilerImpl({ materials: new CoordinationContextCompiler({ ledger: h.ledger }), now: NOW });
    const intent = buildAmendGoalRequestV1({
      projectId: P111_PROJECT,
      workspaceId: P111_WORKSPACE,
      goalRef: p111GoalRef(P111_PROJECT),
      planRef: p111PlanRef(P111_SOURCE_PLAN, P111_PROJECT),
      objectiveDelta: { kind: null as unknown as "change", newObjective: "x", summary: "y" },
    });
    const before = await eventCount(h);
    const result = await compiler.request(intent);
    const after = await eventCount(h);
    expect(after).toBe(before);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("invalid_request");
  });

  it("rejects an obligation delta with an empty justification as invalid_request", async () => {
    const h = await committedScenario();
    const compiler = new PlanCompilerImpl({ materials: new CoordinationContextCompiler({ ledger: h.ledger }), now: NOW });
    const intent = buildAmendGoalRequestV1({
      projectId: P111_PROJECT,
      workspaceId: P111_WORKSPACE,
      goalRef: p111GoalRef(P111_PROJECT),
      planRef: p111PlanRef(P111_SOURCE_PLAN, P111_PROJECT),
      obligationDeltas: [
        { obligationId: "obl-2", action: "change", newText: "x", justification: "" },
      ],
    });
    const result = await compiler.request(intent);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("invalid_request");
  });
});
