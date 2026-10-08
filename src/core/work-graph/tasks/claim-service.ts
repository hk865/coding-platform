/**
 * R4c.1 — atomic Task ownership admission.
 *
 * One `claimTask` call binds a trusted Host request to ONE atomic Store commit:
 * `TaskLease@1`, the claimed `TaskAttempt@1`, a `Run@1` still `starting`, the
 * pending `DispatchOutboxEntry@1` carrying the immutable `TaskClaim`, and the
 * Session revision+1 with `occupancy.execution`. It authorizes NOTHING beyond
 * ownership: no Kernel call, no prepare, no material consumption and no release.
 *
 * Order matters (frozen by behavior tests):
 *   1. isolate ctx/request synchronously, keeping the original AbortSignal;
 *   2. validate shape/scope/expected and compute identity+fingerprint;
 *   3. look up the original receipt — a replay is restored from the recorded
 *      `TaskClaimed` event and never re-reads current state, the clock or ids;
 *   4. on a miss, read the current Goal/accepted Plan/Workspace/Session, the
 *      directed canonical task facts and the current role facts;
 *   5. check eligibility/budget, compile ONE PreparedCommit, re-check cancel and
 *      commit. Every guard conflict leaves zero records and zero occupancy.
 *
 * The claim is decided by the pure machines (STATE-MACHINES-SPEC §4-§10):
 * TASK-01..03 (`state/task-machine.ts`) are asked after each read with the
 * facts read so far (a fact not read yet holds), so a refused guard stops the
 * reads where they always stopped, and the Session admission (absent Session
 * included) and the claim generation are SES-02's
 * (`state/session-availability.ts`), the saved reply MSG-10's
 * (`state/message-machine.ts`). The accepted `task_claimed` names the five
 * records; `claimRecords` takes each from its own machine (RUN-01,
 * ATT-01/14/15/24, SES-02) and all are written in the one commit.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext, MaterialReader } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type {
  ConsumedWaitV1, DispatchOutboxRef, RoleBindingRefV1, RunContinuationV1, RunRef, RunSnapshot, TaskAttemptRef,
  TaskEligibility, TaskLeaseSnapshot, TaskTriple,
} from '../../../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot, RuntimeTask } from '../../../contracts/plan.js';
import { revisionAssignments } from '../../../contracts/plan.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { RoleSpecResolutionV1 } from '../../../contracts/role-spec-materials.js';
import { roleSpecContentDigest } from '../../../contracts/role-spec.js';
import { isAutomationActor, type TaskRequeueRef, type TaskRequeueSnapshotV1 } from '../../../contracts/task-requeue.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreFailure,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import {
  decodeSessionRecord, encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import {
  taskLeaseNodeOf, transitionAttempt, transitionDispatchOutbox, transitionTaskLease,
  type AttemptClaimBasis, type AttemptEvent, type AttemptGuardContext,
} from '../state/attempt-machine.js';
import { messageMachineStateOf, messageSatisfiesWait } from '../state/message-machine.js';
import {
  runControlNodeOf, runStateOf, transitionRun, type ClaimRequeueFacts, type RunEvent, type RunGuardContext,
} from '../state/run-machine.js';
import {
  occupancyAdmissionProblem, occupySessionRecord, sessionDispatchAdmissionProblem, sessionMachineStateOf,
  transitionSession, type SessionOccupation,
} from '../state/session-availability.js';
import {
  taskClaimProblem, taskMachineStateOf, transitionTask,
  type TaskClaimFacts, type TaskClaimSubject, type TaskEffect, type TaskPhaseFacts,
} from '../state/task-machine.js';
import type { Rejected as Refusal } from '../state/transition.js';
import {
  encodeDispatchOutboxEntry, encodeTaskAttemptSnapshot,
  encodeTaskClaimedEvent, taskClaimedEventFromEvent, type TaskClaimedEvent,
} from './claim-record-codecs.js';
import type { ClaimTaskInput, TaskClaim, TaskClaimDependencies, TaskClaimPort } from '../model/claim-contracts.js';
import type { SessionFactsV1, SessionWorkWaitV1 } from '../model/session-facts-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import { evaluateEligibility } from './eligibility.js';
import {
  readCanonicalTaskFacts, readGoal, readPlan, sameCursor,
  type CanonicalTaskFacts, type CanonicalTaskState, type Rejected,
} from './plan-readers.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import { decodeSessionMessageRecord, sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { taskRequeueRefProblem } from '../persistence/rework-codecs.js';
import { createSessionFactsService } from './session-facts.js';
import { createLegacySessionProvenanceReader } from './session-provenance-facts.js';

const RUN_SCHEMA_ID = 'RunSnapshot@1';
const TASK_LEASE_SCHEMA_ID = 'TaskLeaseSnapshot@1';
const CLAIM_CONTINUATION_PREFIX = 'claim-continuation:';
const CLAIM_IDENTITY_PREFIX = 'task-claim:';

type Records = GoalRecordTransactionPort & RecordLookupPort;

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isPositiveBudget(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function busy(reason: string): CoreRejection { return reject('busy', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function incomplete(reason: string): CoreRejection { return reject('incomplete', reason); }

function sameHostActor(left: unknown, right: unknown): boolean {
  return isRecord(left) && isRecord(right) && left['kind'] === right['kind'] && left['id'] === right['id']
    && (left['kind'] === 'human' || left['kind'] === 'system');
}
function refKeyOf(ref: unknown): string {
  return canonicalJson(ref as JsonValue);
}
function sameRef(left: unknown, right: unknown): boolean {
  try { return refKeyOf(left) === refKeyOf(right); } catch { return false; }
}
function pinsFromCurrent(current: readonly { refKey: string; revision: number | null }[]): VersionPin[] {
  const pins: VersionPin[] = [];
  for (const entry of current) {
    if (entry.revision === null) continue;
    try {
      const ref = JSON.parse(entry.refKey) as unknown;
      if (isRecord(ref)) pins.push({ ref: ref as VersionPin['ref'], revision: entry.revision });
    } catch { /* unreadable ref key is not a pin */ }
  }
  return pins;
}
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'revision_conflict': {
      const current = pinsFromCurrent(failure.current);
      return reject('revision_conflict', failure.reason, current.length > 0 ? current : undefined);
    }
    case 'unique_conflict':
      return reject('revision_conflict', `${failure.reason} (the unique slot is held by another owner)`);
    case 'idempotency_conflict': return reject('idempotency_conflict', failure.reason);
    case 'not_found': return reject('not_found', failure.reason);
    case 'invalid': return reject('invalid', failure.reason);
    case 'unsupported': return reject('unsupported', failure.reason);
    case 'corrupt': return unavailable(failure.reason);
    default: return unavailable(failure.reason);
  }
}
function mapReaderRejection(rejection: Rejected): CoreRejection {
  return reject(rejection.code, rejection.reason);
}

/** Shared ReadResult -> CoreRejection mapping for a resolved domain read. */
function mapReadResult<T>(result: Exclude<ReadResult<T>, { status: 'ready' }>): CoreRejection {
  if (result.status === 'not_found') return reject('not_found', 'the requested record does not exist');
  if (result.status === 'not_ready') return reject('incomplete', 'the read is not ready at the required watermark');
  return result;
}

/** A machine refusal keeps its CoreError and text (STATE-MACHINES-SPEC §1.2). */
function rejectionOf(refusal: Refusal | null): CoreRejection | null {
  return refusal === null || refusal.ok ? null : reject(refusal.code, refusal.detail);
}

// --------------------------------------------------------------------------
// S1-DISPATCH-01: the direct Work-claim exclusion (spec §3.2, §3.3)
// --------------------------------------------------------------------------

/**
 * S1-DISPATCH-01: the direct Work-claim Session exclusion. `facts` is the
 * trusted Session read (`tasks/session-facts.ts`; this service uses that
 * submodule directly, §0.2 L1) and `consumedWait` is the continuation wait the
 * claim names, or `null` for a first/requeue claim. The two only admit the exact
 * same-Task/Run/message `consumedWait` exception; a copy provenance is
 * `forbidden`, a pending archive request or another wait is `busy`. Returns the
 * owner rejection, or `null` to admit. The machine decision itself is
 * `state/session-availability.ts:sessionDispatchAdmissionProblem`.
 */
export function workClaimDispatchProblem(
  facts: SessionFactsV1,
  consumedWait: SessionWorkWaitV1 | null,
): CoreRejection | null {
  const refusal = sessionDispatchAdmissionProblem(facts.session, {
    purpose: 'work',
    waiting: facts.wait,
    consumedWait,
    readonlyQueryMatches: false,
    legacyProvenance: null,
  });
  return refusal === null || refusal.ok ? null : reject(refusal.code, refusal.detail);
}

// --------------------------------------------------------------------------
// Claim facts for the state machines
// --------------------------------------------------------------------------

/** TASK-01..03 subject before the Task is read: every guard on it holds. */
const UNREAD_TASK: TaskClaimSubject = { taskKind: 'work', disposition: 'active', phase: 'pending' };
/** A continuation's prior Run before it is read: every guard on it holds. */
const UNREAD_PRIOR: NonNullable<TaskClaimFacts['prior']> = { node: 'YieldedWait', pointer: 'none', bindingProblem: null,
  leaseReleasedByPrior: true, replyProblem: null };
/** A requeue claim's TaskRequeue before it is read: every guard on it holds. */
const UNREAD_REQUEUE: ClaimRequeueFacts = { coversSelectedRun: true, leaseReleasedByAfterRun: true, budgetPinned: true };
/** The Attempt and Outbox of a claim are created with no paired Run yet (§5.2: `Absent` only while claiming). */
const CLAIMING: AttemptGuardContext = { runNode: 'Absent', runLastEventSeq: 0, ownsSession: false, ownsLease: false };

/** First claim, W2 continuation, or a claim after a TaskRequeue (D-3, TASK-03). */
function claimBasisOf(input: ClaimTaskInput): AttemptClaimBasis {
  if (input.consumedWait !== undefined) return { kind: 'continuation', consumedWait: input.consumedWait };
  if (input.requeueRef !== undefined) return { kind: 'requeue', requeueRef: input.requeueRef };
  return { kind: 'first' };
}

/**
 * The projection inputs (§4.1) of the claimed Task from its directed canonical
 * read (`plan-readers.ts` `readCanonicalTaskFacts`): the selected Run, the
 * applicable Reduction, the selected Run's round-chain signal, and an
 * unresolvable origin, which that read shows only as a `blocked` Task with
 * neither Run nor Reduction, and the TaskRequeue covering the selected Run
 * (P4). `null` when the read lacks the Run or Reduction it selected.
 */
function claimPhaseFacts(task: RuntimeTask, state: CanonicalTaskState, read: CanonicalTaskFacts): TaskPhaseFacts | null {
  const execution = state.execution;
  const selectedRun = execution === null ? null
    : (read.runsByTaskId.get(task.taskId) ?? []).find(run => sameRef(run.ref, execution)) ?? null;
  if (execution !== null && selectedRun === null) return null;
  const applicableReduction = state.reductionRevision === null ? null : read.reductionsByTaskId.get(task.taskId) ?? null;
  if (state.reductionRevision !== null && applicableReduction === null) return null;
  return {
    taskKind: task.taskKind,
    applicableReduction,
    selectedRun,
    originUnresolvable: selectedRun === null && applicableReduction === null && state.effectivePhase === 'blocked',
    round: read.roundsByTaskId.get(task.taskId) ?? { kind: 'none' },
    coveringRequeue: state.requeueRef,
  };
}

/**
 * TASK-03 facts of the TaskRequeue the claim names (D-3, TD-3, ATT-16, C1):
 * read among this Task's TaskRequeues of the same window; `null` when the ref
 * names none of them. It covers the selected Run when the projection's
 * covering requeue is this ref (P4); the released lease must name its afterRun;
 * a pinned budget must equal the claim budget.
 */
function requeueClaimFacts(
  requeueRef: TaskRequeueRef, state: CanonicalTaskState, requeues: readonly TaskRequeueSnapshotV1[],
  lease: TaskLeaseSnapshot | null, input: ClaimTaskInput,
): ClaimRequeueFacts | null {
  const requeue = requeues.find(candidate => sameRef(candidate.ref, requeueRef));
  if (requeue === undefined) return null;
  return {
    coversSelectedRun: state.requeueRef !== null && sameRef(state.requeueRef, requeueRef),
    leaseReleasedByAfterRun: lease !== null && lease.release !== undefined
      && lease.release.runRef.runId === requeue.ref.afterRunId,
    budgetPinned: requeue.budget === null || sameRef(requeue.budget, input.budget),
  };
}

/**
 * The structural reasons of the shared eligibility rule as `incomplete`
 * (`plan_only`, missing assignment, unread phase); the phase and lease reasons
 * are judged by TASK-01..03 from the Task state with the same texts.
 */
function structuralProblemOf(eligibility: TaskEligibility): CoreRejection | null {
  const first = eligibility.reasons[0];
  if (first === undefined) return null;
  switch (first.code) {
    case 'task_state_incomplete':
    case 'task_planning_only':
    case 'task_assignment_missing':
      return incomplete(first.message);
    default:
      return null;
  }
}

/** The yielded continuation names this wait message, Task and Session. */
function continuationBindingProblem(
  continuation: RunContinuationV1, consumedWait: ConsumedWaitV1, input: ClaimTaskInput,
): CoreRejection | null {
  if (!sameRef(continuation.messageRef, consumedWait.messageRef)) {
    return busy('the continuation wait message does not match the yielded Run');
  }
  if (continuation.task.taskId !== input.taskId || continuation.task.goalId !== input.goalRef.goalId) {
    return forbidden('the continuation prior Run belongs to another Task');
  }
  if (continuation.sessionRef.sessionId !== input.sessionRef.sessionId) {
    return forbidden('the continuation prior Run used another Session');
  }
  return null;
}

/**
 * TASK-02 facts of the yielded prior Run. Its node is the one §6 reads
 * (`runControlNodeOf`: only an `ended` yielded Run with its continuation is
 * `YieldedWait`). A queued wait-window pause/cancel (its pointer) holds the
 * continuation; the lease, `released` as §5 reads it (`taskLeaseNodeOf`), must
 * name THIS prior Run as holder, so an older wait cannot be consumed again
 * after a later consumption moved the holder. The saved reply is read
 * afterwards (MSG-10).
 */
function continuationPrior(
  prior: RunSnapshot, lease: TaskLeaseSnapshot | null, consumedWait: ConsumedWaitV1, input: ClaimTaskInput,
): NonNullable<TaskClaimFacts['prior']> {
  return {
    node: runControlNodeOf(prior),
    pointer: runStateOf(prior).pointer,
    bindingProblem: prior.continuation === undefined ? null : continuationBindingProblem(prior.continuation, consumedWait, input),
    leaseReleasedByPrior: lease !== null && taskLeaseNodeOf(lease) === 'released' && lease.holderRunId === prior.ref.runId,
    replyProblem: null,
  };
}

/** The claim deadline (new requests only) must be a legal instant after the injected clock. */
function deadlineProblem(deadline: string | null, nowMs: number): CoreRejection | null {
  if (deadline === null) return null;
  const deadlineMs = Date.parse(deadline);
  if (!Number.isFinite(deadlineMs)) return reject('invalid', 'budget.deadline is not a legal instant');
  if (!(deadlineMs > nowMs)) return reject('capacity', 'budget.deadline has passed');
  return null;
}

/**
 * RUN-01's guard context (§6.1), built once TASK-01..03 accepted the claim:
 * the Run reads the Goal and the claim facts (TASK-01..03 already judged kind,
 * disposition and eligibility); every entry, control and reconcile fact
 * belongs to later Run events.
 */
function claimRunContext(facts: TaskClaimFacts, actor: Extract<ActorRef, { kind: 'human' | 'system' }>): RunGuardContext {
  return {
    // TASK-01..03 accepted SES-02's verdict (`facts.sessionProblem === null`): an active, available, unoccupied Session.
    session: { usable: true, owned: false, kernel: null },
    lease: 'missing',
    persistedClaim: null,
    goal: { desiredState: facts.goalDesiredState, activePlanMatchesClaim: facts.activePlanMatchesClaim },
    entryPlan: 'active_plan',
    continuationBrief: 'absent_ok',
    freshAdmission: null,
    pointerIntent: null,
    queuedSteers: [],
    continuationConsumed: false,
    exitProof: null,
    hostLease: null,
    kernelProbe: null,
    kernelPaused: false,
    inputsConfirmed: null,
    actor: isAutomationActor(actor) ? 'system' : 'human',
    claim: { sessionOccupied: false, eligibility: null, taskHasRun: facts.taskHasRun,
      prior: facts.prior, requeue: facts.requeue, admission: facts.admission },
  };
}

/**
 * The Run and TaskLease rows are their plain JSON snapshot (serialization only,
 * §14.2). Typed as the records, so a literal passed here is checked by §14.3 R1.
 */
function snapshotRecord(schemaId: string, snapshot: RunSnapshot | TaskLeaseSnapshot): EncodedRecord {
  return { refKey: refKeyOf(snapshot.ref), schemaId, revision: snapshot.revision, json: JSON.stringify(snapshot) };
}

type ClaimRecords = { lease: EncodedRecord; attempt: EncodedRecord; run: EncodedRecord; outbox: EncodedRecord;
  session: EncodedRecord };

/**
 * Translates the effects of TASK-01..03's `task_claimed` into its five
 * records, each from its own machine: the Lease (ATT-14 creates it @1; ATT-15
 * re-holds the continuation's SAME released record @k+1 without its `release`
 * marker), the Attempt (ATT-01), the Run (RUN-01, whose own effects name these
 * same rows), the Outbox (ATT-24) and the Session SES-02 occupied.
 */
function claimRecords(effects: readonly TaskEffect[], write: {
  run: Extract<RunEvent, { kind: 'claim_committed' }>; runContext: RunGuardContext;
  lease: TaskLeaseSnapshot | null; session: SessionRecord; occupation: SessionOccupation;
}): ClaimRecords | CoreRejection {
  const event: Extract<AttemptEvent, { kind: 'attempt_claimed' }> = {
    kind: 'attempt_claimed', claim: write.run.claim, basis: write.run.basis };
  const records: Partial<ClaimRecords> = {};
  for (const effect of effects) {
    switch (effect.kind) {
      case 'hold_lease': {
        const held = transitionTaskLease(write.lease, event);
        if (!held.ok) return reject(held.code, held.detail);
        if (held.next !== null) records.lease = snapshotRecord(TASK_LEASE_SCHEMA_ID, held.next);
        break;
      }
      case 'create_attempt': {
        const created = transitionAttempt(null, event, CLAIMING);
        if (!created.ok) return reject(created.code, created.detail);
        records.attempt = encodeTaskAttemptSnapshot(created.next);
        break;
      }
      case 'create_run': {
        const created = transitionRun(runStateOf(null), write.run, write.runContext);
        if (!created.ok) return reject(created.code, created.detail);
        if (created.next.record !== null) records.run = snapshotRecord(RUN_SCHEMA_ID, created.next.record);
        break;
      }
      case 'create_outbox': {
        const created = transitionDispatchOutbox(null, event, CLAIMING);
        if (!created.ok) return reject(created.code, created.detail);
        records.outbox = encodeDispatchOutboxEntry(created.next);
        break;
      }
      case 'occupy_session':
        records.session = encodeSessionRecord(occupySessionRecord(write.session, write.occupation));
        break;
      default:
        throw new Error(`task_claimed has no ${effect.kind} effect`);
    }
  }
  const { lease, attempt, run, outbox, session } = records;
  if (lease === undefined || attempt === undefined || run === undefined || outbox === undefined || session === undefined) {
    throw new Error('task_claimed must write the lease, attempt, run, outbox and Session records');
  }
  return { lease, attempt, run, outbox, session };
}

// --------------------------------------------------------------------------
// Synchronous input isolation
// --------------------------------------------------------------------------

type OwnedCtx = { ok: true; ctx: CoreCallContext; actor: Extract<ActorRef, { kind: 'human' | 'system' }> }
  | { ok: false; rejection: CoreRejection };

/** Bind the trusted Host scope and identity before the first await; the
 * AbortSignal is preserved by reference so cancellation is never lost. */
function ownCallContext(ctx: CoreCallContext): OwnedCtx {
  const raw = ctx as unknown as {
    projectId?: unknown; workspaceId?: unknown; principal?: unknown; materialReader?: unknown; signal?: unknown;
  } | null | undefined;
  if (raw === null || raw === undefined) return { ok: false, rejection: reject('invalid', 'a Task claim requires a bound call context') };
  const projectId = raw.projectId;
  const workspaceId = raw.workspaceId;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId)) {
    return { ok: false, rejection: forbidden('a Task claim requires a bound project/workspace context') };
  }
  const signal = raw.signal;
  if (typeof signal !== 'object' || signal === null
    || typeof (signal as { aborted?: unknown }).aborted !== 'boolean'
    || typeof (signal as { addEventListener?: unknown }).addEventListener !== 'function') {
    return { ok: false, rejection: forbidden('a Task claim requires the bound AbortSignal') };
  }
  let principal: unknown;
  let materialReader: unknown;
  try {
    principal = structuredClone(raw.principal);
    materialReader = structuredClone(raw.materialReader);
  } catch {
    return { ok: false, rejection: reject('invalid', 'the call context identity cannot be isolated from the caller') };
  }
  if (!isRecord(principal) || principal['kind'] !== 'host') {
    return { ok: false, rejection: forbidden('a Task claim requires a trusted Host principal') };
  }
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return { ok: false, rejection: forbidden('a Task claim requires a trusted Host actor') };
  }
  if (!isRecord(materialReader) || materialReader['kind'] !== 'host'
    || materialReader['projectId'] !== projectId
    || (materialReader['workspaceId'] !== undefined && materialReader['workspaceId'] !== workspaceId)
    || !sameHostActor(materialReader['actor'], actor)) {
    return { ok: false, rejection: forbidden('the material reader is not the same trusted Host scope') };
  }
  return { ok: true,
    ctx: { projectId, workspaceId, principal: principal as CoreCallContext['principal'],
      materialReader: materialReader as MaterialReader, signal: signal as AbortSignal },
    actor: { kind: actor['kind'], id: actor['id'] } };
}

type OwnedRequest = { ok: true; input: ClaimTaskInput; requestId: string; expected: readonly VersionPin[] }
  | { ok: false; rejection: CoreRejection };

function ownRequest(request: GraphWrite<ClaimTaskInput>): OwnedRequest {
  const raw = request as unknown as { input?: unknown; meta?: unknown } | null | undefined;
  if (raw === null || raw === undefined || !isRecord(raw.input)) {
    return { ok: false, rejection: reject('invalid', 'a Task claim requires a request input object') };
  }
  const meta = raw.meta;
  if (!isRecord(meta) || !nonEmpty(meta['requestId'])) {
    return { ok: false, rejection: reject('invalid', 'a Task claim requires meta.requestId') };
  }
  if (!Array.isArray(meta['expected'])) {
    return { ok: false, rejection: reject('invalid', 'meta.expected must be an array of version pins') };
  }
  let input: ClaimTaskInput;
  let expected: readonly VersionPin[];
  try {
    input = structuredClone(raw.input) as ClaimTaskInput;
    expected = structuredClone(meta['expected']) as VersionPin[];
  } catch {
    return { ok: false, rejection: reject('invalid', 'the Task claim request cannot be isolated from the caller') };
  }
  return { ok: true, input, requestId: meta['requestId'], expected };
}

// --------------------------------------------------------------------------
// Shape validation
// --------------------------------------------------------------------------

function validateInputShape(input: ClaimTaskInput, scope: WorkspaceScope): CoreRejection | null {
  const goalRef = input.goalRef;
  if (!isRecord(goalRef) || goalRef['aggregateType'] !== 'Goal' || !nonEmpty(goalRef['projectId']) || !nonEmpty(goalRef['goalId'])) {
    return reject('invalid', 'claimTask requires a complete GoalRef');
  }
  if (goalRef['projectId'] !== scope.projectId) return forbidden('the Goal belongs to another project');
  const planRef = input.planRef;
  if (!isRecord(planRef) || planRef['aggregateType'] !== 'PlanRevision' || !nonEmpty(planRef['projectId']) || !nonEmpty(planRef['planId'])) {
    return reject('invalid', 'claimTask requires a complete PlanRevisionRef');
  }
  if (planRef['projectId'] !== scope.projectId) return forbidden('the Plan belongs to another project');
  if (!nonEmpty(input.taskId)) return reject('invalid', 'claimTask requires a taskId');
  const sessionRef = input.sessionRef;
  if (!isRecord(sessionRef) || !nonEmpty(sessionRef['projectId']) || !nonEmpty(sessionRef['sessionId'])) {
    return reject('invalid', 'claimTask requires a complete SessionRef');
  }
  if (sessionRef['projectId'] !== scope.projectId) return forbidden('the Session belongs to another project');
  const binding = input.roleBinding;
  if (!isRecord(binding) || binding['schemaVersion'] !== 1 || !nonEmpty(binding['bindingId'])
    || !nonEmpty(binding['templateId']) || !nonEmpty(binding['templateRevision']) || !nonEmpty(binding['policyRevision'])
    || typeof binding['bindingVersion'] !== 'number' || !Number.isSafeInteger(binding['bindingVersion'])
    || binding['bindingVersion'] < 1) {
    return reject('invalid', 'claimTask requires a complete RoleBindingRefV1');
  }
  const budget = input.budget;
  if (!isRecord(budget) || !isPositiveBudget(budget['tokenBudget'])) {
    return reject('invalid', 'budget.tokenBudget must be a positive safe integer');
  }
  const deadline = budget['deadline'];
  if (!(deadline === null || (typeof deadline === 'string' && deadline.length > 0 && Number.isFinite(Date.parse(deadline))))) {
    return reject('invalid', 'budget.deadline must be null or a legal instant');
  }
  if (input.requeueRef !== undefined) {
    // TD-3: a requeue claim never consumes a wait, and names a TaskRequeue of this Task.
    if (input.consumedWait !== undefined) return reject('invalid', 'requeueRef and consumedWait are exclusive');
    const requeueProblem = taskRequeueRefProblem(input.requeueRef, 'claimTask requeueRef');
    if (requeueProblem !== null) return reject('invalid', requeueProblem);
    if (input.requeueRef.projectId !== scope.projectId || input.requeueRef.goalId !== goalRef['goalId']
      || input.requeueRef.taskId !== input.taskId) {
      return reject('invalid', 'the requeueRef names another Task');
    }
  }
  return null;
}

type ExpectedPins = { goal: VersionPin; workspace: VersionPin; session: VersionPin };

function validateExpected(
  expected: readonly VersionPin[],
  goalRef: GoalRef,
  workspaceRef: { aggregateType: 'Workspace'; projectId: string; workspaceId: string },
  sessionRef: { projectId: string; sessionId: string },
): { ok: true; pins: ExpectedPins } | { ok: false; rejection: CoreRejection } {
  if (expected.length !== 3) return { ok: false, rejection: reject('invalid', 'meta.expected must contain exactly Goal, Workspace and Session') };
  for (const pin of expected as readonly unknown[]) {
    if (!isRecord(pin) || !isRecord(pin['ref']) || !isSafeRevision(pin['revision'])) {
      return { ok: false, rejection: reject('invalid', 'every expected pin needs a ref and a safe non-negative revision') };
    }
  }
  const goalKey = refKeyOf(goalRef);
  const workspaceKey = refKeyOf(workspaceRef);
  const sessionKey = refKeyOf(plainSessionRefToAggregate(sessionRef));
  const goalIndex = expected.findIndex(pin => refKeyOf(pin.ref) === goalKey);
  const workspaceIndex = expected.findIndex(pin => refKeyOf(pin.ref) === workspaceKey);
  const sessionIndex = expected.findIndex(pin => refKeyOf(pin.ref) === sessionKey);
  if (goalIndex < 0 || workspaceIndex < 0 || sessionIndex < 0
    || new Set([goalIndex, workspaceIndex, sessionIndex]).size !== 3) {
    return { ok: false, rejection: reject('invalid', 'meta.expected must be the Goal, Workspace and Session pins without duplicates or extras') };
  }
  return { ok: true, pins: { goal: expected[goalIndex]!, workspace: expected[workspaceIndex]!, session: expected[sessionIndex]! } };
}

/** True only for values the JCS `canonicalJson` serializes faithfully. It
 * rejects bigint/undefined/function/symbol and non-plain objects, which the
 * serializer would otherwise render as `{}` instead of failing.
 *
 * `path` is the WeakSet of objects on the CURRENT recursion path only: it is
 * removed on the way out so a repeated shared reference is not mistaken for a
 * cycle, while a genuine cycle stops recursion instead of overflowing. */
function isCanonicalJsonValue(value: unknown, path: WeakSet<object> = new WeakSet()): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      break;
    default:
      return false;
  }
  const object = value as object;
  if (path.has(object)) return false;
  path.add(object);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!isCanonicalJsonValue(item, path)) return false;
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const item of Object.values(value as Record<string, unknown>)) {
      if (!isCanonicalJsonValue(item, path)) return false;
    }
    return true;
  } finally {
    path.delete(object);
  }
}

/** Reject a request whose isolated payload is not canonicalizable JSON (e.g. a
 * bigint smuggled into a nested ref, or a cycle / unsupported depth) instead of
 * letting a canonicalization error (or a silent `{}`) escape the port. Only
 * this JSON boundary is guarded; Store or other failures are never swallowed. */
function canonicalizeRequest(input: ClaimTaskInput, expected: readonly VersionPin[]): CoreRejection | null {
  try {
    if (!isCanonicalJsonValue(input) || !isCanonicalJsonValue(expected)) {
      return reject('invalid', 'the Task claim request is not canonicalizable JSON');
    }
    canonicalJson(input as unknown as JsonValue);
    canonicalJson(expected as unknown as JsonValue);
    return null;
  } catch {
    return reject('invalid', 'the Task claim request is not canonicalizable JSON');
  }
}

// --------------------------------------------------------------------------
// Role identity match
// --------------------------------------------------------------------------

function roleMatchRejection(
  sessionRole: RoleConfigurationRef,
  binding: RoleBindingRefV1,
  resolution: RoleSpecResolutionV1,
): CoreRejection | null {
  if (resolution.status === 'inadmissible') {
    const details = resolution.reasons.map(reason => reason.code).join(',');
    return forbidden(`the role binding is not admissible: ${details}`);
  }
  if (resolution.status === 'resolved') {
    if (sessionRole.kind !== 'role_spec') {
      return forbidden('the resolved role spec does not match a legacy Session template');
    }
    if (resolution.roleId !== binding.templateId) return forbidden('the resolved role id does not match the binding');
    if (refKeyOf(resolution.revision) !== refKeyOf(sessionRole.pin.ref)) {
      return forbidden('the resolved role spec revision is not the Session pin');
    }
    const digest = roleSpecContentDigest(resolution.spec, resolution.roleId, resolution.revision.revision);
    if (digest !== sessionRole.pin.digest) {
      return forbidden('the resolved role spec digest does not match the Session pin');
    }
    return null;
  }
  // Verified absence of a matrix: only a matching legacy template is acceptable.
  if (sessionRole.kind !== 'legacy_template') return forbidden('a role_spec Session cannot resolve to absent');
  if (sessionRole.templateId !== binding.templateId || sessionRole.templateRevision !== binding.templateRevision) {
    return forbidden('the legacy Session template does not match the binding');
  }
  return null;
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createTaskClaimService(deps: TaskClaimDependencies): TaskClaimPort {
  const records: Records = deps.records;
  // Slice 1 §0.2 L1: the direct Work claim uses the same-submodule Session facts
  // reader and the trusted legacy-provenance reader; an absent provenance is
  // never treated as `new`.
  const sessionFactsService = createSessionFactsService({ records });
  const legacyProvenance = createLegacySessionProvenanceReader(records, sessionFactsService, deps.bodies);

  /**
   * S1-DISPATCH-01 at the direct claim entry: read the trusted Session facts,
   * resolve a legacy provenance from reliable evidence when the record has
   * none, and let the Session machine decide. A copy, a pending archive request
   * or a wait is refused here, not only in `chooseSession`.
   *
   * §3.4 S:630: the evidence the derivation read is part of this claim's
   * commit, so a concurrent Session write between the read and the commit is a
   * revision conflict instead of a claim on stale facts.
   */
  async function claimDispatchProblem(
    ctx: CoreCallContext,
    sessionRef: SessionRef,
    taskTriple: TaskTriple,
    consumedWait: ClaimTaskInput['consumedWait'],
  ): Promise<{ rejection: CoreRejection } | { guards: readonly RecordGuard[] }> {
    const factsRead = await sessionFactsService.readSessionFacts(ctx, sessionRef);
    if (factsRead.status !== 'ready') {
      if (factsRead.status === 'not_found') return { rejection: reject('not_found', 'the target Session does not exist') };
      if (factsRead.status === 'not_ready') return { rejection: incomplete('the Session facts are not readable at the required watermark') };
      return { rejection: factsRead };
    }
    const facts = factsRead.value;
    const consumed: SessionWorkWaitV1 | null = consumedWait === undefined ? null
      : { runRef: consumedWait.runRef, messageRef: consumedWait.messageRef, task: taskTriple };
    if ((facts.session.provenance ?? null) !== null) {
      const refusal = workClaimDispatchProblem(facts, consumed);
      return refusal === null ? { guards: [] } : { rejection: refusal };
    }
    const derived = await legacyProvenance.deriveLegacySessionProvenance(ctx, sessionRef);
    if (derived.status === 'rejected' && derived.code === 'cycle') return { rejection: reject('cycle', derived.reason) };
    if (derived.status !== 'ready') {
      // §3.2 refusal table: keep the reader's own code and reason (`unavailable`,
      // `cancelled`, `forbidden`, …); only a genuinely unreadable provenance is
      // an incomplete ambiguity.
      if (derived.status === 'rejected') return { rejection: reject(derived.code, derived.reason, derived.current) };
      return { rejection: incomplete('legacy_provenance_ambiguous: the Session provenance is not readable and no trusted legacy basis proves it') };
    }
    // The trusted legacy provenance is passed as the guard fact; the Session
    // record itself is never rewritten outside `state/session-availability.ts`.
    const refusal = sessionDispatchAdmissionProblem(facts.session, {
      purpose: 'work', waiting: facts.wait, consumedWait: consumed, readonlyQueryMatches: false,
      legacyProvenance: derived.value.provenance,
    });
    if (refusal !== null && !refusal.ok) return { rejection: reject(refusal.code, refusal.detail) };
    return { guards: derived.value.guards };
  }

  /**
   * A continuation is identified ONLY by (prior Run, saved message) in the bound
   * scope, so any Host actor replaying the same wait gets the same receipt and a
   * second consumption cannot create a second Run.
   */
  function continuationIdentityAndFingerprint(
    scope: WorkspaceScope,
    input: ClaimTaskInput,
    expected: readonly VersionPin[],
  ): { identityKey: string; fingerprint: string } {
    const consumed = input.consumedWait!;
    const identityKey = CLAIM_CONTINUATION_PREFIX + sha256Hex(canonicalJson({
      kind: 'claim-continuation', projectId: scope.projectId, workspaceId: scope.workspaceId,
      runRef: consumed.runRef, messageRef: consumed.messageRef,
    } as unknown as JsonValue));
    const expectedCanonical = [...expected].map(pin => ({ ref: pin.ref, revision: pin.revision }))
      .sort((left, right) => {
        const leftKey = refKeyOf(left.ref);
        const rightKey = refKeyOf(right.ref);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
    const fingerprint = sha256Hex(canonicalJson({
      kind: 'task-claim-continuation',
      projectId: scope.projectId, workspaceId: scope.workspaceId,
      goalRef: input.goalRef, planRef: input.planRef, taskId: input.taskId,
      sessionRef: input.sessionRef, roleBinding: input.roleBinding, budget: input.budget,
      consumedWait: consumed, expected: expectedCanonical,
    } as unknown as JsonValue));
    return { identityKey, fingerprint };
  }

  function identityAndFingerprint(
    actor: Extract<ActorRef, { kind: 'human' | 'system' }>,
    scope: WorkspaceScope,
    requestId: string,
    input: ClaimTaskInput,
    expected: readonly VersionPin[],
  ): { identityKey: string; fingerprint: string } {
    const identityKey = CLAIM_IDENTITY_PREFIX + sha256Hex(canonicalJson({
      actor: { kind: actor.kind, id: actor.id }, projectId: scope.projectId, workspaceId: scope.workspaceId, requestId,
    } as unknown as JsonValue));
    const expectedCanonical = [...expected].map(pin => ({ ref: pin.ref, revision: pin.revision }))
      .sort((left, right) => {
        const leftKey = refKeyOf(left.ref);
        const rightKey = refKeyOf(right.ref);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
    const fingerprint = sha256Hex(canonicalJson({
      kind: 'task-claim-request',
      actor: { kind: actor.kind, id: actor.id },
      projectId: scope.projectId, workspaceId: scope.workspaceId,
      goalRef: input.goalRef, planRef: input.planRef, taskId: input.taskId,
      sessionRef: input.sessionRef, roleBinding: input.roleBinding, budget: input.budget,
      consumedWait: input.consumedWait ?? null,
      // TD-3: part of the fingerprint only when present, so a first claim keeps its fingerprint.
      ...(input.requeueRef === undefined ? {} : { requeueRef: input.requeueRef }),
      expected: expectedCanonical,
    } as unknown as JsonValue));
    return { identityKey, fingerprint };
  }

  async function readReplay(
    receipt: Extract<Awaited<ReturnType<Records['lookupCommit']>>, { status: 'ready' }>['value'],
    actor: Extract<ActorRef, { kind: 'human' | 'system' }>,
    scope: WorkspaceScope,
    identityKey: string,
    fingerprint: string,
    input: ClaimTaskInput,
    actorBound: boolean,
  ): Promise<WriteResult<TaskClaim>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return unavailable('the recorded claim receipt does not name exactly one event');
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (!sameCursor(at.value.cursor, receipt.cursor)) {
      return unavailable('the returned event cursor disagrees with the claim receipt');
    }
    const decoded = taskClaimedEventFromEvent(at.value.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded claim event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.eventId !== receipt.eventIds[0]) return unavailable('the recorded event id disagrees with the claim receipt');
    if (event.identityKey !== identityKey || event.fingerprint !== fingerprint) {
      return unavailable('the recorded claim identity/fingerprint disagrees with the idempotency receipt');
    }
    if (actorBound && (event.actor.kind !== actor.kind || event.actor.id !== actor.id)) {
      return unavailable('the recorded claim event belongs to another actor');
    }
    const claim = event.claim;
    if (claim.task.projectId !== scope.projectId || claim.task.goalId !== input.goalRef.goalId
      || claim.task.taskId !== input.taskId) {
      return unavailable('the recorded claim task disagrees with the request');
    }
    if (refKeyOf(claim.planRef) !== refKeyOf(input.planRef)) return unavailable('the recorded claim Plan disagrees with the request');
    if (!sameRef(claim.sessionRef, input.sessionRef)) return unavailable('the recorded claim Session disagrees with the request');
    if (claim.workspaceId !== scope.workspaceId) return unavailable('the recorded claim workspace disagrees with the Host scope');
    return { status: 'committed', value: claim, replayed: true, cursor: receipt.cursor };
  }

  async function claimTask(ctx: CoreCallContext, request: GraphWrite<ClaimTaskInput>): Promise<WriteResult<TaskClaim>> {
    const ownedCtx = ownCallContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { ctx: scopeCtx, actor } = ownedCtx;
    const ownedRequest = ownRequest(request);
    if (!ownedRequest.ok) return ownedRequest.rejection;
    const { input, requestId, expected } = ownedRequest;

    const scope: WorkspaceScope = { projectId: scopeCtx.projectId, workspaceId: scopeCtx.workspaceId! };
    const shape = validateInputShape(input, scope);
    if (shape !== null) return shape;
    const canonicalInput = canonicalizeRequest(input, expected);
    if (canonicalInput !== null) return canonicalInput;
    const workspaceRef = { aggregateType: 'Workspace' as const, projectId: scope.projectId, workspaceId: scope.workspaceId };
    const checkedExpected = validateExpected(expected, input.goalRef, workspaceRef, input.sessionRef);
    if (!checkedExpected.ok) return checkedExpected.rejection;
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled before lookup');

    // A continuation is idempotent by (prior yielded Run, saved message) and is
    // actor-independent, NOT by the caller's requestId or Host actor: a later
    // wake (even from another Host actor) must replay the original receipt
    // instead of claiming a second continuation Run.
    const actorBound = input.consumedWait === undefined;
    const { identityKey, fingerprint } = actorBound
      ? identityAndFingerprint(actor, scope, requestId, input, expected)
      : continuationIdentityAndFingerprint(scope, input, expected);

    // 1. Original receipt first: a replay must not consult the current world.
    const lookup = await records.lookupCommit({ identityKey, fingerprint });
    if (lookup.status === 'ready') {
      return readReplay(lookup.value, actor, scope, identityKey, fingerprint, input, actorBound);
    }
    if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled during lookup');

    // 2. Current Goal / accepted Plan / Workspace / Session. TASK-01..03 judge
    //    the facts read so far after each read; a fact not read yet holds.
    const basis = claimBasisOf(input);
    const goalRead = await readGoal(records, input.goalRef);
    if (goalRead.status !== 'ready') return mapReaderRejection(goalRead);
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled during the goal read');
    const goal: GoalSnapshot = goalRead.goal;
    if (goal.workspaceRef.workspaceId !== scope.workspaceId) return forbidden('the Goal belongs to another workspace');
    let subject: TaskClaimSubject | null = UNREAD_TASK;
    let claimFacts: TaskClaimFacts = {
      goalDesiredState: goal.desiredState,
      activePlanMatchesClaim: goal.activePlanRevision !== null
        && refKeyOf(goal.activePlanRevision) === refKeyOf(input.planRef),
      sessionProblem: null, structuralProblem: null, lease: { status: 'free' }, taskHasRun: false,
      prior: basis.kind === 'continuation' ? UNREAD_PRIOR : null,
      requeue: basis.kind === 'requeue' ? UNREAD_REQUEUE : null, admission: null,
    };
    // Adds the facts just read and asks TASK-01..03 again.
    const judge = (read: Partial<TaskClaimFacts>): CoreRejection | null => {
      claimFacts = { ...claimFacts, ...read };
      return rejectionOf(taskClaimProblem(subject, basis, claimFacts));
    };
    let refused = judge({});
    if (refused !== null) return refused;

    const planRead = await readPlan(records, input.planRef);
    if (planRead.status !== 'ready') return mapReaderRejection(planRead);
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled during the plan read');
    const plan: PlanRevisionSnapshot = planRead.plan;
    if (plan.goalRef.goalId !== input.goalRef.goalId || plan.goalRef.projectId !== scope.projectId) {
      return reject('not_found', 'the accepted Plan does not belong to the requested Goal');
    }

    const workspaceKey = refKeyOf(goal.workspaceRef);
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.sessionRef));
    const stateRead = await records.readMany([workspaceKey, sessionKey]);
    if (stateRead.status !== 'ready') return mapStoreFailure(stateRead);
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled during the Session read');
    const workspaceRecord = stateRead.value.records.find(record => record.refKey === workspaceKey);
    const sessionRecord = stateRead.value.records.find(record => record.refKey === sessionKey);
    if (workspaceRecord === undefined) return incomplete('the Goal Workspace record is missing');
    const decodedSession = sessionRecord === undefined ? null : decodeSessionRecord(sessionRecord);
    if (decodedSession !== null && decodedSession.status !== 'decoded') return unavailable(`the target Session is damaged: ${decodedSession.reason}`);
    const target = decodedSession === null ? null : decodedSession.value;
    if (target !== null && target.ref.projectId !== scope.projectId) return forbidden('the target Session belongs to another project');
    if (target !== null && target.workspaceId !== scope.workspaceId) return forbidden('the target Session belongs to another workspace');
    // SES-02: absent, lifecycle, health, occupancy, revision and generation; the pin comes after the Goal/Workspace pins.
    const sessionState = sessionMachineStateOf(target);
    refused = judge({ sessionProblem: rejectionOf(occupancyAdmissionProblem(sessionState, null)) });
    if (refused !== null) return refused;
    // SES-02 refused an absent Session (`not_found`) above.
    const session = target!;
    // 3. Expected pins must match the current values exactly.
    if (checkedExpected.pins.goal.revision !== goal.revision) return reject('revision_conflict', 'the Goal changed since the caller read it');
    if (checkedExpected.pins.workspace.revision !== workspaceRecord.revision) return reject('revision_conflict', 'the Workspace changed since the caller read it');

    // 4. Task identity + canonical state (directed, this Task only); the Session pin is judged with it.
    const task = plan.tasks.find(candidate => candidate.taskId === input.taskId);
    subject = task === undefined ? null : { taskKind: task.taskKind, disposition: task.disposition, phase: UNREAD_TASK.phase };
    refused = judge({ sessionProblem: rejectionOf(occupancyAdmissionProblem(sessionState, checkedExpected.pins.session.revision)) });
    if (refused !== null) return refused;
    // TASK-01..03 refused a Task outside the accepted Plan (`not_found`) above.
    const definition = task!;

    const factsRead = await readCanonicalTaskFacts(records, input.goalRef, plan, input.taskId);
    if (factsRead.status !== 'ready') return mapReaderRejection(factsRead);
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled during the task-state read');
    const facts = factsRead.value;
    const state = facts.byTaskId.get(input.taskId);
    const phaseFacts = state === undefined ? null : claimPhaseFacts(definition, state, facts);
    if (state === undefined || phaseFacts === null) return incomplete('the directed task state was not read');
    const taskState = taskMachineStateOf(definition, phaseFacts);
    subject = taskState;
    // The SAME shared eligibility rule queryReadyTasks uses decides plan_only /
    // missing assignment BEFORE the role-binding and occupancy checks, so a
    // structural `incomplete` is never masked by a `forbidden`/`busy`.
    const eligibility = evaluateEligibility({
      plan, goalDesiredState: 'active', taskId: input.taskId,
      effectivePhases: new Map([[input.taskId, state.effectivePhase]]), lease: state.lease,
    });
    // A first claim with an existing Run is busy. A continuation claim is legal
    // only against a formal yielded Run whose saved wait is the one it consumes;
    // a requeue claim only with the TaskRequeue covering the selected Run. Both
    // re-hold the released lease record they read.
    let releasedLease: TaskLeaseSnapshot | null = null;
    let continuationMessageGuard: RecordGuard | null = null;
    let prior: TaskClaimFacts['prior'] = null;
    let requeue: TaskClaimFacts['requeue'] = null;
    const consumedWait = input.consumedWait;
    if (consumedWait !== undefined) {
      const priorRun = (facts.runsByTaskId.get(input.taskId) ?? []).find(run => sameRef(run.ref, consumedWait.runRef));
      releasedLease = facts.leasesByTaskId.get(input.taskId) ?? null;
      prior = priorRun === undefined ? null : continuationPrior(priorRun, releasedLease, consumedWait, input);
    }
    const requeueRef = input.requeueRef;
    if (requeueRef !== undefined) {
      releasedLease = facts.leasesByTaskId.get(input.taskId) ?? null;
      requeue = requeueClaimFacts(requeueRef, state, facts.requeuesByTaskId.get(input.taskId) ?? [], releasedLease, input);
    }
    refused = judge({ structuralProblem: structuralProblemOf(eligibility), lease: state.lease,
      taskHasRun: facts.taskHasRun === true, prior, requeue });
    if (refused !== null) return refused;
    // S1-DISPATCH-01: the direct Work claim refuses a copy provenance, a pending
    // archive request and a Work wait here, not only in `chooseSession`. The ONE
    // consumed-wait exception must name exactly this Task/Run/message.
    const dispatchTask: TaskTriple = { projectId: scope.projectId, goalId: input.goalRef.goalId, taskId: input.taskId };
    const dispatch = await claimDispatchProblem(scopeCtx, input.sessionRef, dispatchTask, consumedWait);
    if ('rejection' in dispatch) return dispatch.rejection;
    const dispatchGuards = dispatch.guards;
    if (consumedWait !== undefined) {
      // MSG-10: read the FORMAL saved reply from the same records transaction
      // instead of trusting the caller's responseRef: a pending message or an
      // arbitrary artifact must never be claimable, and the exact message revision is guarded.
      const messageKey = sessionMessageRefKey(consumedWait.messageRef);
      const messageRead = await records.readMany([messageKey]);
      if (messageRead.status !== 'ready') return busy('the continuation wait message is not readable');
      const messageRecord = messageRead.value.records.find(record => record.refKey === messageKey);
      let savedMessage: SessionMessage | null = null;
      if (messageRecord !== undefined) {
        const decodedMessage = decodeSessionMessageRecord(messageRecord);
        if (decodedMessage.status !== 'decoded') return unavailable(`the continuation wait message is damaged: ${decodedMessage.reason}`);
        savedMessage = decodedMessage.value;
        continuationMessageGuard = { refKey: messageKey, expectedRevision: messageRecord.revision };
      }
      const reply = messageSatisfiesWait(messageMachineStateOf(savedMessage), {
        responseRefMatches: savedMessage !== null && savedMessage.response !== null
          && sameRef(savedMessage.response.bodyRef, consumedWait.responseRef),
        sameWorkspace: savedMessage !== null && savedMessage.ref.workspaceId === scope.workspaceId,
      });
      // TASK-02 refused a continuation without a prior Run of this Task above.
      refused = judge({ prior: { ...claimFacts.prior!, replyProblem: reply.satisfied ? null : reject(reply.code, reply.detail) } });
      if (refused !== null) return refused;
    }

    // Admission (TASK-01..03's last guard): the assignment role, then the role, then the deadline.
    // TASK-01..03's structural guard refused a work Task without exactly one assignment above.
    const assignment = revisionAssignments(plan).find(candidate => candidate.taskId === input.taskId)!;
    refused = judge({ admission: assignment.role !== input.roleBinding.templateId
      ? forbidden('the Task assignment role does not match the role binding') : null });
    if (refused !== null) return refused;

    // 5. Current role facts (same resolver, exact read window guards).
    const roleFacts = await deps.roles.resolveRoleBindingFacts(scopeCtx, {
      roleBinding: input.roleBinding, declaredPermissions: { tools: [], writeScope: [] },
    });
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled during role resolution');
    if (roleFacts.result.status !== 'ready') return mapReadResult(roleFacts.result);
    refused = judge({ admission: roleMatchRejection(session.role, input.roleBinding, roleFacts.result.value) });
    if (refused !== null) return refused;

    // 6. Deadline (new requests only) and the immutable result identity.
    const claimedAt = deps.now();
    const nowMs = Date.parse(claimedAt);
    if (!nonEmpty(claimedAt) || !Number.isFinite(nowMs)) return reject('invalid', 'the injected clock is not a legal instant');
    refused = judge({ admission: deadlineProblem(input.budget.deadline, nowMs) });
    if (refused !== null) return refused;

    const runId = deps.newId();
    const attemptId = deps.newId();
    const eventId = deps.newId();
    if (!nonEmpty(runId) || !nonEmpty(attemptId) || !nonEmpty(eventId)) {
      return reject('unsupported', 'the injected id source produced an empty identity');
    }

    const taskTriple: TaskTriple = { projectId: scope.projectId, goalId: input.goalRef.goalId, taskId: input.taskId };
    const runRef: RunRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: taskTriple.goalId, runId };
    const attemptRef: TaskAttemptRef = { aggregateType: 'TaskAttempt', projectId: scope.projectId,
      goalId: taskTriple.goalId, taskId: input.taskId, attemptId };
    const outboxRef: DispatchOutboxRef = { aggregateType: 'DispatchOutboxEntry', projectId: scope.projectId,
      goalId: taskTriple.goalId, taskId: input.taskId, attemptId };
    // SES-02 occupies the pinned Session for this Run; its generation (revision + 1) is the claim's.
    const occupied = transitionSession(sessionState, { kind: 'occupancy_acquired', holder: runRef }, { caller: 'service',
      hostLease: null, pin: checkedExpected.pins.session.revision, holder: null, probe: null, kernelHeader: null,
      openResponsibleLink: null, creation: null, link: null });
    if (!occupied.ok) return reject(occupied.code, occupied.detail);
    const [occupation] = occupied.effects;
    if (occupied.effects.length !== 1 || occupation?.kind !== 'occupy_session') throw new Error('occupancy_acquired must occupy the Session');
    const claim: TaskClaim = {
      task: taskTriple, planRef: input.planRef, workspaceId: scope.workspaceId, sessionRef: input.sessionRef,
      sessionRevision: occupation.generation, generation: occupation.generation, runRef, attemptRef, outboxRef, claimedAt,
    };

    // TASK-01..03 accept the claim; `claimRecords` writes the records its effects name.
    const claimed = transitionTask(taskState, { kind: 'task_claimed', claim, basis, budget: input.budget },
      { taskId: input.taskId, claim: claimFacts, completion: null, disposition: null });
    if (!claimed.ok) return reject(claimed.code, claimed.detail);
    const written = claimRecords(claimed.effects, { lease: releasedLease, session, occupation,
      run: { kind: 'claim_committed', claim, basis, roleBinding: input.roleBinding, budget: input.budget,
        workspaceRevision: workspaceRecord.revision },
      runContext: claimRunContext(claimFacts, actor) });
    if ('status' in written) return written;
    const event: TaskClaimedEvent = { eventId, eventType: 'TaskClaimed', schemaVersion: 1, occurredAt: claimedAt,
      identityKey, actor, fingerprint, claim };

    // 7. One guard per distinct key; a later non-null version wins.
    const guardMap = new Map<string, number | null>();
    const addGuard = (refKey: string, expectedRevision: number | null): void => {
      const existing = guardMap.get(refKey);
      if (existing === undefined || (existing === null && expectedRevision !== null)) guardMap.set(refKey, expectedRevision);
    };
    addGuard(refKeyOf(input.goalRef), goal.revision);
    addGuard(workspaceKey, workspaceRecord.revision);
    addGuard(refKeyOf(input.planRef), plan.revision);
    addGuard(sessionKey, session.revision);
    // S1-DISPATCH-01 / §3.4 S:630: the trusted legacy derivation's guards are
    // part of the claim commit, not dropped after the read.
    for (const guard of dispatchGuards) addGuard(guard.refKey, guard.expectedRevision);
    for (const guard of facts.guards) addGuard(guard.refKey, guard.expectedRevision);
    // TASK-03: the requeue claim guards the TaskRequeue@1 it consumes (and the rework records it read).
    if (requeueRef !== undefined) for (const guard of facts.reworkGuards) addGuard(guard.refKey, guard.expectedRevision);
    for (const guard of roleFacts.guards) addGuard(guard.refKey, guard.expectedRevision);
    if (continuationMessageGuard !== null) addGuard(continuationMessageGuard.refKey, continuationMessageGuard.expectedRevision);
    for (const record of [written.lease, written.attempt, written.run, written.outbox]) addGuard(record.refKey, null);
    const guards: RecordGuard[] = [...guardMap].map(([refKey, expectedRevision]) => ({ refKey, expectedRevision }));

    const prepared: PreparedCommit = { identityKey, fingerprint, guards,
      records: [written.lease, written.attempt, written.run, written.outbox, written.session],
      claims: [], indexGuards: [], indexChanges: [], events: [encodeTaskClaimedEvent(event)] };

    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled before commit');
    const receipt = await records.commit(prepared);
    if (receipt.status !== 'committed') return mapStoreFailure(receipt);
    // A concurrent identical request win makes the Store replay the original
    // event; the local freshly-minted ids must NEVER be returned in that case.
    if (receipt.replayed) return readReplay(receipt, actor, scope, identityKey, fingerprint, input, actorBound);
    return { status: 'committed', value: claim, replayed: false, cursor: receipt.cursor };
  }

  return { claimTask };
}
