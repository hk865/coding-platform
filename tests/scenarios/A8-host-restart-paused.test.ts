/**
 * A.2 step 6, scenario A8, the C4 cases (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" A8 row,
 * §12.10 A8-3l..A8-3r; §12.2 W-20, W-11 and "核对之后的接续"; §12.5 CI-11; LA-1, LA-6, LA-7, C3, C4):
 * a Run paused at a safe point (or with a pause or a resume queued) when its Host stops, on rebuilt Hosts
 * over one SQLite ledger and the frozen Kernel's store, with scripted model replies.
 *
 * - A8-3l (with A8-3p): a person's pause during the first of two serial tool groups; the crash; RUN-24
 *   (paused-interrupted, the Session retired `kernel_turn_open`, 0 model calls and Kernel Turns during the
 *   reconcile); the start-up re-drive and three 推进 leave it alone, the automation is refused by the
 *   paused fence (an Agent's 继续: tests/scenarios/C3-paused-continue-brief.test.ts); the Kernel refuses
 *   a Turn forced on the old Session before the closure; a person's 继续 lets the Workflow close the
 *   dangling Kernel Turn (close_open_turn{requeue}, slice K L4/L7) and continues it in the same Session
 *   (not an idle Session of the role), the brief naming the confirmed and the declared-but-not-run calls;
 *   the continuation's next Run sees the Session's earlier completed Turns, never the paused one (K L3);
 *   another start writes nothing.
 * - A8-3m: a pause queued before the safe point (moved case; see the deviation in its comment).
 * - A8-3n: the Kernel paused, a resume queued, the crash before the re-entry: RUN-19 (not paused), the
 *   resume superseded; the start-up maintenance closes the dangling Kernel Turn (K KA1, also with the
 *   re-drive off) and the start-up re-drive requeues it uncounted into the same Session (§13.4 #17); with
 *   closing unsupported, the start-up maintenance archives the retired line at once (K L7: a definite
 *   failure keeps today's logic; decision 42 item 2) and the ordinary selection gives the dropped Task to
 *   the idle Session of the role, seeded with the old history (decision 43, LA-1 (c); 2C spec §16).
 * - A8-3o: the close variant (HL-06, next start HL-01) in A8-3q, the moved case with a stale lock (HL-03).
 * - A8-3r (moved), A8-3q: another Task of the same role never takes the retired Session.
 *
 * Every step that changes records is followed by the §11 invariant check; every case ends with another
 * start on the same data that changes and writes nothing (`expectQuietHarnessRestart`,
 * `expectQuietRestart`; the moved A8-3o case does it with its own third start). No real model is called.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostReconcileReportV1, SessionRef, TaskExecutionRecord } from '../../src/app/core-http-types.js';
import { continuationBriefMarker } from '../../src/contracts/continuation-brief.js';
import type { ControlIntentSnapshotV1, SubmittedControl } from '../../src/contracts/control-intent.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, WORKFLOW_AUTOMATION_ACTOR, type TaskRequeueOutcomeV1,
} from '../../src/contracts/task-requeue.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, AG2B_WORK_ROLE, AG2B_WORK_TASK_ID, createAG2bSession, graphWrite, plain,
  seedAG2bWorkGraph, startAG2bHost, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  TASK, answer, claimQueryOn, post, publicDirectory, readControl, readExecution, readGoal, selectWork, submitControl, tempDir, workRow,
  writeAutomationSettings, writeStaleLock,
} from '../helpers/A2-restart-fixture.js';
import type { FuzzStep } from '../state/invariants.js';
import {
  assertInvariants, assertInvariantsAt, cleanupScenarios, hostCtx, openHostScenario, performs, SCENARIO_OPERATOR, waitFor,
  type HostScenario, type InvariantTarget,
} from './harness.js';
import {
  driveChecked, editThenText, execution, pausedRunOnClosedHostChecked, replayOf, requeueBodyOf, requiredBriefOf, selectedRun, sessionKey,
  stepOf,
} from './support/common.js';
import {
  crashMidTurn, expectQuietHarnessRestart, expectQuietRestart, forceTurnOnKernelSession, performedOf,
} from './support/restart.js';

afterEach(cleanupScenarios);

// Slice K (L4 step 5, L8): the "closing unsupported" case. A Kernel without `closeOpenTurn` makes the Runtime answer
// `unsupported`, a definite failure: the maintenance keeps today's logic (a retired line that still holds its Task is
// archived with a drop, A8-3n) and otherwise the Workflow falls back to a new Session (LA-1 contract (e)).
const kernelClosure = vi.hoisted(() => ({ supported: true }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.defineProperty({ ...actual }, 'closeOpenTurn', { enumerable: true,
    get: () => (kernelClosure.supported ? actual['closeOpenTurn'] : undefined) });
});
afterEach(() => { kernelClosure.supported = true; });

const RUN0_TASK = 'ag2b-work-0';
const RUN0_TEXT = 'restart scenario A8-3l: Run0 completed this Turn in the original Session';
const GROUP1 = 'a8-3l-group1-edit';
const GROUP2 = 'a8-3l-group2-read';

function toolCallIds(messages: readonly { role: string; callId?: string }[]): string[] {
  return messages.flatMap(message => message.role === 'tool' && message.callId !== undefined ? [message.callId] : []);
}

it('A8-3l, A8-3p (W-20, RUN-24, LA-1, C3, C4, §13.4 #23/#24; K KA-07, KA-04): a Run paused by a person ends paused-interrupted at the crash; the Kernel refuses the old Session until its dangling Turn is closed; only a person continues it: the Workflow closes the Turn and the continuation runs in the same Session; the next Run sees the earlier completed Turns, never the paused one', async () => {
  let scenario: HostScenario | undefined;
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  const replies: ScriptedReply[] = [
    // Run0 of another Task completes in Session S1.
    { kind: 'calls', calls: [{ callId: 'a8-3l-run0-read', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: RUN0_TEXT },
    // Run1 in S1: group 1 (a write) runs; the person pauses during the request that declares group 2 (a read), so the
    // Kernel pauses at the safe point before group 2 runs (LA-7: a declared call that never started).
    { kind: 'calls', calls: [{ callId: GROUP1, name: 'edit', args: { mode: 'create', path: 'src/a8-3l-step.txt', newText: 'step 1\n' } }] },
    { kind: 'calls', calls: [{ callId: GROUP2, name: 'read', args: { path: 'src/module.ts' } }] },
    // Run2 (the continuation, in S1 after the closure) answers without the result file: its round FAILs.
    { kind: 'text', text: 'restart scenario A8-3l: Run2 continued without the result file' },
    // Run3 (the automatic rework, in S1 again) writes it.
    { kind: 'calls', calls: [{ callId: 'a8-3p-run3-edit', name: 'edit', args: { mode: 'create', path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
    { kind: 'text', text: 'restart scenario A8-3p: Run3 wrote the result file' }];
  const h = await openHostScenario({ workIds: [RUN0_TASK, AG2B_WORK_TASK_ID], check: 'pass', script: { replies,
    duringReply: async (index) => {
      if (index !== 3 || scenario === undefined) return;
      pauseRef = (await submitControl(scenario.host, await selectedRun(scenario), 'pause', 'restart scenario: pause', 'a8-3l-pause')).intent.ref;
    } } });
  scenario = h;

  // Step 1. Run0 completes in S1; Run1 of the work Task runs in S1 and pauses at the safe point after group 1.
  await h.advance(h.select('a8-3l-run0', RUN0_TASK));
  expect(await h.taskRow(RUN0_TASK)).toMatchObject({ effectivePhase: 'satisfied' });
  const run0Ref = await selectedRun(h, RUN0_TASK);
  const run0 = await execution(h, run0Ref);
  expect(run0.run).toMatchObject({ status: 'ended', outcome: 'completed' });
  const s1: SessionRef = { projectId: run0.session.ref.projectId, sessionId: run0.session.ref.sessionId };
  const paused = await h.advance({ ...h.select('a8-3l-run1', AG2B_WORK_TASK_ID), sessionHint: s1 });
  expect(paused.state).toBe('waiting');
  const run1Ref = await selectedRun(h);
  if (pauseRef === undefined) throw new Error('the pause must be submitted');
  const beforeCrash = await execution(h, run1Ref);
  expect(beforeCrash.session.ref.sessionId, 'Run1 runs in the Session Run0 completed in').toBe(s1.sessionId);
  expect(beforeCrash.run).toMatchObject({ status: 'running', controlState: { intentRef: pauseRef, desiredState: 'paused' } });
  expect(await readControl(h.host, pauseRef)).toMatchObject({ status: 'applied', observation: { kind: 'paused' } });
  expect(beforeCrash.session.occupancy).toMatchObject({ kind: 'execution', executionRef: { runId: run1Ref.runId } });
  expect(h.modelCalls(), 'the pause held the Turn after group 2 was declared').toBe(4);
  const pauseIntent = await readControl(h.host, pauseRef);
  const kernelSessionId = beforeCrash.session.kernel.kernelSessionId;
  const oldKernel = h.kernelSnapshot().sessions.find(session => session.sessionId === kernelSessionId);
  const run1Kernel = beforeCrash.run.executionAuthorization;
  if (oldKernel === undefined || run1Kernel === undefined || !('schemaVersion' in run1Kernel) || run1Kernel.kernel === null) {
    throw new Error('Run1 must hold a Kernel binding in S1');
  }
  expect(oldKernel.activeRunId, 'the paused Turn keeps the Kernel Session active').toBe(run1Kernel.kernel.runId);

  // Step 2. The crash; Host 2 takes the lease over and reconciles (the registered check is the AG2b one from now on).
  const atCrash = h.counts();
  const report = await h.restart({ crash: true, check: 'result_file' });
  const hostInstanceId = report.hostInstanceId;
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
    runs: [{ ref: JSON.stringify(run1Ref), row: 'W-20', status: 'reconciled', reason: 'interrupted_clean' }],
    queries: [], checks: [], problems: [],
    // Step 3: the start-up re-drive does not select the Goal (the verdict is stopped/task_paused).
    redriveGoals: [] } });
  expect(h.counts(), 'no model request, Kernel Turn or check process during the reconcile').toMatchObject({
    modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted, checksBegun: atCrash.checksBegun,
    kernelRecords: atCrash.kernelRecords });
  const reconciled = await execution(h, run1Ref);
  expect(reconciled.run).toMatchObject({ status: 'ended', outcome: 'crashed',
    reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId },
      observation: { kind: 'interrupted_clean', kernelPaused: true, pausedIntentRef: pauseRef } } });
  expect(await readControl(h.host, pauseRef), 'the applied pause is not rewritten').toEqual(pauseIntent);
  expect(reconciled.attempt).toMatchObject({ status: 'ended', endOutcome: 'crashed' });
  expect(reconciled.outbox).toMatchObject({ status: 'settled' });
  expect(reconciled.lease?.release).toBeDefined();
  expect(reconciled.session).toMatchObject({ occupancy: null, historyCursor: beforeCrash.session.historyCursor,
    health: 'unavailable', healthConclusion: 'kernel_turn_open' });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted' } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', cause: { code: 'task_paused', taskId: AG2B_WORK_TASK_ID } });

  // Step 3. Three 推进: no TaskRequeue, no new Run, no model request.
  const beforeAdvances = h.counts();
  for (const flow of ['a8-3l-advance-1', 'a8-3l-advance-2', 'a8-3l-advance-3']) {
    expect(await h.advance(h.select(flow))).toMatchObject({ state: 'waiting', receipts: [] });
  }
  expect(h.counts()).toEqual(beforeAdvances);
  expect(h.lastWorld?.requeues).toEqual([]);
  // The automation is refused by the paused class's human fence (TASK-27, §13.4 #24: a system requeue without a
  // goal_resume trigger), before any key. An Agent's 继续 on this paused-interrupted Task is driven through a real
  // Agent Run in tests/scenarios/C3-paused-continue-brief.test.ts (the `direct()` root admits no Agent at all, so
  // its refusal here would not show this fence).
  const requeueTask = (await h.direct()).claims.requeueTask;
  if (requeueTask === undefined) throw new Error('the composition root publishes requeueTask');
  const automationRequeue = await requeueTask(hostCtx({ ...WORKFLOW_AUTOMATION_ACTOR }),
    (await requeueBodyOf(h.host, run1Ref, 'a8-3l-system', '继续')).request as never);
  expect(automationRequeue).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(String((automationRequeue as { reason?: unknown }).reason)).toContain('only an operator may rework it');
  expect(h.counts()).toEqual(beforeAdvances);

  // An idle Session of the work role is available from now on: the continuation must still not reuse it (LA-1).
  const idle = (await createAG2bSession(h.host, 'a8-3l-idle', AG2B_WORK_ROLE)).sessionRef;
  await assertInvariants(h, 'a8-3l idle Session', stepOf(h, 'other', 'a8-3l idle Session'));

  // Step 4. A person's 继续 (§13.4 #23: class interrupted, compared skipped); the history source is the old Session.
  const continueBody = await requeueBodyOf(h.host, run1Ref, 'a8-3l-continue', '继续');
  const continued = await h.post<WriteResult<TaskRequeueOutcomeV1>>('tasks/requeue', continueBody);
  if (continued.status !== 'committed' || continued.value.kind !== 'requeued') throw new Error(`continue: ${JSON.stringify(continued)}`);
  const requeue = continued.value.requeue;
  await assertInvariants(h, 'a8-3l continue', stepOf(h, 'task_requeued', 'a8-3l continue'));
  // §12.10 step 4: the same request again (its answer lost) gets the original receipt and writes nothing.
  const beforeReplay = h.counts();
  expect(await h.post('tasks/requeue', continueBody)).toEqual({ ...continued, replayed: true });
  expect(h.counts()).toEqual(beforeReplay);
  const s1Cursor = reconciled.session.historyCursor;
  expect(requeue).toMatchObject({ failureClass: 'interrupted', interruption: 'paused', stopIntentRef: pauseRef,
    historySource: { sessionRef: s1, kernelSessionId } });
  expect(requeue.historySource?.throughPosition).toEqual(expect.any(Number));

  // Step 4b (反向对照, before the Workflow closes the Turn: K KA-04). A Turn forced on S1 in the Kernel is refused
  // (仍有活动 Run) and appends nothing.
  const forced = await forceTurnOnKernelSession(join(h.database, 'kernel.sqlite'), h.root, kernelSessionId,
    requeue.historySource?.throughPosition ?? 0);
  expect(forced).toMatchObject({ modelRequests: 0 });
  expect(forced.refusal).toContain('仍有活动 Run');
  expect(h.kernelSnapshot().sessions.find(session => session.sessionId === kernelSessionId)).toEqual(oldKernel);

  // K (L4, L7 KA2/KA3): the person's TaskRequeue authorizes the Workflow to close S1's dangling Kernel Turn
  // (close_open_turn{requeue}); then it claims the requeue in S1 itself, never another Session (the idle one); the new
  // Run carries no control.
  const claimed = await h.advance(h.select('a8-3l-continue', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  expect(claimed.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['close_open_turn', 'claim_task']));
  const closing = claimed.steps.map(step => step.next)
    .find(next => next?.kind === 'perform' && next.operation.kind === 'close_open_turn');
  expect(closing?.kind === 'perform' && closing.operation.kind === 'close_open_turn' ? closing.operation.request : null,
    'close_open_turn{requeue}').toMatchObject({ sessionRef: s1, afterRunRef: run1Ref, requeueRef: requeue.ref });
  expect(claimed.receipts.find(receipt => receipt.kind === 'close_open_turn')?.result, 'S1 is available again before the claim')
    .toMatchObject({ status: 'closed', health: 'available' });
  const run2Ref = await selectedRun(h);
  const run2Claimed = await execution(h, run2Ref);
  expect(run2Claimed.run).toMatchObject({ requeueRef: requeue.ref });
  expect(run2Claimed.run.controlState).toBeUndefined();
  expect(run2Claimed.session.ref.sessionId, 'K: the continuation is a new Run in S1').toBe(s1.sessionId);
  expect(run2Claimed.session.ref.sessionId, 'LA-1: not another available Session').not.toBe(idle.sessionId);
  expect(run2Claimed.session.role).toEqual(reconciled.session.role);

  // Step 5. Run2 runs in S1: the brief (C3; K L9: the same Session, the paused Turn not in the model history, nothing
  // seeded) and the first request (K L3: S1's completed Turn up to its cursor, never the paused one).
  const finished = await h.advance(claimed.next!, { stopBefore: (input) => input.kind === 'perform' && input.operation.kind === 'requeue_task' });
  expect(finished.state).toBe('stopped');
  const { brief, digest } = await requiredBriefOf(h.host, run2Ref);
  expect(brief).toMatchObject({ mode: 'resume_after_interruption', failureClass: 'interrupted',
    trigger: { actorClass: 'human', goalResume: false, autoRework: null },
    previous: { runRef: run1Ref, sessionRef: s1, interruption: { kind: 'paused', kernelPaused: true, pausedBy: 'human' } },
    session: { continuity: 'same_session_without_previous_turn', sessionRef: s1, seededFrom: null, boundaryPosition: null },
    standingInstructionVersion: 1 });
  expect(brief.stoppedAt.lastPosition, 'the last history position of the interrupted Turn').toEqual(expect.any(Number));
  expect(brief.toolCalls.confirmed.map(call => call.callId)).toEqual([GROUP1]);
  expect(brief.toolCalls.notExecuted.map(call => call.callId)).toEqual([GROUP2]);
  expect((await execution(h, run2Ref)).run.inputBinding?.continuationBriefDigest).toBe(digest);
  const run2First = h.modelRequests()[4];
  expect(JSON.stringify(run2First?.messages ?? [])).toContain(RUN0_TEXT);
  expect(JSON.stringify(run2First?.messages ?? [])).toContain(continuationBriefMarker(digest));
  expect(toolCallIds(run2First?.messages ?? [])).toEqual(['a8-3l-run0-read']);

  // A8-3p. Run2's round FAILed; the automatic rework (check_failed, counted: §13.4 #17's later rework) claims in S1
  // again, whose last Kernel Turn (Run2's) ended; Run3 continues S1's own history past the closure: Run0's and Run2's
  // Turns, never the paused Turn (K L3; see the end).
  const completed = await h.advance(finished.next!);
  expect(completed.state).toBe('completed');
  expect(h.lastWorld?.requeues).toHaveLength(2);
  expect(h.lastWorld?.requeues.find(requeue => requeue.failureClass === 'check_failed'))
    .toMatchObject({ automation: { automatic: true, counted: true, autoCount: 1 } });
  const run3Ref = await selectedRun(h);
  const run3 = await execution(h, run3Ref);
  expect(run3.run).toMatchObject({ status: 'ended', outcome: 'completed' });
  expect(run3.session.ref.sessionId, 'the rework stays in S1').toBe(s1.sessionId);
  const run3First = h.modelRequests()[5];
  const run3Messages = JSON.stringify(run3First?.messages ?? []);
  expect(run3Messages).toContain('Run2 continued without the result file');
  expect(toolCallIds(run3First?.messages ?? [])).not.toContain(GROUP1);
  expect(toolCallIds(run3First?.messages ?? [])).not.toContain(GROUP2);
  expect((await requiredBriefOf(h.host, run3Ref)).brief.session).toMatchObject({ continuity: 'same_session_history', sessionRef: s1 });
  // The Goal-level 推进 runs the gate (no model call) and completes the Goal.
  expect((await h.advance(h.select('a8-3l-goal'))).state).toBe('completed');
  expect(await h.goalDisplay()).toMatchObject({ phase: 'COMPLETED' });
  expect(h.modelCalls()).toBe(7);

  // Step 7. Another start on the same data reconciles nothing and writes nothing (S1 stays available, not archived).
  const settled = h.counts();
  const again = await h.restart({ crash: true });
  expect(again.report).toMatchObject({ runs: [], queries: [], checks: [], controls: [], redriveGoals: [], problems: [] });
  expect(h.counts()).toEqual(settled);
  expect((await execution(h, run1Ref)).session).toMatchObject({ lifecycle: 'active', health: 'available', healthConclusion: null,
    historyCursor: run3.session.historyCursor });
  expect(run3.session.historyCursor, 'S1\'s cursor moved past the closure (K L3)').not.toBe(s1Cursor);
  await h.drainAbandoned();

  // A8-3p with K (L3, §6): Run3 continues S1's own records past the closure, so S1's earlier completed history
  // (Run0's Turn, then Run2's) reaches a later Run too; the paused Turn never does. Nothing is seeded here, so
  // GAP-50 (ii) (a seeded prefix that does not reach a later Run) applies only to the fallback in a new Session.
  expect(run3Messages, 'S1\'s earlier completed Turn reaches a later Run in S1').toContain(RUN0_TEXT);
  expect(toolCallIds(run3First?.messages ?? [])).toEqual(['a8-3l-run0-read']);
}, 240_000);

it('A8-3n (closing supported; KA-10, W-11, RUN-19, LA-7, §13.4 #17, LA-6): the Kernel paused, a resume queued, the crash before the re-entry: an ordinary interruption with the resume superseded; the start-up maintenance closes the dangling Kernel Turn although the re-drive is off and keeps the Session; the start-up re-drive requeues it uncounted into the same Session, and a later check failure counts as usual', async () => {
  let scenario: HostScenario | undefined;
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  const replies: ScriptedReply[] = [
    { kind: 'calls', calls: [{ callId: 'a8-3n-run0-read', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: RUN0_TEXT },
    // Run1 in S1: one edit (group 1); the Kernel pauses before group 2 (declared while the pause was submitted).
    { kind: 'calls', calls: [{ callId: 'a8-3n-group1-edit', name: 'edit', args: { mode: 'create', path: 'src/a8-3n-step.txt', newText: 'step 1\n' } }] },
    { kind: 'calls', calls: [{ callId: 'a8-3n-group2-read', name: 'read', args: { path: 'src/module.ts' } }] },
    // Run2 (the automatic continuation, in S1 after the closure) answers without the result file; Run3 (the counted
    // rework) writes it.
    { kind: 'text', text: 'restart scenario A8-3n: Run2 continued without the result file' },
    ...editThenText('a8-3n-run3')];
  const h = await openHostScenario({ workIds: [RUN0_TASK, AG2B_WORK_TASK_ID], check: 'pass',
    automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' }, script: { replies,
      duringReply: async (index) => {
        if (index !== 3 || scenario === undefined) return;
        pauseRef = (await submitControl(scenario.host, await selectedRun(scenario), 'pause', 'restart scenario: pause', 'a8-3n-pause')).intent.ref;
      } } });
  scenario = h;
  await h.advance(h.select('a8-3n-run0', RUN0_TASK));
  const s1 = (await execution(h, await selectedRun(h, RUN0_TASK))).session.ref;
  expect((await h.advance({ ...h.select('a8-3n-run1', AG2B_WORK_TASK_ID), sessionHint: { projectId: s1.projectId,
    sessionId: s1.sessionId } })).state).toBe('waiting');
  const run1Ref = await selectedRun(h);
  if (pauseRef === undefined) throw new Error('the pause must be submitted');
  expect(await readControl(h.host, pauseRef)).toMatchObject({ status: 'applied', observation: { kind: 'paused' } });

  // The resume is submitted on a second Host without the lease (HL-07): an entered Run's control stays queued there,
  // so the Kernel Turn is still paused when the lease Host crashes (the crash comes before the re-entry).
  const peer = await h.startPeer();
  const paused = await execution(h, run1Ref);
  const resumed = await post<WriteResult<SubmittedControl>>(peer, 'controls/submit', graphWrite(AG2B_SCOPE,
    { runRef: run1Ref, kind: 'resume', reason: 'restart scenario: resume' }, 'a8-3n-resume', [{ ref: run1Ref, revision: paused.run.revision }]));
  if (resumed.status !== 'committed') throw new Error(`resume: ${JSON.stringify(resumed)}`);
  const resumeRef = resumed.value.intent.ref;
  expect(await readControl(h.host, resumeRef)).toMatchObject({ kind: 'resume', status: 'queued' });
  expect((await execution(h, run1Ref)).run).toMatchObject({ status: 'running', controlState: { intentRef: resumeRef, desiredState: 'running' } });
  await assertInvariants(h, 'a8-3n resume queued', stepOf(h, 'other', 'a8-3n resume queued'));

  // The crash (re-drive off for the reconcile's own assertions). W-11: the pointer is not paused, the Turn is clean.
  const atCrash = h.counts();
  const report = await h.restart({ crash: true, check: 'result_file' });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(run1Ref), row: 'W-11', status: 'reconciled',
    reason: 'interrupted_clean' }], redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }],
    problems: [] });
  expect(h.counts()).toMatchObject({ modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted,
    checksBegun: atCrash.checksBegun });
  const reconciled = await execution(h, run1Ref);
  expect(reconciled.run).toMatchObject({ status: 'ended', outcome: 'crashed', reconciliation: { status: 'done',
    observation: { kind: 'interrupted_clean', kernelPaused: true, pausedIntentRef: null } } });
  expect(await readControl(h.host, resumeRef)).toMatchObject({ status: 'superseded', observation: { kind: 'terminal_without_cancel' } });
  // K (KA1, KA-10 RUN-19): the start-up maintenance closed S1's dangling Kernel Turn although the re-drive is off;
  // SES-13 made S1 available again, and it is not archived.
  expect(reconciled.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'available', healthConclusion: null });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'run_failed' },
    failure: { failureClass: 'interrupted', interruption: { kind: 'executing' } } });
  // §12.10 step 4: the resume, sent again with the same identity on the new Host (its answer lost), gets its original
  // receipt (the intent as it was committed, queued) and writes nothing; the superseded intent is not touched.
  const beforeReplay = h.counts();
  expect(await h.post('controls/submit', graphWrite(AG2B_SCOPE, { runRef: run1Ref, kind: 'resume', reason: 'restart scenario: resume' },
    'a8-3n-resume', [{ ref: run1Ref, revision: paused.run.revision }]))).toEqual({ ...resumed, replayed: true });
  expect(h.counts()).toEqual(beforeReplay);
  expect(await readControl(h.host, resumeRef)).toMatchObject({ status: 'superseded' });
  // Off: no TaskRequeue until a 推进 (or a start with the re-drive on).
  expect(h.lastWorld?.requeues).toEqual([]);
  // An idle Session of the work role is available from now on: the continuation must still not reuse it (LA-1).
  const idle = (await createAG2bSession(h.host, 'a8-3n-idle', AG2B_WORK_ROLE)).sessionRef;
  await assertInvariants(h, 'a8-3n idle Session', stepOf(h, 'other', 'a8-3n idle Session'));

  // A start with the re-drive on: no workflow/advance; the automation requeues (uncounted, keys not compared) and
  // claims it in S1, available again since the closure (no create_session); Run2 FAILs, the counted rework passes.
  await h.restart({ automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'auto' } });
  await waitFor(() => h.goalDisplay(), display => display.phase === 'COMPLETED', 'the start-up re-drive to complete the Goal');
  await assertInvariants(h, 'a8-3n re-driven');
  const requeues = h.lastWorld?.requeues ?? [];
  expect(requeues).toHaveLength(2);
  const continuation = requeues.find(requeue => requeue.failureClass === 'interrupted');
  expect(continuation).toMatchObject({ afterRunRef: run1Ref, interruption: 'executing', basisComparison: 'skipped_interrupted',
    requestedBy: WORKFLOW_AUTOMATION_ACTOR, automation: { automatic: true, counted: false, autoCount: 0 } });
  expect(requeues.find(requeue => requeue.failureClass === 'check_failed'))
    .toMatchObject({ automation: { automatic: true, counted: true, autoCount: 1 } });
  const run2 = h.lastWorld?.runs.find(run => run.requeueRef !== undefined && JSON.stringify(run.requeueRef) === JSON.stringify(continuation?.ref));
  if (run2 === undefined) throw new Error('the continuation Run must exist');
  const run2Record = await execution(h, run2.ref);
  expect(run2Record.session.ref.sessionId, 'K (L7): the continuation runs in the original Session').toBe(s1.sessionId);
  expect(run2Record.session.ref.sessionId, 'LA-1: not another available Session').not.toBe(idle.sessionId);
  const { brief, digest } = await requiredBriefOf(h.host, run2.ref);
  expect(brief).toMatchObject({ mode: 'resume_after_interruption', trigger: { actorClass: 'system', autoRework: { count: 0, cap: 3 } },
    previous: { runRef: run1Ref, interruption: { kind: 'executing', kernelPaused: true } },
    session: { continuity: 'same_session_without_previous_turn', sessionRef: { sessionId: s1.sessionId }, seededFrom: null } });
  expect(brief.toolCalls.confirmed.map(call => call.callId)).toEqual(['a8-3n-group1-edit']);
  expect(brief.toolCalls.notExecuted.map(call => call.callId)).toEqual(['a8-3n-group2-read']);
  // Run2's first request: the brief (which says the previous Turn is not in the model history, K L9) and Run0's Turn
  // only (K L3: S1 is restored up to its cursor before the interrupted Turn).
  const run2First = h.modelRequests()[4];
  const text = JSON.stringify(run2First?.messages ?? []);
  expect(text).toContain(continuationBriefMarker(digest));
  expect(text).toContain('被 Host 重启中断');
  expect(text).toContain(`接续方式：在同一 Session ${s1.sessionId} 中继续，但上一次执行的 Turn 不在模型历史中。`);
  expect(text).toContain(RUN0_TEXT);
  expect(toolCallIds(run2First?.messages ?? [])).toEqual(['a8-3n-run0-read']);
  // Run2 reached turn.started in S1: after the closure the Kernel accepts a new Turn there.
  expect(run2Record.run).toMatchObject({ status: 'ended', outcome: 'completed' });
  expect(run2Record.run.startedAt).not.toBeNull();
  expect(h.modelCalls()).toBe(7);
  await expectQuietHarnessRestart(h, 'a8-3n');
}, 240_000);

// Slice K §6: the A8-3n case with closing unsupported (L4 step 5). Since 2C (round-6 item 10, 2C spec §16) the reused S1
// holds the open responsibility for its Task, so the start-up maintenance archives it before the re-drive (K L7: a
// definite failure keeps today's logic; decision 42 item 2); the K L8 fallback (a new Session) is not reached.
it('A8-3n (closing unsupported; W-11, RUN-19, LA-7, §13.4 #17, LA-6, K L7, decisions 42 item 2 and 43): the Kernel paused, a resume queued, the crash before the re-entry: an ordinary interruption with the resume superseded; the start-up maintenance archives the retired line with an anomaly anchor, the start-up re-drive requeues it uncounted and the ordinary selection gives it to the idle Session seeded with the old history, and a later check failure counts as usual', async () => {
  let scenario: HostScenario | undefined;
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  const replies: ScriptedReply[] = [
    { kind: 'calls', calls: [{ callId: 'a8-3n-run0-read', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: RUN0_TEXT },
    // Run1 in S1: one edit (group 1); the Kernel pauses before group 2 (declared while the pause was submitted).
    { kind: 'calls', calls: [{ callId: 'a8-3n-group1-edit', name: 'edit', args: { mode: 'create', path: 'src/a8-3n-step.txt', newText: 'step 1\n' } }] },
    { kind: 'calls', calls: [{ callId: 'a8-3n-group2-read', name: 'read', args: { path: 'src/module.ts' } }] },
    // Run2 (the automatic continuation, in the idle Session) answers without the result file; Run3 (the counted rework) writes it.
    { kind: 'text', text: 'restart scenario A8-3n: Run2 continued without the result file' },
    ...editThenText('a8-3n-run3')];
  const h = await openHostScenario({ workIds: [RUN0_TASK, AG2B_WORK_TASK_ID], check: 'pass',
    automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' }, script: { replies,
      duringReply: async (index) => {
        if (index !== 3 || scenario === undefined) return;
        pauseRef = (await submitControl(scenario.host, await selectedRun(scenario), 'pause', 'restart scenario: pause', 'a8-3n-pause')).intent.ref;
      } } });
  scenario = h;
  await h.advance(h.select('a8-3n-run0', RUN0_TASK));
  const s1 = (await execution(h, await selectedRun(h, RUN0_TASK))).session.ref;
  expect((await h.advance({ ...h.select('a8-3n-run1', AG2B_WORK_TASK_ID), sessionHint: { projectId: s1.projectId,
    sessionId: s1.sessionId } })).state).toBe('waiting');
  const run1Ref = await selectedRun(h);
  if (pauseRef === undefined) throw new Error('the pause must be submitted');
  expect(await readControl(h.host, pauseRef)).toMatchObject({ status: 'applied', observation: { kind: 'paused' } });

  // The resume is submitted on a second Host without the lease (HL-07): an entered Run's control stays queued there,
  // so the Kernel Turn is still paused when the lease Host crashes (the crash comes before the re-entry).
  const peer = await h.startPeer();
  const paused = await execution(h, run1Ref);
  const resumed = await post<WriteResult<SubmittedControl>>(peer, 'controls/submit', graphWrite(AG2B_SCOPE,
    { runRef: run1Ref, kind: 'resume', reason: 'restart scenario: resume' }, 'a8-3n-resume', [{ ref: run1Ref, revision: paused.run.revision }]));
  if (resumed.status !== 'committed') throw new Error(`resume: ${JSON.stringify(resumed)}`);
  const resumeRef = resumed.value.intent.ref;
  expect(await readControl(h.host, resumeRef)).toMatchObject({ kind: 'resume', status: 'queued' });
  expect((await execution(h, run1Ref)).run).toMatchObject({ status: 'running', controlState: { intentRef: resumeRef, desiredState: 'running' } });
  await assertInvariants(h, 'a8-3n resume queued', stepOf(h, 'other', 'a8-3n resume queued'));

  // K (L4 step 5, L7): from this start on the Kernel cannot close a Turn, so the closure is unsupported: the start-up
  // maintenance keeps today's logic; S1 still holds its Task, so it is archived with a drop and an anomaly anchor, and
  // the ordinary selection gives the Task to another Session.
  kernelClosure.supported = false;
  // The crash (re-drive off for the reconcile's own assertions). W-11: the pointer is not paused, the Turn is clean.
  const atCrash = h.counts();
  const report = await h.restart({ crash: true, check: 'result_file' });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(run1Ref), row: 'W-11', status: 'reconciled',
    reason: 'interrupted_clean' }], redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }],
    problems: [] });
  expect(h.counts()).toMatchObject({ modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted,
    checksBegun: atCrash.checksBegun });
  const reconciled = await execution(h, run1Ref);
  expect(reconciled.run).toMatchObject({ status: 'ended', outcome: 'crashed', reconciliation: { status: 'done',
    observation: { kind: 'interrupted_clean', kernelPaused: true, pausedIntentRef: null } } });
  expect(await readControl(h.host, resumeRef)).toMatchObject({ status: 'superseded', observation: { kind: 'terminal_without_cancel' } });
  // Decisions 42 item 2/43/54, S1-AUTO-02 (IT10), K L7 (a definite closure failure keeps today's logic): S1 is retired
  // with no continuation and holds the open responsibility its Run1 claim opened (2C item 10), the interruption is
  // the platform's clean one, so the start-up maintenance archives it at once, drops the Task and anchors the anomaly.
  expect(reconciled.session).toMatchObject({ lifecycle: 'archived', occupancy: null, health: 'unavailable',
    healthConclusion: 'kernel_turn_open' });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'run_failed' },
    failure: { failureClass: 'interrupted', interruption: { kind: 'executing' } } });
  // §12.10 step 4: the resume, sent again with the same identity on the new Host (its answer lost), gets its original
  // receipt (the intent as it was committed, queued) and writes nothing; the superseded intent is not touched.
  const beforeReplay = h.counts();
  expect(await h.post('controls/submit', graphWrite(AG2B_SCOPE, { runRef: run1Ref, kind: 'resume', reason: 'restart scenario: resume' },
    'a8-3n-resume', [{ ref: run1Ref, revision: paused.run.revision }]))).toEqual({ ...resumed, replayed: true });
  expect(h.counts()).toEqual(beforeReplay);
  expect(await readControl(h.host, resumeRef)).toMatchObject({ status: 'superseded' });
  // Off: no TaskRequeue until a 推进 (or a start with the re-drive on).
  expect(h.lastWorld?.requeues).toEqual([]);
  // An idle Session of the work role is available from now on; S1 is archived, so the ordinary selection takes it (decision 43).
  const idle = (await createAG2bSession(h.host, 'a8-3n-idle', AG2B_WORK_ROLE)).sessionRef;
  await assertInvariants(h, 'a8-3n idle Session', stepOf(h, 'other', 'a8-3n idle Session'));

  // A start with the re-drive on: no workflow/advance; the automation requeues (uncounted, keys not compared) and the
  // ordinary selection claims it in the idle Session; Run2 FAILs, the counted rework passes.
  await h.restart({ automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'auto' } });
  await waitFor(() => h.goalDisplay(), display => display.phase === 'COMPLETED', 'the start-up re-drive to complete the Goal');
  await assertInvariants(h, 'a8-3n re-driven');
  const requeues = h.lastWorld?.requeues ?? [];
  expect(requeues).toHaveLength(2);
  const continuation = requeues.find(requeue => requeue.failureClass === 'interrupted');
  expect(continuation).toMatchObject({ afterRunRef: run1Ref, interruption: 'executing', basisComparison: 'skipped_interrupted',
    requestedBy: WORKFLOW_AUTOMATION_ACTOR, automation: { automatic: true, counted: false, autoCount: 0 } });
  expect(requeues.find(requeue => requeue.failureClass === 'check_failed'))
    .toMatchObject({ automation: { automatic: true, counted: true, autoCount: 1 } });
  const run2 = h.lastWorld?.runs.find(run => run.requeueRef !== undefined && JSON.stringify(run.requeueRef) === JSON.stringify(continuation?.ref));
  if (run2 === undefined) throw new Error('the continuation Run must exist');
  const run2Record = await execution(h, run2.ref);
  expect(run2Record.session.ref.sessionId, 'not the archived S1').not.toBe(s1.sessionId);
  // Decision 43: the dropped Task is claimed by the ordinary selection; the idle Session of the role is reused.
  expect(run2Record.session.ref.sessionId, 'decision 43: the ordinary selection takes the idle Session').toBe(idle.sessionId);
  const { brief, digest } = await requiredBriefOf(h.host, run2.ref);
  // The idle Session's cursor is empty and on the same Kernel adapter, so `prepare` still seeds it with S1's
  // completed history (LA-1 (c)); the brief carries the retired_archive anchor (decision 42 item 2).
  expect(brief).toMatchObject({ mode: 'resume_after_interruption', trigger: { actorClass: 'system', autoRework: { count: 0, cap: 3 } },
    previous: { runRef: run1Ref, interruption: { kind: 'executing', kernelPaused: true } },
    session: { continuity: 'other_session_seeded', seededFrom: { sessionRef: { sessionId: s1.sessionId } } },
    anomalies: { anchors: [{ cause: 'retired_archive', runRef: run1Ref, sessionRef: { sessionId: s1.sessionId },
      task: { taskId: AG2B_WORK_TASK_ID }, changedFiles: { status: 'known', confirmed: ['src/a8-3n-step.txt'] } }] } });
  const anchors = await h.post<ReadResult<{ items: unknown[] }>>('anomalies/list', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF, page: { limit: 20 } }));
  expect(anchors).toMatchObject({ status: 'ready', value: { items: [{ anchor: { cause: 'retired_archive', runRef: run1Ref },
    pickedUpBy: run2.ref }] } });
  expect(brief.toolCalls.confirmed.map(call => call.callId)).toEqual(['a8-3n-group1-edit']);
  expect(brief.toolCalls.notExecuted.map(call => call.callId)).toEqual(['a8-3n-group2-read']);
  // Run2's first request: the brief (which says the history ends before the interrupted Turn) and Run0's Turn only.
  const run2First = h.modelRequests()[4];
  const text = JSON.stringify(run2First?.messages ?? []);
  expect(text).toContain(continuationBriefMarker(digest));
  expect(text).toContain('被 Host 重启中断');
  expect(text).toContain(`带有 Session ${s1.sessionId} 到位置 ${String(brief.session.seededFrom?.throughPosition)} 的历史`);
  expect(text).toContain(RUN0_TEXT);
  expect(toolCallIds(run2First?.messages ?? [])).toEqual(['a8-3n-run0-read']);
  // Run2 reached turn.started in the idle Session: the Kernel did not refuse it (仍有活动 Run) — the old Session is never used.
  expect(run2Record.run).toMatchObject({ status: 'ended', outcome: 'completed' });
  expect(run2Record.run.startedAt).not.toBeNull();
  expect(h.modelCalls()).toBe(7);
  await expectQuietHarnessRestart(h, 'a8-3n');
}, 240_000);

it('A8-3q, A8-3o (W-21, W-20, HL-06, HL-01, LA-1, SES-02): a Run paused by a person ends paused-interrupted after a normal close as after a crash; another Task of the same role is never claimed into its retired Session; it runs in another Session with no Entering→Revoked loop', async () => {
  const WORK_B = 'ag2b-work-b';
  let scenario: HostScenario | undefined;
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  const h = await openHostScenario({ workIds: [AG2B_WORK_TASK_ID, WORK_B], check: 'pass',
    automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' }, script: {
      replies: [{ kind: 'calls', calls: [{ callId: 'a8-3q-a-read', name: 'read', args: { path: 'src/module.ts' } }] },
        { kind: 'text', text: 'restart scenario A8-3q: B completes its first Run' }],
      duringReply: async (index) => {
        if (index !== 0 || scenario === undefined) return;
        pauseRef = (await submitControl(scenario.host, await selectedRun(scenario), 'pause', 'restart scenario: pause', 'a8-3q-pause')).intent.ref;
      } } });
  scenario = h;
  // A's Run pauses at the safe point in Session SA.
  expect((await h.advance(h.select('a8-3q-a', AG2B_WORK_TASK_ID))).state).toBe('waiting');
  const runA = await selectedRun(h);
  if (pauseRef === undefined) throw new Error('the pause must be submitted');
  const atClose = h.counts();
  // A8-3o: the Host closes normally (HL-06 removes its lock), so the next start is HL-01; the result is A8-3l's (W-20,
  // RUN-24): paused-interrupted, SA retired (LA-1), no model call, Kernel Turn or check start during the reconcile.
  const report = await h.restart();
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-01', report: {
    runs: [{ ref: JSON.stringify(runA), row: 'W-20', status: 'reconciled', reason: 'interrupted_clean' }],
    redriveGoals: [], problems: [] } });
  expect(h.counts()).toMatchObject({ modelCalls: atClose.modelCalls, kernelTurnsStarted: atClose.kernelTurnsStarted,
    checksBegun: atClose.checksBegun });
  const reconciledA = await execution(h, runA);
  expect(reconciledA.run).toMatchObject({ status: 'ended', outcome: 'crashed', reconciliation: { status: 'done',
    observation: { kind: 'interrupted_clean', kernelPaused: true, pausedIntentRef: pauseRef } } });
  const sa = reconciledA.session;
  expect(sa).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted' } });
  expect((await h.taskRow(WORK_B)).execution, 'B has never been claimed').toBeNull();
  const reconciledEvents = h.ledgerEventTypes().filter(type => type === 'ExecutionRunReconciled').length;

  // The Goal-level 推进 skips A (stopped/task_paused) and claims B through chooseSession: never SA.
  const goalDrive = await h.advance(h.select('a8-3q-goal'));
  expect(await h.taskRow(WORK_B)).toMatchObject({ effectivePhase: 'satisfied' });
  // §12.10 step 4: B's claim, sent again with the same identity (its answer lost), gets its original receipt; nothing is written.
  const claimB = performedOf(h.select('a8-3q-goal'), goalDrive, 'claim_task');
  const beforeReplay = h.counts();
  const resent = await h.answer('workflow/advance', plain(AG2B_SCOPE, claimB.input)) as { value?: { receipt?: unknown } };
  expect(resent.value?.receipt).toEqual(replayOf(claimB.receipt));
  expect(h.counts()).toEqual(beforeReplay);
  const runB = await execution(h, await selectedRun(h, WORK_B));
  expect(runB.session.ref.sessionId).not.toBe(sa.ref.sessionId);
  expect(runB.session.role).toEqual(sa.role);
  // No Entering → Revoked loop: B entered at its first generation and nothing was reconciled not-entered.
  expect(runB.run).toMatchObject({ status: 'ended', outcome: 'completed', executionAuthorization: { generation: 1 } });
  expect(h.ledgerEventTypes().filter(type => type === 'ExecutionRunReconciled')).toHaveLength(reconciledEvents);
  expect((await execution(h, runA)).session).toMatchObject({ revision: sa.revision, occupancy: null, healthConclusion: 'kernel_turn_open' });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted' } });
  expect(h.modelCalls()).toBe(2);
  await expectQuietHarnessRestart(h, 'a8-3q');
}, 180_000);

// ---------------------------------------------------------------------------
// Moved cases (user decision 31): assertions unchanged except where slice K changes them (marked K): the A8-3o case
// continues in the same Session, and the contract (e) / A8-3r case is split into a closing-supported copy and the old
// case as the closing-unsupported fallback; A.2 step 6 adds the invariant checks (and marks them).
// ---------------------------------------------------------------------------

// Moved from tests/app/A2-host-restart.test.ts:68 (05125db): A8-3o (the close variant of A8-3l) with A8-3l steps 2-4 and 7,
// H-01 (a kernel_turn_open Session probed ready stays retired) and H-04 (an idle Session is not probed).
it('a Run paused at a safe point when its Host stopped ends paused-interrupted at the restart; a second start keeps its Session retired and writes nothing; 继续 closes the dangling Kernel Turn and continues the Task in the same Session (K KA-07)', async () => {
  const root = await tempDir('a2-restart-ws-');
  const database = await tempDir('a2-restart-db-');
  const publicDir = await publicDirectory();
  let idleSession: SessionRef | undefined;
  const inv: InvariantTarget = { database };   // A.2 step 6
  const { runRef, pauseIntentRef, oldSession, lockPath, crashedPid } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv, 'run', {   // A.2 step 6: checked per step
    // H-04: an idle, available Session is neither probed nor reported.
    beforeClose: async host => { idleSession = (await createAG2bSession(host, 'a2-restart-idle')).sessionRef; },
  });
  if (idleSession === undefined) throw new Error('the idle Session must exist');
  await assertInvariantsAt(inv, 'A8-3o paused, Host closed');   // A.2 step 6

  // Host 2 on the same ledger and Kernel store: takeover (HL-03), then the start-up reconcile.
  const second = await startAG2bHost(publicDir, { root, database });
  let reconciled: TaskExecutionRecord;
  try {
    await assertInvariantsAt(inv, 'A8-3o reconciled');   // A.2 step 6
    const hostInstanceId = second.host.reconcile.hostInstanceId;
    const runKey = JSON.stringify(runRef);
    expect(second.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-03',
      leaseReason: `the stale lock of pid ${String(crashedPid)} was taken over`,
      report: { hostInstanceId, sessions: [{ ref: sessionKey(oldSession), row: 'H-01' }],
        runs: [{ ref: runKey, row: 'W-20', status: 'reconciled' }], queries: [], checks: [], problems: [] } });
    expect(JSON.stringify(second.host.reconcile.report?.sessions)).not.toContain(idleSession.sessionId);
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({ hostInstanceId, pid: process.pid });
    // §12.1 step 7: the same report over the public route.
    expect(await post<ReadResult<HostReconcileReportV1>>(second, 'host/reconcile-report', plain(AG2B_SCOPE, {})))
      .toEqual({ status: 'ready', value: second.host.reconcile });

    // RUN-24 (C4): crashed, paused-interrupted, on the takeover basis; SES-06 + LA-1: released, cursor kept, retired.
    reconciled = await readExecution(second, runRef);
    expect(reconciled.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId },
        observation: { kind: 'interrupted_clean', kernelPaused: true, pausedIntentRef: pauseIntentRef } } });
    expect(reconciled.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open',
      historyCursor: oldSession.historyCursor });
    const oldSessionRef: SessionRef = { projectId: reconciled.session.ref.projectId, sessionId: reconciled.session.ref.sessionId };

    // LD-4: the public history read accepts the kernel_turn_open Session as read-only ...
    expect(await post(second, 'sessions/history', plain(AG2B_SCOPE, { sessionRef: oldSessionRef, afterCursor: null,
      throughCursor: null, limit: 10 }))).toMatchObject({ status: 'ready' });
    // ... while a claim on it is busy (SES-02: a retired Session takes no new execution).
    expect((await claimQueryOn(second, reconciled.session, 'old-session')).claim).toMatchObject({ status: 'rejected', code: 'busy' });

    // P19 (TASK-26): 已暂停，可继续 — blocked, never failed; a control on the ended Run is refused with the C4 text.
    expect(await workRow(second)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted',
      detail: { afterRunRef: runRef, pausedIntentRef: pauseIntentRef, kernelPaused: true } } });
    expect(await answer(second, 'controls/submit', graphWrite(AG2B_SCOPE, { runRef, kind: 'resume', reason: null },
      'a2-restart-resume-ended', [{ ref: runRef, revision: reconciled.run.revision }])))
      .toMatchObject({ status: 'rejected', code: 'busy', reason: 'the paused Run ended at the Host restart; continue the Task' });
    expect((await driveChecked(second, inv, selectWork('a2-restart-wait'))).steps)   // A.2 step 6: checked per step
      .toMatchObject([{ state: 'waiting', next: null }]);
    expect(second.scripted.calls(), 'the restart and the reads called no model').toBe(0);
  } finally {
    await second.host.close();
  }
  expect(existsSync(lockPath), 'the second Host removed its own lock').toBe(false);

  // A third start: C8 installs the Host setting `automation` (cap 0, no start-up re-drive); the retired Session
  // is probed again (health unavailable) and stays retired while its Kernel Turn is open (SES-13); nothing is written.
  await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: 'off' });
  const third = await startAG2bHost(publicDir, { root, database, replies: editThenText('a2-restart') });
  try {
    expect(third.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-01', report: {
      sessions: [{ ref: sessionKey(oldSession), row: 'H-01', status: 'left' }],
      runs: [], queries: [], checks: [], controls: [], redriveGoals: [], problems: [] } });
    const again = await readExecution(third, runRef);
    expect(again.run.revision, 'the second start rewrites no Run').toBe(reconciled.run.revision);
    expect(again.session).toMatchObject({ revision: reconciled.session.revision, health: 'unavailable', healthConclusion: 'kernel_turn_open' });

    // TASK-27: the operator continues the Task; this TaskRequeue lets the Workflow close the dangling Kernel Turn
    // (close_open_turn, K L4/L7) and claim the requeue in the same Session.
    const goal = await readGoal(third);
    const continued = await post<WriteResult<TaskRequeueOutcomeV1>>(third, 'tasks/requeue', graphWrite(AG2B_SCOPE,
      { taskRef: TASK, afterRunRef: runRef, reason: 'continue after the restart' }, 'a2-restart-continue',
      [{ ref: AG2B_GOAL_REF, revision: goal.revision }, { ref: runRef, revision: again.run.revision }]));
    if (continued.status !== 'committed' || continued.value.kind !== 'requeued') throw new Error(`continue: ${JSON.stringify(continued)}`);
    expect(continued.value.requeue).toMatchObject({ failureClass: 'interrupted', interruption: 'paused',
      stopIntentRef: pauseIntentRef, afterRunRef: runRef });
    const requeueRef = continued.value.requeue.ref;
    await assertInvariantsAt(inv, 'A8-3o continued', { kind: 'task_requeued', actor: SCENARIO_OPERATOR,
      automationPolicy: { schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: 'off' } });   // A.2 step 6
    // C8: the read model shows the cap the Host installed from its settings.
    expect(await workRow(third)).toMatchObject({ effectivePhase: 'pending', requeueRef, rework: { cap: 0 } });

    const done = (await driveChecked(third, inv, selectWork('a2-restart-continue', true),
      { policy: { schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: 'off' } })).steps;   // A.2 step 6: checked per step
    expect(done.at(-1), JSON.stringify(done.map(step => [step.state, step.reason, step.receipt?.kind]))).toMatchObject({ state: 'completed' });
    expect(await readFile(join(root, AG2B_RESULT_FILE), 'utf8')).toBe(AG2B_RESULT_TEXT);
    const finished = await workRow(third);
    expect(finished).toMatchObject({ effectivePhase: 'satisfied' });
    if (finished.execution === null || finished.execution.runId === runRef.runId) throw new Error('the continued Run must be selected');
    const continuedRun = await readExecution(third, finished.execution);
    expect(continuedRun.run).toMatchObject({ requeueRef, outcome: 'completed' });
    expect(continuedRun.session.ref.sessionId, 'K: the continuation runs in the same Session').toBe(oldSession.ref.sessionId);
    expect(third.scripted.calls()).toBe(2);
    await assertInvariantsAt(inv, 'A8-3o completed');   // A.2 step 6
  } finally {
    await third.host.close();
  }
}, 180_000);

// Moved from tests/app/A2-host-reconcile.test.ts:168 (05125db): A8-3m (W-20, CI-11) with a deviation: the pause is queued
// while model request #2 is held (group 2 never declared), not with group 2 declared and the safe point's `decide` read
// blocked (the Host has no `sourceAuthority` seam); see the restart group notes.
it('G-05, W-20 and CTL-08(f): a pause queued before the safe point ends the Run paused-interrupted at the restart (kernelPaused false); the pause is applied by the platform', async () => {
  const root = await tempDir('a2-crash-pause-ws-');
  const database = await tempDir('a2-crash-pause-db-');
  const publicDir = await publicDirectory();
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  const crashed = await crashMidTurn(root, database, publicDir, {
    whileBlocked: async (host, runRef) => { pauseRef = (await submitControl(host, runRef, 'pause', 'pause the Run', 'a2-crash-pause')).intent.ref; },
  });
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    if (pauseRef === undefined) throw new Error('the pause must be submitted');
    const hostInstanceId = second.host.reconcile.hostInstanceId;
    expect(second.host.reconcile).toMatchObject({ report: {
      runs: [{ ref: JSON.stringify(crashed.runRef), row: 'W-20', status: 'reconciled', reason: 'interrupted_clean' }] } });
    const ended = await readExecution(second, crashed.runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { observation: { kind: 'interrupted_clean', kernelPaused: false, pausedIntentRef: pauseRef } } });
    // CI-11: the queued pause is applied by the platform conclusion, never by a Kernel `run.paused` (CD-1).
    expect(await readControl(second, pauseRef)).toMatchObject({ status: 'applied', observation: { origin: 'platform_reconcile',
      kind: 'paused', detail: { hostInstanceId, runOutcome: 'crashed' } } });
    expect(await workRow(second)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted',
      detail: { kernelPaused: false, pausedIntentRef: pauseRef } } });
    await assertInvariantsAt({ database }, 'A8-3m reconciled');   // A.2 step 6
    // A.2 step 6: §12.10 A8-3m's Session (LA-1) and no model call during the reconcile.
    expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    expect(second.scripted.calls(), 'the reconcile calls no model').toBe(0);
    // A.2 step 6: §12.10 step 4, while the crashed Host still holds its call (draining it lets its Kernel end the Turn).
    await second.host.close();
    await expectQuietRestart(database, publicDir, root, { label: 'A8-3m' });
  } finally {
    await crashed.release();
    await second.host.close();
  }
}, 180_000);

// Moved from tests/app/A2-host-reconcile.test.ts:471 (05125db): A8-3l step 5 (contract (e)) and A8-3r (I-12 clause 10).
it('LA-1 and contract (e) (closing supported; KA-07, KA-09, A8-3l step 5, A8-3r): a person\'s 继续 closes the dangling Kernel Turn and the continuation runs in the original Session with its completed history; a later requeue after a never-entered continuation keeps that source and stays in that Session', async () => {
  const root = await tempDir('a2-seeded-ws-');
  const database = await tempDir('a2-seeded-db-');
  const publicDir = await publicDirectory();
  const RUN0_TASK = 'ag2b-work-0';
  const RUN0_TEXT = 'A2 Run0: the completed history the continuation keeps';
  let first: AG2bHost | undefined;
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  first = await startAG2bHost(publicDir, { root, database, replies: [
    { kind: 'calls', calls: [{ callId: 'a2-seeded-run0-edit', name: 'edit',
      args: { mode: 'create', path: 'src/ag2b-result.txt', newText: 'AG2B_RESULT_FROM_A' } }] },
    { kind: 'text', text: RUN0_TEXT },
    { kind: 'calls', calls: [{ callId: 'a2-seeded-interrupted-read', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 'never reached: the Run pauses' }],
  beforeReply: async (_request, index) => {
    if (index !== 2 || first === undefined) return;
    const runRef = (await workRow(first)).execution;
    if (runRef === null) throw new Error('the work Task must have a Run');
    pauseRef = (await submitControl(first, runRef, 'pause', 'pause before the restart', 'a2-seeded-pause')).intent.ref;
  } });
  let originalSession: TaskExecutionRecord['session'];
  let interrupted: RunRef;
  const inv: InvariantTarget = { database };   // A.2 step 6
  try {
    await seedAG2bWorkGraph(first, [RUN0_TASK, 'ag2b-work']);
    // Run0 of another Task completes in Session S1 (its history cursor moves).
    await driveChecked(first, inv, { ...selectWork('a2-seeded-run0'), taskId: RUN0_TASK });   // A.2 step 6: checked per step
    const run0Ref = (await workRow(first, RUN0_TASK)).execution;
    if (run0Ref === null) throw new Error('Run0 must exist');
    const run0 = await readExecution(first, run0Ref);
    expect(run0.run).toMatchObject({ status: 'ended', outcome: 'completed' });
    // The work Task's Run in the same Session pauses at the safe point after its first tool call.
    expect((await driveChecked(first, inv, { ...selectWork('a2-seeded-run1'),   // A.2 step 6: checked per step
      sessionHint: { projectId: run0.session.ref.projectId, sessionId: run0.session.ref.sessionId } })).steps.at(-1))
      .toMatchObject({ state: 'waiting' });
    const runRef = (await workRow(first)).execution;
    if (runRef === null || pauseRef === undefined) throw new Error('the paused Run must exist');
    interrupted = runRef;
    const paused = await readExecution(first, runRef);
    expect(paused.session.ref.sessionId, 'the work Task runs in the Session Run0 completed in').toBe(run0.session.ref.sessionId);
    expect(paused.session.historyCursor).not.toBeNull();
    originalSession = paused.session;
  } finally {
    await first.host.close();
  }
  await writeStaleLock(database);
  await assertInvariantsAt(inv, 'A8-3r paused');   // A.2 step 6
  const humanStep = (label: string): FuzzStep => ({ kind: 'task_requeued', actor: SCENARIO_OPERATOR,
    automationPolicy: DEFAULT_TASK_AUTOMATION_POLICY, label });   // A.2 step 6

  const second = await startAG2bHost(publicDir, { root, database, replies: [{ kind: 'text', text: 'A2 seeded: continued in the same Session' }] });
  try {
    expect(second.host.reconcile).toMatchObject({ report: { runs: [{ ref: JSON.stringify(interrupted), row: 'W-20' }] } });
    await assertInvariantsAt(inv, 'A8-3r reconciled');   // A.2 step 6
    const ended = await readExecution(second, interrupted);
    const requeue = async (afterRunRef: RunRef, requestId: string) => {
      const goal = await post<{ status: string; value: { goal: { revision: number } } }>(second, 'goals/read', plain(AG2B_SCOPE, { aggregateType: 'Goal', projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal' }));
      const run = await readExecution(second, afterRunRef);
      const written = await post<WriteResult<{ kind: string }>>(second, 'tasks/requeue', graphWrite(AG2B_SCOPE,
        { taskRef: { projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal', taskId: 'ag2b-work' }, afterRunRef, reason: 'continue' }, requestId,
        [{ ref: { aggregateType: 'Goal', projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal' }, revision: goal.value.goal.revision },
          { ref: afterRunRef, revision: run.run.revision }]));
      expect(written, requestId).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
      await assertInvariantsAt(inv, requestId, humanStep(requestId));   // A.2 step 6
    };
    await requeue(interrupted, 'a2-seeded-continue');
    // K (L4, L7 KA3): the person's TaskRequeue lets the Workflow close S1's dangling Kernel Turn; the continuation r2
    // is claimed in S1 and prepared, then cancelled before it enters (D-7).
    await driveChecked(second, inv, selectWork('a2-seeded-r2', true), { stopBefore: 'start' });   // A.2 step 6: checked per step
    const r2Ref = (await workRow(second)).execution;
    if (r2Ref === null || r2Ref.runId === interrupted.runId) throw new Error('the continuation r2 must be claimed');
    const r2 = await readExecution(second, r2Ref);
    expect(r2.session.ref.sessionId, 'K: r2 is claimed in the original Session').toBe(originalSession.ref.sessionId);
    const source = { sessionRef: { projectId: originalSession.ref.projectId, sessionId: originalSession.ref.sessionId } };
    expect((await submitControl(second, r2Ref, 'cancel', 'not this one', 'a2-seeded-r2-cancel')).intent).toMatchObject({ status: 'applied' });
    expect((await readExecution(second, r2Ref)).run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
    await assertInvariantsAt(inv, 'A8-3r r2 claimed and cancelled');   // A.2 step 6
    // A.2 step 6: r2 took no Kernel Turn: S1's cursor is still Run0's completed boundary (K L3: the closure does not
    // move it), so S1 is reusable for the next claim.
    const r2Session = (await readExecution(second, r2Ref)).session;
    expect(r2Session).toMatchObject({ occupancy: null, health: 'available', historyCursor: originalSession.historyCursor });

    // A8-3r: the next requeue after the never-entered r2 carries the original source; r3 continues in S1 again.
    await requeue(r2Ref, 'a2-seeded-again');
    // A.2 step 6: the new TaskRequeue's historySource equals the previous TaskRequeue's (the old Session and cursor), not null.
    const requeues = inv.lastWorld?.requeues ?? [];
    expect(requeues).toHaveLength(2);
    const continueRequeue = requeues.find(candidate => candidate.afterRunRef.runId === interrupted.runId);
    const againRequeue = requeues.find(candidate => candidate.afterRunRef.runId === r2Ref.runId);
    expect(continueRequeue?.historySource).toMatchObject({ sessionRef: source.sessionRef, throughPosition: expect.any(Number) });
    expect(againRequeue?.historySource, 'I-12 clause 10: the source is carried over').toEqual(continueRequeue?.historySource);
    const done = (await driveChecked(second, inv, selectWork('a2-seeded-r3', true))).steps;   // A.2 step 6: checked per step
    expect(done.at(-1), JSON.stringify(done.map(step => [step.state, step.reason, step.receipt?.kind]))).toMatchObject({ state: 'completed' });
    const r3Ref = (await workRow(second)).execution;
    if (r3Ref === null || r3Ref.runId === r2Ref.runId) throw new Error('the continuation r3 must run');
    // A.2 step 6: the Workflow claims r3 in S1, the reusable Session r2 left (W-21: reusable → that Session).
    expect((await readExecution(second, r3Ref)).session.ref.sessionId, 'r3 is claimed in S1').toBe(r2Session.ref.sessionId);
    const brief = await post<{ status: string; value: { brief: { session: { seededFrom: { throughPosition: number } | null } } } }>(second,
      'executions/brief', plain(AG2B_SCOPE, { runRef: r3Ref }));
    // K L9 (the existing rule): r2 never entered and r3 is in r2's Session, so the brief continues in the same Session
    // without the previous Turn; nothing is seeded.
    expect(brief, 'r3 brief').toMatchObject({ status: 'ready', value: { brief: { session: {
      continuity: 'same_session_without_previous_turn', sessionRef: { sessionId: originalSession.ref.sessionId }, seededFrom: null } } } });
    // The first (and only) provider request of r3 carries Run0's completed Turn as history, never the interrupted
    // Turn (that one is described by the brief only).
    const messages = second.scripted.requests[0]?.messages ?? [];
    expect(JSON.stringify(messages)).toContain(RUN0_TEXT);
    expect(messages.some(message => message.role === 'tool' && message.callId === 'a2-seeded-run0-edit')).toBe(true);
    expect(messages.some(message => message.role === 'tool' && message.callId === 'a2-seeded-interrupted-read')).toBe(false);
    expect(second.scripted.calls()).toBe(1);
    expect(ended.session).toMatchObject({ healthConclusion: 'kernel_turn_open' });
    await assertInvariantsAt(inv, 'A8-3r completed');   // A.2 step 6
  } finally {
    await second.host.close();
  }
  await expectQuietRestart(database, publicDir, root, { label: 'A8-3r' });   // A.2 step 6
}, 240_000);

// Slice K §6: the same moved case kept as the fallback with closing unsupported (L4 step 5, L8): a new Session, seeded.
it('LA-1 and contract (e) (closing unsupported; A8-3l step 5, A8-3r, K L8): the continuation in a new Session is seeded with the original Session\'s completed history and says so; a later requeue after a never-entered continuation keeps that source', async () => {
  const root = await tempDir('a2-seeded-ws-');
  const database = await tempDir('a2-seeded-db-');
  const publicDir = await publicDirectory();
  const RUN0_TASK = 'ag2b-work-0';
  const RUN0_TEXT = 'A2 Run0: the completed history the continuation keeps';
  let first: AG2bHost | undefined;
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  first = await startAG2bHost(publicDir, { root, database, replies: [
    { kind: 'calls', calls: [{ callId: 'a2-seeded-run0-edit', name: 'edit',
      args: { mode: 'create', path: 'src/ag2b-result.txt', newText: 'AG2B_RESULT_FROM_A' } }] },
    { kind: 'text', text: RUN0_TEXT },
    { kind: 'calls', calls: [{ callId: 'a2-seeded-interrupted-read', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 'never reached: the Run pauses' }],
  beforeReply: async (_request, index) => {
    if (index !== 2 || first === undefined) return;
    const runRef = (await workRow(first)).execution;
    if (runRef === null) throw new Error('the work Task must have a Run');
    pauseRef = (await submitControl(first, runRef, 'pause', 'pause before the restart', 'a2-seeded-pause')).intent.ref;
  } });
  let originalSession: TaskExecutionRecord['session'];
  let interrupted: RunRef;
  const inv: InvariantTarget = { database };   // A.2 step 6
  try {
    await seedAG2bWorkGraph(first, [RUN0_TASK, 'ag2b-work']);
    // Run0 of another Task completes in Session S1 (its history cursor moves).
    await driveChecked(first, inv, { ...selectWork('a2-seeded-run0'), taskId: RUN0_TASK });   // A.2 step 6: checked per step
    const run0Ref = (await workRow(first, RUN0_TASK)).execution;
    if (run0Ref === null) throw new Error('Run0 must exist');
    const run0 = await readExecution(first, run0Ref);
    expect(run0.run).toMatchObject({ status: 'ended', outcome: 'completed' });
    // The work Task's Run in the same Session pauses at the safe point after its first tool call.
    expect((await driveChecked(first, inv, { ...selectWork('a2-seeded-run1'),   // A.2 step 6: checked per step
      sessionHint: { projectId: run0.session.ref.projectId, sessionId: run0.session.ref.sessionId } })).steps.at(-1))
      .toMatchObject({ state: 'waiting' });
    const runRef = (await workRow(first)).execution;
    if (runRef === null || pauseRef === undefined) throw new Error('the paused Run must exist');
    interrupted = runRef;
    const paused = await readExecution(first, runRef);
    expect(paused.session.ref.sessionId, 'the work Task runs in the Session Run0 completed in').toBe(run0.session.ref.sessionId);
    expect(paused.session.historyCursor).not.toBeNull();
    originalSession = paused.session;
  } finally {
    await first.host.close();
  }
  await writeStaleLock(database);
  await assertInvariantsAt(inv, 'A8-3r paused');   // A.2 step 6
  const humanStep = (label: string): FuzzStep => ({ kind: 'task_requeued', actor: SCENARIO_OPERATOR,
    automationPolicy: DEFAULT_TASK_AUTOMATION_POLICY, label });   // A.2 step 6

  // K (L4 step 5, L8): from this start on the Kernel cannot close a Turn, so the Workflow falls back to a new Session.
  kernelClosure.supported = false;
  const second = await startAG2bHost(publicDir, { root, database, replies: [{ kind: 'text', text: 'A2 seeded: continued in a new Session' }] });
  try {
    expect(second.host.reconcile).toMatchObject({ report: { runs: [{ ref: JSON.stringify(interrupted), row: 'W-20' }] } });
    await assertInvariantsAt(inv, 'A8-3r reconciled');   // A.2 step 6
    const ended = await readExecution(second, interrupted);
    const requeue = async (afterRunRef: RunRef, requestId: string) => {
      const goal = await post<{ status: string; value: { goal: { revision: number } } }>(second, 'goals/read', plain(AG2B_SCOPE, { aggregateType: 'Goal', projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal' }));
      const run = await readExecution(second, afterRunRef);
      const written = await post<WriteResult<{ kind: string }>>(second, 'tasks/requeue', graphWrite(AG2B_SCOPE,
        { taskRef: { projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal', taskId: 'ag2b-work' }, afterRunRef, reason: 'continue' }, requestId,
        [{ ref: { aggregateType: 'Goal', projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal' }, revision: goal.value.goal.revision },
          { ref: afterRunRef, revision: run.run.revision }]));
      expect(written, requestId).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
      await assertInvariantsAt(inv, requestId, humanStep(requestId));   // A.2 step 6
    };
    await requeue(interrupted, 'a2-seeded-continue');
    // The continuation r2 is claimed in a new Session (LA-1) and prepared, then cancelled before it enters (D-7).
    await driveChecked(second, inv, selectWork('a2-seeded-r2', true), { stopBefore: 'start' });   // A.2 step 6: checked per step
    const r2Ref = (await workRow(second)).execution;
    if (r2Ref === null || r2Ref.runId === interrupted.runId) throw new Error('the continuation r2 must be claimed');
    const r2 = await readExecution(second, r2Ref);
    expect(r2.session.ref.sessionId).not.toBe(originalSession.ref.sessionId);
    const seededFrom = { sessionRef: { projectId: originalSession.ref.projectId, sessionId: originalSession.ref.sessionId } };
    expect((await submitControl(second, r2Ref, 'cancel', 'not this one', 'a2-seeded-r2-cancel')).intent).toMatchObject({ status: 'applied' });
    expect((await readExecution(second, r2Ref)).run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
    await assertInvariantsAt(inv, 'A8-3r r2 claimed and cancelled');   // A.2 step 6
    // A.2 step 6: S2 (r2's Session) took no Kernel Turn: its cursor is still null, so it is reusable for the next claim.
    const s2 = (await readExecution(second, r2Ref)).session;
    expect(s2).toMatchObject({ occupancy: null, health: 'available', historyCursor: null });

    // A8-3r: the next requeue after the never-entered r2 carries the original source; r3 is seeded the same way.
    await requeue(r2Ref, 'a2-seeded-again');
    // A.2 step 6: the new TaskRequeue's historySource equals the previous TaskRequeue's (the old Session and cursor), not null.
    const requeues = inv.lastWorld?.requeues ?? [];
    expect(requeues).toHaveLength(2);
    const continueRequeue = requeues.find(candidate => candidate.afterRunRef.runId === interrupted.runId);
    const againRequeue = requeues.find(candidate => candidate.afterRunRef.runId === r2Ref.runId);
    expect(continueRequeue?.historySource).toMatchObject({ sessionRef: seededFrom.sessionRef, throughPosition: expect.any(Number) });
    expect(againRequeue?.historySource, 'I-12 clause 10: the source is carried over').toEqual(continueRequeue?.historySource);
    const done = (await driveChecked(second, inv, selectWork('a2-seeded-r3', true))).steps;   // A.2 step 6: checked per step
    expect(done.at(-1), JSON.stringify(done.map(step => [step.state, step.reason, step.receipt?.kind]))).toMatchObject({ state: 'completed' });
    const r3Ref = (await workRow(second)).execution;
    if (r3Ref === null || r3Ref.runId === r2Ref.runId) throw new Error('the continuation r3 must run');
    // A.2 step 6: the Workflow claims r3 in S2, the reusable Session r2 left with a null cursor (W-21: reusable → that Session).
    expect((await readExecution(second, r3Ref)).session.ref.sessionId, 'r3 is claimed in S2').toBe(s2.ref.sessionId);
    const brief = await post<{ status: string; value: { brief: { session: { seededFrom: { throughPosition: number } | null } } } }>(second,
      'executions/brief', plain(AG2B_SCOPE, { runRef: r3Ref }));
    expect(brief, 'r3 brief').toMatchObject({ status: 'ready', value: { brief: { session: { continuity: 'other_session_seeded', seededFrom } } } });
    expect(brief.value.brief.session.seededFrom?.throughPosition).toBeGreaterThan(0);
    // The first (and only) provider request of r3 carries Run0's completed Turn as history, never the interrupted
    // Turn (that one is described by the brief only).
    const messages = second.scripted.requests[0]?.messages ?? [];
    expect(JSON.stringify(messages)).toContain(RUN0_TEXT);
    expect(messages.some(message => message.role === 'tool' && message.callId === 'a2-seeded-run0-edit')).toBe(true);
    expect(messages.some(message => message.role === 'tool' && message.callId === 'a2-seeded-interrupted-read')).toBe(false);
    expect(second.scripted.calls()).toBe(1);
    expect(ended.session).toMatchObject({ healthConclusion: 'kernel_turn_open' });
    await assertInvariantsAt(inv, 'A8-3r completed');   // A.2 step 6
  } finally {
    await second.host.close();
  }
  await expectQuietRestart(database, publicDir, root, { label: 'A8-3r' });   // A.2 step 6
}, 240_000);
