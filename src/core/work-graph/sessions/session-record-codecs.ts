/**
 * R4b canonical Session-family schema registration and pure encode/decode.
 *
 * The WorkGraph owns this closed schemaId list; the RecordStore only selects a
 * codec from the aggregateType of the full ref and applies mechanical CAS,
 * claims, cursor binding and one transaction. This file performs no I/O, no
 * admission, no fold and no transaction.
 *
 * Frozen rules enforced here:
 *   - `plannedSessionRef` is an ordinary `SessionRef` (no `aggregateType`); the
 *     formal directory row uses `SessionAggregateRef` (`aggregateType: 'Session'`).
 *   - The `SessionCreationAdmitted` / `SessionCreated` event bodies retain the
 *     full stable result so an idempotent replay restores the ORIGINAL record
 *     instead of re-deriving it from current state.
 *   - `SessionWorkLink` declares `since`/`until` as commit-cursor fields. The
 *     prepared record carries `since: null`; the Store binds the real commit
 *     cursor in the same transaction. A typed read requires `since` to be bound.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  SessionAggregateRef, SessionRef, SessionWorkLinkRef, WorkLinkRelation,
} from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { SessionOperationRecord } from './contracts.js';

// --------------------------------------------------------------------------
// Fixed registration identifiers
// --------------------------------------------------------------------------

export const CORE_OPERATION_SCHEMA_ID = 'CoreOperation@1';
export const SESSION_RECORD_SCHEMA_ID = 'SessionRecord@1';
export const SESSION_WORK_LINK_SCHEMA_ID = 'SessionWorkLink@1';
export const SESSION_CREATION_ADMITTED_EVENT_TYPE = 'SessionCreationAdmitted';
export const SESSION_CREATED_EVENT_TYPE = 'SessionCreated';
export const SESSION_EVENT_SCHEMA_VERSION = 1;
export const SESSION_BY_WORKSPACE_LOOKUP = 'session-by-workspace';
export const SESSION_WORK_LINKS_LOOKUP = 'session-work-links';
export const SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP = 'session-by-workspace-lifecycle';
export const SESSION_BY_WORKSPACE_LEGACY_ROLE_LOOKUP = 'session-by-workspace-legacy-role';
export const SESSION_BY_WORKSPACE_SPEC_ROLE_LOOKUP = 'session-by-workspace-spec-role';
export const SESSION_LINKS_BY_MODULE_LOOKUP = 'session-links-by-module';
export const SESSION_LINKS_BY_TASK_LOOKUP = 'session-links-by-task';
export const SESSION_LINKS_BY_WORK_LOOKUP = 'session-links-by-work';

/** The only three accepted work-link relations, in the fixed order the target
 * discovery streams consume. The refKey orders relation before sessionId, so one
 * exact (target,relation) index per relation gives three ordered streams that
 * merge by sessionId without an unbounded seen set. */
export const SESSION_WORK_LINK_RELATIONS: readonly WorkLinkRelation[] = [
  'responsible', 'participates', 'investigated',
];

/**
 * One composite index per target kind carries the relation as its last path, so
 * a single physical index serves all three ordered streams: the caller varies
 * only the relation value. Registering three identical-path indexes per kind
 * would write every link three times for no extra information.
 */

// --------------------------------------------------------------------------
// Event bodies (stable replay carriers)
// --------------------------------------------------------------------------

export type SessionCreationAdmittedEvent = {
  eventId: string;
  eventType: 'SessionCreationAdmitted';
  schemaVersion: 1;
  occurredAt: string;
  projectId: string;
  workspaceId: string;
  operationRef: OperationRef;
  operation: SessionOperationRecord;
};

export type SessionCreatedEvent = {
  eventId: string;
  eventType: 'SessionCreated';
  schemaVersion: 1;
  occurredAt: string;
  projectId: string;
  workspaceId: string;
  operationRef: OperationRef;
  session: SessionRecord;
};

/** Pre-bind work-link body: the Store fills `since` from the commit cursor. */
export type PendingSessionWorkLink = {
  ref: SessionWorkLinkRef;
  revision: number;
  since: CommitCursor | null;
  until: CommitCursor | null;
};

// --------------------------------------------------------------------------
// Pure shape helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;
/** `null` = the check passed; a string is the precise rejection reason. */
export type Problem = string | null;

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isPositiveRevision(value: unknown): value is number {
  return isSafeRevision(value) && value >= 1;
}
/** Platform ledger cursor, opaque to the domain except for this shape rule. */
export function isPlatformCursor(value: unknown): value is string {
  return nonEmpty(value) && /^c\d{10}$/.test(value);
}
function isNullableCursor(value: unknown): boolean {
  return value === null || isPlatformCursor(value);
}
/** Kernel history cursor: an opaque non-empty string, never a platform cursor. */
function isNullableKernelCursor(value: unknown): boolean {
  return value === null || nonEmpty(value);
}
function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}
function parseObject(json: string): UnknownRecord | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
}

// --------------------------------------------------------------------------
// Primitive checks
// --------------------------------------------------------------------------

export function checkOperationRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'operationId'])) {
    return 'operation ref must be {aggregateType,projectId,operationId}';
  }
  if (value['aggregateType'] !== 'CoreOperation' || !nonEmpty(value['projectId']) || !nonEmpty(value['operationId'])) {
    return 'operation ref is not a valid CoreOperation ref';
  }
  return null;
}

export function checkPlainSessionRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['projectId', 'sessionId'])) {
    return 'plannedSessionRef must be a plain SessionRef without aggregateType';
  }
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return 'plannedSessionRef must name a projectId and a sessionId';
  }
  return null;
}

function checkSessionAggregateRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'sessionId'])) {
    return 'session ref must be a SessionAggregateRef';
  }
  if (value['aggregateType'] !== 'Session' || !nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return 'session ref is not a valid SessionAggregateRef';
  }
  return null;
}

function checkWorkspace(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['projectId', 'workspaceId'])) {
    return 'workspace must be {projectId,workspaceId}';
  }
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])) {
    return 'workspace requires projectId and workspaceId';
  }
  return null;
}

/** The trusted Host route pinned by the first durable admission. */
function checkKernelStore(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['adapterId', 'storeKey'])) {
    return 'kernelStore must be {adapterId,storeKey}';
  }
  if (!nonEmpty(value['adapterId']) || !nonEmpty(value['storeKey'])) {
    return 'kernelStore requires adapterId and storeKey';
  }
  return null;
}

export function checkRole(value: unknown): Problem {
  if (!isObject(value)) return 'role must be an object';
  if (value['kind'] === 'legacy_template') {
    if (!hasOnlyKeys(value, ['kind', 'templateId', 'templateRevision'])) return 'legacy_template role carries unknown fields';
    if (!nonEmpty(value['templateId']) || !nonEmpty(value['templateRevision'])) {
      return 'legacy_template role requires templateId and templateRevision';
    }
    return null;
  }
  if (value['kind'] === 'role_spec') {
    if (!hasOnlyKeys(value, ['kind', 'pin'])) return 'role_spec role carries unknown fields';
    const pin = value['pin'];
    if (!isObject(pin) || !hasOnlyKeys(pin, ['ref', 'digest'])) return 'role_spec pin must be {ref,digest}';
    if (!nonEmpty(pin['digest'])) return 'role_spec pin digest must be a non-empty string';
    const ref = pin['ref'];
    if (!isObject(ref) || !hasOnlyKeys(ref, ['aggregateType', 'projectId', 'roleId', 'revision'])) {
      return 'role_spec pin.ref must be a RoleSpecRevisionRef';
    }
    if (ref['aggregateType'] !== 'RoleSpecRevision' || !nonEmpty(ref['projectId']) ||
      !nonEmpty(ref['roleId']) || !isPositiveRevision(ref['revision'])) {
      return 'role_spec pin.ref is not a valid RoleSpecRevisionRef';
    }
    return null;
  }
  return 'role kind must be role_spec or legacy_template';
}

function relation(value: unknown): boolean {
  return value === 'responsible' || value === 'participates' || value === 'investigated';
}

export function checkTarget(value: unknown): Problem {
  if (!isObject(value)) return 'work link target must be an object';
  const ref = value['ref'];
  if (!isObject(ref)) return 'work link target.ref must be an object';
  if (value['kind'] === 'module') {
    if (!hasOnlyKeys(value, ['kind', 'ref']) || !hasOnlyKeys(ref, ['projectId', 'moduleId'])) return 'module target must be a ModuleRef';
    if (!nonEmpty(ref['projectId']) || !nonEmpty(ref['moduleId'])) return 'module target requires projectId and moduleId';
    return null;
  }
  if (value['kind'] === 'task') {
    if (!hasOnlyKeys(value, ['kind', 'ref']) || !hasOnlyKeys(ref, ['projectId', 'goalId', 'taskId'])) return 'task target must be a TaskTriple';
    if (!nonEmpty(ref['projectId']) || !nonEmpty(ref['goalId']) || !nonEmpty(ref['taskId'])) {
      return 'task target requires projectId, goalId and taskId';
    }
    return null;
  }
  if (value['kind'] === 'work') {
    if (!hasOnlyKeys(value, ['kind', 'ref']) ||
      !hasOnlyKeys(ref, ['aggregateType', 'projectId', 'workspaceId', 'workId'])) {
      return 'work target must be a WorkContextRef';
    }
    if (ref['aggregateType'] !== 'WorkContextBinding' || !nonEmpty(ref['projectId']) ||
      !nonEmpty(ref['workspaceId']) || !nonEmpty(ref['workId'])) {
      return 'work target is not a valid WorkContextRef';
    }
    return null;
  }
  return 'work link target kind must be module, task or work';
}

const SOURCE_KINDS: readonly string[] = ['plan-revision', 'workspace', 'governance', 'artifact', 'memory'];

function checkSourceRef(value: unknown): Problem {
  if (!isObject(value) || !Object.keys(value).every((key) => ['kind', 'refId', 'revision', 'digest'].includes(key))) {
    return 'artifact source carries unknown fields';
  }
  if (!SOURCE_KINDS.includes(String(value['kind']))) return 'artifact source kind is not recognized';
  if (!nonEmpty(value['refId']) || !nonEmpty(value['revision'])) return 'artifact source requires refId and revision';
  if (value['digest'] !== undefined && !nonEmpty(value['digest'])) {
    return 'artifact source digest must be a non-empty string when present';
  }
  return null;
}

export function checkArtifactRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['kind', 'contentType', 'digest', 'sizeBytes', 'source'])) {
    return 'ArtifactRef carries unknown fields';
  }
  if (value['kind'] !== 'artifact') return 'ArtifactRef.kind must be "artifact"';
  if (!nonEmpty(value['contentType']) || !nonEmpty(value['digest'])) return 'ArtifactRef requires contentType and digest';
  const size = value['sizeBytes'];
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    return 'ArtifactRef.sizeBytes must be a non-negative safe integer';
  }
  return checkSourceRef(value['source']);
}

function checkExecutionRef(value: unknown): Problem {
  if (!isObject(value)) return 'execution ref must be an object';
  if (value['aggregateType'] === 'Run') {
    if (!hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])) return 'RunRef carries unknown fields';
    if (!nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
      return 'RunRef requires projectId, goalId and runId';
    }
    return null;
  }
  if (value['aggregateType'] === 'QueryRun') {
    if (!hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'queryJobId', 'runId'])) {
      return 'QueryRunRef carries unknown fields';
    }
    if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) ||
      !nonEmpty(value['queryJobId']) || !nonEmpty(value['runId'])) {
      return 'QueryRunRef requires projectId, workspaceId, queryJobId and runId';
    }
    return null;
  }
  return 'execution ref must be a RunRef or a QueryRunRef';
}

function checkOccupancy(value: unknown): Problem {
  if (value === null) return null;
  if (!isObject(value)) return 'occupancy must be an object or null';
  if (!isPositiveRevision(value['generation'])) return 'occupancy.generation must be a positive integer';
  if (value['kind'] === 'execution') {
    if (!hasOnlyKeys(value, ['kind', 'executionRef', 'generation'])) return 'execution occupancy carries unknown fields';
    return checkExecutionRef(value['executionRef']);
  }
  if (value['kind'] === 'maintenance') {
    if (!hasOnlyKeys(value, ['kind', 'operationRef', 'generation'])) return 'maintenance occupancy carries unknown fields';
    return checkOperationRef(value['operationRef']);
  }
  return 'occupancy.kind must be execution or maintenance';
}

function checkObservation(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value,
    ['observedAt', 'adapterId', 'kernelSessionId', 'beforeCursor', 'afterCursor', 'resultRef'])) {
    return 'operation observation carries unknown fields';
  }
  if (!nonEmpty(value['observedAt']) || !nonEmpty(value['adapterId']) || !nonEmpty(value['kernelSessionId'])) {
    return 'operation observation requires observedAt, adapterId and kernelSessionId';
  }
  if (!isNullableKernelCursor(value['beforeCursor']) || !isNullableKernelCursor(value['afterCursor'])) {
    return 'operation observation cursors must be null or non-empty strings';
  }
  if (value['resultRef'] !== null) {
    const result = checkArtifactRef(value['resultRef']);
    if (result !== null) return `operation observation resultRef: ${result}`;
  }
  return null;
}

function checkFailure(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['code', 'reason'])) return 'operation failure must be {code,reason}';
  if (!nonEmpty(value['code']) || !nonEmpty(value['reason'])) return 'operation failure requires code and reason';
  return null;
}

export function checkWorkLinkRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'sessionId', 'target', 'relation'])) {
    return 'work link ref carries unknown fields';
  }
  if (value['aggregateType'] !== 'SessionWorkLink' || !nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return 'work link ref is not a valid SessionWorkLinkRef';
  }
  const targetValue = value['target'];
  const target = checkTarget(targetValue);
  if (target !== null) return target;
  if (isObject(targetValue) && isObject(targetValue['ref']) &&
    value['projectId'] !== targetValue['ref']['projectId']) {
    return 'work link target project disagrees with the link ref project';
  }
  if (!relation(value['relation'])) return 'work link relation is not recognized';
  return null;
}

// --------------------------------------------------------------------------
// Aggregate body checks
// --------------------------------------------------------------------------

const OPERATION_BODY_KEYS: readonly string[] = [
  'ref', 'revision', 'action', 'phase', 'requestedAt', 'updatedAt', 'observation', 'failure',
];
const ACTION_KEYS: readonly string[] = ['kind', 'plannedSessionRef', 'workspace', 'kernelStore', 'role', 'recommendedRefs', 'initialLinks'];
const OPERATION_PHASES: readonly string[] = ['accepted', 'running', 'completed', 'failed', 'unknown'];
const SESSION_BODY_KEYS: readonly string[] = [
  'ref', 'revision', 'kernel', 'lifecycle', 'health', 'role', 'workspaceId', 'lastExecutionRef',
  'occupancy', 'historyCursor', 'createdAt', 'archivedAt',
];
const WORK_LINK_BODY_KEYS: readonly string[] = ['ref', 'revision', 'since', 'until'];

function checkSessionOperationBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, OPERATION_BODY_KEYS)) return 'operation record carries unknown fields';
  const ref = checkOperationRef(body['ref']);
  if (ref !== null) return ref;
  if (!isPositiveRevision(body['revision'])) return 'operation record revision must be a positive integer';
  const action = body['action'];
  if (!isObject(action) || !hasOnlyKeys(action, ACTION_KEYS) || action['kind'] !== 'create') {
    return 'operation action must be a create action';
  }
  const plannedValue = action['plannedSessionRef'];
  const planned = checkPlainSessionRef(plannedValue);
  if (planned !== null) return planned;
  const workspaceValue = action['workspace'];
  const workspace = checkWorkspace(workspaceValue);
  if (workspace !== null) return workspace;
  const role = checkRole(action['role']);
  if (role !== null) return role;
  const kernelStore = checkKernelStore(action['kernelStore']);
  if (kernelStore !== null) return kernelStore;
  // The frozen scope equality is re-checked from the formal record (and from an
  // embedded event payload) rather than assumed from one write path.
  if (isObject(body['ref']) && isObject(plannedValue) && isObject(workspaceValue)) {
    const refProject = body['ref']['projectId'];
    if (refProject !== workspaceValue['projectId']) {
      return 'operation ref project disagrees with the action workspace project';
    }
    if (refProject !== plannedValue['projectId']) {
      return 'operation ref project disagrees with the planned Session project';
    }
  }
  const refs = action['recommendedRefs'];
  if (!Array.isArray(refs)) return 'operation recommendedRefs must be an array';
  for (const entry of refs) {
    const problem = checkArtifactRef(entry);
    if (problem !== null) return `operation recommendedRefs: ${problem}`;
  }
  const links = action['initialLinks'];
  if (!Array.isArray(links)) return 'operation initialLinks must be an array';
  for (const entry of links) {
    if (!isObject(entry) || !hasOnlyKeys(entry, ['target', 'relation'])) return 'initialLink must be {target,relation}';
    const target = checkTarget(entry['target']);
    if (target !== null) return `initialLink target: ${target}`;
    if (!relation(entry['relation'])) return 'initialLink relation is not recognized';
  }
  if (!OPERATION_PHASES.includes(String(body['phase']))) return 'operation phase is not recognized';
  if (!nonEmpty(body['requestedAt']) || !nonEmpty(body['updatedAt'])) return 'operation requires requestedAt and updatedAt';
  if (body['observation'] !== null) {
    const observation = checkObservation(body['observation']);
    if (observation !== null) return observation;
  }
  if (body['failure'] !== null) {
    const failure = checkFailure(body['failure']);
    if (failure !== null) return failure;
  }
  return null;
}

export function checkSessionBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, SESSION_BODY_KEYS)) return 'session record carries unknown fields';
  const ref = checkSessionAggregateRef(body['ref']);
  if (ref !== null) return ref;
  if (!isPositiveRevision(body['revision'])) return 'session record revision must be a positive integer';
  const kernel = body['kernel'];
  if (!isObject(kernel) || !hasOnlyKeys(kernel, ['adapterId', 'kernelSessionId'])) {
    return 'session kernel must be {adapterId,kernelSessionId}';
  }
  if (!nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId'])) {
    return 'session kernel requires adapterId and kernelSessionId';
  }
  if (!nonEmpty(body['workspaceId'])) return 'session workspaceId must be a non-empty string';
  const role = checkRole(body['role']);
  if (role !== null) return role;
  if (body['lifecycle'] !== 'active' && body['lifecycle'] !== 'archived') {
    return 'session lifecycle must be active or archived';
  }
  if (!['available', 'recoverable', 'unavailable'].includes(String(body['health']))) {
    return 'session health is not recognized';
  }
  const occupancy = checkOccupancy(body['occupancy']);
  if (occupancy !== null) return occupancy;
  if (!isNullableKernelCursor(body['historyCursor'])) {
    return 'session historyCursor must be null or a non-empty string';
  }
  if (!nonEmpty(body['createdAt'])) return 'session createdAt must be a non-empty string';
  if (!isNullableKernelCursor(body['archivedAt'])) {
    return 'session archivedAt must be null or a non-empty string';
  }
  if (!('lastExecutionRef' in body)) return 'session record requires lastExecutionRef';
  if (body['lastExecutionRef'] !== null) {
    const execution = checkExecutionRef(body['lastExecutionRef']);
    if (execution !== null) return execution;
  }
  return null;
}

export function checkWorkLinkBody(body: UnknownRecord, requireBoundSince: boolean): Problem {
  if (!hasOnlyKeys(body, WORK_LINK_BODY_KEYS)) return 'work link record carries unknown fields';
  const ref = checkWorkLinkRef(body['ref']);
  if (ref !== null) return ref;
  if (!isPositiveRevision(body['revision'])) return 'work link revision must be a positive integer';
  const since = body['since'];
  if (since === null) {
    if (requireBoundSince) return 'work link since must be bound to a real commit cursor';
  } else if (!isPlatformCursor(since)) {
    return 'work link since must be a ledger commit cursor';
  }
  if (!isNullableCursor(body['until'])) return 'work link until must be null or a ledger commit cursor';
  return null;
}

// --------------------------------------------------------------------------
// Registered validators
// --------------------------------------------------------------------------

function validateRecord(
  record: EncodedRecord,
  aggregateType: string,
  schemaId: string,
  checkBody: (body: UnknownRecord) => Problem,
): DecodeResult<EncodedRecord> {
  if (record.schemaId !== schemaId) return invalid(`expected schemaId ${schemaId}, got ${record.schemaId}`);
  const body = parseObject(record.json);
  if (body === null) return invalid(`${aggregateType} record json is not an object`);
  if (!isObject(body['ref']) || !isSafeRevision(body['revision']) || body['revision'] !== record.revision) {
    return invalid(`${aggregateType} record envelope is invalid`);
  }
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) {
    return invalid(`${aggregateType} refKey disagrees with the record body`);
  }
  const problem = checkBody(body);
  if (problem !== null) return invalid(`${aggregateType} record payload is invalid: ${problem}`);
  return { status: 'decoded', value: record };
}

function validateEvent(
  event: EncodedDomainEvent,
  eventType: string,
  checkBody: (body: UnknownRecord) => Problem,
): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== eventType) return invalid(`expected eventType ${eventType}, got ${event.eventType}`);
  if (event.schemaVersion !== SESSION_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${SESSION_EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return invalid(`${eventType} event envelope is incomplete`);
  const body = parseObject(event.json);
  if (body === null) return invalid(`${eventType} event json is not an object`);
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType ||
    body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return invalid(`${eventType} event envelope disagrees with the event json`);
  }
  const problem = checkBody(body);
  if (problem !== null) return invalid(`${eventType} event payload is invalid: ${problem}`);
  return { status: 'decoded', value: event };
}

const ADMITTED_EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'operationRef', 'operation',
];
const CREATED_EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'operationRef', 'session',
];

function checkAdmittedEventBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, ADMITTED_EVENT_KEYS)) return 'SessionCreationAdmitted carries unknown fields';
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId'])) {
    return 'admitted event requires projectId and workspaceId';
  }
  const operationRef = checkOperationRef(body['operationRef']);
  if (operationRef !== null) return operationRef;
  const operation = body['operation'];
  if (!isObject(operation)) return 'admitted event requires the full operation record';
  const operationProblem = checkSessionOperationBody(operation);
  if (operationProblem !== null) return operationProblem;
  if (operation['revision'] !== 1) return 'admitted operation must be revision 1';
  if (operation['phase'] !== 'accepted') return 'admitted operation phase must be accepted';
  const eventOperationRefKey = canonicalOf(body['operationRef']);
  const embeddedRefKey = canonicalOf(operation['ref']);
  if (eventOperationRefKey === null || embeddedRefKey === null || eventOperationRefKey !== embeddedRefKey) {
    return 'admitted event operationRef disagrees with the embedded operation';
  }
  const action = operation['action'];
  if (!isObject(action) || !isObject(action['workspace'])) return 'admitted operation action is invalid';
  if (action['workspace']['projectId'] !== body['projectId'] ||
    action['workspace']['workspaceId'] !== body['workspaceId']) {
    return 'admitted event scope disagrees with the admitted operation workspace';
  }
  return null;
}

function checkCreatedEventBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, CREATED_EVENT_KEYS)) return 'SessionCreated carries unknown fields';
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId'])) {
    return 'created event requires projectId and workspaceId';
  }
  const operationRef = checkOperationRef(body['operationRef']);
  if (operationRef !== null) return operationRef;
  const session = body['session'];
  if (!isObject(session)) return 'created event requires the created SessionRecord';
  const sessionProblem = checkSessionBody(session);
  if (sessionProblem !== null) return sessionProblem;
  if (session['revision'] !== 1) return 'created SessionRecord must be revision 1';
  if (session['lifecycle'] !== 'active') return 'created SessionRecord must be active';
  const ref = session['ref'];
  if (!isObject(ref) || ref['projectId'] !== body['projectId'] || !nonEmpty(ref['sessionId'])) {
    return 'created SessionRecord ref disagrees with the event project';
  }
  if (session['workspaceId'] !== body['workspaceId']) {
    return 'created SessionRecord workspace disagrees with the event workspace';
  }
  return null;
}

// --------------------------------------------------------------------------
// The single registration
// --------------------------------------------------------------------------

export const SESSION_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    {
      aggregateType: 'CoreOperation',
      schemaId: CORE_OPERATION_SCHEMA_ID,
      validate: (record) => validateRecord(record, 'CoreOperation', CORE_OPERATION_SCHEMA_ID, checkSessionOperationBody),
    },
    {
      aggregateType: 'Session',
      schemaId: SESSION_RECORD_SCHEMA_ID,
      validate: (record) => validateRecord(record, 'Session', SESSION_RECORD_SCHEMA_ID, checkSessionBody),
    },
    {
      aggregateType: 'SessionWorkLink',
      schemaId: SESSION_WORK_LINK_SCHEMA_ID,
      commitCursorFields: ['since', 'until'],
      // Strict: a final stored/linked record must carry a real bound cursor. The
      // nullable placeholder is accepted only because `planPreparedCommit` skips
      // the registered validator for records named by `commitCursorBindings` and
      // `bindPreparedRecords` re-validates them after binding.
      validate: (record) => validateRecord(record, 'SessionWorkLink', SESSION_WORK_LINK_SCHEMA_ID,
        (body) => checkWorkLinkBody(body, true)),
    },
  ],
  events: [
    {
      eventType: SESSION_CREATION_ADMITTED_EVENT_TYPE,
      schemaVersion: SESSION_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_CREATION_ADMITTED_EVENT_TYPE, checkAdmittedEventBody),
    },
    {
      eventType: SESSION_CREATED_EVENT_TYPE,
      schemaVersion: SESSION_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_CREATED_EVENT_TYPE, checkCreatedEventBody),
    },
  ],
  lookups: [
    { name: SESSION_BY_WORKSPACE_LOOKUP, aggregateType: 'Session', paths: ['ref.projectId', 'workspaceId'] },
    { name: SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP, aggregateType: 'Session',
      paths: ['ref.projectId', 'workspaceId', 'lifecycle'] },
    { name: SESSION_BY_WORKSPACE_LEGACY_ROLE_LOOKUP, aggregateType: 'Session',
      paths: ['ref.projectId', 'workspaceId', 'role.kind', 'role.templateId', 'role.templateRevision'] },
    { name: SESSION_BY_WORKSPACE_SPEC_ROLE_LOOKUP, aggregateType: 'Session',
      paths: ['ref.projectId', 'workspaceId', 'role.kind', 'role.pin.ref.roleId', 'role.pin.ref.revision', 'role.pin.digest'] },
    { name: SESSION_WORK_LINKS_LOOKUP, aggregateType: 'SessionWorkLink', paths: ['ref.projectId', 'ref.sessionId'] },
    { name: SESSION_LINKS_BY_MODULE_LOOKUP, aggregateType: 'SessionWorkLink',
      paths: ['ref.projectId', 'ref.target.kind', 'ref.target.ref.moduleId', 'ref.relation'] },
    { name: SESSION_LINKS_BY_TASK_LOOKUP, aggregateType: 'SessionWorkLink',
      paths: ['ref.projectId', 'ref.target.kind', 'ref.target.ref.goalId', 'ref.target.ref.taskId', 'ref.relation'] },
    { name: SESSION_LINKS_BY_WORK_LOOKUP, aggregateType: 'SessionWorkLink',
      paths: ['ref.projectId', 'ref.target.ref.workspaceId', 'ref.target.kind', 'ref.target.ref.workId', 'ref.relation'] },
  ],
};

// --------------------------------------------------------------------------
// Canonical keys and encode helpers
// --------------------------------------------------------------------------

export function operationRefKey(ref: OperationRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}
export function sessionAggregateRefKey(ref: SessionAggregateRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}
export function sessionWorkLinkRefKey(ref: SessionWorkLinkRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}
export function plainSessionRefToAggregate(ref: SessionRef): SessionAggregateRef {
  return { aggregateType: 'Session', projectId: ref.projectId, sessionId: ref.sessionId };
}

export function encodeSessionOperationRecord(record: SessionOperationRecord): EncodedRecord {
  return {
    refKey: operationRefKey(record.ref),
    schemaId: CORE_OPERATION_SCHEMA_ID,
    revision: record.revision,
    json: JSON.stringify(record),
  };
}

export function encodeSessionRecord(record: SessionRecord): EncodedRecord {
  return {
    refKey: sessionAggregateRefKey(record.ref),
    schemaId: SESSION_RECORD_SCHEMA_ID,
    revision: record.revision,
    json: JSON.stringify(record),
  };
}

export function encodePendingSessionWorkLink(link: PendingSessionWorkLink): EncodedRecord {
  return {
    refKey: sessionWorkLinkRefKey(link.ref),
    schemaId: SESSION_WORK_LINK_SCHEMA_ID,
    revision: link.revision,
    json: JSON.stringify(link),
  };
}

export function encodeSessionCreationAdmittedEvent(event: SessionCreationAdmittedEvent): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

export function encodeSessionCreatedEvent(event: SessionCreatedEvent): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

// --------------------------------------------------------------------------
// Typed decoders (read path; stricter than the pre-bind registration)
// --------------------------------------------------------------------------

export function decodeSessionOperationRecord(record: EncodedRecord): DecodeResult<SessionOperationRecord> {
  const checked = validateRecord(record, 'CoreOperation', CORE_OPERATION_SCHEMA_ID, checkSessionOperationBody);
  if (checked.status !== 'decoded') return checked;
  const body = parseObject(record.json);
  if (body === null) return invalid('CoreOperation record json is not an object');
  return { status: 'decoded', value: body as unknown as SessionOperationRecord };
}

export function decodeSessionRecord(record: EncodedRecord): DecodeResult<SessionRecord> {
  const checked = validateRecord(record, 'Session', SESSION_RECORD_SCHEMA_ID, checkSessionBody);
  if (checked.status !== 'decoded') return checked;
  const body = parseObject(record.json);
  if (body === null) return invalid('Session record json is not an object');
  return { status: 'decoded', value: body as unknown as SessionRecord };
}

export function decodeSessionWorkLink(record: EncodedRecord): DecodeResult<SessionWorkLink> {
  const checked = validateRecord(record, 'SessionWorkLink', SESSION_WORK_LINK_SCHEMA_ID,
    (body) => checkWorkLinkBody(body, true));
  if (checked.status !== 'decoded') return checked;
  const body = parseObject(record.json);
  if (body === null) return invalid('SessionWorkLink record json is not an object');
  return { status: 'decoded', value: body as unknown as SessionWorkLink };
}

/**
 * Restores the ORIGINAL admission record from the recorded event. This is the
 * only source a replay may use; it never re-derives identity or timestamps.
 */
export function sessionOperationFromAdmittedEvent(event: EncodedDomainEvent): DecodeResult<SessionOperationRecord> {
  const checked = validateEvent(event, SESSION_CREATION_ADMITTED_EVENT_TYPE, checkAdmittedEventBody);
  if (checked.status !== 'decoded') return checked;
  const body = parseObject(event.json);
  if (body === null) return invalid('SessionCreationAdmitted event json is not an object');
  return { status: 'decoded', value: body['operation'] as unknown as SessionOperationRecord };
}

/** Stable replay payload of one `SessionCreated` event. */
export type SessionCreatedPayload = {
  operationRef: OperationRef;
  session: SessionRecord;
};

/**
 * Restores the ORIGINAL created directory row AND its frozen operation ref from
 * the recorded event. This is the only source a replay may use.
 */
export function sessionCreatedPayloadFromEvent(event: EncodedDomainEvent): DecodeResult<SessionCreatedPayload> {
  const checked = validateEvent(event, SESSION_CREATED_EVENT_TYPE, checkCreatedEventBody);
  if (checked.status !== 'decoded') return checked;
  const body = parseObject(event.json);
  if (body === null) return invalid('SessionCreated event json is not an object');
  return {
    status: 'decoded',
    value: {
      operationRef: body['operationRef'] as unknown as OperationRef,
      session: body['session'] as unknown as SessionRecord,
    },
  };
}
