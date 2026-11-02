/**
 * PL slice P1: the pure read/reply helpers (§5.2.6, §5.3.5, §6.3.3) and the
 * one output-reserve formula. Every expected literal is written from the spec
 * or hand-computed, never read back from the function under test.
 */
import { describe, expect, it } from 'vitest';
import {
  planResumeOriginalQueryOfText, planningReplyTextOf, systemRoundOfText,
} from '../../src/contracts/plan-round.js';
import { parsePlanReviewAnswer } from '../../src/contracts/plan-review.js';
import { planningOutputReserveTokens } from '../../src/contracts/runtime-budget.js';

const PROJECT = 'proj-1';
const WORKSPACE = 'ws-1';

const PLAN_ANSWER = JSON.stringify({
  schemaVersion: 2,
  kind: 'plan',
  summary: 'Add the parser for the segment.',
  plan: {
    schemaVersion: 2,
    stages: [],
    tasks: [],
    obligations: [],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
  },
});

const REVIEW_PASS = '{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}';
const REVIEW_FIX = '{"schemaVersion":1,"kind":"plan_review","verdict":"fix",'
  + '"findings":[{"taskId":"task-3","text":"把先看什么写进 instruction"}]}';

describe('planningReplyTextOf: the short reply by frozen answer shape (§5.3.5)', () => {
  it('plan_round with a parseable v2 plan takes the summary', () => {
    expect(planningReplyTextOf({ shape: 'plan_round', answerText: PLAN_ANSWER, queryJobId: 'q-9' }))
      .toBe('Add the parser for the segment.');
  });

  it('plan_round keeps the saved non-empty text verbatim when it is not a v2 answer', () => {
    const prose = '这一段我先用文字说明：只改 parser，不改持久层。';
    expect(planningReplyTextOf({ shape: 'plan_round', answerText: prose, queryJobId: 'q-9' })).toBe(prose);
  });

  it.each([
    ['a JSON object whose only member is summary', '{"summary":"not a planning answer"}'],
    ['a v2 plan head with no plan member', '{"schemaVersion":2,"kind":"plan","summary":"no plan here"}'],
  ])('plan_round keeps %s verbatim, never its summary', (_name, text) => {
    expect(planningReplyTextOf({ shape: 'plan_round', answerText: text, queryJobId: 'q-9' })).toBe(text);
  });

  it('plan_review pass -> 审阅通过', () => {
    expect(planningReplyTextOf({ shape: 'plan_review', answerText: REVIEW_PASS, queryJobId: 'q-42' }))
      .toBe('审阅通过');
  });

  it('plan_review fix -> the finding count and the Query', () => {
    expect(planningReplyTextOf({ shape: 'plan_review', answerText: REVIEW_FIX, queryJobId: 'q-42' }))
      .toBe('审阅要求返修：1 条意见，见 Query q-42');
  });

  it('plan_review that does not parse -> null (terminal invalid, no reply)', () => {
    expect(planningReplyTextOf({ shape: 'plan_review', answerText: 'looks good to me', queryJobId: 'q-42' }))
      .toBeNull();
  });

  it('text -> the original text unchanged', () => {
    expect(planningReplyTextOf({ shape: 'text', answerText: 'overlap noted.', queryJobId: 'q-1' }))
      .toBe('overlap noted.');
  });
});

describe('planResumeOriginalQueryOfText: only the second line originalQueryRef (§5.6)', () => {
  it('reads the canonical ref from the second line', () => {
    const text = 'planresume:goal-1:query-1\n'
      + 'originalQueryRef: {"aggregateType":"SessionMessage","messageId":"m-original",'
      + '"projectId":"proj-1","workspaceId":"ws-1"}\n'
      + '人已答完这一轮的问题卡；接着原规划轮写下一步。';
    expect(planResumeOriginalQueryOfText(text)).toEqual({
      aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId: 'm-original',
    });
  });

  it('returns null when the second line is not the originalQueryRef line', () => {
    expect(planResumeOriginalQueryOfText('planresume:goal-1:query-1\nplease continue')).toBeNull();
  });

  it('returns null for a ref that is not a complete SessionMessageRef', () => {
    expect(planResumeOriginalQueryOfText(
      'planresume:goal-1:query-1\noriginalQueryRef: {"aggregateType":"SessionMessage"}',
    )).toBeNull();
  });
});

describe('planningOutputReserveTokens: the one formula (§5.3.5)', () => {
  it.each([
    [128000, 64000],
    [1000000, 131072],
    [1000, 500],
  ])('window %d -> reserve %d', (window, expected) => {
    expect(planningOutputReserveTokens(window)).toBe(expected);
  });
});

describe('systemRoundOfText: only the first line, unknown prefix -> null (§5.2.6)', () => {
  it.each([
    ['refine:goal-1:stage-1:3\nbody', { kind: 'refine', goalId: 'goal-1', stageOrTaskId: 'stage-1', planRevision: 3 }],
    ['deviation:goal-1:task-2:lines:4\nbody', { kind: 'deviation', goalId: 'goal-1', taskId: 'task-2', cause: 'lines', planRevision: 4 }],
    ['planreview:prop-1:2\nbody', { kind: 'planreview', proposalId: 'prop-1', proposalRevision: 2 }],
    ['planfix:prop-1:2\nbody', { kind: 'planfix', proposalId: 'prop-1', proposalRevision: 2 }],
    ['planresume:goal-1:query-1\nbody', { kind: 'planresume', goalId: 'goal-1', queryJobId: 'query-1' }],
  ] as const)('%s', (text, expected) => {
    expect(systemRoundOfText(text)).toEqual(expected);
  });

  it('keeps the refine stage-or-task segment as a string, never guessing', () => {
    expect(systemRoundOfText('refine:goal-1:task-only:1')).toEqual({
      kind: 'refine', goalId: 'goal-1', stageOrTaskId: 'task-only', planRevision: 1,
    });
  });

  it('unknown prefix -> null', () => {
    expect(systemRoundOfText('overlap-note:some-gate:digest\nbody')).toBeNull();
    expect(systemRoundOfText('just prose')).toBeNull();
    expect(systemRoundOfText('')).toBeNull();
  });
});

describe('parsePlanReviewAnswer: the strict plan-review JSON (§6.3.3)', () => {
  it('parses a pass with the platform-filled empty findings', () => {
    expect(parsePlanReviewAnswer(REVIEW_PASS)).toEqual({
      status: 'parsed', verdict: 'pass', findings: [],
    });
  });

  it('parses a fix with its findings', () => {
    expect(parsePlanReviewAnswer(REVIEW_FIX)).toEqual({
      status: 'parsed',
      verdict: 'fix',
      findings: [{ taskId: 'task-3', text: '把先看什么写进 instruction' }],
    });
  });

  it.each([
    ['a pass with no findings member', '{"schemaVersion":1,"kind":"plan_review","verdict":"pass"}'],
    ['a fix with empty findings', '{"schemaVersion":1,"kind":"plan_review","verdict":"fix","findings":[]}'],
    ['a code fence around the object', '```json\n{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}\n```'],
    ['text around the object', 'here: {"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}'],
    ['an unknown root member', '{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[],"reviewer":"r1"}'],
    ['an unknown member in a finding',
      '{"schemaVersion":1,"kind":"plan_review","verdict":"fix","findings":[{"taskId":null,"text":"x","why":"y"}]}'],
    ['a wrong schemaVersion', '{"schemaVersion":2,"kind":"plan_review","verdict":"pass","findings":[]}'],
    ['a finding with empty text',
      '{"schemaVersion":1,"kind":"plan_review","verdict":"fix","findings":[{"taskId":null,"text":""}]}'],
  ])('rejects %s', (_name, text) => {
    const result = parsePlanReviewAnswer(text);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
