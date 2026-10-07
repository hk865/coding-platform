/**
 * A.2 step 6, scenario A11 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步"
 * row A11; §13 ND-1..ND-9, 13.2, 13.3 and the §13.4 examples; ORCHESTRATION §9
 * and §11 A11; C8, hard limits 2–4) on SQLite with the scripted model of the
 * shared harness (tests/scenarios/harness.ts): the same failure with no new
 * basis never makes another Attempt or model call, and the §13.4 examples are
 * driven row by row through the real owners (all 26; three are cited below).
 *
 * 1. (moved, tests/app/A2-automation-rework.test.ts test 2) #15/#21: cap 1 stops
 *    the automation without a refusal; a raised cap meets the committed
 *    `no_new_basis` refusal @1; the other Task's Run writes the result file, the
 *    stale refusal is retried once and the changed source passes (the "改文件"
 *    variant).
 * 2. #2 two rounds → refusal @1, NEEDS_DECISION/no_new_basis, then nothing;
 *    #25 (ND-9) a platform body as new input is `invalid`; #21 another Task's Run
 *    that changes nothing → stale → one retry → refusal @2 → stop, no loop; #22 a
 *    reason is no new basis, a note is, the same note again is not; ND-3 the next
 *    automatic request matches the first requeue; #20 a newly stored Artifact
 *    passes and, after the next identical failure, the same one is refused.
 * 3. #14 (ND-4) another Run changed an unrelated file → the second requeue passes;
 *    #6 (L-4) an unrelated adoption between two requeues changes no key: the
 *    request the adoption made stale is re-made and refused.
 * 4. #15 an automatic request past the limit (performed after the limit dropped)
 *    is the committed `auto_rework_cap_reached` refusal; the operator's requeue
 *    passes and counts 0.
 * 5. #19 / #16 `budget_exhausted`: no larger budget → `budget_not_increased`
 *    (before the key); 200k, then 400k pass (a different exhausted budget is a
 *    different failure); 400k again → `budget_not_increased`.
 * 6. #23/#24 a paused-interrupted Task (RUN-24): a system requeue is `forbidden`
 *    while the Goal is active and `busy` while it is paused (so is the operator's);
 *    after the Goal resumes the operator's 继续 passes with the comparison skipped.
 * 7. #1 the first requeue passes (pending); #3 a Run that changed a file passes;
 *    #10 (ND-3) S1→S2→S1 meets the first key; #5 another reason alone is refused;
 *    #11 a manual edit after the failure passes.
 * 8. #7 another failing check on the same source passes; #8 after an
 *    `outcome_unknown` Run every requeue is `busy`, nothing written.
 * 9. #4 a responded message as new input passes (not before its answer).
 * 10. #12 two Host interruptions in a row pass with the comparison skipped;
 *    #13 a Kernel-reported crash after them is another origin and passes; #9 a
 *    second Kernel-reported crash on the same source is refused.
 *
 * Cited, not repeated (user decision 31): #17 (interrupted, uncounted, comparison
 * skipped; the later `check_failed` requeue counts 1) is A8-3n in
 * tests/scenarios/A8-host-restart-paused.test.ts; #18 (operator cancel:
 * `task_cancelled`, system `forbidden`, the operator's requeue
 * `skipped_human_cancel` with the same key twice) is
 * tests/scenarios/C8-human-stop-respected.test.ts ("C8 hard limit 3 (§13.4 #18,
 * ND-6) …"); #26 (defer and reactivate between two requeues → still
 * `no_new_basis`) is tests/scenarios/C7-defer-reactivate.test.ts (moved there from
 * tests/composition/A2-disposition-change-platform.test.ts: "C7 defer and reactivate
 * (TASK-19 from P4, L-15, GOAL-30, #26) …", its final `no_new_basis`). Two halves of rows
 * are other groups' scenarios too: #19's "a person raises the Workflow binding
 * budget, the Workflow requeues with it and the claim carries it" is
 * tests/scenarios/C8-budget.test.ts ("AV-11, §13.4 #19 …"), and #15's "after the
 * operator's requeue the automation does at most the cap again" is
 * tests/scenarios/C8-auto-rework-cap.test.ts ("C8 (§13.4 #15, AV-8, GOAL-30) …",
 * its operator reset and the next count of 1). The §11 invariants are checked
 * after every step that changes records. No real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { MANIFEST_CONTENT_TYPE, QUERY_MANIFEST_CONTENT_TYPE, REPORT_CONTENT_TYPE } from '../../src/contracts/no-progress.js';
import {
  WORKFLOW_AUTOMATION_ACTOR, type TaskAutomationPolicyV1, type TaskRequeueOutcomeV1, type TaskRequeueSnapshotV1,
  type TaskReworkRefusalSnapshotV1,
} from '../../src/contracts/task-requeue.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_QUERY_BUDGET, AG2B_QUERY_ROLE, AG2B_QUERY_ROLE_BINDING, AG2B_RUNTIME_BUDGET,
  AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, graphWrite, plain, seedAG2bWorkGraph, startAG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import { controlGoal, publicDirectory, selectWork, workRow } from '../helpers/A2-restart-fixture.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  assertInvariants, assertInvariantsAt, cleanupScenarios, hostCtx, openHostScenario, openPlatformScenario, performs, SCENARIO_OPERATOR,
  type Driven, type HostScenario, type PlatformScenario,
} from './harness.js';
import {
  NO_REDRIVE, committedOutcomesOf, createFileReplies, driveChecked, editThenText, execution, finalizeOutcomesOf as finalizeOutcomes,
  hostGoalDisplay as goalDisplay, nextPlanDraft, performsAfterRequeues, receiptsOf, requeueRequestsOf, selectedRun, stepOf, textReply,
} from './support/common.js';
import {
  adoptPlan, platformRequeue, platformRun, registerTwoChecks, requeueWithBody, saveAutomationLimit as saveAutomation, WORK_2,
} from './support/receipts.js';

afterEach(cleanupScenarios);

const W = AG2B_WORK_TASK_ID;
/** A Run that writes `path` (a file no check reads), then answers. */
const WRITE_THEN_TEXT = (label: string, path: string): ScriptedReply[] => createFileReplies(label, path, `${label}\n`);

/** The committed `requeue_task` values of a drive (requeued or refused), in order. */
function requeueValues(driven: Driven): TaskRequeueOutcomeV1[] {
  return driven.receipts.flatMap(receipt => receipt.kind === 'requeue_task' && receipt.result.status === 'committed'
    ? [receipt.result.value] : []);
}
function requeuedOf(value: unknown): TaskRequeueSnapshotV1 {
  const outcome = (value as { status?: string; value?: TaskRequeueOutcomeV1 }).value ?? value as TaskRequeueOutcomeV1;
  if (outcome.kind !== 'requeued') throw new Error(`expected a TaskRequeue: ${JSON.stringify(value)}`);
  return outcome.requeue;
}
function refusalOf(value: unknown): TaskReworkRefusalSnapshotV1 {
  const outcome = (value as { status?: string; value?: TaskRequeueOutcomeV1 }).value ?? value as TaskRequeueOutcomeV1;
  if (outcome.kind !== 'refused') throw new Error(`expected a refusal: ${JSON.stringify(value)}`);
  return outcome.refusal;
}
/** `stopBefore` for the `n`-th `requeue_task` of the scenario (n − 1 TaskRequeue records already exist). */
const beforeRequeue = (h: HostScenario | PlatformScenario, n: number) => performsAfterRequeues(h, 'requeue_task', n - 1);

// ---------------------------------------------------------------------------
// 1. Moved from tests/app/A2-automation-rework.test.ts (test 2, 05125db), assertions unchanged;
//    `driveWorkflow` is common.ts `driveChecked` (the same drive with the invariants after every step,
//    under the automation policy in effect) and the seeded store is checked once.
// ---------------------------------------------------------------------------

it('§13.4 #15/#21, AV-8/AV-9, GOAL-27/30: the cap stops the automation, a raised cap meets a committed refusal, the other Task runs and the stale refusal is retried once', async () => {
  const host = await startAG2bHost(await publicDirectory(), { replies: [
    { kind: 'text', text: 'A2 cap: Run 1 answers without the result file' },
    { kind: 'text', text: 'A2 cap: Run 2 answers without the result file again' },
    ...editThenText('a2-cap-work-2'),
    { kind: 'text', text: 'A2 cap: Run 4 finds the result file' }] });
  const inv = { database: host.database };
  /** The policy `saveAutomation` installed (the steps' `FuzzStep`). */
  let policy: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: 1, resumeOnStartup: true };
  const drive = async (input: WorkflowAdvanceInput) => (await driveChecked(host, inv, input, { policy })).steps;
  try {
    await seedAG2bWorkGraph(host, [AG2B_WORK_TASK_ID, WORK_2]);
    await saveAutomation(host, 1);
    await assertInvariantsAt(inv, 'seeded');

    // The first automatic requeue (1 of 1) runs; Run 2 FAILs the same way and the cap stops the automation:
    // the second request is never issued, so no refusal is written (AV-8, §13.4 #15).
    const capped = await drive(selectWork('a2-cap-1'));
    expect(capped.at(-1)).toMatchObject({ state: 'waiting', next: null,
      reason: `the selected Task ${AG2B_WORK_TASK_ID} is not executable right now` });
    expect(finalizeOutcomes(capped)).toEqual(['FAIL', 'FAIL']);
    expect(receiptsOf(capped, 'requeue_task')).toMatchObject([{ status: 'committed', value: { kind: 'requeued',
      requeue: { automation: { automatic: true, counted: true, autoCount: 1, cap: 1 } } } }]);
    const stopped = await workRow(host);
    expect(stopped).toMatchObject({ effectivePhase: 'failed', failure: { automation: { cap: 1, requeueAutoCount: 1, lastRefusal: null,
      verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'requeue' } } } } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
      cause: { code: 'auto_rework_cap_reached', taskId: AG2B_WORK_TASK_ID, detail: { operation: 'requeue' } },
      causes: expect.arrayContaining([{ code: 'auto_rework_count', taskId: AG2B_WORK_TASK_ID, operation: 'requeue', n: 1, cap: 1 }]) });
    // Another 推进 of the stopped Task writes nothing and calls no model.
    expect(await drive(selectWork('a2-cap-1-again'))).toMatchObject([{ state: 'waiting', next: null }]);
    expect(host.scripted.calls()).toBe(2);
    const run2Ref = stopped.execution;
    if (run2Ref === null) throw new Error('Run 2 must be the selected Run');

    // `automation/save` raises the cap: the stop lifts at once (GOAL-27 "等待推进").
    await saveAutomation(host, 3);
    policy = { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: true };
    expect(await workRow(host)).toMatchObject({ failure: { automation: { cap: 3,
      verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false } } } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', causes: expect.arrayContaining([
      { code: 'auto_rework_pending', taskId: AG2B_WORK_TASK_ID, operation: 'requeue', failureClass: 'check_failed' },
      { code: 'auto_rework_count', taskId: AG2B_WORK_TASK_ID, operation: 'requeue', n: 1, cap: 3 }]) });

    // The next 推进 tries it: nothing changed since Run 1's requeue, so the owner commits the no_new_basis
    // refusal; the committed refusal goes back to the selection, which now stops on it (AV-9).
    const refusedSteps = await drive(selectWork('a2-cap-2'));
    expect(receiptsOf(refusedSteps, 'requeue_task')).toMatchObject([{ status: 'committed', value: { kind: 'refused',
      refusal: { revision: 1, code: 'no_new_basis', afterRunRef: run2Ref, requestedBy: WORKFLOW_AUTOMATION_ACTOR } } }]);
    expect(refusedSteps.find(step => step.receipt?.kind === 'requeue_task')).toMatchObject({ state: 'advance',
      next: { kind: 'select_work', taskId: AG2B_WORK_TASK_ID } });
    expect(refusedSteps.at(-1)).toMatchObject({ state: 'waiting', next: null });
    expect(await workRow(host)).toMatchObject({ failure: { automation: { lastRefusal: { code: 'no_new_basis', revision: 1, stale: false },
      verdict: { kind: 'stopped', reason: 'no_new_basis', detail: { operation: 'requeue' } } } } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
      cause: { code: 'no_new_basis', taskId: AG2B_WORK_TASK_ID, detail: { operation: 'requeue' } } });
    expect(host.scripted.calls()).toBe(2);

    // The Goal-level 推进 skips the stopped Task and runs the other one ("其它 Task 继续"), which writes the
    // result file. Its end makes the refusal stale (W-22): the Workflow retries once, pinning the refusal @1
    // (a new request), the changed source passes the key (§13.4 #21), Run 4 passes and the Goal completes.
    const finished = await drive(selectWork('a2-cap-3', true));
    expect(finished.at(-1), JSON.stringify(finished.map(step => [step.state, step.reason, step.receipt?.kind])))
      .toMatchObject({ state: 'completed' });
    // work-2 first (work-1 is stopped), then work-1's requeue after the retry.
    const claims = receiptsOf(finished, 'claim_task') as Array<{ value: { task: { taskId: string } } }>;
    expect(claims.map(claim => claim.value.task.taskId)).toEqual([WORK_2, AG2B_WORK_TASK_ID]);
    expect(requeueRequestsOf(finished)).toMatchObject([{ input: { afterRunRef: run2Ref, reason: 'auto-rework:check_failed#2' },
      meta: { expected: [{ ref: AG2B_GOAL_REF }, { ref: run2Ref }, { ref: { aggregateType: 'TaskReworkRefusal',
        operation: 'requeue', subjectId: run2Ref.runId }, revision: 1 }] } }]);
    expect(receiptsOf(finished, 'requeue_task')).toMatchObject([{ status: 'committed', value: { kind: 'requeued',
      requeue: { afterRunRef: run2Ref, reason: 'auto-rework:check_failed#2', automation: { autoCount: 2, cap: 3 } } } }]);
    expect(await workRow(host, WORK_2)).toMatchObject({ effectivePhase: 'satisfied' });
    const work1 = await workRow(host);
    expect(work1).toMatchObject({ effectivePhase: 'satisfied', rework: { entries: [
      { automatic: true, autoCount: 1, reason: 'auto-rework:check_failed#1' },
      { automatic: true, autoCount: 2, reason: 'auto-rework:check_failed#2', afterRunRef: run2Ref }] } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'COMPLETED' });
    expect(host.scripted.calls(), 'Runs 1 and 2 of work-1, the two-step Run of work-2, Run 4 of work-1').toBe(5);
  } finally {
    await host.host.close();
  }
}, 240_000);

// ---------------------------------------------------------------------------
// 2. Two rounds, the stale retry without a change, reasons, notes and Artifacts, platform bodies
// ---------------------------------------------------------------------------

it('A11 #2, #25, #21 (不改文件), #22, ND-3, #20: the same failure twice stops at refusal @1 with no new Attempt or model call; a platform body is invalid; a stale refusal is retried once and stops at @2; a reason is no new basis, a note or a new Artifact is, the same one again is not', async () => {
  const h = await openPlatformScenario({ check: 'fail', workIds: [W, WORK_2], script: { replies: [
    textReply('A11 Run 1 changes nothing'), textReply('A11 Run 2 changes nothing'), textReply('A11 work-2 changes nothing'),
    textReply('A11 Run 3 after the note changes nothing'), textReply('A11 Run 4 after the diagnosis changes nothing')] } });

  // #2: Run 1 FAILs → automatic requeue #1 → Run 2 FAILs the same way on the same source → the second
  // automatic requeue is the committed `no_new_basis` refusal @1, matched to the first requeue; then nothing runs.
  const twoRounds = await h.advance(h.select('a11-two-rounds', W));
  expect(twoRounds.state).toBe('waiting');
  expect(committedOutcomesOf(twoRounds)).toEqual(['FAIL', 'FAIL']);
  const [first, second, ...more] = requeueValues(twoRounds);
  expect(more).toEqual([]);
  const requeue1 = requeuedOf(first);
  expect(requeue1).toMatchObject({ basisComparison: 'compared', automation: { automatic: true, counted: true, autoCount: 1 } });
  const run2Ref = await selectedRun(h);
  const refusal1 = refusalOf(second);
  expect(refusal1).toMatchObject({ revision: 1, code: 'no_new_basis', afterRunRef: run2Ref, matchedRequeueRef: requeue1.ref,
    basisDigest: requeue1.basis.digest, requestedBy: WORKFLOW_AUTOMATION_ACTOR, goalEndedRunsAtRefusal: 2 });
  expect(h.modelCalls()).toBe(2);
  expect(h.lastWorld?.runs).toHaveLength(2);
  expect(h.lastWorld?.attempts).toHaveLength(2);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', failure: { automation: {
    lastRefusal: { code: 'no_new_basis', revision: 1, stale: false }, verdict: { kind: 'stopped', reason: 'no_new_basis' } } } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'no_new_basis', taskId: W, detail: { operation: 'requeue' } } });
  const stoppedAt = h.counts();
  expect(await h.advance(h.select('a11-two-rounds-again', W))).toMatchObject({ state: 'waiting', receipts: [] });
  expect(h.counts(), 'no new Attempt, model call or write').toEqual(stoppedAt);

  // #25 (ND-9): Run 2's own manifest, its check report, or a Query manifest is never a new basis: `invalid`,
  // refused before any comparison and before anything is written.
  const run2 = await platformRun(h, run2Ref);
  const manifestRef = run2.run.envelope?.bundleRef;
  expect(manifestRef).toMatchObject({ contentType: MANIFEST_CONTENT_TYPE });
  const round2 = h.lastWorld?.rounds.find(round => round.subjectRunRef.runId === run2Ref.runId) as RoundSnapshot | undefined;
  const reportRef = round2?.checks[0]?.reportRef;
  expect(reportRef).toMatchObject({ contentType: REPORT_CONTENT_TYPE });
  for (const [what, ref] of [['manifest', manifestRef], ['report', reportRef],
    ['query manifest', { ...manifestRef!, contentType: QUERY_MANIFEST_CONTENT_TYPE }]] as const) {
    const answer = await platformRequeue(h, `a11-nd9-${what.replace(' ', '-')}`, run2Ref, { input: { newInputRefs: [{ kind: 'artifact', ref: ref! }] } });
    expect(answer, what).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect((answer as { reason: string }).reason, what).toContain('platform-generated');
  }
  expect(h.counts()).toEqual(stoppedAt);

  // #21 (不改文件): work-2's Run ends without changing a file; the Goal's ended Runs pass the refusal's watermark,
  // so the refusal is stale and the verdict asks for one retry.
  const other = await h.advance(h.select('a11-other-task', WORK_2), { stopBefore: performs('requeue_task') });
  expect(committedOutcomesOf(other)).toEqual(['FAIL']);
  expect(await h.taskRow()).toMatchObject({ failure: { automation: { lastRefusal: { revision: 1, stale: true },
    verdict: { kind: 'requeue', retryAfterRefusal: true } } } });
  // The one retry pins the refusal @1 (a new request), meets the same key and writes @2; the Task stops again.
  const retry = await h.advance(h.select('a11-retry', W));
  expect(retry.steps.flatMap(step => step.next?.kind === 'perform' && step.next.operation.kind === 'requeue_task'
    ? [step.next.operation.request] : [])).toMatchObject([{ input: { afterRunRef: run2Ref, reason: 'auto-rework:check_failed#2' },
    meta: { expected: [{ ref: AG2B_GOAL_REF }, { ref: run2Ref }, { ref: { aggregateType: 'TaskReworkRefusal', subjectId: run2Ref.runId }, revision: 1 }] } }]);
  expect(requeueValues(retry).map(refusalOf)).toMatchObject([{ revision: 2, code: 'no_new_basis', matchedRequeueRef: requeue1.ref,
    goalEndedRunsAtRefusal: 3 }]);
  expect(retry.state).toBe('waiting');
  const afterRetry = h.counts();
  expect(afterRetry.modelCalls, 'the retry called no model').toBe(3);
  expect(await h.advance(h.select('a11-retry-again', W))).toMatchObject({ state: 'waiting', receipts: [] });
  expect(h.counts(), 'no loop: the next 推进 writes nothing').toEqual(afterRetry);

  // #22: an operator's reason is never a new basis (refusal @3) ...
  const reasonOnly = await platformRequeue(h, 'a11-reason-only', run2Ref,
    { input: { reason: 'the check was flaky; please try once more' } });
  expect(refusalOf(reasonOnly)).toMatchObject({ revision: 3, code: 'no_new_basis', matchedRequeueRef: requeue1.ref,
    requestedBy: SCENARIO_OPERATOR });
  await assertInvariants(h, '#22 reason only', stepOf(h, 'task_rework_refused', '#22 reason only', SCENARIO_OPERATOR));
  // ... the explicit note is: stored as an Artifact, it is a new input and the requeue passes, counted 0.
  const NOTE = 'A11: the static check exits 1 whatever the source holds';
  const withNote = await platformRequeue(h, 'a11-note', run2Ref, { input: { note: NOTE } });
  const noteRequeue = requeuedOf(withNote);
  await assertInvariants(h, '#22 note', stepOf(h, 'task_requeued', '#22 note', SCENARIO_OPERATOR));
  expect(noteRequeue).toMatchObject({ basisComparison: 'compared', automation: { automatic: false, counted: false, autoCount: 0 },
    newInputRefs: [{ kind: 'artifact', ref: { contentType: 'text/plain; charset=utf-8' } }] });
  expect(noteRequeue.basis.digest).not.toBe(requeue1.basis.digest);
  const noteArtifact = noteRequeue.newInputRefs[0]!;

  // ND-3: Run 3 FAILs the same way; the automatic requeue (no input) has the first requeue's key, so it is
  // refused although the latest requeue (the note) differs: every earlier TaskRequeue is compared.
  const afterNote = await h.advance(h.select('a11-after-note', W));
  expect(committedOutcomesOf(afterNote)).toEqual(['FAIL']);
  const run3Ref = await selectedRun(h);
  expect(requeueValues(afterNote).map(refusalOf)).toMatchObject([{ revision: 1, code: 'no_new_basis', afterRunRef: run3Ref,
    matchedRequeueRef: requeue1.ref }]);
  // #22: the same note again is the same Artifact: no new basis, matched to the note's requeue.
  const sameNote = await platformRequeue(h, 'a11-same-note', run3Ref, { input: { note: NOTE } });
  expect(refusalOf(sameNote)).toMatchObject({ revision: 2, code: 'no_new_basis', matchedRequeueRef: noteRequeue.ref });
  await assertInvariants(h, '#22 same note', stepOf(h, 'task_rework_refused', '#22 same note', SCENARIO_OPERATOR));

  // #20 (as a system request; an Agent cannot be granted requeue_task, GAP-46): the stored Artifact used before
  // is no new basis ...
  const usedArtifact = await platformRequeue(h, 'a11-used-artifact', run3Ref, { actor: WORKFLOW_AUTOMATION_ACTOR, refusalPin: 2,
    input: { newInputRefs: [noteArtifact] } });
  expect(refusalOf(usedArtifact)).toMatchObject({ revision: 3, code: 'no_new_basis', matchedRequeueRef: noteRequeue.ref,
    requestedBy: WORKFLOW_AUTOMATION_ACTOR });
  await assertInvariants(h, '#20 used Artifact', stepOf(h, 'task_rework_refused', '#20 used Artifact', WORKFLOW_AUTOMATION_ACTOR));
  // ... a newly stored one (the body of an operator's message: a stored Artifact, not a platform body) is.
  const run3Record = await platformRun(h, run3Ref);
  const message = await h.platform.messages.sendMessage(h.ctx(), { meta: { requestId: 'a11-diagnosis', expected: [] },
    input: { recipient: { projectId: run3Record.session.ref.projectId, sessionId: run3Record.session.ref.sessionId },
      text: 'A11 diagnosis: the check command ignores the workspace' } });
  if (message.status !== 'committed') throw new Error(`the message must commit: ${JSON.stringify(message)}`);
  await assertInvariants(h, '#20 diagnosis message', stepOf(h, 'other', '#20 diagnosis message', SCENARIO_OPERATOR));
  const artifactInput = { newInputRefs: [{ kind: 'artifact' as const, ref: message.value.bodyRef }] };
  const newArtifact = requeuedOf(await platformRequeue(h, 'a11-new-artifact', run3Ref, { actor: WORKFLOW_AUTOMATION_ACTOR, refusalPin: 3,
    input: artifactInput }));
  expect(newArtifact).toMatchObject({ basisComparison: 'compared', requestedBy: WORKFLOW_AUTOMATION_ACTOR,
    automation: { automatic: true, counted: true, autoCount: 1 }, newInputRefs: [{ kind: 'artifact', ref: message.value.bodyRef }] });
  await assertInvariants(h, '#20 new Artifact', stepOf(h, 'task_requeued', '#20 new Artifact', WORKFLOW_AUTOMATION_ACTOR));
  // #20, the row's order: Run 4 claims that requeue and FAILs the same way; the same Artifact cited again is no
  // new basis: refused, matched to the requeue that introduced it.
  const run4Fail = await h.advance(h.select('a11-artifact-again', W), { stopBefore: performs('requeue_task') });
  expect(committedOutcomesOf(run4Fail)).toEqual(['FAIL']);
  const run4Ref = await selectedRun(h);
  expect(run4Ref.runId).not.toBe(run3Ref.runId);
  const sameArtifact = await platformRequeue(h, 'a11-same-artifact', run4Ref, { actor: WORKFLOW_AUTOMATION_ACTOR, input: artifactInput });
  expect(refusalOf(sameArtifact)).toMatchObject({ revision: 1, code: 'no_new_basis', afterRunRef: run4Ref,
    matchedRequeueRef: newArtifact.ref, basisDigest: newArtifact.basis.digest, requestedBy: WORKFLOW_AUTOMATION_ACTOR });
  await assertInvariants(h, '#20 same Artifact again',
    stepOf(h, 'task_rework_refused', '#20 same Artifact again', WORKFLOW_AUTOMATION_ACTOR));
  expect(h.modelCalls(), 'Runs 1–4 of work-1 and work-2\'s Run; no refusal called a model').toBe(5);
}, 120_000);

// ---------------------------------------------------------------------------
// 3. ND-4 (#14) and L-4 (#6)
// ---------------------------------------------------------------------------

it('A11 #14 (ND-4), #6 (L-4): a Run that changed an unrelated file lets the second requeue pass; an unrelated adoption changes no key, so the request it made stale is re-made and refused', async () => {
  const h = await openPlatformScenario({ check: 'fail', workIds: [W, WORK_2], script: { replies: [
    textReply('A11 Run 1 changes nothing'), textReply('A11 Run 2 changes nothing'),
    ...WRITE_THEN_TEXT('a11-unrelated', 'src/a11-unrelated.txt'), textReply('A11 Run 3 changes nothing')] } });
  const toSecond = await h.advance(h.select('a11-nd4', W), { stopBefore: beforeRequeue(h, 2) });
  expect(toSecond.state).toBe('stopped');
  expect(committedOutcomesOf(toSecond)).toEqual(['FAIL', 'FAIL']);
  const requeue1 = requeuedOf(requeueValues(toSecond)[0]);

  // #14: work-2's Run writes a file no check reads, in the same workspace, and FAILs.
  const other = await h.advance(h.select('a11-nd4-other', WORK_2), { stopBefore: performs('requeue_task') });
  expect(committedOutcomesOf(other)).toEqual(['FAIL']);
  expect(existsSync(join(h.root, 'src', 'a11-unrelated.txt'))).toBe(true);
  // work-1's second requeue: the same failure and basis Plan, another whole-workspace source digest → it passes
  // (ND-4: the key is the whole workspace; the known limit of concurrent writes). Run 3 then FAILs the same way.
  const passed = await h.advance(h.select('a11-nd4-retry', W), { stopBefore: beforeRequeue(h, 3) });
  const requeue2 = requeuedOf(requeueValues(passed)[0]);
  expect(requeue2).toMatchObject({ basisComparison: 'compared', automation: { automatic: true, autoCount: 2 } });
  expect(requeue2.basis.failure).toEqual(requeue1.basis.failure);
  expect(requeue2.basis.plan).toEqual(requeue1.basis.plan);
  expect(requeue2.basis.newInputDigest).toBeNull();
  expect(requeue2.basis.source.sourceDigest).not.toBe(requeue1.basis.source.sourceDigest);
  expect(committedOutcomesOf(passed)).toEqual(['FAIL']);
  const staleRequest = passed.next!;
  expect(staleRequest).toMatchObject({ operation: { kind: 'requeue_task' } });

  // #6 (L-4): the operator adopts P2, which only adds an optional Task: work-1's definition and basis stay P1's.
  const p2 = await adoptPlan(h, 'a11-unrelated-plan', await nextPlanDraft(h.platform, 'ag2b-plan-2', draft => ({ ...draft,
    tasks: [...draft.tasks, { taskId: 'ag2b-extra', title: 'Unrelated extra work', requirementLevel: 'optional', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' }],
    assignments: [...(draft.assignments ?? []), { taskId: 'ag2b-extra', role: 'builder', instruction: 'Unrelated extra work' }] })),
  { text: 'A11: add unrelated work', sources: [] });
  await assertInvariants(h, '#6 unrelated adoption', stepOf(h, 'plan_adopted', '#6 unrelated adoption', SCENARIO_OPERATOR));
  expect(p2.ref).not.toEqual(requeue1.basis.plan);
  // The request made before the adoption pinned the Goal's old revision: `revision_conflict`, back to the
  // selection; the re-made request has the second requeue's key (the basis Plan is still P1) and is refused.
  const refused = await h.advance(staleRequest);
  expect(refused.receipts.filter(receipt => receipt.kind === 'requeue_task').map(receipt => receipt.result)).toMatchObject([
    { status: 'rejected', code: 'revision_conflict' },
    { status: 'committed', value: { kind: 'refused', refusal: { revision: 1, code: 'no_new_basis', matchedRequeueRef: requeue2.ref,
      basisDigest: requeue2.basis.digest } } }]);
  expect(refused.state).toBe('waiting');
  expect(h.lastWorld?.requeues).toHaveLength(2);
  expect(h.modelCalls(), 'work-1 Runs 1–3 and work-2\'s two-step Run').toBe(5);
}, 120_000);

// ---------------------------------------------------------------------------
// 4. The cap (#15)
// ---------------------------------------------------------------------------

it('A11 #15: an automatic requeue past the limit is the committed auto_rework_cap_reached refusal (before any source capture); the operator\'s requeue then passes and counts 0', async () => {
  const h = await openPlatformScenario({ check: 'fail', script: { replies: [textReply('A11 cap: Run 1 changes nothing'),
    ...WRITE_THEN_TEXT('a11-cap-run-2', 'src/a11-cap.txt')] } });
  // Run 1 FAILs → automatic requeue #1 of 3; Run 2 changes a file and FAILs: the next request is #2.
  const toSecond = await h.advance(h.select('a11-cap', W), { stopBefore: beforeRequeue(h, 2) });
  expect(committedOutcomesOf(toSecond)).toEqual(['FAIL', 'FAIL']);
  expect(requeueValues(toSecond).map(requeuedOf)).toMatchObject([{ automation: { autoCount: 1, cap: 3 } }]);
  const request = toSecond.next!;
  expect(request).toMatchObject({ operation: { kind: 'requeue_task', request: { input: { reason: 'auto-rework:check_failed#2' } } } });
  // The limit drops to 1 before that request is performed (a setting changed while another driver held it).
  h.setAutomation({ schemaVersion: 1, autoReworkLimit: 1, resumeOnStartup: true });
  expect(await h.taskRow()).toMatchObject({ failure: { automation: { cap: 1,
    verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached' } } } });
  // The owner refuses it by the limit: committed, no key and no source (the cap is checked first, ND-7).
  const capped = await h.advance(request);
  expect(requeueValues(capped).map(refusalOf)).toMatchObject([{ revision: 1, code: 'auto_rework_cap_reached', basisDigest: null,
    source: null, matchedRequeueRef: null, requestedBy: WORKFLOW_AUTOMATION_ACTOR }]);
  expect(capped.state).toBe('waiting');
  const stoppedAt = h.counts();
  expect(await h.advance(h.select('a11-cap-again', W))).toMatchObject({ state: 'waiting', receipts: [] });
  expect(h.counts()).toEqual(stoppedAt);
  expect(await h.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30', cause: { code: 'auto_rework_cap_reached', taskId: W } });
  // The operator is not capped (C8) and the count starts again at 0; Run 2 changed a file, so its key is new.
  const operator = requeuedOf(await platformRequeue(h, 'a11-cap-operator', await selectedRun(h)));
  await assertInvariants(h, '#15 operator requeue', stepOf(h, 'task_requeued', '#15 operator requeue', SCENARIO_OPERATOR));
  expect(operator).toMatchObject({ basisComparison: 'compared', automation: { automatic: false, counted: false, autoCount: 0, cap: null } });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'pending', requeueRef: operator.ref });
  expect(h.modelCalls()).toBe(3);
}, 120_000);

// ---------------------------------------------------------------------------
// 5. Budgets (#19, #16)
// ---------------------------------------------------------------------------

/**
 * A Run that uses the AG2b runtime's 16 tool calls, then asks for one more: the Kernel limit ends it
 * `budget_exhausted` (as tests/scenarios/C8-budget.test.ts, moved from the deleted
 * tests/composition/A2-auto-rework-budget-platform.test.ts, does with a limit of 1).
 */
const EXHAUST = (label: string): ScriptedReply[] => [16, 1].map((count, group) => ({ kind: 'calls' as const,
  calls: Array.from({ length: count }, (_, index) => ({ callId: `${label}-${group}-${index}`, name: 'read', args: { path: 'src/module.ts' } })) }));

it('A11 #19, #16: after budget_exhausted a requeue with no larger budget is budget_not_increased (before any key); a larger budget passes as a different failure each time; the same budget again is refused', async () => {
  const h = await openPlatformScenario({ check: 'pass', tokenBudget: 100_000,
    script: { replies: [...EXHAUST('a11-budget-1'), ...EXHAUST('a11-budget-2'), ...EXHAUST('a11-budget-3')] } });
  const exhausted = async (label: string, tokenBudget: number): Promise<RunRef> => {
    const driven = await h.advance(h.select(label, W));
    expect(driven.state).toBe('waiting');
    expect(requeueValues(driven), 'the Workflow requeues nothing after budget_exhausted').toEqual([]);
    const runRef = await selectedRun(h);
    expect((await platformRun(h, runRef)).run).toMatchObject({ status: 'ended', outcome: 'budget_exhausted', budget: { tokenBudget } });
    expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'run_failed',
      automation: { verdict: { kind: 'stopped', reason: 'budget_exhausted', detail: { minTokenBudgetExclusive: tokenBudget } } } } });
    return runRef;
  };
  const budget = (tokenBudget: number) => ({ tokenBudget, deadline: null });

  const run1Ref = await exhausted('a11-budget-1', 100_000);
  // #19: neither a larger budget nor a new input: refused before the key (no basis, no source).
  expect(refusalOf(await platformRequeue(h, 'a11-budget-same', run1Ref))).toMatchObject({ revision: 1, code: 'budget_not_increased',
    basisDigest: null, source: null, matchedRequeueRef: null, requestedBy: SCENARIO_OPERATOR });
  await assertInvariants(h, '#19 refused', stepOf(h, 'task_rework_refused', '#19 refused', SCENARIO_OPERATOR));
  // #16: 200k passes (no earlier TaskRequeue) and the claim carries it; Run 2 exhausts it.
  const requeue1 = requeuedOf(await platformRequeue(h, 'a11-budget-200k', run1Ref, { input: { budget: budget(200_000) } }));
  await assertInvariants(h, '#16 200k', stepOf(h, 'task_requeued', '#16 200k', SCENARIO_OPERATOR));
  expect(requeue1).toMatchObject({ budget: budget(200_000), basis: { failure: { outcome: 'budget_exhausted', exhaustedTokenBudget: 100_000 } } });
  const run2Ref = await exhausted('a11-budget-2', 200_000);
  // 400k passes: the same source, plan and checks, but a Run exhausted at 200k is a different failure.
  const requeue2 = requeuedOf(await platformRequeue(h, 'a11-budget-400k', run2Ref, { input: { budget: budget(400_000) } }));
  await assertInvariants(h, '#16 400k', stepOf(h, 'task_requeued', '#16 400k', SCENARIO_OPERATOR));
  expect(requeue2).toMatchObject({ basisComparison: 'compared', budget: budget(400_000),
    basis: { failure: { exhaustedTokenBudget: 200_000 }, source: requeue1.basis.source } });
  expect(requeue2.basis.digest).not.toBe(requeue1.basis.digest);
  const run3Ref = await exhausted('a11-budget-3', 400_000);
  // 400k again is not larger than the exhausted budget: budget_not_increased, before the key is compared.
  expect(refusalOf(await platformRequeue(h, 'a11-budget-400k-again', run3Ref, { input: { budget: budget(400_000) } })))
    .toMatchObject({ revision: 1, code: 'budget_not_increased', basisDigest: null, afterRunRef: run3Ref });
  await assertInvariants(h, '#16 refused', stepOf(h, 'task_rework_refused', '#16 refused', SCENARIO_OPERATOR));
  expect(h.modelCalls(), 'two model calls per Run, none for a refusal').toBe(6);
}, 120_000);

// ---------------------------------------------------------------------------
// 6. Paused-interrupted (#23, #24)
// ---------------------------------------------------------------------------

it('A11 #23, #24: a paused-interrupted Task: a system requeue is forbidden while the Goal is active and busy while it is paused (so is the operator\'s); after the Goal resumes the operator\'s 继续 passes with the comparison skipped', async () => {
  let scenario: HostScenario | undefined;
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'fail', script: {
    replies: [{ kind: 'calls', calls: [{ callId: 'a11-paused-read', name: 'read', args: { path: 'src/module.ts' } }] },
      textReply('A11 #23: never reached, the Run pauses first')],
    // During the first model call the operator pauses the Run: the Kernel pauses at the safe point after the read.
    duringReply: async (index) => {
      if (index !== 0 || scenario === undefined) return;
      const runRef = await selectedRun(scenario);
      const run = await execution(scenario, runRef);
      expect(await scenario.post('controls/submit', graphWrite(AG2B_SCOPE, { runRef, kind: 'pause', reason: 'the operator pauses' },
        'a11-pause', [{ ref: runRef, revision: run.run.revision }]))).toMatchObject({ status: 'committed' });
    } } });
  scenario = h;
  const paused = await h.advance(h.select('a11-paused', W));
  expect(paused.state).toBe('waiting');
  expect(h.modelCalls()).toBe(1);
  const runRef = await selectedRun(h);
  // The Host stops while the Run is paused (a clean close, then a stale lock): the next start ends it
  // paused-interrupted (W-20, RUN-24).
  const report = await h.restart({ staleLock: true });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-20', status: 'reconciled' }], problems: [] });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted' } });
  const atRestart = h.counts();

  const direct = await h.direct();
  /** A system requeue without a goal_resume trigger (as the Workflow automation), at the current pins. */
  const systemRequeue = async (requestId: string) => {
    const goal = await direct.plans.queryGoal(hostCtx(), AG2B_GOAL_REF);
    const run = await direct.executions.readExecution(hostCtx(), runRef);
    if (goal.status !== 'ready' || run.status !== 'ready') throw new Error('the Goal and the Run must be readable');
    return direct.claims.requeueTask!(hostCtx(WORKFLOW_AUTOMATION_ACTOR), { meta: { requestId, expected: [
      { ref: AG2B_GOAL_REF, revision: goal.value.goal.revision }, { ref: runRef, revision: run.value.run.revision }] },
    input: { taskRef: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: W }, afterRunRef: runRef,
      reason: 'continue as the system' } });
  };
  // #24's first half, Goal active: `forbidden` (only a person, or the Goal-resume fan-out, continues), before any
  // key comparison. A8-3l asserts the same refusal on its W-20 path; here it is the contrast for the `busy` below.
  expect(await systemRequeue('a11-system-active')).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(h.counts()).toEqual(atRestart);
  // #24, Goal paused: `busy` first (resume the Goal first), for the system and the operator alike.
  expect(await controlGoal(h.host, 'pause', 'a11-goal-pause')).toMatchObject({ status: 'committed' });
  await assertInvariants(h, 'Goal paused', stepOf(h, 'other', 'Goal paused', SCENARIO_OPERATOR));
  const goalPaused = h.counts();
  expect(await systemRequeue('a11-system-paused')).toMatchObject({ status: 'rejected', code: 'busy' });
  expect((await requeueWithBody(h, 'a11-operator-paused', runRef, W)).answer).toMatchObject({ status: 'rejected', code: 'busy' });
  expect(h.counts()).toEqual(goalPaused);
  expect(await controlGoal(h.host, 'resume', 'a11-goal-resume')).toMatchObject({ status: 'committed' });
  await assertInvariants(h, 'Goal resumed', stepOf(h, 'other', 'Goal resumed', SCENARIO_OPERATOR));
  // #23: the operator's 继续 passes; the class `interrupted` (paused) skips the comparison (ND-5, C4).
  const continued = await requeueWithBody(h, 'a11-continue', runRef, W);
  expect(continued.answer).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: { afterRunRef: runRef,
    failureClass: 'interrupted', interruption: 'paused', basisComparison: 'skipped_interrupted',
    basis: { failure: { outcome: 'crashed', origin: 'host_interrupted' } } } } });
  await assertInvariants(h, '#23 继续', stepOf(h, 'task_requeued', '#23 继续', SCENARIO_OPERATOR));
  expect(h.modelCalls()).toBe(1);
}, 120_000);

// ---------------------------------------------------------------------------
// 7. The first requeue (#1), a changed source (#3), S1→S2→S1 (#10), another reason (#5), a manual edit (#11)
// ---------------------------------------------------------------------------

/** `stopBefore` for the claim after the `n`-th TaskRequeue was written. */
const claimAfterRequeue = (h: HostScenario | PlatformScenario, n: number) => (input: WorkflowAdvanceInput): boolean =>
  performs('claim_task')(input) && (h.lastWorld?.requeues.length ?? 0) === n;

it('A11 #1, #3, #10 (ND-3), #5, #11: the first requeue passes; a Run that changed a file passes; a source back at S1 meets the first key; another reason is no new basis; a manual edit after the failure is', async () => {
  const S2 = 'src/a11-s2.txt';
  const h = await openPlatformScenario({ check: 'fail', script: { replies: [textReply('A11 Run 1 changes nothing'),
    ...WRITE_THEN_TEXT('a11-s2', S2), textReply('A11 Run 3 changes nothing')] } });

  // #1: Run 1 FAILs; the first requeue has nothing to compare with and passes; the Task is pending on it.
  const first = await h.advance(h.select('a11-first', W), { stopBefore: claimAfterRequeue(h, 1) });
  expect(first.state).toBe('stopped');
  expect(committedOutcomesOf(first)).toEqual(['FAIL']);
  const requeue1 = requeuedOf(requeueValues(first)[0]);
  expect(requeue1).toMatchObject({ basisComparison: 'compared', automation: { automatic: true, counted: true, autoCount: 1 } });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'pending', requeueRef: requeue1.ref });

  // #3: Run 2 writes a file (S1 → S2) and FAILs the same way: the same failure and Plan, another source → it passes.
  // Run 3 FAILs on S2; its automatic requeue is kept.
  const toThird = await h.advance(first.next!, { stopBefore: beforeRequeue(h, 3) });
  expect(committedOutcomesOf(toThird)).toEqual(['FAIL', 'FAIL']);
  const requeue2 = requeuedOf(requeueValues(toThird)[0]);
  expect(requeue2).toMatchObject({ basisComparison: 'compared', automation: { autoCount: 2 } });
  expect(requeue2.basis.failure).toEqual(requeue1.basis.failure);
  expect(requeue2.basis.plan).toEqual(requeue1.basis.plan);
  expect(requeue2.basis.source.sourceDigest).not.toBe(requeue1.basis.source.sourceDigest);
  const run3Ref = await selectedRun(h);

  // #10 (ND-3): the file goes away again (S2 → S1), then Run 3's automatic requeue is performed. The latest
  // requeue's key (S2) differs; the first one's (S1) does not → refused, matched to the first requeue.
  await rm(join(h.root, S2));
  const backAtS1 = await h.advance(toThird.next!);
  expect(requeueValues(backAtS1).map(refusalOf)).toMatchObject([{ revision: 1, code: 'no_new_basis', afterRunRef: run3Ref,
    matchedRequeueRef: requeue1.ref, basisDigest: requeue1.basis.digest }]);
  expect(backAtS1.state).toBe('waiting');

  // #5 (as a system request; an Agent cannot be granted requeue_task, GAP-46): only another reason → no new basis.
  const otherReason = await platformRequeue(h, 'a11-other-reason', run3Ref, { actor: WORKFLOW_AUTOMATION_ACTOR, refusalPin: 1,
    input: { reason: 'auto-rework: the check may pass this time' } });
  expect(refusalOf(otherReason)).toMatchObject({ revision: 2, code: 'no_new_basis', matchedRequeueRef: requeue1.ref,
    basisDigest: requeue1.basis.digest, requestedBy: WORKFLOW_AUTOMATION_ACTOR });
  await assertInvariants(h, '#5 another reason', stepOf(h, 'task_rework_refused', '#5 another reason', WORKFLOW_AUTOMATION_ACTOR));

  // #11: a person edits a file after the failure; the operator's requeue with nothing else passes on the new source.
  await writeFile(join(h.root, 'src', 'a11-manual.txt'), 'A11: edited by hand after the failure\n');
  const manual = requeuedOf(await platformRequeue(h, 'a11-manual-edit', run3Ref));
  await assertInvariants(h, '#11 manual edit', stepOf(h, 'task_requeued', '#11 manual edit', SCENARIO_OPERATOR));
  expect(manual).toMatchObject({ afterRunRef: run3Ref, basisComparison: 'compared', automation: { automatic: false } });
  expect(manual.basis.failure).toEqual(requeue1.basis.failure);
  expect(manual.basis.newInputDigest).toBeNull();
  expect([requeue1, requeue2].map(requeue => requeue.basis.source.sourceDigest)).not.toContain(manual.basis.source.sourceDigest);
  expect(h.modelCalls(), 'Runs 1 and 3 one call each, Run 2 two; no requeue or refusal called a model').toBe(4);
}, 120_000);

// ---------------------------------------------------------------------------
// 8. Another failing check (#7) and an unknown outcome (#8)
// ---------------------------------------------------------------------------

/**
 * One reply of 17 tool calls, one more than the AG2b runtime grant (`maxToolCalls: 16`): the Kernel stops the
 * Turn after the 16 calls started (`run.limit_exceeded`, no tool result, no Turn terminal), so the Run ends
 * `outcome_unknown`, quarantined with `tool_calls_unresolved` (DEFECTS.md O-2, closed as not a defect).
 */
const UNKNOWN = (label: string): ScriptedReply => ({ kind: 'calls', calls: Array.from({ length: 17 }, (_, index) =>
  ({ callId: `${label}-${index}`, name: 'read', args: { path: 'src/module.ts' } })) });

it('A11 #7, #8: c1 turning PASS while c2 FAILs is another failure, so the requeue passes on the same source; after a Run that ended outcome_unknown every requeue is busy before any policy step', async () => {
  const h = await openPlatformScenario({ check: 'fail', script: { replies: [textReply('A11 #7 Run 1 changes nothing'),
    textReply('A11 #7 Run 2 changes nothing'), UNKNOWN('a11-unknown')] } });
  // Two registered checks: c1 FAILs, c2 PASSes.
  registerTwoChecks(h, 1, { c1: 1, c2: 0 });
  const first = await h.advance(h.select('a11-checks', W), { stopBefore: claimAfterRequeue(h, 1) });
  expect(committedOutcomesOf(first)).toEqual(['FAIL']);
  const requeue1 = requeuedOf(requeueValues(first)[0]);
  expect(requeue1.basis.failure.checks).toMatchObject([{ checkId: 'a11-c1', outcome: 'FAIL' }]);

  // #7: Run 2's round freezes the next configuration (the same ids): c1 PASSes, c2 FAILs. Nothing else changed: the
  // same source, Plan and inputs, another failure → the second automatic requeue passes.
  registerTwoChecks(h, 2, { c1: 0, c2: 1 });
  const second = await h.advance(first.next!, { stopBefore: claimAfterRequeue(h, 2) });
  expect(committedOutcomesOf(second)).toEqual(['FAIL']);
  const requeue2 = requeuedOf(requeueValues(second)[0]);
  expect(requeue2).toMatchObject({ basisComparison: 'compared', automation: { automatic: true, autoCount: 2 } });
  expect(requeue2.basis.failure.checks).toMatchObject([{ checkId: 'a11-c2', outcome: 'FAIL' }]);
  expect(requeue2.basis.source).toEqual(requeue1.basis.source);
  expect(requeue2.basis.plan).toEqual(requeue1.basis.plan);
  expect(requeue2.basis.newInputDigest).toBeNull();
  expect(requeue2.basis.digest).not.toBe(requeue1.basis.digest);

  // #8: Run 3 ends outcome_unknown. A requeue is `busy` (reconcile first, 13.2 point 3) for the system and for the
  // operator, even with a note that would be a new basis: no comparison, no refusal record, nothing written.
  const unknown = await h.advance(second.next!);
  expect(unknown.state).toBe('waiting');
  const run3Ref = await selectedRun(h);
  expect((await platformRun(h, run3Ref)).run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  const atUnknown = h.counts();
  expect(await platformRequeue(h, 'a11-unknown-system', run3Ref, { actor: WORKFLOW_AUTOMATION_ACTOR }))
    .toMatchObject({ status: 'rejected', code: 'busy' });
  expect(await platformRequeue(h, 'a11-unknown-operator', run3Ref, { input: { note: 'A11 #8: look at the check command' } }))
    .toMatchObject({ status: 'rejected', code: 'busy' });
  expect(h.counts(), 'no refusal record, no write').toEqual(atUnknown);
  expect(h.ledgerEventTypes()).not.toContain('TaskReworkRefused');
  expect(h.modelCalls()).toBe(3);
}, 120_000);

// ---------------------------------------------------------------------------
// 9. A responded message as the new input (#4)
// ---------------------------------------------------------------------------

it('A11 #4: a message its recipient has answered is a new basis, so the requeue passes; the same message before the answer is not admitted', async () => {
  const QUESTION = 'A11 #4 question: does the static check read the workspace at all?';
  const ANSWER = 'A11 #4 answer: no, it exits 1 whatever the files hold';
  const ask = { callId: 'a11-ask', name: 'send_session_message',
    args: { recipient: {}, text: QUESTION, replyMode: 'wait' } as Record<string, unknown> };
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'fail', workIds: [W, WORK_2], script: {
    replies: [textReply('A11 #4 Run 1 changes nothing'), textReply('A11 #4 Run 2 changes nothing'), { kind: 'calls', calls: [ask] }],
    queryReplies: [textReply(ANSWER)] } });
  const recipient = (await createAG2bSession(h.host, 'a11-recipient', AG2B_QUERY_ROLE, [{ target: { kind: 'task',
    ref: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: WORK_2 } }, relation: 'participates' }])).sessionRef;
  ask.args['recipient'] = { projectId: recipient.projectId, sessionId: recipient.sessionId };
  await assertInvariants(h, 'recipient Session created', stepOf(h, 'other', 'recipient Session created', SCENARIO_OPERATOR));

  // As #2: Run 1 FAILs, the first requeue passes, Run 2 FAILs the same way; its automatic requeue is not made.
  const toSecond = await h.advance(h.select('a11-reply', W), { stopBefore: beforeRequeue(h, 2) });
  expect(committedOutcomesOf(toSecond)).toEqual(['FAIL', 'FAIL']);
  const requeue1 = requeuedOf(requeueValues(toSecond)[0]);
  const run2Ref = await selectedRun(h);
  // work-2's Run asks the recipient a question and waits for the reply (yielded).
  expect((await h.advance(h.select('a11-reply-ask', WORK_2))).state).toBe('waiting');
  const asked = (await execution(h, await selectedRun(h, WORK_2))).run;
  expect(asked).toMatchObject({ status: 'ended', outcome: 'yielded', continuation: { kind: 'wait_reply' } });
  if (asked.continuation === undefined) throw new Error('the yielded Run must have its continuation');
  const messageRef = asked.continuation.messageRef;
  const replyInput = { newInputRefs: [{ kind: 'session_message', ref: messageRef }] };
  // Not answered yet: `invalid` (only a responded message is a new basis), nothing written.
  const beforeReply = h.counts();
  expect((await requeueWithBody(h, 'a11-reply-pending', run2Ref, W, replyInput)).answer)
    .toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(h.counts()).toEqual(beforeReply);

  // The recipient answers through the formal consultation (the query model): the message is responded.
  expect(await h.post('workflow/consultation', plain(AG2B_SCOPE, { schemaVersion: 1, messageRef, goalRef: AG2B_GOAL_REF,
    roleBinding: AG2B_QUERY_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID })))
    .toMatchObject({ status: 'ready', value: { state: 'responded' } });
  await assertInvariants(h, 'the question is answered');
  // #4: the answered message as the new input: the same failure, source and Plan, another newInputDigest → passes.
  const withReply = await requeueWithBody(h, 'a11-reply', run2Ref, W, replyInput);
  expect(withReply.answer).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: { afterRunRef: run2Ref,
    basisComparison: 'compared', newInputRefs: [{ kind: 'session_message', ref: messageRef }] } } });
  await assertInvariants(h, '#4 requeued', stepOf(h, 'task_requeued', '#4 requeued', SCENARIO_OPERATOR));
  const requeue2 = requeuedOf(withReply.answer);
  expect(requeue2.basis.failure).toEqual(requeue1.basis.failure);
  expect(requeue2.basis.source.sourceDigest).toBe(requeue1.basis.source.sourceDigest);
  expect(requeue2.basis.plan).toEqual(requeue1.basis.plan);
  expect(requeue1.basis.newInputDigest).toBeNull();
  expect(requeue2.basis.newInputDigest).not.toBeNull();
  expect(h.modelCalls(), 'work-1 Runs 1 and 2, work-2 asking, the consultation').toBe(4);
}, 120_000);

// ---------------------------------------------------------------------------
// 10. Host interruptions (#12) and Kernel-reported crashes (#13, #9)
// ---------------------------------------------------------------------------

it('A11 #12, #13, #9: two Runs interrupted by a Host restart in a row are requeued with the comparison skipped (the same key); a Kernel-reported crash after them is another origin and passes; a second one on the same source is refused', async () => {
  // Work model calls 0 and 1 are held while their Host crashes (W-11, origin host_interrupted); calls 2 and 3 have
  // no reply, so the provider call fails and the Kernel ends the Turn (crashed, origin observed).
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'fail', script: { replies: [
    textReply('A11 #12: never answered, the Host crashes first'), textReply('A11 #12: never answered either')] } });
  const interrupted = async (label: string, call: number): Promise<{ runRef: RunRef; drive: Driven }> => {
    const drive = await h.advance(h.select(label, W), { stopBefore: performs('start') });
    const runRef = await selectedRun(h);
    const held = h.holdReply(call);
    void h.post('workflow/advance', plain(AG2B_SCOPE, drive.next!)).catch(() => undefined);
    await held.reached;
    const restarted = await h.restart({ crash: true });
    expect(restarted.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-11', status: 'reconciled',
      reason: 'interrupted_clean' }], problems: [] });
    return { runRef, drive };
  };
  const run1 = await interrupted('a11-interrupt-1', 0);
  const run2 = await interrupted('a11-interrupt-2', 1);
  const requeue1 = requeuedOf(requeueValues(run2.drive)[0]);
  expect(requeue1).toMatchObject({ afterRunRef: run1.runRef, failureClass: 'interrupted', basisComparison: 'skipped_interrupted',
    automation: { automatic: true, counted: false, autoCount: 0 }, basis: { failure: { outcome: 'crashed', origin: 'host_interrupted' } } });

  // One 推进 from here: the second interruption's requeue, Run 3 crashed by the Kernel, its requeue, Run 4 crashed
  // the same way, its refusal; then nothing.
  const rest = await h.advance(h.select('a11-after-interrupts', W));
  expect(rest.state).toBe('waiting');
  const [second, third, fourth, ...more] = requeueValues(rest);
  expect(more).toEqual([]);
  // #12: nothing changed between the two interruptions, so the key is the first one's; the comparison is skipped.
  const requeue2 = requeuedOf(second);
  expect(requeue2).toMatchObject({ afterRunRef: run2.runRef, failureClass: 'interrupted', basisComparison: 'skipped_interrupted',
    automation: { counted: false, autoCount: 0 } });
  expect(requeue2.basis.digest).toBe(requeue1.basis.digest);
  // #13: Run 3 crashed by a Kernel-reported error on the same source: only `failure.origin` differs → compared, passes.
  const requeue3 = requeuedOf(third);
  expect(requeue3).toMatchObject({ failureClass: 'run_failed', basisComparison: 'compared', automation: { counted: true, autoCount: 1 } });
  expect(requeue3.basis.failure).toEqual({ ...requeue1.basis.failure, origin: 'observed' });
  expect(requeue3.basis.source.sourceDigest).toBe(requeue1.basis.source.sourceDigest);
  expect(requeue3.basis.plan).toEqual(requeue1.basis.plan);
  // #9: Run 4 crashed the same way with no change: the same key as the third requeue → refused.
  const run4Ref = await selectedRun(h);
  expect((await execution(h, run4Ref)).run).toMatchObject({ status: 'ended', outcome: 'crashed' });
  expect(refusalOf(fourth)).toMatchObject({ revision: 1, code: 'no_new_basis', afterRunRef: run4Ref, matchedRequeueRef: requeue3.ref,
    basisDigest: requeue3.basis.digest });
  expect(h.modelCalls(), 'two held calls, two failed provider calls').toBe(4);
  expect(h.abandonedCalls(), 'the abandoned Hosts started no model call').toEqual([]);
  await h.drainAbandoned();
  await assertInvariants(h, 'after draining the abandoned Hosts');
}, 120_000);
