/** DRV §5.1 D-F1/D-F2/D-F3 over the real Host: independent Tasks enter before either reply; a reply ahead of the start wakes through the Host queue; the L46 answer and requeue commits wake the successor. */

import { afterEach, describe, expect, it } from 'vitest';
import type { TaskGraph } from '../../src/core/work-graph/model/plan-contracts.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { openDrvWorld, parkedOnBasis, runsOf, startGoalDriver, waitDriver } from '../helpers/DRV-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { ready, sameRun, sessionOf } from '../helpers/S7A-fixture.js';
import { limitHold } from '../helpers/hold-limit.js';
import { applyL46Card, openS7BL46World } from '../helpers/S7B-L46-fixture.js';
import { openS7B2BasisGoal } from '../helpers/S7B2-wake-basis.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

type WaitBasis = { recordKinds?: readonly string[]; reasons?: readonly string[] };

describe('DRV goal driver (memory)', () => {
  it('D-F1 two independent Tasks both enter their Runs before either model reply', async () => {
    const { world, main, goal, tasks } = await openDrvWorld('drv-f1',
      ['drv-f1-a', 'drv-f1-b'], 'DRV D-F1 two independent tasks');
    worlds.push(world);
    const lineA = await createS6BLine(main, { label: 'drv-f1-a', role: S6A_WORK_ROLE, tasks: [tasks[0]!] });
    const lineB = await createS6BLine(main, { label: 'drv-f1-b', role: S6A_WORK_ROLE, tasks: [tasks[1]!] });
    const sessionA = await sessionOf(world, lineA);
    const sessionB = await sessionOf(world, lineB);
    await world.scripted.script(sessionA, [{ kind: 'text', text: 'DRV D-F1 A done' }]);
    await world.scripted.script(sessionB, [{ kind: 'text', text: 'DRV D-F1 B done' }]);
    // Both holds are installed before the start: a sequential loop can only
    // ever reach A's, so the second `reached` never resolves (the Red proof).
    const gateA = await world.gates.modelRequest(sessionA);
    const gateB = await world.gates.modelRequest(sessionB);
    await startGoalDriver(world, goal, 'drv-f1');
    await gateA.reached;
    await gateB.reached;
    expect(await runsOf(world, goal, tasks[0]!.taskId)).toHaveLength(1);
    expect(await runsOf(world, goal, tasks[1]!.taskId)).toHaveLength(1);
    // Release B only: its Run ends while A's model request is still held.
    gateB.release();
    await expect.poll(async () => (await runsOf(world, goal, tasks[1]!.taskId))
      .some(record => record.run.status === 'ended'), { timeout: 30_000, interval: 50 }).toBe(true);
    expect((await runsOf(world, goal, tasks[0]!.taskId)).some(record => record.run.status === 'running'))
      .toBe(true);
    gateA.release();
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal }));
  }, 120_000);

  it('D-F2 a parked registered wait is woken by the real reply and starts its successor Run', async () => {
    const basis = await openS7B2BasisGoal({ backend: 'memory' });
    worlds.push(basis.world);
    // The reply Task is the other required work Task; the Goal-scope decision
    // starts its watch on the recipient line. Its own scripted Run answers the
    // saved wait, so the reply is a real Work reply (not a second link write).
    await basis.world.scripted.script(basis.recipient, [
      { kind: 'calls', calls: [{ callId: 'drv-f2-reply', name: 'respond_session_message',
        args: { messageRef: basis.message, expectedRevision: 1, text: 'DRV D-F2 reply' } }] },
      { kind: 'text', text: 'DRV D-F2 reply saved' },
    ]);
    // The replier's model turn is held BEFORE the Goal starts: the wait is
    // registered first, the real reply comes after, and nothing answers early.
    const replying = await basis.world.gates.modelRequest(basis.recipient);
    await startGoalDriver(basis.world, basis.goal, 'drv-f2');
    const parked = await waitDriver(basis.world, basis.goal, undefined, parkedOnBasis,
      'D-F2 the real last.waitBasis of the parked Goal');
    expect((parked.last as { value?: { waitBasis?: WaitBasis } } | null)?.value?.waitBasis)
      .toMatchObject({ reasons: expect.arrayContaining(['wait_reply']) });
    await limitHold(replying.reached, 'D-F2 the held reply model request');
    expect(ready<{ status: string }>(await basis.world.post('messages/read',
      plain(S6A_SCOPE, basis.message)), 'the D-F2 wait read').status).not.toBe('responded');

    replying.release();
    await expect.poll(async () => ready<{ status: string }>(await basis.world.post('messages/read',
      plain(S6A_SCOPE, basis.message)), 'the D-F2 wait read').status,
    { timeout: 30_000, interval: 50 }).toBe('responded');
    // The reply commit reaches the Host's own goal_waits queue; no manual wake.
    // The successor is STARTED (not merely claimed): the row reds here when the
    // wake's pass only parks the successor step in `current`.
    await expect.poll(async () => {
      const successor = (await runsOf(basis.world, basis.goal, basis.task.taskId))
        .find(record => !sameRun(record.run.ref, basis.run));
      return successor !== undefined && successor.run.status !== 'starting';
    }, { timeout: 30_000, interval: 50 }).toBe(true);
    const successor = (await runsOf(basis.world, basis.goal, basis.task.taskId))
      .find(record => !sameRun(record.run.ref, basis.run))!;
    expect(successor.run.task).toEqual(basis.task);
    await basis.world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: basis.goal }));
  }, 120_000);

  it('D-F3 the L46 answer (SessionMessage) and covering requeue (TaskRequeue) wake the Goal and start A', async () => {
    const { world, goalRef, tasks, run } = await openS7BL46World({ backend: 'memory' });
    worlds.push(world);
    await startGoalDriver(world, goalRef, 'drv-f3');
    const parked = await waitDriver(world, goalRef, undefined, snapshot => snapshot.state === 'waiting_for_reply',
      'D-F3 the driver to park on the automation-confirmation wait');
    expect(parked.reason).toContain('l46_blocked: s7b3-a');
    expect(await runsOf(world, goalRef, tasks.A.taskId)).toHaveLength(1);
    const applied = await applyL46Card(world, { goalRef, label: 'drv-f3',
      apply: { taskRef: tasks.A, run } });
    expect(applied.requeue).toMatchObject({ status: 'committed' });
    // The two real commits (answer then requeue) reach the Host's own queue.
    await expect.poll(async () => (await runsOf(world, goalRef, tasks.A.taskId)).length,
      { timeout: 30_000, interval: 50 }).toBe(2);
    await expect.poll(async () => (await runsOf(world, goalRef, tasks.A.taskId))[1]?.run.status,
      { timeout: 30_000, interval: 50 }).not.toBe('starting');
    const successor = (await runsOf(world, goalRef, tasks.A.taskId))[1]!;
    expect(successor.run.task.taskId).toBe(tasks.A.taskId);
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef }));
  }, 120_000);
});
