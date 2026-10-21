/**
 * The bounded event-codec factory: one description supplies the registration
 * identifiers and the body hook, and the factory derives the encode, decode and
 * registration wiring from it.
 *
 * The fixed pipeline is the existing one, in the existing order:
 * outer envelope → tagged JSON parse → outer/inner envelope agreement → body.
 * The first failure is returned unchanged. The order is part of the contract:
 * callers depend on which of several malformed fields is reported, so a stage
 * may not be reordered, merged or skipped. The body hook stays with its event
 * owner: only the wiring is shared here, not the event's rules.
 *
 * This description is deliberately a recipe, not a field table. It does not
 * derive validation from field declarations, does not narrow public types and
 * does not catch errors; the existing body checkers and type declarations
 * remain the source of truth.
 */
import {
  invalid, parseTaggedObject, type UnknownRecord,
} from '../../../contracts/validation/common.js';
import type { DecodeResult, EncodedDomainEvent, EncodedEventSchema } from '../../record-store/ports.js';
import { encodeEventEnvelope } from './event-envelope.js';
import { eventBodyEnvelopeProblem, eventEnvelopeProblem } from './event-validation.js';

/**
 * The fixed identifiers and body hook one event supplies to the factory.
 * `schemaVersion` is the literal 1: every pilot event is `@1`, and a wider type
 * would let a caller register a version no decoder can accept.
 */
export type EventFormat = {
  eventType: string;
  schemaVersion: 1;
  jsonLabel: string;
  bodyProblem: (value: unknown) => string | null;
};

/**
 * Derives an event codec from `format`. The generic only constrains the outer
 * envelope (the same constraint as `encodeEventEnvelope`); it never narrows a
 * public type. Named decoders keep their own type assertion.
 */
export function createEventCodec<
  T extends { eventId: string; eventType: string; schemaVersion: number; occurredAt: string },
>(format: EventFormat): {
  encode(event: T): EncodedDomainEvent;
  decodeBody(event: EncodedDomainEvent): DecodeResult<UnknownRecord>;
  registration: EncodedEventSchema;
} {
  function decodeBody(event: EncodedDomainEvent): DecodeResult<UnknownRecord> {
    const problem = eventEnvelopeProblem(event, format.eventType, format.schemaVersion);
    if (problem !== null) return invalid(problem);
    const parsed = parseTaggedObject(event.json, format.jsonLabel);
    if (typeof parsed === 'string') return invalid(parsed);
    const bindingProblem = eventBodyEnvelopeProblem(parsed, event, format.eventType);
    if (bindingProblem !== null) return invalid(bindingProblem);
    const bodyProblem = format.bodyProblem(parsed);
    if (bodyProblem !== null) return invalid(bodyProblem);
    return { status: 'decoded', value: parsed };
  }

  return {
    /** Forwards only: the caller's object, its key order and its JSON bytes are preserved. */
    encode(event: T): EncodedDomainEvent {
      return encodeEventEnvelope(event);
    },
    decodeBody,
    registration: {
      eventType: format.eventType,
      schemaVersion: format.schemaVersion,
      // The Store validates the outer event it is about to persist; success
      // returns that same object (identity, not a re-encoded copy).
      validate(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
        const decoded = decodeBody(event);
        return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
      },
    },
  };
}
