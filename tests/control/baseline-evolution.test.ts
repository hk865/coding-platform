/**
 * P1-14 lane A unit tests: BaselineEvolutionEngineImpl (real ControlEngineImpl
 * + real InMemoryLedger, through a thin RecordingLedger that captures the
 * submitted commit for fold-equality and event counting).
 *
 * Setup reuses tests/contract-suite/p1-11-harness.ts p111BootstrapGoalGovernance
 * for the P1-02/03 world (bootstrap + goal + installed/activated governance),
 * and the P1-12 fixture builders for the candidate proposal recorded through
 * the real control engine's recordCandidateBaselineProposal.
 *
 * Coverage (per ticket lane-A acceptance / integrator frozen guard chain):
 *   - happy path: proposal -> materialize -> decision(accept) -> gate(pass) ->
 *     activation ALL committed, each fold == buildP114*Fold with the same deps;
 *   - every pre-write rejection code -> ZERO write (event count unchanged):
 *     proposal_not_found / source_stale / digest_mismatch;
 *     candidate_not_found / target_mismatch;
 *     workspace_revision_mismatch;
 *     decision_not_found / decision_not_accepted / gate_not_found / gate_not_pass /
 *     source_stale (activation);
 *   - idempotent replay of each command -> committed/replayed with the SAME
 *     eventIds + commitCursor;
 *   - cross-project isolation (project B's world never touches project A's
 *     aggregates).
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine.js";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import type { StateLedger, LedgerCommit, LedgerCommitReceipt } from "../../src/contracts/ledger.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import type { ArchitectureBaselinePin } from "../../src/contracts/governance.js";
import type { ArchitectureCandidateProposalV1 } from "../../src/contracts/architecture-inspection.js";
import { candidateProposalDigest } from "../../src/contracts/architecture-inspection.js";
import { candidateContentDigest } from "../../src/contracts/baseline-evolution.js";
import type { CandidateArchitectureBaselineV1 } from "../../src/contracts/baseline-evolution.js";
import {
  buildP112Proposal,
  buildRecordCandidateBaselineProposalCommand,
} from "../../src/contracts/fixtures/architecture-fixtures.js";
import {
  P114_PROJECT,
  P114_WORKSPACE,
  P114_PROPOSAL,
  buildP114Candidate,
  buildP114Decision,
  buildP114Gate,
  buildP114Activation,
  buildP114MaterializeCommand,
  buildP114DecisionCommand,
  buildP114GateCommand,
  buildP114ActivationCommand,
  buildP114CandidateFold,
  buildP114DecisionFold,
  buildP114GateFold,
  buildP114ActivationFold,
  p114ProposalRef,
  p114CandidateRef,
  p114DecisionRef,
  p114GateRef,
  p114ActivationRef,
} from "../../src/contracts/fixtures/baseline-evolution-fixtures.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  buildInstallCommand,
  buildInstallLedgerCommit,
  buildActivateCommand,
  buildActivateLedgerCommit,
  architectureBaselinePinFor,
} from "../../src/contracts/fixtures/governance-fixtures.js";
import type { InstallArchitectureBaselineRevisionCommand } from "../../src/contracts/governance.js";
import { p111BootstrapGoalGovernance } from "../contract-suite/p1-11-harness.js";

const FIXED = FIXED_ISO_2026_09_05;

/** Thin recorder over the real InMemoryLedger (captures the submitted batch and
 *  the total number of events ever committed — used for zero-write assertions). */
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

/** Currently active ArchitectureBaseline pin (ref + digest) for a project. */
async function activeBaselinePin(ledger: StateLedger, projectId: string): Promise<ArchitectureBaselinePin> {
  const active = await ledger.load({ aggregateType: "ProjectArchitectureBaselineActive", projectId });
  expect(active.status).toBe("found");
  if (active.status !== "found") throw new Error("baseline active aggregate missing");
  const activeSnap = active.snapshot as { activeRevision: ArchitectureBaselinePin["ref"] };
  const rev = await ledger.load(activeSnap.activeRevision);
  expect(rev.status).toBe("found");
  if (rev.status !== "found") throw new Error("baseline revision missing");
  const revSnap = rev.snapshot as { contentDigest: string };
  return { ref: activeSnap.activeRevision, digest: revSnap.contentDigest };
}

/** Bootstrap + goal + installed/activated governance for a project (P1-11 world). */
async function setupWorld(ledger: StateLedger, projectId: string): Promise<void> {
  await p111BootstrapGoalGovernance(ledger, projectId);
}

/** Record a P1-12 candidate proposal bound to the current active baseline.
 *  Returns the proposal + the active pin it is bound to. */
async function recordProposal(engine: Harness["engine"], ledger: StateLedger, projectId: string): Promise<{ proposal: ArchitectureCandidateProposalV1; currentActivePin: ArchitectureBaselinePin }> {
  const currentActivePin = await activeBaselinePin(ledger, projectId);
  const raw = buildP112Proposal();
  const proposal: ArchitectureCandidateProposalV1 = {
    ...raw,
    projectId,
    workspaceId: P114_WORKSPACE,
    planRef: { ...raw.planRef, projectId },
    sourceBaselinePin: { ...currentActivePin },
    expectedCandidateDigest: candidateContentDigest(raw.normalizedContent),
  };
  // proposalDigest must match the recompute over the overridden payload (P1-12 guard).
  proposal.proposalDigest = candidateProposalDigest(proposal);
  const receipt = await engine.recordCandidateBaselineProposal(
    buildRecordCandidateBaselineProposalCommand(proposal, { commandId: "p114-cmd-proposal-" + projectId }),
  );
  expect(receipt.status).toBe("committed");
  return { proposal, currentActivePin };
}

/** Install + activate a NEW architecture baseline revision (rev+1) so the
 *  project's active pin MOVES — used to construct source_stale scenarios. */
async function activateNewBaseline(ledger: StateLedger, projectId: string, revision: number): Promise<void> {
  const fixture = {
    ...ARCHITECTURE_BASELINE_FIXTURE_V1,
    revision,
    content: { ...ARCHITECTURE_BASELINE_FIXTURE_V1.content, description: "baseline revision " + revision },
  };
  const installCmd = buildInstallCommand(fixture, {
    commandId: "cmd-install-ab-" + projectId + "-" + revision,
    correlationId: "corr-install-ab-" + projectId + "-" + revision,
    submittedAt: FIXED,
    projectId,
    idempotencyKey: "inst-ab-" + projectId + "-" + revision,
  }) as InstallArchitectureBaselineRevisionCommand;
  const installReceipt = await ledger.commit(buildInstallLedgerCommit(installCmd, { eventId: "evt-install-ab-" + projectId + "-" + revision, occurredAt: FIXED }));
  expect(installReceipt.status).toBe("committed");
  const activateCmd = buildActivateCommand(architectureBaselinePinFor(installCmd), {
    commandId: "cmd-act-ab-" + projectId + "-" + revision,
    correlationId: "corr-act-ab-" + projectId + "-" + revision,
    submittedAt: FIXED,
    projectId,
    expectedRevision: 1,
    idempotencyKey: "act-ab-" + projectId + "-" + revision,
  });
  const activateReceipt = await ledger.commit(buildActivateLedgerCommit(activateCmd, { eventId: "evt-act-ab-" + projectId + "-" + revision, occurredAt: FIXED, activeAggregateRevision: 2, projectRevision: 1 }));
  expect(activateReceipt.status).toBe("committed");
}

/** Full happy-path chain over a fresh world: proposal recorded, then
 *  materialize -> decision(accept) -> gate(pass) -> activation, ALL committed.
 *  Returns the artifacts + command objects for replay/fold-equality. */
async function runHappyPath(): Promise<{
  harness: Harness;
  proposal: ArchitectureCandidateProposalV1;
  currentActivePin: ArchitectureBaselinePin;
  materializeCmd: ReturnType<typeof buildP114MaterializeCommand>;
  decisionCmd: ReturnType<typeof buildP114DecisionCommand>;
  gateCmd: ReturnType<typeof buildP114GateCommand>;
  activationCmd: ReturnType<typeof buildP114ActivationCommand>;
  workspaceRevision: number;
}> {
  const harness = makeHarness();
  await setupWorld(harness.ledger, P114_PROJECT);
  const { proposal, currentActivePin } = await recordProposal(harness.engine, harness.ledger, P114_PROJECT);

  const workspaceResult = await harness.ledger.load({ aggregateType: "Workspace", projectId: P114_PROJECT, workspaceId: P114_WORKSPACE });
  expect(workspaceResult.status).toBe("found");
  if (workspaceResult.status !== "found") throw new Error("workspace missing");
  const workspaceRevision = workspaceResult.snapshot.revision;

  const materializeCmd = buildP114MaterializeCommand(p114ProposalRef(P114_PROJECT), { commandId: "p114-cmd-materialize" });
  const candidate = buildP114Candidate(proposal);

  const decision = buildP114Decision(candidate, { fromPin: currentActivePin });
  const decisionCmd = buildP114DecisionCommand(decision, { commandId: "p114-cmd-decision" });

  const gate = buildP114Gate(candidate, { workspaceRevision });
  const gateCmd = buildP114GateCommand(gate, { commandId: "p114-cmd-gate" });

  const toPin = { ref: { aggregateType: "ArchitectureBaselineRevision" as const, projectId: P114_PROJECT, baselineId: "architecture-baseline-1", revision: 2 }, digest: candidate.contentDigest };
  const activation = buildP114Activation(candidate, decision, gate, toPin);
  const activationCmd = buildP114ActivationCommand(activation, { commandId: "p114-cmd-activation" });

  return { harness, proposal, currentActivePin, materializeCmd, decisionCmd, gateCmd, activationCmd, workspaceRevision };
}

/** Materialise + record the accept decision + pass gate so later guards can be
 *  exercised independently (a missing candidate/decision/gate would otherwise
 *  short-circuit earlier in the guard chain). */
async function recordChain(
  harness: Harness,
  materializeCmd: ReturnType<typeof buildP114MaterializeCommand>,
  decisionCmd: ReturnType<typeof buildP114DecisionCommand>,
  gateCmd: ReturnType<typeof buildP114GateCommand>,
): Promise<void> {
  const { engine } = harness;
  expect((await engine.materializeCandidateBaseline(materializeCmd)).status).toBe("committed");
  expect((await engine.recordArchitectureChangeDecision(decisionCmd)).status).toBe("committed");
  expect((await engine.recordMigrationGate(gateCmd)).status).toBe("committed");
}

describe("P1-14 BaselineEvolutionEngineImpl", () => {
  describe("happy path + fold equality", () => {
    it("proposal -> materialize -> decision(accept) -> gate(pass) -> activation all committed, folds exact", async () => {
      const { harness, proposal, currentActivePin, materializeCmd, decisionCmd, gateCmd, activationCmd, workspaceRevision } = await runHappyPath();
      const { ledger, engine } = harness;

      // materialize
      const mBefore = ledger.commits.length;
      const mReceipt = await engine.materializeCandidateBaseline(materializeCmd);
      expect(mReceipt.status).toBe("committed");
      const mBatch = ledger.commits[mBefore]!;
      const expectedCandidate: CandidateArchitectureBaselineV1 = {
        schemaVersion: 1,
        candidateId: materializeCmd.aggregateId,
        projectId: P114_PROJECT,
        workspaceId: P114_WORKSPACE,
        proposalRef: { ...materializeCmd.payload.proposalRef },
        parentSourcePin: { ...proposal.sourceBaselinePin },
        normalizedContent: proposal.normalizedContent,
        contentDigest: candidateContentDigest(proposal.normalizedContent),
        materializedAt: FIXED,
      };
      const expectedFold = buildP114CandidateFold(materializeCmd, { eventId: mBatch.events[0]!.eventId, occurredAt: mBatch.events[0]!.occurredAt, candidate: expectedCandidate });
      expect(canonicalJson(mBatch)).toBe(canonicalJson(expectedFold));

      // decision
      const dBefore = ledger.commits.length;
      const dReceipt = await engine.recordArchitectureChangeDecision(decisionCmd);
      expect(dReceipt.status).toBe("committed");
      const dBatch = ledger.commits[dBefore]!;
      expect(canonicalJson(dBatch)).toBe(canonicalJson(buildP114DecisionFold(decisionCmd, { eventId: dBatch.events[0]!.eventId, occurredAt: dBatch.events[0]!.occurredAt })));

      // gate
      const gBefore = ledger.commits.length;
      const gReceipt = await engine.recordMigrationGate(gateCmd);
      expect(gReceipt.status).toBe("committed");
      const gBatch = ledger.commits[gBefore]!;
      expect(canonicalJson(gBatch)).toBe(canonicalJson(buildP114GateFold(gateCmd, { eventId: gBatch.events[0]!.eventId, occurredAt: gBatch.events[0]!.occurredAt })));

      // activation
      const aBefore = ledger.commits.length;
      const aReceipt = await engine.recordBaselineActivation(activationCmd);
      expect(aReceipt.status).toBe("committed");
      const aBatch = ledger.commits[aBefore]!;
      expect(canonicalJson(aBatch)).toBe(canonicalJson(buildP114ActivationFold(activationCmd, { eventId: aBatch.events[0]!.eventId, occurredAt: aBatch.events[0]!.occurredAt })));

      // committed recipe fields
      if (mReceipt.status === "committed") {
        expect(mReceipt.candidateRef).toEqual(p114CandidateRef(P114_PROJECT));
        expect(mReceipt.replayed).toBe(false);
      }
      if (dReceipt.status === "committed") expect(dReceipt.decisionRef).toEqual(p114DecisionRef(P114_PROJECT));
      if (gReceipt.status === "committed") expect(gReceipt.gateRef).toEqual(p114GateRef(P114_PROJECT));
      if (aReceipt.status === "committed") expect(aReceipt.activationRef).toEqual(p114ActivationRef(P114_PROJECT));

      // chain consistency across the recorded aggregates
      const cand = await ledger.load(p114CandidateRef(P114_PROJECT));
      expect(cand.status).toBe("found");
      if (cand.status === "found") {
        const csnap = cand.snapshot as { candidate: { contentDigest: string; parentSourcePin: ArchitectureBaselinePin } };
        expect(csnap.candidate.contentDigest).toBe(candidateContentDigest(proposal.normalizedContent));
        expect(csnap.candidate.parentSourcePin).toEqual(currentActivePin);
      }
      const decision = await ledger.load(p114DecisionRef(P114_PROJECT));
      expect(decision.status).toBe("found");
      if (decision.status === "found") {
        const dsnap = decision.snapshot as { decision: { outcome: string } };
        expect(dsnap.decision.outcome).toBe("accept");
      }
      const gate = await ledger.load(p114GateRef(P114_PROJECT));
      expect(gate.status).toBe("found");
      if (gate.status === "found") {
        const gsnap = gate.snapshot as { gate: { status: string; workspaceRevision: number } };
        expect(gsnap.gate.status).toBe("pass");
        expect(gsnap.gate.workspaceRevision).toBe(workspaceRevision);
      }
      const activation = await ledger.load(p114ActivationRef(P114_PROJECT));
      expect(activation.status).toBe("found");
    });
  });

  describe("materialize guards (zero write)", () => {
    it("proposal_not_found: unknown proposal ref", async () => {
      const { harness, materializeCmd } = await runHappyPath();
      const before = harness.ledger.eventCount;
      const cmd = { ...materializeCmd, payload: { proposalRef: { ...materializeCmd.payload.proposalRef, proposalId: "proposal-missing" } } };
      const receipt = await harness.engine.materializeCandidateBaseline(cmd);
      expect(receipt).toEqual({ status: "rejected", commandId: materializeCmd.commandId, code: "proposal_not_found" });
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("source_stale: active baseline moved after the proposal was recorded", async () => {
      const { harness, materializeCmd } = await runHappyPath();
      await activateNewBaseline(harness.ledger, P114_PROJECT, 2);
      const before = harness.ledger.eventCount;
      const receipt = await harness.engine.materializeCandidateBaseline(materializeCmd);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("source_stale");
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("digest_mismatch: tampered proposal.expectedCandidateDigest", async () => {
      const harness = makeHarness();
      await setupWorld(harness.ledger, P114_PROJECT);
      // Record a proposal whose content is valid but whose expectedCandidateDigest
      // is tampered (NOT part of the proposal digest payload -> P1-12 accepts it;
      // the P1-14 materialise guard rejects it with digest_mismatch, zero write).
      const currentActivePin = await activeBaselinePin(harness.ledger, P114_PROJECT);
      const raw = buildP112Proposal();
      const tampered: ArchitectureCandidateProposalV1 = {
        ...raw,
        projectId: P114_PROJECT,
        workspaceId: P114_WORKSPACE,
        sourceBaselinePin: { ...currentActivePin },
        expectedCandidateDigest: "0".repeat(64),
      };
      const tamperReceipt = await harness.engine.recordCandidateBaselineProposal(
        buildRecordCandidateBaselineProposalCommand(tampered, { commandId: "p114-cmd-proposal-tampered" }),
      );
      expect(tamperReceipt.status).toBe("committed");
      const before = harness.ledger.eventCount;
      const cmd = buildP114MaterializeCommand(p114ProposalRef(P114_PROJECT), { commandId: "p114-cmd-materialize" });
      const receipt = await harness.engine.materializeCandidateBaseline(cmd);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("digest_mismatch");
      expect(harness.ledger.eventCount).toBe(before);
    });
  });

  describe("decision guards (zero write)", () => {
    it("candidate_not_found: decision binds an unknown candidate", async () => {
      const { harness, decisionCmd, currentActivePin } = await runHappyPath();
      const before = harness.ledger.eventCount;
      const tampered = { ...decisionCmd, payload: { decision: { ...decisionCmd.payload.decision, subject: { ...decisionCmd.payload.decision.subject, candidateRef: { ...decisionCmd.payload.decision.subject.candidateRef, candidateId: "candidate-missing" } } } } };
      const receipt = await harness.engine.recordArchitectureChangeDecision(tampered);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("candidate_not_found");
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("target_mismatch: authorizedTarget.candidateDigest tampered", async () => {
      const { harness, materializeCmd, decisionCmd, gateCmd } = await runHappyPath();
      await recordChain(harness, materializeCmd, decisionCmd, gateCmd);
      const before = harness.ledger.eventCount;
      const tampered = { ...decisionCmd, payload: { decision: { ...decisionCmd.payload.decision, authorizedTarget: { ...decisionCmd.payload.decision.authorizedTarget, candidateDigest: "0".repeat(64) } } } };
      const receipt = await harness.engine.recordArchitectureChangeDecision(tampered);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("target_mismatch");
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("target_mismatch: authorizedTarget.fromPin tampered", async () => {
      const { harness, materializeCmd, decisionCmd, gateCmd } = await runHappyPath();
      await recordChain(harness, materializeCmd, decisionCmd, gateCmd);
      const before = harness.ledger.eventCount;
      const tampered = { ...decisionCmd, payload: { decision: { ...decisionCmd.payload.decision, authorizedTarget: { ...decisionCmd.payload.decision.authorizedTarget, fromPin: { ...decisionCmd.payload.decision.authorizedTarget.fromPin, digest: "0".repeat(64) } } } } };
      const receipt = await harness.engine.recordArchitectureChangeDecision(tampered);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("target_mismatch");
      expect(harness.ledger.eventCount).toBe(before);
    });
  });

  describe("gate guards (zero write)", () => {
    it("workspace_revision_mismatch: gate binds a stale workspace revision", async () => {
      const { harness, materializeCmd, decisionCmd, gateCmd, workspaceRevision } = await runHappyPath();
      await recordChain(harness, materializeCmd, decisionCmd, gateCmd);
      const before = harness.ledger.eventCount;
      const tampered = { ...gateCmd, payload: { gate: { ...gateCmd.payload.gate, workspaceRevision: workspaceRevision + 1 } } };
      const receipt = await harness.engine.recordMigrationGate(tampered);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("workspace_revision_mismatch");
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("candidate_not_found: gate binds an unknown candidate", async () => {
      const { harness, gateCmd } = await runHappyPath();
      const before = harness.ledger.eventCount;
      const tampered = { ...gateCmd, payload: { gate: { ...gateCmd.payload.gate, candidateRef: { ...gateCmd.payload.gate.candidateRef, candidateId: "candidate-missing" } } } };
      const receipt = await harness.engine.recordMigrationGate(tampered);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("candidate_not_found");
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("invalid (workspace missing): gate binds a workspace that does not exist", async () => {
      const { harness, materializeCmd, decisionCmd, gateCmd } = await runHappyPath();
      await recordChain(harness, materializeCmd, decisionCmd, gateCmd);
      const before = harness.ledger.eventCount;
      const tampered = { ...gateCmd, payload: { gate: { ...gateCmd.payload.gate, workspaceId: "ws-missing" } } };
      const receipt = await harness.engine.recordMigrationGate(tampered);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
      expect(harness.ledger.eventCount).toBe(before);
    });
  });

  describe("activation guards (zero write)", () => {
    it("decision_not_found: activation binds an unknown decision", async () => {
      const { harness, activationCmd } = await runHappyPath();
      const before = harness.ledger.eventCount;
      const tampered = { ...activationCmd, payload: { activation: { ...activationCmd.payload.activation, decisionRef: { ...activationCmd.payload.activation.decisionRef, decisionId: "decision-missing" } } } };
      const receipt = await harness.engine.recordBaselineActivation(tampered);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("decision_not_found");
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("gate_not_found: activation binds an unknown gate", async () => {
      const { harness, materializeCmd, decisionCmd, gateCmd, activationCmd } = await runHappyPath();
      // decision must exist so the guard reaches the gate lookup.
      await recordChain(harness, materializeCmd, decisionCmd, gateCmd);
      const before = harness.ledger.eventCount;
      const tampered = { ...activationCmd, payload: { activation: { ...activationCmd.payload.activation, gateRef: { ...activationCmd.payload.activation.gateRef, gateId: "gate-missing" } } } };
      const receipt = await harness.engine.recordBaselineActivation(tampered);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("gate_not_found");
      expect(harness.ledger.eventCount).toBe(before);
    });

    it("decision_not_accepted: recorded decision outcome=reject", async () => {
      // Build a world where materialize + a REJECT decision (committed) exist.
      const { harness, proposal, currentActivePin, materializeCmd } = await runHappyPath();
      const { engine, ledger } = harness;
      const m = await engine.materializeCandidateBaseline(materializeCmd);
      expect(m.status).toBe("committed");
      const candidate = buildP114Candidate(proposal);
      const rejectDecision = buildP114Decision(candidate, { fromPin: currentActivePin, outcome: "reject" });
      const rejectCmd = buildP114DecisionCommand(rejectDecision, { commandId: "p114-cmd-reject-decision" });
      const rd = await engine.recordArchitectureChangeDecision(rejectCmd);
      expect(rd.status).toBe("committed");
      const gate = buildP114Gate(candidate, { workspaceRevision: 1 });
      const g = await engine.recordMigrationGate(buildP114GateCommand(gate, { commandId: "p114-cmd-gate" }));
      expect(g.status).toBe("committed");
      const before = ledger.eventCount;
      const toPin = { ref: { aggregateType: "ArchitectureBaselineRevision" as const, projectId: P114_PROJECT, baselineId: "architecture-baseline-1", revision: 2 }, digest: candidate.contentDigest };
      const activation = buildP114Activation(candidate, rejectDecision, gate, toPin);
      const receipt = await engine.recordBaselineActivation(buildP114ActivationCommand(activation, { commandId: "p114-cmd-activation" }));
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("decision_not_accepted");
      expect(ledger.eventCount).toBe(before);
    });

    it("gate_not_pass: recorded gate status=fail", async () => {
      const { harness, proposal, currentActivePin, materializeCmd } = await runHappyPath();
      const { engine, ledger } = harness;
      const m = await engine.materializeCandidateBaseline(materializeCmd);
      expect(m.status).toBe("committed");
      const candidate = buildP114Candidate(proposal);
      const decision = buildP114Decision(candidate, { fromPin: currentActivePin });
      const d = await engine.recordArchitectureChangeDecision(buildP114DecisionCommand(decision, { commandId: "p114-cmd-decision" }));
      expect(d.status).toBe("committed");
      const failGate = buildP114Gate(candidate, { workspaceRevision: 1, status: "fail" });
      const g = await engine.recordMigrationGate(buildP114GateCommand(failGate, { commandId: "p114-cmd-gate" }));
      expect(g.status).toBe("committed");
      const before = ledger.eventCount;
      const toPin = { ref: { aggregateType: "ArchitectureBaselineRevision" as const, projectId: P114_PROJECT, baselineId: "architecture-baseline-1", revision: 2 }, digest: candidate.contentDigest };
      const activation = buildP114Activation(candidate, decision, failGate, toPin);
      const receipt = await engine.recordBaselineActivation(buildP114ActivationCommand(activation, { commandId: "p114-cmd-activation" }));
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("gate_not_pass");
      expect(ledger.eventCount).toBe(before);
    });

    it("source_stale: active baseline moved before activation", async () => {
      const { harness, materializeCmd, decisionCmd, gateCmd, activationCmd } = await runHappyPath();
      const { engine, ledger } = harness;
      // Record the full chain first so the activation crosses all guards.
      expect((await engine.materializeCandidateBaseline(materializeCmd)).status).toBe("committed");
      expect((await engine.recordArchitectureChangeDecision(decisionCmd)).status).toBe("committed");
      expect((await engine.recordMigrationGate(gateCmd)).status).toBe("committed");
      // Move the active baseline AFTER the full chain is recorded.
      await activateNewBaseline(ledger, P114_PROJECT, 2);
      const before = ledger.eventCount;
      const receipt = await engine.recordBaselineActivation(activationCmd);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("source_stale");
      expect(ledger.eventCount).toBe(before);
    });

    it("target_mismatch: activation.toPin.digest tampered", async () => {
      const { harness, materializeCmd, decisionCmd, gateCmd, activationCmd } = await runHappyPath();
      // decision + gate must exist so the guard reaches the target matching.
      await recordChain(harness, materializeCmd, decisionCmd, gateCmd);
      const before = harness.ledger.eventCount;
      const tampered = { ...activationCmd, payload: { activation: { ...activationCmd.payload.activation, toPin: { ...activationCmd.payload.activation.toPin, digest: "0".repeat(64) } } } };
      const receipt = await harness.engine.recordBaselineActivation(tampered);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("target_mismatch");
      expect(harness.ledger.eventCount).toBe(before);
    });
  });

  describe("idempotent replay", () => {
    it("replaying each command returns committed/replayed with the SAME eventIds + cursor", async () => {
      const { harness, materializeCmd, decisionCmd, gateCmd, activationCmd } = await runHappyPath();
      const { engine, ledger } = harness;

      const firstMaterialize = await engine.materializeCandidateBaseline(materializeCmd);
      const firstDecision = await engine.recordArchitectureChangeDecision(decisionCmd);
      const firstGate = await engine.recordMigrationGate(gateCmd);
      const firstActivation = await engine.recordBaselineActivation(activationCmd);
      expect(firstMaterialize.status).toBe("committed");
      expect(firstDecision.status).toBe("committed");
      expect(firstGate.status).toBe("committed");
      expect(firstActivation.status).toBe("committed");

      // materialize replay
      const mReplay = await engine.materializeCandidateBaseline(materializeCmd);
      expect(mReplay.status).toBe("committed");
      if (mReplay.status === "committed" && firstMaterialize.status === "committed") {
        expect(mReplay.replayed).toBe(true);
        expect(mReplay.eventIds).toEqual(firstMaterialize.eventIds);
        expect(mReplay.commitCursor).toEqual(firstMaterialize.commitCursor);
      }
      // decision replay
      const dReplay = await engine.recordArchitectureChangeDecision(decisionCmd);
      expect(dReplay.status).toBe("committed");
      if (dReplay.status === "committed" && firstDecision.status === "committed") {
        expect(dReplay.replayed).toBe(true);
        expect(dReplay.eventIds).toEqual(firstDecision.eventIds);
        expect(dReplay.commitCursor).toEqual(firstDecision.commitCursor);
      }
      // gate replay
      const gReplay = await engine.recordMigrationGate(gateCmd);
      expect(gReplay.status).toBe("committed");
      if (gReplay.status === "committed" && firstGate.status === "committed") {
        expect(gReplay.replayed).toBe(true);
        expect(gReplay.eventIds).toEqual(firstGate.eventIds);
        expect(gReplay.commitCursor).toEqual(firstGate.commitCursor);
      }
      // activation replay
      const aReplay = await engine.recordBaselineActivation(activationCmd);
      expect(aReplay.status).toBe("committed");
      if (aReplay.status === "committed" && firstActivation.status === "committed") {
        expect(aReplay.replayed).toBe(true);
        expect(aReplay.eventIds).toEqual(firstActivation.eventIds);
        expect(aReplay.commitCursor).toEqual(firstActivation.commitCursor);
      }
    });
  });

  describe("cross-project isolation", () => {
    it("a project-B full chain never touches project-A aggregates", async () => {
      const harness = makeHarness();
      const { engine, ledger } = harness;
      const projectB = "proj-beta";

      // Project A world + full chain.
      await setupWorld(ledger, P114_PROJECT);
      const { proposal: proposalA, currentActivePin: pinA } = await recordProposal(engine, ledger, P114_PROJECT);
      const mA = await engine.materializeCandidateBaseline(buildP114MaterializeCommand(p114ProposalRef(P114_PROJECT), { commandId: "p114-cmd-materialize-a" }));
      expect(mA.status).toBe("committed");
      const candA = buildP114Candidate(proposalA);
      const dB = await engine.recordArchitectureChangeDecision(buildP114DecisionCommand(buildP114Decision(candA, { fromPin: pinA }), { commandId: "p114-cmd-decision-a" }));
      expect(dB.status).toBe("committed");
      const wsA = await ledger.load({ aggregateType: "Workspace", projectId: P114_PROJECT, workspaceId: P114_WORKSPACE });
      const wsARev = wsA.status === "found" ? wsA.snapshot.revision : 1;
      const gB = await engine.recordMigrationGate(buildP114GateCommand(buildP114Gate(candA, { workspaceRevision: wsARev }), { commandId: "p114-cmd-gate-a" }));
      expect(gB.status).toBe("committed");
      const toPinA = { ref: { aggregateType: "ArchitectureBaselineRevision" as const, projectId: P114_PROJECT, baselineId: "architecture-baseline-1", revision: 2 }, digest: candA.contentDigest };
      const actA = buildP114Activation(candA, buildP114Decision(candA, { fromPin: pinA }), buildP114Gate(candA, { workspaceRevision: wsARev }), toPinA);
      const aAct = await engine.recordBaselineActivation(buildP114ActivationCommand(actA, { commandId: "p114-cmd-activation-a" }));
      expect(aAct.status).toBe("committed");

      // Project A candidate ref is now found for the A world.
      const candARes = await ledger.load(p114CandidateRef(P114_PROJECT));
      expect(candARes.status).toBe("found");

      // Project B world + full chain with the SAME local ids.
      await setupWorld(ledger, projectB);
      const { proposal: proposalB, currentActivePin: pinB } = await recordProposal(engine, ledger, projectB);
      const mB = await engine.materializeCandidateBaseline(buildP114MaterializeCommand({ aggregateType: "ArchitectureCandidateProposal", projectId: projectB, workspaceId: P114_WORKSPACE, proposalId: P114_PROPOSAL }, { commandId: "p114-cmd-materialize-b" }));
      expect(mB.status).toBe("committed");
      const candB = buildP114Candidate(proposalB);
      const dRec = await engine.recordArchitectureChangeDecision(buildP114DecisionCommand(buildP114Decision(candB, { fromPin: pinB }), { commandId: "p114-cmd-decision-b" }));
      expect(dRec.status).toBe("committed");
      const wsB = await ledger.load({ aggregateType: "Workspace", projectId: projectB, workspaceId: P114_WORKSPACE });
      const wsBRev = wsB.status === "found" ? wsB.snapshot.revision : 1;
      const gRec = await engine.recordMigrationGate(buildP114GateCommand(buildP114Gate(candB, { workspaceRevision: wsBRev }), { commandId: "p114-cmd-gate-b" }));
      expect(gRec.status).toBe("committed");

      // Isolation: project A's candidate digest is UNCHANGED by project B's chain.
      const candAAfter = await ledger.load(p114CandidateRef(P114_PROJECT));
      expect(candAAfter.status).toBe("found");
      if (candAAfter.status === "found") {
        const aSnap = candAAfter.snapshot as { candidate: { contentDigest: string } };
        expect(aSnap.candidate.contentDigest).toBe(candidateContentDigest(proposalA.normalizedContent));
      }
      // project B candidate stored under its own (project-scoped) ref.
      const candBRes = await ledger.load(p114CandidateRef(projectB));
      expect(candBRes.status).toBe("found");
    });
  });
});
