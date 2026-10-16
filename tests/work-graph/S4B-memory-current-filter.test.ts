/**
 * Slice 4B G3 — M-08 the current-conclusion filter and cross-goal order (R9).
 *
 * Data: the real `S4B` fixture plus a second real Goal (`S4B-memory-fixture`);
 * every note is written through the real 4A writer. The reader is an agent Run
 * of the first Goal, so notes of the second Goal are `crossGoal`. R9: `lookup`
 * lists accepted/reviewed/pending_review/staged heads and never filters by
 * `currentEligible`; a stale note is listed with `currentEligible: false`.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';
import { createS4BExtraGoal, type S4BExtraGoal } from '../helpers/S4B-memory-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'm08', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function write(f: S4BNoteCheckFixture, ctx: CoreCallContext, note: NoteDraftV1, goalId: string | null): Promise<string> {
  const result = await f.inner.write(ctx, note, goalId);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('S4B M-08 current filter and cross-goal order', () => {
  it.each(['memory', 'sqlite'] as const)('M-08 %s: lookup lists the stale note too, marks it ineligible, and orders the tiers', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    let extra: S4BExtraGoal | null = null;
    try {
      extra = await createS4BExtraGoal(f, 's4b-goal-2');
      const goal1Run = await f.inner.claimRun('m08-goal1');
      const goal2Run = await extra.claimRun('m08-goal2', 't1', 'executor');
      const goal2Scribe = await extra.claimRun('m08-scribe', 't3', 'scribe');

      // 1. own Goal, agent, accepted.
      const own = await write(f, f.inner.workCtx(goal1Run), draft({ topic: 'own' }), null);
      // 2. other Goal, user, confirmed by the user.
      const confirmed = await write(f, f.ctx(), draft({ topic: 'confirmed' }), extra.goalRef.goalId);
      // 3. other Goal, agent, then reviewed by the scribe (not confirmed by the user).
      const reviewed = await write(f, extra.workCtx(goal2Run, 'executor'), draft({ topic: 'reviewed' }), null);
      const review = await f.inner.platform.notes.reviewNote(extra.workCtx(goal2Scribe, 'scribe'), {
        commandId: 's4b-m08-review', noteId: reviewed, expectedVersion: 1, expectedPointerRevision: null,
        verdict: 'review', reason: null });
      expect(review.status).toBe('done');
      // 4. other Goal, agent, accepted only: it must not appear.
      const crossAccepted = await write(f, extra.workCtx(goal2Run, 'executor'), draft({ topic: 'cross-accepted' }), null);
      // 5. own Goal, agent, basis file changed afterwards: stale, but still listed.
      const stale = await write(f, f.inner.workCtx(goal1Run), draft({ topic: 'stale', basisFiles: ['src/a/x.ts'] }), null);
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const a = 2;\n');

      const read = await f.memory.memoryLookup(f.inner.workCtx(goal1Run), { v: 1, op: 'lookup',
        anchor: { kind: 'project' }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      const byId = new Map(read.value.items.map(item => [item.noteId, item]));
      expect([...byId.keys()].sort()).toEqual([own, confirmed, reviewed, stale].sort());
      expect(byId.has(crossAccepted)).toBe(false);
      expect(byId.get(own)!.currentEligible).toBe(true);
      expect(byId.get(confirmed)!.currentEligible).toBe(true);
      expect(byId.get(reviewed)!.currentEligible).toBe(true);
      expect(byId.get(stale)!.currentEligible).toBe(false);
      expect(byId.get(stale)!.freshness).toBe('stale');
      expect(byId.get(own)!.crossGoal).toBe(false);
      expect(byId.get(stale)!.crossGoal).toBe(false);
      expect(byId.get(confirmed)!.crossGoal).toBe(true);
      expect(byId.get(reviewed)!.crossGoal).toBe(true);
      // Tiers: own/stale (0), confirmed (1), reviewed (2), each ascending.
      const tierOf = (noteId: string): number => noteId === confirmed ? 1 : noteId === reviewed ? 2 : 0;
      const tiers = read.value.items.map(item => tierOf(item.noteId));
      expect(tiers).toEqual([...tiers].sort((left, right) => left - right));
    } finally { await f.close(); }
  });
});
