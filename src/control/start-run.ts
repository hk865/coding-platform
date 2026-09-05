/**
 * P1-03 Control entry: run start (record envelope + mark outbox started).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN). Lane A fills the
 * implementation; frozen semantics:
 *   - verifies the envelope belongs to the run (runRef/attemptRef/planRef
 *     exact), binds the SAME roleBinding version as the intent (else
 *     stale_binding zero-write) and the same budget/workspace revision;
 *   - ONE atomic dispatch-start commit: RunStartedEvent + Run@2 (running,
 *     envelope recorded) + TaskAttempt@2 (started) + DispatchOutboxEntry@2
 *     (started), CAS [Run@1, TaskAttempt@1, DispatchOutboxEntry@1].
 */
import type {
  DispatchStartCommand,
  DispatchStartReceipt,
} from "../contracts/dispatch.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function startRun(
  deps: ControlEngineDeps,
  command: DispatchStartCommand,
): Promise<DispatchStartReceipt> {
  void deps;
  void command;
  return Promise.reject(new Error("P1-03: startRun not implemented yet"));
}
