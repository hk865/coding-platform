/**
 * The ONE committed-receipt replay helper.
 *
 * A store commit replays by locating the ORIGINAL event at the receipt cursor,
 * proving that event is the one the receipt names, decoding it, checking its
 * identity against the requesting write and projecting the recorded value. Every
 * failure is a `CoreRejection`; a constructed success is never returned and a
 * branch that writes nothing never reports `committed`.
 *
 * An `eventAt` throw is caught and surfaced as `event_unreadable`, never
 * propagated.
 *
 * `identity` is optional because a legacy event (the Note replay events) carries
 * no identityKey/fingerprint. When `expected` is supplied, both extractors are
 * required and both values must agree; receipt/event agreement, decoding and
 * the optional `validate` checks always run.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import type {
  DecodeResult, EncodedDomainEvent, StoreResult,
} from '../../record-store/ports.js';
import { ownerWriteStoreFailureToRejection } from '../persistence/read-result-failures.js';

/** The receipt facts replay needs: the real commit cursor and the event ids it wrote. */
export type CommittedReceiptLike = { cursor: CommitCursor; eventIds: readonly string[] };

export type ReceiptEventLocation = { cursor: CommitCursor; event: EncodedDomainEvent };

/** Why a replay could not be trusted. A caller may map these to its own messages. */
export type ReceiptReplayFailure =
  | { kind: 'event_unreadable'; error: unknown }
  | { kind: 'event_rejected'; rejection: CoreRejection }
  | { kind: 'wrong_event_type'; expectedEventType: string; actualEventType: string }
  | { kind: 'receipt_mismatch'; eventId: string }
  | { kind: 'undecodable'; reason: string }
  | { kind: 'identity_mismatch' };

type IdentityCheck<TDecoded> =
  | { expected?: undefined; identityKey?: undefined; fingerprint?: undefined }
  | {
      expected: { identityKey: string; fingerprint: string };
      identityKey(decoded: TDecoded): string;
      fingerprint(decoded: TDecoded): string;
    };

export type ReceiptReplayInput<
  TDecoded,
  TValue,
  TReceipt extends CommittedReceiptLike = CommittedReceiptLike,
> = {
  /** The committed receipt whose cursor and eventIds the replay must honour. */
  receipt: TReceipt;
  /** Read the event at a cursor; may throw (the helper catches it). */
  eventAt(cursor: CommitCursor): Promise<StoreResult<ReceiptEventLocation>>;
  /** The one event type this aggregate's commit writes. */
  expectedEventType: string;
  decode(event: EncodedDomainEvent): DecodeResult<TDecoded>;
  /** Receipt/event agreement plus any aggregate-specific ref checks; null means accepted. */
  validate?(decoded: TDecoded, receipt: TReceipt): CoreRejection | null;
  /** Project the decoded whole-record value to the owner's return value. */
  project(decoded: TDecoded): TValue;
  /** Map a failure to the owner's own rejection wording; the default maps store codes. */
  onFailure?(failure: ReceiptReplayFailure): CoreRejection;
} & IdentityCheck<TDecoded>;

function defaultFailure(failure: ReceiptReplayFailure): CoreRejection {
  switch (failure.kind) {
    case 'event_unreadable':
      return rejected('unavailable', 'the replayed event could not be read');
    case 'event_rejected':
      return failure.rejection;
    case 'wrong_event_type':
      return rejected('unavailable', `the replayed event is not a ${failure.expectedEventType} event`);
    case 'receipt_mismatch':
      return rejected('unavailable', 'the replayed event disagrees with the receipt');
    case 'undecodable':
      return rejected('unavailable', `the replayed event is not decodable: ${failure.reason}`);
    case 'identity_mismatch':
      return rejected('unavailable', 'the replayed event identity disagrees with the request identity');
  }
}

export async function replayCommittedReceipt<
  TDecoded,
  TValue,
  TReceipt extends CommittedReceiptLike = CommittedReceiptLike,
>(input: ReceiptReplayInput<TDecoded, TValue, TReceipt>):
Promise<WriteResult<TValue>> {
  const failure = input.onFailure ?? defaultFailure;
  let located: StoreResult<ReceiptEventLocation>;
  try {
    located = await input.eventAt(input.receipt.cursor);
  } catch (error) {
    return failure({ kind: 'event_unreadable', error });
  }
  if (located.status !== 'ready') {
    return failure({ kind: 'event_rejected', rejection: ownerWriteStoreFailureToRejection(located) });
  }
  const event = located.value.event;
  if (event.eventType !== input.expectedEventType) {
    return failure({ kind: 'wrong_event_type', expectedEventType: input.expectedEventType,
      actualEventType: event.eventType });
  }
  if (!input.receipt.eventIds.includes(event.eventId)) {
    return failure({ kind: 'receipt_mismatch', eventId: event.eventId });
  }
  const decoded = input.decode(event);
  if (decoded.status !== 'decoded') {
    return failure({ kind: 'undecodable', reason: decoded.reason });
  }
  const value = decoded.value;
  if (input.expected !== undefined) {
    if (input.identityKey(value) !== input.expected.identityKey
      || input.fingerprint(value) !== input.expected.fingerprint) {
      return failure({ kind: 'identity_mismatch' });
    }
  }
  const validation = input.validate?.(value, input.receipt) ?? null;
  if (validation !== null) return validation;
  return { status: 'committed', value: input.project(value), replayed: true, cursor: input.receipt.cursor };
}
