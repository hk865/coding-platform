/**
 * ControlIntent state machine (docs/refactor/STATE-MACHINES-SPEC.md §7).
 *
 * One intent records the fate of ONE pause/cancel/resume/steer request; it is
 * never the Run's desired state. The Run pointer (`Run.controlState`) and the
 * steer list (`Run.controlInputs`) are moved by the same commit (§6 RUN-12..15,
 * `pointerAfterSubmit`; the submission checks both machines apply are the one
 * `controlSubmissionProblem`), and an observation only ever writes the intent:
 * the Run is a CAS guard, never rewritten (`control-service.ts:602-610`).
 *
 * Machine view (§7.1): `Absent → Queued@1 → Applied | Superseded | OutcomeUnknown`
 * (revision ≥ 2, with an observation). The machine never reads storage, mints
 * ids or reads a clock: the intent ref, the observation and its instants come
 * in through the event, the Run/Goal facts through `ControlGuardContext`.
 *
 * A.2 step 5.1 (§15.2) scope: CTL-01 with the D-9 Goal guard and the RD-8
 * consumed-continuation guard; CTL-02 (D-7, a Run that never entered takes a
 * pause/cancel/resume at once, `∅ → applied@2` with a platform observation,
 * CD-1/CD-3); CTL-04 (D-8, the older queued intent is superseded in the newer
 * commit); CTL-03/CTL-06 with the CD-2 pairing (a Kernel
 * `terminal_without_cancel` or `outcome_unknown` closes any kind); CTL-09 (an
 * applied or superseded intent is never re-observed: the same content is an
 * idempotent no-op, other content is stale; an outcome_unknown one is stale,
 * §7.4). The C4 paused-interrupted reason of the
 * ended-Run refusal is step 5.6; CTL-07, CTL-08 and CTL-10 (reconcile and the
 * paused stop) keep their events in the union and still return `illegal`
 * (`notYet`).
 *
 * `control-service.ts` drives this file (CTL-01/02/04 for `submitControl`,
 * CTL-03/05/06/09 for `recordControlObservation`). It asks
 * `submissionReadsPointerIntent` and `submissionReadsGoal` before it reads the
 * intent the pointer names and the Goal, and `observedIntentAnswer` before it
 * reads the Run; a stored locator that fails the locator codec reaches the
 * guards as `'malformed'`. Which older intents a submission supersedes is the
 * Run machine's effect list (`intent:control_superseded_by_newer`, §6
 * RUN-09..15), which names their refs.
 */
import type {
  ControlEntryIdentityV1, ControlIntentKindV1, ControlIntentRef, ControlIntentRequestV1,
  ControlIntentSnapshotV1, ControlObservationV1, ControlPlatformObservationV1,
} from '../../../contracts/control-intent.js';
import type { RunExecutionHistoryV1 } from '../../../contracts/core/execution-history.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { RunNode, RunPointer } from './run-machine.js';
import { accept, notYet, reject, unreachable, type Rejected, type Transition } from './transition.js';

// -------------------------------------------------------------------------- //
// State, guard context, events and effects (§7.1, §7.2)                      //
// -------------------------------------------------------------------------- //

export type ControlNode = 'Absent' | 'Queued' | 'Applied' | 'Superseded' | 'OutcomeUnknown';

/** Every observation kind an intent can carry: Kernel (`ControlObservationV1`) or platform (CD-1). */
export type ControlObservationKind = ControlObservationV1['kind'] | ControlPlatformObservationV1['kind'];

export type ControlIntentState = {
  node: ControlNode;
  /** `null` only while `Absent`. */
  kind: ControlIntentKindV1 | null;
  /** 0 while `Absent`, 1 while `Queued`, ≥ 2 once observed (`control-record-codecs.ts:365-377`). */
  revision: number;
  /** `null` while `Absent` or `Queued`. */
  observation: ControlObservationV1 | ControlPlatformObservationV1 | null;
};

/**
 * The Run machine node (§6.1 `RunNode`, owned by `run-machine.ts`; §7.1 types
 * `ControlGuardContext.run.node` with it). The import is type-only, so there is
 * no runtime cycle with run-machine's value import of `pointerAfterSubmit` and
 * `controlSubmissionProblem`. Every guard reads the node only through the
 * exhaustive `runControlClassOf`, so a node added to or renamed in §6.1 fails
 * `npm run typecheck` instead of passing as an open Run.
 */
export type ControlRunNode = RunNode;

/** `Run.controlState.desiredState`, or `none` when the Run has no pointer (§6.1 `RunPointer`). */
export type RunControlPointer = RunPointer;

/**
 * The intent `Run.controlState` points to, as the service reads it for a
 * resume; `null` without a pointer. `run-machine.ts` `RunGuardContext`
 * carries the same shape.
 */
export type ControlPointerIntent = {
  kind: ControlIntentKindV1; status: ControlIntentSnapshotV1['status']; observed: ControlObservationKind | null;
};

export type ControlGuardContext = {
  run: {
    node: ControlRunNode;
    pointer: RunControlPointer;
    /** `Run.controlState.intentRef` is this intent. */
    pointsHere: boolean;
    /** `Run.controlInputs` lists this intent (steer). */
    inControlInputs: boolean;
    /** `YieldedWait` whose continuation the successor Run already consumed (§6 RD-8). */
    continuationConsumed: boolean;
    /** The Kernel Turn is paused (CTL-10 in-process variant only; LA-7). */
    kernelPaused: boolean;
    /** `isPausedInterrupted(run)`: the Run ended through §6 RUN-24 (CTL-08(f), 7.4, C4). */
    pausedInterrupted: boolean;
    /** From the V2 authorization and the claim generation; `null` without a V2 authorization. */
    entry: ControlEntryIdentityV1 | null;
    /**
     * The persisted locator `Run.executionHistory` (`null` when absent). §7.1
     * names only its window `{start, through}`; the machine derives that window
     * here (`endPosition ?? observedThroughPosition`) and also compares the
     * observation's history identity with it (`control-service.ts:549-560`).
     * `'malformed'`: a stored locator that fails `isRunExecutionHistoryV1`, a
     * damaged read answered `unavailable` right after the missing-locator row
     * (`control-service.ts:551`).
     */
    history: RunExecutionHistoryV1 | 'malformed' | null;
  };
  /** D-9: the resume guard (§2). */
  goal: { desiredState: 'active' | 'paused' | 'cancelled' };
  /** The intent `Run.controlState` points to, read by the service; `null` without a pointer. */
  pointerIntent: ControlPointerIntent | null;
  /** The caller's intent and Run version pins equal the current revisions. */
  pinsMatch: { intent: boolean; run: boolean };
  /** CTL-10 / §6 RUN-23. */
  exitProof: 'live_clean' | 'host_instance_takeover' | null;
  origin: 'live' | 'reconcile';
};

/** The V2 entry phase of a Run that never entered (§7.1 `ControlPlatformObservationV1` detail, RD-1). */
export type NotEnteredEntryPhase = 'none' | 'authorized' | 'revoked';

export type ControlIntentEvent =
  /** U/P (§7.2): R1–R4, G7. `intentRef` is derived by the service from the request identity. */
  | { type: 'control_submitted'; target: 'run' | 'query_run'; intentRef: ControlIntentRef;
      kind: ControlIntentKindV1; reason: string | null }
  /** P, CTL-02 (D-7): submitted and applied in one commit because the Run never entered. */
  | { type: 'control_applied_not_entered'; intentRef: ControlIntentRef; kind: 'pause' | 'cancel' | 'resume';
      reason: string | null; entryPhase: NotEnteredEntryPhase; runRevision: number; observedAt: string }
  /** P, CTL-04 (D-8): `supersededBy` is the new pointer intent, or the cancel that ended the Run. */
  | { type: 'control_superseded_by_newer'; supersededBy: ControlIntentRef; runRevision: number; observedAt: string }
  /** K: the trusted in-process Runtime observer (CTL-03, CTL-05, CTL-06, CTL-09). */
  | { type: 'control_observed'; observation: ControlObservationV1 }
  /** P, CTL-10 (§6 RUN-23, RD-7, LA-7). */
  | { type: 'control_applied_paused_stop'; basis: 'live_clean' | 'host_instance_takeover';
      pausedBy: ControlIntentRef | null; runRevision: number; observedAt: string }
  /** R, CTL-07/CTL-08: Kernel evidence, or the platform conclusion when none is attributable. */
  | { type: 'control_reconciled'; hostInstanceId: string;
      observation: ControlObservationV1 | ControlPlatformObservationV1 };

/** The Run-side change of one submission (§6 RUN-12..15), translated by the Run owner. */
export type RunPointerChange =
  | { kind: 'set_pointer'; controlState: NonNullable<RunSnapshot['controlState']> }
  | { kind: 'append_input'; intentRef: ControlIntentRef };

export type ControlIntentEffect =
  /** The same commit moves `Run.controlState` or appends to `Run.controlInputs` (RUN-09..15). */
  | { kind: 'run_pointer'; change: RunPointerChange }
  /** The Run is only a CAS guard of the commit; it is never written (`control-service.ts:602-610`). */
  | { kind: 'guard_run' };

export type ControlTransition = Transition<ControlIntentState, ControlIntentEvent, ControlIntentEffect>;

// -------------------------------------------------------------------------- //
// Pure helpers named by §7.6                                                  //
// -------------------------------------------------------------------------- //

/** R1–R4 kind/desired-state pairing (`control-record-codecs.ts:344-355`). */
export function desiredStateOfKind(kind: ControlIntentKindV1): ControlIntentRequestV1['desiredState'] {
  switch (kind) {
    case 'pause': return 'paused';
    case 'cancel': return 'cancelled';
    case 'resume': return 'running';
    case 'steer': return 'steered';
    default: return unreachable(kind, 'control intent kind');
  }
}

/**
 * §6 RUN-09..15: the Run pointer after one accepted submission. pause/cancel/
 * resume move `controlState` to the new intent; a steer leaves the pointer and
 * only appends to `controlInputs` (`control-service.ts:411-413`). Which older
 * queued intent the move supersedes (CTL-04) is the Run machine's effect list,
 * not this function.
 */
export function pointerAfterSubmit(kind: ControlIntentKindV1, intentRef: ControlIntentRef): RunPointerChange {
  if (kind === 'steer') return { kind: 'append_input', intentRef };
  return { kind: 'set_pointer', controlState: { intentRef, desiredState: desiredStateOfKind(kind) } };
}

function busy(reason: string): CoreRejection {
  return { status: 'rejected', code: 'busy', reason };
}

/**
 * The narrow fresh-submit decision over the canonical Run pointer (moved from
 * `control-service.ts:125-140` `freshSubmitControlProblem`). A queued cancel is
 * final; a pause cannot be repeated; only a paused pointer can be resumed. A
 * `running`/`steered` pointer does not authorize continuing execution.
 */
export function controlSubmitProblem(pointer: RunControlPointer, kind: ControlIntentKindV1): CoreRejection | null {
  if (pointer === 'none') return kind === 'resume' ? busy('resume requires a formal pause') : null;
  if (pointer === 'cancelled') return busy('the Run is already fenced by a queued cancel control intent');
  if (pointer === 'paused' && kind === 'pause') return busy('the Run is already fenced by a queued pause control intent');
  // An explicit resume is the ONLY thing that releases a formal pause hold; it
  // is meaningless when the Run is not actually paused.
  if (kind === 'resume' && pointer !== 'paused') return busy('the Run is not fenced by a pause control intent');
  return null;
}

/**
 * A resume of a Run that did not yield, with a pointer, is the one submission
 * answered by the intent that pointer names (`control-service.ts:393`): it must
 * be an applied, observed pause.
 */
function resumeNeedsPointerIntent(kind: ControlIntentKindV1, yielded: boolean, pointer: RunControlPointer): boolean {
  return kind === 'resume' && !yielded && pointer !== 'none';
}

/**
 * CTL-01's submission checks after the ended-Run refusal, in the order of the
 * CTL-01 guard (§7.3): a `YieldedWait` whose continuation a successor Run
 * already consumed takes no control (RD-8); a steer needs its directional
 * text; a resume of a Run that did not yield, with a pointer, needs that
 * pointer to name an applied, observed pause; a resume needs the Goal active
 * (D-9: a single Run is not resumed while its Goal is paused or cancelled);
 * then `controlSubmitProblem`. The ONE copy of these checks: CTL-01/CTL-02 and
 * run-machine's RUN-09..15 all answer a submission with it, so the Run record
 * and the intent record cannot disagree about whether a submission is legal.
 */
export function controlSubmissionProblem(input: {
  kind: ControlIntentKindV1; reason: string | null; pointer: RunControlPointer;
  /** A `YieldedWait` Run: its queued pause is the continuation fence, not an observed pause. */
  yielded: boolean;
  /** RD-8: the `YieldedWait`'s continuation was already consumed by a successor Run. */
  continuationConsumed: boolean;
  pointerIntent: ControlPointerIntent | null;
  /** D-9: the Goal's desired state (§2). */
  goal: ControlGuardContext['goal']['desiredState'];
}): CoreRejection | null {
  if (input.yielded && input.continuationConsumed) {
    return busy('a successor Run already consumed the yielded wait continuation; no new control intent is accepted');
  }
  if (input.kind === 'steer' && (input.reason === null || input.reason.trim().length === 0)) {
    return { status: 'rejected', code: 'invalid', reason: 'steer requires the actual directional input text' };
  }
  if (resumeNeedsPointerIntent(input.kind, input.yielded, input.pointer)) {
    const pause = input.pointerIntent;
    if (pause === null || pause.kind !== 'pause' || pause.status !== 'applied' || pause.observed !== 'paused') {
      return busy('resume requires an observed paused original Turn');
    }
  }
  if (input.kind === 'resume' && input.goal !== 'active') {
    return busy(`the Goal is ${input.goal}; a single Run is not resumed while its Goal is not active`);
  }
  return controlSubmitProblem(input.pointer, input.kind);
}

/**
 * The status an observation of an intent the pointer still names records
 * (moved from `control-service.ts:217-221`, completed per §7.1):
 * `superseded_by_newer` and `terminal_without_cancel` → superseded,
 * `outcome_unknown` → outcome_unknown, every real effect → applied.
 */
export function observationStatusFor(kind: ControlObservationKind): Exclude<ControlIntentSnapshotV1['status'], 'queued'> {
  switch (kind) {
    case 'superseded_by_newer':
    case 'terminal_without_cancel':
      return 'superseded';
    case 'outcome_unknown':
      return 'outcome_unknown';
    case 'paused':
    case 'cancelled':
    case 'resumed':
    case 'steered':
      return 'applied';
    default: return unreachable(kind, 'control observation kind');
  }
}

function isPlatformObservation(
  observation: ControlObservationV1 | ControlPlatformObservationV1,
): observation is ControlPlatformObservationV1 {
  return Object.prototype.hasOwnProperty.call(observation, 'origin');
}

/**
 * Which intent kind an observation may close, exactly as the snapshot codec
 * enforces it (`control-record-codecs.ts`, §7.1 pairing): paused/resumed/
 * steered/cancelled belong to their own kind, from the Kernel or the platform;
 * superseded_by_newer (platform only), terminal_without_cancel and
 * outcome_unknown close any kind (CD-2: a terminal can come before any control
 * takes effect, and a consumed pause can meet an unknown tool result).
 */
export function observationPairingProblem(
  intentKind: ControlIntentKindV1,
  observation: ControlObservationV1 | ControlPlatformObservationV1,
): string | null {
  const kind: ControlObservationKind = observation.kind;
  switch (kind) {
    case 'paused': return intentKind === 'pause' ? null : 'a paused observation must belong to a pause intent';
    case 'resumed': return intentKind === 'resume' ? null : 'resumed must belong to resume';
    case 'steered': return intentKind === 'steer' ? null : 'steered must belong to steer';
    case 'cancelled': return intentKind === 'cancel' ? null : 'a cancelled observation must belong to a cancel intent';
    case 'superseded_by_newer':
    case 'terminal_without_cancel':
    case 'outcome_unknown':
      return null;
    default: return unreachable(kind, 'control observation kind');
  }
}

function nodeOfStatus(status: ControlIntentSnapshotV1['status']): Exclude<ControlNode, 'Absent'> {
  switch (status) {
    case 'queued': return 'Queued';
    case 'applied': return 'Applied';
    case 'superseded': return 'Superseded';
    case 'outcome_unknown': return 'OutcomeUnknown';
    default: return unreachable(status, 'control intent status');
  }
}

function statusOfNode(node: Exclude<ControlNode, 'Absent'>): ControlIntentSnapshotV1['status'] {
  switch (node) {
    case 'Queued': return 'queued';
    case 'Applied': return 'applied';
    case 'Superseded': return 'superseded';
    case 'OutcomeUnknown': return 'outcome_unknown';
    default: return unreachable(node, 'control node');
  }
}

/** The machine state of a stored intent (`null` → `Absent`). */
export function controlIntentStateOf(snapshot: ControlIntentSnapshotV1 | null): ControlIntentState {
  if (snapshot === null) return { node: 'Absent', kind: null, revision: 0, observation: null };
  return { node: nodeOfStatus(snapshot.status), kind: snapshot.kind, revision: snapshot.revision,
    observation: snapshot.status === 'queued' ? null : snapshot.observation };
}

// -------------------------------------------------------------------------- //
// Record constructors (§14.1: `ControlIntentSnapshotV1.status/observation/revision`) //
// -------------------------------------------------------------------------- //

/**
 * The immutable request of a new intent. The caller supplies identity, clock
 * and actor through the owner service; `desiredState` is always derived.
 */
export function newControlIntentRequest(input: {
  ref: ControlIntentRef; runRef: ControlIntentRequestV1['runRef']; kind: ControlIntentKindV1;
  reason: string | null; requestedAt: string; requestedBy: ControlIntentRequestV1['requestedBy'];
}): ControlIntentRequestV1 {
  return { schemaVersion: 1, ref: input.ref, runRef: input.runRef, kind: input.kind,
    desiredState: desiredStateOfKind(input.kind), reason: input.reason,
    requestedAt: input.requestedAt, requestedBy: input.requestedBy };
}

/** The immutable request fields of a stored intent; an observation never changes them. */
export function controlIntentRequestOf(snapshot: ControlIntentSnapshotV1): ControlIntentRequestV1 {
  return { schemaVersion: snapshot.schemaVersion, ref: snapshot.ref, runRef: snapshot.runRef,
    kind: snapshot.kind, desiredState: snapshot.desiredState, reason: snapshot.reason,
    requestedAt: snapshot.requestedAt, requestedBy: snapshot.requestedBy };
}

/** CTL-01: the original `queued@1` snapshot, field order as `control-service.ts:408-410`. */
export function newQueuedControlIntentRecord(request: ControlIntentRequestV1): ControlIntentSnapshotV1 {
  if (request.desiredState !== desiredStateOfKind(request.kind)) {
    throw new Error(`a ${request.kind} intent must desire ${desiredStateOfKind(request.kind)}`);
  }
  return { schemaVersion: request.schemaVersion, ref: request.ref, revision: 1, runRef: request.runRef,
    kind: request.kind, desiredState: request.desiredState, status: 'queued', reason: request.reason,
    requestedAt: request.requestedAt, requestedBy: request.requestedBy };
}

/**
 * The ONE writer of a stored intent snapshot from an accepted transition's
 * `next`. It only produces legal combinations: `queued` is revision 1 without
 * an observation; an observed status has revision ≥ 2, an observation paired
 * with the intent kind (`observationPairingProblem`), and the request's kind.
 * Field order of the observed form follows `control-service.ts:584-588`.
 */
export function controlIntentRecordOf(request: ControlIntentRequestV1, next: ControlIntentState): ControlIntentSnapshotV1 {
  if (next.node === 'Absent') throw new Error('an Absent control intent has no record');
  if (next.kind !== request.kind) throw new Error('the control intent state disagrees with the request kind');
  if (next.node === 'Queued') {
    if (next.revision !== 1 || next.observation !== null) {
      throw new Error('a queued control intent is revision 1 without an observation');
    }
    return newQueuedControlIntentRecord(request);
  }
  if (next.observation === null || !Number.isSafeInteger(next.revision) || next.revision < 2) {
    throw new Error('an observed control intent needs an observation and revision >= 2');
  }
  const pairing = observationPairingProblem(request.kind, next.observation);
  if (pairing !== null) throw new Error(pairing);
  if (request.desiredState !== desiredStateOfKind(request.kind)) {
    throw new Error(`a ${request.kind} intent must desire ${desiredStateOfKind(request.kind)}`);
  }
  const status = statusOfNode(next.node);
  if (status === 'queued') throw new Error('an observed control intent cannot be queued');
  return { schemaVersion: request.schemaVersion, ref: request.ref, runRef: request.runRef, kind: request.kind,
    desiredState: request.desiredState, reason: request.reason, requestedAt: request.requestedAt,
    requestedBy: request.requestedBy, revision: next.revision, status, observation: next.observation };
}

// -------------------------------------------------------------------------- //
// Guard rows                                                                  //
// -------------------------------------------------------------------------- //

type SubmitEvent = Extract<ControlIntentEvent, { type: 'control_submitted' }>;
type AppliedNotEnteredEvent = Extract<ControlIntentEvent, { type: 'control_applied_not_entered' }>;
/** The two events of one Host submission: queued (CTL-01) or applied at once (CTL-02). */
export type ControlSubmissionEvent = SubmitEvent | AppliedNotEnteredEvent;
type ObservedEvent = Extract<ControlIntentEvent, { type: 'control_observed' }>;
type SupersededEvent = Extract<ControlIntentEvent, { type: 'control_superseded_by_newer' }>;
type GuardRow<E, C = ControlGuardContext> = { row: string; check(event: E, ctx: C): Rejected | null };

/** What every submission guard reads of either submission event (CTL-02 always targets a Run). */
type Submission = { target: 'run' | 'query_run'; kind: ControlIntentKindV1; reason: string | null };
function submissionOf(event: ControlSubmissionEvent): Submission {
  return event.type === 'control_submitted' ? { target: event.target, kind: event.kind, reason: event.reason }
    : { target: 'run', kind: event.kind, reason: event.reason };
}

/**
 * How a Run node answers a control: an ended Run that did not yield refuses it
 * (`control-service.ts:384-391`), a `YieldedWait` keeps it as the continuation
 * fence, and from `Entering` on only the Kernel, RUN-23 or reconcile can apply
 * it (D-7). The ONE place a guard reads `ctx.run.node`.
 */
type RunControlClass = 'missing' | 'not_entered' | 'entered' | 'yielded' | 'ended';
function runControlClassOf(node: ControlRunNode): RunControlClass {
  switch (node) {
    case 'Absent': return 'missing';
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

/**
 * The entry phase a Run that never entered carries in its CTL-02 observation
 * (§7.1, RD-1); `null` for every other node, which CTL-02 refuses.
 */
export function notEnteredEntryPhase(node: ControlRunNode): NotEnteredEntryPhase | null {
  switch (node) {
    case 'Claimed': return 'none';
    case 'Authorized': return 'authorized';
    case 'Revoked': return 'revoked';
    case 'Absent':
    case 'Entering':
    case 'Running':
    case 'YieldedWait':
    case 'Ended':
    case 'EndedUnknown':
      return null;
    default: return unreachable(node, 'Run node');
  }
}

/**
 * The rows on the target Run every submission asks first (`control-service.ts:96`,
 * `:363-391`); only a submission past them reads the intent the pointer names
 * or the Goal. The C4 paused-interrupted reason of the ended-Run row is step 5.6.
 */
const SUBMIT_TARGET_GUARDS: readonly GuardRow<Submission>[] = [
  { row: '7.4 QueryRunRef', check: submission => submission.target === 'query_run'
    ? reject('illegal', 'invalid', 'the control submission requires a complete RunRef') : null },
  { row: 'Run read', check: (_submission, ctx) => runControlClassOf(ctx.run.node) === 'missing'
    ? reject('illegal', 'not_found', 'the target Run does not exist') : null },
  { row: '7.4 stale Run pin', check: (_submission, ctx) => ctx.pinsMatch.run
    ? null : reject('stale', 'revision_conflict', 'the Run changed since the caller read it') },
  { row: '7.4 Run ended', check: (_submission, ctx) => runControlClassOf(ctx.run.node) === 'ended'
    ? reject('illegal', 'busy', 'the Run already ended; no new control intent is accepted') : null },
];

/**
 * Which of the two submission events a Run node takes (D-7): a pause, cancel
 * or resume of a Run that never entered is applied at once (CTL-02); every
 * other submission is queued (CTL-01). The other event is an internal
 * assertion (§7.4): the service picks the event by the same Run read.
 */
const SUBMISSION_ROUTE: GuardRow<ControlSubmissionEvent> = { row: '7.4 D-7 route', check: (event, ctx) => {
  const cls = runControlClassOf(ctx.run.node);
  if (event.type === 'control_submitted') {
    return cls === 'not_entered' && event.kind !== 'steer'
      ? reject('illegal', 'invalid', `a Run that never entered takes ${event.kind} through control_applied_not_entered (CTL-02)`)
      : null;
  }
  switch (cls) {
    case 'not_entered':
      return event.entryPhase === notEnteredEntryPhase(ctx.run.node)
        ? null : reject('illegal', 'invalid', 'the not-entered entry phase disagrees with the Run');
    case 'yielded':
      return reject('illegal', 'invalid', 'a yielded wait keeps its control queued as the continuation fence');
    case 'missing':
    case 'entered':
    case 'ended':
      return reject('illegal', 'invalid', 'from Entering on only the Kernel, RUN-23 or reconcile can apply a control (D-7)');
    default: return unreachable(cls, 'Run control class');
  }
} };

const SUBMIT_GUARDS: readonly GuardRow<ControlSubmissionEvent>[] = [
  ...SUBMIT_TARGET_GUARDS.map((guard): GuardRow<ControlSubmissionEvent> =>
    ({ row: guard.row, check: (event, ctx) => guard.check(submissionOf(event), ctx) })),
  SUBMISSION_ROUTE,
  { row: '7.4 RD-8, steer text, resume needs applied pause, D-9 Goal, pointer fence', check: (event, ctx) => {
    const problem = controlSubmissionProblem({ kind: event.kind, reason: event.reason, pointer: ctx.run.pointer,
      yielded: runControlClassOf(ctx.run.node) === 'yielded', continuationConsumed: ctx.run.continuationConsumed,
      pointerIntent: ctx.pointerIntent, goal: ctx.goal.desiredState });
    return problem === null ? null : reject('guard_failed', problem.code, problem.reason);
  } },
];

/**
 * Whether the submission is answered with the intent `Run.controlState` names:
 * the rows on the target Run passed and a pause, cancel or resume moves an
 * existing pointer. A resume of a Run that did not yield needs it to be an
 * observed pause, and a still-queued one is superseded in the same commit
 * (D-8). The service reads that intent exactly then; every other submission
 * is answered with `pointerIntent: null`.
 */
export function submissionReadsPointerIntent(event: ControlSubmissionEvent, ctx: ControlGuardContext): boolean {
  return firstFailing(SUBMIT_TARGET_GUARDS, submissionOf(event), ctx) === null
    && event.kind !== 'steer' && ctx.run.pointer !== 'none';
}

/**
 * Whether the submission is answered with the Goal's desired state (D-9): the
 * rows on the target Run passed and it is a resume. The service reads the Goal
 * exactly then; every other submission holds `goal.desiredState='active'`.
 */
export function submissionReadsGoal(event: ControlSubmissionEvent, ctx: ControlGuardContext): boolean {
  return firstFailing(SUBMIT_TARGET_GUARDS, submissionOf(event), ctx) === null && event.kind === 'resume';
}

function sameHistoryIdentity(observed: RunExecutionHistoryV1, locator: RunExecutionHistoryV1): boolean {
  return locator.sessionRef.projectId === observed.sessionRef.projectId
    && locator.sessionRef.sessionId === observed.sessionRef.sessionId
    && locator.kernel.adapterId === observed.kernel.adapterId
    && locator.kernel.kernelSessionId === observed.kernel.kernelSessionId
    && locator.kernel.runId === observed.kernel.runId
    && locator.kernel.turnId === observed.kernel.turnId
    && locator.startPosition === observed.startPosition;
}

/**
 * CTL-03 guards in today's order (`control-service.ts:520-573`). The rows on
 * the intent come first: only an observation past them reads the Run. The
 * persisted Run locator is the authority for the window: a terminal window is
 * bounded by `endPosition`, a nonterminal one by `observedThroughPosition`.
 */
const OBSERVED_INTENT_GUARDS: readonly GuardRow<ObservedEvent, Pick<ControlGuardContext, 'pinsMatch'>>[] = [
  { row: '7.4 stale intent pin', check: (_event, ctx) => ctx.pinsMatch.intent
    ? null : reject('stale', 'revision_conflict', 'the control intent changed since the caller read it') },
];
const OBSERVED_RUN_GUARDS: readonly GuardRow<ObservedEvent>[] = [
  { row: 'Run read', check: (_event, ctx) => runControlClassOf(ctx.run.node) === 'missing'
    ? reject('illegal', 'not_found', 'the target Run does not exist') : null },
  { row: '7.4 stale Run pin', check: (_event, ctx) => ctx.pinsMatch.run
    ? null : reject('stale', 'revision_conflict', 'the Run changed since the caller read it') },
  { row: '7.4 no V2 entry', check: (_event, ctx) => ctx.run.entry === null
    ? reject('guard_failed', 'forbidden', 'the observed Run has no formal V2 entry authorization') : null },
  { row: '7.4 entry identity', check: ({ observation }, ctx) => {
    const entry = ctx.run.entry;
    return entry !== null && (entry.consumerId !== observation.entry.consumerId
      || entry.entryGeneration !== observation.entry.entryGeneration
      || entry.sessionGeneration !== observation.entry.sessionGeneration)
      ? reject('guard_failed', 'forbidden', 'the observed entry identity disagrees with the Run entry binding') : null;
  } },
  { row: '7.4 no locator', check: (_event, ctx) => ctx.run.history === null
    ? reject('guard_failed', 'forbidden', 'the observed Run has no execution-history locator') : null },
  { row: 'malformed locator', check: (_event, ctx) => ctx.run.history === 'malformed'
    ? reject('guard_failed', 'unavailable', 'the stored execution-history locator is malformed') : null },
  { row: '7.4 locator identity', check: ({ observation }, ctx) => {
    const locator = ctx.run.history;
    if (locator === null || locator === 'malformed') return null;
    return !sameHistoryIdentity(observation.history, locator)
      ? reject('guard_failed', 'forbidden', 'the observation history disagrees with the Run locator') : null;
  } },
  { row: '7.4 source window', check: ({ observation }, ctx) => {
    const locator = ctx.run.history;
    if (locator === null || locator === 'malformed') return null;
    const through = locator.endPosition ?? locator.observedThroughPosition;
    return observation.source.position < locator.startPosition || observation.source.position > through
      ? reject('guard_failed', 'unavailable', 'the observation source is outside the persisted Run history window') : null;
  } },
  { row: '7.4 observation window', check: ({ observation }, ctx) => {
    const locator = ctx.run.history;
    if (locator === null || locator === 'malformed') return null;
    const through = locator.endPosition ?? locator.observedThroughPosition;
    return observation.history.observedThroughPosition > through
      ? reject('guard_failed', 'unavailable', 'the observation window exceeds the persisted Run history window') : null;
  } },
  // CTL-06: the terminal came first only for a Run that ended with a known
  // outcome; a yielded wait keeps its intents as the continuation fence, an
  // unknown end records outcome_unknown.
  { row: 'CTL-06 known terminal', check: ({ observation }, ctx) =>
    observation.kind === 'terminal_without_cancel' && ctx.run.node !== 'Ended'
      ? reject('guard_failed', 'busy', 'terminal_without_cancel is recorded only after a known terminal that is not a yielded wait')
      : null },
];

function firstFailing<E, C>(rows: readonly GuardRow<E, C>[], event: E, ctx: C): Rejected | null {
  for (const guard of rows) {
    const failed = guard.check(event, ctx);
    if (failed !== null) return failed;
  }
  return null;
}

/**
 * CTL-09: an observation that names the same Kernel fact (kind, source
 * position and Kernel event id) as the one already recorded.
 */
function sameObservedFact(recorded: ControlIntentState['observation'], observation: ControlObservationV1): boolean {
  return recorded !== null && !isPlatformObservation(recorded) && recorded.kind === observation.kind
    && recorded.source.position === observation.source.position && recorded.kernelEventId === observation.kernelEventId;
}

/**
 * CTL-03's rows on the intent itself (`control-service.ts:525-528`): the
 * caller's intent pin, then the state guard of an already observed intent
 * (CTL-09: an applied or superseded intent is never re-observed; the same
 * Kernel fact is the idempotent no-op, SD-1, any other content a late
 * observation that is stale. §7.4: an outcome_unknown intent is stale for
 * every in-process observation; only `control_reconciled` moves it). `null`
 * when the answer needs the Run: a queued intent past its pin. The service
 * asks it after the intent read and before it reads the Run, so neither a
 * stale nor an observed intent reads the Run; `transitionControlIntent` asks
 * it again, first.
 */
export function observedIntentAnswer(
  state: ControlIntentState, event: ObservedEvent, ctx: Pick<ControlGuardContext, 'pinsMatch'>,
): ControlTransition | null {
  const stale = firstFailing(OBSERVED_INTENT_GUARDS, event, ctx);
  if (stale !== null) return stale;
  switch (state.node) {
    case 'Absent':
    case 'Queued':
      return null;
    case 'Applied':
    case 'Superseded':
      return sameObservedFact(state.observation, event.observation) ? accept<ControlIntentState, ControlIntentEffect>(state)
        : reject('stale', 'revision_conflict',
          `the control intent is already ${statusOfNode(state.node)}; a later observation does not change it`);
    case 'OutcomeUnknown':
      return reject('stale', 'revision_conflict',
        'the control intent is outcome_unknown; only the start-up reconcile settles it');
    default: return unreachable(state.node, 'control node');
  }
}

// -------------------------------------------------------------------------- //
// Transitions (§7.3, forbidden §7.4)                                          //
// -------------------------------------------------------------------------- //

/**
 * The intent ref is derived from the request identity, so a submission that
 * finds an existing intent is the same identity with different content: the
 * service's receipt lookup already replayed the same-content case (§1.2).
 */
function existingIdentity(): Rejected {
  return reject('duplicate', 'idempotency_conflict', 'the control request identity was already used with different content');
}

/**
 * CTL-01 (queued) and CTL-02 (applied at once, D-7) from `Absent`: the same
 * submission guards, the D-7 route by the Run node, then the new intent and
 * its one `run_pointer` effect. CTL-02 writes `applied@2` with the platform's
 * own `platform_not_entered` observation (CD-1, CD-3); the Run revision it
 * names is the one the same commit writes.
 */
function onSubmission(state: ControlIntentState, event: ControlSubmissionEvent, ctx: ControlGuardContext): ControlTransition {
  switch (state.node) {
    case 'Absent': {
      const failed = firstFailing(SUBMIT_GUARDS, event, ctx);
      if (failed !== null) return failed;
      const effects: ControlIntentEffect[] = [{ kind: 'run_pointer', change: pointerAfterSubmit(event.kind, event.intentRef) }];
      if (event.type === 'control_submitted') {
        return accept<ControlIntentState, ControlIntentEffect>({ node: 'Queued', kind: event.kind, revision: 1, observation: null }, effects);
      }
      const observation: ControlPlatformObservationV1 = {
        schemaVersion: 1, origin: 'platform_not_entered', kind: NOT_ENTERED_OBSERVATION[event.kind],
        runRevision: event.runRevision, detail: { entryPhase: event.entryPhase }, observedAt: event.observedAt,
      };
      return accept<ControlIntentState, ControlIntentEffect>({ node: 'Applied', kind: event.kind, revision: 2, observation }, effects);
    }
    case 'Queued':
    case 'Applied':
    case 'Superseded':
    case 'OutcomeUnknown':
      return existingIdentity();
    default: return unreachable(state.node, 'control node');
  }
}

const NOT_ENTERED_OBSERVATION = { pause: 'paused', cancel: 'cancelled', resume: 'resumed' } as const;

/**
 * CTL-03 / CTL-05 / CTL-06 / CTL-09. An intent already observed is answered by
 * `observedIntentAnswer` (CTL-09). A queued intent the pointer (a steer:
 * `controlInputs`) still names records the mapped status; one it no longer
 * names keeps the real observation as `Superseded` (CTL-05, A7). The kind
 * pairing is the CD-2 codec rule (7.4 → illegal/invalid).
 */
function onObserved(state: ControlIntentState, event: ObservedEvent, ctx: ControlGuardContext): ControlTransition {
  switch (state.node) {
    case 'Absent':
      return reject('illegal', 'not_found', 'the control intent does not exist');
    case 'Queued':
    case 'Applied':
    case 'Superseded':
    case 'OutcomeUnknown': {
      const kind = state.kind;
      if (kind === null) return reject('illegal', 'invalid', 'a recorded control intent must have a kind');
      const answered = observedIntentAnswer(state, event, ctx);
      if (answered !== null) return answered;
      const failed = firstFailing(OBSERVED_RUN_GUARDS, event, ctx);
      if (failed !== null) return failed;
      const stillNamed = kind === 'steer' ? ctx.run.inControlInputs : ctx.run.pointsHere;
      const status = stillNamed ? observationStatusFor(event.observation.kind) : 'superseded';
      const revision = state.revision + 1;
      if (!Number.isSafeInteger(revision)) {
        return reject('illegal', 'invalid', 'the control intent revision would not be a safe integer');
      }
      const pairing = observationPairingProblem(kind, event.observation);
      if (pairing !== null) return reject('illegal', 'invalid', pairing);
      return accept<ControlIntentState, ControlIntentEffect>(
        { node: nodeOfStatus(status), kind, revision, observation: event.observation },
        [{ kind: 'guard_run' }],
      );
    }
    default: return unreachable(state.node, 'control node');
  }
}

/**
 * CTL-04 (D-8): an older queued intent superseded in the newer commit, with
 * the platform's `platform_superseded` observation naming the newer intent
 * (a), or the cancel that ends the Run for a queued steer (b). The intent is
 * the one the pre-commit pointer names (a steer: one `controlInputs` lists);
 * the commit guards its revision. No other effect.
 */
function onSupersededByNewer(state: ControlIntentState, event: SupersededEvent, ctx: ControlGuardContext): ControlTransition {
  switch (state.node) {
    case 'Queued': {
      const kind = state.kind;
      if (kind === null) return reject('illegal', 'invalid', 'a recorded control intent must have a kind');
      if (!(kind === 'steer' ? ctx.run.inControlInputs : ctx.run.pointsHere)) {
        return reject('illegal', 'invalid', 'only the intent the newer commit moves off the Run pointer, or a queued steer of the Run, is superseded');
      }
      const revision = state.revision + 1;
      if (!Number.isSafeInteger(revision)) {
        return reject('illegal', 'invalid', 'the control intent revision would not be a safe integer');
      }
      const observation: ControlPlatformObservationV1 = {
        schemaVersion: 1, origin: 'platform_superseded', kind: 'superseded_by_newer', runRevision: event.runRevision,
        detail: { supersededBy: event.supersededBy }, observedAt: event.observedAt,
      };
      return accept<ControlIntentState, ControlIntentEffect>({ node: 'Superseded', kind, revision, observation });
    }
    case 'Absent':
    case 'Applied':
    case 'Superseded':
    case 'OutcomeUnknown':
      return reject('illegal', 'invalid', 'only a queued control intent can be superseded');
    default: return unreachable(state.node, 'control node');
  }
}

/** CTL-10 (新增): a queued cancel applied by the platform stop of a paused Turn (§6 RUN-23). */
function onAppliedPausedStop(state: ControlIntentState): ControlTransition {
  switch (state.node) {
    case 'Queued':
      return state.kind === 'cancel'
        ? notYet('CTL-10')
        : reject('illegal', 'invalid', 'only a queued cancel can be applied by a paused stop');
    case 'Absent':
    case 'Applied':
    case 'Superseded':
    case 'OutcomeUnknown':
      return reject('illegal', 'invalid', 'only a queued cancel can be applied by a paused stop');
    default: return unreachable(state.node, 'control node');
  }
}

/** CTL-07 / CTL-08 (新增): startup reconcile and late evidence of an unknown Run. */
function onReconciled(state: ControlIntentState): ControlTransition {
  switch (state.node) {
    case 'Queued':
      return notYet('CTL-08');
    case 'OutcomeUnknown':
      return notYet('CTL-07');
    case 'Applied':
    case 'Superseded':
      return reject('illegal', 'invalid', 'the control intent is already terminal; reconcile skips it');
    case 'Absent':
      return reject('illegal', 'invalid', 'reconcile only settles a recorded control intent');
    default: return unreachable(state.node, 'control node');
  }
}

export function transitionControlIntent(
  state: ControlIntentState,
  event: ControlIntentEvent,
  ctx: ControlGuardContext,
): ControlTransition {
  switch (event.type) {
    case 'control_submitted':
    case 'control_applied_not_entered':
      return onSubmission(state, event, ctx);
    case 'control_superseded_by_newer': return onSupersededByNewer(state, event, ctx);
    case 'control_observed': return onObserved(state, event, ctx);
    case 'control_applied_paused_stop': return onAppliedPausedStop(state);
    case 'control_reconciled': return onReconciled(state);
    default: return unreachable(event, 'control intent event');
  }
}
