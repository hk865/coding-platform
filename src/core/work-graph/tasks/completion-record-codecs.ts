/**
 * R3e.3 completion record codecs (implementation).
 *
 * The ONE owner of:
 *  - the `TaskReductionSnapshot@1` ENCODER (the schema stays registered ONLY by
 *    `plan-readers.ts::PLAN_STATE_RECORD_SCHEMAS`; it is never re-registered);
 *  - the `GoalPhaseSnapshot@1` codec;
 *  - the `TaskCompleted` / `GoalCompleted` replay events carrying the ORIGINAL
 *    returned value so a receipt replay restores value/cursor.
 *
 * Runtime imports are deliberately limited to the fingerprint/pure-structure
 * helpers; readers/DTOs are type-imported, which keeps
 * `plan-readers.ts -> this file` a one-way runtime edge. Encoders throw on a
 * non-canonical ref; decoders never fake `decoded` and never accept a record
 * whose outer envelope disagrees with its JSON body.
 */
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalPhaseSnapshot } from '../../../contracts/goal-phase.js';
import type { TaskReductionSnapshot } from '../../../contracts/reduction.js';
import type { VerificationRoundRef } from '../../../contracts/verification.js';

// -------------------------------------------------------------------------- //
// Schema / event names (frozen)                                              //
// -------------------------------------------------------------------------- //

/** Owned/registered by `plan-readers.ts`; referenced here for encoding only. */
export const TASK_REDUCTION_SNAPSHOT_SCHEMA_ID = 'TaskReductionSnapshot@1' as const;
export const GOAL_PHASE_SNAPSHOT_SCHEMA_ID = 'GoalPhaseSnapshot@1' as const;

export const TASK_COMPLETED_EVENT_TYPE = 'TaskCompleted' as const;
export const GOAL_COMPLETED_EVENT_TYPE = 'GoalCompleted' as const;
export const COMPLETION_EVENT_SCHEMA_VERSION = 1 as const;

/** Trusted Host actor for a committed completion operation. */
export type CompletionEventActor = Extract<ActorRef, { kind: 'human' | 'system' }>;

type CompletionEventBase = {
  eventId: string;
  schemaVersion: typeof COMPLETION_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  actor: CompletionEventActor;
  fingerprint: string;
};

/** Discriminated completion replay event union with the ORIGINAL result. */
export type TaskCompletedEvent = CompletionEventBase & {
  eventType: typeof TASK_COMPLETED_EVENT_TYPE;
  goalRef: GoalRef;
  taskRef: TaskTriple;
  result: TaskReductionSnapshot;
};
export type GoalCompletedEvent = CompletionEventBase & {
  eventType: typeof GOAL_COMPLETED_EVENT_TYPE;
  goalRef: GoalRef;
  result: GoalPhaseSnapshot;
};
export type CompletionEvent = TaskCompletedEvent | GoalCompletedEvent;

export const COMPLETION_EVENT_TYPES: readonly CompletionEvent['eventType'][] = [
  TASK_COMPLETED_EVENT_TYPE,
  GOAL_COMPLETED_EVENT_TYPE,
];

// -------------------------------------------------------------------------- //
// Pure shape helpers                                                         //
// -------------------------------------------------------------------------- //

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function invalid<T>(reason: string): DecodeResult<T> {
  return { status: 'invalid', reason };
}
function parseObject(json: string): UnknownRecord | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function canonicalOf(value: unknown): string | null {
  try { return canonicalJson(value as JsonValue); } catch { return null; }
}
function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
function actorProblem(value: unknown): string | null {
  if (!isRecord(value) || (value['kind'] !== 'human' && value['kind'] !== 'system') || !nonEmpty(value['id'])) {
    return 'the actor must be a trusted human/system actor';
  }
  return null;
}
function refProblem(value: unknown, aggregateType: string, fields: readonly string[]): string | null {
  if (!isRecord(value) || value['aggregateType'] !== aggregateType) {
    return `${aggregateType} ref must be a complete ${aggregateType} reference`;
  }
  for (const field of fields) {
    if (!nonEmpty(value[field])) return `${aggregateType} ref is missing ${field}`;
  }
  return null;
}
function roundRefProblem(value: unknown): string | null {
  return refProblem(value, 'VerificationRound', ['projectId', 'workspaceId', 'goalId', 'taskId', 'runId', 'roundId']);
}
function planRefProblem(value: unknown): string | null {
  return refProblem(value, 'PlanRevision', ['projectId', 'planId']);
}
function goalRefProblem(value: unknown): string | null {
  return refProblem(value, 'Goal', ['projectId', 'goalId']);
}
function taskTripleProblem(value: unknown): string | null {
  if (!isRecord(value) || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])) {
    return 'the subject must be a complete TaskTriple';
  }
  return null;
}
function taskReductionRefProblem(value: unknown): string | null {
  return refProblem(value, 'TaskReduction', ['projectId', 'goalId', 'taskId']);
}

const REDUCTION_PHASES = ['verifying', 'blocked', 'failed', 'satisfied'] as const;

/** Structural validation of one embedded TaskReduction result. */
function taskReductionProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'the TaskCompleted result must be an object';
  if (taskReductionRefProblem(value['ref']) !== null) return 'the TaskCompleted result ref must be a complete TaskReductionRef';
  if (!isSafeRevision(value['revision'])) return 'the TaskCompleted result revision must be a positive safe integer';
  if (value['schemaVersion'] !== 1) return 'the TaskCompleted result schemaVersion must be 1';
  if (planRefProblem(value['planRef']) !== null) return 'the TaskCompleted result planRef must be a PlanRevisionRef';
  if (!isSafeRevision(value['planRevision'])) return 'the TaskCompleted result planRevision must be a positive integer';
  if (value['taskKind'] !== 'work' && value['taskKind'] !== 'gate') return 'the TaskCompleted result taskKind is not legal';
  if (value['requirementLevel'] !== 'required' && value['requirementLevel'] !== 'optional') return 'the TaskCompleted result requirementLevel is not legal';
  if (!REDUCTION_PHASES.includes(value['phase'] as typeof REDUCTION_PHASES[number])) return 'the TaskCompleted result phase is not legal';
  for (const field of ['effectiveEvidenceIds', 'blockingEvidenceIds', 'staleEvidenceIds', 'outOfScopeEvidenceIds',
    'satisfiedObligationIds', 'causes']) {
    if (!Array.isArray(value[field])) return `the TaskCompleted result ${field} must be an array`;
  }
  if (!isRecord(value['currentAnchor'])) return 'the TaskCompleted result currentAnchor must be an object';
  if (!nonEmpty(value['reducedAt'])) return 'the TaskCompleted result reducedAt is required';
  if (value['completion'] !== undefined) {
    const completion = value['completion'];
    if (!isRecord(completion) || completion['schemaVersion'] !== 1) return 'the TaskCompleted result completion audit must be version 1';
    if (roundRefProblem(completion['roundRef']) !== null) return 'the TaskCompleted result completion roundRef is incomplete';
    if (!isSafeRevision(completion['roundRevision'])) return 'the TaskCompleted result completion roundRevision must be a positive integer';
    if (planRefProblem(completion['taskBasisRef']) !== null) return 'the TaskCompleted result completion taskBasisRef is incomplete';
    if (!isRecord(completion['verificationPlanRef'])) return 'the TaskCompleted result completion verificationPlanRef is incomplete';
    if (!nonEmpty(completion['configurationDigest'])) return 'the TaskCompleted result completion configurationDigest is required';
    if (!Array.isArray(completion['evidenceRefs'])) return 'the TaskCompleted result completion evidenceRefs must be an array';
  }
  return null;
}

/** Structural validation of one GoalPhaseSnapshot body. */
function goalPhaseProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'GoalPhaseSnapshot must be an object';
  if (!hasOnlyKeys(value, ['ref', 'revision', 'schemaVersion', 'planRef', 'planRevision', 'phase',
    'adoptedTaskReductions', 'satisfiedObligationIds', 'reducedAt'])) {
    return 'GoalPhaseSnapshot carries unknown fields';
  }
  if (refProblem(value['ref'], 'GoalPhase', ['projectId', 'goalId']) !== null) return 'GoalPhaseSnapshot ref is incomplete';
  if (!isSafeRevision(value['revision'])) return 'GoalPhaseSnapshot revision must be a positive safe integer';
  if (value['schemaVersion'] !== 1) return 'GoalPhaseSnapshot schemaVersion must be 1';
  if (planRefProblem(value['planRef']) !== null) return 'GoalPhaseSnapshot planRef must be a PlanRevisionRef';
  if (!isSafeRevision(value['planRevision'])) return 'GoalPhaseSnapshot planRevision must be a positive integer';
  if (value['phase'] !== 'COMPLETED') return 'GoalPhaseSnapshot phase must be COMPLETED';
  if (!Array.isArray(value['adoptedTaskReductions'])) return 'GoalPhaseSnapshot adoptedTaskReductions must be an array';
  for (const entry of value['adoptedTaskReductions']) {
    if (!isRecord(entry) || taskReductionRefProblem(entry['ref']) !== null || !isSafeRevision(entry['revision'])) {
      return 'GoalPhaseSnapshot adoptedTaskReductions must carry complete TaskReduction refs and revisions';
    }
  }
  if (!Array.isArray(value['satisfiedObligationIds']) || !value['satisfiedObligationIds'].every(nonEmpty)) {
    return 'GoalPhaseSnapshot satisfiedObligationIds must be non-empty strings';
  }
  if (!nonEmpty(value['reducedAt'])) return 'GoalPhaseSnapshot reducedAt is required';
  return null;
}

// -------------------------------------------------------------------------- //
// Encoders / decoders                                                        //
// -------------------------------------------------------------------------- //

function recordProblem(record: EncodedRecord, schemaId: string, refChecks: (body: UnknownRecord) => string | null): string | null {
  if (record.schemaId !== schemaId) return `expected schemaId ${schemaId}, got ${record.schemaId}`;
  const body = parseObject(record.json);
  if (body === null) return 'the record is not a JSON object';
  const problem = refChecks(body);
  if (problem !== null) return problem;
  if (body['revision'] !== record.revision) return 'the outer revision disagrees with the JSON revision';
  if (canonicalOf(body['ref']) !== record.refKey) return 'the ref is not the outer canonical ref_key';
  return null;
}

/** Encode one TaskReduction snapshot. The `TaskReductionSnapshot@1` schema is
 * registered by `plan-readers.ts`, never here. */
export function encodeTaskReductionSnapshot(snapshot: TaskReductionSnapshot): EncodedRecord {
  const refKey = canonicalOf(snapshot.ref);
  if (refKey === null) throw new Error('TaskReduction ref is not canonical JSON');
  return { refKey, schemaId: TASK_REDUCTION_SNAPSHOT_SCHEMA_ID, revision: snapshot.revision, json: JSON.stringify(snapshot) };
}

/** Encode one GoalPhase snapshot. */
export function encodeGoalPhaseSnapshot(snapshot: GoalPhaseSnapshot): EncodedRecord {
  const refKey = canonicalOf(snapshot.ref);
  if (refKey === null) throw new Error('GoalPhase ref is not canonical JSON');
  return { refKey, schemaId: GOAL_PHASE_SNAPSHOT_SCHEMA_ID, revision: snapshot.revision, json: JSON.stringify(snapshot) };
}

/** Decode and strictly validate one `GoalPhaseSnapshot@1` record. */
export function decodeGoalPhaseSnapshot(record: EncodedRecord): DecodeResult<GoalPhaseSnapshot> {
  const problem = recordProblem(record, GOAL_PHASE_SNAPSHOT_SCHEMA_ID, goalPhaseProblem);
  if (problem !== null) return invalid(problem);
  return { status: 'decoded', value: parseObject(record.json) as unknown as GoalPhaseSnapshot };
}

/** Encode one completion replay event, including its original result. */
export function encodeCompletionEvent(event: CompletionEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

function eventEnvelopeProblem(body: UnknownRecord, event: EncodedDomainEvent): string | null {
  if (body['eventId'] !== event.eventId) return 'event json does not match the envelope eventId';
  if (body['eventType'] !== event.eventType) return 'event json does not match the envelope eventType';
  if (body['schemaVersion'] !== event.schemaVersion) return 'event json does not match the envelope schemaVersion';
  if (body['occurredAt'] !== event.occurredAt) return 'event json does not match the envelope occurredAt';
  if (!nonEmpty(body['identityKey'])) return 'the event identityKey is required';
  if (!nonEmpty(body['fingerprint'])) return 'the event fingerprint is required';
  const actor = actorProblem(body['actor']);
  if (actor !== null) return actor;
  if (goalRefProblem(body['goalRef']) !== null) return 'the event goalRef is incomplete';
  if (!isRecord(body['result'])) return 'the event result payload must be an object';
  return null;
}

/** Decode and strictly validate one completion replay event. */
export function completionEventFromEvent(event: EncodedDomainEvent): DecodeResult<CompletionEvent> {
  if (!isRecord(event)) return invalid('a completion event must be an object');
  if (!COMPLETION_EVENT_TYPES.includes(event['eventType'] as CompletionEvent['eventType'])) {
    return invalid(`unexpected completion eventType ${String(event['eventType'])}`);
  }
  if (event['schemaVersion'] !== COMPLETION_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${String(COMPLETION_EVENT_SCHEMA_VERSION)}, got ${String(event['schemaVersion'])}`);
  }
  if (!nonEmpty(event['eventId']) || !nonEmpty(event['occurredAt'])) return invalid('the completion event envelope is incomplete');
  if (typeof event['json'] !== 'string') return invalid('the completion event json must be a string');
  const body = parseObject(event['json']);
  if (body === null) return invalid('the completion event is not a JSON object');
  const envelope = eventEnvelopeProblem(body, event);
  if (envelope !== null) return invalid(envelope);
  if (event['eventType'] === TASK_COMPLETED_EVENT_TYPE) {
    if (taskTripleProblem(body['taskRef']) !== null) return invalid('the TaskCompleted taskRef is incomplete');
    const result = taskReductionProblem(body['result']);
    if (result !== null) return invalid(result);
    const taskRef = body['taskRef'] as UnknownRecord;
    const reduction = body['result'] as UnknownRecord;
    const reductionRef = reduction['ref'] as UnknownRecord;
    if (reductionRef['taskId'] !== taskRef['taskId'] || reductionRef['goalId'] !== taskRef['goalId']
      || reductionRef['projectId'] !== taskRef['projectId']) {
      return invalid('the TaskCompleted result ref disagrees with its taskRef');
    }
  } else {
    const result = goalPhaseProblem(body['result']);
    if (result !== null) return invalid(result);
  }
  return { status: 'decoded', value: body as unknown as CompletionEvent };
}

// -------------------------------------------------------------------------- //
// Registration                                                               //
// -------------------------------------------------------------------------- //

function validateGoalPhaseRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  const problem = recordProblem(record, GOAL_PHASE_SNAPSHOT_SCHEMA_ID, goalPhaseProblem);
  return problem !== null ? invalid(problem) : { status: 'decoded', value: record };
}
function validateCompletionEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = completionEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

/**
 * The ONE R3e.3 completion registration: `GoalPhaseSnapshot@1` plus the two
 * completion replay events. `TaskReductionSnapshot@1` stays exclusively in
 * `PLAN_STATE_RECORD_SCHEMAS`.
 */
export const COMPLETION_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    { schemaId: GOAL_PHASE_SNAPSHOT_SCHEMA_ID, aggregateType: 'GoalPhase', validate: validateGoalPhaseRecord },
  ],
  events: COMPLETION_EVENT_TYPES.map(eventType => ({
    eventType, schemaVersion: COMPLETION_EVENT_SCHEMA_VERSION, validate: validateCompletionEvent,
  })),
  lookups: [],
};
