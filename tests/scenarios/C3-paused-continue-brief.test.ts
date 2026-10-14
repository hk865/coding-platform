/**
 * A.2 step 6, scenario C3 with C4 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * `tests/scenarios/C3-paused-continue-brief.test.ts`; §6 contract (e) `ContinuationBriefV1`
 * `previous.interruption` and `previous.unacceptedSteers`; §4 TASK-27 and the rework matrix;
 * §7 CTL-08(c) on RUN-24; §12.2 W-20 and "核对之后的接续"; lead decision LA-1).
 *
 * A person pauses the entered work Run; it pauses at the safe point after its first tool group.
 * While it is paused the person steers it; the Kernel never accepts that steer (the Turn never
 * reaches another model boundary). The Host stops and the next one ends the Run
 * paused-interrupted (W-20, RUN-24) and supersedes the steer (CTL-08(c)).
 *
 * - An Agent's 继续 (a second work Task's running Run asks `requeue_task` for the paused Task) is
 *   `forbidden`: no TaskRequeue, so no continuation brief and no Run.
 * - The person's 继续 (TASK-27) lets the Workflow close Run 1's open Kernel Turn (`close_open_turn`,
 *   slice K KA3) and opens Run 2 in the same Session; its continuation brief says the same Session
 *   without the previous Turn, says the previous Run was interrupted while paused by a person
 *   (`interruption.kind='paused'`, `pausedBy='human'`) and carries the never-accepted steer's text,
 *   which reaches Run 2's first model request.
 *
 * The pause → restart → 继续 path itself (RUN-24, the retired Session, the closed Turn, the same
 * Session) is A8-3l's (tests/scenarios/A8-host-restart-paused.test.ts); this scenario adds the brief
 * and the Agent refusal.
 * Every step that changes records is followed by the §11 invariant check. Scripted model replies
 * only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { SubmittedControl } from '../../src/contracts/control-intent.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import { AG2B_GOAL_REF, AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import { readControl, readExecution, readGoal, submitControl } from '../helpers/A2-restart-fixture.js';
import {
  assertInvariants, cleanupScenarios, openHostScenario, workRunCtx, SCENARIO_OPERATOR, type HostScenario,
} from './harness.js';
import {
  NO_REDRIVE, briefOf, editThenText, openWorkRoot, operatorRequeue, ownerStep, readCall, selectedRun, taskRefOf,
} from './support/common.js';

afterEach(cleanupScenarios);

const OTHER_TASK_ID = 'ag2b-work-2';
const STEER_TEXT = 'C3 steer while paused: rename nothing, only write the result file';

it('C3/C4: a Run a person paused, with a steer the Kernel never accepted, ends paused-interrupted at the restart; an Agent\'s 继续 is forbidden and leaves no brief and no Run; the person\'s 继续 opens Run 2 whose brief says paused by a person and carries the steer text', async () => {
  let h: HostScenario | undefined;
  let pause: SubmittedControl | undefined;
  let agentContinue: WriteResult<TaskRequeueOutcomeV1> | undefined;
  const scenario = await openHostScenario({ workIds: [AG2B_WORK_TASK_ID, OTHER_TASK_ID], check: 'pass', automation: NO_REDRIVE,
    script: {
      // 0: Run 1's first tool group (the pause lands after it); 1: the other Task's Run (the Agent); 2, 3: Run 2.
      replies: [readCall('c3-run1'), { kind: 'text', text: 'C3 other Task: done' }, ...editThenText('c3-run2')],
      duringReply: async (index) => {
        if (h === undefined) return;
        if (index === 0) {
          pause = await submitControl(h.host, await selectedRun(h), 'pause', 'the person pauses the Run', 'c3-pause');
          return;
        }
        if (index !== 1) return;
        // The other Task's Run is entered and running: as an Agent it asks to continue the paused Task.
        const agentRun = await selectedRun(h, OTHER_TASK_ID);
        const pausedRun = await selectedRun(h, AG2B_WORK_TASK_ID);
        const goal = await readGoal(h.host);
        const afterRun = (await readExecution(h.host, pausedRun)).run;
        // The owners with the Runtime grant (as the Host's platform has), so the Agent goes through the
        // delegated-write admission; `direct()` would refuse every Agent before it.
        const agentPlatform = await openWorkRoot(h);
        try {
          agentContinue = await agentPlatform.claims.requeueTask!(workRunCtx(agentRun), {
            input: { taskRef: taskRefOf(AG2B_WORK_TASK_ID), afterRunRef: pausedRun, reason: 'the Agent continues the paused Task' },
            meta: { requestId: 'c3-agent-continue', expected: [{ ref: AG2B_GOAL_REF, revision: goal.revision },
              { ref: pausedRun, revision: afterRun.revision }] } });
        } finally {
          await agentPlatform.close();
        }
      },
    } });
  h = scenario;

  // Run 1 enters and pauses at the safe point after its first tool group; the person then steers it.
  expect((await scenario.advance(scenario.select('c3-run1', AG2B_WORK_TASK_ID))).state).toBe('waiting');
  const run1 = await selectedRun(scenario);
  if (pause === undefined) throw new Error('the pause must have been submitted during the first model call');
  expect(await readControl(scenario.host, pause.intent.ref)).toMatchObject({ status: 'applied', observation: { kind: 'paused' } });
  const steer = await submitControl(scenario.host, run1, 'steer', STEER_TEXT, 'c3-steer');
  expect(steer.intent).toMatchObject({ status: 'queued', reason: STEER_TEXT });
  expect(scenario.modelCalls()).toBe(1);
  await assertInvariants(scenario, 'C3 paused with a queued steer');

  // The Host stops; the next start ends Run 1 paused-interrupted (W-20) and the never-accepted steer is superseded (CTL-08(c)).
  const report = await scenario.restart({ staleLock: true });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(run1), row: 'W-20', status: 'reconciled' }], problems: [] });
  expect((await readExecution(scenario.host, run1)).run).toMatchObject({ status: 'ended', outcome: 'crashed',
    reconciliation: { observation: { kind: 'interrupted_clean', kernelPaused: true, pausedIntentRef: pause.intent.ref } } });
  expect(await readControl(scenario.host, steer.intent.ref)).toMatchObject({ status: 'superseded',
    observation: { origin: 'platform_reconcile', kind: 'terminal_without_cancel' } });
  expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted' } });

  // An Agent's 继续: the other Task's running Run asks for the requeue; it is forbidden and writes nothing.
  const other = await scenario.advance(scenario.select('c3-agent', OTHER_TASK_ID));
  expect(other.state).toBe('completed');
  // The refusal is the Agent rules' first layer, the delegated-write admission (no `requeue_task` grant, GAP-46),
  // not a platform that admits no Agent; the human fence of the paused class stays behind it as the second layer.
  expect(agentContinue).toMatchObject({ status: 'rejected', code: 'forbidden',
    reason: 'the current Host/Role grant does not include requeue_task' });
  expect(scenario.lastWorld?.requeues, 'no TaskRequeue, so no continuation brief').toEqual([]);
  expect(scenario.lastWorld?.runs.filter(run => run.task.taskId === AG2B_WORK_TASK_ID).map(run => run.ref), 'no new Run')
    .toEqual([run1]);
  expect(await scenario.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted' } });
  expect(await briefOf(scenario.host, run1), 'Run 1 itself carries no brief').toBeNull();

  // The person's 继续 (TASK-27): one TaskRequeue by the person, interrupted while paused.
  const continued = await operatorRequeue(scenario.host, run1, 'c3-continue', 'the person continues after the restart');
  expect(continued).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: { requestedBy: SCENARIO_OPERATOR,
    failureClass: 'interrupted', interruption: 'paused', stopIntentRef: pause.intent.ref, stopRequester: 'human' } } });
  await assertInvariants(scenario, 'C3 继续', ownerStep('task_requeued', SCENARIO_OPERATOR, scenario.automationPolicy(), 'C3 继续'));

  // The Workflow first closes Run 1's open Kernel Turn (the person's TaskRequeue authorizes it; slice K L4, L7), then
  // Run 2 runs in Run 1's Session with the brief, no new Session; the Task is satisfied.
  const done = await scenario.advance(scenario.select('c3-run2', AG2B_WORK_TASK_ID));
  expect(done.state).toBe('completed');
  expect(done.receipts.map(receipt => receipt.kind)).toContain('close_open_turn');
  expect(done.receipts.map(receipt => receipt.kind)).not.toContain('create_session');
  const run2 = await selectedRun(scenario);
  expect(run2.runId).not.toBe(run1.runId);
  const record2 = await readExecution(scenario.host, run2);
  expect(record2.session.ref.sessionId).toBe((await readExecution(scenario.host, run1)).session.ref.sessionId);
  const bound = await briefOf(scenario.host, run2);
  if (bound === null) throw new Error('Run 2 must carry a continuation brief');
  expect(bound.digest).toBe(record2.run.inputBinding?.continuationBriefDigest);
  expect(bound.brief).toMatchObject({ mode: 'resume_after_interruption', failureClass: 'interrupted',
    trigger: { actorClass: 'human', goalResume: false },
    previous: { runRef: run1, interruption: { kind: 'paused', kernelPaused: true, pausedBy: 'human' } },
    session: { continuity: 'same_session_without_previous_turn', seededFrom: null, boundaryPosition: null } });
  expect(bound.brief.previous.unacceptedSteers).toEqual([{ intentRef: steer.intent.ref, text: { text: STEER_TEXT, truncated: false } }]);
  // The rendered brief reached Run 2's first model request, the never-accepted steer's text with it.
  const run2First = JSON.stringify(scenario.modelRequests()[2]?.messages);
  expect(run2First).toContain(STEER_TEXT);
  expect(run2First).toContain(steer.intent.ref.intentId);
  expect(scenario.lastWorld?.requeues).toHaveLength(1);
  expect(scenario.modelCalls()).toBe(4);
}, 180_000);
