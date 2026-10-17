/**
 * R3d observed-architecture codecs — the closed registration the observed graph owns.
 *
 * The record store keeps only mechanical envelopes; this file is the single place
 * that decides whether an observed capture record/event and the body it points at
 * are well formed. Nothing here reads files, calls WorkspaceTools or adopts a
 * baseline: an observed capture is evidence of one bounded source read, never the
 * formal `ProjectArchitectureBaselineActive`.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import { COVERAGE_ISSUES_MAX, type FileGraphNodeV1, type LanguageCoverageV1 } from '../../../contracts/architecture-inspection.js';
import type { ArchitectureSourceSnapshotV1 } from '../../../contracts/architecture-source.js';
import { architectureSourceIssues, pathOwnershipOf } from '../../../contracts/architecture-source.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { PersistedSourceCaptureRef, SourceCaptureRef } from '../../../contracts/core/source.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { DecodeResult, EncodedDomainEvent, EncodedRecord, EncodedRecordSchema, RecordBackendSchemas } from '../../record-store/ports.js';
import type { CaptureSummary, SourceCoverage, SourceFileEntry } from '../../workspace/ports.js';
import type { ObservedArchitectureRecord, ObservedArchitectureRef, ObservedFileGraphManifestV1, WorkspaceArchitectureObservationCurrentRecord, WorkspaceArchitectureObservationCurrentRef } from './contracts.js';

export const OBSERVED_ARCHITECTURE_SCHEMA_ID = 'ObservedArchitecture@1';
export const OBSERVATION_CURRENT_SCHEMA_ID = 'WorkspaceArchitectureObservationCurrent@1';
export const ARCHITECTURE_SOURCE_OBSERVED_EVENT = 'ArchitectureSourceObserved';
export const ARCHITECTURE_SOURCE_OBSERVED_EVENT_VERSION = 1;
export const OBSERVED_ARCHITECTURE_BODY_CONTENT_TYPE = 'application/vnd.coding-platform.observed-architecture+json';
/** 8A file-level chunk body (spec L12; lead answer 1). One artifact per chunk. */
export const FILE_GRAPH_CHUNK_SCHEMA_ID = 'ObservedFileGraphChunk@1';
export const FILE_GRAPH_CHUNK_CONTENT_TYPE = 'application/vnd.coding-platform.observed-file-graph-chunk+json';

/** One stored file-level graph chunk; nodes and edges are concatenated in chunk order. */
export type ObservedFileGraphChunkV1 = {
  schemaVersion: 1;
  nodes: FileGraphNodeV1[];
  edges: { from: string; to: string }[];
};

/** Immutable body stored in the RawArtifactStore and referenced by the record. */
export type ObservedArchitectureBodyV1 = {
  schemaVersion: 1;
  capture: SourceCaptureRef;
  observedAt: string;
  summary: CaptureSummary;
  files: SourceFileEntry[];
  architecture: ArchitectureSourceSnapshotV1;
};

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

// --------------------------------------------------------------------------
// Mechanical shape helpers (pure, no I/O)
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
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
function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
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
/** The PRE-8A writer's membership rule: a file belongs to a mapping when ANY of
 * the mapping's paths is a prefix (one trailing `/` stripped, directory
 * boundary). It is never the longest-prefix rule, so a nested mapping keeps the
 * parent's copy of its files too. */
function legacyAnyPrefixMember(path: string, paths: readonly string[]): boolean {
  for (const raw of paths) {
    const prefix = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (prefix.length === 0) continue;
    if (path === prefix || path.startsWith(prefix + '/')) return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// Value readers
// --------------------------------------------------------------------------

const SOURCE_FILE_KINDS: readonly string[] = ['source', 'configuration', 'dependency_manifest', 'text'];
const CONTENT_SCOPE_KINDS: readonly string[] = ['typescript_project_inputs', 'text_files'];
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

function readCoverage(value: unknown): SourceCoverage | null {
  if (!isRecord(value)) return null;
  if (!nonEmpty(value['provider']) || !nonEmpty(value['engine']) || !nonEmpty(value['engineVersion'])) return null;
  if (value['projectConfiguration'] !== null && !nonEmpty(value['projectConfiguration'])) return null;
  if (!isSafeRevision(value['sourceCount']) || !isSafeRevision(value['indexedSourceCount'])) return null;
  if (value['permissionFiltered'] !== true) return null;
  if (typeof value['complete'] !== 'boolean' || value['filesystemAtomic'] !== false || value['fullRuntimeCallGraph'] !== false) return null;
  const scope = value['scope'];
  if (!isRecord(scope) || !CONTENT_SCOPE_KINDS.includes(scope['kind'] as string)) return null;
  if (!Array.isArray(value['unresolved']) || value['unresolved'].some(entry => !nonEmpty(entry))) return null;
  return value as unknown as SourceCoverage;
}

function readSummary(value: unknown, capture: SourceCaptureRef): CaptureSummary | null {
  if (!isRecord(value)) return null;
  const ref = readSourceCaptureRef(value['ref']);
  if (ref === null || canonicalJson(ref as unknown as JsonValue) !== canonicalJson(capture as unknown as JsonValue)) return null;
  if (!nonEmpty(value['capturedAt']) || !nonEmpty(value['verifiedAt']) || !nonEmpty(value['expiresAt'])) return null;
  if (value['commitHash'] !== null && !nonEmpty(value['commitHash'])) return null;
  if (readCoverage(value['coverage']) === null) return null;
  const changes = value['changes'];
  if (!isRecord(changes)) return null;
  for (const list of ['added', 'modified', 'deleted']) {
    const entries = changes[list];
    if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string')) return null;
  }
  return value as unknown as CaptureSummary;
}

function readFileEntries(value: unknown): SourceFileEntry[] | null {
  if (!Array.isArray(value)) return null;
  const files: SourceFileEntry[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    if (!safeRelativePath(entry['path']) || !isSha256(entry['digest'])) return null;
    if (!isSafeRevision(entry['sizeBytes'])) return null;
    if (typeof entry['kind'] !== 'string' || !SOURCE_FILE_KINDS.includes(entry['kind'])) return null;
    files.push({ path: entry['path'], digest: entry['digest'], sizeBytes: entry['sizeBytes'], kind: entry['kind'] as SourceFileEntry['kind'] });
  }
  return new Set(files.map(file => file.path)).size === files.length ? files : null;
}

// --------------------------------------------------------------------------
// 8A file-level graph (chunk body + record manifest)
// --------------------------------------------------------------------------

function readFileGraphNode(value: unknown): FileGraphNodeV1 | null {
  if (!isRecord(value) || !exactKeys(value, ['path', 'nonBlankLines', 'language'])) return null;
  if (!safeRelativePath(value['path'])) return null;
  if (!isSafeRevision(value['nonBlankLines'])) return null;
  if (!nonEmpty(value['language'])) return null;
  return { path: value['path'], nonBlankLines: value['nonBlankLines'], language: value['language'] };
}

function readFileGraphEdges(value: unknown): { from: string; to: string }[] | null {
  if (!Array.isArray(value)) return null;
  const edges: { from: string; to: string }[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !exactKeys(entry, ['from', 'to'])) return null;
    if (!safeRelativePath(entry['from']) || !safeRelativePath(entry['to'])) return null;
    edges.push({ from: entry['from'], to: entry['to'] });
  }
  return edges;
}

function readLanguageCoverage(value: unknown): LanguageCoverageV1 | null {
  if (!isRecord(value) || !exactKeys(value, ['language', 'files', 'parsed', 'edges', 'reason', 'issues', 'issueCount', 'complete'])) return null;
  if (!nonEmpty(value['language'])) return null;
  if (!isSafeRevision(value['files']) || !isSafeRevision(value['parsed'])) return null;
  if (value['edges'] !== 'supported' && value['edges'] !== 'unsupported' && value['edges'] !== 'failed') return null;
  if (value['reason'] !== null && !nonEmpty(value['reason'])) return null;
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
    edges: value['edges'], reason: value['reason'], issues, issueCount: value['issueCount'], complete: value['complete'] };
}

function readFileGraphManifest(value: unknown):
  { status: 'ok'; value: ObservedFileGraphManifestV1 | null } | { status: 'invalid'; reason: string } {
  if (value === undefined || value === null) return { status: 'ok', value: null };
  if (!isRecord(value) || !exactKeys(value, ['chunks', 'nodeCount', 'edgeCount', 'unresolved'])) {
    return { status: 'invalid', reason: 'ObservedArchitecture fileGraph manifest has unknown or missing keys' };
  }
  if (!Array.isArray(value['chunks']) || value['chunks'].length > 64) {
    return { status: 'invalid', reason: 'ObservedArchitecture fileGraph must carry at most 64 chunk refs' };
  }
  const chunks: ArtifactRef[] = [];
  for (const rawRef of value['chunks']) {
    const ref = readArtifactRef(rawRef);
    if (ref === null || ref.contentType !== FILE_GRAPH_CHUNK_CONTENT_TYPE) {
      return { status: 'invalid', reason: 'ObservedArchitecture fileGraph chunk ref is not a file graph chunk artifact' };
    }
    chunks.push(ref);
  }
  if (!isSafeRevision(value['nodeCount']) || !isSafeRevision(value['edgeCount'])) {
    return { status: 'invalid', reason: 'ObservedArchitecture fileGraph counts must be safe non-negative integers' };
  }
  const rawUnresolved = value['unresolved'];
  if (!Array.isArray(rawUnresolved)) {
    return { status: 'invalid', reason: 'ObservedArchitecture fileGraph unresolved must be an array' };
  }
  const unresolved: { from: string; specifier: string }[] = [];
  for (const entry of rawUnresolved) {
    if (!isRecord(entry) || !exactKeys(entry, ['from', 'specifier'])) {
      return { status: 'invalid', reason: 'ObservedArchitecture fileGraph unresolved entry is malformed' };
    }
    if (!safeRelativePath(entry['from']) || !nonEmpty(entry['specifier'])) {
      return { status: 'invalid', reason: 'ObservedArchitecture fileGraph unresolved entry is malformed' };
    }
    unresolved.push({ from: entry['from'], specifier: entry['specifier'] });
  }
  return { status: 'ok', value: { chunks, nodeCount: value['nodeCount'], edgeCount: value['edgeCount'], unresolved } };
}

/** 8A chunk decoder: one chunk body, validated as a closed shape. */
export function decodeObservedFileGraphChunk(json: string): DecodeResult<ObservedFileGraphChunkV1> {
  const parsed = parseObject(json, 'Observed file graph chunk');
  if (typeof parsed === 'string') return invalid(parsed);
  if (!exactKeys(parsed, ['schemaVersion', 'nodes', 'edges'])) return invalid('observed file graph chunk has unknown or missing top-level keys');
  if (parsed['schemaVersion'] !== 1) return invalid('observed file graph chunk schemaVersion must be 1');
  if (!Array.isArray(parsed['nodes'])) return invalid('observed file graph chunk nodes must be an array');
  const nodes: FileGraphNodeV1[] = [];
  for (const raw of parsed['nodes']) {
    const node = readFileGraphNode(raw);
    if (node === null) return invalid('observed file graph chunk has an invalid file node');
    nodes.push(node);
  }
  if (new Set(nodes.map(node => node.path)).size !== nodes.length) return invalid('observed file graph chunk has a duplicate file node');
  const edges = readFileGraphEdges(parsed['edges']);
  if (edges === null) return invalid('observed file graph chunk has an invalid edge list');
  return { status: 'decoded', value: { schemaVersion: 1, nodes, edges } };
}

// --------------------------------------------------------------------------
// Persisted body
// --------------------------------------------------------------------------

const BODY_KEYS: readonly string[] = ['schemaVersion', 'capture', 'observedAt', 'summary', 'files', 'architecture'];

export function decodeObservedArchitectureBody(json: string,
  ownership: 'longest' | 'legacy_any_prefix' = 'longest'): DecodeResult<ObservedArchitectureBodyV1> {
  const parsed = parseObject(json, 'Observed architecture body');
  if (typeof parsed === 'string') return invalid(parsed);
  if (!exactKeys(parsed, BODY_KEYS)) return invalid('observed architecture body has unknown or missing top-level keys');
  if (parsed['schemaVersion'] !== 1) return invalid('observed architecture body schemaVersion must be 1');
  const capture = readSourceCaptureRef(parsed['capture']);
  if (capture === null) return invalid('observed architecture body has no complete source capture ref');
  if (!nonEmpty(parsed['observedAt'])) return invalid('observed architecture body observedAt must be a non-empty string');
  const summary = readSummary(parsed['summary'], capture);
  if (summary === null) return invalid('observed architecture body has an invalid capture summary');
  const files = readFileEntries(parsed['files']);
  if (files === null) return invalid('observed architecture body has invalid frozen files');
  const architecture = readArchitectureSnapshot(parsed['architecture']);
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
  if (architecture.commitHash !== summary.commitHash) {
    return invalid('observed architecture commitHash disagrees with the capture summary');
  }
  if (architecture.configPath !== summary.coverage.projectConfiguration) {
    return invalid('observed architecture configPath disagrees with the capture summary');
  }
  // The exact indexed graph inputs must exist and be shape-valid (architectureSourceIssues).
  // Membership is matched by path+digest against the frozen files with a Map: a JSON module that
  // TypeScript really indexed is a member even though its extension labels it configuration, while
  // the tsconfig itself never becomes indexed source merely because its path looks like a member.
  if (architecture.indexedSources === undefined) return invalid('observed architecture body has no indexed source manifest');
  const indexedSources = architecture.indexedSources;
  const frozenDigestByPath = new Map(files.map(file => [file.path, file.digest]));
  for (const source of indexedSources) {
    if (frozenDigestByPath.get(source.path) !== source.digest) {
      return invalid('observed architecture indexed source is not a frozen file member: ' + source.path);
    }
  }
  // A node is legal only as the explicit `kind:id` mapping whose representative path is `paths[0]`
  // (`mapArchitectureSource` keeps it even when it is a directory or missing). Its contentDigest must
  // equal sha256 of canonically-serialized indexed members in the manifest order: no re-sorting, so
  // the recorded provenance summary is reproduced exactly.
  const mappingByStructuralKey = new Map(architecture.mappings.map(mapping => [mapping.kind + ':' + mapping.id, mapping]));
  const mappingIndexByStructuralKey = new Map(architecture.mappings.map((mapping, index) => [mapping.kind + ':' + mapping.id, index]));
  // The membership recomputation reproduces the rule that wrote the body. A
  // post-8A body carries `fileGraph` and was written with the SAME longest-prefix
  // ownership decision as capture (`mapArchitectureSource`): `.` is the root at
  // match length 0 and a concrete prefix wins; an equal-longest tie means the
  // file belongs to NO mapping. A pre-8A body has no `fileGraph`; its writer put
  // a file in EVERY mapping whose path is any prefix of it, so `loadObservation`
  // passes `legacy_any_prefix` in that case.
  const ownerIndexBySource = new Map<string, number | null>();
  if (ownership === 'longest') {
    const ownershipCandidates = architecture.mappings.map((mapping, index) => ({ value: index, paths: mapping.paths }));
    for (const source of indexedSources) {
      const result = pathOwnershipOf(source.path, ownershipCandidates);
      ownerIndexBySource.set(source.path, result.status === 'owner' ? result.owner : null);
    }
  }
  for (const node of architecture.nodes) {
    const mapping = mappingByStructuralKey.get(node.structuralKey);
    if (mapping === undefined) return invalid('observed architecture node has no explicit mapping ' + node.structuralKey);
    if (node.nodeId !== node.structuralKey || node.kind !== mapping.kind || node.name !== mapping.id || node.path !== mapping.paths[0]) {
      return invalid('observed architecture node identity or representative path disagrees with its mapping');
    }
    const mappingIndex = mappingIndexByStructuralKey.get(node.structuralKey)!;
    const members = indexedSources
      .filter(source => ownership === 'legacy_any_prefix'
        ? legacyAnyPrefixMember(source.path, mapping.paths)
        : ownerIndexBySource.get(source.path) === mappingIndex)
      .map(source => ({ path: source.path, digest: source.digest }));
    if (members.length === 0) return invalid('observed architecture node has no indexed source member for mapping ' + node.structuralKey);
    if (node.contentDigest !== sha256Hex(canonicalJson(members as unknown as JsonValue))) {
      return invalid('observed architecture node contentDigest disagrees with its indexed members');
    }
  }
  if (architecture.configPath !== null && !files.some(file => file.path === architecture.configPath || file.path.startsWith(architecture.configPath + '/'))) {
    return invalid('observed architecture body has no frozen file for its configuration path');
  }
  return { status: 'decoded', value: { schemaVersion: 1, capture, observedAt: parsed['observedAt'], summary, files, architecture } };
}

// --------------------------------------------------------------------------
// Registered record/event validators
// --------------------------------------------------------------------------

function validateObservedArchitecture(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== OBSERVED_ARCHITECTURE_SCHEMA_ID) return invalid('expected schemaId ' + OBSERVED_ARCHITECTURE_SCHEMA_ID + ', got ' + record.schemaId);
  const parsed = parseObject(record.json, 'ObservedArchitecture record');
  if (typeof parsed === 'string') return invalid(parsed);
  // 8A adds two OPTIONAL fields; every other key stays closed so a drifted body
  // cannot hide behind an unread field. Old rows omit both and still decode.
  const requiredKeys = ['ref', 'revision', 'schemaVersion', 'source', 'observedAt'];
  const allowedKeys = [...requiredKeys, 'fileGraph', 'languages'];
  if (!requiredKeys.every(key => Object.prototype.hasOwnProperty.call(parsed, key))
    || Object.keys(parsed).some(key => !allowedKeys.includes(key))) {
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
  if (parsed['languages'] !== undefined) {
    if (!Array.isArray(parsed['languages'])) return invalid('ObservedArchitecture languages must be an array');
    for (const coverage of parsed['languages']) if (readLanguageCoverage(coverage) === null) return invalid('ObservedArchitecture has an invalid language coverage entry');
  }
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
// Registration and encoders
// --------------------------------------------------------------------------

const OBSERVED_ARCHITECTURE_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: OBSERVED_ARCHITECTURE_SCHEMA_ID, aggregateType: 'ObservedArchitecture', validate: validateObservedArchitecture,
};
const OBSERVATION_CURRENT_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: OBSERVATION_CURRENT_SCHEMA_ID, aggregateType: 'WorkspaceArchitectureObservationCurrent', validate: validateObservationCurrent,
};

export const OBSERVED_ARCHITECTURE_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [OBSERVED_ARCHITECTURE_RECORD_SCHEMA, OBSERVATION_CURRENT_RECORD_SCHEMA],
  events: [{ eventType: ARCHITECTURE_SOURCE_OBSERVED_EVENT, schemaVersion: ARCHITECTURE_SOURCE_OBSERVED_EVENT_VERSION, validate: validateArchitectureSourceObservedEvent }],
  lookups: [],
};

export function encodeObservedArchitecture(record: ObservedArchitectureRecord): EncodedRecord {
  return { refKey: canonicalJson(record.ref as unknown as JsonValue), schemaId: OBSERVED_ARCHITECTURE_SCHEMA_ID, revision: record.revision, json: JSON.stringify(record) };
}
export function encodeObservationCurrent(record: WorkspaceArchitectureObservationCurrentRecord): EncodedRecord {
  return { refKey: canonicalJson(record.ref as unknown as JsonValue), schemaId: OBSERVATION_CURRENT_SCHEMA_ID, revision: record.revision, json: JSON.stringify(record) };
}
export function encodeArchitectureSourceObservedEvent(event: ArchitectureSourceObservedEventV1): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion, occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

export function decodeObservedArchitectureRecord(record: EncodedRecord): DecodeResult<ObservedArchitectureRecord> {
  const checked = validateObservedArchitecture(record);
  if (checked.status !== 'decoded') return checked;
  const parsed = JSON.parse(record.json) as Omit<ObservedArchitectureRecord, 'fileGraph' | 'languages'>
    & { fileGraph?: ObservedFileGraphManifestV1 | null; languages?: LanguageCoverageV1[] };
  // 8A: a row written before the file layer has neither key; it reads as null/[].
  const manifest = readFileGraphManifest(parsed.fileGraph);
  if (manifest.status !== 'ok') return invalid(manifest.reason);
  return { status: 'decoded', value: { ...parsed, fileGraph: manifest.value, languages: parsed.languages ?? [] } };
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
