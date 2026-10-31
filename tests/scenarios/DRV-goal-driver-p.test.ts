/** DRV §5.1 P/T/I over the real Host: a task-only driver wakes on the real reply (D-T), a held `perform:start` advances once (D-P3), and a real requeue resumes an interruption (D-I). */
// Named mutations: D-T let a watch end run the Goal-scope decision (B gets a Run); D-P3 let `wake` start a loop for a
// not-waiting watch (the held `perform:start` advances again, `starts` becomes 2); D-I call `onStarted` only on the
// first start (the pending GoalInterruption remains).

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { TaskGraph } from '../../src/core/work-graph/model/plan-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { driverRead, openDrvWorld, parkedOnBasis, runsOf, startGoalDriver, startTaskDriver, waitDriver } from '../helpers/DRV-fixture.js';
import { ready, sameRun, sessionOf } from '../helpers/S7A-fixture.js';
import { answerS7BWait, sendS7BWaitingInquiry } from '../helpers/S7B-fixture.js';
import { taskRowOf } from './harness.js';

// A4: one real in-memory records backend and one real body store, shared by every Host start of a row; the
// backend's `close` leaves it open, so `reopen({ sharedMemoryStore: true })` restarts the same store on the
// same directory (the seam `tests/app/S7A-host-gates.test.ts` and `tests/helpers/S7B2-secretary-rounds.ts:77`
// use). Each row resets it, so no row sees another row's records.
const shared = vi.hoisted(() => ({ backend: undefined as unknown, bodies: undefined as unknown }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    if (shared.backend === undefined) {
      shared.backend = { ...actual.createInMemoryRecordBackend(options), close: async () => undefined };
    }
    return shared.backend;
  } };
});
vi.mock('../../src/core/record-store/body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  return { ...actual, RawArtifactBodyStore: class SharedRawArtifactBodyStore {
    constructor() {
      shared.bodies ??= new actual.RawArtifactBodyStore();
      return shared.bodies as never;
    }
  } as never };
});

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  shared.backend = undefined;
  shared.bodies = undefined;
});

describe('DRV §5.1 P/T/I rows (memory)', () => {
  it('D-T a task-only driver wakes on the real reply and starts A; the spare Task B stays without a Run', async () => {
    const { world, main, goal, tasks } = await openDrvWorld('drv-t',
      ['drv-t-send', 'drv-t-spare', 'drv-t-reply'], 'DRV D-T task-only driver');
    worlds.push(world);
    const sendLine = await createS6BLine(main, { label: 'drv-t-send', role: S6A_WORK_ROLE, tasks: [tasks[0]!] });
    // B is able to start (it has its own open responsible line) but no
    // Goal-scope driver runs, so a task-only driver must not start it.
    await createS6BLine(main, { label: 'drv-t-spare', role: S6A_WORK_ROLE, tasks: [tasks[1]!] });
    const replyLine = await createS6BLine(main, { label: 'drv-t-reply', role: S6A_WORK_ROLE });
    const sender = await sessionOf(world, sendLine);
    const recipient = await sessionOf(world, replyLine);
    const message = await sendS7BWaitingInquiry(world, { goal, session: sender, taskId: tasks[0]!.taskId,
      label: 'drv-t', body: { recipient: recipient.ref, text: 'DRV D-T inquiry', intent: 'inquiry',
        needsReply: true, waitAfterSend: true } });
    const sendRow = await taskRowOf((await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal })))
      .body as ReadResult<TaskGraph>, tasks[0]!.taskId);
    const yieldedRun = sendRow.execution;
    if (yieldedRun === null) throw new Error('DRV D-T: the sender Task has no yielded Run');

    // The Host route with the explicit taskId; not the fixture's own driver.
    await startTaskDriver(world, goal, tasks[0]!.taskId, 'drv-t');
    const parked = await waitDriver(world, goal, tasks[0]!.taskId,
      snapshot => snapshot.state === 'waiting_for_reply', 'D-T the task watch to park on the reply wait');
    expect((parked.last as { value: { state: string } }).value.state).toBe('waiting');
    expect(await runsOf(world, goal, tasks[0]!.taskId)).toHaveLength(1);

    // The real reply runs on the reply Task; its SessionMessage commit reaches
    // the Host's own goal_waits queue (no manual wake).
    await answerS7BWait(world, { goal, recipient, message: message.ref, task: tasks[2]!, label: 'drv-t' });
    await expect.poll(async () => (await runsOf(world, goal, tasks[0]!.taskId))
      .filter(record => record.run.status !== 'starting' && !sameRun(record.run.ref, yieldedRun)).length,
    { timeout: 30_000, interval: 50 }).toBe(1);
    const successor = (await runsOf(world, goal, tasks[0]!.taskId))
      .find(record => !sameRun(record.run.ref, yieldedRun));
    if (successor === undefined) throw new Error('D-T: the successor Run is missing');
    expect(successor.run.status).not.toBe('starting');
    expect(successor.run.task).toEqual(tasks[0]!);
    if (successor.run.previousRun === null || successor.run.previousRun === undefined) {
      throw new Error('D-T: the successor Run has no previousRun');
    }
    expect(sameRun(successor.run.previousRun, yieldedRun)).toBe(true);

    // A continues to its own end, and its watch parks (hands the task back)
    // before B is judged: a Goal-scope decision started only when the watch
    // ended would already have opened B by now.
    await expect.poll(async () => (await runsOf(world, goal, tasks[0]!.taskId))
      .find(record => !sameRun(record.run.ref, yieldedRun))?.run.status,
    { timeout: 30_000, interval: 50 }).toBe('ended');
    await waitDriver(world, goal, tasks[0]!.taskId,
      snapshot => snapshot.state !== 'running', 'D-T the task watch to finish after A');

    // B is ready but has no Run and no watch.
    expect(await runsOf(world, goal, tasks[1]!.taskId)).toEqual([]);
    expect((await driverRead(world, goal, tasks[1]!.taskId)).status).toBe('not_found');
    const goalRead = await driverRead(world, goal);
    expect(goalRead.status).toBe('ready');
    if (goalRead.status !== 'ready') throw new Error('D-T: the Goal snapshot is not readable');
    expect(goalRead.value.siblings.some(sibling => sibling.taskId === tasks[1]!.taskId)).toBe(false);
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal, taskId: tasks[0]!.taskId }));
  }, 120_000);

  it('D-P3 one wake on a held perform:start does not advance the same input twice', async () => {
    const { world, main, goal, tasks } = await openDrvWorld('drv-p3',
      ['drv-p3-send', 'drv-p3-reply'], 'DRV D-P3 model gate');
    worlds.push(world);
    const sendLine = await createS6BLine(main, { label: 'drv-p3-send', role: S6A_WORK_ROLE, tasks: [tasks[0]!] });
    const replyLine = await createS6BLine(main, { label: 'drv-p3-reply', role: S6A_WORK_ROLE, tasks: [tasks[1]!] });
    const sender = await sessionOf(world, sendLine);
    const recipient = await sessionOf(world, replyLine);
    const message = await sendS7BWaitingInquiry(world, { goal, session: sender, taskId: tasks[0]!.taskId,
      label: 'drv-p3', body: { recipient: recipient.ref, text: 'DRV D-P3 inquiry', intent: 'inquiry',
        needsReply: true, waitAfterSend: true } });
    expect(message.ref.messageId.length).toBeGreaterThan(0);
    await world.scripted.script(recipient, [{ kind: 'text', text: 'DRV D-P3 reply line done' }]);

    // The probe's own counting point: the same `perform:start` input must be
    // handed to `advanceWork` once, however many times a wake arrives.
    const workflow = world.platform.workflow;
    const realAdvance = workflow.advanceWork.bind(workflow);
    const counts = { advances: 0, starts: 0 };
    workflow.advanceWork = async (ctx, input, internal) => {
      counts.advances += 1;
      if (input.kind === 'perform' && (input.operation as { kind?: string }).kind === 'start') counts.starts += 1;
      return await realAdvance(ctx, input, internal);
    };

    const gate = await world.gates.modelRequest(recipient);
    await startGoalDriver(world, goal, 'drv-p3');
    await gate.reached;
    // The watch holds the one start; the Goal has parked on the sender's
    // registered reply wait (its basis names the real SessionMessage commit).
    await waitDriver(world, goal, undefined, parkedOnBasis, 'D-P3 the Goal to register its wait');
    expect(counts.starts).toBe(1);
    expect(await runsOf(world, goal, tasks[0]!.taskId)).toHaveLength(1);
    expect(await runsOf(world, goal, tasks[1]!.taskId)).toHaveLength(1);

    // A real person message commits SessionMessage; the Host's goal_waits
    // queue drains it to `wake`, so no manual `driver.wake`.
    const before = counts.advances;
    const wake = await world.post('messages/send', graphWrite(S6A_SCOPE, { recipient: sender.ref,
      text: 'DRV D-P3 wake commit', intent: 'notify' }, 'drv-p3-wake'));
    expect(wake.body).toMatchObject({ status: 'committed' });
    await expect.poll(async () => counts.advances, { timeout: 30_000, interval: 50 }).toBeGreaterThan(before);
    expect(counts.starts).toBe(1);
    expect(await runsOf(world, goal, tasks[1]!.taskId)).toHaveLength(1);

    gate.release();
    await expect.poll(async () => (await runsOf(world, goal, tasks[1]!.taskId))[0]?.run.status,
      { timeout: 30_000, interval: 50 }).toBe('ended');
    expect(await world.scripted.requests(recipient)).toHaveLength(1);
    expect(counts.starts).toBe(1);
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal }));
  }, 120_000);

  it('D-I a requeue then a new-seed Goal-scope start clears the interruption and runs the second Run', async () => {
    const TASK = 'drv-i-task';
    const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, main, world.goals);
    const goal = (await main.createGoal('drv-i-goal', 'DRV D-I model service interruption')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 'drv-i', taskIds: [TASK],
      role: S6A_WORK_ROLE.templateId });
    await createS6BLine(main, { label: 'drv-i-line', role: S6A_WORK_ROLE, tasks });

    // A real Host restart on the same memory store: the start-up reconcile sees the Goal's
    // unfinished required Task and records the pending GoalInterruption through its production
    // owner (`src/app/startup-reconcile.ts:625`), the record `onStarted` later resolves.
    await world.reopen({ sharedMemoryStore: true });
    const afterRestart = ready<{ display: { causes: Array<{ code: string }> } }>(
      (await world.post('goals/display', plain(S6A_SCOPE, { goalRef: goal }))).body as
        ReadResult<{ display: { causes: Array<{ code: string }> } }>, 'goals/display');
    expect(afterRestart.display.causes).toContainEqual(expect.objectContaining({
      code: 'interrupted_pending_resume' }));

    world.scriptReplies([{ kind: 'error', code: 'provider_unavailable' }]);
    // The explicit Task start does not call onStarted; only the task watch runs.
    await startTaskDriver(world, goal, TASK, 'drv-i');
    await waitDriver(world, goal, TASK, snapshot => snapshot.state !== 'running',
      'D-I the interrupted task watch to settle');
    const failed = await runsOf(world, goal, TASK);
    expect(failed).toHaveLength(1);
    const failedRun = failed[0]!.run.ref;
    const after = await taskRowOf((await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal })))
      .body as ReadResult<TaskGraph>, TASK);
    expect(after.failure?.failureClass).toBe('interrupted');
    expect(after.failure?.automation.verdict).toMatchObject({ kind: 'stopped',
      reason: 'interrupted_pending_resume' });

    // The person's real requeue, exactly as SMK3B-model-service.test.ts writes it.
    const goalRead = ready<{ goal: { revision: number } }>(
      (await world.post('goals/read', plain(S6A_SCOPE, goal))).body as ReadResult<{ goal: { revision: number } }>,
      'goals/read');
    const runRead = ready<{ run: { revision: number } }>(
      (await world.post('executions/read', plain(S6A_SCOPE, failedRun))).body as
        ReadResult<{ run: { revision: number } }>, 'executions/read');
    expect((await world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
      taskRef: tasks[0], afterRunRef: failedRun,
      reason: 'the operator continues after the model-service interruption',
    }, 'drv-i-requeue', [
      { ref: goal, revision: goalRead.goal.revision }, { ref: failedRun, revision: runRead.run.revision },
    ]))).body).toMatchObject({ status: 'committed' });

    world.scriptReplies([{ kind: 'text', text: 'DRV D-I continued after the operator requeue' }]);
    // A different seed, no taskId: the Goal-scope start that calls onStarted.
    await startGoalDriver(world, goal, 'drv-i-continue');
    // DRV-04 (W4): the Task's start came first, so the public Goal read still
    // returns that Task's snapshot; the container entered the order later.
    expect(await driverRead(world, goal)).toMatchObject({ status: 'ready', value: { taskId: TASK, siblings: [] } });
    await expect.poll(async () => (await runsOf(world, goal, TASK))
      .filter(record => record.run.status !== 'starting').length,
    { timeout: 30_000, interval: 50 }).toBe(2);
    const continued = (await runsOf(world, goal, TASK)).find(record => !sameRun(record.run.ref, failedRun));
    if (continued === undefined) throw new Error('D-I: the continued Run is missing');
    expect(sameRun(continued.run.ref, failedRun)).toBe(false);

    // The interruption cause is gone from the Goal display.
    await expect.poll(async () => {
      const display = ready<{ display: { causes: Array<{ code: string }> } }>(
        (await world.post('goals/display', plain(S6A_SCOPE, { goalRef: goal }))).body as
          ReadResult<{ display: { causes: Array<{ code: string }> } }>, 'goals/display').display;
      return display.causes.some(cause => cause.code === 'interrupted_pending_resume');
    }, { timeout: 30_000, interval: 50 }).toBe(false);
    expect((await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal }))).body)
      .toMatchObject({ status: 'ready', value: { taskId: TASK } });
  }, 240_000);
});
