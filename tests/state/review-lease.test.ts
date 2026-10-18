/**
 * K3-36 (R5): `leaseReleasedForContinuation` and (M1)
 * `isUnenteredReviewRoundForCancellation` in `state/review-lease.ts`.
 * The three state-machine sites that consume them are asserted in the group's
 * other R5 files; the owner-level "really re-held" cases are K3-47 (R4).
 */
import { describe, expect, it } from 'vitest';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import { newRunRecord } from '../../src/core/work-graph/state/run-machine.js';
import {
  isUnenteredReviewRoundForCancellation, leaseReleasedForContinuation, reviewRoundEndedKnown,
} from '../../src/core/work-graph/state/review-lease.js';

const P = 'p', G = 'g', T = 't', W = 'w';
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const claim: TaskClaim = {
  task: { projectId: P, goalId: G, taskId: T }, planRef: { aggregateType: 'PlanRevision', projectId: P, planId: 'plan' },
  workspaceId: W, sessionRef: { projectId: P, sessionId: 's' }, sessionRevision: 1, generation: 1,
  runRef: runRef('r-original'), attemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: 'a' },
  outboxRef: { aggregateType: 'DispatchOutboxEntry', projectId: P, goalId: G, taskId: T, attemptId: 'a' },
  claimedAt: '2026-10-16T00:00:00.000Z',
};
const reviewRef = { aggregateType: 'UnknownCallReview' as const, projectId: P, goalId: G, runId: 'r-original' };
const original = newRunRecord({
  claim, basis: { kind: 'first' }, roleBinding: {
    schemaVersion: 1, bindingId: 'b', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1,
    policyRevision: 'p1',
  }, budget: { tokenBudget: 1, deadline: null }, workspaceRevision: 1,
});

describe('K3-36 leaseReleasedForContinuation', () => {
  it('K3-36 accepts a release by the afterRun itself', () => {
    expect(leaseReleasedForContinuation(
      { release: { runRef: runRef('r-original') }, releasingRunPurpose: null }, runRef('r-original'),
    )).toBe(true);
  });

  it('K3-36 accepts a release by a review round of the afterRun record', () => {
    expect(leaseReleasedForContinuation({
      release: { runRef: runRef('r-review-1') },
      releasingRunPurpose: { kind: 'unknown_call_review', reviewRef, phase: 'review', round: 1 },
    }, runRef('r-original'))).toBe(true);
  });

  it('K3-36 rejects a release by another Run (and another record round)', () => {
    // Another Task's review round: the record's runId is not the afterRun.
    expect(leaseReleasedForContinuation({
      release: { runRef: runRef('r-review-other') },
      releasingRunPurpose: {
        kind: 'unknown_call_review',
        reviewRef: { ...reviewRef, runId: 'r-other' }, phase: 'review', round: 1,
      },
    }, runRef('r-original'))).toBe(false);
    // A plain Run that is neither the afterRun nor a review of its record.
    expect(leaseReleasedForContinuation(
      { release: { runRef: runRef('r-other') }, releasingRunPurpose: null }, runRef('r-original'),
    )).toBe(false);
    // The afterRun itself has no purpose: the plain comparison still admits it.
    expect(leaseReleasedForContinuation(
      { release: { runRef: runRef('r-original') }, releasingRunPurpose: null }, runRef('r-other'),
    )).toBe(false);
  });
});

describe('K3-36 isUnenteredReviewRoundForCancellation', () => {
  const unentered = (mutate: (run: RunSnapshot) => RunSnapshot): RunSnapshot => mutate({
    ...original,
    purpose: { kind: 'unknown_call_review', reviewRef, phase: 'review', round: 1 },
  });

  it('K3-36 accepts a starting review Run with Claimed, Authorized or Revoked authorization', () => {
    expect(isUnenteredReviewRoundForCancellation(unentered(run => run), original.ref)).toBe(true);
    expect(isUnenteredReviewRoundForCancellation(unentered(run => ({
      ...run,
      executionAuthorization: { schemaVersion: 2, generation: 1, sessionGeneration: 1, revision: 1, consumerId: 'c',
        inputDigest: 'd', phase: 'authorized', kernel: null },
    })), original.ref)).toBe(true);
    expect(isUnenteredReviewRoundForCancellation(unentered(run => ({
      ...run,
      executionAuthorization: { schemaVersion: 2, generation: 1, sessionGeneration: 1, revision: 1, consumerId: 'c',
        inputDigest: 'd', phase: 'revoked', kernel: null },
    })), original.ref)).toBe(true);
  });

  it('K3-36 accepts a paused pointer but not a cancelled one (M1)', () => {
    expect(isUnenteredReviewRoundForCancellation(unentered(run => ({
      ...run,
      controlState: { intentRef: { aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId: 'i1' }, desiredState: 'paused' },
    })), original.ref)).toBe(true);
    expect(isUnenteredReviewRoundForCancellation(unentered(run => ({
      ...run,
      controlState: { intentRef: { aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId: 'i2' }, desiredState: 'cancelled' },
    })), original.ref)).toBe(false);
  });

  it('K3-36 rejects a Run that entered, is not starting, has no review purpose or another ref', () => {
    // Entering authorization is not one of the three accepted phases.
    expect(isUnenteredReviewRoundForCancellation(unentered(run => ({
      ...run,
      executionAuthorization: { schemaVersion: 2, generation: 1, sessionGeneration: 1, revision: 1, consumerId: 'c',
        inputDigest: 'd', phase: 'entering', kernel: null },
    })), original.ref)).toBe(false);
    // Any entry evidence (startedAt, event sequence, history) disqualifies it.
    expect(isUnenteredReviewRoundForCancellation(unentered(run => ({ ...run, startedAt: '2026-10-16T00:00:01.000Z' })), original.ref)).toBe(false);
    expect(isUnenteredReviewRoundForCancellation(unentered(run => ({ ...run, lastEventSeq: 1, lastRuntimeEventId: 'rt-1' })), original.ref)).toBe(false);
    expect(isUnenteredReviewRoundForCancellation(unentered(run => ({
      ...run,
      executionHistory: { schemaVersion: 1, sessionRef: { projectId: P, sessionId: 's' },
        kernel: { adapterId: 'a', kernelSessionId: 'k', runId: 'kr', turnId: 'tu' }, startPosition: 0, observedThroughPosition: 0, endPosition: null },
    })), original.ref)).toBe(false);
    // A running (not starting) status is out.
    expect(isUnenteredReviewRoundForCancellation(unentered(run => ({ ...run, status: 'running' })), original.ref)).toBe(false);
    // No review purpose.
    expect(isUnenteredReviewRoundForCancellation({ ...original }, original.ref)).toBe(false);
    // Another Run ref.
    expect(isUnenteredReviewRoundForCancellation(unentered(run => run), runRef('r-else'))).toBe(false);
  });
});

describe('K3 item C reviewRoundEndedKnown', () => {
  const ended = (over: Partial<RunSnapshot>): RunSnapshot => ({ ...original, status: 'ended', ...over });

  it('K3 C: ended with a known outcome (including a non-completed one) is a known end', () => {
    for (const outcome of ['completed', 'crashed', 'failed', 'budget_exhausted', 'cancelled', 'yielded'] as const) {
      expect(reviewRoundEndedKnown(ended({ outcome })), outcome).toBe(true);
    }
  });

  it('K3 C: not ended, a null outcome or outcome_unknown is not a known end', () => {
    expect(reviewRoundEndedKnown(ended({ status: 'starting', outcome: null }))).toBe(false);
    expect(reviewRoundEndedKnown(ended({ status: 'running', outcome: null }))).toBe(false);
    expect(reviewRoundEndedKnown(ended({ outcome: null }))).toBe(false);
    expect(reviewRoundEndedKnown(ended({ outcome: 'outcome_unknown' }))).toBe(false);
  });
});
