/**
 * P1-03 Control entry: unique claim (dispatch intent + lease + attempt + run).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN). Lane A fills the
 * implementation; frozen semantics:
 *   - eligibility guard exactly as Acceptance 1 (zero-write rejection with
 *     issues);
 *   - the durable DispatchIntent (outboxIntents) + TaskLease@1 + TaskAttempt@1
 *     + Run@1 + DispatchOutboxEntry@1 are ONE atomic dispatch-claim commit
 *     (CAS [TaskLease@0, TaskAttempt@0, Run@0, DispatchOutboxEntry@0]);
 *   - competing claims: at most one wins; the loser gets revision_conflict,
 *     zero write;
 *   - idempotent replay = same identity+fingerprint -> committed(replayed).
 */
import type {
  DispatchClaimCommand,
  DispatchClaimReceipt,
} from "../contracts/dispatch.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function claimTask(
  deps: ControlEngineDeps,
  command: DispatchClaimCommand,
): Promise<DispatchClaimReceipt> {
  void deps;
  void command;
  return Promise.reject(new Error("P1-03: claimTask not implemented yet"));
}
