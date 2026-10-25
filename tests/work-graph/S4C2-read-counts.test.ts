/**
 * S4C2 rework item 8 / §11.7 Goal-card row: one Goal-card assembly through the
 * public `graphContext.readContextFacts(includeInputs: true)` pays at most one
 * plan-window read, ONE batched pointer `readMany` and ONE batched pointed-head
 * `readMany`.
 *
 * The counting wrapper is the fixture-level pattern of
 * `S4C-related-scope.test.ts:60-90` (a wrapper over `records.readMany` keyed by
 * the record kinds it asks for, allowed by §11.7). Only the reads made while the
 * material call is on the stack count; the graph reader's own Goal/Plan reads
 * and the check's trigger reads are outside it.
 */
import { expect, it, vi } from 'vitest';
import type { NoteDraftAnchorV1, NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { createS4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';
import * as readModelModule from '../../src/core/work-graph/notes/note-read-model.js';
import * as decisionReadModelModule from '../../src/core/work-graph/views/decision-read-model.js';
import { S4_NOTE_BY_ANCHOR_LOOKUPS,
  S4_NOTE_BY_REVIEW_STATUS_LOOKUP as NOTE_REVIEW_INDEX } from '../../src/core/work-graph/persistence/note-record-codecs.js';

const GOAL = 's4a-goal';
const GOAL2 = 's4c2-goal-2';
const PROJECT = 's4a-project';
const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];

function understanding(): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status: 's', decided: 'd', open: 'o', next: 'n', risks: 'r' };
  return { kind: 'understanding', topic: 'understanding', conclusion: 'goal now',
    anchor: { kind: 'goal', goalId: GOAL }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], sections } as NoteDraftV1;
}

function understandingOf(goalId: string): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status: 's', decided: 'd', open: 'o', next: 'n', risks: 'r' };
  return { ...understanding(), anchor: { kind: 'goal', goalId }, sections } as NoteDraftV1;
}

type ReadKinds = { planWindow: number; pointer: number; pointedHead: number };

function classify(refKeys: readonly string[]): Partial<ReadKinds> {
  const hits: Partial<ReadKinds> = {};
  if (refKeys.some(key => key.includes('"aggregateType":"PlanRevision"'))) hits.planWindow = 1;
  if (refKeys.some(key => key.includes('"aggregateType":"CurrentPointer"'))) hits.pointer = 1;
  if (refKeys.some(key => key.includes('"aggregateType":"NoteHead"'))) hits.pointedHead = 1;
  return hits;
}

it.each(KINDS)('item 8 %s: one Goal-card assembly reads one plan window and one pointer/head batch', async kind => {
  const state: { active: boolean; kinds: ReadKinds } = { active: false,
    kinds: { planWindow: 0, pointer: 0, pointedHead: 0 } };
  const memoryBackend = await import('../../src/core/record-store/in-memory-record-store.js');
  const sqliteBackend = await import('../../src/core/record-store/sqlite-record-store.js');
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const wrap = <T,>(backend: T): T => {
    const records = (backend as unknown as { records: { readMany(refKeys: readonly string[]): unknown } }).records;
    return { ...(backend as object),
      records: { ...records,
        async readMany(refKeys: readonly string[]) {
          if (state.active) {
            const hits = classify(refKeys);
            state.kinds.planWindow += hits.planWindow ?? 0;
            state.kinds.pointer += hits.pointer ?? 0;
            state.kinds.pointedHead += hits.pointedHead ?? 0;
          }
          return (records.readMany as (keys: readonly string[]) => unknown)(refKeys);
        } } } as unknown as T;
  };
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(optionsIn => wrap(originalMemory(optionsIn)) as never);
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(optionsIn => wrap(originalSqlite(optionsIn)) as never);

  const originalReadModel = readModelModule.createNoteReadModel;
  let captured: ReturnType<typeof readModelModule.createNoteReadModel> | null = null;
  const modelSpy = vi.spyOn(readModelModule, 'createNoteReadModel').mockImplementation(deps => {
    const model = originalReadModel(deps);
    captured = model;
    return model;
  });
  let f: Awaited<ReturnType<typeof createS4ANoteFixture>>;
  try {
    f = await createS4ANoteFixture(kind);
  } finally {
    memorySpy.mockRestore();
    sqliteSpy.mockRestore();
    modelSpy.mockRestore();
  }
  try {
    if (captured === null) throw new Error('the note read model was not composed');
    const model: ReturnType<typeof readModelModule.createNoteReadModel> = captured;
    const real = model.readMemoryMaterial;
    // Bracket exactly the material call: the graph reader's own reads and the
    // context-extension's own reads are outside the counted window.
    model.readMemoryMaterial = async (ctx, input) => {
      state.active = true;
      state.kinds = { planWindow: 0, pointer: 0, pointedHead: 0 };
      try {
        return await real.call(model, ctx, input);
      } finally {
        state.active = false;
      }
    };
    const written = await f.write(f.ctx(), understanding(), GOAL);
    if (written.status === 'rejected') throw new Error(`write failed: ${JSON.stringify(written)}`);

    const assembly = await f.platform.graphContext.readContextFacts(f.ctx(), {
      goalRef: f.goalRef, planRef: f.planRef, focusTaskIds: ['t1'], includeInputs: true,
    });
    expect(assembly.status).toBe('ready');
    expect(state.kinds).toEqual({ planWindow: 1, pointer: 1, pointedHead: 1 });
  } finally {
    await f.close();
  }
});

type ScribeReadKinds = { pointer: number; pointedHead: number; targetHead: number; otherHead: number; trigger: number;
  /** `lookup` calls against any of the five `s4-note-by-anchor-*` indexes. */
  anchorSetLookup: number;
  /** `lookup` calls against the pending/review-status index (`G+1` buckets). */
  reviewStatusLookup: number;
  /** `readMany` batches classified by the aggregate type they name. */
  plan: number;
  catalog: number };

type CountedScribe = {
  f: Awaited<ReturnType<typeof createS4ANoteFixture>>;
  state: { active: boolean; kinds: ScribeReadKinds; targetIds: Set<string> };
};

/** The same fixture-level backend wrapper, counting the scribe call's batches. */
async function createCountedScribeFixture(kind: S4ANoteFixtureKind): Promise<CountedScribe> {
  const state: CountedScribe['state'] = { active: false,
    kinds: { pointer: 0, pointedHead: 0, targetHead: 0, otherHead: 0, trigger: 0,
      anchorSetLookup: 0, reviewStatusLookup: 0, plan: 0, catalog: 0 }, targetIds: new Set<string>() };
  const memoryBackend = await import('../../src/core/record-store/in-memory-record-store.js');
  const sqliteBackend = await import('../../src/core/record-store/sqlite-record-store.js');
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const classify = (refKeys: readonly string[]): void => {
    if (!state.active || refKeys.length === 0) return;
    if (refKeys.some(key => key.includes('"aggregateType":"ArchitectureBaseline"')
      || key.includes('"aggregateType":"ArchitectureCatalog"'))) { state.kinds.catalog += 1; return; }
    if (refKeys.some(key => key.includes('"aggregateType":"TaskReduction"')
      || key.includes('"aggregateType":"TaskRequeue"'))) { state.kinds.trigger += 1; return; }
    if (refKeys.some(key => key.includes('"aggregateType":"CurrentPointer"'))) { state.kinds.pointer += 1; return; }
    if (refKeys.some(key => key.includes('"aggregateType":"PlanRevision"'))) { state.kinds.plan += 1; return; }
    if (refKeys.some(key => key.includes('"aggregateType":"NoteHead"'))) {
      if (refKeys.some(key => [...state.targetIds].some(id => key.includes(id)))) state.kinds.targetHead += 1;
      else state.kinds.pointedHead += 1;
      return;
    }
  };
  const classifyLookup = (index: string): void => {
    if (!state.active) return;
    if (S4_NOTE_BY_ANCHOR_LOOKUPS.includes(index)) state.kinds.anchorSetLookup += 1;
    else if (index === NOTE_REVIEW_INDEX) state.kinds.reviewStatusLookup += 1;
  };
  const wrap = <T,>(backend: T): T => {
    const records = (backend as unknown as {
      records: {
        lookup(request: { index: string }): unknown;
        readMany(refKeys: readonly string[]): unknown;
      };
    }).records;
    return { ...(backend as object),
      records: { ...records,
        async lookup(request: { index: string }) {
          classifyLookup(request.index);
          return (records.lookup as (value: { index: string }) => unknown)(request);
        },
        async readMany(refKeys: readonly string[]) {
          classify(refKeys);
          return (records.readMany as (keys: readonly string[]) => unknown)(refKeys);
        } } } as unknown as T;
  };
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(optionsIn => wrap(originalMemory(optionsIn)) as never);
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(optionsIn => wrap(originalSqlite(optionsIn)) as never);
  let f: CountedScribe['f'];
  try {
    f = await createS4ANoteFixture(kind);
  } finally {
    memorySpy.mockRestore();
    sqliteSpy.mockRestore();
  }
  return { f, state };
}

function generalOnGoal(goalId: string, contradicts: string[] = [],
  extraAnchors: NoteDraftAnchorV1[] = []): NoteDraftV1 {
  return { kind: 'pitfall', topic: 't', conclusion: 'c', body: 'b', anchor: { kind: 'goal', goalId },
    extraAnchors, facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts, coexistWith: [] } as NoteDraftV1;
}

/** A `stage` understanding sharing the module anchor the pending note will carry. */
function stageUnderstanding(goalId: string, stageId: string, extraAnchors: NoteDraftAnchorV1[],
  coexistWith: string[] = []): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status: 's', decided: 'd', open: 'o', next: 'n', risks: 'r' };
  return { kind: 'understanding', topic: `stage-understanding-${goalId}`, conclusion: 'stage now',
    anchor: { kind: 'stage', goalId, stageId }, extraAnchors, facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith, sections } as NoteDraftV1;
}

/** Adopt a second plan revision with the stages/tasks UNCHANGED, so a plan-1 stage anchor becomes old. */
async function adoptSecondPlan(f: CountedScribe['f'], goalRef: GoalRef, base: PlanRevisionSnapshot,
  planId: string, suffix: string): Promise<PlanRevisionSnapshot> {
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId, planRevision: base.planRevision + 1, goalId: goalRef.goalId,
    stages: base.stages, tasks: base.tasks,
    ...(base.assignments === undefined ? {} : { assignments: base.assignments }),
    obligations: base.obligations, taskHierarchy: base.taskHierarchy, executionDag: base.executionDag,
  };
  const proposed = await f.platform.plans.proposePlan(f.ctx(), {
    meta: { requestId: `${suffix}-propose`, expected: [] },
    input: { goalRef, basedOn: base.ref, draft, reason: { text: 'adopt unchanged next plan', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error(`propose next plan failed: ${JSON.stringify(proposed)}`);
  const applied = await f.platform.plans.applyPlanChange(f.ctx(), {
    meta: { requestId: `${suffix}-apply`, expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`apply next plan failed: ${JSON.stringify(applied)}`);
  return applied.value;
}

async function createSecondGoal(f: CountedScribe['f']):
Promise<{ goalRef: GoalRef; plan: PlanRevisionSnapshot }> {
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: GOAL2 };
  const created = await f.platform.goals.createGoal(f.ctx(), {
    meta: { requestId: 's4c2-goal-2', expected: [
      { ref: f.projectRef, revision: 1 }, { ref: f.workspaceRef, revision: 1 }] },
    input: { goalId: GOAL2, workspace: f.scope, objective: 'second goal' } });
  if (created.status !== 'committed') throw new Error(`create goal2 failed: ${JSON.stringify(created)}`);
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 's4c2-plan-2', planRevision: 1, goalId: GOAL2,
    stages: [{ stageId: 's1', title: 'Second stage' }],
    tasks: [{ taskId: 't1', stageId: 's1', title: 'Second work', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'g1', title: 'Second gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [{ taskId: 't1', role: 'platform-executor', instruction: 'Second work' }],
    obligations: [{ obligationId: 'o2', title: 'Deliver', requirementLevel: 'required', taskIds: ['t1', 'g1'],
      verificationRequirements: [{ requirementId: 'v2', requirementLevel: 'required', kind: 'test',
        description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
  };
  const proposed = await f.platform.plans.proposePlan(f.ctx(), {
    meta: { requestId: 's4c2-plan2-propose', expected: [] },
    input: { goalRef, basedOn: null, draft, reason: { text: 'second', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error(`propose plan2 failed: ${JSON.stringify(proposed)}`);
  const applied = await f.platform.plans.applyPlanChange(f.ctx(), {
    meta: { requestId: 's4c2-plan2-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`apply plan2 failed: ${JSON.stringify(applied)}`);
  return { goalRef, plan: applied.value };
}

async function claimOnSecondGoal(f: CountedScribe['f'], goalRef: GoalRef, plan: PlanRevisionSnapshot,
  suffix: string): Promise<RunRef> {
  const { sessionRef } = await f.createSession(suffix, 'executor');
  const goalRead = await f.platform.plans.queryGoal(f.ctx(), goalRef);
  if (goalRead.status !== 'ready') throw new Error(`goal2 read failed: ${JSON.stringify(goalRead)}`);
  const card = await f.platform.sessions.readSession(f.ctx(), sessionRef);
  if (card.status !== 'ready') throw new Error(`session read failed: ${JSON.stringify(card)}`);
  const claimed = await f.platform.claims.claimTask(f.ctx(), {
    input: { goalRef, planRef: plan.ref, taskId: 't1', sessionRef, roleBinding: f.roleBinding, budget: f.budget },
    meta: { requestId: `s4c2-claim-${suffix}`, expected: [
      { ref: goalRef, revision: goalRead.value.goal.revision },
      { ref: f.workspaceRef, revision: 1 },
      { ref: { aggregateType: 'Session', projectId: PROJECT, sessionId: sessionRef.sessionId },
        revision: card.value.record.revision },
    ] } });
  if (claimed.status !== 'committed') throw new Error(`claim failed: ${JSON.stringify(claimed)}`);
  return claimed.value.runRef;
}

async function hostWrite(f: CountedScribe['f'], draft: NoteDraftV1, goalId: string | null,
  expectedPointerRevision: number | null = null): Promise<string> {
  const result = await f.write(f.ctx(), draft, goalId, { expectedPointerRevision });
  if (result.status === 'rejected') throw new Error(`host write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

async function runWrite(f: CountedScribe['f'], ctx: Parameters<CountedScribe['f']['write']>[0],
  draft: NoteDraftV1, goalId: string): Promise<string> {
  const result = await f.write(ctx, draft, goalId);
  if (result.status === 'rejected') throw new Error(`run write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

it.each(KINDS)('item 4 %s: one pointer, one pointed-head and one target batch plus one trigger read per goal', async kind => {
  const { f, state } = await createCountedScribeFixture(kind);
  try {
    const second = await createSecondGoal(f);
    const shared: NoteDraftAnchorV1[] = [{ kind: 'module', moduleId: 'A1' }];

    // Goal 1: the pending note's relation target is an OLD-STAGE understanding on
    // the already-adopted plan 1 (plan revision 2 makes that stage anchor old). A
    // coexisting newer understanding takes the pointer, so the target stays an
    // accepted head that is not the pointed one.
    await hostWrite(f, understandingOf(GOAL), GOAL);
    const t1 = await hostWrite(f, stageUnderstanding(GOAL, 's1', shared), GOAL);
    await hostWrite(f, stageUnderstanding(GOAL, 's1', shared, [t1]), GOAL, 1);
    // Claim the real Run while plan 1 is still the pin, then write one pending note
    // through it and only then make plan 1's stage anchor old.
    const run1 = await f.claimRun('scribe-p1', 't1', 'executor');
    const p1 = await runWrite(f, f.workCtx(run1), generalOnGoal(GOAL, [t1], shared), GOAL);
    await adoptSecondPlan(f, f.goalRef, f.plan, 's4c2-plan-2-g1', 's4c2-plan2-g1');

    // Goal 2: the same shape through the second real Goal + Plan (its target stage
    // anchor is still the current plan's, so only the trigger read can repeat).
    await hostWrite(f, understandingOf(GOAL2), GOAL2);
    const t2 = await hostWrite(f, stageUnderstanding(GOAL2, 's1', shared), GOAL2);
    await hostWrite(f, stageUnderstanding(GOAL2, 's1', shared, [t2]), GOAL2, 1);
    const run2 = await claimOnSecondGoal(f, second.goalRef, second.plan, 'scribe-p2');
    const p2 = await runWrite(f, f.workCtx(run2), generalOnGoal(GOAL2, [t2], shared), GOAL2);

    expect(p1).not.toBe(p2);
    state.targetIds.add(t1);
    state.targetIds.add(t2);

    const scribe = f.platform.notes as unknown as {
      readScribeTodos(ctx: ReturnType<CountedScribe['f']['ctx']>, input: { goalIds: string[] }):
      Promise<{ status: string }>;
    };
    state.active = true;
    let status: string;
    try {
      const read = await scribe.readScribeTodos(f.ctx(), { goalIds: [GOAL, GOAL2] });
      status = read.status;
    } finally {
      state.active = false;
    }
    expect(status).toBe('ready');
    expect(state.kinds).toEqual({ pointer: 1, pointedHead: 1, targetHead: 1, otherHead: 0, trigger: 2,
      anchorSetLookup: 0, reviewStatusLookup: 3, plan: 2, catalog: 0 });
  } finally {
    await f.close();
  }
});

// ---------------------------------------------------------------------------
// 4C-2 rework 4 item 1 (§11.6/L23, §11.7 heartbeat row): the to-dos take the
// relation targets' live facts from the note service's ONE userReasonFacts.
//
// Hand-computed for ONE `readScribeTodos({ goalIds: [g] })` AFTER the fix, with
// one Goal (G = 1) and every bucket far below 200:
//   target anchor-set lookups 0   (0 for each of the four target keys; the old
//                                  check paid 5 per distinct target anchor key)
//   review-status lookups G+1=2   (1 goal bucket + 1 goal-less bucket; the old
//                                  check added 4 quota buckets → 6)
//   CurrentPointer readMany 1     (the shared reader's one pointer batch)
//   NoteHead readMany 2           (1 pointed-head batch + 1 target batch)
//   PlanRevision readMany 1       (the shared reader's one window; the stage and
//                                  the task target reuse the seeded window)
//   ArchitectureBaseline/Catalog readMany 1 (the module A1 target's window)
//   trigger readMany 1            (1 goal with a plan = 1)
//   pending = []                  (all four targets are live user-written notes,
//                                  so the agent note keeps four live user reasons)
// ---------------------------------------------------------------------------
it.each(KINDS)('rework 4 item 1 %s: targets are read only for the counting bucket and the check is gone', async kind => {
  const { f, state } = await createCountedScribeFixture(kind);
  try {
    // A goal understanding, so the shared reader finds a live CurrentPointer.
    await hostWrite(f, understandingOf(GOAL), GOAL);
    const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: GOAL };
    const stageAnchor: NoteDraftAnchorV1 = { kind: 'stage', goalId: GOAL, stageId: 's1' };
    const moduleAnchor: NoteDraftAnchorV1 = { kind: 'module', moduleId: 'A1' };
    const taskAnchor: NoteDraftAnchorV1 = { kind: 'task', goalId: GOAL, taskId: 't1' };
    // User-written, current targets on the goal, the stage, module A1 and the
    // task. The task target is the case the old check could not cover without a
    // fresh Goal/Plan window.
    const goalTarget = await hostWrite(f, generalOnAnchor(goalAnchor, 'goal target'), GOAL);
    const stageTarget = await hostWrite(f, generalOnAnchor(stageAnchor, 'stage target'), GOAL);
    const moduleTarget = await hostWrite(f, generalOnAnchor(moduleAnchor, 'module A1 target'), GOAL);
    const taskTarget = await hostWrite(f, generalOnAnchor(taskAnchor, 'task target'), GOAL);

    // ONE agent pending note sharing all four keys and contradicting all four.
    const run = await f.claimRun('user-reason-count');
    const pendingWrite = await f.write(f.workCtx(run), {
      ...generalOnAnchor(goalAnchor, 'agent pending'),
      extraAnchors: [stageAnchor, moduleAnchor, taskAnchor],
      contradicts: [goalTarget, stageTarget, moduleTarget, taskTarget],
    } as NoteDraftV1, GOAL);
    expect(pendingWrite).toMatchObject({ status: 'pending_review' });

    state.targetIds = new Set([goalTarget, stageTarget, moduleTarget, taskTarget]);
    state.active = true;
    let read: Awaited<ReturnType<typeof f.platform.notes.readScribeTodos>>;
    try {
      read = await f.platform.notes.readScribeTodos(f.ctx(), { goalIds: [GOAL] });
    } finally {
      state.active = false;
    }
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.find(row => row.goalId === GOAL)?.pending).toEqual([]);

    // Assert the named quantities individually so a failure says which read
    // regressed (never one blob).
    expect(state.kinds.anchorSetLookup).toBe(0);
    expect(state.kinds.reviewStatusLookup).toBe(2);
    expect(state.kinds.pointer).toBe(1);
    expect(state.kinds.pointedHead).toBe(1);
    expect(state.kinds.targetHead).toBe(1);
    expect(state.kinds.plan).toBe(1);
    expect(state.kinds.catalog).toBe(1);
    expect(state.kinds.trigger).toBe(1);
  } finally {
    await f.close();
  }
});
// ---------------------------------------------------------------------------
// S4C2 rework 2 item 1 / rework 3 item 1 (§11.7, §12.7): one queue call reads
// each Goal's plan window once and the catalog EXACTLY once across Goals.
// Counts bracket ONLY the note-card source's own `readPage` and are kept per
// Goal, because the queue reads the note source once per Goal.
//
// Hand-computed expectation (per Goal / source invocation), AFTER the fix:
//   Goal g1, one pending note replacing a real stage note, the real module
//   notes A1 and B, and a real interface A/I1 note that the catalog revision
//   below retires:
//     plan 1     (readGoalPlanWindow once; the stage target's
//                 primaryAnchorRetiredNonFile reuses the seeded window)
//     catalog 1  (A1 + B share ONE catalog window per queue ATTEMPT; the
//                 retired interface's candidate list is NOT built on the
//                 reason-facts path, so it reads no second catalog)
//     note-index 1, NoteHead readMany 1, CurrentPointer readMany 1
//     relation-target NoteHead batch 1
//   Goal g2, one pending note replacing a real module B note:
//     plan 1     (readNoteDecisions always reads the Goal window)
//     catalog 0  (the module-facts window is the one g1 already stored in the
//                 queue attempt cache)
//     note-index 1, NoteHead readMany 1, CurrentPointer readMany 1
//     relation-target NoteHead batch 1
//   So the three note batches are 3 per Goal, 6 in total, and the whole queue
//   reads the catalog once.
//   RED on the old code: g1 catalog 2 (module window + the retired interface's
//   candidate list), g2 catalog 1 (fresh NoteCall per Goal), total 3.
// ---------------------------------------------------------------------------

type QueueKinds = { noteIndex: number; noteHead: number; pointer: number; plan: number;
  catalog: number; targetHead: number };

type QueueCountState = {
  active: boolean;
  goalId: string | null;
  targetIds: Set<string>;
  perGoal: Map<string, QueueKinds>;
};

const zeroQueueKinds = (): QueueKinds => ({ noteIndex: 0, noteHead: 0, pointer: 0, plan: 0,
  catalog: 0, targetHead: 0 });

/**
 * The file's spy-on-backend-factory pattern, wrapping the record store the
 * platform actually uses, plus a wrapper on the PRODUCTION note-card source:
 * counts are taken only while the note source's own `readPage` is on the stack.
 */
async function createQueueCountFixture(kind: S4ANoteFixtureKind):
Promise<{ f: Awaited<ReturnType<typeof createS4ANoteFixture>>; state: QueueCountState }> {
  const state: QueueCountState = { active: false, goalId: null, targetIds: new Set(), perGoal: new Map() };
  const memoryBackend = await import('../../src/core/record-store/in-memory-record-store.js');
  const sqliteBackend = await import('../../src/core/record-store/sqlite-record-store.js');
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const currentKinds = (): QueueKinds | null => {
    if (!state.active || state.goalId === null) return null;
    return state.perGoal.get(state.goalId) ?? null;
  };
  const classifyKeys = (refKeys: readonly string[]): void => {
    const kinds = currentKinds();
    if (kinds === null || refKeys.length === 0) return;
    if (refKeys.some(key => key.includes('"aggregateType":"PlanRevision"'))) kinds.plan += 1;
    if (refKeys.some(key => key.includes('"aggregateType":"ArchitectureBaseline"')
      || key.includes('"aggregateType":"ArchitectureCatalog"'))) kinds.catalog += 1;
    if (refKeys.some(key => key.includes('"aggregateType":"CurrentPointer"'))) kinds.pointer += 1;
    if (refKeys.some(key => key.includes('"aggregateType":"NoteHead"'))) {
      kinds.noteHead += 1;
      const targetIds = [...state.targetIds];
      if (refKeys.some(key => targetIds.some(id => key.includes(`"noteId":${JSON.stringify(id)}`)))) {
        kinds.targetHead += 1;
      }
    }
  };
  const wrap = <T,>(backend: T): T => {
    const records = (backend as unknown as {
      records: {
        lookup(request: { index: string }): unknown;
        readMany(refKeys: readonly string[]): unknown;
      };
    }).records;
    return { ...(backend as object), records: { ...records,
      async lookup(request: { index: string }) {
        if (request.index === NOTE_REVIEW_INDEX) {
          const kinds = currentKinds();
          if (kinds !== null) kinds.noteIndex += 1;
        }
        return (records.lookup as (value: { index: string }) => unknown)(request);
      },
      async readMany(refKeys: readonly string[]) {
        classifyKeys(refKeys);
        return (records.readMany as (keys: readonly string[]) => unknown)(refKeys);
      } } } as unknown as T;
  };
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(options => wrap(originalMemory(options)) as never);
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(options => wrap(originalSqlite(options)) as never);
  const originalCardSource = decisionReadModelModule.createNoteReviewCardSource;
  const cardSpy = vi.spyOn(decisionReadModelModule, 'createNoteReviewCardSource')
    .mockImplementation(deps => {
      const real = originalCardSource(deps);
      return { ...real,
        async readPage(ctx, input) {
          const goalId = input.goalRef === undefined ? null : input.goalRef.goalId;
          if (goalId !== null) {
            state.active = true;
            state.goalId = goalId;
            state.perGoal.set(goalId, zeroQueueKinds());
          }
          try {
            return await real.readPage(ctx, input);
          } finally {
            state.active = false;
            state.goalId = null;
          }
        } };
    });
  let f: Awaited<ReturnType<typeof createS4ANoteFixture>>;
  try {
    f = await createS4ANoteFixture(kind);
  } finally {
    memorySpy.mockRestore();
    sqliteSpy.mockRestore();
    cardSpy.mockRestore();
  }
  return { f, state };
}

/** A real general note draft on one trusted anchor. */
function generalOnAnchor(anchor: NoteDraftAnchorV1, topic: string, replaces: string[] = [],
  extraAnchors: NoteDraftAnchorV1[] = []): NoteDraftV1 {
  return { kind: 'pitfall', topic, conclusion: topic, body: 'b', anchor,
    extraAnchors, facts: [], basisFiles: [], structural: false,
    replaces, contradicts: [], coexistWith: [] } as NoteDraftV1;
}

it.each(KINDS)('rework 2/3 item 1 %s: one plan window and exactly one catalog per queue call', async kind => {
  const { f, state } = await createQueueCountFixture(kind);
  try {
    const second = await createSecondGoal(f);
    // g1: user-written (confirmed) targets on a real stage, two real modules and
    // the real interface A/I1. The pending note carries the same anchors, as the
    // relation gate requires one shared anchor key with every relation target.
    const stageAnchor: NoteDraftAnchorV1 = { kind: 'stage', goalId: GOAL, stageId: 's1' };
    const moduleA1Anchor: NoteDraftAnchorV1 = { kind: 'module', moduleId: 'A1' };
    const moduleBAnchor: NoteDraftAnchorV1 = { kind: 'module', moduleId: 'B' };
    const interfaceAnchor: NoteDraftAnchorV1 = { kind: 'interface', moduleId: 'A', interfaceId: 'I1' };
    const stageNote = await hostWrite(f, generalOnAnchor(stageAnchor, 'stage note'), GOAL);
    const moduleA1 = await hostWrite(f, generalOnAnchor(moduleA1Anchor, 'module A1 note'), GOAL);
    const moduleB = await hostWrite(f, generalOnAnchor(moduleBAnchor, 'module B note'), GOAL);
    const interfaceNote = await hostWrite(f, generalOnAnchor(interfaceAnchor, 'interface A/I1 note'), GOAL);
    const run1 = await f.claimRun('queue-count-g1');
    await runWrite(f, f.workCtx(run1),
      generalOnAnchor({ kind: 'goal', goalId: GOAL }, 'pending g1',
        [stageNote, moduleA1, moduleB, interfaceNote],
        [stageAnchor, moduleA1Anchor, moduleBAnchor, interfaceAnchor]), GOAL);

    // g2: one user module B note as the relation target of one pending agent
    // note, so g2 needs module facts (and would read its own catalog window on
    // the old per-NoteCall cache).
    const run2 = await claimOnSecondGoal(f, second.goalRef, second.plan, 'queue-count-g2');
    const moduleB2 = await hostWrite(f, generalOnAnchor(moduleBAnchor, 'g2 module B note'), GOAL2);
    await runWrite(f, f.workCtx(run2),
      generalOnAnchor({ kind: 'goal', goalId: GOAL2 }, 'pending g2', [moduleB2], [moduleBAnchor]), GOAL2);

    state.targetIds = new Set([stageNote, moduleA1, moduleB, interfaceNote, moduleB2]);

    // Retire the interface A/I1 through the PUBLIC catalog revision, so the
    // interface target's `primaryAnchorRetiredNonFile` would build a candidate
    // list (a second catalog read) on the old code.
    // A module removed from the catalog is publicly refused
    // (`catalog-service.ts` "must not remove the existing module", see the
    // BLOCKED comment in `S4B-note-anchor-status.test.ts`), so an interface
    // removal is the smallest public revision that reaches `candidatesFor`.
    const currentCatalog = await f.platform.architecture.readArchitectureRevision(f.ctx(),
      { selection: { kind: 'current' } });
    if (currentCatalog.status !== 'ready' || currentCatalog.value.catalog === null) {
      throw new Error(`catalog read failed: ${JSON.stringify(currentCatalog)}`);
    }
    const catalog = currentCatalog.value.catalog.catalog;
    const revised = await f.platform.architecture.reviseArchitectureCatalog(f.ctx(), {
      meta: { requestId: 'queue-count-catalog', expected: [
        { ref: f.projectRef, revision: 1 }, { ref: f.workspaceRef, revision: 1 }] },
      input: { basedOn: { ref: currentCatalog.value.baseline.ref, digest: currentCatalog.value.baseline.contentDigest },
        catalog: { ...catalog, modules: catalog.modules.map(module => module.ref.moduleId === 'A'
          ? { ...module, interfaces: module.interfaces.filter(entry => entry.id !== 'I1') } : module) },
        reason: 'queue-count: interface A/I1 removed for the retired-target read count' } });
    if (revised.status !== 'committed') throw new Error(`catalog revision failed: ${JSON.stringify(revised)}`);

    // The REAL workspace-wide queue, no goalRef: it is the only entry.
    const read = await f.platform.decisions.queryDecisionQueue(f.ctx(), {
      workspace: f.scope, sections: ['waiting_answer'], page: { limit: 100 },
    });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const noteCards = read.value.waitingAnswer.filter(card => card.source.kind === 'note_review');
    expect(noteCards).toHaveLength(2);
    expect(noteCards.map(card => card.subject.kind === 'goal' ? card.subject.goalRef.goalId : null).sort())
      .toEqual([GOAL, GOAL2].sort());

    const g1 = state.perGoal.get(GOAL);
    const g2 = state.perGoal.get(GOAL2);
    if (g1 === undefined || g2 === undefined) throw new Error('the note source did not run for both goals');
    // Hand-computed: see the comment block above.
    // ONE catalog window for the WHOLE queue call: g2 reuses g1's attempt window
    // and the retired interface target builds no candidate list.
    expect(g1.catalog + g2.catalog).toBe(1);
    expect(g1).toEqual({ noteIndex: 1, noteHead: 1, pointer: 1, plan: 1, catalog: 1, targetHead: 1 });
    expect(g2).toEqual({ noteIndex: 1, noteHead: 1, pointer: 1, plan: 1, catalog: 0, targetHead: 1 });
    // The stage target reuses the window the card source already read per Goal.
    expect(g1.plan).toBe(1);
    expect(g2.plan).toBe(1);
    // note-index lookup + NoteHead readMany + CurrentPointer readMany = 3 per goal.
    expect(g1.noteIndex + g1.noteHead + g1.pointer).toBe(3);
    expect(g2.noteIndex + g2.noteHead + g2.pointer).toBe(3);
  } finally {
    state.active = false;
    await f.close();
  }
});
