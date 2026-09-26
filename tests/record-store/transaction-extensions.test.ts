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
  records: [{ schemaId: 'ExtensionProbe@1', aggregateType: 'Project', commitCursorFields: ['since', 'until'],
    validate: record => {
      const body = JSON.parse(record.json) as Record<string, unknown>;
      if (body['rejectFinal'] === true && body['since'] !== null) return { status: 'invalid', reason: 'final cursor rejected' };
      return { status: 'decoded', value: record };
    } }],
  events: [{ eventType: 'ExtensionProbeEvent', schemaVersion: 1,
    validate: event => ({ status: 'decoded', value: event }) }],
};
const refKey = (id: string) => JSON.stringify({ aggregateType: 'Project', projectId: id });
const record = (id: string, revision: number, since: string | null = null, rejectFinal = false): EncodedRecord => {
  const ref = { aggregateType: 'Project', projectId: id };
  return { refKey: refKey(id), schemaId: 'ExtensionProbe@1', revision,
    json: JSON.stringify({ ref, revision, since, until: null, rejectFinal }) };
};
let serial = 0;
function commit(options: Partial<PreparedCommit> & { identityKey?: string } = {}): PreparedCommit {
  const id = options.identityKey ?? `extension-${++serial}`;
  const event = { eventId: `event-${id}`, eventType: 'ExtensionProbeEvent', schemaVersion: 1,
    occurredAt: '2026-09-24T00:00:00.000Z' };
  return { identityKey: id, fingerprint: id, guards: [], records: [], claims: [], indexGuards: [],
    indexChanges: [], events: [{ ...event, json: JSON.stringify(event) }], ...options };
}
async function open(kind: 'memory' | 'sqlite', existingPath?: string, registeredSchemas: RecordBackendSchemas = schemas) {
  if (kind === 'memory') return { backend: createInMemoryRecordBackend({ schemas: registeredSchemas }), path: null };
  let path = existingPath;
  if (!path) { const dir = await mkdtemp(join(tmpdir(), 'next-store-extensions-')); dirs.push(dir); path = join(dir, 'ledger.sqlite'); }
  return { backend: createSqliteRecordBackend({ schemas: registeredSchemas, path }), path };
}
type Backend = Awaited<ReturnType<typeof open>>['backend'];
async function read(backend: Backend, id: string) { return backend.records.readMany([refKey(id)]); }

describe.each(['memory', 'sqlite'] as const)('%s transaction extensions', kind => {
  it('rejects an empty-ledger horizon changed by another commit, without fabricating record versions', async () => {
    const { backend } = await open(kind);
    try {
      const stale = commit({ ledgerHorizon: null, guards: [{ refKey: refKey('absent'), expectedRevision: null }] });
      expect(await backend.records.commit(commit())).toMatchObject({ status: 'committed' });
      expect(await backend.records.commit(stale)).toMatchObject({ status: 'rejected', code: 'revision_conflict', current: [] });
      expect(await backend.records.lookupCommit({ identityKey: stale.identityKey, fingerprint: stale.fingerprint }))
        .toMatchObject({ status: 'rejected', code: 'not_found' });
    } finally { await backend.close(); }
  });

  it('compares the exact unique owner, including null, and observes the winner in a CAS race', async () => {
    const { backend } = await open(kind);
    try {
      const slot = 'session-occupancy:[p,s]';
      const first = commit({ claims: [{ claimKey: slot, expectedOwner: null, nextOwner: 'run:1' }] });
      const loser = commit({ claims: [{ claimKey: slot, expectedOwner: null, nextOwner: 'run:2' }] });
      expect(await backend.records.commit(first)).toMatchObject({ status: 'committed' });
      expect(await backend.records.commit(loser)).toMatchObject({ status: 'rejected', code: 'unique_conflict',
        current: [{ claimKey: slot, owner: 'run:1' }] });
      expect(await backend.records.commit(commit({ claims: [{ claimKey: slot, expectedOwner: 'run:2', nextOwner: null }] })))
        .toMatchObject({ status: 'rejected', code: 'unique_conflict', current: [{ claimKey: slot, owner: 'run:1' }] });
      expect(await backend.records.commit(commit({ claims: [{ claimKey: slot, expectedOwner: 'run:1', nextOwner: null }] })))
        .toMatchObject({ status: 'committed' });
      expect(await backend.records.commit(commit({ claims: [{ claimKey: slot, expectedOwner: 'run:1', nextOwner: null }] })))
        .toMatchObject({ status: 'rejected', code: 'unique_conflict', current: [{ claimKey: slot, owner: null }] });
    } finally { await backend.close(); }
  });

  it('binds the actual last event cursor once and replays the original receipt before stale guards and horizon', async () => {
    const { backend } = await open(kind);
    try {
      const key = refKey('bound');
      const input = commit({ guards: [{ refKey: key, expectedRevision: null }], records: [record('bound', 1)],
        ledgerHorizon: null, commitCursorBindings: [{ refKey: key, field: 'since' }] });
      const first = await backend.records.commit(input);
      expect(first).toMatchObject({ status: 'committed', replayed: false });
      if (first.status !== 'committed') return;
      const stored = await read(backend, 'bound');
      expect(stored.status).toBe('ready');
      if (stored.status === 'ready') expect(JSON.parse(stored.value.records[0]!.json)['since']).toBe(first.cursor);
      expect(await backend.records.commit(input)).toMatchObject({ status: 'committed', replayed: true, cursor: first.cursor });
      expect((await read(backend, 'bound'))).toEqual(stored);
    } finally { await backend.close(); }
  });

  it('rolls back final schema rejection, accepts ordinary writes and isolates caller input', async () => {
    const { backend } = await open(kind);
    try {
      const badKey = refKey('bad-final');
      const bad = commit({ guards: [{ refKey: badKey, expectedRevision: null }],
        records: [record('bad-final', 1, null, true)], commitCursorBindings: [{ refKey: badKey, field: 'since' }],
        claims: [{ claimKey: 'claim:bad-final', expectedOwner: null, nextOwner: 'owner' }] });
      expect(await backend.records.commit(bad)).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await read(backend, 'bad-final')).toMatchObject({ status: 'ready', value: { missing: [badKey], readThrough: null } });
      expect(await backend.records.lookupCommit({ identityKey: bad.identityKey, fingerprint: bad.fingerprint }))
        .toMatchObject({ status: 'rejected', code: 'not_found' });
      expect(await backend.records.commit(commit({ claims: [
        { claimKey: 'claim:bad-final', expectedOwner: null, nextOwner: 'replacement' },
      ] }))).toMatchObject({ status: 'committed' });
      const goodKey = refKey('plain');
      const plain = commit({ guards: [{ refKey: goodKey, expectedRevision: null }], records: [record('plain', 1)] });
      const original = structuredClone(plain);
      const receipt = await backend.records.commit(plain);
      expect(receipt).toMatchObject({ status: 'committed', replayed: false });
      expect(plain).toEqual(original);
      expect(await read(backend, 'plain')).toMatchObject({ status: 'ready', value: { records: [{ refKey: goodKey }] } });
    } finally { await backend.close(); }
  });

  it('rejects unregistered, repeated, unguarded, and non-null cursor binding targets', async () => {
    const { backend } = await open(kind);
    try {
      const key = refKey('invalid-binding');
      const base = { guards: [{ refKey: key, expectedRevision: null }], records: [record('invalid-binding', 1)] };
      for (const extra of [
        { commitCursorBindings: [{ refKey: key, field: 'since' as const }, { refKey: key, field: 'since' as const }] },
        { commitCursorBindings: [{ refKey: key, field: 'other' as 'since' }] },
        { commitCursorBindings: [{ refKey: refKey('missing'), field: 'since' as const }] },
        { guards: [], commitCursorBindings: [{ refKey: key, field: 'since' as const }] },
        { records: [record('invalid-binding', 1, 'already')], commitCursorBindings: [{ refKey: key, field: 'since' as const }] },
      ]) expect(await backend.records.commit(commit({ ...base, ...extra }))).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await read(backend, 'invalid-binding')).toMatchObject({ status: 'ready', value: { missing: [key], readThrough: null } });
    } finally { await backend.close(); }
  });

  it('uses a frozen copy of the registered cursor field whitelist and rejects schemas without one', async () => {
    const mutableFields: ('since' | 'until')[] = ['since'];
    const mutableSchema = { ...schemas.records[0]!, commitCursorFields: mutableFields };
    const registeredSchemas: RecordBackendSchemas = { records: [mutableSchema], events: [...schemas.events] };
    const { backend } = await open(kind, undefined, registeredSchemas);
    const noWhitelistSchemas: RecordBackendSchemas = {
      records: [{ schemaId: 'ExtensionProbe@1', aggregateType: 'Project', validate: mutableSchema.validate }],
      events: [...schemas.events],
    };
    const without = await open(kind, undefined, noWhitelistSchemas);
    try {
      mutableFields.splice(0, mutableFields.length, 'until');
      const key = refKey('copied-whitelist');
      const input = commit({ guards: [{ refKey: key, expectedRevision: null }], records: [record('copied-whitelist', 1)],
        commitCursorBindings: [{ refKey: key, field: 'since' }] });
      expect(await backend.records.commit(input)).toMatchObject({ status: 'committed' });
      expect(await without.backend.records.commit(input)).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await without.backend.records.lookupCommit({ identityKey: input.identityKey, fingerprint: input.fingerprint }))
        .toMatchObject({ status: 'rejected', code: 'not_found' });
    } finally { await backend.close(); await without.backend.close(); }
  });

  it('binds the cursor of the last event in a multi-event commit', async () => {
    const { backend } = await open(kind);
    try {
      const key = refKey('multi-event');
      const input = commit({ guards: [{ refKey: key, expectedRevision: null }], records: [record('multi-event', 1)],
        commitCursorBindings: [{ refKey: key, field: 'since' }] });
      const finalEvent = { eventId: `event-${input.identityKey}-last`, eventType: 'ExtensionProbeEvent',
        schemaVersion: 1, occurredAt: '2026-09-24T00:00:01.000Z' };
      input.events = [...input.events, { ...finalEvent, json: JSON.stringify(finalEvent) }];
      const receipt = await backend.records.commit(input);
      expect(receipt).toMatchObject({ status: 'committed', eventIds: [input.events[0]!.eventId, finalEvent.eventId] });
      if (receipt.status !== 'committed') return;
      expect(await backend.records.eventAt(receipt.cursor)).toMatchObject({ status: 'ready',
        value: { event: { eventId: finalEvent.eventId } } });
      const stored = await read(backend, 'multi-event');
      if (stored.status === 'ready') expect(JSON.parse(stored.value.records[0]!.json)['since']).toBe(receipt.cursor);
    } finally { await backend.close(); }
  });
});

it('two SQLite connections race for the same unique slot and agree on the winner', async () => {
  const first = await open('sqlite');
  const second = await open('sqlite', first.path!);
  try {
    const slot = 'slot:two-connections';
    const left = commit({ claims: [{ claimKey: slot, expectedOwner: null, nextOwner: 'left' }] });
    const right = commit({ claims: [{ claimKey: slot, expectedOwner: null, nextOwner: 'right' }] });
    const [a, b] = await Promise.all([first.backend.records.commit(left), second.backend.records.commit(right)]);
    const committed = [a, b].filter(result => result.status === 'committed');
    const conflicts = [a, b].filter(result => result.status === 'rejected' && result.code === 'unique_conflict');
    expect(committed).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    const winner = a.status === 'committed' ? 'left' : 'right';
    expect(conflicts[0]).toMatchObject({ current: [{ claimKey: slot, owner: winner }] });
    const probe = commit({ claims: [{ claimKey: slot, expectedOwner: null, nextOwner: 'third' }] });
    expect(await first.backend.records.commit(probe)).toMatchObject({ status: 'rejected', code: 'unique_conflict',
      current: [{ claimKey: slot, owner: winner }] });
    expect(await second.backend.records.commit(probe)).toMatchObject({ status: 'rejected', code: 'unique_conflict',
      current: [{ claimKey: slot, owner: winner }] });
  } finally { await first.backend.close(); await second.backend.close(); }
});

it('SQLite preserves unique slots and bound cursor after reopening the same database', async () => {
  const first = await open('sqlite');
  const path = first.path!;
  const key = refKey('reopen');
  const input = commit({ guards: [{ refKey: key, expectedRevision: null }], records: [record('reopen', 1)],
    claims: [{ claimKey: 'slot:reopen', expectedOwner: null, nextOwner: 'owner:reopen' }],
    commitCursorBindings: [{ refKey: key, field: 'since' }] });
  const receipt = await first.backend.records.commit(input);
  expect(receipt).toMatchObject({ status: 'committed' });
  await first.backend.close();
  const second = await open('sqlite', path);
  try {
    expect(await second.backend.records.commit(input)).toMatchObject({ status: 'committed', replayed: true,
      ...(receipt.status === 'committed' ? { cursor: receipt.cursor } : {}) });
    const stored = await read(second.backend, 'reopen');
    if (receipt.status === 'committed' && stored.status === 'ready')
      expect(JSON.parse(stored.value.records[0]!.json)['since']).toBe(receipt.cursor);
    expect(await second.backend.records.commit(commit({ claims: [{ claimKey: 'slot:reopen', expectedOwner: null, nextOwner: 'other' }] })))
      .toMatchObject({ status: 'rejected', code: 'unique_conflict', current: [{ claimKey: 'slot:reopen', owner: 'owner:reopen' }] });
  } finally { await second.backend.close(); }
});
