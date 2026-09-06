/**
 * P1-12 VerificationEngine.CodeGraphPort — deterministic registry-backed graph
 * capability seam.
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane A fills the
 * implementation). The engine answers graph availability for a workspace
 * revision (fixture registry / configured graph sources); unsupported/stale
 * are explicit. The deterministic DIFF itself is the pure
 * computeArchitectureDelta function in the contracts — always reproducible.
 *
 * Registry convention mirrors FakeWorkspaceReaderAdapter: revision 0 is the
 * PINNED BASELINE state, revision 2 is the current workspace state
 * (currentRevision = 2). A revision not in the registry is stale; a graph
 * without code-graph capability is unsupported. Injection ({graphs,
 * currentRevision}) lets the seam tests exercise supported/stale/unsupported.
 */
import type { CodeGraphPort, CodeGraphQueryV1, CodeGraphResultV1 } from "../contracts/architecture-reconciler.js";
import type { CodeGraphSnapshotV1 } from "../contracts/architecture-inspection.js";
import { buildP112BaselineGraph, buildP112CurrentGraph } from "../contracts/fixtures/architecture-fixtures.js";

export type CodeGraphPortRegistry = {
  graphs: Map<number, CodeGraphSnapshotV1>;
  currentRevision: number;
};

export class CodeGraphPortImpl implements CodeGraphPort {
  private readonly graphs: Map<number, CodeGraphSnapshotV1>;
  private readonly currentRevision: number;

  constructor(registry?: CodeGraphPortRegistry) {
    if (registry) {
      this.graphs = registry.graphs;
      this.currentRevision = registry.currentRevision;
    } else {
      this.graphs = new Map<number, CodeGraphSnapshotV1>([
        [0, buildP112BaselineGraph()],
        [2, buildP112CurrentGraph()],
      ]);
      this.currentRevision = 2;
    }
  }

  async codeGraph(query: CodeGraphQueryV1): Promise<CodeGraphResultV1> {
    if (query.schemaVersion !== 1) {
      return { status: "rejected", code: "invalid_request", issues: ["schemaVersion must be 1"] };
    }
    if (typeof query.projectId !== "string" || query.projectId.length === 0) {
      return { status: "rejected", code: "invalid_request", issues: ["projectId is required"] };
    }
    if (typeof query.workspaceId !== "string" || query.workspaceId.length === 0) {
      return { status: "rejected", code: "invalid_request", issues: ["workspaceId is required"] };
    }

    const first = this.graphs.values().next().value as CodeGraphSnapshotV1 | undefined;
    if (first === undefined) {
      return { status: "unsupported", message: "no graph registry configured for this workspace" };
    }
    if (query.projectId !== first.projectId || query.workspaceId !== first.workspaceId) {
      return { status: "rejected", code: "scope_forbidden", issues: ["workspace out of scope: " + query.projectId + "/" + query.workspaceId] };
    }

    const graph = this.graphs.get(query.workspaceRevision);
    if (graph === undefined) {
      return {
        status: "stale",
        expectedRevision: this.currentRevision,
        observedRevision: query.workspaceRevision,
        message: "no code graph for workspace revision " + query.workspaceRevision + "; current revision is " + this.currentRevision,
      };
    }

    if (graph.indexCapabilities.hasCodeGraph === false) {
      return { status: "unsupported", message: "workspace revision " + query.workspaceRevision + " has no code graph capability" };
    }

    return {
      status: "supported",
      snapshotRef: graph.bodyRef,
      capabilityNote: "fixture-registry",
    };
  }
}
