/**
 * RSR R1, R2 (`rsr-rulings.md` 4; `rsr-challenge.md` M2, S8; `rsr-draft.md` 测试行): a Goal paused when this Host
 * started, resumed by the person. C-151 (`scripts/acceptance/scenarios/e06.mjs:27`): "暂停中重启：不算失败，可继续，
 * 恢复后在原线接着做"; `docs/MVP-BEHAVIOR.md` B08 (继续); B10 ("Host 重开") and decision 97-9 hold a Goal with a
 * pending restart interruption for the person's start. SQLite (every row restarts the Host); public routes and reads only;
 * scripted model replies only.
 *
 * R1 (ask and off, lead ruling 4): after the resume the test never calls `workflow/advance` or `driver-start`.
 * - Red today at the `driver-read` wait: the resume review registers a Goal only for an `open` dispatch request
 *   (`src/app/host.ts:1255`), and the restart rebuilt no wait for this Goal, so no goal loop ever starts.
 * - Green with RSR-1: the Goal's start-up `fanOut` row reads `control: 'pause'`, so the review registers and queues
 *   it and the goal-waits wake starts the loop (`collaboration-driver.ts` `wake` → `startHandle`).
 * - Mutation guarded: drop `|| crossed`, or judge "paused at start" from the Goal read after the resume (active
 *   then, never true): no loop, the wait times out.
 *
 * R2 (M2): Goal A carries the pending interruption an earlier start recorded; Goal B (no Plan) is the positive
 * witness. Both are paused across a restart, A is resumed first, then B. B's loop appearing is the completion
 * barrier: the marks are reviewed in insertion order (`host.ts:1252`), a page wakes by priority then cursor and A's
 * resume cursor is earlier (`goal-wait-wakes.ts:380-381`, `:451-457`), and `wake` awaits `startHandle`, which
 * awaits `onStarted` (`collaboration-driver.ts:1520-1526`). So once B has a loop, any wake of A has finished.
 * - Red today at the B barrier: without RSR-1 no resumed Goal gets a loop, B included.
 * - Green with RSR-1: B (paused at start, not held) is woken; A stays held by `goalHeldByRestart`.
 * - Mutation guarded: the new branch skips `goalHeldByRestart` → A is woken before B, its `onStarted` resolves the
 *   interruption and A has a driver: the A assertions after the barrier go red.
 */
import { afterEach, expect, it } from 'vitest';
import type { TaskExecutionPage } from '../../src/app/core-http-types.js';
import type { GoalDisplayRead } from '../../src/core/work-graph/model/plan-contracts.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskAutomationPolicyV1 } from '../../src/contracts/task-requeue.js';
import {
  AG2B_GOAL_REF, AG2B_PROJECT_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, AG2B_WORKSPACE_REF, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution, readGoal } from '../helpers/A2-restart-fixture.js';
import { readReady } from '../helpers/S6B3-fixture.js';
import { cleanupScenarios, openHostScenario, performs, waitFor, type HostScenario } from './harness.js';
import { NO_REDRIVE, briefOf, readCall, redrivePolicy, selectedRun } from './support/common.js';
import { goalControlled } from './support/control.js';

afterEach(cleanupScenarios);

// S8: `ask` written out; `restart()` without `automation` keeps the last written setting.
const ASK: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'ask' };
const GOAL_B: GoalRef = { aggregateType: 'Goal', projectId: AG2B_SCOPE.projectId, goalId: 'rsr-r2-goal-b' };

async function driverRead(h: HostScenario, goalRef: GoalRef = AG2B_GOAL_REF): Promise<unknown> {
  return (await h.answer('workflow/driver-read', plain(AG2B_SCOPE, { goalRef })))['status'];
}

/** The Run ids of Goal A's work Task, through `executions/list` (M2 step 6: "A 的 Run 数不变"). */
async function runIdsOfA(h: HostScenario): Promise<string[]> {
  const read = await h.post<ReadResult<TaskExecutionPage>>('executions/list', plain(AG2B_SCOPE,
    { goalRef: AG2B_GOAL_REF, taskId: AG2B_WORK_TASK_ID, page: { afterCursor: null, limit: 10 } }));
  return readReady(read, 'executions/list').items.map(item => item.run.ref.runId).sort();
}

/** The Goal's restart interruption cause on `goals/display`, or undefined. */
function interruptionOf(display: GoalDisplayRead['display']): unknown {
  return display.causes.find(cause => cause.code === 'interrupted_pending_resume');
}

/** `goals/control` of Goal B at its read revision; B has no Plan, so its GoalPhase was never recorded (0). */
async function controlB(h: HostScenario, control: 'pause' | 'resume', requestId: string): Promise<void> {
  const { revision } = await readGoal(h.host, GOAL_B);
  expect(await h.answer('goals/control', graphWrite(AG2B_SCOPE, { goalRef: GOAL_B, control, reason: `RSR R2 ${control}` },
    requestId, [{ ref: GOAL_B, revision },
      { ref: { aggregateType: 'GoalPhase', projectId: GOAL_B.projectId, goalId: GOAL_B.goalId }, revision: 0 }])))
    .toMatchObject({ status: 'committed' });
}

it.each([['ask', ASK], ['off', redrivePolicy(false)]] as const)(
  'R1 (%s): a Goal paused across the restart goes on by itself after the person resumes it, in the paused Run\'s Session, to COMPLETED',
  async (_tier, automation) => {
    let h: HostScenario | undefined;
    // The pause lands at the safe point of the work Run's first reply (the E36B / 2C-23 (2) world).
    const scenario = await openHostScenario({ automation: NO_REDRIVE, check: 'pass', script: {
      replies: [readCall('rsr-r1-paused'), { kind: 'text', text: 'RSR R1: the continuation answers' }],
      duringReply: async (index) => {
        if (index === 0 && h !== undefined) await goalControlled(h.host, 'pause', 'rsr-r1-pause');
      } } });
    h = scenario;
    expect((await scenario.advance(scenario.select('rsr-r1-run'))).state).toBe('waiting');
    const pausedRef = await selectedRun(scenario);
    const pausedSession = (await readExecution(scenario.host, pausedRef)).session.ref.sessionId;

    const report = await scenario.restart({ crash: true, automation });
    expect(report.report?.fanOut).toContainEqual(expect.objectContaining({ goalId: AG2B_GOAL_REF.goalId, control: 'pause' }));
    expect(await driverRead(scenario), 'S2: the restart registered no wait for this Goal').toBe('not_found');
    await goalControlled(scenario.host, 'resume', 'rsr-r1-resume');

    await waitFor(() => driverRead(scenario), status => status === 'ready', 'the goal loop after the resume');
    await expect.poll(async () => (await scenario.goalDisplay()).phase, { timeout: 60_000, interval: 100 }).toBe('COMPLETED');
    const continuedRef = await selectedRun(scenario);
    expect(continuedRef.runId, 'a second Run of the Task').not.toBe(pausedRef.runId);
    expect((await readExecution(scenario.host, continuedRef)).session.ref.sessionId).toBe(pausedSession);
    expect(await briefOf(scenario.host, continuedRef)).toMatchObject({
      brief: { mode: 'resume_after_interruption', trigger: { goalResume: true } } });
  }, 180_000);

it('R2: a Goal paused at start that an earlier start left interrupted still waits for the person after the resume; the person\'s start continues it', async () => {
  const h = await openHostScenario({ automation: ASK, check: 'pass', script: {
    replies: [readCall('rsr-r2-held'), { kind: 'text', text: 'RSR R2: the Run the person started answers' }] } });
  expect(await h.answer('goals/create', graphWrite(AG2B_SCOPE, { goalId: GOAL_B.goalId, workspace: AG2B_SCOPE,
    objective: 'RSR R2 witness' }, 'rsr-r2-create-b', [{ ref: AG2B_PROJECT_REF, revision: 1 },
    { ref: AG2B_WORKSPACE_REF, revision: 1 }]))).toMatchObject({ status: 'committed' });

  // 1. A's work Run is in its Turn when the Host crashes: the ask start records A's interruption (revision 1).
  const held = h.holdReply(0);
  const toStart = await h.advance(h.select('rsr-r2-a'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const crashedRef = await selectedRun(h);
  await h.restart({ crash: true });
  const recorded = interruptionOf(await h.goalDisplay());
  expect(recorded).toMatchObject({ source: 'host_restart', interruption: { revision: 1 } });

  // 2.–4. Both Goals paused across a restart, then A resumed before B.
  await goalControlled(h.host, 'pause', 'rsr-r2-pause-a');
  await controlB(h, 'pause', 'rsr-r2-pause-b');
  const report = await h.restart({ crash: true });
  expect(report.report?.fanOut).toEqual(expect.arrayContaining([
    expect.objectContaining({ goalId: AG2B_GOAL_REF.goalId, control: 'pause' }),
    expect.objectContaining({ goalId: GOAL_B.goalId, control: 'pause' })]));
  const runsBefore = await runIdsOfA(h);
  await goalControlled(h.host, 'resume', 'rsr-r2-resume-a');
  await controlB(h, 'resume', 'rsr-r2-resume-b');

  // 5. The barrier: B's loop.
  await waitFor(() => driverRead(h, GOAL_B), status => status === 'ready', 'the witness Goal B\'s loop');
  // 6. A is still held: no driver, the same first interruption record, no new Run.
  expect(await driverRead(h)).toBe('not_found');
  expect(interruptionOf(await h.goalDisplay())).toEqual(recorded);
  expect(await runIdsOfA(h), 'A has no new Run').toEqual(runsBefore);

  // 7. The person starts A: the interruption is resolved and A's work goes on in a new Run.
  expect(await h.post('workflow/driver-start', plain(AG2B_SCOPE, { advance: h.select('rsr-r2-person-start'),
    queryProfileIds: [] }))).toMatchObject({ status: 'ready' });
  expect(interruptionOf(await h.goalDisplay())).toBeUndefined();
  await waitFor(() => selectedRun(h), run => run.runId !== crashedRef.runId, 'A\'s new Run');
}, 240_000);
