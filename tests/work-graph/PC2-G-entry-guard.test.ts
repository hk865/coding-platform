/**
 * PC-2 PE9 (ruling 12): the entry accepts the re-rendered continuation brief by
 * the binding's byte range and its single occurrence, never by "it is last".
 *
 * Every case reaches the entry through the frozen `openPC2EntryFixture`'s
 * public steps: a real first Work Run (its model crashes, the real requeueable
 * ending), the real requeue/continuation claim, its real preparation, and
 * `startRun`. The fixture only reports callsAfter; the expected literals below
 * are the public result and the call count.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { openPC2EntryFixture } from '../helpers/PC2-pack-fixture.js';
import { scriptedModel } from '../helpers/PC-platform-fixture.js';

/** The first Run crashes (a requeueable end); the continuation Run answers. */
const continuationModel = () => scriptedModel([
  { beforeReply: async () => { throw new Error('PC2 PE9 base crash'); } },
  { text: 'PC2 PE9 continuation answer' },
]);

const openEntry = () => openPC2EntryFixture({ model: continuationModel() });

type EntryFixture = Awaited<ReturnType<typeof openPC2EntryFixture>>;

/**
 * Re-store one edited manifest through the public material owner and start the
 * entry with the matching Prepared envelope. The fixture keeps `enter` to its
 * four PE9 cases; the G-01/G-04 counterexamples need their own manifest edit.
 */
async function enterMutated(
  entry: EntryFixture, tag: string, mutate: (manifest: PreparedTaskManifestV1) => void,
) {
  const candidate = structuredClone(entry.prepared);
  const manifest = structuredClone(entry.manifest);
  mutate(manifest);
  // A missing/null binding is itself one of the counterexamples, so only a
  // present binding gets its byte count refreshed.
  if (manifest.contextAssembly !== null && manifest.contextAssembly !== undefined) {
    manifest.contextAssembly.totalBytes = Buffer.byteLength(manifest.input, 'utf8');
  }
  manifest.inputDigest = createHash('sha256').update(manifest.input).digest('hex');
  const stored = await entry.fixture.base.platform.materials.storeArtifact(
    entry.fixture.base.workCtx(entry.continuation.runRef), {
      contentType: entry.prepared.envelope.bundleRef.contentType,
      body: JSON.stringify(manifest),
      sources: manifest.sourceRefs,
      origin: { kind: 'execution', ref: entry.continuation.runRef },
    });
  if (stored.status !== 'stored') throw new Error(JSON.stringify(stored));
  candidate.envelope.bundleRef = stored.ref;
  candidate.inputBinding.inputDigest = manifest.inputDigest;
  candidate.inputBinding.manifestDigest = stored.ref.digest;
  return entry.fixture.runtime.startRun(entry.fixture.base.ctx, {
    prepared: candidate, consumerId: 'pc2-entry', requestId: `pc2-entry-${tag}`,
  });
}

describe('PC2 PE9 continuation brief at the entry', () => {
  it('PE9 wrong range: the binding interval is not the rendered brief, so the entry is invalid and calls no model', async () => {
    const entry = await openEntry();
    try {
      const { result, callsBefore, callsAfter } = await entry.enter('wrong-range');
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(callsAfter).toBe(callsBefore);
    } finally { await entry.close(); }
  });

  it('PE9 duplicated text: the rendered brief occurs twice, so the entry is invalid and calls no model', async () => {
    const entry = await openEntry();
    try {
      const { result, callsBefore, callsAfter } = await entry.enter('duplicate');
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(callsAfter).toBe(callsBefore);
    } finally { await entry.close(); }
  });

  it('PE9 changed character: one byte of the rendered brief changed, so the entry is invalid and calls no model', async () => {
    const entry = await openEntry();
    try {
      const { result, callsBefore, callsAfter } = await entry.enter('changed-character');
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(callsAfter).toBe(callsBefore);
    } finally { await entry.close(); }
  });

  it('PE9 non-tail success: a valid brief before the task enters and reaches the model', async () => {
    const entry = await openEntry();
    try {
      const { result, callsBefore, callsAfter } = await entry.enter('non-tail');
      expect(result).toMatchObject({ status: 'ready' });
      expect(callsAfter).toBe(callsBefore + 1);
    } finally { await entry.close(); }
  }, 60_000);

  it('G-01 foreign order: the binding swaps two absent optional sections, so it differs from the frozen set and the entry is invalid', async () => {
    const entry = await openEntry();
    try {
      const callsBefore = entry.fixture.model.calls();
      const result = await enterMutated(entry, 'foreign-order', manifest => {
        const order = manifest.contextAssembly.sectionOrder;
        const footprint = order.indexOf('footprint');
        const notes = order.indexOf('notes');
        if (footprint === -1 || notes === -1) throw new Error('the frozen continuation order has no footprint/notes');
        [order[footprint], order[notes]] = [order[notes]!, order[footprint]!];
      });
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(entry.fixture.model.calls()).toBe(callsBefore);
    } finally { await entry.close(); }
  }, 60_000);

  it('G-01 missing frozen order: the frozen set names no order for the call kind, so the entry is invalid', async () => {
    const entry = await openEntry();
    try {
      const callsBefore = entry.fixture.model.calls();
      const result = await enterMutated(entry, 'missing-order', manifest => {
        delete manifest.promptSet.sectionOrder['continuation'];
      });
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(entry.fixture.model.calls()).toBe(callsBefore);
    } finally { await entry.close(); }
  }, 60_000);

  it('G-04 null binding: a null contextAssembly is invalid, not unavailable', async () => {
    const entry = await openEntry();
    try {
      const callsBefore = entry.fixture.model.calls();
      const result = await enterMutated(entry, 'null-binding', manifest => {
        (manifest as unknown as { contextAssembly: unknown }).contextAssembly = null;
      });
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(entry.fixture.model.calls()).toBe(callsBefore);
    } finally { await entry.close(); }
  }, 60_000);

  it('G-04 missing binding: an absent contextAssembly is invalid, not unavailable', async () => {
    const entry = await openEntry();
    try {
      const callsBefore = entry.fixture.model.calls();
      const result = await enterMutated(entry, 'missing-binding', manifest => {
        delete (manifest as unknown as { contextAssembly?: unknown }).contextAssembly;
      });
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(entry.fixture.model.calls()).toBe(callsBefore);
    } finally { await entry.close(); }
  }, 60_000);

  it('G-04 malformed section: a null section entry is invalid, not unavailable', async () => {
    const entry = await openEntry();
    try {
      const callsBefore = entry.fixture.model.calls();
      const result = await enterMutated(entry, 'null-section', manifest => {
        (manifest.contextAssembly as unknown as { sections: unknown[] }).sections = [null];
      });
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(entry.fixture.model.calls()).toBe(callsBefore);
    } finally { await entry.close(); }
  }, 60_000);
});
