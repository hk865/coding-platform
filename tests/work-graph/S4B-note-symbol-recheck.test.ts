/**
 * Slice 4B G2 round 2 — MF4 / R4: the read-side symbol recheck matches by the
 * stored `qualifiedName`, uses the stored range only to pick among several hits,
 * and reports an incomplete analysis as `unchecked`, never `symbol_missing`.
 * The note is written through the real 4A writer (which builds a real capture)
 * and re-read after the workspace file changes.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'symbols', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeSymbolNote(f: S4BNoteCheckFixture): Promise<string> {
  const result = await f.inner.write(f.ctx(), draft({ anchor: { kind: 'file', path: 'src/a/x.ts',
    symbolRequest: { language: 'typescript', name: 'a' } } }), null);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('S4B MF4 symbol rechecks', () => {
  it.each(['memory', 'sqlite'] as const)('MF4 %s: a line inserted above the symbol keeps it live', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeSymbolNote(f);
      await writeFile(join(f.root, 'src/a/x.ts'), '// moved\nexport const a = 1;\n');
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('live');
      expect(read.value.anchorRetiredReasons).toEqual([]);
      expect(read.value.staleReasons).toEqual([]);
      expect(read.value.freshness).toBe('fresh');
      expect(read.value.currentEligible).toBe(true);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF4 %s: a capped symbol scan is unchecked, not symbol_missing', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { check: { symbolHitsMax: 2 } });
    try {
      const noteId = await writeSymbolNote(f);
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const a = 2;\nexport const b = 2;\nexport const c = 3;\n');
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('live');
      expect(read.value.anchorRetiredReasons).toEqual([]);
      expect(read.value.freshness).toBe('unchecked');
      expect(read.value.currentEligible).toBe(false);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF4 %s: two same-name hits use the hit at the stored range', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeSymbolNote(f);
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const a = 1;\nnamespace N { export const a = 2; }\n');
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('live');
      expect(read.value.anchorRetiredReasons).toEqual([]);
      expect(read.value.currentEligible).toBe(true);
    } finally { await f.close(); }
  });

});
