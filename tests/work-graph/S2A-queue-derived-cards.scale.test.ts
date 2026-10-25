/**
 * Group Q (slice 2A) QE2 derived cards: planning questions, request candidates
 * and Goal reason cards read beyond the old source windows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { QueryJobAnswerRef } from '../../src/contracts/query-job.js';
import { OPERATOR, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { owners } from '../helpers/S5-application-support.js';
import { buildPlanningQuestions, PLANNING_GOAL_REF } from '../helpers/S2A-planning-fixture.js';
import { readGoalQueue, ready, S2A_SCALE_TIMEOUT_MS } from '../helpers/S2A-queue-fixture.js';

const PLANNING_JOBS = 5_001;

describe.each(['memory', 'sqlite'] as const)('S2A queue derived cards (%s)', (kind) => {
  let f: S5DecisionFixture;
  let answerRefs: QueryJobAnswerRef[] = [];

  beforeAll(async () => {
    f = await openS5DecisionFixture(kind, { duties: ['adviser'], operatorActor: { ...OPERATOR } });
    ({ answerRefs } = await buildPlanningQuestions(f, PLANNING_JOBS));
  }, S2A_SCALE_TIMEOUT_MS);

  afterAll(async () => { await f.close(); });

  it('QA-07 - 5001 planning jobs on one Goal still yield the question cards, count literal, no incomplete', async () => {
    const queue = await readGoalQueue(f, PLANNING_GOAL_REF, { limit: 50 }, ['waiting_answer']);
    expect(queue.counts.waitingAnswer).toBe(PLANNING_JOBS);
    expect(queue.waitingAnswer.every((card) => card.source.kind === 'planning_question')).toBe(true);
    const last = answerRefs.at(-1);
    if (last === undefined) throw new Error('the planning fixture built no answer');
    const lastKey = decisionSourceKey({ kind: 'planning_question', answerRef: last, questionIndex: 0 });
    const card = ready(await owners(f).reads.readDecisionCard(f.ctx, {
      source: { kind: 'planning_question', key: lastKey, subject: { kind: 'goal', goalRef: PLANNING_GOAL_REF }, pins: [] },
    }));
    expect(card).toMatchObject({ cardKey: lastKey, state: 'waiting_answer', actions: ['answer'] });
  }, S2A_SCALE_TIMEOUT_MS);

  it('QA-09 (一) - a derived planning card past the old 25x200 window is read by readDecisionCard', async () => {
    // M3: the byte-last id of the zero-padded fixture, i.e. the 5,001st card in
    // the single-card source's ref-key order, past the old 5,000-item window.
    // Its identity is written literally here, never read back from the fixture.
    const beyond: QueryJobAnswerRef = {
      aggregateType: 'QueryJobAnswer', projectId: 'P', workspaceId: 'W',
      queryJobId: 'S2A-PQ-05000', answerId: 'S2A-PQ-answer-05000',
    };
    const key = decisionSourceKey({ kind: 'planning_question', answerRef: beyond, questionIndex: 0 });
    const card = ready(await owners(f).reads.readDecisionCard(f.ctx, {
      source: { kind: 'planning_question', key, subject: { kind: 'goal', goalRef: PLANNING_GOAL_REF }, pins: [] },
    }));
    expect(card).toMatchObject({
      cardKey: key, subject: { kind: 'goal', goalRef: PLANNING_GOAL_REF },
      source: { kind: 'planning_question', key, subject: { kind: 'goal', goalRef: PLANNING_GOAL_REF } },
      state: 'waiting_answer', options: [], objects: [], answer: null, application: null,
      actions: ['answer'], readOnly: false,
    });
  }, S2A_SCALE_TIMEOUT_MS);
});
