/**
 * K3-18 (一) (L22) confirmation predicate (F-046): `requeueConfirmedByReview`,
 * `pausedAutomationAction` and `automationConfirmationCause` are called directly
 * with built review/failure input.
 *
 * Moved out of `K3-18-requeue-confirmed.test.ts` (which keeps its real-record
 * rows on both backends). No store, platform, Host, Workflow, Runtime, fixture or
 * stub port is imported (A5). The expected affected pin and countedNext are
 * hand-computed from AV-4/AV-5 (a `system_requeue` from a resolved review with
 * hold null and no covering requeue is the 1st auto requeue), not read from
 * another program output.
 */
import { describe, expect, it } from 'vitest';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskFailureFactsV1 } from '../../src/contracts/task-failure.js';
import { requeueConfirmedByReview } from '../../src/core/work-graph/state/task-failure.js';
import {
  automationConfirmationCause, pausedAutomationAction,
} from '../../src/core/work-graph/state/decision-policy.js';

const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: 'P', goalId: 'g1' };

/** AV-4/AV-5: a resolved+released review, no covering requeue, no pause/stop. */
const failure: TaskFailureFactsV1 = {
  subjectKind: 'work', runRef: null, runRevision: null, attemptRef: null, sessionRef: null,
  failureClass: 'interrupted', notReworkableCause: null,
  run: null, interruption: null, stop: null, round: null,
  source: { atFailure: null, lastChecked: null, sinceFailure: 'unknown' },
  unknownCallReview: { status: 'resolved', hold: null, requeueConfirmed: true },
  requeueActors: [], reverifyActors: [],
  automation: { cap: 3, requeueAutoCount: 1, coveringRequeue: null, lastRefusal: null,
    lastReverifyRefusal: null, verdict: { kind: 'none' } },
};

const confirmation = (requeueConfirmedByReviewFlag: boolean) => automationConfirmationCause({
  autonomy: 'every_step', action: 'system_requeue', countedNext: 1, cap: 3,
  goalRef: GOAL_REF, taskId: 't1', runRef: null, runRevision: null,
  requeueConfirmedByReview: requeueConfirmedByReviewFlag,
});

describe('K3-18 (一) requeue confirmed predicate (pure)', () => {
  it('K3-18 (一): only a resolved record with a confirming disposition confirms the requeue', () => {
    const rerun = { status: 'resolved',
      disposition: { choice: 'rerun_as_is' } } as unknown as UnknownCallReviewV1;
    expect(requeueConfirmedByReview(rerun)).toBe(true);
    const autoSettled = { status: 'resolved', disposition: null } as unknown as UnknownCallReviewV1;
    expect(requeueConfirmedByReview(autoSettled)).toBe(false);
  });

  it('K3-18 (一): the every_step system_requeue cause is suppressed only by the confirmation', () => {
    expect(confirmation(true)).toBeNull();
    expect(confirmation(false)).toEqual({
      code: 'automation_confirmation_required', action: 'system_requeue',
      affected: [{ ref: { aggregateType: 'Task', projectId: 'P', goalId: 'g1', taskId: 't1' }, revision: 0 }],
    });
  });

  it('K3-18 (一): the paused-Goal action derives the same system_requeue and its suppressed cause', () => {
    const paused = pausedAutomationAction({ taskDispositionActive: true, failure });
    expect(paused).not.toBeNull();
    if (paused === null) throw new Error('the paused automation action is missing');
    expect(paused).toEqual({ action: 'system_requeue', countedNext: 1 });
    expect(automationConfirmationCause({ autonomy: 'every_step', action: paused.action,
      countedNext: paused.countedNext, cap: failure.automation.cap,
      goalRef: GOAL_REF, taskId: 't1', runRef: null, runRevision: null,
      requeueConfirmedByReview: true })).toBeNull();
  });
});
