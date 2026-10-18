import type { UnknownRecord } from '../../../contracts/validation/common.js';
import { hasOnlyKeys, isRecord, isSha256Hex, nonEmpty } from '../../../contracts/validation/common.js';
import type { EncodedDomainEvent } from '../../record-store/ports.js';

/** The outer `EncodedDomainEvent` envelope check, in eventType → schemaVersion → eventId → occurredAt order. */
export function eventEnvelopeProblem(
  event: EncodedDomainEvent,
  eventType: string,
  schemaVersion: number,
): string | null {
  if (event.eventType !== eventType) return `expected eventType ${eventType}, got ${event.eventType}`;
  if (event.schemaVersion !== schemaVersion) {
    return `expected schemaVersion ${String(schemaVersion)}, got ${String(event.schemaVersion)}`;
  }
  if (!nonEmpty(event.eventId)) return `${eventType} eventId must be a non-empty string`;
  if (!nonEmpty(event.occurredAt)) return `${eventType} occurredAt must be a non-empty string`;
  return null;
}

/**
 * Slice-5 spec §2.8/§8.2: the outer envelope and the persisted JSON body must
 * agree on event id/type/version/time; the body alone is never trusted because
 * the decoder returns it as the event value.
 */
export function eventBodyEnvelopeProblem(
  body: UnknownRecord,
  event: EncodedDomainEvent,
  eventType: string,
): string | null {
  if (body['eventId'] !== event.eventId) return `${eventType} body eventId disagrees with the encoded event`;
  if (body['eventType'] !== event.eventType) return `${eventType} body eventType disagrees with the encoded event`;
  if (body['schemaVersion'] !== event.schemaVersion) {
    return `${eventType} body schemaVersion disagrees with the encoded event`;
  }
  if (body['occurredAt'] !== event.occurredAt) return `${eventType} body occurredAt disagrees with the encoded event`;
  return null;
}

/** Mirrors `contracts/validation/identity.ts::validateActor` at the wire boundary. */
export function actorProblem(value: unknown): string | null {
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

/** The common event-body check shared by the decision and line-settings codecs. */
export function eventBodyProblem(
  value: unknown,
  envelopeKeys: readonly string[],
  bodyKeys: readonly string[],
): UnknownRecord | string {
  if (!isRecord(value)) return 'the event body must be an object';
  if (!hasOnlyKeys(value, [...envelopeKeys, ...bodyKeys])) {
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
  return value;
}
