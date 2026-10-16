/**
 * Rework item 1 / §11.7: the note caches are per CALL, not per `ctx`. A Run's
 * tool context (and a test's) is reused across calls, so a `ctx`-keyed WeakMap
 * leaks facts/plan stages from an earlier call. Both tests reuse the SAME `ctx`
 * object for two dispositions and change the world in between:
 *   - PC-scope: the scribe's responsible module moves A -> B; the second
 *     disposition on a region-A note must be `forbidden`/`outside_managed_scope`.
 *   - PC-plan: a plan revision removes the note's stage; the second accept must
 *     see the stage anchor retired and answer `resolution_not_applicable`.
 * Expected values are literal, hand-computed from §11.6/§11.7; no database or
 * record store is read to answer an assertion.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RoleBindingRefV1, RunRef } from '../../src/contracts/dispatch.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';
import { createS4ANoteScopeFixture, type S4ANoteScopeFixture } from '../helpers/S4A-note-scope-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const FILE_A = { kind: 'file', path: 'src/a/x.ts' } as const;
const GOAL_ID = 's4a-goal';

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'default topic', conclusion: 'default conclusion', anchor: FILE_A,
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
    coexistWith: [], body: 'body', ...overrides,
  } as NoteDraftV1;
}
const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

describe('PC-scope the derived scribe facts are re-read on the next call with the same ctx', () => {
  it.each(KINDS)('PC-scope %s: moving the scribe A -> B makes the second disposition forbidden', async kind => {
    const f: S4ANoteScopeFixture = await createS4ANoteScopeFixture(kind, {});
    try {
      const executor = f.workCtx(f.scribes.executor.runRef);
      // Agent targets (no user reason), so the scribe may dispose them.
      const u1 = await f.write(executor, general({ topic: 'pc-scope-u1', anchor: FILE_A }), GOAL_ID);
      const u2 = await f.write(executor, general({ topic: 'pc-scope-u2', anchor: FILE_A }), GOAL_ID);
      const u1Id = idOf(u1);
      const u2Id = idOf(u2);
      expect(u1.status).toBe('accepted');
      expect(u2.status).toBe('accepted');
      const y1 = await f.write(executor, general({ topic: 'pc-scope-y1', anchor: FILE_A, contradicts: [u1Id] }),
        GOAL_ID);
      const y2 = await f.write(executor, general({ topic: 'pc-scope-y2', anchor: FILE_A, contradicts: [u2Id] }),
        GOAL_ID);
      expect(y1).toMatchObject({ status: 'pending_review' });
      expect(y2).toMatchObject({ status: 'pending_review' });

      // The SAME ctx object for both dispositions.
      const saCtx = f.workCtx(f.scribes.sa.runRef);
      const first = await f.platform.notes.reviewNote(saCtx, { commandId: 'pc-scope-1', noteId: idOf(y1),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', resolution: 'supersede', reason: '收下' });
      expect(first).toMatchObject({ status: 'done', state: 'accepted' });

      // Move the scribe's responsibility from module A to module B.
      await f.linkModule(f.scribes.sa, 'A', false);
      await f.linkModule(f.scribes.sa, 'B', true);

      const second = await f.platform.notes.reviewNote(saCtx, { commandId: 'pc-scope-2', noteId: idOf(y2),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', resolution: 'supersede', reason: '收下' });
      // The note is anchored in module A; the scribe now manages only B, and a
      // goal-class anchor is not in play, so the managing scope goes up to the
      // project, which this region scribe does not hold.
      expect(second).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'outside_managed_scope' });
    } finally { await f.close(); }
  });
});

describe('PC-scope-read the per-scope count re-reads the facts on the next call with the same ctx', () => {
  it.each(KINDS)('PC-scope-read %s: after the scribe A -> B moves, scope A counts 0', async kind => {
    const f: S4ANoteScopeFixture = await createS4ANoteScopeFixture(kind, {});
    try {
      const executor = f.workCtx(f.scribes.executor.runRef);
      const u = await f.write(executor, general({ topic: 'pc-count-u', anchor: FILE_A }), GOAL_ID);
      expect(u.status).toBe('accepted');
      const saCtx = f.workCtx(f.scribes.sa.runRef);
      // Before the move, region A is held by sa and its accepted note counts.
      expect(await f.notes.countCurrentNotes(saCtx, { scope: { kind: 'region', moduleId: 'A' } }))
        .toEqual({ status: 'ready', value: { scope: { kind: 'region', moduleId: 'A' }, current: 1 } });
      await f.linkModule(f.scribes.sa, 'A', false);
      await f.linkModule(f.scribes.sa, 'B', true);
      // No scribe holds region A any more, so the count is 0; a stale facts
      // cache would still report the note as managed by A.
      expect(await f.notes.countCurrentNotes(saCtx, { scope: { kind: 'region', moduleId: 'A' } }))
        .toEqual({ status: 'ready', value: { scope: { kind: 'region', moduleId: 'A' }, current: 0 } });
    } finally { await f.close(); }
  });
});

/**
 * RW-5 helper copied from `S4C-note-protection.test.ts` (it is file-local):
 * adopt one more plan revision through the real services, chaining the previous
 * snapshot (each adopted revision carries a new planId).
 */
async function reviseStages(f: S4ANoteFixture, previous: PlanRevisionSnapshot,
  stages: PlanRevisionSnapshot['stages']): Promise<PlanRevisionSnapshot> {
  const ctx = f.ctx();
  const before = await f.platform.plans.queryGoal(ctx, f.goalRef);
  if (before.status !== 'ready') throw new Error('pc-plan goal read failed');
  const revision = previous.planRevision + 1;
  const stageIds = new Set(stages.map(candidate => candidate.stageId));
  const fallbackStage = stages[0]?.stageId;
  const tasks = previous.tasks.map(task => {
    if (task.stageId === undefined || stageIds.has(task.stageId) || fallbackStage === undefined) return task;
    return { ...task, stageId: fallbackStage };
  });
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `s4a-plan-${String(revision)}`, planRevision: revision, goalId: f.goalRef.goalId,
    stages: structuredClone(stages), tasks: structuredClone(tasks),
    assignments: structuredClone(previous.assignments ?? []), obligations: structuredClone(previous.obligations),
    taskHierarchy: structuredClone(previous.taskHierarchy), executionDag: structuredClone(previous.executionDag),
    taskRelations: [], inputRequirements: [],
  };
  const proposed = await f.platform.plans.proposePlan(ctx, {
    meta: { requestId: `pc-plan-propose-${String(revision)}`, expected: [{ ref: f.goalRef, revision: before.value.goal.revision }] },
    input: { goalRef: f.goalRef, basedOn: previous.ref, reason: { text: 'pc-plan revise stages', sources: [] }, draft } });
  if (proposed.status !== 'committed') throw new Error(`pc-plan propose failed: ${JSON.stringify(proposed)}`);
  const after = await f.platform.plans.queryGoal(ctx, f.goalRef);
  if (after.status !== 'ready') throw new Error('pc-plan goal re-read failed');
  const applied = await f.platform.plans.applyPlanChange(ctx, {
    meta: { requestId: `pc-plan-apply-${String(revision)}`, expected: [{ ref: f.goalRef, revision: after.value.goal.revision }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`pc-plan apply failed: ${JSON.stringify(applied)}`);
  return applied.value;
}

/** RW-5 helper copied from `S4C-note-protection.test.ts`: claim a Run bound to an explicit plan revision. */
async function claimWithPlan(f: S4ANoteFixture, suffix: string,
  sessionRef: { projectId: string; sessionId: string }, taskId: string, role: 'executor' | 'scribe',
  planRef: PlanRevisionRef): Promise<RunRef> {
  const ctx = f.ctx();
  const goal = await f.platform.plans.queryGoal(ctx, f.goalRef);
  if (goal.status !== 'ready') throw new Error('pc-plan claim goal read failed');
  const card = await f.platform.sessions.readSession(ctx, sessionRef);
  if (card.status !== 'ready') throw new Error('pc-plan claim session read failed');
  const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: `pc-plan-${suffix}-binding`,
    templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor', templateRevision: 's3.1',
    bindingVersion: 1, policyRevision: 'legacy-template' };
  const claimed = await f.platform.claims.claimTask(ctx, {
    input: { goalRef: f.goalRef, planRef, taskId, sessionRef, roleBinding, budget: f.budget },
    meta: { requestId: `pc-plan-claim-${suffix}`, expected: [
      { ref: f.goalRef, revision: goal.value.goal.revision },
      { ref: f.workspaceRef, revision: 1 },
      { ref: { aggregateType: 'Session', projectId: f.scope.projectId, sessionId: sessionRef.sessionId },
        revision: card.value.record.revision },
    ] } });
  if (claimed.status !== 'committed') throw new Error(`pc-plan claim failed: ${JSON.stringify(claimed)}`);
  return claimed.value.runRef;
}

describe('PC-plan the plan-stage window is re-read on the next call with the same ctx', () => {
  it.each(KINDS)('PC-plan %s: a removed stage makes the second accept resolution_not_applicable', async kind => {
    const f = await createS4ANoteFixture(kind, {});
    try {
      const NOTE_STAGE = { stageId: 's-note', title: 'Note stage' };
      const anchor: NoteDraftAnchorV1 = { kind: 'stage', goalId: GOAL_ID, stageId: 's-note' };
      // p2 adds the note stage S; p3 later removes it.
      const p2 = await reviseStages(f, f.plan, [...f.plan.stages, NOTE_STAGE]);
      const execSession = (await f.createSession('pc-plan-exec', 'executor')).sessionRef;
      const execCtx = f.workCtx(await claimWithPlan(f, 'exec', execSession, 't1', 'executor', p2.ref));
      // Agent targets on the stage anchor (no user reason).
      const u1 = await f.write(execCtx, general({ topic: 'pc-plan-u1', anchor }), GOAL_ID);
      const u2 = await f.write(execCtx, general({ topic: 'pc-plan-u2', anchor }), GOAL_ID);
      expect(u1.status).toBe('accepted');
      expect(u2.status).toBe('accepted');
      const y1 = await f.write(execCtx, general({ topic: 'pc-plan-y1', anchor, contradicts: [idOf(u1)] }), GOAL_ID);
      const y2 = await f.write(execCtx, general({ topic: 'pc-plan-y2', anchor, contradicts: [idOf(u2)] }), GOAL_ID);
      expect(y1).toMatchObject({ status: 'pending_review' });
      expect(y2).toMatchObject({ status: 'pending_review' });

      const scribeSession = (await f.createSession('pc-plan-scribe', 'scribe')).sessionRef;
      const scribeCtx = f.workCtx(await claimWithPlan(f, 'scribe', scribeSession, 't3', 'scribe', p2.ref));
      // The SAME ctx object for both accepts.
      const first = await f.platform.notes.reviewNote(scribeCtx, { commandId: 'pc-plan-1', noteId: idOf(y1),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', resolution: 'supersede', reason: '收下' });
      expect(first).toMatchObject({ status: 'done', state: 'accepted' });

      // p3 drops S: the target's stage anchor is now retired for user reasons.
      await reviseStages(f, p2, [...f.plan.stages]);

      const second = await f.platform.notes.reviewNote(scribeCtx, { commandId: 'pc-plan-2', noteId: idOf(y2),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', resolution: 'supersede', reason: '收下' });
      // No live contradiction remains (the target's stage is retired), so the
      // resolution is not applicable; a stale plan window would still see S.
      expect(second).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'resolution_not_applicable' });
    } finally { await f.close(); }
  });
});
