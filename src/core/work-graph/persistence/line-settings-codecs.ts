/**
 * Slice 2C L9 line-pin write-event codecs.
 *
 * The ONE codec owner of `WorkspaceLinePinsChanged@1`: one atomic pin change per
 * request. The event carries the EXACT Workspace snapshot written by the same
 * commit plus its actor/request identity, so a receipt replay restores the
 * original result instead of guessing it from the current record (the same shape
 * as `persistence/decision-record-codecs.ts`'s `WorkspaceNoticeSeenChanged@1`).
 * `payload.proof` is always null: a pin change proves no decision content.
 *
 * The body shape helpers live here rather than in the decision codec so this
 * file is the one owner of the new event and the `configuration` service imports
 * no slice-5 decision internals. Validation of the snapshot value is the shared
 * `workspaceSnapshotValueProblem`; the pin table itself is validated by
 * `workspaceLineSettingsProblem` on every decode/commit.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { DecodeResult, EncodedDomainEvent, RecordBackendSchemas } from '../../record-store/ports.js';
import { workspaceSnapshotValueProblem } from './record-codecs.js';

// --------------------------------------------------------------------------
// Fixed registration identifiers
// --------------------------------------------------------------------------

export const WORKSPACE_LINE_PINS_CHANGED_EVENT = 'WorkspaceLinePinsChanged' as const;
const LINE_SETTINGS_EVENT_SCHEMA_VERSION = 1 as const;

/** The persisted pin-change body (envelope identical to `WorkspaceNoticeSeenChanged`). */
export type WorkspaceLinePinsChangedEventV1 = {
  eventId: string;
  eventType: typeof WORKSPACE_LINE_PINS_CHANGED_EVENT;
  schemaVersion: 1;
  occurredAt: string;
  identityKey: string;
  fingerprint: string;
  projectId: string;
  workspaceId: string;
  actor: ActorRef;
  requestId: string;
  /** `value` is the whole post-write Workspace snapshot; its pin table is already validated. */
  payload: { value: WorkspaceSnapshot; proof: null };
};

// --------------------------------------------------------------------------
// Encoder / decoder
// --------------------------------------------------------------------------

export function encodeWorkspaceLinePinsChangedEvent(event: WorkspaceLinePinsChangedEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

export function decodeWorkspaceLinePinsChangedEvent(
  event: EncodedDomainEvent,
): DecodeResult<WorkspaceLinePinsChangedEventV1> {
  const problem = eventEnvelopeProblem(event);
  if (problem !== null) return invalid(problem);
  const parsed = parseJsonObject(event.json, 'WorkspaceLinePinsChanged event');
  if (typeof parsed === 'string') return invalid(parsed);
  const bindingProblem = bodyEnvelopeProblem(parsed, event);
  if (bindingProblem !== null) return invalid(bindingProblem);
  const bodyProblem = workspaceLinePinsChangedEventProblem(parsed);
  if (bodyProblem !== null) return invalid(bodyProblem);
  return { status: 'decoded', value: parsed as unknown as WorkspaceLinePinsChangedEventV1 };
}

// --------------------------------------------------------------------------
// Pure body shape helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
}
function parseJsonObject(json: string, what: string): UnknownRecord | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return `${what} is not valid JSON`;
  }
  return isRecord(parsed) ? parsed : `${what} JSON must be an object`;
}

const EVENT_ENVELOPE_KEYS: readonly string[] = ['eventId', 'eventType', 'schemaVersion', 'occurredAt'];
const EVENT_BODY_KEYS: readonly string[] = [
  'identityKey', 'fingerprint', 'projectId', 'workspaceId', 'actor', 'requestId', 'payload',
];

function eventEnvelopeProblem(event: EncodedDomainEvent): string | null {
  if (event.eventType !== WORKSPACE_LINE_PINS_CHANGED_EVENT) {
    return `expected eventType ${WORKSPACE_LINE_PINS_CHANGED_EVENT}, got ${event.eventType}`;
  }
  if (event.schemaVersion !== LINE_SETTINGS_EVENT_SCHEMA_VERSION) {
    return `expected schemaVersion ${String(LINE_SETTINGS_EVENT_SCHEMA_VERSION)}, got ${String(event.schemaVersion)}`;
  }
  if (!nonEmpty(event.eventId)) return 'WorkspaceLinePinsChanged eventId must be a non-empty string';
  if (!nonEmpty(event.occurredAt)) return 'WorkspaceLinePinsChanged occurredAt must be a non-empty string';
  return null;
}

function bodyEnvelopeProblem(body: UnknownRecord, event: EncodedDomainEvent): string | null {
  if (body['eventId'] !== event.eventId) return 'WorkspaceLinePinsChanged body eventId disagrees with the encoded event';
  if (body['eventType'] !== event.eventType) return 'WorkspaceLinePinsChanged body eventType disagrees with the encoded event';
  if (body['schemaVersion'] !== event.schemaVersion) return 'WorkspaceLinePinsChanged body schemaVersion disagrees with the encoded event';
  if (body['occurredAt'] !== event.occurredAt) return 'WorkspaceLinePinsChanged body occurredAt disagrees with the encoded event';
  return null;
}

/** Mirrors `contracts/validation/identity.ts::validateActor` at the wire boundary. */
function actorProblem(value: unknown): string | null {
  if (!isRecord(value) || !nonEmpty(value['id'])) return 'the event actor must be an ActorRef';
  if (value['kind'] === 'human' || value['kind'] === 'system') {
    return hasOnlyKeys(value, ['kind', 'id']) ? null : 'the event actor carries unknown fields';
  }
  if (value['kind'] !== 'agent') return 'the event actor kind must be human, system or agent';
  if (!hasOnlyKeys(value, ['kind', 'id', 'runRef'])) return 'the event agent actor carries unknown fields';
  const runRef = value['runRef'];
  if (!isRecord(runRef) || !hasOnlyKeys(runRef, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || runRef['aggregateType'] !== 'Run' || !nonEmpty(runRef['projectId'])
    || !nonEmpty(runRef['goalId']) || !nonEmpty(runRef['runId'])) {
    return 'the event agent actor runRef must be a complete RunRef';
  }
  return null;
}

/** Pure `WorkspaceLinePinsChanged@1` body check, excluding the normal event envelope. */
function workspaceLinePinsChangedEventProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'the event body must be an object';
  if (!hasOnlyKeys(value, [...EVENT_ENVELOPE_KEYS, ...EVENT_BODY_KEYS])) {
    return 'the event body carries unknown fields';
  }
  if (!nonEmpty(value['identityKey'])) return 'the event identityKey must be a non-empty string';
  if (!isSha256Hex(value['fingerprint'])) return 'the event fingerprint must be a lowercase sha256 hex';
  if (!nonEmpty(value['projectId'])) return 'the event projectId must be a non-empty string';
  if (!nonEmpty(value['workspaceId'])) return 'the event workspaceId must be a non-empty string';
  if (!nonEmpty(value['requestId'])) return 'the event requestId must be a non-empty string';
  const actor = actorProblem(value['actor']);
  if (actor !== null) return actor;
  const payload = value['payload'];
  if (!isRecord(payload) || !hasOnlyKeys(payload, ['value', 'proof'])) {
    return 'the event payload must carry exactly value and proof';
  }
  if (payload['proof'] !== null) return 'a WorkspaceLinePinsChanged proof must be null';
  return workspaceSnapshotValueProblem(payload['value']);
}

// --------------------------------------------------------------------------
// The one registration
// --------------------------------------------------------------------------

function validateWorkspaceLinePinsChangedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = decodeWorkspaceLinePinsChangedEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

/**
 * The line-settings write-event registration. It declares no record schema and no
 * lookup: the pin change is a new EVENT type on the existing Workspace aggregate.
 */
export const LINE_SETTINGS_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [],
  events: [
    {
      eventType: WORKSPACE_LINE_PINS_CHANGED_EVENT,
      schemaVersion: LINE_SETTINGS_EVENT_SCHEMA_VERSION,
      validate: validateWorkspaceLinePinsChangedEvent,
    },
  ],
  lookups: [],
};
