/**
 * Slice 4B G3 round 2 — R9/MF9: the three anchor-scoped reads (`lookup`,
 * `conflicts`, `find`) answer `not_found`/`anchor_not_found` with the resolver's
 * bounded candidates when the anchor does not exist now, and `lookup` lists
 * retired heads instead of hiding them. Data only through the real 4A writer;
 * assertions only through the real memory reads.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'mf9', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function write(f: S4BNoteCheckFixture, note: NoteDraftV1): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, null);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('S4B MF9 anchor not found and retired heads', () => {
  it.each(['memory', 'sqlite'] as const)('MF9 %s: lookup of a deleted file anchor lists the retired head', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await write(f, draft({ topic: 'retired-file',
        anchor: { kind: 'file', path: 'src/a/x.ts' } }));
      await rm(join(f.root, 'src/a/x.ts'));
      const read = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup',
        anchor: { kind: 'file', path: 'src/a/x.ts' }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.noteId)).toEqual([noteId]);
      expect(read.value.items[0]!.anchorStatus).toBe('retired');
      expect(read.value.items[0]!.anchorRetiredReasons).toEqual(['file_deleted']);
      expect(read.value.items[0]!.currentEligible).toBe(false);
      expect(read.value.complete).toBe(true);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF9 %s: lookup of a missing file anchor carries the path candidates', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const read = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup',
        anchor: { kind: 'file', path: 'src/a/z.ts' }, limit: 20, cursor: null });
      expect(read.status).toBe('rejected');
      if (read.status !== 'rejected') return;
      expect(read.code).toBe('not_found');
      expect(read.reason).toBe('anchor_not_found');
      const candidates = (read as unknown as { anchorCandidates: { kind: string; id: string; displayName: string }[] }).anchorCandidates;
      expect(candidates).toEqual([
        { kind: 'file', id: 'src/a/x.ts', displayName: 'src/a/x.ts' },
        { kind: 'file', id: 'src/a/one/x.ts', displayName: 'src/a/one/x.ts' },
      ]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF9 %s: conflicts and find check the anchor independently of matches', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const missing = { kind: 'module' as const, moduleId: 'A2' };
      const conflicts = await f.memory.memoryConflicts(f.ctx(), { v: 1, op: 'conflicts', anchor: missing, limit: 20, cursor: null });
      expect(conflicts.status).toBe('rejected');
      if (conflicts.status !== 'rejected') return;
      expect(conflicts).toMatchObject({ code: 'not_found', reason: 'anchor_not_found' });
      expect((conflicts as unknown as { anchorCandidates: unknown[] }).anchorCandidates).toHaveLength(4);

      const findNoTerms = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', anchor: missing, limit: 20, cursor: null });
      expect(findNoTerms.status).toBe('rejected');
      if (findNoTerms.status !== 'rejected') return;
      expect(findNoTerms).toMatchObject({ code: 'not_found', reason: 'anchor_not_found' });

      const findTerms = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', anchor: missing,
        terms: ['架构'], limit: 20, cursor: null });
      expect(findTerms.status).toBe('rejected');
      if (findTerms.status !== 'rejected') return;
      expect(findTerms).toMatchObject({ code: 'not_found', reason: 'anchor_not_found' });
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF9 %s: find on an existing empty anchor and a deleted retired anchor is empty/complete', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await write(f, draft({ topic: 'gone', anchor: { kind: 'file', path: 'src/a/x.ts' } }));
      await rm(join(f.root, 'src/a/x.ts'));

      const existing = await f.memory.memoryConflicts(f.ctx(), { v: 1, op: 'conflicts',
        anchor: { kind: 'module', moduleId: 'B' }, limit: 20, cursor: null });
      expect(existing.status).toBe('ready');
      if (existing.status !== 'ready') return;
      expect(existing.value.items).toEqual([]);
      expect(existing.value.complete).toBe(true);

      // The retired head still carries the file anchor key, so `find` is not
      // `not_found`; the unmatched term yields an empty, complete page.
      const find = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find',
        anchor: { kind: 'file', path: 'src/a/x.ts' }, terms: ['zzzz'], limit: 20, cursor: null });
      expect(find.status).toBe('ready');
      if (find.status !== 'ready') return;
      expect(find.value.items).toEqual([]);
      expect(find.value.complete).toBe(true);
      void noteId;
    } finally { await f.close(); }
  });
});
