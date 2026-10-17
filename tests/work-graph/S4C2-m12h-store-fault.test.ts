/**
 * S4C2 M-12h (spec §11.5, §11.8: "`unsupported` 的读是 `unavailable`").
 *
 * The goal, its plan and the understanding all come from
 * `createS4ANoteFaultFixture()`, which builds them through the real public
 * services. The ONLY double is the spec-allowed read-fault switch: exactly one
 * `RUN_BY_GOAL_INDEX` (`r3c-run-by-goal`) lookup returns `unsupported`. The
 * read under test is the public `notes.memoryLookup` on the goal anchor; it
 * must be `unavailable` for that call, never `ready` with an empty trigger set.
 *
 * This is the real store-fault replacement for the deleted tamper-only
 * damaged-record tests (AGENTS rule 4: no tests for states only tampering can
 * make). If the reader treats `unsupported` as an empty set, the `ready` read
 * below fails the `unavailable` assertion.
 */
import { describe, expect, it } from 'vitest';
import type { NoteAnchorV1, NoteDraftAnchorV1, NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import { createS4ANoteFaultFixture } from '../helpers/S4A-note-fault-fixture.js';

/** `src/core/work-graph/tasks/plan-readers.ts`: the Goal's Runs index. */
const RUN_BY_GOAL_INDEX = 'r3c-run-by-goal';

function sections(): NoteSectionsV1 {
  return { status: 's', decided: 'd', open: 'o', next: 'n', risks: 'r' };
}

function understanding(anchor: NoteDraftAnchorV1, conclusion: string): NoteDraftV1 {
  return { kind: 'understanding', topic: 'understanding', conclusion, anchor, extraAnchors: [],
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
    sections: sections() };
}

describe('S4C2 M-12h store fault over the public note read', () => {
  it('M-12h: an unsupported Run-index lookup is unavailable, never an empty anchor set', async () => {
    const f = await createS4ANoteFaultFixture();
    try {
      const goalAnchor: NoteAnchorV1 = { kind: 'goal', goalId: f.goalRef.goalId };
      // A real goal-anchored understanding exists, so a `ready` read would have
      // to report it; the only reason for `unavailable` is the store fault.
      const written = await f.write(f.ctx(), understanding({ kind: 'goal', goalId: f.goalRef.goalId }, 'goal now'),
        f.goalRef.goalId);
      expect(written.status).toBe('accepted');
      if (written.status !== 'accepted') throw new Error(JSON.stringify(written));

      f.arm({ kind: 'lookup', index: RUN_BY_GOAL_INDEX, code: 'unsupported' });
      const read = await f.notes.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: goalAnchor,
        limit: 20, cursor: null });
      expect(read).toMatchObject({ status: 'rejected', code: 'unavailable' });
      if (read.status !== 'rejected') return;
      expect(read).not.toHaveProperty('understanding');

      // Disarming shows the same call is readable again: the rejection was the
      // one injected store fault, not a permanently unreadable anchor.
      f.disarm();
      const after = await f.notes.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: goalAnchor,
        limit: 20, cursor: null });
      expect(after.status).toBe('ready');
      if (after.status !== 'ready') return;
      expect(after.value.understanding).toMatchObject({ anchorKey: `goal:${f.goalRef.goalId}`,
        pointer: { noteId: written.noteId, revision: 1 }, updateDue: false, latestTriggerCursor: null });
    } finally { await f.close(); }
  });
});
