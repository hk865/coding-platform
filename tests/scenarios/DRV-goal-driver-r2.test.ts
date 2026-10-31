/** DRV §5.1 D-R2: the consumer dispatches an intervention on idle B inside the Goal's one driver while A stays held, and the Goal read names both watches. */
// Named mutation: give the intervention dispatch a driver of its own instead of the Host's goal driver → the Goal read's siblings lose B, and `driver-read` for B is not_found.

import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { openS7B2ConsumeWorld, type S7B2ConsumeWorld } from '../helpers/S7B2-consumable-sessions.js';
import { committed, ready, sameRun, sessionOf } from '../helpers/S7A-fixture.js';
import { limitHold } from '../helpers/hold-limit.js';
import { driverRead, runsOf, startTaskDriver } from '../helpers/DRV-fixture.js';

const worlds: S7B2ConsumeWorld[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map(consume => consume.world.close())); });

/** One real measured Host consume pass: the barrier observes the throttle the clock just cleared. */
async function heartbeat(world: S6AHostWorld): Promise<void> {
  const settled = world.consumeBarrier(); world.clock.advance(25); await settled;
}
describe('DRV goal driver person intervention on an idle line (memory)', () => {
  it('D-R2 the consumer dispatches B inside the one Goal driver while A stays held', async () => {
    const consume = await openS7B2ConsumeWorld();
    worlds.push(consume);
    const { world } = consume;
    // Three measured passes settle the consume world's own setup turns, so the
    // four below observe only this row's intervention.
    world.scriptReplies(Array.from({ length: 30 }, (_, index) => ({
      kind: 'text' as const, text: `D-R2 consume answer ${index + 1}` })));
    for (let pass = 0; pass < 3; pass += 1) await heartbeat(world);

    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await main.createGoal('drv-r2-goal', 'DRV D-R2 intervention while A runs')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 'drv-r2',
      taskIds: ['drv-r2-a', 'drv-r2-b'], role: S6A_WORK_ROLE.templateId });
    const sessionA = await sessionOf(world, await createS6BLine(main, {
      label: 'drv-r2-a', role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const sessionB = await sessionOf(world, await createS6BLine(main, {
      label: 'drv-r2-b', role: S6A_WORK_ROLE, tasks: [tasks[1]!] }));
    const replyLine = await createS6BLine(main, { label: 'drv-r2-reply', role: S6A_WORK_ROLE });
    const sessionReply = await sessionOf(world, replyLine);
    // B's first real round yields on its own inquiry, so the Task stays
    // unfinished and the person's action_request can claim its released Run.
    await world.scripted.script(sessionB, [
      { kind: 'calls', calls: [{ callId: 'drv-r2-b-inquiry', name: 'send_session_message',
        args: { recipient: sessionReply.ref, text: 'D-R2 B first inquiry', intent: 'inquiry',
          needsReply: true, waitAfterSend: true } }] },
      { kind: 'text', text: 'D-R2 B intervention done' },
    ]);
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'drv-r2-b-first',
      sessionHint: sessionB.ref, kind: 'select_work', taskId: tasks[1]!.taskId });
    const firstB = await runsOf(world, goal, tasks[1]!.taskId);
    expect(firstB).toHaveLength(1);
    expect(firstB[0]!.run.status).toBe('ended');

    // The person's real action_request, then A started with only its Task and
    // its model request held at the Host gate.
    const sent = committed<{ intent?: string }>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: sessionB.ref, text: 'D-R2 person intervenes on B', intent: 'action_request',
      needsReply: true, goalRef: goal, taskRef: tasks[1]!,
    }, 'drv-r2-action')), 'D-R2 the person action_request');
    expect(sent.intent).toBe('action_request');
    const gateA = await world.gates.modelRequest(sessionA);
    await startTaskDriver(world, goal, tasks[0]!.taskId, 'drv-r2-a');
    await limitHold(gateA.reached, 'D-R2 A model request');
    expect((await runsOf(world, goal, tasks[0]!.taskId))
      .some(record => record.run.status === 'running')).toBe(true);
    // The Goal's own decision has not started B: its only Run is the first round.
    expect(await runsOf(world, goal, tasks[1]!.taskId)).toHaveLength(1);

    // The real consumer period, four heartbeats: one hands B to the intervention
    // dispatch, which opens B's watch in the Goal driver.
    for (let pass = 0; pass < 4; pass += 1) await heartbeat(world);

    // (a) B's round is advanced by the consumer/intervention path.
    await expect.poll(async () => (await runsOf(world, goal, tasks[1]!.taskId))
      .filter(record => !sameRun(record.run.ref, firstB[0]!.run.ref)).length,
    { timeout: 30_000, interval: 25 }).toBe(1);
    await expect.poll(async () => (await runsOf(world, goal, tasks[1]!.taskId))
      .filter(record => !sameRun(record.run.ref, firstB[0]!.run.ref))[0]?.run.status,
    { timeout: 30_000, interval: 25 }).toBe('ended');
    // (b) A's advancement is not disturbed: still one held round.
    const aRuns = await runsOf(world, goal, tasks[0]!.taskId);
    expect(aRuns).toHaveLength(1);
    expect(aRuns[0]!.run.status).toBe('running');
    expect(world.gates.unreleased().some(label => label.startsWith(`model request on ${sessionA.label}`)))
      .toBe(true);
    // (c) The Goal still has one driver: the main read plus its siblings names
    // both watches, and each Task id reads its own watch under that driver.
    const mainRead = await driverRead(world, goal);
    expect(mainRead.status).toBe('ready');
    if (mainRead.status !== 'ready') throw new Error(`D-R2 main read: ${JSON.stringify(mainRead)}`);
    expect(new Set([mainRead.value.taskId, ...mainRead.value.siblings.map(sibling => sibling.taskId)]))
      .toEqual(new Set([tasks[0]!.taskId, tasks[1]!.taskId]));
    expect((await driverRead(world, goal, tasks[0]!.taskId)).status).toBe('ready');
    expect((await driverRead(world, goal, tasks[1]!.taskId)).status).toBe('ready');

    gateA.release();
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal }));
  }, 120_000);
});
