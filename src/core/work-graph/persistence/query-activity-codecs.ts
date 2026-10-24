/**
 * L16: the ONE owner of the `QueryActivity@1` record and its
 * `QueryActivityRecorded` replay event. It performs no I/O: the Query terminal
 * commit, the reconcile closing commits and the Query backfill write this
 * record through it.
 *
 * The record is not Query state; a Query that never entered the Kernel writes
 * none. The facts, span and ref rules are the Work `RunActivity` rules, so they
 * are imported from `run-activity-codecs.ts`, and the SessionRefs use the one
 * `sessionRefProblem` (`rework-codecs.ts`), rather than restated here.
 */
import type { QueryActivityRef, QueryActivitySnapshot } from '../../../contracts/run-activity.js';
import { canonicalJson, canonicalOf, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  hasOnlyKeys, invalid, isPos as isPositiveSafeInteger, isRecord as isObject, nonEmpty, parseObject,
  type UnknownRecord,
} from '../../../contracts/validation/common.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import { encodeEventEnvelope } from './event-envelope.js';
import { eventBodyEnvelopeProblem, eventEnvelopeProblem } from './event-validation.js';
import { sessionRefProblem } from './rework-codecs.js';
import { activityRecordRefProblem, runActivityFactsProblem, runActivitySpanProblem } from './run-activity-codecs.js';

export const QUERY_ACTIVITY_SCHEMA_ID = 'QueryActivity@1' as const;
export const QUERY_ACTIVITY_RECORDED_EVENT_TYPE = 'QueryActivityRecorded' as const;
export const QUERY_ACTIVITY_EVENT_SCHEMA_VERSION = 1 as const;

/** Event header shared with the other WorkGraph replay events (spec §2.9). */
export type QueryActivityEventHeaderV1 = {
  eventId: string; schemaVersion: 1; occurredAt: string;
  projectId: string; workspaceId: string;
};

/** The `QueryActivityRecorded` replay event carries the record it wrote. */
export type QueryActivityRecordedEventV1 = QueryActivityEventHeaderV1 & {
  eventType: 'QueryActivityRecorded'; queryActivity: QueryActivitySnapshot;
};

// --------------------------------------------------------------------------
// Record body and encode/decode (pure; no Store access)
// --------------------------------------------------------------------------

const QUERY_ACTIVITY_BODY_KEYS: readonly string[] = [
  'ref', 'revision', 'schemaVersion', 'queryRunRef', 'sessionRef', 'askedSessionRef', 'goalId',
  'queryEndedAt', 'recordedAt', 'recordedBy', 'facts', 'span',
];

function queryActivityBodyProblem(body: UnknownRecord): string | null {
  if (!hasOnlyKeys(body, QUERY_ACTIVITY_BODY_KEYS)) return 'QueryActivity record carries unknown fields';
  const ref = activityRecordRefProblem(body['ref'], 'QueryActivity',
    ['projectId', 'workspaceId', 'queryJobId', 'runId'], 'QueryActivity ref');
  if (ref !== null) return ref;
  if (!isPositiveSafeInteger(body['revision'])) return 'QueryActivity revision must be a positive safe integer';
  if (body['schemaVersion'] !== 1) return 'QueryActivity schemaVersion must be 1';
  const runRef = activityRecordRefProblem(body['queryRunRef'], 'QueryRun',
    ['projectId', 'workspaceId', 'queryJobId', 'runId'], 'QueryActivity queryRunRef');
  if (runRef !== null) return runRef;
  const refValue = body['ref'] as UnknownRecord;
  const runValue = body['queryRunRef'] as UnknownRecord;
  for (const field of ['projectId', 'workspaceId', 'queryJobId', 'runId'] as const) {
    if (refValue[field] !== runValue[field]) return 'QueryActivity ref disagrees with its queryRunRef';
  }
  for (const field of ['sessionRef', 'askedSessionRef'] as const) {
    if (body[field] === null) continue;
    const session = sessionRefProblem(body[field], field);
    if (session !== null) return session;
    if ((body[field] as UnknownRecord)['projectId'] !== refValue['projectId']) {
      return `QueryActivity ${field} belongs to another project`;
    }
  }
  if (!(body['goalId'] === null || nonEmpty(body['goalId']))) return 'QueryActivity goalId must be null or a non-empty string';
  if (!nonEmpty(body['queryEndedAt'])) return 'QueryActivity queryEndedAt is required';
  if (body['recordedBy'] !== 'query_end' && body['recordedBy'] !== 'backfill') {
    return 'QueryActivity recordedBy is not recognized';
  }
  if (!nonEmpty(body['recordedAt'])) return 'QueryActivity recordedAt is required';
  const facts = runActivityFactsProblem(body['facts']);
  if (facts !== null) return facts;
  return runActivitySpanProblem(body['span']);
}

/** Canonical record key of one QueryActivity aggregate. */
export function queryActivityRefKey(ref: QueryActivityRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

export function encodeQueryActivitySnapshot(snapshot: QueryActivitySnapshot): EncodedRecord {
  return {
    refKey: queryActivityRefKey(snapshot.ref),
    schemaId: QUERY_ACTIVITY_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

export function decodeQueryActivitySnapshot(record: EncodedRecord): DecodeResult<QueryActivitySnapshot> {
  if (record.schemaId !== QUERY_ACTIVITY_SCHEMA_ID) {
    return invalid(`expected schemaId ${QUERY_ACTIVITY_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const body = parseObject(record.json);
  if (body === null) return invalid('QueryActivity record json is not an object');
  if (!isObject(body['ref']) || !isPositiveSafeInteger(body['revision']) || body['revision'] !== record.revision) {
    return invalid('QueryActivity record envelope is invalid');
  }
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) {
    return invalid('QueryActivity refKey disagrees with the record body');
  }
  const problem = queryActivityBodyProblem(body);
  if (problem !== null) return invalid(`QueryActivity record payload is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as QueryActivitySnapshot };
}

// --------------------------------------------------------------------------
// Replay event
// --------------------------------------------------------------------------

export function encodeQueryActivityRecordedEvent(event: QueryActivityRecordedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

export function queryActivityRecordedEventFromEvent(event: EncodedDomainEvent): DecodeResult<QueryActivityRecordedEventV1> {
  const body = parseObject(event.json);
  if (body === null) return invalid('QueryActivityRecorded event json is not an object');
  const envelope = eventEnvelopeProblem(event, QUERY_ACTIVITY_RECORDED_EVENT_TYPE, QUERY_ACTIVITY_EVENT_SCHEMA_VERSION);
  if (envelope !== null) return invalid(envelope);
  const bodyEnvelope = eventBodyEnvelopeProblem(body, event, QUERY_ACTIVITY_RECORDED_EVENT_TYPE);
  if (bodyEnvelope !== null) return invalid(bodyEnvelope);
  if (!hasOnlyKeys(body, [
    'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'queryActivity',
  ])) {
    return invalid('QueryActivityRecorded carries unknown fields');
  }
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId'])) {
    return invalid('QueryActivityRecorded requires projectId and workspaceId');
  }
  const activity = body['queryActivity'];
  if (!isObject(activity)) return invalid('QueryActivityRecorded requires the recorded QueryActivity');
  const problem = queryActivityBodyProblem(activity);
  if (problem !== null) return invalid(`QueryActivityRecorded queryActivity is invalid: ${problem}`);
  const ref = activity['ref'] as UnknownRecord;
  if (ref['projectId'] !== body['projectId'] || ref['workspaceId'] !== body['workspaceId']) {
    return invalid('QueryActivityRecorded queryActivity scope disagrees with the event');
  }
  return { status: 'decoded', value: body as unknown as QueryActivityRecordedEventV1 };
}

// --------------------------------------------------------------------------
// The single registration group
// --------------------------------------------------------------------------

export const QUERY_ACTIVITY_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    {
      schemaId: QUERY_ACTIVITY_SCHEMA_ID,
      aggregateType: 'QueryActivity',
      validate: (record) => {
        const decoded = decodeQueryActivitySnapshot(record);
        return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
      },
    },
  ],
  events: [
    {
      eventType: QUERY_ACTIVITY_RECORDED_EVENT_TYPE,
      schemaVersion: QUERY_ACTIVITY_EVENT_SCHEMA_VERSION,
      validate: (event) => {
        const decoded = queryActivityRecordedEventFromEvent(event);
        return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
      },
    },
  ],
};
