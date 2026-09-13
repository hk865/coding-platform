/**
 * P1-12 WorkspaceReader.ReadPort — versioned workspace/source reading
 * (first consumer freeze).
 *
 * Authority: dev_docs/modules/data/workspace-reader.md (read(query) →
 * sourced / unsupported / stale / rejected; explicit Workspace version; READ
 * ONLY — never creates tasks, never writes a checkout; distinguishes committed
 * snapshots from dirty workspaces; missing graph capability degrades to
 * explicit allowed source/text search with coverage marked).
 *
 * FROZEN: the reader returns the graph for the given workspaceRevision along
 * with provenance (snapshot revision, git ref when available, index
 * capabilities). The caller (ArchitectureReconciler) checks freshness:
 * a workspaceRevision changed since the snapshot -> stale (re-read before
 * reconciling). A missing graph capability is an explicit
 * hasCodeGraph=false + degradesToText flag — never a fabricated graph.
 *
 * Current composition: raw source capture is ArchitectureSourceCapturePort.
 * SourceGraphContextCompiler preserves this legacy bound-bundle wire shape;
 * it performs canonical binding and Vault persistence in ContextCompiler.
 */
import type { CodeGraphSnapshotV1 } from "./architecture-inspection.js";
import type { CommitCursor } from "./command-event.js";
import type { PlanRevisionRef } from "./plan.js";
import type { ArchitectureBaselinePin } from "./governance.js";

export type CodeGraphReadQueryV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  /** Canonical workspace revision to read the graph for. */
  workspaceRevision: number;
  planRef: PlanRevisionRef;
  baselinePin: ArchitectureBaselinePin;
  /** Requested graph kinds (module/interface graph at minimum). */
  requestedKinds: string[];
  /** Bounded result (<= INSPECTION_MAX_NODES / EDGES). */
  maxNodes: number;
  maxEdges: number;
  /** Real readers own persisted graph material; omitted legacy callers receive unsupported. */
  requesterRunRef?: import('./dispatch.js').RunRef;
};

export type CodeGraphReadResultV1 =
  | {
      status: "sourced";
      snapshot: CodeGraphSnapshotV1;
      provenance: {
        readAt: string;
        source: "git_commit" | "workspace_snapshot" | "fixture";
        /** Canonical key of the workspace revision read. */
        revision: number;
        coverage: { hasCodeGraph: boolean; degradesToText: boolean; coveredPaths: string[] };
        sourceCursor: CommitCursor | null;
      };
    }
  | { status: "unsupported"; message: string }
  | { status: "stale"; expectedRevision: number; observedRevision: number; message: string }
  | { status: "rejected"; code: "invalid_request" | "scope_forbidden" | "path_forbidden" | "unavailable"; issues: string[] };

export interface WorkspaceReadPort {
  read(query: CodeGraphReadQueryV1): Promise<CodeGraphReadResultV1>;
}
