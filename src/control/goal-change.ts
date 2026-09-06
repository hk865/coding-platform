/** P1-11 Control entry: goal-change engine (records + CAS apply). */
import type { ApplyPlanChangeCommand, ApplyPlanChangeReceipt, RecordPlanChangeProposalCommand, RecordPlanChangeProposalReceipt, RecordUserDecisionCommand, RecordUserDecisionReceipt } from "../contracts/goal-change.js";
import type { ControlEngineDeps } from "./control-engine.js";

export class GoalChangeEngineImpl {
  private readonly deps: ControlEngineDeps;
  constructor(deps: ControlEngineDeps) { this.deps = deps; }
  recordPlanChangeProposal(command: RecordPlanChangeProposalCommand): Promise<RecordPlanChangeProposalReceipt> { void command; throw new Error("P1-11 lane: recordPlanChangeProposal not implemented yet"); }
  recordUserDecision(command: RecordUserDecisionCommand): Promise<RecordUserDecisionReceipt> { void command; throw new Error("P1-11 lane: recordUserDecision not implemented yet"); }
  applyPlanChange(command: ApplyPlanChangeCommand): Promise<ApplyPlanChangeReceipt> { void command; throw new Error("P1-11 lane: applyPlanChange not implemented yet"); }
}
