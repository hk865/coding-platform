/**
 * Observed-architecture service — the WorkGraph owner of persisted source observation.
 *
 * The chain is fixed and one-way: trusted Host scope + canonical Project/Workspace
 * facts -> WorkspaceTools capture/verify/export/architecture mapping -> immutable
 * body in the RawArtifactStore -> a second live source verify -> one atomic
 * RecordStore commit of the observation record, the current-observation pointer
 * and the domain event. A failed second verify leaves only an unreachable body;
 * it never publishes the pointer.
 *
 * Historical reads reopen the SAME Host-authorized WorkspaceAccessFactory, verify
 * the canonical record and the complete persisted reference/body digest/origin,
 * and then re-check the current path grants over the frozen file/mapping/config
 * paths before returning any graph. Historical files are not required to still
 * exist or keep their content.
 */
import { randomUUID } from 'node:crypto';
import { moduleMappingsOf, type AdoptedArchitecture, type ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import type { FileGraphNodeV1, FileGraphPageNodeV1, FileGraphPageV1, FormalObservedComparisonV1,
  LanguageCoverageV1, ObservedCaptureRef, ObservationInventoryV1 } from '../../../contracts/architecture-inspection.js';
import { isAutoCaptureTrigger } from '../../../contracts/architecture-observation.js';
import type { ArchitectureAutoCaptureFailureV1, ArchitectureAutoCaptureRecordV1,
  ArchitectureObservationStateV1, ArchitectureReminderFactsV1, AutoCaptureTriggerV1 } from '../../../contracts/architecture-observation.js';
import type { ArchitectureSourceMapping, ArchitectureSourceSnapshotV1 } from '../../../contracts/architecture-source.js';
import { ARTIFACT_MAX_SIZE_BYTES, artifactBodyDigest, artifactBodySize } from '../../../contracts/artifact.js';
import { commandIdentityKey } from '../../../contracts/command-event.js';
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreError, ReadResult, ReadStamp, WriteResult } from '../../../contracts/core/results.js';
import type { PersistedSourceCaptureRef, SourceCaptureRef } from '../../../contracts/core/source.js';
import type { SourceRefV1 } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { WorkspaceRef } from '../../../contracts/ledger.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, RecordGuard, StoreFailure } from '../../record-store/ports.js';
import type { WorkspaceAccessFactory, WorkspaceReadAccess } from '../../workspace/access.js';
import type { CaptureSourceRequest, CaptureSummary, WorkspaceError, WorkspaceResult, WorkspaceToolsPort } from '../../workspace/ports.js';
import type { ProjectFileGraphV1 } from '../../workspace/architecture-language-provider.js';
import { newArchitectureCaptureFailureRecord, newArchitectureCaptureRequestRecord,
  architectureAutoCaptureState } from '../state/architecture-capture.js';
import { compareObservedGraphs } from './architecture-delta.js';
import {
  ARCHITECTURE_AUTO_CAPTURE_FAILED_EVENT, ARCHITECTURE_AUTO_CAPTURE_REQUESTED_EVENT,
  ARCHITECTURE_SOURCE_OBSERVED_EVENT, FILE_GRAPH_CHUNK_CONTENT_TYPE, OBSERVED_ARCHITECTURE_BODY_CONTENT_TYPE,
  decodeArchitectureAutoCapture, decodeArchitectureAutoCaptureEvent, decodeArchitectureSourceObservedEvent,
  decodeObservedArchitectureBody, decodeObservedFileGraphChunk,
  decodeObservationCurrent, decodeObservedArchitectureRecord, encodeArchitectureAutoCapture,
  encodeArchitectureAutoCaptureEvent, encodeArchitectureSourceObservedEvent,
  encodeObservationCurrent, encodeObservedArchitecture, mergeObservedFileGraphChunks, readPersistedSourceCaptureRef,
  validateObservedFileGraphChunkV2,
  type ArchitectureAutoCaptureEventV1, type ArchitectureSourceObservedEventV1, type ObservedArchitectureBody,
  type ObservedArchitectureBodyV2, type ObservedFileGraphChunk,
} from './architecture-record-codecs.js';
import { readRevisionByRef } from './catalog-service.js';
import type { ArchitectureCatalogPort } from './catalog-contracts.js';
import { compareFormalObservedGraphs } from './formal-comparison.js';
import { FileGraphCursorError, FILE_GRAPH_MAX_IMPACT_DEPTH, FILE_GRAPH_PAGE_SIZE, impactPage,
  listFilesPage, neighborsPage, type FileGraphData, type FileGraphPageData } from './file-graph-index.js';
import type { ObservedArchitectureComparison, ObservedArchitectureImpact, ObservedArchitectureNeighborhood,
  ObservedArchitecturePort, ObservedArchitectureRecord, ObservedArchitectureRef, ObservedArchitectureSelection,
  ObservedFileGraphChunkScope, ObservedFileGraphManifestV2, ObservedGraphAnchor, ObservedGraphPageRequest,
  ObservedSummaryV2, WorkspaceArchitectureObservationCurrentRecord,
  WorkspaceArchitectureObservationCurrentRef } from './contracts.js';
import { ObservedGraphCursorError, buildObservedImpact, buildObservedNeighborhood } from './graph-index.js';
import { isProjectInputPath } from '../../workspace/project-source-snapshot.js';
import { canonicalRefKey, decodeProjectSnapshot, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { projectRefFor, workspaceRefFor } from '../persistence/commit-compiler.js';

export type ObservedArchitectureDependencies = {
  workspace: WorkspaceToolsPort;
  /** Same Host-authorized factory used to create WorkspaceTools. Historical body
   * reads must reopen it and check current path permission before body.read. */
  access: WorkspaceAccessFactory;
  bodies: RawArtifactStorePort;
  records: GoalRecordTransactionPort & RecordLookupPort;
  /** Trusted Host configuration, selected before any model or caller request.
   * `configPath: null` captures with no project configuration (a project with
   * no TS files, or a caller that wants the provider's default roots). */
  source: { provider: 'typescript'; configPath: string | null };
  /** Test injection for the file-graph chunk size; production uses
   * `ARTIFACT_MAX_SIZE_BYTES`. */
  fileGraph?: { chunkBytes?: number };
  /** One mapping rule: when a capture omits `mappings`, the
   * service resolves them from the ACTIVE catalog with `moduleMappingsOf`.
   * Production passes the real catalog service. Optional so the many tests that
   * build this service directly keep compiling; an absent `mappings` with no
   * catalog is `unsupported`, never a silent `[]`. */
  catalog?: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
};

const MAX_PAGE = 2048;
const CAPTURE_IDENTITY_PREFIX = 'observed-architecture:';
const AUTO_CAPTURE_REQUEST_IDENTITY_PREFIX = 'architecture-auto-capture-request:';
const AUTO_CAPTURE_FAILED_IDENTITY_PREFIX = 'architecture-auto-capture-failed:';
const AUTO_CAPTURE_REQUEST_ATTEMPTS = 4;

type Rejection = { status: 'rejected'; code: CoreError; reason: string; current?: VersionPin[] };
type Owned<T> = { status: 'owned'; value: T } | { status: 'invalid'; reason: string };

function forbidden(reason: string): Rejection {
  return rejected('forbidden', reason);
}
function invalid(reason: string): Rejection {
  return rejected('invalid', reason);
}
function unavailable(reason: string): Rejection {
  return rejected('unavailable', reason);
}
function asReadResult<T>(rejection: Rejection): ReadResult<T> {
  if (rejection.code === 'not_found') return { status: 'not_found' };
  return rejection;
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}
function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function safeRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/[\\:\0]/.test(value) && value.split('/').every(segment => !!segment && segment !== '.' && segment !== '..');
}
/** A mapping/module path additionally accepts exactly `.` (the root); a file
 * anchor and the configuration path keep the strict `safeRelativePath` check. */
function safeMappingPath(value: unknown): value is string {
  return value === '.' || safeRelativePath(value);
}
function ownJsonInput<T>(value: T, what: string): Owned<T> {
  try {
    const cloned = structuredClone(value);
    return { status: 'owned', value: JSON.parse(JSON.stringify(cloned)) as T };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: 'invalid', reason: what + ' cannot be isolated from the caller: ' + detail };
  }
}
function actorsAgree(a: { kind: string; id: string }, b: { kind: string; id: string }): boolean {
  return a.kind === b.kind && a.id === b.id;
}
function canonicalOf(value: unknown): string {
  return canonicalJson(value as JsonValue);
}

// --------------------------------------------------------------------------
// Input shapes
// --------------------------------------------------------------------------

function readWorkspaceScope(value: unknown): WorkspaceScope | null {
  if (!isRecord(value) || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])) return null;
  return { projectId: value['projectId'], workspaceId: value['workspaceId'] };
}
function readAutoCaptureFailure(value: unknown): ArchitectureAutoCaptureFailureV1 | null {
  if (!isRecord(value) || !exactKeys(value, ['code', 'reason'])) return null;
  if (!nonEmpty(value['code']) || typeof value['reason'] !== 'string') return null;
  return { code: value['code'], reason: value['reason'] };
}
function readMappings(value: unknown): ArchitectureSourceMapping[] | null {
  // An empty list is legal: a TS project without an adopted
  // catalog is captured with the file layer and an empty module layer.
  if (!Array.isArray(value) || value.length > 512) return null;
  const mappings: ArchitectureSourceMapping[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || !nonEmpty(entry['id'])) return null;
    const kind = entry['kind'];
    if (kind !== 'module' && kind !== 'interface') return null;
    const paths = entry['paths'];
    if (!Array.isArray(paths) || paths.length === 0 || paths.some(path => !safeMappingPath(path))) return null;
    const key = kind + ':' + entry['id'];
    if (seen.has(key)) return null;
    seen.add(key);
    mappings.push({ id: entry['id'], kind, paths: [...paths] as string[] });
  }
  return mappings;
}
function readSelection(value: unknown): ObservedArchitectureSelection | null {
  if (!isRecord(value) || value['kind'] !== 'observed') return null;
  const capture = readPersistedSourceCaptureRef(value['capture']);
  return capture === null ? null : { kind: 'observed', capture };
}
/** Formal baseline selections are not implemented in the observed-source slice; they must not silently read as an empty observed graph. */
const UNSUPPORTED_SELECTION_KINDS: readonly string[] = ['current', 'revision', 'draft'];
function unsupportedSelection(value: unknown): string | null {
  if (!isRecord(value) || typeof value['kind'] !== 'string') return null;
  if (value['kind'] === 'observed' || !UNSUPPORTED_SELECTION_KINDS.includes(value['kind'])) return null;
  return 'architecture selection kind ' + value['kind'] + ' is not implemented in the observed-source slice';
}
function readAnchor(value: unknown): ObservedGraphAnchor | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  if (value['kind'] === 'node') {
    return nonEmpty(value['nodeId']) ? { kind: 'node', nodeId: value['nodeId'] } : null;
  }
  if (value['kind'] === 'file') {
    const workspace = readWorkspaceScope(value['workspace']);
    if (workspace === null || !safeRelativePath(value['path'])) return null;
    return { kind: 'file', workspace, path: value['path'] };
  }
  return null;
}
function readPage(value: unknown): ObservedGraphPageRequest | null {
  if (!isRecord(value)) return null;
  const limit = value['limit'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) return null;
  if (value['cursor'] !== undefined && !nonEmpty(value['cursor'])) return null;
  if (value['atLeastCursor'] !== undefined && typeof value['atLeastCursor'] !== 'string') return null;
  return {
    limit,
    ...(value['cursor'] !== undefined ? { cursor: value['cursor'] as string } : {}),
    ...(value['atLeastCursor'] !== undefined ? { atLeastCursor: value['atLeastCursor'] as CommitCursor } : {}),
  };
}
function readRelations(value: unknown): ('dependency' | 'interface')[] | null {
  if (!Array.isArray(value)) return null;
  const relations: ('dependency' | 'interface')[] = [];
  for (const entry of value) {
    if (entry !== 'dependency' && entry !== 'interface') return null;
    relations.push(entry);
  }
  return relations;
}

// --------------------------------------------------------------------------
// 8A file-level helpers (pure)
// --------------------------------------------------------------------------

function readFileGraphCaptureRef(value: unknown): ObservedCaptureRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'ObservedArchitecture') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) || !nonEmpty(value['captureId'])) return null;
  return { aggregateType: 'ObservedArchitecture', projectId: value['projectId'],
    workspaceId: value['workspaceId'], captureId: value['captureId'] };
}
/** `null` is a valid absent cursor; `undefined` marks a malformed one. */
function readFileGraphCursor(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return nonEmpty(value) ? value : undefined;
}
function readCatalogPin(value: unknown): ArchitectureCatalogPinV1 | null {
  if (!isRecord(value)) return null;
  const ref = value['catalogRef'];
  if (!isRecord(ref) || ref['aggregateType'] !== 'ArchitectureCatalog') return null;
  if (!nonEmpty(ref['projectId']) || !nonEmpty(ref['baselineId']) || !safeInteger(ref['revision']) || ref['revision'] < 1) return null;
  const baseline = value['baseline'];
  if (!isRecord(baseline)) return null;
  const baselineRef = baseline['ref'];
  if (!isRecord(baselineRef) || baselineRef['aggregateType'] !== 'ArchitectureBaselineRevision') return null;
  if (!nonEmpty(baselineRef['projectId']) || !nonEmpty(baselineRef['baselineId']) || !safeInteger(baselineRef['revision']) || baselineRef['revision'] < 1) return null;
  if (typeof baseline['digest'] !== 'string' || !/^[a-f0-9]{64}$/.test(baseline['digest'])) return null;
  return {
    catalogRef: { aggregateType: 'ArchitectureCatalog', projectId: ref['projectId'],
      baselineId: ref['baselineId'], revision: ref['revision'] },
    baseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: baselineRef['projectId'],
      baselineId: baselineRef['baselineId'], revision: baselineRef['revision'] }, digest: baseline['digest'] },
  };
}

/** The empty module-level snapshot for a project with no TS/JS sources.
 * `configPath` mirrors the capture's resolved configuration so the strict body reader accepts it. */
function emptyArchitectureSnapshot(input: { scope: WorkspaceScope; capture: SourceCaptureRef;
  mappings: ArchitectureSourceMapping[]; configPath: string | null; commitHash: string | null }): ArchitectureSourceSnapshotV1 {
  return {
    schemaVersion: 1, projectId: input.scope.projectId, workspaceId: input.scope.workspaceId,
    workspaceRevision: input.capture.workspaceRevision, sourceDigest: input.capture.sourceDigest,
    commitHash: input.commitHash, indexVersion: input.capture.indexVersion, configPath: input.configPath,
    mappings: input.mappings, nodes: [], edges: [], unresolved: [],
  };
}

/** Packs pre-serialized items into chunk bodies with a fixed prefix/suffix.
 * Each item is serialized once and only the running byte size is tracked, so the
 * whole builder is linear in the graph size (the previous version re-serialized
 * the growing array for every element, which is O(n^2) near the caps).
 * An item that does not fit alone WITH its envelope is recorded as `overflow`
 * (the caller can still count chunks first and report the 64-chunk limit); the
 * pure writer raises `FileGraphChunkCapacityError` unless that limit already wins. */
class FileGraphChunkCapacityError extends Error {
  constructor(readonly itemBytes: number, readonly cap: number) {
    super('a file graph item needs ' + itemBytes + ' bytes with its chunk envelope; the chunk capacity is ' + cap);
    this.name = 'FileGraphChunkCapacityError';
  }
}
type PackedFileGraphChunks = { chunks: string[]; overflow: { itemBytes: number; cap: number } | null };
function packFileGraphChunks<T>(prefix: string, suffix: string, serialized: readonly string[],
  cap: number, alwaysFlush: boolean): PackedFileGraphChunks {
  const chunks: string[] = [];
  const overhead = Buffer.byteLength(prefix, 'utf8') + Buffer.byteLength(suffix, 'utf8');
  let overflow: PackedFileGraphChunks['overflow'] = null;
  let start = 0;
  let size = 0;
  for (let index = 0; index < serialized.length; index += 1) {
    const itemBytes = Buffer.byteLength(serialized[index]!, 'utf8');
    if (index === start) {
      // An item that starts a chunk (the first one, or the first after a flush)
      // must fit WITH the envelope on its own; otherwise no chunk size can hold it.
      if (overhead + itemBytes > cap) overflow ??= { itemBytes: overhead + itemBytes, cap };
      size += itemBytes;
    } else if (overhead + size + 1 + itemBytes > cap) {
      if (overhead + itemBytes > cap) overflow ??= { itemBytes: overhead + itemBytes, cap };
      chunks.push(prefix + serialized.slice(start, index).join(',') + suffix);
      start = index;
      size = itemBytes;
    } else {
      size += 1 + itemBytes;
    }
  }
  if (alwaysFlush && serialized.length === 0 && overhead > cap) {
    // The empty graph still writes one envelope; its own bytes count toward the
    // cap, so a cap smaller than the envelope is capacity with no items at all.
    overflow ??= { itemBytes: overhead, cap };
  }
  if (alwaysFlush || serialized.length > 0) {
    chunks.push(prefix + serialized.slice(start).join(',') + suffix);
  }
  return { chunks, overflow };
}

/** The pure input of the v2 chunk writer; the capture's `ProjectFileGraphV1` is
 * structurally compatible once it carries the full §10 nodes. */
export type FileGraphChunkInput = {
  nodes: readonly FileGraphNodeV1[];
  edges: readonly { from: string; to: string }[];
  unresolved: readonly { from: string; specifier: string; reason: string | null }[];
};
export type NormalizedFileGraph = {
  nodes: FileGraphNodeV1[];
  edges: [number, number][];
  unresolved: { from: string; specifier: string; reason: string | null }[];
};

/** §10 item 6 store step: build the ONE global path-sorted node table and map
 * each edge to `[i, j]` over that table. This is NOT a second normalizer: the
 * capture already deduped/sorted edges and grouped/picked/sorted unresolved
 * references, so the store keeps both lists in the order it is given.
 * An edge whose endpoint is not a node cannot be encoded and is dropped. */
export function normalizeFileGraph(graph: FileGraphChunkInput): NormalizedFileGraph {
  const byPath = new Map<string, FileGraphNodeV1>();
  for (const node of graph.nodes) if (!byPath.has(node.path)) byPath.set(node.path, node);
  const nodes = [...byPath.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const indexByPath = new Map(nodes.map((node, index) => [node.path, index]));
  const edges: [number, number][] = [];
  for (const edge of graph.edges) {
    const from = indexByPath.get(edge.from), to = indexByPath.get(edge.to);
    if (from === undefined || to === undefined) continue;
    edges.push([from, to]);
  }
  return { nodes, edges, unresolved: [...graph.unresolved] };
}

/** Packs already-normalized v2 items into chunk bodies. Nodes come first (each
 * chunk is a contiguous run of the global table), then edge pairs, then
 * unresolved entries; every chunk body is at most `cap` bytes and all three
 * kinds count toward the 64-chunk budget. The empty graph still writes one
 * empty v2 chunk, and its envelope counts toward the cap too.
 *
 * The envelope is assembled from the ESCAPED scope values and a fixed structure;
 * it is never located by searching the JSON for `"nodes"`/`[]`, because a legal
 * id may itself contain those characters. Every node, edge, unresolved and empty
 * chunk carries the same required scope. */
export function serializeFileGraphChunks(graph: NormalizedFileGraph,
  scope: ObservedFileGraphChunkScope, cap: number): string[] {
  const head = '{"schemaVersion":2,"projectId":' + JSON.stringify(scope.projectId)
    + ',"workspaceId":' + JSON.stringify(scope.workspaceId);
  const nodePrefix = head + ',"nodes":[';
  const nodeSuffix = '],"edges":[],"unresolved":[]}';
  const edgePrefix = head + ',"nodes":[],"edges":[';
  const edgeSuffix = '],"unresolved":[]}';
  const unresolvedPrefix = head + ',"nodes":[],"edges":[],"unresolved":[';
  const unresolvedSuffix = ']}';
  const packed = [
    packFileGraphChunks(nodePrefix, nodeSuffix, graph.nodes.map(node => JSON.stringify(node)), cap, true),
    packFileGraphChunks(edgePrefix, edgeSuffix, graph.edges.map(edge => JSON.stringify(edge)), cap, false),
    packFileGraphChunks(unresolvedPrefix, unresolvedSuffix, graph.unresolved.map(entry => JSON.stringify(entry)), cap, false),
  ];
  const chunks = packed.flatMap(piece => piece.chunks);
  const overflow = packed.map(piece => piece.overflow).find(entry => entry !== null) ?? null;
  // When the 64-chunk limit ALSO wins, let the service report that limit with the
  // real count (A-01h); otherwise an item that cannot fit alone is capacity here.
  if (overflow !== null && chunks.length <= 64) throw new FileGraphChunkCapacityError(overflow.itemBytes, overflow.cap);
  return chunks;
}

// --------------------------------------------------------------------------
// Store / workspace failure mapping
// --------------------------------------------------------------------------

function mapStoreFailure(failure: StoreFailure): Rejection {
  switch (failure.code) {
    case 'not_found': return rejected('not_found', failure.reason);
    case 'invalid': return invalid(failure.reason);
    case 'unsupported': return unavailable(failure.reason);
    case 'corrupt': return unavailable('corrupt: ' + failure.reason);
    case 'unique_conflict':
    case 'idempotency_conflict':
    case 'unavailable': return unavailable(failure.reason);
    case 'revision_conflict': return rejected('revision_conflict', failure.reason);
  }
}
function mapWorkspaceFailure(failure: Extract<WorkspaceResult<never>, { status: 'rejected' }>): Rejection {
  const code = failure.code as WorkspaceError;
  switch (code) {
    case 'invalid': return invalid(failure.reason);
    case 'forbidden': return forbidden(failure.reason);
    case 'not_found': return rejected('not_found', failure.reason);
    case 'source_stale': return rejected('source_stale', failure.reason);
    case 'capture_expired': return unavailable(failure.reason);
    case 'cursor_mismatch': return invalid(failure.reason);
    case 'capacity': return rejected('capacity', failure.reason);
    case 'unsupported': return rejected('unsupported', failure.reason);
    case 'cancelled': return rejected('cancelled', failure.reason);
    case 'unavailable': return unavailable(failure.reason);
  }
}
function mapBodyPutFailure(failure: StoreFailure): Rejection {
  switch (failure.code) {
    case 'invalid': return invalid(failure.reason);
    case 'unsupported': return rejected('unsupported', failure.reason);
    default: return unavailable(failure.reason);
  }
}
function compareSourceCursor(observed: CommitCursor, required: CommitCursor):
  { status: 'ok' } | { status: 'not_ready'; observed: ReadStamp | null; required: ReadStamp } {
  let observedSeq: number;
  let requiredSeq: number;
  try {
    observedSeq = seqOfCommitCursor(observed);
    requiredSeq = seqOfCommitCursor(required);
  } catch {
    return { status: 'not_ready', observed: { kind: 'platform', cursor: observed }, required: { kind: 'platform', cursor: required } };
  }
  if (observedSeq >= requiredSeq) return { status: 'ok' };
  return { status: 'not_ready', observed: { kind: 'platform', cursor: observed }, required: { kind: 'platform', cursor: required } };
}

// --------------------------------------------------------------------------
// Trusted caller binding
// --------------------------------------------------------------------------

/** Best-effort cleanup of the temporary capture slot; a committed observation keeps only its persisted body.
 * Cleanup keeps the SAME principal/materialReader and workspace scope, but uses a fresh non-aborted signal:
 * the request's cancellation must not leave the retained registry slot pinned. The registry still
 * re-runs Host authorization and subject/domain checks, so this does not widen identity or permission. */
async function releaseCaptureQuietly(workspace: WorkspaceToolsPort, ctx: CoreCallContext, ref: SourceCaptureRef): Promise<void> {
  const cleanup: CoreCallContext = { ...ctx, signal: new AbortController().signal };
  try { await workspace.releaseCapture(cleanup, ref); } catch { /* the registry slot is reclaimed by expiry if release is rejected */ }
}
function bindHostWriteContext(ctx: CoreCallContext, scope: WorkspaceScope):
  { status: 'ok'; actor: Extract<CoreCallContext['principal'], { kind: 'host' }>['actor'] } | Rejection {
  if (!ctx || typeof ctx !== 'object') return forbidden('a bound call context is required');
  if (ctx.projectId !== scope.projectId) return forbidden('the call context is outside the requested project');
  if (ctx.workspaceId !== scope.workspaceId) return forbidden('the call context is outside the requested workspace');
  if (ctx.principal.kind !== 'host') return forbidden('observed source captures are admitted only through a host principal');
  const actor = ctx.principal.actor;
  const reader = ctx.materialReader;
  if (reader.kind !== 'host') return forbidden('an observed source capture requires a host material reader');
  if (reader.projectId !== scope.projectId || reader.workspaceId !== scope.workspaceId) return forbidden('the host material reader is outside the requested workspace');
  if (!actorsAgree(reader.actor, actor)) return forbidden('the host principal and material reader disagree');
  return { status: 'ok', actor };
}
/** Read-side scope check: a read never widens to another project/workspace. */
function ctxScopeProblem(ctx: CoreCallContext, scope: WorkspaceScope): Rejection | null {
  if (!ctx || typeof ctx !== 'object') return forbidden('a bound call context is required');
  if (ctx.projectId !== scope.projectId) return forbidden('the call context is outside the requested project');
  if (ctx.workspaceId !== scope.workspaceId) return forbidden('the call context is outside the requested workspace');
  return null;
}

// --------------------------------------------------------------------------
// Expected version pins
// --------------------------------------------------------------------------

type ExpectedPins = { project?: number; workspace?: number };
function normalizeExpectedPins(scope: WorkspaceScope, expected: unknown): { status: 'ok'; pins: ExpectedPins } | Rejection {
  if (!Array.isArray(expected)) return invalid('meta.expected must be an array of version pins');
  const pins: ExpectedPins = {};
  const seen = new Set<string>();
  for (const entry of expected) {
    if (!isRecord(entry)) return invalid('every version pin must be an object');
    const revision = entry['revision'];
    if (!safeInteger(revision)) return invalid('a version pin revision must be a safe non-negative integer');
    const ref = entry['ref'];
    if (!isRecord(ref) || !nonEmpty(ref['projectId']) || ref['projectId'] !== scope.projectId) {
      return invalid('a version pin ref must belong to this project');
    }
    // The pin ref must be the CLOSED scope ref: an extra field must not create a second pin for the same fact.
    if (ref['aggregateType'] === 'Project') {
      if (!exactKeys(ref, ['aggregateType', 'projectId'])) return invalid('a Project version pin ref must carry only aggregateType and projectId');
      const key = canonicalOf({ aggregateType: 'Project', projectId: scope.projectId });
      if (seen.has(key)) return invalid('duplicate version pin');
      seen.add(key);
      pins.project = revision;
    } else if (ref['aggregateType'] === 'Workspace') {
      if (!exactKeys(ref, ['aggregateType', 'projectId', 'workspaceId']) || ref['workspaceId'] !== scope.workspaceId) {
        return invalid('a Workspace version pin ref must carry only aggregateType, projectId and this workspaceId');
      }
      const key = canonicalOf({ aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId });
      if (seen.has(key)) return invalid('duplicate version pin');
      seen.add(key);
      pins.workspace = revision;
    } else return invalid('a version pin ref is not a Project/Workspace scope ref');
  }
  return { status: 'ok', pins };
}
function compareExpectedPins(scope: WorkspaceScope, pins: ExpectedPins, projectRevision: number, workspaceRevision: number): Rejection | null {
  const current: VersionPin[] = [];
  if (pins.project !== undefined && pins.project !== projectRevision) {
    current.push({ ref: projectRefFor(scope.projectId), revision: projectRevision });
  }
  if (pins.workspace !== undefined && pins.workspace !== workspaceRevision) {
    current.push({ ref: workspaceRefFor(scope.projectId, scope.workspaceId), revision: workspaceRevision });
  }
  return current.length === 0 ? null : { status: 'rejected', code: 'revision_conflict',
    reason: 'the supplied version pins do not match the current canonical scope', current };
}

// --------------------------------------------------------------------------
// Canonical scope and previous observation
// --------------------------------------------------------------------------

type CanonicalScope = { status: 'ready'; projectRevision: number; workspaceRevision: number };

async function readCanonicalScope(records: GoalRecordTransactionPort, scope: WorkspaceScope): Promise<CanonicalScope | Rejection> {
  const projectRef = projectRefFor(scope.projectId);
  const workspaceRef = workspaceRefFor(scope.projectId, scope.workspaceId);
  const batch = await records.readMany([canonicalRefKey(projectRef), canonicalRefKey(workspaceRef)]);
  if (batch.status !== 'ready') return mapStoreFailure(batch);
  const byKey = new Map(batch.value.records.map(record => [record.refKey, record]));
  const projectRecord = byKey.get(canonicalRefKey(projectRef));
  const workspaceRecord = byKey.get(canonicalRefKey(workspaceRef));
  if (projectRecord === undefined || workspaceRecord === undefined) {
    return invalid('the project and workspace canonical records must exist before an observation');
  }
  const project = decodeProjectSnapshot(projectRecord);
  const workspace = decodeWorkspaceSnapshot(workspaceRecord);
  if (project.status !== 'decoded' || workspace.status !== 'decoded') return unavailable('the canonical project/workspace records are damaged');
  // No global ledger watermark: the exact Project, Workspace, current-pointer and new-observation
  // guards below are the complete consistency basis, so unrelated writes never force a re-capture.
  return { status: 'ready', projectRevision: project.value.revision, workspaceRevision: workspace.value.revision };
}

function changeSet(before: readonly { path: string; digest: string }[], after: readonly { path: string; digest: string }[]):
  CaptureSummary['changes'] {
  const beforeByPath = new Map(before.map(file => [file.path, file.digest]));
  const afterByPath = new Map(after.map(file => [file.path, file.digest]));
  const added: string[] = [], modified: string[] = [], deleted: string[] = [];
  for (const [path, digest] of afterByPath) {
    const prior = beforeByPath.get(path);
    if (prior === undefined) added.push(path);
    else if (prior !== digest) modified.push(path);
  }
  for (const path of beforeByPath.keys()) if (!afterByPath.has(path)) deleted.push(path);
  return { added: added.sort((a, b) => a.localeCompare(b)), modified: modified.sort((a, b) => a.localeCompare(b)), deleted: deleted.sort((a, b) => a.localeCompare(b)) };
}

// --------------------------------------------------------------------------
// Historical load
// --------------------------------------------------------------------------

type ExportedFile = { path: string; digest: string };
type LoadedObservation = {
  body: ObservedArchitectureBody;
  sourceCursor: CommitCursor;
  /** The stored observation record's persisted ref (record `source`), read in
   * the same load so callers never need a second record read for it. */
  persistedRef: PersistedSourceCaptureRef;
  /** The capture's exported project inputs for change counting: v1 `body.files`,
   * v2 `isProjectInputPath(node.path)` over the chunk nodes (lead answer 10). */
  exportedFiles: ExportedFile[];
  /** The one chunked file graph this load already assembled, so the L8 reminder
   * read shares it between `latest`/`previous` and the formal comparison. */
  fileGraph: LoadedFileGraph;
};

/** Existing callers pass the persisted capture ref; the L8 pointer only stores
 * the observed aggregate ref, so the loader derives the persisted source from
 * the record it reads instead of a second record read by the caller. */
type ObservationLoadSelection = ObservedArchitectureSelection | { kind: 'observed'; ref: ObservedArchitectureRef };

async function loadObservation(deps: {
  access: WorkspaceAccessFactory; bodies: RawArtifactStorePort; records: GoalRecordTransactionPort;
}, ctx: CoreCallContext, selection: ObservationLoadSelection): Promise<{ status: 'ready'; value: LoadedObservation } | Rejection> {
  const observationsRef: ObservedArchitectureRef = 'ref' in selection
    ? selection.ref
    : { aggregateType: 'ObservedArchitecture', projectId: selection.capture.capture.projectId,
        workspaceId: selection.capture.capture.workspaceId, captureId: selection.capture.capture.captureId };
  if (ctx.projectId !== observationsRef.projectId || ctx.workspaceId !== observationsRef.workspaceId) {
    return forbidden('the call context is outside the persisted observation workspace');
  }
  const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: observationsRef.projectId, workspaceId: observationsRef.workspaceId };
  const opened = await deps.access.open(ctx, workspaceRef);
  if (opened.status !== 'ready') return mapWorkspaceFailure(opened);
  const access: WorkspaceReadAccess = opened.value;
  try {
    const ref = observationsRef;
    const refKey = canonicalOf(ref);
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const encoded = read.value.records.find(record => record.refKey === refKey);
    if (encoded === undefined) return rejected('not_found', 'the persisted observation record does not exist');
    const decodedRecord = decodeObservedArchitectureRecord(encoded);
    if (decodedRecord.status !== 'decoded') return unavailable('the canonical observation record is damaged');
    const capture = 'capture' in selection ? selection.capture : decodedRecord.value.source;
    if (canonicalOf(decodedRecord.value.source) !== canonicalOf(capture)) {
      return invalid('the persisted reference does not match the canonical observation record');
    }
    if (read.value.readThrough === null) return unavailable('the ledger has no readable watermark for the observation');
    const sourceCursor = read.value.readThrough;
    const raw = await deps.bodies.read(capture.material);
    if (raw.status !== 'ready') {
      return raw.code === 'not_found' ? rejected('not_found', raw.reason) : unavailable(raw.reason);
    }
    const stored = raw.value;
    if (canonicalOf(stored.ref) !== canonicalOf(capture.material)) return unavailable('the stored body ref does not match the persisted material ref');
    if (stored.origin.kind !== 'platform_operation' || stored.origin.projectId !== capture.capture.projectId
      || (stored.origin.workspaceId !== undefined && stored.origin.workspaceId !== capture.capture.workspaceId)) {
      return unavailable('the stored body origin is not this workspace platform observation');
    }
    if (artifactBodyDigest(stored.body) !== capture.material.digest || artifactBodySize(stored.body) !== capture.material.sizeBytes) {
      return unavailable('the stored body digest does not match the persisted material ref');
    }
    // Decision 79: only the current v2 body is readable. Its membership recheck
    // needs the chunk node table, and the change counts always come from those
    // v2 nodes (the capture's TS/JS/JSON export set, lead answer 10).
    // The record and access above are the ones this operation already read and
    // opened; the chunk helper must NOT read or open them a second time.
    const graph = await readFileGraphChunks(deps, access, decodedRecord.value, captureRefOf(capture.capture));
    if (graph.status !== 'ready') return graph;
    const decodedBody = decodeObservedArchitectureBody(stored.body, graph.value.nodes);
    if (decodedBody.status !== 'decoded') return unavailable('the stored observation body is damaged: ' + decodedBody.reason);
    const body = decodedBody.value;
    const exportedFiles: ExportedFile[] = graph.value.nodes.filter(node => isProjectInputPath(node.path))
      .map(node => ({ path: node.path, digest: node.digest }));
    if (canonicalOf(body.capture) !== canonicalOf(capture.capture)) return unavailable('the stored body capture does not match the persisted reference');
    // Current path authorization is re-checked over the FROZEN paths before any graph is returned.
    // The chunk-reading helper already authorized every node path; only the
    // configuration path is added here (spec §10 item 2).
    if (body.architecture.configPath !== null && !access.authorization.allowsRead(body.architecture.configPath)) {
      return forbidden('the current Host grant does not cover the frozen source path ' + body.architecture.configPath);
    }
    return { status: 'ready', value: { body, sourceCursor, persistedRef: decodedRecord.value.source,
      exportedFiles, fileGraph: graph.value } };
  } finally {
    await access.release();
  }
}

function captureRefOf(capture: SourceCaptureRef): ObservedCaptureRef {
  return { aggregateType: 'ObservedArchitecture', projectId: capture.projectId,
    workspaceId: capture.workspaceId, captureId: capture.captureId };
}

// --------------------------------------------------------------------------
// 8A file-level load (record + chunk artifacts)
// --------------------------------------------------------------------------

type LoadedFileGraph = {
  nodes: FileGraphNodeV1[];
  edges: { from: string; to: string }[];
  unresolved: { from: string; specifier: string; reason: string | null }[];
  languages: LanguageCoverageV1[];
  complete: boolean;
  inventory: ObservationInventoryV1;
  /** The explicit page projection (§10 item 6: no digest, byte size or
   * `indexed`), derived on demand so a comparison never duplicates the table. */
  pageNodes: () => FileGraphPageNodeV1[];
};

/** THE one chunk-reading helper (§10 item 2): it receives the record its caller
 * has ALREADY read and decoded plus the already-open Host access, loads every
 * chunk with the existing origin/digest checks, validates the indices and the
 * exact counts, authorizes every frozen node/issue path, and returns the
 * concatenated graph. It never opens the workspace, re-reads the record or
 * releases the access: the page entry and `loadObservation` each do exactly one
 * of each and hand them here. The record decoder guarantees a current v2
 * manifest, so this never returns an absent graph (decision 79). */
async function readFileGraphChunks(deps: { bodies: RawArtifactStorePort }, access: WorkspaceReadAccess,
  record: ObservedArchitectureRecord, captureRef: ObservedCaptureRef): Promise<{ status: 'ready'; value: LoadedFileGraph } | Rejection> {
  if (record.ref.projectId !== captureRef.projectId || record.ref.workspaceId !== captureRef.workspaceId
    || record.ref.captureId !== captureRef.captureId) {
    return invalid('the persisted reference does not match the canonical observation record');
  }
  const manifest = record.fileGraph;
  const chunks: ObservedFileGraphChunk[] = [];
  for (const chunkRef of manifest.chunks) {
    const raw = await deps.bodies.read(chunkRef);
    if (raw.status !== 'ready') return raw.code === 'not_found' ? rejected('not_found', raw.reason) : unavailable(raw.reason);
    const stored = raw.value;
    if (canonicalOf(stored.ref) !== canonicalOf(chunkRef)) return unavailable('the stored chunk ref does not match the persisted chunk ref');
    if (stored.origin.kind !== 'platform_operation' || stored.origin.projectId !== captureRef.projectId
      || stored.origin.workspaceId !== captureRef.workspaceId) {
      return unavailable('the stored chunk origin is not this workspace platform observation');
    }
    if (artifactBodyDigest(stored.body) !== chunkRef.digest || artifactBodySize(stored.body) !== chunkRef.sizeBytes) {
      return unavailable('the stored chunk digest does not match the persisted chunk ref');
    }
    // Index pairs are validated against the manifest's global node count.
    const chunk = decodeObservedFileGraphChunk(stored.body, captureRef, manifest.nodeCount);
    if (chunk.status !== 'decoded') return unavailable('the stored file graph chunk is damaged: ' + chunk.reason);
    chunks.push(chunk.value);
  }
  const merged = mergeObservedFileGraphChunks(manifest, chunks);
  if (merged.status !== 'decoded') return unavailable('the stored file graph is damaged: ' + merged.reason);
  const nodes = merged.value.nodes;
  const languages = record.languages;
  for (const node of nodes) if (!access.authorization.allowsRead(node.path)) {
    return forbidden('the current Host grant does not cover every frozen path of this observation');
  }
  // Language coverage carries issue paths that are not node
  // paths (for example a skipped configuration or source file). The current
  // grant must cover them too, or the whole file page leaks them.
  for (const language of languages) for (const issue of language.issues) {
    if (!access.authorization.allowsRead(issue.path)) {
      return forbidden('the current Host grant does not cover every frozen path of this observation');
    }
  }
  return { status: 'ready', value: { nodes, edges: merged.value.edges, unresolved: merged.value.unresolved,
    languages, complete: languages.every(language => language.complete),
    inventory: record.inventory,
    pageNodes: (): FileGraphPageNodeV1[] => nodes.map(node => ({ path: node.path,
      nonBlankLines: node.nonBlankLines, language: node.language })) } };
}

/** The page entry (§10 item 2): open the Host access once, read and decode the
 * record once, then hand both to `readFileGraphChunks`. */
async function loadFileGraph(deps: {
  access: WorkspaceAccessFactory; bodies: RawArtifactStorePort; records: GoalRecordTransactionPort;
}, ctx: CoreCallContext, captureRef: ObservedCaptureRef): Promise<{ status: 'ready'; value: LoadedFileGraph } | Rejection> {
  if (ctx.projectId !== captureRef.projectId || ctx.workspaceId !== captureRef.workspaceId) {
    return forbidden('the call context is outside the persisted observation workspace');
  }
  const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: captureRef.projectId, workspaceId: captureRef.workspaceId };
  const opened = await deps.access.open(ctx, workspaceRef);
  if (opened.status !== 'ready') return mapWorkspaceFailure(opened);
  const access: WorkspaceReadAccess = opened.value;
  try {
    const refKey = canonicalOf(captureRef);
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const encoded = read.value.records.find(record => record.refKey === refKey);
    if (encoded === undefined) return rejected('not_found', 'the persisted observation record does not exist');
    const decoded = decodeObservedArchitectureRecord(encoded);
    if (decoded.status !== 'decoded') return unavailable('the canonical observation record is damaged');
    return await readFileGraphChunks(deps, access, decoded.value, captureRef);
  } finally {
    await access.release();
  }
}

// --------------------------------------------------------------------------
// Replay restoration
// --------------------------------------------------------------------------

async function restoreObservedCapture(records: GoalRecordTransactionPort, receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>,
  expected: { identityKey: string; projectId: string; workspaceId: string; idempotencyKey: string; actor: { kind: string; id: string } }):
  Promise<{ status: 'restored'; value: PersistedSourceCaptureRef } | Rejection> {
  if (receipt.identityKey !== expected.identityKey) return unavailable('the idempotency receipt belongs to another identity');
  if (receipt.eventIds.length !== 1) return unavailable('the observation receipt must reference exactly one event');
  const located = await records.eventAt(receipt.cursor);
  if (located.status !== 'ready') return mapStoreFailure(located);
  if (String(located.value.cursor) !== String(receipt.cursor)) return unavailable('eventAt returned a different cursor');
  const decoded = decodeArchitectureSourceObservedEvent(located.value.event);
  if (decoded.status !== 'decoded') return unavailable('the original observation event is corrupt: ' + decoded.reason);
  const event = decoded.value;
  if (event.eventId !== receipt.eventIds[0]) return unavailable('the receipt points at another event');
  if (event.projectId !== expected.projectId || event.workspaceId !== expected.workspaceId) return unavailable('the original observation event is outside the recovered scope');
  if (event.idempotencyKey !== expected.idempotencyKey || !actorsAgree(event.actor, expected.actor)) return unavailable('the original observation event carries another identity');
  return { status: 'restored', value: event.payload.source };
}

// --------------------------------------------------------------------------
// L8 auto-capture request record, pointer and observation state
// --------------------------------------------------------------------------

function autoCaptureRefOf(scope: WorkspaceScope): ArchitectureAutoCaptureRecordV1['ref'] {
  return { aggregateType: 'ArchitectureAutoCapture', projectId: scope.projectId, workspaceId: scope.workspaceId };
}
function currentObservationRefOf(scope: WorkspaceScope): WorkspaceArchitectureObservationCurrentRef {
  return { aggregateType: 'WorkspaceArchitectureObservationCurrent', projectId: scope.projectId, workspaceId: scope.workspaceId };
}

/** The request record is the START SNAPSHOT for a failure write, so every
 * caller reads it exactly once through this helper. */
async function readAutoCaptureRecord(records: GoalRecordTransactionPort, scope: WorkspaceScope):
  Promise<{ status: 'ready'; value: ArchitectureAutoCaptureRecordV1 | null } | Rejection> {
  const refKey = canonicalOf(autoCaptureRefOf(scope));
  const read = await records.readMany([refKey]);
  if (read.status !== 'ready') return mapStoreFailure(read);
  const encoded = read.value.records.find(record => record.refKey === refKey);
  if (encoded === undefined) return { status: 'ready', value: null };
  const decoded = decodeArchitectureAutoCapture(encoded);
  if (decoded.status !== 'decoded') return unavailable('the auto-capture request record is damaged');
  return { status: 'ready', value: decoded.value };
}

async function readCurrentObservationPointer(records: GoalRecordTransactionPort, scope: WorkspaceScope):
  Promise<{ status: 'ready'; value: WorkspaceArchitectureObservationCurrentRecord | null } | Rejection> {
  const ref = currentObservationRefOf(scope);
  const refKey = canonicalOf(ref);
  const read = await records.readMany([refKey]);
  if (read.status !== 'ready') return mapStoreFailure(read);
  const encoded = read.value.records.find(record => record.refKey === refKey);
  if (encoded === undefined) return { status: 'ready', value: null };
  const decoded = decodeObservationCurrent(encoded);
  if (decoded.status !== 'decoded') return unavailable('the current observation pointer is damaged');
  return { status: 'ready', value: decoded.value };
}

async function readObservationRecord(records: GoalRecordTransactionPort, ref: ObservedArchitectureRef):
  Promise<{ status: 'ready'; value: ObservedArchitectureRecord } | Rejection> {
  const refKey = canonicalOf(ref);
  const read = await records.readMany([refKey]);
  if (read.status !== 'ready') return mapStoreFailure(read);
  const encoded = read.value.records.find(record => record.refKey === refKey);
  if (encoded === undefined) return rejected('not_found', 'the persisted observation record does not exist');
  const decoded = decodeObservedArchitectureRecord(encoded);
  if (decoded.status !== 'decoded') return unavailable('the canonical observation record is damaged');
  return { status: 'ready', value: decoded.value };
}

type ObservationStateBasis = {
  pointer: WorkspaceArchitectureObservationCurrentRecord | null;
  request: ArchitectureAutoCaptureRecordV1 | null;
};

/** The reads shared by `observationState` and `readReminderFacts`: the pointer
 * (one read) and the request record (one read). `observationState` adds the
 * current observation record for `observedAt`/`persistedRef` and, when the
 * pointer has a previous one, that record for `previousPersistedRef`;
 * `readReminderFacts` loads each observation once through `loadObservation`,
 * which already includes the chunk graph it shares with the comparison. */
async function readObservationStateBasis(records: GoalRecordTransactionPort, scope: WorkspaceScope):
  Promise<{ status: 'ready'; value: ObservationStateBasis } | Rejection> {
  const pointer = await readCurrentObservationPointer(records, scope);
  if (pointer.status !== 'ready') return pointer;
  const request = await readAutoCaptureRecord(records, scope);
  if (request.status !== 'ready') return request;
  return { status: 'ready', value: { pointer: pointer.value, request: request.value } };
}

/** The accepted "persisted ref" suggestion: the state carries the observation
 * record's stored ref for `current` and `previous` so a caller can query without
 * a replay. Both values come from observation records the caller already reads. */
function observationStateOf(basis: ObservationStateBasis,
  current: { observedAt: string; persistedRef: PersistedSourceCaptureRef } | null,
  previousPersistedRef: PersistedSourceCaptureRef | null): ArchitectureObservationStateV1 {
  const { pointer, request } = basis;
  return {
    current: pointer === null || current === null
      ? null
      : { captureRef: pointer.observedRef, persistedRef: current.persistedRef, observedAt: current.observedAt },
    previous: pointer?.previousObservedRef ?? null,
    previousPersistedRef: pointer?.previousObservedRef === null || pointer?.previousObservedRef === undefined
      ? null : previousPersistedRef,
    autoCapture: architectureAutoCaptureState(request, pointer?.satisfiedRequestSeq ?? 0),
  };
}

function makeAutoCaptureEvent(
  eventType: typeof ARCHITECTURE_AUTO_CAPTURE_REQUESTED_EVENT | typeof ARCHITECTURE_AUTO_CAPTURE_FAILED_EVENT,
  record: ArchitectureAutoCaptureRecordV1, occurredAt: string, requestId: string, identityKey: string, actor: ActorRef,
): ArchitectureAutoCaptureEventV1 {
  return {
    eventId: randomUUID(), eventType, schemaVersion: 1,
    projectId: record.ref.projectId, workspaceId: record.ref.workspaceId,
    aggregateType: 'ArchitectureAutoCapture', aggregateId: record.workspace.workspaceId,
    aggregateRevision: record.revision, causationId: identityKey, correlationId: requestId,
    idempotencyKey: requestId, actor, occurredAt,
    payload: { record },
  };
}

async function restoreAutoCapture(records: GoalRecordTransactionPort,
  receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>,
  expected: { identityKey: string; projectId: string; workspaceId: string; idempotencyKey: string; actor: ActorRef }):
  Promise<{ status: 'restored'; value: ArchitectureAutoCaptureRecordV1 } | Rejection> {
  if (receipt.identityKey !== expected.identityKey) return unavailable('the idempotency receipt belongs to another identity');
  if (receipt.eventIds.length !== 1) return unavailable('the auto-capture receipt must reference exactly one event');
  const located = await records.eventAt(receipt.cursor);
  if (located.status !== 'ready') return mapStoreFailure(located);
  if (String(located.value.cursor) !== String(receipt.cursor)) return unavailable('eventAt returned a different cursor');
  const decoded = decodeArchitectureAutoCaptureEvent(located.value.event);
  if (decoded.status !== 'decoded') return unavailable('the original auto-capture event is corrupt: ' + decoded.reason);
  const event = decoded.value;
  if (event.eventId !== receipt.eventIds[0]) return unavailable('the receipt points at another event');
  if (event.projectId !== expected.projectId || event.workspaceId !== expected.workspaceId) {
    return unavailable('the original auto-capture event is outside the recovered scope');
  }
  if (event.idempotencyKey !== expected.idempotencyKey || !actorsAgree(event.actor, expected.actor)) {
    return unavailable('the original auto-capture event carries another identity');
  }
  return { status: 'restored', value: event.payload.record };
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createObservedArchitecture(deps: ObservedArchitectureDependencies): ObservedArchitecturePort {
  const { workspace, bodies, records, source } = deps;

  /** The one file-page sequence. It loads the frozen graph,
   * runs the caller's paging function, attaches the whole-capture language
   * coverage, and maps a bad cursor to `invalid`. Each public entry keeps its
   * own argument checks and passes only its own paging function. Decision 79:
   * an observation without a current file layer is rejected by the record
   * decoder, so there is no `not_captured` page. */
  async function readFilePage(ctx: CoreCallContext, captureRef: ObservedCaptureRef, cursor: string | null,
    page: (graph: FileGraphData) => FileGraphPageData): Promise<ReadResult<FileGraphPageV1>> {
    const loaded = await loadFileGraph(deps, ctx, captureRef);
    if (loaded.status !== 'ready') return asReadResult(loaded);
    try {
      // §10 item 6: pages project nodes explicitly; digest, byte size and
      // `indexed` never leave the record, and the page adds only `inventory`.
      const projected: FileGraphData = {
        nodes: loaded.value.pageNodes(),
        edges: loaded.value.edges,
      };
      return { status: 'ready', value: { captureRef, ...page(projected), languages: loaded.value.languages,
        inventory: loaded.value.inventory } };
    } catch (error) {
      if (error instanceof FileGraphCursorError) return invalid(error.message);
      throw error;
    }
  }

  async function captureSourceChanges(ctx: CoreCallContext, request: { input: { workspace: WorkspaceScope; mappings?: ArchitectureSourceMapping[]; previous?: PersistedSourceCaptureRef | null; requestSeq?: number }; meta: { requestId: string; expected: readonly VersionPin[] } }): Promise<WriteResult<PersistedSourceCaptureRef>> {
    // Ruling 2: before this call holds its own committed receipt, a throw or
    // rejection with the caller's signal set is a cancellation; after the
    // receipt the committed result (or the late restore's own failure/throw)
    // stands. No lost-reply recovery is added.
    let hasCommittedReceipt = false;
    // A throw after the capture must be judged when it is
    // caught, before the finally cleanup; the cleanup never rewrites it.
    let decidedBeforeCleanup = false;
    try {
    // Synchronous input isolation: a caller mutating the request after this call cannot change the capture.
    const owned = ownJsonInput(request, 'captureSourceChanges request');
    if (owned.status === 'invalid') return invalid(owned.reason);
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the observation was cancelled before admission');
    const body = owned.value as unknown as { input?: unknown; meta?: unknown };
    const rawInput = body.input;
    const rawMeta = body.meta;
    if (!isRecord(rawInput) || !isRecord(rawMeta)) return invalid('captureSourceChanges requires an input and meta object');
    const scope = readWorkspaceScope(rawInput['workspace']);
    if (scope === null) return invalid('captureSourceChanges requires a project/workspace scope');
    // Book ruling 6: `mappings` is OPTIONAL. An explicit value (including `[]`)
    // is validated now and kept exactly; an omitted one is resolved after the
    // idempotency replay from the ACTIVE catalog.
    const mappingsRaw = rawInput['mappings'];
    let callerMappings: ArchitectureSourceMapping[] | undefined;
    if (mappingsRaw !== undefined) {
      const parsedMappings = readMappings(mappingsRaw);
      if (parsedMappings === null) return invalid('captureSourceChanges mappings must be complete module/interface mappings');
      callerMappings = parsedMappings;
    }
    const requestSeqRaw = rawInput['requestSeq'];
    if (requestSeqRaw !== undefined && !safeInteger(requestSeqRaw)) {
      return invalid('captureSourceChanges requestSeq must be a safe non-negative integer');
    }
    const explicitRequestSeq = requestSeqRaw === undefined ? null : requestSeqRaw as number;
    // Accepted suggestion "previous ref at start": `undefined` (omitted) is not
    // `null`; only the omitted case reads the pointer at capture entry.
    const previousRaw = rawInput['previous'];
    let callerPrevious: PersistedSourceCaptureRef | null | undefined;
    if (previousRaw !== undefined) {
      if (previousRaw === null) callerPrevious = null;
      else {
        const parsed = readPersistedSourceCaptureRef(previousRaw);
        if (parsed === null) return invalid('previous must be null or a complete persisted source capture ref');
        callerPrevious = parsed;
      }
    }
    const requestId = rawMeta['requestId'];
    if (!nonEmpty(requestId)) return invalid('captureSourceChanges requires meta.requestId');
    const bound = bindHostWriteContext(ctx, scope);
    if (bound.status !== 'ok') return bound;
    const pins = normalizeExpectedPins(scope, rawMeta['expected']);
    if (pins.status !== 'ok') return pins;

    const identityKey = CAPTURE_IDENTITY_PREFIX + commandIdentityKey({ projectId: scope.projectId, actor: bound.actor, idempotencyKey: requestId });
    // The fingerprint covers only caller-command facts (scope, the CALLER's mappings and previous, expected pins
    // and the explicit request sequence), never the trusted Host capture route or the mappings/previous the server
    // resolves: absent stays absent, so a replay and the first run share one fingerprint.
    const fingerprint = sha256Hex(canonicalJson({ schemaVersion: 1, commandType: 'CaptureObservedArchitecture',
      projectId: scope.projectId, workspaceId: scope.workspaceId,
      ...(callerMappings === undefined ? {} : { mappings: callerMappings }),
      ...(callerPrevious === undefined ? {} : { previous: callerPrevious }),
      requestSeq: explicitRequestSeq,
      expected: pins.pins } as unknown as JsonValue));
    const expected = { identityKey, projectId: scope.projectId, workspaceId: scope.workspaceId, idempotencyKey: requestId, actor: bound.actor };

    const early = await records.lookupCommit({ identityKey, fingerprint });
    // Ruling 5: an early replay only looks up and restores an earlier commit;
    // after each await the caller's signal wins and the earlier commit is
    // untouched. The normal commit boundary below is unchanged.
    if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled before replay');
    if (early.status === 'ready') {
      const restored = await restoreObservedCapture(records, early.value, expected);
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled before replay');
      if (restored.status !== 'restored') return restored;
      return { status: 'committed', value: restored.value, replayed: true, cursor: early.value.cursor };
    }
    if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
    if (early.code !== 'not_found') return unavailable(early.code + ': ' + early.reason);
    if (source.provider !== 'typescript' || (source.configPath !== null && typeof source.configPath !== 'string')) return rejected('unsupported', 'the configured architecture source provider is not installed');
    if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled before capture');

    // Book ruling 6: the ONE mapping rule. Without an active catalog the module
    // layer is `[]` (file layer only); a service built without the catalog
    // dependency rejects an omitted `mappings` instead of silently using `[]`.
    let mappings: ArchitectureSourceMapping[];
    if (callerMappings !== undefined) mappings = callerMappings;
    else if (deps.catalog === undefined) {
      return rejected('unsupported', 'captureSourceChanges without mappings requires the architecture catalog');
    } else {
      const revision = await deps.catalog.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      if (revision.status === 'not_found') mappings = [];
      else if (revision.status === 'ready') {
        mappings = moduleMappingsOf(revision.value.catalog.catalog);
      } else if (revision.status === 'rejected') return revision;
      else return unavailable('the active architecture catalog revision is not readable');
    }

    // Ruling 3: fix the start watermark at ENTRY, before the capture runs. The
    // driver supplies its start-snapshot requestSeq; a manual capture reads the
    // request record once; without a record the watermark is 0.
    let startWatermark = explicitRequestSeq;
    if (startWatermark === null) {
      const request = await readAutoCaptureRecord(records, scope);
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      if (request.status !== 'ready') return request;
      startWatermark = request.value?.requestSeq ?? 0;
    }

    const canonical = await readCanonicalScope(records, scope);
    if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
    if (canonical.status !== 'ready') return canonical;
    const pinConflict = compareExpectedPins(scope, pins.pins, canonical.projectRevision, canonical.workspaceRevision);
    if (pinConflict !== null) return pinConflict;
    // Accepted suggestion "previous ref at start": the pointer is read once, and
    // the observation it names is loaded ONCE here (its persisted ref and files
    // are both reused below); `previous: null` never reads the pointer.
    let previous: PersistedSourceCaptureRef | null;
    let priorFiles: ExportedFile[] | null = null;
    if (callerPrevious !== undefined) previous = callerPrevious;
    else {
      const pointer = await readCurrentObservationPointer(records, scope);
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      if (pointer.status !== 'ready') return pointer;
      if (pointer.value === null) previous = null;
      else {
        const prior = await loadObservation(deps, ctx, { kind: 'observed', ref: pointer.value.observedRef });
        if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
        if (prior.status !== 'ready') return prior;
        previous = prior.value.persistedRef;
        priorFiles = prior.value.exportedFiles;
      }
    }
    if (priorFiles === null && previous !== null) {
      // The previous observation is a historical persisted read: it reuses the same Host-authorized
      // loader (current scope authorization, canonical ref/body digest/origin and per-path grants)
      // before any body is opened. It need not still be retained in this process.
      const prior = await loadObservation(deps, ctx, { kind: 'observed', capture: previous });
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      if (prior.status !== 'ready') return prior;
      priorFiles = prior.value.exportedFiles;
    }

    const captureRequest: CaptureSourceRequest = {
      workspace: { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId },
      workspaceRevision: canonical.workspaceRevision,
      provider: source.provider,
      ...(source.configPath === null ? {} : { configPath: source.configPath }),
    };
    const captured = await workspace.captureObservation(ctx, captureRequest);
    if (captured.status !== 'ready') {
      // A non-ready capture keeps today's precedence: cancellation first.
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      return mapWorkspaceFailure(captured);
    }
    const captureRef = captured.value.ref;
    try {
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      const verified = await workspace.verifyCapture(ctx, captureRef);
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      if (verified.status !== 'ready') return mapWorkspaceFailure(verified);
      const exported = await workspace.exportCapture(ctx, captureRef);
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      if (exported.status !== 'ready') return mapWorkspaceFailure(exported);
      // File layer: capture it before the module mapping so a project with no
      // TS/JS sources never calls `mapArchitectureSource` with an empty source set.
      // The persisted module-level body is still written first.
      const fileGraphResult = await workspace.captureFileGraph(ctx, { capture: captureRef });
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      if (fileGraphResult.status !== 'ready') return mapWorkspaceFailure(fileGraphResult);
      const fileGraph = fileGraphResult.value;
      const tsCoverage = fileGraph.languages.find(language => language.language === 'typescript');
      // §10 item 2: decide by the language status AND the sources the scan
      // actually walked (the capture's `indexedSourceCount`), never by the parsed
      // count. A walked file whose per-file parse failed is still a module source;
      // a failed/unsupported TS language or a zero-walked project keeps the
      // explicit empty module snapshot.
      const walkedSourceCount = exported.value.summary.coverage.indexedSourceCount;
      const mapped = mappings.length > 0 && tsCoverage?.edges === 'supported' && walkedSourceCount > 0
        ? await workspace.captureArchitectureSource(ctx, { capture: captureRef, mappings })
        : { status: 'ready' as const, value: emptyArchitectureSnapshot({ scope, capture: captureRef, mappings,
            configPath: exported.value.summary.coverage.projectConfiguration, commitHash: exported.value.summary.commitHash }) };
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      if (mapped.status !== 'ready') return mapWorkspaceFailure(mapped);

      // Body first: a failure after this point leaves an unreachable body, never a half-published observation.
      const exportedInputs = exported.value.files.filter(file => isProjectInputPath(file.path));
      let changes: CaptureSummary['changes'] = {
        added: [...exportedInputs.map(file => file.path)].sort((a, b) => a.localeCompare(b)), modified: [], deleted: [],
      };
      if (priorFiles !== null) changes = changeSet(priorFiles, exportedInputs);
      // §10 item 2: the v2 body carries only counts; per-file data lives in the
      // file layer and the module snapshot drops `indexedSources` and truncates
      // its unresolved lines.
      const summary: ObservedSummaryV2 = {
        // The capture's file count (every frozen file); the change counts below
        // stay the TS/JS/JSON export set, as before.
        files: exported.value.files.length,
        languages: fileGraph.languages.map(language => ({ language: language.language, files: language.files })),
        changes: { added: changes.added.length, modified: changes.modified.length, deleted: changes.deleted.length },
      };
      const observedAt = new Date().toISOString();
      const observedBody: ObservedArchitectureBodyV2 = {
        schemaVersion: 2, capture: captureRef, observedAt, summary,
        // §10 item 1: the observation mapper compacts before validation, so the
        // service stores exactly its result; there is no second compaction here.
        architecture: mapped.value,
      };
      const bodyJson = JSON.stringify(observedBody);
      const normalizedFileGraph = normalizeFileGraph(fileGraph);
      // Publish only a body the strict reader would accept: a mapping/config that the frozen files
      // do not cover must fail here, not become an unreadable observation. The v2 member check reads
      // the same node table the chunks will carry.
      const bodyCheck = decodeObservedArchitectureBody(bodyJson, normalizedFileGraph.nodes);
      if (bodyCheck.status !== 'decoded') return invalid('the assembled observation body is not self-consistent: ' + bodyCheck.reason);
      if (artifactBodySize(bodyJson) > ARTIFACT_MAX_SIZE_BYTES) return rejected('capacity', 'the observed architecture body exceeds the artifact capacity');
      // Build and check every chunk BEFORE the first put: one item that cannot fit
      // alone with its envelope is capacity, and any chunk the decoder would
      // reject fails the whole capture here instead of being committed unreadable.
      let chunkBodies: string[];
      try {
        chunkBodies = serializeFileGraphChunks(normalizedFileGraph, scope,
          deps.fileGraph?.chunkBytes ?? ARTIFACT_MAX_SIZE_BYTES);
      } catch (error) {
        if (error instanceof FileGraphChunkCapacityError) return rejected('capacity', error.message);
        throw error;
      }
      if (chunkBodies.length > 64) return rejected('capacity', 'the file graph needs ' + chunkBodies.length + ' chunks; the limit is 64');
      for (const chunkBody of chunkBodies) {
        const chunkCheck = validateObservedFileGraphChunkV2(JSON.parse(chunkBody), scope, normalizedFileGraph.nodes.length);
        if (chunkCheck.status !== 'decoded') {
          return invalid('the assembled file graph chunk is not self-consistent: ' + chunkCheck.reason);
        }
      }
      const sourceRef: SourceRefV1 = { kind: 'workspace', refId: scope.workspaceId, revision: String(canonical.workspaceRevision), digest: captureRef.sourceDigest };
      const put = await bodies.put({ body: bodyJson, contentType: OBSERVED_ARCHITECTURE_BODY_CONTENT_TYPE,
        sourceRefs: [sourceRef], origin: { kind: 'platform_operation', projectId: scope.projectId, workspaceId: scope.workspaceId, requestId, actor: bound.actor }, requestedAt: observedAt });
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      if (put.status !== 'ready') return mapBodyPutFailure(put);
      const persistedRef: PersistedSourceCaptureRef = { capture: captureRef, material: put.value.ref };

      // File layer: one artifact per chunk, same sourceRefs/origin/requestedAt as
      // the module body. All chunks are published before the second verification so
      // a moved source leaves only unreachable bodies, never a published pointer.
      const chunkRefs: ObservedFileGraphManifestV2['chunks'] = [];
      for (const chunkBody of chunkBodies) {
        const chunkPut = await bodies.put({ body: chunkBody, contentType: FILE_GRAPH_CHUNK_CONTENT_TYPE,
          sourceRefs: [sourceRef], origin: { kind: 'platform_operation', projectId: scope.projectId, workspaceId: scope.workspaceId, requestId, actor: bound.actor }, requestedAt: observedAt });
        if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
        if (chunkPut.status !== 'ready') return mapBodyPutFailure(chunkPut);
        chunkRefs.push(chunkPut.value.ref);
      }
      const fileGraphManifest: ObservedFileGraphManifestV2 = {
        schemaVersion: 2, chunks: chunkRefs, nodeCount: normalizedFileGraph.nodes.length,
        edgeCount: normalizedFileGraph.edges.length, unresolvedCount: normalizedFileGraph.unresolved.length,
      };

      // A second live verification: if the source moved after the immutable body was saved, do not publish the pointer.
      const recheck = await workspace.verifyCapture(ctx, captureRef);
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      if (recheck.status !== 'ready') return mapWorkspaceFailure(recheck);

      const observedRef: ObservedArchitectureRef = { aggregateType: 'ObservedArchitecture', projectId: scope.projectId,
        workspaceId: scope.workspaceId, captureId: captureRef.captureId };
      const observedRecord: ObservedArchitectureRecord = { ref: observedRef, revision: 1, schemaVersion: 1, source: persistedRef,
        observedAt, fileGraph: fileGraphManifest, languages: fileGraph.languages,
        inventory: fileGraph.inventory };
      const currentRef: WorkspaceArchitectureObservationCurrentRef = { aggregateType: 'WorkspaceArchitectureObservationCurrent',
        projectId: scope.projectId, workspaceId: scope.workspaceId };
      const currentRead = await records.readMany([canonicalOf(currentRef)]);
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled');
      if (currentRead.status !== 'ready') return mapStoreFailure(currentRead);
      const currentEncoded = currentRead.value.records.find(record => record.refKey === canonicalOf(currentRef));
      let currentRevision: number | null = null;
      let currentObservedRef: ObservedArchitectureRef | null = null;
      let currentSatisfiedRequestSeq = 0;
      if (currentEncoded !== undefined) {
        const decoded = decodeObservationCurrent(currentEncoded);
        if (decoded.status !== 'decoded') return unavailable('the current observation pointer is damaged');
        currentRevision = decoded.value.revision;
        currentObservedRef = decoded.value.observedRef;
        currentSatisfiedRequestSeq = decoded.value.satisfiedRequestSeq;
      }
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled before commit');
      // Rulings 3 and 7: the pointer also records the observation it replaces and
      // the highest start watermark it satisfies. `max` keeps a manual capture that
      // started earlier and commits later from lowering a newer automatic one.
      const nextCurrent: WorkspaceArchitectureObservationCurrentRecord = { ref: currentRef,
        revision: (currentRevision ?? 0) + 1, schemaVersion: 1, observedRef,
        previousObservedRef: currentObservedRef,
        satisfiedRequestSeq: Math.max(currentSatisfiedRequestSeq, startWatermark) };
      const guards: RecordGuard[] = [
        { refKey: canonicalRefKey(projectRefFor(scope.projectId)), expectedRevision: canonical.projectRevision },
        { refKey: canonicalRefKey(workspaceRefFor(scope.projectId, scope.workspaceId)), expectedRevision: canonical.workspaceRevision },
        { refKey: canonicalOf(observedRef), expectedRevision: null },
        { refKey: canonicalOf(currentRef), expectedRevision: currentRevision },
      ];
      const event: ArchitectureSourceObservedEventV1 = {
        eventId: randomUUID(), eventType: ARCHITECTURE_SOURCE_OBSERVED_EVENT, schemaVersion: 1,
        projectId: scope.projectId, workspaceId: scope.workspaceId, aggregateType: 'ObservedArchitecture',
        aggregateId: captureRef.captureId, aggregateRevision: 1, causationId: identityKey, correlationId: requestId,
        idempotencyKey: requestId, actor: bound.actor, occurredAt: observedAt, payload: { source: persistedRef, observedAt },
      };
      const committed = await records.commit({ identityKey, fingerprint, guards,
        records: [encodeObservedArchitecture(observedRecord), encodeObservationCurrent(nextCurrent)], claims: [],
        indexGuards: [], indexChanges: [], events: [encodeArchitectureSourceObservedEvent(event)] });
      if (committed.status !== 'committed') {
        // Ruling 2: a commit that did not commit, with the signal set by then,
        // is a cancellation (no retry exists here); otherwise today's mapping.
        if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled before the commit completed');
        return mapStoreFailure(committed);
      }
      hasCommittedReceipt = true;
      if (!committed.replayed) return { status: 'committed', value: persistedRef, replayed: false, cursor: committed.cursor };
      const restored = await restoreObservedCapture(records, committed, expected);
      if (restored.status !== 'restored') return restored;
      return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
    } catch (error) {
      // Decide cancelled versus the throw HERE, when it is
      // caught, before the cleanup runs; the cleanup cannot change the result.
      decidedBeforeCleanup = true;
      if (!hasCommittedReceipt && ctx?.signal?.aborted) return rejected('cancelled', 'the observation was cancelled');
      throw error;
    } finally {
      // Release the temporary capture on every outcome after publication; the durable observation is the body.
      await releaseCaptureQuietly(workspace, ctx, captureRef);
    }
    } catch (error) {
      if (!decidedBeforeCleanup && !hasCommittedReceipt && ctx?.signal?.aborted) return rejected('cancelled', 'the observation was cancelled');
      throw error;
    }
  }

  async function requestAutoCapture(ctx: CoreCallContext, request: { input: { workspace: WorkspaceScope; trigger: AutoCaptureTriggerV1; requestedAt: string }; meta: { requestId: string; expected: readonly VersionPin[] } }): Promise<WriteResult<ArchitectureAutoCaptureRecordV1>> {
    // Ruling 2: a throw/rejection before this call holds its own committed
    // receipt is cancelled when the caller's signal is set; after the receipt
    // the committed result stands.
    let hasCommittedReceipt = false;
    try {
    const owned = ownJsonInput(request, 'requestAutoCapture request');
    if (owned.status === 'invalid') return invalid(owned.reason);
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the auto-capture request was cancelled before admission');
    const body = owned.value as unknown as { input?: unknown; meta?: unknown };
    if (!isRecord(body.input) || !isRecord(body.meta)) return invalid('requestAutoCapture requires an input and meta object');
    const scope = readWorkspaceScope(body.input['workspace']);
    if (scope === null) return invalid('requestAutoCapture requires a project/workspace scope');
    const trigger = body.input['trigger'];
    if (!isAutoCaptureTrigger(trigger)) return invalid('requestAutoCapture requires a known trigger');
    const requestedAt = body.input['requestedAt'];
    if (!nonEmpty(requestedAt)) return invalid('requestAutoCapture requires a non-empty requestedAt');
    const requestId = body.meta['requestId'];
    if (!nonEmpty(requestId)) return invalid('requestAutoCapture requires meta.requestId');
    const bound = bindHostWriteContext(ctx, scope);
    if (bound.status !== 'ok') return bound;

    const identityKey = AUTO_CAPTURE_REQUEST_IDENTITY_PREFIX
      + commandIdentityKey({ projectId: scope.projectId, actor: bound.actor, idempotencyKey: requestId });
    const fingerprint = sha256Hex(canonicalJson({ schemaVersion: 1, commandType: 'RequestArchitectureAutoCapture',
      projectId: scope.projectId, workspaceId: scope.workspaceId, trigger, requestedAt } as unknown as JsonValue));
    const expected = { identityKey, projectId: scope.projectId, workspaceId: scope.workspaceId,
      idempotencyKey: requestId, actor: bound.actor };
    const early = await records.lookupCommit({ identityKey, fingerprint });
    // Ruling 5: after every await the caller's signal wins unless this call's
    // own commit has already completed. An early replay only looks up and
    // restores an earlier commit, so it must not report that commit after a
    // cancellation; the earlier commit itself is untouched.
    if (ctx.signal.aborted) return rejected('cancelled', 'the auto-capture request was cancelled');
    if (early.status === 'ready') {
      const restored = await restoreAutoCapture(records, early.value, expected);
      if (ctx.signal.aborted) return rejected('cancelled', 'the auto-capture request was cancelled');
      if (restored.status !== 'restored') return restored;
      return { status: 'committed', value: restored.value, replayed: true, cursor: early.value.cursor };
    }
    if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
    if (early.code !== 'not_found') return unavailable(early.code + ': ' + early.reason);

    // Ruling 3: read the current record once per attempt, build the next request
    // from it, and guard that exact revision. A conflict means another writer
    // accepted a newer request first, so re-read and retry a few times.
    let conflict: Rejection | null = null;
    for (let attempt = 0; attempt < AUTO_CAPTURE_REQUEST_ATTEMPTS; attempt += 1) {
      const current = await readAutoCaptureRecord(records, scope);
      if (ctx.signal.aborted) return rejected('cancelled', 'the auto-capture request was cancelled');
      if (current.status !== 'ready') return current;
      const record = newArchitectureCaptureRequestRecord({ current: current.value, workspace: scope, trigger, requestedAt });
      const guards: RecordGuard[] = [{ refKey: canonicalOf(record.ref), expectedRevision: current.value?.revision ?? null }];
      // Ruling 3: a requested event happens at the caller's requested time; a
      // failed one at the real time the failure is written (the record keeps
      // the original `requestedAt`).
      const event = makeAutoCaptureEvent(ARCHITECTURE_AUTO_CAPTURE_REQUESTED_EVENT, record, record.requestedAt,
        requestId, identityKey, bound.actor);
      // Ruling 5: the signal is checked immediately before the commit starts;
      // a commit that already completed keeps its committed result.
      if (ctx.signal.aborted) return rejected('cancelled', 'the auto-capture request was cancelled');
      const committed = await records.commit({ identityKey, fingerprint, guards,
        records: [encodeArchitectureAutoCapture(record)], claims: [], indexGuards: [], indexChanges: [],
        events: [encodeArchitectureAutoCaptureEvent(event)] });
      if (committed.status === 'committed') {
        hasCommittedReceipt = true;
        if (!committed.replayed) return { status: 'committed', value: record, replayed: false, cursor: committed.cursor };
        const restored = await restoreAutoCapture(records, committed, expected);
        if (restored.status !== 'restored') return restored;
        return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
      }
      // Ruling 2: a commit that did not commit, with the signal set by then,
      // is a cancellation with NO conflict retry; otherwise today's mapping
      // and bounded retry stay.
      if (ctx.signal.aborted) return rejected('cancelled', 'the auto-capture request was cancelled');
      if (committed.code !== 'revision_conflict') return mapStoreFailure(committed);
      conflict = rejected('revision_conflict', committed.reason);
    }
    return conflict ?? unavailable('the auto-capture request did not commit');
    } catch (error) {
      if (!hasCommittedReceipt && ctx?.signal?.aborted) return rejected('cancelled', 'the auto-capture request was cancelled');
      throw error;
    }
  }

  async function failAutoCapture(ctx: CoreCallContext, request: { input: { workspace: WorkspaceScope; expectedRevision: number; failure: ArchitectureAutoCaptureFailureV1 }; meta: { requestId: string; expected: readonly VersionPin[] } }): Promise<WriteResult<ArchitectureAutoCaptureRecordV1>> {
    // Ruling 2: a throw/rejection before this call holds its own committed
    // receipt is cancelled when the caller's signal is set; after the receipt
    // the committed result stands.
    let hasCommittedReceipt = false;
    try {
    const owned = ownJsonInput(request, 'failAutoCapture request');
    if (owned.status === 'invalid') return invalid(owned.reason);
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the auto-capture failure write was cancelled before admission');
    const body = owned.value as unknown as { input?: unknown; meta?: unknown };
    if (!isRecord(body.input) || !isRecord(body.meta)) return invalid('failAutoCapture requires an input and meta object');
    const scope = readWorkspaceScope(body.input['workspace']);
    if (scope === null) return invalid('failAutoCapture requires a project/workspace scope');
    const expectedRevision = body.input['expectedRevision'];
    if (!safeInteger(expectedRevision)) return invalid('failAutoCapture requires a safe non-negative expectedRevision');
    const failure = readAutoCaptureFailure(body.input['failure']);
    if (failure === null) return invalid('failAutoCapture requires a {code, reason} failure');
    const requestId = body.meta['requestId'];
    if (!nonEmpty(requestId)) return invalid('failAutoCapture requires meta.requestId');
    const bound = bindHostWriteContext(ctx, scope);
    if (bound.status !== 'ok') return bound;

    const identityKey = AUTO_CAPTURE_FAILED_IDENTITY_PREFIX
      + commandIdentityKey({ projectId: scope.projectId, actor: bound.actor, idempotencyKey: requestId });
    const fingerprint = sha256Hex(canonicalJson({ schemaVersion: 1, commandType: 'FailArchitectureAutoCapture',
      projectId: scope.projectId, workspaceId: scope.workspaceId, expectedRevision, failure } as unknown as JsonValue));
    const expected = { identityKey, projectId: scope.projectId, workspaceId: scope.workspaceId,
      idempotencyKey: requestId, actor: bound.actor };
    const early = await records.lookupCommit({ identityKey, fingerprint });
    // Ruling 4 + 5: the failure write belongs to the running round. After each
    // await its signal wins; an early replay that only restores an earlier
    // failed commit must not report it after a cancellation, and the earlier
    // commit is untouched.
    if (ctx.signal.aborted) return rejected('cancelled', 'the auto-capture failure write was cancelled');
    if (early.status === 'ready') {
      const restored = await restoreAutoCapture(records, early.value, expected);
      if (ctx.signal.aborted) return rejected('cancelled', 'the auto-capture failure write was cancelled');
      if (restored.status !== 'restored') return restored;
      return { status: 'committed', value: restored.value, replayed: true, cursor: early.value.cursor };
    }
    if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
    if (early.code !== 'not_found') return unavailable(early.code + ': ' + early.reason);

    // Ruling 3: the start snapshot is read once here; a stale guard revision
    // returns a conflict and writes NOTHING - it never re-reads and forces
    // `failed` over a newer request.
    const snapshot = await readAutoCaptureRecord(records, scope);
    if (ctx.signal.aborted) return rejected('cancelled', 'the auto-capture failure write was cancelled');
    if (snapshot.status !== 'ready') return snapshot;
    if (snapshot.value === null) return rejected('not_found', 'the auto-capture request record does not exist');
    if (snapshot.value.revision !== expectedRevision) {
      return rejected('revision_conflict', 'the auto-capture request record revision has changed');
    }
    const record = newArchitectureCaptureFailureRecord({ current: snapshot.value, failure });
    // Lead ruling: the `failed` event's occurredAt is the REAL time the failure
    // is written; only the event carries it (the record keeps `requestedAt`).
    const event = makeAutoCaptureEvent(ARCHITECTURE_AUTO_CAPTURE_FAILED_EVENT, record, new Date().toISOString(),
      requestId, identityKey, bound.actor);
    // Ruling 5: check immediately before the commit starts; a commit that has
    // already completed keeps its committed result.
    if (ctx.signal.aborted) return rejected('cancelled', 'the auto-capture failure write was cancelled');
    const committed = await records.commit({ identityKey, fingerprint,
      guards: [{ refKey: canonicalOf(record.ref), expectedRevision }],
      records: [encodeArchitectureAutoCapture(record)], claims: [], indexGuards: [], indexChanges: [],
      events: [encodeArchitectureAutoCaptureEvent(event)] });
    if (committed.status !== 'committed') {
      // Ruling 2: a commit that did not commit, with the signal set by then,
      // is a cancellation; otherwise today's mapping stays.
      if (ctx.signal.aborted) return rejected('cancelled', 'the auto-capture failure write was cancelled');
      return mapStoreFailure(committed);
    }
    hasCommittedReceipt = true;
    if (!committed.replayed) return { status: 'committed', value: record, replayed: false, cursor: committed.cursor };
    const restored = await restoreAutoCapture(records, committed, expected);
    if (restored.status !== 'restored') return restored;
    return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
    } catch (error) {
      if (!hasCommittedReceipt && ctx?.signal?.aborted) return rejected('cancelled', 'the auto-capture failure write was cancelled');
      throw error;
    }
  }

  async function readAutoCapture(ctx: CoreCallContext, input: { workspace: WorkspaceScope }): Promise<ReadResult<ArchitectureAutoCaptureRecordV1 | null>> {
    // Ruling 3: a read that throws/rejects while the caller's signal is set is
    // a cancellation; the ready return is also checked again below.
    try {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the auto-capture read was cancelled');
    const owned = ownJsonInput(input, 'readAutoCapture input');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const raw = owned.value as unknown as Record<string, unknown>;
    const scope = readWorkspaceScope(raw['workspace']);
    if (scope === null) return invalid('readAutoCapture requires a project/workspace scope');
    const problem = ctxScopeProblem(ctx, scope);
    if (problem !== null) return problem;
    const read = await readAutoCaptureRecord(records, scope);
    // Ruling 5: the read never reports `ready` after its await when the
    // caller's signal was set while it was in flight.
    if (ctx.signal.aborted) return rejected('cancelled', 'the auto-capture read was cancelled');
    return read;
    } catch (error) {
      if (ctx?.signal?.aborted) return rejected('cancelled', 'the auto-capture read was cancelled');
      throw error;
    }
  }

  async function observationState(ctx: CoreCallContext, input: { workspace: WorkspaceScope }): Promise<ReadResult<ArchitectureObservationStateV1>> {
    // Ruling 3: a read that throws/rejects while the caller's signal is set is
    // a cancellation; the ready return is also checked again below.
    try {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the observation-state read was cancelled');
    const owned = ownJsonInput(input, 'observationState input');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const raw = owned.value as unknown as Record<string, unknown>;
    const scope = readWorkspaceScope(raw['workspace']);
    if (scope === null) return invalid('observationState requires a project/workspace scope');
    const problem = ctxScopeProblem(ctx, scope);
    if (problem !== null) return problem;
    // Ruling 8 + accepted "persisted ref" suggestion: pointer (one read) + the
    // current observation record for `observedAt`/`persistedRef` (one, no extra
    // read for the ref) + the request record (one, inside the shared basis).
    // `previousPersistedRef` needs its own observation record read, and only
    // when the pointer actually has a previous observation.
    const basis = await readObservationStateBasis(records, scope);
    // Ruling 5: after the basis read the caller's signal wins over ready.
    if (ctx.signal.aborted) return rejected('cancelled', 'the observation-state read was cancelled');
    if (basis.status !== 'ready') return basis;
    let current: { observedAt: string; persistedRef: PersistedSourceCaptureRef } | null = null;
    let previousPersistedRef: PersistedSourceCaptureRef | null = null;
    if (basis.value.pointer !== null) {
      const observed = await readObservationRecord(records, basis.value.pointer.observedRef);
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation-state read was cancelled');
      if (observed.status !== 'ready') return observed;
      current = { observedAt: observed.value.observedAt, persistedRef: observed.value.source };
      if (basis.value.pointer.previousObservedRef !== null) {
        const prior = await readObservationRecord(records, basis.value.pointer.previousObservedRef);
        if (ctx.signal.aborted) return rejected('cancelled', 'the observation-state read was cancelled');
        if (prior.status !== 'ready') return prior;
        previousPersistedRef = prior.value.source;
      }
    }
    // Ruling 5: also check immediately before the ready return.
    if (ctx.signal.aborted) return rejected('cancelled', 'the observation-state read was cancelled');
    return { status: 'ready', value: observationStateOf(basis.value, current, previousPersistedRef) };
    } catch (error) {
      if (ctx?.signal?.aborted) return rejected('cancelled', 'the observation-state read was cancelled');
      throw error;
    }
  }

  async function readReminderFacts(ctx: CoreCallContext, input: { workspace: WorkspaceScope; catalog: AdoptedArchitecture | null }): Promise<ReadResult<ArchitectureReminderFactsV1>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the architecture-reminder read was cancelled');
    const owned = ownJsonInput(input, 'readReminderFacts input');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const raw = owned.value as unknown as Record<string, unknown>;
    const scope = readWorkspaceScope(raw['workspace']);
    if (scope === null) return invalid('readReminderFacts requires a project/workspace scope');
    const catalogRaw = raw['catalog'];
    if (catalogRaw !== null && (!isRecord(catalogRaw) || !Array.isArray(catalogRaw['modules'])
      || !Array.isArray(catalogRaw['dependencies']))) {
      return invalid('readReminderFacts catalog must be null or an adopted catalog');
    }
    const catalog = catalogRaw as AdoptedArchitecture | null;
    const problem = ctxScopeProblem(ctx, scope);
    if (problem !== null) return problem;

    // Ruling 12: the pointer and the request record once, then each observation
    // ONCE through `loadObservation` (which already includes the chunk graph);
    // the comparison and the moves share that one latest graph.
    const basis = await readObservationStateBasis(records, scope);
    // Ruling 5: after every await the caller's signal wins over `ready`, and a
    // cancellation must not degrade into the reminder fallback.
    if (ctx.signal.aborted) return rejected('cancelled', 'the architecture-reminder read was cancelled');
    if (basis.status !== 'ready') return basis;
    const { pointer } = basis.value;
    let latest: ArchitectureReminderFactsV1['latest'] = null;
    let latestGraph: LoadedFileGraph | null = null;
    let current: { observedAt: string; persistedRef: PersistedSourceCaptureRef } | null = null;
    if (pointer !== null) {
      const loaded = await loadObservation(deps, ctx, { kind: 'observed', ref: pointer.observedRef });
      if (ctx.signal.aborted) return rejected('cancelled', 'the architecture-reminder read was cancelled');
      if (loaded.status !== 'ready') return loaded;
      latest = { observedAt: loaded.value.body.observedAt,
        nodes: loaded.value.fileGraph.nodes.map(node => ({ path: node.path, digest: node.digest })) };
      latestGraph = loaded.value.fileGraph;
      // The persisted ref comes from the record this load already read.
      current = { observedAt: loaded.value.body.observedAt, persistedRef: loaded.value.persistedRef };
    }
    let previous: ArchitectureReminderFactsV1['previous'] = null;
    let previousPersistedRef: PersistedSourceCaptureRef | null = null;
    if (pointer !== null && pointer.previousObservedRef !== null) {
      const loaded = await loadObservation(deps, ctx, { kind: 'observed', ref: pointer.previousObservedRef });
      if (ctx.signal.aborted) return rejected('cancelled', 'the architecture-reminder read was cancelled');
      if (loaded.status !== 'ready') return loaded;
      previous = { observedAt: loaded.value.body.observedAt,
        nodes: loaded.value.fileGraph.nodes.map(node => ({ path: node.path, digest: node.digest })) };
      previousPersistedRef = loaded.value.persistedRef;
    }
    const findings = catalog === null || latestGraph === null ? [] : compareFormalObservedGraphs({
      architecture: catalog,
      fileGraph: { nodes: latestGraph.nodes, edges: latestGraph.edges, unresolved: latestGraph.unresolved,
        languages: latestGraph.languages, complete: latestGraph.complete, inventory: latestGraph.inventory },
    });
    // Ruling 5: also check immediately before the ready return.
    if (ctx.signal.aborted) return rejected('cancelled', 'the architecture-reminder read was cancelled');
    return { status: 'ready', value: {
      state: observationStateOf(basis.value, current, previousPersistedRef), catalog, latest, previous, findings,
    } };
  }

  async function queryArchitecture(ctx: CoreCallContext, input: {
    selection: ObservedArchitectureSelection; anchor?: ObservedGraphAnchor;
    depth: number; relations: ('dependency' | 'interface')[]; page: ObservedGraphPageRequest;
  }): Promise<ReadResult<ObservedArchitectureNeighborhood>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the architecture query was cancelled');
    const owned = ownJsonInput(input, 'queryArchitecture input');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const raw = owned.value as unknown as Record<string, unknown>;
    const unsupported = unsupportedSelection(raw['selection']);
    if (unsupported !== null) return rejected('unsupported', unsupported);
    const selection = readSelection(raw['selection']);
    if (selection === null) return invalid('queryArchitecture requires an observed selection');
    const depth = raw['depth'];
    if (!safeInteger(depth)) return invalid('queryArchitecture depth must be a safe non-negative integer');
    const relations = readRelations(raw['relations']);
    if (relations === null) return invalid('queryArchitecture relations must be dependency/interface entries');
    const page = readPage(raw['page']);
    if (page === null) return invalid('queryArchitecture requires a valid page request');
    const anchor = readAnchor(raw['anchor']);
    if (anchor === null) return invalid('queryArchitecture anchor must be a node or file anchor');
    const loaded = await loadObservation(deps, ctx, selection);
    if (loaded.status !== 'ready') return asReadResult(loaded);
    if (page.atLeastCursor !== undefined) {
      const comparison = compareSourceCursor(loaded.value.sourceCursor, page.atLeastCursor);
      if (comparison.status === 'not_ready') return comparison;
    }
    try {
      const value = buildObservedNeighborhood(loaded.value.body.architecture, selection, {
        ...(anchor === undefined ? {} : { anchor }), depth, relations, page, sourceCursor: loaded.value.sourceCursor,
      });
      return { status: 'ready', value };
    } catch (error) {
      if (error instanceof ObservedGraphCursorError) return invalid(error.message);
      throw error;
    }
  }

  async function compareArchitecture(ctx: CoreCallContext, input: {
    before: ObservedArchitectureSelection; after: ObservedArchitectureSelection;
  }): Promise<ReadResult<ObservedArchitectureComparison>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the architecture comparison was cancelled');
    const owned = ownJsonInput(input, 'compareArchitecture input');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const raw = owned.value as unknown as Record<string, unknown>;
    const unsupportedBefore = unsupportedSelection(raw['before']);
    if (unsupportedBefore !== null) return rejected('unsupported', unsupportedBefore);
    const unsupportedAfter = unsupportedSelection(raw['after']);
    if (unsupportedAfter !== null) return rejected('unsupported', unsupportedAfter);
    const before = readSelection(raw['before']);
    const after = readSelection(raw['after']);
    if (before === null || after === null) return invalid('compareArchitecture requires two observed selections');
    const loadedBefore = await loadObservation(deps, ctx, before);
    if (loadedBefore.status !== 'ready') return asReadResult(loadedBefore);
    const loadedAfter = await loadObservation(deps, ctx, after);
    if (loadedAfter.status !== 'ready') return asReadResult(loadedAfter);
    return { status: 'ready', value: compareObservedGraphs(loadedBefore.value.body.architecture, loadedAfter.value.body.architecture, before, after) };
  }

  async function queryImpact(ctx: CoreCallContext, input: {
    selection: ObservedArchitectureSelection; changed: ObservedGraphAnchor[]; page: ObservedGraphPageRequest;
  }): Promise<ReadResult<ObservedArchitectureImpact>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the architecture impact query was cancelled');
    const owned = ownJsonInput(input, 'queryImpact input');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const raw = owned.value as unknown as Record<string, unknown>;
    const unsupported = unsupportedSelection(raw['selection']);
    if (unsupported !== null) return rejected('unsupported', unsupported);
    const selection = readSelection(raw['selection']);
    if (selection === null) return invalid('queryImpact requires an observed selection');
    const changedRaw = raw['changed'];
    if (!Array.isArray(changedRaw)) return invalid('queryImpact changed must be an array of anchors');
    const changed: ObservedGraphAnchor[] = [];
    for (const entry of changedRaw) {
      const anchor = readAnchor(entry);
      if (anchor === undefined || anchor === null) return invalid('queryImpact changed entries must be node or file anchors');
      changed.push(anchor);
    }
    const page = readPage(raw['page']);
    if (page === null) return invalid('queryImpact requires a valid page request');
    const loaded = await loadObservation(deps, ctx, selection);
    if (loaded.status !== 'ready') return asReadResult(loaded);
    if (page.atLeastCursor !== undefined) {
      const comparison = compareSourceCursor(loaded.value.sourceCursor, page.atLeastCursor);
      if (comparison.status === 'not_ready') return comparison;
    }
    try {
      return { status: 'ready', value: buildObservedImpact(loaded.value.body.architecture, selection, changed, page, loaded.value.sourceCursor) };
    } catch (error) {
      if (error instanceof ObservedGraphCursorError) return invalid(error.message);
      throw error;
    }
  }

  async function listFiles(ctx: CoreCallContext, input: { captureRef: ObservedCaptureRef; cursor: string | null }): Promise<ReadResult<FileGraphPageV1>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the file graph read was cancelled');
    const owned = ownJsonInput(input, 'listFiles input');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const raw = owned.value as unknown as Record<string, unknown>;
    const captureRef = readFileGraphCaptureRef(raw['captureRef']);
    if (captureRef === null) return invalid('listFiles requires an observed capture ref');
    const cursor = readFileGraphCursor(raw['cursor']);
    if (cursor === undefined) return invalid('listFiles cursor must be null or a non-empty string');
    return readFilePage(ctx, captureRef, cursor, loaded => listFilesPage(loaded, captureRef, cursor));
  }

  async function neighbors(ctx: CoreCallContext, input: {
    captureRef: ObservedCaptureRef; file: string; direction: 'out' | 'in'; limit: number; cursor: string | null;
  }): Promise<ReadResult<FileGraphPageV1>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the file graph read was cancelled');
    const owned = ownJsonInput(input, 'neighbors input');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const raw = owned.value as unknown as Record<string, unknown>;
    const captureRef = readFileGraphCaptureRef(raw['captureRef']);
    if (captureRef === null) return invalid('neighbors requires an observed capture ref');
    const file = raw['file'];
    if (!nonEmpty(file) || !safeRelativePath(file)) return invalid('neighbors requires a normalized workspace-relative file path');
    const direction = raw['direction'];
    if (direction !== 'out' && direction !== 'in') return invalid('neighbors direction must be out or in');
    const limit = raw['limit'];
    if (!safeInteger(limit) || limit < 1) return invalid('neighbors limit must be a positive integer');
    const cursor = readFileGraphCursor(raw['cursor']);
    if (cursor === undefined) return invalid('neighbors cursor must be null or a non-empty string');
    return readFilePage(ctx, captureRef, cursor,
      loaded => neighborsPage(loaded, captureRef, file, direction, Math.min(limit, FILE_GRAPH_PAGE_SIZE), cursor));
  }

  async function impact(ctx: CoreCallContext, input: {
    captureRef: ObservedCaptureRef; file: string; depth: number; limit: number; cursor: string | null;
  }): Promise<ReadResult<FileGraphPageV1>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the file graph read was cancelled');
    const owned = ownJsonInput(input, 'impact input');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const raw = owned.value as unknown as Record<string, unknown>;
    const captureRef = readFileGraphCaptureRef(raw['captureRef']);
    if (captureRef === null) return invalid('impact requires an observed capture ref');
    const file = raw['file'];
    if (!nonEmpty(file) || !safeRelativePath(file)) return invalid('impact requires a normalized workspace-relative file path');
    const depth = raw['depth'];
    if (!safeInteger(depth)) return invalid('impact depth must be a non-negative integer');
    if (depth > FILE_GRAPH_MAX_IMPACT_DEPTH) return invalid('impact depth must be at most ' + FILE_GRAPH_MAX_IMPACT_DEPTH);
    const limit = raw['limit'];
    if (!safeInteger(limit) || limit < 1) return invalid('impact limit must be a positive integer');
    const cursor = readFileGraphCursor(raw['cursor']);
    if (cursor === undefined) return invalid('impact cursor must be null or a non-empty string');
    return readFilePage(ctx, captureRef, cursor,
      loaded => impactPage(loaded, captureRef, file, depth, Math.min(limit, FILE_GRAPH_PAGE_SIZE), cursor));
  }

  async function compareFormalObserved(ctx: CoreCallContext, input: {
    catalog: ArchitectureCatalogPinV1; captureRef: ObservedCaptureRef;
  }): Promise<ReadResult<FormalObservedComparisonV1>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the formal-observed comparison was cancelled');
    const owned = ownJsonInput(input, 'compareFormalObserved input');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const raw = owned.value as unknown as Record<string, unknown>;
    const catalog = readCatalogPin(raw['catalog']);
    if (catalog === null) return invalid('compareFormalObserved requires a complete catalog pin');
    const captureRef = readFileGraphCaptureRef(raw['captureRef']);
    if (captureRef === null) return invalid('compareFormalObserved requires an observed capture ref');
    // Item 4: the pin and the call context must name the same project, and the
    // pin's catalog ref must link to its baseline ref, BEFORE any catalog read.
    if (ctx.projectId !== catalog.catalogRef.projectId) {
      return forbidden('the catalog pin is outside the call context project');
    }
    if (catalog.catalogRef.projectId !== catalog.baseline.ref.projectId
      || catalog.catalogRef.baselineId !== catalog.baseline.ref.baselineId
      || catalog.catalogRef.revision !== catalog.baseline.ref.revision) {
      return invalid('the catalog pin does not link its catalog ref to its baseline ref');
    }
    // Resolve the pin through the recorded baseline revision, never the raw ref:
    // a baseline with no record is `not_found`.
    const revision = await readRevisionByRef(records, catalog.baseline.ref);
    if (revision.status !== 'ready') return revision;
    if (revision.value.baseline.contentDigest !== catalog.baseline.digest) {
      return invalid('the catalog pin baseline digest does not match the recorded baseline revision');
    }
    const loaded = await loadFileGraph(deps, ctx, captureRef);
    if (loaded.status !== 'ready') return asReadResult(loaded);
    const fileGraph: ProjectFileGraphV1 = { nodes: loaded.value.nodes, edges: loaded.value.edges,
      unresolved: loaded.value.unresolved, languages: loaded.value.languages, complete: loaded.value.complete,
      inventory: loaded.value.inventory };
    const findings = compareFormalObservedGraphs({ architecture: revision.value.catalog.catalog, fileGraph });
    return { status: 'ready', value: { catalog, captureRef, findings, noVerdict: true } };
  }

  return { captureSourceChanges, requestAutoCapture, failAutoCapture, readAutoCapture, observationState,
    readReminderFacts, queryArchitecture, compareArchitecture, queryImpact,
    listFiles, neighbors, impact, compareFormalObserved };
}
