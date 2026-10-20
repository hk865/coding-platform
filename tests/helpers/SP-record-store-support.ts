/**
 * Shared support for the two SP store-contract files
 * (`SP-literal-type.test.ts`, `SP-lookup-index-migration.test.ts`).
 *
 * Rule sheet v2 A1 (the record store's own tests): the store's ports are the
 * public step. Every record here is built as a plain value and committed
 * through the backend's public `commit`; expected values stay in the test
 * files as literals. `open` stays local because the two files open different
 * backends.
 */
import type {
  EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort,
} from '../../src/core/record-store/ports.js';

const at = '2026-10-16T00:00:00.000Z';

export function recordSchema(aggregateType: string) {
  return {
    schemaId: `${aggregateType}@1`,
    aggregateType,
    validate: (record: EncodedRecord) => {
      const body: unknown = JSON.parse(record.json);
      if (typeof body !== 'object' || body === null || !('ref' in body)) {
        return { status: 'invalid' as const, reason: 'ref missing' };
      }
      return { status: 'decoded' as const, value: record };
    },
  };
}

export function event(id: string): EncodedDomainEvent {
  return {
    eventId: id, eventType: 'Changed', schemaVersion: 1, occurredAt: at,
    json: JSON.stringify({ eventId: id, eventType: 'Changed', schemaVersion: 1, occurredAt: at }),
  };
}

export const keyW = (id: string) => `{"aggregateType":"W","id":${JSON.stringify(id)}}`;
export const keyV = (id: string) => `{"aggregateType":"V","id":${JSON.stringify(id)}}`;

/**
 * A W/V record. `defaultBody` is expanded before the caller's body, so the
 * caller's fields win (`SP-literal-type` passes `{ group: 'shared' }`; the
 * migration file passes the empty default).
 */
export function typed(
  aggregateType: 'W' | 'V',
  id: string,
  body: Record<string, unknown>,
  defaultBody: Record<string, unknown> = {},
): EncodedRecord {
  return {
    refKey: aggregateType === 'W' ? keyW(id) : keyV(id),
    schemaId: `${aggregateType}@1`,
    revision: 1,
    json: JSON.stringify({ ref: { aggregateType, id }, revision: 1, ...defaultBody, ...body }),
  };
}

export function commitRow(backend: { records: GoalRecordTransactionPort }, id: string, row: EncodedRecord): Promise<unknown> {
  return backend.records.commit({
    identityKey: id, fingerprint: `fp-${id}`, guards: [{ refKey: row.refKey, expectedRevision: null }],
    records: [row], events: [event(id)], claims: [], indexGuards: [], indexChanges: [],
  });
}
