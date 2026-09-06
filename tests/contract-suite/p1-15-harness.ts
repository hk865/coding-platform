/** P1-15 shared scenario + suite (compact). */
import { expect } from "vitest";
import { p111BootstrapGoalGovernance } from "./p1-11-harness.js";
import type { P114HarnessLike } from "./p1-14-harness.js";
import type { InitialDesignProposalV1, InitialDesignDecisionV1, UnifiedStatusViewResult } from "../../src/contracts/human-role-collaboration.js";
import { buildP115Proposal, buildP115Decision, buildP115ProposalCommand, buildP115DecisionCommand, buildP115InstallCommand, buildP115ActivateCommand, P115_PROJECT, P115_WORKSPACE, P115_DESIGN, P115_DECISION, p115DesignRef, P115_COORDINATION_POLICY_CONTENT } from "../../src/contracts/fixtures/human-role-collaboration-fixtures.js";
import { coordinationPolicyContentDigest } from "../../src/contracts/human-role-collaboration.js";

export type P115HarnessLike = P114HarnessLike & {
  recordInitialDesignProposal(command: import("../../src/contracts/human-role-collaboration.js").RecordInitialDesignProposalCommand): Promise<import("../../src/contracts/human-role-collaboration.js").RecordInitialDesignProposalReceipt>;
  recordInitialDesignDecision(command: import("../../src/contracts/human-role-collaboration.js").RecordInitialDesignDecisionCommand): Promise<import("../../src/contracts/human-role-collaboration.js").RecordInitialDesignDecisionReceipt>;
  installCoordinationPolicy(command: import("../../src/contracts/human-role-collaboration.js").InstallCoordinationPolicyCommand): Promise<import("../../src/contracts/human-role-collaboration.js").InstallCoordinationPolicyReceipt>;
  activateCoordinationPolicy(command: import("../../src/contracts/human-role-collaboration.js").ActivateCoordinationPolicyCommand): Promise<import("../../src/contracts/human-role-collaboration.js").ActivateCoordinationPolicyReceipt>;
  unifiedStatusView(query: import("../../src/contracts/human-role-collaboration.js").UnifiedStatusViewQuery): Promise<UnifiedStatusViewResult>;
};

export type P115ScenarioResult = {
  proposal: InitialDesignProposalV1;
  decision: InitialDesignDecisionV1;
  policyDigest: string;
  view: UnifiedStatusViewResult;
};

export async function runP115Scenario(h: P115HarnessLike): Promise<P115ScenarioResult> {
  await p111BootstrapGoalGovernance(h.ledger, P115_PROJECT);
  const proposal = buildP115Proposal({ projectId: P115_PROJECT, workspaceId: P115_WORKSPACE });
  const propReceipt = await h.recordInitialDesignProposal(buildP115ProposalCommand(proposal, { commandId: "p115-cmd-proposal" }));
  expect(propReceipt.status).toBe("committed");
  const decision = buildP115Decision(proposal);
  const decReceipt = await h.recordInitialDesignDecision(buildP115DecisionCommand(decision, { commandId: "p115-cmd-decision" }));
  expect(decReceipt.status).toBe("committed");
  const install = await h.installCoordinationPolicy(buildP115InstallCommand(P115_PROJECT, { commandId: "p115-cmd-install" }));
  expect(install.status).toBe("committed");
  const activate = await h.activateCoordinationPolicy(buildP115ActivateCommand(P115_PROJECT, { commandId: "p115-cmd-activate", expectedRevision: 1 }));
  expect(activate.status).toBe("committed");
  await h.advanceProjection();
  const view = await h.unifiedStatusView({ projectId: P115_PROJECT, workspaceId: P115_WORKSPACE });
  return { proposal, decision, policyDigest: coordinationPolicyContentDigest(P115_COORDINATION_POLICY_CONTENT, "coordination-policy-1", 1), view };
}

export { P115_PROJECT, P115_WORKSPACE, P115_DESIGN, P115_DECISION, p115DesignRef };
