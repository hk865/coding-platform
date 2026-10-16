/**
 * Slice 4B G3 — M-07 (the `conflicts` read): both sides of a mutual
 * contradiction come back from `memoryConflicts`, by note and by anchor. Data
 * through the real 4A writer; assertions through the real memory read.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'm07', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

describe('S4B M-07 conflicts read', () => {
  it.each(['memory', 'sqlite'] as const)('M-07 %s: memoryConflicts by note lists both sides of a mutual contradiction', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const first = await f.inner.write(f.ctx(), draft({ topic: 'first' }), null);
      if (first.status === 'rejected') throw new Error(JSON.stringify(first));
      const second = await f.inner.write(f.ctx(), draft({ topic: 'second', contradicts: [first.noteId] }), null);
      if (second.status === 'rejected') throw new Error(JSON.stringify(second));
      const read = await f.memory.memoryConflicts(f.ctx(), { v: 1, op: 'conflicts', noteId: first.noteId,
        limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.noteId).sort()).toEqual([first.noteId, second.noteId].sort());
      expect(read.value.items.every(item => item.conflicting)).toBe(true);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-07 %s: memoryConflicts by anchor lists the contradicting current notes', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const first = await f.inner.write(f.ctx(), draft({ topic: 'first' }), null);
      if (first.status === 'rejected') throw new Error(JSON.stringify(first));
      const second = await f.inner.write(f.ctx(), draft({ topic: 'second', contradicts: [first.noteId] }), null);
      if (second.status === 'rejected') throw new Error(JSON.stringify(second));
      const read = await f.memory.memoryConflicts(f.ctx(), { v: 1, op: 'conflicts', anchor: { kind: 'project' },
        limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.noteId).sort()).toEqual([first.noteId, second.noteId].sort());
    } finally { await f.close(); }
  });
});
