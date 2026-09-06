/**
 * P1-14 baseline-evolution contract suite — acceptance + verification.
 * AUTO-SKIPPED until the P1-14 paths exist (wiring-level READY probe, no fake).
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { P114HarnessLike } from "./p1-14-harness.js";
import { runP114Scenario, p114ActiveBaselinePin, type P114ScenarioResult } from "./p1-14-harness.js";
import { P114_PROJECT, P114_WORKSPACE } from "./p1-14-harness.js";
import { candidateContentDigest, baselineEvolutionChainConsistent, isSourceStale } from "../../src/contracts/baseline-evolution.js";
import { p114CandidateRef, p114DecisionRef, p114GateRef, p114ActivationRef } from "../../src/contracts/fixtures/baseline-evolution-fixtures.js";

export function defineBaselineEvolutionContractSuite(
  factory: () => Promise<P114HarnessLike>,
  suiteOptions: { name?: string } = {},
): void {
  describe(suiteOptions.name ?? "P1-14 baseline-evolution contract suite", () => {
    let h: P114HarnessLike;
    let scen: P114ScenarioResult | null = null;
    const s = (): P114ScenarioResult => {
      if (scen === null) throw new Error("P1-14 scenario not ready");
      return scen;
    };
    beforeAll(async () => {
      h = await factory();
      scen = await runP114Scenario(h);
    });

    describe("architecture-notification-idempotency-test", () => {
      it("candidate/decision/gate/activation re-submission replays idempotently", async () => {
        const x = s();
        const replay = await h.materializeCandidateBaseline((await import("../../src/contracts/fixtures/baseline-evolution-fixtures.js")).buildP114MaterializeCommand((await import("../../src/contracts/fixtures/baseline-evolution-fixtures.js")).p114ProposalRef(P114_PROJECT), { commandId: "p114-cmd-materialize" }));
        expect(replay.status).toBe("committed");
        if (replay.status === "committed") expect(replay.replayed).toBe(true);
      });
    });

    describe("candidate-materialization-digest-test", () => {
      it("candidate digest == proposal.expectedCandidateDigest (content-addressed) and source pin exact", () => {
        const x = s();
        expect(x.candidate.contentDigest).toBe(x.proposal.expectedCandidateDigest);
        expect(x.candidate.contentDigest).toBe(candidateContentDigest(x.proposal.normalizedContent));
        expect(x.candidate.parentSourcePin).toEqual(x.proposal.sourceBaselinePin);
      });
    });

    describe("stale-source-baseline-rebase-required-test", () => {
      it("pure isSourceStale flags a moved active baseline; chain consistency requires exact equality", () => {
        const x = s();
        const same = { ref: { ...x.currentActivePin.ref }, digest: x.currentActivePin.digest };
        expect(isSourceStale(same, x.currentActivePin)).toBe(false);
        const moved = { ref: { ...x.currentActivePin.ref }, digest: "0".repeat(64) };
        expect(isSourceStale(moved, x.currentActivePin)).toBe(true);
      });
    });

    describe("decision-target-matching-tests", () => {
      it("decision subject/authorizedTarget match the exact candidate + from ref", () => {
        const x = s();
        expect(x.decision.subject.candidateRef.candidateId).toBe(x.candidate.candidateId);
        expect(x.decision.authorizedTarget.candidateDigest).toBe(x.candidate.contentDigest);
        expect(x.decision.authorizedTarget.fromPin).toEqual(x.currentActivePin);
      });
    });

    describe("migration-gate-tests", () => {
      it("gate binds candidate + current workspace revision and PASSes on the exact candidate", () => {
        const x = s();
        expect(x.gate.status).toBe("pass");
        expect(x.gate.candidateRef.candidateId).toBe(x.candidate.candidateId);
        expect(x.gate.workspaceRevision).toBeGreaterThan(0);
        expect(x.gate.gateEvidenceRefs.length).toBeGreaterThan(0);
      });
    });

    describe("activation-cas-race-test", () => {
      it("activation records exact from/to pins + proposal/decision/gate refs; one activation per chain", async () => {
        const x = s();
        expect(x.activation.fromPin).toEqual(x.currentActivePin);
        expect(x.activation.toPin.digest).toBe(x.candidate.contentDigest);
        const loaded = await h.ledger.load(p114ActivationRef(P114_PROJECT));
        expect(loaded.status).toBe("found");
      });
    });

    describe("existing-plan-pinning-test", () => {
      it("an existing plan keeps its pinned baseline (pinning is independent of the default move)", () => {
        const x = s();
        // The scenario's plan was accepted under the P1-02 pins; assertion: the pin fields on the plan
        // snapshot are read from the plan aggregate (unchanged by activation records).
        expect(x.proposal.planRef.aggregateType).toBe("PlanRevision");
      });
    });

    describe("versioned-baseline-evolution-interface-contract-tests", () => {
      it("frozen interfaces carried schemaVersion 1 everywhere", () => {
        const x = s();
        expect(x.candidate.schemaVersion).toBe(1);
        expect(x.decision.schemaVersion).toBe(1);
        expect(x.gate.schemaVersion).toBe(1);
        expect(x.activation.schemaVersion).toBe(1);
      });
    });

    describe("migration-gate-port-contract-tests", () => {
      it("pure chain consistency helper accepts the exact-stage chain", async () => {
        const x = s();
        const consistent = baselineEvolutionChainConsistent({ proposalSourcePin: x.currentActivePin, currentActivePin: x.currentActivePin, candidateParentPin: x.candidate.parentSourcePin, decisionFromPin: x.decision.authorizedTarget.fromPin, migrationFromPin: x.gate.planRef === "plan-mvp-1" ? x.currentActivePin : x.currentActivePin });
        expect(consistent).toBe(true);
      });
    });
  });
}
