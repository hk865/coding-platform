/**
 * A.2 step 6, scenario A8, the C8 cases (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" A8 row,
 * §12.10 A8-R1/A8-R2; §12.2 W-21, W-22; §12.1 step 6b, LA-6; ND-8): the automatic rework across a Host
 * restart, on rebuilt Hosts over one SQLite ledger and Kernel store, with scripted model replies.
 *
 * - A8-R1 (W-21): the crash comes after the automatic requeue committed and before its claim. The
 *   reconcile writes nothing for a TaskRequeue; the start-up re-drive (on) claims with the `requeueRef`
 *   in the afterRun's reusable Session, exactly one new Run; off, nothing runs until a 推进. The W-21
 *   Session choice "occupied → skip this round" is driven with a QueryRun claimed on that Session (the
 *   restart then closes it, Q-01, and the re-drive claims there).
 * - A8-R2 (W-22): a committed `no_new_basis` refusal survives the restart: the verdict stays stopped, the
 *   re-drive does not select the Goal, a 推进 writes nothing.
 *
 * Every step that changes records is followed by the §11 invariant check; every case ends with another
 * start on the same data that changes and writes nothing. No real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_ROLE_BINDING, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { claimQueryOn } from '../helpers/A2-restart-fixture.js';
import { assertInvariants, cleanupScenarios, openHostScenario, waitFor } from './harness.js';
import { editThenText, execution, redrivePolicy, replayOf, stepOf } from './support/common.js';
import { expectQuietHarnessRestart, performedOf, RUN1_WITHOUT_FILE } from './support/restart.js';

afterEach(cleanupScenarios);

it('A8-R1 (W-21, C8, LA-6): a crash between the automatic requeue and its claim; the start-up re-drive claims with the requeueRef (exactly one new Run), off waits for a workflow/advance; an occupied claim Session skips the Task until it is free', async () => {
  for (const resumeOnStartup of [false, true]) {
    const label = `a8-r1-${String(resumeOnStartup)}`;
    const h = await openHostScenario({ automation: redrivePolicy(resumeOnStartup), script: { replies: [RUN1_WITHOUT_FILE, ...editThenText(label)] } });
    // Run 1 FAILs; the Workflow commits the automatic requeue (check_failed #1) and stops before the claim.
    const toClaim = await h.advance(h.select(label, AG2B_WORK_TASK_ID), { stopBefore: (input) => input.kind === 'perform'
      && input.operation.kind === 'claim_task' && (h.lastWorld?.requeues.length ?? 0) === 1 });
    expect(toClaim.state).toBe('stopped');
    const requeue = h.lastWorld?.requeues[0];
    if (requeue === undefined) throw new Error('the automatic requeue must be committed');
    expect(requeue).toMatchObject({ failureClass: 'check_failed', automation: { automatic: true, counted: true, autoCount: 1 } });
    const run1Ref = requeue.afterRunRef;
    const s1 = (await execution(h, run1Ref)).session;
    expect(await h.taskRow()).toMatchObject({ effectivePhase: 'pending', phaseCause: { code: 'requeued' },
      failure: { automation: { verdict: { kind: 'claim_requeued' } } } });
    if (resumeOnStartup) {
      // W-21 "被占用 → 本轮跳过": a QueryRun claimed on Run 1's Session makes the Workflow skip the Task, writing nothing.
      const occupied = await claimQueryOn(h.host, s1, 'a8-r1-busy', AG2B_WORK_ROLE_BINDING);
      expect(occupied.claim).toMatchObject({ status: 'committed' });
      await assertInvariants(h, 'a8-r1 Session occupied', stepOf(h, 'other', 'a8-r1 Session occupied'));
      const before = h.counts();
      expect(await h.advance(h.select(`${label}-busy`, AG2B_WORK_TASK_ID))).toMatchObject({ state: 'waiting', receipts: [] });
      expect(h.counts()).toEqual(before);
    }
    const atCrash = h.counts();

    // The crash between Workflow steps. Nothing is reconciled for the requeue (W-21); 6b condition (a) selects the Goal.
    const report = await h.restart({ crash: true });
    expect(report.report, label).toMatchObject({ runs: [], checks: [], problems: [],
      redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }] });
    if (!resumeOnStartup) {
      expect(report.report?.queries).toEqual([]);
      expect(h.counts(), 'the reconcile writes nothing for a TaskRequeue').toEqual(atCrash);
      expect(await h.taskRow()).toMatchObject({ effectivePhase: 'pending', phaseCause: { code: 'requeued' } });
      expect(h.lastWorld?.runs, 'no Run claims the requeue before a 推进').toHaveLength(1);
      const later = await h.advance(h.select(`${label}-later`));
      expect(later).toMatchObject({ state: 'completed' });
      // §12.10 step 4: the claim with the requeueRef, sent again with the same identity, gets its original receipt.
      const claim = performedOf(h.select(`${label}-later`), later, 'claim_task');
      const beforeClaimReplay = h.counts();
      expect((await h.answer('workflow/advance', plain(AG2B_SCOPE, claim.input)) as { value?: { receipt?: unknown } }).value?.receipt)
        .toEqual(replayOf(claim.receipt));
      expect(h.counts()).toEqual(beforeClaimReplay);
    } else {
      // Q-01 (QRR-01) closes the never-entered QueryRun and frees the Session; the re-drive then claims there.
      expect(report.report?.queries).toEqual([expect.objectContaining({ row: 'Q-01', status: 'reconciled', reason: 'not_entered' })]);
      await waitFor(() => h.goalDisplay(), display => display.phase === 'COMPLETED', 'the start-up re-drive to complete the Goal');
      await assertInvariants(h, 'a8-r1 re-driven');
    }
    // Exactly one new Run, claimed with the requeueRef in Run 1's reusable Session (W-21), and it passed.
    const claimants = (h.lastWorld?.runs ?? []).filter(run => run.requeueRef !== undefined
      && JSON.stringify(run.requeueRef) === JSON.stringify(requeue.ref));
    expect(claimants).toHaveLength(1);
    expect(h.lastWorld?.runs).toHaveLength(2);
    const run2 = await execution(h, claimants[0]!.ref);
    expect(run2.run).toMatchObject({ status: 'ended', outcome: 'completed', requeueRef: requeue.ref });
    expect(run2.session.ref.sessionId).toBe(s1.ref.sessionId);
    expect(h.lastWorld?.requeues).toHaveLength(1);
    expect(h.modelCalls()).toBe(3);
    // §12.10 step 4: the automatic requeue committed before the crash, sent again with the same identity after it, gets its
    // original receipt (`replayed: true`, the same TaskRequeue); no second TaskRequeue, no write.
    const requeued = performedOf(h.select(label, AG2B_WORK_TASK_ID), toClaim, 'requeue_task');
    const beforeReplay = h.counts();
    expect((await h.answer('workflow/advance', plain(AG2B_SCOPE, requeued.input)) as { value?: { receipt?: unknown } }).value?.receipt)
      .toEqual(replayOf(requeued.receipt));
    expect(h.counts()).toEqual(beforeReplay);
    await expectQuietHarnessRestart(h, label);
  }
}, 240_000);

it('A8-R2 (W-22, C8, ND-8): a committed no_new_basis refusal survives the restart: the verdict stays stopped, the start-up re-drive does not select the Goal, and a 推进 writes nothing', async () => {
  const h = await openHostScenario({ script: { replies: [RUN1_WITHOUT_FILE,
    { kind: 'text', text: 'restart scenario A8-R2: Run 2 changes nothing either' }] } });
  // Run 1 and Run 2 fail the same way with nothing changed: the second automatic requeue is refused (§13.4 #2).
  const refused = await h.advance(h.select('a8-r2', AG2B_WORK_TASK_ID));
  expect(refused.state).toBe('waiting');
  const refusal = h.lastWorld?.refusals[0];
  expect(h.lastWorld?.refusals).toHaveLength(1);
  expect(refusal).toMatchObject({ revision: 1, code: 'no_new_basis', requestedBy: WORKFLOW_AUTOMATION_ACTOR });
  const stopped = { failure: { automation: { lastRefusal: { code: 'no_new_basis', revision: 1, stale: false },
    verdict: { kind: 'stopped', reason: 'no_new_basis' } } } };
  expect(await h.taskRow()).toMatchObject(stopped);
  expect(await h.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', cause: { code: 'no_new_basis', taskId: AG2B_WORK_TASK_ID } });
  const atCrash = h.counts();

  const report = await h.restart({ crash: true });
  expect(report.report).toMatchObject({ runs: [], queries: [], checks: [], controls: [], redriveGoals: [], problems: [] });
  expect(h.counts(), 'the reconcile writes nothing; no driver starts').toEqual(atCrash);
  expect(await h.taskRow(), 'no Run ended in the reconcile, so the refusal is not stale').toMatchObject(stopped);
  expect(await h.advance(h.select('a8-r2-after'))).toMatchObject({ state: 'waiting', receipts: [] });
  expect(h.counts()).toEqual(atCrash);
  await h.drainAbandoned();
}, 180_000);
