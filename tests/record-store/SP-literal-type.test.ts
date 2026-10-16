/**
 * S3.3 (decision 66): the registered `aggregateType` must be a safe SQL literal
 * and every query that filters by type must stay isolated to its own type.
 *
 * Registration goes through both backends' public factories; the query
 * assertions go through the public `lookup`, `lookupOrdered` and `countLookup`.
 * Expected refKeys are literal canonical strings (or `JSON.stringify` of the
 * literal ref object), never the product's `canonicalJson`.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordCountPort, RecordLookupIndex, RecordLookupPort, RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';

const at = '2026-10-16T00:00:00.000Z';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

type Backend = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort & RecordCountPort;
  close(): Promise<void>;
};

function recordSchema(aggregateType: string) {
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

function event(id: string): EncodedDomainEvent {
  return {
    eventId: id, eventType: 'Changed', schemaVersion: 1, occurredAt: at,
    json: JSON.stringify({ eventId: id, eventType: 'Changed', schemaVersion: 1, occurredAt: at }),
  };
}

async function open(kind: 'memory' | 'sqlite', schemas: RecordBackendSchemas): Promise<{ backend: Backend; path?: string }> {
  if (kind === 'memory') {
    return { backend: createInMemoryRecordBackend({ schemas }) as unknown as Backend };
  }
  const dir = await mkdtemp(join(tmpdir(), 'sp-literal-type-'));
  dirs.push(dir);
  const path = join(dir, 'records.sqlite');
  return { backend: createSqliteRecordBackend({ path, schemas }) as unknown as Backend, path };
}

// --------------------------------------------------------------------------
// Registration: the six unsafe types reject; Widget_2 opens and works.
// --------------------------------------------------------------------------

const badTypes = ["Wid'get", 'Wid\u0000get', '1Widget', 'Wid-get', 'Wid get', 'Ẃidget'];

it.each(['memory', 'sqlite'] as const)('SP-31 %s: an unsafe aggregateType rejects with JSON.stringify in the message', async (kind) => {
  for (const aggregateType of badTypes) {
    const schemas: RecordBackendSchemas = {
      records: [recordSchema(aggregateType)],
      events: [{ eventType: 'Changed', schemaVersion: 1, validate: (value) => ({ status: 'decoded', value }) }],
      lookups: [{ name: 'by-group', aggregateType, paths: ['group'] }],
    };
    await expect(open(kind, schemas)).rejects.toThrow(JSON.stringify(aggregateType));
  }
});

it.each(['memory', 'sqlite'] as const)('SP-32 %s: Widget_2 opens and a commit plus lookup work', async (kind) => {
  const schemas: RecordBackendSchemas = {
    records: [recordSchema('Widget_2')],
    events: [{ eventType: 'Changed', schemaVersion: 1, validate: (value) => ({ status: 'decoded', value }) }],
    lookups: [{ name: 'by-group', aggregateType: 'Widget_2', paths: ['group'] }],
  };
  const { backend } = await open(kind, schemas);
  try {
    const refKey = '{"aggregateType":"Widget_2","id":"a"}';
    const row: EncodedRecord = {
      refKey, schemaId: 'Widget_2@1', revision: 1,
      json: JSON.stringify({ ref: { aggregateType: 'Widget_2', id: 'a' }, revision: 1, group: 'shared' }),
    };
    const commit: PreparedCommit = {
      identityKey: 'one', fingerprint: 'fp-one', guards: [{ refKey, expectedRevision: null }],
      records: [row], events: [event('one')], claims: [], indexGuards: [], indexChanges: [],
    };
    expect(await backend.records.commit(commit)).toMatchObject({ status: 'committed' });
    expect(await backend.records.lookup({ index: 'by-group', values: ['shared'], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey }] } });
  } finally {
    await backend.close();
  }
});

// --------------------------------------------------------------------------
// Type isolation on W and V, one row each missing a path. W and V share the
// indexed value `open`, so any count (or lookup) that dropped the type term
// would add the other type's row.
// --------------------------------------------------------------------------

const wIndexes: RecordLookupIndex[] = [
  { name: 'w-plain', aggregateType: 'W', paths: ['group', 'status'] },
  { name: 'w-ordered', aggregateType: 'W', paths: ['group'], orderBy: { path: 'n', valueType: 'integer' } },
];
const vIndexes: RecordLookupIndex[] = [
  { name: 'v-plain', aggregateType: 'V', paths: ['group', 'status'] },
  { name: 'v-ordered', aggregateType: 'V', paths: ['group'], orderBy: { path: 'n', valueType: 'integer' } },
];

const isolationSchemas: RecordBackendSchemas = {
  records: [recordSchema('W'), recordSchema('V')],
  events: [{ eventType: 'Changed', schemaVersion: 1, validate: (value) => ({ status: 'decoded', value }) }],
  lookups: [...wIndexes, ...vIndexes],
};

const keyW = (id: string) => `{"aggregateType":"W","id":${JSON.stringify(id)}}`;
const keyV = (id: string) => `{"aggregateType":"V","id":${JSON.stringify(id)}}`;

function typed(aggregateType: 'W' | 'V', id: string, body: Record<string, unknown>): EncodedRecord {
  return {
    refKey: aggregateType === 'W' ? keyW(id) : keyV(id),
    schemaId: `${aggregateType}@1`,
    revision: 1,
    json: JSON.stringify({ ref: { aggregateType, id }, revision: 1, group: 'shared', ...body }),
  };
}

function commitRow(backend: Backend, id: string, row: EncodedRecord): Promise<unknown> {
  const commit: PreparedCommit = {
    identityKey: id, fingerprint: `fp-${id}`, guards: [{ refKey: row.refKey, expectedRevision: null }],
    records: [row], events: [event(id)], claims: [], indexGuards: [], indexChanges: [],
  };
  return backend.records.commit(commit);
}

it.each(['memory', 'sqlite'] as const)('SP-33 %s: type filters stay on their own aggregate type', async (kind) => {
  const { backend } = await open(kind, isolationSchemas);
  try {
    // W: three rows whose `status` values are open/held/missing; V: three rows
    // with closed/missing/open, so `open` is shared by both types.
    expect(await commitRow(backend, 'w1', typed('W', 'w1', { status: 'open', n: 1 }))).toMatchObject({ status: 'committed' });
    expect(await commitRow(backend, 'w2', typed('W', 'w2', { n: 2 }))).toMatchObject({ status: 'committed' });
    expect(await commitRow(backend, 'w3', typed('W', 'w3', { status: 'held', n: 3 }))).toMatchObject({ status: 'committed' });
    expect(await commitRow(backend, 'v1', typed('V', 'v1', { status: 'closed', n: 1 }))).toMatchObject({ status: 'committed' });
    expect(await commitRow(backend, 'v2', typed('V', 'v2', { n: 2 }))).toMatchObject({ status: 'committed' });
    expect(await commitRow(backend, 'v3', typed('V', 'v3', { status: 'open', n: 3 }))).toMatchObject({ status: 'committed' });

    const wPlainOpen = await backend.records.lookup({ index: 'w-plain', values: ['shared', 'open'], limit: 10 });
    expect(wPlainOpen).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w1') }] } });
    const vPlainClosed = await backend.records.lookup({ index: 'v-plain', values: ['shared', 'closed'], limit: 10 });
    expect(vPlainClosed).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyV('v1') }] } });
    // The shared `open` value stays on its own type on both sides.
    expect(await backend.records.lookup({ index: 'v-plain', values: ['shared', 'open'], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyV('v3') }] } });

    // A null equality value selects the row that lacks the path, still only its type.
    const wPlainNull = await backend.records.lookup({ index: 'w-plain', values: ['shared', null], limit: 10 });
    expect(wPlainNull).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w2') }] } });
    const vPlainNull = await backend.records.lookup({ index: 'v-plain', values: ['shared', null], limit: 10 });
    expect(vPlainNull).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyV('v2') }] } });

    // Ordered asc and desc, with a bound that actually drops a row and with after.
    const wAsc = await backend.records.lookupOrdered({ index: 'w-ordered', values: ['shared'], direction: 'asc', bound: { value: 2, inclusive: true }, limit: 10 });
    expect(wAsc).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w2') }, { refKey: keyW('w3') }] } });
    const wDesc = await backend.records.lookupOrdered({ index: 'w-ordered', values: ['shared'], direction: 'desc', limit: 10 });
    expect(wDesc).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w3') }, { refKey: keyW('w2') }, { refKey: keyW('w1') }] } });
    const wDescBound = await backend.records.lookupOrdered({
      index: 'w-ordered', values: ['shared'], direction: 'desc', bound: { value: 2, inclusive: true }, limit: 10,
    });
    expect(wDescBound).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w2') }, { refKey: keyW('w1') }] } });
    const wDescAfter = await backend.records.lookupOrdered({
      index: 'w-ordered', values: ['shared'], direction: 'desc',
      after: { order: 3, refKey: keyW('w3') }, limit: 10,
    });
    expect(wDescAfter).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w2') }, { refKey: keyW('w1') }] } });
    const wAfter = await backend.records.lookupOrdered({
      index: 'w-ordered', values: ['shared'], direction: 'asc',
      after: { order: 1, refKey: keyW('w1') }, limit: 10,
    });
    expect(wAfter).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w2') }, { refKey: keyW('w3') }] } });

    const vAsc = await backend.records.lookupOrdered({ index: 'v-ordered', values: ['shared'], direction: 'asc', bound: { value: 2, inclusive: true }, limit: 10 });
    expect(vAsc).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyV('v2') }, { refKey: keyV('v3') }] } });
    const vDescBound = await backend.records.lookupOrdered({
      index: 'v-ordered', values: ['shared'], direction: 'desc', bound: { value: 2, inclusive: true }, limit: 10,
    });
    expect(vDescBound).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyV('v2') }, { refKey: keyV('v1') }] } });
    const vAscAfter = await backend.records.lookupOrdered({
      index: 'v-ordered', values: ['shared'], direction: 'asc',
      after: { order: 1, refKey: keyV('v1') }, limit: 10,
    });
    expect(vAscAfter).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyV('v2') }, { refKey: keyV('v3') }] } });
    const vDescAfter = await backend.records.lookupOrdered({
      index: 'v-ordered', values: ['shared'], direction: 'desc',
      after: { order: 2, refKey: keyV('v2') }, limit: 10,
    });
    expect(vDescAfter).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyV('v1') }] } });

    // Counts: plain, ordered and distinct, all type-isolated. `open` is shared,
    // so dropping the type term makes both plain counts 2; the distinct status
    // count would become 3 on either side.
    expect(await backend.records.countLookup({ index: 'w-plain', values: ['shared', 'open'] }))
      .toMatchObject({ status: 'ready', value: { count: 1 } });
    expect(await backend.records.countLookup({ index: 'v-plain', values: ['shared', 'open'] }))
      .toMatchObject({ status: 'ready', value: { count: 1 } });
    expect(await backend.records.countLookup({ index: 'w-plain', values: ['shared'], distinctPath: 'status' }))
      .toMatchObject({ status: 'ready', value: { count: 2 } });
    expect(await backend.records.countLookup({ index: 'w-ordered', values: ['shared'] }))
      .toMatchObject({ status: 'ready', value: { count: 3 } });
    expect(await backend.records.countLookup({ index: 'v-plain', values: ['shared', 'closed'] }))
      .toMatchObject({ status: 'ready', value: { count: 1 } });
    expect(await backend.records.countLookup({ index: 'v-plain', values: ['shared'], distinctPath: 'status' }))
      .toMatchObject({ status: 'ready', value: { count: 2 } });
    expect(await backend.records.countLookup({ index: 'v-ordered', values: ['shared'] }))
      .toMatchObject({ status: 'ready', value: { count: 3 } });
  } finally {
    await backend.close();
  }
});
