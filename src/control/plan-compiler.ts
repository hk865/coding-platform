/** P1-11 PlanCompiler entry: bounded proposal + impact analysis (never mutates). */
import type { AmendGoalRequestV1, PlanProposalV1, PlanProposalPort } from "../contracts/goal-change.js";

/** LANE-B stub — real implementation lands in the P1-11 lane commit. */
export class PlanCompilerImpl implements PlanProposalPort {
  async request(intent: AmendGoalRequestV1): Promise<{ status: "proposal"; proposal: PlanProposalV1 } | { status: "needs_material"; gaps: string[] } | { status: "rejected"; code: string; message: string }> {
    void intent;
    throw new Error("P1-11 lane: PlanCompilerImpl not implemented yet");
  }
}
