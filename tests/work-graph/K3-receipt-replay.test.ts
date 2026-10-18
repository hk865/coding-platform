/**
 * K3 rework 1 item 12.2: the ONE committed-receipt replay helper. The helper is
 * a pure function of an injected `eventAt` and decoder; these tests construct a
 * receipt and a domain-neutral event and inject a fake reader (fault injection
 * is allowed). No domain record/snapshot is written or handed to a reader.
 */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreRejection } from '../../src/contracts/core/results.js';
import type { DecodeResult, EncodedDomainEvent, StoreResult } from '../../src/core/record-store/ports.js';
import {
  replayCommittedReceipt, type ReceiptReplayFailure,
} from '../../src/core/work-graph/tasks/receipt-replay.js';

type Body = { identityKey: string; fingerprint: string; value: number };
type EventValue = { identityKey: string; fingerprint: string; value: number };

const cursor = 'c1' as CommitCursor;
const receipt = { cursor, eventIds: ['e1'] };

function eventOf(eventId: string, eventType = 'ThingChanged', body: Partial<Body> = {}): EncodedDomainEvent {
  return {
    eventId, eventType, schemaVersion: 1, occurredAt: '2026-10-17T00:00:00.000Z',
    json: JSON.stringify({ identityKey: 'i1', fingerprint: 'f1', value: 7, ...body }),
  };
}

function eventAtOf(event: EncodedDomainEvent | null, failure?: StoreResult<never>):
(cursor: CommitCursor) => Promise<StoreResult<{ cursor: CommitCursor; event: EncodedDomainEvent }>> {
  return async () => failure ?? (event === null
    ? { status: 'rejected', code: 'not_found', reason: 'no event' }
    : { status: 'ready', value: { cursor, event } });
}

function decode(event: EncodedDomainEvent): DecodeResult<EventValue> {
  const body = JSON.parse(event.json) as Body;
  return { status: 'decoded', value: body };
}

const expected = { identityKey: 'i1', fingerprint: 'f1' };

type Overrides = {
  onFailure?: (failure: ReceiptReplayFailure) => CoreRejection;
  validate?: (value: EventValue, committed: typeof receipt) => CoreRejection | null;
  decode?: (event: EncodedDomainEvent) => DecodeResult<EventValue>;
  eventAt?: (cursor: CommitCursor) => Promise<StoreResult<{ cursor: CommitCursor; event: EncodedDomainEvent }>>;
};

function input(event: EncodedDomainEvent | null, overrides: Overrides = {}) {
  return {
    receipt,
    eventAt: eventAtOf(event),
    expectedEventType: 'ThingChanged',
    decode,
    identityKey: (value: EventValue) => value.identityKey,
    fingerprint: (value: EventValue) => value.fingerprint,
    expected,
    project: (value: EventValue) => value.value,
    ...overrides,
  };
}

function reasons(): (failure: ReceiptReplayFailure) => CoreRejection {
  return (failure) => ({ status: 'rejected', code: 'unavailable', reason: failure.kind });
}

describe('replayCommittedReceipt', () => {
  it('returns the projected value with the real cursor and replayed: true', async () => {
    await expect(replayCommittedReceipt(input(eventOf('e1')))).resolves.toEqual({
      status: 'committed', value: 7, replayed: true, cursor,
    });
  });

  it('runs validate with the receipt after decode', async () => {
    const seen: string[] = [];
    await replayCommittedReceipt(input(eventOf('e1'), {
      validate: (_value, committed) => {
        seen.push(committed.cursor);
        return null;
      },
    }));
    expect(seen).toEqual([cursor]);
  });

  it('returns a validation rejection unchanged', async () => {
    const rejection = { status: 'rejected' as const, code: 'unavailable' as const, reason: 'ref disagrees' };
    await expect(replayCommittedReceipt(input(eventOf('e1'), { validate: () => rejection })))
      .resolves.toEqual(rejection);
  });

  it('rejects a wrong event type', async () => {
    const failure = await replayCommittedReceipt(input(eventOf('e1', 'OtherChanged'), { onFailure: reasons() }));
    expect(failure).toEqual({ status: 'rejected', code: 'unavailable', reason: 'wrong_event_type' });
  });

  it('rejects an event the receipt does not name', async () => {
    await expect(replayCommittedReceipt(input(eventOf('e2'), { onFailure: reasons() })))
      .resolves.toEqual({ status: 'rejected', code: 'unavailable', reason: 'receipt_mismatch' });
  });

  it('rejects a decoded identity/fingerprint that disagrees with the request', async () => {
    await expect(replayCommittedReceipt(input(eventOf('e1', 'ThingChanged', { fingerprint: 'other' }), {
      onFailure: reasons(),
    }))).resolves.toEqual({ status: 'rejected', code: 'unavailable', reason: 'identity_mismatch' });
  });

  it('absorbs an eventAt throw and reports it as a failure', async () => {
    const failure = await replayCommittedReceipt(input(null, {
      eventAt: async () => { throw new Error('boom'); }, onFailure: reasons(),
    }));
    expect(failure).toEqual({ status: 'rejected', code: 'unavailable', reason: 'event_unreadable' });
  });

  it('maps a store rejection through the default mapping', async () => {
    const failure = await replayCommittedReceipt(input(null, { eventAt: eventAtOf(null) }));
    expect(failure).toMatchObject({ status: 'rejected', code: 'not_found' });
  });

  it('does not require identity extraction when the event carries none (legacy note replay)', async () => {
    const decoded = { value: 7 } as unknown;
    const failure = await replayCommittedReceipt({
      receipt, eventAt: eventAtOf(eventOf('e1')), expectedEventType: 'ThingChanged',
      decode: () => ({ status: 'decoded', value: decoded }),
      project: () => 7,
    });
    expect(failure).toEqual({ status: 'committed', value: 7, replayed: true, cursor });
  });
});
