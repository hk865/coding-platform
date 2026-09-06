/** P1-15 Control entry: initial-design + coordination-policy handlers. */
import type { InstallCoordinationPolicyCommand, InstallCoordinationPolicyReceipt, ActivateCoordinationPolicyCommand, ActivateCoordinationPolicyReceipt, RecordInitialDesignProposalCommand, RecordInitialDesignProposalReceipt, RecordInitialDesignDecisionCommand, RecordInitialDesignDecisionReceipt } from "../contracts/human-role-collaboration.js";
import type { ControlEngineDeps } from "./control-engine.js";

/** LANE-A stub — real implementation lands in the P1-15 lane commit. */
export class HumanRoleCollaborationEngineImpl {
  constructor(private readonly deps: ControlEngineDeps) {}
  recordProposal(command: RecordInitialDesignProposalCommand): Promise<RecordInitialDesignProposalReceipt> { void command; throw new Error("P1-15 lane: HumanRoleCollaborationEngineImpl not implemented yet"); }
  recordDecision(command: RecordInitialDesignDecisionCommand): Promise<RecordInitialDesignDecisionReceipt> { void command; throw new Error("P1-15 lane: HumanRoleCollaborationEngineImpl not implemented yet"); }
  installPolicy(command: InstallCoordinationPolicyCommand): Promise<InstallCoordinationPolicyReceipt> { void command; throw new Error("P1-15 lane: HumanRoleCollaborationEngineImpl not implemented yet"); }
  activatePolicy(command: ActivateCoordinationPolicyCommand): Promise<ActivateCoordinationPolicyReceipt> { void command; throw new Error("P1-15 lane: HumanRoleCollaborationEngineImpl not implemented yet"); }
}
