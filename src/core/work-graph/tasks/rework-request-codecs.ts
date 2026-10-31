/**
 * The `ReworkRequest` RecordStore adapter (`book-7c.md:1083–:1105`): the one record codec, the two replay events and
 * the schemas both backends register. The field table itself is `state/rework-request.ts` (a pure `state/` module
 * cannot import the Store adapter), exactly like `state/command-rerun-request.ts` + `tasks/command-rerun-request-codecs.ts`.
 *
 * The recorded event names the request by its ref (not the whole record) and carries the requester's actor, the
 * identity and the fingerprint the owner committed under; the closed event adds the close `state` and `outcome`.
 */
import type { InferEvent } from '../../../contracts/data-format.js';
import { defineEvent, f } from '../../../contracts/data-format.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import { ReworkRequestRefShape } from '../../../contracts/data-format-refs.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { DecodeResult, EncodedDomainEvent, PreparedCommit, RecordBackendSchemas } from '../../record-store/ports.js';
import { createEventCodec, createRecordCodec, formatSchemas } from '../persistence/field-table-codec.js';
import {
  REWORK_REQUEST_ACTOR_FIELDS, REWORK_REQUEST_FORMAT, REWORK_REQUEST_OUTCOME_FIELDS,
  type PendingReworkRequestV1,
} from '../state/rework-request.js';

const REWORK_REQUEST_RECORDED_FIELDS = {
  identityKey: f.string({ min: 1, unit: 'codePoints' }),
  actor: f.object(REWORK_REQUEST_ACTOR_FIELDS),
  fingerprint: f.string({ min: 1, unit: 'codePoints' }),
  request: f.ref(ReworkRequestRefShape),
};

const REWORK_REQUEST_RECORDED_FORMAT = defineEvent({
  name: 'ReworkRequestRecorded',
  eventType: 'ReworkRequestRecorded',
  schemaVersion: 1,
  fields: REWORK_REQUEST_RECORDED_FIELDS,
});

/** The request branch's one event: the requester agent, the committed identity/fingerprint and the request ref. */
export type ReworkRequestRecorded = InferEvent<'ReworkRequestRecorded', typeof REWORK_REQUEST_RECORDED_FIELDS>;

const REWORK_REQUEST_CLOSED_FIELDS = {
  identityKey: f.string({ min: 1, unit: 'codePoints' }),
  actor: f.object(REWORK_REQUEST_ACTOR_FIELDS),
  fingerprint: f.string({ min: 1, unit: 'codePoints' }),
  request: f.ref(ReworkRequestRefShape),
  state: f.enumOf(['rejected', 'stale'] as const),
  outcome: f.object(REWORK_REQUEST_OUTCOME_FIELDS),
};

const REWORK_REQUEST_CLOSED_FORMAT = defineEvent({
  name: 'ReworkRequestClosed',
  eventType: 'ReworkRequestClosed',
  schemaVersion: 1,
  fields: REWORK_REQUEST_CLOSED_FIELDS,
});

/** The close event: the same request ref and actor, the close `state`, and the record's outcome arms. */
export type ReworkRequestClosed = InferEvent<'ReworkRequestClosed', typeof REWORK_REQUEST_CLOSED_FIELDS>;

export const reworkRequestCodec = createRecordCodec(REWORK_REQUEST_FORMAT);
export const reworkRequestRecordedCodec = createEventCodec(REWORK_REQUEST_RECORDED_FORMAT);
export const reworkRequestClosedCodec = createEventCodec(REWORK_REQUEST_CLOSED_FORMAT);

/** The record and both events in one registration group; the Store binds `since` through the record's schema. */
export const REWORK_REQUEST_RECORD_SCHEMAS: RecordBackendSchemas = formatSchemas([
  reworkRequestCodec, reworkRequestRecordedCodec, reworkRequestClosedCodec,
]);

/** The request branch's non-commit payload: one record@1, one `ReworkRequestRecorded` and the `since` binding. */
export type ReworkRequestRecordedFragment = {
  records: PreparedCommit['records'];
  claims: PreparedCommit['claims'];
  events: PreparedCommit['events'];
  commitCursorBindings: NonNullable<PreparedCommit['commitCursorBindings']>;
};

/** Builds that payload from the already-computed identity/fingerprint; the owner commits and replays it. */
export function reworkRequestRecordedFragment(input: {
  record: PendingReworkRequestV1;
  eventId: string;
  occurredAt: string;
  identityKey: string;
  actor: Extract<ActorRef, { kind: 'agent' }>;
  fingerprint: string;
}): ReworkRequestRecordedFragment {
  const event: ReworkRequestRecorded = {
    eventId: input.eventId, eventType: 'ReworkRequestRecorded', schemaVersion: 1,
    occurredAt: input.occurredAt, identityKey: input.identityKey, actor: input.actor,
    fingerprint: input.fingerprint, request: input.record.ref,
  };
  return {
    records: [reworkRequestCodec.encode(input.record)],
    claims: [],
    events: [reworkRequestRecordedCodec.encode(event)],
    commitCursorBindings: [{ refKey: canonicalKey(input.record.ref), field: 'since' }],
  };
}

/** Decodes a stored/replayed `ReworkRequestRecorded`; a foreign event or a bad payload fails closed. */
export function reworkRequestRecordedEventFromEvent(event: EncodedDomainEvent): DecodeResult<ReworkRequestRecorded> {
  return reworkRequestRecordedCodec.decode(event);
}

/** Decodes a stored/replayed `ReworkRequestClosed`; a foreign event or a bad payload fails closed. */
export function reworkRequestClosedEventFromEvent(event: EncodedDomainEvent): DecodeResult<ReworkRequestClosed> {
  return reworkRequestClosedCodec.decode(event);
}
