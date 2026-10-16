/**
 * Slice 4B G3 round 2 — MF11/R11: `history` pages first and checks only the
 * page; only the head version can be `currentEligible`; the body attaches to the
 * item whose noteId AND version match; `neighbors` reads the requested version.
 * Data through the real 4A writer; assertions through the real memory reads.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1, NoteFactV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'mf11', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function write(f: S4BNoteCheckFixture, note: NoteDraftV1): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, null);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('S4B MF11 versioned reads', () => {
  it.each(['memory', 'sqlite'] as const)('MF11 %s: a historical accepted version is not current and history shows both stored states', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const a = await write(f, draft({ topic: 'a' }));
      const b = await write(f, draft({ topic: 'b', replaces: [a] }));
      const version1 = await f.notes.readNote(f.ctx(), { noteId: a, version: 1 });
      expect(version1.status).toBe('ready');
      if (version1.status !== 'ready') return;
      expect(version1.value.storedState).toBe('accepted');
      expect(version1.value.currentEligible).toBe(false);

      const history = await f.memory.memoryHistory(f.ctx(), { v: 1, op: 'history', noteId: a,
        limit: 20, cursor: null });
      expect(history.status).toBe('ready');
      if (history.status !== 'ready') return;
      expect(history.value.items.map(item => [item.version, item.storedState, item.currentEligible]))
        .toEqual([[2, 'superseded', false], [1, 'accepted', false]]);
      void b;
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF11 %s: body attaches only to the item whose noteId and version match', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await write(f, draft({ topic: 'body', body: 'hello body' }));
      const review = await f.inner.platform.notes.reviewNote(f.ctx(), { commandId: 's4b-mf11-review',
        noteId, expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(review.status).toBe('done');
      const history = await f.memory.memoryHistory(f.ctx(), { v: 1, op: 'history', noteId, limit: 20, cursor: null,
        body: { noteId, version: 1, cursor: null } });
      expect(history.status).toBe('ready');
      if (history.status !== 'ready') return;
      expect(history.value.items.map(item => [item.version, item.body?.text ?? null]))
        .toEqual([[2, null], [1, 'hello body']]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF11 %s: a body target not on the page warns and attaches nothing', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await write(f, draft({ topic: 'body', body: 'hello body' }));
      const review = await f.inner.platform.notes.reviewNote(f.ctx(), { commandId: 's4b-mf11-review3',
        noteId, expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(review.status).toBe('done');
      // Page 1 (limit 1) holds only v2; the body target is v1.
      const page = await f.memory.memoryHistory(f.ctx(), { v: 1, op: 'history', noteId, limit: 1, cursor: null,
        body: { noteId, version: 1, cursor: null } });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.items.map(item => item.version)).toEqual([2]);
      expect(page.value.items[0]!.body).toBeUndefined();
      expect(page.value.warnings).toContain('body_target_not_on_page');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF11 %s: neighbors of a missing version is not_found', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const a = await write(f, draft({ topic: 'a' }));
      const read = await f.memory.memoryNeighbors(f.ctx(), { v: 1, op: 'neighbors', noteId: a,
        version: 99, limit: 20, cursor: null });
      expect(read.status).toBe('not_found');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF11 %s: history checks only the page, so the second page stays fresh within the facts budget', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { check: { readFactsMax: 3 } });
    try {
      const b1 = await write(f, draft({ topic: 'b1' }));
      const b2 = await write(f, draft({ topic: 'b2' }));
      const b3 = await write(f, draft({ topic: 'b3' }));
      const facts: NoteFactV1[] = [
        { kind: 'note', noteId: b1, version: 1 },
        { kind: 'note', noteId: b2, version: 1 },
        { kind: 'note', noteId: b3, version: 1 },
      ];
      const a = await write(f, draft({ topic: 'a', facts }));
      const review = await f.inner.platform.notes.reviewNote(f.ctx(), { commandId: 's4b-mf11-review2',
        noteId: a, expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(review.status).toBe('done');
      const first = await f.memory.memoryHistory(f.ctx(), { v: 1, op: 'history', noteId: a, limit: 1, cursor: null });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      const second = await f.memory.memoryHistory(f.ctx(), { v: 1, op: 'history', noteId: a, limit: 1,
        cursor: first.value.next });
      expect(second.status).toBe('ready');
      if (second.status !== 'ready') return;
      expect(second.value.items.map(item => item.version)).toEqual([1]);
      expect(second.value.items[0]!.freshness).toBe('fresh');
      expect(second.value.items[0]!.uncheckedFacts).toEqual([]);
    } finally { await f.close(); }
  });
});
