/** P1-13 Control entry: remediation patch/task (allowlist verdict + dedup + advance). */
import type { SubmitRemediationPlanPatchCommand, SubmitRemediationPlanPatchReceipt, CreateRemediationTaskCommand, CreateRemediationTaskReceipt, AdvanceRemediationTaskCommand, AdvanceRemediationTaskReceipt } from "../contracts/remediation.js";
import type { ControlEngineDeps } from "./control-engine.js";

/** LANE-B stub — real implementation lands in the P1-13 lane commit. */
export class RemediationEngineImpl {
  constructor(private readonly deps: ControlEngineDeps) {}
  submitPlanPatch(command: SubmitRemediationPlanPatchCommand): Promise<SubmitRemediationPlanPatchReceipt> {
    void command;
    throw new Error("P1-13 lane: RemediationEngineImpl not implemented yet");
  }
  createTask(command: CreateRemediationTaskCommand): Promise<CreateRemediationTaskReceipt> {
    void command;
    throw new Error("P1-13 lane: RemediationEngineImpl not implemented yet");
  }
  advanceTask(command: AdvanceRemediationTaskCommand): Promise<AdvanceRemediationTaskReceipt> {
    void command;
    throw new Error("P1-13 lane: RemediationEngineImpl not implemented yet");
  }
}
