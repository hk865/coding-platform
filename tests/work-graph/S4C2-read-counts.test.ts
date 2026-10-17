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

type ScribeReadKinds = { pointer: number; pointedHead: number; targetHead: number; otherHead: number; trigger: number };

type CountedScribe = {
  f: Awaited<ReturnType<typeof createS4ANoteFixture>>;
  state: { active: boolean; kinds: ScribeReadKinds; targetIds: Set<string> };
};

/** The same fixture-level backend wrapper, counting the scribe call's batches. */
async function createCountedScribeFixture(kind: S4ANoteFixtureKind): Promise<CountedScribe> {
  const state: CountedScribe['state'] = { active: false,
    kinds: { pointer: 0, pointedHead: 0, targetHead: 0, otherHead: 0, trigger: 0 }, targetIds: new Set<string>() };
  const memoryBackend = await import('../../src/core/record-store/in-memory-record-store.js');
  const sqliteBackend = await import('../../src/core/record-store/sqlite-record-store.js');
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const classify = (refKeys: readonly string[]): void => {
    if (!state.active || refKeys.length === 0) return;
    if (refKeys.some(key => key.includes('"aggregateType":"TaskReduction"')
      || key.includes('"aggregateType":"TaskRequeue"'))) { state.kinds.trigger += 1; return; }
    if (refKeys.some(key => key.includes('"aggregateType":"CurrentPointer"'))) { state.kinds.pointer += 1; return; }
    if (refKeys.some(key => key.includes('"aggregateType":"NoteHead"'))) {
      if (refKeys.some(key => [...state.targetIds].some(id => key.includes(id)))) state.kinds.targetHead += 1;
      else state.kinds.pointedHead += 1;
      return;
    }
  };
  const wrap = <T,>(backend: T): T => {
    const records = (backend as unknown as { records: { readMany(refKeys: readonly string[]): unknown } }).records;
    return { ...(backend as object),
      records: { ...records,
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
    schemaVersion: 1, planId: 's4c2-plan-2', planRevision: 1, goalId: GOAL2,
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
    expect(state.kinds).toEqual({ pointer: 1, pointedHead: 1, targetHead: 1, otherHead: 0, trigger: 2 });
  } finally {
    await f.close();
  }
});
