/**
 * The ControlIntent writes of a reconciling Run commit (STATE-MACHINES-SPEC
 * §7 CTL-04(b), CTL-07, CTL-08, CTL-10; A.2 step 5.6).
 *
 * The Run machine names each intent its end settles in the same commit
 * (`intent:<§7 event>`). This file reads those intents in the commit's read
 * window, gives each the observation its row records, asks the intent
 * machine, and returns the snapshots to write with their guards (the revision
 * read). Which observation:
 *
 * - CTL-08(b): a queued steer the Kernel accepted (`run.input_accepted` with
 *   its `control:<sha(intentRef)>` input) is `steered`, from that Kernel event;
 * - CTL-08(a): on a Run that never entered (RUN-09..11 (R), RUN-16 + RUN-09/10)
 *   the platform applied it, `platform_not_entered`;
 * - CTL-08(f): the queued pause of a Run that ended paused-interrupted (RUN-24)
 *   is `paused`, a `platform_reconcile` conclusion (the Kernel's `run.paused`
 *   names no intent, CD-1);
 * - CTL-08(d): on an `outcome_unknown` end, `outcome_unknown`;
 * - CTL-08(c)(e), CTL-07: otherwise the end came first,
 *   `terminal_without_cancel` with the Run's outcome;
 * - CTL-04(b): a steer the cancel of the end supersedes; CTL-10: the cancel a
 *   paused stop applies (`platform_paused_stop`).
 *
 * Nothing here reads a clock or mints an id: the commit instant and the Host
 * instance come in the facts.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type {
  ControlEntryIdentityV1, ControlIntentRef, ControlIntentSnapshotV1, ControlObservationV1, ControlPlatformObservationV1,
} from '../../../contracts/control-intent.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { GoalSnapshot } from '../../../contracts/ledger.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { EncodedRecord, GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import { decodeControlIntentSnapshot, encodeControlIntentSnapshot } from '../persistence/control-record-codecs.js';
import { isExecutionAuthorizationV2 } from '../persistence/execution-entry-codecs.js';
import { isRunExecutionHistoryV1 } from '../persistence/execution-history-codecs.js';
import {
  controlIntentRecordOf, controlIntentRequestOf, controlIntentStateOf, notEnteredEntryPhase, transitionControlIntent,
  type ControlGuardContext, type ControlIntentEvent, type ControlPointerIntent,
} from '../state/control-intent-machine.js';
import { isPausedInterrupted, runControlNodeOf, runStateOf, type RunEffect, type RunNode } from '../state/run-machine.js';
import type { AcceptedSteerV1 } from '../model/execution-entry-contracts.js';

/** The facts one reconciling commit settles its intents with. */
export type ReconcileIntentFacts = {
  /** The Run as read and as the same commit writes it. */
  runBefore: RunSnapshot;
  runAfter: RunSnapshot;
  /** The node the Run had before the event (`Claimed`/`Authorized`/`Revoked` for CTL-08(a)). */
  nodeBefore: RunNode;
  hostInstanceId: string | null;
  acceptedSteers: readonly AcceptedSteerV1[];
  /** The cancel the end applies (RUN-09 (R), RUN-23): a superseded steer names it. */
  cancelRef: ControlIntentRef | null;
  /** CTL-10: the proof of the stop and the pause in effect before it (null when the Kernel was not paused). */
  pausedStop: { basis: 'live_clean' | 'host_instance_takeover'; pausedBy: ControlIntentRef | null } | null;
  kernelPaused: boolean;
  observedAt: string;
  /**
   * The last Kernel position the reconcile read of the Turn (RUN-19/20/23/24
   * leave the Run's locator as last persisted): a steer the Kernel accepted
   * after that locator is observed in the window the reconcile actually read.
   */
  readThroughPosition?: number | null;
  /**
   * The Goal the commit read (CTL-08(a): a resume on a Run that never entered
   * needs it active). Absent when the commit reads no Goal: the reconcile and
   * paused-stop rows of the intent machine never consult it (7.4).
   */
  goalDesiredState?: GoalSnapshot['desiredState'];
};

type IntentWrites = { ok: true; records: EncodedRecord[]; guards: RecordGuard[] } | { ok: false; rejection: CoreRejection };
type LoadedIntents = { ok: true; value: ControlIntentSnapshotV1[]; readThrough: CommitCursor | null }
  | { ok: false; rejection: CoreRejection };

function refKeyOf(value: object): string {
  return canonicalJson(value as unknown as JsonValue);
}
function unavailable(reason: string): CoreRejection {
  return { status: 'rejected', code: 'unavailable', reason };
}
/** Key-order-free equality by canonical JSON (this file does not import the entry service, which imports it). */
function sameRef(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); } catch { return false; }
}

/**
 * The intents of one Run read in one batch: the pointer intent and every
 * steer of `controlInputs`. A missing or damaged one is `unavailable`: an
 * intent a reconcile must settle is never skipped.
 */
export async function readRunIntents(records: GoalRecordTransactionPort, run: RunSnapshot): Promise<LoadedIntents> {
  const refs = [...(run.controlState === undefined ? [] : [run.controlState.intentRef]), ...(run.controlInputs ?? [])];
  if (refs.length === 0) return { ok: true, value: [], readThrough: null };
  const keys = refs.map(refKeyOf);
  let batch;
  try { batch = await records.readMany([...new Set(keys)]); }
  catch (error) { return { ok: false, rejection: unavailable(`the control intents could not be read: ${String(error)}`) }; }
  if (batch.status !== 'ready') return { ok: false, rejection: unavailable(`the control intents could not be read: ${batch.reason}`) };
  const intents: ControlIntentSnapshotV1[] = [];
  for (const key of new Set(keys)) {
    const record = batch.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined) return { ok: false, rejection: unavailable('a control intent the Run names is missing') };
    const decoded = decodeControlIntentSnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`a control intent is damaged: ${decoded.reason}`) };
    intents.push(decoded.value);
  }
  return { ok: true, value: intents, readThrough: batch.value.readThrough };
}

/** §6.1 `RunGuardContext.pointerIntent`: the intent `controlState` names, as the machines read it. */
export function pointerIntentOf(run: RunSnapshot, intents: readonly ControlIntentSnapshotV1[]): ControlPointerIntent | null {
  const control = run.controlState;
  if (control === undefined) return null;
  const intent = intents.find(candidate => sameRef(candidate.ref, control.intentRef));
  if (intent === undefined) return null;
  return { kind: intent.kind, status: intent.status, observed: intent.status === 'queued' ? null : intent.observation.kind };
}

/** The steers of `controlInputs` still queued (CTL-04(b), CTL-08). */
export function queuedSteersOf(run: RunSnapshot, intents: readonly ControlIntentSnapshotV1[]): ControlIntentRef[] {
  return (run.controlInputs ?? []).flatMap(ref => {
    const steer = intents.find(candidate => sameRef(candidate.ref, ref));
    return steer !== undefined && steer.kind === 'steer' && steer.status === 'queued' ? [ref] : [];
  });
}

/** CTL-07: the Run's intents the unknown end recorded `outcome_unknown` (RUN-08/20). */
export function outcomeUnknownIntentsOf(intents: readonly ControlIntentSnapshotV1[]): ControlIntentRef[] {
  return intents.filter(intent => intent.status === 'outcome_unknown').map(intent => intent.ref);
}

function entryOf(run: RunSnapshot): ControlEntryIdentityV1 | null {
  const auth = run.executionAuthorization;
  return isExecutionAuthorizationV2(auth)
    ? { consumerId: auth.consumerId, entryGeneration: auth.generation, sessionGeneration: auth.sessionGeneration } : null;
}

/** The observation of one reconciled intent (see the file comment). */
function reconciledObservation(
  intent: ControlIntentSnapshotV1, facts: ReconcileIntentFacts,
): ControlObservationV1 | ControlPlatformObservationV1 | CoreRejection {
  const after = facts.runAfter;
  const accepted = intent.kind === 'steer' ? facts.acceptedSteers.find(steer => sameRef(steer.intentRef, intent.ref)) : undefined;
  if (accepted !== undefined) {
    const entry = entryOf(after);
    const history = after.executionHistory;
    if (entry === null || history === undefined || !isRunExecutionHistoryV1(history)) {
      return unavailable('a Kernel-accepted steer needs the Run entry binding and its history locator');
    }
    // An end without a Kernel terminal keeps the locator as last persisted; the steer is observed in the window
    // the reconcile read (through its last Kernel position), never past it.
    const readThrough = facts.readThroughPosition ?? null;
    const window = history.endPosition === null && readThrough !== null && readThrough > history.observedThroughPosition
      ? { ...structuredClone(history), observedThroughPosition: readThrough } : structuredClone(history);
    return { schemaVersion: 1, kind: 'steered', entry, history: window,
      source: { ...history.kernel, position: accepted.position }, kernelEventId: accepted.kernelEventId,
      kernelEventSequence: accepted.kernelEventSequence, observedAt: facts.observedAt };
  }
  const entryPhase = notEnteredEntryPhase(facts.nodeBefore);
  if (entryPhase !== null && intent.kind !== 'steer') {
    return { schemaVersion: 1, origin: 'platform_not_entered',
      kind: intent.kind === 'pause' ? 'paused' : intent.kind === 'cancel' ? 'cancelled' : 'resumed',
      runRevision: after.revision, detail: { entryPhase }, observedAt: facts.observedAt };
  }
  const hostInstanceId = facts.hostInstanceId;
  const outcome = after.outcome;
  if (hostInstanceId === null || outcome === null) {
    return unavailable('a platform reconcile conclusion names the Host instance and the Run outcome');
  }
  const kind = outcome === 'outcome_unknown' ? 'outcome_unknown'
    : intent.kind === 'pause' && isPausedInterrupted(after) ? 'paused' : 'terminal_without_cancel';
  return { schemaVersion: 1, origin: 'platform_reconcile', kind, runRevision: after.revision,
    detail: { hostInstanceId, runOutcome: outcome }, observedAt: facts.observedAt };
}

/**
 * The intent machine's guard context for one intent of the commit: the Run as
 * the commit writes it (its node, pointer and paused-interrupted end), the
 * pointer and steer list it names the intent by, and the proof of a paused stop.
 */
function intentContext(intent: ControlIntentSnapshotV1, facts: ReconcileIntentFacts): ControlGuardContext {
  const after = facts.runAfter;
  return {
    run: {
      node: runControlNodeOf(after),
      pointer: runStateOf(after).pointer,
      pointsHere: after.controlState !== undefined && sameRef(after.controlState.intentRef, intent.ref),
      inControlInputs: (facts.runBefore.controlInputs ?? []).some(ref => sameRef(ref, intent.ref)),
      continuationConsumed: false,
      kernelPaused: facts.kernelPaused,
      pausedInterrupted: isPausedInterrupted(after),
      entry: entryOf(after),
      history: null,
    },
    // Only the submission rows read the Goal; a reconciling commit passes the Goal it read, if any.
    goal: { desiredState: facts.goalDesiredState ?? 'active' },
    pointerIntent: null,
    pinsMatch: { intent: true, run: true },
    exitProof: facts.pausedStop === null ? null : facts.pausedStop.basis,
    origin: 'reconcile',
  };
}

/**
 * The snapshots and guards of the `intent` effects of one reconciling Run
 * transition, each by the intent machine (§7); an intent the effects name that
 * the commit did not read, or a refusal, is an internal assertion.
 */
export function reconciledIntentRecords(
  effects: readonly RunEffect[], intents: readonly ControlIntentSnapshotV1[], facts: ReconcileIntentFacts,
): IntentWrites {
  const records: EncodedRecord[] = [];
  const guards: RecordGuard[] = [];
  for (const effect of effects) {
    if (effect.kind !== 'intent') continue;
    const intent = intents.find(candidate => sameRef(candidate.ref, effect.intentRef));
    if (intent === undefined) throw new Error(`the reconciled intent ${effect.intentRef.intentId} was not read in the commit window`);
    let event: ControlIntentEvent;
    switch (effect.event) {
      case 'control_reconciled': {
        const observation = reconciledObservation(intent, facts);
        if ('status' in observation) return { ok: false, rejection: observation };
        event = { type: 'control_reconciled', hostInstanceId: facts.hostInstanceId ?? '', observation };
        break;
      }
      case 'control_superseded_by_newer':
        if (facts.cancelRef === null) throw new Error('a steer is superseded only by the cancel that ends the Run');
        event = { type: 'control_superseded_by_newer', supersededBy: facts.cancelRef, runRevision: facts.runAfter.revision,
          observedAt: facts.observedAt };
        break;
      case 'control_applied_paused_stop':
        if (facts.pausedStop === null) throw new Error('a paused stop names its proof');
        event = { type: 'control_applied_paused_stop', basis: facts.pausedStop.basis, pausedBy: facts.pausedStop.pausedBy,
          runRevision: facts.runAfter.revision, observedAt: facts.observedAt };
        break;
      case 'control_submitted':
      case 'control_applied_not_entered':
        throw new Error(`a reconciling commit submits no control intent (${effect.event})`);
      default:
        throw new Error('an unknown intent effect');
    }
    const decided = transitionControlIntent(controlIntentStateOf(intent), event, intentContext(intent, facts));
    if (!decided.ok) throw new Error(`the intent machine refused ${effect.event} on ${intent.ref.intentId}: ${decided.detail}`);
    const record = encodeControlIntentSnapshot(controlIntentRecordOf(controlIntentRequestOf(intent), decided.next));
    records.push(record);
    guards.push({ refKey: record.refKey, expectedRevision: intent.revision });
  }
  return { ok: true, records, guards };
}
