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
 * A.2 step 2 (§15.2) scope:
 * - CTL-01, CTL-03, CTL-05, CTL-06, CTL-09 keep TODAY's externally visible
 *   result (`control-service.ts:358-432`, `:520-612`; codec pairing
 *   `control-record-codecs.ts:390-407`). Their 改造 targets (Goal and RD-8
 *   submit guards, CD-2 pairing for Kernel observations, the terminal-state
 *   guard of CTL-09) are flipped in step 5.1; the C4 paused-interrupted
 *   reason of the ended-Run refusal in step 5.6.
 * - The 新增 rows (CTL-02, CTL-04, CTL-07, CTL-08, CTL-10) keep their events in
 *   the union but still return `illegal` (`notYet`), so step 5 only adds rows.
 *
 * A.2 step 3 routes `control-service.ts` through this file (CTL-01 for
 * `submitControl`, CTL-03/05/06 for `recordControlObservation`). The service
 * asks `submissionReadsPointerIntent` before it reads the intent the pointer
 * names and `observedIntentProblem` before it reads the Run, so each read
 * happens exactly where it always did; a stored locator that fails the locator
 * codec reaches the guards as `'malformed'` and keeps today's place in the order.
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

export type ControlIntentEvent =
  /** U/P (§7.2): R1–R4, G7. `intentRef` is derived by the service from the request identity. */
  | { type: 'control_submitted'; target: 'run' | 'query_run'; intentRef: ControlIntentRef;
      kind: ControlIntentKindV1; reason: string | null }
  /** P, CTL-02 (D-7): submitted and applied in one commit because the Run never entered. */
  | { type: 'control_applied_not_entered'; intentRef: ControlIntentRef; kind: 'pause' | 'cancel' | 'resume';
      reason: string | null; entryPhase: 'none' | 'authorized' | 'revoked'; runRevision: number; observedAt: string }
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
  /** The same commit moves `Run.controlState` or appends to `Run.controlInputs` (RUN-12..15). */
  | { kind: 'run_pointer'; change: RunPointerChange }
  /** The Run is only a CAS guard of the commit; it is never written (`control-service.ts:602-610`). */
  | { kind: 'guard_run' }
  /** CTL-04 (step 5): an older queued intent becomes `Superseded` in the same commit, CAS-guarded. */
  | { kind: 'supersede_intent'; intentRef: ControlIntentRef; supersededBy: ControlIntentRef };

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
 * §6 RUN-12..15: the Run pointer after one accepted submission. pause/cancel/
 * resume move `controlState` to the new intent; a steer leaves the pointer and
 * only appends to `controlInputs` (`control-service.ts:411-413`). Which older
 * queued intent the move supersedes is CTL-04 (step 5), not this function.
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
 * CTL-01's submission checks after the ended-Run refusal, in today's order
 * (`control-service.ts:392-399`): a steer needs its directional text; a resume
 * of a Run that did not yield, with a pointer, needs that pointer to name an
 * applied, observed pause; then `controlSubmitProblem`. The ONE copy of these
 * checks: `transitionControlIntent` (CTL-01) and run-machine's RUN-09..15 both
 * answer a submission with it, so the step 5.1 flips (D-9 Goal guard, RD-8
 * consumed-continuation guard) are made here once and the Run record and the
 * intent record cannot disagree about whether a submission is legal.
 */
export function controlSubmissionProblem(input: {
  kind: ControlIntentKindV1; reason: string | null; pointer: RunControlPointer;
  /** A `YieldedWait` Run: its queued pause is the continuation fence, not an observed pause. */
  yielded: boolean;
  pointerIntent: ControlPointerIntent | null;
}): CoreRejection | null {
  if (input.kind === 'steer' && (input.reason === null || input.reason.trim().length === 0)) {
    return { status: 'rejected', code: 'invalid', reason: 'steer requires the actual directional input text' };
  }
  if (resumeNeedsPointerIntent(input.kind, input.yielded, input.pointer)) {
    const pause = input.pointerIntent;
    if (pause === null || pause.kind !== 'pause' || pause.status !== 'applied' || pause.observed !== 'paused') {
      return busy('resume requires an observed paused original Turn');
    }
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
 * enforces it today (`control-record-codecs.ts:390-407`): paused/resumed/
 * steered/cancelled belong to their own kind; a platform observation may close
 * any kind with superseded_by_newer, terminal_without_cancel or outcome_unknown
 * (CD-2). A Kernel cancelled, terminal_without_cancel or outcome_unknown still
 * belongs only to a cancel until step 5.1 relaxes it with CTL-03/CTL-06.
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
    case 'cancelled':
      if (intentKind === 'cancel') return null;
      return isPlatformObservation(observation)
        ? 'a cancelled observation must belong to a cancel intent'
        : 'a cancelled/unknown observation must belong to a cancel intent';
    case 'superseded_by_newer':
    case 'terminal_without_cancel':
    case 'outcome_unknown':
      if (intentKind === 'cancel' || isPlatformObservation(observation)) return null;
      return 'a cancelled/unknown observation must belong to a cancel intent';
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
type ObservedEvent = Extract<ControlIntentEvent, { type: 'control_observed' }>;
type GuardRow<E, C = ControlGuardContext> = { row: string; check(event: E, ctx: C): Rejected | null };

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
 * CTL-01 guards in today's order (`control-service.ts:96`, `:363-399`); the
 * first failing row answers. The rows on the target Run come first: only a
 * submission past them reads the intent the pointer names. Step 5.1 adds the
 * D-9 Goal guard and the RD-8 consumed-continuation guard inside
 * `controlSubmissionProblem` (shared with run-machine), and the C4
 * paused-interrupted reason to the ended-Run row.
 */
const SUBMIT_TARGET_GUARDS: readonly GuardRow<SubmitEvent>[] = [
  { row: '7.4 QueryRunRef', check: event => event.target === 'query_run'
    ? reject('illegal', 'invalid', 'the control submission requires a complete RunRef') : null },
  { row: 'Run read', check: (_event, ctx) => runControlClassOf(ctx.run.node) === 'missing'
    ? reject('illegal', 'not_found', 'the target Run does not exist') : null },
  { row: '7.4 stale Run pin', check: (_event, ctx) => ctx.pinsMatch.run
    ? null : reject('stale', 'revision_conflict', 'the Run changed since the caller read it') },
  { row: '7.4 Run ended', check: (_event, ctx) => runControlClassOf(ctx.run.node) === 'ended'
    ? reject('illegal', 'busy', 'the Run already ended; no new control intent is accepted') : null },
];
const SUBMIT_GUARDS: readonly GuardRow<SubmitEvent>[] = [
  ...SUBMIT_TARGET_GUARDS,
  { row: '7.4 steer text, resume needs applied pause, pointer fence', check: (event, ctx) => {
    const problem = controlSubmissionProblem({ kind: event.kind, reason: event.reason, pointer: ctx.run.pointer,
      yielded: runControlClassOf(ctx.run.node) === 'yielded', pointerIntent: ctx.pointerIntent });
    return problem === null ? null : reject('guard_failed', problem.code, problem.reason);
  } },
];

/**
 * Whether CTL-01 answers this submission only with the intent `Run.controlState`
 * names (`control-service.ts:393-397`): the rows on the target Run passed and
 * it is a resume of a Run that did not yield, with a pointer. The service reads
 * that intent exactly then, so the read happens where it always did and a
 * refused earlier row never reads it; every other submission is answered with
 * `pointerIntent: null`.
 */
export function submissionReadsPointerIntent(
  event: Extract<ControlIntentEvent, { type: 'control_submitted' }>, ctx: ControlGuardContext,
): boolean {
  return firstFailing(SUBMIT_TARGET_GUARDS, event, ctx) === null
    && resumeNeedsPointerIntent(event.kind, runControlClassOf(ctx.run.node) === 'yielded', ctx.run.pointer);
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
];

function firstFailing<E, C>(rows: readonly GuardRow<E, C>[], event: E, ctx: C): Rejected | null {
  for (const guard of rows) {
    const failed = guard.check(event, ctx);
    if (failed !== null) return failed;
  }
  return null;
}

/**
 * CTL-03's rows on the intent itself (`control-service.ts:525-528`): the
 * caller's intent pin. The service asks them after the intent read and before
 * it reads the Run, so a stale intent never reads the Run;
 * `transitionControlIntent` asks them again, first.
 */
export function observedIntentProblem(
  event: Extract<ControlIntentEvent, { type: 'control_observed' }>, ctx: Pick<ControlGuardContext, 'pinsMatch'>,
): Rejected | null {
  return firstFailing(OBSERVED_INTENT_GUARDS, event, ctx);
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

/** CTL-01 (today's result; CTL-02 for not-entered Runs is step 5). */
function onSubmitted(state: ControlIntentState, event: SubmitEvent, ctx: ControlGuardContext): ControlTransition {
  switch (state.node) {
    case 'Absent': {
      const failed = firstFailing(SUBMIT_GUARDS, event, ctx);
      if (failed !== null) return failed;
      return accept<ControlIntentState, ControlIntentEffect>(
        { node: 'Queued', kind: event.kind, revision: 1, observation: null },
        [{ kind: 'run_pointer', change: pointerAfterSubmit(event.kind, event.intentRef) }],
      );
    }
    case 'Queued':
    case 'Applied':
    case 'Superseded':
    case 'OutcomeUnknown':
      return existingIdentity();
    default: return unreachable(state.node, 'control node');
  }
}

/**
 * CTL-03 / CTL-05 / CTL-06 with today's result for every recorded node: the
 * service does not yet check the intent status (CTL-09 is step 5.1), so a new
 * observation identity at the current pins re-observes an applied, superseded
 * or outcome_unknown intent. A pointer that no longer names the intent keeps
 * the real observation as `Superseded` (CTL-05, A7). The kind pairing is the
 * codec rule the commit enforces today (7.4 → illegal/invalid).
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
      const failed = observedIntentProblem(event, ctx) ?? firstFailing(OBSERVED_RUN_GUARDS, event, ctx);
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
 * CTL-02 (新增): `∅ → applied@2` for a Run that never entered (D-7, CD-3).
 * Until step 5 the whole event is illegal; only the §7.4 internal assertion
 * for an entered Run is final. The CTL-01-style identity answer for an
 * existing intent arrives with the CTL-02 row in step 5.1.
 */
function onAppliedNotEntered(
  state: ControlIntentState, ctx: ControlGuardContext,
): ControlTransition {
  switch (state.node) {
    case 'Absent':
      if (runControlClassOf(ctx.run.node) === 'entered') {
        return reject('illegal', 'invalid', 'from Entering on only the Kernel, RUN-23 or reconcile can apply a control (D-7)');
      }
      return notYet('CTL-02');
    case 'Queued':
    case 'Applied':
    case 'Superseded':
    case 'OutcomeUnknown':
      return notYet('CTL-02');
    default: return unreachable(state.node, 'control node');
  }
}

/** CTL-04 (新增): an older queued intent superseded in the newer commit (D-8). */
function onSupersededByNewer(state: ControlIntentState): ControlTransition {
  switch (state.node) {
    case 'Queued':
      return notYet('CTL-04');
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
    case 'control_submitted': return onSubmitted(state, event, ctx);
    case 'control_applied_not_entered': return onAppliedNotEntered(state, ctx);
    case 'control_superseded_by_newer': return onSupersededByNewer(state);
    case 'control_observed': return onObserved(state, event, ctx);
    case 'control_applied_paused_stop': return onAppliedPausedStop(state);
    case 'control_reconciled': return onReconciled(state);
    default: return unreachable(event, 'control intent event');
  }
}
