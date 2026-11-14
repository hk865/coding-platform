/**
 * The `GoalDeliveryAcceptance@1` record and `GoalDeliveryAccepted` event codecs (decision 121-45, acc).
 *
 * One field table each, the record store registration and the canonical ref key. No lookup: the delivery read addresses
 * the record by the canonical key of its full `(project, goal, phaseRevision)` ref. The event carries the whole record
 * as `result`, so a receipt replay reads the event alone; the decoder also proves the event's `goalRef`/`phaseRevision`
 * name that same record's Goal and phase, never a foreign one.
 */
import { defineEvent, defineRecord, defineShape, f } from '../../../contracts/data-format.js';
import { GoalRefShape, PlanRevisionRefShape, id } from '../../../contracts/data-format-refs.js';
import type {
  GoalDeliveryAcceptanceRef, GoalDeliveryAcceptanceV1, GoalDeliveryAcceptedEvent,
} from '../../../contracts/goal-delivery.js';
import { isRecord } from '../../../contracts/validation/common.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import { actorProblem } from './event-validation.js';
import { createEventCodec, createRecordCodec, formatSchemas } from './field-table-codec.js';
import { canonicalRefKey } from './record-codecs.js';

export const GOAL_DELIVERY_ACCEPTANCE_SCHEMA_ID = 'GoalDeliveryAcceptance@1' as const;
export const GOAL_DELIVERY_ACCEPTED_EVENT_TYPE = 'GoalDeliveryAccepted' as const;

/** The record's address: one acceptance per (Goal, GoalPhase revision). */
const GoalDeliveryAcceptanceRefShape = defineShape({
  name: 'GoalDeliveryAcceptanceRef',
  fields: { aggregateType: f.literal('GoalDeliveryAcceptance'), projectId: id, goalId: id,
    phaseRevision: f.revision({ min: 1 }) },
});

const GoalDeliveryAcceptanceFields = {
  ref: f.ref(GoalDeliveryAcceptanceRefShape),
  schemaVersion: f.literal(1),
  revision: f.literal(1),
  goalRef: f.ref(GoalRefShape),
  planRef: f.ref(PlanRevisionRefShape),
  planRevision: f.integer({ min: 1 }),
  /** The configured operator; the acceptance is theirs, never a platform automation's. */
  acceptedBy: f.union('kind', { human: { kind: f.literal('human'), id } }),
  acceptedAt: f.isoTime(),
  requestId: id,
};

const GoalDeliveryAcceptanceFormat = defineRecord({
  name: 'GoalDeliveryAcceptance', schemaId: GOAL_DELIVERY_ACCEPTANCE_SCHEMA_ID,
  aggregateType: 'GoalDeliveryAcceptance', fields: GoalDeliveryAcceptanceFields,
});

/**
 * The event body: the four envelope keys are added by the event codec. The rule proves the actor and that the event's
 * Goal/phase name the embedded record's Goal/phase (the completion event's cross-check style).
 */
function goalDeliveryAcceptedProblem(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const actor = actorProblem(value['actor']);
  if (actor !== null) return `actor: ${actor}`;
  const goalRef = value['goalRef'] as { projectId: string; goalId: string };
  const result = value['result'] as {
    ref: { phaseRevision: number }; goalRef: { projectId: string; goalId: string };
  };
  if (goalRef.projectId !== result.goalRef.projectId || goalRef.goalId !== result.goalRef.goalId) {
    return 'the GoalDeliveryAccepted goalRef disagrees with the accepted record';
  }
  if (value['phaseRevision'] !== result.ref.phaseRevision) {
    return 'the GoalDeliveryAccepted phaseRevision disagrees with the accepted record';
  }
  return null;
}

const GoalDeliveryAcceptedFormat = defineEvent({
  name: 'GoalDeliveryAccepted', eventType: GOAL_DELIVERY_ACCEPTED_EVENT_TYPE, schemaVersion: 1,
  fields: {
    identityKey: id,
    actor: f.json(),
    fingerprint: f.sha256(),
    goalRef: f.ref(GoalRefShape),
    phaseRevision: f.revision({ min: 1 }),
    result: f.object(GoalDeliveryAcceptanceFields),
  },
  rules: [goalDeliveryAcceptedProblem],
});

const goalDeliveryAcceptanceCodec = createRecordCodec(GoalDeliveryAcceptanceFormat);
const goalDeliveryAcceptedCodec = createEventCodec(GoalDeliveryAcceptedFormat);

/** Both the acceptance record and its one result event in one registration group. */
export const GOAL_DELIVERY_SCHEMAS: RecordBackendSchemas =
  formatSchemas([goalDeliveryAcceptanceCodec, goalDeliveryAcceptedCodec]);

export function encodeGoalDeliveryAcceptance(record: GoalDeliveryAcceptanceV1): EncodedRecord {
  return goalDeliveryAcceptanceCodec.encode(record);
}

export function decodeGoalDeliveryAcceptance(record: EncodedRecord): DecodeResult<GoalDeliveryAcceptanceV1> {
  const decoded = goalDeliveryAcceptanceCodec.decode(record);
  if (decoded.status !== 'decoded') return decoded;
  return { status: 'decoded', value: decoded.value as GoalDeliveryAcceptanceV1 };
}

export function encodeGoalDeliveryAcceptedEvent(event: GoalDeliveryAcceptedEvent): EncodedDomainEvent {
  return goalDeliveryAcceptedCodec.encode(event);
}

/** The replay decode: the event alone yields the original record (its `result`). */
export function decodeGoalDeliveryAcceptedEvent(event: EncodedDomainEvent): DecodeResult<GoalDeliveryAcceptanceV1> {
  const decoded = goalDeliveryAcceptedCodec.decode(event);
  if (decoded.status !== 'decoded') return decoded;
  return { status: 'decoded', value: decoded.value.result };
}

export function goalDeliveryAcceptanceRefKey(ref: GoalDeliveryAcceptanceRef): string {
  return canonicalRefKey(ref);
}
