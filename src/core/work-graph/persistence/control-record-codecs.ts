/**
 * R4.1 control-record codecs (implementation).
 *
 * This is the ONE owner of:
 *  - the immutable `ControlIntentSnapshot@1` record and its pure validator;
 *  - the `ControlIntentSubmitted@1` replay event and its pure validator, so a
 *    lost commit acknowledgement restores the original receipt from the real
 *    Store instead of re-deriving it from current rows;
 *  - the pure `runControlStateProblem` seam reused by the Run record reader;
 *  - the control records/events registered in `CONTROL_RECORD_SCHEMAS`.
 *
 * `runControlStateProblem` is only a shape check: a historical Run without
 * `controlState` stays readable and a legal `running`/`steered` pointer is not
 * reported damaged. It does not admit or fence execution; the one fresh-action
 * barrier lives in `tasks/execution-entry-service.ts`.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { ControlIntentSnapshotV1, ControlObservationV1, SubmittedControl } from '../../../contracts/control-intent.js';
import type { RunExecutionHistoryV1 } from '../../../contracts/core/execution-history.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import { isRunExecutionHistoryV1 } from './execution-history-codecs.js';

// -------------------------------------------------------------------------- //
// Schema names                                                               //
// -------------------------------------------------------------------------- //

export const CONTROL_INTENT_SNAPSHOT_SCHEMA_ID = 'ControlIntentSnapshot@1' as const;
export const CONTROL_INTENT_SUBMITTED_EVENT_TYPE = 'ControlIntentSubmitted' as const;
export const CONTROL_INTENT_EVENT_SCHEMA_VERSION = 1 as const;

/** The persisted replay event for one accepted control request. */
export type ControlIntentSubmittedEvent = {
  eventId: string;
  eventType: typeof CONTROL_INTENT_SUBMITTED_EVENT_TYPE;
  schemaVersion: typeof CONTROL_INTENT_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  fingerprint: string;
  submitted: SubmittedControl;
};

/**
 * R4.3a stage-1 seam name/type for the observation replay event.
 *
 * Declaring this compatible name is NOT the same as implementing its validator:
 * `CONTROL_RECORD_SCHEMAS` deliberately does not register it yet, no encode or
 * decode function accepts it, and the already-implemented queued snapshot/event
 * codecs above stay exactly as they are. The implementation step adds the
 * closed validator over `ControlObservationV1` and the observation read branch.
 */
export const CONTROL_INTENT_OBSERVED_EVENT_TYPE = 'ControlIntentObserved' as const;
export const CONTROL_INTENT_OBSERVED_EVENT_SCHEMA_VERSION = 1 as const;
/** The replay event recorded for one real control observation. */
export type ControlIntentObservedEvent = {
  eventId: string;
  eventType: typeof CONTROL_INTENT_OBSERVED_EVENT_TYPE;
  schemaVersion: typeof CONTROL_INTENT_OBSERVED_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  fingerprint: string;
  /** The exact observed snapshot returned by the observation write. */
  result: ControlIntentSnapshotV1;
};

// -------------------------------------------------------------------------- //
// Run controlState seam (implemented; reused by materials/record-readers.ts)  //
// -------------------------------------------------------------------------- //

type UnknownRecord = Record<string, unknown>;

function isJsonObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Pure shape check for the optional `Run.controlState`.
 *
 * `undefined` means a historical Run with no control intent and is always
 * readable. A present value must be a complete, scope-aligned four-state
 * pointer. This is the ONE validator: the Run reader must not clone it.
 */
export function runControlStateProblem(
  value: unknown,
  runProjectId: string,
  runWorkspaceId: string,
): string | null {
  if (value === undefined) return null;
  if (!isJsonObject(value)) return 'Run controlState must be an object';
  const keys = Object.keys(value);
  if (keys.some(key => key !== 'intentRef' && key !== 'desiredState')) {
    return 'Run controlState carries unknown fields';
  }
  const intentRef = value['intentRef'];
  if (!isJsonObject(intentRef) || intentRef['aggregateType'] !== 'ControlIntent'
    || !nonEmpty(intentRef['projectId']) || !nonEmpty(intentRef['workspaceId']) || !nonEmpty(intentRef['intentId'])) {
    return 'Run controlState intentRef must be a complete ControlIntentRef';
  }
  const desiredState = value['desiredState'];
  if (desiredState !== 'running' && desiredState !== 'paused' && desiredState !== 'cancelled' && desiredState !== 'steered') {
    return 'Run controlState desiredState is not a recognized state';
  }
  if (intentRef['projectId'] !== runProjectId) {
    return 'Run controlState intentRef belongs to another project';
  }
  if (intentRef['workspaceId'] !== runWorkspaceId) {
    return 'Run controlState intentRef belongs to another workspace';
  }
  return null;
}

// -------------------------------------------------------------------------- //
// Snapshot / event codecs                                                    //
// -------------------------------------------------------------------------- //

/** The reason ceiling is enforced on the exact UTF-8 bytes, never truncated. */
const MAX_CONTROL_REASON_BYTES = 2048;

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
function invalid<T>(reason: string): DecodeResult<T> {
  return { status: 'invalid', reason };
}
function parseObject(json: string): UnknownRecord | null {
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

function controlIntentRefProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'ControlIntentSnapshot ref must be an object';
  if (!hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'intentId'])) {
    return 'ControlIntentRef carries unknown fields';
  }
  if (value['aggregateType'] !== 'ControlIntent' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['intentId'])) {
    return 'ControlIntentSnapshot requires a complete ControlIntentRef';
  }
  return null;
}
function runRefProblem(value: unknown): string | null {
  if (!isJsonObject(value) || value['aggregateType'] !== 'Run'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'ControlIntentSnapshot runRef must be a complete RunRef';
  }
  return null;
}
function actorProblem(value: unknown): string | null {
  if (!isJsonObject(value) || (value['kind'] !== 'human' && value['kind'] !== 'system') || !nonEmpty(value['id'])) {
    return 'ControlIntentSnapshot requestedBy must be a trusted human/system actor';
  }
  return null;
}
function reasonProblem(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    return 'ControlIntentSnapshot reason must be null or a non-empty string';
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_CONTROL_REASON_BYTES) {
    return 'ControlIntentSnapshot reason exceeds 2048 UTF-8 bytes';
  }
  return null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Pure closed-shape check for one trusted Runtime `ControlObservationV1`. It
 * validates the observation's own history/source window; the owning Run, entry
 * and intent identities are cross-checked against the real records by the ONE
 * control service.
 */
export function controlObservationProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'ControlObservation must be an object';
  if (!hasOnlyKeys(value, ['schemaVersion', 'kind', 'entry', 'history', 'source',
    'kernelEventId', 'kernelEventSequence', 'observedAt'])) {
    return 'ControlObservation carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'ControlObservation schemaVersion must be 1';
  const kind = value['kind'];
  if (kind !== 'resumed' && kind !== 'steered' && kind !== 'paused' && kind !== 'cancelled' && kind !== 'terminal_without_cancel' && kind !== 'outcome_unknown') {
    return 'ControlObservation kind is not recognized';
  }
  const entry = value['entry'];
  if (!isJsonObject(entry) || !hasOnlyKeys(entry, ['consumerId', 'entryGeneration', 'sessionGeneration'])) {
    return 'ControlObservation entry identity is incomplete';
  }
  if (!nonEmpty(entry['consumerId'])) return 'ControlObservation entry consumerId is required';
  if (!isNonNegativeSafeInteger(entry['entryGeneration'])) return 'ControlObservation entryGeneration must be a non-negative safe integer';
  if (!isNonNegativeSafeInteger(entry['sessionGeneration'])) return 'ControlObservation sessionGeneration must be a non-negative safe integer';
  const history = value['history'];
  if (!isRunExecutionHistoryV1(history)) return 'ControlObservation history must be a complete RunExecutionHistoryV1';
  const source = value['source'];
  if (!isJsonObject(source) || !hasOnlyKeys(source, ['adapterId', 'kernelSessionId', 'runId', 'turnId', 'position'])) {
    return 'ControlObservation source must be the fixed Kernel identity with a position';
  }
  if (!nonEmpty(source['adapterId']) || !nonEmpty(source['kernelSessionId'])
    || !nonEmpty(source['runId']) || !nonEmpty(source['turnId'])) {
    return 'ControlObservation source Kernel identity is incomplete';
  }
  if (!isPositiveSafeInteger(source['position'])) return 'ControlObservation source position must be a positive safe integer';
  const located = history as RunExecutionHistoryV1;
  if (source['adapterId'] !== located.kernel.adapterId || source['kernelSessionId'] !== located.kernel.kernelSessionId
    || source['runId'] !== located.kernel.runId || source['turnId'] !== located.kernel.turnId) {
    return 'ControlObservation source disagrees with the observation history';
  }
  const position = source['position'] as number;
  if (position < located.startPosition || position > located.observedThroughPosition) {
    return 'ControlObservation source position is outside the observed history window';
  }
  if (!nonEmpty(value['kernelEventId'])) return 'ControlObservation kernelEventId is required';
  if (!isNonNegativeSafeInteger(value['kernelEventSequence'])) {
    return 'ControlObservation kernelEventSequence must be a non-negative safe integer';
  }
  if (typeof value['observedAt'] !== 'string' || !nonEmpty(value['observedAt'])
    || !Number.isFinite(Date.parse(value['observedAt']))) {
    return 'ControlObservation observedAt must be a legal instant';
  }
  return null;
}

const SNAPSHOT_ALL_KEYS: readonly string[] = ['schemaVersion', 'ref', 'revision', 'runRef', 'kind',
  'desiredState', 'reason', 'requestedAt', 'requestedBy', 'status', 'observation'];

function controlIntentSnapshotProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'ControlIntentSnapshot must be an object';
  if (!hasOnlyKeys(value, SNAPSHOT_ALL_KEYS)) {
    return 'ControlIntentSnapshot carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'ControlIntentSnapshot schemaVersion must be 1';
  const refProblem = controlIntentRefProblem(value['ref']);
  if (refProblem !== null) return refProblem;
  const runProblem = runRefProblem(value['runRef']);
  if (runProblem !== null) return runProblem;
  if ((value['ref'] as UnknownRecord)['projectId'] !== (value['runRef'] as UnknownRecord)['projectId']) {
    return 'ControlIntentSnapshot runRef is outside the intent project';
  }
  if (value['kind'] !== 'pause' && value['kind'] !== 'cancel'
    && value['kind'] !== 'resume' && value['kind'] !== 'steer') {
    return 'ControlIntentSnapshot kind is not recognized';
  }
  if (value['kind'] === 'resume' && value['desiredState'] !== 'running') {
    return 'a resume intent must request the running state';
  }
  if (value['kind'] === 'steer' && value['desiredState'] !== 'steered') {
    return 'a steer intent must request the steered state';
  }
  if (value['kind'] === 'pause' && value['desiredState'] !== 'paused') {
    return 'ControlIntentSnapshot pause must desire paused';
  }
  if (value['kind'] === 'cancel' && value['desiredState'] !== 'cancelled') {
    return 'ControlIntentSnapshot cancel must desire cancelled';
  }
  const reason = reasonProblem(value['reason']);
  if (reason !== null) return reason;
  if (typeof value['requestedAt'] !== 'string' || !nonEmpty(value['requestedAt'])
    || !Number.isFinite(Date.parse(value['requestedAt']))) {
    return 'ControlIntentSnapshot requestedAt must be a legal instant';
  }
  const actor = actorProblem(value['requestedBy']);
  if (actor !== null) return actor;
  const status = value['status'];
  if (status === 'queued') {
    if (Object.prototype.hasOwnProperty.call(value, 'observation')) {
      return 'a queued ControlIntentSnapshot must not carry an observation';
    }
    if (value['revision'] !== 1) return 'ControlIntentSnapshot revision must be 1 while queued';
    return null;
  }
  if (status !== 'applied' && status !== 'superseded' && status !== 'outcome_unknown') {
    return 'ControlIntentSnapshot status must be queued, applied, superseded or outcome_unknown';
  }
  if (!isPositiveSafeInteger(value['revision']) || value['revision'] < 2) {
    return 'an observed ControlIntentSnapshot revision must be at least 2';
  }
  const observationProblem = controlObservationProblem(value['observation']);
  if (observationProblem !== null) return observationProblem;
  const observationKind = (value['observation'] as UnknownRecord)['kind'];
  if (observationKind === 'paused') {
    if (value['kind'] !== 'pause') return 'a paused observation must belong to a pause intent';
  } else if (observationKind === 'resumed') {
    if (value['kind'] !== 'resume') return 'resumed must belong to resume';
  } else if (observationKind === 'steered') {
    if (value['kind'] !== 'steer') return 'steered must belong to steer';
  } else if (value['kind'] !== 'cancel') {
    return 'a cancelled/unknown observation must belong to a cancel intent';
  }
  return null;
}

function controlIntentSnapshotRecordProblem(record: EncodedRecord): string | null {
  if (record.schemaId !== CONTROL_INTENT_SNAPSHOT_SCHEMA_ID) {
    return `expected schemaId ${CONTROL_INTENT_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`;
  }
  const body = parseObject(record.json);
  if (body === null) return 'ControlIntentSnapshot is not a JSON object';
  const problem = controlIntentSnapshotProblem(body);
  if (problem !== null) return problem;
  if (canonicalOf(body['ref'] as object) !== record.refKey) {
    return 'ControlIntent ref is not the outer canonical ref_key';
  }
  if (!isPositiveSafeInteger(record.revision)) return 'ControlIntentSnapshot record revision must be a positive safe integer';
  if (body['revision'] !== record.revision) {
    return 'ControlIntentSnapshot revision disagrees with the encoded record';
  }
  return null;
}

/** Encode a control-intent snapshot into its immutable RecordStore record. */
export function encodeControlIntentSnapshot(snapshot: ControlIntentSnapshotV1): EncodedRecord {
  const refKey = canonicalOf(snapshot.ref);
  if (refKey === null) throw new Error('ControlIntent ref is not canonical JSON');
  return { refKey, schemaId: CONTROL_INTENT_SNAPSHOT_SCHEMA_ID,
    revision: snapshot.revision, json: JSON.stringify(snapshot) };
}

/** Decode and validate one `ControlIntentSnapshot@1` record. */
export function decodeControlIntentSnapshot(record: EncodedRecord): DecodeResult<ControlIntentSnapshotV1> {
  const problem = controlIntentSnapshotRecordProblem(record);
  if (problem !== null) return invalid(problem);
  return { status: 'decoded', value: parseObject(record.json) as unknown as ControlIntentSnapshotV1 };
}

/** Encode the `ControlIntentSubmitted` replay event. */
export function encodeControlIntentSubmittedEvent(event: ControlIntentSubmittedEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

/** Decode and validate one `ControlIntentSubmitted` replay event. */
export function controlIntentSubmittedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<ControlIntentSubmittedEvent> {
  if (!isJsonObject(event)) return invalid('control-intent event must be an object');
  if (event['eventType'] !== CONTROL_INTENT_SUBMITTED_EVENT_TYPE) {
    return invalid(`unexpected control-intent eventType ${String(event['eventType'])}`);
  }
  if (event['schemaVersion'] !== CONTROL_INTENT_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${String(CONTROL_INTENT_EVENT_SCHEMA_VERSION)}, got ${String(event['schemaVersion'])}`);
  }
  if (!nonEmpty(event['eventId']) || !nonEmpty(event['occurredAt'])) {
    return invalid('control-intent event envelope is incomplete');
  }
  if (typeof event['json'] !== 'string') return invalid('control-intent event json must be a string');
  const body = parseObject(event['json']);
  if (body === null) return invalid('control-intent event is not a JSON object');
  if (body['eventId'] !== event['eventId']) return invalid('control-intent json does not match the envelope eventId');
  if (body['eventType'] !== event['eventType']) return invalid('control-intent json does not match the envelope eventType');
  if (body['schemaVersion'] !== event['schemaVersion']) return invalid('control-intent json does not match the envelope schemaVersion');
  if (body['occurredAt'] !== event['occurredAt']) return invalid('control-intent json does not match the envelope occurredAt');
  if (!nonEmpty(body['identityKey'])) return invalid('control-intent identityKey is required');
  if (!nonEmpty(body['fingerprint'])) return invalid('control-intent fingerprint is required');
  const actor = actorProblem(body['actor']);
  if (actor !== null) return invalid(actor);
  const submitted = body['submitted'];
  if (!isJsonObject(submitted) || !hasOnlyKeys(submitted, ['intent', 'runRevision'])) {
    return invalid('control-intent submitted receipt is incomplete');
  }
  const intentProblem = controlIntentSnapshotProblem(submitted['intent']);
  if (intentProblem !== null) return invalid(intentProblem);
  const submittedIntent = submitted['intent'] as UnknownRecord;
  if (submittedIntent['status'] !== 'queued' || submittedIntent['revision'] !== 1) {
    return invalid('the submitted control intent must be the original queued@1 snapshot');
  }
  if (!isPositiveSafeInteger(submitted['runRevision'])) {
    return invalid('control-intent runRevision must be a positive safe integer');
  }
  const requestedBy = (submitted['intent'] as UnknownRecord)['requestedBy'] as UnknownRecord;
  const eventActor = body['actor'] as UnknownRecord;
  if (requestedBy['kind'] !== eventActor['kind'] || requestedBy['id'] !== eventActor['id']) {
    return invalid('control-intent requestedBy disagrees with the event actor');
  }
  return { status: 'decoded', value: body as unknown as ControlIntentSubmittedEvent };
}

/** Encode the `ControlIntentObserved` replay event. */
export function encodeControlIntentObservedEvent(event: ControlIntentObservedEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

/**
 * Decode and validate one `ControlIntentObserved` replay event. The observed
 * result must be a real non-queued snapshot (`revision >= 2`); the observation
 * itself is validated by the shared `controlObservationProblem`.
 */
export function controlIntentObservedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<ControlIntentObservedEvent> {
  if (!isJsonObject(event)) return invalid('control-intent observed event must be an object');
  if (event['eventType'] !== CONTROL_INTENT_OBSERVED_EVENT_TYPE) {
    return invalid(`unexpected control-intent observed eventType ${String(event['eventType'])}`);
  }
  if (event['schemaVersion'] !== CONTROL_INTENT_OBSERVED_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${String(CONTROL_INTENT_OBSERVED_EVENT_SCHEMA_VERSION)}, got ${String(event['schemaVersion'])}`);
  }
  if (!nonEmpty(event['eventId']) || !nonEmpty(event['occurredAt'])) {
    return invalid('control-intent observed event envelope is incomplete');
  }
  if (typeof event['json'] !== 'string') return invalid('control-intent observed event json must be a string');
  const body = parseObject(event['json']);
  if (body === null) return invalid('control-intent observed event is not a JSON object');
  if (body['eventId'] !== event['eventId']) return invalid('control-intent observed json does not match the envelope eventId');
  if (body['eventType'] !== event['eventType']) return invalid('control-intent observed json does not match the envelope eventType');
  if (body['schemaVersion'] !== event['schemaVersion']) return invalid('control-intent observed json does not match the envelope schemaVersion');
  if (body['occurredAt'] !== event['occurredAt']) return invalid('control-intent observed json does not match the envelope occurredAt');
  if (!nonEmpty(body['identityKey'])) return invalid('control-intent observed identityKey is required');
  if (!nonEmpty(body['fingerprint'])) return invalid('control-intent observed fingerprint is required');
  const actor = actorProblem(body['actor']);
  if (actor !== null) return invalid(actor);
  const result = body['result'];
  const resultProblem = controlIntentSnapshotProblem(result);
  if (resultProblem !== null) return invalid(resultProblem);
  const resultRecord = result as UnknownRecord;
  if (resultRecord['status'] === 'queued' || resultRecord['revision'] === 1) {
    return invalid('the observed control intent must not be the queued@1 snapshot');
  }
  // `event.actor` is the trusted writer that actually recorded the observation;
  // `result.requestedBy` is the original submit actor. Two legitimate Hosts may
  // differ, so the Observed branch never forces them equal. The actor's own
  // validity (above) and the identity/fingerprint replay checks still hold; the
  // Submitted branch keeps its original requester equality.
  return { status: 'decoded', value: body as unknown as ControlIntentObservedEvent };
}

function validateControlIntentRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  const problem = controlIntentSnapshotRecordProblem(record);
  return problem !== null ? invalid(problem) : { status: 'decoded', value: record };
}
function validateControlIntentEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = controlIntentSubmittedEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}
function validateControlIntentObservedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = controlIntentObservedEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

/**
 * The ONE control schema registration. The Run `controlState` inside
 * `RunSnapshot@1` stays owned and registered by `materials/record-readers.ts`;
 * this file never re-registers the Run schema.
 */
export const CONTROL_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    { schemaId: CONTROL_INTENT_SNAPSHOT_SCHEMA_ID, aggregateType: 'ControlIntent', validate: validateControlIntentRecord },
  ],
  events: [
    { eventType: CONTROL_INTENT_SUBMITTED_EVENT_TYPE, schemaVersion: CONTROL_INTENT_EVENT_SCHEMA_VERSION,
      validate: validateControlIntentEvent },
    { eventType: CONTROL_INTENT_OBSERVED_EVENT_TYPE, schemaVersion: CONTROL_INTENT_OBSERVED_EVENT_SCHEMA_VERSION,
      validate: validateControlIntentObservedEvent },
  ],
  lookups: [],
};
