/**
 * B2 model-request permit codec (implementation).
 *
 * Owns the existing call-evidence aggregate encoding: one immutable
 * `ModelRequestPermitSnapshot@1` record per stable permit id, written at
 * revision 1 on issuance and CAS-updated to revision 2 on exactly one
 * consumption. It also owns the two replay events (`ModelRequestAuthorized`
 * and `ModelRequestEvidenceRecorded`) so a lost receipt can be restored from
 * the real Store instead of re-deriving the permit from current rows.
 *
 * A historical permit may lack the request pins; such a permit is readable but
 * can never authorize a fresh actual call. No provider ack field is invented:
 * the evidence aggregate records the platform-observed attempt, not a
 * provider receipt.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { ModelRequestPermitRef } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { ModelRequestPermitV1, ModelRequestPermitSnapshot } from '../tasks/model-call-contracts.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  EncodedRecord,
  RecordBackendSchemas,
} from '../../record-store/ports.js';

export const MODEL_REQUEST_PERMIT_SCHEMA_ID = 'ModelRequestPermitSnapshot@1';
export const MODEL_REQUEST_AUTHORIZED_EVENT_TYPE = 'ModelRequestAuthorized';
export const MODEL_REQUEST_EVIDENCE_EVENT_TYPE = 'ModelRequestEvidenceRecorded';
export const MODEL_REQUEST_EVENT_SCHEMA_VERSION = 1 as const;

type EventActor = Extract<ActorRef, { kind: 'human' | 'system' }>;

export type ModelRequestRecordedEvent = {
  eventId: string;
  eventType: typeof MODEL_REQUEST_AUTHORIZED_EVENT_TYPE | typeof MODEL_REQUEST_EVIDENCE_EVENT_TYPE;
  schemaVersion: typeof MODEL_REQUEST_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  actor: EventActor;
  fingerprint: string;
  permitRef: ModelRequestPermitRef;
  permit: ModelRequestPermitV1;
  runRevision: number;
};

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
function invalid<T>(reason: string): DecodeResult<T> {
  return { status: 'invalid', reason };
}
function parseObject(json: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function canonicalOf(value: object): string | null {
  try { return canonicalJson(value as unknown as JsonValue); } catch { return null; }
}

function runRefProblem(value: unknown): string | null {
  if (!isJsonObject(value) || value['aggregateType'] !== 'Run'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'permit runRef must be a complete RunRef';
  }
  return null;
}
function permissionsProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'permit permissions must be an object';
  if (!hasOnlyKeys(value, ['policyRevision', 'tools', 'writeScope'])) return 'permit permissions carries unknown fields';
  if (!nonEmpty(value['policyRevision'])) return 'permit permissions policyRevision is required';
  if (!Array.isArray(value['tools']) || !value['tools'].every(nonEmpty)) return 'permit permissions tools must be strings';
  if (!Array.isArray(value['writeScope']) || !value['writeScope'].every(nonEmpty)) return 'permit permissions writeScope must be strings';
  return null;
}
function deliveryPinProblem(value: unknown): string | null {
  if (!isJsonObject(value) || value['aggregateType'] !== 'Delivery'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) || !nonEmpty(value['deliveryId'])) {
    return 'permit deliveryRefs entries must be complete ModelRequestMaterialPinV1 values';
  }
  return null;
}

export function modelRequestPermitProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'ModelRequestPermit must be an object';
  if (!hasOnlyKeys(value, ['schemaVersion', 'permitId', 'runRef', 'requestId', 'requestDigest',
    'contextInputDigest', 'manifestDigest', 'deliveryRefs', 'permissions', 'consumedByAttemptId',
    'issuedAt', 'consumedAt'])) {
    return 'ModelRequestPermit carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'ModelRequestPermit schemaVersion must be 1';
  if (!nonEmpty(value['permitId'])) return 'ModelRequestPermit permitId is required';
  const runProblem = runRefProblem(value['runRef']);
  if (runProblem !== null) return runProblem;
  if (value['requestId'] !== undefined && !nonEmpty(value['requestId'])) return 'ModelRequestPermit requestId must be a non-empty string';
  if (value['requestDigest'] !== undefined && !isSha256Hex(value['requestDigest'])) return 'ModelRequestPermit requestDigest must be a sha256 hex';
  if (value['contextInputDigest'] !== undefined && !isSha256Hex(value['contextInputDigest'])) return 'ModelRequestPermit contextInputDigest must be a sha256 hex';
  if (value['manifestDigest'] !== undefined && !isSha256Hex(value['manifestDigest'])) return 'ModelRequestPermit manifestDigest must be a sha256 hex';
  if (!Array.isArray(value['deliveryRefs'])) return 'ModelRequestPermit deliveryRefs must be an array';
  for (const pin of value['deliveryRefs']) {
    const problem = deliveryPinProblem(pin);
    if (problem !== null) return problem;
  }
  const permissions = permissionsProblem(value['permissions']);
  if (permissions !== null) return permissions;
  if (!(value['consumedByAttemptId'] === null || nonEmpty(value['consumedByAttemptId']))) {
    return 'ModelRequestPermit consumedByAttemptId must be null or a non-empty string';
  }
  if (!nonEmpty(value['issuedAt'])) return 'ModelRequestPermit issuedAt is required';
  if (!(value['consumedAt'] === null || nonEmpty(value['consumedAt']))) {
    return 'ModelRequestPermit consumedAt must be null or a non-empty string';
  }
  if ((value['consumedByAttemptId'] === null) !== (value['consumedAt'] === null)) {
    return 'ModelRequestPermit consumption fields must be both null or both set';
  }
  return null;
}

function snapshotProblem(record: EncodedRecord): string | null {
  if (record.schemaId !== MODEL_REQUEST_PERMIT_SCHEMA_ID) {
    return `expected schemaId ${MODEL_REQUEST_PERMIT_SCHEMA_ID}, got ${record.schemaId}`;
  }
  const body = parseObject(record.json);
  if (body === null) return 'ModelRequestPermit snapshot is not a JSON object';
  if (!hasOnlyKeys(body, ['ref', 'revision', 'schemaVersion', 'permit', 'recordedAt'])) return 'ModelRequestPermit snapshot carries unknown fields';
  const ref = body['ref'];
  if (!isJsonObject(ref) || ref['aggregateType'] !== 'ModelRequestPermit'
    || !nonEmpty(ref['projectId']) || !nonEmpty(ref['workspaceId']) || !nonEmpty(ref['permitId'])) {
    return 'ModelRequestPermit snapshot has no complete ModelRequestPermitRef';
  }
  if (canonicalOf(ref) !== record.refKey) return 'ModelRequestPermit ref is not the outer canonical ref_key';
  if (!isPositiveSafeInteger(body['revision']) || body['revision'] !== record.revision) {
    return 'ModelRequestPermit outer revision disagrees with the JSON revision';
  }
  if (record.revision !== 1 && record.revision !== 2) return 'ModelRequestPermit revision must be 1 or 2';
  if (body['schemaVersion'] !== 1) return 'ModelRequestPermit snapshot schemaVersion must be 1';
  if (!nonEmpty(body['recordedAt'])) return 'ModelRequestPermit snapshot recordedAt is required';
  const permitProblem = modelRequestPermitProblem(body['permit']);
  if (permitProblem !== null) return permitProblem;
  const permit = body['permit'] as Record<string, unknown>;
  const permitRef = permit['runRef'] as Record<string, unknown>;
  if (permit['permitId'] !== ref['permitId']) return 'ModelRequestPermit permitId disagrees with its ref';
  if (permitRef['projectId'] !== ref['projectId']) return 'ModelRequestPermit runRef project disagrees with its ref';
  const consumed = permit['consumedByAttemptId'] !== null;
  if (record.revision === 1 && consumed) return 'ModelRequestPermit revision 1 must be unconsumed';
  if (record.revision === 2 && !consumed) return 'ModelRequestPermit revision 2 must be consumed';
  return null;
}

export function encodeModelRequestPermitSnapshot(snapshot: ModelRequestPermitSnapshot): EncodedRecord {
  const refKey = canonicalOf(snapshot.ref);
  if (refKey === null) throw new Error('ModelRequestPermit ref is not canonical JSON');
  return { refKey, schemaId: MODEL_REQUEST_PERMIT_SCHEMA_ID,
    revision: snapshot.revision, json: JSON.stringify(snapshot) };
}

export function decodeModelRequestPermitSnapshot(record: EncodedRecord): DecodeResult<ModelRequestPermitSnapshot> {
  const problem = snapshotProblem(record);
  if (problem !== null) return invalid(problem);
  const body = parseObject(record.json) as Record<string, unknown>;
  return { status: 'decoded', value: body as unknown as ModelRequestPermitSnapshot };
}

function validateModelRequestPermitRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  const problem = snapshotProblem(record);
  return problem !== null ? invalid(problem) : { status: 'decoded', value: record };
}

// --------------------------------------------------------------------------
// Replay events
// --------------------------------------------------------------------------

export function encodeModelRequestRecordedEvent(event: ModelRequestRecordedEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

export function modelRequestRecordedEventFromEvent(event: EncodedDomainEvent): DecodeResult<ModelRequestRecordedEvent> {
  if (!isJsonObject(event)) return invalid('model-request event must be an object');
  if (event['eventType'] !== MODEL_REQUEST_AUTHORIZED_EVENT_TYPE && event['eventType'] !== MODEL_REQUEST_EVIDENCE_EVENT_TYPE) {
    return invalid(`unexpected model-request eventType ${String(event['eventType'])}`);
  }
  if (event['schemaVersion'] !== MODEL_REQUEST_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${String(MODEL_REQUEST_EVENT_SCHEMA_VERSION)}, got ${String(event['schemaVersion'])}`);
  }
  if (!nonEmpty(event['eventId']) || !nonEmpty(event['occurredAt'])) return invalid('model-request event envelope is incomplete');
  if (typeof event['json'] !== 'string') return invalid('model-request event json must be a string');
  const body = parseObject(event['json']);
  if (body === null) return invalid('model-request event is not a JSON object');
  if (body['eventId'] !== event['eventId']) return invalid('model-request json does not match the envelope eventId');
  if (body['eventType'] !== event['eventType']) return invalid('model-request json does not match the envelope eventType');
  if (body['schemaVersion'] !== event['schemaVersion']) return invalid('model-request json does not match the envelope schemaVersion');
  if (body['occurredAt'] !== event['occurredAt']) return invalid('model-request json does not match the envelope occurredAt');
  if (!nonEmpty(body['identityKey'])) return invalid('model-request identityKey is required');
  if (!nonEmpty(body['fingerprint'])) return invalid('model-request fingerprint is required');
  const actor = body['actor'];
  if (!isJsonObject(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return invalid('model-request actor must be a trusted human/system actor');
  }
  const permitRef = body['permitRef'];
  if (!isJsonObject(permitRef) || permitRef['aggregateType'] !== 'ModelRequestPermit'
    || !nonEmpty(permitRef['projectId']) || !nonEmpty(permitRef['workspaceId']) || !nonEmpty(permitRef['permitId'])) {
    return invalid('model-request permitRef is incomplete');
  }
  const permitProblem = modelRequestPermitProblem(body['permit']);
  if (permitProblem !== null) return invalid(permitProblem);
  const permit = body['permit'] as Record<string, unknown>;
  if (permit['permitId'] !== permitRef['permitId']) return invalid('model-request permitId disagrees with its ref');
  if (!isPositiveSafeInteger(body['runRevision'])) return invalid('model-request runRevision must be a positive safe integer');
  return { status: 'decoded', value: body as unknown as ModelRequestRecordedEvent };
}

function validateModelRequestEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = modelRequestRecordedEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

export const MODEL_REQUEST_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    { schemaId: MODEL_REQUEST_PERMIT_SCHEMA_ID, aggregateType: 'ModelRequestPermit', validate: validateModelRequestPermitRecord },
  ],
  events: [
    { eventType: MODEL_REQUEST_AUTHORIZED_EVENT_TYPE, schemaVersion: MODEL_REQUEST_EVENT_SCHEMA_VERSION, validate: validateModelRequestEvent },
    { eventType: MODEL_REQUEST_EVIDENCE_EVENT_TYPE, schemaVersion: MODEL_REQUEST_EVENT_SCHEMA_VERSION, validate: validateModelRequestEvent },
  ],
  lookups: [],
};
