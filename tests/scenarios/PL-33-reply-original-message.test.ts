/**
 * PL-33 (v4 §15-33, DR-P2-11): regression row, no manufactured failure.
 *
 * A's real Work Run sends M (an action_request, `waitAfterSend: true`) to the adviser and yields. The adviser's
 * planning Query is built and its model request is held. Then a different message N is sent to the same line, the
 * adviser's scripted model answers a fixed non-v2 text, and the row checks that M — not the latest message N — is
 * the one reply target, that the plan does not change, that no candidate is written, and that A continues on a
 * successor Run.
 *
 * DR-P2-11 deletes the spec's indistinguishable "the Query's own message" mutation; this file uses only the
 * original "latest message" one. The real action-wait send step is the P2 fixture's (`sendPLActionWait`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { acceptS7BReply, readS7BMessage } from '../helpers/S7B-fixture.js';
import {
  heartbeatUntilModel, heartbeat, lineFacts, proposalRefOf, readBody, settleHost, waitForResponse,
} from '../helpers/IV-host-fixture.js';
import {
  createPLAdviserLine, openPLConsumptionWorld, seedPLSenderPlan, sendPLActionWait,
} from '../helpers/PL-consumption-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

describe('PL-33: the adviser answers "no plan change" to the executor\'s original message', () => {
  it('PL-33 the original M gets exactly the fixed text, N is not replied to, the plan stays, A gets a new Run', async () => {
    const world = await openPLConsumptionWorld({ label: 'pl33' });
    worlds.push(world);
    await settleHost(world);

    const goal = world.goals.first;
    const seeded = await seedPLSenderPlan(world, { goal, label: 'pl33', taskIds: ['pl33-send', 'pl33-reply'] });
    const adviser = await createPLAdviserLine(world, 'pl33-adviser');
    const planBefore = (await world.post('goals/read', plain(S6A_SCOPE, goal))).body as
      { status: 'ready'; value: { goal: { activePlanRevision: unknown } } };
    expect(planBefore.status).toBe('ready');

    // The adviser's Query will be built and held at its one model request.
    const gate = await world.gates.modelRequest(adviser);
    const m = await sendPLActionWait(world, { goal, session: seeded.line, sessionTaskId: 'pl33-send',
      recipient: adviser.ref, text: 'PL33: the executor asks the adviser to keep the plan', label: 'pl33' });
    const held = await heartbeatUntilModel(world, gate);

    // A different message N reaches the line while the Query is held: the latest message is not the reply target.
    const n = await sendS7A2PersonMessage(world, { label: 'pl33-n', recipient: adviser.ref });
    const fixed = 'PL-33: no plan change; keep going with the original plan';
    await world.scripted.script(adviser, [{ kind: 'text', text: fixed }]);
    gate.release();
    await held.settled;

    const replied = await waitForResponse(world, m.message.ref);
    expect(await readBody(world, m.message.ref, 'response'), 'M holds exactly the fixed text').toBe(fixed);

    const readN = await readS7BMessage(world, n.ref);
    expect(readN.response, 'the different message N is not mis-replied').toBeNull();

    const planAfter = (await world.post('goals/read', plain(S6A_SCOPE, goal))).body as
      { status: 'ready'; value: { goal: { activePlanRevision: unknown } } };
    expect(planAfter.status).toBe('ready');
    expect(planAfter.value.goal.activePlanRevision, 'the active plan is unchanged')
      .toEqual(planBefore.value.goal.activePlanRevision);
    const proposal = (await world.post('plans/proposal', plain(S6A_SCOPE, proposalRefOf(m.message.ref, goal)))).body;
    expect(proposal, 'a plain text answer writes no candidate').toMatchObject({ status: 'not_found' });

    // A's yielded Run continues on a successor Run through the real Workflow.
    await world.scripted.script(seeded.line, [{ kind: 'text', text: 'PL33 continuation answer' }]);
    const facts = await lineFacts(world, seeded.line);
    const yielded = facts.latestWork?.runRef;
    expect(yielded, 'A has its yielded claim').toBeDefined();
    const accepted = await acceptS7BReply(world, { goal, sender: seeded.line, task: seeded.tasks[0]!,
      run: yielded!, message: m.message.ref, label: 'pl33' });
    expect(accepted.run.runId, 'the executor continues on a new Run').not.toBe(m.run.runId);

    await heartbeat(world);
    expect(await readBody(world, m.message.ref, 'response'), 'the one reply slot is not overwritten').toBe(fixed);
  }, 120_000);
});
