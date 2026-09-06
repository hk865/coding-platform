/**
 * P1-07 Control entry: recordPatch — single-writer patch artifact registration.
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane C fills the
 * implementation). Frozen semantics: IMPLEMENTATION-HANDOFF.md "P1-07 契约与
 * 存储语义" item 5: body-first (vault put by the writer), guard sequence, ONE
 * atomic commit carrying PatchRecorded + Workspace revision CAS advance (N ->
 * N+1) + WorkspaceWriteLeaseReleased (releasedVia patch-record) + index clear.
 */
import type { RecordPatchCommand, RecordPatchReceipt } from "../contracts/patch.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function recordPatch(deps: ControlEngineDeps, command: RecordPatchCommand): Promise<RecordPatchReceipt> {
  throw new Error("P1-07 lane C: recordPatch not implemented yet");
}
