/**
 * P1-12 VerificationEngine.CodeGraphPort — deterministic registry-backed graph
 * capability seam.
 *
 * The engine answers graph availability for a workspace revision from the
 * registry it is given; unsupported/stale are explicit. The deterministic DIFF
 * itself is the pure computeArchitectureDelta function in the contracts —
 * always reproducible.
 *
 * A4/A-3 (2026-09-10 review): this seam has **no
 * production consumer**. The real graph path is
 * `context/source-graph-context.ts` (SourceGraphContextCompiler) fed by
 * `data/source-workspace-reader.ts`; `service.ts` injects that, not this port.
 * When no registry is configured this port returns `unsupported` — it must
 * never default to a fixture graph.
 *
 * Registry convention mirrors FakeWorkspaceReaderAdapter: revision 0 is the
 * PINNED BASELINE state; a revision not in the registry is stale, and a graph
 * without code-graph capability is unsupported. `{graphs, currentRevision}` is
 * injection for explicit tests and configured hosts only.
 */
import type { CodeGraphPort, CodeGraphQueryV1, CodeGraphResultV1 } from "../../contracts/architecture-reconciler.js";
import type { CodeGraphSnapshotV1 } from "../../contracts/architecture-inspection.js";

export type CodeGraphPortRegistry = {
  graphs: Map<number, CodeGraphSnapshotV1>;
  currentRevision: number;
};

export class CodeGraphPortImpl implements CodeGraphPort {
  private readonly graphs: Map<number, CodeGraphSnapshotV1>;
  private readonly currentRevision: number;

  constructor(registry?: CodeGraphPortRegistry) {
    this.graphs = registry?.graphs ?? new Map<number, CodeGraphSnapshotV1>();
    this.currentRevision = registry?.currentRevision ?? 0;
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
      capabilityNote: "configured-registry",
    };
  }
}
