/**
 * The RecordStore adapter of the field-table formats (`src/contracts/data-format.ts`): one format gives a record or
 * event codec (check, encode, decode, registration) and `formatSchemas` gathers the codecs into the schemas both
 * backends register. The value check is `checkShape` (`src/contracts/validation/data-format.ts`); this file adds only
 * the Store envelope.
 *
 * Encode never rebuilds a value: it checks the caller's value as pending and hands that same object to
 * `JSON.stringify`, so the key order and the bytes are the caller's and nothing is sorted, defaulted or derived.
 * Decode parses the stored JSON, checks the envelope the way the Store does (`decodeRefKey`, `decodeRecordBody`), then
 * the stored field check, and returns the parsed value unchanged. A record's key is `canonicalJson` of its full `ref`.
 * Events reuse the event codec factory's pipeline (outer envelope → tagged parse → outer/inner agreement → body) with
 * the field check as the body hook.
 */
import type { EventFormat, FieldPhase, Fields, InferEvent, InferPending, InferRecord, RecordFormat } from '../../../contracts/data-format.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { invalid } from '../../../contracts/validation/common.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { RecordLookupIndex } from '../../record-store/lookup-ports.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedEventSchema, EncodedRecord, EncodedRecordSchema, RecordBackendSchemas,
} from '../../record-store/ports.js';
import { decodeRecordBody, decodeRefKey } from '../../record-store/record-codec.js';
import { createEventCodec as createEnvelopeEventCodec } from './event-codec-factory.js';

export type RecordCodec<F extends Fields> = {
  check(value: unknown, phase?: FieldPhase): string | null; // default 'stored'
  encode(value: InferPending<F>): EncodedRecord; // checks 'pending' first
  decode(record: EncodedRecord): DecodeResult<InferRecord<F>>;
  registration: EncodedRecordSchema;
  lookups: readonly RecordLookupIndex[];
};

export type EventCodec<E extends string, F extends Fields> = {
  check(value: unknown, phase?: FieldPhase): string | null; // default 'stored'
  encode(event: InferEvent<E, F>): EncodedDomainEvent; // checks 'pending' first
  decode(event: EncodedDomainEvent): DecodeResult<InferEvent<E, F>>;
  registration: EncodedEventSchema;
};

/** An encode that fails its check writes nothing: it throws the first problem. */
function checked(format: RecordFormat<Fields> | EventFormat<string, Fields>, value: unknown): void {
  const problem = checkShape(format, value, 'pending');
  if (problem !== null) throw new Error(problem);
}

/** A stored record: its schema id, its envelope as the Store checks it, then the stored field check. */
function decodeRecord<F extends Fields>(format: RecordFormat<F>, record: EncodedRecord): DecodeResult<InferRecord<F>> {
  if (record.schemaId !== format.schemaId) return invalid(`expected schemaId ${format.schemaId}, got ${record.schemaId}`);
  const key = decodeRefKey(record.refKey);
  if (key.status === 'invalid') return key;
  const body = decodeRecordBody({ refKey: record.refKey, schemaId: record.schemaId, revision: record.revision, json: record.json });
  if (body.status === 'invalid') return body;
  const problem = checkShape(format, body.value.parsed, 'stored');
  return problem === null ? { status: 'decoded', value: body.value.parsed as InferRecord<F> } : invalid(problem);
}

export function createRecordCodec<const F extends Fields>(format: RecordFormat<F>): RecordCodec<F> {
  // A top-level bound cursor (directly or under f.nullable) is declared to the Store so a commit may fill it.
  const commitCursorFields = Object.values(format.fields).flatMap(field => {
    const direct = field.kind === 'nullable' ? field.field : field;
    return direct.kind === 'boundCursor' ? [direct.field] : [];
  });
  return {
    check: (value, phase = 'stored') => checkShape(format, value, phase),
    encode(value) {
      checked(format, value);
      const body = value as unknown as { ref: JsonValue; revision: number };
      return { refKey: canonicalJson(body.ref), schemaId: format.schemaId, revision: body.revision, json: JSON.stringify(value) };
    },
    decode: record => decodeRecord(format, record),
    registration: {
      schemaId: format.schemaId,
      aggregateType: format.aggregateType,
      ...(commitCursorFields.length === 0 ? {} : { commitCursorFields }),
      // The Store keeps what it validated: success returns the same encoded record.
      validate(record) {
        const decoded = decodeRecord(format, record);
        return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
      },
    },
    lookups: format.lookups.map(lookup => ({
      name: lookup.name,
      aggregateType: format.aggregateType,
      paths: lookup.equal,
      ...(lookup.orderBy === undefined ? {} : { orderBy: lookup.orderBy }),
      ...(lookup.text === undefined ? {} : { text: { paths: lookup.text } }),
    })),
  };
}

/** The event codec factory's pipeline with the field check as its body hook (the four envelope keys included). */
function envelopeCodec<E extends string, F extends Fields>(format: EventFormat<E, F>) {
  return createEnvelopeEventCodec<InferEvent<E, F>>({
    eventType: format.eventType, schemaVersion: 1, jsonLabel: format.name,
    bodyProblem: value => checkShape(format, value, 'stored'),
  });
}

function decodeEvent<E extends string, F extends Fields>(format: EventFormat<E, F>, event: EncodedDomainEvent): DecodeResult<InferEvent<E, F>> {
  const decoded = envelopeCodec(format).decodeBody(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: decoded.value as InferEvent<E, F> } : decoded;
}

export function createEventCodec<const E extends string, const F extends Fields>(format: EventFormat<E, F>): EventCodec<E, F> {
  const envelope = envelopeCodec(format);
  return {
    check: (value, phase = 'stored') => checkShape(format, value, phase),
    encode(event) {
      checked(format, event);
      return envelope.encode(event);
    },
    decode: event => decodeEvent(format, event),
    registration: envelope.registration,
  };
}

/**
 * The schemas both backends register for these codecs. A second record with the same schema id or aggregate type, or
 * a second event with the same type and version, is a description error: the Store selects a codec by those keys.
 * It takes whole codecs over the empty field set: a codec of any concrete format fits (its encode parameter is a
 * method parameter, its decode result a narrower value), while the wide `Fields` would expand the recursive inferred
 * types until the type checker gives up.
 */
export function formatSchemas(codecs: readonly (RecordCodec<{}> | EventCodec<string, {}>)[]): RecordBackendSchemas {
  const records: EncodedRecordSchema[] = [];
  const events: EncodedEventSchema[] = [];
  const lookups: RecordLookupIndex[] = [];
  const seen = new Set<string>();
  const once = (key: string, what: string) => {
    if (seen.has(key)) throw new Error(`format schemas description is invalid: ${what} is registered twice`);
    seen.add(key);
  };
  for (const codec of codecs) {
    if ('lookups' in codec) {
      once(`schemaId ${codec.registration.schemaId}`, `record schemaId ${codec.registration.schemaId}`);
      once(`aggregateType ${codec.registration.aggregateType}`, `record aggregateType ${codec.registration.aggregateType}`);
      records.push(codec.registration);
      lookups.push(...codec.lookups);
    } else {
      once(`event ${codec.registration.eventType}@${codec.registration.schemaVersion}`,
        `event ${codec.registration.eventType}@${codec.registration.schemaVersion}`);
      events.push(codec.registration);
    }
  }
  return { records, events, lookups };
}
