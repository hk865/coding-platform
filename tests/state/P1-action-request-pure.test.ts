/**
 * P1 U1, U2 (contract `p1-frozen.md` 2.3, section 五): the `ActionRequest` transition table and the stop release
 * judgment, as pure tables (RULES A5, S1, S2). Expected values are the contract's table rows, written out by hand.
 *
 * Red before P1, at import: `src/core/work-graph/state/action-request.ts` did not exist.
 *
 * The adapters below (`step`, `releaseVerdict`) are the only lines that name the build's functions (renamed at
 * stacking to the builder's constructors). Lead ruling at stacking (the contract's 2.4 wins over 五 U1): U1 gives the
 * next state only; the hold change of the same commit is the owner's (AR-03's pointer clear is D2's), and
 * `released → pending` is gone (no constructor moves a stored request back to `pending`).
 *
 * The C1 row (review table, second half) judges the dispatch acceptance purely: a lease a Run holds that the phase
 * projection does not count (a review Run, or one whose outcome awaits review) still means `in progress`. The same
 * case through public steps needs K3L3's SQLite crash world plus a held adviser round there; the owner's lease read
 * that feeds `leaseHeld` is guarded by D1's first row.
 *
 * Mutations (run by the lead after stacking): U1 — the table lets `denied → open` through; U2 — a platform cancel is
 * read as the person having touched the Run, or two of the first rows swap places (the Goal and the lease; the lease
 * and the pointer; the pointer and the ended Run); C1 — `leaseHeld` back to `row === 'P2'`.
 */
import { describe, expect, it } from 'vitest';
import type { ActorRef, CommitCursor } from '../../src/contracts/command-event.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { CoreRejection } from '../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import { GOAL_FAN_OUT_ACTOR, WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import {
  applyDispatchRequest, approveDispatchRequest, denyActionRequest, dispatchTaskProblem, newDispatchRequest,
  newStopRequest, recordStopNotSent, releaseStopRequest, stopReleaseOf, voidActionRequest, withdrawActionRequest,
  type ActionRequestV1, type PendingActionRequestV1,
} from '../../src/core/work-graph/state/action-request.js';

const TASK: TaskTriple = { projectId: 'p1', goalId: 'g1', taskId: 't1' };
const RUN: RunRef = { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'run-1' };
const OTHER_RUN: RunRef = { ...RUN, runId: 'run-2' };
const QUERY_RUN = { aggregateType: 'QueryRun' as const, projectId: 'p1', workspaceId: 'w1', queryJobId: 'q-1',
  runId: 'qr-1' };
const POINTER: ControlIntentRef = { aggregateType: 'ControlIntent', projectId: 'p1', workspaceId: 'w1', intentId: 'ci-1' };
const PERSON = { kind: 'human' as const, id: 'p1-operator' };
const ANSWER: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: 'p1', workspaceId: 'w1', messageId: 'm-1' };
const CLOSED = { commandId: 'cmd-1', at: '2026-11-20T00:01:00.000Z' };
/** What a stop froze at acceptance (2.3 `frozen`): the leased Run, the lease pin, no control pointer. */
const FROZEN = { run: RUN, lease: { ref: { aggregateType: 'TaskLease' as const, projectId: 'p1', goalId: 'g1',
  taskId: 't1' }, revision: 2 }, pointer: null };
const COMMON = {
  ref: { aggregateType: 'ActionRequest' as const, projectId: 'p1', goalId: 'g1', taskId: 't1', requestId: 'r-1' },
  workspaceId: 'w1', task: TASK,
  requester: { kind: 'query_run' as const, actor: { kind: 'agent' as const, id: 'p1-line-a', queryRunRef: QUERY_RUN },
    session: { projectId: 'p1', sessionId: 's-a' }, queryRun: QUERY_RUN, duty: 'adviser' as const },
  reason: 'p1 reason', requestedAt: '2026-11-20T00:00:00.000Z',
};
const EXPECTED = { planRevision: 1, pointerRevision: 'none' as const, dispatchSequence: 0 };
const BASIS = { requestRoot: null, sourceMessage: null,
  round: { aggregateType: 'QueryJob' as const, projectId: 'p1', workspaceId: 'w1', queryJobId: 'q-1' } };
const RELEASED = { kind: 'released' as const, writeHold: true, notSent: null };

type State = 'pending' | 'open' | 'released' | 'void' | 'denied' | 'withdrawn' | 'applied';
type Accept = 'accept_pending' | 'accept_open' | 'accept_released';
type Move = 'approve' | 'claim' | 'settle' | 'deny' | 'withdraw' | 'deliver_not_sent';

/** One stored request of `kind` in `state` at revision 3 (2.3's fields; the build keeps both kinds' fields, null). */
function storedRequest(kind: 'dispatch' | 'stop', state: State): ActionRequestV1 {
  const common = { ...COMMON, revision: 3, schemaVersion: 1 as const, kind, since: 'c-1' as CommitCursor, state,
    answerRef: null, closedBy: null };
  return kind === 'dispatch'
    ? { ...common, expected: EXPECTED, preferredLine: null, frozen: null, basis: null, outcome: state === 'applied'
      ? { kind: 'applied', session: { projectId: 'p1', sessionId: 's-e' }, run: RUN, byRequest: false } : null }
    : { ...common, expected: null, preferredLine: null, frozen: FROZEN, basis: BASIS,
      outcome: state === 'released' ? { kind: 'released', holdReasonId: 'h-1', notSent: null } : null };
}

/** Acceptance (AR-01, AR-01d, AR-01s): the build's two creating constructors. */
function acceptedRequest(kind: 'dispatch' | 'stop', how: Accept): PendingActionRequestV1 {
  if (kind === 'dispatch') {
    return newDispatchRequest({ ...COMMON, expected: EXPECTED, preferredLine: null }, how === 'accept_open' ? 'open' : 'pending');
  }
  return newStopRequest({ ...COMMON, frozen: FROZEN, basis: BASIS },
    how === 'accept_released' ? { verdict: RELEASED, holdReasonId: 'h-1', closedBy: CLOSED } : null);
}

/** One move of a stored request (AR-02…07): the build's constructor for it. */
function move(current: ActionRequestV1, how: Move): PendingActionRequestV1 | CoreRejection {
  switch (how) {
    case 'approve': return current.kind === 'dispatch' ? approveDispatchRequest(current, ANSWER)
      : releaseStopRequest(current, RELEASED, 'h-1', ANSWER, CLOSED);
    case 'claim': return applyDispatchRequest(current, { session: { projectId: 'p1', sessionId: 's-e' }, run: RUN,
      byRequest: false }, CLOSED);
    case 'settle': return voidActionRequest(current, 'p1 settled', CLOSED);
    case 'deny': return denyActionRequest(current, ANSWER, CLOSED);
    case 'withdraw': return withdrawActionRequest(current, CLOSED);
    case 'deliver_not_sent': return recordStopNotSent(current, 'person_stopped');
  }
}

/** Adapter: one transition of the table (acceptance when nothing is stored), normalised to the next state, or the
 *  rejection code. */
function step(current: ActionRequestV1 | null, kind: 'dispatch' | 'stop', how: Accept | Move):
{ state: string } | { code: string } {
  const result = current === null ? acceptedRequest(kind, how as Accept) : move(current, how as Move);
  return 'status' in result ? { code: result.code } : { state: result.state };
}

describe('U1: the ActionRequest transition table (2.3)', () => {
  it.each<[string, 'dispatch' | 'stop', State | null, Accept | Move, State]>([
    ['AR-01 dispatch accepted under every step', 'dispatch', null, 'accept_pending', 'pending'],
    ['AR-01 stop accepted under every step', 'stop', null, 'accept_pending', 'pending'],
    ['AR-01d dispatch accepted automatically', 'dispatch', null, 'accept_open', 'open'],
    ['AR-01s stop released automatically', 'stop', null, 'accept_released', 'released'],
    ['AR-02d approve a pending dispatch', 'dispatch', 'pending', 'approve', 'open'],
    ['AR-02s approve a pending stop', 'stop', 'pending', 'approve', 'released'],
    ['AR-03 a claim applies an open dispatch', 'dispatch', 'open', 'claim', 'applied'],
    ['AR-03 a claim applies a pending dispatch', 'dispatch', 'pending', 'claim', 'applied'],
    ['AR-04 settle voids an open dispatch', 'dispatch', 'open', 'settle', 'void'],
    ['AR-05 deny a pending dispatch', 'dispatch', 'pending', 'deny', 'denied'],
    ['AR-06 withdraw a pending stop', 'stop', 'pending', 'withdraw', 'withdrawn'],
    ['AR-07 a stop that was not sent stays released', 'stop', 'released', 'deliver_not_sent', 'released'],
  ])('%s', (_label, kind, from, how, state) => {
    expect(step(from === null ? null : storedRequest(kind, from), kind, how)).toEqual({ state });
  });

  it.each<[string, 'dispatch' | 'stop', State, Move]>([
    ['denied → open', 'dispatch', 'denied', 'approve'],
    ['applied → void', 'dispatch', 'applied', 'settle'],
    ['withdrawn → applied', 'dispatch', 'withdrawn', 'claim'],
  ])('rejects: %s is outside the table (revision_conflict)', (_label, kind, from, how) => {
    expect(step(storedRequest(kind, from), kind, how)).toEqual({ code: 'revision_conflict' });
  });
});

type Verdict = { outcome: 'void'; reason: 'goal_cancelled' | 'run_replaced' }
  | { outcome: 'released'; notSent: 'person_stopped' | 'run_ended' | null; stopHold: boolean };

/** Adapter: the release judgment (`stopReleaseOf`) over what the owner read, normalised. */
function releaseVerdict(read: {
  goalCancelled: boolean; leaseHolder: RunRef | null; runEnded: boolean;
  pointer: { ref: ControlIntentRef; submittedBy: ActorRef } | null;
}): Verdict {
  const verdict = stopReleaseOf({ goal: read.goalCancelled ? 'cancelled' : 'active',
    leaseHolderRunId: read.leaseHolder?.runId ?? null, frozen: FROZEN,
    run: { ended: read.runEnded, pointer: read.pointer?.ref ?? null, pointerBy: read.pointer?.submittedBy ?? null } });
  return verdict.kind === 'void' ? { outcome: 'void', reason: verdict.reason }
    : { outcome: 'released', notSent: verdict.notSent, stopHold: verdict.writeHold };
}

describe('U2: the stop release judgment (2.3), first matching row wins', () => {
  const still = { goalCancelled: false, leaseHolder: RUN, runEnded: false, pointer: null };
  it.each<[string, Parameters<typeof releaseVerdict>[0], Verdict]>([
    // Ruling S5: the first three rows stack the next row's condition too, so the order of the rows is what decides.
    ['the Goal was cancelled (and the lease moved)', { ...still, goalCancelled: true, leaseHolder: OTHER_RUN },
      { outcome: 'void', reason: 'goal_cancelled' }],
    ['the lease moved to another Run (and a person paused)',
      { ...still, leaseHolder: OTHER_RUN, pointer: { ref: POINTER, submittedBy: PERSON } },
      { outcome: 'void', reason: 'run_replaced' }],
    ['a person paused the Run (and it ended)', { ...still, runEnded: true, pointer: { ref: POINTER, submittedBy: PERSON } },
      { outcome: 'released', notSent: 'person_stopped', stopHold: false }],
    ['the Goal fan-out paused the Run', { ...still, pointer: { ref: POINTER, submittedBy: GOAL_FAN_OUT_ACTOR } },
      { outcome: 'released', notSent: 'person_stopped', stopHold: false }],
    ['a person resumed the Run', { ...still, pointer: { ref: { ...POINTER, intentId: 'ci-resume' }, submittedBy: PERSON } },
      { outcome: 'released', notSent: 'person_stopped', stopHold: false }],
    ['the platform (scribe hard stop) cancelled the Run',
      { ...still, pointer: { ref: POINTER, submittedBy: WORKFLOW_AUTOMATION_ACTOR } },
      { outcome: 'released', notSent: 'run_ended', stopHold: true }],
    ['the Run ended and was not replaced', { ...still, runEnded: true },
      { outcome: 'released', notSent: 'run_ended', stopHold: true }],
    ['nothing moved', still, { outcome: 'released', notSent: null, stopHold: true }],
  ])('%s', (_label, read, expected) => {
    expect(releaseVerdict(read)).toEqual(expected);
  });
});

describe('C1: the dispatch acceptance and a lease the phase does not count (review table, second half)', () => {
  it('a P6 Task (its last Run failed) whose lease another Run holds: busy (in progress)', () => {
    const problem = dispatchTaskProblem({ taskKind: 'work', disposition: 'active', row: 'P6', phase: 'failed',
      cause: { code: 'run_failed' } }, { ranBefore: true, leaseHeld: true });
    expect(problem).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(problem?.reason).toContain('in progress');
  });
});
