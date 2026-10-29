/**
 * Nested execution-entry codecs (implementation).
 *
 * Responsibility of THIS file:
 *  - own the PURE strict validators for the versioned nested facts carried by
 *    the existing @1 bodies: `ExecutionAuthorizationV2`,
 *    `RuntimeInputBindingV1`, `TaskLeaseReleaseV1`, the @1 TaskLease snapshot
 *    including its optional release, and `TaskDispatchStateV2`;
 *  - own the A.2 Run nested-fact validators used by the Run reader:
 *    `RuntimeEventV1`, `RunSnapshot.terminalPayload` and `RunReconciliationV1`
 *    (spec §6.1 (a), (f));
 *  - own the four `ExecutionEntry*` replay event codecs plus their registration.
 *
 * It does NOT register a second Run/Attempt/outbox/Lease schema: those
 * aggregate types are owned elsewhere and a duplicate registration is a real
 * conflict.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import {
  TERMINAL_PAYLOAD_TEXT_MAX_CHARS, TERMINAL_PAYLOAD_TRUNCATION_SUFFIX,
  type ExecutionAuthorizationV2, type RunOutcome, type RunSnapshot, type TaskDispatchStateV2, type TaskLeaseReleaseV1,
} from '../../../contracts/dispatch.js';
import type { RunExecutionHistoryV1 } from '../../../contracts/core/execution-history.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  RecordBackendSchemas,
} from '../../record-store/ports.js';
import { isArtifactRef } from '../../record-store/body-codec.js';
import {
  hasOnlyKeys, invalid, isNonNeg as isNonNegativeSafeInteger, isPos as isPositiveSafeInteger,
  isRecord as isJsonObject, isSha256Hex, nonEmpty, parseObject,
} from '../../../contracts/validation/common.js';
import { MODEL_SERVICE_FAILURE_CODES } from '../../../contracts/dispatch.js';
import type { RuntimeEntryRecord, TaskEntryPermit } from '../model/execution-entry-contracts.js';
import { encodeEventEnvelope } from './event-envelope.js';
import { controlIntentRefProblem } from './rework-codecs.js';
import { RUN_ACTIVITY_RECORD_SCHEMAS } from './run-activity-codecs.js';

export type { ExecutionAuthorizationV2, TaskDispatchStateV2, TaskLeaseReleaseV1 };

export const EXECUTION_ENTRY_EVENT_SCHEMA_VERSION = 1 as const;
export const EXECUTION_ENTRY_AUTHORIZED_EVENT_TYPE = 'ExecutionEntryAuthorized' as const;
export const EXECUTION_ENTRY_BEGUN_EVENT_TYPE = 'ExecutionEntryBegun' as const;
export const EXECUTION_ENTRY_ENTERED_EVENT_TYPE = 'ExecutionEntryEntered' as const;
export const EXECUTION_RUN_RESULT_RECORDED_EVENT_TYPE = 'ExecutionRunResultRecorded' as const;
/** A.2 step 5.6: the Run writes without a Kernel terminal (`reconcileRun`, `resolveUnknownRun`, `reconcileRunControls`). */
export const EXECUTION_RUN_RECONCILED_EVENT_TYPE = 'ExecutionRunReconciled' as const;

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

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
/** This codec's loose SessionRef check: extra keys are allowed (the shared
 *  `sessionRefProblem` also requires only the known keys). */
function looseSessionRefProblem(value: unknown): string | null {
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

/**
 * Run-level authorization validator. `undefined` is a historical Run with no
 * entry binding and stays readable; a V2 is strict. An object without a V2
 * `schemaVersion` is damaged, not historical.
 */
export function runExecutionAuthorizationProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isJsonObject(value)) return 'executionAuthorization must be an object';
  return executionAuthorizationV2Problem(value);
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

/**
 * `continuationBriefDigest` (C3, spec §6.1 (e)) is optional and, when present, a
 * sha256 hex. Whether a Run must or must not carry it (§11 I-19) is the entry
 * guard's decision, not this shape check.
 */
export function inputBindingProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'inputBinding must be an object';
  if (!hasOnlyKeys(value, ['schemaVersion', 'inputDigest', 'manifestDigest',
    'materialAccessRefs', 'deliveryRefs', 'additionalMaterialRefs', 'continuationBriefDigest', 'anomalyAnchorRefs'])) {
    return 'inputBinding carries unknown fields';
  }
  if (value['continuationBriefDigest'] !== undefined && !isSha256Hex(value['continuationBriefDigest'])) {
    return 'inputBinding continuationBriefDigest must be a sha256 hex';
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
  if (value['anomalyAnchorRefs'] !== undefined) {
    const anchors = anomalyAnchorRefsProblem(value['anomalyAnchorRefs']);
    if (anchors !== null) return anchors;
  }
  return null;
}

/**
 * Slice 1 §3.5/F83: strict shape of the optional `inputBinding.anomalyAnchorRefs`
 * (complete refs, at most 8, no duplicates). Absent stays legal.
 */
const ANOMALY_ANCHOR_REF_LIMIT = 8;

export function anomalyAnchorRefsProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return 'inputBinding anomalyAnchorRefs must be an array';
  if (value.length > ANOMALY_ANCHOR_REF_LIMIT) {
    return `inputBinding anomalyAnchorRefs holds more than ${String(ANOMALY_ANCHOR_REF_LIMIT)} entries`;
  }
  const seen = new Set<string>();
  for (const ref of value) {
    if (!isJsonObject(ref)
      || !hasOnlyKeys(ref, ['aggregateType', 'projectId', 'goalId', 'runId'])
      || ref['aggregateType'] !== 'SessionAnomalyAnchor'
      || !nonEmpty(ref['projectId']) || !nonEmpty(ref['goalId']) || !nonEmpty(ref['runId'])) {
      return 'inputBinding anomalyAnchorRefs entries must be complete SessionAnomalyAnchorRefs';
    }
    const key = JSON.stringify([ref['projectId'], ref['goalId'], ref['runId']]);
    if (seen.has(key)) return 'inputBinding anomalyAnchorRefs must not repeat the same anchor';
    seen.add(key);
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
  const sessionProblem = looseSessionRefProblem(value['sessionRef']);
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

/**
 * AD-2 not-entered settlement (`pending → settled` directly, D-7). The entry
 * identity may be absent because the Run never had one; a present value is
 * still a complete identity.
 */
export function taskDispatchStateV2Problem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'dispatchState must be an object';
  if (!hasOnlyKeys(value, ['schemaVersion', 'phase', 'settlement', 'consumerId', 'entryGeneration', 'sessionGeneration', 'eventId'])) {
    return 'dispatchState V2 carries unknown fields';
  }
  if (value['schemaVersion'] !== 2) return 'dispatchState V2 schemaVersion must be 2';
  if (value['phase'] !== 'settled') return 'dispatchState V2 phase must be settled';
  if (value['settlement'] !== 'not_entered') return 'dispatchState V2 settlement must be not_entered';
  if (!(value['consumerId'] === null || nonEmpty(value['consumerId']))) {
    return 'dispatchState V2 consumerId must be null or a non-empty string';
  }
  if (!(value['entryGeneration'] === null || isPositiveSafeInteger(value['entryGeneration']))) {
    return 'dispatchState V2 entryGeneration must be null or a positive safe integer';
  }
  if (!isPositiveSafeInteger(value['sessionGeneration'])) return 'dispatchState V2 sessionGeneration must be a positive safe integer';
  if (!nonEmpty(value['eventId'])) return 'dispatchState V2 eventId is required';
  return null;
}

/** Outbox `dispatchState` validator: dispatches on the nested `schemaVersion` (AD-2). */
export function taskDispatchStateProblem(value: unknown): string | null {
  if (isJsonObject(value) && value['schemaVersion'] === 2) return taskDispatchStateV2Problem(value);
  return taskDispatchStateV1Problem(value);
}

// --------------------------------------------------------------------------
// A.2 Run nested facts (spec §6.1 (a), (f); §4.1)
// --------------------------------------------------------------------------

const RUNTIME_EVENT_PAYLOAD_KINDS: Readonly<Record<string, string>> = Object.freeze({
  run_started: 'started',
  run_completed: 'completed',
  run_crashed: 'crashed',
  run_cancelled: 'cancelled',
  run_budget_exhausted: 'budget_exhausted',
  run_yielded: 'yielded',
});
const YIELD_REASONS: readonly string[] = ['reply_required', 'external_input_required', 'operator_requested'];

/** Closed `RuntimeEventV1['payload']` shape check. */
export function runtimeEventPayloadProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'runtime event payload must be an object';
  switch (value['kind']) {
    case 'started':
      if (!hasOnlyKeys(value, ['kind', 'startedAt']) || !nonEmpty(value['startedAt'])) return 'a started payload requires startedAt';
      return null;
    case 'completed':
      if (!hasOnlyKeys(value, ['kind', 'exitCode']) || typeof value['exitCode'] !== 'number'
        || !Number.isSafeInteger(value['exitCode'])) {
        return 'a completed payload requires a safe integer exitCode';
      }
      return null;
    case 'crashed': {
      if (!hasOnlyKeys(value, ['kind', 'error', 'modelService']) || typeof value['error'] !== 'string') {
        return 'a crashed payload requires an error string';
      }
      const modelService = value['modelService'];
      if (modelService === undefined) return null;
      if (!isJsonObject(modelService) || !hasOnlyKeys(modelService, ['code'])
        || !(MODEL_SERVICE_FAILURE_CODES as readonly string[]).includes(modelService['code'] as string)) {
        return 'a crashed payload modelService requires a recognized code';
      }
      return null;
    }
    case 'cancelled':
      if (!hasOnlyKeys(value, ['kind', 'reason']) || typeof value['reason'] !== 'string') return 'a cancelled payload requires a reason string';
      return null;
    case 'budget_exhausted':
      if (!hasOnlyKeys(value, ['kind', 'exhaustedAt']) || !nonEmpty(value['exhaustedAt'])) {
        return 'a budget_exhausted payload requires exhaustedAt';
      }
      return null;
    case 'yielded': {
      if (!hasOnlyKeys(value, ['kind', 'yield'])) return 'a yielded payload carries unknown fields';
      const yielded = value['yield'];
      if (!isJsonObject(yielded) || !hasOnlyKeys(yielded, ['reason', 'requestedBy', 'yieldedAt', 'pendingToolCallId'])
        || !YIELD_REASONS.includes(yielded['reason'] as string)
        || (yielded['requestedBy'] !== 'runtime' && yielded['requestedBy'] !== 'app')
        || !nonEmpty(yielded['yieldedAt'])
        || !(yielded['pendingToolCallId'] === null || nonEmpty(yielded['pendingToolCallId']))) {
        return 'a yielded payload requires a complete yield';
      }
      return null;
    }
    default:
      return 'runtime event payload kind is not recognized';
  }
}

/** Closed `RuntimeEventV1` shape check; the payload kind must match the event type. */
export function runtimeEventProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'runtime event must be an object';
  if (!hasOnlyKeys(value, ['eventType', 'schemaVersion', 'eventId', 'runRef', 'sequence', 'occurredAt', 'payload'])) {
    return 'runtime event carries unknown fields';
  }
  const expectedKind = typeof value['eventType'] === 'string' ? RUNTIME_EVENT_PAYLOAD_KINDS[value['eventType']] : undefined;
  if (expectedKind === undefined) return 'runtime event type is not recognized';
  if (value['schemaVersion'] !== 1) return 'runtime event schemaVersion must be 1';
  if (!nonEmpty(value['eventId'])) return 'runtime event eventId is required';
  const runProblem = runRefProblem(value['runRef'], 'runtime event runRef');
  if (runProblem !== null) return runProblem;
  if (!isNonNegativeSafeInteger(value['sequence'])) return 'runtime event sequence must be a non-negative safe integer';
  if (!nonEmpty(value['occurredAt'])) return 'runtime event occurredAt is required';
  const payloadProblem = runtimeEventPayloadProblem(value['payload']);
  if (payloadProblem !== null) return payloadProblem;
  if ((value['payload'] as Record<string, unknown>)['kind'] !== expectedKind) {
    return `runtime event ${String(value['eventType'])} requires a ${expectedKind} payload`;
  }
  return null;
}

/** The terminal payload kind each known outcome records (contract (f)). */
const TERMINAL_PAYLOAD_KIND_BY_OUTCOME: Readonly<Partial<Record<RunOutcome, string>>> = Object.freeze({
  completed: 'completed',
  crashed: 'crashed',
  cancelled: 'cancelled',
  budget_exhausted: 'budget_exhausted',
  yielded: 'yielded',
});
const TERMINAL_PAYLOAD_TEXT_LIMIT = TERMINAL_PAYLOAD_TEXT_MAX_CHARS + TERMINAL_PAYLOAD_TRUNCATION_SUFFIX.length;

/**
 * `RunSnapshot.terminalPayload` (C1, spec §6.1 (f)). `undefined` is a historical
 * Run, an `outcome_unknown` Run or a not-entered cancel. A present payload is a
 * bounded terminal payload of an ended Run whose kind matches its known outcome.
 */
export function terminalPayloadProblem(value: unknown, status: unknown, outcome: unknown): string | null {
  if (value === undefined) return null;
  const payloadProblem = runtimeEventPayloadProblem(value);
  if (payloadProblem !== null) return payloadProblem;
  const payload = value as Record<string, unknown>;
  if (payload['kind'] === 'started') return 'terminalPayload must be a terminal payload';
  if (status !== 'ended') return 'terminalPayload is only recorded on an ended Run';
  const expectedKind = typeof outcome === 'string' ? TERMINAL_PAYLOAD_KIND_BY_OUTCOME[outcome as RunOutcome] : undefined;
  if (expectedKind === undefined) return `terminalPayload is not recorded for outcome ${String(outcome)}`;
  if (payload['kind'] !== expectedKind) return `terminalPayload kind ${String(payload['kind'])} disagrees with outcome ${String(outcome)}`;
  const text = payload['kind'] === 'crashed' ? payload['error'] : payload['kind'] === 'cancelled' ? payload['reason'] : null;
  if (typeof text === 'string' && text.length > TERMINAL_PAYLOAD_TEXT_LIMIT) {
    return `terminalPayload text exceeds ${String(TERMINAL_PAYLOAD_TEXT_MAX_CHARS)} characters plus the truncation suffix`;
  }
  return null;
}

function reconciliationBasisProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'reconciliation basis must be an object';
  if (value['kind'] === 'live_clean') {
    return hasOnlyKeys(value, ['kind']) ? null : 'reconciliation live_clean basis carries unknown fields';
  }
  if (value['kind'] === 'host_instance_takeover') {
    if (!hasOnlyKeys(value, ['kind', 'hostInstanceId']) || !nonEmpty(value['hostInstanceId'])) {
      return 'reconciliation host_instance_takeover basis requires a hostInstanceId';
    }
    return null;
  }
  return 'reconciliation basis kind must be live_clean or host_instance_takeover';
}

/** K3 (L2): the labeled takeover proof a RUN-25 observation carries. */
function hostTakeoverProofProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return 'takeover_unresolved observation proof must be an object';
  switch (value['kind']) {
    case 'hl01_no_lock':
      return hasOnlyKeys(value, ['kind']) ? null : 'hl01_no_lock proof carries unknown fields';
    case 'hl03_stale_lock':
      if (!hasOnlyKeys(value, ['kind', 'previousInstanceId', 'previousPid'])
        || !nonEmpty(value['previousInstanceId']) || !isPositiveSafeInteger(value['previousPid'])) {
        return 'hl03_stale_lock proof needs the previous instance id and pid';
      }
      return null;
    case 'memory_store':
      return hasOnlyKeys(value, ['kind']) ? null : 'memory_store proof carries unknown fields';
    default:
      return 'takeover_unresolved observation proof kind is not recognized';
  }
}

/** K3 (L7): the review record a RUN-25 observation names. */
function unknownCallReviewRefProblem(value: unknown): string | null {
  if (!isJsonObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || value['aggregateType'] !== 'UnknownCallReview' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'takeover_unresolved observation reviewRef must be a complete UnknownCallReviewRef';
  }
  return null;
}

function reconciliationEventProblem(value: unknown, runRef: Record<string, unknown>, label: string): string | null {  const problem = runtimeEventProblem(value);
  if (problem !== null) return `${label}: ${problem}`;
  const eventRun = (value as Record<string, unknown>)['runRef'] as Record<string, unknown>;
  if (eventRun['projectId'] !== runRef['projectId'] || eventRun['goalId'] !== runRef['goalId']
    || eventRun['runId'] !== runRef['runId']) {
    return `${label} names another Run`;
  }
  return null;
}

/**
 * `RunSnapshot.reconciliation` (spec §6.1 contract (a)). The field had no writer
 * before A.2, so every present value must be a complete current shape.
 * `interrupted_clean` must carry both C4 fields (`kernelPaused`,
 * `pausedIntentRef`); which status a given observation is written with is the
 * reconciliation owner's rule, not this shape check.
 */
export function runReconciliationProblem(value: unknown, runRef: Record<string, unknown>): string | null {
  if (value === undefined) return null;
  if (!isJsonObject(value)) return 'reconciliation must be an object';
  if (!hasOnlyKeys(value, ['status', 'observation', 'basis', 'recordedAt'])) return 'reconciliation carries unknown fields';
  if (value['status'] !== 'done' && value['status'] !== 'cancelled' && value['status'] !== 'quarantined') {
    return 'reconciliation status must be done, cancelled or quarantined';
  }
  if (!nonEmpty(value['recordedAt'])) return 'reconciliation recordedAt is required';
  const basisProblem = reconciliationBasisProblem(value['basis']);
  if (basisProblem !== null) return basisProblem;
  const observation = value['observation'];
  if (!isJsonObject(observation)) return 'reconciliation observation must be an object';
  switch (observation['kind']) {
    case 'runtime_terminal':
      if (!hasOnlyKeys(observation, ['kind', 'event', 'digest'])) return 'runtime_terminal observation carries unknown fields';
      if (!nonEmpty(observation['digest'])) return 'runtime_terminal observation digest is required';
      return reconciliationEventProblem(observation['event'], runRef, 'runtime_terminal observation event');
    case 'unresolved': {
      if (!hasOnlyKeys(observation, ['kind', 'reason', 'observedThroughPosition', 'unresolvedToolCallIds',
        'autoCleanupBlockedBy'])) {
        return 'unresolved observation carries unknown fields';
      }
      if (typeof observation['reason'] !== 'string') return 'unresolved observation reason must be a string';
      if (!(observation['observedThroughPosition'] === null || isNonNegativeSafeInteger(observation['observedThroughPosition']))) {
        return 'unresolved observation observedThroughPosition must be null or a non-negative safe integer';
      }
      const toolCallIds = observation['unresolvedToolCallIds'];
      if (!Array.isArray(toolCallIds) || !toolCallIds.every(nonEmpty)) {
        return 'unresolved observation unresolvedToolCallIds must be an array of non-empty strings';
      }
      // K3 (L25): the row-8 auto-cleanup blocker is optional; when present it names the first failing guard.
      if (Object.hasOwn(observation, 'autoCleanupBlockedBy') && !nonEmpty(observation['autoCleanupBlockedBy'])) {
        return 'unresolved observation autoCleanupBlockedBy must be a non-empty string when present';
      }
      return null;
    }
    case 'takeover_unresolved': {
      if (!hasOnlyKeys(observation, ['kind', 'event', 'lastPosition', 'observedThroughPosition', 'unresolvedToolCallIds',
        'proof', 'reviewRef'])) {
        return 'takeover_unresolved observation carries unknown fields';
      }
      const eventProblem = reconciliationEventProblem(observation['event'], runRef, 'takeover_unresolved observation event');
      if (eventProblem !== null) return eventProblem;
      const eventType = (observation['event'] as Record<string, unknown>)['eventType'];
      if (eventType !== 'run_crashed') return 'takeover_unresolved observation event must be a synthesized run_crashed';
      if (!isNonNegativeSafeInteger(observation['lastPosition'])
        || !isNonNegativeSafeInteger(observation['observedThroughPosition'])) {
        return 'takeover_unresolved observation positions must be non-negative safe integers';
      }
      const toolCallIds = observation['unresolvedToolCallIds'];
      if (!Array.isArray(toolCallIds) || toolCallIds.length === 0 || !toolCallIds.every(nonEmpty)) {
        return 'takeover_unresolved observation unresolvedToolCallIds must be a non-empty array of non-empty strings';
      }
      const proofProblem = hostTakeoverProofProblem(observation['proof']);
      if (proofProblem !== null) return proofProblem;
      const reviewProblem = unknownCallReviewRefProblem(observation['reviewRef']);
      if (reviewProblem !== null) return reviewProblem;
      return null;
    }
    case 'not_entered': {
      if (!hasOnlyKeys(observation, ['kind', 'kernel', 'revokedGeneration'])) return 'not_entered observation carries unknown fields';
      const kernelProblem = kernelBindingProblem(observation['kernel']);
      if (kernelProblem !== null) return `not_entered observation ${kernelProblem}`;
      if (!isPositiveSafeInteger(observation['revokedGeneration'])) {
        return 'not_entered observation revokedGeneration must be a positive safe integer';
      }
      return null;
    }
    case 'interrupted_clean': {
      if (!hasOnlyKeys(observation, ['kind', 'event', 'lastPosition', 'kernelPaused', 'pausedIntentRef'])) {
        return 'interrupted_clean observation carries unknown fields';
      }
      const eventProblem = reconciliationEventProblem(observation['event'], runRef, 'interrupted_clean observation event');
      if (eventProblem !== null) return eventProblem;
      const eventType = (observation['event'] as Record<string, unknown>)['eventType'];
      if (eventType !== 'run_crashed' && eventType !== 'run_cancelled') {
        return 'interrupted_clean observation event must be a synthesized run_crashed or run_cancelled';
      }
      if (!(observation['lastPosition'] === null || isNonNegativeSafeInteger(observation['lastPosition']))) {
        return 'interrupted_clean observation lastPosition must be null or a non-negative safe integer';
      }
      if (typeof observation['kernelPaused'] !== 'boolean') return 'interrupted_clean observation requires a kernelPaused boolean';
      if (!Object.hasOwn(observation, 'pausedIntentRef')) return 'interrupted_clean observation requires pausedIntentRef (null when none)';
      if (observation['pausedIntentRef'] !== null) {
        const intentProblem = controlIntentRefProblem(observation['pausedIntentRef'], 'interrupted_clean observation pausedIntentRef');
        if (intentProblem !== null) return intentProblem;
        if ((observation['pausedIntentRef'] as Record<string, unknown>)['projectId'] !== runRef['projectId']) {
          return 'interrupted_clean observation pausedIntentRef belongs to another project';
        }
      }
      return null;
    }
    case 'human_attested': {
      if (!hasOnlyKeys(observation, ['kind', 'attestedBy', 'reason'])) return 'human_attested observation carries unknown fields';
      const attestedBy = observation['attestedBy'];
      // An operator is any non-automation Host actor (TD-6, LA-7): a Host started
      // with a `kind:'system'` actor qualifies, a platform automation actor never does.
      if (!isJsonObject(attestedBy) || !hasOnlyKeys(attestedBy, ['kind', 'id'])
        || (attestedBy['kind'] !== 'human' && attestedBy['kind'] !== 'system') || !nonEmpty(attestedBy['id'])
        || isAutomationActor(attestedBy as ActorRef)) {
        return 'human_attested observation attestedBy must be a Host operator actor';
      }
      if (typeof observation['reason'] !== 'string') return 'human_attested observation reason must be a string';
      return null;
    }
    default:
      return 'reconciliation observation kind is not recognized';
  }
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
  /**
   * C6 (spec §6.1 (g)): present only when the entry plan verdict was
   * `carried_unchanged`; the Goal's active Plan pinned by the authorization
   * commit. The claim, envelope and inputBinding keep `claim.planRef`; replay
   * ignores this field.
   */
  activePlanRef?: PlanRevisionRef;
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

/**
 * The replay event of a Run write without a Kernel terminal (§6.3 RD-5):
 * `reconcile_run` (RUN-16/19/20/23/24), `resolve_unknown` (RUN-22),
 * `reconcile_controls` (RUN-09..11 (R), CTL-08(e)). `run` is the Run after the
 * commit (unchanged when the commit settled intents only).
 */
export type ExecutionRunReconciledEvent = ExecutionEntryEventBase & {
  eventType: typeof EXECUTION_RUN_RECONCILED_EVENT_TYPE;
  operation: 'reconcile_run' | 'resolve_unknown' | 'reconcile_controls';
  run: RunSnapshot;
};
const RECONCILED_OPERATIONS: readonly string[] = ['reconcile_run', 'resolve_unknown', 'reconcile_controls'];

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
  return encodeEventEnvelope(event);
}
export function executionEntryAuthorizedEventFromEvent(event: EncodedDomainEvent): DecodeResult<ExecutionEntryAuthorizedEvent> {
  const decoded = decodeEventBase(event, EXECUTION_ENTRY_AUTHORIZED_EVENT_TYPE, EXECUTION_ENTRY_EVENT_SCHEMA_VERSION);
  if (decoded.status !== 'decoded') return decoded;
  const problem = permitProblem(decoded.value.body['permit']);
  if (problem !== null) return invalid(problem);
  const activePlanRef = decoded.value.body['activePlanRef'];
  if (activePlanRef !== undefined) {
    const claimRun = ((decoded.value.body['permit'] as Record<string, unknown>)['claim'] as Record<string, unknown>)['runRef'] as Record<string, unknown>;
    if (!isJsonObject(activePlanRef) || !hasOnlyKeys(activePlanRef, ['aggregateType', 'projectId', 'planId'])
      || activePlanRef['aggregateType'] !== 'PlanRevision' || activePlanRef['projectId'] !== claimRun['projectId']
      || !nonEmpty(activePlanRef['planId'])) {
      return invalid('authorized event activePlanRef must be a PlanRevisionRef of the claim project');
    }
  }
  return { status: 'decoded', value: decoded.value.body as unknown as ExecutionEntryAuthorizedEvent };
}

export function encodeExecutionEntryBegunEvent(event: ExecutionEntryBegunEvent): EncodedDomainEvent {
  return encodeEventEnvelope(event);
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
  return encodeEventEnvelope(event);
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
  return encodeEventEnvelope(event);
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

export function encodeExecutionRunReconciledEvent(event: ExecutionRunReconciledEvent): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}
export function executionRunReconciledEventFromEvent(event: EncodedDomainEvent): DecodeResult<ExecutionRunReconciledEvent> {
  const decoded = decodeEventBase(event, EXECUTION_RUN_RECONCILED_EVENT_TYPE, EXECUTION_ENTRY_EVENT_SCHEMA_VERSION);
  if (decoded.status !== 'decoded') return decoded;
  const body = decoded.value.body;
  if (!RECONCILED_OPERATIONS.includes(body['operation'] as string)) return invalid('reconciled event operation is not recognized');
  const runProblem = runSnapshotProblem(body['run']);
  if (runProblem !== null) return invalid(runProblem);
  return { status: 'decoded', value: body as unknown as ExecutionRunReconciledEvent };
}

function validateReconciledEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = executionRunReconciledEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
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
 * Registration for the four entry/result replay events plus the Slice 2B
 * `RunActivity`/`ActivityRecording` records, their two replay events and the
 * `s2b-run-activity-by-goal-last` index (§5.3 last row). Run/Attempt/outbox/
 * Lease/Session are registered by their owning modules and are NOT re-registered
 * here; `RunActivity`/`ActivityRecording` have no other owner, so this group is
 * their single registration (a duplicate aggregateType registration is a real
 * conflict).
 */
export const EXECUTION_ENTRY_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    ...RUN_ACTIVITY_RECORD_SCHEMAS.records,
  ],
  events: [
    { eventType: EXECUTION_ENTRY_AUTHORIZED_EVENT_TYPE, schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, validate: validateAuthorizedEvent },
    { eventType: EXECUTION_ENTRY_BEGUN_EVENT_TYPE, schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, validate: validateBegunEvent },
    { eventType: EXECUTION_ENTRY_ENTERED_EVENT_TYPE, schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, validate: validateEnteredEvent },
    { eventType: EXECUTION_RUN_RESULT_RECORDED_EVENT_TYPE, schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, validate: validateResultEvent },
    { eventType: EXECUTION_RUN_RECONCILED_EVENT_TYPE, schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, validate: validateReconciledEvent },
    ...RUN_ACTIVITY_RECORD_SCHEMAS.events,
  ],
  lookups: [
    ...RUN_ACTIVITY_RECORD_SCHEMAS.lookups ?? [],
  ],
};
