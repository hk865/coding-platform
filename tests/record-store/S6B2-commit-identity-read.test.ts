/**
 * The committed-pair identity read on both backends: the storage member reads
 * one committed identity row and the WorkGraph wrapper classifies it. The
 * committed pair is produced by the store's own public `commit`; a damaged row
 * is the store's own failure path (a second SQLite connection, or the memory
 * store's idempotency map replaced for one key), never a hand-written record.
 * The same identity with another fingerprint stays an exact-lookup conflict and
 * the identity read still reports the stored pair.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type {
  EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas, StoreCommitReceipt,
  StoreResult,
} from '../../src/core/record-store/ports.js';
import {
  lookupCommittedReceipt, lookupCommittedReceiptByIdentity,
} from '../../src/core/work-graph/persistence/receipt-lookup.js';

const at = '2026-10-25T00:00:00.000Z';
const schemas: RecordBackendSchemas = {
  records: [{ schemaId: 'Thing@1', aggregateType: 'Thing', validate: record => ({ status: 'decoded', value: record }) }],
  events: [{ eventType: 'ThingChanged', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
};
const identity = 'thing.one';
const fingerprint = 'a'.repeat(64);
const otherFingerprint = 'b'.repeat(64);
const ref = { aggregateType: 'Thing', projectId: 'p1', thingId: 't1' };
const refKey = canonicalJson(ref);
const record: EncodedRecord = { refKey, schemaId: 'Thing@1', revision: 1,
  json: canonicalJson({ ref, revision: 1, name: 'one' }) };
const event: EncodedDomainEvent = { eventId: 'e1', eventType: 'ThingChanged', schemaVersion: 1, occurredAt: at,
  json: canonicalJson({ eventId: 'e1', eventType: 'ThingChanged', schemaVersion: 1, occurredAt: at, value: 1 }) };
const commit = (identityKey: string, committedFingerprint: string): PreparedCommit => ({ identityKey,
  fingerprint: committedFingerprint, guards: [{ refKey, expectedRevision: null }], records: [record], claims: [],
  indexGuards: [], indexChanges: [], events: [event] });

type Committed = Extract<StoreCommitReceipt, { status: 'committed' }>;
type Backend = {
  records: GoalRecordTransactionPort;
  commitIdentities: { readCommitByIdentity(identityKey: string):
    Promise<StoreResult<{ receipt: Committed; fingerprint: string }>> };
  close(): Promise<void>;
};
const temp: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of temp.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function openBackend(kind: 'memory' | 'sqlite'): Promise<{ backend: Backend; path?: string }> {
  if (kind === 'memory') return { backend: createInMemoryRecordBackend({ schemas }) as unknown as Backend };
  const dir = await mkdtemp(join(tmpdir(), 's6b2-identity-'));
  temp.push(dir);
  const path = join(dir, 'records.sqlite');
  return { backend: createSqliteRecordBackend({ path, schemas }) as unknown as Backend, path };
}

/** The one committed pair: the store's own commit, then the identity member. */
async function commitPair(kind: 'memory' | 'sqlite'): Promise<{ backend: Backend; path: string | undefined; receipt: Committed }> {
  const { backend, path } = await openBackend(kind);
  const receipt = await backend.records.commit(commit(identity, fingerprint));
  if (receipt.status !== 'committed') throw new Error(`S6B2: the fixture commit failed: ${JSON.stringify(receipt)}`);
  return { backend, path, receipt };
}

describe.each(['memory', 'sqlite'] as const)('%s: the committed identity read', kind => {
  it('returns the committed receipt and the fingerprint it was committed with', async () => {
    const { backend, receipt } = await commitPair(kind);
    try {
      expect(await backend.commitIdentities.readCommitByIdentity(identity)).toMatchObject({ status: 'ready', value: {
        receipt: { status: 'committed', replayed: true, identityKey: identity, eventIds: ['e1'],
          cursor: (receipt as { cursor: string }).cursor },
        fingerprint,
      } });
    } finally { await backend.close(); }
  });

  it('classifies an identity that was never committed as missing, with no fake fingerprint', async () => {
    const { backend } = await openBackend(kind);
    try {
      expect(await backend.commitIdentities.readCommitByIdentity(identity))
        .toMatchObject({ status: 'rejected', code: 'not_found' });
      expect(await lookupCommittedReceiptByIdentity(backend.commitIdentities, identity)).toEqual({ status: 'missing' });
    } finally { await backend.close(); }
  });

  it('classifies a damaged row as unavailable, never as a found pair', async () => {
    const { backend, path } = await commitPair(kind);
    try {
      if (kind === 'sqlite') {
        const db = new DatabaseSync(path!);
        db.prepare('UPDATE idempotency SET fingerprint = \'\' WHERE identity_key = ?').run(identity);
        db.close();
      } else {
        // The memory store's row is private state; fault injection replaces the
        // one idempotency entry for this identity and forwards every other key.
        const original = Map.prototype.get;
        vi.spyOn(Map.prototype, 'get').mockImplementation(function (this: Map<unknown, unknown>, key: unknown) {
          if (key === identity) return { fingerprint: '', eventIds: [], aggregateRevisions: [], commitCursor: 'c0000000001' };
          return original.call(this, key);
        });
      }
      expect(await backend.commitIdentities.readCommitByIdentity(identity))
        .toMatchObject({ status: 'rejected', code: 'corrupt' });
      expect(await lookupCommittedReceiptByIdentity(backend.commitIdentities, identity))
        .toMatchObject({ status: 'unavailable' });
      if (kind === 'sqlite') {
        expect((await lookupCommittedReceiptByIdentity(backend.commitIdentities, identity)).status).not.toBe('found');
      }
    } finally { await backend.close(); }
  });

  it('keeps the same identity with another fingerprint a conflict and reports the stored pair', async () => {
    const { backend } = await commitPair(kind);
    try {
      expect(await lookupCommittedReceipt(backend.records, identity, otherFingerprint))
        .toMatchObject({ status: 'conflict' });
      expect(await backend.commitIdentities.readCommitByIdentity(identity))
        .toMatchObject({ status: 'ready', value: { fingerprint } });
    } finally { await backend.close(); }
  });
});
