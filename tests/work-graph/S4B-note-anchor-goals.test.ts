/**
 * Slice 4B G2 round 2 — MF5 / R5: each task/stage anchor resolves against its
 * OWN goal's plans, and a stage is live only while its id is present in every
 * adopted revision from the anchor's own `planRevision` through the current one.
 * The second goal/project come from the real `createS4BMultiScope` helper;
 * assertions go through the real `platform.notes` reads.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';
import { createS4BMultiScope } from '../helpers/S4B-note-multi-scope-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'goals', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

describe('S4B MF5 per-anchor goal plans', () => {
  it.each(['memory', 'sqlite'] as const)('MF5 %s: another goal’s live task is not reported retired', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    const multi = await createS4BMultiScope(f);
    try {
      const written = await f.inner.write(f.ctx(), draft({ anchor: { kind: 'task', goalId: 's4a-goal', taskId: 't1' },
        extraAnchors: [{ kind: 'task', goalId: 's4b-goal-2', taskId: 't9' }] }), 's4a-goal');
      if (written.status === 'rejected') throw new Error(JSON.stringify(written));
      const read = await f.notes.readNote(f.ctx(), { noteId: written.noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.retiredExtraAnchors).toEqual([]);
      expect(read.value.anchorStatus).toBe('live');
    } finally { await multi.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF5 %s: another goal’s cancelled task is reported retired', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    const multi = await createS4BMultiScope(f);
    try {
      const written = await f.inner.write(f.ctx(), draft({ anchor: { kind: 'task', goalId: 's4a-goal', taskId: 't1' },
        extraAnchors: [{ kind: 'task', goalId: 's4b-goal-2', taskId: 't1' }] }), 's4a-goal');
      if (written.status === 'rejected') throw new Error(JSON.stringify(written));
      await multi.revisePlan(multi.goal2Ref, ({ stages, tasks }) => ({ stages,
        tasks: tasks.map(task => task.taskId === 't1' ? { ...task, disposition: 'cancelled' as const } : task) }), ['t1']);
      const read = await f.notes.readNote(f.ctx(), { noteId: written.noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('live');
      expect(read.value.retiredExtraAnchors).toEqual(['task:s4b-goal-2/t1']);
    } finally { await multi.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF5 %s: a stage removed in an intermediate revision stays retired after reuse', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    const multi = await createS4BMultiScope(f);
    try {
      const written = await f.inner.write(f.ctx(), draft({ anchor: { kind: 'stage', goalId: 's4a-goal', stageId: 's1' } }), 's4a-goal');
      if (written.status === 'rejected') throw new Error(JSON.stringify(written));
      // v2: stage s1 is gone; every work task moves to s2 (the gate keeps none).
      await multi.revisePlan(f.inner.goalRef, ({ tasks }) => ({ stages: [{ stageId: 's2', title: 'Stage two' }],
        tasks: tasks.map(task => task.taskKind === 'work' ? { ...task, stageId: 's2' } : task) }));
      const afterV2 = await f.notes.readNote(f.ctx(), { noteId: written.noteId });
      expect(afterV2.status).toBe('ready');
      if (afterV2.status !== 'ready') return;
      expect(afterV2.value.anchorStatus).toBe('retired');
      expect(afterV2.value.anchorRetiredReasons).toEqual(['stage_not_in_current_plan']);
      // v3: s1 is re-added under a new title; the old anchor must not revive.
      await multi.revisePlan(f.inner.goalRef, ({ stages, tasks }) => ({
        stages: [{ stageId: 's1', title: 'Another stage' }, ...stages], tasks }));
      const afterV3 = await f.notes.readNote(f.ctx(), { noteId: written.noteId });
      expect(afterV3.status).toBe('ready');
      if (afterV3.status !== 'ready') return;
      expect(afterV3.value.anchorStatus).toBe('retired');
      expect(afterV3.value.anchorRetiredReasons).toEqual(['stage_not_in_current_plan']);
    } finally { await multi.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF5 %s: a stage kept in every revision stays live', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    const multi = await createS4BMultiScope(f);
    try {
      const written = await f.inner.write(f.ctx(), draft({ anchor: { kind: 'stage', goalId: 's4a-goal', stageId: 's1' } }), 's4a-goal');
      if (written.status === 'rejected') throw new Error(JSON.stringify(written));
      await multi.revisePlan(f.inner.goalRef, ({ stages, tasks }) => ({ stages,
        tasks: tasks.map(task => task.taskKind === 'work' ? { ...task, title: `${task.title} (revised)` } : task) }));
      const read = await f.notes.readNote(f.ctx(), { noteId: written.noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('live');
      expect(read.value.anchorRetiredReasons).toEqual([]);
    } finally { await multi.close(); }
  });
});
