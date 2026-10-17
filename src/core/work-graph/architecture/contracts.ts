/** R3d observed-source slice. These records are evidence of a capture, never an adopted architecture. */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import type { ArchitectureSourceMapping } from '../../../contracts/architecture-source.js';
import type { CodeGraphEdge, CodeGraphNode, FileGraphPageV1, FormalObservedComparisonV1,
  LanguageCoverageV1, ObservedCaptureRef } from '../../../contracts/architecture-inspection.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CommandMeta, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { PersistedSourceCaptureRef } from '../../../contracts/core/source.js';

/** Local request envelope; no architecture dependency on the Session component. */
export type GraphWrite<T> = { input: T; meta: CommandMeta };

export type ObservedArchitectureRef = {
  aggregateType: 'ObservedArchitecture'; projectId: string; workspaceId: string; captureId: string;
};
export type WorkspaceArchitectureObservationCurrentRef = {
  aggregateType: 'WorkspaceArchitectureObservationCurrent'; projectId: string; workspaceId: string;
};
/**
 * 8A file-level chunk manifest (spec L12; lead answer 1). One chunk per artifact;
 * `nodeCount`/`edgeCount` are the totals across the chunks. `unresolved` is stored
 * here because the chunk body carries only nodes and edges, and the formal-vs-
 * observed comparison still needs the provider's unresolved imports.
 */
export type ObservedFileGraphManifestV1 = {
  chunks: ArtifactRef[];
  nodeCount: number;
  edgeCount: number;
  unresolved: { from: string; specifier: string }[];
};
export type ObservedArchitectureRecord = {
  ref: ObservedArchitectureRef; revision: 1; schemaVersion: 1;
  source: PersistedSourceCaptureRef; observedAt: string;
  /** Absent/null on a record written before 8A; such a read reports `not_captured`. */
  fileGraph?: ObservedFileGraphManifestV1 | null;
  languages?: LanguageCoverageV1[];
};
export type WorkspaceArchitectureObservationCurrentRecord = {
  ref: WorkspaceArchitectureObservationCurrentRef; revision: number; schemaVersion: 1;
  observedRef: ObservedArchitectureRef;
};
export type ObservedArchitectureSelection = { kind: 'observed'; capture: PersistedSourceCaptureRef };
/** A mechanical change, with no architectural or policy verdict. */
export type ObservedArchitectureDeltaChange = {
  changeId: string; level: 'node' | 'edge'; kind: 'added' | 'removed' | 'modified' | 'moved';
  structuralKey: string; beforeDigest: string | null; afterDigest: string | null; label: string;
};
export type ObservedGraphAnchor = { kind: 'node'; nodeId: string } |
  { kind: 'file'; workspace: WorkspaceScope; path: string };
export type ObservedGraphPageRequest = { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
export type ObservedArchitectureNeighborhood = {
  selection: ObservedArchitectureSelection; nodes: CodeGraphNode[]; edges: CodeGraphEdge[];
  unresolved: string[]; nextCursor: string | null; sourceCursor: CommitCursor;
  /** Source mapping and dependency discovery do not establish a formal verdict. */
  noVerdict: true;
};
export type ObservedArchitectureComparison = {
  before: ObservedArchitectureSelection; after: ObservedArchitectureSelection;
  changes: ObservedArchitectureDeltaChange[];
  /** Cyclic strongly connected groups in the after graph, sorted by node ID;
   * each group is a set of members, not an ordered cycle path or all simple cycles. */
  cycles: string[][];
  unresolved: string[]; noVerdict: true;
};
export type ObservedArchitectureImpact = {
  affected: ObservedGraphAnchor[]; paths: string[][]; unresolved: string[];
  nextCursor: string | null; sourceCursor: CommitCursor; noVerdict: true;
};

/** A narrow implemented subset of the eventual ArchitecturePort. */
export interface ObservedArchitecturePort {
  captureSourceChanges(ctx: CoreCallContext, request: GraphWrite<{
    workspace: WorkspaceScope; mappings: ArchitectureSourceMapping[];
    previous: PersistedSourceCaptureRef | null;
  }>): Promise<WriteResult<PersistedSourceCaptureRef>>;
  queryArchitecture(ctx: CoreCallContext, input: {
    selection: ObservedArchitectureSelection; anchor?: ObservedGraphAnchor;
    depth: number; relations: ('dependency' | 'interface')[]; page: ObservedGraphPageRequest;
  }): Promise<ReadResult<ObservedArchitectureNeighborhood>>;
  compareArchitecture(ctx: CoreCallContext, input: {
    before: ObservedArchitectureSelection; after: ObservedArchitectureSelection;
  }): Promise<ReadResult<ObservedArchitectureComparison>>;
  queryImpact(ctx: CoreCallContext, input: {
    selection: ObservedArchitectureSelection; changed: ObservedGraphAnchor[];
    page: ObservedGraphPageRequest;
  }): Promise<ReadResult<ObservedArchitectureImpact>>;
  /** 8A file-level public reads over the chunked observation (spec L12; lead answer 1). */
  listFiles(ctx: CoreCallContext, input: {
    captureRef: ObservedCaptureRef; cursor: string | null;
  }): Promise<ReadResult<FileGraphPageV1>>;
  neighbors(ctx: CoreCallContext, input: {
    captureRef: ObservedCaptureRef; file: string; direction: 'out' | 'in'; limit: number; cursor: string | null;
  }): Promise<ReadResult<FileGraphPageV1>>;
  impact(ctx: CoreCallContext, input: {
    captureRef: ObservedCaptureRef; file: string; depth: number; limit: number; cursor: string | null;
  }): Promise<ReadResult<FileGraphPageV1>>;
  /** Read-only formal-catalog vs observed file graph comparison (spec L7). */
  compareFormalObserved(ctx: CoreCallContext, input: {
    catalog: ArchitectureCatalogPinV1; captureRef: ObservedCaptureRef;
  }): Promise<ReadResult<FormalObservedComparisonV1>>;
}
