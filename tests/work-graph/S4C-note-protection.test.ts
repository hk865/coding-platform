/**
 * Slice 4C-1 C3 (spec §11.6, decision 68): the write-side protection rules and
 * the scribe's dispositions, reached only through the public `platform.notes`
 * writer/reader. Expected values are literal, hand-computed from the spec rows
 * D-04, D-06, D-07, D-08, D-14, D-15, D-16. No database or record store reads.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftAnchorV1, NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RoleBindingRefV1, RunRef } from '../../src/contracts/dispatch.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const FILE_A = { kind: 'file', path: 'src/a/x.ts' } as const;
const FILE_B = { kind: 'file', path: 'src/b/y.ts' } as const;
const GOAL = { kind: 'goal', goalId: 's4a-goal' } as const;

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'default topic', conclusion: 'default conclusion',
    anchor: FILE_A, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'body',
    ...overrides,
  } as NoteDraftV1;
}
function understanding(anchor: NoteDraftAnchorV1, overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' };
  return { kind: 'understanding', topic: 'understanding', conclusion: 'current', anchor, extraAnchors: [],
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], sections,
    ...overrides } as NoteDraftV1;
}
async function withFixture<T>(kind: S4ANoteFixtureKind, options: { anchorQuota?: number; goalQuota?: number } = {},
  body: (fixture: S4ANoteFixture) => Promise<T>): Promise<T> {
  const fixture = await createS4ANoteFixture(kind, options);
  try { return await body(fixture); } finally { await fixture.close(); }
}
const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;
async function itemOf(f: S4ANoteFixture, noteId: string, version?: number): Promise<{ storedState: string;
  goalId: string | null; replaces: string[]; coexistWith: string[]; confirmedByUser: boolean; version: number;
  anchor: NoteDraftAnchorV1 }> {
  const read = await f.platform.notes.readNote(f.ctx(), { noteId, ...(version === undefined ? {} : { version }) });
  if (read.status !== 'ready') throw new Error(`note ${noteId} is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

/**
 * RW-5: adopt one more plan revision through the real services, chaining the
 * previous snapshot (each adopted revision carries a new planId).
 */
async function reviseStages(f: S4ANoteFixture, previous: PlanRevisionSnapshot,
  stages: PlanRevisionSnapshot['stages']): Promise<PlanRevisionSnapshot> {
  const ctx = f.ctx();
  const before = await f.platform.plans.queryGoal(ctx, f.goalRef);
  if (before.status !== 'ready') throw new Error('rw5 goal read failed');
  const revision = previous.planRevision + 1;
  // A task must reference a stage that exists in the future plan, so a removed
  // stage's tasks move to the first supplied stage.
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
    meta: { requestId: `rw5-propose-${String(revision)}`, expected: [{ ref: f.goalRef, revision: before.value.goal.revision }] },
    input: { goalRef: f.goalRef, basedOn: previous.ref, reason: { text: 'rw5 revise stages', sources: [] }, draft } });
  if (proposed.status !== 'committed') throw new Error(`rw5 propose failed: ${JSON.stringify(proposed)}`);
  const after = await f.platform.plans.queryGoal(ctx, f.goalRef);
  if (after.status !== 'ready') throw new Error('rw5 goal re-read failed');
  const applied = await f.platform.plans.applyPlanChange(ctx, {
    meta: { requestId: `rw5-apply-${String(revision)}`, expected: [{ ref: f.goalRef, revision: after.value.goal.revision }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`rw5 apply failed: ${JSON.stringify(applied)}`);
  return applied.value;
}

/**
 * RW-5: claim a Run bound to an EXPLICIT plan revision (the fixture's claim
 * helper is bound to its original plan, which is stale after a revision).
 */
async function claimWithPlan(f: S4ANoteFixture, suffix: string,
  sessionRef: { projectId: string; sessionId: string }, taskId: string, role: 'executor' | 'scribe',
  planRef: PlanRevisionRef): Promise<RunRef> {
  const ctx = f.ctx();
  const goal = await f.platform.plans.queryGoal(ctx, f.goalRef);
  if (goal.status !== 'ready') throw new Error('rw5 claim goal read failed');
  const card = await f.platform.sessions.readSession(ctx, sessionRef);
  if (card.status !== 'ready') throw new Error('rw5 claim session read failed');
  const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: `rw5-${suffix}-binding`,
    templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor', templateRevision: 's3.1',
    bindingVersion: 1, policyRevision: 'legacy-template' };
  const claimed = await f.platform.claims.claimTask(ctx, {
    input: { goalRef: f.goalRef, planRef, taskId, sessionRef, roleBinding, budget: f.budget },
    meta: { requestId: `rw5-claim-${suffix}`, expected: [
      { ref: f.goalRef, revision: goal.value.goal.revision },
      { ref: f.workspaceRef, revision: 1 },
      { ref: { aggregateType: 'Session', projectId: f.scope.projectId, sessionId: sessionRef.sessionId },
        revision: card.value.record.revision },
    ] } });
  if (claimed.status !== 'committed') throw new Error(`rw5 claim failed: ${JSON.stringify(claimed)}`);
  return claimed.value.runRef;
}

describe('S4C D-04: contradicting a no-longer-current note', () => {
  it.each(KINDS)('D-04 %s: a contradicted superseded note is not a user reason', async kind => {
    await withFixture(kind, {}, async f => {
      const user = f.ctx();
      const old = await f.write(user, general({ topic: 'old', anchor: FILE_A }), null);
      const oldId = idOf(old);
      await f.write(user, general({ topic: 'newer', anchor: FILE_A, replaces: [oldId] }), null);
      const run = await f.claimRun('s4c-d04');
      const note = await f.write(f.workCtx(run),
        general({ topic: 'contra', anchor: FILE_A, contradicts: [oldId] }), 's4a-goal');
      expect(note).toMatchObject({ status: 'accepted', reasons: [] });
    });
  });
});

describe('S4C D-06: replacing a user-confirmed note', () => {
  it.each(KINDS)('D-06 %s: the agent write is pending, user_note_replaced, and accept supersedes the user note', async kind => {
    await withFixture(kind, {}, async f => {
      const user = f.ctx();
      const mine = await f.write(user, general({ topic: 'mine', anchor: FILE_A }), null);
      const mineId = idOf(mine);
      const run = await f.claimRun('s4c-d06');
      const agent = await f.write(f.workCtx(run),
        general({ topic: 'agent', anchor: FILE_A, replaces: [mineId] }), 's4a-goal');
      expect(agent).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'] });
      expect((await itemOf(f, mineId)).storedState).toBe('accepted');
      // No live contradiction, so giving a resolution is not applicable.
      const notApplicable = await f.platform.notes.reviewNote(user, { commandId: 's4c-d06-na',
        noteId: idOf(agent), expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept',
        resolution: 'supersede', reason: '收下' });
      expect(notApplicable).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'resolution_not_applicable' });
      const accepted = await f.platform.notes.reviewNote(user, { commandId: 's4c-d06-accept',
        noteId: idOf(agent), expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '收下' });
      expect(accepted).toMatchObject({ status: 'done', state: 'accepted' });
      expect((await itemOf(f, mineId)).storedState).toBe('superseded');
    });
  });
});

describe('S4C D-07: a scribe cannot withdraw the user note', () => {
  it.each(KINDS)('D-07 %s: forbidden user_confirmed, but the user and the author keep the right', async kind => {
    await withFixture(kind, {}, async f => {
      const user = f.ctx();
      const mine = await f.write(user, general({ topic: 'protected', anchor: FILE_A }), null);
      const mineId = idOf(mine);
      const scribe = await f.claimRun('s4c-d07-scribe', 't3', 'scribe');
      const refused = await f.platform.notes.withdrawNote(f.workCtx(scribe), { commandId: 's4c-d07-refused',
        noteId: mineId, expectedVersion: 1, reason: null });
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'user_confirmed' });
      // The user's own withdraw stays.
      const withdrawn = await f.platform.notes.withdrawNote(user, { commandId: 's4c-d07-user',
        noteId: mineId, expectedVersion: 1, reason: null });
      expect(withdrawn).toMatchObject({ status: 'done', state: 'withdrawn' });
      // A scribe may withdraw its own note.
      const own = await f.write(f.workCtx(scribe), general({ topic: 'scribe-own', anchor: FILE_B }), 's4a-goal');
      const ownWithdraw = await f.platform.notes.withdrawNote(f.workCtx(scribe), { commandId: 's4c-d07-own',
        noteId: idOf(own), expectedVersion: 1, reason: null });
      expect(ownWithdraw).toMatchObject({ status: 'done', state: 'withdrawn' });
    });
  });
});

describe('S4C D-08: same-author revision', () => {
  it.each(KINDS)('D-08 %s: a replaces on the same author pending note withdraws it in the same commit', async kind => {
    await withFixture(kind, { goalQuota: 0 }, async f => {
      const run = f.workCtx(await f.claimRun('s4c-d08'));
      const p1 = await f.write(run, general({ topic: 'p1', anchor: FILE_A }), 's4a-goal');
      expect(p1).toMatchObject({ status: 'pending_review', reasons: ['quota_full'] });
      const p1Id = idOf(p1);
      const p2 = await f.write(run, general({ topic: 'p2', anchor: FILE_A, replaces: [p1Id] }), 's4a-goal');
      expect(p2).toMatchObject({ status: 'pending_review', reasons: ['quota_full'] });
      expect(p2).toMatchObject({ version: 1 });
      const p1Item = await itemOf(f, p1Id);
      expect(p1Item.storedState).toBe('withdrawn');
      expect(p1Item.version).toBe(2);
      const p2Item = await itemOf(f, idOf(p2));
      expect(p2Item.storedState).toBe('pending_review');
      expect(p2Item.version).toBe(1);
    });
  });
});

describe('S4C D-14: the scribe resolves an agent-vs-agent contradiction', () => {
  it.each(KINDS)('D-14 %s: missing resolution is resolution_required; supersede supersedes', async kind => {
    await withFixture(kind, {}, async f => {
      const x = await f.write(f.workCtx(await f.claimRun('s4c-d14-a1')),
        general({ topic: 'x', anchor: FILE_A }), 's4a-goal');
      const y = await f.write(f.workCtx(await f.claimRun('s4c-d14-a2', 't2')),
        general({ topic: 'y', anchor: FILE_A, contradicts: [idOf(x)] }), 's4a-goal');
      expect(y).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
      const scribe = f.workCtx(await f.claimRun('s4c-d14-scribe', 't3', 'scribe'));
      const missing = await f.platform.notes.reviewNote(scribe, { commandId: 's4c-d14-missing',
        noteId: idOf(y), expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '收下' });
      expect(missing).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'resolution_required' });
      const superseded = await f.platform.notes.reviewNote(scribe, { commandId: 's4c-d14-supersede',
        noteId: idOf(y), expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept',
        resolution: 'supersede', reason: '收下并由新版取代' });
      expect(superseded).toMatchObject({ status: 'done', state: 'accepted' });
      expect((await itemOf(f, idOf(x))).storedState).toBe('superseded');
      const yItem = await itemOf(f, idOf(y));
      expect(yItem.coexistWith).toEqual([]);
    });
  });

  it.each(KINDS)('D-14 %s: coexist accepts both and keeps confirmedByUser false', async kind => {
    await withFixture(kind, {}, async f => {
      const c1 = await f.write(f.workCtx(await f.claimRun('s4c-d14-b1')),
        general({ topic: 'c1', anchor: FILE_B }), 's4a-goal');
      const c2 = await f.write(f.workCtx(await f.claimRun('s4c-d14-b2', 't2')),
        general({ topic: 'c2', anchor: FILE_B, contradicts: [idOf(c1)] }), 's4a-goal');
      expect(c2).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
      const scribe = f.workCtx(await f.claimRun('s4c-d14-bscribe', 't3', 'scribe'));
      const coexisted = await f.platform.notes.reviewNote(scribe, { commandId: 's4c-d14-coexist',
        noteId: idOf(c2), expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept',
        resolution: 'coexist', reason: '两条都留' });
      expect(coexisted).toMatchObject({ status: 'done', state: 'accepted' });
      expect((await itemOf(f, idOf(c1))).storedState).toBe('accepted');
      const c2Item = await itemOf(f, idOf(c2));
      expect(c2Item.coexistWith).toEqual([idOf(c1)]);
      expect(c2Item.confirmedByUser).toBe(false);
    });
  });
});

describe('S4C D-15: an outdated pending understanding', () => {
  it.each(KINDS)('D-15 %s: accept is understanding_outdated, reject succeeds', async kind => {
    await withFixture(kind, {}, async f => {
      const run = await f.claimRun('s4c-d15');
      const pending = await f.write(f.workCtx(run),
        understanding(GOAL, { topic: 'u-pending', structural: true }), 's4a-goal', { expectedPointerRevision: null });
      expect(pending).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
      const current = await f.write(f.ctx(), understanding(GOAL, { topic: 'u-current' }), 's4a-goal',
        { expectedPointerRevision: null });
      expect(current.status).toBe('accepted');
      const refused = await f.platform.notes.reviewNote(f.ctx(), { commandId: 's4c-d15-accept',
        noteId: idOf(pending), expectedVersion: 1, expectedPointerRevision: 1, verdict: 'accept', reason: '收下' });
      expect(refused).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'understanding_outdated' });
      const rejected = await f.platform.notes.reviewNote(f.ctx(), { commandId: 's4c-d15-reject',
        noteId: idOf(pending), expectedVersion: 1, expectedPointerRevision: null, verdict: 'reject', reason: '旧稿' });
      expect(rejected).toMatchObject({ status: 'done', state: 'rejected' });
    });
  });
});

describe('S4C D-06 exception: a current understanding is not user_note_replaced', () => {
  it.each(KINDS)('D-06 %s: an agent understanding replacing the user understanding is accepted', async kind => {
    await withFixture(kind, {}, async f => {
      const user = f.ctx();
      const u1 = await f.write(user, understanding(GOAL, { topic: 'u-user' }), 's4a-goal',
        { expectedPointerRevision: null });
      expect(u1.status).toBe('accepted');
      const run = f.workCtx(await f.claimRun('s4c-d06x'));
      const u2 = await f.write(run, understanding(GOAL, { topic: 'u-agent', replaces: [idOf(u1)] }), 's4a-goal',
        { expectedPointerRevision: 1 });
      expect(u2).toMatchObject({ status: 'accepted', reasons: [] });
      expect((await itemOf(f, idOf(u1))).storedState).toBe('superseded');
    });
  });
});

describe('RW-4 a supersede also removes the target from coexistWith', () => {
  it.each(KINDS)('RW-4 %s: a target in both contradicts and coexistWith is superseded and dropped from coexistWith', async kind => {
    await withFixture(kind, {}, async f => {
      // X is a live agent target that note y both contradicts and lists as coexisting.
      const x = await f.write(f.workCtx(await f.claimRun('rw4-x')),
        general({ topic: 'x', anchor: FILE_A }), 's4a-goal');
      const xId = idOf(x);
      const y = await f.write(f.workCtx(await f.claimRun('rw4-y', 't2')),
        general({ topic: 'y', anchor: FILE_A, contradicts: [xId], coexistWith: [xId] }), 's4a-goal');
      const yId = idOf(y);
      expect(y).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
      const scribe = f.workCtx(await f.claimRun('rw4-scribe', 't3', 'scribe'));
      const accepted = await f.platform.notes.reviewNote(scribe, { commandId: 'rw4-accept',
        noteId: yId, expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept',
        resolution: 'supersede', reason: '收下并由新版取代' });
      expect(accepted).toMatchObject({ status: 'done', state: 'accepted' });
      // X is superseded even though it was also in coexistWith...
      expect((await itemOf(f, xId)).storedState).toBe('superseded');
      // ...and the accepted note lists X in replaces, never in coexistWith.
      const yItem = await itemOf(f, yId);
      expect(yItem.replaces).toEqual([xId]);
      expect(yItem.coexistWith).toEqual([]);
    });
  });
});

describe('RW-5 stage continuity in the protection check', () => {
  it.each(KINDS)('RW-5 %s: a stage absent in a middle revision retires the target for the user-reason computation', async kind => {
    await withFixture(kind, {}, async f => {
      const NOTE_STAGE = { stageId: 's-note', title: 'Note stage' };
      const anchor = { kind: 'stage', goalId: 's4a-goal', stageId: 's-note' } as const;
      // p2 adds the note stage S; the work tasks stay on s1, so the revision
      // changes no task's execution definition.
      const p2 = await reviseStages(f, f.plan, [...f.plan.stages, NOTE_STAGE]);
      const execSession = (await f.createSession('rw5-exec', 'executor')).sessionRef;
      const execRun = await claimWithPlan(f, 'exec', execSession, 't1', 'executor', p2.ref);
      // The user's confirmed note on stage S at p2.
      const user = f.ctx();
      const mine = await f.write(user, general({ topic: 'mine', anchor }), 's4a-goal');
      const mineId = idOf(mine);
      expect(mine.status).toBe('accepted');
      // The agent note y contradicts the user note; it is pending for that reason.
      const y = await f.write(f.workCtx(execRun),
        general({ topic: 'y', anchor, contradicts: [mineId] }), 's4a-goal');
      const yId = idOf(y);
      expect(y).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
      // p3 drops S, p4 restores it: continuity over p2..p4 has a gap at p3.
      const p3 = await reviseStages(f, p2, [...f.plan.stages]);
      const p4 = await reviseStages(f, p3, [...f.plan.stages, NOTE_STAGE]);
      const scribeSession = (await f.createSession('rw5-scribe', 'scribe')).sessionRef;
      const scribe = f.workCtx(await claimWithPlan(f, 'scribe', scribeSession, 't3', 'scribe', p4.ref));
      // S is retired for the user-reason computation, so no live contradiction
      // remains: a resolution is not applicable...
      const notApplicable = await f.platform.notes.reviewNote(scribe, { commandId: 'rw5-na',
        noteId: yId, expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept',
        resolution: 'supersede', reason: '收下' });
      expect(notApplicable).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'resolution_not_applicable' });
      // ...and the scribe may accept without the guard refusing it as forbidden.
      const accepted = await f.platform.notes.reviewNote(scribe, { commandId: 'rw5-accept',
        noteId: yId, expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '收下' });
      expect(accepted).toMatchObject({ status: 'done', state: 'accepted' });
    });
  });
});
