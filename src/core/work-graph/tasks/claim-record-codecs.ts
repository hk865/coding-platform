/**
 * Claim-record codecs.
 *
 * The Run, TaskLease and SessionRecord shapes already have registered codecs
 * (`materials/record-readers.ts` owns `RunSnapshot@1`,
 * `tasks/plan-readers.ts` owns `TaskLeaseSnapshot@1`,
 * `sessions/session-record-codecs.ts` owns `SessionRecord@1`). This file must
 * NOT re-register any of them: the Store selects one codec per aggregateType
 * and a duplicate registration is a real conflict, not a harmless alias.
 *
 * New here: `TaskAttemptSnapshot@1`, the pending `DispatchOutboxEntrySnapshot@1`
 * that stores the immutable `TaskClaim`, and the `TaskClaimed` replay event.
 * The TaskClaim cross-reference check is pure: it never touches a Store, so a
 * crafted/decoded claim cannot borrow another aggregate's identity.
 *
 * A.2 (spec §4.1, §13 ND-8): the immutable `TaskRequeue@1`, the versioned
 * `TaskReworkRefusal@k` and their `TaskRequeued` / `TaskReworkRefused` replay
 * events are registered here with the claim records. Both records are written
 * only through the `state/` constructors; these codecs only decode them.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type {
  DispatchOutboxRef, RunOutcome, TaskAttemptRef, TaskAttemptSnapshot, TaskAttemptStatus,
} from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  TASK_REWORK_REASON_MAX_CHARS, TASK_REWORK_REFUSAL_CODES,
  type TaskRequeueRef, type TaskRequeueSnapshotV1, type TaskReworkRefusalRef, type TaskReworkRefusalSnapshotV1,
} from '../../../contracts/task-requeue.js';
import { invalid, isRecord, nonEmpty, parseObject } from '../../../contracts/validation/common.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { RecordLookupIndex } from '../../record-store/lookup-ports.js';
import type { TaskClaim, TaskClaimOutbox } from '../model/claim-contracts.js';
import { WORK_EXECUTION_BY_SESSION_LOOKUP } from '../model/session-facts-contracts.js';
import { encodeEventEnvelope } from '../persistence/event-envelope.js';
import { taskDispatchStateProblem } from '../persistence/execution-entry-codecs.js';
import {
  actorRefProblem, controlIntentRefProblem, delegatedWriteProvenanceProblem, goalRefProblem, hasOnlyKeys,
  isNonNegativeSafeInteger, isPositiveSafeInteger, isSha256Hex, newBasisInputRefsProblem, noProgressKeyProblem,
  noticeOriginFieldsProblem, NOTICE_ORIGIN_COMMIT_CURSOR_FIELDS, type NoticeOriginWireV1,
  planRevisionRefProblem, reworkFailureClassProblem, runRefProblem, sameJson, sessionRefProblem, sourceStampProblem,
  taskAttemptRefProblem, taskBudgetProblem, taskRequeueRefProblem, taskTripleProblem, verificationRoundRefProblem,
} from '../persistence/rework-codecs.js';

/** Encoding selectors for the new records. Reuse the existing @1 convention. */
export const TASK_ATTEMPT_SCHEMA_ID = 'TaskAttemptSnapshot@1';
export const TASK_CLAIM_OUTBOX_SCHEMA_ID = 'DispatchOutboxEntrySnapshot@1';
export const TASK_CLAIMED_EVENT_TYPE = 'TaskClaimed';
export const TASK_CLAIMED_EVENT_SCHEMA_VERSION = 1;
/** A.2 rework records (spec §4.1); the selector names the record, `@1` the encoding. */
export const TASK_REQUEUE_SCHEMA_ID = 'TaskRequeue@1';
export const TASK_REWORK_REFUSAL_SCHEMA_ID = 'TaskReworkRefusal@1';
export const TASK_REQUEUED_EVENT_TYPE = 'TaskRequeued';
export const TASK_REWORK_REFUSED_EVENT_TYPE = 'TaskReworkRefused';
export const TASK_REWORK_EVENT_SCHEMA_VERSION = 1;

/** Slice 2A L4: the ordered requeue index on `TaskRequeue`. */
export const S2A_REQUEUE_BY_PROJECT_LOOKUP = 's2a-requeue-by-project';
/** Slice 2C L4 index 6: the latest (or paged) Work claim of a Session by generation. */
export const S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP = 's2c-work-claim-by-session-generation';
export const S2A_REQUEUE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  {
    name: S2A_REQUEUE_BY_PROJECT_LOOKUP,
    aggregateType: 'TaskRequeue',
    paths: ['ref.projectId'],
    orderBy: { path: 'since' },
  },
];

/**
 * The `TaskClaimed` event is the immutable replay source. It carries the same
 * trusted identity/actor/fingerprint that the idempotency row carries plus the
 * ORIGINAL result references, so a replay never rebuilds a claim from the
 * current Session state.
 */
export type TaskClaimedEvent = {
  eventId: string;
  eventType: typeof TASK_CLAIMED_EVENT_TYPE;
  schemaVersion: typeof TASK_CLAIMED_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  fingerprint: string;
  claim: TaskClaim;
};

/**
 * `TaskRequeued` (TASK-16/17/27, GOAL-29): the replay source of a requeue
 * receipt. `actor` is the requester (`requeue.requestedBy`): an operator, a
 * platform automation actor or an Agent.
 */
export type TaskRequeuedEvent = {
  eventId: string;
  eventType: typeof TASK_REQUEUED_EVENT_TYPE;
  schemaVersion: typeof TASK_REWORK_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  actor: ActorRef;
  fingerprint: string;
  requeue: TaskRequeueSnapshotV1;
};

/**
 * `TaskReworkRefused` (TASK-28, VR-14 policy refusal): the replay source of a
 * committed refusal; `refusal` is the exact revision written by the commit.
 */
export type TaskReworkRefusedEvent = {
  eventId: string;
  eventType: typeof TASK_REWORK_REFUSED_EVENT_TYPE;
  schemaVersion: typeof TASK_REWORK_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  actor: ActorRef;
  fingerprint: string;
  refusal: TaskReworkRefusalSnapshotV1;
};

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function aggregateRefOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

const ATTEMPT_STATUSES: readonly string[] = ['claimed', 'started', 'ended'];
const RUN_OUTCOMES: readonly string[] = ['completed', 'failed', 'cancelled', 'budget_exhausted', 'crashed', 'outcome_unknown', 'yielded'];

/**
 * Pure TaskClaim cross-reference check. `task` is the scope anchor: every
 * project/goal/task field must agree with it, the attempt/outbox must name the
 * same attemptId, the outer outbox ref must equal `claim.outboxRef`, and
 * `generation` must be the next Session revision.
 */
export function taskClaimProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'TaskClaim is not an object';
  const task = value['task'];
  if (!isRecord(task) || !nonEmpty(task['projectId']) || !nonEmpty(task['goalId']) || !nonEmpty(task['taskId'])) {
    return 'TaskClaim.task is not a complete TaskTriple';
  }
  const projectId = task['projectId'];
  const goalId = task['goalId'];
  const taskId = task['taskId'];
  const planRef = value['planRef'];
  if (!isRecord(planRef) || planRef['aggregateType'] !== 'PlanRevision'
    || planRef['projectId'] !== projectId || !nonEmpty(planRef['planId'])) {
    return 'TaskClaim.planRef is not a PlanRevisionRef of the task project';
  }
  if (!nonEmpty(value['workspaceId'])) return 'TaskClaim.workspaceId is required';
  const sessionRef = value['sessionRef'];
  if (!isRecord(sessionRef) || sessionRef['projectId'] !== projectId || !nonEmpty(sessionRef['sessionId'])) {
    return 'TaskClaim.sessionRef is not a SessionRef of the task project';
  }
  const runRef = value['runRef'];
  if (!isRecord(runRef) || runRef['aggregateType'] !== 'Run' || runRef['projectId'] !== projectId
    || runRef['goalId'] !== goalId || !nonEmpty(runRef['runId'])) {
    return 'TaskClaim.runRef does not match the task scope';
  }
  const attemptRef = value['attemptRef'];
  if (!isRecord(attemptRef) || attemptRef['aggregateType'] !== 'TaskAttempt' || attemptRef['projectId'] !== projectId
    || attemptRef['goalId'] !== goalId || attemptRef['taskId'] !== taskId || !nonEmpty(attemptRef['attemptId'])) {
    return 'TaskClaim.attemptRef does not match the task scope';
  }
  const outboxRef = value['outboxRef'];
  if (!isRecord(outboxRef) || outboxRef['aggregateType'] !== 'DispatchOutboxEntry' || outboxRef['projectId'] !== projectId
    || outboxRef['goalId'] !== goalId || outboxRef['taskId'] !== taskId
    || outboxRef['attemptId'] !== attemptRef['attemptId']) {
    return 'TaskClaim.outboxRef does not match the attempt';
  }
  if (!isSafeRevision(value['sessionRevision']) || value['sessionRevision'] < 1) {
    return 'TaskClaim.sessionRevision must be a positive safe integer';
  }
  if (!isSafeRevision(value['generation']) || value['generation'] < 1
    || value['generation'] !== value['sessionRevision']) {
    return 'TaskClaim.generation must equal the new Session revision';
  }
  if (!nonEmpty(value['claimedAt'])) return 'TaskClaim.claimedAt is required';
  return null;
}

// --------------------------------------------------------------------------
// Canonical keys
// --------------------------------------------------------------------------

/** Full canonical key of a `TaskAttempt` aggregate (never a bare attemptId). */
export function taskAttemptRefKey(ref: TaskAttemptRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

/** Full canonical key of a `DispatchOutboxEntry` aggregate. */
export function dispatchOutboxRefKey(ref: DispatchOutboxRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

// --------------------------------------------------------------------------
// TaskAttempt codec
// --------------------------------------------------------------------------

/** Encodes the claimed `TaskAttempt` snapshot. */
export function encodeTaskAttemptSnapshot(snapshot: TaskAttemptSnapshot): EncodedRecord {
  return { refKey: taskAttemptRefKey(snapshot.ref), schemaId: TASK_ATTEMPT_SCHEMA_ID,
    revision: snapshot.revision, json: JSON.stringify(snapshot) };
}

/** Decodes the claimed `TaskAttempt` snapshot at one exact revision. */
export function decodeTaskAttemptSnapshot(record: EncodedRecord): DecodeResult<TaskAttemptSnapshot> {
  if (record.schemaId !== TASK_ATTEMPT_SCHEMA_ID) {
    return invalid(`expected schemaId ${TASK_ATTEMPT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const body = parseObject(record.json);
  if (body === null) return invalid('TaskAttempt snapshot is not a JSON object');
  const ref = aggregateRefOf(body['ref']);
  if (ref === null || ref['aggregateType'] !== 'TaskAttempt' || !nonEmpty(ref['projectId'])
    || !nonEmpty(ref['goalId']) || !nonEmpty(ref['taskId']) || !nonEmpty(ref['attemptId'])) {
    return invalid('TaskAttempt snapshot has no complete TaskAttemptRef');
  }
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) {
    return invalid('TaskAttempt ref is not the outer canonical ref_key');
  }
  if (!isSafeRevision(body['revision']) || body['revision'] !== record.revision) {
    return invalid('TaskAttempt outer revision disagrees with the JSON revision');
  }
  if (body['schemaVersion'] !== 1) return invalid('TaskAttempt schemaVersion must be 1');
  if (!nonEmpty(body['runId'])) return invalid('TaskAttempt must carry a runId');
  const planRef = aggregateRefOf(body['planRef']);
  if (planRef === null || planRef['aggregateType'] !== 'PlanRevision'
    || planRef['projectId'] !== ref['projectId'] || !nonEmpty(planRef['planId'])) {
    return invalid('TaskAttempt planRef is not a PlanRevisionRef of the attempt project');
  }
  if (!ATTEMPT_STATUSES.includes(body['status'] as TaskAttemptStatus)) {
    return invalid('TaskAttempt status is not a legal TaskAttemptStatus');
  }
  if (!(body['startedAt'] === null || typeof body['startedAt'] === 'string')) {
    return invalid('TaskAttempt startedAt must be a string or null');
  }
  if (!(body['endedAt'] === null || typeof body['endedAt'] === 'string')) {
    return invalid('TaskAttempt endedAt must be a string or null');
  }
  const ended = body['status'] === 'ended';
  if (ended
    ? !RUN_OUTCOMES.includes(body['endOutcome'] as RunOutcome)
    : !(body['endOutcome'] === null || RUN_OUTCOMES.includes(body['endOutcome'] as RunOutcome))) {
    return invalid(ended ? 'TaskAttempt ended record requires a RunOutcome' : 'TaskAttempt endOutcome is not a RunOutcome or null');
  }
  // TASK-03: optional, only on the Attempt of a claim after a TaskRequeue of this Task.
  if (body['requeueRef'] !== undefined) {
    const requeueProblem = taskRequeueRefProblem(body['requeueRef'], 'TaskAttempt requeueRef');
    if (requeueProblem !== null) return invalid(requeueProblem);
    const requeueRef = body['requeueRef'] as Record<string, unknown>;
    if (requeueRef['projectId'] !== ref['projectId'] || requeueRef['goalId'] !== ref['goalId']
      || requeueRef['taskId'] !== ref['taskId']) {
      return invalid('TaskAttempt requeueRef does not belong to the Attempt Task');
    }
    if (requeueRef['afterRunId'] === body['runId']) return invalid('TaskAttempt requeueRef cannot cover its own Run');
  }
  return { status: 'decoded', value: body as unknown as TaskAttemptSnapshot };
}

// --------------------------------------------------------------------------
// Dispatch outbox codec
// --------------------------------------------------------------------------

/** Encodes the pending dispatch outbox entry that stores the `TaskClaim`. */
export function encodeDispatchOutboxEntry(entry: TaskClaimOutbox): EncodedRecord {
  return { refKey: dispatchOutboxRefKey(entry.ref), schemaId: TASK_CLAIM_OUTBOX_SCHEMA_ID,
    revision: entry.revision, json: JSON.stringify(entry) };
}

/** Decodes the pending dispatch outbox entry; later status changes must be
 * versioned, never re-interpreted from a mutable body. */
export function decodeDispatchOutboxEntry(record: EncodedRecord): DecodeResult<TaskClaimOutbox> {
  if (record.schemaId !== TASK_CLAIM_OUTBOX_SCHEMA_ID) {
    return invalid(`expected schemaId ${TASK_CLAIM_OUTBOX_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const body = parseObject(record.json);
  if (body === null) return invalid('dispatch outbox entry is not a JSON object');
  const ref = aggregateRefOf(body['ref']);
  if (ref === null || ref['aggregateType'] !== 'DispatchOutboxEntry' || !nonEmpty(ref['projectId'])
    || !nonEmpty(ref['goalId']) || !nonEmpty(ref['taskId']) || !nonEmpty(ref['attemptId'])) {
    return invalid('dispatch outbox entry has no complete DispatchOutboxRef');
  }
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) {
    return invalid('dispatch outbox ref is not the outer canonical ref_key');
  }
  if (!isSafeRevision(body['revision']) || body['revision'] !== record.revision) {
    return invalid('dispatch outbox outer revision disagrees with the JSON revision');
  }
  if (body['schemaVersion'] !== 1) return invalid('dispatch outbox schemaVersion must be 1');
  const KNOWN_OUTBOX_KEYS = ['ref', 'revision', 'schemaVersion', 'status', 'dispatchState', 'claim'];
  if (!Object.keys(body).every(key => KNOWN_OUTBOX_KEYS.includes(key))) {
    return invalid('dispatch outbox carries unknown fields');
  }
  if (body['status'] !== 'pending' && body['status'] !== 'entered' && body['status'] !== 'settled') {
    return invalid('dispatch outbox status must be pending, entered or settled');
  }
  const claimProblem = taskClaimProblem(body['claim']);
  if (claimProblem !== null) return invalid(claimProblem);
  const claim = body['claim'] as TaskClaim;
  if (canonicalJson(claim.outboxRef as unknown as JsonValue) !== canonicalJson(ref as unknown as JsonValue)) {
    return invalid('the outer outbox ref must equal claim.outboxRef');
  }
  const dispatchState = body['dispatchState'];
  if (body['status'] === 'pending') {
    // A legacy pending entry has no dispatchState. Keeping the two facts in one
    // unambiguous shape prevents "pending but actually settled" ambiguity.
    if (dispatchState !== undefined) return invalid('a pending dispatch outbox entry must not carry dispatchState');
  } else {
    // V1 (entered/settled after entry) or the AD-2 V2 not-entered settlement.
    const stateProblem = taskDispatchStateProblem(dispatchState);
    if (stateProblem !== null) return invalid(stateProblem);
    if ((dispatchState as { phase?: unknown }).phase !== body['status']) {
      return invalid('dispatch outbox status must agree with dispatchState.phase');
    }
  }
  return { status: 'decoded', value: body as unknown as TaskClaimOutbox };
}

// --------------------------------------------------------------------------
// TaskClaimed event codec
// --------------------------------------------------------------------------

/** Encodes the `TaskClaimed` replay event. */
export function encodeTaskClaimedEvent(event: TaskClaimedEvent): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

/** Decodes a `TaskClaimed` event, verifying the outer envelope against the JSON
 * body plus the identity/actor/fingerprint and the claim cross-references. */
export function taskClaimedEventFromEvent(event: EncodedDomainEvent): DecodeResult<TaskClaimedEvent> {
  if (event.eventType !== TASK_CLAIMED_EVENT_TYPE) {
    return invalid(`expected eventType ${TASK_CLAIMED_EVENT_TYPE}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== TASK_CLAIMED_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${String(TASK_CLAIMED_EVENT_SCHEMA_VERSION)}, got ${String(event.schemaVersion)}`);
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return invalid('TaskClaimed envelope is incomplete');
  const body = parseObject(event.json);
  if (body === null) return invalid('TaskClaimed event is not a JSON object');
  if (body['eventId'] !== event.eventId) return invalid('TaskClaimed json does not match the envelope eventId');
  if (body['eventType'] !== event.eventType) return invalid('TaskClaimed json does not match the envelope eventType');
  if (body['schemaVersion'] !== event.schemaVersion) return invalid('TaskClaimed json does not match the envelope schemaVersion');
  if (body['occurredAt'] !== event.occurredAt) return invalid('TaskClaimed json does not match the envelope occurredAt');
  if (!nonEmpty(body['identityKey'])) return invalid('TaskClaimed identityKey is required');
  if (!nonEmpty(body['fingerprint'])) return invalid('TaskClaimed fingerprint is required');
  const actor = aggregateRefOf(body['actor']);
  if (actor === null || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return invalid('TaskClaimed actor must be a trusted human/system actor');
  }
  const claimProblem = taskClaimProblem(body['claim']);
  if (claimProblem !== null) return invalid(claimProblem);
  return { status: 'decoded', value: body as unknown as TaskClaimedEvent };
}

// --------------------------------------------------------------------------
// TaskRequeue@1 / TaskReworkRefusal@k codecs (spec §4.1, §13 ND-8)
// --------------------------------------------------------------------------

/** Full canonical key of a `TaskRequeue` aggregate (one per covered Run). */
export function taskRequeueRefKey(ref: TaskRequeueRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

/** Full canonical key of a `TaskReworkRefusal` aggregate (one per Task/operation/subject). */
export function taskReworkRefusalRefKey(ref: TaskReworkRefusalRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

const KNOWN_RUN_OUTCOMES: readonly string[] = ['completed', 'failed', 'cancelled', 'budget_exhausted', 'crashed', 'yielded'];
const STOP_REQUESTERS: readonly string[] = ['human', 'goal_fan_out', 'system', 'none'];
const BASIS_COMPARISONS: readonly string[] = ['compared', 'skipped_interrupted', 'skipped_human_cancel'];
const TASK_REQUEUE_KEYS: readonly string[] = ['ref', 'revision', 'schemaVersion', 'task', 'planRef', 'afterRunRef',
  'afterAttemptRef', 'afterOutcome', 'afterRoundRef', 'failureClass', 'interruption', 'stopIntentRef', 'stopRequester',
  'trigger', 'basis', 'basisComparison', 'supersededEvidenceIds', 'newInputRefs', 'budget', 'reason', 'requestedBy',
  'requestedAt', 'agentProvenance', 'automation', 'historySource', 'archiveOrigin', 'since', 'noticeAutomationCap'];
const TASK_REWORK_REFUSAL_KEYS: readonly string[] = ['ref', 'revision', 'schemaVersion', 'task', 'afterRunRef',
  'subjectRoundRef', 'failureClass', 'code', 'reason', 'basisDigest', 'source', 'matchedRequeueRef', 'requestedBy',
  'refusedAt', 'goalEndedRunsAtRefusal', 'configurationRevision'];

function sameTask(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return left['projectId'] === right['projectId'] && left['goalId'] === right['goalId'] && left['taskId'] === right['taskId'];
}
function boundedReasonProblem(value: unknown, label: string): string | null {
  if (!nonEmpty(value)) return `${label} must be a non-empty string`;
  return value.length > TASK_REWORK_REASON_MAX_CHARS
    ? `${label} exceeds ${String(TASK_REWORK_REASON_MAX_CHARS)} characters` : null;
}
/** A Run or round of the same Goal as the record's Task. */
function sameGoal(value: unknown, task: Record<string, unknown>): boolean {
  return isRecord(value) && value['projectId'] === task['projectId'] && value['goalId'] === task['goalId'];
}

/** Slice 1 §2.6: the optional archive origin of a requeue. */
function anomalyAnchorRefProblem(value: unknown, label: string): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || value['aggregateType'] !== 'SessionAnomalyAnchor' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return `${label} must be a complete SessionAnomalyAnchorRef`;
  }
  return null;
}
function messageRefProblem(value: unknown, label: string): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'messageId'])
    || value['aggregateType'] !== 'SessionMessage' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['messageId'])) {
    return `${label} must be a complete SessionMessageRef`;
  }
  return null;
}
function archiveRequeueOriginProblem(value: unknown, projectId: string): string | null {
  if (!isRecord(value)) return 'TaskRequeue archiveOrigin must be an object';
  if (value['kind'] === 'execution') {
    if (!hasOnlyKeys(value, ['kind', 'anchorRef', 'archiveSessionRef', 'archiveRequestId'])) {
      return 'TaskRequeue archiveOrigin execution carries unknown fields';
    }
    const anchorProblem = anomalyAnchorRefProblem(value['anchorRef'], 'TaskRequeue archiveOrigin anchorRef');
    if (anchorProblem !== null) return anchorProblem;
    const sessionProblem = sessionRefProblem(value['archiveSessionRef'], 'TaskRequeue archiveOrigin archiveSessionRef');
    if (sessionProblem !== null) return sessionProblem;
    if (!nonEmpty(value['archiveRequestId'])) return 'TaskRequeue archiveOrigin archiveRequestId is required';
    if ((value['archiveSessionRef'] as Record<string, unknown>)['projectId'] !== projectId) {
      return 'TaskRequeue archiveOrigin archive Session belongs to another project';
    }
    return null;
  }
  if (value['kind'] === 'wait') {
    if (!hasOnlyKeys(value, ['kind', 'runRef', 'messageRef', 'archiveSessionRef', 'archiveRequestId'])) {
      return 'TaskRequeue archiveOrigin wait carries unknown fields';
    }
    const runProblem = runRefProblem(value['runRef'], 'TaskRequeue archiveOrigin runRef');
    if (runProblem !== null) return runProblem;
    const messageProblem = messageRefProblem(value['messageRef'], 'TaskRequeue archiveOrigin messageRef');
    if (messageProblem !== null) return messageProblem;
    const sessionProblem = sessionRefProblem(value['archiveSessionRef'], 'TaskRequeue archiveOrigin archiveSessionRef');
    if (sessionProblem !== null) return sessionProblem;
    if (!nonEmpty(value['archiveRequestId'])) return 'TaskRequeue archiveOrigin archiveRequestId is required';
    if ((value['archiveSessionRef'] as Record<string, unknown>)['projectId'] !== projectId) {
      return 'TaskRequeue archiveOrigin archive Session belongs to another project';
    }
    return null;
  }
  return 'TaskRequeue archiveOrigin kind is not recognized';
}

/**
 * Closed `TaskRequeueSnapshotV1` shape (immutable @1). Identity agreement is
 * checked here; every derived value (`failureClass`, `basis`, `automation`, …)
 * is the `state/` constructor's output and is not re-derived by the codec.
 */
export function taskRequeueSnapshotProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'TaskRequeue snapshot must be an object';
  if (!hasOnlyKeys(value, TASK_REQUEUE_KEYS)) return 'TaskRequeue snapshot carries unknown fields';
  const refProblem = taskRequeueRefProblem(value['ref'], 'TaskRequeue ref');
  if (refProblem !== null) return refProblem;
  const ref = value['ref'] as Record<string, unknown>;
  if (value['revision'] !== 1) return 'TaskRequeue revision must be 1';
  if (value['schemaVersion'] !== 1) return 'TaskRequeue schemaVersion must be 1';
  const taskProblem = taskTripleProblem(value['task'], 'TaskRequeue task');
  if (taskProblem !== null) return taskProblem;
  const task = value['task'] as Record<string, unknown>;
  if (!sameTask(task, ref)) return 'TaskRequeue task disagrees with its ref';
  const projectId = task['projectId'] as string;
  const planProblem = planRevisionRefProblem(value['planRef'], 'TaskRequeue planRef', projectId);
  if (planProblem !== null) return planProblem;
  const afterRunProblem = runRefProblem(value['afterRunRef'], 'TaskRequeue afterRunRef');
  if (afterRunProblem !== null) return afterRunProblem;
  if (!sameGoal(value['afterRunRef'], task) || (value['afterRunRef'] as Record<string, unknown>)['runId'] !== ref['afterRunId']) {
    return 'TaskRequeue afterRunRef is not the Run named by its ref';
  }
  const attemptProblem = taskAttemptRefProblem(value['afterAttemptRef'], 'TaskRequeue afterAttemptRef');
  if (attemptProblem !== null) return attemptProblem;
  if (!sameTask(value['afterAttemptRef'] as Record<string, unknown>, task)) {
    return 'TaskRequeue afterAttemptRef belongs to another Task';
  }
  if (!KNOWN_RUN_OUTCOMES.includes(value['afterOutcome'] as string)) return 'TaskRequeue afterOutcome must be a known RunOutcome';
  if (value['afterRoundRef'] !== null) {
    const roundProblem = verificationRoundRefProblem(value['afterRoundRef'], 'TaskRequeue afterRoundRef');
    if (roundProblem !== null) return roundProblem;
    if (!sameGoal(value['afterRoundRef'], task)) return 'TaskRequeue afterRoundRef belongs to another Goal';
  }
  const classProblem = reworkFailureClassProblem(value['failureClass'], 'TaskRequeue failureClass');
  if (classProblem !== null) return classProblem;
  if (!(value['interruption'] === null || value['interruption'] === 'executing' || value['interruption'] === 'paused')) {
    return 'TaskRequeue interruption must be executing, paused or null';
  }
  if (value['stopIntentRef'] !== null) {
    const intentProblem = controlIntentRefProblem(value['stopIntentRef'], 'TaskRequeue stopIntentRef');
    if (intentProblem !== null) return intentProblem;
    if ((value['stopIntentRef'] as Record<string, unknown>)['projectId'] !== projectId) {
      return 'TaskRequeue stopIntentRef belongs to another project';
    }
  }
  if (!STOP_REQUESTERS.includes(value['stopRequester'] as string)) return 'TaskRequeue stopRequester is not recognized';
  if (value['trigger'] !== undefined) {
    const trigger = value['trigger'];
    if (!isRecord(trigger) || !hasOnlyKeys(trigger, ['kind', 'goalRef', 'resumedEpoch', 'pausedEpoch'])
      || trigger['kind'] !== 'goal_resume') {
      return 'TaskRequeue trigger must be a goal_resume trigger';
    }
    const goalProblem = goalRefProblem(trigger['goalRef'], 'TaskRequeue trigger goalRef');
    if (goalProblem !== null) return goalProblem;
    if (!sameGoal(trigger['goalRef'], task)) return 'TaskRequeue trigger goalRef is not the Task Goal';
    if (!isPositiveSafeInteger(trigger['resumedEpoch']) || !isPositiveSafeInteger(trigger['pausedEpoch'])) {
      return 'TaskRequeue trigger epochs must be positive safe integers';
    }
  }
  const basisProblem = noProgressKeyProblem(value['basis'], 'TaskRequeue basis');
  if (basisProblem !== null) return basisProblem;
  if (!sameTask((value['basis'] as Record<string, unknown>)['taskRef'] as Record<string, unknown>, task)) {
    return 'TaskRequeue basis taskRef is not the requeued Task';
  }
  if (!BASIS_COMPARISONS.includes(value['basisComparison'] as string)) return 'TaskRequeue basisComparison is not recognized';
  const superseded = value['supersededEvidenceIds'];
  if (!Array.isArray(superseded) || !superseded.every(nonEmpty)) {
    return 'TaskRequeue supersededEvidenceIds must be an array of evidence ids';
  }
  const inputsProblem = newBasisInputRefsProblem(value['newInputRefs'], 'TaskRequeue newInputRefs');
  if (inputsProblem !== null) return inputsProblem;
  if (value['budget'] !== null) {
    const budgetProblem = taskBudgetProblem(value['budget'], 'TaskRequeue budget');
    if (budgetProblem !== null) return budgetProblem;
  }
  const reasonProblem = boundedReasonProblem(value['reason'], 'TaskRequeue reason');
  if (reasonProblem !== null) return reasonProblem;
  const actorProblem = actorRefProblem(value['requestedBy'], 'TaskRequeue requestedBy');
  if (actorProblem !== null) return actorProblem;
  if (!nonEmpty(value['requestedAt'])) return 'TaskRequeue requestedAt is required';
  if (value['agentProvenance'] !== null) {
    const provenanceProblem = delegatedWriteProvenanceProblem(value['agentProvenance'], 'TaskRequeue agentProvenance', projectId);
    if (provenanceProblem !== null) return provenanceProblem;
  }
  const automation = value['automation'];
  if (!isRecord(automation) || !hasOnlyKeys(automation, ['automatic', 'counted', 'autoCount', 'cap'])
    || typeof automation['automatic'] !== 'boolean' || typeof automation['counted'] !== 'boolean'
    || !isNonNegativeSafeInteger(automation['autoCount'])
    || !(automation['cap'] === null || isNonNegativeSafeInteger(automation['cap']))) {
    return 'TaskRequeue automation must be {automatic, counted, autoCount, cap}';
  }
  const history = value['historySource'];
  if (history !== null) {
    if (!isRecord(history) || !hasOnlyKeys(history, ['sessionRef', 'adapterId', 'kernelSessionId', 'throughPosition'])) {
      return 'TaskRequeue historySource must be null or a complete history source';
    }
    const sessionProblem = sessionRefProblem(history['sessionRef'], 'TaskRequeue historySource sessionRef');
    if (sessionProblem !== null) return sessionProblem;
    if ((history['sessionRef'] as Record<string, unknown>)['projectId'] !== projectId) {
      return 'TaskRequeue historySource Session belongs to another project';
    }
    if (!nonEmpty(history['adapterId']) || !nonEmpty(history['kernelSessionId'])) {
      return 'TaskRequeue historySource requires the Kernel adapter and session ids';
    }
    if (!(history['throughPosition'] === null || isNonNegativeSafeInteger(history['throughPosition']))) {
      return 'TaskRequeue historySource throughPosition must be null or a non-negative safe integer';
    }
  }
  if (value['archiveOrigin'] !== undefined && value['archiveOrigin'] !== null) {
    const archiveOriginProblem = archiveRequeueOriginProblem(value['archiveOrigin'], projectId);
    if (archiveOriginProblem !== null) return archiveOriginProblem;
  }
  // Slice 5 §2.5 wire-only notice origin (absent on old records): the creating
  // commit cursor and, for automatic rework, the auto-rework cap at write time.
  const originProblem = noticeOriginFieldsProblem(value, 'TaskRequeue');
  if (originProblem !== null) return originProblem;
  return null;
}

/**
 * Closed `TaskReworkRefusalSnapshotV1` shape (versioned, @k). `subjectId` is
 * the afterRunId for `requeue` and the predecessor round id for `reverify`; the
 * operation-only codes and fields are checked against the ref's operation.
 */
export function taskReworkRefusalSnapshotProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'TaskReworkRefusal snapshot must be an object';
  if (!hasOnlyKeys(value, TASK_REWORK_REFUSAL_KEYS)) return 'TaskReworkRefusal snapshot carries unknown fields';
  const ref = value['ref'];
  if (!isRecord(ref) || !hasOnlyKeys(ref, ['aggregateType', 'projectId', 'goalId', 'taskId', 'operation', 'subjectId'])
    || ref['aggregateType'] !== 'TaskReworkRefusal' || !nonEmpty(ref['projectId']) || !nonEmpty(ref['goalId'])
    || !nonEmpty(ref['taskId']) || (ref['operation'] !== 'requeue' && ref['operation'] !== 'reverify')
    || !nonEmpty(ref['subjectId'])) {
    return 'TaskReworkRefusal ref must be a complete TaskReworkRefusalRef';
  }
  if (!isPositiveSafeInteger(value['revision'])) return 'TaskReworkRefusal revision must be a positive safe integer';
  if (value['schemaVersion'] !== 1) return 'TaskReworkRefusal schemaVersion must be 1';
  const taskProblem = taskTripleProblem(value['task'], 'TaskReworkRefusal task');
  if (taskProblem !== null) return taskProblem;
  const task = value['task'] as Record<string, unknown>;
  if (!sameTask(task, ref)) return 'TaskReworkRefusal task disagrees with its ref';
  const projectId = task['projectId'] as string;
  const operation = ref['operation'];
  const afterRunProblem = runRefProblem(value['afterRunRef'], 'TaskReworkRefusal afterRunRef');
  if (afterRunProblem !== null) return afterRunProblem;
  if (!sameGoal(value['afterRunRef'], task)) return 'TaskReworkRefusal afterRunRef belongs to another Goal';
  if (value['subjectRoundRef'] !== null) {
    const roundProblem = verificationRoundRefProblem(value['subjectRoundRef'], 'TaskReworkRefusal subjectRoundRef');
    if (roundProblem !== null) return roundProblem;
    if (!sameGoal(value['subjectRoundRef'], task)) return 'TaskReworkRefusal subjectRoundRef belongs to another Goal';
  }
  if (operation === 'requeue') {
    if ((value['afterRunRef'] as Record<string, unknown>)['runId'] !== ref['subjectId']) {
      return 'a requeue refusal subjectId must be its afterRun id';
    }
  } else if (value['subjectRoundRef'] === null
    || (value['subjectRoundRef'] as Record<string, unknown>)['roundId'] !== ref['subjectId']) {
    return 'a reverify refusal subjectId must be its predecessor round id';
  }
  const classProblem = reworkFailureClassProblem(value['failureClass'], 'TaskReworkRefusal failureClass');
  if (classProblem !== null) return classProblem;
  const code = value['code'];
  if (!(TASK_REWORK_REFUSAL_CODES as readonly unknown[]).includes(code)) return 'TaskReworkRefusal code is not recognized';
  if (code === 'budget_not_increased' && operation !== 'requeue') return 'budget_not_increased is a requeue-only refusal';
  if ((code === 'source_unchanged' || code === 'verification_uncovered') && operation !== 'reverify') {
    return `${String(code)} is a reverify-only refusal`;
  }
  const reasonProblem = boundedReasonProblem(value['reason'], 'TaskReworkRefusal reason');
  if (reasonProblem !== null) return reasonProblem;
  if (!(value['basisDigest'] === null || isSha256Hex(value['basisDigest']))) {
    return 'TaskReworkRefusal basisDigest must be null or a sha256 hex';
  }
  if (value['source'] !== null) {
    const sourceProblem = sourceStampProblem(value['source'], 'TaskReworkRefusal source');
    if (sourceProblem !== null) return sourceProblem;
  }
  if (value['matchedRequeueRef'] !== null) {
    const matchedProblem = taskRequeueRefProblem(value['matchedRequeueRef'], 'TaskReworkRefusal matchedRequeueRef');
    if (matchedProblem !== null) return matchedProblem;
    if (operation !== 'requeue' || code !== 'no_new_basis') {
      return 'only a requeue no_new_basis refusal names a matched TaskRequeue';
    }
    if (!sameTask(value['matchedRequeueRef'] as Record<string, unknown>, task)) {
      return 'TaskReworkRefusal matchedRequeueRef belongs to another Task';
    }
  }
  const actorProblem = actorRefProblem(value['requestedBy'], 'TaskReworkRefusal requestedBy');
  if (actorProblem !== null) return actorProblem;
  if (!nonEmpty(value['refusedAt'])) return 'TaskReworkRefusal refusedAt is required';
  if (!isNonNegativeSafeInteger(value['goalEndedRunsAtRefusal'])) {
    return 'TaskReworkRefusal goalEndedRunsAtRefusal must be a non-negative safe integer';
  }
  if (value['configurationRevision'] !== null) {
    if (!nonEmpty(value['configurationRevision'])) return 'TaskReworkRefusal configurationRevision must be null or a non-empty string';
    if (operation !== 'reverify') return 'only a reverify refusal records a configurationRevision';
  }
  return null;
}

function parseRecordEnvelope(record: EncodedRecord, schemaId: string, what: string): Record<string, unknown> | string {
  if (record.schemaId !== schemaId) return `expected schemaId ${schemaId}, got ${record.schemaId}`;
  const body = parseObject(record.json);
  if (body === null) return `${what} snapshot is not a JSON object`;
  if (!isSafeRevision(body['revision']) || body['revision'] !== record.revision) {
    return `${what} outer revision disagrees with the JSON revision`;
  }
  let refKey: string | null;
  try { refKey = canonicalJson(body['ref'] as JsonValue); } catch { refKey = null; }
  if (refKey !== record.refKey) return `${what} ref is not the outer canonical ref_key`;
  return body;
}

/**
 * Removes the wire-only notice origin from a decoded public DTO. The persisted
 * record still carries `since`/`noticeAutomationCap`; only `decodeNoticeOrigin`
 * may read them (SPEC §2.5: origin separate from the public domain DTO).
 */
function withoutNoticeOrigin<T extends Record<string, unknown>>(value: T): T {
  const copy = { ...value };
  delete copy['since'];
  delete copy['noticeAutomationCap'];
  return copy;
}

/**
 * Encodes the immutable `TaskRequeue@1` snapshot. An optional `origin` writes
 * the wire-only notice origin (`since: null` plus the Store commit-cursor
 * binding); the public DTO is never extended. The origin fields are merged on
 * the parsed wire object (not a protected-record spread) because state/ is the
 * only writer of the snapshot's own fields.
 */
export function encodeTaskRequeueSnapshot(snapshot: TaskRequeueSnapshotV1, origin?: NoticeOriginWireV1): EncodedRecord {
  const record: EncodedRecord = { refKey: taskRequeueRefKey(snapshot.ref), schemaId: TASK_REQUEUE_SCHEMA_ID,
    revision: snapshot.revision, json: JSON.stringify(snapshot) };
  if (origin === undefined) return record;
  const wire = JSON.parse(record.json) as Record<string, unknown>;
  if (origin.since !== undefined) wire['since'] = origin.since;
  if (origin.noticeAutomationCap !== undefined) wire['noticeAutomationCap'] = origin.noticeAutomationCap;
  return { ...record, json: JSON.stringify(wire) };
}

/** Decodes one `TaskRequeue@1` record; the public DTO never carries the origin. */
export function decodeTaskRequeueSnapshot(record: EncodedRecord): DecodeResult<TaskRequeueSnapshotV1> {
  const body = parseRecordEnvelope(record, TASK_REQUEUE_SCHEMA_ID, 'TaskRequeue');
  if (typeof body === 'string') return invalid(body);
  const problem = taskRequeueSnapshotProblem(body);
  if (problem !== null) return invalid(problem);
  // Slice 1 §2.9 default: an old requeue without the optional origin stays
  // absent; every reader applies `archiveOrigin ?? null` (R2).
  return { status: 'decoded', value: withoutNoticeOrigin(body) as unknown as TaskRequeueSnapshotV1 };
}

/** Encodes one revision of a `TaskReworkRefusal` (each revision is written whole). */
export function encodeTaskReworkRefusalSnapshot(snapshot: TaskReworkRefusalSnapshotV1): EncodedRecord {
  return { refKey: taskReworkRefusalRefKey(snapshot.ref), schemaId: TASK_REWORK_REFUSAL_SCHEMA_ID,
    revision: snapshot.revision, json: JSON.stringify(snapshot) };
}

/** Decodes one `TaskReworkRefusal@1` record at its exact revision. */
export function decodeTaskReworkRefusalSnapshot(record: EncodedRecord): DecodeResult<TaskReworkRefusalSnapshotV1> {
  const body = parseRecordEnvelope(record, TASK_REWORK_REFUSAL_SCHEMA_ID, 'TaskReworkRefusal');
  if (typeof body === 'string') return invalid(body);
  const problem = taskReworkRefusalSnapshotProblem(body);
  if (problem !== null) return invalid(problem);
  return { status: 'decoded', value: body as unknown as TaskReworkRefusalSnapshotV1 };
}

function reworkEventBody(event: EncodedDomainEvent, eventType: string): Record<string, unknown> | string {
  if (event.eventType !== eventType) return `expected eventType ${eventType}, got ${event.eventType}`;
  if (event.schemaVersion !== TASK_REWORK_EVENT_SCHEMA_VERSION) {
    return `expected schemaVersion ${String(TASK_REWORK_EVENT_SCHEMA_VERSION)}, got ${String(event.schemaVersion)}`;
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return `${eventType} envelope is incomplete`;
  const body = parseObject(event.json);
  if (body === null) return `${eventType} event is not a JSON object`;
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType
    || body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return `${eventType} json does not match the envelope`;
  }
  if (!nonEmpty(body['identityKey'])) return `${eventType} identityKey is required`;
  if (!nonEmpty(body['fingerprint'])) return `${eventType} fingerprint is required`;
  const actorProblem = actorRefProblem(body['actor'], `${eventType} actor`);
  if (actorProblem !== null) return actorProblem;
  return body;
}

/** Encodes the `TaskRequeued` replay event. */
export function encodeTaskRequeuedEvent(event: TaskRequeuedEvent): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

/** Decodes a `TaskRequeued` event; its actor is the recorded requester. */
export function taskRequeuedEventFromEvent(event: EncodedDomainEvent): DecodeResult<TaskRequeuedEvent> {
  const body = reworkEventBody(event, TASK_REQUEUED_EVENT_TYPE);
  if (typeof body === 'string') return invalid(body);
  if (!hasOnlyKeys(body, ['eventId', 'eventType', 'schemaVersion', 'occurredAt', 'identityKey', 'actor', 'fingerprint', 'requeue'])) {
    return invalid('TaskRequeued carries unknown fields');
  }
  const problem = taskRequeueSnapshotProblem(body['requeue']);
  if (problem !== null) return invalid(problem);
  if (!sameJson((body['requeue'] as Record<string, unknown>)['requestedBy'], body['actor'])) {
    return invalid('TaskRequeued requestedBy disagrees with the event actor');
  }
  // R2: an absent `archiveOrigin` key stays absent; readers apply `?? null`.
  const requeue = withoutNoticeOrigin(body['requeue'] as Record<string, unknown>);
  return { status: 'decoded', value: { ...body, requeue } as unknown as TaskRequeuedEvent };
}

/** Encodes the `TaskReworkRefused` replay event. */
export function encodeTaskReworkRefusedEvent(event: TaskReworkRefusedEvent): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

/** Decodes a `TaskReworkRefused` event; its actor is the recorded requester. */
export function taskReworkRefusedEventFromEvent(event: EncodedDomainEvent): DecodeResult<TaskReworkRefusedEvent> {
  const body = reworkEventBody(event, TASK_REWORK_REFUSED_EVENT_TYPE);
  if (typeof body === 'string') return invalid(body);
  if (!hasOnlyKeys(body, ['eventId', 'eventType', 'schemaVersion', 'occurredAt', 'identityKey', 'actor', 'fingerprint', 'refusal'])) {
    return invalid('TaskReworkRefused carries unknown fields');
  }
  const problem = taskReworkRefusalSnapshotProblem(body['refusal']);
  if (problem !== null) return invalid(problem);
  if (!sameJson((body['refusal'] as Record<string, unknown>)['requestedBy'], body['actor'])) {
    return invalid('TaskReworkRefused requestedBy disagrees with the event actor');
  }
  return { status: 'decoded', value: body as unknown as TaskReworkRefusedEvent };
}

// --------------------------------------------------------------------------
// Registration
// --------------------------------------------------------------------------

function validateAttemptRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  const decoded = decodeTaskAttemptSnapshot(record);
  return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
}
function validateOutboxRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  const decoded = decodeDispatchOutboxEntry(record);
  return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
}
function validateClaimedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = taskClaimedEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}
function validateRequeueRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  const decoded = decodeTaskRequeueSnapshot(record);
  return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
}
function validateReworkRefusalRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  const decoded = decodeTaskReworkRefusalSnapshot(record);
  return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
}
function validateRequeuedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = taskRequeuedEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}
function validateReworkRefusedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = taskReworkRefusedEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

export const TASK_CLAIM_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    { schemaId: TASK_ATTEMPT_SCHEMA_ID, aggregateType: 'TaskAttempt', validate: validateAttemptRecord },
    { schemaId: TASK_CLAIM_OUTBOX_SCHEMA_ID, aggregateType: 'DispatchOutboxEntry', validate: validateOutboxRecord },
    { schemaId: TASK_REQUEUE_SCHEMA_ID, aggregateType: 'TaskRequeue', validate: validateRequeueRecord,
      commitCursorFields: NOTICE_ORIGIN_COMMIT_CURSOR_FIELDS },
    { schemaId: TASK_REWORK_REFUSAL_SCHEMA_ID, aggregateType: 'TaskReworkRefusal', validate: validateReworkRefusalRecord },
  ],
  events: [
    { eventType: TASK_CLAIMED_EVENT_TYPE, schemaVersion: TASK_CLAIMED_EVENT_SCHEMA_VERSION, validate: validateClaimedEvent },
    { eventType: TASK_REQUEUED_EVENT_TYPE, schemaVersion: TASK_REWORK_EVENT_SCHEMA_VERSION, validate: validateRequeuedEvent },
    { eventType: TASK_REWORK_REFUSED_EVENT_TYPE, schemaVersion: TASK_REWORK_EVENT_SCHEMA_VERSION, validate: validateReworkRefusedEvent },
  ],
  lookups: [
    { name: WORK_EXECUTION_BY_SESSION_LOOKUP, aggregateType: 'DispatchOutboxEntry',
      paths: ['claim.task.projectId', 'claim.workspaceId', 'claim.sessionRef.sessionId'] },
    { name: S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP, aggregateType: 'DispatchOutboxEntry',
      paths: ['claim.task.projectId', 'claim.workspaceId', 'claim.sessionRef.sessionId'],
      orderBy: { path: 'claim.generation', valueType: 'integer' } },
    ...S2A_REQUEUE_LOOKUP_INDEXES,
  ],
};
