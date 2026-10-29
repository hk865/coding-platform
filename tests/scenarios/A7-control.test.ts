/**
 * A.2 step 6, scenario A7 and G7 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * `tests/scenarios/A7-control.test.ts`; §6 RUN-09..15, RUN-23, RD-8; §7 CTL-01..10 and "迟到 ack";
 * §2.3 GOAL-04..16, GOAL-28, GOAL-29 and the re-drive protocol; §12.7 G-01..G-06; lead decisions
 * LA-6, LA-7, L-10).
 *
 * Run controls:
 * 1. D-7 (moved): a not-entered Run takes a steer, a pause, a resume and a cancel from the platform
 *    at once; every receipt replays after a reopen.
 * 2. D-8 and CD-4 (moved): with a live Kernel Turn a cancel supersedes the queued pause in its own
 *    commit; the late natural terminal does not rewrite the superseded pause (迟到 ack) and settles
 *    the queued cancel and steer.
 * 3. An entered Run over the Host: a pause lands at the next safe point, a steer waits while the Run
 *    is paused, the resume re-enters the original Turn (no new Kernel Turn) and the Kernel accepts
 *    the steer there; the applied pause is never rewritten; a control on the ended Run is busy.
 * 4. An entered Run's cancel is applied by the Kernel at the next safe point and the unaccepted
 *    steer is settled with the terminal; a Goal pause meanwhile skips the Run (GOAL-12).
 * 5. RUN-23 and CTL-10 (moved): a cancel of a Run paused at a safe point ends it on the live
 *    handle's exit proof; added: the queued steer is superseded by that cancel (CTL-04(b)).
 * 6. Unsupported controls answer explicitly: a Query has no control, an unknown kind is invalid, a
 *    Runtime without control delivery answers unsupported.
 * 7. A yielded terminal keeps its queued intents (5.1 finding 5 (c)); a pause fences the wait and a
 *    resume lifts it (TASK-22/23); once a successor Run consumed the continuation (a real reply and
 *    a real continuation claim), the yielded Run takes no control (RD-8, 5.1 finding 5 (b)).
 *
 * Goal fan-out (G7):
 * 8. A7-G1 (moved, five cases): pause, resume and cancel of the Goal fan out to the Runs in
 *    process; VD-9 while paused; GOAL-11/14 on a live Turn; the GOAL-14 retry. Added: one pass over
 *    a not-entered and an entered Run together (§2.6), each Run's result and state on its own; a Goal
 *    cancel supersedes a person's queued pause of an entered Run (GOAL-13).
 * 9. GOAL-05 (LA-7): a Goal a person paused is resumed only by a person.
 * 10. A7-G2 (G-01, G-02, GOAL-14 at a restart): a Goal pause committed without the lease reaches no
 *     Run; the next start submits the fan-out once; a further start and a replay skip it; a Goal
 *     resume committed without the lease is submitted once by the next start.
 * 11. A7-G3 (G-03 as reachable): a fan-out pause whose outcome became unknown at the restart: the
 *     Goal resume submits no resume and continues nothing.
 * 12. A7-G4 (moved): fan-out pause → restart → 已暂停，可继续 → 继续 busy while the Goal is paused →
 *     the Goal resume continues the Task once (GOAL-29) with a brief, in the same Session once the Workflow has
 *     closed its dangling Kernel Turn (K slice).
 * 13. A7-G4b (G-05) and its G-01 contrast: a fan-out pause still queued at a crash ends the Run
 *     paused-interrupted; a fan-out pause never submitted ends it a plain interruption.
 * 14. A7-G5: a person's own pause stays through the Goal pause and resume; the Host stops while the
 *     Goal is paused; after the restart the Goal resume (in process and at the next start) continues
 *     nothing until the person presses 继续.
 * 15. A7-G6 and A7-G7 (moved): a resume (and pause and resume again) committed without the lease is
 *     continued exactly once at the next start.
 * 16. The start-up resume pass skips an entered Run step 2 left (W-07); the next start classifies it
 *     and GOAL-29 continues it (5.6 FINAL #28).
 * 17. GOAL-29 when a person's 继续 came first (G-04 "存在 → 跳过"): no second TaskRequeue.
 * A7-G4 with an earlier completed Turn (history carried over) and GOAL-29's race outcomes are in
 * tests/scenarios/A7-control-goal29.test.ts (this file would pass the ~90 s guideline).
 *
 * Not reachable at this seam (notes): GOAL-28 with a live Run (an OutcomeUnknown fan-out pause exists only on a
 * Run that ended unknown, which leaves the fan-out set: GOAL-15, case 11; GOAL-28 is driver-level,
 * tests/app/goal-fan-out-driver.test.ts).
 *
 * Every step that changes records is followed by the §11 invariant check (tests/scenarios/harness.ts;
 * the moved cases on their own stores through `assertInvariantsAt`, their Workflow drives through
 * `driveChecked` with each step's `FuzzStep`). Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GoalControlOutcomeV1, GoalDisplayHostReadV1, SessionRef, TaskExecutionRecord } from '../../src/app/core-http-types.js';
import type { ControlIntentSnapshotV1, SubmittedControl } from '../../src/contracts/control-intent.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, GOAL_FAN_OUT_ACTOR, WORKFLOW_AUTOMATION_ACTOR,
} from '../../src/contracts/task-requeue.js';
import { B2_AT, createB2RuntimeFixture, type B2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';
import { CLAIM_FIXTURE_AT, createTaskClaimFixture } from '../helpers/task-claim-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_QUERY_BUDGET, AG2B_QUERY_ROLE, AG2B_QUERY_ROLE_BINDING, AG2B_RESULT_FILE, AG2B_RESULT_TEXT,
  AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, graphWrite, plain, seedAG2bWorkGraph, startAG2bHost, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  TASK, answer, controlGoal, goalControlPins, moveKernelAside, post, publicDirectory, readControl, readExecution, readGoal, selectWork,
  submitControl, tempDir, workRow, writeAutomationSettings,
} from '../helpers/A2-restart-fixture.js';
import {
  assertInvariants, assertInvariantsAt, cleanupScenarios, hostCtx, openHostScenario, performs, waitFor, workRunCtx, SCENARIO_OPERATOR,
  type HostScenario, type Platform,
} from './harness.js';
import {
  NO_REDRIVE, READ_THEN_TEXT, advance, briefOf, driveChecked, editThenText, operatorRequeue, ownerStep, pausedRunOnClosedHostChecked,
  readCall, selectedRun, taskRefOf,
} from './support/common.js';
import {
  claimedRun, control, createTargetPlatform, display, fanOutIntentRef, goalControlled, hostOptions, intentOf, readIntentAnswer,
  reenter, refused, startHost, submit, submitRunControl,
} from './support/control.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await cleanupScenarios();
});

/** The Runs of one Task in the last invariant world. */
function runsOfTask(h: HostScenario, taskId: string = AG2B_WORK_TASK_ID): RunRef[] {
  return (h.lastWorld?.runs ?? []).filter(run => run.task.taskId === taskId).map(run => run.ref);
}

// ===========================================================================
// Run controls
// ===========================================================================

// Moved from tests/composition/A2-control-platform.test.ts:65 (assertions unchanged; invariant checks added).
it('D-7: controls on a claimed Run apply at once and a cancel ends the Run and its claim in one commit', async () => {
  const fixture = await createTaskClaimFixture('sqlite');
  cleanups.push(() => fixture.close());
  const claimed = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest());
  if (claimed.status !== 'committed') throw Error('real claim failed');
  const runRef = claimed.value.runRef;
  await fixture.closeBackend();
  const inv = { database: fixture.directory, projectId: fixture.ctx.projectId };
  await assertInvariantsAt(inv, 'D-7 claimed');
  const options = hostOptions(fixture.directory);
  let platform = await createTargetPlatform(options);
  cleanups.push(() => platform.close().catch(() => undefined));
  const before = await platform.executions.readExecution(fixture.ctx, runRef);
  if (before.status !== 'ready') throw Error('the claimed Run must be readable');
  expect(before.value.run.status).toBe('starting');
  expect(before.value.run.executionAuthorization).toBeUndefined();

  const steer = await submit(platform, fixture.ctx, runRef, 'a2-platform-steer', 'steer', 'look at the failing check first');
  expect(steer.value.intent).toMatchObject({ status: 'queued', revision: 1 });
  await assertInvariantsAt(inv, 'D-7 steer');   // A.2 step 6: one check per control commit
  const pause = await submit(platform, fixture.ctx, runRef, 'a2-platform-pause', 'pause');
  expect(pause.value.intent).toMatchObject({ status: 'applied', revision: 2,
    observation: { origin: 'platform_not_entered', kind: 'paused', detail: { entryPhase: 'none' } } });
  await assertInvariantsAt(inv, 'D-7 pause');   // A.2 step 6: one check per control commit
  const resume = await submit(platform, fixture.ctx, runRef, 'a2-platform-resume', 'resume');
  expect(resume.value.intent).toMatchObject({ status: 'applied', revision: 2,
    observation: { origin: 'platform_not_entered', kind: 'resumed', detail: { entryPhase: 'none' } } });
  const resumed = await platform.executions.readExecution(fixture.ctx, runRef);
  if (resumed.status !== 'ready') throw Error('the resumed Run must be readable');
  expect(resumed.value.run).toMatchObject({ status: 'starting', revision: before.value.run.revision + 3,
    controlState: { intentRef: resume.value.intent.ref, desiredState: 'running' } });
  await assertInvariantsAt(inv, 'D-7 steer, pause, resume');

  const cancel = await submit(platform, fixture.ctx, runRef, 'a2-platform-cancel', 'cancel', 'operator stops before entry');
  expect(cancel.value).toMatchObject({ runRevision: resumed.value.run.revision + 1, intent: { status: 'applied', revision: 2,
    observation: { origin: 'platform_not_entered', kind: 'cancelled', runRevision: resumed.value.run.revision + 1,
      detail: { entryPhase: 'none' } } } });
  const stopped = await platform.executions.readExecution(fixture.ctx, runRef);
  if (stopped.status !== 'ready') throw Error('the stopped Run must be readable');
  const { run, attempt, outbox, lease, session } = stopped.value;
  expect(run).toMatchObject({ status: 'ended', outcome: 'cancelled', endedAt: CLAIM_FIXTURE_AT, startedAt: null,
    revision: resumed.value.run.revision + 1, controlState: { intentRef: cancel.value.intent.ref, desiredState: 'cancelled' } });
  expect(run.executionAuthorization).toBeUndefined();
  expect(attempt).toMatchObject({ status: 'ended', endOutcome: 'cancelled', startedAt: null, endedAt: CLAIM_FIXTURE_AT });
  expect(outbox).toMatchObject({ status: 'settled', dispatchState: { schemaVersion: 2, phase: 'settled',
    settlement: 'not_entered', consumerId: null, entryGeneration: null, sessionGeneration: claimed.value.generation } });
  expect(lease?.release).toMatchObject({ runRef, attemptRef: claimed.value.attemptRef, generation: claimed.value.generation });
  expect(session).toMatchObject({ occupancy: null, lastExecutionRef: runRef, historyCursor: before.value.session.historyCursor });
  expect(await intentOf(platform, fixture.ctx, steer.value.intent.ref)).toMatchObject({ status: 'superseded', revision: 2,
    observation: { origin: 'platform_superseded', kind: 'superseded_by_newer', detail: { supersededBy: cancel.value.intent.ref } } });
  await assertInvariantsAt(inv, 'D-7 cancel');
  // A control on the ended Run is refused.
  expect(await platform.controls.submitControl(fixture.ctx, { input: { runRef, kind: 'pause', reason: null },
    meta: { requestId: 'a2-platform-late-pause', expected: [{ ref: runRef, revision: run.revision }] } }))
    .toMatchObject({ status: 'rejected', code: 'busy' });

  // Reopen: every receipt replays from its recorded event, the records read back unchanged.
  await platform.close();
  platform = await createTargetPlatform(options);
  for (const submitted of [steer, pause, resume, cancel]) {
    expect(await platform.controls.submitControl(fixture.ctx, submitted.request))
      .toMatchObject({ status: 'committed', replayed: true, value: submitted.value });
  }
  expect(await platform.executions.readExecution(fixture.ctx, runRef)).toMatchObject({ status: 'ready', value: { run, attempt, outbox } });
  await assertInvariantsAt(inv, 'D-7 replays after the reopen');
});

// Moved from tests/composition/A2-control-platform.test.ts:125 (assertions unchanged; invariant checks added).
it('D-8 and CD-4 with the Runtime: a cancel supersedes the queued pause; the natural terminal settles the queued cancel and steer', async () => {
  let platform: Platform | undefined;
  const submitted: Partial<Record<'steer' | 'pause' | 'cancel', SubmittedControl>> = {};
  let pauseSuperseded: unknown;
  const fixture: B2RuntimeFixture = await createB2RuntimeFixture({ kind: 'sqlite',
    scriptedReplies: [{ kind: 'text', text: 'the work is done' }],
    beforeReply: async (_request, index) => {
      if (index !== 0 || platform === undefined) return;
      // The Kernel Turn is running; each control below is queued (RUN-12/13/15).
      for (const [kind, reason] of [['steer', 'prefer the smaller change'], ['pause', null], ['cancel', 'stop now']] as const) {
        submitted[kind] = (await submit(platform, fixture.ctx, fixture.claim.runRef, `a2-live-${kind}`, kind, reason)).value;
        await assertInvariantsAt(inv, `D-8 ${kind} queued`);   // A.2 step 6: one check per control commit
      }
      pauseSuperseded = await intentOf(platform, fixture.ctx, submitted.pause!.intent.ref);
    } });
  cleanups.push(() => fixture.close());
  await fixture.claimFixture.closeBackend();
  const inv = { database: fixture.directory, projectId: fixture.ctx.projectId };
  platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory: fixture.directory }, workspace: fixture.deps.workspaceHost, now: () => B2_AT,
    kernelStores: { entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
      workspace: fixture.scope, databasePath: join(fixture.directory, 'kernel.sqlite') }] },
    runtime: fixture.host,
  });
  cleanups.push(() => platform!.close());
  await assertInvariantsAt(inv, 'D-8 claimed');
  const actor = fixture.ctx.principal.kind === 'host' ? fixture.ctx.principal.actor : null;
  if (actor === null) throw Error('the fixture calls as the Host');

  const prepared = await platform.runtime.prepareExecution(fixture.ctx, { runRef: fixture.claim.runRef, requestId: 'a2-live-prepare' });
  if (prepared.status !== 'ready') throw Error(`prepare failed: ${JSON.stringify(prepared)}`);
  await assertInvariantsAt(inv, 'D-8 prepared');
  const started = await platform.runtime.startRun(fixture.ctx, { prepared: prepared.value, consumerId: 'a2-live', requestId: 'a2-live-start' });
  expect(started.status).toBe('ready');
  // The start authorized the entry; the three controls and the natural terminal committed inside it.
  await assertInvariantsAt(inv, 'D-8 started', ownerStep('entry_authorized', actor, DEFAULT_TASK_AUTOMATION_POLICY, 'D-8 started'));
  expect(fixture.scripted.calls()).toBe(1);
  const { steer, pause, cancel } = submitted;
  if (steer === undefined || pause === undefined || cancel === undefined) throw Error('the three controls must have committed');
  for (const queued of [steer, pause, cancel]) expect(queued.intent).toMatchObject({ status: 'queued', revision: 1 });

  // D-8: the cancel moved the pointer off the queued pause and superseded it in the same commit.
  expect(pauseSuperseded).toMatchObject({ status: 'superseded', revision: 2, observation: { origin: 'platform_superseded',
    kind: 'superseded_by_newer', detail: { supersededBy: cancel.intent.ref }, runRevision: cancel.runRevision } });
  expect(await intentOf(platform, fixture.ctx, pause.intent.ref)).toEqual(pauseSuperseded);

  // The Turn completed before any safe point consumed the cancel: the Run ends completed and releases.
  const ended = await platform.executions.readExecution(fixture.ctx, fixture.claim.runRef);
  if (ended.status !== 'ready') throw Error('the ended Run must be readable');
  expect(ended.value.run).toMatchObject({ status: 'ended', outcome: 'completed',
    controlState: { intentRef: cancel.intent.ref, desiredState: 'cancelled' } });
  expect(ended.value.session.occupancy).toBeNull();
  // CTL-06 / CD-4: the pointer cancel and the never-accepted steer are superseded by the Turn's own terminal.
  const locator = ended.value.run.executionHistory;
  if (locator === undefined || locator.endPosition === null) throw Error('the ended Run must carry its terminal window');
  for (const settled of [cancel, steer]) {
    const intent = await intentOf(platform, fixture.ctx, settled.intent.ref);
    expect(intent).toMatchObject({ status: 'superseded', revision: 2,
      observation: { kind: 'terminal_without_cancel', history: { endPosition: locator.endPosition } } });
    if (intent.status === 'queued' || 'origin' in intent.observation) throw Error('a Kernel observation is required');
    expect(intent.observation.source.position).toBeGreaterThanOrEqual(locator.startPosition);
    expect(intent.observation.source.position).toBeLessThanOrEqual(locator.endPosition);
  }
});

it('A7 entered Run: a pause lands at the next safe point, a steer waits while the Run is paused, the resume re-enters the original Turn where the Kernel accepts the steer; the applied pause is never rewritten and a control on the ended Run is busy', async () => {
  const STEER_TEXT = 'A7 steer: keep the change to the result file only';
  let h: HostScenario | undefined;
  let pause: SubmittedControl | undefined;
  const scenario = await openHostScenario({ automation: NO_REDRIVE, script: {
    replies: [readCall('a7-entered'), ...editThenText('a7-entered')],
    duringReply: async (index) => {
      // The Run entered and its Turn calls the model for the first time: the operator pauses it.
      if (index !== 0 || h === undefined) return;
      pause = await submitControl(h.host, await selectedRun(h), 'pause', 'operator pause', 'a7-entered-pause');
    } } });
  h = scenario;
  const first = await scenario.advance(scenario.select('a7-entered', AG2B_WORK_TASK_ID));
  expect(first.state).toBe('waiting');
  const runRef = await selectedRun(scenario);
  if (pause === undefined) throw new Error('the pause must have been submitted during the first model call');
  // RUN-12: queued at submission; the live handle applied it at the safe point after the first tool group (CTL-03).
  expect(pause.intent).toMatchObject({ status: 'queued', revision: 1, requestedBy: SCENARIO_OPERATOR });
  const pausedIntent = await readControl(scenario.host, pause.intent.ref);
  expect(pausedIntent).toMatchObject({ kind: 'pause', status: 'applied', revision: 2, observation: { kind: 'paused' } });
  if (pausedIntent.status !== 'applied') throw new Error('the pause must be applied');
  expect('origin' in pausedIntent.observation, 'a Kernel observation, not a platform one').toBe(false);
  expect((await readExecution(scenario.host, runRef)).run).toMatchObject({ status: 'running',
    controlState: { intentRef: pause.intent.ref, desiredState: 'paused' } });
  expect(scenario.counts(), 'the pause landed before the second model request').toMatchObject({ modelCalls: 1, kernelTurnsStarted: 1 });
  await assertInvariants(scenario, 'entered: paused at the safe point');

  // RUN-15: a steer while paused is queued as a control input; the pointer stays the pause.
  const steer = await submitControl(scenario.host, runRef, 'steer', STEER_TEXT, 'a7-entered-steer');
  expect(steer.intent).toMatchObject({ kind: 'steer', status: 'queued', revision: 1, reason: STEER_TEXT });
  const steered = (await readExecution(scenario.host, runRef)).run;
  expect(steered.controlState).toEqual({ intentRef: pause.intent.ref, desiredState: 'paused' });
  expect(steered.controlInputs).toEqual([steer.intent.ref]);
  await assertInvariants(scenario, 'entered: steer queued while paused');
  // RUN-14: the resume is queued on the Running Run; the pointer moves to it, the applied pause is not rewritten.
  const resume = await submitControl(scenario.host, runRef, 'resume', 'operator resume', 'a7-entered-resume');
  expect(resume.intent).toMatchObject({ kind: 'resume', status: 'queued', revision: 1 });
  expect((await readExecution(scenario.host, runRef)).run.controlState).toEqual({ intentRef: resume.intent.ref, desiredState: 'running' });
  expect(await readControl(scenario.host, pause.intent.ref)).toEqual(pausedIntent);
  await assertInvariants(scenario, 'entered: resume queued');

  // The operator's resume as the workbench sends it: deliver (the Turn exited, so it stays queued), then re-enter the Turn.
  expect(await post(scenario.host, 'controls/deliver', plain(AG2B_SCOPE, { intentRef: resume.intent.ref })))
    .toMatchObject({ status: 'ready', value: { status: 'queued' } });
  expect(await reenter(scenario.host, runRef, 'a7-entered-reenter')).toMatchObject({ status: 'ready' });
  const ended = await readExecution(scenario.host, runRef);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'completed',
    controlState: { intentRef: resume.intent.ref, desiredState: 'running' } });
  // The Kernel observed the resume and accepted the steer in the same Turn (no second Turn started).
  const resumedIntent = await readControl(scenario.host, resume.intent.ref);
  expect(resumedIntent).toMatchObject({ status: 'applied', revision: 2, observation: { kind: 'resumed' } });
  const steerIntent = await readControl(scenario.host, steer.intent.ref);
  expect(steerIntent).toMatchObject({ status: 'applied', revision: 2, observation: { kind: 'steered' } });
  for (const intent of [resumedIntent, steerIntent]) {
    if (intent.status !== 'applied' || 'origin' in intent.observation) throw new Error('a Kernel observation is required');
  }
  // 迟到 ack (§7.3): the later Kernel events of the Turn (resumed, steered, its terminal) left the applied pause as it was.
  expect(await readControl(scenario.host, pause.intent.ref)).toEqual(pausedIntent);
  expect(scenario.counts()).toMatchObject({ modelCalls: 3, kernelTurnsStarted: 1 });
  const requests = scenario.modelRequests();
  expect(JSON.stringify(requests[0]?.messages)).not.toContain(STEER_TEXT);
  expect(JSON.stringify(requests[1]?.messages), 'the steer reached the model request after the resume').toContain(STEER_TEXT);
  await assertInvariants(scenario, 'entered: the re-entered Turn completed');

  // The same claim goes on: the round passes and the Task is satisfied, with no further model call.
  const done = await scenario.advance(scenario.select('a7-entered-2', AG2B_WORK_TASK_ID));
  expect(done.state).toBe('completed');
  expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'satisfied' });
  expect(scenario.modelCalls()).toBe(3);
  // §7.4: a control on the ended Run is refused and writes nothing.
  const before = scenario.counts();
  for (const kind of ['pause', 'cancel', 'steer'] as const) {
    expect(await submitRunControl(scenario.host, runRef, kind, 'too late', `a7-entered-late-${kind}`), kind)
      .toMatchObject({ status: 'rejected', code: 'busy' });
  }
  expect(scenario.counts()).toEqual(before);
}, 120_000);

it('A7 entered Run cancel: a cancel submitted during the Turn is applied by the Kernel at the next safe point and the never-accepted steer is settled with the terminal; a Goal pause meanwhile skips the Run whose pointer is the cancel (GOAL-12)', async () => {
  const STEER_TEXT = 'A7 steer before the cancel';
  let h: HostScenario | undefined;
  let during: { steer: SubmittedControl; cancel: SubmittedControl; goalPaused: GoalControlOutcomeV1 } | undefined;
  const scenario = await openHostScenario({ automation: NO_REDRIVE, script: {
    replies: [readCall('a7-cancel'), { kind: 'text', text: 'A7 cancel: never reached' }],
    duringReply: async (index) => {
      if (index !== 0 || h === undefined) return;
      const runRef = await selectedRun(h);
      // RUN-15, RUN-13: both queued on the entered Run; then the Goal is paused (its fan-out row sees the cancel).
      const steer = await submitControl(h.host, runRef, 'steer', STEER_TEXT, 'a7-cancel-steer');
      const cancel = await submitControl(h.host, runRef, 'cancel', 'the operator cancels the Run', 'a7-cancel-cancel');
      during = { steer, cancel, goalPaused: await goalControlled(h.host, 'pause', 'a7-cancel-goal-pause') };
    } } });
  h = scenario;
  const first = await scenario.advance(scenario.select('a7-cancel', AG2B_WORK_TASK_ID));
  expect(first.state).toBe('waiting');
  const runRef = await selectedRun(scenario);
  if (during === undefined) throw new Error('the controls must have committed during the first model call');
  const { steer, cancel, goalPaused } = during;
  expect(steer.intent).toMatchObject({ status: 'queued', revision: 1 });
  expect(cancel.intent).toMatchObject({ status: 'queued', revision: 1 });
  // GOAL-12: the Goal pause submits nothing for a Run whose pointer is already a cancel.
  expect(goalPaused.fanOut.runs).toEqual([{ runRef, outcome: 'skipped', intentRef: null, reason: 'the Run already carries a cancelled intent' }]);
  expect(await readIntentAnswer(scenario.host, fanOutIntentRef(goalPaused.goal.desiredStateRevision ?? 1, runRef, 'pause')))
    .toMatchObject({ status: 'not_found' });

  // The safe point after the first tool group consumed the cancel: the Kernel cancelled the Turn (CTL-03).
  const ended = await readExecution(scenario.host, runRef);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled', controlState: { intentRef: cancel.intent.ref, desiredState: 'cancelled' } });
  expect(ended.session.occupancy).toBeNull();
  const cancelled = await readControl(scenario.host, cancel.intent.ref);
  expect(cancelled).toMatchObject({ status: 'applied', revision: 2, observation: { kind: 'cancelled' } });
  if (cancelled.status !== 'applied' || 'origin' in cancelled.observation) throw new Error('a Kernel observation is required');
  // CD-4: the steer the Kernel never accepted is settled with the terminal (CTL-06).
  expect(await readControl(scenario.host, steer.intent.ref)).toMatchObject({ status: 'superseded', revision: 2,
    observation: { kind: 'terminal_without_cancel' } });
  expect(scenario.counts()).toMatchObject({ modelCalls: 1, kernelTurnsStarted: 1 });
  expect(JSON.stringify(scenario.modelRequests())).not.toContain(STEER_TEXT);
  // The paused Goal shows the Run's actual end (runStops order 1).
  expect(await display(scenario.host)).toMatchObject({ display: { phase: 'PAUSED',
    runStops: [{ runRef, stop: { kind: 'ended', outcome: 'cancelled' } }] } });
  await assertInvariants(scenario, 'entered cancel applied by the Kernel');
}, 120_000);

// Moved from tests/app/A2-host-reconcile.test.ts:196 at 05125db (assertions unchanged; invariant checks added).
it('RUN-23 and CTL-10 in process: a cancel of a Run paused at a safe point is applied on the live handle\'s exit proof; the Run ends cancelled and its Session is retired', async () => {
  const root = await tempDir('a2-paused-stop-ws-');
  const database = await tempDir('a2-paused-stop-db-');
  const publicDir = await publicDirectory();
  const inv = { database };
  let host: AG2bHost | undefined;
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  host = await startAG2bHost(publicDir, { root, database, replies: READ_THEN_TEXT,
    beforeReply: async (_request, index) => {
      if (index !== 0 || host === undefined) return;
      const runRef = (await workRow(host)).execution;
      if (runRef === null) throw new Error('the work Task must have a Run');
      pauseRef = (await submitControl(host, runRef, 'pause', 'pause at the safe point', 'a2-paused-stop-pause')).intent.ref;
    } });
  try {
    await seedAG2bWorkGraph(host);
    expect((await driveChecked(host, inv, selectWork('a2-paused-stop'))).steps.at(-1)).toMatchObject({ state: 'waiting', next: null });
    const runRef = (await workRow(host)).execution;
    if (runRef === null || pauseRef === undefined) throw new Error('the paused Run must exist');
    const paused = await readExecution(host, runRef);
    expect(paused.run).toMatchObject({ status: 'running', controlState: { desiredState: 'paused' } });
    expect(await readControl(host, pauseRef)).toMatchObject({ status: 'applied', observation: { kind: 'paused' } });
    await assertInvariantsAt(inv, 'RUN-23 paused');
    // Added in step 6 (§6.6 RUN-23 "queued steer superseded", CTL-04(b)): a steer while paused waits as a control input.
    const steer = await submitControl(host, runRef, 'steer', 'steer while paused', 'a2-paused-stop-steer');
    expect(steer.intent).toMatchObject({ status: 'queued', revision: 1 });
    await assertInvariantsAt(inv, 'RUN-23 steer queued while paused');

    // The cancel cannot reach the exited Kernel call; the platform stops the Run on the exit proof (live_clean).
    const cancel = await submitControl(host, runRef, 'cancel', 'stop the paused Run', 'a2-paused-stop-cancel');
    expect(cancel.intent).toMatchObject({ status: 'queued' });
    await assertInvariantsAt(inv, 'RUN-23 cancel queued');
    const delivered = await post<{ status: string; value: ControlIntentSnapshotV1 }>(host, 'controls/deliver',
      plain(AG2B_SCOPE, { intentRef: cancel.intent.ref }));
    expect(delivered).toMatchObject({ status: 'ready', value: { status: 'applied', observation: { origin: 'platform_paused_stop',
      kind: 'cancelled', detail: { basis: 'live_clean', pausedBy: pauseRef } } } });
    const ended: TaskExecutionRecord = await readExecution(host, runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled',
      terminalPayload: { kind: 'cancelled', reason: 'cancelled_while_paused' },
      reconciliation: { status: 'done', basis: { kind: 'live_clean' }, observation: { kind: 'interrupted_clean', kernelPaused: true } } });
    // SES-06 (LA-1): the Kernel Turn stays paused, so the Session is released and retired; the pause stays applied.
    expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open',
      historyCursor: paused.session.historyCursor });
    expect(await readControl(host, pauseRef)).toMatchObject({ status: 'applied', observation: { kind: 'paused' } });
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'failed' });
    expect(host.scripted.calls()).toBe(1);
    // Added in step 6 (ATT-35): the Attempt, the Outbox and the Lease end in the same commit as the Run.
    expect(ended.attempt).toMatchObject({ status: 'ended', endOutcome: 'cancelled' });
    expect(ended.outbox).toMatchObject({ status: 'settled' });
    expect(ended.lease?.release).toMatchObject({ runRef });
    // CTL-04(b): the cancel that ended the Run supersedes the queued steer in the same commit.
    expect(await readControl(host, steer.intent.ref)).toMatchObject({ status: 'superseded', revision: 2,
      observation: { origin: 'platform_superseded', kind: 'superseded_by_newer', runRevision: ended.run.revision,
        detail: { supersededBy: cancel.intent.ref } } });
    await assertInvariantsAt(inv, 'RUN-23 cancelled while paused');
  } finally {
    await host.host.close();
  }
}, 180_000);

it('A7 unsupported controls answer explicitly: a Query has no control, an unknown kind is invalid, and a Runtime without control delivery says unsupported; none writes a record', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE });
  const claimed = await h.advance(h.select('a7-unsupported', AG2B_WORK_TASK_ID), { stopBefore: performs('prepare') });
  expect(claimed.state).toBe('stopped');
  const runRef = await selectedRun(h);
  const run = (await readExecution(h.host, runRef)).run;
  const before = h.counts();
  // §7.3 case 1 (D-11): a control names a Run, never a QueryRun; Query stops are not part of this batch.
  const queryRunRef = { aggregateType: 'QueryRun', ...AG2B_SCOPE, queryJobId: 'a7-query-job', runId: 'a7-query-run' };
  expect(await answer(h.host, 'controls/submit', graphWrite(AG2B_SCOPE, { runRef: queryRunRef, kind: 'cancel', reason: null },
    'a7-unsupported-query', [{ ref: runRef, revision: run.revision }])))
    .toEqual({ status: 'rejected', code: 'invalid', reason: 'the control submission requires a complete RunRef' });
  // R1–R4 are the only kinds.
  expect(await answer(h.host, 'controls/submit', graphWrite(AG2B_SCOPE, { runRef, kind: 'stop', reason: null },
    'a7-unsupported-kind', [{ ref: runRef, revision: run.revision }])))
    .toEqual({ status: 'rejected', code: 'invalid', reason: 'the control kind must be pause, cancel, resume or steer' });
  // §7.3 case 5: a platform whose Runtime has no control wiring answers `unsupported` for a delivery.
  const intentRef = fanOutIntentRef(1, runRef, 'pause');
  expect(await (await h.direct()).runtime.deliverControl!(hostCtx(), { intentRef }))
    .toMatchObject({ status: 'rejected', code: 'unsupported', reason: expect.any(String) });
  expect(h.counts(), 'no refusal wrote a record').toEqual(before);
  await assertInvariants(h, 'unsupported controls refused');
}, 120_000);

it('A7 yielded wait: the yielded terminal keeps the queued steer (no terminal_without_cancel); after a real reply the continuation claim consumes the wait, and the yielded Run takes no control (RD-8, RUN-14)', async () => {
  const STEER_TEXT = 'A7 steer sent while the wait was being sent';
  const REPLY_TEXT = 'A7 reply: the module marker is AG2B_ISOLATED_SOURCE';
  let h: HostScenario | undefined;
  let recipient: SessionRef | undefined;
  let steer: SubmittedControl | undefined;
  const send = { callId: 'a7-wait-send', name: 'send_session_message',
    args: { recipient: {}, text: 'A7 question: which marker does src/module.ts export?', intent: 'inquiry', needsReply: true, waitAfterSend: true } as Record<string, unknown> };
  const scenario = await openHostScenario({ check: 'pass', automation: NO_REDRIVE, script: {
    replies: [{ kind: 'calls', calls: [send] }, { kind: 'text', text: 'A7 continuation: the reply was read' }],
    queryReplies: [{ kind: 'text', text: REPLY_TEXT }],
    duringReply: async (index) => {
      if (index !== 0 || h === undefined) return;
      if (recipient !== undefined) send.args['recipient'] = { projectId: recipient.projectId, sessionId: recipient.sessionId };
      // While the model call that sends the wait runs, the operator steers the entered Run (RUN-15, queued).
      steer = await submitControl(h.host, await selectedRun(h), 'steer', STEER_TEXT, 'a7-wait-steer');
    } } });
  h = scenario;
  recipient = (await createAG2bSession(scenario.host, 'a7-wait-recipient', AG2B_QUERY_ROLE,
    [{ target: { kind: 'task', ref: taskRefOf() }, relation: 'participates' }])).sessionRef;

  const first = await scenario.advance(scenario.select('a7-wait', AG2B_WORK_TASK_ID));
  expect(first.state).toBe('waiting');
  const yieldedRef = await selectedRun(scenario);
  const yielded = await readExecution(scenario.host, yieldedRef);
  expect(yielded.run).toMatchObject({ status: 'ended', outcome: 'yielded', continuation: { kind: 'wait_reply' } });
  if (steer === undefined || yielded.run.continuation === undefined) throw new Error('the steer and the continuation must exist');
  // CTL-06 / CD-4 exclude a yielded terminal: the never-accepted steer stays queued as part of the wait's fence
  // (contrast: a natural terminal supersedes it with terminal_without_cancel, the D-8 case above).
  expect(await readControl(scenario.host, steer.intent.ref)).toMatchObject({ status: 'queued', revision: 1, reason: STEER_TEXT });
  expect(yielded.run.controlInputs).toEqual([steer.intent.ref]);
  expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'ready' });
  expect(scenario.counts()).toMatchObject({ modelCalls: 1 });
  await assertInvariants(scenario, 'yielded with a queued steer');

  // TASK-22, TASK-23 (P18 → P5): a pause on the wait is its durable fence (queued, nothing observes it); a resume
  // supersedes the queued pause in its own commit and the continuation is ready again.
  const fence = await submitControl(scenario.host, yieldedRef, 'pause', null, 'a7-wait-pause');
  expect(fence.intent).toMatchObject({ status: 'queued', revision: 1 });
  expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'continuation_paused' } });
  await assertInvariants(scenario, 'the wait is fenced by a pause');
  const unfence = await submitControl(scenario.host, yieldedRef, 'resume', null, 'a7-wait-resume');
  expect(unfence.intent).toMatchObject({ status: 'queued', revision: 1 });
  expect(await readControl(scenario.host, fence.intent.ref)).toMatchObject({ status: 'superseded', revision: 2,
    observation: { origin: 'platform_superseded', kind: 'superseded_by_newer', detail: { supersededBy: unfence.intent.ref } } });
  // Moved from A2-control-service (RUN-14): the real resume supersedes the queued
  // wait-window pause and the Run's returned pointer is that resume intent.
  expect((await readExecution(scenario.host, yieldedRef)).run.controlState)
    .toEqual({ intentRef: unfence.intent.ref, desiredState: 'running' });
  expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'ready' });
  await assertInvariants(scenario, 'the wait fence is resumed');

  // The recipient answers through the formal consultation (the query model); the wait message is responded.
  const consulted = await post<{ status: string; value: { state: string } }>(scenario.host, 'workflow/consultation', plain(AG2B_SCOPE, {
    schemaVersion: 1, messageRef: yielded.run.continuation.messageRef, goalRef: AG2B_GOAL_REF, roleBinding: AG2B_QUERY_ROLE_BINDING,
    runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID }));
  expect(consulted).toMatchObject({ status: 'ready', value: { state: 'responded' } });
  await assertInvariants(scenario, 'the wait is answered');

  // The Workflow claims the continuation in the same Session; the successor Run consumes the wait (stop before its start).
  const claimed = await scenario.advance(scenario.select('a7-wait-2', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  expect(claimed.state).toBe('stopped');
  expect(claimed.receipts.map(receipt => receipt.kind)).toContain('claim_task');
  const successorRef = await selectedRun(scenario);
  expect(successorRef.runId).not.toBe(yieldedRef.runId);
  const successor = await readExecution(scenario.host, successorRef);
  expect(successor.run.consumedWait).toMatchObject({ runRef: yieldedRef, messageRef: yielded.run.continuation.messageRef });
  expect(successor.session.ref.sessionId, 'the continuation claims the yielded Run\'s Session').toBe(yielded.session.ref.sessionId);

  // RD-8: the yielded Run whose continuation the successor consumed takes no control of any kind, and nothing is written.
  const before = scenario.counts();
  for (const kind of ['pause', 'cancel', 'resume', 'steer'] as const) {
    expect(await submitRunControl(scenario.host, yieldedRef, kind, 'too late', `a7-wait-consumed-${kind}`), kind).toEqual({
      status: 'rejected', code: 'busy',
      reason: 'a successor Run already consumed the yielded wait continuation; no new control intent is accepted' });
  }
  expect(scenario.counts()).toEqual(before);

  // The successor runs to its end and the Task is satisfied.
  if (claimed.next === null) throw new Error('the successor start must be next');
  const done = await scenario.advance(claimed.next);
  expect(done.state).toBe('completed');
  expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'satisfied' });
  expect(scenario.counts(), 'two work calls and one consultation call').toMatchObject({ modelCalls: 3 });
}, 120_000);

// ===========================================================================
// Goal fan-out (G7)
// ===========================================================================

// A7-G1. Moved from tests/app/A2-goal-control-route.test.ts:136 (assertions unchanged; invariant checks added).
it('goals/control pause, then resume: the claimed Run is paused and resumed by the fan-out; a paused Goal starts nothing; the Goal completes', async () => {
  const host = await startHost();
  const inv = { database: host.database };
  try {
    const { runRef, next } = await claimedRun(host, 'a2-goal-pause', inv);
    const before = await readGoal(host);
    expect(before).toMatchObject({ desiredState: 'active', activePlanRevision: { planId: 'ag2b-plan' } });

    // GOAL-04 + GOAL-09: the Goal commit, then the not-entered Run is paused by the platform (D-7).
    const pauseBody = await control(host, 'pause', 'a2-goal-pause-1', before.revision);
    const paused = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control', pauseBody);
    if (paused.status !== 'committed') throw new Error(`pause: ${JSON.stringify(paused)}`);
    expect(paused.replayed).toBe(false);
    expect(paused.value.goal).toMatchObject({ desiredState: 'paused', revision: before.revision + 1,
      desiredStateRevision: before.revision + 1, desiredStateRequestedBy: host.actor });
    expect(paused.value.fanOut).toMatchObject({ epoch: before.revision + 1, control: 'pause', problem: null,
      runs: [{ runRef, outcome: 'submitted', reason: null }] });
    const pauseIntentRef = paused.value.fanOut.runs[0]!.intentRef;
    const pauseIntent = await readControl(host, pauseIntentRef!);
    expect(pauseIntent).toMatchObject({ kind: 'pause', status: 'applied', requestedBy: GOAL_FAN_OUT_ACTOR,
      reason: `goal:${AG2B_GOAL_REF.goalId}:pause@${String(before.revision + 1)}`,
      observation: { origin: 'platform_not_entered', kind: 'paused' } });
    expect((await readExecution(host, runRef)).run).toMatchObject({ status: 'starting', controlState: { desiredState: 'paused' } });
    await assertInvariantsAt(inv, 'A7-G1 Goal paused');

    // GOAL-20: PAUSED with each Run's actual state (runStops order 5), never "all stopped".
    const pausedView = await display(host);
    expect(pausedView.display).toMatchObject({ phase: 'PAUSED', row: 'GOAL-20',
      runStops: [{ runRef, stop: { kind: 'paused' } }] });
    expect(pausedView.liveRuns).toEqual([runRef]);

    // The same request again replays the Goal commit and adds no intent (§2.3 re-drive).
    const again = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control', pauseBody);
    expect(again).toMatchObject({ status: 'committed', replayed: true, value: { goal: paused.value.goal,
      fanOut: { runs: [{ runRef, outcome: 'already_submitted', intentRef: pauseIntentRef }] } } });
    // A new pause is busy; nothing is selected or entered while the Goal is paused (D-9).
    expect(await refused(host, 'goals/control', await control(host, 'pause', 'a2-goal-pause-2')))
      .toMatchObject({ code: 'busy', reason: 'the Goal is already paused' });
    const waitingSelect = await advance(host, selectWork('a2-goal-pause-2'));
    expect(waitingSelect).toMatchObject({ state: 'waiting', next: null,
      reason: 'the Goal is paused; no work is selected while the Goal is not active' });
    const blockedStart = await driveChecked(host, inv, next);
    expect(blockedStart.last.state).toBe('waiting');
    expect(host.scripted.calls(), 'no model call while the Goal is paused').toBe(0);
    await assertInvariantsAt(inv, 'A7-G1 nothing starts while paused');

    // GOAL-05 + GOAL-14: the operator resumes; the fan-out resumes the Run it paused.
    const resumed = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control',
      await control(host, 'resume', 'a2-goal-resume-1'));
    if (resumed.status !== 'committed') throw new Error(`resume: ${JSON.stringify(resumed)}`);
    expect(resumed.value.goal).toMatchObject({ desiredState: 'active', desiredStateRevision: before.revision + 2 });
    expect(resumed.value.fanOut).toMatchObject({ control: 'resume', runs: [{ runRef, outcome: 'submitted' }] });
    expect(await readControl(host, resumed.value.fanOut.runs[0]!.intentRef!)).toMatchObject({ kind: 'resume', status: 'applied',
      requestedBy: GOAL_FAN_OUT_ACTOR, observation: { origin: 'platform_not_entered', kind: 'resumed' } });
    expect((await display(host)).display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', runStops: null });
    await assertInvariantsAt(inv, 'A7-G1 Goal resumed');

    // The Workflow continues the same claim; the round passes and the Goal completes (GOAL-18).
    const done = await driveChecked(host, inv, selectWork('a2-goal-resume', true));
    expect(done.last).toMatchObject({ state: 'completed' });
    expect(await readFile(join(host.root, AG2B_RESULT_FILE), 'utf8')).toBe(AG2B_RESULT_TEXT);
    expect(host.scripted.calls()).toBe(2);
    expect((await display(host)).display).toMatchObject({ phase: 'COMPLETED', row: 'GOAL-18' });
    await assertInvariantsAt(inv, 'A7-G1 Goal completed');
    // §2.4: a Goal completed for its active Plan has no work to stop.
    expect(await refused(host, 'goals/control', await control(host, 'pause', 'a2-goal-pause-3')))
      .toMatchObject({ code: 'invalid', reason: 'the Goal is completed for its active Plan; it has no work to stop' });
  } finally {
    await host.host.close();
  }
}, 120_000);

// A7-G1. Moved from tests/app/A2-goal-control-route.test.ts:203 (assertions unchanged; invariant checks added).
it('goals/control cancel: the claimed Run ends at once, the Goal is terminal and adopts no Plan', async () => {
  const host = await startHost();
  const inv = { database: host.database };
  try {
    const { runRef } = await claimedRun(host, 'a2-goal-cancel', inv);
    const cancelled = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control',
      await control(host, 'cancel', 'a2-goal-cancel-1'));
    if (cancelled.status !== 'committed') throw new Error(`cancel: ${JSON.stringify(cancelled)}`);
    expect(cancelled.value.goal.desiredState).toBe('cancelled');
    // GOAL-10: the not-entered Run is cancelled by the platform; its Session is released.
    expect(cancelled.value.fanOut.runs).toMatchObject([{ runRef, outcome: 'submitted' }]);
    const ended = await readExecution(host, runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
    expect(ended.session.occupancy).toBeNull();
    await assertInvariantsAt(inv, 'A7-G1 Goal cancelled');
    // GOAL-17: CANCELLED with the Run's actual end (runStops order 1).
    expect((await display(host)).display).toMatchObject({ phase: 'CANCELLED', row: 'GOAL-17',
      runStops: [{ runRef, stop: { kind: 'ended', outcome: 'cancelled' } }] });
    // §2.4: cancelled is terminal.
    expect(await refused(host, 'goals/control', await control(host, 'cancel', 'a2-goal-cancel-2')))
      .toMatchObject({ code: 'busy', reason: 'the Goal is already cancelled' });
    expect(await refused(host, 'goals/control', await control(host, 'resume', 'a2-goal-cancel-3')))
      .toMatchObject({ code: 'invalid' });
    expect(await refused(host, 'goals/control', await control(host, 'pause', 'a2-goal-cancel-4')))
      .toMatchObject({ code: 'invalid' });
    const goal = await readGoal(host);
    const draft = { schemaVersion: 2, planId: 'ag2b-plan-2', planRevision: 2, goalId: AG2B_GOAL_REF.goalId, stages: [],
      tasks: [], assignments: [], obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
      taskRelations: [], inputRequirements: [] };
    expect(await refused(host, 'plans/propose', graphWrite(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF,
      basedOn: goal.activePlanRevision, draft, reason: { text: 'after the cancel', sources: [] } }, 'a2-goal-cancel-plan')))
      .toMatchObject({ code: 'invalid', reason: 'the Goal is cancelled; its plan can no longer change' });
    expect(await advance(host, selectWork('a2-goal-cancel-2'))).toMatchObject({ state: 'waiting',
      reason: 'the Goal is cancelled; no work is selected while the Goal is not active' });
    expect(host.scripted.calls()).toBe(0);
    await assertInvariantsAt(inv, 'A7-G1 refusals after the cancel');
  } finally {
    await host.host.close();
  }
}, 120_000);

// A7-G1 (VD-9). Moved from tests/app/A2-goal-control-route.test.ts:241 (assertions unchanged; invariant checks added).
it('VD-9: a paused Goal opens no round and begins no check; after the resume the same chain completes', async () => {
  const host = await startHost();
  const inv = { database: host.database };
  try {
    // The Run ends normally; stop before its round opens (`open_checks`).
    const beforeOpen = await driveChecked(host, inv, selectWork('a2-goal-vd9'), { stopBefore: 'open_checks' });
    if (beforeOpen.next === null) throw new Error(`the Workflow did not reach the round: ${JSON.stringify(beforeOpen.last)}`);
    expect(host.scripted.calls()).toBe(2);
    const paused = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control',
      await control(host, 'pause', 'a2-goal-vd9-pause-1'));
    // The ended Run is not in the fan-out set (GOAL-15).
    expect(paused).toMatchObject({ status: 'committed', value: { fanOut: { control: 'pause', runs: [] } } });
    await assertInvariantsAt(inv, 'VD-9 paused before the round');
    const openRefused = await advance(host, beforeOpen.next);
    expect(openRefused).toMatchObject({ state: 'waiting', next: null });
    expect(openRefused.reason).toContain('no new check process starts until the Goal is resumed');
    await assertInvariantsAt(inv, 'VD-9 no round while paused');
    await post(host, 'goals/control', await control(host, 'resume', 'a2-goal-vd9-resume-1'));
    await assertInvariantsAt(inv, 'VD-9 resumed before the round');

    // The round opens; pause again before the check begins.
    const beforeCheck = await driveChecked(host, inv, selectWork('a2-goal-vd9-2'), { stopBefore: 'run_check' });
    if (beforeCheck.next === null) throw new Error(`the Workflow did not reach the check: ${JSON.stringify(beforeCheck.last)}`);
    await post(host, 'goals/control', await control(host, 'pause', 'a2-goal-vd9-pause-2'));
    await assertInvariantsAt(inv, 'VD-9 paused before the check');
    const checkRefused = await advance(host, beforeCheck.next);
    expect(checkRefused).toMatchObject({ state: 'waiting', next: null });
    expect(checkRefused.reason).toContain('the Goal is paused; no new check process starts');
    await assertInvariantsAt(inv, 'VD-9 no check while paused');
    await post(host, 'goals/control', await control(host, 'resume', 'a2-goal-vd9-resume-2'));
    await assertInvariantsAt(inv, 'VD-9 resumed before the check');

    const done = await driveChecked(host, inv, selectWork('a2-goal-vd9-3'));
    expect(done.last).toMatchObject({ state: 'completed' });
    expect(host.scripted.calls(), 'the pauses added no model call').toBe(2);
    await assertInvariantsAt(inv, 'VD-9 completed');
  } finally {
    await host.host.close();
  }
}, 120_000);

// A7-G1 (GOAL-11/14). Moved from tests/app/A2-goal-control-route.test.ts:274 (assertions unchanged; invariant checks added).
it('GOAL-11/14 with a live Kernel Turn: the fan-out pause lands at the next safe point; the resume re-enters the original Turn', async () => {
  let host: AG2bHost | undefined;
  let pausedDuringTurn: WriteResult<GoalControlOutcomeV1> | undefined;
  host = await startHost(async (_request, index) => {
    // The Run entered and its Turn calls the model: the operator pauses the Goal now.
    if (index !== 0 || host === undefined) return;
    pausedDuringTurn = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control',
      await control(host, 'pause', 'a2-goal-live-pause'));
  });
  const inv = { database: host.database };
  try {
    const first = await driveChecked(host, inv, selectWork('a2-goal-live'));
    expect(first.last.state).toBe('waiting');
    expect(host.scripted.calls(), 'the pause landed before the second model request').toBe(1);
    if (pausedDuringTurn?.status !== 'committed') throw new Error(`pause: ${JSON.stringify(pausedDuringTurn)}`);
    const [runResult] = pausedDuringTurn.value.fanOut.runs;
    // GOAL-11: queued for the entered Run and delivered to its live handle.
    expect(runResult).toMatchObject({ outcome: 'submitted', reason: null });
    const runRef = runResult!.runRef;
    const pauseIntent = await readControl(host, runResult!.intentRef!);
    expect(pauseIntent).toMatchObject({ kind: 'pause', status: 'applied', requestedBy: GOAL_FAN_OUT_ACTOR,
      observation: { kind: 'paused' } });
    if (pauseIntent.status !== 'applied') throw new Error('the fan-out pause must be applied');
    expect('origin' in pauseIntent.observation, 'a Kernel observation, not a platform one').toBe(false);
    expect((await readExecution(host, runRef)).run).toMatchObject({ status: 'running', controlState: { desiredState: 'paused' } });
    expect((await display(host)).display).toMatchObject({ phase: 'PAUSED', runStops: [{ runRef, stop: { kind: 'paused' } }] });
    await assertInvariantsAt(inv, 'GOAL-11 paused at the safe point');

    // GOAL-14: the resume is queued and the original Turn is re-entered in the background.
    const resumed = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control',
      await control(host, 'resume', 'a2-goal-live-resume'));
    expect(resumed.status === 'committed' && resumed.value.fanOut.runs).toMatchObject([
      { runRef, outcome: 'submitted', reason: 're-entry of the original Turn started' }]);
    let ended: TaskExecutionRecord['run'] | null = null;
    for (let wait = 0; wait < 200 && ended === null; wait += 1) {
      const run = (await readExecution(host, runRef)).run;
      if (run.status === 'ended') ended = run;
      else await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(ended).toMatchObject({ outcome: 'completed' });
    expect(host.scripted.calls()).toBe(2);
    await assertInvariantsAt(inv, 'GOAL-14 the re-entered Turn ended');
    const done = await driveChecked(host, inv, selectWork('a2-goal-live-2', true));
    expect(done.last).toMatchObject({ state: 'completed' });
    expect((await display(host)).display).toMatchObject({ phase: 'COMPLETED' });
    await assertInvariantsAt(inv, 'GOAL-14 completed');
  } finally {
    await host.host.close();
  }
}, 120_000);

// A7-G1 (GOAL-14 retry). Moved from tests/app/A2-goal-control-route.test.ts:321 (assertions unchanged; invariant checks added).
it('GOAL-14 retry: a resume sent while the fan-out pause is still queued follows once the pause lands; the Turn is re-entered and completes', async () => {
  let host: AG2bHost | undefined;
  let paused: WriteResult<GoalControlOutcomeV1> | undefined;
  let resumed: WriteResult<GoalControlOutcomeV1> | undefined;
  let waitingView: GoalDisplayHostReadV1 | undefined;
  host = await startHost(async (_request, index) => {
    // The Run entered and its first model request is in flight: pause, then resume at once.
    if (index !== 0 || host === undefined) return;
    paused = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control', await control(host, 'pause', 'a2-goal-retry-pause'));
    resumed = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control', await control(host, 'resume', 'a2-goal-retry-resume'));
    waitingView = await display(host);
  });
  const inv = { database: host.database };
  try {
    await driveChecked(host, inv, selectWork('a2-goal-retry'));
    if (paused?.status !== 'committed' || resumed?.status !== 'committed') {
      throw new Error(`controls: ${JSON.stringify([paused, resumed])}`);
    }
    const [pauseResult] = paused.value.fanOut.runs;
    expect(pauseResult).toMatchObject({ outcome: 'submitted', reason: null });
    const runRef = pauseResult!.runRef;
    // The pause is queued until the next safe point: the resume row waits for it (GOAL-14), it does not give up.
    expect(resumed.value.fanOut.runs).toEqual([{ runRef, outcome: 'skipped', intentRef: null,
      reason: 'the fan-out pause is queued; the resume follows once it is applied and paused' }]);
    // The active Goal keeps the waiting Run visible (runStops exist only while the Goal is not active).
    expect(waitingView?.display).toMatchObject({ phase: 'RUNNING', runStops: null });
    expect(waitingView?.resumePending).toEqual([{ runRef, intentRef: pauseResult!.intentRef, intentKind: 'pause', status: 'queued' }]);
    expect(waitingView?.reentryFailures).toEqual([]);

    // The pause lands at the safe point after the first reply; the driver then submits the resume and re-enters the Turn.
    let ended: TaskExecutionRecord['run'] | null = null;
    for (let wait = 0; wait < 300 && ended === null; wait += 1) {
      const run = (await readExecution(host, runRef)).run;
      if (run.status === 'ended') ended = run;
      else await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(ended).toMatchObject({ outcome: 'completed' });
    expect(host.scripted.calls(), 'the paused Turn went on with the second reply').toBe(2);
    expect(await readControl(host, pauseResult!.intentRef!)).toMatchObject({ kind: 'pause', status: 'applied',
      observation: { kind: 'paused' } });
    const resumeIntent = await readControl(host, ended!.controlState!.intentRef);
    expect(resumeIntent).toMatchObject({ kind: 'resume', status: 'applied', requestedBy: GOAL_FAN_OUT_ACTOR,
      reason: `goal:${AG2B_GOAL_REF.goalId}:resume@${String(resumed.value.goal.desiredStateRevision)}` });
    const after = await display(host);
    expect(after.resumePending).toEqual([]);
    await assertInvariantsAt(inv, 'GOAL-14 retry: the re-entered Turn ended');
    const done = await driveChecked(host, inv, selectWork('a2-goal-retry-2', true));
    expect(done.last).toMatchObject({ state: 'completed' });
    expect(await readFile(join(host.root, AG2B_RESULT_FILE), 'utf8')).toBe(AG2B_RESULT_TEXT);
    expect(host.scripted.calls()).toBe(2);
    await assertInvariantsAt(inv, 'GOAL-14 retry completed');
  } finally {
    await host.host.close();
  }
}, 120_000);

it('A7-G1 with two Runs (§2.6 GOAL-09…16): one fan-out pass pauses, resumes and cancels a not-entered and an entered Run together; the platform applies the not-entered one at once, the Kernel the entered one at its safe point; each Run\'s result and actual state are shown on their own', async () => {
  const OTHER_TASK_ID = 'ag2b-work-2';
  let h: HostScenario | undefined;
  let duringPause: { paused: GoalControlOutcomeV1; view: GoalDisplayHostReadV1; pauseB: ControlIntentSnapshotV1 } | undefined;
  const scenario = await openHostScenario({ workIds: [AG2B_WORK_TASK_ID, OTHER_TASK_ID], automation: NO_REDRIVE, script: {
    // 0: Run B's first tool group (the pause lands after it); 1: Run B's re-entered Turn, held over the Goal cancel
    // (its reply is never needed); 2: never reached.
    replies: [readCall('a7-two-b'), readCall('a7-two-b2'), { kind: 'text', text: 'A7 two Runs: never reached' }],
    duringReply: async (index) => {
      if (index !== 0 || h === undefined) return;
      // Run B is entered and its Turn calls the model: the person pauses the Goal.
      const paused = await goalControlled(h.host, 'pause', 'a7-two-pause');
      const runB = await selectedRun(h, OTHER_TASK_ID);
      duringPause = { paused, view: await display(h.host),
        pauseB: await readControl(h.host, fanOutIntentRef(paused.goal.desiredStateRevision ?? 1, runB, 'pause')) };
    } } });
  h = scenario;
  const stopsOf = (view: GoalDisplayHostReadV1) => view.display.runStops ?? [];

  // Run A: claimed and stopped before its prepare (not entered). Run B: entered; the Goal pause comes during its first call.
  expect((await scenario.advance(scenario.select('a7-two-a', AG2B_WORK_TASK_ID), { stopBefore: performs('prepare') })).state).toBe('stopped');
  const runA = await selectedRun(scenario);
  expect((await scenario.advance(scenario.select('a7-two-b', OTHER_TASK_ID))).state).toBe('waiting');
  const runB = await selectedRun(scenario, OTHER_TASK_ID);
  if (duringPause === undefined) throw new Error('the Goal pause must have committed during Run B\'s first model call');
  const { paused, view } = duringPause;
  const pauseEpoch = paused.goal.desiredStateRevision ?? 1;
  const pauseRef = (runRef: RunRef) => fanOutIntentRef(pauseEpoch, runRef, 'pause');

  // One pass, one result per Run (GOAL-09 for A, GOAL-11 for B).
  expect(paused.fanOut.runs).toHaveLength(2);
  expect(paused.fanOut.runs).toEqual(expect.arrayContaining([
    { runRef: runA, outcome: 'submitted', intentRef: pauseRef(runA), reason: null },
    { runRef: runB, outcome: 'submitted', intentRef: pauseRef(runB), reason: null }]));
  // Right after the pass: A is paused by the platform (applied at once); B's pause is queued, shown as requested.
  expect(duringPause.pauseB).toMatchObject({ status: 'queued', revision: 1, requestedBy: GOAL_FAN_OUT_ACTOR });
  expect(view.display.phase).toBe('PAUSED');
  expect(stopsOf(view)).toHaveLength(2);
  expect(stopsOf(view)).toEqual(expect.arrayContaining([
    { runRef: runA, stop: { kind: 'paused' } }, { runRef: runB, stop: { kind: 'stop_requested' } }]));
  expect(await readControl(scenario.host, pauseRef(runA))).toMatchObject({ status: 'applied', revision: 2, requestedBy: GOAL_FAN_OUT_ACTOR,
    observation: { origin: 'platform_not_entered', kind: 'paused' } });
  // After B's safe point the Kernel applied B's pause; each Run shows its own paused state.
  const pausedB = await readControl(scenario.host, pauseRef(runB));
  expect(pausedB).toMatchObject({ status: 'applied', revision: 2, observation: { kind: 'paused' } });
  if (pausedB.status !== 'applied' || 'origin' in pausedB.observation) throw new Error('B: a Kernel observation is required');
  expect((await readExecution(scenario.host, runA)).run).toMatchObject({ status: 'starting', controlState: { intentRef: pauseRef(runA), desiredState: 'paused' } });
  expect((await readExecution(scenario.host, runB)).run).toMatchObject({ status: 'running', controlState: { intentRef: pauseRef(runB), desiredState: 'paused' } });
  const pausedView = await display(scenario.host);
  expect(stopsOf(pausedView)).toHaveLength(2);
  expect(stopsOf(pausedView)).toEqual(expect.arrayContaining([
    { runRef: runA, stop: { kind: 'paused' } }, { runRef: runB, stop: { kind: 'paused' } }]));
  expect(scenario.counts()).toMatchObject({ modelCalls: 1, kernelTurnsStarted: 1 });
  await assertInvariants(scenario, 'two Runs paused');

  // Resume: A is resumed by the platform at once; B's original Turn is re-entered (no new Kernel Turn) and held
  // at its next model call.
  const held = scenario.holdReply(1);
  const resumed = await goalControlled(scenario.host, 'resume', 'a7-two-resume');
  const resumeEpoch = resumed.goal.desiredStateRevision ?? 1;
  const resumeRef = (runRef: RunRef) => fanOutIntentRef(resumeEpoch, runRef, 'resume');
  expect(resumed.fanOut.runs).toHaveLength(2);
  expect(resumed.fanOut.runs).toEqual(expect.arrayContaining([
    { runRef: runA, outcome: 'submitted', intentRef: resumeRef(runA), reason: null },
    { runRef: runB, outcome: 'submitted', intentRef: resumeRef(runB), reason: 're-entry of the original Turn started' }]));
  expect(resumed.fanOut.continuations).toEqual([]);
  expect(await readControl(scenario.host, resumeRef(runA))).toMatchObject({ status: 'applied', revision: 2,
    observation: { origin: 'platform_not_entered', kind: 'resumed' } });
  expect((await readExecution(scenario.host, runA)).run).toMatchObject({ status: 'starting', startedAt: null,
    controlState: { intentRef: resumeRef(runA), desiredState: 'running' } });
  await held.reached;
  // B runs again in its original Turn (no second Kernel Turn), its pointer the fan-out resume.
  expect((await readExecution(scenario.host, runB)).run).toMatchObject({ status: 'running',
    controlState: { intentRef: resumeRef(runB), desiredState: 'running' } });
  expect(scenario.counts(), 'B\'s original Turn was re-entered').toMatchObject({ modelCalls: 2, kernelTurnsStarted: 1 });
  expect((await display(scenario.host)).display.runStops).toBeNull();
  await assertInvariants(scenario, 'two Runs resumed');

  // Cancel while B's re-entered Turn is in its model call: A ends at once by the platform (GOAL-10); B's cancel goes to
  // its live Turn (GOAL-11) and the Kernel applies it (here it ends the held model call: NOTES, reading "two-Run cancel").
  // The Kernel's `resumed` ack of B is recorded when the re-entered Turn exits (NOTES, reading "two-Run resume ack"):
  // a resume still queued here is the pointer the cancel moves off, so it is superseded in the cancel's commit (CTL-04(a)).
  const resumeBefore = await readControl(scenario.host, resumeRef(runB));
  const cancelled = await goalControlled(scenario.host, 'cancel', 'a7-two-cancel');
  const cancelEpoch = cancelled.goal.desiredStateRevision ?? 1;
  const cancelRef = (runRef: RunRef) => fanOutIntentRef(cancelEpoch, runRef, 'cancel');
  expect(cancelled.fanOut.runs).toHaveLength(2);
  expect(cancelled.fanOut.runs).toEqual(expect.arrayContaining([
    { runRef: runA, outcome: 'submitted', intentRef: cancelRef(runA), reason: null },
    { runRef: runB, outcome: 'submitted', intentRef: cancelRef(runB), reason: null }]));
  expect(await readControl(scenario.host, cancelRef(runA))).toMatchObject({ status: 'applied', revision: 2,
    observation: { origin: 'platform_not_entered', kind: 'cancelled' } });
  expect((await readExecution(scenario.host, runA)).run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
  const resumeAfterCancel = await readControl(scenario.host, resumeRef(runB));
  if (resumeBefore.status === 'queued') {
    expect(resumeAfterCancel).toMatchObject({ status: 'superseded', revision: 2, observation: { origin: 'platform_superseded',
      kind: 'superseded_by_newer', detail: { supersededBy: cancelRef(runB) } } });
  } else {
    expect(resumeAfterCancel).toEqual(resumeBefore);
  }
  held.release();
  const endedB = await waitFor(() => readExecution(scenario.host, runB), record => record.run.status === 'ended', 'Run B to end');
  await assertInvariants(scenario, 'two Runs: the Goal cancelled, both Runs ended');
  expect(endedB.run).toMatchObject({ outcome: 'cancelled', controlState: { intentRef: cancelRef(runB), desiredState: 'cancelled' } });
  // B's cancel was applied by its Kernel (no platform origin), A's by the platform: each Run's own fate.
  const cancelB = await readControl(scenario.host, cancelRef(runB));
  expect(cancelB).toMatchObject({ status: 'applied', revision: 2, requestedBy: GOAL_FAN_OUT_ACTOR, observation: { kind: 'cancelled' } });
  if (cancelB.status !== 'applied' || 'origin' in cancelB.observation) throw new Error('B: a Kernel observation is required');
  // 迟到 ack: the Turn's later `resumed` event does not rewrite B's resume as the cancel left it.
  expect(await readControl(scenario.host, resumeRef(runB))).toEqual(resumeAfterCancel);
  const cancelledView = await display(scenario.host);
  expect(cancelledView.display.phase).toBe('CANCELLED');
  expect(stopsOf(cancelledView)).toHaveLength(2);
  expect(stopsOf(cancelledView)).toEqual(expect.arrayContaining([
    { runRef: runA, stop: { kind: 'ended', outcome: 'cancelled' } }, { runRef: runB, stop: { kind: 'ended', outcome: 'cancelled' } }]));
  expect(scenario.counts()).toMatchObject({ modelCalls: 2, kernelTurnsStarted: 1 });
}, 120_000);

it('A7-G1 (GOAL-13, D-8): a Goal cancel over a person\'s queued pause of an entered Run supersedes that pause in its own commit; the fan-out cancel ends the Run', async () => {
  let h: HostScenario | undefined;
  let during: { pause: SubmittedControl; cancelled: GoalControlOutcomeV1; pauseAfter: ControlIntentSnapshotV1 } | undefined;
  const scenario = await openHostScenario({ automation: NO_REDRIVE, script: {
    replies: [readCall('a7-g13'), { kind: 'text', text: 'A7 GOAL-13: never reached' }],
    duringReply: async (index) => {
      if (index !== 0 || h === undefined) return;
      const pause = await submitControl(h.host, await selectedRun(h), 'pause', 'the person pauses the Run', 'a7-g13-pause');
      const cancelled = await goalControlled(h.host, 'cancel', 'a7-g13-goal-cancel');
      // Read inside the Turn: the person's pause is superseded by the fan-out cancel's own commit.
      during = { pause, cancelled, pauseAfter: await readControl(h.host, pause.intent.ref) };
    } } });
  h = scenario;
  expect((await scenario.advance(scenario.select('a7-g13', AG2B_WORK_TASK_ID))).state).toBe('waiting');
  const runRef = await selectedRun(scenario);
  if (during === undefined) throw new Error('the controls must have committed during the first model call');
  const { pause, cancelled, pauseAfter } = during;
  expect(pause.intent).toMatchObject({ status: 'queued', revision: 1 });
  expect(cancelled.goal).toMatchObject({ desiredState: 'cancelled' });
  expect(cancelled.fanOut.runs).toMatchObject([{ runRef, outcome: 'submitted' }]);
  const cancelRef = cancelled.fanOut.runs[0]!.intentRef!;
  expect(cancelRef).toEqual(fanOutIntentRef(cancelled.goal.desiredStateRevision ?? 1, runRef, 'cancel'));
  expect(pauseAfter).toMatchObject({ status: 'superseded', revision: 2, observation: { origin: 'platform_superseded',
    kind: 'superseded_by_newer', detail: { supersededBy: cancelRef } } });
  // The fan-out cancel ended the Turn (the Kernel's own cancel); the superseded pause stays as it was.
  expect((await readExecution(scenario.host, runRef)).run).toMatchObject({ status: 'ended', outcome: 'cancelled',
    controlState: { intentRef: cancelRef, desiredState: 'cancelled' } });
  expect(await readControl(scenario.host, cancelRef)).toMatchObject({ status: 'applied', requestedBy: GOAL_FAN_OUT_ACTOR,
    observation: { kind: 'cancelled' } });
  expect(await readControl(scenario.host, pause.intent.ref)).toEqual(pauseAfter);
  expect(await display(scenario.host)).toMatchObject({ display: { phase: 'CANCELLED',
    runStops: [{ runRef, stop: { kind: 'ended', outcome: 'cancelled' } }] } });
  expect(scenario.modelCalls()).toBe(1);
  await assertInvariants(scenario, 'GOAL-13 cancelled over the person\'s pause');
}, 120_000);

it('GOAL-05 (LA-7): a Goal a person paused is resumed only by a person; the automation actors and an Agent are refused and write nothing; an operator of a Host started with a system actor is a person', async () => {
  const SYSTEM_OPERATOR = { kind: 'system' as const, id: 'a7-system-operator' };
  const h = await openHostScenario({ actor: SYSTEM_OPERATOR, automation: NO_REDRIVE });
  const paused = await goalControlled(h.host, 'pause', 'a7-goal05-pause');
  expect(paused.goal).toMatchObject({ desiredState: 'paused', desiredStateRequestedBy: SYSTEM_OPERATOR });
  expect(paused.fanOut).toMatchObject({ control: 'pause', runs: [], problem: null });
  await assertInvariants(h, 'GOAL-05 paused by the operator');

  const platform = await h.direct();
  const resumeAs = async (ctx: ReturnType<typeof hostCtx>, requestId: string) =>
    platform.goals.setGoalControl(ctx, { input: { goalRef: AG2B_GOAL_REF, control: 'resume', reason: 'resume without a person' },
      meta: { requestId, expected: await goalControlPins(h.host) } });
  const before = h.counts();
  // §2.4: the platform automation actors (class system) cannot resume a person's pause (hard limit 3).
  expect(await resumeAs(hostCtx(WORKFLOW_AUTOMATION_ACTOR), 'a7-goal05-automation')).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(await resumeAs(hostCtx(GOAL_FAN_OUT_ACTOR), 'a7-goal05-fan-out')).toMatchObject({ status: 'rejected', code: 'forbidden' });
  // An Agent (a work-run caller) never controls a Goal (§2.4, "首版只接受 Host 可信上下文").
  const agentRun: RunRef = { aggregateType: 'Run', projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, runId: 'a7-goal05-agent-run' };
  expect(await resumeAs(workRunCtx(agentRun), 'a7-goal05-agent')).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(h.counts(), 'the refused resumes wrote nothing').toEqual(before);
  expect(await readGoal(h.host)).toMatchObject({ desiredState: 'paused', desiredStateRequestedBy: SYSTEM_OPERATOR });

  // The operator (a person, whatever the actor kind) resumes the Goal.
  const resumed = await goalControlled(h.host, 'resume', 'a7-goal05-resume');
  expect(resumed.goal).toMatchObject({ desiredState: 'active', desiredStateRequestedBy: SYSTEM_OPERATOR });
  await assertInvariants(h, 'GOAL-05 resumed by the operator');
}, 120_000);

it('A7-G2 (G-01, G-02, GOAL-16, GOAL-14 at a restart): a Goal pause committed on a Host without the lease reaches no Run; the next start submits the fan-out pause once and the platform pauses the not-entered Run; a further start and a replay of the same request skip it; a Goal resume committed without the lease is submitted once by the next start; the same claim completes', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE, script: { replies: editThenText('a7-g2') } });
  const claimed = await h.advance(h.select('a7-g2', AG2B_WORK_TASK_ID), { stopBefore: performs('prepare') });
  expect(claimed.state).toBe('stopped');
  const runRef = await selectedRun(h);

  // L-10: a second live Host commits the Goal pause (owner writes stay), but its fan-out reaches no Run.
  const peer = await h.startPeer();
  const pauseBody = await control(peer, 'pause', 'a7-g2-pause');
  const pausedOnPeer = await post<WriteResult<GoalControlOutcomeV1>>(peer, 'goals/control', pauseBody);
  if (pausedOnPeer.status !== 'committed') throw new Error(`pause: ${JSON.stringify(pausedOnPeer)}`);
  const epoch = pausedOnPeer.value.goal.desiredStateRevision ?? 1;
  expect(pausedOnPeer.value.fanOut).toMatchObject({ control: 'pause', runs: [], problem: expect.stringContaining('another Host holds the instance lease') });
  const intentRef = fanOutIntentRef(epoch, runRef, 'pause');
  expect(await readIntentAnswer(h.host, intentRef)).toMatchObject({ status: 'not_found' });
  expect((await readExecution(h.host, runRef)).run).toMatchObject({ status: 'starting' });
  expect((await readExecution(h.host, runRef)).run.controlState).toBeUndefined();
  await assertInvariants(h, 'G-01: the Goal is paused, no fan-out intent');
  await peer.host.close();

  // G-01 at the next start (§12.1 step 6, GOAL-16): the fan-out pause is submitted and applied by the platform (GOAL-09).
  const report = await h.restart();
  expect(report.report).toMatchObject({ runs: [],
    fanOut: [{ goalId: AG2B_GOAL_REF.goalId, control: 'pause', problem: null, runs: 1, continuations: 0 }], problems: [] });
  const intent = await readControl(h.host, intentRef);
  expect(intent).toMatchObject({ kind: 'pause', status: 'applied', revision: 2, requestedBy: GOAL_FAN_OUT_ACTOR,
    reason: `goal:${AG2B_GOAL_REF.goalId}:pause@${String(epoch)}`, observation: { origin: 'platform_not_entered', kind: 'paused' } });
  expect((await readExecution(h.host, runRef)).run).toMatchObject({ status: 'starting', controlState: { intentRef, desiredState: 'paused' } });
  expect(h.modelCalls(), 'the reconcile called no model').toBe(0);

  // G-02 at a further start: the intent exists, so nothing is submitted again and nothing is written.
  const afterFirst = h.counts();
  const again = await h.restart();
  expect(again.report).toMatchObject({ fanOut: [{ control: 'pause', problem: null, runs: 1 }], problems: [] });
  expect(h.counts()).toEqual(afterFirst);
  expect(await readControl(h.host, intentRef)).toEqual(intent);
  // G-02 told apart from a failed pass: the same request replayed on the lease Host runs the same per-Run
  // fan-out, which finds the deterministic intent and skips it ("跳过，不重交"), writing nothing.
  expect(await post(h.host, 'goals/control', pauseBody)).toMatchObject({ status: 'committed', replayed: true,
    value: { fanOut: { control: 'pause', problem: null, runs: [{ runRef, outcome: 'already_submitted', intentRef }] } } });
  expect(h.counts()).toEqual(afterFirst);
  expect(await h.advance(h.select('a7-g2-paused', AG2B_WORK_TASK_ID))).toMatchObject({ state: 'waiting',
    reason: 'the Goal is paused; no work is selected while the Goal is not active' });

  // GOAL-14 at a restart (§2.6, §2.3 re-drive): the person resumes the Goal on a Host without the lease, so the
  // not-entered Run keeps the earlier epoch's fan-out pause and no resume intent exists.
  const peer2 = await h.startPeer();
  const resumedOnPeer = await controlGoal(peer2, 'resume', 'a7-g2-resume');
  if (resumedOnPeer.status !== 'committed') throw new Error(`resume: ${JSON.stringify(resumedOnPeer)}`);
  const resumeEpoch = resumedOnPeer.value.goal.desiredStateRevision ?? 1;
  expect(resumedOnPeer.value.fanOut).toMatchObject({ control: 'resume', runs: [],
    problem: expect.stringContaining('another Host holds the instance lease') });
  const resumeRef = fanOutIntentRef(resumeEpoch, runRef, 'resume');
  expect(await readIntentAnswer(h.host, resumeRef)).toMatchObject({ status: 'not_found' });
  expect((await readExecution(h.host, runRef)).run.controlState).toEqual({ intentRef, desiredState: 'paused' });
  await assertInvariants(h, 'GOAL-14: the Goal is resumed without the lease');
  await peer2.host.close();

  // The next start's step 6 submits the resume once; the platform resumes the not-entered Run (GOAL-14, RUN-11).
  const resumedAtStart = await h.restart();
  expect(resumedAtStart.report).toMatchObject({ runs: [],
    fanOut: [{ goalId: AG2B_GOAL_REF.goalId, control: 'resume', problem: null, runs: 1, continuations: 0 }], problems: [] });
  const resumeIntent = await readControl(h.host, resumeRef);
  expect(resumeIntent).toMatchObject({ kind: 'resume', status: 'applied', revision: 2, requestedBy: GOAL_FAN_OUT_ACTOR,
    reason: `goal:${AG2B_GOAL_REF.goalId}:resume@${String(resumeEpoch)}`,
    observation: { origin: 'platform_not_entered', kind: 'resumed' } });
  expect((await readExecution(h.host, runRef)).run).toMatchObject({ status: 'starting',
    controlState: { intentRef: resumeRef, desiredState: 'running' } });
  // A further start submits nothing again: one resume intent.
  const afterResume = h.counts();
  const resumedAgain = await h.restart();
  expect(resumedAgain.report).toMatchObject({ fanOut: [{ control: 'resume', problem: null, runs: 1, continuations: 0 }], problems: [] });
  expect(h.counts()).toEqual(afterResume);
  expect(await readControl(h.host, resumeRef)).toEqual(resumeIntent);
  expect(h.lastWorld?.intents.filter(candidate => candidate.kind === 'resume').map(candidate => candidate.ref), 'one resume intent')
    .toEqual([resumeRef]);
  expect(h.modelCalls(), 'no start called a model').toBe(0);

  // The Workflow continues the same claim.
  const done = await h.advance(h.select('a7-g2-done'));
  expect(done.state).toBe('completed');
  expect(await selectedRun(h), 'the same claim ran').toEqual(runRef);
  expect(runsOfTask(h)).toHaveLength(1);
  expect(h.modelCalls()).toBe(2);
  expect(await h.goalDisplay()).toMatchObject({ phase: 'COMPLETED' });
}, 180_000);

// GOAL-28 itself needs a live Run whose fan-out pause is outcome_unknown, which clean data never has (NOTES Q1): the
// reachable G-03 is this restart variant, where the Run itself ended outcome_unknown and GOAL-15 keeps it out of the set.
it('A7-G3 (G-03 as reachable, GOAL-15): a fan-out pause still queued when the Host crashed with its Kernel store lost ends outcome_unknown; resuming the Goal submits no resume and continues nothing', async () => {
  let h: HostScenario | undefined;
  let paused: GoalControlOutcomeV1 | undefined;
  const scenario = await openHostScenario({ automation: NO_REDRIVE, script: {
    replies: [{ kind: 'text', text: 'A7-G3: never answered on the crashed Host' }],
    duringReply: async (index) => {
      // The Run entered; its first model request is in flight: the operator pauses the Goal (fan-out pause queued).
      if (index !== 0 || h === undefined) return;
      paused = await goalControlled(h.host, 'pause', 'a7-g3-pause');
    } } });
  h = scenario;
  const held = scenario.holdReply(0);
  const toStart = await scenario.advance(scenario.select('a7-g3', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  // The start stays in flight on the Host that crashes; the cleanup fails the held call.
  void post(scenario.host, 'workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  if (paused === undefined) throw new Error('the Goal pause must have committed');
  const runRef = await selectedRun(scenario);
  const pauseRef = paused.fanOut.runs[0]!.intentRef!;
  expect(paused.fanOut.runs).toMatchObject([{ runRef, outcome: 'submitted' }]);
  expect(await readControl(scenario.host, pauseRef)).toMatchObject({ status: 'queued' });
  await assertInvariants(scenario, 'G-03: the fan-out pause is queued mid-Turn');

  // The crashed Host's Kernel store is lost (W-14): the Run ends outcome_unknown and its queued pause too (CTL-08(d)).
  await moveKernelAside(scenario.database);
  const report = await scenario.restart({ crash: true });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-14', status: 'reconciled' }], problems: [] });
  expect((await readExecution(scenario.host, runRef)).run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  const unknown = await readControl(scenario.host, pauseRef);
  expect(unknown).toMatchObject({ kind: 'pause', status: 'outcome_unknown', observation: { origin: 'platform_reconcile', kind: 'outcome_unknown' } });
  // runStops order 2: the Run's end is unknown (the Run, not only its intent).
  expect(await display(scenario.host)).toMatchObject({ display: { phase: 'PAUSED', runStops: [{ runRef, stop: { kind: 'unknown_outcome' } }] } });

  // The person resumes the Goal: no resume is submitted for the Run (the ended Run is not in the set, GOAL-15)
  // and nothing is continued (it is not paused-interrupted, GOAL-29).
  const before = scenario.counts();
  const resumed = await goalControlled(scenario.host, 'resume', 'a7-g3-resume');
  expect(resumed.fanOut).toMatchObject({ control: 'resume', runs: [], continuations: [], problem: null });
  const resumeEpoch = resumed.goal.desiredStateRevision ?? 1;
  expect(await readIntentAnswer(scenario.host, fanOutIntentRef(resumeEpoch, runRef, 'resume'))).toMatchObject({ status: 'not_found' });
  expect(await readControl(scenario.host, pauseRef)).toEqual(unknown);
  expect(scenario.counts().ledgerEvents, 'only the Goal commit was written').toBe(before.ledgerEvents + 1);
  await assertInvariants(scenario, 'G-03: the Goal is resumed');
  expect(scenario.lastWorld?.requeues).toEqual([]);
  // The outcome stays to be resolved (硬限制 1): the Task waits, the Workflow writes nothing.
  expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'run_outcome_unknown' } });
  const waiting = scenario.counts();
  expect(await scenario.advance(scenario.select('a7-g3-after', AG2B_WORK_TASK_ID))).toMatchObject({ state: 'waiting' });
  expect(scenario.counts()).toEqual(waiting);
  expect(scenario.abandonedCalls()).toEqual([]);
}, 180_000);

// A7-G4. Moved from tests/app/A2-host-restart.test.ts:162 at 05125db (assertions unchanged; invariant checks added);
// the K slice turned its new Session into the same Session after the closure of the dangling Kernel Turn.
it('G-04 and GOAL-29: a Run the Goal fan-out paused ends paused-interrupted at the restart; resuming the Goal continues it under the fan-out actor in the same Session once the Workflow closes its dangling Kernel Turn', async () => {
  const root = await tempDir('a2-goal29-ws-');
  const database = await tempDir('a2-goal29-db-');
  const publicDir = await publicDirectory();
  const inv = { database };
  const { runRef, pauseIntentRef, oldSession } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv, 'goal');   // A.2 step 6: checked per step
  await assertInvariantsAt(inv, 'A7-G4 paused by the fan-out, Host closed');

  const second = await startAG2bHost(publicDir, { root, database, replies: editThenText('a2-goal29') });
  try {
    // W-20 + step 6 (GOAL-16): the paused Goal's fan-out pass finds the Run already ended; nothing is continued while paused.
    expect(second.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
      runs: [{ ref: JSON.stringify(runRef), row: 'W-20', status: 'reconciled' }],
      fanOut: [{ goalId: AG2B_GOAL_REF.goalId, control: 'pause', problem: null, continuations: 0 }], problems: [] } });
    const reconciled = await readExecution(second, runRef);
    expect(reconciled.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { observation: { kind: 'interrupted_clean', kernelPaused: true, pausedIntentRef: pauseIntentRef } } });
    expect(reconciled.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    expect(await workRow(second)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted' } });
    await assertInvariantsAt(inv, 'A7-G4 restart: paused-interrupted');
    // §2.1 order 0: the paused Goal lists the Run as 已暂停，可继续, continued by the Goal resume.
    expect(await post(second, 'goals/display', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }))).toMatchObject({ status: 'ready',
      value: { display: { phase: 'PAUSED', runStops: [{ runRef, stop: { kind: 'paused_interrupted', pausedBy: 'goal_fan_out' } }] } } });
    // TASK-27 (Goal not active): even a person's 继续 waits for the Goal (busy, "先恢复 Goal").
    const pausedGoal = await readGoal(second);
    expect(await answer(second, 'tasks/requeue', graphWrite(AG2B_SCOPE, { taskRef: TASK, afterRunRef: runRef, reason: 'continue' },
      'a2-goal29-continue-paused', [{ ref: AG2B_GOAL_REF, revision: pausedGoal.revision }, { ref: runRef, revision: reconciled.run.revision }])))
      .toMatchObject({ status: 'rejected', code: 'busy' });

    // GOAL-29: the operator resumes the Goal; the fan-out continues the Task with a goal_resume trigger.
    const resumeBody = graphWrite(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF, control: 'resume', reason: 'operator resumes after the restart' },
      'a2-goal29-resume', await goalControlPins(second));
    const resumed = await post<WriteResult<{ fanOut: { continuations?: unknown[] } }>>(second, 'goals/control', resumeBody);
    if (resumed.status !== 'committed') throw new Error(`resume: ${JSON.stringify(resumed)}`);
    expect(resumed.value.fanOut).toMatchObject({ control: 'resume', problem: null, runs: [],
      continuations: [{ taskId: AG2B_WORK_TASK_ID, afterRunRef: runRef, outcome: 'requeued', reason: null }] });
    const row = await workRow(second);
    expect(row).toMatchObject({ effectivePhase: 'pending', phaseCause: { code: 'requeued' },
      rework: { entries: [{ afterRunRef: runRef, requestedBy: GOAL_FAN_OUT_ACTOR }] } });
    const world = await assertInvariantsAt(inv, 'A7-G4 GOAL-29 continuation',
      ownerStep('task_requeued', GOAL_FAN_OUT_ACTOR, DEFAULT_TASK_AUTOMATION_POLICY, 'A7-G4 GOAL-29 continuation'));
    // The same request again replays the Goal commit; the TaskRequeue already covers the Run (exactly one).
    expect(await post(second, 'goals/control', resumeBody)).toMatchObject({ status: 'committed', replayed: true,
      value: { fanOut: { continuations: [] } } });
    expect(world.requeues).toMatchObject([{ afterRunRef: runRef, requestedBy: GOAL_FAN_OUT_ACTOR, failureClass: 'interrupted',
      interruption: 'paused', trigger: { kind: 'goal_resume' } }]);
    expect((await assertInvariantsAt(inv, 'A7-G4 replayed resume')).requeues, 'exactly one TaskRequeue').toHaveLength(1);

    // K (KA3, L7): the goal_resume TaskRequeue authorizes the closure (L4 item 2), so the Workflow closes the old
    // Session's dangling Kernel Turn (`close_open_turn`; maintenance never closes this paused line) and claims there.
    const done = (await driveChecked(second, inv, selectWork('a2-goal29-continue', true))).steps;
    expect(done.at(-1), JSON.stringify(done.map(step => [step.state, step.reason, step.receipt?.kind]))).toMatchObject({ state: 'completed' });
    const kinds = done.map(step => step.receipt?.kind);
    expect(kinds).toContain('close_open_turn');
    expect(kinds).not.toContain('create_session');
    expect(done.find(step => step.receipt?.kind === 'close_open_turn')?.receipt)
      .toMatchObject({ result: { status: 'closed', health: 'available' } });
    const finished = await workRow(second);
    expect(finished).toMatchObject({ effectivePhase: 'satisfied' });
    if (finished.execution === null || finished.execution.runId === runRef.runId) throw new Error('the continued Run must be selected');
    const continuedRun = await readExecution(second, finished.execution);
    expect(continuedRun.run).toMatchObject({ requeueRef: row['requeueRef'], outcome: 'completed' });
    expect(continuedRun.session.ref.sessionId).toBe(oldSession.ref.sessionId);
    expect(await post(second, 'executions/brief', plain(AG2B_SCOPE, { runRef: finished.execution }))).toMatchObject({ status: 'ready',
      value: { brief: { mode: 'resume_after_interruption', previous: { runRef }, trigger: { actorClass: 'system', goalResume: true },
        session: { continuity: 'same_session_without_previous_turn', sessionRef: { sessionId: oldSession.ref.sessionId },
          seededFrom: null, boundaryPosition: null } } } });
    expect(second.scripted.calls()).toBe(2);
    await assertInvariantsAt(inv, 'A7-G4 completed');
  } finally {
    await second.host.close();
  }
}, 180_000);

it('A7-G4b (G-05): a fan-out pause still queued when the Host crashed ends the Run paused-interrupted (RUN-24 kernelPaused:false, CTL-08(f)); the Goal resume continues it under the fan-out actor with a brief', async () => {
  let h: HostScenario | undefined;
  const scenario = await openHostScenario({ automation: NO_REDRIVE, script: {
    replies: [{ kind: 'text', text: 'A7-G4b: never answered on the crashed Host' }, ...editThenText('a7-g4b')],
    duringReply: async (index) => {
      if (index !== 0 || h === undefined) return;
      await goalControlled(h.host, 'pause', 'a7-g4b-pause');
    } } });
  h = scenario;
  const held = scenario.holdReply(0);
  const toStart = await scenario.advance(scenario.select('a7-g4b', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void post(scenario.host, 'workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = await selectedRun(scenario);
  const pausedEpoch = (await readGoal(scenario.host)).desiredStateRevision ?? 1;
  const pauseRef = fanOutIntentRef(pausedEpoch, runRef, 'pause');
  expect(await readControl(scenario.host, pauseRef)).toMatchObject({ status: 'queued' });
  await assertInvariants(scenario, 'G-05: the fan-out pause is queued before the safe point');

  const report = await scenario.restart({ crash: true });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-20', status: 'reconciled' }],
    fanOut: [{ goalId: AG2B_GOAL_REF.goalId, control: 'pause', problem: null, runs: 0 }], problems: [] });
  expect((await readExecution(scenario.host, runRef)).run).toMatchObject({ status: 'ended', outcome: 'crashed',
    reconciliation: { observation: { kind: 'interrupted_clean', kernelPaused: false, pausedIntentRef: pauseRef } } });
  // CI-11 / CTL-08(f): the queued pause is applied by the reconcile, never superseded (I-16).
  expect(await readControl(scenario.host, pauseRef)).toMatchObject({ status: 'applied',
    observation: { origin: 'platform_reconcile', kind: 'paused', detail: { runOutcome: 'crashed' } } });
  expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted' } });
  expect(await display(scenario.host)).toMatchObject({ display: { phase: 'PAUSED',
    runStops: [{ runRef, stop: { kind: 'paused_interrupted', pausedBy: 'goal_fan_out' } }] } });
  expect(scenario.modelCalls(), 'the reconcile called no model').toBe(1);

  // The person resumes the Goal; GOAL-29 writes exactly one TaskRequeue under the fan-out actor.
  const resumed = await goalControlled(scenario.host, 'resume', 'a7-g4b-resume');
  expect(resumed.fanOut).toMatchObject({ control: 'resume', runs: [],
    continuations: [{ taskId: AG2B_WORK_TASK_ID, afterRunRef: runRef, outcome: 'requeued' }] });
  await assertInvariants(scenario, 'G-05: GOAL-29', ownerStep('task_requeued', GOAL_FAN_OUT_ACTOR, scenario.automationPolicy(), 'G-05: GOAL-29'));
  // The history source is the interrupted Run's own Session, where the continuation also runs (K L7).
  const oldSession = (await readExecution(scenario.host, runRef)).session.ref;
  expect(scenario.lastWorld?.requeues).toMatchObject([{ afterRunRef: runRef, requestedBy: GOAL_FAN_OUT_ACTOR,
    failureClass: 'interrupted', interruption: 'paused', stopRequester: 'goal_fan_out',
    trigger: { kind: 'goal_resume', resumedEpoch: resumed.goal.desiredStateRevision, pausedEpoch },
    historySource: { sessionRef: { projectId: oldSession.projectId, sessionId: oldSession.sessionId } } }]);

  // GOAL-29, §12.10 A7-G4, K KA3: the goal_resume TaskRequeue authorizes the closure (L4 item 2), so the Workflow
  // closes the old Session's dangling Kernel Turn (`close_open_turn`) and claims the Task there with the brief (L7);
  // the Goal completes.
  const done = await scenario.advance(scenario.select('a7-g4b-continue'));
  expect(done.state).toBe('completed');
  expect(done.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['close_open_turn', 'claim_task']));
  expect(done.receipts.map(receipt => receipt.kind)).not.toContain('create_session');
  const continuedRef = await selectedRun(scenario);
  expect(continuedRef.runId).not.toBe(runRef.runId);
  const continued = await readExecution(scenario.host, continuedRef);
  expect(continued.session.ref.sessionId).toBe(oldSession.sessionId);
  // The interrupted Turn has no Kernel end position (RUN-24), so the new Run continues the same Session without a
  // previous Turn in its history and nothing is seeded (K L9).
  expect(await briefOf(scenario.host, continuedRef)).toMatchObject({ brief: { mode: 'resume_after_interruption',
    previous: { runRef, interruption: { kind: 'paused', kernelPaused: false, pausedBy: 'goal_fan_out' } },
    trigger: { actorClass: 'system', goalResume: true },
    session: { continuity: 'same_session_without_previous_turn', sessionRef: { sessionId: continued.session.ref.sessionId },
      seededFrom: null } } });
  expect(scenario.lastWorld?.requeues).toHaveLength(1);
  expect(scenario.modelCalls()).toBe(3);
  expect(scenario.abandonedCalls()).toEqual([]);
}, 180_000);

it('A7-G4b contrast (G-01 at a crash): a fan-out pause never submitted before the crash leaves a plain interruption (RUN-19); the Goal resume continues nothing and the automation requeues it, uncounted', async () => {
  let peer: AG2bHost | undefined;
  let pausedOnPeer: WriteResult<GoalControlOutcomeV1> | undefined;
  const scenario = await openHostScenario({ automation: NO_REDRIVE, script: {
    replies: [{ kind: 'text', text: 'A7-G4b contrast: never answered on the crashed Host' }, ...editThenText('a7-g4b-contrast')],
    duringReply: async (index) => {
      if (index !== 0 || peer === undefined) return;
      // L-10: the Goal pause is committed on a Host without the lease; its fan-out reaches no Run before the crash.
      pausedOnPeer = await post<WriteResult<GoalControlOutcomeV1>>(peer, 'goals/control', await control(peer, 'pause', 'a7-g4b-contrast-pause'));
    } } });
  peer = await scenario.startPeer();
  const held = scenario.holdReply(0);
  const toStart = await scenario.advance(scenario.select('a7-g4b-contrast', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void post(scenario.host, 'workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = await selectedRun(scenario);
  expect(pausedOnPeer).toMatchObject({ status: 'committed', value: { goal: { desiredState: 'paused' }, fanOut: { runs: [],
    problem: expect.stringContaining('another Host holds the instance lease') } } });
  expect((await readExecution(scenario.host, runRef)).run.controlState).toBeUndefined();
  await assertInvariants(scenario, 'G-01 contrast: the Goal is paused, the Run is not');
  await peer.host.close();

  const report = await scenario.restart({ crash: true });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-11', status: 'reconciled' }],
    fanOut: [{ control: 'pause', problem: null, runs: 0 }], problems: [] });
  // RUN-19: a plain interruption, shown as a failure (平台中断), not as 已暂停.
  expect((await readExecution(scenario.host, runRef)).run).toMatchObject({ status: 'ended', outcome: 'crashed',
    reconciliation: { observation: { kind: 'interrupted_clean', pausedIntentRef: null } } });
  expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'interrupted' } });
  expect(await display(scenario.host)).toMatchObject({ display: { phase: 'PAUSED',
    runStops: [{ runRef, stop: { kind: 'ended', outcome: 'crashed' } }] } });

  // The person resumes the Goal: GOAL-29 continues nothing (not paused-interrupted).
  const resumed = await goalControlled(scenario.host, 'resume', 'a7-g4b-contrast-resume');
  expect(resumed.fanOut).toMatchObject({ control: 'resume', runs: [], continuations: [] });
  await assertInvariants(scenario, 'G-01 contrast: the Goal is resumed');
  expect(scenario.lastWorld?.requeues).toEqual([]);
  // C2: the automation requeues the interruption, uncounted, and the Task continues in the same Session (K KA1: the
  // start-up maintenance closed its dangling Kernel Turn).
  const done = await scenario.advance(scenario.select('a7-g4b-contrast-continue'));
  expect(done.state).toBe('completed');
  expect(done.receipts.map(receipt => receipt.kind)).toContain('requeue_task');
  expect(scenario.lastWorld?.requeues).toMatchObject([{ afterRunRef: runRef, requestedBy: WORKFLOW_AUTOMATION_ACTOR,
    failureClass: 'interrupted', interruption: 'executing', automation: { automatic: true, counted: false } }]);
  expect(scenario.lastWorld?.requeues[0]?.trigger).toBeUndefined();
  expect(scenario.modelCalls()).toBe(3);
}, 180_000);

it('A7-G5 (§12.10 order): a person\'s own pause stays through the Goal pause and resume; the Host stops while the Goal is paused; the Goal resume after the restart, in process and at the next start, leaves the Task paused-interrupted until the person\'s 继续', async () => {
  let h: HostScenario | undefined;
  let pause: SubmittedControl | undefined;
  const scenario = await openHostScenario({ automation: NO_REDRIVE, script: {
    replies: [readCall('a7-g5'), ...editThenText('a7-g5')],
    duringReply: async (index) => {
      if (index !== 0 || h === undefined) return;
      pause = await submitControl(h.host, await selectedRun(h), 'pause', 'the person pauses this Run', 'a7-g5-pause');
    } } });
  h = scenario;
  expect((await scenario.advance(scenario.select('a7-g5', AG2B_WORK_TASK_ID))).state).toBe('waiting');
  const runRef = await selectedRun(scenario);
  if (pause === undefined) throw new Error('the person\'s pause must exist');
  expect(await readControl(scenario.host, pause.intent.ref)).toMatchObject({ status: 'applied', observation: { kind: 'paused' } });

  // In process first. GOAL-13: the Goal pause leaves the person's pause in place; GOAL-14: the Goal resume does not resume it.
  const goalPaused = await goalControlled(scenario.host, 'pause', 'a7-g5-goal-pause');
  expect(goalPaused.fanOut.runs).toEqual([{ runRef, outcome: 'skipped', intentRef: null, reason: 'the Run already carries a paused intent' }]);
  await assertInvariants(scenario, 'A7-G5 Goal paused over the person\'s pause');
  const goalResumed = await goalControlled(scenario.host, 'resume', 'a7-g5-goal-resume');
  expect(goalResumed.fanOut).toMatchObject({ runs: [{ runRef, outcome: 'skipped', intentRef: null,
    reason: 'the Run is not paused by this Goal\'s fan-out; a pause of its own stays' }], continuations: [] });
  expect((await readExecution(scenario.host, runRef)).run).toMatchObject({ status: 'running',
    controlState: { intentRef: pause.intent.ref, desiredState: 'paused' } });
  expect(scenario.modelCalls(), 'the Goal resume re-entered nothing').toBe(1);
  await assertInvariants(scenario, 'A7-G5 Goal resumed around the person\'s pause');

  // §12.10 A7-G5: the Goal is paused again (GOAL-13 submits nothing) and the Host stops while it is paused.
  const pausedAgain = await goalControlled(scenario.host, 'pause', 'a7-g5-goal-pause-2');
  expect(pausedAgain.fanOut.runs).toEqual([{ runRef, outcome: 'skipped', intentRef: null, reason: 'the Run already carries a paused intent' }]);
  await assertInvariants(scenario, 'A7-G5 Goal paused again');
  // The restart: RUN-24 by the person's pause (W-20); the paused Goal's start-up pass has no Run left to reach.
  const report = await scenario.restart({ staleLock: true });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-20', status: 'reconciled' }],
    fanOut: [{ control: 'pause', problem: null, runs: 0, continuations: 0 }], problems: [] });
  expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'blocked',
    phaseCause: { code: 'paused_interrupted', detail: { pausedIntentRef: pause.intent.ref } } });
  expect(await display(scenario.host)).toMatchObject({ display: { phase: 'PAUSED',
    runStops: [{ runRef, stop: { kind: 'paused_interrupted', pausedBy: 'human' } }] } });

  // The person resumes the Goal over the paused-interrupted Run: the ended Run is not in the fan-out set (GOAL-15)
  // and GOAL-29 never selects a pause a person submitted alone, so nothing is resumed and nothing is continued.
  const resumedAfter = await goalControlled(scenario.host, 'resume', 'a7-g5-goal-resume-2');
  expect(resumedAfter.fanOut).toMatchObject({ control: 'resume', problem: null, runs: [], continuations: [] });
  await assertInvariants(scenario, 'A7-G5 Goal resumed after the restart');
  expect(scenario.lastWorld?.requeues).toEqual([]);
  expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'blocked',
    phaseCause: { code: 'paused_interrupted', detail: { pausedIntentRef: pause.intent.ref } } });
  expect(await scenario.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION',
    causes: expect.arrayContaining([expect.objectContaining({ code: 'task_paused', taskId: AG2B_WORK_TASK_ID })]) });
  // The active Goal's start-up pass continues nothing either (GOAL-29 is the fan-out's only).
  const again = await scenario.restart();
  expect(again.report).toMatchObject({ runs: [], fanOut: [{ control: 'resume', problem: null, runs: 0, continuations: 0 }], problems: [] });
  expect(scenario.lastWorld?.requeues).toEqual([]);
  // The Workflow never continues a person's pause: it waits and writes nothing.
  const waiting = scenario.counts();
  expect(await scenario.advance(scenario.select('a7-g5-wait', AG2B_WORK_TASK_ID))).toMatchObject({ state: 'waiting' });
  expect(scenario.counts()).toEqual(waiting);

  // The person presses 继续 (TASK-27): one TaskRequeue by the person; the Workflow closes the dangling Kernel Turn
  // (K L7) and the Task completes in the same Session.
  const continued = await operatorRequeue(scenario.host, runRef, 'a7-g5-continue', 'continue after the restart');
  expect(continued).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: { requestedBy: SCENARIO_OPERATOR,
    failureClass: 'interrupted', interruption: 'paused', stopIntentRef: pause.intent.ref, stopRequester: 'human' } } });
  await assertInvariants(scenario, 'A7-G5 继续', ownerStep('task_requeued', SCENARIO_OPERATOR, scenario.automationPolicy(), 'A7-G5 继续'));
  const done = await scenario.advance(scenario.select('a7-g5-continue'));
  expect(done.state).toBe('completed');
  expect(scenario.lastWorld?.requeues).toHaveLength(1);
  expect(scenario.modelCalls()).toBe(3);
}, 180_000);

// A7-G6 and A7-G7. Moved from tests/app/A2-host-restart.test.ts:219 at 05125db (assertions unchanged; invariant checks
// added).
it('G-04 and G-06 at a restart: a Goal resumed (and paused and resumed again) on a Host without the lease continues its paused-interrupted Task exactly once at the next start', async () => {
  const root = await tempDir('a2-g04-ws-');
  const database = await tempDir('a2-g04-db-');
  const publicDir = await publicDirectory();
  const inv = { database };
  const { runRef } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv, 'goal');   // A.2 step 6: checked per step

  const owner = await startAG2bHost(publicDir, { root, database });
  let pausedEpoch: number;
  try {
    expect(owner.host.reconcile).toMatchObject({ report: { runs: [{ ref: JSON.stringify(runRef), row: 'W-20', status: 'reconciled' }] } });
    pausedEpoch = (await readGoal(owner)).desiredStateRevision ?? 1;
    await assertInvariantsAt(inv, 'A7-G6 paused-interrupted');
    // HL-07, L-10: a second Host commits the Goal controls (owner writes stay), but its fan-out reaches no Run.
    const other = await startAG2bHost(publicDir, { root, database });
    try {
      expect(other.host.reconcile).toMatchObject({ lease: 'held_by_other', leaseRow: 'HL-02', report: null });
      for (const [control, requestId] of [['resume', 'a2-g06-resume-1'], ['pause', 'a2-g06-pause-2'], ['resume', 'a2-g06-resume-3']] as const) {
        const written = await controlGoal(other, control, requestId);
        if (written.status !== 'committed') throw new Error(`${control}: ${JSON.stringify(written)}`);
        expect(written.value.fanOut, control).toMatchObject({ control, runs: [],
          problem: expect.stringContaining('another Host holds the instance lease') });
        expect(written.value.fanOut.continuations, 'no continuation without the lease').toBeUndefined();
      }
      expect(await workRow(other)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted' } });
      await assertInvariantsAt(inv, 'A7-G7 resume, pause, resume without the lease');
    } finally {
      await other.host.close();
    }
  } finally {
    await owner.host.close();
  }

  // The next start: step 6 runs the resume pass of the current epoch after step 2 (G-04); the Run's pointer is
  // the fan-out pause of an earlier epoch, found by the bounded recomputation (G-06). Since A.2 step 5.8 the
  // start-up re-drive claims that continuation at once (§12.1 step 6b (a), W-21); this test counts the
  // continuations the starts write, so the third and fourth Hosts keep the re-drive off.
  await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' });
  const third = await startAG2bHost(publicDir, { root, database, replies: editThenText('a2-g04') });
  try {
    const resumedEpoch = (await readGoal(third)).desiredStateRevision ?? 1;
    expect(resumedEpoch).toBe(pausedEpoch + 3);
    expect(third.host.reconcile).toMatchObject({ lease: 'owned', report: { runs: [],
      fanOut: [{ goalId: AG2B_GOAL_REF.goalId, control: 'resume', problem: null, runs: 0, continuations: 1 }],
      // §12.1 step 6b (a) (5.8): step 6's continuation reads claim_requeued, so the Goal is selected either way.
      redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }] } });
    expect(await workRow(third)).toMatchObject({ effectivePhase: 'pending', phaseCause: { code: 'requeued' },
      rework: { entries: [{ afterRunRef: runRef, requestedBy: GOAL_FAN_OUT_ACTOR, failureClass: 'interrupted' }] } });
    // This start writes only the GOAL-29 continuation (the Run was classified on the earlier start), so the
    // step-local clauses of `task_requeued` apply to it.
    const world = await assertInvariantsAt(inv, 'A7-G6 GOAL-29 at the start',
      ownerStep('task_requeued', GOAL_FAN_OUT_ACTOR, NO_REDRIVE, 'A7-G6 GOAL-29 at the start'));
    // G-06: the continuation names the earlier pause epoch the Run's pointer still is (bounded recomputation).
    expect(world.requeues).toMatchObject([{ requestedBy: GOAL_FAN_OUT_ACTOR,
      trigger: { kind: 'goal_resume', resumedEpoch, pausedEpoch } }]);
  } finally {
    await third.host.close();
  }
  // A further start adds nothing: the TaskRequeue covers the Run.
  const fourth = await startAG2bHost(publicDir, { root, database, replies: editThenText('a2-g04') });
  try {
    expect(fourth.host.reconcile).toMatchObject({ report: { runs: [],
      fanOut: [{ goalId: AG2B_GOAL_REF.goalId, control: 'resume', problem: null, continuations: 0 }] } });
    const row = await workRow(fourth);
    expect((row['rework'] as { entries: unknown[] }).entries).toHaveLength(1);
    expect((await assertInvariantsAt(inv, 'A7-G7 a further start')).requeues, 'exactly one TaskRequeue').toHaveLength(1);
    const done = (await driveChecked(fourth, inv, selectWork('a2-g04-continue', true), { policy: NO_REDRIVE })).steps;
    expect(done.at(-1), JSON.stringify(done.map(step => [step.state, step.reason, step.receipt?.kind]))).toMatchObject({ state: 'completed' });
    const finished = await workRow(fourth);
    if (finished.execution === null || finished.execution.runId === runRef.runId) throw new Error('the continued Run must be selected');
    expect(await post(fourth, 'executions/brief', plain(AG2B_SCOPE, { runRef: finished.execution }))).toMatchObject({ status: 'ready',
      value: { brief: { mode: 'resume_after_interruption', previous: { runRef }, trigger: { actorClass: 'system', goalResume: true } } } });
    await assertInvariantsAt(inv, 'A7-G6 completed');
  } finally {
    await fourth.host.close();
  }
}, 240_000);

it('§2.3 step 2 (5.6 FINAL #28): the start-up resume pass skips an entered Run that step 2 left (W-07); the next start classifies it (RUN-24) and GOAL-29 continues it at once (G-04)', async () => {
  let h: HostScenario | undefined;
  const scenario = await openHostScenario({ automation: NO_REDRIVE, script: {
    replies: [readCall('a7-w07'), ...editThenText('a7-w07')],
    duringReply: async (index) => {
      if (index !== 0 || h === undefined) return;
      await goalControlled(h.host, 'pause', 'a7-w07-pause');
    } } });
  h = scenario;
  expect((await scenario.advance(scenario.select('a7-w07', AG2B_WORK_TASK_ID))).state).toBe('waiting');
  const runRef = await selectedRun(scenario);
  const pausedEpoch = (await readGoal(scenario.host)).desiredStateRevision ?? 1;
  const pauseRef = fanOutIntentRef(pausedEpoch, runRef, 'pause');
  expect(await readControl(scenario.host, pauseRef)).toMatchObject({ status: 'applied', observation: { kind: 'paused' } });

  // A start without the Kernel Store registration: step 2 leaves the entered Run (W-07, H-03).
  const leftPaused = await scenario.restart({ staleLock: true, noKernelStores: true });
  expect(leftPaused.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-07', status: 'left' }],
    fanOut: [{ control: 'pause', problem: null, runs: 1 }] });
  // The Goal is resumed on a Host without the lease (L-10), so no in-process pass reaches the Run.
  const peer = await scenario.startPeer();
  const resumedOnPeer = await controlGoal(peer, 'resume', 'a7-w07-resume');
  if (resumedOnPeer.status !== 'committed') throw new Error(`resume: ${JSON.stringify(resumedOnPeer)}`);
  const resumedEpoch = resumedOnPeer.value.goal.desiredStateRevision ?? 1;
  await peer.host.close();
  await assertInvariants(scenario, '#28: the Goal is resumed without the lease');

  // The start-up pass of the resume epoch skips the entered Run step 2 left: no resume intent is submitted.
  const left = await scenario.restart({ noKernelStores: true });
  expect(left.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-07', status: 'left' }],
    fanOut: [{ control: 'resume', problem: null, runs: 1, continuations: 0 }] });
  expect(await readIntentAnswer(scenario.host, fanOutIntentRef(resumedEpoch, runRef, 'resume'))).toMatchObject({ status: 'not_found' });
  expect((await readExecution(scenario.host, runRef)).run).toMatchObject({ status: 'running',
    controlState: { intentRef: pauseRef, desiredState: 'paused' } });

  // With the Kernel Store again, step 2 classifies the Run (W-20) and step 6 continues it in the same start (G-04).
  // The restart's invariant check has no step: this start also classifies the Run, so it is more than the
  // `task_requeued` step whose step-local clauses would read the classification as part of the requeue.
  const classified = await scenario.restart({ noKernelStores: false });
  expect(classified.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-20', status: 'reconciled' }],
    fanOut: [{ control: 'resume', problem: null, runs: 0, continuations: 1 }] });
  expect(await readIntentAnswer(scenario.host, fanOutIntentRef(resumedEpoch, runRef, 'resume'))).toMatchObject({ status: 'not_found' });
  expect(scenario.lastWorld?.requeues).toMatchObject([{ afterRunRef: runRef, requestedBy: GOAL_FAN_OUT_ACTOR,
    interruption: 'paused', trigger: { kind: 'goal_resume', resumedEpoch, pausedEpoch } }]);
  expect(scenario.modelCalls(), 'no start called a model').toBe(1);

  const done = await scenario.advance(scenario.select('a7-w07-continue'));
  expect(done.state).toBe('completed');
  expect(scenario.lastWorld?.requeues).toHaveLength(1);
  expect(scenario.modelCalls()).toBe(3);
}, 180_000);

it('GOAL-29 after a person\'s 继续 (G-04 "存在 → 跳过", the sequential order of `already_continued`): the start-up continuation skips a Run a TaskRequeue covers; exactly one TaskRequeue, the person\'s', async () => {
  let h: HostScenario | undefined;
  const scenario = await openHostScenario({ automation: NO_REDRIVE, script: {
    replies: [readCall('a7-first'), ...editThenText('a7-first')],
    duringReply: async (index) => {
      if (index !== 0 || h === undefined) return;
      await goalControlled(h.host, 'pause', 'a7-first-pause');
    } } });
  h = scenario;
  expect((await scenario.advance(scenario.select('a7-first', AG2B_WORK_TASK_ID))).state).toBe('waiting');
  const runRef = await selectedRun(scenario);
  const report = await scenario.restart({ staleLock: true });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-20', status: 'reconciled' }] });

  // The Goal is resumed on a Host without the lease (no GOAL-29 there); the person presses 继续 first.
  const peer = await scenario.startPeer();
  const resumed = await controlGoal(peer, 'resume', 'a7-first-resume');
  expect(resumed).toMatchObject({ status: 'committed', value: { fanOut: { runs: [], problem: expect.stringContaining('another Host holds the instance lease') } } });
  await peer.host.close();
  await assertInvariants(scenario, 'the Goal is resumed without the lease');
  const continued = await operatorRequeue(scenario.host, runRef, 'a7-first-continue', 'the person continues first');
  expect(continued).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: { requestedBy: SCENARIO_OPERATOR,
    interruption: 'paused', stopRequester: 'goal_fan_out' } } });
  if (continued.status !== 'committed' || continued.value.kind !== 'requeued') throw new Error('the continue must commit');
  await assertInvariants(scenario, 'the person\'s 继续', ownerStep('task_requeued', SCENARIO_OPERATOR, scenario.automationPolicy(), 'the person\'s 继续'));

  // The next start's GOAL-29 pass finds the Run covered and continues nothing.
  const next = await scenario.restart();
  expect(next.report).toMatchObject({ runs: [], fanOut: [{ control: 'resume', problem: null, continuations: 0 }] });
  expect(scenario.lastWorld?.requeues).toMatchObject([{ ref: continued.value.requeue.ref, requestedBy: SCENARIO_OPERATOR }]);
  expect(scenario.lastWorld?.requeues[0]?.trigger).toBeUndefined();
  const done = await scenario.advance(scenario.select('a7-first-done'));
  expect(done.state).toBe('completed');
  expect(scenario.lastWorld?.requeues).toHaveLength(1);
}, 180_000);
