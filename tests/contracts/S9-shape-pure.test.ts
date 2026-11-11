/**
 * P3-shape (slice 9 G1; rulings §4.2 P3, TS §3.1 "answer-shape 值域"; book 1245; S92-07): `exec_review` is a real
 * answer shape. `validQueryExecution` admits it on `intervention_planning` only; `queryAnswerShapeOf` maps such an
 * execution to `exec_review`; the manifest decoder's closed set takes `exec_review` and still refuses a shape outside
 * the set.
 *
 * World `W-pure` (rule sheet A5): one `intervention_planning` execution (the shape of
 * `tests/contracts/PL-exit-validation.test.ts:16-31`), the same budget and binding on a `semantic_query`, and one
 * complete plain Query manifest (`tests/work-graph/S6A-query-contracts-pure.test.ts:142-150`) whose only change is
 * `answerShape`. The `semantic_query` control without a shape is admitted, so its refusal with `exec_review` is the
 * shape's own.
 *
 * Named mutations: the manifest closed set misses `exec_review` (the exec manifest reads non-null, red; `witness` is
 * still refused); `validQueryExecution` lets `exec_review` through on a kind other than `intervention_planning` (the
 * `semantic_query` cell reads true, red).
 *
 * P3b (lead ruling 11-12 on the G1 reply, item 1; TS §3.1): the exec arms of `src/contracts/plan-round.ts`, by hand
 * from TS §3.1. `planningReplyTextOf` answers the two fixed short replies and `null` when the answer does not parse;
 * `systemRoundRequestId` writes `execreview:<roundId>` and refuses an empty goal or round id; `systemRoundOfText`
 * reads `execreview` only as exactly two segments with a non-empty round id. One named mutation per table, in the
 * table's comment.
 */
import { describe, expect, it } from 'vitest';
import {
  planningReplyTextOf, systemRoundOfText, systemRoundRequestId, type SystemRoundV1,
} from '../../src/contracts/plan-round.js';
import { queryAnswerShapeOf, validQueryExecution, type QueryJobIntentV1 } from '../../src/contracts/query-job.js';
import { queryManifestProblem } from '../../src/core/work-graph/queries/query-record-codecs.js';

type Execution = QueryJobIntentV1['execution'];
const roleBinding = { schemaVersion: 1 as const, bindingId: 'binding-1', templateId: 'reviewer',
  templateRevision: 'r1', bindingVersion: 1, policyRevision: 'p1' };
const runtimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: null,
  maxToolCalls: null, timeoutMs: null, perResponseTokens: 16384 };
const EXEC = { kind: 'intervention_planning', roleBinding, runtimeBudget, answerShape: 'exec_review',
  sourceMessageRef: { aggregateType: 'SessionMessage', projectId: 'proj-1', workspaceId: 'ws-1', messageId: 'm-1' },
} as unknown as Execution;
const SEMANTIC = { kind: 'semantic_query', roleBinding, runtimeBudget } as unknown as Execution;
const manifest = (answerShape: string) => ({ schemaVersion: 1, kind: 'query_execution',
  contextAssembly: { callKind: 'query-copy' }, answerShape,
  goal: { ref: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1' }, revision: 2 }, focusPlan: null, request: null });

describe('P3-shape: exec_review is a real answer shape', () => {
  it.each([
    ['intervention_planning with exec_review', EXEC, true],
    ['semantic_query without a shape (control)', SEMANTIC, true],
    ['semantic_query with exec_review', { ...SEMANTIC, answerShape: 'exec_review' } as unknown as Execution, false],
  ])('validQueryExecution: %s', (_case, execution, valid) => {
    expect(validQueryExecution(execution)).toBe(valid);
  });

  it('queryAnswerShapeOf maps the intervention_planning execution to exec_review', () => {
    expect(queryAnswerShapeOf(EXEC, null)).toBe('exec_review');
  });

  it.each([
    ['exec_review', true],
    ['witness', false],
  ])('queryManifestProblem: answerShape %s admitted = %s', (answerShape, admitted) => {
    expect(queryManifestProblem(manifest(answerShape)) === null).toBe(admitted);
  });
});

const goalRef = { aggregateType: 'Goal' as const, projectId: 'proj-1', goalId: 'goal-1' };
const roundRef = { aggregateType: 'VerificationRound' as const, projectId: 'proj-1', workspaceId: 'ws-1',
  goalId: 'goal-1', taskId: 'task-1', runId: 'run-1', roundId: 'round-1' };
const execRound = (goalId: string, roundId: string): SystemRoundV1 => ({ kind: 'exec_review',
  goalRef: { ...goalRef, goalId }, roundRef: { ...roundRef, goalId, roundId } });
const verdictText = (verdict: string) =>
  `{"schemaVersion":1,"kind":"exec_review","verdict":"${verdict}","basis":"b","report":"r"}`;

describe('P3b: the exec arms of the system round contract', () => {
  // Named mutation: the exec arm answers the answer text itself (as the `text` arm does) -> all three cells red.
  it.each([
    ['pass', verdictText('pass'), '执行结果审阅通过'],
    ['fix', verdictText('fix'), '执行结果审阅要求返工：见 Query q-7'],
    ['an answer that does not parse', 'looks fine to me', null],
  ])('planningReplyTextOf exec_review: %s', (_case, answerText, reply) => {
    expect(planningReplyTextOf({ shape: 'exec_review', answerText, queryJobId: 'q-7' })).toBe(reply);
  });

  // Named mutation: drop the empty roundId check -> the empty-roundId cell answers `execreview:` (red).
  it.each([
    ['the round', execRound('goal-1', 'round-1'), { status: 'ready', value: 'execreview:round-1' }],
    ['an empty roundId', execRound('goal-1', ''), { status: 'rejected', code: 'invalid', reason: 'roundId is empty' }],
    ['an empty goalId', execRound('', 'round-1'), { status: 'rejected', code: 'invalid', reason: 'goalId is empty' }],
  ])('systemRoundRequestId exec_review: %s', (_case, round, expected) => {
    expect(systemRoundRequestId(round)).toEqual(expected);
  });

  // Named mutation: read the second segment without checking the count -> the three-segment cell is not null (red).
  it.each([
    ['two segments', 'execreview:round-1\nroundRef: {}', { kind: 'exec_review', roundId: 'round-1' }],
    ['three segments', 'execreview:round-1:extra\nroundRef: {}', null],
    ['one segment', 'execreview\nroundRef: {}', null],
    ['an empty roundId', 'execreview:\nroundRef: {}', null],
  ])('systemRoundOfText execreview: %s', (_case, text, head) => {
    expect(systemRoundOfText(text)).toEqual(head);
  });
});
