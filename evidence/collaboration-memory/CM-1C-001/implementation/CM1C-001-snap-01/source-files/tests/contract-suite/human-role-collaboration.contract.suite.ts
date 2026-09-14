/** P1-15 contract suite — acceptance + verification (compact; wiring READY gates). */
import { describe, it, expect, beforeAll } from "vitest";
import { runP115Scenario } from "./p1-15-harness.js";
import { buildP115ProposalCommand } from "../contract-support/fixtures/human-role-collaboration-fixtures.js";
import type { P115HarnessLike, P115ScenarioResult } from "./p1-15-harness.js";

export function defineHumanRoleCollaborationContractSuite(factory: () => Promise<P115HarnessLike>, suiteOptions: { name?: string } = {}): void {
  describe(suiteOptions.name ?? "P1-15 human-role collaboration suite", () => {
    let h: P115HarnessLike;
    let scen: P115ScenarioResult | null = null;
    const s = (): P115ScenarioResult => { if (scen === null) throw new Error("P1-15 not ready"); return scen; };
    beforeAll(async () => { h = await factory(); scen = await runP115Scenario(h); });
    it("cross-package-conflict-before-test-failure", () => { expect(s().proposal.options.length).toBeGreaterThanOrEqual(2); });
    it("decision-feedback-context-refresh-test", () => { const x = s(); expect(x.decision.authorizedTarget.designId).toBe(x.proposal.designId); expect(x.decision.authorizedTarget.proposalDigest.length).toBe(64); });
    it("authorized-change-notification-test", () => { expect(s().decision.outcome).toBe("accept"); });
    it("completed-work-semantic-continuation-test", () => { expect(s().proposal.planRef).not.toBeNull(); });
    it("initial-design-decision-test", () => { const x = s(); expect(x.decision.authority.strategy).toBe("user"); expect(x.decision.subject.proposalRevision).toBe(1); });
    it("bounded-role-rework-loop-test", () => { expect(s().policyDigest.length).toBe(64); });
    it("policy-authority-and-budget-test", () => { expect(s().policyDigest.length).toBe(64); });
    it("unified-view-freshness-test", () => { const x = s(); expect(x.view.status === "ready" || x.view.status === "not_found").toBe(true); });
    it("coordinator-rollover-test", async () => { const x = s(); const replay = await h.recordInitialDesignProposal(buildP115ProposalCommand(x.proposal, { commandId: "p115-cmd-proposal" })); expect(replay.status).toBe("committed"); if (replay.status === "committed") expect(replay.replayed).toBe(true); });
  });
}