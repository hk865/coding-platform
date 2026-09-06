/**
 * P1-16 ContextCompiler.WorkContextPort — bounded work-context assembly.
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane B fills the
 * implementation). Frozen semantics (IMPLEMENTATION-HANDOFF "P1-16 契约与
 * 存储语义" items 6-8):
 *   1. request validation (validateWorkContextRequest) -> rejected(invalid);
 *   2. binding exists + work/scope match -> rejected(work_not_found);
 *   3. requested run linked to the binding + scope ⊆ declared permissions ->
 *      rejected(forbidden_tool_or_scope) — zero write;
 *   4. fresh workspace/plan material + budget -> needs_material(gaps) — the
 *      call NEVER starts a model, NEVER allocates work;
 *   5. assemble the bounded bundle (binding facts + notes ≤ maxNotes + latest
 *      continuation + frontier), save body-first into the ArtifactVault
 *      (owner = requestedByRunRef), return ready(bundleRef, manifest) whose
 *      manifest reports selection, truncation, gaps and freshness.
 */
import type {
  WorkContextAssemblyResultV1,
  WorkContextPort,
  WorkContextRequestV1,
} from "../contracts/work-context-port.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ArtifactPort } from "../contracts/artifact.js";

export type WorkContextCompilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  now: () => string;
};

export class WorkContextCompilerImpl implements WorkContextPort {
  private readonly deps: WorkContextCompilerDeps;

  constructor(deps: WorkContextCompilerDeps) {
    this.deps = deps;
  }

  assembleWorkContext(request: WorkContextRequestV1): Promise<WorkContextAssemblyResultV1> {
    throw new Error("P1-16 lane B: work-context assembly not implemented yet");
  }
}
