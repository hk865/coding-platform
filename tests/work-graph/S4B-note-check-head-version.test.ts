/**
 * Slice 4B R11 boundary: `platform.notes.checkNotes` itself only marks the
 * checked note's HEAD version as `currentEligible`; the read-model wrapper's
 * mask is not the only boundary. Data comes from the real 4A writers; the
 * assertion goes through the real holder's own `checkNotes`.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'head-version', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

describe('S4B R11 checkNotes head eligibility', () => {
  it.each(['memory', 'sqlite'] as const)(
    'R11 %s: checkNotes marks an old accepted version ineligible and the head eligible', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const written = await f.inner.write(f.ctx(), draft(), null);
        if (written.status === 'rejected') throw new Error(JSON.stringify(written));
        const review = await f.inner.platform.notes.reviewNote(f.ctx(), { commandId: 's4b-r11-review',
          noteId: written.noteId, expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
        expect(review.status).toBe('done');
        const checked = await f.check.checkNotes(f.ctx(), { items: [
          { noteId: written.noteId, version: 1 }, { noteId: written.noteId, version: 2 }] });
        expect(checked.status).toBe('ready');
        if (checked.status !== 'ready') return;
        expect(checked.value[0]!.currentEligible).toBe(false);
        expect(checked.value[1]!.currentEligible).toBe(true);
      } finally { await f.close(); }
    });
});
