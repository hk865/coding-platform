/**
 * R4c.1 claim-record codecs.
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
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type {
  DispatchOutboxRef, RunOutcome, TaskAttemptRef, TaskAttemptSnapshot, TaskAttemptStatus,
} from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { TaskClaim, TaskClaimOutbox } from './claim-contracts.js';
import { taskDispatchStateV1Problem } from '../persistence/execution-entry-codecs.js';

/** Encoding selectors for the new records. Reuse the existing @1 convention. */
export const TASK_ATTEMPT_SCHEMA_ID = 'TaskAttemptSnapshot@1';
export const TASK_CLAIM_OUTBOX_SCHEMA_ID = 'DispatchOutboxEntrySnapshot@1';
export const TASK_CLAIMED_EVENT_TYPE = 'TaskClaimed';
export const TASK_CLAIMED_EVENT_SCHEMA_VERSION = 1;

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
function parseObject(json: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function invalid<T>(reason: string): DecodeResult<T> {
  return { status: 'invalid', reason };
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
  if (!(body['endOutcome'] === null || RUN_OUTCOMES.includes(body['endOutcome'] as RunOutcome))) {
    return invalid('TaskAttempt endOutcome is not a RunOutcome or null');
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
    const stateProblem = taskDispatchStateV1Problem(dispatchState);
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
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
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

export const TASK_CLAIM_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    { schemaId: TASK_ATTEMPT_SCHEMA_ID, aggregateType: 'TaskAttempt', validate: validateAttemptRecord },
    { schemaId: TASK_CLAIM_OUTBOX_SCHEMA_ID, aggregateType: 'DispatchOutboxEntry', validate: validateOutboxRecord },
  ],
  events: [
    { eventType: TASK_CLAIMED_EVENT_TYPE, schemaVersion: TASK_CLAIMED_EVENT_SCHEMA_VERSION, validate: validateClaimedEvent },
  ],
  lookups: [],
};
