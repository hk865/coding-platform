/**
 * A.2 step 6, scenario A7 and G7, GOAL-29 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * `tests/scenarios/A7-control.test.ts`; §2.3 GOAL-29 and the re-drive protocol; §12.7 G-04; §12.2 "核对之后的接续";
 * lead decisions LA-1, L-10). Split from tests/scenarios/A7-control.test.ts, which would pass the ~90 s guideline.
 *
 * 1. A7-G4 with history: the Run the Goal fan-out paused had an earlier completed Turn in its Session; after the
 *    crash (W-20; maintenance never closes this paused line) and the Goal resume, the Workflow closes the Session's
 *    dangling Kernel Turn (`close_open_turn`, K slice L7; the goal_resume TaskRequeue authorizes it) and the GOAL-29
 *    continuation runs in that same Session in a new Run (`same_session_without_previous_turn`); its first model
 *    request carries the earlier Turn and the brief, never the interrupted Turn (K L3). With the closure unsupported
 *    (a Kernel without `closeOpenTurn`, K L8) the continuation still runs in a new Session (`create_session{requeue}`)
 *    seeded with that history (`other_session_seeded`, contract (e)), with the same first request.
 * 2. GOAL-29's race outcomes (5.6 FINAL #27): the Host's fan-out driver over the owners on the same files, its
 *    `requeueTask` port wrapped so that, between the pass's read of the continuations and its requeue commit, a
 *    person's 继续 commits (`already_continued`) or the Goal is paused again (`stale`); neither writes a second
 *    TaskRequeue. Sequentially (no race) the read already leaves a covered Run out (A7-control.test.ts, case 17).
 *
 * Every step that changes records is followed by the §11 invariant check (tests/scenarios/harness.ts). Scripted
 * model replies only; no real model is called.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/app/core-http-types.js';
import { createGoalFanOutDriver } from '../../src/app/goal-fan-out-driver.js';
import { GOAL_FAN_OUT_ACTOR } from '../../src/contracts/task-requeue.js';
import { AG2B_GOAL_REF, AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import { controlGoal, readControl, readExecution, readGoal } from '../helpers/A2-restart-fixture.js';
import {
  assertInvariants, assertInvariantsAt, cleanupScenarios, hostCtx, openHostScenario, SCENARIO_OPERATOR, type HostScenario,
} from './harness.js';
import { NO_REDRIVE, briefOf, operatorRequeue, ownerStep, readCall, selectedRun } from './support/common.js';
import { fanOutIntentRef, goalControlled } from './support/control.js';

afterEach(cleanupScenarios);

// K slice: the fallback copy switches the Kernel's `closeOpenTurn` off, so the Runtime's closure answers `unsupported`
// (K L4 step 5) and the Workflow takes today's new-Session path (K L8).
const kernelClosure = vi.hoisted(() => ({ supported: true }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.defineProperty({ ...actual }, 'closeOpenTurn', { enumerable: true,
    get: () => (kernelClosure.supported ? actual['closeOpenTurn'] : undefined) });
});
afterEach(() => { kernelClosure.supported = true; });

it('A7-G4 with history (closing supported; KA-07, GOAL-29, LA-1, contract (e)): a Run the Goal fan-out paused after an earlier completed Turn of its Session is continued by the Goal resume in the same Session once its dangling Kernel Turn is closed; the first request carries the earlier Turn, never the interrupted one', async () => {
  const RUN0 = 'ag2b-work-0';
  const RUN0_TEXT = 'A7-G4 history: Run0 completed this Turn in S1';
  let h: HostScenario | undefined;
  const scenario = await openHostScenario({ automation: NO_REDRIVE, check: 'pass', workIds: [RUN0, AG2B_WORK_TASK_ID], script: {
    // Run0 (a read, then its answer) completes in S1; the work Run's first reply declares a read, and the Goal pause
    // submitted during that request lands at the safe point before the read runs; the continuation answers.
    replies: [readCall('a7-g4h-run0'), { kind: 'text', text: RUN0_TEXT }, readCall('a7-g4h-interrupted'),
      { kind: 'text', text: 'A7-G4 history: the continuation answers' }],
    duringReply: async (index) => {
      if (index !== 2 || h === undefined) return;
      await goalControlled(h.host, 'pause', 'a7-g4h-pause');
    } } });
  h = scenario;
  await scenario.advance(scenario.select('a7-g4h-run0', RUN0));
  const run0 = await readExecution(scenario.host, await selectedRun(scenario, RUN0));
  expect(run0.run).toMatchObject({ status: 'ended', outcome: 'completed' });
  const s1: SessionRef = { projectId: run0.session.ref.projectId, sessionId: run0.session.ref.sessionId };
  expect((await scenario.advance({ ...scenario.select('a7-g4h-run1', AG2B_WORK_TASK_ID), sessionHint: s1 })).state).toBe('waiting');
  const runRef = await selectedRun(scenario);
  const paused = await readExecution(scenario.host, runRef);
  expect(paused.session.ref.sessionId, 'the work Run runs in S1').toBe(s1.sessionId);
  const pausedEpoch = (await readGoal(scenario.host)).desiredStateRevision ?? 1;
  expect(await readControl(scenario.host, fanOutIntentRef(pausedEpoch, runRef, 'pause'))).toMatchObject({ status: 'applied' });

  // The crash: W-20 (the fan-out pause in effect), the Session retired (LA-1); the paused Goal continues nothing.
  const report = await scenario.restart({ crash: true });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-20', status: 'reconciled' }], problems: [] });
  expect((await readExecution(scenario.host, runRef)).session).toMatchObject({ health: 'unavailable', healthConclusion: 'kernel_turn_open' });

  // The person resumes the Goal: GOAL-29 continues the Task under the fan-out actor; the history source is S1.
  const resumed = await goalControlled(scenario.host, 'resume', 'a7-g4h-resume');
  expect(resumed.fanOut).toMatchObject({ control: 'resume', continuations: [{ taskId: AG2B_WORK_TASK_ID, afterRunRef: runRef,
    outcome: 'requeued' }] });
  await assertInvariants(scenario, 'A7-G4 history: GOAL-29', ownerStep('task_requeued', GOAL_FAN_OUT_ACTOR, scenario.automationPolicy(),
    'A7-G4 history: GOAL-29'));
  const [requeue] = scenario.lastWorld?.requeues ?? [];
  expect(requeue).toMatchObject({ afterRunRef: runRef, requestedBy: GOAL_FAN_OUT_ACTOR, interruption: 'paused',
    trigger: { kind: 'goal_resume', pausedEpoch }, historySource: { sessionRef: s1, throughPosition: expect.any(Number) } });

  // K (KA3, L7): the goal_resume TaskRequeue authorizes the closure (L4 item 2), so the Workflow closes S1's dangling
  // Kernel Turn (`close_open_turn`; maintenance never closes this paused line) and then claims the Task in S1 itself in a
  // new Run (KA-07): no new Session, no handover, no archive, so nothing is seeded.
  const done = await scenario.advance(scenario.select('a7-g4h-continue'));
  expect(done.state).toBe('completed');
  const kinds = done.receipts.map(receipt => receipt.kind);
  expect(kinds).toEqual(expect.arrayContaining(['close_open_turn', 'claim_task']));
  expect(kinds.filter(kind => ['create_session', 'transfer_responsibility', 'archive_predecessor'].includes(kind))).toEqual([]);
  expect(done.receipts.find(receipt => receipt.kind === 'close_open_turn'))
    .toMatchObject({ result: { status: 'closed', health: 'available' } });
  const continuedRef = await selectedRun(scenario);
  expect(continuedRef.runId, 'KA-07: a new Run').not.toBe(runRef.runId);
  const continued = await readExecution(scenario.host, continuedRef);
  expect(continued.session.ref.sessionId, 'KA-07: the same Session').toBe(s1.sessionId);
  expect(continued.session, 'SES-13 made S1 available again; it is not archived').toMatchObject({ lifecycle: 'active', health: 'available' });
  const bound = await briefOf(scenario.host, continuedRef);
  expect(bound).toMatchObject({ brief: { mode: 'resume_after_interruption', trigger: { actorClass: 'system', goalResume: true },
    previous: { runRef, sessionRef: s1, interruption: { kind: 'paused', pausedBy: 'goal_fan_out' } },
    session: { continuity: 'same_session_without_previous_turn', sessionRef: { sessionId: s1.sessionId },
      seededFrom: null, boundaryPosition: null } } });
  // The continuation's first request: Run0's completed Turn (its read and its answer) and the brief, never the interrupted
  // Turn's declared read.
  const first = scenario.modelRequests()[3];
  const toolIds = (first?.messages ?? []).flatMap(message => message.role === 'tool' && message.callId !== undefined ? [message.callId] : []);
  expect(JSON.stringify(first?.messages ?? [])).toContain(RUN0_TEXT);
  expect(toolIds).toEqual(['a7-g4h-run0-read']);
  expect(scenario.lastWorld?.requeues).toHaveLength(1);
  expect(scenario.modelCalls()).toBe(4);
  await scenario.drainAbandoned();
}, 180_000);

it('A7-G4 with history (closing unsupported; GOAL-29, LA-1, contract (e)): a Run the Goal fan-out paused after an earlier completed Turn of its Session is continued by the Goal resume in a new Session seeded with that history; the first request carries the earlier Turn, never the interrupted one', async () => {
  const RUN0 = 'ag2b-work-0';
  const RUN0_TEXT = 'A7-G4 history: Run0 completed this Turn in S1';
  let h: HostScenario | undefined;
  const scenario = await openHostScenario({ automation: NO_REDRIVE, check: 'pass', workIds: [RUN0, AG2B_WORK_TASK_ID], script: {
    // Run0 (a read, then its answer) completes in S1; the work Run's first reply declares a read, and the Goal pause
    // submitted during that request lands at the safe point before the read runs; the continuation answers.
    replies: [readCall('a7-g4h-run0'), { kind: 'text', text: RUN0_TEXT }, readCall('a7-g4h-interrupted'),
      { kind: 'text', text: 'A7-G4 history: the continuation answers' }],
    duringReply: async (index) => {
      if (index !== 2 || h === undefined) return;
      await goalControlled(h.host, 'pause', 'a7-g4h-pause');
    } } });
  h = scenario;
  await scenario.advance(scenario.select('a7-g4h-run0', RUN0));
  const run0 = await readExecution(scenario.host, await selectedRun(scenario, RUN0));
  expect(run0.run).toMatchObject({ status: 'ended', outcome: 'completed' });
  const s1: SessionRef = { projectId: run0.session.ref.projectId, sessionId: run0.session.ref.sessionId };
  expect((await scenario.advance({ ...scenario.select('a7-g4h-run1', AG2B_WORK_TASK_ID), sessionHint: s1 })).state).toBe('waiting');
  const runRef = await selectedRun(scenario);
  const paused = await readExecution(scenario.host, runRef);
  expect(paused.session.ref.sessionId, 'the work Run runs in S1').toBe(s1.sessionId);
  const pausedEpoch = (await readGoal(scenario.host)).desiredStateRevision ?? 1;
  expect(await readControl(scenario.host, fanOutIntentRef(pausedEpoch, runRef, 'pause'))).toMatchObject({ status: 'applied' });

  // The crash: W-20 (the fan-out pause in effect), the Session retired (LA-1); the paused Goal continues nothing.
  // K L8: from this start on the Kernel has no `closeOpenTurn`, so closing S1's dangling Turn is unsupported.
  kernelClosure.supported = false;
  const report = await scenario.restart({ crash: true });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-20', status: 'reconciled' }], problems: [] });
  expect((await readExecution(scenario.host, runRef)).session).toMatchObject({ health: 'unavailable', healthConclusion: 'kernel_turn_open' });

  // The person resumes the Goal: GOAL-29 continues the Task under the fan-out actor; the history source is S1.
  const resumed = await goalControlled(scenario.host, 'resume', 'a7-g4h-resume');
  expect(resumed.fanOut).toMatchObject({ control: 'resume', continuations: [{ taskId: AG2B_WORK_TASK_ID, afterRunRef: runRef,
    outcome: 'requeued' }] });
  await assertInvariants(scenario, 'A7-G4 history: GOAL-29', ownerStep('task_requeued', GOAL_FAN_OUT_ACTOR, scenario.automationPolicy(),
    'A7-G4 history: GOAL-29'));
  const [requeue] = scenario.lastWorld?.requeues ?? [];
  expect(requeue).toMatchObject({ afterRunRef: runRef, requestedBy: GOAL_FAN_OUT_ACTOR, interruption: 'paused',
    trigger: { kind: 'goal_resume', pausedEpoch }, historySource: { sessionRef: s1, throughPosition: expect.any(Number) } });

  // The `close_open_turn` step answers `unsupported` (K L4 step 5, a definite failure), so the Workflow claims the Task
  // through `create_session{requeue}` in a new Session (K L8); `prepare` seeds S1's completed history.
  const done = await scenario.advance(scenario.select('a7-g4h-continue'));
  expect(done.state).toBe('completed');
  expect(done.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['close_open_turn', 'create_session', 'claim_task']));
  expect(done.receipts.find(receipt => receipt.kind === 'close_open_turn')).toMatchObject({ result: { status: 'unsupported' } });
  const continuedRef = await selectedRun(scenario);
  const continued = await readExecution(scenario.host, continuedRef);
  expect(continued.session.ref.sessionId, 'LA-1: a new Session').not.toBe(s1.sessionId);
  const bound = await briefOf(scenario.host, continuedRef);
  expect(bound).toMatchObject({ brief: { mode: 'resume_after_interruption', trigger: { actorClass: 'system', goalResume: true },
    previous: { runRef, sessionRef: s1, interruption: { kind: 'paused', pausedBy: 'goal_fan_out' } },
    session: { continuity: 'other_session_seeded', sessionRef: { sessionId: continued.session.ref.sessionId },
      seededFrom: { sessionRef: s1, throughPosition: requeue?.historySource?.throughPosition } } } });
  // The continuation's first request: Run0's completed Turn (its read and its answer) and the brief, never the interrupted
  // Turn's declared read.
  const first = scenario.modelRequests()[3];
  const toolIds = (first?.messages ?? []).flatMap(message => message.role === 'tool' && message.callId !== undefined ? [message.callId] : []);
  expect(JSON.stringify(first?.messages ?? [])).toContain(RUN0_TEXT);
  expect(toolIds).toEqual(['a7-g4h-run0-read']);
  expect(scenario.lastWorld?.requeues).toHaveLength(1);
  expect(scenario.modelCalls()).toBe(4);
  await scenario.drainAbandoned();
}, 180_000);

it('GOAL-29 race outcomes (§2.3, 5.6 FINAL #27): a person\'s 继续 committed between the resume pass\'s read and its requeue gives `already_continued`; a Goal paused again in that window gives `stale`; neither writes a second TaskRequeue', async () => {
  for (const race of ['already_continued', 'stale'] as const) {
    let h: HostScenario | undefined;
    const scenario = await openHostScenario({ automation: NO_REDRIVE, script: {
      replies: [readCall(`a7-race-${race}`)],
      duringReply: async (index) => {
        if (index !== 0 || h === undefined) return;
        await goalControlled(h.host, 'pause', `a7-race-${race}-pause`);
      } } });
    h = scenario;
    expect((await scenario.advance(scenario.select(`a7-race-${race}`, AG2B_WORK_TASK_ID))).state).toBe('waiting');
    const runRef = await selectedRun(scenario);
    expect((await scenario.restart({ staleLock: true })).report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-20' }] });
    // The Goal is resumed on a Host without the lease, so no GOAL-29 pass ran yet (L-10).
    const peer = await scenario.startPeer();
    expect(await controlGoal(peer, 'resume', `a7-race-${race}-resume`)).toMatchObject({ status: 'committed' });
    await peer.host.close();
    await assertInvariants(scenario, `${race}: the Goal is resumed without the lease`);

    // The Host's GOAL-29 pass (the fan-out driver over the owners on the same files, its `requeueTask` port wrapped):
    // between the pass's read of the continuations and its requeue commit, the race writes through the live Host.
    const platform = await scenario.direct();
    let raced = false;
    const driver = createGoalFanOutDriver({ goals: platform.goals, plans: platform.plans, executions: platform.executions,
      controls: platform.controls, runtime: platform.runtime,
      claims: { requeueTask: async (...args) => {
        if (!raced) {
          raced = true;
          if (race === 'already_continued') {
            const continued = await operatorRequeue(scenario.host, runRef, 'a7-race-continue', 'the person continues first');
            if (continued.status !== 'committed') throw new Error(`the person's 继续 must commit: ${JSON.stringify(continued)}`);
          } else {
            await goalControlled(scenario.host, 'pause', 'a7-race-pause-again');
          }
        }
        return platform.claims.requeueTask!(...args);
      } } });
    try {
      const pass = await driver.fanOut(hostCtx(), AG2B_GOAL_REF);
      expect(raced, 'the pass read the continuation and reached its requeue').toBe(true);
      expect(pass.continuations, race).toEqual([{ taskId: AG2B_WORK_TASK_ID, afterRunRef: runRef, outcome: race,
        reason: expect.any(String) }]);
    } finally {
      await driver.close();
    }
    const world = await assertInvariantsAt(scenario, `${race}: the GOAL-29 pass`);
    if (race === 'already_continued') {
      // The person's TaskRequeue is the only one; the pass wrote nothing.
      expect(world.requeues).toMatchObject([{ afterRunRef: runRef, requestedBy: SCENARIO_OPERATOR }]);
      expect(world.requeues[0]?.trigger).toBeUndefined();
    } else {
      // The Goal moved on (paused again): the continuation is dropped, nothing is written; the Task stays paused-interrupted.
      expect(world.requeues).toEqual([]);
      expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted' } });
    }
    await scenario.drainAbandoned();
  }
}, 180_000);
