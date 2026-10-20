import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import * as artifactContract from '../../src/contracts/artifact.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { RawArtifactPut } from '../../src/core/record-store/body-ports.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';

const source = { kind: 'workspace' as const, refId: 'workspace', revision: '7' };
const firstOwner = { aggregateType: 'Run' as const, projectId: 'project', goalId: 'goal', runId: 'first' };
const put = (body: string): RawArtifactPut => ({ contentType: 'text/plain', body, sourceRefs: [source],
  origin: { kind: 'run', owner: firstOwner }, requestedAt: '2026-09-24T00:00:00Z' });
const refFor = (body: string): ArtifactRef => ({ kind: 'artifact', contentType: 'text/plain',
  digest: createHash('sha256').update(body, 'utf8').digest('hex'),
  sizeBytes: Buffer.byteLength(body, 'utf8'), source });
afterEach(() => {
  vi.restoreAllMocks();
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
