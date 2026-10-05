/**
 * A.2 step 2 (spec §15.2 第 2 步): the TaskAttempt, TaskLease and
 * DispatchOutboxEntry machines of spec §5 (`state/attempt-machine.ts`).
 *
 * - Every (state, event) combination of the three machines: a legal one
 *   asserts `next` (also byte for byte against today's record literals) and
 *   `effects`; a no-change one asserts `ok:true`, the same record and
 *   `effects:[]` (SD-1); an illegal one asserts `reason` and `code` (§5.4).
 * - 新增 rows still return `illegal`/`invalid`; ATT-07 and ATT-16 keep today's
 *   result (step 5 flips them).
 * - Guard rows: the Run node, Session and Lease ownership, the event sequence
 *   (and today's order: Run node, sequence, outcome), the four `ownsLease` ×
 *   `ownsSession` combinations of ATT-06, every known outcome, one code per Run
 *   event for the ATT-36/37 pair, and the D-14 pairing along a claim → enter →
 *   end walk.
 *
 * Pure: no RecordStore, no Kernel, no model.
 */
import { describe, expect, it } from 'vitest';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { CoreError } from '../../src/contracts/core/results.js';
import type {
  ConsumedWaitV1, DispatchOutboxRef, RunOutcome, RunRef, TaskAttemptRef, TaskAttemptSnapshot, TaskLeaseRef,
  TaskLeaseSnapshot,
} from '../../src/contracts/dispatch.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import {
  attemptEventFromRunEvent, attemptNodeOf, isTaskLeaseEvent, leaseHeldByClaim,
  newDispatchOutboxRecord, newTaskAttemptRecord, newTaskLeaseRecord, taskLeaseNodeOf, transitionAttempt,
  transitionDispatchOutbox, transitionTaskLease,
  type AttemptEffect, type AttemptEndFacts, type AttemptEndSource, type AttemptEvent, type AttemptGuardContext,
  type AttemptRunNode,
  type DispatchOutboxRecord, type DispatchStateV1, type RunEventForAttempt, type TaskLeaseEvent,
} from '../../src/core/work-graph/state/attempt-machine.js';
import type { Transition, TransitionRejectReason } from '../../src/core/work-graph/state/transition.js';
import type { TaskClaimOutbox, TaskDispatchStateV1 } from '../../src/core/work-graph/tasks/claim-contracts.js';

/**
 * The Outbox counterpart of `attemptNodeOf`/`taskLeaseNodeOf` (moved from
 * `attempt-machine.ts` in A.2 step 4: production reads `outbox.status` directly).
 */
type DispatchOutboxNode = 'absent' | DispatchOutboxRecord['status'];
function dispatchOutboxNodeOf(outbox: DispatchOutboxRecord | null): DispatchOutboxNode {
  return outbox === null ? 'absent' : outbox.status;
}

// ------------------------------------------------------------------------ //
// Fixtures                                                                  //
// ------------------------------------------------------------------------ //

const P = 'att-project', G = 'att-goal', T = 'att-task', W = 'att-workspace';
const GEN = 4;
const T_PRIOR = '2026-10-04T00:00:00.000Z';
const T_PRIOR_END = '2026-10-04T00:05:00.000Z';
const T_CLAIM = '2026-10-04T01:00:00.000Z';
const T_ENTER = '2026-10-04T01:01:00.000Z';
const T_END = '2026-10-04T01:02:00.000Z';
const T_UNKNOWN = '2026-10-04T01:03:00.000Z';
const T_RESOLVED = '2026-10-04T01:04:00.000Z';

const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const attemptRef = (attemptId: string): TaskAttemptRef =>
  ({ aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId });
const outboxRef = (attemptId: string): DispatchOutboxRef =>
  ({ aggregateType: 'DispatchOutboxEntry', projectId: P, goalId: G, taskId: T, attemptId });
const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const sessionRef = { projectId: P, sessionId: 'ses-1' };
const leaseRef: TaskLeaseRef = { aggregateType: 'TaskLease', projectId: P, goalId: G, taskId: T };

/** The claim of Run `run-1` / Attempt `att-1` at Session generation 4. */
const claim: TaskClaim = {
  task: { projectId: P, goalId: G, taskId: T }, planRef, workspaceId: W, sessionRef, sessionRevision: GEN,
  generation: GEN, runRef: runRef('run-1'), attemptRef: attemptRef('att-1'), outboxRef: outboxRef('att-1'),
  claimedAt: T_CLAIM,
};
const consumedWait: ConsumedWaitV1 = {
  runRef: runRef('run-0'),
  messageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'msg-1' },
  responseRef: { kind: 'artifact', contentType: 'text/plain', digest: 'a'.repeat(64), sizeBytes: 3,
    source: { kind: 'workspace', refId: W, revision: '1' } },
};
const requeueRef: TaskRequeueRef = { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId: 'run-0' };
const entry = { consumerId: 'consumer-1', entryGeneration: 1 };

// Records, written in today's literal key order (claim-service.ts, execution-entry-service.ts).
const ATTEMPT_CLAIMED: TaskAttemptSnapshot = { ref: attemptRef('att-1'), revision: 1, schemaVersion: 1, runId: 'run-1',
  planRef, status: 'claimed', startedAt: null, endedAt: null, endOutcome: null };
const ATTEMPT_CLAIMED_REQUEUE: TaskAttemptSnapshot = { ...ATTEMPT_CLAIMED, requeueRef };
const ATTEMPT_STARTED: TaskAttemptSnapshot = { ...ATTEMPT_CLAIMED, revision: 2, status: 'started', startedAt: T_ENTER };
const ATTEMPT_ENDED: TaskAttemptSnapshot = { ...ATTEMPT_STARTED, revision: 3, status: 'ended', endedAt: T_END,
  endOutcome: 'completed' };
const ATTEMPT_UNKNOWN: TaskAttemptSnapshot = { ...ATTEMPT_STARTED, revision: 3, status: 'ended', endedAt: T_UNKNOWN,
  endOutcome: 'outcome_unknown' };
/** ATT-36: ended from Entering without a readable Turn; `startedAt` stays null (L-2). */
const ATTEMPT_UNKNOWN_UNSTARTED: TaskAttemptSnapshot = { ...ATTEMPT_CLAIMED, revision: 2, status: 'ended',
  endedAt: T_UNKNOWN, endOutcome: 'outcome_unknown' };

const LEASE_HELD: TaskLeaseSnapshot = { ref: leaseRef, revision: 1, schemaVersion: 1, holderRunId: 'run-1',
  attemptId: 'att-1', grantedAt: T_CLAIM, expiresAt: null };
/** Released by the earlier yielded Run `run-0` (the continuation's prior Run). */
const LEASE_RELEASED: TaskLeaseSnapshot = { ref: leaseRef, revision: 4, schemaVersion: 1, holderRunId: 'run-0',
  attemptId: 'att-0', grantedAt: T_PRIOR, expiresAt: null,
  release: { schemaVersion: 1, runRef: runRef('run-0'), attemptRef: attemptRef('att-0'), sessionRef, generation: 2,
    releasedAt: T_PRIOR_END, eventId: 'evt-prior' } };
const LEASE_REHELD: TaskLeaseSnapshot = { ref: leaseRef, revision: 5, schemaVersion: 1, holderRunId: 'run-1',
  attemptId: 'att-1', grantedAt: T_CLAIM, expiresAt: null };
const LEASE_RELEASED_BY_CLAIM: TaskLeaseSnapshot = { ...LEASE_HELD, revision: 2,
  release: { schemaVersion: 1, runRef: runRef('run-1'), attemptRef: attemptRef('att-1'), sessionRef, generation: GEN,
    releasedAt: T_END, eventId: 'evt-end' } };

const OUTBOX_PENDING: DispatchOutboxRecord = { ref: outboxRef('att-1'), revision: 1, schemaVersion: 1,
  status: 'pending', claim };
const OUTBOX_ENTERED: DispatchOutboxRecord = { ...OUTBOX_PENDING, revision: 2, status: 'entered',
  dispatchState: { schemaVersion: 1, phase: 'entered', consumerId: 'consumer-1', entryGeneration: 1,
    sessionGeneration: GEN, eventId: 'evt-enter' } };
const OUTBOX_SETTLED: DispatchOutboxRecord = { ...OUTBOX_ENTERED, revision: 3, status: 'settled',
  dispatchState: { schemaVersion: 1, phase: 'settled', consumerId: 'consumer-1', entryGeneration: 1,
    sessionGeneration: GEN, eventId: 'evt-end' } };

const ctxOf = (runNode: AttemptRunNode, runLastEventSeq: number, owns: boolean): AttemptGuardContext =>
  ({ runNode, runLastEventSeq, ownsSession: owns, ownsLease: owns });

// Events. Terminal-like events carry a fresh sequence (5); platform decisions carry none.
const ended = (source: AttemptEndSource, endOutcome: RunOutcome, extra: Partial<AttemptEndFacts> = {},
): Extract<AttemptEvent, { kind: 'attempt_ended' }> => ({
  kind: 'attempt_ended', source, claim, endOutcome, endedAt: T_END, eventId: 'evt-end',
  sequence: source === 'stop_not_entered' || source === 'reconcile_unknown' ? null : 5,
  entry: source === 'stop_not_entered' ? null : entry, turnStartedAt: null, ...extra,
});
const resolved = (source: 'late_evidence' | 'unknown_attested'): AttemptEvent => ({
  kind: 'attempt_resolved', source, claim, outcome: source === 'late_evidence' ? 'completed' : 'crashed',
  resolvedAt: T_RESOLVED, eventId: 'evt-resolve', sequence: source === 'late_evidence' ? 6 : null, entry,
  turnStartedAt: null,
});
const STARTED_EVENT: AttemptEvent = { kind: 'attempt_started', enteredAt: T_ENTER, consumerId: 'consumer-1',
  entryGeneration: 1, sessionGeneration: GEN, eventId: 'evt-enter' };

const EVENTS = {
  'claim:first': { kind: 'attempt_claimed', claim, basis: { kind: 'first' } },
  'claim:continuation': { kind: 'attempt_claimed', claim, basis: { kind: 'continuation', consumedWait } },
  'claim:requeue': { kind: 'attempt_claimed', claim, basis: { kind: 'requeue', requeueRef } },
  'started': STARTED_EVENT,
  'end:terminal_observed:known': ended('terminal_observed', 'completed'),
  'end:terminal_observed:unknown': ended('terminal_observed', 'outcome_unknown'),
  'end:stop_not_entered': ended('stop_not_entered', 'cancelled'),
  'end:stop_paused': ended('stop_paused', 'cancelled'),
  'end:reconcile_terminal': ended('reconcile_terminal', 'completed'),
  'end:reconcile_interrupted_clean': ended('reconcile_interrupted_clean', 'crashed'),
  'end:reconcile_unknown': ended('reconcile_unknown', 'outcome_unknown'),
  'resolve:late_evidence': resolved('late_evidence'),
  'resolve:unknown_attested': resolved('unknown_attested'),
  'entry_authorized': { kind: 'entry_authorized' },
  'entry_begun': { kind: 'entry_begun' },
  'history_recorded': { kind: 'history_recorded' },
  'reconcile_not_entered': { kind: 'reconcile_not_entered' },
} satisfies Record<string, AttemptEvent>;
type EventLabel = keyof typeof EVENTS;
const EVENT_LABELS = Object.keys(EVENTS) as EventLabel[];

// ------------------------------------------------------------------------ //
// Expectation helpers                                                        //
// ------------------------------------------------------------------------ //

type Expect =
  | { ok: true; same: true }
  | { ok: true; same: false; next: unknown; effects: readonly unknown[] }
  | { ok: false; reason: TransitionRejectReason; code: CoreError };

const SAME: Expect = { ok: true, same: true };
const to = (next: unknown, effects: readonly unknown[] = []): Expect => ({ ok: true, same: false, next, effects });
const no = (reason: TransitionRejectReason, code: CoreError): Expect => ({ ok: false, reason, code });
const II = no('illegal', 'invalid');
const IB = no('illegal', 'busy');
const DB = no('duplicate', 'busy');
const GB = no('guard_failed', 'busy');
const GI = no('guard_failed', 'incomplete');
/** §5.4 Outbox row under `outcome_unknown`: `illegal`, with the paired Attempt row's code. */
const IU = no('illegal', 'incomplete');

function check(actual: Transition<unknown, unknown, unknown>, expected: Expect, state: unknown): void {
  if (!expected.ok) {
    expect(actual).toMatchObject({ ok: false, reason: expected.reason, code: expected.code });
    if (!actual.ok) expect(actual.detail.length).toBeGreaterThan(0);
    return;
  }
  if (expected.same) {
    expect(actual).toEqual({ ok: true, next: state, effects: [] });
    if (actual.ok) expect(actual.next).toBe(state);
    return;
  }
  expect(actual).toEqual({ ok: true, next: expected.next, effects: expected.effects });
  // Same bytes as today's literals, so the step 3 refactor stores identical rows.
  if (actual.ok) expect(JSON.stringify(actual.next)).toBe(JSON.stringify(expected.next));
}

const SETTLE: AttemptEffect = { kind: 'settle_outbox', settlement: 'entered' };
const RELEASE_LEASE: AttemptEffect = { kind: 'release_lease' };
const RELEASE_SESSION: AttemptEffect = { kind: 'release_session', sessionRef, generation: GEN };

// ------------------------------------------------------------------------ //
// TaskAttempt: every (state, event)                                          //
// ------------------------------------------------------------------------ //

const ATTEMPT_STATES = {
  absent: { record: null, ctx: ctxOf('Absent', 0, false) },
  claimed: { record: ATTEMPT_CLAIMED, ctx: ctxOf('Entering', 0, true) },
  started: { record: ATTEMPT_STARTED, ctx: ctxOf('Running', 1, true) },
  ended_known: { record: ATTEMPT_ENDED, ctx: ctxOf('Ended', 2, false) },
  ended_unknown: { record: ATTEMPT_UNKNOWN, ctx: ctxOf('EndedUnknown', 1, true) },
  ended_unknown_unstarted: { record: ATTEMPT_UNKNOWN_UNSTARTED, ctx: ctxOf('EndedUnknown', 0, true) },
} satisfies Record<string, { record: TaskAttemptSnapshot | null; ctx: AttemptGuardContext }>;
type AttemptStateLabel = keyof typeof ATTEMPT_STATES;

/** Columns: absent, claimed, started, ended_known, ended_unknown, ended_unknown_unstarted. */
const row = <L extends string>(labels: readonly L[], ...cells: Expect[]): Record<L, Expect> => {
  expect(cells).toHaveLength(labels.length);
  return Object.fromEntries(labels.map((label, index) => [label, cells[index]!])) as Record<L, Expect>;
};
const A_COLS = Object.keys(ATTEMPT_STATES) as AttemptStateLabel[];
const a = (...cells: Expect[]): Record<AttemptStateLabel, Expect> => row(A_COLS, ...cells);

const ATTEMPT_TABLE: Record<EventLabel, () => Record<AttemptStateLabel, Expect>> = {
  // ATT-01 from ∅ only; an existing Attempt never takes a second claim.
  'claim:first': () => a(to(ATTEMPT_CLAIMED), II, II, II, II, II),
  'claim:continuation': () => a(to(ATTEMPT_CLAIMED), II, II, II, II, II),
  // TASK-03 keeps today's result: requeueRef is not read, so the Attempt records none (`claimBasisToday`).
  'claim:requeue': () => a(to(ATTEMPT_CLAIMED), II, II, II, II, II),
  // ATT-02; a second entry keeps today's busy (auth not entering, :1223); an ended
  // Attempt never moves back to started (§5.4).
  'started': () => a(II, to(ATTEMPT_STARTED, [{ kind: 'enter_outbox' }]), IB, II, II, II),
  // claimed: §5.4 busy; started: ATT-06; ended known: ATT-13; unknown: §5.4 not new evidence.
  'end:terminal_observed:known': () =>
    a(II, IB, to(ATTEMPT_ENDED, [SETTLE, RELEASE_LEASE, RELEASE_SESSION]), DB, GI, GI),
  // ATT-07 keeps today's result (recordRunResult accepts only a known terminal).
  'end:terminal_observed:unknown': () => a(II, IB, II, DB, GI, GI),
  // ATT-05 needs a Run that never entered (`claimed` pairs with Entering here: §5.4, the stop is queued); never
  // from an entered or unknown Run. The not-entered nodes: 'ATT-05 / ATT-23 / ATT-30' below.
  'end:stop_not_entered': () => a(II, II, II, DB, II, II),
  // ATT-31 / ATT-35 (新增).
  'end:stop_paused': () => a(II, II, II, DB, GI, GI),
  // ATT-31 / ATT-08 (新增).
  'end:reconcile_terminal': () => a(II, II, II, DB, GI, GI),
  // ATT-31 / ATT-09 (新增).
  'end:reconcile_interrupted_clean': () => a(II, II, II, DB, GI, GI),
  // ATT-32, ATT-36 / ATT-10 (新增).
  'end:reconcile_unknown': () => a(II, II, II, DB, GI, GI),
  // ATT-11 / ATT-12 (新增); a known terminal is never rewritten (§5.4).
  'resolve:late_evidence': () => a(II, II, II, IB, II, II),
  'resolve:unknown_attested': () => a(II, II, II, IB, II, II),
  // ATT-03: W3/W4 write only the Run; after starting the Run machine rejects them (§6.4, busy).
  'entry_authorized': () => a(II, SAME, IB, IB, IB, IB),
  'entry_begun': () => a(II, SAME, IB, IB, IB, IB),
  // ATT-03: W9 writes only the Run, at any node.
  'history_recorded': () => a(II, SAME, SAME, SAME, SAME, SAME),
  // ATT-04 (新增).
  'reconcile_not_entered': () => a(II, II, II, II, II, II),
};

describe('transitionAttempt: every (state, event) combination', () => {
  for (const eventLabel of EVENT_LABELS) {
    for (const stateLabel of A_COLS) {
      it(`${stateLabel} × ${eventLabel}`, () => {
        const { record, ctx } = ATTEMPT_STATES[stateLabel];
        check(transitionAttempt(record, EVENTS[eventLabel], ctx), ATTEMPT_TABLE[eventLabel]()[stateLabel], record);
      });
    }
  }
});

// ------------------------------------------------------------------------ //
// TaskLease: every (state, event)                                            //
// ------------------------------------------------------------------------ //

const LEASE_STATES = {
  absent: null,
  held: LEASE_HELD,
  released: LEASE_RELEASED,
} satisfies Record<string, TaskLeaseSnapshot | null>;
type LeaseStateLabel = keyof typeof LEASE_STATES;
const L_COLS = Object.keys(LEASE_STATES) as LeaseStateLabel[];
const l = (...cells: Expect[]): Record<LeaseStateLabel, Expect> => row(L_COLS, ...cells);
const LEASE_EVENT_LABELS = EVENT_LABELS.filter(label => isTaskLeaseEvent(EVENTS[label]));

const LEASE_TABLE: Partial<Record<EventLabel, () => Record<LeaseStateLabel, Expect>>> = {
  // ATT-14 / ATT-17 / §5.4 first claim on a released lease.
  'claim:first': () => l(to(LEASE_HELD), GB, GB),
  // ATT-15: the released holder is the prior yielded Run.
  'claim:continuation': () => l(GB, GB, to(LEASE_REHELD)),
  // ATT-16 keeps today's result: requeueRef is not read, so it is a first claim
  // (ATT-14 @1 without a lease, busy on a released one).
  'claim:requeue': () => l(to(LEASE_HELD), GB, GB),
  // ATT-18 for the owner; ATT-19 no-effect for a missing lease or an earlier release.
  'end:terminal_observed:known': () => l(SAME, to(LEASE_RELEASED_BY_CLAIM), SAME),
  // ATT-20 (新增).
  'end:terminal_observed:unknown': () => l(II, II, II),
  // ATT-23 for the claim's own hold; ATT-19 no-effect for a missing lease or an earlier release.
  'end:stop_not_entered': () => l(SAME, to(LEASE_RELEASED_BY_CLAIM), SAME),
  // ATT-18 through reconciliation (ATT-31), ATT-20 (新增).
  'end:stop_paused': () => l(II, II, II),
  'end:reconcile_terminal': () => l(II, II, II),
  'end:reconcile_interrupted_clean': () => l(II, II, II),
  'end:reconcile_unknown': () => l(II, II, II),
  // ATT-22 (新增).
  'resolve:late_evidence': () => l(II, II, II),
  'resolve:unknown_attested': () => l(II, II, II),
  // ATT-21 (新增).
  'reconcile_not_entered': () => l(II, II, II),
};

describe('transitionTaskLease: every (state, event) combination', () => {
  it('drives the lease exactly with the events of the §5.3 mapping table', () => {
    expect(LEASE_EVENT_LABELS.sort()).toEqual((Object.keys(LEASE_TABLE) as EventLabel[]).sort());
  });
  for (const eventLabel of LEASE_EVENT_LABELS) {
    for (const stateLabel of L_COLS) {
      it(`${stateLabel} × ${eventLabel}`, () => {
        const state = LEASE_STATES[stateLabel];
        const expected = LEASE_TABLE[eventLabel]!()[stateLabel];
        check(transitionTaskLease(state, EVENTS[eventLabel] as TaskLeaseEvent), expected, state);
      });
    }
  }
});

// ------------------------------------------------------------------------ //
// DispatchOutbox: every (state, event)                                       //
// ------------------------------------------------------------------------ //

const OUTBOX_STATES = {
  absent: { record: null, ctx: ctxOf('Absent', 0, false) },
  pending: { record: OUTBOX_PENDING, ctx: ctxOf('Entering', 0, true) },
  /** ATT-37: pending while the Run is EndedUnknown (L-2). */
  pending_unknown: { record: OUTBOX_PENDING, ctx: ctxOf('EndedUnknown', 0, true) },
  entered: { record: OUTBOX_ENTERED, ctx: ctxOf('Running', 1, true) },
  /** AD-1: entered while the Run is EndedUnknown. */
  entered_unknown: { record: OUTBOX_ENTERED, ctx: ctxOf('EndedUnknown', 1, true) },
  settled: { record: OUTBOX_SETTLED, ctx: ctxOf('Ended', 2, false) },
} satisfies Record<string, { record: DispatchOutboxRecord | null; ctx: AttemptGuardContext }>;
type OutboxStateLabel = keyof typeof OUTBOX_STATES;
const O_COLS = Object.keys(OUTBOX_STATES) as OutboxStateLabel[];
const o = (...cells: Expect[]): Record<OutboxStateLabel, Expect> => row(O_COLS, ...cells);

/** Columns: absent, pending, pending_unknown, entered, entered_unknown, settled. */
const OUTBOX_TABLE: Record<EventLabel, () => Record<OutboxStateLabel, Expect>> = {
  // ATT-24 from ∅ only.
  'claim:first': () => o(to(OUTBOX_PENDING), II, II, II, II, II),
  'claim:continuation': () => o(to(OUTBOX_PENDING), II, II, II, II, II),
  'claim:requeue': () => o(to(OUTBOX_PENDING), II, II, II, II, II),
  // ATT-26 with the ATT-02 guard; the ATT-37 pending never enters (§5.4 last row,
  // the paired Attempt's invalid); a second entry keeps today's busy (:1223);
  // settled never enters again (§5.4).
  'started': () => o(II, to(OUTBOX_ENTERED), II, IB, IB, II),
  // §5.4 pending busy; ATT-27; unknown keeps waiting (AD-1, L-2: §5.4 illegal); settled mirrors ATT-13.
  'end:terminal_observed:known': () => o(II, IB, IU, to(OUTBOX_SETTLED), IU, DB),
  // ATT-28 (新增) keeps today's result.
  'end:terminal_observed:unknown': () => o(II, IB, IU, II, IU, DB),
  // ATT-30 needs a Run that never entered (pending pairs with Entering here); never from an entered Run.
  'end:stop_not_entered': () => o(II, II, II, II, II, DB),
  // ATT-33 / ATT-27 via ATT-35, 08, 09 (新增).
  'end:stop_paused': () => o(II, II, IU, II, IU, DB),
  'end:reconcile_terminal': () => o(II, II, IU, II, IU, DB),
  'end:reconcile_interrupted_clean': () => o(II, II, IU, II, IU, DB),
  // ATT-34, ATT-37 / ATT-28 (新增).
  'end:reconcile_unknown': () => o(II, II, IU, II, IU, DB),
  // ATT-29 (新增); a known terminal is never rewritten.
  'resolve:late_evidence': () => o(II, II, II, II, II, IB),
  'resolve:unknown_attested': () => o(II, II, II, II, II, IB),
  // ATT-25; the ATT-37 pending belongs to an EndedUnknown Run, which refuses W3/W4
  // like the paired Attempt (§6.4 busy).
  'entry_authorized': () => o(II, SAME, IB, IB, IB, IB),
  'entry_begun': () => o(II, SAME, IB, IB, IB, IB),
  'history_recorded': () => o(II, SAME, SAME, SAME, SAME, SAME),
  // ATT-25 (D-5 part, 新增).
  'reconcile_not_entered': () => o(II, II, II, II, II, II),
};

describe('transitionDispatchOutbox: every (state, event) combination', () => {
  for (const eventLabel of EVENT_LABELS) {
    for (const stateLabel of O_COLS) {
      it(`${stateLabel} × ${eventLabel}`, () => {
        const { record, ctx } = OUTBOX_STATES[stateLabel];
        check(transitionDispatchOutbox(record, EVENTS[eventLabel], ctx), OUTBOX_TABLE[eventLabel]()[stateLabel], record);
      });
    }
  }
});

// ------------------------------------------------------------------------ //
// Guard rows                                                                 //
// ------------------------------------------------------------------------ //

const ALL_RUN_NODES: readonly AttemptRunNode[] = ['Absent', 'Claimed', 'Authorized', 'Entering', 'Revoked', 'Running',
  'Ended', 'YieldedWait', 'EndedUnknown'];

describe('ATT-05 / ATT-23 / ATT-30: the D-7 stop of a Run that never entered', () => {
  const stop = EVENTS['end:stop_not_entered'];
  const ATTEMPT_STOPPED: TaskAttemptSnapshot = { ...ATTEMPT_CLAIMED, revision: 2, status: 'ended', endedAt: T_END,
    endOutcome: 'cancelled' };
  const settledNotEntered = (entry: { consumerId: string; entryGeneration: number } | null): DispatchOutboxRecord => ({
    ...OUTBOX_PENDING, revision: 2, status: 'settled',
    dispatchState: { schemaVersion: 2, phase: 'settled', settlement: 'not_entered', consumerId: entry?.consumerId ?? null,
      entryGeneration: entry?.entryGeneration ?? null, sessionGeneration: GEN, eventId: 'evt-end' } });
  const byNode: Record<AttemptRunNode, Expect | 'legal'> = {
    Absent: no('guard_failed', 'invalid'), Claimed: 'legal', Authorized: 'legal', Revoked: 'legal',
    Entering: II, Running: II, Ended: II, YieldedWait: II, EndedUnknown: II,
  };
  for (const runNode of ALL_RUN_NODES) {
    it(`Run ${runNode}`, () => {
      const expected = byNode[runNode];
      const ctx = ctxOf(runNode, 0, true);
      if (expected === 'legal') {
        // startedAt stays null: there was no Kernel Turn.
        check(transitionAttempt(ATTEMPT_CLAIMED, stop, ctx), to(ATTEMPT_STOPPED,
          [{ kind: 'settle_outbox', settlement: 'not_entered' }, RELEASE_LEASE, RELEASE_SESSION]), ATTEMPT_CLAIMED);
        check(transitionDispatchOutbox(OUTBOX_PENDING, stop, ctx), to(settledNotEntered(null)), OUTBOX_PENDING);
      } else {
        check(transitionAttempt(ATTEMPT_CLAIMED, stop, ctx), expected, ATTEMPT_CLAIMED);
        check(transitionDispatchOutbox(OUTBOX_PENDING, stop, ctx), expected, OUTBOX_PENDING);
      }
    });
  }
  it('releases only what the Run still holds, and settles with the V2 binding of an authorized Run (AD-2)', () => {
    const notOwned = { ...ctxOf('Authorized', 0, false) };
    check(transitionAttempt(ATTEMPT_CLAIMED, stop, notOwned), to(ATTEMPT_STOPPED,
      [{ kind: 'settle_outbox', settlement: 'not_entered' }]), ATTEMPT_CLAIMED);
    check(transitionDispatchOutbox(OUTBOX_PENDING, { ...stop, entry }, ctxOf('Authorized', 0, true)),
      to(settledNotEntered(entry)), OUTBOX_PENDING);
    // ATT-23 for the claim's own hold, ATT-19 otherwise.
    check(transitionTaskLease(LEASE_HELD, stop), to(LEASE_RELEASED_BY_CLAIM), LEASE_HELD);
    const other: TaskLeaseSnapshot = { ...LEASE_HELD, holderRunId: 'run-2', attemptId: 'att-2' };
    check(transitionTaskLease(other, stop), SAME, other);
  });
  it('a stop always ends the Attempt cancelled', () => {
    const completed = ended('stop_not_entered', 'completed');
    check(transitionAttempt(ATTEMPT_CLAIMED, completed, ctxOf('Claimed', 0, true)), II, ATTEMPT_CLAIMED);
    check(transitionDispatchOutbox(OUTBOX_PENDING, completed, ctxOf('Claimed', 0, true)), II, OUTBOX_PENDING);
    check(transitionTaskLease(LEASE_HELD, completed), II, LEASE_HELD);
  });
});

describe('ATT-02 / ATT-26 guard: entering Run, the claim Session and Lease', () => {
  const byNode: Record<AttemptRunNode, Expect | 'legal'> = {
    Absent: no('guard_failed', 'invalid'), Claimed: no('guard_failed', 'forbidden'), Authorized: GB,
    Entering: 'legal', Revoked: GB, Running: GB, Ended: GB, YieldedWait: GB, EndedUnknown: GB,
  };
  for (const runNode of ALL_RUN_NODES) {
    it(`Run ${runNode}`, () => {
      const expected = byNode[runNode];
      const ctx = ctxOf(runNode, 0, true);
      const attempt = transitionAttempt(ATTEMPT_CLAIMED, STARTED_EVENT, ctx);
      const outbox = transitionDispatchOutbox(OUTBOX_PENDING, STARTED_EVENT, ctx);
      if (expected === 'legal') {
        check(attempt, to(ATTEMPT_STARTED, [{ kind: 'enter_outbox' }]), ATTEMPT_CLAIMED);
        check(outbox, to(OUTBOX_ENTERED), OUTBOX_PENDING);
      } else {
        check(attempt, expected, ATTEMPT_CLAIMED);
        // §5.4 last row: a pending outbox of an EndedUnknown Run is the ATT-37 one, which never enters.
        check(outbox, runNode === 'EndedUnknown' ? II : expected, OUTBOX_PENDING);
      }
    });
  }
  it('rejects busy when the Session or the Lease is not this claim generation', () => {
    for (const ctx of [
      { ...ctxOf('Entering', 0, true), ownsSession: false },
      { ...ctxOf('Entering', 0, true), ownsLease: false },
    ]) {
      check(transitionAttempt(ATTEMPT_CLAIMED, STARTED_EVENT, ctx), GB, ATTEMPT_CLAIMED);
      check(transitionDispatchOutbox(OUTBOX_PENDING, STARTED_EVENT, ctx), GB, OUTBOX_PENDING);
    }
    const neither = transitionAttempt(ATTEMPT_CLAIMED, STARTED_EVENT, ctxOf('Entering', 0, false));
    expect(neither).toMatchObject({ ok: false, detail: expect.stringContaining('Session') });
  });
});

describe('ATT-06 / ATT-27 guard: entered Run, sequence, outcome', () => {
  const terminal = EVENTS['end:terminal_observed:known'];
  const byNode: Record<AttemptRunNode, Expect | 'legal'> = {
    Absent: no('guard_failed', 'invalid'), Claimed: no('guard_failed', 'forbidden'), Authorized: GB, Entering: GB,
    Revoked: GB, Running: 'legal', Ended: DB, YieldedWait: DB, EndedUnknown: GI,
  };
  for (const runNode of ALL_RUN_NODES) {
    it(`Run ${runNode}`, () => {
      const expected = byNode[runNode];
      const ctx = ctxOf(runNode, 1, true);
      const attempt = transitionAttempt(ATTEMPT_STARTED, terminal, ctx);
      const outbox = transitionDispatchOutbox(OUTBOX_ENTERED, terminal, ctx);
      if (expected === 'legal') {
        check(attempt, to(ATTEMPT_ENDED, [SETTLE, RELEASE_LEASE, RELEASE_SESSION]), ATTEMPT_STARTED);
        check(outbox, to(OUTBOX_SETTLED), OUTBOX_ENTERED);
      } else {
        check(attempt, expected, ATTEMPT_STARTED);
        // §5.4 Outbox row: an entered outbox is never settled under outcome_unknown (AD-1).
        check(outbox, runNode === 'EndedUnknown' ? IU : expected, OUTBOX_ENTERED);
      }
    });
  }
  it('judges the Run node before the sequence and the outcome (recordRunResult :1362-1364, then terminalFact :1659)', () => {
    const staleKnown = ended('terminal_observed', 'completed', { sequence: 0 });
    const freshUnknown = ended('terminal_observed', 'outcome_unknown');
    const staleUnknown = ended('terminal_observed', 'outcome_unknown', { sequence: 0 });
    for (const runNode of ALL_RUN_NODES) {
      const expected = byNode[runNode];
      if (expected === 'legal' || runNode === 'EndedUnknown') continue;
      const ctx = ctxOf(runNode, 1, true);
      for (const event of [staleKnown, freshUnknown, staleUnknown]) {
        check(transitionAttempt(ATTEMPT_STARTED, event, ctx), expected, ATTEMPT_STARTED);
        check(transitionDispatchOutbox(OUTBOX_ENTERED, event, ctx), expected, OUTBOX_ENTERED);
      }
    }
    // EndedUnknown (§5.4): the sequence first, then "not new evidence".
    const unknownRun = ctxOf('EndedUnknown', 1, true);
    for (const event of [staleKnown, staleUnknown]) {
      check(transitionAttempt(ATTEMPT_STARTED, event, unknownRun), no('stale', 'revision_conflict'), ATTEMPT_STARTED);
      check(transitionDispatchOutbox(OUTBOX_ENTERED, event, unknownRun), no('illegal', 'revision_conflict'), OUTBOX_ENTERED);
    }
    check(transitionAttempt(ATTEMPT_STARTED, freshUnknown, unknownRun), GI, ATTEMPT_STARTED);
    check(transitionDispatchOutbox(OUTBOX_ENTERED, freshUnknown, unknownRun), IU, OUTBOX_ENTERED);
    // Running: the sequence before the terminal type.
    const running = ctxOf('Running', 1, true);
    for (const event of [staleUnknown, ended('terminal_observed', 'failed', { sequence: 1 })]) {
      check(transitionAttempt(ATTEMPT_STARTED, event, running), no('stale', 'revision_conflict'), ATTEMPT_STARTED);
      check(transitionDispatchOutbox(OUTBOX_ENTERED, event, running), no('stale', 'revision_conflict'), OUTBOX_ENTERED);
    }
  });
  it('rejects an event sequence that does not advance the Run as stale (revision_conflict)', () => {
    for (const sequence of [0, 1]) {
      const event = ended('terminal_observed', 'completed', { sequence });
      check(transitionAttempt(ATTEMPT_STARTED, event, ctxOf('Running', 1, true)), no('stale', 'revision_conflict'), ATTEMPT_STARTED);
      check(transitionDispatchOutbox(OUTBOX_ENTERED, event, ctxOf('Running', 1, true)), no('stale', 'revision_conflict'), OUTBOX_ENTERED);
    }
  });
  it('rejects a terminal without the entry projection and the writer-less outcome failed', () => {
    const noEntry = ended('terminal_observed', 'completed', { entry: null });
    const failed = ended('terminal_observed', 'failed');
    for (const event of [noEntry, failed]) {
      check(transitionAttempt(ATTEMPT_STARTED, event, ctxOf('Running', 1, true)), II, ATTEMPT_STARTED);
      check(transitionDispatchOutbox(OUTBOX_ENTERED, event, ctxOf('Running', 1, true)), II, OUTBOX_ENTERED);
    }
    check(transitionTaskLease(LEASE_HELD, failed), II, LEASE_HELD);
  });
  it('ends with every known outcome and records it on the Attempt', () => {
    const known: RunOutcome[] = ['completed', 'cancelled', 'budget_exhausted', 'crashed', 'yielded'];
    for (const outcome of known) {
      const event = ended('terminal_observed', outcome);
      check(transitionAttempt(ATTEMPT_STARTED, event, ctxOf('Running', 1, true)),
        to({ ...ATTEMPT_ENDED, endOutcome: outcome }, [SETTLE, RELEASE_LEASE, RELEASE_SESSION]), ATTEMPT_STARTED);
      check(transitionDispatchOutbox(OUTBOX_ENTERED, event, ctxOf('Running', 1, true)), to(OUTBOX_SETTLED), OUTBOX_ENTERED);
      check(transitionTaskLease(LEASE_HELD, event), to(LEASE_RELEASED_BY_CLAIM), LEASE_HELD);
    }
  });
});

describe('ATT-06 effects follow ownership (ownsLease × ownsSession)', () => {
  const terminal = EVENTS['end:terminal_observed:known'];
  const cases: Array<[boolean, boolean, AttemptEffect[]]> = [
    [true, true, [SETTLE, RELEASE_LEASE, RELEASE_SESSION]],
    [true, false, [SETTLE, RELEASE_LEASE]],
    [false, true, [SETTLE, RELEASE_SESSION]],
    [false, false, [SETTLE]],
  ];
  for (const [ownsLease, ownsSession, effects] of cases) {
    it(`ownsLease=${ownsLease} ownsSession=${ownsSession}`, () => {
      const ctx: AttemptGuardContext = { runNode: 'Running', runLastEventSeq: 1, ownsLease, ownsSession };
      check(transitionAttempt(ATTEMPT_STARTED, terminal, ctx), to(ATTEMPT_ENDED, effects), ATTEMPT_STARTED);
    });
  }
});

describe('TaskLease ownership rows', () => {
  const terminal = EVENTS['end:terminal_observed:known'] as TaskLeaseEvent;
  it('ATT-19: an older generation terminal never releases a newer holder (B2-execution-result :94)', () => {
    const otherRun: TaskLeaseSnapshot = { ...LEASE_HELD, revision: 7, holderRunId: 'run-2', attemptId: 'att-2' };
    const otherAttempt: TaskLeaseSnapshot = { ...LEASE_HELD, attemptId: 'att-9' };
    for (const lease of [otherRun, otherAttempt, LEASE_RELEASED_BY_CLAIM]) {
      expect(leaseHeldByClaim(lease, claim)).toBe(false);
      check(transitionTaskLease(lease, terminal), SAME, lease);
    }
    expect(leaseHeldByClaim(LEASE_HELD, claim)).toBe(true);
    expect(leaseHeldByClaim(null, claim)).toBe(false);
  });
  it('ATT-15: a continuation must consume the wait of the Run that released the lease', () => {
    const otherPrior = { kind: 'attempt_claimed', claim,
      basis: { kind: 'continuation', consumedWait: { ...consumedWait, runRef: runRef('run-x') } } } satisfies AttemptEvent;
    check(transitionTaskLease(LEASE_RELEASED, otherPrior), GB, LEASE_RELEASED);
  });
  it('ATT-17: a held lease refuses every kind of claim', () => {
    for (const label of ['claim:first', 'claim:continuation', 'claim:requeue'] as const) {
      check(transitionTaskLease(LEASE_HELD, EVENTS[label]), GB, LEASE_HELD);
      check(transitionTaskLease({ ...LEASE_HELD, holderRunId: 'run-0', attemptId: 'att-0' }, EVENTS[label]), GB,
        { ...LEASE_HELD, holderRunId: 'run-0', attemptId: 'att-0' });
    }
  });
});

describe('re-observation of an outcome_unknown end (§5.4)', () => {
  const stale = ended('terminal_observed', 'completed', { sequence: 1 });
  const fresh = ended('terminal_observed', 'completed', { sequence: 9 });
  const noSequence = ended('reconcile_unknown', 'outcome_unknown');
  const ctx = ctxOf('EndedUnknown', 1, true);
  it('Attempt: stale when the sequence does not advance, otherwise not new evidence (incomplete)', () => {
    check(transitionAttempt(ATTEMPT_UNKNOWN, stale, ctx), no('stale', 'revision_conflict'), ATTEMPT_UNKNOWN);
    check(transitionAttempt(ATTEMPT_UNKNOWN, fresh, ctx), GI, ATTEMPT_UNKNOWN);
    check(transitionAttempt(ATTEMPT_UNKNOWN, noSequence, ctx), GI, ATTEMPT_UNKNOWN);
  });
  it('Outbox entered (AD-1) or ATT-37 pending: illegal, with the paired Attempt code', () => {
    for (const outbox of [OUTBOX_ENTERED, OUTBOX_PENDING]) {
      check(transitionDispatchOutbox(outbox, stale, ctx), no('illegal', 'revision_conflict'), outbox);
      check(transitionDispatchOutbox(outbox, fresh, ctx), IU, outbox);
      check(transitionDispatchOutbox(outbox, noSequence, ctx), IU, outbox);
    }
  });
  it('ATT-36/37 pair: the Attempt and the pending Outbox refuse a Run event with one reason and code', () => {
    const unknownRun = ctxOf('EndedUnknown', 0, true);
    for (const [label, expected] of [['started', II], ['entry_authorized', IB], ['entry_begun', IB]] as const) {
      check(transitionAttempt(ATTEMPT_UNKNOWN_UNSTARTED, EVENTS[label], unknownRun), expected, ATTEMPT_UNKNOWN_UNSTARTED);
      check(transitionDispatchOutbox(OUTBOX_PENDING, EVENTS[label], unknownRun), expected, OUTBOX_PENDING);
    }
  });
});

// ------------------------------------------------------------------------ //
// Mapping, constructors, nodes and pairing                                   //
// ------------------------------------------------------------------------ //

describe('attemptEventFromRunEvent (§5.3 mapping table)', () => {
  const endFacts = (({ kind: _k, source: _s, ...facts }) => facts)(EVENTS['end:terminal_observed:known']);
  const resolveFacts = (({ kind: _k, source: _s, ...facts }) =>
    facts)(EVENTS['resolve:late_evidence'] as Extract<AttemptEvent, { kind: 'attempt_resolved' }>);
  const { kind: _startedKind, ...startedFacts } = STARTED_EVENT as Extract<AttemptEvent, { kind: 'attempt_started' }>;
  const cases: Array<[RunEventForAttempt, AttemptEvent | null, boolean]> = [
    [{ kind: 'claim_committed', claim, basis: { kind: 'first' } }, EVENTS['claim:first'], true],
    [{ kind: 'entered_observed', ...startedFacts }, STARTED_EVENT, false],
    ...(['terminal_observed', 'stop_not_entered', 'stop_paused', 'reconcile_terminal', 'reconcile_interrupted_clean',
      'reconcile_unknown'] as const).map((kind): [RunEventForAttempt, AttemptEvent, boolean] =>
      [{ kind, ...endFacts }, { kind: 'attempt_ended', source: kind, ...endFacts }, true]),
    ...(['late_evidence', 'unknown_attested'] as const).map((kind): [RunEventForAttempt, AttemptEvent, boolean] =>
      [{ kind, ...resolveFacts }, { kind: 'attempt_resolved', source: kind, ...resolveFacts }, true]),
    ...(['entry_authorized', 'entry_begun', 'history_recorded'] as const)
      .map((kind): [RunEventForAttempt, AttemptEvent, boolean] => [{ kind }, { kind }, false]),
    [{ kind: 'reconcile_not_entered' }, { kind: 'reconcile_not_entered' }, true],
    // RUN-10/11 (D-7) write none of the three records (§5.2), like a queued control.
    ...(['control_submitted', 'pause_not_entered', 'resume_not_entered'] as const)
      .map((kind): [RunEventForAttempt, null, boolean] => [{ kind }, null, false]),
  ];
  for (const [runEvent, expected, drivesLease] of cases) {
    it(`${runEvent.kind} → ${expected === null ? 'no write' : expected.kind}; lease ${drivesLease ? 'driven' : '不写'}`, () => {
      const mapped = attemptEventFromRunEvent(runEvent);
      expect(mapped).toEqual(expected);
      if (mapped !== null) expect(isTaskLeaseEvent(mapped)).toBe(drivesLease);
    });
  }
});

describe('record constructors and nodes', () => {
  it('build the claim records at revision 1 (ATT-01, 14, 24)', () => {
    check({ ok: true, next: newTaskAttemptRecord(claim, { kind: 'first' }), effects: [] }, to(ATTEMPT_CLAIMED), null);
    check({ ok: true, next: newTaskAttemptRecord(claim, { kind: 'requeue', requeueRef }), effects: [] },
      to(ATTEMPT_CLAIMED_REQUEUE), null);
    check({ ok: true, next: newTaskLeaseRecord(claim), effects: [] }, to(LEASE_HELD), null);
    check({ ok: true, next: newDispatchOutboxRecord(claim), effects: [] }, to(OUTBOX_PENDING), null);
  });
  it('project the nodes of §5.1', () => {
    expect([null, ATTEMPT_CLAIMED, ATTEMPT_STARTED, ATTEMPT_ENDED, ATTEMPT_UNKNOWN, ATTEMPT_UNKNOWN_UNSTARTED]
      .map(attemptNodeOf)).toEqual(['absent', 'claimed', 'started', 'ended_known', 'ended_unknown', 'ended_unknown']);
    // A legacy ended row without endOutcome reads as a known end.
    expect(attemptNodeOf({ ...ATTEMPT_ENDED, endOutcome: null })).toBe('ended_known');
    expect([null, LEASE_HELD, LEASE_RELEASED].map(taskLeaseNodeOf)).toEqual(['absent', 'held', 'released']);
    expect([null, OUTBOX_PENDING, OUTBOX_ENTERED, OUTBOX_SETTLED].map(dispatchOutboxNodeOf))
      .toEqual(['absent', 'pending', 'entered', 'settled']);
  });
  it('DispatchOutboxRecord is the TaskClaimOutbox record of claim-contracts.ts', () => {
    const fromService = (outbox: TaskClaimOutbox): DispatchOutboxRecord => outbox;
    const toService = (outbox: DispatchOutboxRecord): TaskClaimOutbox => outbox;
    const stateFromService = (state: TaskDispatchStateV1): DispatchStateV1 => state;
    const stateToService = (state: DispatchStateV1): TaskDispatchStateV1 => state;
    expect(toService(fromService(OUTBOX_SETTLED))).toBe(OUTBOX_SETTLED);
    const dispatchState = OUTBOX_SETTLED.dispatchState as DispatchStateV1;
    expect(stateToService(stateFromService(dispatchState))).toBe(dispatchState);
  });
});

describe('D-14 pairing along claim → enter → end', () => {
  it('keeps Attempt, Outbox and Lease paired after every commit (§5.1 rows 1-3)', () => {
    const claimed = EVENTS['claim:first'];
    const attempt1 = transitionAttempt(null, claimed, ctxOf('Absent', 0, false));
    const outbox1 = transitionDispatchOutbox(null, claimed, ctxOf('Absent', 0, false));
    const lease1 = transitionTaskLease(null, claimed);
    if (!attempt1.ok || !outbox1.ok || !lease1.ok) throw new Error('claim must be legal');
    expect([attemptNodeOf(attempt1.next), dispatchOutboxNodeOf(outbox1.next), taskLeaseNodeOf(lease1.next)])
      .toEqual(['claimed', 'pending', 'held']);

    const entering = ctxOf('Entering', 0, leaseHeldByClaim(lease1.next, claim));
    const attempt2 = transitionAttempt(attempt1.next, STARTED_EVENT, entering);
    const outbox2 = transitionDispatchOutbox(outbox1.next, STARTED_EVENT, entering);
    if (!attempt2.ok || !outbox2.ok) throw new Error('entry must be legal');
    expect(attempt2.effects).toEqual([{ kind: 'enter_outbox' }]);
    expect([attemptNodeOf(attempt2.next), dispatchOutboxNodeOf(outbox2.next), taskLeaseNodeOf(lease1.next)])
      .toEqual(['started', 'entered', 'held']);

    const terminal = EVENTS['end:terminal_observed:known'];
    const running = ctxOf('Running', 1, leaseHeldByClaim(lease1.next, claim));
    const attempt3 = transitionAttempt(attempt2.next, terminal, running);
    if (!attempt3.ok) throw new Error('the terminal must be legal');
    let outbox3: DispatchOutboxRecord = outbox2.next;
    let lease3: TaskLeaseSnapshot | null = lease1.next;
    for (const effect of attempt3.effects) {
      if (effect.kind === 'settle_outbox') {
        const settled = transitionDispatchOutbox(outbox3, terminal, running);
        if (!settled.ok) throw new Error('settle must be legal');
        outbox3 = settled.next;
      } else if (effect.kind === 'release_lease') {
        const released = transitionTaskLease(lease3, terminal);
        if (!released.ok) throw new Error('release must be legal');
        lease3 = released.next;
      }
    }
    expect([attemptNodeOf(attempt3.next), dispatchOutboxNodeOf(outbox3), taskLeaseNodeOf(lease3)])
      .toEqual(['ended_known', 'settled', 'released']);
    expect([attempt3.next.revision, outbox3.revision, lease3?.revision]).toEqual([3, 3, 2]);
  });
});
