/**
 * PL slice P1: the new fields' admission checks in `validQueryExecution`
 * (ruling DR-P1-04; spec §5.2.7). This is the only behavioural red P1 could
 * show before its implementation: the function exists today and does not
 * check either field yet.
 *
 * One illegal field per row. Every row starts from an otherwise valid
 * execution, so removing exactly the check under test makes that row fail.
 */
import { describe, expect, it } from 'vitest';
import {
  validQueryExecution, type PlanningAnswerShapeV1, type QueryJobIntentV1,
} from '../../src/contracts/query-job.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';

const scope = { projectId: 'proj-1', workspaceId: 'ws-1' };
const messageRef: SessionMessageRef = {
  aggregateType: 'SessionMessage', projectId: scope.projectId, workspaceId: scope.workspaceId, messageId: 'm-1',
};
const roleBinding = {
  schemaVersion: 1 as const, bindingId: 'binding-1', templateId: 'adviser', templateRevision: 'r1',
  bindingVersion: 1, policyRevision: 'p1',
};
const runtimeBudget = {
  contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: null,
  maxToolCalls: null, timeoutMs: null, perResponseTokens: 16384,
};

/** An otherwise-valid planning execution: the source message is the only kind-specific field. */
function planning(): QueryJobIntentV1['execution'] {
  return { kind: 'intervention_planning', sourceMessageRef: messageRef, roleBinding, runtimeBudget };
}

/** An otherwise-valid non-planning execution. */
function semantic(): QueryJobIntentV1['execution'] {
  return { kind: 'semantic_query', roleBinding, runtimeBudget };
}

describe('accepts: the legal new fields on intervention_planning', () => {
  it('accepts a planning execution with answerShape and repliesToMessageRef', () => {
    expect(validQueryExecution({
      ...planning(), answerShape: 'plan_round', repliesToMessageRef: messageRef,
    })).toBe(true);
  });
});

describe('rejects: validQueryExecution and the new fields (DR-P1-04, §5.2.7)', () => {
  it.each([
    ['answerShape on a non-planning kind', {
      ...semantic(), answerShape: 'plan_round',
    }],
    ['an unknown answerShape value', {
      ...planning(), answerShape: 'secretary' as unknown as PlanningAnswerShapeV1,
    }],
    ['repliesToMessageRef on a non-planning kind', {
      ...semantic(), repliesToMessageRef: messageRef,
    }],
    ['a malformed repliesToMessageRef', {
      ...planning(),
      repliesToMessageRef: {
        aggregateType: 'SessionMessage', projectId: scope.projectId, workspaceId: scope.workspaceId,
      } as unknown as SessionMessageRef,
    }],
  ] as const)('%s -> false', (_name, value) => {
    expect(validQueryExecution(value as QueryJobIntentV1['execution'])).toBe(false);
  });
});
