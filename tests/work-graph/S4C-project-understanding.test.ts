/**
 * Slice 4C-1 C2.4 — the §11.4 project-understanding read side. The project
 * understanding is written through the real public write service (project
 * scribe) and read back through the public `platform.notes` reads on both
 * backends (NE3).
 */
import { describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';
import { createS4BExtraGoal } from '../helpers/S4B-memory-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'pu', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

function understandingDraft(): NoteDraftV1 {
  return { kind: 'understanding', topic: 'project-understanding', conclusion: 'the project now',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [],
    sections: { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' },
  } as NoteDraftV1;
}

/** The project scribe (a scribe with no responsible module link) writes the understanding. */
async function writeProjectUnderstanding(f: S4BNoteCheckFixture): Promise<string> {
  const scribe = await f.inner.claimRun('s4c-pu-scribe', 't3', 'scribe');
  const result = await f.inner.write(f.inner.workCtx(scribe), understandingDraft(), null,
    { expectedPointerRevision: null });
  if (result.status === 'rejected') throw new Error(`project understanding rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

async function writeGoalNote(f: S4BNoteCheckFixture, ctx: CoreCallContext, topic: string, goalId: string) {
  return f.inner.write(ctx, draft({ topic, anchor: { kind: 'goal', goalId } }), null);
}

describe('S4C PU-02 project understanding read side', () => {
  it.each(['memory', 'sqlite'] as const)(
    'PU-02 + DS-07 %s: a g2 work Run lookup {kind:project} returns the pointer, currentEligible true, crossGoal false, and it takes no goal quota; find sees it',
    async kind => {
      // goalQuota 2: if the project understanding counted toward g1, the second
      // g1 goal note would be quota-pending.
      const f = await createS4BNoteCheckFixture(kind, { goalQuota: 2 });
      try {
        const g1 = f.inner.goalRef.goalId;
        const g1Run = await f.inner.claimRun('s4c-pu-g1');
        const g1Ctx = f.inner.workCtx(g1Run);
        const extra = await createS4BExtraGoal(f, 's4c-pu-goal-2');
        const g2Run = await extra.claimRun('s4c-pu-g2', 't1', 'executor');
        const g2 = extra.workCtx(g2Run, 'executor');
        await writeGoalNote(f, g1Ctx, 'pu-goal-a', g1);
        const understanding = await writeProjectUnderstanding(f);
        const second = await writeGoalNote(f, g1Ctx, 'pu-goal-b', g1);
        expect(second.status).toBe('accepted');

        const lookup = await f.memory.memoryLookup(g2, { v: 1, op: 'lookup', anchor: { kind: 'project' },
          limit: 20, cursor: null });
        expect(lookup.status).toBe('ready');
        if (lookup.status !== 'ready') return;
        expect(lookup.value.understanding).not.toBe(null);
        expect(lookup.value.understanding!.anchorKey).toBe('project');
        expect(lookup.value.understanding!.pointer.noteId).toBe(understanding);
        expect(lookup.value.understanding!.pointer.revision).toBe(1);
        expect(lookup.value.understanding!.updateDue).toBe(null);
        const item = lookup.value.items.find(candidate => candidate.noteId === understanding);
        expect(item).toBeDefined();
        expect(item!.currentEligible).toBe(true);
        expect(item!.crossGoal).toBe(false);
        expect(item!.storedState).toBe('accepted');

        // DS-07's find half: the same g2 Run sees the understanding through
        // the public find read on the project anchor.
        const found = await f.memory.memoryFind(g2, { v: 1, op: 'find', anchor: { kind: 'project' },
          limit: 20, cursor: null });
        expect(found.status).toBe('ready');
        if (found.status !== 'ready') return;
        expect(found.value.items.map(item => item.noteId)).toContain(understanding);

        // It is not on g1's goal anchor.
        const goalLookup = await f.memory.memoryLookup(g2, { v: 1, op: 'lookup',
          anchor: { kind: 'goal', goalId: g1 }, limit: 20, cursor: null });
        expect(goalLookup.status).toBe('ready');
        if (goalLookup.status !== 'ready') return;
        expect(goalLookup.value.items.some(candidate => candidate.noteId === understanding)).toBe(false);
      } finally { await f.close(); }
    });
});
