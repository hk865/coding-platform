/**
 * PL-45 (v4 §15-45, DR-P2-10): the executor's real `send_session_message` action_request carries `taskRef: W`,
 * where W is the adviser line's own unfinished Work.
 *
 * The send step is the real tool call inside the sender's Work Run (no inquiry helper copy), the body is 15 KiB of
 * printable ASCII (under the agent sender's 16 KiB bound), the `expected` basis is the public read just before and
 * the real `messages/release` lets the Host consume it. The row reuses PL-05's W world and reads.
 *
 * Today the message is quoted as an ordinary agent `action_request`, so the handler falls into the `taskRef ??
 * latestWork` claim block (or is stopped by W's own claim) and no planning Query opens: the red is the claim
 * increment and/or the missing Query. The named mutation restores that block.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  heartbeatUntil, lineFacts, readBody, readPlanningQuery, sessionExecutions, settleHost,
} from '../helpers/IV-host-fixture.js';
import {
  openPLConsumptionWorld, seedPLActionWorld, sendPLActionWait,
} from '../helpers/PL-consumption-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

describe('PL-45: an executor action_request with taskRef on the adviser line', () => {
  it('PL-45 the 15 KiB action_request opens a planning Query and claims no Work', async () => {
    const world = await openPLConsumptionWorld({ label: 'pl45' });
    worlds.push(world);
    await settleHost(world);

    const goal = world.goals.first;
    const seeded = await seedPLActionWorld(world, { goal, label: 'pl45',
      adviserTaskId: 'pl45-w', senderTaskId: 'pl45-a' });
    expect((await lineFacts(world, seeded.adviser)).latestWork?.task,
      'the adviser\'s latest Work is W').toMatchObject({ taskId: 'pl45-w' });

    // 15 KiB of printable ASCII: under the 16 KiB agent-sender bound, over a short "long message" probe.
    const text = `PL45 ${'a'.repeat(15 * 1024 - 5)}`;
    expect(Buffer.byteLength(text, 'utf8'), 'the body is at most 16 KiB of UTF-8').toBeLessThanOrEqual(16 * 1024);

    const before = await sessionExecutions(world, seeded.adviser);
    const sent = await sendPLActionWait(world, { goal, session: seeded.sender, sessionTaskId: 'pl45-a',
      recipient: seeded.adviser.ref, text, taskRef: seeded.adviserTask, label: 'pl45' });
    expect(await readBody(world, sent.message.ref, 'message'), 'the whole body is saved').toBe(text);

    const query = await heartbeatUntil(world, () => readPlanningQuery(world, sent.message.ref),
      value => value !== null, 16);
    const after = await sessionExecutions(world, seeded.adviser);

    expect(after.length - before.length, 'the adviser is not made to claim W again').toBe(0);
    expect(query, 'the executor message opens a planning Query').not.toBeNull();
  }, 120_000);
});
