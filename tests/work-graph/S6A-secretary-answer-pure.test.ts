/**
 * The secretary round's answer check (`parseSecretaryAnswer`), called with
 * literal answer texts (slice-6 spec L7, R-11; the answer format of the
 * `secretary-answer` template).
 *
 * A `semantic_query` round answers with one strict JSON object: schemaVersion 1,
 * a non-empty body, 0, 2 or 3 ideas (title one line of at most 120 code points,
 * detail at most 600 code points) and goal card drafts only when the request has
 * no goal. An `initial_coordination` round keeps the v2 initial-planning answer;
 * a request without a goal may add top-level drafts. Every refusal is
 * `protocol` with a reason; empty and over-long texts never reach this parse.
 *
 * A5: a pure file. It imports no store, platform, Host, Workflow, Runtime or
 * stub port; every expected value is a literal or counted by hand.
 */
import { describe, expect, it } from 'vitest';
import { parseSecretaryAnswer } from '../../src/core/work-graph/queries/secretary-answer.js';

const SEMANTIC_GOAL = { kind: 'semantic_query', hasGoal: true } as const;
const SEMANTIC_NO_GOAL = { kind: 'semantic_query', hasGoal: false } as const;
const COORDINATION_GOAL = { kind: 'initial_coordination', hasGoal: true } as const;
const COORDINATION_NO_GOAL = { kind: 'initial_coordination', hasGoal: false } as const;

/** One semantic answer object; a row changes exactly one field. */
function answer(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: 1, body: '可以先拆出读取层。', ideas: [], goalCardDrafts: [], ...fields });
}

const IDEA_A = { title: '先拆读取层', detail: '把读取和写入分开，再逐步迁移调用方。' };
const IDEA_B = { title: 'Keep one module', detail: 'Add a facade and leave the files where they are.' };
const IDEA_C = { title: '第三条路', detail: '' };
const DRAFT = { objective: 'Split the reader from the writer.', completion: ['the reader has its own module', 'all callers compile'],
  autonomy: 'after_plan_confirmation' };

/** The v2 initial-planning answer an `initial_coordination` round returns. */
const V2_PLAN = {
  schemaVersion: 2, kind: 'plan', summary: 'Two steps',
  plan: { schemaVersion: 2, stages: [], tasks: [], obligations: [], taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] } },
};
const V2_QUESTIONS = { schemaVersion: 2, kind: 'needs_decision', summary: 'One question', questions: ['Which database?'] };

/** A refusal is always `protocol` with a non-empty platform reason. */
function expectProtocol(result: ReturnType<typeof parseSecretaryAnswer>): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.detail).toBe('protocol');
  expect(typeof result.reason).toBe('string');
  expect(result.reason.length).toBeGreaterThan(0);
}

// 120 and 600 code points made of astral characters: 240 and 1,200 UTF-16 units.
const TITLE_120 = '😀'.repeat(120);
const DETAIL_600 = '𝄞'.repeat(600);

describe('semantic_query: accepted answers', () => {
  it('a goal request with no idea: the body, no ideas and no drafts', () => {
    expect(parseSecretaryAnswer(answer(), SEMANTIC_GOAL)).toEqual({
      ok: true, body: '可以先拆出读取层。', ideas: [], goalCardDrafts: [],
    });
  });

  it('two ideas are kept in order', () => {
    expect(parseSecretaryAnswer(answer({ ideas: [IDEA_A, IDEA_B] }), SEMANTIC_GOAL)).toEqual({
      ok: true, body: '可以先拆出读取层。', goalCardDrafts: [],
      ideas: [
        { title: '先拆读取层', detail: '把读取和写入分开，再逐步迁移调用方。' },
        { title: 'Keep one module', detail: 'Add a facade and leave the files where they are.' },
      ],
    });
  });

  it('three ideas, a 120-code-point title and a 600-code-point detail are within the bounds', () => {
    const ideas = [IDEA_A, { title: TITLE_120, detail: DETAIL_600 }, IDEA_C];
    expect(parseSecretaryAnswer(answer({ ideas }), SEMANTIC_GOAL)).toEqual({
      ok: true, body: '可以先拆出读取层。', goalCardDrafts: [],
      ideas: [
        { title: '先拆读取层', detail: '把读取和写入分开，再逐步迁移调用方。' },
        { title: TITLE_120, detail: DETAIL_600 },
        { title: '第三条路', detail: '' },
      ],
    });
  });

  it('a request without a goal may carry drafts; the platform sets screening to null', () => {
    const drafts = [DRAFT, { objective: 'Write the migration guide.', completion: ['the guide lists every caller'], autonomy: 'every_step' }];
    expect(parseSecretaryAnswer(answer({ goalCardDrafts: drafts }), SEMANTIC_NO_GOAL)).toEqual({
      ok: true, body: '可以先拆出读取层。', ideas: [],
      goalCardDrafts: [
        { objective: 'Split the reader from the writer.', completion: ['the reader has its own module', 'all callers compile'],
          autonomy: 'after_plan_confirmation', screening: null },
        { objective: 'Write the migration guide.', completion: ['the guide lists every caller'], autonomy: 'every_step',
          screening: null },
      ],
    });
  });

  it('a request without a goal may also carry no draft', () => {
    expect(parseSecretaryAnswer(answer({ ideas: [IDEA_A, IDEA_B] }), SEMANTIC_NO_GOAL)).toEqual({
      ok: true, body: '可以先拆出读取层。', goalCardDrafts: [],
      ideas: [
        { title: '先拆读取层', detail: '把读取和写入分开，再逐步迁移调用方。' },
        { title: 'Keep one module', detail: 'Add a facade and leave the files where they are.' },
      ],
    });
  });
});

describe('rejects: semantic_query answers that break the protocol', () => {
  it('an object inside a markdown fence is not extracted', () => {
    expectProtocol(parseSecretaryAnswer('```json\n' + answer() + '\n```', SEMANTIC_GOAL));
  });

  it('the JSON value null is not one object', () => {
    expectProtocol(parseSecretaryAnswer('null', SEMANTIC_GOAL));
  });

  it('schemaVersion 2', () => {
    expectProtocol(parseSecretaryAnswer(answer({ schemaVersion: 2 }), SEMANTIC_GOAL));
  });

  it('an empty body', () => {
    expectProtocol(parseSecretaryAnswer(answer({ body: '' }), SEMANTIC_GOAL));
  });

  it('a field the format does not have', () => {
    expectProtocol(parseSecretaryAnswer(answer({ summary: 'extra' }), SEMANTIC_GOAL));
  });

  it('a missing goalCardDrafts field', () => {
    expectProtocol(parseSecretaryAnswer(JSON.stringify({ schemaVersion: 1, body: 'b', ideas: [] }), SEMANTIC_GOAL));
  });

  it('ideas that are not an array', () => {
    expectProtocol(parseSecretaryAnswer(answer({ ideas: null }), SEMANTIC_GOAL));
  });

  it('exactly one idea', () => {
    expectProtocol(parseSecretaryAnswer(answer({ ideas: [IDEA_A] }), SEMANTIC_GOAL));
  });

  it('four ideas', () => {
    expectProtocol(parseSecretaryAnswer(answer({ ideas: [IDEA_A, IDEA_B, IDEA_C, IDEA_A] }), SEMANTIC_GOAL));
  });

  it('an idea with a field other than title and detail', () => {
    expectProtocol(parseSecretaryAnswer(answer({ ideas: [IDEA_A, { ...IDEA_B, score: 3 }] }), SEMANTIC_GOAL));
  });

  it('an idea whose title is not a string', () => {
    expectProtocol(parseSecretaryAnswer(answer({ ideas: [IDEA_A, { title: 7, detail: 'd' }] }), SEMANTIC_GOAL));
  });

  it('an idea whose detail is not a string', () => {
    expectProtocol(parseSecretaryAnswer(answer({ ideas: [IDEA_A, { title: 't', detail: 7 }] }), SEMANTIC_GOAL));
  });

  it('an idea with an empty title', () => {
    expectProtocol(parseSecretaryAnswer(answer({ ideas: [IDEA_A, { title: '', detail: 'd' }] }), SEMANTIC_GOAL));
  });

  it('an idea title of two lines', () => {
    expectProtocol(parseSecretaryAnswer(answer({ ideas: [IDEA_A, { title: 'one\ntwo', detail: 'd' }] }), SEMANTIC_GOAL));
  });

  it('an idea title of 121 code points', () => {
    expectProtocol(parseSecretaryAnswer(answer({ ideas: [IDEA_A, { title: TITLE_120 + 'x', detail: 'd' }] }), SEMANTIC_GOAL));
  });

  it('an idea detail of 601 code points', () => {
    expectProtocol(parseSecretaryAnswer(answer({ ideas: [IDEA_A, { title: 't', detail: DETAIL_600 + 'x' }] }), SEMANTIC_GOAL));
  });

  it('a draft on a request with a goal', () => {
    expectProtocol(parseSecretaryAnswer(answer({ goalCardDrafts: [DRAFT] }), SEMANTIC_GOAL));
  });

  it('a draft with an empty objective', () => {
    expectProtocol(parseSecretaryAnswer(answer({ goalCardDrafts: [{ ...DRAFT, objective: '' }] }), SEMANTIC_NO_GOAL));
  });

  it('a draft whose completion is not an array', () => {
    expectProtocol(parseSecretaryAnswer(answer({ goalCardDrafts: [{ ...DRAFT, completion: null }] }), SEMANTIC_NO_GOAL));
  });

  it('a draft with no completion criterion', () => {
    expectProtocol(parseSecretaryAnswer(answer({ goalCardDrafts: [{ ...DRAFT, completion: [] }] }), SEMANTIC_NO_GOAL));
  });

  it('a draft with an empty completion criterion', () => {
    expectProtocol(parseSecretaryAnswer(answer({ goalCardDrafts: [{ ...DRAFT, completion: ['the reader moved', ''] }] }),
      SEMANTIC_NO_GOAL));
  });

  it('a draft with an autonomy outside GoalAutonomyV1', () => {
    expectProtocol(parseSecretaryAnswer(answer({ goalCardDrafts: [{ ...DRAFT, autonomy: 'never_ask' }] }), SEMANTIC_NO_GOAL));
  });

  it('a draft that sets screening itself', () => {
    expectProtocol(parseSecretaryAnswer(answer({ goalCardDrafts: [{ ...DRAFT, screening: null }] }), SEMANTIC_NO_GOAL));
  });
});

describe('initial_coordination: accepted answers', () => {
  it('a v2 plan on a goal request: the body is the whole v2 text, with no ideas and no drafts', () => {
    const text = JSON.stringify(V2_PLAN);
    expect(parseSecretaryAnswer(text, COORDINATION_GOAL)).toEqual({ ok: true, body: text, ideas: [], goalCardDrafts: [] });
  });

  it('a v2 needs_decision answer on a request without a goal and without drafts', () => {
    const text = JSON.stringify(V2_QUESTIONS);
    expect(parseSecretaryAnswer(text, COORDINATION_NO_GOAL)).toEqual({ ok: true, body: text, ideas: [], goalCardDrafts: [] });
  });

  it('a needs_decision answer on a request without a goal: its drafts are parsed and the body keeps them', () => {
    const text = JSON.stringify({ ...V2_QUESTIONS, goalCardDrafts: [DRAFT] });
    expect(parseSecretaryAnswer(text, COORDINATION_NO_GOAL)).toEqual({
      ok: true, body: text, ideas: [],
      goalCardDrafts: [{ objective: 'Split the reader from the writer.',
        completion: ['the reader has its own module', 'all callers compile'], autonomy: 'after_plan_confirmation', screening: null }],
    });
  });

  it('a request without a goal: the top-level drafts are parsed and the body keeps them', () => {
    const text = JSON.stringify({ ...V2_PLAN, goalCardDrafts: [DRAFT] });
    expect(parseSecretaryAnswer(text, COORDINATION_NO_GOAL)).toEqual({
      ok: true, body: text, ideas: [],
      goalCardDrafts: [{ objective: 'Split the reader from the writer.',
        completion: ['the reader has its own module', 'all callers compile'], autonomy: 'after_plan_confirmation', screening: null }],
    });
  });
});

describe('rejects: initial_coordination answers that break the protocol', () => {
  it('a text the v2 parser refuses (schemaVersion 1)', () => {
    expectProtocol(parseSecretaryAnswer(JSON.stringify({ ...V2_PLAN, schemaVersion: 1 }), COORDINATION_GOAL));
  });

  it('drafts on a request with a goal', () => {
    expectProtocol(parseSecretaryAnswer(JSON.stringify({ ...V2_PLAN, goalCardDrafts: [DRAFT] }), COORDINATION_GOAL));
  });

  it('an empty drafts array on a request with a goal: the field must be absent', () => {
    expectProtocol(parseSecretaryAnswer(JSON.stringify({ ...V2_PLAN, goalCardDrafts: [] }), COORDINATION_GOAL));
  });

  it('a draft that breaks the draft rules on a request without a goal', () => {
    expectProtocol(parseSecretaryAnswer(JSON.stringify({ ...V2_PLAN, goalCardDrafts: [{ ...DRAFT, completion: [] }] }),
      COORDINATION_NO_GOAL));
  });
});
