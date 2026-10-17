/**
 * Slice 4C-2 rework 4 item 1 (§11.6/L23, ruling A): the scribe to-dos take the
 * relation targets' live facts from the note service's ONE `userReasonFacts` —
 * the same function the note card source and the disposition guard use.
 *
 * T1: a file-anchored target whose SYMBOL disappeared is retired for a FILE
 * reason. That keeps a live `contradiction`, so the pending agent note is not a
 * scribe to-do (today the to-dos treat `symbol_missing` as non-file and count
 * it), and the scribe's accept is `forbidden`.
 *
 * T2: a STAGE target dropped from the current plan is retired for a NON-file
 * reason (`stage_not_in_current_plan`), so the contradiction stops being live
 * and the pending agent note IS a scribe to-do. Seeded plan windows keep the
 * stage path on the reader's one window.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';
import {
  claimWithPlan, createAuxSession, createS4C2NoteCardFixture, currentPlanOf, generalNote,
  reviseNoteStages, S4C2_GOAL_ANCHOR, type S4C2NoteCardFixture,
} from '../helpers/S4C2-note-card-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const GOAL = 's4a-goal';

const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

function fileAnchor(path: string, symbolRequest?: { language: string; name: string }): NoteDraftAnchorV1 {
  return symbolRequest === undefined ? { kind: 'file', path } : { kind: 'file', path, symbolRequest };
}

function general(anchor: NoteDraftAnchorV1, topic: string, contradicts: string[] = []): NoteDraftV1 {
  return { kind: 'pitfall', topic, conclusion: topic, body: 'body', anchor, extraAnchors: [],
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts, coexistWith: [] } as NoteDraftV1;
}

async function pendingIdentities(f: S4ANoteFixture | S4C2NoteCardFixture, goalId: string): Promise<string[]> {
  const read = await f.platform.notes.readScribeTodos(f.ctx(), { goalIds: [goalId] });
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') return [];
  return read.value.find(row => row.goalId === goalId)?.pending.map(todo => todo.identity) ?? [];
}

describe('S4C2 scribe to-dos use the ONE user-reason facts', () => {
  it.each(KINDS)('T1 %s: a missing symbol is a FILE reason, so the contradiction stays live and no to-do is counted', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      // The user's accepted note is anchored to `a` at src/a/x.ts. The fixture
      // writes `export const a = 1;`, so `a` resolves to a stored symbol locator.
      const userWritten = await f.write(f.ctx(),
        general(fileAnchor('src/a/x.ts', { language: 'typescript', name: 'a' }), 'user topic'), GOAL);
      expect(userWritten).toMatchObject({ status: 'accepted', confirmedByUser: true });
      const userNoteId = idOf(userWritten);

      // A real executor Run writes a pending note on the same file path (the
      // file anchor key carries the path only), a different topic, and names the
      // user's note as contradicted: `pending_review` with `contradiction`.
      const run = await f.claimRun('user-reason-t1', 't1', 'executor');
      const agent = await f.write(f.workCtx(run),
        general(fileAnchor('src/a/x.ts'), 'agent topic', [userNoteId]), GOAL);
      expect(agent).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
      const agentNoteId = idOf(agent);

      // Rewrite the file so the stored `a` locator's symbol is gone.
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const renamed = 1;\n');
      const target = await f.platform.notes.readNote(f.ctx(), { noteId: userNoteId });
      expect(target.status).toBe('ready');
      if (target.status !== 'ready') return;
      expect(target.value.anchorStatus).toBe('retired');
      expect(target.value.anchorRetiredReasons).toContain('symbol_missing');

      // Hand-computed: U is accepted, user-written, and retired for a FILE
      // reason, so its live user reason (`contradiction`) survives and P is NOT
      // a scribe to-do. Today: 1 pending (`P@1`).
      expect(await pendingIdentities(f, GOAL)).toEqual([]);

      // Agreement check: the guard already uses the same function, so the
      // scribe may not accept the pending note; only the user may decide it.
      const scribeRun = await f.claimRun('user-reason-t1-scribe', 't3', 'scribe');
      const reviewed = await f.platform.notes.reviewNote(f.workCtx(scribeRun), {
        commandId: 's4c2-t1-scribe-accept', noteId: agentNoteId, expectedVersion: 1,
        expectedPointerRevision: null, verdict: 'accept', reason: 'scribe tries to accept',
      });
      expect(reviewed).toMatchObject({ status: 'rejected', code: 'forbidden' });
      expect((reviewed as { reason: string }).reason).toContain('user reason');
    } finally {
      await f.close();
    }
  });

  it.each(KINDS)('T2 %s: a dropped stage is a NON-file reason, so the contradiction dies and the to-do stays', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    try {
      const stage: NoteDraftAnchorV1 = { kind: 'stage', goalId: f.goalRef.goalId, stageId: 's-note' };
      const base = await currentPlanOf(f);
      // p2 adds the note stage and one claimable executor task (kept in s1, so
      // dropping the stage later moves no claimed task), exactly D-13's setup.
      const withStage = await reviseNoteStages(f, base, [...base.stages, { stageId: 's-note', title: 'Note stage' }], {
        tasks: [{ taskId: 's4c2-t2-task', stageId: 's1', title: 'Note task', requirementLevel: 'required',
          taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
        assignments: [{ taskId: 's4c2-t2-task', role: 'platform-executor', instruction: 'Execute s4c2-t2-task' }],
        obligationId: 'o1',
      });
      expect(withStage.planRevision).toBe(2);
      const session = await createAuxSession(f, `t2-${kind}`, 'executor');
      const run = await claimWithPlan(f, `t2-${kind}`, session, 's4c2-t2-task', 'executor', withStage.ref);

      // The user's note on the note stage, then the agent's pending note on the
      // SAME stage (with the Goal as an extra anchor) that only contradicts it.
      const stageUserNote = await f.writeUser(generalNote({ topic: 'stage user', anchor: stage }), f.goalRef.goalId);
      expect(stageUserNote).toMatchObject({ status: 'accepted' });
      const stageUserNoteId = idOf(stageUserNote);
      const agent = await f.platform.notes.writeNote(f.workCtx(run), {
        commandId: `s4c2-t2-write-${kind}`,
        note: generalNote({ kind: 'decision', topic: 'agent stage', anchor: stage, extraAnchors: [S4C2_GOAL_ANCHOR],
          conclusion: 'agent stage note', contradicts: [stageUserNoteId] }),
        expectedPointerRevision: null, goalId: f.goalRef.goalId,
      });
      expect(agent).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
      const agentId = idOf(agent);
      // The second deterministic write of the fixture.
      expect(agentId).toBe('s4c2-note-2');

      // p3 drops s-note through the public Plan revision.
      const dropped = await reviseNoteStages(f, withStage, [...base.stages]);
      expect(dropped.planRevision).toBe(3);
      const contradicted = await f.platform.notes.readNote(f.ctx(), { noteId: stageUserNoteId });
      expect(contradicted.status).toBe('ready');
      if (contradicted.status === 'ready') {
        expect(contradicted.value.anchorRetiredReasons).toEqual(['stage_not_in_current_plan']);
      }

      // Hand-computed: `stage_not_in_current_plan` is a NON-file reason, so the
      // contradicted target no longer yields `contradiction`; the pending note
      // is the scribe's single to-do in g.
      expect(await pendingIdentities(f, f.goalRef.goalId)).toEqual([`${agentId}@1`]);
    } finally {
      await f.close();
    }
  });
});
