/**
 * P1-03 Control entry: runtime fact ingestion (run-fact).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN). Lane B fills the
 * implementation; frozen semantics (Acceptance 5/6/8):
 *   - per-run monotonic sequence: a fact with sequence < run.lastEventSeq ->
 *     stale_event; sequence == lastEventSeq and a different runtime event id
 *     -> conflict_event; same sequence+id -> a rejected duplicate (committed
 *     facts never regress); ANY fact after the Run ended -> after_terminal;
 *   - terminal runtime events fold Run status=ended + the corresponding
 *     outcome (completed/cancelled/budget_exhausted/crashed); outcome_unknown
 *     is an EXPLICIT fact (RunOutcomeUnknown), NEVER inferred from a crash or
 *     an exit code;
 *   - exit=0 on run_completed NEVER writes Task.phase (P1-03 has no Task
 *     aggregate writes at all);
 *   - one atomic run-fact commit: RunEventRecorded/RunOutcomeUnknown + Run
 *     snapshot (+ TaskAttempt ended / outbox done on terminal facts), CAS on
 *     the loaded revisions; no idempotency record (see ledger semantics).
 */
import type {
  RunFactCommand,
  RunFactReceipt,
} from "../contracts/dispatch.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function runFact(
  deps: ControlEngineDeps,
  command: RunFactCommand,
): Promise<RunFactReceipt> {
  void deps;
  void command;
  return Promise.reject(new Error("P1-03: runFact not implemented yet"));
}
