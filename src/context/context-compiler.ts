/**
 * ContextCompiler — P1-03 TaskContextPort implementation (first consumer freeze).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN). Lane C fills the
 * implementation. Frozen semantics (Acceptance 4):
 *   - assemble verifies the request binding version consistency (stale_binding),
 *     tools/writeScope within declared permissions (forbidden), positive budget
 *     & un-passed deadline (budget_exhausted), workspace snapshot revision ==
 *     canonical (stale_workspace_snapshot) and then assembles a bounded
 *     TaskEnvelope (size cap TASK_ENVELOPE_MAX_SIZE_BYTES, sourceRefs only,
 *     NO transcript) while the bounded Bundle body goes FIRST into the vault;
 *   - ready only after the body is stored (bundleRef); needs_material for
 *     missing plan/workspace facts; NEVER starts an Agent itself.
 */
import type { ArtifactPort } from "../contracts/artifact.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { TaskContextPort, TaskContextRequestV1, TaskContextResultV1 } from "../contracts/task-envelope.js";

export type ContextCompilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  now: () => string;
};

export class ContextCompilerImpl implements TaskContextPort {
  constructor(private readonly deps: ContextCompilerDeps) {}

  assemble(request: TaskContextRequestV1): Promise<TaskContextResultV1> {
    void this.deps;
    void request;
    return Promise.reject(new Error("P1-03: ContextCompilerImpl.assemble not implemented yet"));
  }
}

export function createContextCompiler(deps: ContextCompilerDeps): ContextCompilerImpl {
  return new ContextCompilerImpl(deps);
}
