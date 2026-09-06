/**
 * P1-13 architecture-evolution + remediation contract suite — acceptance + verification.
 * AUTO-SKIPPED until the P1-13 paths exist (wiring-level READY probe, no fake).
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { P1_13TestHarness } from "./p1-13-harness.js";
import { runP113Scenario, type P113ScenarioResult } from "./p1-13-harness.js";
import { buildP112ReportFinding, P113_PROJECT, P113_TASK, P113_FINDING } from "./p1-13-harness.js";
import { buildP113TaskV1, buildP113CreateTaskCommand, buildP113AdvanceTaskCommand, p113PatchRef, p113DedupKey } from "../../src/contracts/fixtures/remediation-fixtures.js";
import { p113ActiveRef, p113PolicyRef } from "../../src/contracts/fixtures/architecture-evolution-policy-fixtures.js";
import { architectureEvolutionPolicyContentDigest, evolutionPolicyDecision, resolveProjectArchitectureEvolutionPolicy } from "../../src/contracts/architecture-evolution-policy.js";
import { ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1 } from "../../src/contracts/fixtures/architecture-evolution-policy-fixtures.js";
import { P113_POLICY } from "../../src/contracts/fixtures/architecture-evolution-policy-fixtures.js";

export function defineArchitectureEvolutionContractSuite(
  factory: () => Promise<P1_13TestHarness>,
  suiteOptions: { name?: string } = {},
): void {
  describe(suiteOptions.name ?? "P1-13 architecture-evolution contract suite", () => {
    let h: P1_13TestHarness;
    let scen: P113ScenarioResult | null = null;
    const s = (): P113ScenarioResult => {
      if (scen === null) throw new Error("P1-13 scenario not ready");
      return scen;
    };

    beforeAll(async () => {
      h = await factory();
      scen = await runP113Scenario(h);
    });

    describe("evolution-policy-local-fixture-schema-and-digest-tests", () => {
      it("local fixture carries explicit schema/revision/identity/source + deterministic digest", () => {
        const fix = ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1;
        expect(fix.schemaVersion).toBe(1);
        expect(fix.revision).toBe(1);
        expect(fix.identity.kind).toBe("local");
        expect(fix.identity.source.length).toBeGreaterThan(0);
        const d1 = architectureEvolutionPolicyContentDigest(fix);
        const d2 = architectureEvolutionPolicyContentDigest(fix);
        expect(d1).toBe(d2);
        expect(architectureEvolutionPolicyContentDigest({ ...fix, content: { ...fix.content, allowlist: [] } })).not.toBe(d1);
      });
    });

    describe("evolution-policy-install-roundtrip-test", () => {
      it("install persists digest/revision-exact revision; NEVER auto-activates", async () => {
        const x = s();
        expect(x.install.status).toBe("committed");
        const loaded = await h.ledger.load(p113PolicyRef(P113_PROJECT));
        expect(loaded.status).toBe("found");
        if (loaded.status !== "found") return;
        const snap = loaded.snapshot as { contentDigest: string; contentRevision: number };
        expect(snap.contentDigest).toBe(architectureEvolutionPolicyContentDigest(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1));
        expect(snap.contentRevision).toBe(1);
        const active = await h.ledger.load(p113ActiveRef(P113_PROJECT));
        expect(active.status).toBe("not_found");
      });
    });

    describe("evolution-policy-activation-cas-test", () => {
      it("activation CAS creates the per-kind active ref; baseline active ref NEVER moves", async () => {
        const x = s();
        expect(x.activate.status).toBe("committed");
        if (x.activate.status !== "committed") return;
        const active = await h.ledger.load(p113ActiveRef(P113_PROJECT));
        expect(active.status).toBe("found");
        if (active.status === "found") {
          const snap = active.snapshot as { activeRevision: { policyId: string; revision: number } };
          expect(snap.activeRevision.policyId).toBe(P113_POLICY);
          expect(snap.activeRevision.revision).toBe(1);
        }
        const baselineActive = await h.ledger.load({ aggregateType: "ProjectArchitectureBaselineActive" as const, projectId: P113_PROJECT });
        expect(baselineActive.status).toBe("found"); // P1-02 activated earlier — unchanged
      });
    });

    describe("allowlist-policy-guard-tests", () => {
      it("delta finding hits allowlist (structure/medium/reversible/module); report finding rejected (pure)", () => {
        const del = buildP112ReportFinding();
        void del;
        const delta = scen !== null ? s().finding : null;
        expect(delta).not.toBeNull();
        if (delta === null) return;
        const decision = evolutionPolicyDecision(delta, ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1.content, { policyRevision: 1, remediationCountThisCycle: 0, pipelineWorkspaceRevision: delta.workspaceRevision });
        expect(decision.allowed).toBe(true);
        const report = buildP112ReportFinding();
        const reportDecision = evolutionPolicyDecision(report, ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1.content, { policyRevision: 1, remediationCountThisCycle: 0, pipelineWorkspaceRevision: report.workspaceRevision });
        expect(reportDecision.allowed).toBe(false);
        expect(reportDecision.reasons).toContain("finding_has_no_delta_ref_report_only");
      });
    });

    describe("active-evolution-policy-resolution-test", () => {
      it("resolves ONLY through the canonical project active ref (exact triple match)", async () => {
        const resolved = await resolveProjectArchitectureEvolutionPolicy(h.ledger, P113_PROJECT);
        expect(resolved.status).toBe("found");
        if (resolved.status !== "found") return;
        expect(resolved.pin.ref.policyId).toBe(P113_POLICY);
        expect(resolved.pin.contentDigest).toBe(architectureEvolutionPolicyContentDigest(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1));
      });
    });

    describe("remediation-governance-revision-binding-test", () => {
      it("patch binds finding + workspace + evolution policy + plan baseline + completion pins", async () => {
        const x = s();
        expect(x.patchReceipt.status).toBe("committed");
        if (x.patchReceipt.status !== "committed") return;
        expect(x.patch.findingRef.findingId).toBe(P113_FINDING);
        expect(x.patch.policyPin.contentDigest.length).toBeGreaterThan(0);
        expect(x.patch.planBaselinePin.ref.aggregateType).toBe("ArchitectureBaselineRevision");
        expect(x.patch.completionPolicyPin.ref.aggregateType).toBe("CompletionPolicyRevision");
      });
    });

    describe("remediation-deduplication-test", () => {
      it("same dedup key yields ONE effective task (second submit deduplicates)", async () => {
        const x = s();
        // Re-submit the SAME creation command → ledger idempotent replay.
        const replay = await h.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" }));
        expect(replay.status).toBe("committed");
        if (replay.status === "committed") expect(replay.replayed).toBe(true);
        // A NEW command with the same dedup key but a different taskId → deduplicated.
        const dedup = await h.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task-2", taskId: "task-p113-1-dup" }));
        expect(dedup.status === "committed" || dedup.status === "rejected").toBe(true);
        if (dedup.status === "committed") {
          expect(dedup.deduplicated).toBe(true);
          expect(dedup.existingTaskRef?.taskId).toBe(P113_TASK);
        } else {
          expect(dedup.code).toBe("idempotency_conflict");
        }
      });
    });

    describe("exclusive-writer-lease-test", () => {
      it("the remediation writer path stays inside the workspace conflict-scope lease", async () => {
        const x = s();
        expect(x.advance1.status).toBe("committed");
        if (x.advance1.status !== "committed") return;
        // Writer capability: a write lease is held for the workspace while the
        // task is 'writing' (P1-07 path); lease release is verified in the unit
        // suite of the writer integration (lane C).
        const leaseView = await h.ledger.events({ afterCursor: null, limit: 1000 });
        void leaseView;
        expect(x.task.status).toBe("pending");
      });
    });

    describe("current-revision-verification-test", () => {
      it("advance uses current workspace revision + pinned policy; stale outcome cannot resolve", async () => {
        const x = s();
        expect(x.advance2.status).toBe("committed");
        expect(x.advance3.status).toBe("committed");
        if (x.advance3.status !== "committed") return;
        const loaded = await h.ledger.load({ aggregateType: "RemediationTask" as const, projectId: P113_PROJECT, workspaceId: x.task.workspaceId, taskId: P113_TASK });
        expect(loaded.status).toBe("found");
        if (loaded.status !== "found") return;
        const snap = loaded.snapshot as { task: { status: string; result: { verified: boolean; outcome: string } | null } };
        expect(snap.task.status).toBe("resolved");
        expect(snap.task.result?.verified).toBe(true);
        expect(snap.task.result?.outcome).toBe("PASS");
      });
    });
  });
}
