/** DRV §5.1 D-P1/D-P2 over the real Host: stopping one of two waits keeps the other registration; a held outbox page after stop shows no `waiting_for_reply` before `stopped`. */

import { afterEach, describe, expect, it } from 'vitest';
import type { CollaborationSnapshot } from '../../src/app/collaboration-driver.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { deferred } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openChangeStream } from '../helpers/change-stream-reader.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { ready, sessionOf } from '../helpers/S7A-fixture.js';
import { driverRead, openDrvWorld, runsOf, startTaskDriver, waitDriver } from '../helpers/DRV-fixture.js';
import { answerS7BWait, openS7BWorld, sendS7BWaitingInquiry } from '../helpers/S7B-fixture.js';

type World = Awaited<ReturnType<typeof openS7BWorld>>['world'];
const worlds: World[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

const waitForDriverRead = (world: World, goal: GoalRef, taskId: string, state: string) =>
  waitDriver(world, goal, taskId, snapshot => snapshot.state === state, `${taskId} never reached ${state}`);

async function planWorld(label: string, taskIds: readonly string[]) {
  const opened = await openDrvWorld(label, taskIds);
  worlds.push(opened.world);
  return opened;
}

const line = async (world: World, main: S6ACardsWorkspace, label: string, tasks: readonly TaskTriple[] = []) =>
  sessionOf(world, await createS6BLine(main, { label, role: S6A_WORK_ROLE, tasks }));
const stopTask = async (world: World, goal: GoalRef, taskId: string): Promise<unknown> =>
  (await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal, taskId }))).body;
/** A3: hold the real returned outbox page that names the waiting inquiry. */
function holdOutbox(world: World) {
  const messages = world.platform.messages;
  const real = messages.readOutbox.bind(messages);
  const page = deferred<void>(); const release = deferred<void>();
  messages.readOutbox = async (ctx, input) => {
    const result = await real(ctx, input);
    if (result.status === 'ready' && result.value.items.some(item => item.waitAfterSend === true)) {
      page.resolve(); await release.promise;
    }
    return result;
  };
  return { page, release };
}

/** A3: hold the stop drain's post-`done` execution read, so the notice is read first. */
function holdThirdRead(world: World) {
  const executions = world.platform.executions;
  const real = executions.readExecution.bind(executions);
  const reached = deferred<void>(); const release = deferred<void>(); let reads = 0;
  executions.readExecution = async (ctx, runRef, options) => {
    const result = await real(ctx, runRef, options);
    if (++reads === 3) { reached.resolve(); await release.promise; }
    return result;
  };
  return { reached, release };
}

/** The driver's real change stream: the snapshot read at each notice for this Task. */
async function collectStates(world: World, goal: GoalRef, taskId: string) {
  const stream = await openChangeStream(world.base, world.token);
  const states: string[] = [];
  const goals: string[] = [];
  const running = (async () => {
    for (;;) {
      const frame = await stream.nextEvent(10_000).catch(() => null);
      if (frame === null) return;
      const data = frame.data as { kinds?: string[]; goalId?: string; taskId?: string | null };
      if (!data.kinds?.includes('driver') || data.goalId !== goal.goalId) continue;
      if (data.taskId === null) { goals.push('goal'); continue; }
      if (data.taskId !== taskId) continue;
      const read = await driverRead(world, goal, taskId);
      if (read.status === 'ready') states.push(read.value.state);
    }
  })();
  return { states, goals, stop: async () => { stream.abort(); await running.catch(() => undefined); } };
}

describe('DRV goal driver waits (memory)', () => {
  it('D-P1 stopping B keeps the Goal wait so the real reply to A starts its successor Run', async () => {
    const { world, main, goal, tasks } = await planWorld('drv-p1',
      ['drv-p1-a-send', 'drv-p1-b-send', 'drv-p1-a-reply']);
    const [a, b, reply] = await Promise.all([line(world, main, 'drv-p1-a', [tasks[0]!]),
      line(world, main, 'drv-p1-b', [tasks[1]!]), line(world, main, 'drv-p1-reply')]);
    const body = { recipient: reply.ref, text: 'DRV D-P1 inquiry', intent: 'inquiry' as const, needsReply: true as const, waitAfterSend: true as const };
    const message = await sendS7BWaitingInquiry(world, { goal, session: a, taskId: tasks[0]!.taskId, label: 'drv-p1-a', body });
    await sendS7BWaitingInquiry(world, { goal, session: b, taskId: tasks[1]!.taskId, label: 'drv-p1-b', body });
    await startTaskDriver(world, goal, tasks[0]!.taskId, 'drv-p1-a'); await startTaskDriver(world, goal, tasks[1]!.taskId, 'drv-p1-b');
    const parked = await waitForDriverRead(world, goal, tasks[0]!.taskId, 'waiting_for_reply');
    expect(parked.siblings.find(sibling => sibling.taskId === tasks[1]!.taskId)?.state).toBe('waiting_for_reply');
    expect(await stopTask(world, goal, tasks[1]!.taskId)).toMatchObject({ status: 'ready', value: { state: 'stopping' } });
    await waitForDriverRead(world, goal, tasks[1]!.taskId, 'stopped');
    await answerS7BWait(world, { goal, recipient: reply, message: message.ref, task: tasks[2]!, label: 'drv-p1-a' });
    await expect.poll(async () => (await runsOf(world, goal, tasks[0]!.taskId))
      .filter(record => record.run.status !== 'starting').length, { timeout: 30_000, interval: 50 }).toBe(2);
    const snapshot = await driverRead(world, goal, tasks[0]!.taskId) as { status: string; value?: CollaborationSnapshot };
    expect(snapshot.status).toBe('ready');
    expect(snapshot.value?.state).not.toBe('waiting_for_reply');
    expect(await driverRead(world, goal, tasks[1]!.taskId)).toMatchObject({ status: 'ready', value: { state: 'stopped' } });
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal }));
  }, 120_000);

  it('D-P2 a held outbox page released after stop writes no waiting_for_reply notice', async () => {
    const { world, main, goal, tasks } = await planWorld('drv-p2', ['drv-p2-send', 'drv-p2-reply']);
    const [sender, recipient] = await Promise.all([line(world, main, 'drv-p2-send', [tasks[0]!]),
      line(world, main, 'drv-p2-reply')]);
    await world.scripted.script(sender, [{ kind: 'calls', calls: [{ callId: 'drv-p2-send',
      name: 'send_session_message', args: { recipient: recipient.ref, text: 'DRV D-P2 inquiry', intent: 'inquiry',
        needsReply: true, waitAfterSend: true } }] }, { kind: 'text', text: 'DRV D-P2 done' }]);
    const held = holdOutbox(world);
    const drain = holdThirdRead(world);
    await startTaskDriver(world, goal, tasks[0]!.taskId, 'drv-p2');
    await held.page.promise;
    const seen = await collectStates(world, goal, tasks[0]!.taskId);
    expect(await stopTask(world, goal, tasks[0]!.taskId)).toMatchObject({ status: 'ready', value: { state: 'stopping' } });
    held.release.resolve();
    await drain.reached.promise;
    await expect.poll(() => seen.states.length, { timeout: 30_000, interval: 10 }).toBeGreaterThanOrEqual(2);
    drain.release.resolve(); const stopped = await waitForDriverRead(world, goal, tasks[0]!.taskId, 'stopped');
    await seen.stop(); expect(stopped.state).toBe('stopped');
    expect(seen.states, `driver notices for ${tasks[0]!.taskId}: ${JSON.stringify(seen.states)}`)
      .not.toContain('waiting_for_reply');
    // DRV-06: after the stop the watch only moves stopping → stopped; the same
    // §4.2 table feeds the Goal summary announced below.
    const afterStop = seen.states.slice(seen.states.indexOf('stopping'));
    expect(afterStop[0], `driver notices for ${tasks[0]!.taskId}: ${JSON.stringify(seen.states)}`).toBe('stopping');
    expect(afterStop.every(state => state === 'stopping' || state === 'stopped')).toBe(true);
    expect(afterStop.at(-1)).toBe('stopped');
    // DRV-06 (§3.1:125): the watch's change also announces its Goal summary.
    expect(seen.goals, `Goal notices for ${tasks[0]!.taskId}: ${JSON.stringify(seen.goals)}`).not.toHaveLength(0);
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal }));
  }, 120_000);
});
