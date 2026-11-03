/**
 * Slice 4B G3 — M-16 `not_found` versus empty versus retired (L12/L2a). Data
 * only through the real 4A writes; assertions only through the real
 * `memoryLookup`.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';
import { bindCatalogRevision, catalogRevisionModule } from '../helpers/S8C-catalog-world.js';
const catalogMock = vi.hoisted(() => ({ actual: null as null | Record<string, unknown>,
  revision: null as null | Record<string, unknown> }));
vi.mock('../../src/core/work-graph/architecture/catalog-service.js', async importOriginal => {
  const actual = await importOriginal() as Record<string, unknown>;
  catalogMock.actual = actual;
  return { ...actual, createArchitectureCatalogService: (stores: unknown) => {
    if (catalogMock.revision === null) throw new Error('the catalog revision factory is not bound');
    return (catalogMock.revision['createArchitectureCatalogService'] as (stores: unknown) => unknown)(stores);
  } };
});
beforeAll(async () => { catalogMock.revision = await catalogRevisionModule(async () => catalogMock.actual!); });

describe('S4B M-16 not_found vs empty', () => {
  it.each(['memory', 'sqlite'] as const)('M-16 %s: a missing module anchor with no head is not_found anchor_not_found', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const read = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup',
        anchor: { kind: 'module', moduleId: 'A2' }, limit: 20, cursor: null });
      expect(read.status).toBe('rejected');
      if (read.status !== 'rejected') return;
      expect(read.code).toBe('not_found');
      expect(read.reason).toBe('anchor_not_found');
      const candidates = (read as unknown as { anchorCandidates: { kind: string; id: string; displayName: string }[] }).anchorCandidates;
      expect(candidates).toEqual([
        { kind: 'module', id: 'A', displayName: 'A' },
        { kind: 'module', id: 'A1', displayName: 'A1' },
        { kind: 'module', id: 'B', displayName: 'B' },
        { kind: 'module', id: 'R', displayName: 'R' },
      ]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-16 %s: an existing anchor with no notes is an empty complete page', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const read = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup',
        anchor: { kind: 'project' }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items).toEqual([]);
      expect(read.value.complete).toBe(true);
      expect(read.value.next).toBe(null);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-16 %s: a module that is gone but still has heads returns them as retired', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const written = await f.inner.write(f.ctx(), {
        kind: 'pitfall', topic: 'gone-module', conclusion: 'a conclusion', body: 'body',
        anchor: { kind: 'module', moduleId: 'B' }, extraAnchors: [], facts: [], basisFiles: [],
        structural: false, replaces: [], contradicts: [], coexistWith: [],
      } as NoteDraftV1, null);
      if (written.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(written)}`);
      const current = await f.inner.platform.architecture.readArchitectureRevision(f.ctx(),
        { selection: { kind: 'current' } });
      if (current.status !== 'ready') throw new Error('catalog read failed');
      const revised = await f.inner.platform.architecture.reviseArchitectureCatalog(f.ctx(), {
        meta: { requestId: 's4b-m16-remove-module', expected: [{ ref: f.inner.projectRef, revision: 1 },
          { ref: f.inner.workspaceRef, revision: 1 }] },
        input: {
          expected: { catalogRef: current.value.catalog.ref,
            baseline: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest } },
          ops: [{ op: 'remove_module', moduleId: 'B' }], responsibilityMoves: [],
          reason: 'M-16: delete module B while its note heads stay' } });
      if (revised.status !== 'committed') throw new Error(`revise failed: ${JSON.stringify(revised)}`);
      const read = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup',
        anchor: { kind: 'module', moduleId: 'B' }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.noteId)).toEqual([written.noteId]);
      for (const item of read.value.items) {
        expect(item.anchorStatus).toBe('retired');
        expect(item.anchorRetiredReasons).toEqual(['module_removed']);
      }
    } finally { await f.close(); }
  });
});
