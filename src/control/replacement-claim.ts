/**
 * P1-06 Control entry: replacement claim — B's NEW Attempt/lifecycle for the
 * SAME Task after A ended (or A's lease expired).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN; lane A fills the
 * implementation). Frozen semantics (IMPLEMENTATION-HANDOFF "P1-06 契约与存储
 * 语义" items 2/5/6/7):
 *   1. schema validation (validateClaimReplacementCommand) -> invalid;
 *   2. Goal/Workspace/Plan resolution -> not_found;
 *   3. evaluateReplacementEligibility (pure): no_prior_attempt / lease_active /
 *      packet_not_found / packet_mismatch / stale_packet / structural reasons
 *      -> ineligible (zero write), never silently reusing a stale packet;
 *   4. one atomic replacement-claim commit (ReplacementClaimedEvent + lease CAS
 *      @N + TaskAttempt/Run/DispatchOutboxEntry/ReplacementAttempt@0) with FULL
 *      ledger idempotency; A's late facts still target A's own ended Run and are
 *      rejected by the P1-03 per-run sequence semantics (never roll back B).
 */
import type { ClaimReplacementCommand, ClaimReplacementReceipt } from "../contracts/handoff.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function claimReplacement(
  deps: ControlEngineDeps,
  command: ClaimReplacementCommand,
): Promise<ClaimReplacementReceipt> {
  void deps;
  void command;
  throw new Error("P1-06: claimReplacement not implemented yet");
}
