/**
 * Slice 4C-2 rework 4 item 2 (verify Fix 2): the reason-facts path reuses the
 * call's ONE plan window for TASK targets, like the stage branch already does,
 * and (Ruling B) a task target whose goal lives in another Workspace of the SAME
 * project is evaluated from that goal's plan window instead of being forbidden.
 * The write path and `anchorFactsOf` stay untouched (RW-12a/b are the guard).
 *
 * T1 counts reads: the ONLY double is the accepted counting wrapper around the
 * real record backend factories plus a wrapper on the production note-card
 * source's `readPage`; contents are never read. T3/T4 are behaviour over the
 * real fixture through public writes, the real Plan revision, the public queue
 * and `readDecisionCard`. Expected values are literal and hand-computed.
 */
import { expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { NoteDraftAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import * as decisionReadModelModule from '../../src/core/work-graph/views/decision-read-model.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';
import {
  createS4C2NoteCardFixture, generalNote, noteCardKey, noteCardSource,
  type S4C2NoteCardFixture, type S4C2NoteCardFixtureKind,
} from '../helpers/S4C2-note-card-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const CARD_KINDS: readonly S4C2NoteCardFixtureKind[] = ['memory', 'sqlite'];
const GOAL = 's4a-goal';
const FILE_A = { kind: 'file', path: 'src/a/x.ts' } as const;

const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'default topic', conclusion: 'default conclusion', anchor: FILE_A,
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
    coexistWith: [], body: 'body', ...overrides,
  } as NoteDraftV1;
}

/**
 * Adopt one more Plan revision through the public Plan services, changing only
 * task dispositions/phases (the fixture's own `reviseNoteStages` cannot move a
 * disposition). Mirrors `S4B-note-invalid.test.ts:11-35`.
 */
async function reviseTasks(platform: S4ANoteFixture['platform'], ctx: CoreCallContext, goalRef: GoalRef,
  mutate: (tasks: PlanRevisionSnapshot['tasks']) => PlanRevisionSnapshot['tasks'],
  affectedTaskIds: string[], tag: string): Promise<PlanRevisionSnapshot> {
  const graph = await platform.plans.queryTaskGraph(ctx, { goalRef });
  if (graph.status !== 'ready') throw new Error(`${tag} graph read failed: ${JSON.stringify(graph)}`);
  const source = graph.value.plan;
  const before = await platform.plans.queryGoal(ctx, goalRef);
  if (before.status !== 'ready') throw new Error(`${tag} goal read failed: ${JSON.stringify(before)}`);
  const revision = source.planRevision + 1;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${tag}-plan-${String(revision)}`, planRevision: revision,
    goalId: goalRef.goalId, stages: structuredClone(source.stages),
    tasks: structuredClone(mutate(source.tasks)),
    assignments: structuredClone(source.assignments ?? []), obligations: structuredClone(source.obligations),
    taskHierarchy: structuredClone(source.taskHierarchy), executionDag: structuredClone(source.executionDag),
    taskRelations: [], inputRequirements: [],
  };
  const proposed = await platform.plans.proposePlan(ctx, {
    meta: { requestId: `${tag}-propose-${String(revision)}`,
      expected: [{ ref: goalRef, revision: before.value.goal.revision }] },
    input: { goalRef, basedOn: source.ref,
      reason: { text: `${tag} revise tasks`, sources: [], affectedTaskIds }, draft } });
  if (proposed.status !== 'committed') throw new Error(`${tag} propose failed: ${JSON.stringify(proposed)}`);
  const after = await platform.plans.queryGoal(ctx, goalRef);
  if (after.status !== 'ready') throw new Error(`${tag} goal re-read failed: ${JSON.stringify(after)}`);
  const applied = await platform.plans.applyPlanChange(ctx, {
    meta: { requestId: `${tag}-apply-${String(revision)}`,
      expected: [{ ref: goalRef, revision: after.value.goal.revision }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`${tag} apply failed: ${JSON.stringify(applied)}`);
  return applied.value;
}

// ---------------------------------------------------------------------------
// T1 (§11.7 note-card row / §12.7): the card source already read the Goal's
// window, so the two TASK targets of the pending note must reuse it.
//
// Hand-computed, for g1 during the ONE queue call:
//   plan window 1 = readNoteDecisions' Goal -> active Plan window (Goal 1,
//                   PlanRevision 1); both task targets reuse it.
//   RED on the old code: each task target's readAnchorGoalFacts reads the Goal
//   itself and then readGoalPlanWindow (Goal + PlanRevision):
//     Goal 1 + 2 x 2 = 5, PlanRevision 1 + 2 x 1 = 3.
// ---------------------------------------------------------------------------
type TaskWindowKinds = { goal: number; plan: number };

async function createTaskWindowCountFixture(kind: S4ANoteFixtureKind):
Promise<{ f: S4ANoteFixture; state: { active: boolean; kinds: TaskWindowKinds } }> {
  const state = { active: false, kinds: { goal: 0, plan: 0 } };
  const memoryBackend = await import('../../src/core/record-store/in-memory-record-store.js');
  const sqliteBackend = await import('../../src/core/record-store/sqlite-record-store.js');
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const classify = (refKeys: readonly string[]): void => {
    if (!state.active || refKeys.length === 0) return;
    if (refKeys.some(key => key.includes('"aggregateType":"Goal"'))) state.kinds.goal += 1;
    if (refKeys.some(key => key.includes('"aggregateType":"PlanRevision"'))) state.kinds.plan += 1;
  };
  const wrap = <T,>(backend: T): T => {
    const records = (backend as unknown as { records: { readMany(refKeys: readonly string[]): unknown } }).records;
    return { ...(backend as object), records: { ...records,
      async readMany(refKeys: readonly string[]) {
        classify(refKeys);
        return (records.readMany as (keys: readonly string[]) => unknown)(refKeys);
      } } } as unknown as T;
  };
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(options => wrap(originalMemory(options)) as never);
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(options => wrap(originalSqlite(options)) as never);
  const originalCardSource = decisionReadModelModule.createNoteReviewCardSource;
  const cardSpy = vi.spyOn(decisionReadModelModule, 'createNoteReviewCardSource').mockImplementation(deps => {
    const real = originalCardSource(deps);
    return { ...real,
      async readPage(ctx, input) {
        state.active = true;
        try { return await real.readPage(ctx, input); } finally { state.active = false; }
      } };
  });
  let f: S4ANoteFixture;
  try { f = await createS4ANoteFixture(kind, {}); }
  finally { memorySpy.mockRestore(); sqliteSpy.mockRestore(); cardSpy.mockRestore(); }
  return { f, state };
}

it.each(KINDS)('T1 %s: two TASK targets of one goal share the card source\'s one plan window', async kind => {
  const { f, state } = await createTaskWindowCountFixture(kind);
  try {
    const host = f.ctx();
    const t1Anchor: NoteDraftAnchorV1 = { kind: 'task', goalId: GOAL, taskId: 't1' };
    const t2Anchor: NoteDraftAnchorV1 = { kind: 'task', goalId: GOAL, taskId: 't2' };
    const host1 = await f.write(host, general({ topic: 'host t1', anchor: t1Anchor }), GOAL);
    const host2 = await f.write(host, general({ topic: 'host t2', anchor: t2Anchor }), GOAL);
    expect(host1).toMatchObject({ status: 'accepted', confirmedByUser: true });
    expect(host2).toMatchObject({ status: 'accepted', confirmedByUser: true });

    // A real Run on t1 writes the pending agent note: main anchor goal g1, the
    // two task anchors as extras, replacing both host notes (both are reasons).
    const pending = await f.write(f.workCtx(await f.claimRun('task-window-pending', 't1')), general({
      kind: 'decision', topic: 'pending', anchor: { kind: 'goal', goalId: GOAL },
      extraAnchors: [t1Anchor, t2Anchor], replaces: [idOf(host1), idOf(host2)],
    }), GOAL);
    expect(pending).toMatchObject({ status: 'pending_review',
      reasons: ['user_note_replaced'] });

    state.kinds = { goal: 0, plan: 0 };
    const read = await f.platform.decisions.queryDecisionQueue(f.ctx(), {
      workspace: f.scope, sections: ['waiting_answer'], goalRef: f.goalRef, page: { limit: 100 },
    });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.waitingAnswer.filter(card => card.source.kind === 'note_review')).toHaveLength(1);
    // The two task targets never re-read the goal window: the plan window is
    // one Goal + one PlanRevision. The SECOND Goal is the decision reader's
    // `readGoalForBasis` (decision-read-model.ts:361, a card-basis read, not the
    // plan window); it is why the book's "Goal 1" reads 2 here. The removed
    // term is exactly the targets' 2 x (2 Goal + 1 PlanRevision): 6/3 -> 2/1.
    expect(state.kinds).toEqual({ goal: 2, plan: 1 });
  } finally { await f.close(); }
});

// ---------------------------------------------------------------------------
// T3 (PC-plan variant): a reused ctx cannot carry a plan window across calls.
// The first accept sees the live contradiction (resolution_required); after a
// public Plan revision cancels t2 the second accept sees the retired target and
// answers resolution_not_applicable.
// ---------------------------------------------------------------------------
it.each(KINDS)('T3 %s: a task target retired by the next Plan revision is not resolution_applicable', async kind => {
  const f = await createS4ANoteFixture(kind, {});
  try {
    const t2Anchor: NoteDraftAnchorV1 = { kind: 'task', goalId: GOAL, taskId: 't2' };
    // ONE Run on t1 writes both notes, so t2 itself has no live Run when it is
    // cancelled by the public Plan revision below.
    const authorCtx = f.workCtx(await f.claimRun('tw-t3-author', 't1'));
    const target = await f.write(authorCtx,
      general({ topic: 'tw-t3-target', anchor: t2Anchor }), GOAL);
    expect(target).toMatchObject({ status: 'accepted' });
    const pending = await f.write(authorCtx, general({
      kind: 'decision', topic: 'tw-t3-pending', anchor: t2Anchor, contradicts: [idOf(target)],
    }), GOAL);
    expect(pending).toMatchObject({ status: 'pending_review' });
    const scribeCtx = f.workCtx(await f.claimRun('tw-t3-scribe', 't3', 'scribe'));
    const first = await f.platform.notes.reviewNote(scribeCtx, { commandId: 'tw-t3-first',
      noteId: idOf(pending), expectedVersion: 1, expectedPointerRevision: null,
      verdict: 'accept', reason: '收下' });
    // The contradicted agent note is still current, so the scribe must resolve.
    expect(first).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'resolution_required' });

    await reviseTasks(f.platform, f.ctx(), f.goalRef,
      tasks => tasks.map(task => task.taskId === 't2' ? { ...task, disposition: 'cancelled' as const } : task),
      ['t2'], 'tw-t3-cancel');

    // The SAME ctx object: no plan window survives from the first disposition.
    const second = await f.platform.notes.reviewNote(scribeCtx, { commandId: 'tw-t3-second',
      noteId: idOf(pending), expectedVersion: 1, expectedPointerRevision: null,
      verdict: 'accept', resolution: 'supersede', reason: '收下' });
    expect(second).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'resolution_not_applicable' });
  } finally { await f.close(); }
});

// ---------------------------------------------------------------------------
// T4a (D-rows style): a task target whose own task is cancelled through the
// public Plan revision stops being a live user reason, so the card closes as
// source_resolved and leaves the queue. (The fixture's t2 starts cancelled, so
// the test first makes it active through the same public route.)
// ---------------------------------------------------------------------------
it.each(CARD_KINDS)('T4a %s: cancelling the task target closes its card as source_resolved', async kind => {
  const f: S4C2NoteCardFixture = await createS4C2NoteCardFixture(kind);
  try {
    await reviseTasks(f.platform, f.ctx(), f.goalRef,
      tasks => tasks.map(task => task.taskId === 't2' ? { ...task, disposition: 'active' as const } : task),
      ['t2'], 'tw-t4a-activate');
    const t2Anchor: NoteDraftAnchorV1 = { kind: 'task', goalId: f.goalRef.goalId, taskId: 't2' };
    const user = await f.writeUser(generalNote({ topic: 'tw-t4a-user', anchor: t2Anchor }), f.goalRef.goalId);
    expect(user).toMatchObject({ status: 'accepted', confirmedByUser: true });
    const agent = await f.writeAgent(f.executor, generalNote({ kind: 'decision', topic: 'tw-t4a-agent',
      anchor: t2Anchor, conclusion: 'agent note', contradicts: [idOf(user)] }), f.goalRef.goalId);
    expect(agent).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
    const agentId = idOf(agent);
    expect(await f.cardOf(agentId)).not.toBeNull();

    await reviseTasks(f.platform, f.ctx(), f.goalRef,
      tasks => tasks.map(task => task.taskId === 't2' ? { ...task, disposition: 'cancelled' as const } : task),
      ['t2'], 'tw-t4a-cancel');

    // The user reason died with the task, so the card is not waiting any more.
    expect(await f.waitingCards({ goalRef: f.goalRef })).toEqual([]);
    expect(await f.cardOf(agentId)).toBeNull();
    expect(await f.readCard(agentId)).toMatchObject({ state: 'closed', closedReason: 'source_resolved' });
  } finally { await f.close(); }
});

// ---------------------------------------------------------------------------
// T4b (Ruling B): a W2 task target anchored to the W1 goal s4a-goal (same
// project) must be evaluated from that goal's plan window, not forbidden. The
// W2 pending note replaces a W1 user note; the user reason stays live while the
// W1 task is active (to-dos skip the note, the W2 card waits), and disappears
// after the W1 task is cancelled (to-dos count the note, the card closes
// source_resolved).
// ---------------------------------------------------------------------------
const W2 = 's4c2-second-workspace';
const W2_GOAL = 's4c2-second-goal';

async function createSecondWorkspaceGoal(f: S4C2NoteCardFixture): Promise<{
  hostCtx: CoreCallContext; workCtx: CoreCallContext; goalRef: GoalRef;
  workspaceRef: { aggregateType: 'Workspace'; projectId: string; workspaceId: string };
}> {
  const w1 = f.ctx();
  const hostCtx: CoreCallContext = { ...w1, workspaceId: W2,
    materialReader: { kind: 'host', projectId: f.scope.projectId, workspaceId: W2,
      actor: { kind: 'human', id: 's4a-scope-operator' } } };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId: f.scope.projectId, workspaceId: W2 };
  const registered = await f.platform.projects.registerWorkspace(hostCtx, {
    meta: { requestId: 'tw-w2-register', expected: [
      { ref: f.projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] },
    input: { workspace: { projectId: f.scope.projectId, workspaceId: W2 } },
  });
  if (registered.status !== 'committed') throw new Error(`W2 registration failed: ${JSON.stringify(registered)}`);

  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: f.scope.projectId, goalId: W2_GOAL };
  const created = await f.platform.goals.createGoal(hostCtx, {
    meta: { requestId: 'tw-w2-goal', expected: [
      { ref: f.projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: W2_GOAL, workspace: { projectId: f.scope.projectId, workspaceId: W2 },
      objective: 'S4C2 second-workspace goal' },
  });
  if (created.status !== 'committed') throw new Error(`W2 goal failed: ${JSON.stringify(created)}`);

  const planId = 's4c2-second-plan';
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId, planRevision: 1, goalId: W2_GOAL,
    stages: [{ stageId: 'w2-s1', title: 'W2 stage' }],
    tasks: [{ taskId: 'w2-task', stageId: 'w2-s1', title: 'W2 work', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'w2-gate', title: 'W2 gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [{ taskId: 'w2-task', role: 'platform-executor', instruction: 'Execute w2-task' }],
    obligations: [{ obligationId: 'w2-o1', title: 'Deliver W2', requirementLevel: 'required',
      taskIds: ['w2-task', 'w2-gate'], verificationRequirements: [{ requirementId: 'w2-v1',
        requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
  const proposed = await f.platform.plans.proposePlan(hostCtx, {
    meta: { requestId: 'tw-w2-plan-propose', expected: [{ ref: goalRef, revision: 1 }] },
    input: { goalRef, basedOn: null, draft, reason: { text: 'S4C2 W2 plan', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error(`W2 propose failed: ${JSON.stringify(proposed)}`);
  const applied = await f.platform.plans.applyPlanChange(hostCtx, {
    meta: { requestId: 'tw-w2-plan-apply', expected: [{ ref: goalRef, revision: 1 }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`W2 apply failed: ${JSON.stringify(applied)}`);

  const admitted = await f.platform.sessions.admitSessionCreation(hostCtx, {
    meta: { requestId: 'tw-w2-admit', expected: [] },
    input: { workspace: { projectId: f.scope.projectId, workspaceId: W2 },
      kernelStore: { adapterId: 's4a-kernel', storeKey: 's4a-kernel-store' },
      role: { kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' },
      recommendedRefs: [], initialLinks: [] } });
  if (admitted.status !== 'committed') throw new Error(`W2 admit failed: ${JSON.stringify(admitted)}`);
  const admittedValue = admitted.value as unknown as {
    action: { plannedSessionRef: { projectId: string; sessionId: string } };
    ref: { projectId: string; sessionId: string } };
  const kernelSessionId = 'tw-w2-kernel-session';
  await f.platform.kernelStores.withStore('s4a-kernel', store => store.create({
    sessionId: kernelSessionId, recordId: 'tw-w2-kernel-record',
    createdAt: '2026-10-15T03:00:00.000Z',
  }, { signal: hostCtx.signal }));
  const registeredSession = await f.platform.sessions.recordSessionCreated(hostCtx, {
    meta: { requestId: 'tw-w2-record', expected: [] },
    input: { operationRef: admittedValue.ref as never, sessionRef: admittedValue.action.plannedSessionRef,
      adapterId: 's4a-kernel', kernelSessionId, historyCursor: null, observedAt: '2026-10-15T03:00:00.000Z' } });
  if (registeredSession.status !== 'committed') throw new Error(`W2 record failed: ${JSON.stringify(registeredSession)}`);
  const sessionRef = registeredSession.value.ref as { projectId: string; sessionId: string };
  const goal = await f.platform.plans.queryGoal(hostCtx, goalRef);
  if (goal.status !== 'ready') throw new Error('W2 goal read failed');
  const card = await f.platform.sessions.readSession(hostCtx, sessionRef);
  if (card.status !== 'ready') throw new Error('W2 session read failed');
  const claimed = await f.platform.claims.claimTask(hostCtx, {
    input: { goalRef, planRef: applied.value.ref, taskId: 'w2-task',
      sessionRef: sessionRef as never, budget: { tokenBudget: 100000, deadline: null },
      roleBinding: { schemaVersion: 1, bindingId: 'tw-w2-binding', templateId: 'platform-executor',
        templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'legacy-template' } },
    meta: { requestId: 'tw-w2-claim', expected: [
      { ref: goalRef, revision: goal.value.goal.revision },
      { ref: workspaceRef, revision: 1 },
      { ref: { ...sessionRef, aggregateType: 'Session' as const }, revision: card.value.record.revision }] } });
  if (claimed.status !== 'committed') throw new Error(`W2 claim failed: ${JSON.stringify(claimed)}`);
  const workCtx: CoreCallContext = { ...f.workCtx(claimed.value.runRef as never), workspaceId: W2 };
  return { hostCtx, workCtx, goalRef, workspaceRef };
}

it.each(CARD_KINDS)('T4b %s: a same-project other-workspace task target uses its goal window, not forbidden', async kind => {
  const f: S4C2NoteCardFixture = await createS4C2NoteCardFixture(kind);
  try {
    const w1User = await f.writeUser(generalNote({ topic: 'tw-t4b-w1-user',
      anchor: { kind: 'task', goalId: f.goalRef.goalId, taskId: 't1' },
      extraAnchors: [{ kind: 'module', moduleId: 'A' }] }), f.goalRef.goalId);
    expect(w1User).toMatchObject({ status: 'accepted', confirmedByUser: true });

    const second = await createSecondWorkspaceGoal(f);
    const pending = await f.platform.notes.writeNote(second.workCtx, { commandId: 'tw-t4b-w2-note',
      note: generalNote({ kind: 'decision', topic: 'tw-t4b-w2-pending',
        anchor: { kind: 'module', moduleId: 'A' }, conclusion: 'W2 agent note',
        replaces: [idOf(w1User)] }), expectedPointerRevision: null, goalId: W2_GOAL });
    expect(pending).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'] });
    const w2NoteId = idOf(pending);

    // Ruling B: the W2 queue reads the W1 task target from the W1 goal window.
    const queue = await f.platform.decisions.queryDecisionQueue(second.hostCtx, {
      workspace: { projectId: f.scope.projectId, workspaceId: W2 }, sections: ['waiting_answer'],
      page: { limit: 100 } });
    expect(queue.status).toBe('ready');
    if (queue.status !== 'ready') return;
    expect(queue.value.waitingAnswer.filter(card => card.source.kind === 'note_review')
      .map(card => card.source.key)).toEqual([noteCardKey(f.scope.projectId, w2NoteId, 1)]);

    // The W1 task is active, so the replaced user note is a live user reason:
    // the W2 to-dos do NOT count the note (it is the user's card to answer).
    const before = await f.platform.notes.readScribeTodos(second.hostCtx, { goalIds: [W2_GOAL] });
    expect(before.status).toBe('ready');
    if (before.status !== 'ready') return;
    expect(before.value.find(row => row.goalId === W2_GOAL)?.pending.map(todo => todo.identity)).toEqual([]);

    // Cancel the W1 task through the public Plan revision (its fixture Run on t1
    // is ended first, as an active Run can block a Task disposition change).
    const s0Run = f.scribe.runRef;
    const execution = await f.platform.executions.readExecution(f.ctx(), s0Run);
    if (execution.status !== 'ready') throw new Error('W1 run read failed');
    const stopped = await f.platform.controls.submitControl(f.ctx(), {
      input: { runRef: s0Run, kind: 'cancel', reason: 'tw-t4b end the t1 run before the plan change' },
      meta: { requestId: 'tw-t4b-run-cancel', expected: [{ ref: s0Run, revision: execution.value.run.revision }] } });
    expect(stopped.status).toBe('committed');
    await reviseTasks(f.platform, f.ctx(), f.goalRef,
      tasks => tasks.map(task => task.taskId === 't1' ? { ...task, disposition: 'cancelled' as const } : task),
      ['t1'], 'tw-t4b-cancel');

    // The W1 task is retired, so the W2 to-dos count the note and its card closes.
    const after = await f.platform.notes.readScribeTodos(second.hostCtx, { goalIds: [W2_GOAL] });
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') return;
    expect(after.value.find(row => row.goalId === W2_GOAL)?.pending.map(todo => todo.identity)).toEqual([`${w2NoteId}@1`]);
    const closedQueue = await f.platform.decisions.queryDecisionQueue(second.hostCtx, {
      workspace: { projectId: f.scope.projectId, workspaceId: W2 }, sections: ['waiting_answer'],
      page: { limit: 100 } });
    expect(closedQueue.status).toBe('ready');
    if (closedQueue.status !== 'ready') return;
    expect(closedQueue.value.waitingAnswer.filter(card => card.source.kind === 'note_review')).toEqual([]);
    const card = await f.platform.decisions.readDecisionCard(second.hostCtx, {
      source: noteCardSource(f.scope.projectId, w2NoteId, 1, second.goalRef) });
    expect(card).toMatchObject({ status: 'ready', value: { state: 'closed', closedReason: 'source_resolved' } });
  } finally { await f.close(); }
});
