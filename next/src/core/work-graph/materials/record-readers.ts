/**
 * WorkGraph material record readers — the target RecordStore implementation of
 * `MaterialAuthorityReads` / `MaterialCandidateReads` (N0 / R3c).
 *
 * This file owns exactly two things:
 *  - the read-only encodings for the canonical facts material access actually
 *    consumes (`RunSnapshot@1`, `QueryRunSnapshot@1`,
 *    `MaterialAccessGrantSnapshot@1`) layered on top of the existing Goal
 *    registration, plus the two exact reader candidate lookups; and
 *  - the two reader implementations over the injected RecordStore
 *    (`readMany` for exact canonical facts, registered `lookup` for candidates).
 *
 * Boundaries deliberately enforced here:
 *  - no StateLedger / ReadModelIndex import, no second SQLite/Map, no old
 *    repository scan and no dynamic import; the single injected dependency is
 *    the RecordStore record port and production composition passes only the
 *    target `backend.records`;
 *  - the registered callbacks only check persistent encoding, complete identity,
 *    revision/schemaVersion and the fields material use needs; they never admit
 *    a business operation and never re-normalize stored JSON;
 *  - lookups are registered dotted JSON paths over the full reader identity, so
 *    the Store never receives SQL; the WorkGraph rechecks the canonical reader
 *    and exact material and still re-reads the current row before authorizing.
 */
import type {
  DecodeResult,
  EncodedRecord,
  EncodedRecordSchema,
  GoalRecordTransactionPort,
  RecordBackendSchemas,
  RecordBatchRead,
  StoreResult,
} from '../../record-store/ports.js';
import type { RecordLookupIndex, RecordLookupPage, RecordLookupPort } from '../../record-store/lookup-ports.js';
import { compareRefKeys } from '../../record-store/lookup-index.js';
import { isArtifactRef } from '../../record-store/body-codec.js';
import { isJsonObject, isNonEmptyString, isRevision, messageOf, parseJsonObject } from '../../record-store/record-codec.js';
import { GOAL_RECORD_SCHEMAS } from '../persistence/record-codecs.js';
import { isRunExecutionHistoryV1 } from '../persistence/execution-history-codecs.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { ArtifactOwnerRunRef } from '../../../contracts/artifact.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { QueryJobRef, QueryRunRef } from '../../../contracts/query-job.js';
import type { MaterialAccessGrantSnapshot } from '../../../contracts/material-access.js';
import { sameArtifactOwnerRunRef, sameArtifactRef, validMaterialSourcePin } from '../../../contracts/material-access.js';
import type {
  MaterialAuthorityReads,
  MaterialCandidateReads,
  MaterialCanonicalRef,
  MaterialCanonicalSnapshot,
} from './record-ports.js';

// --------------------------------------------------------------------------
// Encoding selectors and registered lookup names
// --------------------------------------------------------------------------

const RUN_SNAPSHOT_SCHEMA_ID = 'RunSnapshot@1';
const QUERY_RUN_SNAPSHOT_SCHEMA_ID = 'QueryRunSnapshot@1';
const MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID = 'MaterialAccessGrantSnapshot@1';

const MATERIAL_GRANT_BY_RUN_READER_INDEX = 'material-access-grant-by-run-reader';
const MATERIAL_GRANT_BY_QUERY_RUN_READER_INDEX = 'material-access-grant-by-query-run-reader';

/** The Store caps a lookup page at 200; the reader keeps paging until `next` is null. */
const LOOKUP_PAGE_LIMIT = 200;

// --------------------------------------------------------------------------
// Pure shape helpers (reuse the Store's mechanical checks)
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
}

function isRunRef(value: unknown): value is RunRef {
  if (!isJsonObject(value)) return false;
  return value['aggregateType'] === 'Run' &&
    isNonEmptyString(value['projectId']) &&
    isNonEmptyString(value['goalId']) &&
    isNonEmptyString(value['runId']);
}

function isQueryRunRef(value: unknown): value is QueryRunRef {
  if (!isJsonObject(value)) return false;
  return value['aggregateType'] === 'QueryRun' &&
    isNonEmptyString(value['projectId']) &&
    isNonEmptyString(value['workspaceId']) &&
    isNonEmptyString(value['queryJobId']) &&
    isNonEmptyString(value['runId']);
}

function isQueryJobRef(value: unknown): value is QueryJobRef {
  if (!isJsonObject(value)) return false;
  return value['aggregateType'] === 'QueryJob' &&
    isNonEmptyString(value['projectId']) &&
    isNonEmptyString(value['workspaceId']) &&
    isNonEmptyString(value['queryJobId']);
}

function isArtifactOwnerRunRef(value: unknown): value is ArtifactOwnerRunRef {
  return isRunRef(value) || isQueryRunRef(value);
}

function isMaterialAccessGrantRef(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return value['aggregateType'] === 'MaterialAccessGrant' &&
    isNonEmptyString(value['projectId']) &&
    isNonEmptyString(value['workspaceId']) &&
    isNonEmptyString(value['goalId']) &&
    isNonEmptyString(value['grantId']);
}

function isMaterialAccessScope(value: unknown): value is UnknownRecord {
  if (!isJsonObject(value)) return false;
  return isNonEmptyString(value['projectId']) &&
    isNonEmptyString(value['workspaceId']) &&
    isNonEmptyString(value['goalId']);
}

function isPlanRevisionRef(value: unknown): value is PlanRevisionRef {
  if (!isJsonObject(value)) return false;
  return value['aggregateType'] === 'PlanRevision' &&
    isNonEmptyString(value['projectId']) &&
    isNonEmptyString(value['planId']);
}

function isWorkspacePin(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return isNonEmptyString(value['workspaceId']) && isRevision(value['revision']);
}

function isRoleBinding(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return value['schemaVersion'] === 1 &&
    isNonEmptyString(value['bindingId']) &&
    isNonEmptyString(value['templateId']) &&
    isNonEmptyString(value['templateRevision']) &&
    isRevision(value['bindingVersion']) &&
    isNonEmptyString(value['policyRevision']);
}

function isTaskBudget(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return isRevision(value['tokenBudget']) &&
    (value['deadline'] === null || typeof value['deadline'] === 'string');
}

function isRunStatus(value: unknown): boolean {
  return value === 'starting' || value === 'running' || value === 'ended';
}

function isRunOutcome(value: unknown): boolean {
  return value === null || value === 'completed' || value === 'failed' || value === 'cancelled' ||
    value === 'budget_exhausted' || value === 'crashed' || value === 'outcome_unknown';
}

function isQueryRunStatus(value: unknown): boolean {
  return value === 'pending' || value === 'running' || value === 'answered' || value === 'closed';
}

function isQueryRunOutcome(value: unknown): boolean {
  return value === null || value === 'answered' || value === 'timeout' || value === 'gap' ||
    value === 'failed' || value === 'cancelled';
}

function isGrantIssuer(value: unknown): boolean {
  if (isArtifactOwnerRunRef(value)) return true;
  if (!isJsonObject(value)) return false;
  return value['aggregateType'] === 'Control' &&
    isNonEmptyString(value['projectId']) &&
    isNonEmptyString(value['goalId']);
}

function isMaterialBasis(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  if (value['planRef'] !== null && !isPlanRevisionRef(value['planRef'])) return false;
  if (value['workspaceRevision'] !== null && !isRevision(value['workspaceRevision'])) return false;
  if (value['sourceDigest'] !== null && typeof value['sourceDigest'] !== 'string') return false;
  if (value['sourcePin'] !== undefined && !validMaterialSourcePin(value['sourcePin'])) return false;
  return true;
}

function isActorRef(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  if (!isNonEmptyString(value['id'])) return false;
  const kind = value['kind'];
  if (kind === 'human' || kind === 'system') return true;
  // An agent actor is complete only with its causation RunRef (contracts/command-event.ts).
  return kind === 'agent' && isRunRef(value['runRef']);
}

function isGrantHistory(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  if (!isArtifactOwnerRunRef(value['owner'])) return false;
  if (value['usage'] !== 'historical_explanation') return false;
  const cross = value['crossWorkspace'];
  if (cross === undefined) return true;
  if (!isJsonObject(cross)) return false;
  if (!isNonEmptyString(cross['sourceWorkspaceId'])) return false;
  const authorizedBy = cross['authorizedBy'];
  if (!isJsonObject(authorizedBy)) return false;
  return authorizedBy['kind'] === 'human' && isNonEmptyString(authorizedBy['id']);
}

function isRevocation(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return typeof value['reason'] === 'string' &&
    typeof value['revokedAt'] === 'string' &&
    isActorRef(value['actor']) &&
    typeof value['commandId'] === 'string';
}

// --------------------------------------------------------------------------
// Record validators (pure encoding checks only, stored JSON is preserved)
// --------------------------------------------------------------------------

function validateRunSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== RUN_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${RUN_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json);
  if (parsed.status === 'invalid') return invalid(parsed.reason);
  const body = parsed.value;
  const ref = body['ref'];
  if (!isRunRef(ref)) return invalid('Run snapshot has no complete RunRef');
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) {
    return invalid('Run snapshot ref is not the outer canonical ref_key');
  }
  if (!isRevision(body['revision']) || body['revision'] !== record.revision) {
    return invalid('Run snapshot revision disagrees with the encoded record');
  }
  if (body['schemaVersion'] !== 1) return invalid('Run snapshot schemaVersion must be 1');
  if (body['executionHistory'] !== undefined &&
      (!isRunExecutionHistoryV1(body['executionHistory']) || body['executionHistory'].sessionRef.projectId !== ref.projectId)) {
    return invalid('Run executionHistory is malformed or outside the project');
  }
  const task = body['task'];
  if (!isJsonObject(task) || !isNonEmptyString(task['projectId']) ||
    !isNonEmptyString(task['goalId']) || !isNonEmptyString(task['taskId'])) {
    return invalid('Run snapshot task must be a complete TaskTriple');
  }
  if (task['projectId'] !== ref.projectId || task['goalId'] !== ref.goalId) {
    return invalid('Run snapshot task does not belong to the Run ref');
  }
  if (!isNonEmptyString(body['attemptId'])) return invalid('Run snapshot attemptId must be a non-empty string');
  const planRef = body['planRef'];
  if (!isPlanRevisionRef(planRef) || planRef.projectId !== ref.projectId) {
    return invalid('Run snapshot planRef must be a PlanRevisionRef of the same project');
  }
  if (!isRoleBinding(body['roleBinding'])) return invalid('Run snapshot roleBinding is not a RoleBindingRefV1');
  if (!isTaskBudget(body['budget'])) return invalid('Run snapshot budget is not a TaskBudgetV1');
  if (!isWorkspacePin(body['workspaceSnapshot'])) {
    return invalid('Run snapshot workspaceSnapshot is not a complete workspace pin');
  }
  if (!isRunStatus(body['status'])) return invalid('Run snapshot status is not a RunStatus');
  if (!isRunOutcome(body['outcome'])) return invalid('Run snapshot outcome is not a RunOutcome or null');
  if (!(body['exitCode'] === null || typeof body['exitCode'] === 'number')) {
    return invalid('Run snapshot exitCode must be a number or null');
  }
  if (!isRevision(body['lastEventSeq'])) {
    return invalid('Run snapshot lastEventSeq must be a safe non-negative integer');
  }
  if (typeof body['lastRuntimeEventId'] !== 'string' || typeof body['lastFactEventId'] !== 'string') {
    return invalid('Run snapshot last event ids must be strings');
  }
  if (!(body['envelope'] === null || isJsonObject(body['envelope']))) {
    return invalid('Run snapshot envelope must be an object or null');
  }
  if (!(body['startedAt'] === null || typeof body['startedAt'] === 'string')) {
    return invalid('Run snapshot startedAt must be a string or null');
  }
  if (!(body['endedAt'] === null || typeof body['endedAt'] === 'string')) {
    return invalid('Run snapshot endedAt must be a string or null');
  }
  return { status: 'decoded', value: record };
}

function validateQueryRunSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== QUERY_RUN_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${QUERY_RUN_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json);
  if (parsed.status === 'invalid') return invalid(parsed.reason);
  const body = parsed.value;
  const ref = body['ref'];
  if (!isQueryRunRef(ref)) return invalid('QueryRun snapshot has no complete QueryRunRef');
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) {
    return invalid('QueryRun snapshot ref is not the outer canonical ref_key');
  }
  if (!isRevision(body['revision']) || body['revision'] !== record.revision) {
    return invalid('QueryRun snapshot revision disagrees with the encoded record');
  }
  if (body['schemaVersion'] !== 1) return invalid('QueryRun snapshot schemaVersion must be 1');
  const run = body['run'];
  if (!isJsonObject(run)) return invalid('QueryRun snapshot run must be an object');
  if (run['schemaVersion'] !== 1) return invalid('QueryRun run schemaVersion must be 1');
  const queryJobRef = run['queryJobRef'];
  if (!isQueryJobRef(queryJobRef) ||
    queryJobRef.projectId !== ref.projectId ||
    queryJobRef.workspaceId !== ref.workspaceId ||
    queryJobRef.queryJobId !== ref.queryJobId) {
    return invalid('QueryRun run.queryJobRef does not match the QueryRun ref');
  }
  if (run['runId'] !== ref.runId) return invalid('QueryRun run.runId does not match the QueryRun ref runId');
  if (!isQueryRunStatus(run['status'])) return invalid('QueryRun run status is not a QueryRunStatus');
  if (!(run['startedAt'] === null || typeof run['startedAt'] === 'string')) {
    return invalid('QueryRun run startedAt must be a string or null');
  }
  if (!(run['endedAt'] === null || typeof run['endedAt'] === 'string')) {
    return invalid('QueryRun run endedAt must be a string or null');
  }
  if (!isQueryRunOutcome(run['outcome'])) return invalid('QueryRun run outcome is not a QueryRunOutcome or null');
  if (run['execution'] !== undefined && !isJsonObject(run['execution'])) {
    return invalid('QueryRun execution binding must be an object when present');
  }
  return { status: 'decoded', value: record };
}

function validateMaterialAccessGrantSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json);
  if (parsed.status === 'invalid') return invalid(parsed.reason);
  const body = parsed.value;
  const ref = body['ref'];
  if (!isMaterialAccessGrantRef(ref)) {
    return invalid('MaterialAccessGrant snapshot has no complete MaterialAccessGrantRef');
  }
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) {
    return invalid('MaterialAccessGrant snapshot ref is not the outer canonical ref_key');
  }
  if (record.revision !== 1 && record.revision !== 2) {
    return invalid('MaterialAccessGrant snapshot revision must be 1 or 2');
  }
  if (!isRevision(body['revision']) || body['revision'] !== record.revision) {
    return invalid('MaterialAccessGrant snapshot revision disagrees with the encoded record');
  }
  if (body['schemaVersion'] !== 1) return invalid('MaterialAccessGrant snapshot schemaVersion must be 1');
  const grant = body['grant'];
  if (!isJsonObject(grant)) return invalid('MaterialAccessGrant snapshot grant must be an object');
  if (grant['schemaVersion'] !== 1) return invalid('MaterialAccessGrant grant schemaVersion must be 1');
  const refRecord = ref as UnknownRecord;
  if (!isNonEmptyString(grant['grantId']) || grant['grantId'] !== refRecord['grantId']) {
    return invalid('MaterialAccessGrant grantId does not match the ref');
  }
  const scope = grant['scope'];
  if (!isMaterialAccessScope(scope) ||
    scope['projectId'] !== refRecord['projectId'] ||
    scope['workspaceId'] !== refRecord['workspaceId'] ||
    scope['goalId'] !== refRecord['goalId']) {
    return invalid('MaterialAccessGrant scope does not match the ref');
  }
  const materials = grant['materials'];
  if (!Array.isArray(materials) || materials.length < 1 || materials.length > 64) {
    return invalid('MaterialAccessGrant materials must be 1..64 exact ArtifactRefs');
  }
  for (const material of materials) {
    if (!isArtifactRef(material)) {
      return invalid('MaterialAccessGrant materials contain an incomplete ArtifactRef');
    }
  }
  if (!isArtifactOwnerRunRef(grant['reader'])) {
    return invalid('MaterialAccessGrant reader is not a complete Run/QueryRun ref');
  }
  if (!isGrantIssuer(grant['issuedBy'])) {
    return invalid('MaterialAccessGrant issuedBy is neither the owner run nor Control');
  }
  if (typeof grant['purpose'] !== 'string') return invalid('MaterialAccessGrant purpose must be a string');
  if (!isMaterialBasis(grant['basis'])) return invalid('MaterialAccessGrant basis is not a MaterialBasisV1');
  if (typeof grant['grantedAt'] !== 'string') return invalid('MaterialAccessGrant grantedAt must be a string');
  if (grant['history'] !== undefined && !isGrantHistory(grant['history'])) {
    return invalid('MaterialAccessGrant history is malformed');
  }
  if (body['revocation'] !== undefined && !isRevocation(body['revocation'])) {
    return invalid('MaterialAccessGrant revocation is malformed');
  }
  return { status: 'decoded', value: record };
}

// --------------------------------------------------------------------------
// The extended registration: Goal facts + material facts + exact lookups
// --------------------------------------------------------------------------

const RUN_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: RUN_SNAPSHOT_SCHEMA_ID,
  aggregateType: 'Run',
  validate: validateRunSnapshot,
};

const QUERY_RUN_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: QUERY_RUN_SNAPSHOT_SCHEMA_ID,
  aggregateType: 'QueryRun',
  validate: validateQueryRunSnapshot,
};

const MATERIAL_ACCESS_GRANT_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID,
  aggregateType: 'MaterialAccessGrant',
  validate: validateMaterialAccessGrantSnapshot,
};

const MATERIAL_RECORD_SCHEMAS: readonly EncodedRecordSchema[] = [
  ...GOAL_RECORD_SCHEMAS.records,
  RUN_RECORD_SCHEMA,
  QUERY_RUN_RECORD_SCHEMA,
  MATERIAL_ACCESS_GRANT_RECORD_SCHEMA,
];

/**
 * The Store interprets dotted JSON object keys, never SQL. A Run reader and a
 * QueryRun reader have different complete identities, so they get one exact
 * candidate index each; the material itself is still filtered by `sameArtifactRef`
 * on the returned canonical rows.
 */
const MATERIAL_LOOKUPS: readonly RecordLookupIndex[] = [
  {
    name: MATERIAL_GRANT_BY_RUN_READER_INDEX,
    aggregateType: 'MaterialAccessGrant',
    paths: ['grant.reader.aggregateType', 'grant.reader.projectId', 'grant.reader.goalId', 'grant.reader.runId'],
  },
  {
    name: MATERIAL_GRANT_BY_QUERY_RUN_READER_INDEX,
    aggregateType: 'MaterialAccessGrant',
    paths: [
      'grant.reader.aggregateType',
      'grant.reader.projectId',
      'grant.reader.workspaceId',
      'grant.reader.queryJobId',
      'grant.reader.runId',
    ],
  },
];

const MATERIAL_SCHEMAS: RecordBackendSchemas = {
  records: MATERIAL_RECORD_SCHEMAS,
  events: GOAL_RECORD_SCHEMAS.events,
  lookups: MATERIAL_LOOKUPS,
};

/** Extends the Goal schemas with canonical Run/QueryRun/material-grant reads and a reader index.
 * Validation is encoding validation; this does not publish an unrestricted business write API. */
export function materialRecordSchemas(): RecordBackendSchemas {
  return MATERIAL_SCHEMAS;
}

// --------------------------------------------------------------------------
// Canonical fact decoding
// --------------------------------------------------------------------------

function schemaFor(schemaId: string): EncodedRecordSchema | undefined {
  return MATERIAL_RECORD_SCHEMAS.find((schema) => schema.schemaId === schemaId);
}

function decodeCanonical(record: EncodedRecord): DecodeResult<MaterialCanonicalSnapshot> {
  const schema = schemaFor(record.schemaId);
  if (schema === undefined) {
    return invalid(`no material record schema is registered for schemaId ${record.schemaId}`);
  }
  const validated = schema.validate(record);
  if (validated.status === 'invalid') return validated;
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.json);
  } catch (error) {
    return invalid(`material snapshot is not parseable: ${messageOf(error)}`);
  }
  if (!isJsonObject(parsed)) return invalid('material snapshot JSON body is not an object');
  return { status: 'decoded', value: parsed as unknown as MaterialCanonicalSnapshot };
}

function decodeGrant(record: EncodedRecord): DecodeResult<MaterialAccessGrantSnapshot> {
  if (record.schemaId !== MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const validated = validateMaterialAccessGrantSnapshot(record);
  if (validated.status === 'invalid') return validated;
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.json);
  } catch (error) {
    return invalid(`material grant snapshot is not parseable: ${messageOf(error)}`);
  }
  if (!isJsonObject(parsed)) return invalid('material grant snapshot JSON body is not an object');
  return { status: 'decoded', value: parsed as unknown as MaterialAccessGrantSnapshot };
}

// --------------------------------------------------------------------------
// Reader lookup plans
// --------------------------------------------------------------------------

type ReaderLookupPlan = { index: string; values: readonly string[] };

function readerLookupPlan(reader: ArtifactOwnerRunRef): ReaderLookupPlan | null {
  if (reader.aggregateType === 'Run') {
    return {
      index: MATERIAL_GRANT_BY_RUN_READER_INDEX,
      values: ['Run', reader.projectId, reader.goalId, reader.runId],
    };
  }
  if (reader.aggregateType === 'QueryRun') {
    return {
      index: MATERIAL_GRANT_BY_QUERY_RUN_READER_INDEX,
      values: ['QueryRun', reader.projectId, reader.workspaceId, reader.queryJobId, reader.runId],
    };
  }
  return null;
}

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

/**
 * The factory's only dependency is the injected record port; it consults no
 * global and dynamically imports no other provider. The parameter is structurally
 * typed, so this file cannot statically prevent a caller from passing a different
 * object: the boundary is that production composition passes only the target
 * `backend.records` (readMany/lookup) and this implementation calls nothing else.
 */
export function createMaterialRecordReaders(records: GoalRecordTransactionPort & RecordLookupPort): {
  authority: MaterialAuthorityReads;
  index: MaterialCandidateReads;
} {
  const authority: MaterialAuthorityReads = {
    async load(ref: MaterialCanonicalRef) {
      let refKey: string;
      try {
        refKey = canonicalJson(ref as unknown as JsonValue);
      } catch (error) {
        return { status: 'unavailable', reason: `material ref is not canonical-JSON serializable: ${messageOf(error)}` };
      }
      let batch: StoreResult<RecordBatchRead>;
      try {
        batch = await records.readMany([refKey]);
      } catch (error) {
        return { status: 'unavailable', reason: `RecordStore readMany failed: ${messageOf(error)}` };
      }
      if (batch.status === 'rejected') {
        if (batch.code === 'not_found') return { status: 'not_found', ref };
        return { status: 'unavailable', reason: batch.reason };
      }
      const found = batch.value.records.find((record) => record.refKey === refKey);
      if (found === undefined) {
        return batch.value.missing.includes(refKey)
          ? { status: 'not_found', ref }
          : { status: 'unavailable', reason: `RecordStore returned neither a row nor a missing entry for ${refKey}` };
      }
      const decoded = decodeCanonical(found);
      if (decoded.status === 'invalid') return { status: 'unavailable', reason: decoded.reason };
      return { status: 'found', snapshot: decoded.value };
    },
  };

  const index: MaterialCandidateReads = {
    async materialAccessCandidates({ reader, material }) {
      const maybeLookup = (records as Partial<RecordLookupPort>).lookup;
      if (typeof maybeLookup !== 'function') {
        return { status: 'unavailable', reason: 'RecordStore lookup capability is not available' };
      }
      const plan = readerLookupPlan(reader);
      if (plan === null) {
        return { status: 'unavailable', reason: 'material candidate lookup requires a Run or QueryRun reader' };
      }
      const grants: MaterialAccessGrantSnapshot[] = [];
      // Within one discovery call only: guard against a provider that fails to
      // advance its keyset cursor (never reused across calls, never cached).
      const seenCursors = new Set<string>();
      let after: string | undefined;
      for (;;) {
        let page: StoreResult<RecordLookupPage>;
        try {
          page = await records.lookup({
            index: plan.index,
            values: plan.values,
            limit: LOOKUP_PAGE_LIMIT,
            ...(after === undefined ? {} : { after }),
          });
        } catch (error) {
          return { status: 'unavailable', reason: `RecordStore lookup failed: ${messageOf(error)}` };
        }
        if (page.status === 'rejected') return { status: 'unavailable', reason: page.reason };
        for (const record of page.value.records) {
          const decoded = decodeGrant(record);
          if (decoded.status === 'invalid') return { status: 'unavailable', reason: decoded.reason };
          const snapshot = decoded.value;
          // The index is a candidate finder only: recheck the full reader and the
          // exact material, and leave revocation/authorization to the common rules
          // that re-read this candidate's current canonical row.
          if (!sameArtifactOwnerRunRef(snapshot.grant.reader, reader)) continue;
          if (!snapshot.grant.materials.some((candidate) => sameArtifactRef(candidate, material))) continue;
          grants.push(snapshot);
        }
        const next = page.value.next;
        if (next === null) break;
        // Keyset pages must advance in the same UTF-8 byte order the Store uses
        // (SQLite BINARY). A repeated cursor is non-progress; a descending cursor
        // would move the next request backwards, so both fail closed here.
        const advanced = after === undefined || compareRefKeys(next, after) > 0;
        if (!advanced || seenCursors.has(next)) {
          return { status: 'unavailable', reason: 'RecordStore lookup cursor did not advance' };
        }
        seenCursors.add(next);
        after = next;
      }
      return { status: 'ready', grants };
    },
  };

  return { authority, index };
}
