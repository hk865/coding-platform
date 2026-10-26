/**
 * The DispatchCounter's pure transforms, validation rule and codec contract. An absent counter
 * begins at sequence 1 with the absent guard; a present one moves n -> n+1 and guards the revision it read. Never 0.
 * The rule refuses a non-positive or non-integer sequence, a goalId differing from the ref's, and a lastMessageRef
 * in another project. The codec keys the record by its full canonical ref, round-trips it, and registers exactly one
 * record schema and no event. Pure A5: values built here, expected values written out by hand; no store.
 */
import { describe, expect, it } from 'vitest';
import type { DispatchCounterV1, GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { dispatchCounterProblem } from '../../src/contracts/dispatch-counter-format.js';
import { firstDispatch, nextDispatch } from '../../src/core/work-graph/state/dispatch-counter.js';
import { DISPATCH_COUNTER_SCHEMAS, dispatchCounterCodec } from '../../src/core/work-graph/persistence/dispatch-counter-codecs.js';

const GOAL: GoalRef = { aggregateType: 'Goal', projectId: 'p-counter', goalId: 'g-counter' };
const MESSAGE_A: SessionMessageRef = {
  aggregateType: 'SessionMessage', projectId: 'p-counter', workspaceId: 'w-counter', messageId: 'm-1',
};
const MESSAGE_B: SessionMessageRef = { ...MESSAGE_A, messageId: 'm-2' };
const COUNTER_REF = { aggregateType: 'DispatchCounter', projectId: 'p-counter', goalId: 'g-counter' } as const;
const KEY = '{"aggregateType":"DispatchCounter","goalId":"g-counter","projectId":"p-counter"}';

/** A stored counter at revision 5, sequence 9: what the next send reads. */
const CURRENT: DispatchCounterV1 = {
  ref: COUNTER_REF, schemaVersion: 1, revision: 5, goalId: 'g-counter', sequence: 9, lastMessageRef: MESSAGE_A,
};

describe('DispatchCounter pure transforms', () => {
  it.each<[string, () => unknown, unknown]>([
    ['the absent counter', () => firstDispatch(GOAL, MESSAGE_A), {
      record: { ref: COUNTER_REF, schemaVersion: 1, revision: 1, goalId: 'g-counter', sequence: 1,
        lastMessageRef: MESSAGE_A },
      expectedRevision: null,
    }],
    ['a read counter', () => nextDispatch(CURRENT, MESSAGE_B), {
      record: { ref: COUNTER_REF, schemaVersion: 1, revision: 6, goalId: 'g-counter', sequence: 10,
        lastMessageRef: MESSAGE_B },
      expectedRevision: 5,
    }],
  ])('%s keeps the full record and the expected revision', (_label, make, expected) => {
    expect(make()).toEqual(expected);
  });

  it.each<[string, unknown, string | null]>([
    ['sequence 0', { ...CURRENT, sequence: 0 }, 'DispatchCounter.sequence must be a positive safe integer'],
    ['sequence -1', { ...CURRENT, sequence: -1 }, 'DispatchCounter.sequence must be a positive safe integer'],
    ['sequence 1.5', { ...CURRENT, sequence: 1.5 }, 'DispatchCounter.sequence must be a positive safe integer'],
    ['a goalId differing from ref.goalId', { ...CURRENT, goalId: 'g-other' },
      'DispatchCounter.goalId must equal its ref.goalId'],
    ['a lastMessageRef in another project', { ...CURRENT, lastMessageRef: { ...MESSAGE_A, projectId: 'p-other' } },
      'DispatchCounter.lastMessageRef must belong to the same project'],
    ['a valid counter', CURRENT, null],
  ])('dispatchCounterProblem: %s', (_label, value, expected) => {
    expect(dispatchCounterProblem(value)).toBe(expected);
  });
});

describe('DispatchCounter codec', () => {
  it('keys by the canonical full ref, round-trips, and registers one record schema and no event', () => {
    const encoded = dispatchCounterCodec.encode(CURRENT);
    expect(encoded).toEqual({
      refKey: KEY, schemaId: 'DispatchCounter@1', revision: 5,
      json: '{"ref":{"aggregateType":"DispatchCounter","projectId":"p-counter","goalId":"g-counter"},'
        + '"schemaVersion":1,"revision":5,"goalId":"g-counter","sequence":9,'
        + '"lastMessageRef":{"aggregateType":"SessionMessage","projectId":"p-counter","workspaceId":"w-counter",'
        + '"messageId":"m-1"}}',
    });
    expect(dispatchCounterCodec.decode(encoded)).toEqual({ status: 'decoded', value: CURRENT });
    expect(DISPATCH_COUNTER_SCHEMAS.records.map(record => [record.schemaId, record.aggregateType]))
      .toEqual([['DispatchCounter@1', 'DispatchCounter']]);
    expect(DISPATCH_COUNTER_SCHEMAS.events).toEqual([]);
  });
});
