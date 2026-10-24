/**
 * Storage rows of the field-table adapter (A9, both backends): its registration is accepted by the real stores, a
 * bound cursor is filled at commit and the stored value passes the stored check, a refused commit writes nothing,
 * and a format lookup orders and pages. The formats are test-local (`tests/helpers/field-table-fixture.ts`).
 */
import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { commitParcels, openParcels, parcel, parcels } from '../helpers/field-table-fixture.js';
import type { TextBackend } from '../helpers/S4B-text-search-support.js';

describe.each(['memory', 'sqlite'] as const)('field-table records on %s', kind => {
  let opened: { backend: TextBackend; dir?: string | undefined } | undefined;
  afterEach(async () => {
    await opened?.backend.close();
    if (opened?.dir !== undefined) await rm(opened.dir, { recursive: true, force: true });
  });

  it('fills the listed bound cursors at commit, a nullable one too; an unlisted nullable one stays null', async () => {
    opened = await openParcels(kind);
    const [a, b] = [parcel('a', 5), parcel('b', 1)];
    const receipt = await commitParcels(opened.backend, 'one', [a, b],
      [{ refKey: a.refKey, field: 'since' }, { refKey: b.refKey, field: 'since' }, { refKey: b.refKey, field: 'until' }]);
    if (receipt.status !== 'committed') throw new Error(`commit refused: ${receipt.reason}`);
    const read = await opened.backend.records.readMany([a.refKey, b.refKey]);
    const stored = read.status === 'ready' ? [a, b].map(row => read.value.records.find(record => record.refKey === row.refKey))
      .map(row => (row === undefined ? 'missing' : parcels.decode(row))) : read;
    const expected = (parcelId: string, weight: number, until: string | null) =>
      ({ status: 'decoded', value: { ref: { aggregateType: 'Parcel', projectId: 'p1', parcelId }, revision: 1, weight, since: receipt.cursor, until } });
    expect(stored).toEqual([expected('a', 5, null), expected('b', 1, receipt.cursor)]);
  });

  it('refuses a commit whose unlisted bound cursor is still null, and writes nothing', async () => {
    opened = await openParcels(kind);
    const record = parcel('a', 5);
    expect(await commitParcels(opened.backend, 'one', [record], [])).toEqual({
      status: 'rejected', code: 'invalid', reason: 'record schema Parcel@1 rejected the record: Parcel.since is invalid',
    });
    const read = await opened.backend.records.readMany([record.refKey]);
    expect(read.status === 'ready' && read.value.missing).toEqual([record.refKey]);
  });

  it('orders a format lookup by its order column and pages it', async () => {
    opened = await openParcels(kind);
    const rows = [parcel('a', 5), parcel('b', 1), parcel('c', 3)];
    const receipt = await commitParcels(opened.backend, 'all', rows, rows.map(row => ({ refKey: row.refKey, field: 'since' as const })));
    expect(receipt.status).toBe('committed');
    const request = { index: 'parcel-by-weight', values: ['p1'], direction: 'asc' as const, limit: 2 };
    const first = await opened.backend.records.lookupOrdered(request);
    if (first.status !== 'ready') throw new Error(first.reason);
    const second = await opened.backend.records.lookupOrdered({ ...request, ...(first.value.next === null ? {} : { after: first.value.next }) });
    if (second.status !== 'ready') throw new Error(second.reason);
    const weights = (page: typeof first.value) => page.records.map(row => parcels.decode(row)).map(row => (row.status === 'decoded' ? row.value.weight : row.reason));
    expect([weights(first.value), first.value.next?.order, weights(second.value), second.value.next]).toEqual([[1, 3], 3, [5], null]);
  });
});
