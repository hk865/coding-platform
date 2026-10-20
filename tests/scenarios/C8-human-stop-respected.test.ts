/**
 * A.2 step 6, scenario C8-human-stop-respected (docs/refactor/STATE-MACHINES-SPEC.md
 * §15.2 "第 6 步" row C8-human-stop-respected; C8 and hard limit 3; §4 TD-9 AV-4,
 * the actor × class matrix, TASK-16, ND-6 (§13.4 #18); §3 PLAN-05 W16 guard 9
 * (lead decision LA-3); §9 VR-14 step 5; I-17; STEP5-FLIPS §14 (AV-4 kept as written)).
 *
 * 1. The operator cancels the running Turn (`controls/submit`): the Run ends
 *    `cancelled` and the verdict is `stopped/task_cancelled`; the Workflow's 推进
 *    writes no TaskRequeue, calls no model and writes nothing; the platform
 *    automation's requeue is `forbidden`; the operator's requeue is accepted
 *    without a new basis (ND-6): after a second cancel on the same unchanged
 *    files the operator requeues again with the same key, `skipped_human_cancel`.
 *    The driver path: the operator stops the collaboration driver
 *    (`workflow/driver-stop`) while its Turn runs; the driver's cancel is the
 *    operator's, and the same answers follow.
 * 2. Variant: the operator's pause pointer stays on a Run that crashed (the
 *    provider failed before any safe point): `stopped/task_paused`, the same
 *    answers. The class is `run_failed`, so the operator's requeue is compared
 *    (ND-6 skips only a cancel): the first passes, and a second one after Run 2
 *    crashes the same way on unchanged files is refused `no_new_basis`.
 * 3. Variant: the Host is started with a `{kind:'system'}` actor. Its
 *    `controls/submit` cancel is still an operator's (`stopped/task_cancelled`),
 *    the Workflow requeues nothing and the automation's requeue is `forbidden`.
 * 4. LA-3 (W16 guard 9): an Agent Run (a coordinator Task with the W2
 *    whiteboard tools, support/common.ts `PlanBoard`) proposes a parallel
 *    carrier for the obligation whose only active work a person cancelled;
 *    adopting it through `apply_future_plan` is `forbidden`, and its requeue of
 *    the cancelled work is `forbidden`; the operator adopts the same candidate.
 * 5. AV-4 kept as written: a pause superseded by the natural completion fences
 *    rework only; the round still opens, passes and completes the Task.
 * 6. VR-14 step 5: the same pause on an INCONCLUSIVE round fences the
 *    automation's reverify (`forbidden`, nothing written), not the operator's.
 * The §11 invariants are checked after every Workflow step with a receipt and
 * after every other write.
 *
 * Moved here (A.2 step 6, user decision 31), assertions kept: case 5 is
 * tests/app/A2-automation-verdict.test.ts test 4; case 6 is
 * tests/composition/A2-reverify-platform.test.ts test 3. Both now run on the
 * shared scenario harness (the same Host or composition root, the AG2b seed).
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkbenchActor } from '../../src/app/core-http-types.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readControl, readExecution, submitControl } from '../helpers/A2-restart-fixture.js';
import {
  assertInvariants, assertInvariantsAt, cleanupScenarios, hostCtx, openHostScenario, openPlatformScenario, performs, SCENARIO_OPERATOR,
  waitFor, workRunCtx, type HeldReply, type HostScenario, type PlatformScenario,
} from './harness.js';
import {
  PlanBoard, callArgs, cleanupCommon, operatorRequeue, readCall, reverifyRequest, toolOutputJson,
} from './support/common.js';
import { ownerRequeue } from './support/rework.js';

afterEach(async () => {
  await cleanupCommon();
  await cleanupScenarios();
});

const HUMAN_STOP = 'a human stopped this work; only an operator may rework it';
const NOT_EXECUTABLE = `the selected Task ${AG2B_WORK_TASK_ID} is not executable right now`;

/** The operator cancels the selected Run over `controls/submit` while its Turn calls the model. */
async function cancelRunningTurn(h: HostScenario, requestId: string): Promise<ControlIntentRef> {
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
  return (await submitControl(h.host, runRef, 'cancel', 'the operator stops this attempt', requestId)).intent.ref;
}

/** The automation actor's requeue through the owner (a Host principal acting as `WORKFLOW_AUTOMATION_ACTOR`). */
async function automationRequeue(h: HostScenario, afterRunRef: RunRef, requestId: string) {
  return ownerRequeue(await h.direct(), hostCtx({ ...WORKFLOW_AUTOMATION_ACTOR }), afterRunRef, requestId);
}

/** Another 推进, Task-level and Goal-level, writes nothing and calls no model; then the invariants read the world again. */
async function advanceWritesNothing(h: HostScenario, label: string): Promise<void> {
  const before = h.counts();
  expect(await h.advance(h.select(`${label}-task`, AG2B_WORK_TASK_ID)), label).toMatchObject({ state: 'waiting', reason: NOT_EXECUTABLE,
    receipts: [] });
  expect(await h.advance(h.select(`${label}-goal`)), label).toMatchObject({ state: 'waiting', receipts: [] });
  expect(h.counts(), `${label}: 0 model calls, 0 writes`).toEqual(before);
  await assertInvariants(h, `${label} (nothing written)`);
}

it('C8 hard limit 3 (§13.4 #18, ND-6): a human cancel stops the automation; 推进 writes nothing; the automation\'s requeue is forbidden; the operator requeues the unchanged files twice', async () => {
  let h!: HostScenario;
  const cancels: ControlIntentRef[] = [];
  h = await openHostScenario({ script: { replies: [readCall('c8-stop-run-1'), readCall('c8-stop-run-2')],
    duringReply: async (index) => { cancels.push(await cancelRunningTurn(h, `c8-stop-cancel-${index}`)); } } });
  await assertInvariants(h, 'seeded');

  // The cancel lands at the safe point after Run 1's tool group: the Run ends cancelled, the selection stops on it.
  const first = await h.advance(h.select('c8-stop-1', AG2B_WORK_TASK_ID));
  expect(first).toMatchObject({ state: 'waiting', reason: NOT_EXECUTABLE });
  expect(first.receipts.map(receipt => receipt.kind)).not.toContain('requeue_task');
  const stopped = await h.taskRow();
  const run1Ref = stopped.execution;
  if (run1Ref === null) throw new Error('Run 1 must be selected');
  expect((await readExecution(h.host, run1Ref)).run).toMatchObject({ status: 'ended', outcome: 'cancelled',
    controlState: { intentRef: cancels[0] } });
  expect(stopped).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'cancelled',
    stop: { intentRef: cancels[0], kind: 'cancel', requester: 'human' },
    automation: { verdict: { kind: 'stopped', reason: 'task_cancelled', detail: { fence: 'human_cancel' } } } } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'task_cancelled', taskId: AG2B_WORK_TASK_ID, detail: { fence: 'human_cancel' } } });
  expect(h.modelCalls()).toBe(1);

  // The Workflow's 推进: 0 TaskRequeue, 0 model calls, 0 writes.
  await advanceWritesNothing(h, 'c8-stop-1-again');
  expect(h.lastWorld?.requeues).toEqual([]);
  // The platform automation (system) may not rework what a human stopped (hard limit 3); nothing is written.
  const beforeRefusal = h.counts();
  expect(await automationRequeue(h, run1Ref, 'c8-stop-system-requeue'))
    .toMatchObject({ status: 'rejected', code: 'forbidden', reason: HUMAN_STOP });
  expect(h.counts()).toEqual(beforeRefusal);

  // The operator's requeue passes with no new basis (ND-6): the key is stored, not compared.
  const requeue1 = await operatorRequeue(h.host, run1Ref, 'c8-stop-requeue-1', 'the operator requeues the stopped work');
  if (requeue1.status !== 'committed' || requeue1.value.kind !== 'requeued') throw new Error(`requeue 1: ${JSON.stringify(requeue1)}`);
  expect(requeue1.value.requeue).toMatchObject({ afterRunRef: run1Ref, failureClass: 'cancelled', stopRequester: 'human',
    basisComparison: 'skipped_human_cancel', requestedBy: SCENARIO_OPERATOR, automation: { automatic: false, counted: false, autoCount: 0 } });
  await assertInvariants(h, 'operator requeue 1', { kind: 'task_requeued', actor: { ...SCENARIO_OPERATOR },
    automationPolicy: h.automationPolicy() });

  // The Workflow claims the requeue; the operator cancels Run 2 the same way; the files never changed.
  const second = await h.advance(h.select('c8-stop-2', AG2B_WORK_TASK_ID));
  expect(second).toMatchObject({ state: 'waiting', reason: NOT_EXECUTABLE });
  expect(second.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['claim_task', 'start']));
  expect(second.receipts.map(receipt => receipt.kind)).not.toContain('requeue_task');
  const run2Ref = (await h.taskRow()).execution;
  if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be selected');
  expect(await h.taskRow()).toMatchObject({ failure: { failureClass: 'cancelled',
    automation: { verdict: { kind: 'stopped', reason: 'task_cancelled' } } } });
  expect(h.lastWorld?.requeues, 'the Workflow wrote no TaskRequeue').toHaveLength(1);
  expect(h.modelCalls()).toBe(2);
  await advanceWritesNothing(h, 'c8-stop-2-again');

  // Same failure, same source, same plan, no new input: the same key. Compared, it would be no_new_basis;
  // the operator's requeue of a cancelled Task skips the comparison (ND-6, C2) and passes.
  const requeue2 = await operatorRequeue(h.host, run2Ref, 'c8-stop-requeue-2', 'the operator requeues the stopped work');
  if (requeue2.status !== 'committed' || requeue2.value.kind !== 'requeued') throw new Error(`requeue 2: ${JSON.stringify(requeue2)}`);
  expect(requeue2.value.requeue).toMatchObject({ afterRunRef: run2Ref, failureClass: 'cancelled', basisComparison: 'skipped_human_cancel',
    basis: { digest: requeue1.value.requeue.basis.digest } });
  await assertInvariants(h, 'operator requeue 2', { kind: 'task_requeued', actor: { ...SCENARIO_OPERATOR },
    automationPolicy: h.automationPolicy() });
  expect(h.lastWorld?.refusals).toEqual([]);
}, 120_000);

it('C8 hard limit 3, the driver path (人取消（驱动停止）): the operator stops the collaboration driver while its Turn runs; the driver cancels the Run as the operator; stopped/task_cancelled; 推进 writes nothing; the automation\'s requeue is forbidden', async () => {
  let h!: HostScenario;
  let stopped: Promise<Record<string, unknown>> | undefined;
  h = await openHostScenario({ script: { replies: [readCall('c8-driver-run-1')],
    duringReply: async () => {
      // `workflow/driver-stop` while the Turn calls the model: the stop drain waits for the driver's loop, so it is
      // not awaited here; the reply goes out once the driver's cancel is committed (the Run's pointer is the cancel).
      stopped = h.answer('workflow/driver-stop', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF, taskId: AG2B_WORK_TASK_ID }));
      await waitFor(async () => {
        const runRef = (await h.taskRow()).execution;
        return runRef === null ? null : (await readExecution(h.host, runRef)).run.controlState?.desiredState ?? null;
      }, desired => desired === 'cancelled', 'the driver\'s cancel to commit');
    } } });
  await assertInvariants(h, 'seeded');
  const started = await h.answer('workflow/driver-start', plain(AG2B_SCOPE, { advance: h.select('c8-driver', AG2B_WORK_TASK_ID),
    queryProfileIds: [] }));
  expect(started).toMatchObject({ status: 'ready' });
  await waitFor(async () => stopped !== undefined, reached => reached, 'the driver to reach the Turn');
  // The stop answers at once (`stopping`); its drain cancels the Run, waits for the loop and ends `stopped`.
  expect(await stopped).toMatchObject({ status: 'ready', value: { state: 'stopping' } });
  const driver = await waitFor(() => h.answer('workflow/driver-read', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF, taskId: AG2B_WORK_TASK_ID })),
    read => (read['value'] as { state?: string } | undefined)?.state === 'stopped', 'the driver to stop');
  // The drain confirmed the cancel against the Run (no "did not confirm cancellation" reason).
  expect(driver).toMatchObject({ status: 'ready', value: { state: 'stopped', reason: null } });
  expect(await h.taskRow()).toMatchObject({ failure: { failureClass: 'cancelled' } });
  await assertInvariants(h, 'driver stopped');

  const row = await h.taskRow();
  const run1Ref = row.execution;
  if (run1Ref === null) throw new Error('Run 1 must be selected');
  const run1 = (await readExecution(h.host, run1Ref)).run;
  expect(run1).toMatchObject({ status: 'ended', outcome: 'cancelled', controlState: { desiredState: 'cancelled' } });
  const cancelRef = run1.controlState?.intentRef;
  if (cancelRef === undefined) throw new Error('the Run must point to the driver\'s cancel');
  // The driver's cancel is the operator's (the Host actor started and stopped the driver).
  expect(await readControl(h.host, cancelRef)).toMatchObject({ kind: 'cancel', status: 'applied', requestedBy: SCENARIO_OPERATOR });
  expect(row).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'cancelled',
    stop: { intentRef: cancelRef, kind: 'cancel', requester: 'human' },
    automation: { verdict: { kind: 'stopped', reason: 'task_cancelled', detail: { fence: 'human_cancel' } } } } });
  expect(h.modelCalls()).toBe(1);

  await advanceWritesNothing(h, 'c8-driver-again');
  expect(h.lastWorld?.requeues).toEqual([]);
  const beforeRefusal = h.counts();
  expect(await automationRequeue(h, run1Ref, 'c8-driver-system-requeue'))
    .toMatchObject({ status: 'rejected', code: 'forbidden', reason: HUMAN_STOP });
  expect(h.counts()).toEqual(beforeRefusal);
}, 120_000);

it('C8 variant (AV-4, hard limit 3): the operator\'s pause pointer on a crashed Run gives stopped/task_paused and the same answers', async () => {
  let h!: HostScenario;
  const held: HeldReply[] = [];
  const pauses: ControlIntentRef[] = [];
  h = await openHostScenario({ script: {
    replies: [{ kind: 'text', text: 'C8 crash: never delivered, the provider fails' },
      { kind: 'text', text: 'C8 crash again: never delivered, the provider fails' }],
    duringReply: async (index) => {
      const runRef = (await h.taskRow()).execution;
      if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
      pauses.push((await submitControl(h.host, runRef, 'pause', 'the operator pauses this attempt', `c8-crash-pause-${index}`)).intent.ref);
      // The provider then fails this request: the Turn fails before any safe point consumed the pause.
      held[index]?.fail('scenario: the model provider failed');
    } } });
  held.push(h.holdReply(0), h.holdReply(1));
  await assertInvariants(h, 'seeded');

  const first = await h.advance(h.select('c8-crash-1', AG2B_WORK_TASK_ID));
  expect(first).toMatchObject({ state: 'waiting', reason: NOT_EXECUTABLE });
  const pauseRef = pauses[0];
  if (pauseRef === undefined) throw new Error('the pause must be submitted during the Turn');
  const stopped = await h.taskRow();
  const run1Ref = stopped.execution;
  if (run1Ref === null) throw new Error('Run 1 must be selected');
  // CTL-06: the crash terminal superseded the queued pause; the pointer stays on the Run.
  expect((await readExecution(h.host, run1Ref)).run).toMatchObject({ status: 'ended', outcome: 'crashed',
    controlState: { intentRef: pauseRef, desiredState: 'paused' } });
  expect(await readControl(h.host, pauseRef)).toMatchObject({ status: 'superseded' });
  expect(stopped).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'run_failed',
    stop: { intentRef: pauseRef, kind: 'pause', requester: 'human' },
    automation: { verdict: { kind: 'stopped', reason: 'task_paused', detail: { fence: 'human_pause', pausedBy: 'human' } } } } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'task_paused', taskId: AG2B_WORK_TASK_ID } });

  await advanceWritesNothing(h, 'c8-crash-again');
  expect(h.lastWorld?.requeues).toEqual([]);
  const beforeRefusal = h.counts();
  expect(await automationRequeue(h, run1Ref, 'c8-crash-system-requeue'))
    .toMatchObject({ status: 'rejected', code: 'forbidden', reason: HUMAN_STOP });
  expect(h.counts()).toEqual(beforeRefusal);
  // The agent half of the fence is case 4 (and the machine seam it names). The operator's requeue passes: the
  // class is `run_failed`, so ND-6 (which skips only a human requeue of a `cancelled` Task) does not apply and
  // the key IS compared; it passes because this is the Task's first requeue, so there is no earlier key to match.
  const requeued = await operatorRequeue(h.host, run1Ref, 'c8-crash-requeue', 'the operator requeues the stopped work');
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue 1: ${JSON.stringify(requeued)}`);
  expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: { failureClass: 'run_failed',
    stopIntentRef: pauseRef, stopRequester: 'human', requestedBy: SCENARIO_OPERATOR, basisComparison: 'compared',
    automation: { automatic: false } } } });
  await assertInvariants(h, 'operator requeue', { kind: 'task_requeued', actor: { ...SCENARIO_OPERATOR },
    automationPolicy: h.automationPolicy() });
  expect(h.modelCalls()).toBe(1);

  // Run 2 crashes the same way under a second pause, the files unchanged: the same stop and the same 0-write 推进.
  const second = await h.advance(h.select('c8-crash-2', AG2B_WORK_TASK_ID));
  expect(second).toMatchObject({ state: 'waiting', reason: NOT_EXECUTABLE });
  expect(second.receipts.map(receipt => receipt.kind)).not.toContain('requeue_task');
  const run2Ref = (await h.taskRow()).execution;
  if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be selected');
  expect((await readExecution(h.host, run2Ref)).run).toMatchObject({ status: 'ended', outcome: 'crashed',
    controlState: { intentRef: pauses[1], desiredState: 'paused' } });
  expect(await h.taskRow()).toMatchObject({ failure: { failureClass: 'run_failed',
    automation: { verdict: { kind: 'stopped', reason: 'task_paused', detail: { fence: 'human_pause' } } } } });
  await advanceWritesNothing(h, 'c8-crash-2-again');
  expect(h.lastWorld?.requeues, 'the Workflow wrote no TaskRequeue').toHaveLength(1);
  expect(h.modelCalls()).toBe(2);
  // Where this variant differs from case 1: with nothing new the operator's second requeue meets requeue 1's key
  // (hard limit 2: the guard holds for a human too; ND-6's one exception is the cancel), so the owner commits a
  // `no_new_basis` refusal instead of a TaskRequeue.
  const again = await operatorRequeue(h.host, run2Ref, 'c8-crash-requeue-2', 'the operator requeues the stopped work');
  expect(again).toMatchObject({ status: 'committed', value: { kind: 'refused', refusal: { revision: 1, code: 'no_new_basis',
    afterRunRef: run2Ref, matchedRequeueRef: requeued.value.requeue.ref, requestedBy: SCENARIO_OPERATOR } } });
  await assertInvariants(h, 'operator requeue 2 refused', { kind: 'task_rework_refused', actor: { ...SCENARIO_OPERATOR },
    automationPolicy: h.automationPolicy() });
  expect(h.lastWorld?.requeues).toHaveLength(1);
  expect(h.modelCalls()).toBe(2);
}, 120_000);

it('C8 variant (S21): a Host started as {kind:\'system\'} cancels as an operator; stopped/task_cancelled; the automation\'s requeue is still forbidden', async () => {
  const systemOperator: WorkbenchActor = { kind: 'system', id: 'c8-system-started-host' };
  let h!: HostScenario;
  let cancelRef: ControlIntentRef | undefined;
  h = await openHostScenario({ actor: systemOperator, script: { replies: [readCall('c8-system-run-1')],
    duringReply: async () => { cancelRef = await cancelRunningTurn(h, 'c8-system-cancel'); } } });
  await assertInvariants(h, 'seeded');

  const first = await h.advance(h.select('c8-system-1', AG2B_WORK_TASK_ID));
  expect(first).toMatchObject({ state: 'waiting', reason: NOT_EXECUTABLE });
  if (cancelRef === undefined) throw new Error('the cancel must be submitted during the Turn');
  expect(await readControl(h.host, cancelRef)).toMatchObject({ requestedBy: systemOperator });
  const stopped = await h.taskRow();
  const run1Ref = stopped.execution;
  if (run1Ref === null) throw new Error('Run 1 must be selected');
  expect(stopped).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'cancelled',
    stop: { intentRef: cancelRef, kind: 'cancel', requester: 'human' },
    automation: { verdict: { kind: 'stopped', reason: 'task_cancelled', detail: { fence: 'human_cancel' } } } } });

  await advanceWritesNothing(h, 'c8-system-again');
  expect(h.lastWorld?.requeues).toEqual([]);
  const beforeRefusal = h.counts();
  expect(await automationRequeue(h, run1Ref, 'c8-system-automation-requeue'))
    .toMatchObject({ status: 'rejected', code: 'forbidden', reason: HUMAN_STOP });
  expect(h.counts()).toEqual(beforeRefusal);
  // The system-started Host is an operator: its own requeue is accepted without a new basis (ND-6).
  const requeued = await operatorRequeue(h.host, run1Ref, 'c8-system-requeue', 'the operator requeues the stopped work');
  expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: { requestedBy: systemOperator,
    basisComparison: 'skipped_human_cancel', automation: { automatic: false } } } });
  await assertInvariants(h, 'system Host requeue', { kind: 'task_requeued', actor: { ...systemOperator },
    automationPolicy: h.automationPolicy() });
}, 120_000);

it('LA-3 (W16 guard 9, hard limit 3): an Agent may neither add a parallel carrier beside human-cancelled work nor requeue it; the operator adopts the same candidate', async () => {
  const COORDINATOR = 'ag2b-coordinator';
  const PARALLEL = 'ag2b-work-parallel';
  const replies: ScriptedReply[] = [
    { kind: 'calls', calls: [{ callId: 'la3-propose', name: 'propose_future_plan', args: {} }] },
    { kind: 'calls', calls: [{ callId: 'la3-apply', name: 'apply_future_plan', args: {} }] },
    { kind: 'text', text: 'LA-3: the coordinator could not add the parallel carrier' }];
  const seen: { agentRequeue?: unknown; propose?: unknown; apply?: unknown } = {};
  let run1Ref: RunRef | null = null;
  let wb!: PlanBoard;
  wb = await PlanBoard.open({ workIds: [AG2B_WORK_TASK_ID], replies, duringReply: async (index, request) => {
    if (index === 0) {
      // The coordinator's running Run is an Agent of the same Goal: its requeue of the cancelled work is refused.
      const coordinatorRun = (await wb.taskRow(COORDINATOR)).execution;
      if (coordinatorRun === null || run1Ref === null) throw new Error('the coordinator Run and the cancelled Run must exist');
      seen.agentRequeue = await ownerRequeue(wb.platform, workRunCtx(coordinatorRun), run1Ref, 'la3-agent-requeue');
      // Its W16: the stopped work's obligation gets a parallel carrier.
      const next = await wb.nextDraft('ag2b-plan-3', draft => ({ ...draft,
        tasks: [...draft.tasks, { taskId: PARALLEL, title: 'A parallel carrier of the stopped work', requirementLevel: 'required',
          taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' }],
        assignments: [...(draft.assignments ?? []), { taskId: PARALLEL, role: 'builder', instruction: 'Do the stopped work in parallel' }],
        obligations: draft.obligations.map(obligation => obligation.obligationId === 'ag2b-obligation'
          ? { ...obligation, taskIds: [...obligation.taskIds, PARALLEL] } : obligation) }));
      Object.assign(callArgs(replies[0]), { basedOn: next.source.ref, draft: next.draft,
        reason: { text: 'add a parallel carrier for the stopped work', sources: [] }, expected: [] });
    }
    if (index === 1) {
      seen.propose = toolOutputJson(request, 'la3-propose');
      const proposal = seen.propose as { status?: string; value?: { ref: unknown; revision: number } };
      if (proposal.status !== 'committed' || proposal.value === undefined) throw new Error(`propose: ${JSON.stringify(proposal)}`);
      Object.assign(callArgs(replies[1]), { proposalRef: proposal.value.ref, expectedProposalRevision: proposal.value.revision, expected: [] });
    }
    if (index === 2) seen.apply = toolOutputJson(request, 'la3-apply');
  } });
  const { platform, target } = wb;
  await assertInvariantsAt(target, 'seeded');

  // The operator adds the coordinator Task with an obligation of its own (P2).
  const withCoordinator = await wb.nextDraft('ag2b-plan-2', draft => ({ ...draft,
    tasks: [...draft.tasks, { taskId: COORDINATOR, title: 'Coordinate the work', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' }],
    assignments: [...(draft.assignments ?? []), { taskId: COORDINATOR, role: 'builder', instruction: 'Coordinate the AG2b work' }],
    obligations: [...draft.obligations, { obligationId: 'ag2b-coordination', title: 'Coordinate the work', requirementLevel: 'required',
      taskIds: [COORDINATOR], verificationRequirements: [{ requirementId: 'ag2b-coordination-static', requirementLevel: 'required',
        kind: 'static', description: 'Registered static command check' }] }] }));
  const p2Proposal = await platform.plans.proposePlan(hostCtx(), { meta: { requestId: 'la3-p2-propose', expected: [] },
    input: { goalRef: AG2B_GOAL_REF, basedOn: withCoordinator.source.ref, draft: withCoordinator.draft,
      reason: { text: 'add a coordinator', sources: [] } } });
  if (p2Proposal.status !== 'committed') throw new Error(`P2 proposal: ${JSON.stringify(p2Proposal)}`);
  expect(await platform.plans.applyPlanChange(hostCtx(), { meta: { requestId: 'la3-p2-apply', expected: [] },
    input: { proposalRef: p2Proposal.value.ref, expectedProposalRevision: p2Proposal.value.revision, decisionRefs: [] } }))
    .toMatchObject({ status: 'committed' });
  await assertInvariantsAt(target, 'P2 adopted', { kind: 'plan_adopted', actor: { ...SCENARIO_OPERATOR },
    automationPolicy: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: true } });

  // The work Task is claimed; the operator cancels its Run before it enters (D-7): a human stop.
  const claimed = await wb.advance({ schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId: 'la3-work',
    sessionHint: null, kind: 'select_work', taskId: AG2B_WORK_TASK_ID }, performs('prepare'));
  if (claimed.next === null) throw new Error('the Workflow must stop before the prepare');
  run1Ref = (await wb.taskRow(AG2B_WORK_TASK_ID)).execution;
  if (run1Ref === null) throw new Error('the work Task must be claimed');
  const claimedRun = await platform.executions.readExecution(hostCtx(), run1Ref);
  if (claimedRun.status !== 'ready') throw new Error('the claimed Run must be readable');
  expect(await platform.controls.submitControl(hostCtx(), { input: { runRef: run1Ref, kind: 'cancel', reason: 'not this way' },
    meta: { requestId: 'la3-cancel', expected: [{ ref: run1Ref, revision: claimedRun.value.run.revision }] } }))
    .toMatchObject({ status: 'committed', value: { intent: { status: 'applied' } } });
  await assertInvariantsAt(target, 'work cancelled');
  expect(await wb.taskRow(AG2B_WORK_TASK_ID)).toMatchObject({ effectivePhase: 'failed',
    failure: { failureClass: 'cancelled', automation: { verdict: { kind: 'stopped', reason: 'task_cancelled' } } } });
  const p2 = (await platform.plans.queryTaskGraph(hostCtx(), { goalRef: AG2B_GOAL_REF }));
  if (p2.status !== 'ready') throw new Error('the task graph must be readable');

  // The coordinator's Run: its requeue and its adoption are refused; it then answers and ends.
  const coordinated = await wb.advance({ schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId: 'la3-coordinator',
    sessionHint: null, kind: 'select_work', taskId: COORDINATOR }, performs('open_checks'));
  expect(coordinated.next).not.toBeNull();
  expect(wb.scripted.calls()).toBe(3);
  // The platform refuses an Agent's requeue at its grant before the fence: no production Role may hold
  // `requeue_task` while the Agent tool does not exist (GAP-46; the Runtime refuses unknown tool names,
  // src/core/agent-runtime/execution-driver.ts:118, and the admission refuses a manifest without it,
  // src/core/work-graph/tasks/plan-write-admission.ts:353). This is NOT the hard-limit-3 coverage for agents:
  // the fence's own agent refusal is proved at the machine seam, tests/state/task-failure.test.ts:488-511
  // (the reworkPermission matrix rows 'cancelled by an operator (human_only)' and '... under an operator
  // fence', agent `forbidden`). When GAP-46 lands this assertion must change to the fence reason (HUMAN_STOP).
  expect(seen.agentRequeue, 'an Agent requeue of human-cancelled work').toMatchObject({ status: 'rejected', code: 'forbidden',
    reason: 'the current Host/Role grant does not include requeue_task' });
  expect(seen.propose).toMatchObject({ status: 'committed', value: { ref: { aggregateType: 'PlanProposal' } } });
  expect(seen.apply, 'guard 9').toMatchObject({ status: 'rejected', code: 'forbidden',
    reason: `obligation ag2b-obligation: a human stopped this work; only an operator may add the parallel carrier ${PARALLEL}` });
  const afterAgent = await platform.plans.queryTaskGraph(hostCtx(), { goalRef: AG2B_GOAL_REF });
  expect(afterAgent.status === 'ready' ? afterAgent.value.plan.ref : null, 'the active Plan is still P2').toEqual(p2.value.plan.ref);
  expect(target.lastWorld?.requeues).toEqual([]);

  // The operator adopts the Agent's candidate: an operator is not fenced (LA-3).
  const candidate = (seen.propose as { value: { ref: PlanProposalRef; revision: number } }).value;
  const adopted = await platform.plans.applyPlanChange(hostCtx(), { meta: { requestId: 'la3-operator-apply', expected: [] },
    input: { proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [] } });
  if (adopted.status !== 'committed') throw new Error(`the operator adoption must commit: ${JSON.stringify(adopted)}`);
  expect(adopted.value.obligations.find(obligation => obligation.obligationId === 'ag2b-obligation')?.taskIds).toContain(PARALLEL);
  await assertInvariantsAt(target, 'operator adopts the Agent candidate', { kind: 'plan_adopted', actor: { ...SCENARIO_OPERATOR },
    automationPolicy: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: true } });
}, 120_000);

it('AV-4 (STEP5-FLIPS §14): a pause superseded by the natural completion fences rework only; the round opens, passes and completes the Task', async () => {
  let h: HostScenario | undefined;
  let pauseRef: Awaited<ReturnType<typeof submitControl>>['intent']['ref'] | undefined;
  h = await openHostScenario({
    // The check passes without the result file, so the completed Run's round is PASS.
    check: { command: 'node -e "console.log(\'A2_AV4_CHECK_OK\')"' },
    script: { replies: [{ kind: 'text', text: 'A2 AV-4: the work is done before any safe point' }],
      duringReply: async (index) => {
        if (index !== 0 || h === undefined) return;
        const runRef = (await h.taskRow()).execution;
        if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
        // The operator pauses the running Turn; it completes before any safe point consumes the pause.
        pauseRef = (await submitControl(h.host, runRef, 'pause', 'operator pause before the Run finishes', 'a2-av4-pause')).intent.ref;
      } },
  });
  const host = h;
  await assertInvariants(host, 'seeded');
  // The open that `start` returned is not performed: the selection must find the round itself.
  // (`advanceUntil` threw when the Workflow stopped before the open; the drive must stop on it.)
  const toOpen = await host.advance(host.select('a2-av4', AG2B_WORK_TASK_ID), { stopBefore: performs('open_checks') });
  expect(toOpen).toMatchObject({ state: 'stopped', next: { kind: 'perform', operation: { kind: 'open_checks' } } });
  if (pauseRef === undefined) throw new Error('the pause must be submitted during the Turn');
  const row = await host.taskRow();
  const runRef = row.execution;
  if (runRef === null) throw new Error('the work Task must have a Run');
  // CTL-06: the natural terminal superseded the queued pause; the pointer stays on the Run as history.
  expect((await readExecution(host.host, runRef)).run).toMatchObject({ status: 'ended', outcome: 'completed',
    controlState: { intentRef: pauseRef, desiredState: 'paused' } });
  expect(await readControl(host.host, pauseRef)).toMatchObject({ status: 'superseded',
    observation: { kind: 'terminal_without_cancel' } });
  // AV-4 in literal row order: the operator's pause pointer fences the Task (FC-12 has nothing to rework).
  expect(row).toMatchObject({ effectivePhase: 'verifying', phaseCause: { code: 'awaiting_verification' },
    failure: { failureClass: null, notReworkableCause: null, stop: { intentRef: pauseRef, kind: 'pause', requester: 'human' },
      automation: { verdict: { kind: 'stopped', reason: 'task_paused', detail: { fence: 'human_pause', pausedBy: 'human' } } } } });
  // `stopped` blocks rework only: a new 推进 selects the fenced Task's round (step 5.8 part 2 reads the
  // verdict first), the round opens, the check passes and the Task completes.
  const steps = (await host.advance(host.select('a2-av4-select', AG2B_WORK_TASK_ID))).steps;
  // The seeded Task and its adopted Plan (the AG2b seed's public inputs).
  const taskRef = { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: AG2B_WORK_TASK_ID };
  const planRef = { aggregateType: 'PlanRevision', projectId: AG2B_SCOPE.projectId, planId: 'ag2b-plan' };
  // The same selection the source (A2 AV-4) asserted, with its exact request fields: the selected Task's
  // open, and exactly the open's input (the completed Run, its Task, the adopted Plan).
  expect(steps[0]).toEqual({ state: 'advance', receipt: null, reason: null, next: expect.objectContaining({ kind: 'perform',
    taskId: AG2B_WORK_TASK_ID, operation: { kind: 'open_checks',
      request: expect.objectContaining({ input: { subjectRunRef: runRef, subject: taskRef, planRef } }) } }) });
  expect(steps.slice(1).map(step => step.receipt?.kind)).toEqual(['open_checks', 'run_check', 'finalize_checks', 'complete_task', undefined]);
  // The PASS head is completed with exactly its Task, the Plan and the round the open returned (A2 AV-4:
  // `{ taskRef, planRef, roundRef: head.ref }`).
  const opened = steps.find(step => step.receipt?.kind === 'open_checks')?.receipt;
  if (opened?.kind !== 'open_checks' || opened.result.status !== 'committed') throw new Error('the round must open');
  const completing = steps.map(step => step.next)
    .find(next => next?.kind === 'perform' && next.operation.kind === 'complete_task');
  if (completing?.kind !== 'perform' || completing.operation.kind !== 'complete_task') {
    throw new Error('the PASS head must be completed through complete_task');
  }
  expect(completing.operation.request.input).toEqual({ taskRef, planRef, roundRef: opened.result.value.ref });
  expect(steps.find(step => step.receipt?.kind === 'finalize_checks'))
    .toMatchObject({ receipt: { result: { status: 'committed', value: { outcome: 'PASS' } } } });
  expect(steps.at(-1)).toMatchObject({ state: 'completed' });
  const done = await host.taskRow();
  expect(done).toMatchObject({ effectivePhase: 'satisfied', execution: runRef });
  expect(done.failure).toBeUndefined();
  // No TaskRequeue (nor any refusal) was written for the fenced Task.
  expect(done.rework).toBeUndefined();
  expect(done.requeueRef).toBeUndefined();
  expect(host.host.scripted.calls()).toBe(1);
}, 120_000);

it('VR-14 step 5 (hard limit 3, I-17): an operator pause superseded by the natural completion fences the automation, not the operator', async () => {
  let pauseRef: ControlIntentRef | undefined;
  let h!: PlatformScenario;
  h = await openPlatformScenario({ check: { command: 'echo A2_REVERIFY_OK' }, script: {
    replies: [{ kind: 'text', text: 'A2 reverify work result' }],
    duringReply: async () => {
      if (pauseRef !== undefined) return;
      // The operator pauses the running Turn; the Turn completes before any safe point consumes the pause (CTL-06).
      const runRef = (await h.taskRow()).execution;
      if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
      const read = await h.platform.executions.readExecution(h.ctx(), runRef);
      if (read.status !== 'ready') throw new Error('the Run must be readable');
      const submitted = await h.platform.controls.submitControl(h.ctx(), { input: { runRef, kind: 'pause',
        reason: 'operator pause before the Run finishes' }, meta: { requestId: 'a2-reverify-pause',
        expected: [{ ref: runRef, revision: read.value.run.revision }] } });
      if (submitted.status !== 'committed') throw new Error(`the pause must commit: ${JSON.stringify(submitted)}`);
      pauseRef = submitted.value.intent.ref;
    } } });
  await assertInvariants(h, 'seeded');
  const r1 = await inconclusiveHead(h);
  if (pauseRef === undefined) throw new Error('the pause must be submitted during the Turn');
  // CTL-06: the natural terminal superseded the queued pause; the pointer stays on the completed Run.
  expect(await h.platform.executions.readExecution(h.ctx(), r1.subjectRunRef)).toMatchObject({ status: 'ready', value: { run: {
    status: 'ended', outcome: 'completed', controlState: { intentRef: pauseRef, desiredState: 'paused' } } } });
  expect(await h.platform.controls.readControl(h.ctx(), pauseRef)).toMatchObject({ status: 'ready', value: { status: 'superseded' } });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'blocked', failure: { failureClass: 'check_incomplete',
    stop: { intentRef: pauseRef, kind: 'pause', requester: 'human' }, reverifyActors: ['human'] } });

  // The platform automation (the Workflow's actor) may not rework what a human stopped: forbidden, nothing written.
  const beforeRefusal = h.counts();
  expect(await h.platform.evidence.reverifyRound!(h.ctx({ ...WORKFLOW_AUTOMATION_ACTOR }), reverifyRequest(r1, 'a2-reverify-fenced')))
    .toMatchObject({ status: 'rejected', code: 'forbidden', reason: HUMAN_STOP });
  expect(h.counts()).toEqual(beforeRefusal);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'blocked',
    failure: { round: { roundRef: r1.ref, revision: r1.revision }, automation: { lastReverifyRefusal: null } } });
  // The operator may: the successor round opens on the same Run.
  const reverified = await h.platform.evidence.reverifyRound!(h.ctx(), reverifyRequest(r1, 'a2-reverify-fenced-operator'));
  expect(reverified).toMatchObject({ status: 'committed', value: { kind: 'reverified', round: { subjectRunRef: r1.subjectRunRef,
    chain: { ordinal: 2, autoCount: 0, reverify: { actorClass: 'human', requestedBy: SCENARIO_OPERATOR } } } } });
  await assertInvariants(h, 'operator reverify', { kind: 'round_reverified', actor: { ...SCENARIO_OPERATOR },
    automationPolicy: h.automationPolicy() });
  expect(h.scripted.calls()).toBe(1);
}, 120_000);

/** VD-8: the work Run completes, its round opens, the workspace changes, and the round finalizes INCONCLUSIVE. */
async function inconclusiveHead(h: PlatformScenario): Promise<RoundSnapshot> {
  const toCheck = await h.advance(h.select('a2-reverify-flow', AG2B_WORK_TASK_ID), { stopBefore: performs('run_check') });
  if (toCheck.next === null) throw new Error('the Workflow must reach the check');
  await writeFile(join(h.root, 'src', 'module.ts'), 'export const ag2bMarker = "A2_REVERIFY_SOURCE_CHANGED_AFTER_OPEN";\n');
  const finalized = await h.advance(toCheck.next, { stopBefore: input => input.kind === 'select_work' });
  const finalize = finalized.receipts.find(receipt => receipt.kind === 'finalize_checks');
  if (finalize?.kind !== 'finalize_checks' || finalize.result.status !== 'committed') throw new Error('the round must finalize');
  expect(finalize.result.value.outcome).toBe('INCONCLUSIVE');
  return finalize.result.value.snapshot;
}
