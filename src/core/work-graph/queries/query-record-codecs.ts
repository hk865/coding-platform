/**
 * R5b.1 record/event codecs for the QueryJob submitted pair.
 *
 * Wire shape (frozen):
 *   QueryJobSnapshot@1 records reuse the existing `QueryJobSnapshot` contract
 *   body; a QueryJobSubmitted@1 event keeps the legacy shape
 *   `{eventId, eventType, schemaVersion: 1, ... QueryJobSubmittedEvent}` with
 *   `payload.job` exactly the pending `QueryJobV1`.
 *
 * The formal submit writer also mirrors its writer-generated submission locator
 * (`identityKey`/`fingerprint`) at the TOP LEVEL of the submitted event. That
 * mirror is the same locator the Job snapshot stores, never a second
 * authorization, and it never changes `payload.job`. Historical snapshots and
 * events that predate the locator stay readable: the field is optional on the
 * record and the event decoder does not require the mirror.
 *
 * QueryRun keeps exactly ONE registration owner: the material `record-readers.ts`
 * owns `QueryRunSnapshot@1`. This file only performs the pure encode/decode the
 * query component needs, by reusing that owner's existing validator through the
 * narrow export; it never re-registers QueryRun.
 *
 * Boundaries deliberately enforced here: these callbacks only check persistent
 * encoding, identity and version. They never admit a business operation, never
 * judge "no Plan", focus eligibility, permission or Session occupancy, and never
 * re-normalize stored JSON.
 */
import type { QueryEntryTicket, QueryExecutionRecord } from './contracts.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { GoalScreeningShape, validQueryExecution } from '../../../contracts/query-job.js';
import {
  invalid, isNonNeg, isPos, isRecord, isSha256Hex, nonEmpty, parseTaggedObject, type UnknownRecord,
} from '../../../contracts/validation/common.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { isArtifactRef } from '../../record-store/body-codec.js';
import type {
  PendingQueryJobSnapshot,
  QueryCloseDetailV1,
  QueryExecutionStateV1,
  QueryJobAnswerRef,
  QueryJobAnswerSnapshot,
  QueryJobIntentV1,
  QueryJobRef,
  QueryJobSnapshot,
  QueryJobSubmittedEvent,
  QueryJobV1,
  QueryRoundKind,
  QueryRunRef,
  QueryRunSnapshot,
  RequestUnderstandingCommandV1,
} from '../../../contracts/query-job.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { CurrentPointerRef } from '../../../contracts/note.js';
import {
  CurrentPointerRefShape, GoalRefShape, OperationRefShape, QueryJobRefShape, QueryRunRefShape,
} from '../../../contracts/data-format-refs.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  EncodedEventSchema,
  EncodedRecord,
  EncodedRecordSchema,
  RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { RecordLookupIndex } from '../../record-store/lookup-ports.js';
import { QUERY_RUN_RECORD_SCHEMA, executionPreparedProblem, executionRequestProfileProblem, validateQueryRunSnapshot } from '../materials/record-readers.js';
import { encodeEventEnvelope } from '../persistence/event-envelope.js';
import { isPlatformCursor } from '../sessions/session-record-codecs.js';
import { aggregateRefProblem } from '../persistence/decision-record-codecs.js';
import { QUERY_ACTIVITY_RECORD_SCHEMAS } from '../persistence/query-activity-codecs.js';
import { planRevisionRefProblem, sessionRefProblem } from '../persistence/rework-codecs.js';
import { QUERY_RUN_BY_SESSION_LOOKUP } from '../model/session-facts-contracts.js';
import {
  QUERY_BY_REQUEST_INDEX, QUERY_OPEN_BY_WORKSPACE_INDEX, QUERY_RAN_BY_SESSION_GOAL_INDEX,
  REQUEST_ROOT_MARK, REQUEST_ROOTS_BY_GOAL_INDEX, requestGoalSlot,
} from '../model/request-contracts.js';
import { ideasIssues } from '../model/request-ideas.js';

export const QUERY_JOB_SUBMITTED_EVENT = 'QueryJobSubmitted';
export const QUERY_JOB_EVENT_SCHEMA_VERSION = 1;
export const QUERY_JOB_SNAPSHOT_SCHEMA_ID = 'QueryJobSnapshot@1';
export const QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA_ID = 'QueryJobAnswerSnapshot@1';
/** Slice 2C L4 index 7: the latest (or paged) Query of a Session by sessionGeneration. */
export const S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP = 's2c-query-run-by-session-generation';
/**
 * Slice 5 §4.2 source-5 index: the formal questions of one Goal's workspace.
 * The name/paths are frozen; a missing `job.goalId` is null.
 */
export const S5_QUERY_JOB_BY_GOAL = 'query-job-by-workspace-goal';
export const QUERY_EXECUTION_EVENT = 'QueryExecutionRecorded';
export const QUERY_EXECUTION_EVENT_SCHEMA_VERSION = 1;
export const QUERY_JOB_ANSWERED_EVENT = 'QueryJobAnswered';
/** Persisted operation discriminants of one QueryRun's execution event. */
export const QUERY_EXECUTION_OPERATIONS = ['claimed', 'prepared', 'entering', 'entered', 'usage', 'admitted', 'observed'] as const;
export type QueryExecutionOperation = typeof QUERY_EXECUTION_OPERATIONS[number];

/**
 * The submitted-event envelope plus the writer-generated locator mirror. The
 * `payload.job` half is exactly the legacy `QueryJobSubmittedEvent`.
 */
export type QueryJobSubmittedEventV1 = QueryJobSubmittedEvent & {
  identityKey: string;
  fingerprint: string;
};

/** One persisted QueryRun execution/observation operation event. The payload
 * carries the SAME run's versioned state; `executionState` may be null only for
 * an operation that has no state projection. */
export type QueryExecutionRecordedEventV1 = {
  eventId: string;
  eventType: 'QueryExecutionRecorded';
  schemaVersion: 1;
  /** Exact accepted operation identity; replay restores its original result. */
  identityKey: string;
  fingerprint: string;
  projectId: string;
  workspaceId: string;
  aggregateType: 'QueryRun';
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    queryRunRef: QueryRunRef;
    operation: QueryExecutionOperation;
    /** Immutable original receipt value, never rebuilt from newer snapshots. */
    result: QueryExecutionRecord | QueryEntryTicket | QueryRunSnapshot;
    /**
     * The written Run's phase; `settled` with a null state for a pending round
     * ended before any attempt, and `pending` with a null state only for a new
     * attempt's Run, created with no execution state.
     */
    phase: QueryExecutionStateV1['phase'] | 'pending';
    executionState: QueryExecutionStateV1 | null;
  };
};

/** The terminal answered event carrying the formal answer snapshot. */
export type QueryJobAnsweredEventV1 = {
  eventId: string;
  eventType: 'QueryJobAnswered';
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: 'QueryJobAnswer';
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { answer: QueryJobAnswerSnapshot };
};

// --------------------------------------------------------------------------
// Small pure shape helpers
// --------------------------------------------------------------------------

function copyRecord(record: EncodedRecord): EncodedRecord {
  return { refKey: record.refKey, schemaId: record.schemaId, revision: record.revision, json: record.json };
}

function copyEvent(event: EncodedDomainEvent): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: event.json,
  };
}

// --------------------------------------------------------------------------
// Ref / intent shape helpers shared by the record and event validators
// --------------------------------------------------------------------------

const QUERY_ROUND_KINDS: readonly QueryRoundKind[] = ['request', 'followup', 'reply', 'expiry', 'explain', 'routing'];
const CLOSE_CODES = ['timeout', 'gap', 'failed', 'stale_source', 'cancelled', 'not_entered', 'invalid_answer'] as const;
const CLOSE_DETAILS: readonly QueryCloseDetailV1[] = ['too_long', 'empty', 'protocol', 'dropped', 'no_binding'];
const INVALID_ANSWER_DETAILS: readonly (QueryCloseDetailV1 | null)[] = ['too_long', 'empty', 'protocol'];
const CANCELLED_DETAILS: readonly (QueryCloseDetailV1 | null)[] = [null, 'dropped', 'no_binding'];

function queryJobRefFromValue(value: unknown): QueryJobRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'QueryJob') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) ||
      !nonEmpty(value['queryJobId'])) return null;
  return {
    aggregateType: 'QueryJob',
    projectId: value['projectId'],
    workspaceId: value['workspaceId'],
    queryJobId: value['queryJobId'],
  };
}

export function queryRunRefFromValue(value: unknown): QueryRunRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'QueryRun') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) ||
      !nonEmpty(value['queryJobId']) || !nonEmpty(value['runId'])) return null;
  return {
    aggregateType: 'QueryRun',
    projectId: value['projectId'],
    workspaceId: value['workspaceId'],
    queryJobId: value['queryJobId'],
    runId: value['runId'],
  };
}

function isTaskRef(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value['aggregateType'] === 'Task' &&
    nonEmpty(value['projectId']) &&
    nonEmpty(value['goalId']) &&
    nonEmpty(value['taskId']);
}

function isActorRef(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!nonEmpty(value['id'])) return false;
  const kind = value['kind'];
  if (kind === 'human' || kind === 'system') return true;
  if (kind !== 'agent') return false;
  const runRef = value['runRef'];
  return isRecord(runRef) && runRef['aggregateType'] === 'Run' &&
    nonEmpty(runRef['projectId']) && nonEmpty(runRef['goalId']) &&
    nonEmpty(runRef['runId']);
}

function isQueryJobStatus(value: unknown): boolean {
  return value === 'pending' || value === 'running' || value === 'answered' || value === 'closed';
}

/** Pure persistent shape of one `QueryJobIntentV1`; permission is not judged here. */
export function queryJobIntentIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['intent must be an object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('intent.schemaVersion must be 1');
  for (const field of ['intentId', 'projectId', 'workspaceId', 'correlationId'] as const) {
    if (!nonEmpty(value[field])) issues.push(`intent.${field} must be a non-empty string`);
  }
  if (value['goalId'] !== null && !nonEmpty(value['goalId'])) {
    issues.push('intent.goalId must be null or a non-empty string');
  }
  if (typeof value['question'] !== 'string') issues.push('intent.question must be a string');
  const focus = value['focusTaskRefs'];
  if (!Array.isArray(focus)) issues.push('intent.focusTaskRefs must be an array');
  else focus.forEach((ref, index) => {
    if (!isTaskRef(ref)) issues.push(`intent.focusTaskRefs[${index}] is not a complete TaskRef`);
  });
  const budget = value['budget'];
  if (!isRecord(budget)) issues.push('intent.budget must be an object');
  else {
    if (budget['maxTokens'] !== null && !isPos(budget['maxTokens'])) issues.push('intent.budget.maxTokens must be null or a positive integer');
    if (budget['deadline'] !== null && typeof budget['deadline'] !== 'string') {
      issues.push('intent.budget.deadline must be null or a string');
    }
  }
  const multiTurn = value['multiTurn'];
  if (!isRecord(multiTurn) || !isPos(multiTurn['maxRounds'])) {
    issues.push('intent.multiTurn.maxRounds must be a positive integer');
  }
  const execution = value['execution'];
  if (!isRecord(execution)) issues.push('intent.execution must be an object');
  else if (!validQueryExecution(execution as QueryJobIntentV1['execution'])) {
    issues.push('intent.execution is not a valid QueryExecutionBinding shape');
  }
  return issues;
}

function submissionIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['submission must be an object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('submission.schemaVersion must be 1');
  if (!nonEmpty(value['identityKey'])) issues.push('submission.identityKey must be a non-empty string');
  if (!isSha256Hex(value['fingerprint'])) issues.push('submission.fingerprint must be a lowercase sha256 hex');
  if (!nonEmpty(value['eventId'])) issues.push('submission.eventId must be a non-empty string');
  return issues;
}

function answerRefIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return ['job.answerRefs must be an array'];
  const issues: string[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry) || entry['aggregateType'] !== 'QueryJobAnswer' ||
        !nonEmpty(entry['projectId']) || !nonEmpty(entry['workspaceId']) ||
        !nonEmpty(entry['queryJobId']) || !nonEmpty(entry['answerId'])) {
      issues.push(`job.answerRefs[${index}] is not a complete QueryJobAnswerRef`);
    }
  });
  return issues;
}

/** A `VersionedRef`: a complete aggregate ref plus a positive revision. */
function versionedRefIssue(value: unknown): string | null {
  if (!isRecord(value)) return 'must be an object';
  const problem = aggregateRefProblem(value['ref']);
  if (problem !== null) return problem;
  return isPos(value['revision']) ? null : 'revision must be a positive safe integer';
}

function routingIssues(value: unknown): string[] {
  if (value === null) return [];
  if (!isRecord(value)) return ['job.routing must be null or an object'];
  const issues: string[] = [];
  if (!(value['from'] === null || sessionRefProblem(value['from'], 'SessionRef') === null)) issues.push('job.routing.from must be null or a SessionRef');
  if (!(value['to'] === null || sessionRefProblem(value['to'], 'SessionRef') === null)) issues.push('job.routing.to must be null or a SessionRef');
  if (!['handoff', 'manual', 'archived', 'dropped', 'assigned'].includes(value['reason'] as string)) {
    issues.push('job.routing.reason is not a legal routing reason');
  }
  return issues;
}

/** The three readings of a stored understanding field: absent, the one current shape, or damaged. */
export type UnderstandingCommandReadV1 =
  | { kind: 'absent' }
  | { kind: 'ready'; command: RequestUnderstandingCommandV1 }
  | { kind: 'damaged'; reason: string };

const UNDERSTANDING_KEYS = [
  'kind', 'commandId', 'operation', 'generation', 'requestRoot', 'goals', 'checkedRound', 'state',
] as const;
/** The pre-migration shape: one `pointers` entry per goal, the operation as `operationRef`. */
const OLD_UNDERSTANDING_KEYS = [
  'kind', 'operationId', 'operationRef', 'requestRoot', 'goals', 'pointers', 'checkedRound', 'generation', 'state',
] as const;
const UNDERSTANDING_STATES = ['live', 'closed', 'consumed'] as const;

function hasExactlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** One `{goalRef, pointer, pointerRevision}` entry: the goal, the pointer it was checked at and that revision. */
function understandingGoalProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'must be an object';
  if (!hasExactlyKeys(value, ['goalRef', 'pointer', 'pointerRevision'])) {
    return 'must have exactly goalRef, pointer and pointerRevision';
  }
  const goal = checkShape(GoalRefShape, value['goalRef'], 'stored');
  if (goal !== null) return `goalRef: ${goal}`;
  const pointer = checkShape(CurrentPointerRefShape, value['pointer'], 'stored');
  if (pointer !== null) return `pointer: ${pointer}`;
  return isNonNeg(value['pointerRevision']) ? null : 'pointerRevision must be a non-negative safe integer';
}

/** Validates one command in either the current or the pre-migration shape. */
function understandingCommandProblem(value: UnknownRecord, old: boolean): string | null {
  if (value['kind'] !== 'request_understanding') return 'kind must be request_understanding';
  if (old) {
    if (!nonEmpty(value['operationId'])) return 'operationId must be a non-empty string';
    const operation = checkShape(OperationRefShape, value['operationRef'], 'stored');
    if (operation !== null) return `operationRef: ${operation}`;
  } else {
    if (!nonEmpty(value['commandId'])) return 'commandId must be a non-empty string';
    const operation = checkShape(OperationRefShape, value['operation'], 'stored');
    if (operation !== null) return `operation: ${operation}`;
  }
  if (!isPos(value['generation'])) return 'generation must be a positive integer';
  const requestRoot = checkShape(QueryJobRefShape, value['requestRoot'], 'stored');
  if (requestRoot !== null) return `requestRoot: ${requestRoot}`;
  const goals = value['goals'];
  if (!Array.isArray(goals)) return 'goals must be an array';
  if (old) {
    for (let index = 0; index < goals.length; index += 1) {
      const goal = checkShape(GoalRefShape, goals[index], 'stored');
      if (goal !== null) return `goals[${index}]: ${goal}`;
    }
  } else {
    for (let index = 0; index < goals.length; index += 1) {
      const problem = understandingGoalProblem(goals[index]);
      if (problem !== null) return `goals[${index}] ${problem}`;
    }
  }
  const checkedRound = value['checkedRound'];
  if (checkedRound !== null) {
    const problem = checkShape(QueryRunRefShape, checkedRound, 'stored');
    if (problem !== null) return `checkedRound: ${problem}`;
  }
  if (!UNDERSTANDING_STATES.includes(value['state'] as (typeof UNDERSTANDING_STATES)[number])) {
    return 'state must be live, closed or consumed';
  }
  if (!old) return null;
  // The old shape kept its per-goal facts in `pointers`, one per goal in the goals' order.
  const pointers = value['pointers'];
  if (!Array.isArray(pointers) || pointers.length !== goals.length) {
    return 'pointers must have one entry per goal';
  }
  for (let index = 0; index < pointers.length; index += 1) {
    const pointer = pointers[index];
    if (!isRecord(pointer) || !hasExactlyKeys(pointer, ['goalRef', 'pointer', 'revision'])) {
      return `pointers[${index}] must have exactly goalRef, pointer and revision`;
    }
    const goalRef = checkShape(GoalRefShape, pointer['goalRef'], 'stored');
    if (goalRef !== null) return `pointers[${index}].goalRef: ${goalRef}`;
    const pointerRef = checkShape(CurrentPointerRefShape, pointer['pointer'], 'stored');
    if (pointerRef !== null) return `pointers[${index}].pointer: ${pointerRef}`;
    if (!isNonNeg(pointer['revision'])) return `pointers[${index}].revision must be a non-negative safe integer`;
    if (canonicalJson(pointer['goalRef'] as unknown as JsonValue)
      !== canonicalJson(goals[index] as unknown as JsonValue)) {
      return `pointers[${index}].goalRef is not goals[${index}]`;
    }
  }
  return null;
}

/**
 * A missing field is absent; the old shape maps once to the current one; an
 * unknown or damaged shape is damaged. Later commits write only the current
 * shape, under the same command identity.
 */
export function normalizeUnderstandingCommand(value: unknown): UnderstandingCommandReadV1 {
  if (value === undefined || value === null) return { kind: 'absent' };
  if (!isRecord(value)) return { kind: 'damaged', reason: 'must be an object' };
  if (hasExactlyKeys(value, UNDERSTANDING_KEYS)) {
    const problem = understandingCommandProblem(value, false);
    if (problem !== null) return { kind: 'damaged', reason: problem };
    return { kind: 'ready', command: value as unknown as RequestUnderstandingCommandV1 };
  }
  if (!hasExactlyKeys(value, OLD_UNDERSTANDING_KEYS)) return { kind: 'damaged', reason: 'has unknown or missing fields' };
  const problem = understandingCommandProblem(value, true);
  if (problem !== null) return { kind: 'damaged', reason: problem };
  const operation = value['operationRef'] as OperationRef;
  const pointers = value['pointers'] as { goalRef: GoalRef; pointer: CurrentPointerRef; revision: number }[];
  return { kind: 'ready', command: {
    kind: 'request_understanding',
    commandId: `${operation.operationId}:understanding:${String(value['generation'])}`,
    operation: structuredClone(operation),
    generation: value['generation'] as number,
    requestRoot: structuredClone(value['requestRoot'] as QueryJobRef),
    goals: pointers.map(pointer => ({
      goalRef: structuredClone(pointer.goalRef),
      pointer: structuredClone(pointer.pointer),
      pointerRevision: pointer.revision,
    })),
    checkedRound: value['checkedRound'] === null ? null : structuredClone(value['checkedRound'] as QueryRunRef),
    state: value['state'] as RequestUnderstandingCommandV1['state'],
  } };
}

function receiptIssues(value: unknown): string[] {
  if (value === null) return [];
  if (!isRecord(value)) return ['job.receipt must be null or an object'];
  const kind = value['kind'];
  if (kind === 'submit') {
    const issues: string[] = [];
    if (queryJobRefFromValue(value['requestRoot']) === null) issues.push('job.receipt.requestRoot is not a complete QueryJobRef');
    if (queryJobRefFromValue(value['round']) === null) issues.push('job.receipt.round is not a complete QueryJobRef');
    if (value['assignment'] === 'assigned') {
      if (!(sessionRefProblem(value['secretary'], 'SessionRef') === null)) issues.push('job.receipt.secretary must be a SessionRef when assigned');
      if (typeof value['created'] !== 'boolean') issues.push('job.receipt.created must be a boolean');
    } else if (value['assignment'] === 'unassigned') {
      if (value['secretary'] !== null) issues.push('job.receipt.secretary must be null when unassigned');
      if (value['created'] !== false) issues.push('job.receipt.created must be false when unassigned');
    } else {
      issues.push('job.receipt.assignment must be assigned or unassigned');
    }
    return issues;
  }
  if (kind === 'route') {
    return queryJobRefFromValue(value['routingRound']) === null
      ? ['job.receipt.routingRound is not a complete QueryJobRef'] : [];
  }
  if (kind === 'select_idea' || kind === 'ask') {
    const issues: string[] = [];
    if (queryJobRefFromValue(value['followupRound']) === null) issues.push('job.receipt.followupRound is not a complete QueryJobRef');
    if (!(value['secretary'] === null || sessionRefProblem(value['secretary'], 'SessionRef') === null)) {
      issues.push('job.receipt.secretary must be null or a SessionRef');
    }
    return issues;
  }
  if (kind === 'understanding') {
    return queryJobRefFromValue(value['round']) === null
      ? ['job.receipt.round is not a complete QueryJobRef'] : [];
  }
  return ['job.receipt.kind is not a legal receipt kind'];
}

function goalCardDraftIssues(value: unknown, path: string): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return [`${path} must be an object`];
  if (typeof value['objective'] !== 'string') issues.push(`${path}.objective must be a string`);
  const completion = value['completion'];
  if (!Array.isArray(completion) || completion.some(entry => typeof entry !== 'string')) {
    issues.push(`${path}.completion must be an array of strings`);
  }
  if (!['every_step', 'after_plan_confirmation'].includes(value['autonomy'] as string)) {
    issues.push(`${path}.autonomy is not a legal GoalAutonomyV1`);
  }
  // `null` is not screened; any other value is the model's screening, kept as returned.
  if (value['screening'] !== null) {
    const problem = checkShape(GoalScreeningShape, value['screening'], 'stored');
    if (problem !== null) issues.push(`${path}.screening: ${problem}`);
  }
  return issues;
}

function closeReasonIssues(value: unknown): string[] {
  if (value === null) return [];
  if (!isRecord(value)) return ['job.closeReason must be null or an object'];
  const issues: string[] = [];
  const code = value['code'];
  const detail = value['detail'];
  // `not_entered` (§8 SD-4): closed by reconciliation without ever entering the Kernel.
  // `invalid_answer` (§3.1.8): the answer failed the secretary protocol.
  if (!(CLOSE_CODES as readonly unknown[]).includes(code)) {
    issues.push('job.closeReason.code is not a legal close code');
  }
  if (typeof value['message'] !== 'string') issues.push('job.closeReason.message must be a string');
  if (!Object.hasOwn(value, 'detail')) {
    issues.push('job.closeReason.detail is required');
  } else if (!(detail === null || CLOSE_DETAILS.includes(detail as QueryCloseDetailV1))) {
    issues.push('job.closeReason.detail must be null or a legal close detail');
  } else {
    // §3.1.8: the detail is legal only together with its close code.
    const detailsForCode = code === 'invalid_answer' ? INVALID_ANSWER_DETAILS
      : code === 'cancelled' ? CANCELLED_DETAILS : [null];
    if (!(detailsForCode as readonly unknown[]).includes(detail)) {
      issues.push(`job.closeReason.detail is not legal for close code ${String(code)}`);
    }
  }
  return issues;
}

/** QueryJobAnswerRef shape helper shared by the record and event validators. */
function queryJobAnswerRefFromValue(value: unknown): QueryJobAnswerRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'QueryJobAnswer') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) ||
      !nonEmpty(value['queryJobId']) || !nonEmpty(value['answerId'])) return null;
  return {
    aggregateType: 'QueryJobAnswer',
    projectId: value['projectId'],
    workspaceId: value['workspaceId'],
    queryJobId: value['queryJobId'],
    answerId: value['answerId'],
  };
}

/** Pure persistent shape of one QueryJobAnswerV1; permission/currentness is not
 * judged here. The bodyRef must be a real artifact reference. */
function answerIssues(value: unknown, expectedRef: QueryJobAnswerRef | null): string[] {
  if (!isRecord(value)) return ['answer must be an object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('answer.schemaVersion must be 1');
  if (!nonEmpty(value['answerId'])) issues.push('answer.answerId must be a non-empty string');
  const jobRef = queryJobRefFromValue(value['queryJobRef']);
  if (jobRef === null) issues.push('answer.queryJobRef is not a complete QueryJobRef');
  const runRef = queryRunRefFromValue(value['runRef']);
  if (runRef === null) issues.push('answer.runRef is not a complete QueryRunRef');
  if (expectedRef !== null) {
    if (value['answerId'] !== expectedRef.answerId) issues.push('answer.answerId disagrees with the record ref');
    if (jobRef !== null && (jobRef.projectId !== expectedRef.projectId || jobRef.workspaceId !== expectedRef.workspaceId
        || jobRef.queryJobId !== expectedRef.queryJobId)) {
      issues.push('answer.queryJobRef disagrees with the record ref scope');
    }
  }
  if (!Number.isSafeInteger(value['roundIndex']) || (value['roundIndex'] as number) < 0) {
    issues.push('answer.roundIndex must be a non-negative safe integer');
  }
  if (typeof value['answer'] !== 'string') issues.push('answer.answer must be a string');
  else if (Buffer.byteLength(value['answer'] as string, 'utf8') > 16 * 1024) issues.push('answer.answer exceeds 16 KiB');
  const sources = value['sources'];
  if (!Array.isArray(sources)) issues.push('answer.sources must be an array');
  else if (sources.length > 64) issues.push('answer.sources exceeds 64 witnesses');
  else sources.forEach((source, index) => {
    if (!isRecord(source) || !nonEmpty(source['kind']) || !nonEmpty(source['refKey']) ||
        !(source['version'] === null || typeof source['version'] === 'string') ||
        !(source['label'] === null || typeof source['label'] === 'string')) {
      issues.push(`answer.sources[${index}] is not a complete source witness`);
    }
  });
  if (value['followsAnswerRef'] !== null && queryJobAnswerRefFromValue(value['followsAnswerRef']) === null) {
    issues.push('answer.followsAnswerRef must be null or a complete QueryJobAnswerRef');
  }
  if (typeof value['stale'] !== 'boolean') issues.push('answer.stale must be a boolean');
  if (!(value['staleReason'] === null || typeof value['staleReason'] === 'string')) {
    issues.push('answer.staleReason must be null or a string');
  }
  if (!nonEmpty(value['answeredAt'])) issues.push('answer.answeredAt must be a non-empty string');
  const bodyRef = value['bodyRef'];
  if (!isRecord(bodyRef) || bodyRef['kind'] !== 'artifact' || !nonEmpty(bodyRef['contentType']) ||
      !isSha256Hex(bodyRef['digest']) || !isPos(bodyRef['sizeBytes']) || !isRecord(bodyRef['source'])) {
    issues.push('answer.bodyRef is not a complete ArtifactRef');
  }
  // §3.1.7: both arrays are required in the current format (decision 79).
  // Persistence re-checks the stored ideas with the one idea rule the answer check also used.
  issues.push(...ideasIssues(value['ideas'], 'answer.ideas'));
  const drafts = value['goalCardDrafts'];
  if (!Array.isArray(drafts)) issues.push('answer.goalCardDrafts must be an array');
  else drafts.forEach((draft, index) => {
    issues.push(...goalCardDraftIssues(draft, `answer.goalCardDrafts[${index}]`));
  });
  // Required, with no old-format default: `null` is a plan that names no draft;
  // an integer names one of this answer's own drafts.
  if (!Object.hasOwn(value, 'planDraftIndex')) {
    issues.push('answer.planDraftIndex is missing');
  } else {
    const planDraftIndex = value['planDraftIndex'];
    if (planDraftIndex !== null) {
      const namesDraft = Number.isSafeInteger(planDraftIndex) && (planDraftIndex as number) >= 0
        && Array.isArray(drafts) && (planDraftIndex as number) <= drafts.length - 1;
      if (!namesDraft) issues.push('answer.planDraftIndex must be null or name one of the goal card drafts');
    }
  }
  return issues;
}

// --------------------------------------------------------------------------
// Query request prompt facts (PC-1b ruling 27)
// --------------------------------------------------------------------------

const QUERY_PROMPT_FACT_KEYS = ['systemDigest', 'toolsDigest', 'toolSpecsRef', 'selection'] as const;
const QUERY_SELECTION_KEYS = ['inputTokens', 'budget', 'removed'] as const;
const QUERY_SELECTION_REMOVED_KEYS = ['memory', 'skillReference', 'additionalInstruction', 'toolResultBody',
  'historyExchange', 'historyConclusion', 'currentExchange'] as const;
const ARTIFACT_REF_KEYS = ['kind', 'contentType', 'digest', 'sizeBytes', 'source'] as const;
const ARTIFACT_SOURCE_KEYS = ['kind', 'refId', 'revision', 'digest'] as const;
const QUERY_REQUEST_KEYS = ['requestId', 'requestDigest', 'reservedInput', 'reservedOutput', 'inputTokens',
  'outputTokens', 'cachedInputTokens', 'usageStatus', 'admitted', 'prompt'] as const;
const QUERY_USAGE_STATUSES = ['reserved', 'reported', 'unknown'] as const;

/** Exact key set: an unknown or a missing field is both a rejection. */
function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** The prompt facts' ArtifactRef: the store validator plus an exact source shape. */
function isExactArtifactRef(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ARTIFACT_REF_KEYS) || !isArtifactRef(value)) return false;
  const source = value['source'];
  if (!isRecord(source)) return false;
  const sourceKeys = Object.keys(source);
  if (sourceKeys.length !== 3 && sourceKeys.length !== 4) return false;
  if (!sourceKeys.every(key => (ARTIFACT_SOURCE_KEYS as readonly string[]).includes(key))) return false;
  return sourceKeys.length === 3 || typeof source['digest'] === 'string';
}

/**
 * Strict persistent shape of one Query request's prompt facts. Query drops the
 * output cap: the row's existing `reservedOutput` carries it. Every level is
 * exact, so a historical row is never silently widened by an unknown field.
 */
export function queryPromptFactsIssues(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!hasExactKeys(value, QUERY_PROMPT_FACT_KEYS)) {
    issues.push(`${path} must carry exactly ${QUERY_PROMPT_FACT_KEYS.join(', ')}`);
  }
  if (!isSha256Hex(value['systemDigest'])) issues.push(`${path}.systemDigest must be a lowercase sha256 hex`);
  if (!isSha256Hex(value['toolsDigest'])) issues.push(`${path}.toolsDigest must be a lowercase sha256 hex`);
  if (!isExactArtifactRef(value['toolSpecsRef'])) issues.push(`${path}.toolSpecsRef must be a complete ArtifactRef`);
  const selection = value['selection'];
  if (!isRecord(selection) || !hasExactKeys(selection, QUERY_SELECTION_KEYS)) {
    issues.push(`${path}.selection must carry exactly ${QUERY_SELECTION_KEYS.join(', ')}`);
  } else {
    if (!isNonNeg(selection['inputTokens'])) issues.push(`${path}.selection.inputTokens must be a non-negative integer`);
    if (!isNonNeg(selection['budget'])) issues.push(`${path}.selection.budget must be a non-negative integer`);
    const removed = selection['removed'];
    if (!isRecord(removed) || !hasExactKeys(removed, QUERY_SELECTION_REMOVED_KEYS)) {
      issues.push(`${path}.selection.removed must carry exactly ${QUERY_SELECTION_REMOVED_KEYS.join(', ')}`);
    } else {
      for (const key of QUERY_SELECTION_REMOVED_KEYS) {
        if (!isNonNeg(removed[key])) issues.push(`${path}.selection.removed.${key} must be a non-negative integer`);
      }
    }
  }
  return issues;
}

/** Strict shape of one persisted Query model request row, prompt facts included. */
function queryModelRequestIssues(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!hasExactKeys(value, QUERY_REQUEST_KEYS)) {
    issues.push(`${path} must carry exactly ${QUERY_REQUEST_KEYS.join(', ')}`);
  }
  if (!nonEmpty(value['requestId'])) issues.push(`${path}.requestId must be a non-empty string`);
  if (!nonEmpty(value['requestDigest'])) issues.push(`${path}.requestDigest must be a non-empty string`);
  if (!isNonNeg(value['reservedInput'])) issues.push(`${path}.reservedInput must be a non-negative integer`);
  if (!isNonNeg(value['reservedOutput'])) issues.push(`${path}.reservedOutput must be a non-negative integer`);
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens'] as const) {
    if (!(value[key] === null || isNonNeg(value[key]))) issues.push(`${path}.${key} must be null or a non-negative integer`);
  }
  if (!(QUERY_USAGE_STATUSES as readonly unknown[]).includes(value['usageStatus'])) {
    issues.push(`${path}.usageStatus must be reserved, reported or unknown`);
  }
  if (typeof value['admitted'] !== 'boolean') issues.push(`${path}.admitted must be a boolean`);
  issues.push(...queryPromptFactsIssues(value['prompt'], `${path}.prompt`));
  return issues;
}

/** Versioned execution-state projection shape; used by the operation event. */
function executionStateIssues(value: unknown): string[] {
  if (value === null) return [];
  if (!isRecord(value)) return ['executionState must be null or an object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('executionState.schemaVersion must be 1');
  if (!['claimed', 'prepared', 'entering', 'entered', 'unknown', 'settled'].includes(value['phase'] as string)) {
    issues.push('executionState.phase is not a legal phase');
  }
  if (!isRecord(value['sessionRef'])) issues.push('executionState.sessionRef must be an object');
  if (!Number.isSafeInteger(value['sessionGeneration']) || (value['sessionGeneration'] as number) < 1) {
    issues.push('executionState.sessionGeneration must be a positive integer');
  }
  if (!Array.isArray(value['requests'])) issues.push('executionState.requests must be an array');
  else value['requests'].forEach((request, index) => {
    issues.push(...queryModelRequestIssues(request, `executionState.requests[${index}]`));
  });
  const requestProfileProblem = executionRequestProfileProblem(value['requestProfile']);
  if (requestProfileProblem !== null) issues.push(`executionState.${requestProfileProblem}`);
  const preparedProblem = executionPreparedProblem(value['prepared']);
  if (preparedProblem !== null) issues.push(`executionState.${preparedProblem}`);
  // QRR-05 (A.2 step 5.6): the optional cause of phase `unknown`.
  const unknown = value['unknown'];
  if (unknown !== undefined) {
    const valid = isRecord(unknown) && ((unknown['kind'] === 'unresolved_tools' && Array.isArray(unknown['toolCallIds'])
      && unknown['toolCallIds'].length > 0 && unknown['toolCallIds'].every(nonEmpty))
      || (unknown['kind'] === 'kernel_unreadable' && (unknown['verdict'] === 'missing' || unknown['verdict'] === 'damaged')));
    if (!valid) issues.push('executionState.unknown must name the unresolved tool calls or the unreadable Kernel verdict');
  }
  return issues;
}

/**
 * The persisted Query manifest's goal and request facts. A plain Query pins a
 * goal and carries no request facts; a secretary round pins the request facts,
 * and only a no-goal request round has a null goal. The rules are checked here
 * because both manifest loaders decode the same stored body.
 */
export function queryManifestProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'the Query manifest must be an object';
  const assembly = value['contextAssembly'];
  const callKind = isRecord(assembly) ? assembly['callKind'] : undefined;
  const goal = value['goal'];
  if (goal !== null) {
    if (!isRecord(goal) || !isRecord(goal['ref'])
      || goal['ref']['aggregateType'] !== 'Goal'
      || !nonEmpty(goal['ref']['projectId']) || !nonEmpty(goal['ref']['goalId'])
      || !isPos(goal['revision'])) {
      return 'the Query manifest goal is not a Goal pin';
    }
  }
  // The frozen Plan pins a Plan of the goal's project (a secretary's stage
  // anchors take its version); a manifest without a goal freezes none.
  const focusPlan = value['focusPlan'];
  if (focusPlan !== null) {
    if (goal === null) return 'a Query manifest without a goal must not freeze a Plan';
    if (!isRecord(focusPlan) || !isPos(focusPlan['revision'])) return 'the Query manifest focusPlan is not a Plan pin';
    const planProblem = planRevisionRefProblem(focusPlan['ref'], 'the Query manifest focusPlan.ref',
      (goal['ref'] as Record<string, unknown>)['projectId'] as string);
    if (planProblem !== null) return planProblem;
  }
  const request = value['request'];
  if (request !== null && !isRecord(request)) return 'the Query manifest request is not an object';
  if (goal === null && callKind !== 'secretary') {
    return 'a Query manifest without a goal must be a secretary round';
  }
  if (request === null) {
    if (callKind === 'secretary') return 'a secretary round manifest has no request facts';
    return null;
  }
  if (callKind !== 'secretary') return 'only a secretary round may carry request facts';
  const requestProblem = secretaryRequestManifestProblem(request);
  if (requestProblem !== null) return requestProblem;
  const effectiveGoalId = request['effectiveGoalId'];
  if (goal === null) {
    if (effectiveGoalId !== null) return 'a no-goal request manifest must not freeze an effective goal';
  } else if (effectiveGoalId !== (goal['ref'] as Record<string, unknown>)['goalId']) {
    return 'the request facts and the manifest goal name different goals';
  }
  return null;
}

function secretaryRequestManifestProblem(value: UnknownRecord): string | null {
  if (queryJobRefFromValue(value['requestRoot']) === null) return 'the request facts have no complete request root';
  if (!isPlatformCursor(value['preparationCursor'])) return 'the request facts have no preparation cursor';
  if (!(value['effectiveGoalId'] === null || nonEmpty(value['effectiveGoalId']))) {
    return 'the request facts effectiveGoalId must be null or a non-empty string';
  }
  if (!['semantic_query', 'initial_coordination'].includes(value['executionKind'] as string)) {
    return 'the request facts executionKind is not legal';
  }
  // Both members are required on a stored manifest; a missing one is refused
  // rather than read as null or the empty list.
  if (value['briefRef'] !== null) {
    const briefProblem = checkShape(OperationRefShape, value['briefRef'], 'stored');
    if (briefProblem !== null) return `the request facts briefRef is not an OperationRef: ${briefProblem}`;
  }
  const grants = value['understandingGrants'];
  if (!Array.isArray(grants)) return 'the request facts understandingGrants must be an array';
  for (let index = 0; index < grants.length; index += 1) {
    const grantProblem = checkShape(GoalRefShape, grants[index], 'stored');
    if (grantProblem !== null) return `the request facts understandingGrants[${index}] is not a GoalRef: ${grantProblem}`;
  }
  const roundProblem = secretaryRoundMaterialProblem(value['round'], 'request.round');
  if (roundProblem !== null) return roundProblem;
  const batch = value['batch'];
  if (!Array.isArray(batch)) return 'request.batch must be an array';
  for (let index = 0; index < batch.length; index += 1) {
    const problem = secretaryRoundMaterialProblem(batch[index], `request.batch[${index}]`);
    if (problem !== null) return problem;
  }
  return null;
}

function secretaryRoundMaterialProblem(value: unknown, path: string): string | null {
  if (!isRecord(value)) return `${path} must be an object`;
  const ref = queryJobRefFromValue(value['ref']);
  if (ref === null) return `${path}.ref is not a complete QueryJobRef`;
  if (!isPos(value['revision'])) return `${path}.revision must be a positive integer`;
  const runRef = queryRunRefFromValue(value['runRef']);
  if (runRef === null) return `${path}.runRef is not a complete QueryRunRef`;
  if (runRef.projectId !== ref.projectId || runRef.workspaceId !== ref.workspaceId
    || runRef.queryJobId !== ref.queryJobId) {
    return `${path}.runRef does not belong to ${path}.ref`;
  }
  if (!isPos(value['runRevision'])) return `${path}.runRevision must be a positive integer`;
  if (!isPlatformCursor(value['since'])) return `${path}.since is not a commit cursor`;
  if (typeof value['text'] !== 'string') return `${path}.text must be a string`;
  const idea = value['selectedIdea'];
  if (idea !== null) {
    if (!isRecord(idea)) return `${path}.selectedIdea must be null or an object`;
    if (queryJobRefFromValue(idea['round']) === null) return `${path}.selectedIdea.round is not a complete QueryJobRef`;
    if (!isNonNeg(idea['index'])) return `${path}.selectedIdea.index must be a non-negative integer`;
    if (typeof idea['title'] !== 'string' || typeof idea['detail'] !== 'string') {
      return `${path}.selectedIdea must carry string title and detail`;
    }
  }
  const cards = value['relatedCards'];
  if (!Array.isArray(cards)) return `${path}.relatedCards must be an array`;
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (!isRecord(card)) return `${path}.relatedCards[${index}] must be an object`;
    const refProblem = versionedRefIssue(card['ref']);
    if (refProblem !== null) return `${path}.relatedCards[${index}].ref ${refProblem}`;
    if (!(card['current'] === null || isPos(card['current']))) {
      return `${path}.relatedCards[${index}].current must be null or a positive integer`;
    }
  }
  if (!Object.hasOwn(value, 'command')) return `${path}.command is missing`;
  const command = normalizeUnderstandingCommand(value['command']);
  if (command.kind === 'damaged') return `${path}.command is invalid: ${command.reason}`;
  return null;
}

function envelopeIssues(parsed: UnknownRecord, event: EncodedDomainEvent, label: string): string[] {
  const issues: string[] = [];
  if (parsed['eventId'] !== event.eventId) issues.push(`${label} outer eventId disagrees with the event JSON`);
  if (parsed['eventType'] !== event.eventType) issues.push(`${label} outer eventType disagrees with the event JSON`);
  if (parsed['schemaVersion'] !== event.schemaVersion) issues.push(`${label} outer schemaVersion disagrees with the event JSON`);
  if (parsed['occurredAt'] !== event.occurredAt) issues.push(`${label} outer occurredAt disagrees with the event JSON`);
  if (!nonEmpty(parsed['projectId'])) issues.push(`${label} projectId must be a non-empty string`);
  if (!nonEmpty(parsed['workspaceId'])) issues.push(`${label} workspaceId must be a non-empty string`);
  if (!nonEmpty(parsed['aggregateId'])) issues.push(`${label} aggregateId must be a non-empty string`);
  if (!nonEmpty(parsed['causationId'])) issues.push(`${label} causationId must be a non-empty string`);
  if (!nonEmpty(parsed['correlationId'])) issues.push(`${label} correlationId must be a non-empty string`);
  if (!nonEmpty(parsed['idempotencyKey'])) issues.push(`${label} idempotencyKey must be a non-empty string`);
  if (!isActorRef(parsed['actor'])) issues.push(`${label} actor is not a valid ActorRef`);
  if (!isPos(parsed['aggregateRevision'])) issues.push(`${label} aggregateRevision must be a positive integer`);
  return issues;
}

/** Pure persistent shape of one `QueryJobV1`, including its exact ref agreement. */
function jobIssues(value: unknown, expectedRef: QueryJobRef | null): string[] {
  if (!isRecord(value)) return ['job must be an object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('job.schemaVersion must be 1');
  if (!nonEmpty(value['queryJobId'])) issues.push('job.queryJobId must be a non-empty string');
  if (!nonEmpty(value['projectId'])) issues.push('job.projectId must be a non-empty string');
  if (!nonEmpty(value['workspaceId'])) issues.push('job.workspaceId must be a non-empty string');
  if (value['goalId'] !== null && !nonEmpty(value['goalId'])) {
    issues.push('job.goalId must be null or a non-empty string');
  }
  if (expectedRef !== null) {
    if (value['queryJobId'] !== expectedRef.queryJobId) issues.push('job.queryJobId disagrees with the record ref');
    if (value['projectId'] !== expectedRef.projectId) issues.push('job.projectId disagrees with the record ref');
    if (value['workspaceId'] !== expectedRef.workspaceId) issues.push('job.workspaceId disagrees with the record ref');
  }
  issues.push(...queryJobIntentIssues(value['intent']));
  if (!isQueryJobStatus(value['status'])) issues.push('job.status is not a QueryJobStatus');
  const runRef = value['runRef'];
  if (runRef !== null) {
    const parsed = queryRunRefFromValue(runRef);
    if (parsed === null) issues.push('job.runRef is not a complete QueryRunRef');
    else if (nonEmpty(value['projectId']) && nonEmpty(value['workspaceId']) &&
        nonEmpty(value['queryJobId']) &&
        (parsed.projectId !== value['projectId'] || parsed.workspaceId !== value['workspaceId'] ||
         parsed.queryJobId !== value['queryJobId'])) {
      issues.push('job.runRef does not belong to this QueryJob');
    }
  }
  issues.push(...answerRefIssues(value['answerRefs']));
  issues.push(...closeReasonIssues(value['closeReason']));
  // 6A request fields: all required in the current format (decision 79).
  if (!(value['requestRoot'] === null || queryJobRefFromValue(value['requestRoot']) !== null)) {
    issues.push('job.requestRoot must be null or a complete QueryJobRef');
  }
  if (!(value['roundKind'] === null || QUERY_ROUND_KINDS.includes(value['roundKind'] as QueryRoundKind))) {
    issues.push('job.roundKind is not null or a legal QueryRoundKind');
  }
  if (!(value['requestGoalId'] === null || nonEmpty(value['requestGoalId']))) {
    issues.push('job.requestGoalId must be null or a non-empty string');
  }
  if (!(value['assignedSession'] === null || sessionRefProblem(value['assignedSession'], 'SessionRef') === null)) {
    issues.push('job.assignedSession must be null or a SessionRef');
  }
  issues.push(...routingIssues(value['routing']));
  const relatedMessageRef = value['relatedMessageRef'];
  if (!(relatedMessageRef === null || (isRecord(relatedMessageRef)
      && relatedMessageRef['aggregateType'] === 'SessionMessage' && nonEmpty(relatedMessageRef['projectId'])
      && nonEmpty(relatedMessageRef['workspaceId']) && nonEmpty(relatedMessageRef['messageId'])))) {
    issues.push('job.relatedMessageRef must be null or a complete SessionMessageRef');
  }
  if (!(value['absorbedInto'] === null || queryJobRefFromValue(value['absorbedInto']) !== null)) {
    issues.push('job.absorbedInto must be null or a complete QueryJobRef');
  }
  if (!Array.isArray(value['absorbedRounds'])) {
    issues.push('job.absorbedRounds must be an array');
  } else {
    value['absorbedRounds'].forEach((round, index) => {
      if (queryJobRefFromValue(round) === null) issues.push(`job.absorbedRounds[${index}] is not a complete QueryJobRef`);
    });
  }
  const selectedIdea = value['selectedIdea'];
  if (!(selectedIdea === null || (isRecord(selectedIdea) && queryJobRefFromValue(selectedIdea['round']) !== null
      && Number.isSafeInteger(selectedIdea['index']) && (selectedIdea['index'] as number) >= 0))) {
    issues.push('job.selectedIdea must be null or a { round, non-negative index } selection');
  }
  if (!(value['goalAttribution'] === null || nonEmpty(value['goalAttribution']))) {
    issues.push('job.goalAttribution must be null or a non-empty string');
  }
  if (!Array.isArray(value['relatedCardRefs'])) {
    issues.push('job.relatedCardRefs must be an array');
  } else {
    value['relatedCardRefs'].forEach((entry, index) => {
      const problem = versionedRefIssue(entry);
      if (problem !== null) issues.push(`job.relatedCardRefs[${index}] is not a complete VersionedRef: ${problem}`);
    });
  }
  if (!(value['enteredSession'] === null || sessionRefProblem(value['enteredSession'], 'SessionRef') === null)) {
    issues.push('job.enteredSession must be null or a SessionRef');
  }
  if (!(value['intakeSession'] === null || sessionRefProblem(value['intakeSession'], 'SessionRef') === null)) {
    issues.push('job.intakeSession must be null or a SessionRef');
  }
  issues.push(...receiptIssues(value['receipt']));
  const understanding = normalizeUnderstandingCommand(value['understanding']);
  if (understanding.kind === 'damaged') issues.push(`job.understanding is invalid: ${understanding.reason}`);
  if (!nonEmpty(value['submittedAt'])) issues.push('job.submittedAt must be a non-empty string');
  if (!nonEmpty(value['updatedAt'])) issues.push('job.updatedAt must be a non-empty string');
  return issues;
}

// --------------------------------------------------------------------------
// Index slots
// --------------------------------------------------------------------------

/**
 * The internal index slots the store's scalar paths read. They are derived from
 * the persisted Job only, so a client can never supply them; `decode` strips
 * them so the frozen `QueryJobSnapshot` type keeps its shape.
 */
export function queryJobIndexSlots(job: QueryJobV1): {
  rootKey: string;
  requestMark: 'request' | 'none';
  rootMark: 'root' | 'none';
  goalSlot: string;
  enteredSlot: string;
} {
  const request = job.requestRoot !== null;
  return {
    rootKey: job.requestRoot === null ? 'none' : canonicalJson(job.requestRoot as unknown as JsonValue),
    requestMark: request ? 'request' : 'none',
    rootMark: request && job.roundKind === 'request' ? REQUEST_ROOT_MARK : 'none',
    goalSlot: !request ? 'none' : requestGoalSlot(job.requestGoalId),
    enteredSlot: job.enteredSession === null ? 'none'
      : `s:${canonicalJson(job.enteredSession as unknown as JsonValue)}`,
  };
}

// --------------------------------------------------------------------------
// Record validator / decoders
// --------------------------------------------------------------------------

function validateQueryJobSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== QUERY_JOB_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${QUERY_JOB_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseTaggedObject(record.json, 'QueryJob snapshot');
  if (typeof parsed === 'string') return invalid(parsed);
  const ref = queryJobRefFromValue(parsed['ref']);
  if (ref === null) return invalid('QueryJob snapshot has no complete QueryJobRef');
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) {
    return invalid('QueryJob snapshot ref is not the outer canonical ref_key');
  }
  if (!isPos(parsed['revision'])) {
    return invalid('QueryJob snapshot revision must be a safe integer >= 1');
  }
  if (parsed['revision'] !== record.revision) {
    return invalid('QueryJob snapshot outer revision disagrees with the JSON revision');
  }
  if (parsed['schemaVersion'] !== 1) return invalid('QueryJob snapshot schemaVersion must be 1');
  const since = parsed['since'];
  if (!isPlatformCursor(since)) {
    return invalid('QueryJob snapshot since must be the commit cursor the bound record carries');
  }
  const jobProblems = jobIssues(parsed['job'], ref);
  if (jobProblems.length > 0) return invalid(`QueryJob snapshot job is invalid: ${jobProblems.join('; ')}`);
  const submissionProblems = submissionIssues(parsed['submission']);
  if (submissionProblems.length > 0) return invalid(`QueryJob snapshot submission is invalid: ${submissionProblems.join('; ')}`);
  const slots = parsed['slots'];
  const expectedSlots = queryJobIndexSlots(parsed['job'] as unknown as QueryJobV1);
  if (!isRecord(slots) || canonicalJson(slots as unknown as JsonValue) !== canonicalJson(expectedSlots as unknown as JsonValue)) {
    return invalid('QueryJob snapshot slots do not match the derived index slots');
  }
  return { status: 'decoded', value: copyRecord(record) };
}

/** Pure QueryJob record encoding; derives the internal index slots and writes nothing. */
export function encodeQueryJobSnapshot(snapshot: PendingQueryJobSnapshot): EncodedRecord {
  return {
    refKey: canonicalJson(snapshot.ref as unknown as JsonValue),
    schemaId: QUERY_JOB_SNAPSHOT_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify({ ...snapshot, slots: queryJobIndexSlots(snapshot.job) }),
  };
}

/** Pure QueryJob record decoding; the internal slots are validated then stripped and the command normalized. */
export function decodeQueryJobSnapshot(record: EncodedRecord): DecodeResult<QueryJobSnapshot> {
  const checked = validateQueryJobSnapshot(record);
  if (checked.status !== 'decoded') return checked;
  try {
    const parsed = JSON.parse(record.json) as QueryJobSnapshot & { slots?: unknown };
    delete parsed.slots;
    const job = parsed.job as unknown as Record<string, unknown>;
    const understanding = normalizeUnderstandingCommand(job['understanding']);
    if (understanding.kind === 'damaged') {
      return invalid(`QueryJob snapshot job.understanding is invalid: ${understanding.reason}`);
    }
    job['understanding'] = understanding.kind === 'ready' ? understanding.command : null;
    return { status: 'decoded', value: parsed };
  } catch {
    return invalid('QueryJob snapshot JSON is not parseable');
  }
}

// --------------------------------------------------------------------------
// Event validator / decoders
// --------------------------------------------------------------------------

function validateQueryJobSubmittedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== QUERY_JOB_SUBMITTED_EVENT) {
    return invalid(`expected eventType ${QUERY_JOB_SUBMITTED_EVENT}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== QUERY_JOB_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${QUERY_JOB_EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!nonEmpty(event.eventId)) return invalid('eventId must be a non-empty string');
  if (!nonEmpty(event.occurredAt)) return invalid('occurredAt must be a non-empty string');
  const parsed = parseTaggedObject(event.json, 'QueryJobSubmitted event');
  if (typeof parsed === 'string') return invalid(parsed);
  if (parsed['eventId'] !== event.eventId) return invalid('outer eventId disagrees with the event JSON');
  if (parsed['eventType'] !== event.eventType) return invalid('outer eventType disagrees with the event JSON');
  if (parsed['schemaVersion'] !== event.schemaVersion) return invalid('outer schemaVersion disagrees with the event JSON');
  if (parsed['occurredAt'] !== event.occurredAt) return invalid('outer occurredAt disagrees with the event JSON');
  if (!nonEmpty(parsed['projectId'])) return invalid('QueryJobSubmitted projectId must be a non-empty string');
  if (!nonEmpty(parsed['workspaceId'])) return invalid('QueryJobSubmitted workspaceId must be a non-empty string');
  if (parsed['aggregateType'] !== 'QueryJob') return invalid('QueryJobSubmitted aggregateType must be "QueryJob"');
  if (!nonEmpty(parsed['aggregateId'])) return invalid('QueryJobSubmitted aggregateId must be a non-empty string');
  if (parsed['aggregateRevision'] !== 1) return invalid('QueryJobSubmitted aggregateRevision must be 1');
  if (!nonEmpty(parsed['causationId'])) return invalid('QueryJobSubmitted causationId must be a non-empty string');
  if (!nonEmpty(parsed['correlationId'])) return invalid('QueryJobSubmitted correlationId must be a non-empty string');
  if (!nonEmpty(parsed['idempotencyKey'])) return invalid('QueryJobSubmitted idempotencyKey must be a non-empty string');
  if (!isActorRef(parsed['actor'])) return invalid('QueryJobSubmitted actor is not a valid ActorRef');
  if (!nonEmpty(parsed['identityKey'])) return invalid('QueryJobSubmitted identityKey must be a non-empty string');
  if (!isSha256Hex(parsed['fingerprint'])) return invalid('QueryJobSubmitted fingerprint must be a lowercase sha256 hex');
  const payload = parsed['payload'];
  if (!isRecord(payload)) return invalid('QueryJobSubmitted payload must be an object');
  const ref = nonEmpty(parsed['projectId']) && nonEmpty(parsed['workspaceId']) &&
    nonEmpty(parsed['aggregateId'])
    ? { aggregateType: 'QueryJob' as const, projectId: parsed['projectId'], workspaceId: parsed['workspaceId'],
        queryJobId: parsed['aggregateId'] }
    : null;
  const jobProblems = jobIssues(payload['job'], ref);
  if (jobProblems.length > 0) return invalid(`QueryJobSubmitted payload.job is invalid: ${jobProblems.join('; ')}`);
  return { status: 'decoded', value: copyEvent(event) };
}

/** Encodes the submitted event with its writer-generated locator mirror. */
export function encodeQueryJobSubmittedEvent(event: QueryJobSubmittedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

/** Decodes a stored submitted event; its locator mirror names the same submission. */
export function decodeQueryJobSubmittedEvent(event: EncodedDomainEvent): DecodeResult<QueryJobSubmittedEventV1> {
  const checked = validateQueryJobSubmittedEvent(event);
  if (checked.status !== 'decoded') return checked;
  try {
    return { status: 'decoded', value: JSON.parse(event.json) as QueryJobSubmittedEventV1 };
  } catch {
    return invalid('QueryJobSubmitted event JSON is not parseable');
  }
}

// --------------------------------------------------------------------------
// QueryJobAnswer record + Query execution/answered operation events
// --------------------------------------------------------------------------

/** Pure QueryJobAnswer record encoding; writes nothing and registers nothing. */
export function encodeQueryJobAnswerSnapshot(snapshot: QueryJobAnswerSnapshot): EncodedRecord {
  return {
    refKey: canonicalJson(snapshot.ref as unknown as JsonValue),
    schemaId: QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

function validateQueryJobAnswerSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseTaggedObject(record.json, 'QueryJobAnswer snapshot');
  if (typeof parsed === 'string') return invalid(parsed);
  const ref = queryJobAnswerRefFromValue(parsed['ref']);
  if (ref === null) return invalid('QueryJobAnswer snapshot has no complete QueryJobAnswerRef');
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) {
    return invalid('QueryJobAnswer snapshot ref is not the outer canonical ref_key');
  }
  if (record.revision !== 1 || parsed['revision'] !== 1) {
    return invalid('QueryJobAnswer snapshot revision must be 1');
  }
  if (parsed['schemaVersion'] !== 1) return invalid('QueryJobAnswer snapshot schemaVersion must be 1');
  const problems = answerIssues(parsed['answer'], ref);
  if (problems.length > 0) return invalid(`QueryJobAnswer snapshot answer is invalid: ${problems.join('; ')}`);
  return { status: 'decoded', value: copyRecord(record) };
}

/** Pure QueryJobAnswer record decoding. */
export function decodeQueryJobAnswerSnapshot(record: EncodedRecord): DecodeResult<QueryJobAnswerSnapshot> {
  const checked = validateQueryJobAnswerSnapshot(record);
  if (checked.status !== 'decoded') return checked;
  try {
    return { status: 'decoded', value: JSON.parse(record.json) as QueryJobAnswerSnapshot };
  } catch {
    return invalid('QueryJobAnswer snapshot JSON is not parseable');
  }
}

/** Encodes one operation event whose local discriminant is an approved operation
 * and whose payload carries the same QueryRun's persisted execution state. */
export function encodeQueryExecutionRecordedEvent(event: QueryExecutionRecordedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

function validateQueryExecutionRecordedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== QUERY_EXECUTION_EVENT) {
    return invalid(`expected eventType ${QUERY_EXECUTION_EVENT}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== QUERY_EXECUTION_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${QUERY_EXECUTION_EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!nonEmpty(event.eventId)) return invalid('eventId must be a non-empty string');
  if (!nonEmpty(event.occurredAt)) return invalid('occurredAt must be a non-empty string');
  const parsed = parseTaggedObject(event.json, 'QueryExecutionRecorded event');
  if (typeof parsed === 'string') return invalid(parsed);
  const issues = envelopeIssues(parsed, event, 'QueryExecutionRecorded');
  if (!nonEmpty(parsed['identityKey']) || !isSha256Hex(parsed['fingerprint'])) {
    issues.push('QueryExecutionRecorded must carry the exact operation identity and fingerprint');
  }
  if (parsed['aggregateType'] !== 'QueryRun') issues.push('QueryExecutionRecorded aggregateType must be "QueryRun"');
  const payload = parsed['payload'];
  if (!isRecord(payload)) issues.push('QueryExecutionRecorded payload must be an object');
  else {
    if (queryRunRefFromValue(payload['queryRunRef']) === null) {
      issues.push('QueryExecutionRecorded payload.queryRunRef is not a complete QueryRunRef');
    }
    if (!QUERY_EXECUTION_OPERATIONS.includes(payload['operation'] as QueryExecutionOperation)) {
      issues.push('QueryExecutionRecorded payload.operation is not a legal operation');
    }
    if (!isRecord(payload['result'])) issues.push('QueryExecutionRecorded payload.result must preserve the original receipt value');
    issues.push(...executionStateIssues(payload['executionState']));
  }
  if (issues.length > 0) return invalid(`QueryExecutionRecorded event is invalid: ${issues.join('; ')}`);
  return { status: 'decoded', value: copyEvent(event) };
}

/** Decodes one stored operation event; a historical row is never re-normalized. */
export function decodeQueryExecutionRecordedEvent(event: EncodedDomainEvent): DecodeResult<QueryExecutionRecordedEventV1> {
  const checked = validateQueryExecutionRecordedEvent(event);
  if (checked.status !== 'decoded') return checked;
  try {
    return { status: 'decoded', value: JSON.parse(event.json) as QueryExecutionRecordedEventV1 };
  } catch {
    return invalid('QueryExecutionRecorded event JSON is not parseable');
  }
}

/** Encodes the terminal answered event carrying the formal answer snapshot. */
export function encodeQueryJobAnsweredEvent(event: QueryJobAnsweredEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

function validateQueryJobAnsweredEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== QUERY_JOB_ANSWERED_EVENT) {
    return invalid(`expected eventType ${QUERY_JOB_ANSWERED_EVENT}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== QUERY_JOB_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${QUERY_JOB_EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!nonEmpty(event.eventId)) return invalid('eventId must be a non-empty string');
  if (!nonEmpty(event.occurredAt)) return invalid('occurredAt must be a non-empty string');
  const parsed = parseTaggedObject(event.json, 'QueryJobAnswered event');
  if (typeof parsed === 'string') return invalid(parsed);
  const issues = envelopeIssues(parsed, event, 'QueryJobAnswered');
  if (parsed['aggregateType'] !== 'QueryJobAnswer') issues.push('QueryJobAnswered aggregateType must be "QueryJobAnswer"');
  const payload = parsed['payload'];
  if (!isRecord(payload)) issues.push('QueryJobAnswered payload must be an object');
  else {
    const snapshot = payload['answer'];
    if (!isRecord(snapshot)) issues.push('QueryJobAnswered payload.answer must be an object');
    else {
      const answerRef = queryJobAnswerRefFromValue(snapshot['ref']);
      if (answerRef === null) issues.push('QueryJobAnswered payload.answer.ref is not a complete QueryJobAnswerRef');
      if (snapshot['revision'] !== 1 || snapshot['schemaVersion'] !== 1) {
        issues.push('QueryJobAnswered payload.answer revision/schemaVersion must be 1');
      }
      issues.push(...answerIssues(snapshot['answer'], answerRef));
    }
  }
  if (issues.length > 0) return invalid(`QueryJobAnswered event is invalid: ${issues.join('; ')}`);
  return { status: 'decoded', value: copyEvent(event) };
}

// --------------------------------------------------------------------------
// QueryRun: pure encode/decode reusing the ONE material owner's validator
// --------------------------------------------------------------------------

/** Pure QueryRun record encoding; writes nothing and registers nothing. */
export function encodeQueryRunSnapshotRecord(snapshot: QueryRunSnapshot): EncodedRecord {
  return {
    refKey: canonicalJson(snapshot.ref as unknown as JsonValue),
    schemaId: QUERY_RUN_RECORD_SCHEMA.schemaId,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

/** Pure QueryRun record decoding that reuses the material owner's validator. */
export function decodeQueryRunSnapshotRecord(record: EncodedRecord): DecodeResult<QueryRunSnapshot> {
  const validated = validateQueryRunSnapshot(record);
  if (validated.status !== 'decoded') return validated;
  try {
    return { status: 'decoded', value: JSON.parse(record.json) as QueryRunSnapshot };
  } catch {
    return invalid('QueryRun snapshot JSON is not parseable');
  }
}

/**
 * Only the NEW QueryJob record and its submitted event are registered here.
 * QueryRun stays registered by `materialRecordSchemas()` in the composition root.
 */
const QUERY_JOB_SNAPSHOT_SCHEMA: EncodedRecordSchema = {
  schemaId: QUERY_JOB_SNAPSHOT_SCHEMA_ID,
  aggregateType: 'QueryJob',
  validate: validateQueryJobSnapshot,
  commitCursorFields: ['since'],
};
const QUERY_JOB_SUBMITTED_SCHEMA: EncodedEventSchema = {
  eventType: QUERY_JOB_SUBMITTED_EVENT,
  schemaVersion: QUERY_JOB_EVENT_SCHEMA_VERSION,
  validate: validateQueryJobSubmittedEvent,
};
const QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA: EncodedRecordSchema = {
  schemaId: QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA_ID,
  aggregateType: 'QueryJobAnswer',
  validate: validateQueryJobAnswerSnapshot,
};
const QUERY_EXECUTION_RECORDED_SCHEMA: EncodedEventSchema = {
  eventType: QUERY_EXECUTION_EVENT,
  schemaVersion: QUERY_EXECUTION_EVENT_SCHEMA_VERSION,
  validate: validateQueryExecutionRecordedEvent,
};
const QUERY_JOB_ANSWERED_SCHEMA: EncodedEventSchema = {
  eventType: QUERY_JOB_ANSWERED_EVENT,
  schemaVersion: QUERY_JOB_EVENT_SCHEMA_VERSION,
  validate: validateQueryJobAnsweredEvent,
};

/**
 * Slice 5 §4.2: a QueryJob's formal workspace+Goal index. It is a candidate
 * lookup only; the question reader rechecks the decoded canonical Job/Run.
 */
const QUERY_JOB_BY_WORKSPACE_GOAL_LOOKUP: RecordLookupIndex = {
  name: S5_QUERY_JOB_BY_GOAL,
  aggregateType: 'QueryJob',
  paths: ['ref.projectId', 'ref.workspaceId', 'job.goalId'],
};

/**
 * The four index declarations on QueryJob snapshots. The equality
 * values are non-empty strings; a non-request Query writes `none`.
 * `s6-query-queued-by-session` is not built: nothing reads it.
 */
const QUERY_JOB_BY_REQUEST_LOOKUP: RecordLookupIndex = {
  name: QUERY_BY_REQUEST_INDEX,
  aggregateType: 'QueryJob',
  paths: ['ref.projectId', 'ref.workspaceId', 'slots.rootKey'],
  orderBy: { path: 'since' },
};
const QUERY_JOB_OPEN_BY_WORKSPACE_LOOKUP: RecordLookupIndex = {
  name: QUERY_OPEN_BY_WORKSPACE_INDEX,
  aggregateType: 'QueryJob',
  paths: ['ref.projectId', 'ref.workspaceId', 'slots.requestMark', 'job.status'],
  orderBy: { path: 'since' },
};
const REQUEST_ROOTS_BY_GOAL_LOOKUP: RecordLookupIndex = {
  name: REQUEST_ROOTS_BY_GOAL_INDEX,
  aggregateType: 'QueryJob',
  paths: ['ref.projectId', 'ref.workspaceId', 'slots.rootMark', 'slots.goalSlot'],
  orderBy: { path: 'since' },
};
const QUERY_JOB_RAN_BY_SESSION_GOAL_LOOKUP: RecordLookupIndex = {
  name: QUERY_RAN_BY_SESSION_GOAL_INDEX,
  aggregateType: 'QueryJob',
  paths: ['ref.projectId', 'ref.workspaceId', 'slots.enteredSlot', 'slots.goalSlot'],
  orderBy: { path: 'since' },
};

/**
 * Slice 2B L14: one Session's QueryRuns ordered by their end instant (track
 * bars). A `null` `executionState` row is not an ordered candidate (2A L1), so
 * a still-open query is read from the Session's current occupant instead.
 */
export const S2B_QUERY_RUN_BY_SESSION_ENDED_LOOKUP = 's2b-query-run-by-session-ended';
const QUERY_RUN_BY_SESSION_ENDED_LOOKUP: RecordLookupIndex = {
  name: S2B_QUERY_RUN_BY_SESSION_ENDED_LOOKUP,
  aggregateType: 'QueryRun',
  paths: ['ref.projectId', 'ref.workspaceId', 'run.executionState.sessionRef.sessionId'],
  orderBy: { path: 'run.endedAt' },
};

/**
 * L16 backfill: a workspace's ended QueryRuns by end instant. The merged
 * activity backfill reads Work and Query candidates from one ordered cursor.
 */
export const S6_QUERY_RUN_BY_WORKSPACE_ENDED_LOOKUP = 's6-query-run-by-workspace-ended';
const QUERY_RUN_BY_WORKSPACE_ENDED_LOOKUP: RecordLookupIndex = {
  name: S6_QUERY_RUN_BY_WORKSPACE_ENDED_LOOKUP,
  aggregateType: 'QueryRun',
  paths: ['ref.projectId', 'ref.workspaceId'],
  orderBy: { path: 'run.endedAt' },
};

export const QUERY_JOB_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [QUERY_JOB_SNAPSHOT_SCHEMA, QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA, ...QUERY_ACTIVITY_RECORD_SCHEMAS.records],
  events: [
    QUERY_JOB_SUBMITTED_SCHEMA, QUERY_EXECUTION_RECORDED_SCHEMA, QUERY_JOB_ANSWERED_SCHEMA,
    ...QUERY_ACTIVITY_RECORD_SCHEMAS.events,
  ],
  lookups: [
    { name: QUERY_RUN_BY_SESSION_LOOKUP, aggregateType: 'QueryRun',
      paths: ['ref.projectId', 'ref.workspaceId', 'run.executionState.sessionRef.sessionId'] },
    { name: S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP, aggregateType: 'QueryRun',
      paths: ['ref.projectId', 'ref.workspaceId', 'run.executionState.sessionRef.sessionId'],
      orderBy: { path: 'run.executionState.sessionGeneration', valueType: 'integer' } },
    QUERY_JOB_BY_WORKSPACE_GOAL_LOOKUP,
    QUERY_JOB_BY_REQUEST_LOOKUP,
    QUERY_JOB_OPEN_BY_WORKSPACE_LOOKUP,
    REQUEST_ROOTS_BY_GOAL_LOOKUP,
    QUERY_JOB_RAN_BY_SESSION_GOAL_LOOKUP,
    QUERY_RUN_BY_SESSION_ENDED_LOOKUP,
    QUERY_RUN_BY_WORKSPACE_ENDED_LOOKUP,
  ],
};
