/**
 * Canonical Session-family schema registration and pure encode/decode.
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
import { canonicalJson, canonicalOf, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  hasOnlyKeys, invalid, isNonNeg, isPos, isRecord, nonEmpty, parseObject, type UnknownRecord,
} from '../../../contracts/validation/common.js';
import type {
  SessionAggregateRef, SessionRef, SessionWorkLinkRef, WorkLinkRelation,
} from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import { SESSION_HEALTH_CONCLUSIONS, type SessionRecord, type SessionWorkLink } from '../../../contracts/core/session.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { SessionOperationRecord } from '../model/session-contracts.js';
import { SESSION_BY_PROVENANCE_LOOKUP } from '../model/session-facts-contracts.js';
import { encodeEventEnvelope } from '../persistence/event-envelope.js';

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

// Slice 2C L4 indexes 1–5 (spec §2).
export const S2C_SESSION_BY_KIND_FROM_LOOKUP = 's2c-session-by-kind-from';
export const S2C_SESSION_BY_LIFECYCLE_KIND_LOOKUP = 's2c-session-by-lifecycle-kind';
export const S2C_SESSION_ARCHIVED_AT_LOOKUP = 's2c-session-archived-at';
export const S2C_OPEN_LINKS_BY_SESSION_LOOKUP = 's2c-open-links-by-session';
export const S2C_CLOSED_TASK_LINKS_LOOKUP = 's2c-closed-task-links';

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

/** `null` = the check passed; a string is the precise rejection reason. */
export type Problem = string | null;

/** Platform ledger cursor, opaque to the domain except for this shape rule. */
export function isPlatformCursor(value: unknown): value is string {
  return nonEmpty(value) && /^c\d{10}$/.test(value);
}
/** Spec §2.3: a stored notice position must be a NONZERO ledger commit cursor. */
export function isNonZeroPlatformCursor(value: unknown): value is string {
  return isPlatformCursor(value) && value !== 'c0000000000';
}
function isNullableCursor(value: unknown): boolean {
  return value === null || isPlatformCursor(value);
}
/** Kernel history cursor: an opaque non-empty string, never a platform cursor. */
function isNullableKernelCursor(value: unknown): boolean {
  return value === null || nonEmpty(value);
}

// --------------------------------------------------------------------------
// Primitive checks
// --------------------------------------------------------------------------

export function checkOperationRef(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'operationId'])) {
    return 'operation ref must be {aggregateType,projectId,operationId}';
  }
  if (value['aggregateType'] !== 'CoreOperation' || !nonEmpty(value['projectId']) || !nonEmpty(value['operationId'])) {
    return 'operation ref is not a valid CoreOperation ref';
  }
  return null;
}

export function checkPlainSessionRef(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['projectId', 'sessionId'])) {
    return 'plannedSessionRef must be a plain SessionRef without aggregateType';
  }
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return 'plannedSessionRef must name a projectId and a sessionId';
  }
  return null;
}

function checkSessionAggregateRef(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'sessionId'])) {
    return 'session ref must be a SessionAggregateRef';
  }
  if (value['aggregateType'] !== 'Session' || !nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return 'session ref is not a valid SessionAggregateRef';
  }
  return null;
}

function checkWorkspace(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['projectId', 'workspaceId'])) {
    return 'workspace must be {projectId,workspaceId}';
  }
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])) {
    return 'workspace requires projectId and workspaceId';
  }
  return null;
}

/** The trusted Host route pinned by the first durable admission. */
function checkKernelStore(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['adapterId', 'storeKey'])) {
    return 'kernelStore must be {adapterId,storeKey}';
  }
  if (!nonEmpty(value['adapterId']) || !nonEmpty(value['storeKey'])) {
    return 'kernelStore requires adapterId and storeKey';
  }
  return null;
}

export function checkRole(value: unknown): Problem {
  if (!isRecord(value)) return 'role must be an object';
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
    if (!isRecord(pin) || !hasOnlyKeys(pin, ['ref', 'digest'])) return 'role_spec pin must be {ref,digest}';
    if (!nonEmpty(pin['digest'])) return 'role_spec pin digest must be a non-empty string';
    const ref = pin['ref'];
    if (!isRecord(ref) || !hasOnlyKeys(ref, ['aggregateType', 'projectId', 'roleId', 'revision'])) {
      return 'role_spec pin.ref must be a RoleSpecRevisionRef';
    }
    if (ref['aggregateType'] !== 'RoleSpecRevision' || !nonEmpty(ref['projectId']) ||
      !nonEmpty(ref['roleId']) || !isPos(ref['revision'])) {
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
  if (!isRecord(value)) return 'work link target must be an object';
  const ref = value['ref'];
  if (!isRecord(ref)) return 'work link target.ref must be an object';
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
  if (!isRecord(value) || !Object.keys(value).every((key) => ['kind', 'refId', 'revision', 'digest'].includes(key))) {
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
  if (!isRecord(value) || !hasOnlyKeys(value, ['kind', 'contentType', 'digest', 'sizeBytes', 'source'])) {
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
  if (!isRecord(value)) return 'execution ref must be an object';
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
  if (!isRecord(value)) return 'occupancy must be an object or null';
  if (!isPos(value['generation'])) return 'occupancy.generation must be a positive integer';
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
  if (!isRecord(value) || !hasOnlyKeys(value,
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
  if (!isRecord(value) || !hasOnlyKeys(value, ['code', 'reason'])) return 'operation failure must be {code,reason}';
  if (!nonEmpty(value['code']) || !nonEmpty(value['reason'])) return 'operation failure requires code and reason';
  return null;
}

export function checkWorkLinkRef(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'sessionId', 'target', 'relation'])) {
    return 'work link ref carries unknown fields';
  }
  if (value['aggregateType'] !== 'SessionWorkLink' || !nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return 'work link ref is not a valid SessionWorkLinkRef';
  }
  const targetValue = value['target'];
  const target = checkTarget(targetValue);
  if (target !== null) return target;
  if (isRecord(targetValue) && isRecord(targetValue['ref']) &&
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
const ACTION_KEYS: readonly string[] = ['kind', 'plannedSessionRef', 'workspace', 'kernelStore', 'role', 'recommendedRefs', 'initialLinks', 'provenance'];
const OPERATION_PHASES: readonly string[] = ['accepted', 'running', 'completed', 'failed', 'unknown'];
const SESSION_BODY_KEYS: readonly string[] = [
  'ref', 'revision', 'kernel', 'lifecycle', 'health', 'healthConclusion', 'role', 'workspaceId', 'lastExecutionRef',
  'occupancy', 'historyCursor', 'createdAt', 'archivedAt', 'provenance', 'archiveRequest', 'unavailableSince',
];
const WORK_LINK_BODY_KEYS: readonly string[] = ['ref', 'revision', 'since', 'until'];

// --------------------------------------------------------------------------
// Slice 1 §2.2/§2.3: provenance and the immutable archive request
// --------------------------------------------------------------------------

/**
 * Strict shape of `SessionProvenanceV1` (K3: present but malformed is refused;
 * absent is the caller's default). `ownProjectId` is the project of the record
 * that carries the provenance; `ownSessionId` is its Session, which its own
 * predecessor may never be.
 */
export function checkSessionProvenance(value: unknown, ownProjectId: string, ownSessionId: string | null): Problem {
  if (!isRecord(value)) return 'provenance must be an object';
  if (value['schemaVersion'] !== 1) return 'provenance schemaVersion must be 1';
  const from = (): Problem => {
    const problem = checkPlainSessionRef(value['from']);
    if (problem !== null) return `provenance from: ${problem}`;
    const reference = value['from'] as UnknownRecord;
    if (reference['projectId'] !== ownProjectId) return 'provenance predecessor belongs to another project';
    if (ownSessionId !== null && reference['sessionId'] === ownSessionId) {
      return 'a Session cannot name itself as its predecessor';
    }
    return null;
  };
  switch (value['kind']) {
    case 'new':
      return hasOnlyKeys(value, ['schemaVersion', 'kind']) ? null : 'new provenance carries unknown fields';
    case 'continuation': {
      if (!hasOnlyKeys(value, ['schemaVersion', 'kind', 'from', 'reason', 'task'])) {
        return 'continuation provenance carries unknown fields';
      }
      const predecessor = from();
      if (predecessor !== null) return predecessor;
      if (!['interrupted', 'archived', 'damaged', 'role_mismatch'].includes(String(value['reason']))) {
        return 'continuation provenance reason is not recognized';
      }
      const task = value['task'];
      if (!isRecord(task) || !hasOnlyKeys(task, ['projectId', 'goalId', 'taskId'])
        || !nonEmpty(task['projectId']) || !nonEmpty(task['goalId']) || !nonEmpty(task['taskId'])) {
        return 'continuation provenance task must be a complete TaskTriple';
      }
      if (task['projectId'] !== ownProjectId) return 'continuation provenance task belongs to another project';
      return null;
    }
    case 'handoff': {
      if (!hasOnlyKeys(value, ['schemaVersion', 'kind', 'from'])) return 'handoff provenance carries unknown fields';
      return from();
    }
    case 'readonly_copy': {
      if (!hasOnlyKeys(value, ['schemaVersion', 'kind', 'from', 'messageRef'])) {
        return 'readonly_copy provenance carries unknown fields';
      }
      const predecessor = from();
      if (predecessor !== null) return predecessor;
      const message = value['messageRef'];
      if (!isRecord(message) || !hasOnlyKeys(message, ['aggregateType', 'projectId', 'workspaceId', 'messageId'])
        || message['aggregateType'] !== 'SessionMessage' || !nonEmpty(message['projectId'])
        || !nonEmpty(message['workspaceId']) || !nonEmpty(message['messageId'])) {
        return 'readonly_copy provenance messageRef must be a complete SessionMessageRef';
      }
      if (message['projectId'] !== ownProjectId) return 'readonly_copy provenance message belongs to another project';
      return null;
    }
    default:
      return 'provenance kind is not recognized';
  }
}

function checkArchiveTaskChoice(value: unknown, ownProjectId: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['target', 'disposition'])) return 'archive task choice carries unknown fields';
  const target = value['target'];
  if (!isRecord(target) || (target['kind'] !== 'task' && target['kind'] !== 'work')) {
    return 'archive task choice target must be a task or work target';
  }
  const targetRef = target['ref'];
  if (!isRecord(targetRef)) return 'archive task choice target ref must be an object';
  if (target['kind'] === 'task') {
    if (!hasOnlyKeys(targetRef, ['projectId', 'goalId', 'taskId'])
      || !nonEmpty(targetRef['projectId']) || !nonEmpty(targetRef['goalId']) || !nonEmpty(targetRef['taskId'])) {
      return 'archive task choice target must be a complete TaskTriple';
    }
  } else if (!hasOnlyKeys(targetRef, ['aggregateType', 'projectId', 'workspaceId', 'workId'])
    || targetRef['aggregateType'] !== 'WorkContextBinding' || !nonEmpty(targetRef['projectId'])
    || !nonEmpty(targetRef['workspaceId']) || !nonEmpty(targetRef['workId'])) {
    return 'archive task choice target must be a complete WorkContextRef';
  }
  if (targetRef['projectId'] !== ownProjectId) return 'archive task choice target belongs to another project';
  const disposition = value['disposition'];
  if (!isRecord(disposition)) return 'archive task choice disposition must be an object';
  if (disposition['kind'] === 'drop') {
    return hasOnlyKeys(disposition, ['kind']) ? null : 'drop disposition carries unknown fields';
  }
  if (disposition['kind'] === 'transfer') {
    if (!hasOnlyKeys(disposition, ['kind', 'to'])) return 'transfer disposition carries unknown fields';
    const to = checkPlainSessionRef(disposition['to']);
    if (to !== null) return `transfer disposition to: ${to}`;
    if ((disposition['to'] as UnknownRecord)['projectId'] !== ownProjectId) {
      return 'transfer disposition target belongs to another project';
    }
    return null;
  }
  return 'archive task choice disposition kind is not recognized';
}

function checkArchiveWaitChoice(value: unknown, ownProjectId: string): Problem {
  if (!isRecord(value)) return 'archive wait choice must be an object';
  const cancel = value['kind'] === 'cancel';
  const transfer = value['kind'] === 'transfer';
  if (!cancel && !transfer) return 'archive wait choice kind is not recognized';
  if (!hasOnlyKeys(value, cancel ? ['kind', 'runRef', 'messageRef'] : ['kind', 'runRef', 'messageRef', 'to'])) {
    return 'archive wait choice carries unknown fields';
  }
  const run = value['runRef'];
  if (!isRecord(run) || !hasOnlyKeys(run, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || run['aggregateType'] !== 'Run' || !nonEmpty(run['projectId']) || !nonEmpty(run['goalId']) || !nonEmpty(run['runId'])) {
    return 'archive wait choice runRef must be a complete RunRef';
  }
  if (run['projectId'] !== ownProjectId) return 'archive wait choice runRef belongs to another project';
  const message = value['messageRef'];
  if (!isRecord(message) || !hasOnlyKeys(message, ['aggregateType', 'projectId', 'workspaceId', 'messageId'])
    || message['aggregateType'] !== 'SessionMessage' || !nonEmpty(message['projectId'])
    || !nonEmpty(message['workspaceId']) || !nonEmpty(message['messageId'])) {
    return 'archive wait choice messageRef must be a complete SessionMessageRef';
  }
  if (message['projectId'] !== ownProjectId) return 'archive wait choice messageRef belongs to another project';
  if (transfer) {
    const to = checkPlainSessionRef(value['to']);
    if (to !== null) return `archive wait choice to: ${to}`;
    // §2.1/K3: the immutable wait target, like every Task choice, must belong to
    // the Session's own project; a stored cross-project target is refused.
    if ((value['to'] as UnknownRecord)['projectId'] !== ownProjectId) {
      return 'archive wait choice transfer target belongs to another project';
    }
  }
  return null;
}

function checkArchiveExecution(value: unknown): Problem {
  if (!isRecord(value)) return 'archive execution must be an object';
  switch (value['kind']) {
    case 'none':
      return hasOnlyKeys(value, ['kind']) ? null : 'none execution carries unknown fields';
    case 'work': {
      if (!hasOnlyKeys(value, ['kind', 'runRef', 'attemptRef'])) return 'work execution carries unknown fields';
      const run = value['runRef'];
      if (!isRecord(run) || !hasOnlyKeys(run, ['aggregateType', 'projectId', 'goalId', 'runId'])
        || run['aggregateType'] !== 'Run' || !nonEmpty(run['projectId']) || !nonEmpty(run['goalId']) || !nonEmpty(run['runId'])) {
        return 'work execution runRef must be a complete RunRef';
      }
      const attempt = value['attemptRef'];
      if (!isRecord(attempt)
        || !hasOnlyKeys(attempt, ['aggregateType', 'projectId', 'goalId', 'taskId', 'attemptId'])
        || attempt['aggregateType'] !== 'TaskAttempt' || !nonEmpty(attempt['projectId'])
        || !nonEmpty(attempt['goalId']) || !nonEmpty(attempt['taskId']) || !nonEmpty(attempt['attemptId'])) {
        return 'work execution attemptRef must be a complete TaskAttemptRef';
      }
      return null;
    }
    case 'query': {
      if (!hasOnlyKeys(value, ['kind', 'queryRunRef'])) return 'query execution carries unknown fields';
      const queryRun = value['queryRunRef'];
      if (!isRecord(queryRun)
        || !hasOnlyKeys(queryRun, ['aggregateType', 'projectId', 'workspaceId', 'queryJobId', 'runId'])
        || queryRun['aggregateType'] !== 'QueryRun' || !nonEmpty(queryRun['projectId'])
        || !nonEmpty(queryRun['workspaceId']) || !nonEmpty(queryRun['queryJobId']) || !nonEmpty(queryRun['runId'])) {
        return 'query execution queryRunRef must be a complete QueryRunRef';
      }
      return null;
    }
    default:
      return 'archive execution kind is not recognized';
  }
}

/**
 * Strict shape of `SessionArchiveRequestV1` (K3). The immutable choices, the
 * original actor and the receipt are all checked; the owner enforces the
 * business bounds (task count, reason length) before writing.
 */
export function checkSessionArchiveRequest(value: unknown, ownProjectId: string): Problem {
  if (!isRecord(value)) return 'archiveRequest must be an object';
  if (!hasOnlyKeys(value, ['schemaVersion', 'requestId', 'requestedBy', 'requestedAt', 'reason', 'mode',
    'tasks', 'wait', 'execution', 'executionPins', 'confirmUnknownStopped', 'receipt'])) {
    return 'archiveRequest carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'archiveRequest schemaVersion must be 1';
  if (!nonEmpty(value['requestId'])) return 'archiveRequest requestId is required';
  const requestedBy = value['requestedBy'];
  if (!isRecord(requestedBy) || !hasOnlyKeys(requestedBy, ['kind', 'id'])
    || (requestedBy['kind'] !== 'human' && requestedBy['kind'] !== 'system') || !nonEmpty(requestedBy['id'])) {
    return 'archiveRequest requestedBy must be a trusted human/system actor';
  }
  if (!nonEmpty(value['requestedAt'])) return 'archiveRequest requestedAt is required';
  if (!nonEmpty(value['reason'])) return 'archiveRequest reason is required';
  if (!['operator', 'executor_idle', 'retired', 'answered_copy', 'handoff_complete'].includes(String(value['mode']))) {
    return 'archiveRequest mode is not recognized';
  }
  if (!Array.isArray(value['tasks'])) return 'archiveRequest tasks must be an array';
  for (const choice of value['tasks']) {
    const problem = checkArchiveTaskChoice(choice, ownProjectId);
    if (problem !== null) return `archiveRequest task choice: ${problem}`;
  }
  if (value['wait'] !== null) {
    const wait = checkArchiveWaitChoice(value['wait'], ownProjectId);
    if (wait !== null) return `archiveRequest wait: ${wait}`;
  }
  const execution = checkArchiveExecution(value['execution']);
  if (execution !== null) return `archiveRequest execution: ${execution}`;
  if (!Array.isArray(value['executionPins'])) return 'archiveRequest executionPins must be an array';
  const pins = value['executionPins'] as readonly unknown[];
  if (pins.length > 2) return 'archiveRequest executionPins must carry at most two Run/QueryRun pins';
  const pinKeys: string[] = [];
  for (const pin of pins) {
    if (!isRecord(pin) || !hasOnlyKeys(pin, ['ref', 'revision']) || !isRecord(pin['ref'])
      || !Number.isSafeInteger(pin['revision']) || (pin['revision'] as number) < 0) {
      return 'archiveRequest executionPins entries must be complete VersionPins';
    }
    const refProblem = checkExecutionRef(pin['ref']);
    if (refProblem !== null) return `archiveRequest executionPins ref: ${refProblem}`;
    const pinKey = canonicalOf(pin['ref']);
    if (pinKey === null) return 'archiveRequest executionPins entries must carry a canonical ref';
    if (pinKeys.includes(pinKey)) return 'archiveRequest executionPins must not repeat a Run/QueryRun';
    pinKeys.push(pinKey);
  }
  // §2.3: the owner writes the pins in canonical ref order (sorted, deduped, at
  // most two); a stored list that is out of order or repeated is damaged.
  for (let index = 1; index < pinKeys.length; index += 1) {
    if (!(pinKeys[index - 1]! < pinKeys[index]!)) {
      return 'archiveRequest executionPins must be in canonical ref order';
    }
  }
  // §2.3: no execution and no wait means the request pins nothing; a stray pin
  // is never a legal no-execution request.
  const executionValue = value['execution'] as UnknownRecord;
  const executionRef = executionValue['kind'] === 'work' ? executionValue['runRef']
    : executionValue['kind'] === 'query' ? executionValue['queryRunRef'] : null;
  if (executionRef === null && value['wait'] === null && pinKeys.length !== 0) {
    return 'archiveRequest executionPins must be empty when there is no execution or wait';
  }
  // §2.3: a new request that names an execution or a wait must carry that exact
  // Run/QueryRun in its pins; a fake pin is never derived from the current Run.
  if (executionRef !== null) {
    const executionKey = canonicalOf(executionRef);
    if (executionKey === null || !pinKeys.includes(executionKey)) {
      return 'archiveRequest execution has no matching executionPin';
    }
  }
  if (value['wait'] !== null) {
    const waitRef = (value['wait'] as UnknownRecord)['runRef'];
    const waitKey = canonicalOf(waitRef);
    if (waitKey === null || !pinKeys.includes(waitKey)) return 'archiveRequest wait has no matching executionPin';
  }
  if (typeof value['confirmUnknownStopped'] !== 'boolean') return 'archiveRequest confirmUnknownStopped must be a boolean';
  const receipt = value['receipt'];
  if (!isRecord(receipt) || !hasOnlyKeys(receipt, ['identityKey', 'fingerprint'])
    || !nonEmpty(receipt['identityKey']) || !nonEmpty(receipt['fingerprint'])) {
    return 'archiveRequest receipt must be {identityKey,fingerprint}';
  }
  return null;
}

function checkSessionOperationBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, OPERATION_BODY_KEYS)) return 'operation record carries unknown fields';
  const ref = checkOperationRef(body['ref']);
  if (ref !== null) return ref;
  if (!isPos(body['revision'])) return 'operation record revision must be a positive integer';
  const action = body['action'];
  if (!isRecord(action) || !hasOnlyKeys(action, ACTION_KEYS) || action['kind'] !== 'create') {
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
  if (isRecord(body['ref']) && isRecord(plannedValue) && isRecord(workspaceValue)) {
    const refProject = body['ref']['projectId'];
    if (refProject !== workspaceValue['projectId']) {
      return 'operation ref project disagrees with the action workspace project';
    }
    if (refProject !== plannedValue['projectId']) {
      return 'operation ref project disagrees with the planned Session project';
    }
    if ('provenance' in action && action['provenance'] !== undefined && action['provenance'] !== null) {
      const provenance = checkSessionProvenance(action['provenance'], refProject as string,
        plannedValue['sessionId'] as string);
      if (provenance !== null) return `operation provenance: ${provenance}`;
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
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['target', 'relation'])) return 'initialLink must be {target,relation}';
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

export function checkSessionBody(body: UnknownRecord, requireBoundUnavailableSince = false): Problem {
  if (!hasOnlyKeys(body, SESSION_BODY_KEYS)) return 'session record carries unknown fields';
  const ref = checkSessionAggregateRef(body['ref']);
  if (ref !== null) return ref;
  if (!isPos(body['revision'])) return 'session record revision must be a positive integer';
  const kernel = body['kernel'];
  if (!isRecord(kernel) || !hasOnlyKeys(kernel, ['adapterId', 'kernelSessionId'])) {
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
  // SD-2: why `health` is unavailable. Absent before A.2 and read as null; only
  // the enumeration is checked here, cross-field rules belong to the writers.
  const conclusion = body['healthConclusion'];
  if (conclusion !== undefined && conclusion !== null
    && !(SESSION_HEALTH_CONCLUSIONS as readonly unknown[]).includes(conclusion)) {
    return 'session healthConclusion is not recognized';
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
  const refValue = body['ref'] as UnknownRecord;
  if (body['provenance'] !== undefined && body['provenance'] !== null) {
    const provenance = checkSessionProvenance(body['provenance'], refValue['projectId'] as string,
      refValue['sessionId'] as string);
    if (provenance !== null) return `session provenance: ${provenance}`;
  }
  if (body['archiveRequest'] !== undefined && body['archiveRequest'] !== null) {
    const archiveRequest = checkSessionArchiveRequest(body['archiveRequest'], refValue['projectId'] as string);
    if (archiveRequest !== null) return `session archiveRequest: ${archiveRequest}`;
  }
  // Wiring package 2 (spec §2.3 P01): the entry position is either absent
  // (legacy / available) or a real platform cursor; the explicit `null`
  // placeholder is legal only in an EVENT body (the record-store binds it in
  // the same commit and the persisted record is re-validated after binding).
  const unavailableSince = body['unavailableSince'];
  if (unavailableSince !== undefined) {
    if (unavailableSince === null) {
      if (requireBoundUnavailableSince) return 'session unavailableSince must be bound to a real commit cursor';
    } else if (!isNonZeroPlatformCursor(unavailableSince)) {
      return 'session unavailableSince must be a nonzero ledger commit cursor';
    }
    if (body['health'] !== 'unavailable') return 'session unavailableSince requires unavailable health';
  }
  return null;
}

export function checkWorkLinkBody(body: UnknownRecord, requireBoundSince: boolean): Problem {
  if (!hasOnlyKeys(body, WORK_LINK_BODY_KEYS)) return 'work link record carries unknown fields';
  const ref = checkWorkLinkRef(body['ref']);
  if (ref !== null) return ref;
  if (!isPos(body['revision'])) return 'work link revision must be a positive integer';
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
  if (!isRecord(body['ref']) || !isNonNeg(body['revision']) || body['revision'] !== record.revision) {
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
  if (!isRecord(operation)) return 'admitted event requires the full operation record';
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
  if (!isRecord(action) || !isRecord(action['workspace'])) return 'admitted operation action is invalid';
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
  if (!isRecord(session)) return 'created event requires the created SessionRecord';
  const sessionProblem = checkSessionBody(session);
  if (sessionProblem !== null) return sessionProblem;
  if (session['revision'] !== 1) return 'created SessionRecord must be revision 1';
  if (session['lifecycle'] !== 'active') return 'created SessionRecord must be active';
  const ref = session['ref'];
  if (!isRecord(ref) || ref['projectId'] !== body['projectId'] || !nonEmpty(ref['sessionId'])) {
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
      // Wiring package 2 (spec §2.3): the entry position is the only bindable
      // Session cursor field; the nullable event placeholder is bound by the
      // store and the persisted record is re-validated in record mode below.
      commitCursorFields: ['unavailableSince'],
      validate: (record) => validateRecord(record, 'Session', SESSION_RECORD_SCHEMA_ID,
        (body) => checkSessionBody(body, true)),
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
    { name: SESSION_BY_PROVENANCE_LOOKUP, aggregateType: 'Session',
      paths: ['ref.projectId', 'workspaceId', 'provenance.from.sessionId'] },
    // Slice 2C L4: line identification, count-by-kind, archived paging and links.
    { name: S2C_SESSION_BY_KIND_FROM_LOOKUP, aggregateType: 'Session',
      paths: ['ref.projectId', 'workspaceId', 'provenance.kind', 'provenance.from.sessionId'] },
    { name: S2C_SESSION_BY_LIFECYCLE_KIND_LOOKUP, aggregateType: 'Session',
      paths: ['ref.projectId', 'workspaceId', 'lifecycle', 'provenance.kind'] },
    { name: S2C_SESSION_ARCHIVED_AT_LOOKUP, aggregateType: 'Session',
      paths: ['ref.projectId', 'workspaceId', 'lifecycle'],
      orderBy: { path: 'archivedAt', valueType: 'text' } },
    { name: S2C_OPEN_LINKS_BY_SESSION_LOOKUP, aggregateType: 'SessionWorkLink',
      paths: ['ref.projectId', 'ref.sessionId', 'ref.relation', 'until'] },
    { name: S2C_CLOSED_TASK_LINKS_LOOKUP, aggregateType: 'SessionWorkLink',
      paths: ['ref.projectId', 'ref.sessionId', 'ref.relation', 'ref.target.kind'],
      orderBy: { path: 'until', valueType: 'text' } },
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
  return encodeEventEnvelope(event);
}

export function encodeSessionCreatedEvent(event: SessionCreatedEvent): EncodedDomainEvent {
  return encodeEventEnvelope(event);
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
  const checked = validateRecord(record, 'Session', SESSION_RECORD_SCHEMA_ID, (body) => checkSessionBody(body, true));
  if (checked.status !== 'decoded') return checked;
  const body = parseObject(record.json);
  if (body === null) return invalid('Session record json is not an object');
  // R2 exception: the frozen S1 test `S1-codecs-indexes` SV01 and
  // `S1-dispatch-guards` SV58 assert an explicit `null` on a decoded old record,
  // so this codec keeps the §2.9 null default instead of leaving the key absent.
  return { status: 'decoded', value: { ...(body as unknown as SessionRecord),
    provenance: (body['provenance'] as SessionRecord['provenance'] | undefined) ?? null,
    archiveRequest: (body['archiveRequest'] as SessionRecord['archiveRequest'] | undefined) ?? null } };
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
      // Rule 1: a replay returns the ORIGINAL event value, so
      // the payload keeps exactly the keys it was written with; only the record
      // decoder applies the §2.9 null default (SV01). Readers use `?? null`.
      session: body['session'] as unknown as SessionRecord,
    },
  };
}
