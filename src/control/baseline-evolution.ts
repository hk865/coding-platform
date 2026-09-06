/** P1-14 Control entry: baseline-evolution orchestration (candidate materialize / decision / gate / activation record). */
import type { MaterializeCandidateBaselineCommand, MaterializeCandidateBaselineReceipt, RecordArchitectureChangeDecisionCommand, RecordArchitectureChangeDecisionReceipt, RecordMigrationGateCommand, RecordMigrationGateReceipt, RecordBaselineActivationCommand, RecordBaselineActivationReceipt } from "../contracts/baseline-evolution.js";
import type { ControlEngineDeps } from "./control-engine.js";

/** LANE-A stub — real implementation lands in the P1-14 lane commit. */
export class BaselineEvolutionEngineImpl {
  constructor(private readonly deps: ControlEngineDeps) {}
  materializeCandidate(command: MaterializeCandidateBaselineCommand): Promise<MaterializeCandidateBaselineReceipt> { void command; throw new Error("P1-14 lane: BaselineEvolutionEngineImpl not implemented yet"); }
  recordDecision(command: RecordArchitectureChangeDecisionCommand): Promise<RecordArchitectureChangeDecisionReceipt> { void command; throw new Error("P1-14 lane: BaselineEvolutionEngineImpl not implemented yet"); }
  recordGate(command: RecordMigrationGateCommand): Promise<RecordMigrationGateReceipt> { void command; throw new Error("P1-14 lane: BaselineEvolutionEngineImpl not implemented yet"); }
  recordActivation(command: RecordBaselineActivationCommand): Promise<RecordBaselineActivationReceipt> { void command; throw new Error("P1-14 lane: BaselineEvolutionEngineImpl not implemented yet"); }
}
