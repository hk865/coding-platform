/**
 * Formal architecture catalog service.
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
import type { ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import { commandIdentityKey } from '../../../contracts/command-event.js';
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef, VersionPin } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { ArchitectureBaselineRevisionRef } from '../../../contracts/governance.js';
import type { ProjectRef, WorkspaceRef } from '../../../contracts/ledger.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { CatalogRepairOpV1, ResponsibilityMoveV1 } from '../../../contracts/note.js';
import { projectModuleIdOfFile } from '../../../contracts/workspace-module-id.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, RecordGuard, StoreFailure, StoreResult,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import {
  knowledgeCommit, knowledgeFilesNotWritten, writeKnowledge, type KnowledgePrepared,
  type KnowledgeWritePlan,
} from '../knowledge/knowledge-write.js';
import { KNOWLEDGE_WRITE_UNCONFIRMED, pendingKnowledgeWrites } from '../knowledge/write-log.js';
import type {
  KnowledgeArchitecture, KnowledgeBaselineV1, KnowledgeCaller, KnowledgeLineScope, KnowledgeLines, LineKnowledge,
} from '../model/line-knowledge.js';
import type {
  AdoptedArchitecture, AdoptInitialArchitectureInput, ArchitectureBaselineContentV1, ArchitectureBaselineRevisionSnapshot,
  ArchitectureCatalogPort, ArchitectureCatalogRecord, ArchitectureCatalogRef, ArchitectureRevision,
  CatalogModuleFacts, ReadArchitectureRevisionInput, ReviseArchitectureCatalogOpsInput,
} from './catalog-contracts.js';
import { inModuleIdOrder } from './architecture-file.js';
import { projectArchitectureOf } from './project-architecture.js';
import { qualifyOps } from './proposal-service.js';
import {
  ARCHITECTURE_CATALOG_ADOPTED_EVENT, ARCHITECTURE_CATALOG_REVISED_EVENT, architectureBaselineDigest,
  decodeArchitectureCatalogAdoptedEvent, decodeArchitectureCatalogRecord, decodeArchitectureCatalogRevisedEvent,
  encodeArchitectureCatalog, encodeArchitectureCatalogAdoptedEvent, encodeArchitectureCatalogRevisedEvent,
  readArchitectureBaselineRef, readArchitectureBaselineSnapshot, readConstraints,
  readModuleRef, validateAdoptedArchitecture,
  type ArchitectureCatalogAdoptedEventV1, type ArchitectureCatalogRevisedEventV1,
} from './catalog-record-codecs.js';
import type { GraphWrite } from '../model/task-contracts.js';
import { decodeProjectSnapshot, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { projectRefFor, workspaceRefFor } from '../persistence/commit-compiler.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { sessionStoreFailureToRejection, storeFailureToRejection } from '../persistence/read-result-failures.js';
import type { CatalogRevisionDependencies, CatalogRevisionInputV1 } from './revision-planner.js';
import {
  catalogRevisionKeys, catalogRevisionMovesProblem, catalogRevisionPinProblem, draftCatalogRevision,
  finishCatalogRevision,
} from './revision-planner.js';
import { parseRepairOps } from './repair-ops.js';

export { ARCHITECTURE_CATALOG_SCHEMAS } from './catalog-record-codecs.js';
/** 2c-1d's refusal of a read that meets a write in flight; the decision queue tells it from the read-back gate (stk16). */
export { KNOWLEDGE_WRITE_UNCONFIRMED } from '../knowledge/write-log.js';

/** Records only: the catalog shares the baseline/active transaction and needs no
 * second store, body or index. */
export type ArchitectureCatalogStores = {
  records: GoalRecordTransactionPort;
  /** The task/role-scope capabilities a revising caller binds (G5). */
  revision?: CatalogRevisionDependencies;
  /** The knowledge files: the current read reads them and every write writes them. */
  knowledge: KnowledgeLines;
};

/** The knowledge lines a current read takes and the caller it reads them for. */
export type KnowledgeRead = { lines: KnowledgeLines; caller: KnowledgeCaller };

const ADOPT_IDENTITY_PREFIX = 'architecture-catalog-adopt:';
const ADOPT_COMMAND_TYPE = 'AdoptInitialArchitecture';
const MAX_REVISE_REASON_BYTES = 2048;
export const BASELINE_SCHEMA_ID = 'ArchitectureBaselineRevisionSnapshot@1';
export const BASELINE_ACTIVE_SCHEMA_ID = 'ProjectArchitectureBaselineActiveSnapshot@1';

type Rejection = { status: 'rejected'; code: CoreError; reason: string; current?: VersionPin[] };
type Owned<T> = { status: 'owned'; value: T } | { status: 'invalid'; reason: string };
type CommitReceipt = Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>;

// --------------------------------------------------------------------------
// Result helpers
// --------------------------------------------------------------------------

function forbidden(reason: string): Rejection { return rejected('forbidden', reason); }
function invalid(reason: string): Rejection { return rejected('invalid', reason); }
function unavailable(reason: string): Rejection { return rejected('unavailable', reason); }
function asReadResult<T>(rejection: Rejection): ReadResult<T> {
  return rejection.code === 'not_found' ? { status: 'not_found' } : rejection;
}
function mapStoreFailure(failure: StoreFailure): Rejection {
  switch (failure.code) {
    case 'not_found': return rejected('not_found', failure.reason);
    case 'invalid': return invalid(failure.reason);
    case 'unsupported': return unavailable(failure.reason);
    case 'corrupt': return unavailable('corrupt: ' + failure.reason);
    case 'unique_conflict': return sessionStoreFailureToRejection(failure);
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
export function activeRefKey(projectId: string): string {
  return canonicalJson({ aggregateType: 'ProjectArchitectureBaselineActive', projectId } as unknown as JsonValue);
}
export function baselineRefFor(projectId: string, baselineId: string, revision: number): ArchitectureBaselineRevisionRef {
  return { aggregateType: 'ArchitectureBaselineRevision', projectId, baselineId, revision };
}
export function catalogRefFor(projectId: string, baselineId: string, revision: number): ArchitectureCatalogRef {
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
    ref: event.catalogRef, revision: 1, baselineRef: event.baselineRef, schemaVersion: 1, catalog: event.catalog, since: null,
  };
  return { status: 'restored', value: { baseline: event.baseline, catalog: catalogRecord } };
}

/** Restores the exact `ArchitectureRevision` embedded in the ORIGINAL revision
 * event, never recomputed against the later active pointer. */
async function restoreRevised(records: GoalRecordTransactionPort, receipt: CommitReceipt,
  expected: { identityKey: string; projectId: string; expected: ArchitectureCatalogPinV1 }):
  Promise<{ status: 'restored'; value: ArchitectureRevision } | Rejection> {
  if (receipt.identityKey !== expected.identityKey) return unavailable('the idempotency receipt belongs to another identity');
  // The catalog event is the tail of every successful revision commit; the
  // receipt may also carry the responsibility events written in the same commit.
  const located = await records.eventAt(receipt.cursor);
  if (located.status !== 'ready') return mapStoreFailure(located);
  if (String(located.value.cursor) !== String(receipt.cursor)) return unavailable('eventAt returned a different cursor');
  const decoded = decodeArchitectureCatalogRevisedEvent(located.value.event);
  if (decoded.status !== 'decoded') return unavailable('the original revision event is corrupt: ' + decoded.reason);
  const event = decoded.value;
  if (!receipt.eventIds.includes(event.eventId)) return unavailable('the tail event is not part of the revision receipt');
  if (event.identityKey !== expected.identityKey) return unavailable('the original revision event belongs to another identity');
  if (event.projectId !== expected.projectId || event.fromPin.ref.projectId !== expected.projectId) {
    return unavailable('the original revision event is outside the recovered scope');
  }
  if (canonicalJson(event.fromPin as unknown as JsonValue)
    !== canonicalJson(expected.expected.baseline as unknown as JsonValue)) {
    return unavailable('the original revision event does not match the requested catalog pin');
  }
  // The event embeds the pre-bind revision (the `since` placeholder is null);
  // the store bound this commit's cursor into the written catalog row. Returning
  // that same cursor keeps a replay result equal to the original write result, in the same read-back order (G1).
  const restored = { ...event.revision, catalog: { ...event.revision.catalog,
    catalog: inModuleIdOrder(event.revision.catalog.catalog), since: receipt.cursor } };
  return { status: 'restored', value: restored };
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

export type CurrentCatalogWindow =
  | { status: 'ready'; baseline: ArchitectureBaselineRevisionSnapshot; catalog: ArchitectureCatalogRecord;
      guards: RecordGuard[]; activeRevision: number }
  | { status: 'not_found' }
  | Rejection;

/**
 * The ONE current-pointer read: it resolves the active baseline revision, reads
 * the pointer together with the baseline and catalog it names in a second
 * window, re-verifies the pointer (so a concurrent activation cannot mix
 * versions) and returns both the decoded revision and the exact guards a CAS
 * caller must join. `readCurrentRevision` and `readCatalogModuleFacts` share it.
 *
 * With `knowledge`, the catalog and the baseline's knowledge fields come from
 * the line's files: the records keep the identity, the
 * digest, the source binding and the guards. A file that cannot be read is the
 * read's failure, never the record instead. 2c-1d: an architecture write
 * pending on a line it reads is refused (`有未确认的知识写`, no waiting); never
 * this pointer with older files.
 */
export async function readCurrentCatalogWindow(records: Pick<GoalRecordTransactionPort, 'readMany'>,
  projectId: string, knowledge?: KnowledgeRead): Promise<CurrentCatalogWindow> {
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
  const catalogRecord = byKey.get(catalogKey);
  if (catalogRecord === undefined) {
    return unavailable('the architecture catalog record is missing for the active baseline revision');
  }
  const decoded = decodeArchitectureCatalogRecord(catalogRecord);
  if (decoded.status !== 'decoded') return unavailable('the architecture catalog record is damaged: ' + decoded.reason);
  const catalog = decoded.value;
  const guards: RecordGuard[] = [
    { refKey: baselineKey, expectedRevision: baselineRecord.revision },
    { refKey: activeKey, expectedRevision: pointer.revision },
    { refKey: catalogKey, expectedRevision: catalogRecord.revision },
  ];
  if (knowledge === undefined) return { status: 'ready', baseline, catalog, guards, activeRevision: pointer.revision };
  const lines = await knowledge.lines.project(knowledge.caller);
  if (lines.status !== 'ready') return mapStoreFailure(lines);
  // 2c-1d (split ruling §7, lead 11-12): an architecture or module write `pending` on a line read here may have left
  // its files older than this pointer: refuse. Only the lines read count (each workspace's current line: a crash left
  // on another branch does not stop this checkout); a note's log does not; an `unconfirmed` log is not pending (the
  // file rules). A window that read here sees any later write move the pointer (its logs and the move commit together),
  // so the pointer read has no check of its own.
  const pending = await pendingKnowledgeWrites(knowledge.lines.write.records, projectId, lines.value);
  if (pending.status !== 'ready') return mapStoreFailure(pending);
  if (pending.value.some(log => log.kind === 'architecture' || log.kind === 'module')) {
    return unavailable(KNOWLEDGE_WRITE_UNCONFIRMED);
  }
  // A8: every workspace's files, merged into the project view; any line that cannot be read fails the read.
  const parts: { scope: KnowledgeLineScope; architecture: KnowledgeArchitecture }[] = [];
  for (const line of lines.value) {
    const file = await line.readArchitecture();
    if (file.status !== 'ready') return mapStoreFailure(file);
    parts.push({ scope: line.scope, architecture: file.value });
  }
  const merged = projectArchitectureOf(parts, projectId);
  if (merged.status !== 'decoded') return unavailable(merged.reason);
  const { sourceBinding } = baseline.content;
  return {
    status: 'ready', guards, activeRevision: pointer.revision,
    baseline: { ...baseline, content: { schemaVersion: 1, ...merged.value.baseline,
      ...(sourceBinding === undefined ? {} : { sourceBinding }) } },
    catalog: { ...catalog, catalog: merged.value.catalog },
  };
}

/**
 * R-window: the current catalog pointer record's revision, `null` when no catalog is adopted. A ledger window
 * compares it with the revision the knowledge files were read at (`activeRevision`, or `null` for `not_found`).
 */
export async function readCatalogPointerRevision(
  records: Pick<GoalRecordTransactionPort, 'readMany'>,
  projectId: string,
): Promise<{ status: 'ready'; value: number | null } | CoreRejection> {
  const refKey = activeRefKey(projectId);
  let read: Awaited<ReturnType<GoalRecordTransactionPort['readMany']>>;
  try {
    read = await records.readMany([refKey]);
  } catch (error) {
    return storeFailureToRejection(error as { code: string; reason: string });
  }
  if (read.status !== 'ready') return storeFailureToRejection(read);
  const record = read.value.records.find((candidate) => candidate.refKey === refKey);
  return { status: 'ready', value: record === undefined ? null : record.revision };
}

/**
 * b2 Astra 1: whether the project's records ever adopted an architecture (its current catalog pointer exists), the
 * knowledge reconciliation's one exemption (`KnowledgeWriteDeps.catalogAdopted`); a failed read is the rejection.
 */
export async function readCatalogAdopted(records: Pick<GoalRecordTransactionPort, 'readMany'>, projectId: string):
  Promise<{ status: 'ready'; value: boolean } | CoreRejection> {
  const pointer = await readCatalogPointerRevision(records, projectId);
  return pointer.status === 'ready' ? { status: 'ready', value: pointer.value !== null } : pointer;
}

/** The baseline fields a knowledge file keeps; the schema version and the source binding stay in the record. */
export function knowledgeBaselineOf(content: ArchitectureBaselineContentV1): KnowledgeBaselineV1 {
  return { description: content.description, constraints: content.constraints,
    ...(content.dependencyRules === undefined ? {} : { dependencyRules: content.dependencyRules }) };
}

/** Every line's architecture file changes for one project-view catalog (each line keeps its own workspace's part). */
export async function architectureWritePlansOf(lines: readonly LineKnowledge[], catalog: AdoptedArchitecture,
  baseline: KnowledgeBaselineV1): Promise<StoreResult<KnowledgeWritePlan[]>> {
  const plans: KnowledgeWritePlan[] = [];
  for (const line of lines) {
    const changes = await line.writeModule(catalog, baseline);
    if (changes.status !== 'ready') return changes;
    plans.push({ line, changes: changes.value });
  }
  return { status: 'ready', value: plans };
}

/**
 * The module ids a caller hands in are written in its own frame (its
 * workspace is the main one); every entry turns them into the project view
 * once, so records and files only ever see the project view. A malformed id
 * throws and the entry answers `invalid`.
 */
function moduleRefInProjectView(ref: ModuleRef, callerWorkspaceId: string, mainWorkspaceId: string): ModuleRef {
  return { ...ref, moduleId: projectModuleIdOfFile(ref.moduleId, callerWorkspaceId, mainWorkspaceId) };
}

function catalogInProjectView(catalog: AdoptedArchitecture, callerWorkspaceId: string,
  mainWorkspaceId: string): AdoptedArchitecture {
  const view = (ref: ModuleRef): ModuleRef => moduleRefInProjectView(ref, callerWorkspaceId, mainWorkspaceId);
  return {
    ...catalog,
    modules: catalog.modules.map(module => ({ ...module, ref: view(module.ref) })),
    dependencies: catalog.dependencies.map(edge => ({ ...edge, from: view(edge.from), to: view(edge.to) })),
    ...(catalog.containment === undefined ? {} : { containment: { parentOf: catalog.containment.parentOf
      .map(edge => ({ parent: view(edge.parent), child: view(edge.child) })) } }),
  };
}

/** The ONE walk over every module id and path a repair op names (the caller-frame entries and the note file frame). */
export function reframeRepairOps(ops: readonly CatalogRepairOpV1[], id: (moduleId: string) => string,
  path: (path: string) => string): CatalogRepairOpV1[] {
  const reframedRef = (value: ModuleRef): ModuleRef => ({ ...value, moduleId: id(value.moduleId) });
  const paths = (values: readonly string[]): string[] => values.map(path);
  return ops.map((op): CatalogRepairOpV1 => {
    switch (op.op) {
      case 'add_module': return { ...op, module: { ...op.module, ref: reframedRef(op.module.ref), paths: paths(op.module.paths),
        interfaces: op.module.interfaces.map(entry => ({ ...entry, paths: paths(entry.paths) })) } };
      case 'set_parent': return { ...op, moduleId: id(op.moduleId), parentId: op.parentId === null ? null : id(op.parentId) };
      case 'set_dependency_reason': case 'add_dependency': case 'remove_dependency':
      case 'add_forbid_rule': case 'remove_forbid_rule':
        return { ...op, from: reframedRef(op.from), to: reframedRef(op.to) };
      case 'add_path': case 'remove_path': return { ...op, moduleId: id(op.moduleId), path: path(op.path) };
      case 'add_interface': return { ...op, moduleId: id(op.moduleId),
        interface: { ...op.interface, paths: paths(op.interface.paths) } };
      case 'set_interface': return { ...op, moduleId: id(op.moduleId),
        ...(op.paths === undefined ? {} : { paths: paths(op.paths) }) };
      default: return { ...op, moduleId: id(op.moduleId) };
    }
  });
}

/** KLS-2b: a caller's module ids (its own frame) in the project view; paths are left to the caller's qualification. */
export function opsInProjectView(ops: readonly CatalogRepairOpV1[], callerWorkspaceId: string,
  mainWorkspaceId: string): CatalogRepairOpV1[] {
  return reframeRepairOps(ops, moduleId => projectModuleIdOfFile(moduleId, callerWorkspaceId, mainWorkspaceId), path => path);
}

function movesInProjectView(moves: readonly ResponsibilityMoveV1[], callerWorkspaceId: string,
  mainWorkspaceId: string): ResponsibilityMoveV1[] {
  return moves.map(move => move.to.kind === 'standby' ? move : { ...move, to: { kind: 'modules',
    destinations: move.to.destinations.map(ref => moduleRefInProjectView(ref, callerWorkspaceId, mainWorkspaceId)) } });
}

/** Reads the catalog row for a known baseline revision. A missing, damaged or
 * mismatched catalog is `unavailable`, never a guessed empty catalog. */
function readCatalogBesideBaseline(baselineRef: ArchitectureBaselineRevisionRef, catalogKey: string,
  byKey: Map<string, EncodedRecord>): { status: 'ok'; value: ArchitectureCatalogRecord } | { status: 'rejected'; rejection: Rejection } {
  const catalogRecord = byKey.get(catalogKey);
  if (catalogRecord === undefined) {
    return { status: 'rejected', rejection: unavailable('the architecture catalog record is missing for the requested baseline revision') };
  }
  const decoded = decodeArchitectureCatalogRecord(catalogRecord);
  if (decoded.status !== 'decoded') return { status: 'rejected', rejection: unavailable('the architecture catalog record is damaged: ' + decoded.reason) };
  if (canonicalJson(decoded.value.baselineRef as unknown as JsonValue) !== canonicalJson(baselineRef as unknown as JsonValue)) {
    return { status: 'rejected', rejection: unavailable('the architecture catalog does not name the baseline revision it was read beside') };
  }
  return { status: 'ok', value: decoded.value };
}

/** Reads one immutable baseline revision and the catalog row beside it. Exported
 * for the 8A formal-vs-observed comparison, which must resolve the pin through
 * the recorded baseline rather than trusting the caller's raw catalog ref. */
export async function readRevisionByRef(records: GoalRecordTransactionPort, ref: ArchitectureBaselineRevisionRef): Promise<ReadResult<ArchitectureRevision>> {
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

/** L10 (8B §3.4): the complete pin of one read revision (a current window or `readRevisionByRef`); never from input. */
export function catalogPinOf(revision: { baseline: ArchitectureBaselineRevisionSnapshot;
  catalog: ArchitectureCatalogRecord }): ArchitectureCatalogPinV1 {
  return { catalogRef: revision.catalog.ref,
    baseline: { ref: revision.baseline.ref, digest: revision.baseline.contentDigest } };
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createArchitectureCatalogService(stores: ArchitectureCatalogStores): ArchitectureCatalogPort {
  const { records, knowledge } = stores;

  /** The project's main workspace, the frame the caller-frame ids are read against. */
  async function knowledgeMainWorkspace(ctx: CoreCallContext): Promise<{ status: 'ok'; value: string } | Rejection> {
    const listed = await knowledge.workspaces(ctx);
    return listed.status === 'ready' ? { status: 'ok', value: listed.value[0]! } : mapStoreFailure(listed);
  }

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
    const main = await knowledgeMainWorkspace(ctx);
    if (main.status !== 'ok') return main;
    let catalog: AdoptedArchitecture;
    try {
      catalog = catalogInProjectView(candidate.value, workspaceId, main.value);
    } catch (error) {
      return invalid('a module id is not a module id of the caller frame: ' + messageOf(error));
    }

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

    type Adopted = WriteResult<ArchitectureRevision>;
    const exit = (value: Adopted): KnowledgePrepared<Adopted> => ({ kind: 'exit', value });
    const thrown = { message: null as string | null };
    let adopted = null as ArchitectureRevision | null;
    // The scope read, the records and the file changes are prepared after the knowledge lines are taken.
    const outcome = await writeKnowledge(knowledge, ctx, async (lines): Promise<KnowledgePrepared<Adopted>> => {
      const scope = await readAdoptionScope(records, pins, projectId, workspaceId, baselineId);
      if (scope.status !== 'ready') {
        // The peer may have committed after our lookup and before this window.
        return exit(scope.code === 'revision_conflict'
          ? await recoverConflictByIdentity(records, identityKey, fingerprint, scope,
            receipt => restoreAdopted(records, receipt, expectedIdentity))
          : scope);
      }

      const baselineRef = baselineRefFor(projectId, baselineId, 1);
      const content: ArchitectureBaselineContentV1 = { schemaVersion: 1, description, constraints };
      const contentDigest = architectureBaselineDigest({ schemaVersion: 1, baselineId, contentRevision: 1, content });
      if (contentDigest === null) return exit(invalid('the baseline content is not canonical JSON'));
      const baseline: ArchitectureBaselineRevisionSnapshot = {
        ref: baselineRef, revision: 1, schemaVersion: 1, baselineId, contentRevision: 1, contentDigest, content,
      };
      const catalogRef = catalogRefFor(projectId, baselineId, 1);
      const catalogRecord: ArchitectureCatalogRecord = { ref: catalogRef, revision: 1, baselineRef, schemaVersion: 1, catalog, since: null };
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
      if (ctx.signal.aborted) return exit(rejected('cancelled', 'the adoption was cancelled before commit'));
      const plans = await architectureWritePlansOf(lines, catalog, { description, constraints });
      if (plans.status !== 'ready') return exit(mapStoreFailure(plans));
      adopted = { baseline, catalog: catalogRecord };
      return { kind: 'ready', plans: plans.value, commit: knowledgeCommit(prepared => records.commit(prepared), {
        identityKey, fingerprint, guards,
        records: [
          { refKey: baselineKey, schemaId: BASELINE_SCHEMA_ID, revision: 1, json: JSON.stringify(baseline) },
          encodeArchitectureCatalog(catalogRecord),
          { refKey: activeKey, schemaId: BASELINE_ACTIVE_SCHEMA_ID, revision: 1, json: JSON.stringify(activeRecord) },
        ],
        claims: [], indexGuards: [], indexChanges: [],
        events: [encodeArchitectureCatalogAdoptedEvent(event)],
      }, thrown) };
    });
    if (outcome.kind === 'exit') return outcome.value;
    if (outcome.kind === 'rejected') {
      if (thrown.message !== null) return unavailable('the adoption transaction failed: ' + thrown.message);
      const failure = mapStoreFailure(outcome.failure);
      // A concurrent commit of this same identity may have won the guards.
      if (outcome.failure.code === 'revision_conflict') {
        return recoverConflictByIdentity(records, identityKey, fingerprint, failure,
          receipt => restoreAdopted(records, receipt, expectedIdentity));
      }
      return failure;
    }
    const committed = outcome.receipt;
    if (outcome.files !== null && outcome.files.status !== 'ready') return unavailable(knowledgeFilesNotWritten(outcome.files));
    if (!committed.replayed && adopted !== null) {
      return { status: 'committed', value: adopted, replayed: false, cursor: committed.cursor };
    }
    const restored = await restoreAdopted(records, committed, expectedIdentity);
    if (restored.status !== 'restored') return restored;
    return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
  }

  /**
   * One authorized Host revision of the already-adopted catalog. The planner
   * owns the pin/op/delete/move rules and returns the whole contribution; this
   * wrapper validates the request before the first Store call, keeps the
   * original receipt/recovery mechanics and commits the contribution once.
   */
  async function reviseArchitectureCatalog(ctx: CoreCallContext,
    request: GraphWrite<ReviseArchitectureCatalogOpsInput>): Promise<WriteResult<ArchitectureRevision>> {
    const owned = ownJsonInput(request, 'reviseArchitectureCatalog request');
    if (owned.status === 'invalid') return invalid(owned.reason);
    const body = owned.value as unknown as { input?: unknown; meta?: unknown };
    const rawInput = body.input;
    const rawMeta = body.meta;
    if (!isRecord(rawInput) || !isRecord(rawMeta)) return invalid('reviseArchitectureCatalog requires an input and meta object');
    if (!exactKeys(rawInput, ['expected', 'ops', 'responsibilityMoves', 'reason'])) {
      return invalid('reviseArchitectureCatalog.input must carry exactly expected, ops, responsibilityMoves and reason');
    }
    const expected = rawInput['expected'] as ArchitectureCatalogPinV1;
    const pinProblem = catalogRevisionPinProblem(expected);
    if (pinProblem !== null) return invalid(pinProblem);
    const parsed = parseRepairOps(rawInput['ops']);
    if (!parsed.ok) return invalid(parsed.problem.reason);
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
    if (expected.catalogRef.projectId !== projectId) return invalid('the expected catalog pin is outside the requested project');
    const bound = bindHostWriteContext(ctx, projectId, workspaceId);
    if (bound.status !== 'ok') return bound;
    if (ctx.signal.aborted) return rejected('cancelled', 'the catalog revision was cancelled before admission');
    const rawMoves = rawInput['responsibilityMoves'] as CatalogRevisionInputV1['responsibilityMoves'];
    const movesProblem = catalogRevisionMovesProblem(rawMoves, projectId, null);
    if (movesProblem !== null) return invalid(movesProblem);
    const main = await knowledgeMainWorkspace(ctx);
    if (main.status !== 'ok') return main;
    let revisionInput: CatalogRevisionInputV1;
    try {
      // Module ids and paths are the caller's frame: both turn into the project view here, once.
      revisionInput = { expected, ops: qualifyOps(opsInProjectView(parsed.ops, workspaceId, main.value), workspaceId, main.value),
        responsibilityMoves: movesInProjectView(rawMoves, workspaceId, main.value), reason, commandId: requestId };
    } catch (error) {
      return invalid('a module id or path is not one of the caller frame: ' + messageOf(error));
    }
    const keys = catalogRevisionKeys(revisionInput, bound.actor, projectId);
    const expectedIdentity = { identityKey: keys.identityKey, projectId, expected };

    // The receipt lookup precedes the caller-scope comparison: a resend must
    // return its original revision even after a later commit raised the Project
    // or Workspace revision the command's pins necessarily predate.
    const early = await records.lookupCommit({ identityKey: keys.identityKey, fingerprint: keys.fingerprint });
    if (early.status === 'ready') {
      const restored = await restoreRevised(records, early.value, expectedIdentity);
      if (restored.status !== 'restored') return restored;
      return { status: 'committed', value: restored.value, replayed: true, cursor: early.value.cursor };
    }
    if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
    if (early.code !== 'not_found') return unavailable(early.code + ': ' + early.reason);

    type Revised = WriteResult<ArchitectureRevision>;
    const exit = (value: Revised): KnowledgePrepared<Revised> => ({ kind: 'exit', value });
    const recover = (rejection: Rejection): Promise<Revised> => recoverConflictByIdentity(records, keys.identityKey,
      keys.fingerprint, rejection, receipt => restoreRevised(records, receipt, expectedIdentity));
    const thrown = { message: null as string | null };
    let revised = null as ArchitectureRevision | null;
    // The scope read, the plan and the file changes are prepared after the lines are taken; the planner's draft
    // reads the current files and the file changes are computed before its ledger half reads the basis the
    // commit is checked against (stack review 1).
    const outcome = await writeKnowledge(knowledge, ctx, async (lines): Promise<KnowledgePrepared<Revised>> => {
      const callerScope = await readCallerScope(records, pins, projectId, workspaceId);
      if (callerScope.status !== 'ready') {
        // A peer using the same identity may have committed between the early
        // receipt miss above and this scope read; the scope read then sees the
        // later Project/Workspace revision even though our receipt now exists.
        // That is the same conflict shape as the planner and commit exits, so it
        // takes the ONE identity re-query exit; without a matching receipt the
        // scope conflict still stands.
        return exit(callerScope.code === 'revision_conflict' ? await recover(callerScope) : callerScope);
      }

      const revisionDeps = stores.revision ?? {
        records: records as GoalRecordTransactionPort & RecordLookupPort,
        now: () => new Date().toISOString(),
        eventId: () => randomUUID(),
        knowledge,
      };
      const revisionRefused = async (planned: Exclude<ReadResult<never>, { status: 'ready' }>): Promise<KnowledgePrepared<Revised>> => {
        if (planned.status === 'rejected') {
          return exit(planned.code === 'revision_conflict' || planned.code === 'source_stale' ? await recover(planned) : planned);
        }
        return exit(unavailable('the catalog revision plan is not ready'));
      };
      const draft = await draftCatalogRevision(revisionDeps, ctx, revisionInput);
      if (draft.status !== 'ready') return revisionRefused(draft);
      const plans = await architectureWritePlansOf(lines, draft.value.catalog, knowledgeBaselineOf(draft.value.content));
      if (plans.status !== 'ready') return exit(mapStoreFailure(plans));
      const planned = await finishCatalogRevision(revisionDeps, ctx, draft.value);
      if (planned.status !== 'ready') return revisionRefused(planned);
      if (ctx.signal.aborted) return exit(rejected('cancelled', 'the catalog revision was cancelled before commit'));
      const { revision, pin: _pin, ...fragment } = planned.value;
      // The planner re-reads Project/Workspace, but the caller's own earlier read
      // is the pin it declared. Merging both guards turns a commit that raised
      // either revision in between into mergeGuards' revision_conflict instead of
      // silently admitting the stale caller pin under the newer version.
      const scoped = mergeGuards([...fragment.guards,
        { refKey: canonicalJson(projectRefFor(projectId) as unknown as JsonValue),
          expectedRevision: callerScope.projectRevision },
        { refKey: canonicalJson(workspaceRefFor(projectId, workspaceId) as unknown as JsonValue),
          expectedRevision: callerScope.workspaceRevision },
      ]);
      // A conflict on the caller's own pins is the same conflict shape as a
      // planner or commit one: the identity may have committed the same command
      // while the scope moved, so it takes that ONE recovery exit too.
      if (!scoped.ok) {
        return exit(scoped.rejection.code === 'revision_conflict' ? await recover(scoped.rejection) : scoped.rejection);
      }
      revised = revision;
      return { kind: 'ready', plans: plans.value, commit: knowledgeCommit(prepared => records.commit(prepared), {
        ...fragment, guards: scoped.guards,
        identityKey: keys.identityKey, fingerprint: keys.fingerprint, indexGuards: [], indexChanges: [],
      }, thrown) };
    });
    if (outcome.kind === 'exit') return outcome.value;
    if (outcome.kind === 'rejected') {
      if (thrown.message !== null) return unavailable('the catalog revision transaction failed: ' + thrown.message);
      const failure = mapStoreFailure(outcome.failure);
      return outcome.failure.code === 'revision_conflict' ? recover(failure) : failure;
    }
    const committed = outcome.receipt;
    if (outcome.files !== null && outcome.files.status !== 'ready') return unavailable(knowledgeFilesNotWritten(outcome.files));
    if (!committed.replayed && revised !== null) {
      // The answer lists the catalog in the read-back order (ruling G1), so it equals the current read.
      return { status: 'committed',
        value: { ...revised, catalog: { ...revised.catalog, catalog: inModuleIdOrder(revised.catalog.catalog),
          since: committed.cursor } },
        replayed: false, cursor: committed.cursor };
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
      const current = await readCurrentCatalogWindow(records, projectId, { lines: knowledge, caller: ctx });
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
 * KLS-2b A.1: `knowledge` is the project view of the files.
 */
export async function readCatalogModuleFacts(records: GoalRecordTransactionPort, ctx: CoreCallContext,
  ref: ModuleRef, knowledge: KnowledgeRead): Promise<ReadResult<CatalogModuleFacts>> {
  return catalogModuleFactsOnce(records, ctx, knowledge)(ref);
}

/**
 * KLS-2b: `readCatalogModuleFacts` for every module target of one call; the current catalog (its files) is read
 * once, so a Session created with many module links reads the files once and every link joins the same guards.
 */
export function catalogModuleFactsOnce(records: GoalRecordTransactionPort, ctx: CoreCallContext,
  knowledge: KnowledgeRead): (ref: ModuleRef) => Promise<ReadResult<CatalogModuleFacts>> {
  let current: Promise<CurrentCatalogWindow> | undefined;
  return async ref => {
    if (!ctx || typeof ctx !== 'object' || !nonEmpty(ctx.projectId)) return forbidden('a bound project call context is required');
    const moduleRef = readModuleRef(ref);
    if (moduleRef === null) return invalid('readCatalogModuleFacts requires a complete ModuleRef');
    if (moduleRef.projectId !== ctx.projectId) return forbidden('the module is outside the call context project');
    current ??= readCurrentCatalogWindow(records, moduleRef.projectId, knowledge);
    return catalogModuleFactsOf(await current, moduleRef.moduleId);
  };
}

/**
 * The module-facts projection of one already-read current catalog window. The
 * note anchor gate uses it through its per-call seam, so several module or
 * interface targets of one note call share ONE `readCurrentCatalogWindow`.
 */
export function catalogModuleFactsOf(window: CurrentCatalogWindow, moduleId: string): ReadResult<CatalogModuleFacts> {
  if (window.status !== 'ready') return window;
  const module = window.catalog.catalog.modules.find(entry => entry.ref.moduleId === moduleId);
  if (module === undefined) return { status: 'not_found' };
  return { status: 'ready', value: { module, guards: window.guards } };
}
