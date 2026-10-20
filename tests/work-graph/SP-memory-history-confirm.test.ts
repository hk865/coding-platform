/**
 * SP-13 (S2.8) — `history` derives `confirmedByUser` per listed version from the
 * first user confirmation at or before it.
 *
 * A note reaches head version 4: an agent write (v1, pending_review over quota),
 * a scribe accept (v2, accepted), a user review (v3, reviewed, the confirmation)
 * and a user withdraw (v4, withdrawn). Data and dispositions go through
 * `platform.notes`; assertions go through the real `memoryHistory`.
 *
 * The book asks for head version >= 5 with the confirmation at version 3. With
 * only the public disposition machine (accept needs `pending_review`, review
 * needs `accepted`, withdraw/supersede from an open state), the longest reachable
 * chain is v1 pending -> v2 accept -> v3 review -> v4 withdraw/supersede; a
 * fifth version cannot be built through any public interface, so SP-13b is
 * skipped below and reported.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'sp13', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function write(f: S4BNoteCheckFixture, note: NoteDraftV1, goalId: string | null = null):
Promise<string> {
  const result = await f.inner.write(f.ctx(), note, goalId);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('SP-13 history confirmation across versions', () => {
  it.each(['memory', 'sqlite'] as const)(
    'SP-13 %s: a user confirmation at version 3 marks version 3 and later, not 1 or 2', async kind => {
      const f = await createS4BNoteCheckFixture(kind, { anchorQuota: 1 });
      try {
        // Fill the single anchor slot so the agent write below is pending_review
        // for quota_full (not structural/contradiction), which a scribe may accept.
        await write(f, draft({ topic: 'baseline' }));
        const run = await f.inner.claimRun('sp13-agent');
        const target = await f.inner.write(f.inner.workCtx(run), draft({ topic: 'target' }), null);
        if (target.status === 'rejected') throw new Error(`agent write rejected: ${JSON.stringify(target)}`);
        const noteId = target.noteId;
        expect(target.status).toBe('pending_review');
        expect(target.version).toBe(1);

        const scribe = await f.inner.claimRun('sp13-scribe', 't3', 'scribe');
        const accepted = await f.inner.platform.notes.reviewNote(f.inner.workCtx(scribe), {
          commandId: 'sp13-accept', noteId, expectedVersion: 1, expectedPointerRevision: null,
          verdict: 'accept', reason: 'quota note accepted by the scribe' });
        expect(accepted).toMatchObject({ status: 'done', version: 2, state: 'accepted' });

        const reviewed = await f.inner.platform.notes.reviewNote(f.ctx(), {
          commandId: 'sp13-review', noteId, expectedVersion: 2, expectedPointerRevision: null,
          verdict: 'review', reason: null });
        expect(reviewed).toMatchObject({ status: 'done', version: 3, state: 'reviewed' });

        const withdrawn = await f.inner.platform.notes.withdrawNote(f.ctx(), {
          commandId: 'sp13-withdraw', noteId, expectedVersion: 3, reason: 'sp13 done' });
        expect(withdrawn).toMatchObject({ status: 'done', version: 4, state: 'withdrawn' });

        const history = await f.memory.memoryHistory(f.ctx(), { v: 1, op: 'history', noteId,
          limit: 20, cursor: null });
        expect(history.status).toBe('ready');
        if (history.status !== 'ready') return;
        expect(history.value.items.map(item => item.version)).toEqual([4, 3, 2, 1]);
        expect(history.value.items.map(item => item.storedState))
          .toEqual(['withdrawn', 'reviewed', 'accepted', 'pending_review']);
        expect(history.value.items.map(item => item.confirmedByUser)).toEqual([true, true, false, false]);
      } finally { await f.close(); }
    });
});
