/**
 * Test-local field-table formats on both real RecordStore backends, for the library's own protocol rows (A9): no
 * production aggregate type or schema. `openParcels` registers `formatSchemas` of the test-local codecs through the
 * existing store opener; records are encoded by the library's codec and written through the backend's public
 * `commit`; tests read back through `readMany` and `lookupOrdered` only.
 */
import { defineEvent, defineRecord, defineShape, f } from '../../src/contracts/data-format.js';
import type { CommitCursorBinding, EncodedRecord, StoreCommitReceipt } from '../../src/core/record-store/ports.js';
import { createEventCodec, createRecordCodec, formatSchemas } from '../../src/core/work-graph/persistence/field-table-codec.js';
import { open, type TextBackend } from './S4B-text-search-support.js';

const id = f.string({ min: 1, unit: 'codePoints' });
const ParcelRef = defineShape({ name: 'ParcelRef', fields: { aggregateType: f.literal('Parcel'), projectId: id, parcelId: id } });
/** A record with a bound `since`, a nullable bound `until` and an ordered lookup by weight inside a project. */
export const parcels = createRecordCodec(defineRecord({ name: 'Parcel', schemaId: 'Parcel@1', aggregateType: 'Parcel',
  fields: { ref: f.ref(ParcelRef), revision: f.revision({ min: 1 }), weight: f.integer({ min: 0 }), since: f.boundCursor('since'), until: f.nullable(f.boundCursor('until')) },
  lookups: [{ name: 'parcel-by-weight', equal: ['ref.projectId'], orderBy: { path: 'weight', valueType: 'integer' } }] }));
const parcelMoved = createEventCodec(defineEvent({ name: 'ParcelMoved', eventType: 'ParcelMoved', schemaVersion: 1, fields: { parcelId: id } }));

export const openParcels = (kind: 'memory' | 'sqlite'): Promise<{ backend: TextBackend; dir?: string | undefined }> =>
  open(kind, { schemas: formatSchemas([parcels, parcelMoved]) });

/** A new pending parcel: `since` and `until` are left for the commit to fill or keep. */
export const parcel = (parcelId: string, weight: number): EncodedRecord =>
  parcels.encode({ ref: { aggregateType: 'Parcel', projectId: 'p1', parcelId }, revision: 1, weight, since: null, until: null });

/** One commit of new records through the public port, with one ParcelMoved event and the given cursor bindings. */
export function commitParcels(backend: TextBackend, commandId: string, records: EncodedRecord[],
  bindings: readonly CommitCursorBinding[]): Promise<StoreCommitReceipt> {
  return backend.records.commit({
    identityKey: commandId, fingerprint: `fingerprint-${commandId}`,
    guards: records.map(record => ({ refKey: record.refKey, expectedRevision: null })), records, claims: [], indexGuards: [], indexChanges: [],
    events: [parcelMoved.encode({ eventId: commandId, eventType: 'ParcelMoved', schemaVersion: 1, occurredAt: '2026-10-24T00:00:00.000Z', parcelId: 'x' })],
    commitCursorBindings: bindings,
  });
}
