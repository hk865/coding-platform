/**
 * W2-send, W6 (a rejected send waits), W7 (a reviewer line only in another workspace) — slice 9 G3, shared S9 world.
 * Named mutations: W2 the send fills `taskRef` (red at `taskRef: null`); W6 the send rejection returned as the
 * advance's own rejection (red at `state:'waiting'`); W7 (a) `readReviewState` sends to a line found elsewhere in the
 * project (red at `review_line_other_workspace`), (b) the no-line notice keeps a project-wide "has a line" read (red
 * at the notice text).
 * Today (no G3) red at: every selection's step is `finalize_checks`, not `send_system_round`; W2's no-line advance is
 * `state:'advance'`. W7 on the G3 tree before the step-back: the selection sends to the other workspace's line.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { systemRoundMessageRef } from '../../src/contracts/plan-round.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntil, readBody, readPlanningQuery, sessionQueries } from '../helpers/IV-host-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { listed, readS7BMessage } from '../helpers/S7B-fixture.js';
import { addS7D2SecondWorkspace } from '../helpers/S7D2-role-line-world.js';
import { advanceS9Review, openS9ReviewRound, openS9ReviewWorld, type S9ReviewWorld } from '../helpers/S9-review-fixture.js';

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

  it('W7: a reviewer line only in another workspace is a wait and a plain notice, never a send', async () => {
    const review = await openS9ReviewWorld({ reviewLine: 'none' });
    worlds.push(review);
    const second = await addS7D2SecondWorkspace(review.world, 's9-w7');
    cleanups.push(second.remove);
    // `role-lines/open` puts a Host's line in the main workspace; `sessions/create` keeps this one in the second.
    const line = (await createS6BLine(second.workspace, { label: 's9-w7-review',
      role: platformRoleProfile('reviewer').template })).ref;
    expect(await second.workspace.route('sessions/read', line)).toMatchObject({ status: 'ready',
      value: { record: { workspaceId: second.scope.workspaceId } } });
    const round = await openS9ReviewRound({ review });
    expect(round.roundRef.workspaceId).toBe(S6A_SCOPE.workspaceId);
    for (const pass of [1, 2]) {
      expect(await advanceS9Review(review), `advance ${String(pass)}`).toMatchObject({ status: 'ready',
        value: { state: 'waiting', reason: 'review_line_other_workspace', receipt: null, next: null } });
    }
    const inbox = await second.workspace.route('messages/inbox', { recipient: line, page: { limit: 20 } });
    expect((inbox as { value: { items: SessionMessage[] } }).value.items.filter(fromPlanRound)).toEqual([]);
    const queue = ready<DecisionQueueReadV1>(await review.world.post('decisions/queue', plain(S6A_SCOPE, {
      workspace: S6A_SCOPE, sections: ['notices'], categories: ['plan_notice'], page: { limit: 100 } })), 'the queue');
    const notice = queue.notices.find(item => item.itemKey === `exec-review-no-line:${review.goal.goalId}:${
      round.roundRef.roundId}`)?.summary;
    for (const part of ['审阅线不在这个工作区', '还没接通']) expect(notice).toContain(part);
    expect(notice).not.toContain('role-lines/open');
  }, 180_000);
});
