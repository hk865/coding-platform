/**
 * PL-02: a planning answer that is `needs_decision` (spec §15 PL-02; v3 §9-2; 5.2.4).
 *
 * Two public routes reach the same close-out:
 * - a person's ordinary message on an idle adviser line: its `response` is associated while the question
 *   card waits, and another heartbeat adds no Query;
 * - a real Work Run's `action_request` that yields (`send_session_message`, `waitAfterSend: true`): the card
 *   waits, the executor M keeps its one open wait, no heartbeat reopens the Query, and a later request on the
 *   same line is still consumed.
 *
 * A third variant: a plan answer the real `plans/propose` refuses (a task of a module the adopted catalog does not
 * have, written as text because the submit tool refuses it first) writes no candidate, replies the executor M and
 * leaves the line free.
 *
 * The card count, the card kind/state and the reply body are the spec's literals; the Query count and the
 * model-request count are the no-reopen check (not a read of the record store).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { listed, readS7BMessage } from '../helpers/S7B-fixture.js';
import { refinementPlan } from '../helpers/S7B-V-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import {
  heartbeat, heartbeatUntil, lineFacts, proposalRefOf, questionCards, readBody, sessionQueries, settleHost,
  waitForResponse,
} from '../helpers/IV-host-fixture.js';
import {
  createPLAdviserLine, needsDecisionAnswer, openPLConsumptionWorld, seedPLSenderPlan, sendPLActionWait,
} from '../helpers/PL-consumption-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

const FIRST_ANSWER = needsDecisionAnswer('PL-02 the request leaves one decision',
  ['PL-02 choose option A or option B']);
const SECOND_ANSWER = needsDecisionAnswer('PL-02 the line continues', ['PL-02 confirm the next step']);

/**
 * `decisions/card` of the queue's card, and the saved Answer its pins name: the card keeps no question text of its
 * own, its identity is `(answerRef, questionIndex)`, so the person reads the question through that pin.
 */
async function readCardDetail(world: S6AHostWorld, card: DecisionCardV1): Promise<{
  detail: DecisionCardV1; answerText: string;
}> {
  const detail = ready<DecisionCardV1>(await world.post('decisions/card', plain(S6A_SCOPE, { source: card.source })),
    'decisions/card');
  const answerPin = detail.source.pins.find(pin => pin.ref.aggregateType === 'QueryJobAnswer');
  const saved = ready<{ answer: { answer: string } }>(await world.post('queries/answer',
    plain(S6A_SCOPE, answerPin?.ref)), 'the card answer pin');
  return { detail, answerText: saved.answer.answer };
}

describe('PL-02: needs_decision ends the turn, shows the cards, and does not reopen or block the line', () => {
  it('PL-02a the person\'s message is replied while the card waits, and the line consumes the next message', async () => {
    const world = await openPLConsumptionWorld({ label: 'pl02a' });
    worlds.push(world);
    await settleHost(world);
    const goal = world.goals.second;
    const line = await createPLAdviserLine(world, 'pl02a-adviser');

    await world.scripted.script(line, [{ kind: 'text', text: FIRST_ANSWER }]);
    const firstMessage = await sendS7A2PersonMessage(world, { label: 'pl02a-first', recipient: line.ref, goal });
    const cards = await heartbeatUntil(world, () => questionCards(world, goal), items => items.length > 0, 24);
    expect(cards, 'the needs_decision answer opens exactly one waiting question card').toHaveLength(1);
    expect(cards[0]?.source.kind).toBe('planning_question');
    expect(cards[0]?.state).toBe('waiting_answer');
    const { detail, answerText } = await readCardDetail(world, cards[0]!);
    expect(detail.source, 'decisions/card answers the queue card').toEqual(cards[0]?.source);
    expect(detail.state).toBe('waiting_answer');
    expect(answerText, 'the card pin reads the question').toContain('PL-02 choose option A or option B');

    // The person's ordinary message has no executor wait: its response is already associated at questions.
    const replied = await waitForResponse(world, firstMessage.ref);
    expect(replied.response, 'the person message response is associated while the card waits').not.toBeNull();
    expect(replied.response?.sender.kind, 'the reply is the formal query_run answer').toBe('query_run');
    expect(await readBody(world, firstMessage.ref, 'response'), 'the reply is the answer summary').toBe(
      'PL-02 the request leaves one decision');

    // The same Query is not reopened by another heartbeat: one Query and one model request.
    const queriesBefore = await sessionQueries(world, line);
    const requestsBefore = (await world.scripted.requests(line)).length;
    expect(queriesBefore, 'the one planning Query exists').toHaveLength(1);
    await heartbeat(world);
    await heartbeat(world);
    expect((await sessionQueries(world, line)).map(query => query.run.queryJobRef.queryJobId))
      .toEqual(queriesBefore.map(query => query.run.queryJobRef.queryJobId));
    expect((await world.scripted.requests(line)).length, 'a heartbeat does not re-run the answered Query')
      .toBe(requestsBefore);

    // A later request on the same line is consumed, not blocked by the waiting card or the answered source.
    await world.scripted.script(line, [{ kind: 'text', text: SECOND_ANSWER }]);
    const secondMessage = await sendS7A2PersonMessage(world, { label: 'pl02a-second', recipient: line.ref, goal });
    await waitForResponse(world, secondMessage.ref);
    const queriesAfter = await sessionQueries(world, line);
    expect(queriesAfter, 'the later request opens its own Query').toHaveLength(2);
    expect(new Set(queriesAfter.map(query => query.run.queryJobRef.queryJobId)).size).toBe(2);
  }, 120_000);

  it('PL-02b the executor M keeps only its open wait while the card waits, and the next request still runs',
    async () => {
      const world = await openPLConsumptionWorld({ label: 'pl02b' });
      worlds.push(world);
      await settleHost(world);
      const goal = world.goals.first;
      const seeded = await seedPLSenderPlan(world, { goal, label: 'pl02b', taskIds: ['pl02b-send'] });
      const adviser = await createPLAdviserLine(world, 'pl02b-adviser');

      await world.scripted.script(adviser, [{ kind: 'text', text: FIRST_ANSWER }]);
      const m = await sendPLActionWait(world, {
        goal, session: seeded.line, sessionTaskId: 'pl02b-send', recipient: adviser.ref,
        text: 'PL-02 the executor lets go for a decision', label: 'pl02b',
      });

      const cards = await heartbeatUntil(world, () => questionCards(world, goal), items => items.length > 0, 24);
      expect(cards, 'the needs_decision answer opens exactly one waiting question card').toHaveLength(1);
      expect(cards[0]?.source.kind).toBe('planning_question');
      expect(cards[0]?.state).toBe('waiting_answer');

      expect((await readCardDetail(world, cards[0]!)).answerText, 'the card pin reads the question')
        .toContain('PL-02 choose option A or option B');

      // Only M's wait is still open: the message waited, its wait is open and it has no response.
      const waiting = await readS7BMessage(world, m.message.ref);
      expect(waiting.waitAfterSend, 'M is the executor work_run wait').toBe(true);
      expect(waiting.response, 'M is not replied at the questions close-out').toBeNull();
      const waitOf = async (): Promise<string | undefined> => (await lineFacts(world, seeded.line)).waits
        .find(wait => wait.messageRef.messageId === m.message.ref.messageId)?.state.state;
      expect(await waitOf(), 'the sender line reads the wait of M as open').toBe('open');
      expect((await listed(world, 'outbox', seeded.line)).find(item => item.ref.messageId === m.message.ref.messageId),
        'M stays in the sender outbox, unanswered').toMatchObject({ waitAfterSend: true, response: null });

      // The one Query stays one Query across heartbeats; the model is not asked again.
      expect(await sessionQueries(world, adviser), 'the one planning Query exists').toHaveLength(1);
      const requestsBefore = (await world.scripted.requests(adviser)).length;
      await heartbeat(world);
      await heartbeat(world);
      expect(await sessionQueries(world, adviser), 'the same Query is not reopened').toHaveLength(1);
      expect((await world.scripted.requests(adviser)).length, 'a heartbeat does not re-run the answered Query')
        .toBe(requestsBefore);
      expect((await readS7BMessage(world, m.message.ref)).response, 'M still waits after the heartbeats').toBeNull();
      expect(await waitOf(), 'the wait stays open after the heartbeats').toBe('open');

      // A later request on the same line is consumed while M's wait remains open.
      await world.scripted.script(adviser, [{ kind: 'text', text: SECOND_ANSWER }]);
      const later = await sendS7A2PersonMessage(world, { label: 'pl02b-later', recipient: adviser.ref, goal });
      await waitForResponse(world, later.ref);
      expect((await sessionQueries(world, adviser)), 'the later request opens its own Query').toHaveLength(2);
      expect((await readS7BMessage(world, later.ref)).response?.sender.kind).toBe('query_run');
      expect((await readS7BMessage(world, m.message.ref)).response, 'the later request does not close M')
        .toBeNull();
      expect(await waitOf(), 'the later request leaves the wait open').toBe('open');
    }, 120_000);

  it('PL-02c a refused proposal replies the executor M with the answer, writes no candidate and frees the line',
    async () => {
      const world = await openPLConsumptionWorld({ label: 'pl02c' });
      worlds.push(world);
      await settleHost(world);
      const goal = world.goals.first;
      const seeded = await seedPLSenderPlan(world, { goal, label: 'pl02c', taskIds: ['pl02c-send'] });
      const adviser = await createPLAdviserLine(world, 'pl02c-adviser');

      const answer = JSON.parse(await refinementPlan(world, goal, { label: 'pl02c', taskId: 'pl02c-ghost',
        role: S6A_WORK_ROLE.templateId })) as { summary: string; plan: { tasks: { taskId: string; scope: unknown }[] } };
      const ghost = answer.plan.tasks.find(task => task.taskId === 'pl02c-ghost');
      if (ghost === undefined) throw new Error('PL-02c: the answer has no refined task');
      ghost.scope = { kind: 'module', moduleRef: 'pl02c-ghost-module' };
      await world.scripted.script(adviser, [{ kind: 'text', text: JSON.stringify(answer) }]);
      const m = await sendPLActionWait(world, {
        goal, session: seeded.line, sessionTaskId: 'pl02c-send', recipient: adviser.ref,
        text: 'PL-02 the executor asks for a plan the catalog refuses', label: 'pl02c',
      });

      await waitForResponse(world, m.message.ref);
      expect(await readBody(world, m.message.ref, 'response'), 'M gets the answer\'s summary').toBe(answer.summary);
      const proposal = await world.post('plans/proposal', plain(S6A_SCOPE, proposalRefOf(m.message.ref, goal)));
      expect(proposal.body, 'the refused plan writes no candidate').toMatchObject({ status: 'not_found' });
      expect(await questionCards(world, goal), 'a refused plan asks the person nothing').toHaveLength(0);

      // The one Query is not reopened, and a later request on the same line runs.
      const requestsBefore = (await world.scripted.requests(adviser)).length;
      await heartbeat(world);
      await heartbeat(world);
      expect(await sessionQueries(world, adviser), 'the same Query is not reopened').toHaveLength(1);
      expect((await world.scripted.requests(adviser)).length, 'a heartbeat does not re-run the answered Query')
        .toBe(requestsBefore);
      await world.scripted.script(adviser, [{ kind: 'text', text: SECOND_ANSWER }]);
      const later = await sendS7A2PersonMessage(world, { label: 'pl02c-later', recipient: adviser.ref, goal });
      await waitForResponse(world, later.ref);
      expect(await sessionQueries(world, adviser), 'the later request opens its own Query').toHaveLength(2);
    }, 120_000);
});

