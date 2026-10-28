/**
 * G-card (7a:725; SR4 §5): the `message_release` card's identity (message ref + creation revision, and a replay on
 * the same key), its approve and deny paths through `decisions/answer`, M-05's awaiting → approve → release deadline
 * and unchanged dispatch counter, the direct-release inquiry, and the one stale block on the card, the message view
 * and the outbox (with no read writing either record). An inquiry never turns stale; a paused Goal's parked card is
 * `goal_not_active`, never `candidateStatus: 'stale'`.
 *
 * Deferred form (SR4 §5; frozen fixture): the complete public steps and business assertions live in `exercise`; the
 * card source is L's registration, so the one deferred statement asserts `readS7A2Card`'s own named error and L
 * replaces only that statement with `await exercise();`.
 */
import { afterEach, expect, it } from 'vitest';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  SessionMessage, SessionMessageOutboxPageV1, SessionMessageReadV1,
} from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  committed, moveS7APlan, openS7AQueryWorld, pauseS7AGoal, ready, seedS7AGoalPlan, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';
import {
  answerS7A2Card, driveS7A2Release, readS7A2Card, readS7A2DispatchBasis, sendS7A2Request,
} from '../helpers/S7A2-fixture.js';

const DAY_MS = 86_400_000;
/** The first seeded Goal's fixed identity (`seedS7AGoalPlan` names it `s7a-goal-<pointer>`). */
const goal: GoalRef = { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: 's7a-goal-m05' };
const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

async function openWorld() {
  const opened = await openS7AQueryWorld({ backend: 'memory' });
  worlds.push(opened.world);
  return opened;
}

it('G-card: identity, approve/deny, M-05, the direct release and the one stale block (memory)', async () => {
  const exercise = async () => {
    // ---- case 1: M-05, the identity/replay, approve, deny, stale and paused -------------------------------
    const opened = await openWorld();
    const { goal: m05 } = await seedS7AGoalPlan(opened.world, { pointer: 'm05' });
    expect(m05).toEqual(goal);
    await setS7AAutonomy(opened.world, m05, 'every_step');
    const send = (label: string, intent: 'action_request' | 'inquiry') =>
      sendS7A2Request(opened.world, { label, goal: m05, recipient: opened.session.ref, intent });
    const view = async (ref: SessionMessage['ref']) => ready<SessionMessage>(
      await opened.world.post('messages/read', plain(S6A_SCOPE, ref)), 'the message read');

    const request = await send('g-card-request', 'inquiry');
    const releaseCard = await readS7A2Card(opened.world, m05);
    // The card became `awaiting` at creation, whose revision is 1; that revision, not the CAS one, is identity.
    const expectedKey = decisionSourceKey({ kind: 'message_release', messageRef: request.ref, revision: 1 });
    expect(releaseCard.card.source.key).toBe(expectedKey);
    expect(releaseCard.card.messageRelease?.deadline).toBeNull();

    const approved = await answerS7A2Card(opened.world,
      { source: releaseCard.source, optionId: 'approve', label: 'g-card-approve' });
    expect(committed<SessionMessage>(approved.action, 'the approve action').release).toBe('approved');
    const afterAnswer = await view(request.ref);
    expect(afterAnswer.release).toBe('approved');
    expect(afterAnswer.approvedAt).not.toBeNull();
    // The answer moved the message's CAS revision; the card key still carries the creation revision.
    const afterApproveCard = await readS7A2Card(opened.world, m05);
    expect(afterApproveCard.card.source.key).toBe(expectedKey);
    expect(afterApproveCard.card.messageRelease?.deadline).toBeNull();

    const replayed = await answerS7A2Card(opened.world,
      { source: releaseCard.source, optionId: 'approve', label: 'g-card-approve' });
    expect(replayed.answer).toEqual({ ...approved.answer, replayed: true });
    expect(replayed.action).toEqual({ ...approved.action, replayed: true });
    expect(await view(request.ref)).toEqual(afterAnswer);

    const counterBefore = await readS7A2DispatchBasis(opened.world, m05);
    opened.world.clock.advance(90_000);
    const releaseAt = opened.world.clock.now();
    const released = await driveS7A2Release(opened.world,
      { goal: m05, messageRef: request.ref, label: 'g-card-m05' });
    expect(released.message.release).toBe('released');
    // The record carries no `releasedAt`: its `deadline` is the release instant plus its own `deadlineMs`.
    const releasedDeadline = released.message.deadline;
    const releasedDeadlineMs = released.message.deadlineMs;
    expect(releasedDeadline).not.toBeNull();
    expect(releasedDeadlineMs).not.toBeNull();
    const releasedAt = new Date(Date.parse(releasedDeadline!) - (releasedDeadlineMs as number)).toISOString();
    expect(releasedAt).toBe(releaseAt);
    expect(releasedDeadline).toBe(new Date(Date.parse(releasedAt) + DAY_MS).toISOString());
    // The single card, re-read through the public route with the queue's own returned source.
    const cards = s6aCardsWorkspace(opened.world, S6A_SCOPE);
    const releasedCard = ready<DecisionCardV1>(
      await cards.route('decisions/card', { source: releaseCard.source }), 'the released release card');
    expect(releasedCard.messageRelease?.deadline).toBe(releasedDeadline);
    expect(releasedCard.messageRelease?.deadline).toBe(
      new Date(Date.parse(releasedAt) + DAY_MS).toISOString());
    expect(releasedCard.state).toBe('closed');
    expect(releasedCard.closedReason).toBe('source_resolved');
    expect(releasedCard.readOnly).toBe(true);
    expect(released.basis.dispatchSequence).toBe(counterBefore.dispatchSequence);

    const deniedRequest = await send('g-card-deny', 'action_request');
    const deniedCard = await readS7A2Card(opened.world, m05);
    const denied = await answerS7A2Card(opened.world,
      { source: deniedCard.source, optionId: 'deny', label: 'g-card-deny' });
    const deniedMessage = committed<SessionMessage>(denied.action, 'the deny action');
    expect(deniedMessage.release).toBe('denied');
    expect(deniedMessage.approvedAt).toBeNull();

    // The same plan move leaves the inquiry open but makes the approved action_request stale.
    const staleRequest = await send('g-card-stale', 'action_request');
    const staleCard = await readS7A2Card(opened.world, m05);
    await answerS7A2Card(opened.world,
      { source: staleCard.source, optionId: 'approve', label: 'g-card-stale' });
    await moveS7APlan(opened.world, m05);
    const basis = await readS7A2DispatchBasis(opened.world, m05);
    const messageBefore = await view(staleRequest.ref);
    const basisBefore = await readS7A2DispatchBasis(opened.world, m05);
    const stale = ready<DecisionCardV1>(
      await cards.route('decisions/card', { source: staleCard.source }), 'the stale release card');
    const block = stale.messageRelease?.releaseBlock;
    expect(block?.blockedReason).toBe('stale_pins');
    expect(block?.current).toMatchObject(basis);
    const viewRead = ready<SessionMessageReadV1>(
      await opened.world.post('messages/view', plain(S6A_SCOPE, staleRequest.ref)), 'the message view');
    expect(viewRead.releaseBlock).toEqual(block);
    const sender = staleRequest.sender;
    if (sender.kind !== 'secretary_round') throw new Error('S7A2: the request was not a secretary send');
    const outbox = ready<SessionMessageOutboxPageV1>(await opened.world.post('messages/outbox',
      plain(S6A_SCOPE, { senderSession: sender.sessionRef, page: { limit: 100 } })), 'the outbox');
    const index = outbox.items.findIndex(item => item.ref.messageId === staleRequest.ref.messageId);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(outbox.releaseBlocks[index]).toEqual(block);
    // The three reads above wrote neither the message nor the Goal's dispatch facts.
    expect(await view(staleRequest.ref)).toEqual(messageBefore);
    expect(await readS7A2DispatchBasis(opened.world, m05)).toEqual(basisBefore);

    await pauseS7AGoal(opened.world, m05);
    const pausedRequest = ready<DecisionCardV1>(
      await cards.route('decisions/card', { source: staleCard.source }), 'the paused release card');
    expect(pausedRequest.messageRelease?.releaseBlock?.blockedReason).toBe('goal_not_active');
    expect(pausedRequest.candidateStatus).toBeNull();
    expect(pausedRequest.staleReason).toBeNull();

    // ---- case 2: an inquiry never turns stale; a paused inquiry is goal_not_active; a direct release ----------
    const second = await openWorld();
    const { goal: inquiryGoal } = await seedS7AGoalPlan(second.world, { pointer: 'g-card-inquiry' });
    await setS7AAutonomy(second.world, inquiryGoal, 'every_step');
    const inquiry = await sendS7A2Request(second.world, { label: 'g-card-inquiry', goal: inquiryGoal,
      recipient: second.session.ref, intent: 'inquiry' });
    const inquiryCard = await readS7A2Card(second.world, inquiryGoal);
    await answerS7A2Card(second.world,
      { source: inquiryCard.source, optionId: 'approve', label: 'g-card-inquiry' });
    await moveS7APlan(second.world, inquiryGoal);
    const movedInquiry = await readS7A2Card(second.world, inquiryGoal);
    expect(movedInquiry.card.messageRelease?.releaseBlock?.blockedReason).toBeNull();
    expect(movedInquiry.card.candidateStatus).toBeNull();
    expect(movedInquiry.card.source.key).toBe(
      decisionSourceKey({ kind: 'message_release', messageRef: inquiry.ref, revision: 1 }));

    await pauseS7AGoal(second.world, inquiryGoal);
    const pausedInquiry = await readS7A2Card(second.world, inquiryGoal);
    expect(pausedInquiry.card.messageRelease?.releaseBlock?.blockedReason).toBe('goal_not_active');
    expect(pausedInquiry.card.candidateStatus).toBeNull();

    const { goal: directGoal } = await seedS7AGoalPlan(second.world, { pointer: 'g-card-direct' });
    await setS7AAutonomy(second.world, directGoal, 'after_plan_confirmation');
    const sentAt = second.world.clock.now();
    const direct = await sendS7A2Request(second.world, { label: 'g-card-direct', goal: directGoal,
      recipient: second.session.ref, intent: 'inquiry' });
    expect(direct.release).toBe('released');
    expect(direct.createdAt).toBe(sentAt);
    expect(direct.deadlineMs).not.toBeNull();
    // The record's own duration, measured from the send's commit instant; no source constant is restated.
    expect(direct.deadline).toBe(
      new Date(Date.parse(sentAt) + (direct.deadlineMs as number)).toISOString());
  };
  await exercise();
});
