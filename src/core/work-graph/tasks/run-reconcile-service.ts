/**
 * Run reconcile service (STATE-MACHINES-SPEC §6 RUN-16/19/20/22/23/24, the R
 * source of RUN-09..11, §7 CTL-04(b)/CTL-08/CTL-10, §8 SES-05/06/07, §12;
 * A.2 step 5.6).
 *
 * The WorkGraph writes of a Run end without a Kernel terminal (RD-5):
 *
 * - `reconcileRun`: the start-up reconcile's classification of an `Entering`
 *   or `Running` Run (RUN-16 not entered, RUN-19/24 a clean interruption,
 *   RUN-20 unknown, RUN-23 a queued cancel with a clean Turn), and the
 *   in-process variants the Runtime proves with its exited handle (RUN-16 when
 *   the Kernel call failed before `turn.started`, RUN-23 for a cancel of a Run
 *   paused at a safe point);
 * - `resolveUnknownRun`: the operator's attestation of an unknown end
 *   (RUN-22), only under this Host's instance lease (L-1);
 * - `reconcileRunControls`: the queued intents the reconcile settles without
 *   another Run end (CTL-08(a) through RUN-09..11 (R), CTL-08(d)/(e)).
 *
 * Each write reads the execution window (Run, Attempt, Outbox, Plan, Session,
 * Lease) and the Run's intents, asks the Run machine, and commits the Run, the
 * claim's records (each by its own machine through `claimEffectRecords`) and
 * the settled intents (`reconcile-intents.ts`) in ONE commit guarded at every
 * revision read. A replay restores the Run from the recorded event.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ControlIntentSnapshotV1 } from '../../../contracts/control-intent.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import type { RunReconciliationBasisV1, RunSnapshot } from '../../../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import type { EncodedRecord, CommitCursorBinding, PreparedCommit, RecordGuard, StoreCommitReceipt } from '../../record-store/ports.js';
import {
  EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, EXECUTION_RUN_RECONCILED_EVENT_TYPE, encodeExecutionRunReconciledEvent,
  executionRunReconciledEventFromEvent, isExecutionAuthorizationV2, type ExecutionRunReconciledEvent,
} from '../persistence/execution-entry-codecs.js';
import { attemptEventFromRunEvent, type AttemptEvent, type AttemptGuardContext } from '../state/attempt-machine.js';
import {
  runStateOf, transitionRun, type RunEffect, type RunEvent, type RunGuardContext, type RunNode, type RunTransition,
} from '../state/run-machine.js';
import type { SessionGuardContext, SessionRelease, SessionReleaseCause } from '../state/session-availability.js';
import type { GraphWrite } from '../model/task-contracts.js';
import {
  bindTrustedContext, checkRunPin, claimEffectRecords, claimLeaseOf, claimSessionOf, executionReadGuards, hostLeaseOf,
  isRecord, isolateWrite, loadReplayEvent, mapStoreFailure, mergeGuards, nonEmpty, readAdmissionFacts,
  type ClaimSessionRelease,
} from './execution-entry-service.js';
import type { TaskExecutionRecord } from '../model/execution-read-contracts.js';
import { SESSION_RECORD_SCHEMA_ID } from '../sessions/session-record-codecs.js';
import { readGoalScope } from './plan-readers.js';
import {
  outcomeUnknownIntentsOf, pointerIntentOf, queuedSteersOf, readRunIntents, reconciledIntentRecords,
  type ReconcileIntentFacts,
} from './reconcile-intents.js';
import type {
  AttestationRequest, ReconcileRunControlsInput, ReconcileRunInput, ReconcileTurnV1, ResolveUnknownRunInput,
  RunReconcileDependencies, RunReconcileService,
} from './run-reconcile-contracts.js';

type HostActor = { kind: 'human' | 'system'; id: string };
type Operation = ExecutionRunReconciledEvent['operation'];
type Decided = Extract<RunTransition, { ok: true }>;

/**
 * Spec §2.3 P01: the Session record a reconcile decision wrote with an explicit
 * `unavailableSince: null` (an available→unavailable release) is bound to this
 * commit's cursor. The record comes from the shared `claimEffectRecords`, which
 * this package does not change (W224 is out of scope), so the binding target is
 * read from the encoded Session record itself.
 */
function sessionCursorBindings(records: readonly EncodedRecord[]): CommitCursorBinding[] {
  const bindings: CommitCursorBinding[] = [];
  for (const record of records) {
    if (record.schemaId !== SESSION_RECORD_SCHEMA_ID) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(record.json); } catch { continue; }
    if (isRecord(parsed) && parsed['unavailableSince'] === null) {
      bindings.push({ refKey: record.refKey, field: 'unavailableSince' });
    }
  }
  return bindings;
}
type ClaimWrites = { pairing: AttemptGuardContext; attemptEvent: AttemptEvent; release: ClaimSessionRelease };
type IntentFacts = Omit<ReconcileIntentFacts, 'runBefore' | 'runAfter' | 'observedAt'>;

const RUN_SNAPSHOT_SCHEMA_ID = 'RunSnapshot@1';
const RECONCILE_PREFIX = 'a2-run-reconcile:';
const RESOLVE_PREFIX = 'a2-run-resolve:';
const RESOLVE_KIND = 'a2-run-resolve';
const CONTROLS_PREFIX = 'a2-run-controls:';
const MAX_ATTESTATION_REASON_CHARS = 2000;
const PROBE_VERDICTS: readonly string[] = ['ready', 'missing', 'damaged', 'host_config', 'transient', 'cancelled'];
const UNKNOWN_CAUSES: readonly string[] = ['tool_calls_unresolved', 'kernel_unreadable', 'continuation_unrebuildable'];

function reject(code: CoreError, reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function fingerprintOf(value: unknown): string { return sha256Hex(canonicalJson(value as JsonValue)); }
function refKeyOf(value: object): string { return canonicalJson(value as unknown as JsonValue); }
function identityKey(prefix: string, actor: HostActor, scope: { projectId: string; workspaceId: string }, requestId: string): string {
  return prefix + sha256Hex(canonicalJson({ actor: { kind: actor.kind, id: actor.id },
    projectId: scope.projectId, workspaceId: scope.workspaceId, requestId } as unknown as JsonValue));
}
function encodeRun(run: RunSnapshot): EncodedRecord {
  return { refKey: refKeyOf(run.ref), schemaId: RUN_SNAPSHOT_SCHEMA_ID, revision: run.revision, json: JSON.stringify(run) };
}
function runRefusal(refused: Extract<RunTransition, { ok: false }>): CoreRejection {
  return reject(refused.code, refused.detail);
}
function isRunRef(value: unknown): boolean {
  return isRecord(value) && value['aggregateType'] === 'Run' && nonEmpty(value['projectId']) && nonEmpty(value['runId']);
}
function attestationProblem(input: AttestationRequest): string | null {
  if (!isRunRef(input.runRef)) return 'resolveUnknownRun requires a complete RunRef';
  if (typeof input.reason !== 'string' || input.reason.length > MAX_ATTESTATION_REASON_CHARS) {
    return `the attestation reason must be a string of at most ${MAX_ATTESTATION_REASON_CHARS} characters`;
  }
  return null;
}
/**
 * RUN-22's request content: what the caller sent (the Run, the reason; the pin
 * is added by `identify`). The Kernel facts the Host entry reads are not part
 * of it, so a retry under the same identity replays the original receipt even
 * when the Kernel now reads differently (§12.10 step 4; like RUN-02, whose
 * fingerprint leaves out the active Plan).
 */
function attestationContent(input: AttestationRequest): unknown {
  return { runRef: input.runRef, reason: input.reason };
}

// --------------------------------------------------------------------------
// Shape checks
// --------------------------------------------------------------------------

function basisProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'the reconcile basis must be an object';
  if (value['kind'] === 'live_clean') return null;
  if (value['kind'] === 'host_instance_takeover' && nonEmpty(value['hostInstanceId'])) return null;
  return 'the reconcile basis must be live_clean or a host_instance_takeover with its hostInstanceId';
}
function steersProblem(value: unknown): string | null {
  if (!Array.isArray(value) || !value.every(steer => isRecord(steer) && isRecord(steer['intentRef'])
    && Number.isSafeInteger(steer['position']) && (steer['position'] as number) > 0 && nonEmpty(steer['kernelEventId'])
    && Number.isSafeInteger(steer['kernelEventSequence']))) {
    return 'the accepted steers must name each steer and its Kernel input event';
  }
  return null;
}
function turnProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'the reconciled Turn must be an object';
  if (typeof value['terminal'] !== 'boolean' || typeof value['kernelPaused'] !== 'boolean'
    || typeof value['inputsConfirmed'] !== 'boolean') {
    return 'the reconciled Turn needs its terminal, kernelPaused and inputsConfirmed facts';
  }
  if (!Array.isArray(value['inFlightToolCallIds']) || !value['inFlightToolCallIds'].every(nonEmpty)) {
    return 'the reconciled Turn inFlightToolCallIds must be tool call ids';
  }
  const last = value['lastPosition'];
  if (!(last === null || (typeof last === 'number' && Number.isSafeInteger(last) && last >= 0))) {
    return 'the reconciled Turn lastPosition must be null or a position';
  }
  if (value['entered'] !== null && !isRecord(value['entered'])) return 'the reconciled Turn start must be null or an object';
  return steersProblem(value['acceptedSteers']);
}
function reconcileInputProblem(input: ReconcileRunInput): string | null {
  if (!isRunRef(input.runRef)) return 'reconcileRun requires a complete RunRef';
  const basis = basisProblem(input.basis);
  if (basis !== null) return basis;
  if (!PROBE_VERDICTS.includes(input.probe)) return 'reconcileRun requires the claim Session probe verdict';
  const result = input.result as unknown;
  if (!isRecord(result)) return 'reconcileRun requires a result';
  switch (result['kind']) {
    case 'not_entered': return isRecord(result['kernel']) ? null : 'a not_entered result names the Kernel identity read';
    case 'unknown': {
      if (!UNKNOWN_CAUSES.includes(result['cause'] as string)) return 'an unknown result names its cause';
      if (!Array.isArray(result['unresolvedToolCallIds']) || !result['unresolvedToolCallIds'].every(nonEmpty)) {
        return 'an unknown result lists its unresolved tool call ids';
      }
      const through = result['observedThroughPosition'];
      if (!(through === null || (typeof through === 'number' && Number.isSafeInteger(through) && through >= 0))) {
        return 'an unknown result observedThroughPosition must be null or a position';
      }
      return result['turn'] === null ? null : turnProblem(result['turn']);
    }
    case 'interrupted_clean': return turnProblem(result['turn']);
    case 'paused_stop':
      if (!isRecord(result['cancelIntentRef'])) return 'a paused stop names its cancel intent';
      if (!(result['pausedBy'] === null || isRecord(result['pausedBy']))) return 'a paused stop names the pause in effect, or null';
      return turnProblem(result['turn']);
    default: return 'the reconcile result kind is not recognized';
  }
}

// --------------------------------------------------------------------------
// Machine facts
// --------------------------------------------------------------------------

/**
 * RUN-09..24's guard context from the execution window and the Run's intents:
 * the claim Session and Lease as this Run holds them, the pointer intent, the
 * queued steers and the intents an unknown end left `outcome_unknown`, the
 * proven exit, this Host's instance lease, the probe and the Turn facts.
 * Entry and claim facts belong to other Run events. The Goal is not read here
 * (no reconcile end consults it); `reconcileRunControls` reads it for the
 * queued resume of RUN-11 (R) and replaces this placeholder.
 */
function reconcileRunContext(
  facts: TaskExecutionRecord, intents: readonly ControlIntentSnapshotV1[], actor: HostActor,
  basis: RunReconciliationBasisV1, deps: RunReconcileDependencies, probe: RunGuardContext['kernelProbe'],
  turn: ReconcileTurnV1 | null,
): RunGuardContext {
  const claim = facts.outbox.claim;
  return {
    session: claimSessionOf(facts.session, claim), lease: claimLeaseOf(facts.lease, claim), persistedClaim: claim,
    goal: { desiredState: 'active', activePlanMatchesClaim: true }, entryPlan: 'active_plan', continuationBrief: 'absent_ok',
    freshAdmission: null, pointerIntent: pointerIntentOf(facts.run, intents), queuedSteers: queuedSteersOf(facts.run, intents),
    outcomeUnknownIntents: outcomeUnknownIntentsOf(intents), continuationConsumed: false,
    exitProof: basis.kind, hostLease: hostLeaseOf(deps.hostInstance, basis), kernelProbe: probe,
    kernelPaused: turn?.kernelPaused ?? false, inputsConfirmed: turn === null ? null : turn.inputsConfirmed,
    actor: isAutomationActor(actor) ? 'system' : 'human', claim: null,
  };
}

/** The Run event of one reconcile input, stamped with the commit instant and event id. */
function reconcileEventOf(
  input: ReconcileRunInput, claim: TaskExecutionRecord['outbox']['claim'], recordedAt: string, factEventId: string,
): RunEvent {
  const result = input.result;
  const turnFacts = (turn: ReconcileTurnV1) => ({ terminal: turn.terminal, inFlightToolCallIds: turn.inFlightToolCallIds,
    lastPosition: turn.lastPosition, entered: turn.entered, acceptedSteers: turn.acceptedSteers.map(steer => steer.intentRef) });
  switch (result.kind) {
    case 'not_entered':
      return { kind: 'reconcile_not_entered', claim, basis: input.basis, kernel: result.kernel, recordedAt };
    case 'unknown':
      return { kind: 'reconcile_unknown', claim, basis: input.basis, cause: result.cause,
        unresolvedToolCallIds: result.unresolvedToolCallIds, observedThroughPosition: result.observedThroughPosition,
        turn: result.turn === null ? null : turnFacts(result.turn), recordedAt };
    case 'interrupted_clean':
      return { kind: 'reconcile_interrupted_clean', claim, basis: input.basis, turn: turnFacts(result.turn), recordedAt, factEventId };
    case 'paused_stop':
      return { kind: 'stop_paused', claim, cancelIntentRef: result.cancelIntentRef, basis: input.basis,
        turn: turnFacts(result.turn), recordedAt, factEventId };
    default: {
      const unknown: never = result;
      throw new Error(`unknown reconcile result ${String(unknown)}`);
    }
  }
}

/**
 * The Session release of a reconcile end (§8.2 trigger table): the restart
 * reconcile under this Host's lease (`reconcile` caller, SES-06), the
 * in-process paused stop (SES-06, `live_clean`), a not-entered cancel (SES-05)
 * or the attestation (SES-07). `context` builds the holder from the Run
 * machine's own `release_session` effect, so the cursor and `kernelTurnOpen`
 * are the Run row's (RUN-19/23/24 keep the cursor and leave the Turn open).
 */
function reconcileRelease(
  cause: SessionReleaseCause, before: RunNode, caller: SessionGuardContext['caller'], hostLease: RunGuardContext['hostLease'],
  inputsConfirmed: boolean | 'kernel_unreadable', kernelTurnSeen: boolean,
): ClaimSessionRelease {
  const notEntered = cause === 'stop_not_entered';
  return {
    cause,
    context: (release: SessionRelease): SessionGuardContext => ({
      caller, hostLease, pin: null,
      holder: {
        ref: release.holder, claimGeneration: release.generation,
        before: before === 'EndedUnknown' ? 'run_ended_unknown'
          : notEntered || before === 'Entering' ? 'run_starting' : 'run_running',
        after: 'run_ended', kernelTurnSeen: notEntered ? false : kernelTurnSeen, inputsConfirmed: notEntered ? true : inputsConfirmed,
        historyBoundaryCursor: release.historyCursor.kind === 'advance' ? release.historyCursor.cursor : null,
        kernelTurnOpen: release.kernelTurnOpen,
      },
      probe: caller === 'reconcile' ? 'ready' : null, kernelHeader: null, openResponsibleLink: null, creation: null, link: null,
    }),
  };
}

/**
 * The release cause of a reconcile end's `release_session` effect (§8.2 trigger table); null for
 * RUN-20, whose `outcome_unknown` holder keeps its Session (I-2, D-4) until an attestation (SES-07).
 */
function releaseCauseOf(kind: RunEvent['kind']): SessionReleaseCause | null {
  switch (kind) {
    case 'reconcile_interrupted_clean': return 'reconcile_interrupted_clean';
    case 'stop_paused': return 'stop_paused';
    case 'unknown_attested': return 'unknown_attested';
    case 'reconcile_not_entered':
    case 'stop_not_entered':
      return 'stop_not_entered';
    case 'reconcile_unknown': return null;
    default: throw new Error(`${kind} releases no Session through reconcile`);
  }
}

function releaseOf(cause: SessionReleaseCause | null, build: (cause: SessionReleaseCause) => ClaimSessionRelease): ClaimSessionRelease {
  return cause === null ? null : build(cause);
}

/** The V2 entry binding the end names for the Outbox and the Attempt; `null` without one. */
function entryOf(run: RunSnapshot): { consumerId: string; entryGeneration: number } | null {
  const auth = run.executionAuthorization;
  return isExecutionAuthorizationV2(auth) ? { consumerId: auth.consumerId, entryGeneration: auth.generation } : null;
}

/**
 * The §5 event a reconcile end carries for its claim's records (the Run
 * machine's `attempt` effect): RUN-19/20/23/24 end the Attempt from the node
 * they leave (an end from `Entering` records the Turn start, ATT-31/32);
 * RUN-16 with its queued cancel and RUN-09 (R) are the not-entered stop
 * (ATT-05); RUN-22 resolves it (ATT-12).
 */
function attemptEventOfEnd(
  runEvent: RunEvent, next: RunSnapshot, facts: TaskExecutionRecord, recordedAt: string, eventId: string,
): AttemptEvent {
  const claim = facts.outbox.claim;
  const entry = entryOf(next);
  const outcome = next.outcome;
  if (outcome === null) throw new Error('a reconciled end has an outcome');
  const sequence = next.lastEventSeq === facts.run.lastEventSeq ? null : next.lastEventSeq;
  let mapped: AttemptEvent | null;
  switch (runEvent.kind) {
    case 'reconcile_interrupted_clean':
    case 'stop_paused':
    case 'reconcile_unknown':
      mapped = attemptEventFromRunEvent({ kind: runEvent.kind, claim, endOutcome: outcome, endedAt: recordedAt, eventId,
        sequence, entry, turnStartedAt: facts.run.startedAt === null ? runEvent.turn?.entered?.enteredAt ?? null : null });
      break;
    case 'reconcile_not_entered':
    case 'stop_not_entered':
      mapped = attemptEventFromRunEvent({ kind: 'stop_not_entered', claim, endOutcome: 'cancelled', endedAt: recordedAt,
        eventId, sequence: null, entry, turnStartedAt: null });
      break;
    case 'unknown_attested':
      if (entry === null) throw new Error('an attested Run has its entry binding');
      mapped = attemptEventFromRunEvent({ kind: 'unknown_attested', claim, outcome: 'crashed', resolvedAt: recordedAt,
        eventId, sequence: null, entry, turnStartedAt: null });
      break;
    default: throw new Error(`${runEvent.kind} is not a reconcile end`);
  }
  if (mapped === null) throw new Error(`${runEvent.kind} writes the TaskAttempt`);
  return mapped;
}

/** RUN-16..24's §5 pairing: the node the Run leaves (`Revoked` for RUN-16's cancel, ATT-05), what it still holds. */
function pairingOf(node: RunNode, facts: TaskExecutionRecord, runCtx: RunGuardContext): AttemptGuardContext {
  return { runNode: node, runLastEventSeq: facts.run.lastEventSeq, ownsSession: runCtx.session.owned,
    ownsLease: runCtx.lease === 'owned' };
}

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

export function createRunReconcileService(deps: RunReconcileDependencies): RunReconcileService {
  const records = deps.records;

  async function replay(
    receipt: Extract<StoreCommitReceipt, { status: 'committed' }>, identity: string, fingerprint: string, actor: HostActor,
    operation: Operation,
  ): Promise<WriteResult<RunSnapshot>> {
    const loaded = await loadReplayEvent(records, receipt);
    if (!loaded.ok) return loaded.rejection;
    const decoded = executionRunReconciledEventFromEvent(loaded.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded reconcile event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.identityKey !== identity || event.fingerprint !== fingerprint || event.operation !== operation) {
      return unavailable('the recorded reconcile disagrees with the request identity');
    }
    if (event.actor.kind !== actor.kind || event.actor.id !== actor.id) return unavailable('the recorded reconcile belongs to another actor');
    return { status: 'committed', value: event.run, replayed: true, cursor: receipt.cursor };
  }

  /**
   * The ONE commit of a decided Run transition: the Run (when it changed),
   * the claim's records (`claim` null when the transition names none), the
   * settled intents, under the execution-window guards and every intent read
   * (the machine judged their status); one replay event.
   */
  async function commitDecided(input: {
    identity: string; fingerprint: string; actor: HostActor; operation: Operation; facts: TaskExecutionRecord;
    runPin: VersionPin; decided: Decided; intents: readonly ControlIntentSnapshotV1[]; nowIso: string; eventId: string;
    claim: ClaimWrites | null; intentFacts: IntentFacts; signal: AbortSignal;
    /** Further records the decision read (the Goal of CTL-08(a)), guarded at the revision read. */
    readGuards?: readonly RecordGuard[];
  }): Promise<WriteResult<RunSnapshot>> {
    const { facts, decided } = input;
    const nextRun = decided.next.record ?? facts.run;
    const written: EncodedRecord[] = nextRun === facts.run ? [] : [encodeRun(nextRun)];
    const claimEffects = decided.effects.filter(effect => effect.kind !== 'intent');
    if (claimEffects.length > 0) {
      if (input.claim === null) throw new Error('a reconcile end with claim effects names its §5 event');
      const claimRecords = claimEffectRecords(claimEffects, facts, input.claim.pairing, input.claim.attemptEvent, input.claim.release);
      if (!claimRecords.ok) return claimRecords.rejection;
      written.push(...claimRecords.records);
    }
    const intentWrites = reconciledIntentRecords(decided.effects, input.intents, { ...input.intentFacts,
      runBefore: facts.run, runAfter: nextRun, observedAt: input.nowIso });
    if (!intentWrites.ok) return intentWrites.rejection;
    written.push(...intentWrites.records);
    if (written.length === 0) return invalid('the Run has nothing for the reconcile to write');
    const intentGuards: RecordGuard[] = input.intents.map(intent => ({ refKey: refKeyOf(intent.ref), expectedRevision: intent.revision }));
    const merged = mergeGuards([...executionReadGuards(facts, refKeyOf(facts.run.ref), input.runPin), ...intentGuards,
      ...intentWrites.guards, ...(input.readGuards ?? [])]);
    if (!merged.ok) return merged.rejection;
    const event: ExecutionRunReconciledEvent = { eventId: input.eventId, eventType: EXECUTION_RUN_RECONCILED_EVENT_TYPE,
      schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, occurredAt: input.nowIso, identityKey: input.identity,
      actor: input.actor, fingerprint: input.fingerprint, operation: input.operation, run: nextRun };
    const bindings = sessionCursorBindings(written);
    const prepared: PreparedCommit = { identityKey: input.identity, fingerprint: input.fingerprint, guards: merged.guards,
      records: written, claims: [], indexGuards: [], indexChanges: [], events: [encodeExecutionRunReconciledEvent(event)],
      ...(bindings.length === 0 ? {} : { commitCursorBindings: bindings }) };
    if (input.signal.aborted) return reject('cancelled', 'the reconcile was cancelled before commit');
    const receipt = await records.commit(prepared);
    if (receipt.status !== 'committed') return mapStoreFailure(receipt);
    if (receipt.replayed) return await replay(receipt, input.identity, input.fingerprint, input.actor, input.operation);
    return { status: 'committed', value: nextRun, replayed: false, cursor: receipt.cursor };
  }

  /**
   * Trusted context, isolation, shape, pin and request identity of one write;
   * nothing is read. `contentOf` names what the fingerprint covers (the whole
   * input, or for an attestation only what the caller sent).
   */
  function identify<T extends { runRef: RunSnapshot['ref'] }>(
    ctx: CoreCallContext, request: GraphWrite<T>, prefix: string, kind: string, problemOf: (input: T) => string | null,
    contentOf: (input: T) => unknown,
  ): { ok: false; rejection: CoreRejection } | {
    ok: true; input: T; scopeCtx: CoreCallContext; scope: { projectId: string; workspaceId: string }; actor: HostActor;
    signal: AbortSignal; identity: string; fingerprint: string; pin: VersionPin;
  } {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return { ok: false, rejection: ownedCtx.rejection };
    const { ctx: scopeCtx, scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return { ok: false, rejection: owned.rejection };
    const input = owned.input;
    const problem = problemOf(input);
    if (problem !== null) return { ok: false, rejection: invalid(problem) };
    if (input.runRef.projectId !== scope.projectId) return { ok: false, rejection: forbidden('the Run belongs to another project') };
    const checked = checkRunPin(owned.expected, input.runRef);
    if (!checked.ok) return { ok: false, rejection: checked.rejection };
    let identity: string;
    let fingerprint: string;
    try {
      identity = identityKey(prefix, actor, scope, owned.requestId);
      fingerprint = fingerprintOf({ kind, actor, input: contentOf(input), expected: [checked.pin] });
    } catch { return { ok: false, rejection: invalid('the reconcile request is not canonicalizable JSON') }; }
    return { ok: true, input, scopeCtx, scope, actor, signal, identity, fingerprint, pin: checked.pin };
  }

  /** The shared front of the three writes: trusted context, isolation, shape, pin, identity, replay, reads. */
  async function begin<T extends { runRef: RunSnapshot['ref'] }>(
    ctx: CoreCallContext, request: GraphWrite<T>, prefix: string, kind: string, operation: Operation,
    problemOf: (input: T) => string | null, contentOf: (input: T) => unknown = input => input,
  ): Promise<{ ok: false; result: WriteResult<RunSnapshot> } | {
    ok: true; input: T; actor: HostActor; signal: AbortSignal; identity: string; fingerprint: string; pin: VersionPin;
    facts: TaskExecutionRecord; intents: ControlIntentSnapshotV1[];
  }> {
    const front = identify(ctx, request, prefix, kind, problemOf, contentOf);
    if (!front.ok) return { ok: false, result: front.rejection };
    const { input, scopeCtx, scope, actor, signal, identity, fingerprint, pin } = front;
    const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
    if (lookup.status === 'ready') return { ok: false, result: await replay(lookup.value, identity, fingerprint, actor, operation) };
    if (lookup.code !== 'not_found') return { ok: false, result: mapStoreFailure(lookup) };
    const factsRead = await readAdmissionFacts(deps, scopeCtx, input.runRef, pin);
    if (!factsRead.ok) return { ok: false, result: factsRead.rejection };
    const facts = factsRead.value;
    if (facts.run.workspaceSnapshot.workspaceId !== scope.workspaceId) {
      return { ok: false, result: forbidden('the Run belongs to another workspace') };
    }
    const intentsRead = await readRunIntents(records, facts.run);
    if (!intentsRead.ok) return { ok: false, result: intentsRead.rejection };
    return { ok: true, input, actor, signal, identity, fingerprint, pin, facts, intents: intentsRead.value };
  }

  function stamp(): { ok: true; nowIso: string; eventId: string } | { ok: false; rejection: CoreRejection } {
    const nowIso = deps.now();
    const eventId = deps.eventId();
    if (!nonEmpty(nowIso) || !nonEmpty(eventId)) {
      return { ok: false, rejection: reject('unsupported', 'the injected id/clock source produced an empty value') };
    }
    return { ok: true, nowIso, eventId };
  }

  async function reconcileRun(ctx: CoreCallContext, request: GraphWrite<ReconcileRunInput>): Promise<WriteResult<RunSnapshot>> {
    try {
      const begun = await begin(ctx, request, RECONCILE_PREFIX, 'a2-run-reconcile', 'reconcile_run', reconcileInputProblem);
      if (!begun.ok) return begun.result;
      const { input, facts, intents } = begun;
      const result = input.result;
      const turn = result.kind === 'not_entered' ? null : result.turn;
      const runCtx = reconcileRunContext(facts, intents, begun.actor, input.basis, deps, input.probe, turn);
      const state = runStateOf(facts.run);
      const claim = facts.outbox.claim;
      const stamped = stamp();
      if (!stamped.ok) return stamped.rejection;
      const runEvent = reconcileEventOf(input, claim, stamped.nowIso, stamped.eventId);
      const decided = transitionRun(state, runEvent, runCtx);
      if (!decided.ok) return runRefusal(decided);
      const nextRun = decided.next.record ?? facts.run;
      // RUN-16 + RUN-09 (R): the cancel ends a Run proven not entered, so its claim
      // records pair with the revoked Run (ATT-05); every other end with its own node.
      const notEntered = runEvent.kind === 'reconcile_not_entered';
      const nodeBefore: RunNode = notEntered ? 'Revoked' : state.node;
      const takeover = input.basis.kind === 'host_instance_takeover';
      const hasClaimEffects = decided.effects.some(effect => effect.kind !== 'intent');
      const pointerRef = facts.run.controlState?.intentRef ?? null;
      return await commitDecided({ identity: begun.identity, fingerprint: begun.fingerprint, actor: begun.actor,
        operation: 'reconcile_run', facts, runPin: begun.pin, decided, intents, nowIso: stamped.nowIso,
        eventId: stamped.eventId, signal: begun.signal,
        claim: hasClaimEffects ? {
          pairing: pairingOf(nodeBefore, facts, runCtx),
          attemptEvent: attemptEventOfEnd(runEvent, nextRun, facts, stamped.nowIso, stamped.eventId),
          release: releaseOf(releaseCauseOf(runEvent.kind), cause => reconcileRelease(cause, nodeBefore,
            takeover ? 'reconcile' : 'service', runCtx.hostLease, turn?.inputsConfirmed ?? true, true)),
        } : null,
        intentFacts: { nodeBefore, hostInstanceId: takeover ? deps.hostInstance?.hostInstanceId ?? null : null,
          acceptedSteers: turn?.acceptedSteers ?? [],
          cancelRef: notEntered || runEvent.kind === 'stop_paused' ? pointerRef : null,
          // CTL-10: the pause in effect before the cancel (null when the Kernel was not paused, LA-7).
          pausedStop: result.kind === 'paused_stop'
            ? { basis: input.basis.kind, pausedBy: result.turn.kernelPaused ? result.pausedBy : null } : null,
          kernelPaused: turn?.kernelPaused ?? false, readThroughPosition: turn?.lastPosition ?? null } });
    } catch (error) {
      return unavailable(`the reconcile write failed: ${messageOf(error)}`);
    }
  }

  async function resolveUnknownRun(
    ctx: CoreCallContext, request: GraphWrite<ResolveUnknownRunInput>,
  ): Promise<WriteResult<RunSnapshot>> {
    try {
      const begun = await begin(ctx, request, RESOLVE_PREFIX, RESOLVE_KIND, 'resolve_unknown', input => {
        const problem = attestationProblem(input);
        if (problem !== null) return problem;
        if (typeof input.kernelTurnOpen !== 'boolean' || !(input.inputsConfirmed === null || typeof input.inputsConfirmed === 'boolean')) {
          return 'resolveUnknownRun requires the Kernel facts read before the attestation';
        }
        return null;
      }, attestationContent);
      if (!begun.ok) return begun.result;
      const { input, facts, intents, actor } = begun;
      // L-1: the attestation names this Host instance; without the held lease the machine answers `busy`.
      const hostInstance = deps.hostInstance;
      const basis: RunReconciliationBasisV1 = { kind: 'host_instance_takeover', hostInstanceId: hostInstance?.hostInstanceId ?? 'none' };
      const runCtx: RunGuardContext = { ...reconcileRunContext(facts, intents, actor, basis, deps, null, null),
        hostLease: hostInstance === undefined ? null : hostInstance.lease, inputsConfirmed: input.inputsConfirmed };
      const state = runStateOf(facts.run);
      const claim = facts.outbox.claim;
      const eventAt = (recordedAt: string): RunEvent => ({ kind: 'unknown_attested', claim, reason: input.reason,
        kernelTurnOpen: input.kernelTurnOpen, recordedAt, attestedBy: { kind: actor.kind, id: actor.id }, basis });
      const stamped = stamp();
      if (!stamped.ok) return stamped.rejection;
      const runEvent = eventAt(stamped.nowIso);
      const decided = transitionRun(state, runEvent, runCtx);
      if (!decided.ok) return runRefusal(decided);
      const nextRun = decided.next.record ?? facts.run;
      return await commitDecided({ identity: begun.identity, fingerprint: begun.fingerprint, actor,
        operation: 'resolve_unknown', facts, runPin: begun.pin, decided, intents, nowIso: stamped.nowIso,
        eventId: stamped.eventId, signal: begun.signal,
        claim: {
          pairing: pairingOf('EndedUnknown', facts, runCtx),
          attemptEvent: attemptEventOfEnd(runEvent, nextRun, facts, stamped.nowIso, stamped.eventId),
          release: reconcileRelease('unknown_attested', 'EndedUnknown', 'service', runCtx.hostLease,
            input.inputsConfirmed === null ? 'kernel_unreadable' : input.inputsConfirmed, facts.run.startedAt !== null),
        },
        intentFacts: { nodeBefore: 'EndedUnknown', hostInstanceId: hostInstance?.hostInstanceId ?? null, acceptedSteers: [],
          cancelRef: null, pausedStop: null, kernelPaused: false } });
    } catch (error) {
      return unavailable(`the attestation write failed: ${messageOf(error)}`);
    }
  }

  /**
   * RUN-22 replay (原回执回放, §12.10 step 4): the original receipt of an
   * attestation already committed under this request identity, or `null` when
   * none was. The Host entry asks before it compares the pin and the Run's
   * state, both of which the attestation itself changed; nothing is read but
   * the commit lookup and the recorded event. The same identity with other
   * content is `idempotency_conflict` (§1.2), and a store failure is mapped,
   * so neither falls through to the state comparison.
   */
  async function replayResolveUnknownRun(
    ctx: CoreCallContext, request: GraphWrite<AttestationRequest>,
  ): Promise<WriteResult<RunSnapshot> | null> {
    try {
      const front = identify(ctx, request, RESOLVE_PREFIX, RESOLVE_KIND, attestationProblem, attestationContent);
      if (!front.ok) return null;
      const lookup = await records.lookupCommit({ identityKey: front.identity, fingerprint: front.fingerprint });
      if (lookup.status !== 'ready') return lookup.code === 'not_found' ? null : mapStoreFailure(lookup);
      return await replay(lookup.value, front.identity, front.fingerprint, front.actor, 'resolve_unknown');
    } catch (error) {
      return unavailable(`the attestation replay failed: ${messageOf(error)}`);
    }
  }

  async function reconcileRunControls(
    ctx: CoreCallContext, request: GraphWrite<ReconcileRunControlsInput>,
  ): Promise<WriteResult<RunSnapshot>> {
    try {
      const begun = await begin(ctx, request, CONTROLS_PREFIX, 'a2-run-controls', 'reconcile_controls', input => {
        if (!isRunRef(input.runRef) || !nonEmpty(input.hostInstanceId)) {
          return 'reconcileRunControls requires the RunRef and the Host instance';
        }
        return steersProblem(input.acceptedSteers);
      });
      if (!begun.ok) return begun.result;
      const { input, facts, intents, actor } = begun;
      const basis: RunReconciliationBasisV1 = { kind: 'host_instance_takeover', hostInstanceId: input.hostInstanceId };
      let runCtx = reconcileRunContext(facts, intents, actor, basis, deps, null, null);
      if (runCtx.hostLease !== 'owned') return reject('busy', 'this Host does not hold the Host instance lease');
      const state = runStateOf(facts.run);
      const stamped = stamp();
      if (!stamped.ok) return stamped.rejection;
      const pointer = facts.run.controlState;
      let decided: Decided;
      let runEvent: RunEvent | null = null;
      let goalGuards: RecordGuard[] = [];
      let goalDesiredState: GoalSnapshot['desiredState'] | undefined;
      switch (state.node) {
        case 'Claimed':
        case 'Authorized':
        case 'Revoked': {
          // CTL-08(a): RUN-09..11 (R) for the pointer intent still queued.
          const intent = runCtx.pointerIntent;
          if (pointer === undefined || intent === null || intent.status !== 'queued') {
            return invalid('the Run has no queued pointer intent to reconcile');
          }
          // RUN-11 (R), D-9: a queued resume applies only while the Goal is active (else it stays queued);
          // the Goal read is guarded in the same commit.
          const goalRef: GoalRef = { aggregateType: 'Goal', projectId: facts.run.ref.projectId, goalId: facts.run.ref.goalId };
          const goalScope = await readGoalScope(records, goalRef);
          if (goalScope.status !== 'ready') return reject(goalScope.code, goalScope.reason);
          goalDesiredState = goalScope.goal.desiredState;
          runCtx = { ...runCtx, goal: { desiredState: goalScope.goal.desiredState, activePlanMatchesClaim: true } };
          goalGuards = [{ refKey: refKeyOf(goalRef), expectedRevision: goalScope.goal.revision }];
          runEvent = intent.kind === 'cancel'
            ? { kind: 'stop_not_entered', source: 'R', intentRef: pointer.intentRef, recordedAt: stamped.nowIso }
            : intent.kind === 'pause' ? { kind: 'pause_not_entered', source: 'R', intentRef: pointer.intentRef }
              : { kind: 'resume_not_entered', source: 'R', intentRef: pointer.intentRef };
          const moved = transitionRun(state, runEvent, runCtx);
          if (!moved.ok) return runRefusal(moved);
          decided = moved;
          break;
        }
        case 'Ended':
        case 'EndedUnknown': {
          // CTL-08(d)/(e): every intent still queued settles; the Run is only the CAS guard.
          const queued = intents.filter(intent => intent.status === 'queued').map(intent => intent.ref);
          if (queued.length === 0) return invalid('the Run has no queued control intent to reconcile');
          decided = { ok: true, next: state, effects: queued.map((intentRef): RunEffect =>
            ({ kind: 'intent', event: 'control_reconciled', intentRef })) };
          break;
        }
        case 'Absent':
        case 'Entering':
        case 'Running':
        case 'YieldedWait':
          return invalid(`a ${state.node} Run settles its intents with its own reconcile, or keeps them as the continuation fence`);
        default: return invalid('the Run node is not recognized');
      }
      const nextRun = decided.next.record ?? facts.run;
      const cancel = runEvent !== null && runEvent.kind === 'stop_not_entered';
      return await commitDecided({ identity: begun.identity, fingerprint: begun.fingerprint, actor,
        operation: 'reconcile_controls', facts, runPin: begun.pin, decided, intents, nowIso: stamped.nowIso,
        eventId: stamped.eventId, signal: begun.signal, readGuards: goalGuards,
        claim: cancel && runEvent !== null ? {
          pairing: pairingOf(state.node, facts, runCtx),
          attemptEvent: attemptEventOfEnd(runEvent, nextRun, facts, stamped.nowIso, stamped.eventId),
          release: reconcileRelease('stop_not_entered', state.node, 'service', runCtx.hostLease, true, false),
        } : null,
        intentFacts: { nodeBefore: state.node, hostInstanceId: input.hostInstanceId, acceptedSteers: input.acceptedSteers,
          cancelRef: cancel ? pointer?.intentRef ?? null : null, pausedStop: null, kernelPaused: false,
          ...(goalDesiredState === undefined ? {} : { goalDesiredState }) } });
    } catch (error) {
      return unavailable(`the control reconcile write failed: ${messageOf(error)}`);
    }
  }

  return { reconcileRun, resolveUnknownRun, replayResolveUnknownRun, reconcileRunControls };
}
