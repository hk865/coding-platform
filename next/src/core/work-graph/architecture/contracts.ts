/** R3d observed-source slice. These records are evidence of a capture, never an adopted architecture. */
import type { ArchitectureSourceMapping } from '../../../contracts/architecture-source.js';
import type { CodeGraphEdge, CodeGraphNode } from '../../../contracts/architecture-inspection.js';
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
export type ObservedArchitectureRecord = {
  ref: ObservedArchitectureRef; revision: 1; schemaVersion: 1;
  source: PersistedSourceCaptureRef; observedAt: string;
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
}
