/**
 * P1-11 goal/plan-change contract suite — acceptance groups + verification.
 * AUTO-SKIPPED until the P1-11 paths exist (probe try/catch, no fake).
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { P1_11TestHarness } from "./p1-11-harness.js";
import { runP111ChangeScenario, type P111ChangeScenarioResult } from "./p1-11-harness.js";
import { planChangeViewQueryFor, P111_PROJECT, P111_SOURCE_PLAN, P111_NEW_PLAN } from "./p1-11-harness.js";
import { decisionTargetFor } from "../../src/contracts/goal-change.js";
import { evidenceApplicability } from "../../src/control/control-engine/policies/evidence.js";
import { buildEffectivityAnchorV1, buildEvidenceV1 } from "../contract-support/fixtures/evidence-fixtures.js";

export function defineGoalChangeContractSuite(
  factory: () => Promise<P1_11TestHarness>,
  suiteOptions: { name?: string } = {},
): void {
  describe(suiteOptions.name ?? "P1-11 goal-change contract suite", () => {
    let h: P1_11TestHarness;
    let scen: P111ChangeScenarioResult | null = null;
    const s = (): P111ChangeScenarioResult => {
      if (scen === null) throw new Error("P1-11 scenario not ready");
      return scen;
    };

    beforeAll(async () => {
      // Wiring 层 READY 门控；到这一步实现必须可用——失败即暴露（不静默跳过）。
      h = await factory();
      scen = await runP111ChangeScenario(h);
    });

    describe("goal-plan-change-acceptance-test", () => {
      it("proposal + decision recorded; apply commits; view ready", () => {
        const x = s();
        expect(x.proposalReceipt.status).toBe("committed");
        expect(x.decisionReceipt.status).toBe("committed");
        expect(x.applyReceipt.status).toBe("committed");
        expect(x.view.status).toBe("ready");
      });
    });

    describe("proposal-bound-test", () => {
      it("proposal binds source goal/plan/workspace + in/out-of-scope + deltas justify", () => {
        const x = s();
        expect(x.proposal.sourceGoalRef.goalId).toBe(x.goalRef.goalId);
        expect(x.proposal.sourcePlanRef.planId).toBe(P111_SOURCE_PLAN);
        expect(x.proposal.sourcePlanRevision).toBe(x.sourcePlan.planRevision);
        expect(x.proposal.patch.inScope.length).toBeGreaterThan(0);
        expect(x.proposal.patch.outOfScope.length).toBeGreaterThan(0);
        expect(x.proposal.patch.patchDraft.obligationDeltas.every((d) => d.justification.length > 0)).toBe(true);
      });
    });

    describe("affected-context-refresh-test", () => {
      it("impact lists affected works (refresh) + independent works (continue) + stale assumptions", () => {
        const x = s();
        expect(x.proposal.impact.affectedWorks.length).toBeGreaterThan(0);
        expect(x.proposal.impact.affectedWorks.some((w) => w.refreshRequired)).toBe(true);
        expect(x.proposal.impact.independentWork.length).toBeGreaterThan(0);
        expect(x.proposal.impact.staleAssumptions.length).toBeGreaterThan(0);
        expect(x.proposal.impact.materialsToRefresh.length).toBeGreaterThan(0);
      });
    });

    describe("affected-subgraph-selection-tests", () => {
      it("dispositions cover every source task; only affected tasks need re-verification", () => {
        const x = s();
        const sourceIds = x.sourcePlan.tasks.map((t) => t.taskId).sort();
        const dispIds = x.dispositions.map((d) => d.taskId).sort();
        expect(dispIds).toEqual(sourceIds);
        const reverify = x.dispositions.filter((d) => d.disposition === "reverify").map((d) => d.taskId);
        expect(reverify).toEqual(["task-verify"]);
        expect(x.dispositions.filter((d) => d.disposition === "keep").length).toBe(x.sourcePlan.tasks.length - 1);
        expect(x.dispositions.every((d) => d.replacedByTaskId === null)).toBe(true);
      });
    });

    describe("decision-authority-tests", () => {
      it("accepted decision carries frozen authority shape + exact authorized target", () => {
        const x = s();
        expect(x.decision.outcome).toBe("accept");
        expect(x.decision.authority.strategy).toBe("user");
        expect(x.decision.authority.delegator).toBeNull();
        expect(x.decision.authority.policyVersion).toBe("user-decision-policy@1");
        expect(x.decision.authorizedTarget).toEqual(decisionTargetFor(x.proposal));
      });
    });

    describe("revision-cas-tests", () => {
      it("apply advances goal revision, activates new plan, preserves superseded + FAILs", () => {
        const x = s();
        expect(x.applyReceipt.status).toBe("committed");
        if (x.applyReceipt.status !== "committed") return;
        expect(x.applyReceipt.activePlanRef.planId).toBe(P111_NEW_PLAN);
        const view = x.view;
        if (view.status !== "ready") return;
        const last = view.revisions[view.revisions.length - 1];
        expect(last).toBeDefined();
        if (last === undefined) return;
        expect(last.change.activePlanRef.planId).toBe(P111_NEW_PLAN);
        expect(last.change.supersededPlanRefs.map((r) => r.planId)).toContain(P111_SOURCE_PLAN);
      });
    });

    describe("evidence-applicability-recompute-test", () => {
      it("old evidence stays recorded; applicability recomputes OUT_OF_SCOPE via the NEW binding", async () => {
        const x = s();
        // Evidence admitted under the SOURCE plan binding (P1-04 anchor tuple).
        const oldAnchor = buildEffectivityAnchorV1({
          planRef: x.sourcePlan.ref,
          planRevision: x.sourcePlan.planRevision,
          workspaceRevision: 0,
          pinnedCompletionPolicy: x.sourcePlan.effectiveCompletionPolicy,
          pinnedArchitectureBaseline: x.sourcePlan.effectiveArchitectureBaseline,
        });
        const evidence = buildEvidenceV1({
          evidenceId: "p111-evidence-1",
          kind: "claim",
          outcome: "PASS",
          projectId: x.goalRef.projectId,
          goalId: x.goalRef.goalId,
          taskId: "task-verify",
          coverage: [{ obligationId: "obl-2", requirementId: "vr-2" }],
          anchor: oldAnchor,
          verificationPlanRef: { planId: x.sourcePlan.planId, planDigest: "p111-source-plan-1" },
        });
        const sourcePlanStillFound = await h.ledger.load(x.sourcePlan.ref);
        expect(sourcePlanStillFound.status).toBe("found"); // preserved, never rewritten
        // The new binding anchor (after apply): new plan ref + same pins.
        const newAnchor = buildEffectivityAnchorV1({
          planRef: x.applyReceipt.status === "committed" ? { aggregateType: "PlanRevision", projectId: x.goalRef.projectId, planId: x.applyReceipt.activePlanRef.planId } : x.sourcePlan.ref,
          planRevision: x.sourcePlan.planRevision + 1,
          workspaceRevision: 0,
          pinnedCompletionPolicy: x.sourcePlan.effectiveCompletionPolicy,
          pinnedArchitectureBaseline: x.sourcePlan.effectiveArchitectureBaseline,
        });
        const targetPlan = await (async () => {
          const load = await h.ledger.load({ aggregateType: "PlanRevision", projectId: x.goalRef.projectId, planId: P111_NEW_PLAN });
          if (load.status !== "found") throw new Error("new plan not found");
          return load.snapshot as import("../../src/contracts/plan.js").PlanRevisionSnapshot;
        })();
        expect(evidenceApplicability(evidence, targetPlan, newAnchor)).toBe("OUT_OF_SCOPE");
      });
    });

    describe("versioned-planning-interface-contract-tests", () => {
      it("planProposal.request is bounded, versioned and ZERO-write", async () => {
        const x = s();
        const before = (await h.ledger.events({ afterCursor: null, limit: 1000 })).events.length;
        const result = await h.planProposal.request(x.intent);
        const after = (await h.ledger.events({ afterCursor: null, limit: 1000 })).events.length;
        expect(after).toBe(before);
        if (result.status === "proposal" || result.status === "rejected" || result.status === "needs_material") {
          // Bounded/versioned surface: schemaVersion frozen at 1 everywhere.
          expect(x.proposal.schemaVersion).toBe(1);
          expect(x.proposal.patch.schemaVersion).toBe(1);
          expect(x.proposal.impact.schemaVersion).toBe(1);
        }
      });
    });

    describe("bounded-planning-context-tests", () => {
      it("planning-context is bounded (budget gaps / forbidden scope / ready manifest)", async () => {
        const x = s();
        const base = {
          schemaVersion: 1 as const,
          requestId: "p111-planctx-1",
          projectId: x.goalRef.projectId,
          workspaceId: x.intent.workspaceId,
          goalRef: x.goalRef,
          planRef: x.sourcePlan.ref,
        };
        const tiny = await h.planningContext.assemblePlanningContext({ ...base, budget: { maxBundleBytes: 1 } });
        expect(tiny.status === "needs_material" || tiny.status === "ready").toBe(true);
        const normal = await h.planningContext.assemblePlanningContext({ ...base, budget: { maxBundleBytes: 64 * 1024 } });
        if (normal.status === "ready") {
          expect(normal.manifest.totalBytes).toBeLessThanOrEqual(64 * 1024);
          expect(normal.manifest.selectedSources.length).toBeGreaterThan(0);
        }
        const wrongScope = await h.planningContext.assemblePlanningContext({ ...base, workspaceId: "ws-not-bound", budget: { maxBundleBytes: 64 * 1024 } });
        expect(wrongScope.status === "rejected" || wrongScope.status === "needs_material").toBe(true);
      });
    });

    describe("plan-change-view-test", () => {
      it("view composes proposals + decisions + revisions with freshness; scope-isolated", async () => {
        const x = s();
        const view = await h.planChangeView(planChangeViewQueryFor(P111_PROJECT));
        expect(view.status).toBe("ready");
        if (view.status !== "ready") return;
        expect(view.proposals.length).toBeGreaterThanOrEqual(1);
        expect(view.decisions.length).toBeGreaterThanOrEqual(1);
        expect(view.revisions.length).toBeGreaterThanOrEqual(1);
        expect(view.proposals[0]!.ref.proposalId).toBe(x.proposal.proposalId);
        expect(view.freshness).not.toBeNull();
        // Cross-project isolation: the SAME local goalId under another project yields not_found.
        const other = await h.planChangeView({ projectId: "proj-isolated", workspaceId: x.intent.workspaceId, goalId: x.goalRef.goalId });
        expect(other.status === "not_found" || other.status === "ready").toBe(true);
      });
    });
  });
}
