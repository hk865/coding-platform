/**
 * The ONE owner of the `RunActivity@1` and `ActivityRecording@1` immutable
 * records, their `RunActivityRecorded` / `ActivityRecordingStarted` replay
 * events, and the ordered `s2b-run-activity-by-goal-last` index (L4, L14). It
 * performs no I/O: the ending commit, RUN-21 and the backfill write these
 * records through it (L5, L8).
 *
 * The two records are independent aggregates, not Run state fields (L4, L16);
 * `execution-entry-codecs.ts` folds them into `EXECUTION_ENTRY_RECORD_SCHEMAS`
 * (§5.3 last row). The event header shape is copied from
 * `session-anomaly-codecs.ts`, never imported: a `persistence` codec may not
 * import a `tasks` module, so the spec §6 path `tasks/run-activity-codecs.ts`
 * re-exports this file for the task/views importers.
 */
import type {
  ActivityRecordingRef, ActivityRecordingSnapshot, ActivityTotalsV1, RunActivityBound,
  RunActivityFactsV1, RunActivityRef, RunActivitySnapshot, RunActivityUnknownReason,
} from '../../../contracts/run-activity.js';
import { ACTIVITY_QUARTER_CAP, RUN_CHANGED_FILES_CAP, RUN_USAGE_REQUESTS_CAP } from '../../../contracts/run-activity.js';
import { canonicalJson, canonicalOf, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  hasOnlyKeys, invalid, isNonNeg as isNonNegativeSafeInteger, isPos as isPositiveSafeInteger,
  isRecord as isObject, nonEmpty, parseObject,
} from '../../../contracts/validation/common.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { RecordLookupIndex } from '../../record-store/lookup-ports.js';
import { encodeEventEnvelope } from './event-envelope.js';

export const RUN_ACTIVITY_SCHEMA_ID = 'RunActivity@1' as const;
export const ACTIVITY_RECORDING_SCHEMA_ID = 'ActivityRecording@1' as const;
export const RUN_ACTIVITY_RECORDED_EVENT_TYPE = 'RunActivityRecorded' as const;
export const ACTIVITY_RECORDING_STARTED_EVENT_TYPE = 'ActivityRecordingStarted' as const;
export const RUN_ACTIVITY_EVENT_SCHEMA_VERSION = 1 as const;

/** L14: the ordered RunActivity index by Goal and `span.lastAt`. */
export const S2B_RUN_ACTIVITY_BY_GOAL_LAST_LOOKUP = 's2b-run-activity-by-goal-last';

/** Event header shared by both replay events (spec §2.9). */
export type RunActivityEventHeaderV1 = {
  eventId: string; schemaVersion: 1; occurredAt: string;
  projectId: string; workspaceId: string;
};

/** P2: the `RunActivityRecorded` replay event carries the record it wrote. */
export type RunActivityRecordedEventV1 = RunActivityEventHeaderV1 & {
  eventType: 'RunActivityRecorded'; runActivity: RunActivitySnapshot;
};

/** P2: the `ActivityRecordingStarted` replay event carries the record it wrote. */
export type ActivityRecordingStartedEventV1 = RunActivityEventHeaderV1 & {
  eventType: 'ActivityRecordingStarted'; activityRecording: ActivityRecordingSnapshot;
};

// --------------------------------------------------------------------------
// Pure shape helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function refProblem(value: unknown, aggregateType: string, fields: readonly string[], label: string): string | null {
  if (!isObject(value) || value['aggregateType'] !== aggregateType
    || !hasOnlyKeys(value, ['aggregateType', ...fields])) {
    return `${label} must be a complete ${aggregateType}Ref`;
  }
  for (const field of fields) {
    if (!nonEmpty(value[field])) return `${label} is missing ${field}`;
  }
  return null;
}
function sessionRefProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['projectId', 'sessionId'])
    || !nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return 'sessionRef must be a complete SessionRef';
  }
  return null;
}

// --------------------------------------------------------------------------
// RunActivityFactsV1
// --------------------------------------------------------------------------

const UNKNOWN_REASONS: readonly RunActivityUnknownReason[] = [
  'no_history_locator', 'kernel_unreadable', 'history_read_failed', 'history_damaged', 'turn_not_found', 'capacity',
];
const ACTIVITY_BOUNDS: readonly RunActivityBound[] = [
  'end_position', 'turn_bounds', 'reconcile_observation', 'kernel_tail',
];
const INCOMPLETE_REASONS: readonly string[] = ['command_ran', 'edits_unknown', 'cap'];
const UNKNOWN_DETAIL_LIMIT = 500;

function totalsProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['steps', 'edits', 'editsUnknown'])) {
    return `${label} must be ActivityTotalsV1`;
  }
  for (const field of ['steps', 'edits', 'editsUnknown'] as const) {
    if (!isNonNegativeSafeInteger(value[field])) return `${label}.${field} must be a non-negative safe integer`;
  }
  return null;
}
function isIsoZulu(value: unknown): value is string {
  return nonEmpty(value) && value.endsWith('Z') && Number.isFinite(Date.parse(value));
}
function quartersProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'facts.quarters must be an array';
  if (value.length > ACTIVITY_QUARTER_CAP) return `facts.quarters exceeds ACTIVITY_QUARTER_CAP (${String(ACTIVITY_QUARTER_CAP)})`;
  let previous: string | null = null;
  for (const entry of value) {
    if (!isObject(entry) || !hasOnlyKeys(entry, ['at', 'steps', 'edits', 'editsUnknown'])) {
      return 'facts.quarters entries must be ActivityQuarterV1';
    }
    if (!isIsoZulu(entry['at'])) return 'facts.quarters.at must be an ISO UTC time ending in Z';
    const totals = totalsProblem({ steps: entry['steps'], edits: entry['edits'], editsUnknown: entry['editsUnknown'] },
      'facts.quarters entry');
    if (totals !== null) return totals;
    const at = entry['at'];
    if (previous !== null && at <= previous) return 'facts.quarters must be sorted by at without duplicates';
    previous = at;
  }
  return null;
}
function overflowProblem(value: unknown): string | null {
  if (value === null) return null;
  if (!isObject(value) || !hasOnlyKeys(value, ['steps', 'edits', 'editsUnknown', 'firstAt', 'lastAt'])) {
    return 'facts.overflow must be null or the overflow totals with firstAt/lastAt';
  }
  const totals = totalsProblem({ steps: value['steps'], edits: value['edits'], editsUnknown: value['editsUnknown'] },
    'facts.overflow');
  if (totals !== null) return totals;
  if (!nonEmpty(value['firstAt']) || !nonEmpty(value['lastAt'])) return 'facts.overflow needs firstAt and lastAt';
  return null;
}
function windowProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, [
    'kernelRunId', 'kernelTurnId', 'fromPosition', 'throughPosition', 'bound', 'turnTerminal',
    'unresolvedCalls', 'turnStartedAt', 'lastRecordAt',
  ])) {
    return 'facts.window carries unknown fields';
  }
  if (!nonEmpty(value['kernelRunId']) || !nonEmpty(value['kernelTurnId'])) {
    return 'facts.window needs the Kernel run and turn ids';
  }
  if (!isNonNegativeSafeInteger(value['fromPosition']) || !isNonNegativeSafeInteger(value['throughPosition'])) {
    return 'facts.window positions must be non-negative safe integers';
  }
  if (value['throughPosition'] < value['fromPosition']) return 'facts.window throughPosition precedes fromPosition';
  if (!ACTIVITY_BOUNDS.includes(value['bound'] as RunActivityBound)) return 'facts.window.bound is not recognized';
  if (typeof value['turnTerminal'] !== 'boolean') return 'facts.window.turnTerminal must be a boolean';
  if (!isNonNegativeSafeInteger(value['unresolvedCalls'])) return 'facts.window.unresolvedCalls must be a non-negative safe integer';
  if (!nonEmpty(value['turnStartedAt']) || !nonEmpty(value['lastRecordAt'])) {
    return 'facts.window needs turnStartedAt and lastRecordAt';
  }
  return null;
}
function pathListProblem(value: unknown, label: string): string | null {
  if (!Array.isArray(value)) return `${label} must be an array`;
  if (value.length > RUN_CHANGED_FILES_CAP) return `${label} exceeds RUN_CHANGED_FILES_CAP (${String(RUN_CHANGED_FILES_CAP)})`;
  let previous: string | null = null;
  for (const entry of value) {
    if (!nonEmpty(entry)) return `${label} entries must be non-empty strings`;
    if (previous !== null && entry <= previous) return `${label} must be distinct and in byte order`;
    previous = entry;
  }
  return null;
}
function changedFilesProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, [
    'definite', 'possible', 'definiteOmitted', 'possibleOmitted', 'possiblyIncomplete', 'incompleteBecause',
  ])) {
    return 'facts.changedFiles carries unknown fields';
  }
  const definite = pathListProblem(value['definite'], 'facts.changedFiles.definite');
  if (definite !== null) return definite;
  const possible = pathListProblem(value['possible'], 'facts.changedFiles.possible');
  if (possible !== null) return possible;
  if (!isNonNegativeSafeInteger(value['definiteOmitted']) || !isNonNegativeSafeInteger(value['possibleOmitted'])) {
    return 'facts.changedFiles omitted counts must be non-negative safe integers';
  }
  if (typeof value['possiblyIncomplete'] !== 'boolean') return 'facts.changedFiles.possiblyIncomplete must be a boolean';
  if (!Array.isArray(value['incompleteBecause'])
    || !value['incompleteBecause'].every((reason) => INCOMPLETE_REASONS.includes(reason as string))) {
    return 'facts.changedFiles.incompleteBecause is not recognized';
  }
  return null;
}
function usageRequestProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, [
    'requestId', 'startedAt', 'usageStatus', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'costUsdMicros',
  ])) {
    return 'facts.usage.requests entries carry unknown fields';
  }
  if (!nonEmpty(value['requestId']) || !nonEmpty(value['startedAt'])) return 'facts.usage request needs id and startedAt';
  if (value['usageStatus'] !== 'reported' && value['usageStatus'] !== 'unknown') {
    return 'facts.usage request usageStatus is not recognized';
  }
  for (const field of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'costUsdMicros'] as const) {
    const token = value[field];
    if (!(token === null || isNonNegativeSafeInteger(token))) return `facts.usage request ${field} must be null or a non-negative safe integer`;
  }
  return null;
}
function usageProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['requests', 'omitted', 'totals', 'complete'])) {
    return 'facts.usage carries unknown fields';
  }
  if (!Array.isArray(value['requests'])) return 'facts.usage.requests must be an array';
  if (value['requests'].length > RUN_USAGE_REQUESTS_CAP) {
    return `facts.usage.requests exceeds RUN_USAGE_REQUESTS_CAP (${String(RUN_USAGE_REQUESTS_CAP)})`;
  }
  for (const request of value['requests']) {
    const problem = usageRequestProblem(request);
    if (problem !== null) return problem;
  }
  if (!isNonNegativeSafeInteger(value['omitted'])) return 'facts.usage.omitted must be a non-negative safe integer';
  const totals = value['totals'];
  if (!isObject(totals) || !hasOnlyKeys(totals, ['inputTokens', 'outputTokens', 'cachedInputTokens'])) {
    return 'facts.usage.totals carries unknown fields';
  }
  for (const field of ['inputTokens', 'outputTokens', 'cachedInputTokens'] as const) {
    if (!isNonNegativeSafeInteger(totals[field])) return `facts.usage.totals.${field} must be a non-negative safe integer`;
  }
  if (typeof value['complete'] !== 'boolean') return 'facts.usage.complete must be a boolean';
  return null;
}
function factsProblem(value: unknown): string | null {
  if (!isObject(value)) return 'facts must be an object';
  if (!isPositiveSafeInteger(value['ruleVersion'])) return 'facts.ruleVersion must be a positive safe integer';
  if (value['status'] === 'unknown') {
    if (!hasOnlyKeys(value, ['status', 'ruleVersion', 'reason', 'detail'])) return 'unknown facts carry unknown fields';
    if (!UNKNOWN_REASONS.includes(value['reason'] as RunActivityUnknownReason)) return 'facts.reason is not recognized';
    if (typeof value['detail'] !== 'string' || value['detail'].length > UNKNOWN_DETAIL_LIMIT) {
      return `facts.detail must be at most ${String(UNKNOWN_DETAIL_LIMIT)} characters`;
    }
    return null;
  }
  if (value['status'] !== 'counted') return 'facts.status is not recognized';
  if (!hasOnlyKeys(value, ['status', 'ruleVersion', 'window', 'quarters', 'overflow', 'totals', 'changedFiles', 'usage'])) {
    return 'counted facts carry unknown fields';
  }
  const window = windowProblem(value['window']);
  if (window !== null) return window;
  const quarters = quartersProblem(value['quarters']);
  if (quarters !== null) return quarters;
  const overflow = overflowProblem(value['overflow']);
  if (overflow !== null) return overflow;
  const totals = totalsProblem(value['totals'], 'facts.totals');
  if (totals !== null) return totals;
  const changed = changedFilesProblem(value['changedFiles']);
  if (changed !== null) return changed;
  return usageProblem(value['usage']);
}
function spanProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['firstAt', 'lastAt', 'basis'])) return 'span carries unknown fields';
  if (!(value['firstAt'] === null || nonEmpty(value['firstAt']))) return 'span.firstAt must be a non-empty string or null';
  if (!nonEmpty(value['lastAt'])) return 'span.lastAt must be a non-empty string';
  if (value['basis'] !== 'kernel' && value['basis'] !== 'run_times') return 'span.basis is not recognized';
  return null;
}

// --------------------------------------------------------------------------
// Record bodies and encode/decode (pure; no Store access)
// --------------------------------------------------------------------------

const RUN_ACTIVITY_BODY_KEYS: readonly string[] = [
  'ref', 'revision', 'schemaVersion', 'runRef', 'taskId', 'workspaceId', 'sessionRef', 'runEndedAt',
  'recordedBy', 'recordedAt', 'facts', 'span',
];

function runActivityBodyProblem(body: UnknownRecord): string | null {
  if (!hasOnlyKeys(body, RUN_ACTIVITY_BODY_KEYS)) return 'RunActivity record carries unknown fields';
  const ref = refProblem(body['ref'], 'RunActivity', ['projectId', 'goalId', 'runId'], 'RunActivity ref');
  if (ref !== null) return ref;
  if (!isPositiveSafeInteger(body['revision'])) return 'RunActivity revision must be a positive safe integer';
  if (body['schemaVersion'] !== 1) return 'RunActivity schemaVersion must be 1';
  const runRef = refProblem(body['runRef'], 'Run', ['projectId', 'goalId', 'runId'], 'RunActivity runRef');
  if (runRef !== null) return runRef;
  const refValue = body['ref'] as UnknownRecord;
  const runValue = body['runRef'] as UnknownRecord;
  if (refValue['projectId'] !== runValue['projectId'] || refValue['goalId'] !== runValue['goalId']
    || refValue['runId'] !== runValue['runId']) {
    return 'RunActivity ref disagrees with its runRef';
  }
  if (!nonEmpty(body['taskId'])) return 'RunActivity taskId is required';
  if (!nonEmpty(body['workspaceId'])) return 'RunActivity workspaceId is required';
  if (body['sessionRef'] !== null) {
    const session = sessionRefProblem(body['sessionRef']);
    if (session !== null) return session;
    if ((body['sessionRef'] as UnknownRecord)['projectId'] !== refValue['projectId']) {
      return 'RunActivity sessionRef belongs to another project';
    }
  }
  if (!nonEmpty(body['runEndedAt'])) return 'RunActivity runEndedAt is required';
  if (body['recordedBy'] !== 'run_end' && body['recordedBy'] !== 'backfill') return 'RunActivity recordedBy is not recognized';
  if (!nonEmpty(body['recordedAt'])) return 'RunActivity recordedAt is required';
  const facts = factsProblem(body['facts']);
  if (facts !== null) return facts;
  return spanProblem(body['span']);
}

function activityRecordingBodyProblem(body: UnknownRecord): string | null {
  if (!hasOnlyKeys(body, ['ref', 'revision', 'schemaVersion', 'since'])) {
    return 'ActivityRecording record carries unknown fields';
  }
  const ref = refProblem(body['ref'], 'ActivityRecording', ['projectId', 'workspaceId'], 'ActivityRecording ref');
  if (ref !== null) return ref;
  if (!isPositiveSafeInteger(body['revision'])) return 'ActivityRecording revision must be a positive safe integer';
  if (body['schemaVersion'] !== 1) return 'ActivityRecording schemaVersion must be 1';
  if (!nonEmpty(body['since'])) return 'ActivityRecording since is required';
  return null;
}

/** Canonical record key of one RunActivity aggregate. */
export function runActivityRefKey(ref: RunActivityRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}
/** Canonical record key of one ActivityRecording aggregate. */
export function activityRecordingRefKey(ref: ActivityRecordingRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

export function encodeRunActivitySnapshot(snapshot: RunActivitySnapshot): EncodedRecord {
  return {
    refKey: runActivityRefKey(snapshot.ref),
    schemaId: RUN_ACTIVITY_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

export function decodeRunActivitySnapshot(record: EncodedRecord): DecodeResult<RunActivitySnapshot> {
  if (record.schemaId !== RUN_ACTIVITY_SCHEMA_ID) {
    return invalid(`expected schemaId ${RUN_ACTIVITY_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const body = parseObject(record.json);
  if (body === null) return invalid('RunActivity record json is not an object');
  if (!isObject(body['ref']) || !isPositiveSafeInteger(body['revision']) || body['revision'] !== record.revision) {
    return invalid('RunActivity record envelope is invalid');
  }
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) {
    return invalid('RunActivity refKey disagrees with the record body');
  }
  const problem = runActivityBodyProblem(body);
  if (problem !== null) return invalid(`RunActivity record payload is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as RunActivitySnapshot };
}

export function encodeActivityRecordingSnapshot(snapshot: ActivityRecordingSnapshot): EncodedRecord {
  return {
    refKey: activityRecordingRefKey(snapshot.ref),
    schemaId: ACTIVITY_RECORDING_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

export function decodeActivityRecordingSnapshot(record: EncodedRecord): DecodeResult<ActivityRecordingSnapshot> {
  if (record.schemaId !== ACTIVITY_RECORDING_SCHEMA_ID) {
    return invalid(`expected schemaId ${ACTIVITY_RECORDING_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const body = parseObject(record.json);
  if (body === null) return invalid('ActivityRecording record json is not an object');
  if (!isObject(body['ref']) || !isPositiveSafeInteger(body['revision']) || body['revision'] !== record.revision) {
    return invalid('ActivityRecording record envelope is invalid');
  }
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) {
    return invalid('ActivityRecording refKey disagrees with the record body');
  }
  const problem = activityRecordingBodyProblem(body);
  if (problem !== null) return invalid(`ActivityRecording record payload is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as ActivityRecordingSnapshot };
}

// --------------------------------------------------------------------------
// Replay events (P2)
// --------------------------------------------------------------------------

function eventEnvelopeProblem(
  event: EncodedDomainEvent, body: UnknownRecord, eventType: string, keys: readonly string[],
): string | null {
  if (event.eventType !== eventType) return `expected eventType ${eventType}, got ${event.eventType}`;
  if (event.schemaVersion !== RUN_ACTIVITY_EVENT_SCHEMA_VERSION) {
    return `expected schemaVersion ${String(RUN_ACTIVITY_EVENT_SCHEMA_VERSION)}, got ${String(event.schemaVersion)}`;
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return `${eventType} envelope is incomplete`;
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType
    || body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return `${eventType} envelope disagrees with the event json`;
  }
  if (!hasOnlyKeys(body, keys)) return `${eventType} carries unknown fields`;
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId'])) {
    return `${eventType} requires projectId and workspaceId`;
  }
  return null;
}

export function encodeRunActivityRecordedEvent(event: RunActivityRecordedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

export function runActivityRecordedEventFromEvent(event: EncodedDomainEvent): DecodeResult<RunActivityRecordedEventV1> {
  const body = parseObject(event.json);
  if (body === null) return invalid('RunActivityRecorded event json is not an object');
  const envelope = eventEnvelopeProblem(event, body, RUN_ACTIVITY_RECORDED_EVENT_TYPE,
    ['eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'runActivity']);
  if (envelope !== null) return invalid(envelope);
  const activity = body['runActivity'];
  if (!isObject(activity)) return invalid('RunActivityRecorded requires the recorded RunActivity');
  const problem = runActivityBodyProblem(activity);
  if (problem !== null) return invalid(`RunActivityRecorded runActivity is invalid: ${problem}`);
  const ref = activity['ref'] as UnknownRecord;
  if (ref['projectId'] !== body['projectId'] || activity['workspaceId'] !== body['workspaceId']) {
    return invalid('RunActivityRecorded runActivity scope disagrees with the event');
  }
  return { status: 'decoded', value: body as unknown as RunActivityRecordedEventV1 };
}

export function encodeActivityRecordingStartedEvent(event: ActivityRecordingStartedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

export function activityRecordingStartedEventFromEvent(event: EncodedDomainEvent): DecodeResult<ActivityRecordingStartedEventV1> {
  const body = parseObject(event.json);
  if (body === null) return invalid('ActivityRecordingStarted event json is not an object');
  const envelope = eventEnvelopeProblem(event, body, ACTIVITY_RECORDING_STARTED_EVENT_TYPE,
    ['eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'activityRecording']);
  if (envelope !== null) return invalid(envelope);
  const recording = body['activityRecording'];
  if (!isObject(recording)) return invalid('ActivityRecordingStarted requires the recorded ActivityRecording');
  const problem = activityRecordingBodyProblem(recording);
  if (problem !== null) return invalid(`ActivityRecordingStarted activityRecording is invalid: ${problem}`);
  const ref = recording['ref'] as UnknownRecord;
  if (ref['projectId'] !== body['projectId'] || ref['workspaceId'] !== body['workspaceId']) {
    return invalid('ActivityRecordingStarted activityRecording scope disagrees with the event');
  }
  return { status: 'decoded', value: body as unknown as ActivityRecordingStartedEventV1 };
}

// --------------------------------------------------------------------------
// The single registration group (§5.3 last row)
// --------------------------------------------------------------------------

const RUN_ACTIVITY_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  {
    name: S2B_RUN_ACTIVITY_BY_GOAL_LAST_LOOKUP,
    aggregateType: 'RunActivity',
    paths: ['ref.projectId', 'ref.goalId'],
    orderBy: { path: 'span.lastAt' },
  },
];

export const RUN_ACTIVITY_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    {
      schemaId: RUN_ACTIVITY_SCHEMA_ID,
      aggregateType: 'RunActivity',
      validate: (record) => {
        const decoded = decodeRunActivitySnapshot(record);
        return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
      },
    },
    {
      schemaId: ACTIVITY_RECORDING_SCHEMA_ID,
      aggregateType: 'ActivityRecording',
      validate: (record) => {
        const decoded = decodeActivityRecordingSnapshot(record);
        return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
      },
    },
  ],
  events: [
    {
      eventType: RUN_ACTIVITY_RECORDED_EVENT_TYPE,
      schemaVersion: RUN_ACTIVITY_EVENT_SCHEMA_VERSION,
      validate: (event) => {
        const decoded = runActivityRecordedEventFromEvent(event);
        return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
      },
    },
    {
      eventType: ACTIVITY_RECORDING_STARTED_EVENT_TYPE,
      schemaVersion: RUN_ACTIVITY_EVENT_SCHEMA_VERSION,
      validate: (event) => {
        const decoded = activityRecordingStartedEventFromEvent(event);
        return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
      },
    },
  ],
  lookups: RUN_ACTIVITY_LOOKUP_INDEXES,
};
