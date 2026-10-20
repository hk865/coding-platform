/**
 * Slice 4B G2 — M-01, M-04, M-11: file freshness and the read-side workspace
 * observation. Every dataset is built through the real 4A `platform.notes`
 * writers over a real temporary workspace; files are changed directly on disk,
 * which is what the row observes. Assertions go only through the public
 * `readNote`/`listByAnchor` and the real `checkNotes`.
 */
import { rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1, NoteFactV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, currentVersion, fileDigestOf } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'freshness', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeAccepted(f: Awaited<ReturnType<typeof createS4BNoteCheckFixture>>, note: NoteDraftV1): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, null);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('S4B M-01 changed and deleted basis files', () => {
  it.each(['memory', 'sqlite'] as const)('M-01 %s: a changed basis file is stale with exactly that file listed', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeAccepted(f, draft({ basisFiles: ['src/a/x.ts', 'src/a/one/x.ts'] }));
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const a = 2;\n');
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.freshness).toBe('stale');
      expect(read.value.changedFiles).toEqual([{ path: 'src/a/x.ts', deleted: false }]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-01 %s: a deleted basis file is stale with deleted true and outcome deleted', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeAccepted(f, draft({ basisFiles: ['src/a/one/x.ts'] }));
      await rm(join(f.root, 'src/a/one/x.ts'));
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.changedFiles).toEqual([{ path: 'src/a/one/x.ts', deleted: true }]);
      expect(read.value.observedFiles).toEqual([{ path: 'src/a/one/x.ts', digest: null, outcome: 'deleted' }]);
    } finally { await f.close(); }
  });
});

describe('S4B M-04 retired basis note', () => {
  it.each(['memory', 'sqlite'] as const)('M-04 %s: a superseded basis-note head makes the note stale for basis_note_retired', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const first = await writeAccepted(f, draft({ topic: 'first' }));
      const fact: NoteFactV1 = { kind: 'note', noteId: first, version: 1 };
      const second = await writeAccepted(f, draft({ topic: 'second', facts: [fact] }));
      // A replacement accepted in this same anchor retires the first note's head.
      await writeAccepted(f, draft({ topic: 'replacement', replaces: [first] }));
      const read = await f.notes.readNote(f.ctx(), { noteId: second });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.freshness).toBe('stale');
      expect(read.value.staleReasons).toContain('basis_note_retired');
    } finally { await f.close(); }
  });
});

describe('S4B M-11 workspace observation at read', () => {
  it.each(['memory', 'sqlite'] as const)('M-11 %s: a file past the size limit is unchecked with outcome capacity', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeAccepted(f, draft({ basisFiles: ['src/a/x.ts'] }));
      await writeFile(join(f.root, 'src/a/x.ts'), 'x'.repeat(1024 * 1024 + 1));
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.freshness).toBe('unchecked');
      expect(read.value.observedFiles).toEqual([{ path: 'src/a/x.ts', digest: null, outcome: 'capacity' }]);
    } finally { await f.close(); }
  });

  // R16 read-side forbidden: the workspace tools answer `forbidden` for a
  // symlink basis path (the spec's example points outside the root), so the
  // item is unchecked and the path is observed with outcome forbidden.
  it.each(['memory', 'sqlite'] as const)(
    'M-11 %s: a basis file replaced by an escaping symlink is unchecked with outcome forbidden', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const noteId = await writeAccepted(f, draft({ basisFiles: ['src/a/one/x.ts'] }));
        await writeFile(join(f.root, '..', 's4b-read-forbidden-outside.ts'), 'export const outside = 1;\n');
        await rm(join(f.root, 'src/a/one/x.ts'));
        await symlink('../../../../s4b-read-forbidden-outside.ts', join(f.root, 'src/a/one/x.ts'));
        const read = await f.notes.readNote(f.ctx(), { noteId });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect(read.value.freshness).toBe('unchecked');
        expect(read.value.observedFiles).toContainEqual(
          { path: 'src/a/one/x.ts', digest: null, outcome: 'forbidden' });
      } finally { await f.close(); }
    });

  it.each(['memory', 'sqlite'] as const)('M-11 %s: a file fact whose current digest differs is changed, not unresolved', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const original = await fileDigestOf(join(f.root, 'src/a/x.ts'));
      const noteId = await writeAccepted(f,
        draft({ facts: [{ kind: 'file', path: 'src/a/x.ts', digest: original }] }));
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const a = 3;\n');
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId, version: await currentVersion(f, noteId) }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[0]!.changedFiles).toEqual([{ path: 'src/a/x.ts', deleted: false }]);
      expect(checks.value[0]!.unresolvedFacts).toEqual([]);
    } finally { await f.close(); }
  });
});
