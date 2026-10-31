/**
 * R-records, pure half (`book-7c.md:1361`): record 3's field table, its two
 * closed input branches, the two replay events and the `rework-request-by-goal`
 * lookup description. The Store/index half (a real commit order and paging on
 * both backends) is not here: no legal pure step produces a commit cursor or a
 * stored record, so nothing here fabricates one.
 */
import { describe, expect, it } from 'vitest';
import type { NewReworkRequestInputV1 } from '../../src/core/work-graph/state/rework-request.js';
import { newReworkRequest } from '../../src/core/work-graph/state/rework-request.js';
import {
  reworkRequestClosedCodec, reworkRequestClosedEventFromEvent, reworkRequestCodec,
  reworkRequestRecordedCodec, reworkRequestRecordedEventFromEvent,
  type ReworkRequestClosed, type ReworkRequestRecorded,
} from '../../src/core/work-graph/tasks/rework-request-codecs.js';

const AT = '2026-11-01T00:00:00.000Z';
const REF = { aggregateType: 'ReworkRequest', projectId: 'p', goalId: 'g', taskId: 't', requestId: 'req-1' } as const;
const TASK = { projectId: 'p', goalId: 'g', taskId: 't' };
const RUN = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'run-1' } as const;
const ROUND = {
  aggregateType: 'VerificationRound', projectId: 'p', workspaceId: 'w', goalId: 'g', taskId: 't',
  runId: 'run-1', roundId: 'round-1',
} as const;
const SESSION = { projectId: 'p', sessionId: 's' };
const ACTOR = { kind: 'agent', id: 'agent-1', runRef: RUN } as const;

function requeueInput(reason = 'the change missed the edge'): NewReworkRequestInputV1 {
  return {
    ref: REF,
    workspaceId: 'w',
    kind: 'requeue',
    task: TASK,
    subject: { kind: 'run', run: RUN },
    requester: { actor: ACTOR, session: SESSION, run: RUN, duty: 'executor' },
    reason,
    requestedAt: AT,
    input: { kind: 'requeue', value: { taskRef: TASK, afterRunRef: RUN, reason } },
    pins: [],
    countedNext: 1,
  };
}

function recheckInput(): NewReworkRequestInputV1 {
  return {
    ref: REF,
    workspaceId: 'w',
    kind: 'recheck',
    task: TASK,
    subject: { kind: 'round', round: ROUND },
    requester: { actor: ACTOR, session: SESSION, run: RUN, duty: 'executor' },
    reason: 'the evidence moved',
    requestedAt: AT,
    input: { kind: 'recheck', value: { predecessorRoundRef: ROUND, reason: 'the evidence moved' } },
    pins: [],
    countedNext: null,
  };
}

const RECORDED: ReworkRequestRecorded = {
  eventId: 'event-1',
  eventType: 'ReworkRequestRecorded',
  schemaVersion: 1,
  occurredAt: AT,
  identityKey: 'identity-1',
  actor: ACTOR,
  fingerprint: 'fingerprint-1',
  request: REF,
};

const CLOSED: ReworkRequestClosed = {
  ...RECORDED,
  eventId: 'event-2',
  eventType: 'ReworkRequestClosed',
  outcome: { code: 'auto_rework_cap_reached', reason: 'the cap was reached' },
  state: 'rejected',
};

describe('R-records: the record field table', () => {
  it.each([
    ['requeue', requeueInput(), requeueInput().input],
    ['recheck', recheckInput(), recheckInput().input],
  ])('R-RECORDS-01: pending %s records of both closed input branches pass the field check and encode at @1', (kind, input, expectedInput) => {
    const record = newReworkRequest(input);
    expect(record.input.kind).toBe(kind);
    expect(reworkRequestCodec.check(record, 'pending')).toBeNull();
    const encoded = reworkRequestCodec.encode(record);
    expect(encoded.schemaId).toBe('ReworkRequest@1');
    expect(encoded.revision).toBe(1);
    const body = JSON.parse(encoded.json) as Record<string, unknown>;
    expect(body['state']).toBe('pending');
    expect(body['since']).toBeNull();
    expect(body['ref']).toEqual(REF);
    expect(body['input']).toEqual(expectedInput);
  });

  it('R-RECORDS-02: the top level `reason` has no extra byte cap; a 667-code-point/2001-byte reason passes', () => {
    const long = '汉'.repeat(667);
    expect(new TextEncoder().encode(long)).toHaveLength(2001);
    const record = newReworkRequest(requeueInput(long));
    expect(reworkRequestCodec.check(record, 'pending')).toBeNull();
  });

});

describe('R-records: the two replay events', () => {
  it('R-RECORDS-05: `ReworkRequestRecorded` round-trips with the request ref and the requester actor', () => {
    const encoded = reworkRequestRecordedCodec.encode(RECORDED);
    expect(encoded.eventType).toBe('ReworkRequestRecorded');
    const decoded = reworkRequestRecordedEventFromEvent(encoded);
    expect(decoded).toEqual({ status: 'decoded', value: RECORDED });
  });

  it('R-RECORDS-06: `ReworkRequestClosed` round-trips with the close state and outcome', () => {
    const encoded = reworkRequestClosedCodec.encode(CLOSED);
    expect(encoded.eventType).toBe('ReworkRequestClosed');
    const decoded = reworkRequestClosedEventFromEvent(encoded);
    expect(decoded).toEqual({ status: 'decoded', value: CLOSED });
  });
});
