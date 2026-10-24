/**
 * R4.1 durable Run control service (implementation).
 *
 * This is the ONE raw control service the composition root owns. `submitControl`
 * accepts a trusted Host pause/cancel/resume/steer request and atomically
 * commits an immutable `ControlIntentSnapshot@1`, the Run's canonical
 * `controlState` pointer and a `ControlIntentSubmitted` replay event in ONE
 * RecordStore transaction. On a Run that entered (or a yielded wait) the
 * intent is queued: a durable receipt, never a paused/stopped conclusion, that
 * releases nothing and delivers no signal. On a Run that never entered the
 * platform applies a pause, cancel or resume itself (D-7): the intent is
 * `applied@2`, and a cancel ends the Run and releases its Attempt, Outbox,
 * Lease and Session occupancy in the same commit. A still-queued older pointer
 * intent is superseded in the same commit (D-8). The Goal fan-out (A.2 step
 * 5.5, §2.3) adds a Goal fence to `meta.expected` (a read-only Goal CAS) and
 * finds its deterministic intents through `controlIntentRefFor`.
 *
 * `readControl` reads the intent by its exact ref. It never reloads the Run,
 * Role, Session or materials, and a historical intent stays readable after the
 * Run ended or a newer intent superseded it.
 *
 * A lost commit acknowledgement is recovered from the real receipt by the
 * stable identity+fingerprint. Only a real lookup that finds the recorded event
 * returns `committed`/`replayed`; when the receipt cannot be read the result is
 * `unavailable` ("unknown"), never "did not commit".
 *
 * Both writes are decided by the pure machines (STATE-MACHINES-SPEC §7, §6,
 * §5, §8): a submission by CTL-01/CTL-02 (`state/control-intent-machine.ts`),
 * whose `run_pointer` effect the Run machine applies as RUN-09..15
 * (`state/run-machine.ts`); the Run's `intent:control_superseded_by_newer`
 * effects by CTL-04, its claim effects by the Attempt, Lease, Outbox and
 * Session machines; an observation by CTL-03/05/06/09, whose only effect keeps
 * the Run a CAS guard. This file keeps the request shape, the scope checks,
 * the receipt lookups and the reads in their order (`submissionReadsPointerIntent`,
 * `submissionReadsGoal`, `observedIntentAnswer`); the refusals past them, the
 * snapshots and the next Run come from the machines.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type {
  ControlIntentKindV1, ControlIntentRef, ControlIntentSnapshotV1, SubmitControlInput, SubmittedControl,
} from '../../../contracts/control-intent.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import { rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalJson, canonicalOf, sameJson as sameRef, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import { isPos as isPositiveSafeInteger } from '../../../contracts/validation/common.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt,
} from '../../record-store/ports.js';
import {
  CONTROL_INTENT_EVENT_SCHEMA_VERSION, CONTROL_INTENT_OBSERVED_EVENT_SCHEMA_VERSION,
  CONTROL_INTENT_OBSERVED_EVENT_TYPE, CONTROL_INTENT_SNAPSHOT_SCHEMA_ID, CONTROL_INTENT_SUBMITTED_EVENT_TYPE,
  controlIntentObservedEventFromEvent, controlIntentSubmittedEventFromEvent,
  controlObservationProblem, decodeControlIntentSnapshot, encodeControlIntentObservedEvent,
  encodeControlIntentSnapshot, encodeControlIntentSubmittedEvent,
  type ControlIntentObservedEvent, type ControlIntentSubmittedEvent,
} from '../persistence/control-record-codecs.js';
import { isRunExecutionHistoryV1 } from '../persistence/execution-history-codecs.js';
import { isExecutionAuthorizationV2 } from '../persistence/execution-entry-codecs.js';
import { plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import { attemptEventFromRunEvent, type AttemptGuardContext } from '../state/attempt-machine.js';
import {
  controlIntentRecordOf, controlIntentRequestOf, controlIntentStateOf, newControlIntentRequest, notEnteredEntryPhase,
  observationPairingProblem, observedIntentAnswer, submissionReadsGoal, submissionReadsPointerIntent, transitionControlIntent,
  type ControlGuardContext, type ControlIntentEffect, type ControlIntentEvent, type ControlPointerIntent,
  type ControlSubmissionEvent,
} from '../state/control-intent-machine.js';
import {
  controlSubmissionRunEvent, isPausedInterrupted, runControlNodeOf, runStateOf, transitionRun,
  type RunEffect, type RunGuardContext,
} from '../state/run-machine.js';
import type { SessionGuardContext, SessionRelease } from '../state/session-availability.js';
import type { TransitionRejectReason } from '../state/transition.js';
import { dispatchOutboxRefKey, taskAttemptRefKey } from './claim-record-codecs.js';
import {
  bindTrustedContext, checkRunPin, claimEffectRecords, claimLeaseOf, claimSessionOf, isRecord, isolateWrite,
  loadReplayEvent, mapStoreFailure, mergeGuards, nonEmpty,
} from './execution-entry-service.js';
import type { TaskExecutionRecord } from '../model/execution-read-contracts.js';
import type {
  ControlObservationPort, RecordControlObservationInput, RunControlPort, RunControlServiceDependencies,
} from './control-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import { readGoal } from './plan-readers.js';

type HostActor = { kind: 'human' | 'system'; id: string };
type Records = GoalRecordTransactionPort;
type LoadedRun = { ok: true; value: RunSnapshot | null } | { ok: false; rejection: CoreRejection };
type SubmittedRunEvent = ReturnType<typeof controlSubmissionRunEvent>;
type ObservedIntentEvent = Extract<ControlIntentEvent, { type: 'control_observed' }>;
type Refused = { reason: TransitionRejectReason; code: CoreError; detail: string };

const CONTROL_SUBMIT_PREFIX = 'r4-control-submit:';
const CONTROL_OBSERVATION_PREFIX = 'r4-control-observation:';
const RUN_SNAPSHOT_SCHEMA_ID = 'RunSnapshot@1';
const MAX_CONTROL_REASON_BYTES = 2048;

// -------------------------------------------------------------------------- //
// Small pure helpers                                                          //
// -------------------------------------------------------------------------- //

function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return rejectedWithCurrent(code, reason, current);
}
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function notFound(reason: string): CoreRejection { return reject('not_found', reason); }
function cancelled(reason: string): CoreRejection { return reject('cancelled', reason); }

function isRunRef(value: unknown): value is RunRef {
  return isRecord(value) && value['aggregateType'] === 'Run' && nonEmpty(value['projectId'])
    && nonEmpty(value['goalId']) && nonEmpty(value['runId']);
}
function controlIntentRefProblem(value: unknown): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'ControlIntent' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['intentId'])) {
    return 'the control intent ref must be a complete ControlIntentRef';
  }
  return null;
}
function reasonProblem(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0) return 'the control reason must be null or a non-empty string';
  if (Buffer.byteLength(value, 'utf8') > MAX_CONTROL_REASON_BYTES) return 'the control reason exceeds 2048 UTF-8 bytes';
  return null;
}
function submitControlInputProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'a control submission requires an input object';
  if (Object.keys(value).some(key => key !== 'runRef' && key !== 'kind' && key !== 'reason')) {
    return 'the control submission carries unknown fields';
  }
  if (!isRunRef(value['runRef'])) return 'the control submission requires a complete RunRef';
  if (value['kind'] !== 'pause' && value['kind'] !== 'cancel'
    && value['kind'] !== 'resume' && value['kind'] !== 'steer') {
    return 'the control kind must be pause, cancel, resume or steer';
  }
  return reasonProblem(value['reason']);
}

function identityDigest(actor: HostActor, projectId: string, workspaceId: string, requestId: string): string {
  return sha256Hex(canonicalJson({
    actor: { kind: actor.kind, id: actor.id }, projectId, workspaceId, requestId,
  } as unknown as JsonValue));
}

/**
 * The ControlIntentRef `submitControl` mints for this actor, scope and
 * requestId (§2.3 扇出身份与重驱协议): the Goal fan-out computes the intent of
 * a deterministic requestId and reads it before it submits again, because a
 * same-identity resubmission with a newer Run pin would be an
 * `idempotency_conflict`, not the original receipt.
 */
export function controlIntentRefFor(
  actor: HostActor, scope: { projectId: string; workspaceId: string }, requestId: string,
): ControlIntentRef {
  return { aggregateType: 'ControlIntent', projectId: scope.projectId, workspaceId: scope.workspaceId,
    intentId: identityDigest(actor, scope.projectId, scope.workspaceId, requestId) };
}

/**
 * `meta.expected` of a submission: the Run pin, and optionally a Goal fence
 * (GOAL-09..14): the Run's Goal at the revision the caller read, a read-only
 * CAS of the commit, so a slow fan-out of an old epoch never lands after the
 * Goal moved on (§2.4 "扇出提交 | Goal fence 过期").
 */
function checkControlPins(
  expected: readonly VersionPin[], runRef: RunRef,
): { ok: true; runPin: VersionPin; goalFence: VersionPin | null } | { ok: false; rejection: CoreRejection } {
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: runRef.projectId, goalId: runRef.goalId };
  const goalFence = expected.find(pin => isRecord(pin) && isRecord(pin.ref) && sameRef(pin.ref, goalRef));
  if (goalFence === undefined) {
    const checked = checkRunPin(expected, runRef);
    return checked.ok ? { ok: true, runPin: checked.pin, goalFence: null } : checked;
  }
  const checked = checkRunPin(expected.filter(pin => pin !== goalFence), runRef);
  if (!checked.ok) return checked;
  if (typeof goalFence.revision !== 'number' || !Number.isSafeInteger(goalFence.revision) || goalFence.revision < 1) {
    return { ok: false, rejection: invalid('the Goal fence must be a positive safe revision') };
  }
  return { ok: true, runPin: checked.pin, goalFence: { ref: goalRef, revision: goalFence.revision } };
}
function fingerprintOf(value: unknown): string {
  return sha256Hex(canonicalJson(value as JsonValue));
}
function refKeyOf(value: object): string | null {
  return canonicalOf(value);
}
function encodeRun(run: RunSnapshot): EncodedRecord {
  return { refKey: refKeyOf(run.ref) as string, schemaId: RUN_SNAPSHOT_SCHEMA_ID,
    revision: run.revision, json: JSON.stringify(run) };
}

// -------------------------------------------------------------------------- //
// Control and Run machine facts (STATE-MACHINES-SPEC §7.1, §6.1)              //
// -------------------------------------------------------------------------- //

/**
 * §7.1's guard context from one Run read (`null`: the Run does not exist, which
 * the machines' Run read row refuses), for the intent `intentRef`: the node as
 * a control reads it (`runControlNodeOf`), the canonical pointer and steer
 * list, whether a successor Run consumed a yielded wait's continuation (RD-8),
 * the formal V2 entry identity and the persisted history locator. The intent the pointer
 * names and the Goal (D-9) are added only for the submissions that read them;
 * the Kernel pause and the exit proof belong to other events.
 */
function controlContext(
  run: RunSnapshot | null, intentRef: ControlIntentRef, pinsMatch: ControlGuardContext['pinsMatch'],
  continuationConsumed = false,
): ControlGuardContext {
  const auth = run?.executionAuthorization;
  const locator = run?.executionHistory;
  return {
    run: {
      node: run === null ? 'Absent' : runControlNodeOf(run),
      pointer: runStateOf(run).pointer,
      pointsHere: run?.controlState !== undefined && sameRef(run.controlState.intentRef, intentRef),
      inControlInputs: (run?.controlInputs ?? []).some(ref => sameRef(ref, intentRef)),
      continuationConsumed,
      kernelPaused: false,
      pausedInterrupted: run !== null && isPausedInterrupted(run),
      entry: isExecutionAuthorizationV2(auth)
        ? { consumerId: auth.consumerId, entryGeneration: auth.generation, sessionGeneration: auth.sessionGeneration }
        : null,
      history: locator === undefined ? null : isRunExecutionHistoryV1(locator) ? locator : null,
    },
    goal: { desiredState: 'active' },
    pointerIntent: null,
    pinsMatch,
    exitProof: null,
    origin: 'live',
  };
}

/** The shape §7 CTL-01 and §6 RUN-09..15 read of the intent the pointer names. */
function pointerIntentOf(intent: ControlIntentSnapshotV1): ControlPointerIntent {
  return { kind: intent.kind, status: intent.status, observed: intent.status === 'queued' ? null : intent.observation.kind };
}

/**
 * Whether a submission reads the execution in one window (Run, Attempt,
 * Outbox, Plan, Session, Lease), whose Run then replaces the exact load: a
 * cancel of a Run that never entered ends its claim's records (RUN-09), and a
 * yielded wait answers by its Lease (RD-8).
 */
function readsExecution(run: RunSnapshot, kind: ControlIntentKindV1): boolean {
  const node = runControlNodeOf(run);
  return node === 'YieldedWait' || (kind === 'cancel' && notEnteredEntryPhase(node) !== null);
}

/** RD-8: the successor Run that consumed a yielded wait's continuation re-held the Task Lease (`claim-service.ts:614-618`). */
function continuationConsumedOf(facts: TaskExecutionRecord): boolean {
  return runControlNodeOf(facts.run) === 'YieldedWait' && facts.lease !== null && facts.lease.holderRunId !== facts.run.ref.runId;
}

/**
 * The §7 event of one submission on this Run read (D-7): a pause, cancel or
 * resume of a Run that never entered is applied at once (CTL-02, `∅ →
 * applied@2`, naming the Run revision the same commit writes); every other one
 * is queued (CTL-01). The Run machine routes it by the same node
 * (`controlSubmissionRunEvent`).
 */
function submissionEventOf(
  run: RunSnapshot | null, intentRef: ControlIntentRef, input: SubmitControlInput, observedAt: string,
): ControlSubmissionEvent {
  const entryPhase = run === null ? null : notEnteredEntryPhase(runControlNodeOf(run));
  if (run === null || entryPhase === null || input.kind === 'steer') {
    return { type: 'control_submitted', target: 'run', intentRef, kind: input.kind, reason: input.reason };
  }
  return { type: 'control_applied_not_entered', intentRef, kind: input.kind, reason: input.reason, entryPhase,
    runRevision: run.revision + 1, observedAt };
}

/**
 * RUN-09..15's guard context: the claim Session, Lease and persisted claim of
 * the execution window when one was read (RUN-09), the Goal, the intent the
 * pointer names, the queued steers and the consumed continuation the
 * submission read. Entry, reconcile and claim facts belong to other Run events.
 */
function submissionRunContext(
  controlCtx: ControlGuardContext, facts: TaskExecutionRecord | null, steers: readonly ControlIntentSnapshotV1[],
  actor: HostActor,
): RunGuardContext {
  const claim = facts?.outbox.claim ?? null;
  return {
    session: facts === null || claim === null ? { usable: true, owned: false, kernel: null } : claimSessionOf(facts.session, claim),
    lease: facts === null || claim === null ? 'missing' : claimLeaseOf(facts.lease, claim),
    persistedClaim: claim,
    goal: { desiredState: controlCtx.goal.desiredState, activePlanMatchesClaim: true }, entryPlan: 'active_plan',
    continuationBrief: 'absent_ok', freshAdmission: null, pointerIntent: controlCtx.pointerIntent,
    queuedSteers: steers.map(steer => steer.ref), continuationConsumed: controlCtx.run.continuationConsumed,
    exitProof: null, hostLease: null, kernelProbe: null, kernelPaused: false, inputsConfirmed: null,
    actor: isAutomationActor(actor) ? 'system' : 'human', claim: null,
  };
}

/**
 * The accepted §7 decision as the next Run: its one `run_pointer` effect is
 * the Run owner's RUN-09..15 (§6), which re-asks the ended check and
 * `controlSubmissionProblem` CTL-01/02 just passed with the same facts, so it
 * cannot refuse here, and names this intent with the matching event.
 */
function submittedRunOf(
  run: RunSnapshot, runEvent: SubmittedRunEvent, submitted: ControlSubmissionEvent,
  effects: readonly ControlIntentEffect[], runCtx: RunGuardContext,
): { next: RunSnapshot; effects: readonly RunEffect[] } {
  const [effect, ...extra] = effects;
  if (effect?.kind !== 'run_pointer' || extra.length > 0) {
    throw new Error('a control submission moves the Run pointer or steer list exactly once');
  }
  const moved = transitionRun(runStateOf(run), runEvent, runCtx);
  if (!moved.ok) throw new Error(`RUN-09..15 refused a submission CTL-01/02 accepted: ${moved.detail}`);
  const named = moved.effects.filter(runEffect => runEffect.kind === 'intent' && runEffect.event === submitted.type
    && sameRef(runEffect.intentRef, submitted.intentRef));
  if (moved.next.record === null || named.length !== 1 || moved.next.record.revision !== run.revision + 1) {
    throw new Error('a control submission writes the Run once, naming its own intent');
  }
  return { next: moved.next.record, effects: moved.effects };
}

/** SES-05's guard context: the stopped Run never entered, so there is no Kernel Turn and nothing to confirm. */
function notEnteredReleaseContext(release: SessionRelease): SessionGuardContext {
  return {
    caller: 'service', hostLease: null, pin: null,
    holder: { ref: release.holder, claimGeneration: release.generation, before: 'run_starting', after: 'run_ended',
      kernelTurnSeen: false, inputsConfirmed: true, historyBoundaryCursor: null, kernelTurnOpen: false },
    probe: null, kernelHeader: null, openResponsibleLink: null, creation: null, link: null,
  };
}

/**
 * RUN-09's claim records (ATT-05, ATT-23, ATT-30, SES-05), each by its own
 * machine through the shared `claimEffectRecords`, with the guards of every
 * record the stop reads to decide them (§6.6: Attempt, Outbox, Session, Lease
 * at the revisions read).
 */
function stoppedClaimRecords(
  run: RunSnapshot, facts: TaskExecutionRecord, effects: readonly RunEffect[], runCtx: RunGuardContext,
  endedAt: string, eventId: string,
): { ok: true; records: EncodedRecord[]; guards: RecordGuard[] } | { ok: false; rejection: CoreRejection } {
  const claim = facts.outbox.claim;
  const auth = run.executionAuthorization;
  const attemptEvent = attemptEventFromRunEvent({ kind: 'stop_not_entered', claim, endOutcome: 'cancelled', endedAt, eventId,
    sequence: null, entry: isExecutionAuthorizationV2(auth) ? { consumerId: auth.consumerId, entryGeneration: auth.generation } : null,
    turnStartedAt: null });
  if (attemptEvent === null) throw new Error('stop_not_entered ends the TaskAttempt');
  const pairing: AttemptGuardContext = { runNode: runControlNodeOf(run), runLastEventSeq: run.lastEventSeq,
    ownsSession: runCtx.session.owned, ownsLease: runCtx.lease === 'owned' };
  const written = claimEffectRecords(effects, facts, pairing, attemptEvent,
    { cause: 'stop_not_entered', context: notEnteredReleaseContext });
  if (!written.ok) return written;
  const guards: RecordGuard[] = [
    { refKey: taskAttemptRefKey(facts.attempt.ref), expectedRevision: facts.attempt.revision },
    { refKey: dispatchOutboxRefKey(facts.outbox.ref), expectedRevision: facts.outbox.revision },
    { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(claim.sessionRef)), expectedRevision: facts.session.revision },
    ...(facts.lease === null ? [] : [{ refKey: refKeyOf(facts.lease.ref) as string, expectedRevision: facts.lease.revision }]),
  ];
  return { ok: true, records: written.records, guards };
}

/**
 * A machine refusal as the rejection today's service returned (§1.2: code and
 * reason kept); a stale pin also names the current revision it lost to.
 */
function refusalOf(refused: Refused, current: VersionPin | null): CoreRejection {
  return reject(refused.code, refused.detail,
    refused.reason === 'stale' && current !== null ? [{ ref: current.ref, revision: current.revision }] : undefined);
}

/**
 * Exact Run load through the SHARED authority; no Role/Session/material chain.
 * An absent Run is `null`: CTL-01/CTL-03's Run read row refuses it.
 */
async function loadRun(deps: RunControlServiceDependencies, runRef: RunRef): Promise<LoadedRun> {
  let result;
  try {
    result = await deps.authority.load(runRef);
  } catch (error) {
    return { ok: false, rejection: unavailable(`the Run read failed: ${messageOf(error)}`) };
  }
  if (result.status === 'not_found') return { ok: true, value: null };
  if (result.status === 'unavailable') return { ok: false, rejection: unavailable(result.reason) };
  const snapshot = result.snapshot as unknown;
  if (!isRecord(snapshot) || !isRecord(snapshot['ref']) || snapshot['ref']['aggregateType'] !== 'Run'
    || !sameRef(snapshot['ref'], runRef)) {
    return { ok: false, rejection: unavailable('the Run read returned a different aggregate') };
  }
  return { ok: true, value: snapshot as unknown as RunSnapshot };
}

// -------------------------------------------------------------------------- //
// R4.3a observation write helpers                                             //
// -------------------------------------------------------------------------- //

function recordControlObservationInputProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'a control observation requires an input object';
  if (Object.keys(value).some(key => key !== 'intentRef' && key !== 'runRef' && key !== 'observation')) {
    return 'the control observation carries unknown fields';
  }
  const refProblem = controlIntentRefProblem(value['intentRef']);
  if (refProblem !== null) return refProblem;
  if (!isRunRef(value['runRef'])) return 'the control observation requires a complete RunRef';
  return controlObservationProblem(value['observation']);
}
type CheckedObservationPins =
  | { ok: true; intentPin: VersionPin; runPin: VersionPin }
  | { ok: false; rejection: CoreRejection };
function checkObservationPins(
  expected: readonly VersionPin[], intentRef: ControlIntentRef, runRef: RunRef,
): CheckedObservationPins {
  if (expected.length !== 2) {
    return { ok: false, rejection: invalid('meta.expected must contain exactly the intent and Run pins') };
  }
  const intentPin = expected.find(pin => sameRef(pin.ref, intentRef));
  const runPin = expected.find(pin => sameRef(pin.ref, runRef));
  if (intentPin === undefined || runPin === undefined || intentPin === runPin) {
    return { ok: false, rejection: invalid('meta.expected must pin the intent and the Run without extras') };
  }
  if (!isPositiveSafeInteger(intentPin.revision) || !isPositiveSafeInteger(runPin.revision)) {
    return { ok: false, rejection: invalid('the intent and Run pins must be positive safe revisions') };
  }
  return { ok: true, intentPin, runPin };
}
type LoadedIntent =
  | { ok: true; value: ControlIntentSnapshotV1; readThrough: CommitCursor | null }
  | { ok: false; rejection: CoreRejection };
/** Exact intent read by its complete ref; never a scan and never a current-Run re-derivation. */
async function readIntentRecord(records: Records, intentRef: ControlIntentRef): Promise<LoadedIntent> {
  const key = refKeyOf(intentRef);
  if (key === null) return { ok: false, rejection: invalid('the control intent ref is not canonicalizable JSON') };
  let batch;
  try { batch = await records.readMany([key]); }
  catch (error) { return { ok: false, rejection: unavailable(`the control intent read failed: ${messageOf(error)}`) }; }
  if (batch.status !== 'ready') return { ok: false, rejection: mapStoreFailure(batch) };
  const record = batch.value.records.find(candidate => candidate.refKey === key);
  if (record === undefined) {
    return batch.value.missing.includes(key)
      ? { ok: false, rejection: notFound('the control intent does not exist') }
      : { ok: false, rejection: unavailable('the control intent key was neither returned nor missing') };
  }
  const decoded = decodeControlIntentSnapshot(record);
  if (decoded.status !== 'decoded') {
    return { ok: false, rejection: unavailable(`the control intent is damaged: ${decoded.reason}`) };
  }
  return { ok: true, value: decoded.value, readThrough: batch.value.readThrough };
}

/** CTL-04(b): the steers of `controlInputs` still queued, which a not-entered stop supersedes in its commit. */
async function readQueuedSteers(
  records: Records, run: RunSnapshot,
): Promise<{ ok: true; value: ControlIntentSnapshotV1[] } | { ok: false; rejection: CoreRejection }> {
  const queued: ControlIntentSnapshotV1[] = [];
  for (const ref of run.controlInputs ?? []) {
    const steer = await readIntentRecord(records, ref);
    if (!steer.ok) return steer;
    if (steer.value.kind === 'steer' && steer.value.status === 'queued') queued.push(steer.value);
  }
  return { ok: true, value: queued };
}

/** The execution window a submission reads (`readsExecution`); a missing claim-linked record is `incomplete`. */
async function readExecutionFacts(
  deps: RunControlServiceDependencies, ctx: CoreCallContext, runRef: RunRef,
): Promise<{ ok: true; value: TaskExecutionRecord } | { ok: false; rejection: CoreRejection }> {
  let read;
  try {
    read = await deps.reads.readExecution(ctx, runRef);
  } catch (error) {
    return { ok: false, rejection: unavailable(`the execution read failed: ${messageOf(error)}`) };
  }
  if (read.status === 'ready') return { ok: true, value: read.value };
  if (read.status === 'not_found') return { ok: false, rejection: notFound('the target Run does not exist') };
  if (read.status === 'not_ready') {
    return { ok: false, rejection: reject('incomplete', 'the target Run execution is not readable at the required watermark') };
  }
  return { ok: false, rejection: read };
}

/** Restore the exact observed snapshot from the immutable recorded event. */
async function replayObservation(
  records: Records,
  receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
  identity: string,
  fingerprint: string,
  actor: HostActor,
): Promise<WriteResult<ControlIntentSnapshotV1>> {
  const loaded = await loadReplayEvent(records, receipt);
  if (!loaded.ok) return loaded.rejection;
  const decoded = controlIntentObservedEventFromEvent(loaded.event);
  if (decoded.status !== 'decoded') {
    return unavailable(`the recorded control observation is not decodable: ${decoded.reason}`);
  }
  const event = decoded.value;
  if (event.identityKey !== identity || event.fingerprint !== fingerprint) {
    return unavailable('the recorded control observation disagrees with the request identity');
  }
  if (event.actor.kind !== actor.kind || event.actor.id !== actor.id) {
    return unavailable('the recorded control observation belongs to another actor');
  }
  return { status: 'committed', value: event.result, replayed: true, cursor: receipt.cursor };
}

/** Restore the exact original receipt from the immutable recorded event. */
async function replayControl(
  records: Records,
  receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
  identity: string,
  fingerprint: string,
  actor: HostActor,
): Promise<WriteResult<SubmittedControl>> {
  const loaded = await loadReplayEvent(records, receipt);
  if (!loaded.ok) return loaded.rejection;
  const decoded = controlIntentSubmittedEventFromEvent(loaded.event);
  if (decoded.status !== 'decoded') {
    return unavailable(`the recorded control intent event is not decodable: ${decoded.reason}`);
  }
  const event = decoded.value;
  if (event.identityKey !== identity || event.fingerprint !== fingerprint) {
    return unavailable('the recorded control intent disagrees with the request identity');
  }
  if (event.actor.kind !== actor.kind || event.actor.id !== actor.id) {
    return unavailable('the recorded control intent belongs to another actor');
  }
  return { status: 'committed', value: event.submitted, replayed: true, cursor: receipt.cursor };
}

type SameIdentityOutcome =
  | { status: 'receipt'; result: WriteResult<SubmittedControl> }
  | { status: 'absent' }
  | { status: 'failed'; rejection: CoreRejection };

/**
 * Re-query ONE already-known identity+fingerprint WITHOUT committing. This is
 * the narrow shared step behind both the lost-acknowledgement recovery and the
 * delayed same-identity reconcile: only an actually recorded receipt is
 * replayed; a genuine miss is reported as `absent`; any other read failure
 * keeps its real rejection. It never loops and never resubmits.
 */
async function readIdentityReceipt(
  records: Records,
  identity: string,
  fingerprint: string,
  actor: HostActor,
): Promise<SameIdentityOutcome> {
  try {
    const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
    if (lookup.status === 'ready') {
      return { status: 'receipt', result: await replayControl(records, lookup.value, identity, fingerprint, actor) };
    }
    if (lookup.code === 'not_found') return { status: 'absent' };
    return { status: 'failed', rejection: mapStoreFailure(lookup) };
  } catch (error) {
    // The boundary covers BOTH the identity lookup and the recorded-event
    // replay (including the real `eventAt` read). A found receipt whose event
    // cannot be read stays an unknown outcome, never a rejected promise.
    return { status: 'failed', rejection: unavailable(`the original control receipt could not be read: ${messageOf(error)}`) };
  }
}

/**
 * The commit acknowledgement was lost. Only a real lookup that finds the
 * recorded receipt is recovered; any other read outcome stays `unavailable`
 * because the commit result is genuinely unknown (never "did not commit").
 */
async function recoverControl(
  records: Records,
  identity: string,
  fingerprint: string,
  actor: HostActor,
  cause: unknown,
): Promise<WriteResult<SubmittedControl>> {
  const outcome = await readIdentityReceipt(records, identity, fingerprint, actor);
  if (outcome.status === 'receipt') return outcome.result;
  if (outcome.status === 'failed') return outcome.rejection;
  return unavailable(`the control commit result is unknown: ${messageOf(cause)}`);
}

export function createRunControlService(deps: RunControlServiceDependencies): RunControlPort & ControlObservationPort {
  const records = deps.records;

  async function submitControl(
    ctx: CoreCallContext,
    request: GraphWrite<SubmitControlInput>,
  ): Promise<WriteResult<SubmittedControl>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input;
    const inputProblem = submitControlInputProblem(input);
    if (inputProblem !== null) return invalid(inputProblem);
    const checkedPins = checkControlPins(owned.expected, input.runRef);
    if (!checkedPins.ok) return checkedPins.rejection;
    const runPin = checkedPins.runPin;
    const goalFence = checkedPins.goalFence;
    if (signal.aborted) return cancelled('the control request was cancelled before lookup');

    let identity = '';
    let fingerprint = '';
    let intentId = '';
    try {
      intentId = identityDigest(actor, scope.projectId, scope.workspaceId, owned.requestId);
      identity = CONTROL_SUBMIT_PREFIX + intentId;
      fingerprint = fingerprintOf({ kind: 'r4-control-submit', actor: { kind: actor.kind, id: actor.id },
        runRef: input.runRef, control: input.kind, reason: input.reason,
        expected: [{ ref: runPin.ref, revision: runPin.revision },
          ...(goalFence === null ? [] : [{ ref: goalFence.ref, revision: goalFence.revision }])] });
    } catch {
      return invalid('the control request is not canonicalizable JSON');
    }
    const intentRef: ControlIntentRef = { aggregateType: 'ControlIntent',
      projectId: scope.projectId, workspaceId: scope.workspaceId, intentId };

    try {
      const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
      if (lookup.status === 'ready') return await replayControl(records, lookup.value, identity, fingerprint, actor);
      if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
      if (signal.aborted) return cancelled('the control request was cancelled during lookup');

      const loaded = await loadRun(deps, input.runRef);
      if (!loaded.ok) return loaded.rejection;
      let read = loaded.value;
      if (read !== null && read.ref.projectId !== scope.projectId) return forbidden('the target Run belongs to another project');
      if (read !== null && read.workspaceSnapshot.workspaceId !== scope.workspaceId) {
        return forbidden('the target Run belongs to another workspace');
      }
      // A cancel of a Run that never entered ends its claim's records (RUN-09)
      // and a yielded wait answers by its Lease (RD-8): both read the execution
      // in one window, whose Run replaces the exact load.
      let facts: TaskExecutionRecord | null = null;
      if (read !== null && readsExecution(read, input.kind)) {
        const executed = await readExecutionFacts(deps, ownedCtx.ctx, input.runRef);
        if (!executed.ok) return executed.rejection;
        facts = executed.value;
        read = facts.run;
      }
      if (signal.aborted) return cancelled('the control request was cancelled during the execution read');
      // CTL-02 names the instant in its platform observation and RUN-09 ends
      // the Run at it, so the clock is drawn before the decision; the empty
      // check waits for an accepted decision, so a refusal keeps its own code.
      const nowIso = deps.now();
      // CTL-01/CTL-02 on this Run read: an absent Run, the pin, an ended Run (a
      // Run that really yielded on a wait is the ONE ended Run that accepts a
      // formal wait-window control: the queued pause/cancel survives the yield
      // and gates the continuation instead of being lost with the terminal),
      // the D-7 route, a consumed continuation (RD-8), the steer text, the
      // resume rule, the Goal (D-9) and the pointer fence. Only a submission
      // that moves an existing pointer reads the intent it names (resume rule,
      // D-8), and only a resume reads the Goal.
      const submitted = submissionEventOf(read, intentRef, input, nowIso);
      let controlCtx = controlContext(read, intentRef, { intent: true, run: read?.revision === runPin.revision },
        facts !== null && continuationConsumedOf(facts));
      const pointer = read?.controlState;
      let pointerIntent: ControlIntentSnapshotV1 | null = null;
      if (submissionReadsPointerIntent(submitted, controlCtx) && pointer !== undefined) {
        const named = await readIntentRecord(records, pointer.intentRef);
        if (!named.ok) return named.rejection;
        pointerIntent = named.value;
        controlCtx = { ...controlCtx, pointerIntent: pointerIntentOf(named.value) };
      }
      let goalGuard: RecordGuard | null = null;
      if (submissionReadsGoal(submitted, controlCtx) && read !== null) {
        const goalRef: GoalRef = { aggregateType: 'Goal', projectId: read.task.projectId, goalId: read.task.goalId };
        const goal = await readGoal(records, goalRef);
        if (goal.status !== 'ready') return goal;
        goalGuard = { refKey: refKeyOf(goalRef) as string, expectedRevision: goal.goal.revision };
        controlCtx = { ...controlCtx, goal: { desiredState: goal.goal.desiredState } };
      }
      const decided = transitionControlIntent(controlIntentStateOf(null), submitted, controlCtx);
      if (!decided.ok) {
        // CTL-01's stale Run pin: the FIRST lookup missed, but the Run advanced
        // under us, so this exact call may be retrying a request another writer
        // already committed with the same identity+fingerprint. Re-query the
        // original identity once; only a real receipt is replayed and any other
        // read failure keeps its real rejection. A genuine miss (a different
        // request) keeps the explicit revision conflict with `current`.
        if (decided.reason === 'stale') {
          const outcome = await readIdentityReceipt(records, identity, fingerprint, actor);
          if (outcome.status === 'receipt') return outcome.result;
          if (outcome.status === 'failed') return outcome.rejection;
        }
        return refusalOf(decided, read);
      }
      const eventId = deps.eventId();
      if (!nonEmpty(nowIso) || !nonEmpty(eventId)) {
        return reject('unsupported', 'the injected id/clock source produced an empty value');
      }
      // CTL-01/02 refused an absent Run (`not_found`) above.
      const run = read!;
      const runEvent = controlSubmissionRunEvent(run, intentRef, input.kind, input.reason, nowIso);
      const steers = runEvent.kind === 'stop_not_entered' ? await readQueuedSteers(records, run) : { ok: true as const, value: [] };
      if (!steers.ok) return steers.rejection;
      const runCtx = submissionRunContext(controlCtx, facts, steers.value, actor);
      const moved = submittedRunOf(run, runEvent, submitted, decided.effects, runCtx);
      const nextRun = moved.next;
      if (signal.aborted) return cancelled('the control request was cancelled during the execution read');

      const intent = controlIntentRecordOf(newControlIntentRequest({ ref: intentRef, runRef: input.runRef,
        kind: input.kind, reason: input.reason, requestedAt: nowIso, requestedBy: actor }), decided.next);
      const runRecord = encodeRun(nextRun);
      const intentRecord = encodeControlIntentSnapshot(intent);
      const written: EncodedRecord[] = [runRecord, intentRecord];
      const guards: RecordGuard[] = [
        { refKey: runRecord.refKey, expectedRevision: run.revision },
        { refKey: intentRecord.refKey, expectedRevision: null },
      ];
      // CTL-04: the older queued intents this commit supersedes (the pointer
      // intent it moves off, D-8; the queued steers a not-entered stop ends,
      // CTL-04(b)), each by the intent machine and guarded at the revision read.
      for (const effect of moved.effects) {
        if (effect.kind !== 'intent' || effect.event !== 'control_superseded_by_newer') continue;
        const older = [pointerIntent, ...steers.value].find(candidate => candidate !== null && sameRef(candidate.ref, effect.intentRef));
        if (older === undefined || older === null) throw new Error('a superseded control intent must be one the submission read');
        const superseded = transitionControlIntent(controlIntentStateOf(older),
          { type: 'control_superseded_by_newer', supersededBy: intentRef, runRevision: nextRun.revision, observedAt: nowIso },
          controlContext(run, older.ref, { intent: true, run: true }));
        if (!superseded.ok) throw new Error(`CTL-04 refused an intent RUN-09..15 superseded: ${superseded.detail}`);
        const olderRecord = encodeControlIntentSnapshot(controlIntentRecordOf(controlIntentRequestOf(older), superseded.next));
        written.push(olderRecord);
        guards.push({ refKey: olderRecord.refKey, expectedRevision: older.revision });
      }
      // RUN-09: the claim's Attempt, Outbox, Lease and Session end in the same commit.
      const claimEffects = moved.effects.filter(effect => effect.kind !== 'intent');
      if (claimEffects.length > 0) {
        if (facts === null) throw new Error('a not-entered stop reads the execution before it ends the claim');
        const claimRecords = stoppedClaimRecords(run, facts, claimEffects, runCtx, nowIso, eventId);
        if (!claimRecords.ok) return claimRecords.rejection;
        written.push(...claimRecords.records);
        guards.push(...claimRecords.guards);
      } else if (facts !== null && facts.lease !== null) {
        // RD-8: a successor claim between this read and the commit moves the Lease.
        guards.push({ refKey: refKeyOf(facts.lease.ref) as string, expectedRevision: facts.lease.revision });
      }
      if (goalGuard !== null) guards.push(goalGuard);
      // GOAL-09..14: the fan-out's Goal fence is a read-only CAS at the caller's revision.
      if (goalFence !== null) guards.push({ refKey: refKeyOf(goalFence.ref) as string, expectedRevision: goalFence.revision });
      const merged = mergeGuards(guards);
      if (!merged.ok) return merged.rejection;
      const event: ControlIntentSubmittedEvent = { eventId, eventType: CONTROL_INTENT_SUBMITTED_EVENT_TYPE,
        schemaVersion: CONTROL_INTENT_EVENT_SCHEMA_VERSION, occurredAt: nowIso, identityKey: identity,
        actor, fingerprint, submitted: { intent, runRevision: nextRun.revision } };
      const preparedCommit: PreparedCommit = {
        identityKey: identity, fingerprint,
        guards: merged.guards,
        records: written, claims: [], indexGuards: [], indexChanges: [],
        events: [encodeControlIntentSubmittedEvent(event)],
      };
      if (signal.aborted) return cancelled('the control request was cancelled before commit');
      const receipt = await records.commit(preparedCommit);
      if (receipt.status !== 'committed') return mapStoreFailure(receipt);
      if (receipt.replayed) return await replayControl(records, receipt, identity, fingerprint, actor);
      return { status: 'committed', value: { intent, runRevision: nextRun.revision },
        replayed: false, cursor: receipt.cursor };
    } catch (error) {
      return await recoverControl(records, identity, fingerprint, actor, error);
    }
  }

  async function readControl(
    ctx: CoreCallContext,
    ref: ControlIntentRef,
  ): Promise<ReadResult<ControlIntentSnapshotV1>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { scope } = ownedCtx;
    const refProblem = controlIntentRefProblem(ref);
    if (refProblem !== null) return invalid(refProblem);
    if (ref.projectId !== scope.projectId || ref.workspaceId !== scope.workspaceId) {
      return forbidden('the control intent ref is outside the trusted Host scope');
    }
    const key = refKeyOf(ref);
    if (key === null) return invalid('the control intent ref is not canonicalizable JSON');
    let batch;
    try { batch = await records.readMany([key]); }
    catch (error) { return unavailable(`the control intent read failed: ${messageOf(error)}`); }
    if (batch.status !== 'ready') return mapStoreFailure(batch);
    const record = batch.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined) {
      return batch.value.missing.includes(key)
        ? { status: 'not_found' }
        : unavailable('the control intent key was neither returned nor missing');
    }
    const decoded = decodeControlIntentSnapshot(record);
    if (decoded.status !== 'decoded') return unavailable(`the control intent is damaged: ${decoded.reason}`);
    return { status: 'ready', value: decoded.value };
  }

  /**
   * The ONE trusted Runtime observation writer. It never delivers a signal and
   * never touches the Run: it verifies the accepted intent, the current V2 entry
   * identity and the Run's recorded history window, then commits exactly one
   * observed snapshot plus its `ControlIntentObserved` replay event. The Run
   * `controlState` is only read (never cleared/overwritten) and the Session,
   * Lease and TaskAttempt are untouched.
   */
  async function recordControlObservation(
    ctx: CoreCallContext,
    request: GraphWrite<RecordControlObservationInput>,
  ): Promise<WriteResult<ControlIntentSnapshotV1>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input;
    const inputProblem = recordControlObservationInputProblem(input);
    if (inputProblem !== null) return invalid(inputProblem);
    const { intentRef, runRef, observation } = input;
    if (intentRef.projectId !== scope.projectId || intentRef.workspaceId !== scope.workspaceId) {
      return forbidden('the control intent is outside the trusted Host scope');
    }
    if (runRef.projectId !== scope.projectId) return forbidden('the observed Run belongs to another project');
    const checkedPins = checkObservationPins(owned.expected, intentRef, runRef);
    if (!checkedPins.ok) return checkedPins.rejection;
    if (signal.aborted) return cancelled('the control observation was cancelled before lookup');

    let identity = '';
    let fingerprint = '';
    try {
      identity = CONTROL_OBSERVATION_PREFIX + identityDigest(actor, scope.projectId, scope.workspaceId, owned.requestId);
      fingerprint = fingerprintOf({
        kind: 'r4-control-observation',
        actor: { kind: actor.kind, id: actor.id },
        intentRef, runRef, observation,
        expected: [
          { ref: checkedPins.intentPin.ref, revision: checkedPins.intentPin.revision },
          { ref: checkedPins.runPin.ref, revision: checkedPins.runPin.revision },
        ],
      });
    } catch {
      return invalid('the control observation is not canonicalizable JSON');
    }

    try {
      const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
      if (lookup.status === 'ready') return await replayObservation(records, lookup.value, identity, fingerprint, actor);
      if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
      if (signal.aborted) return cancelled('the control observation was cancelled during lookup');

      const intentRead = await readIntentRecord(records, intentRef);
      if (!intentRead.ok) return intentRead.rejection;
      const intent = intentRead.value;
      if (!sameRef(intent.ref, intentRef)) return unavailable('the control intent ref disagrees with the stored record');
      if (!sameRef(intent.runRef, runRef)) return invalid('the observed Run disagrees with the intent Run');
      // CTL-03's intent pin and CTL-09's state guard are asked before the Run is
      // read: an intent already observed is never re-observed. The same Kernel
      // fact is the idempotent no-op (SD-1): the recorded snapshot is returned
      // as replayed at the watermark it was read at, and nothing is written.
      const observed: ObservedIntentEvent = { type: 'control_observed', observation };
      const intentPinned = intent.revision === checkedPins.intentPin.revision;
      const answered = observedIntentAnswer(controlIntentStateOf(intent), observed, { pinsMatch: { intent: intentPinned, run: true } });
      if (answered !== null) {
        if (!answered.ok) return refusalOf(answered, { ref: intentRef, revision: intent.revision });
        if (intentRead.readThrough === null) return unavailable('the observed control intent was read without a ledger watermark');
        return { status: 'committed', value: intent, replayed: true, cursor: intentRead.readThrough };
      }

      const loaded = await loadRun(deps, runRef);
      if (!loaded.ok) return loaded.rejection;
      const read = loaded.value;
      if (read !== null && read.workspaceSnapshot.workspaceId !== scope.workspaceId) {
        return forbidden('the observed Run belongs to another workspace');
      }
      // CTL-03/05/06 on this Run read: an absent Run, the Run pin, the formal V2
      // entry identity, the persisted locator and its window, then the status. The
      // persisted Run locator is the authority for the window; the observation
      // must never replace it with a self-reported upper bound. A terminal
      // window is bounded by `endPosition`, a nonterminal one by the last
      // persisted `observedThroughPosition`, so a source from a later Turn of
      // the same Session can never be accepted. A newer canonical pointer keeps
      // the older observation as history but marks it superseded; it never
      // releases or rewrites the newer control.
      const decided = transitionControlIntent(controlIntentStateOf(intent), observed,
        controlContext(read, intentRef, { intent: intentPinned, run: read?.revision === checkedPins.runPin.revision }));
      // §7.4's kind pairing (after CD-2: paused, resumed, steered and cancelled
      // belong to their own kind) is the snapshot codec's rule, which the commit
      // enforces: the clock and event id are drawn, the Run key and the
      // cancellation are checked, then the RecordStore's schema check refuses
      // the snapshot. That one refusal keeps this order and the store's reason.
      const mispaired = !decided.ok && decided.reason === 'illegal'
        && decided.detail === observationPairingProblem(intent.kind, observation);
      if (!decided.ok && !mispaired) return refusalOf(decided, read);
      // The Run read row refused an absent Run (`not_found`) above, before the pairing.
      const run = read!;
      const nowIso = deps.now();
      const eventId = deps.eventId();
      if (!nonEmpty(nowIso) || !nonEmpty(eventId)) {
        return reject('unsupported', 'the injected id/clock source produced an empty value');
      }
      const runKey = refKeyOf(run.ref);
      if (runKey === null) return invalid('the observed Run ref is not canonicalizable JSON');
      if (!decided.ok) {
        if (signal.aborted) return cancelled('the control observation was cancelled before commit');
        return invalid(`record schema ${CONTROL_INTENT_SNAPSHOT_SCHEMA_ID} rejected the record: ${decided.detail}`);
      }
      const nextSnapshot = controlIntentRecordOf(controlIntentRequestOf(intent), decided.next);
      const intentRecord = encodeControlIntentSnapshot(nextSnapshot);
      // The observation writes only the intent; its `guard_run` effect keeps the Run a CAS guard.
      const guards: RecordGuard[] = [{ refKey: intentRecord.refKey, expectedRevision: intent.revision }];
      for (const effect of decided.effects) {
        if (effect.kind !== 'guard_run') throw new Error(`control_observed has no ${effect.kind} effect`);
        guards.push({ refKey: runKey, expectedRevision: run.revision });
      }
      const event: ControlIntentObservedEvent = {
        eventId, eventType: CONTROL_INTENT_OBSERVED_EVENT_TYPE,
        schemaVersion: CONTROL_INTENT_OBSERVED_EVENT_SCHEMA_VERSION, occurredAt: nowIso,
        identityKey: identity, actor, fingerprint, result: nextSnapshot,
      };
      const preparedCommit: PreparedCommit = {
        identityKey: identity, fingerprint,
        guards,
        records: [intentRecord], claims: [], indexGuards: [], indexChanges: [],
        events: [encodeControlIntentObservedEvent(event)],
      };
      if (signal.aborted) return cancelled('the control observation was cancelled before commit');
      const receipt = await records.commit(preparedCommit);
      if (receipt.status !== 'committed') return mapStoreFailure(receipt);
      if (receipt.replayed) return await replayObservation(records, receipt, identity, fingerprint, actor);
      return { status: 'committed', value: nextSnapshot, replayed: false, cursor: receipt.cursor };
    } catch (error) {
      // The commit result is genuinely unknown: only a real receipt read may
      // recover the original snapshot; otherwise stay `unavailable`, never
      // "did not commit" and never a second write.
      try {
        const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
        if (lookup.status === 'ready') return await replayObservation(records, lookup.value, identity, fingerprint, actor);
        if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
      } catch (readError) {
        return unavailable(`the control observation receipt could not be read: ${messageOf(readError)}`);
      }
      return unavailable(`the control observation commit result is unknown: ${messageOf(error)}`);
    }
  }

  return { submitControl, readControl, recordControlObservation };
}
