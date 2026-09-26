/**
 * RecordStore codec boundary — schema registration plus key/revision/JSON
 * consistency checks, with strict input/output isolation (R3a §2.3 / §3.1).
 *
 * This file owns:
 *  - the startup validation and defensive copy of the caller's schema registry;
 *  - the generic JSON envelope check for records and events (ref_key/revision,
 *    event id/type/version/occurredAt) BEFORE any registered callback runs;
 *  - the pure-validator invocation, which can never change the outer key, schema
 *    id, revision or JSON of the value the store goes on to write;
 *  - the single copy of the R3a guard-comparison rule (`null` = must not exist,
 *    a number — including 0 — = must really exist at that revision) and of the
 *    mechanical idempotency-row checks/receipt mapping shared by both backends.
 *
 * It does NOT import WorkGraph, does no I/O and decides no domain policy: the
 * registered callbacks are the caller's pure encoding checks (WorkGraph's
 * `GOAL_RECORD_SCHEMAS`); this module only enforces the mechanical envelope.
 */
import { canonicalJson, type JsonValue } from "../../contracts/fingerprint.js";
import type { CommitCursor, CommandFingerprint } from "../../contracts/command-event.js";
import { seqOfCommitCursor } from "../../contracts/ledger.js";
import type { AggregateRef, VersionedRef } from "../../contracts/ledger.js";
import type { CommitCursorBinding, DecodeResult, EncodedDomainEvent, EncodedEventSchema, EncodedRecord, EncodedRecordSchema, PersistedIdempotencyRecord, PreparedCommit, RecordBackendSchemas, RecordGuard, StoreCommitReceipt, StoreFailure, StoredVersion, UniqueClaimChange } from "./ports.js";
import { bindCommitCursor, COMMIT_CURSOR_FIELDS, validateUniqueClaims } from "./commit-extensions.js";

// --------------------------------------------------------------------------
// Failure and small helpers
// --------------------------------------------------------------------------

export function invalidFailure(reason: string): StoreFailure {
  return { status: "rejected", code: "invalid", reason };
}

export function notFoundFailure(reason: string): StoreFailure {
  return { status: "rejected", code: "not_found", reason };
}

export function idempotencyConflictFailure(reason: string): StoreFailure {
  return { status: "rejected", code: "idempotency_conflict", reason };
}

export function corruptFailure(reason: string): StoreFailure {
  return { status: "rejected", code: "corrupt", reason };
}

export function unsupportedFailure(reason: string): StoreFailure {
  return { status: "rejected", code: "unsupported", reason };
}

export function revisionConflictFailure(
  reason: string,
  current: { refKey: string; revision: number | null }[],
): StoreFailure {
  return { status: "rejected", code: "revision_conflict", reason, current };
}

export function uniqueConflictFailure(
  reason: string,
  current: { claimKey: string; owner: string | null }[],
): StoreFailure {
  return { status: "rejected", code: "unique_conflict", reason, current };
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Aggregate revisions are safe non-negative integers (0 is a real revision). */
export function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function canonicalOf(value: unknown): DecodeResult<string> {
  try {
    return { status: "decoded", value: canonicalJson(value as JsonValue) };
  } catch (error) {
    return { status: "invalid", reason: `value is not canonical-JSON serializable: ${messageOf(error)}` };
  }
}

// --------------------------------------------------------------------------
// Schema registry
// --------------------------------------------------------------------------

/**
 * The validated, defensively copied registry. Arrays and selector metadata are
 * fresh, frozen copies: a caller mutating its own array/objects afterwards
 * cannot change this backend's behaviour, and no two backends share state.
 */
export type RecordSchemaRegistry = {
  readonly records: readonly EncodedRecordSchema[];
  readonly events: readonly EncodedEventSchema[];
  recordBySchemaId(schemaId: string): EncodedRecordSchema | undefined;
  recordByAggregateType(aggregateType: string): EncodedRecordSchema | undefined;
  eventByTypeVersion(eventType: string, schemaVersion: number): EncodedEventSchema | undefined;
};

export class RecordSchemaRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordSchemaRegistrationError";
  }
}

function registrationError(message: string): never {
  throw new RecordSchemaRegistrationError(`RecordStore schema registration: ${message}`);
}

/** Validate, copy and freeze one record schema's commit cursor whitelist. */
function validateCommitCursorFields(
  schemaId: string,
  raw: unknown,
): readonly ("since" | "until")[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) registrationError(`record schema ${schemaId} commitCursorFields must be an array`);
  const seen = new Set<string>();
  const fields: ("since" | "until")[] = [];
  for (const field of raw) {
    if (!(COMMIT_CURSOR_FIELDS as readonly unknown[]).includes(field)) {
      registrationError(`record schema ${schemaId} commitCursorFields may only contain 'since' or 'until'`);
    }
    const cursorField = field as "since" | "until";
    if (seen.has(cursorField)) registrationError(`record schema ${schemaId} has duplicate commit cursor field ${cursorField}`);
    seen.add(cursorField);
    fields.push(cursorField);
  }
  return Object.freeze(fields);
}

/**
 * Validate + copy a registry at factory time. Rejects empty identifiers, invalid
 * versions, non-function callbacks and every duplicate selector — first
 * registration wins by being the ONLY registration, never last-wins.
 */
export function createRecordSchemaRegistry(schemas: RecordBackendSchemas): RecordSchemaRegistry {
  if (!isJsonObject(schemas)) registrationError("schemas must be an object");
  const rawRecords = (schemas as Record<string, unknown>)["records"];
  const rawEvents = (schemas as Record<string, unknown>)["events"];
  if (!Array.isArray(rawRecords)) registrationError("schemas.records must be an array");
  if (!Array.isArray(rawEvents)) registrationError("schemas.events must be an array");

  const records: EncodedRecordSchema[] = [];
  const recordBySchemaId = new Map<string, EncodedRecordSchema>();
  const recordByAggregateType = new Map<string, EncodedRecordSchema>();
  for (const raw of rawRecords) {
    if (!isJsonObject(raw)) registrationError("every record schema must be an object");
    const schemaId = raw["schemaId"];
    const aggregateType = raw["aggregateType"];
    const validate = raw["validate"];
    if (!isNonEmptyString(schemaId)) registrationError("record schemaId must be a non-empty string");
    if (!isNonEmptyString(aggregateType)) registrationError(`record schema ${schemaId} aggregateType must be a non-empty string`);
    if (typeof validate !== "function") registrationError(`record schema ${schemaId} validate must be a function`);
    if (recordBySchemaId.has(schemaId)) registrationError(`duplicate record schemaId ${schemaId}`);
    if (recordByAggregateType.has(aggregateType)) registrationError(`duplicate record aggregateType ${aggregateType}`);
    const commitCursorFields = validateCommitCursorFields(schemaId, raw["commitCursorFields"]);
    const copy: EncodedRecordSchema = Object.freeze({
      schemaId,
      aggregateType,
      ...(commitCursorFields === undefined ? {} : { commitCursorFields }),
      validate: validate as EncodedRecordSchema["validate"],
    });
    records.push(copy);
    recordBySchemaId.set(schemaId, copy);
    recordByAggregateType.set(aggregateType, copy);
  }

  const events: EncodedEventSchema[] = [];
  const eventByTypeVersion = new Map<string, EncodedEventSchema>();
  for (const raw of rawEvents) {
    if (!isJsonObject(raw)) registrationError("every event schema must be an object");
    const eventType = raw["eventType"];
    const schemaVersion = raw["schemaVersion"];
    const validate = raw["validate"];
    if (!isNonEmptyString(eventType)) registrationError("event eventType must be a non-empty string");
    if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      registrationError(`event schema ${eventType} schemaVersion must be a positive safe integer`);
    }
    if (typeof validate !== "function") registrationError(`event schema ${eventType}@${schemaVersion} validate must be a function`);
    const key = eventSchemaKey(eventType, schemaVersion);
    if (eventByTypeVersion.has(key)) registrationError(`duplicate event schema ${eventType}@${schemaVersion}`);
    const copy: EncodedEventSchema = Object.freeze({
      eventType,
      schemaVersion,
      validate: validate as EncodedEventSchema["validate"],
    });
    events.push(copy);
    eventByTypeVersion.set(key, copy);
  }

  const frozenRecords = Object.freeze(records);
  const frozenEvents = Object.freeze(events);
  return Object.freeze({
    records: frozenRecords,
    events: frozenEvents,
    recordBySchemaId: (schemaId: string) => recordBySchemaId.get(schemaId),
    recordByAggregateType: (aggregateType: string) => recordByAggregateType.get(aggregateType),
    eventByTypeVersion: (eventType: string, schemaVersion: number) =>
      eventByTypeVersion.get(eventSchemaKey(eventType, schemaVersion)),
  });
}

function eventSchemaKey(eventType: string, schemaVersion: number): string {
  return `${eventType}@${schemaVersion}`;
}

// --------------------------------------------------------------------------
// Generic JSON envelope checks
// --------------------------------------------------------------------------

export function parseJsonObject(json: unknown): DecodeResult<Record<string, unknown>> {
  if (typeof json !== "string") return { status: "invalid", reason: "json must be a string" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { status: "invalid", reason: `json is not parseable: ${messageOf(error)}` };
  }
  if (!isJsonObject(parsed)) return { status: "invalid", reason: "json body is not a JSON object" };
  return { status: "decoded", value: parsed };
}

export type DecodedRefKey = { refKey: string; aggregateType: string };

/**
 * A ref_key must be the canonical key of a FULL aggregate ref: parseable JSON
 * object, non-empty `aggregateType`, and byte-identical to its canonical
 * serialization. Deeper domain shape is the registered codec's job.
 */
export function decodeRefKey(refKey: unknown): DecodeResult<DecodedRefKey> {
  const parsed = parseJsonObject(refKey);
  if (parsed.status === "invalid") return { status: "invalid", reason: `ref_key is not a full ref: ${parsed.reason}` };
  const aggregateType = parsed.value["aggregateType"];
  if (!isNonEmptyString(aggregateType)) {
    return { status: "invalid", reason: 'ref_key is not a full aggregate ref: "aggregateType" must be a non-empty string' };
  }
  const canonical = canonicalOf(parsed.value);
  if (canonical.status === "invalid") return { status: "invalid", reason: `ref_key is not a full ref: ${canonical.reason}` };
  if (canonical.value !== refKey) {
    return { status: "invalid", reason: "ref_key is not the canonical key of its full ref" };
  }
  return { status: "decoded", value: { refKey, aggregateType } };
}

export type DecodedRecordEnvelope = {
  /** The encoded record the store reads or writes (outer fields verified). */
  record: EncodedRecord;
  /** The full aggregate ref parsed out of the JSON body. */
  ref: AggregateRef;
  aggregateType: string;
  /** The parsed JSON body (used for the legacy aggregate_revisions format). */
  parsed: Record<string, unknown>;
};

/**
 * Derive one EncodedRecord from a JSON body and cross-check it against the
 * outer key/revision:
 *  - `ref_key` must equal the canonical key of the body's full `ref`;
 *  - the body must carry a safe non-negative `revision`;
 *  - `revision` (when given) must equal the body's revision.
 */
export function decodeRecordBody(input: {
  refKey: string;
  schemaId: string;
  /** null → take the revision from the JSON body; a number → the body must match exactly. */
  revision: number | null;
  json: string;
}): DecodeResult<DecodedRecordEnvelope> {
  const parsed = parseJsonObject(input.json);
  if (parsed.status === "invalid") return { status: "invalid", reason: `snapshot body: ${parsed.reason}` };
  const revision = parsed.value["revision"];
  if (!isRevision(revision)) {
    return { status: "invalid", reason: "snapshot body revision must be a safe non-negative integer" };
  }
  if (input.revision !== null && input.revision !== revision) {
    return {
      status: "invalid",
      reason: `snapshot body revision ${revision} does not match the encoded record revision ${input.revision}`,
    };
  }
  const ref = parsed.value["ref"];
  if (!isJsonObject(ref)) return { status: "invalid", reason: "snapshot body ref must be a JSON object" };
  const aggregateType = ref["aggregateType"];
  if (!isNonEmptyString(aggregateType)) {
    return { status: "invalid", reason: "snapshot body ref.aggregateType must be a non-empty string" };
  }
  const canonical = canonicalOf(ref);
  if (canonical.status === "invalid") return { status: "invalid", reason: `snapshot body ref: ${canonical.reason}` };
  if (canonical.value !== input.refKey) {
    return { status: "invalid", reason: "snapshot body ref does not match the canonical ref_key of the record" };
  }
  return {
    status: "decoded",
    value: {
      record: { refKey: input.refKey, schemaId: input.schemaId, revision, json: input.json },
      ref: ref as unknown as AggregateRef,
      aggregateType,
      parsed: parsed.value,
    },
  };
}

export type DecodedEventEnvelope = {
  event: EncodedDomainEvent;
  parsed: Record<string, unknown>;
};

function readEventEnvelope(json: unknown): DecodeResult<DecodedEventEnvelope> {
  const parsed = parseJsonObject(json);
  if (parsed.status === "invalid") return { status: "invalid", reason: `event body: ${parsed.reason}` };
  const eventId = parsed.value["eventId"];
  const eventType = parsed.value["eventType"];
  const schemaVersion = parsed.value["schemaVersion"];
  const occurredAt = parsed.value["occurredAt"];
  if (!isNonEmptyString(eventId)) return { status: "invalid", reason: "event body eventId must be a non-empty string" };
  if (!isNonEmptyString(eventType)) return { status: "invalid", reason: "event body eventType must be a non-empty string" };
  if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    return { status: "invalid", reason: "event body schemaVersion must be a positive safe integer" };
  }
  if (!isNonEmptyString(occurredAt)) return { status: "invalid", reason: "event body occurredAt must be a non-empty string" };
  return {
    status: "decoded",
    value: { event: { eventId, eventType, schemaVersion, occurredAt, json: json as string }, parsed: parsed.value },
  };
}

/** Storage read path: take the envelope out of the stored event JSON body. */
export function decodeStoredEventBody(json: string): DecodeResult<DecodedEventEnvelope> {
  return readEventEnvelope(json);
}

/** Write path: the caller-supplied envelope must agree with the JSON body. */
export function decodeEventBody(input: EncodedDomainEvent): DecodeResult<DecodedEventEnvelope> {
  const decoded = readEventEnvelope(input.json);
  if (decoded.status === "invalid") return decoded;
  const fields: readonly (keyof EncodedDomainEvent)[] = ["eventId", "eventType", "schemaVersion", "occurredAt"];
  for (const field of fields) {
    if (input[field] !== decoded.value.event[field]) {
      return { status: "invalid", reason: `event json does not match the encoded event ${field}` };
    }
  }
  return decoded;
}

// --------------------------------------------------------------------------
// Registered pure validators (with input/output isolation)
// --------------------------------------------------------------------------

function reasonFrom(outcome: unknown, fallback: string): string {
  if (isJsonObject(outcome)) {
    const reason = outcome["reason"];
    if (isNonEmptyString(reason)) return reason;
  }
  return fallback;
}

/**
 * Run the registered record codec on a frozen copy and adopt the result ONLY if
 * the callback returned a decoded record whose outer fields are unchanged: a
 * callback cannot rewrite the key, schema id, revision or JSON the store writes.
 */
export function applyRecordSchema(
  decoded: DecodedRecordEnvelope,
  schema: EncodedRecordSchema,
): DecodeResult<DecodedRecordEnvelope> {
  if (decoded.aggregateType !== schema.aggregateType) {
    return {
      status: "invalid",
      reason: `record aggregateType ${decoded.aggregateType} does not match schema ${schema.schemaId} (${schema.aggregateType})`,
    };
  }
  const outcome: unknown = schema.validate(Object.freeze({ ...decoded.record }));
  if (!isJsonObject(outcome) || outcome["status"] !== "decoded") {
    return {
      status: "invalid",
      reason: `record schema ${schema.schemaId} rejected the record: ${reasonFrom(outcome, "invalid encoding")}`,
    };
  }
  const value = outcome["value"];
  if (!isJsonObject(value)) {
    return { status: "invalid", reason: `record schema ${schema.schemaId} returned no decoded record` };
  }
  const fields: readonly (keyof EncodedRecord)[] = ["refKey", "schemaId", "revision", "json"];
  for (const field of fields) {
    if (value[field] !== decoded.record[field]) {
      return { status: "invalid", reason: `record schema ${schema.schemaId} attempted to change the encoded record ${field}` };
    }
  }
  return { status: "decoded", value: decoded };
}

/** Event twin of {@link applyRecordSchema}. */
export function applyEventSchema(
  decoded: DecodedEventEnvelope,
  schema: EncodedEventSchema,
): DecodeResult<DecodedEventEnvelope> {
  const outcome: unknown = schema.validate(Object.freeze({ ...decoded.event }));
  if (!isJsonObject(outcome) || outcome["status"] !== "decoded") {
    return {
      status: "invalid",
      reason: `event schema ${schema.eventType}@${schema.schemaVersion} rejected the event: ${reasonFrom(outcome, "invalid encoding")}`,
    };
  }
  const value = outcome["value"];
  if (!isJsonObject(value)) {
    return { status: "invalid", reason: `event schema ${schema.eventType}@${schema.schemaVersion} returned no decoded event` };
  }
  const fields: readonly (keyof EncodedDomainEvent)[] = ["eventId", "eventType", "schemaVersion", "occurredAt", "json"];
  for (const field of fields) {
    if (value[field] !== decoded.event[field]) {
      return {
        status: "invalid",
        reason: `event schema ${schema.eventType}@${schema.schemaVersion} attempted to change the encoded event ${field}`,
      };
    }
  }
  return { status: "decoded", value: decoded };
}

// --------------------------------------------------------------------------
// PreparedCommit planning (shared by the SQLite and in-memory backends)
// --------------------------------------------------------------------------

const PREPARED_COMMIT_FIELDS: readonly string[] = [
  "identityKey",
  "fingerprint",
  "guards",
  "records",
  "claims",
  "indexGuards",
  "indexChanges",
  "events",
  "ledgerHorizon",
  "commitCursorBindings",
];

const UNIMPLEMENTED_FIELDS: readonly string[] = ["indexGuards", "indexChanges"];

export type PlannedCommit = {
  identityKey: string;
  fingerprint: string;
  guards: readonly RecordGuard[];
  records: readonly DecodedRecordEnvelope[];
  claims: readonly UniqueClaimChange[];
  events: readonly DecodedEventEnvelope[];
  /** undefined = the caller omitted the field (no check); null = explicit empty-ledger check. */
  ledgerHorizon: CommitCursor | null | undefined;
  commitCursorBindings: readonly CommitCursorBinding[];
};

/**
 * The complete out-of-transaction validation/encoding step:
 *  - rejects unmodelled fields and every non-empty `indexGuards` /
 *    `indexChanges` (accepting-and-ignoring them would be a bug);
 *  - validates distinct exact unique claims and the optional ledger horizon;
 *  - rejects duplicate guards and duplicate record keys;
 *  - requires every written key to have a guard (extra guards are normal: the
 *    Goal commit guards Project + Workspace without writing them);
 *  - checks generic JSON, outer key/revision/schema consistency and then runs
 *    the matching registered pure validator;
 *  - mechanically checks every commit cursor binding (written + guarded target,
 *    registered whitelist, null placeholder). The real cursor is bound later,
 *    inside the transaction, before the final registered schema validation.
 */
export function planPreparedCommit(
  prepared: PreparedCommit,
  registry: RecordSchemaRegistry,
): DecodeResult<PlannedCommit> {
  if (!isJsonObject(prepared)) return { status: "invalid", reason: "PreparedCommit must be an object" };
  for (const field of Object.keys(prepared)) {
    if (!PREPARED_COMMIT_FIELDS.includes(field)) {
      return { status: "invalid", reason: `PreparedCommit field "${field}" is not implemented in this batch` };
    }
  }

  const identityKey = prepared["identityKey"];
  if (!isNonEmptyString(identityKey)) return { status: "invalid", reason: "PreparedCommit.identityKey must be a non-empty string" };
  const fingerprint = prepared["fingerprint"];
  if (!isNonEmptyString(fingerprint)) return { status: "invalid", reason: "PreparedCommit.fingerprint must be a non-empty string" };

  const dynamic = prepared as unknown as Record<string, unknown>;
  for (const field of UNIMPLEMENTED_FIELDS) {
    const value = dynamic[field];
    if (!Array.isArray(value)) {
      return { status: "invalid", reason: `PreparedCommit.${field} must be the empty tuple in this batch` };
    }
    if (value.length > 0) {
      return { status: "invalid", reason: `PreparedCommit.${field} is not implemented in this batch (must be empty)` };
    }
  }

  const claims = validateUniqueClaims(dynamic["claims"] as readonly UniqueClaimChange[]);
  if (claims.status === "invalid") return claims;

  const rawHorizon = dynamic["ledgerHorizon"];
  let ledgerHorizon: CommitCursor | null | undefined;
  if (rawHorizon === undefined) {
    ledgerHorizon = undefined;
  } else if (rawHorizon === null) {
    ledgerHorizon = null;
  } else if (typeof rawHorizon === "string") {
    try {
      seqOfCommitCursor(rawHorizon as CommitCursor);
    } catch (error) {
      return { status: "invalid", reason: `PreparedCommit.ledgerHorizon is not a ledger cursor: ${messageOf(error)}` };
    }
    ledgerHorizon = rawHorizon as CommitCursor;
  } else {
    return { status: "invalid", reason: "PreparedCommit.ledgerHorizon must be null or a ledger cursor string" };
  }

  const rawGuards = prepared["guards"];
  if (!Array.isArray(rawGuards)) return { status: "invalid", reason: "PreparedCommit.guards must be an array" };
  const guards: RecordGuard[] = [];
  const guardKeys = new Set<string>();
  for (const raw of rawGuards) {
    if (!isJsonObject(raw)) return { status: "invalid", reason: "every RecordGuard must be an object" };
    const refKey = raw["refKey"];
    if (!isNonEmptyString(refKey)) return { status: "invalid", reason: "RecordGuard.refKey must be a non-empty string" };
    const expectedRevision = raw["expectedRevision"];
    if (expectedRevision !== null && !isRevision(expectedRevision)) {
      return {
        status: "invalid",
        reason: `RecordGuard ${refKey} expectedRevision must be null or a safe non-negative integer`,
      };
    }
    if (guardKeys.has(refKey)) return { status: "invalid", reason: `duplicate guard for ${refKey}` };
    guardKeys.add(refKey);
    guards.push({ refKey, expectedRevision });
  }

  const rawRecords = prepared["records"];
  if (!Array.isArray(rawRecords)) return { status: "invalid", reason: "PreparedCommit.records must be an array" };
  const records: DecodedRecordEnvelope[] = [];
  const recordKeys = new Set<string>();
  for (const raw of rawRecords) {
    if (!isJsonObject(raw)) return { status: "invalid", reason: "every EncodedRecord must be an object" };
    const refKey = raw["refKey"];
    const schemaId = raw["schemaId"];
    const revision = raw["revision"];
    const json = raw["json"];
    if (!isNonEmptyString(refKey)) return { status: "invalid", reason: "EncodedRecord.refKey must be a non-empty string" };
    if (!isNonEmptyString(schemaId)) return { status: "invalid", reason: `EncodedRecord ${refKey} schemaId must be a non-empty string` };
    if (!isRevision(revision)) {
      return { status: "invalid", reason: `EncodedRecord ${refKey} revision must be a safe non-negative integer` };
    }
    if (typeof json !== "string") return { status: "invalid", reason: `EncodedRecord ${refKey} json must be a string` };
    if (recordKeys.has(refKey)) return { status: "invalid", reason: `duplicate record for ${refKey}` };
    recordKeys.add(refKey);
    if (!guardKeys.has(refKey)) return { status: "invalid", reason: `record ${refKey} has no matching guard` };
    const schema = registry.recordBySchemaId(schemaId);
    if (schema === undefined) return { status: "invalid", reason: `record ${refKey} uses unregistered schemaId ${schemaId}` };
    const decoded = decodeRecordBody({ refKey, schemaId, revision, json });
    if (decoded.status === "invalid") return decoded;
    if (decoded.value.aggregateType !== schema.aggregateType) {
      return {
        status: "invalid",
        reason: `record aggregateType ${decoded.value.aggregateType} does not match schema ${schema.schemaId} (${schema.aggregateType})`,
      };
    }
    // Only the mechanical envelope is checked here. A record a commit cursor
    // binding will fill is fully validated after binding, inside the
    // transaction, because a registered `since` schema may reject the null
    // placeholder.
    records.push(decoded.value);
  }

  const recordsByKey = new Map(records.map(record => [record.record.refKey, record]));
  const rawBindings = dynamic["commitCursorBindings"];
  const commitCursorBindings: CommitCursorBinding[] = [];
  const boundRecordKeys = new Set<string>();
  if (rawBindings !== undefined) {
    if (!Array.isArray(rawBindings)) {
      return { status: "invalid", reason: "PreparedCommit.commitCursorBindings must be an array" };
    }
    const seenBindings = new Set<string>();
    for (const raw of rawBindings) {
      if (!isJsonObject(raw)) return { status: "invalid", reason: "every CommitCursorBinding must be an object" };
      const refKey = raw["refKey"];
      const field = raw["field"];
      if (!isNonEmptyString(refKey)) {
        return { status: "invalid", reason: "CommitCursorBinding.refKey must be a non-empty string" };
      }
      if (field !== "since" && field !== "until") {
        return { status: "invalid", reason: "CommitCursorBinding.field must be 'since' or 'until'" };
      }
      const bindingKey = `${refKey}\u0000${field}`;
      if (seenBindings.has(bindingKey)) {
        return { status: "invalid", reason: `duplicate commit cursor binding for ${refKey}.${field}` };
      }
      seenBindings.add(bindingKey);
      if (!guardKeys.has(refKey)) {
        return { status: "invalid", reason: `commit cursor binding target ${refKey} has no record guard` };
      }
      const target = recordsByKey.get(refKey);
      if (target === undefined) {
        return { status: "invalid", reason: `commit cursor binding target ${refKey} is not written by this commit` };
      }
      const schema = registry.recordBySchemaId(target.record.schemaId);
      if (schema === undefined) {
        return { status: "invalid", reason: `record ${refKey} uses unregistered schemaId ${target.record.schemaId}` };
      }
      const allowed = schema.commitCursorFields ?? [];
      if (!allowed.includes(field)) {
        return { status: "invalid", reason: `record schema ${schema.schemaId} does not allow commit cursor field ${field}` };
      }
      if (target.parsed[field] !== null) {
        return { status: "invalid", reason: `record ${refKey} commit cursor field ${field} is not a null placeholder` };
      }
      commitCursorBindings.push({ refKey, field });
      boundRecordKeys.add(refKey);
    }
  }

  // Records without a binding keep the original full pre-validation. Bound
  // records are finalized inside the transaction after the real cursor is known.
  const finalizedRecords: DecodedRecordEnvelope[] = [];
  for (const record of records) {
    if (boundRecordKeys.has(record.record.refKey)) {
      finalizedRecords.push(record);
      continue;
    }
    const schema = registry.recordBySchemaId(record.record.schemaId);
    if (schema === undefined) {
      return { status: "invalid", reason: `record ${record.record.refKey} uses unregistered schemaId ${record.record.schemaId}` };
    }
    const applied = applyRecordSchema(record, schema);
    if (applied.status === "invalid") return applied;
    finalizedRecords.push(applied.value);
  }

  const rawEvents = prepared["events"];
  if (!Array.isArray(rawEvents)) return { status: "invalid", reason: "PreparedCommit.events must be an array" };
  if (rawEvents.length === 0) {
    return {
      status: "invalid",
      reason: "PreparedCommit.events must contain at least one event (the receipt cursor identifies the commit)",
    };
  }
  const events: DecodedEventEnvelope[] = [];
  for (const raw of rawEvents) {
    if (!isJsonObject(raw)) return { status: "invalid", reason: "every EncodedDomainEvent must be an object" };
    const eventId = raw["eventId"];
    const eventType = raw["eventType"];
    const schemaVersion = raw["schemaVersion"];
    const occurredAt = raw["occurredAt"];
    const json = raw["json"];
    if (!isNonEmptyString(eventId)) return { status: "invalid", reason: "EncodedDomainEvent.eventId must be a non-empty string" };
    if (!isNonEmptyString(eventType)) return { status: "invalid", reason: `event ${eventId} eventType must be a non-empty string` };
    if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      return { status: "invalid", reason: `event ${eventId} schemaVersion must be a positive safe integer` };
    }
    if (!isNonEmptyString(occurredAt)) return { status: "invalid", reason: `event ${eventId} occurredAt must be a non-empty string` };
    if (typeof json !== "string") return { status: "invalid", reason: `event ${eventId} json must be a string` };
    const decoded = decodeEventBody({ eventId, eventType, schemaVersion, occurredAt, json });
    if (decoded.status === "invalid") return decoded;
    const schema = registry.eventByTypeVersion(eventType, schemaVersion);
    if (schema === undefined) {
      return { status: "invalid", reason: `event ${eventId} uses unregistered schema ${eventType}@${schemaVersion}` };
    }
    const applied = applyEventSchema(decoded.value, schema);
    if (applied.status === "invalid") return applied;
    events.push(applied.value);
  }

  return {
    status: "decoded",
    value: {
      identityKey,
      fingerprint,
      guards,
      records: finalizedRecords,
      claims: claims.value,
      events,
      ledgerHorizon,
      commitCursorBindings,
    },
  };
}

/**
 * In-transaction cursor binding plus final registered schema validation. Only
 * the records named by `bindings` are re-decoded and re-validated after their
 * registered null cursor field is filled with the real last-event cursor;
 * unbound records keep the full out-of-transaction validation they already had.
 */
export function bindPreparedRecords(
  records: readonly DecodedRecordEnvelope[],
  bindings: readonly CommitCursorBinding[],
  cursor: CommitCursor,
  registry: RecordSchemaRegistry,
): DecodeResult<readonly DecodedRecordEnvelope[]> {
  if (bindings.length === 0) return { status: "decoded", value: records };
  const allowedFields = (schemaId: string): readonly ("since" | "until")[] =>
    registry.recordBySchemaId(schemaId)?.commitCursorFields ?? [];
  const bound = bindCommitCursor(
    records.map((entry) => entry.record),
    bindings,
    cursor,
    allowedFields,
  );
  if (bound.status === "invalid") return bound;
  const original = new Map(records.map((entry) => [entry.record.refKey, entry]));
  const boundKeys = new Set(bindings.map((binding) => binding.refKey));
  const output: DecodedRecordEnvelope[] = [];
  for (const record of bound.value) {
    const source = original.get(record.refKey);
    if (source === undefined) {
      return { status: "invalid", reason: `bound record ${record.refKey} was not part of this commit` };
    }
    if (!boundKeys.has(record.refKey)) {
      output.push(source);
      continue;
    }
    const schema = registry.recordBySchemaId(record.schemaId);
    if (schema === undefined) {
      return { status: "invalid", reason: `record ${record.refKey} uses unregistered schemaId ${record.schemaId}` };
    }
    const decoded = decodeRecordBody({
      refKey: record.refKey,
      schemaId: record.schemaId,
      revision: record.revision,
      json: record.json,
    });
    if (decoded.status === "invalid") return decoded;
    const applied = applyRecordSchema(decoded.value, schema);
    if (applied.status === "invalid") return applied;
    output.push(applied.value);
  }
  return { status: "decoded", value: output };
}

// --------------------------------------------------------------------------
// Guard rule + mechanical idempotency/receipt helpers (one copy for both backends)
// --------------------------------------------------------------------------

/**
 * The single copy of the R3a guard rule: `null` requires the row to NOT exist;
 * a numeric expectation (including 0) requires the row to really exist at that
 * revision. A missing row is never silently treated as revision 0.
 */
export function guardIsSatisfied(expectedRevision: number | null, currentRevision: number | null): boolean {
  return expectedRevision === null ? currentRevision === null : currentRevision === expectedRevision;
}

/** Validate one stored legacy idempotency row (original column/JSON format). */
export function checkPersistedIdempotencyRecord(value: unknown): DecodeResult<PersistedIdempotencyRecord> {
  if (!isJsonObject(value)) return { status: "invalid", reason: "idempotency record must be an object" };
  const fingerprint = value["fingerprint"];
  if (!isNonEmptyString(fingerprint)) return { status: "invalid", reason: "idempotency fingerprint must be a non-empty string" };
  const eventIds = value["eventIds"];
  if (!Array.isArray(eventIds) || !eventIds.every((id) => isNonEmptyString(id))) {
    return { status: "invalid", reason: "idempotency eventIds must be an array of non-empty strings" };
  }
  const aggregateRevisions = value["aggregateRevisions"];
  if (!Array.isArray(aggregateRevisions)) {
    return { status: "invalid", reason: "idempotency aggregateRevisions must be an array" };
  }
  const revisions: VersionedRef[] = [];
  for (const raw of aggregateRevisions) {
    if (!isJsonObject(raw)) return { status: "invalid", reason: "idempotency aggregate revision must be an object" };
    const ref = raw["ref"];
    if (!isJsonObject(ref)) return { status: "invalid", reason: "idempotency aggregate revision ref must be an object" };
    if (!isNonEmptyString(ref["aggregateType"])) {
      return { status: "invalid", reason: "idempotency aggregate revision ref.aggregateType must be a non-empty string" };
    }
    const revision = raw["revision"];
    if (!isRevision(revision)) {
      return { status: "invalid", reason: "idempotency aggregate revision must be a safe non-negative integer" };
    }
    revisions.push({ ref: ref as unknown as AggregateRef, revision });
  }
  const commitCursor = value["commitCursor"];
  if (typeof commitCursor !== "string") return { status: "invalid", reason: "idempotency commitCursor must be a cursor string" };
  try {
    seqOfCommitCursor(commitCursor as CommitCursor);
  } catch (error) {
    return { status: "invalid", reason: `idempotency commitCursor is not a ledger cursor: ${messageOf(error)}` };
  }
  return {
    status: "decoded",
    value: {
      fingerprint: fingerprint as CommandFingerprint,
      eventIds: [...eventIds],
      aggregateRevisions: revisions,
      commitCursor: commitCursor as CommitCursor,
    },
  };
}

/** Deep copy so a caller can never mutate stored/returned idempotency values. */
export function clonePersistedIdempotencyRecord(value: PersistedIdempotencyRecord): PersistedIdempotencyRecord {
  return {
    fingerprint: value.fingerprint,
    eventIds: [...value.eventIds],
    aggregateRevisions: value.aggregateRevisions.map((entry) => ({ ref: entry.ref, revision: entry.revision })),
    commitCursor: value.commitCursor,
  };
}

/** Canonical ref keys of a stored legacy idempotency row, in stored order. */
export function storedVersionsOf(record: PersistedIdempotencyRecord): StoredVersion[] {
  return record.aggregateRevisions.map((entry) => ({
    refKey: canonicalJson(entry.ref as unknown as JsonValue),
    revision: entry.revision,
  }));
}

/** Build the committed (replayed) receipt out of a stored idempotency row. */
export function committedReceiptFromIdempotency(
  identityKey: string,
  record: PersistedIdempotencyRecord,
): Extract<StoreCommitReceipt, { status: "committed" }> {
  return {
    status: "committed",
    replayed: true,
    identityKey,
    versions: storedVersionsOf(record),
    eventIds: [...record.eventIds],
    cursor: record.commitCursor,
  };
}
