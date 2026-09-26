/**
 * R5a record/event codecs for the four initialization operations.
 *
 * Wire shape (frozen in the stage-1 skeleton):
 *   {eventId, eventType, schemaVersion: 1, occurredAt, identityKey, fingerprint,
 *    projectId, actor, requestId, payload: {value}}
 * `value` is the exact snapshot the operation returns. It deliberately carries
 * no pre-registration directory identity and no external configuration version.
 *
 * These names are NEW and intentionally do NOT reuse the legacy multi-project
 * `WorkspaceRegistered` / `CompletionPolicyInstalled` wire names.
 *
 * The codecs only check pure encoding, shape, identity correspondence and (for a
 * CompletionPolicy revision) the frozen content digest. They perform no I/O, no
 * permission and no transaction. `project-bootstrap-service.ts` decodes through
 * the same functions on the replay path instead of trusting the current pointer.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import { completionPolicyContentDigest } from '../../../contracts/governance.js';
import type {
  CompletionPolicyContentV1,
  CompletionPolicyRevisionRef,
  CompletionPolicyRevisionSnapshot,
  ProjectCompletionPolicyActiveRef,
  ProjectCompletionPolicyActiveSnapshot,
} from '../../../contracts/governance.js';
import type { ProjectRef, ProjectSnapshot, WorkspaceRef, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  EncodedEventSchema,
  RecordBackendSchemas,
} from '../../record-store/ports.js';

export const PROJECT_REGISTERED_EVENT = 'ProjectRegistered';
export const PROJECT_WORKSPACE_REGISTERED_EVENT = 'ProjectWorkspaceRegistered';
export const PROJECT_COMPLETION_POLICY_INSTALLED_EVENT = 'ProjectCompletionPolicyInstalled';
export const PROJECT_COMPLETION_POLICY_ACTIVATED_EVENT = 'ProjectCompletionPolicyActivated';
export const PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION = 1;

type ProjectBootstrapEventBody<TValue> = {
  eventId: string;
  schemaVersion: typeof PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  fingerprint: string;
  projectId: string;
  actor: ActorRef;
  requestId: string;
  payload: { value: TValue };
};

export type ProjectRegisteredEventV1 =
  ProjectBootstrapEventBody<ProjectSnapshot> & { eventType: typeof PROJECT_REGISTERED_EVENT };
export type ProjectWorkspaceRegisteredEventV1 =
  ProjectBootstrapEventBody<WorkspaceSnapshot> & { eventType: typeof PROJECT_WORKSPACE_REGISTERED_EVENT };
export type ProjectCompletionPolicyInstalledEventV1 =
  ProjectBootstrapEventBody<CompletionPolicyRevisionSnapshot> & { eventType: typeof PROJECT_COMPLETION_POLICY_INSTALLED_EVENT };
export type ProjectCompletionPolicyActivatedEventV1 =
  ProjectBootstrapEventBody<ProjectCompletionPolicyActiveSnapshot> & { eventType: typeof PROJECT_COMPLETION_POLICY_ACTIVATED_EVENT };

/**
 * The identity-bearing fact recovered from one recorded operation event. The
 * service verifies it against the recovered identity before trusting `value`.
 */
export type ProjectBootstrapEventFact<TValue> = {
  eventId: string;
  occurredAt: string;
  identityKey: string;
  fingerprint: string;
  projectId: string;
  actor: ActorRef;
  requestId: string;
  value: TValue;
};

// --------------------------------------------------------------------------
// Mechanical shape helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
}
function parseJsonObject(json: string, what: string): DecodeResult<UnknownRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return invalid(`${what} is not valid JSON`);
  }
  if (!isRecord(parsed)) return invalid(`${what} JSON must be an object`);
  return { status: 'decoded', value: parsed };
}

/**
 * The four events are written only through the trusted Host binding, so their
 * actor is always a host human/system actor. The public event type keeps the
 * legacy `ActorRef` compatibility; this validator does not invent an `agent`
 * branch that has no producer in this batch.
 */
function hostActorFromValue(value: unknown): ActorRef | null {
  if (!isRecord(value)) return null;
  if (!nonEmpty(value['id'])) return null;
  const kind = value['kind'];
  if (kind !== 'human' && kind !== 'system') return null;
  return { kind, id: value['id'] };
}

function projectRefFromValue(value: unknown): ProjectRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'Project') return null;
  if (!nonEmpty(value['projectId'])) return null;
  return { aggregateType: 'Project', projectId: value['projectId'] };
}
function workspaceRefFromValue(value: unknown): WorkspaceRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'Workspace') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])) return null;
  return { aggregateType: 'Workspace', projectId: value['projectId'], workspaceId: value['workspaceId'] };
}
function policyRefFromValue(value: unknown): CompletionPolicyRevisionRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'CompletionPolicyRevision') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['policyId']) || !isPositiveInt(value['revision'])) return null;
  return {
    aggregateType: 'CompletionPolicyRevision',
    projectId: value['projectId'],
    policyId: value['policyId'],
    revision: value['revision'],
  };
}
function activeRefFromValue(value: unknown): ProjectCompletionPolicyActiveRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'ProjectCompletionPolicyActive') return null;
  if (!nonEmpty(value['projectId'])) return null;
  return { aggregateType: 'ProjectCompletionPolicyActive', projectId: value['projectId'] };
}

// --------------------------------------------------------------------------
// CompletionPolicy content: the policy-specific pure structure check
// --------------------------------------------------------------------------

/**
 * The policy-specific structural check moved from the legacy
 * `contracts/validation/governance.ts::validateCompletionPolicyContent`. It
 * checks exactly version, non-empty string requirementKinds, a positive
 * minimum and an optional string fastPathDiffClasses; it is NOT a revived
 * generic validation framework.
 */
export function completionPolicyContentProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'CompletionPolicy content must be an object';
  if (value['schemaVersion'] !== 1) return 'CompletionPolicy content.schemaVersion must be 1';
  const kinds = value['requirementKinds'];
  if (!Array.isArray(kinds) || !kinds.every((kind) => nonEmpty(kind))) {
    return 'CompletionPolicy content.requirementKinds must be an array of non-empty strings';
  }
  if (kinds.length === 0) {
    return 'CompletionPolicy content.requirementKinds must be non-empty (a policy with no kinds cannot compile obligations)';
  }
  if (!isPositiveInt(value['minimumRequiredRequirementsPerObligation'])) {
    return 'CompletionPolicy content.minimumRequiredRequirementsPerObligation must be a positive integer';
  }
  const fastPath = value['fastPathDiffClasses'];
  if (fastPath !== undefined && (!Array.isArray(fastPath) || !fastPath.every((entry) => nonEmpty(entry)))) {
    return 'CompletionPolicy content.fastPathDiffClasses must be an array of non-empty strings';
  }
  return null;
}

// --------------------------------------------------------------------------
// Value parsers (independent of any physical codec)
// --------------------------------------------------------------------------

function projectSnapshotFromValue(value: unknown, projectId: string): DecodeResult<ProjectSnapshot> {
  if (!isRecord(value)) return invalid('ProjectRegistered value must be an object');
  const ref = projectRefFromValue(value['ref']);
  if (ref === null) return invalid('ProjectRegistered value has no valid ProjectRef');
  if (ref.projectId !== projectId) return invalid('ProjectRegistered value belongs to another project');
  if (value['revision'] !== 1) return invalid('a created Project snapshot revision must be 1');
  return { status: 'decoded', value: { ref, revision: 1 } };
}

function workspaceSnapshotFromValue(value: unknown, projectId: string): DecodeResult<WorkspaceSnapshot> {
  if (!isRecord(value)) return invalid('ProjectWorkspaceRegistered value must be an object');
  const ref = workspaceRefFromValue(value['ref']);
  if (ref === null) return invalid('ProjectWorkspaceRegistered value has no valid WorkspaceRef');
  if (ref.projectId !== projectId) return invalid('ProjectWorkspaceRegistered value belongs to another project');
  if (value['revision'] !== 1) return invalid('a registered Workspace snapshot revision must be 1');
  return { status: 'decoded', value: { ref, revision: 1 } };
}

function policySnapshotFromValue(value: unknown, projectId: string): DecodeResult<CompletionPolicyRevisionSnapshot> {
  if (!isRecord(value)) return invalid('ProjectCompletionPolicyInstalled value must be an object');
  const ref = policyRefFromValue(value['ref']);
  if (ref === null) return invalid('ProjectCompletionPolicyInstalled value has no valid CompletionPolicyRevisionRef');
  if (ref.projectId !== projectId) return invalid('ProjectCompletionPolicyInstalled value belongs to another project');
  if (value['revision'] !== 1) return invalid('an installed CompletionPolicy row revision must be 1');
  if (value['schemaVersion'] !== 1) return invalid('CompletionPolicy snapshot schemaVersion must be 1');
  if (value['policyId'] !== ref.policyId) return invalid('CompletionPolicy snapshot policyId disagrees with its ref');
  if (value['contentRevision'] !== ref.revision) {
    return invalid('CompletionPolicy snapshot contentRevision disagrees with its ref revision');
  }
  const digest = value['contentDigest'];
  if (!isSha256(digest)) return invalid('CompletionPolicy snapshot contentDigest must be a lowercase sha256 hex');
  const problem = completionPolicyContentProblem(value['content']);
  if (problem !== null) return invalid(problem);
  let recomputed: string;
  try {
    recomputed = completionPolicyContentDigest({
      schemaVersion: 1,
      policyId: ref.policyId,
      contentRevision: ref.revision,
      content: value['content'] as CompletionPolicyContentV1,
    });
  } catch {
    return invalid('CompletionPolicy snapshot content is not canonical JSON');
  }
  if (recomputed !== digest) {
    return invalid('CompletionPolicy snapshot contentDigest does not match its content bytes');
  }
  return {
    status: 'decoded',
    value: {
      ref,
      revision: 1,
      schemaVersion: 1,
      policyId: ref.policyId,
      contentRevision: ref.revision,
      contentDigest: digest,
      content: value['content'] as CompletionPolicyContentV1,
    },
  };
}

function activeSnapshotFromValue(value: unknown, projectId: string): DecodeResult<ProjectCompletionPolicyActiveSnapshot> {
  if (!isRecord(value)) return invalid('ProjectCompletionPolicyActivated value must be an object');
  const ref = activeRefFromValue(value['ref']);
  if (ref === null) return invalid('ProjectCompletionPolicyActivated value has no valid active ref');
  if (ref.projectId !== projectId) return invalid('ProjectCompletionPolicyActivated value belongs to another project');
  if (value['projectId'] !== projectId) return invalid('ProjectCompletionPolicyActivated projectId disagrees with its ref');
  if (!isPositiveInt(value['revision'])) return invalid('an active pointer revision must be a positive integer');
  const activeRevision = policyRefFromValue(value['activeRevision']);
  if (activeRevision === null) return invalid('the active pointer does not name a legal CompletionPolicyRevisionRef');
  if (activeRevision.projectId !== projectId) {
    return invalid('the active pointer names a CompletionPolicyRevision in another project');
  }
  return {
    status: 'decoded',
    value: { ref, projectId, activeRevision, revision: value['revision'] },
  };
}

// --------------------------------------------------------------------------
// Event body / fact decoding
// --------------------------------------------------------------------------

type BootstrapEventEnvelope = {
  body: UnknownRecord;
  payloadValue: unknown;
};

/** Normal wire agreement: outer envelope vs JSON, plus common identity fields. */
function eventEnvelope(event: EncodedDomainEvent, what: string): DecodeResult<BootstrapEventEnvelope> {
  if (!nonEmpty(event.eventId)) return invalid(`${what} eventId must be a non-empty string`);
  if (!nonEmpty(event.occurredAt)) return invalid(`${what} occurredAt must be a non-empty string`);
  const parsed = parseJsonObject(event.json, what);
  if (parsed.status !== 'decoded') return parsed;
  const body = parsed.value;
  if (body['eventId'] !== event.eventId) return invalid(`${what} eventId disagrees with the encoded event`);
  if (body['eventType'] !== event.eventType) return invalid(`${what} eventType disagrees with the encoded event`);
  if (body['schemaVersion'] !== event.schemaVersion) return invalid(`${what} schemaVersion disagrees with the encoded event`);
  if (body['occurredAt'] !== event.occurredAt) return invalid(`${what} occurredAt disagrees with the encoded event`);
  if (!nonEmpty(body['identityKey'])) return invalid(`${what} identityKey must be a non-empty string`);
  if (!isSha256(body['fingerprint'])) return invalid(`${what} fingerprint must be a lowercase sha256 hex`);
  if (!nonEmpty(body['projectId'])) return invalid(`${what} projectId must be a non-empty string`);
  if (!nonEmpty(body['requestId'])) return invalid(`${what} requestId must be a non-empty string`);
  if (hostActorFromValue(body['actor']) === null) return invalid(`${what} actor is not a trusted host actor`);
  const payload = body['payload'];
  if (!isRecord(payload) || !Object.prototype.hasOwnProperty.call(payload, 'value')) {
    return invalid(`${what} payload must be an object with a value`);
  }
  return { status: 'decoded', value: { body, payloadValue: payload['value'] } };
}

function factOf<TValue>(event: EncodedDomainEvent, body: UnknownRecord, value: TValue): ProjectBootstrapEventFact<TValue> {
  return {
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    identityKey: body['identityKey'] as string,
    fingerprint: body['fingerprint'] as string,
    projectId: body['projectId'] as string,
    actor: body['actor'] as ActorRef,
    requestId: body['requestId'] as string,
    value,
  };
}

export function decodeProjectRegisteredEvent(event: EncodedDomainEvent): DecodeResult<ProjectBootstrapEventFact<ProjectSnapshot>> {
  if (event.eventType !== PROJECT_REGISTERED_EVENT || event.schemaVersion !== PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION) {
    return invalid(`expected event type ${PROJECT_REGISTERED_EVENT}@1`);
  }
  const envelope = eventEnvelope(event, 'ProjectRegistered event');
  if (envelope.status !== 'decoded') return envelope;
  const decoded = projectSnapshotFromValue(envelope.value.payloadValue, envelope.value.body['projectId'] as string);
  if (decoded.status !== 'decoded') return decoded;
  return { status: 'decoded', value: factOf(event, envelope.value.body, decoded.value) };
}

export function decodeProjectWorkspaceRegisteredEvent(
  event: EncodedDomainEvent,
): DecodeResult<ProjectBootstrapEventFact<WorkspaceSnapshot>> {
  if (event.eventType !== PROJECT_WORKSPACE_REGISTERED_EVENT || event.schemaVersion !== PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION) {
    return invalid(`expected event type ${PROJECT_WORKSPACE_REGISTERED_EVENT}@1`);
  }
  const envelope = eventEnvelope(event, 'ProjectWorkspaceRegistered event');
  if (envelope.status !== 'decoded') return envelope;
  const decoded = workspaceSnapshotFromValue(envelope.value.payloadValue, envelope.value.body['projectId'] as string);
  if (decoded.status !== 'decoded') return decoded;
  return { status: 'decoded', value: factOf(event, envelope.value.body, decoded.value) };
}

export function decodeProjectCompletionPolicyInstalledEvent(
  event: EncodedDomainEvent,
): DecodeResult<ProjectBootstrapEventFact<CompletionPolicyRevisionSnapshot>> {
  if (event.eventType !== PROJECT_COMPLETION_POLICY_INSTALLED_EVENT
    || event.schemaVersion !== PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION) {
    return invalid(`expected event type ${PROJECT_COMPLETION_POLICY_INSTALLED_EVENT}@1`);
  }
  const envelope = eventEnvelope(event, 'ProjectCompletionPolicyInstalled event');
  if (envelope.status !== 'decoded') return envelope;
  const decoded = policySnapshotFromValue(envelope.value.payloadValue, envelope.value.body['projectId'] as string);
  if (decoded.status !== 'decoded') return decoded;
  return { status: 'decoded', value: factOf(event, envelope.value.body, decoded.value) };
}

export function decodeProjectCompletionPolicyActivatedEvent(
  event: EncodedDomainEvent,
): DecodeResult<ProjectBootstrapEventFact<ProjectCompletionPolicyActiveSnapshot>> {
  if (event.eventType !== PROJECT_COMPLETION_POLICY_ACTIVATED_EVENT
    || event.schemaVersion !== PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION) {
    return invalid(`expected event type ${PROJECT_COMPLETION_POLICY_ACTIVATED_EVENT}@1`);
  }
  const envelope = eventEnvelope(event, 'ProjectCompletionPolicyActivated event');
  if (envelope.status !== 'decoded') return envelope;
  const decoded = activeSnapshotFromValue(envelope.value.payloadValue, envelope.value.body['projectId'] as string);
  if (decoded.status !== 'decoded') return decoded;
  return { status: 'decoded', value: factOf(event, envelope.value.body, decoded.value) };
}

// --------------------------------------------------------------------------
// Encoders
// --------------------------------------------------------------------------

export function encodeProjectRegisteredEvent(event: ProjectRegisteredEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}
export function encodeProjectWorkspaceRegisteredEvent(event: ProjectWorkspaceRegisteredEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}
export function encodeProjectCompletionPolicyInstalledEvent(
  event: ProjectCompletionPolicyInstalledEventV1,
): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}
export function encodeProjectCompletionPolicyActivatedEvent(
  event: ProjectCompletionPolicyActivatedEventV1,
): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

// --------------------------------------------------------------------------
// Registration
// --------------------------------------------------------------------------

function decodeAsEncodedEvent<T>(
  event: EncodedDomainEvent,
  decode: (candidate: EncodedDomainEvent) => DecodeResult<T>,
): DecodeResult<EncodedDomainEvent> {
  const decoded = decode(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

const PROJECT_BOOTSTRAP_EVENT_SCHEMAS: readonly EncodedEventSchema[] = [
  {
    eventType: PROJECT_REGISTERED_EVENT,
    schemaVersion: PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION,
    validate: (event) => decodeAsEncodedEvent(event, decodeProjectRegisteredEvent),
  },
  {
    eventType: PROJECT_WORKSPACE_REGISTERED_EVENT,
    schemaVersion: PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION,
    validate: (event) => decodeAsEncodedEvent(event, decodeProjectWorkspaceRegisteredEvent),
  },
  {
    eventType: PROJECT_COMPLETION_POLICY_INSTALLED_EVENT,
    schemaVersion: PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION,
    validate: (event) => decodeAsEncodedEvent(event, decodeProjectCompletionPolicyInstalledEvent),
  },
  {
    eventType: PROJECT_COMPLETION_POLICY_ACTIVATED_EVENT,
    schemaVersion: PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION,
    validate: (event) => decodeAsEncodedEvent(event, decodeProjectCompletionPolicyActivatedEvent),
  },
];

/**
 * Records reuse `GOAL_RECORD_SCHEMAS` (Project/Workspace) and
 * `PLAN_GOVERNANCE_RECORD_SCHEMAS` (policy revision / active pointer): only the
 * four operation events are registered here.
 */
export const PROJECT_BOOTSTRAP_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [],
  events: PROJECT_BOOTSTRAP_EVENT_SCHEMAS,
  lookups: [],
};
