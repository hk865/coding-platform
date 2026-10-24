/**
 * The ordered lookup's direction-free lower bound, on both RecordStore backends
 * (the main read's no-goal view: a descending continuation that must stop above
 * the first goal's creation, whatever the keyset says).
 *
 * Rows: a descending keyset read stops at an exclusive or inclusive lower bound
 * and pages to it; an ascending read starts above it; a lower bound that is not
 * an order value, or has no `inclusive`, is invalid.
 *
 * Every row is committed through the public `commit` port; the expected
 * identities and cursors are literal values in this file.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import {
  keyOf, open as openStore, seed, widget, widgetSchemas, type TextBackend,
} from '../helpers/S4B-text-search-support.js';

const lowerIndex = { name: 's6a-lower-by-group', aggregateType: 'Widget', paths: ['group'], orderBy: { path: 'label' } };
const schemas: RecordBackendSchemas = { ...widgetSchemas, lookups: [...(widgetSchemas.lookups ?? []), lowerIndex] };

const open: { backend: TextBackend; dir?: string | undefined }[] = [];
afterEach(async () => {
  for (const entry of open.splice(0)) {
    await entry.backend.close();
    if (entry.dir !== undefined) await rm(entry.dir, { recursive: true, force: true });
  }
});

/** A backend with five rows labelled a…e in one group. */
async function fiveRows(kind: 'memory' | 'sqlite', label: string): Promise<TextBackend> {
  const opened = await openStore(kind, { schemas });
  open.push(opened);
  await seed(opened.backend, ['a', 'b', 'c', 'd', 'e'].map(id => widget('p', id, { group: 'g', label: id })), label);
  return opened.backend;
}

const base = { index: lowerIndex.name, values: ['g'], limit: 10 } as const;

describe.each(['memory', 'sqlite'] as const)('the ordered lookup lower bound (%s)', kind => {
  it('a descending keyset read stops at the lower bound: exclusive above it, inclusive at it', async () => {
    const backend = await fiveRows(kind, 'desc');
    const after = { order: 'd', refKey: keyOf('p', 'd') };
    expect(await backend.records.lookupOrdered({ ...base, direction: 'desc', after, lowerBound: { value: 'b', inclusive: false } }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyOf('p', 'c') }], next: null } });
    expect(await backend.records.lookupOrdered({ ...base, direction: 'desc', after, lowerBound: { value: 'b', inclusive: true } }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyOf('p', 'c') }, { refKey: keyOf('p', 'b') }], next: null } });
  });

  it('a descending read pages down to the lower bound and no further', async () => {
    const backend = await fiveRows(kind, 'pages');
    const request = { ...base, direction: 'desc' as const, lowerBound: { value: 'c', inclusive: false }, limit: 1 };
    expect(await backend.records.lookupOrdered(request)).toMatchObject({ status: 'ready',
      value: { records: [{ refKey: keyOf('p', 'e') }], next: { order: 'e', refKey: keyOf('p', 'e') } } });
    expect(await backend.records.lookupOrdered({ ...request, after: { order: 'e', refKey: keyOf('p', 'e') } }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyOf('p', 'd') }], next: null } });
  });

  it('an ascending read starts above the lower bound', async () => {
    const backend = await fiveRows(kind, 'asc');
    expect(await backend.records.lookupOrdered({ ...base, direction: 'asc', lowerBound: { value: 'c', inclusive: false } }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyOf('p', 'd') }, { refKey: keyOf('p', 'e') }], next: null } });
  });

  describe('rejects: the lower bound', () => {
    it('a lower bound whose value is not an order value is invalid', async () => {
      const backend = await fiveRows(kind, 'bad-value');
      expect(await backend.records.lookupOrdered({ ...base, direction: 'desc', lowerBound: { value: '', inclusive: false } }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    });

    it('a lower bound without inclusive is invalid', async () => {
      const backend = await fiveRows(kind, 'bad-inclusive');
      expect(await backend.records.lookupOrdered({ ...base, direction: 'desc', lowerBound: { value: 'b' } } as never))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    });
  });
});
