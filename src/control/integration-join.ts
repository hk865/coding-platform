/**
 * P1-07 Control entry: recordIntegrationResult (evidence join).
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane B fills the
 * implementation). Frozen semantics: IMPLEMENTATION-HANDOFF.md "P1-07 契约与
 * 存储语义" item 6: guard sequence (shape -> run ended -> canonical workspace/
 * plan -> input presence/run-match -> detectEvidenceConflicts -> unresolved ->
 * duplicate -> accumulator CAS), conflicts NEVER overwritten, integrate facts
 * only (P1-04/05 formulas untouched).
 */
import type {
  RecordIntegrationResultCommand,
  RecordIntegrationResultReceipt,
} from "../contracts/integration.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function recordIntegrationResult(
  deps: ControlEngineDeps,
  command: RecordIntegrationResultCommand,
): Promise<RecordIntegrationResultReceipt> {
  throw new Error("P1-07 lane B: recordIntegrationResult not implemented yet");
}
