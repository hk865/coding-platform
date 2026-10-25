/**
 * Group Q (slice 2A) QA-08: card semantics regression. A cancelled Goal's
 * waiting cards move to read-only history; an answered-and-applied synthetic
 * answer leaves the open queue.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { DecisionApplicationReceiptV1 } from '../../src/contracts/core/session-message.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { setGoalControlFromHost } from '../../src/core/work-graph/tasks/goal-control.js';
import { GOAL_B, GOAL_C, OPERATOR, PLAN_C1, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { captureCommits, committed, goalAt, owners, pin, ready } from '../helpers/S5-application-support.js';
import { requestCards, requestKey } from '../helpers/S5R2-a-support.js';
import { readGoalQueue, sendUserDecision, startRun } from '../helpers/S2A-queue-fixture.js';
import { workContext } from '../helpers/S5-user-message-support.js';

describe.each(['memory', 'sqlite'] as const)('S2A card semantics (%s)', (kind) => {
  const opened: S5DecisionFixture[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
  const open = async () => {
    const f = await openS5DecisionFixture(kind, { duties: ['adviser'], operatorActor: { ...OPERATOR } });
    opened.push(f);
    return f;
  };

  it('QA-08 (a) - a cancelled Goal moves its waiting card to read-only history', async () => {
    const f = await open();
    const cRun = (await startRun(f, 's2a-qa08-c', GOAL_C, PLAN_C1, 'c-work')).run;
    const sent = await sendUserDecision(f, workContext(f, cRun), GOAL_C, 's2a-qa08-request');
    const messageKey = decisionSourceKey({ kind: 'message', messageRef: sent.ref });
    const before = await readGoalQueue(f, GOAL_C, { limit: 50 }, ['waiting_answer']);
    expect(before.waitingAnswer.map((card) => card.cardKey)).toEqual([messageKey]);
    const goal = await goalAt(f.records, GOAL_C);
    const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: 'P', goalId: GOAL_C.goalId };
    const phaseRead = await f.records.readMany([canonicalJson(phaseRef as unknown as JsonValue)]);
    if (phaseRead.status !== 'ready') throw new Error(JSON.stringify(phaseRead));
    committed(await setGoalControlFromHost({ records: f.records, now: f.now, eventId: f.newId }, f.ctx, {
      input: { goalRef: GOAL_C, control: 'cancel', reason: 'QA-08 regression' },
      meta: { requestId: 's2a-qa08-cancel', expected: [pin(GOAL_C, goal.revision),
        { ref: phaseRef, revision: (phaseRead.value.records[0]?.revision ?? 0) }] },
    }));
    const after = await readGoalQueue(f, GOAL_C, { limit: 50 }, ['waiting_answer', 'history']);
    expect(after.waitingAnswer).toEqual([]);
    const historical = after.history.filter((card) => card.cardKey === messageKey);
    expect(historical).toHaveLength(1);
    expect(historical[0]).toMatchObject({ state: 'closed', readOnly: true, closedReason: 'goal_cancelled', actions: [] });
  }, 300_000);

  function mustCommit<T>(result: WriteResult<T>): Extract<WriteResult<T>, { status: 'committed' }> {
    if (result.status !== 'committed') throw new Error(`QA-08 write: ${JSON.stringify(result)}`);
    return result;
  }

  it('QA-08 (b) - an answered-and-applied synthetic answer is applied history, not an open card', async () => {
    const f = await open();
    const captured = captureCommits(f.records);
    const services = owners(f, captured.records);
    const receiptAt = (cursor: CommitCursor): DecisionApplicationReceiptV1 => {
      const match = captured.commits.find((commit) => commit.receipt.cursor === cursor);
      if (match === undefined) throw new Error('the answer commit was not captured');
      return { identityKey: match.input.identityKey, fingerprint: match.input.fingerprint, cursor };
    };
    const source = ready(await services.reads.readDecisionCard(f.ctx,
      { source: { kind: 'candidate', key: requestKey(), subject: { kind: 'goal', goalRef: GOAL_B }, pins: [] } })).source;
    // `other` is a real selection; a non-message source makes the answer synthetic.
    const answered = mustCommit(await services.decisions.answerDecision(f.ctx, {
      input: { source, selection: { kind: 'other' }, text: 'Adopt the candidate', annotations: [] },
      meta: { requestId: 's2a-qa08-answer', expected: [...source.pins] },
    }));
    const goal = await goalAt(f.records, GOAL_B);
    const adoption = mustCommit(await services.plans.applyPlanChange(f.ctx, {
      input: { proposalRef: f.candidates.U1.ref, expectedProposalRevision: 1, decisionRefs: [],
        acknowledgementRef: answered.value.ref, decisionSource: source },
      meta: { requestId: 's2a-qa08-adopt', expected: [pin(GOAL_B, goal.revision)] },
    }));
    const applied = mustCommit(await services.decisions.recordDecisionApplication(f.ctx, {
      input: { messageRef: answered.value.ref, receipt: receiptAt(adoption.cursor) },
      meta: { requestId: 's2a-qa08-apply', expected: [pin(answered.value.ref, answered.value.revision)] },
    }));
    expect(applied.value.application).not.toBeNull();
    const queue = await readGoalQueue(f, GOAL_B, { limit: 200 },
      ['waiting_answer', 'answered_pending_application', 'history']);
    const card = requestCards(queue.history)[0];
    expect(card).toMatchObject({ state: 'applied', candidateStatus: null, readOnly: false, actions: [] });
    expect(requestCards(queue.waitingAnswer)).toEqual([]);
    expect(requestCards(queue.answeredPendingApplication)).toEqual([]);
  }, 300_000);
});
