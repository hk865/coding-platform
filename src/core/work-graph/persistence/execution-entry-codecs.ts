/**
 * B2 nested execution-entry codecs (implementation).
 *
 * Responsibility of THIS file:
 *  - own the PURE strict validators for the versioned nested facts B2 adds to
 *    the existing @1 bodies: `ExecutionAuthorizationV2`, the retained
 *    `ExecutionAuthorizationV1` compatibility shape, `RuntimeInputBindingV1`,
 *    `TaskLeaseReleaseV1`, the @1 TaskLease snapshot including its optional
 *    release, and `TaskDispatchStateV1`;
 *  - own the four `ExecutionEntry*` replay event codecs plus their registration.
 *
 * It does NOT register a second Run/Attempt/outbox/Lease schema: those
 * aggregate types are owned elsewhere and a duplicate registration is a real
 * conflict. A legacy V1 authorization is readable for history, but it is never
 * upgraded into a fresh begin permission here.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { ExecutionAuthorizationV2, RunSnapshot, TaskLeaseReleaseV1, TaskLeaseSnapshot } from '../../../contracts/dispatch.js';
import type { RunExecutionHistoryV1 } from '../../../contracts/core/execution-history.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  RecordBackendSchemas,
} from '../../record-store/ports.js';
import { isArtifactRef } from '../../record-store/body-codec.js';
import type { TaskDispatchStateV1 } from '../tasks/claim-contracts.js';
import type { RuntimeEntryRecord, TaskEntryPermit } from '../tasks/execution-entry-contracts.js';

export type { ExecutionAuthorizationV2, TaskDispatchStateV1, TaskLeaseReleaseV1 };

export const EXECUTION_ENTRY_EVENT_SCHEMA_VERSION = 1 as const;
export const EXECUTION_ENTRY_AUTHORIZED_EVENT_TYPE = 'ExecutionEntryAuthorized' as const;
export const EXECUTION_ENTRY_BEGUN_EVENT_TYPE = 'ExecutionEntryBegun' as const;
export const EXECUTION_ENTRY_ENTERED_EVENT_TYPE = 'ExecutionEntryEntered' as const;
export const EXECUTION_RUN_RESULT_RECORDED_EVENT_TYPE = 'ExecutionRunResultRecorded' as const;

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
function invalid<T>(reason: string): DecodeResult<T> {
  return { status: 'invalid', reason };
}

function runRefProblem(value: unknown, label: string): string | null {
  if (!isJsonObject(value) || value['aggregateType'] !== 'Run'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return `${label} must be a complete RunRef`;
  }
  return null;
}
function attemptRefProblem(value: unknown): string | null {
  if (!isJsonObject(value) || value['aggregateType'] !== 'TaskAttempt'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])
    || !nonEmpty(value['attemptId'])) {
    return 'attemptRef must be a complete TaskAttemptRef';
  }
  return null;
}
function sessionRefProblem(value: unknown): string | null {
  if (!isJsonObject(value) || !nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return 'sessionRef must be a complete SessionRef';
  }
  return null;
}

function kernelBindingProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'kernel must be a KernelExecutionBinding object or null';
  if (!hasOnlyKeys(value, ['adapterId', 'kernelSessionId', 'runId', 'turnId'])) {
    return 'kernel carries unknown fields';
  }
  if (!nonEmpty(value['adapterId']) || !nonEmpty(value['kernelSessionId'])
    || !nonEmpty(value['runId']) || !nonEmpty(value['turnId'])) {
    return 'kernel identity is incomplete';
  }
  return null;
}

const V1_PHASES: readonly string[] = ['authorized', 'entered', 'revoked', 'quarantined', 'settled'];
const V2_PHASES: readonly string[] = ['authorized', 'entering', 'entered', 'unknown', 'revoked', 'settled'];

// --------------------------------------------------------------------------
// Execution authorization
// --------------------------------------------------------------------------

/** Strict V2 validator. `entering`/`entered` require a bound Kernel identity. */
export function executionAuthorizationV2Problem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'executionAuthorization V2 must be an object';
  if (!hasOnlyKeys(value, ['schemaVersion', 'generation', 'sessionGeneration', 'revision',
    'consumerId', 'inputDigest', 'phase', 'kernel'])) {
    return 'executionAuthorization V2 carries unknown fields';
  }
  if (value['schemaVersion'] !== 2) return 'executionAuthorization V2 schemaVersion must be 2';
  if (!isPositiveSafeInteger(value['generation'])) return 'executionAuthorization V2 generation must be a positive safe integer';
  if (!isPositiveSafeInteger(value['sessionGeneration'])) return 'executionAuthorization V2 sessionGeneration must be a positive safe integer';
  if (!isPositiveSafeInteger(value['revision'])) return 'executionAuthorization V2 revision must be a positive safe integer';
  if (!nonEmpty(value['consumerId'])) return 'executionAuthorization V2 consumerId is required';
  if (!isSha256Hex(value['inputDigest'])) return 'executionAuthorization V2 inputDigest must be a sha256 hex';
  if (!V2_PHASES.includes(value['phase'] as string)) return 'executionAuthorization V2 phase is not recognized';
  const kernel = value['kernel'];
  if (kernel === null) {
    if (value['phase'] === 'entering' || value['phase'] === 'entered') {
      return `executionAuthorization V2 phase ${String(value['phase'])} requires a bound kernel`;
    }
    return null;
  }
  return kernelBindingProblem(kernel);
}

/** True only for a complete V2 authorization binding. */
export function isExecutionAuthorizationV2(value: unknown): value is ExecutionAuthorizationV2 {
  return executionAuthorizationV2Problem(value) === null;
}

function executionAuthorizationV1Problem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'executionAuthorization must be an object';
  if (!hasOnlyKeys(value, ['generation', 'consumerId', 'phase'])) {
    return 'legacy executionAuthorization carries unknown fields';
  }
  if (!isPositiveSafeInteger(value['generation'])) return 'legacy executionAuthorization generation must be a positive safe integer';
  if (!nonEmpty(value['consumerId'])) return 'legacy executionAuthorization consumerId is required';
  if (!V1_PHASES.includes(value['phase'] as string)) return 'legacy executionAuthorization phase is not recognized';
  return null;
}

/**
 * Run-level authorization validator. `undefined` is a historical Run with no
 * entry binding and stays readable; a V2 is strict; a legacy V1 is readable for
 * history but carries no fresh begin permission.
 */
export function runExecutionAuthorizationProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isJsonObject(value)) return 'executionAuthorization must be an object';
  if ('schemaVersion' in value) return executionAuthorizationV2Problem(value);
  return executionAuthorizationV1Problem(value);
}

// --------------------------------------------------------------------------
// Runtime input binding
// --------------------------------------------------------------------------

function materialGrantRefProblem(value: unknown): string | null {
  if (!isJsonObject(value) || value['aggregateType'] !== 'MaterialAccessGrant'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])
    || !nonEmpty(value['goalId']) || !nonEmpty(value['grantId'])) {
    return 'materialAccessRefs entries must be complete MaterialAccessGrantRefs';
  }
  return null;
}
function deliveryPinProblem(value: unknown): string | null {
  if (!isJsonObject(value) || value['aggregateType'] !== 'Delivery'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) || !nonEmpty(value['deliveryId'])) {
    return 'deliveryRefs entries must be complete ModelRequestMaterialPinV1 values';
  }
  return null;
}

export function inputBindingProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'inputBinding must be an object';
  if (!hasOnlyKeys(value, ['schemaVersion', 'inputDigest', 'manifestDigest',
    'materialAccessRefs', 'deliveryRefs', 'additionalMaterialRefs'])) {
    return 'inputBinding carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'inputBinding schemaVersion must be 1';
  if (!isSha256Hex(value['inputDigest'])) return 'inputBinding inputDigest must be a sha256 hex';
  if (!isSha256Hex(value['manifestDigest'])) return 'inputBinding manifestDigest must be a sha256 hex';
  if (!Array.isArray(value['materialAccessRefs'])) return 'inputBinding materialAccessRefs must be an array';
  for (const grantRef of value['materialAccessRefs']) {
    const problem = materialGrantRefProblem(grantRef);
    if (problem !== null) return problem;
  }
  if (!Array.isArray(value['deliveryRefs'])) return 'inputBinding deliveryRefs must be an array';
  for (const pin of value['deliveryRefs']) {
    const problem = deliveryPinProblem(pin);
    if (problem !== null) return problem;
  }
  if (value['additionalMaterialRefs'] !== undefined) {
    if (!Array.isArray(value['additionalMaterialRefs'])) return 'inputBinding additionalMaterialRefs must be an array';
    for (const artifact of value['additionalMaterialRefs']) {
      if (!isArtifactRef(artifact)) return 'inputBinding additionalMaterialRefs entries must be complete ArtifactRefs';
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Lease release and dispatch state
// --------------------------------------------------------------------------

export function taskLeaseReleaseV1Problem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'lease release must be an object';
  if (!hasOnlyKeys(value, ['schemaVersion', 'runRef', 'attemptRef', 'sessionRef', 'generation', 'releasedAt', 'eventId'])) {
    return 'lease release carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'lease release schemaVersion must be 1';
  const runProblem = runRefProblem(value['runRef'], 'lease release runRef');
  if (runProblem !== null) return runProblem;
  const attemptProblem = attemptRefProblem(value['attemptRef']);
  if (attemptProblem !== null) return attemptProblem;
  const sessionProblem = sessionRefProblem(value['sessionRef']);
  if (sessionProblem !== null) return sessionProblem;
  if (!isPositiveSafeInteger(value['generation'])) return 'lease release generation must be a positive safe integer';
  if (!nonEmpty(value['releasedAt'])) return 'lease release releasedAt is required';
  if (!nonEmpty(value['eventId'])) return 'lease release eventId is required';
  const runRef = value['runRef'] as Record<string, unknown>;
  const attemptRef = value['attemptRef'] as Record<string, unknown>;
  const sessionRef = value['sessionRef'] as Record<string, unknown>;
  if (attemptRef['projectId'] !== runRef['projectId'] || attemptRef['goalId'] !== runRef['goalId']) {
    return 'lease release attemptRef does not belong to the same goal as its Run';
  }
  if (sessionRef['projectId'] !== runRef['projectId']) {
    return 'lease release sessionRef does not belong to the Run project';
  }
  return null;
}

export function taskLeaseSnapshotProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'TaskLease snapshot must be an object';
  if (!hasOnlyKeys(value, ['ref', 'revision', 'schemaVersion', 'holderRunId', 'attemptId',
    'grantedAt', 'expiresAt', 'release'])) {
    return 'TaskLease snapshot carries unknown fields';
  }
  const ref = value['ref'];
  if (!isJsonObject(ref) || ref['aggregateType'] !== 'TaskLease'
    || !nonEmpty(ref['projectId']) || !nonEmpty(ref['goalId']) || !nonEmpty(ref['taskId'])) {
    return 'TaskLease snapshot has no complete TaskLeaseRef';
  }
  if (!isPositiveSafeInteger(value['revision'])) return 'TaskLease revision must be a positive safe integer';
  if (value['schemaVersion'] !== 1) return 'TaskLease schemaVersion must be 1';
  if (!nonEmpty(value['holderRunId']) || !nonEmpty(value['attemptId']) || !nonEmpty(value['grantedAt'])) {
    return 'TaskLease must carry holderRunId, attemptId and grantedAt';
  }
  if (!(value['expiresAt'] === null || nonEmpty(value['expiresAt']))) {
    return 'TaskLease expiresAt must be null or a string';
  }
  if (value['release'] === undefined) return null;
  const releaseProblem = taskLeaseReleaseV1Problem(value['release']);
  if (releaseProblem !== null) return releaseProblem;
  const release = value['release'] as Record<string, unknown>;
  const releaseRun = release['runRef'] as Record<string, unknown>;
  const releaseAttempt = release['attemptRef'] as Record<string, unknown>;
  const releaseSession = release['sessionRef'] as Record<string, unknown>;
  const refRecord = ref as Record<string, unknown>;
  // The nested release must align with the OUTER lease ref on the full
  // project/goal/task scope, not just the local runId/attemptId: a release that
  // is internally consistent but names a foreign scope is rejected.
  if (releaseRun['projectId'] !== refRecord['projectId'] || releaseRun['goalId'] !== refRecord['goalId']
    || releaseAttempt['projectId'] !== refRecord['projectId'] || releaseAttempt['goalId'] !== refRecord['goalId']
    || releaseAttempt['taskId'] !== refRecord['taskId']
    || releaseSession['projectId'] !== refRecord['projectId']) {
    return 'TaskLease release scope does not align with the outer lease ref';
  }
  if (releaseRun['runId'] !== value['holderRunId'] || releaseAttempt['attemptId'] !== value['attemptId']) {
    return 'TaskLease release does not name the recorded holder/attempt';
  }
  return null;
}

export function taskDispatchStateV1Problem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'dispatchState must be an object';
  if (!hasOnlyKeys(value, ['schemaVersion', 'phase', 'consumerId', 'entryGeneration', 'sessionGeneration', 'eventId'])) {
    return 'dispatchState carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'dispatchState schemaVersion must be 1';
  if (value['phase'] !== 'entered' && value['phase'] !== 'settled') return 'dispatchState phase must be entered or settled';
  if (!nonEmpty(value['consumerId'])) return 'dispatchState consumerId is required';
  if (!isPositiveSafeInteger(value['entryGeneration'])) return 'dispatchState entryGeneration must be a positive safe integer';
  if (!isPositiveSafeInteger(value['sessionGeneration'])) return 'dispatchState sessionGeneration must be a positive safe integer';
  if (!nonEmpty(value['eventId'])) return 'dispatchState eventId is required';
  return null;
}

// --------------------------------------------------------------------------
// Execution-entry replay events
// --------------------------------------------------------------------------

export type ExecutionEntryEventActor = Extract<ActorRef, { kind: 'human' | 'system' }>;

type ExecutionEntryEventBase = {
  eventId: string;
  schemaVersion: typeof EXECUTION_ENTRY_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  actor: ExecutionEntryEventActor;
  fingerprint: string;
};

export type ExecutionEntryAuthorizedEvent = ExecutionEntryEventBase & {
  eventType: typeof EXECUTION_ENTRY_AUTHORIZED_EVENT_TYPE;
  permit: TaskEntryPermit;
};
export type ExecutionEntryBegunEvent = ExecutionEntryEventBase & {
  eventType: typeof EXECUTION_ENTRY_BEGUN_EVENT_TYPE;
  permit: TaskEntryPermit;
  kernel: RunExecutionHistoryV1['kernel'];
  entry: RuntimeEntryRecord;
};
export type ExecutionEntryEnteredEvent = ExecutionEntryEventBase & {
  eventType: typeof EXECUTION_ENTRY_ENTERED_EVENT_TYPE;
  permit: TaskEntryPermit;
  run: RunSnapshot;
};
export type ExecutionRunResultRecordedEvent = ExecutionEntryEventBase & {
  eventType: typeof EXECUTION_RUN_RESULT_RECORDED_EVENT_TYPE;
  claim: TaskEntryPermit['claim'];
  entry: Pick<TaskEntryPermit, 'consumerId' | 'entryGeneration'>;
  run: RunSnapshot;
};

function parseObject(json: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decodeEventBase<EventType extends string>(
  event: EncodedDomainEvent,
  expectedType: EventType,
  expectedVersion: number,
): DecodeResult<{ body: Record<string, unknown>; actor: ExecutionEntryEventActor }> {
  if (!isJsonObject(event)) return invalid('execution-entry event must be an object');
  if (event['eventType'] !== expectedType) {
    return invalid(`expected eventType ${expectedType}, got ${String(event['eventType'])}`);
  }
  if (event['schemaVersion'] !== expectedVersion) {
    return invalid(`expected schemaVersion ${String(expectedVersion)}, got ${String(event['schemaVersion'])}`);
  }
  if (!nonEmpty(event['eventId']) || !nonEmpty(event['occurredAt'])) return invalid('execution-entry envelope is incomplete');
  if (typeof event['json'] !== 'string') return invalid('execution-entry json must be a string');
  const body = parseObject(event['json']);
  if (body === null) return invalid('execution-entry event is not a JSON object');
  if (body['eventId'] !== event['eventId']) return invalid('execution-entry json does not match the envelope eventId');
  if (body['eventType'] !== event['eventType']) return invalid('execution-entry json does not match the envelope eventType');
  if (body['schemaVersion'] !== event['schemaVersion']) return invalid('execution-entry json does not match the envelope schemaVersion');
  if (body['occurredAt'] !== event['occurredAt']) return invalid('execution-entry json does not match the envelope occurredAt');
  if (!nonEmpty(body['identityKey'])) return invalid('execution-entry identityKey is required');
  if (!nonEmpty(body['fingerprint'])) return invalid('execution-entry fingerprint is required');
  const actor = body['actor'];
  if (!isJsonObject(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return invalid('execution-entry actor must be a trusted human/system actor');
  }
  return { status: 'decoded', value: { body, actor: { kind: actor['kind'], id: actor['id'] } as ExecutionEntryEventActor } };
}

function permitProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'permit must be a TaskEntryPermit';
  if (!hasOnlyKeys(value, ['claim', 'consumerId', 'entryGeneration', 'authorizationRevision', 'inputDigest'])) {
    return 'permit carries unknown fields';
  }
  if (!nonEmpty(value['consumerId'])) return 'permit consumerId is required';
  if (!isPositiveSafeInteger(value['entryGeneration'])) return 'permit entryGeneration must be a positive safe integer';
  if (!isPositiveSafeInteger(value['authorizationRevision'])) return 'permit authorizationRevision must be a positive safe integer';
  if (!isSha256Hex(value['inputDigest'])) return 'permit inputDigest must be a sha256 hex';
  const claim = value['claim'];
  if (!isJsonObject(claim) || !isJsonObject(claim['runRef']) || claim['runRef']['aggregateType'] !== 'Run') {
    return 'permit claim must carry a RunRef';
  }
  return null;
}

function entryProjectionProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'entry projection must be an object';
  if (!hasOnlyKeys(value, ['consumerId', 'entryGeneration'])) return 'entry projection carries unknown fields';
  if (!nonEmpty(value['consumerId']) || !isPositiveSafeInteger(value['entryGeneration'])) {
    return 'entry projection is incomplete';
  }
  return null;
}

export function encodeExecutionEntryAuthorizedEvent(event: ExecutionEntryAuthorizedEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}
export function executionEntryAuthorizedEventFromEvent(event: EncodedDomainEvent): DecodeResult<ExecutionEntryAuthorizedEvent> {
  const decoded = decodeEventBase(event, EXECUTION_ENTRY_AUTHORIZED_EVENT_TYPE, EXECUTION_ENTRY_EVENT_SCHEMA_VERSION);
  if (decoded.status !== 'decoded') return decoded;
  const problem = permitProblem(decoded.value.body['permit']);
  if (problem !== null) return invalid(problem);
  return { status: 'decoded', value: decoded.value.body as unknown as ExecutionEntryAuthorizedEvent };
}

export function encodeExecutionEntryBegunEvent(event: ExecutionEntryBegunEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}
export function executionEntryBegunEventFromEvent(event: EncodedDomainEvent): DecodeResult<ExecutionEntryBegunEvent> {
  const decoded = decodeEventBase(event, EXECUTION_ENTRY_BEGUN_EVENT_TYPE, EXECUTION_ENTRY_EVENT_SCHEMA_VERSION);
  if (decoded.status !== 'decoded') return decoded;
  const body = decoded.value.body;
  const permit = permitProblem(body['permit']);
  if (permit !== null) return invalid(permit);
  const kernel = kernelBindingProblem(body['kernel']);
  if (kernel !== null) return invalid(kernel);
  const entry = body['entry'];
  if (!isJsonObject(entry) || runRefProblem(entry['runRef'], 'entry.runRef') !== null
    || !isPositiveSafeInteger(entry['runRevision']) || !isJsonObject(entry['authorization'])) {
    return invalid('begin event entry projection is incomplete');
  }
  const authProblem = executionAuthorizationV2Problem(entry['authorization']);
  if (authProblem !== null) return invalid(authProblem);
  return { status: 'decoded', value: body as unknown as ExecutionEntryBegunEvent };
}

function runSnapshotProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'recorded run must be a RunSnapshot object';
  if (value['schemaVersion'] !== 1) return 'recorded run schemaVersion must be 1';
  if (runRefProblem(value['ref'], 'recorded run ref') !== null) return 'recorded run ref is incomplete';
  if (!isPositiveSafeInteger(value['revision'])) return 'recorded run revision must be a positive safe integer';
  if (typeof value['status'] !== 'string') return 'recorded run status is required';
  return null;
}

export function encodeExecutionEntryEnteredEvent(event: ExecutionEntryEnteredEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}
export function executionEntryEnteredEventFromEvent(event: EncodedDomainEvent): DecodeResult<ExecutionEntryEnteredEvent> {
  const decoded = decodeEventBase(event, EXECUTION_ENTRY_ENTERED_EVENT_TYPE, EXECUTION_ENTRY_EVENT_SCHEMA_VERSION);
  if (decoded.status !== 'decoded') return decoded;
  const body = decoded.value.body;
  const permit = permitProblem(body['permit']);
  if (permit !== null) return invalid(permit);
  const runProblem = runSnapshotProblem(body['run']);
  if (runProblem !== null) return invalid(runProblem);
  return { status: 'decoded', value: body as unknown as ExecutionEntryEnteredEvent };
}

export function encodeExecutionRunResultRecordedEvent(event: ExecutionRunResultRecordedEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}
export function executionRunResultRecordedEventFromEvent(event: EncodedDomainEvent): DecodeResult<ExecutionRunResultRecordedEvent> {
  const decoded = decodeEventBase(event, EXECUTION_RUN_RESULT_RECORDED_EVENT_TYPE, EXECUTION_ENTRY_EVENT_SCHEMA_VERSION);
  if (decoded.status !== 'decoded') return decoded;
  const body = decoded.value.body;
  const entry = entryProjectionProblem(body['entry']);
  if (entry !== null) return invalid(entry);
  const claim = body['claim'];
  if (!isJsonObject(claim) || !isJsonObject(claim['runRef']) || claim['runRef']['aggregateType'] !== 'Run') {
    return invalid('result event claim must carry a RunRef');
  }
  const runProblem = runSnapshotProblem(body['run']);
  if (runProblem !== null) return invalid(runProblem);
  return { status: 'decoded', value: body as unknown as ExecutionRunResultRecordedEvent };
}

function validateAuthorizedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = executionEntryAuthorizedEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}
function validateBegunEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = executionEntryBegunEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}
function validateEnteredEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = executionEntryEnteredEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}
function validateResultEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = executionRunResultRecordedEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

/**
 * Registration for the four entry/result replay events only. `records` is
 * EMPTY on purpose: Run/Attempt/outbox/Lease/Session are registered by their
 * owning modules and a duplicate aggregateType registration is a real conflict.
 */
export const EXECUTION_ENTRY_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [],
  events: [
    { eventType: EXECUTION_ENTRY_AUTHORIZED_EVENT_TYPE, schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, validate: validateAuthorizedEvent },
    { eventType: EXECUTION_ENTRY_BEGUN_EVENT_TYPE, schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, validate: validateBegunEvent },
    { eventType: EXECUTION_ENTRY_ENTERED_EVENT_TYPE, schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, validate: validateEnteredEvent },
    { eventType: EXECUTION_RUN_RESULT_RECORDED_EVENT_TYPE, schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, validate: validateResultEvent },
  ],
  lookups: [],
};
