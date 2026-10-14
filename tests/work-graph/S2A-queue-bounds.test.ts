/**
 * Group Q (slice 2A) QE2 bounds: the decision queue and its message cards.
 * All datasets are built through the real public services; the queue is read
 * through `queryDecisionQueue` only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { GOAL_C, OPERATOR, PLAN_C1, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { workContext } from '../helpers/S5-user-message-support.js';
import {
  answerUserDecision, messageCards, readGoalQueue, readWorkspaceQueue, sendMemberMessage, sendUserDecision, startRun,
  S2A_SCALE_TIMEOUT_MS,
} from '../helpers/S2A-queue-fixture.js';
import { populateGoals } from '../helpers/S5R2-a-support.js';

const QA04_MEMBER_MESSAGES = 5_001;

/** Hand-computed `change_pending` reason key of the fixture's Goal B (probe-verified literal). */
const B_CHANGE_PENDING = '{"affected":[{"ref":{"aggregateType":"PlanProposal","projectId":"P","proposalId":"U1","workspaceId":"W"},"revision":1}],'
  + '"code":"change_pending","goalRef":{"aggregateType":"Goal","goalId":"B","projectId":"P"},"kind":"goal_cause"}';

describe.each(['memory', 'sqlite'] as const)('S2A queue bounds (%s)', (kind) => {
  const opened: S5DecisionFixture[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
  const open = async () => {
    const f = await openS5DecisionFixture(kind, { duties: ['adviser'], operatorActor: { ...OPERATOR } });
    opened.push(f);
    return f;
  };

  it('QA-04 - 5001 member-to-member messages do not enter the queue; 3 waiting and 2 answered user cards remain', async () => {
    const f = await open();
    // A trusted Session on Goal C; the sender Run must own the request's Goal.
    const cRun = (await startRun(f, 's2a-qa04-c', GOAL_C, PLAN_C1, 'c-work')).run;
    const cCtx = workContext(f, cRun);
    // 5,001 ordinary member-to-member messages, all through the real mailbox.
    for (let index = 0; index < QA04_MEMBER_MESSAGES; index += 1) {
      await sendMemberMessage(f, cCtx, `s2a-qa04-member-${String(index)}`, index, f.sessionSecond);
    }
    // 3 waiting user decision requests on Goal C (no other card source).
    const waiting = [];
    for (let index = 0; index < 3; index += 1) {
      waiting.push(await sendUserDecision(f, cCtx, GOAL_C, `s2a-qa04-waiting-${String(index)}`));
    }
    // 2 answered user requests on Goal C; `accept` leaves them pending application.
    const answered = [];
    for (let index = 0; index < 2; index += 1) {
      const sent = await sendUserDecision(f, cCtx, GOAL_C, `s2a-qa04-answered-${String(index)}`);
      await answerUserDecision(f, sent, `s2a-qa04-answer-${String(index)}`);
      answered.push(sent);
    }
    const queue = await readGoalQueue(f, GOAL_C);
    expect(queue.counts.waitingAnswer).toBe(3);
    expect(queue.counts.answeredPendingApplication).toBe(2);
    const expectedWaiting = waiting.map((message) => decisionSourceKey({ kind: 'message', messageRef: message.ref })).sort();
    const expectedAnswered = answered.map((message) => decisionSourceKey({ kind: 'message', messageRef: message.ref })).sort();
    expect(messageCards(queue.waitingAnswer).map((card) => card.cardKey).sort()).toEqual(expectedWaiting);
    expect(messageCards(queue.answeredPendingApplication).map((card) => card.cardKey).sort()).toEqual(expectedAnswered);
    expect(queue.waitingAnswer).toHaveLength(3);
    expect(queue.answeredPendingApplication).toHaveLength(2);
  }, S2A_SCALE_TIMEOUT_MS);

  it('QA-05 - 5001 waiting cards on one Goal page to the end with limit 50, no duplicates and count 5001', async () => {
    const f = await open();
    const cRun = (await startRun(f, 's2a-qa05-c', GOAL_C, PLAN_C1, 'c-work')).run;
    const cCtx = workContext(f, cRun);
    const sentKeys: string[] = [];
    for (let index = 0; index < 5_001; index += 1) {
      const sent = await sendUserDecision(f, cCtx, GOAL_C, `s2a-qa05-send-${String(index)}`);
      sentKeys.push(decisionSourceKey({ kind: 'message', messageRef: sent.ref }));
    }
    const seen = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    let total = 0;
    for (;;) {
      const page = await readGoalQueue(f, GOAL_C, cursor === undefined ? { limit: 50 } : { limit: 50, cursor },
        ['waiting_answer']);
      pages += 1;
      expect(page.counts.waitingAnswer).toBe(5_001);
      total += page.waitingAnswer.length;
      for (const card of page.waitingAnswer) {
        expect(seen.has(card.cardKey)).toBe(false);
        seen.add(card.cardKey);
      }
      if (page.nextCursor === null) break;
      expect(cursors.has(page.nextCursor)).toBe(false);
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    expect(pages).toBe(Math.ceil(5_001 / 50));
    expect(total).toBe(5_001);
    expect([...seen].sort()).toEqual([...sentKeys].sort());
  }, S2A_SCALE_TIMEOUT_MS);

  it('QA-06 - an unfiltered queue over 201 Goals is read; the hand-computed reason cards are unchanged', async () => {
    const f = await open();
    await populateGoals(f, 201);
    const queue = await readWorkspaceQueue(f, { limit: 500 },
      ['waiting_answer', 'answered_pending_application', 'history']);
    // Literal baseline: the fixture's Goal B cards; a Goal with no Plan/pending
    // proposal has no decision reason under today's rules.
    expect(queue.counts.waitingAnswer).toBe(5);
    expect(queue.counts.answeredPendingApplication).toBe(1);
    const goalCauses = queue.waitingAnswer.filter((card) => card.source.kind === 'goal_cause');
    expect(goalCauses.map((card) => card.source.key)).toEqual([B_CHANGE_PENDING]);
    expect(goalCauses.map((card) => card.goalRef.goalId)).toEqual(['B']);
    // The 198 added Goals provably add no reason card.
    expect(queue.waitingAnswer.filter((card) => card.goalRef.goalId.startsWith('S5R2-capacity-'))).toEqual([]);
  }, 600_000);
});
