/**
 * C1 SessionMessage record/event codecs and lookup declarations.
 *
 * The WorkGraph owns this closed schemaId list; the RecordStore only selects a
 * codec from the aggregateType of the full ref and applies mechanical CAS,
 * claims, cursor binding and one transaction. This file performs no I/O, no
 * admission, no fold and no transaction.
 *
 * Frozen rules enforced here:
 *   - `SessionMessage@1` has the FULL `SessionMessageRef` as its canonical key
 *     and its body revision must equal the encoded record revision. Text is
 *     never inlined: only the body `ArtifactRef` is persisted.
 *   - `SessionMessageSent@1` / `SessionMessageRead@1` /
 *     `SessionMessageResponded@1` save the complete returned message metadata
 *     plus the real command actor/identity, so an idempotent replay can restore
 *     the ORIGINAL receipt through `eventAt` without re-deriving current state.
 *   - the two recipient lookup indexes are registered with the record codec;
 *     no hand-written SQL table or second index exists.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { RoleBindingRefV1, RunRef, SourceRefV1 } from '../../../contracts/dispatch.js';
import type { QueryJobAnswerRef, QueryRunRef } from '../../../contracts/query-job.js';
import type { RecordLookupIndex } from '../../record-store/lookup-ports.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import { isJsonObject, isNonEmptyString, parseJsonObject } from '../../record-store/record-codec.js';
import { checkArtifactRef, checkPlainSessionRef } from '../sessions/session-record-codecs.js';
import type { MessageQueryAnswerSender, MessageSender, SessionMessage } from './contracts.js';

/** Encoding selector for the persisted message record. */
export const SESSION_MESSAGE_SCHEMA_ID = 'SessionMessage@1';

/** Replay event selectors. Each event restores its original receipt. */
export const SESSION_MESSAGE_SENT_EVENT_TYPE = 'SessionMessageSent';
export const SESSION_MESSAGE_READ_EVENT_TYPE = 'SessionMessageRead';
export const SESSION_MESSAGE_RESPONDED_EVENT_TYPE = 'SessionMessageResponded';
export const SESSION_MESSAGE_DERIVATION_EVENT_TYPE = 'SessionMessageConsultationDerived';
export const SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE = 'SessionMessageInputAccepted';
export const SESSION_MESSAGE_EVENT_SCHEMA_VERSION = 1;

/** Registered lookup index names (`core/record-store/lookup-ports.ts`). */
export const SESSION_MESSAGE_BY_RECIPIENT_LOOKUP = 'session-message-by-recipient';
export const SESSION_MESSAGE_BY_RECIPIENT_STATUS_LOOKUP = 'session-message-by-recipient-status';
/** The sender Work Run outbox index: complete scope + the nested RunRef. A host
 * sender has no `sender.runRef`, so its missing scalar paths are null and never
 * become a candidate of a concrete Run query. */
export const SESSION_MESSAGE_BY_SENDER_RUN_LOOKUP = 'session-message-by-sender-run';
export const SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP = 'session-message-by-sender-session';

/**
 * Fixed body contentType for the canonical JSON envelope:
 * `{schemaVersion:1, projectId, workspaceId, messageId, part, sender, text}`.
 * `scope+messageId+part` prevents independent messages from wrongly sharing
 * the first provenance record.
 */
export const SESSION_MESSAGE_CONTENT_TYPE = 'application/vnd.coding-platform.session-message+json';

/** Non-empty UTF-8 text, at most 16 KiB. Over-bound input returns `capacity`. */
export const SESSION_MESSAGE_MAX_TEXT_BYTES = 16 * 1024;

/** One recipient and one recipient+status candidate index (frozen paths). */
export const SESSION_MESSAGE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  { name: SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP, aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'sender.sessionRef.sessionId'] },
  {
    name: SESSION_MESSAGE_BY_RECIPIENT_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'recipient.sessionId'],
  },
  {
    name: SESSION_MESSAGE_BY_RECIPIENT_STATUS_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'recipient.sessionId', 'status'],
  },
  {
    name: SESSION_MESSAGE_BY_SENDER_RUN_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'sender.runRef.goalId', 'sender.runRef.runId'],
  },
];

// --------------------------------------------------------------------------
// Event bodies (stable replay carriers)
// --------------------------------------------------------------------------

type SentEventBase = {
  eventId: string;
  schemaVersion: 1;
  occurredAt: string;
  projectId: string;
  workspaceId: string;
  requestId: string;
  actor: MessageSender;
  message: SessionMessage;
};

export type SessionMessageSentEventV1 = SentEventBase & { eventType: 'SessionMessageSent' };
export type SessionMessageReadEventV1 = SentEventBase & { eventType: 'SessionMessageRead' };
export type SessionMessageConsultationDerivedEventV1 = SentEventBase & { eventType: 'SessionMessageConsultationDerived' };
export type SessionMessageInputAcceptedEventV1 = SentEventBase & { eventType: 'SessionMessageInputAccepted' };
export type SessionMessageRespondedEventV1 = Omit<SentEventBase, 'actor'> & {
  eventType: 'SessionMessageResponded';
  /** The formal responder identity: a work_run or a derived query_run Answer. */
  actor: MessageSender | MessageQueryAnswerSender;
};
export type SessionMessageEventV1 =
  | SessionMessageSentEventV1
  | SessionMessageReadEventV1
  | SessionMessageRespondedEventV1
  | SessionMessageConsultationDerivedEventV1
  | SessionMessageInputAcceptedEventV1;

// --------------------------------------------------------------------------
// Pure shape helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;
/** `null` = the check passed; a string is the precise rejection reason. */
export type Problem = string | null;

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
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

const SOURCE_KINDS: readonly string[] = ['plan-revision', 'workspace', 'governance', 'artifact', 'memory'];

export function checkSessionMessageRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'messageId'])) {
    return 'message ref must be a complete SessionMessageRef';
  }
  if (value['aggregateType'] !== 'SessionMessage' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['messageId'])) {
    return 'message ref is not a valid SessionMessageRef';
  }
  return null;
}

export function checkSourceRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['kind', 'refId', 'revision', 'digest'])) {
    return 'message source carries unknown fields';
  }
  if (!SOURCE_KINDS.includes(String(value['kind']))) return 'message source kind is not recognized';
  if (!nonEmpty(value['refId']) || !nonEmpty(value['revision'])) return 'message source requires refId and revision';
  if (value['digest'] !== undefined && !nonEmpty(value['digest'])) {
    return 'message source digest must be a non-empty string when present';
  }
  return null;
}

export function checkRoleBindingRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value,
    ['schemaVersion', 'bindingId', 'templateId', 'templateRevision', 'bindingVersion', 'policyRevision'])) {
    return 'role binding carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'role binding schemaVersion must be 1';
  if (!nonEmpty(value['bindingId']) || !nonEmpty(value['templateId']) || !nonEmpty(value['templateRevision'])
    || !isPositiveInt(value['bindingVersion']) || !nonEmpty(value['policyRevision'])) {
    return 'role binding is incomplete';
  }
  return null;
}

function checkRunRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])) {
    return 'message sender run ref carries unknown fields';
  }
  if (value['aggregateType'] !== 'Run' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'message sender run ref is not a valid RunRef';
  }
  return null;
}

export function checkMessageSender(value: unknown): Problem {
  if (!isObject(value)) return 'message sender must be an object';
  if (value['kind'] === 'host') {
    if (!hasOnlyKeys(value, ['kind', 'actor'])) return 'host sender carries unknown fields';
    const actor = value['actor'];
    if (!isObject(actor) || !hasOnlyKeys(actor, ['kind', 'id'])) return 'host sender actor carries unknown fields';
    if ((actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
      return 'host sender actor must be a real human/system identity';
    }
    return null;
  }
  if (value['kind'] === 'work_run') {
    if (!hasOnlyKeys(value, ['kind', 'sessionRef', 'runRef', 'roleBinding', 'generation'])) {
      return 'work_run sender carries unknown fields';
    }
    const session = checkPlainSessionRef(value['sessionRef']);
    if (session !== null) return `work_run sender session: ${session}`;
    const run = checkRunRef(value['runRef']);
    if (run !== null) return `work_run sender run: ${run}`;
    const binding = checkRoleBindingRef(value['roleBinding']);
    if (binding !== null) return `work_run sender role: ${binding}`;
    if (!isPositiveInt(value['generation'])) return 'work_run sender generation must be a positive integer';
    return null;
  }
  return 'message sender kind must be host or work_run';
}

function checkQueryRunRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value,
    ['aggregateType', 'projectId', 'workspaceId', 'queryJobId', 'runId'])) {
    return 'query_run sender run ref carries unknown fields';
  }
  if (value['aggregateType'] !== 'QueryRun' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['queryJobId']) || !nonEmpty(value['runId'])) {
    return 'query_run sender run ref is not a valid QueryRunRef';
  }
  return null;
}

function checkQueryAnswerRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value,
    ['aggregateType', 'projectId', 'workspaceId', 'queryJobId', 'answerId'])) {
    return 'query_run sender answer ref carries unknown fields';
  }
  if (value['aggregateType'] !== 'QueryJobAnswer' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['queryJobId']) || !nonEmpty(value['answerId'])) {
    return 'query_run sender answer ref is not a valid QueryJobAnswerRef';
  }
  return null;
}

/** The derived formal Query Answer sender. It is never a caller-supplied text
 * author: every identity field is a persisted Query fact. */
export function checkQueryAnswerSender(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value,
    ['kind', 'sessionRef', 'queryRunRef', 'answerRef', 'generation'])) {
    return 'query_run sender carries unknown fields';
  }
  if (value['kind'] !== 'query_run') return 'query_run sender kind must be query_run';
  const session = checkPlainSessionRef(value['sessionRef']);
  if (session !== null) return `query_run sender session: ${session}`;
  const run = checkQueryRunRef(value['queryRunRef']);
  if (run !== null) return `query_run sender run: ${run}`;
  const answer = checkQueryAnswerRef(value['answerRef']);
  if (answer !== null) return `query_run sender answer: ${answer}`;
  if (!isPositiveInt(value['generation'])) return 'query_run sender generation must be a positive integer';
  return null;
}

/** A response slot accepts the original work_run reply or the derived
 * query_run Answer reply. The message `sender` itself stays host/work_run. */
export function checkResponseSender(value: unknown): Problem {
  if (!isObject(value)) return 'message response sender must be an object';
  if (value['kind'] === 'query_run') return checkQueryAnswerSender(value);
  const workRun = checkMessageSender(value);
  if (workRun !== null) return workRun;
  if (value['kind'] !== 'work_run') return 'message response sender must be a work_run or query_run sender';
  return null;
}

function checkMessageResponse(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['sender', 'bodyRef', 'sourceRef', 'respondedAt'])) {
    return 'message response carries unknown fields';
  }
  const sender = checkResponseSender(value['sender']);
  if (sender !== null) return `message response sender: ${sender}`;
  const body = checkArtifactRef(value['bodyRef']);
  if (body !== null) return `message response body: ${body}`;
  const source = checkSourceRef(value['sourceRef']);
  if (source !== null) return `message response source: ${source}`;
  if (!nonEmpty(value['respondedAt'])) return 'message response requires respondedAt';
  return null;
}

const MESSAGE_KEYS: readonly string[] = [
  'ref', 'schemaVersion', 'revision', 'sender', 'recipient', 'bodyRef', 'sourceRef',
  'createdAt', 'status', 'readAt', 'response', 'replyMode',
  'intent', 'needsReply', 'waitAfterSend', 'consultationDerivation', 'acceptedInputs',
];

export function checkSessionMessageBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, MESSAGE_KEYS)) return 'SessionMessage record carries unknown fields';
  const ref = checkSessionMessageRef(body['ref']);
  if (ref !== null) return ref;
  if (body['schemaVersion'] !== 1) return 'SessionMessage schemaVersion must be 1';
  if (!isPositiveInt(body['revision'])) return 'SessionMessage revision must be a positive integer';
  const sender = checkMessageSender(body['sender']);
  if (sender !== null) return `SessionMessage sender: ${sender}`;
  const recipient = checkPlainSessionRef(body['recipient']);
  if (recipient !== null) return `SessionMessage recipient: ${recipient}`;
  const bodyRef = checkArtifactRef(body['bodyRef']);
  if (bodyRef !== null) return `SessionMessage body: ${bodyRef}`;
  const source = checkSourceRef(body['sourceRef']);
  if (source !== null) return `SessionMessage source: ${source}`;
  if (!nonEmpty(body['createdAt'])) return 'SessionMessage requires createdAt';
  const status = body['status'];
  if (status !== 'pending' && status !== 'read' && status !== 'responded') {
    return 'SessionMessage status is not recognized';
  }
  const readAt = body['readAt'];
  if (!(readAt === null || nonEmpty(readAt))) return 'SessionMessage readAt must be null or a non-empty string';
  const replyMode = body['replyMode'];
  if (replyMode !== undefined && replyMode !== 'wait') return 'SessionMessage replyMode must be omitted or wait';
  const intent = body['intent'];
  if (intent !== undefined && intent !== 'notify' && intent !== 'inquiry' && intent !== 'action_request') {
    return 'SessionMessage intent is not recognized';
  }
  if (body['needsReply'] !== undefined && typeof body['needsReply'] !== 'boolean') return 'SessionMessage needsReply must be boolean';
  if (body['waitAfterSend'] !== undefined && typeof body['waitAfterSend'] !== 'boolean') return 'SessionMessage waitAfterSend must be boolean';
  if (body['waitAfterSend'] === true && body['needsReply'] === false) {
    return 'SessionMessage waitAfterSend cannot be set while needsReply is false';
  }
  const acceptedInputs = body['acceptedInputs'];
  if (acceptedInputs !== undefined) {
    if (!Array.isArray(acceptedInputs)) return 'SessionMessage acceptedInputs must be an array';
    for (const entry of acceptedInputs) {
      if (!isObject(entry) || !hasOnlyKeys(entry, ['inputId', 'part', 'executionRef', 'kernel', 'acceptedAt'])) {
        return 'SessionMessage acceptedInputs entry carries unknown fields';
      }
      if (!nonEmpty(entry['inputId']) || (entry['part'] !== 'message' && entry['part'] !== 'response')) {
        return 'SessionMessage acceptedInputs entry identity is invalid';
      }
      const executionRef = entry['executionRef'];
      if (!isObject(executionRef) || !['Run', 'QueryRun'].includes(String(executionRef['aggregateType']))) {
        return 'SessionMessage acceptedInputs executionRef must be a RunRef or QueryRunRef';
      }
      const kernel = entry['kernel'];
      if (!isObject(kernel) || !hasOnlyKeys(kernel, ['adapterId', 'kernelSessionId', 'runId', 'turnId', 'position'])
        || !nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId']) || !nonEmpty(kernel['runId'])
        || !nonEmpty(kernel['turnId']) || !isPositiveInt(kernel['position'])) {
        return 'SessionMessage acceptedInputs kernel identity is incomplete';
      }
      if (!nonEmpty(entry['acceptedAt'])) return 'SessionMessage acceptedInputs acceptedAt is required';
    }
  }
  const derivation = body['consultationDerivation'];
  if (derivation !== undefined) {
    if (!isObject(derivation)
      || !hasOnlyKeys(derivation, ['childSessionRef', 'sourceSessionRef', 'sourceKernel', 'throughPosition'])) {
      return 'SessionMessage consultationDerivation carries unknown fields';
    }
    const child = derivation['childSessionRef'];
    const source = derivation['sourceSessionRef'];
    if (checkPlainSessionRef(child) !== null || checkPlainSessionRef(source) !== null) {
      return 'SessionMessage consultationDerivation Session refs are incomplete';
    }
    const kernel = derivation['sourceKernel'];
    if (!isObject(kernel) || !hasOnlyKeys(kernel, ['adapterId', 'kernelSessionId'])
      || !nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId'])) {
      return 'SessionMessage consultationDerivation sourceKernel is incomplete';
    }
    const through = derivation['throughPosition'];
    if (!(through === null || (typeof through === 'number' && Number.isSafeInteger(through) && through >= 1))) {
      return 'SessionMessage consultationDerivation throughPosition is invalid';
    }
  }
  const response = body['response'];
  if (response !== null) {
    const responseProblem = checkMessageResponse(response);
    if (responseProblem !== null) return `SessionMessage response: ${responseProblem}`;
  }
  // The status/readAt/response triple is monotone and consistent.
  if (status === 'pending' && (readAt !== null || response !== null)) {
    return 'a pending message must be unread and unanswered';
  }
  if (status === 'read' && (readAt === null || response !== null)) {
    return 'a read message must carry readAt and no response';
  }
  if (status === 'responded' && response === null) {
    return 'a responded message must carry a response';
  }
  if (isObject(body['ref']) && isObject(body['recipient'])
    && body['recipient']['projectId'] !== body['ref']['projectId']) {
    return 'SessionMessage recipient belongs to another project';
  }
  return null;
}

const EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'requestId', 'actor', 'message',
];

function checkEventBody(body: UnknownRecord, eventType: string): Problem {
  if (!hasOnlyKeys(body, EVENT_KEYS)) return `${eventType} carries unknown fields`;
  if (body['eventType'] !== eventType) return `${eventType} eventType disagrees with the envelope`;
  if (body['schemaVersion'] !== SESSION_MESSAGE_EVENT_SCHEMA_VERSION) {
    return `${eventType} schemaVersion must be ${SESSION_MESSAGE_EVENT_SCHEMA_VERSION}`;
  }
  if (!nonEmpty(body['eventId']) || !nonEmpty(body['occurredAt'])) return `${eventType} envelope is incomplete`;
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId']) || !nonEmpty(body['requestId'])) {
    return `${eventType} requires projectId, workspaceId and requestId`;
  }
  const actor = eventType === SESSION_MESSAGE_RESPONDED_EVENT_TYPE
    ? checkResponseSender(body['actor'])
    : checkMessageSender(body['actor']);
  if (actor !== null) return `${eventType} actor: ${actor}`;
  const message = body['message'];
  if (!isObject(message)) return `${eventType} requires the complete message`;
  const messageProblem = checkSessionMessageBody(message);
  if (messageProblem !== null) return `${eventType} message: ${messageProblem}`;
  if (!isObject(message['ref'])) return `${eventType} message ref is invalid`;
  if (message['ref']['projectId'] !== body['projectId'] || message['ref']['workspaceId'] !== body['workspaceId']) {
    return `${eventType} message scope disagrees with the event scope`;
  }
  if (eventType === SESSION_MESSAGE_SENT_EVENT_TYPE
    && canonicalOf(body['actor']) !== canonicalOf(message['sender'])) {
    return 'SessionMessageSent actor must be the message sender';
  }
  if (eventType === SESSION_MESSAGE_READ_EVENT_TYPE
    && (!isObject(body['actor']) || body['actor']['kind'] !== 'work_run')) {
    return `${eventType} actor must be the formal work_run command identity`;
  }
  if (eventType === SESSION_MESSAGE_DERIVATION_EVENT_TYPE
    && (!isObject(body['actor']) || body['actor']['kind'] !== 'host')) {
    return `${eventType} actor must be the trusted Host identity`;
  }
  if (eventType === SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE
    && (!isObject(body['actor']) || (body['actor']['kind'] !== 'work_run' && body['actor']['kind'] !== 'host'))) {
    return `${eventType} actor must be the observing Host or executing work_run identity`;
  }
  if (eventType === SESSION_MESSAGE_RESPONDED_EVENT_TYPE
    && (!isObject(body['actor']) || (body['actor']['kind'] !== 'work_run' && body['actor']['kind'] !== 'query_run'))) {
    return `${eventType} actor must be the formal work_run or query_run command identity`;
  }
  return null;
}

// --------------------------------------------------------------------------
// Registered validators
// --------------------------------------------------------------------------

function validateRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== SESSION_MESSAGE_SCHEMA_ID) {
    return invalid(`expected schemaId ${SESSION_MESSAGE_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json);
  if (parsed.status === 'invalid') return invalid(`SessionMessage record json is not an object: ${parsed.reason}`);
  const body = parsed.value;
  if (!isObject(body['ref']) || !isPositiveInt(body['revision']) || body['revision'] !== record.revision) {
    return invalid('SessionMessage record envelope is invalid');
  }
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) {
    return invalid('SessionMessage refKey disagrees with the record body');
  }
  const problem = checkSessionMessageBody(body);
  if (problem !== null) return invalid(`SessionMessage record payload is invalid: ${problem}`);
  return { status: 'decoded', value: record };
}

function validateEvent(event: EncodedDomainEvent, eventType: string): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== eventType) return invalid(`expected eventType ${eventType}, got ${event.eventType}`);
  if (event.schemaVersion !== SESSION_MESSAGE_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${SESSION_MESSAGE_EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return invalid(`${eventType} envelope is incomplete`);
  const parsed = parseJsonObject(event.json);
  if (parsed.status === 'invalid') return invalid(`${eventType} event json is not an object: ${parsed.reason}`);
  const body = parsed.value;
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType
    || body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return invalid(`${eventType} event envelope disagrees with the event json`);
  }
  const problem = checkEventBody(body, eventType);
  if (problem !== null) return invalid(`${eventType} event payload is invalid: ${problem}`);
  return { status: 'decoded', value: event };
}

// --------------------------------------------------------------------------
// The single registration
// --------------------------------------------------------------------------

export const SESSION_MESSAGE_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    {
      aggregateType: 'SessionMessage',
      schemaId: SESSION_MESSAGE_SCHEMA_ID,
      validate: validateRecord,
    },
  ],
  events: [
    { eventType: SESSION_MESSAGE_SENT_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_SENT_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_READ_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_READ_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_RESPONDED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_RESPONDED_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_DERIVATION_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_DERIVATION_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE) },
  ],
  lookups: SESSION_MESSAGE_LOOKUP_INDEXES,
};

// --------------------------------------------------------------------------
// Canonical keys and encode helpers
// --------------------------------------------------------------------------

/** Full canonical key of a SessionMessage aggregate (never a bare messageId). */
export function sessionMessageRefKey(ref: SessionMessageRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

export function encodeSessionMessageRecord(message: SessionMessage): EncodedRecord {
  return {
    refKey: sessionMessageRefKey(message.ref),
    schemaId: SESSION_MESSAGE_SCHEMA_ID,
    revision: message.revision,
    json: JSON.stringify(message),
  };
}

function encodeMessageEvent(event: SessionMessageEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

export function encodeSessionMessageSentEvent(event: SessionMessageSentEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageReadEvent(event: SessionMessageReadEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageRespondedEvent(event: SessionMessageRespondedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageConsultationDerivedEvent(event: SessionMessageConsultationDerivedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageInputAcceptedEvent(event: SessionMessageInputAcceptedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}

// --------------------------------------------------------------------------
// Typed decoders (read/replay path)
// --------------------------------------------------------------------------

export function decodeSessionMessageRecord(record: EncodedRecord): DecodeResult<SessionMessage> {
  const checked = validateRecord(record);
  if (checked.status !== 'decoded') return checked;
  const parsed = parseJsonObject(record.json);
  if (parsed.status === 'invalid') return invalid('SessionMessage record json is not an object');
  return { status: 'decoded', value: parsed.value as unknown as SessionMessage };
}

/**
 * Restores the ORIGINAL message of a recorded send/read/respond event. This is
 * the only source a replay may use; it never re-derives current state.
 */
export function sessionMessageFromEvent(event: EncodedDomainEvent): DecodeResult<SessionMessage> {
  const eventType = event.eventType;
  if (eventType !== SESSION_MESSAGE_SENT_EVENT_TYPE && eventType !== SESSION_MESSAGE_READ_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_RESPONDED_EVENT_TYPE && eventType !== SESSION_MESSAGE_DERIVATION_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE) {
    return invalid(`eventType ${String(eventType)} is not a SessionMessage event`);
  }
  const checked = validateEvent(event, eventType);
  if (checked.status !== 'decoded') return checked;
  const parsed = parseJsonObject(event.json);
  if (parsed.status === 'invalid') return invalid(`${eventType} event json is not an object`);
  return { status: 'decoded', value: parsed.value['message'] as unknown as SessionMessage };
}

