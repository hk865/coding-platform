/**
 * Slice 2C row 2C-08 (LE2): the public `countLookup` of both RecordStore backends.
 *
 * What this file builds and through which public calls:
 *  - It registers its own test indexes through `RecordBackendSchemas`
 *    (`s2c-count-by-group`, `s2c-count-by-tone`, `s2c-count-text-order`,
 *    `s2c-count-int-order`, `s2c-count-reopen`; P5) and commits every row
 *    through the store's own public `commit`.
 *  - The unsafe integer `9007199254740993` is committed at the storage
 *    boundary as raw JSON text through that same `commit` (P5); the store
 *    re-encodes the parsed value, so it is an out-of-safe-range JSON integer.
 *  - It asserts only through the public `countLookup`. Every expected count is a
 *    literal hand-computed from spec L3 / row 2C-08.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordCountRequest } from '../../src/core/record-store/lookup-ports.js';
import {
  change, keyOf, open as openStore, seed, widget, widgetSchemas as baseWidgetSchemas, type TextBackend,
} from '../helpers/S4B-text-search-support.js';

const plainIndex = { name: 's2c-count-by-group', aggregateType: 'Widget', paths: ['group'] };
const distinctIndex = { name: 's2c-count-by-tone', aggregateType: 'Widget', paths: ['bucket', 'tone'] };
const textOrderIndex = {
  name: 's2c-count-text-order', aggregateType: 'Widget', paths: ['group'], orderBy: { path: 'label' },
};
const intOrderIndex = {
  name: 's2c-count-int-order', aggregateType: 'Widget', paths: ['group'], orderBy: { path: 'rank', valueType: 'integer' as const },
};
const reopenFirstIndex = { name: 's2c-count-reopen', aggregateType: 'Widget', paths: ['group'] };
const reopenSecondIndex = { name: 's2c-count-reopen', aggregateType: 'Widget', paths: ['group', 'tone'] };

// S2C's own five indexes: the shared record/event schemas plus these lookups.
const widgetSchemas: RecordBackendSchemas = {
  ...baseWidgetSchemas, lookups: [plainIndex, distinctIndex, textOrderIndex, intOrderIndex, reopenSecondIndex],
};

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

/** The public count, or a loud failure if the store refused. */
async function countOf(backend: TextBackend, request: RecordCountRequest): Promise<number> {
  const result = await backend.records.countLookup(request);
  if (result.status !== 'ready') throw new Error(`countLookup failed: ${result.code}: ${result.reason}`);
  return result.value.count;
}

// --------------------------------------------------------------------------
// 2C-08: an empty store, and the shape of the result
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  '2C-08 %s: an empty store counts zero and reports a null readThrough',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      expect(await backend.records.countLookup({ index: plainIndex.name, values: ['alpha'] }))
        .toMatchObject({ status: 'ready', value: { count: 0, readThrough: null } });
    } finally {
      await backend.close();
    }
  },
  600_000,
);

// --------------------------------------------------------------------------
// 2C-08: plain equality counts, including null, missing, composite and non-ASCII
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  '2C-08 %s: plain equality counts match the hand-computed values',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      await seed(backend, [
        widget('p', 'a1', { group: 'alpha' }),
        widget('p', 'a2', { group: 'alpha' }),
        widget('p', 'b1', { group: 'beta' }),
        widget('p', 'n1', { group: null }),
        widget('p', 'm1', {}),
        widget('p', 'num7', { group: 7 }),
        widget('p', 'num1', { group: 1 }),
        widget('p', 'tru', { group: true }),
        widget('p', 'fal', { group: false }),
        widget('p', 'zero', { group: 0 }),
        widget('p', 'obj', { group: { x: 1 } }),
        widget('p', 'cjk', { group: '小组' }),
        widget('p', 'empty', { group: '' }),
        widget('p', 'cafe', { group: 'café' }),
      ], 'c08-plain');

      expect(await countOf(backend, { index: plainIndex.name, values: ['alpha'] })).toBe(2);
      expect(await countOf(backend, { index: plainIndex.name, values: ['beta'] })).toBe(1);
      // An explicit null and a missing field are the same null candidate.
      expect(await countOf(backend, { index: plainIndex.name, values: [null] })).toBe(2);
      expect(await countOf(backend, { index: plainIndex.name, values: [7] })).toBe(1);
      expect(await countOf(backend, { index: plainIndex.name, values: [1] })).toBe(1);
      expect(await countOf(backend, { index: plainIndex.name, values: [true] })).toBe(1);
      expect(await countOf(backend, { index: plainIndex.name, values: [false] })).toBe(1);
      expect(await countOf(backend, { index: plainIndex.name, values: [0] })).toBe(1);
      expect(await countOf(backend, { index: plainIndex.name, values: ['小组'] })).toBe(1);
      expect(await countOf(backend, { index: plainIndex.name, values: ['café'] })).toBe(1);
      expect(await countOf(backend, { index: plainIndex.name, values: [''] })).toBe(1);
      expect(await countOf(backend, { index: plainIndex.name, values: ['gamma'] })).toBe(0);
    } finally {
      await backend.close();
    }
  },
  600_000,
);

// --------------------------------------------------------------------------
// 2C-08: distinctPath counts one per (type, value)
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  '2C-08 %s: distinctPath is one per (text, number, true, false); null, missing and composite are skipped',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      await seed(backend, [
        widget('p', 't1', { bucket: 'tones', tone: true }),
        widget('p', 't2', { bucket: 'tones', tone: 1 }),
        widget('p', 't3', { bucket: 'tones', tone: '1' }),
        widget('p', 't4', { bucket: 'tones', tone: false }),
        widget('p', 't5', { bucket: 'tones', tone: 0 }),
        widget('p', 't6', { bucket: 'tones', tone: 1.0 }),
        widget('p', 't7', { bucket: 'tones', tone: null }),
        widget('p', 't8', { bucket: 'tones' }),
        widget('p', 't9', { bucket: 'tones', tone: '1' }),
        widget('p', 't10', { bucket: 'tones', tone: 1 }),
        widget('p', 't11', { bucket: 'tones', tone: { x: 1 } }),
        widget('p', 'other', { bucket: 'other', tone: 'x' }),
      ], 'c08-distinct');
      // true, 1, "1", false, 0 are five classes; the extra 1.0, null, missing and
      // composite rows change nothing.
      expect(await countOf(backend, { index: distinctIndex.name, values: ['tones'], distinctPath: 'tone' })).toBe(5);
      expect(await countOf(backend, { index: distinctIndex.name, values: ['nope'], distinctPath: 'tone' })).toBe(0);
    } finally {
      await backend.close();
    }
  },
  600_000,
);

// --------------------------------------------------------------------------
// 2C-08: an ordered index counts only order-value candidates
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  '2C-08 %s: a text-ordered index counts only non-empty-string order values',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      await seed(backend, [
        widget('p', 's1', { group: 'text-order', label: 'a' }),
        widget('p', 's2', { group: 'text-order', label: 'b' }),
        widget('p', 's3', { group: 'text-order', label: '' }),
        widget('p', 's4', { group: 'text-order', label: 7 }),
        widget('p', 's5', { group: 'text-order', label: null }),
        widget('p', 's6', { group: 'text-order' }),
        widget('p', 's7', { group: 'text-order', label: true }),
        widget('p', 's8', { group: 'text-order', label: '小组' }),
        widget('p', 'other', { group: 'text-other', label: 'a' }),
      ], 'c08-text-order');
      // Only s1, s2 and s8 have a non-empty string order value.
      expect(await countOf(backend, { index: textOrderIndex.name, values: ['text-order'] })).toBe(3);
      expect(await countOf(backend, { index: textOrderIndex.name, values: ['text-other'] })).toBe(1);
    } finally {
      await backend.close();
    }
  },
  600_000,
);

it.each(['memory', 'sqlite'] as const)(
  '2C-08 %s: an integer-ordered index counts only safe JSON integers',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      // Committed at the storage boundary as raw JSON text (P5).
      const unsafe = widget('p', 'unsafe', { group: 'int-order', rank: 0 });
      unsafe.json = unsafe.json.replace('"rank":0', '"rank":9007199254740993');
      await seed(backend, [
        widget('p', 'zero', { group: 'int-order', rank: 0 }),
        widget('p', 'one', { group: 'int-order', rank: 1 }),
        widget('p', 'neg', { group: 'int-order', rank: -5 }),
        widget('p', 'max', { group: 'int-order', rank: 9007199254740991 }),
        widget('p', 'over', { group: 'int-order', rank: 9007199254740992 }),
        widget('p', 'frac', { group: 'int-order', rank: 1.5 }),
        widget('p', 'text', { group: 'int-order', rank: '3' }),
        widget('p', 'null', { group: 'int-order', rank: null }),
        widget('p', 'missing', { group: 'int-order' }),
        widget('p', 'bool', { group: 'int-order', rank: true }),
        unsafe,
        widget('p', 'other-x', { group: 'int-other', rank: 2 }),
      ], 'c08-int-order');
      // zero, one, neg and max are safe JSON integers.
      expect(await countOf(backend, { index: intOrderIndex.name, values: ['int-order'] })).toBe(4);
      expect(await countOf(backend, { index: intOrderIndex.name, values: ['int-other'] })).toBe(1);
    } finally {
      await backend.close();
    }
  },
  600_000,
);

// --------------------------------------------------------------------------
// 2C-08: malformed requests are invalid, an unknown index is unsupported
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  '2C-08 %s: malformed count requests are invalid, an unknown index is unsupported, and nothing throws',
  async (kind) => {
    const { backend } = await open(kind);
    try {
      const invalidRequests: unknown[] = [
        'not-an-object',
        { index: plainIndex.name },
        { index: plainIndex.name, values: 'alpha' },
        { index: plainIndex.name, values: ['alpha', 'beta'] },
        { index: plainIndex.name, values: [{ x: 1 }] },
        { index: plainIndex.name, values: [Number.NaN] },
        { index: plainIndex.name, values: [Number.POSITIVE_INFINITY] },
        { index: distinctIndex.name, values: ['tones', 'tone'], distinctPath: 'tone' },
        { index: distinctIndex.name, values: ['tones'], distinctPath: 'bucket' },
        { index: distinctIndex.name, values: ['tones'], distinctPath: 7 },
        { index: distinctIndex.name, values: ['tones'], distinctPath: '' },
        { index: textOrderIndex.name, values: ['x'], distinctPath: 'group' },
        { index: textOrderIndex.name, values: [null] },
        { index: textOrderIndex.name, values: [7] },
        { index: textOrderIndex.name, values: [''] },
        { index: textOrderIndex.name, values: ['x', 'y'] },
        { index: intOrderIndex.name, values: [true] },
      ];
      for (const request of invalidRequests) {
        expect(await backend.records.countLookup(request as RecordCountRequest))
          .toMatchObject({ status: 'rejected', code: 'invalid' });
      }
      expect(await backend.records.countLookup({ index: 's2c-count-nope', values: ['x'] }))
        .toMatchObject({ status: 'rejected', code: 'unsupported' });
    } finally {
      await backend.close();
    }
  },
  600_000,
);

// --------------------------------------------------------------------------
// 2C-08: an index registered on reopen counts the existing rows (SQLite)
// --------------------------------------------------------------------------

it('2C-08 sqlite: an index registered on reopen counts rows committed before it existed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's2c-count-existing-'));
  temp.push(dir);
  const path = join(dir, 'records.sqlite');
  const first = createSqliteRecordBackend({
    path, schemas: withLookups([reopenFirstIndex]),
  });
  await seed(first, [
    widget('p', 'r1', { group: 'reopen', tone: 'x' }),
    widget('p', 'r2', { group: 'reopen', tone: 'x' }),
    widget('p', 'r3', { group: 'reopen', tone: 'y' }),
    widget('p', 'r4', { group: 'reopen' }),
  ], 'c08-reopen');
  await first.close();

  const reopened = createSqliteRecordBackend({ path, schemas: widgetSchemas });
  try {
    // The reopened registration adds `tone` as a second path; the new index is
    // built over the rows committed before it existed.
    expect(await countOf(reopened, { index: 's2c-count-reopen', values: ['reopen', 'x'] })).toBe(2);
    expect(await countOf(reopened, { index: 's2c-count-reopen', values: ['reopen'], distinctPath: 'tone' })).toBe(2);
  } finally {
    await reopened.close();
  }
}, 600_000);
