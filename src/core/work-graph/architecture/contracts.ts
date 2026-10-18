/** R3d observed-source slice. These records are evidence of a capture, never an adopted architecture. */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { AdoptedArchitecture, ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import type { ArchitectureAutoCaptureFailureV1, ArchitectureAutoCaptureRecordV1,
  ArchitectureObservationStateV1, ArchitectureReminderFactsV1, AutoCaptureTriggerV1 } from '../../../contracts/architecture-observation.js';
import type { ArchitectureSourceMapping } from '../../../contracts/architecture-source.js';
import type { CodeGraphEdge, CodeGraphNode, FileGraphNodeV1, FileGraphPageV1, FormalObservedComparisonV1,
  LanguageCoverageV1, ObservedCaptureRef, ObservationInventoryV1 } from '../../../contracts/architecture-inspection.js';
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
 * §10 item 6 manifest: the record keeps only the counts; the unresolved entries
 * themselves live in the chunks. `schemaVersion: 2` is the only current shape
 * (decision 79: a manifest without the key is an earlier format and is rejected).
 */
export type ObservedFileGraphManifestV2 = {
  schemaVersion: 2;
  chunks: ArtifactRef[];
  nodeCount: number;
  edgeCount: number;
  unresolvedCount: number;
};
export type ObservedFileGraphManifest = ObservedFileGraphManifestV2;
/** One unresolved file-layer reference, with its provider reason (spec §11.5). */
export type ObservedFileGraphUnresolvedV1 = {
  from: string;
  specifier: string;
  reason: string | null;
};
/**
 * §10 item 6 v2 chunk body. Node order is the one global path-sorted table; an
 * edge `[i, j]` indexes that table and may point across chunks. Both scope
 * fields are required and come from the validated capture scope: every node,
 * edge, unresolved and empty chunk carries the same scope, and an unscoped
 * earlier-shape chunk is rejected rather than filled in (decision 79).
 */
export type ObservedFileGraphChunkScope = { projectId: string; workspaceId: string };
export type ObservedFileGraphChunkV2 = {
  schemaVersion: 2;
  projectId: string;
  workspaceId: string;
  nodes: FileGraphNodeV1[];
  edges: [number, number][];
  unresolved: ObservedFileGraphUnresolvedV1[];
};
/**
 * §10 item 2 v2 body summary: counts only. `files` is the capture's exported
 * project-input count (not the all-language node count); `languages` carries the
 * per-language file counts and `changes` the three change counts.
 */
export type ObservedSummaryV2 = {
  files: number;
  languages: { language: string; files: number }[];
  changes: { added: number; modified: number; deleted: number };
};
export type ObservedArchitectureRecord = {
  ref: ObservedArchitectureRef; revision: 1; schemaVersion: 1;
  source: PersistedSourceCaptureRef; observedAt: string;
  /** The file layer and coverage are part of the current format: a record that
   * lacks any of them is unreadable, never a migrated/empty observation. */
  fileGraph: ObservedFileGraphManifest;
  languages: LanguageCoverageV1[];
  inventory: ObservationInventoryV1;
};
export type WorkspaceArchitectureObservationCurrentRecord = {
  ref: WorkspaceArchitectureObservationCurrentRef; revision: number; schemaVersion: 1;
  observedRef: ObservedArchitectureRef;
  /** Ruling 7: the observation this pointer replaced, written in the same commit. */
  previousObservedRef: ObservedArchitectureRef | null;
  /** Ruling 3: the highest request sequence a committed observation satisfies. */
  satisfiedRequestSeq: number;
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
    workspace: WorkspaceScope;
    /** Book ruling 6 (one mapping rule): absent means the server derives the
     * mappings from the ACTIVE catalog (`[]` when there is none). An explicit
     * list, including `[]`, keeps the caller's exact mappings. */
    mappings?: ArchitectureSourceMapping[];
    /** Accepted suggestion "previous ref at start": absent means the capture
     * uses the current observation at entry as the previous persisted ref;
     * `null` still means no previous observation. */
    previous?: PersistedSourceCaptureRef | null;
    /** L8: the driver's start-snapshot request sequence; absent for a manual
     * capture, which reads the request record's sequence once at entry. */
    requestSeq?: number;
  }>): Promise<WriteResult<PersistedSourceCaptureRef>>;
  /** L8 request record (book ruling 3): one current record per workspace. */
  requestAutoCapture(ctx: CoreCallContext, request: GraphWrite<{
    workspace: WorkspaceScope; trigger: AutoCaptureTriggerV1; requestedAt: string;
  }>): Promise<WriteResult<ArchitectureAutoCaptureRecordV1>>;
  failAutoCapture(ctx: CoreCallContext, request: GraphWrite<{
    workspace: WorkspaceScope; expectedRevision: number; failure: ArchitectureAutoCaptureFailureV1;
  }>): Promise<WriteResult<ArchitectureAutoCaptureRecordV1>>;
  readAutoCapture(ctx: CoreCallContext, input: { workspace: WorkspaceScope }):
    Promise<ReadResult<ArchitectureAutoCaptureRecordV1 | null>>;
  /** Book ruling 8: the one public observation state, with computed `pending`. */
  observationState(ctx: CoreCallContext, input: { workspace: WorkspaceScope }):
    Promise<ReadResult<ArchitectureObservationStateV1>>;
  /** Book ruling 12: the one load behind the reminder rows. */
  readReminderFacts(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; catalog: AdoptedArchitecture | null;
  }): Promise<ReadResult<ArchitectureReminderFactsV1>>;
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
