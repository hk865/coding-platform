/**
 * A.2 step 6, scenario C8-auto-rework-cap (docs/refactor/STATE-MACHINES-SPEC.md
 * §15.2 "第 6 步" row C8-auto-rework-cap; C8, §4 TD-9 AV-8/AV-12, G-CAP, ATT-16,
 * TASK-16; §2.1 GOAL-24, GOAL-27, GOAL-30; §13.4 #15; ND-7) through the real Host
 * over HTTP on one SQLite ledger and Kernel store.
 *
 * Every Run uses two model replies (it creates a file of its own with its own
 * text, then answers), and the registered check always exits 1. With the default
 * cap 3 the Workflow requeues automatically three times (each Run changed the
 * source, so every key is new) and then stops on the verdict
 * `stopped/auto_rework_cap_reached`: it never issues the fourth automatic requeue,
 * so no refusal is written; the Task has exactly 4 Runs and the model was called
 * 8 times; the Goal is NEEDS_DECISION/auto_rework_cap_reached; another 推进 calls
 * no model and writes nothing. `automation/save` raises the cap to 5: with no
 * person acting, the next 推进 requeues twice more and stops again after 6 Runs.
 * An operator `tasks/requeue` stores `{automatic:false, autoCount:0}` and resets
 * the count: the next automatic requeue is #1 again.
 * The §11 invariants are checked after every Workflow step with a receipt and
 * after the operator requeue.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import { assertInvariants, cleanupScenarios, openHostScenario, performs, SCENARIO_OPERATOR } from './harness.js';
import { finalizeOutcomesOf, operatorRequeue, requeueRequestsOf } from './support/common.js';
import { claimInputsOf, cleanupRework, performsNth, requeuedOf } from './support/rework.js';

afterEach(async () => {
  await cleanupRework();
  await cleanupScenarios();
});

/** Run `n`: creates `src/c8-cap-run-<n>.txt` with its own text (the source changes every Run), then answers. */
const RUN = (n: number): ScriptedReply[] => [
  { kind: 'calls', calls: [{ callId: `c8-cap-run-${n}-edit`, name: 'edit', args: { mode: 'create', path: `src/c8-cap-run-${n}.txt`,
    newText: `C8 cap: Run ${n} tries another fix\n` } }] },
  { kind: 'text', text: `C8 cap: Run ${n} wrote its file; the check still fails` }];

const STOPPED_ON_CAP = 'the selected Task ag2b-work is not executable right now';

it('C8 (§13.4 #15, AV-8, GOAL-30): three automatic requeues, then stopped/auto_rework_cap_reached with no refusal; a raised cap continues without a person; an operator requeue resets the count', async () => {
  const h = await openHostScenario({ check: 'fail', script: { replies: Array.from({ length: 7 }, (_, index) => RUN(index + 1)).flat() } });
  await assertInvariants(h, 'seeded');

  // Run 1 FAILs: the verdict is AV-12 requeue, so the Goal is RUNNING "等待推进" (GOAL-27), not FAILED (GOAL-24, C8).
  const first = await h.advance(h.select('c8-cap-1', AG2B_WORK_TASK_ID), { stopBefore: performs('requeue_task') });
  expect(first.state).toBe('stopped');
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'check_failed',
    automation: { cap: 3, requeueAutoCount: 0, verdict: { kind: 'requeue', failureClass: 'check_failed' } } } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', causes: expect.arrayContaining([
    { code: 'auto_rework_pending', taskId: AG2B_WORK_TASK_ID, operation: 'requeue', failureClass: 'check_failed' }]) });

  // Automatic requeues #1..#3 (one claim each, ATT-16), Runs 2..4 FAIL; the fourth automatic requeue is never issued.
  const capped = await h.advance(first.next!);
  const phase1 = [...first.steps, ...capped.steps];
  expect(capped).toMatchObject({ state: 'waiting', reason: STOPPED_ON_CAP, next: null });
  expect(finalizeOutcomesOf(phase1)).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL']);
  expect(requeueRequestsOf(phase1), 'exactly three automatic requeue requests').toHaveLength(3);
  expect(requeuedOf(phase1)).toMatchObject([1, 2, 3].map(n => ({ failureClass: 'check_failed', basisComparison: 'compared',
    reason: `auto-rework:check_failed#${n}`, requestedBy: WORKFLOW_AUTOMATION_ACTOR,
    automation: { automatic: true, counted: true, autoCount: n, cap: 3 } })));
  expect(claimInputsOf(phase1).map(input => input['requeueRef'] === undefined), 'the first claim, then three requeue claims')
    .toEqual([true, false, false, false]);
  expect(h.lastWorld?.refusals, 'the cap stop writes no refusal').toEqual([]);
  // §13 key: each Run changed the source, so every automatic requeue was compared and its key is new.
  expect(new Set(h.lastWorld?.requeues.map(requeue => requeue.basis.digest)).size).toBe(3);
  expect(h.lastWorld?.runs.filter(run => run.task.taskId === AG2B_WORK_TASK_ID)).toHaveLength(4);
  expect(h.lastWorld?.attempts.filter(attempt => attempt.ref.taskId === AG2B_WORK_TASK_ID)).toHaveLength(4);
  expect(h.modelCalls(), 'four Runs, two model calls each').toBe(8);
  const stopped = await h.taskRow();
  expect(stopped).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'check_failed', automation: { cap: 3,
    requeueAutoCount: 3, lastRefusal: null, verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'requeue' } } } },
  rework: { requeueAutoCount: 3, cap: 3 } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'auto_rework_cap_reached', taskId: AG2B_WORK_TASK_ID, detail: { operation: 'requeue' } },
    causes: expect.arrayContaining([{ code: 'auto_rework_count', taskId: AG2B_WORK_TASK_ID, operation: 'requeue', n: 3, cap: 3 }]) });

  // Another 推进, Task-level or Goal-level: 0 model calls, 0 writes (ledger, Kernel, checks).
  const atStop = h.counts();
  expect(await h.advance(h.select('c8-cap-1-again', AG2B_WORK_TASK_ID))).toMatchObject({ state: 'waiting', receipts: [] });
  expect(await h.advance(h.select('c8-cap-1-goal'))).toMatchObject({ state: 'waiting', receipts: [] });
  expect(h.counts()).toEqual(atStop);

  // The cap goes to 5 (`automation/save`): the stop lifts at once, with no person acting and nothing written.
  await h.saveAutomation({ schemaVersion: 1, autoReworkLimit: 5, resumeOnStartup: true });
  expect(await h.taskRow()).toMatchObject({ failure: { automation: { cap: 5, requeueAutoCount: 3,
    verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false } } } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27' });
  expect(h.counts()).toEqual(atStop);

  // The next 推进 requeues automatically twice more (#4, #5); after 6 Runs the cap stops it again.
  const raised = await h.advance(h.select('c8-cap-2', AG2B_WORK_TASK_ID));
  expect(raised).toMatchObject({ state: 'waiting', reason: STOPPED_ON_CAP, next: null });
  expect(finalizeOutcomesOf(raised.steps)).toEqual(['FAIL', 'FAIL']);
  expect(requeuedOf(raised.steps)).toMatchObject([4, 5].map(n => ({ reason: `auto-rework:check_failed#${n}`,
    requestedBy: WORKFLOW_AUTOMATION_ACTOR, automation: { automatic: true, counted: true, autoCount: n, cap: 5 } })));
  expect(h.lastWorld?.runs.filter(run => run.task.taskId === AG2B_WORK_TASK_ID)).toHaveLength(6);
  expect(h.lastWorld?.refusals).toEqual([]);
  expect(h.modelCalls()).toBe(12);
  const stoppedAgain = await h.taskRow();
  expect(stoppedAgain).toMatchObject({ failure: { automation: { cap: 5, requeueAutoCount: 5,
    verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached' } } } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'auto_rework_cap_reached', taskId: AG2B_WORK_TASK_ID } });
  const run6Ref = stoppedAgain.execution;
  if (run6Ref === null) throw new Error('Run 6 must be selected');

  // An operator `tasks/requeue`: stored as {automatic:false, counted:false, autoCount:0}; the count is reset.
  const requeued = await operatorRequeue(h.host, run6Ref, 'c8-cap-operator-requeue', 'the operator asks for one more try');
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue: ${JSON.stringify(requeued)}`);
  expect(requeued.value.requeue).toMatchObject({ afterRunRef: run6Ref, requestedBy: SCENARIO_OPERATOR, basisComparison: 'compared',
    automation: { automatic: false, counted: false, autoCount: 0, cap: null } });
  await assertInvariants(h, 'operator requeue', { kind: 'task_requeued', actor: { ...SCENARIO_OPERATOR },
    automationPolicy: h.automationPolicy() });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'pending', requeueRef: requeued.value.requeue.ref,
    failure: { automation: { coveringRequeue: requeued.value.requeue.ref, verdict: { kind: 'claim_requeued' } } } });
  // The Workflow claims it; Run 7 FAILs; the next automatic requeue counts from 0 again (#1 of 5).
  const reset = await h.advance(h.select('c8-cap-3', AG2B_WORK_TASK_ID), { stopBefore: performsNth('claim_task', 2) });
  expect(reset.state).toBe('stopped');
  expect(claimInputsOf(reset.steps)[0]).toMatchObject({ requeueRef: requeued.value.requeue.ref });
  expect(finalizeOutcomesOf(reset.steps)).toEqual(['FAIL']);
  expect(requeuedOf(reset.steps)).toMatchObject([{ reason: 'auto-rework:check_failed#1',
    automation: { automatic: true, counted: true, autoCount: 1, cap: 5 } }]);
  expect(h.lastWorld?.runs.filter(run => run.task.taskId === AG2B_WORK_TASK_ID)).toHaveLength(7);
  expect(h.modelCalls()).toBe(14);
  expect((await h.taskRow()).rework).toMatchObject({ entries: [1, 2, 3, 4, 5, 0, 1].map(autoCount => ({ autoCount })) });
}, 180_000);
