/** P1-11 PlanCompiler entry: bounded proposal + impact analysis (never mutates). */
import type { AmendGoalRequestV1, PlanProposalV1, PlanProposalPort } from "../contracts/goal-change.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ReadModelIndex } from "../contracts/goal-view.js";

export type PlanCompilerDeps = {
  ledger: StateLedger;
  readModel: ReadModelIndex;
  now: () => string;
};

/** LANE-B stub — real implementation lands in the P1-11 lane commit (ctor deps frozen). */
export class PlanCompilerImpl implements PlanProposalPort {
  constructor(_deps: PlanCompilerDeps) {}
  async request(intent: AmendGoalRequestV1): Promise<{ status: "proposal"; proposal: PlanProposalV1 } | { status: "needs_material"; gaps: string[] } | { status: "rejected"; code: string; message: string }> {
    void intent;
    throw new Error("P1-11 lane: PlanCompilerImpl not implemented yet");
  }
}
