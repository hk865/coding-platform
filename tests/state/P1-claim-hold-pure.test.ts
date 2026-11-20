/**
 * P1 U3–U6 (contract `p1-frozen.md` 2.4, 2.5, 2.7, 2.8; section 五): the pure rules under the new owners, as tables
 * (RULES A5, S1, S2). Expected values are the contract's, written out by hand.
 *
 * Red before P1:
 * - U3, and U4's hold facts: at import, `src/core/work-graph/state/task-claim-hold.ts` did not exist.
 * - U4: `taskClaimProblem` had no hold fact (behaviour: a held Task claims); U5: `controlSubmissionProblem` took no
 *   source (behaviour: an action steer on a paused Run passes); U6: `newBasisInputProblem` had no "the responder is
 *   the caller's line" observation (behaviour: an own reply is a new basis).
 *
 * The adapters below are the only lines that name the build's functions and fields (renamed at stacking to the
 * builder's: `placeHoldReason`, `releaseHoldReason`, `releaseAllHoldReasons`, `occupyHoldPointer`, `holdBlockerOf`,
 * `TaskClaimFacts.claimHold`, `source: 'action_request'`, `repliedByCaller`). Lead ruling at stacking (the
 * contract's 2.4 wins over 五 U3): who may release a reason is the owner's rule, a service row (H1, H2, H6); taking
 * an occupied `pendingStop` is refused by the owner at acceptance (S1), and the pure constructor may overwrite.
 *
 * Mutations (lead, after stacking): U3 — releasing all also clears `pendingStop`; U4 — an `openDispatch` alone blocks,
 * and the review-claim exemption also lets a hold through; U5 — every steer on a paused pointer is refused; U6 — the
 * check ignores who replied.
 */
import { describe, expect, it } from 'vitest';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { newBasisInputProblem } from '../../src/contracts/no-progress.js';
import { controlSubmissionProblem } from '../../src/core/work-graph/state/control-intent-machine.js';
import { taskClaimProblem, type TaskClaimFacts } from '../../src/core/work-graph/state/task-machine.js';
import {
  holdBlockerOf, occupyHoldPointer, placeHoldReason, releaseAllHoldReasons, releaseHoldReason,
  type PendingTaskClaimHoldV1,
} from '../../src/core/work-graph/state/task-claim-hold.js';

const SESSION = (id: string) => ({ projectId: 'p1', sessionId: id });
const QUERY_RUN = (id: string) => ({ aggregateType: 'QueryRun' as const, projectId: 'p1', workspaceId: 'w1',
  queryJobId: `q-${id}`, runId: `qr-${id}` });
const QUERY_JOB = (id: string) => ({ aggregateType: 'QueryJob' as const, projectId: 'p1', workspaceId: 'w1',
  queryJobId: `q-${id}` });
const MESSAGE: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: 'p1', workspaceId: 'w1', messageId: 'm-1' };
const RUN: RunRef = { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'run-1' };
const ACTION = (requestId: string) => ({ aggregateType: 'ActionRequest' as const, projectId: 'p1', goalId: 'g1',
  taskId: 't1', requestId });
const AT = '2026-11-20T00:00:00.000Z';
const EMPTY: PendingTaskClaimHoldV1 = { ref: { aggregateType: 'TaskClaimHold', projectId: 'p1', goalId: 'g1',
  taskId: 't1' }, revision: 1, schemaVersion: 1, workspaceId: 'w1', reasons: [], pendingStop: null, openDispatch: null };

/** One reason as its placer asks for it (2.4 `placedBy`, `basis`; `basis` is Q4b's raw facts). */
const agent = (line: string, duty: 'adviser' | 'secretary', reason: string) => ({ kind: 'agent' as const, reason,
  placedBy: { kind: 'agent' as const, session: SESSION(line), queryRun: QUERY_RUN(line), duty },
  basis: { kind: 'round' as const, requestRoot: null, sourceMessage: null, round: QUERY_JOB(line) } });
const scribe = { kind: 'scribe_stop' as const, reason: 'p1 scribe stop',
  placedBy: { kind: 'platform' as const, operationId: 'op-scribe' },
  basis: { kind: 'scribe' as const, sourceMessage: MESSAGE, run: RUN } };
const stop = { kind: 'stop' as const, reason: 'p1 stop', placedBy: { kind: 'action' as const, actionRef: ACTION('r-stop') },
  basis: { kind: 'round' as const, requestRoot: null, sourceMessage: null, round: QUERY_JOB('a') } };

/** The reasons' states in order (a plain view: the record type is too deep for the array methods' inference). */
const statesOf = (hold: { reasons: readonly { state: string }[] }): string[] => hold.reasons.map(entry => entry.state);

/** Adapter: place one reason (`placeHoldReason`; each placement brings its own reason id, as the owner's command does). */
const place = (hold: PendingTaskClaimHoldV1, input: typeof scribe | typeof stop | ReturnType<typeof agent>) =>
  placeHoldReason(hold, { ...input, id: `h-${String(hold.reasons.length)}-${input.reason}`, placedAt: AT, since: null })
    .hold;
/** Adapter: take a pointer (`occupyHoldPointer`). */
const occupy = (hold: PendingTaskClaimHoldV1, pointer: 'pendingStop' | 'openDispatch', requestId: string) =>
  occupyHoldPointer(hold, pointer, ACTION(requestId));

describe('U3: the TaskClaimHold constructors (2.4)', () => {
  it.each<[string, () => PendingTaskClaimHoldV1, number]>([
    ['the same placer and basis twice keep one reason', () => place(place(EMPTY, agent('a', 'adviser', 'p1 hold a')),
      agent('a', 'adviser', 'p1 hold a')), 1],
    ['two placers keep two reasons', () => place(place(EMPTY, agent('a', 'adviser', 'p1 hold a')),
      agent('s', 'secretary', 'p1 hold s')), 2],
  ])('%s', (_label, make, count) => {
    expect(statesOf(make()).filter(state => state === 'held')).toHaveLength(count);
  });

  it('the person releasing all releases every reason, the scribe one too, and leaves pendingStop', () => {
    const occupied = occupy(place(place(place(EMPTY, agent('s', 'secretary', 'p1 hold s')), scribe), stop),
      'pendingStop', 'r-stop');
    const out = releaseAllHoldReasons(occupied, { kind: 'person', actor: { kind: 'human', id: 'p1-operator' } });
    expect(out.pendingStop).toEqual(ACTION('r-stop'));
    expect(statesOf(out)).toEqual(['released', 'released', 'released']);
  });
});

const FIRST_CLAIM: TaskClaimFacts = { goalDesiredState: 'active', activePlanMatchesClaim: true, sessionProblem: null,
  structuralProblem: null, lease: { status: 'free' }, taskHasRun: false, prior: null, requeue: null, admission: null };
const PENDING_TASK = { taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const };
const REVIEW_BASIS = { kind: 'review' as const, reviewRef: { aggregateType: 'UnknownCallReview' as const, projectId: 'p1',
  goalId: 'g1', taskId: 't1', runId: 'run-1' }, expectedRevision: 1, phase: 'review' as const, round: 1, afterRunRef: RUN };

const detailOf = (problem: ReturnType<typeof taskClaimProblem>): string => problem === null || problem.ok ? '' : problem.detail;

describe('U4: taskClaimProblem with the hold fact (2.5)', () => {
  const held = place(EMPTY, agent('s', 'secretary', 'p1 hold s'));
  const releasedOnly = releaseHoldReason(held, held.reasons[0]!.id, { kind: 'agent', session: SESSION('s') }, null);
  const onlyDispatch = occupy(EMPTY, 'openDispatch', 'r-d');
  const stopPending = occupy(EMPTY, 'pendingStop', 'r-s');
  /** Adapter: the claim facts carrying `holdBlockerOf`'s answer as `claimHold` (absent when nothing blocks, 2.5). */
  const factsWith = (hold: PendingTaskClaimHoldV1 | undefined): TaskClaimFacts => {
    const blocker = hold === undefined ? null : holdBlockerOf(hold);
    return blocker === null ? FIRST_CLAIM : { ...FIRST_CLAIM, claimHold: blocker };
  };

  it.each<[string, PendingTaskClaimHoldV1 | undefined, 'first' | 'review', null | { text: string }]>([
    ['no hold record', undefined, 'first', null],
    ['only an openDispatch', onlyDispatch, 'first', null],
    ['a held reason', held, 'first', { text: 'claim hold' }],
    ['only released reasons', releasedOnly!.hold, 'first', null],
    ['a pendingStop', stopPending, 'first', { text: 'stop request' }],
    ['a review claim (TASK-03r) over a held reason', held, 'review', { text: 'claim hold' }],
  ])('%s', (_label, hold, basis, expected) => {
    const problem = taskClaimProblem(PENDING_TASK, basis === 'first' ? { kind: 'first' } : REVIEW_BASIS, factsWith(hold));
    if (expected === null) expect(problem).toBeNull();
    else {
      expect(problem).toMatchObject({ ok: false, code: 'busy' });
      expect(detailOf(problem)).toContain(expected.text);
    }
  });

  it("the busy text names the placer's reason", () => {
    expect(detailOf(taskClaimProblem(PENDING_TASK, { kind: 'first' }, factsWith(held)))).toContain('p1 hold s');
  });
});

describe('U5: controlSubmissionProblem with the source (2.7)', () => {
  const PAUSED = { kind: 'steer' as const, reason: 'p1 steer', pointer: 'paused' as const, yielded: false,
    continuationConsumed: false, pointerIntent: { kind: 'pause' as const, status: 'applied' as const,
      observed: 'paused' as const }, goal: 'active' as const };
  const ACTION_SOURCE = 'action_request' as const;
  it.each<[string, Parameters<typeof controlSubmissionProblem>[0], string | null]>([
    ['an action steer on a paused Run', { ...PAUSED, source: ACTION_SOURCE }, 'paused'],
    ["the caller's steer on a paused Run", PAUSED, null],
    ['an action steer on a Run with no pointer', { ...PAUSED, pointer: 'none', pointerIntent: null,
      source: ACTION_SOURCE }, null],
  ])('%s', (_label, input, refusal) => {
    const problem = controlSubmissionProblem(input);
    if (refusal === null) expect(problem).toBeNull();
    else {
      expect(problem).toMatchObject({ status: 'rejected', code: 'busy' });
      expect(problem?.reason).toContain(refusal);
    }
  });
});

describe('U6: newBasisInputProblem and the own reply (2.8, Q10b)', () => {
  it.each<[string, boolean, string | null]>([
    ["a reply by the caller's own line", true, 'own reply'],
    ['a reply by another line', false, null],
  ])('%s', (_label, repliedByCaller, refusal) => {
    const problem = newBasisInputProblem({ kind: 'session_message', ref: MESSAGE },
      { kind: 'session_message', status: 'responded', repliedByCaller });
    if (refusal === null) expect(problem).toBeNull();
    else expect(problem).toContain(refusal);
  });
});
