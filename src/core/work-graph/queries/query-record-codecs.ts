/**
 * R5b.1 record/event codecs for the QueryJob submitted pair.
 *
 * Wire shape (frozen in the stage-1 skeleton):
 *   QueryJobSnapshot@1 records reuse the existing `QueryJobSnapshot` contract
 *   body; a QueryJobSubmitted@1 event keeps the legacy shape
 *   `{eventId, eventType, schemaVersion: 1, ... QueryJobSubmittedEvent}` with
 *   `payload.job` exactly the pending `QueryJobV1`.
 *
 * The formal submit writer also mirrors its writer-generated submission locator
 * (`identityKey`/`fingerprint`) at the TOP LEVEL of the submitted event. That
 * mirror is the same locator the Job snapshot stores, never a second
 * authorization, and it never changes `payload.job`. Historical snapshots and
 * events that predate the locator stay readable: the field is optional on the
 * record and the event decoder does not require the mirror.
 *
 * QueryRun keeps exactly ONE registration owner: the material `record-readers.ts`
 * owns `QueryRunSnapshot@1`. This file only performs the pure encode/decode the
 * query component needs, by reusing that owner's existing validator through the
 * narrow export; it never re-registers QueryRun.
 *
 * Boundaries deliberately enforced here: these callbacks only check persistent
 * encoding, identity and version. They never admit a business operation, never
 * judge "no Plan", focus eligibility, permission or Session occupancy, and never
 * re-normalize stored JSON.
 */
import type { QueryEntryTicket, QueryExecutionRecord } from './contracts.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { validQueryExecution } from '../../../contracts/query-job.js';
import type {
  QueryExecutionStateV1,
  QueryJobAnswerRef,
  QueryJobAnswerSnapshot,
  QueryJobAnswerV1,
  QueryJobIntentV1,
  QueryJobRef,
  QueryJobSnapshot,
  QueryJobSubmittedEvent,
  QueryRunRef,
  QueryRunSnapshot,
} from '../../../contracts/query-job.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  EncodedEventSchema,
  EncodedRecord,
  EncodedRecordSchema,
  RecordBackendSchemas,
} from '../../record-store/ports.js';
import { QUERY_RUN_RECORD_SCHEMA, validateQueryRunSnapshot } from '../materials/record-readers.js';

export const QUERY_JOB_SUBMITTED_EVENT = 'QueryJobSubmitted';
export const QUERY_JOB_EVENT_SCHEMA_VERSION = 1;
export const QUERY_JOB_SNAPSHOT_SCHEMA_ID = 'QueryJobSnapshot@1';
export const QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA_ID = 'QueryJobAnswerSnapshot@1';
export const QUERY_EXECUTION_EVENT = 'QueryExecutionRecorded';
export const QUERY_EXECUTION_EVENT_SCHEMA_VERSION = 1;
export const QUERY_JOB_ANSWERED_EVENT = 'QueryJobAnswered';
/** Persisted operation discriminants of one QueryRun's execution event. */
export const QUERY_EXECUTION_OPERATIONS = ['claimed', 'prepared', 'entering', 'entered', 'usage', 'admitted', 'observed'] as const;
export type QueryExecutionOperation = typeof QUERY_EXECUTION_OPERATIONS[number];

/**
 * The submitted-event envelope plus the writer-generated locator mirror. The
 * `payload.job` half is exactly the legacy `QueryJobSubmittedEvent`.
 */
export type QueryJobSubmittedEventV1 = QueryJobSubmittedEvent & {
  identityKey: string;
  fingerprint: string;
};

/** One persisted QueryRun execution/observation operation event. The payload
 * carries the SAME run's versioned state; `executionState` may be null only for
 * an operation that has no state projection. */
export type QueryExecutionRecordedEventV1 = {
  eventId: string;
  eventType: 'QueryExecutionRecorded';
  schemaVersion: 1;
  /** Exact accepted operation identity; replay restores its original result. */
  identityKey: string;
  fingerprint: string;
  projectId: string;
  workspaceId: string;
  aggregateType: 'QueryRun';
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    queryRunRef: QueryRunRef;
    operation: QueryExecutionOperation;
    /** Immutable original receipt value, never rebuilt from newer snapshots. */
    result: QueryExecutionRecord | QueryEntryTicket | QueryRunSnapshot;
    phase: QueryExecutionStateV1['phase'];
    executionState: QueryExecutionStateV1 | null;
  };
};

/** The terminal answered event carrying the formal answer snapshot. */
export type QueryJobAnsweredEventV1 = {
  eventId: string;
  eventType: 'QueryJobAnswered';
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: 'QueryJobAnswer';
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { answer: QueryJobAnswerSnapshot };
};

// --------------------------------------------------------------------------
// Small pure shape helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
}

function parseJsonObject(json: string, what: string): UnknownRecord | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return `${what} is not valid JSON`;
  }
  if (!isRecord(parsed)) return `${what} JSON must be an object`;
  return parsed;
}

function copyRecord(record: EncodedRecord): EncodedRecord {
  return { refKey: record.refKey, schemaId: record.schemaId, revision: record.revision, json: record.json };
}

function copyEvent(event: EncodedDomainEvent): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: event.json,
  };
}

// --------------------------------------------------------------------------
// Ref / intent shape helpers shared by the record and event validators
// --------------------------------------------------------------------------

function queryJobRefFromValue(value: unknown): QueryJobRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'QueryJob') return null;
  if (!isNonEmptyString(value['projectId']) || !isNonEmptyString(value['workspaceId']) ||
      !isNonEmptyString(value['queryJobId'])) return null;
  return {
    aggregateType: 'QueryJob',
    projectId: value['projectId'],
    workspaceId: value['workspaceId'],
    queryJobId: value['queryJobId'],
  };
}

function queryRunRefFromValue(value: unknown): QueryRunRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'QueryRun') return null;
  if (!isNonEmptyString(value['projectId']) || !isNonEmptyString(value['workspaceId']) ||
      !isNonEmptyString(value['queryJobId']) || !isNonEmptyString(value['runId'])) return null;
  return {
    aggregateType: 'QueryRun',
    projectId: value['projectId'],
    workspaceId: value['workspaceId'],
    queryJobId: value['queryJobId'],
    runId: value['runId'],
  };
}

function isTaskRef(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value['aggregateType'] === 'Task' &&
    isNonEmptyString(value['projectId']) &&
    isNonEmptyString(value['goalId']) &&
    isNonEmptyString(value['taskId']);
}

function isActorRef(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value['id'])) return false;
  const kind = value['kind'];
  if (kind === 'human' || kind === 'system') return true;
  if (kind !== 'agent') return false;
  const runRef = value['runRef'];
  return isRecord(runRef) && runRef['aggregateType'] === 'Run' &&
    isNonEmptyString(runRef['projectId']) && isNonEmptyString(runRef['goalId']) &&
    isNonEmptyString(runRef['runId']);
}

function isQueryJobStatus(value: unknown): boolean {
  return value === 'pending' || value === 'running' || value === 'answered' || value === 'closed';
}

/** Pure persistent shape of one `QueryJobIntentV1`; permission is not judged here. */
export function queryJobIntentIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['intent must be an object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('intent.schemaVersion must be 1');
  for (const field of ['intentId', 'projectId', 'workspaceId', 'correlationId'] as const) {
    if (!isNonEmptyString(value[field])) issues.push(`intent.${field} must be a non-empty string`);
  }
  if (value['goalId'] !== null && !isNonEmptyString(value['goalId'])) {
    issues.push('intent.goalId must be null or a non-empty string');
  }
  if (typeof value['question'] !== 'string') issues.push('intent.question must be a string');
  const focus = value['focusTaskRefs'];
  if (!Array.isArray(focus)) issues.push('intent.focusTaskRefs must be an array');
  else focus.forEach((ref, index) => {
    if (!isTaskRef(ref)) issues.push(`intent.focusTaskRefs[${index}] is not a complete TaskRef`);
  });
  const budget = value['budget'];
  if (!isRecord(budget)) issues.push('intent.budget must be an object');
  else {
    if (budget['maxTokens'] !== null && !isPositiveRevision(budget['maxTokens'])) issues.push('intent.budget.maxTokens must be null or a positive integer');
    if (budget['deadline'] !== null && typeof budget['deadline'] !== 'string') {
      issues.push('intent.budget.deadline must be null or a string');
    }
  }
  const multiTurn = value['multiTurn'];
  if (!isRecord(multiTurn) || !isPositiveRevision(multiTurn['maxRounds'])) {
    issues.push('intent.multiTurn.maxRounds must be a positive integer');
  }
  const execution = value['execution'];
  if (execution !== undefined) {
    if (!isRecord(execution)) issues.push('intent.execution must be an object when present');
    else if (!validQueryExecution(execution as QueryJobIntentV1['execution'])) {
      issues.push('intent.execution is not a valid QueryExecutionBinding shape');
    }
  }
  return issues;
}

function submissionIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['submission must be an object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('submission.schemaVersion must be 1');
  if (!isNonEmptyString(value['identityKey'])) issues.push('submission.identityKey must be a non-empty string');
  if (!isSha256Hex(value['fingerprint'])) issues.push('submission.fingerprint must be a lowercase sha256 hex');
  if (!isNonEmptyString(value['eventId'])) issues.push('submission.eventId must be a non-empty string');
  return issues;
}

function answerRefIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return ['job.answerRefs must be an array'];
  const issues: string[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry) || entry['aggregateType'] !== 'QueryJobAnswer' ||
        !isNonEmptyString(entry['projectId']) || !isNonEmptyString(entry['workspaceId']) ||
        !isNonEmptyString(entry['queryJobId']) || !isNonEmptyString(entry['answerId'])) {
      issues.push(`job.answerRefs[${index}] is not a complete QueryJobAnswerRef`);
    }
  });
  return issues;
}

function closeReasonIssues(value: unknown): string[] {
  if (value === null) return [];
  if (!isRecord(value)) return ['job.closeReason must be null or an object'];
  const issues: string[] = [];
  if (!['timeout', 'gap', 'failed', 'stale_source', 'cancelled'].includes(value['code'] as string)) {
    issues.push('job.closeReason.code is not a legal close code');
  }
  if (typeof value['message'] !== 'string') issues.push('job.closeReason.message must be a string');
  return issues;
}

/** QueryJobAnswerRef shape helper shared by the record and event validators. */
function queryJobAnswerRefFromValue(value: unknown): QueryJobAnswerRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'QueryJobAnswer') return null;
  if (!isNonEmptyString(value['projectId']) || !isNonEmptyString(value['workspaceId']) ||
      !isNonEmptyString(value['queryJobId']) || !isNonEmptyString(value['answerId'])) return null;
  return {
    aggregateType: 'QueryJobAnswer',
    projectId: value['projectId'],
    workspaceId: value['workspaceId'],
    queryJobId: value['queryJobId'],
    answerId: value['answerId'],
  };
}

/** Pure persistent shape of one QueryJobAnswerV1; permission/currentness is not
 * judged here. The bodyRef must be a real artifact reference. */
function answerIssues(value: unknown, expectedRef: QueryJobAnswerRef | null): string[] {
  if (!isRecord(value)) return ['answer must be an object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('answer.schemaVersion must be 1');
  if (!isNonEmptyString(value['answerId'])) issues.push('answer.answerId must be a non-empty string');
  const jobRef = queryJobRefFromValue(value['queryJobRef']);
  if (jobRef === null) issues.push('answer.queryJobRef is not a complete QueryJobRef');
  const runRef = queryRunRefFromValue(value['runRef']);
  if (runRef === null) issues.push('answer.runRef is not a complete QueryRunRef');
  if (expectedRef !== null) {
    if (value['answerId'] !== expectedRef.answerId) issues.push('answer.answerId disagrees with the record ref');
    if (jobRef !== null && (jobRef.projectId !== expectedRef.projectId || jobRef.workspaceId !== expectedRef.workspaceId
        || jobRef.queryJobId !== expectedRef.queryJobId)) {
      issues.push('answer.queryJobRef disagrees with the record ref scope');
    }
  }
  if (!Number.isSafeInteger(value['roundIndex']) || (value['roundIndex'] as number) < 0) {
    issues.push('answer.roundIndex must be a non-negative safe integer');
  }
  if (typeof value['answer'] !== 'string') issues.push('answer.answer must be a string');
  else if (Buffer.byteLength(value['answer'] as string, 'utf8') > 16 * 1024) issues.push('answer.answer exceeds 16 KiB');
  const sources = value['sources'];
  if (!Array.isArray(sources)) issues.push('answer.sources must be an array');
  else if (sources.length > 64) issues.push('answer.sources exceeds 64 witnesses');
  else sources.forEach((source, index) => {
    if (!isRecord(source) || !isNonEmptyString(source['kind']) || !isNonEmptyString(source['refKey']) ||
        !(source['version'] === null || typeof source['version'] === 'string') ||
        !(source['label'] === null || typeof source['label'] === 'string')) {
      issues.push(`answer.sources[${index}] is not a complete source witness`);
    }
  });
  if (value['followsAnswerRef'] !== null && queryJobAnswerRefFromValue(value['followsAnswerRef']) === null) {
    issues.push('answer.followsAnswerRef must be null or a complete QueryJobAnswerRef');
  }
  if (typeof value['stale'] !== 'boolean') issues.push('answer.stale must be a boolean');
  if (!(value['staleReason'] === null || typeof value['staleReason'] === 'string')) {
    issues.push('answer.staleReason must be null or a string');
  }
  if (!isNonEmptyString(value['answeredAt'])) issues.push('answer.answeredAt must be a non-empty string');
  const bodyRef = value['bodyRef'];
  if (!isRecord(bodyRef) || bodyRef['kind'] !== 'artifact' || !isNonEmptyString(bodyRef['contentType']) ||
      !isSha256Hex(bodyRef['digest']) || !isPositiveRevision(bodyRef['sizeBytes']) || !isRecord(bodyRef['source'])) {
    issues.push('answer.bodyRef is not a complete ArtifactRef');
  }
  return issues;
}

/** Versioned execution-state projection shape; used by the operation event. */
function executionStateIssues(value: unknown): string[] {
  if (value === null) return [];
  if (!isRecord(value)) return ['executionState must be null or an object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('executionState.schemaVersion must be 1');
  if (!['claimed', 'prepared', 'entering', 'entered', 'unknown', 'settled'].includes(value['phase'] as string)) {
    issues.push('executionState.phase is not a legal phase');
  }
  if (!isRecord(value['sessionRef'])) issues.push('executionState.sessionRef must be an object');
  if (!Number.isSafeInteger(value['sessionGeneration']) || (value['sessionGeneration'] as number) < 1) {
    issues.push('executionState.sessionGeneration must be a positive integer');
  }
  if (!Array.isArray(value['requests'])) issues.push('executionState.requests must be an array');
  return issues;
}

function envelopeIssues(parsed: UnknownRecord, event: EncodedDomainEvent, label: string): string[] {
  const issues: string[] = [];
  if (parsed['eventId'] !== event.eventId) issues.push(`${label} outer eventId disagrees with the event JSON`);
  if (parsed['eventType'] !== event.eventType) issues.push(`${label} outer eventType disagrees with the event JSON`);
  if (parsed['schemaVersion'] !== event.schemaVersion) issues.push(`${label} outer schemaVersion disagrees with the event JSON`);
  if (parsed['occurredAt'] !== event.occurredAt) issues.push(`${label} outer occurredAt disagrees with the event JSON`);
  if (!isNonEmptyString(parsed['projectId'])) issues.push(`${label} projectId must be a non-empty string`);
  if (!isNonEmptyString(parsed['workspaceId'])) issues.push(`${label} workspaceId must be a non-empty string`);
  if (!isNonEmptyString(parsed['aggregateId'])) issues.push(`${label} aggregateId must be a non-empty string`);
  if (!isNonEmptyString(parsed['causationId'])) issues.push(`${label} causationId must be a non-empty string`);
  if (!isNonEmptyString(parsed['correlationId'])) issues.push(`${label} correlationId must be a non-empty string`);
  if (!isNonEmptyString(parsed['idempotencyKey'])) issues.push(`${label} idempotencyKey must be a non-empty string`);
  if (!isActorRef(parsed['actor'])) issues.push(`${label} actor is not a valid ActorRef`);
  if (!isPositiveRevision(parsed['aggregateRevision'])) issues.push(`${label} aggregateRevision must be a positive integer`);
  return issues;
}

/** Pure persistent shape of one `QueryJobV1`, including its exact ref agreement. */
function jobIssues(value: unknown, expectedRef: QueryJobRef | null): string[] {
  if (!isRecord(value)) return ['job must be an object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('job.schemaVersion must be 1');
  if (!isNonEmptyString(value['queryJobId'])) issues.push('job.queryJobId must be a non-empty string');
  if (!isNonEmptyString(value['projectId'])) issues.push('job.projectId must be a non-empty string');
  if (!isNonEmptyString(value['workspaceId'])) issues.push('job.workspaceId must be a non-empty string');
  if (value['goalId'] !== null && !isNonEmptyString(value['goalId'])) {
    issues.push('job.goalId must be null or a non-empty string');
  }
  if (expectedRef !== null) {
    if (value['queryJobId'] !== expectedRef.queryJobId) issues.push('job.queryJobId disagrees with the record ref');
    if (value['projectId'] !== expectedRef.projectId) issues.push('job.projectId disagrees with the record ref');
    if (value['workspaceId'] !== expectedRef.workspaceId) issues.push('job.workspaceId disagrees with the record ref');
  }
  issues.push(...queryJobIntentIssues(value['intent']));
  if (!isQueryJobStatus(value['status'])) issues.push('job.status is not a QueryJobStatus');
  const runRef = value['runRef'];
  if (runRef !== null) {
    const parsed = queryRunRefFromValue(runRef);
    if (parsed === null) issues.push('job.runRef is not a complete QueryRunRef');
    else if (isNonEmptyString(value['projectId']) && isNonEmptyString(value['workspaceId']) &&
        isNonEmptyString(value['queryJobId']) &&
        (parsed.projectId !== value['projectId'] || parsed.workspaceId !== value['workspaceId'] ||
         parsed.queryJobId !== value['queryJobId'])) {
      issues.push('job.runRef does not belong to this QueryJob');
    }
  }
  issues.push(...answerRefIssues(value['answerRefs']));
  issues.push(...closeReasonIssues(value['closeReason']));
  if (!isNonEmptyString(value['submittedAt'])) issues.push('job.submittedAt must be a non-empty string');
  if (!isNonEmptyString(value['updatedAt'])) issues.push('job.updatedAt must be a non-empty string');
  return issues;
}

// --------------------------------------------------------------------------
// Record validator / decoders
// --------------------------------------------------------------------------

function validateQueryJobSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== QUERY_JOB_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${QUERY_JOB_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json, 'QueryJob snapshot');
  if (typeof parsed === 'string') return invalid(parsed);
  const ref = queryJobRefFromValue(parsed['ref']);
  if (ref === null) return invalid('QueryJob snapshot has no complete QueryJobRef');
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) {
    return invalid('QueryJob snapshot ref is not the outer canonical ref_key');
  }
  if (!isPositiveRevision(parsed['revision'])) {
    return invalid('QueryJob snapshot revision must be a safe integer >= 1');
  }
  if (parsed['revision'] !== record.revision) {
    return invalid('QueryJob snapshot outer revision disagrees with the JSON revision');
  }
  if (parsed['schemaVersion'] !== 1) return invalid('QueryJob snapshot schemaVersion must be 1');
  const jobProblems = jobIssues(parsed['job'], ref);
  if (jobProblems.length > 0) return invalid(`QueryJob snapshot job is invalid: ${jobProblems.join('; ')}`);
  if (parsed['submission'] !== undefined) {
    const problems = submissionIssues(parsed['submission']);
    if (problems.length > 0) return invalid(`QueryJob snapshot submission is invalid: ${problems.join('; ')}`);
  }
  return { status: 'decoded', value: copyRecord(record) };
}

/** Pure QueryJob record encoding; writes nothing and registers nothing. */
export function encodeQueryJobSnapshot(snapshot: QueryJobSnapshot): EncodedRecord {
  return {
    refKey: canonicalJson(snapshot.ref as unknown as JsonValue),
    schemaId: QUERY_JOB_SNAPSHOT_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

/** Pure QueryJob record decoding; a historical snapshot without a locator stays readable. */
export function decodeQueryJobSnapshot(record: EncodedRecord): DecodeResult<QueryJobSnapshot> {
  const checked = validateQueryJobSnapshot(record);
  if (checked.status !== 'decoded') return checked;
  try {
    return { status: 'decoded', value: JSON.parse(record.json) as QueryJobSnapshot };
  } catch {
    return invalid('QueryJob snapshot JSON is not parseable');
  }
}

// --------------------------------------------------------------------------
// Event validator / decoders
// --------------------------------------------------------------------------

function validateQueryJobSubmittedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== QUERY_JOB_SUBMITTED_EVENT) {
    return invalid(`expected eventType ${QUERY_JOB_SUBMITTED_EVENT}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== QUERY_JOB_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${QUERY_JOB_EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!isNonEmptyString(event.eventId)) return invalid('eventId must be a non-empty string');
  if (!isNonEmptyString(event.occurredAt)) return invalid('occurredAt must be a non-empty string');
  const parsed = parseJsonObject(event.json, 'QueryJobSubmitted event');
  if (typeof parsed === 'string') return invalid(parsed);
  if (parsed['eventId'] !== event.eventId) return invalid('outer eventId disagrees with the event JSON');
  if (parsed['eventType'] !== event.eventType) return invalid('outer eventType disagrees with the event JSON');
  if (parsed['schemaVersion'] !== event.schemaVersion) return invalid('outer schemaVersion disagrees with the event JSON');
  if (parsed['occurredAt'] !== event.occurredAt) return invalid('outer occurredAt disagrees with the event JSON');
  if (!isNonEmptyString(parsed['projectId'])) return invalid('QueryJobSubmitted projectId must be a non-empty string');
  if (!isNonEmptyString(parsed['workspaceId'])) return invalid('QueryJobSubmitted workspaceId must be a non-empty string');
  if (parsed['aggregateType'] !== 'QueryJob') return invalid('QueryJobSubmitted aggregateType must be "QueryJob"');
  if (!isNonEmptyString(parsed['aggregateId'])) return invalid('QueryJobSubmitted aggregateId must be a non-empty string');
  if (parsed['aggregateRevision'] !== 1) return invalid('QueryJobSubmitted aggregateRevision must be 1');
  if (!isNonEmptyString(parsed['causationId'])) return invalid('QueryJobSubmitted causationId must be a non-empty string');
  if (!isNonEmptyString(parsed['correlationId'])) return invalid('QueryJobSubmitted correlationId must be a non-empty string');
  if (!isNonEmptyString(parsed['idempotencyKey'])) return invalid('QueryJobSubmitted idempotencyKey must be a non-empty string');
  if (!isActorRef(parsed['actor'])) return invalid('QueryJobSubmitted actor is not a valid ActorRef');
  if (!isNonEmptyString(parsed['identityKey'])) return invalid('QueryJobSubmitted identityKey must be a non-empty string');
  if (!isSha256Hex(parsed['fingerprint'])) return invalid('QueryJobSubmitted fingerprint must be a lowercase sha256 hex');
  const payload = parsed['payload'];
  if (!isRecord(payload)) return invalid('QueryJobSubmitted payload must be an object');
  const ref = isNonEmptyString(parsed['projectId']) && isNonEmptyString(parsed['workspaceId']) &&
    isNonEmptyString(parsed['aggregateId'])
    ? { aggregateType: 'QueryJob' as const, projectId: parsed['projectId'], workspaceId: parsed['workspaceId'],
        queryJobId: parsed['aggregateId'] }
    : null;
  const jobProblems = jobIssues(payload['job'], ref);
  if (jobProblems.length > 0) return invalid(`QueryJobSubmitted payload.job is invalid: ${jobProblems.join('; ')}`);
  return { status: 'decoded', value: copyEvent(event) };
}

/** Encodes the submitted event with its writer-generated locator mirror. */
export function encodeQueryJobSubmittedEvent(event: QueryJobSubmittedEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

/** Decodes a stored submitted event; the locator mirror is optional for old rows. */
export function decodeQueryJobSubmittedEvent(event: EncodedDomainEvent): DecodeResult<QueryJobSubmittedEventV1> {
  const checked = validateQueryJobSubmittedEvent(event);
  if (checked.status !== 'decoded') return checked;
  try {
    return { status: 'decoded', value: JSON.parse(event.json) as QueryJobSubmittedEventV1 };
  } catch {
    return invalid('QueryJobSubmitted event JSON is not parseable');
  }
}

// --------------------------------------------------------------------------
// QueryJobAnswer record + Query execution/answered operation events
// --------------------------------------------------------------------------

/** Pure QueryJobAnswer record encoding; writes nothing and registers nothing. */
export function encodeQueryJobAnswerSnapshot(snapshot: QueryJobAnswerSnapshot): EncodedRecord {
  return {
    refKey: canonicalJson(snapshot.ref as unknown as JsonValue),
    schemaId: QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

function validateQueryJobAnswerSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json, 'QueryJobAnswer snapshot');
  if (typeof parsed === 'string') return invalid(parsed);
  const ref = queryJobAnswerRefFromValue(parsed['ref']);
  if (ref === null) return invalid('QueryJobAnswer snapshot has no complete QueryJobAnswerRef');
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) {
    return invalid('QueryJobAnswer snapshot ref is not the outer canonical ref_key');
  }
  if (record.revision !== 1 || parsed['revision'] !== 1) {
    return invalid('QueryJobAnswer snapshot revision must be 1');
  }
  if (parsed['schemaVersion'] !== 1) return invalid('QueryJobAnswer snapshot schemaVersion must be 1');
  const problems = answerIssues(parsed['answer'], ref);
  if (problems.length > 0) return invalid(`QueryJobAnswer snapshot answer is invalid: ${problems.join('; ')}`);
  return { status: 'decoded', value: copyRecord(record) };
}

/** Pure QueryJobAnswer record decoding. */
export function decodeQueryJobAnswerSnapshot(record: EncodedRecord): DecodeResult<QueryJobAnswerSnapshot> {
  const checked = validateQueryJobAnswerSnapshot(record);
  if (checked.status !== 'decoded') return checked;
  try {
    return { status: 'decoded', value: JSON.parse(record.json) as QueryJobAnswerSnapshot };
  } catch {
    return invalid('QueryJobAnswer snapshot JSON is not parseable');
  }
}

/** Encodes one operation event whose local discriminant is an approved operation
 * and whose payload carries the same QueryRun's persisted execution state. */
export function encodeQueryExecutionRecordedEvent(event: QueryExecutionRecordedEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

function validateQueryExecutionRecordedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== QUERY_EXECUTION_EVENT) {
    return invalid(`expected eventType ${QUERY_EXECUTION_EVENT}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== QUERY_EXECUTION_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${QUERY_EXECUTION_EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!isNonEmptyString(event.eventId)) return invalid('eventId must be a non-empty string');
  if (!isNonEmptyString(event.occurredAt)) return invalid('occurredAt must be a non-empty string');
  const parsed = parseJsonObject(event.json, 'QueryExecutionRecorded event');
  if (typeof parsed === 'string') return invalid(parsed);
  const issues = envelopeIssues(parsed, event, 'QueryExecutionRecorded');
  if (!isNonEmptyString(parsed['identityKey']) || !isSha256Hex(parsed['fingerprint'])) {
    issues.push('QueryExecutionRecorded must carry the exact operation identity and fingerprint');
  }
  if (parsed['aggregateType'] !== 'QueryRun') issues.push('QueryExecutionRecorded aggregateType must be "QueryRun"');
  const payload = parsed['payload'];
  if (!isRecord(payload)) issues.push('QueryExecutionRecorded payload must be an object');
  else {
    if (queryRunRefFromValue(payload['queryRunRef']) === null) {
      issues.push('QueryExecutionRecorded payload.queryRunRef is not a complete QueryRunRef');
    }
    if (!QUERY_EXECUTION_OPERATIONS.includes(payload['operation'] as QueryExecutionOperation)) {
      issues.push('QueryExecutionRecorded payload.operation is not a legal operation');
    }
    if (!isRecord(payload['result'])) issues.push('QueryExecutionRecorded payload.result must preserve the original receipt value');
    issues.push(...executionStateIssues(payload['executionState']));
  }
  if (issues.length > 0) return invalid(`QueryExecutionRecorded event is invalid: ${issues.join('; ')}`);
  return { status: 'decoded', value: copyEvent(event) };
}

/** Decodes one stored operation event; a historical row is never re-normalized. */
export function decodeQueryExecutionRecordedEvent(event: EncodedDomainEvent): DecodeResult<QueryExecutionRecordedEventV1> {
  const checked = validateQueryExecutionRecordedEvent(event);
  if (checked.status !== 'decoded') return checked;
  try {
    return { status: 'decoded', value: JSON.parse(event.json) as QueryExecutionRecordedEventV1 };
  } catch {
    return invalid('QueryExecutionRecorded event JSON is not parseable');
  }
}

/** Encodes the terminal answered event carrying the formal answer snapshot. */
export function encodeQueryJobAnsweredEvent(event: QueryJobAnsweredEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

function validateQueryJobAnsweredEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== QUERY_JOB_ANSWERED_EVENT) {
    return invalid(`expected eventType ${QUERY_JOB_ANSWERED_EVENT}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== QUERY_JOB_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${QUERY_JOB_EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!isNonEmptyString(event.eventId)) return invalid('eventId must be a non-empty string');
  if (!isNonEmptyString(event.occurredAt)) return invalid('occurredAt must be a non-empty string');
  const parsed = parseJsonObject(event.json, 'QueryJobAnswered event');
  if (typeof parsed === 'string') return invalid(parsed);
  const issues = envelopeIssues(parsed, event, 'QueryJobAnswered');
  if (parsed['aggregateType'] !== 'QueryJobAnswer') issues.push('QueryJobAnswered aggregateType must be "QueryJobAnswer"');
  const payload = parsed['payload'];
  if (!isRecord(payload)) issues.push('QueryJobAnswered payload must be an object');
  else {
    const snapshot = payload['answer'];
    if (!isRecord(snapshot)) issues.push('QueryJobAnswered payload.answer must be an object');
    else {
      const answerRef = queryJobAnswerRefFromValue(snapshot['ref']);
      if (answerRef === null) issues.push('QueryJobAnswered payload.answer.ref is not a complete QueryJobAnswerRef');
      if (snapshot['revision'] !== 1 || snapshot['schemaVersion'] !== 1) {
        issues.push('QueryJobAnswered payload.answer revision/schemaVersion must be 1');
      }
      issues.push(...answerIssues(snapshot['answer'], answerRef));
    }
  }
  if (issues.length > 0) return invalid(`QueryJobAnswered event is invalid: ${issues.join('; ')}`);
  return { status: 'decoded', value: copyEvent(event) };
}

/** Decodes one stored answered event. */
export function decodeQueryJobAnsweredEvent(event: EncodedDomainEvent): DecodeResult<QueryJobAnsweredEventV1> {
  const checked = validateQueryJobAnsweredEvent(event);
  if (checked.status !== 'decoded') return checked;
  try {
    return { status: 'decoded', value: JSON.parse(event.json) as QueryJobAnsweredEventV1 };
  } catch {
    return invalid('QueryJobAnswered event JSON is not parseable');
  }
}

// --------------------------------------------------------------------------
// QueryRun: pure encode/decode reusing the ONE material owner's validator
// --------------------------------------------------------------------------

/** Pure QueryRun record encoding; writes nothing and registers nothing. */
export function encodeQueryRunSnapshotRecord(snapshot: QueryRunSnapshot): EncodedRecord {
  return {
    refKey: canonicalJson(snapshot.ref as unknown as JsonValue),
    schemaId: QUERY_RUN_RECORD_SCHEMA.schemaId,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

/** Pure QueryRun record decoding that reuses the material owner's validator. */
export function decodeQueryRunSnapshotRecord(record: EncodedRecord): DecodeResult<QueryRunSnapshot> {
  const validated = validateQueryRunSnapshot(record);
  if (validated.status !== 'decoded') return validated;
  try {
    return { status: 'decoded', value: JSON.parse(record.json) as QueryRunSnapshot };
  } catch {
    return invalid('QueryRun snapshot JSON is not parseable');
  }
}

/**
 * Only the NEW QueryJob record and its submitted event are registered here.
 * QueryRun stays registered by `materialRecordSchemas()` in the composition root.
 */
const QUERY_JOB_SNAPSHOT_SCHEMA: EncodedRecordSchema = {
  schemaId: QUERY_JOB_SNAPSHOT_SCHEMA_ID,
  aggregateType: 'QueryJob',
  validate: validateQueryJobSnapshot,
};
const QUERY_JOB_SUBMITTED_SCHEMA: EncodedEventSchema = {
  eventType: QUERY_JOB_SUBMITTED_EVENT,
  schemaVersion: QUERY_JOB_EVENT_SCHEMA_VERSION,
  validate: validateQueryJobSubmittedEvent,
};
const QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA: EncodedRecordSchema = {
  schemaId: QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA_ID,
  aggregateType: 'QueryJobAnswer',
  validate: validateQueryJobAnswerSnapshot,
};
const QUERY_EXECUTION_RECORDED_SCHEMA: EncodedEventSchema = {
  eventType: QUERY_EXECUTION_EVENT,
  schemaVersion: QUERY_EXECUTION_EVENT_SCHEMA_VERSION,
  validate: validateQueryExecutionRecordedEvent,
};
const QUERY_JOB_ANSWERED_SCHEMA: EncodedEventSchema = {
  eventType: QUERY_JOB_ANSWERED_EVENT,
  schemaVersion: QUERY_JOB_EVENT_SCHEMA_VERSION,
  validate: validateQueryJobAnsweredEvent,
};

export const QUERY_JOB_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [QUERY_JOB_SNAPSHOT_SCHEMA, QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA],
  events: [QUERY_JOB_SUBMITTED_SCHEMA, QUERY_EXECUTION_RECORDED_SCHEMA, QUERY_JOB_ANSWERED_SCHEMA],
  lookups: [],
};
