import { describe, expect, it } from 'vitest';
import type { CoreError } from '../../src/contracts/core/results.js';
import type { GoalConfirmFactsV1 } from '../../src/contracts/goal-card.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { GoalCardDraftV1, GoalScreeningV1, QueryJobAnswerRef, QueryJobRef } from '../../src/contracts/query-job.js';
import { latestAnsweredRound } from '../../src/core/work-graph/model/request-contracts.js';
import {
  confirmObjectiveText, decideGoalConfirm, newInitializationBinding,
} from '../../src/core/work-graph/state/goal-confirm.js';

const ROUND: QueryJobRef = { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-answered' };
const EARLIER_ROUND: QueryJobRef = { ...ROUND, queryJobId: 'qj-earlier' };
const ANSWER_REF: QueryJobAnswerRef = {
  aggregateType: 'QueryJobAnswer', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-answered', answerId: 'answer-1',
};

const DRAFT: GoalCardDraftV1 = {
  objective: '  Ship  the reader.  ',
  completion: ['  the reader has its own module  ', 'the writer is untouched'],
  autonomy: 'every_step',
  screening: null,
};
const DRAFT_B: GoalCardDraftV1 = {
  objective: '  Ship the writer.  ', completion: ['the writer has its own module'], autonomy: 'after_plan_confirmation', screening: null,
};
const SCREENING: GoalScreeningV1 = {
  modules: [{ projectId: 'p1', moduleId: 'm-reader' }],
  size: 'medium', conflictsWith: [], dependsOn: [], urgency: 'normal', suggestedPosition: 0, note: '先做读取层',
};
const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: 'p1', goalId: 'goal-1' };
const INPUT = { commandId: 'cmd-confirm-1', round: ROUND, index: 0 };

function facts(overrides: Partial<GoalConfirmFactsV1> = {}): GoalConfirmFactsV1 {
  return {
    rounds: [],
    latestAnswered: ROUND,
    round: ROUND,
    drafts: [{ index: 0, draft: DRAFT }],
    activeOrder: [],
    confirmed: [],
    ...overrides,
  };
}

const THIS_DRAFT_CONFIRMED = [{ answerRef: ANSWER_REF, draftIndex: 0 }];
const OTHER_ANSWER_CONFIRMED = [{ answerRef: { ...ANSWER_REF, queryJobId: 'qj-other' }, draftIndex: 0 }];

describe('rejects: the confirm draft decision', () => {
  const refused: { name: string; facts: GoalConfirmFactsV1; index: number; code: CoreError }[] = [
    { name: 'a request whose latest answered round is null', facts: facts({ latestAnswered: null }), index: 0, code: 'revision_conflict' },
    { name: 'a round that is not the latest answered round', facts: facts({ latestAnswered: EARLIER_ROUND }), index: 0, code: 'revision_conflict' },
    { name: 'a stale round before an out-of-range index', facts: facts({ latestAnswered: null }), index: 9, code: 'revision_conflict' },
    { name: 'a negative index', facts: facts(), index: -1, code: 'invalid' },
    { name: 'an index that is not an integer', facts: facts(), index: 0.5, code: 'invalid' },
    { name: 'an index equal to the draft count', facts: facts(), index: 1, code: 'invalid' },
    { name: 'any index against an empty draft table', facts: facts({ drafts: [] }), index: 0, code: 'invalid' },
    { name: 'an out-of-range index before a confirmed draft', facts: facts({ confirmed: THIS_DRAFT_CONFIRMED }), index: 1, code: 'invalid' },
    { name: 'a draft this answer already confirmed', facts: facts({ confirmed: THIS_DRAFT_CONFIRMED }), index: 0, code: 'revision_conflict' },
  ];

  it.each(refused)('refuses $name', ({ facts: read, index, code }) => {
    expect(decideGoalConfirm(read, { ...INPUT, index }))
      .toMatchObject({ outcome: 'refuse', code, reason: expect.stringMatching(/^[\s\S]+$/) });
  });
});

const CREATED_FIRST = {
  outcome: 'create', draft: DRAFT,
  objective: 'Ship  the reader.\n\n完成标准：\n- the reader has its own module\n- the writer is untouched',
  settings: { schemaVersion: 1, autonomy: 'every_step', order: 0, waitForGoalRef: null, parallelRisks: [] },
  order: 0,
};

describe('create: the draft, the objective text and the birth settings', () => {
  const created = [
    {
      name: 'no active goal starts the order at 0',
      drafts: [{ index: 0, draft: DRAFT }], activeOrder: [], index: 0, confirmed: [],
      expected: CREATED_FIRST,
    },
    {
      name: 'the next order is the maximum plus one, duplicates kept in the input',
      drafts: [{ index: 0, draft: DRAFT_B }], activeOrder: [5, 0, 5], index: 0, confirmed: [],
      expected: {
        outcome: 'create', draft: DRAFT_B,
        objective: 'Ship the writer.\n\n完成标准：\n- the writer has its own module',
        settings: { schemaVersion: 1, autonomy: 'after_plan_confirmation', order: 6, waitForGoalRef: null, parallelRisks: [] },
        order: 6,
      },
    },
    {
      name: 'a binding of another answer does not block this draft',
      drafts: [{ index: 0, draft: DRAFT }], activeOrder: [], index: 0, confirmed: OTHER_ANSWER_CONFIRMED,
      expected: CREATED_FIRST,
    },
    {
      name: 'a binding of another draft does not block this draft',
      drafts: [{ index: 0, draft: DRAFT }, { index: 1, draft: DRAFT_B }], activeOrder: [], index: 0,
      confirmed: [{ answerRef: ANSWER_REF, draftIndex: 1 }],
      expected: CREATED_FIRST,
    },
  ];

  it.each(created)('creates $name', ({ drafts, activeOrder, index, confirmed, expected }) => {
    expect(decideGoalConfirm(facts({ drafts, activeOrder, confirmed }), { ...INPUT, index })).toEqual(expected);
  });
});

describe('confirmObjectiveText: the frozen objective text', () => {
  const cases = [
    {
      name: 'trims both ends of the objective and keeps the interior whitespace',
      objective: '  two  spaces  ', completion: [], expected: 'two  spaces\n\n完成标准：\n',
    },
    {
      name: 'normalizes every completion line and keeps its order and duplicates',
      objective: 'Plan', completion: ['  step one  ', 'step one', '步骤二 '],
      expected: 'Plan\n\n完成标准：\n- step one\n- step one\n- 步骤二',
    },
    {
      name: 'applies NFC to the objective and to the completion lines',
      objective: ' e\u0301 ', completion: ['cafe\u0301'], expected: 'é\n\n完成标准：\n- café',
    },
    {
      name: 'writes the Chinese completion heading after a Chinese objective',
      objective: ' 完成读取层 ', completion: ['读取层有测试'], expected: '完成读取层\n\n完成标准：\n- 读取层有测试',
    },
  ];

  it.each(cases)('$name', ({ objective, completion, expected }) => {
    expect(confirmObjectiveText(objective, completion)).toBe(expected);
  });
});

describe('newInitializationBinding: the immutable binding record', () => {
  const DIGEST = 'a'.repeat(64);

  const fixed = {
    ref: { aggregateType: 'InitializationBinding', projectId: 'p1', answerRef: ANSWER_REF, draftIndex: 2 },
    revision: 1, answerRef: ANSWER_REF, answerDigest: DIGEST, requestRef: ROUND,
    draftIndex: 2, goalRef: GOAL_REF, goalRevision: 1,
  };
  const bindings = [
    { name: 'a screened draft keeps the screening and a non-zero draft index', screening: SCREENING,
      expected: { ...fixed, screening: SCREENING } },
    { name: 'an unscreened draft keeps a null screening', screening: null,
      expected: { ...fixed, screening: null } },
  ];

  it.each(bindings)('$name', ({ screening, expected }) => {
    expect(newInitializationBinding({
      answerRef: ANSWER_REF, answerDigest: DIGEST, requestRef: ROUND, draftIndex: 2, goalRef: GOAL_REF, screening,
    })).toEqual(expected);
  });
});

describe('latestAnsweredRound: the request latest answered round', () => {
  const answered = (round: { ref: QueryJobRef; answer: string | null }): boolean => round.answer !== null;
  const rounds = [
    { ref: ROUND, answer: 'first' },
    { ref: EARLIER_ROUND, answer: null },
    { ref: { ...ROUND, queryJobId: 'qj-last' }, answer: 'third' },
    { ref: { ...ROUND, queryJobId: 'qj-pending' }, answer: null },
  ];

  it.each([
    { name: 'picks the last answered round, skipping the trailing unanswered one', input: rounds, expected: { ...ROUND, queryJobId: 'qj-last' } },
    { name: 'skips an unanswered round in the middle', input: [rounds[0]!, rounds[1]!, rounds[2]!], expected: { ...ROUND, queryJobId: 'qj-last' } },
    { name: 'answers null when no round is answered', input: [rounds[1]!, rounds[3]!], expected: null },
    { name: 'answers null for an empty request', input: [], expected: null },
  ])('$name', ({ input, expected }) => {
    expect(latestAnsweredRound(input, answered)).toEqual(expected);
  });

  it('returns a copy, not the stored round ref', () => {
    const latest = latestAnsweredRound(rounds, answered);
    expect(latest).not.toBe(rounds[2]!.ref);
  });
});
