/**
 * Slice 4C-2 U8/PU-03 (spec §11.4/L20): the memory-material port.
 *
 * The read model instance the production composition root built is captured with
 * a factory spy (the same pattern the 4B fixture uses for the catalog), so
 * `createNoteMemoryMaterial` runs the real `readMemoryMaterial` over the real
 * record store. Notes are written through the public write service; every
 * assertion goes through the material port (or `memoryLookup` for M-12g).
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { describe, expect, it, vi } from 'vitest';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';
import * as readModelModule from '../../src/core/work-graph/notes/note-read-model.js';
import { createNoteMemoryMaterial } from '../../src/core/work-graph/notes/note-memory-material.js';

const GOAL = 's4a-goal';
const TASK_KEY = `task:${GOAL}/t1`;
const STAGE_KEY = `stage:${GOAL}/1/s1`;
const GOAL_KEY = `goal:${GOAL}`;
const FILE = 'src/a/x.ts';

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'mm', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

function norm(topic: string): NoteDraftV1 {
  return general({ kind: 'convention', topic, conclusion: topic, anchor: { kind: 'project' } });
}

function understanding(): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status: 's', decided: 'd', open: 'o', next: 'n', risks: 'r' };
  return { kind: 'understanding', topic: 'understanding', conclusion: 'the project now',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], sections } as NoteDraftV1;
}

/**
 * Capture the production read model instance and hand a material port built on
 * its one read to the test. The spy is restored before the body runs.
 */
async function withMaterial(
  kind: 'memory' | 'sqlite',
  body: (f: S4BNoteCheckFixture,
    material: ReturnType<typeof createNoteMemoryMaterial>) => Promise<void>,
  options: Parameters<typeof createS4BNoteCheckFixture>[1] = {},
): Promise<void> {
  const original = readModelModule.createNoteReadModel;
  const captured: { model: ReturnType<typeof readModelModule.createNoteReadModel> | null } = { model: null };
  const spy = vi.spyOn(readModelModule, 'createNoteReadModel').mockImplementation(deps => {
    const model = original(deps);
    captured.model = model;
    return model;
  });
  let f: S4BNoteCheckFixture;
  try {
    f = await createS4BNoteCheckFixture(kind, options);
  } finally {
    spy.mockRestore();
  }
  if (captured.model === null) throw new Error('the note read model was not composed');
  const material = createNoteMemoryMaterial({ readMemoryMaterial: captured.model.readMemoryMaterial });
  try {
    await body(f, material);
  } finally {
    await f.close();
  }
}

async function write(f: S4BNoteCheckFixture, draft: NoteDraftV1, goalId: string | null): Promise<string> {
  const result = await f.inner.write(f.ctx(), draft, goalId);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('S4C2 PU-03 memory material (spec §11.4/L20)', () => {
  it('PU-03a: 7 eligible norms list 5 with normsOmitted 2, and the required section keeps them with an empty general', async () => {
    await withMaterial('memory', async (f, material) => {
      const noteIds: string[] = [];
      for (let index = 1; index <= 7; index += 1) noteIds.push(await write(f, norm(`n${String(index)}`), null));
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, stageId: 's1', taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.norms).toHaveLength(5);
      expect(read.value.normsOmitted).toBe(2);
      // Newest first: the last five written, reversed.
      expect(read.value.norms.map(row => row.noteId)).toEqual([...noteIds].reverse().slice(0, 5));
      expect(read.value.general).toEqual([]);
    });
  });

  it('PU-03b: general follows L20 source order (own task, stage, goal) and deduplicates a multi-anchor note', async () => {
    await withMaterial('memory', async (f, material) => {
      const taskNote = await write(f, general({ topic: 'on-task', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }), GOAL);
      const stageNote = await write(f, general({ topic: 'on-stage',
        anchor: { kind: 'stage', goalId: GOAL, stageId: 's1' } }), GOAL);
      const goalNote = await write(f, general({ topic: 'on-goal', anchor: { kind: 'goal', goalId: GOAL } }), GOAL);
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, stageId: 's1', taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.general.map(row => row.anchorKey)).toEqual([TASK_KEY, STAGE_KEY, GOAL_KEY]);
      expect(read.value.general.map(row => row.noteId)).toEqual([taskNote, stageNote, goalNote]);
      expect(read.value.general.every(row => row.freshness === 'fresh')).toBe(true);
    });
  });

  it('PU-03b-2: a note on two of the task sources appears once in general', async () => {
    await withMaterial('memory', async (f, material) => {
      const both = await write(f, general({ topic: 'both', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' },
        extraAnchors: [{ kind: 'stage', goalId: GOAL, stageId: 's1' }] }), GOAL);
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, stageId: 's1', taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.general.filter(row => row.noteId === both)).toHaveLength(1);
    });
  });

  it('PU-03c: the Goal-card items (project understanding and norms) never repeat in general', async () => {
    await withMaterial('memory', async (f, material) => {
      const normId = await write(f, norm('n1'), null);
      const understandingId = await write(f, understanding(), null);
      const taskNote = await write(f, general({ topic: 'on-task', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }), GOAL);
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, stageId: 's1', taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.norms.map(row => row.noteId)).toEqual([normId]);
      expect(read.value.projectUnderstanding?.status.pointer.noteId).toBe(understandingId);
      expect(read.value.projectUnderstanding?.body).toContain('现状');
      expect(read.value.general.map(row => row.noteId)).toEqual([taskNote]);
      expect(read.value.general.some(row => row.noteId === normId || row.noteId === understandingId)).toBe(false);
    });
  });

  it('PU-03d: a stale accepted row carries the FULL warning line as label, never the header', async () => {
    await withMaterial('memory', async (f, material) => {
      const staleNote = await write(f, general({ topic: 'stale', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' },
        basisFiles: [FILE] }), GOAL);
      await writeFile(join(f.root, FILE), 'export const a = 2;\n');
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, stageId: 's1', taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      const row = read.value.general.find(candidate => candidate.noteId === staleNote);
      expect(row).toBeDefined();
      expect(row!.freshness).toBe('stale');
      expect(row!.label).toBe(`需复查：${staleNote} a conclusion，不能当现行结论`);
      // Hand-computed header of a pitfall note on task t1: `坑(任务 t1)：a conclusion`.
      expect(row!.label).not.toBe('坑(任务 t1)：a conclusion');
    });
  });

  it('PU-03e (M-12g): a null goal is unsupported 6A and never builds material', async () => {
    await withMaterial('memory', async (f, material) => {
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: null });
      expect(read).toEqual({ status: 'rejected', code: 'unsupported', reason: '6A' });
    });
  });

  it('PU-03f (M-12a/g wiring): memoryLookup returns the understanding from the same check; goal false, project null', async () => {
    await withMaterial('memory', async f => {
      const goalUnderstanding = await write(f, { ...understanding(), anchor: { kind: 'goal', goalId: GOAL } } as NoteDraftV1, GOAL);
      const goalRead = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup',
        anchor: { kind: 'goal', goalId: GOAL }, limit: 20, cursor: null });
      expect(goalRead.status).toBe('ready');
      if (goalRead.status !== 'ready') return;
      expect(goalRead.value.understanding).toMatchObject({ anchorKey: GOAL_KEY,
        pointer: { noteId: goalUnderstanding, revision: 1 }, updateDue: false, latestTriggerCursor: null });
      const goalItem = goalRead.value.items.find(item => item.noteId === goalUnderstanding);
      expect(goalItem?.updateDue).toBe(false);

      const projectUnderstanding = await write(f, understanding(), null);
      const projectRead = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup',
        anchor: { kind: 'project' }, limit: 20, cursor: null });
      expect(projectRead.status).toBe('ready');
      if (projectRead.status !== 'ready') return;
      expect(projectRead.value.understanding).toMatchObject({ anchorKey: 'project', updateDue: null,
        latestTriggerCursor: null, pointer: { noteId: projectUnderstanding } });
    });
  });

  it('PU-03g: localUnderstanding is the goal row then the stage row, and reminders name both anchors', async () => {
    await withMaterial('memory', async (f, material) => {
      const goalUnderstanding = await write(f, { ...understanding(), conclusion: 'goal now',
        anchor: { kind: 'goal', goalId: GOAL } } as NoteDraftV1, GOAL);
      const stageUnderstanding = await write(f, { ...understanding(), conclusion: 'stage now',
        anchor: { kind: 'stage', goalId: GOAL, stageId: 's1' } } as NoteDraftV1, GOAL);
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, stageId: 's1', taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.localUnderstanding.map(row => row.scope)).toEqual(['goal', 'stage']);
      expect(read.value.localUnderstanding.map(row => row.conclusion)).toEqual(['goal now', 'stage now']);
      expect(read.value.localUnderstanding.every(row => row.body === null)).toBe(true);
      expect(read.value.localUnderstanding[0]!.status.pointer.noteId).toBe(goalUnderstanding);
      expect(read.value.localUnderstanding[1]!.status.pointer.noteId).toBe(stageUnderstanding);
      expect(read.value.reminders).toEqual([
        { anchorKey: GOAL_KEY, updateDue: false, latestTriggerCursor: null },
        { anchorKey: STAGE_KEY, updateDue: false, latestTriggerCursor: null },
      ]);
    });
  });
});

const KINDS: readonly ('memory' | 'sqlite')[] = ['memory', 'sqlite'];

/**
 * Rework item 1: adopt a second plan revision in which t2 is cancelled. The
 * real plan readers turn that cancellation into a `task_end:t2@p2` T3-style
 * trigger, so the goal anchor (no understanding, baseline null) is update-due.
 */
async function adoptCancellingPlan(f: S4BNoteCheckFixture): Promise<void> {
  const base = f.inner.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${base.planId}-2`, planRevision: base.planRevision + 1, goalId: GOAL,
    stages: base.stages,
    tasks: base.tasks.map(task => task.taskId === 't2' ? { ...task, disposition: 'cancelled' as const } : task),
    ...(base.assignments === undefined ? {} : { assignments: base.assignments }),
    obligations: base.obligations,
    taskHierarchy: base.taskHierarchy,
    executionDag: base.executionDag,
  };
  const proposed = await f.inner.platform.plans.proposePlan(f.ctx(), {
    meta: { requestId: 's4c2-p2-propose', expected: [] },
    input: { goalRef: f.inner.goalRef, basedOn: base.ref, draft, reason: { text: 'cancel t2', sources: [] } },
  });
  if (proposed.status !== 'committed') throw new Error(`propose failed: ${JSON.stringify(proposed)}`);
  const applied = await f.inner.platform.plans.applyPlanChange(f.ctx(), {
    meta: { requestId: 's4c2-p2-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
  });
  if (applied.status !== 'committed') throw new Error(`apply failed: ${JSON.stringify(applied)}`);
}

describe('S4C2 memory material rework (items 1-4)', () => {
  it.each(KINDS)('item 1 %s: without an explicit stageId the plan task stage drives the stage row', async kind => {
    await withMaterial(kind, async (f, material) => {
      const stageUnderstanding = await write(f, { ...understanding(), conclusion: 'stage now',
        anchor: { kind: 'stage', goalId: GOAL, stageId: 's1' } } as NoteDraftV1, GOAL);
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      const stageRow = read.value.localUnderstanding.find(row => row.scope === 'stage');
      expect(stageRow?.status.anchorKey).toBe(STAGE_KEY);
      expect(stageRow?.status.pointer.noteId).toBe(stageUnderstanding);
      expect(stageRow?.conclusion).toBe('stage now');
      // The goal row is always present, even without an understanding.
      const goalRow = read.value.localUnderstanding.find(row => row.scope === 'goal');
      expect(goalRow).toMatchObject({ version: null, currentEligible: false, conclusion: null, body: null });
      expect(read.value.localUnderstanding.map(row => row.scope)).toEqual(['goal', 'stage']);
    });
  });

  it.each(KINDS)('item 1 %s: the goal row with no understanding is update-due after a task_end trigger', async kind => {
    await withMaterial(kind, async (f, material) => {
      await adoptCancellingPlan(f);
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      const goalRow = read.value.localUnderstanding.find(row => row.scope === 'goal');
      expect(goalRow).toBeDefined();
      expect(goalRow!.version).toBeNull();
      expect(goalRow!.currentEligible).toBe(false);
      expect(goalRow!.conclusion).toBeNull();
      expect(goalRow!.body).toBeNull();
      expect(goalRow!.status.updateDue).toBe(true);
      // The reminder the assembler derives from the row is present too.
      expect(read.value.reminders.find(row => row.anchorKey === GOAL_KEY)?.updateDue).toBe(true);
    });
  });

  it.each(KINDS)('item 2 %s: with anchorQuota 1 the second own-goal pending note is neither conclusion nor warning', async kind => {
    await withMaterial(kind, async (f, material) => {
      // Write through a real work Run: a user write bypasses the anchor quota,
      // an agent's second note on t1 lands `pending_review` (`quota_full`).
      const run = await f.inner.claimRun('quota', 't1', 'executor');
      const agent = f.inner.workCtx(run);
      const writeAgent = async (topic: string): Promise<string> => {
        const result = await f.inner.write(agent, general({ topic,
          anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }), GOAL);
        if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
        return result.noteId;
      };
      const accepted = await writeAgent('one');
      const pending = await writeAgent('two');
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.general.map(row => row.noteId)).toEqual([accepted]);
      expect(read.value.general.some(row => row.noteId === pending)).toBe(false);
    }, { anchorQuota: 1 });
  });

  it.each(KINDS)('item 2 %s: with readFilesMax 1 an unchecked note is neither conclusion nor warning', async kind => {
    await withMaterial(kind, async (f, material) => {
      // Two distinct basis files and a one-file budget: the second file is
      // exhausted, so the note itself is `unchecked` (`currentEligible` false).
      const unchecked = await write(f, general({ topic: 'unchecked',
        anchor: { kind: 'task', goalId: GOAL, taskId: 't1' },
        basisFiles: ['src/a/x.ts', 'src/b/y.ts'] }), GOAL);
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.general.some(row => row.noteId === unchecked)).toBe(false);
      expect(read.value.general).toEqual([]);
    }, { check: { readFilesMax: 1 } });
  });

  it.each(KINDS)('item 3 %s: a foreign-anchor note takes this assembly source anchor and sorts after the local note', async kind => {
    await withMaterial(kind, async (f, material) => {
      const x = await write(f, general({ topic: 'a', anchor: { kind: 'goal', goalId: GOAL },
        extraAnchors: [{ kind: 'task', goalId: GOAL, taskId: 't2' }] }), GOAL);
      const y = await write(f, general({ topic: 'b', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }), GOAL);
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.general.map(row => row.noteId)).toEqual([y, x]);
      expect(read.value.general.find(row => row.noteId === x)?.anchorKey).toBe(GOAL_KEY);
    });
  });

  it.each(KINDS)('item 4 %s: the project, goal and stage rows expose the real note version', async kind => {
    await withMaterial(kind, async (f, material) => {
      await write(f, understanding(), null);
      await write(f, { ...understanding(), anchor: { kind: 'goal', goalId: GOAL } } as NoteDraftV1, GOAL);
      await write(f, { ...understanding(), anchor: { kind: 'stage', goalId: GOAL, stageId: 's1' } } as NoteDraftV1, GOAL);
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.projectUnderstanding?.version).toBe(1);
      expect(read.value.localUnderstanding.find(row => row.scope === 'goal')?.version).toBe(1);
      expect(read.value.localUnderstanding.find(row => row.scope === 'stage')?.version).toBe(1);
    });
  });

  it.each(KINDS)('item 7 %s (ruling 9): includeInputs false skips the general part but keeps the understanding rows', async kind => {
    await withMaterial(kind, async (f, material) => {
      const goalUnderstanding = await write(f, { ...understanding(),
        anchor: { kind: 'goal', goalId: GOAL } } as NoteDraftV1, GOAL);
      await write(f, general({ topic: 'on-task', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }), GOAL);
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, taskId: 't1', includeInputs: false });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.general).toEqual([]);
      expect(read.value.localUnderstanding.find(row => row.scope === 'goal')?.status.pointer.noteId)
        .toBe(goalUnderstanding);
      expect(read.value.localUnderstanding.find(row => row.scope === 'stage')).toBeDefined();
    });
  });

  it.each(KINDS)('item 1 %s: a general note on stage s2 never enters an assembly for a task in s1', async kind => {
    await withMaterial(kind, async (f, material) => {
      // The fixture plan has only s1; adopt p2 with a second stage through the
      // real API so the s2 note resolves to a real current-stage anchor.
      await adoptTwoStagePlan(f);
      const s2Note = await write(f, general({ topic: 'on-s2',
        anchor: { kind: 'stage', goalId: GOAL, stageId: 's2' } }), GOAL);
      const s1Note = await write(f, general({ topic: 'on-s1',
        anchor: { kind: 'stage', goalId: GOAL, stageId: 's1' } }), GOAL);
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      const noteIds = read.value.general.map(row => row.noteId);
      expect(noteIds).toContain(s1Note);
      expect(noteIds).not.toContain(s2Note);
    });
  });

  it.each(KINDS)('item 1 %s: a confirmed interface note sorts before an accepted module note', async kind => {
    await withMaterial(kind, async (f, material) => {
      const plan2 = await adoptModuleScopedTaskPlan(f);
      // Host write -> confirmedByUser; both anchors are class 3.
      const interfaceNote = await write(f, general({ topic: 'iface',
        anchor: { kind: 'interface', moduleId: 'A', interfaceId: 'I1' } }), GOAL);
      // Executor Run write -> accepted, not user-confirmed. The fixture's own
      // `claimRun` pins plan p1, so claim t1 on the adopted p2 directly.
      const run = await claimOnPlan(f, plan2, 't1', 'module-note');
      const written = await f.inner.write(f.inner.workCtx(run), general({ topic: 'module',
        anchor: { kind: 'module', moduleId: 'A' } }), GOAL);
      if (written.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(written)}`);
      const moduleNote = written.noteId;
      const read = await material.readMemoryMaterial(f.ctx(), { goalId: GOAL, taskId: 't1' });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.general.map(row => row.noteId)).toEqual([interfaceNote, moduleNote]);
    });
  });
});

const PROJECT = 's4a-project';

/** Claim a task on the ADOPTED plan through the public platform (the fixture's
 * `claimRun` pins plan p1, which is stale once a second revision is adopted). */
async function claimOnPlan(f: S4BNoteCheckFixture, plan: PlanRevisionSnapshot, taskId: string,
  suffix: string): Promise<RunRef> {
  const { sessionRef } = await f.inner.createSession(suffix, 'executor');
  const goalRead = await f.inner.platform.plans.queryGoal(f.ctx(), f.inner.goalRef);
  if (goalRead.status !== 'ready') throw new Error(`goal read failed: ${JSON.stringify(goalRead)}`);
  const card = await f.inner.platform.sessions.readSession(f.ctx(), sessionRef);
  if (card.status !== 'ready') throw new Error(`session read failed: ${JSON.stringify(card)}`);
  const claimed = await f.inner.platform.claims.claimTask(f.ctx(), {
    input: { goalRef: f.inner.goalRef, planRef: plan.ref, taskId, sessionRef,
      roleBinding: f.inner.roleBinding, budget: f.inner.budget },
    meta: { requestId: `s4c2-claim-${suffix}`, expected: [
      { ref: f.inner.goalRef, revision: goalRead.value.goal.revision },
      { ref: f.inner.workspaceRef, revision: 1 },
      { ref: { aggregateType: 'Session', projectId: PROJECT, sessionId: sessionRef.sessionId },
        revision: card.value.record.revision },
    ] },
  });
  if (claimed.status !== 'committed') throw new Error(`claim failed: ${JSON.stringify(claimed)}`);
  return claimed.value.runRef;
}

/** Adopt plan p2 with a second stage s2 (t1 stays in s1). */
async function adoptTwoStagePlan(f: S4BNoteCheckFixture): Promise<void> {
  const base = f.inner.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${base.planId}-2`, planRevision: base.planRevision + 1, goalId: GOAL,
    stages: [...base.stages, { stageId: 's2', title: 'Stage two' }],
    tasks: base.tasks,
    ...(base.assignments === undefined ? {} : { assignments: base.assignments }),
    obligations: base.obligations,
    taskHierarchy: base.taskHierarchy,
    executionDag: base.executionDag,
  };
  await applySecondPlan(f, draft, 'twostage');
}

/** Adopt plan p2 with t1 scoped to module A (so its related keys are class 3). */
async function adoptModuleScopedTaskPlan(f: S4BNoteCheckFixture): Promise<PlanRevisionSnapshot> {
  const base = f.inner.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${base.planId}-2`, planRevision: base.planRevision + 1, goalId: GOAL,
    stages: base.stages,
    tasks: base.tasks.map(task => task.taskId === 't1'
      ? { ...task, scope: { kind: 'module' as const, stageId: 's1', moduleRef: 'A' } } : task),
    ...(base.assignments === undefined ? {} : { assignments: base.assignments }),
    obligations: base.obligations,
    taskHierarchy: base.taskHierarchy,
    executionDag: base.executionDag,
  };
  return applySecondPlan(f, draft, 'module-task');
}

async function applySecondPlan(f: S4BNoteCheckFixture, draft: PlanRevisionDraft,
  suffix: string): Promise<PlanRevisionSnapshot> {
  const base = f.inner.plan;
  const proposed = await f.inner.platform.plans.proposePlan(f.ctx(), {
    meta: { requestId: `s4c2-p2-${suffix}-propose`, expected: [] },
    input: { goalRef: f.inner.goalRef, basedOn: base.ref, draft, reason: { text: suffix, sources: [] } },
  });
  if (proposed.status !== 'committed') throw new Error(`propose failed: ${JSON.stringify(proposed)}`);
  const applied = await f.inner.platform.plans.applyPlanChange(f.ctx(), {
    meta: { requestId: `s4c2-p2-${suffix}-apply`, expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
  });
  if (applied.status !== 'committed') throw new Error(`apply failed: ${JSON.stringify(applied)}`);
  return applied.value;
}
