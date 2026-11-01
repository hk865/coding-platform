/**
 * R-apply (`book-7c.md:1360`): the person's approved request applies through R's one trusted entry
 * (`applyApprovedReworkRequest`, reached by L1's `rework_request` ② adapter from `decisions/answer`) and the same
 * command id replays the original answer/application receipt instead of writing a second revision.
 *
 * The world is the L46 one with its open-time Work grant; the request is the real `request_rework` tool call on the
 * B line's entered Run for A's ended Run. The answer and the replay are the public `decisions/answer` route at the
 * card's own pins. Both backends run the receipt/replay sub-row.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { ResolveDecisionReadV1 } from '../../src/business/workflow/contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { openS7BL46World, requestL46Rework } from '../helpers/S7B-L46-fixture.js';

let world: S6AHostWorld | undefined;
afterEach(async () => { await world?.close().catch(() => undefined); world = undefined; });

async function reworkCard(host: S6AHostWorld, goalRef: GoalRef): Promise<DecisionCardV1> {
  const queue = ready<DecisionQueueReadV1>(await host.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, goalRef, sections: ['waiting_answer'], page: { limit: 100 },
  })), 'the L46 queue');
  const listed = queue.waitingAnswer.find(card => card.source.kind === 'rework_request');
  if (listed === undefined) throw new Error('S7C1 R-apply: no waiting rework_request card');
  return ready<DecisionCardV1>(await host.post('decisions/card', plain(S6A_SCOPE,
    { source: listed.source })), 'the rework card');
}

/** `decisions/answer` approve at the card's own pins; the same request id replays the same answer/application. */
async function approve(host: S6AHostWorld, card: DecisionCardV1, requestId: string): Promise<ResolveDecisionReadV1> {
  return ready<ResolveDecisionReadV1>(await host.post('decisions/answer', graphWrite(S6A_SCOPE, {
    source: card.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
  }, requestId, card.source.pins)), 'the approved rework application');
}

describe.each(['memory', 'sqlite'] as const)('R-apply: the approved application and its replay (%s)', backend => {
  it('R-APPLY-ROW-01: the person-approved pending request applies once; the same commandId replays', async () => {
    const opened = await openS7BL46World({ backend });
    world = opened.world;
    const tasks = opened.tasks;
    const { call } = await requestL46Rework(world, { goalRef: opened.goalRef, tasks, afterRun: opened.run,
      label: `s7c1-r-apply-${backend}`, reason: 'S7C1 R-apply: request the rework of A' });
    expect(call.name).toBe('request_rework');
    const card = await reworkCard(world, opened.goalRef);

    const first = await approve(world, card, `s7c1-r-apply-answer-${backend}`);
    expect(first.answer).toMatchObject({ status: 'committed' });
    // The ② adapter committed the owner's requeue and merged the request `applied`; ③ records its formal receipt.
    expect(first.state).toBe('applied');
    expect(first.application).toMatchObject({ status: 'committed' });

    // The applied request card is no longer waiting; it is the applied answer, never a pending application.
    const queue = ready<DecisionQueueReadV1>(await world.post('decisions/queue', plain(S6A_SCOPE, {
      workspace: S6A_SCOPE, goalRef: opened.goalRef,
      sections: ['waiting_answer', 'answered_pending_application', 'history'], page: { limit: 100 },
    })), 'the applied queue');
    const applied = queue.history.find(entry => entry.source.key === card.source.key);
    expect(applied).toBeDefined();
    expect(applied!.state).toBe('applied');
    expect(applied!.application).not.toBeNull();
    expect(applied!.closedReason).toBeNull();
    expect(applied!.answer).not.toBeNull();
    expect(queue.waitingAnswer.some(entry => entry.source.key === card.source.key)).toBe(false);
    expect(queue.answeredPendingApplication.some(entry => entry.source.key === card.source.key)).toBe(false);

    // The same command id replays the original answer/application result; no second revision is written.
    const again = await approve(world, card, `s7c1-r-apply-answer-${backend}`);
    // The replay answers the original value/cursor; only this call's replay flag differs.
    expect({ ...again.answer, replayed: false }).toEqual({ ...first.answer, replayed: false });
    expect(again.state).toBe(first.state);
    expect({ ...again.application, replayed: false }).toEqual({ ...first.application, replayed: false });
    const count = (await world.post('decisions/queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE,
      goalRef: opened.goalRef, sections: ['waiting_answer', 'answered_pending_application', 'history'],
      page: { limit: 100 } })));
    const after = ready<DecisionQueueReadV1>(count, 'the replayed queue');
    expect([...after.waitingAnswer, ...after.answeredPendingApplication, ...after.history]
      .filter(entry => entry.source.key === card.source.key)).toHaveLength(1);
  });

  it('R-APPLY-ROW-02: a source-stale request answers source_stale on the first and the replayed command, closing once', async () => {
    const opened = await openS7BL46World({ backend });
    world = opened.world;
    const tasks = opened.tasks;
    const label = `s7c1-r-stale-${backend}`;
    await requestL46Rework(world, { goalRef: opened.goalRef, tasks, afterRun: opened.run,
      label, reason: 'S7C1 R-apply: request the rework of A before its source moves' });
    const card = await reworkCard(world, opened.goalRef);

    // A real covering requeue of A commits after the pending request: the request's selected Run is now covered.
    const goal = ready<{ goal: { revision: number } }>(await world.post('goals/read',
      plain(S6A_SCOPE, opened.goalRef)), 'the L46 Goal');
    const afterRun = ready<{ run: { revision: number } }>(await world.post('executions/read',
      plain(S6A_SCOPE, opened.run)), 'the L46 afterRun');
    const covering = await world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
      taskRef: tasks.A, afterRunRef: opened.run,
      reason: 'S7C1 R-apply: cover the Run before the approved application',
    }, `${label}-covering`, [{ ref: opened.goalRef, revision: goal.goal.revision },
      { ref: opened.run, revision: afterRun.run.revision }]));
    expect(covering.body).toMatchObject({ status: 'committed' });

    // The owner closes the request stale in its own commit and answers `revision_conflict`; the adapter reads the
    // card's own closed record and reports `source_stale` without writing a second close.
    const first = await approve(world, card, `${label}-answer`);
    expect(first).toMatchObject({ answer: { status: 'committed' },
      action: { status: 'rejected', code: 'source_stale', reason: 'the rework request is stale' },
      application: null, state: 'application_not_recorded' });
    const afterFirst = ready<DecisionQueueReadV1>(await world.post('decisions/queue', plain(S6A_SCOPE, {
      workspace: S6A_SCOPE, goalRef: opened.goalRef,
      sections: ['waiting_answer', 'answered_pending_application', 'history'], page: { limit: 100 },
    })), 'the stale queue');
    const stale = [...afterFirst.waitingAnswer, ...afterFirst.answeredPendingApplication, ...afterFirst.history]
      .find(entry => entry.source.key === card.source.key);
    expect(stale).toMatchObject({ state: 'answered_no_application', closedReason: 'source_resolved' });
    // The SAME command id replays the answer and the same stale recognition; the record revision does not move.
    const again = await approve(world, card, `${label}-answer`);
    expect(again).toMatchObject({ answer: { status: 'committed' },
      action: { status: 'rejected', code: 'source_stale', reason: 'the rework request is stale' },
      application: null, state: 'application_not_recorded' });
    const afterSecond = ready<DecisionQueueReadV1>(await world.post('decisions/queue', plain(S6A_SCOPE, {
      workspace: S6A_SCOPE, goalRef: opened.goalRef,
      sections: ['waiting_answer', 'answered_pending_application', 'history'], page: { limit: 100 },
    })), 'the replayed stale queue');
    const unchanged = [...afterSecond.waitingAnswer, ...afterSecond.answeredPendingApplication,
      ...afterSecond.history].find(entry => entry.source.key === card.source.key);
    expect(unchanged!.state).toBe('answered_no_application');
    expect(unchanged!.closedReason).toBe('source_resolved');
    expect(unchanged!.source.pins).toEqual(stale!.source.pins);

    // A public apply of the same saved answer under ANOTHER command id cannot report the stale close as its own;
    // its owner refusal carries the current record pin. It is revision 2 after both answers: no second close wrote.
    const answerRef = first.answer.status === 'committed' ? first.answer.value.ref : null;
    if (answerRef === null) throw new Error('S7C1 R-apply: the first stale answer did not commit');
    const probe = await world.dispatch('workflow/advance', world.humanContext(), plain(S6A_SCOPE, {
      schemaVersion: 1, goalRef: opened.goalRef, flowId: `${label}-revision-probe`, sessionHint: null,
      kind: 'perform', operation: { kind: 'apply_review_disposition', request: graphWrite(S6A_SCOPE, {
        source: card.source, selection: { kind: 'option', optionId: 'approve' },
        decisionMessageRef: answerRef,
      }, `${label}-revision-probe`, card.source.pins).request },
    })) as { status: string; value?: { receipt?: { kind: string;
      result?: { status: string; value?: { action?: { status: string; code?: string;
        current?: { revision: number }[] } } } } } };
    const probeBody = probe;
    expect(probeBody.status).toBe('ready');
    expect(probeBody.value?.receipt?.kind).toBe('apply_review_disposition');
    expect(probeBody.value?.receipt?.result).toMatchObject({ status: 'ready',
      value: { action: { status: 'rejected', code: 'revision_conflict',
        current: [{ ref: expect.objectContaining({ aggregateType: 'ReworkRequest' }), revision: 2 }] } } });
  });
});
