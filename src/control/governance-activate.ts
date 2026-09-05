/**
 * P1-02 Control entry: governance activation (typed Project active refs).
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN). Lane A fills the
 * implementation; semantics recorded in IMPLEMENTATION-HANDOFF.md
 * "P1-02 契约与存储语义" and the ticket Acceptance:
 *   schema -> resolve installed target (identity/revision/digest triple) ->
 *   "not_found"/"digest_mismatch" zero-write -> load per-kind active aggregate
 *   -> fold activation commit with CAS: Project@expected (command
 *   expectedRevision) + active aggregate @(current or 0) -> map receipt.
 *   - activation only accepts an INSTALLED exact target ref; dangling /
 *     digest mismatch / concurrent movement (revision_conflict) never moves
 *     the active ref;
 *   - CompletionPolicy and ArchitectureBaseline actives are independent.
 */
import type { GovernanceActivateCommand, GovernanceActivateReceipt } from "../contracts/governance.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function activateGovernance(
  deps: ControlEngineDeps,
  command: GovernanceActivateCommand,
): Promise<GovernanceActivateReceipt> {
  void deps;
  void command;
  return Promise.reject(new Error("P1-02: activateGovernance not implemented yet"));
}
