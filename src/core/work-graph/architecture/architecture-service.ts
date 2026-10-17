/**
 * R3d observed-architecture service — the WorkGraph owner of persisted source observation.
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
import type { ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import type { FileGraphNodeV1, FileGraphPageV1, FormalObservedComparisonV1, LanguageCoverageV1, ObservedCaptureRef } from '../../../contracts/architecture-inspection.js';
import type { ArchitectureSourceMapping, ArchitectureSourceSnapshotV1 } from '../../../contracts/architecture-source.js';
import { ARTIFACT_MAX_SIZE_BYTES, artifactBodyDigest, artifactBodySize } from '../../../contracts/artifact.js';
import { commandIdentityKey } from '../../../contracts/command-event.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreError, ReadResult, ReadStamp, WriteResult } from '../../../contracts/core/results.js';
import type { PersistedSourceCaptureRef, SourceCaptureRef } from '../../../contracts/core/source.js';
import type { SourceRefV1 } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { WorkspaceRef } from '../../../contracts/ledger.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, RecordGuard, StoreFailure } from '../../record-store/ports.js';
import type { WorkspaceAccessFactory, WorkspaceReadAccess } from '../../workspace/access.js';
import type { CaptureSourceRequest, CaptureSummary, WorkspaceError, WorkspaceResult, WorkspaceToolsPort } from '../../workspace/ports.js';
import type { ProjectFileGraphV1 } from '../../workspace/architecture-language-provider.js';
import { compareObservedGraphs } from './architecture-delta.js';
import {
  ARCHITECTURE_SOURCE_OBSERVED_EVENT, FILE_GRAPH_CHUNK_CONTENT_TYPE, OBSERVED_ARCHITECTURE_BODY_CONTENT_TYPE,
  decodeArchitectureSourceObservedEvent, decodeObservedArchitectureBody, decodeObservedFileGraphChunk,
  decodeObservationCurrent, decodeObservedArchitectureRecord, encodeArchitectureSourceObservedEvent,
  encodeObservationCurrent, encodeObservedArchitecture, readPersistedSourceCaptureRef,
  type ArchitectureSourceObservedEventV1, type ObservedArchitectureBodyV1,
} from './architecture-record-codecs.js';
import { readRevisionByRef } from './catalog-service.js';
import { compareFormalObservedGraphs } from './formal-comparison.js';
import { FileGraphCursorError, FILE_GRAPH_MAX_IMPACT_DEPTH, FILE_GRAPH_PAGE_SIZE, impactPage,
  listFilesPage, neighborsPage, type FileGraphPageData } from './file-graph-index.js';
import type { ObservedArchitectureComparison, ObservedArchitectureImpact, ObservedArchitectureNeighborhood,
  ObservedArchitecturePort, ObservedArchitectureRecord, ObservedArchitectureRef, ObservedArchitectureSelection,
  ObservedFileGraphManifestV1, ObservedGraphAnchor, ObservedGraphPageRequest, WorkspaceArchitectureObservationCurrentRecord,
  WorkspaceArchitectureObservationCurrentRef } from './contracts.js';
import { ObservedGraphCursorError, buildObservedImpact, buildObservedNeighborhood } from './graph-index.js';
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
   * 8A: `configPath: null` captures with no project configuration (a project with
   * no TS files, or a caller that wants the provider's default roots). */
  source: { provider: 'typescript'; configPath: string | null };
  /** Test injection for the file-graph chunk size; production uses
   * `ARTIFACT_MAX_SIZE_BYTES`. */
  fileGraph?: { chunkBytes?: number };
};

const MAX_PAGE = 2048;
const CAPTURE_IDENTITY_PREFIX = 'observed-architecture:';

type Rejection = { status: 'rejected'; code: CoreError; reason: string; current?: VersionPin[] };
type Owned<T> = { status: 'owned'; value: T } | { status: 'invalid'; reason: string };

function rejected(code: CoreError, reason: string): Rejection {
  return { status: 'rejected', code, reason };
}
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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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
function readMappings(value: unknown): ArchitectureSourceMapping[] | null {
  // An empty list is legal (task book item 8): a TS project without an adopted
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
/** Formal baseline selections belong to a later sub-batch; they must not silently read as an empty observed graph. */
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

/** The empty module-level snapshot for a project with no TS/JS sources (task book item 8).
 * `configPath` mirrors the capture's resolved configuration so the strict body reader accepts it. */
function emptyArchitectureSnapshot(input: { scope: WorkspaceScope; capture: SourceCaptureRef;
  mappings: ArchitectureSourceMapping[]; configPath: string | null; commitHash: string | null }): ArchitectureSourceSnapshotV1 {
  return {
    schemaVersion: 1, projectId: input.scope.projectId, workspaceId: input.scope.workspaceId,
    workspaceRevision: input.capture.workspaceRevision, sourceDigest: input.capture.sourceDigest,
    commitHash: input.commitHash, indexVersion: input.capture.indexVersion, configPath: input.configPath,
    mappings: input.mappings, indexedSources: [], nodes: [], edges: [], unresolved: [],
  };
}

/** Packs pre-serialized items into chunk bodies with a fixed prefix/suffix.
 * Each item is serialized once and only the running byte size is tracked, so the
 * whole builder is linear in the graph size (the previous version re-serialized
 * the growing array for every element, which is O(n^2) near the caps). */
function packFileGraphChunks<T>(prefix: string, suffix: string, serialized: readonly string[],
  cap: number, alwaysFlush: boolean): string[] {
  const chunks: string[] = [];
  const overhead = Buffer.byteLength(prefix, 'utf8') + Buffer.byteLength(suffix, 'utf8');
  let start = 0;
  let size = 0;
  for (let index = 0; index < serialized.length; index += 1) {
    const itemBytes = Buffer.byteLength(serialized[index]!, 'utf8');
    const addition = index === start ? itemBytes : 1 + itemBytes;
    if (index > start && overhead + size + addition > cap) {
      chunks.push(prefix + serialized.slice(start, index).join(',') + suffix);
      start = index;
      size = itemBytes;
    } else {
      size += addition;
    }
  }
  if (alwaysFlush || serialized.length > 0) {
    chunks.push(prefix + serialized.slice(start).join(',') + suffix);
  }
  return chunks;
}

/** One artifact per chunk: node chunks first (in path order) then edge chunks. */
function buildFileGraphChunks(graph: ProjectFileGraphV1, cap: number): string[] {
  const empty = JSON.stringify({ schemaVersion: 1, nodes: [] as unknown[], edges: [] as unknown[] });
  const nodesOpen = empty.indexOf('[]', empty.indexOf('"nodes"'));
  const edgeOpen = empty.indexOf('[]', empty.indexOf('"edges"'));
  const nodePrefix = empty.slice(0, nodesOpen + 1);
  const nodeSuffix = empty.slice(nodesOpen + 1);
  const edgePrefix = empty.slice(0, edgeOpen + 1);
  const edgeSuffix = empty.slice(edgeOpen + 1);
  return [
    ...packFileGraphChunks(nodePrefix, nodeSuffix, graph.nodes.map(node => JSON.stringify(node)), cap, true),
    ...packFileGraphChunks(edgePrefix, edgeSuffix, graph.edges.map(edge => JSON.stringify(edge)), cap, false),
  ];
}

function notCapturedPage(captureRef: ObservedCaptureRef): FileGraphPageV1 {
  return { captureRef, nodes: [], edges: [], nextCursor: null, complete: true, notCaptured: true, languages: [] };
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

type LoadedObservation = { body: ObservedArchitectureBodyV1; sourceCursor: CommitCursor };

async function loadObservation(deps: {
  access: WorkspaceAccessFactory; bodies: RawArtifactStorePort; records: GoalRecordTransactionPort;
}, ctx: CoreCallContext, selection: ObservedArchitectureSelection): Promise<{ status: 'ready'; value: LoadedObservation } | Rejection> {
  const capture = selection.capture;
  if (ctx.projectId !== capture.capture.projectId || ctx.workspaceId !== capture.capture.workspaceId) {
    return forbidden('the call context is outside the persisted observation workspace');
  }
  const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: capture.capture.projectId, workspaceId: capture.capture.workspaceId };
  const opened = await deps.access.open(ctx, workspaceRef);
  if (opened.status !== 'ready') return mapWorkspaceFailure(opened);
  const access: WorkspaceReadAccess = opened.value;
  try {
    const ref: ObservedArchitectureRef = { aggregateType: 'ObservedArchitecture', projectId: capture.capture.projectId, workspaceId: capture.capture.workspaceId, captureId: capture.capture.captureId };
    const refKey = canonicalOf(ref);
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    const encoded = read.value.records.find(record => record.refKey === refKey);
    if (encoded === undefined) return rejected('not_found', 'the persisted observation record does not exist');
    const decodedRecord = decodeObservedArchitectureRecord(encoded);
    if (decodedRecord.status !== 'decoded') return unavailable('the canonical observation record is damaged');
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
    // A record without `fileGraph` was written before 8A: its module membership
    // follows the legacy any-prefix rule, not the 8A longest-prefix rule.
    const ownership = decodedRecord.value.fileGraph === null ? 'legacy_any_prefix' : 'longest';
    const decodedBody = decodeObservedArchitectureBody(stored.body, ownership);
    if (decodedBody.status !== 'decoded') return unavailable('the stored observation body is damaged: ' + decodedBody.reason);
    const body = decodedBody.value;
    if (canonicalOf(body.capture) !== canonicalOf(capture.capture)) return unavailable('the stored body capture does not match the persisted reference');
    // Current path authorization is re-checked over the FROZEN paths before any graph is returned.
    // Current Host grants are re-checked over the REAL frozen files and the actual configuration
    // inputs only. A mapping's representative path may be a directory or a path that does not exist;
    // it is a display/grouping path, never an additional file permission.
    const paths = new Set<string>();
    for (const file of body.files) paths.add(file.path);
    if (body.architecture.configPath !== null) paths.add(body.architecture.configPath);
    if (body.summary.coverage.projectConfiguration !== null) paths.add(body.summary.coverage.projectConfiguration);
    for (const path of paths) if (!access.authorization.allowsRead(path)) return forbidden('the current Host grant does not cover the frozen source path ' + path);
    return { status: 'ready', value: { body, sourceCursor } };
  } finally {
    await access.release();
  }
}

// --------------------------------------------------------------------------
// 8A file-level load (record + chunk artifacts)
// --------------------------------------------------------------------------

type LoadedFileGraph = {
  nodes: FileGraphNodeV1[];
  edges: { from: string; to: string }[];
  unresolved: { from: string; specifier: string }[];
  languages: LanguageCoverageV1[];
  complete: boolean;
};

/** Loads the chunked file graph behind one observation record. A record with no
 * chunk list is `not_captured` (value null), never an empty captured graph. */
async function loadFileGraph(deps: {
  access: WorkspaceAccessFactory; bodies: RawArtifactStorePort; records: GoalRecordTransactionPort;
}, ctx: CoreCallContext, captureRef: ObservedCaptureRef): Promise<{ status: 'ready'; value: LoadedFileGraph | null } | Rejection> {
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
    const record = decoded.value;
    if (record.ref.projectId !== captureRef.projectId || record.ref.workspaceId !== captureRef.workspaceId
      || record.ref.captureId !== captureRef.captureId) {
      return invalid('the persisted reference does not match the canonical observation record');
    }
    const manifest = record.fileGraph ?? null;
    if (manifest === null) return { status: 'ready', value: null };
    const nodes: FileGraphNodeV1[] = [];
    const edges: { from: string; to: string }[] = [];
    for (const chunkRef of manifest.chunks) {
      const raw = await deps.bodies.read(chunkRef);
      if (raw.status !== 'ready') return raw.code === 'not_found' ? rejected('not_found', raw.reason) : unavailable(raw.reason);
      const stored = raw.value;
      if (canonicalOf(stored.ref) !== canonicalOf(chunkRef)) return unavailable('the stored chunk ref does not match the persisted chunk ref');
      if (stored.origin.kind !== 'platform_operation' || stored.origin.projectId !== captureRef.projectId
        || (stored.origin.workspaceId !== undefined && stored.origin.workspaceId !== captureRef.workspaceId)) {
        return unavailable('the stored chunk origin is not this workspace platform observation');
      }
      if (artifactBodyDigest(stored.body) !== chunkRef.digest || artifactBodySize(stored.body) !== chunkRef.sizeBytes) {
        return unavailable('the stored chunk digest does not match the persisted chunk ref');
      }
      const chunk = decodeObservedFileGraphChunk(stored.body);
      if (chunk.status !== 'decoded') return unavailable('the stored file graph chunk is damaged: ' + chunk.reason);
      nodes.push(...chunk.value.nodes);
      edges.push(...chunk.value.edges);
    }
    if (nodes.length !== manifest.nodeCount || edges.length !== manifest.edgeCount) {
      return unavailable('the stored file graph chunk counts disagree with the observation record');
    }
    const languages = record.languages ?? [];
    for (const node of nodes) if (!access.authorization.allowsRead(node.path)) {
      return forbidden('the current Host grant does not cover every frozen path of this observation');
    }
    // 8A rework 2 item 5: language coverage carries issue paths that are not node
    // paths (for example a skipped configuration or source file). The current
    // grant must cover them too, or the whole file page leaks them.
    for (const language of languages) for (const issue of language.issues) {
      if (!access.authorization.allowsRead(issue.path)) {
        return forbidden('the current Host grant does not cover every frozen path of this observation');
      }
    }
    return { status: 'ready', value: { nodes, edges, unresolved: manifest.unresolved,
      languages, complete: languages.every(language => language.complete) } };
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
// The service
// --------------------------------------------------------------------------

export function createObservedArchitecture(deps: ObservedArchitectureDependencies): ObservedArchitecturePort {
  const { workspace, access, bodies, records, source } = deps;

  /** 8A rework 2 item 6: the one file-page sequence. It loads the frozen graph,
   * maps an old observation (no graph) to `not_captured` or a cursor mismatch,
   * runs the caller's paging function, attaches the whole-capture language
   * coverage, and maps a bad cursor to `invalid`. Each public entry keeps its
   * own argument checks and passes only its own paging function. */
  async function readFilePage(ctx: CoreCallContext, captureRef: ObservedCaptureRef, cursor: string | null,
    page: (loaded: LoadedFileGraph) => FileGraphPageData): Promise<ReadResult<FileGraphPageV1>> {
    const loaded = await loadFileGraph(deps, ctx, captureRef);
    if (loaded.status !== 'ready') return asReadResult(loaded);
    if (loaded.value === null) {
      // Item 7: an old capture never issued a cursor, so a cursor here is a mismatch.
      if (cursor !== null) return invalid('cursor_mismatch');
      return { status: 'ready', value: notCapturedPage(captureRef) };
    }
    try {
      return { status: 'ready', value: { captureRef, ...page(loaded.value), languages: loaded.value.languages } };
    } catch (error) {
      if (error instanceof FileGraphCursorError) return invalid(error.message);
      throw error;
    }
  }

  async function captureSourceChanges(ctx: CoreCallContext, request: { input: { workspace: WorkspaceScope; mappings: ArchitectureSourceMapping[]; previous: PersistedSourceCaptureRef | null }; meta: { requestId: string; expected: readonly VersionPin[] } }): Promise<WriteResult<PersistedSourceCaptureRef>> {
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
    const mappings = readMappings(rawInput['mappings']);
    if (mappings === null) return invalid('captureSourceChanges requires explicit module/interface mappings');
    const previousRaw = rawInput['previous'];
    let previous: PersistedSourceCaptureRef | null = null;
    if (previousRaw !== null) {
      const parsed = readPersistedSourceCaptureRef(previousRaw);
      if (parsed === null) return invalid('previous must be null or a complete persisted source capture ref');
      previous = parsed;
    }
    const requestId = rawMeta['requestId'];
    if (!nonEmpty(requestId)) return invalid('captureSourceChanges requires meta.requestId');
    const bound = bindHostWriteContext(ctx, scope);
    if (bound.status !== 'ok') return bound;
    const pins = normalizeExpectedPins(scope, rawMeta['expected']);
    if (pins.status !== 'ok') return pins;

    const identityKey = CAPTURE_IDENTITY_PREFIX + commandIdentityKey({ projectId: scope.projectId, actor: bound.actor, idempotencyKey: requestId });
    // The fingerprint covers only caller-command facts (scope, mappings, previous, expected pins),
    // never the trusted Host capture route: a later config change must replay the original receipt.
    const fingerprint = sha256Hex(canonicalJson({ schemaVersion: 1, commandType: 'CaptureObservedArchitecture',
      projectId: scope.projectId, workspaceId: scope.workspaceId, mappings, previous, expected: pins.pins } as unknown as JsonValue));
    const expected = { identityKey, projectId: scope.projectId, workspaceId: scope.workspaceId, idempotencyKey: requestId, actor: bound.actor };

    const early = await records.lookupCommit({ identityKey, fingerprint });
    if (early.status === 'ready') {
      const restored = await restoreObservedCapture(records, early.value, expected);
      if (restored.status !== 'restored') return restored;
      return { status: 'committed', value: restored.value, replayed: true, cursor: early.value.cursor };
    }
    if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
    if (early.code !== 'not_found') return unavailable(early.code + ': ' + early.reason);
    if (source.provider !== 'typescript' || (source.configPath !== null && typeof source.configPath !== 'string')) return rejected('unsupported', 'the configured architecture source provider is not installed');
    if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled before capture');

    const canonical = await readCanonicalScope(records, scope);
    if (canonical.status !== 'ready') return canonical;
    const pinConflict = compareExpectedPins(scope, pins.pins, canonical.projectRevision, canonical.workspaceRevision);
    if (pinConflict !== null) return pinConflict;
    let priorFiles: ObservedArchitectureBodyV1['files'] | null = null;
    if (previous !== null) {
      // The previous observation is a historical persisted read: it reuses the same Host-authorized
      // loader (current scope authorization, canonical ref/body digest/origin and per-path grants)
      // before any body is opened.
      const prior = await loadObservation(deps, ctx, { kind: 'observed', capture: previous });
      if (prior.status !== 'ready') return prior;
      priorFiles = prior.value.body.files;
    }

    const captureRequest: CaptureSourceRequest = {
      workspace: { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId },
      workspaceRevision: canonical.workspaceRevision,
      provider: source.provider,
      ...(source.configPath === null ? {} : { configPath: source.configPath }),
    };
    const captured = await workspace.captureObservation(ctx, captureRequest);
    if (captured.status !== 'ready') return mapWorkspaceFailure(captured);
    const captureRef = captured.value.ref;
    try {
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled before verification');
      const verified = await workspace.verifyCapture(ctx, captureRef);
      if (verified.status !== 'ready') return mapWorkspaceFailure(verified);
      const exported = await workspace.exportCapture(ctx, captureRef);
      if (exported.status !== 'ready') return mapWorkspaceFailure(exported);
      // 8A file layer: capture it before the module mapping so a project with no
      // TS/JS sources never calls `mapArchitectureSource` with an empty source set
      // (task book item 8). The persisted module-level body is still written first.
      const fileGraphResult = await workspace.captureFileGraph(ctx, { capture: captureRef });
      if (fileGraphResult.status !== 'ready') return mapWorkspaceFailure(fileGraphResult);
      const fileGraph = fileGraphResult.value;
      const tsCoverage = fileGraph.languages.find(language => language.language === 'typescript');
      // Item 8: no mappings (or no parsed TS sources) means the module layer is
      // explicitly empty; the file layer is still captured.
      const mapped = mappings.length > 0 && (tsCoverage?.parsed ?? 0) > 0
        ? await workspace.captureArchitectureSource(ctx, { capture: captureRef, mappings })
        : { status: 'ready' as const, value: emptyArchitectureSnapshot({ scope, capture: captureRef, mappings,
            configPath: exported.value.summary.coverage.projectConfiguration, commitHash: exported.value.summary.commitHash }) };
      if (mapped.status !== 'ready') return mapWorkspaceFailure(mapped);

      // Body first: a failure after this point leaves an unreachable body, never a half-published observation.
      let changes: CaptureSummary['changes'] = {
        added: [...exported.value.files.map(file => file.path)].sort((a, b) => a.localeCompare(b)), modified: [], deleted: [],
      };
      if (priorFiles !== null) changes = changeSet(priorFiles, exported.value.files);
      const summary: CaptureSummary = { ...exported.value.summary, changes };
      const observedAt = new Date().toISOString();
      const observedBody: ObservedArchitectureBodyV1 = {
        schemaVersion: 1, capture: captureRef, observedAt, summary, files: exported.value.files, architecture: mapped.value,
      };
      const bodyJson = JSON.stringify(observedBody);
      // Publish only a body the strict reader would accept: a mapping/config that the frozen files
      // do not cover must fail here, not become an unreadable observation.
      const bodyCheck = decodeObservedArchitectureBody(bodyJson);
      if (bodyCheck.status !== 'decoded') return invalid('the assembled observation body is not self-consistent: ' + bodyCheck.reason);
      if (artifactBodySize(bodyJson) > ARTIFACT_MAX_SIZE_BYTES) return rejected('capacity', 'the observed architecture body exceeds the artifact capacity');
      const sourceRef: SourceRefV1 = { kind: 'workspace', refId: scope.workspaceId, revision: String(canonical.workspaceRevision), digest: captureRef.sourceDigest };
      const put = await bodies.put({ body: bodyJson, contentType: OBSERVED_ARCHITECTURE_BODY_CONTENT_TYPE,
        sourceRefs: [sourceRef], origin: { kind: 'platform_operation', projectId: scope.projectId, workspaceId: scope.workspaceId, requestId, actor: bound.actor }, requestedAt: observedAt });
      if (put.status !== 'ready') return mapBodyPutFailure(put);
      const persistedRef: PersistedSourceCaptureRef = { capture: captureRef, material: put.value.ref };

      // 8A file layer: one artifact per chunk, same sourceRefs/origin/requestedAt as
      // the module body. All chunks are published before the second verification so
      // a moved source leaves only unreachable bodies, never a published pointer.
      const chunkBodies = buildFileGraphChunks(fileGraph, deps.fileGraph?.chunkBytes ?? ARTIFACT_MAX_SIZE_BYTES);
      if (chunkBodies.length > 64) return rejected('capacity', 'the file graph needs ' + chunkBodies.length + ' chunks; the limit is 64');
      const chunkRefs: ObservedFileGraphManifestV1['chunks'] = [];
      for (const chunkBody of chunkBodies) {
        const chunkPut = await bodies.put({ body: chunkBody, contentType: FILE_GRAPH_CHUNK_CONTENT_TYPE,
          sourceRefs: [sourceRef], origin: { kind: 'platform_operation', projectId: scope.projectId, workspaceId: scope.workspaceId, requestId, actor: bound.actor }, requestedAt: observedAt });
        if (chunkPut.status !== 'ready') return mapBodyPutFailure(chunkPut);
        chunkRefs.push(chunkPut.value.ref);
      }
      const fileGraphManifest: ObservedFileGraphManifestV1 = {
        chunks: chunkRefs, nodeCount: fileGraph.nodes.length, edgeCount: fileGraph.edges.length,
        unresolved: fileGraph.unresolved,
      };

      // A second live verification: if the source moved after the immutable body was saved, do not publish the pointer.
      const recheck = await workspace.verifyCapture(ctx, captureRef);
      if (recheck.status !== 'ready') return mapWorkspaceFailure(recheck);

      const observedRef: ObservedArchitectureRef = { aggregateType: 'ObservedArchitecture', projectId: scope.projectId,
        workspaceId: scope.workspaceId, captureId: captureRef.captureId };
      const observedRecord: ObservedArchitectureRecord = { ref: observedRef, revision: 1, schemaVersion: 1, source: persistedRef,
        observedAt, fileGraph: fileGraphManifest, languages: fileGraph.languages };
      const currentRef: WorkspaceArchitectureObservationCurrentRef = { aggregateType: 'WorkspaceArchitectureObservationCurrent',
        projectId: scope.projectId, workspaceId: scope.workspaceId };
      const currentRead = await records.readMany([canonicalOf(currentRef)]);
      if (currentRead.status !== 'ready') return mapStoreFailure(currentRead);
      const currentEncoded = currentRead.value.records.find(record => record.refKey === canonicalOf(currentRef));
      let currentRevision: number | null = null;
      if (currentEncoded !== undefined) {
        const decoded = decodeObservationCurrent(currentEncoded);
        if (decoded.status !== 'decoded') return unavailable('the current observation pointer is damaged');
        currentRevision = decoded.value.revision;
      }
      if (ctx.signal.aborted) return rejected('cancelled', 'the observation was cancelled before commit');
      const nextCurrent: WorkspaceArchitectureObservationCurrentRecord = { ref: currentRef,
        revision: (currentRevision ?? 0) + 1, schemaVersion: 1, observedRef };
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
      if (committed.status !== 'committed') return mapStoreFailure(committed);
      if (!committed.replayed) return { status: 'committed', value: persistedRef, replayed: false, cursor: committed.cursor };
      const restored = await restoreObservedCapture(records, committed, expected);
      if (restored.status !== 'restored') return restored;
      return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
    } finally {
      // Release the temporary capture on every outcome after publication; the durable observation is the body.
      await releaseCaptureQuietly(workspace, ctx, captureRef);
    }
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
    // a baseline with no record (or with no catalog row) is `not_found`.
    const revision = await readRevisionByRef(records, catalog.baseline.ref);
    if (revision.status !== 'ready') return revision;
    if (revision.value.catalog === null) return { status: 'not_found' };
    if (revision.value.baseline.contentDigest !== catalog.baseline.digest) {
      return invalid('the catalog pin baseline digest does not match the recorded baseline revision');
    }
    const loaded = await loadFileGraph(deps, ctx, captureRef);
    if (loaded.status !== 'ready') return asReadResult(loaded);
    // UNSPECIFIED choice: an old observation with no file graph cannot be compared
    // (empty findings would read as "no differences"), so it is `unsupported`.
    if (loaded.value === null) return rejected('unsupported', 'not_captured: the observation has no file-level graph');
    const fileGraph: ProjectFileGraphV1 = { nodes: loaded.value.nodes, edges: loaded.value.edges,
      unresolved: loaded.value.unresolved, languages: loaded.value.languages, complete: loaded.value.complete };
    const findings = compareFormalObservedGraphs({ architecture: revision.value.catalog.catalog, fileGraph });
    return { status: 'ready', value: { catalog, captureRef, findings, noVerdict: true } };
  }

  return { captureSourceChanges, queryArchitecture, compareArchitecture, queryImpact,
    listFiles, neighbors, impact, compareFormalObserved };
}
