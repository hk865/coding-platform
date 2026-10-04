/**
 * Run machine (docs/refactor/STATE-MACHINES-SPEC.md §6): `status/outcome`, the
 * V2 entry sub-state `executionAuthorization.phase` and the control pointer
 * `controlState`/`controlInputs` of ONE `RunSnapshot`, in one pure function.
 *
 * The owner service reads the Run and the records of its claim, builds
 * `runStateOf(run)` and the `RunGuardContext`, calls `transitionRun`, and
 * writes `next.record` plus the translated `effects` in ONE RecordStore
 * commit. Every Run lifecycle field (§14.1) is written here: `next.record` is
 * the whole next Run, so a service never spreads a Run to change one. The
 * effects name only the OTHER records of the commit (Attempt, Outbox, Lease
 * through `attempt-machine.ts`, Session through `session-availability.ts`,
 * ControlIntent through `control-intent-machine.ts`, the Kernel unique slot).
 * The machine never reads storage, mints ids or reads a clock: instants, ids
 * and pins come in the event payload, read facts in the guard context.
 *
 * A.2 step 2 (§15.2) scope:
 * - 已有 rows keep today's records byte for byte (literal key order of
 *   `claim-service.ts:698-703`, `execution-entry-service.ts:986-992`, `:1121-1122`,
 *   `:1256-1258`, `:1420-1425`, `control-service.ts:412-413`,
 *   `execution-history-binding.ts:146`) and today's CoreError codes.
 * - 改造 rows keep TODAY's externally visible result; step 5 flips them
 *   (D-3 requeue claim, C6 `entryPlan`, C3 `continuationBrief`, RUN-03, RUN-07
 *   `terminalPayload`, RUN-08, RUN-09..11 (U), D-8/D-9/RD-8 of RUN-12..15).
 * - 新增 rows (RUN-16..24 and the R source of RUN-09..11) keep their events in
 *   the union; the §6.4 refusals in front of them already answer, and the row
 *   itself answers `illegal` (`notYet`) so step 5 only adds rows.
 *
 * A.2 step 3 routes `execution-entry-service.ts` (RUN-02/04/05/07) through
 * this file. Those rows read the Run, the claim Session and the caller's
 * observation as that service did: a fresh entry by `status` then the V2
 * phase, entered/terminal by the V2 phase (also for a Run outside the eight
 * states), today's refusal texts, and the caller's Kernel source, boundary and
 * history shapes in its order.
 *
 * Pure: imports only `src/contracts` and this directory (§14.4).
 */
import type { ControlIntentKindV1, ControlIntentRef } from '../../../contracts/control-intent.js';
import type { RunExecutionHistoryV1 } from '../../../contracts/core/execution-history.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import {
  TERMINAL_PAYLOAD_TEXT_MAX_CHARS, TERMINAL_PAYLOAD_TRUNCATION_SUFFIX,
  type EntryPlanVerdict, type ExecutionAuthorizationV1, type ExecutionAuthorizationV2, type RoleBindingRefV1,
  type RunContinuationV1, type RunOutcome, type RunReconciliationBasisV1, type RunRef, type RunSnapshot,
  type RuntimeEventV1, type RuntimeInputBindingV1, type TaskBudgetV1, type TaskLeaseSnapshot,
} from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { TaskEnvelopeV1 } from '../../../contracts/task-envelope.js';
import { claimBasisToday, leaseHeldByClaim, type AttemptClaimBasis } from './attempt-machine.js';
import {
  controlSubmissionProblem, pointerAfterSubmit, type ControlPointerIntent, type RunPointerChange,
} from './control-intent-machine.js';
import {
  INCONCLUSIVE_PROBES, type SessionOccupation, type SessionProbeVerdict, type SessionRelease,
} from './session-availability.js';
import { accept, failed, notYet, reject, rejected, unreachable, type Rejected, type Transition } from './transition.js';

// -------------------------------------------------------------------------- //
// Machine view (§6.1)                                                         //
// -------------------------------------------------------------------------- //

export type RunNode = 'Absent' | 'Claimed' | 'Authorized' | 'Entering' | 'Revoked'
  | 'Running' | 'Ended' | 'YieldedWait' | 'EndedUnknown';

export const RUN_NODES: readonly RunNode[] = Object.freeze([
  'Absent', 'Claimed', 'Authorized', 'Entering', 'Revoked', 'Running', 'Ended', 'YieldedWait', 'EndedUnknown',
]);

/** `Run.controlState.desiredState`, or `none` without a pointer (§6.1). */
export type RunPointer = 'none' | NonNullable<RunSnapshot['controlState']>['desiredState'];

export type RunState = {
  node: RunNode;
  outcome: RunOutcome | null;
  /** V2 entryGeneration; `null` without a V2 authorization. */
  entryGeneration: number | null;
  /**
   * A read-only historical Run that takes no fresh entry and no reconcile: a
   * V1 authorization (`dispatch.ts:112-116`), or a `running` Run that carries
   * no authorization at all (written before B2). An ended Run without one is
   * not legacy: a D-7 stop ends a Run that never had a binding.
   */
  legacyV1: boolean;
  pointer: RunPointer;
  /** Ordering only, never proof of a new Kernel fact (RD-4). */
  lastEventSeq: number;
  /** The window RUN-08/20 recorded (`reconciliation.observation.kind==='unresolved'`). */
  unresolved: { observedThroughPosition: number | null; toolCallIds: readonly string[] } | null;
  /**
   * The stored Run (`null` only while `Absent`). An accepted transition's
   * `next.record` is the whole next record; the owner writes it as is.
   */
  record: RunSnapshot | null;
};

function isAuthorizationV2(auth: ExecutionAuthorizationV1 | ExecutionAuthorizationV2 | undefined): auth is ExecutionAuthorizationV2 {
  return auth !== undefined && 'schemaVersion' in auth && auth.schemaVersion === 2;
}

/**
 * The node of a stored Run, derived as leniently as today's readers decide
 * (`execution-entry-service.ts:1630-1632`, `control-service.ts:387-391`): a
 * finished Run is `Ended`/`YieldedWait`/`EndedUnknown` by outcome, a
 * `running` Run is `Running`, a `starting` Run by its V2 phase. A combination
 * outside the eight machine states is reported by `runCombinationProblem`.
 */
export function runNodeOf(record: RunSnapshot | null): RunNode {
  if (record === null) return 'Absent';
  if (isRunFinished(record)) {
    if (record.outcome === 'outcome_unknown') return 'EndedUnknown';
    if (record.outcome === 'yielded' && record.continuation !== undefined) return 'YieldedWait';
    return 'Ended';
  }
  if (record.status === 'running') return 'Running';
  const auth = record.executionAuthorization;
  if (!isAuthorizationV2(auth)) return 'Claimed';
  const phase = auth.phase;
  switch (phase) {
    case 'authorized': return 'Authorized';
    case 'entering': return 'Entering';
    case 'revoked': return 'Revoked';
    case 'entered': return 'Running';
    case 'unknown': return 'EndedUnknown';
    case 'settled': return 'Ended';
    default: return unreachable(phase, 'V2 entry phase');
  }
}

/** The machine state of a stored Run (`null` → `Absent`). */
export function runStateOf(record: RunSnapshot | null): RunState {
  if (record === null) {
    return { node: 'Absent', outcome: null, entryGeneration: null, legacyV1: false, pointer: 'none',
      lastEventSeq: 0, unresolved: null, record: null };
  }
  const auth = record.executionAuthorization;
  const v2 = isAuthorizationV2(auth);
  const observation = record.reconciliation?.observation;
  return {
    node: runNodeOf(record),
    outcome: record.outcome,
    entryGeneration: v2 ? auth.generation : null,
    legacyV1: auth === undefined ? record.status === 'running' : !v2,
    pointer: record.controlState?.desiredState ?? 'none',
    lastEventSeq: record.lastEventSeq,
    unresolved: observation !== undefined && observation.kind === 'unresolved'
      ? { observedThroughPosition: observation.observedThroughPosition, toolCallIds: [...observation.unresolvedToolCallIds] }
      : null,
    record,
  };
}

/**
 * §6.1 "其他 V2 组合视为损坏": the problem of a Run outside the eight machine
 * states, or `null`. A V1 or pre-B2 Run is legacy history, not damage. Every
 * record `transitionRun` produces passes it (§14.5); today's readers do not
 * cross-check (`record-readers.ts:313-314`), so it is the invariant check's tool.
 */
export function runCombinationProblem(record: RunSnapshot): string | null {
  const auth = record.executionAuthorization;
  if (auth !== undefined && !isAuthorizationV2(auth)) return null;
  const phase = isAuthorizationV2(auth) ? auth.phase : 'none';
  switch (record.status) {
    case 'starting':
      if (record.outcome !== null) return 'a starting Run has no outcome';
      return phase === 'none' || phase === 'authorized' || phase === 'entering' || phase === 'revoked'
        ? null : `a starting Run cannot carry the ${phase} entry phase`;
    case 'running':
      if (record.outcome !== null) return 'a running Run has no outcome';
      return phase === 'entered' || auth === undefined ? null : `a running Run cannot carry the ${phase} entry phase`;
    case 'ended': {
      const outcome = record.outcome;
      if (outcome === null) return 'an ended Run needs an outcome';
      if (outcome === 'failed') return 'the outcome failed has no writer';
      if (auth === undefined) return null;
      if (outcome === 'outcome_unknown') return phase === 'unknown' ? null : 'an outcome_unknown Run carries the unknown entry phase';
      if (outcome === 'yielded' && record.continuation === undefined) return 'a yielded Run carries its continuation';
      if (phase === 'settled') return null;
      // D-7: an un-entered stop ends a Run whose authorization was revoked (or never existed).
      return outcome === 'cancelled' && phase === 'revoked' ? null : `an ended Run cannot carry the ${phase} entry phase`;
    }
    default: return unreachable(record.status, 'Run status');
  }
}

// -------------------------------------------------------------------------- //
// Pure helpers named by §6.6, §15.1                                           //
// -------------------------------------------------------------------------- //

/** `status==='ended' || outcome!==null` (`execution-entry-service.ts:1630-1632` `runFinished`). */
export function isRunFinished(run: Pick<RunSnapshot, 'status' | 'outcome'>): boolean {
  return run.status === 'ended' || run.outcome !== null;
}

/**
 * The ONE fresh-action barrier against the Run's canonical control pointer
 * (moved from `execution-entry-service.ts:153-160` `freshRunControlProblem`).
 * An absent `controlState` is the historical behaviour; a queued pause/cancel
 * is a real fence (`busy`), never a claim that the Run already stopped; a
 * `running` pointer (a formal resume) passes; a standalone `steered` pointer
 * has no writer and stays `unsupported`. Entered/result facts never pass it.
 */
export function runControlFence(run: Pick<RunSnapshot, 'controlState'>): CoreRejection | null {
  const control = run.controlState;
  if (control === undefined || control.desiredState === 'running') return null;
  if (control.desiredState === 'paused' || control.desiredState === 'cancelled') {
    return { status: 'rejected', code: 'busy',
      reason: `the Run is fenced by a queued ${control.desiredState} control intent (${control.intentRef.intentId}); no fresh execution action is admitted` };
  }
  return { status: 'rejected', code: 'unsupported',
    reason: `the Run carries a ${control.desiredState} control pointer (${control.intentRef.intentId}) that this stage does not implement` };
}

/** §6.3 "释放受持有关系约束": the claim's own unreleased Lease (`execution-entry-service.ts:1418-1419`). */
export function leaseOwnedByRun(lease: TaskLeaseSnapshot | null, claim: TaskClaim): boolean {
  return leaseHeldByClaim(lease, claim);
}

/**
 * C4 (RUN-24): the Run ended because a Host restart interrupted it while
 * paused. Not a new node and not a failure: `crashed` with an
 * `interrupted_clean` reconciliation that names the pointer's pause intent.
 * RUN-19 and RUN-23 write `pausedIntentRef: null`, so both are false here.
 */
export function isPausedInterrupted(run: Pick<RunSnapshot, 'outcome' | 'reconciliation'>): boolean {
  const observation = run.reconciliation?.observation;
  return run.outcome === 'crashed' && observation !== undefined && observation.kind === 'interrupted_clean'
    && observation.pausedIntentRef !== null;
}

/**
 * A Run whose real state blocks completion: still active, ended with an
 * unknown outcome, quarantined, unreconciled, or carrying an unreconciled
 * entry authorization. A normal ended Run is neutral. Copied unchanged from
 * `tasks/completion-policy.ts:61-81` `runBlocker` (§15.2 step 3 replaces the
 * original by an import); the extended observations `not_entered`,
 * `interrupted_clean`, `human_attested` and `runtime_terminal` do not block.
 */
export function runUnresolvedBlocker(run: RunSnapshot): string | null {
  if (run.status === 'starting' || run.status === 'running') {
    return `run ${run.ref.runId} is ${run.status} and has not ended`;
  }
  if (run.status === 'ended' && run.outcome === 'outcome_unknown') {
    return `run ${run.ref.runId} ended with an unknown outcome`;
  }
  const reconciliation = run.reconciliation;
  if (reconciliation !== undefined) {
    if (reconciliation.status === 'quarantined') return `run ${run.ref.runId} is quarantined and not reconciled`;
    if (reconciliation.observation.kind === 'unresolved') return `run ${run.ref.runId} carries an unresolved reconciliation`;
  }
  const authorization = run.executionAuthorization;
  if (authorization !== undefined && (authorization.phase === 'unknown' || authorization.phase === 'quarantined')) {
    return `run ${run.ref.runId} carries an unreconciled ${authorization.phase} entry authorization`;
  }
  return null;
}

/** The terminal a Runtime event records (moved from `execution-entry-service.ts:1653-1696` `terminalFact`). */
export type RunTerminalFact = { outcome: RunOutcome; exitCode: number | null };

/**
 * The outcome of a terminal Runtime event, with today's codes: an event of
 * another Run or a malformed one is `invalid`; `sequence <= lastEventSeq` is
 * `revision_conflict` (ordering only, RD-4). Kernel `failed` maps to `crashed`
 * upstream, so `failed` never comes out of here (§6.4).
 */
export function terminalOutcomeOf(event: RuntimeEventV1, runRef: RunRef, lastEventSeq: number): RunTerminalFact | CoreRejection {
  const invalid = (reason: string): CoreRejection => ({ status: 'rejected', code: 'invalid', reason });
  if (!isRecord(event)) return invalid('the result event must be an object');
  if (!sameRef(event.runRef, runRef)) return invalid('the result event names another Run');
  if (!nonEmpty(event.eventId)) return invalid('the result event requires an eventId');
  if (event.schemaVersion !== 1) return invalid('the result event schemaVersion must be 1');
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) {
    return invalid('the result event sequence must be a safe non-negative integer');
  }
  if (event.sequence <= lastEventSeq) {
    return { status: 'rejected', code: 'revision_conflict', reason: 'the result event sequence is not newer than the applied Run fact' };
  }
  const payload: unknown = event.payload;
  if (!isRecord(payload)) return invalid('the result event payload must be an object');
  switch (event.eventType) {
    case 'run_completed':
      if (payload['kind'] !== 'completed' || !Number.isSafeInteger(payload['exitCode'])) {
        return invalid('run_completed requires a completed payload with an exitCode');
      }
      return { outcome: 'completed', exitCode: payload['exitCode'] as number };
    case 'run_crashed':
      if (payload['kind'] !== 'crashed' || typeof payload['error'] !== 'string') return invalid('run_crashed requires a crashed payload');
      return { outcome: 'crashed', exitCode: null };
    case 'run_cancelled':
      if (payload['kind'] !== 'cancelled' || typeof payload['reason'] !== 'string') return invalid('run_cancelled requires a cancelled payload');
      return { outcome: 'cancelled', exitCode: null };
    case 'run_budget_exhausted':
      if (payload['kind'] !== 'budget_exhausted' || typeof payload['exhaustedAt'] !== 'string') {
        return invalid('run_budget_exhausted requires a budget_exhausted payload');
      }
      return { outcome: 'budget_exhausted', exitCode: null };
    case 'run_yielded': {
      // An explicit yield is a REAL terminal fact; never Task satisfaction or failure.
      const yielded = payload['yield'];
      if (payload['kind'] !== 'yielded' || !isRecord(yielded)
        || (yielded['reason'] !== 'reply_required' && yielded['reason'] !== 'external_input_required'
          && yielded['reason'] !== 'operator_requested')) {
        return invalid('run_yielded requires a yielded payload with a recognized reason');
      }
      return { outcome: 'yielded', exitCode: null };
    }
    case 'run_started':
    default:
      return invalid('a terminal result requires a terminal Runtime event');
  }
}

/** A terminal payload kind (every `RuntimeEventV1` payload except `started`). */
export type RunTerminalPayload = Exclude<RuntimeEventV1['payload'], { kind: 'started' }>;

function boundedText(text: string): string {
  return text.length > TERMINAL_PAYLOAD_TEXT_MAX_CHARS
    ? text.slice(0, TERMINAL_PAYLOAD_TEXT_MAX_CHARS) + TERMINAL_PAYLOAD_TRUNCATION_SUFFIX
    : text;
}

/**
 * §6.1 contract (f), C1: the bounded `RunSnapshot.terminalPayload` written
 * once with a known outcome. A crashed `error` and a cancelled `reason` are cut
 * to 2,000 characters plus `…[truncated]`; the other kinds are copied.
 */
export function terminalPayloadOf(payload: RunTerminalPayload): RunTerminalPayload {
  switch (payload.kind) {
    case 'crashed': return { kind: 'crashed', error: boundedText(payload.error) };
    case 'cancelled': return { kind: 'cancelled', reason: boundedText(payload.reason) };
    case 'completed':
    case 'budget_exhausted':
    case 'yielded':
      return structuredClone(payload);
    default: return unreachable(payload, 'terminal payload kind');
  }
}

/** RUN-22 (contract (f)): the attestation reason as the crashed error. */
export function attestedTerminalPayload(reason: string): RunTerminalPayload {
  return terminalPayloadOf({ kind: 'crashed', error: `human_attested: ${reason}` });
}

// -------------------------------------------------------------------------- //
// Events, guard context and effects (§6.2, §6.3)                              //
// -------------------------------------------------------------------------- //

/** The four-field Kernel identity (`execution-entry-contracts.ts:30`, restated: `state/` imports only contracts). */
export type RunKernelBinding = RunExecutionHistoryV1['kernel'];
export type RunKernelSource = RunKernelBinding & { position: number };
/** `ObservedExecutionHistory`: the positions the Runtime observed. */
export type RunObservedHistory = {
  kernel: RunKernelBinding;
  startPosition: number;
  observedThroughPosition: number;
  endPosition: number | null;
};
export type RunHistoryBoundary = { source: RunKernelSource; cursor: string };
/** `TaskEntryPermit` (`execution-entry-contracts.ts:35-41`), restated. */
export type RunEntryPermit = {
  claim: TaskClaim;
  consumerId: string;
  entryGeneration: number;
  authorizationRevision: number;
  inputDigest: string;
};

/** The Kernel Turn facts a reconcile or a paused stop read (§6.2; RUN-19/23/24 and RUN-16/17/20 from `Entering`). */
export type RunTurnFacts = {
  /** The Turn has a Kernel terminal event. */
  terminal: boolean;
  /** `running` or `outcome_unknown` tool calls; Kernel `pending` is not in flight (LA-7). */
  inFlightToolCallIds: readonly string[];
  lastPosition: number | null;
  /** The Turn start and history window, recorded with an end reconciled from `Entering`. */
  entered: { enteredAt: string; kernelSource: RunKernelSource; history: RunObservedHistory } | null;
};

/** The Kernel terminal a reconcile or late evidence books through `recordRunResult` (RD-5). */
export type RunTerminalEvidence = {
  event: RuntimeEventV1;
  kernelSource: RunKernelSource;
  completedHistoryBoundary: RunHistoryBoundary;
  history: RunObservedHistory;
  /** A yielded terminal carries the continuation rebuilt per RD-3. */
  continuation?: RunContinuationV1;
  /** Calls of the Turn still without a determined result (`abandoned` is determined). */
  unresolvedToolCallIds: readonly string[];
  /** The Turn start, recorded with an end from `Entering` or after RUN-20(ii) (L-2). */
  enteredAt: string | null;
};

export type RunEvent =
  /** RUN-01 (U): the claim intent; the TaskClaim carries every id and the claim instant. */
  | { kind: 'claim_committed'; claim: TaskClaim; basis: AttemptClaimBasis; roleBinding: RoleBindingRefV1;
      budget: TaskBudgetV1; workspaceRevision: number }
  /** RUN-02/03 (P): the prepared binding; `activePlanRef` only for `carried_unchanged` (C6, step 5.4b). */
  | { kind: 'entry_authorized'; claim: TaskClaim; consumerId: string; envelope: TaskEnvelopeV1;
      inputBinding: RuntimeInputBindingV1; activePlanRef?: PlanRevisionRef }
  /** RUN-04 (P). */
  | { kind: 'entry_begun'; permit: RunEntryPermit; kernel: RunKernelBinding }
  /** RUN-05 (K). */
  | { kind: 'entered_observed'; permit: RunEntryPermit; kernelSource: RunKernelSource; history: RunObservedHistory;
      enteredAt: string }
  /** RUN-06 (K): the claim Session ref the locator names. */
  | { kind: 'history_recorded'; sessionRef: SessionRef; history: RunObservedHistory }
  /** RUN-07/08 (K): `recordRunResult`; `endedAt` and `factEventId` are the commit's instant and event id. */
  | { kind: 'terminal_observed'; claim: TaskClaim; entry: { consumerId: string; entryGeneration: number };
      event: RuntimeEventV1; kernelSource: RunKernelSource | null; completedHistoryBoundary: RunHistoryBoundary | null;
      history: RunObservedHistory | null; continuation?: RunContinuationV1; unresolvedToolCallIds: readonly string[];
      endedAt: string; factEventId: string }
  /** RUN-09..11: U = the submission on a Run that never entered; R = reconcile of a leftover queued intent (CTL-08(a)). */
  | { kind: 'stop_not_entered'; source: 'U' | 'R'; intentRef: ControlIntentRef }
  | { kind: 'pause_not_entered'; source: 'U' | 'R'; intentRef: ControlIntentRef }
  | { kind: 'resume_not_entered'; source: 'U' | 'R'; intentRef: ControlIntentRef }
  /** RUN-12..15 (U): the Run side of §7 CTL-01; `intentRef` is derived from the request identity. */
  | { kind: 'control_submitted'; intentRef: ControlIntentRef; control: ControlIntentKindV1; reason: string | null }
  /** RUN-23 (K/R, 新增). */
  | { kind: 'stop_paused'; claim: TaskClaim; cancelIntentRef: ControlIntentRef; basis: RunReconciliationBasisV1;
      turn: RunTurnFacts; recordedAt: string; factEventId: string }
  /** RUN-16 (R/K, 新增). */
  | { kind: 'reconcile_not_entered'; claim: TaskClaim; basis: RunReconciliationBasisV1; kernel: RunKernelBinding;
      recordedAt: string }
  /** RUN-17/18 (R, 新增). */
  | ({ kind: 'reconcile_terminal'; claim: TaskClaim; basis: RunReconciliationBasisV1; recordedAt: string;
      factEventId: string } & RunTerminalEvidence)
  /** RUN-19/24 (R, 新增): the machine picks the row by the pointer (C4). */
  | { kind: 'reconcile_interrupted_clean'; claim: TaskClaim; basis: RunReconciliationBasisV1; turn: RunTurnFacts;
      recordedAt: string; factEventId: string }
  /** RUN-20 (R, 新增): (i) in-flight tool calls, (ii) unreadable Kernel, (iii) unrebuildable continuation. */
  | { kind: 'reconcile_unknown'; claim: TaskClaim; basis: RunReconciliationBasisV1;
      cause: 'tool_calls_unresolved' | 'kernel_unreadable' | 'continuation_unrebuildable'; reason: string;
      unresolvedToolCallIds: readonly string[]; observedThroughPosition: number | null; turn: RunTurnFacts | null;
      recordedAt: string }
  /** RUN-21 (K/R, 新增). */
  | ({ kind: 'late_evidence'; claim: TaskClaim; basis: RunReconciliationBasisV1; recordedAt: string;
      factEventId: string } & RunTerminalEvidence)
  /** RUN-22 (U, 新增): `kernelTurnOpen` read before the attestation (contract (d), LA-1). */
  | { kind: 'unknown_attested'; claim: TaskClaim; reason: string; kernelTurnOpen: boolean; recordedAt: string };

/** RUN-01 facts beyond the shared context (`claim-service.ts:510-666`); `null` for every other event. */
export type RunClaimContext = {
  /** The target Session already has an occupancy (`claim-service.ts:543`). */
  sessionOccupied: boolean;
  /** Task kind/disposition and the shared eligibility rule, mapped to today's code (`:553-584`); `null` when eligible. */
  eligibility: CoreRejection | null;
  /** First claim: the Task already has a Run (`:639-641`). */
  taskHasRun: boolean;
  /** Continuation claim: the yielded prior Run the claim consumes; `null` when it is not a Run of this Task. */
  prior: null | {
    node: RunNode;
    pointer: RunPointer;
    /** Wait message, Task and Session binding of the prior continuation (`:596-605`); `null` when they match. */
    bindingProblem: CoreRejection | null;
    /** The released Lease names the prior Run as holder (`:614-618`). */
    leaseReleasedByPrior: boolean;
    /** The formal saved reply (`:619-636`); `null` when it is consumable. */
    replyProblem: CoreRejection | null;
  };
  /** Assignment, role and deadline admission (`:643-666`); `null` when admitted. */
  admission: CoreRejection | null;
};

/** §6.1 `RunGuardContext`; `session.kernel`, `persistedClaim` and `claim` are additions (see their notes). */
export type RunGuardContext = {
  /**
   * `usable`: active + available; `owned`: `ownsOccupancy` (§8). `kernel` is
   * the claim Session's Kernel mapping, which a history locator must match
   * (`execution-history-binding.ts:104`); `null` when not read. `archived`
   * says which half of `usable` failed, so RUN-02/04/05 keep today's two
   * refusal texts (`execution-entry-service.ts` `sessionOccupancyProblem`);
   * RUN-01 refuses with its own text and does not pass it.
   */
  session: {
    usable: boolean; owned: boolean; kernel: { adapterId: string; kernelSessionId: string } | null; archived?: boolean;
  };
  /**
   * The claim Lease in `leaseOwnershipProblem` order: missing, released, a
   * Lease naming another Task than the event's claim (`other_task`, an
   * addition: RUN-02 asks it before the persisted claim, so a prepared claim
   * naming another Task keeps today's text), then the holder.
   */
  lease: 'owned' | 'released' | 'other_task' | 'other' | 'missing';
  /**
   * The claim the Run's DispatchOutbox entry persisted (`outbox.claim`), which
   * the claim of RUN-02/04/05/07 must equal at today's point in each order
   * (`execution-entry-service.ts:945`, `:1087`, `:1220`, `:1360`); `null` when
   * not read (every other event).
   */
  persistedClaim: TaskClaim | null;
  /** `activePlanMatchesClaim` only for RUN-01 (the claim pins the active Plan). */
  goal: { desiredState: 'active' | 'paused' | 'cancelled'; activePlanMatchesClaim: boolean };
  /** RUN-02/03 (C6): `entryPlanVerdict(...).kind`, contract (g). */
  entryPlan: EntryPlanVerdict['kind'];
  /** RUN-02/03 (C3): the service's comparison, contract (e). */
  continuationBrief: 'absent_ok' | 'bound' | 'missing' | 'unexpected' | 'mismatch';
  /** Host/Role/material/deadline re-admission of a fresh action; the IO stays in the service. */
  freshAdmission: CoreRejection | null;
  /** The intent `Run.controlState` names; `null` without a pointer (the shape §7 CTL-01 reads). */
  pointerIntent: ControlPointerIntent | null;
  /** Steers in `controlInputs` that are still queued (RUN-09/23 same-commit supersede). */
  queuedSteerCount: number;
  /** `YieldedWait` whose continuation a successor Run already consumed (RD-8). */
  continuationConsumed: boolean;
  exitProof: 'live_clean' | 'host_instance_takeover' | null;
  /** D-18; R events and RUN-22. An unreadable lock file is `held_by_other` (L-10). */
  hostLease: 'owned' | 'held_by_other' | null;
  kernelProbe: SessionProbeVerdict | null;
  kernelPaused: boolean;
  /** Every `run.input_accepted` of the Turn is confirmed; `null` when the Kernel is unreadable. */
  inputsConfirmed: boolean | null;
  /** The rework actor class of the caller (§1.3): `human` = operator. */
  actor: 'human' | 'system';
  /** RUN-01 only. */
  claim: RunClaimContext | null;
};

/** §7 events a Run commit carries for one ControlIntent (`intent:<§7 事件>`). */
export type RunIntentEvent = 'control_submitted' | 'control_applied_not_entered' | 'control_superseded_by_newer'
  | 'control_applied_paused_stop' | 'control_reconciled';

/**
 * Same-commit intents for the OTHER records (§6.3 vocabulary). The Run-side
 * intents of §6.3 — `bind_history`, `set_continuation`, `set_pointer`,
 * `append_input`, `record_reconciliation` and `terminalPayload` — are already
 * applied in `next.record`.
 */
export type RunEffect =
  /** §5 Attempt event of the same Run event (`attemptEventFromRunEvent`). */
  | { kind: 'attempt'; event: 'attempt_claimed' | 'attempt_started' }
  | { kind: 'attempt'; event: 'attempt_ended'; outcome: RunOutcome }
  | { kind: 'attempt'; event: 'attempt_resolved'; outcome: Exclude<RunOutcome, 'outcome_unknown'> }
  /** §5 DispatchOutbox. */
  | { kind: 'outbox'; change: 'pending' | 'entered' | 'settled_entered' | 'settled_not_entered' }
  /** RUN-01: the Lease is held @1, or re-held @k+1 after the prior Run's release (§5 ATT-14/15). */
  | { kind: 'hold_lease' }
  /** Only when `leaseOwnedByRun`. */
  | { kind: 'release_lease' }
  /** §8 `occupancy_acquired` → `occupySessionRecord`. */
  | ({ kind: 'occupy_session' } & SessionOccupation)
  /** §8 `occupancy_released` → `releaseSessionRecord`; only when `ownsOccupancy`. */
  | ({ kind: 'release_session' } & SessionRelease)
  /** The shared Kernel identity unique slot: `none → self` or `self → self`. */
  | { kind: 'claim_kernel_slot'; kernel: RunKernelBinding; expectedOwner: 'none' | 'self' }
  /** `intent:<§7 事件>` for one intent. */
  | { kind: 'intent'; event: RunIntentEvent; intentRef: ControlIntentRef };

export type RunTransition = Transition<RunState, RunEvent, RunEffect>;

// -------------------------------------------------------------------------- //
// Record constructors (§14.1: `RunSnapshot` lifecycle fields)                  //
// -------------------------------------------------------------------------- //

export type NewRunInput = {
  claim: TaskClaim;
  basis: AttemptClaimBasis;
  roleBinding: RoleBindingRefV1;
  budget: TaskBudgetV1;
  workspaceRevision: number;
};

/**
 * RUN-01: `starting@1` in `claim-service.ts:698-703` key order. A continuation
 * claim records its `consumedWait`; a requeue claim its `requeueRef` (TASK-03),
 * exclusive with `consumedWait`.
 */
export function newRunRecord(input: NewRunInput): RunSnapshot {
  const { claim, basis } = input;
  return {
    ref: claim.runRef, revision: 1, schemaVersion: 1, task: claim.task, attemptId: claim.attemptRef.attemptId,
    planRef: claim.planRef, roleBinding: input.roleBinding, budget: input.budget,
    workspaceSnapshot: { workspaceId: claim.workspaceId, revision: input.workspaceRevision },
    status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0,
    lastRuntimeEventId: '', lastFactEventId: '', envelope: null, startedAt: null, endedAt: null,
    ...(basis.kind === 'continuation' ? { consumedWait: structuredClone(basis.consumedWait) } : {}),
    ...(basis.kind === 'requeue' ? { requeueRef: basis.requeueRef } : {}),
  };
}

/** RUN-02 (`execution-entry-service.ts:986-992`): the immutable input and the V2 binding at gen 1, rev 1. */
function authorizedRunRecord(run: RunSnapshot, event: Extract<RunEvent, { kind: 'entry_authorized' }>): RunSnapshot {
  const authorization: ExecutionAuthorizationV2 = {
    schemaVersion: 2, generation: 1, sessionGeneration: event.claim.generation,
    revision: 1, consumerId: event.consumerId, inputDigest: event.inputBinding.inputDigest,
    phase: 'authorized', kernel: null,
  };
  return { ...run, revision: run.revision + 1,
    envelope: event.envelope, inputBinding: event.inputBinding, executionAuthorization: authorization };
}

/** RUN-04 (`execution-entry-service.ts:1121-1122`): the Kernel identity is fixed with `entering`. */
function enteringRunRecord(run: RunSnapshot, auth: ExecutionAuthorizationV2, kernel: RunKernelBinding): RunSnapshot {
  const nextAuthorization: ExecutionAuthorizationV2 = { ...auth, revision: auth.revision + 1, phase: 'entering', kernel };
  return { ...run, revision: run.revision + 1, executionAuthorization: nextAuthorization };
}

/** RUN-06 and the locator part of RUN-05/07 (`execution-history-binding.ts:146`). */
function withHistoryRecord(run: RunSnapshot, history: RunExecutionHistoryV1): RunSnapshot {
  return { ...run, revision: run.revision + 1, executionHistory: history };
}

/** RUN-05 (`execution-entry-service.ts:1256-1258`). */
function enteredRunRecord(run: RunSnapshot, auth: ExecutionAuthorizationV2, history: RunExecutionHistoryV1, enteredAt: string): RunSnapshot {
  const nextAuthorization: ExecutionAuthorizationV2 = { ...auth, revision: auth.revision + 1, phase: 'entered' };
  return { ...withHistoryRecord(run, history), status: 'running', startedAt: enteredAt,
    executionAuthorization: nextAuthorization };
}

/**
 * RUN-07 (`execution-entry-service.ts:1420-1425`). Today's result: no
 * `terminalPayload` (C1 adds it with step 5.4, `terminalPayloadOf`).
 */
function endedRunRecord(
  run: RunSnapshot, auth: ExecutionAuthorizationV2, history: RunExecutionHistoryV1, terminal: RunTerminalFact,
  event: Extract<RunEvent, { kind: 'terminal_observed' }>,
): RunSnapshot {
  const nextAuthorization: ExecutionAuthorizationV2 = { ...auth, revision: auth.revision + 1, phase: 'settled' };
  return { ...withHistoryRecord(run, history), status: 'ended', outcome: terminal.outcome,
    exitCode: terminal.exitCode, endedAt: event.endedAt, executionAuthorization: nextAuthorization,
    lastEventSeq: event.event.sequence, lastRuntimeEventId: event.event.eventId,
    lastFactEventId: event.factEventId,
    ...(event.continuation === undefined ? {} : { continuation: structuredClone(event.continuation) }) };
}

/** RUN-09..15 today (`control-service.ts:412-413`): only the revision and the pointer or steer list move. */
function controlledRunRecord(run: RunSnapshot, change: RunPointerChange): RunSnapshot {
  switch (change.kind) {
    case 'append_input':
      return { ...run, revision: run.revision + 1, controlInputs: [...(run.controlInputs ?? []), change.intentRef] };
    case 'set_pointer':
      return { ...run, revision: run.revision + 1, controlState: change.controlState };
    default: return unreachable(change, 'Run pointer change');
  }
}

// -------------------------------------------------------------------------- //
// Shared guard rows                                                           //
// -------------------------------------------------------------------------- //

/** A fresh re-admission refusal; the passed deadline is not a Run event (T), §6.4 → `illegal`/`capacity`. */
function freshAdmissionRejected(rejection: CoreRejection): Rejected {
  return rejection.code === 'capacity' ? reject('illegal', 'capacity', rejection.reason) : rejected(rejection);
}

/**
 * `leaseOwnershipProblem` (`execution-entry-service.ts:1599-1612`): a missing Lease is never free;
 * then a released Lease, a Lease naming another Task, another holder.
 */
function leaseGuard(lease: RunGuardContext['lease']): Rejected | null {
  switch (lease) {
    case 'owned': return null;
    case 'missing': return reject('guard_failed', 'busy', 'the claim TaskLease is missing; a missing lease is not free');
    case 'released': return reject('guard_failed', 'busy', 'the claim TaskLease was already released');
    case 'other_task': return reject('guard_failed', 'busy', 'the claim TaskLease names another Task');
    case 'other': return reject('guard_failed', 'busy', 'the claim TaskLease is held by another attempt');
    default: return unreachable(lease, 'lease ownership');
  }
}

/** `sessionOccupancyProblem` (`execution-entry-service.ts:1614-1623`): lifecycle, health, then the holder. */
function sessionGuard(ctx: RunGuardContext): Rejected | null {
  if (!ctx.session.usable) {
    return reject('guard_failed', 'busy',
      ctx.session.archived === true ? 'the claim Session is archived' : 'the claim Session is not available');
  }
  if (!ctx.session.owned) return reject('guard_failed', 'busy', 'the claim Session is no longer occupied by this Run generation');
  return null;
}

function fenceGuard(run: RunSnapshot): Rejected | null {
  const fence = runControlFence(run);
  return fence === null ? null : rejected(fence);
}

/** The event's claim against the persisted Outbox claim (`sameRef(outbox.claim, claim)`), with today's reason. */
function persistedClaimGuard(ctx: RunGuardContext, claim: TaskClaim, kind: RunEvent['kind'], detail: string): Rejected | null {
  if (ctx.persistedClaim === null) return reject('illegal', 'invalid', `${kind} requires the persisted DispatchOutbox claim`);
  return sameRef(ctx.persistedClaim, claim) ? null : reject('guard_failed', 'invalid', detail);
}

/**
 * The prepared envelope against the Run the claim wrote (`execution-entry-service.ts:946-950`):
 * role binding, budget and workspace snapshot, each by canonical JSON.
 */
function preparedBindingGuard(run: RunSnapshot, envelope: TaskEnvelopeV1): Rejected | null {
  if (!sameRef(envelope.roleBinding, run.roleBinding)) {
    return reject('guard_failed', 'forbidden', 'the prepared role binding disagrees with the Run');
  }
  if (!sameRef(envelope.budget, run.budget)) return reject('guard_failed', 'forbidden', 'the prepared budget disagrees with the Run');
  if (!sameRef(envelope.workspaceSnapshot, run.workspaceSnapshot)) {
    return reject('guard_failed', 'forbidden', 'the prepared workspace snapshot disagrees with the Run');
  }
  return null;
}

/**
 * The Run's V2 binding, or today's refusal for a Run without one
 * (`execution-entry-service.ts:1089`, `:1222`, `:1362`): one text for a legacy
 * V1 or pre-B2 Run (read-only history) and for a Run that never had a binding.
 */
function v2Binding(state: RunState, run: RunSnapshot): ExecutionAuthorizationV2 | Rejected {
  const auth = run.executionAuthorization;
  if (isAuthorizationV2(auth)) return auth;
  return reject(state.legacyV1 ? 'guard_failed' : 'illegal', 'forbidden', 'the Run has no formal V2 entry authorization');
}

function isRejected<T extends object>(value: T | Rejected): value is Rejected {
  return 'ok' in value && value.ok === false;
}

function sameKernel(left: RunKernelBinding, right: RunKernelBinding): boolean {
  return left.adapterId === right.adapterId && left.kernelSessionId === right.kernelSessionId
    && left.runId === right.runId && left.turnId === right.turnId;
}

function permitMatches(auth: ExecutionAuthorizationV2, permit: RunEntryPermit): Rejected | null {
  if (auth.consumerId !== permit.consumerId || auth.generation !== permit.entryGeneration
    || auth.revision !== permit.authorizationRevision || auth.inputDigest !== permit.inputDigest) {
    return reject('guard_failed', 'forbidden', 'the entry permit does not match the current V2 entry binding');
  }
  if (auth.sessionGeneration !== permit.claim.generation) {
    return reject('guard_failed', 'forbidden', 'the V2 entry binding session generation disagrees with the claim');
  }
  return null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/** `isKernelObservationSource` (`execution-entry-service.ts:170-172`): the four-field identity and a positive position. */
function isKernelSource(value: unknown): value is RunKernelSource {
  return isRecord(value) && nonEmpty(value['adapterId']) && nonEmpty(value['kernelSessionId'])
    && nonEmpty(value['runId']) && nonEmpty(value['turnId']) && isPositiveSafeInteger(value['position']);
}

/** `isRunExecutionHistoryV1` shape (`persistence/execution-history-codecs.ts:100-122`). */
function locatorShapeOk(history: RunExecutionHistoryV1): boolean {
  const { sessionRef, kernel, startPosition: start, observedThroughPosition: through, endPosition: end } = history;
  if (!isRecord(sessionRef) || !nonEmpty(sessionRef.projectId) || !nonEmpty(sessionRef.sessionId)) return false;
  if (!isRecord(kernel) || !nonEmpty(kernel.adapterId) || !nonEmpty(kernel.kernelSessionId)
    || !nonEmpty(kernel.runId) || !nonEmpty(kernel.turnId)) return false;
  if (!isPositiveSafeInteger(start) || !isPositiveSafeInteger(through)) return false;
  if (!(end === null || isPositiveSafeInteger(end))) return false;
  if (start > through) return false;
  return !(end !== null && (end < start || end > through));
}

/**
 * The next execution-history locator (`execution-history-binding.ts:80-140`,
 * moved here because it writes `executionHistory`): a complete locator in the
 * claim Session's Kernel mapping, with a fixed identity and start, a monotone
 * watermark and a write-once end.
 */
function locatorAfter(
  run: RunSnapshot, sessionRef: SessionRef, ctx: RunGuardContext, observed: RunObservedHistory,
): RunExecutionHistoryV1 | Rejected {
  const kernel: RunKernelBinding = { adapterId: observed.kernel.adapterId, kernelSessionId: observed.kernel.kernelSessionId,
    runId: observed.kernel.runId, turnId: observed.kernel.turnId };
  const history: RunExecutionHistoryV1 = {
    schemaVersion: 1,
    sessionRef: { projectId: sessionRef.projectId, sessionId: sessionRef.sessionId },
    kernel,
    startPosition: observed.startPosition,
    observedThroughPosition: observed.observedThroughPosition,
    endPosition: observed.endPosition,
  };
  if (!locatorShapeOk(history)) {
    return failed('invalid', 'the requested execution-history locator is not a complete RunExecutionHistoryV1');
  }
  const mapping = ctx.session.kernel;
  if (mapping === null) return reject('illegal', 'invalid', 'a history locator requires the claim Session Kernel mapping');
  if (kernel.adapterId !== mapping.adapterId || kernel.kernelSessionId !== mapping.kernelSessionId) {
    return failed('forbidden', 'the Kernel session identity disagrees with the claim Session mapping');
  }
  const existing = run.executionHistory;
  if (existing !== undefined) {
    if (!locatorShapeOk(existing)) return failed('unavailable', 'the stored executionHistory is malformed');
    // The stored locator against the claim SessionRef as given, whole (`execution-history-binding.ts:115`).
    if (!sameRef(existing.sessionRef, sessionRef)
      || !sameKernel(existing.kernel, kernel) || existing.startPosition !== history.startPosition) {
      return failed('revision_conflict', 'the execution-history identity/start is already fixed');
    }
    if (history.observedThroughPosition < existing.observedThroughPosition) {
      return failed('revision_conflict', 'observedThroughPosition cannot move backwards');
    }
    if (existing.endPosition !== null && history.endPosition !== existing.endPosition) {
      return failed('revision_conflict', 'endPosition is already fixed and cannot be cleared or changed');
    }
  }
  if (!Number.isSafeInteger(run.revision + 1)) return failed('invalid', 'the Run revision would not be a safe integer');
  return history;
}

/** `runContinuationProblem` (`execution-entry-service.ts:1636-1655`). */
function continuationProblem(continuation: unknown, claim: TaskClaim): string | null {
  if (!isRecord(continuation)) return 'the continuation must be an object';
  if (continuation['schemaVersion'] !== 1 || continuation['kind'] !== 'wait_reply') return 'the continuation kind is not recognized';
  const task = continuation['task'];
  if (!isRecord(task) || task['projectId'] !== claim.task.projectId || task['goalId'] !== claim.task.goalId
    || task['taskId'] !== claim.task.taskId) return 'the continuation Task is not the claimed Task';
  const sessionRef = continuation['sessionRef'];
  if (!isRecord(sessionRef) || sessionRef['projectId'] !== claim.sessionRef.projectId
    || sessionRef['sessionId'] !== claim.sessionRef.sessionId) return 'the continuation Session is not the claimed Session';
  const messageRef = continuation['messageRef'];
  if (!isRecord(messageRef) || messageRef['aggregateType'] !== 'SessionMessage'
    || !nonEmpty(messageRef['projectId']) || !nonEmpty(messageRef['workspaceId']) || !nonEmpty(messageRef['messageId'])) {
    return 'the continuation messageRef is incomplete';
  }
  return null;
}

/** RUN-07 releases: each only when the Run still holds it (§6.3 表外说明). */
function releaseEffects(claim: TaskClaim, ctx: RunGuardContext, cursor: string): RunEffect[] {
  const effects: RunEffect[] = [];
  if (ctx.session.owned) {
    effects.push({ kind: 'release_session', holder: claim.runRef, generation: claim.generation,
      historyCursor: { kind: 'advance', cursor }, kernelTurnOpen: false });
  }
  if (ctx.lease === 'owned') effects.push({ kind: 'release_lease' });
  return effects;
}

// -------------------------------------------------------------------------- //
// Node tables                                                                 //
// -------------------------------------------------------------------------- //

/**
 * How a Run answers a fresh entry action (W3/W4), read as today's service
 * reads it: `status==='starting'` first (`execution-entry-service.ts:939`,
 * `:1086`), then the V2 phase of an existing binding. For the eight machine
 * states this is the node (`Claimed`, `Authorized`, `Entering`, `Revoked`,
 * the rest `not_starting`). A starting Run whose binding is `entered`,
 * `unknown` or `settled` is outside them (`runCombinationProblem`) and is
 * `damaged`: it answers like any other binding that is not `authorized`.
 */
type StartingClass = 'none' | 'authorized' | 'entering' | 'revoked' | 'damaged' | 'not_starting';
function startingClassOf(run: RunSnapshot): StartingClass {
  if (run.status !== 'starting') return 'not_starting';
  const auth = run.executionAuthorization;
  if (!isAuthorizationV2(auth)) return 'none';
  const phase = auth.phase;
  switch (phase) {
    case 'authorized': return 'authorized';
    case 'entering': return 'entering';
    case 'revoked': return 'revoked';
    case 'entered':
    case 'unknown':
    case 'settled':
      return 'damaged';
    default: return unreachable(phase, 'V2 entry phase');
  }
}

/**
 * How a node answers a control (`control-service.ts:387-391`, §6.4 D-7): a Run
 * that never entered (`not_entered`), one the Kernel may hold (`entered`), the
 * yielded wait that still takes a control as continuation fence, and the ended
 * Runs that refuse it.
 */
type ControlClass = 'not_entered' | 'entered' | 'yielded' | 'ended';
function controlClassOf(node: Exclude<RunNode, 'Absent'>): ControlClass {
  switch (node) {
    case 'Claimed':
    case 'Authorized':
    case 'Revoked':
      return 'not_entered';
    case 'Entering':
    case 'Running':
      return 'entered';
    case 'YieldedWait': return 'yielded';
    case 'Ended':
    case 'EndedUnknown':
      return 'ended';
    default: return unreachable(node, 'Run node');
  }
}

/** Reconcile reach (§6.4): only `Entering`/`Running` are classified; the others are skipped or refused. */
type ReconcileClass = 'never_begun' | 'revoked' | 'entered' | 'unknown' | 'known_terminal';
function reconcileClassOf(node: Exclude<RunNode, 'Absent'>): ReconcileClass {
  switch (node) {
    case 'Claimed':
    case 'Authorized':
      return 'never_begun';
    case 'Revoked': return 'revoked';
    case 'Entering':
    case 'Running':
      return 'entered';
    case 'EndedUnknown': return 'unknown';
    case 'Ended':
    case 'YieldedWait':
      return 'known_terminal';
    default: return unreachable(node, 'Run node');
  }
}

// -------------------------------------------------------------------------- //
// transitionRun (§6.3, forbidden §6.4)                                        //
// -------------------------------------------------------------------------- //

export function transitionRun(state: RunState, event: RunEvent, ctx: RunGuardContext): RunTransition {
  const run = state.record;
  if (run === null || state.node === 'Absent') {
    if (event.kind === 'claim_committed') return onClaimCommitted(event, ctx);
    return reject('illegal', 'not_found', 'the target Run does not exist');
  }
  const node = state.node;
  switch (event.kind) {
    case 'claim_committed':
      return reject('illegal', 'invalid', 'a Run is created once, by its own claim');
    case 'entry_authorized': return onEntryAuthorized(state, run, event, ctx);
    case 'entry_begun': return onEntryBegun(state, run, event, ctx);
    case 'entered_observed': return onEnteredObserved(state, run, event, ctx);
    case 'history_recorded': return onHistoryRecorded(run, event, ctx);
    case 'terminal_observed': return onTerminalObserved(state, node, run, event, ctx);
    case 'stop_not_entered':
    case 'pause_not_entered':
    case 'resume_not_entered':
      return onNotEnteredControl(node, run, event, ctx);
    case 'control_submitted': return onControlSubmitted(node, run, event, ctx);
    case 'stop_paused': return onStopPaused(state, node, event, ctx);
    case 'reconcile_not_entered':
    case 'reconcile_terminal':
    case 'reconcile_interrupted_clean':
    case 'reconcile_unknown':
      return onReconcile(state, node, event, ctx);
    case 'late_evidence': return onLateEvidence(state, node, event, ctx);
    case 'unknown_attested': return onUnknownAttested(node, event, ctx);
    default: return unreachable(event, 'Run event');
  }
}

/** RUN-01 in `claim-service.ts:513-666` order (§6.4: Goal not active → busy, Plan pin moved → stale). */
function onClaimCommitted(event: Extract<RunEvent, { kind: 'claim_committed' }>, ctx: RunGuardContext): RunTransition {
  const facts = ctx.claim;
  if (facts === null) return reject('illegal', 'invalid', 'claim_committed requires the claim guard facts');
  if (ctx.goal.desiredState !== 'active') return reject('guard_failed', 'busy', 'the Goal is not active');
  if (!ctx.goal.activePlanMatchesClaim) return reject('stale', 'revision_conflict', 'the requested Plan is not the Goal current pin');
  if (!ctx.session.usable) return reject('guard_failed', 'busy', 'the target Session is archived or not available');
  if (facts.sessionOccupied) return reject('guard_failed', 'busy', 'the target Session is already occupied');
  if (facts.eligibility !== null) return rejected(facts.eligibility);
  // D-3 (TASK-03, ATT-16) is step 5.4: today the claim service does not read
  // `requeueRef`, so a requeue claim is a first claim and the Run records none.
  const basis = claimBasisToday(event.basis);
  switch (basis.kind) {
    case 'first':
      if (facts.taskHasRun) return reject('guard_failed', 'busy', 'this Task already has a Run and cannot be claimed for the first time');
      break;
    case 'continuation': {
      const prior = facts.prior;
      if (prior === null) return reject('guard_failed', 'busy', 'the continuation prior Run is not a Run of this Task');
      if (prior.node !== 'YieldedWait') {
        return reject('guard_failed', 'busy', 'the continuation prior Run did not yield with a formal continuation');
      }
      if (prior.bindingProblem !== null) return rejected(prior.bindingProblem);
      // A queued wait-window pause/cancel survives the yield and holds the continuation.
      if (prior.pointer === 'paused' || prior.pointer === 'cancelled') {
        return reject('guard_failed', 'busy', `the prior yielded Run has a queued ${prior.pointer} control; the continuation is held`);
      }
      if (!prior.leaseReleasedByPrior) return reject('guard_failed', 'busy', 'the continuation prior Run lease is not released by that Run');
      if (prior.replyProblem !== null) return rejected(prior.replyProblem);
      break;
    }
    default: return unreachable(basis, 'claim basis');
  }
  if (facts.admission !== null) return rejected(facts.admission);
  const claim = event.claim;
  return accept(runStateOf(newRunRecord({ ...event, basis })), [
    { kind: 'attempt', event: 'attempt_claimed' },
    { kind: 'outbox', change: 'pending' },
    { kind: 'hold_lease' },
    { kind: 'occupy_session', holder: claim.runRef, generation: claim.generation },
  ]);
}

/**
 * RUN-02 (and RUN-03, today `busy`) in `authorizeRuntimeEntry` order: pointer
 * fence, `starting`, Session, Lease, persisted claim, prepared binding,
 * existing authorization, Goal, Plan pin, fresh re-admission
 * (`execution-entry-service.ts:935-981`).
 */
function onEntryAuthorized(
  state: RunState, run: RunSnapshot, event: Extract<RunEvent, { kind: 'entry_authorized' }>, ctx: RunGuardContext,
): RunTransition {
  const fence = fenceGuard(run);
  if (fence !== null) return fence;
  const starting = startingClassOf(run);
  if (starting === 'not_starting') return reject('illegal', 'busy', 'the Run is not in a claimable starting state');
  const session = sessionGuard(ctx);
  if (session !== null) return session;
  const lease = leaseGuard(ctx.lease);
  if (lease !== null) return lease;
  const persisted = persistedClaimGuard(ctx, event.claim, event.kind, 'the prepared claim disagrees with the persisted claim');
  if (persisted !== null) return persisted;
  const prepared = preparedBindingGuard(run, event.envelope);
  if (prepared !== null) return prepared;
  if (state.legacyV1) {
    return reject('guard_failed', 'forbidden', 'the Run has a legacy V1 authorization that cannot be upgraded into a fresh begin');
  }
  switch (starting) {
    case 'none': break;
    case 'authorized':
    case 'entering':
    case 'damaged':
      return reject('illegal', 'busy', 'the Run already has a V2 entry authorization');
    case 'revoked':
      // RUN-03 (改造) is step 5: today every existing V2 authorization is `busy`.
      return reject('illegal', 'busy', 'the Run already has a V2 entry authorization');
    default: return unreachable(starting, 'starting class');
  }
  if (ctx.goal.desiredState !== 'active') return reject('guard_failed', 'busy', 'the Goal is not active');
  // C6 (step 5.4b): today only the exact active Plan pin passes.
  if (ctx.entryPlan !== 'active_plan') {
    return reject('stale', 'revision_conflict', 'the requested Plan is no longer the Goal active pin');
  }
  // C3 (`continuationBrief`, step 5.4) is not read today.
  if (ctx.freshAdmission !== null) return freshAdmissionRejected(ctx.freshAdmission);
  return accept(runStateOf(authorizedRunRecord(run, event)));
}

/**
 * RUN-04 in `beginRuntimeEntry` order (`execution-entry-service.ts:1082-1117`):
 * pointer fence, `starting`, persisted claim, V2 binding and phase, permit,
 * Session, Lease, input binding, fresh re-admission.
 */
function onEntryBegun(
  state: RunState, run: RunSnapshot, event: Extract<RunEvent, { kind: 'entry_begun' }>, ctx: RunGuardContext,
): RunTransition {
  const fence = fenceGuard(run);
  if (fence !== null) return fence;
  const starting = startingClassOf(run);
  if (starting === 'not_starting') return reject('illegal', 'busy', 'the Run is not in a beginable starting state');
  const persisted = persistedClaimGuard(ctx, event.permit.claim, event.kind,
    'the entry permit claim disagrees with the persisted claim');
  if (persisted !== null) return persisted;
  const auth = v2Binding(state, run);
  if (isRejected(auth)) return auth;
  switch (starting) {
    case 'authorized': break;
    case 'none':
      return reject('illegal', 'forbidden', 'the Run has no formal V2 entry authorization');
    case 'entering':
    case 'damaged':
      return reject('illegal', 'busy', 'the Run entry is not in the authorized phase');
    case 'revoked':
      // §6.4: a revoked binding takes no begin until RUN-03 re-authorizes it.
      return reject('guard_failed', 'busy', 'the Run entry is not in the authorized phase');
    default: return unreachable(starting, 'starting class');
  }
  const permit = permitMatches(auth, event.permit);
  if (permit !== null) return permit;
  const session = sessionGuard(ctx);
  if (session !== null) return session;
  const lease = leaseGuard(ctx.lease);
  if (lease !== null) return lease;
  if (run.inputBinding === undefined || run.inputBinding.inputDigest !== event.permit.inputDigest) {
    return reject('guard_failed', 'forbidden', 'the Run input binding disagrees with the entry permit');
  }
  if (ctx.freshAdmission !== null) return freshAdmissionRejected(ctx.freshAdmission);
  // gen 1 claims the Kernel slot none → self; a re-authorized gen > 1 keeps it self → self (RUN-04).
  const expectedOwner = auth.generation === 1 ? 'none' : 'self';
  const kernel: RunKernelBinding = { adapterId: event.kernel.adapterId, kernelSessionId: event.kernel.kernelSessionId,
    runId: event.kernel.runId, turnId: event.kernel.turnId };
  return accept(runStateOf(enteringRunRecord(run, auth, event.kernel)),
    [{ kind: 'claim_kernel_slot', kernel, expectedOwner }]);
}

/**
 * RUN-05 in `recordExecutionEntered` order (`execution-entry-service.ts:1218-1250`),
 * persisted claim first. An already-occurred fact: no pointer fence and no
 * fresh re-admission.
 */
function onEnteredObserved(
  state: RunState, run: RunSnapshot, event: Extract<RunEvent, { kind: 'entered_observed' }>, ctx: RunGuardContext,
): RunTransition {
  const persisted = persistedClaimGuard(ctx, event.permit.claim, event.kind,
    'the entry permit claim disagrees with the persisted claim');
  if (persisted !== null) return persisted;
  const auth = v2Binding(state, run);
  if (isRejected(auth)) return auth;
  // Today's check is the phase alone (`execution-entry-service.ts:1223`); for the eight machine states it is
  // the node `Entering`, and a Run outside them (`runCombinationProblem`) is read the same way.
  if (auth.phase !== 'entering') {
    return reject('illegal', 'busy', 'the Run entry is not in the entering phase');
  }
  const permit = permitMatches(auth, event.permit);
  if (permit !== null) return permit;
  const session = sessionGuard(ctx);
  if (session !== null) return session;
  const lease = leaseGuard(ctx.lease);
  if (lease !== null) return lease;
  if (auth.kernel === null || !sameKernel(auth.kernel, event.kernelSource)) {
    return reject('guard_failed', 'forbidden', 'the entered Kernel source disagrees with the begin binding');
  }
  if (!sameKernel(event.history.kernel, event.kernelSource)) {
    return reject('guard_failed', 'forbidden', 'the observed history Kernel identity disagrees with the entered source');
  }
  if (event.kernelSource.position < event.history.startPosition
    || event.kernelSource.position > event.history.observedThroughPosition) {
    return reject('guard_failed', 'invalid', 'the entered Kernel position is outside the observed history range');
  }
  const history = locatorAfter(run, event.permit.claim.sessionRef, ctx, event.history);
  if (isRejected(history)) return history;
  return accept(runStateOf(enteredRunRecord(run, auth, history, event.enteredAt)), [
    { kind: 'attempt', event: 'attempt_started' },
    { kind: 'outbox', change: 'entered' },
  ]);
}

/**
 * RUN-06 (`execution-history-service.ts:407-430`): any existing node, no
 * status check today; an ended Run's end is fixed (§6.4 → stale). The Kernel
 * slot is self → self when this Run's begin or an earlier locator holds it.
 */
function onHistoryRecorded(
  run: RunSnapshot, event: Extract<RunEvent, { kind: 'history_recorded' }>, ctx: RunGuardContext,
): RunTransition {
  const history = locatorAfter(run, event.sessionRef, ctx, event.history);
  if (isRejected(history)) return history;
  const auth = run.executionAuthorization;
  const beginHeld = isAuthorizationV2(auth) && auth.kernel !== null && sameKernel(auth.kernel, history.kernel);
  const expectedOwner = beginHeld || run.executionHistory !== undefined ? 'self' : 'none';
  return accept(runStateOf(withHistoryRecord(run, history)),
    [{ kind: 'claim_kernel_slot', kernel: { ...history.kernel }, expectedOwner }]);
}

/**
 * RUN-07 in `recordRunResult` order (`execution-entry-service.ts:1358-1401`,
 * persisted claim first), behind the Runtime gate that is a guard here:
 * `exitProof` and the `input_accepted` confirmation
 * (`execution-observation.ts:534-537`, `:671-673`).
 */
function onTerminalObserved(
  state: RunState, node: Exclude<RunNode, 'Absent'>, run: RunSnapshot,
  event: Extract<RunEvent, { kind: 'terminal_observed' }>, ctx: RunGuardContext,
): RunTransition {
  const persisted = persistedClaimGuard(ctx, event.claim, event.kind, 'the result claim disagrees with the persisted claim');
  if (persisted !== null) return persisted;
  const auth = v2Binding(state, run);
  if (isRejected(auth)) return auth;
  if (node === 'EndedUnknown') {
    // §6.4: re-observing a terminal is not new evidence; only late_evidence/unknown_attested leave it.
    // An unconfirmed input acceptance and an old sequence keep their own §6.4 answers first. No writer
    // produces this node before RUN-08 (step 5.6).
    if (ctx.inputsConfirmed !== true) return reject('guard_failed', 'unavailable', 'the Turn input acceptance is not confirmed yet');
    if (event.event.sequence <= state.lastEventSeq) {
      return reject('stale', 'revision_conflict', 'the result event sequence is not newer than the applied Run fact');
    }
    return reject('guard_failed', 'incomplete', 'the Run outcome is unknown; only new Kernel evidence or an attestation resolves it');
  }
  // Today's order (`execution-entry-service.ts:1363-1364`), for every other Run including one outside the
  // eight states: the V2 phase, then a finished Run. An ended Run (settled) is a new identity for a known
  // terminal; the same identity replayed its receipt in the service (R5).
  if (auth.phase !== 'entered') {
    return reject(node === 'Ended' || node === 'YieldedWait' ? 'duplicate' : 'illegal', 'busy',
      'the Run entry is not in the entered phase');
  }
  if (isRunFinished(run)) return reject('duplicate', 'busy', 'the Run already has a terminal result');
  if (ctx.exitProof === null) return reject('guard_failed', 'incomplete', 'the Kernel call has not exited cleanly; the result is not booked yet');
  if (ctx.inputsConfirmed !== true) return reject('guard_failed', 'unavailable', 'the Turn input acceptance is not confirmed yet');
  // RUN-08 (改造) is step 5: today the observer books nothing and the Run stays running.
  if (event.unresolvedToolCallIds.length > 0) return notYet('RUN-08');
  const claim = event.claim;
  if (auth.consumerId !== event.entry.consumerId || auth.generation !== event.entry.entryGeneration) {
    return reject('guard_failed', 'forbidden', 'the result entry projection does not match the current V2 entry binding');
  }
  const { kernelSource, completedHistoryBoundary: boundary, history: observed } = event;
  if (kernelSource === null || boundary === null || observed === null) {
    return reject('guard_failed', 'incomplete', 'a terminal result requires the complete observed Turn boundary');
  }
  // The observation is the caller's: its shapes are checked here, in today's order (`:1374-1384`).
  if (!isKernelSource(kernelSource)) return reject('guard_failed', 'invalid', 'the terminal Kernel source is incomplete');
  if (auth.kernel === null || !sameKernel(auth.kernel, kernelSource)) {
    return reject('guard_failed', 'forbidden', 'the terminal Kernel source disagrees with the entered binding');
  }
  if (!isRecord(boundary.source) || !sameKernel(boundary.source, kernelSource)
    || boundary.source.position !== kernelSource.position || !nonEmpty(boundary.cursor)) {
    return reject('guard_failed', 'invalid', 'the completed history boundary disagrees with the terminal source');
  }
  if (!isRecord(observed.kernel) || !sameKernel(observed.kernel, kernelSource)) {
    return reject('guard_failed', 'forbidden', 'the observed history Kernel identity disagrees with the terminal source');
  }
  if (observed.endPosition !== kernelSource.position || observed.observedThroughPosition < kernelSource.position
    || observed.startPosition > kernelSource.position) {
    return reject('guard_failed', 'incomplete', 'the observed history does not carry the complete Turn end boundary');
  }
  const terminal = terminalOutcomeOf(event.event, claim.runRef, state.lastEventSeq);
  if ('status' in terminal) return rejected(terminal);
  if (terminal.outcome === 'yielded') {
    if (event.continuation === undefined) {
      return reject('guard_failed', 'invalid', 'a yielded Run requires the original wait continuation binding');
    }
    const problem = continuationProblem(event.continuation, claim);
    if (problem !== null) return reject('guard_failed', 'invalid', `the yielded continuation is malformed: ${problem}`);
  } else if (event.continuation !== undefined) {
    return reject('guard_failed', 'invalid', 'only a yielded Run may carry a continuation binding');
  }
  const history = locatorAfter(run, claim.sessionRef, ctx, observed);
  if (isRejected(history)) return history;
  return accept(runStateOf(endedRunRecord(run, auth, history, terminal, event)), [
    { kind: 'attempt', event: 'attempt_ended', outcome: terminal.outcome },
    { kind: 'outbox', change: 'settled_entered' },
    ...releaseEffects(claim, ctx, boundary.cursor),
  ]);
}

/**
 * The submission checks of `control-service.ts:392-399` after the ended check,
 * through the ONE copy §7 CTL-01 also answers with (`controlSubmissionProblem`),
 * so the Run record and the intent record never disagree about a submission.
 */
function submitGuards(run: RunSnapshot, kind: ControlIntentKindV1, reason: string | null, yielded: boolean, ctx: RunGuardContext): Rejected | null {
  const problem = controlSubmissionProblem({ kind, reason, pointer: run.controlState?.desiredState ?? 'none', yielded,
    pointerIntent: ctx.pointerIntent });
  return problem === null ? null : rejected(problem);
}

/** Today's accepted submission: the pointer or steer list moves, the new intent is queued@1 (CTL-01). */
function queuedSubmission(run: RunSnapshot, kind: ControlIntentKindV1, intentRef: ControlIntentRef): RunTransition {
  return accept(runStateOf(controlledRunRecord(run, pointerAfterSubmit(kind, intentRef))),
    [{ kind: 'intent', event: 'control_submitted', intentRef }]);
}

const NOT_ENTERED_KIND = { stop_not_entered: 'cancel', pause_not_entered: 'pause', resume_not_entered: 'resume' } as const;
const NOT_ENTERED_EVENT = { cancel: 'stop_not_entered', pause: 'pause_not_entered', resume: 'resume_not_entered' } as const;
const NOT_ENTERED_ROW = { stop_not_entered: 'RUN-09', pause_not_entered: 'RUN-10', resume_not_entered: 'RUN-11' } as const;

/**
 * RUN-09..11. (U) is 改造: today the submission on a Run that never entered
 * is queued like on an entered one (`control-service.ts:387-430`; step 5.1
 * applies it at once, D-7). (R), the reconcile of a leftover queued intent
 * (CTL-08(a)), is 新增.
 */
function onNotEnteredControl(
  node: Exclude<RunNode, 'Absent'>, run: RunSnapshot,
  event: Extract<RunEvent, { kind: 'stop_not_entered' | 'pause_not_entered' | 'resume_not_entered' }>, ctx: RunGuardContext,
): RunTransition {
  const cls = controlClassOf(node);
  switch (cls) {
    case 'not_entered': break;
    case 'entered':
      return reject('illegal', 'invalid', 'from Entering on a control applies only through the Kernel, RUN-23 or reconcile (D-7)');
    case 'yielded':
      return reject('illegal', 'invalid', 'a yielded wait keeps its control queued as the continuation fence');
    case 'ended':
      return node === 'EndedUnknown'
        ? reject('illegal', 'invalid', 'from Entering on a control applies only through the Kernel, RUN-23 or reconcile (D-7)')
        : reject('illegal', 'busy', 'the Run already ended; no new control intent is accepted');
    default: return unreachable(cls, 'control class');
  }
  if (event.source === 'R') return notYet(`${NOT_ENTERED_ROW[event.kind]} (R)`);
  const kind = NOT_ENTERED_KIND[event.kind];
  const problem = submitGuards(run, kind, null, false, ctx);
  if (problem !== null) return problem;
  return queuedSubmission(run, kind, event.intentRef);
}

/**
 * RUN-12..15 with today's result: no D-8 same-commit supersede, no D-9 Goal
 * guard for resume and no RD-8 consumed-continuation guard (step 5.1). A
 * pause/cancel/resume of a Run that never entered is `*_not_entered`.
 */
function onControlSubmitted(
  node: Exclude<RunNode, 'Absent'>, run: RunSnapshot,
  event: Extract<RunEvent, { kind: 'control_submitted' }>, ctx: RunGuardContext,
): RunTransition {
  const cls = controlClassOf(node);
  switch (cls) {
    case 'ended':
      return reject('illegal', 'busy', 'the Run already ended; no new control intent is accepted');
    case 'not_entered':
      if (event.control !== 'steer') {
        return reject('illegal', 'invalid', `a Run that never entered takes ${event.control} through ${NOT_ENTERED_EVENT[event.control]}`);
      }
      break;
    case 'entered':
    case 'yielded':
      break;
    default: return unreachable(cls, 'control class');
  }
  const problem = submitGuards(run, event.control, event.reason, cls === 'yielded', ctx);
  if (problem !== null) return problem;
  return queuedSubmission(run, event.control, event.intentRef);
}

/**
 * The Host instance lease of a reconciling write (D-18, L-1, L-10): a lease
 * held by another live Host (or an unreadable lock file) changes no fact; a
 * restart takeover and a human attestation need this Host to hold it.
 */
function hostLeaseGuard(needsOwnLease: boolean, ctx: RunGuardContext): Rejected | null {
  if (ctx.hostLease === 'held_by_other') {
    return reject('guard_failed', 'busy', 'the Host instance lease is held by another Host or unreadable');
  }
  if (needsOwnLease && ctx.hostLease !== 'owned') {
    return reject('guard_failed', 'busy', 'this Host does not hold the Host instance lease');
  }
  return null;
}

function isTakeover(basis: RunReconciliationBasisV1): boolean {
  return basis.kind === 'host_instance_takeover';
}

/** RUN-23 (新增): the §6.4 refusals in front of the row (RD-7, LA-7). */
function onStopPaused(
  state: RunState, node: Exclude<RunNode, 'Absent'>, event: Extract<RunEvent, { kind: 'stop_paused' }>, ctx: RunGuardContext,
): RunTransition {
  const cls = controlClassOf(node);
  switch (cls) {
    case 'entered': break;
    case 'not_entered':
      return reject('illegal', 'invalid', 'a Run that never entered stops through stop_not_entered');
    case 'yielded':
    case 'ended':
      return reject('illegal', 'busy', 'the Run already ended; no new control intent is accepted');
    default: return unreachable(cls, 'control class');
  }
  if (ctx.exitProof === null) {
    return reject('guard_failed', 'incomplete', 'the Kernel call has not exited cleanly; the cancel stays queued');
  }
  const lease = hostLeaseGuard(ctx.exitProof === 'host_instance_takeover', ctx);
  if (lease !== null) return lease;
  if (node === 'Entering' && ctx.exitProof === 'live_clean') {
    return reject('illegal', 'invalid', 'an Entering Run is stopped only by the restart variant of stop_paused');
  }
  if (event.turn.terminal || event.turn.inFlightToolCallIds.length > 0) {
    return reject('guard_failed', 'incomplete', 'the Turn has a Kernel terminal or a tool call in flight; the cancel stays queued');
  }
  if (ctx.exitProof === 'live_clean' && !ctx.kernelPaused) {
    return reject('guard_failed', 'incomplete', 'the in-process stop needs the Kernel Turn paused at a safe point');
  }
  if (state.pointer !== 'cancelled' || ctx.pointerIntent === null || ctx.pointerIntent.kind !== 'cancel'
    || ctx.pointerIntent.status !== 'queued') {
    return reject('illegal', 'invalid', 'stop_paused applies the queued cancel the pointer names');
  }
  return notYet('RUN-23');
}

const RECONCILE_ROW = {
  reconcile_not_entered: { Entering: 'RUN-16', Running: 'RUN-16' },
  reconcile_terminal: { Entering: 'RUN-17', Running: 'RUN-18' },
  reconcile_interrupted_clean: { Entering: 'RUN-19', Running: 'RUN-19' },
  reconcile_unknown: { Entering: 'RUN-20', Running: 'RUN-20' },
} as const;

/** RUN-16..20, RUN-24 (新增): the §6.4 refusals in front of the rows. */
function onReconcile(
  state: RunState, node: Exclude<RunNode, 'Absent'>,
  event: Extract<RunEvent, { kind: 'reconcile_not_entered' | 'reconcile_terminal' | 'reconcile_interrupted_clean' | 'reconcile_unknown' }>,
  ctx: RunGuardContext,
): RunTransition {
  if (state.legacyV1) {
    return reject('guard_failed', 'unsupported', 'a legacy Run has no Kernel binding to reconcile; it is reported as is');
  }
  const lease = hostLeaseGuard(isTakeover(event.basis), ctx);
  if (lease !== null) return lease;
  const cls = reconcileClassOf(node);
  switch (cls) {
    case 'entered': break;
    case 'never_begun':
      return reject('illegal', 'invalid', 'a Run that never began has no Kernel Turn to reconcile');
    case 'revoked':
      return reject('illegal', 'invalid', 'a revoked Run is proven not entered; reconcile skips it');
    case 'unknown':
      return reject('illegal', 'invalid', 'an unknown outcome is resolved only by late_evidence or unknown_attested');
    case 'known_terminal':
      return reject('illegal', 'busy', 'a known terminal is never rewritten');
    default: return unreachable(cls, 'reconcile class');
  }
  const probe = ctx.kernelProbe;
  if (probe === null) return reject('illegal', 'invalid', `${event.kind} requires the Kernel probe verdict`);
  if (INCONCLUSIVE_PROBES.has(probe)) {
    return reject('guard_failed', 'unavailable', `a ${probe} probe proves nothing; the Run stays and the Host reports it`);
  }
  const entering = node === 'Entering';
  switch (event.kind) {
    case 'reconcile_not_entered':
      if (!entering) return reject('illegal', 'invalid', 'only an Entering Run can be proven not entered');
      if (probe !== 'ready') {
        return reject('guard_failed', 'unavailable', 'an unreadable Kernel is not proof of not entering (RUN-20(ii))');
      }
      return notYet(RECONCILE_ROW[event.kind].Entering);
    case 'reconcile_terminal':
      return notYet(RECONCILE_ROW[event.kind][entering ? 'Entering' : 'Running']);
    case 'reconcile_interrupted_clean': {
      // C4: the machine picks the row by the pointer; a paused pointer never ends as a plain interruption.
      if (state.pointer === 'paused') return notYet('RUN-24');
      const intent = ctx.pointerIntent;
      if (state.pointer === 'cancelled' && intent !== null && intent.kind === 'cancel' && intent.status === 'queued') {
        return reject('illegal', 'invalid', 'a queued cancel with a clean Turn ends through stop_paused (RUN-23)');
      }
      return notYet(RECONCILE_ROW[event.kind].Running);
    }
    case 'reconcile_unknown':
      return notYet(RECONCILE_ROW[event.kind].Running);
    default: return unreachable(event, 'reconcile event');
  }
}

/** RUN-21 (新增): the §6.4 refusals in front of the row (RD-4). */
function onLateEvidence(
  state: RunState, node: Exclude<RunNode, 'Absent'>,
  event: Extract<RunEvent, { kind: 'late_evidence' }>, ctx: RunGuardContext,
): RunTransition {
  const cls = reconcileClassOf(node);
  switch (cls) {
    case 'unknown': break;
    case 'known_terminal':
      return reject('illegal', 'busy', 'a known terminal is never rewritten');
    case 'never_begun':
    case 'revoked':
    case 'entered':
      return reject('illegal', 'invalid', 'late evidence only resolves a Run that ended with outcome_unknown');
    default: return unreachable(cls, 'reconcile class');
  }
  if (ctx.exitProof === null) return reject('guard_failed', 'incomplete', 'the Kernel call has not exited cleanly; the evidence is not booked yet');
  const lease = hostLeaseGuard(isTakeover(event.basis), ctx);
  if (lease !== null) return lease;
  if (ctx.inputsConfirmed !== true) return reject('guard_failed', 'unavailable', 'the Turn input acceptance is not confirmed yet');
  if (event.event.sequence <= state.lastEventSeq) {
    return reject('stale', 'revision_conflict', 'the result event sequence is not newer than the applied Run fact');
  }
  const window = state.unresolved;
  const through = window?.observedThroughPosition ?? null;
  const stillUnresolved = window === null || through === null
    ? event.unresolvedToolCallIds.length > 0
    : window.toolCallIds.some(id => event.unresolvedToolCallIds.includes(id));
  if ((through !== null && event.kernelSource.position <= through) || stillUnresolved) {
    return reject('guard_failed', 'incomplete', 're-observing the same Kernel fact is not new evidence (RD-4)');
  }
  return notYet('RUN-21');
}

/** RUN-22 (新增): the §6.4 refusals in front of the row (D-4(b), L-1). */
function onUnknownAttested(
  node: Exclude<RunNode, 'Absent'>, event: Extract<RunEvent, { kind: 'unknown_attested' }>, ctx: RunGuardContext,
): RunTransition {
  const cls = reconcileClassOf(node);
  switch (cls) {
    case 'unknown': break;
    case 'known_terminal':
      return reject('illegal', 'busy', 'a known terminal is never rewritten');
    case 'never_begun':
    case 'revoked':
    case 'entered':
      return reject('illegal', 'invalid', 'only a Run that ended with outcome_unknown can be attested');
    default: return unreachable(cls, 'reconcile class');
  }
  if (ctx.actor !== 'human') return reject('guard_failed', 'forbidden', 'only an operator attests an unknown outcome');
  if (event.reason.trim().length === 0) return reject('guard_failed', 'invalid', 'an attestation requires a reason');
  const lease = hostLeaseGuard(true, ctx);
  if (lease !== null) return lease;
  return notYet('RUN-22');
}

// -------------------------------------------------------------------------- //
// Helpers                                                                     //
// -------------------------------------------------------------------------- //

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Key-order-free equality by canonical JSON (`execution-entry-service.ts:98-100`
 * `sameRef`, restated: `state/` imports only contracts). A value canonical
 * JSON cannot encode (`undefined`, a non-finite number) is never equal.
 */
function sameRef(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); } catch { return false; }
}
