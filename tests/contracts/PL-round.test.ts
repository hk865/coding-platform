/**
 * PL slice P1: the pure system-round contract (§5.2.2, §5.2.6, §5.2.7).
 * The mailbox hex literal was computed outside the implementation; the shape
 * rows cover the three rules. No I/O, no store, no model.
 */
import { describe, expect, it } from 'vitest';
import {
  SYSTEM_ROUND_ACTOR, hostMessageId, systemRoundMessageRef, systemRoundRequestId,
  type SystemRoundV1,
} from '../../src/contracts/plan-round.js';
import {
  queryAnswerShapeOf, type QueryJobIntentV1,
} from '../../src/contracts/query-job.js';

const PROJECT = 'proj-1';
const WORKSPACE = 'ws-1';
const scope = { projectId: PROJECT, workspaceId: WORKSPACE };
const goalRef = { aggregateType: 'Goal' as const, projectId: PROJECT, goalId: 'goal-1' };
const originalMessageRef = {
  aggregateType: 'SessionMessage' as const, projectId: PROJECT, workspaceId: WORKSPACE, messageId: 'm-original',
};

/** One built execution; only the fields `queryAnswerShapeOf` reads are meaningful. */
function builtExecution(kind: QueryJobIntentV1['execution']['kind']): QueryJobIntentV1['execution'] {
  return {
    kind,
    ...(kind === 'intervention_planning' ? { sourceMessageRef: originalMessageRef } : {}),
    roleBinding: {
      schemaVersion: 1, bindingId: 'binding-1', templateId: 'adviser', templateRevision: 'r1',
      bindingVersion: 1, policyRevision: 'p1',
    },
    runtimeBudget: {
      contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: null,
      maxToolCalls: null, timeoutMs: null, perResponseTokens: 16384,
    },
  };
}

describe('systemRoundRequestId: the five literal formats (§5.2.2)', () => {
  const rows: readonly { name: string; round: SystemRoundV1; expected: string }[] = [
    {
      name: 'refine by stage',
      round: { kind: 'refine', goalRef, target: { kind: 'stage', stageId: 'stage-1' }, planRevision: 3 },
      expected: 'refine:goal-1:stage-1:3',
    },
    {
      name: 'refine by plan_only task',
      round: { kind: 'refine', goalRef, target: { kind: 'task', taskId: 'task-only' }, planRevision: 1 },
      expected: 'refine:goal-1:task-only:1',
    },
    {
      name: 'deviation',
      round: { kind: 'deviation', goalRef, taskId: 'task-2', cause: 'growth', planRevision: 4 },
      expected: 'deviation:goal-1:task-2:growth:4',
    },
    {
      name: 'planreview',
      round: { kind: 'planreview', goalRef, proposalId: 'prop-1', proposalRevision: 2 },
      expected: 'planreview:prop-1:2',
    },
    {
      name: 'planfix',
      round: { kind: 'planfix', goalRef, proposalId: 'prop-1', proposalRevision: 2 },
      expected: 'planfix:prop-1:2',
    },
    {
      name: 'planresume',
      round: { kind: 'planresume', goalRef, queryJobId: 'query-1', originalMessageRef },
      expected: 'planresume:goal-1:query-1',
    },
  ];

  it.each(rows)('$name -> $expected', ({ round, expected }) => {
    expect(systemRoundRequestId(round)).toEqual({ status: 'ready', value: expected });
  });
});

describe('rejects: systemRoundRequestId (§5.2.2)', () => {
  const rows: readonly { name: string; round: SystemRoundV1; reason: string }[] = [
    {
      name: 'empty refine goalId',
      round: { kind: 'refine', goalRef: { ...goalRef, goalId: '' }, target: { kind: 'stage', stageId: 'stage-1' }, planRevision: 1 },
      reason: 'goalId is empty',
    },
    {
      name: 'empty refine stageId',
      round: { kind: 'refine', goalRef, target: { kind: 'stage', stageId: '' }, planRevision: 1 },
      reason: 'stageId is empty',
    },
    {
      name: 'empty refine taskId',
      round: { kind: 'refine', goalRef, target: { kind: 'task', taskId: '' }, planRevision: 1 },
      reason: 'taskId is empty',
    },
    {
      name: 'zero planRevision',
      round: { kind: 'refine', goalRef, target: { kind: 'stage', stageId: 'stage-1' }, planRevision: 0 },
      reason: 'planRevision must be a positive safe integer',
    },
    {
      name: 'negative planRevision',
      round: { kind: 'refine', goalRef, target: { kind: 'stage', stageId: 'stage-1' }, planRevision: -1 },
      reason: 'planRevision must be a positive safe integer',
    },
    {
      name: 'non-integer planRevision',
      round: { kind: 'refine', goalRef, target: { kind: 'stage', stageId: 'stage-1' }, planRevision: 1.5 },
      reason: 'planRevision must be a positive safe integer',
    },
    {
      name: 'empty deviation taskId',
      round: { kind: 'deviation', goalRef, taskId: '', cause: 'lines', planRevision: 2 },
      reason: 'taskId is empty',
    },
    {
      name: 'zero deviation planRevision',
      round: { kind: 'deviation', goalRef, taskId: 'task-2', cause: 'budget', planRevision: 0 },
      reason: 'planRevision must be a positive safe integer',
    },
    {
      name: 'empty planreview proposalId',
      round: { kind: 'planreview', goalRef, proposalId: '', proposalRevision: 1 },
      reason: 'proposalId is empty',
    },
    {
      name: 'non-integer planfix proposalRevision',
      round: { kind: 'planfix', goalRef, proposalId: 'prop-1', proposalRevision: 2.5 },
      reason: 'proposalRevision must be a positive safe integer',
    },
    {
      name: 'empty planresume queryJobId',
      round: { kind: 'planresume', goalRef, queryJobId: '', originalMessageRef },
      reason: 'queryJobId is empty',
    },
    {
      name: 'empty planresume goalId',
      round: { kind: 'planresume', goalRef: { ...goalRef, goalId: '' }, queryJobId: 'query-1', originalMessageRef },
      reason: 'goalId is empty',
    },
  ];

  it.each(rows)('$name -> "$reason"', ({ round, reason }) => {
    expect(systemRoundRequestId(round)).toEqual({ status: 'rejected', code: 'invalid', reason });
  });
});

describe('hostMessageId / systemRoundMessageRef: the mailbox formula (§5.2.2, §5.2.6)', () => {
  // sha256 of the canonical JSON below, computed outside the implementation:
  // {"projectId":"proj-1","requestId":"refine:goal-1:stage-1:3",
  //  "sender":{"actor":{"id":"host:plan-round","kind":"system"},"kind":"host"},"workspaceId":"ws-1"}
  const HASH = '72a9bdee231897a41b375a1fe643a1db010a2b7d00157e59b0abe828f7f02120';
  const REQUEST_ID = 'refine:goal-1:stage-1:3';

  it('builds the literal message id from the fixed Host sender', () => {
    expect(hostMessageId(scope, SYSTEM_ROUND_ACTOR, REQUEST_ID))
      .toEqual({ status: 'ready', value: `session-message-${HASH}` });
  });

  it('builds the full SessionMessageRef for a system round', () => {
    expect(systemRoundMessageRef(scope, REQUEST_ID)).toEqual({
      status: 'ready',
      value: {
        aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE,
        messageId: `session-message-${HASH}`,
      },
    });
  });

  it('rejects an empty requestId for hostMessageId', () => {
    expect(hostMessageId(scope, SYSTEM_ROUND_ACTOR, ''))
      .toEqual({ status: 'rejected', code: 'invalid', reason: 'requestId is empty' });
  });

  it('rejects an empty requestId for systemRoundMessageRef', () => {
    expect(systemRoundMessageRef(scope, ''))
      .toEqual({ status: 'rejected', code: 'invalid', reason: 'requestId is empty' });
  });
});

describe('queryAnswerShapeOf: exactly the three rules (§5.2.7)', () => {
  it.each([
    ['semantic_query', 'secretary'],
    ['initial_coordination', 'initial'],
  ] as const)('request round %s -> %s', (kind, expected) => {
    expect(queryAnswerShapeOf(builtExecution(kind), kind)).toBe(expected);
  });

  it.each([
    ['plan_round', 'plan_round'],
    ['plan_review', 'plan_review'],
    ['text', null],
    [undefined, null],
  ] as const)('non-request intervention_planning with answerShape %s -> %s', (answerShape, expected) => {
    const base = builtExecution('intervention_planning');
    expect(queryAnswerShapeOf(answerShape === undefined ? base : { ...base, answerShape }, null)).toBe(expected);
  });

  it.each(['semantic_query', 'initial_coordination'] as const)(
    'non-request %s -> null', (kind) => {
      expect(queryAnswerShapeOf(builtExecution(kind), null)).toBeNull();
    });
});
