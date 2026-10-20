/**
 * K3-38 (R5): the fourth claim basis `review` — TASK-03r / RUN-01r / ATT-16r and
 * the shared `leaseReleasedForContinuation` change to ATT-16 (L10).
 */
import { describe, expect, it } from 'vitest';
import type { RunSnapshot, TaskAttemptRef, TaskLeaseRef, TaskLeaseSnapshot } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import {
  newTaskLeaseRecord, transitionTaskLease,
} from '../../src/core/work-graph/state/attempt-machine.js';
import {
  claimBasisProblem, newRunRecord, requeueClaimProblem, reviewClaimProblem, reviewEntryProblem,
  type ReviewClaimFacts,
} from '../../src/core/work-graph/state/run-machine.js';
import {
  transitionTask, type TaskClaimFacts, type TaskState,
} from '../../src/core/work-graph/state/task-machine.js';

const P = 'p', G = 'g', T = 't';
const reviewRef: UnknownCallReviewRef = { aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId: 'r-original' };
const reviewRunRef = { aggregateType: 'Run' as const, projectId: P, goalId: G, runId: 'r-round' };
const nextRunRef = { aggregateType: 'Run' as const, projectId: P, goalId: G, runId: 'r-next' };
const originalRunRef = { aggregateType: 'Run' as const, projectId: P, goalId: G, runId: 'r-original' };
const attemptRef: TaskAttemptRef = { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: 'a-next' };

const claim: TaskClaim = {
  task: { projectId: P, goalId: G, taskId: T }, planRef: { aggregateType: 'PlanRevision', projectId: P, planId: 'plan' },
  workspaceId: 'w', sessionRef: { projectId: P, sessionId: 's' }, sessionRevision: 1, generation: 1,
  runRef: nextRunRef, attemptRef,
  outboxRef: { aggregateType: 'DispatchOutboxEntry', projectId: P, goalId: G, taskId: T, attemptId: 'a-next' },
  claimedAt: '2026-10-16T00:00:00.000Z',
};

function reviewFacts(over: Partial<ReviewClaimFacts> = {}): ReviewClaimFacts {
  return {
    reviewRef, phase: 'review', round: 1, stateEntry: 1, revisionMatches: true, statusMatchesPhase: true,
    hold: null, activeRoundEmpty: true, roundsHaveSlot: true, selectedRunIsRecordRun: true,
    leaseReleasedByAfterRun: true, afterRunRefIsHolder: true, projectionAdmitsReview: true, ...over,
  };
}

function claimFacts(over: Partial<TaskClaimFacts> = {}): TaskClaimFacts {
  return {
    goalDesiredState: 'active', activePlanMatchesClaim: true, sessionProblem: null, structuralProblem: null,
    lease: { status: 'free' }, taskHasRun: true, prior: null, requeue: null, review: reviewFacts(), admission: null,
    ...over,
  };
}

const reviewBasis = { kind: 'review' as const, reviewRef, expectedRevision: 3, phase: 'review' as const,
  round: 1, afterRunRef: reviewRunRef };

describe('K3-38 review claim (TASK-03r / RUN-01r)', () => {
  const p6: TaskState = { taskKind: 'work', disposition: 'active', row: 'P6', phase: 'failed',
    cause: { code: 'run_failed' } };
  const p4: TaskState = { taskKind: 'work', disposition: 'active', row: 'P4', phase: 'ready',
    cause: { code: 'requeued' } };

  it('K3-38 allows P6 and P4, leaves the projection unchanged and writes the activeRound effect', () => {
    for (const state of [p6, p4]) {
      const result = transitionTask(state, { kind: 'task_claimed', claim, basis: reviewBasis, budget: { tokenBudget: 1, deadline: null } },
        { taskId: T, claim: claimFacts(), completion: null, disposition: null });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.next).toEqual(state);
      expect(result.effects).toContainEqual({ kind: 'record_review_round_claim', reviewRef, runRef: nextRunRef,
        phase: 'review', round: 1, stateEntry: 1 });
      expect(result.effects).toContainEqual({ kind: 'hold_lease', lease: 'reheld' });
    }
  });

  it('K3-38 refuses every review-claim guard with its own row', () => {
    const reject = (over: Partial<ReviewClaimFacts>, code: string, reason: string) => {
      const problem = reviewClaimProblem(reviewFacts(over));
      if (problem === null || problem.ok) throw new Error('expected a refusal');
      expect([problem.reason, problem.code]).toEqual([reason, code]);
    };
    expect(reviewClaimProblem(null)).toMatchObject({ reason: 'illegal', code: 'invalid' });
    reject({ revisionMatches: false }, 'revision_conflict', 'stale');
    reject({ statusMatchesPhase: false }, 'busy', 'guard_failed');
    reject({ hold: 'held' }, 'busy', 'guard_failed');
    reject({ activeRoundEmpty: false }, 'busy', 'guard_failed');
    reject({ roundsHaveSlot: false }, 'busy', 'guard_failed');
    reject({ selectedRunIsRecordRun: false }, 'revision_conflict', 'stale');
    reject({ leaseReleasedByAfterRun: false }, 'revision_conflict', 'stale');
    reject({ afterRunRefIsHolder: false }, 'revision_conflict', 'stale');
    reject({ projectionAdmitsReview: false }, 'busy', 'guard_failed');
    expect(reviewClaimProblem(reviewFacts())).toBeNull();
  });

  it('K3-38 lets an ordinary (first/requeue) claim refuse busy while the selected Run record is unsettled', () => {
    const common = { prior: null, review: null, admission: null } as const;
    expect(claimBasisProblem({ kind: 'first' }, { ...common, taskHasRun: false, requeue: null, reviewBlocker: 'pending' }))
      .toMatchObject({ reason: 'guard_failed', code: 'busy', detail: 'unknown_call_review_pending' });
    expect(claimBasisProblem({ kind: 'first' }, { ...common, taskHasRun: false, requeue: null })).toBeNull();
    const requeue = { coversSelectedRun: true, leaseReleasedByAfterRun: true, budgetPinned: true };
    expect(claimBasisProblem({ kind: 'requeue', requeueRef: { aggregateType: 'TaskRequeue', projectId: P, goalId: G,
      taskId: T, afterRunId: 'r-original' } }, { ...common, taskHasRun: true, requeue, reviewBlocker: 'pending' }))
      .toMatchObject({ reason: 'guard_failed', code: 'busy', detail: 'unknown_call_review_pending' });
    expect(claimBasisProblem({ kind: 'requeue', requeueRef: { aggregateType: 'TaskRequeue', projectId: P, goalId: G,
      taskId: T, afterRunId: 'r-original' } }, { ...common, taskHasRun: true, requeue })).toBeNull();
  });

  it('K3-38 answers busy unknown_call_review_held for a held record', () => {
    const common = { prior: null, review: null, admission: null } as const;
    expect(claimBasisProblem({ kind: 'first' }, { ...common, taskHasRun: false, requeue: null, reviewBlocker: 'held' }))
      .toMatchObject({ reason: 'guard_failed', code: 'busy', detail: 'unknown_call_review_held' });
  });

  it('K3-38 answers unavailable for an unreadable record', () => {
    const common = { prior: null, review: null, admission: null } as const;
    expect(claimBasisProblem({ kind: 'first' }, { ...common, taskHasRun: false, requeue: null, reviewBlocker: 'unreadable' }))
      .toMatchObject({ reason: 'guard_failed', code: 'unavailable', detail: 'unknown_call_review_unreadable' });
  });

  it('K3-47 (二) L11: a continuation claim is gated by the review blocker and changes nothing', () => {
    const consumedWait = {
      runRef: originalRunRef,
      messageRef: { aggregateType: 'SessionMessage' as const, projectId: P, workspaceId: 'w', messageId: 'm' },
      responseRef: { kind: 'artifact' as const, contentType: 'text/plain', digest: 'a'.repeat(64), sizeBytes: 1,
        source: { kind: 'workspace' as const, refId: 'w', revision: '1' } },
    };
    const prior = { node: 'YieldedWait' as const, pointer: 'none' as const, bindingProblem: null,
      leaseReleasedByPrior: true, replyProblem: null };
    const common = { taskHasRun: true, prior, requeue: null, review: null, admission: null } as const;
    // RUN-01: the continuation basis is asked through the same shared gate.
    expect(claimBasisProblem({ kind: 'continuation', consumedWait }, { ...common, reviewBlocker: 'unreadable' }))
      .toMatchObject({ reason: 'guard_failed', code: 'unavailable', detail: 'unknown_call_review_unreadable' });
    expect(claimBasisProblem({ kind: 'continuation', consumedWait }, { ...common, reviewBlocker: 'pending' }))
      .toMatchObject({ reason: 'guard_failed', code: 'busy', detail: 'unknown_call_review_pending' });
    expect(claimBasisProblem({ kind: 'continuation', consumedWait }, { ...common, reviewBlocker: 'held' }))
      .toMatchObject({ reason: 'guard_failed', code: 'busy', detail: 'unknown_call_review_held' });
    // TASK-02: the task machine asks it too and refuses before any effect.
    const before = { ...p4 };
    const result = transitionTask(before, { kind: 'task_claimed', claim,
      basis: { kind: 'continuation', consumedWait }, budget: { tokenBudget: 1, deadline: null } },
    { taskId: T, claim: claimFacts({ taskHasRun: true, prior, reviewBlocker: 'unreadable' }),
      completion: null, disposition: null });
    expect(result).toMatchObject({ ok: false, reason: 'guard_failed', code: 'unavailable',
      detail: 'unknown_call_review_unreadable' });
    expect('next' in result).toBe(false);
    expect(before).toEqual(p4);
  });

  it('K3-36 TASK-03 uses the shared release rule through leaseRelease', () => {
    const base = { coversSelectedRun: true, leaseReleasedByAfterRun: false, budgetPinned: true, afterRunRef: originalRunRef };
    expect(requeueClaimProblem({ ...base, leaseRelease: { releasedBy: originalRunRef, releasedByPurpose: null } })).toBeNull();
    expect(requeueClaimProblem({ ...base, leaseRelease: { releasedBy: reviewRunRef,
      releasedByPurpose: { kind: 'unknown_call_review', reviewRef, phase: 'review', round: 1 } } })).toBeNull();
    expect(requeueClaimProblem({ ...base, leaseRelease: { releasedBy: nextRunRef, releasedByPurpose: null } }))
      .toMatchObject({ reason: 'stale', code: 'revision_conflict' });
  });
});

describe('K3-38 ATT-16r / ATT-16 lease re-hold', () => {
  function releasedLease(holderRunId: string, releaseRun: { runId: string }): TaskLeaseSnapshot {
    const lease = newTaskLeaseRecord(claim);
    return { ...lease, holderRunId, revision: lease.revision + 1,
      release: { schemaVersion: 1, runRef: { aggregateType: 'Run', projectId: P, goalId: G, runId: releaseRun.runId },
        attemptRef, sessionRef: claim.sessionRef, generation: 1, releasedAt: '2026-10-16T00:01:00.000Z', eventId: 'e1' } };
  }

  it('K3-38 ATT-16r re-holds a lease released by the review afterRun', () => {
    const result = transitionTaskLease(releasedLease('r-round', { runId: 'r-round' }),
      { kind: 'attempt_claimed', claim, basis: reviewBasis });
    expect(result.ok).toBe(true);
    if (!result.ok || result.next === null) throw new Error('expected the lease to be re-held');
    expect(result.next.holderRunId).toBe('r-next');
    expect(result.next.release).toBeUndefined();
  });

  it('K3-38 ATT-16r refuses a lease released by another Run', () => {
    const result = transitionTaskLease(releasedLease('r-other', { runId: 'r-other' }),
      { kind: 'attempt_claimed', claim, basis: reviewBasis });
    expect(result).toMatchObject({ ok: false, reason: 'stale', code: 'revision_conflict' });
  });

  it('K3-38 ATT-16 accepts a release by one of the afterRun review rounds', () => {
    const result = transitionTaskLease(releasedLease('r-round', { runId: 'r-round' }), {
      kind: 'attempt_claimed', claim,
      basis: { kind: 'requeue', requeueRef: { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T,
        afterRunId: 'r-original' },
        leaseRelease: { releasedBy: reviewRunRef, releasedByPurpose: { kind: 'unknown_call_review', reviewRef,
          phase: 'review', round: 1 } } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.next === null) throw new Error('expected the lease to be re-held');
    expect(result.next.holderRunId).toBe('r-next');
  });

  it('K3-38 ATT-16 keeps today\'s refusal without the release facts', () => {
    const result = transitionTaskLease(releasedLease('r-round', { runId: 'r-round' }), {
      kind: 'attempt_claimed', claim,
      basis: { kind: 'requeue', requeueRef: { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T,
        afterRunId: 'r-original' } },
    });
    expect(result).toMatchObject({ ok: false, reason: 'stale', code: 'revision_conflict' });
  });
});

describe('K3-38 RUN-02 review entry', () => {
  const roleBinding = { schemaVersion: 1 as const, bindingId: 'b', templateId: 'worker', templateRevision: 'r1',
    bindingVersion: 1, policyRevision: 'p1' };
  const budget = { tokenBudget: 1, deadline: null };
  const reviewRun = newRunRecord({ claim, basis: reviewBasis, roleBinding, budget, workspaceRevision: 1 });
  const plainRun = newRunRecord({ claim, basis: { kind: 'first' }, roleBinding, budget, workspaceRevision: 1 });

  it('K3-38 lets a waiting round with a matching instruction enter', () => {
    expect(reviewRun.purpose).toEqual({ kind: 'unknown_call_review', reviewRef, phase: 'review', round: 1 });
    expect(reviewEntryProblem(reviewRun, { waitingForRound: true, instructionDigestMatches: true })).toBeNull();
    // A fact not read yet holds.
    expect(reviewEntryProblem(reviewRun, undefined)).toBeNull();
    expect(reviewEntryProblem(reviewRun, null)).toBeNull();
  });

  it('K3-38 answers stale when the round stopped waiting or the instruction moved', () => {
    expect(reviewEntryProblem(reviewRun, { waitingForRound: false, instructionDigestMatches: true }))
      .toMatchObject({ reason: 'stale', code: 'source_stale' });
    expect(reviewEntryProblem(reviewRun, { waitingForRound: true, instructionDigestMatches: false }))
      .toMatchObject({ reason: 'stale', code: 'source_stale' });
  });

  it('K3-38 does not judge a non-review Run', () => {
    expect(reviewEntryProblem(plainRun, { waitingForRound: false, instructionDigestMatches: false })).toBeNull();
  });
});

// The lease ref is unused directly but keeps the fixture type-complete.
const _leaseRef: TaskLeaseRef = { aggregateType: 'TaskLease', projectId: P, goalId: G, taskId: T };
void _leaseRef;
// `originalRunRef` documents the afterRun the review record belongs to.
void originalRunRef;
// A RunSnapshot import keeps the review-record identity check honest.
const _run: Pick<RunSnapshot, 'ref'> | null = null;
void _run;
