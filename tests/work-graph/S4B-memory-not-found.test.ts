/**
 * Slice 4B G3 — M-16 `not_found` versus empty versus retired (L12/L2a). Data
 * only through the real 4A writes; assertions only through the real
 * `memoryLookup`.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'm16', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

describe('S4B M-16 not_found vs empty', () => {
  it.each(['memory', 'sqlite'] as const)('M-16 %s: a missing module anchor with no head is not_found anchor_not_found', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
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

  // BLOCKED (spec M-16/L23 `module_removed`): `reviseArchitectureCatalog`
  // refuses to remove any existing module (`catalog-service.ts:671-673`) and
  // `adoptInitialArchitecture` refuses a project with an active baseline, so no
  // real public path can leave a module with heads out of the current catalog.
  it.skip('M-16 a module that is gone but still has heads returns them as retired', () => { /* see comment */ });
});
