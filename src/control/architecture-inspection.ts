/**
 * P1-12 Control entry: ArchitectureInspectionEngineImpl — durable recording
 * of inspections / findings / decision briefs / candidate proposals
 * (ControlEngine versioned additions, immutability CAS@0 each).
 *
 * ENTRY FILE (shared baseline — exported signatures FROZEN; lane B fills the
 * implementations). Frozen semantics (IMPLEMENTATION-HANDOFF "P1-12 契约与
 * 存储语义" items 1-7): shape validation -> invalid; pinned baseline resolved
 * from the intent/plan (ledger.load) -> not_found; pin digest mismatch ->
 * baseline_mismatch (zero write); PROPOSAL digest recompute mismatch ->
 * digest_mismatch (zero write); ONE atomic commit per command with FULL
 * ledger idempotency. NO remediation/gate/activation side effects.
 */
import type {
  RecordArchitectureDecisionBriefCommand,
  RecordArchitectureDecisionBriefReceipt,
  RecordArchitectureFindingCommand,
  RecordArchitectureFindingReceipt,
  RecordArchitectureInspectionCommand,
  RecordArchitectureInspectionReceipt,
  RecordCandidateBaselineProposalCommand,
  RecordCandidateBaselineProposalReceipt,
} from "../contracts/architecture-inspection.js";
import type { ControlEngineDeps } from "./control-engine.js";

export class ArchitectureInspectionEngineImpl {
  private readonly deps: ControlEngineDeps;

  constructor(deps: ControlEngineDeps) {
    this.deps = deps;
  }

  recordArchitectureInspection(command: RecordArchitectureInspectionCommand): Promise<RecordArchitectureInspectionReceipt> {
    throw new Error("P1-12 lane B: recordArchitectureInspection not implemented yet");
  }

  recordArchitectureFinding(command: RecordArchitectureFindingCommand): Promise<RecordArchitectureFindingReceipt> {
    throw new Error("P1-12 lane B: recordArchitectureFinding not implemented yet");
  }

  recordArchitectureDecisionBrief(command: RecordArchitectureDecisionBriefCommand): Promise<RecordArchitectureDecisionBriefReceipt> {
    throw new Error("P1-12 lane B: recordArchitectureDecisionBrief not implemented yet");
  }

  recordCandidateBaselineProposal(command: RecordCandidateBaselineProposalCommand): Promise<RecordCandidateBaselineProposalReceipt> {
    throw new Error("P1-12 lane B: recordCandidateBaselineProposal not implemented yet");
  }
}
