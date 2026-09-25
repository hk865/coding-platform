/**
 * R4c.2b shared execution-history locator codec (WorkGraph persistence layer).
 *
 * Responsibility of THIS file — and nothing else:
 *  - own the PURE `RunExecutionHistoryV1` shape/range validator. The existing
 *    `RunSnapshot@1` record validator (`materials/record-readers.ts`) already
 *    imports `isRunExecutionHistoryV1`; the write rules in
 *    `tasks/execution-history-service.ts` reuse the SAME function. The locator
 *    rules are never copied into a second validator.
 *  - own the `ExecutionHistoryRecorded@1` event codec and its registration so an
 *    idempotent replay can be restored from the real Store with `eventAt`,
 *    instead of re-deriving the original Run revision/locator from current rows.
 *
 * It does NOT register or restate `RunSnapshot@1` (materials owns that codec),
 * imports no Kernel module, scans no event log and creates no table/index.
 *
 * Shape rules enforced here (shared by read and write):
 *  - `schemaVersion === 1`, no unknown keys;
 *  - `sessionRef` is a non-empty `{ projectId, sessionId }` (project equality
 *    against the owning Run is checked by the caller that knows the Run);
 *  - `kernel` has non-empty `adapterId`, `kernelSessionId`, `runId`, `turnId`;
 *  - `startPosition`, `observedThroughPosition` and a non-null `endPosition`
 *    are positive safe integers;
 *  - `startPosition <= observedThroughPosition`, and
 *    `startPosition <= endPosition <= observedThroughPosition`.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { RunExecutionHistoryV1 } from '../../../contracts/core/execution-history.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { RecordedExecutionHistory } from '../tasks/execution-history-contracts.js';

export const EXECUTION_HISTORY_RECORDED_EVENT_TYPE = 'ExecutionHistoryRecorded' as const;
export const EXECUTION_HISTORY_RECORDED_EVENT_SCHEMA_VERSION = 1 as const;

/**
 * Immutable replay source for one execution-history write. It carries the
 * ORIGINAL returned value (`recorded`) plus the trusted identity/fingerprint and
 * actor, so a replay never rebuilds the locator from the current Run.
 */
export type ExecutionHistoryRecordedEvent = {
  eventId: string;
  eventType: typeof EXECUTION_HISTORY_RECORDED_EVENT_TYPE;
  schemaVersion: typeof EXECUTION_HISTORY_RECORDED_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  fingerprint: string;
  recorded: RecordedExecutionHistory;
};

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

const HISTORY_KEYS: readonly string[] = [
  'schemaVersion', 'sessionRef', 'kernel', 'startPosition', 'observedThroughPosition', 'endPosition',
];
const SESSION_REF_KEYS: readonly string[] = ['projectId', 'sessionId'];
const KERNEL_KEYS: readonly string[] = ['adapterId', 'kernelSessionId', 'runId', 'turnId'];

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
function parseObject(json: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function invalid<T>(reason: string): DecodeResult<T> {
  return { status: 'invalid', reason };
}

function isRunRef(value: unknown): value is RunRef {
  return isJsonObject(value) && value['aggregateType'] === 'Run'
    && nonEmpty(value['projectId']) && nonEmpty(value['goalId']) && nonEmpty(value['runId']);
}

// --------------------------------------------------------------------------
// Pure locator validator (shared by the Run record validator and the writer)
// --------------------------------------------------------------------------

/** True only for a complete, internally consistent `RunExecutionHistoryV1`. */
export function isRunExecutionHistoryV1(value: unknown): value is RunExecutionHistoryV1 {
  if (!isJsonObject(value) || !hasOnlyKeys(value, HISTORY_KEYS)) return false;
  if (value['schemaVersion'] !== 1) return false;

  const sessionRef = value['sessionRef'];
  if (!isJsonObject(sessionRef) || !hasOnlyKeys(sessionRef, SESSION_REF_KEYS)) return false;
  if (!nonEmpty(sessionRef['projectId']) || !nonEmpty(sessionRef['sessionId'])) return false;

  const kernel = value['kernel'];
  if (!isJsonObject(kernel) || !hasOnlyKeys(kernel, KERNEL_KEYS)) return false;
  if (!nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId'])
    || !nonEmpty(kernel['runId']) || !nonEmpty(kernel['turnId'])) {
    return false;
  }

  const start = value['startPosition'];
  const observed = value['observedThroughPosition'];
  const end = value['endPosition'];
  if (!isPositiveSafeInteger(start) || !isPositiveSafeInteger(observed)) return false;
  if (!(end === null || isPositiveSafeInteger(end))) return false;
  if (start > observed) return false;
  if (end !== null && (end < start || end > observed)) return false;
  return true;
}

// --------------------------------------------------------------------------
// ExecutionHistoryRecorded event codec
// --------------------------------------------------------------------------

/** Encodes the immutable replay event; the JSON body is the full event. */
export function encodeExecutionHistoryRecordedEvent(
  event: ExecutionHistoryRecordedEvent,
): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

/**
 * Decodes a `ExecutionHistoryRecorded` event, verifying the outer envelope
 * against the JSON body, the identity/actor/fingerprint, the recorded
 * RunRef/locator shape and the Run/locator project equality. This is the only
 * decoder for the event.
 */
export function executionHistoryRecordedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<ExecutionHistoryRecordedEvent> {
  if (!isJsonObject(event)) return invalid('ExecutionHistoryRecorded event must be an object');
  if (event['eventType'] !== EXECUTION_HISTORY_RECORDED_EVENT_TYPE) {
    return invalid(`expected eventType ${EXECUTION_HISTORY_RECORDED_EVENT_TYPE}, got ${String(event['eventType'])}`);
  }
  if (event['schemaVersion'] !== EXECUTION_HISTORY_RECORDED_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${String(EXECUTION_HISTORY_RECORDED_EVENT_SCHEMA_VERSION)}, got ${String(event['schemaVersion'])}`);
  }
  if (!nonEmpty(event['eventId']) || !nonEmpty(event['occurredAt'])) {
    return invalid('ExecutionHistoryRecorded envelope is incomplete');
  }
  if (typeof event['json'] !== 'string') return invalid('ExecutionHistoryRecorded json must be a string');
  const body = parseObject(event['json']);
  if (body === null) return invalid('ExecutionHistoryRecorded event is not a JSON object');
  if (body['eventId'] !== event['eventId']) return invalid('ExecutionHistoryRecorded json does not match the envelope eventId');
  if (body['eventType'] !== event['eventType']) return invalid('ExecutionHistoryRecorded json does not match the envelope eventType');
  if (body['schemaVersion'] !== event['schemaVersion']) {
    return invalid('ExecutionHistoryRecorded json does not match the envelope schemaVersion');
  }
  if (body['occurredAt'] !== event['occurredAt']) return invalid('ExecutionHistoryRecorded json does not match the envelope occurredAt');

  if (!nonEmpty(body['identityKey'])) return invalid('ExecutionHistoryRecorded identityKey is required');
  if (!nonEmpty(body['fingerprint'])) return invalid('ExecutionHistoryRecorded fingerprint is required');
  const actor = body['actor'];
  if (!isJsonObject(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return invalid('ExecutionHistoryRecorded actor must be a trusted human/system actor');
  }

  const recorded = body['recorded'];
  if (!isJsonObject(recorded)) return invalid('ExecutionHistoryRecorded recorded value is required');
  const runRef = recorded['runRef'];
  if (!isRunRef(runRef)) return invalid('ExecutionHistoryRecorded recorded.runRef is not a complete RunRef');
  if (!isPositiveSafeInteger(recorded['runRevision'])) {
    return invalid('ExecutionHistoryRecorded recorded.runRevision must be a positive safe integer');
  }
  const history = recorded['history'];
  if (!isRunExecutionHistoryV1(history)) {
    return invalid('ExecutionHistoryRecorded recorded.history is not a complete RunExecutionHistoryV1');
  }
  if (history.sessionRef.projectId !== runRef.projectId) {
    return invalid('ExecutionHistoryRecorded recorded.history belongs to another project than its Run');
  }
  return { status: 'decoded', value: body as unknown as ExecutionHistoryRecordedEvent };
}

function validateExecutionHistoryRecordedEvent(
  event: EncodedDomainEvent,
): DecodeResult<EncodedDomainEvent> {
  const decoded = executionHistoryRecordedEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

// --------------------------------------------------------------------------
// Registration
// --------------------------------------------------------------------------

/**
 * Registration for the shared locator codec. `records` is EMPTY on purpose:
 * `RunSnapshot@1` is owned and registered by `materials/record-readers.ts` and
 * must not be re-registered here. Only the new replay event is registered.
 */
export const EXECUTION_HISTORY_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [],
  events: [
    {
      eventType: EXECUTION_HISTORY_RECORDED_EVENT_TYPE,
      schemaVersion: EXECUTION_HISTORY_RECORDED_EVENT_SCHEMA_VERSION,
      validate: validateExecutionHistoryRecordedEvent,
    },
  ],
  lookups: [],
};
