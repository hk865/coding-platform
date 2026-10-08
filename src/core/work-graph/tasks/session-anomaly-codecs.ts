/**
 * Slice 1 (spec §2.6, §2.9): the only new formal aggregate `SessionAnomalyAnchor`
 * and its `SessionAnomalyRecorded` replay event.
 *
 * This file owns the record/event registration and the two anchor indexes. It
 * performs no I/O; the immutable record is written only through the `state/`
 * constructor. The `Slice1EventHeaderV1` shape is copied from the Session
 * lifecycle codec, never imported from `sessions/` (spec §2.9).
 */
import type { SessionAnomalyAnchorRef, SessionAnomalyAnchorV1 } from '../../../contracts/session-anomaly.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import { checkRole } from '../sessions/session-record-codecs.js';
import {
  SESSION_ANOMALY_BY_GOAL_LOOKUP, SESSION_ANOMALY_BY_TASK_LOOKUP,
} from '../model/session-facts-contracts.js';

/** Encoding selector for the immutable anchor record. */
export const SESSION_ANOMALY_SCHEMA_ID = 'SessionAnomalyAnchor@1';
export const SESSION_ANOMALY_RECORDED_EVENT_TYPE = 'SessionAnomalyRecorded';
export const SESSION_ANOMALY_EVENT_SCHEMA_VERSION = 1;

export type Slice1EventHeaderV1 = {
  eventId: string; schemaVersion: 1; occurredAt: string;
  projectId: string; workspaceId: string;
};

export type SessionAnomalyRecordedEventV1 = Slice1EventHeaderV1 & {
  eventType: 'SessionAnomalyRecorded'; anchor: SessionAnomalyAnchorV1;
};

// --------------------------------------------------------------------------
// Pure shape helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isRevisionOne(value: unknown): value is number {
  return value === 1;
}
function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function parseObject(json: string): UnknownRecord | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}
function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
}

function anomalyRefProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])) {
    return `${label} must be a complete SessionAnomalyAnchorRef`;
  }
  if (value['aggregateType'] !== 'SessionAnomalyAnchor'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return `${label} is not a valid SessionAnomalyAnchorRef`;
  }
  return null;
}
function plainRefProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['projectId', 'sessionId'])
    || !nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return `${label} must be a complete SessionRef`;
  }
  return null;
}
function runRefProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || value['aggregateType'] !== 'Run'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'runRef must be a complete RunRef';
  }
  return null;
}
function taskTripleProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['projectId', 'goalId', 'taskId'])
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])) {
    return 'task must be a complete TaskTriple';
  }
  return null;
}
function planRefProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'planId'])
    || value['aggregateType'] !== 'PlanRevision'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['planId'])) {
    return 'planRef must be a complete PlanRevisionRef';
  }
  return null;
}
function attemptRefProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'taskId', 'attemptId'])
    || value['aggregateType'] !== 'TaskAttempt'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])
    || !nonEmpty(value['attemptId'])) {
    return 'attemptRef must be a complete TaskAttemptRef';
  }
  return null;
}
function receiptProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['identityKey', 'fingerprint'])
    || !nonEmpty(value['identityKey']) || !nonEmpty(value['fingerprint'])) {
    return 'archiveRequestReceipt must be {identityKey,fingerprint}';
  }
  return null;
}
function archivedByProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['kind', 'id'])
    || (value['kind'] !== 'human' && value['kind'] !== 'system') || !nonEmpty(value['id'])) {
    return 'archivedBy must be a trusted human/system actor';
  }
  return null;
}
/** §2.6: confirmed + possible are at most 64 paths; the reason is at most 2000 characters. */
const ARCHIVE_PATHS_LIMIT = 64;
const ARCHIVE_REASON_LIMIT = 2000;

/** §2.6: a stored path is a non-empty, workspace-relative string using forward slashes. */
function pathProblem(entry: unknown, label: string): string | null {
  if (!nonEmpty(entry)) return `${label} entries must be non-empty strings`;
  const path = entry as string;
  if (path.includes('\\')) return `${label} paths must use forward slashes`;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return `${label} paths must be workspace-relative`;
  if (path.split('/').includes('..')) return `${label} paths must not escape the workspace with ".."`;
  return null;
}
function pathListProblem(value: unknown, label: string): string | null {
  if (!Array.isArray(value)) return `${label} must be an array`;
  let previous: string | null = null;
  for (const entry of value) {
    const problem = pathProblem(entry, label);
    if (problem !== null) return problem;
    const path = entry as string;
    if (previous !== null && path <= previous) return `${label} must be distinct and in stable lexicographic order`;
    previous = path;
  }
  return null;
}
function changedFilesProblem(value: unknown): string | null {
  if (!isObject(value)) return 'changedFiles must be an object';
  if (!hasOnlyKeys(value, ['source', 'status', 'confirmed', 'possible', 'omitted', 'baseCommit',
    'runBaselineKnown', 'reason'])) {
    return 'changedFiles carries unknown fields';
  }
  if (value['source'] !== 'kernel' && value['source'] !== 'worktree' && value['source'] !== 'unknown') {
    return 'changedFiles.source is not recognized';
  }
  if (value['status'] !== 'known' && value['status'] !== 'partial'
    && value['status'] !== 'not_entered' && value['status'] !== 'unavailable') {
    return 'changedFiles.status is not recognized';
  }
  const confirmed = pathListProblem(value['confirmed'], 'changedFiles.confirmed');
  if (confirmed !== null) return confirmed;
  const possible = pathListProblem(value['possible'], 'changedFiles.possible');
  if (possible !== null) return possible;
  const confirmedPaths = value['confirmed'] as unknown[];
  const possiblePaths = value['possible'] as unknown[];
  if (confirmedPaths.length + possiblePaths.length > ARCHIVE_PATHS_LIMIT) {
    return `changedFiles carries more than ${String(ARCHIVE_PATHS_LIMIT)} paths`;
  }
  const confirmedSet = new Set(confirmedPaths);
  if (possiblePaths.some((path) => confirmedSet.has(path))) {
    return 'changedFiles.confirmed and changedFiles.possible must be distinct';
  }
  if (!Number.isSafeInteger(value['omitted']) || (value['omitted'] as number) < 0) {
    return 'changedFiles.omitted must be a non-negative safe integer';
  }
  if (!(value['baseCommit'] === null || typeof value['baseCommit'] === 'string')) {
    return 'changedFiles.baseCommit must be a string or null';
  }
  if (value['runBaselineKnown'] !== false) return 'changedFiles.runBaselineKnown must be false';
  if (!(value['reason'] === null || typeof value['reason'] === 'string')) {
    return 'changedFiles.reason must be a string or null';
  }
  const reason = value['reason'];
  if (typeof reason === 'string' && reason.length > ARCHIVE_REASON_LIMIT) {
    return `changedFiles.reason must be at most ${String(ARCHIVE_REASON_LIMIT)} characters`;
  }
  if (value['source'] === 'unknown' && value['status'] === 'known') {
    return 'changedFiles cannot be known with an unknown source';
  }
  if (value['status'] === 'not_entered' && confirmedPaths.length + possiblePaths.length > 0) {
    return 'changedFiles not_entered must list no paths';
  }
  return null;
}

/**
 * Slice 1 §2.6: `changedFiles` as the persistence boundary judges it. The
 * Runtime reader produces this shape; a caller that hands the owner anything
 * else is refused `invalid` (and a malformed stored anchor is refused on
 * decode), never silently truncated or defaulted.
 */
export function archiveChangedFilesProblem(value: unknown): string | null {
  return changedFilesProblem(value);
}

const ANCHOR_BODY_KEYS: readonly string[] = [
  'ref', 'revision', 'schemaVersion', 'workspaceId', 'task', 'planRef', 'lineHead', 'sessionRef', 'role',
  'runRef', 'attemptRef', 'cause', 'archiveRequestId', 'archiveRequestReceipt', 'archivedBy', 'recordedAt',
  'changedFiles', 'resultVerification',
];

function checkAnomalyAnchorBody(body: UnknownRecord): string | null {
  if (!hasOnlyKeys(body, ANCHOR_BODY_KEYS)) return 'anchor record carries unknown fields';
  const ref = anomalyRefProblem(body['ref'], 'anchor ref');
  if (ref !== null) return ref;
  const anchorRef = body['ref'] as UnknownRecord;
  if (!isRevisionOne(body['revision'])) return 'anchor revision must be 1';
  if (body['schemaVersion'] !== 1) return 'anchor schemaVersion must be 1';
  if (!nonEmpty(body['workspaceId'])) return 'anchor workspaceId must be a non-empty string';
  const task = taskTripleProblem(body['task']);
  if (task !== null) return task;
  const taskValue = body['task'] as UnknownRecord;
  const plan = planRefProblem(body['planRef']);
  if (plan !== null) return plan;
  const lineHead = plainRefProblem(body['lineHead'], 'anchor lineHead');
  if (lineHead !== null) return lineHead;
  const session = plainRefProblem(body['sessionRef'], 'anchor sessionRef');
  if (session !== null) return session;
  const role = checkRole(body['role']);
  if (role !== null) return `anchor role: ${role}`;
  const run = runRefProblem(body['runRef']);
  if (run !== null) return run;
  const attempt = attemptRefProblem(body['attemptRef']);
  if (attempt !== null) return attempt;
  const runValue = body['runRef'] as UnknownRecord;
  const attemptValue = body['attemptRef'] as UnknownRecord;
  const planValue = body['planRef'] as UnknownRecord;
  const lineValue = body['lineHead'] as UnknownRecord;
  const sessionValue = body['sessionRef'] as UnknownRecord;
  // The anchor key is the full Run identity; every nested scope must agree with
  // it. `ref` and `runRef` are two spellings of the same immutable identity.
  if (anchorRef['projectId'] !== runValue['projectId'] || anchorRef['goalId'] !== runValue['goalId']
    || anchorRef['runId'] !== runValue['runId']) {
    return 'anchor ref disagrees with its runRef';
  }
  if (taskValue['projectId'] !== anchorRef['projectId'] || taskValue['goalId'] !== anchorRef['goalId']) {
    return 'anchor task belongs to another Goal/project';
  }
  if (planValue['projectId'] !== anchorRef['projectId']) return 'anchor planRef belongs to another project';
  if (lineValue['projectId'] !== anchorRef['projectId'] || sessionValue['projectId'] !== anchorRef['projectId']) {
    return 'anchor Session refs belong to another project';
  }
  if (attemptValue['projectId'] !== anchorRef['projectId'] || attemptValue['goalId'] !== anchorRef['goalId']
    || attemptValue['taskId'] !== taskValue['taskId']) {
    return 'anchor attemptRef does not belong to the anchor Task';
  }
  if (body['cause'] !== 'archive_interrupted' && body['cause'] !== 'retired_archive') {
    return 'anchor cause is not recognized';
  }
  if (!nonEmpty(body['archiveRequestId'])) return 'anchor archiveRequestId is required';
  const receipt = receiptProblem(body['archiveRequestReceipt']);
  if (receipt !== null) return receipt;
  const archivedBy = archivedByProblem(body['archivedBy']);
  if (archivedBy !== null) return archivedBy;
  if (!nonEmpty(body['recordedAt'])) return 'anchor recordedAt is required';
  const changed = changedFilesProblem(body['changedFiles']);
  if (changed !== null) return changed;
  if (body['resultVerification'] !== 'not_checked') return 'anchor resultVerification must be not_checked';
  return null;
}

// --------------------------------------------------------------------------
// Canonical key and encode/decode (pure; no Store access)
// --------------------------------------------------------------------------

export function sessionAnomalyRefKey(ref: SessionAnomalyAnchorRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

export function encodeSessionAnomalyAnchor(anchor: SessionAnomalyAnchorV1): EncodedRecord {
  return {
    refKey: sessionAnomalyRefKey(anchor.ref),
    schemaId: SESSION_ANOMALY_SCHEMA_ID,
    revision: anchor.revision,
    json: JSON.stringify(anchor),
  };
}

export function decodeSessionAnomalyAnchor(record: EncodedRecord): DecodeResult<SessionAnomalyAnchorV1> {
  if (record.schemaId !== SESSION_ANOMALY_SCHEMA_ID) {
    return invalid(`expected schemaId ${SESSION_ANOMALY_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const body = parseObject(record.json);
  if (body === null) return invalid('SessionAnomalyAnchor record json is not an object');
  if (!isObject(body['ref']) || !isRevisionOne(body['revision']) || body['revision'] !== record.revision) {
    return invalid('SessionAnomalyAnchor record envelope is invalid');
  }
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) {
    return invalid('SessionAnomalyAnchor refKey disagrees with the record body');
  }
  const problem = checkAnomalyAnchorBody(body);
  if (problem !== null) return invalid(`SessionAnomalyAnchor record payload is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as SessionAnomalyAnchorV1 };
}

const ANOMALY_EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'anchor',
];

export function encodeSessionAnomalyRecordedEvent(event: SessionAnomalyRecordedEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

export function sessionAnomalyRecordedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<SessionAnomalyRecordedEventV1> {
  if (event.eventType !== SESSION_ANOMALY_RECORDED_EVENT_TYPE) {
    return invalid(`expected eventType ${SESSION_ANOMALY_RECORDED_EVENT_TYPE}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== SESSION_ANOMALY_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${String(SESSION_ANOMALY_EVENT_SCHEMA_VERSION)}, got ${String(event.schemaVersion)}`);
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return invalid('SessionAnomalyRecorded envelope is incomplete');
  const body = parseObject(event.json);
  if (body === null) return invalid('SessionAnomalyRecorded event json is not an object');
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType
    || body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return invalid('SessionAnomalyRecorded event envelope disagrees with the event json');
  }
  if (!hasOnlyKeys(body, ANOMALY_EVENT_KEYS)) return invalid('SessionAnomalyRecorded carries unknown fields');
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId'])) {
    return invalid('SessionAnomalyRecorded requires projectId and workspaceId');
  }
  const anchor = body['anchor'];
  if (!isObject(anchor)) return invalid('SessionAnomalyRecorded requires the recorded anchor');
  const problem = checkAnomalyAnchorBody(anchor);
  if (problem !== null) return invalid(`SessionAnomalyRecorded anchor is invalid: ${problem}`);
  if ((anchor['ref'] as UnknownRecord)['projectId'] !== body['projectId']
    || anchor['workspaceId'] !== body['workspaceId']) {
    return invalid('SessionAnomalyRecorded anchor scope disagrees with the event');
  }
  return { status: 'decoded', value: body as unknown as SessionAnomalyRecordedEventV1 };
}

// --------------------------------------------------------------------------
// The single registration
// --------------------------------------------------------------------------

export const SESSION_ANOMALY_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    {
      aggregateType: 'SessionAnomalyAnchor',
      schemaId: SESSION_ANOMALY_SCHEMA_ID,
      validate: (record) => {
        const decoded = decodeSessionAnomalyAnchor(record);
        return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
      },
    },
  ],
  events: [
    {
      eventType: SESSION_ANOMALY_RECORDED_EVENT_TYPE,
      schemaVersion: SESSION_ANOMALY_EVENT_SCHEMA_VERSION,
      validate: (event) => {
        const decoded = sessionAnomalyRecordedEventFromEvent(event);
        return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
      },
    },
  ],
  lookups: [
    { name: SESSION_ANOMALY_BY_TASK_LOOKUP, aggregateType: 'SessionAnomalyAnchor',
      paths: ['ref.projectId', 'workspaceId', 'task.goalId', 'task.taskId'] },
    { name: SESSION_ANOMALY_BY_GOAL_LOOKUP, aggregateType: 'SessionAnomalyAnchor',
      paths: ['ref.projectId', 'workspaceId', 'task.goalId'] },
  ],
};
