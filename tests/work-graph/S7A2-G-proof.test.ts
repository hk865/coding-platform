/**
 * G-proof (7a:727; SR4 §5): the trusted answer's application, reached through the real `decisions/answer` route and
 * read back from the answer message's recorded `application` (`messages/read`): its actor, changes and the receipt of
 * the ActionRequest owner's approve commit; the ③ application leaves the release message and the Goal alone. The proof itself and a direct approval's
 * null proof have no public read and are not proved here (rulings 8 item 3).
 *
 * Deferred form (SR4 §5; frozen fixture): `exercise()` holds every public step and assertion; the card source is L's
 * registration, so the single deferred statement asserts `readS7A2Card`'s own named error and L replaces only it.
 */
import { afterEach, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  openS7AQueryWorldWithActions, ready, seedS7AGoalPlan, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';
import {
  answerS7A2Card, readS7A2Card, readS7A2DispatchBasis, sendS7A2RequestWithDispatch,
} from '../helpers/S7A2-fixture.js';

const goal: GoalRef = { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: 's7a-goal-proof' };
const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

it('G-proof: the application of the trusted answer, its receipt and the unchanged records (memory)', async () => {
  const exercise = async () => {
    const opened = await openS7AQueryWorldWithActions({ backend: 'memory' });
    worlds.push(opened.world);
    const { goal: seeded } = await seedS7AGoalPlan(opened.world, { pointer: 'proof' });
    expect(seeded).toEqual(goal);
    await setS7AAutonomy(opened.world, goal, 'every_step');
    const view = async (ref: SessionMessage['ref']) => ready<SessionMessage>(
      await opened.world.post('messages/read', plain(S6A_SCOPE, ref)), 'the message read');

    const message = await sendS7A2RequestWithDispatch(opened.world,
      { label: 'g-proof-answer', goal, recipient: opened.session.ref });
    const card = await readS7A2Card(opened.world, goal);
    const basisBefore = await readS7A2DispatchBasis(opened.world, goal);
    const beforeAnswer = await view(message.ref);

    const answered = await answerS7A2Card(opened.world,
      { source: card.source, optionId: 'approve', label: 'g-proof-approve' });
    // P2 §2.6: the action_release ② adapter calls the ActionRequest owner's approve; a committed approval is handed
    // back as the ③ application's receipt, never as a message action.
    expect(answered.action).toBeNull();
    // The answer message is the receipt's message; its `application` is the recorded ③.
    const answerRef = answered.answer.status === 'committed' ? answered.answer.value.ref : null;
    if (answerRef === null) throw new Error('S7A2: the answer did not commit');
    const answer = await view(answerRef);
    const application = answer.application;
    if (application === null || application === undefined) {
      throw new Error('S7A2: the answer has no recorded application');
    }
    const response = answer.response;
    if (response === null || !('decision' in response)) throw new Error('S7A2: the answer is not a decision');
    expect(response.decision.source.pins).toEqual(card.source.pins);
    expect(application.actor).toEqual(response.sender.actor);
    // The application moves the persisted ActionRequest (and its hold), never the request message.
    const requestRef = card.card.actionRelease?.ref;
    if (requestRef === undefined) throw new Error('S7A2: the action_release card has no action request');
    // The card's public source pin carries the ActionRequest's creation revision (the card's stable identity).
    const creationRevision = card.source.pins.find(pin => pin.ref.aggregateType === 'ActionRequest')?.revision;
    if (creationRevision === undefined) throw new Error('S7A2: the card source does not pin the action request');
    expect(application.changes).toEqual([{
      before: { ref: requestRef, revision: creationRevision },
      after: { ref: requestRef, revision: creationRevision + 1 },
    }]);
    expect(application.changes[0]!.after.revision).toBe(application.changes[0]!.before.revision + 1);
    expect(application.basisRebases).toEqual([]);
    // The receipt is the ActionRequest owner's approve commit (the ② step's own write).
    expect(application.receipt.identityKey.startsWith('action_request.approve:')).toBe(true);
    // The ③ application leaves the request message at its ② value and the Goal's dispatch facts alone.
    expect(await view(message.ref)).toEqual(beforeAnswer);
    expect(await readS7A2DispatchBasis(opened.world, goal)).toEqual(basisBefore);
    expect((await view(message.ref)).revision).toBe(beforeAnswer.revision);

  };
  await exercise();
});
