/**
 * P1-12 WorkspaceReader adapter — deterministic fixture-backed read port.
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane A fills the
 * implementation). The adapter answers CodeGraphReadQueryV1 with the graph of
 * ONE workspace revision from its registry (fixtures in the contract suite /
 * a deterministic in-memory registry); unsupported (no graph capability) and
 * stale (workspace revision moved since the produced snapshot) are explicit —
 * never a fabricated graph. READ ONLY.
 */
import type { CodeGraphReadQueryV1, CodeGraphReadResultV1, WorkspaceReadPort } from "../contracts/workspace-read.js";

export type WorkspaceReaderDeps = {
  now: () => string;
};

export class FakeWorkspaceReaderAdapter implements WorkspaceReadPort {
  private readonly deps: WorkspaceReaderDeps;

  constructor(deps: WorkspaceReaderDeps) {
    this.deps = deps;
  }

  read(query: CodeGraphReadQueryV1): Promise<CodeGraphReadResultV1> {
    void query;
    throw new Error("P1-12 lane A: workspace reader not implemented yet");
  }
}
