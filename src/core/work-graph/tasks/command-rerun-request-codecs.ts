/**
 * K3 L19a / spec §3.2b: the `CommandRerunRequest` aggregate's only record codec,
 * its replay event and its three lookup indexes.
 *
 * Mirrors `unknown-call-review-codecs.ts`: the strict snapshot decoder refuses a
 * record with an unknown field, an out-of-range value or a disagreeing identity
 * (every read fails closed), and the replay event carries the whole post-change
 * record. The immutable record is written only through `state/`.
 *
 * The two answer-identity helpers are exported here (not copied into the answer
 * reader/start-up) so the request owner, the answer reader and start-up derive
 * one identity: `commandRerunRequestAnswerIdentity` is the SAME pair
 * `applyAnswer` commits under.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type {
  CommandRerunRequestRef, CommandRerunRequestStateV1, CommandRerunRequestV1,
} from '../../../contracts/command-rerun-request.js';
import type {
  DecisionChangeProofV1, DecisionSelectionV1, DecisionSourceV1,
} from '../../../contracts/goal-decisions.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  K3_CRR_BY_GOAL_STATE_INDEX, K3_CRR_BY_TASK_ALIAS_INDEX, K3_CRR_BY_TASK_INDEX,
} from '../../../contracts/command-rerun-request.js';
import {
  canonicalOf, codePoints, hasOnlyKeys, inList, invalid, isObject, isPos, isSha256Hex,
  nonEmpty, parseObject, utf8Bytes, type UnknownRecord,
} from './codec-fields.js';
import { runRefProblem, sessionMessageRefProblem, taskTripleProblem } from './codec-shape-checks.js';
import { nestedSourceObject, parseDecisionSourceKey } from './decision-source-identity.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import { encodeEventEnvelope } from '../persistence/event-envelope.js';
import type { CommandRerunRequestChangeV1 } from '../state/command-rerun-request.js';

export const COMMAND_RERUN_REQUEST_SCHEMA_ID = 'CommandRerunRequest@1';
export const COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE = 'CommandRerunRequestChanged';
export const COMMAND_RERUN_REQUEST_EVENT_SCHEMA_VERSION = 1;
// The three index names come from the aggregate contract.
export const K3_CRR_BY_TASK_ALIAS_LOOKUP = K3_CRR_BY_TASK_ALIAS_INDEX;
export const K3_CRR_BY_GOAL_STATE_LOOKUP = K3_CRR_BY_GOAL_STATE_INDEX;
export const K3_CRR_BY_TASK_LOOKUP = K3_CRR_BY_TASK_INDEX;

const CHANGE_KINDS: readonly CommandRerunRequestChangeV1[] = [
  'created', 'allowed', 'used', 'denied', 'denied_final', 'closed', 'forms_added',
];
/** Lead ruling 2: the proof rides on the three card-application changes; it is absent on the rest. */
const PROOF_CHANGES: readonly CommandRerunRequestChangeV1[] = ['allowed', 'denied', 'denied_final'];
const STATES: readonly CommandRerunRequestStateV1[] = [
  'pending', 'allowed', 'used', 'denied', 'denied_final', 'closed',
];
const MATCH_KINDS = ['exact', 'action', 'declared'] as const;
const MAX_ALIAS = 32;
const MAX_COMMAND_BYTES = 4_000;
const MAX_REASON_CODE_POINTS = 2_000;
const MAX_FORMS = 8;
const MAX_FORM_TEXT_BYTES = 512;

// --------------------------------------------------------------------------
// Shared sub-shape validators
// --------------------------------------------------------------------------

function commandRerunRequestRefProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value,
    ['aggregateType', 'projectId', 'goalId', 'taskId', 'requestId'])) {
    return 'ref must be a complete CommandRerunRequestRef';
  }
  if (value['aggregateType'] !== 'CommandRerunRequest'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId'])
    || !nonEmpty(value['taskId']) || !nonEmpty(value['requestId'])) {
    return 'ref must be a complete CommandRerunRequestRef';
  }
  return null;
}
function unknownCallReviewRefProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || value['aggregateType'] !== 'UnknownCallReview'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'reviewRef must be a complete UnknownCallReviewRef';
  }
  return null;
}
function actionProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['text', 'sha256'])
    || !nonEmpty(value['text']) || !isSha256Hex(value['sha256'])) {
    return `${label} must be { text, sha256 }`;
  }
  return null;
}
function matchProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['kind', 'action', 'viaScript'])
    || !inList(value['kind'], MATCH_KINDS)) {
    return 'match.kind is not recognized';
  }
  if (value['action'] !== undefined) {
    const action = actionProblem(value['action'], 'match.action');
    if (action !== null) return action;
  }
  if (value['viaScript'] !== undefined) {
    const via = value['viaScript'];
    if (!isObject(via) || !hasOnlyKeys(via, ['scriptName', 'dir'])
      || !nonEmpty(via['scriptName']) || !nonEmpty(via['dir'])) {
      return 'match.viaScript must be { scriptName, dir }';
    }
  }
  return null;
}
function declaredFormProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['sha256', 'text'])
    || !isSha256Hex(value['sha256'])) {
    return `${label} must be { sha256, text }`;
  }
  if (typeof value['text'] !== 'string' || value['text'].length === 0
    || utf8Bytes(value['text']) > MAX_FORM_TEXT_BYTES) {
    return `${label}.text must be 1..${String(MAX_FORM_TEXT_BYTES)} UTF-8 bytes`;
  }
  return null;
}
function usedByProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['runId', 'callId'])
    || !nonEmpty(value['runId']) || !nonEmpty(value['callId'])) {
    return 'usedBy must be { runId, callId }';
  }
  return null;
}

const REQUEST_BODY_KEYS: readonly string[] = [
  'ref', 'schemaVersion', 'revision', 'workspaceId', 'task', 'reviewRef', 'runRef', 'alias',
  'command', 'commandSha256', 'declared', 'declaredForms', 'match', 'reason', 'state',
  'answerMessageRef', 'allowedAt', 'usedAt', 'usedBy', 'createdAt', 'updatedAt',
];

/** The strict snapshot body check shared by the record and the replay event's `request`. */
export function commandRerunRequestBodyProblem(value: unknown): string | null {
  if (!isObject(value)) return 'the request record must be an object';
  if (!hasOnlyKeys(value, REQUEST_BODY_KEYS)) return 'the request record carries unknown fields';
  const ref = commandRerunRequestRefProblem(value['ref']);
  if (ref !== null) return ref;
  const body = value as UnknownRecord;
  const refValue = body['ref'] as UnknownRecord;
  if (body['schemaVersion'] !== 1) return 'request schemaVersion must be 1';
  if (!isPos(body['revision'])) return 'request revision must be a positive integer';
  if (!nonEmpty(body['workspaceId'])) return 'request workspaceId must be a non-empty string';
  const task = taskTripleProblem(body['task'], 'task');
  if (task !== null) return task;
  const review = unknownCallReviewRefProblem(body['reviewRef']);
  if (review !== null) return review;
  const run = runRefProblem(body['runRef'], 'request runRef');
  if (run !== null) return run;
  if (!isPos(body['alias']) || body['alias'] > MAX_ALIAS) {
    return `request alias must be an integer between 1 and ${String(MAX_ALIAS)}`;
  }
  if (typeof body['command'] !== 'string') return 'request command must be a string';
  const commandBytes = utf8Bytes(body['command'] as string);
  if (commandBytes < 1 || commandBytes > MAX_COMMAND_BYTES) {
    return `request command must be 1..${String(MAX_COMMAND_BYTES)} UTF-8 bytes`;
  }
  if (!isSha256Hex(body['commandSha256'])) return 'request commandSha256 must be a lowercase sha256 hex';
  if (typeof body['declared'] !== 'boolean') return 'request declared must be a boolean';
  const forms = body['declaredForms'];
  if (!Array.isArray(forms) || forms.length > MAX_FORMS) {
    return `request declaredForms must hold at most ${String(MAX_FORMS)} entries`;
  }
  for (const [index, form] of forms.entries()) {
    const formProblem = declaredFormProblem(form, `request declaredForms[${String(index)}]`);
    if (formProblem !== null) return formProblem;
  }
  const match = matchProblem(body['match']);
  if (match !== null) return match;
  if (typeof body['reason'] !== 'string' || codePoints(body['reason']) < 1
    || codePoints(body['reason']) > MAX_REASON_CODE_POINTS) {
    return `request reason must be 1..${String(MAX_REASON_CODE_POINTS)} code points`;
  }
  if (!inList(body['state'], STATES)) return 'request state is not recognized';
  if (!(body['answerMessageRef'] === null
    || sessionMessageRefProblem(body['answerMessageRef'], 'request answerMessageRef') === null)) {
    return 'request answerMessageRef must be null or a complete SessionMessageRef';
  }
  if (!(body['allowedAt'] === null || nonEmpty(body['allowedAt']))) {
    return 'request allowedAt must be null or a non-empty timestamp';
  }
  if (!(body['usedAt'] === null || nonEmpty(body['usedAt']))) {
    return 'request usedAt must be null or a non-empty timestamp';
  }
  const usedBy = body['usedBy'];
  if (!(usedBy === null || usedByProblem(usedBy) === null)) {
    return 'request usedBy must be null or { runId, callId }';
  }
  if ((body['usedAt'] === null) !== (usedBy === null)) {
    return 'request usedAt and usedBy must both be null or both set';
  }
  if (!nonEmpty(body['createdAt']) || !nonEmpty(body['updatedAt'])) return 'request timestamps are required';
  // Identity cross-checks: the key and every nested scope must agree.
  const taskValue = body['task'] as UnknownRecord;
  const reviewValue = body['reviewRef'] as UnknownRecord;
  const runValue = body['runRef'] as UnknownRecord;
  if (refValue['projectId'] !== reviewValue['projectId'] || refValue['projectId'] !== runValue['projectId']) {
    return 'request ref.projectId disagrees with reviewRef/runRef';
  }
  if (refValue['goalId'] !== reviewValue['goalId'] || refValue['goalId'] !== runValue['goalId']) {
    return 'request ref.goalId disagrees with reviewRef/runRef';
  }
  if (taskValue['projectId'] !== refValue['projectId'] || taskValue['goalId'] !== refValue['goalId']) {
    return 'request task belongs to another Goal/project';
  }
  if (taskValue['taskId'] !== refValue['taskId']) return 'request task.taskId disagrees with ref.taskId';
  return null;
}

// --------------------------------------------------------------------------
// Record encode/decode
// --------------------------------------------------------------------------

export function commandRerunRequestRefKey(ref: CommandRerunRequestRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

export function encodeCommandRerunRequest(request: CommandRerunRequestV1): EncodedRecord {
  return {
    refKey: commandRerunRequestRefKey(request.ref),
    schemaId: COMMAND_RERUN_REQUEST_SCHEMA_ID,
    revision: request.revision,
    json: JSON.stringify(request),
  };
}

export function decodeCommandRerunRequest(record: EncodedRecord): DecodeResult<CommandRerunRequestV1> {
  if (record.schemaId !== COMMAND_RERUN_REQUEST_SCHEMA_ID) {
    return invalid(`expected schemaId ${COMMAND_RERUN_REQUEST_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const body = parseObject(record.json);
  if (body === null) return invalid('CommandRerunRequest record json is not an object');
  if (!isObject(body['ref']) || !isPos(body['revision']) || body['revision'] !== record.revision) {
    return invalid('CommandRerunRequest record envelope is invalid');
  }
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) {
    return invalid('CommandRerunRequest refKey disagrees with the record body');
  }
  const problem = commandRerunRequestBodyProblem(body);
  if (problem !== null) return invalid(`CommandRerunRequest record payload is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as CommandRerunRequestV1 };
}

// --------------------------------------------------------------------------
// The replay event
// --------------------------------------------------------------------------

export type CommandRerunRequestChangedEventV1 = {
  eventId: string;
  eventType: typeof COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE;
  schemaVersion: typeof COMMAND_RERUN_REQUEST_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  fingerprint: string;
  actor: ActorRef;
  requestId: string;
  change: CommandRerunRequestChangeV1;
  request: CommandRerunRequestV1;
  proof?: DecisionChangeProofV1;
};

const EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'identityKey', 'fingerprint', 'actor',
  'requestId', 'change', 'request', 'proof',
];

function actorProblem(value: unknown): string | null {
  if (!isObject(value)) return 'CommandRerunRequestChanged actor must be an object';
  if (value['kind'] === 'agent') {
    const run = runRefProblem(value['runRef'], 'CommandRerunRequestChanged actor.runRef');
    if (run !== null) return run;
    if (!hasOnlyKeys(value, ['kind', 'id', 'runRef']) || !nonEmpty(value['id'])) {
      return 'CommandRerunRequestChanged actor must be an agent actor';
    }
    return null;
  }
  if (!hasOnlyKeys(value, ['kind', 'id'])
    || (value['kind'] !== 'human' && value['kind'] !== 'system') || !nonEmpty(value['id'])) {
    return 'CommandRerunRequestChanged actor must be a trusted human/system actor';
  }
  return null;
}

export function encodeCommandRerunRequestChangedEvent(event: CommandRerunRequestChangedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

export function commandRerunRequestChangedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<CommandRerunRequestChangedEventV1> {
  if (event.eventType !== COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE) {
    return invalid(`expected eventType ${COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== COMMAND_RERUN_REQUEST_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${String(COMMAND_RERUN_REQUEST_EVENT_SCHEMA_VERSION)}, got ${String(event.schemaVersion)}`);
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) {
    return invalid('CommandRerunRequestChanged envelope is incomplete');
  }
  const body = parseObject(event.json);
  if (body === null) return invalid('CommandRerunRequestChanged event json is not an object');
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType
    || body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return invalid('CommandRerunRequestChanged event envelope disagrees with the event json');
  }
  if (!hasOnlyKeys(body, EVENT_KEYS)) return invalid('CommandRerunRequestChanged carries unknown fields');
  if (!nonEmpty(body['identityKey']) || !nonEmpty(body['fingerprint']) || !nonEmpty(body['requestId'])) {
    return invalid('CommandRerunRequestChanged requires its identity and request id');
  }
  const actor = actorProblem(body['actor']);
  if (actor !== null) return invalid(actor);
  if (!inList(body['change'], CHANGE_KINDS)) return invalid('CommandRerunRequestChanged change is not recognized');
  const change = body['change'];
  const hasProof = body['proof'] !== undefined;
  if (hasProof !== PROOF_CHANGES.includes(change)) {
    return invalid('CommandRerunRequestChanged carries a proof only for allowed/denied/denied_final');
  }
  if (hasProof && !isObject(body['proof'])) {
    return invalid('CommandRerunRequestChanged proof must be an object');
  }
  const request = body['request'];
  if (!isObject(request)) return invalid('CommandRerunRequestChanged requires the whole post-change record');
  if (request['schemaVersion'] !== 1 || !isPos(request['revision'])) {
    return invalid('CommandRerunRequestChanged request envelope is invalid');
  }
  const problem = commandRerunRequestBodyProblem(request);
  if (problem !== null) return invalid(`CommandRerunRequestChanged request is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as CommandRerunRequestChangedEventV1 };
}

// --------------------------------------------------------------------------
// The one registration
// --------------------------------------------------------------------------

export const COMMAND_RERUN_REQUEST_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    {
      aggregateType: 'CommandRerunRequest',
      schemaId: COMMAND_RERUN_REQUEST_SCHEMA_ID,
      validate: (record) => {
        const decoded = decodeCommandRerunRequest(record);
        return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
      },
    },
  ],
  events: [
    {
      eventType: COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE,
      schemaVersion: COMMAND_RERUN_REQUEST_EVENT_SCHEMA_VERSION,
      validate: (event) => {
        const decoded = commandRerunRequestChangedEventFromEvent(event);
        return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
      },
    },
  ],
  lookups: [
    { name: K3_CRR_BY_TASK_ALIAS_LOOKUP, aggregateType: 'CommandRerunRequest',
      paths: ['ref.projectId', 'ref.goalId', 'ref.taskId', 'reviewRef.runId', 'alias'] },
    { name: K3_CRR_BY_GOAL_STATE_LOOKUP, aggregateType: 'CommandRerunRequest',
      paths: ['ref.projectId', 'workspaceId', 'ref.goalId', 'state'] },
    { name: K3_CRR_BY_TASK_LOOKUP, aggregateType: 'CommandRerunRequest',
      paths: ['ref.projectId', 'ref.goalId', 'ref.taskId'] },
  ],
};

// --------------------------------------------------------------------------
// The answer-derived identity shared by the answer reader, start-up and the owner
// --------------------------------------------------------------------------

function fourRequestFields(ref: CommandRerunRequestRef): Record<string, string> {
  return {
    aggregateType: 'CommandRerunRequest', projectId: ref.projectId, goalId: ref.goalId,
    taskId: ref.taskId, requestId: ref.requestId,
  };
}

/** The `command_rerun_request` request ref carried by a decision source key, or null. */
export function commandRerunRequestRefOfSource(source: DecisionSourceV1): CommandRerunRequestRef | null {
  if (!isObject(source) || source.kind !== 'command_rerun_request') return null;
  const parsed = parseDecisionSourceKey(source);
  if (parsed === null || parsed.kind !== 'command_rerun_request') return null;
  const rawRef = nestedSourceObject(parsed.body, 'requestRef');
  if (rawRef === null || commandRerunRequestRefProblem(rawRef) !== null) return null;
  const ref = rawRef as CommandRerunRequestRef;
  return {
    aggregateType: 'CommandRerunRequest', projectId: ref.projectId, goalId: ref.goalId,
    taskId: ref.taskId, requestId: ref.requestId,
  };
}

/**
 * L19a: the answer-derived identity of a CRR answer; phase label is `rerun_request`.
 * `applyAnswer` commits under exactly this pair, so a retry replays the one commit.
 */
export function commandRerunRequestAnswerIdentity(
  source: DecisionSourceV1, selection: DecisionSelectionV1, answerMessageRef: SessionMessageRef,
): { identityKey: string; fingerprint: string } | null {
  const ref = commandRerunRequestRefOfSource(source);
  if (ref === null) return null;
  return commandRerunRequestAnswerIdentityOf(ref, selection, answerMessageRef);
}

/** The same pair when the request ref is already known (the owner's input). */
export function commandRerunRequestAnswerIdentityOf(
  requestRef: CommandRerunRequestRef, selection: DecisionSelectionV1, answerMessageRef: SessionMessageRef,
): { identityKey: string; fingerprint: string } {
  const four = fourRequestFields(requestRef);
  return {
    identityKey: 'crr-answer:' + sha256Hex(canonicalJson({
      requestRef: four, decisionMessageRef: answerMessageRef, phase: 'rerun_request',
    } as never)),
    fingerprint: sha256Hex(canonicalJson({
      requestRef: four, selection, decisionMessageRef: answerMessageRef,
    } as never)),
  };
}
