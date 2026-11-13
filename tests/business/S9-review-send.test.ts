/**
 * W2-send, W6 (a rejected send waits), R3 (XWR, was W7: a reviewer line only in another workspace) — shared S9 world.
 * Named mutations: W2 the send fills `taskRef` (red at `taskRef: null`); W6 the send rejection returned as the
 * advance's own rejection (red at `state:'waiting'`); R3 ① the review line found the G3 way again (this workspace
 * first, elsewhere only names the reason; red at the first advance: `review_line_other_workspace`), ② `readReviewState`
 * reads the message at the composed ref (red at `exec_review_pending`: not found, the send is selected again);
 * ③ `readAcceptedAnswer` at the composed ref (red at `record_review`: `incomplete`, the Query is not found there).
 * R3 red today at the first advance (`review_line_other_workspace`, G3 丙). R3's second workspace has the Host catalog's
 * model selected (`openS9SecondReviewLine`), so the Host consumes its line: the mirror world of W7, round in the main
 * workspace and line in the second (the other direction has no trusted checks in B, start rulings §0 item 3).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntil, readBody, readPlanningQuery, sessionQueries } from '../helpers/IV-host-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { listed, readS7BMessage } from '../helpers/S7B-fixture.js';
import {
  advanceS9Review, openS9ReviewRound, openS9ReviewWorld, openS9SecondReviewLine, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));

const worlds: S9ReviewWorld[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const PLAN_ROUND_SENDER = { kind: 'host', actor: { kind: 'system', id: 'host:plan-round' } };
const fromPlanRound = (message: SessionMessage): boolean =>
  message.sender.kind === 'host' && message.sender.actor.id === PLAN_ROUND_SENDER.actor.id;
const sendStepOf = (result: unknown): WorkflowAdvanceInput => (result as { value: { next: WorkflowAdvanceInput } }).value.next;
const sentMessage = (result: unknown): SessionMessage =>
  (result as { value: { receipt: { result: { value: SessionMessage } } } }).value.receipt.result.value;

describe('W2-send: send_system_round only from not_sent', () => {
  it('one execreview action request, its exec_review Query, and the same operation replayed', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const { world } = review;
    const round = await openS9ReviewRound({ review });
    const selected = await advanceS9Review(review);
    const send = selected.status === 'ready' ? selected.value.next : null;
    expect(send?.kind === 'perform' ? send.operation.kind : send).toBe('send_system_round');
    const sent = await advanceS9Review(review, send!);
    expect(sent).toMatchObject({ status: 'ready', value: { state: 'advance', next: { kind: 'select_work' },
      receipt: { kind: 'send_system_round', result: { status: 'committed' } } } });
    const messageRef = sentMessage(sent).ref;
    expect(await readS7BMessage(world, messageRef)).toMatchObject({ intent: 'action_request', needsReply: true,
      goalRef: review.goal, taskRef: null, sender: PLAN_ROUND_SENDER });
    expect((await readBody(world, messageRef, 'message')).split('\n')[0]).toBe(`execreview:${round.roundRef.roundId}`);
    expect(await advanceS9Review(review, send!)).toMatchObject({ status: 'ready',
      value: { receipt: { kind: 'send_system_round', result: { status: 'skipped', reason: 'already_committed' } } } });
    expect((await listed(world, 'inbox', review.reviewLine!)).filter(fromPlanRound).map(message => message.ref))
      .toEqual([messageRef]);
    // The line lists its Query once the Host has claimed it (the pass after the one that creates it).
    const query = await heartbeatUntil(world, () => readPlanningQuery(world, messageRef),
      value => (value?.run.run.executionState ?? null) !== null, 4);
    expect(query?.job.job.intent.execution).toMatchObject({ kind: 'intervention_planning', answerShape: 'exec_review' });
    expect(await sessionQueries(world, review.reviewLine!)).toHaveLength(1);
  }, 120_000);

  it('no reviewer line: two advances wait with no receipt and no message or Query', async () => {
    const review = await openS9ReviewWorld({ reviewLine: 'none' });
    worlds.push(review);
    const round = await openS9ReviewRound({ review });
    for (const pass of [1, 2]) {
      expect(await advanceS9Review(review), `advance ${String(pass)}`).toMatchObject({ status: 'ready',
        value: { state: 'waiting', reason: 'no_review_line', receipt: null, next: null } });
    }
    const messageRef = systemRoundMessageRef(S6A_SCOPE, `execreview:${round.roundRef.roundId}`);
    if (messageRef.status !== 'ready') throw new Error('W2: no message ref for the round');
    expect((await review.world.post('messages/read', plain(S6A_SCOPE, messageRef.value))).body)
      .toMatchObject({ status: 'not_found' });
    expect((await review.world.post('queries/read', plain(S6A_SCOPE,
      interventionPlanningQueryRefs(messageRef.value).queryJobRef))).body).toMatchObject({ status: 'not_found' });
  }, 120_000);

  it('W6: an unavailable send waits with its receipt, the round open; the next selection sends the same round', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const { evidence } = review.world.platform;
    const ctx = review.world.humanContext();
    const round = await openS9ReviewRound({ review });
    const send = round.next;
    expect(send?.kind === 'perform' ? send.operation.kind : send).toBe('send_system_round');
    const open = await evidence.readVerification(ctx, round.roundRef);
    const fault = commitBarrier.failCommitOnce(byIdentityPrefix('session-message-send:'));
    const rejected = await advanceS9Review(review, send!);
    fault.release();
    expect(rejected).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null,
      receipt: { kind: 'send_system_round', result: { status: 'rejected', code: 'unavailable' } } } });
    expect(await evidence.readVerification(ctx, round.roundRef)).toEqual(open);
    const again = await advanceS9Review(review);
    expect(again).toMatchObject({ status: 'ready', value: { state: 'advance', next: { operation: {
      kind: 'send_system_round', request: { round: { kind: 'exec_review', roundRef: round.roundRef } } } } } });
    const sent = await advanceS9Review(review, sendStepOf(again));
    expect(sent).toMatchObject({ status: 'ready', value: { receipt: { kind: 'send_system_round',
      result: { status: 'committed' } } } });
    expect(sentMessage(sent).recipient).toEqual(review.reviewLine!.ref);
  }, 120_000);

  it('R3 (was W7): a reviewer line only in another workspace gets the exec review; the Query stays the round\'s', async () => {
    const review = await openS9ReviewWorld({ reviewLine: 'none' });
    worlds.push(review);
    const { world } = review;
    const { second, line } = await openS9SecondReviewLine(review, 's9-w7');
    cleanups.push(second.remove);
    expect(await second.workspace.route('sessions/read', line.ref)).toMatchObject({ status: 'ready',
      value: { record: { workspaceId: second.scope.workspaceId } } });
    const round = await openS9ReviewRound({ review });
    expect(round.roundRef.workspaceId).toBe(S6A_SCOPE.workspaceId);
    const selected = await advanceS9Review(review);
    expect(selected).toMatchObject({ status: 'ready', value: { state: 'advance', next: { operation: {
      kind: 'send_system_round', request: { recipient: line.ref } } } } });
    await world.scripted.script(line, [{ kind: 'calls', calls: [{ callId: 's9-r3-pass', name: 'submit_exec_review',
      args: { verdict: 'pass', basis: 'S9 R3 basis', report: 'S9 R3 report' } }] }], second.scope);
    await advanceS9Review(review, sendStepOf(selected));
    expect(await advanceS9Review(review)).toMatchObject({ status: 'ready',
      value: { state: 'waiting', reason: 'exec_review_pending' } });
    const inbox = await second.workspace.route('messages/inbox', { recipient: line.ref, page: { limit: 20 } });
    const [sent] = (inbox as { value: { items: SessionMessage[] } }).value.items.filter(fromPlanRound);
    const settled = await heartbeatUntil(world, async () => ready<SessionMessage>(await second.workspace.route(
      'messages/read', sent!.ref), 'the review message'), message => message.response !== null, 24);
    expect(settled.response).not.toBeNull();
    // X-1: the Query is the round's Goal's (main), under the real message's id.
    const queryRef = interventionPlanningQueryRefs(sent!.ref).queryJobRef;
    expect((await world.post('queries/read', plain(S6A_SCOPE, { ...queryRef, workspaceId: S6A_SCOPE.workspaceId })))
      .body).toMatchObject({ status: 'ready', value: { job: { job: { status: 'answered' } } } });
    expect(await second.workspace.route('queries/read', queryRef)).toMatchObject({ status: 'not_found' });
    const booked = await advanceS9Review(review, sendStepOf(await advanceS9Review(review)));
    expect(booked).toMatchObject({ status: 'ready', value: { receipt: { kind: 'record_review',
      result: { status: 'committed' } }, next: { operation: { kind: 'finalize_checks' } } } });
    await advanceS9Review(review, sendStepOf(booked));
    expect(await world.platform.evidence.readVerification(world.humanContext(), round.roundRef)).toMatchObject({
      status: 'ready', value: { status: 'finalized', outcome: 'PASS' } });
    const queue = ready<DecisionQueueReadV1>(await world.post('decisions/queue', plain(S6A_SCOPE, {
      workspace: S6A_SCOPE, sections: ['notices'], categories: ['plan_notice'], page: { limit: 100 } })), 'the queue');
    expect(queue.notices.map(item => item.itemKey)).not.toContain(`exec-review-no-line:${review.goal.goalId}:${
      round.roundRef.roundId}`);
  }, 180_000);
});
