import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as artifactContract from '../../src/contracts/artifact.js';
import { RawArtifactBodyStore, type ArtifactBodyRows } from '../../src/core/record-store/body-store.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import type { RawArtifactPut } from '../../src/core/record-store/body-ports.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';

const source = { kind: 'workspace' as const, refId: 'workspace', revision: '7' };
const firstOwner = { aggregateType: 'Run' as const, projectId: 'project', goalId: 'goal', runId: 'first' };
const otherOwner = { aggregateType: 'Run' as const, projectId: 'project', goalId: 'goal', runId: 'other' };
const put = (body: string): RawArtifactPut => ({ contentType: 'text/plain', body, sourceRefs: [source],
  origin: { kind: 'run', owner: firstOwner }, requestedAt: '2026-09-24T00:00:00Z' });
const refFor = (body: string): ArtifactRef => ({ kind: 'artifact', contentType: 'text/plain',
  digest: createHash('sha256').update(body, 'utf8').digest('hex'),
  sizeBytes: Buffer.byteLength(body, 'utf8'), source });
const keyFor = (ref: ArtifactRef) => `${ref.contentType}|${ref.digest}|${ref.sizeBytes}`;
const rowFor = (body: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  ref: refFor(body), body, sourceRefs: [source], ownerRunRef: firstOwner,
  origin: { kind: 'run', owner: firstOwner }, ...extra,
});
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

it('hashes one newly stored body at most twice while returning its actual content address', async () => {
  const body = 'single-write UTF-8 正文 ' + 'x'.repeat(2048);
  const digestCalls = vi.spyOn(artifactContract, 'artifactBodyDigest');
  const store = new RawArtifactBodyStore();
  const result = await store.put(put(body));
  expect(result).toMatchObject({ status: 'ready', value: { ref: refFor(body), replayed: false } });
  // This bounds work on one put. A later explicit read may recheck integrity.
  const bodyHashes = digestCalls.mock.calls.filter(([value]) => value === body).length;
  expect(bodyHashes).toBeGreaterThanOrEqual(1);
  expect(bodyHashes).toBeLessThanOrEqual(2);
});

it('rejects a valid body row stored or returned under a different content key', async () => {
  const requested = refFor('requested content');
  const alien = rowFor('different valid content');
  const correctlyKeyed = new RawArtifactBodyStore({
    get: () => alien, putIfAbsent: () => { throw Error('read must not write'); },
  });
  expect(await correctlyKeyed.read(refFor('different valid content')))
    .toMatchObject({ status: 'ready', value: { body: 'different valid content' } });
  const rows: ArtifactBodyRows = {
    get: key => {
      expect(key).toBe(keyFor(requested));
      return alien;
    },
    putIfAbsent: (key, _json) => {
      expect(key).toBe(keyFor(requested));
      return { json: alien, inserted: false };
    },
  };
  const store = new RawArtifactBodyStore(rows);
  expect(await store.read(requested)).toMatchObject({ status: 'rejected', code: 'corrupt' });
  expect(await store.put(put('requested content'))).toMatchObject({ status: 'rejected', code: 'corrupt' });
});

it('rejects a row that claims two conflicting owner authorities', async () => {
  const body = 'conflicting owner';
  const ref = refFor(body);
  const conflicting = rowFor(body, { ownerRunRef: otherOwner });
  const rows: ArtifactBodyRows = {
    get: key => { expect(key).toBe(keyFor(ref)); return conflicting; },
    putIfAbsent: () => { throw Error('read must not write'); },
  };
  const store = new RawArtifactBodyStore(rows);
  expect(await store.read(ref)).toMatchObject({ status: 'rejected', code: 'corrupt' });
});

it('closes a newly opened SQLite connection when the existing artifacts schema cannot be prepared', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'r3b-invalid-artifacts-'));
  directories.push(directory);
  const path = join(directory, 'artifacts.sqlite');
  const seed = new DatabaseSync(path);
  seed.exec('CREATE TABLE artifacts (key TEXT PRIMARY KEY)'); // Deliberately lacks record.
  seed.close();
  const close = vi.spyOn(DatabaseSync.prototype, 'close');
  expect(() => createSqliteRawArtifactStore(path)).toThrow();
  expect(close).toHaveBeenCalledTimes(1);
  close.mockRestore();
  // Initialization failure must not delete or rebuild the user's existing table.
  const unchanged = new DatabaseSync(path);
  try {
    expect(unchanged.prepare("SELECT name FROM pragma_table_info('artifacts')").all().map(row => row['name']))
      .toEqual(['key']);
  } finally { unchanged.close(); }
});
