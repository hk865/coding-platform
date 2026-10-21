/**
 * Group Q (slice 2A) QE2 bounds: the decision queue and its message cards.
 * All datasets are built through the real public services; the queue is read
 * through `queryDecisionQueue` only.
 *
 * Small daily versions of QA-04/QA-05/QA-06. The scale sizes (5,001 member
 * messages, 5,001 waiting cards, 201 Goals) live in
 * `S2A-queue-bounds.scale.test.ts`; here every read layer the case is about is
 * narrowed to 2-item pages, without changing the assertions' shape.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { GOAL_C, OPERATOR, PLAN_C1, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { workContext } from '../helpers/S5-user-message-support.js';
import {
  answerUserDecision, messageCards, readGoalQueue, readWorkspaceQueue, sendMemberMessage, sendUserDecision, startRun,
} from '../helpers/S2A-queue-fixture.js';
import { populateGoals } from '../helpers/S5R2-a-support.js';

const QA04_MEMBER_MESSAGES = 5;

/** Small daily widths: both internal read batches are 2 items. */
const SMALL_WIDTHS = { decision: { sourcePageLimit: 2, lookupPageLimit: 2 } };

/** Hand-computed `change_pending` reason key of the fixture's Goal B (probe-verified literal). */
const B_CHANGE_PENDING = '{"affected":[{"ref":{"aggregateType":"PlanProposal","projectId":"P","proposalId":"plan-proposal-079880d9c059786361b3a930cb78a292","workspaceId":"W"},"revision":1}],'
  + '"code":"change_pending","goalRef":{"aggregateType":"Goal","goalId":"B","projectId":"P"},"kind":"goal_cause"}';

describe.each(['memory', 'sqlite'] as const)('S2A queue bounds (%s)', (kind) => {
  const opened: S5DecisionFixture[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
  const open = async () => {
    const f = await openS5DecisionFixture(kind, { duties: ['adviser'], operatorActor: { ...OPERATOR } });
    opened.push(f);
    return f;
  };

  it('QA-04 (small: 5 member messages, page 2) - member-to-member messages do not enter the queue; 3 waiting and 2 answered user cards remain', async () => {
    const f = await open();
    // A trusted Session on Goal C; the sender Run must own the request's Goal.
    const cRun = (await startRun(f, 's2a-qa04-c', GOAL_C, PLAN_C1, 'c-work')).run;
    const cCtx = workContext(f, cRun);
    // 5 ordinary member-to-member messages, all through the real mailbox.
    // Their recipient is a Session, so the user-message index never sees them.
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
    // User-message scan: one stable lookup window over the user index. The
    // fixture seeds 2 user messages (one decision + one answered) on Goal B;
    // with the 5 here that is 7 items at width 2. Byte order of the message
    // ids (UTF-8 of the refKey): answered-0, fixture answered, waiting-0,
    // fixture decision, answered-1, waiting-1, waiting-2; pages 2,2,2,1.
    // The decisive waiting card, and the last page, is waiting-2. The 5
    // member messages are not in this index at all.
    const queue = await readGoalQueue(f, GOAL_C, undefined, undefined, SMALL_WIDTHS);
    expect(queue.counts.waitingAnswer).toBe(3);
    expect(queue.counts.answeredPendingApplication).toBe(2);
    const expectedWaiting = waiting.map((message) => decisionSourceKey({ kind: 'message', messageRef: message.ref })).sort();
    const expectedAnswered = answered.map((message) => decisionSourceKey({ kind: 'message', messageRef: message.ref })).sort();
    expect(messageCards(queue.waitingAnswer).map((card) => card.cardKey).sort()).toEqual(expectedWaiting);
    expect(messageCards(queue.answeredPendingApplication).map((card) => card.cardKey).sort()).toEqual(expectedAnswered);
    expect(queue.waitingAnswer).toHaveLength(3);
    expect(queue.answeredPendingApplication).toHaveLength(2);
  });

  it('QA-05 (small: 5 cards, page 2) - waiting cards on one Goal page to the end with no duplicates and count 5', async () => {
    const f = await open();
    const cRun = (await startRun(f, 's2a-qa05-c', GOAL_C, PLAN_C1, 'c-work')).run;
    const cCtx = workContext(f, cRun);
    const sentKeys: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const sent = await sendUserDecision(f, cCtx, GOAL_C, `s2a-qa05-send-${String(index)}`);
      sentKeys.push(decisionSourceKey({ kind: 'message', messageRef: sent.ref }));
    }
    const seen = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    let total = 0;
    for (;;) {
      const page = await readGoalQueue(f, GOAL_C, cursor === undefined ? { limit: 2 } : { limit: 2, cursor },
        ['waiting_answer'], SMALL_WIDTHS);
      pages += 1;
      expect(page.counts.waitingAnswer).toBe(5);
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
    // Outer card order by source.key (UTF-8 bytes): send-2, send-3, send-1,
    // send-4, send-0 -> pages 2 + 2 + 1, so the decisive fifth card send-0 is
    // on the last outer page. The internal user-message lookup runs at width
    // 2: fixture answered, send-2, send-3, send-1, fixture decision, send-4,
    // send-0 -> pages 2,2,2,1, also ending with send-0.
    expect(pages).toBe(3);
    expect(total).toBe(5);
    expect([...seen].sort()).toEqual([...sentKeys].sort());
  });

  it('QA-06 (small: 5 Goals, page 2) - an unfiltered queue over 5 Goals is read; the hand-computed reason cards are unchanged', async () => {
    const f = await open();
    // The fixture's 3 Goals (A, B, C) plus 2 more: the Goal-list lookup at
    // width 2 reads 5 items in refKey byte order A, B, C,
    // S5R2-capacity-000, S5R2-capacity-001 -> pages 2 + 2 + 1 = 3 pages, the
    // last page holding S5R2-capacity-001. The decisive-item-last rule does
    // not apply: this row checks that the read is not refused and that the
    // cause cards/counts are unchanged.
    await populateGoals(f, 5);
    const queue = await readWorkspaceQueue(f, { limit: 500 },
      ['waiting_answer', 'answered_pending_application', 'history'], SMALL_WIDTHS);
    // Literal baseline: the fixture's Goal B cards; a Goal with no Plan/pending
    // proposal has no decision reason under today's rules.
    expect(queue.counts.waitingAnswer).toBe(5);
    expect(queue.counts.answeredPendingApplication).toBe(1);
    const goalCauses = queue.waitingAnswer.filter((card) => card.source.kind === 'goal_cause');
    expect(goalCauses.map((card) => card.source.key)).toEqual([B_CHANGE_PENDING]);
    expect(goalCauses.map((card) => card.goalRef.goalId)).toEqual(['B']);
    // The 2 added Goals provably add no reason card.
    expect(queue.waitingAnswer.filter((card) => card.goalRef.goalId.startsWith('S5R2-capacity-'))).toEqual([]);
  });
});
