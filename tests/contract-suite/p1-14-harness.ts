/**
 * Shared P1-14 contract-suite harness: baseline-evolution scenario
 * (FROZEN surface; lanes fill the implementations behind the same scenario).
 */
import { expect } from "vitest";
import type { P1_13HarnessLike } from "./p1-13-harness.js";
import { p111BootstrapGoalGovernance } from "./p1-11-harness.js";
import type { CandidateArchitectureBaselineV1, ArchitectureChangeDecisionV1, MigrationGateTaskV1, BaselineActivationV1, CandidateArchitectureBaselineSnapshot } from "../../src/contracts/baseline-evolution.js";
import { candidateContentDigest, candidateIdFromDigest } from "../../src/contracts/baseline-evolution.js";
import type { ArchitectureCandidateProposalV1 } from "../../src/contracts/architecture-inspection.js";
import {
  buildP112Proposal, buildRecordCandidateBaselineProposalCommand,
} from "../../src/fixtures/architecture-fixtures.js";
import {
  P114_PROJECT, P114_WORKSPACE, P114_PROPOSAL, P114_CANDIDATE, P114_DECISION, P114_GATE, P114_ACTIVATION,
  buildP114Candidate, buildP114Decision, buildP114Gate, buildP114Activation,
  buildP114MaterializeCommand, buildP114DecisionCommand, buildP114GateCommand, buildP114ActivationCommand,
  p114CandidateRef, p114ProposalRef,
} from "../contract-support/fixtures/baseline-evolution-fixtures.js";

export type P114HarnessLike = P1_13HarnessLike & {
  recordCandidateBaselineProposal: (command: import("../../src/contracts/architecture-inspection.js").RecordCandidateBaselineProposalCommand) => Promise<import("../../src/contracts/architecture-inspection.js").RecordCandidateBaselineProposalReceipt>;
  materializeCandidateBaseline: (command: import("../../src/contracts/baseline-evolution.js").MaterializeCandidateBaselineCommand) => Promise<import("../../src/contracts/baseline-evolution.js").MaterializeCandidateBaselineReceipt>;
  recordArchitectureChangeDecision: (command: import("../../src/contracts/baseline-evolution.js").RecordArchitectureChangeDecisionCommand) => Promise<import("../../src/contracts/baseline-evolution.js").RecordArchitectureChangeDecisionReceipt>;
  recordMigrationGate: (command: import("../../src/contracts/baseline-evolution.js").RecordMigrationGateCommand) => Promise<import("../../src/contracts/baseline-evolution.js").RecordMigrationGateReceipt>;
  recordBaselineActivation: (command: import("../../src/contracts/baseline-evolution.js").RecordBaselineActivationCommand) => Promise<import("../../src/contracts/baseline-evolution.js").RecordBaselineActivationReceipt>;
};

export async function p114ActiveBaselinePin(h: { ledger: import("../../src/contracts/ledger.js").StateLedger }, projectId: string = P114_PROJECT): Promise<import("../../src/contracts/governance.js").ArchitectureBaselinePin> {
  const active = await h.ledger.load({ aggregateType: "ProjectArchitectureBaselineActive", projectId });
  expect(active.status).toBe("found");
  if (active.status !== "found") throw new Error("baseline active ref missing");
  const activeSnap = active.snapshot as { activeRevision: import("../../src/contracts/governance.js").ArchitectureBaselineRevisionRef };
  const rev = await h.ledger.load(activeSnap.activeRevision);
  expect(rev.status).toBe("found");
  if (rev.status !== "found") throw new Error("baseline revision missing");
  const revSnap = rev.snapshot as { contentDigest: string };
  return { ref: activeSnap.activeRevision, digest: revSnap.contentDigest };
}

export type P114ScenarioResult = {
  proposal: ArchitectureCandidateProposalV1;
  currentActivePin: import("../../src/contracts/governance.js").ArchitectureBaselinePin;
  candidate: CandidateArchitectureBaselineV1;
  candidateSnap: CandidateArchitectureBaselineSnapshot;
  decision: ArchitectureChangeDecisionV1;
  gate: MigrationGateTaskV1;
  activation: BaselineActivationV1;
};

export async function runP114Scenario(h: P114HarnessLike): Promise<P114ScenarioResult> {
  await p111BootstrapGoalGovernance(h.ledger, P114_PROJECT);
  const currentActivePin = await p114ActiveBaselinePin(h, P114_PROJECT);
  const rawProposal = buildP112Proposal();
  const proposal: ArchitectureCandidateProposalV1 = {
    ...rawProposal,
    projectId: P114_PROJECT,
    workspaceId: P114_WORKSPACE,
    sourceBaselinePin: { ...currentActivePin },
    expectedCandidateDigest: candidateContentDigest(rawProposal.normalizedContent),
  };
  const proposalReceipt = await h.recordCandidateBaselineProposal(buildRecordCandidateBaselineProposalCommand(proposal, { commandId: "p114-cmd-proposal" }));
  expect(proposalReceipt.status).toBe("committed");

  const materialize = await h.materializeCandidateBaseline(buildP114MaterializeCommand(p114ProposalRef(P114_PROJECT), { commandId: "p114-cmd-materialize" }));
  expect(materialize.status).toBe("committed");
  const candidate = buildP114Candidate(proposal, { candidateId: P114_CANDIDATE });
  const candidateLoad = await h.ledger.load({ aggregateType: "CandidateArchitectureBaseline" as const, projectId: P114_PROJECT, workspaceId: P114_WORKSPACE, candidateId: candidate.candidateId });
  expect(candidateLoad.status).toBe("found");
  if (candidateLoad.status !== "found") throw new Error("candidate not found");
  const candidateSnap = candidateLoad.snapshot as CandidateArchitectureBaselineSnapshot;

  const decision = buildP114Decision(candidate, { fromPin: currentActivePin });
  const decisionReceipt = await h.recordArchitectureChangeDecision(buildP114DecisionCommand(decision, { commandId: "p114-cmd-decision" }));
  expect(decisionReceipt.status).toBe("committed");

  const gate = buildP114Gate(candidate);
  const gateReceipt = await h.recordMigrationGate(buildP114GateCommand(gate, { commandId: "p114-cmd-gate" }));
  expect(gateReceipt.status).toBe("committed");

  const toPin = { ref: { aggregateType: "ArchitectureBaselineRevision" as const, projectId: P114_PROJECT, baselineId: "architecture-baseline-1", revision: 2 }, digest: candidate.contentDigest };
  const activation = buildP114Activation(candidate, decision, gate, toPin);
  const activationReceipt = await h.recordBaselineActivation(buildP114ActivationCommand(activation, { commandId: "p114-cmd-activation" }));
  expect(activationReceipt.status).toBe("committed");

  return { proposal, currentActivePin, candidate, candidateSnap, decision, gate, activation };
}

export function p114ViewQuery() {
  return { projectId: P114_PROJECT, workspaceId: P114_WORKSPACE };
}
export { P114_PROJECT, P114_WORKSPACE, P114_PROPOSAL, P114_CANDIDATE, P114_DECISION, P114_GATE, P114_ACTIVATION };
