/**
 * Speed-round 1 G1 (S3.2): the SQLite literal-LIMIT change through the public
 * `lookup` and `lookupOrdered` ports.
 *
 * The SQLite backend rounds `limit + 1` up to the next power of two; the in-memory
 * backend does not. This file pages both backends over matching-row counts that
 * hit exactly `limit`, `limit + 1`, `2^k` and `2^k + 1`, with and without an
 * `after` cursor, and asserts the pages and `next` are identical (and, for the
 * boundary cases, equal to hand-computed literals). Never reads the database.
 */
import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { keyOf, open, seedBatch, widget, withLookups, type TextBackend } from '../helpers/S4B-text-search-support.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import type { RecordLookupIndex, RecordLookupPort, RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const limitsIndex: RecordLookupIndex = {
  name: 'sp-limits',
  aggregateType: 'Widget',
  paths: ['group'],
  orderBy: { path: 'label' },
};

type Ports = RecordLookupPort & RecordOrderedLookupPort;
function portsOf(backend: TextBackend): Ports {
  return backend.records as unknown as Ports;
}

async function store(kind: 'memory' | 'sqlite'): Promise<TextBackend> {
  const { backend, dir } = await open(kind, { schemas: withLookups([limitsIndex]) });
  if (dir !== undefined) dirs.push(dir);
  return backend;
}

// The widget id carries its group, so the same positional id can appear in more
// than one group without a revision conflict.
function rowsFor(group: string, count: number): EncodedRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(4, '0');
    return widget('p1', `${group}-${suffix}`, { group, label: `l${suffix}` });
  });
}

// The matching-row counts that make `limit`, `limit + 1`, `2^k` and `2^k + 1`
// exact for the limits below (next power of two >= limit + 1).
const COUNTS = [1, 2, 3, 4, 5, 8, 9, 200, 201, 256, 257] as const;

async function seedGroups(backend: TextBackend): Promise<void> {
  for (const count of COUNTS) {
    await seedBatch(backend, rowsFor(`g${count}`, count), `sp-limits-g${count}`);
  }
}

type LookupPaged = { pages: string[][]; nexts: (string | null)[] };
async function pageLookup(backend: TextBackend, values: readonly string[], limit: number): Promise<LookupPaged> {
  const pages: string[][] = [];
  const nexts: (string | null)[] = [];
  let after: string | undefined;
  for (let guard = 0; guard < 400; guard += 1) {
    const result = await portsOf(backend).lookup({
      index: 'sp-limits', values, limit, ...(after === undefined ? {} : { after }),
    });
    if (result.status !== 'ready') throw new Error(`lookup failed: ${result.reason}`);
    pages.push(result.value.records.map((record) => record.refKey));
    nexts.push(result.value.next);
    if (result.value.next === null) return { pages, nexts };
    after = result.value.next;
  }
  throw new Error('lookup paging did not terminate');
}

type OrderedNext = { order: string | number; refKey: string };
type OrderedPaged = { pages: string[][]; nexts: (OrderedNext | null)[] };
async function pageOrdered(backend: TextBackend, values: readonly string[], limit: number): Promise<OrderedPaged> {
  const pages: string[][] = [];
  const nexts: (OrderedNext | null)[] = [];
  let after: OrderedNext | undefined;
  for (let guard = 0; guard < 400; guard += 1) {
    const result = await portsOf(backend).lookupOrdered({
      index: 'sp-limits', values, direction: 'asc', limit, ...(after === undefined ? {} : { after }),
    });
    if (result.status !== 'ready') throw new Error(`lookupOrdered failed: ${result.reason}`);
    pages.push(result.value.records.map((record) => record.refKey));
    nexts.push(result.value.next);
    if (result.value.next === null) return { pages, nexts };
    after = result.value.next;
  }
  throw new Error('ordered paging did not terminate');
}

const ref = (group: string, index: number): string => keyOf('p1', `${group}-${String(index).padStart(4, '0')}`);
const label = (index: number): string => `l${String(index).padStart(4, '0')}`;
const refsRange = (group: string, from: number, toExclusive: number): string[] =>
  Array.from({ length: toExclusive - from }, (_, index) => ref(group, from + index));

// limit, matching rows: limit / limit + 1 / 2^k / 2^k + 1 boundaries.
const matrix: readonly { limit: number; count: number }[] = [
  { limit: 1, count: 1 }, { limit: 1, count: 2 }, { limit: 1, count: 3 },
  { limit: 2, count: 2 }, { limit: 2, count: 3 }, { limit: 2, count: 4 }, { limit: 2, count: 5 },
  { limit: 3, count: 3 }, { limit: 3, count: 4 }, { limit: 3, count: 5 },
  { limit: 4, count: 4 }, { limit: 4, count: 5 }, { limit: 4, count: 8 }, { limit: 4, count: 9 },
  { limit: 200, count: 200 }, { limit: 200, count: 201 }, { limit: 200, count: 256 }, { limit: 200, count: 257 },
  // F6 (review item 8): after the 1,2,3,4,200 sequence on the SAME open backend,
  // one more limit 1 so the SQLite statement cache returns to the 1-row literal.
  { limit: 1, count: 1 },
];

it('SP-15 both: lookup and lookupOrdered pages equal memory across the limit matrix', async () => {
  const memory = await store('memory');
  const sqlite = await store('sqlite');
  try {
    await seedGroups(memory);
    await seedGroups(sqlite);
    for (const { limit, count } of matrix) {
      const values = [`g${count}`];
      expect(await pageLookup(sqlite, values, limit)).toEqual(await pageLookup(memory, values, limit));
      expect(await pageOrdered(sqlite, values, limit)).toEqual(await pageOrdered(memory, values, limit));
    }
  } finally {
    await memory.close();
    await sqlite.close();
  }
});

it('SP-16 both: lookup boundary pages and next are the hand-computed literals', async () => {
  const memory = await store('memory');
  const sqlite = await store('sqlite');
  try {
    await seedGroups(memory);
    await seedGroups(sqlite);
    for (const backend of [memory, sqlite]) {
      expect(await pageLookup(backend, ['g4'], 4)).toEqual({ pages: [refsRange('g4', 0, 4)], nexts: [null] });
      expect(await pageLookup(backend, ['g5'], 4)).toEqual({
        pages: [refsRange('g5', 0, 4), refsRange('g5', 4, 5)], nexts: [ref('g5', 3), null],
      });
      expect(await pageLookup(backend, ['g8'], 4)).toEqual({
        pages: [refsRange('g8', 0, 4), refsRange('g8', 4, 8)], nexts: [ref('g8', 3), null],
      });
      expect(await pageLookup(backend, ['g9'], 4)).toEqual({
        pages: [refsRange('g9', 0, 4), refsRange('g9', 4, 8), refsRange('g9', 8, 9)],
        nexts: [ref('g9', 3), ref('g9', 7), null],
      });
      expect(await pageLookup(backend, ['g200'], 200)).toEqual({ pages: [refsRange('g200', 0, 200)], nexts: [null] });
      expect(await pageLookup(backend, ['g201'], 200)).toEqual({
        pages: [refsRange('g201', 0, 200), refsRange('g201', 200, 201)], nexts: [ref('g201', 199), null],
      });
      expect(await pageLookup(backend, ['g256'], 200)).toEqual({
        pages: [refsRange('g256', 0, 200), refsRange('g256', 200, 256)],
        nexts: [ref('g256', 199), null],
      });
      expect(await pageLookup(backend, ['g257'], 200)).toEqual({
        pages: [refsRange('g257', 0, 200), refsRange('g257', 200, 257)],
        nexts: [ref('g257', 199), null],
      });
    }
  } finally {
    await memory.close();
    await sqlite.close();
  }
});

it('SP-17 both: lookupOrdered boundary pages and next are the hand-computed literals', async () => {
  const memory = await store('memory');
  const sqlite = await store('sqlite');
  try {
    await seedGroups(memory);
    await seedGroups(sqlite);
    for (const backend of [memory, sqlite]) {
      expect(await pageOrdered(backend, ['g4'], 4)).toEqual({ pages: [refsRange('g4', 0, 4)], nexts: [null] });
      expect(await pageOrdered(backend, ['g5'], 4)).toEqual({
        pages: [refsRange('g5', 0, 4), refsRange('g5', 4, 5)],
        nexts: [{ order: label(3), refKey: ref('g5', 3) }, null],
      });
      expect(await pageOrdered(backend, ['g9'], 4)).toEqual({
        pages: [refsRange('g9', 0, 4), refsRange('g9', 4, 8), refsRange('g9', 8, 9)],
        nexts: [{ order: label(3), refKey: ref('g9', 3) }, { order: label(7), refKey: ref('g9', 7) }, null],
      });
      expect(await pageOrdered(backend, ['g257'], 200)).toEqual({
        pages: [refsRange('g257', 0, 200), refsRange('g257', 200, 257)],
        nexts: [{ order: label(199), refKey: ref('g257', 199) }, null],
      });
    }
  } finally {
    await memory.close();
    await sqlite.close();
  }
});

it('SP-18 both: an explicit after cursor equals memory for lookup and lookupOrdered', async () => {
  const memory = await store('memory');
  const sqlite = await store('sqlite');
  try {
    await seedGroups(memory);
    await seedGroups(sqlite);
    for (const backend of [memory, sqlite]) {
      const lookup = await portsOf(backend).lookup({ index: 'sp-limits', values: ['g9'], limit: 4, after: ref('g9', 3) });
      expect(lookup.status).toBe('ready');
      if (lookup.status !== 'ready') throw new Error(lookup.reason);
      expect({ refs: lookup.value.records.map((record) => record.refKey), next: lookup.value.next })
        .toEqual({ refs: refsRange('g9', 4, 8), next: ref('g9', 7) });

      const ordered = await portsOf(backend).lookupOrdered({
        index: 'sp-limits', values: ['g9'], direction: 'asc', limit: 4,
        after: { order: label(3), refKey: ref('g9', 3) },
      });
      expect(ordered.status).toBe('ready');
      if (ordered.status !== 'ready') throw new Error(ordered.reason);
      expect({ refs: ordered.value.records.map((record) => record.refKey), next: ordered.value.next })
        .toEqual({ refs: refsRange('g9', 4, 8), next: { order: label(7), refKey: ref('g9', 7) } });
    }
  } finally {
    await memory.close();
    await sqlite.close();
  }
});
