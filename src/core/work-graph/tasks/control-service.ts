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
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type {
  ControlIntentKindV1, ControlIntentRef, ControlIntentSnapshotV1, ControlObservationV1,
  SubmitControlInput, SubmittedControl,
} from '../../../contracts/control-intent.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { EncodedRecord, GoalRecordTransactionPort, PreparedCommit, StoreCommitReceipt } from '../../record-store/ports.js';
import {
  CONTROL_INTENT_EVENT_SCHEMA_VERSION, CONTROL_INTENT_OBSERVED_EVENT_SCHEMA_VERSION,
  CONTROL_INTENT_OBSERVED_EVENT_TYPE, CONTROL_INTENT_SUBMITTED_EVENT_TYPE,
  controlIntentObservedEventFromEvent, controlIntentSubmittedEventFromEvent,
  controlObservationProblem, decodeControlIntentSnapshot, encodeControlIntentObservedEvent,
  encodeControlIntentSnapshot, encodeControlIntentSubmittedEvent,
  type ControlIntentObservedEvent, type ControlIntentSubmittedEvent,
} from '../persistence/control-record-codecs.js';
import { isRunExecutionHistoryV1 } from '../persistence/execution-history-codecs.js';
import { isExecutionAuthorizationV2 } from '../persistence/execution-entry-codecs.js';
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
type LoadedRun = { ok: true; value: RunSnapshot } | { ok: false; rejection: CoreRejection };

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
function busy(reason: string): CoreRejection { return reject('busy', reason); }
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
  if (value['kind'] !== 'pause' && value['kind'] !== 'cancel') return 'the control kind must be pause or cancel';
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

/**
 * The narrow fresh-submit decision over the canonical Run pointer. A queued
 * cancel is final for this batch; a queued pause can be superseded by cancel.
 * A `running`/`steered` pointer does not authorize continuing execution.
 */
function freshSubmitControlProblem(run: RunSnapshot, kind: ControlIntentKindV1): CoreRejection | null {
  const control = run.controlState;
  if (control === undefined) return null;
  if (control.desiredState === 'cancelled') {
    return busy('the Run is already fenced by a queued cancel control intent');
  }
  if (control.desiredState === 'paused' && kind === 'pause') {
    return busy('the Run is already fenced by a queued pause control intent');
  }
  return null;
}

/** Exact Run load through the SHARED authority; no Role/Session/material chain. */
async function loadRun(deps: RunControlServiceDependencies, runRef: RunRef): Promise<LoadedRun> {
  let result;
  try {
    result = await deps.authority.load(runRef);
  } catch (error) {
    return { ok: false, rejection: unavailable(`the Run read failed: ${messageOf(error)}`) };
  }
  if (result.status === 'not_found') return { ok: false, rejection: notFound('the target Run does not exist') };
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
function observationStatusFor(kind: ControlObservationV1['kind']): 'applied' | 'superseded' | 'outcome_unknown' {
  if (kind === 'terminal_without_cancel') return 'superseded';
  if (kind === 'outcome_unknown') return 'outcome_unknown';
  return 'applied';
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
      const run = loaded.value;
      if (run.ref.projectId !== scope.projectId) return forbidden('the target Run belongs to another project');
      if (run.workspaceSnapshot.workspaceId !== scope.workspaceId) {
        return forbidden('the target Run belongs to another workspace');
      }
      if (run.revision !== runPin.revision) {
        // The FIRST lookup missed, but the Run advanced under us: this exact
        // call may be retrying a request that another writer already committed
        // with the same identity+fingerprint. Re-query the original identity
        // once; only a real receipt is replayed. A genuine miss keeps the
        // explicit revision conflict with `current`, and any other read
        // failure keeps its real rejection. A different request keeps its true
        // CAS conflict because its identity is not found.
        const outcome = await readIdentityReceipt(records, identity, fingerprint, actor);
        if (outcome.status === 'receipt') return outcome.result;
        if (outcome.status === 'failed') return outcome.rejection;
        return reject('revision_conflict', 'the Run changed since the caller read it',
          [{ ref: run.ref, revision: run.revision }]);
      }
      if (run.status === 'ended' || run.outcome !== null) {
        return busy('the Run already ended; no new control intent is accepted');
      }
      const controlProblem = freshSubmitControlProblem(run, input.kind);
      if (controlProblem !== null) return controlProblem;
      if (signal.aborted) return cancelled('the control request was cancelled during the execution read');

      const nowIso = deps.now();
      const eventId = deps.eventId();
      if (!nonEmpty(nowIso) || !nonEmpty(eventId)) {
        return reject('unsupported', 'the injected id/clock source produced an empty value');
      }
      const desiredState: 'paused' | 'cancelled' = input.kind === 'pause' ? 'paused' : 'cancelled';
      const intent: ControlIntentSnapshotV1 = { schemaVersion: 1, ref: intentRef, revision: 1,
        runRef: input.runRef, kind: input.kind, desiredState, status: 'queued', reason: input.reason,
        requestedAt: nowIso, requestedBy: actor };
      // Only revision and controlState move; every other Run field is preserved.
      const nextRun: RunSnapshot = { ...run, revision: run.revision + 1,
        controlState: { intentRef, desiredState } };
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
      if (intent.revision !== checkedPins.intentPin.revision) {
        return reject('revision_conflict', 'the control intent changed since the caller read it',
          [{ ref: intentRef, revision: intent.revision }]);
      }

      const loaded = await loadRun(deps, runRef);
      if (!loaded.ok) return loaded.rejection;
      const run = loaded.value;
      if (run.workspaceSnapshot.workspaceId !== scope.workspaceId) {
        return forbidden('the observed Run belongs to another workspace');
      }
      if (run.revision !== checkedPins.runPin.revision) {
        return reject('revision_conflict', 'the Run changed since the caller read it',
          [{ ref: run.ref, revision: run.revision }]);
      }
      const auth = run.executionAuthorization;
      if (!isExecutionAuthorizationV2(auth)) {
        return forbidden('the observed Run has no formal V2 entry authorization');
      }
      if (auth.consumerId !== observation.entry.consumerId
        || auth.generation !== observation.entry.entryGeneration
        || auth.sessionGeneration !== observation.entry.sessionGeneration) {
        return forbidden('the observed entry identity disagrees with the Run entry binding');
      }
      const locator = run.executionHistory;
      if (locator === undefined) return forbidden('the observed Run has no execution-history locator');
      if (!isRunExecutionHistoryV1(locator)) return unavailable('the stored execution-history locator is malformed');
      if (locator.sessionRef.projectId !== observation.history.sessionRef.projectId
        || locator.sessionRef.sessionId !== observation.history.sessionRef.sessionId
        || locator.kernel.adapterId !== observation.history.kernel.adapterId
        || locator.kernel.kernelSessionId !== observation.history.kernel.kernelSessionId
        || locator.kernel.runId !== observation.history.kernel.runId
        || locator.kernel.turnId !== observation.history.kernel.turnId
        || locator.startPosition !== observation.history.startPosition) {
        return forbidden('the observation history disagrees with the Run locator');
      }
      // The persisted Run locator is the authority for the window; the
      // observation must never replace it with a self-reported upper bound. A
      // terminal window is bounded by `endPosition`, a nonterminal one by the
      // last persisted `observedThroughPosition`, so a source from a later Turn
      // of the same Session can never be accepted.
      const persistedThrough = locator.endPosition ?? locator.observedThroughPosition;
      if (observation.source.position < locator.startPosition
        || observation.source.position > persistedThrough) {
        return unavailable('the observation source is outside the persisted Run history window');
      }
      if (observation.history.observedThroughPosition > persistedThrough) {
        return unavailable('the observation window exceeds the persisted Run history window');
      }

      // A newer canonical pointer keeps the older observation as history but
      // marks it superseded; it never releases or rewrites the newer control.
      const pointer = run.controlState;
      const superseded = pointer === undefined || !sameRef(pointer.intentRef, intentRef);
      const status = superseded ? 'superseded' : observationStatusFor(observation.kind);
      const nextRevision = intent.revision + 1;
      if (!Number.isSafeInteger(nextRevision)) {
        return invalid('the control intent revision would not be a safe integer');
      }
      const nextSnapshot: ControlIntentSnapshotV1 = {
        schemaVersion: intent.schemaVersion, ref: intent.ref, runRef: intent.runRef, kind: intent.kind,
        desiredState: intent.desiredState, reason: intent.reason, requestedAt: intent.requestedAt,
        requestedBy: intent.requestedBy, revision: nextRevision, status, observation,
      };
      const nowIso = deps.now();
      const eventId = deps.eventId();
      if (!nonEmpty(nowIso) || !nonEmpty(eventId)) {
        return reject('unsupported', 'the injected id/clock source produced an empty value');
      }
      const intentRecord = encodeControlIntentSnapshot(nextSnapshot);
      const runKey = refKeyOf(run.ref);
      if (runKey === null) return invalid('the observed Run ref is not canonicalizable JSON');
      const event: ControlIntentObservedEvent = {
        eventId, eventType: CONTROL_INTENT_OBSERVED_EVENT_TYPE,
        schemaVersion: CONTROL_INTENT_OBSERVED_EVENT_SCHEMA_VERSION, occurredAt: nowIso,
        identityKey: identity, actor, fingerprint, result: nextSnapshot,
      };
      const preparedCommit: PreparedCommit = {
        identityKey: identity, fingerprint,
        guards: [
          { refKey: intentRecord.refKey, expectedRevision: intent.revision },
          { refKey: runKey, expectedRevision: run.revision },
        ],
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
