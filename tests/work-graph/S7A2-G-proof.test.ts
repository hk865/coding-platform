/**
 * G-proof (7a:727; SR4 §5): the trusted answer's application, reached through the real `decisions/answer` route and
 * read back from the answer message's recorded `application` (`messages/read`): its actor, time, changes and receipt
 * cursor; the ③ application leaves the release message and the Goal alone. The proof itself and a direct approval's
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
  committed, openS7AQueryWorld, ready, seedS7AGoalPlan, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';
import {
  answerS7A2Card, readS7A2Card, readS7A2DispatchBasis, sendS7A2Request,
} from '../helpers/S7A2-fixture.js';

const goal: GoalRef = { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: 's7a-goal-proof' };
const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

it('G-proof: the application of the trusted answer, its receipt and the unchanged records (memory)', async () => {
  const exercise = async () => {
    const opened = await openS7AQueryWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const { goal: seeded } = await seedS7AGoalPlan(opened.world, { pointer: 'proof' });
    expect(seeded).toEqual(goal);
    await setS7AAutonomy(opened.world, goal, 'every_step');
    const view = async (ref: SessionMessage['ref']) => ready<SessionMessage>(
      await opened.world.post('messages/read', plain(S6A_SCOPE, ref)), 'the message read');

    const message = await sendS7A2Request(opened.world,
      { label: 'g-proof-answer', goal, recipient: opened.session.ref, intent: 'action_request' });
    const card = await readS7A2Card(opened.world, goal);
    const basisBefore = await readS7A2DispatchBasis(opened.world, goal);
    const beforeAnswer = await view(message.ref);

    const answered = await answerS7A2Card(opened.world,
      { source: card.source, optionId: 'approve', label: 'g-proof-approve' });
    const actionResult = answered.action;
    const action = committed<SessionMessage>(actionResult, 'the release decision');
    if (actionResult === null || actionResult.status !== 'committed') {
      throw new Error('S7A2: the release decision did not commit');
    }
    expect(action.release).toBe('approved');
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
    expect(application.appliedAt).toBe(action.approvedAt);
    expect(application.changes).toEqual([{
      before: { ref: message.ref, revision: message.revision },
      after: { ref: message.ref, revision: message.revision + 1 },
    }]);
    expect(application.basisRebases).toEqual([]);
    expect(application.receipt.cursor).toBe(actionResult.cursor);
    // The ③ application leaves the release message at its ② value and the Goal's dispatch facts alone.
    expect(await view(message.ref)).toEqual(action);
    expect(await readS7A2DispatchBasis(opened.world, goal)).toEqual(basisBefore);
    expect(action.revision).toBe(beforeAnswer.revision + 1);

  };
  await exercise();
});
