/**
 * P1-06 Control entry: register a bounded HandoffPacket (body-first).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN; lane A fills the
 * implementation). Frozen semantics (IMPLEMENTATION-HANDOFF "P1-06 契约与存储
 * 语义" items 1/5/6/7):
 *   1. schema validation (validateRecordHandoffCommand) -> invalid;
 *   2. source Run + Workspace + Plan resolution: not_found / plan missing ->
 *      not_found; run NOT ended -> run_not_ended; packet workspace revision !=
 *      canonical -> stale_source; packet taskRevision != plan.planRevision ->
 *      stale_source. ALL zero-write.
 *   3. one atomic handoff-record commit (HandoffRecordedEvent +
 *      HandoffPacketSnapshot@1, CAS@0) with FULL ledger idempotency;
 *   4. the packet body was ALREADY body-first'd into the ArtifactVault by the
 *      generator; Control only registers the reference (failed commit leaves
 *      only an un-adopted Artifact).
 */
import type { RecordHandoffCommand, RecordHandoffReceipt } from "../contracts/handoff.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function recordHandoff(
  deps: ControlEngineDeps,
  command: RecordHandoffCommand,
): Promise<RecordHandoffReceipt> {
  void deps;
  void command;
  throw new Error("P1-06: recordHandoff not implemented yet");
}
