/**
 * Observed-architecture codecs — the closed registration the observed graph owns.
 *
 * The record store keeps only mechanical envelopes; this file is the single place
 * that decides whether an observed capture record/event and the body it points at
 * are well formed. Nothing here reads files, calls WorkspaceTools or adopts a
 * baseline: an observed capture is evidence of one bounded source read, never the
 * formal `ProjectArchitectureBaselineActive`.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import { COVERAGE_ISSUES_MAX, type FileGraphNodeV1, type LanguageCoverageV1,
  type ObservationInventoryV1 } from '../../../contracts/architecture-inspection.js';
import { AUTO_CAPTURE_FAILURE_REASON_MAX_CHARS, isAutoCaptureTrigger,
  type ArchitectureAutoCaptureRecordV1 } from '../../../contracts/architecture-observation.js';
import type { ArchitectureSourceSnapshotV1 } from '../../../contracts/architecture-source.js';
import { architectureSourceIssues, pathOwnershipOf } from '../../../contracts/architecture-source.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { PersistedSourceCaptureRef, SourceCaptureRef } from '../../../contracts/core/source.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { invalid, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { DecodeResult, EncodedDomainEvent, EncodedRecord, EncodedRecordSchema, RecordBackendSchemas } from '../../record-store/ports.js';
import { encodeEventEnvelope } from '../persistence/event-envelope.js';
import { isProjectInputPath } from '../../workspace/project-source-snapshot.js';
import type { ObservedArchitectureRecord, ObservedArchitectureRef, ObservedFileGraphChunkScope,
  ObservedFileGraphChunkV2, ObservedFileGraphManifest, ObservedFileGraphManifestV2,
  ObservedFileGraphUnresolvedV1, ObservedSummaryV2, WorkspaceArchitectureObservationCurrentRecord,
  WorkspaceArchitectureObservationCurrentRef } from './contracts.js';

export const OBSERVED_ARCHITECTURE_SCHEMA_ID = 'ObservedArchitecture@1';
export const OBSERVATION_CURRENT_SCHEMA_ID = 'WorkspaceArchitectureObservationCurrent@1';
/** Automatic-capture request record; its state-layer writer is
 * `state/architecture-capture.ts`. */
export const ARCHITECTURE_AUTO_CAPTURE_SCHEMA_ID = 'ArchitectureAutoCapture@1';
export const ARCHITECTURE_AUTO_CAPTURE_REQUESTED_EVENT = 'ArchitectureAutoCaptureRequested';
export const ARCHITECTURE_AUTO_CAPTURE_FAILED_EVENT = 'ArchitectureAutoCaptureFailed';
export const ARCHITECTURE_AUTO_CAPTURE_EVENT_VERSION = 1;
export const ARCHITECTURE_SOURCE_OBSERVED_EVENT = 'ArchitectureSourceObserved';
export const ARCHITECTURE_SOURCE_OBSERVED_EVENT_VERSION = 1;
export const OBSERVED_ARCHITECTURE_BODY_CONTENT_TYPE = 'application/vnd.coding-platform.observed-architecture+json';
/** File-level chunk body (spec L12). One artifact per chunk. */
export const FILE_GRAPH_CHUNK_SCHEMA_ID = 'ObservedFileGraphChunk@1';
export const FILE_GRAPH_CHUNK_CONTENT_TYPE = 'application/vnd.coding-platform.observed-file-graph-chunk+json';

/** One stored file-level graph chunk. A chunk is always the current `schemaVersion: 2`
 * shape (decision 79: the earlier 8A node/path-edge chunk is not read). */
export type ObservedFileGraphChunk = ObservedFileGraphChunkV2;

/** §10 item 2 v2 body: no `files`, no `changes` path lists, no `indexedSources`. */
export type ObservedArchitectureBodyV2 = {
  schemaVersion: 2;
  capture: SourceCaptureRef;
  observedAt: string;
  summary: ObservedSummaryV2;
  architecture: ArchitectureSourceSnapshotV1;
};
/** Immutable body stored in the RawArtifactStore and referenced by the record. */
export type ObservedArchitectureBody = ObservedArchitectureBodyV2;

export type ArchitectureSourceObservedEventV1 = {
  eventId: string;
  eventType: typeof ARCHITECTURE_SOURCE_OBSERVED_EVENT;
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: 'ObservedArchitecture';
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { source: PersistedSourceCaptureRef; observedAt: string };
};

/** One event per request-record write (requested / failed), carrying the whole
 * record as its payload. */
export type ArchitectureAutoCaptureEventV1 = {
  eventId: string;
  eventType: typeof ARCHITECTURE_AUTO_CAPTURE_REQUESTED_EVENT | typeof ARCHITECTURE_AUTO_CAPTURE_FAILED_EVENT;
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: 'ArchitectureAutoCapture';
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { record: ArchitectureAutoCaptureRecordV1 };
};

// --------------------------------------------------------------------------
// Mechanical shape helpers (pure, no I/O)
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function safeRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/[\\:\0]/.test(value) && value.split('/').every(segment => !!segment && segment !== '.' && segment !== '..');
}
function parseObject(json: string, what: string): UnknownRecord | string {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return what + ' is not valid JSON'; }
  return isRecord(parsed) ? parsed : what + ' JSON must be an object';
}
function exactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}
function copyRecord(record: EncodedRecord): EncodedRecord {
  return { refKey: record.refKey, schemaId: record.schemaId, revision: record.revision, json: record.json };
}
function copyEvent(event: EncodedDomainEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion, occurredAt: event.occurredAt, json: event.json };
}

// --------------------------------------------------------------------------
// Value readers
// --------------------------------------------------------------------------

const SOURCE_REF_KINDS: readonly string[] = ['plan-revision', 'workspace', 'governance', 'artifact', 'memory'];

export function readSourceCaptureRef(value: unknown): SourceCaptureRef | null {
  if (!isRecord(value)) return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) || !nonEmpty(value['captureId'])) return null;
  if (!isSafeRevision(value['workspaceRevision']) || value['workspaceRevision'] < 1) return null;
  if (!isSha256(value['sourceDigest']) || !isSha256(value['configDigest'])) return null;
  if (!nonEmpty(value['indexVersion'])) return null;
  return {
    projectId: value['projectId'], workspaceId: value['workspaceId'], captureId: value['captureId'],
    workspaceRevision: value['workspaceRevision'], sourceDigest: value['sourceDigest'],
    configDigest: value['configDigest'], indexVersion: value['indexVersion'],
  };
}

function readSourceRefV1(value: unknown): { kind: string; refId: string; revision: string; digest?: string } | null {
  if (!isRecord(value)) return null;
  if (!nonEmpty(value['kind']) || !SOURCE_REF_KINDS.includes(value['kind'])) return null;
  if (!nonEmpty(value['refId']) || typeof value['revision'] !== 'string') return null;
  if (value['digest'] !== undefined && typeof value['digest'] !== 'string') return null;
  return value['digest'] === undefined
    ? { kind: value['kind'], refId: value['refId'], revision: value['revision'] }
    : { kind: value['kind'], refId: value['refId'], revision: value['revision'], digest: value['digest'] };
}

export function readArtifactRef(value: unknown): ArtifactRef | null {
  if (!isRecord(value)) return null;
  if (value['kind'] !== 'artifact' || !nonEmpty(value['contentType']) || !isSha256(value['digest'])) return null;
  if (!isSafeRevision(value['sizeBytes'])) return null;
  const source = readSourceRefV1(value['source']);
  if (source === null) return null;
  return { kind: 'artifact', contentType: value['contentType'], digest: value['digest'], sizeBytes: value['sizeBytes'], source: source as ArtifactRef['source'] };
}

export function readPersistedSourceCaptureRef(value: unknown): PersistedSourceCaptureRef | null {
  if (!isRecord(value)) return null;
  const capture = readSourceCaptureRef(value['capture']);
  const material = readArtifactRef(value['material']);
  if (capture === null || material === null) return null;
  return { capture, material };
}

function readObservedArchitectureRef(value: unknown): ObservedArchitectureRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'ObservedArchitecture') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) || !nonEmpty(value['captureId'])) return null;
  return { aggregateType: 'ObservedArchitecture', projectId: value['projectId'], workspaceId: value['workspaceId'], captureId: value['captureId'] };
}

function readObservationCurrentRef(value: unknown): WorkspaceArchitectureObservationCurrentRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'WorkspaceArchitectureObservationCurrent') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])) return null;
  return { aggregateType: 'WorkspaceArchitectureObservationCurrent', projectId: value['projectId'], workspaceId: value['workspaceId'] };
}

function readArchitectureSnapshot(value: unknown): ArchitectureSourceSnapshotV1 | null {
  if (!isRecord(value)) return null;
  const issues = architectureSourceIssues(value);
  return issues.length === 0 ? value as unknown as ArchitectureSourceSnapshotV1 : null;
}

// --------------------------------------------------------------------------
// 8A file-level graph (chunk body + record manifest)
// --------------------------------------------------------------------------

/** §10 item 6 v2 chunk node: closed keys, 64-hex digest, safe counts, boolean `indexed`. */
function readFileGraphNodeV2(value: unknown): FileGraphNodeV1 | null {
  if (!isRecord(value) || !exactKeys(value, ['path', 'digest', 'byteSize', 'language', 'nonBlankLines', 'indexed'])) return null;
  if (!safeRelativePath(value['path']) || !isSha256(value['digest'])) return null;
  if (!isSafeRevision(value['byteSize']) || !isSafeRevision(value['nonBlankLines'])) return null;
  if (!nonEmpty(value['language']) || value['language'].length > 256) return null;
  if (typeof value['indexed'] !== 'boolean') return null;
  return { path: value['path'], digest: value['digest'], byteSize: value['byteSize'],
    language: value['language'], nonBlankLines: value['nonBlankLines'], indexed: value['indexed'] };
}

/** §10 item 6 index pairs `[i, j]`; when the manifest node count is known, both
 * indices must fall inside the one global sorted node table, across chunks. */
function readFileGraphIndexEdges(value: unknown, nodeCount: number | undefined): [number, number][] | null {
  if (!Array.isArray(value)) return null;
  const edges: [number, number][] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [from, to] = entry as unknown[];
    if (typeof from !== 'number' || !Number.isSafeInteger(from) || from < 0) return null;
    if (typeof to !== 'number' || !Number.isSafeInteger(to) || to < 0) return null;
    if (nodeCount !== undefined && (from >= nodeCount || to >= nodeCount)) return null;
    edges.push([from, to]);
  }
  return edges;
}

/** §11.5 unresolved entry: `reason` is null or a non-empty string; the codec
 * validates lengths only, it never cuts or normalizes (the writer does).
 * An EMPTY specifier is real syntax (`import "";`), so it is legal on the read
 * side exactly as it is on the write side; the 4096-character limit is the one
 * shared limit. */
function readFileGraphUnresolvedV2(value: unknown): ObservedFileGraphUnresolvedV1[] | null {
  if (!Array.isArray(value)) return null;
  const unresolved: ObservedFileGraphUnresolvedV1[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !exactKeys(entry, ['from', 'specifier', 'reason'])) return null;
    if (!safeRelativePath(entry['from'])) return null;
    if (typeof entry['specifier'] !== 'string' || entry['specifier'].length > 4096) return null;
    if (entry['reason'] !== null && (!nonEmpty(entry['reason']) || entry['reason'].length > 4096)) return null;
    unresolved.push({ from: entry['from'], specifier: entry['specifier'], reason: entry['reason'] as string | null });
  }
  return unresolved;
}

function readLanguageCoverage(value: unknown): LanguageCoverageV1 | null {
  // Decision 79: every key is mandatory in the current format, including `notes`;
  // a coverage entry without it is unreadable, never defaulted to `[]`.
  if (!isRecord(value) || !exactKeys(value, ['language', 'files', 'parsed', 'edges', 'reason', 'notes', 'issues', 'issueCount', 'complete'])) return null;
  if (!nonEmpty(value['language'])) return null;
  if (!isSafeRevision(value['files']) || !isSafeRevision(value['parsed'])) return null;
  if (value['edges'] !== 'supported' && value['edges'] !== 'unsupported' && value['edges'] !== 'failed') return null;
  if (value['reason'] !== null && !nonEmpty(value['reason'])) return null;
  // Spec §11.5: at most 10 strings of at most 200 characters; the codec neither
  // sorts nor cuts. An explicit `notes: []` is the current format's empty list.
  if (!Array.isArray(value['notes']) || value['notes'].length > 10) return null;
  if (value['notes'].some(note => typeof note !== 'string' || note.length > 200)) return null;
  const notes = value['notes'] as string[];
  if (!Array.isArray(value['issues']) || value['issues'].length > COVERAGE_ISSUES_MAX) return null;
  const issues: LanguageCoverageV1['issues'] = [];
  for (const entry of value['issues']) {
    if (!isRecord(entry) || !exactKeys(entry, ['path', 'kind', 'reason'])) return null;
    if (!safeRelativePath(entry['path'])) return null;
    if (entry['kind'] !== 'skipped' && entry['kind'] !== 'failed') return null;
    if (!nonEmpty(entry['reason'])) return null;
    issues.push({ path: entry['path'], kind: entry['kind'], reason: entry['reason'] });
  }
  if (!isSafeRevision(value['issueCount']) || value['issueCount'] < issues.length) return null;
  if (typeof value['complete'] !== 'boolean') return null;
  return { language: value['language'], files: value['files'], parsed: value['parsed'],
    edges: value['edges'], reason: value['reason'], notes, issues, issueCount: value['issueCount'], complete: value['complete'] };
}

/** A closed chunk-ref list (at most 64) of file-graph-chunk artifacts. */
function readFileGraphChunkRefs(value: unknown): ArtifactRef[] | string {
  if (!Array.isArray(value) || value.length > 64) {
    return 'ObservedArchitecture fileGraph must carry at most 64 chunk refs';
  }
  const chunks: ArtifactRef[] = [];
  for (const rawRef of value) {
    const ref = readArtifactRef(rawRef);
    if (ref === null || ref.contentType !== FILE_GRAPH_CHUNK_CONTENT_TYPE) {
      return 'ObservedArchitecture fileGraph chunk ref is not a file graph chunk artifact';
    }
    chunks.push(ref);
  }
  return chunks;
}

/** Decision 79: the record's file-graph manifest has exactly the current
 * `schemaVersion: 2` shape. A manifest without the key (the earlier 8A shape) or
 * with any other keys is invalid, never migrated. */
function readFileGraphManifest(value: unknown):
  { status: 'ok'; value: ObservedFileGraphManifestV2 } | { status: 'invalid'; reason: string } {
  if (!isRecord(value)) return { status: 'invalid', reason: 'ObservedArchitecture fileGraph manifest must be an object' };
  if (value['schemaVersion'] !== 2 || !exactKeys(value, ['schemaVersion', 'chunks', 'nodeCount', 'edgeCount', 'unresolvedCount'])) {
    return { status: 'invalid', reason: 'ObservedArchitecture fileGraph manifest has unknown or missing keys' };
  }
  const chunks = readFileGraphChunkRefs(value['chunks']);
  if (typeof chunks === 'string') return { status: 'invalid', reason: chunks };
  if (!isSafeRevision(value['nodeCount']) || !isSafeRevision(value['edgeCount']) || !isSafeRevision(value['unresolvedCount'])) {
    return { status: 'invalid', reason: 'ObservedArchitecture fileGraph counts must be safe non-negative integers' };
  }
  return { status: 'ok', value: { schemaVersion: 2, chunks, nodeCount: value['nodeCount'],
    edgeCount: value['edgeCount'], unresolvedCount: value['unresolvedCount'] } };
}

/** One current chunk body: `schemaVersion: 2`, both scope fields, a closed node
 * list, index pairs into the one global node table and the unresolved entries.
 * The earlier 8A node/path-edge chunk (schemaVersion 1) and the unscoped v2
 * chunk are rejected (decision 79); a missing scope is never filled in from the
 * record. `scope` is the canonical capture scope the reader (or the writer's
 * pre-put check) expects the body to carry. `nodeCount` is the manifest's global
 * node count; index pairs must stay inside it.
 *
 * This is THE one chunk-body validator: the decoder calls
 * it after parsing, and the writer calls it for every chunk body before the
 * first `bodies.put`, so a committed chunk is exactly one the decoder accepts. */
export function validateObservedFileGraphChunkV2(parsed: unknown, scope: ObservedFileGraphChunkScope,
  nodeCount?: number): DecodeResult<ObservedFileGraphChunkV2> {
  if (!isRecord(parsed)) return invalid('observed file graph chunk must be an object');
  if (parsed['schemaVersion'] !== 2) return invalid('observed file graph chunk schemaVersion must be 2');
  if (!exactKeys(parsed, ['schemaVersion', 'projectId', 'workspaceId', 'nodes', 'edges', 'unresolved'])) {
    return invalid('observed file graph chunk has unknown or missing top-level keys');
  }
  if (!nonEmpty(parsed['projectId']) || !nonEmpty(parsed['workspaceId'])) {
    return invalid('observed file graph chunk scope must carry a projectId and workspaceId');
  }
  if (parsed['projectId'] !== scope.projectId || parsed['workspaceId'] !== scope.workspaceId) {
    return invalid('observed file graph chunk scope differs from the capture scope');
  }
  if (!Array.isArray(parsed['nodes'])) return invalid('observed file graph chunk nodes must be an array');
  const nodes: FileGraphNodeV1[] = [];
  for (const raw of parsed['nodes']) {
    const node = readFileGraphNodeV2(raw);
    if (node === null) return invalid('observed file graph chunk has an invalid file node');
    nodes.push(node);
  }
  if (new Set(nodes.map(node => node.path)).size !== nodes.length) return invalid('observed file graph chunk has a duplicate file node');
  const edges = readFileGraphIndexEdges(parsed['edges'], nodeCount);
  if (edges === null) return invalid('observed file graph chunk has an invalid index edge list');
  const unresolved = readFileGraphUnresolvedV2(parsed['unresolved']);
  if (unresolved === null) return invalid('observed file graph chunk has an invalid unresolved list');
  return { status: 'decoded', value: { schemaVersion: 2, projectId: parsed['projectId'],
    workspaceId: parsed['workspaceId'], nodes, edges, unresolved } };
}

/** Parse one stored chunk body and hand it to the shared validator above with
 * the canonical capture scope the caller read from the observation record. */
export function decodeObservedFileGraphChunk(json: string, scope: ObservedFileGraphChunkScope,
  nodeCount?: number): DecodeResult<ObservedFileGraphChunk> {
  const parsed = parseObject(json, 'Observed file graph chunk');
  if (typeof parsed === 'string') return invalid(parsed);
  return validateObservedFileGraphChunkV2(parsed, scope, nodeCount);
}

/** The concatenated graph behind one manifest (the loader calls this after it has
 * read and decoded every chunk). It owns the cross-chunk checks the per-chunk
 * decoder cannot see: global duplicate node paths, global index bounds and the
 * exact counts against the manifest. */
export type MergedObservedFileGraph = {
  nodes: FileGraphNodeV1[];
  edges: { from: string; to: string }[];
  unresolved: ObservedFileGraphUnresolvedV1[];
};

export function mergeObservedFileGraphChunks(manifest: ObservedFileGraphManifest,
  chunks: readonly ObservedFileGraphChunk[]): DecodeResult<MergedObservedFileGraph> {
  const nodes = chunks.flatMap(chunk => chunk.nodes);
  if (new Set(nodes.map(node => node.path)).size !== nodes.length) {
    return invalid('observed file graph has a duplicate file node across chunks');
  }
  const edges: { from: string; to: string }[] = [];
  for (const chunk of chunks) {
    for (const [from, to] of chunk.edges) {
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)
        || from < 0 || to < 0 || from >= nodes.length || to >= nodes.length) {
        return invalid('observed file graph edge index is outside the node table');
      }
      edges.push({ from: nodes[from]!.path, to: nodes[to]!.path });
    }
  }
  const unresolved = chunks.flatMap(chunk => chunk.unresolved);
  if (unresolved.length !== manifest.unresolvedCount) {
    return invalid('observed file graph unresolved count disagrees with the observation record');
  }
  if (nodes.length !== manifest.nodeCount || edges.length !== manifest.edgeCount) {
    return invalid('observed file graph chunk counts disagree with the observation record');
  }
  return { status: 'decoded', value: { nodes, edges, unresolved } };
}

// --------------------------------------------------------------------------
// Persisted body
// --------------------------------------------------------------------------

const BODY_KEYS_V2: readonly string[] = ['schemaVersion', 'capture', 'observedAt', 'summary', 'architecture'];

/** §10 item 2 v2 summary: counts only, all safe non-negative integers. The
 * writer preserves the capture's language order; the decoder does not sort. */
function readObservedSummaryV2(value: unknown): ObservedSummaryV2 | null {
  if (!isRecord(value) || !exactKeys(value, ['files', 'languages', 'changes'])) return null;
  if (!isSafeRevision(value['files'])) return null;
  if (!Array.isArray(value['languages'])) return null;
  const languages: ObservedSummaryV2['languages'] = [];
  const seen = new Set<string>();
  for (const entry of value['languages']) {
    if (!isRecord(entry) || !exactKeys(entry, ['language', 'files'])) return null;
    if (!nonEmpty(entry['language']) || entry['language'].length > 256) return null;
    if (!isSafeRevision(entry['files'])) return null;
    if (seen.has(entry['language'])) return null;
    seen.add(entry['language']);
    languages.push({ language: entry['language'], files: entry['files'] });
  }
  const changes = value['changes'];
  if (!isRecord(changes) || !exactKeys(changes, ['added', 'modified', 'deleted'])) return null;
  if (!isSafeRevision(changes['added']) || !isSafeRevision(changes['modified']) || !isSafeRevision(changes['deleted'])) return null;
  return { files: value['files'], languages,
    changes: { added: changes['added'], modified: changes['modified'], deleted: changes['deleted'] } };
}

/** §10 item 2: membership is re-derived from the chunk nodes (`path`+`digest`,
 * project input AND indexed) with the same longest-prefix ownership rule that
 * wrote the snapshot. The chunk node order is the writer's path order, so the
 * recomputed `contentDigest` reproduces the recorded provenance exactly. */
function decodeObservedArchitectureBodyV2(parsed: UnknownRecord,
  nodes: readonly FileGraphNodeV1[] | undefined): DecodeResult<ObservedArchitectureBodyV2> {
  if (!exactKeys(parsed, BODY_KEYS_V2)) return invalid('observed architecture body has unknown or missing top-level keys');
  const capture = readSourceCaptureRef(parsed['capture']);
  if (capture === null) return invalid('observed architecture body has no complete source capture ref');
  if (!nonEmpty(parsed['observedAt'])) return invalid('observed architecture body observedAt must be a non-empty string');
  const summary = readObservedSummaryV2(parsed['summary']);
  if (summary === null) return invalid('observed architecture body has an invalid v2 capture summary');
  const rawArchitecture = parsed['architecture'];
  if (isRecord(rawArchitecture) && Object.prototype.hasOwnProperty.call(rawArchitecture, 'indexedSources')) {
    return invalid('observed architecture v2 body must not carry indexedSources');
  }
  const architecture = readArchitectureSnapshot(rawArchitecture);
  if (architecture === null) return invalid('observed architecture body has an invalid architecture snapshot');
  if (architecture.projectId !== capture.projectId || architecture.workspaceId !== capture.workspaceId) {
    return invalid('observed architecture snapshot is outside the capture scope');
  }
  if (architecture.workspaceRevision !== capture.workspaceRevision) {
    return invalid('observed architecture workspaceRevision disagrees with the capture');
  }
  if (architecture.sourceDigest !== capture.sourceDigest) {
    return invalid('observed architecture snapshot sourceDigest disagrees with the capture');
  }
  if (architecture.indexVersion !== capture.indexVersion) {
    return invalid('observed architecture indexVersion disagrees with the capture');
  }
  if (nodes === undefined) return invalid('observed architecture v2 body needs the chunk node table');
  const members = nodes.filter(node => node.indexed && isProjectInputPath(node.path));
  const ownershipCandidates = architecture.mappings.map((mapping, index) => ({ value: index, paths: mapping.paths }));
  const ownerIndexBySource = new Map<string, number | null>();
  for (const member of members) {
    const result = pathOwnershipOf(member.path, ownershipCandidates);
    ownerIndexBySource.set(member.path, result.status === 'owner' ? result.owner : null);
  }
  const mappingByStructuralKey = new Map(architecture.mappings.map(mapping => [mapping.kind + ':' + mapping.id, mapping]));
  const mappingIndexByStructuralKey = new Map(architecture.mappings.map((mapping, index) => [mapping.kind + ':' + mapping.id, index]));
  for (const node of architecture.nodes) {
    const mapping = mappingByStructuralKey.get(node.structuralKey);
    if (mapping === undefined) return invalid('observed architecture node has no explicit mapping ' + node.structuralKey);
    if (node.nodeId !== node.structuralKey || node.kind !== mapping.kind || node.name !== mapping.id || node.path !== mapping.paths[0]) {
      return invalid('observed architecture node identity or representative path disagrees with its mapping');
    }
    const mappingIndex = mappingIndexByStructuralKey.get(node.structuralKey)!;
    const nodeMembers = members
      .filter(member => ownerIndexBySource.get(member.path) === mappingIndex)
      .map(member => ({ path: member.path, digest: member.digest }));
    if (nodeMembers.length === 0) return invalid('observed architecture node has no indexed source member for mapping ' + node.structuralKey);
    if (node.contentDigest !== sha256Hex(canonicalJson(nodeMembers as unknown as JsonValue))) {
      return invalid('observed architecture node contentDigest disagrees with its indexed members');
    }
  }
  if (architecture.configPath !== null
    && !nodes.some(node => node.path === architecture.configPath || node.path.startsWith(architecture.configPath + '/'))) {
    return invalid('observed architecture body has no frozen file for its configuration path');
  }
  return { status: 'decoded', value: { schemaVersion: 2, capture, observedAt: parsed['observedAt'],
    summary, architecture } };
}

/**
 * Decode one persisted body. Only the current `schemaVersion: 2` compact body is
 * accepted (counts-only summary, no `files`, no `indexedSources`); an earlier v1
 * body is invalid (decision 79). A v2 body needs the chunk node table for its
 * membership recheck.
 */
export function decodeObservedArchitectureBody(json: string,
  nodes?: readonly FileGraphNodeV1[]): DecodeResult<ObservedArchitectureBody> {
  const parsed = parseObject(json, 'Observed architecture body');
  if (typeof parsed === 'string') return invalid(parsed);
  if (parsed['schemaVersion'] !== 2) return invalid('observed architecture body schemaVersion must be 2');
  return decodeObservedArchitectureBodyV2(parsed, nodes);
}

// --------------------------------------------------------------------------
// Registered record/event validators
// --------------------------------------------------------------------------

/** §10 item 1 inventory. The record key is required and the current format
 * always writes the object; a whole-`null` inventory is an earlier shape and is
 * rejected (decision 79). `git` has no reason, `skip_list` carries
 * "不是 git 仓库" or "git 不能用：<原因>". */
function readInventory(value: unknown):
  { status: 'ok'; value: ObservationInventoryV1 } | { status: 'invalid'; reason: string } {
  if (value === undefined) {
    return { status: 'invalid', reason: 'ObservedArchitecture inventory key is missing' };
  }
  if (value === null) {
    return { status: 'invalid', reason: 'ObservedArchitecture inventory must be an object' };
  }
  if (!isRecord(value) || !exactKeys(value, ['source', 'reason'])) {
    return { status: 'invalid', reason: 'ObservedArchitecture inventory has unknown or missing keys' };
  }
  if (value['source'] !== 'git' && value['source'] !== 'skip_list') {
    return { status: 'invalid', reason: 'ObservedArchitecture inventory source must be git or skip_list' };
  }
  if (value['reason'] !== null && (!nonEmpty(value['reason']) || value['reason'].length > 4096)) {
    return { status: 'invalid', reason: 'ObservedArchitecture inventory reason must be null or a non-empty string' };
  }
  if (value['source'] === 'git' && value['reason'] !== null) {
    return { status: 'invalid', reason: 'ObservedArchitecture git inventory must not carry a reason' };
  }
  return { status: 'ok', value: { source: value['source'] as 'git' | 'skip_list',
    reason: value['reason'] as string | null } };
}

function validateObservedArchitecture(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== OBSERVED_ARCHITECTURE_SCHEMA_ID) return invalid('expected schemaId ' + OBSERVED_ARCHITECTURE_SCHEMA_ID + ', got ' + record.schemaId);
  const parsed = parseObject(record.json, 'ObservedArchitecture record');
  if (typeof parsed === 'string') return invalid(parsed);
  // Decision 79: the file layer, coverage and inventory belong to the current
  // format, so all three keys are REQUIRED and the key set stays closed. A record
  // in an earlier shape is unreadable, never migrated or defaulted.
  const requiredKeys = ['ref', 'revision', 'schemaVersion', 'source', 'observedAt', 'fileGraph', 'languages', 'inventory'];
  if (!exactKeys(parsed, requiredKeys)) {
    return invalid('ObservedArchitecture record has unknown or missing top-level keys');
  }
  const ref = readObservedArchitectureRef(parsed['ref']);
  if (ref === null) return invalid('ObservedArchitecture record has no complete ref');
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) return invalid('ObservedArchitecture ref is not the outer canonical ref_key');
  if (parsed['revision'] !== 1 || record.revision !== 1) return invalid('ObservedArchitecture revision must be exactly 1');
  if (parsed['schemaVersion'] !== 1) return invalid('ObservedArchitecture schemaVersion must be 1');
  const source = readPersistedSourceCaptureRef(parsed['source']);
  if (source === null) return invalid('ObservedArchitecture record has no complete persisted source');
  if (source.capture.projectId !== ref.projectId || source.capture.workspaceId !== ref.workspaceId || source.capture.captureId !== ref.captureId) {
    return invalid('ObservedArchitecture persisted source identity disagrees with its full ref');
  }
  if (!nonEmpty(parsed['observedAt'])) return invalid('ObservedArchitecture observedAt must be a non-empty string');
  const manifest = readFileGraphManifest(parsed['fileGraph']);
  if (manifest.status !== 'ok') return invalid(manifest.reason);
  const inventory = readInventory(parsed['inventory']);
  if (inventory.status !== 'ok') return invalid(inventory.reason);
  if (!Array.isArray(parsed['languages'])) return invalid('ObservedArchitecture languages must be an array');
  for (const coverage of parsed['languages']) if (readLanguageCoverage(coverage) === null) return invalid('ObservedArchitecture has an invalid language coverage entry');
  return { status: 'decoded', value: copyRecord(record) };
}

function validateObservationCurrent(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== OBSERVATION_CURRENT_SCHEMA_ID) return invalid('expected schemaId ' + OBSERVATION_CURRENT_SCHEMA_ID + ', got ' + record.schemaId);
  const parsed = parseObject(record.json, 'WorkspaceArchitectureObservationCurrent record');
  if (typeof parsed === 'string') return invalid(parsed);
  const ref = readObservationCurrentRef(parsed['ref']);
  if (ref === null) return invalid('ObservationCurrent record has no complete ref');
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) return invalid('ObservationCurrent ref is not the outer canonical ref_key');
  const revision = parsed['revision'];
  if (!isSafeRevision(revision) || revision < 1 || revision !== record.revision) return invalid('ObservationCurrent revision must be a safe integer >= 1 and match the outer revision');
  if (parsed['schemaVersion'] !== 1) return invalid('ObservationCurrent schemaVersion must be 1');
  const observed = readObservedArchitectureRef(parsed['observedRef']);
  if (observed === null) return invalid('ObservationCurrent observedRef is incomplete');
  if (observed.projectId !== ref.projectId || observed.workspaceId !== ref.workspaceId) return invalid('ObservationCurrent observedRef is outside the pointer scope');
  // Ruling 7: the replaced observation is part of the current format; a pointer
  // without the key is an earlier shape and is rejected (decision 79).
  const previous = parsed['previousObservedRef'];
  if (previous !== null) {
    const decodedPrevious = readObservedArchitectureRef(previous);
    if (decodedPrevious === null) return invalid('ObservationCurrent previousObservedRef is incomplete');
    if (decodedPrevious.projectId !== ref.projectId || decodedPrevious.workspaceId !== ref.workspaceId) {
      return invalid('ObservationCurrent previousObservedRef is outside the pointer scope');
    }
  }
  // Ruling 3: the satisfied request sequence is stored with the pointer; it is
  // the computed `pending` basis, so it is required.
  if (!isSafeRevision(parsed['satisfiedRequestSeq'])) {
    return invalid('ObservationCurrent satisfiedRequestSeq must be a safe non-negative integer');
  }
  return { status: 'decoded', value: copyRecord(record) };
}

function validateArchitectureSourceObservedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== ARCHITECTURE_SOURCE_OBSERVED_EVENT || event.schemaVersion !== ARCHITECTURE_SOURCE_OBSERVED_EVENT_VERSION) {
    return invalid('expected ' + ARCHITECTURE_SOURCE_OBSERVED_EVENT + '@' + ARCHITECTURE_SOURCE_OBSERVED_EVENT_VERSION);
  }
  const parsed = parseObject(event.json, 'ArchitectureSourceObserved event');
  if (typeof parsed === 'string') return invalid(parsed);
  for (const field of ['eventId', 'eventType', 'schemaVersion', 'occurredAt'] as const) {
    if (parsed[field] !== event[field]) return invalid('ArchitectureSourceObserved outer ' + field + ' disagrees with the event JSON');
  }
  if (!nonEmpty(parsed['projectId']) || !nonEmpty(parsed['workspaceId'])) return invalid('ArchitectureSourceObserved scope is incomplete');
  if (parsed['aggregateType'] !== 'ObservedArchitecture' || !nonEmpty(parsed['aggregateId'])) return invalid('ArchitectureSourceObserved aggregate identity is incomplete');
  if (parsed['aggregateRevision'] !== 1) return invalid('ArchitectureSourceObserved aggregateRevision must be 1');
  if (!nonEmpty(parsed['causationId']) || !nonEmpty(parsed['correlationId']) || !nonEmpty(parsed['idempotencyKey'])) return invalid('ArchitectureSourceObserved command identity is incomplete');
  const actor = parsed['actor'];
  if (!isRecord(actor) || !nonEmpty(actor['id']) || (actor['kind'] !== 'human' && actor['kind'] !== 'system' && actor['kind'] !== 'agent')) {
    return invalid('ArchitectureSourceObserved actor is not a valid ActorRef');
  }
  const payload = parsed['payload'];
  if (!isRecord(payload)) return invalid('ArchitectureSourceObserved payload must be an object');
  const source = readPersistedSourceCaptureRef(payload['source']);
  if (source === null) return invalid('ArchitectureSourceObserved payload has no complete persisted source');
  if (source.capture.projectId !== parsed['projectId'] || source.capture.workspaceId !== parsed['workspaceId'] || source.capture.captureId !== parsed['aggregateId']) {
    return invalid('ArchitectureSourceObserved source is outside the event scope');
  }
  if (!nonEmpty(payload['observedAt'])) return invalid('ArchitectureSourceObserved payload.observedAt must be a non-empty string');
  return { status: 'decoded', value: copyEvent(event) };
}

// --------------------------------------------------------------------------
// L8 automatic-capture request record and its two events
// --------------------------------------------------------------------------

function readAutoCaptureRef(value: unknown): ArchitectureAutoCaptureRecordV1['ref'] | null {
  if (!isRecord(value) || value['aggregateType'] !== 'ArchitectureAutoCapture') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])) return null;
  return { aggregateType: 'ArchitectureAutoCapture', projectId: value['projectId'], workspaceId: value['workspaceId'] };
}

/** Shape check only; the typed record is built by the allowlisted decoder. */
function architectureAutoCaptureProblem(parsed: UnknownRecord, outerRefKey?: string, outerRevision?: number): string | null {
  if (!exactKeys(parsed, ['ref', 'revision', 'schemaVersion', 'workspace', 'requestSeq',
    'trigger', 'requestedAt', 'status', 'failure'])) {
    return 'ArchitectureAutoCapture record has unknown or missing top-level keys';
  }
  const ref = readAutoCaptureRef(parsed['ref']);
  if (ref === null) return 'ArchitectureAutoCapture record has no complete ref';
  if (outerRefKey !== undefined && canonicalJson(ref as unknown as JsonValue) !== outerRefKey) {
    return 'ArchitectureAutoCapture ref is not the outer canonical ref_key';
  }
  if (!isSafeRevision(parsed['revision']) || parsed['revision'] < 1) {
    return 'ArchitectureAutoCapture revision must be a safe integer >= 1';
  }
  if (outerRevision !== undefined && parsed['revision'] !== outerRevision) {
    return 'ArchitectureAutoCapture revision disagrees with the outer revision';
  }
  if (parsed['schemaVersion'] !== 1) return 'ArchitectureAutoCapture schemaVersion must be 1';
  const workspace = parsed['workspace'];
  if (!isRecord(workspace) || !exactKeys(workspace, ['projectId', 'workspaceId'])
    || workspace['projectId'] !== ref.projectId || workspace['workspaceId'] !== ref.workspaceId) {
    return 'ArchitectureAutoCapture workspace disagrees with its ref';
  }
  if (!isSafeRevision(parsed['requestSeq']) || parsed['requestSeq'] < 1) {
    return 'ArchitectureAutoCapture requestSeq must be a safe integer >= 1';
  }
  if (!isAutoCaptureTrigger(parsed['trigger'])) {
    return 'ArchitectureAutoCapture trigger is not a known trigger';
  }
  if (!nonEmpty(parsed['requestedAt'])) return 'ArchitectureAutoCapture requestedAt must be a non-empty string';
  if (parsed['status'] !== 'requested' && parsed['status'] !== 'failed') {
    return 'ArchitectureAutoCapture status must be requested or failed';
  }
  if (parsed['status'] === 'requested') {
    if (parsed['failure'] !== null) return 'ArchitectureAutoCapture requested record must not carry a failure';
    return null;
  }
  const failure = parsed['failure'];
  if (!isRecord(failure) || !exactKeys(failure, ['code', 'reason'])
    || !nonEmpty(failure['code']) || typeof failure['reason'] !== 'string'
    || failure['reason'].length > AUTO_CAPTURE_FAILURE_REASON_MAX_CHARS) {
    return 'ArchitectureAutoCapture failed record must carry a code and a reason of at most '
      + AUTO_CAPTURE_FAILURE_REASON_MAX_CHARS + ' characters';
  }
  return null;
}

function validateArchitectureAutoCapture(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== ARCHITECTURE_AUTO_CAPTURE_SCHEMA_ID) {
    return invalid('expected schemaId ' + ARCHITECTURE_AUTO_CAPTURE_SCHEMA_ID + ', got ' + record.schemaId);
  }
  const parsed = parseObject(record.json, 'ArchitectureAutoCapture record');
  if (typeof parsed === 'string') return invalid(parsed);
  const problem = architectureAutoCaptureProblem(parsed, record.refKey, record.revision);
  if (problem !== null) return invalid(problem);
  return { status: 'decoded', value: copyRecord(record) };
}

function validateArchitectureAutoCaptureEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== ARCHITECTURE_AUTO_CAPTURE_REQUESTED_EVENT
    && event.eventType !== ARCHITECTURE_AUTO_CAPTURE_FAILED_EVENT) {
    return invalid('expected ' + ARCHITECTURE_AUTO_CAPTURE_REQUESTED_EVENT + ' or ' + ARCHITECTURE_AUTO_CAPTURE_FAILED_EVENT);
  }
  if (event.schemaVersion !== ARCHITECTURE_AUTO_CAPTURE_EVENT_VERSION) {
    return invalid('expected ' + event.eventType + '@' + ARCHITECTURE_AUTO_CAPTURE_EVENT_VERSION);
  }
  const parsed = parseObject(event.json, 'ArchitectureAutoCapture event');
  if (typeof parsed === 'string') return invalid(parsed);
  for (const field of ['eventId', 'eventType', 'schemaVersion', 'occurredAt'] as const) {
    if (parsed[field] !== event[field]) return invalid('ArchitectureAutoCapture outer ' + field + ' disagrees with the event JSON');
  }
  if (!nonEmpty(parsed['projectId']) || !nonEmpty(parsed['workspaceId'])) return invalid('ArchitectureAutoCapture scope is incomplete');
  if (parsed['aggregateType'] !== 'ArchitectureAutoCapture' || !nonEmpty(parsed['aggregateId'])) {
    return invalid('ArchitectureAutoCapture aggregate identity is incomplete');
  }
  if (!nonEmpty(parsed['causationId']) || !nonEmpty(parsed['correlationId']) || !nonEmpty(parsed['idempotencyKey'])) {
    return invalid('ArchitectureAutoCapture command identity is incomplete');
  }
  const actor = parsed['actor'];
  if (!isRecord(actor) || !nonEmpty(actor['id']) || (actor['kind'] !== 'human' && actor['kind'] !== 'system' && actor['kind'] !== 'agent')) {
    return invalid('ArchitectureAutoCapture actor is not a valid ActorRef');
  }
  const payload = parsed['payload'];
  if (!isRecord(payload) || !exactKeys(payload, ['record']) || !isRecord(payload['record'])) {
    return invalid('ArchitectureAutoCapture payload must carry the request record');
  }
  const rawRecord = payload['record'];
  const ref = readAutoCaptureRef(rawRecord['ref']);
  if (ref === null) return invalid('ArchitectureAutoCapture payload record has no complete ref');
  // The record is decoded through the one record decoder so its shape rules and
  // the event's scope check can never drift apart.
  const record = decodeArchitectureAutoCapture({ refKey: canonicalJson(ref as unknown as JsonValue),
    schemaId: ARCHITECTURE_AUTO_CAPTURE_SCHEMA_ID, revision: rawRecord['revision'] as number, json: JSON.stringify(rawRecord) });
  if (record.status !== 'decoded') return invalid('ArchitectureAutoCapture payload record is invalid: ' + record.reason);
  if (record.value.ref.projectId !== parsed['projectId'] || record.value.ref.workspaceId !== parsed['workspaceId']) {
    return invalid('ArchitectureAutoCapture record is outside the event scope');
  }
  if (parsed['aggregateId'] !== record.value.workspace.workspaceId) {
    return invalid('ArchitectureAutoCapture aggregateId must be the record workspace');
  }
  if (parsed['aggregateRevision'] !== record.value.revision) {
    return invalid('ArchitectureAutoCapture aggregateRevision disagrees with the record');
  }
  return { status: 'decoded', value: copyEvent(event) };
}

// --------------------------------------------------------------------------
// Registration and encoders
// --------------------------------------------------------------------------

const OBSERVED_ARCHITECTURE_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: OBSERVED_ARCHITECTURE_SCHEMA_ID, aggregateType: 'ObservedArchitecture', validate: validateObservedArchitecture,
};
const OBSERVATION_CURRENT_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: OBSERVATION_CURRENT_SCHEMA_ID, aggregateType: 'WorkspaceArchitectureObservationCurrent', validate: validateObservationCurrent,
};
const ARCHITECTURE_AUTO_CAPTURE_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: ARCHITECTURE_AUTO_CAPTURE_SCHEMA_ID, aggregateType: 'ArchitectureAutoCapture',
  validate: validateArchitectureAutoCapture,
};

export const OBSERVED_ARCHITECTURE_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [OBSERVED_ARCHITECTURE_RECORD_SCHEMA, OBSERVATION_CURRENT_RECORD_SCHEMA, ARCHITECTURE_AUTO_CAPTURE_RECORD_SCHEMA],
  events: [
    { eventType: ARCHITECTURE_SOURCE_OBSERVED_EVENT, schemaVersion: ARCHITECTURE_SOURCE_OBSERVED_EVENT_VERSION, validate: validateArchitectureSourceObservedEvent },
    { eventType: ARCHITECTURE_AUTO_CAPTURE_REQUESTED_EVENT, schemaVersion: ARCHITECTURE_AUTO_CAPTURE_EVENT_VERSION, validate: validateArchitectureAutoCaptureEvent },
    { eventType: ARCHITECTURE_AUTO_CAPTURE_FAILED_EVENT, schemaVersion: ARCHITECTURE_AUTO_CAPTURE_EVENT_VERSION, validate: validateArchitectureAutoCaptureEvent },
  ],
  lookups: [],
};

export function encodeObservedArchitecture(record: ObservedArchitectureRecord): EncodedRecord {
  return { refKey: canonicalJson(record.ref as unknown as JsonValue), schemaId: OBSERVED_ARCHITECTURE_SCHEMA_ID, revision: record.revision, json: JSON.stringify(record) };
}
export function encodeObservationCurrent(record: WorkspaceArchitectureObservationCurrentRecord): EncodedRecord {
  return { refKey: canonicalJson(record.ref as unknown as JsonValue), schemaId: OBSERVATION_CURRENT_SCHEMA_ID, revision: record.revision, json: JSON.stringify(record) };
}
export function encodeArchitectureSourceObservedEvent(event: ArchitectureSourceObservedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}
export function encodeArchitectureAutoCapture(record: ArchitectureAutoCaptureRecordV1): EncodedRecord {
  return { refKey: canonicalJson(record.ref as unknown as JsonValue), schemaId: ARCHITECTURE_AUTO_CAPTURE_SCHEMA_ID, revision: record.revision, json: JSON.stringify(record) };
}
export function encodeArchitectureAutoCaptureEvent(event: ArchitectureAutoCaptureEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}
export function decodeArchitectureAutoCapture(record: EncodedRecord): DecodeResult<ArchitectureAutoCaptureRecordV1> {
  const checked = validateArchitectureAutoCapture(record);
  if (checked.status !== 'decoded') return checked;
  const parsed = JSON.parse(record.json) as ArchitectureAutoCaptureRecordV1;
  const failure = parsed.failure === null ? null : { code: parsed.failure.code, reason: parsed.failure.reason };
  return { status: 'decoded', value: {
    ref: { ...parsed.ref }, revision: parsed.revision, schemaVersion: 1,
    workspace: { ...parsed.workspace }, requestSeq: parsed.requestSeq, trigger: parsed.trigger,
    requestedAt: parsed.requestedAt, status: parsed.status, failure,
  } };
}
export function decodeArchitectureAutoCaptureEvent(event: EncodedDomainEvent): DecodeResult<ArchitectureAutoCaptureEventV1> {
  const checked = validateArchitectureAutoCaptureEvent(event);
  if (checked.status !== 'decoded') return checked;
  return { status: 'decoded', value: JSON.parse(event.json) as ArchitectureAutoCaptureEventV1 };
}

export function decodeObservedArchitectureRecord(record: EncodedRecord): DecodeResult<ObservedArchitectureRecord> {
  const checked = validateObservedArchitecture(record);
  if (checked.status !== 'decoded') return checked;
  const parsed = JSON.parse(record.json) as ObservedArchitectureRecord;
  const manifest = readFileGraphManifest(parsed.fileGraph);
  if (manifest.status !== 'ok') return invalid(manifest.reason);
  const inventory = readInventory(parsed.inventory);
  if (inventory.status !== 'ok') return invalid(inventory.reason);
  // Return the decoded coverage entries (closed keys, explicit notes included).
  const languages: LanguageCoverageV1[] = [];
  for (const entry of parsed.languages) {
    const coverage = readLanguageCoverage(entry);
    if (coverage === null) return invalid('ObservedArchitecture has an invalid language coverage entry');
    languages.push(coverage);
  }
  return { status: 'decoded', value: { ...parsed, fileGraph: manifest.value, languages,
    inventory: inventory.value } };
}
export function decodeObservationCurrent(record: EncodedRecord): DecodeResult<WorkspaceArchitectureObservationCurrentRecord> {
  const checked = validateObservationCurrent(record);
  if (checked.status !== 'decoded') return checked;
  return { status: 'decoded', value: JSON.parse(record.json) as WorkspaceArchitectureObservationCurrentRecord };
}
export function decodeArchitectureSourceObservedEvent(event: EncodedDomainEvent): DecodeResult<ArchitectureSourceObservedEventV1> {
  const checked = validateArchitectureSourceObservedEvent(event);
  if (checked.status !== 'decoded') return checked;
  return { status: 'decoded', value: JSON.parse(event.json) as ArchitectureSourceObservedEventV1 };
}
