/**
 * Line-pin write-event codecs.
 *
 * The ONE codec owner of `WorkspaceLinePinsChanged@1`: one atomic pin change per
 * request. The event carries the EXACT Workspace snapshot written by the same
 * commit plus its actor/request identity, so a receipt replay restores the
 * original result instead of guessing it from the current record (the same shape
 * as `persistence/decision-record-codecs.ts`'s `WorkspaceNoticeSeenChanged@1`).
 * `payload.proof` is always null: a pin change proves no decision content.
 *
 * The line-only body checks live here; the common event-body checks are shared
 * from `persistence/event-validation.ts`, so the `configuration` service imports
 * no decision internals. Validation of the snapshot value is the shared
 * `workspaceSnapshotValueProblem`; the pin table itself is validated by
 * `workspaceLineSettingsProblem` on every decode/commit.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { UnknownRecord } from '../../../contracts/validation/common.js';
import type { DecodeResult, EncodedDomainEvent, RecordBackendSchemas } from '../../record-store/ports.js';
import { createEventCodec, type EventFormat } from './event-codec-factory.js';
import { eventBodyProblem } from './event-validation.js';
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

const workspaceLinePinsChangedFormat: EventFormat = {
  eventType: WORKSPACE_LINE_PINS_CHANGED_EVENT,
  schemaVersion: LINE_SETTINGS_EVENT_SCHEMA_VERSION,
  jsonLabel: 'WorkspaceLinePinsChanged event',
  bodyProblem: workspaceLinePinsChangedEventProblem,
};

const workspaceLinePinsChangedCodec =
  createEventCodec<WorkspaceLinePinsChangedEventV1>(workspaceLinePinsChangedFormat);

export function encodeWorkspaceLinePinsChangedEvent(event: WorkspaceLinePinsChangedEventV1): EncodedDomainEvent {
  return workspaceLinePinsChangedCodec.encode(event);
}

export function decodeWorkspaceLinePinsChangedEvent(
  event: EncodedDomainEvent,
): DecodeResult<WorkspaceLinePinsChangedEventV1> {
  const decoded = workspaceLinePinsChangedCodec.decodeBody(event);
  return decoded.status === 'decoded'
    ? { status: 'decoded', value: decoded.value as unknown as WorkspaceLinePinsChangedEventV1 }
    : decoded;
}

// --------------------------------------------------------------------------
// Pure body shape helpers
// --------------------------------------------------------------------------

const EVENT_ENVELOPE_KEYS: readonly string[] = ['eventId', 'eventType', 'schemaVersion', 'occurredAt'];
const EVENT_BODY_KEYS: readonly string[] = [
  'identityKey', 'fingerprint', 'projectId', 'workspaceId', 'actor', 'requestId', 'payload',
];

/** Pure `WorkspaceLinePinsChanged@1` body check, excluding the normal event envelope. */
function workspaceLinePinsChangedEventProblem(value: unknown): string | null {
  const body = eventBodyProblem(value, EVENT_ENVELOPE_KEYS, EVENT_BODY_KEYS);
  if (typeof body === 'string') return body;
  const payload = body['payload'] as UnknownRecord;
  if (payload['proof'] !== null) return 'a WorkspaceLinePinsChanged proof must be null';
  return workspaceSnapshotValueProblem(payload['value']);
}

// --------------------------------------------------------------------------
// The one registration
// --------------------------------------------------------------------------

/**
 * The line-settings write-event registration. It declares no record schema and no
 * lookup: the pin change is a new EVENT type on the existing Workspace aggregate.
 */
export const LINE_SETTINGS_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [],
  events: [
    workspaceLinePinsChangedCodec.registration,
  ],
  lookups: [],
};
