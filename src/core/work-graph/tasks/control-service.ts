/**
 * R4.1 durable Run control service (implementation).
 *
 * This is the ONE raw control service the composition root owns. `submitControl`
 * accepts a trusted Host pause/cancel request and atomically commits an
 * immutable `ControlIntentSnapshot@1`, the Run's canonical `controlState`
 * pointer and a `ControlIntentSubmitted` replay event in ONE RecordStore
 * transaction. It returns a durable receipt, never a paused/stopped conclusion:
 * a queued intent does not release the Session, Lease or Attempt and does not
 * deliver a signal.
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
 * Both writes are decided by the pure machines (STATE-MACHINES-SPEC §7, §6):
 * a submission by CTL-01 (`state/control-intent-machine.ts`), whose
 * `run_pointer` effect the Run machine applies as RUN-09..15
 * (`state/run-machine.ts`); an observation by CTL-03/05/06, whose only effect
 * keeps the Run a CAS guard. This file keeps the request shape, the scope
 * checks, the receipt lookups and the reads in their order
 * (`submissionReadsPointerIntent`, `observedIntentProblem`); the refusals past
 * them, the intent snapshot and the next Run come from the machines.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type {
  ControlIntentRef, ControlIntentSnapshotV1, SubmitControlInput, SubmittedControl,
} from '../../../contracts/control-intent.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
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
import {
  controlIntentRecordOf, controlIntentRequestOf, controlIntentStateOf, newControlIntentRequest, observationPairingProblem,
  observedIntentProblem, submissionReadsPointerIntent, transitionControlIntent,
  type ControlGuardContext, type ControlIntentEffect, type ControlIntentEvent, type ControlPointerIntent,
} from '../state/control-intent-machine.js';
import {
  controlSubmissionRunEvent, isPausedInterrupted, runControlNodeOf, runStateOf, transitionRun,
} from '../state/run-machine.js';
import type { TransitionRejectReason } from '../state/transition.js';
import {
  bindTrustedContext, checkRunPin, isRecord, isolateWrite, loadReplayEvent, mapStoreFailure,
  nonEmpty, sameRef,
} from './execution-entry-service.js';
import type {
  ControlObservationPort, RecordControlObservationInput, RunControlPort, RunControlServiceDependencies,
} from './control-contracts.js';
import type { GraphWrite } from './contracts.js';

type HostActor = { kind: 'human' | 'system'; id: string };
type Records = GoalRecordTransactionPort;
type LoadedRun = { ok: true; value: RunSnapshot | null } | { ok: false; rejection: CoreRejection };
type SubmittedIntentEvent = Extract<ControlIntentEvent, { type: 'control_submitted' }>;
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
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function notFound(reason: string): CoreRejection { return reject('not_found', reason); }
function cancelled(reason: string): CoreRejection { return reject('cancelled', reason); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

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
function fingerprintOf(value: unknown): string {
  return sha256Hex(canonicalJson(value as JsonValue));
}
function refKeyOf(value: object): string | null {
  try { return canonicalJson(value as unknown as JsonValue); } catch { return null; }
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
 * list, the formal V2 entry identity and the persisted history locator
 * (`'malformed'` when it fails the locator codec). The intent the pointer
 * names is added only for the one submission that reads it. The Goal (D-9) and
 * a consumed continuation (RD-8) are read from A.2 step 5.1 on and hold until
 * then; the Kernel pause and the exit proof belong to other events.
 */
function controlContext(
  run: RunSnapshot | null, intentRef: ControlIntentRef, pinsMatch: ControlGuardContext['pinsMatch'],
): ControlGuardContext {
  const auth = run?.executionAuthorization;
  const locator = run?.executionHistory;
  return {
    run: {
      node: run === null ? 'Absent' : runControlNodeOf(run),
      pointer: runStateOf(run).pointer,
      pointsHere: run?.controlState !== undefined && sameRef(run.controlState.intentRef, intentRef),
      inControlInputs: (run?.controlInputs ?? []).some(ref => sameRef(ref, intentRef)),
      continuationConsumed: false,
      kernelPaused: false,
      pausedInterrupted: run !== null && isPausedInterrupted(run),
      entry: isExecutionAuthorizationV2(auth)
        ? { consumerId: auth.consumerId, entryGeneration: auth.generation, sessionGeneration: auth.sessionGeneration }
        : null,
      history: locator === undefined ? null : isRunExecutionHistoryV1(locator) ? locator : 'malformed',
    },
    goal: { desiredState: 'active' },
    pointerIntent: null,
    pinsMatch,
    exitProof: null,
    origin: 'live',
  };
}

/**
 * CTL-01's accepted effects as the next Run: its one `run_pointer` effect is
 * the Run owner's RUN-09..15 (§6), which moves only the revision and the
 * pointer or steer list and names this intent. Those rows re-ask the ended
 * check and `controlSubmissionProblem` CTL-01 just passed with the same facts,
 * so they cannot refuse here. The Goal (D-9), the consumed continuation (RD-8)
 * and the queued steers (D-8) are read from A.2 step 5.1 on and hold until
 * then; Session, Lease, entry and reconcile facts belong to other Run events.
 */
function submittedRunOf(
  run: RunSnapshot, event: SubmittedIntentEvent, effects: readonly ControlIntentEffect[],
  pointerIntent: ControlPointerIntent | null, actor: HostActor,
): RunSnapshot {
  const [effect, ...extra] = effects;
  if (effect?.kind !== 'run_pointer' || extra.length > 0) {
    throw new Error('control_submitted moves the Run pointer or steer list exactly once');
  }
  const moved = transitionRun(runStateOf(run), controlSubmissionRunEvent(run, event.intentRef, event.kind, event.reason), {
    session: { usable: true, owned: false, kernel: null }, lease: 'missing', persistedClaim: null,
    goal: { desiredState: 'active', activePlanMatchesClaim: true }, entryPlan: 'active_plan',
    continuationBrief: 'absent_ok', freshAdmission: null, pointerIntent, queuedSteerCount: 0,
    continuationConsumed: false, exitProof: null, hostLease: null, kernelProbe: null, kernelPaused: false,
    inputsConfirmed: null, actor: isAutomationActor(actor) ? 'system' : 'human', claim: null,
  });
  if (!moved.ok) throw new Error(`RUN-09..15 refused a submission CTL-01 accepted: ${moved.detail}`);
  if (moved.next.record === null || moved.effects.some(runEffect => runEffect.kind !== 'intent'
    || runEffect.event !== 'control_submitted' || !sameRef(runEffect.intentRef, event.intentRef))) {
    throw new Error('a control submission writes only the Run, naming its own intent');
  }
  return moved.next.record;
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

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
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
type LoadedIntent = { ok: true; value: ControlIntentSnapshotV1 } | { ok: false; rejection: CoreRejection };
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
  return { ok: true, value: decoded.value };
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
    const checkedRun = checkRunPin(owned.expected, input.runRef);
    if (!checkedRun.ok) return checkedRun.rejection;
    const runPin = checkedRun.pin;
    if (signal.aborted) return cancelled('the control request was cancelled before lookup');

    let identity = '';
    let fingerprint = '';
    let intentId = '';
    try {
      intentId = identityDigest(actor, scope.projectId, scope.workspaceId, owned.requestId);
      identity = CONTROL_SUBMIT_PREFIX + intentId;
      fingerprint = fingerprintOf({ kind: 'r4-control-submit', actor: { kind: actor.kind, id: actor.id },
        runRef: input.runRef, control: input.kind, reason: input.reason,
        expected: [{ ref: runPin.ref, revision: runPin.revision }] });
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
      const read = loaded.value;
      if (read !== null && read.ref.projectId !== scope.projectId) return forbidden('the target Run belongs to another project');
      if (read !== null && read.workspaceSnapshot.workspaceId !== scope.workspaceId) {
        return forbidden('the target Run belongs to another workspace');
      }
      // CTL-01 on this Run read: an absent Run, the pin, an ended Run (a Run
      // that really yielded on a wait is the ONE ended Run that accepts a formal
      // wait-window control: the queued pause/cancel survives the yield and
      // gates the continuation instead of being lost with the terminal), the
      // steer text, the resume rule and the pointer fence. Only a resume that
      // needs the intent the pointer names reads it (the pointer test only narrows).
      const submitted: SubmittedIntentEvent = { type: 'control_submitted', target: 'run', intentRef,
        kind: input.kind, reason: input.reason };
      let controlCtx = controlContext(read, intentRef, { intent: true, run: read?.revision === runPin.revision });
      const pointer = read?.controlState;
      if (submissionReadsPointerIntent(submitted, controlCtx) && pointer !== undefined) {
        const pause = await readIntentRecord(records, pointer.intentRef);
        if (!pause.ok) return pause.rejection;
        controlCtx = { ...controlCtx, pointerIntent: { kind: pause.value.kind, status: pause.value.status,
          observed: pause.value.status === 'queued' ? null : pause.value.observation.kind } };
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
      // CTL-01 refused an absent Run (`not_found`) above.
      const run = read!;
      const nextRun = submittedRunOf(run, submitted, decided.effects, controlCtx.pointerIntent, actor);
      if (signal.aborted) return cancelled('the control request was cancelled during the execution read');

      const nowIso = deps.now();
      const eventId = deps.eventId();
      if (!nonEmpty(nowIso) || !nonEmpty(eventId)) {
        return reject('unsupported', 'the injected id/clock source produced an empty value');
      }
      const intent = controlIntentRecordOf(newControlIntentRequest({ ref: intentRef, runRef: input.runRef,
        kind: input.kind, reason: input.reason, requestedAt: nowIso, requestedBy: actor }), decided.next);
      const runRecord = encodeRun(nextRun);
      const intentRecord = encodeControlIntentSnapshot(intent);
      const event: ControlIntentSubmittedEvent = { eventId, eventType: CONTROL_INTENT_SUBMITTED_EVENT_TYPE,
        schemaVersion: CONTROL_INTENT_EVENT_SCHEMA_VERSION, occurredAt: nowIso, identityKey: identity,
        actor, fingerprint, submitted: { intent, runRevision: nextRun.revision } };
      const preparedCommit: PreparedCommit = {
        identityKey: identity, fingerprint,
        guards: [
          { refKey: runRecord.refKey, expectedRevision: run.revision },
          { refKey: intentRecord.refKey, expectedRevision: null },
        ],
        records: [runRecord, intentRecord], claims: [], indexGuards: [], indexChanges: [],
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
      // CTL-03's intent pin is asked before the Run is read.
      const observed: ObservedIntentEvent = { type: 'control_observed', observation };
      const intentPinned = intent.revision === checkedPins.intentPin.revision;
      const staleIntent = observedIntentProblem(observed, { pinsMatch: { intent: intentPinned, run: true } });
      if (staleIntent !== null && !staleIntent.ok) return refusalOf(staleIntent, { ref: intentRef, revision: intent.revision });

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
      // §7.4's kind pairing is the snapshot codec's rule, which today's commit
      // enforces: the clock and event id are drawn, the Run key and the
      // cancellation are checked, then the RecordStore's schema check refuses
      // the snapshot. Until step 5.1 relaxes the pairing with CTL-03/CTL-06,
      // that one refusal keeps this order and the store's reason.
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
