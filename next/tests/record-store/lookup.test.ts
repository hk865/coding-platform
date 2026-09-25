import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { RecordBackendSchemas, EncodedRecord, EncodedDomainEvent, PreparedCommit,
  GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../src/core/record-store/lookup-ports.js';

const at = '2026-09-24T00:00:00.000Z';
const index = { name: 'widget-by-group-status', aggregateType: 'Widget', paths: ['group', 'status'] };
const schemas: RecordBackendSchemas = {
  records: [{ schemaId: 'Widget@1', aggregateType: 'Widget', validate: record => {
    const body: unknown = JSON.parse(record.json);
    if (typeof body !== 'object' || body === null || !('ref' in body) || !('group' in body) || !('status' in body))
      return { status: 'invalid', reason: 'widget fields missing' };
    return { status: 'decoded', value: record };
  } }],
  events: [{ eventType: 'WidgetChanged', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: [index, { name: 'widget-missing-nested', aggregateType: 'Widget', paths: ['group', 'meta.label'] }],
};
type Backend = { records: GoalRecordTransactionPort & RecordLookupPort; close(): Promise<void> };
const temp: string[] = [];
afterEach(async () => { for (const dir of temp.splice(0)) await rm(dir, { recursive: true, force: true }); });

const key = (projectId: string, widgetId: string) => canonicalJson({ aggregateType: 'Widget', projectId, widgetId });
function record(projectId: string, widgetId: string, revision: number, group: string, status: string): EncodedRecord {
  const ref = { aggregateType: 'Widget', projectId, widgetId };
  return { refKey: key(projectId, widgetId), schemaId: 'Widget@1', revision,
    json: JSON.stringify({ ref, revision, group, status }) };
}
function event(id: string): EncodedDomainEvent {
  return { eventId: id, eventType: 'WidgetChanged', schemaVersion: 1, occurredAt: at,
    json: JSON.stringify({ eventId: id, eventType: 'WidgetChanged', schemaVersion: 1, occurredAt: at }) };
}
function change(id: string, value: EncodedRecord, expectedRevision: number | null): PreparedCommit {
  return { identityKey: id, fingerprint: 'fingerprint-' + id, guards: [{ refKey: value.refKey, expectedRevision }],
    records: [value], events: [event('event-' + id)], claims: [], indexGuards: [], indexChanges: [] };
}
async function open(kind: 'memory' | 'sqlite', overrides: { beforeWrite?: () => void; schemas?: RecordBackendSchemas; path?: string } = {}): Promise<{ backend: Backend; path?: string }> {
  if (kind === 'memory') return { backend: createInMemoryRecordBackend({ schemas: overrides.schemas ?? schemas,
    ...(overrides.beforeWrite ? { beforeWrite: overrides.beforeWrite } : {}) }) as unknown as Backend };
  const dir = overrides.path ? undefined : await mkdtemp(join(tmpdir(), 'next-store-lookup-'));
  if (dir) temp.push(dir);
  const path = overrides.path ?? join(dir!, 'records.sqlite');
  return { backend: createSqliteRecordBackend({ path, schemas: overrides.schemas ?? schemas,
    ...(overrides.beforeWrite ? { beforeWrite: overrides.beforeWrite } : {}) }) as unknown as Backend, path };
}
const lookup = (backend: Backend, values: RecordLookupRequest['values'], limit = 200, after?: string) =>
  backend.records.lookup({ index: index.name, values, limit, ...(after ? { after } : {}) });

it.each(['memory', 'sqlite'] as const)('%s: indexes follow decoded JSON values for duplicate fields and numeric literals', async kind => {
  const { backend } = await open(kind);
  try {
    const duplicate = record('alpha', 'duplicate', 1, 'ignored', 'open');
    duplicate.json = duplicate.json.replace('"group":"ignored"', '"group":"wrong","group":"shared"');
    const numeric = record('alpha', 'numeric', 1, 'ignored', 'open');
    numeric.json = numeric.json.replace('"group":"ignored"', '"group":9007199254740993');
    for (const row of [duplicate, numeric]) expect(await backend.records.commit(change(row.refKey, row, null)))
      .toMatchObject({ status: 'committed' });
    expect(await lookup(backend, ['shared', 'open'])).toMatchObject({ status: 'ready',
      value: { records: [{ refKey: duplicate.refKey }] } });
    expect(await lookup(backend, ['wrong', 'open'])).toMatchObject({ status: 'ready', value: { records: [] } });
    expect(await lookup(backend, [JSON.parse(numeric.json).group, 'open'])).toMatchObject({ status: 'ready',
      value: { records: [{ refKey: numeric.refKey }] } });
  } finally { await backend.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: Unicode keys use the same UTF-8 byte order for sorting and continuation', async kind => {
  const { backend } = await open(kind);
  try {
    const ids = ['a', '\uE000', '\u{10000}', '中'];
    for (const id of ids) expect(await backend.records.commit(change('unicode-' + id,
      record('alpha', id, 1, 'unicode', 'open'), null))).toMatchObject({ status: 'committed' });
    const expected = ids.map(id => key('alpha', id)).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    const actual: string[] = [];
    let after: string | undefined;
    for (let n = 0; n < ids.length; n++) {
      const page = await lookup(backend, ['unicode', 'open'], 1, after);
      if (page.status !== 'ready') throw Error(page.reason);
      actual.push(...page.value.records.map(row => row.refKey));
      if (page.value.next === null) break;
      after = page.value.next;
    }
    expect(actual).toEqual(expected);
    const resume = await lookup(backend, ['unicode', 'open'], 200, expected[2]);
    expect(resume).toMatchObject({ status: 'ready', value: { records: [{ refKey: expected[3] }], next: null } });
  } finally { await backend.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: full-ref keyset lookup tracks commits, guards and replay without changing records', async kind => {
  const { backend, path } = await open(kind);
  try {
    const rows = [record('alpha', 'a', 1, 'shared', 'open'), record('alpha', 'b', 1, 'shared', 'open'),
      record('beta', 'a', 1, 'shared', 'open'), record('alpha', 'c', 1, 'other', 'open')];
    for (const [n, row] of rows.entries()) expect(await backend.records.commit(change('seed-' + n, row, null)))
      .toMatchObject({ status: 'committed', replayed: false });
    const first = await lookup(backend, ['shared', 'open'], 2);
    expect(first).toMatchObject({ status: 'ready', value: { records: expect.any(Array), next: expect.any(String), readThrough: expect.any(String) } });
    if (first.status !== 'ready' || first.value.next === null) throw Error('first lookup page absent');
    expect(first.value.records.map(row => row.refKey)).toEqual([key('alpha', 'a'), key('alpha', 'b')]);
    const second = await lookup(backend, ['shared', 'open'], 2, first.value.next);
    expect(second).toMatchObject({ status: 'ready', value: { next: null } });
    if (second.status !== 'ready') throw Error('second lookup page absent');
    expect(second.value.records.map(row => row.refKey)).toEqual([key('beta', 'a')]);
    expect(await backend.records.lookup({ index: 'widget-missing-nested', values: ['shared', null], limit: 200 }))
      .toMatchObject({ status: 'ready', value: { records: [
        { refKey: key('alpha', 'a') }, { refKey: key('alpha', 'b') }, { refKey: key('beta', 'a') },
      ] } });
    const revision = record('alpha', 'a', 2, 'other', 'closed');
    expect(await backend.records.commit(change('move-a', revision, 1))).toMatchObject({ status: 'committed' });
    expect(await lookup(backend, ['shared', 'open'])).toMatchObject({ status: 'ready',
      value: { records: [{ refKey: key('alpha', 'b') }, { refKey: key('beta', 'a') }] } });
    expect(await lookup(backend, ['other', 'closed'])).toMatchObject({ status: 'ready',
      value: { records: [{ refKey: key('alpha', 'a'), revision: 2 }] } });
    expect(await backend.records.commit(change('move-a', revision, 1))).toMatchObject({ status: 'committed', replayed: true });
    expect(await backend.records.commit(change('stale', record('alpha', 'b', 2, 'other', 'open'), 0)))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await backend.records.commit({ ...change('move-a', revision, 1), fingerprint: 'changed' }))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await backend.records.readMany([key('alpha', 'a'), key('beta', 'a')]))
      .toMatchObject({ status: 'ready', value: { records: [{ revision: 2 }, { revision: 1 }] } });
    if (path) {
      await backend.close();
      const reopened = (await open('sqlite', { path })).backend;
      try { expect(await lookup(reopened, ['other', 'closed'])).toMatchObject({ status: 'ready',
        value: { records: [{ refKey: key('alpha', 'a'), revision: 2 }] } }); }
      finally { await reopened.close(); }
    }
    expect(Object.keys(backend).sort()).toEqual(['close', 'records']);
  } finally { await backend.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: invalid requests and registrations reject, and failed writes do not publish lookup changes', async kind => {
  for (const bad of [{ ...index, paths: ['group..status'] },
    { ...index, paths: ['__proto__'] }, { ...index, paths: [] }]) {
    const outcome = await open(kind, { schemas: { ...schemas, lookups: [bad] } }).then(async created => {
      await created.backend.close();
      return 'accepted';
    }, () => 'rejected');
    expect(outcome).toBe('rejected');
  }
  const duplicate = await open(kind, { schemas: { ...schemas, lookups: [index, index] } }).then(async created => {
    await created.backend.close();
    return 'accepted';
  }, () => 'rejected');
  expect(duplicate).toBe('rejected');
  let fail = false;
  const { backend } = await open(kind, { beforeWrite: () => { if (fail) throw Error('injected write failure'); } });
  try {
    const original = record('alpha', 'a', 1, 'shared', 'open');
    expect(await backend.records.commit(change('seed', original, null))).toMatchObject({ status: 'committed' });
    expect(await backend.records.lookup({ index: 'unregistered', values: ['shared', 'open'], limit: 1 }))
      .toMatchObject({ status: 'rejected', code: 'unsupported' });
    for (const request of [{ index: index.name, values: ['shared'], limit: 1 },
      { index: index.name, values: ['shared', 'open'], limit: 0 },
      { index: index.name, values: ['shared', 'open'], limit: 201 },
      { index: index.name, values: [{ bad: true }], limit: 1 }])
      expect(await backend.records.lookup(request as RecordLookupRequest)).toMatchObject({ status: 'rejected', code: 'invalid' });
    fail = true;
    await expect(backend.records.commit(change('failed-move', record('alpha', 'a', 2, 'other', 'closed'), 1)))
      .rejects.toThrow('injected write failure');
    expect(await lookup(backend, ['shared', 'open'])).toMatchObject({ status: 'ready',
      value: { records: [{ refKey: original.refKey, revision: 1 }] } });
    expect(await lookup(backend, ['other', 'closed'])).toMatchObject({ status: 'ready', value: { records: [] } });
    expect(await backend.records.lookupCommit({ identityKey: 'failed-move', fingerprint: 'fingerprint-failed-move' }))
      .toMatchObject({ status: 'rejected', code: 'not_found' });
  } finally { await backend.close(); }
});

it('SQLite adds an index to an existing database and refuses to return a matching damaged row', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'next-store-existing-'));
  temp.push(dir);
  const path = join(dir, 'records.sqlite');
  const plainSchemas = { ...schemas, lookups: [] };
  const plain = (await open('sqlite', { path, schemas: plainSchemas })).backend;
  const row = record('alpha', 'a', 1, 'shared', 'open');
  expect(await plain.records.commit(change('seed', row, null))).toMatchObject({ status: 'committed' });
  await plain.close();
  const indexed = (await open('sqlite', { path })).backend;
  try {
    expect(await lookup(indexed, ['shared', 'open'])).toMatchObject({ status: 'ready',
      value: { records: [{ refKey: row.refKey }] } });
    const inspection = new DatabaseSync(path);
    try {
      const indexes = inspection.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'snapshots' AND sql IS NOT NULL").all();
      expect(indexes.some(index => typeof index['sql'] === 'string' &&
        index['sql'].includes('group') && index['sql'].includes('status'))).toBe(true);
    } finally { inspection.close(); }
  } finally { await indexed.close(); }
  const db = new DatabaseSync(path);
  db.prepare('UPDATE snapshots SET snapshot_json = ? WHERE ref_key = ?').run(
    JSON.stringify({ ref: { aggregateType: 'Widget', projectId: 'beta', widgetId: 'a' }, revision: 1,
      group: 'shared', status: 'open' }), row.refKey);
  db.close();
  const damaged = (await open('sqlite', { path })).backend;
  try { expect(await lookup(damaged, ['shared', 'open'])).toMatchObject({ status: 'rejected', code: 'corrupt' }); }
  finally { await damaged.close(); }
});
