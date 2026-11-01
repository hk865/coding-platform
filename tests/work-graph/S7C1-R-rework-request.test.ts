/**
 * R-request/R-history/R-closed-answer (`book-7c.md:1359–:1360`, third note item 1): the real
 * `request_rework` tool call on an entered Work Run, the pending request's card in the all-state card source, the
 * stale request staying in `history`, and the applied card left open by the saved answer.
 *
 * The world is the L46 one: its Work binding gets the two rework names at open time (the helper's caller-grant
 * wrapper), A's Run really ended unsuccessful and the every_step setting is installed by the fixture. The request is
 * the Kernel's own tool call, scripted and released at the real gate; every later read is `decisions/queue` /
 * `decisions/card` and every later write is `decisions/answer`. No record, card or context is built here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { ResolveDecisionReadV1 } from '../../src/business/workflow/contracts.js';
import { answer } from '../helpers/A2-restart-fixture.js';
import { draftFrom } from '../scenarios/support/common.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { openS7BL46World, requestL46Rework } from '../helpers/S7B-L46-fixture.js';

let world: S6AHostWorld | undefined;
afterEach(async () => { await world?.close().catch(() => undefined); world = undefined; });

async function reworkQueueOf(host: S6AHostWorld, goalRef: GoalRef): Promise<DecisionQueueReadV1> {
  return ready<DecisionQueueReadV1>(await host.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, goalRef,
    sections: ['waiting_answer', 'answered_pending_application', 'history'], page: { limit: 100 },
  })), 'the decision queue');
}

function reworkCardOf(queue: DecisionQueueReadV1, key?: string): DecisionCardV1 {
  const card = [...queue.waitingAnswer, ...queue.answeredPendingApplication, ...queue.history]
    .find(entry => entry.source.kind === 'rework_request' && (key === undefined || entry.source.key === key));
  if (card === undefined) throw new Error(`S7C1 R: no rework_request card in the queue: ${JSON.stringify({
    waiting: queue.waitingAnswer.map(entry => entry.source.kind),
    answered: queue.answeredPendingApplication.map(entry => entry.source.kind),
    history: queue.history.map(entry => [entry.source.kind, entry.closedReason]),
  })}`);
  return card;
}

/** `decisions/answer` on the card's own source at its captured pins. */
async function answerReworkCard(host: S6AHostWorld, card: DecisionCardV1,
  optionId: 'approve' | 'reject', requestId: string): Promise<ResolveDecisionReadV1> {
  return ready<ResolveDecisionReadV1>(await answer(host.ag2b, 'decisions/answer', graphWrite(S6A_SCOPE, {
    source: card.source, selection: { kind: 'option', optionId }, text: '', annotations: [],
  }, requestId, card.source.pins)), `the ${optionId} answer`);
}

/** The pending read the Host's own block uses: a named Task advance surfaces the pending request source. */
async function advanceSource(host: S6AHostWorld, goalRef: GoalRef, taskId: string, flowId: string) {
  const answerBody = await host.post('workflow/advance', plain(S6A_SCOPE, {
    schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work', taskId,
  }));
  const body = answerBody.body as { status: string; value?: {
    state: string; next: unknown; reason: string | null; source?: { kind: string; key: string } | null } };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`S7C1 R: the advance was not ready: ${JSON.stringify(body)}`);
  }
  return body.value;
}

describe('R-request: the real tool writes a pending request and its card', () => {
  it('R-REQUEST-02: the request_rework/request_recheck tool writes a pending request and its card', async () => {
    const opened = await openS7BL46World({ backend: 'memory' });
    world = opened.world;
    const tasks = opened.tasks;

    const requested = await requestL46Rework(world, { goalRef: opened.goalRef, tasks,
      afterRun: opened.run, label: 's7c1-r-request', reason: 'S7C1 R: request the rework of A',
      callId: 's7c1-r-request-call' });
    expect(requested.call.name).toBe('request_rework');

    // The every_step card: one waiting `rework_request` card over the tool's pending record.
    const queue = await reworkQueueOf(world, opened.goalRef);
    const listed = reworkCardOf(queue);
    expect(listed).toMatchObject({ state: 'waiting_answer', closedReason: null,
      options: [{ id: 'approve', effect: 'apply' }, { id: 'reject', effect: 'reject' }],
      senderSessionRef: requested.line.ref });
    const card = ready<DecisionCardV1>(await world.post('decisions/card', plain(S6A_SCOPE,
      { source: listed.source })), 'the rework card');
    expect(card.source).toEqual(listed.source);
    expect(card.cardKey).toBe(listed.cardKey);
    // The request names Task A: its own aggregate pin and the Task's absence pin are the card's objects.
    const pins = card.objects.flatMap(object => object.kind === 'aggregate' ? [object.pin] : []);
    expect(pins).toEqual(expect.arrayContaining([
      expect.objectContaining({ revision: 1, ref: expect.objectContaining({
        aggregateType: 'ReworkRequest', taskId: tasks.A.taskId }) }),
      expect.objectContaining({ revision: 0, ref: expect.objectContaining({
        aggregateType: 'Task', taskId: tasks.A.taskId }) }),
    ]));

    // The record is pending, not merely projected: the Host's own pending read blocks A with this source.
    const blocked = await advanceSource(world, opened.goalRef, tasks.A.taskId, 's7c1-r-request-block');
    expect(blocked).toMatchObject({ state: 'waiting', next: null, reason: 'rework_request_pending',
      source: { kind: 'rework_request', key: card.source.key } });

    // Only the one request tool produced a rework_request card; the automatic card is the fixture's goal_cause.
    expect(queue.waitingAnswer.filter(entry => entry.source.kind === 'rework_request')).toHaveLength(1);
  });
});

describe('R-history: a closed real source card is still enumerated', () => {
  it('R-HISTORY-01: a rejected/stale request stays in the all-state card source', async () => {
    const opened = await openS7BL46World({ backend: 'memory' });
    world = opened.world;
    const tasks = opened.tasks;

    await requestL46Rework(world, { goalRef: opened.goalRef, tasks, afterRun: opened.run,
      label: 's7c1-r-history', reason: 'S7C1 R: request the rework of A', callId: 's7c1-r-history-call' });
    const listed = reworkCardOf(await reworkQueueOf(world, opened.goalRef));

    // The person rejects the card: the request closes `rejected` and stays enumerated by the all-state source.
    const resolved = await answerReworkCard(world, listed, 'reject', 's7c1-r-history-answer');
    expect(resolved.answer.status).toBe('committed');
    // The reject is the request's close effect: answered, no action and no application receipt.
    expect(resolved.action).toBeNull();
    expect(resolved.application).toBeNull();
    expect(resolved.state).toBe('answered');

    const queue = await reworkQueueOf(world, opened.goalRef);
    const closed = queue.history.find(entry => entry.source.key === listed.source.key);
    expect(closed).toBeDefined();
    expect(closed).toMatchObject({ state: 'answered_no_application', closedReason: 'source_resolved' });
    expect(queue.waitingAnswer.filter(entry => entry.source.key === listed.source.key)).toEqual([]);
    expect(queue.answeredPendingApplication.filter(entry => entry.source.key === listed.source.key)).toEqual([]);
  });
});

describe('R-closed-answer: the applied card stays open in the queue', () => {
  it('R-CLOSED-ANSWER-01: the real saved answer leaves the applied card closedReason null', async () => {
    const opened = await openS7BL46World({ backend: 'memory' });
    world = opened.world;
    const tasks = opened.tasks;

    await requestL46Rework(world, { goalRef: opened.goalRef, tasks, afterRun: opened.run,
      label: 's7c1-r-closed', reason: 'S7C1 R: request the rework of A', callId: 's7c1-r-closed-call' });
    const listed = reworkCardOf(await reworkQueueOf(world, opened.goalRef));

    const resolved = await answerReworkCard(world, listed, 'approve', 's7c1-r-closed-answer');
    expect(resolved.answer.status).toBe('committed');

    // The applied request record keeps `closedReason: null`; the saved answer overlay is its open result.
    const queue = await reworkQueueOf(world, opened.goalRef);
    const applied = [...queue.answeredPendingApplication, ...queue.history]
      .find(entry => entry.source.key === listed.source.key);
    expect(applied).toBeDefined();
    expect(applied!.closedReason).toBeNull();
    expect(applied!.answer).not.toBeNull();
    expect(queue.waitingAnswer.filter(entry => entry.source.key === listed.source.key)).toEqual([]);
  });
});
