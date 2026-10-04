/**
 * TaskAttempt, TaskLease and DispatchOutboxEntry machines
 * (docs/refactor/STATE-MACHINES-SPEC.md §5).
 *
 * The three records belong to one claim and change only inside the commit of
 * a Run event (§6): the owner service maps the Run event with
 * `attemptEventFromRunEvent`, calls `transitionAttempt`,
 * `transitionTaskLease` and `transitionDispatchOutbox`, and writes each
 * `next` in that same RecordStore commit. The machines never read storage,
 * mint ids or read a clock: instants and event ids come in the event payload,
 * the paired Run/Session/Lease facts through `AttemptGuardContext`.
 *
 * A.2 step 2 (§15.2) scope:
 * - 已有 rows keep today's records byte for byte (key order of the literals in
 *   `claim-service.ts:682-707` and `execution-entry-service.ts:1260-1267`,
 *   `:1417-1450`).
 * - ATT-07 and ATT-16 (改造) keep TODAY's result: `recordRunResult` accepts
 *   only a known terminal, and a claim's `requeueRef` is not read
 *   (`claimBasisToday`), so a requeue claim is a first claim: `busy` on a
 *   released lease, a lease @1 when there is none, and the Attempt records no
 *   `requeueRef`. Step 5 flips them.
 * - The 新增 rows (ATT-04, 05, 08..12, 20..23, 28..37 and the D-7 events of
 *   ATT-03/25) keep their events in the union but return `illegal`
 *   (`notYet`), so step 5 only adds rows.
 *
 * `TaskClaimOutbox` and its V1 dispatch state are declared in
 * `tasks/claim-contracts.ts`, which `state/` may not import (§14.4); the
 * structurally identical `DispatchOutboxRecord` below is the same record.
 */
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import type {
  ConsumedWaitV1, DispatchOutboxRef, RunOutcome, TaskAttemptSnapshot, TaskDispatchStateV2, TaskLeaseRef,
  TaskLeaseSnapshot,
} from '../../../contracts/dispatch.js';
import type { TaskRequeueRef } from '../../../contracts/task-requeue.js';
import { accept, notYet, reject, unreachable, type Rejected, type Transition } from './transition.js';

// -------------------------------------------------------------------------- //
// Records and nodes (§5.1)                                                    //
// -------------------------------------------------------------------------- //

/** V1 entered/settled dispatch phase; same shape as `TaskDispatchStateV1` (`claim-contracts.ts`). */
export type DispatchStateV1 = {
  schemaVersion: 1;
  phase: 'entered' | 'settled';
  consumerId: string;
  entryGeneration: number;
  sessionGeneration: number;
  eventId: string;
};

/** The DispatchOutboxEntry record; same shape as `TaskClaimOutbox` (`claim-contracts.ts`). */
export type DispatchOutboxRecord = {
  ref: DispatchOutboxRef;
  revision: number;
  schemaVersion: 1;
  status: 'pending' | 'entered' | 'settled';
  dispatchState?: DispatchStateV1 | TaskDispatchStateV2;
  claim: TaskClaim;
};

/**
 * Attempt machine node. "open" is `claimed` or `started`; `ended_unknown` is
 * the D-4 "待核对" state (`ended` + `outcome_unknown`). A legacy `ended` row
 * without `endOutcome` (the codec allows it, `claim-record-codecs.ts:236-245`)
 * reads as `ended_known`: nothing resolves it further.
 */
export type AttemptNode = 'absent' | 'claimed' | 'started' | 'ended_known' | 'ended_unknown';
/** One lease per Task: held without `release`, released with it; `expiresAt` never releases. */
export type TaskLeaseNode = 'absent' | 'held' | 'released';

export function attemptNodeOf(attempt: TaskAttemptSnapshot | null): AttemptNode {
  if (attempt === null) return 'absent';
  switch (attempt.status) {
    case 'claimed': return 'claimed';
    case 'started': return 'started';
    case 'ended': return attempt.endOutcome === 'outcome_unknown' ? 'ended_unknown' : 'ended_known';
    default: return unreachable(attempt.status, 'TaskAttempt status');
  }
}

export function taskLeaseNodeOf(lease: TaskLeaseSnapshot | null): TaskLeaseNode {
  if (lease === null) return 'absent';
  return lease.release === undefined ? 'held' : 'released';
}

/**
 * The claim's own unreleased hold: §6 `leaseOwnedByRun`, §11 `leaseHeldBy`
 * (`execution-entry-service.ts:1418-1419`). It drives `release_lease`
 * (ATT-06) and separates ATT-18 from the no-effect ATT-19.
 */
export function leaseHeldByClaim(lease: TaskLeaseSnapshot | null, claim: TaskClaim): boolean {
  return lease !== null && lease.holderRunId === claim.runRef.runId
    && lease.attemptId === claim.attemptRef.attemptId && lease.release === undefined;
}

// -------------------------------------------------------------------------- //
// Guard context, events and effects (§5.2)                                    //
// -------------------------------------------------------------------------- //

/**
 * The Run machine node (§6.1 `RunNode`), restated so this file depends only on
 * `src/contracts`; it is the same closed union as `run-machine.ts`.
 */
export type AttemptRunNode = 'Absent' | 'Claimed' | 'Authorized' | 'Entering' | 'Revoked'
  | 'Running' | 'Ended' | 'YieldedWait' | 'EndedUnknown';

/** Facts of the paired Run, Session and Lease read in the same window as the record (D-14 pairing). */
export type AttemptGuardContext = {
  /** Node of the claim's Run before the event; `Absent` only while claiming. */
  runNode: AttemptRunNode;
  /** `RunSnapshot.lastEventSeq`: ordering only, never proof of a new Kernel fact (§6 RD-4). */
  runLastEventSeq: number;
  /** `ownsOccupancy(session, claim.runRef, claim.generation)` (§8). */
  ownsSession: boolean;
  /** `leaseHeldByClaim(lease, claim)`. */
  ownsLease: boolean;
};

/** How the claim reaches the Lease: first claim, W2 continuation, or a claim after a TaskRequeue (D-3). */
export type AttemptClaimBasis =
  | { kind: 'first' }
  | { kind: 'continuation'; consumedWait: ConsumedWaitV1 }
  | { kind: 'requeue'; requeueRef: TaskRequeueRef };

/**
 * The basis the claim machines judge on before A.2 step 5.4 (TASK-03, ATT-16,
 * RUN-01 改造, today's result): the claim service accepts a `requeueRef` but
 * never reads it (`claim-service.ts:639-641`), so a requeue claim is a first
 * claim (`busy` once the Task has a Run, otherwise a lease @1) and no record
 * carries `requeueRef` (`:703`). The Task, Run, Attempt and Lease machines all
 * call this one mapping; step 5.4 removes it.
 */
export function claimBasisToday(basis: AttemptClaimBasis): Exclude<AttemptClaimBasis, { kind: 'requeue' }> {
  return basis.kind === 'requeue' ? { kind: 'first' } : basis;
}

/** `attempt_started` payload (§5.2; `recordExecutionEntered`). */
export type AttemptStartedFacts = {
  enteredAt: string;
  consumerId: string;
  entryGeneration: number;
  sessionGeneration: number;
  eventId: string;
};

/** The Run's V2 entry binding (`consumerId`, `generation`) the outbox settlement names. */
export type AttemptEntryIdentity = { consumerId: string; entryGeneration: number };

/** The Run event that ends the Attempt (§5.2 `attempt_ended`; mapping table in §5.3). */
export type AttemptEndSource = 'terminal_observed' | 'stop_not_entered' | 'stop_paused'
  | 'reconcile_terminal' | 'reconcile_interrupted_clean' | 'reconcile_unknown';

export type AttemptEndFacts = {
  /** The claim of the ending Run; ownership and the release stamp are judged by its generation. */
  claim: TaskClaim;
  endOutcome: RunOutcome;
  endedAt: string;
  /** Event id of the commit (outbox `dispatchState.eventId`, lease `release.eventId`). */
  eventId: string;
  /** Runtime event sequence; `null` for a platform decision without one (D-7 stop, unknown reconcile). */
  sequence: number | null;
  /** The Run's V2 entry binding; `null` when the Run never had one (D-7, AD-2). */
  entry: AttemptEntryIdentity | null;
  /** Kernel Turn start recorded by an end reconciled from `Entering` (ATT-31/32); `null` otherwise (ATT-36). */
  turnStartedAt: string | null;
};

/** The Run event that resolves an unknown Attempt (§5.2 `attempt_resolved`, D-4). */
export type AttemptResolveSource = 'late_evidence' | 'unknown_attested';

export type AttemptResolveFacts = {
  claim: TaskClaim;
  outcome: Exclude<RunOutcome, 'outcome_unknown'>;
  resolvedAt: string;
  eventId: string;
  sequence: number | null;
  /** The entering binding the outbox settles from `pending` (ATT-29, L-2). */
  entry: AttemptEntryIdentity;
  /** Kernel Turn start for `late_evidence` after ATT-36 (L-2); `null` for an attestation. */
  turnStartedAt: string | null;
};

/** Run events that reach this section without writing the Attempt (ATT-03, 04, 25). */
export type AttemptPassThroughKind = 'entry_authorized' | 'entry_begun' | 'history_recorded'
  | 'pause_not_entered' | 'resume_not_entered' | 'reconcile_not_entered';

export type AttemptEvent =
  | { kind: 'attempt_claimed'; claim: TaskClaim; basis: AttemptClaimBasis }
  | ({ kind: 'attempt_started' } & AttemptStartedFacts)
  | ({ kind: 'attempt_ended'; source: AttemptEndSource } & AttemptEndFacts)
  | ({ kind: 'attempt_resolved'; source: AttemptResolveSource } & AttemptResolveFacts)
  | { [K in AttemptPassThroughKind]: { kind: K } }[AttemptPassThroughKind];

/** The events that drive the lease; the mapping table marks every other one "不写". */
export type TaskLeaseEvent = Extract<AttemptEvent,
  { kind: 'attempt_claimed' | 'attempt_ended' | 'attempt_resolved' | 'reconcile_not_entered' }>;

export function isTaskLeaseEvent(event: AttemptEvent): event is TaskLeaseEvent {
  return event.kind === 'attempt_claimed' || event.kind === 'attempt_ended'
    || event.kind === 'attempt_resolved' || event.kind === 'reconcile_not_entered';
}

/**
 * Same-commit intents of an Attempt row (§5.3 effects column). The service
 * applies `enter_outbox`/`settle_outbox` through `transitionDispatchOutbox`
 * and `release_lease` through `transitionTaskLease` with the same event, and
 * `release_session` through `state/session-availability.ts` (§8).
 */
export type AttemptEffect =
  | { kind: 'enter_outbox' }
  | { kind: 'settle_outbox'; settlement: 'entered' | 'not_entered' }
  | { kind: 'release_lease' }
  | { kind: 'release_session'; sessionRef: SessionRef; generation: number };

/** The Run events of §1.6 as section 5 needs them; `control_submitted` writes none of its records. */
export type RunEventForAttempt =
  | { kind: 'claim_committed'; claim: TaskClaim; basis: AttemptClaimBasis }
  | ({ kind: 'entered_observed' } & AttemptStartedFacts)
  | { [K in AttemptEndSource]: { kind: K } & AttemptEndFacts }[AttemptEndSource]
  | { [K in AttemptResolveSource]: { kind: K } & AttemptResolveFacts }[AttemptResolveSource]
  | { [K in AttemptPassThroughKind]: { kind: K } }[AttemptPassThroughKind]
  | { kind: 'control_submitted' };

/** §5.3 "Run 事件到本节事件的映射"; `null` means none of the three records is written. */
export function attemptEventFromRunEvent(event: RunEventForAttempt): AttemptEvent | null {
  switch (event.kind) {
    case 'claim_committed': return { kind: 'attempt_claimed', claim: event.claim, basis: event.basis };
    case 'entered_observed': {
      const { kind: _kind, ...facts } = event;
      return { kind: 'attempt_started', ...facts };
    }
    case 'terminal_observed':
    case 'stop_not_entered':
    case 'stop_paused':
    case 'reconcile_terminal':
    case 'reconcile_interrupted_clean':
    case 'reconcile_unknown': {
      const { kind, ...facts } = event;
      return { kind: 'attempt_ended', source: kind, ...facts };
    }
    case 'late_evidence':
    case 'unknown_attested': {
      const { kind, ...facts } = event;
      return { kind: 'attempt_resolved', source: kind, ...facts };
    }
    case 'entry_authorized':
    case 'entry_begun':
    case 'history_recorded':
    case 'pause_not_entered':
    case 'resume_not_entered':
    case 'reconcile_not_entered':
      return { kind: event.kind };
    case 'control_submitted': return null;
    default: return unreachable(event, 'Run event');
  }
}

// -------------------------------------------------------------------------- //
// Record constructors (§14.1)                                                 //
// -------------------------------------------------------------------------- //

/** ATT-01: `claimed@1` (`claim-service.ts:704-705`); a requeue claim records its `requeueRef` (TASK-03). */
export function newTaskAttemptRecord(claim: TaskClaim, basis: AttemptClaimBasis): TaskAttemptSnapshot {
  return { ref: claim.attemptRef, revision: 1, schemaVersion: 1, runId: claim.runRef.runId,
    planRef: claim.planRef, status: 'claimed', startedAt: null, endedAt: null, endOutcome: null,
    ...(basis.kind === 'requeue' ? { requeueRef: basis.requeueRef } : {}) };
}

/** ATT-14: `held@1`, never expiring (`claim-service.ts:693-695`). */
export function newTaskLeaseRecord(claim: TaskClaim): TaskLeaseSnapshot {
  const ref: TaskLeaseRef = { aggregateType: 'TaskLease', projectId: claim.task.projectId,
    goalId: claim.task.goalId, taskId: claim.task.taskId };
  return { ref, revision: 1, schemaVersion: 1, holderRunId: claim.runRef.runId,
    attemptId: claim.attemptRef.attemptId, grantedAt: claim.claimedAt, expiresAt: null };
}

/** ATT-24: `pending@1` keeping the immutable claim (`claim-service.ts:687`). */
export function newDispatchOutboxRecord(claim: TaskClaim): DispatchOutboxRecord {
  return { ref: claim.outboxRef, revision: 1, schemaVersion: 1, status: 'pending', claim };
}

/** ATT-15: the same lease record re-held by the new claim at @k+1; `release` is dropped (`claim-service.ts:696-697`). */
function reheldLeaseRecord(lease: TaskLeaseSnapshot, claim: TaskClaim): TaskLeaseSnapshot {
  return { ref: lease.ref, revision: lease.revision + 1, schemaVersion: 1, holderRunId: claim.runRef.runId,
    attemptId: claim.attemptRef.attemptId, grantedAt: claim.claimedAt, expiresAt: null };
}

/** ATT-18: release stamp taken from the ending claim (`execution-entry-service.ts:1447-1450`). */
function releasedLeaseRecord(lease: TaskLeaseSnapshot, claim: TaskClaim, releasedAt: string, eventId: string): TaskLeaseSnapshot {
  return { ...lease, revision: lease.revision + 1,
    release: { schemaVersion: 1, runRef: claim.runRef, attemptRef: claim.attemptRef,
      sessionRef: claim.sessionRef, generation: claim.generation, releasedAt, eventId } };
}

/** ATT-02 (`execution-entry-service.ts:1260-1261`). */
function startedAttemptRecord(attempt: TaskAttemptSnapshot, enteredAt: string): TaskAttemptSnapshot {
  return { ...attempt, revision: attempt.revision + 1, status: 'started', startedAt: enteredAt };
}

/** ATT-06 (`execution-entry-service.ts:1427-1428`). */
function endedAttemptRecord(attempt: TaskAttemptSnapshot, endOutcome: RunOutcome, endedAt: string): TaskAttemptSnapshot {
  return { ...attempt, revision: attempt.revision + 1, status: 'ended', endedAt, endOutcome };
}

/** ATT-26 (`execution-entry-service.ts:1265-1267`). */
function enteredOutboxRecord(outbox: DispatchOutboxRecord, facts: AttemptStartedFacts): DispatchOutboxRecord {
  return { ...outbox, revision: outbox.revision + 1, status: 'entered',
    dispatchState: { schemaVersion: 1, phase: 'entered', consumerId: facts.consumerId,
      entryGeneration: facts.entryGeneration, sessionGeneration: facts.sessionGeneration, eventId: facts.eventId } };
}

/** ATT-27 (`execution-entry-service.ts:1429-1431`): the Run's entry binding and the claim generation. */
function settledOutboxRecord(outbox: DispatchOutboxRecord, entry: AttemptEntryIdentity, eventId: string): DispatchOutboxRecord {
  return { ...outbox, revision: outbox.revision + 1, status: 'settled',
    dispatchState: { schemaVersion: 1, phase: 'settled', consumerId: entry.consumerId,
      entryGeneration: entry.entryGeneration, sessionGeneration: outbox.claim.generation, eventId } };
}

// -------------------------------------------------------------------------- //
// Shared guard rows                                                           //
// -------------------------------------------------------------------------- //

type ExistingAttemptNode = Exclude<AttemptNode, 'absent'>;
type EndedEvent = Extract<AttemptEvent, { kind: 'attempt_ended' }>;

/** `failed` has no writer (Kernel `failed` maps to `crashed`, §6.4); `outcome_unknown` is D-4. */
function endOutcomeKind(outcome: RunOutcome): 'known' | 'unknown' | 'no_writer' {
  switch (outcome) {
    case 'completed':
    case 'cancelled':
    case 'budget_exhausted':
    case 'crashed':
    case 'yielded':
      return 'known';
    case 'outcome_unknown': return 'unknown';
    case 'failed': return 'no_writer';
    default: return unreachable(outcome, 'RunOutcome');
  }
}

/**
 * ATT-02 / ATT-26 guard, in `recordExecutionEntered` order: V2 phase
 * `entering` (`execution-entry-service.ts:1222-1223`), then the claim's
 * Session occupancy and Lease (`:1231-1235`).
 */
function enteringGuard(ctx: AttemptGuardContext): Rejected | null {
  switch (ctx.runNode) {
    case 'Entering': break;
    case 'Absent': return reject('guard_failed', 'invalid', 'the Attempt has no paired Run');
    case 'Claimed': return reject('guard_failed', 'forbidden', 'the Run has no formal V2 entry authorization');
    case 'Authorized':
    case 'Revoked':
    case 'Running':
    case 'Ended':
    case 'YieldedWait':
    case 'EndedUnknown':
      return reject('guard_failed', 'busy', 'the Run entry is not in the entering phase');
    default: return unreachable(ctx.runNode, 'Run node');
  }
  if (!ctx.ownsSession) return reject('guard_failed', 'busy', 'the claim Session is no longer occupied by this Run generation');
  if (!ctx.ownsLease) return reject('guard_failed', 'busy', 'the claim TaskLease is not held by this attempt');
  return null;
}

/** §1.2 `stale`: the event sequence does not advance the applied Run fact (RD-4). */
function sequenceNotNewer(ctx: AttemptGuardContext, sequence: number | null): boolean {
  return sequence !== null && sequence <= ctx.runLastEventSeq;
}

/**
 * §5.4: a terminal re-observed on an `outcome_unknown` end is not new
 * evidence; only `attempt_resolved` (ATT-11/12) leaves it.
 */
function unknownReobservation(ctx: AttemptGuardContext, sequence: number | null): Rejected {
  if (sequenceNotNewer(ctx, sequence)) {
    return reject('stale', 'revision_conflict', 'the result event sequence is not newer than the applied Run fact');
  }
  return reject('guard_failed', 'incomplete', 'the Run outcome is unknown; only new Kernel evidence or an attestation resolves it');
}

/**
 * §5.4 Outbox row: an `entered` outbox (AD-1) or the `pending` one after
 * ATT-37 is never settled under `outcome_unknown` (`illegal`); only ATT-29
 * leaves it. The row names no CoreError of its own, so the code is the
 * paired Attempt row's (`unknownReobservation`): one Run event, one code.
 */
function unknownOutboxHold(ctx: AttemptGuardContext, sequence: number | null): Rejected {
  return reject('illegal', sequenceNotNewer(ctx, sequence) ? 'revision_conflict' : 'incomplete',
    'the Run outcome is unknown; the outbox entry leaves it only when the Attempt is resolved');
}

/**
 * ATT-06 / ATT-27 guard, in `recordRunResult` order: entry projection,
 * V2 phase `entered` and not finished (`execution-entry-service.ts:1362-1364`),
 * then `terminalFact` (sequence `:1659`, then the terminal type). An unknown
 * outcome is today's result for ATT-07/28: `recordRunResult` has no unknown
 * branch (`:1653-1690`) and the observer writes nothing
 * (`execution-observation.ts:583-595`).
 */
function knownTerminalGuard(event: EndedEvent, ctx: AttemptGuardContext): Rejected | null {
  if (event.entry === null) return reject('illegal', 'invalid', 'the result entry projection is incomplete');
  switch (ctx.runNode) {
    case 'Running': break;
    case 'Absent': return reject('guard_failed', 'invalid', 'the Attempt has no paired Run');
    case 'Claimed': return reject('guard_failed', 'forbidden', 'the Run has no formal V2 entry authorization');
    case 'Authorized':
    case 'Entering':
    case 'Revoked':
      return reject('guard_failed', 'busy', 'the Run entry is not in the entered phase');
    case 'Ended':
    case 'YieldedWait':
      return reject('duplicate', 'busy', 'the Run already has a terminal result');
    case 'EndedUnknown': return unknownReobservation(ctx, event.sequence);
    default: return unreachable(ctx.runNode, 'Run node');
  }
  if (sequenceNotNewer(ctx, event.sequence)) {
    return reject('stale', 'revision_conflict', 'the result event sequence is not newer than the applied Run fact');
  }
  const outcomeKind = endOutcomeKind(event.endOutcome);
  switch (outcomeKind) {
    case 'known': return null;
    case 'unknown': return reject('illegal', 'invalid', 'a terminal result requires a known terminal Runtime event (ATT-07 is step 5)');
    case 'no_writer': return reject('illegal', 'invalid', 'the outcome failed has no writer');
    default: return unreachable(outcomeKind, 'outcome kind');
  }
}

// -------------------------------------------------------------------------- //
// TaskAttempt (§5.3 ATT-01..13, 31, 32, 35, 36)                               //
// -------------------------------------------------------------------------- //

export function transitionAttempt(
  state: TaskAttemptSnapshot | null,
  event: AttemptEvent,
  ctx: AttemptGuardContext,
): Transition<TaskAttemptSnapshot, AttemptEvent, AttemptEffect> {
  if (state === null) {
    // ATT-01: the Attempt key is ∅ (CAS null); eligibility is the Task machine's (TASK-01..03).
    if (event.kind === 'attempt_claimed') return accept(newTaskAttemptRecord(event.claim, claimBasisToday(event.basis)));
    return reject('illegal', 'invalid', `${event.kind} needs an existing TaskAttempt`);
  }
  const node = attemptNodeOf(state) as ExistingAttemptNode;
  switch (event.kind) {
    case 'attempt_claimed':
      return reject('illegal', 'invalid', 'a TaskAttempt is created once; a new claim creates a new Attempt');
    case 'attempt_started':
      return attemptOnStarted(state, node, event, ctx);
    case 'attempt_ended':
      return attemptOnEnded(state, node, event, ctx);
    case 'attempt_resolved':
      switch (node) {
        case 'claimed':
        case 'started':
          return reject('illegal', 'invalid', 'only an Attempt that ended with outcome_unknown can be resolved');
        case 'ended_known': return reject('illegal', 'busy', 'a known terminal is never rewritten');
        case 'ended_unknown': return notYet(event.source === 'late_evidence' ? 'ATT-11' : 'ATT-12');
        default: return unreachable(node, 'Attempt node');
      }
    case 'entry_authorized':
    case 'entry_begun':
      // ATT-03: W3/W4 write only the Run (`execution-entry-service.ts:1017`, `:1147`).
      return node === 'claimed' ? accept(state) : reject('illegal', 'busy', 'the Run is no longer starting');
    case 'history_recorded':
      // ATT-03: W9 writes only the Run, at any node (`execution-history-binding.ts:146`).
      return accept(state);
    case 'pause_not_entered':
    case 'resume_not_entered':
      return notYet('ATT-03 (D-7)');
    case 'reconcile_not_entered':
      return notYet('ATT-04');
    default: return unreachable(event, 'Attempt event');
  }
}

function attemptOnStarted(
  state: TaskAttemptSnapshot,
  node: ExistingAttemptNode,
  event: Extract<AttemptEvent, { kind: 'attempt_started' }>,
  ctx: AttemptGuardContext,
): Transition<TaskAttemptSnapshot, AttemptEvent, AttemptEffect> {
  switch (node) {
    case 'claimed': {
      // ATT-02, with the explicit Attempt-status guard of the row.
      const problem = enteringGuard(ctx);
      if (problem !== null) return problem;
      return accept(startedAttemptRecord(state, event.enteredAt), [{ kind: 'enter_outbox' }]);
    }
    case 'started':
      // No §5.4 row: a second entry of a started Attempt keeps today's `busy`
      // (the V2 phase is already `entered`, `execution-entry-service.ts:1223`).
      return reject('illegal', 'busy', 'the Run entry is not in the entering phase');
    case 'ended_known':
    case 'ended_unknown':
      // §5.4 "Attempt ended → 回到 started": rework needs a new Attempt.
      return reject('illegal', 'invalid', 'an Attempt is started once; its status only moves forward');
    default: return unreachable(node, 'Attempt node');
  }
}

function attemptOnEnded(
  state: TaskAttemptSnapshot,
  node: ExistingAttemptNode,
  event: EndedEvent,
  ctx: AttemptGuardContext,
): Transition<TaskAttemptSnapshot, AttemptEvent, AttemptEffect> {
  switch (node) {
    case 'claimed':
      switch (event.source) {
        case 'terminal_observed':
          return reject('illegal', 'busy', 'a terminal result needs an entered Run; an end from Entering is reconciled');
        case 'stop_not_entered': return notYet('ATT-05');
        case 'stop_paused':
        case 'reconcile_terminal':
        case 'reconcile_interrupted_clean':
          return notYet('ATT-31');
        case 'reconcile_unknown': return notYet('ATT-32/36');
        default: return unreachable(event.source, 'end source');
      }
    case 'started':
      switch (event.source) {
        case 'terminal_observed': {
          // ATT-06; settlement, lease and Session release follow ownership (`:1417-1419`).
          const problem = knownTerminalGuard(event, ctx);
          if (problem !== null) return problem;
          const effects: AttemptEffect[] = [{ kind: 'settle_outbox', settlement: 'entered' }];
          if (ctx.ownsLease) effects.push({ kind: 'release_lease' });
          if (ctx.ownsSession) {
            effects.push({ kind: 'release_session', sessionRef: event.claim.sessionRef, generation: event.claim.generation });
          }
          return accept(endedAttemptRecord(state, event.endOutcome, event.endedAt), effects);
        }
        case 'stop_not_entered':
          return reject('illegal', 'invalid', 'an entered Attempt stops only through the Kernel, a paused stop or reconciliation');
        case 'stop_paused': return notYet('ATT-35');
        case 'reconcile_terminal': return notYet('ATT-08');
        case 'reconcile_interrupted_clean': return notYet('ATT-09');
        case 'reconcile_unknown': return notYet('ATT-10');
        default: return unreachable(event.source, 'end source');
      }
    case 'ended_known':
      // ATT-13: the same identity replays its receipt in the service; a new one is `busy` (`:1364`).
      return reject('duplicate', 'busy', 'the Run already has a terminal result');
    case 'ended_unknown':
      if (event.source === 'stop_not_entered') {
        return reject('illegal', 'invalid', 'an entered Attempt stops only through the Kernel, a paused stop or reconciliation');
      }
      return unknownReobservation(ctx, event.sequence);
    default: return unreachable(node, 'Attempt node');
  }
}

// -------------------------------------------------------------------------- //
// TaskLease (§5.3 ATT-14..23)                                                 //
// -------------------------------------------------------------------------- //

/**
 * The lease needs no guard context: ownership is the lease itself against the
 * event's claim. `next` is `null` only for ATT-19 on a missing lease, which
 * `recordRunResult` tolerates without a lease write (`:1440-1444`).
 */
export function transitionTaskLease(
  state: TaskLeaseSnapshot | null,
  event: TaskLeaseEvent,
): Transition<TaskLeaseSnapshot | null, TaskLeaseEvent, never> {
  switch (event.kind) {
    case 'attempt_claimed': return leaseOnClaimed(state, event);
    case 'attempt_ended': return leaseOnEnded(state, event);
    case 'attempt_resolved': return notYet('ATT-22');
    case 'reconcile_not_entered': return notYet('ATT-21');
    default: return unreachable(event, 'TaskLease event');
  }
}

function leaseOnClaimed(
  state: TaskLeaseSnapshot | null,
  event: Extract<TaskLeaseEvent, { kind: 'attempt_claimed' }>,
): Transition<TaskLeaseSnapshot | null, TaskLeaseEvent, never> {
  const basis = claimBasisToday(event.basis);
  if (state === null) {
    if (basis.kind === 'first') return accept(newTaskLeaseRecord(event.claim));  // ATT-14
    // A continuation reuses the lease its prior Run released (`claim-service.ts:612-618`).
    return reject('guard_failed', 'busy', 'the prior Run lease is not released by that Run');
  }
  if (state.release === undefined) {
    // ATT-17: resource_unavailable/leased (`eligibility.ts:73-76`).
    return reject('guard_failed', 'busy', 'the Task lease is held');
  }
  switch (basis.kind) {
    case 'first':
      // Also ATT-16 (改造) until step 5.4: a requeue claim is a first claim here (`claimBasisToday`).
      return reject('guard_failed', 'busy', 'this Task already has a Run and cannot be claimed for the first time');
    case 'continuation':
      // ATT-15: the released holder is the yielded Run whose wait this claim consumes.
      if (state.holderRunId !== basis.consumedWait.runRef.runId) {
        return reject('guard_failed', 'busy', 'the continuation prior Run lease is not released by that Run');
      }
      return accept(reheldLeaseRecord(state, event.claim));
    default: return unreachable(basis, 'claim basis');
  }
}

function leaseOnEnded(
  state: TaskLeaseSnapshot | null,
  event: Extract<TaskLeaseEvent, { kind: 'attempt_ended' }>,
): Transition<TaskLeaseSnapshot | null, TaskLeaseEvent, never> {
  switch (event.source) {
    case 'terminal_observed': break;
    case 'stop_not_entered': return notYet('ATT-23');
    case 'stop_paused':
    case 'reconcile_terminal':
    case 'reconcile_interrupted_clean':
      return notYet('ATT-18 (reconcile)');
    case 'reconcile_unknown': return notYet('ATT-20');
    default: return unreachable(event.source, 'end source');
  }
  const outcomeKind = endOutcomeKind(event.endOutcome);
  switch (outcomeKind) {
    case 'known': break;
    case 'unknown': return notYet('ATT-20');
    case 'no_writer': return reject('illegal', 'invalid', 'the outcome failed has no writer');
    default: return unreachable(outcomeKind, 'outcome kind');
  }
  // ATT-19: another holder, an earlier release or no lease is a no-effect transition.
  if (!leaseHeldByClaim(state, event.claim)) return accept(state);
  return accept(releasedLeaseRecord(state as TaskLeaseSnapshot, event.claim, event.endedAt, event.eventId));  // ATT-18
}

// -------------------------------------------------------------------------- //
// DispatchOutboxEntry (§5.3 ATT-24..30, 33, 34, 37)                           //
// -------------------------------------------------------------------------- //

export function transitionDispatchOutbox(
  state: DispatchOutboxRecord | null,
  event: AttemptEvent,
  ctx: AttemptGuardContext,
): Transition<DispatchOutboxRecord, AttemptEvent, never> {
  if (state === null) {
    if (event.kind === 'attempt_claimed') return accept(newDispatchOutboxRecord(event.claim));  // ATT-24
    return reject('illegal', 'invalid', `${event.kind} needs an existing dispatch outbox entry`);
  }
  const node = state.status;
  switch (event.kind) {
    case 'attempt_claimed':
      return reject('illegal', 'invalid', 'a dispatch outbox entry is created once per Attempt');
    case 'attempt_started':
      switch (node) {
        case 'pending': {
          // §5.4 last row: the ATT-37 pending never becomes entered (L-2); only
          // ATT-29 leaves it. The code is the paired Attempt row's ("ended →
          // started", `invalid`): one Run event, one code.
          if (ctx.runNode === 'EndedUnknown') {
            return reject('illegal', 'invalid',
              'the Run outcome is unknown; the pending outbox entry leaves it only when the Attempt is resolved');
          }
          // ATT-26, same guard as ATT-02.
          const problem = enteringGuard(ctx);
          if (problem !== null) return problem;
          return accept(enteredOutboxRecord(state, event));
        }
        case 'entered':
          // No §5.4 row: a second entry keeps today's `busy` (`execution-entry-service.ts:1223`).
          return reject('illegal', 'busy', 'the Run entry is not in the entering phase');
        case 'settled':
          // §5.4 "Outbox settled → entered".
          return reject('illegal', 'invalid', 'only a pending outbox entry enters; settled is terminal');
        default: return unreachable(node, 'outbox status');
      }
    case 'attempt_ended':
      return outboxOnEnded(state, event, ctx);
    case 'attempt_resolved':
      switch (node) {
        case 'pending':
        case 'entered':
          return notYet('ATT-29');
        case 'settled': return reject('illegal', 'busy', 'a known terminal is never rewritten');
        default: return unreachable(node, 'outbox status');
      }
    case 'entry_authorized':
    case 'entry_begun':
      // ATT-25: W3/W4 write only the Run. The ATT-37 pending belongs to an
      // EndedUnknown Run, which refuses them like the paired Attempt (§6.4 `busy`).
      return node === 'pending' && ctx.runNode !== 'EndedUnknown'
        ? accept(state) : reject('illegal', 'busy', 'the Run is no longer starting');
    case 'history_recorded':
      // ATT-25: W9 writes only the Run, at any node.
      return accept(state);
    case 'pause_not_entered':
    case 'resume_not_entered':
    case 'reconcile_not_entered':
      return notYet('ATT-25 (D-5, D-7)');
    default: return unreachable(event, 'Attempt event');
  }
}

function outboxOnEnded(
  state: DispatchOutboxRecord,
  event: EndedEvent,
  ctx: AttemptGuardContext,
): Transition<DispatchOutboxRecord, AttemptEvent, never> {
  switch (state.status) {
    case 'pending':
      // After ATT-37 the outbox stays pending while the Run is EndedUnknown (L-2).
      if (ctx.runNode === 'EndedUnknown' && event.source !== 'stop_not_entered') {
        return unknownOutboxHold(ctx, event.sequence);
      }
      switch (event.source) {
        case 'terminal_observed':
          return reject('illegal', 'busy', 'a terminal result needs an entered Run; an end from Entering is reconciled');
        case 'stop_not_entered': return notYet('ATT-30');
        case 'stop_paused':
        case 'reconcile_terminal':
        case 'reconcile_interrupted_clean':
          return notYet('ATT-33');
        case 'reconcile_unknown': return notYet('ATT-34/37');
        default: return unreachable(event.source, 'end source');
      }
    case 'entered':
      // AD-1: the outbox stays entered while the Run is EndedUnknown.
      if (ctx.runNode === 'EndedUnknown' && event.source !== 'stop_not_entered') {
        return unknownOutboxHold(ctx, event.sequence);
      }
      switch (event.source) {
        case 'terminal_observed': {
          // ATT-27, same guard as ATT-06.
          const problem = knownTerminalGuard(event, ctx);
          if (problem !== null) return problem;
          return accept(settledOutboxRecord(state, event.entry as AttemptEntryIdentity, event.eventId));
        }
        case 'stop_not_entered':
          return reject('illegal', 'invalid', 'an entered Attempt stops only through the Kernel, a paused stop or reconciliation');
        case 'stop_paused':
        case 'reconcile_terminal':
        case 'reconcile_interrupted_clean':
          return notYet('ATT-27 (reconcile)');
        case 'reconcile_unknown': return notYet('ATT-28');
        default: return unreachable(event.source, 'end source');
      }
    case 'settled':
      // Mirrors ATT-13: settled is terminal.
      return reject('duplicate', 'busy', 'the Run already has a terminal result');
    default: return unreachable(state.status, 'outbox status');
  }
}
