/**
 * S4C2 §11.5 M-12: the "update due" rows over real records. No reader is mocked.
 *
 * Part 1 (memory and SQLite): the S4A fixture builds a real platform with a real
 * Goal/Plan/Sessions/Runs. The M-12 rows are read through the public note
 * service `platform.notes.memoryLookup`; the T4 trigger (a plan adopted after
 * the understanding) is produced by the real `platform.plans` service, and the
 * T3 trigger by the real `prepare`/`startRun` → `claims.requeueTask` path over
 * the composition's own runtime (the WP2 platform fixture).
 *
 * The `unsupported`-store-fault row (M-12h) lives in
 * `S4C2-m12h-store-fault.test.ts`, over the public read-fault fixture.
 */
import type { NoteAnchorV1, NoteDraftAnchorV1, NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createS4ANoteFixture, type S4ANoteFixture } from '../helpers/S4A-note-fixture.js';
import { createWP2Platform, preparedBundle, type WP2PlatformFixture } from '../helpers/WP2-platform-support.js';

const GOAL = 's4a-goal';
const GOAL_KEY = `goal:${GOAL}`;
const STAGE_KEY = `stage:${GOAL}/1/s1`;

function sections(): NoteSectionsV1 {
  return { status: 's', decided: 'd', open: 'o', next: 'n', risks: 'r' };
}

function understanding(anchor: NoteDraftAnchorV1, conclusion: string): NoteDraftV1 {
  return { kind: 'understanding', topic: 'understanding', conclusion, anchor, extraAnchors: [],
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
    sections: sections() };
}

const lookupOf = (f: S4ANoteFixture, anchor: NoteAnchorV1) =>
  f.platform.notes.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor, limit: 20, cursor: null });

/**
 * Adopt a second plan revision through the real plan service with the tasks
 * UNCHANGED, so the only new T4 trigger is `plan:p2` (never a `task_end`).
 */
async function adoptUnchangedSecondPlan(f: S4ANoteFixture): Promise<void> {
  const base = f.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${base.planId}-2`, planRevision: base.planRevision + 1, goalId: GOAL,
    stages: base.stages,
    tasks: base.tasks,
    ...(base.assignments === undefined ? {} : { assignments: base.assignments }),
    obligations: base.obligations,
    taskHierarchy: base.taskHierarchy,
    executionDag: base.executionDag,
  };
  const proposed = await f.platform.plans.proposePlan(f.ctx(), {
    meta: { requestId: 's4c2-p2-propose', expected: [] },
    input: { goalRef: f.goalRef, basedOn: base.ref, draft, reason: { text: 'adopt unchanged plan 2', sources: [] } },
  });
  if (proposed.status !== 'committed') throw new Error(`propose failed: ${JSON.stringify(proposed)}`);
  const applied = await f.platform.plans.applyPlanChange(f.ctx(), {
    meta: { requestId: 's4c2-p2-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
  });
  if (applied.status !== 'committed') throw new Error(`apply failed: ${JSON.stringify(applied)}`);
}

describe.each(['memory', 'sqlite'] as const)('S4C2 M-12 update due over the public note service (%s)', kind => {
  let f: S4ANoteFixture;
  beforeEach(async () => { f = await createS4ANoteFixture(kind); });
  afterEach(async () => { await f.close(); });

  it('M-12-1 (accept): an accepted understanding with no later trigger is not due', async () => {
    const written = await f.write(f.ctx(), understanding({ kind: 'goal', goalId: GOAL }, 'goal now'), GOAL);
    if (written.status === 'rejected') throw new Error(JSON.stringify(written));
    const read = await lookupOf(f, { kind: 'goal', goalId: GOAL });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.understanding).toEqual({ anchorKey: GOAL_KEY,
      pointer: { noteId: written.noteId, revision: 1 }, updateDue: false, latestTriggerCursor: null });
  });

  it('M-12-1b (review): a reviewed understanding with no later trigger is not due', async () => {
    const written = await f.write(f.ctx(), understanding({ kind: 'goal', goalId: GOAL }, 'reviewed now'), GOAL);
    if (written.status === 'rejected') throw new Error(JSON.stringify(written));
    const reviewed = await f.platform.notes.reviewNote(f.ctx(), { commandId: 's4c2-review-1',
      noteId: written.noteId, expectedVersion: written.version, expectedPointerRevision: 1,
      verdict: 'review', reason: null });
    expect(reviewed).toMatchObject({ status: 'done', state: 'reviewed' });
    const read = await lookupOf(f, { kind: 'goal', goalId: GOAL });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.understanding).toMatchObject({ anchorKey: GOAL_KEY,
      pointer: { noteId: written.noteId }, updateDue: false, latestTriggerCursor: null });
  });

  it('M-12-withdraw (rework item 5): a withdrawn understanding is absent, so no plan trigger counts', async () => {
    const written = await f.write(f.ctx(), understanding({ kind: 'goal', goalId: GOAL }, 'withdrawn now'), GOAL);
    if (written.status === 'rejected') throw new Error(JSON.stringify(written));
    const withdrawn = await f.platform.notes.withdrawNote(f.ctx(), { commandId: 's4c2-withdraw-1',
      noteId: written.noteId, expectedVersion: written.version, reason: 'no longer current' });
    expect(withdrawn).toMatchObject({ status: 'done', state: 'withdrawn' });
    const read = await lookupOf(f, { kind: 'goal', goalId: GOAL });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    // The plan p1 trigger precedes the withdrawn note; with the old
    // `includePlanTrigger: head !== null` rule it still fired, giving
    // `updateDue: true, 'plan:p1'`. It must not.
    expect(read.value.understanding).toEqual({ anchorKey: GOAL_KEY,
      pointer: { noteId: written.noteId, revision: 1 }, updateDue: false, latestTriggerCursor: null });
  });

  it('M-12-stage: a stage understanding with no later trigger is not due', async () => {
    const written = await f.write(f.ctx(), understanding({ kind: 'stage', goalId: GOAL, stageId: 's1' }, 'stage now'), GOAL);
    if (written.status === 'rejected') throw new Error(JSON.stringify(written));
    const read = await lookupOf(f, { kind: 'stage', goalId: GOAL, planRevision: f.plan.planRevision, stageId: 's1' });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.understanding).toMatchObject({ anchorKey: STAGE_KEY,
      pointer: { noteId: written.noteId }, updateDue: false, latestTriggerCursor: null });
  });

  it('M-12d (T4): adopting an unchanged plan revision 2 after the understanding is due at plan:p2', async () => {
    const written = await f.write(f.ctx(), understanding({ kind: 'goal', goalId: GOAL }, 'goal now'), GOAL);
    if (written.status === 'rejected') throw new Error(JSON.stringify(written));
    await adoptUnchangedSecondPlan(f);
    const read = await lookupOf(f, { kind: 'goal', goalId: GOAL });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.understanding).toMatchObject({ anchorKey: GOAL_KEY,
      pointer: { noteId: written.noteId, revision: 1 }, updateDue: true, latestTriggerCursor: 'plan:p2' });
  });
});

/**
 * T3 (M-12a/c): the `task_end`/`rework` row through the real owners. The WP2
 * platform fixture's `prepare` → `runtime.startRun` runs a real (crashed) Run,
 * `claims.requeueTask` writes the real TaskRequeue, and the goal anchor is read
 * back through `platform.notes.memoryLookup`. The opt-in `advancingClock` makes
 * the requeue instant strictly later than the understanding's creation.
 */
describe.each(['memory', 'sqlite'] as const)('S4C2 M-12 T3 rework over the public runtime (%s)', kind => {
  let f: WP2PlatformFixture;
  beforeEach(async () => {
    f = await createWP2Platform({
      kind, duty: 'secretary', allowAnyRun: true, ownedHost: true, advancingClock: true,
      scriptedReplies: [{ kind: 'text', text: 'M-12 T3 attempt' }],
      beforeReply: async () => { throw new Error('M-12 T3 first attempt fails'); },
    });
  });
  afterEach(async () => { await f.close(); });

  it('M-12a/c: a real rework after the understanding makes the goal anchor due', async () => {
    const goalId = f.goalRef.goalId;
    const written = await f.platform.notes.writeNote(f.ctx, { commandId: 'm12-t3-understanding',
      note: understanding({ kind: 'goal', goalId }, 'goal now'), expectedPointerRevision: null, goalId });
    expect(written.status).toBe('accepted');
    if (written.status !== 'accepted') return;

    const { prepared } = await preparedBundle(f, f.runRef!, 'm12-t3-prepare');
    const started = await f.platform.runtime.startRun(f.ctx, { prepared,
      consumerId: 'm12-t3-driver', requestId: 'm12-t3-start' });
    expect(started.status).toBe('ready');
    const crashed = await f.platform.executions.readExecution(f.ctx, f.runRef!);
    if (crashed.status !== 'ready') throw new Error(`M-12 T3 run read: ${JSON.stringify(crashed)}`);
    expect(crashed.value.run).toMatchObject({ status: 'ended', outcome: 'crashed' });

    const goal = await f.platform.plans.queryGoal(f.ctx, f.goalRef);
    if (goal.status !== 'ready') throw new Error(`M-12 T3 goal read: ${JSON.stringify(goal)}`);
    const requeueTask = f.platform.claims.requeueTask;
    if (requeueTask === undefined) throw new Error('the platform does not expose the requeue owner');
    const requeued = await requeueTask.call(f.platform.claims, f.ctx, {
      input: { taskRef: crashed.value.outbox.claim.task, afterRunRef: f.runRef!,
        reason: 'M-12 T3 retry', newInputRefs: [] },
      meta: { requestId: 'm12-t3-requeue', expected: [
        { ref: f.goalRef, revision: goal.value.goal.revision },
        { ref: f.runRef!, revision: crashed.value.run.revision }] },
    });
    expect(requeued).toMatchObject({ status: 'committed' });
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
      throw new Error(`M-12 T3 requeue: ${JSON.stringify(requeued)}`);
    }

    const read = await f.platform.notes.memoryLookup(f.ctx, { v: 1, op: 'lookup',
      anchor: { kind: 'goal', goalId }, limit: 20, cursor: null });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const taskId = crashed.value.outbox.claim.task.taskId;
    expect(read.value.understanding).toMatchObject({ anchorKey: `goal:${goalId}`,
      pointer: { noteId: written.noteId, revision: 1 }, updateDue: true,
      latestTriggerCursor: `rework:${taskId}/${f.runRef!.runId}` });
  });
});
