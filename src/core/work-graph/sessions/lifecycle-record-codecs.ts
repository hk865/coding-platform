/**
 * A1 Session lifecycle event codecs.
 *
 * SessionRecord/SessionWorkLink reuse `SESSION_RECORD_SCHEMAS` and their
 * existing encoders unchanged. This file registers ONLY the new events needed
 * to replay link/archive/reactivate; there is no second Session schema, no
 * second link body and no I/O.
 *
 * A link-change event stores the prepared link with its to-be-bound cursor field
 * still `null` plus `boundField`. Replay restores that one field from the
 * ORIGINAL receipt cursor; it never scans the current link or guesses a cursor.
 */
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type {
  DecodeResult, EncodedDomainEvent, RecordBackendSchemas,
} from '../../record-store/ports.js';
import {
  checkPlainSessionRef, checkSessionBody, checkWorkLinkBody, checkWorkLinkRef,
  type PendingSessionWorkLink, type Problem,
} from './session-record-codecs.js';

export const SESSION_WORK_LINK_CHANGED_EVENT = 'SessionWorkLinkChanged';
export const SESSION_ARCHIVED_EVENT = 'SessionArchived';
export const SESSION_REACTIVATED_EVENT = 'SessionReactivated';
/** A.2 SES-12/SES-13 (spec §8, SD-2): a reconcile health observation. */
export const SESSION_HEALTH_OBSERVED_EVENT = 'SessionHealthObserved';
export const SESSION_LIFECYCLE_EVENT_VERSION = 1;

/** Replay payload of one link activation or closure. */
export type SessionWorkLinkChangedEventV1 = {
  eventId: string;
  eventType: typeof SESSION_WORK_LINK_CHANGED_EVENT;
  schemaVersion: 1;
  occurredAt: string;
  projectId: string;
  workspaceId: string;
  sessionRef: SessionRef;
  sessionRevision: number;
  active: boolean;
  /** Null at the bound field in the immutable event; restore using that event's
   * committed receipt cursor, never the current link or a guessed cursor. */
  link: PendingSessionWorkLink;
  boundField: 'since' | 'until';
};

/** Replay payload of one archive or reactivate transition. */
export type SessionLifecycleChangedEventV1 = {
  eventId: string;
  eventType: typeof SESSION_ARCHIVED_EVENT | typeof SESSION_REACTIVATED_EVENT;
  schemaVersion: 1;
  occurredAt: string;
  projectId: string;
  session: SessionRecord;
  reason: string;
};

/**
 * Replay payload of one Host-restart health observation (SES-12/SES-13). The
 * probe conclusion is `ready` for `available` (SES-13, with the Kernel session
 * head read by the same probe) and `missing`/`damaged` for `unavailable`
 * (SES-12, stored as `healthConclusion`). `session` is the written record.
 */
export type SessionHealthObservedEventV1 = {
  eventId: string;
  eventType: typeof SESSION_HEALTH_OBSERVED_EVENT;
  schemaVersion: 1;
  occurredAt: string;
  projectId: string;
  hostInstanceId: string;
  observed: 'available' | 'unavailable';
  probe: 'ready' | 'missing' | 'damaged';
  kernelHeader: { activeRunId: string | null } | null;
  session: SessionRecord;
};

// --------------------------------------------------------------------------
// Small pure helpers (mirrors the Session codec style; no Store access)
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
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
function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
}

const WORK_LINK_CHANGED_EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId',
  'sessionRef', 'sessionRevision', 'active', 'link', 'boundField',
];
const LIFECYCLE_CHANGED_EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'session', 'reason',
];
const HEALTH_OBSERVED_EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'hostInstanceId', 'observed', 'probe',
  'kernelHeader', 'session',
];

// --------------------------------------------------------------------------
// Body checks
// --------------------------------------------------------------------------

function checkWorkLinkChangedBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, WORK_LINK_CHANGED_EVENT_KEYS)) return 'SessionWorkLinkChanged carries unknown fields';
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId'])) {
    return 'SessionWorkLinkChanged requires projectId and workspaceId';
  }
  const sessionRef = body['sessionRef'];
  const sessionProblem = checkPlainSessionRef(sessionRef);
  if (sessionProblem !== null) return `SessionWorkLinkChanged: ${sessionProblem}`;
  if (!isObject(sessionRef) || sessionRef['projectId'] !== body['projectId']) {
    return 'SessionWorkLinkChanged sessionRef disagrees with the event project';
  }
  if (!isPositiveRevision(body['sessionRevision'])) {
    return 'SessionWorkLinkChanged sessionRevision must be a positive safe integer';
  }
  if (typeof body['active'] !== 'boolean') return 'SessionWorkLinkChanged active must be a boolean';
  const link = body['link'];
  if (!isObject(link)) return 'SessionWorkLinkChanged requires a pending link body';
  const linkProblem = checkWorkLinkBody(link, false);
  if (linkProblem !== null) return `SessionWorkLinkChanged link: ${linkProblem}`;
  const ref = link['ref'];
  const refProblem = checkWorkLinkRef(ref);
  if (refProblem !== null) return `SessionWorkLinkChanged link ref: ${refProblem}`;
  if (!isObject(ref) || ref['projectId'] !== body['projectId'] || !isObject(sessionRef) ||
    ref['sessionId'] !== sessionRef['sessionId']) {
    return 'SessionWorkLinkChanged link ref disagrees with the event Session';
  }
  const boundField = body['boundField'];
  if (boundField !== 'since' && boundField !== 'until') {
    return 'SessionWorkLinkChanged boundField must be since or until';
  }
  if (boundField === 'since') {
    if (body['active'] !== true) return 'SessionWorkLinkChanged opens the interval only when active';
    if (link['until'] !== null) return 'SessionWorkLinkChanged open link must not be already closed';
  } else {
    if (body['active'] !== false) return 'SessionWorkLinkChanged closes the interval only when inactive';
    if (link['since'] === null) return 'SessionWorkLinkChanged close must retain the original since cursor';
  }
  return null;
}

function checkLifecycleChangedBody(body: UnknownRecord, lifecycle: 'archived' | 'active'): Problem {
  if (!hasOnlyKeys(body, LIFECYCLE_CHANGED_EVENT_KEYS)) return 'Session lifecycle event carries unknown fields';
  if (!nonEmpty(body['projectId'])) return 'Session lifecycle event requires a projectId';
  if (!nonEmpty(body['reason'])) return 'Session lifecycle event requires a reason';
  const session = body['session'];
  if (!isObject(session)) return 'Session lifecycle event requires the transitioned SessionRecord';
  const sessionProblem = checkSessionBody(session);
  if (sessionProblem !== null) return `Session lifecycle event session: ${sessionProblem}`;
  if (session['lifecycle'] !== lifecycle) {
    return `Session lifecycle event requires lifecycle ${lifecycle}`;
  }
  const ref = session['ref'];
  if (!isObject(ref) || ref['projectId'] !== body['projectId']) {
    return 'Session lifecycle event Session disagrees with the event project';
  }
  if (lifecycle === 'archived' && session['archivedAt'] === null) {
    return 'an archived Session event requires archivedAt';
  }
  if (lifecycle === 'active' && session['archivedAt'] !== null) {
    return 'a reactivated Session event must clear archivedAt';
  }
  return null;
}

function checkHealthObservedBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, HEALTH_OBSERVED_EVENT_KEYS)) return 'SessionHealthObserved carries unknown fields';
  if (!nonEmpty(body['projectId'])) return 'SessionHealthObserved requires a projectId';
  if (!nonEmpty(body['hostInstanceId'])) return 'SessionHealthObserved requires the reconciling hostInstanceId';
  const observed = body['observed'];
  const probe = body['probe'];
  if (observed === 'available') {
    if (probe !== 'ready') return 'an available health observation requires a ready probe';
  } else if (observed === 'unavailable') {
    if (probe !== 'missing' && probe !== 'damaged') return 'an unavailable health observation requires a missing or damaged probe';
  } else {
    return 'SessionHealthObserved observed must be available or unavailable';
  }
  const header = body['kernelHeader'];
  if (probe === 'ready') {
    if (!isObject(header) || !hasOnlyKeys(header, ['activeRunId'])
      || !(header['activeRunId'] === null || nonEmpty(header['activeRunId']))) {
      return 'a ready probe carries the Kernel session head {activeRunId}';
    }
  } else if (header !== null) {
    return 'only a ready probe carries the Kernel session head';
  }
  const session = body['session'];
  if (!isObject(session)) return 'SessionHealthObserved requires the observed SessionRecord';
  const sessionProblem = checkSessionBody(session);
  if (sessionProblem !== null) return `SessionHealthObserved session: ${sessionProblem}`;
  const ref = session['ref'];
  if (!isObject(ref) || ref['projectId'] !== body['projectId']) {
    return 'SessionHealthObserved Session disagrees with the event project';
  }
  if (session['health'] !== observed) return 'SessionHealthObserved session health disagrees with the observation';
  const conclusion = session['healthConclusion'] ?? null;
  if (observed === 'available' ? conclusion !== null : conclusion !== probe) {
    return 'SessionHealthObserved session healthConclusion disagrees with the probe';
  }
  return null;
}

// --------------------------------------------------------------------------
// Envelope validation
// --------------------------------------------------------------------------

function validateEventBody(
  event: EncodedDomainEvent,
  expectedType: string,
  checkBody: (body: UnknownRecord) => Problem,
): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== expectedType) return invalid(`expected eventType ${expectedType}, got ${event.eventType}`);
  if (event.schemaVersion !== SESSION_LIFECYCLE_EVENT_VERSION) {
    return invalid(`expected schemaVersion ${SESSION_LIFECYCLE_EVENT_VERSION}, got ${event.schemaVersion}`);
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return invalid(`${expectedType} event envelope is incomplete`);
  const body = parseObject(event.json);
  if (body === null) return invalid(`${expectedType} event json is not an object`);
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType ||
    body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return invalid(`${expectedType} event envelope disagrees with the event json`);
  }
  const problem = checkBody(body);
  if (problem !== null) return invalid(`${expectedType} event payload is invalid: ${problem}`);
  return { status: 'decoded', value: event };
}

// --------------------------------------------------------------------------
// The single registration
// --------------------------------------------------------------------------

export const SESSION_LIFECYCLE_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [],
  events: [
    {
      eventType: SESSION_WORK_LINK_CHANGED_EVENT,
      schemaVersion: SESSION_LIFECYCLE_EVENT_VERSION,
      validate: (event) => validateEventBody(event, SESSION_WORK_LINK_CHANGED_EVENT, checkWorkLinkChangedBody),
    },
    {
      eventType: SESSION_ARCHIVED_EVENT,
      schemaVersion: SESSION_LIFECYCLE_EVENT_VERSION,
      validate: (event) => validateEventBody(event, SESSION_ARCHIVED_EVENT,
        (body) => checkLifecycleChangedBody(body, 'archived')),
    },
    {
      eventType: SESSION_REACTIVATED_EVENT,
      schemaVersion: SESSION_LIFECYCLE_EVENT_VERSION,
      validate: (event) => validateEventBody(event, SESSION_REACTIVATED_EVENT,
        (body) => checkLifecycleChangedBody(body, 'active')),
    },
    {
      eventType: SESSION_HEALTH_OBSERVED_EVENT,
      schemaVersion: SESSION_LIFECYCLE_EVENT_VERSION,
      validate: (event) => validateEventBody(event, SESSION_HEALTH_OBSERVED_EVENT, checkHealthObservedBody),
    },
  ],
  lookups: [],
};

// --------------------------------------------------------------------------
// Encode
// --------------------------------------------------------------------------

export function encodeSessionWorkLinkChangedEvent(event: SessionWorkLinkChangedEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

export function encodeSessionLifecycleChangedEvent(event: SessionLifecycleChangedEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

export function encodeSessionHealthObservedEvent(event: SessionHealthObservedEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

// --------------------------------------------------------------------------
// Decode (replay)
// --------------------------------------------------------------------------

export function sessionWorkLinkChangedPayloadFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<SessionWorkLinkChangedEventV1> {
  const checked = validateEventBody(event, SESSION_WORK_LINK_CHANGED_EVENT, checkWorkLinkChangedBody);
  if (checked.status !== 'decoded') return checked;
  const body = parseObject(event.json);
  if (body === null) return invalid('SessionWorkLinkChanged event json is not an object');
  return { status: 'decoded', value: body as unknown as SessionWorkLinkChangedEventV1 };
}

export function sessionLifecycleChangedPayloadFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<SessionLifecycleChangedEventV1> {
  if (event.eventType !== SESSION_ARCHIVED_EVENT && event.eventType !== SESSION_REACTIVATED_EVENT) {
    return invalid(`expected a Session lifecycle event, got ${event.eventType}`);
  }
  const lifecycle = event.eventType === SESSION_ARCHIVED_EVENT ? 'archived' : 'active';
  const checked = validateEventBody(event, event.eventType, (body) => checkLifecycleChangedBody(body, lifecycle));
  if (checked.status !== 'decoded') return checked;
  const body = parseObject(event.json);
  if (body === null) return invalid('Session lifecycle event json is not an object');
  return { status: 'decoded', value: body as unknown as SessionLifecycleChangedEventV1 };
}

export function sessionHealthObservedPayloadFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<SessionHealthObservedEventV1> {
  const checked = validateEventBody(event, SESSION_HEALTH_OBSERVED_EVENT, checkHealthObservedBody);
  if (checked.status !== 'decoded') return checked;
  const body = parseObject(event.json);
  if (body === null) return invalid('SessionHealthObserved event json is not an object');
  return { status: 'decoded', value: body as unknown as SessionHealthObservedEventV1 };
}
