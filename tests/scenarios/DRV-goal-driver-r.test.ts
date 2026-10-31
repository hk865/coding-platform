/** DRV §5.1 D-P4/D-P6 over the world's real platform ports: a held `prepare` must not hold the queue's `drain`; after a failed execution read a new seed is not busy, advances, and stops; a Lane that fails under an accepted Goal asks for another selection (§3.2). */
// Named mutations: D-P4 let `wake` await the decision it kicked → `drain` stays pending while `prepare` is held;
// D-P6 drop the exception exit's `failed` mark → the parked watch keeps the Task occupied and the new seed is `busy`;
// D-P6 Lane delete the `lane.state === 'failed'` recheck in `runLane`'s finally → the Goal never selects A again and its `last.waitBasis` never names `wait_reply`.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CollaborationDriver } from '../../src/app/collaboration-driver.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskGraph } from '../../src/core/work-graph/model/plan-contracts.js';
import { createGoalWaitQueue, createGoalWaitWakes } from '../../src/app/goal-wait-wakes.js';
import { deferred } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { limitHold } from '../helpers/hold-limit.js';
import {
  buildDrvDriver, driverRead, parkedOnBasis, portDriverRead, runsOf, startGoalDriver, waitDriver, waitPortDriver,
} from '../helpers/DRV-fixture.js';
import { ready, sameRun, sessionOf } from '../helpers/S7A-fixture.js';
import { answerS7BWait, listed, openS7BWorld, runS7BWait } from '../helpers/S7B-fixture.js';

// The commit barrier wraps both real backends for this file (see S6A-commit-barrier.ts).
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

type World = Awaited<ReturnType<typeof openS7BWorld>>['world'];
type Ctx = Parameters<CollaborationDriver['read']>[0];

const worlds: World[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  expect(left).toEqual([]);
});

/** One Goal with a send line and a receive line; the send line's one Task is the caller's. */
async function goalLines(world: World, label: string) {
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const goal = (await main.createGoal(`${label}-goal`, `DRV ${label}`)).ref;
  const { tasks } = await adoptS6BPlan(main, goal, { label,
    taskIds: [`${label}-send`, `${label}-reply`], role: S6A_WORK_ROLE.templateId });
  const sendLine = await createS6BLine(main, { label: `${label}-send`, role: S6A_WORK_ROLE, tasks: [tasks[0]!] });
  const replyLine = await createS6BLine(main, { label: `${label}-reply`, role: S6A_WORK_ROLE });
  const sender = await sessionOf(world, sendLine);
  const recipient = await sessionOf(world, replyLine);
  return { goal, tasks, sender, recipient };
}

/** The same real inquiry body, but the task-only driver itself drives the Run to its yield. */
async function scriptInquiry(world: World, lines: Awaited<ReturnType<typeof goalLines>>, label: string): Promise<void> {
  await world.scripted.script(lines.sender, [
    { kind: 'calls', calls: [{ callId: `${label}-send`, name: 'send_session_message',
      args: { recipient: lines.recipient.ref, text: `DRV ${label} inquiry`, intent: 'inquiry',
        needsReply: true, waitAfterSend: true } }] },
    { kind: 'text', text: `DRV ${label} continuation done` },
  ]);
}

const startTask = async (driver: CollaborationDriver, ctx: Ctx, goal: GoalRef, taskId: string,
  sessionHint: SessionRef, flowId: string): Promise<void> => {
  expect(await driver.start(ctx, { advance: { schemaVersion: 1, goalRef: goal, flowId,
    sessionHint, kind: 'select_work', taskId }, queryProfileIds: [] })).toMatchObject({ status: 'ready' });
};

describe('DRV goal driver queue and failure rows (memory)', () => {
  it('D-P4 drain returns while the first Goal prepare advance is held and the other Goal is woken', async () => {
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const first = await runS7BWait(world, { label: 'drv-p4-a' });
    const other = await runS7BWait(world, { label: 'drv-p4-b' });
    const ctx = world.humanContext();
    const cursor = ready<TaskGraph>(await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: first.goal })),
      'D-P4 TaskGraph').sourceCursor;
    const waits = createGoalWaitWakes();
    const driverA = buildDrvDriver(world, waits, () => cursor);
    const driverB = buildDrvDriver(world, waits, () => cursor);
    const taskA = first.tasks[0]!.taskId; const taskB = other.tasks[0]!.taskId;
    await startTask(driverA, ctx, first.goal, taskA, first.sender.ref, 'drv-p4-a-1');
    await startTask(driverB, ctx, other.goal, taskB, other.sender.ref, 'drv-p4-b-1');
    await waitPortDriver(driverA, ctx, first.goal, taskA,
      snapshot => snapshot.state === 'waiting_for_reply', 'D-P4 Task A to park on its registered wait');
    await waitPortDriver(driverB, ctx, other.goal, taskB,
      snapshot => snapshot.state === 'waiting_for_reply', 'D-P4 Task B to park on its registered wait');

    // The real reply commits; the Goal's drive to its `prepare` successor is held.
    const yieldedRun = (await runsOf(world, first.goal, taskA))[0]!.run.ref;
    await answerS7BWait(world, { goal: first.goal, recipient: first.recipient, message: first.message,
      task: first.tasks[1]!, label: 'drv-p4-a' });
    const workflow = world.platform.workflow;
    const realAdvance = workflow.advanceWork.bind(workflow);
    const held = deferred<void>(); const release = deferred<void>();
    let prepareDone = false; let bAdvances = 0;
    workflow.advanceWork = async (advanceCtx, input, internal) => {
      if (input.kind === 'perform' && (input.operation as { kind?: string }).kind === 'prepare'
        && input.goalRef.goalId === first.goal.goalId) {
        held.resolve();
        await release.promise;
        const result = await realAdvance(advanceCtx, input, internal);
        prepareDone = true;
        return result;
      }
      if (input.goalRef.goalId === other.goal.goalId) bAdvances += 1;
      return await realAdvance(advanceCtx, input, internal);
    };
    const queue = createGoalWaitQueue({
      wake: async (_scope, goalRef) => {
        await (goalRef.goalId === first.goal.goalId ? driverA : driverB).wake(ctx, goalRef);
      },
      registries: { all: () => [{ scope: S6A_SCOPE, waits }] },
      rebuild: async () => { throw new Error('D-P4 marks its registrations with queueAll'); },
    });
    waits.queueAll();
    let drained = false;
    const bBefore = bAdvances;
    const drain = queue.drain(S6A_SCOPE, { maxItems: 10, continuation: null,
      signal: new AbortController().signal }).then(result => { drained = true; return result; });
    try {
      await limitHold(held.promise, 'D-P4 the held prepare advance');
      // (a) The drain must have returned while the advance is still held.
      await limitHold(drain, 'D-P4: drain waited for the held advance');
      expect(drained).toBe(true);
      expect(prepareDone).toBe(false);
      // (b) The other Goal's wake is still delivered during the hold.
      await expect.poll(() => bAdvances, { timeout: 30_000, interval: 25 }).toBeGreaterThan(bBefore);
      expect((await portDriverRead(driverB, ctx, other.goal, taskB)).state).toBe('waiting_for_reply');
    } finally {
      release.resolve();
    }
    // (c) Only now does the held advance run; its successor Run really enters.
    await expect.poll(() => prepareDone, { timeout: 30_000, interval: 25 }).toBe(true);
    await expect.poll(async () => (await runsOf(world, first.goal, taskA))
      .filter(record => !sameRun(record.run.ref, yieldedRun)).length,
    { timeout: 30_000, interval: 50 }).toBe(1);
    workflow.advanceWork = realAdvance;
    await driverA.stop(ctx, { goalRef: first.goal });
    await driverB.stop(ctx, { goalRef: other.goal });
    await waitPortDriver(driverA, ctx, first.goal, taskA,
      snapshot => snapshot.state === 'stopped', 'D-P4 Task A to stop');
  }, 120_000);

  /** One D-P6 entry: the advance checkpoint, the real new seed, and the wrapper's restore. */
  type P6Entry = {
    driver: CollaborationDriver; goal: GoalRef; taskId?: string;
    advances: () => number; startNewSeed: () => Promise<unknown>; restore: () => void;
  };
  /** Counts the world's real advances; `onOperation` arms an entry's own fault at its own step. */
  function countAdvances(world: World, onOperation?: (kind: string) => void) {
    const workflow = world.platform.workflow;
    const real = workflow.advanceWork.bind(workflow);
    let advances = 0;
    workflow.advanceWork = async (ctx, input, internal) => {
      const result = await real(ctx, input, internal);
      advances += 1;
      if (input.kind === 'perform') onOperation?.(input.operation.kind);
      return result;
    };
    return { count: () => advances, restore: () => { workflow.advanceWork = real; } };
  }

  const p6Entries: Array<{ name: string; park: (world: World, ctx: Ctx) => Promise<P6Entry> }> = [
    {
      name: 'Task',
      park: async (world, ctx) => {
        const parked = await goalLines(world, 'drv-p6');
        const taskId = parked.tasks[0]!.taskId;
        const cursor = ready<TaskGraph>(await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: parked.goal })),
          'D-P6 TaskGraph').sourceCursor;
        await scriptInquiry(world, parked, 'drv-p6');
        const driver = buildDrvDriver(world, createGoalWaitWakes(), () => cursor);
        // The task-only driver itself drives the real inquiry to its yielded wait.
        await startTask(driver, ctx, parked.goal, taskId, parked.sender.ref, 'drv-p6-1');
        await waitPortDriver(driver, ctx, parked.goal, taskId,
          snapshot => snapshot.state === 'waiting_for_reply', 'D-P6 the task watch to park on its inquiry');
        const yielded = (await runsOf(world, parked.goal, taskId))[0];
        if (yielded === undefined) throw new Error('D-P6: the yielded Run is missing');
        // The parked watch's next execution-record read fails once; the failed exception exit must release the Task.
        const fault = commitBarrier.failReads(canonicalKey(yielded.run.ref), 'throw-once');
        try {
          await expect.poll(() => fault.calls(), { timeout: 30_000, interval: 25 }).toBe(1);
          fault.release();
          await waitPortDriver(driver, ctx, parked.goal, taskId,
            snapshot => snapshot.state !== 'running', 'D-P6 the failed watch to leave its loop');
        } finally {
          fault.release();
        }
        const advances = countAdvances(world);
        return { driver, goal: parked.goal, taskId, advances: advances.count, restore: advances.restore,
          startNewSeed: () => driver.start(ctx, { advance: { schemaVersion: 1, goalRef: parked.goal,
            flowId: 'drv-p6-2', sessionHint: parked.sender.ref, kind: 'select_work', taskId }, queryProfileIds: [] }) };
      },
    },
    {
      name: 'Goal-observe',
      park: async (world, ctx) => {
        const goalOnly = await runS7BWait(world, { label: 'drv-p6-goal' });
        const taskId = goalOnly.tasks[0]!.taskId;
        const goalCursor = ready<TaskGraph>(await world.post('tasks/query',
          plain(S6A_SCOPE, { goalRef: goalOnly.goal })), 'D-P6 Goal TaskGraph').sourceCursor;
        const goalYielded = (await runsOf(world, goalOnly.goal, taskId))[0]!;
        // DRV-05: arm the failure only after the real `observe` advance returned, so the throwing read is
        // `awaitYielded`'s execution probe, not the observe step's own read.
        let failGoalEntryRead = false;
        const advances = countAdvances(world, kind => { if (kind === 'observe') failGoalEntryRead = true; });
        const executions = world.platform.executions;
        const realReadExecution = executions.readExecution.bind(executions);
        executions.readExecution = async (readCtx, runRef, options) => {
          if (failGoalEntryRead && sameRun(runRef, goalYielded.run.ref)) {
            throw new Error('D-P6 the Goal entry execution read failed');
          }
          return await realReadExecution(readCtx, runRef, options);
        };
        const goalDriver = buildDrvDriver(world, createGoalWaitWakes(), () => goalCursor);
        try {
          expect(await goalDriver.start(ctx, { advance: { schemaVersion: 1, goalRef: goalOnly.goal,
            flowId: 'drv-p6-goal-1', sessionHint: null, kind: 'perform',
            operation: { kind: 'observe', request: { runRef: goalYielded.run.ref } } }, queryProfileIds: [] }))
            .toMatchObject({ status: 'ready' });
          const failed = await waitPortDriver(goalDriver, ctx, goalOnly.goal, undefined,
            snapshot => snapshot.state === 'failed', 'D-P6 the Goal entry to record its failed exit');
          expect(failed.reason).toContain('D-P6 the Goal entry execution read failed');
        } finally {
          executions.readExecution = realReadExecution;
        }
        failGoalEntryRead = false;
        return { driver: goalDriver, goal: goalOnly.goal, advances: advances.count,
          restore: advances.restore, startNewSeed: () => goalDriver.start(ctx, { advance: { schemaVersion: 1,
            goalRef: goalOnly.goal, flowId: 'drv-p6-goal-2', sessionHint: goalOnly.sender.ref,
            kind: 'select_work' }, queryProfileIds: [] }) };
      },
    },
  ];

  it.each(p6Entries)('D-P6 $name entry: a new seed after a failed execution read is not busy, advances, and stops',
    async ({ name, park }) => {
      const { world } = await openS7BWorld({ backend: 'memory' });
      worlds.push(world);
      const ctx = world.humanContext();
      const entry = await park(world, ctx);
      try {
        const before = entry.advances();
        const second = await entry.startNewSeed();
        expect(second, `D-P6 the ${name} new seed: ${JSON.stringify(second)}`).not.toMatchObject({ code: 'busy' });
        expect(second).toMatchObject({ status: 'ready' });
        await expect.poll(() => entry.advances(), { timeout: 30_000, interval: 25 }).toBeGreaterThan(before);
        if (entry.taskId !== undefined) {
          await waitPortDriver(entry.driver, ctx, entry.goal, entry.taskId,
            snapshot => snapshot.state === 'waiting_for_reply', 'D-P6 the new seed to enter its real wait');
        }
        expect(await entry.driver.stop(ctx, entry.taskId === undefined ? { goalRef: entry.goal }
          : { goalRef: entry.goal, taskId: entry.taskId })).toMatchObject({ status: 'ready' });
        const stopped = await waitPortDriver(entry.driver, ctx, entry.goal, entry.taskId,
          snapshot => snapshot.state === 'stopped', 'D-P6 the stopped driver');
        expect(stopped.state).toBe('stopped');
      } finally {
        entry.restore();
      }
    }, 120_000);

  it('D-P6 a Lane failed under an accepted Goal: the Goal selects A again, so the real reply wakes it', async () => {
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const lines = await goalLines(world, 'drv-p6-lane');
    const { goal, sender, recipient } = lines;
    const taskA = lines.tasks[0]!.taskId;
    await scriptInquiry(world, lines, 'drv-p6-lane');
    // The Goal also starts the reply Task on the idle reply line; its model turn is held, so nothing answers early.
    const replying = await world.gates.modelRequest(recipient);
    try {
      await startGoalDriver(world, goal, 'drv-p6-lane');
      await waitDriver(world, goal, taskA, snapshot => snapshot.state === 'waiting_for_reply',
        'D-P6 the Lane to enter its yielded wait');
      await limitHold(replying.reached, 'D-P6 the held reply model request');
      const message = (await listed(world, 'outbox', sender))[0]!;
      await world.scripted.script(recipient, [
        { kind: 'calls', calls: [{ callId: 'drv-p6-lane-answer', name: 'respond_session_message',
          args: { messageRef: message.ref, expectedRevision: message.revision, text: 'DRV D-P6 Lane reply' } }] },
        { kind: 'text', text: 'DRV D-P6 Lane reply saved' },
      ]);
      // While A is active the Goal skips it, so its general wait basis has no reply wait in it.
      const general = await waitDriver(world, goal, undefined, parkedOnBasis, 'D-P6 the Goal general wait basis');
      expect(general.last).not.toMatchObject({ value: { waitBasis: {
        recordKinds: expect.arrayContaining(['SessionMessage']) } } });

      // The Lane's next execution read fails once; a later reader sees the real record.
      const yieldedRun = (await runsOf(world, goal, taskA))[0]!.run.ref;
      const executions = world.platform.executions;
      const realRead = executions.readExecution.bind(executions);
      let failNextRead = true;
      executions.readExecution = async (readCtx, runRef, options) => {
        if (failNextRead && sameRun(runRef, yieldedRun)) {
          failNextRead = false;
          throw new Error('D-P6 the Lane execution read failed');
        }
        return await realRead(readCtx, runRef, options);
      };
      const failed = await waitDriver(world, goal, taskA, snapshot => snapshot.state === 'failed',
        'D-P6 the Lane to record its failed exit');
      expect(failed.reason).toContain('D-P6 the Lane execution read failed');

      // Only a new selection of A returns the reply wait, which is what a later reply can wake.
      await expect.poll(async () => await driverRead(world, goal), { timeout: 30_000, interval: 50 })
        .toMatchObject({ status: 'ready', value: { last: { value: { waitBasis: {
          reasons: expect.arrayContaining(['wait_reply']),
          recordKinds: expect.arrayContaining(['SessionMessage']) } } } } });

      // The real reply reaches the Host's own goal_waits queue; A's successor really starts.
      replying.release();
      await expect.poll(async () => {
        const successor = (await runsOf(world, goal, taskA)).find(record => !sameRun(record.run.ref, yieldedRun));
        return successor !== undefined && successor.run.status !== 'starting';
      }, { timeout: 30_000, interval: 50 }).toBe(true);
    } finally {
      replying.release();
    }
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal }));
  }, 120_000);
});
