/**
 * S4C2 rework 4 item 3 (§11.7/§11.4): the project anchor set is read ONCE per
 * call and shared by `selectProjectHeader` and the page's check.
 *
 * The verifier's seed: one project convention written by the project scribe and
 * then reviewed (so it is an eligible norm; `state: reviewed`, version 2) plus a
 * project understanding written by the project scribe (the pointer's head,
 * version 1, pointer revision 1). Both live in anchor slot 0, so one project
 * anchor set is
 *   Σ_{s=0..4} max(1, ceil(n_s/200)) = ceil(2/200) + 1 + 1 + 1 + 1 = 1 + 4 = 5
 * lookup calls (slot 0 has 2 heads; slots 1-4 are empty and cost 1 each).
 * Before the fix `selectProjectHeader` reads that set again after the caller has
 * already read it, so the same paths pay 5 + 5 = 10 project-key lookups.
 *
 * Counting wrapper: `records.lookup` calls whose `request.index` starts with
 * 's4-note-by-anchor-' and whose `request.values` deep-equal
 * [PROJECT, 'project'] are project-key lookups; every other lookup is counted
 * separately. Requests only — the wrapper never reads record contents. Counts
 * are taken only while a call (or exactly `readMemoryMaterial`) is on the stack.
 */
import { expect, it, vi } from 'vitest';
import type { NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';
import * as readModelModule from '../../src/core/work-graph/notes/note-read-model.js';

const PROJECT = 's4a-project';
const GOAL = 's4a-goal';
const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];

// The literal header the seed must render: `renderNoteHeader` of a reviewed
// convention on the project anchor.
const NORM_CONCLUSION = 'alpha norm';
const NORM_HEADER = `约定(项目)：${NORM_CONCLUSION}`;
const UNDERSTANDING_CONCLUSION = 'the project now';

function projectNorm(): NoteDraftV1 {
  return { kind: 'convention', topic: 'alpha norm', conclusion: NORM_CONCLUSION, body: 'the norm body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [] } as NoteDraftV1;
}

function projectUnderstanding(): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' };
  return { kind: 'understanding', topic: 'project-understanding', conclusion: UNDERSTANDING_CONCLUSION,
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], sections } as NoteDraftV1;
}

type CountState = { active: boolean; project: number; other: number };

type CountedFixture = {
  f: S4ANoteFixture;
  state: CountState;
  model: ReturnType<typeof readModelModule.createNoteReadModel>;
};

/**
 * The fixture-level backend wrapper of S4C-find-read-bounds.test.ts:39-67, plus
 * the `createNoteReadModel` factory spy of S4C2-read-counts.test.ts:77-91 so a
 * Goal-card test can bracket exactly `readMemoryMaterial`.
 */
async function createCounted(kind: S4ANoteFixtureKind): Promise<CountedFixture> {
  const state: CountState = { active: false, project: 0, other: 0 };
  const memoryBackend = await import('../../src/core/record-store/in-memory-record-store.js');
  const sqliteBackend = await import('../../src/core/record-store/sqlite-record-store.js');
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const wrap = <T,>(backend: T): T => {
    const records = (backend as unknown as { records: Record<string, unknown> }).records;
    return { ...(backend as object),
      records: { ...records,
        lookup: (...args: unknown[]) => {
          if (state.active) {
            const request = args[0] as { index?: unknown; values?: unknown };
            const values = Array.isArray(request.values) ? request.values : [];
            const projectKey = typeof request.index === 'string'
              && request.index.startsWith('s4-note-by-anchor-')
              && values.length === 2 && values[0] === PROJECT && values[1] === 'project';
            if (projectKey) state.project += 1;
            else state.other += 1;
          }
          return (records['lookup'] as (...a: unknown[]) => unknown)(...args);
        } } } as unknown as T;
  };
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(optionsIn => wrap(originalMemory(optionsIn)) as never);
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(optionsIn => wrap(originalSqlite(optionsIn)) as never);
  const originalReadModel = readModelModule.createNoteReadModel;
  let model: CountedFixture['model'] | null = null;
  const modelSpy = vi.spyOn(readModelModule, 'createNoteReadModel').mockImplementation(deps => {
    const built = originalReadModel(deps);
    model = built;
    return built;
  });
  let f: S4ANoteFixture;
  try {
    f = await createS4ANoteFixture(kind);
  } finally {
    memorySpy.mockRestore();
    sqliteSpy.mockRestore();
    modelSpy.mockRestore();
  }
  if (model === null) throw new Error('the note read model was not composed');
  return { f, state, model };
}

/** Reset and run one public read with the counter on the stack. */
async function counted<T>(state: CountState, body: () => Promise<T>): Promise<T> {
  state.project = 0;
  state.other = 0;
  state.active = true;
  try {
    return await body();
  } finally {
    state.active = false;
  }
}

type Seeded = { normId: string; understandingId: string };

/**
 * The verifier's seed through public writes: the project scribe (t3, a scribe
 * with no module link) writes one convention, the same scribe reviews it (state
 * `reviewed`, version 2, so it is an eligible norm and the check runs
 * `conflictingOf` on a project-anchored item), then the project scribe writes
 * the project understanding (the pointer's head).
 */
async function seedProject(f: S4ANoteFixture): Promise<Seeded> {
  const scribe = await f.claimRun('project-set-scribe', 't3', 'scribe');
  const ctx = f.workCtx(scribe);
  const written = await f.write(ctx, projectNorm(), null);
  if (written.status === 'rejected') throw new Error(`norm write rejected: ${JSON.stringify(written)}`);
  expect(written.status).toBe('accepted');
  const reviewed = await f.platform.notes.reviewNote(ctx, { commandId: 'project-set-review',
    noteId: written.noteId, expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
  expect(reviewed.status).toBe('done');
  const understanding = await f.write(ctx, projectUnderstanding(), null, { expectedPointerRevision: null });
  if (understanding.status === 'rejected') {
    throw new Error(`project understanding rejected: ${JSON.stringify(understanding)}`);
  }
  return { normId: written.noteId, understandingId: understanding.noteId };
}

/** The literal §11.4 first-page project header, from the seed, never read back. */
function literalHeader(seeded: Seeded): {
  understanding: { noteId: string; version: number; pointerRevision: number; conclusion: string;
    currentEligible: boolean };
  norms: { noteId: string; version: number; header: string }[];
  omitted: number;
} {
  return {
    understanding: { noteId: seeded.understandingId, version: 1, pointerRevision: 1,
      conclusion: UNDERSTANDING_CONCLUSION, currentEligible: true },
    norms: [{ noteId: seeded.normId, version: 2, header: NORM_HEADER }],
    omitted: 0,
  };
}

it.each(KINDS)('item 3 %s: the Goal-card work material reads the project set once (5, not 10)', async kind => {
  const { f, state, model } = await createCounted(kind);
  try {
    const seeded = await seedProject(f);
    const real = model.readMemoryMaterial;
    model.readMemoryMaterial = async (ctx, input) => {
      state.active = true;
      try {
        return await real.call(model, ctx, input);
      } finally {
        state.active = false;
      }
    };
    state.project = 0;
    state.other = 0;
    const assembly = await f.platform.graphContext.readContextFacts(f.ctx(), {
      goalRef: f.goalRef, planRef: f.planRef, focusTaskIds: ['t1'], includeInputs: true,
    });
    expect(assembly.status).toBe('ready');
    if (assembly.status !== 'ready') return;
    // Hand arithmetic: one project anchor set = ceil(2/200) + 4 (empty slots) = 5.
    // Today `selectProjectHeader` reads it a second time -> 10; after the fix the
    // header stores it and the check's `conflictingOf` reuses it -> 5.
    expect(state.project).toBe(5);
    const notes = assembly.value.extensions.notes;
    const projectRow = notes.understanding.rows.find(row => row.scope === 'project');
    expect(projectRow).toBeDefined();
    expect(projectRow!.version).toBe(1);
    expect(projectRow!.status.pointer).toMatchObject({ noteId: seeded.understandingId, revision: 1 });
    expect(notes.understanding.norms).toHaveLength(1);
    expect(notes.understanding.norms[0]).toMatchObject({ noteId: seeded.normId, version: 2,
      label: NORM_HEADER });
  } finally {
    await f.close();
  }
});

it.each(KINDS)('item 3 %s: the Goal-card query material reads the project set once (5, not 10)', async kind => {
  const { f, state, model } = await createCounted(kind);
  try {
    const seeded = await seedProject(f);
    const real = model.readMemoryMaterial;
    model.readMemoryMaterial = async (ctx, input) => {
      state.active = true;
      try {
        return await real.call(model, ctx, input);
      } finally {
        state.active = false;
      }
    };
    state.project = 0;
    state.other = 0;
    const assembly = await f.platform.graphContext.readContextFacts(f.ctx(), {
      goalRef: f.goalRef, planRef: f.planRef, focusTaskIds: ['t1'], includeInputs: false,
    });
    expect(assembly.status).toBe('ready');
    if (assembly.status !== 'ready') return;
    // Same hand arithmetic as the work case: one shared set = 5, today 10.
    expect(state.project).toBe(5);
    const notes = assembly.value.extensions.notes;
    const projectRow = notes.understanding.rows.find(row => row.scope === 'project');
    expect(projectRow!.version).toBe(1);
    expect(projectRow!.status.pointer).toMatchObject({ noteId: seeded.understandingId, revision: 1 });
    expect(notes.understanding.norms).toHaveLength(1);
    expect(notes.understanding.norms[0]).toMatchObject({ noteId: seeded.normId, version: 2,
      label: NORM_HEADER });
  } finally {
    await f.close();
  }
});

it.each(KINDS)('item 3 %s: the unsegmented host find first page reads the project set once and renders the header', async kind => {
  const { f, state } = await createCounted(kind);
  try {
    const seeded = await seedProject(f);
    const read = await counted(state, () => f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
      terms: ['alpha'], limit: 20, cursor: null }));
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    // One project anchor set = ceil(2/200) + 4 = 5; today the header reads it a
    // second time, slot 0 having the two seeded heads -> 10.
    expect(state.project).toBe(5);
    expect(read.value.project).toEqual(literalHeader(seeded));
  } finally {
    await f.close();
  }
});

it.each(KINDS)('item 3 %s: segmented find page 1 reads the project set once and page 2 reads only the related set', async kind => {
  const { f, state } = await createCounted(kind);
  try {
    const seeded = await seedProject(f);
    const request = { v: 1 as const, op: 'find' as const,
      related: { kind: 'task' as const, goalId: GOAL, taskId: 't1' }, limit: 1, cursor: null };
    const page1 = await counted(state, () => f.platform.notes.memoryFind(f.ctx(), request));
    expect(page1.status).toBe('ready');
    if (page1.status !== 'ready') return;
    // Page 1: the related read already reads the project key (5, slot 0's two
    // heads + 4 empty slots); the header shares it. Today the header reads the
    // set again -> 10.
    expect(state.project).toBe(5);
    expect(page1.value.project).toEqual(literalHeader(seeded));
    expect(page1.value.next).not.toBe(null);

    const page2 = await counted(state, () => f.platform.notes.memoryFind(f.ctx(), { ...request,
      cursor: page1.value.next }));
    expect(page2.status).toBe('ready');
    if (page2.status !== 'ready') return;
    // Page 2: no first-page header; the related read on this page still reads
    // the project key once (5). PU-04 shape: no `project` on later pages.
    expect(state.project).toBe(5);
    expect(page2.value.project).toBeUndefined();
  } finally {
    await f.close();
  }
});
