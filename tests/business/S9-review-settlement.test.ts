/**
 * W4-settle and P2-3 (archiving the reviewer line in window 3) — slice 9 G3, shared S9 world; window 3 by one failed
 * commit of the Host's closing notice.
 * Named mutations: the exec settlement through the normal entry (COMPLETED first → `requestNewGoal`; red at
 * `answer_ready`); P2-3 ① the archive guard's settlement fact dropped (red at `archive_settlement_pending`); ② the
 * consumable view's settlement offer on an archive-requested line dropped (red at `withdrawnAt`); ③ an unreadable
 * settlement fact let through (red at `incomplete`); ④ the archive-requested line's offers not limited to settlements
 * (red at `kinds`: the person's message heads the line).
 * Today (no G3) red at: the world's guard "sent no exec review round". P2-3 on the G3 tree before its fix: ① the early
 * archive commits; ② archive-line archives at once (`state: 'archived'`, not `partial`); ③ the archive commits;
 * ④ archive-line archives at once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MESSAGE_BY_RECIPIENT_LOOKUP } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  consumeView, notices, readPlanningQuery, sessionQueries, waitForResponse, waitForWithdrawn,
} from '../helpers/IV-host-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  advanceS9Review, answerS9Review, bookS9Review, completeS9Task, finalizeS9Review, openS9ReviewWorld,
  s9ReviewerProfile, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryLookupBarrierModule(importOriginal));

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { commitBarrier.reset(); for (const world of worlds.splice(0)) await world.close(); });

const NO_ANSWER_NOTICE = '这次规划已结束，没有留下可用的回答，这条消息已撤回。请补充要求后重新发送。';
const failClosingNotice = (): void => { commitBarrier.failCommitOnce(byIdentityPrefix('session-message-send:')); };

/** The consumable view's offer for the reviewer line, then the one intervention entry on it. */
async function settle(review: S9ReviewWorld) {
  const { world } = review;
  const page = await world.platform.consumableSessions.readConsumableSessions(world.systemContext(),
    { workspace: S6A_SCOPE, after: null, limit: 50 });
  const offer = page.status === 'ready'
    ? page.value.items.find(item => item.session.sessionId === review.reviewLine?.ref.sessionId)?.nextMessage : undefined;
  return { offer, result: offer === null || offer === undefined ? null
    : await world.platform.workflow.handleIntervention!(world.systemContext(),
      { messageRef: offer.messageRef, ...s9ReviewerProfile() }) };
}

describe('W4-settle: the review source settles before the completed-Goal branch', () => {
  it('answered, Goal COMPLETED: answer_ready on the source only, no new Goal request, the round unchanged', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const { world } = review;
    const query = await answerS9Review(review, 'pass', { settle: false, beforeEnd: failClosingNotice });
    const evidenceRef = await bookS9Review(review, query.roundRef);
    expect(await finalizeS9Review(review, query.roundRef, 's9-w4-finalize', [evidenceRef]))
      .toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    expect(await completeS9Task(review, query.roundRef, 's9-w4-complete')).toMatchObject({ status: 'committed' });
    const steps = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: review.goal, flowId: 's9-w4-goal',
      sessionHint: null, kind: 'select_work' });
    expect(steps.at(-1)?.state).toBe('completed');
    const round = await world.platform.evidence.readVerification(world.humanContext(), query.roundRef);
    const { offer, result } = await settle(review);
    expect(offer).toMatchObject({ kind: 'action_request', messageRef: query.messageRef });
    expect(result).toMatchObject({ status: 'answer_ready', reason: 'answered' });
    expect((await waitForResponse(world, query.messageRef)).response).not.toBeNull();
    expect(await sessionQueries(world, review.reviewLine!)).toHaveLength(1);
    expect((await readPlanningQuery(world, query.messageRef))?.job.ref).toEqual(query.queryJobRef);
    expect(await world.platform.evidence.readVerification(world.humanContext(), query.roundRef)).toEqual(round);
  }, 180_000);

  it('P2-3 ①: the line is not archived while its ended review is unsettled; after the settlement it is', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const { world } = review;
    const query = await answerS9Review(review, 'pass', { settle: false, beforeEnd: failClosingNotice });
    const archive = async (requestId: string) => {
      const card = await world.readSession(review.reviewLine!);
      return (await world.post('sessions/archive', graphWrite(S6A_SCOPE, { sessionRef: review.reviewLine!.ref,
        reason: 'S9 P2-3' }, requestId, [{ ref: card.record.ref, revision: card.record.revision }]))).body;
    };
    expect(await archive('s9-p23-early')).toMatchObject({ status: 'rejected', code: 'busy',
      reason: expect.stringContaining('archive_settlement_pending') });
    expect((await world.readSession(review.reviewLine!)).record.lifecycle).toBe('active');
    expect((await waitForResponse(world, query.messageRef)).response).not.toBeNull();
    expect(await archive('s9-p23-late')).toMatchObject({ status: 'committed', value: { lifecycle: 'archived' } });
    expect(await advanceS9Review(review)).toMatchObject({ status: 'ready',
      value: { state: 'advance', next: { operation: { kind: 'record_review' } } } });
  }, 180_000);

  it('P2-3 ②: archive-line keeps its request until the Host withdraws the source; the continuation archives', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const { world } = review;
    const line = review.reviewLine!;
    const query = await answerS9Review(review, 'none', { settle: false, beforeEnd: failClosingNotice });
    const card = await world.readSession(line);
    expect((await world.post('sessions/archive-line', graphWrite(S6A_SCOPE, { sessionRef: line.ref, reason: 'S9 P2-3',
      tasks: [], wait: null }, 's9-p23-line', [{ ref: card.record.ref, revision: card.record.revision }]))).body)
      .toMatchObject({ status: 'ready', value: { state: 'partial', rejection: { code: 'busy' } } });
    expect((await world.readSession(line)).record).toMatchObject({ lifecycle: 'active',
      archiveRequest: { requestId: 's9-p23-line' } });
    expect((await waitForWithdrawn(world, query.messageRef)).withdrawnAt).not.toBeNull();
    expect(await notices(world, line, NO_ANSWER_NOTICE)).toHaveLength(1);
    expect((await world.post('sessions/archive-continue', plain(S6A_SCOPE, { sessionRef: line.ref,
      archiveRequestId: 's9-p23-line' }))).body).toMatchObject({ status: 'ready', value: { state: 'archived' } });
    expect(await advanceS9Review(review)).toMatchObject({ status: 'ready',
      value: { state: 'advance', next: { operation: { kind: 'finalize_checks' } } } });
  }, 180_000);

  it('P2-3 ③: the settlement fact cannot be read → the archive is refused (incomplete), nothing archived', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const card = await review.world.readSession(review.reviewLine!);
    const fault = commitBarrier.failReads(SESSION_MESSAGE_BY_RECIPIENT_LOOKUP, 'throw-always');
    const refused = (await review.world.post('sessions/archive', graphWrite(S6A_SCOPE, { sessionRef: review.reviewLine!.ref,
      reason: 'S9 P2-3' }, 's9-p23-unread', [{ ref: card.record.ref, revision: card.record.revision }]))).body;
    fault.release();
    expect(refused).toMatchObject({ status: 'rejected', code: 'incomplete' });
    expect((await review.world.readSession(review.reviewLine!)).record).toEqual(card.record);
  }, 120_000);

  it('P2-3 ④: an archive-requested line offers its unsettled source, not a person\'s newer message', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const { world } = review;
    const line = review.reviewLine!;
    const query = await answerS9Review(review, 'none', { settle: false, beforeEnd: failClosingNotice });
    const card = await world.readSession(line);
    expect((await world.post('sessions/archive-line', graphWrite(S6A_SCOPE, { sessionRef: line.ref, reason: 'S9 P2-3',
      tasks: [], wait: null }, 's9-p23-offer', [{ ref: card.record.ref, revision: card.record.revision }]))).body)
      .toMatchObject({ status: 'ready', value: { state: 'partial' } });
    await sendS7A2PersonMessage(world, { label: 's9-p23-person', recipient: line.ref, goal: review.goal });
    expect(await consumeView(world, line)).toMatchObject({ busy: 'archive_request', kinds: ['action_request'],
      nextMessage: { kind: 'action_request', messageRef: query.messageRef } });
  }, 120_000);

  it('closed without a verdict: no_answer, the one fixed notice, then the source withdrawn', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const query = await answerS9Review(review, 'none', { settle: false, beforeEnd: failClosingNotice });
    const { offer, result } = await settle(review);
    expect(offer).toMatchObject({ kind: 'action_request', messageRef: query.messageRef });
    expect(result).toMatchObject({ status: 'no_answer' });
    expect((await waitForWithdrawn(review.world, query.messageRef)).withdrawnAt).not.toBeNull();
    expect(await notices(review.world, review.reviewLine!, NO_ANSWER_NOTICE)).toHaveLength(1);
  }, 120_000);
});
