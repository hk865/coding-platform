/**
 * Slice 2A QE1: the public `lookupOrdered` of both RecordStore backends.
 *
 * Rows: QA-01 (text order, candidates, keyset continuation), QA-02 (bounds,
 * `after`, invalid requests and registration), QA-03 (SQLite builds the ordered
 * index over existing rows on reopen), QA-15 (integer order).
 *
 * Every dataset is committed through the public `commit` port; the expected
 * identities, orders and page cursors are literal values in this file. No
 * product comparison function computes an expectation.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EncodedRecord, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { OrderedLookupRequest } from '../../src/core/record-store/lookup-ports.js';
import {
  change, keyOf, open as openStore, seed, widget, widgetSchemas as baseWidgetSchemas, type TextBackend,
} from '../helpers/S4B-text-search-support.js';

const textIndex = { name: 's2a-text-by-group', aggregateType: 'Widget', paths: ['group'], orderBy: { path: 'label' } };
const integerIndex = {
  name: 's2a-integer-by-group', aggregateType: 'Widget', paths: ['group'], orderBy: { path: 'rank', valueType: 'integer' },
};
const plainIndex = { name: 's2a-plain-by-group', aggregateType: 'Widget', paths: ['group'] };

// S2A's own three indexes: the shared record/event schemas plus these lookups.
const widgetSchemas: RecordBackendSchemas = { ...baseWidgetSchemas, lookups: [textIndex, integerIndex, plainIndex] };

function withLookups(lookups: unknown): RecordBackendSchemas {
  return { ...widgetSchemas, lookups: lookups as NonNullable<RecordBackendSchemas['lookups']> };
}

const temp: string[] = [];
afterEach(async () => { for (const dir of temp.splice(0)) await rm(dir, { recursive: true, force: true }); });

// Every open passes this file's schemas explicitly; the shared open creates the
// temporary directory, which the wrapper registers for cleanup.
async function open(
  kind: 'memory' | 'sqlite',
  overrides: { schemas?: RecordBackendSchemas; path?: string } = {},
): Promise<{ backend: TextBackend; path?: string }> {
  const opened = await openStore(kind, {
    schemas: overrides.schemas ?? widgetSchemas,
    ...(overrides.path === undefined ? {} : { path: overrides.path }),
  });
  if (opened.dir !== undefined) temp.push(opened.dir);
  return opened;
}

type Page = { records: string[]; next: { order: string | number; refKey: string } | null };

async function pageThrough(backend: TextBackend, request: {
  index: string;
  values: readonly string[];
  direction: 'asc' | 'desc';
  bound?: { value: string | number; inclusive: boolean };
  limit: number;
}): Promise<Page[]> {
  const pages: Page[] = [];
  let after: { order: string | number; refKey: string } | undefined;
  for (;;) {
    const page = await backend.records.lookupOrdered({
      index: request.index,
      values: request.values,
      direction: request.direction,
      ...(request.bound === undefined ? {} : { bound: request.bound }),
      ...(after === undefined ? {} : { after }),
      limit: request.limit,
    });
    if (page.status !== 'ready') throw new Error(`ordered lookup failed: ${page.reason}`);
    pages.push({ records: page.value.records.map((record) => record.refKey), next: page.value.next });
    if (page.value.next === null) break;
    after = page.value.next;
  }
  return pages;
}

/** One page's literal identities and cursor, for the continuation cases. */
async function pageOf(
  backend: TextBackend,
  request: OrderedLookupRequest,
): Promise<{ records: string[]; next: Page['next'] }> {
  const page = await backend.records.lookupOrdered(request);
  if (page.status !== 'ready') throw new Error(`ordered lookup failed: ${page.reason}`);
  return { records: page.value.records.map((record) => record.refKey), next: page.value.next };
}

// --------------------------------------------------------------------------
// QA-01
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'QA-01 %s: text order is UTF-8 byte order, non-candidates never appear, and same-order rows continue by refKey',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      widget('p', 'unsafe', { group: 'text', label: 'x' });
      const rows = [
        widget('p', 's1', { group: 'text', label: 'same' }),
        widget('p', 's2', { group: 'text', label: 'same' }),
        widget('p', 's3', { group: 'text', label: 'same' }),
        widget('p', 'zz', { group: 'text', label: 't' }),
        widget('p', 'e0', { group: 'text', label: '\uE000' }),
        widget('p', 'p0', { group: 'text', label: '\u{10000}' }),
        widget('p', 'n1', { group: 'text' }),
        widget('p', 'n2', { group: 'text', label: null }),
        widget('p', 'n3', { group: 'text', label: 7 }),
        widget('p', 'n4', { group: 'text', label: true }),
        widget('p', 'n5', { group: 'text', label: '' }),
      ];
      await seed(backend, rows, 'qa01');

      expect(await pageThrough(backend, { index: textIndex.name, values: ['text'], direction: 'asc', limit: 2 }))
        .toEqual([
          { records: [keyOf('p', 's1'), keyOf('p', 's2')], next: { order: 'same', refKey: keyOf('p', 's2') } },
          { records: [keyOf('p', 's3'), keyOf('p', 'zz')], next: { order: 't', refKey: keyOf('p', 'zz') } },
          { records: [keyOf('p', 'e0'), keyOf('p', 'p0')], next: null },
        ]);
      expect(await pageThrough(backend, { index: textIndex.name, values: ['text'], direction: 'desc', limit: 2 }))
        .toEqual([
          { records: [keyOf('p', 'p0'), keyOf('p', 'e0')], next: { order: '\uE000', refKey: keyOf('p', 'e0') } },
          { records: [keyOf('p', 'zz'), keyOf('p', 's3')], next: { order: 'same', refKey: keyOf('p', 's3') } },
          { records: [keyOf('p', 's2'), keyOf('p', 's1')], next: null },
        ]);
    } finally {
      await backend.close();
    }
  },
  600_000,
);

it.each(['memory', 'sqlite'] as const)(
  'QA-01 %s: rows with the SAME order value break ties by the UTF-8 bytes of the refKey',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      // The two refKeys differ only in the widget id, at the same position.
      // U+E000 is one BMP code unit (0xE000); U+10000 is the surrogate pair
      // D800 DC00, so JS UTF-16 order would put U+10000 first. The UTF-8 bytes
      // are EE 80 80 and F0 90 80 80, so the L1 rule orders U+E000 first.
      const e000 = '\uE000';
      const supplementary = '\u{10000}';
      await seed(backend, [
        widget('p', supplementary, { group: 'key-order', label: 'tie' }),
        widget('p', e000, { group: 'key-order', label: 'tie' }),
      ], 'qa01-key');
      expect(await pageThrough(backend, { index: textIndex.name, values: ['key-order'], direction: 'asc', limit: 1 }))
        .toEqual([
          { records: [keyOf('p', e000)], next: { order: 'tie', refKey: keyOf('p', e000) } },
          { records: [keyOf('p', supplementary)], next: null },
        ]);
      expect(await pageThrough(backend, { index: textIndex.name, values: ['key-order'], direction: 'desc', limit: 1 }))
        .toEqual([
          { records: [keyOf('p', supplementary)], next: { order: 'tie', refKey: keyOf('p', supplementary) } },
          { records: [keyOf('p', e000)], next: null },
        ]);
    } finally {
      await backend.close();
    }
  },
  600_000,
);

// --------------------------------------------------------------------------
// QA-02
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'QA-02 %s: inclusive and exclusive bounds read exactly the range each side names',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      await seed(backend, [
        widget('p', 'a', { group: 'bounds', label: 'a' }),
        widget('p', 'b', { group: 'bounds', label: 'b' }),
        widget('p', 'c', { group: 'bounds', label: 'c' }),
        widget('p', 'd', { group: 'bounds', label: 'd' }),
      ], 'qa02-bound');
      const request = { index: textIndex.name, values: ['bounds'], direction: 'asc' as const, limit: 10 };
      expect(await backend.records.lookupOrdered({ ...request, bound: { value: 'b', inclusive: false } }))
        .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyOf('p', 'c') }, { refKey: keyOf('p', 'd') }], next: null } });
      expect(await backend.records.lookupOrdered({ ...request, bound: { value: 'b', inclusive: true } }))
        .toMatchObject({
          status: 'ready',
          value: { records: [{ refKey: keyOf('p', 'b') }, { refKey: keyOf('p', 'c') }, { refKey: keyOf('p', 'd') }], next: null },
        });
      expect(await backend.records.lookupOrdered({ ...request, direction: 'desc', bound: { value: 'c', inclusive: true } }))
        .toMatchObject({
          status: 'ready',
          value: { records: [{ refKey: keyOf('p', 'c') }, { refKey: keyOf('p', 'b') }, { refKey: keyOf('p', 'a') }], next: null },
        });
      expect(await backend.records.lookupOrdered({ ...request, direction: 'desc', bound: { value: 'c', inclusive: false } }))
        .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyOf('p', 'b') }, { refKey: keyOf('p', 'a') }], next: null } });
      expect(await backend.records.lookupOrdered({ ...request, bound: { value: 'z', inclusive: true } }))
        .toMatchObject({ status: 'ready', value: { records: [], next: null } });
    } finally {
      await backend.close();
    }
  },
  600_000,
);

it.each(['memory', 'sqlite'] as const)(
  'QA-02 %s: bound and after intersect; after before the bound starts from the bound',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      await seed(backend, [
        widget('p', 'a', { group: 'bounds', label: 'a' }),
        widget('p', 'b', { group: 'bounds', label: 'b' }),
        widget('p', 'c', { group: 'bounds', label: 'c' }),
        widget('p', 'd', { group: 'bounds', label: 'd' }),
      ], 'qa02-after');
      expect(await backend.records.lookupOrdered({
        index: textIndex.name, values: ['bounds'], direction: 'asc', limit: 10,
        bound: { value: 'b', inclusive: true }, after: { order: 'c', refKey: keyOf('p', 'c') },
      })).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyOf('p', 'd') }], next: null } });
      expect(await backend.records.lookupOrdered({
        index: textIndex.name, values: ['bounds'], direction: 'asc', limit: 10,
        bound: { value: 'c', inclusive: true }, after: { order: 'a', refKey: keyOf('p', 'a') },
      })).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyOf('p', 'c') }, { refKey: keyOf('p', 'd') }], next: null } });
      expect(await backend.records.lookupOrdered({
        index: textIndex.name, values: ['bounds'], direction: 'desc', limit: 10,
        bound: { value: 'c', inclusive: true }, after: { order: 'b', refKey: keyOf('p', 'b') },
      })).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyOf('p', 'a') }], next: null } });
    } finally {
      await backend.close();
    }
  },
  600_000,
);

it.each(['memory', 'sqlite'] as const)(
  'QA-02 %s: every malformed ordered request is invalid and never throws',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      const base = { index: textIndex.name, values: ['bounds'], direction: 'asc', limit: 10 };
      const invalidRequests: unknown[] = [
        { index: textIndex.name, values: ['bounds'], direction: 'up', limit: 10 },
        { ...base, limit: 0 },
        { ...base, limit: 201 },
        { ...base, limit: 1.5 },
        { ...base, limit: '10' },
        { ...base, values: [] },
        { ...base, values: ['bounds', 'extra'] },
        { ...base, values: [null] },
        { ...base, values: [7] },
        { ...base, values: [true] },
        { ...base, values: [''] },
        { ...base, bound: { value: 'b' } },
        { ...base, bound: { value: 'b', inclusive: 'yes' } },
        { ...base, bound: { value: 7, inclusive: true } },
        { ...base, after: { order: 'c' } },
        { ...base, after: { refKey: keyOf('p', 'c') } },
        { ...base, after: { order: 7, refKey: keyOf('p', 'c') } },
        { ...base, after: { order: 'c', refKey: 'not-a-ref' } },
        { ...base, after: { order: 'c', refKey: JSON.stringify({ aggregateType: 'Other', projectId: 'p', widgetId: 'c' }) } },
        { ...base, values: ['bounds', 7, 'x'] },
        'not-an-object',
        { ...base, values: 'bounds' },
      ];
      for (const request of invalidRequests) {
        expect(await backend.records.lookupOrdered(request as OrderedLookupRequest))
          .toMatchObject({ status: 'rejected', code: 'invalid' });
      }
      expect(await backend.records.lookupOrdered({ index: 's2a-does-not-exist', values: ['bounds'], direction: 'asc', limit: 10 }))
        .toMatchObject({ status: 'rejected', code: 'unsupported' });
      expect(await backend.records.lookupOrdered({ index: plainIndex.name, values: ['bounds'], direction: 'asc', limit: 10 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
  600_000,
);

it.each(['memory', 'sqlite'] as const)(
  'QA-02 %s: registration rejects an unsafe orderBy path, a bad valueType and a non-object orderBy',
  async (kind) => {
    const badRegistrations: unknown[] = [
      withLookups([{ ...textIndex, orderBy: { path: 'group..label' } }]),
      withLookups([{ ...textIndex, orderBy: { path: '__proto__' } }]),
      withLookups([{ ...textIndex, orderBy: { path: 'label', valueType: 'date' } }]),
      withLookups([{ ...textIndex, orderBy: 'label' }]),
    ];
    for (const schemas of badRegistrations) {
      const outcome = await open(kind, { schemas: schemas as RecordBackendSchemas }).then(
        async (created) => { await created.backend.close(); return 'accepted'; },
        () => 'rejected',
      );
      expect(outcome).toBe('rejected');
    }
  },
  600_000,
);

// --------------------------------------------------------------------------
// QA-03
// --------------------------------------------------------------------------

it('QA-03 sqlite: an ordered index built on existing rows finds them after reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's2a-ordered-existing-'));
  temp.push(dir);
  const path = join(dir, 'records.sqlite');
  const first = (await open('sqlite', {
    path,
    schemas: withLookups([{ name: textIndex.name, aggregateType: 'Widget', paths: ['group'] }]),
  })).backend;
  const rows = [
    widget('p', 'old-b', { group: 'legacy', label: 'b' }),
    widget('p', 'old-a', { group: 'legacy', label: 'a' }),
  ];
  for (const [position, row] of rows.entries()) {
    expect(await first.records.commit(change(`qa03-${String(position)}`, row))).toMatchObject({ status: 'committed' });
  }
  await first.close();
  const reopened = (await open('sqlite', { path })).backend;
  try {
    expect(await reopened.records.lookupOrdered({
      index: textIndex.name, values: ['legacy'], direction: 'asc', limit: 10,
    })).toMatchObject({
      status: 'ready',
      value: { records: [{ refKey: keyOf('p', 'old-a') }, { refKey: keyOf('p', 'old-b') }], next: null },
    });
  } finally {
    await reopened.close();
  }
}, 600_000);

// --------------------------------------------------------------------------
// QA-15
// --------------------------------------------------------------------------

function integerRows(): EncodedRecord[] {
  const unsafe = widget('p', 'unsafe', { group: 'int', rank: 0 });
  unsafe.json = unsafe.json.replace('"rank":0', '"rank":9007199254740993');
  return [
    widget('p', 'neg', { group: 'int', rank: -5 }),
    widget('p', 'zero', { group: 'int', rank: 0 }),
    widget('p', 'two', { group: 'int', rank: 2 }),
    widget('p', 'two-b', { group: 'int', rank: 2 }),
    widget('p', 'two-c', { group: 'int', rank: 2 }),
    widget('p', 'ten', { group: 'int', rank: 10 }),
    widget('p', 'max', { group: 'int', rank: 9007199254740991 }),
    widget('p', 'real', { group: 'int', rank: 2.5 }),
    widget('p', 'text', { group: 'int', rank: '10' }),
    widget('p', 'null', { group: 'int', rank: null }),
    widget('p', 'missing', { group: 'int' }),
    unsafe,
  ];
}

it.each(['memory', 'sqlite'] as const)(
  'QA-15 %s: integer order is numeric, same-value pages continue by refKey, and non-integers are not candidates',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      await seed(backend, integerRows(), 'qa15-order');
      expect(await pageThrough(backend, { index: integerIndex.name, values: ['int'], direction: 'asc', limit: 2 }))
        .toEqual([
          { records: [keyOf('p', 'neg'), keyOf('p', 'zero')], next: { order: 0, refKey: keyOf('p', 'zero') } },
          { records: [keyOf('p', 'two'), keyOf('p', 'two-b')], next: { order: 2, refKey: keyOf('p', 'two-b') } },
          { records: [keyOf('p', 'two-c'), keyOf('p', 'ten')], next: { order: 10, refKey: keyOf('p', 'ten') } },
          { records: [keyOf('p', 'max')], next: null },
        ]);
      expect(await pageThrough(backend, { index: integerIndex.name, values: ['int'], direction: 'desc', limit: 2 }))
        .toEqual([
          { records: [keyOf('p', 'max'), keyOf('p', 'ten')], next: { order: 10, refKey: keyOf('p', 'ten') } },
          { records: [keyOf('p', 'two-c'), keyOf('p', 'two-b')], next: { order: 2, refKey: keyOf('p', 'two-b') } },
          { records: [keyOf('p', 'two'), keyOf('p', 'zero')], next: { order: 0, refKey: keyOf('p', 'zero') } },
          { records: [keyOf('p', 'neg')], next: null },
        ]);
    } finally {
      await backend.close();
    }
  },
  600_000,
);

it.each(['memory', 'sqlite'] as const)(
  'QA-15 %s: legal integer bounds are inclusive/exclusive exactly as asked',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      await seed(backend, integerRows(), 'qa15-bound');
      const request = { index: integerIndex.name, values: ['int'], direction: 'asc' as const, limit: 10 };
      expect(await backend.records.lookupOrdered({ ...request, bound: { value: 0, inclusive: true } }))
        .toMatchObject({
          status: 'ready',
          value: {
            records: [
              { refKey: keyOf('p', 'zero') }, { refKey: keyOf('p', 'two') }, { refKey: keyOf('p', 'two-b') },
              { refKey: keyOf('p', 'two-c') }, { refKey: keyOf('p', 'ten') }, { refKey: keyOf('p', 'max') },
            ],
            next: null,
          },
        });
      expect(await backend.records.lookupOrdered({ ...request, bound: { value: 0, inclusive: false } }))
        .toMatchObject({
          status: 'ready',
          value: {
            records: [
              { refKey: keyOf('p', 'two') }, { refKey: keyOf('p', 'two-b') }, { refKey: keyOf('p', 'two-c') },
              { refKey: keyOf('p', 'ten') }, { refKey: keyOf('p', 'max') },
            ],
            next: null,
          },
        });
      expect(await backend.records.lookupOrdered({ ...request, direction: 'desc', bound: { value: 10, inclusive: true } }))
        .toMatchObject({
          status: 'ready',
          value: {
            records: [
              { refKey: keyOf('p', 'ten') }, { refKey: keyOf('p', 'two-c') }, { refKey: keyOf('p', 'two-b') },
              { refKey: keyOf('p', 'two') }, { refKey: keyOf('p', 'zero') }, { refKey: keyOf('p', 'neg') },
            ],
            next: null,
          },
        });
      expect(await backend.records.lookupOrdered({ ...request, direction: 'desc', bound: { value: 10, inclusive: false } }))
        .toMatchObject({
          status: 'ready',
          value: {
            records: [
              { refKey: keyOf('p', 'two-c') }, { refKey: keyOf('p', 'two-b') }, { refKey: keyOf('p', 'two') },
              { refKey: keyOf('p', 'zero') }, { refKey: keyOf('p', 'neg') },
            ],
            next: null,
          },
        });
    } finally {
      await backend.close();
    }
  },
  600_000,
);

it.each(['memory', 'sqlite'] as const)(
  'QA-15 %s: request values of the wrong type, unsafe integers, fractions, NaN and Infinity are invalid',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      const integerBase = { index: integerIndex.name, values: ['int'], direction: 'asc', limit: 10 };
      const textBase = { index: textIndex.name, values: ['int'], direction: 'asc', limit: 10 };
      const invalidRequests: unknown[] = [
        { ...integerBase, bound: { value: '10', inclusive: true } },
        { ...integerBase, bound: { value: 9007199254740992, inclusive: true } },
        { ...integerBase, bound: { value: 1.5, inclusive: true } },
        { ...integerBase, bound: { value: Number.NaN, inclusive: true } },
        { ...integerBase, bound: { value: Number.POSITIVE_INFINITY, inclusive: true } },
        { ...integerBase, after: { order: '10', refKey: keyOf('p', 'ten') } },
        { ...integerBase, after: { order: 1.5, refKey: keyOf('p', 'ten') } },
        { ...integerBase, after: { order: 9007199254740992, refKey: keyOf('p', 'ten') } },
        { ...integerBase, after: { order: Number.NaN, refKey: keyOf('p', 'ten') } },
        { ...integerBase, after: { order: Number.POSITIVE_INFINITY, refKey: keyOf('p', 'ten') } },
        { ...integerBase, after: { order: Number.NEGATIVE_INFINITY, refKey: keyOf('p', 'ten') } },
        { ...textBase, bound: { value: 10, inclusive: true } },
        { ...textBase, after: { order: 10, refKey: keyOf('p', 'ten') } },
        { ...textBase, after: { order: 9007199254740992, refKey: keyOf('p', 'ten') } },
        { ...textBase, after: { order: Number.NaN, refKey: keyOf('p', 'ten') } },
        { ...textBase, after: { order: Number.POSITIVE_INFINITY, refKey: keyOf('p', 'ten') } },
      ];
      for (const request of invalidRequests) {
        expect(await backend.records.lookupOrdered(request as OrderedLookupRequest))
          .toMatchObject({ status: 'rejected', code: 'invalid' });
      }
    } finally {
      await backend.close();
    }
  },
  600_000,
);

// --------------------------------------------------------------------------
// QA-02 continuation: the five bound/after intersections. Results do not change
// with the round-4 single-range-term rewrite; these guard it.
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'QA-02 %s: text continuation starts at after-or-bound and equal-order ties stay decided by refKey',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      await seed(backend, [
        widget('p', 'm2', { group: 'cont', label: 'm' }),
        widget('p', 'z', { group: 'cont', label: 'z' }),
        widget('p', 'a', { group: 'cont', label: 'a' }),
        widget('p', 'm3', { group: 'cont', label: 'm' }),
        widget('p', 'b', { group: 'cont', label: 'b' }),
        widget('p', 'm1', { group: 'cont', label: 'm' }),
      ], 'qa02-cont');
      const request = { index: textIndex.name, values: ['cont'], direction: 'asc' as const, limit: 10 };

      // Normal continuation: after is past the bound, so the lower term is after.
      expect(await pageOf(backend, {
        ...request, bound: { value: 'a', inclusive: true }, after: { order: 'm', refKey: keyOf('p', 'm2') },
      })).toEqual({ records: [keyOf('p', 'm3'), keyOf('p', 'z')], next: null });
      // after before the bound: results start at the bound, the keyset is implied.
      expect(await pageOf(backend, {
        ...request, bound: { value: 'm', inclusive: true }, after: { order: 'a', refKey: keyOf('p', 'a') },
      })).toEqual({
        records: [keyOf('p', 'm1'), keyOf('p', 'm2'), keyOf('p', 'm3'), keyOf('p', 'z')], next: null,
      });
      // after.order equals an exclusive bound: only the strict bound term remains.
      expect(await pageOf(backend, {
        ...request, bound: { value: 'm', inclusive: false }, after: { order: 'm', refKey: keyOf('p', 'm1') },
      })).toEqual({ records: [keyOf('p', 'z')], next: null });
      // after.order equals an inclusive bound: refKey decides the tied order value.
      expect(await pageOf(backend, {
        ...request, bound: { value: 'm', inclusive: true }, after: { order: 'm', refKey: keyOf('p', 'm1') },
      })).toEqual({ records: [keyOf('p', 'm2'), keyOf('p', 'm3'), keyOf('p', 'z')], next: null });
      // after only, no bound.
      expect(await pageOf(backend, { ...request, after: { order: 'a', refKey: keyOf('p', 'a') } }))
        .toEqual({
          records: [keyOf('p', 'b'), keyOf('p', 'm1'), keyOf('p', 'm2'), keyOf('p', 'm3'), keyOf('p', 'z')],
          next: null,
        });
      expect(await pageOf(backend, { ...request, limit: 2, after: { order: 'a', refKey: keyOf('p', 'a') } }))
        .toEqual({ records: [keyOf('p', 'b'), keyOf('p', 'm1')], next: { order: 'm', refKey: keyOf('p', 'm1') } });

      const desc = { ...request, direction: 'desc' as const };
      // Normal continuation (mirror): after is past the bound.
      expect(await pageOf(backend, {
        ...desc, bound: { value: 'z', inclusive: true }, after: { order: 'm', refKey: keyOf('p', 'm3') },
      })).toEqual({ records: [keyOf('p', 'm2'), keyOf('p', 'm1'), keyOf('p', 'b'), keyOf('p', 'a')], next: null });
      // after before the bound (mirror): results start at the bound.
      expect(await pageOf(backend, {
        ...desc, bound: { value: 'm', inclusive: true }, after: { order: 'z', refKey: keyOf('p', 'z') },
      })).toEqual({
        records: [keyOf('p', 'm3'), keyOf('p', 'm2'), keyOf('p', 'm1'), keyOf('p', 'b'), keyOf('p', 'a')], next: null,
      });
      // after.order equals an exclusive bound (mirror).
      expect(await pageOf(backend, {
        ...desc, bound: { value: 'm', inclusive: false }, after: { order: 'm', refKey: keyOf('p', 'm3') },
      })).toEqual({ records: [keyOf('p', 'b'), keyOf('p', 'a')], next: null });
      // after.order equals an inclusive bound (mirror): refKey decides the ties.
      expect(await pageOf(backend, {
        ...desc, bound: { value: 'm', inclusive: true }, after: { order: 'm', refKey: keyOf('p', 'm3') },
      })).toEqual({ records: [keyOf('p', 'm2'), keyOf('p', 'm1'), keyOf('p', 'b'), keyOf('p', 'a')], next: null });
      // after only, no bound (mirror).
      expect(await pageOf(backend, { ...desc, after: { order: 'm', refKey: keyOf('p', 'm2') } }))
        .toEqual({ records: [keyOf('p', 'm1'), keyOf('p', 'b'), keyOf('p', 'a')], next: null });
      expect(await pageOf(backend, { ...desc, limit: 2, after: { order: 'm', refKey: keyOf('p', 'm2') } }))
        .toEqual({ records: [keyOf('p', 'm1'), keyOf('p', 'b')], next: { order: 'b', refKey: keyOf('p', 'b') } });
    } finally {
      await backend.close();
    }
  },
  600_000,
);

it.each(['memory', 'sqlite'] as const)(
  'QA-15 %s: integer continuation starts at after-or-bound and equal-order ties stay decided by refKey',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      await seed(backend, [
        widget('p', 'i3', { group: 'cont-int', rank: 1 }),
        widget('p', 'i5', { group: 'cont-int', rank: 5 }),
        widget('p', 'i1', { group: 'cont-int', rank: 1 }),
        widget('p', 'i4', { group: 'cont-int', rank: 2 }),
        widget('p', 'i2', { group: 'cont-int', rank: 1 }),
      ], 'qa15-cont');
      const request = { index: integerIndex.name, values: ['cont-int'], direction: 'asc' as const, limit: 10 };

      // Normal continuation: after is past the bound, so the lower term is after.
      expect(await pageOf(backend, {
        ...request, bound: { value: 0, inclusive: true }, after: { order: 1, refKey: keyOf('p', 'i2') },
      })).toEqual({ records: [keyOf('p', 'i3'), keyOf('p', 'i4'), keyOf('p', 'i5')], next: null });
      // after before the bound: results start at the bound, the keyset is implied.
      expect(await pageOf(backend, {
        ...request, bound: { value: 2, inclusive: true }, after: { order: 1, refKey: keyOf('p', 'i1') },
      })).toEqual({ records: [keyOf('p', 'i4'), keyOf('p', 'i5')], next: null });
      // after.order equals an exclusive bound: only the strict bound term remains.
      expect(await pageOf(backend, {
        ...request, bound: { value: 2, inclusive: false }, after: { order: 2, refKey: keyOf('p', 'i4') },
      })).toEqual({ records: [keyOf('p', 'i5')], next: null });
      // after.order equals an inclusive bound: refKey decides the tied order value.
      expect(await pageOf(backend, {
        ...request, bound: { value: 1, inclusive: true }, after: { order: 1, refKey: keyOf('p', 'i1') },
      })).toEqual({ records: [keyOf('p', 'i2'), keyOf('p', 'i3'), keyOf('p', 'i4'), keyOf('p', 'i5')], next: null });
      // after only, no bound.
      expect(await pageOf(backend, { ...request, after: { order: 1, refKey: keyOf('p', 'i1') } }))
        .toEqual({ records: [keyOf('p', 'i2'), keyOf('p', 'i3'), keyOf('p', 'i4'), keyOf('p', 'i5')], next: null });
      expect(await pageOf(backend, { ...request, limit: 2, after: { order: 1, refKey: keyOf('p', 'i1') } }))
        .toEqual({ records: [keyOf('p', 'i2'), keyOf('p', 'i3')], next: { order: 1, refKey: keyOf('p', 'i3') } });

      const desc = { ...request, direction: 'desc' as const };
      // Normal continuation (mirror): after is past the bound.
      expect(await pageOf(backend, {
        ...desc, bound: { value: 5, inclusive: true }, after: { order: 1, refKey: keyOf('p', 'i3') },
      })).toEqual({ records: [keyOf('p', 'i2'), keyOf('p', 'i1')], next: null });
      // after before the bound (mirror): results start at the bound.
      expect(await pageOf(backend, {
        ...desc, bound: { value: 1, inclusive: true }, after: { order: 5, refKey: keyOf('p', 'i5') },
      })).toEqual({ records: [keyOf('p', 'i3'), keyOf('p', 'i2'), keyOf('p', 'i1')], next: null });
      // after.order equals an exclusive bound (mirror).
      expect(await pageOf(backend, {
        ...desc, bound: { value: 2, inclusive: false }, after: { order: 2, refKey: keyOf('p', 'i4') },
      })).toEqual({ records: [keyOf('p', 'i3'), keyOf('p', 'i2'), keyOf('p', 'i1')], next: null });
      // after.order equals an inclusive bound (mirror): refKey decides the ties.
      expect(await pageOf(backend, {
        ...desc, bound: { value: 1, inclusive: true }, after: { order: 1, refKey: keyOf('p', 'i3') },
      })).toEqual({ records: [keyOf('p', 'i2'), keyOf('p', 'i1')], next: null });
      // after only, no bound (mirror).
      expect(await pageOf(backend, { ...desc, after: { order: 2, refKey: keyOf('p', 'i4') } }))
        .toEqual({ records: [keyOf('p', 'i3'), keyOf('p', 'i2'), keyOf('p', 'i1')], next: null });
      expect(await pageOf(backend, { ...desc, limit: 2, after: { order: 2, refKey: keyOf('p', 'i4') } }))
        .toEqual({ records: [keyOf('p', 'i3'), keyOf('p', 'i2')], next: { order: 1, refKey: keyOf('p', 'i2') } });
    } finally {
      await backend.close();
    }
  },
  600_000,
);
