/**
 * P1-02 Control entry: governance install (CompletionPolicy /
 * ArchitectureBaseline immutable revisions).
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN). Lane A fills the
 * implementation; the semantics it must implement are recorded in
 * IMPLEMENTATION-HANDOFF.md "P1-02 契约与存储语义" and the ticket Acceptance:
 *   schema -> digest (JCS+SHA-256 over the whole fixture) -> fold the exact
 *   install commit (one event + one immutable revision snapshot, CAS at
 *   revision 0) -> map the ledger receipt (replay replayed=true, conflict ->
 *   revision_conflict, zero-write on every rejection).
 *   - missing/invalid fixture -> "invalid" (ZERO write); digest mismatch ->
 *     "digest_mismatch";
 *   - install NEVER auto-activates; NEVER creates an ArchitectureEvolutionPolicy.
 *
 * Dependencies: only the frozen contracts (governance.js, ledger.js),
 * StateLedger.load/commit via ControlEngineDeps, the shared validation
 * (validation.js) and fixture builders (fixtures/governance-fixtures.js).
 */
import type { GovernanceInstallCommand, GovernanceInstallReceipt } from "../contracts/governance.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function installGovernanceRevision(
  deps: ControlEngineDeps,
  command: GovernanceInstallCommand,
): Promise<GovernanceInstallReceipt> {
  void deps;
  void command;
  return Promise.reject(new Error("P1-02: installGovernanceRevision not implemented yet"));
}
