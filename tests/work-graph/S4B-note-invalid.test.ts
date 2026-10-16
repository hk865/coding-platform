/**
 * Slice 4B G2 — M-06 invalid staged repair. The repair is written by a real
 * executor Run through the real 4A writer (staged); L9 keys `invalid` on the
 * staged repair's OWN Run's task, not on the note's task anchors.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

async function revisePlan(f: S4BNoteCheckFixture, mutate: (tasks: PlanRevisionDraft['tasks']) => PlanRevisionDraft['tasks'],
  affectedTaskIds: string[]): Promise<void> {
  const ctx = f.ctx();
  const source = f.inner.plan;
  const before = await f.inner.platform.plans.queryGoal(ctx, f.inner.goalRef);
  if (before.status !== 'ready') throw new Error('goal read failed');
  const draftV2: PlanRevisionDraft = {
    schemaVersion: 2, planId: 's4a-plan-2', planRevision: source.planRevision + 1,
    goalId: source.goalRef.goalId, stages: structuredClone(source.stages), tasks: structuredClone(mutate(source.tasks)),
    assignments: structuredClone(source.assignments ?? []), obligations: structuredClone(source.obligations),
    taskHierarchy: structuredClone(source.taskHierarchy), executionDag: structuredClone(source.executionDag),
    taskRelations: [], inputRequirements: [],
  };
  const proposed = await f.inner.platform.plans.proposePlan(ctx, {
    meta: { requestId: `s4b-m06-revise-${source.planRevision}`, expected: [{ ref: f.inner.goalRef, revision: before.value.goal.revision }] },
    input: { goalRef: f.inner.goalRef, basedOn: source.ref,
      reason: { text: 's4b M-06 revise', sources: [], affectedTaskIds }, draft: draftV2 } });
  if (proposed.status !== 'committed') throw new Error(`propose failed: ${JSON.stringify(proposed)}`);
  const after = await f.inner.platform.plans.queryGoal(ctx, f.inner.goalRef);
  if (after.status !== 'ready') throw new Error('goal re-read failed');
  const applied = await f.inner.platform.plans.applyPlanChange(ctx, {
    meta: { requestId: `s4b-m06-apply-${source.planRevision}`, expected: [{ ref: f.inner.goalRef, revision: after.value.goal.revision }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`apply failed: ${JSON.stringify(applied)}`);
}

async function stagedRepair(f: S4BNoteCheckFixture, suffix: string, runTask: string, anchorTask: string):
Promise<{ noteId: string; run: Awaited<ReturnType<S4BNoteCheckFixture['inner']['claimRun']>> }> {
  const run = await f.inner.claimRun(suffix, runTask, 'executor');
  const repair: NoteDraftV1 = { kind: 'repair', topic: `repair-${suffix}`, conclusion: 'repair the task',
    body: 'repair body', anchor: { kind: 'task', goalId: 's4a-goal', taskId: anchorTask },
    extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [] };
  const written = await f.inner.write(f.inner.workCtx(run), repair, 's4a-goal');
  if (written.status === 'rejected') throw new Error(`repair write rejected: ${JSON.stringify(written)}`);
  expect(written.status).toBe('staged');
  return { noteId: written.noteId, run };
}

/** End the Run through the real Host control entry so its task is cancellable. */
async function endRun(f: S4BNoteCheckFixture, run: Awaited<ReturnType<S4BNoteCheckFixture['inner']['claimRun']>>,
  requestId: string): Promise<void> {
  const execution = await f.inner.platform.executions.readExecution(f.ctx(), run);
  if (execution.status !== 'ready') throw new Error(`run read failed: ${JSON.stringify(execution)}`);
  const cancelled = await f.inner.platform.controls.submitControl(f.ctx(), {
    input: { runRef: run, kind: 'cancel', reason: 's4b M-06 end the run before the plan change' },
    meta: { requestId, expected: [{ ref: run, revision: execution.value.run.revision }] } });
  if (cancelled.status !== 'committed') throw new Error(`run cancel failed: ${JSON.stringify(cancelled)}`);
}

describe('S4B M-06 invalid staged repair', () => {
  it.each(['memory', 'sqlite'] as const)('M-06 %s: a staged repair whose own Run task was cancelled is invalid', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const { noteId, run } = await stagedRepair(f, 'm06', 't1', 't1');
      await endRun(f, run, 's4b-m06-run-cancel');
      await revisePlan(f, tasks => tasks.map(task => task.taskId === 't1'
        ? { ...task, disposition: 'cancelled' } : task), ['t1']);
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.invalid).toBe(true);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-06 %s: a staged repair stays valid when only a different anchored task was cancelled', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      // The Run's task is t1; the repair is anchored on t2. Cancelling t2 must
      // NOT make it invalid (L9 keys on the Run's owning task, not the anchor).
      const { noteId } = await stagedRepair(f, 'm06b', 't1', 't2');
      await revisePlan(f, tasks => tasks.map(task => task.taskId === 't2'
        ? { ...task, disposition: 'cancelled' } : task), ['t2']);
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.invalid).toBe(false);
    } finally { await f.close(); }
  });
});
