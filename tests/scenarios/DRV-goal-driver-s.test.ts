/** DRV §5.1 D-P5: a stop during a held continuation claim waits for the decision loop, stays `busy` until the claim answer and drain, and accepts a fresh seed only after `stopped`. */
// Named mutation: delete the `driver.done` item from `stopDriver`'s drain → the drain never submits the cancel for the claimed Run; the row reds at the held drain cancel.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CollaborationChange, CollaborationDriver } from '../../src/app/collaboration-driver.js';
import { createGoalWaitWakes, type GoalWaitWakes } from '../../src/app/goal-wait-wakes.js';
import type { TaskExecutionPage } from '../../src/app/core-http-types.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskGraph } from '../../src/core/work-graph/model/plan-contracts.js';
import type { RunControlPort } from '../../src/core/work-graph/tasks/control-contracts.js';
import { deferred } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready, sameRun } from '../helpers/S7A-fixture.js';
import { limitHold } from '../helpers/hold-limit.js';
import { buildDrvDriver, parkedOnBasis, portDriverRead, waitPortDriver } from '../helpers/DRV-fixture.js';
import { openS7BWorld, runS7BWait } from '../helpers/S7B-fixture.js';

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

/** A Goal-scope start: the one accepted driver at the Goal level, `taskId` absent. */
const startGoal = (driver: CollaborationDriver, ctx: Ctx, goal: GoalRef, flowId: string) =>
  driver.start(ctx, { advance: { schemaVersion: 1, goalRef: goal, flowId, sessionHint: null,
    kind: 'select_work' }, queryProfileIds: [] });

describe('DRV goal driver stop rows (memory)', () => {
  it('D-P5 a stop during a held continuation claim stays busy until the claim answer returns', async () => {
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const parked = await runS7BWait(world, { label: 'drv-p5' });
    const ctx = world.humanContext();
    const cursor = ready<TaskGraph>(await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: parked.goal })),
      'D-P5 TaskGraph').sourceCursor;
    // The reply Run's two model requests are held in order: the answer card's
    // turn, then the turn that would end the Run. Holding the second keeps the
    // reply watch active and the answer a real commit of that Run.
    const answerTurn = await world.gates.modelRequest(parked.recipient);
    const endTurn = await world.gates.modelRequest(parked.recipient);
    await world.scripted.script(parked.recipient, [
      { kind: 'calls', calls: [{ callId: 'drv-p5-answer', name: 'respond_session_message',
        args: { messageRef: parked.message, expectedRevision: 1, text: 'DRV D-P5 reply' } }] },
      { kind: 'text', text: 'DRV D-P5 reply saved' },
    ]);
    // The drain's cancel of the Run its claim receipt named is held; the reply
    // watch's own cancel still passes. Reaching the held cancel proves the
    // decision loop already finished and recorded that receipt, and keeps the
    // stop-drain window open.
    let replyRun: RunRef | null = null;
    const cancelReached = deferred<void>();
    const cancelRelease = deferred<void>();
    const controls: RunControlPort = {
      readControl: (readCtx, input) => world.platform.controls.readControl(readCtx, input),
      async submitControl(submitCtx, request) {
        if (replyRun !== null && !sameRun(request.input.runRef, replyRun)) {
          cancelReached.resolve();
          await cancelRelease.promise;
        }
        return await world.platform.controls.submitControl(submitCtx, request);
      },
    };
    // DRV-01: the loop's own final change notice runs after it read `recheck`
    // and before `deciding` is cleared. A real wake queued in that exact
    // microtask gap must still start the next pass; without the finally kick
    // `kickDriver` sees the old decision and the wake is lost.
    const workflow = world.platform.workflow;
    const realAdvance = workflow.advanceWork.bind(world.platform.workflow);
    let advances = 0; let advanceSettled = false; let armed = false; let wakeQueued = false;
    let wakeGoal: GoalRef = parked.goal;
    workflow.advanceWork = async (advanceCtx, input, internal) => {
      advanceSettled = false;
      const result = await realAdvance(advanceCtx, input, internal);
      advances += 1;
      advanceSettled = true;
      return result;
    };
    const driver = buildDrvDriver(world, createGoalWaitWakes(), () => cursor,
      { controls, onChange: () => {
      if (!armed || !advanceSettled || wakeQueued) return;
      wakeQueued = true;
      queueMicrotask(() => { void driver.wake(ctx, wakeGoal); });
    } });

    // The Goal's own accepted start; its decision loop parks on the sender's
    // registered BW reply wait while the reply Task's own Run is opened.
    expect(await startGoal(driver, ctx, parked.goal, 'drv-p5-1'))
      .toMatchObject({ status: 'ready', value: { state: 'running', taskId: null } });
    await limitHold(answerTurn.reached, 'D-P5 the reply answer turn');
    replyRun = ready<TaskExecutionPage>(await world.post('executions/list', plain(S6A_SCOPE,
      { goalRef: parked.goal, taskId: parked.tasks[1]!.taskId, page: { afterCursor: null, limit: 10 } })),
    'D-P5 the reply Run').items[0]!.run.ref;
    // The driver registered the sender's real reply basis; the reply Task's own
    // watch is still running, so the Goal projection stays `running`.
    await waitPortDriver(driver, ctx, parked.goal, undefined, parkedOnBasis,
      'D-P5 the Goal driver to register the BW reply basis');
    answerTurn.release();
    await expect.poll(async () => ready<{ status: string }>(await world.post('messages/read',
      plain(S6A_SCOPE, parked.message)), 'the D-P5 wait read').status,
    { timeout: 30_000, interval: 50 }).toBe('responded');
    // The reply Run is held on its final turn, so the answer commit did not kick
    // the parked decision loop; the REAL wake starts the pass that claims the
    // sender's continuation, and that commit's answer is held.
    await limitHold(endTurn.reached, 'D-P5 the reply Run end turn');
    const hold = commitBarrier.holdAfter(byIdentityPrefix('claim-continuation:'), 'D-P5 the continuation claim');
    await driver.wake(ctx, parked.goal);
    await limitHold(hold.reached, 'D-P5 the continuation claim');

    // The reply Run's own end turn now returns and its watch finishes, so the
    // stop below drains only the claim the wake is holding.
    endTurn.release();
    await waitPortDriver(driver, ctx, parked.goal, undefined,
      snapshot => snapshot.siblings.every(sibling => sibling.state !== 'running'
        && sibling.state !== 'waiting_for_reply' && sibling.state !== 'stopping'),
      'D-P5 the reply watch to finish');

    expect(ready(await driver.stop(ctx, { goalRef: parked.goal }), 'the D-P5 stop'))
      .toMatchObject({ state: 'stopping' });
    // The decision loop's claim receipt is not recorded yet: `stopped` may not
    // appear while its answer is still held.
    expect((await portDriverRead(driver, ctx, parked.goal)).state).toBe('stopping');
    // The different seed cannot begin while the loop is still claiming.
    expect(await startGoal(driver, ctx, parked.goal, 'drv-p5-2'))
      .toMatchObject({ status: 'rejected', code: 'busy' });

    hold.release();
    // The loop records its claim receipt and ends; the drain is now cancelling
    // the Run that receipt claimed, with `deciding` already null.
    await limitHold(cancelReached.promise, 'D-P5 the held drain cancel');
    const held = await portDriverRead(driver, ctx, parked.goal);
    expect(held.state).toBe('stopping');
    expect(held.last).toMatchObject({ status: 'ready', value: { receipt: { kind: 'claim_task' } } });

    // DRV-03: a new Goal seed is busy for the rest of the stop-drain window.
    expect(await startGoal(driver, ctx, parked.goal, 'drv-p5-3'))
      .toMatchObject({ status: 'rejected', code: 'busy' });

    // §4.1: a Task start is busy in the same drain window. Its watch
    // seed differs and its lane is no longer busy, so the parent's `stopping`
    // state is the only thing that may refuse it.
    const taskId = parked.tasks[1]!.taskId;
    const startTask = (flowId: string) => driver.start(ctx, { advance: {
      schemaVersion: 1, goalRef: parked.goal, flowId, sessionHint: null, kind: 'select_work', taskId },
    queryProfileIds: [] });
    expect(await startTask('drv-p5-task-held'))
      .toMatchObject({ status: 'rejected', code: 'busy' });

    cancelRelease.resolve();
    expect((await waitPortDriver(driver, ctx, parked.goal, undefined,
      snapshot => snapshot.state === 'stopped', 'D-P5 the stopped driver')).state).toBe('stopped');

    // §4.1: after `stopped` the Task start is accepted, and the next
    // Goal stop must take this new Lane — the finished drain missed it.
    expect(ready(await startTask('drv-p5-task'), 'the D-P5 Task start')).toMatchObject({ state: 'running' });
    expect(ready(await driver.stop(ctx, { goalRef: parked.goal }), 'the D-P5 Task stop'))
      .toMatchObject({ state: 'stopping' });
    expect((await waitPortDriver(driver, ctx, parked.goal, taskId, snapshot => snapshot.state === 'stopped',
      'D-P5 the new Lane to stop')).state).toBe('stopped');

    // A fresh seed is accepted after the stop has finished.
    expect(ready(await startGoal(driver, ctx, parked.goal, 'drv-p5-4'), 'the D-P5 fresh start'))
      .toMatchObject({ state: 'running' });
    // DRV-01: a Goal with no plan work makes exactly one Workflow read. Its
    // decision queues one real wake from its own final change notice, i.e. after
    // that read and the last `recheck` check, but before `deciding` clears. The
    // accepted driver must run another pass, not drop that wake.
    const empty = (await s6aCardsWorkspace(world, S6A_SCOPE)
      .createGoal('drv-p5-empty', 'DRV D-P5 empty Goal')).ref;
    wakeGoal = empty;
    armed = true; wakeQueued = false; advanceSettled = false;
    const beforeWake = advances;
    expect(ready(await startGoal(driver, ctx, empty, 'drv-p5-empty-1'), 'the D-P5 empty start'))
      .toMatchObject({ state: 'running' });
    await expect.poll(() => advances, { timeout: 30_000, interval: 25 }).toBeGreaterThan(beforeWake + 1);
    workflow.advanceWork = realAdvance;
    await driver.stop(ctx, { goalRef: empty });
    await driver.stop(ctx, { goalRef: parked.goal });
  }, 120_000);
});
