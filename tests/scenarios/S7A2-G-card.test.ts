/**
 * G-card (7a:725; SR4 §5; P2 §6 `S7A2-G-card:59/:445`): the `action_release` card's identity (request ref + creation
 * revision, and a replay on the same key), its approve and deny paths through `decisions/answer`, the dispatch
 * counter staying put on approve, and the direct-release inquiry. The message-release card, its `deadline` and the
 * message view/outbox `releaseBlock` are gone; the card's facts are the action request's (`DecisionCardV1.actionRelease`)
 * and its live blockers (`blockedBy`), so the one stale case reads that list instead of a `stale_pins` block.
 *
 * Deferred form (SR4 §5; frozen fixture): the complete public steps and business assertions live in `exercise`; the
 * card source is L's registration, so the one deferred statement asserts `readS7A2Card`'s own named error and L
 * replaces only that statement with `await exercise();`.
 */
import { afterEach, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  moveS7APlan, openS7AQueryWorldWithActions, pauseS7AGoal, ready, seedS7AGoalPlan, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';
import {
  answerS7A2Card, driveS7A2Release, readS7A2Card, readS7A2DispatchBasis, sendS7A2RequestWithDispatch,
} from '../helpers/S7A2-fixture.js';

/** The first seeded Goal's fixed identity (`seedS7AGoalPlan` names it `s7a-goal-<pointer>`). */
const goal: GoalRef = { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: 's7a-goal-m05' };
const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

async function openWorld() {
  const opened = await openS7AQueryWorldWithActions({ backend: 'memory' });
  worlds.push(opened.world);
  return opened;
}

it('G-card: identity, approve/deny, the unchanged dispatch facts and the one waiting-card blocker (memory)', async () => {
  const exercise = async () => {
    // ---- case 1: M-05, the identity/replay, approve, deny, stale and paused -------------------------------
    const opened = await openWorld();
    const { goal: m05 } = await seedS7AGoalPlan(opened.world, { pointer: 'm05' });
    expect(m05).toEqual(goal);
    await setS7AAutonomy(opened.world, m05, 'every_step');
    // The frozen fixture's `sendS7A2RequestWithDispatch` sends one real secretary round and asks the public action
    // owner for a dispatch in that same round; the persisted request, never the message, is what raises the card
    // (P2 §6 `S7A2-G-card:59`).
    const send = (label: string) =>
      sendS7A2RequestWithDispatch(opened.world, { label, goal: m05, recipient: opened.session.ref });
    const view = async (ref: SessionMessage['ref']) => ready<SessionMessage>(
      await opened.world.post('messages/read', plain(S6A_SCOPE, ref)), 'the message read');

    const cards = s6aCardsWorkspace(opened.world, S6A_SCOPE);
    const request = await send('g-card-request');
    const releaseCard = await readS7A2Card(opened.world, m05);
    // P2: the card source is the persisted `ActionRequest`; its identity key comes from the request,
    // so derive the expected key from the queue card itself, never a hand-built source.
    expect(releaseCard.card.source).toMatchObject({ kind: 'action_release' });
    expect(releaseCard.card.actionRelease?.ref).toMatchObject({ aggregateType: 'ActionRequest' });
    const expectedKey = releaseCard.card.source.key;
    expect(typeof expectedKey, 'the action_release card key is a string').toBe('string');
    // P2 §6 (`:445`): the card's facts are the action request's, not a message release's. Its `openedAt` is the
    // request's own intake time, never the message's saved time.
    expect(releaseCard.card.actionRelease?.action).toBe('dispatch');
    const requestedAt = releaseCard.card.actionRelease?.requestedAt;
    expect(requestedAt, 'the action request carries its intake time').toEqual(expect.any(String));
    expect(releaseCard.card.openedAt).toBe(requestedAt);
    const releasePage = await cards.route('main/read', { goalId: m05.goalId, cursor: null }) as { value: { cards: DecisionCardV1[] } };
    expect(releasePage.value.cards.find(entry => entry.source.key === expectedKey)?.openedAt).toBe(requestedAt);

    opened.world.clock.advance(1_000);
    const approved = await answerS7A2Card(opened.world,
      { source: releaseCard.source, optionId: 'approve', label: 'g-card-approve' });
    const afterAnswer = await view(request.ref);
    // The answer moves the ActionRequest's CAS revision; the card key still carries the creation revision.
    const afterApproveCard = ready<DecisionCardV1>(
      await cards.route('decisions/card', { source: releaseCard.source }), 'the answered action-release card');
    expect(afterApproveCard.source.key).toBe(expectedKey);
    expect(afterApproveCard.actionRelease?.state).toBe('open');
    // The request's saved time wins over the synthetic answer written at the later clock.
    expect(afterApproveCard.openedAt).toBe(requestedAt);

    const replayed = await answerS7A2Card(opened.world,
      { source: releaseCard.source, optionId: 'approve', label: 'g-card-approve' });
    expect(replayed.answer).toEqual({ ...approved.answer, replayed: true });
    // P2 §2.6: the action_release ② adapter calls the ActionRequest owner; a committed approval is handed back as the
    // ③ application's receipt, never as a message action, on the answer and on its replay (no second application).
    expect(approved.action).toBeNull();
    expect(replayed.action).toBeNull();
    const appliedOnce = approved.application;
    if (appliedOnce === null || appliedOnce.status !== 'committed') {
      throw new Error('G-card: the approval recorded no application');
    }
    expect(replayed.application).toMatchObject({ status: 'committed', value: appliedOnce.value });
    expect(await view(request.ref)).toEqual(afterAnswer);

    const counterBefore = await readS7A2DispatchBasis(opened.world, m05);
    opened.world.clock.advance(90_000);
    const answered = await driveS7A2Release(opened.world,
      { goal: m05, messageRef: request.ref, label: 'g-card-m05', source: releaseCard.source });
    // P2: the card answer moves the ActionRequest, never the message — its saved deadline and dispatch
    // values stay exactly what the send wrote, and the Goal's dispatch counter does not move.
    expect(answered.message.deadline).toBe(request.deadline);
    expect(answered.message.deadlineMs).toBe(request.deadlineMs);
    const answeredCard = ready<DecisionCardV1>(
      await cards.route('decisions/card', { source: releaseCard.source }), 'the answered action-release card');
    expect(answeredCard.actionRelease?.ref).toEqual(releaseCard.card.actionRelease?.ref);
    expect(answeredCard.state).toBe('closed');
    expect(answeredCard.closedReason).toBe('source_resolved');
    expect(answeredCard.readOnly).toBe(true);
    expect(answeredCard.answer).not.toBeNull();
    expect(answeredCard.openedAt).toBe(requestedAt);
    expect(answered.basis.dispatchSequence).toBe(counterBefore.dispatchSequence);

    const deniedRequest = await send('g-card-deny');
    const deniedCard = await readS7A2Card(opened.world, m05);
    const denied = await answerS7A2Card(opened.world,
      { source: deniedCard.source, optionId: 'deny', label: 'g-card-deny' });
    const afterDeny = ready<DecisionCardV1>(
      await cards.route('decisions/card', { source: deniedCard.source }), 'the denied action-release card');
    expect(afterDeny.state).toBe('closed');
    expect(afterDeny.closedReason).toBe('source_resolved');

    // P2: a plan move leaves the waiting card open and projects no `stale_pins`; a paused Goal is a `goal_paused`
    // blocker. The two reads after it write neither the message nor the Goal's dispatch facts.
    const staleRequest = await send('g-card-stale');
    const staleCard = await readS7A2Card(opened.world, m05);
    await answerS7A2Card(opened.world,
      { source: staleCard.source, optionId: 'approve', label: 'g-card-stale' });
    await moveS7APlan(opened.world, m05);
    const messageBefore = await view(staleRequest.ref);
    const basisBefore = await readS7A2DispatchBasis(opened.world, m05);
    const stale = ready<DecisionCardV1>(
      await cards.route('decisions/card', { source: staleCard.source }), 'the stale release card');
    // P2: a waiting dispatch card still lets the Task be claimed, so it projects no `stale_pins`
    // (`views/decision-read-model.ts`); its blockers are the request's live ones.
    expect(stale.actionRelease?.blockedBy).toEqual([]);
    // The three reads above wrote neither the message nor the Goal's dispatch facts.
    expect(await view(staleRequest.ref)).toEqual(messageBefore);
    expect(await readS7A2DispatchBasis(opened.world, m05)).toEqual(basisBefore);

    await pauseS7AGoal(opened.world, m05);
    const pausedRequest = ready<DecisionCardV1>(
      await cards.route('decisions/card', { source: staleCard.source }), 'the paused release card');
    expect(pausedRequest.actionRelease?.blockedBy).toContainEqual({ kind: 'goal_paused' });
    expect(pausedRequest.candidateStatus).toBeNull();
    expect(pausedRequest.staleReason).toBeNull();

    // ---- case 2: an inquiry never turns stale; a paused inquiry is goal_not_active; a direct release ----------
    const second = await openWorld();
    const { goal: inquiryGoal } = await seedS7AGoalPlan(second.world, { pointer: 'g-card-inquiry' });
    await setS7AAutonomy(second.world, inquiryGoal, 'every_step');
    const inquiry = await sendS7A2RequestWithDispatch(second.world, { label: 'g-card-inquiry', goal: inquiryGoal,
      recipient: second.session.ref });
    const inquiryCard = await readS7A2Card(second.world, inquiryGoal);
    await answerS7A2Card(second.world,
      { source: inquiryCard.source, optionId: 'approve', label: 'g-card-inquiry' });
    await moveS7APlan(second.world, inquiryGoal);
    const movedInquiry = ready<DecisionCardV1>(
      await s6aCardsWorkspace(second.world, S6A_SCOPE).route('decisions/card', { source: inquiryCard.source }),
      'the moved inquiry card');
    expect(movedInquiry.actionRelease?.blockedBy).toEqual([]);
    expect(movedInquiry.candidateStatus).toBeNull();
    expect(movedInquiry.source).toMatchObject({ kind: 'action_release' });
    expect(movedInquiry.source.key).toBe(inquiryCard.card.cardKey);

    await pauseS7AGoal(second.world, inquiryGoal);
    const pausedInquiry = ready<DecisionCardV1>(
      await s6aCardsWorkspace(second.world, S6A_SCOPE).route('decisions/card', { source: inquiryCard.source }),
      'the paused inquiry card');
    expect(pausedInquiry.actionRelease?.blockedBy).toContainEqual({ kind: 'goal_paused' });
    expect(pausedInquiry.candidateStatus).toBeNull();

    const { goal: directGoal } = await seedS7AGoalPlan(second.world, { pointer: 'g-card-direct' });
    await setS7AAutonomy(second.world, directGoal, 'after_plan_confirmation');
    const sentAt = second.world.clock.now();
    const direct = await sendS7A2RequestWithDispatch(second.world, { label: 'g-card-direct', goal: directGoal,
      recipient: second.session.ref });
    expect(direct.createdAt).toBe(sentAt);
    expect(direct.deadlineMs).not.toBeNull();
    // The record's own duration, measured from the send's commit instant; no source constant is restated.
    expect(direct.deadline).toBe(
      new Date(Date.parse(sentAt) + (direct.deadlineMs as number)).toISOString());
  };
  await exercise();
});
