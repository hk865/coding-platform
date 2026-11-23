/**
 * R-codec (the record codec fragment): the record round trip, the encoded key
 * order, no decode defaults for the new fields, the persisted lifecycle
 * events, the `secretary_round` sender and the response reject branch, and the
 * `requestRoot` lookup.
 *
 * Pure input -> output (A5): no store, clock, Host or fixture. Expected values
 * come from the codec fragment's hand-worked round trip, never from a value
 * printed by the code.
 */
import { describe, expect, it } from 'vitest';
import type { ApplicationProofV1 } from '../../src/contracts/core/session-message.js';
import type { SourceRefV1 } from '../../src/contracts/dispatch.js';
import { makeCommitCursor, type GoalRef } from '../../src/contracts/ledger.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { EncodedDomainEvent } from '../../src/core/record-store/ports.js';
import type { MessageQueryRoundSenderRecord } from '../../src/contracts/mailbox.js';
import {
  createSessionMessageRecord,
  nextSessionMessageRecord,
  type MessageWorkRunSenderRecord,
  type SessionMessageRecord,
} from '../../src/core/work-graph/state/message-machine.js';
import {
  SESSION_MESSAGE_APPLIED_EVENT_TYPE,
  SESSION_MESSAGE_BY_REQUEST_ROOT_LOOKUP,
  SESSION_MESSAGE_LOOKUP_INDEXES,
  SESSION_MESSAGE_RECORD_SCHEMAS,
  SESSION_MESSAGE_WITHDRAWN_EVENT_TYPE,
  decodeSessionMessageRecord,
  encodeSessionMessageAppliedEvent,
  encodeSessionMessageRecord,
  encodeSessionMessageWithdrawnEvent,
  sessionMessageFromEvent,
} from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { SECRETARY_SENDER, s7aRecordInput } from '../helpers/S7A-message-fixtures.js';

const PROJECT = 'P';
const WORKSPACE = 'W';
const AT = '2026-10-25T00:00:00.000Z';
const APPLIED_AT = '2026-10-25T00:00:03.000Z';
const SOURCE: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE, revision: '1' };
const BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'd', sizeBytes: 1, source: SOURCE };
const HOST = { kind: 'host' as const, actor: { kind: 'human' as const, id: 'operator' } };
const GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'g' };
const PROOF: ApplicationProofV1 = {
  receipt: { identityKey: 'proof', fingerprint: 'proof-f', cursor: makeCommitCursor(2) },
  effect: { kind: 'requeue', ref: GOAL },
};
const QUERY_ROUND: MessageQueryRoundSenderRecord = {
  kind: 'query_run',
  sessionRef: { projectId: PROJECT, sessionId: 'S' },
  queryRunRef: { aggregateType: 'QueryRun', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId: 'q', runId: 'r' },
  generation: 1,
};
const WORK_RUN_SENDER: MessageWorkRunSenderRecord = {
  kind: 'work_run',
  sessionRef: { projectId: PROJECT, sessionId: 'S' },
  runRef: { aggregateType: 'Run', projectId: PROJECT, goalId: 'g', runId: 'r' },
  roleBinding: {
    schemaVersion: 1, bindingId: 'binding', templateId: 'template',
    templateRevision: '1', bindingVersion: 1, policyRevision: '1',
  },
  generation: 1,
};

/** The applied lifecycle: the G1 send facts, then the apply slot and its proof. */
function appliedRecord(): SessionMessageRecord {
  const created = createSessionMessageRecord(s7aRecordInput({
    wake: false, answeredBy: 'copy', entry: 'person_intervention', deadlineMs: 86_400_000,
  }));
  return nextSessionMessageRecord(created, { kind: 'applied', appliedAt: APPLIED_AT, proof: PROOF });
}

const APPLIED_RECORD = appliedRecord();
const APPLIED_ENCODED = encodeSessionMessageRecord(APPLIED_RECORD);

function schemaFor(eventType: string) {
  const found = SESSION_MESSAGE_RECORD_SCHEMAS.events.find((entry) => entry.eventType === eventType);
  if (found === undefined) throw new Error(`no SessionMessage event schema for ${eventType}`);
  return found;
}

const WITHDRAWN = {
  eventId: 'event-withdrawn', eventType: 'SessionMessageWithdrawn' as const, schemaVersion: 1 as const,
  occurredAt: AT, projectId: PROJECT, workspaceId: WORKSPACE, requestId: 'request-withdrawn',
  actor: HOST, message: APPLIED_RECORD,
};
const APPLIED = {
  eventId: 'event-applied', eventType: 'SessionMessageApplied' as const, schemaVersion: 1 as const,
  occurredAt: AT, projectId: PROJECT, workspaceId: WORKSPACE, requestId: 'request-applied',
  actor: HOST, message: APPLIED_RECORD,
};

const EVENT_ROWS: ReadonlyArray<readonly [string, EncodedDomainEvent]> = [
  [SESSION_MESSAGE_WITHDRAWN_EVENT_TYPE, encodeSessionMessageWithdrawnEvent(WITHDRAWN)],
  [SESSION_MESSAGE_APPLIED_EVENT_TYPE, encodeSessionMessageAppliedEvent(APPLIED)],
];

describe('R-codec', () => {
  it('round-trips the applied lifecycle, adding only the decoder\'s two null read defaults', () => {
    expect(decodeSessionMessageRecord(APPLIED_ENCODED)).toEqual({
      status: 'decoded',
      value: { ...APPLIED_RECORD, replyHandler: null, archiveWaitDisposition: null },
    });
  });

  it('round-trips the G1 send facts and a query_run reply without answerRef', () => {
    const request = createSessionMessageRecord(s7aRecordInput({
      sender: QUERY_ROUND, needsReply: true, wake: false, answeredBy: 'copy', entry: 'person_intervention',
    }));
    const record = nextSessionMessageRecord(request, {
      kind: 'responded', rejectedAt: null,
      response: { sender: QUERY_ROUND, bodyRef: BODY, sourceRef: SOURCE, respondedAt: AT },
    });
    const bound = { ...record, responseSince: makeCommitCursor(11) };
    const decoded = decodeSessionMessageRecord(encodeSessionMessageRecord(bound));
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value.wake).toBe(false);
    expect(decoded.value.answeredBy).toBe('copy');
    expect(decoded.value.entry).toBe('person_intervention');
    expect(decoded.value).not.toHaveProperty('intent');
    expect(decoded.value).toEqual({ ...bound, replyHandler: null, archiveWaitDisposition: null });
    const response = decoded.value.response;
    if (response === null) throw new Error('the query_run reply must survive the codec');
    expect(response.sender.kind).toBe('query_run');
    expect(Object.keys(response.sender)).not.toContain('answerRef');
    expect(response.sender).not.toHaveProperty('answerRef');
  });

  it('keeps the record\'s own key order in the encoded JSON', () => {
    expect(Object.keys(JSON.parse(APPLIED_ENCODED.json))).toEqual(Object.keys(APPLIED_RECORD));
  });

  it.each(['wake', 'answeredBy', 'delivery'])(
    'treats a missing %s as a missing field, never a default',
    (key) => {
      const body = JSON.parse(APPLIED_ENCODED.json);
      delete body[key];
      const decoded = decodeSessionMessageRecord({ ...APPLIED_ENCODED, json: JSON.stringify(body) });
      expect(decoded.status).toBe('invalid');
      if (decoded.status === 'invalid') expect(decoded.reason).toContain(`${key} is missing`);
    },
  );

  it.each([
    ['a fractional deadlineMs', 0.5, 'decoded'],
    ['zero', 0, 'invalid'],
  ] as const)('decodes %s as %s', (label, deadlineMs, status) => {
    const decoded = decodeSessionMessageRecord(encodeSessionMessageRecord(
      createSessionMessageRecord(s7aRecordInput({ deadlineMs }))));
    expect(decoded.status).toBe(status);
  });

  it('validates applicationProof.effect.ref through the shared aggregate-ref check', () => {
    const body = JSON.parse(APPLIED_ENCODED.json);
    body['applicationProof']['effect']['ref'] = { aggregateType: 'NotAnAggregate', projectId: PROJECT };
    const decoded = decodeSessionMessageRecord({ ...APPLIED_ENCODED, json: JSON.stringify(body) });
    expect(decoded.status).toBe('invalid');
    if (decoded.status === 'invalid') expect(decoded.reason).toContain('is not a known aggregate');
  });

  it('refuses an application proof effect kind that is not a string member', () => {
    const body = JSON.parse(APPLIED_ENCODED.json);
    body['applicationProof']['effect']['kind'] = ['requeue'];
    expect(decodeSessionMessageRecord({ ...APPLIED_ENCODED, json: JSON.stringify(body) }).status).toBe('invalid');
  });

  it.each(EVENT_ROWS)('validates %s and restores exactly the snapshot', (eventType, encoded) => {
    expect(encoded.eventType).toBe(eventType);
    expect(schemaFor(eventType).validate(encoded).status).toBe('decoded');
    const restored = sessionMessageFromEvent(encoded);
    expect(restored.status).toBe('decoded');
    if (restored.status !== 'decoded') return;
    expect(restored.value).toEqual(APPLIED_RECORD);
    expect(Object.keys(restored.value)).toEqual(Object.keys(APPLIED_RECORD));
  });

  it('refuses an unknown event key', () => {
    const withdrawn = encodeSessionMessageWithdrawnEvent(WITHDRAWN);
    const extraBody = JSON.parse(withdrawn.json);
    extraBody['extra'] = true;
    expect(schemaFor(SESSION_MESSAGE_WITHDRAWN_EVENT_TYPE)
      .validate({ ...withdrawn, json: JSON.stringify(extraBody) }).status).toBe('invalid');
  });

  it('round-trips the secretary_round sender and its requestRoot', () => {
    const record = createSessionMessageRecord(s7aRecordInput({
      sender: SECRETARY_SENDER, requestRoot: SECRETARY_SENDER.requestRoot,
    }));
    const decoded = decodeSessionMessageRecord(encodeSessionMessageRecord(record));
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value.sender).toEqual(SECRETARY_SENDER);
    expect(decoded.value.requestRoot).toEqual(SECRETARY_SENDER.requestRoot);
    expect(decoded.value).toEqual({ ...record, replyHandler: null, archiveWaitDisposition: null });
  });

  it('round-trips a bound secretary_round reply position and names both senders when it refuses', () => {
    // Spec §2.3 P02: the first reply on a work_run OR secretary_round message
    // carries the reply position; the body check admits both senders.
    const secretarySent = createSessionMessageRecord(s7aRecordInput({
      sender: SECRETARY_SENDER, requestRoot: SECRETARY_SENDER.requestRoot, needsReply: true,
    }));
    const replied = nextSessionMessageRecord(secretarySent, {
      kind: 'responded', rejectedAt: null,
      response: { sender: WORK_RUN_SENDER, bodyRef: BODY, sourceRef: SOURCE, respondedAt: AT },
    });
    const decoded = decodeSessionMessageRecord(encodeSessionMessageRecord({ ...replied, responseSince: makeCommitCursor(11) }));
    expect(decoded.status).toBe('decoded');

    const hostReplied = nextSessionMessageRecord(createSessionMessageRecord(s7aRecordInput()), {
      kind: 'responded', rejectedAt: null,
      response: { sender: WORK_RUN_SENDER, bodyRef: BODY, sourceRef: SOURCE, respondedAt: AT },
    });
    const refused = decodeSessionMessageRecord(encodeSessionMessageRecord({ ...hostReplied, responseSince: makeCommitCursor(11) }));
    expect(refused.status).toBe('invalid');
    if (refused.status === 'invalid') expect(refused.reason).toContain('requires a work_run, query_run or secretary_round sender');
  });

  it('round-trips a reject response with exactly reject and reason beside the old four keys', () => {
    const record = nextSessionMessageRecord(createSessionMessageRecord(s7aRecordInput()), {
      kind: 'responded', rejectedAt: AT,
      response: { sender: WORK_RUN_SENDER, bodyRef: BODY, sourceRef: SOURCE, respondedAt: AT, reject: true, reason: 'no' },
    });
    const decoded = decodeSessionMessageRecord(encodeSessionMessageRecord(record));
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    const response = decoded.value.response;
    if (response === null || !('reject' in response)) throw new Error('the reject response must survive');
    expect(Object.keys(response)).toEqual(['sender', 'bodyRef', 'sourceRef', 'respondedAt', 'reject', 'reason']);
    expect(response.reject).toBe(true);
    expect(response.reason).toBe('no');
  });

  it('appends the requestRoot lookup once with its frozen equality paths and order', () => {
    expect(SESSION_MESSAGE_BY_REQUEST_ROOT_LOOKUP).toBe('session-message-by-request-root');
    expect(SESSION_MESSAGE_LOOKUP_INDEXES[SESSION_MESSAGE_LOOKUP_INDEXES.length - 1]).toEqual({
      name: 'session-message-by-request-root',
      aggregateType: 'SessionMessage',
      paths: ['requestRoot.projectId', 'requestRoot.workspaceId', 'requestRoot.queryJobId'],
      orderBy: { path: 'createdAt', valueType: 'text' },
    });
    const registered = (SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? [])
      .filter((entry) => entry.name === SESSION_MESSAGE_BY_REQUEST_ROOT_LOOKUP);
    expect(registered).toHaveLength(1);
  });
});
