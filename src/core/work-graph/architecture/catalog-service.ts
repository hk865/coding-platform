/**
 * A1 formal architecture catalog service.
 *
 * `adoptInitialArchitecture` is the thin initial Host acceptance entry for the
 * FIRST formal architecture. It refuses a project that already has an active
 * baseline instead of bypassing the later evolution protocol. One RecordStore
 * commit writes the immutable baseline, the catalog row (same baselineId/
 * revision, aggregateType `ArchitectureCatalog`) and the
 * `ProjectArchitectureBaselineActive` pointer, plus the adoption event and the
 * idempotency identity. There is no separate current-catalog pointer.
 *
 * The baseline content keeps the existing canonical digest shape so the real
 * Plan governance reader (`resolveGovernance`) can consume it. Same actor/
 * requestId with the same input replays the original receipt (read back from the
 * original event, never recomputed against the now-active pointer); different
 * input conflicts. A peer commit may land in the window between the early
 * identity lookup and this commit, so a `revision_conflict` failure re-queries
 * that exact identity before giving up.
 *
 * `readCatalogModuleFacts` is the narrow read-only seam the Session writer uses
 * to prove a module belongs to the CURRENT formal catalog and to collect the
 * exact baseline/catalog/active guards it must join to its own CAS. It is not a
 * provider framework.
 */
import { randomUUID } from 'node:crypto';
import { commandIdentityKey } from '../../../contracts/command-event.js';
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef, VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { ArchitectureBaselinePin, ArchitectureBaselineRevisionRef } from '../../../contracts/governance.js';
import type { ProjectRef, WorkspaceRef } from '../../../contracts/ledger.js';
import type { EncodedRecord, GoalRecordTransactionPort, RecordGuard, StoreFailure } from '../../record-store/ports.js';
import type {
  AdoptInitialArchitectureInput, ArchitectureBaselineContentV1, ArchitectureBaselineRevisionSnapshot,
  ArchitectureCatalogPort, ArchitectureCatalogRecord, ArchitectureCatalogRef, ArchitectureRevision,
  CatalogModuleFacts, ReadArchitectureRevisionInput, ReviseArchitectureCatalogInput,
} from './catalog-contracts.js';
import type { GraphWrite } from './contracts.js';
import {
  ARCHITECTURE_CATALOG_ADOPTED_EVENT, ARCHITECTURE_CATALOG_REVISED_EVENT, architectureBaselineDigest,
  decodeArchitectureCatalogAdoptedEvent, decodeArchitectureCatalogRecord, decodeArchitectureCatalogRevisedEvent,
  encodeArchitectureCatalog, encodeArchitectureCatalogAdoptedEvent, encodeArchitectureCatalogRevisedEvent,
  readArchitectureBaselinePin, readArchitectureBaselineRef, readArchitectureBaselineSnapshot, readConstraints,
  readModuleRef, validateAdoptedArchitecture,
  type ArchitectureCatalogAdoptedEventV1, type ArchitectureCatalogRevisedEventV1,
} from './catalog-record-codecs.js';
import { decodeProjectSnapshot, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { projectRefFor, workspaceRefFor } from '../persistence/commit-compiler.js';

export { ARCHITECTURE_CATALOG_SCHEMAS } from './catalog-record-codecs.js';

/** Records only: the catalog shares the baseline/active transaction and needs no
 * second store, body or index. */
export type ArchitectureCatalogStores = { records: GoalRecordTransactionPort };

const ADOPT_IDENTITY_PREFIX = 'architecture-catalog-adopt:';
const ADOPT_COMMAND_TYPE = 'AdoptInitialArchitecture';
const REVISE_IDENTITY_PREFIX = 'architecture-catalog-revise:';
const REVISE_COMMAND_TYPE = 'ReviseArchitectureCatalog';
const MAX_REVISE_REASON_BYTES = 2048;
const BASELINE_SCHEMA_ID = 'ArchitectureBaselineRevisionSnapshot@1';
const BASELINE_ACTIVE_SCHEMA_ID = 'ProjectArchitectureBaselineActiveSnapshot@1';

type Rejection = { status: 'rejected'; code: CoreError; reason: string; current?: VersionPin[] };
type Owned<T> = { status: 'owned'; value: T } | { status: 'invalid'; reason: string };
type CommitReceipt = Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>;

// --------------------------------------------------------------------------
// Result helpers
// --------------------------------------------------------------------------

function rejected(code: CoreError, reason: string): Rejection {
  return { status: 'rejected', code, reason };
}
function forbidden(reason: string): Rejection { return rejected('forbidden', reason); }
function invalid(reason: string): Rejection { return rejected('invalid', reason); }
function unavailable(reason: string): Rejection { return rejected('unavailable', reason); }
function asReadResult<T>(rejection: Rejection): ReadResult<T> {
  return rejection.code === 'not_found' ? { status: 'not_found' } : rejection;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function mapStoreFailure(failure: StoreFailure): Rejection {
  switch (failure.code) {
    case 'not_found': return rejected('not_found', failure.reason);
    case 'invalid': return invalid(failure.reason);
    case 'unsupported': return unavailable(failure.reason);
    case 'corrupt': return unavailable('corrupt: ' + failure.reason);
    case 'unique_conflict':
    case 'unavailable': return unavailable(failure.reason);
    // The Store's own idempotency verdict is preserved: a same-identity commit
    // with a different fingerprint must never be flattened into `unavailable`.
    case 'idempotency_conflict': return rejected('idempotency_conflict', failure.reason);
    case 'revision_conflict': return rejected('revision_conflict', failure.reason);
  }
}

// --------------------------------------------------------------------------
// Mechanical shape helpers
// --------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}
/** Structural copy only. Serializing through JSON would silently drop
 * undefined-valued keys before exact validation, laundering an unknown field
 * into a valid shape and changing idempotency semantics. */
function ownJsonInput<T>(value: T, what: string): Owned<T> {
  try {
    return { status: 'owned', value: structuredClone(value) };
  } catch (error) {
    return { status: 'invalid', reason: what + ' cannot be isolated from the caller: ' + messageOf(error) };
  }
}
function parseRecordBody(record: EncodedRecord): unknown {
  try { return JSON.parse(record.json); } catch { return null; }
}
function activeRefKey(projectId: string): string {
  return canonicalJson({ aggregateType: 'ProjectArchitectureBaselineActive', projectId } as unknown as JsonValue);
}
function baselineRefFor(projectId: string, baselineId: string, revision: number): ArchitectureBaselineRevisionRef {
  return { aggregateType: 'ArchitectureBaselineRevision', projectId, baselineId, revision };
}
function catalogRefFor(projectId: string, baselineId: string, revision: number): ArchitectureCatalogRef {
  return { aggregateType: 'ArchitectureCatalog', projectId, baselineId, revision };
}
function decodeActivePointer(record: EncodedRecord): { status: 'ok'; value: ArchitectureBaselineRevisionRef } | Rejection {
  const parsed = parseRecordBody(record);
  if (!isRecord(parsed)) return unavailable('the active baseline pointer is not valid JSON');
  if (parsed['revision'] !== record.revision) return unavailable('the active baseline pointer revision disagrees with its body');
  const active = readArchitectureBaselineRef(parsed['activeRevision']);
  if (active === null) return unavailable('the active baseline pointer does not name a legal baseline revision');
  return { status: 'ok', value: active };
}

// --------------------------------------------------------------------------
// Trusted caller binding and pins
// --------------------------------------------------------------------------

type HostActor = Extract<ActorRef, { kind: 'human' | 'system' }>;

function bindHostWriteContext(ctx: CoreCallContext, projectId: string, workspaceId: string):
  { status: 'ok'; actor: HostActor } | Rejection {
  if (!ctx || typeof ctx !== 'object') return forbidden('a bound call context is required');
  if (ctx.projectId !== projectId) return forbidden('the call context is outside the requested project');
  if (ctx.workspaceId !== workspaceId) return forbidden('the call context is outside the requested workspace');
  if (ctx.principal.kind !== 'host') return forbidden('architecture adoption is admitted only through a host principal');
  const actor = ctx.principal.actor;
  if (actor.kind !== 'human' && actor.kind !== 'system') return forbidden('architecture adoption requires a trusted human or system actor');
  return { status: 'ok', actor };
}

type AdoptionPins = {
  status: 'ok';
  project: { ref: ProjectRef; revision: number };
  workspace: { ref: WorkspaceRef; revision: number };
} | Rejection;

/** Exactly the Project and Workspace pins: extra, missing, duplicate or
 * non-scope pins are input errors, not silently ignored defaults. */
function readAdoptionPins(expected: unknown): AdoptionPins {
  if (!Array.isArray(expected)) return invalid('meta.expected must be an array of version pins');
  if (expected.length !== 2) return invalid('adoption requires exactly the Project and Workspace version pins');
  let project: { ref: ProjectRef; revision: number } | null = null;
  let workspace: { ref: WorkspaceRef; revision: number } | null = null;
  const seen = new Set<string>();
  for (const entry of expected) {
    if (!isRecord(entry)) return invalid('every version pin must be an object');
    const revision = entry['revision'];
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      return invalid('a version pin revision must be a safe non-negative integer');
    }
    const ref = entry['ref'];
    if (!isRecord(ref)) return invalid('a version pin ref must be an object');
    if (ref['aggregateType'] === 'Project') {
      if (!exactKeys(ref, ['aggregateType', 'projectId']) || !nonEmpty(ref['projectId'])) {
        return invalid('a Project version pin must carry only aggregateType and projectId');
      }
      const scalar: ProjectRef = { aggregateType: 'Project', projectId: ref['projectId'] };
      const key = canonicalJson(scalar as unknown as JsonValue);
      if (seen.has(key)) return invalid('duplicate version pin');
      seen.add(key);
      project = { ref: scalar, revision };
    } else if (ref['aggregateType'] === 'Workspace') {
      if (!exactKeys(ref, ['aggregateType', 'projectId', 'workspaceId']) || !nonEmpty(ref['projectId']) || !nonEmpty(ref['workspaceId'])) {
        return invalid('a Workspace version pin must carry aggregateType, projectId and workspaceId');
      }
      const scalar: WorkspaceRef = { aggregateType: 'Workspace', projectId: ref['projectId'], workspaceId: ref['workspaceId'] };
      const key = canonicalJson(scalar as unknown as JsonValue);
      if (seen.has(key)) return invalid('duplicate version pin');
      seen.add(key);
      workspace = { ref: scalar, revision };
    } else {
      return invalid('adoption accepts only Project and Workspace version pins');
    }
  }
  if (project === null || workspace === null) return invalid('adoption requires exactly the Project and Workspace version pins');
  if (project.ref.projectId !== workspace.ref.projectId) return invalid('the Project and Workspace pins must share one project');
  return { status: 'ok', project, workspace };
}

function compareAdoptionPins(pins: Extract<AdoptionPins, { status: 'ok' }>, projectRevision: number, workspaceRevision: number): Rejection | null {
  const current: VersionPin[] = [];
  if (pins.project.revision !== projectRevision) current.push({ ref: pins.project.ref, revision: projectRevision });
  if (pins.workspace.revision !== workspaceRevision) current.push({ ref: pins.workspace.ref, revision: workspaceRevision });
  return current.length === 0 ? null
    : { status: 'rejected', code: 'revision_conflict', reason: 'the supplied project/workspace pins do not match the canonical scope', current };
}

// --------------------------------------------------------------------------
// Canonical read window
// --------------------------------------------------------------------------

type AdoptionScope = { status: 'ready'; projectRevision: number; workspaceRevision: number } | Rejection;

/** One read window settles the canonical Project/Workspace revisions and proves
 * that the active/baseline/catalog slots are absent. The commit re-checks all
 * three with null guards, so a concurrent first adoption cannot slip through. */
async function readAdoptionScope(records: GoalRecordTransactionPort, pins: Extract<AdoptionPins, { status: 'ok' }>,
  projectId: string, workspaceId: string, baselineId: string): Promise<AdoptionScope> {
  const projectKey = canonicalJson(projectRefFor(projectId) as unknown as JsonValue);
  const workspaceKey = canonicalJson(workspaceRefFor(projectId, workspaceId) as unknown as JsonValue);
  const baselineKey = canonicalJson(baselineRefFor(projectId, baselineId, 1) as unknown as JsonValue);
  const catalogKey = canonicalJson(catalogRefFor(projectId, baselineId, 1) as unknown as JsonValue);
  const activeKey = activeRefKey(projectId);
  const read = await records.readMany([projectKey, workspaceKey, activeKey, baselineKey, catalogKey]);
  if (read.status !== 'ready') return mapStoreFailure(read);
  const byKey = new Map(read.value.records.map(record => [record.refKey, record]));
  const projectRecord = byKey.get(projectKey);
  const workspaceRecord = byKey.get(workspaceKey);
  if (projectRecord === undefined || workspaceRecord === undefined) {
    return rejected('not_found', 'the project and workspace canonical records must exist before an adoption');
  }
  const project = decodeProjectSnapshot(projectRecord);
  const workspace = decodeWorkspaceSnapshot(workspaceRecord);
  if (project.status !== 'decoded' || workspace.status !== 'decoded') return unavailable('the canonical project/workspace records are damaged');
  const pinConflict = compareAdoptionPins(pins, project.value.revision, workspace.value.revision);
  if (pinConflict !== null) return pinConflict;
  if (byKey.has(activeKey)) return rejected('revision_conflict', 'the project already has an active architecture baseline');
  if (byKey.has(baselineKey)) return rejected('revision_conflict', 'that architecture baseline revision already exists');
  if (byKey.has(catalogKey)) return rejected('revision_conflict', 'that architecture catalog revision already exists');
  return { status: 'ready', projectRevision: project.value.revision, workspaceRevision: workspace.value.revision };
}

type CallerScope = { status: 'ready'; projectRevision: number; workspaceRevision: number } | Rejection;

/** Reads the exact Project/Workspace caller pins for a revision. It reuses the
 * adoption pin comparison but does not require the catalog slots to be absent:
 * the revision commit re-checks every intersected row with its own guards. */
async function readCallerScope(records: GoalRecordTransactionPort, pins: Extract<AdoptionPins, { status: 'ok' }>,
  projectId: string, workspaceId: string): Promise<CallerScope> {
  const projectKey = canonicalJson(projectRefFor(projectId) as unknown as JsonValue);
  const workspaceKey = canonicalJson(workspaceRefFor(projectId, workspaceId) as unknown as JsonValue);
  const read = await records.readMany([projectKey, workspaceKey]);
  if (read.status !== 'ready') return mapStoreFailure(read);
  const byKey = new Map(read.value.records.map(record => [record.refKey, record]));
  const projectRecord = byKey.get(projectKey);
  const workspaceRecord = byKey.get(workspaceKey);
  if (projectRecord === undefined || workspaceRecord === undefined) {
    return rejected('not_found', 'the project and workspace canonical records must exist before a catalog revision');
  }
  const project = decodeProjectSnapshot(projectRecord);
  const workspace = decodeWorkspaceSnapshot(workspaceRecord);
  if (project.status !== 'decoded' || workspace.status !== 'decoded') return unavailable('the canonical project/workspace records are damaged');
  const pinConflict = compareAdoptionPins(pins, project.value.revision, workspace.value.revision);
  if (pinConflict !== null) return pinConflict;
  return { status: 'ready', projectRevision: project.value.revision, workspaceRevision: workspace.value.revision };
}

// --------------------------------------------------------------------------
// Replay restoration (original event only, never the current pointer)
// --------------------------------------------------------------------------

async function restoreAdopted(records: GoalRecordTransactionPort,
  receipt: CommitReceipt,
  expected: { identityKey: string; projectId: string; baselineId: string }):
  Promise<{ status: 'restored'; value: ArchitectureRevision } | Rejection> {
  if (receipt.identityKey !== expected.identityKey) return unavailable('the idempotency receipt belongs to another identity');
  if (receipt.eventIds.length !== 1) return unavailable('the adoption receipt must reference exactly one event');
  const located = await records.eventAt(receipt.cursor);
  if (located.status !== 'ready') return mapStoreFailure(located);
  if (String(located.value.cursor) !== String(receipt.cursor)) return unavailable('eventAt returned a different cursor');
  const decoded = decodeArchitectureCatalogAdoptedEvent(located.value.event);
  if (decoded.status !== 'decoded') return unavailable('the original adoption event is corrupt: ' + decoded.reason);
  const event = decoded.value;
  if (event.eventId !== receipt.eventIds[0]) return unavailable('the receipt points at another event');
  if (event.projectId !== expected.projectId
    || event.baselineRef.projectId !== expected.projectId || event.baselineRef.baselineId !== expected.baselineId) {
    return unavailable('the original adoption event is outside the recovered scope');
  }
  const catalogRecord: ArchitectureCatalogRecord = {
    ref: event.catalogRef, revision: 1, baselineRef: event.baselineRef, schemaVersion: 1, catalog: event.catalog,
  };
  return { status: 'restored', value: { baseline: event.baseline, catalog: catalogRecord } };
}

/** Restores the exact `ArchitectureRevision` embedded in the ORIGINAL revision
 * event, never recomputed against the later active pointer. */
async function restoreRevised(records: GoalRecordTransactionPort, receipt: CommitReceipt,
  expected: { identityKey: string; projectId: string; basedOn: ArchitectureBaselinePin }):
  Promise<{ status: 'restored'; value: ArchitectureRevision } | Rejection> {
  if (receipt.identityKey !== expected.identityKey) return unavailable('the idempotency receipt belongs to another identity');
  if (receipt.eventIds.length !== 1) return unavailable('the revision receipt must reference exactly one event');
  const located = await records.eventAt(receipt.cursor);
  if (located.status !== 'ready') return mapStoreFailure(located);
  if (String(located.value.cursor) !== String(receipt.cursor)) return unavailable('eventAt returned a different cursor');
  const decoded = decodeArchitectureCatalogRevisedEvent(located.value.event);
  if (decoded.status !== 'decoded') return unavailable('the original revision event is corrupt: ' + decoded.reason);
  const event = decoded.value;
  if (event.eventId !== receipt.eventIds[0]) return unavailable('the receipt points at another event');
  if (event.identityKey !== expected.identityKey) return unavailable('the original revision event belongs to another identity');
  if (event.projectId !== expected.projectId || event.fromPin.ref.projectId !== expected.projectId) {
    return unavailable('the original revision event is outside the recovered scope');
  }
  if (canonicalJson(event.fromPin as unknown as JsonValue) !== canonicalJson(expected.basedOn as unknown as JsonValue)) {
    return unavailable('the original revision event does not match the requested baseline pin');
  }
  return { status: 'restored', value: event.revision };
}

/**
 * A peer using the same identity may commit between this call's early lookup and
 * its own scope read/commit. On a `revision_conflict` failure, re-query exactly
 * that identity: a matching fingerprint restores the original event result, a
 * different fingerprint is an idempotency conflict, and only a genuine absence
 * keeps the conflict verdict. This is one precise lookup on the failure path,
 * not a new transaction layer or a whole-ledger scan.
 */
async function recoverConflictByIdentity<T>(records: GoalRecordTransactionPort, identityKey: string, fingerprint: string,
  fallback: Rejection, restore: (receipt: CommitReceipt) => Promise<{ status: 'restored'; value: T } | Rejection>):
  Promise<{ status: 'committed'; value: T; replayed: true; cursor: CommitCursor } | Rejection> {
  const requery = await records.lookupCommit({ identityKey, fingerprint });
  if (requery.status === 'ready') {
    const restored = await restore(requery.value);
    if (restored.status !== 'restored') return restored;
    return { status: 'committed', value: restored.value, replayed: true, cursor: requery.value.cursor };
  }
  if (requery.code === 'idempotency_conflict') return rejected('idempotency_conflict', requery.reason);
  if (requery.code !== 'not_found') return unavailable(requery.code + ': ' + requery.reason);
  return fallback;
}

// --------------------------------------------------------------------------
// Reads
// --------------------------------------------------------------------------

type CurrentCatalogWindow =
  | { status: 'ready'; baseline: ArchitectureBaselineRevisionSnapshot; catalog: ArchitectureCatalogRecord | null;
      guards: RecordGuard[]; activeRevision: number }
  | { status: 'not_found' }
  | Rejection;

/**
 * The ONE current-pointer read: it resolves the active baseline revision, reads
 * the pointer together with the baseline and catalog it names in a second
 * window, re-verifies the pointer (so a concurrent activation cannot mix
 * versions) and returns both the decoded revision and the exact guards a CAS
 * caller must join. `readCurrentRevision` and `readCatalogModuleFacts` share it.
 */
async function readCurrentCatalogWindow(records: GoalRecordTransactionPort, projectId: string): Promise<CurrentCatalogWindow> {
  const activeKey = activeRefKey(projectId);
  const pointerRead = await records.readMany([activeKey]);
  if (pointerRead.status !== 'ready') return mapStoreFailure(pointerRead);
  const pointer = pointerRead.value.records.find(record => record.refKey === activeKey);
  if (pointer === undefined) return { status: 'not_found' };
  const pointerDecoded = decodeActivePointer(pointer);
  if (pointerDecoded.status !== 'ok') return pointerDecoded;
  const baselineRef = pointerDecoded.value;
  const baselineKey = canonicalJson(baselineRef as unknown as JsonValue);
  const catalogKey = canonicalJson(catalogRefFor(projectId, baselineRef.baselineId, baselineRef.revision) as unknown as JsonValue);
  const read = await records.readMany([activeKey, baselineKey, catalogKey]);
  if (read.status !== 'ready') return mapStoreFailure(read);
  const byKey = new Map(read.value.records.map(record => [record.refKey, record]));
  const pointerAgain = byKey.get(activeKey);
  if (pointerAgain === undefined) return rejected('source_stale', 'the active baseline pointer disappeared while it was read');
  const again = decodeActivePointer(pointerAgain);
  if (again.status !== 'ok') return again;
  if (pointerAgain.revision !== pointer.revision
    || canonicalJson(again.value as unknown as JsonValue) !== canonicalJson(baselineRef as unknown as JsonValue)) {
    return rejected('source_stale', 'the active baseline pointer changed while it was read');
  }
  const baselineRecord = byKey.get(baselineKey);
  if (baselineRecord === undefined) return unavailable('the activated architecture baseline is missing');
  const baseline = readArchitectureBaselineSnapshot(parseRecordBody(baselineRecord));
  if (baseline === null) return unavailable('the activated architecture baseline is damaged or digest-inconsistent');
  let catalog: ArchitectureCatalogRecord | null = null;
  const catalogRecord = byKey.get(catalogKey);
  if (catalogRecord !== undefined) {
    const decoded = decodeArchitectureCatalogRecord(catalogRecord);
    if (decoded.status !== 'decoded') return unavailable('the architecture catalog record is damaged: ' + decoded.reason);
    if (canonicalJson(decoded.value.baselineRef as unknown as JsonValue) !== canonicalJson(baselineRef as unknown as JsonValue)) {
      return unavailable('the architecture catalog does not name the active baseline revision');
    }
    catalog = decoded.value;
  }
  const guards: RecordGuard[] = [
    { refKey: baselineKey, expectedRevision: baselineRecord.revision },
    { refKey: activeKey, expectedRevision: pointer.revision },
    ...(catalogRecord === undefined ? [] : [{ refKey: catalogKey, expectedRevision: catalogRecord.revision }]),
  ];
  return { status: 'ready', baseline, catalog, guards, activeRevision: pointer.revision };
}

/** Reads the optional catalog row for a known baseline revision. A historical
 * baseline with no catalog reads `catalog: null`; a present but damaged or
 * mismatched catalog is `unavailable`, never a guessed empty catalog. */
function readCatalogBesideBaseline(baselineRef: ArchitectureBaselineRevisionRef, catalogKey: string,
  byKey: Map<string, EncodedRecord>): { status: 'ok'; value: ArchitectureCatalogRecord | null } | { status: 'rejected'; rejection: Rejection } {
  const catalogRecord = byKey.get(catalogKey);
  if (catalogRecord === undefined) return { status: 'ok', value: null };
  const decoded = decodeArchitectureCatalogRecord(catalogRecord);
  if (decoded.status !== 'decoded') return { status: 'rejected', rejection: unavailable('the architecture catalog record is damaged: ' + decoded.reason) };
  if (canonicalJson(decoded.value.baselineRef as unknown as JsonValue) !== canonicalJson(baselineRef as unknown as JsonValue)) {
    return { status: 'rejected', rejection: unavailable('the architecture catalog does not name the baseline revision it was read beside') };
  }
  return { status: 'ok', value: decoded.value };
}

async function readRevisionByRef(records: GoalRecordTransactionPort, ref: ArchitectureBaselineRevisionRef): Promise<ReadResult<ArchitectureRevision>> {
  const baselineKey = canonicalJson(ref as unknown as JsonValue);
  const catalogKey = canonicalJson(catalogRefFor(ref.projectId, ref.baselineId, ref.revision) as unknown as JsonValue);
  const read = await records.readMany([baselineKey, catalogKey]);
  if (read.status !== 'ready') return asReadResult(mapStoreFailure(read));
  const byKey = new Map(read.value.records.map(record => [record.refKey, record]));
  const baselineRecord = byKey.get(baselineKey);
  if (baselineRecord === undefined) return { status: 'not_found' };
  const baseline = readArchitectureBaselineSnapshot(parseRecordBody(baselineRecord));
  if (baseline === null) return unavailable('the requested architecture baseline is damaged or digest-inconsistent');
  const catalog = readCatalogBesideBaseline(ref, catalogKey, byKey);
  if (catalog.status !== 'ok') return catalog.rejection;
  return { status: 'ready', value: { baseline, catalog: catalog.value } };
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createArchitectureCatalogService(stores: ArchitectureCatalogStores): ArchitectureCatalogPort {
  const { records } = stores;

  async function adoptInitialArchitecture(ctx: CoreCallContext,
    request: GraphWrite<AdoptInitialArchitectureInput>): Promise<WriteResult<ArchitectureRevision>> {
    // Synchronous structural isolation: a caller mutating the request after this
    // call cannot change the adoption. Exact validation below sees every field,
    // including an undefined-valued unknown one.
    const owned = ownJsonInput(request, 'adoptInitialArchitecture request');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const body = owned.value as unknown as { input?: unknown; meta?: unknown };
    const rawInput = body.input;
    const rawMeta = body.meta;
    if (!isRecord(rawInput) || !isRecord(rawMeta)) return invalid('adoptInitialArchitecture requires an input and meta object');
    if (!exactKeys(rawInput, ['baselineId', 'catalog', 'description', 'constraints'])) {
      return invalid('adoptInitialArchitecture.input must carry exactly baselineId, catalog, description and constraints');
    }
    const baselineId = rawInput['baselineId'];
    if (!nonEmpty(baselineId)) return invalid('adoptInitialArchitecture requires a non-empty baselineId');
    const description = rawInput['description'];
    if (typeof description !== 'string') return invalid('adoptInitialArchitecture requires a string description');
    const constraints = readConstraints(rawInput['constraints']);
    if (constraints === null) return invalid('constraints must be a list of {name, scope} pairs');
    const requestId = rawMeta['requestId'];
    if (!nonEmpty(requestId)) return invalid('adoptInitialArchitecture requires meta.requestId');
    const pins = readAdoptionPins(rawMeta['expected']);
    if (pins.status !== 'ok') return pins;
    const projectId = pins.project.ref.projectId;
    const workspaceId = pins.workspace.ref.workspaceId;
    const bound = bindHostWriteContext(ctx, projectId, workspaceId);
    if (bound.status !== 'ok') return bound;
    if (ctx.signal.aborted) return rejected('cancelled', 'the adoption was cancelled before admission');
    const candidate = validateAdoptedArchitecture(rawInput['catalog'], projectId);
    if (candidate.status !== 'ok') return rejected(candidate.code, candidate.reason);
    const catalog = candidate.value;

    const fingerprint = sha256Hex(canonicalJson({
      schemaVersion: 1, commandType: ADOPT_COMMAND_TYPE, projectId, workspaceId, baselineId,
      description, constraints, catalog,
      expected: {
        project: { ref: pins.project.ref, revision: pins.project.revision },
        workspace: { ref: pins.workspace.ref, revision: pins.workspace.revision },
      },
    } as unknown as JsonValue));
    const identityKey = ADOPT_IDENTITY_PREFIX + commandIdentityKey({ projectId, actor: bound.actor, idempotencyKey: requestId });
    const expectedIdentity = { identityKey, projectId, baselineId };

    const early = await records.lookupCommit({ identityKey, fingerprint });
    if (early.status === 'ready') {
      const restored = await restoreAdopted(records, early.value, expectedIdentity);
      if (restored.status !== 'restored') return restored;
      return { status: 'committed', value: restored.value, replayed: true, cursor: early.value.cursor };
    }
    if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
    if (early.code !== 'not_found') return unavailable(early.code + ': ' + early.reason);

    const scope = await readAdoptionScope(records, pins, projectId, workspaceId, baselineId);
    if (scope.status !== 'ready') {
      // The peer may have committed after our lookup and before this window.
      if (scope.code === 'revision_conflict') {
        return recoverConflictByIdentity(records, identityKey, fingerprint, scope,
          receipt => restoreAdopted(records, receipt, expectedIdentity));
      }
      return scope;
    }

    const baselineRef = baselineRefFor(projectId, baselineId, 1);
    const content: ArchitectureBaselineContentV1 = { schemaVersion: 1, description, constraints };
    const contentDigest = architectureBaselineDigest({ schemaVersion: 1, baselineId, contentRevision: 1, content });
    if (contentDigest === null) return invalid('the baseline content is not canonical JSON');
    const baseline: ArchitectureBaselineRevisionSnapshot = {
      ref: baselineRef, revision: 1, schemaVersion: 1, baselineId, contentRevision: 1, contentDigest, content,
    };
    const catalogRef = catalogRefFor(projectId, baselineId, 1);
    const catalogRecord: ArchitectureCatalogRecord = { ref: catalogRef, revision: 1, baselineRef, schemaVersion: 1, catalog };
    const activeRecord = {
      ref: { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId },
      projectId, revision: 1, activeRevision: baselineRef,
    };
    const occurredAt = new Date().toISOString();
    const event: ArchitectureCatalogAdoptedEventV1 = {
      eventId: randomUUID(), eventType: ARCHITECTURE_CATALOG_ADOPTED_EVENT, schemaVersion: 1,
      occurredAt, projectId, baselineRef, catalogRef, baseline, catalog,
    };
    const baselineKey = canonicalJson(baselineRef as unknown as JsonValue);
    const catalogKey = canonicalJson(catalogRef as unknown as JsonValue);
    const activeKey = activeRefKey(projectId);
    const guards: RecordGuard[] = [
      { refKey: canonicalJson(projectRefFor(projectId) as unknown as JsonValue), expectedRevision: scope.projectRevision },
      { refKey: canonicalJson(workspaceRefFor(projectId, workspaceId) as unknown as JsonValue), expectedRevision: scope.workspaceRevision },
      { refKey: baselineKey, expectedRevision: null },
      { refKey: catalogKey, expectedRevision: null },
      { refKey: activeKey, expectedRevision: null },
    ];
    if (ctx.signal.aborted) return rejected('cancelled', 'the adoption was cancelled before commit');
    let committed;
    try {
      committed = await records.commit({
        identityKey, fingerprint, guards,
        records: [
          { refKey: baselineKey, schemaId: BASELINE_SCHEMA_ID, revision: 1, json: JSON.stringify(baseline) },
          encodeArchitectureCatalog(catalogRecord),
          { refKey: activeKey, schemaId: BASELINE_ACTIVE_SCHEMA_ID, revision: 1, json: JSON.stringify(activeRecord) },
        ],
        claims: [], indexGuards: [], indexChanges: [],
        events: [encodeArchitectureCatalogAdoptedEvent(event)],
      });
    } catch (error) {
      return unavailable('the adoption transaction failed: ' + messageOf(error));
    }
    if (committed.status !== 'committed') {
      const failure = mapStoreFailure(committed);
      // A concurrent commit of this same identity may have won the guards.
      if (committed.code === 'revision_conflict') {
        return recoverConflictByIdentity(records, identityKey, fingerprint, failure,
          receipt => restoreAdopted(records, receipt, expectedIdentity));
      }
      return failure;
    }
    if (!committed.replayed) {
      return { status: 'committed', value: { baseline, catalog: catalogRecord }, replayed: false, cursor: committed.cursor };
    }
    const restored = await restoreAdopted(records, committed, expectedIdentity);
    if (restored.status !== 'restored') return restored;
    return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
  }

  /**
   * One authorized Host revision of the already-adopted catalog. Reuses the
   * adoption owner (`readCurrentCatalogWindow`, the original validator/encoder
   * and the original receipt reader); containment lives only in the new catalog
   * body, never in a second tree fact.
   *
   * `basedOn` must be the exact current immutable baseline pin (otherwise
   * `source_stale`); a project with no active baseline is `incomplete` and a
   * legacy active baseline without a catalog is explicitly `unsupported`. The
   * request is structurally isolated before the first Store call, an original
   * receipt replays from the original event, and a same-identity race reuses
   * the existing bounded identity recovery.
   */
  async function reviseArchitectureCatalog(ctx: CoreCallContext,
    request: GraphWrite<ReviseArchitectureCatalogInput>): Promise<WriteResult<ArchitectureRevision>> {
    const owned = ownJsonInput(request, 'reviseArchitectureCatalog request');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const body = owned.value as unknown as { input?: unknown; meta?: unknown };
    const rawInput = body.input;
    const rawMeta = body.meta;
    if (!isRecord(rawInput) || !isRecord(rawMeta)) return invalid('reviseArchitectureCatalog requires an input and meta object');
    if (!exactKeys(rawInput, ['basedOn', 'catalog', 'reason'])) {
      return invalid('reviseArchitectureCatalog.input must carry exactly basedOn, catalog and reason');
    }
    const basedOn = readArchitectureBaselinePin(rawInput['basedOn']);
    if (basedOn === null) return invalid('reviseArchitectureCatalog requires a complete baseline pin');
    const reason = rawInput['reason'];
    if (!nonEmpty(reason)) return invalid('reviseArchitectureCatalog requires a non-empty reason');
    if (Buffer.byteLength(reason, 'utf8') > MAX_REVISE_REASON_BYTES) {
      return invalid('reviseArchitectureCatalog reason must be at most 2048 UTF-8 bytes');
    }
    const requestId = rawMeta['requestId'];
    if (!nonEmpty(requestId)) return invalid('reviseArchitectureCatalog requires meta.requestId');
    const pins = readAdoptionPins(rawMeta['expected']);
    if (pins.status !== 'ok') return pins;
    const projectId = pins.project.ref.projectId;
    const workspaceId = pins.workspace.ref.workspaceId;
    if (basedOn.ref.projectId !== projectId) return invalid('the basedOn baseline pin is outside the requested project');
    const bound = bindHostWriteContext(ctx, projectId, workspaceId);
    if (bound.status !== 'ok') return bound;
    if (ctx.signal.aborted) return rejected('cancelled', 'the catalog revision was cancelled before admission');
    const candidate = validateAdoptedArchitecture(rawInput['catalog'], projectId);
    if (candidate.status !== 'ok') return rejected(candidate.code, candidate.reason);
    const catalog = candidate.value;

    const fingerprint = sha256Hex(canonicalJson({
      schemaVersion: 1, commandType: REVISE_COMMAND_TYPE, projectId, workspaceId, basedOn, catalog, reason,
      expected: {
        project: { ref: pins.project.ref, revision: pins.project.revision },
        workspace: { ref: pins.workspace.ref, revision: pins.workspace.revision },
      },
    } as unknown as JsonValue));
    const identityKey = REVISE_IDENTITY_PREFIX + commandIdentityKey({ projectId, actor: bound.actor, idempotencyKey: requestId });
    const expectedIdentity = { identityKey, projectId, basedOn };

    const early = await records.lookupCommit({ identityKey, fingerprint });
    if (early.status === 'ready') {
      const restored = await restoreRevised(records, early.value, expectedIdentity);
      if (restored.status !== 'restored') return restored;
      return { status: 'committed', value: restored.value, replayed: true, cursor: early.value.cursor };
    }
    if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
    if (early.code !== 'not_found') return unavailable(early.code + ': ' + early.reason);

    const current = await readCurrentCatalogWindow(records, projectId);
    if (current.status === 'not_found') return rejected('incomplete', 'the project has no active architecture baseline to revise');
    if (current.status !== 'ready') {
      // A peer using this same identity may have committed after our early
      // lookup; a stale window is exactly that race, so re-query that exact
      // identity before accepting the stale verdict. Other real read errors
      // keep their existing return.
      if (current.code === 'source_stale') {
        return recoverConflictByIdentity(records, identityKey, fingerprint, current,
          receipt => restoreRevised(records, receipt, expectedIdentity));
      }
      return current;
    }
    if (current.catalog === null) {
      return rejected('unsupported', 'the active architecture baseline predates the formal catalog and cannot be revised');
    }
    if (canonicalJson(current.baseline.ref as unknown as JsonValue) !== canonicalJson(basedOn.ref as unknown as JsonValue)
      || current.baseline.contentDigest !== basedOn.digest) {
      // The same-identity peer may already have advanced the pointer, making the
      // requested baseline look stale. Re-query that exact identity first; only a
      // genuine absence keeps the original source_stale fallback.
      const stale = rejected('source_stale', 'the basedOn baseline pin is not the current active architecture revision');
      return recoverConflictByIdentity(records, identityKey, fingerprint, stale,
        receipt => restoreRevised(records, receipt, expectedIdentity));
    }

    // A revision must not drop the parent's already-declared containment section
    // (only an explicit empty parentOf can flatten it) and must not remove a
    // module ref. Dependency and containment edges stay independent.
    const parentCatalog = current.catalog.catalog;
    const revisedModuleIds = new Set(catalog.modules.map(module => module.ref.moduleId));
    for (const parentModule of parentCatalog.modules) {
      if (!revisedModuleIds.has(parentModule.ref.moduleId)) {
        return invalid('a catalog revision must not remove the existing module ' + parentModule.ref.moduleId);
      }
    }
    const parentDeclaresContainment = Object.prototype.hasOwnProperty.call(parentCatalog, 'containment');
    const revisedDeclaresContainment = Object.prototype.hasOwnProperty.call(catalog, 'containment');
    if (parentDeclaresContainment && !revisedDeclaresContainment) {
      return invalid('the parent catalog declared containment, so the revised catalog must declare it explicitly');
    }
    const dependencyRules = current.baseline.content.dependencyRules;
    if (dependencyRules !== undefined && (!Array.isArray(dependencyRules) || dependencyRules.length > 0)) {
      return rejected('unsupported', 'a baseline with typed dependencyRules cannot be revised without their rule consumer');
    }

    const scope = await readCallerScope(records, pins, projectId, workspaceId);
    if (scope.status !== 'ready') {
      if (scope.code === 'revision_conflict') {
        return recoverConflictByIdentity(records, identityKey, fingerprint, scope,
          receipt => restoreRevised(records, receipt, expectedIdentity));
      }
      return scope;
    }

    const baselineId = basedOn.ref.baselineId;
    const nextRevision = basedOn.ref.revision + 1;
    const content = structuredClone(current.baseline.content);
    const contentDigest = architectureBaselineDigest({ schemaVersion: 1, baselineId, contentRevision: nextRevision, content });
    if (contentDigest === null) return invalid('the carried baseline content is not canonical JSON');
    const baselineRef = baselineRefFor(projectId, baselineId, nextRevision);
    const baseline: ArchitectureBaselineRevisionSnapshot = {
      ref: baselineRef, revision: 1, schemaVersion: 1, baselineId, contentRevision: nextRevision, contentDigest, content,
    };
    const catalogRef = catalogRefFor(projectId, baselineId, nextRevision);
    const catalogRecord: ArchitectureCatalogRecord = { ref: catalogRef, revision: 1, baselineRef, schemaVersion: 1, catalog };
    const activeRecord = {
      ref: { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId },
      projectId, revision: current.activeRevision + 1, activeRevision: baselineRef,
    };
    const event: ArchitectureCatalogRevisedEventV1 = {
      eventId: randomUUID(), eventType: ARCHITECTURE_CATALOG_REVISED_EVENT, schemaVersion: 1,
      occurredAt: new Date().toISOString(), identityKey, fingerprint, projectId,
      fromPin: basedOn, actor: bound.actor, reason, revision: { baseline, catalog: catalogRecord },
    };
    const baselineKey = canonicalJson(baselineRef as unknown as JsonValue);
    const catalogKey = canonicalJson(catalogRef as unknown as JsonValue);
    const activeKey = activeRefKey(projectId);
    const guards: RecordGuard[] = [
      { refKey: canonicalJson(projectRefFor(projectId) as unknown as JsonValue), expectedRevision: scope.projectRevision },
      { refKey: canonicalJson(workspaceRefFor(projectId, workspaceId) as unknown as JsonValue), expectedRevision: scope.workspaceRevision },
      ...current.guards,
      { refKey: baselineKey, expectedRevision: null },
      { refKey: catalogKey, expectedRevision: null },
    ];
    if (ctx.signal.aborted) return rejected('cancelled', 'the catalog revision was cancelled before commit');
    let committed;
    try {
      committed = await records.commit({
        identityKey, fingerprint, guards,
        records: [
          { refKey: baselineKey, schemaId: BASELINE_SCHEMA_ID, revision: 1, json: JSON.stringify(baseline) },
          encodeArchitectureCatalog(catalogRecord),
          { refKey: activeKey, schemaId: BASELINE_ACTIVE_SCHEMA_ID, revision: activeRecord.revision, json: JSON.stringify(activeRecord) },
        ],
        claims: [], indexGuards: [], indexChanges: [],
        events: [encodeArchitectureCatalogRevisedEvent(event)],
      });
    } catch (error) {
      return unavailable('the catalog revision transaction failed: ' + messageOf(error));
    }
    if (committed.status !== 'committed') {
      const failure = mapStoreFailure(committed);
      if (committed.code === 'revision_conflict') {
        return recoverConflictByIdentity(records, identityKey, fingerprint, failure,
          receipt => restoreRevised(records, receipt, expectedIdentity));
      }
      return failure;
    }
    if (!committed.replayed) {
      return { status: 'committed', value: { baseline, catalog: catalogRecord }, replayed: false, cursor: committed.cursor };
    }
    const restored = await restoreRevised(records, committed, expectedIdentity);
    if (restored.status !== 'restored') return restored;
    return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
  }

  async function readArchitectureRevision(ctx: CoreCallContext,
    input: ReadArchitectureRevisionInput): Promise<ReadResult<ArchitectureRevision>> {
    const owned = ownJsonInput(input, 'readArchitectureRevision input');
    if (owned.status === 'invalid') return invalid(owned.reason);
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the architecture read was cancelled');
    const raw = owned.value as unknown as Record<string, unknown>;
    const selection = raw['selection'];
    if (!isRecord(selection)) return invalid('readArchitectureRevision requires a selection');
    const projectId = ctx?.projectId;
    if (!nonEmpty(projectId)) return forbidden('a bound project call context is required');
    if (selection['kind'] === 'current') {
      if (!exactKeys(selection, ['kind'])) return invalid('a current selection carries only kind');
      const current = await readCurrentCatalogWindow(records, projectId);
      if (current.status !== 'ready') return current;
      return { status: 'ready', value: { baseline: current.baseline, catalog: current.catalog } };
    }
    if (selection['kind'] === 'revision') {
      if (!exactKeys(selection, ['kind', 'ref'])) return invalid('a revision selection carries only kind and ref');
      const ref = readArchitectureBaselineRef(selection['ref']);
      if (ref === null) return invalid('a revision selection requires a complete ArchitectureBaselineRevisionRef');
      if (ref.projectId !== projectId) return forbidden('the requested architecture revision is outside the call context project');
      return readRevisionByRef(records, ref);
    }
    return invalid('readArchitectureRevision accepts only current or revision selections');
  }

  return { adoptInitialArchitecture, reviseArchitectureCatalog, readArchitectureRevision };
}

/**
 * Internal read-only seam. On success the Session writer receives the resolved
 * module plus the baseline/catalog/active guards it must CAS in the same commit
 * that activates a `SessionWorkLink`. Closing an existing link does not require
 * the target to remain in the current catalog.
 */
export async function readCatalogModuleFacts(records: GoalRecordTransactionPort, ctx: CoreCallContext,
  ref: ModuleRef): Promise<ReadResult<CatalogModuleFacts>> {
  if (!ctx || typeof ctx !== 'object' || !nonEmpty(ctx.projectId)) return forbidden('a bound project call context is required');
  const moduleRef = readModuleRef(ref);
  if (moduleRef === null) return invalid('readCatalogModuleFacts requires a complete ModuleRef');
  if (moduleRef.projectId !== ctx.projectId) return forbidden('the module is outside the call context project');
  const current = await readCurrentCatalogWindow(records, moduleRef.projectId);
  if (current.status !== 'ready') return current;
  if (current.catalog === null) return { status: 'not_found' };
  const module = current.catalog.catalog.modules.find(entry => entry.ref.moduleId === moduleRef.moduleId);
  if (module === undefined) return { status: 'not_found' };
  return { status: 'ready', value: { module, guards: current.guards } };
}
