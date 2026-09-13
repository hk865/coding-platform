import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { createPersistentSqliteHarness } from '../../src/harness/persistent-harness.js';
import { runRefFor } from '../../src/contracts/dispatch.js';

it('preserves artifact bodies, source revisions and owner authorization across host restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vault-restart-'));
  let host = await createPersistentSqliteHarness({ dir });
  try {
    const owner = runRefFor('project', 'goal', 'writer');
    const record = { contentType: 'text/plain', body: '调查材料：符号位置、理由与未解问题',
      sourceRefs: [{ kind: 'workspace' as const, refId: 'workspace', revision: '7', digest: 'source-version' }],
      ownerRef: owner, requestedAt: '2026-09-08T00:00:00.000Z' };
    const put = await host.vault.put(record);
    expect(put.status).toBe('stored');
    if (put.status !== 'stored') throw Error('put failed');
    await host.close();
    host = await host.reopen();
    expect(await host.vault.open(put.ref, { requesterRunRef: owner })).toEqual({
      status: 'ready', record: { ref: put.ref, body: record.body, sourceRefs: record.sourceRefs },
    });
    expect(await host.vault.open(put.ref, { requesterRunRef: runRefFor('other-project', 'goal', 'writer') }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await host.vault.put({ ...record, ownerRef: runRefFor('project', 'goal', 'other') }))
      .toEqual({ status: 'stored', ref: put.ref, replayed: true });
    await host.close();
    const db = new DatabaseSync(join(dir, 'artifacts.sqlite'));
    try {
      db.exec(`UPDATE artifacts SET record = json_set(record, '$.body', 'corrupted')`);
    } finally { db.close(); }
    host = await host.reopen();
    expect(await host.vault.open(put.ref, { requesterRunRef: owner }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  } finally {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});
