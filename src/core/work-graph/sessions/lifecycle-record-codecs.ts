/**
 * Session lifecycle event codecs.
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
import type { ArchiveStepRefV1 } from '../../../contracts/core/session-archive.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import {
  hasOnlyKeys, invalid, isPos, isRecord, nonEmpty, parseObject, type UnknownRecord,
} from '../../../contracts/validation/common.js';
import type {
  DecodeResult, EncodedDomainEvent, RecordBackendSchemas,
} from '../../record-store/ports.js';
import {
  checkPlainSessionRef, checkSessionBody, checkWorkLinkBody, checkWorkLinkRef,
  type PendingSessionWorkLink, type Problem,
} from './session-record-codecs.js';
import { encodeEventEnvelope } from '../persistence/event-envelope.js';

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
// Slice 1 (spec §2.9): archive request, provenance backfill and responsibility
// change events. Each eventType carries schemaVersion 1; the header shape is
// copied rather than imported by the anomaly codec.
// --------------------------------------------------------------------------

export type Slice1EventHeaderV1 = {
  eventId: string; schemaVersion: 1; occurredAt: string;
  projectId: string; workspaceId: string;
};

export type SessionArchiveChangedEventV1 = Slice1EventHeaderV1 & {
  eventType: 'SessionArchiveRequested' | 'SessionArchiveRequestReleased';
  session: SessionRecord; archiveRequestId: string; reason: string;
};

export type SessionResponsibilityChangedEventV1 = Slice1EventHeaderV1 & {
  eventType: 'SessionResponsibilityChanged';
  mode: 'transfer' | 'drop' | 'terminal';
  source: SessionRecord; destination: SessionRecord | null;
  closed: PendingSessionWorkLink; opened: PendingSessionWorkLink | null;
  openedBound: 'since' | null;
  archiveStep: ArchiveStepRefV1 | null;
  taskBasis: { task: TaskTriple; planRef: PlanRevisionRef;
    terminalCause: 'satisfied' | 'cancelled' | 'superseded' | null;
    finishedAt: string | null };
};

/** Event type selectors of the three slice-1 replay events. */
export const SESSION_ARCHIVE_REQUESTED_EVENT = 'SessionArchiveRequested';
export const SESSION_ARCHIVE_REQUEST_RELEASED_EVENT = 'SessionArchiveRequestReleased';
export const SESSION_RESPONSIBILITY_CHANGED_EVENT = 'SessionResponsibilityChanged';

// --------------------------------------------------------------------------
// Small pure helpers (mirrors the Session codec style; no Store access)
// --------------------------------------------------------------------------

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
  if (!isRecord(sessionRef) || sessionRef['projectId'] !== body['projectId']) {
    return 'SessionWorkLinkChanged sessionRef disagrees with the event project';
  }
  if (!isPos(body['sessionRevision'])) {
    return 'SessionWorkLinkChanged sessionRevision must be a positive safe integer';
  }
  if (typeof body['active'] !== 'boolean') return 'SessionWorkLinkChanged active must be a boolean';
  const link = body['link'];
  if (!isRecord(link)) return 'SessionWorkLinkChanged requires a pending link body';
  const linkProblem = checkWorkLinkBody(link, false);
  if (linkProblem !== null) return `SessionWorkLinkChanged link: ${linkProblem}`;
  const ref = link['ref'];
  const refProblem = checkWorkLinkRef(ref);
  if (refProblem !== null) return `SessionWorkLinkChanged link ref: ${refProblem}`;
  if (!isRecord(ref) || ref['projectId'] !== body['projectId'] || !isRecord(sessionRef) ||
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
  if (!isRecord(session)) return 'Session lifecycle event requires the transitioned SessionRecord';
  const sessionProblem = checkSessionBody(session);
  if (sessionProblem !== null) return `Session lifecycle event session: ${sessionProblem}`;
  if (session['lifecycle'] !== lifecycle) {
    return `Session lifecycle event requires lifecycle ${lifecycle}`;
  }
  const ref = session['ref'];
  if (!isRecord(ref) || ref['projectId'] !== body['projectId']) {
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
    if (!isRecord(header) || !hasOnlyKeys(header, ['activeRunId'])
      || !(header['activeRunId'] === null || nonEmpty(header['activeRunId']))) {
      return 'a ready probe carries the Kernel session head {activeRunId}';
    }
  } else if (header !== null) {
    return 'only a ready probe carries the Kernel session head';
  }
  const session = body['session'];
  if (!isRecord(session)) return 'SessionHealthObserved requires the observed SessionRecord';
  const sessionProblem = checkSessionBody(session);
  if (sessionProblem !== null) return `SessionHealthObserved session: ${sessionProblem}`;
  const ref = session['ref'];
  if (!isRecord(ref) || ref['projectId'] !== body['projectId']) {
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
// Slice 1 event bodies (spec §2.9)
// --------------------------------------------------------------------------

const ARCHIVE_CHANGED_EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId',
  'session', 'archiveRequestId', 'reason',
];
const RESPONSIBILITY_CHANGED_EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId',
  'mode', 'source', 'destination', 'closed', 'opened', 'openedBound', 'archiveStep', 'taskBasis',
];
const ARCHIVE_STEP_KINDS: readonly string[] = [
  'stop', 'anchor', 'requeue', 'responsibility', 'reply_handler', 'wait_cancel', 'archive',
];

function checkSlice1Receipt(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['identityKey', 'fingerprint'])
    || !nonEmpty(value['identityKey']) || !nonEmpty(value['fingerprint'])) {
    return 'receipt must be {identityKey,fingerprint}';
  }
  return null;
}
function checkArchiveStep(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['sessionRef', 'archiveRequestId', 'requestReceipt', 'step', 'subjectKey'])) {
    return 'archiveStep carries unknown fields';
  }
  const sessionProblem = checkPlainSessionRef(value['sessionRef']);
  if (sessionProblem !== null) return `archiveStep sessionRef: ${sessionProblem}`;
  if (!nonEmpty(value['archiveRequestId'])) return 'archiveStep archiveRequestId is required';
  const receipt = checkSlice1Receipt(value['requestReceipt']);
  if (receipt !== null) return `archiveStep ${receipt}`;
  if (!ARCHIVE_STEP_KINDS.includes(String(value['step']))) return 'archiveStep step is not recognized';
  if (!nonEmpty(value['subjectKey'])) return 'archiveStep subjectKey is required';
  return null;
}
function checkPlanRef(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'planId'])
    || value['aggregateType'] !== 'PlanRevision' || !nonEmpty(value['projectId']) || !nonEmpty(value['planId'])) {
    return 'planRef must be a complete PlanRevisionRef';
  }
  return null;
}
function checkTaskTriple(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['projectId', 'goalId', 'taskId'])
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])) {
    return 'task must be a complete TaskTriple';
  }
  return null;
}
function checkArchiveChangedBody(body: UnknownRecord, eventType: string): Problem {
  if (!hasOnlyKeys(body, ARCHIVE_CHANGED_EVENT_KEYS)) return 'Session archive event carries unknown fields';
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId'])) {
    return 'Session archive event requires projectId and workspaceId';
  }
  if (!nonEmpty(body['archiveRequestId'])) return 'Session archive event requires an archiveRequestId';
  if (!nonEmpty(body['reason'])) return 'Session archive event requires a reason';
  const session = body['session'];
  if (!isRecord(session)) return 'Session archive event requires the transitioned SessionRecord';
  const sessionProblem = checkSessionBody(session);
  if (sessionProblem !== null) return `Session archive event session: ${sessionProblem}`;
  const ref = session['ref'];
  if (!isRecord(ref) || ref['projectId'] !== body['projectId'] || session['workspaceId'] !== body['workspaceId']) {
    return 'Session archive event Session disagrees with the event scope';
  }
  const request = session['archiveRequest'];
  if (eventType === SESSION_ARCHIVE_REQUESTED_EVENT) {
    if (!isRecord(request) || request['requestId'] !== body['archiveRequestId']) {
      return 'SessionArchiveRequested must carry the recorded archive request';
    }
  } else if (request !== null && request !== undefined) {
    return 'SessionArchiveRequestReleased must carry the cleared Session';
  }
  return null;
}
function checkPendingLink(value: unknown): Problem {
  if (!isRecord(value)) return 'link must be a pending work-link body';
  return checkWorkLinkBody(value, false);
}
function checkResponsibilityChangedBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, RESPONSIBILITY_CHANGED_EVENT_KEYS)) return 'SessionResponsibilityChanged carries unknown fields';
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId'])) {
    return 'SessionResponsibilityChanged requires projectId and workspaceId';
  }
  if (body['mode'] !== 'transfer' && body['mode'] !== 'drop' && body['mode'] !== 'terminal') {
    return 'SessionResponsibilityChanged mode is not recognized';
  }
  const source = body['source'];
  if (!isRecord(source)) return 'SessionResponsibilityChanged requires the source SessionRecord';
  const sourceProblem = checkSessionBody(source);
  if (sourceProblem !== null) return `SessionResponsibilityChanged source: ${sourceProblem}`;
  const sourceRef = source['ref'];
  if (!isRecord(sourceRef) || sourceRef['projectId'] !== body['projectId'] || source['workspaceId'] !== body['workspaceId']) {
    return 'SessionResponsibilityChanged source disagrees with the event scope';
  }
  const destination = body['destination'];
  if (destination !== null) {
    if (!isRecord(destination)) return 'SessionResponsibilityChanged destination must be a SessionRecord or null';
    const destinationProblem = checkSessionBody(destination);
    if (destinationProblem !== null) return `SessionResponsibilityChanged destination: ${destinationProblem}`;
    const destinationRef = destination['ref'];
    if (!isRecord(destinationRef) || destinationRef['projectId'] !== body['projectId']
      || destination['workspaceId'] !== body['workspaceId']) {
      return 'SessionResponsibilityChanged destination disagrees with the event scope';
    }
    if (body['mode'] === 'terminal') return 'a terminal responsibility change has no destination';
  } else if (body['mode'] === 'transfer') {
    return 'a transfer responsibility change requires a destination';
  }
  const closed = checkPendingLink(body['closed']);
  if (closed !== null) return `SessionResponsibilityChanged closed: ${closed}`;
  if (body['opened'] !== null) {
    const opened = checkPendingLink(body['opened']);
    if (opened !== null) return `SessionResponsibilityChanged opened: ${opened}`;
  }
  if (body['openedBound'] !== null && body['openedBound'] !== 'since') {
    return 'SessionResponsibilityChanged openedBound must be since or null';
  }
  if (body['archiveStep'] !== null) {
    const step = checkArchiveStep(body['archiveStep']);
    if (step !== null) return `SessionResponsibilityChanged archiveStep: ${step}`;
  }
  const taskBasis = body['taskBasis'];
  if (!isRecord(taskBasis) || !hasOnlyKeys(taskBasis, ['task', 'planRef', 'terminalCause', 'finishedAt'])) {
    return 'SessionResponsibilityChanged taskBasis carries unknown fields';
  }
  const task = checkTaskTriple(taskBasis['task']);
  if (task !== null) return `SessionResponsibilityChanged taskBasis task: ${task}`;
  const plan = checkPlanRef(taskBasis['planRef']);
  if (plan !== null) return `SessionResponsibilityChanged taskBasis planRef: ${plan}`;
  const cause = taskBasis['terminalCause'];
  if (cause !== null && cause !== 'satisfied' && cause !== 'cancelled' && cause !== 'superseded') {
    return 'SessionResponsibilityChanged taskBasis terminalCause is not recognized';
  }
  if (!(taskBasis['finishedAt'] === null || nonEmpty(taskBasis['finishedAt']))) {
    return 'SessionResponsibilityChanged taskBasis finishedAt must be null or a string';
  }
  if (body['mode'] === 'terminal' && cause === null) {
    return 'a terminal responsibility change requires a terminal cause';
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
    {
      eventType: SESSION_ARCHIVE_REQUESTED_EVENT,
      schemaVersion: SESSION_LIFECYCLE_EVENT_VERSION,
      validate: (event) => validateEventBody(event, SESSION_ARCHIVE_REQUESTED_EVENT,
        (body) => checkArchiveChangedBody(body, SESSION_ARCHIVE_REQUESTED_EVENT)),
    },
    {
      eventType: SESSION_ARCHIVE_REQUEST_RELEASED_EVENT,
      schemaVersion: SESSION_LIFECYCLE_EVENT_VERSION,
      validate: (event) => validateEventBody(event, SESSION_ARCHIVE_REQUEST_RELEASED_EVENT,
        (body) => checkArchiveChangedBody(body, SESSION_ARCHIVE_REQUEST_RELEASED_EVENT)),
    },
    {
      eventType: SESSION_RESPONSIBILITY_CHANGED_EVENT,
      schemaVersion: SESSION_LIFECYCLE_EVENT_VERSION,
      validate: (event) => validateEventBody(event, SESSION_RESPONSIBILITY_CHANGED_EVENT, checkResponsibilityChangedBody),
    },
  ],
  lookups: [],
};

// --------------------------------------------------------------------------
// Encode
// --------------------------------------------------------------------------

export function encodeSessionWorkLinkChangedEvent(event: SessionWorkLinkChangedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

export function encodeSessionLifecycleChangedEvent(event: SessionLifecycleChangedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

export function encodeSessionHealthObservedEvent(event: SessionHealthObservedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

export function encodeSessionArchiveChangedEvent(event: SessionArchiveChangedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

export function encodeSessionResponsibilityChangedEvent(event: SessionResponsibilityChangedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
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

export function sessionArchiveChangedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<SessionArchiveChangedEventV1> {
  if (event.eventType !== SESSION_ARCHIVE_REQUESTED_EVENT && event.eventType !== SESSION_ARCHIVE_REQUEST_RELEASED_EVENT) {
    return invalid(`expected a Session archive event, got ${event.eventType}`);
  }
  const eventType = event.eventType;
  const checked = validateEventBody(event, eventType, (body) => checkArchiveChangedBody(body, eventType));
  if (checked.status !== 'decoded') return checked;
  const body = parseObject(event.json);
  if (body === null) return invalid(`${eventType} event json is not an object`);
  return { status: 'decoded', value: body as unknown as SessionArchiveChangedEventV1 };
}

export function sessionResponsibilityChangedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<SessionResponsibilityChangedEventV1> {
  const checked = validateEventBody(event, SESSION_RESPONSIBILITY_CHANGED_EVENT, checkResponsibilityChangedBody);
  if (checked.status !== 'decoded') return checked;
  const body = parseObject(event.json);
  if (body === null) return invalid('SessionResponsibilityChanged event json is not an object');
  return { status: 'decoded', value: body as unknown as SessionResponsibilityChangedEventV1 };
}
