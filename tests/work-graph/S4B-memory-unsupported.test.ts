/**
 * Slice 4B G3 round 2 — MF7b/R7: an FTS5-unavailable SQLite store answers
 * `unsupported` for a term search, never `unavailable`, and a no-terms find on
 * the same store still reads the head indexes. The probe double is the spec §7
 * `fullTextProbe` option, reached through the S4B fixture's existing store
 * composition (no new `createPlatform` option).
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'unsupported', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

describe('S4B MF7b FTS5 unavailable', () => {
  it('MF7b a term search is unsupported and a no-terms find is still ready', async () => {
    const f = await createS4BNoteCheckFixture('sqlite', { fullTextUnavailable: true });
    try {
      const written = await f.inner.write(f.ctx(), draft({ topic: 'alpha topic' }), null);
      if (written.status === 'rejected') throw new Error(JSON.stringify(written));
      const search = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha'],
        limit: 20, cursor: null });
      expect(search.status).toBe('rejected');
      if (search.status !== 'rejected') return;
      expect(search.code).toBe('unsupported');

      const byAnchor = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', anchor: { kind: 'project' },
        limit: 20, cursor: null });
      expect(byAnchor.status).toBe('ready');
      if (byAnchor.status !== 'ready') return;
      expect(byAnchor.value.items.map(item => item.noteId)).toContain(written.noteId);
    } finally { await f.close(); }
  });
});
