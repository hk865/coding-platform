/**
 * P1-12 WorkspaceReader adapter — deterministic fixture-backed read port.
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane A fills the
 * implementation). The adapter answers CodeGraphReadQueryV1 with the graph of
 * ONE workspace revision from its registry (fixtures in the contract suite /
 * a deterministic in-memory registry); unsupported (no graph capability) and
 * stale (workspace revision moved since the produced snapshot) are explicit —
 * never a fabricated graph. READ ONLY.
 *
 * Registry convention (frozen, mirror of the fixtures): sourceRevision 0 is
 * the PINNED BASELINE state; sourceRevision 2 is the current workspace state
 * (currentRevision = 2). Asking for any revision NOT in the registry is
 * stale (expectedRevision = currentRevision); asking for a revision whose
 * graph has no code-graph capability (hasCodeGraph=false + no text fallback)
 * is unsupported; out-of-scope project/workspace or unknown graph kinds are
 * rejected. Injection ({graphs, currentRevision}) lets adapter tests exercise
 * the stale/unsupported/rejected branches.
 */
import type { CodeGraphReadQueryV1, CodeGraphReadResultV1, WorkspaceReadPort } from "../../contracts/workspace-read.js";
import type { CodeGraphSnapshotV1 } from "../../contracts/architecture-inspection.js";
import { buildP112BaselineGraph, buildP112CurrentGraph } from "../../fixtures/architecture-fixtures.js";

const KNOWN_GRAPH_KINDS = new Set(["module", "interface", "type", "function", "file"]);

export type WorkspaceReaderDeps = {
  now: () => string;
  /** Inject a registry to exercise the stale/unsupported/rejected branches. */
  graphs?: Map<number, CodeGraphSnapshotV1>;
  /** The canonical "current" workspace revision (default: 2). */
  currentRevision?: number;
};

export class FakeWorkspaceReaderAdapter implements WorkspaceReadPort {
  private readonly now: () => string;
  private readonly graphs: Map<number, CodeGraphSnapshotV1>;
  private readonly currentRevision: number;

  constructor(deps: WorkspaceReaderDeps) {
    this.now = deps.now;
    this.graphs = deps.graphs ?? new Map<number, CodeGraphSnapshotV1>([
      [0, buildP112BaselineGraph()],
      [2, buildP112CurrentGraph()],
    ]);
    this.currentRevision = deps.currentRevision ?? 2;
  }

  async read(query: CodeGraphReadQueryV1): Promise<CodeGraphReadResultV1> {
    const invalid = this.validateQuery(query);
    if (invalid.length > 0) {
      return { status: "rejected", code: "invalid_request", issues: invalid };
    }

    const first = this.graphs.values().next().value as CodeGraphSnapshotV1 | undefined;
    if (first === undefined) {
      return { status: "unsupported", message: "no graph registry configured for this workspace" };
    }
    if (query.projectId !== first.projectId || query.workspaceId !== first.workspaceId) {
      return { status: "rejected", code: "scope_forbidden", issues: ["workspace out of scope: " + query.projectId + "/" + query.workspaceId] };
    }

    const kindIssue = this.validateKinds(query.requestedKinds);
    if (kindIssue !== null) {
      return { status: "rejected", code: "path_forbidden", issues: [kindIssue] };
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

    // A missing graph capability is EXPLICIT: hasCodeGraph=false (+ text
    // fallback flag) — never a fabricated graph. With no fallback at all the
    // adapter cannot serve the request -> unsupported.
    if (graph.indexCapabilities.hasCodeGraph === false) {
      if (graph.indexCapabilities.degradesToText === false) {
        return { status: "unsupported", message: "workspace revision " + query.workspaceRevision + " has no code graph capability" };
      }
      return this.sourced(graph);
    }

    return this.sourced(graph);
  }

  private sourced(graph: CodeGraphSnapshotV1): CodeGraphReadResultV1 {
    return {
      status: "sourced",
      snapshot: graph,
      provenance: {
        readAt: this.now(),
        source: "fixture",
        revision: graph.workspaceRevision,
        coverage: {
          hasCodeGraph: graph.indexCapabilities.hasCodeGraph,
          degradesToText: graph.indexCapabilities.degradesToText,
          coveredPaths: [...new Set(graph.nodes.map((n) => n.path))].sort(),
        },
        sourceCursor: null,
      },
    };
  }

  private validateQuery(query: CodeGraphReadQueryV1): string[] {
    const issues: string[] = [];
    if (query.schemaVersion !== 1) issues.push("schemaVersion must be 1");
    if (typeof query.projectId !== "string" || query.projectId.length === 0) issues.push("projectId is required");
    if (typeof query.workspaceId !== "string" || query.workspaceId.length === 0) issues.push("workspaceId is required");
    if (!Number.isSafeInteger(query.workspaceRevision) || query.workspaceRevision < 0) issues.push("workspaceRevision must be a non-negative safe integer");
    if (!Array.isArray(query.requestedKinds) || query.requestedKinds.length === 0) issues.push("requestedKinds must be a non-empty array");
    if (!Number.isSafeInteger(query.maxNodes) || query.maxNodes <= 0) issues.push("maxNodes must be a positive safe integer");
    if (!Number.isSafeInteger(query.maxEdges) || query.maxEdges <= 0) issues.push("maxEdges must be a positive safe integer");
    if (!query.planRef || typeof query.planRef !== "object") issues.push("planRef is required");
    if (!query.baselinePin || typeof query.baselinePin !== "object") issues.push("baselinePin is required");
    return issues;
  }

  private validateKinds(requestedKinds: string[]): string | null {
    for (const kind of requestedKinds) {
      if (!KNOWN_GRAPH_KINDS.has(kind)) {
        return "requested graph kind outside supported coverage: " + kind;
      }
    }
    return null;
  }
}
