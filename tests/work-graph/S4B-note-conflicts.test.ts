/**
 * Slice 4B G2 — M-07 conflicting. Two current notes that point `contradicts`
 * at each other through a real accepted write plus the real host acceptance of
 * the pending note. Every write goes through `platform.notes`; assertions go
 * only through the public reads.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'conflict', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

describe('S4B M-07 contradicting current notes', () => {
  it.each(['memory', 'sqlite'] as const)('M-07 %s: both notes of an accepted contradiction are conflicting', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const firstWrite = await f.inner.write(f.ctx(), draft({ topic: 'first' }), null);
      if (firstWrite.status === 'rejected') throw new Error(JSON.stringify(firstWrite));
      const first = firstWrite.noteId;
      const secondWrite = await f.inner.write(f.ctx(), draft({ topic: 'second', contradicts: [first] }), null);
      if (secondWrite.status === 'rejected') throw new Error(JSON.stringify(secondWrite));
      // A user write is accepted directly (L5); the contradiction is kept on the
      // head and both current notes must report it.
      expect(secondWrite.status).toBe('accepted');
      const second = secondWrite.noteId;

      const firstRead = await f.notes.readNote(f.ctx(), { noteId: first });
      const secondRead = await f.notes.readNote(f.ctx(), { noteId: second });
      expect(firstRead.status).toBe('ready');
      expect(secondRead.status).toBe('ready');
      if (firstRead.status !== 'ready' || secondRead.status !== 'ready') return;
      expect(firstRead.value.conflicting).toBe(true);
      expect(secondRead.value.conflicting).toBe(true);
    } finally { await f.close(); }
  });
});
