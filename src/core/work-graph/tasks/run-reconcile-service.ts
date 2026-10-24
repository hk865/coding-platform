/**
 * Run reconcile service (STATE-MACHINES-SPEC §6 RUN-16/19/20/22/23/24, §7
 * CTL-04(b)/CTL-08/CTL-10, §8 SES-05/06/07, §12; A.2 step 5.6).
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
 * - `reconcileRunControls`: the queued intents of an ended Run the reconcile
 *   settles without another Run end (CTL-08(d)/(e)).
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
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreError, CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import type { RunReconciliationBasisV1, RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalJson, sameJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { hasOnlyKeys, inList, isNonNeg, utf8Bytes } from '../../../contracts/validation/common.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import type { EncodedRecord, CommitCursorBinding, PreparedCommit, RecordGuard, StoreCommitReceipt } from '../../record-store/ports.js';
import {
  EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, EXECUTION_RUN_RECONCILED_EVENT_TYPE, encodeExecutionRunReconciledEvent,
  executionRunReconciledEventFromEvent, isExecutionAuthorizationV2, type ExecutionRunReconciledEvent,
} from '../persistence/execution-entry-codecs.js';
import { attemptEventFromRunEvent, type AttemptEvent, type AttemptGuardContext } from '../state/attempt-machine.js';
import { MAX_ATTESTATION_REASON_CHARS } from '../state/query-run-recovery.js';
import {
  runStateOf, transitionRun, type AutoCleanupCandidateV1 as StateAutoCleanupCandidate, type RunEffect, type RunEvent,
  type RunGuardContext, type RunNode, type RunTransition,
} from '../state/run-machine.js';
import { newUnknownCallReview } from '../state/unknown-call-review.js';
import { unknownCallKindOf } from '../state/unknown-call-kinds.js';
import {
  UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE, UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION,
  encodeUnknownCallReview, encodeUnknownCallReviewChangedEvent, unknownCallReviewRefKey,
} from './unknown-call-review-codecs.js';
import { createSessionFactsService } from './session-facts.js';
import { createUnknownCallReviewService } from './unknown-call-review-service.js';
import { previousChainRefOf, streakOf } from '../state/task-failure.js';
import type {
  UnknownCallInventoryProblemV1, UnknownCallReviewItemV1, UnknownCallReviewRef,
  UnknownCallReviewV1,
} from '../../../contracts/unknown-call-review.js';
import type { SessionGuardContext, SessionRelease, SessionReleaseCause } from '../state/session-availability.js';
import type { GraphWrite } from '../model/task-contracts.js';
import {
  bindTrustedContext, checkRunPin, claimEffectRecords, claimLeaseOf, claimSessionOf, executionReadGuards, hostLeaseOf,
  isRecord, isolateWrite, mapStoreFailure, mergeGuards, nonEmpty, readAdmissionFacts,
  type ClaimSessionRelease,
} from './execution-entry-service.js';
import type { TaskExecutionRecord } from '../model/execution-read-contracts.js';
import { SESSION_RECORD_SCHEMA_ID } from '../sessions/session-record-codecs.js';
import {
  outcomeUnknownIntentsOf, pointerIntentOf, queuedSteersOf, readRunIntents, reconciledIntentRecords,
  type ReconcileIntentFacts,
} from './reconcile-intents.js';
import type {
  AttestationRequest, ReconcileRunControlsInput, ReconcileRunInput, ReconcileTurnV1, ResolveUnknownRunInput,
  RunReconcileDependencies, RunReconcileService,
} from './run-reconcile-contracts.js';
import { planRunActivityForCommit } from './run-activity-service.js';
import type { RunActivityFactsV1 } from '../../../contracts/run-activity.js';

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
const PROBE_VERDICTS: readonly string[] = ['ready', 'missing', 'damaged', 'host_config', 'transient', 'cancelled'];
const UNKNOWN_CAUSES: readonly string[] = ['tool_calls_unresolved', 'kernel_unreadable', 'continuation_unrebuildable'];

function reject(code: CoreError, reason: string): CoreRejection {
  return rejected(code, reason);
}
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
/** The reason of a non-ready read that is a rejection; the two other statuses get their own words. */
function readFailureReason(read: { status: string; reason?: string }): string {
  if (read.status === 'not_found') return 'not_found';
  if (read.status === 'not_ready') return 'not readable at the required watermark';
  return read.reason ?? read.status;
}
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
// RUN-22 review draft (L8, UCR-02)
// --------------------------------------------------------------------------

const REVIEW_DRAFT_KEYS: readonly string[] = ['inventory', 'inventoryProblem', 'items', 'itemsOmitted', 'workspace'];
const DRAFT_INVENTORY_PROBLEMS: readonly UnknownCallInventoryProblemV1[] = [
  'kernel_unreadable', 'kernel_unreadable_at_stop', 'turn_not_found', 'too_many_calls', 'too_large', 'undecodable_call',
];
const CALL_ID_MAX_BYTES = 512;
const MAX_DRAFT_ITEMS = 32;

type ValidatedReviewDraft = {
  inventory: 'complete' | 'incomplete';
  inventoryProblem: UnknownCallInventoryProblemV1 | null;
  items: UnknownCallReviewItemV1[];
  itemsOmitted: number;
};

/**
 * L8's Run-side facts the owner must cross-check against the draft: the
 * reconciliation observation's reason (the `kernel_unreadable_at_stop` rule)
 * and the recorded `unresolvedToolCallIds` (the "recorded calls are listed"
 * rule). Read from the same Run the machine transitions.
 */
type ReviewDraftFacts = { observationReason: string | null; recordedToolCallIds: readonly string[] };

function reviewDraftFactsOf(run: RunSnapshot): ReviewDraftFacts {
  const observation = run.reconciliation?.observation;
  if (observation === undefined) return { observationReason: null, recordedToolCallIds: [] };
  if (observation.kind === 'unresolved') {
    return { observationReason: observation.reason, recordedToolCallIds: observation.unresolvedToolCallIds };
  }
  if (observation.kind === 'takeover_unresolved') {
    return { observationReason: null, recordedToolCallIds: observation.unresolvedToolCallIds };
  }
  return { observationReason: null, recordedToolCallIds: [] };
}

/**
 * L8's owner-side draft check: the receipt is already resolved, so this runs
 * only on a miss. A draft the trusted Host reader would not produce is
 * `invalid` and nothing is written. `inputsConfirmed === null` forces the
 * `kernel_unreadable` inventory; the draft's own recognized problem otherwise
 * stands, and a `complete` claim must carry no problem and omit nothing.
 *
 * The three Run-side L8 checks (spec 284-289): an observation reason
 * `kernel_unreadable` cannot carry a `complete` inventory; a `complete`
 * inventory lists every recorded unresolved call; a `too_large` inventory
 * lists only recorded calls and counts the rest in `itemsOmitted`.
 */
function validatedReviewDraft(
  draft: unknown, inputsConfirmed: boolean | null, facts: ReviewDraftFacts,
): { ok: true; value: ValidatedReviewDraft } | { ok: false; reason: string } {
  if (!isRecord(draft)) return { ok: false, reason: 'resolveUnknownRun requires the review draft read before the attestation' };
  if (!hasOnlyKeys(draft, REVIEW_DRAFT_KEYS)) return { ok: false, reason: 'the review draft carries unknown fields' };
  if (draft['inventory'] !== 'complete' && draft['inventory'] !== 'incomplete') {
    return { ok: false, reason: 'the review draft inventory is not recognized' };
  }
  const rawProblem = draft['inventoryProblem'];
  if (!(rawProblem === null || inList(rawProblem, DRAFT_INVENTORY_PROBLEMS))) {
    return { ok: false, reason: 'the review draft inventoryProblem is not recognized' };
  }
  if (draft['inventory'] === 'complete' && rawProblem !== null) {
    return { ok: false, reason: 'a complete review inventory must not name a problem' };
  }
  if (draft['inventory'] === 'incomplete' && rawProblem === null) {
    return { ok: false, reason: 'an incomplete review inventory must name its problem' };
  }
  const items = draft['items'];
  if (!Array.isArray(items) || items.length > MAX_DRAFT_ITEMS) {
    return { ok: false, reason: `a review holds at most ${String(MAX_DRAFT_ITEMS)} items` };
  }
  const omitted = draft['itemsOmitted'];
  if (!isNonNeg(omitted)) return { ok: false, reason: 'the review draft itemsOmitted must be a non-negative integer' };
  if (draft['inventory'] === 'complete' && omitted !== 0) {
    return { ok: false, reason: 'a complete review inventory omits nothing' };
  }
  const workspace = draft['workspace'];
  if (!isRecord(workspace) || (workspace['status'] !== 'captured' && workspace['status'] !== 'unavailable')) {
    return { ok: false, reason: 'the review draft workspace is malformed' };
  }
  if (inputsConfirmed === null && draft['inventory'] !== 'incomplete') {
    return { ok: false, reason: 'the Kernel is unreadable, so the review inventory cannot be complete' };
  }
  const checked: UnknownCallReviewItemV1[] = [];
  for (const [index, entry] of items.entries()) {
    if (!isRecord(entry)) return { ok: false, reason: `review item ${String(index)} is not an object` };
    if (entry['alias'] !== index + 1) return { ok: false, reason: 'review item aliases must be 1..n in Kernel order' };
    if (!nonEmpty(entry['toolName'])) return { ok: false, reason: `review item #${String(index + 1)} names no tool` };
    if (entry['kind'] !== unknownCallKindOf(entry['toolName'])) {
      return { ok: false, reason: `review item #${String(index + 1)} kind disagrees with L3` };
    }
    if (!nonEmpty(entry['callId']) || utf8Bytes(entry['callId']) > CALL_ID_MAX_BYTES) {
      return { ok: false, reason: `review item #${String(index + 1)} callId must be 1..512 UTF-8 bytes` };
    }
    checked.push(entry as unknown as UnknownCallReviewItemV1);
  }
  const effectiveProblem = inputsConfirmed === null ? 'kernel_unreadable' : rawProblem;
  // L8 (spec 284-289): the Run-side checks the draft must agree with.
  if (facts.observationReason === 'kernel_unreadable' && draft['inventory'] !== 'incomplete') {
    return { ok: false, reason: 'the Kernel was unreadable at stop, so the review inventory cannot be complete' };
  }
  const listedIds = checked.map(item => item.callId);
  const recordedIds = facts.recordedToolCallIds;
  if (draft['inventory'] === 'complete') {
    if (!recordedIds.every(id => listedIds.includes(id))) {
      return { ok: false, reason: 'a complete review inventory must list every recorded unresolved call' };
    }
  } else if (effectiveProblem === 'too_large') {
    if (!listedIds.every(id => recordedIds.includes(id))) {
      return { ok: false, reason: 'every listed review item must be a recorded unresolved call' };
    }
    if (omitted !== recordedIds.length - listedIds.length) {
      return { ok: false, reason: 'a too_large review inventory omits exactly the recorded calls it did not list' };
    }
  }
  return {
    ok: true,
    value: {
      inventory: effectiveProblem === null ? 'complete' : 'incomplete',
      inventoryProblem: effectiveProblem,
      items: checked,
      itemsOmitted: omitted,
    },
  };
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
  // L5/§2: a not_entered end (RUN-16, RUN-09 (R)) writes no activity; carrying
  // one is an invalid input, never silently dropped.
  if (input.activity !== undefined && (input.result as { kind?: unknown } | null | undefined)?.kind === 'not_entered') {
    return 'a not_entered reconcile must not carry activity';
  }
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
 * (no reconcile end consults it).
 */
function reconcileRunContext(
  facts: TaskExecutionRecord, intents: readonly ControlIntentSnapshotV1[], actor: HostActor,
  basis: RunReconciliationBasisV1, deps: RunReconcileDependencies, probe: RunGuardContext['kernelProbe'],
  turn: ReconcileTurnV1 | null,
  auto?: AutoCleanupFacts,
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
    // RUN-25 guards (U1/L25): G1 compares the Host's proof with the
    // candidate's own; G7/G9 are the WorkGraph side. `auto` carries the facts
    // this write read for a classifier candidate (Q5 G7, Q4 G9); every other
    // reconcile path leaves G9 unproven (so a candidate can never slip through).
    takeoverProof: deps.hostInstance?.takeover ?? null,
    sessionClosable: auto?.sessionClosable ?? false,
    priorAutoCleanup: auto?.priorAutoCleanup ?? false,
    priorUnknownProcess: auto?.priorUnknownProcess ?? false,
    streakResetRunRef: auto?.streakResetRunRef ?? null,
  };
}

/** Q4/Q5: the facts one RUN-25 candidate needs from the WorkGraph side, read before the machine decides. */
type AutoCleanupFacts = {
  /** Q5 G7: Session active, no archive request, no continuation and this Run still occupying it. */
  sessionClosable: boolean;
  /** Q4 G9 (L23): the streak of the chain the Run continues. */
  priorAutoCleanup: boolean;
  priorUnknownProcess: boolean;
  streakResetRunRef: RunRef | null;
};

/**
 * Q5 (G7): the Session is active, has no archive request, has no recorded
 * continuation, and the latest Work claim is this Run at the same claim
 * generation. A read failure is `unavailable` (the caller writes nothing).
 */
async function readSessionClosable(
  records: RunReconcileDependencies['records'], ctx: CoreCallContext, facts: TaskExecutionRecord,
): Promise<{ ok: true; value: boolean } | { ok: false; rejection: CoreRejection }> {
  const sessionFacts = createSessionFactsService({ records });
  let read;
  try {
    read = await sessionFacts.readSessionFacts(ctx, facts.outbox.claim.sessionRef);
  } catch (error) {
    return { ok: false, rejection: unavailable(`the Session facts read failed: ${messageOf(error)}`) };
  }
  if (read.status !== 'ready') {
    return { ok: false, rejection: unavailable(`the Session facts are not readable: ${readFailureReason(read)}`) };
  }
  const value = read.value;
  const occupancy = value.session.occupancy;
  const occupiedByRun = occupancy !== null && occupancy !== undefined && occupancy.kind === 'execution'
    && sameJson(occupancy.executionRef, facts.run.ref);
  const latest = value.latestWork;
  return { ok: true, value: value.session.lifecycle === 'active'
    && (value.session.archiveRequest ?? null) === null
    && value.continuations.length === 0
    && occupiedByRun
    && latest !== null && sameJson(latest.runRef, facts.run.ref)
    && latest.generation === facts.outbox.claim.generation };
}

/**
 * Q4 (G9, L23): walk the Run's work chain backwards as `task-failure.ts`
 * `chainRunIds` does, read every chain Run and its review record by key, and
 * compute `streakOf`. Every Run and record read becomes a version guard in the
 * same commit; an absent record key is guarded absent. Any read failure is
 * `unavailable` and the caller writes nothing.
 */
async function readStreakFacts(
  deps: RunReconcileDependencies, ctx: CoreCallContext, facts: TaskExecutionRecord,
): Promise<{ ok: true; streak: Pick<AutoCleanupFacts, 'priorAutoCleanup' | 'priorUnknownProcess' | 'streakResetRunRef'>;
    guards: RecordGuard[] } | { ok: false; rejection: CoreRejection }> {
  const runs: RunSnapshot[] = [facts.run];
  const guards: RecordGuard[] = [];
  const seen = new Set<string>([facts.run.ref.runId]);
  let cursor: RunSnapshot = facts.run;
  while (true) {
    const previous = previousChainRefOf(cursor);
    if (previous === null || seen.has(previous.runId)) break;
    if (previous.projectId !== facts.run.ref.projectId || previous.goalId !== facts.run.ref.goalId) break;
    let read;
    try {
      read = await deps.reads.readExecution(ctx, previous);
    } catch (error) {
      return { ok: false, rejection: unavailable(`the chain Run read failed: ${messageOf(error)}`) };
    }
    if (read.status === 'not_found') break;
    if (read.status !== 'ready') {
      return { ok: false, rejection: unavailable(`the chain Run is not readable: ${readFailureReason(read)}`) };
    }
    const record = read.value;
    seen.add(previous.runId);
    runs.push(record.run);
    guards.push({ refKey: refKeyOf(record.run.ref), expectedRevision: record.run.revision });
    cursor = record.run;
  }
  const reviews: UnknownCallReviewV1[] = [];
  const reviewService = createUnknownCallReviewService({ records: deps.records, now: deps.now, eventId: deps.eventId });
  for (const run of runs.slice(1)) {
    let review;
    try {
      review = await reviewService.readReview(ctx, { runRef: run.ref });
    } catch (error) {
      return { ok: false, rejection: unavailable(`the chain review read failed: ${messageOf(error)}`) };
    }
    if (review.status === 'not_found') {
      guards.push({ refKey: unknownCallReviewRefKey(reviewRefOfRun(run.ref)), expectedRevision: null });
      continue;
    }
    if (review.status !== 'ready') {
      return { ok: false, rejection: unavailable(`the chain review is not readable: ${readFailureReason(review)}`) };
    }
    reviews.push(review.value);
    guards.push({ refKey: unknownCallReviewRefKey(review.value.ref), expectedRevision: review.value.revision });
  }
  const streak = streakOf(facts.run, runs, reviews);
  return { ok: true, streak: { priorAutoCleanup: streak.priorAutoCleanup,
    priorUnknownProcess: streak.priorUnknownProcess, streakResetRunRef: streak.resetRunRef }, guards };
}

function reviewRefOfRun(runRef: RunRef): UnknownCallReviewRef {
  return { aggregateType: 'UnknownCallReview', projectId: runRef.projectId, goalId: runRef.goalId, runId: runRef.runId };
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
    case 'unknown': {
      // L25: the Runtime candidate is mapped onto the machine's shape,
      // which judges G3 on every unresolved call name (U1/Q1). A candidate runs
      // RUN-25 and carries the synthesized terminal event id.
      const auto = result.autoCleanup;
      const autoCleanup: StateAutoCleanupCandidate | { blockedBy: string } | undefined =
        auto === undefined ? undefined
          : 'blockedBy' in auto ? { blockedBy: auto.blockedBy }
            : { proof: auto.proof, closure: auto.closure, workspace: auto.workspace,
              unresolvedCalls: auto.unresolvedCalls, draft: auto.draft };
      return { kind: 'reconcile_unknown', claim, basis: input.basis, cause: result.cause,
        unresolvedToolCallIds: result.unresolvedToolCallIds, observedThroughPosition: result.observedThroughPosition,
        turn: result.turn === null ? null : turnFacts(result.turn), recordedAt,
        ...(autoCleanup === undefined ? {} : { autoCleanup }),
        ...(autoCleanup !== undefined && !('blockedBy' in autoCleanup) ? { factEventId } : {}) };
    }
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
      mapped = attemptEventFromRunEvent({ kind: runEvent.kind, claim, endOutcome: outcome, endedAt: recordedAt, eventId,
        sequence, entry, turnStartedAt: facts.run.startedAt === null ? runEvent.turn?.entered?.enteredAt ?? null : null });
      break;
    case 'reconcile_unknown':
      // RUN-25: the machine's synthesized terminal ends the Attempt with a
      // known outcome, which is the `reconcile_terminal` row (ATT-08..10); the
      // RUN-20(i) unknown end keeps `reconcile_unknown`.
      mapped = attemptEventFromRunEvent({ kind: outcome === 'outcome_unknown' ? 'reconcile_unknown' : 'reconcile_terminal',
        claim, endOutcome: outcome, endedAt: recordedAt, eventId, sequence, entry,
        turnStartedAt: facts.run.startedAt === null ? runEvent.turn?.entered?.enteredAt ?? null : null });
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
    // L7: a record-creating commit carries the review's
    // `UnknownCallReviewChanged@1` event too, so the original reconcile event
    // is the LAST one (the receipt cursor names it). Read it exactly.
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (!receipt.eventIds.includes(at.value.event.eventId)) {
      return unavailable('the recorded event is not part of the returned commit');
    }
    const decoded = executionRunReconciledEventFromEvent(at.value.event);
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
   * (the machine judged their status). A record-creating commit writes the
   * review's `UnknownCallReviewChanged@1` event first and the Run reconcile
   * event LAST (the receipt cursor names the reconcile event, so replay keeps
   * working without scanning the commit).
   */
  async function commitDecided(input: {
    identity: string; fingerprint: string; actor: HostActor; operation: Operation; facts: TaskExecutionRecord;
    runPin: VersionPin; decided: Decided; intents: readonly ControlIntentSnapshotV1[]; nowIso: string; eventId: string;
    claim: ClaimWrites | null; intentFacts: IntentFacts; signal: AbortSignal; requestId: string;
    /** Further records the decision read (the Goal of CTL-08(a)), guarded at the revision read. */
    readGuards?: readonly RecordGuard[];
    /** Slice 2B L5: the tally written in this SAME commit (no extra event). */
    activity?: RunActivityFactsV1;
    /**
     * RUN-22: the review record the owner built from `input.review`, written
     * in this SAME commit (UCR-02). RUN-25's record arrives as a
     * `create_review_record` effect instead.
     */
    reviewRecord?: UnknownCallReviewV1 | null;
  }): Promise<WriteResult<RunSnapshot>> {
    const { facts, decided } = input;
    const nextRun = decided.next.record ?? facts.run;
    const written: EncodedRecord[] = nextRun === facts.run ? [] : [encodeRun(nextRun)];
    const claimEffects = decided.effects.filter(effect => effect.kind !== 'intent' && effect.kind !== 'create_review_record');
    if (claimEffects.length > 0) {
      if (input.claim === null) throw new Error('a reconcile end with claim effects names its §5 event');
      const claimRecords = claimEffectRecords(claimEffects, facts, input.claim.pairing, input.claim.attemptEvent, input.claim.release);
      if (!claimRecords.ok) return claimRecords.rejection;
      written.push(...claimRecords.records);
    }
    // UCR-01/UCR-02, L7: the review record is created in the SAME commit
    // as the Run end, guarded absent, and every change (creation included)
    // writes its own `UnknownCallReviewChanged@1` event carrying the whole
    // post-change record.
    const reviewRecords: UnknownCallReviewV1[] = [
      ...decided.effects.flatMap(effect => effect.kind === 'create_review_record' ? [effect.review] : []),
      ...(input.reviewRecord === undefined || input.reviewRecord === null ? [] : [input.reviewRecord]),
    ];
    const reviewGuards: RecordGuard[] = reviewRecords.map(review =>
      ({ refKey: unknownCallReviewRefKey(review.ref), expectedRevision: null }));
    for (const review of reviewRecords) written.push(encodeUnknownCallReview(review));
    const intentWrites = reconciledIntentRecords(decided.effects, input.intents, { ...input.intentFacts,
      runBefore: facts.run, runAfter: nextRun, observedAt: input.nowIso });
    if (!intentWrites.ok) return intentWrites.rejection;
    written.push(...intentWrites.records);
    // Slice 2B L5: the RunActivity joins the SAME commit. The `unavailableSince`
    // Session cursor bindings are derived from `written` below; the RunActivity
    // has no bindable cursor field and must not drop them (§0.4).
    let activityGuard: RecordGuard | null = null;
    if (input.activity !== undefined) {
      const planned = await planRunActivityForCommit(records, { activity: input.activity, run: nextRun,
        // A reconcile that books an already-ended Run
        // (RUN-21) keeps the Run's ORIGINAL `endedAt`; `input.nowIso` is only
        // the replacement time (`recordedAt`).
        runEndedAt: nextRun.endedAt ?? input.nowIso, sessionRef: nextRun.executionHistory?.sessionRef ?? facts.outbox.claim.sessionRef,
        recordedBy: 'run_end', recordedAt: input.nowIso, endCommit: true });
      if (!planned.ok) return planned.rejection;
      if (planned.record !== null) {
        written.push(planned.record);
        activityGuard = { refKey: planned.refKey, expectedRevision: planned.existingRevision };
      }
    }
    if (written.length === 0) return invalid('the Run has nothing for the reconcile to write');
    const intentGuards: RecordGuard[] = input.intents.map(intent => ({ refKey: refKeyOf(intent.ref), expectedRevision: intent.revision }));
    const merged = mergeGuards([...executionReadGuards(facts, refKeyOf(facts.run.ref), input.runPin), ...intentGuards,
      ...intentWrites.guards, ...(input.readGuards ?? []), ...(activityGuard === null ? [] : [activityGuard]),
      ...reviewGuards]);
    if (!merged.ok) return merged.rejection;
    const event: ExecutionRunReconciledEvent = { eventId: input.eventId, eventType: EXECUTION_RUN_RECONCILED_EVENT_TYPE,
      schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, occurredAt: input.nowIso, identityKey: input.identity,
      actor: input.actor, fingerprint: input.fingerprint, operation: input.operation, run: nextRun };
    const reviewEvents = reviewRecords.map((review, index) => encodeUnknownCallReviewChangedEvent({
      eventId: `${input.eventId}:ucr:${String(index)}`, eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
      schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION, occurredAt: input.nowIso, identityKey: input.identity,
      fingerprint: input.fingerprint, actor: { kind: input.actor.kind, id: input.actor.id }, requestId: input.requestId,
      change: 'created', review }));
    const bindings = sessionCursorBindings(written);
    const prepared: PreparedCommit = { identityKey: input.identity, fingerprint: input.fingerprint, guards: merged.guards,
      records: written, claims: [], indexGuards: [], indexChanges: [],
      // The reconcile event stays last: the receipt cursor names it, which is
      // the event a replay restores the Run from.
      events: [...reviewEvents, encodeExecutionRunReconciledEvent(event)],
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
    signal: AbortSignal; identity: string; fingerprint: string; pin: VersionPin; requestId: string;
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
    return { ok: true, input, scopeCtx, scope, actor, signal, identity, fingerprint, pin: checked.pin,
      requestId: owned.requestId };
  }

  /** The shared front of the three writes: trusted context, isolation, shape, pin, identity, replay, reads. */
  async function begin<T extends { runRef: RunSnapshot['ref'] }>(
    ctx: CoreCallContext, request: GraphWrite<T>, prefix: string, kind: string, operation: Operation,
    problemOf: (input: T) => string | null, contentOf: (input: T) => unknown = input => input,
  ): Promise<{ ok: false; result: WriteResult<RunSnapshot> } | {
    ok: true; input: T; actor: HostActor; signal: AbortSignal; identity: string; fingerprint: string; pin: VersionPin;
    facts: TaskExecutionRecord; intents: ControlIntentSnapshotV1[]; requestId: string;
  }> {
    const front = identify(ctx, request, prefix, kind, problemOf, contentOf);
    if (!front.ok) return { ok: false, result: front.rejection };
    const { input, scopeCtx, scope, actor, signal, identity, fingerprint, pin, requestId } = front;
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
    return { ok: true, input, actor, signal, identity, fingerprint, pin, facts, intents: intentsRead.value, requestId };
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
      // Q4/Q5: a classifier candidate carries the WorkGraph-side guard
      // facts. Read them before the machine decides; a read failure writes
      // nothing. Every chain Run and record read is guarded in the commit.
      const candidate = result.kind === 'unknown' && result.autoCleanup !== undefined && 'proof' in result.autoCleanup
        ? result.autoCleanup : null;
      let auto: AutoCleanupFacts | undefined;
      let autoGuards: readonly RecordGuard[] = [];
      if (candidate !== null) {
        const closable = await readSessionClosable(deps.records, ctx, facts);
        if (!closable.ok) return closable.rejection;
        const streak = await readStreakFacts(deps, ctx, facts);
        if (!streak.ok) return streak.rejection;
        auto = { sessionClosable: closable.value, ...streak.streak };
        autoGuards = streak.guards;
      }
      const runCtx = reconcileRunContext(facts, intents, begun.actor, input.basis, deps, input.probe, turn, auto);
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
      // RUN-25: the takeover-unresolved close releases the Session with its
      // own cause (U2); RUN-20(i) releases nothing (releaseCauseOf -> null).
      const takeoverUnresolved = decided.effects.some(effect => effect.kind === 'create_review_record');
      const pointerRef = facts.run.controlState?.intentRef ?? null;
      return await commitDecided({ identity: begun.identity, fingerprint: begun.fingerprint, actor: begun.actor,
        operation: 'reconcile_run', facts, runPin: begun.pin, decided, intents, nowIso: stamped.nowIso,
        eventId: stamped.eventId, signal: begun.signal, readGuards: autoGuards, requestId: begun.requestId,
        claim: hasClaimEffects ? {
          pairing: pairingOf(nodeBefore, facts, runCtx),
          attemptEvent: attemptEventOfEnd(runEvent, nextRun, facts, stamped.nowIso, stamped.eventId),
          release: releaseOf(takeoverUnresolved ? 'reconcile_takeover_unresolved' : releaseCauseOf(runEvent.kind),
            cause => reconcileRelease(cause, nodeBefore, takeover ? 'reconcile' : 'service', runCtx.hostLease,
              turn?.inputsConfirmed ?? true, true)),
        } : null,
        intentFacts: { nodeBefore, hostInstanceId: takeover ? deps.hostInstance?.hostInstanceId ?? null : null,
          acceptedSteers: turn?.acceptedSteers ?? [],
          cancelRef: notEntered || runEvent.kind === 'stop_paused' ? pointerRef : null,
          // CTL-10: the pause in effect before the cancel (null when the Kernel was not paused, LA-7).
          pausedStop: result.kind === 'paused_stop'
            ? { basis: input.basis.kind, pausedBy: result.turn.kernelPaused ? result.pausedBy : null } : null,
          kernelPaused: turn?.kernelPaused ?? false, readThroughPosition: turn?.lastPosition ?? null },
        ...(input.activity === undefined ? {} : { activity: input.activity }) });
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
      // L8/UCR-02: a review round's own Run attested by the operator creates no
      // record (L15); every other unknown end creates one in this same commit.
      const createsReview = facts.run.purpose?.kind !== 'unknown_call_review';
      let draft: ValidatedReviewDraft | null = null;
      if (createsReview) {
        const checked = validatedReviewDraft(input.review, input.inputsConfirmed, reviewDraftFactsOf(facts.run));
        if (!checked.ok) return invalid(checked.reason);
        draft = checked.value;
      }
      // Q4 (L23): the record carries the chain's streak; the chain Runs and
      // records read are guarded in this same commit.
      let streakFacts: Pick<AutoCleanupFacts, 'priorAutoCleanup' | 'priorUnknownProcess' | 'streakResetRunRef'> | null = null;
      let autoGuards: readonly RecordGuard[] = [];
      if (draft !== null) {
        const streak = await readStreakFacts(deps, ctx, facts);
        if (!streak.ok) return streak.rejection;
        streakFacts = streak.streak;
        autoGuards = streak.guards;
      }
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
      let reviewRecord: UnknownCallReviewV1 | null = null;
      if (draft !== null) {
        const reviewRef: UnknownCallReviewRef = { aggregateType: 'UnknownCallReview', projectId: facts.run.ref.projectId,
          goalId: facts.run.ref.goalId, runId: facts.run.ref.runId };
        const built = newUnknownCallReview({
          ref: reviewRef, workspaceId: facts.run.workspaceSnapshot.workspaceId, task: facts.run.task, runRef: facts.run.ref,
          sessionRef: claim.sessionRef,
          origin: { kind: 'human_attested', attestedBy: { kind: actor.kind, id: actor.id }, reason: input.reason },
          inventory: draft.inventory, inventoryProblem: draft.inventoryProblem, items: draft.items,
          itemsOmitted: draft.itemsOmitted, workspace: input.review.workspace,
          streak: { priorAutoCleanup: streakFacts?.priorAutoCleanup === true,
            priorUnknownProcess: streakFacts?.priorUnknownProcess === true,
            resetRunRef: streakFacts?.streakResetRunRef ?? null },
          createdAt: stamped.nowIso,
        });
        if (!built.ok) return reject(built.code, built.detail);
        reviewRecord = built.next;
      }
      return await commitDecided({ identity: begun.identity, fingerprint: begun.fingerprint, actor,
        operation: 'resolve_unknown', facts, runPin: begun.pin, decided, intents, nowIso: stamped.nowIso,
        eventId: stamped.eventId, signal: begun.signal, reviewRecord, readGuards: autoGuards, requestId: begun.requestId,
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
      let decided: Decided;
      switch (state.node) {
        case 'Ended':
        case 'EndedUnknown': {
          // CTL-08(d)/(e): every intent still queued settles; the Run is only the CAS guard.
          const queued = intents.filter(intent => intent.status === 'queued').map(intent => intent.ref);
          if (queued.length === 0) return invalid('the Run has no queued control intent to reconcile');
          decided = { ok: true, next: state, effects: queued.map((intentRef): RunEffect =>
            ({ kind: 'intent', event: 'control_reconciled', intentRef })) };
          break;
        }
        // A Claimed/Authorized/Revoked Run applies its control in the
        // submitting commit, never here, so it joins the illegal-call group.
        case 'Claimed':
        case 'Authorized':
        case 'Revoked':
        case 'Absent':
        case 'Entering':
        case 'Running':
        case 'YieldedWait':
          return invalid(`a ${state.node} Run settles its intents with its own reconcile, or keeps them as the continuation fence`);
        default: return invalid('the Run node is not recognized');
      }
      return await commitDecided({ identity: begun.identity, fingerprint: begun.fingerprint, actor,
        operation: 'reconcile_controls', facts, runPin: begun.pin, decided, intents, nowIso: stamped.nowIso,
        eventId: stamped.eventId, signal: begun.signal, claim: null, requestId: begun.requestId,
        intentFacts: { nodeBefore: state.node, hostInstanceId: input.hostInstanceId, acceptedSteers: input.acceptedSteers,
          cancelRef: null, pausedStop: null, kernelPaused: false } });
    } catch (error) {
      return unavailable(`the control reconcile write failed: ${messageOf(error)}`);
    }
  }

  return { reconcileRun, resolveUnknownRun, replayResolveUnknownRun, reconcileRunControls };
}
