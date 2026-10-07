/**
 * A.2 step 6, scenario A1 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步"
 * row A1-rework-same-session; C8 automatic rework, §4 TASK-16, TASK-03, TASK-14,
 * ATT-16, §9 VR-09 (L-3), §6.1 contract (e) and the C3 brief, §2.1 GOAL-27,
 * §12.2 W-21) through the real Host over HTTP on one SQLite ledger and Kernel store.
 *
 * Run 1 writes a notes file and answers without the result file, so the
 * registered static check FAILs. The Workflow requeues the Task as
 * `WORKFLOW_AUTOMATION_ACTOR` (`check_failed`, counted 1 of 3), claims the
 * requeue in Run 1's Session (Run 1's Turn has a Kernel terminal), and Run 2
 * starts with the continuation brief, writes the result file and passes; the
 * gate passes and the Goal completes. The scenario stops twice on the way (before
 * the automatic requeue, before the requeue's claim) to read what the row names
 * between the steps, and checks:
 * - the same Session (one Kernel session, two Turns), Run 1's records kept
 *   (Run, Attempt, Outbox, round, Kernel records), only the new input added to
 *   the model history;
 * - TaskRequeue@1 stores Run 1's head `chainEvidenceIds` as
 *   `supersededEvidenceIds`, and the completion folds without them (L-3);
 * - the brief in Run 2's first model request (failed check and report, the file
 *   Run 1 changed, the round-open → requeue source comparison, the fixed
 *   block), `executions/brief` = `inputBinding.continuationBriefDigest`, the
 *   marker line in the Kernel `turn.started` user message;
 * - the Goal's causes carry `auto_rework_count{n:1, cap:3}`.
 * The §11 invariants are checked after every Workflow step with a receipt.
 *
 * Moved here (A.2 step 6, user decision 31): tests/app/A2-automation-rework.test.ts
 * test 1 ("C8 (§15.2 5.8, AV-12, W-21): a FAILed round is requeued automatically,
 * claimed in Run 1's Session, passes and completes the Goal"), its assertions kept;
 * Run 1 now also writes a notes file (one more model call) so the brief has a
 * changed file to name.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import {
  CONTINUATION_STANDING_INSTRUCTIONS_ZH_V1, continuationBriefDigest, continuationBriefMarker, renderContinuationBriefZh,
} from '../../src/contracts/continuation-brief.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import { assertInvariants, checkRevisionOf, cleanupScenarios, openHostScenario, performs } from './harness.js';
import {
  NOTES_FILE, editThenText, finalizeOutcomesOf, kernelRecordRows, receiptsOf, requiredBriefOf, turnStarts,
} from './support/common.js';
import { claimInputsOf, cleanupRework, roundsOfTask } from './support/rework.js';

afterEach(async () => {
  await cleanupRework();
  await cleanupScenarios();
});

const RUN1_TEXT = 'A2 rework: Run 1 answers without the result file';

it('A1 (C8, §15.2 5.8, AV-12, W-21, L-3, C3): a FAILed round is requeued automatically, claimed in Run 1\'s Session with the brief, passes and completes the Goal', async () => {
  const h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: 'a1-run1-notes', name: 'edit', args: { mode: 'create', path: NOTES_FILE,
      newText: 'A1: Run 1 notes, the result file is still missing\n' } }] },
    { kind: 'text', text: RUN1_TEXT }, ...editThenText('a2-rework-run2')] } });
  await assertInvariants(h, 'seeded');

  // 1. Run 1 FAILs; stop before the automatic requeue the selection answers with.
  const toRequeue = await h.advance(h.select('a2-rework-1'), { stopBefore: performs('requeue_task') });
  expect(toRequeue.state).toBe('stopped');
  const failed = await h.taskRow();
  const run1Ref = failed.execution;
  if (run1Ref === null) throw new Error('Run 1 must be selected');
  expect(failed).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'check_failed',
    automation: { cap: 3, requeueAutoCount: 0, verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false } } } });
  // GOAL-27 (C8): a pending automatic rework keeps the Goal RUNNING ("等待推进").
  expect(await h.goalDisplay()).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', causes: expect.arrayContaining([
    { code: 'auto_rework_pending', taskId: AG2B_WORK_TASK_ID, operation: 'requeue', failureClass: 'check_failed' }]) });
  // The registered static check FAILed Run 1's round (ordinal 1, frozen configuration revision 1).
  const [round1, ...laterRounds] = roundsOfTask(h);
  if (round1 === undefined) throw new Error('Run 1 must have its round');
  expect(laterRounds).toEqual([]);
  expect(round1).toMatchObject({ subjectRunRef: run1Ref, status: 'finalized', outcome: 'FAIL',
    configuration: { configurationRevision: checkRevisionOf(1) }, checks: [{ checkId: 'ag2b-static', phase: 'finished', outcome: 'FAIL' }],
    chain: { ordinal: 1, predecessorRoundRef: null, supersededEvidenceIds: [] } });
  const reportRef = round1.checks[0]?.reportRef;
  if (reportRef === null || reportRef === undefined) throw new Error('the FAILed check must have a report');
  // `chainEvidenceIds(head)` of an ordinal-1 head: its own evidence (the chain's superseded list is empty).
  const run1ChainEvidenceIds = round1.evidenceRefs.map(ref => ref.evidenceId);
  expect(run1ChainEvidenceIds.length).toBeGreaterThan(0);
  const run1Before = await readExecution(h.host, run1Ref);
  const kernelAfterRun1 = kernelRecordRows(h.database);
  expect(new Set(kernelAfterRun1.map(row => row.sessionId)).size, 'Run 1 wrote one Kernel session').toBe(1);
  const run1Requests = h.modelRequests();
  expect(run1Requests).toHaveLength(2);

  // 2. The automatic requeue, its claim and Run 2; stop before Run 2's round opens. TaskRequeue@1 stores
  //    Run 1's chain evidence (L-3). The Goal counts the automatic rework that led to the selected Run 2
  //    (GOAL-27; §4 TD-8 `requeueAutoCount`: the nearest TaskRequeue back along the selected Run's chain).
  const toOpen = await h.advance(toRequeue.next!, { stopBefore: performs('open_checks') });
  expect(toOpen.state).toBe('stopped');
  expect(h.lastWorld?.requeues).toMatchObject([{ revision: 1, afterRunRef: run1Ref, afterRoundRef: round1.ref,
    supersededEvidenceIds: run1ChainEvidenceIds, budget: null }]);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'verifying', failure: { automation: { requeueAutoCount: 1, cap: 3 } } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', causes: expect.arrayContaining([
    { code: 'auto_rework_count', taskId: AG2B_WORK_TASK_ID, operation: 'requeue', n: 1, cap: 3 }]) });

  // 3. Run 2's round and PASS, the gate and the Goal.
  const finished = await h.advance(toOpen.next!);
  const steps = [...toRequeue.steps, ...toOpen.steps, ...finished.steps];

  // The moved assertions (A2-automation-rework test 1).
  expect(steps.at(-1), JSON.stringify(steps.map(step => [step.state, step.reason, step.receipt?.kind])))
    .toMatchObject({ state: 'completed', receipt: { kind: 'complete_goal', result: { status: 'committed' } } });
  // Run 1 FAILs, Run 2 passes, then the gate passes.
  expect(finalizeOutcomesOf(steps)).toEqual(['FAIL', 'PASS', 'PASS']);
  const [requeued, ...moreRequeues] = receiptsOf(steps, 'requeue_task');
  expect(moreRequeues).toEqual([]);
  expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: {
    failureClass: 'check_failed', basisComparison: 'compared', reason: 'auto-rework:check_failed#1',
    requestedBy: WORKFLOW_AUTOMATION_ACTOR, automation: { automatic: true, counted: true, autoCount: 1, cap: 3 } } } });
  // The requeue answer goes back to the selection, which claims the requeue (W-21).
  const requeueStep = steps.findIndex(step => step.receipt?.kind === 'requeue_task');
  expect(steps[requeueStep]).toMatchObject({ state: 'advance', next: { kind: 'select_work' } });
  expect(steps[requeueStep + 1]).toMatchObject({ state: 'advance', next: { kind: 'perform', operation: { kind: 'claim_task' } } });
  const requeueRef = (requeued as { value: { requeue: { ref: unknown; afterRunRef: RunRef } } }).value.requeue.ref;
  expect((requeued as { value: { requeue: { afterRunRef: RunRef } } }).value.requeue.afterRunRef).toEqual(run1Ref);
  // TASK-03: the requeue pins no budget, so the claim with its requeueRef carries the binding's.
  expect(claimInputsOf(steps)).toMatchObject([{ budget: { tokenBudget: 1_000_000, deadline: null } },
    { requeueRef, budget: { tokenBudget: 1_000_000, deadline: null } }]);
  expect(claimInputsOf(steps)[0]).not.toHaveProperty('requeueRef');

  const done = await h.taskRow();
  expect(done).toMatchObject({ effectivePhase: 'satisfied', rework: { requeueAutoCount: 1, cap: 3,
    entries: [{ afterRunRef: run1Ref, failureClass: 'check_failed', automatic: true, autoCount: 1,
      requestedBy: WORKFLOW_AUTOMATION_ACTOR, reason: 'auto-rework:check_failed#1' }] } });
  const run2Ref = done.execution;
  if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be the selected Run');
  const run1 = await readExecution(h.host, run1Ref);
  const run2 = await readExecution(h.host, run2Ref);
  expect(run2.run).toMatchObject({ requeueRef, status: 'ended', outcome: 'completed' });
  // Run 1's Turn has a Kernel terminal, so the continuation stays in its Session.
  expect(run2.outbox.claim.sessionRef).toEqual(run1.outbox.claim.sessionRef);
  // C3: the brief names the automatic rework and its count.
  const { brief, digest } = await requiredBriefOf(h.host, run2Ref);
  expect(brief).toMatchObject({ requeueRef, mode: 'rework', failureClass: 'check_failed',
    trigger: { actorClass: 'system', goalResume: false, requeueNumber: 1, autoRework: { count: 1, cap: 3 } } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'COMPLETED' });
  expect(h.host.scripted.calls(), 'Run 1 (the notes edit, then text), then Run 2 (edit and final text)').toBe(4);

  // Same Session (row: "Session ID 不变"): one Kernel session holds both Turns.
  expect(run2.session.ref.sessionId).toBe(run1.session.ref.sessionId);
  expect(h.kernelSnapshot().sessions).toHaveLength(1);
  expect(h.counts()).toMatchObject({ kernelTurnsStarted: 2, modelCalls: 4 });

  // Old Attempt, Run and round kept (ATT-16: the requeue claim opened a second Attempt with the requeueRef).
  expect({ run: run1.run, attempt: run1.attempt, outbox: run1.outbox })
    .toEqual({ run: run1Before.run, attempt: run1Before.attempt, outbox: run1Before.outbox });
  expect(run2.attempt.ref.attemptId).not.toBe(run1.attempt.ref.attemptId);
  expect(run2.attempt).toMatchObject({ runId: run2Ref.runId, requeueRef, status: 'ended', endOutcome: 'completed' });
  expect(h.lastWorld?.runs.filter(run => run.task.taskId === AG2B_WORK_TASK_ID).map(run => run.ref.runId).sort())
    .toEqual([run1Ref.runId, run2Ref.runId].sort());
  const workRounds = roundsOfTask(h);
  expect(workRounds).toHaveLength(2);
  expect(workRounds.find(round => round.ref.roundId === round1.ref.roundId)).toEqual(round1);
  const round2 = workRounds.find(round => round.subjectRunRef.runId === run2Ref.runId);
  expect(round2).toMatchObject({ status: 'finalized', outcome: 'PASS', chain: { ordinal: 1 } });

  // Only the incremental input: Run 1's Kernel records are kept as they were and the new Turn follows them;
  // Run 2's first model request is Run 1's history (its last request, then its final answer) plus one user message.
  const kernelAtEnd = kernelRecordRows(h.database);
  expect(kernelAtEnd.slice(0, kernelAfterRun1.length)).toEqual(kernelAfterRun1);
  expect(kernelAtEnd.length).toBeGreaterThan(kernelAfterRun1.length);
  const requests = h.modelRequests();
  const run1Last = run1Requests[1]!;
  const run2First = requests[2]!;
  expect(run2First.messages.slice(0, run1Last.messages.length)).toEqual(run1Last.messages);
  expect(run2First.messages.slice(run1Last.messages.length)).toMatchObject([{ role: 'assistant', content: RUN1_TEXT },
    { role: 'user' }]);
  expect(run2First.messages.slice(run1Last.messages.length)).toHaveLength(2);
  const newInput = run2First.messages.at(-1);
  if (newInput?.role !== 'user') throw new Error('Run 2 must add one user message');

  // L-3: the completion folded without the evidence TaskRequeue@1 stored.
  const reduction = h.lastWorld?.reductions.find(candidate => candidate.ref.taskId === AG2B_WORK_TASK_ID);
  if (reduction === undefined) throw new Error('the work Task must have its TaskReduction');
  const folded = [...reduction.effectiveEvidenceIds, ...reduction.blockingEvidenceIds, ...reduction.staleEvidenceIds,
    ...reduction.outOfScopeEvidenceIds];
  expect(folded.filter(id => run1ChainEvidenceIds.includes(id)), 'superseded evidence left the fold').toEqual([]);
  expect(reduction.effectiveEvidenceIds).toEqual(expect.arrayContaining(round2!.evidenceRefs.map(ref => ref.evidenceId)));

  // C3: the brief in Run 2's first model request, its digest bound on the Run, the marker in the Kernel Turn.
  expect(digest).toBe(run2.run.inputBinding?.continuationBriefDigest);
  expect(continuationBriefDigest(brief)).toBe(digest);
  const rendered = renderContinuationBriefZh(brief, digest);
  expect(newInput.content.endsWith(`\n\n${rendered}`), 'the brief is the last section of Run 2\'s input').toBe(true);
  expect(run1Requests[0]!.messages.some(message => message.role === 'user' && message.content.includes('[continuation-brief v1')))
    .toBe(false);
  // The failed check and its report.
  expect(brief.checks).toMatchObject({ roundRef: round1.ref, roundOrdinal: 1,
    failing: [{ checkId: 'ag2b-static', phase: 'finished', outcome: 'FAIL', reportRef }] });
  expect(newInput.content).toContain(`  - ag2b-static：阶段 finished，结果 FAIL`);
  expect(newInput.content).toContain(`报告 sha256:${reportRef.digest}`);
  // The file Run 1 changed through its tools.
  expect(brief.workspace.selfChanged).toMatchObject({ status: 'known', confirmed: [NOTES_FILE] });
  expect(newInput.content).toContain(`上一次执行经工具改动的文件（完整）：${NOTES_FILE}`);
  // The source comparison from the round's open to the requeue (nothing changed in between).
  const checkpoints = brief.workspace.checkpoints.map(checkpoint => checkpoint.kind);
  expect(brief.workspace.segments).toContainEqual(expect.objectContaining({ from: checkpoints.indexOf('round_open'),
    to: checkpoints.indexOf('requeue'), verdict: 'unchanged' }));
  expect(newInput.content).toContain('检查轮次开始 → 重新入队：源码摘要相同');
  // The fixed block, and the same-Session continuity.
  expect(newInput.content).toContain(CONTINUATION_STANDING_INSTRUCTIONS_ZH_V1.join('\n'));
  expect(brief.session).toMatchObject({ continuity: 'same_session_history', sessionRef: run1.outbox.claim.sessionRef });
  // The Kernel `turn.started` of Run 2 carries the marker line; Run 1's does not.
  const turns = turnStarts(h.database);
  expect(turns).toHaveLength(2);
  expect(turns[0]!.content).not.toContain('[continuation-brief v1');
  expect(turns[1]!.content.split('\n')).toContain(continuationBriefMarker(digest));
  expect(turns[1]!.sessionId).toBe(turns[0]!.sessionId);
}, 180_000);
