/**
 * P1-15 lane-A unit tests: HumanRoleCollaborationEngineImpl (real ControlEngineImpl
 * + real InMemoryLedger, through a thin RecordingLedger that captures the
 * submitted commit for fold-equality and event counting).
 *
 * Setup reuses tests/contract-suite/p1-11-harness.ts p111BootstrapGoalGovernance
 * for the P1-01/02/03 world (bootstrap + goal + installed/activated governance),
 * and the P1-15 fixture builders for the proposal/decision/policy command folds.
 *
 * Coverage (per ticket lane-A acceptance / integrator frozen guard chain):
 *   - happy path: proposal -> decision -> install ALL committed, each fold ==
 *     buildP115*Fold with the same deps; install never auto-activates;
 *   - every pre-write rejection code -> ZERO write (event count unchanged):
 *     proposal not_found (goal missing) / proposal_not_found (decision) /
 *     target_mismatch (designId + digest tamper) / invalid (proposal options 1
 *     or 17, empty ambiguity; decision proposalRevision != 1 / bad outcome /
 *     bad authority; install budget out of range / non-manual upgrade path) /
 *     digest_mismatch (install) / activate not_found / activate digest_mismatch;
 *   - activateCoordinationPolicy: guards reject with ZERO write; the shared
 *     frozen ledger validator (validateCoordinationPolicyActivateCommit) couples
 *     pE.revision == snap.revision-1 AND aE.revision == snap.revision-1, which
 *     makes a FIRST activation structurally impossible for a bootstrapped
 *     Project (revision 1) + fresh active aggregate (revision 0). The handler
 *     builds the fold exactly per the frozen ruling (Project CAS@expected +
 *     active@k); the ledger rejects it at validation time (invalid_commit ->
 *     invalid). Test asserts the fold-equality of the attempted batch and the
 *     rejection so the frozen-validator blocker is pinned;
 *   - idempotent replay of proposal/install -> committed/replayed with the
 *     SAME eventIds + commitCursor;
 *   - cross-project isolation (proj-beta's world never touches proj-alpha's
 *     aggregates).
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine.js";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import type { StateLedger, LedgerCommit, LedgerCommitReceipt } from "../../src/contracts/ledger.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";
import { createDeterministicDeps } from "../../src/contracts/testing/sequences.js";
import { initialDesignProposalDigest, coordinationPolicyContentDigest, type InitialDesignProposalV1 } from "../../src/contracts/human-role-collaboration.js";
import {
  P115_PROJECT,
  P115_WORKSPACE,
  P115_DESIGN,
  P115_POLICY,
  P115_COORDINATION_POLICY_CONTENT,
  buildP115Proposal,
  buildP115Decision,
  buildP115ProposalCommand,
  buildP115DecisionCommand,
  buildP115InstallCommand,
  buildP115ActivateCommand,
  buildP115ProposalFold,
  buildP115DecisionFold,
  buildP115PolicyInstallFold,
  buildP115PolicyActivateFold,
  p115DesignRef,
  p115DecisionRef,
  p115PolicyRef,
  p115PolicyActiveRef,
} from "../../src/contracts/fixtures/human-role-collaboration-fixtures.js";
import { p111BootstrapGoalGovernance } from "../contract-suite/p1-11-harness.js";

/** Thin recorder over the real InMemoryLedger (captures the submitted batch and
 *  the total number of events ever submitted — used for zero-write assertions). */
class RecordingLedger extends InMemoryLedger {
  commits: LedgerCommit[] = [];
  eventCount = 0;
  override async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.commits.push(batch);
    this.eventCount += batch.events.length;
    return super.commit(batch);
  }
}

type Harness = { ledger: RecordingLedger; engine: ReturnType<typeof createControlEngine> };

function makeHarness(): Harness {
  const ledger = new RecordingLedger();
  const deps = createDeterministicDeps();
  const engine = createControlEngine({ ledger, now: deps.clock, eventId: deps.eventId });
  return { ledger, engine };
}

async function setupWorld(ledger: StateLedger, projectId: string): Promise<void> {
  await p111BootstrapGoalGovernance(ledger, projectId);
}

type HappyChain = {
  harness: Harness;
  proposal: InitialDesignProposalV1;
  proposalCmd: ReturnType<typeof buildP115ProposalCommand>;
  decisionCmd: ReturnType<typeof buildP115DecisionCommand>;
  installCmd: ReturnType<typeof buildP115InstallCommand>;
};

/** Build the world for P115_PROJECT, then commit the proposal -> decision ->
 *  install chain. Returns the artifacts + command objects for replay/fold-equality. */
async function runHappyChain(): Promise<HappyChain> {
  const harness = makeHarness();
  await setupWorld(harness.ledger, P115_PROJECT);
  const proposal = buildP115Proposal({ projectId: P115_PROJECT, workspaceId: P115_WORKSPACE });
  const proposalCmd = buildP115ProposalCommand(proposal, { commandId: "p115-cmd-proposal" });
  expect((await harness.engine.recordInitialDesignProposal(proposalCmd)).status).toBe("committed");
  const decision = buildP115Decision(proposal);
  const decisionCmd = buildP115DecisionCommand(decision, { commandId: "p115-cmd-decision" });
  expect((await harness.engine.recordInitialDesignDecision(decisionCmd)).status).toBe("committed");
  const installCmd = buildP115InstallCommand(P115_PROJECT, { commandId: "p115-cmd-install" });
  expect((await harness.engine.installCoordinationPolicy(installCmd)).status).toBe("committed");
  return { harness, proposal, proposalCmd, decisionCmd, installCmd };
}

describe("P1-15 HumanRoleCollaborationEngineImpl", () => {
  describe("happy path + fold equality", () => {
    it("proposal -> decision -> install all committed, folds exact; install never auto-activates", async () => {
      const harness = makeHarness();
      await setupWorld(harness.ledger, P115_PROJECT);
      const { engine, ledger } = harness;
      const proposal = buildP115Proposal({ projectId: P115_PROJECT, workspaceId: P115_WORKSPACE });
      const proposalCmd = buildP115ProposalCommand(proposal, { commandId: "p115-cmd-proposal" });

      // proposal
      const pBefore = ledger.commits.length;
      const pReceipt = await engine.recordInitialDesignProposal(proposalCmd);
      expect(pReceipt.status).toBe("committed");
      const pBatch = ledger.commits[pBefore]!;
      expect(canonicalJson(pBatch)).toBe(canonicalJson(buildP115ProposalFold(proposalCmd, { eventId: pBatch.events[0]!.eventId, occurredAt: pBatch.events[0]!.occurredAt })));
      if (pReceipt.status === "committed") {
        expect(pReceipt.proposalRef).toEqual(p115DesignRef(P115_PROJECT));
        expect(pReceipt.replayed).toBe(false);
      }

      // decision
      const decision = buildP115Decision(proposal);
      const decisionCmd = buildP115DecisionCommand(decision, { commandId: "p115-cmd-decision" });
      const dBefore = ledger.commits.length;
      const dReceipt = await engine.recordInitialDesignDecision(decisionCmd);
      expect(dReceipt.status).toBe("committed");
      const dBatch = ledger.commits[dBefore]!;
      expect(canonicalJson(dBatch)).toBe(canonicalJson(buildP115DecisionFold(decisionCmd, { eventId: dBatch.events[0]!.eventId, occurredAt: dBatch.events[0]!.occurredAt })));
      if (dReceipt.status === "committed") {
        expect(dReceipt.decisionRef).toEqual(p115DecisionRef(P115_PROJECT));
        expect(dReceipt.replayed).toBe(false);
      }

      // install (never auto-activates)
      const installCmd = buildP115InstallCommand(P115_PROJECT, { commandId: "p115-cmd-install" });
      const iBefore = ledger.commits.length;
      const iReceipt = await engine.installCoordinationPolicy(installCmd);
      expect(iReceipt.status).toBe("committed");
      const iBatch = ledger.commits[iBefore]!;
      expect(canonicalJson(iBatch)).toBe(canonicalJson(buildP115PolicyInstallFold(installCmd, { eventId: iBatch.events[0]!.eventId, occurredAt: iBatch.events[0]!.occurredAt })));
      if (iReceipt.status === "committed") {
        expect(iReceipt.revisionRef).toEqual(p115PolicyRef(P115_PROJECT));
        expect(iReceipt.contentDigest).toBe(coordinationPolicyContentDigest(P115_COORDINATION_POLICY_CONTENT, P115_POLICY, 1));
        expect(iReceipt.replayed).toBe(false);
      }

      // install must NOT auto-activate
      const activeAfterInstall = await ledger.load(p115PolicyActiveRef(P115_PROJECT));
      expect(activeAfterInstall.status).toBe("not_found");

      // recorded aggregates are consistent
      const recorded = await ledger.load(p115DesignRef(P115_PROJECT));
      expect(recorded.status).toBe("found");
      if (recorded.status === "found") {
        const snap = recorded.snapshot as { proposal: InitialDesignProposalV1 };
        expect(snap.proposal.designId).toBe(P115_DESIGN);
        expect(snap.proposal.options.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("recordInitialDesignProposal guards (zero write)", () => {
    it("invalid: options length 1 and 17", async () => {
      const harness = makeHarness();
      await setupWorld(harness.ledger, P115_PROJECT);
      for (const n of [1, 17]) {
        const proposal = buildP115Proposal({ options: Array.from({ length: n }, (_, i) => ({ optionId: "opt-" + i, summary: "s" + i, impactDelta: "d" + i })) });
        const before = harness.ledger.eventCount;
        const receipt = await harness.engine.recordInitialDesignProposal(buildP115ProposalCommand(proposal, { commandId: "p115-cmd-proposal-invalid-" + n }));
        expect(receipt.status).toBe("rejected");
        if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
        expect(harness.ledger.eventCount).toBe(before);
      }
    });

    it("invalid: empty requirement.ambiguity", async () => {
      const harness = makeHarness();
      await setupWorld(harness.ledger, P115_PROJECT);
      const proposal = buildP115Proposal({ requirement: { ambiguity: "", interpretations: ["a"] } });
      const before = harness.ledger.eventCount;
      const receipt = await harness.engine.recordInitialDesignProposal(buildP115ProposalCommand(proposal, { commandId: "p115-cmd-proposal-invalid-amb" }));
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("not_found: proposal goal does not exist", async () => {
      const harness = makeHarness();
      await setupWorld(harness.ledger, P115_PROJECT);
      const proposal = buildP115Proposal({ goalRef: { aggregateType: "Goal", projectId: P115_PROJECT, goalId: "goal-missing" } });
      const before = harness.ledger.eventCount;
      const receipt = await harness.engine.recordInitialDesignProposal(buildP115ProposalCommand(proposal, { commandId: "p115-cmd-proposal-goal-missing" }));
      expect(receipt).toEqual({ status: "rejected", commandId: "p115-cmd-proposal-goal-missing", code: "not_found" });
      expect(harness.ledger.eventCount).toBe(before);
    });
  });

  describe("recordInitialDesignDecision guards (zero write)", () => {
    it("proposal_not_found: decision binds an unknown proposal", async () => {
      const { harness } = await runHappyChain();
      const { engine } = harness;
      const before = harness.ledger.eventCount;
      const cmd = buildP115DecisionCommand(
        buildP115Decision(buildP115Proposal({ projectId: P115_PROJECT, workspaceId: P115_WORKSPACE }), { proposalRef: { aggregateType: "InitialDesignProposal", projectId: P115_PROJECT, workspaceId: P115_WORKSPACE, designId: "design-missing" } }),
        { commandId: "p115-cmd-decision-proposal-missing" },
      );
      const receipt = await engine.recordInitialDesignDecision(cmd);
      expect(receipt).toEqual({ status: "rejected", commandId: "p115-cmd-decision-proposal-missing", code: "proposal_not_found" });
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("target_mismatch: tampered authorizedTarget.proposalDigest", async () => {
      const { harness, proposal } = await runHappyChain();
      const { engine } = harness;
      const before = harness.ledger.eventCount;
      const decision = buildP115Decision(proposal, { authorizedTarget: { designId: proposal.designId, optionId: proposal.options[0]!.optionId, proposalDigest: "0".repeat(64) } });
      const receipt = await engine.recordInitialDesignDecision(buildP115DecisionCommand(decision, { commandId: "p115-cmd-decision-target-digest" }));
      expect(receipt).toEqual({ status: "rejected", commandId: "p115-cmd-decision-target-digest", code: "target_mismatch" });
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("target_mismatch: tampered authorizedTarget.designId", async () => {
      const { harness, proposal } = await runHappyChain();
      const { engine } = harness;
      const before = harness.ledger.eventCount;
      const decision = buildP115Decision(proposal, { authorizedTarget: { designId: "design-wrong", optionId: proposal.options[0]!.optionId, proposalDigest: initialDesignProposalDigest(proposal) } });
      const receipt = await engine.recordInitialDesignDecision(buildP115DecisionCommand(decision, { commandId: "p115-cmd-decision-target-design" }));
      expect(receipt).toEqual({ status: "rejected", commandId: "p115-cmd-decision-target-design", code: "target_mismatch" });
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("invalid: subject.proposalRevision != 1", async () => {
      const { harness, proposal } = await runHappyChain();
      const { engine } = harness;
      const before = harness.ledger.eventCount;
      const decision = buildP115Decision(proposal, { subject: { proposalRevision: 2 } });
      const receipt = await engine.recordInitialDesignDecision(buildP115DecisionCommand(decision, { commandId: "p115-cmd-decision-invalid-rev" }));
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("invalid: outcome not in enum", async () => {
      const { harness, proposal } = await runHappyChain();
      const { engine } = harness;
      const before = harness.ledger.eventCount;
      const decision = buildP115Decision(proposal, { outcome: "maybe" as never });
      const receipt = await engine.recordInitialDesignDecision(buildP115DecisionCommand(decision, { commandId: "p115-cmd-decision-invalid-outcome" }));
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("invalid: authority shape (strategy=user but delegator non-null)", async () => {
      const { harness, proposal } = await runHappyChain();
      const { engine } = harness;
      const before = harness.ledger.eventCount;
      const decision = buildP115Decision(proposal, { authority: { strategy: "user", delegator: "someone", policyVersion: "v1" } });
      const receipt = await engine.recordInitialDesignDecision(buildP115DecisionCommand(decision, { commandId: "p115-cmd-decision-invalid-authority" }));
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
      expect(harness.ledger.eventCount).toBe(before);
    });
  });

  describe("installCoordinationPolicy guards (zero write)", () => {
    it("digest_mismatch: contentDigest does not match recompute", async () => {
      const harness = makeHarness();
      await setupWorld(harness.ledger, P115_PROJECT);
      const before = harness.ledger.eventCount;
      const cmd = buildP115InstallCommand(P115_PROJECT, { commandId: "p115-cmd-install-digest" });
      const tampered = { ...cmd, payload: { ...cmd.payload, contentDigest: "0".repeat(64) } };
      const receipt = await harness.engine.installCoordinationPolicy(tampered);
      expect(receipt).toEqual({ status: "rejected", commandId: "p115-cmd-install-digest", code: "digest_mismatch" });
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("invalid: maxAutonomousReworks out of range (0 and 5)", async () => {
      const harness = makeHarness();
      await setupWorld(harness.ledger, P115_PROJECT);
      for (const v of [0, 5]) {
        const content = { ...P115_COORDINATION_POLICY_CONTENT, budget: { ...P115_COORDINATION_POLICY_CONTENT.budget, maxAutonomousReworks: v } };
        const before = harness.ledger.eventCount;
        const cmd = { ...buildP115InstallCommand(P115_PROJECT, { commandId: "p115-cmd-install-rework-" + v }), payload: { policyId: P115_POLICY, content, contentDigest: coordinationPolicyContentDigest(content, P115_POLICY, 1) } };
        const receipt = await harness.engine.installCoordinationPolicy(cmd);
        expect(receipt.status).toBe("rejected");
        if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
        expect(harness.ledger.eventCount).toBe(before);
      }
    });

    it("invalid: maxClarifications out of range (0 and 9)", async () => {
      const harness = makeHarness();
      await setupWorld(harness.ledger, P115_PROJECT);
      for (const v of [0, 9]) {
        const content = { ...P115_COORDINATION_POLICY_CONTENT, budget: { ...P115_COORDINATION_POLICY_CONTENT.budget, maxClarifications: v } };
        const before = harness.ledger.eventCount;
        const cmd = { ...buildP115InstallCommand(P115_PROJECT, { commandId: "p115-cmd-install-clar-" + v }), payload: { policyId: P115_POLICY, content, contentDigest: coordinationPolicyContentDigest(content, P115_POLICY, 1) } };
        const receipt = await harness.engine.installCoordinationPolicy(cmd);
        expect(receipt.status).toBe("rejected");
        if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
        expect(harness.ledger.eventCount).toBe(before);
      }
    });

    it("invalid: upgrade.path is not manual-decision", async () => {
      const harness = makeHarness();
      await setupWorld(harness.ledger, P115_PROJECT);
      const content = { ...P115_COORDINATION_POLICY_CONTENT, upgrade: { path: "auto-decision" as "manual-decision", note: "n" } };
      const before = harness.ledger.eventCount;
      const cmd = { ...buildP115InstallCommand(P115_PROJECT, { commandId: "p115-cmd-install-upgrade" }), payload: { policyId: P115_POLICY, content, contentDigest: coordinationPolicyContentDigest(content, P115_POLICY, 1) } };
      const receipt = await harness.engine.installCoordinationPolicy(cmd);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
      expect(harness.ledger.eventCount).toBe(before);
    });
  });

  describe("activateCoordinationPolicy guards (zero write) + frozen-validator fold-equality", () => {
    it("not_found: target policy revision not installed", async () => {
      const harness = makeHarness();
      await setupWorld(harness.ledger, P115_PROJECT);
      await harness.engine.installCoordinationPolicy(buildP115InstallCommand(P115_PROJECT, { commandId: "p115-cmd-install" }));
      const before = harness.ledger.eventCount;
      const cmd = buildP115ActivateCommand(P115_PROJECT, { commandId: "p115-cmd-activate-notfound", expectedRevision: 1 });
      const notInstalled = { ...cmd, payload: { target: { ref: { aggregateType: "CoordinationPolicyRevision" as const, projectId: P115_PROJECT, policyId: "policy-missing", revision: 1 }, digest: cmd.payload.target.digest } } };
      const receipt = await harness.engine.activateCoordinationPolicy(notInstalled);
      expect(receipt).toEqual({ status: "rejected", commandId: "p115-cmd-activate-notfound", code: "not_found" });
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("digest_mismatch: target digest does not match installed revision", async () => {
      const harness = makeHarness();
      await setupWorld(harness.ledger, P115_PROJECT);
      await harness.engine.installCoordinationPolicy(buildP115InstallCommand(P115_PROJECT, { commandId: "p115-cmd-install" }));
      const before = harness.ledger.eventCount;
      const cmd = buildP115ActivateCommand(P115_PROJECT, { commandId: "p115-cmd-activate-digest", expectedRevision: 1 });
      const tampered = { ...cmd, payload: { target: { ...cmd.payload.target, digest: "0".repeat(64) } } };
      const receipt = await harness.engine.activateCoordinationPolicy(tampered);
      expect(receipt).toEqual({ status: "rejected", commandId: "p115-cmd-activate-digest", code: "digest_mismatch" });
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("frozen-validator blocker: fold built exactly per ruling, ledger rejects first activation (invalid_commit -> invalid)", async () => {
      const harness = makeHarness();
      await setupWorld(harness.ledger, P115_PROJECT);
      await harness.engine.recordInitialDesignProposal(buildP115ProposalCommand(buildP115Proposal({ projectId: P115_PROJECT, workspaceId: P115_WORKSPACE }), { commandId: "p115-cmd-proposal" }));
      await harness.engine.installCoordinationPolicy(buildP115InstallCommand(P115_PROJECT, { commandId: "p115-cmd-install" }));
      const cmd = buildP115ActivateCommand(P115_PROJECT, { commandId: "p115-cmd-activate", expectedRevision: 1 });
      const before = harness.ledger.commits.length;
      const receipt = await harness.engine.activateCoordinationPolicy(cmd);
      const batch = harness.ledger.commits[before]!;
      // fold-equality: the handler used projectRevision = command.expectedRevision
      // and activeAggregateRevision = (active@k) + 1, exactly as the frozen ruling.
      const expected = buildP115PolicyActivateFold(cmd, {
        eventId: batch.events[0]!.eventId,
        occurredAt: batch.events[0]!.occurredAt,
        activeAggregateRevision: batch.snapshots[0]!.revision,
        projectRevision: batch.expectedVersions[0]!.revision,
      });
      expect(canonicalJson(batch)).toBe(canonicalJson(expected));
      // The frozen validator couples Project@(snap.revision-1) AND active@(snap.revision-1),
      // so a first activation (Project@1, active@0) cannot commit. Handler maps
      // invalid_commit -> invalid. (Pinned so the gap is traceable.)
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
      // no snapshot landed (validation rejected before any write)
      const activeAfter = await harness.ledger.load(p115PolicyActiveRef(P115_PROJECT));
      expect(activeAfter.status).toBe("not_found");
    });
  });

  describe("idempotent replay", () => {
    it("proposal replay: same eventIds + commitCursor, replayed=true", async () => {
      const { harness, proposal } = await runHappyChain();
      const { engine } = harness;
      const cmd = buildP115ProposalCommand(proposal, { commandId: "p115-cmd-proposal" });
      const first = await engine.recordInitialDesignProposal(cmd);
      expect(first.status).toBe("committed");
      if (first.status !== "committed") throw new Error("first proposal not committed");
      const replay = await engine.recordInitialDesignProposal(cmd);
      expect(replay.status).toBe("committed");
      if (replay.status === "committed") {
        expect(replay.replayed).toBe(true);
        expect(replay.eventIds).toEqual(first.eventIds);
        expect(replay.commitCursor).toEqual(first.commitCursor);
      }
    });

    it("install replay: same eventIds + commitCursor, replayed=true", async () => {
      const { harness } = await runHappyChain();
      const { engine } = harness;
      const cmd = buildP115InstallCommand(P115_PROJECT, { commandId: "p115-cmd-install" });
      const first = await engine.installCoordinationPolicy(cmd);
      expect(first.status).toBe("committed");
      if (first.status !== "committed") throw new Error("first install not committed");
      const replay = await engine.installCoordinationPolicy(cmd);
      expect(replay.status).toBe("committed");
      if (replay.status === "committed") {
        expect(replay.replayed).toBe(true);
        expect(replay.eventIds).toEqual(first.eventIds);
        expect(replay.commitCursor).toEqual(first.commitCursor);
      }
    });
  });

  describe("cross-project isolation", () => {
    it("proj-alpha aggregates never surface under proj-beta", async () => {
      await runHappyChain();
      const harness = makeHarness();
      await setupWorld(harness.ledger, "proj-beta");
      // The fixture hardcodes goalRef/planRef to P115_PROJECT, so override every
      // project-scoped ref so the proposal is bound to proj-beta's world.
      const proposal = buildP115Proposal({
        projectId: "proj-beta",
        workspaceId: P115_WORKSPACE,
        goalRef: { aggregateType: "Goal", projectId: "proj-beta", goalId: "goal-1" },
        planRef: { aggregateType: "PlanRevision", projectId: "proj-beta", planId: "plan-mvp-1" },
      });
      const proposalCmd = buildP115ProposalCommand(proposal, { commandId: "p115-cmd-proposal-beta" });
      const receipt = await harness.engine.recordInitialDesignProposal(proposalCmd);
      expect(receipt.status).toBe("committed");
      // beta world's proposal ref is distinct from alpha's
      const alphaRef = await harness.ledger.load(p115DesignRef(P115_PROJECT));
      expect(alphaRef.status).toBe("not_found");
      const betaRef = await harness.ledger.load(p115DesignRef("proj-beta"));
      expect(betaRef.status).toBe("found");
    });
  });
});
