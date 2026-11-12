/**
 * KLS-2c-1a [2C1-01]: a commit cursor binding may name one of the commit's events by its index; the Store fills the
 * bound field with THAT event's cursor (no index: the last event, as before). The refusal of an index outside the
 * commit is one sentence of the rule and is not tested on its own (only this package makes such indexes).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { EncodedRecord, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

const schemas: RecordBackendSchemas = {
  records: [{ schemaId: 'EventIndexProbe@1', aggregateType: 'Project', commitCursorFields: ['since', 'until'],
    validate: record => ({ status: 'decoded', value: record }) }],
  events: [{ eventType: 'EventIndexProbeEvent', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
};
const probeKey = (id: string) => JSON.stringify({ aggregateType: 'Project', projectId: id });
const probeRecord = (id: string): EncodedRecord => ({ refKey: probeKey(id), schemaId: 'EventIndexProbe@1', revision: 1,
  json: JSON.stringify({ ref: { aggregateType: 'Project', projectId: id }, revision: 1, since: null, until: null }) });
const probeEvent = (eventId: string) => {
  const body = { eventId, eventType: 'EventIndexProbeEvent', schemaVersion: 1, occurredAt: '2026-11-12T00:00:00.000Z' };
  return { ...body, json: JSON.stringify(body) };
};
let serial = 0;
function threeEventCommit(ids: readonly string[], bindings: PreparedCommit['commitCursorBindings']): PreparedCommit {
  const identityKey = `event-index-${++serial}`;
  return { identityKey, fingerprint: identityKey, guards: ids.map(id => ({ refKey: probeKey(id), expectedRevision: null })),
    records: ids.map(probeRecord), claims: [], indexGuards: [], indexChanges: [],
    events: [probeEvent(`${identityKey}-a`), probeEvent(`${identityKey}-b`), probeEvent(`${identityKey}-c`)],
    ...(bindings === undefined ? {} : { commitCursorBindings: bindings }) };
}
async function openBackend(kind: 'memory' | 'sqlite') {
  if (kind === 'memory') return createInMemoryRecordBackend({ schemas });
  const dir = await mkdtemp(join(tmpdir(), 'kls2c1a-event-index-'));
  dirs.push(dir);
  return createSqliteRecordBackend({ schemas, path: join(dir, 'ledger.sqlite') });
}
type Backend = Awaited<ReturnType<typeof openBackend>>;

/** The id of the event the record's bound field names, read back through the public `eventAt`. */
async function boundEventId(backend: Backend, id: string, field: 'since' | 'until'): Promise<string> {
  const read = await backend.records.readMany([probeKey(id)]);
  if (read.status !== 'ready') throw new Error(JSON.stringify(read));
  const cursor = (JSON.parse(read.value.records[0]!.json) as Record<string, string>)[field]!;
  const at = await backend.records.eventAt(cursor as Parameters<Backend['records']['eventAt']>[0]);
  if (at.status !== 'ready') throw new Error(JSON.stringify(at));
  return at.value.event.eventId;
}

describe.each(['memory', 'sqlite'] as const)('%s commit cursor binding by event index', kind => {
  it('fills each bound field with the cursor of the event its index names, and the last event without an index', async () => {
    const backend = await openBackend(kind);
    try {
      const input = threeEventCommit(['first', 'middle', 'plain'], [
        { refKey: probeKey('first'), field: 'since', eventIndex: 0 },
        { refKey: probeKey('middle'), field: 'since', eventIndex: 1 },
        { refKey: probeKey('middle'), field: 'until', eventIndex: 2 },
        { refKey: probeKey('plain'), field: 'since' },
      ]);
      const receipt = await backend.records.commit(input);
      expect(receipt).toMatchObject({ status: 'committed', replayed: false });
      const id = input.identityKey;
      expect(await boundEventId(backend, 'first', 'since')).toBe(`${id}-a`);
      expect(await boundEventId(backend, 'middle', 'since')).toBe(`${id}-b`);
      expect(await boundEventId(backend, 'middle', 'until')).toBe(`${id}-c`);
      expect(await boundEventId(backend, 'plain', 'since')).toBe(`${id}-c`);
    } finally { await backend.close(); }
  });
});
