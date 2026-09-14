import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSqliteStateLedger } from '../../src/data/state-ledger/sqlite-ledger.js';
import { buildWorkContextBindLedgerCommit } from '../../src/control/control-engine/records/context.js';
import { buildBindWorkContextCommand } from '../contract-support/fixtures/context-fixtures.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { ledgerIdentityKeyFor } from '../../src/data/state-ledger/ledger-validation.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';

function batch(workId: string, taskId = 'task') {
  return buildWorkContextBindLedgerCommit(buildBindWorkContextCommand({
    commandId: 'bind-' + workId, projectId: 'project', workspaceId: 'workspace',
    workId, workKind: 'task', goalId: 'goal', taskId,
    initialRunRef: { aggregateType: 'Run', projectId: 'project', goalId: 'goal', runId: 'run' },
  }), { eventId: 'event-' + workId, occurredAt: '2026-09-11T00:00:00.000Z' });
}
describe('legacy identity index compatibility', () => {
  it('rejects competing binds from two connections after the legacy schema is reopened', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'identity-upgrade-connections-'));
    const path = join(dir, 'ledger.sqlite');
    const seed = createSqliteStateLedger({ path });
    const original = batch('original');
    expect((await seed.commit(original)).status).toBe('committed');
    const before = await seed.events({ afterCursor: null, limit: 100 });
    await seed.close();
    const oldDatabase = new DatabaseSync(path);
    oldDatabase.exec('DROP TABLE identity_claims');
    oldDatabase.close();
    const a = createSqliteStateLedger({ path });
    const b = createSqliteStateLedger({ path });
    try {
      const results = await Promise.all([a.commit(batch('contender-a')), b.commit(batch('contender-b'))]);
      expect(results).toEqual([
        { status: 'rejected', code: 'revision_conflict' },
        { status: 'rejected', code: 'revision_conflict' },
      ]);
      expect(await a.events({ afterCursor: null, limit: 100 })).toEqual(before);
      expect(await b.load(original.snapshots[0]!.ref)).toEqual({ status: 'found', snapshot: original.snapshots[0] });
    } finally { await a.close(); await b.close(); await rm(dir, { recursive: true, force: true }); }
  });
  it('preserves both legacy identities and their receipts while rejecting any new identity', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'identity-upgrade-duplicates-'));
    const path = join(dir, 'ledger.sqlite');
    const first = batch('legacy-first');
    const second = batch('legacy-second');
    let ledger = createSqliteStateLedger({ path });
    try {
      expect((await ledger.commit(first)).status).toBe('committed');
      await ledger.close();
      // Recreate the complete rows accepted before the uniqueness index existed.
      // This is a legacy fixture, not a production path for bypassing commits.
      const oldDatabase = new DatabaseSync(path);
      oldDatabase.exec('BEGIN IMMEDIATE; DROP TABLE identity_claims');
      oldDatabase.prepare('INSERT INTO snapshots (ref_key, snapshot_json) VALUES (?, ?)')
        .run(canonicalJson(second.snapshots[0]!.ref), JSON.stringify(second.snapshots[0]));
      const inserted = oldDatabase.prepare('INSERT INTO events (event_json) VALUES (?)').run(JSON.stringify(second.events[0]));
      oldDatabase.prepare('INSERT INTO idempotency (identity_key, fingerprint, event_ids_json, aggregate_revisions_json, commit_cursor) VALUES (?, ?, ?, ?, ?)')
        .run(ledgerIdentityKeyFor(second), String(second.fingerprint), JSON.stringify([second.events[0]!.eventId]),
          JSON.stringify(second.snapshots.map(snapshot => ({ ref: snapshot.ref, revision: snapshot.revision }))),
          String(makeCommitCursor(Number(inserted.lastInsertRowid))));
      oldDatabase.exec('COMMIT');
      oldDatabase.close();
      ledger = createSqliteStateLedger({ path });
      const before = await ledger.events({ afterCursor: null, limit: 100 });
      expect(before.events).toHaveLength(2);
      expect(await ledger.commit(batch('third'))).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      for (const old of [first, second]) {
        expect(await ledger.load(old.snapshots[0]!.ref)).toEqual({ status: 'found', snapshot: old.snapshots[0] });
        expect(await ledger.commit(old)).toMatchObject({ status: 'committed', replayed: true });
      }
      expect(await ledger.events({ afterCursor: null, limit: 100 })).toEqual(before);
    } finally { await ledger.close(); await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects a second identity after upgrading a database without the identity table, preserving history and replay', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'identity-upgrade-'));
    const path = join(dir, 'ledger.sqlite');
    let ledger = createSqliteStateLedger({ path });
    try {
      const first = batch('original');
      const receipt = await ledger.commit(first);
      expect(receipt.status).toBe('committed');
      const before = await ledger.events({ afterCursor: null, limit: 100 });
      await ledger.close();
      // This removes only the derived index, recreating the pre-index schema.
      const oldDatabase = new DatabaseSync(path);
      oldDatabase.exec('DROP TABLE identity_claims');
      oldDatabase.close();
      ledger = createSqliteStateLedger({ path });
      expect(await ledger.commit(batch('second'))).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(await ledger.events({ afterCursor: null, limit: 100 })).toEqual(before);
      expect(await ledger.load(first.snapshots[0]!.ref)).toEqual({ status: 'found', snapshot: first.snapshots[0] });
      expect(await ledger.commit(first)).toMatchObject({ ...receipt, replayed: true });
      expect((await ledger.commit(batch('unrelated', 'other-task'))).status).toBe('committed');
    } finally { await ledger.close(); await rm(dir, { recursive: true, force: true }); }
  });
});
