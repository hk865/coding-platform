/**
 * M1 material grant record codecs — persisted encoding and event validation for
 * the two new WorkGraph write events.
 *
 * This file owns exactly three things:
 *  - the persisted record encoder/decoder for the EXISTING
 *    MaterialAccessGrantSnapshot@1 aggregate (revision 1 = active, revision 2 =
 *    revoked; the grant body is never rewritten by a revocation);
 *  - the two new event validators MaterialAccessGranted@1 / MaterialAccessRevoked@1,
 *    which carry the complete snapshot plus the trusted actor/command identity
 *    needed to restore the original receipt on replay; and
 *  - the registration list the composition root aggregates.
 *
 * It deliberately does NOT register a second MaterialAccessGrantSnapshot codec.
 * The reader-owned validator is looked up once by its fixed schemaId and reused
 * for the embedded snapshot, so the store keeps exactly one snapshot schema.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { MaterialAccessGrantSnapshot } from '../../../contracts/material-access.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  EncodedEventSchema,
  EncodedRecord,
} from '../../record-store/ports.js';
import { materialRecordSchemas } from './record-readers.js';

// --------------------------------------------------------------------------
// Fixed registration identifiers
// --------------------------------------------------------------------------

export const MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID = 'MaterialAccessGrantSnapshot@1';
export const MATERIAL_ACCESS_GRANTED_EVENT = 'MaterialAccessGranted';
export const MATERIAL_ACCESS_GRANTED_SCHEMA_VERSION = 1;
export const MATERIAL_ACCESS_REVOKED_EVENT = 'MaterialAccessRevoked';
export const MATERIAL_ACCESS_REVOKED_SCHEMA_VERSION = 1;

/** The revocation half of a revision-2 snapshot; owned by the shared contract. */
export type MaterialAccessRevocationV1 = NonNullable<MaterialAccessGrantSnapshot['revocation']>;

/**
 * New grant event. `payload.snapshot` is the complete revision-1 snapshot, so a
 * replay never has to recompile the grant from the current Goal/Plan/source.
 * `idempotencyKey`/`fingerprint` mirror the Store idempotency row so a replay
 * can reject a mismatched event instead of handing back a foreign receipt.
 */
export type MaterialAccessGrantedEvent = {
  eventId: string;
  eventType: 'MaterialAccessGranted';
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: 'MaterialAccessGrant';
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  fingerprint: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { snapshot: MaterialAccessGrantSnapshot };
};

/** Revocation event. The original grant body is preserved inside the snapshot. */
export type MaterialAccessRevokedEvent = {
  eventId: string;
  eventType: 'MaterialAccessRevoked';
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: 'MaterialAccessGrant';
  aggregateId: string;
  aggregateRevision: 2;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  fingerprint: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { snapshot: MaterialAccessGrantSnapshot };
};

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function invalid<T>(reason: string): DecodeResult<T> {
  return { status: 'invalid', reason };
}

function parseObject(json: string): UnknownRecord | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function trustedActor(value: unknown): value is Extract<ActorRef, { kind: 'human' | 'system' }> {
  if (!isRecord(value)) return false;
  return (value['kind'] === 'human' || value['kind'] === 'system') && nonEmpty(value['id']);
}

/**
 * The reader-owned validator, resolved once by its fixed schemaId. Reusing this
 * exact callback keeps the Store's single MaterialAccessGrantSnapshot@1
 * registration and prevents a second, drifting copy of the snapshot rules.
 */
const snapshotSchema = materialRecordSchemas().records.find(
  (schema) => schema.schemaId === MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID,
);

function encodedSnapshotRecord(snapshot: MaterialAccessGrantSnapshot): EncodedRecord | null {
  try {
    return {
      refKey: canonicalJson(snapshot.ref as unknown as JsonValue),
      schemaId: MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID,
      revision: snapshot.revision,
      json: JSON.stringify(snapshot),
    };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Snapshot codec
// --------------------------------------------------------------------------

/** Encodes one MaterialAccessGrantSnapshot at its own revision (1 active, 2 revoked). */
export function encodeMaterialAccessGrantSnapshot(snapshot: MaterialAccessGrantSnapshot): EncodedRecord {
  return {
    refKey: canonicalJson(snapshot.ref as unknown as JsonValue),
    schemaId: MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

/** Decodes a snapshot through the existing reader-owned validator. */
export function decodeMaterialAccessGrantSnapshot(
  record: EncodedRecord,
): DecodeResult<MaterialAccessGrantSnapshot> {
  if (record.schemaId !== MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  if (snapshotSchema === undefined) {
    return invalid(`no shared validator is registered for ${MATERIAL_ACCESS_GRANT_SNAPSHOT_SCHEMA_ID}`);
  }
  const validated = snapshotSchema.validate(Object.freeze({ ...record }));
  if (validated.status === 'invalid') return validated;
  const parsed = parseObject(record.json);
  if (parsed === null) return invalid('MaterialAccessGrant snapshot is not a JSON object');
  return { status: 'decoded', value: parsed as unknown as MaterialAccessGrantSnapshot };
}

// --------------------------------------------------------------------------
// Event codecs
// --------------------------------------------------------------------------

function validateGrantEvent(
  event: EncodedDomainEvent,
  expectedType: string,
  expectedRevision: 1 | 2,
): DecodeResult<{ body: UnknownRecord; snapshot: MaterialAccessGrantSnapshot }> {
  if (event.eventType !== expectedType) {
    return invalid(`expected eventType ${expectedType}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== 1) {
    return invalid(`expected schemaVersion 1 for ${expectedType}, got ${String(event.schemaVersion)}`);
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) {
    return invalid(`${expectedType} envelope is incomplete`);
  }
  const body = parseObject(event.json);
  if (body === null) return invalid(`${expectedType} event is not a JSON object`);
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType
    || body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return invalid(`${expectedType} json does not match the stored event envelope`);
  }
  if (body['aggregateType'] !== 'MaterialAccessGrant') {
    return invalid(`${expectedType} aggregateType must be MaterialAccessGrant`);
  }
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId']) || !nonEmpty(body['aggregateId'])) {
    return invalid(`${expectedType} event scope is incomplete`);
  }
  if (body['aggregateRevision'] !== expectedRevision) {
    return invalid(`${expectedType} aggregateRevision must be ${String(expectedRevision)}`);
  }
  if (!trustedActor(body['actor'])) {
    return invalid(`${expectedType} actor must be a trusted human/system actor`);
  }
  if (!nonEmpty(body['idempotencyKey']) || !nonEmpty(body['fingerprint'])) {
    return invalid(`${expectedType} identity/fingerprint is required`);
  }
  const payload = body['payload'];
  if (!isRecord(payload) || !isRecord(payload['snapshot'])) {
    return invalid(`${expectedType} payload.snapshot is required`);
  }
  const snapshot = payload['snapshot'] as unknown as MaterialAccessGrantSnapshot;
  const record = encodedSnapshotRecord(snapshot);
  if (record === null) return invalid(`${expectedType} payload.snapshot is not canonical-JSON serializable`);
  const decodedSnapshot = decodeMaterialAccessGrantSnapshot(record);
  if (decodedSnapshot.status === 'invalid') {
    return invalid(`${expectedType} payload.snapshot is invalid: ${decodedSnapshot.reason}`);
  }
  const full = decodedSnapshot.value;
  if (full.revision !== expectedRevision) {
    return invalid(`${expectedType} snapshot revision must be ${String(expectedRevision)}`);
  }
  if (expectedRevision === 1 && full.revocation !== undefined) {
    return invalid('a MaterialAccessGranted snapshot must not already be revoked');
  }
  if (expectedRevision === 2 && full.revocation === undefined) {
    return invalid('a MaterialAccessRevoked snapshot must carry its revocation');
  }
  const ref = full.ref;
  if (ref.projectId !== body['projectId'] || ref.workspaceId !== body['workspaceId']
    || ref.grantId !== body['aggregateId']) {
    return invalid(`${expectedType} snapshot ref does not match the event scope`);
  }
  return { status: 'decoded', value: { body, snapshot: full } };
}

/** Decodes and cross-checks a MaterialAccessGranted event. */
export function decodeMaterialAccessGrantedEvent(
  event: EncodedDomainEvent,
): DecodeResult<MaterialAccessGrantedEvent> {
  const checked = validateGrantEvent(event, MATERIAL_ACCESS_GRANTED_EVENT, MATERIAL_ACCESS_GRANTED_SCHEMA_VERSION);
  if (checked.status !== 'decoded') return checked;
  return { status: 'decoded', value: checked.value.body as unknown as MaterialAccessGrantedEvent };
}

/** Decodes and cross-checks a MaterialAccessRevoked event. */
export function decodeMaterialAccessRevokedEvent(
  event: EncodedDomainEvent,
): DecodeResult<MaterialAccessRevokedEvent> {
  const checked = validateGrantEvent(event, MATERIAL_ACCESS_REVOKED_EVENT, 2);
  if (checked.status !== 'decoded') return checked;
  return { status: 'decoded', value: checked.value.body as unknown as MaterialAccessRevokedEvent };
}

// --------------------------------------------------------------------------
// Encoding
// --------------------------------------------------------------------------

function encodeEvent(event: { eventId: string; eventType: string; schemaVersion: number; occurredAt: string }): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

export function encodeMaterialAccessGrantedEvent(event: MaterialAccessGrantedEvent): EncodedDomainEvent {
  return encodeEvent(event);
}

export function encodeMaterialAccessRevokedEvent(event: MaterialAccessRevokedEvent): EncodedDomainEvent {
  return encodeEvent(event);
}

// --------------------------------------------------------------------------
// Registration
// --------------------------------------------------------------------------

function validateGrantedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = decodeMaterialAccessGrantedEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

function validateRevokedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = decodeMaterialAccessRevokedEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

/** Only new events are added here; original snapshot schema remains registered once. */
export const MATERIAL_GRANT_EVENT_SCHEMAS: readonly EncodedEventSchema[] = [
  { eventType: MATERIAL_ACCESS_GRANTED_EVENT, schemaVersion: MATERIAL_ACCESS_GRANTED_SCHEMA_VERSION, validate: validateGrantedEvent },
  { eventType: MATERIAL_ACCESS_REVOKED_EVENT, schemaVersion: MATERIAL_ACCESS_REVOKED_SCHEMA_VERSION, validate: validateRevokedEvent },
];
