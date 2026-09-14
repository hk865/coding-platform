// Run after the platform build. Exercises the actual compiled persistent adapter.
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { SqliteArtifactVault } from '../dist/data/artifact-vault/sqlite-artifact-vault.js';

const dir = await mkdtemp(join(tmpdir(), 'platform-vault-crash-'));
const path = join(dir, 'artifacts.sqlite');
const owner = { aggregateType: 'Run', projectId: 'crash-project', goalId: 'goal', runId: 'producer' };
const record = { ownerRef: owner, body: 'Interrupted producer: keep reasons and unresolved questions.',
  contentType: 'text/plain', requestedAt: '2026-09-08T00:00:00.000Z',
  sourceRefs: [{ kind: 'workspace', refId: 'workspace', revision: '7', digest: 'source-v7' }] };
let restored;
try {
  const adapter = new URL('../dist/data/artifact-vault/sqlite-artifact-vault.js', import.meta.url).href;
  const script = `
    import { readFileSync } from 'node:fs';
    const { path, record, adapter } = JSON.parse(readFileSync(0, 'utf8'));
    const { SqliteArtifactVault } = await import(adapter);
    const vault = new SqliteArtifactVault(path);
    const result = await vault.put(record);
    process.stdout.write(JSON.stringify(result), () => process.kill(process.pid, 'SIGKILL'));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    input: JSON.stringify({ path, record, adapter }), encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(child.error);
  assert.ok(child.signal === 'SIGKILL' || (process.platform === 'win32' && child.status === 1),
    'producer must be terminated without close');
  assert.ok(!child.stderr.includes('Error:'), child.stderr);
  const put = JSON.parse(child.stdout);
  assert.equal(put.status, 'stored');
  restored = new SqliteArtifactVault(path);
  assert.deepEqual(await restored.open(put.ref, { requesterRunRef: owner }), {
    status: 'ready', record: { ref: put.ref, body: record.body, sourceRefs: record.sourceRefs },
  });
  assert.equal((await restored.open(put.ref, { requesterRunRef: { ...owner, projectId: 'other' } })).status, 'rejected');
  console.log(JSON.stringify({ status: 'passed', producerSignal: child.signal, producerExitCode: child.status,
    restoredDigest: put.ref.digest, sourceRevision: '7', scope: 'artifact durability only; no model or task resume' }));
} finally {
  await restored?.close();
  await rm(dir, { recursive: true, force: true });
}
