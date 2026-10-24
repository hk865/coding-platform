/**
 * WorkGraph material record readers — the target RecordStore implementation of
 * `MaterialAuthorityReads`.
 *
 * This file owns exactly two things:
 *  - the registration of the read-only encodings for the canonical facts
 *    material access actually consumes (`RunSnapshot@1`, `QueryRunSnapshot@1`)
 *    on top of the existing Goal registration; the checks themselves live in
 *    `persistence/run-record-codecs.ts` and are reached through the two
 *    same-named delegates below; and
 *  - the reader implementation over the injected RecordStore (`readMany` for
 *    exact canonical facts).
 *
 * Boundaries deliberately enforced here:
 *  - no StateLedger / ReadModelIndex import, no second SQLite/Map, no old
 *    repository scan and no dynamic import; the single injected dependency is
 *    the RecordStore record port and production composition passes only the
 *    target `backend.records`;
 *  - the registered callbacks only check persistent encoding, complete identity,
 *    revision/schemaVersion and the fields material use needs; they never admit
 *    a business operation and never re-normalize stored JSON.
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
import { isJsonObject } from '../../record-store/record-codec.js';
import { GOAL_RECORD_SCHEMAS } from '../persistence/record-codecs.js';
import {
  QUERY_RUN_SNAPSHOT_SCHEMA_ID,
  RUN_SNAPSHOT_SCHEMA_ID,
  validateQueryRunSnapshot as validateQueryRunSnapshotRecord,
  validateRunSnapshot as validateRunSnapshotRecord,
} from '../persistence/run-record-codecs.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { invalid } from '../../../contracts/validation/common.js';
import type {
  MaterialAuthorityReads,
  MaterialCanonicalRef,
  MaterialCanonicalSnapshot,
} from './record-ports.js';
/** Kept module exit: queries/query-record-codecs.ts:59 imports these from here. */
export { executionPreparedProblem, executionRequestProfileProblem } from '../persistence/run-record-codecs.js';

// --------------------------------------------------------------------------
// Delegates to the one implementation (persistence/run-record-codecs.ts)
// --------------------------------------------------------------------------

/** The registered RunSnapshot@1 check; its one implementation is persistence/run-record-codecs.ts (A-01). */
function validateRunSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  return validateRunSnapshotRecord(record);
}

/** Narrow export kept for queries and tasks; the one implementation is persistence/run-record-codecs.ts (A-01). */
export function validateQueryRunSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  return validateQueryRunSnapshotRecord(record);
}

// --------------------------------------------------------------------------
// The extended registration: Goal facts + material facts
// --------------------------------------------------------------------------

const RUN_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: RUN_SNAPSHOT_SCHEMA_ID,
  aggregateType: 'Run',
  validate: validateRunSnapshot,
};

/** Narrow export: QueryRunSnapshot@1 registration owner stays this module. */
export const QUERY_RUN_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: QUERY_RUN_SNAPSHOT_SCHEMA_ID,
  aggregateType: 'QueryRun',
  validate: validateQueryRunSnapshot,
};

const MATERIAL_RECORD_SCHEMAS: readonly EncodedRecordSchema[] = [
  ...GOAL_RECORD_SCHEMAS.records,
  RUN_RECORD_SCHEMA,
  QUERY_RUN_RECORD_SCHEMA,
];

const MATERIAL_SCHEMAS: RecordBackendSchemas = {
  records: MATERIAL_RECORD_SCHEMAS,
  events: GOAL_RECORD_SCHEMAS.events,
};

/** Extends the Goal schemas with canonical Run/QueryRun reads.
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

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

/**
 * The factory's only dependency is the injected record port; it consults no
 * global and dynamically imports no other provider. The parameter is structurally
 * typed, so this file cannot statically prevent a caller from passing a different
 * object: the boundary is that production composition passes only the target
 * `backend.records` (readMany) and this implementation calls nothing else.
 */
export function createMaterialRecordReaders(records: GoalRecordTransactionPort): {
  authority: MaterialAuthorityReads;
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

  return { authority };
}
