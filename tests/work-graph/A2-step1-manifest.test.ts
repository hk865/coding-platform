/**
 * A.2 step 1 (spec §15.2 第 1 步, §6.1 (e)): the stored task-execution manifest
 * accepts the two new optional fields `continuationBrief` (C3) and
 * `sessionBasis` (LA-1) and checks only their shape. No writer produces them
 * yet; a manifest without them reads exactly as before.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MANIFEST_CONTENT_TYPE } from '../../src/contracts/no-progress.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { readManifestFromEnvelope } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';

const harnesses: C1Harness[] = [];
afterEach(async () => { for (const harness of harnesses.splice(0)) await harness.close(); });

async function baseline(): Promise<{ h: C1Harness; manifest: PreparedTaskManifestV1 }> {
  const h = await createC1Harness('memory');
  harnesses.push(h);
  const envelope = h.currentRun.envelope;
  if (envelope === null) throw new Error('the C1 fixture Run has no envelope');
  const stored = await readManifestFromEnvelope({ bodies: h.rawBodies() }, envelope as unknown as Record<string, unknown>, h.claim.runRef);
  if (!stored.ok) throw new Error(`the C1 fixture manifest does not read: ${JSON.stringify(stored)}`);
  return { h, manifest: stored.value.manifest };
}

/** Stores `body` as the Run's manifest Artifact and reads it back through the owner reader. */
async function readStored(h: C1Harness, body: Record<string, unknown>) {
  const bodies = new RawArtifactBodyStore();
  const put = await bodies.put({ body: JSON.stringify(body), contentType: MANIFEST_CONTENT_TYPE,
    sourceRefs: [{ kind: 'workspace', refId: h.currentRun.workspaceSnapshot.workspaceId, revision: '1' }],
    origin: { kind: 'run', owner: h.claim.runRef }, requestedAt: '2026-10-03T00:00:00.000Z' });
  if (put.status !== 'ready') throw new Error(`manifest store failed: ${JSON.stringify(put)}`);
  return readManifestFromEnvelope({ bodies }, { bundleRef: put.value.ref }, h.claim.runRef);
}

describe('task-execution manifest step-1 optional fields', () => {
  it('reads a manifest without continuationBrief or sessionBasis unchanged', async () => {
    const { h, manifest } = await baseline();
    expect(manifest.continuationBrief).toBeUndefined();
    expect(manifest.sessionBasis).toBeUndefined();
    const read = await readStored(h, { ...manifest });
    expect(read.ok, JSON.stringify(read)).toBe(true);
  });

  it('accepts a well-formed sessionBasis, including the explicit empty baseline', async () => {
    const { h, manifest } = await baseline();
    for (const sessionBasis of [
      { sourceKernelSessionId: 'kernel-session-1', throughPosition: 0 },
      { sourceKernelSessionId: 'kernel-session-1', throughPosition: 41 },
      { sourceKernelSessionId: 'kernel-session-1', throughPosition: null },
    ]) {
      const read = await readStored(h, { ...manifest, sessionBasis });
      expect(read.ok, JSON.stringify(read)).toBe(true);
      if (read.ok) expect(read.value.manifest.sessionBasis).toEqual(sessionBasis);
    }
  });

  it('rejects a malformed sessionBasis', async () => {
    const { h, manifest } = await baseline();
    for (const sessionBasis of [
      null, 'kernel-session-1',
      { sourceKernelSessionId: '', throughPosition: 0 },
      { sourceKernelSessionId: 'kernel-session-1', throughPosition: -1 },
      { sourceKernelSessionId: 'kernel-session-1', throughPosition: 1.5 },
      { sourceKernelSessionId: 'kernel-session-1' },
      { sourceKernelSessionId: 'kernel-session-1', throughPosition: 0, extra: true },
    ]) {
      const read = await readStored(h, { ...manifest, sessionBasis });
      expect(read.ok, JSON.stringify(sessionBasis)).toBe(false);
      if (!read.ok) expect(read.rejection.reason).toContain('sessionBasis');
    }
  });

  it('rejects a continuationBrief that is not a ContinuationBriefV1', async () => {
    const { h, manifest } = await baseline();
    for (const continuationBrief of [null, {}, { schemaVersion: 1 }]) {
      const read = await readStored(h, { ...manifest, continuationBrief });
      expect(read.ok, JSON.stringify(continuationBrief)).toBe(false);
      if (!read.ok) expect(read.rejection.reason).toContain('continuationBrief');
    }
  });
});
