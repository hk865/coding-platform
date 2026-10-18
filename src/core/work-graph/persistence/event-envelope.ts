import type { EncodedDomainEvent } from '../../record-store/ports.js';

/** Encodes the outer event envelope; the body is stringified unchanged. */
export function encodeEventEnvelope<
  E extends { eventId: string; eventType: string; schemaVersion: number; occurredAt: string },
>(event: E): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}
