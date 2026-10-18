/**
 * K3-33 (R5): the failure-classification additions of L22/L26 — FC-7b, AV-2b,
 * AV-4c (before AV-3), `isGoalStopCause`, `countEndedGoalRuns`, and the shared
 * decision-policy guards.
 */
import { describe, expect, it } from 'vitest';
import type { RunRef, RunSnapshot, RuntimeEventV1, TaskTriple } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, type ReworkFailureClass } from '../../src/contracts/task-requeue.js';
import {
  automationConfirmationCause, pausedAutomationAction,
} from '../../src/core/work-graph/state/decision-policy.js';
import { isGoalStopCause } from '../../src/core/work-graph/state/goal-machine.js';
import {
  automationVerdict, buildTaskFailureFacts, countEndedGoalRuns, deriveReworkClass,
} from '../../src/core/work-graph/state/task-failure.js';
import type { RoundChainHeadV1 } from '../../src/core/work-graph/state/verification-machine.js';

const P = 'p', G = 'g', T = 't';
const task: TaskTriple = { projectId: P, goalId: G, taskId: T };
const ref = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const NO_CHAIN: RoundChainHeadV1 = { kind: 'none' };

function crashWithTakeover(runId: string): RunSnapshot {
  const event: RuntimeEventV1 = { eventType: 'run_crashed', schemaVersion: 1, eventId: `rt-${runId}`,
    runRef: ref(runId), sequence: 5, occurredAt: '2026-10-16T00:00:02.000Z',
    payload: { kind: 'crashed', error: 'host_takeover: 1 tool call(s) with unknown results' } };
  return {
    ref: ref(runId), revision: 4, schemaVersion: 1, task, status: 'ended', outcome: 'crashed', exitCode: null,
    lastEventSeq: 5, lastRuntimeEventId: event.eventId, lastFactEventId: 'fact-5',
    budget: { tokenBudget: 1000, deadline: null }, startedAt: '2026-10-16T00:00:00.000Z',
    endedAt: '2026-10-16T00:00:02.000Z',
    reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId: 'host-1' },
      recordedAt: '2026-10-16T00:00:03.000Z',
      observation: { kind: 'takeover_unresolved', event, lastPosition: 5, observedThroughPosition: 5,
        unresolvedToolCallIds: ['call-1'], proof: { kind: 'hl03_stale_lock', previousInstanceId: 'old', previousPid: 7 },
        reviewRef: { aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId } } },
  } as unknown as RunSnapshot;
}

function reviewOf(runId: string, over: Partial<UnknownCallReviewV1>): UnknownCallReviewV1 {
  return {
    ref: { aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId }, runRef: ref(runId),
    status: 'pending_review', inventory: 'complete', items: [], disposition: null, ...over,
  } as unknown as UnknownCallReviewV1;
}

function workInput(over: Record<string, unknown> = {}) {
  const run = crashWithTakeover('r1');
  return {
    subjectKind: 'work' as const, task, disposition: 'active' as const, satisfied: false, goalDesiredState: 'active' as const,
    selectedRun: run, originUnresolvable: false, pointerIntent: null, chain: NO_CHAIN, runs: [run], requeues: [],
    requeueRefusal: null, reverifyRefusal: null, goalEndedRuns: 4, configurationRevision: 'cfg-1',
    kernelRunFailedError: null, ...over,
  };
}

describe('K3-33 failure classification', () => {
  it('K3-33 FC-7b: a takeover closure is a counted-false interruption', () => {
    const run = crashWithTakeover('r1');
    const derivation = deriveReworkClass(run, null, NO_CHAIN);
    expect(derivation).toMatchObject({ row: 'FC-7b', kind: 'class', failureClass: 'interrupted', interruption: 'executing' });
    const verdict = automationVerdict(workInput(), DEFAULT_TASK_AUTOMATION_POLICY);
    expect(verdict).toMatchObject({ row: 'AV-12',
      verdict: { kind: 'requeue', failureClass: 'interrupted' } });
  });

  it('K3-33 AV-2b reports an unresolved record before AV-3', () => {
    const verdict = automationVerdict(workInput({
      reviews: [reviewOf('r1', { status: 'needs_decision' })],
      requeues: [{ ref: { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId: 'r1' } }],
    }), DEFAULT_TASK_AUTOMATION_POLICY);
    expect(verdict).toMatchObject({ row: 'AV-2b',
      verdict: { kind: 'stopped', reason: 'unknown_call_review', detail: { reviewStatus: 'needs_decision' } } });
    const unreadable = automationVerdict(workInput({ reviewUnreadable: true }), DEFAULT_TASK_AUTOMATION_POLICY);
    expect(unreadable).toMatchObject({ row: 'AV-2b',
      verdict: { kind: 'stopped', detail: { reviewStatus: 'unreadable' } } });
  });

  it('K3-33 AV-4c stops a held record before AV-3 and reports reviewHold', () => {
    const held = reviewOf('r1', { status: 'resolved',
      disposition: { choice: 'handle_myself', hold: 'held' } as UnknownCallReviewV1['disposition'] });
    const verdict = automationVerdict(workInput({
      reviews: [held],
      requeues: [{ ref: { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId: 'r1' } }],
    }), DEFAULT_TASK_AUTOMATION_POLICY);
    expect(verdict).toMatchObject({ row: 'AV-4c',
      verdict: { kind: 'stopped', reason: 'task_paused',
        detail: { fence: 'human_pause', pausedBy: 'human', reviewHold: true } } });
  });

  it('K3-33 isGoalStopCause excludes unknown_call_review', () => {
    expect(isGoalStopCause('unknown_call_review')).toBe(false);
    expect(isGoalStopCause('task_paused')).toBe(true);
  });

  it('K3-33 countEndedGoalRuns skips review-purpose Runs', () => {
    const reviewRun = { ...crashWithTakeover('r2'), purpose: { kind: 'unknown_call_review' as const,
      reviewRef: { aggregateType: 'UnknownCallReview' as const, projectId: P, goalId: G, runId: 'r1' },
      phase: 'review' as const, round: 1 } };
    expect(countEndedGoalRuns([crashWithTakeover('r1'), reviewRun])).toBe(1);
  });

  it('K3-33 pausedAutomationAction returns null while the record is unsettled, unreadable or held', () => {
    const base = workInput({ reviews: [reviewOf('r1', { status: 'pending_review' })] });
    const verdict = automationVerdict(base, DEFAULT_TASK_AUTOMATION_POLICY).verdict;
    const facts = buildTaskFailureFacts(base, DEFAULT_TASK_AUTOMATION_POLICY, verdict);
    expect(facts.failure?.unknownCallReview).toMatchObject({ status: 'pending_review', requeueConfirmed: false });
    expect(pausedAutomationAction({ taskDispositionActive: true, failure: facts.failure! })).toBeNull();

    const held = workInput({ reviews: [reviewOf('r1', { status: 'resolved',
      disposition: { choice: 'handle_myself', hold: 'held' } as UnknownCallReviewV1['disposition'] })] });
    const heldVerdict = automationVerdict(held, DEFAULT_TASK_AUTOMATION_POLICY).verdict;
    const heldFacts = buildTaskFailureFacts(held, DEFAULT_TASK_AUTOMATION_POLICY, heldVerdict);
    expect(pausedAutomationAction({ taskDispositionActive: true, failure: heldFacts.failure! })).toBeNull();

    const unreadable = workInput({ reviewUnreadable: true });
    const unreadableResult = automationVerdict(unreadable, DEFAULT_TASK_AUTOMATION_POLICY);
    expect(unreadableResult).toMatchObject({ row: 'AV-2b', verdict: { kind: 'stopped', detail: { reviewStatus: 'unreadable' } } });
    const unreadableFacts = buildTaskFailureFacts(unreadable, DEFAULT_TASK_AUTOMATION_POLICY, unreadableResult.verdict);
    expect(pausedAutomationAction({ taskDispositionActive: true, failure: unreadableFacts.failure! })).toBeNull();
  });

  it('K3-33 automationConfirmationCause is null when the review answer already confirmed the requeue', () => {
    const input = { autonomy: 'every_step' as const, action: 'system_requeue' as const, countedNext: 1, cap: 3,
      goalRef: { aggregateType: 'Goal', projectId: P, goalId: G } as never, taskId: T, runRef: ref('r1'), runRevision: 4 };
    expect(automationConfirmationCause({ ...input, requeueConfirmedByReview: true })).toBeNull();
    expect(automationConfirmationCause({ ...input, requeueConfirmedByReview: false }))
      .toMatchObject({ code: 'automation_confirmation_required' });
    // The default keeps the old behavior.
    expect(automationConfirmationCause(input)).toMatchObject({ code: 'automation_confirmation_required' });
  });
});

// Keep the imported type used for readability.
const _failureClass: ReworkFailureClass = 'interrupted';
void _failureClass;
