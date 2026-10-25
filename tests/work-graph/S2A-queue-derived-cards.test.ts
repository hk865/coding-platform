/**
 * Group Q (slice 2A) QE2 derived cards: planning questions, request candidates
 * and Goal reason cards read beyond the old source windows.
 *
 * The 5,001-job scale cases live in the sibling `.scale.test.ts`; here the same
 * entries run over a 5-job world with every internal read window at 2 so each
 * layer still crosses pages.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPERATOR, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { owners, type OwnerReadWidths } from '../helpers/S5-application-support.js';
import { buildPlanningQuestions, PLANNING_GOAL_REF } from '../helpers/S2A-planning-fixture.js';
import { readGoalQueue, ready } from '../helpers/S2A-queue-fixture.js';

const PLANNING_JOBS = 5;

// The literal key of the fixture's last (5th) planning question, S2A-PQ-00004.
// A planning_question source key is canonical JSON (slice-5 §2; object keys in
// UTF-16 code-unit order): {"answerRef":{...},"kind":"planning_question",
// "questionIndex":0}, with the answer ref's own keys in the same order.
const LAST_PLANNING_KEY =
  '{"answerRef":{"aggregateType":"QueryJobAnswer","answerId":"S2A-PQ-answer-00004",'
  + '"projectId":"P","queryJobId":"S2A-PQ-00004","workspaceId":"W"},'
  + '"kind":"planning_question","questionIndex":0}';

// 5 planning cards, so the planning lookup window of 2 is read as 2 + 2 + 1
// (three pages); the queue's own page.limit is 2 as well, and both decision
// source windows are 2, so every read layer crosses pages.
const SMALL_WIDTHS: OwnerReadWidths = {
  decision: { sourcePageLimit: 2, lookupPageLimit: 2 },
  planningQuestion: { lookupPageLimit: 2 },
};

describe.each(['memory', 'sqlite'] as const)('S2A queue derived cards (%s)', (kind) => {
  let f: S5DecisionFixture;

  beforeAll(async () => {
    f = await openS5DecisionFixture(kind, { duties: ['adviser'], operatorActor: { ...OPERATOR } });
    await buildPlanningQuestions(f, PLANNING_JOBS);
  });

  afterAll(async () => { await f.close(); });

  it('QA-07 (small: 5 planning jobs, page 2) - the question cards, count literal, no incomplete', async () => {
    const queue = await readGoalQueue(f, PLANNING_GOAL_REF, { limit: 2 }, ['waiting_answer'], SMALL_WIDTHS);
    // The count covers all 5 waiting cards; the single page of limit 2 shows
    // the first 2 (2 + 2 + 1 pages in the queue's own page width would follow
    // if the caller continued with nextCursor). The last card is the 5th,
    // S2A-PQ-00004, past the 2-item source window.
    expect(queue.counts.waitingAnswer).toBe(PLANNING_JOBS);
    expect(queue.waitingAnswer.every((card) => card.source.kind === 'planning_question')).toBe(true);
    const card = ready(await owners(f, f.records, f.bodies, SMALL_WIDTHS).reads.readDecisionCard(f.ctx, {
      source: { kind: 'planning_question', key: LAST_PLANNING_KEY,
        subject: { kind: 'goal', goalRef: PLANNING_GOAL_REF }, pins: [] },
    }));
    expect(card).toMatchObject({ cardKey: LAST_PLANNING_KEY, state: 'waiting_answer', actions: ['answer'] });
  });

  it('QA-09 (一) (small: 5 planning jobs, page 2) - a planning card past the small window is read by readDecisionCard', async () => {
    // The byte-last id of the zero-padded 5-job fixture, i.e. the 5th card in
    // the single-card source's ref-key order, past the 2-item enumeration
    // window. Its identity is written literally here, never read back from the
    // fixture.
    const key = LAST_PLANNING_KEY;
    const card = ready(await owners(f, f.records, f.bodies, SMALL_WIDTHS).reads.readDecisionCard(f.ctx, {
      source: { kind: 'planning_question', key, subject: { kind: 'goal', goalRef: PLANNING_GOAL_REF }, pins: [] },
    }));
    expect(card).toMatchObject({
      cardKey: key, subject: { kind: 'goal', goalRef: PLANNING_GOAL_REF },
      source: { kind: 'planning_question', key, subject: { kind: 'goal', goalRef: PLANNING_GOAL_REF } },
      state: 'waiting_answer', options: [], objects: [], answer: null, application: null,
      actions: ['answer'], readOnly: false,
    });
  });
});
