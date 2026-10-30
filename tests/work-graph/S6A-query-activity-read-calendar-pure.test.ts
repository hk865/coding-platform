/**
 * Slice 6A L16: the calendar's pure decisions — the task-entry merge key and the
 * per-cell completeness rule. Hand-written inputs only (A5); every expected
 * value is a literal.
 */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type {
  QueryJobIntentV1, QueryJobRef, QueryRunRef, QuerySubmissionBindingV1,
} from '../../src/contracts/query-job.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import {
  advanceQueryExecutionRecord, newPendingQueryRecords,
  type PendingQueryLifecycleRecords, type QueryExecutionStep, type QueryLifecycleRecords,
} from '../../src/core/work-graph/state/query-run-recovery.js';
import { newRequestRound } from '../../src/core/work-graph/state/request-rounds.js';
import { missingQueryActivityGoalOf } from '../../src/core/work-graph/views/activity-read-helpers.js';
import {
  calendarCellComplete, calendarTaskKey,
} from '../../src/core/work-graph/views/activity-read-model.js';

describe('calendar task merge by (goalId, taskId)', () => {
  it('keeps two Goals\' same task id apart, adds within one Goal, and treats a null Goal and another task as their own keys', () => {
    const merged = new Map<string, { goalId: string | null; taskId: string; steps: number }>();
    const add = (goalId: string | null, taskId: string, steps: number): void => {
      const key = calendarTaskKey(goalId, taskId);
      const entry = merged.get(key) ?? { goalId, taskId, steps: 0 };
      entry.steps += steps;
      merged.set(key, entry);
    };
    add('goal-a', 'ag2b-work', 2);
    add('goal-b', 'ag2b-work', 3);
    add('goal-a', 'ag2b-work', 4);
    add(null, 'ag2b-work', 5);
    add('goal-a', 'ag2b-check', 7);

    expect([...merged.values()]).toEqual([
      { goalId: 'goal-a', taskId: 'ag2b-work', steps: 6 },
      { goalId: 'goal-b', taskId: 'ag2b-work', steps: 3 },
      { goalId: null, taskId: 'ag2b-work', steps: 5 },
      { goalId: 'goal-a', taskId: 'ag2b-check', steps: 7 },
    ]);
  });
});

// A Query's records as the state module builds them: a request round or a plain
// Query, claimed and prepared through the same pure steps the owner commits.
const AT = '2026-10-23T09:00:00.000Z';
const SINCE = 'c00000000042' as CommitCursor;
const SESSION: SessionRef = { projectId: 'p1', sessionId: 's1' };
const JOB_REF: QueryJobRef = { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1' };
const RUN_REF: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1' };
const ROLE_BINDING: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 'b1', templateId: 'tpl', templateRevision: 'r1',
  bindingVersion: 1, policyRevision: 'pol-1' };
const RUNTIME_BUDGET: RuntimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
  maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 };
const SUBMISSION: QuerySubmissionBindingV1 = { schemaVersion: 1, identityKey: 'submit-key', fingerprint: 'f'.repeat(64),
  eventId: 'evt-1' };
const CLAIM: QueryExecutionStep = { phase: 'claimed', claim: {
  sessionRef: SESSION, sessionGeneration: 1, role: { kind: 'legacy_template', templateId: 'tpl', templateRevision: 'r1' },
  roleBinding: ROLE_BINDING, roleResolution: { status: 'absent', roleId: 'role-1', reason: 'no role spec' },
  priorHistoryCursor: null, requestProfile: null,
} };

function intent(goalId: string | null): QueryJobIntentV1 {
  return { schemaVersion: 1, intentId: 'intent-1', projectId: 'p1', workspaceId: 'w1', goalId, question: 'what next?',
    focusTaskRefs: [], budget: { maxTokens: null, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: 'corr-1',
    execution: { kind: 'semantic_query', roleBinding: ROLE_BINDING, runtimeBudget: RUNTIME_BUDGET } };
}

/** The commit that creates the pair binds the Job's `since`; a reader sees it bound. */
function bound(records: PendingQueryLifecycleRecords): QueryLifecycleRecords {
  return { job: { ...records.job, since: SINCE }, run: records.run };
}

function requestRoundOn(goalId: string | null): QueryLifecycleRecords {
  return bound(newRequestRound({ queryJobId: 'qj-1', runId: 'qr-1', scope: { projectId: 'p1', workspaceId: 'w1' },
    intent: intent(goalId), kind: 'request', requestRoot: null, requestGoalId: goalId, assignedSession: SESSION,
    intakeSession: SESSION, selectedIdea: null, relatedCardRefs: [], relatedMessageRef: null,
    receipt: { kind: 'submit', requestRoot: JOB_REF, round: JOB_REF, assignment: 'assigned', secretary: SESSION, created: true },
    submission: SUBMISSION, submittedAt: AT, understanding: null }));
}

function prepared(records: QueryLifecycleRecords, requestEffectiveGoalId: string | null): QueryLifecycleRecords {
  return advanceQueryExecutionRecord(advanceQueryExecutionRecord(records, CLAIM), { phase: 'prepared', prepared: {
    bundleRef: { kind: 'artifact', contentType: 'application/json', digest: 'b'.repeat(64), sizeBytes: 42,
      source: { kind: 'workspace', refId: 'w1', revision: '1' } },
    inputDigest: 'i'.repeat(64), requestEffectiveGoalId,
  } });
}

describe('the Goal of a Query with no activity record', () => {
  it('is the goal a request round froze when it was prepared, a no-goal round included', () => {
    const toOtherGoal = prepared(requestRoundOn('goal-a'), 'goal-b');
    expect(missingQueryActivityGoalOf(toOtherGoal.job, toOtherGoal.run)).toBe('goal-b');
    const noGoal = prepared(requestRoundOn('goal-a'), null);
    expect(missingQueryActivityGoalOf(noGoal.job, noGoal.run)).toBeNull();
  });

  it('is the request\'s own goal for a request round not prepared yet', () => {
    const claimed = advanceQueryExecutionRecord(requestRoundOn('goal-a'), CLAIM);
    expect(missingQueryActivityGoalOf(claimed.job, claimed.run)).toBe('goal-a');
  });

  it('is the intent\'s goal for any other Query', () => {
    const plain = bound(newPendingQueryRecords({ queryRunRef: RUN_REF, goalId: 'goal-a', intent: intent('goal-c'),
      submittedAt: AT, submission: SUBMISSION }));
    expect(missingQueryActivityGoalOf(plain.job, plain.run)).toBe('goal-c');
  });
});

describe('calendar cell completeness', () => {
  const empty = { uncountedRuns: 0, inProgressRuns: 0, uncountedQueries: 0, inProgressQueries: 0 };

  it('is complete with no uncounted and no in-progress Run or Query', () => {
    expect(calendarCellComplete(empty)).toBe(true);
  });

  it('is incomplete for an uncounted Query', () => {
    expect(calendarCellComplete({ ...empty, uncountedQueries: 1 })).toBe(false);
  });

  it('is incomplete for an in-progress Query', () => {
    expect(calendarCellComplete({ ...empty, inProgressQueries: 2 })).toBe(false);
  });

  it('is incomplete for an uncounted or in-progress Run', () => {
    expect(calendarCellComplete({ ...empty, uncountedRuns: 1 })).toBe(false);
    expect(calendarCellComplete({ ...empty, inProgressRuns: 1 })).toBe(false);
  });
});
