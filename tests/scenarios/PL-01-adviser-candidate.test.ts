/**
 * PL-01 (v3 §9-1, DR-P2-08): a person's ordinary action on an idle adviser line.
 *
 * The world is the fixed "candidate waiting" one: `openConsumeHostWorld` with the adviser profile (P2's fixture), a
 * real adviser line, and the person's message through `messages/send`. The Host's own consume loop runs it, the
 * adviser's scripted model writes the first plan, and the row reads the candidate before any adoption.
 *
 * The ruling's observable: the candidate is still `candidate`, the person's message has its `response` already
 * (the person has no executor wait, so a waiting candidate does not hold it), another heartbeat adds no Query.
 * Today the candidate path returns `awaiting_decision`, which the Host loop does not close, so the response stays
 * null; that is the behavioural red. It also goes red if the Host later delays a reply by `reason=candidate`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { firstPlan } from '../helpers/S7B-V-fixture.js';
import {
  awaitCandidate, consumeView, heartbeat, readBody, sessionQueries, settleHost, waitForResponse,
} from '../helpers/IV-host-fixture.js';
import {
  createPLAdviserLine, openPLConsumptionWorld,
} from '../helpers/PL-consumption-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

describe('PL-01: a person intervenes on an idle adviser line with no claimable Task', () => {
  it('PL-01 the candidate waits, the person\'s response is already associated, and no second Query opens', async () => {
    const world = await openPLConsumptionWorld({ label: 'pl01' });
    worlds.push(world);
    await settleHost(world);

    const line = await createPLAdviserLine(world, 'pl01-adviser');
    const answer = firstPlan({ label: 'pl01', taskId: 'pl01-task', role: 'builder' });
    const message = await sendS7A2PersonMessage(world, {
      label: 'pl01', recipient: line.ref, goal: world.goals.second,
    });
    await world.scripted.script(line, [{ kind: 'text', text: answer }]);

    // The model's first plan becomes the candidate and is not adopted (the first plan is the person's).
    const candidate = await awaitCandidate(world, message.ref, world.goals.second);
    expect(candidate.proposal.status, 'the proposal is still waiting for the person').toBe('candidate');
    expect(await sessionQueries(world, line), 'the message opened exactly one planning Query').toHaveLength(1);

    // The expected literal is §5.3.5's reply text: the plan answer's `summary`.
    const summary = (JSON.parse(answer) as { summary: string }).summary;
    const replied = await waitForResponse(world, message.ref);
    expect(replied.response, 'the person\'s message response is associated while the candidate waits').not.toBeNull();
    expect(await readBody(world, message.ref, 'response'), 'the reply is the planning answer summary').toBe(summary);

    // Another Host pass: the same candidate and the same one Query; no second round, no second association.
    const requestsBefore = (await world.scripted.requests(line)).length;
    await heartbeat(world);
    expect(await sessionQueries(world, line), 'another heartbeat adds no Query').toHaveLength(1);
    // The closed message is not supplied any more: the Host's own consumer read offers no next message and
    // no model request is made for it, so a repeat supply reusing the same Query would fail here.
    expect((await consumeView(world, line))?.nextMessage ?? null, 'the replied message is not offered again').toBeNull();
    expect((await world.scripted.requests(line)).length, 'the heartbeat made no model request').toBe(requestsBefore);
    expect((await world.post('messages/read', plain(S6A_SCOPE, message.ref))).body,
      'the message stays readable').toMatchObject({ status: 'ready' });
  }, 120_000);
});
